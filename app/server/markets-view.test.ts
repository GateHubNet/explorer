import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { formatPrice } from "../domain/format";
import type { MarketsParams } from "../domain/market-params";
import { checkMarkets } from "./aggregate-shape";
import type { MarketRow, MarketsResponse, SparklineDay } from "./api-types";
import { marketsPage, type MarketsPageData } from "./markets-view";

// ---- The world of the tests: T is Oct 19, 11:42:31 UTC; the window starts on the hour before the 24 hours --------------------------

const GH = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const BS = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const EVR_ISSUER = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const LIONS_HEX = "4C494F4E53000000000000000000000000000000";

type Input = Parameters<typeof marketsPage>[0];
const FEATURES = { validators: false, ammData: true, markets: true };
const XRPL: Input["network"] = { id: "xrpl", name: "XRPL", native: "XRP", hasAmm: true, features: FEATURES };
const XRPL_AMM_OFF: Input["network"] = { ...XRPL, features: { ...FEATURES, ammData: false } };
/** The switch is "on" at the top level of every environment, Xahau's included: `hasAmm` is what rules there. */
const XAHAU: Input["network"] = { id: "xahau", name: "Xahau", native: "XAH", hasAmm: false, features: FEATURES };

const DEFAULT: MarketsParams = { period: "24h", quote: null, trades: null };
const START = "2026-10-18T11:00:00Z";
const END = "2026-10-19T11:42:31Z";

/** The seven days of a sparkline, ending with Oct 19; `null` is a day without a close. */
function days(closes: (string | null)[]): SparklineDay[] {
  return closes.map((close, at) => ({ date: `2026-10-${13 + at}T00:00:00Z`, ...(close === null ? {} : { close }) }));
}

/** EUR/USD as the API stores it ("eur" sorts before "usd"), and as it is shown: USD is the counter. */
function eurUsd(over: Partial<MarketRow> = {}): MarketRow {
  return {
    base_currency: "EUR",
    base_issuer: BS,
    counter_currency: "USD",
    counter_issuer: GH,
    count: 120,
    base_volume: "5000",
    counter_volume: "5425",
    native_volume: "13000",
    open: "1.0800",
    high: "1.0880",
    low: "1.0790",
    last: "1.0850",
    change: "0.46",
    open_time: "2026-10-18T11:03:00Z",
    last_time: "2026-10-19T11:40:00Z",
    sparkline: days(["1.0700", "1.0750", "1.0760", "1.0790", "1.0800", "1.0820", "1.0850"]),
    ...over,
  };
}

/** USD/XRP as the API stores it ("usd" sorts before "xrp"): the natural orientation is the reverse, XRP / USD. */
function usdXrp(over: Partial<MarketRow> = {}): MarketRow {
  return {
    base_currency: "USD",
    base_issuer: GH,
    counter_currency: "XRP",
    count: 900,
    base_volume: "1000",
    counter_volume: "2440",
    native_volume: "2440",
    open: "2.38",
    high: "2.45",
    low: "2.3",
    last: "2.44",
    change: "2.52",
    open_time: "2026-10-18T11:01:00Z",
    last_time: "2026-10-19T11:41:00Z",
    sparkline: days([null, null, "2.38", "2.40", "2.41", "2.42", "2.44"]),
    ...over,
  };
}

/** RLUSD/XRP as stored (the brief's row): shown as XRP / RLUSD at the inverse prices. */
function rlusdXrp(over: Partial<MarketRow> = {}): MarketRow {
  return {
    base_currency: RLUSD_HEX,
    base_issuer: RL,
    counter_currency: "XRP",
    count: 412,
    base_volume: "5000",
    counter_volume: "3750",
    native_volume: "3750",
    open: "0.8",
    high: "0.8",
    low: "0.7",
    last: "0.75",
    change: "-6.25",
    open_time: "2026-10-18T11:05:00Z",
    last_time: "2026-10-19T11:38:00Z",
    sparkline: days([null, null, "0.8", "0.78", "0.76", "0.72", "0.75"]),
    ...over,
  };
}

function totalsOf(markets: MarketRow[], extra: Partial<NonNullable<MarketsResponse["totals"]>> = {}): NonNullable<MarketsResponse["totals"]> {
  const sum = markets.reduce((total, row) => total.plus(row.native_volume ?? 0), new BigNumber(0));
  return { pairs: markets.length, pairs_traded: 1840, count: markets.reduce((n, row) => n + row.count, 0), native_volume: sum.toFixed(), ...extra };
}

function answerOf(markets: MarketRow[], over: Partial<MarketsResponse> = {}, totals: Parameters<typeof totalsOf>[1] = {}): MarketsResponse {
  return { result: "success", period: "day", start_time: START, end_time: END, totals: totalsOf(markets, totals), count: markets.length, markets, ...over };
}

function pageOf(markets: MarketRow[], options: { network?: Input["network"]; params?: Partial<MarketsParams>; over?: Partial<MarketsResponse>; totals?: Parameters<typeof totalsOf>[1] } = {}): MarketsPageData {
  const { network = XRPL, params = {}, over = {}, totals = {} } = options;
  return marketsPage({ network, params: { ...DEFAULT, ...params }, answer: answerOf(markets, over, totals) });
}

/** The answer of a period nothing has computed yet (D2): no set, no window, no totals. */
const NO_SET: MarketsResponse = { result: "success", period: "day", count: 0, markets: [] };

const EXPONENT = /\d[eE][+-]?\d/;

/** Every text of the page that is a number (P15): a token or an address may hold an `e` before a digit, these may not. */
function numericTexts(data: MarketsPageData): string[] {
  return [
    ...data.rows.flatMap((row) => [row.last, row.change.text, row.range, row.volume, row.trades, row.amm?.text ?? "", row.spark.label, ...row.spark.closes.filter((close) => close !== null)]),
    ...(data.tiles ?? []).map((tile) => tile.value),
  ];
}

