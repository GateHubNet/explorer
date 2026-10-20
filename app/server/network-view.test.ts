import { describe, expect, it } from "vitest";

import { USD_ISSUER, type Display } from "../domain/network-params";
import { bucketStarts, windowOf, type PeriodWindow, type WindowPeriod } from "../domain/window";
import type {
  AmmVolumeComponent,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeRow,
  FeeStatsRow,
  LastValidated,
  LedgerValidations,
  Page,
  PaymentVolumeComponent,
  StatsRow,
  Validation,
  VolumeRow,
} from "./api-types";
import { TooLate } from "./deadline";
import {
  ammOf,
  contextOf,
  exchangesOf,
  feesOf,
  metricsOf,
  networkPage,
  openLedgerOf,
  paymentsOf,
  stripOf,
  typesOf,
  validatorsOf,
  type NetworkInput,
  type NetworkPageData,
  type Part,
} from "./network-view";
import { UpstreamError } from "./upstream";

// ---- The world of the tests: T is 2026-10-17, the close time of the newest ledger 17:01:12 UTC -----------------------------------------

const T = "2026-10-17";
const HASH = "2F7C1D5A9B3E4F60A8D2C71B5E9F3A4D6C8B0E1F2A3B4C5D6E7F8A9B0C1D2E3F";
const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: HASH,
  parent_hash: "9A8B7C6D5E4F30211203F4E5D6C7B8A998877665544332211FFEEDDCCBBAA990",
  close_time: "2026-10-17T17:01:12Z",
};

const XRPL: NetworkInput["net"] = { id: "xrpl", native: "XRP", hasAmm: true, features: { validators: true, ammData: true, markets: true, accountAnalytics: true } };
const XAHAU: NetworkInput["net"] = { id: "xahau", native: "XAH", hasAmm: false, features: { validators: false, ammData: false, markets: false, accountAnalytics: false } };

const fulfilled = <V>(value: V): PromiseFulfilledResult<V> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

/** A part that must have loaded. */
function loaded<X>(part: Part<X>): { state: "ok" } & X {
  if (part.state !== "ok") throw new Error(`the part failed: ${part.reason}`);
  return part;
}

const ctxOf = (period: WindowPeriod = "7d", options: { net?: NetworkInput["net"]; display?: Display } = {}) =>
  contextOf({ net: options.net ?? XRPL, view: { period, display: options.display ?? "native" }, last: LAST });

const days = (from: string, to: string) => bucketStarts(from, to, "day");
const weeks = (from: string, to: string) => bucketStarts(from, to, "week");
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** `n` counts that add up to `total`: the first takes what the others (1 each) leave. A zero total is all zeros. */
const spread = (total: number, n: number): number[] => (total === 0 ? Array(n).fill(0) : [total - (n - 1), ...Array<number>(n - 1).fill(1)]);

// Rows of the data API.
const page = <K extends string, R>(key: K, rows: R[]) => ({ result: "success", count: rows.length, [key]: rows }) as Page<K, R>;

