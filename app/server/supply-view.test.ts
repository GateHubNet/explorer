import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { bucketStarts } from "../domain/window";
import type { FeeBucketRow, LastValidated, MintedPage, NetworkSupply, Page } from "./api-types";
import { TooLate } from "./deadline";
import {
  burnedCardOf,
  captionPercent,
  compactFigure,
  mintedCardOf,
  SUPPLY_STALE_SECONDS,
  supplyPage,
  type BurnedCard,
  type Failure,
  type MintedCard,
  type SupplyCards,
  type SupplyPageData,
  type SupplyTile,
  type TileId,
} from "./supply-view";

// ---- The world of the tests: T is 2026-10-17, the close time of the newest ledger 17:01:12 UTC; the fixtures are the files of Task 2 and E2's fee days ---------------------------------

const WINDOW = "end=2026-10-17&interval=day&limit=1000&start=2026-07-20";
const read = <T>(net: "xrpl" | "xahau", path: string): T => JSON.parse(readFileSync(new URL(`../../test/fixtures/http/${net}/data-api/${path}`, import.meta.url), "utf8")) as T;
const feeDays = (net: "xrpl" | "xahau") => read<Page<"rows", FeeBucketRow>>(net, `network/fees@${WINDOW}.json`);
const mintedDays = () => read<MintedPage>("xahau", `network/supply/minted@${WINDOW}.json`);
const xahauSupply = () => read<NetworkSupply>("xahau", "network/supply.json");

const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "2F7C1D5A9B3E4F60A8D2C71B5E9F3A4D6C8B0E1F2A3B4C5D6E7F8A9B0C1D2E3F",
  parent_hash: "9A8B7C6D5E4F30211203F4E5D6C7B8A998877665544332211FFEEDDCCBBAA990",
  close_time: "2026-10-17T17:01:12Z",
};
const XRPL = { native: "XRP" } as const;
const XAHAU = { native: "XAH" } as const;

const fulfilled = <V>(value: V): PromiseFulfilledResult<V> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

/** A card that must have loaded. */
function loaded<X extends object>(card: { state: "ok" } & X | { state: "failed"; reason: string }): { state: "ok" } & X {
  if (card.state !== "ok") throw new Error(`the card failed: ${card.reason}`);
  return card;
}

const burned = (net: typeof XRPL | typeof XAHAU = XRPL, fees: Page<"rows", FeeBucketRow> = feeDays(net.native === "XRP" ? "xrpl" : "xahau"), failures: Failure[] = []): BurnedCard =>
  burnedCardOf(net, fulfilled(LAST), fulfilled(fees), failures);
const minted = (page: MintedPage = mintedDays(), failures: Failure[] = []): MintedCard => mintedCardOf(XAHAU, xahauSupply().minted!, fulfilled(LAST), fulfilled(page), failures);

/** The rows of a fees page with one day's total replaced (or the day removed, with `null`). */
function withDay(fees: Page<"rows", FeeBucketRow>, day: string, total: number | null): Page<"rows", FeeBucketRow> {
  const rows = fees.rows.flatMap((row) => (row.date.startsWith(day) ? (total === null ? [] : [{ ...row, total }]) : [row]));
  return { ...fees, count: rows.length, rows };
}

