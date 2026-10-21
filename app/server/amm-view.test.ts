import { readdirSync, readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { describe, expect, it, vi } from "vitest";

import { ammPoolHref, type AmmPoolQuery } from "../domain/amm-params";
import type { Asset } from "../domain/asset";
import { tokenOf } from "../domain/fnv";
import { formatAmount, formatPrice, shortAddress, shortHash } from "../domain/format";
import { marketHref, naturalOrientation, QUOTE_RANK } from "../domain/market-pair";
import { formatDateTime } from "../domain/time-words";
import { addDays, windowOf, type PeriodWindow, type WindowPeriod } from "../domain/window";
import type { SmallMultiplesData, TimeSeriesData } from "../ui/charts/types";
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
  ammDaySample,
  ammLiquiditySample,
  ammLiveVolumeSample,
  ammPoolSample,
  ammPoolsSample,
  ammSwapSample,
  ammVoteSample,
} from "../../test/support/amm-samples";
import { loadTx } from "../../test/support/ledgers";
import type {
  AmmGovernanceRow,
  AmmLiquidityEvent,
  AmmPool,
  AmmPoolDay,
  AmmSwap,
  AmmVolumeComponent,
  AmmVolumeRow,
  Candle,
  LastValidated,
  Page,
} from "./api-types";
import {
  daySeries,
  displayPair,
  exactRatio,
  feePercent,
  governanceRows,
  intervalText,
  liquidityRows,
  NOT_COMPUTED_NOTE,
  ammHistoryPage,
  ammListPage,
  ammListWindow,
  ammPoolFacts,
  ammPoolPage,
  createdOf,
  MODE_CLASS,
  nextBidPrice,
  noAmmPage,
  poolCharts,
  poolModeOf,
  poolQueries,
  slotInterval,
  storedPair,
  swapRows,
  voteShares,
  type AmmActivityPage,
  type AmmListInput,
  type AmmListPageData,
  type AmmListProblem,
  type AmmPoolInput,
  type AmmPoolMode,
  type AmmPoolPageData,
  type AmmStat,
  type ChartPart,
  type DaySeriesInput,
} from "./amm-view";
import { anchorOrThrow } from "./anchor";
import type { SubrequestCache } from "./cache-class";
import { TooLate } from "./deadline";
import { anchoredWindow } from "./network-view";
import { createNodeRpc, type AmmInfo } from "./node-rpc";
import type { Network } from "./networks";
import { UpstreamError } from "./upstream";

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
const TOTALS_FAILED = { state: "failed", what: "the 24-hour figures", labels: TILE_LABELS };
/** A failed chart keeps its title and source line, so the page draws the card around its SectionError without words of its own. */
const CHART_FAILED = { state: "failed", what: "the swap volume", title: "AMM swap volume per day, in XRP, last 30 days", source: "/v2/network/amm_volume?interval=day" };

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

