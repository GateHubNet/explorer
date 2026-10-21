import { readdirSync, readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import type { Asset } from "../domain/asset";
import { formatPrice } from "../domain/format";
import { naturalOrientation, QUOTE_RANK } from "../domain/market-pair";
import { NO_FEATURES } from "../ui/features";
import {
  AMM_ACCOUNT,
  AMM_HOLDER,
  AMM_ISSUER,
  AMM_MARKER,
  AMM_OTHER,
  AMM_POOL,
  AMM_TX_HASH,
  ammBidSample,
  ammLiquiditySample,
  ammLiveVolumeSample,
  ammPoolSample,
  ammPoolsSample,
  ammSwapSample,
  ammVoteSample,
} from "../../test/support/amm-samples";
import { loadTx } from "../../test/support/ledgers";
import type { AmmGovernanceRow, AmmLiquidityEvent, AmmPool, AmmSwap, AmmVolumeComponent, AmmVolumeRow, LastValidated, Page } from "./api-types";
import {
  displayPair,
  exactRatio,
  feePercent,
  governanceRows,
  intervalText,
  liquidityRows,
  NOT_COMPUTED_NOTE,
  ammListPage,
  nextBidPrice,
  noAmmPage,
  slotInterval,
  swapRows,
  voteShares,
  type AmmListInput,
  type AmmListPageData,
} from "./amm-view";
import { TooLate } from "./deadline";
import type { AmmInfo } from "./node-rpc";

// ---- The world of the tests: T is Oct 17, the live set ends at 17:01 UTC --------------------------------------------------------------------------

const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD = "524C555344000000000000000000000000000000";
const USDC = "5553444300000000000000000000000000000000";
const USDC_ISSUER = "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE";
/** VOX🗽: a currency whose bytes are not text, so it is shown as hex. */
const VOX = "564F58F09F97BD00000000000000000000000000";
const VOX_ISSUER = "rBnJZMDB9HZ6UxUoeQc7eaAQHA3Y1v6Hk3";
const LIVE_END = "2026-10-17T17:01:00Z";
/** The words over the three tiles, which a failed totals card keeps; and the pools card's note while the live set is missing (a typographic apostrophe, as a `SectionError` writes it). */
const TILE_LABELS = ["Swap volume, 24 h", "Pools with swaps, 24 h", "Busiest pool, 24 h"];
const NO_VOLUME_NOTE = "Couldn’t load the 24-hour volume";
const TOTALS_FAILED = { state: "failed", what: "the 24-hour volume", labels: TILE_LABELS };

const XRPL: AmmListInput["net"] = { id: "xrpl", native: "XRP", features: { ...NO_FEATURES, ammPages: true, markets: true } };
const XAHAU: Parameters<typeof noAmmPage>[0] = { id: "xahau", features: { ...NO_FEATURES, ammPages: true, markets: true } };

const rlusd: Asset = { currency: RLUSD, issuer: RL };
const xrp: Asset = { currency: "XRP" };

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
  parent_hash: "5FA71FCC25A865DA7569108807E031AFB3E1CD03A8CE078BC1AA534C8E546BE8",
  close_time: "2026-10-17T17:01:12Z",
};

/** XRP/RLUSD as the API stores it: the base is the RLUSD, the counter the native currency. Reserves, fee and value are those of the board's biggest pool. */
const xrpRlusd = (over: Partial<AmmPool> = {}): AmmPool =>
  ammPoolSample({
    base_currency: RLUSD,
    base_issuer: RL,
    counter_currency: "XRP",
    reserve_base: "2417282.053464318",
    reserve_counter: "1847691.034536",
    trading_fee: 205,
    value_native: "3612345.5",
    ...over,
  });

/** The live set's component of a pool. `base` and `counter` are as the API writes them for this pool: the issued currency first. */
const component = (over: Partial<AmmVolumeComponent> = {}): AmmVolumeComponent => ({
  amm_account: AMM_POOL,
  base: rlusd,
  counter: xrp,
  count: 61,
  amount: "708895.8293",
  rate: "1.3059729",
  converted_amount: "542810.5",
  ...over,
});

const liveOf = (components: AmmVolumeComponent[], over: Partial<AmmVolumeRow> = {}): Page<"rows", AmmVolumeRow> => {
  const [row] = ammLiveVolumeSample().rows as [AmmVolumeRow];
  return { result: "success", count: 1, rows: [{ ...row, components, count: 1284, total: "893025.375", end_time: LIVE_END, ...over }] };
};

/** One row for each day from `from` to `to`, inclusive: the total is the day of the month in XRP, and the count twice that. */
function daysOf(from: string, to: string): AmmVolumeRow[] {
  const rows: AmmVolumeRow[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86_400_000) {
    const start = new Date(at).toISOString().slice(0, 10);
    const day = Number(start.slice(8));
    rows.push({
      components: [],
      count: day * 2,
      exchange: { currency: "XRP" },
      total: `${day * 1000}.5`,
      exchange_rate: "1.0000000",
      start_time: `${start}T00:00:00Z`,
      end_time: `${new Date(at + 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`,
    });
  }
  return rows;
}
const historyOf = (rows: AmmVolumeRow[]): Page<"rows", AmmVolumeRow> => ({ result: "success", count: rows.length, rows });

/** A page of the list with the one pool the board is built around, and everything answering. */
function inputOf(over: Partial<AmmListInput> = {}): AmmListInput {
  return {
    net: XRPL,
    asset: null,
    deleted: false,
    back: [],
    last: fulfilled(LAST),
    pools: fulfilled(ammPoolsSample({ marker: AMM_MARKER, count: 1, pools: [xrpRlusd()] })),
    live: fulfilled(liveOf([component()])),
    history: fulfilled(historyOf(daysOf("2026-09-18", "2026-10-16"))),
    ...over,
  };
}

/** The built page and its problems, with the table's state checked. */
function listed(over: Partial<AmmListInput> = {}) {
  const built = ammListPage(inputOf(over));
  return { ...built, pools: built.page.pools };
}

function rowsOf(over: Partial<AmmListInput> = {}) {
  const { pools } = listed(over);
  if (pools.state !== "ok") throw new Error(`the table is ${pools.state}`);
  return pools.rows;
}

function totalsOf(page: AmmListPageData) {
  if (page.totals.state !== "ok") throw new Error("the totals failed");
  return page.totals;
}

function chartOf(page: AmmListPageData) {
  if (page.chart.state !== "ok") throw new Error("the chart failed");
  return page.chart;
}

// ---- The words every AMM builder shares ----------------------------------------------------------------------------------------------------------

describe("displayPair", () => {
  it("shows RLUSD/XRP, as it is stored, the other way round: XRP / RLUSD, with the stored counter first", () => {
    expect(displayPair(rlusd, xrp, "XRP")).toEqual({ first: xrp, second: rlusd, flipped: true, text: "XRP / RLUSD", slug: "XRP/RLUSD" });
  });

  it("shows RLUSD/USDC, as it is stored (RLUSD sorts first), as USDC / RLUSD (P35: the better quote is the counter)", () => {
    const usdc: Asset = { currency: USDC, issuer: USDC_ISSUER };
    expect(displayPair(rlusd, usdc, "XRP")).toEqual({ first: usdc, second: rlusd, flipped: true, text: "USDC / RLUSD", slug: "USDC/RLUSD" });
  });

  it("leaves a pair that is stored in its natural order as it is", () => {
    const eur: Asset = { currency: "EUR", issuer: AMM_OTHER };
    const usd: Asset = { currency: "USD", issuer: AMM_ISSUER };
    expect(displayPair(eur, usd, "XRP")).toEqual({ first: eur, second: usd, flipped: false, text: "EUR / USD", slug: "EUR/USD" });
  });

  it("shows a token with no text as the hex formatCurrency writes, and an unranked token against XRP with XRP as the counter", () => {
    const vox: Asset = { currency: VOX, issuer: VOX_ISSUER };
    expect(displayPair(vox, xrp, "XRP")).toEqual({ first: vox, second: xrp, flipped: false, text: "564F58F0… / XRP", slug: "564F58F0…/XRP" });
  });

  it("is E3's natural orientation, whichever way the pair is given", () => {
    // Every pair of the ranked quotes, both ways round, against the one function the whole program orders a pair with.
    const hexOf = (code: string): string => [...code].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase().padEnd(40, "0");
    const quotes = QUOTE_RANK.map((code): Asset => ({ currency: code.length === 3 ? code : hexOf(code), issuer: RL }));
    for (const a of [xrp, ...quotes]) {
      for (const b of [xrp, ...quotes]) {
        if (a === b) continue;
        const shown = displayPair(a, b, "XRP");
        const natural = naturalOrientation(a, b, "XRP");
        expect(shown.first).toBe(natural.base);
        expect(shown.second).toBe(natural.counter);
        expect(shown.flipped).toBe(natural.inverted);
      }
    }
  });
});

describe("feePercent", () => {
  it.each([
    [300, "0.300%"],
    [1000, "1.000%"],
    [22, "0.022%"],
    [0, "0.000%"],
    [1, "0.001%"],
    [205, "0.205%"],
  ])("writes %d units of 1/100000 as %s", (units, text) => {
    expect(feePercent(units)).toBe(text);
  });
});

describe("NOT_COMPUTED_NOTE", () => {
  it("is the one sentence of the cards that read the pool's day rows", () => {
    expect(NOT_COMPUTED_NOTE).toBe("A day without rows may not be computed yet.");
  });
});

// ---- The list ---------------------------------------------------------------------------------------------------------------------------------------