describe("burnedCardOf", () => {
  it("burned: the 90 buckets, today forming, a day without a row null", () => {
    const card = loaded(burned(XRPL, withDay(feeDays("xrpl"), "2026-09-01", null)));
    const { data } = card;
    expect(data.axis).toEqual({ unit: "day", buckets: bucketStarts("2026-07-20", "2026-10-17", "day") });
    expect(data.axis.buckets).toHaveLength(90);
    expect(data.forming).toBe(true);
    expect(data.pending).toBeUndefined();
    expect(data.format).toEqual({ kind: "amount", unit: "XRP" });
    expect(data.totals).toBeUndefined();
    expect(data.series).toHaveLength(1);
    const [series] = data.series;
    expect(series).toMatchObject({ id: "burned", label: "Burned", heading: "Burned, XRP", slot: 1 });
    const gap = data.axis.buckets.indexOf("2026-09-01");
    expect(series!.values).toHaveLength(90);
    expect(series!.values[gap]).toBeNull();
    expect(series!.values.filter((value) => value === null)).toHaveLength(1);
    expect(series!.values[0]).toBe("24.435553");
    expect(series!.values[89]).toBe("21.803244");
    expect(data.token).toMatch(/^[0-9a-z]+$/);
  });

  it("burned: the summary sums today, averages and tops the full days only", () => {
    const xrpl = loaded(burned(XRPL));
    // Σ of the 90 rows 3466.848004, of the 89 full days 3445.04476 (average 38.708368…, to 6 decimals 38.708368); the highest full day is Oct 15, 194.907103.
    expect(xrpl.total).toBe("3466.848004");
    expect(xrpl.summary).toEqual(["Last 90 days: ", { b: "3,466.85 XRP" }, " burned as fees, 38.71 XRP a day on average. Highest: 194.91 XRP on Oct 15."]);
    const xahau = loaded(burned(XAHAU));
    expect(xahau.total).toBe("427.355847");
    expect(xahau.summary).toEqual(["Last 90 days: ", { b: "427.36 XAH" }, " burned as fees, 4.77 XAH a day on average. Highest: 25.22 XAH on Oct 1."]);
    expect(xahau.data.format).toEqual({ kind: "amount", unit: "XAH" });
    expect(xahau.data.series[0]!.heading).toBe("Burned, XAH");
    // Today so far is in the total and in neither the average nor the highest: a running day of 1,000,000 raises the sum and nothing else.
    const huge = loaded(burned(XRPL, withDay(feeDays("xrpl"), "2026-10-17", 1_000_000)));
    expect(huge.total).toBe("1003445.04476");
    expect(huge.summary).toEqual(["Last 90 days: ", { b: "1M XRP" }, " burned as fees, 38.71 XRP a day on average. Highest: 194.91 XRP on Oct 15."]);
  });

  it("burned: the earliest of equal days is the highest", () => {
    const flat: Page<"rows", FeeBucketRow> = { result: "success", count: 3, rows: ["2026-10-14", "2026-10-15", "2026-10-17"].map((day) => ({ avg: 0, max: 0, min: 0, tx_count: 1, date: `${day}T00:00:00Z`, total: 7.5 })) };
    expect(loaded(burned(XRPL, flat)).summary).toEqual(["Last 90 days: ", { b: "22.5 XRP" }, " burned as fees, 7.5 XRP a day on average. Highest: 7.5 XRP on Oct 14."]);
  });

  it("burned: a fee total that is a JSON number becomes exact text", () => {
    // 2.000001 + 1.000002 is 3.0000030000000004 as floats; as the text of their digits it is 3.000003.
    expect(2.000001 + 1.000002).not.toBe(3.000003);
    const two: Page<"rows", FeeBucketRow> = {
      result: "success",
      count: 2,
      rows: [
        { avg: 0, max: 0, min: 0, tx_count: 1, date: "2026-10-16T00:00:00Z", total: 2.000001 },
        { avg: 0, max: 0, min: 0, tx_count: 1, date: "2026-10-17T00:00:00Z", total: 1.000002 },
      ],
    };
    const card = loaded(burned(XRPL, two));
    expect(card.data.series[0]!.values.slice(-2)).toEqual(["2.000001", "1.000002"]);
    expect(card.total).toBe("3.000003");
    // A small number JavaScript writes with an exponent is plain digits.
    const small = loaded(burned(XRPL, { ...two, rows: [{ ...two.rows[0]!, total: 1e-7 }] }));
    expect(small.data.series[0]!.values.at(-2)).toBe("0.0000001");
    expect(small.total).toBe("0.0000001");
  });

  it("burned: with no full day to average, the summary says only the total", () => {
    const today: Page<"rows", FeeBucketRow> = { result: "success", count: 1, rows: [{ avg: 0, max: 0, min: 0, tx_count: 1, date: "2026-10-17T00:00:00Z", total: 3.25 }] };
    expect(loaded(burned(XRPL, today)).summary).toEqual(["Last 90 days: ", { b: "3.25 XRP" }, " burned as fees."]);
    const none = loaded(burned(XRPL, { result: "success", count: 0, rows: [] }));
    expect(none.summary).toEqual(["Last 90 days: ", { b: "0 XRP" }, " burned as fees."]);
    expect(none.total).toBe("0");
    expect(none.data.series[0]!.values.every((value) => value === null)).toBe(true);
  });

  it("burned: the window is the anchor's UTC day, whatever the hour", () => {
    const late = burnedCardOf(XRPL, fulfilled({ ...LAST, close_time: "2026-10-17T23:59:59Z" }), fulfilled(feeDays("xrpl")), []);
    expect(loaded(late).data.axis.buckets.at(-1)).toBe("2026-10-17");
    const early = burnedCardOf(XRPL, fulfilled({ ...LAST, close_time: "2026-10-18T00:00:01Z" }), fulfilled(feeDays("xrpl")), []);
    expect(loaded(early).data.axis.buckets.at(-1)).toBe("2026-10-18");
    expect(loaded(early).data.axis.buckets[0]).toBe("2026-07-21");
  });

  it("burned: the token follows everything the chart draws, the column heading too", () => {
    const first = loaded(burned(XRPL)).data.token;
    expect(loaded(burned(XRPL)).data.token).toBe(first);
    expect(loaded(burned(XRPL, withDay(feeDays("xrpl"), "2026-10-01", 1))).data.token).not.toBe(first);
    expect(loaded(burned(XAHAU, feeDays("xrpl"))).data.token).not.toBe(first);
  });

  it.each(["anchor", "fees"])("a rejected %s fails the burned card and reports it", (which) => {
    const failures: Failure[] = [];
    const error = new TooLate();
    const card = burnedCardOf(XRPL, which === "anchor" ? rejected(error) : fulfilled(LAST), which === "fees" ? rejected(error) : fulfilled(feeDays("xrpl")), failures);
    expect(card).toEqual({ state: "failed", reason: "took too long" });
    expect(failures).toEqual([{ part: "burned", error }]);
    // Any other error is the plain words, never its own: the page data reaches browsers.
    const other = new Error("data API GET /v2/network/fees?interval=day answered 500");
    const plain = burnedCardOf(XRPL, which === "anchor" ? rejected(other) : fulfilled(LAST), which === "fees" ? rejected(other) : fulfilled(feeDays("xrpl")), []);
    expect(plain).toEqual({ state: "failed", reason: "could not be loaded" });
  });

  it("an anchor that is fulfilled but is no time fails the burned card, with a failure and no throw", () => {
    const failures: Failure[] = [];
    const card = burnedCardOf(XRPL, fulfilled({ ...LAST, close_time: "yesterday" }), fulfilled(feeDays("xrpl")), failures);
    expect(card).toEqual({ state: "failed", reason: "could not be loaded" });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.part).toBe("burned");
    const noLedger = burnedCardOf(XRPL, fulfilled({ ...LAST, ledger_index: "x" }), fulfilled(feeDays("xrpl")), []);
    expect(noLedger.state).toBe("failed");
  });
});