/** The list's problems as `part: why`, the reason's message (or the reason itself when it is not an error). */
const said = (problems: readonly AmmListProblem[]): string[] =>
  problems.map(({ part, reason }) => `${part}: ${reason instanceof Error ? reason.message : String(reason)}`);

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

    const HELD = { text: "rPT1Sj…pAYe", href: "/xrpl/account/rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe", open: false };
    const OPEN = { text: "Open", href: null, open: true };
    const UNKNOWN = { text: "—", href: null, open: false };

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
      expect(slot({ expiration: "2026-10-17T17:01:13Z" }, neither)).toEqual(UNKNOWN);
    });

    it("is still Open without a holder when there is no time at all: nobody holds it", () => {
      const neither = { live: rejected(new TooLate()), last: rejected(new TooLate()), history: null };
      expect(slot(null, neither)).toEqual(OPEN);
    });

    it("shows a holder with no expiration as the holder: the index has no time to compare", () => {
      expect(slot({})).toEqual(HELD);
    });

    it("is a dash for a deleted pool, held or not: a deleted pool has no slot to hold or bid for", () => {
      const deleted = (auction_slot: AmmPool["auction_slot"]) =>
        rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ deleted: true, auction_slot })] })) })[0]!.slot;
      expect(deleted({ holder: AMM_HOLDER, expiration: "2027-01-01T00:00:00Z" })).toEqual(UNKNOWN);
      expect(deleted({ holder: AMM_HOLDER })).toEqual(UNKNOWN);
      expect(deleted(undefined)).toEqual(UNKNOWN);
    });

    it("says that it is open only for Open: a holder and a dash are not", () => {
      const neither = { live: rejected(new TooLate()), last: rejected(new TooLate()), history: null };
      expect([slot(null).open, slot({ expiration: "2027-01-01T00:00:00Z" }).open, slot({ expiration: "2027-01-01T00:00:00Z" }, neither).open]).toEqual([true, false, false]);
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

describe("ammListWindow", () => {
  it("is the network page's 30 days up to the UTC day of the newest ledger", () => {
    expect(ammListWindow(LAST)).toEqual(windowOf("2026-10-17", "30d"));
    expect(ammListWindow(LAST)).toEqual(anchoredWindow(anchorOrThrow(LAST), "30d"));
  });

  it("throws the API failing for a newest ledger no day can be worked out of", () => {
    expect(() => ammListWindow({ ...LAST, close_time: "yesterday" })).toThrow(UpstreamError);
  });
});

describe("the list: what failed", () => {
  it("fails the table alone when the pools call was rejected, and says why in a problem", () => {
    const { page, problems } = ammListPage(inputOf({ pools: rejected(new TooLate()) }));
    expect(page.pools).toEqual({ state: "failed", what: "the pools", source: "/v2/amm/pools · ordered by value" });
    expect(page.totals.state).toBe("ok");
    expect(page.chart.state).toBe("ok");
    expect(said(problems)).toEqual(["pools: took too long"]);
  });

  it("fails the totals alone when the live set was rejected, and the Volume column and the card say so", () => {
    const { page, problems } = ammListPage(inputOf({ live: rejected(new Error("data API GET /v2/network/amm_volume answered 503")) }));
    expect(page.totals).toEqual(TOTALS_FAILED);
    expect(page.chart.state).toBe("ok");
    expect(page.pools).toMatchObject({ state: "ok", note: NO_VOLUME_NOTE });
    expect(rowsOf({ live: rejected(new Error("x")) }).map((row) => row.volume)).toEqual(["—"]);
    expect(said(problems)).toEqual(["totals: data API GET /v2/network/amm_volume answered 503"]);
  });

  it("fails the chart alone when the newest ledger was rejected, whatever history is", () => {
    const { page, problems } = ammListPage(inputOf({ last: rejected(new TooLate()), history: null }));
    expect(page.chart).toEqual(CHART_FAILED);
    expect(page.totals.state).toBe("ok");
    expect(page.pools.state).toBe("ok");
    expect(said(problems)).toEqual(["chart: took too long"]);
  });

  it("fails the chart alone when the history was rejected", () => {
    const { page, problems } = ammListPage(inputOf({ history: rejected(new TooLate()) }));
    expect(page.chart).toEqual(CHART_FAILED);
    expect(page.totals.state).toBe("ok");
    expect(said(problems)).toEqual(["chart: took too long"]);
  });

  it("fails the chart when the newest ledger has a close time no day can be worked out of, and says so without throwing", () => {
    const { page, problems } = ammListPage(inputOf({ last: fulfilled({ ...LAST, close_time: "yesterday" }) }));
    expect(page.chart).toEqual(CHART_FAILED);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.part).toBe("chart");
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
    expect(said(problems)).toEqual(["totals: the data API answered no row"]);
  });

  describe("an answer that is not what the data API promises is a failed card, never a throw", () => {
    /** A pool whose slot is held until just after the newest ledger closed (17:01:12): held by the ledger's close time, as the live set is not there. */
    const held = (over: Partial<AmmListInput> = {}) =>
      rowsOf({ pools: fulfilled(ammPoolsSample({ pools: [xrpRlusd({ auction_slot: { holder: AMM_HOLDER, expiration: "2026-10-17T17:01:13Z" } })] })), ...over })[0]!;
    const HELD = { text: "rPT1Sj…pAYe", href: "/xrpl/account/rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe", open: false };

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
      expect(problems[0]!.part).toBe("totals");
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
      expect(page.chart).toEqual(CHART_FAILED);
      expect(page.totals.state).toBe("ok");
      expect(problems).toHaveLength(1);
      expect(problems[0]!.part).toBe("chart");
      // The live set's end (17:01:00) is before the expiration, which the missing ledger does not change.
      expect(held({ last }).slot).toEqual(HELD);
    });

    it("has no time at all when the newest ledger and the live set both failed, and still stands", () => {
      const neither = { last: rejected(new TooLate()), live: rejected(new TooLate()), history: null };
      const { page, problems } = ammListPage(inputOf(neither));
      expect(page).toMatchObject({ kind: "list", totals: TOTALS_FAILED, chart: CHART_FAILED, pools: { state: "ok", note: NO_VOLUME_NOTE } });
      expect(said(problems)).toEqual(["totals: took too long", "chart: took too long"]);
      expect(held(neither)).toMatchObject({ volume: "—", slot: { text: "—", href: null, open: false } });
    });

    it("has no time at all when the live set failed and the newest ledger is null, and still stands", () => {
      const neither = { last: fulfilled(null as unknown as LastValidated), live: rejected(new TooLate()), history: null };
      expect(held(neither).slot).toEqual({ text: "—", href: null, open: false });
      expect(ammListPage(inputOf(neither)).page.pools.state).toBe("ok");
    });
  });

  it("keeps the problems in the order of the page, one for each failed card, and the page still stands", () => {
    const everything = ammListPage(
      inputOf({ pools: rejected(new TooLate()), live: rejected(new TooLate()), last: rejected(new TooLate()), history: null }),
    );
    expect(said(everything.problems)).toEqual(["totals: took too long", "chart: took too long", "pools: took too long"]);
    expect(everything.page).toMatchObject({
      kind: "list",
      totals: { state: "failed" },
      chart: { state: "failed" },
      pools: { state: "failed" },
    });
  });

  it("keeps each problem's reason as it was given, an error or not: the loader logs it and reads it", () => {
    const reason = new Error("data API GET /v2/network/amm_volume answered 404: Cannot GET /v2/network/amm_volume (the data API has no such route)");
    const { problems } = ammListPage(inputOf({ live: rejected(reason) }));
    expect(problems).toEqual([{ part: "totals", reason }]);
    expect(problems[0]!.reason).toBe(reason);
    expect(ammListPage(inputOf({ pools: rejected("down") })).problems).toEqual([{ part: "pools", reason: "down" }]);
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

  it("is 0 for an interval that is not a whole number from 0 to 20: it is no interval of a slot", () => {
    for (const interval of [-1, 0.5, 18.5, 21, 100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(nextBidPrice("1000000", 500, { price: "100", interval }), String(interval)).toBe("0");
    }
    // The whole numbers at the edges are intervals.
    expect(nextBidPrice("1000000", 500, { price: "100", interval: 0 })).toBe("305");
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

  /** A swap of the pool between two assets (nothing is left of the sample's own issuer): the base went out of the pool, 100 of it, for 50 of the counter. */
  const swapBetween = (base: Asset, counter: Asset): AmmSwap => {
    const { base_issuer: _base, counter_issuer: _counter, ...sample } = ammSwapSample({ base_amount: "100", counter_amount: "50", seller: AMM_POOL });
    return {
      ...sample,
      base_currency: base.currency,
      ...(base.issuer ? { base_issuer: base.issuer } : {}),
      counter_currency: counter.currency,
      ...(counter.issuer ? { counter_issuer: counter.issuer } : {}),
    };
  };

  it("reads a row that names one side only from that side, whatever the pair says of itself", () => {
    // XRP / RLUSD, stored RLUSD / XRP: the first column is XRP. A row whose base is RLUSD (the second) or whose counter is XRP (the first) is stored flipped; a row
    // whose base is XRP or whose counter is RLUSD is not. The other side is an asset the pair does not hold, so only one side can decide.
    const eur: Asset = { currency: "EUR", issuer: AMM_OTHER };
    const cases: { name: string; row: AmmSwap; flipped: boolean }[] = [
      { name: "base is the second", row: swapBetween(rlusd, eur), flipped: true },
      { name: "counter is the first", row: swapBetween(eur, xrp), flipped: true },
      { name: "base is the first", row: swapBetween(xrp, eur), flipped: false },
      { name: "counter is the second", row: swapBetween(eur, rlusd), flipped: false },
    ];
    for (const { name, row, flipped } of cases) {
      // The base (100) went out of the pool. Flipped: the first column (XRP) is the counter, so the 50 went in as XRP and the 100 came out as RLUSD.
      const expected = flipped
        ? { direction: "XRP → RLUSD", into: "+50 XRP", out: "−100 RLUSD" }
        : { direction: "RLUSD → XRP", into: "+50 RLUSD", out: "−100 XRP" };
      // The pair's own flag is set both ways: the row decides.
      expect(swapRows([row], { ...pair, flipped: true }, "xrpl")[0], `${name}, pair says flipped`).toMatchObject(expected);
      expect(swapRows([row], { ...pair, flipped: false }, "xrpl")[0], `${name}, pair says straight`).toMatchObject(expected);
    }
  });

  it("takes the pair's own order for a row whose two sides disagree", () => {
    // The base is the first side and the counter is the first side too: neither can be trusted over the other.
    const odd = swapBetween(xrp, xrp);
    expect(swapRows([odd], { ...pair, flipped: true }, "xrpl")[0]).toMatchObject({ direction: "XRP → RLUSD" });
    expect(swapRows([odd], { ...pair, flipped: false }, "xrpl")[0]).toMatchObject({ direction: "RLUSD → XRP" });
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

  describe("at the extremes of an amount (1e+30 and 1e-30), through the whole path", () => {
    const HUGE = `1${",000".repeat(10)}`; // 1e+30, grouped
    const TINY = `0.${"0".repeat(29)}1`; // 1e-30
    const price = (exponent: number) => (exponent > 0 ? `1${",000".repeat(exponent / 3)}` : `0.${"0".repeat(-exponent - 1)}1`);
    const rowOf = (over: Partial<AmmSwap>): AmmSwap => ammSwapSample({ base_currency: RLUSD, base_issuer: RL, counter_currency: "XRP", ...over });

    it("shows a huge RLUSD amount against a tiny XRP amount in plain digits, the price a huge RLUSD per XRP, both directions", () => {
      const amounts = { base_amount: "1e+30", counter_amount: "1e-30" };
      const [poolSells, poolBuys] = swapRows([rowOf({ ...amounts, seller: AMM_POOL, buyer: AMM_ACCOUNT }), rowOf({ ...amounts, buyer: AMM_POOL, seller: AMM_ACCOUNT })], pair, "xrpl");
      // RLUSD / XRP = 1e60 RLUSD per XRP.
      expect(poolSells).toMatchObject({ direction: "XRP → RLUSD", into: `+${TINY} XRP`, out: `−${HUGE} RLUSD`, price: price(60) });
      expect(poolBuys).toMatchObject({ direction: "RLUSD → XRP", into: `+${HUGE} RLUSD`, out: `−${TINY} XRP`, price: price(60) });
    });

    it("shows a tiny RLUSD amount against a huge XRP amount in plain digits, the price a tiny RLUSD per XRP, both directions", () => {
      const amounts = { base_amount: "1e-30", counter_amount: "1e+30" };
      const [poolSells, poolBuys] = swapRows([rowOf({ ...amounts, seller: AMM_POOL, buyer: AMM_ACCOUNT }), rowOf({ ...amounts, buyer: AMM_POOL, seller: AMM_ACCOUNT })], pair, "xrpl");
      expect(poolSells).toMatchObject({ direction: "XRP → RLUSD", into: `+${HUGE} XRP`, out: `−${TINY} RLUSD`, price: price(-60) });
      expect(poolBuys).toMatchObject({ direction: "RLUSD → XRP", into: `+${TINY} RLUSD`, out: `−${HUGE} XRP`, price: price(-60) });
    });

    it("keeps the orientation for a pool shown the way it is stored: the counter per the base", () => {
      const eur = displayPair({ currency: "EUR", issuer: AMM_OTHER }, { currency: "USD", issuer: AMM_ISSUER }, "XRP");
      const row = ammSwapSample({ base_currency: "EUR", base_issuer: AMM_OTHER, counter_currency: "USD", counter_issuer: AMM_ISSUER, base_amount: "1e+30", counter_amount: "1e-30" });
      // USD / EUR = 1e-60 USD per EUR.
      expect(swapRows([{ ...row, seller: AMM_POOL }], eur, "xrpl")[0]).toMatchObject({ direction: "USD → EUR", into: `+${TINY} USD`, out: `−${HUGE} EUR`, price: price(-60) });
    });

    it("writes no exponent in any row of the extremes", () => {
      const rows = swapRows(
        [rowOf({ base_amount: "1e+30", counter_amount: "1e-30" }), rowOf({ base_amount: "1e-30", counter_amount: "1e+30", seller: AMM_POOL }), rowOf({ base_amount: "9.999999999999999e+95", counter_amount: "1e-81" })],
        pair,
        "xrpl",
      );
      expect(withoutHashes(JSON.stringify(rows))).not.toMatch(EXPONENT);
      // The limits of a ledger amount: 9.999999999999999e95 per 1e-81 is 1e177 (to 8 digits), and keeps its digits.
      expect(rows[2]!.price).toBe(price(177));
    });
  });

  it("has a dash for a price it cannot work out, and for an amount that is no number", () => {
    const [zero, junk] = swapRows([swap({ counter_amount: "0" }), swap({ base_amount: "n/a" })], pair, "xrpl");
    expect(zero).toMatchObject({ price: "—", into: "0 XRP", out: "−1,250 RLUSD" });
    expect(junk).toMatchObject({ price: "—", out: "—" });
  });

  it("is no rows for no rows", () => {
    expect(swapRows([], pair, "xrpl")).toEqual([]);
  });

  it("names each side's issuer for a pool of one code on both sides, where the direction alone reads 'USD → USD' (Task 7's Minor 3)", () => {
    // USD of two issuers, stored with AMM_ISSUER's as the base. The pool paid out the base (seller is the pool): RL's USD went in, AMM_ISSUER's came out.
    const ours: Asset = { currency: "USD", issuer: AMM_ISSUER };
    const theirs: Asset = { currency: "USD", issuer: RL };
    const usdUsd = displayPair(ours, theirs, "XRP");
    const usdSwap = (over: Partial<AmmSwap>): AmmSwap =>
      ammSwapSample({ base_currency: "USD", base_issuer: AMM_ISSUER, counter_currency: "USD", counter_issuer: RL, base_amount: "10", counter_amount: "9.9", ...over });
    const [poolSells, poolBuys] = swapRows([usdSwap({ seller: AMM_POOL, buyer: AMM_ACCOUNT }), usdSwap({ buyer: AMM_POOL, seller: AMM_ACCOUNT })], usdUsd, "xrpl");
    expect(poolSells!.direction).toBe("USD → USD");
    expect(poolSells!.directionTitle).toBe(`USD of ${shortAddress(RL)} → USD of ${shortAddress(AMM_ISSUER)}`);
    expect(poolBuys!.directionTitle).toBe(`USD of ${shortAddress(AMM_ISSUER)} → USD of ${shortAddress(RL)}`);
    // Whichever side the pair shows first, the title follows what went in and what came out.
    const [shownOtherWay] = swapRows([usdSwap({ seller: AMM_POOL, buyer: AMM_ACCOUNT })], { ...usdUsd, first: usdUsd.second, second: usdUsd.first, flipped: !usdUsd.flipped }, "xrpl");
    expect(shownOtherWay!.directionTitle).toBe(poolSells!.directionTitle);
  });

  it("has no direction title for a pool whose codes tell its sides apart", () => {
    const [row] = swapRows([swap({ seller: AMM_POOL })], pair, "xrpl");
    expect(row!.directionTitle).toBeNull();
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

// ---- The pool's charts: the day series ----------------------------------------------------------------------------------------------------------
// Hand-made rows, T = Oct 17, 2026, and E2's 30-day window unless a test names another (spec 3.5, rules 1 to 6).

const DAY_T = "2026-10-17";
const W30 = windowOf(DAY_T, "30d");
const W1Y = windowOf(DAY_T, "1y");
const usdcAsset: Asset = { currency: USDC, issuer: USDC_ISSUER };
const voxAsset: Asset = { currency: VOX, issuer: VOX_ISSUER };
/** XRP / RLUSD, stored RLUSD / XRP: `first` is the stored counter. */
const XRP_RLUSD = displayPair(rlusd, xrp, "XRP");
/** USDC / RLUSD, stored RLUSD / USDC (P35): `first` is the stored counter, and neither side is the native currency. */
const USDC_RLUSD = displayPair(rlusd, usdcAsset, "XRP");
/** VOX / XRP, stored as it is shown: the native currency is the second side. */
const VOX_XRP = displayPair(voxAsset, xrp, "XRP");

/** A day of XRP / RLUSD as the API stores the pool, RLUSD / XRP: the base is the RLUSD (the second side shown), the counter the XRP (the first). */
const poolDay = (date: string, over: Partial<AmmPoolDay> = {}): AmmPoolDay =>
  ammDaySample({
    date: `${date}T00:00:00Z`,
    base_currency: RLUSD,
    base_issuer: RL,
    counter_currency: "XRP",
    swap_count: 3,
    fees_base_est: "1.5",
    fees_counter_est: "2.5",
    reserve_base: "2400000",
    reserve_counter: "1850000",
    trading_fee: 205,
    value_native: "3700000",
    ...over,
  });

/** A day of USDC / RLUSD as the API stores the pool, RLUSD / USDC, with no value: neither asset has an XRP rate. */
const usdcDay = (date: string, over: Partial<AmmPoolDay> = {}): AmmPoolDay =>
  leaving(poolDay(date, { counter_currency: USDC, counter_issuer: USDC_ISSUER, reserve_base: "26100", reserve_counter: "26200", ...over }), "value_native");

/** The row without the fields named: what the API leaves out (a field it does not know, a deleted pool's state, an unknown fee estimate). */
function leaving<T extends object>(row: T, ...keys: (keyof T)[]): T {
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

/** A candle of the pair in the pool's stored order, RLUSD / XRP: 4 swaps, 1,300 RLUSD and 1,000 XRP. */
const poolCandle = (start: string, over: Partial<Candle> = {}): Candle => ({
  base_volume: "1300",
  buy_volume: 650,
  close: "1.3",
  close_time: `${start}T21:00:00Z`,
  count: 4,
  counter_volume: "1000",
  high: "1.3",
  low: "1.3",
  open: "1.3",
  open_time: `${start}T01:00:00Z`,
  start: `${start}T00:00:00Z`,
  vwap: "1.3",
  base_currency: RLUSD,
  base_issuer: RL,
  counter_currency: "XRP",
  ...over,
});

const seriesInput = (over: Partial<DaySeriesInput> = {}): DaySeriesInput => ({
  window: W30,
  pair: XRP_RLUSD,
  native: "XRP",
  pool: AMM_POOL,
  deleted: false,
  days: [],
  carryIn: null,
  candles: [],
  ...over,
});

/** The index of a bucket of the window. */
function bucket(day: string, window: PeriodWindow = W30): number {
  const index = window.buckets.indexOf(day);
  if (index < 0) throw new Error(`${day} is no bucket of the window`);
  return index;
}

const SERIES = ["value", "price", "fee", "reserveFirst", "reserveSecond", "volume", "swaps", "feesFirst", "feesSecond"] as const;
const STATES = ["value", "price", "fee", "reserveFirst", "reserveSecond"] as const;

describe("daySeries: when the pool exists (rule 1)", () => {
  it("has one value per bucket in each series, for days and for weeks", () => {
    const days = daySeries(seriesInput());
    const weeks = daySeries(seriesInput({ window: W1Y }));
    for (const name of SERIES) {
      expect(days[name], name).toHaveLength(30);
      expect(weeks[name], name).toHaveLength(52);
    }
  });

  it("exists from the first bucket with a carry-in: the pool was there before the window", () => {
    const s = daySeries(seriesInput({ carryIn: poolDay("2026-09-10", { value_native: "3600000" }), days: [poolDay("2026-10-01")] }));
    for (const name of SERIES) expect(s[name].every((value) => value !== null), name).toBe(true);
    expect(s.value[0]).toBe("3600000");
    expect(s.value[bucket("2026-10-01")]).toBe("3700000");
  });

  it("exists from its first row's day without one: every bucket before Oct 12 is null in every series", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-12"), poolDay("2026-10-14")], candles: [poolCandle("2026-10-12"), poolCandle("2026-10-15")] }));
    const first = bucket("2026-10-12");
    for (const name of SERIES) {
      expect(s[name].slice(0, first).every((value) => value === null), name).toBe(true);
      expect(s[name].slice(first).every((value) => value !== null), name).toBe(true);
    }
  });

  it("ends a deleted pool with its last row: every bucket after it is null in every series", () => {
    // The day of a deletion has a row (the deletion touched the pool) and no closing state: the API leaves out its reserves, LP supply, fee and value.
    const deletion = leaving(poolDay("2026-10-05", { withdraw_count: 1 }), "reserve_base", "reserve_counter", "lp_supply", "trading_fee", "value_native");
    const s = daySeries(
      seriesInput({ deleted: true, carryIn: poolDay("2026-09-01"), days: [poolDay("2026-09-25"), deletion], candles: [poolCandle("2026-10-05"), poolCandle("2026-10-06")] }),
    );
    const last = bucket("2026-10-05");
    for (const name of SERIES) expect(s[name].slice(last + 1).every((value) => value === null), name).toBe(true);
    // The day of the deletion is inside the pool's life: its flows and fees are there, and its state is what its row has, which is none.
    expect(s.volume[last]).toBe("1000");
    expect(s.feesFirst[last]).toBe("2.5");
    for (const name of STATES) expect(s[name][last], name).toBeNull();
    expect(s.value[last - 1]).toBe("3700000");
    expect(s.value[0]).toBe("3700000");
  });

  it("is null everywhere for a pool deleted before the window, whose last row is the carry-in", () => {
    const deletion = leaving(poolDay("2026-08-01"), "reserve_base", "reserve_counter", "trading_fee", "value_native");
    const s = daySeries(seriesInput({ deleted: true, carryIn: deletion, candles: [poolCandle("2026-09-20"), poolCandle("2026-10-17")] }));
    for (const name of SERIES) expect(s[name].every((value) => value === null), name).toBe(true);
  });

  it("is null everywhere for a pool with no row and no carry-in: the index has no day of it yet (a pool from the network)", () => {
    const s = daySeries(seriesInput({ candles: [poolCandle("2026-10-17")] }));
    for (const name of SERIES) expect(s[name].every((value) => value === null), name).toBe(true);
  });

  it("is the carry-in's state over the whole window for a live pool with no row in it", () => {
    const s = daySeries(seriesInput({ carryIn: poolDay("2026-08-01", { value_native: "100" }) }));
    expect(new Set(s.value)).toEqual(new Set(["100"]));
    expect(new Set(s.reserveFirst)).toEqual(new Set(["1850000"]));
    expect(new Set(s.volume)).toEqual(new Set(["0"]));
    expect(new Set(s.feesFirst)).toEqual(new Set(["0"]));
  });

  it("reads no row outside the window: a deleted pool's row past T does not lengthen its life, nor one before the window start it", () => {
    const outside = [poolDay("2026-09-01", { value_native: "1" }), poolDay("2026-10-05", { value_native: "5" }), poolDay("2026-10-18", { value_native: "18" })];
    const s = daySeries(seriesInput({ deleted: true, days: outside }));
    const day = bucket("2026-10-05");
    for (const name of SERIES) {
      expect(s[name].slice(0, day).every((value) => value === null), name).toBe(true);
      expect(s[name].slice(day + 1).every((value) => value === null), name).toBe(true);
    }
    expect(s.value[day]).toBe("5");
  });
});

describe("daySeries: the states, value, price, fee and reserves (rule 2)", () => {
  it("takes a day's fields from its row, in the display pair: XRP / RLUSD is stored RLUSD / XRP, so the XRP reserve is `reserve_counter`", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01")] }));
    const at = bucket("2026-10-01");
    expect(s.reserveFirst[at]).toBe("1850000");
    expect(s.reserveSecond[at]).toBe("2400000");
    expect(s.value[at]).toBe("3700000");
    expect(s.fee[at]).toBe("0.205");
    // RLUSD per XRP: the second's reserve over the first's, to exactRatio's 8 significant digits.
    expect(s.price[at]).toBe("1.2972973");
    expect(s.price[at]).toBe(exactRatio("2400000", "1850000"));
  });

  it("keeps the stored order for a pool shown the way it is stored: VOX / XRP's first reserve is `reserve_base`", () => {
    const row = poolDay("2026-10-01", { base_currency: VOX, base_issuer: VOX_ISSUER, reserve_base: "800", reserve_counter: "20" });
    const s = daySeries(seriesInput({ pair: VOX_XRP, days: [row] }));
    const at = bucket("2026-10-01");
    expect([s.reserveFirst[at], s.reserveSecond[at], s.price[at]]).toEqual(["800", "20", "0.025"]);
  });

  it("reads the sides from the row's own assets, as the swaps are read: a row whose base is XRP has the XRP reserve in `reserve_base`", () => {
    const row = poolDay("2026-10-01", { base_currency: "XRP", base_issuer: undefined, counter_currency: RLUSD, counter_issuer: RL, reserve_base: "1850000", reserve_counter: "2400000" });
    const s = daySeries(seriesInput({ days: [leaving(row, "base_issuer")] }));
    const at = bucket("2026-10-01");
    expect([s.reserveFirst[at], s.reserveSecond[at], s.price[at]]).toEqual(["1850000", "2400000", "1.2972973"]);
  });

  it("has null for a field the row leaves out, and a quiet day after it takes that null: the day before's value", () => {
    const s = daySeries(seriesInput({ carryIn: poolDay("2026-09-10"), days: [leaving(poolDay("2026-10-01"), "value_native", "trading_fee")] }));
    const at = bucket("2026-10-01");
    expect([s.value[at], s.fee[at], s.value[at + 1], s.fee[at + 1]]).toEqual([null, null, null, null]);
    expect(s.reserveFirst[at + 1]).toBe("1850000");
    expect(s.value[at - 1]).toBe("3700000");
  });

  it("gives a quiet day the day before's value, and the first days the carry-in's", () => {
    const s = daySeries(
      seriesInput({
        carryIn: poolDay("2026-09-10", { value_native: "3600000", trading_fee: 300 }),
        days: [poolDay("2026-10-01"), poolDay("2026-10-09", { value_native: "3800000" })],
      }),
    );
    const [first, second] = [bucket("2026-10-01"), bucket("2026-10-09")];
    expect(s.value.slice(0, first)).toEqual(Array(first).fill("3600000"));
    expect(s.fee.slice(0, first)).toEqual(Array(first).fill("0.3"));
    expect(s.value.slice(first, second)).toEqual(Array(8).fill("3700000"));
    expect(s.value.slice(second)).toEqual(Array(9).fill("3800000"));
  });

  it("has no price with a zero reserve on either side, and keeps the reserves", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01", { reserve_counter: "0" }), poolDay("2026-10-02", { reserve_base: "0" })] }));
    expect(s.price[bucket("2026-10-01")]).toBeNull();
    expect(s.price[bucket("2026-10-02")]).toBeNull();
    expect(s.reserveFirst[bucket("2026-10-01")]).toBe("0");
    expect(s.reserveSecond[bucket("2026-10-02")]).toBe("0");
  });

  it("writes the trading fee in percent, by BigNumber: 205 is 0.205, 1000 is 1 and 0 is 0", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01"), poolDay("2026-10-02", { trading_fee: 1000 }), poolDay("2026-10-03", { trading_fee: 0 })] }));
    expect([s.fee[bucket("2026-10-01")], s.fee[bucket("2026-10-02")], s.fee[bucket("2026-10-03")]]).toEqual(["0.205", "1", "0"]);
  });

  it("writes what the API wrote in exponent form in plain digits, and divides exactly at the extremes", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01", { reserve_base: "1e+30", reserve_counter: "1e-30", value_native: "2.5e+21" })] }));
    const at = bucket("2026-10-01");
    expect(s.reserveSecond[at]).toBe(`1${"0".repeat(30)}`);
    expect(s.reserveFirst[at]).toBe(`0.${"0".repeat(29)}1`);
    expect(s.value[at]).toBe(`25${"0".repeat(20)}`);
    expect(s.price[at]).toBe(`1${"0".repeat(60)}`);
  });

  it("reads a field that is no number as unknown", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01", { reserve_base: "abc", value_native: "" })] }));
    const at = bucket("2026-10-01");
    expect([s.reserveSecond[at], s.price[at], s.value[at]]).toEqual([null, null, null]);
    expect(s.reserveFirst[at]).toBe("1850000");
  });
});

describe("daySeries: weeks (the year)", () => {
  it("gives a week the state of its last day, and the running week (Oct 12) that of Oct 17, T", () => {
    const s = daySeries(
      seriesInput({
        window: W1Y,
        carryIn: poolDay("2025-10-01", { value_native: "1" }),
        days: [poolDay("2026-10-06", { value_native: "6" }), poolDay("2026-10-13", { value_native: "13" }), poolDay("2026-10-17", { value_native: "17" })],
      }),
    );
    expect(s.value[0]).toBe("1");
    expect(s.value[bucket("2026-09-28", W1Y)]).toBe("1");
    // The week of Oct 5 ends on Sunday Oct 11, a quiet day that keeps Oct 6's value.
    expect(s.value[bucket("2026-10-05", W1Y)]).toBe("6");
    expect(s.value[bucket("2026-10-12", W1Y)]).toBe("17");
  });

  it("takes nothing after T: a row past the window's end is no state of the running week", () => {
    const s = daySeries(seriesInput({ window: W1Y, carryIn: poolDay("2025-10-01"), days: [poolDay("2026-10-13", { value_native: "13" }), poolDay("2026-10-18", { value_native: "18" })] }));
    expect(s.value[bucket("2026-10-12", W1Y)]).toBe("13");
  });

  it("starts a pool created inside a week with that week, which takes the state of its Sunday", () => {
    const s = daySeries(seriesInput({ window: W1Y, days: [poolDay("2026-09-23", { value_native: "23" }), poolDay("2026-09-26", { value_native: "26" })] }));
    for (const name of SERIES) expect(s[name].slice(0, bucket("2026-09-21", W1Y)).every((value) => value === null), name).toBe(true);
    expect(s.value[bucket("2026-09-21", W1Y)]).toBe("26");
    expect(s.value[bucket("2026-09-28", W1Y)]).toBe("26");
  });

  it("ends a pool deleted inside a week with that week, which takes the state of its last row and not of the Sunday after it", () => {
    const s = daySeries(
      seriesInput({
        window: W1Y,
        deleted: true,
        carryIn: poolDay("2025-10-01"),
        days: [poolDay("2026-09-23", { value_native: "23" }), poolDay("2026-09-30", { value_native: "30" })],
        candles: [poolCandle("2026-09-28"), poolCandle("2026-10-05")],
      }),
    );
    const week = bucket("2026-09-28", W1Y);
    expect(s.value[week]).toBe("30");
    expect(s.volume[week]).toBe("1000");
    for (const name of SERIES) expect(s[name].slice(week + 1).every((value) => value === null), name).toBe(true);
  });

  it("takes a week's candle by its Monday, and 0 for a week without one", () => {
    const s = daySeries(seriesInput({ window: W1Y, carryIn: poolDay("2025-10-01"), candles: [poolCandle("2026-10-05", { counter_volume: "7000", count: 28 })] }));
    expect([s.volume[bucket("2026-10-05", W1Y)], s.swaps[bucket("2026-10-05", W1Y)]]).toEqual(["7000", "28"]);
    expect([s.volume[bucket("2026-09-28", W1Y)], s.swaps[bucket("2026-09-28", W1Y)]]).toEqual(["0", "0"]);
  });

  it("sums a week's fee estimates over its days, and is null when any of them is", () => {
    const s = daySeries(
      seriesInput({
        window: W1Y,
        carryIn: poolDay("2025-10-01"),
        days: [
          poolDay("2026-10-06", { fees_counter_est: "2.5", fees_base_est: "1.5" }),
          leaving(poolDay("2026-10-08", { fees_counter_est: "0.25" }), "fees_base_est"),
          poolDay("2026-10-13", { fees_counter_est: "1", fees_base_est: "2" }),
          poolDay("2026-10-16", { fees_counter_est: "0.000000001", fees_base_est: "0" }),
        ],
      }),
    );
    // XRP is the stored counter, RLUSD the stored base. Oct 8 had swaps and no RLUSD estimate: the week's RLUSD fees are not known.
    expect([s.feesFirst[bucket("2026-10-05", W1Y)], s.feesSecond[bucket("2026-10-05", W1Y)]]).toEqual(["2.75", null]);
    expect([s.feesFirst[bucket("2026-10-12", W1Y)], s.feesSecond[bucket("2026-10-12", W1Y)]]).toEqual(["1.000000001", "2"]);
    expect([s.feesFirst[bucket("2026-09-28", W1Y)], s.feesSecond[bucket("2026-09-28", W1Y)]]).toEqual(["0", "0"]);
  });

  it("sums only the days inside the pool's life: the days of a creation week before the creation count for nothing", () => {
    const s = daySeries(
      seriesInput({ window: W1Y, days: [poolDay("2026-09-24", { fees_counter_est: "2.5", fees_base_est: "1.5" }), poolDay("2026-09-26", { fees_counter_est: "0.5", fees_base_est: "0" })] }),
    );
    expect([s.feesFirst[bucket("2026-09-21", W1Y)], s.feesSecond[bucket("2026-09-21", W1Y)]]).toEqual(["3", "1.5"]);
  });
});

describe("daySeries: the flows, swap volume and swaps (rule 3)", () => {
  const carried = { carryIn: poolDay("2026-09-10") };

  it("takes a bucket's candle: the volume on the native side (XRP / RLUSD is stored RLUSD / XRP: `counter_volume`) and its count", () => {
    const s = daySeries(seriesInput({ ...carried, candles: [poolCandle("2026-10-01")] }));
    expect([s.volume[bucket("2026-10-01")], s.swaps[bucket("2026-10-01")]]).toEqual(["1000", "4"]);
  });

  it("is 0 inside the pool's life for a bucket without a candle, or with a count of 0, whatever volume such a candle holds", () => {
    const s = daySeries(seriesInput({ ...carried, candles: [poolCandle("2026-10-01", { count: 0, base_volume: "0", counter_volume: "12" })] }));
    expect([s.volume[bucket("2026-10-01")], s.swaps[bucket("2026-10-01")]]).toEqual(["0", "0"]);
    expect([s.volume[bucket("2026-10-02")], s.swaps[bucket("2026-10-02")]]).toEqual(["0", "0"]);
  });

  it("takes the side of the first currency for a pool without the native currency: USDC / RLUSD, stored RLUSD / USDC, has its USDC as `counter_volume`", () => {
    const candle = poolCandle("2026-10-01", { counter_currency: USDC, counter_issuer: USDC_ISSUER, base_volume: "1300", counter_volume: "1000" });
    const s = daySeries(seriesInput({ pair: USDC_RLUSD, carryIn: usdcDay("2026-09-10"), candles: [candle] }));
    expect(s.volume[bucket("2026-10-01")]).toBe("1000");
  });

  it("takes the native side where it is the second currency: VOX / XRP's volume is its XRP, not the first's", () => {
    const candle = poolCandle("2026-10-01", { base_currency: VOX, base_issuer: VOX_ISSUER, base_volume: "800000", counter_volume: "1000" });
    const s = daySeries(seriesInput({ pair: VOX_XRP, carryIn: poolDay("2026-09-10", { base_currency: VOX, base_issuer: VOX_ISSUER }), candles: [candle] }));
    expect(s.volume[bucket("2026-10-01")]).toBe("1000");
  });

  it("reads the sides from the candle's own assets: a candle of XRP / RLUSD has its XRP in `base_volume`", () => {
    const candle = leaving(poolCandle("2026-10-01", { base_currency: "XRP", counter_currency: RLUSD, counter_issuer: RL, base_volume: "1000", counter_volume: "1300" }), "base_issuer");
    const s = daySeries(seriesInput({ ...carried, candles: [candle] }));
    expect(s.volume[bucket("2026-10-01")]).toBe("1000");
  });

  it("writes a volume and a count from their text and their digits, never through a float", () => {
    const s = daySeries(seriesInput({ ...carried, candles: [poolCandle("2026-10-01", { counter_volume: "1.5e+21", count: 9007199254740991 })] }));
    expect([s.volume[bucket("2026-10-01")], s.swaps[bucket("2026-10-01")]]).toEqual([`15${"0".repeat(20)}`, "9007199254740991"]);
  });

  it("aligns a candle by its start as a moment, as E3's candles are, and leaves out one that starts on no bucket", () => {
    const candles = [poolCandle("2026-10-01", { start: "2026-10-01T00:00:00.000Z" }), poolCandle("2026-10-18"), poolCandle("2026-10-05", { start: "2026-10-05T12:00:00Z" })];
    const s = daySeries(seriesInput({ ...carried, candles }));
    expect(s.volume[bucket("2026-10-01")]).toBe("1000");
    expect(s.volume.filter((value) => value !== "0")).toEqual(["1000"]);
  });
});

describe("daySeries: the fee estimates (rule 4)", () => {
  it("takes a day's estimates in the display pair: the XRP's is `fees_counter_est`, the RLUSD's `fees_base_est`", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01", { fees_counter_est: "2.5", fees_base_est: "1.5" })] }));
    expect([s.feesFirst[bucket("2026-10-01")], s.feesSecond[bucket("2026-10-01")]]).toEqual(["2.5", "1.5"]);
  });

  it("is null, not known, for a side whose estimate a row with swaps leaves out", () => {
    const s = daySeries(seriesInput({ days: [leaving(poolDay("2026-10-01", { swap_count: 20 }), "fees_base_est")] }));
    expect([s.feesFirst[bucket("2026-10-01")], s.feesSecond[bucket("2026-10-01")]]).toEqual(["2.5", null]);
  });

  it("is 0 for a row without swaps that leaves an estimate out, and for a quiet day inside the pool's life", () => {
    const s = daySeries(seriesInput({ days: [leaving(poolDay("2026-10-01", { swap_count: 0, deposit_count: 1 }), "fees_base_est", "fees_counter_est")] }));
    expect([s.feesFirst[bucket("2026-10-01")], s.feesSecond[bucket("2026-10-01")]]).toEqual(["0", "0"]);
    expect([s.feesFirst[bucket("2026-10-02")], s.feesSecond[bucket("2026-10-02")]]).toEqual(["0", "0"]);
    expect([s.feesFirst[bucket("2026-09-30")], s.feesSecond[bucket("2026-09-30")]]).toEqual([null, null]);
  });

  it("keeps a known zero as 0", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01", { fees_counter_est: "0", fees_base_est: "0.0" })] }));
    expect([s.feesFirst[bucket("2026-10-01")], s.feesSecond[bucket("2026-10-01")]]).toEqual(["0", "0"]);
  });

  it("writes an estimate in exponent form in plain digits (SNK/XRP's 1.250946e-8), and reads one that is no number as not known", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-01", { fees_base_est: "1.250946e-8", fees_counter_est: "abc" })] }));
    expect([s.feesFirst[bucket("2026-10-01")], s.feesSecond[bucket("2026-10-01")]]).toEqual([null, "0.00000001250946"]);
  });
});

describe("daySeries: an earlier pool of the pair, and the running day (rules 5 and 6)", () => {
  it("masks the pair's candles from before this pool's first day: an earlier pool's swaps are not this pool's", () => {
    const s = daySeries(seriesInput({ days: [poolDay("2026-10-12")], candles: [poolCandle("2026-10-01", { count: 9 }), poolCandle("2026-10-11"), poolCandle("2026-10-12")] }));
    expect([s.volume[bucket("2026-10-01")], s.swaps[bucket("2026-10-01")], s.volume[bucket("2026-10-11")]]).toEqual([null, null, null]);
    expect([s.volume[bucket("2026-10-12")], s.swaps[bucket("2026-10-12")]]).toEqual(["1000", "4"]);
  });

  /** A running day's candle, still forming: one swap so far. */
  const forming = [poolCandle("2026-10-17", { count: 1, counter_volume: "5" })];

  it("reads the running day from its row when the aggregator has written one, and its forming candle", () => {
    const days = [poolDay("2026-10-16", { value_native: "16" }), poolDay("2026-10-17", { value_native: "17" })];
    const s = daySeries(seriesInput({ carryIn: poolDay("2026-09-10"), days, candles: forming }));
    expect([s.value.at(-1), s.volume.at(-1), s.swaps.at(-1), s.feesFirst.at(-1)]).toEqual(["17", "5", "1", "2.5"]);
  });

  it("reads a running day with no row as a quiet day: the day before's state, no fee, and its forming candle", () => {
    const s = daySeries(seriesInput({ carryIn: poolDay("2026-09-10"), days: [poolDay("2026-10-16", { value_native: "16" })], candles: forming }));
    expect([s.value.at(-1), s.volume.at(-1), s.swaps.at(-1), s.feesFirst.at(-1), s.feesSecond.at(-1)]).toEqual(["16", "5", "1", "0", "0"]);
  });
});

describe("daySeries: a call that failed", () => {
  it("has no state and no fee estimate without the day rows, and takes the candles unmasked: there is no life to mask them with", () => {
    const s = daySeries(seriesInput({ deleted: true, days: null, candles: [poolCandle("2026-09-20"), poolCandle("2026-10-12")] }));
    for (const name of [...STATES, "feesFirst", "feesSecond"] as const) expect(s[name].every((value) => value === null), name).toBe(true);
    expect(s.volume.every((value) => value !== null)).toBe(true);
    expect([s.volume[bucket("2026-09-20")], s.volume[bucket("2026-09-21")], s.swaps[bucket("2026-10-12")]]).toEqual(["1000", "0", "4"]);
  });

  it("has no flow without the candles, and the states and fee estimates stand", () => {
    const s = daySeries(seriesInput({ carryIn: poolDay("2026-09-10"), days: [poolDay("2026-10-01")], candles: null }));
    expect(s.volume.every((value) => value === null)).toBe(true);
    expect(s.swaps.every((value) => value === null)).toBe(true);
    expect(s.value.every((value) => value === "3700000")).toBe(true);
    expect(s.feesFirst[bucket("2026-10-01")]).toBe("2.5");
  });
});

// ---- The pool's charts: the five cards ----------------------------------------------------------------------------------------------------------

/** The days of XRP / RLUSD over 30 days: a carry-in, three rows whose reserves move the price from 1.1968912 to 1.2903226 RLUSD per XRP, and three candles. */
const chartInput = (over: Partial<DaySeriesInput> = {}): DaySeriesInput =>
  seriesInput({
    carryIn: poolDay("2026-09-10", { reserve_base: "2310000", reserve_counter: "1930000" }),
    days: [
      poolDay("2026-09-20", { reserve_base: "2320000", reserve_counter: "1920000" }),
      poolDay("2026-10-01", { reserve_base: "2340000", reserve_counter: "1900000" }),
      poolDay("2026-10-16", { reserve_base: "2400000", reserve_counter: "1860000" }),
    ],
    candles: [poolCandle("2026-09-20"), poolCandle("2026-10-01"), poolCandle("2026-10-17")],
    ...over,
  });

function drawn<T>(part: ChartPart<T>): Extract<ChartPart<T>, { state: "ok" }> {
  if (part.state !== "ok") throw new Error(`the chart ${part.title} failed`);
  return part;
}

const KEEPS_NOTE = "A day without activity keeps the value of the day before.";
const DUST_NOTE = "Swaps with a XRP leg of 0.0005 or less are left out, as in every DEX aggregate of the data API.";
const HISTORY_SOURCE = "/v2/amm/pools/rhWTXC…tcS3/history?interval=day";

describe("poolCharts: the five cards", () => {
  it("draws every chart with its running bucket marked so far, on the window's buckets", () => {
    const charts = poolCharts(chartInput());
    for (const part of [charts.value, charts.volume, charts.price, charts.fee, charts.reserves]) {
      const { data } = drawn<TimeSeriesData | SmallMultiplesData>(part);
      expect(data.forming, part.title).toBe(true);
      expect(data.axis, part.title).toEqual({ unit: "day", buckets: W30.buckets });
    }
    expect(drawn(poolCharts(chartInput({ window: W1Y })).value).data.axis).toEqual({ unit: "week", buckets: W1Y.buckets });
  });

  it("titles the cards in the native currency and the display pair", () => {
    const charts = poolCharts(chartInput());
    expect([charts.value.title, charts.volume.title, charts.price.title, charts.fee.title, charts.reserves.title]).toEqual([
      "Pool value, in XRP",
      "Swap volume per day, in XRP",
      "Pool price, RLUSD per XRP",
      "Trading fee",
      "Reserves",
    ]);
  });

  it("titles the volume per week over a year, and in the first currency for a pool without the native currency", () => {
    expect(poolCharts(chartInput({ window: W1Y })).volume.title).toBe("Swap volume per week, in XRP");
    const usdc = poolCharts(seriesInput({ pair: USDC_RLUSD, carryIn: usdcDay("2026-09-10"), days: [usdcDay("2026-10-01")] }));
    expect([usdc.value.title, usdc.volume.title, usdc.price.title]).toEqual(["Pool value, in XRP", "Swap volume per day, in USDC", "Pool price, RLUSD per USDC"]);
    expect(drawn(usdc.volume).data.format).toEqual({ kind: "amount", unit: "USDC" });
  });

  it("names the routes: the short pool for the cards of the day rows, the pair's AMM candles for the volume", () => {
    const charts = poolCharts(chartInput());
    for (const part of [charts.value, charts.price, charts.fee, charts.reserves]) expect(drawn<unknown>(part).source, part.title).toBe(HISTORY_SOURCE);
    expect(drawn(charts.volume).source).toBe("/v2/exchanges/{base}/{counter}?amm=only&interval=1day");
    expect(drawn(poolCharts(chartInput({ window: W1Y })).volume).source).toBe("/v2/exchanges/{base}/{counter}?amm=only&interval=7day");
  });

  it("draws the value in the native currency, with its two notes", () => {
    const input = chartInput();
    const value = drawn(poolCharts(input).value);
    expect(value.data.series).toEqual([{ id: "value", label: "Pool value", slot: 1, values: daySeries(input).value }]);
    expect(value.data.format).toEqual({ kind: "value", unit: "XRP" });
    expect(value.data.domain).toBeUndefined();
    expect(value.notes).toEqual([KEEPS_NOTE, NOT_COMPUTED_NOTE]);
  });

  it("says why a pool with no value anywhere has none", () => {
    const value = drawn(poolCharts(seriesInput({ pair: USDC_RLUSD, carryIn: usdcDay("2026-09-10"), days: [usdcDay("2026-10-01")] })).value);
    expect(value.data.series[0]!.values.every((v) => v === null)).toBe(true);
    expect(value.notes).toEqual(["No value in XRP: neither asset of this pool has a XRP rate.", NOT_COMPUTED_NOTE]);
  });

  it("says nothing of a rate where the pool is not in the window at all, or where it holds the native currency", () => {
    // No day of the pool: the chart's "No data", not a pool without a rate.
    expect(drawn(poolCharts(seriesInput({ pair: USDC_RLUSD })).value).notes).toEqual([KEEPS_NOTE, NOT_COMPUTED_NOTE]);
    // XRP / RLUSD deleted on the first day of the window: the one day of its life has no value, and the pool holds XRP.
    const deletion = leaving(poolDay(W30.start), "reserve_base", "reserve_counter", "trading_fee", "value_native");
    expect(drawn(poolCharts(seriesInput({ deleted: true, days: [deletion] })).value).notes).toEqual([KEEPS_NOTE, NOT_COMPUTED_NOTE]);
  });

  it("draws the volume from the candles, with the extras Swaps and the fee estimates of both sides, in the display order", () => {
    const input = chartInput();
    const series = daySeries(input);
    const volume = drawn(poolCharts(input).volume);
    expect(volume.data.series).toEqual([{ id: "volume", label: "Swap volume", slot: 1, values: series.volume }]);
    expect(volume.data.format).toEqual({ kind: "amount", unit: "XRP" });
    expect(volume.data.extras).toEqual([
      { id: "swaps", label: "Swaps", values: series.swaps, format: { kind: "count" } },
      { id: "fees-first", label: "Fees, est., XRP", values: series.feesFirst, format: { kind: "amount", unit: "XRP" } },
      { id: "fees-second", label: "Fees, est., RLUSD", values: series.feesSecond, format: { kind: "amount", unit: "RLUSD" } },
    ]);
    expect(volume.notes).toEqual([DUST_NOTE, NOT_COMPUTED_NOTE]);
  });

  it("draws the price, the second per the first, from the nice floor of its values, and says where the axis starts", () => {
    const input = chartInput();
    const price = drawn(poolCharts(input).price);
    expect(price.data.series).toEqual([{ id: "price", label: "Pool price", slot: 1, values: daySeries(input).price }]);
    expect(price.data.series[0]!.values[0]).toBe("1.1968912");
    expect(price.data.series[0]!.values.at(-1)).toBe("1.2903226");
    expect(price.data.format).toEqual({ kind: "price", unit: "RLUSD" });
    // A third of the range (0.0934314) is a step of 0.05, and the lowest price's multiple of it is 1.15: the axis's own start, with no top (P13).
    expect(price.data.domain).toEqual({ min: "1.15" });
    expect(price.notes).toEqual(["The axis starts at 1.15 RLUSD.", NOT_COMPUTED_NOTE]);
  });

  it("starts the price axis at 0, with no note, when the floor is not above 0 and when the price does not move", () => {
    // From 0.5 to 10 RLUSD per XRP: a third of the range is a step of 5, and the lowest price's multiple of it is 0.
    const days = [poolDay("2026-10-01", { reserve_base: "1", reserve_counter: "2" }), poolDay("2026-10-02", { reserve_base: "10", reserve_counter: "1" })];
    const wide = drawn(poolCharts(seriesInput({ days })).price);
    expect(wide.data.domain).toBeUndefined();
    expect(wide.notes).toEqual([NOT_COMPUTED_NOTE]);
    const flat = drawn(poolCharts(seriesInput({ carryIn: poolDay("2026-09-10") })).price);
    expect(flat.data.domain).toBeUndefined();
    expect(flat.notes).toEqual([NOT_COMPUTED_NOTE]);
  });

  it("writes the axis start of an extreme price in plain digits", () => {
    const days = [poolDay("2026-10-01", { reserve_base: "1e-30", reserve_counter: "1e+30" }), poolDay("2026-10-02", { reserve_base: "1.5e-30", reserve_counter: "1e+30" })];
    const price = drawn(poolCharts(seriesInput({ days })).price);
    expect(price.data.domain).toEqual({ min: `0.${"0".repeat(59)}1` });
    expect(price.notes[0]).toBe(`The axis starts at 0.${"0".repeat(59)}1 RLUSD.`);
  });

  it("draws the trading fee in percent, from 0, with its notes", () => {
    const fee = drawn(poolCharts(chartInput()).fee);
    expect(fee.data.series).toEqual([{ id: "fee", label: "Trading fee", slot: 1, values: Array(30).fill("0.205") }]);
    expect(fee.data.format).toEqual({ kind: "percent" });
    // A line with no domain starts at 0 (niceScale's bottom is 0 unless a value is below it): no note is owed.
    expect(fee.data.domain).toBeUndefined();
    expect(fee.notes).toEqual(["Each vote moves the fee; the Votes and bids tab lists them.", NOT_COMPUTED_NOTE]);
  });

  it("draws the reserves as two panels, each with its currency, its issuer and its own scale", () => {
    const input = chartInput();
    const series = daySeries(input);
    const reserves = drawn(poolCharts(input).reserves);
    expect(reserves.data.panels).toEqual([
      { id: "first", label: "XRP", values: series.reserveFirst, format: { kind: "amount", unit: "XRP" } },
      { id: "second", label: "RLUSD", sublabel: "rMxCKb…m5De", values: series.reserveSecond, format: { kind: "amount", unit: "RLUSD" } },
    ]);
    expect(reserves.notes).toEqual(["Each asset on its own scale.", NOT_COMPUTED_NOTE]);
  });

  it("writes a currency with no text as the hex formatCurrency writes, in the titles, the units and the labels", () => {
    const charts = poolCharts(seriesInput({ pair: VOX_XRP, carryIn: poolDay("2026-09-10", { base_currency: VOX, base_issuer: VOX_ISSUER }) }));
    expect(charts.price.title).toBe("Pool price, XRP per 564F58F0…");
    expect(drawn(charts.reserves).data.panels.map((panel) => [panel.label, panel.sublabel])).toEqual([
      ["564F58F0…", "rBnJZM…6Hk3"],
      ["XRP", undefined],
    ]);
    expect(drawn(charts.volume).data.extras!.map((extra) => extra.label)).toEqual(["Swaps", "Fees, est., 564F58F0…", "Fees, est., XRP"]);
  });
});

describe("poolCharts: what failed", () => {
  it("fails the four cards of the day rows without them, and draws the volume without its fee estimates, unmasked, and says so", () => {
    const input = chartInput({ days: null });
    const charts = poolCharts(input);
    // A failed card keeps its title and its source line, as a failed card shows them.
    const source = `/v2/amm/pools/${shortAddress(AMM_POOL)}/history?interval=day`;
    expect(charts.value).toEqual({ state: "failed", title: "Pool value, in XRP", source, what: "the pool value" });
    expect(charts.price).toEqual({ state: "failed", title: "Pool price, RLUSD per XRP", source, what: "the pool price" });
    expect(charts.fee).toEqual({ state: "failed", title: "Trading fee", source, what: "the trading fee" });
    expect(charts.reserves).toEqual({ state: "failed", title: "Reserves", source, what: "the reserves" });
    const volume = drawn(charts.volume);
    expect(volume.data.extras!.map((extra) => extra.id)).toEqual(["swaps"]);
    expect(volume.data.series[0]!.values.every((value) => value !== null)).toBe(true);
    expect(volume.notes).toEqual([DUST_NOTE, "The fee estimates couldn't be loaded."]);
  });

  it("fails the volume card alone without the candles", () => {
    const charts = poolCharts(chartInput({ candles: null }));
    expect(charts.volume).toEqual({ state: "failed", title: "Swap volume per day, in XRP", source: "/v2/exchanges/{base}/{counter}?amm=only&interval=1day", what: "the swap volume" });
    // A year's candles are weekly, and so is the failed card's source line.
    expect(poolCharts(chartInput({ window: W1Y, candles: null })).volume).toMatchObject({ state: "failed", source: "/v2/exchanges/{base}/{counter}?amm=only&interval=7day" });
    for (const part of [charts.value, charts.price, charts.fee, charts.reserves]) expect(part.state, part.title).toBe("ok");
  });

  it("fails all five cards without a window (#3 failed): the charts", () => {
    const charts = poolCharts(null);
    expect(charts).toEqual({
      // No window, so no interval, and no pool is given: the source lines' general forms (the page draws one error in place of the five cards).
      value: { state: "failed", title: "Pool value", source: "/v2/amm/pools/{pool}/history?interval=day", what: "the charts" },
      volume: { state: "failed", title: "Swap volume", source: "/v2/exchanges/{base}/{counter}?amm=only", what: "the charts" },
      price: { state: "failed", title: "Pool price", source: "/v2/amm/pools/{pool}/history?interval=day", what: "the charts" },
      fee: { state: "failed", title: "Trading fee", source: "/v2/amm/pools/{pool}/history?interval=day", what: "the charts" },
      reserves: { state: "failed", title: "Reserves", source: "/v2/amm/pools/{pool}/history?interval=day", what: "the charts" },
    });
  });
});

describe("poolCharts: the tokens", () => {
  const tokens = (input: DaySeriesInput) => {
    const charts = poolCharts(input);
    return Object.fromEntries(Object.entries(charts).map(([name, part]) => [name, drawn<{ token: string }>(part).data.token]));
  };

  it("is the hash of what each chart draws, and the same for the same input", () => {
    const charts = poolCharts(chartInput());
    for (const part of [charts.value, charts.volume, charts.price, charts.fee, charts.reserves]) {
      const { token, ...rest } = drawn<{ token: string }>(part).data;
      expect(token, part.title).toBe(tokenOf(rest));
    }
    expect(tokens(chartInput())).toEqual(tokens(chartInput()));
  });

  it("changes with one value, and with one extra", () => {
    const before = tokens(chartInput());
    const valued = tokens(chartInput({ days: [poolDay("2026-09-20", { reserve_base: "2320000", reserve_counter: "1920000", value_native: "3700001" })] }));
    expect(valued.value).not.toBe(before.value);
    const days = chartInput().days!.map((row) => (row.date.startsWith("2026-10-01") ? { ...row, fees_base_est: "1.6" } : row));
    const fees = tokens(chartInput({ days }));
    expect(fees.volume).not.toBe(before.volume);
    expect(fees.value).toBe(before.value);
  });
});

describe("poolCharts: the recorded days", () => {
  const dir = new URL("../../test/fixtures/http/xrpl/data-api/", import.meta.url);
  const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, dir), "utf8")) as T;
  const assetText = (currency: string, issuer?: string) => (issuer ? `${currency}+${issuer}` : currency);
  /** The input of a recorded pool's charts for a period, from the files the loader's calls #4, #5 and #6 read. */
  function recorded(pool: string, period: WindowPeriod): DaySeriesInput {
    const window = windowOf(DAY_T, period);
    const stored = json<{ pool: AmmPool }>(`amm/pools/${pool}.json`).pool;
    const base = { currency: stored.base_currency, ...(stored.base_issuer ? { issuer: stored.base_issuer } : {}) };
    const counter = { currency: stored.counter_currency, ...(stored.counter_issuer ? { issuer: stored.counter_issuer } : {}) };
    const days = json<Page<"days", AmmPoolDay>>(`amm/pools/${pool}/history@end=${DAY_T}&interval=day&limit=1000&start=${window.start}.json`).days;
    const carryIn = json<Page<"days", AmmPoolDay>>(`amm/pools/${pool}/history@descending=true&end=${addDays(window.start, -1)}&interval=day&limit=1.json`).days[0] ?? null;
    const interval = period === "1y" ? "7day" : "1day";
    const candles = json<Page<"exchanges", Candle>>(
      `exchanges/${assetText(base.currency, base.issuer)}/${assetText(counter.currency, counter.issuer)}@amm=only&end=${DAY_T}&interval=${interval}&limit=400&start=${window.start}.json`,
    ).exchanges;
    return { window, pair: displayPair(base, counter, "XRP"), native: "XRP", pool, deleted: stored.deleted, days, carryIn, candles };
  }
  const SNK = "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz";
  const USD_XRP = "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am";
  const DVR = "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG";
  const USDC_POOL = "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb";
  const withoutIds = (text: string): string => withoutHashes(text.replace(/"token":"[0-9a-f]{8}"/g, "").replace(/r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}/g, ""));

  it("reads XRP / RLUSD over 30 days: the quiet days keep the day before, and Oct 10's unknown estimates are null", () => {
    const input = recorded(AMM_POOL, "30d");
    const s = daySeries(input);
    for (const name of [...STATES, "volume", "swaps"] as const) expect(s[name].every((value) => value !== null), name).toBe(true);
    // Sep 23 has no row: the value of Sep 22, no fee, and no candle.
    expect([s.value[bucket("2026-09-23")], s.feesFirst[bucket("2026-09-23")], s.volume[bucket("2026-09-23")]]).toEqual(["3851200.9", "0", "0"]);
    // Oct 10 is the synthetic day with swaps and neither estimate.
    expect([s.feesFirst[bucket("2026-10-10")], s.feesSecond[bucket("2026-10-10")]]).toEqual([null, null]);
    // Oct 17, the running day: its row and its candle, the XRP side (the stored counter).
    const last = input.days!.at(-1)!;
    const candle = input.candles!.at(-1)!;
    expect([s.price.at(-1), s.reserveFirst.at(-1), s.volume.at(-1), s.swaps.at(-1)]).toEqual([
      exactRatio(last.reserve_base, last.reserve_counter),
      last.reserve_counter,
      candle.counter_volume,
      String(candle.count),
    ]);
    expect(s.feesFirst.at(-1)).toBe(last.fees_counter_est);
  });

  it("starts XRP / RLUSD's 30-day price axis at 1.2 RLUSD, the nice floor of its recorded prices, and says so", () => {
    const price = drawn(poolCharts(recorded(AMM_POOL, "30d")).price);
    // From 1.2003 (Sep 18) to 1.3083 (Oct 17) RLUSD per XRP: a third of the range is a step of 0.05, and the lowest price's multiple of it is 1.2.
    const prices = price.data.series[0]!.values.map((value) => new BigNumber(value!));
    const lowest = BigNumber.minimum(...prices);
    expect(lowest.gte("1.2") && lowest.lt("1.25")).toBe(true);
    expect(price.data.domain).toEqual({ min: "1.2" });
    expect(price.notes).toEqual(["The axis starts at 1.2 RLUSD.", NOT_COMPUTED_NOTE]);
  });

  it("reads SNK/XRP over the year: deleted on Nov 11, 2025, in its week; the estimates in exponent form in plain digits", () => {
    const s = daySeries(recorded(SNK, "1y"));
    const week = bucket("2025-11-10", W1Y);
    for (const name of SERIES) expect(s[name].slice(week + 1).every((value) => value === null), name).toBe(true);
    // The deletion day's row closes the pool with empty reserves: no price, and no value.
    expect([s.reserveFirst[week], s.reserveSecond[week], s.price[week], s.value[week], s.fee[week]]).toEqual(["0", "0", null, null, "0.25"]);
    // SNK is the first side and the stored base. The week of Oct 20 has rows on Oct 22, 24, 25 and 26; that of Nov 10 on Nov 10 and 11.
    expect([s.feesFirst[0], s.feesSecond[0]]).toEqual(["0.0000000269195425", "0.0000067525"]);
    expect([s.feesFirst[week], s.feesSecond[week]]).toEqual(["0.000000017674735", "0.0000032275"]);
    expect([s.volume[0], s.swaps[0]]).toEqual(["0.006018", "7"]);
  });

  it("reads SNK/XRP over 30 and 90 days as nothing: it was deleted before those windows", () => {
    for (const period of ["30d", "90d"] as const) {
      const s = daySeries(recorded(SNK, period));
      for (const name of SERIES) expect(s[name].every((value) => value === null), `${period} ${name}`).toBe(true);
    }
  });

  it("reads DVR/XRP over 30 days from its creation, Oct 12: it has no carry-in", () => {
    const input = recorded(DVR, "30d");
    expect(input.carryIn).toBeNull();
    const s = daySeries(input);
    const first = bucket("2026-10-12");
    for (const name of SERIES) {
      expect(s[name].slice(0, first).every((value) => value === null), name).toBe(true);
      expect(s[name].slice(first).every((value) => value !== null), name).toBe(true);
    }
  });

  it("reads USDC / RLUSD over 90 days: the volume in USDC, and no value in XRP", () => {
    const charts = poolCharts(recorded(USDC_POOL, "90d"));
    expect(charts.volume.title).toBe("Swap volume per day, in USDC");
    expect(drawn(charts.value).notes[0]).toBe("No value in XRP: neither asset of this pool has a XRP rate.");
    expect(drawn(charts.volume).data.series[0]!.values.some((value) => value !== null && value !== "0")).toBe(true);
  });

  it("has no exponent in any chart of the recorded pools, at every period they have (P38)", () => {
    const cases: [string, WindowPeriod][] = [
      [AMM_POOL, "30d"],
      [AMM_POOL, "90d"],
      [AMM_POOL, "1y"],
      [USD_XRP, "90d"],
      [USDC_POOL, "90d"],
      [DVR, "30d"],
      [SNK, "30d"],
      [SNK, "90d"],
      [SNK, "1y"],
    ];
    for (const [pool, period] of cases) {
      const charts = poolCharts(recorded(pool, period));
      for (const part of Object.values(charts)) expect(part.state, `${pool} ${period} ${part.title}`).toBe("ok");
      expect(withoutIds(JSON.stringify(charts)), `${pool} ${period}`).not.toMatch(EXPONENT);
    }
    // The year of SNK/XRP does hold estimates in exponent form, so the test is not vacuous.
    expect(recorded(SNK, "1y").days!.some((row) => /e-/.test(row.fees_base_est ?? ""))).toBe(true);
  });
});