describe("the list: a row of the table", () => {
  it("links the pair to the pool's page, and writes the short account and each issued asset under it", () => {
    const [row] = rowsOf();
    expect(row).toMatchObject({
      key: AMM_POOL,
      pair: "XRP / RLUSD",
      coins: ["XRP", "RLUSD"],
      href: "/xrpl/amm/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3",
      detail: "rhWTXC…tcS3 · RLUSD rMxCKb…m5De",
      deleted: false,
    });
  });

  it("writes each issued side of a pair of two tokens, in display order, whichever way the pool is stored", () => {
    const [row] = rowsOf({
      pools: fulfilled(ammPoolsSample({ pools: [ammPoolSample({ base_currency: RLUSD, base_issuer: RL, counter_currency: USDC, counter_issuer: USDC_ISSUER })] })),
    });
    expect(row!.pair).toBe("USDC / RLUSD");
    expect(row!.detail).toBe("rhWTXC…tcS3 · USDC rGm7WC…uWhE · RLUSD rMxCKb…m5De");
    // Stored RLUSD/USDC: the sample's base reserve (1250.5) is the RLUSD's, its counter reserve (2500) the USDC's, which is shown first.
    expect(row!.reserves).toEqual(["2,500 USDC", "1,250.5 RLUSD"]);
  });

  describe("Value", () => {
    it("is the value, compact", () => {
      expect(rowsOf()[0]!.value).toBe("3.61M");
    });

    it("is a dash when the API left the value out", () => {
      expect(rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ value_native: undefined })] })) })[0]!.value).toBe("—");
    });

    it("is a dash for a deleted pool, which has the Deleted tag, whatever the API said", () => {
      const [row] = rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ deleted: true, value_native: "12.5" })] })) });
      expect(row).toMatchObject({ deleted: true, value: "—" });
    });
  });

  describe("Reserves", () => {
    it("are in display order, each with its currency: a pool stored RLUSD/XRP shows the XRP first", () => {
      expect(rowsOf()[0]!.reserves).toEqual(["1.85M XRP", "2.42M RLUSD"]);
    });

    it("are in the stored order for a pool stored the way it is displayed", () => {
      const eur = { base_currency: "EUR", base_issuer: AMM_OTHER, counter_currency: "USD", counter_issuer: AMM_ISSUER };
      const [row] = rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [ammPoolSample({ ...eur, reserve_base: "1200", reserve_counter: "1300.25" })] })) });
      expect(row!.reserves).toEqual(["1,200 EUR", "1,300.25 USD"]);
    });

    it("are a dash for the reserve the index does not know, and only for it", () => {
      expect(rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ reserve_base: undefined })] })) })[0]!.reserves).toEqual(["1.85M XRP", "—"]);
      expect(rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ reserve_counter: undefined })] })) })[0]!.reserves).toEqual(["—", "2.42M RLUSD"]);
    });

    it("write an amount the API wrote in exponent form in plain digits", () => {
      const [row] = rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ reserve_base: "1.5e-7", reserve_counter: "1.5e+7" })] })) });
      expect(row!.reserves).toEqual(["15M XRP", "0.00000015 RLUSD"]);
    });
  });

  describe("Fee", () => {
    it("is the trading fee as a percent with three decimals", () => {
      expect(rowsOf()[0]!.fee).toBe("0.205%");
    });

    it("is a dash without a trading fee, and 0.000% for a known fee of 0", () => {
      expect(rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ trading_fee: undefined })] })) })[0]!.fee).toBe("—");
      expect(rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ trading_fee: 0 })] })) })[0]!.fee).toBe("0.000%");
    });
  });

  describe("Volume 24 h: the join with the live set, by the pool's account", () => {
    it("is the component's converted amount, compact", () => {
      expect(rowsOf()[0]!.volume).toBe("543K");
    });

    it("joins a component whose pair is turned round (the native currency first), by the account alone", () => {
      const turned = component({ base: xrp, counter: rlusd });
      expect(rowsOf({ live: fulfilled(liveOf([turned])) })[0]!.volume).toBe("543K");
    });

    it("joins each pool to its own component", () => {
      const other = ammPoolSample({ amm_account: AMM_HOLDER, base_currency: "USD", base_issuer: AMM_ISSUER, counter_currency: "XRP" });
      const rows = rowsOf({
        pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd(), other] })),
        live: fulfilled(liveOf([component({ amm_account: AMM_HOLDER, converted_amount: "1234.5" }), component()])),
      });
      expect(rows.map((row) => row.volume)).toEqual(["543K", "1,234.5"]);
    });

    it('is "0" for a pool with no component that holds the native currency: such a pool always converts', () => {
      expect(rowsOf({ live: fulfilled(liveOf([])) })[0]!.volume).toBe("0");
    });

    it('is a dash for a pool with no component that does not hold it: its swaps may not have been priced', () => {
      const [row] = rowsOf({
        pools: fulfilled(ammPoolsSample({ pools: [ammPoolSample({ base_currency: RLUSD, base_issuer: RL, counter_currency: USDC, counter_issuer: USDC_ISSUER })] })),
        live: fulfilled(liveOf([])),
      });
      expect(row!.volume).toBe("—");
    });

    it("does not take an issued XAH for the native currency of XRPL", () => {
      const [row] = rowsOf({
        pools: fulfilled(ammPoolsSample({ pools: [ammPoolSample({ base_currency: "XAH", base_issuer: AMM_ISSUER, counter_currency: "USD", counter_issuer: AMM_OTHER })] })),
        live: fulfilled(liveOf([])),
      });
      expect(row!.volume).toBe("—");
    });

    it("is a dash for every pool when the live set failed", () => {
      expect(rowsOf({ live: rejected(new TooLate()) })[0]!.volume).toBe("—");
    });
  });

  describe("Auction slot", () => {
    const slot = (over: Partial<NonNullable<AmmPool["auction_slot"]>> | null, input: Partial<AmmListInput> = {}) =>
      rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ auction_slot: over === null ? undefined : { holder: AMM_HOLDER, ...over } })] })), ...input })[0]!.slot;

    const HELD = { text: "rPT1Sj…pAYe", href: "/xrpl/account/rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe" };
    const OPEN = { text: "Open", href: null };

    it("is the holder, short, linking its account, while the expiration is after the live set's end", () => {
      expect(slot({ expiration: "2026-10-17T17:01:01Z" })).toEqual(HELD);
    });

    it("is Open when the expiration is the live set's end: equal is not after", () => {
      expect(slot({ expiration: LIVE_END })).toEqual(OPEN);
    });

    it("is Open when the expiration is before the live set's end", () => {
      expect(slot({ expiration: "2026-03-02T17:05:00Z" })).toEqual(OPEN);
    });

    it("is Open when there is no holder, and when there is no slot", () => {
      expect(slot({ holder: undefined, expiration: "2027-01-01T00:00:00Z" })).toEqual(OPEN);
      expect(slot(null)).toEqual(OPEN);
    });

    it("compares with the live set's end while it has one, not with the newest ledger's close time or the clock", () => {
      // The newest ledger closed at 17:01:12, 12 s after the live set's end: an expiration between the two is held by the live set's "now".
      expect(slot({ expiration: "2026-10-17T17:01:05Z" })).toEqual(HELD);
      expect(slot({ expiration: "2026-10-17T17:01:05Z" }, { live: rejected(new TooLate()) })).toEqual(OPEN);
    });

    it("takes the close time of the newest ledger for the time when the live set failed", () => {
      const live = { live: rejected(new TooLate()) };
      expect(slot({ expiration: "2026-10-17T17:01:13Z" }, live)).toEqual(HELD);
      expect(slot({ expiration: "2026-10-17T17:01:12Z" }, live)).toEqual(OPEN);
      expect(slot({ expiration: "2026-10-17T17:01:11Z" }, live)).toEqual(OPEN);
    });

    it("is a dash for a held slot when there is no time at all: the live set and the newest ledger both failed", () => {
      const neither = { live: rejected(new TooLate()), last: rejected(new TooLate()), history: null };
      expect(slot({ expiration: "2026-10-17T17:01:13Z" }, neither)).toEqual({ text: "—", href: null });
    });

    it("is still Open without a holder when there is no time at all: nobody holds it", () => {
      const neither = { live: rejected(new TooLate()), last: rejected(new TooLate()), history: null };
      expect(slot(null, neither)).toEqual(OPEN);
    });

    it("shows a holder with no expiration as the holder: the index has no time to compare", () => {
      expect(slot({})).toEqual(HELD);
    });
  });

  describe("Created", () => {
    it("is the creation ledger, grouped, linking the ledger", () => {
      const [row] = rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ created_ledger: 86800123 })] })) });
      expect(row!.created).toEqual({ text: "#86,800,123", href: "/xrpl/ledger/86800123" });
    });

    it("is a dash when the index did not ingest the creation", () => {
      const [row] = rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ created_ledger: undefined })] })) });
      expect(row!.created).toEqual({ text: "—", href: null });
    });
  });

  it("keeps the API's order, which is by value", () => {
    const pools = [xrpRlusd(), xrpRlusd({ amm_account: AMM_HOLDER }), xrpRlusd({ amm_account: AMM_OTHER })];
    expect(rowsOf({ pools: fulfilled(ammPoolsSample({ pools })) }).map((row) => row.key)).toEqual([AMM_POOL, AMM_HOLDER, AMM_OTHER]);
  });
});