/** A unix time as the data API writes a time: `2026-10-17T17:01:12Z`. */
const timeOf = (seconds: number) => `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;

const feeRow = (index: number, txCount: number, date: string): FeeRow => ({
  avg: 0.00001,
  max: 0.0001,
  min: 0.00001,
  total: txCount * 0.00001,
  tx_count: txCount,
  date,
  ledger_index: index,
});
/** Nine ledgers, newest first: one above `latest` (107721455), then `latest` with 107 transactions, then seven older. */
const feesList = (): FeeRow[] => [
  feeRow(107721456, 90, "2026-10-17T17:01:16Z"),
  feeRow(107721455, 107, "2026-10-17T17:01:12Z"),
  ...Array.from({ length: 7 }, (_, i) => feeRow(107721454 - i, 80 + i, timeOf(1792256472 - 4 * (i + 1)))),
];

const FEE_STATS: FeeStatsRow = {
  open_ledger_fee: 0.0000125,
  minimum_fee: 0.00001,
  median_fee: 0.000005,
  current_queue_size: 0,
  current_ledger_size: 84,
  expected_ledger_size: 96,
  pct_max_queue_size: 0,
  date: "2026-10-17T17:01:10Z",
};

const stat = (day: string, counts: Record<string, number>): StatsRow => ({
  date: `${day}T00:00:00Z`,
  ...Object.fromEntries(Object.entries(counts).filter(([, count]) => count !== 0)),
});
type Metrics = { transaction_count?: number; ledger_count?: number; accounts_created?: number };
const FULL_DAY: Metrics = { transaction_count: 86_400, ledger_count: 21_600, accounts_created: 10 };
const RUNNING_DAY: Metrics = { transaction_count: 61_272, ledger_count: 15_318, accounts_created: 5 };

const feeDay = (day: string, avg: number, total: number, txCount: number): FeeBucketRow => ({
  avg,
  max: avg * 2,
  min: avg / 2,
  total,
  tx_count: txCount,
  date: `${day}T00:00:00Z`,
});

const volumeRow = <C>(day: string, total: string, components: C[] = []): VolumeRow<C> => ({
  components,
  count: 1,
  exchange: { currency: "XRP" },
  total,
  exchange_rate: "1",
  start_time: `${day}T00:00:00Z`,
  end_time: `${nextDay(day)}T00:00:00Z`,
});
const paying = (currency: string, issuer: string | undefined, converted: string, count = 1): PaymentVolumeComponent => ({
  currency,
  ...(issuer ? { issuer } : {}),
  amount: converted,
  count,
  rate: "1",
  converted_amount: converted,
});
const trading = (total: string): ExchangeVolumeComponent => ({
  count: 3,
  rate: "1",
  amount: total,
  base: { currency: "XRP" },
  counter: { currency: "USD", issuer: USD_ISSUER },
  converted_amount: total,
});
const swapping = (total: string): AmmVolumeComponent => ({
  amm_account: "rAMMAccountOfAPoolXXXXXXXXXXXXXXX",
  base: { currency: "XRP" },
  counter: { currency: "USD", issuer: USD_ISSUER },
  count: 5,
  amount: total,
  rate: "1",
  converted_amount: total,
});

const validation = (key: string, ms: number): Validation => ({
  count: 1,
  first_datetime: `2026-10-17T17:01:12.${String(ms).padStart(3, "0")}Z`,
  last_datetime: `2026-10-17T17:01:12.${String(ms + 9).padStart(3, "0")}Z`,
  flags: "2147483649",
  ledger_hash: HASH,
  ledger_index: "107721455",
  signing_time: "2026-10-17T17:01:12Z",
  validation_public_key: key,
});
const KEY = "nHUFE9prPXPrHcG3SkwP1UzAQbSphqyQkQK9ATXLZsfkezhhda3p";
const keyOf = (n: number) => `nHB${String(n).padStart(2, "0")}${"x".repeat(44)}abc`;
const answer = (validations: Validation[], marker?: string): LedgerValidations => ({
  result: "success",
  ledger_hash: HASH,
  count: validations.length,
  ...(marker ? { marker } : {}),
  validations,
});
const LEDGER = { index: 107721455, hash: HASH };

/** Everything a 7-day view needs, answered. */
function input(overrides: Partial<NetworkInput> = {}): NetworkInput {
  const w = windowOf(T, "7d");
  return {
    net: XRPL,
    view: { period: "7d", display: "native" },
    last: LAST,
    feesList: feesList(),
    feeStats: fulfilled(page("rows", [FEE_STATS])),
    types: fulfilled(page("stats", w.buckets.map((day) => stat(day, { Payment: 100, OfferCreate: 50, AMMDeposit: 3, TrustSet: 2, AccountSet: 4 })))),
    metrics: fulfilled(page("stats", days(w.previous.start, T).map((day) => stat(day, day === T ? RUNNING_DAY : FULL_DAY)))),
    feeDays: fulfilled(page("rows", w.buckets.map((day) => feeDay(day, 0.000113, 0.0113, 100)))),
    payments: fulfilled(
      page("rows", days(w.previous.start, "2026-10-16").map((day) => volumeRow(day, "1000.5", [paying("XRP", undefined, "1000.5", 7)]))),
    ),
    exchanges: fulfilled(page("rows", days(w.start, "2026-10-16").map((day) => volumeRow(day, "250.25", [trading("250.25")])))),
    amm: fulfilled(page("rows", days(w.start, "2026-10-16").map((day) => volumeRow(day, "75.125", [swapping("75.125")])))),
    validators: fulfilled({ ledger: LEDGER, answer: answer([validation(KEY, 100), validation(keyOf(1), 140)]) }),
    ...overrides,
  };
}

// ---- The strip ---------------------------------------------------------------------------------------------------------------------

describe("stripOf", () => {
  it("is the newest 6 ledgers up to the latest: index, transactions, close time in unix seconds", () => {
    const strip = stripOf(feesList(), 107721455);
    expect(strip).toHaveLength(6);
    expect(strip[0]).toEqual({ index: 107721455, txCount: 107, closeTime: 1792256472 });
    expect(strip.map((chip) => chip.index)).toEqual([107721455, 107721454, 107721453, 107721452, 107721451, 107721450]);
    expect(strip[1]).toEqual({ index: 107721454, txCount: 80, closeTime: 1792256468 });
  });

  it("leaves out a ledger the page has not got as its latest", () => {
    expect(stripOf(feesList(), 107721455).some((chip) => chip.index === 107721456)).toBe(false);
    expect(stripOf(feesList(), 107721453)[0]?.index).toBe(107721453);
  });

  it("is what there is when there are fewer", () => {
    expect(stripOf(feesList().slice(0, 3), 107721455)).toHaveLength(2);
    expect(stripOf([], 107721455)).toEqual([]);
  });

  it("is built by networkPage with the home page's latest ledger: the newest the list has when the index is ahead of it", () => {
    const behind = networkPage(input({ feesList: feesList().slice(2) })).page.strip;
    expect(behind[0]?.index).toBe(107721454);
  });
});

// ---- The open ledger ---------------------------------------------------------------------------------------------------------------

describe("openLedgerOf", () => {
  it("gives the fees in whole drops, the sizes as integers and the time of day", () => {
    const part = openLedgerOf(ctxOf(), fulfilled(page("rows", [FEE_STATS])));
    expect(part).toEqual({ state: "ok", fee: "13", minimum: "10", queue: "0", openSize: "84", expected: "96", asOf: "17:01:10" });
  });

  it("rounds a drop half up, exactly: 12.5 is 13, and a float's 113.00000000000001 is 113", () => {
    expect(loaded(openLedgerOf(ctxOf(), fulfilled(page("rows", [{ ...FEE_STATS, open_ledger_fee: 0.000113 }])))).fee).toBe("113");
    expect(loaded(openLedgerOf(ctxOf(), fulfilled(page("rows", [{ ...FEE_STATS, open_ledger_fee: 0.0000124 }])))).fee).toBe("12");
    expect(loaded(openLedgerOf(ctxOf(), fulfilled(page("rows", [{ ...FEE_STATS, open_ledger_fee: 1e-7 }])))).fee).toBe("0");
  });

  it("reads the newest snapshot, the first row", () => {
    const part = loaded(openLedgerOf(ctxOf(), fulfilled(page("rows", [FEE_STATS, { ...FEE_STATS, current_ledger_size: 1 }]))));
    expect(part.openSize).toBe("84");
  });

  it("has failed when the list has no snapshot", () => {
    const context = ctxOf();
    // A builder that throws: the part says the fixed words, and the failure keeps the error.
    expect(openLedgerOf(context, fulfilled(page("rows", [])))).toEqual({ state: "failed", reason: "could not be loaded" });
    expect(context.failures.map((failure) => failure.part)).toEqual(["openLedger"]);
    expect(context.failures[0]?.error).toEqual(new Error("the data API has no fee snapshot"));
  });
});

// ---- Types -------------------------------------------------------------------------------------------------------------------------

describe("typesOf", () => {
  const w = windowOf(T, "7d");
  const rows = (...missing: string[]) => [
    ...w.buckets.filter((day) => !missing.includes(day)).map((day) => stat(day, { Payment: 3 })),
    stat("2026-10-01", { Payment: 1000 }),
  ];
  const chartOf = (...missing: string[]) => loaded(typesOf(ctxOf(), fulfilled(page("stats", rows(...missing))))).chart;

  it("aligns the rows to the window by date: a day without a row is null, a row outside the window is ignored", () => {
    const chart = chartOf("2026-10-13");
    expect(chart.axis).toEqual({ unit: "day", buckets: days("2026-10-11", T) });
    expect(chart.series[0]?.values).toEqual(["3", "3", null, "3", "3", "3", "3"]);
    expect(chart.totals).toEqual(["3", "3", null, "3", "3", "3", "3"]);
    expect(JSON.stringify(chart)).not.toContain("1000");
    expect(chart.forming).toBe(true);
    expect(chart.pending).toBe(0);
  });

  it("counts the newest buckets without a row as pending, at most two", () => {
    expect(chartOf("2026-10-17").pending).toBe(1);
    expect(chartOf("2026-10-16", "2026-10-17").pending).toBe(2);
    const three = chartOf("2026-10-15", "2026-10-16", "2026-10-17");
    expect(three.pending).toBe(2);
    expect(three.series[0]?.values[4]).toBeNull();
    expect(chartOf("2026-10-16").pending).toBe(0);
  });

  it("stacks the type groups of the network, a type of a group in its group and the rest in Other", () => {
    const chart = loaded(
      typesOf(
        ctxOf(),
        fulfilled(page("stats", [stat(T, { Payment: 10, OfferCreate: 5, AMMDeposit: 2, AMMWithdraw: 3, TrustSet: 1, AccountSet: 4, NFTokenMint: 6 })])),
      ),
    ).chart;
    const last = (id: string) => chart.series.find((series) => series.id === id)?.values.at(-1);
    expect(chart.series.map((series) => [series.id, series.label, series.slot])).toEqual([
      ["Payment", "Payment", 1],
      ["OfferCreate", "OfferCreate", 2],
      ["OfferCancel", "OfferCancel", 3],
      ["TrustSet", "TrustSet", 4],
      ["AMM", "AMM", 5],
      ["other", "Other", "other"],
    ]);
    expect([last("Payment"), last("OfferCreate"), last("OfferCancel"), last("TrustSet"), last("AMM"), last("other")]).toEqual(["10", "5", "0", "1", "5", "10"]);
    expect(chart.totals?.at(-1)).toBe("31");
    expect(chart.format).toEqual({ kind: "count", unit: "transactions" });
  });

  it("uses the Xahau groups on Xahau, and says so in the note", () => {
    const part = loaded(
      typesOf(ctxOf("7d", { net: XAHAU }), fulfilled(page("stats", [stat(T, { Payment: 1, Invoke: 2, URITokenMint: 3, URIToken: 4, Remit: 5 })]))),
    );
    expect(part.chart.series.map((series) => series.id)).toEqual(["Payment", "Invoke", "ClaimReward", "URIToken", "SetHook", "other"]);
    expect(part.chart.series.find((series) => series.id === "URIToken")?.values.at(-1)).toBe("7");
    expect(part.note).toBe("URIToken adds up its transaction types; Other is every other type.");
    expect(loaded(typesOf(ctxOf(), fulfilled(page("stats", [])))).note).toBe("AMM adds up its transaction types; Other is every other type.");
  });

  it("charts the weeks of a year", () => {
    const year = windowOf(T, "1y");
    const chart = loaded(typesOf(ctxOf("1y"), fulfilled(page("stats", year.buckets.map((week) => stat(week, { Payment: 700 })))))).chart;
    expect(chart.axis.unit).toBe("week");
    expect(chart.axis.buckets).toHaveLength(52);
    expect(chart.series[0]?.values).toHaveLength(52);
    expect(chart.pending).toBe(0);
  });
});

// ---- The totals --------------------------------------------------------------------------------------------------------------------

/** Rows of the metrics call for a window's F, P and running buckets, `f` and `p` each the totals of a period. */
function comparisonRows(w: PeriodWindow, f: Required<Metrics>, p: Required<Metrics>): StatsRow[] {
  const bucketsOf = (start: string, end: string) => bucketStarts(start, end, w.unit);
  const [full, previous] = [bucketsOf(w.full.start, w.full.end), bucketsOf(w.previous.start, w.previous.end)];
  const rowsOf = (buckets: string[], totals: Required<Metrics>) => {
    const [tx, ledgers, accounts] = [spread(totals.transaction_count, buckets.length), spread(totals.ledger_count, buckets.length), spread(totals.accounts_created, buckets.length)];
    return buckets.map((bucket, i) => stat(bucket, { transaction_count: tx[i]!, ledger_count: ledgers[i]!, accounts_created: accounts[i]! }));
  };
  // The running bucket is huge, so that it shows if anything counts it.
  const running = stat(w.buckets.at(-1)!, { transaction_count: 9_000_000, ledger_count: 1_000, accounts_created: 777 });
  return [...rowsOf(previous, p), ...rowsOf(full, f), running];
}
const METRICS = (tx: number, ledgers = 7_000, accounts = 700): Required<Metrics> => ({ transaction_count: tx, ledger_count: ledgers, accounts_created: accounts });

describe("metricsOf: the tiles", () => {
  const w = windowOf(T, "7d");
  const totals = () => {
    const rows = [...days("2026-10-11", "2026-10-16").map((day) => stat(day, FULL_DAY)), stat(T, RUNNING_DAY)];
    return loaded(metricsOf(ctxOf(), fulfilled(page("stats", rows))));
  };

  it("adds up the window, the running day included", () => {
    const tiles = totals();
    expect(tiles.transactions).toEqual({ value: "580K", delta: null, sub: null });
    expect(tiles.interval).toEqual({ value: "4.00 s", delta: null, sub: "average time between ledgers" });
    expect(tiles.perLedger).toEqual({ value: "4.0", delta: null, sub: null });
    expect(tiles.accountsCreated).toEqual({ value: "65", delta: null, sub: null });
  });

  it("ignores rows before the window, which feed the deltas only", () => {
    const rows = [stat("2026-10-05", { transaction_count: 99_999_999, ledger_count: 1, accounts_created: 99_999 }), ...days("2026-10-11", T).map((day) => stat(day, FULL_DAY))];
    const tiles = loaded(metricsOf(ctxOf(), fulfilled(page("stats", rows))));
    expect(tiles.accountsCreated.value).toBe("70");
  });

  it("counts a full bucket's length and the running one's seconds so far, as the weeks of a year show", () => {
    const year = windowOf(T, "1y");
    // 51 full weeks and the week of Oct 12, 5 days and 17:01:12 of it: every ledger takes 4 s.
    const rows = year.buckets.map((week, i) => stat(week, { transaction_count: 1, ledger_count: i === 51 ? 123_318 : 151_200 }));
    expect(loaded(metricsOf(ctxOf("1y"), fulfilled(page("stats", rows)))).interval.value).toBe("4.00 s");
  });

  it("counts the seconds of the buckets that have a row only, against the ledgers of those", () => {
    // The day before yesterday has no row: its seconds and ledgers are both left out.
    const rows = days("2026-10-11", T).filter((day) => day !== "2026-10-14").map((day) => stat(day, day === T ? RUNNING_DAY : FULL_DAY));
    expect(loaded(metricsOf(ctxOf(), fulfilled(page("stats", rows)))).interval.value).toBe("4.00 s");
  });

  it("rounds the interval to 2 decimals and the ratio to 1, half up, exactly", () => {
    const tiles = (counts: Metrics) => loaded(metricsOf(ctxOf(), fulfilled(page("stats", [stat(T, counts)]))));
    // The running day alone: 61,272 s over its ledgers.
    expect(tiles({ transaction_count: 3, ledger_count: 31_226 }).interval.value).toBe("1.96 s"); // 1.9622…
    expect(tiles({ transaction_count: 3, ledger_count: 31_226 }).perLedger.value).toBe("0.0");
    expect(tiles({ ledger_count: 12_254_400 }).interval.value).toBe("0.01 s"); // 0.005 exactly
    expect(tiles({ ledger_count: 12_254_401 }).interval.value).toBe("0.00 s"); // just under it
    expect(tiles({ transaction_count: 1_010, ledger_count: 200 }).perLedger.value).toBe("5.1"); // 5.05 exactly
    expect(tiles({ transaction_count: 1_030, ledger_count: 200 }).perLedger.value).toBe("5.2"); // 5.15 exactly
    expect(tiles({ transaction_count: 1_009, ledger_count: 200 }).perLedger.value).toBe("5.0"); // 5.045
  });

  it("reads a missing name in a present row as zero", () => {
    const tiles = loaded(metricsOf(ctxOf(), fulfilled(page("stats", [stat(T, { ledger_count: 15_318 })]))));
    expect(tiles.transactions.value).toBe("0");
    expect(tiles.accountsCreated.value).toBe("0");
    expect(tiles.interval.value).toBe("4.00 s");
  });

  it("has a dash for a ratio over no ledgers", () => {
    const tiles = loaded(metricsOf(ctxOf(), fulfilled(page("stats", []))));
    expect(tiles.interval.value).toBe("—");
    expect(tiles.perLedger.value).toBe("—");
    expect(tiles.transactions.value).toBe("0");
  });

  describe("the deltas", () => {
    const tiles = (rows: StatsRow[], period: WindowPeriod = "7d") => loaded(metricsOf(ctxOf(period), fulfilled(page("stats", rows))));
    const deltaOf = (f: Required<Metrics>, p: Required<Metrics>) => tiles(comparisonRows(w, f, p)).transactions.delta;

    it("is over full days: F against P, 1 decimal, signed, and says which days", () => {
      expect(deltaOf(METRICS(1_032_000), METRICS(1_000_000))).toEqual({ text: "+3.2%, 7 full days to Oct 16 vs the 7 before", sign: 1 });
    });

    it("is a drop with U+2212 when F is below P", () => {
      expect(deltaOf(METRICS(1_000_000), METRICS(1_032_000))).toEqual({ text: "\u22123.1%, 7 full days to Oct 16 vs the 7 before", sign: -1 });
    });

    it("never counts the running day", () => {
      const rows = comparisonRows(w, METRICS(1_032_000), METRICS(1_000_000));
      expect(rows.at(-1)?.transaction_count).toBe(9_000_000);
      expect(tiles(rows).transactions.delta?.text).toMatch(/^\+3\.2%/);
      expect(tiles(rows).transactions.value).toBe("9M"); // the window does count it: 6 days of 1 and the running 9,000,000
    });

    it("rounds half up, away from zero for a drop, and a change that rounds to nothing is flat", () => {
      expect(deltaOf(METRICS(2_001), METRICS(2_000))).toEqual({ text: "+0.1%, 7 full days to Oct 16 vs the 7 before", sign: 1 }); // +0.05%
      expect(deltaOf(METRICS(1_999), METRICS(2_000))).toEqual({ text: "\u22120.1%, 7 full days to Oct 16 vs the 7 before", sign: -1 }); // −0.05%
      expect(deltaOf(METRICS(2_000), METRICS(2_000))).toEqual({ text: "0.0%, 7 full days to Oct 16 vs the 7 before", sign: 0 });
      expect(deltaOf(METRICS(2_000_001), METRICS(2_000_000))?.sign).toBe(0); // +0.00005%
    });

    it("groups the thousands of a large change", () => {
      expect(deltaOf(METRICS(126_000), METRICS(10_000))?.text).toBe("+1,160.0%, 7 full days to Oct 16 vs the 7 before");
    });

    it("has none when a day of P has no row, or the last day of F", () => {
      const rows = comparisonRows(w, METRICS(1_032_000), METRICS(1_000_000));
      expect(tiles(rows.filter((row) => row.date !== "2026-10-05T00:00:00Z")).transactions.delta).toBeNull();
      expect(tiles(rows.filter((row) => row.date !== "2026-10-16T00:00:00Z")).transactions.delta).toBeNull();
      expect(tiles(rows).transactions.delta).not.toBeNull();
    });

    it("has none when the previous period added up to nothing", () => {
      expect(deltaOf(METRICS(1_032_000), METRICS(0))).toBeNull();
    });

    it("is for Transactions and Accounts created, and for Transactions per ledger by its ratio, not Ledger interval", () => {
      const rows = comparisonRows(
        w,
        { transaction_count: 1_000_000, ledger_count: 10_000, accounts_created: 770 },
        { transaction_count: 1_000_000, ledger_count: 20_000, accounts_created: 700 },
      );
      const result = tiles(rows);
      expect(result.transactions.delta).toEqual({ text: "0.0%, 7 full days to Oct 16 vs the 7 before", sign: 0 });
      expect(result.perLedger.delta).toEqual({ text: "+100.0%, 7 full days to Oct 16 vs the 7 before", sign: 1 }); // 100 against 50
      expect(result.accountsCreated.delta).toEqual({ text: "+10.0%, 7 full days to Oct 16 vs the 7 before", sign: 1 });
      expect(result.interval.delta).toBeNull();
    });

    it("compares the ratios, so more ledgers for the same transactions is a drop", () => {
      const rows = comparisonRows(w, METRICS(1_000_000, 20_000), METRICS(1_000_000, 10_000));
      expect(tiles(rows).perLedger.delta).toEqual({ text: "\u221250.0%, 7 full days to Oct 16 vs the 7 before", sign: -1 });
    });

    it("has none for the ratio when F has no ledgers, or P's ratio is nothing", () => {
      const noLedgersInF = comparisonRows(w, { transaction_count: 1_000_000, ledger_count: 0, accounts_created: 700 }, METRICS(1_000_000));
      expect(tiles(noLedgersInF).perLedger.delta).toBeNull();
      const noTransactionsInP = comparisonRows(w, METRICS(1_000_000), { transaction_count: 0, ledger_count: 7_000, accounts_created: 700 });
      expect(tiles(noTransactionsInP).perLedger.delta).toBeNull();
    });

    it("names 52 full weeks for a year", () => {
      const year = windowOf(T, "1y");
      const rows = comparisonRows(year, METRICS(1_032_000, 52_000, 5_200), METRICS(1_000_000, 52_000, 5_200));
      expect(tiles(rows, "1y").transactions.delta).toEqual({ text: "+3.2%, 52 full weeks to Oct 11 vs the 52 before", sign: 1 });
    });
  });
});

// ---- The fee chart -----------------------------------------------------------------------------------------------------------------

describe("feesOf", () => {
  it("is one series of the average fee in drops, a day's avg", () => {
    const w = windowOf(T, "7d");
    const rows = w.buckets.map((day, i) => feeDay(day, i === 0 ? 0.000113 : 0.00001, 1, 10));
    const { chart } = loaded(feesOf(ctxOf(), fulfilled(page("rows", rows))));
    expect(chart.series).toEqual([{ id: "fee", label: "Average fee", slot: 1, values: ["113", "10", "10", "10", "10", "10", "10"] }]);
    expect(chart.axis).toEqual({ unit: "day", buckets: w.buckets });
    expect(chart.format).toEqual({ kind: "drops", unit: "drops" });
    expect(chart.forming).toBe(true);
    expect(chart.pending).toBe(0);
    expect(chart.totals).toBeUndefined();
  });

  it("leaves a day without a row null and the newest ones pending", () => {
    const w = windowOf(T, "7d");
    const rows = w.buckets.slice(0, 5).map((day) => feeDay(day, 0.00001, 1, 10));
    rows.splice(1, 1);
    const { chart } = loaded(feesOf(ctxOf(), fulfilled(page("rows", rows))));
    expect(chart.series[0]?.values).toEqual(["10", null, "10", "10", "10", null, null]);
    expect(chart.pending).toBe(2);
  });

  describe("for a year", () => {
    const year = windowOf(T, "1y");
    const everyDay = days(year.start, T);
    /** Each day pays 0.0113 for 100 transactions (113 drops each), except as `change` says. */
    const rows = (change: (day: string, i: number) => FeeBucketRow | null = () => null) =>
      everyDay.flatMap((day, i) => change(day, i) ?? [feeDay(day, 0.000113, 0.0113, 100)]);
    const valuesOf = (list: FeeBucketRow[]) => loaded(feesOf(ctxOf("1y"), fulfilled(page("rows", list)))).chart.series[0]!.values;

    it("is a week's total over its transactions, in drops, half up", () => {
      // The first week: 7 days of 0.1 with 6,000 transactions in all: 116.67 drops each.
      const first = rows((day, i) => (i < 7 ? feeDay(day, 0.0001, 0.1, i === 0 ? 5_994 : 1) : null));
      const values = valuesOf(first);
      expect(values).toHaveLength(52);
      expect(values[0]).toBe("117");
      expect(values[1]).toBe("113");
      expect(values[51]).toBe("113");
    });

    it("takes the running week's days up to T, six of them, as a whole week", () => {
      expect(everyDay.slice(-6)).toEqual(days("2026-10-12", T));
      expect(valuesOf(rows()).at(-1)).toBe("113");
    });

    it("is null for a week with one of its days missing, and pending when it is the running one", () => {
      const without = (gone: string) => rows().filter((row) => row.date.slice(0, 10) !== gone);
      const values = valuesOf(without("2026-01-07"));
      expect(values[11]).toBeNull();
      expect(values.filter((value) => value === null)).toHaveLength(1);
      const running = loaded(feesOf(ctxOf("1y"), fulfilled(page("rows", without(T))))).chart;
      expect(running.series[0]?.values.at(-1)).toBeNull();
      expect(running.pending).toBe(1);
    });

    it("is 0 for a week without a transaction", () => {
      const quiet = rows((day, i) => (i < 7 ? feeDay(day, 0, 0, 0) : null));
      expect(valuesOf(quiet)[0]).toBe("0");
    });
  });
});

// ---- The volumes -------------------------------------------------------------------------------------------------------------------

describe("paymentsOf", () => {
  const w = windowOf(T, "7d");
  /** P and F (Oct 3 to Oct 16) as they come, the running day with no row. */
  const everyRow = (total: (day: string) => string = () => "100.1") =>
    days(w.previous.start, "2026-10-16").map((day) => volumeRow(day, total(day), [paying("XRP", undefined, total(day))]));
  const partOf = (rows: VolumeRow<PaymentVolumeComponent>[], context = ctxOf()) => loaded(paymentsOf(context, fulfilled(page("rows", rows))));

  it("is a series of the window's totals with the running day pending, and a tile that says what it counts", () => {
    const part = partOf(everyRow());
    expect(part.series.buckets).toEqual(days("2026-10-11", T));
    expect(part.series.unit).toBe("day");
    expect(part.series.values).toEqual(["100.1", "100.1", "100.1", "100.1", "100.1", "100.1", null]);
    expect(part.series.pending).toBe(1);
    expect(part.series.forming).toBe(true);
    expect(part.figure.value).toBe("600.6 XRP");
    expect(part.figure.sub).toBe("to Oct 16; Oct 17 not computed yet");
  });

  it("says nothing of pending when the running day is counted, and names a day further back too", () => {
    const counted = partOf([...everyRow(), volumeRow(T, "5", [paying("XRP", undefined, "5")])]);
    expect(counted.series.pending).toBe(0);
    expect(counted.figure.sub).toBeNull();
    expect(counted.figure.value).toBe("605.6 XRP");

    const two = partOf(everyRow().slice(0, -1));
    expect(two.series.pending).toBe(2);
    expect(two.figure.sub).toBe("to Oct 15; Oct 16 and Oct 17 not computed yet");
  });

  it("reads the total in the currency of the view", () => {
    expect(partOf(everyRow(), ctxOf("7d", { display: "usd" })).figure.value).toBe("600.6 USD");
    expect(partOf(everyRow(), ctxOf("7d", { net: XAHAU })).figure.value).toBe("600.6 XAH");
  });

  it("has a delta over the full days only", () => {
    const rows = everyRow((day) => (day < "2026-10-10" ? "100" : "100.1"));
    expect(partOf(rows).figure.delta).toEqual({ text: "+0.1%, 7 full days to Oct 16 vs the 7 before", sign: 1 });
    // The newest full day is not computed yet: F is incomplete.
    expect(partOf(rows.slice(0, -1)).figure.delta).toBeNull();
    // P has nothing paid.
    expect(partOf(everyRow((day) => (day < "2026-10-10" ? "0" : "100.1"))).figure.delta).toBeNull();
  });

  describe("by currency", () => {
    const [a, b] = ["2026-10-15", "2026-10-16"];
    const rows = [
      volumeRow(a, "900", [paying("XRP", undefined, "600", 3), paying("USD", USD_ISSUER, "300", 2)]),
      volumeRow(b, "400.4", [paying("XRP", undefined, "300", 4), paying("USD", USD_ISSUER, "100", 1), paying("EUR", USD_ISSUER, "0.4", 1)]),
    ];

    it("sums the components of the window per currency and issuer, largest first, with whole-percent shares", () => {
      const { byCurrency } = partOf(rows);
      expect(byCurrency.items).toEqual([
        { id: "XRP", label: "XRP", value: "900", share: "69%", count: "7" },
        { id: `USD.${USD_ISSUER}`, label: "USD", sublabel: "rhub8V…F3wq", value: "400", share: "31%", count: "3" },
        { id: `EUR.${USD_ISSUER}`, label: "EUR", sublabel: "rhub8V…F3wq", value: "0.4", share: "<1%", count: "1" },
      ]);
      expect(byCurrency.format).toEqual({ kind: "amount", unit: "XRP" });
    });

    // The data API writes a tiny amount, or a rate from 1e8, with BigNumber's text, in exponent form (`isNumberText` takes it). The view reads the converted
    // amount through BigNumber and writes it with `toFixed()`, so no exponent reaches a figure, a share or a label.
    it("writes a component the API sent in exponent form as a plain decimal", () => {
      const dust = [
        volumeRow(a, "0.0000007", [
          { ...paying("XRP", undefined, "2e-7"), amount: "2e-7" },
          { ...paying("USD", USD_ISSUER, "5.0E-7"), amount: "2.5e-7", rate: "1.2345679e+8" },
        ]),
      ];
      const part = partOf(dust);

      expect(part.byCurrency.items.map((item) => [item.label, item.value, item.share])).toEqual([
        ["USD", "0.0000005", "71%"],
        ["XRP", "0.0000002", "29%"],
      ]);
      expect(JSON.stringify(part)).not.toMatch(/\de[+-]\d/i);
    });

    it("names the currencies in a note", () => {
      expect(partOf(rows).currencies).toBe("Payments in the currencies the data API tracks: XRP, USD, EUR.");
      expect(partOf([]).currencies).toBe("Payments in the currencies the data API tracks.");
    });

    it("keeps one row per issuer of a currency, and names the currency once in the note", () => {
      const other = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
      const { byCurrency, currencies } = partOf([volumeRow(a, "30", [paying("USD", USD_ISSUER, "20"), paying("USD", other, "10")])]);
      expect(byCurrency.items.map((item) => [item.label, item.sublabel])).toEqual([
        ["USD", "rhub8V…F3wq"],
        ["USD", "rMxCKb…m5De"],
      ]);
      expect(currencies).toBe("Payments in the currencies the data API tracks: USD.");
    });

    it("shows a 40-hex code through formatCurrency", () => {
      const rlusd = "524C555344000000000000000000000000000000";
      const { byCurrency, currencies } = partOf([volumeRow(a, "10", [paying(rlusd, "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", "10")])]);
      expect(byCurrency.items[0]).toMatchObject({ label: "RLUSD", sublabel: "rMxCKb…m5De", share: "100%" });
      expect(currencies).toBe("Payments in the currencies the data API tracks: RLUSD.");
    });

    it("leaves out the rows of days outside the window", () => {
      const before = volumeRow("2026-10-05", "999", [paying("XRP", undefined, "999")]);
      expect(partOf([before, ...rows]).byCurrency.items[0]?.value).toBe("900");
    });

    it("converts into the view's currency: the bars are in the converted amounts", () => {
      expect(partOf(rows, ctxOf("7d", { display: "usd" })).byCurrency.format).toEqual({ kind: "amount", unit: "USD" });
    });
  });
});

describe("exchangesOf", () => {
  const w = windowOf(T, "7d");
  const rows = (last: string) => days(w.start, last).map((day) => volumeRow(day, "250.25", [trading("250.25")]));

  it("is the window's totals, the sum of the rows, with its pending words", () => {
    const part = loaded(exchangesOf(ctxOf(), fulfilled(page("rows", rows("2026-10-16")))));
    expect(part.series.values).toEqual(["250.25", "250.25", "250.25", "250.25", "250.25", "250.25", null]);
    expect(part.series.pending).toBe(1);
    expect(part.total).toBe("1501.5");
    expect(part.pendingWords).toBe("to Oct 16; Oct 17 not computed yet");
  });

  it("adds exactly: 0.1 and 0.2 are 0.3, and a total past 2^53 keeps its fraction", () => {
    const total = (...totals: string[]) =>
      loaded(exchangesOf(ctxOf(), fulfilled(page("rows", totals.map((value, i) => volumeRow(days(w.start, T)[i]!, value)))))).total;
    expect(total("0.1", "0.2")).toBe("0.3");
    expect(total("9007199254740993.5", "0.5")).toBe("9007199254740994");
    expect(total("1.50", "2.50")).toBe("4");
  });

  it("has no pending words when the running day has a row", () => {
    const part = loaded(exchangesOf(ctxOf(), fulfilled(page("rows", rows(T)))));
    expect(part.pendingWords).toBeNull();
    expect(part.total).toBe("1751.75");
  });

  it("charts the weeks of a year, a week pending in its first hours", () => {
    const year = windowOf(T, "1y");
    const part = loaded(exchangesOf(ctxOf("1y"), fulfilled(page("rows", year.buckets.slice(0, -1).map((week) => volumeRow(week, "10"))))));
    expect(part.series.unit).toBe("week");
    expect(part.series.pending).toBe(1);
    expect(part.pendingWords).toBe("to the week of Oct 5; the week of Oct 12 not computed yet");
    expect(part.total).toBe("510");
  });
});

describe("ammOf", () => {
  const w = windowOf(T, "7d");
  const rows = days(w.start, "2026-10-16").map((day) => volumeRow(day, "75.125", [swapping("75.125")]));

  it("is ok with the series and the total of what answered", () => {
    const part = ammOf(ctxOf(), fulfilled(page("rows", rows)));
    expect(part).toMatchObject({ state: "ok", total: "450.75" });
    expect(part.state === "ok" && part.series.pending).toBe(1);
    expect(part.state === "ok" && part.series.values[0]).toBe("75.125");
  });

  it("is failed, with the fixed reason and the error kept, when the call was rejected, a missing route included", () => {
    const context = ctxOf();
    const error = new UpstreamError("server", "data API GET /v2/network/amm_volume answered 404: Cannot GET /v2/network/amm_volume (the data API has no such route)");
    expect(ammOf(context, rejected(error))).toEqual({ state: "failed", reason: "could not be loaded" });
    expect(context.failures).toEqual([{ part: "amm", error }]);
  });

  it("is off and none as answers, not failures", () => {
    const context = ctxOf();
    expect(ammOf(context, "off")).toEqual({ state: "off" });
    expect(ammOf(context, "none")).toEqual({ state: "none" });
    expect(context.failures).toEqual([]);
  });
});

// ---- The validators ----------------------------------------------------------------------------------------------------------------

describe("validatorsOf", () => {
  // Seven validations, unsorted: the delays after the earliest are 0, 40, 80, 120, 160, 220 and 300 ms.
  const times = [260, 100, 400, 180, 140, 220, 320];
  const validations = times.map((ms, i) => validation(i === 1 ? KEY : keyOf(i), ms));
  const partOf = (answer_: LedgerValidations, context = ctxOf()) => loaded(validatorsOf(context, fulfilled({ ledger: LEDGER, answer: answer_ })));

  it("counts the validations and names the ledger", () => {
    const part = partOf(answer(validations));
    expect(part.count).toBe("7");
    expect(part.ledger).toEqual(LEDGER);
  });

  it("lists the 5 earliest, sorted, each with its delay after the first and its key in short form", () => {
    const { first } = partOf(answer(validations));
    expect(first).toHaveLength(5);
    expect(first.map((validator) => validator.delay)).toEqual(["+0 ms", "+40 ms", "+80 ms", "+120 ms", "+160 ms"]);
    expect(first[0]).toEqual({ key: KEY, short: "nHUFE9prPX…a3p", delay: "+0 ms" });
    expect(first.map((validator) => validator.key)).toEqual([KEY, keyOf(4), keyOf(3), keyOf(5), keyOf(0)]);
  });

  it("breaks a tie by the key", () => {
    const { first } = partOf(answer([validation("nHBbbb", 100), validation("nHBaaa", 100), validation("nHBccc", 100)]));
    expect(first.map((validator) => validator.key)).toEqual(["nHBaaa", "nHBbbb", "nHBccc"]);
  });

  it("groups the thousands of a long delay", () => {
    const { first } = partOf(answer([validation("nHBaaa", 100), { ...validation("nHBbbb", 100), first_datetime: "2026-10-17T17:01:13.350Z" }]));
    expect(first.map((validator) => validator.delay)).toEqual(["+0 ms", "+1,250 ms"]);
  });

  it("says 1,000+ when the answer has a next page", () => {
    expect(partOf(answer(validations, "MARKER")).count).toBe("1,000+");
    expect(partOf(answer(Array.from({ length: 1_000 }, (_, i) => validation(keyOf(i), 100 + (i % 50))), "MARKER")).count).toBe("1,000+");
    expect(partOf(answer(Array.from({ length: 35 }, (_, i) => validation(keyOf(i), 100 + i)))).count).toBe("35");
  });

  it("links to the validators with the switch on, and to nothing with it off", () => {
    expect(partOf(answer(validations)).href).toBe("/xrpl/validators?scope=all");
    const off = ctxOf("7d", { net: { ...XRPL, features: { validators: false, ammData: true, markets: true, accountAnalytics: true } } });
    expect(partOf(answer(validations), off).href).toBeNull();
    expect(partOf(answer(validations), ctxOf("7d", { net: { ...XAHAU, features: { validators: true, ammData: false, markets: false, accountAnalytics: false } } })).href).toBe("/xahau/validators?scope=all");
  });

  it("is an empty list for no validations", () => {
    expect(partOf(answer([]))).toMatchObject({ count: "0", first: [] });
  });
});

// ---- The page ----------------------------------------------------------------------------------------------------------------------

describe("networkPage", () => {
  it("makes the page from the answers: the anchor, the view, the window and every part", () => {
    const { page: data, failures } = networkPage(input());
    expect(failures).toEqual([]);
    expect(data.anchor).toEqual({ lastValidated: 107721455, closeTime: 1792256472 });
    expect(data.view).toEqual({ period: "7d", display: "native" });
    expect(data.displays).toEqual(["native", "usd"]);
    expect(data.currency).toBe("XRP");
    expect(data.window).toEqual({ unit: "day", note: "Totals and charts cover the 7 days from Oct 11 to Oct 17, 2026 (UTC), today so far" });
    expect(data.strip).toHaveLength(6);
    for (const part of [data.openLedger, data.validators, data.types, data.metrics, data.fees, data.payments, data.exchanges, data.amm]) {
      expect(part.state).toBe("ok");
    }
  });

  it("says the amounts are in USD for the USD view, and names USD as the currency", () => {
    const { page: data } = networkPage(input({ view: { period: "30d", display: "usd" } }));
    expect(data.currency).toBe("USD");
    expect(data.window.note).toBe(
      "Totals and charts cover the 30 days from Sep 18 to Oct 17, 2026 (UTC), today so far, amounts in USD issued by GateHub at each day's DEX rate",
    );
  });

  it("is in weeks for a year", () => {
    const { page: data } = networkPage(input({ view: { period: "1y", display: "native" } }));
    expect(data.window).toEqual({
      unit: "week",
      note: "Totals and charts cover the 52 weeks from the week of Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), this week so far",
    });
  });

  it("is the Xahau page: native XAH, no USD, groups of Xahau, and no AMM", () => {
    const { page: data, failures } = networkPage(input({ net: XAHAU, amm: "none" }));
    expect(failures).toEqual([]);
    expect(data.currency).toBe("XAH");
    expect(data.displays).toEqual(["native"]);
    expect(data.amm).toEqual({ state: "none" });
    expect(data.types.state === "ok" && data.types.chart.series.map((series) => series.id)).toContain("Invoke");
    expect(data.validators.state === "ok" && data.validators.href).toBeNull();
  });

  it("has AMM off as an answer", () => {
    const { page: data, failures } = networkPage(input({ amm: "off" }));
    expect(data.amm).toEqual({ state: "off" });
    expect(failures).toEqual([]);
  });

  describe("when a call failed", () => {
    const cases: [keyof NetworkInput, keyof NetworkPageData][] = [
      ["types", "types"],
      ["metrics", "metrics"],
      ["feeDays", "fees"],
      ["payments", "payments"],
      ["exchanges", "exchanges"],
      ["feeStats", "openLedger"],
      ["validators", "validators"],
      ["amm", "amm"],
    ];

    it.each(cases)("a rejected %s fails %s and nothing else, and is in the failures", (call, part) => {
      const error = new UpstreamError("server", `data API GET /v2/${call} answered 503`);
      const { page: data, failures } = networkPage(input({ [call]: rejected(error) } as Partial<NetworkInput>));
      expect(data[part]).toEqual({ state: "failed", reason: "could not be loaded" });
      expect(failures).toEqual([{ part, error }]);
      for (const [, other] of cases) if (other !== part) expect(data[other]).not.toMatchObject({ state: "failed" });
    });

    it("gives the reason \"took too long\" to a call that was too late", () => {
      const late = new TooLate();
      const { page: data, failures } = networkPage(input({ types: rejected(late), validators: rejected(late) }));
      expect(data.types).toEqual({ state: "failed", reason: "took too long" });
      expect(data.validators).toEqual({ state: "failed", reason: "took too long" });
      expect(failures.map((failure) => failure.part).sort()).toEqual(["types", "validators"]);
      expect(failures.every((failure) => failure.error === late)).toBe(true);
    });

    it("gives the fixed reason to what is not an error too, and keeps it in the failures", () => {
      const { page: data, failures } = networkPage(input({ types: rejected("gone") }));
      expect(data.types).toEqual({ state: "failed", reason: "could not be loaded" });
      expect(failures).toEqual([{ part: "types", error: "gone" }]);
    });

    // The page data goes to browsers, in the HTML and in the `.data` payload: nothing of the error reaches it, only the log.
    it("sends nothing of the error to the page: not its message, the upstream's path or query, nor the API's words", () => {
      const secret = "data API GET /v2/stats/type?end=2026-10-17&start=2026-10-11 answered 500: unable to query the cluster at db-7.internal";
      const calls: (keyof NetworkInput)[] = ["types", "metrics", "feeDays", "payments", "exchanges", "feeStats", "validators", "amm"];
      const rejections = Object.fromEntries(calls.map((call) => [call, rejected(new UpstreamError("server", secret))])) as Partial<NetworkInput>;
      const { page: data, failures } = networkPage(input(rejections));
      const sent = JSON.stringify(data);
      expect(sent).not.toContain("db-7.internal");
      expect(sent).not.toContain("/v2/");
      expect(sent).not.toContain("answered 500");
      expect(sent.match(/"reason":"could not be loaded"/g)).toHaveLength(calls.length);
      expect(failures.every((failure) => (failure.error as Error).message === secret)).toBe(true);
    });

    it("fails a part whose answer the builder cannot use, rather than the page", () => {
      const broken = fulfilled({ result: "success", count: 1, rows: null }) as unknown as NetworkInput["payments"];
      const { page: data, failures } = networkPage(input({ payments: broken }));
      expect(data.payments).toEqual({ state: "failed", reason: "could not be loaded" });
      expect(data.types.state).toBe("ok");
      expect(failures.map((failure) => failure.part)).toEqual(["payments"]);
      expect(failures[0]?.error).toBeInstanceOf(Error);
      expect(JSON.stringify(data)).not.toContain((failures[0]!.error as Error).message);
    });
  });

  describe("the tokens of the charts", () => {
    const tokensOf = (data: NetworkPageData) => {
      const [types, fees, payments, exchanges, amm] = [loaded(data.types), loaded(data.fees), loaded(data.payments), loaded(data.exchanges), data.amm];
      if (amm.state !== "ok") throw new Error("amm");
      return {
        types: types.chart.token,
        fees: fees.chart.token,
        payments: payments.series.token,
        byCurrency: payments.byCurrency.token,
        exchanges: exchanges.series.token,
        amm: amm.series.token,
      };
    };

    it("are the same for the same input, and eight hex digits", () => {
      const [first, second] = [tokensOf(networkPage(input()).page), tokensOf(networkPage(input()).page)];
      expect(first).toEqual(second);
      for (const token of Object.values(first)) expect(token).toMatch(/^[0-9a-f]{8}$/);
      expect(new Set(Object.values(first)).size).toBe(Object.keys(first).length);
    });

    const w = windowOf(T, "7d");
    const changes: [string, Partial<NetworkInput>][] = [
      ["types", { types: fulfilled(page("stats", w.buckets.map((day) => stat(day, { Payment: day === "2026-10-13" ? 101 : 100, OfferCreate: 50, AMMDeposit: 3, TrustSet: 2, AccountSet: 4 })))) }],
      ["fees", { feeDays: fulfilled(page("rows", w.buckets.map((day) => feeDay(day, day === "2026-10-13" ? 0.000114 : 0.000113, 0.0113, 100)))) }],
      ["exchanges", { exchanges: fulfilled(page("rows", days(w.start, "2026-10-16").map((day) => volumeRow(day, day === "2026-10-13" ? "250.26" : "250.25", [trading("250.25")])))) }],
      ["amm", { amm: fulfilled(page("rows", days(w.start, "2026-10-16").map((day) => volumeRow(day, day === "2026-10-13" ? "75.126" : "75.125", [swapping("75.125")])))) }],
    ];
    it.each(changes)("a changed value of one bucket changes the token of %s only", (name, change) => {
      const [before, after] = [tokensOf(networkPage(input()).page), tokensOf(networkPage(input(change)).page)];
      for (const key of Object.keys(before) as (keyof typeof before)[]) {
        if (key === name) expect(after[key]).not.toBe(before[key]);
        else expect(after[key]).toBe(before[key]);
      }
    });

    it("a changed payment total changes the line's token, and a changed component the bars'", () => {
      const rows = (total: string, converted: string) =>
        fulfilled(page("rows", days(windowOf(T, "7d").previous.start, "2026-10-16").map((day) => volumeRow(day, total, [paying("XRP", undefined, converted)]))));
      const base = tokensOf(networkPage(input({ payments: rows("5", "5") })).page);
      const total = tokensOf(networkPage(input({ payments: rows("6", "5") })).page);
      const component = tokensOf(networkPage(input({ payments: rows("5", "6") })).page);
      expect([total.payments !== base.payments, total.byCurrency === base.byCurrency]).toEqual([true, true]);
      expect([component.payments === base.payments, component.byCurrency !== base.byCurrency]).toEqual([true, true]);
    });

    it("a bucket that is pending or null is not the same chart as one with a value", () => {
      const without = fulfilled(page("rows", days(w.start, "2026-10-15").map((day) => volumeRow(day, "250.25", [trading("250.25")]))));
      expect(tokensOf(networkPage(input({ exchanges: without })).page).exchanges).not.toBe(tokensOf(networkPage(input()).page).exchanges);
    });
  });

  describe("no float reaches the page", () => {
    // The fee 0.000113 is 113.00000000000001 drops in floating point, and 0.1 + 0.2 is 0.30000000000000004.
    const floaty = (period: WindowPeriod) => {
      const w = windowOf(T, period);
      const everyDay = days(w.start, T);
      return input({
        view: { period, display: "native" },
        feeStats: fulfilled(page("rows", [{ ...FEE_STATS, open_ledger_fee: 0.000113, minimum_fee: 0.0000001 }])),
        types: fulfilled(page("stats", w.buckets.map((day) => stat(day, { Payment: 1_234_567, OfferCreate: 7, AMMDeposit: 3 })))),
        metrics: fulfilled(page("stats", bucketStarts(w.previous.start, T, w.unit).map((day) => stat(day, { transaction_count: 1_234_567, ledger_count: 20_001, accounts_created: 3 })))),
        feeDays: fulfilled(page("rows", everyDay.map((day) => feeDay(day, 0.000113, 0.1 + 0.2, 7)))),
        payments: fulfilled(
          page("rows", bucketStarts(w.previous.start, "2026-10-16", w.unit).map((day) => volumeRow(day, "0.1", [paying("XRP", undefined, "0.1", 3), paying("USD", USD_ISSUER, "0.2", 3)]))),
        ),
        exchanges: fulfilled(page("rows", w.buckets.map((day) => volumeRow(day, "0.7", [trading("0.7")])))),
        amm: fulfilled(page("rows", w.buckets.map((day) => volumeRow(day, "123456789012345678.123456789", [swapping("1")])))),
      });
    };

    const strings = (value: unknown, found: string[] = []): string[] => {
      if (typeof value === "string") found.push(value);
      else if (Array.isArray(value)) for (const item of value) strings(item, found);
      else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, found);
      return found;
    };
    const numbers = (value: unknown, found: number[] = []): number[] => {
      if (typeof value === "number") found.push(value);
      else if (Array.isArray(value)) for (const item of value) numbers(item, found);
      else if (value && typeof value === "object") for (const item of Object.values(value)) numbers(item, found);
      return found;
    };
    const DECIMAL = /^\d+(\.\d+)?$/;

    it.each(["7d", "30d", "1y"] as const)("%s: values are decimal strings, and no string has an exponent or a long fraction", (period) => {
      const { page: data, failures } = networkPage(floaty(period));
      expect(failures).toEqual([]);

      const [types, fees, payments, exchanges] = [loaded(data.types), loaded(data.fees), loaded(data.payments), loaded(data.exchanges)];
      const amm = data.amm;
      if (amm.state !== "ok") throw new Error("amm");
      const values = [
        ...types.chart.series.flatMap((series) => series.values),
        ...(types.chart.totals ?? []),
        ...fees.chart.series.flatMap((series) => series.values),
        ...payments.series.values,
        ...exchanges.series.values,
        ...amm.series.values,
      ];
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) if (value !== null) expect(value).toMatch(DECIMAL);
      for (const item of payments.byCurrency.items) expect(item.value).toMatch(DECIMAL);

      expect(strings(data).filter((text) => /e[+-]\d|\d\.\d{12,}/.test(text))).toEqual([]);
      expect(numbers(data).filter((n) => !Number.isInteger(n))).toEqual([]);
    });

    it("gives the exact sums of the floaty answers", () => {
      const { page: data } = networkPage(floaty("7d"));
      // Six days of W have a row for the payments (0.1 and 0.2 a day), and all seven for the trades and the swaps.
      expect(loaded(data.payments).byCurrency.items.map((item) => [item.label, item.value])).toEqual([
        ["USD", "1.2"],
        ["XRP", "0.6"],
      ]);
      expect(loaded(data.exchanges).total).toBe("4.9");
      const amm = data.amm;
      expect(amm.state === "ok" && amm.total).toBe("864197523086419746.864197523");
      expect(loaded(data.openLedger).fee).toBe("113");
      expect(loaded(data.openLedger).minimum).toBe("0");
    });
  });
});