// ---- The pool page: its modes, its queries, its facts and its two builders ----------------------------------------------------------------------
// T is Oct 17, 2026 (LAST's close time) and the default period is 90 days. The pool is XRP / RLUSD, stored RLUSD / XRP; the index and the node are told
// apart by their figures (the index's reserves, LP supply and fee differ from the node's).

const POOL_NET: AmmPoolInput["net"] = { id: "xrpl", name: "XRPL", native: "XRP", features: { ...NO_FEATURES, ammPages: true, markets: true } };
const QUERY: AmmPoolQuery = { period: "90d", tab: "swaps", back: [] };
const notFound = (message = "pool not found"): UpstreamError => new UpstreamError("not_found", message, { status: 404 });
const serverError = (message = "data API GET /v2/amm/pools/rhWTXC… answered 503"): UpstreamError => new UpstreamError("server", message, { status: 503 });
const unixAt = (iso: string): number => Date.parse(iso) / 1000;
const EXPIRATION = unixAt("2026-10-18T09:00:00Z");
const CREATED_AT = "2024-03-22T10:15:20Z";
/** A stat that could not be loaded says so as a `SectionError` would: a typographic apostrophe. */
const COULD_NOT = "Couldn’t load";
const ESTIMATE = "estimate, paid to liquidity providers";