describe("the list: the totals", () => {
  it("are the live row's total in the native currency, the number of pools with swaps, and the busiest pool", () => {
    const { page } = ammListPage(inputOf({ live: fulfilled(liveOf([component(), component({ amm_account: AMM_HOLDER, converted_amount: "1000" }), component({ amm_account: AMM_OTHER })])) }));
    expect(totalsOf(page).tiles).toEqual([
      { label: "Swap volume, 24 h", value: "893K XRP", sub: "1,284 swaps", href: null },
      { label: "Pools with swaps, 24 h", value: "3", sub: "that could be priced in XRP", href: null },
      { label: "Busiest pool, 24 h", value: "XRP / RLUSD", sub: "543K XRP of swaps", href: "/xrpl/amm/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3" },
    ]);
    expect(totalsOf(page).note).toBe("As of 17:01 UTC.");
  });

  it("name the busiest pool in the display orientation, from the component's own pair", () => {
    const turned = component({ base: xrp, counter: rlusd });
    expect(totalsOf(ammListPage(inputOf({ live: fulfilled(liveOf([turned])) })).page).tiles[2]).toMatchObject({ value: "XRP / RLUSD" });
  });

  it("say so when nothing was swapped: a dash for the busiest pool, and why", () => {
    const { page } = ammListPage(inputOf({ live: fulfilled(liveOf([], { count: 0, total: "0" })) }));
    expect(totalsOf(page).tiles).toEqual([
      { label: "Swap volume, 24 h", value: "0 XRP", sub: "0 swaps", href: null },
      { label: "Pools with swaps, 24 h", value: "0", sub: "that could be priced in XRP", href: null },
      { label: "Busiest pool, 24 h", value: "—", sub: "no swaps in the last 24 hours", href: null },
    ]);
  });

  it("count one swap in the singular", () => {
    expect(totalsOf(ammListPage(inputOf({ live: fulfilled(liveOf([component()], { count: 1 })) })).page).tiles[0]!.sub).toBe("1 swap");
  });

  it("write the time of the live set's end in UTC", () => {
    const { page } = ammListPage(inputOf({ live: fulfilled(liveOf([component()], { end_time: "2026-10-17T09:05:59Z" })) }));
    expect(totalsOf(page).note).toBe("As of 09:05 UTC.");
  });
});

describe("the list: the chart", () => {
  it("is E2's 30 days up to the UTC day of the newest ledger, the running day marked so far and not yet computed", () => {
    const { page } = ammListPage(inputOf());
    const chart = chartOf(page);
    const { data } = chart;
    expect(data.axis.unit).toBe("day");
    expect(data.axis.buckets).toHaveLength(30);
    expect(data.axis.buckets[0]).toBe("2026-09-18");
    expect(data.axis.buckets.at(-1)).toBe("2026-10-17");
    expect(data.forming).toBe(true);
    expect(data.pending).toBe(1);
    expect(chart.note).toBe("Oct 17 is not computed yet.");
    expect(data.format).toEqual({ kind: "amount", unit: "XRP" });
    expect(chart.title).toBe("AMM swap volume per day, in XRP, last 30 days");
    expect(chart.source).toBe("/v2/network/amm_volume?interval=day");
  });

  it("has a value for each day with a row, and none for the day that has not one", () => {
    const { data } = chartOf(ammListPage(inputOf()).page);
    const [series] = data.series;
    expect(series!.values).toHaveLength(30);
    expect(series!.values[0]).toBe("18000.5");
    expect(series!.values[28]).toBe("16000.5");
    expect(series!.values[29]).toBeNull();
  });

  it('has the extra "Swaps": the row\'s count as text, and none where there is no row', () => {
    const { data } = chartOf(ammListPage(inputOf()).page);
    expect(data.extras).toEqual([
      { id: "swaps", label: "Swaps", values: expect.any(Array), format: { kind: "count" } },
    ]);
    const values = data.extras![0]!.values;
    expect(values).toHaveLength(30);
    expect(values[0]).toBe("36");
    expect(values[28]).toBe("32");
    expect(values[29]).toBeNull();
    expect(values.every((value) => value === null || typeof value === "string")).toBe(true);
  });

  it("counts the two newest days as pending when neither has a row, and names both", () => {
    const { page } = ammListPage(inputOf({ history: fulfilled(historyOf(daysOf("2026-09-18", "2026-10-15"))) }));
    const chart = chartOf(page);
    expect(chart.data.pending).toBe(2);
    expect(chart.note).toBe("Oct 16 and Oct 17 are not computed yet.");
  });

  it("counts a hole further back as no value and not as pending", () => {
    const rows = daysOf("2026-09-18", "2026-10-16").filter((row) => row.start_time !== "2026-10-05T00:00:00Z");
    const chart = chartOf(ammListPage(inputOf({ history: fulfilled(historyOf(rows)) })).page);
    expect(chart.data.pending).toBe(1);
    expect(chart.data.series[0]!.values[17]).toBeNull();
    expect(chart.data.extras![0]!.values[17]).toBeNull();
  });

  it("has no pending day when the running day has its row", () => {
    const chart = chartOf(ammListPage(inputOf({ history: fulfilled(historyOf(daysOf("2026-09-18", "2026-10-17"))) })).page);
    expect(chart.data.pending).toBe(0);
    expect(chart.note).toBeNull();
  });

  it("is anchored on the day of the newest ledger, not on the live set", () => {
    const last = { ...LAST, close_time: "2026-10-18T00:00:05Z" };
    const chart = chartOf(ammListPage(inputOf({ last: fulfilled(last), history: fulfilled(historyOf(daysOf("2026-09-19", "2026-10-17"))) })).page);
    expect(chart.data.axis.buckets[0]).toBe("2026-09-19");
    expect(chart.data.axis.buckets.at(-1)).toBe("2026-10-18");
    expect(chart.data.pending).toBe(1);
  });

  it("carries a token that covers the extras and the words", () => {
    const base = chartOf(ammListPage(inputOf()).page).data;
    const changed = daysOf("2026-09-18", "2026-10-16").map((row, at) => (at === 3 ? { ...row, count: row.count + 1 } : row));
    const other = chartOf(ammListPage(inputOf({ history: fulfilled(historyOf(changed)) })).page).data;
    expect(base.token).toMatch(/^[0-9a-f]{8}$/);
    expect(other.token).not.toBe(base.token);
    expect(chartOf(ammListPage(inputOf()).page).data.token).toBe(base.token);
  });
});

describe("the list: paging and the words under the table", () => {
  const RLUSD_URL = `RLUSD.${RL}`;
  const asset = { asset: rlusd, text: RLUSD_URL };

  it("is the next marker as the Older link on the first page, and no Newer", () => {
    const { pools } = listed();
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.paging).toEqual({ newerHref: null, olderHref: `/xrpl/amm?marker=${AMM_MARKER}` });
  });

  it("keeps the asset and the deleted pools in the links", () => {
    const { pools } = listed({ asset, deleted: true });
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.paging.olderHref).toBe(`/xrpl/amm?asset=${RLUSD_URL}&deleted=1&marker=${AMM_MARKER}`);
  });

  it("goes back to the page before through the trail, and further on with the page it was reached from added to it", () => {
    const { pools } = listed({ asset, deleted: true, marker: "MARKER2", back: ["MARKER1", "MARKER0"] });
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.paging).toEqual({
      newerHref: `/xrpl/amm?asset=${RLUSD_URL}&deleted=1&marker=MARKER1&back=MARKER0`,
      olderHref: `/xrpl/amm?asset=${RLUSD_URL}&deleted=1&marker=${AMM_MARKER}&back=MARKER2.MARKER1.MARKER0`,
    });
  });

  it("goes back to the first page from the second", () => {
    const { pools } = listed({ asset, marker: "MARKER1", back: [] });
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.paging.newerHref).toBe(`/xrpl/amm?asset=${RLUSD_URL}`);
  });

  it("has no Older link on the last page", () => {
    const { pools } = listed({ pools: fulfilled(ammPoolsSample({ marker: undefined, pools: [xrpRlusd()] })) });
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.paging.olderHref).toBeNull();
  });

  it("says in the footnote what Value is and, with the live set, what Volume 24 h is and as of when", () => {
    const { pools } = listed();
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.footnote).toBe(
      "Value is twice the XRP reserve, or twice a reserve at its daily XRP rate. Volume 24 h is the swap volume of the last 24 hours in XRP, as of 17:01 UTC.",
    );
    expect(pools.note).toBeNull();
    expect(pools.source).toBe("/v2/amm/pools · ordered by value");
  });

  it("says in the footnote only what Value is, without the live set, and the card says it could not load the 24-hour volume", () => {
    const { pools } = listed({ live: rejected(new TooLate()) });
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.footnote).toBe("Value is twice the XRP reserve, or twice a reserve at its daily XRP rate.");
    expect(pools.note).toBe(NO_VOLUME_NOTE);
  });

  it("says which asset has no pools for an empty page of a filter", () => {
    const { pools } = listed({ asset, pools: fulfilled(ammPoolsSample({ marker: undefined, count: 0, pools: [] })) });
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.rows).toEqual([]);
    expect(pools.empty).toBe("No pools have RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.");
  });

  it("has no empty message for a page with rows", () => {
    const { pools } = listed();
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.empty).toBeNull();
  });

  it("says there are no pools to show for an empty page without a filter", () => {
    const { pools } = listed({ pools: fulfilled(ammPoolsSample({ marker: undefined, count: 0, pools: [] })) });
    if (pools.state !== "ok") throw new Error("failed");
    expect(pools.empty).toBe("No pools to show.");
  });
});

describe("the list: the filter and the facts of its tags", () => {
  const RLUSD_URL = `RLUSD.${RL}`;

  it("holds the asset in its URL form and whether the deleted pools are included", () => {
    const { page } = ammListPage(inputOf({ asset: { asset: rlusd, text: RLUSD_URL }, deleted: true }));
    expect(page.filter).toEqual({ value: RLUSD_URL, deleted: true });
    expect(page.meta).toEqual({ assetLabel: "RLUSD", deleted: true, more: false, error: false });
  });

  it("is empty without an asset", () => {
    const { page } = ammListPage(inputOf());
    expect(page.filter).toEqual({ value: "", deleted: false });
    expect(page.meta).toEqual({ deleted: false, more: false, error: false });
  });

  it("names the native currency by its code", () => {
    expect(ammListPage(inputOf({ asset: { asset: xrp, text: "XRP" } })).page.meta.assetLabel).toBe("XRP");
  });

  it("says a page behind a marker is one", () => {
    expect(ammListPage(inputOf({ marker: AMM_MARKER })).page.meta.more).toBe(true);
  });

  it("is the page of an asset that does not parse: what was typed, the message, no pools and no call for them, and the rest of the page", () => {
    const { page, problems } = ammListPage(inputOf({ asset: { error: "RLUSD rubbish" }, pools: null }));
    expect(page.filter).toEqual({ value: "RLUSD rubbish", deleted: false, error: "Write an asset as XRP, or as a currency and its issuer: RLUSD.rMxCK…" });
    expect(page.meta).toEqual({ deleted: false, more: false, error: true });
    expect(page.pools).toEqual({ state: "skipped" });
    expect(page.totals.state).toBe("ok");
    expect(page.chart.state).toBe("ok");
    expect(problems).toEqual([]);
  });

  it("cuts what was typed to 200 characters, in characters and not in halves of a pair", () => {
    const { page } = ammListPage(inputOf({ asset: { error: "\u{1F5FD}".repeat(300) }, pools: null }));
    expect([...page.filter.value]).toHaveLength(200);
    expect(page.filter.value).toBe("\u{1F5FD}".repeat(200));
  });

  it("names the page and the native currency", () => {
    const { page } = ammListPage(inputOf());
    expect(page).toMatchObject({ kind: "list", net: "xrpl", native: "XRP" });
  });
});

