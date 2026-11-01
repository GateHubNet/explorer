import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { bucketStarts } from "../domain/window";
import type { FeeBucketRow, LastValidated, MintedPage, NetworkSupply, Page } from "./api-types";
import { TooLate } from "./deadline";
import { burnedCardOf, mintedCardOf, type BurnedCard, type Failure, type MintedCard } from "./supply-view";

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