const voteSlot = (account: string, trading_fee: number, vote_weight: number) => ({ account, trading_fee, vote_weight });

/** The node's XRP / RLUSD: a fee of 0.300% from three votes, and a slot held in its interval 12 until Oct 18, 2026, 09:00 UTC. */
function poolInfo(over: Partial<AmmInfo> = {}): AmmInfo {
  return {
    account: AMM_POOL,
    amount: { currency: "XRP", value: "1847691.034536" },
    amount2: { currency: RLUSD, issuer: RL, value: "2417282.053464318" },
    lp_token: { currency: LP_CURRENCY, issuer: AMM_POOL, value: "1791055986.845366" },
    trading_fee: 300,
    vote_slots: [voteSlot(AMM_HOLDER, 300, 50000), voteSlot(AMM_ACCOUNT, 250, 30000), voteSlot(AMM_OTHER, 400, 20000)],
    auction_slot: heldSlot({ time_interval: 12, expiration: EXPIRATION }),
    ledger_index: 107721455,
    ...over,
  };
}

/** The index's XRP / RLUSD: other reserves and LP supply than the node's, a fee of 0.205%, and the sample's auction slot (held by AMM_HOLDER until Oct 18, 09:00). */
const indexPool = (over: Partial<AmmPool> = {}): AmmPool =>
  xrpRlusd({ reserve_base: "2400000", reserve_counter: "1800000", lp_supply: "1790000000", last_ledger: 107717584, ...over });