describe("the list: what failed", () => {
  it("fails the table alone when the pools call was rejected, and says why in a problem", () => {
    const { page, problems } = ammListPage(inputOf({ pools: rejected(new TooLate()) }));
    expect(page.pools).toEqual({ state: "failed", what: "the pools" });
    expect(page.totals.state).toBe("ok");
    expect(page.chart.state).toBe("ok");
    expect(problems).toEqual(["the pools: took too long"]);
  });

  it("fails the totals alone when the live set was rejected, and the Volume column and the card say so", () => {
    const { page, problems } = ammListPage(inputOf({ live: rejected(new Error("data API GET /v2/network/amm_volume answered 503")) }));
    expect(page.totals).toEqual(TOTALS_FAILED);
    expect(page.chart.state).toBe("ok");
    expect(page.pools).toMatchObject({ state: "ok", note: NO_VOLUME_NOTE });
    expect(rowsOf({ live: rejected(new Error("x")) }).map((row) => row.volume)).toEqual(["—"]);
    expect(problems).toEqual(["the 24-hour volume: data API GET /v2/network/amm_volume answered 503"]);
  });

  it("fails the chart alone when the newest ledger was rejected, whatever history is", () => {
    const { page, problems } = ammListPage(inputOf({ last: rejected(new TooLate()), history: null }));
    expect(page.chart).toEqual({ state: "failed", what: "the swap volume" });
    expect(page.totals.state).toBe("ok");
    expect(page.pools.state).toBe("ok");
    expect(problems).toEqual(["the swap volume: took too long"]);
  });

  it("fails the chart alone when the history was rejected", () => {
    const { page, problems } = ammListPage(inputOf({ history: rejected(new TooLate()) }));
    expect(page.chart).toEqual({ state: "failed", what: "the swap volume" });
    expect(page.totals.state).toBe("ok");
    expect(problems).toEqual(["the swap volume: took too long"]);
  });

  it("fails the chart when the newest ledger has a close time no day can be worked out of, and says so without throwing", () => {
    const { page, problems } = ammListPage(inputOf({ last: fulfilled({ ...LAST, close_time: "yesterday" }) }));
    expect(page.chart).toEqual({ state: "failed", what: "the swap volume" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^the swap volume: /);
  });

  it("fails the totals when the live row has no time, and does not use that row for the column either", () => {
    const { page, problems } = ammListPage(inputOf({ live: fulfilled(liveOf([component()], { end_time: "soon" })) }));
    expect(page.totals).toEqual(TOTALS_FAILED);
    expect(page.pools).toMatchObject({ state: "ok", note: NO_VOLUME_NOTE });
    expect(problems).toHaveLength(1);
  });

  it("fails the totals when the live set has no row", () => {
    const empty: Page<"rows", AmmVolumeRow> = { result: "success", count: 0, rows: [] };
    const { page, problems } = ammListPage(inputOf({ live: fulfilled(empty) }));
    expect(page.totals).toEqual(TOTALS_FAILED);
    expect(problems).toEqual(["the 24-hour volume: the data API answered no row"]);
  });

  describe("an answer that is not what the data API promises is a failed card, never a throw", () => {
    /** A pool whose slot is held until just after the newest ledger closed (17:01:12): held by the ledger's close time, as the live set is not there. */
    const held = (over: Partial<AmmListInput> = {}) =>
      rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ auction_slot: { holder: AMM_HOLDER, expiration: "2026-10-17T17:01:13Z" } })] })), ...over })[0]!;
    const HELD = { text: "rPT1Sj…pAYe", href: "/xrpl/account/rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe" };

    it.each([
      ["has no rows at all", { result: "success", count: 0 }],
      ["is null", null],
      ["has rows that are not a list", { result: "success", count: 1, rows: {} }],
      ["has a row with no components", { result: "success", count: 1, rows: [{ end_time: LIVE_END, total: "1", count: 1 }] }],
      ["has a row that is null", { result: "success", count: 1, rows: [null] }],
    ])("fails the totals when the live answer %s, with a problem, and the table and the chart stand", (_what, answer) => {
      const live = fulfilled(answer as unknown as Page<"rows", AmmVolumeRow>);
      const { page, problems } = ammListPage(inputOf({ live }));
      expect(page.totals).toEqual(TOTALS_FAILED);
      expect(page.pools).toMatchObject({ state: "ok", note: NO_VOLUME_NOTE });
      expect(page.chart.state).toBe("ok");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^the 24-hour volume: /);
      // No live set: the Volume column is a dash, and the slot is read against the newest ledger's close time.
      const row = held({ live });
      expect(row.volume).toBe("—");
      expect(row.slot).toEqual(HELD);
    });

    it.each([
      ["is null", null],
      ["has no close time", { result: "success", ledger_index: "1" }],
    ])("fails the chart when the newest ledger %s, and the rest stands with the live set's time", (_what, answer) => {
      const last = fulfilled(answer as unknown as LastValidated);
      const { page, problems } = ammListPage(inputOf({ last }));
      expect(page.chart).toEqual({ state: "failed", what: "the swap volume" });
      expect(page.totals.state).toBe("ok");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^the swap volume: /);
      // The live set's end (17:01:00) is before the expiration, which the missing ledger does not change.
      expect(held({ last }).slot).toEqual(HELD);
    });

    it("has no time at all when the newest ledger and the live set both failed, and still stands", () => {
      const neither = { last: rejected(new TooLate()), live: rejected(new TooLate()), history: null };
      const { page, problems } = ammListPage(inputOf(neither));
      expect(page).toMatchObject({ kind: "list", totals: TOTALS_FAILED, chart: { state: "failed", what: "the swap volume" }, pools: { state: "ok", note: NO_VOLUME_NOTE } });
      expect(problems).toEqual(["the 24-hour volume: took too long", "the swap volume: took too long"]);
      expect(held(neither)).toMatchObject({ volume: "—", slot: { text: "—", href: null } });
    });

    it("has no time at all when the live set failed and the newest ledger is null, and still stands", () => {
      const neither = { last: fulfilled(null as unknown as LastValidated), live: rejected(new TooLate()), history: null };
      expect(held(neither).slot).toEqual({ text: "—", href: null });
      expect(ammListPage(inputOf(neither)).page.pools.state).toBe("ok");
    });
  });

  it("keeps the problems in the order of the page, one for each failed card, and the page still stands", () => {
    const everything = ammListPage(
      inputOf({ pools: rejected(new TooLate()), live: rejected(new TooLate()), last: rejected(new TooLate()), history: null }),
    );
    expect(everything.problems).toEqual(["the 24-hour volume: took too long", "the swap volume: took too long", "the pools: took too long"]);
    expect(everything.page).toMatchObject({
      kind: "list",
      totals: { state: "failed" },
      chart: { state: "failed" },
      pools: { state: "failed" },
    });
  });

  it("writes a reason that is not an error as text", () => {
    expect(ammListPage(inputOf({ pools: rejected("down") })).problems).toEqual(["the pools: down"]);
  });

  it("has no problem when everything answers", () => {
    expect(ammListPage(inputOf()).problems).toEqual([]);
  });

  it("never puts a reason in the page: a card says what it could not load and nothing else", () => {
    const reason = new Error("data API GET /v2/amm/pools?limit=20 answered 503: secret-text");
    expect(JSON.stringify(ammListPage(inputOf({ pools: rejected(reason) })).page)).not.toContain("secret-text");
  });
});