describe("mintedCardOf", () => {
  const sum = (values: readonly (string | null)[]) => values.reduce((total, value) => (value === null ? total : total.plus(value)), new BigNumber(0)).toFixed();

  it("minted: three series in slots 1, 3 and 5 with exact totals", () => {
    const card = loaded(minted());
    const { data } = card;
    expect(data.series.map(({ id, label, slot }) => [id, label, slot])).toEqual([
      ["rewards", "Rewards", 1],
      ["import", "Import", 3],
      ["genesis_mint", "GenesisMint", 5],
    ]);
    expect(data.series.some((series) => series.heading !== undefined)).toBe(false);
    expect(data.axis.buckets).toHaveLength(90);
    expect(data.axis.buckets[0]).toBe("2026-07-20");
    expect(data.axis.buckets[89]).toBe("2026-10-17");
    expect(data.format).toEqual({ kind: "amount", unit: "XAH" });
    expect(data.forming).toBe(true);
    // Exact: the 90 rows' sources and sums, added with BigNumber (the files are Python-checked: 2,981,418.527222 = 2,648,405.593773 + 293,012.933449 + 40,000).
    expect(data.series.map((series) => sum(series.values))).toEqual(["2648405.593773", "293012.933449", "40000"]);
    expect(sum(data.totals!)).toBe("2981418.527222");
    expect(card.total).toBe("2981418.527222");
    expect(data.totals).toEqual(mintedDays().rows.map((row) => row.amount));
    expect(data.series[1]!.values[89]).toBe("2466.555961");
    expect(data.series[0]!.values[89]).toBe("11151.202747");
    expect(card.summary).toEqual(["Last 90 days: ", { b: "2.98M XAH" }, " minted (Rewards 2.65M, Import 293K, GenesisMint 40K), 33.3K a day on average."]);
    expect(card.notes).toEqual(["Rewards are paid to accounts that claim them. Import mints XAH for XRP burned on XRPL. GenesisMint is minted by governance."]);
    expect(card.coverage).toBeNull();
  });

  it("minted: the average is of the full days, today so far is in the total, and a day of zeros is a day", () => {
    const row = (day: string, rewards: string, imported: string, genesis: string): MintedPage["rows"][number] => ({
      date: `${day}T00:00:00Z`,
      amount: new BigNumber(rewards).plus(imported).plus(genesis).toFixed(),
      rewards,
      import: imported,
      genesis_mint: genesis,
    });
    const rows = [row("2026-10-15", "3000", "0", "0"), row("2026-10-16", "1000", "0", "0"), row("2026-10-17", "50000", "1000", "0")];
    const page: MintedPage = { result: "success", coverage: { from_ledger_index: 1, complete: true }, count: 3, rows };
    const card = loaded(minted(page));
    expect(card.total).toBe("55000");
    expect(card.summary).toEqual(["Last 90 days: ", { b: "55K XAH" }, " minted (Rewards 54K, Import 1,000, GenesisMint 0), 2,000 a day on average."]);
    // A day of zeros is a row, and a day to average: 3000 + 0 over two days.
    const zeros = loaded(minted({ ...page, rows: [row("2026-10-15", "3000", "0", "0"), row("2026-10-16", "0", "0", "0"), rows[2]!] }));
    expect(zeros.data.series[0]!.values.slice(-3)).toEqual(["3000", "0", "50000"]);
    expect(zeros.summary.at(-1)).toBe(" minted (Rewards 53K, Import 1,000, GenesisMint 0), 1,500 a day on average.");
    // With only today there is no day to average.
    const only = loaded(minted({ ...page, count: 1, rows: [rows[2]!] }));
    expect(only.summary).toEqual(["Last 90 days: ", { b: "51K XAH" }, " minted (Rewards 50K, Import 1,000, GenesisMint 0)."]);
    // With nothing at all.
    const none = loaded(minted({ ...page, count: 0, rows: [] }));
    expect(none.total).toBe("0");
    expect(none.summary).toEqual(["Last 90 days: ", { b: "0 XAH" }, " minted (Rewards 0, Import 0, GenesisMint 0)."]);
    expect(none.data.totals!.every((value) => value === null)).toBe(true);
  });

  it("minted days before the coverage start are null, and the card says why", () => {
    const page = mintedDays();
    // The coverage starts mid-window: the route has no row before Sep 1, and says so.
    const rows = page.rows.filter((row) => row.date >= "2026-09-01");
    const partial: MintedPage = { ...page, count: rows.length, rows, coverage: { from_ledger_index: 26_000_000, complete: false } };
    const card = loaded(minted(partial));
    const start = card.data.axis.buckets.indexOf("2026-09-01");
    expect(start).toBe(43);
    for (const series of card.data.series) {
      expect(series.values.slice(0, start).every((value) => value === null)).toBe(true);
      expect(series.values.slice(start).every((value) => value !== null)).toBe(true);
    }
    expect(card.data.totals!.slice(0, start).every((value) => value === null)).toBe(true);
    expect(card.total).toBe(sum(rows.map((row) => row.amount)));
    expect(card.coverage).toEqual({ before: "Covers ledger ", ledger: 26_000_000, after: " onwards: earlier mints are not in the index yet." });
    // Complete coverage says nothing.
    expect(loaded(minted({ ...partial, coverage: { from_ledger_index: 1, complete: true } })).coverage).toBeNull();
    // No ledger stored at all.
    expect(loaded(minted({ ...partial, coverage: { complete: false } })).coverage).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
  });

  it("minted: the since sentence names the coverage's first ledger, else 'In the index'", () => {
    const part = xahauSupply().minted!;
    const page = mintedDays();
    const said = (of: typeof part) => loaded(mintedCardOf(XAHAU, of, fulfilled(LAST), fulfilled(page), [])).since;
    expect(said(part)).toBe("Since ledger #1: 49,425,551.616207 XAH minted: 41,203,318.512207 as rewards, 8,102,233.104 by Import, 120,000 by GenesisMint.");
    expect(said({ ...part, coverage: { from_ledger_index: 99_413_505, complete: false } })).toMatch(/^Since ledger #99,413,505: 49,425,551\.616207 XAH minted: /);
    // No first ledger (none is stored), or no coverage at all: the rest is the same.
    const rest = "49,425,551.616207 XAH minted: 41,203,318.512207 as rewards, 8,102,233.104 by Import, 120,000 by GenesisMint.";
    expect(said({ ...part, coverage: { complete: false } })).toBe(`In the index: ${rest}`);
    const bare = { ...part };
    delete bare.coverage;
    expect(said(bare)).toBe(`In the index: ${rest}`);
  });

  it("minted: the token follows the days", () => {
    const first = loaded(minted()).data.token;
    expect(loaded(minted()).data.token).toBe(first);
    const page = mintedDays();
    const changed: MintedPage = { ...page, rows: page.rows.map((row, i) => (i === 3 ? { ...row, import: "1", amount: new BigNumber(row.amount).minus(row.import).plus(1).toFixed() } : row)) };
    expect(loaded(minted(changed)).data.token).not.toBe(first);
  });

  it("a rejected minted page fails the minted card", () => {
    const failures: Failure[] = [];
    const error = new TooLate();
    const card = mintedCardOf(XAHAU, xahauSupply().minted!, fulfilled(LAST), rejected(error), failures);
    expect(card).toEqual({ state: "failed", reason: "took too long" });
    expect(failures).toEqual([{ part: "minted", error }]);
    expect(mintedCardOf(XAHAU, xahauSupply().minted!, fulfilled(LAST), rejected(new Error("503")), [])).toEqual({ state: "failed", reason: "could not be loaded" });
  });

  it("a rejected anchor fails the minted card, and so does one that is fulfilled and is no time", () => {
    const failures: Failure[] = [];
    const error = new TooLate();
    expect(mintedCardOf(XAHAU, xahauSupply().minted!, rejected(error), fulfilled(mintedDays()), failures)).toEqual({ state: "failed", reason: "took too long" });
    expect(failures).toEqual([{ part: "minted", error }]);
    const bad: Failure[] = [];
    expect(mintedCardOf(XAHAU, xahauSupply().minted!, fulfilled({ ...LAST, close_time: "yesterday" }), fulfilled(mintedDays()), bad)).toEqual({ state: "failed", reason: "could not be loaded" });
    expect(bad).toHaveLength(1);
    expect(bad[0]!.part).toBe("minted");
  });
});

// ---- Task 5: the snapshot, the bar and the tiles --------------------------------------------------------------------------------------

const xrplSupply = () => read<NetworkSupply>("xrpl", "network/supply.json");

const NET_XRPL = { id: "xrpl", name: "XRPL", native: "XRP", hasAmm: true } as const;
const NET_XAHAU = { id: "xahau", name: "Xahau", native: "XAH", hasAmm: false } as const;
const NET_XRPL_TESTNET = { ...NET_XRPL, name: "XRPL Testnet" } as const;
const NET_XAHAU_TESTNET = { ...NET_XAHAU, name: "Xahau Testnet" } as const;

/** The page of a network over its fixtures, the anchor 17:01:12 UTC of T (`LAST`), the snapshot's own ledger the recorded one. */
function pageOf(net: "xrpl" | "xahau", over: Partial<NetworkSupply> = {}, cards: Partial<SupplyCards> = {}) {
  const supply = { ...(net === "xrpl" ? xrplSupply() : xahauSupply()), ...over };
  return supplyPage(net === "xrpl" ? NET_XRPL : NET_XAHAU, supply, {
    anchor: fulfilled(LAST),
    fees: fulfilled(feeDays(net)),
    ...(net === "xahau" ? { minted: fulfilled(mintedDays()) } : {}),
    ...cards,
  });
}
const tileOf = (page: SupplyPageData, id: TileId): SupplyTile => page.tiles.find((tile) => tile.id === id)!;

describe("compactFigure and captionPercent", () => {
  it("formats compact figures and caption percents", () => {
    expect(
      ["99985312374.716318", "594995554.799302", "268973.2", "2318.640227", "14687625.283682", "35212847105.402318", "64772465269.314"].map(compactFigure),
    ).toEqual(["99.99B", "595.00M", "268.97K", "2.32K", "14.69M", "35.21B", "64.77B"]);
    // Below 1,000: two decimals, zeros kept.
    expect(["0", "0.5", "14.6", "999.99", "9810004.2"].map(compactFigure)).toEqual(["0.00", "0.50", "14.60", "999.99", "9.81M"]);
    // A rounding that reaches 1,000 rolls to the next letter, as compactNumber's does, and 1,000 trillion has no letter after T.
    expect(["999.995", "999995", "999995000", "999995000000", "1000", "999999999999999", "1234567890123456"].map(compactFigure)).toEqual([
      "1.00K",
      "1.00M",
      "1.00B",
      "1.00T",
      "1.00K",
      "1000.00T",
      "1234.57T",
    ]);
    expect(compactFigure("-1500")).toBe("−1.50K");
    expect(compactFigure("soon")).toBe("soon");
    expect(
      [
        captionPercent("35212847105.402318", "100000000000"),
        captionPercent("594995554.799302", "613401782.117306"),
        captionPercent("14687625.283682", "100000000000"),
        captionPercent("0", "5"),
        captionPercent("5", "5"),
        captionPercent("0.05", "100"),
        captionPercent("0.049", "100"),
        captionPercent("1", "0"),
        captionPercent("-1", "5"),
        captionPercent("x", "5"),
      ],
    ).toEqual(["35.2%", "97.0%", "0.0%", "0.0%", "100.0%", "0.1%", "0.0%", "—", "—", "—"]);
  });
});

describe("supplyPage: the bar", () => {
  it.each(["xrpl", "xahau"] as const)("%s: the bar's parts add up to its row total exactly", (net) => {
    const { page } = pageOf(net);
    const [row] = page.bar.data.rows;
    const sum = row!.segments.reduce((total, segment) => total.plus(segment.value), new BigNumber(0));
    expect(sum.toFixed()).toBe(row!.total);
    expect(row!.total).toBe(net === "xrpl" ? "100000000000" : "613401782.117306");
  });

  it("XRPL: segments, captions, shares, the burned sliver line and the bracket's words", () => {
    const { page, failures } = pageOf("xrpl");
    expect(failures).toEqual([]);
    expect(page.bar.title).toBe("Where the 100 billion XRP are");
    expect(page.bar.text).toBe(
      "100,000,000,000 XRP were created in the first ledger and no more can be made. Every transaction burns a little as its fee, so the total supply only shrinks.",
    );
    expect(page.bar.data.unit).toBe("XRP");
    expect(page.bar.data.token).toMatch(/^[0-9a-z]+$/);
    expect(page.bar.data.rows).toEqual([
      {
        id: "supply",
        label: "Supply",
        total: "100000000000",
        segments: [
          { id: "burned", label: "Burned", slot: 2, value: "14687625.283682", caption: "14.69M XRP · 0.0%", share: "0.015% of the 100 billion XRP" },
          { id: "escrowed", label: "Escrowed", slot: 3, value: "35212847105.402318", caption: "35.21B XRP · 35.2%", share: "35.21% of the 100 billion XRP" },
          { id: "circulating", label: "Circulating supply", slot: 1, value: "64772465269.314", caption: "64.77B XRP · 64.8%", share: "64.77% of the 100 billion XRP" },
        ],
      },
    ]);
    expect(page.bar.burned).toEqual([{ b: "Burned 14.69M XRP" }, " · 0.015% of the 100 billion, a sliver at this scale"]);
    expect(page.bar.part!.start).toBeCloseTo(0.35227534730686, 12);
    expect(page.bar.part!.text).toEqual([
      "Part of circulating: ",
      { b: "46.22M XRP" },
      " in AMM pools (0.071% of circulating) · ",
      { b: "9.81M XRP" },
      " held as account reserves (0.015% of circulating)",
    ]);
    expect(page.bar.coverage).toBeNull();
  });

  it("Xahau has no AMM tile and says \"no AMM on Xahau\"", () => {
    const { page } = pageOf("xahau");
    expect(page.bar.title).toBe("Where the XAH are");
    expect(page.bar.text).toBe(
      "Xahau has no 100 billion cap: its supply grows by minting, through rewards, Import and GenesisMint, and shrinks a little as fees are burned. The bar is the total supply.",
    );
    expect(page.bar.burned).toBeNull();
    expect(page.bar.data.rows[0]!.segments).toEqual([
      { id: "escrowed", label: "Escrowed", slot: 3, value: "18406227.318004", caption: "18.41M XAH · 3.0%", share: "3.00% of the total supply" },
      { id: "circulating", label: "Circulating supply", slot: 1, value: "594995554.799302", caption: "595.00M XAH · 97.0%", share: "97.00% of the total supply" },
    ]);
    expect(page.bar.part!.start).toBeCloseTo(18406227.318004 / 613401782.117306, 12);
    expect(page.bar.part!.text).toEqual(["Part of circulating: ", { b: "268.97K XAH" }, " held as account reserves (0.045% of circulating) · no AMM on Xahau"]);
    expect(page.tiles.map((tile) => tile.id)).not.toContain("amm");
  });

  it("leaves a part the answer lacks out of the bracket, and the bracket out when nothing is left", () => {
    const noReserves = { ...xrplSupply() };
    delete noReserves.reserves;
    const only = supplyPage(NET_XRPL, noReserves, { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xrpl")) }).page;
    expect(only.bar.part!.text).toEqual(["Part of circulating: ", { b: "46.22M XRP" }, " in AMM pools (0.071% of circulating)"]);
    delete noReserves.amm;
    const none = supplyPage(NET_XRPL, noReserves, { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xrpl")) }).page;
    expect(none.bar.part).toBeNull();
    // Xahau without reserves still says it has no AMM.
    const xahau = { ...xahauSupply() };
    delete xahau.reserves;
    expect(supplyPage(NET_XAHAU, xahau, { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xahau")), minted: fulfilled(mintedDays()) }).page.bar.part!.text).toEqual(["Part of circulating: no AMM on Xahau"]);
  });

  it("says each coverage that is not complete under the bar", () => {
    const supply = xrplSupply();
    const incomplete = { from_ledger_index: 99_413_505, complete: false };
    const { page } = pageOf("xrpl", { escrowed: { ...supply.escrowed, coverage: incomplete } });
    expect(page.bar.coverage).toEqual({ before: "Covers ledger ", ledger: 99_413_505, after: " onwards: earlier escrows are not in the index yet." });
    expect(pageOf("xrpl", { escrowed: { amount: supply.escrowed.amount, escrows: 1 } }).page.bar.coverage).toBeNull();
  });
});

describe("supplyPage: the tiles", () => {
  it("tiles in board order with exact figures and the reserves formula from the answer", () => {
    const xrpl = pageOf("xrpl").page;
    expect(xrpl.tiles.map((tile) => tile.id)).toEqual(["total", "burned", "escrowed", "circulating", "amm", "reserves"]);
    expect(xrpl.tiles.map((tile) => tile.label)).toEqual(["Total supply", "Burned", "Escrowed", "Circulating supply", "In AMM pools", "Account reserves"]);
    expect(xrpl.tiles.every((tile) => tile.currency === "XRP")).toBe(true);
    expect(tileOf(xrpl, "total")).toEqual({
      id: "total",
      label: "Total supply",
      whole: "99,985,312,374",
      fraction: ".716318",
      currency: "XRP",
      aside: "≈ 99.99B",
      formula: "= 100,000,000,000 − burned",
      definition: "All the XRP that exists: 100 billion XRP less what has been burned.",
      sub: null,
      coverage: null,
    });
    expect(tileOf(xrpl, "burned")).toMatchObject({ whole: "14,687,625", fraction: ".283682", aside: "≈ 14.69M", formula: null, definition: "XRP destroyed as transaction fees, since the first ledger.", coverage: null });
    expect(tileOf(xrpl, "escrowed")).toMatchObject({ whole: "35,212,847,105", fraction: ".402318", aside: "≈ 35.21B", sub: "in 12,879 escrows", definition: "XRP held in escrows." });
    expect(tileOf(xrpl, "circulating")).toMatchObject({ whole: "64,772,465,269", fraction: ".314000", aside: "≈ 64.77B", formula: "= total supply − escrowed", definition: "The total supply less what is escrowed." });
    expect(tileOf(xrpl, "amm")).toMatchObject({ whole: "46,218,377", fraction: ".402915", aside: "≈ 46.22M", definition: "XRP held by 14,594 AMM pools. Part of the circulating supply." });
    expect(tileOf(xrpl, "reserves")).toEqual({
      id: "reserves",
      label: "Account reserves",
      whole: "9,810,004",
      fraction: ".000000",
      currency: "XRP",
      aside: "≈ 9.81M",
      formula: "= 6,410,280 × 1 + 16,998,620 × 0.2",
      definition: "XRP accounts must keep: 1 XRP each, and 0.2 XRP for every object they own. Part of the circulating supply.",
      sub: null,
      coverage: { before: "Covers ledger ", ledger: 28_685_313, after: " onwards: earlier account changes are not in the index yet." },
    });

    const xahau = pageOf("xahau").page;
    expect(xahau.tiles.map((tile) => tile.id)).toEqual(["total", "minted", "burned", "escrowed", "circulating", "reserves"]);
    expect(tileOf(xahau, "total")).toMatchObject({
      whole: "613,401,782",
      fraction: ".117306",
      currency: "XAH",
      aside: "≈ 613.40M",
      formula: null,
      definition: "All the XAH that exists. No 100 billion cap: Xahau's supply grows by minting.",
    });
    expect(tileOf(xahau, "minted")).toMatchObject({ label: "Minted, last 90 days", whole: "2,981,418", fraction: ".527222", aside: "≈ 2.98M", definition: "New XAH from rewards, Import and GenesisMint.", sub: null, coverage: null });
    expect(tileOf(xahau, "burned")).toMatchObject({ whole: "2,318", fraction: ".640227", aside: "≈ 2.32K", definition: "XAH destroyed as transaction fees, since the first ledger." });
    expect(tileOf(xahau, "escrowed").sub).toBe("in 2,140 escrows");
    expect(tileOf(xahau, "reserves")).toMatchObject({ whole: "268,973", fraction: ".200000", formula: "= 186,412 × 1 + 412,806 × 0.2", coverage: null });
  });

  it("takes the base and the increment of the reserves from the answer, never a constant", () => {
    const reserves = xrplSupply().reserves!;
    const { page } = pageOf("xrpl", { reserves: { ...reserves, base: "10", increment: "2.5", accounts: 1_234_567, owner_count: 8 } });
    expect(tileOf(page, "reserves")).toMatchObject({
      formula: "= 1,234,567 × 10 + 8 × 2.5",
      definition: "XRP accounts must keep: 10 XRP each, and 2.5 XRP for every object they own. Part of the circulating supply.",
    });
  });

  it("says one escrow and one pool in the singular", () => {
    const supply = xrplSupply();
    const { page } = pageOf("xrpl", { escrowed: { ...supply.escrowed, escrows: 1 }, amm: { ...supply.amm!, pools: 1 } });
    expect(tileOf(page, "escrowed").sub).toBe("in 1 escrow");
    expect(tileOf(page, "amm").definition).toBe("XRP held by 1 AMM pool. Part of the circulating supply.");
  });

  it("a missing part", () => {
    const noReserves = xrplSupply();
    delete noReserves.reserves;
    delete noReserves.amm;
    const { page, failures } = supplyPage(NET_XRPL, noReserves, { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xrpl")) });
    expect(failures).toEqual([]);
    // No pools, no AMM tile; no reserves, a tile that says so, and nothing of it in the bracket.
    expect(page.tiles.map((tile) => tile.id)).toEqual(["total", "burned", "escrowed", "circulating", "reserves"]);
    expect(tileOf(page, "reserves")).toEqual({
      id: "reserves",
      label: "Account reserves",
      whole: null,
      fraction: null,
      currency: "XRP",
      aside: null,
      formula: null,
      definition: "XRP that accounts must keep as reserves. Part of the circulating supply.",
      sub: "Not known at this ledger.",
      coverage: null,
    });
    expect(page.bar.part).toBeNull();
  });

  it("every coverage note", () => {
    const xrpl = xrplSupply();
    const gap = (from: number) => ({ from_ledger_index: from, complete: false });
    // The escrowed part is incomplete, and the circulating supply states its coverage: the bar, the Escrowed tile and the Circulating tile say it.
    const escrows = pageOf("xrpl", { escrowed: { ...xrpl.escrowed, coverage: gap(99_413_505) }, circulating: { ...xrpl.circulating, coverage: gap(99_413_505) } }).page;
    const words = { before: "Covers ledger ", ledger: 99_413_505, after: " onwards: earlier escrows are not in the index yet." };
    expect(escrows.bar.coverage).toEqual(words);
    expect(tileOf(escrows, "escrowed").coverage).toEqual(words);
    expect(tileOf(escrows, "circulating").coverage).toEqual(words);
    expect(tileOf(escrows, "total").coverage).toBeNull();
    expect(tileOf(escrows, "burned").coverage).toBeNull();
    // The AMM pools' and the reserves' (which the fixture has incomplete already).
    const pools = pageOf("xrpl", { amm: { ...xrpl.amm!, coverage: gap(1234) } }).page;
    expect(tileOf(pools, "amm").coverage).toEqual({ before: "Covers ledger ", ledger: 1234, after: " onwards: earlier pool changes are not in the index yet." });
    expect(tileOf(pools, "reserves").coverage!.after).toBe(" onwards: earlier account changes are not in the index yet.");
    // Xahau's burned (fees) and minted (mints).
    const xahau = xahauSupply();
    const mints = pageOf("xahau", { burned: { ...xahau.burned, coverage: gap(500) }, minted: { ...xahau.minted!, coverage: gap(700) } }).page;
    expect(tileOf(mints, "burned").coverage).toEqual({ before: "Covers ledger ", ledger: 500, after: " onwards: earlier fees are not in the index yet." });
    expect(tileOf(mints, "minted").coverage).toEqual({ before: "Covers ledger ", ledger: 700, after: " onwards: earlier mints are not in the index yet." });
    // The XRP Ledger's burned has no coverage, and then no note.
    expect(xrpl.burned.coverage).toBeUndefined();
  });

  it("a testnet answer shows every note and the page is whole", () => {
    const gap = { from_ledger_index: 3, complete: false };
    for (const [net, testnet, name] of [
      ["xrpl", NET_XRPL_TESTNET, "XRPL Testnet"],
      ["xahau", NET_XAHAU_TESTNET, "Xahau Testnet"],
    ] as const) {
      const base = net === "xrpl" ? xrplSupply() : xahauSupply();
      const supply: NetworkSupply = {
        ...base,
        burned: { ...base.burned, coverage: gap },
        escrowed: { ...base.escrowed, coverage: gap },
        circulating: { ...base.circulating, coverage: gap },
        ...(base.minted ? { minted: { ...base.minted, coverage: gap } } : {}),
        ...(base.amm ? { amm: { ...base.amm, coverage: gap } } : {}),
        ...(base.reserves ? { reserves: { ...base.reserves, coverage: gap } } : {}),
      };
      const { page, failures } = supplyPage(testnet, supply, { anchor: fulfilled(LAST), fees: fulfilled(feeDays(net)), ...(net === "xahau" ? { minted: fulfilled(mintedDays()) } : {}) });
      expect(failures).toEqual([]);
      expect(page.network).toEqual({ id: net, name, native: net === "xrpl" ? "XRP" : "XAH" });
      expect(page.bar.coverage).not.toBeNull();
      // Every tile but the total has its note; a tile with a part of its own says it, and a card is whole.
      expect(page.tiles.filter((tile) => tile.coverage === null).map((tile) => tile.id)).toEqual(["total"]);
      expect(page.burnedCard.state).toBe("ok");
      expect(page.mintedCard?.state ?? "ok").toBe("ok");
    }
    // The testnet of the XRP Ledger has the 100 billion bar and the burned line; the Xahau one names itself.
    const xrplTestnet = supplyPage(NET_XRPL_TESTNET, xrplSupply(), { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xrpl")) }).page;
    expect(xrplTestnet.bar.title).toBe("Where the 100 billion XRP are");
    expect(xrplTestnet.bar.burned).not.toBeNull();
    const xahauTestnet = supplyPage(NET_XAHAU_TESTNET, xahauSupply(), { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xahau")), minted: fulfilled(mintedDays()) }).page;
    expect(xahauTestnet.bar.text).toMatch(/^Xahau Testnet has no 100 billion cap: /);
    expect(xahauTestnet.bar.part!.text.at(-1)).toMatch(/ · no AMM on Xahau Testnet$/);
    expect(tileOf(xahauTestnet, "total").definition).toBe("All the XAH that exists. No 100 billion cap: Xahau Testnet's supply grows by minting.");
  });

  it("shows a figure that is not in sum with the others as served", () => {
    // D7 keeps total = escrowed + circulating; the client does not check it, and draws what it was given.
    const { page, failures } = pageOf("xahau", { circulating: { amount: "1" } });
    expect(failures).toEqual([]);
    expect(tileOf(page, "circulating").whole).toBe("1");
  });
});

describe("supplyPage: the snapshot, the intro and the description", () => {
  it("names the ledger, its link, its time and the network", () => {
    const { page } = pageOf("xrpl");
    expect(page.network).toEqual({ id: "xrpl", name: "XRPL", native: "XRP" });
    expect(page.snapshot).toEqual({ ledgerIndex: 107720688, ledgerHref: "/xrpl/ledger/107720688", closeTime: "2026-10-17T16:11:02Z", stale: null });
    expect(page.intro).toBe("How much XRP exists, how much is burned and escrowed, and how much circulates.");
    const xahau = pageOf("xahau").page;
    expect(xahau.snapshot).toEqual({ ledgerIndex: 26596843, ledgerHref: "/xahau/ledger/26596843", closeTime: "2026-10-17T17:47:11Z", stale: null });
    expect(xahau.intro).toBe("How much XAH exists, how much is minted, burned and escrowed, and how much circulates.");
  });

  it("the stale threshold", () => {
    const snapshot = Date.parse(xrplSupply().close_time) / 1000;
    const staleAt = (after: number) => {
      const closes = new Date((snapshot + after) * 1000).toISOString().replace(".000Z", "Z");
      return pageOf("xrpl", {}, { anchor: fulfilled({ ...LAST, close_time: closes }) }).page.snapshot.stale;
    };
    expect(staleAt(10_800)).toBeNull();
    expect(staleAt(10_801)).toEqual({ hours: 3 });
    expect(staleAt(18_000)).toEqual({ hours: 5 });
    expect(staleAt(0)).toBeNull();
    expect(staleAt(-600)).toBeNull();
    expect(SUPPLY_STALE_SECONDS).toBe(10_800);
    // The fixture's own: the newest ledger is 3,010 s after the snapshot's.
    expect(pageOf("xrpl").page.snapshot.stale).toBeNull();
  });

  it("a failed anchor fails both cards and drops the stale check", () => {
    const error = new TooLate();
    const { page, failures } = pageOf("xahau", {}, { anchor: rejected(error) });
    expect(page.snapshot.stale).toBeNull();
    expect(page.burnedCard).toEqual({ state: "failed", reason: "took too long" });
    expect(page.mintedCard).toEqual({ state: "failed", reason: "took too long" });
    expect(failures).toEqual([
      { part: "burned", error },
      { part: "minted", error },
    ]);
    // The rest of the page stands.
    expect(page.tiles.map((tile) => tile.id)).toEqual(["total", "minted", "burned", "escrowed", "circulating", "reserves"]);
    expect(page.bar.data.rows[0]!.segments).toHaveLength(2);
  });

  it("an anchor that is fulfilled and is no time fails both cards, with no stale check and no throw", () => {
    const { page, failures } = pageOf("xahau", {}, { anchor: fulfilled({ ...LAST, close_time: "yesterday" }) });
    expect(page.snapshot.stale).toBeNull();
    expect(page.burnedCard.state).toBe("failed");
    expect(page.mintedCard!.state).toBe("failed");
    expect(failures.map((failure) => failure.part)).toEqual(["burned", "minted"]);
  });

  it("fails one card on its own call and leaves the other whole", () => {
    const { page, failures } = pageOf("xahau", {}, { fees: rejected(new Error("503")) });
    expect(page.burnedCard).toEqual({ state: "failed", reason: "could not be loaded" });
    expect(page.mintedCard!.state).toBe("ok");
    expect(failures.map((failure) => failure.part)).toEqual(["burned"]);
    const worse = pageOf("xahau", {}, { minted: rejected(new TooLate()) });
    expect(worse.page.burnedCard.state).toBe("ok");
    expect(worse.page.mintedCard).toEqual({ state: "failed", reason: "took too long" });
    expect(worse.failures.map((failure) => failure.part)).toEqual(["minted"]);
  });

  it("the minted tile follows its card", () => {
    const ok = pageOf("xahau").page;
    expect(tileOf(ok, "minted")).toMatchObject({ whole: "2,981,418", fraction: ".527222", sub: null });
    expect((ok.mintedCard as { total: string }).total).toBe("2981418.527222");
    const failed = pageOf("xahau", {}, { minted: rejected(new TooLate()) }).page;
    expect(tileOf(failed, "minted")).toMatchObject({ label: "Minted, last 90 days", whole: null, fraction: null, aside: null, sub: "Couldn't load the minted days." });
    // A snapshot that mints, with the days not asked for at all, is a failed card too, and says so.
    const unasked = supplyPage(NET_XAHAU, xahauSupply(), { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xahau")) });
    expect(unasked.page.mintedCard!.state).toBe("failed");
    expect(unasked.failures.map((failure) => failure.part)).toEqual(["minted"]);
    // A snapshot that does not mint has no card and no tile.
    const xrpl = pageOf("xrpl").page;
    expect(xrpl.mintedCard).toBeNull();
    expect(xrpl.tiles.map((tile) => tile.id)).not.toContain("minted");
  });

  it("describes the snapshot for the meta tags", () => {
    expect(pageOf("xrpl").page.description).toBe("XRP supply at ledger #107,720,688: 99.99B total, 14.69M burned, 35.21B escrowed, 64.77B circulating.");
    expect(pageOf("xahau").page.description).toBe("XAH supply at ledger #26,596,843: 613.40M total, 49.43M minted, 2.32K burned, 18.41M escrowed, 595.00M circulating.");
    // A snapshot that does not mint says nothing of minting, whatever the network.
    const bare = { ...xahauSupply() };
    delete bare.minted;
    expect(supplyPage(NET_XAHAU, bare, { anchor: fulfilled(LAST), fees: fulfilled(feeDays("xahau")) }).page.description).toBe(
      "XAH supply at ledger #26,596,843: 613.40M total, 2.32K burned, 18.41M escrowed, 595.00M circulating.",
    );
  });
});