/** USDC / RLUSD as the index stores it (RLUSD / USDC, P35), and as the node has it. */
const usdcPool = (over: Partial<AmmPool> = {}): AmmPool =>
  indexPool({ counter_currency: USDC, counter_issuer: USDC_ISSUER, reserve_base: "26100", reserve_counter: "26200", value_native: "52345.6", ...over });
const usdcInfo = (over: Partial<AmmInfo> = {}): AmmInfo =>
  poolInfo({ amount: { currency: RLUSD, issuer: RL, value: "26100" }, amount2: { currency: USDC, issuer: USDC_ISSUER, value: "26200" }, ...over });

const daysPage = (days: AmmPoolDay[]): Page<"days", AmmPoolDay> => ({ result: "success", count: days.length, days });
const candlesPage = (exchanges: Candle[]): Page<"exchanges", Candle> => ({ result: "success", count: exchanges.length, exchanges });
const createEvent = (over: Partial<AmmLiquidityEvent> = {}): AmmLiquidityEvent =>
  leaving(ammLiquiditySample({ event: "create", executed_time: CREATED_AT, ledger_index: 86_800_123, tx_index: 5, ...over }), "mode");
/** A swap of the pool in its stored pair, RLUSD / XRP: the pool paid out 1,250 RLUSD for 512.4 XRP. */
const rlusdSwap = (over: Partial<AmmSwap> = {}): AmmSwap => ammSwapSample({ base_currency: RLUSD, base_issuer: RL, base_amount: "1250", counter_amount: "512.4", ...over });
/** A page of swaps; `marker` `null` for the last page. */
const swapsPage = (exchanges: AmmSwap[] = [rlusdSwap()], marker: string | null = AMM_MARKER): Page<"exchanges", AmmSwap> => ({
  result: "success",
  count: exchanges.length,
  ...(marker === null ? {} : { marker }),
  exchanges,
});

/** A first page of XRP / RLUSD at 90 days, everything answering. */
function poolInput(over: Partial<AmmPoolInput> = {}): AmmPoolInput {
  return {
    net: POOL_NET,
    pool: AMM_POOL,
    query: QUERY,
    mode: "indexed",
    index: indexPool(),
    node: fulfilled(poolInfo()),
    last: fulfilled(LAST),
    days: fulfilled(daysPage([poolDay("2026-08-01"), poolDay("2026-10-16")])),
    carryIn: fulfilled(daysPage([poolDay("2026-07-01")])),
    lastDay: fulfilled(daysPage([poolDay("2026-10-16", { fees_counter_est: "12.5", fees_base_est: "30.1" })])),
    candles: fulfilled(candlesPage([poolCandle("2026-10-16")])),
    activity: fulfilled(swapsPage()),
    created: fulfilled({ result: "success", count: 1, liquidity: [createEvent()] }),
    live: fulfilled(liveOf([component()])),
    ...over,
  };
}

const poolPage = (over: Partial<AmmPoolInput> = {}): AmmPoolPageData => ammPoolPage(poolInput(over)).page;

function stateOf(page: AmmPoolPageData) {
  if (page.state === null) throw new Error("the page has no state card");
  return page.state;
}

/** A stat of the state card by its id, as a single figure (all but the reserves). */
function statOf(page: AmmPoolPageData, id: Exclude<AmmStat["id"], "reserves">) {
  const stat = stateOf(page).stats.find((candidate) => candidate.id === id);
  if (stat === undefined || stat.id === "reserves") throw new Error(`no stat ${id}`);
  return stat;
}

function reservesOf(page: AmmPoolPageData): [string, string] {
  const stat = stateOf(page).stats.find((candidate) => candidate.id === "reserves");
  if (stat === undefined || stat.id !== "reserves") throw new Error("no reserves");
  return stat.reserves;
}

function slotOfPage(page: AmmPoolPageData) {
  if (page.slot === null || page.slot.state !== "ok") throw new Error("the slot card is not drawn");
  return page.slot;
}

function listOfPage(page: { activity: AmmPoolPageData["activity"] }) {
  if (page.activity.list.state !== "ok") throw new Error("the activity failed");
  return page.activity.list;
}

describe("poolModeOf: every answer of the index (#1) against every answer of the node (#2) (spec 3.3, Review Focus 2)", () => {
  const INDEX: Record<string, PromiseSettledResult<AmmPool>> = {
    "a live pool": fulfilled(indexPool()),
    "a deleted pool": fulfilled(indexPool({ deleted: true })),
    "pool not found": rejected(notFound()),
    "a 503": rejected(serverError()),
    // An API without the AMM routes: data-api.ts reads its "Cannot GET" 404 as kind `server`, an outage.
    'a "Cannot GET" 404': rejected(new UpstreamError("server", "data API GET /v2/amm/pools/rhWTXC… answered 404: Cannot GET /v2/amm/pools/rhWTXC…", { status: 404 })),
    "a bad_request": rejected(new UpstreamError("bad_request", "data API GET /v2/amm/pools/rhWTXC… answered 400", { status: 400 })),
    "a 429": rejected(new UpstreamError("rate_limited", "data API answered 429", { status: 429, retryAfter: 7 })),
    "a timeout": rejected(new UpstreamError("timeout")),
    "too late": rejected(new TooLate()),
    "a bug": rejected(new TypeError("x is undefined")),
  };
  const NODE: Record<string, PromiseSettledResult<AmmInfo>> = {
    "the pool": fulfilled(poolInfo()),
    actNotFound: rejected(new UpstreamError("not_found", "node amm_info: actNotFound")),
    actMalformed: rejected(new UpstreamError("not_found", "node amm_info: actMalformed")),
    "a server error": rejected(new UpstreamError("server", "node amm_info answered 502", { status: 502 })),
    "a timeout": rejected(new UpstreamError("timeout")),
    "too late": rejected(new TooLate()),
  };
  const failures = ["a 503", 'a "Cannot GET" 404', "a bad_request", "a 429", "a timeout", "too late", "a bug"];
  const EXPECTED: Record<string, Record<string, AmmPoolMode>> = {
    "a live pool": { "the pool": "indexed", actNotFound: "gone", actMalformed: "gone", "a server error": "node-down", "a timeout": "node-down", "too late": "node-down" },
    "a deleted pool": Object.fromEntries(Object.keys(NODE).map((node) => [node, "deleted"])),
    "pool not found": { "the pool": "network", actNotFound: "none", actMalformed: "none", "a server error": "unavailable", "a timeout": "unavailable", "too late": "unavailable" },
    ...Object.fromEntries(failures.map((index) => [index, Object.fromEntries(Object.keys(NODE).map((node) => [node, "unavailable"]))])),
  };

  it("has an answer for every combination", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(INDEX).sort());
    for (const row of Object.values(EXPECTED)) expect(Object.keys(row).sort()).toEqual(Object.keys(NODE).sort());
  });

  for (const [index, row] of Object.entries(EXPECTED)) {
    for (const [node, mode] of Object.entries(row)) {
      it(`${index} and ${node}: ${mode}`, () => {
        expect(poolModeOf(INDEX[index]!, NODE[node]!)).toBe(mode);
      });
    }
  }

  it("is a 404 only when both say the pool is missing: no failure of either side is ever 'none'", () => {
    for (const [index, row] of Object.entries(EXPECTED)) {
      for (const [node, mode] of Object.entries(row)) {
        if (mode === "none") expect([index, node]).toEqual(["pool not found", expect.stringMatching(/^act/)]);
      }
    }
  });
});

describe("MODE_CLASS", () => {
  it("is the class of each mode that is a page: the network's pool kept 60 s", () => {
    expect(MODE_CLASS).toEqual({
      indexed: { cls: "live" },
      "node-down": { cls: "live" },
      gone: { cls: "live" },
      deleted: { cls: "slow" },
      network: { cls: "short", ttl: 60 },
    });
  });

  it("has no class for 'none' and 'unavailable', which are a 404 and a 503", () => {
    expect(Object.keys(MODE_CLASS)).not.toContain("none");
    expect(Object.keys(MODE_CLASS)).not.toContain("unavailable");
  });
});

describe("poolQueries", () => {
  it("asks for 30 days: the days of the window, the day before it, the day before T and the daily candles", () => {
    expect(poolQueries(windowOf(DAY_T, "30d"), DAY_T)).toEqual({
      days: { start: "2026-09-18", end: "2026-10-17", limit: 1000 },
      carryIn: { end: "2026-09-17", descending: true, limit: 1 },
      lastDay: { start: "2026-10-16", end: "2026-10-16", limit: 1 },
      candles: { interval: "1day", start: "2026-09-18", end: "2026-10-17", limit: 400, amm: "only" },
    });
  });

  it("asks for 90 days from Jul 20, with the carry-in of Jul 19", () => {
    const q = poolQueries(windowOf(DAY_T, "90d"), DAY_T);
    expect(q.days).toEqual({ start: "2026-07-20", end: "2026-10-17", limit: 1000 });
    expect(q.carryIn).toEqual({ end: "2026-07-19", descending: true, limit: 1 });
    expect(q.candles).toEqual({ interval: "1day", start: "2026-07-20", end: "2026-10-17", limit: 400, amm: "only" });
    expect(q.lastDay).toEqual({ start: "2026-10-16", end: "2026-10-16", limit: 1 });
  });

  it("asks for the year from Monday Oct 20, 2025, with the carry-in of Oct 19 and weekly candles", () => {
    const q = poolQueries(windowOf(DAY_T, "1y"), DAY_T);
    expect(q.days).toEqual({ start: "2025-10-20", end: "2026-10-17", limit: 1000 });
    expect(q.carryIn).toEqual({ end: "2025-10-19", descending: true, limit: 1 });
    expect(q.candles).toEqual({ interval: "7day", start: "2025-10-20", end: "2026-10-17", limit: 400, amm: "only" });
    // The last day is the same for every period: one key.
    expect(q.lastDay).toEqual({ start: "2026-10-16", end: "2026-10-16", limit: 1 });
  });

  it("works out the day before across a month and a year", () => {
    expect(poolQueries(windowOf("2026-03-01", "30d"), "2026-03-01").lastDay).toEqual({ start: "2026-02-28", end: "2026-02-28", limit: 1 });
    expect(poolQueries(windowOf("2026-01-01", "30d"), "2026-01-01").carryIn.end).toBe("2025-12-02");
  });
});

describe("storedPair", () => {
  it("is the index's base and counter, in the order the API stores them", () => {
    expect(storedPair({ index: indexPool() })).toEqual([{ currency: RLUSD, issuer: RL }, { currency: "XRP" }]);
    expect(storedPair({ index: usdcPool() })).toEqual([{ currency: RLUSD, issuer: RL }, { currency: USDC, issuer: USDC_ISSUER }]);
  });

  it("puts the node's two amounts, without their values, in the order the API stores the pair, whichever order the node gives them in", () => {
    const stored = [{ currency: RLUSD, issuer: RL }, { currency: "XRP" }];
    expect(storedPair({ node: poolInfo() })).toEqual(stored);
    expect(storedPair({ node: poolInfo({ amount: poolInfo().amount2, amount2: poolInfo().amount }) })).toEqual(stored);
    // As the index stores the same pool: the candles of a pool from the network are asked for as they would be once the index has it.
    expect(storedPair({ node: usdcInfo() })).toEqual(storedPair({ index: usdcPool() }));
    expect(storedPair({ node: usdcInfo({ amount: usdcInfo().amount2, amount2: usdcInfo().amount }) })).toEqual(storedPair({ index: usdcPool() }));
  });
});

describe("ammPoolFacts", () => {
  it("names the pair as a slug, the node's fee, the index's value, compact, and the day of the creation", () => {
    expect(ammPoolFacts(POOL_NET, AMM_POOL, indexPool(), poolInfo(), createEvent())).toEqual({
      pool: AMM_POOL,
      net: "xrpl",
      native: "XRP",
      pair: "XRP/RLUSD",
      text: "XRP / RLUSD",
      deleted: false,
      fee: "0.300%",
      value: "3.61M",
      created: { date: "2024-03-22", at: unixAt(CREATED_AT) },
    });
  });

  it("takes the index's fee without the node, and leaves out what neither has", () => {
    const facts = ammPoolFacts(POOL_NET, AMM_POOL, leaving(indexPool(), "value_native"), null, null);
    expect(facts).toEqual({ pool: AMM_POOL, net: "xrpl", native: "XRP", pair: "XRP/RLUSD", text: "XRP / RLUSD", deleted: false, fee: "0.205%" });
  });

  it("has no value for a deleted pool", () => {
    const facts = ammPoolFacts(POOL_NET, AMM_POOL, indexPool({ deleted: true }), null, null);
    expect(facts.deleted).toBe(true);
    expect(facts).not.toHaveProperty("value");
  });

  it("names the pair from the node for a pool the index does not have, and has no value", () => {
    const facts = ammPoolFacts(POOL_NET, AMM_POOL, null, usdcInfo(), null);
    expect(facts).toMatchObject({ pair: "USDC/RLUSD", text: "USDC / RLUSD", fee: "0.300%", deleted: false });
    expect(facts).not.toHaveProperty("value");
  });

  it("reads the creation only from a create event", () => {
    expect(ammPoolFacts(POOL_NET, AMM_POOL, indexPool(), poolInfo(), createEvent({ event: "deposit" }))).not.toHaveProperty("created");
  });
});

describe("createdOf", () => {
  const liquidity = (rows: AmmLiquidityEvent[]): Page<"liquidity", AmmLiquidityEvent> => ({ result: "success", count: rows.length, liquidity: rows });

  it("is the first row of #8's page when it is a create event", () => {
    const event = createEvent();
    expect(createdOf(liquidity([event]))).toBe(event);
  });

  it("is null for an empty page, a row of another event and a create event without a time", () => {
    expect(createdOf(liquidity([]))).toBeNull();
    expect(createdOf(liquidity([createEvent({ event: "deposit" })]))).toBeNull();
    expect(createdOf(liquidity([createEvent({ executed_time: "not a time" })]))).toBeNull();
  });

  it("is what the pool page's Created line and the facts of its tags (and so its image) read", () => {
    const page = liquidity([createEvent()]);
    const facts = ammPoolFacts(POOL_NET, AMM_POOL, indexPool(), poolInfo(), createdOf(page));
    expect(facts.created).toEqual({ date: "2024-03-22", at: unixAt(CREATED_AT) });
    expect(poolPage({ created: fulfilled(page) }).header.created?.date).toBe(facts.created?.date);
  });
});