describe("the list: no float and no exponent reaches the page", () => {
  /** A digit, an `e` and a digit: what an exponent looks like, which no word of the page is made of (P38). */
  const EXPONENT = /\d[eE][+-]?\d/;
  /**
   * The page's text without what is an identifier and no number, which can hold a digit, an E and a digit by chance: a chart's token (8 hex digits), an
   * address (whole in a link, short in a line), the first 8 hex digits that stand for a currency with no text, and a marker.
   */
  const withoutIds = (json: string): string =>
    json
      .replace(/"token":"[0-9a-f]{8}"/g, "")
      .replace(/r[1-9A-HJ-NP-Za-km-z]{24,34}/g, "")
      .replace(/r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}/g, "")
      .replace(/[0-9A-F]{8}…/g, "")
      .replace(/marker=[\w-]+/g, "");

  it("writes amounts the API wrote in exponent form in plain digits, and passes no rate through", () => {
    const exponents = [
      component({ rate: "7.6528766e+9", converted_amount: "1.2e+21", amount: "3e-7" }),
      component({ amm_account: AMM_HOLDER, rate: "2.5e-8", converted_amount: "5e-7", amount: "1e+21" }),
    ];
    const { page } = ammListPage(
      inputOf({
        pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ reserve_base: "1.5e-7", reserve_counter: "1.2e+21", value_native: "1000000" }), xrpRlusd({ amm_account: AMM_HOLDER, reserve_base: "9e-9" })] })),
        live: fulfilled(liveOf(exponents, { total: "1.2e+21", count: 123456789 })),
      }),
    );
    expect(withoutIds(JSON.stringify(page))).not.toMatch(EXPONENT);
    expect(totalsOf(page).tiles[0]).toMatchObject({ value: "1,200,000,000T XRP", sub: "123,456,789 swaps" });
    expect(rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ reserve_base: "1.5e-7" })] })) })[0]!.reserves[1]).toBe("0.00000015 RLUSD");
  });

  it("makes every number of the page from the text of the inputs: a count is its digits, never a float", () => {
    const rows = daysOf("2026-09-18", "2026-10-16").map((row) => ({ ...row, total: "0.1234567890123456789", count: 9007199254740991 }));
    const chart = chartOf(ammListPage(inputOf({ history: fulfilled(historyOf(rows)) })).page);
    expect(chart.data.series[0]!.values[0]).toBe("0.1234567890123456789");
    expect(chart.data.extras![0]!.values[0]).toBe("9007199254740991");
    expect(withoutIds(JSON.stringify(chart))).not.toMatch(EXPONENT);
  });

  it("holds for every page of the recorded fixtures, with the live set whose rates are in exponent form", () => {
    const dir = new URL("../../test/fixtures/http/xrpl/data-api/", import.meta.url);
    const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, dir), "utf8")) as T;
    const live = json<Page<"rows", AmmVolumeRow>>("network/amm_volume@live=day.json");
    const history = json<Page<"rows", AmmVolumeRow>>("network/amm_volume@end=2026-10-17&interval=day&limit=1000&start=2026-09-18.json");
    const last = json<LastValidated>("last_validated.json");
    // The recording does have components in the form the API's toPrecision(8) writes (P38), so the test is not vacuous.
    expect(live.rows[0]!.components.filter((c) => /e[+-]/.test(c.rate))).toHaveLength(6);

    const files = readdirSync(new URL("amm/", dir)).filter((name) => name.startsWith("pools@"));
    expect(files.length).toBeGreaterThan(5);
    let pools = 0;
    for (const file of files) {
      const answer = json<Page<"pools", AmmPool>>(`amm/${file}`);
      const { page, problems } = ammListPage(inputOf({ pools: fulfilled(answer), live: fulfilled(live), history: fulfilled(history), last: fulfilled(last) }));
      expect(problems, file).toEqual([]);
      expect(withoutIds(JSON.stringify(page)), file).not.toMatch(EXPONENT);
      if (page.pools.state !== "ok") throw new Error(file);
      expect(page.pools.rows).toHaveLength(answer.pools.length);
      pools += answer.pools.length;
    }
    expect(pools).toBeGreaterThan(100);
  });
});

describe("the list: the recorded pools", () => {
  const dir = new URL("../../test/fixtures/http/xrpl/data-api/", import.meta.url);
  const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, dir), "utf8")) as T;
  const live = json<Page<"rows", AmmVolumeRow>>("network/amm_volume@live=day.json");
  const history = json<Page<"rows", AmmVolumeRow>>("network/amm_volume@end=2026-10-17&interval=day&limit=1000&start=2026-09-18.json");
  const last = json<LastValidated>("last_validated.json");
  const files = readdirSync(new URL("amm/", dir)).filter((name) => name.startsWith("pools@"));
  const all = files.flatMap((file) => json<Page<"pools", AmmPool>>(`amm/${file}`).pools);
  const rowOf = (account: string) => {
    const pool = all.find((candidate) => candidate.amm_account === account);
    if (!pool) throw new Error(`no recorded pool ${account}`);
    const rows = rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [pool] })), live: fulfilled(live), history: fulfilled(history), last: fulfilled(last) });
    return rows[0]!;
  };

  it("shows the RLUSD pool as XRP / RLUSD with the volume of its component", () => {
    const row = rowOf(AMM_POOL);
    expect(row).toMatchObject({ pair: "XRP / RLUSD", value: "3.7M", fee: "0.205%", volume: "543K" });
    expect(row.reserves).toEqual(["1.85M XRP", "2.42M RLUSD"]);
    expect(row.detail).toBe("rhWTXC…tcS3 · RLUSD rMxCKb…m5De");
  });

  it("shows the pool of two tokens, with no component and no value, with dashes", () => {
    const row = rowOf("rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb");
    expect(row.pair).toBe("USDC / RLUSD");
    expect(row).toMatchObject({ value: "—", volume: "—" });
  });

  it("shows VOX/XRP as hex with a volume of 0: it holds XRP and has no component", () => {
    const row = rowOf("rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef");
    expect(row.pair).toBe("564F58F0… / XRP");
    expect(row.volume).toBe("0");
    expect(row.value).toBe("—");
    expect(row.reserves).toEqual(["—", "—"]);
  });

  it("shows the deleted pool with its tag and no value, and empty reserves as zeros", () => {
    const row = rowOf("rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz");
    expect(row).toMatchObject({ deleted: true, value: "—", fee: "0.250%", reserves: ["0 SNK", "0 XRP"] });
  });
});

describe("noAmmPage", () => {
  it("is the explanation and the link to Xahau's markets while the markets pages are on", () => {
    expect(noAmmPage(XAHAU)).toEqual({ kind: "none", marketsHref: "/xahau/markets" });
  });

  it("has no link while the markets pages are off", () => {
    expect(noAmmPage({ ...XAHAU, features: { ...NO_FEATURES, ammPages: true } })).toEqual({ kind: "none", marketsHref: null });
  });
});

// ---- The pool's figures: prices, votes, the auction slot, the activity rows ----------------------------------------------------------------------

/** A digit, an `e` and a digit: what an exponent looks like, which no word of the page is made of (P38). */
const EXPONENT = /\d[eE][+-]?\d/;
/** The text of rows without what is an identifier and no number, which can hold a digit, an E and a digit by chance: a transaction hash, an address, a key made of them. */
const withoutHashes = (json: string): string =>
  json
    .replace(/[0-9A-F]{64}/g, "")
    .replace(/r[1-9A-HJ-NP-Za-km-z]{24,34}/g, "")
    .replace(/[0-9A-F]{8}…/g, "");

const LP_CURRENCY = `03${"AB".repeat(19)}`;
const heldSlot = (over: Partial<NonNullable<AmmInfo["auction_slot"]>> = {}): NonNullable<AmmInfo["auction_slot"]> => ({
  account: AMM_HOLDER,
  auth_accounts: [],
  discounted_fee: 22,
  expiration: 1_792_000_000,
  price: { currency: LP_CURRENCY, issuer: AMM_POOL, value: "100" },
  time_interval: 5,
  ...over,
});

describe("exactRatio", () => {
  it("divides to 8 significant digits, as plain decimal text", () => {
    expect(exactRatio("1250", "512.4")).toBe("2.4395004");
    expect(exactRatio("2", "3")).toBe("0.66666667");
    expect(exactRatio("1", "8")).toBe("0.125");
  });

  it("writes a quotient below 1e-20 in plain digits, with no exponent", () => {
    expect(exactRatio("0.001", "1000000000000000000000000")).toBe("0.000000000000000000000000001");
  });

  it("writes a quotient above 1e12 in plain digits, with no exponent", () => {
    expect(exactRatio("1000000000", "0.000001")).toBe("1000000000000000");
  });

  it("divides exactly at the extremes of an amount, and takes the exponent text the API writes", () => {
    expect(exactRatio("1e-81", "9.999999999999999e95")).toBe(`0.${"0".repeat(176)}1`);
    expect(exactRatio("1.250946e-8", "2.5e+3")).toBe(`0.${"0".repeat(11)}5003784`);
    expect(exactRatio("7.6528766e+9", "1")).toBe("7652876600");
  });

  it("has no answer for a zero or a missing divisor, or for what is not a number", () => {
    expect(exactRatio("5", "0")).toBeNull();
    expect(exactRatio("5", "0.000")).toBeNull();
    expect(exactRatio("5", undefined)).toBeNull();
    expect(exactRatio(undefined, "5")).toBeNull();
    expect(exactRatio("abc", "5")).toBeNull();
    expect(exactRatio("5", "NaN")).toBeNull();
    expect(exactRatio("5", "1e999999999")).toBeNull();
  });

  it("is 0 for a numerator of 0", () => {
    expect(exactRatio("0", "7")).toBe("0");
  });
});