/** The significant digits of a price text: no sign, no grouping, no leading zeros, no trailing zeros of an integer. */
function significantDigits(text: string): number {
  return text.replace(/[,\u2212-]/g, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
}

// ---- Orientation ------------------------------------------------------------------------------------------------------------------

describe("marketsPage: a pair shown the other way round from the stored order", () => {
  const view = pageOf([rlusdXrp()]).rows[0]!;

  it("shows the stored RLUSD/XRP as XRP / RLUSD, linked in that orientation", () => {
    expect(view.pair).toBe("XRP / RLUSD");
    expect(view.href).toBe(`/xrpl/markets/XRP/RLUSD.${RL}`);
    expect(view.issuers).toBe("RLUSD rMxCKb…m5De");
  });

  it("prices it at 1/last, with the range from 1/low to 1/high, at 8 significant digits", () => {
    expect(view.last).toBe(formatPrice("1.3333333"));
    expect(view.last).toBe("1.3333333");
    // high' is the inverse of low (0.7), low' the inverse of high (0.8)
    expect(view.range).toBe("1.25 – 1.4285714");
  });

  it("recomputes the change from the API's own open and last, not by flipping its sign", () => {
    // (open / last - 1) * 100 = (0.8 / 0.75 - 1) * 100 = 6.666...; the stored change was -6.25
    expect(view.change).toEqual({ text: "+6.67%", dir: "up" });
  });

  it("keeps the native volume and the trade count (they belong to the pair, not to a side)", () => {
    expect(view.volume).toBe("3,750");
    expect(view.trades).toBe("412");
  });

  it("inverts each close of the sparkline and leaves a missing one missing", () => {
    expect(view.spark.closes).toEqual([null, null, "1.25", "1.2820513", "1.3157895", "1.3888889", "1.3333333"]);
  });

  it("describes the inverted line from its own first and last close", () => {
    // 1.25 to 1.3333333: (1.3333333 / 1.25 - 1) * 100 = 6.666664
    expect(view.spark.label).toBe("7-day price, from 1.25 to 1.3333333 (today so far), +6.7%");
  });

  it("recomputes the change of an inverted row whose stored change is missing (P4: a recomputed value is there)", () => {
    const { change: _dropped, ...stored } = rlusdXrp();
    expect(pageOf([stored]).rows[0]!.change).toEqual({ text: "+6.67%", dir: "up" });
  });

  it("shows an inverse that fell as a loss", () => {
    // stored 0.8 -> 0.9 rose; the inverse, 1.25 -> 1.1111111, fell: (0.8 / 0.9 - 1) * 100 = -11.11...
    const row = pageOf([rlusdXrp({ open: "0.8", last: "0.9", high: "0.9", low: "0.8", change: "12.50" })]).rows[0]!;
    expect(row.change).toEqual({ text: "\u2212" + "11.11%", dir: "down" });
  });

  it("treats a side with an empty issuer, as a stored native leg carries, as the native currency", () => {
    const row = pageOf([rlusdXrp({ counter_issuer: "" })]).rows[0]!;
    expect(row.pair).toBe("XRP / RLUSD");
    expect(row.href).toBe(`/xrpl/markets/XRP/RLUSD.${RL}`);
  });

  it("rounds an inverse half up, not to even (1 / 4096 = 0.000244140625)", () => {
    expect(pageOf([rlusdXrp({ last: "4096", open: "4096", high: "4096", low: "4096" })]).rows[0]!.last).toBe("0.00024414063");
  });

  it.each([
    ["3", "0.33333333"],
    ["7", "0.14285714"],
    ["0.07", "14.285714"],
    ["1.1", "0.90909091"],
    ["0.9", "1.1111111"],
    ["1.0000000e-7", "10,000,000"],
    ["1.2345679e+8", "0.0000000081"],
  ])("inverts %s to %s with no float in it", (stored, shown) => {
    expect(pageOf([rlusdXrp({ last: stored })]).rows[0]!.last).toBe(shown);
  });

  it("inverts a price of a worthless token in exponent form without losing its digits, and writes no exponent", () => {
    const row = pageOf([rlusdXrp({ last: "3.0000000e+95" })]).rows[0]!;
    expect(row.last).toMatch(/^0\.0{95}33333333$/);
    expect(row.last).not.toMatch(EXPONENT);
  });

  it("shows a dash for a price that cannot be inverted, and gives it no price rank", () => {
    const view = pageOf([rlusdXrp({ last: "0", low: "0", change: "-100" })]).rows[0]!;
    expect(view.last).toBe("—");
    expect(view.range).toBe("—");
    expect(view.change).toEqual({ text: "—", dir: "flat" });
    expect(view.ranks.last).toBeNull();
  });

  it("puts a row with no usable price last in both directions: the others are ranked among themselves", () => {
    const rows = pageOf([rlusdXrp({ last: "0", low: "0" }), eurUsd({ last: "1.5" }), eurUsd({ last: "1.2" })]).rows;
    expect(rows.map((row) => row.ranks.last)).toEqual([null, 1, 0]);
  });

  it("shows a dash, and does not throw, for a price that is not a number", () => {
    // bignumber.js throws on text that is not a number (strict mode); the page's data never does
    const inverted = pageOf([rlusdXrp({ last: "abc", low: "abc", high: "x1", open: "abc", sparkline: days(["abc", "0.8", "oops", null, "0.7", "1e", "0.75"]) })]).rows[0]!;
    expect(inverted.last).toBe("—");
    expect(inverted.range).toBe("—");
    expect(inverted.change).toEqual({ text: "—", dir: "flat" });
    expect(inverted.ranks.last).toBeNull();
    expect(inverted.spark.closes).toEqual([null, "1.25", null, null, "1.4285714", null, "1.3333333"]);
    expect(inverted.spark.label).toBe("7-day price, from 1.25 to 1.3333333 (today so far), +6.7%");
  });
});

describe("marketsPage: a pair shown as it is stored", () => {
  const view = pageOf([eurUsd()]).rows[0]!;

  it("keeps EUR/USD, with the API's prices and change", () => {
    expect(view.pair).toBe("EUR / USD");
    expect(view.last).toBe("1.085");
    expect(view.range).toBe("1.079 – 1.088");
    expect(view.change).toEqual({ text: "+0.46%", dir: "up" });
    expect(view.href).toBe(`/xrpl/markets/EUR.${BS}/USD.${GH}`);
  });

  it("names each issued side's code and short issuer, base first", () => {
    expect(view.issuers).toBe("EUR rvYAfW…s59B · USD rhub8V…F3wq");
  });

  it("shows USD/XRP, as stored, as XRP / USD", () => {
    const row = pageOf([usdXrp()]).rows[0]!;
    expect(row.pair).toBe("XRP / USD");
    expect(row.last).toBe("0.40983607");
    expect(row.issuers).toBe("USD rhub8V…F3wq");
    expect(row.href).toBe(`/xrpl/markets/XRP/USD.${GH}`);
  });

  it("writes a minus as U+2212 and a change that rounds to zero as 0.00% with no sign", () => {
    expect(pageOf([eurUsd({ change: "-2.375" })]).rows[0]!.change).toEqual({ text: "\u22122.38%", dir: "down" });
    expect(pageOf([eurUsd({ change: "0.00" })]).rows[0]!.change).toEqual({ text: "0.00%", dir: "flat" });
    expect(pageOf([eurUsd({ change: "-0.004" })]).rows[0]!.change).toEqual({ text: "0.00%", dir: "flat" });
  });

  it("shows a missing change as a dash, flat (P4)", () => {
    const { change: _dropped, ...stored } = eurUsd();
    expect(pageOf([stored]).rows[0]!.change).toEqual({ text: "—", dir: "flat" });
  });

  it("shows a dash, and does not throw, for stored prices that are not numbers", () => {
    const bad = eurUsd({ last: "abc", low: "n/a", change: "abc", native_volume: "abc", sparkline: days(["abc", "1.07", null, null, null, null, "oops"]), amm_share: "abc" });
    // built by hand: the test helper that sums the volumes is bignumber.js too
    const { markets: _none, ...bare } = answerOf([]);
    const row = marketsPage({ network: XRPL, params: DEFAULT, answer: { ...bare, markets: [bad], count: 1 } }).rows[0]!;
    expect(row.last).toBe("—");
    expect(row.range).toBe("—");
    expect(row.change).toEqual({ text: "—", dir: "flat" });
    expect(row.ranks).toMatchObject({ last: null, change: null, volume: null });
    expect(row.spark.closes).toEqual([null, "1.07", null, null, null, null, null]);
    expect(row.volume).toBe("—");
    expect(row.amm).toEqual({ text: "—", meter: null });
  });

  it("shows a price in exponent text as a plain number", () => {
    const row = pageOf([eurUsd({ last: "1.0000000e-7", low: "1.0000000e-7", high: "1.2345679e+8" })]).rows[0]!;
    expect(row.last).toBe("0.0000001");
    expect(row.range).toBe("0.0000001 – 123,456,790");
  });
});

describe("marketsPage: the Quote filter", () => {
  const markets = [
    usdXrp(),
    eurUsd(),
    // BTC/XRP: no USD on either side
    { ...usdXrp(), base_currency: "BTC", base_issuer: LIONS_ISSUER },
  ];

  it("keeps the rows with the currency on either side, and makes it the counter", () => {
    const rows = pageOf(markets, { params: { quote: "usd" } }).rows;
    expect(rows.map((row) => row.pair)).toEqual(["XRP / USD", "EUR / USD"]);
  });

  it("re-orients a USD/XRP row so that USD is the counter, and a EUR/USD row stays EUR/USD", () => {
    const [xrpUsd, eur] = pageOf(markets, { params: { quote: "usd" } }).rows;
    expect(xrpUsd!.last).toBe("0.40983607");
    expect(xrpUsd!.change).toEqual({ text: "\u22122.46%", dir: "down" });
    expect(eur!.last).toBe("1.085");
  });

  it("makes XRP the counter when XRP is the quote: USD / XRP at the stored price", () => {
    const rows = pageOf(markets, { params: { quote: "xrp" } }).rows;
    expect(rows.map((row) => row.pair)).toEqual(["USD / XRP", "BTC / XRP"]);
    expect(rows[0]!.last).toBe("2.44");
    expect(rows[0]!.change).toEqual({ text: "+2.52%", dir: "up" });
    expect(rows[0]!.href).toBe(`/xrpl/markets/USD.${GH}/XRP`);
  });

  it("gives a row with the quote on both sides (two issuers) the natural orientation, whatever its stored order", () => {
    // stored with the Bitstamp issuer first; "rhub8V..." sorts before "rvYAfW...", so the natural base is the GateHub USD
    const both: MarketRow = { ...eurUsd(), base_currency: "USD", base_issuer: BS, counter_currency: "USD", counter_issuer: GH, last: "0.5", open: "0.5", high: "0.5", low: "0.5" };
    const row = pageOf([both], { params: { quote: "usd" } }).rows[0]!;
    expect(row.pair).toBe("USD / USD");
    expect(row.issuers).toBe("USD rhub8V…F3wq · USD rvYAfW…s59B");
    expect(row.last).toBe("2");
  });

  it("says so when no row has the quote", () => {
    const data = pageOf([usdXrp()], { params: { quote: "eur" } });
    expect(data.rows).toEqual([]);
    expect(data.empty).toBe("No EUR pairs with at least 10 trades in the last 24 hours.");
    expect(pageOf([usdXrp()], { params: { period: "7d", quote: "btc" } }).empty).toBe("No BTC pairs with at least 10 trades in the last 7 days.");
  });

  it("matches the display code, so the hex of USD is USD, and does not match a different case", () => {
    const standardHex = `${"0".repeat(24)}555344${"0".repeat(10)}`;
    const hexUsd = usdXrp({ base_currency: standardHex });
    const lower = usdXrp({ base_currency: "usd" });
    const rows = pageOf([hexUsd, lower], { params: { quote: "usd" } }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pair).toBe("XRP / USD");
  });

  it("does not take an issued XRP for the native currency", () => {
    const junk = usdXrp({ counter_issuer: LIONS_ISSUER });
    expect(pageOf([junk], { params: { quote: "xrp" } }).rows).toEqual([]);
  });

  it("filters Xahau by XAH", () => {
    const evr = { ...usdXrp(), base_currency: "EVR", base_issuer: EVR_ISSUER, counter_currency: "XAH", count: 50 };
    const rows = pageOf([evr, eurUsd()], { network: XAHAU, params: { quote: "xah" } }).rows;
    expect(rows.map((row) => row.pair)).toEqual(["EVR / XAH"]);
  });
});

// ---- Ranks ------------------------------------------------------------------------------------------------------------------------

describe("marketsPage: ranks", () => {
  const rows = [
    eurUsd({ last: "2", count: 50, native_volume: "1.5e+3", change: "1.00" }),
    eurUsd({ last: "10", count: 50, native_volume: "999.99" }),
    eurUsd({ last: "1", count: 5, native_volume: undefined, change: "-3.00" }),
  ];
  // the second row has no change at all
  const { change: _dropped, ...noChange } = rows[1]!;
  const ranked = pageOf([rows[0]!, noChange, rows[2]!]).rows.map((row) => row.ranks);

  it("is each row's place (from 0) in an exact ascending sort of what is shown", () => {
    expect(ranked.map((r) => r.last)).toEqual([1, 2, 0]);
    expect(ranked[0]!.change).toBe(1);
    expect(ranked[2]!.change).toBe(0);
  });

  it("gives equal trade counts one rank, the place of the first of them", () => {
    expect(ranked.map((r) => r.trades)).toEqual([1, 1, 0]);
  });

  it("gives three tied rows one rank, so that a sort either way keeps the API's order among them (spec 2.4)", () => {
    // Three pairs of 10 trades each, in the API's order (by volume, largest first), and one of 50.
    const tied = pageOf([
      eurUsd({ count: 10, native_volume: "3000", change: "0.00" }),
      usdXrp({ count: 50, native_volume: "2000", change: "1.00" }),
      eurUsd({ count: 10, native_volume: "1000", counter_issuer: BS, change: "0.00" }),
      eurUsd({ count: 10, native_volume: "500", base_issuer: GH, change: "0.00" }),
    ]).rows;
    expect(tied.map((row) => row.ranks.trades)).toEqual([0, 3, 0, 0]);
    // The "0.00" changes tie too, above the XRP / USD row's, which falls when inverted.
    expect(tied.map((row) => row.ranks.change)).toEqual([1, 0, 1, 1]);
    expect(tied.map((row) => row.ranks.volume)).toEqual([3, 2, 1, 0]);
  });

  it("gives a row without a native volume no volume rank, and ranks the others by volume (exponent text included)", () => {
    expect(ranked.map((r) => r.volume)).toEqual([1, 0, null]);
  });

  it("gives a row without a change no change rank (P4), so that it is last in both directions", () => {
    expect(ranked.map((r) => r.change)).toEqual([1, null, 0]);
  });

  it("compares decimals exactly: two volumes a float cannot tell apart", () => {
    // 90071992547409930.1 and .2 are the same double; the API lists the larger one first
    const pair = pageOf([eurUsd({ native_volume: "90071992547409930.2" }), eurUsd({ native_volume: "90071992547409930.1" })]).rows;
    expect(pair.map((row) => row.ranks.volume)).toEqual([1, 0]);
  });

  it("compares prices as they are shown: an inverted row by its inverse", () => {
    // XRP / RLUSD shows 1.3333333, EUR / USD 1.085, XRP / USD 0.40983607
    const mixed = pageOf([rlusdXrp(), eurUsd(), usdXrp()]).rows;
    expect(mixed.map((row) => row.ranks.last)).toEqual([2, 1, 0]);
  });

  it("ranks only the rows that are listed, after the Quote filter", () => {
    const listed = pageOf([rlusdXrp(), eurUsd(), usdXrp()], { params: { quote: "usd" } }).rows;
    expect(listed.map((row) => row.pair)).toEqual(["EUR / USD", "XRP / USD"]);
    expect(listed.map((row) => row.ranks.last)).toEqual([1, 0]);
    expect(listed.map((row) => row.ranks.trades)).toEqual([0, 1]);
  });
});

// ---- Tiles, the note, the empty states --------------------------------------------------------------------------------------------

describe("marketsPage: the totals", () => {
  const markets = [
    usdXrp({ native_volume: "10000000", count: 1200 }),
    eurUsd({ native_volume: "2300000.25", count: 800 }),
    rlusdXrp({ native_volume: "45678.25", count: 34 }),
  ];

  it("sums the native volume and the trade count of the rows listed, exactly", () => {
    const tiles = pageOf(markets).tiles!;
    expect(tiles.slice(0, 3)).toEqual([
      { label: "DEX volume", value: "12.3M XRP", sub: "last 24 hours, pairs listed" },
      { label: "Trades", value: "2,034", sub: "last 24 hours, pairs listed" },
      { label: "Pairs shown", value: "3", sub: "of 1,840 with trades" },
    ]);
  });

  it("names the period in the subs, and the native code of the network", () => {
    expect(pageOf(markets, { params: { period: "7d" } }).tiles![0]!.sub).toBe("last 7 days, pairs listed");
    expect(pageOf(markets, { params: { period: "30d" } }).tiles![1]!.sub).toBe("last 30 days, pairs listed");
    expect(pageOf(markets, { network: XAHAU }).tiles![0]!.value).toBe("12.3M XAH");
  });

  it("leaves a row without a native volume out of the sum", () => {
    const tiles = pageOf([usdXrp({ native_volume: "2000" }), eurUsd({ native_volume: undefined })]).tiles!;
    expect(tiles[0]!.value).toBe("2,000 XRP");
    expect(tiles[2]!.value).toBe("2");
  });

  it("sums exponent text exactly, and sums the rows that survive a Quote filter only", () => {
    const rows = [usdXrp({ native_volume: "1.5e+3" }), eurUsd({ native_volume: "500" }), rlusdXrp({ native_volume: "0.5" })];
    expect(pageOf(rows).tiles![0]!.value).toBe("2,000.5 XRP");
    expect(pageOf(rows, { params: { quote: "xrp" } }).tiles![0]!.value).toBe("1,500.5 XRP");
    expect(pageOf(rows, { params: { quote: "xrp" } }).tiles![2]).toEqual({ label: "Pairs shown", value: "2", sub: "of 1,840 with trades" });
  });

  it("has no tiles, no note and a message when the API has no set yet", () => {
    const data = marketsPage({ network: XRPL, params: DEFAULT, answer: NO_SET });
    expect(data.tiles).toBeNull();
    expect(data.note).toBeNull();
    expect(data.rows).toEqual([]);
    expect(data.empty).toBe("No market figures yet for this period. The data API computes them every minute.");
  });

  it("names the cadence of the period in the no-set message: every five minutes for 7 and 30 days (D2)", () => {
    for (const period of ["7d", "30d"] as const) {
      const answer: MarketsResponse = { ...NO_SET, period: period === "7d" ? "7day" : "30day" };
      expect(marketsPage({ network: XRPL, params: { ...DEFAULT, period }, answer }).empty).toBe(
        "No market figures yet for this period. The data API computes them every five minutes.",
      );
    }
  });

  it("says in an empty Quote view that only the pairs served were looked at, when more qualify", () => {
    const thousand = Array.from({ length: 1000 }, () => usdXrp());
    const data = pageOf(thousand, { params: { quote: "eur" }, totals: { pairs: 2140 } });
    expect(data.empty).toBe("No EUR pairs with at least 10 trades in the last 24 hours. The 1,000 pairs with the most volume of 2,140.");
    // everything that qualifies was served: the plain message
    expect(pageOf(thousand, { params: { quote: "eur" } }).empty).toBe("No EUR pairs with at least 10 trades in the last 24 hours.");
    expect(pageOf([usdXrp()], { params: { quote: "eur" }, totals: { pairs: 2140 } }).empty).toBe(
      "No EUR pairs with at least 10 trades in the last 24 hours. The 1 pairs with the most volume of 2,140.",
    );
  });

  it("says nothing is listed, for a set in which no pair qualifies", () => {
    const data = pageOf([]);
    expect(data.tiles).not.toBeNull();
    expect(data.rows).toEqual([]);
    expect(data.empty).toBe("No pairs with at least 10 trades in the last 24 hours.");
  });

  it("has no empty message when there are rows", () => {
    expect(pageOf(markets).empty).toBeNull();
  });
});

describe("marketsPage: the AMM", () => {
  const withShares = [
    usdXrp({ amm_share: "0.3400", amm_pool: true }),
    eurUsd({ amm_share: "0.0049", amm_pool: true }),
    rlusdXrp({ amm_share: "0.0050", amm_pool: true }),
  ];

  it("shows the AMM tile, the column and the row texts with AMM_DATA on", () => {
    const data = pageOf(withShares, { totals: { amm_share: "0.3400" } });
    expect(data.ammColumn).toBe(true);
    expect(data.tiles![3]).toEqual({ label: "AMM share of volume", value: "34%", sub: "swaps against AMM pools" });
    expect(data.rows.map((row) => row.amm!.text)).toEqual(["34%", "<1%", "1%"]);
  });

  it("reads 0 with a pool as 0%, 0 with no pool as 'no pool', and a share without a pool as its percent", () => {
    const rows = pageOf([
      usdXrp({ amm_share: "0.0000", amm_pool: true }),
      eurUsd({ amm_share: "0.0000", amm_pool: false }),
      rlusdXrp({ amm_share: "0.1200", amm_pool: false }),
    ]).rows;
    expect(rows.map((row) => row.amm!.text)).toEqual(["0%", "no pool", "12%"]);
  });

  it("reads 0 with no word about a pool as 0%", () => {
    expect(pageOf([usdXrp({ amm_share: "0.0000" })]).rows[0]!.amm!.text).toBe("0%");
  });

  it("gives a decorative meter to a row with a share, one that is a fraction of 1, and none to a dash or a missing pool", () => {
    const rows = pageOf([...withShares, eurUsd(), eurUsd({ amm_share: "0.0000", amm_pool: false })], { totals: { amm_share: "0.34" + "00" } }).rows;
    expect(rows[0]!.amm!.meter).toMatchObject({ value: "0.3400", max: "1" });
    expect(rows[3]!.amm).toEqual({ text: "—", meter: null });
    expect(rows[4]!.amm).toEqual({ text: "no pool", meter: null });
    expect(rows[0]!.amm!.meter!.label).toContain("34%");
  });

  it("shows a dash in the tile, and in every row, when the answer has no amm_share", () => {
    const data = pageOf([usdXrp(), eurUsd()]);
    expect(data.ammColumn).toBe(true);
    expect(data.tiles![3]).toEqual({ label: "AMM share of volume", value: "—", sub: "not complete for this period yet" });
    expect(data.rows.map((row) => row.amm)).toEqual([
      { text: "—", meter: null },
      { text: "—", meter: null },
    ]);
  });

  it("does not read the AMM fields with AMM_DATA off: no tile, no column, no row cell, the plain intro", () => {
    const data = pageOf(withShares, { network: XRPL_AMM_OFF, totals: { amm_share: "0.3400" } });
    expect(data.ammColumn).toBe(false);
    expect(data.tiles!.map((tile) => tile.label)).toEqual(["DEX volume", "Trades", "Pairs shown"]);
    expect(data.rows.map((row) => row.amm)).toEqual([null, null, null]);
    expect(data.intro).toBe("Trades on the XRP Ledger DEX.");
  });

  it("shows what the client's check leaves of the AMM fields: 0.34 as 34%, a share it cannot read as a dash, a totals share that is a number as not complete", () => {
    const answer = checkMarkets(
      answerOf(
        [usdXrp({ amm_share: "0.34", amm_pool: true }), eurUsd({ amm_share: "abc", amm_pool: true }), rlusdXrp({ amm_share: 1.2 as unknown as string, amm_pool: true })],
        {},
        { amm_share: 0.12 as unknown as string },
      ),
    );
    const data = marketsPage({ network: XRPL, params: DEFAULT, answer });
    expect(data.rows.map((row) => row.amm)).toEqual([
      { text: "34%", meter: { value: "0.34", max: "1", label: "AMM share 34%" } },
      { text: "—", meter: null },
      { text: "—", meter: null },
    ]);
    expect(data.tiles![3]).toEqual({ label: "AMM share of volume", value: "—", sub: "not complete for this period yet" });
    expect(data.rows.map((row) => row.last)).toEqual(["0.40983607", "1.085", "1.3333333"]);
  });

  it("ignores what Xahau's answer says (\"0.0000\"): a dash tile that says why, no column, no cell", () => {
    const data = pageOf([eurUsd({ amm_share: "0.0000", amm_pool: false })], { network: XAHAU, totals: { amm_share: "0.0000" } });
    expect(data.ammColumn).toBe(false);
    expect(data.tiles![3]).toEqual({ label: "AMM share of volume", value: "—", sub: "Xahau has no AMM" });
    expect(data.rows[0]!.amm).toBeNull();
  });
});

describe("marketsPage: the Trades filter", () => {
  const rows = [usdXrp()];

  it("is not shown while the window's AMM data is incomplete (no totals.amm_share)", () => {
    expect(pageOf(rows).filters.trades).toBeNull();
  });

  it("is All, Order book and AMM when AMM_DATA is on and the answer has totals.amm_share", () => {
    const { trades } = pageOf(rows, { totals: { amm_share: "0.3400" } }).filters;
    expect(trades).toEqual([
      { label: "All", href: "/xrpl/markets", current: true },
      { label: "Order book", href: "/xrpl/markets?trades=book", current: false },
      { label: "AMM", href: "/xrpl/markets?trades=amm", current: false },
    ]);
  });

  it("marks the view's own link", () => {
    const { trades } = pageOf(rows, { params: { trades: "amm" }, over: { amm: "only" }, totals: { amm_share: "0.3400" } }).filters;
    expect(trades!.map((link) => link.current)).toEqual([false, false, true]);
    expect(pageOf(rows, { params: { trades: "book" }, over: { amm: "exclude" }, totals: { amm_share: "0.3400" } }).filters.trades!.map((link) => link.current)).toEqual([false, true, false]);
  });

  it("is not shown with AMM_DATA off, even when the answer has the field", () => {
    expect(pageOf(rows, { network: XRPL_AMM_OFF, totals: { amm_share: "0.3400" } }).filters.trades).toBeNull();
  });

  it("is not shown on Xahau", () => {
    expect(pageOf(rows, { network: XAHAU, totals: { amm_share: "0.0000" } }).filters.trades).toBeNull();
  });

  it("is shown on a view it filters even while the window's AMM data is incomplete, so that the view is named and can be left", () => {
    const data = pageOf(rows, { params: { period: "7d", trades: "amm" }, over: { amm: "only" } });
    expect(data.filters.trades).toEqual([
      { label: "All", href: "/xrpl/markets?period=7d", current: false },
      { label: "Order book", href: "/xrpl/markets?period=7d&trades=book", current: false },
      { label: "AMM", href: "/xrpl/markets?period=7d&trades=amm", current: true },
    ]);
    expect(data.filters.period.map((link) => link.href)).toEqual(["/xrpl/markets?trades=amm", "/xrpl/markets?period=7d&trades=amm", "/xrpl/markets?period=30d&trades=amm"]);
    expect(data.view).toEqual(["last 7 days", "AMM swaps"]);
    // The unfiltered view of the same window still does not offer it (P19).
    expect(pageOf(rows, { params: { period: "7d" } }).filters.trades).toBeNull();
  });

  it("is carried by the other filters' links while it is shown", () => {
    const data = pageOf(rows, { params: { trades: "amm" }, over: { amm: "only" }, totals: { amm_share: "0.3400" } });
    expect(data.filters.period[1]!.href).toBe("/xrpl/markets?period=7d&trades=amm");
    expect(data.filters.quote[2]!.href).toBe("/xrpl/markets?quote=usd&trades=amm");
  });
});

describe("marketsPage: the Period and Quote filters", () => {
  it("links the three periods and marks the current one", () => {
    expect(pageOf([usdXrp()]).filters.period).toEqual([
      { label: "24 h", href: "/xrpl/markets", current: true },
      { label: "7 days", href: "/xrpl/markets?period=7d", current: false },
      { label: "30 days", href: "/xrpl/markets?period=30d", current: false },
    ]);
    expect(pageOf([usdXrp()], { params: { period: "30d" } }).filters.period.map((link) => link.current)).toEqual([false, false, true]);
  });

  it("links All and the network's quotes, keeping the period", () => {
    expect(pageOf([usdXrp()], { params: { period: "7d", quote: "usd" } }).filters.quote).toEqual([
      { label: "All", href: "/xrpl/markets?period=7d", current: false },
      { label: "XRP", href: "/xrpl/markets?period=7d&quote=xrp", current: false },
      { label: "USD", href: "/xrpl/markets?period=7d&quote=usd", current: true },
      { label: "EUR", href: "/xrpl/markets?period=7d&quote=eur", current: false },
      { label: "BTC", href: "/xrpl/markets?period=7d&quote=btc", current: false },
    ]);
  });

  it("offers Xahau's own quotes, on Xahau's links", () => {
    expect(pageOf([usdXrp()], { network: XAHAU }).filters.quote).toEqual([
      { label: "All", href: "/xahau/markets", current: true },
      { label: "XAH", href: "/xahau/markets?quote=xah", current: false },
      { label: "USD", href: "/xahau/markets?quote=usd", current: false },
    ]);
  });
});

describe("marketsPage: the intro, the note and the footnote", () => {
  it("has the three intros of the spec", () => {
    expect(pageOf([]).intro).toBe("Trades on the XRP Ledger DEX: order-book crossings and swaps against AMM pools.");
    expect(pageOf([], { network: XRPL_AMM_OFF }).intro).toBe("Trades on the XRP Ledger DEX.");
    expect(pageOf([], { network: XAHAU }).intro).toBe("Trades on the Xahau DEX. Xahau has no AMM, so every trade is an order-book crossing.");
  });

  it("states the window of the figures, minutes cut", () => {
    expect(pageOf([usdXrp()]).note).toBe(
      "Figures cover Oct 18, 11:00 to Oct 19, 11:42 UTC: the 24 hours from the start of an hour, recomputed every minute.",
    );
  });

  it("says 'every five minutes' for 7 and 30 days", () => {
    expect(pageOf([usdXrp()], { params: { period: "7d" } }).note).toBe(
      "Figures cover Oct 18, 11:00 to Oct 19, 11:42 UTC: the 7 days from the start of an hour, recomputed every five minutes.",
    );
    expect(pageOf([usdXrp()], { params: { period: "30d" } }).note).toMatch(/the 30 days from the start of an hour, recomputed every five minutes\.$/);
  });

  it("cuts the minutes of a window that ends at 11:59:59", () => {
    expect(pageOf([usdXrp()], { over: { end_time: "2026-10-19T11:59:59Z" } }).note).toContain("to Oct 19, 11:59 UTC");
  });

  it("has no note when the answer has no window", () => {
    const { start_time: _a, end_time: _b, ...bare } = answerOf([usdXrp()]);
    expect(marketsPage({ network: XRPL, params: DEFAULT, answer: bare }).note).toBeNull();
  });

  it("has D2's footnote, in the native currency of the network", () => {
    expect(pageOf([usdXrp()]).footnote).toEqual({
      left: "Pairs with at least 10 trades in the period. Volume in XRP: the XRP side of pairs against XRP, other pairs at the period's rate.",
      right: "Prices are counter per base.",
    });
    expect(pageOf([usdXrp()], { network: XAHAU }).footnote.left).toBe(
      "Pairs with at least 10 trades in the period. Volume in XAH: the XAH side of pairs against XAH, other pairs at the period's rate.",
    );
  });

  it("says how many pairs were served when more qualify", () => {
    const thousand = Array.from({ length: 1000 }, () => usdXrp());
    const data = pageOf(thousand, { totals: { pairs: 2140 } });
    expect(data.footnote.left).toBe(
      "Pairs with at least 10 trades in the period. Volume in XRP: the XRP side of pairs against XRP, other pairs at the period's rate. The 1,000 pairs with the most volume of 2,140.",
    );
    // the pairs served, not the rows a Quote filter leaves
    expect(pageOf(thousand, { params: { quote: "eur" }, totals: { pairs: 2140 } }).footnote.left).toMatch(/ The 1,000 pairs with the most volume of 2,140\.$/);
    // all the pairs that qualify are served: nothing to add
    expect(pageOf(thousand.slice(0, 3)).footnote.left).not.toContain("most volume");
  });
});

// ---- Links, labels, text ----------------------------------------------------------------------------------------------------------

describe("marketsPage: links and text", () => {
  it("gives a row with a lower-case standard code no link, because the data API cannot be asked for it", () => {
    const row = pageOf([usdXrp({ base_currency: "usd" })]).rows[0]!;
    expect(row.href).toBeNull();
    // an unranked code is the base against XRP, which ranks
    expect(row.pair).toBe("usd / XRP");
  });

  it("gives an issued XRP on XRPL no link", () => {
    expect(pageOf([usdXrp({ counter_issuer: LIONS_ISSUER })]).rows[0]!.href).toBeNull();
  });

  it("links a text code and an LP token by their canonical text", () => {
    const lions = pageOf([usdXrp({ base_currency: LIONS_HEX, base_issuer: LIONS_ISSUER })]).rows[0]!;
    expect(lions.pair).toBe("LIONS / XRP");
    expect(lions.href).toBe(`/xrpl/markets/LIONS.${LIONS_ISSUER}/XRP`);
  });

  it("describes the sparkline with its first and last close and the change between them, to one decimal, half up", () => {
    expect(pageOf([eurUsd({ sparkline: days(["2.38", null, null, null, null, null, "2.44"]) })]).rows[0]!.spark.label).toBe(
      "7-day price, from 2.38 to 2.44 (today so far), +2.5%",
    );
    expect(pageOf([eurUsd({ sparkline: days(["2.44", "2.1", "2.2", "2.3", "2.3", "2.35", "2.38"]) })]).rows[0]!.spark.label).toBe(
      "7-day price, from 2.44 to 2.38 (today so far), \u22122.5%",
    );
    // +2.25% rounds half up to +2.3%
    expect(pageOf([eurUsd({ sparkline: days(["100", "100", "100", "100", "100", "100", "102.25"]) })]).rows[0]!.spark.label).toBe(
      "7-day price, from 100 to 102.25 (today so far), +2.3%",
    );
  });

  it("marks the running day only when the last close is that day's (the last day of the sparkline)", () => {
    // the newest close is from an earlier day: nothing is said about today
    expect(pageOf([eurUsd({ sparkline: days(["2.38", "2.4", null, null, null, null, null]) })]).rows[0]!.spark.label).toBe("7-day price, from 2.38 to 2.4, +0.8%");
  });

  it("says there were no trades when no day has a close", () => {
    const row = pageOf([eurUsd({ sparkline: days([null, null, null, null, null, null, null]) })]).rows[0]!;
    expect(row.spark.label).toBe("No trades in the last 7 days");
    expect(row.spark.closes).toEqual([null, null, null, null, null, null, null]);
  });

  it("passes the closes of a stored row on as plain numbers, a missing one missing", () => {
    expect(pageOf([eurUsd({ sparkline: days([null, "1.0700", "1.0000000e-7", null, "1.2345679e+8", null, "1.0850"]) })]).rows[0]!.spark.closes).toEqual([
      null,
      "1.0700",
      "0.0000001",
      null,
      "123456790",
      null,
      "1.0850",
    ]);
  });

  it("has a token that changes with the closes", () => {
    const [a, b] = [pageOf([eurUsd()]).rows[0]!.spark.token, pageOf([eurUsd({ sparkline: days(["1", "2", "3", "4", "5", "6", "7"]) })]).rows[0]!.spark.token];
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(pageOf([eurUsd()]).rows[0]!.spark.token).toBe(a);
  });

  it("holds what the text filter matches, in lower case: the pair, the raw codes and the issuers", () => {
    const search = pageOf([rlusdXrp()]).rows[0]!.search;
    expect(search).toBe(search.toLowerCase());
    expect(search).toContain("xrp/rlusd");
    expect(search).toContain(RLUSD_HEX.toLowerCase());
    expect(search).toContain(RL.toLowerCase());
    const usd = pageOf([usdXrp()]).rows[0]!.search;
    expect(usd).toContain("xrp/usd");
    expect(usd).toContain(GH.toLowerCase());
  });

  it("gives every row its own key, even for two codes that differ only in case", () => {
    const keys = pageOf([usdXrp(), usdXrp({ base_currency: "usd" }), eurUsd(), rlusdXrp()]).rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(4);
  });

  it("groups the trade count and compacts the volume, with a dash for no volume", () => {
    const row = pageOf([usdXrp({ count: 1234567, native_volume: "12345678.9" })]).rows[0]!;
    expect(row.trades).toBe("1,234,567");
    expect(row.volume).toBe("12.3M");
    expect(pageOf([usdXrp({ native_volume: undefined })]).rows[0]!.volume).toBe("—");
  });

  it("names the route that serves the table in the source line", () => {
    expect(pageOf([usdXrp()]).source).toBe("/v2/network/markets?period=day");
    expect(pageOf([usdXrp()], { params: { period: "7d" } }).source).toBe("/v2/network/markets?period=7day");
    expect(pageOf([usdXrp()], { params: { period: "30d" } }).source).toBe("/v2/network/markets?period=30day");
    expect(pageOf([usdXrp()], { params: { trades: "amm" }, over: { amm: "only" }, totals: { amm_share: "0.3400" } }).source).toBe(
      "/v2/network/markets?period=day&amm=only",
    );
    expect(pageOf([usdXrp()], { params: { trades: "book" }, over: { amm: "exclude" }, totals: { amm_share: "0.3400" } }).source).toBe(
      "/v2/network/markets?period=day&amm=exclude",
    );
  });

  it("names the view, and is indexable only in the default view", () => {
    expect(pageOf([usdXrp()])).toMatchObject({ view: [], indexable: true });
    expect(pageOf([usdXrp()], { params: { period: "7d", quote: "usd", trades: "amm" }, over: { amm: "only" }, totals: { amm_share: "0.3400" } })).toMatchObject({
      view: ["last 7 days", "USD", "AMM swaps"],
      indexable: false,
    });
    expect(pageOf([usdXrp()], { params: { trades: "book" }, over: { amm: "exclude" }, totals: { amm_share: "0.3400" } }).view).toEqual(["order-book trades"]);
    expect(pageOf([usdXrp()], { params: { quote: "eur" } })).toMatchObject({ view: ["EUR"], indexable: false });
    expect(pageOf([usdXrp()], { params: { period: "30d" } })).toMatchObject({ view: ["last 30 days"], indexable: false });
  });

  it("says the view's period in words, the default's too (the description of the page's tags)", () => {
    expect(pageOf([usdXrp()]).periodWords).toBe("last 24 hours");
    expect(pageOf([usdXrp()], { params: { period: "7d", quote: "usd" } }).periodWords).toBe("last 7 days");
    expect(pageOf([usdXrp()], { params: { period: "30d" } }).periodWords).toBe("last 30 days");
    // An empty set has a period too.
    expect(pageOf([], { params: { period: "7d" } }).periodWords).toBe("last 7 days");
  });

  it("keeps the API's order of the rows", () => {
    const rows = pageOf([eurUsd({ count: 1 }), usdXrp({ count: 2 }), rlusdXrp({ count: 3 })]).rows;
    expect(rows.map((row) => row.trades)).toEqual(["1", "2", "3"]);
  });

  it("writes no exponent and no float artefact in any number of the page", () => {
    const exotic = [
      rlusdXrp({ last: "3.0000000e+95", low: "1.0000000e-7", high: "1.2345679e+8", open: "7", native_volume: "1.5e+21", sparkline: days([null, "1e-7", "3", "7", null, "0.3", "0.7"]) }),
      eurUsd({ last: "1.0000000e-7", native_volume: "2.5e-7", sparkline: days(["1.0000000e-7", null, null, null, null, null, "1.2345679e+8"]) }),
      usdXrp({ amm_share: "0.1234", amm_pool: true }),
    ];
    const data = pageOf(exotic, { totals: { amm_share: "0.3400", native_volume: "1.5e+21" } });
    const texts = numericTexts(data);
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) expect(text, text).not.toMatch(EXPONENT);
    for (const row of data.rows) {
      for (const price of [row.last, ...row.spark.closes.filter((close) => close !== null)]) {
        if (price !== "—") expect(significantDigits(price), price).toBeLessThanOrEqual(8);
      }
    }
  });
});