describe("ammPoolPage: the crumbs and the pool card", () => {
  it("has the crumbs of the list and the pair as a slug, the last one the page", () => {
    expect(poolPage().crumbs).toEqual([{ label: "XRPL", href: "/xrpl" }, { label: "AMM pools", href: "/xrpl/amm" }, { label: "XRP/RLUSD" }]);
  });

  it("heads the card with the pair in its natural orientation, the pool's account and each issuer in full", () => {
    const { header } = poolPage();
    expect(header.title).toBe("XRP / RLUSD pool");
    expect(header.coins).toEqual(["XRP", "RLUSD"]);
    expect(header.account).toEqual({ address: AMM_POOL, href: `/xrpl/account/${AMM_POOL}` });
    expect(header.issuers).toEqual([{ code: "RLUSD", text: `RLUSD issued by ${RL}`, issuer: { address: RL, href: `/xrpl/account/${RL}` } }]);
  });

  it("names each issuer of a pool of two tokens, in display order", () => {
    const { header } = poolPage({ index: usdcPool(), node: fulfilled(usdcInfo()) });
    expect(header.title).toBe("USDC / RLUSD pool");
    expect(header.issuers.map((issuer) => issuer.text)).toEqual([`USDC issued by ${USDC_ISSUER}`, `RLUSD issued by ${RL}`]);
  });

  it("writes a code that has no text in full in the issuer line, as the market's header does", () => {
    const vox = indexPool({ base_currency: VOX, base_issuer: VOX_ISSUER });
    const info = poolInfo({ amount2: { currency: VOX, issuer: VOX_ISSUER, value: "100" } });
    const { header } = poolPage({ index: vox, node: fulfilled(info) });
    expect(header.title).toBe("564F58F0… / XRP pool");
    expect(header.issuers[0]!.text).toBe(`${VOX} issued by ${VOX_ISSUER}`);
  });

  it("says when and by whom the pool was created, the day linking the transaction (spec 3.1)", () => {
    expect(poolPage().header.created).toEqual({ date: "2024-03-22", href: `/xrpl/tx/${AMM_TX_HASH}`, by: { address: AMM_ACCOUNT, href: `/xrpl/account/${AMM_ACCOUNT}` } });
  });

  it("leaves the Created line out without a create event, and for a row of another event", () => {
    expect(poolPage({ created: fulfilled({ result: "success", count: 0, liquidity: [] }) }).header.created).toBeNull();
    expect(poolPage({ created: fulfilled({ result: "success", count: 1, liquidity: [createEvent({ event: "deposit" })] }) }).header.created).toBeNull();
  });

  it("leaves the Created line out when #8 failed, and logs it without degrading the page (P9)", () => {
    const { page, problems, logged } = ammPoolPage(poolInput({ created: rejected(new TooLate()) }));
    expect(page.header.created).toBeNull();
    expect(problems).toEqual([]);
    expect(logged).toEqual(["the creation event: took too long"]);
  });

  it("shows the LP token's code short and whole, from the index's lp_currency, else from the node's lp_token", () => {
    expect(poolPage().header.lpToken).toEqual({ short: shortHash(LP_CURRENCY), code: LP_CURRENCY });
    const nodeCode = `03${"CD".repeat(19)}`;
    const info = poolInfo({ lp_token: { currency: nodeCode, issuer: AMM_POOL, value: "1" } });
    expect(poolPage({ index: leaving(indexPool(), "lp_currency"), node: fulfilled(info) }).header.lpToken).toEqual({ short: "03CDCD…CDCD", code: nodeCode });
    expect(poolPage({ index: indexPool({ lp_currency: "03ABAB" + "12".repeat(17) }) }).header.lpToken?.code).toBe("03ABAB" + "12".repeat(17));
  });

  it("links the market of the pair in the natural orientation while the markets pages are on, and is 'soon' while they are off", () => {
    expect(poolPage().header.market).toBe(marketHref("xrpl", xrp, rlusd));
    expect(poolPage().header.market).toBe(`/xrpl/markets/XRP/RLUSD.${RL}`);
    expect(poolPage({ net: { ...POOL_NET, features: { ...POOL_NET.features, markets: false } } }).header.market).toBeNull();
  });

  it("has no market link for a side that does not read back from its URL form (P31)", () => {
    const lower = { currency: "usd", issuer: AMM_ISSUER };
    const index = indexPool({ base_currency: lower.currency, base_issuer: lower.issuer });
    const info = poolInfo({ amount2: { ...lower, value: "100" } });
    expect(poolPage({ index, node: fulfilled(info) }).header.market).toBeNull();
  });
});

describe("ammPoolPage: the pool state, live from the node", () => {
  it("is the node's state at its ledger, the caption linking the ledger", () => {
    expect(stateOf(poolPage()).caption).toEqual({
      text: "Live from the network at ledger #107,721,455",
      link: { text: "#107,721,455", href: "/xrpl/ledger/107721455" },
    });
  });

  it("has the seven stats in the board's order", () => {
    expect(stateOf(poolPage()).stats.map((stat) => stat.label)).toEqual(["Value", "Reserves", "Pool price", "Trading fee", "LP tokens", "Swap volume, 24 h", "Fees earned, Oct 16"]);
  });

  it("values a pool of the native currency at twice the node's native reserve, compact", () => {
    expect(statOf(poolPage(), "value")).toEqual({ id: "value", label: "Value", value: "3.7M XRP", sub: "twice the XRP reserve" });
  });

  it("values a pool of two tokens at the index's value, or a dash when neither asset has a rate", () => {
    expect(statOf(poolPage({ index: usdcPool(), node: fulfilled(usdcInfo()) }), "value")).toMatchObject({ value: "52.3K XRP", sub: "twice a reserve at its daily XRP rate" });
    const valueless = poolPage({ index: leaving(usdcPool(), "value_native"), node: fulfilled(usdcInfo()) });
    expect(statOf(valueless, "value")).toMatchObject({ value: "—", sub: "neither asset has a XRP rate" });
  });

  it("writes the reserves exactly, each with its currency, in display order", () => {
    expect(reservesOf(poolPage())).toEqual(["1,847,691.034536 XRP", "2,417,282.053464318 RLUSD"]);
    // Whichever way round the node gives the two amounts.
    const swapped = poolInfo({ amount: poolInfo().amount2, amount2: poolInfo().amount });
    expect(reservesOf(poolPage({ node: fulfilled(swapped) }))).toEqual(["1,847,691.034536 XRP", "2,417,282.053464318 RLUSD"]);
  });

  it("works out the pool price, the second currency per the first, from the reserves", () => {
    expect(statOf(poolPage(), "price")).toEqual({ id: "price", label: "Pool price", value: "1.3082718", sub: "RLUSD per XRP, from the reserves" });
    expect(statOf(poolPage(), "price").value).toBe(exactRatio("2417282.053464318", "1847691.034536"));
  });

  it("has no price for an empty reserve", () => {
    const empty = poolInfo({ amount: { currency: "XRP", value: "0" } });
    expect(statOf(poolPage({ node: fulfilled(empty) }), "price").value).toBe("—");
  });

  it("says the trading fee and how many votes set it", () => {
    expect(statOf(poolPage(), "fee")).toEqual({ id: "fee", label: "Trading fee", value: "0.300%", sub: "set by 3 votes" });
    expect(statOf(poolPage({ node: fulfilled(poolInfo({ vote_slots: [voteSlot(AMM_HOLDER, 300, 100000)] })) }), "fee").sub).toBe("set by 1 vote");
  });

  it("writes the LP tokens in circulation exactly", () => {
    expect(statOf(poolPage(), "lp")).toEqual({ id: "lp", label: "LP tokens", value: "1,791,055,986.845366", sub: "in circulation" });
  });

  describe("Swap volume, 24 h", () => {
    it("is the pool's component of the live set, compact in the native currency, with its swaps and its time", () => {
      expect(statOf(poolPage(), "volume")).toEqual({ id: "volume", label: "Swap volume, 24 h", value: "543K XRP", sub: "61 swaps, as of 17:01 UTC" });
      expect(statOf(poolPage({ live: fulfilled(liveOf([component({ count: 1 })])) }), "volume").sub).toBe("1 swap, as of 17:01 UTC");
    });

    it("is 0 for a pool of the native currency with no component, and a dash for one without it", () => {
      expect(statOf(poolPage({ live: fulfilled(liveOf([component({ amm_account: AMM_OTHER })])) }), "volume")).toMatchObject({ value: "0", sub: "no swaps, as of 17:01 UTC" });
      const usdc = poolPage({ index: usdcPool(), node: fulfilled(usdcInfo()), live: fulfilled(liveOf([])) });
      expect(statOf(usdc, "volume")).toMatchObject({ value: "—", sub: "no swaps priced in XRP, as of 17:01 UTC" });
    });

    it("is a dash that could not be loaded when #9 failed, with a problem", () => {
      const { page, problems } = ammPoolPage(poolInput({ live: rejected(serverError("data API GET /v2/network/amm_volume answered 503")) }));
      expect(statOf(page, "volume")).toMatchObject({ value: "—", sub: COULD_NOT });
      expect(problems).toEqual(["the 24-hour volume: data API GET /v2/network/amm_volume answered 503"]);
    });

    it("could not be loaded either from a live set without a row or without a time", () => {
      expect(statOf(poolPage({ live: fulfilled({ result: "success", count: 0, rows: [] }) }), "volume").sub).toBe(COULD_NOT);
      expect(statOf(poolPage({ live: fulfilled(liveOf([component()], { end_time: "soon" })) }), "volume").sub).toBe(COULD_NOT);
    });
  });

  describe("Fees earned, on the last complete day", () => {
    it("are the day's two estimates, exact, in display order, named by the day before T", () => {
      expect(statOf(poolPage(), "fees")).toEqual({ id: "fees", label: "Fees earned, Oct 16", value: "12.5 XRP + 30.1 RLUSD", sub: ESTIMATE });
    });

    it("are the same day for every period", () => {
      expect(statOf(poolPage({ query: { ...QUERY, period: "1y" } }), "fees").label).toBe("Fees earned, Oct 16");
    });

    it("are 0 with no row that day", () => {
      expect(statOf(poolPage({ lastDay: fulfilled(daysPage([])) }), "fees")).toMatchObject({ value: "0", sub: ESTIMATE });
    });

    it("are a dash when a swap's fee is unknown: an estimate left out of a day with swaps", () => {
      const unknown = leaving(poolDay("2026-10-16"), "fees_base_est");
      expect(statOf(poolPage({ lastDay: fulfilled(daysPage([unknown])) }), "fees")).toMatchObject({ value: "—", sub: "a swap's fee is unknown" });
    });

    it("are a dash that could not be loaded when #10 failed, with a problem", () => {
      const { page, problems } = ammPoolPage(poolInput({ lastDay: rejected(new TooLate()) }));
      expect(statOf(page, "fees")).toMatchObject({ value: "—", sub: COULD_NOT });
      expect(problems).toEqual(["the fees of the last day: took too long"]);
    });

    it("could not be loaded without the newest ledger, which names the day", () => {
      const { page } = ammPoolPage(poolInput({ last: rejected(serverError()), days: null, carryIn: null, lastDay: null, candles: null }));
      expect(statOf(page, "fees")).toMatchObject({ label: "Fees earned, last day", value: "—", sub: COULD_NOT });
    });
  });
});

describe("ammPoolPage: the modes (spec 3.3)", () => {
  it("indexed: no notice, the node's state, slot and votes, and no problem", () => {
    const { page, problems, logged } = ammPoolPage(poolInput());
    expect(page.notices).toEqual([]);
    expect(page.state).not.toBeNull();
    expect(page.slot?.state).toBe("ok");
    expect(page.votes?.state).toBe("ok");
    expect(page.meta).toMatchObject({ mode: "indexed", tab: "swaps", period: "90d", marker: false, pair: "XRP/RLUSD" });
    expect([problems, logged]).toEqual([[], []]);
  });

  describe("node down: the index's state, a notice, no votes, and a problem", () => {
    const input = poolInput({ mode: "node-down", node: rejected(new UpstreamError("timeout", "node amm_info took longer than 3000 ms")) });
    const { page, problems } = ammPoolPage(input);

    it("says the live state is unavailable and shown from the index", () => {
      expect(page.notices).toEqual([
        {
          kind: "node-down",
          tone: "warning",
          title: "Live state unavailable; shown from the index",
          text: "The network node did not answer, so the reserves, LP tokens, fee and auction slot are from the explorer’s index, and the fee votes are missing.",
        },
      ]);
    });

    it("shows the index's reserves, LP supply and fee, as of the index's ledger", () => {
      expect(reservesOf(page)).toEqual(["1,800,000 XRP", "2,400,000 RLUSD"]);
      expect(statOf(page, "lp").value).toBe("1,790,000,000");
      expect(statOf(page, "fee")).toMatchObject({ value: "0.205%", sub: "set by the fee votes" });
      expect(statOf(page, "value")).toMatchObject({ value: "3.6M XRP", sub: "twice the XRP reserve" });
      expect(statOf(page, "price").value).toBe("1.3333333");
      expect(stateOf(page).caption).toEqual({ text: "From the index, ledger #107,717,584", link: { text: "#107,717,584", href: "/xrpl/ledger/107717584" } });
    });

    it("draws the slot from the index's auction_slot, without its interval, its cost or its authorized accounts", () => {
      expect(page.slot).toEqual({
        state: "ok",
        open: false,
        held: { holder: { address: AMM_HOLDER, href: `/xrpl/account/${AMM_HOLDER}` }, fee: "0.050%", pricePaid: "12.5 LP tokens", authorized: null },
        until: "until Oct 18, 2026, 09:00 UTC",
        countdownAt: EXPIRATION,
        meter: null,
        text: null,
      });
    });

    it("reads the index's slot as open without a holder, or past its expiration at the newest ledger", () => {
      expect(slotOfPage(ammPoolPage({ ...input, index: indexPool({ auction_slot: { price: "1" } }) }).page)).toMatchObject({ open: true, held: null, text: "The slot is open.", until: null });
      const expired = indexPool({ auction_slot: { holder: AMM_HOLDER, price: "1", discounted_fee: 50, expiration: "2026-10-17T09:00:00Z" } });
      expect(slotOfPage(ammPoolPage({ ...input, index: expired }).page)).toMatchObject({ open: true, held: null, text: "The slot is open." });
    });

    it("cannot tell the index's held slot from an expired one without the newest ledger: a dash, as the list's slot cell", () => {
      const blind = { ...input, last: rejected(serverError()), days: null, carryIn: null, lastDay: null, candles: null };
      const expired = indexPool({ auction_slot: { holder: AMM_HOLDER, price: "1", discounted_fee: 50, expiration: "2026-10-17T09:00:00Z" } });
      for (const index of [expired, indexPool()]) {
        // Neither held nor open: a dash, which is no status.
        expect(ammPoolPage({ ...blind, index }).page.slot).toEqual({ state: "ok", open: false, held: null, until: null, countdownAt: null, meter: null, text: "—" });
      }
      // Without a holder it is open, and without an expiration it is held as the index has it, whatever the newest ledger.
      expect(slotOfPage(ammPoolPage({ ...blind, index: indexPool({ auction_slot: { price: "1" } }) }).page)).toMatchObject({ open: true, text: "The slot is open." });
      const undated = ammPoolPage({ ...blind, index: indexPool({ auction_slot: { holder: AMM_HOLDER, price: "1" } }) }).page;
      expect(slotOfPage(undated)).toMatchObject({ open: false, held: { holder: { address: AMM_HOLDER } }, until: null, countdownAt: null, text: null });
    });

    it("fails the fee votes", () => {
      expect(page.votes).toEqual({ state: "failed", what: "the fee votes" });
    });

    it("has the node's failure as its one problem, which marks the request degraded", () => {
      expect(problems).toEqual(["the live state: node amm_info took longer than 3000 ms"]);
    });

    it("draws a dash for what the index does not know", () => {
      const bare = leaving(indexPool(), "reserve_base", "reserve_counter", "lp_supply", "trading_fee");
      const shown = ammPoolPage({ ...input, index: bare }).page;
      expect(reservesOf(shown)).toEqual(["—", "—"]);
      expect([statOf(shown, "lp").value, statOf(shown, "fee").value, statOf(shown, "price").value]).toEqual(["—", "—", "—"]);
      expect(statOf(shown, "value")).toMatchObject({ value: "—", sub: "the XRP reserve is not known" });
    });
  });

  it("gone: the network no longer has the pool; the index's state, no slot and no votes, and no problem", () => {
    const { page, problems } = ammPoolPage(poolInput({ mode: "gone", node: rejected(new UpstreamError("not_found", "node amm_info: actNotFound")) }));
    expect(page.notices).toEqual([{ kind: "gone", tone: "warning", text: "The network no longer has this pool; the index may not have seen its deletion yet." }]);
    expect(reservesOf(page)).toEqual(["1,800,000 XRP", "2,400,000 RLUSD"]);
    expect(stateOf(page).caption.text).toBe("From the index, ledger #107,717,584");
    expect([page.slot, page.votes]).toEqual([null, null]);
    expect(problems).toEqual([]);
  });

  describe("deleted: the banner, its history, and no state, slot or votes", () => {
    const deleted = indexPool({ deleted: true, last_ledger: 99_000_123 });

    it("says it was deleted and links the last ledger that touched it", () => {
      const { page } = ammPoolPage(poolInput({ mode: "deleted", index: deleted }));
      expect(page.notices).toEqual([
        {
          kind: "deleted",
          tone: "warning",
          text: "This pool was deleted. The last ledger that touched it is #99,000,123",
          link: { text: "#99,000,123", href: "/xrpl/ledger/99000123" },
        },
      ]);
      expect([page.state, page.slot, page.votes]).toEqual([null, null, null]);
      expect(page.charts.value.state).toBe("ok");
      expect(listOfPage(page).rows).toHaveLength(1);
      expect(page.meta).toMatchObject({ mode: "deleted", deleted: true });
    });

    it("does not use the node's answer, whatever it is", () => {
      const { page, problems } = ammPoolPage(poolInput({ mode: "deleted", index: deleted, node: rejected(serverError()), live: rejected(serverError()), lastDay: rejected(serverError()) }));
      expect(problems).toEqual([]);
      expect(page.notices.map((notice) => notice.kind)).toEqual(["deleted"]);
      const frozen = ammPoolPage(poolInput({ mode: "deleted", index: deleted, node: fulfilled(poolInfo({ asset_frozen: true })) })).page;
      expect(frozen.notices.map((notice) => notice.kind)).toEqual(["deleted"]);
    });

    it("tells the charts that the pool was deleted", () => {
      const { page } = ammPoolPage(poolInput({ mode: "deleted", index: deleted, days: fulfilled(daysPage([poolDay("2026-08-01")])) }));
      const value = page.charts.value;
      if (value.state !== "ok") throw new Error("the value chart failed");
      // The pool's life ends on its last row, Aug 1.
      expect(value.data.series[0]!.values.at(-1)).toBeNull();
      expect(value.data.series[0]!.values[windowOf(DAY_T, "90d").buckets.indexOf("2026-08-01")]).not.toBeNull();
    });
  });

  describe("network: a pool the index does not have yet, shown from the node", () => {
    const missing = rejected(notFound());
    const networkInput = (over: Partial<AmmPoolInput> = {}) =>
      poolInput({ mode: "network", index: null, days: missing, carryIn: missing, lastDay: missing, activity: missing, created: missing, ...over });

    it("says so, and draws the pair, the header and the state from the node", () => {
      const { page, problems, logged } = ammPoolPage(networkInput());
      expect(page.notices).toEqual([{ kind: "network", tone: "info", text: "Not in the index yet, shown from the network. Its history appears once the index has it." }]);
      expect(page.header.title).toBe("XRP / RLUSD pool");
      expect(page.header.lpToken).toEqual({ short: shortHash(LP_CURRENCY), code: LP_CURRENCY });
      expect(page.header.created).toBeNull();
      expect(reservesOf(page)).toEqual(["1,847,691.034536 XRP", "2,417,282.053464318 RLUSD"]);
      expect(statOf(page, "value")).toMatchObject({ value: "3.7M XRP", sub: "twice the XRP reserve" });
      expect(stateOf(page).caption.text).toBe("Live from the network at ledger #107,721,455");
      expect(page.slot?.state).toBe("ok");
      expect(page.votes?.state).toBe("ok");
      expect(page.meta).toMatchObject({ mode: "network", pair: "XRP/RLUSD", fee: "0.300%" });
      expect(page.meta).not.toHaveProperty("value");
      expect([problems, logged]).toEqual([[], []]);
    });

    it("reads the index's 'pool not found' on the day rows, the last day and the activity as empty answers", () => {
      const { page } = ammPoolPage(networkInput());
      for (const part of Object.values(page.charts)) expect(part.state, part.title).toBe("ok");
      const value = page.charts.value;
      if (value.state !== "ok") throw new Error("the value chart failed");
      expect(value.data.series[0]!.values.every((v) => v === null)).toBe(true);
      expect(listOfPage(page)).toMatchObject({ rows: [], empty: "No swaps to show.", paging: { newerHref: null, olderHref: null } });
      expect(statOf(page, "fees")).toMatchObject({ value: "0", sub: ESTIMATE });
    });

    it("values a pool without the native currency at a dash: it is not in the index yet", () => {
      const { page } = ammPoolPage(networkInput({ node: fulfilled(usdcInfo()), live: fulfilled(liveOf([])) }));
      expect(page.header.title).toBe("USDC / RLUSD pool");
      expect(statOf(page, "value")).toMatchObject({ value: "—", sub: "not in the index yet" });
    });

    it("logs a failure of the creation event that is not 'pool not found', without degrading the page", () => {
      const { page, problems, logged } = ammPoolPage(networkInput({ created: rejected(serverError("data API GET /v2/amm/pools/…/liquidity answered 503")) }));
      expect(page.header.created).toBeNull();
      expect(problems).toEqual([]);
      expect(logged).toEqual(["the creation event: data API GET /v2/amm/pools/…/liquidity answered 503"]);
    });

    it("still fails a card for a failure that is not 'pool not found'", () => {
      const { page, problems } = ammPoolPage(networkInput({ activity: rejected(serverError()) }));
      expect(page.activity.list).toEqual({ state: "failed", what: "the swaps" });
      expect(problems).toHaveLength(1);
    });

    it("asks the charts in the pool's stored order, whichever way the node gives the assets", () => {
      const swapped = poolInfo({ amount: poolInfo().amount2, amount2: poolInfo().amount });
      const a = ammPoolPage(networkInput()).page.charts;
      const b = ammPoolPage(networkInput({ node: fulfilled(swapped) })).page.charts;
      expect(b).toEqual(a);
    });
  });

  it("fails the four cards of the day rows in the other modes for a 'pool not found' of the carry-in, with a problem", () => {
    const { page, problems } = ammPoolPage(poolInput({ carryIn: rejected(notFound()) }));
    for (const part of [page.charts.value, page.charts.price, page.charts.fee, page.charts.reserves]) expect(part.state, part.title).toBe("failed");
    expect(page.charts.volume.state).toBe("ok");
    expect(problems).toEqual(["the day before the window: pool not found"]);
  });

  it("fails a card in the other modes for a 'pool not found' of the day rows, the last day or the activity, with a problem", () => {
    const missing = rejected(notFound());
    const { page, problems } = ammPoolPage(poolInput({ days: missing, lastDay: missing, activity: missing }));
    expect(page.charts.value).toMatchObject({ state: "failed", what: "the pool value" });
    expect(statOf(page, "fees")).toMatchObject({ value: "—", sub: COULD_NOT });
    expect(page.activity.list).toEqual({ state: "failed", what: "the swaps" });
    expect(problems).toEqual(["the fees of the last day: pool not found", "the day rows: pool not found", "the swaps: pool not found"]);
  });
});