describe("nextBidPrice", () => {
  it("is the minimum of an open slot: the LP supply times the fee, over 100000 and over 25, rounded up to 6 significant digits", () => {
    expect(nextBidPrice("3340945.788887548", 220, null)).toBe("294.004");
    // 1,000,000 × 500 ÷ 100,000 ÷ 25.
    expect(nextBidPrice("1000000", 500, null)).toBe("200");
  });

  it("is the price paid plus 5%, plus the minimum, in the slot's first interval", () => {
    expect(nextBidPrice("1000000", 500, { price: "100", interval: 0 })).toBe("305");
  });

  it("falls with the interval: price × 1.05 × (1 − ((n + 1) / 20)^60) + the minimum", () => {
    // 105 × (1 − 0.95^60) + 200 = 300.16267…, rounded up.
    expect(nextBidPrice("1000000", 500, { price: "100", interval: 18 })).toBe("300.163");
    // The last interval costs the minimum only.
    expect(nextBidPrice("1000000", 500, { price: "100", interval: 19 })).toBe("200");
  });

  it("is never below the minimum, and never rises from one interval to the next", () => {
    const costs = Array.from({ length: 20 }, (_, interval) => new BigNumber(nextBidPrice("1000000", 500, { price: "100", interval })));
    for (const cost of costs) expect(cost.gte(200)).toBe(true);
    for (let at = 1; at < costs.length; at += 1) expect(costs[at]!.lte(costs[at - 1]!)).toBe(true);
    // Interval 1: 105 × (1 − 0.1^60) + 200 is 305 less 1e-58, which rounds up to 305.
    expect(costs[1]!.toFixed()).toBe("305");
    // Interval 17: 105 × (1 − 0.9^60) + 200 = 304.81131…, rounded up.
    expect(costs[17]!.toFixed()).toBe("304.812");
  });

  it("rounds up, never to the nearest, so that 'at least' stays true", () => {
    // 1.000000000000196: a half-up rounding to 6 digits would say 1, which is less than the cost.
    expect(nextBidPrice("2500000.00000049", 1, null)).toBe("1.00001");
    // 3340945.788887548 × 220 ÷ 100,000 ÷ 25 = 294.0032…: nearest would say 294.003.
    expect(nextBidPrice("3340945.788887548", 220, null)).toBe("294.004");
    // What needs no rounding is as it is: 1 × 1 ÷ 100,000 ÷ 25 is 4e-7.
    expect(nextBidPrice("1", 1, null)).toBe("0.0000004");
  });

  it("is 0 where nothing is to pay, and where it cannot be worked out", () => {
    expect(nextBidPrice("3340945.788887548", 0, null)).toBe("0");
    expect(nextBidPrice("0", 220, null)).toBe("0");
    expect(nextBidPrice("not a number", 220, null)).toBe("0");
    expect(nextBidPrice("1000000", 500, { price: "not a number", interval: 3 })).toBe("0");
  });

  it("is 0 for a negative supply or fee: a cost is never a negative number", () => {
    expect(nextBidPrice("1000000", -500, null)).toBe("0");
    expect(nextBidPrice("-1000000", 500, null)).toBe("0");
    expect(nextBidPrice("1000000", Number.NaN, null)).toBe("0");
  });

  it("takes exponent text and writes plain digits", () => {
    expect(nextBidPrice("2.5e+6", 400, null)).toBe("400");
    // 400.000000105, rounded up at the 6th digit.
    expect(nextBidPrice("2.5e+6", 400, { price: "1e-7", interval: 0 })).toBe("400.001");
    expect(nextBidPrice("1e-20", 1000, null)).toBe(`0.${"0".repeat(23)}4`);
    expect(nextBidPrice("1e-20", 1000, null)).not.toMatch(EXPONENT);
  });

  it("reads an interval of 20 as an open slot", () => {
    expect(nextBidPrice("1000000", 500, { price: "100", interval: 20 })).toBe("200");
  });

  describe("against the recorded AMMBid (ledger 106084525)", () => {
    const BID = "2D66C6FD02977F96126FB352AAD691CA556790DBF71E0CDF3B701E18A49B9427";
    const RIPPLE_EPOCH_DAY = 86_400;
    const INTERVAL_SECONDS = 4_320;

    /** The AMM entry of the transaction's metadata: the slot as it was, and the pool's fee and supply. */
    function recorded() {
      const { meta, closeTime } = loadTx("xrpl-amm", BID);
      const node = meta.AffectedNodes.flatMap((affected) => ("ModifiedNode" in affected ? [affected.ModifiedNode] : [])).find((body) => body.LedgerEntryType === "AMM");
      if (node?.FinalFields === undefined || node.PreviousFields === undefined) throw new Error("the recorded AMMBid has no AMM node");
      const before = node.PreviousFields as { AuctionSlot: { Expiration: number; Price: { value: string } }; LPTokenBalance: { value: string } };
      const after = node.FinalFields as { TradingFee: number; AuctionSlot: { Price: { value: string } } };
      return { closeTime, before, after };
    }

    it("costs at most what the bid paid, from the pool as it was before the bid", () => {
      const { closeTime, before, after } = recorded();
      expect(after.AuctionSlot.Price.value).toBe("294.354152174");
      // The slot before it had run out: its interval is 20 or more, which is an open slot.
      const interval = Math.floor((closeTime - (before.AuctionSlot.Expiration - RIPPLE_EPOCH_DAY)) / INTERVAL_SECONDS);
      expect(interval).toBeGreaterThanOrEqual(20);
      const cost = nextBidPrice(before.LPTokenBalance.value, after.TradingFee, interval >= 20 ? null : { price: before.AuctionSlot.Price.value, interval });
      expect(cost).toBe("294.004");
      expect(new BigNumber(cost).lte(after.AuctionSlot.Price.value)).toBe(true);
    });

    it("would cost more than the bid paid if the slot before it had still been running its first interval: the formula reads the slot", () => {
      const { before, after } = recorded();
      const held = nextBidPrice(before.LPTokenBalance.value, after.TradingFee, { price: before.AuctionSlot.Price.value, interval: 0 });
      expect(new BigNumber(held).gt(after.AuctionSlot.Price.value)).toBe(true);
    });
  });
});

describe("slotInterval", () => {
  it("is the interval of a held slot, 0 to 19", () => {
    expect(slotInterval(heldSlot({ time_interval: 0 }))).toBe(0);
    expect(slotInterval(heldSlot({ time_interval: 13 }))).toBe(13);
    expect(slotInterval(heldSlot({ time_interval: 19 }))).toBe(19);
  });

  it("is null for an open slot: interval 20, no slot, or a slot with no holder", () => {
    expect(slotInterval(heldSlot({ time_interval: 20 }))).toBeNull();
    expect(slotInterval(undefined)).toBeNull();
    const { account: _holder, ...noHolder } = heldSlot({ time_interval: 3 });
    expect(slotInterval(noHolder)).toBeNull();
  });

  it("says 'Interval {n + 1} of 20'", () => {
    expect(intervalText(13)).toBe("Interval 14 of 20");
    expect(intervalText(0)).toBe("Interval 1 of 20");
    expect(intervalText(19)).toBe("Interval 20 of 20");
  });
});

describe("voteShares", () => {
  const vote = (account: string, trading_fee: number, vote_weight: number) => ({ account, trading_fee, vote_weight });

  it("shows each weight, in units of 1/100000 of the LP tokens, as a whole percent, and '<1%' below one half", () => {
    const { items } = voteShares([vote(AMM_ACCOUNT, 250, 21400), vote(AMM_HOLDER, 300, 400), vote(AMM_OTHER, 400, 500)], "xrpl");
    expect(items.map((item) => [item.id, item.share])).toEqual([
      [AMM_ACCOUNT, "21%"],
      [AMM_OTHER, "1%"],
      [AMM_HOLDER, "<1%"],
    ]);
  });

  it("gives each item the exact percent as its value, the short account, what it votes for, and the account's page", () => {
    const data = voteShares([vote(AMM_ACCOUNT, 250, 21400)], "xrpl");
    expect(data.items).toEqual([
      { id: AMM_ACCOUNT, label: "rGz1sP…4Y6x", sublabel: "votes for 0.250%", value: "21.4", share: "21%", href: `/xrpl/account/${AMM_ACCOUNT}` },
    ]);
    expect(data.format).toEqual({ kind: "percent", unit: "LP tokens" });
  });

  it("sorts by weight, largest first, then by account", () => {
    const accounts = [AMM_ACCOUNT, AMM_HOLDER, AMM_OTHER].sort();
    const data = voteShares([vote(accounts[2]!, 1, 100), vote(accounts[0]!, 1, 100), vote(AMM_POOL, 1, 5000), vote(accounts[1]!, 1, 100)], "xrpl");
    expect(data.items.map((item) => item.id)).toEqual([AMM_POOL, accounts[0], accounts[1], accounts[2]]);
  });

  it("writes the value exactly, to the thousandth", () => {
    const { items } = voteShares([vote(AMM_ACCOUNT, 10, 4320), vote(AMM_HOLDER, 10, 1), vote(AMM_OTHER, 10, 0)], "xahau");
    expect(items.map((item) => item.value)).toEqual(["4.32", "0.001", "0"]);
    expect(items.map((item) => item.share)).toEqual(["4%", "<1%", "<1%"]);
    expect(items[0]!.href).toBe(`/xahau/account/${AMM_ACCOUNT}`);
  });

  it("has no items for no votes, and a token that follows the data", () => {
    const none = voteShares([], "xrpl");
    expect(none.items).toEqual([]);
    expect(none.token).toMatch(/^[0-9a-f]{8}$/);
    const one = voteShares([vote(AMM_ACCOUNT, 250, 21400)], "xrpl");
    const other = voteShares([vote(AMM_ACCOUNT, 250, 21401)], "xrpl");
    expect(one.token).not.toBe(other.token);
    expect(one.token).toBe(voteShares([vote(AMM_ACCOUNT, 250, 21400)], "xrpl").token);
  });

  it("does not change the votes it is given", () => {
    const votes = [vote(AMM_HOLDER, 1, 1), vote(AMM_ACCOUNT, 1, 2)];
    voteShares(votes, "xrpl");
    expect(votes.map((entry) => entry.account)).toEqual([AMM_HOLDER, AMM_ACCOUNT]);
  });
});