describe("ammPoolPage: an asset frozen by its issuer", () => {
  it("says which asset of the pool is frozen, as the node marks it", () => {
    expect(poolPage({ node: fulfilled(poolInfo({ asset_frozen: true })) }).notices).toEqual([{ kind: "frozen", tone: "warning", text: "XRP in this pool is frozen by its issuer" }]);
    expect(poolPage({ node: fulfilled(poolInfo({ asset2_frozen: true })) }).notices).toEqual([{ kind: "frozen", tone: "warning", text: "RLUSD in this pool is frozen by its issuer" }]);
    expect(poolPage({ node: fulfilled(poolInfo({ asset_frozen: false })) }).notices).toEqual([]);
  });

  it("follows the mode's notice", () => {
    const missing = rejected(notFound());
    const page = poolPage({ mode: "network", index: null, node: fulfilled(poolInfo({ asset2_frozen: true })), days: missing, carryIn: missing, lastDay: missing, activity: missing });
    expect(page.notices.map((notice) => notice.kind)).toEqual(["network", "frozen"]);
  });
});

describe("ammPoolPage: the auction slot", () => {
  const cost = (info: AmmInfo, interval: number | null) =>
    formatAmount(nextBidPrice(info.lp_token.value, info.trading_fee, interval === null ? null : { price: info.auction_slot!.price.value, interval }));

  it("is held in interval 12: the 13th of 20, the cost of a new bid, and the expiration with its countdown", () => {
    const info = poolInfo();
    const slot = slotOfPage(poolPage());
    expect(slot.text).toBe(`Interval 13 of 20 of the 24-hour slot. A new bid now costs at least ${cost(info, 12)} LP tokens.`);
    expect(slot.meter).toEqual({ value: "13", max: "20", label: "Interval 13 of 20 of the 24-hour slot" });
    expect(slot.until).toBe(`until ${formatDateTime(EXPIRATION)}`);
    expect(slot.until).toBe("until Oct 18, 2026, 09:00 UTC");
    expect(slot.countdownAt).toBe(EXPIRATION);
    expect(slot.held).toEqual({ holder: { address: AMM_HOLDER, href: `/xrpl/account/${AMM_HOLDER}` }, fee: "0.022%", pricePaid: "100 LP tokens", authorized: [] });
    expect(slot.open).toBe(false);
  });

  it("links the accounts the holder authorized", () => {
    const info = poolInfo({ auction_slot: heldSlot({ time_interval: 12, auth_accounts: [AMM_ACCOUNT, AMM_OTHER] }) });
    expect(slotOfPage(poolPage({ node: fulfilled(info) })).held?.authorized).toEqual([
      { address: AMM_ACCOUNT, href: `/xrpl/account/${AMM_ACCOUNT}` },
      { address: AMM_OTHER, href: `/xrpl/account/${AMM_OTHER}` },
    ]);
  });

  it("is open at interval 20, without a holder or without a slot: the minimum cost, no expiration and no meter", () => {
    for (const auction_slot of [heldSlot({ time_interval: 20 }), heldSlot({ account: undefined }), undefined]) {
      const info = leaving(poolInfo({ auction_slot }), ...(auction_slot === undefined ? (["auction_slot"] as const) : []));
      const slot = slotOfPage(poolPage({ node: fulfilled(info) }));
      expect(slot).toEqual({ state: "ok", open: true, held: null, until: null, countdownAt: null, meter: null, text: `The slot is open. A new bid now costs at least ${cost(info, null)} LP tokens.` });
    }
  });

  it("leaves the cost sentence out where it is 0", () => {
    // A held slot costs at least its price plus 5% whatever the fee: it is free only when nothing was paid for it either.
    expect(slotOfPage(poolPage({ node: fulfilled(poolInfo({ trading_fee: 0 })) })).text).toMatch(/costs at least/);
    const free = poolInfo({ trading_fee: 0, auction_slot: heldSlot({ time_interval: 12, price: { currency: LP_CURRENCY, issuer: AMM_POOL, value: "0" } }) });
    expect(slotOfPage(poolPage({ node: fulfilled(free) })).text).toBe("Interval 13 of 20 of the 24-hour slot.");
    const openFree = poolInfo({ trading_fee: 0, auction_slot: heldSlot({ time_interval: 20 }) });
    expect(slotOfPage(poolPage({ node: fulfilled(openFree) })).text).toBe("The slot is open.");
  });
});

describe("ammPoolPage: the fee votes", () => {
  it("are E2's bars of the votes, and the weighted result is the pool's fee", () => {
    const votes = poolPage().votes;
    if (votes === null || votes.state !== "ok") throw new Error("the votes are not drawn");
    expect(votes.data).toEqual(voteShares(poolInfo().vote_slots, "xrpl"));
    expect(votes.text).toBe("Weighted result 0.300%, the pool's trading fee.");
    expect(votes.figure).toBe("0.300%");
  });

  it("are none for a pool without a vote slot: no bars, no weighted result, and the fee is set by no vote", () => {
    const page = poolPage({ node: fulfilled(poolInfo({ trading_fee: 500, vote_slots: [] })) });
    expect(page.votes).toEqual({ state: "ok", data: null, text: "No fee votes.", figure: null });
    expect(statOf(page, "fee")).toMatchObject({ value: "0.500%", sub: "no fee votes" });
  });
});

describe("ammPoolPage: the filters", () => {
  it("are the three periods as links that keep the tab, the current one marked, the day rows' source and the window's note", () => {
    const { filters } = poolPage({ query: { ...QUERY, period: "30d", tab: "liquidity" } });
    expect(filters.period).toEqual([
      { label: "30 days", href: `/xrpl/amm/${AMM_POOL}?period=30d&tab=liquidity`, current: true },
      { label: "90 days", href: `/xrpl/amm/${AMM_POOL}?tab=liquidity`, current: false },
      { label: "1 year", href: `/xrpl/amm/${AMM_POOL}?period=1y&tab=liquidity`, current: false },
    ]);
    expect(filters.source).toBe("/v2/amm/pools/rhWTXC…tcS3/history?interval=day");
    expect(filters.note).toBe(`Charts cover ${windowOf(DAY_T, "30d").note}`);
    expect(poolPage().filters.note).toBe("Charts cover the 90 days from Jul 20 to Oct 17, 2026 (UTC), today so far");
  });

  it("have no note without the newest ledger", () => {
    expect(poolPage({ last: rejected(serverError()), days: null, carryIn: null, lastDay: null, candles: null }).filters.note).toBeNull();
  });
});

describe("ammPoolPage: the charts", () => {
  const window = windowOf(DAY_T, "90d");
  const seriesOfInput = (input: AmmPoolInput): DaySeriesInput => ({
    window,
    pair: XRP_RLUSD,
    native: "XRP",
    pool: AMM_POOL,
    deleted: false,
    days: [poolDay("2026-08-01"), poolDay("2026-10-16")],
    carryIn: poolDay("2026-07-01"),
    candles: [poolCandle("2026-10-16")],
    ...(input.mode === "deleted" ? { deleted: true } : {}),
  });

  it("are the five cards of the day rows, the carry-in and the candles of the period", () => {
    expect(poolPage().charts).toEqual(poolCharts(seriesOfInput(poolInput())));
    const year = poolPage({ query: { ...QUERY, period: "1y" } }).charts;
    expect(year).toEqual(poolCharts({ ...seriesOfInput(poolInput()), window: windowOf(DAY_T, "1y") }));
  });

  it("all fail when the newest ledger failed, with one problem", () => {
    const { page, problems } = ammPoolPage(poolInput({ last: rejected(serverError()), days: null, carryIn: null, lastDay: null, candles: null }));
    expect(page.charts).toEqual(poolCharts(null));
    expect(problems).toEqual([`the charts: ${serverError().message}`]);
  });

  it("fail the four cards of the day rows when #4 or #5 failed, and draw the volume without its fee estimates", () => {
    for (const over of [{ days: rejected(new TooLate()) }, { carryIn: rejected(new TooLate()) }]) {
      const { page, problems } = ammPoolPage(poolInput(over));
      expect(page.charts).toEqual(poolCharts({ ...seriesOfInput(poolInput()), days: null }));
      expect(problems).toHaveLength(1);
    }
    expect(ammPoolPage(poolInput({ carryIn: rejected(new TooLate()) })).problems).toEqual(["the day before the window: took too long"]);
  });

  it("fail the volume card when #6 failed", () => {
    const { page, problems } = ammPoolPage(poolInput({ candles: rejected(serverError("data API GET /v2/exchanges answered 503")) }));
    expect(page.charts.volume).toMatchObject({ state: "failed", what: "the swap volume" });
    expect(page.charts.value.state).toBe("ok");
    expect(problems).toEqual(["the swap volume: data API GET /v2/exchanges answered 503"]);
  });

  it("read a carry-in page without a row as no carry-in", () => {
    expect(poolPage({ carryIn: fulfilled(daysPage([])) }).charts).toEqual(poolCharts({ ...seriesOfInput(poolInput()), carryIn: null }));
  });
});

describe("ammPoolPage: the activity", () => {
  it("has the three tabs as links that keep the period, the current one the query's", () => {
    const { activity } = poolPage({ query: { ...QUERY, period: "1y", tab: "governance" } });
    expect(activity.tabs).toEqual([
      { id: "swaps", label: "Swaps", href: `/xrpl/amm/${AMM_POOL}?period=1y` },
      { id: "liquidity", label: "Liquidity", href: `/xrpl/amm/${AMM_POOL}?period=1y&tab=liquidity` },
      { id: "governance", label: "Votes and bids", href: `/xrpl/amm/${AMM_POOL}?period=1y&tab=governance` },
    ]);
    expect(activity.current).toBe("governance");
  });

  it("names the tab's route as its source line, and the display codes of the columns", () => {
    expect(poolPage().activity).toMatchObject({ source: "/v2/amm/pools/{pool}/swaps", codes: ["XRP", "RLUSD"] });
    const liquidity = poolPage({ query: { ...QUERY, tab: "liquidity" }, activity: fulfilled({ result: "success", count: 0, liquidity: [] }) });
    expect(liquidity.activity.source).toBe("/v2/amm/pools/{pool}/liquidity");
    const governance = poolPage({ query: { ...QUERY, tab: "governance" }, activity: fulfilled({ result: "success", count: 0, governance: [] }) });
    expect(governance.activity.source).toBe("/v2/amm/pools/{pool}/governance");
  });

  it("lists the swaps in the display pair, with the notes under the table and the Older link of the next page", () => {
    const list = listOfPage(poolPage());
    expect(list).toEqual({
      state: "ok",
      tab: "swaps",
      rows: swapRows([rlusdSwap()], XRP_RLUSD, "xrpl"),
      empty: null,
      paging: { newerHref: null, olderHref: ammPoolHref("xrpl", AMM_POOL, { marker: AMM_MARKER, back: [] }) },
      notes: [
        "Newest first. Signs are from the pool's side: + went in, − came out.",
        "Amounts are the pool's own changes; on the asset it pays out they include the issuer's transfer fee.",
      ],
    });
  });

  it("lists the liquidity events and the votes and bids, the pager keeping the tab", () => {
    const events = [ammLiquiditySample({ base_amount: "-10", counter_amount: "-20" })];
    const liquidity = listOfPage(poolPage({ query: { ...QUERY, tab: "liquidity" }, activity: fulfilled({ result: "success", count: 1, marker: AMM_MARKER, liquidity: events }) }));
    expect(liquidity).toMatchObject({ tab: "liquidity", rows: liquidityRows(events, XRP_RLUSD, "xrpl"), notes: ["Newest first. Signs are from the pool's side: + went in, − came out."] });
    expect(liquidity.paging.olderHref).toBe(`/xrpl/amm/${AMM_POOL}?tab=liquidity&marker=${AMM_MARKER}`);

    const rows: AmmGovernanceRow[] = [ammVoteSample(), ammBidSample()];
    const governance = listOfPage(poolPage({ query: { ...QUERY, tab: "governance" }, activity: fulfilled({ result: "success", count: 2, governance: rows }) }));
    expect(governance).toMatchObject({ tab: "governance", rows: governanceRows(rows, "xrpl"), empty: null, paging: { newerHref: null, olderHref: null } });
  });

  it("says when a tab has nothing to show", () => {
    expect(listOfPage(poolPage({ activity: fulfilled(swapsPage([], null)) })).empty).toBe("No swaps to show.");
    const liquidity = poolPage({ query: { ...QUERY, tab: "liquidity" }, activity: fulfilled({ result: "success", count: 0, liquidity: [] }) });
    expect(listOfPage(liquidity).empty).toBe("No liquidity events to show.");
    const governance = poolPage({ query: { ...QUERY, tab: "governance" }, activity: fulfilled({ result: "success", count: 0, governance: [] }) });
    expect(listOfPage(governance).empty).toBe("No votes or bids to show.");
  });

  it("fails the table, never the tabs, when #7 failed, and names what could not be loaded", () => {
    const cases: [AmmPoolQuery["tab"], string][] = [
      ["swaps", "the swaps"],
      ["liquidity", "the liquidity events"],
      ["governance", "the votes and bids"],
    ];
    for (const [tab, what] of cases) {
      const { page, problems } = ammPoolPage(poolInput({ query: { ...QUERY, tab }, activity: rejected(serverError()) }));
      expect(page.activity.list).toEqual({ state: "failed", what });
      expect(page.activity.tabs).toHaveLength(3);
      expect(problems).toEqual([`${what}: ${serverError().message}`]);
    }
  });

  it("fails the table for an answer without the tab's list", () => {
    const { page, problems } = ammPoolPage(poolInput({ query: { ...QUERY, tab: "liquidity" }, activity: fulfilled(swapsPage()) }));
    expect(page.activity.list).toEqual({ state: "failed", what: "the liquidity events" });
    expect(problems).toHaveLength(1);
  });
});

describe("ammPoolPage: the problems", () => {
  it("are in the page's order, one for each failed card, and the page still stands", () => {
    const { page, problems } = ammPoolPage(
      poolInput({
        mode: "node-down",
        node: rejected(serverError("node amm_info answered 502")),
        live: rejected(new TooLate()),
        lastDay: rejected(new TooLate()),
        days: rejected(new TooLate()),
        carryIn: rejected(new TooLate()),
        candles: rejected(new TooLate()),
        activity: rejected(new TooLate()),
      }),
    );
    expect(problems).toEqual([
      "the live state: node amm_info answered 502",
      "the 24-hour volume: took too long",
      "the fees of the last day: took too long",
      "the day rows: took too long",
      "the day before the window: took too long",
      "the swap volume: took too long",
      "the swaps: took too long",
    ]);
    expect(page.kind).toBe("pool");
  });

  it("never put a reason in the page", () => {
    const { page } = ammPoolPage(poolInput({ live: rejected(serverError("SECRET-REASON")), activity: rejected(serverError("SECRET-REASON")) }));
    expect(JSON.stringify(page)).not.toContain("SECRET-REASON");
  });
});

describe("ammHistoryPage: a page behind a marker", () => {
  const query: AmmPoolQuery = { period: "90d", tab: "liquidity", marker: AMM_MARKER, back: ["WzEsMl0"] };
  const events = [ammLiquiditySample()];
  const activity: AmmActivityPage = { result: "success", count: 1, marker: "WzMsNF0", liquidity: events };
  const page = ammHistoryPage({ net: POOL_NET, pool: AMM_POOL, query, index: indexPool(), activity });

  it("has the crumbs, and the pool card without its Created and LP token lines", () => {
    expect(page.kind).toBe("history");
    expect(page.crumbs).toEqual(poolPage().crumbs);
    expect(page.header).toEqual({
      coins: ["XRP", "RLUSD"],
      title: "XRP / RLUSD pool",
      market: `/xrpl/markets/XRP/RLUSD.${RL}`,
      account: { address: AMM_POOL, href: `/xrpl/account/${AMM_POOL}` },
      issuers: [{ code: "RLUSD", text: `RLUSD issued by ${RL}`, issuer: { address: RL, href: `/xrpl/account/${RL}` } }],
    });
  });

  it("shows the activity of that page, paged on from it, and the way back to the pool's first page of the tab", () => {
    expect(listOfPage(page)).toMatchObject({
      tab: "liquidity",
      rows: liquidityRows(events, XRP_RLUSD, "xrpl"),
      paging: {
        newerHref: `/xrpl/amm/${AMM_POOL}?tab=liquidity&marker=WzEsMl0`,
        olderHref: `/xrpl/amm/${AMM_POOL}?tab=liquidity&marker=WzMsNF0&back=${AMM_MARKER}.WzEsMl0`,
      },
    });
    expect(page.activity.current).toBe("liquidity");
    expect(page.backHref).toBe(ammPoolHref("xrpl", AMM_POOL, { tab: "liquidity" }));
    expect(page.backHref).toBe(`/xrpl/amm/${AMM_POOL}?tab=liquidity`);
  });

  it("carries the facts of its tags: behind a marker, and the mode of the index's pool", () => {
    expect(page.meta).toMatchObject({ pair: "XRP/RLUSD", tab: "liquidity", marker: true, mode: "indexed", fee: "0.205%" });
    const deleted = ammHistoryPage({ net: POOL_NET, pool: AMM_POOL, query, index: indexPool({ deleted: true }), activity });
    expect(deleted.meta).toMatchObject({ mode: "deleted", deleted: true });
  });

  it("has nothing else: no state, slot, votes or charts", () => {
    expect(Object.keys(page).sort()).toEqual(["activity", "backHref", "crumbs", "header", "kind", "meta"]);
  });
});

describe("the pool page: no float and no exponent reaches the page (P38)", () => {
  /**
   * The page's text without what is an identifier and no number, which can hold a digit, an E and a digit by chance: a transaction hash, an address (whole
   * or short), a currency of 40 hex digits (an LP token's) and its short form, the first 8 hex digits of a code with no text, a chart's token and a marker.
   */
  const withoutIds = (page: unknown): string =>
    withoutHashes(JSON.stringify(page))
      .replace(/"token":"[0-9a-f]{8}"/g, "")
      .replace(/[0-9A-F]{40}/g, "")
      .replace(/[0-9A-F]{6}…[0-9A-F]{4}/g, "")
      .replace(/r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}/g, "")
      .replace(/marker=[\w-]+/g, "")
      .replace(/back=[\w.-]+/g, "");

  it("strips only identifiers: a figure in exponent form is still caught", () => {
    expect(withoutIds({ value: "1.2e+21" })).toMatch(EXPONENT);
    expect(withoutIds({ href: `/xrpl/tx/${"1E5".padEnd(64, "0")}`, lp: `03${"1E5".padEnd(38, "0")}` })).not.toMatch(EXPONENT);
  });

  it("writes in plain digits every amount the node and the API wrote in exponent form", () => {
    const info = poolInfo({
      amount: { currency: "XRP", value: "0.000001" },
      amount2: { currency: RLUSD, issuer: RL, value: "1200000000000000000000" },
      lp_token: { currency: LP_CURRENCY, issuer: AMM_POOL, value: "0.00000001" },
      auction_slot: heldSlot({ time_interval: 3, price: { currency: LP_CURRENCY, issuer: AMM_POOL, value: "0.0000003" } }),
    });
    const exponentDay = poolDay("2026-10-16", { reserve_base: "1.2e+21", reserve_counter: "3e-7", value_native: "1000000", fees_base_est: "1.250946e-8", fees_counter_est: "2e-9" });
    const input = poolInput({
      node: fulfilled(info),
      days: fulfilled(daysPage([exponentDay])),
      lastDay: fulfilled(daysPage([exponentDay])),
      candles: fulfilled(candlesPage([poolCandle("2026-10-16", { base_volume: "1e+21", counter_volume: "5e-7" })])),
      live: fulfilled(liveOf([component({ rate: "7.6528766e+9", converted_amount: "1.2e+21", amount: "3e-7" })])),
      activity: fulfilled(swapsPage([rlusdSwap({ base_amount: "1e+30", counter_amount: "1e-30", rate: "1e+60" })])),
    });
    const { page } = ammPoolPage(input);
    expect(withoutIds(page)).not.toMatch(EXPONENT);
    expect(statOf(page, "fees").value).toBe("0.000000002 XRP + 0.00000001250946 RLUSD");
    expect(statOf(page, "volume").value).toBe("1,200,000,000T XRP");
    // The node-down page reads the index's figures, which may be in exponent form too.
    const down = ammPoolPage({ ...input, mode: "node-down", node: rejected(serverError()), index: indexPool({ reserve_base: "1.5e-7", reserve_counter: "1.2e+21", lp_supply: "1e+25", auction_slot: { holder: AMM_HOLDER, price: "1e-9" } }) });
    expect(withoutIds(down.page)).not.toMatch(EXPONENT);
    expect(reservesOf(down.page)).toEqual(["1,200,000,000,000,000,000,000 XRP", "0.00000015 RLUSD"]);
  });

  describe("every recorded pool, through the node client's own reader", () => {
    const dir = new URL("../../test/fixtures/http/xrpl/", import.meta.url);
    const text = (path: string): string => readFileSync(new URL(path, dir), "utf8");
    const json = <T>(path: string): T => JSON.parse(text(path)) as T;
    const exists = (path: string): boolean => {
      try {
        readFileSync(new URL(path, dir));
        return true;
      } catch {
        return false;
      }
    };
    /**
     * A recorded answer, or what the fixture server answers for a file it does not have (test/support/upstream-core.ts `dataApiAbsent`), as the data API client
     * reads it: `pool not found` below a pool's route (kind `not_found`), and the missing route's "Cannot GET" elsewhere (kind `server`).
     */
    const answerOf = <T>(path: string): PromiseSettledResult<T> => {
      if (exists(path)) return fulfilled(json<T>(path));
      const route = `/v2/${path.replace(/^data-api\//, "").replace(/@.*$/, "").replace(/\.json$/, "")}`;
      return /^\/v2\/amm\/pools\/[^/]+\/.+/.test(route)
        ? rejected(new UpstreamError("not_found", `data API GET ${route} answered 404: pool not found`, { status: 404 }))
        : rejected(new UpstreamError("server", `data API GET ${route} answered 404: Cannot GET ${route} (the data API has no such route)`, { status: 404 }));
    };
    const assetText = (currency: string, issuer?: string) => (issuer ? `${currency}+${issuer}` : currency);
    const passThrough = { json: <T>(_key: string, _cls: string, load: () => Promise<T>) => load() } as unknown as SubrequestCache;
    const node = { id: "xrpl", name: "XRPL", native: "XRP", nodeUrl: "https://node.example.invalid/" } as Network;

    /** The pool's `amm_info`, read from its recorded answer by node-rpc.ts's own reader; the node's `actNotFound` for a pool with no file (VOX/XRP). */
    async function infoOf(pool: string): Promise<PromiseSettledResult<AmmInfo>> {
      const path = `node/amm_info/${pool}.json`;
      if (!exists(path)) return rejected(new UpstreamError("not_found", "node amm_info: actNotFound"));
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(text(path), { status: 200, headers: { "Content-Type": "application/json" } }));
      try {
        return fulfilled(await createNodeRpc(node, passThrough).ammInfo(pool));
      } finally {
        spy.mockRestore();
      }
    }

    async function recordedInput(pool: string, period: AmmPoolQuery["period"], tab: AmmPoolQuery["tab"]): Promise<AmmPoolInput> {
      const index = json<{ pool: AmmPool }>(`data-api/amm/pools/${pool}.json`).pool;
      const info = await infoOf(pool);
      const mode = poolModeOf(fulfilled(index), info);
      if (mode === "none" || mode === "unavailable") throw new Error(`${pool} is no page`);
      const window = windowOf(DAY_T, period);
      const q = poolQueries(window, DAY_T);
      const at = `data-api/amm/pools/${pool}/`;
      const days = (start: string) => answerOf<Page<"days", AmmPoolDay>>(`${at}history@end=${DAY_T}&interval=day&limit=1000&start=${start}.json`);
      const pair = `${assetText(index.base_currency, index.base_issuer)}/${assetText(index.counter_currency, index.counter_issuer)}`;
      const candles = `data-api/exchanges/${pair}@amm=only&end=${DAY_T}&interval=${q.candles.interval}&limit=400&start=${window.start}.json`;
      return {
        net: POOL_NET,
        pool,
        query: { period, tab, back: [] },
        mode,
        index,
        node: info,
        last: fulfilled(json<LastValidated>("data-api/last_validated.json")),
        days: days(window.start),
        carryIn: answerOf(`${at}history@descending=true&end=${q.carryIn.end}&interval=day&limit=1.json`),
        lastDay: answerOf(`${at}history@end=${q.lastDay.end}&interval=day&limit=1&start=${q.lastDay.start}.json`),
        candles: answerOf(candles),
        activity: answerOf<AmmActivityPage>(`${at}${tab}@descending=true&limit=20.json`),
        created: answerOf(`${at}liquidity@event=create&limit=1.json`),
        live: fulfilled(json<Page<"rows", AmmVolumeRow>>("data-api/network/amm_volume@live=day.json")),
      };
    }

    const SNK = "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz";
    const DVR = "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG";
    const USD_XRP = "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am";
    const USDC_POOL = "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb";
    const VOX_POOL = "rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef";
    const cases: [string, AmmPoolQuery["period"], AmmPoolMode][] = [
      [AMM_POOL, "30d", "indexed"],
      [AMM_POOL, "90d", "indexed"],
      [AMM_POOL, "1y", "indexed"],
      [USD_XRP, "90d", "indexed"],
      [USDC_POOL, "90d", "indexed"],
      [DVR, "30d", "indexed"],
      [SNK, "90d", "deleted"],
      [SNK, "1y", "deleted"],
      [VOX_POOL, "90d", "gone"],
    ];

    it.each(cases)("%s at %s is the %s page, whole, with no exponent on any tab", async (pool, period, mode) => {
      for (const tab of ["swaps", "liquidity", "governance"] as const) {
        const input = await recordedInput(pool, period, tab);
        expect(input.mode).toBe(mode);
        const { page, problems, logged } = ammPoolPage(input);
        expect([problems, logged], `${pool} ${period} ${tab}`).toEqual([[], []]);
        expect(withoutIds(page), `${pool} ${period} ${tab}`).not.toMatch(EXPONENT);
      }
    });

    it("draws XRP / RLUSD's state card from its recorded amm_info: an expired slot is open", async () => {
      const { page } = ammPoolPage(await recordedInput(AMM_POOL, "90d", "swaps"));
      expect(reservesOf(page)).toEqual(["1,847,691.034536 XRP", "2,417,282.053464318 RLUSD"]);
      expect(statOf(page, "value")).toMatchObject({ value: "3.7M XRP" });
      expect(statOf(page, "fee")).toMatchObject({ value: "0.205%", sub: "set by 8 votes" });
      expect(statOf(page, "fees")).toMatchObject({ value: "60.76396923 XRP + 75.07497735055 RLUSD" });
      expect(stateOf(page).caption.text).toBe("Live from the network at ledger #107,721,455");
      expect(slotOfPage(page)).toMatchObject({ held: null, until: null, meter: null });
      expect(slotOfPage(page).text).toMatch(/^The slot is open\. A new bid now costs at least [\d,.]+ LP tokens\.$/);
    });

    it("draws VOX/XRP's gone page whole: the index's state, every chart drawn with no data, and the tables", async () => {
      for (const tab of ["swaps", "liquidity", "governance"] as const) {
        const { page, problems, logged } = ammPoolPage(await recordedInput(VOX_POOL, "90d", tab));
        expect([problems, logged], tab).toEqual([[], []]);
        expect(page.notices.map((notice) => notice.kind)).toEqual(["gone"]);
        for (const part of Object.values(page.charts)) expect(part.state, `${tab} ${part.title}`).toBe("ok");
        expect(page.activity.list.state, tab).toBe("ok");
        expect(statOf(page, "fees").value).toBe("0");
        expect([page.slot, page.votes]).toEqual([null, null]);
      }
      // The answers are what the API serves for a pool with states and no day: empty lists, so no chart has a value.
      const value = ammPoolPage(await recordedInput(VOX_POOL, "90d", "swaps")).page.charts.value;
      if (value.state !== "ok") throw new Error("the value chart failed");
      expect(value.data.series[0]!.values.every((v) => v === null)).toBe(true);
    });

    it("answers a file the fixtures do not have as the fixture server does", () => {
      expect(answerOf(`data-api/amm/pools/${VOX_POOL}/history@end=${DAY_T}&interval=day&limit=1000&start=2026-09-18.json`)).toMatchObject({
        status: "rejected",
        reason: { kind: "not_found" },
      });
      expect(answerOf(`data-api/exchanges/${VOX}+${VOX_ISSUER}/XRP@amm=only&end=${DAY_T}&interval=1day&limit=400&start=2026-09-18.json`)).toMatchObject({
        status: "rejected",
        reason: { kind: "server" },
      });
    });

    it("names DVR/XRP's creation, the one recorded create event", async () => {
      const { page } = ammPoolPage(await recordedInput(DVR, "30d", "swaps"));
      expect(page.header.created).toMatchObject({ date: "2026-10-12", by: { address: "rEh4WnsrdmE7V1XeTsWi5dM7FHH8hYuea3" } });
      expect(page.meta.created).toEqual({ date: "2026-10-12", at: unixAt("2026-10-12T19:36:41Z") });
    });
  });
});