describe("swapRows", () => {
  /** XRP / RLUSD, stored RLUSD / XRP. */
  const pair = displayPair(rlusd, xrp, "XRP");
  /** A swap of the pool, in the stored order: RLUSD is the base, XRP the counter. */
  const swap = (over: Partial<AmmSwap> = {}): AmmSwap =>
    ammSwapSample({ base_currency: RLUSD, base_issuer: RL, counter_currency: "XRP", base_amount: "1250", counter_amount: "512.4", ...over });

  it("reads a swap whose seller is the pool (base out, counter in) as XRP in, RLUSD out", () => {
    const [row] = swapRows([swap({ seller: AMM_POOL, buyer: AMM_ACCOUNT })], pair, "xrpl");
    expect(row).toMatchObject({
      direction: "XRP → RLUSD",
      into: "+512.4 XRP",
      out: "−1,250 RLUSD",
      price: formatPrice(exactRatio("1250", "512.4")!),
    });
    expect(row!.price).toBe("2.4395004");
  });

  it("reads a swap whose buyer is the pool (base in, counter out) the other way round: RLUSD in, XRP out", () => {
    const [row] = swapRows([swap({ buyer: AMM_POOL, seller: AMM_ACCOUNT })], pair, "xrpl");
    expect(row).toMatchObject({ direction: "RLUSD → XRP", into: "+1,250 RLUSD", out: "−512.4 XRP", price: "2.4395004" });
  });

  it("has the same price both ways: the second currency per the first, from the row's own amounts", () => {
    const [seller, buyer] = swapRows([swap({ seller: AMM_POOL, buyer: AMM_ACCOUNT }), swap({ buyer: AMM_POOL, seller: AMM_ACCOUNT })], pair, "xrpl");
    expect(seller!.price).toBe(buyer!.price);
  });

  it("is the row's time, hash, taker and key, `tx_hash:node_index`", () => {
    const [row] = swapRows([swap({ node_index: 9, taker: AMM_ACCOUNT, executed_time: "2026-10-17T12:00:03Z" })], pair, "xrpl");
    expect(row).toMatchObject({
      key: `${AMM_TX_HASH}:9`,
      time: Date.parse("2026-10-17T12:00:03Z") / 1000,
      hash: AMM_TX_HASH,
      taker: { address: AMM_ACCOUNT, href: `/xrpl/account/${AMM_ACCOUNT}` },
    });
  });

  it("keeps the order of the rows, and gives a swap of the same transaction against another node its own key", () => {
    const rows = swapRows([swap({ node_index: 9 }), swap({ node_index: 3 })], pair, "xrpl");
    expect(rows.map((row) => row.key)).toEqual([`${AMM_TX_HASH}:9`, `${AMM_TX_HASH}:3`]);
  });

  it("is the same for a pool stored the way it is shown: the base is the first", () => {
    const eur: Asset = { currency: "EUR", issuer: AMM_OTHER };
    const usd: Asset = { currency: "USD", issuer: AMM_ISSUER };
    const straight = displayPair(eur, usd, "XRP");
    expect(straight.flipped).toBe(false);
    const [row] = swapRows(
      [ammSwapSample({ base_currency: "EUR", base_issuer: AMM_OTHER, counter_currency: "USD", counter_issuer: AMM_ISSUER, base_amount: "100", counter_amount: "108.5", seller: AMM_POOL })],
      straight,
      "xrpl",
    );
    expect(row).toMatchObject({ direction: "USD → EUR", into: "+108.5 USD", out: "−100 EUR", price: "1.085" });
  });

  it("matches the sides by asset, not by the stored order the caller believes in", () => {
    // The caller says 'not flipped' of a pool whose rows are the other way round: the row's own currencies decide.
    const wrong = { ...pair, flipped: false };
    const [row] = swapRows([swap({ seller: AMM_POOL })], wrong, "xrpl");
    expect(row).toMatchObject({ direction: "XRP → RLUSD", into: "+512.4 XRP", out: "−1,250 RLUSD" });
  });

  it("takes the pair's own order for a row that names neither of its sides", () => {
    // A row of another pair (the caller's mistake) is still a row: the stored order the caller gave decides, and nothing throws.
    const other = ammSwapSample({ base_currency: "EUR", base_issuer: AMM_OTHER, counter_currency: "USD", counter_issuer: AMM_ISSUER, base_amount: "100", counter_amount: "50", seller: AMM_POOL });
    // Flipped, as the pair says: the first column (XRP) is the row's counter (50), and the pool is the seller, so the base (100) went out.
    expect(swapRows([other], pair, "xrpl")[0]).toMatchObject({ direction: "XRP → RLUSD", into: "+50 XRP", out: "−100 RLUSD" });
    expect(swapRows([other], { ...pair, flipped: false }, "xrpl")[0]).toMatchObject({ direction: "RLUSD → XRP", into: "+50 RLUSD", out: "−100 XRP" });
  });

  it("shows a currency with no text as hex, and an amount in exponent form in plain digits", () => {
    const vox: Asset = { currency: VOX, issuer: VOX_ISSUER };
    const shown = displayPair(vox, xrp, "XRP");
    const [row] = swapRows(
      [ammSwapSample({ base_currency: VOX, base_issuer: VOX_ISSUER, counter_currency: "XRP", base_amount: "2.5e+9", counter_amount: "1.250946e-8", seller: AMM_POOL })],
      shown,
      "xrpl",
    );
    expect(row).toMatchObject({ direction: "XRP → 564F58F0…", into: "+0.00000001250946 XRP", out: "−2,500,000,000 564F58F0…" });
    expect(withoutHashes(JSON.stringify(row))).not.toMatch(EXPONENT);
  });

  it("has a dash for a price it cannot work out, and for an amount that is no number", () => {
    const [zero, junk] = swapRows([swap({ counter_amount: "0" }), swap({ base_amount: "n/a" })], pair, "xrpl");
    expect(zero).toMatchObject({ price: "—", into: "0 XRP", out: "−1,250 RLUSD" });
    expect(junk).toMatchObject({ price: "—", out: "—" });
  });

  it("is no rows for no rows", () => {
    expect(swapRows([], pair, "xrpl")).toEqual([]);
  });
});

describe("liquidityRows", () => {
  const pair = displayPair(rlusd, xrp, "XRP");
  const event = (over: Partial<AmmLiquidityEvent> = {}): AmmLiquidityEvent => ammLiquiditySample({ base_amount: "1250", counter_amount: "512.4", lp_tokens: "800.25", ...over });

  it("maps the stored base and counter to the display columns: XRP first, RLUSD second, for a pool stored RLUSD / XRP", () => {
    const [row] = liquidityRows([event()], pair, "xrpl");
    expect(row).toMatchObject({ first: "+512.4", second: "+1,250", lpTokens: "+800.25" });
  });

  it("keeps the stored order for a pool shown the way it is stored", () => {
    const straight = displayPair({ currency: "EUR", issuer: AMM_OTHER }, { currency: "USD", issuer: AMM_ISSUER }, "XRP");
    const [row] = liquidityRows([event()], straight, "xrpl");
    expect(row).toMatchObject({ first: "+1,250", second: "+512.4" });
  });

  it("shows a deposit with a plus, a withdrawal with U+2212, and a zero plain", () => {
    const rows = liquidityRows(
      [
        event({ event: "deposit" }),
        event({ event: "withdraw", base_amount: "-1250", counter_amount: "-512.4", lp_tokens: "-800.25" }),
        event({ event: "deposit", mode: "single_asset", base_amount: "0", counter_amount: "10", lp_tokens: "0.5" }),
      ],
      pair,
      "xrpl",
    );
    expect(rows.map((row) => [row.first, row.second, row.lpTokens])).toEqual([
      ["+512.4", "+1,250", "+800.25"],
      ["−512.4", "−1,250", "−800.25"],
      ["+10", "0", "+0.5"],
    ]);
  });

  it("tags the event: Create, Deposit, Withdraw, Clawback, Delete", () => {
    const rows = liquidityRows((["create", "deposit", "withdraw", "clawback", "delete"] as const).map((kind) => event({ event: kind })), pair, "xrpl");
    expect(rows.map((row) => row.event)).toEqual(["Create", "Deposit", "Withdraw", "Clawback", "Delete"]);
  });

  it("gives the mode as served, and an empty text where the event has none", () => {
    const { mode: _mode, ...noMode } = event({ event: "create" });
    const rows = liquidityRows([event({ mode: "two_asset" }), event({ mode: "withdraw_all", event: "withdraw" }), noMode], pair, "xrpl");
    expect(rows.map((row) => row.mode)).toEqual(["two_asset", "withdraw_all", ""]);
  });

  it("names the provider, and the initiator only for a clawback", () => {
    const [deposit, clawback] = liquidityRows(
      [event({ account: AMM_ACCOUNT, initiator: AMM_ACCOUNT }), event({ event: "clawback", account: AMM_ACCOUNT, initiator: AMM_ISSUER, base_amount: "-3", counter_amount: "0", lp_tokens: "-1" })],
      pair,
      "xrpl",
    );
    expect(deposit).toMatchObject({ provider: { address: AMM_ACCOUNT, href: `/xrpl/account/${AMM_ACCOUNT}` }, by: null });
    expect(clawback).toMatchObject({
      provider: { address: AMM_ACCOUNT, href: `/xrpl/account/${AMM_ACCOUNT}` },
      by: { address: AMM_ISSUER, href: `/xrpl/account/${AMM_ISSUER}` },
    });
  });

  it("names no initiator for a deposit that someone else sent", () => {
    const [row] = liquidityRows([event({ account: AMM_ACCOUNT, initiator: AMM_OTHER })], pair, "xrpl");
    expect(row!.by).toBeNull();
  });

  it("is the row's time, hash and key, `ledger_index:tx_index`", () => {
    const [row] = liquidityRows([event({ ledger_index: 107703707, tx_index: 12, executed_time: "2026-10-17T10:24:11Z" })], pair, "xrpl");
    expect(row).toMatchObject({ key: "107703707:12", time: Date.parse("2026-10-17T10:24:11Z") / 1000, hash: AMM_TX_HASH });
  });

  it("writes amounts in exponent form in plain digits, and a dash for what is no number", () => {
    const rows = liquidityRows([event({ base_amount: "1.5e-7", counter_amount: "-2.5e+21", lp_tokens: "oops" })], pair, "xrpl");
    expect(rows[0]).toMatchObject({ first: "−2,500,000,000,000,000,000,000", second: "+0.00000015", lpTokens: "—" });
    expect(withoutHashes(JSON.stringify(rows))).not.toMatch(EXPONENT);
  });
});

describe("governanceRows", () => {
  const bid = (over: Partial<Extract<AmmGovernanceRow, { type: "bid" }>> = {}) =>
    ammBidSample({
      price_paid: "1240",
      auction_slot: { holder: AMM_HOLDER, discounted_fee: 30, expiration: "2026-10-17T09:00:00Z", auth_accounts: [AMM_OTHER, AMM_POOL] },
      ...over,
    });

  it("says a vote: 'Voted for 0.400%', with the fee after the vote", () => {
    const [row] = governanceRows([ammVoteSample({ fee_voted: 400, trading_fee_after: 205 })], "xrpl");
    expect(row).toMatchObject({ kind: "Vote", what: "Voted for 0.400%", feeAfter: "0.205%" });
  });

  it("says a vote with nothing in it: no fee voted, no fee after", () => {
    const { fee_voted: _voted, trading_fee_after: _after, ...bare } = ammVoteSample();
    const [row] = governanceRows([bare], "xrpl");
    expect(row).toMatchObject({ kind: "Vote", what: "Voted", feeAfter: "—" });
  });

  it("says a bid: the LP tokens it burned, the fee for the holder and the authorized accounts; no fee after", () => {
    const [row] = governanceRows([bid()], "xrpl");
    expect(row).toMatchObject({
      kind: "Bid",
      what: "Won the auction slot for 1,240 LP tokens; fee 0.030% for the holder and 2 authorized accounts",
      feeAfter: "—",
    });
  });

  it("says one authorized account in the singular, and none as the holder alone", () => {
    const slotWith = (auth_accounts: string[]) => ({ holder: AMM_HOLDER, discounted_fee: 30, expiration: "2026-10-17T09:00:00Z", auth_accounts });
    const rows = governanceRows([bid({ auction_slot: slotWith([AMM_OTHER]) }), bid({ auction_slot: slotWith([]) })], "xrpl");
    expect(rows.map((row) => row.what)).toEqual([
      "Won the auction slot for 1,240 LP tokens; fee 0.030% for the holder and 1 authorized account",
      "Won the auction slot for 1,240 LP tokens; fee 0.030% for the holder",
    ]);
  });

  it("leaves out the parts the row does not have", () => {
    const { price_paid: _paid, ...noPrice } = bid();
    const { auction_slot: _slot, ...noSlot } = bid();
    const rows = governanceRows([noPrice, noSlot], "xrpl");
    expect(rows.map((row) => row.what)).toEqual([
      "Won the auction slot; fee 0.030% for the holder and 2 authorized accounts",
      "Won the auction slot for 1,240 LP tokens",
    ]);
  });

  it("is a bare 'Won the auction slot' for a bid with nothing else", () => {
    const { price_paid: _paid, auction_slot: _slot, ...bare } = bid();
    expect(governanceRows([bare], "xrpl")[0]!.what).toBe("Won the auction slot");
  });

  it("says the authorized accounts alone where the slot has no discounted fee", () => {
    const [row] = governanceRows([bid({ auction_slot: { holder: AMM_HOLDER, auth_accounts: [AMM_OTHER] } })], "xrpl");
    expect(row!.what).toBe("Won the auction slot for 1,240 LP tokens; 1 authorized account");
  });

  it("writes the LP tokens exactly, grouped, and in plain digits from exponent text", () => {
    const rows = governanceRows([bid({ price_paid: "294.354152174" }), bid({ price_paid: "1.5e+21" }), bid({ price_paid: "2.5e-7" }), bid({ price_paid: "n/a" })], "xrpl");
    expect(rows.map((row) => row.what.split(";")[0])).toEqual([
      "Won the auction slot for 294.354152174 LP tokens",
      "Won the auction slot for 1,500,000,000,000,000,000,000 LP tokens",
      "Won the auction slot for 0.00000025 LP tokens",
      "Won the auction slot",
    ]);
  });

  it("is the account, time, hash and key, `ledger_index:tx_index`", () => {
    const rows = governanceRows([ammVoteSample({ ledger_index: 107644916, tx_index: 7, account: AMM_ACCOUNT }), bid({ ledger_index: 107650001, tx_index: 3, account: AMM_OTHER })], "xahau");
    expect(rows[0]).toMatchObject({
      key: "107644916:7",
      time: Date.parse("2026-10-16T08:00:00Z") / 1000,
      hash: AMM_TX_HASH,
      account: { address: AMM_ACCOUNT, href: `/xahau/account/${AMM_ACCOUNT}` },
    });
    expect(rows[1]).toMatchObject({ key: "107650001:3", account: { address: AMM_OTHER, href: `/xahau/account/${AMM_OTHER}` } });
  });
});

describe("the pool's rows: the recorded pages", () => {
  const dir = new URL("../../test/fixtures/http/xrpl/data-api/amm/pools/", import.meta.url);
  const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, dir), "utf8")) as T;
  const names = readdirSync(dir);
  const pools = names.filter((name) => name.endsWith(".json")).map((name) => json<{ pool: AmmPool }>(name).pool);
  // A pool with activity pages has a folder of its account beside its file.
  const withActivity = pools.filter((pool) => names.includes(pool.amm_account));
  const pairOf = (pool: AmmPool) =>
    displayPair({ currency: pool.base_currency, ...(pool.base_issuer ? { issuer: pool.base_issuer } : {}) }, { currency: pool.counter_currency, ...(pool.counter_issuer ? { issuer: pool.counter_issuer } : {}) }, "XRP");

  it("covers the six pools that have activity pages", () => {
    expect(withActivity).toHaveLength(6);
  });

  it("builds a row for every recorded swap, liquidity event and governance row, with no exponent", () => {
    let swaps = 0;
    let liquidity = 0;
    let governance = 0;
    for (const pool of withActivity) {
      const dirOf = new URL(`${pool.amm_account}/`, dir);
      for (const name of readdirSync(dirOf)) {
        const read = <T>() => JSON.parse(readFileSync(new URL(name, dirOf), "utf8")) as T;
        if (name.startsWith("swaps@")) {
          const rows = swapRows(read<Page<"exchanges", AmmSwap>>().exchanges, pairOf(pool), "xrpl");
          swaps += rows.length;
          for (const row of rows) {
            expect(row.direction, name).toMatch(/^.+ → .+$/);
            expect(row.into.startsWith("+") || row.into === "0" || row.into.startsWith("0 "), name).toBe(true);
            expect(row.out.startsWith("−") || row.out.startsWith("0 "), name).toBe(true);
          }
          expect(withoutHashes(JSON.stringify(rows)), name).not.toMatch(EXPONENT);
        } else if (name.startsWith("liquidity@")) {
          const rows = liquidityRows(read<Page<"liquidity", AmmLiquidityEvent>>().liquidity, pairOf(pool), "xrpl");
          liquidity += rows.length;
          expect(withoutHashes(JSON.stringify(rows)), name).not.toMatch(EXPONENT);
        } else if (name.startsWith("governance@")) {
          const rows = governanceRows(read<Page<"governance", AmmGovernanceRow>>().governance, "xrpl");
          governance += rows.length;
          expect(withoutHashes(JSON.stringify(rows)), name).not.toMatch(EXPONENT);
        }
      }
    }
    // The recordings hold 8 swaps, 7 liquidity events (a pool's creation among them) and 2 governance rows.
    expect(swaps).toBeGreaterThanOrEqual(8);
    expect(liquidity).toBeGreaterThanOrEqual(7);
    expect(governance).toBeGreaterThanOrEqual(2);
  });

  it("reads the recorded XRP / RLUSD swaps: the two sides of the first page", () => {
    const pool = pools.find((candidate) => candidate.amm_account === AMM_POOL)!;
    const page = json<Page<"exchanges", AmmSwap>>(`${AMM_POOL}/swaps@descending=true&limit=20.json`);
    const rows = swapRows(page.exchanges, pairOf(pool), "xrpl");
    // The pool is the seller of the first (RLUSD out, XRP in) and the buyer of the second (RLUSD in, XRP out).
    expect(rows[0]).toMatchObject({ direction: "XRP → RLUSD", into: "+1.015604 XRP", out: "−1.325962092 RLUSD", price: "1.3055897" });
    expect(rows[1]).toMatchObject({ direction: "RLUSD → XRP", into: "+543.870850376 RLUSD", out: "−417.277515 XRP", price: "1.3033792" });
  });

  it("reads the recorded XRP / RLUSD liquidity: a single-asset withdrawal of XRP, and a two-asset deposit, in the display columns", () => {
    const pool = pools.find((candidate) => candidate.amm_account === AMM_POOL)!;
    const page = json<Page<"liquidity", AmmLiquidityEvent>>(`${AMM_POOL}/liquidity@descending=true&limit=20.json`);
    const rows = liquidityRows(page.liquidity, pairOf(pool), "xrpl");
    // Stored RLUSD / XRP, shown XRP / RLUSD: the stored counter (XRP) is the first column; the stored base amount of 0 is a plain 0.
    expect(rows[0]).toMatchObject({ key: "107711512:60", event: "Withdraw", mode: "single_asset", first: "−49.999999", second: "0", lpTokens: "−24,262.103601", by: null });
    expect(rows[1]).toMatchObject({ key: "107703707:36", event: "Deposit", mode: "two_asset", first: "+82.769304", second: "+108.041216585", lpTokens: "+80,142.926261" });
  });

  it("reads the recorded bid and vote", () => {
    const bidPage = json<Page<"governance", AmmGovernanceRow>>("rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am/governance@descending=true&limit=20.json");
    expect(governanceRows(bidPage.governance, "xrpl")[0]).toMatchObject({
      key: "106084525:79",
      kind: "Bid",
      what: "Won the auction slot for 294.354152174 LP tokens; fee 0.022% for the holder",
      feeAfter: "—",
      account: { address: "r4S6hRiKREKkmMeqs8dpgyYAotGyck9g3h" },
    });
    const votePage = json<Page<"governance", AmmGovernanceRow>>("rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef/governance@descending=true&limit=20.json");
    expect(governanceRows(votePage.governance, "xrpl")[0]).toMatchObject({ key: "107644916:12", kind: "Vote", what: "Voted for 1.000%", feeAfter: "1.000%" });
  });
});
