// The data API's aggregates of trades, by the reference's rules, for the markets pages' fixtures (market-fixtures.ts writes the files): a pair's trades a
// page at a time, its candles, its 24-hour row and its active accounts, and a set of the markets table. Pure: trades in, the API's answers out.
//
// The rules (data-api-new; the commits are in test/fixtures/PROVENANCE.md, read with `git show`, never imported):
//
//   apps/api/src/exchanges/exchange-aggregate.ts   candles and `reduce`: open and close the first and last trade by (ledger_index, tx_index, node_index),
//                                                   high and low by rate (the first by key of equal ones), exact sums written by BigNumber's `toString()`,
//                                                   vwap counter over base (0 without a base volume), `buy_volume` the base the taker bought; inverted,
//                                                   the rates are 1/rate (so high is 1/low) and the volumes swap
//   apps/api/src/exchanges/exchange-intervals.ts   the buckets: the clock's for minutes and hours, UTC days, weeks from Monday (`candleWindow`'s)
//   apps/api/src/exchanges/exchanges.service.ts    the native leg of a trade in an aggregate is above 0.0005; a page's marker the base64url of the
//                                                   JSON key of its last row (`[ledger_index, tx_index, node_index]`, a candle's `[bucket]`)
//   apps/api/src/active-accounts/*                 the trades of the day before now, dust included, each counted for its seller and its buyer, sorted
//                                                   by base volume (equal ones in the order the walk met them)
//   packages/shared/src/aggregate/markets-live.job.ts, apps/api/src/network/markets-object.ts
//                                                   the markets table: the window from the hour a period before T to T, `count >= min_trades` (10)
//                                                   listed, sorted by native volume and then the pair (the pairs without one last, by count and then the
//                                                   pair), the native volume and the rate of an asset, the 7 daily closes, `change` of the exact rates
//   docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md, D2b.1
//                                                   the AMM fields: `amm_share` (the AMM part of the pair's base volume, all trades of the window, 4
//                                                   decimals, the same in every filter's set), `amm_pool`, `totals.amm_share` (Σ native × share ÷
//                                                   Σ native over the set's pairs, of the exact shares, rounded once); `"0.0000"` and `false` on Xahau;
//                                                   `amm` echoed after `period` by a filtered answer
//
// A derived trade's rate is known to its first 8 significant digits only (`rate`): that is all a candle, a reduced row, a market's prices and its closes
// show, and the order of 8-digit rates is the order of the rates. `change` is of the exact rates: for a derived pair it is worked out at both ends of what
// the 8 digits leave open, and it throws if the two disagree (they agree for every recorded pair). The sums are exact (BigInt): an amount must fit the
// reference's exact sums (at most 30 decimal places, below 1e36), or it throws rather than fall back to the floats the API would.

import BigNumber from "bignumber.js";

import type { Asset } from "../app/domain/asset";
import { candleWindow, type Interval } from "../app/domain/market-params";
import type { ActiveAccount, ActiveAccounts, ActiveAccountSide, AmmFilter, Candle, MarketRow, MarketsResponse, Page, PairExchange, ReducedRow } from "../app/server/api-types";
import type { NetworkName } from "../test/support/upstream-core";
import { isoTime } from "./http-fixtures";

// ---- Numbers ---------------------------------------------------------------------------------------------------------

/** BigNumber as the data API has it: 20 decimal places, half up, the exponent form from 1e21 and below 1e-6. */
export const Api = BigNumber.clone({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP, EXPONENTIAL_AT: [-7, 20] });
/** The room of a quotient of rates (`ratio` of the shared package): 200 decimal places. */
export const Wide = BigNumber.clone({ DECIMAL_PLACES: 200, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
/** `change`: the quotient rounded once, half up, to the 2 decimals it is shown with. */
const Percent = BigNumber.clone({ DECIMAL_PLACES: 2, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

const ratio = (a: BigNumber.Value, b: BigNumber.Value): BigNumber => new Api(new Wide(a).dividedBy(b));
/** A rate, a price or a vwap as the API writes it: 8 significant digits (`precision8`). */
const precision8 = (value: BigNumber.Value): string => new Api(value).toPrecision(8);
const ZERO_PRICE = precision8(0);
/** The significant digits of a native volume worked out by a rate (`QUOTIENT_DIGITS`). */
const QUOTIENT_DIGITS = 17;

/** An exact decimal: `units` of 10^-`scale`. The sums of the aggregates are made of these, as the reference's `Decimal256(30)` sums are exact. */
export interface Exact {
  units: bigint;
  scale: number;
}
export const NOTHING: Exact = { units: 0n, scale: 0 };
const PLAIN = /^(\d+)(?:\.(\d+))?$/;

/** An amount of a trade as an exact decimal. The reference sums it exactly only below 1e36 and to 30 decimal places; this generator has no other sum. */
export function exactOf(text: string): Exact {
  const match = PLAIN.exec(text);
  if (!match) throw new Error(`${text}: not a plain decimal amount`);
  const [, whole, fraction = ""] = match as unknown as [string, string, string | undefined];
  if (fraction.length > 30 || whole.replace(/^0+/, "").length > 36) throw new Error(`${text}: an amount the exact sums of the data API cannot hold`);
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

export function plus(a: Exact, b: Exact): Exact {
  if (a.scale === b.scale) return { units: a.units + b.units, scale: a.scale };
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}

/** The plain decimal text of an exact decimal, without trailing zeros. */
export function plainText({ units, scale }: Exact): string {
  const digits = units.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** A sum as the API writes it: BigNumber's `toString()` (the exponent form from 1e21 and below 1e-6). */
export const sumText = (value: Exact): string => new Api(plainText(value)).toString();
const isPositive = (value: Exact): boolean => value.units > 0n;

// ---- Trades ----------------------------------------------------------------------------------------------------------

/** A trade as the aggregates read it, in one orientation of its pair. */
export interface Fill {
  /** `(ledger_index, tx_index, node_index)`: the order of the trades. */
  key: readonly [number, number, number];
  /** The close time of its ledger, unix seconds. */
  time: number;
  /** As served in this orientation: 8 significant digits. */
  rate: string;
  /** `rate` as a number, for the order of rates (two 8-digit decimals are two doubles in the same order). */
  value: number;
  base: Exact;
  counter: Exact;
  /** A swap against an AMM pool. */
  amm: boolean;
  /** Its native leg, if it has one, is above 0.0005: the aggregates count it. */
  kept: boolean;
  /** The taker bought the base (`buyer` is the taker). */
  bought: boolean;
  /** `rate` is the stored rate itself (a synthetic trade), not its first 8 digits (a derived one). */
  exact: boolean;
}

const DUST = new Api("0.0005");
const isNative = (asset: Asset, native: string): boolean => asset.issuer === undefined && asset.currency === native;
export const baseOf = (row: PairExchange): Asset => sideOf(row.base_currency, row.base_issuer);
export const counterOf = (row: PairExchange): Asset => sideOf(row.counter_currency, row.counter_issuer);
export function sideOf(currency: string, issuer: string | undefined): Asset {
  return issuer === undefined ? { currency } : { currency, issuer };
}

/** A trade of a list as the aggregates read it. `exact`: its rate is the stored one (synthetic), else its 8 digits (derived). */
export function fillOf(row: PairExchange, native: string, exact: boolean): Fill {
  const dust = (isNative(baseOf(row), native) && new Api(row.base_amount).lte(DUST)) || (isNative(counterOf(row), native) && new Api(row.counter_amount).lte(DUST));
  return {
    key: [row.ledger_index, row.tx_index, row.node_index],
    time: Date.parse(row.executed_time) / 1000,
    rate: row.rate,
    value: Number(row.rate),
    base: exactOf(row.base_amount),
    counter: exactOf(row.counter_amount),
    amm: row.amm_account !== undefined,
    kept: !dust,
    bought: row.buyer === row.taker,
    exact,
  };
}

export const compareKey = (a: readonly number[], b: readonly number[]): number => {
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return a[at]! - b[at]!;
  return 0;
};
export const byKey = (a: { key: readonly number[] }, b: { key: readonly number[] }): number => compareKey(a.key, b.key);
export const rowKey = (row: PairExchange): [number, number, number] => [row.ledger_index, row.tx_index, row.node_index];
/** The marker of a page: the base64url of the JSON of the key of its last row (`encodeMarker` of the reference). */
const markerOf = (values: readonly number[]): string => Buffer.from(JSON.stringify(values)).toString("base64url");

/** A Trades filter as the API reads `amm`, or none (`include`, the default). */
export type Filter = AmmFilter | undefined;
/** A swap against an AMM pool: a fill's flag, a row's `amm_account`. */
const isSwap = (trade: Fill | PairExchange): boolean => ("amm" in trade ? trade.amm : trade.amm_account !== undefined);
/** Whether the filter keeps a trade: none keeps every one, `exclude` the order book's, `only` the swaps. */
export const takes =
  (filter: Filter) =>
  (trade: Fill | PairExchange): boolean =>
    filter === undefined || (filter === "only") === isSwap(trade);

/** What the aggregates of the reference make of trades, oldest first: the count, the exact sums, and the trades of the four prices. */
interface Figures {
  count: number;
  base: Exact;
  counter: Exact;
  bought: Exact;
  open: Fill;
  close: Fill;
  high: Fill;
  low: Fill;
}

function figuresOf(fills: readonly Fill[]): Figures {
  const first = fills[0];
  if (first === undefined) throw new Error("figures of no trade");
  let [base, counter, bought] = [NOTHING, NOTHING, NOTHING];
  let [high, low] = [first, first];
  for (const fill of fills) {
    base = plus(base, fill.base);
    counter = plus(counter, fill.counter);
    if (fill.bought) bought = plus(bought, fill.base);
    // The first by key of equal rates.
    if (fill.value > high.value) high = fill;
    if (fill.value < low.value) low = fill;
  }
  return { count: fills.length, base, counter, bought, open: first, close: fills.at(-1)!, high, low };
}

/** Counter volume over base volume, 8 digits; 0 without a base volume (never a division by 0). */
const vwapOf = (f: Figures): string => (isPositive(f.base) ? precision8(ratio(plainText(f.counter), plainText(f.base))) : ZERO_PRICE);

// ---- A pair's answers: trades, candles, the 24-hour row, active accounts ----------------------------------------------

/** The pair fields of an aggregate: the pair as asked for, the native currency without an issuer key. */
export function pairFields(base: Asset, counter: Asset): Pick<Candle, "base_currency" | "base_issuer" | "counter_currency" | "counter_issuer"> {
  return {
    base_currency: base.currency,
    ...(base.issuer !== undefined && { base_issuer: base.issuer }),
    counter_currency: counter.currency,
    ...(counter.issuer !== undefined && { counter_issuer: counter.issuer }),
  };
}

/** The pages of a list asked newest first, `limit` to a page: the marker each is reached by (none for the first), and the page. */
export function listPages(rows: readonly PairExchange[], limit: number): Array<{ marker?: string; page: Page<"exchanges", PairExchange> }> {
  const newest = [...rows].sort((a, b) => compareKey(rowKey(b), rowKey(a)));
  const pages: Array<{ marker?: string; page: Page<"exchanges", PairExchange> }> = [];
  let marker: string | undefined;
  for (let at = 0; at === 0 || at < newest.length; at += limit) {
    const exchanges = newest.slice(at, at + limit);
    const next = at + limit < newest.length ? markerOf(rowKey(exchanges.at(-1)!)) : undefined;
    pages.push({ ...(marker !== undefined && { marker }), page: { result: "success", count: exchanges.length, ...(next !== undefined && { marker: next }), exchanges } });
    marker = next;
  }
  return pages;
}

/** The candles of the buckets that start at `start` or later (the newest bucket whole: up to the newest trade), oldest first, `limit` to a page. */
export function candlesOf(fills: readonly Fill[], interval: Interval, start: string, base: Asset, counter: Asset, limit: number): Page<"exchanges", Candle> {
  const from = Date.parse(start) / 1000;
  // The buckets are of one length from the first (`candleWindow`'s, the reference's): a trade at or after it is in the one that starts a whole number of them later.
  const [before, at] = candleWindow(from, interval).buckets.slice(-2).map((bucket) => Date.parse(bucket) / 1000) as [number, number];
  const size = at - before;
  const buckets = new Map<string, Fill[]>();
  for (const fill of fills) {
    if (!fill.kept || fill.time < from) continue;
    const bucket = isoTime(from + Math.floor((fill.time - from) / size) * size);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), fill]);
  }
  const all = [...buckets].sort(([a], [b]) => (a < b ? -1 : 1));
  const shown = all.slice(0, limit);
  const exchanges = shown.map(([bucket, own]): Candle => {
    const f = figuresOf(own);
    return {
      base_volume: sumText(f.base),
      buy_volume: Number(sumText(f.bought)),
      close: f.close.rate,
      close_time: isoTime(f.close.time),
      count: f.count,
      counter_volume: sumText(f.counter),
      high: f.high.rate,
      low: f.low.rate,
      open: f.open.rate,
      open_time: isoTime(f.open.time),
      start: bucket,
      vwap: vwapOf(f),
      ...pairFields(base, counter),
    };
  });
  const marker = all.length > limit ? markerOf([Date.parse(shown.at(-1)![0]) / 1000]) : undefined;
  return { result: "success", count: exchanges.length, ...(marker !== undefined && { marker }), exchanges };
}

/** The one row of `reduce=true` from `start` to the newest trade; the row of zeros, without its times, when there is none. */
export function reducedOf(fills: readonly Fill[], start: string, base: Asset, counter: Asset): Page<"exchanges", ReducedRow> {
  const from = Date.parse(start) / 1000;
  const own = fills.filter((fill) => fill.kept && fill.time >= from);
  const pair = pairFields(base, counter);
  let row: ReducedRow;
  if (own.length === 0) {
    row = { open: ZERO_PRICE, high: ZERO_PRICE, low: ZERO_PRICE, close: ZERO_PRICE, base_volume: "0", counter_volume: "0", buy_volume: 0, count: 0, vwap: ZERO_PRICE, start, ...pair };
  } else {
    const f = figuresOf(own);
    row = {
      open: f.open.rate,
      high: f.high.rate,
      low: f.low.rate,
      close: f.close.rate,
      base_volume: sumText(f.base),
      counter_volume: sumText(f.counter),
      buy_volume: Number(sumText(f.bought)),
      count: f.count,
      open_time: isoTime(f.open.time),
      close_time: isoTime(f.close.time),
      vwap: vwapOf(f),
      start,
      ...pair,
    };
  }
  return { result: "success", count: 1, exchanges: [row] };
}

/**
 * `active_accounts` without a date: the trades of the day before T, to the end of its second, dust and swaps included. Each trade is walked in key
 * order and counted for its seller, then its buyer (an account that trades with itself counts on both sides); the accounts are sorted by base volume,
 * the largest first, equal ones in the order the walk met them.
 */
export function activeAccountsOf(rows: readonly PairExchange[], now: number): ActiveAccounts {
  interface Side {
    count: number;
    base: Exact;
    counter: Exact;
  }
  interface Entry {
    account: string;
    buy?: Side;
    sell?: Side;
    met: number;
  }
  const entries = new Map<string, Entry>();
  const day = [...rows].sort((a, b) => compareKey(rowKey(a), rowKey(b))).filter((row) => {
    const time = Date.parse(row.executed_time) / 1000;
    return time >= now - 86_400 && time < now + 1;
  });
  for (const row of day) {
    for (const [account, role] of [[row.seller, "sell"], [row.buyer, "buy"]] as const) {
      const entry = entries.get(account) ?? { account, met: entries.size };
      const side = entry[role] ?? { count: 0, base: NOTHING, counter: NOTHING };
      entry[role] = { count: side.count + 1, base: plus(side.base, exactOf(row.base_amount)), counter: plus(side.counter, exactOf(row.counter_amount)) };
      entries.set(account, entry);
    }
  }
  const sideText = (side: Side | undefined): ActiveAccountSide =>
    side === undefined ? { base_volume: "0", counter_volume: "0", count: 0 } : { base_volume: sumText(side.base), counter_volume: sumText(side.counter), count: side.count };
  const totalOf = (entry: Entry, part: "base" | "counter"): Exact => plus(entry.buy?.[part] ?? NOTHING, entry.sell?.[part] ?? NOTHING);
  const accounts = [...entries.values()]
    .sort((a, b) => new Api(plainText(totalOf(b, "base"))).comparedTo(plainText(totalOf(a, "base")))! || a.met - b.met)
    .map(
      (entry): ActiveAccount => ({
        buy: sideText(entry.buy),
        sell: sideText(entry.sell),
        account: entry.account,
        base_volume: sumText(totalOf(entry, "base")),
        counter_volume: sumText(totalOf(entry, "counter")),
        count: (entry.buy?.count ?? 0) + (entry.sell?.count ?? 0),
      }),
    );
  return { result: "success", count: accounts.length, exchanges_count: day.length, accounts };
}

// ---- The markets table -----------------------------------------------------------------------------------------------

export type MarketsPeriod = "day" | "7day" | "30day";
export const PERIOD_HOURS: Record<MarketsPeriod, number> = { day: 24, "7day": 168, "30day": 720 };
/** `min_trades` and `limit` of the call (the reference's default and the explorer's `limit`). */
const MIN_TRADES = 10;
export const MARKETS_LIMIT = 1000;
const SPARKLINE_DAYS = 7;
export const HOUR = 3600;
export const DAY = 86_400;

/** A pair of the markets table: in its stored order, its trades oldest first (stored orientation), and whether it has a pool. */
export interface MarketPair {
  base: Asset;
  counter: Asset;
  fills: Fill[];
  pool: boolean;
}

export const assetKey = (asset: Asset): string => `${asset.currency}+${asset.issuer ?? ""}`;
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The order of the pair key of the table: base currency, base issuer, counter currency, counter issuer (`''` for the native currency). */
const byPair = (a: MarketPair, b: MarketPair): number =>
  compareText(a.base.currency, b.base.currency) ||
  compareText(a.base.issuer ?? "", b.base.issuer ?? "") ||
  compareText(a.counter.currency, b.counter.currency) ||
  compareText(a.counter.issuer ?? "", b.counter.issuer ?? "");

/** The half unit of the 8th significant digit of an 8-digit rate: the stored rate is within it. */
function halfUlp(rate: string): BigNumber {
  const value = new Wide(rate);
  const exponent = value.e ?? 0;
  return new Wide(10).pow(exponent - 7).dividedBy(2);
}

/** `(last / open - 1) * 100`, rounded once, half up, to 2 decimals (`changePercent`). */
const changeOf = (open: BigNumber.Value, last: BigNumber.Value): string =>
  new Percent(last).minus(open).times(100).dividedBy(open).toFixed(2);

/**
 * The change of a pair from its first and last trade, of their exact rates. A derived trade's rate is known to 8 digits: the change is worked out at the
 * two ends of what they leave open (it grows with `last` and shrinks with `open`), and the generator stops if the ends round apart.
 */
function changeOfFills(open: Fill, last: Fill): string {
  if (open.exact && last.exact) return changeOf(open.rate, last.rate);
  const spread = (fill: Fill) => (fill.exact ? new Wide(0) : halfUlp(fill.rate));
  const [lowest, highest] = [
    changeOf(new Wide(open.rate).plus(spread(open)), new Wide(last.rate).minus(spread(last))),
    changeOf(new Wide(open.rate).minus(spread(open)), new Wide(last.rate).plus(spread(last))),
  ];
  if (lowest !== highest) throw new Error(`the change from ${open.rate} to ${last.rate} is ${lowest} or ${highest}: the 8 digits of the rates cannot tell`);
  return lowest;
}

/** A share as D2b.1 writes it: exactly 4 decimals, half up. */
const shareText = (share: BigNumber): string => share.toFixed(4, BigNumber.ROUND_HALF_UP);

/**
 * The answer of `GET /v2/network/markets?limit=1000&period=…[&amm=…]` at T: one set of the reference's markets job and the route's answer of it. A trade
 * counts when its native leg is above 0.0005. `amm`: the filter asked for, echoed after `period`; the rates of the assets and the AMM shares are of all
 * the trades of the window, whatever the filter.
 */
export function marketsAnswer(net: NetworkName, native: string, pairs: readonly MarketPair[], period: MarketsPeriod, amm: Filter, now: number): MarketsResponse {
  const hour = Math.floor(now / HOUR) * HOUR;
  const start = hour - PERIOD_HOURS[period] * HOUR;
  const sparkStart = Math.floor(hour / DAY) * DAY - (SPARKLINE_DAYS - 1) * DAY;
  const days = Array.from({ length: SPARKLINE_DAYS }, (_, at) => sparkStart + at * DAY);
  const inWindow = (fill: Fill) => fill.kept && fill.time >= start && fill.time <= now;
  const sumOf = (fills: readonly Fill[], part: "base" | "counter") => fills.reduce((total, fill) => plus(total, fill[part]), NOTHING);

  // The rate of each asset that traded against the native currency: units of it a native coin buys, over all the trades of the window.
  const rates = new Map<string, BigNumber>();
  for (const pair of pairs) {
    const all = pair.fills.filter(inWindow);
    if (all.length === 0) continue;
    const [base, counter] = [sumOf(all, "base"), sumOf(all, "counter")];
    if (isNative(pair.counter, native) && isPositive(counter)) rates.set(assetKey(pair.base), ratio(plainText(base), plainText(counter)));
    else if (isNative(pair.base, native) && isPositive(base)) rates.set(assetKey(pair.counter), ratio(plainText(counter), plainText(base)));
  }

  interface Made {
    pair: MarketPair;
    count: number;
    native: BigNumber | undefined;
    share: BigNumber;
    row: MarketRow;
  }
  const made: Made[] = [];
  for (const pair of pairs) {
    const all = pair.fills.filter(inWindow);
    const own = all.filter(takes(amm));
    if (own.length === 0) continue;
    const f = figuresOf(own);
    const [base, counter] = [plainText(f.base), plainText(f.counter)];

    let nativeVolume: BigNumber | undefined;
    if (isNative(pair.counter, native)) nativeVolume = new Api(counter);
    else if (isNative(pair.base, native)) nativeVolume = new Api(base);
    else {
      const baseRate = rates.get(assetKey(pair.base));
      const counterRate = rates.get(assetKey(pair.counter));
      if (baseRate?.gt(0)) nativeVolume = ratio(base, baseRate).precision(QUOTIENT_DIGITS);
      else if (counterRate?.gt(0)) nativeVolume = ratio(counter, counterRate).precision(QUOTIENT_DIGITS);
    }

    // The closes of the 7 days: the last trade's rate of each day, a day without one carrying the close before it.
    const closes = new Map<number, string>();
    for (const fill of pair.fills) {
      if (fill.kept && takes(amm)(fill) && fill.time >= sparkStart && fill.time <= now) closes.set(Math.floor(fill.time / DAY) * DAY, fill.rate);
    }
    let carried: string | undefined;
    const sparkline = days.map((day) => {
      carried = closes.get(day) ?? carried;
      return { date: isoTime(day), ...(carried !== undefined && { close: carried }) };
    });

    const allBase = sumOf(all, "base");
    const share = isPositive(allBase) ? new Wide(plainText(sumOf(all.filter((fill) => fill.amm), "base"))).dividedBy(plainText(allBase)) : new Wide(0);
    const xahau = net === "xahau";
    const row: MarketRow = {
      ...pairFields(pair.base, pair.counter),
      count: f.count,
      base_volume: sumText(f.base),
      counter_volume: sumText(f.counter),
      ...(nativeVolume !== undefined && { native_volume: nativeVolume.toString() }),
      open: precision8(f.open.rate),
      high: precision8(f.high.rate),
      low: precision8(f.low.rate),
      last: precision8(f.close.rate),
      change: changeOfFills(f.open, f.close),
      open_time: isoTime(f.open.time),
      last_time: isoTime(f.close.time),
      amm_share: xahau ? "0.0000" : shareText(share),
      amm_pool: xahau ? false : pair.pool,
      sparkline,
    };
    made.push({ pair, count: f.count, native: nativeVolume, share, row });
  }

  // Listed: 10 trades or more. The pairs with a native volume first, by it, the largest first, then by the pair (`marketsAnswer` of the reference); the
  // pairs without one last, by count, the largest first, then by the pair.
  const listed = made
    .filter((m) => m.count >= MIN_TRADES)
    .sort((a, b) => {
      if (a.native && b.native) return b.native.comparedTo(a.native)! || byPair(a.pair, b.pair);
      if (a.native || b.native) return a.native ? -1 : 1;
      return b.count - a.count || byPair(a.pair, b.pair);
    });
  const markets = listed.slice(0, MARKETS_LIMIT).map((m) => m.row);

  const withNative = made.filter((m) => m.native !== undefined);
  const totalNative = withNative.reduce((total, m) => total.plus(m.native!), new Api(0));
  const weighted = withNative.reduce((total, m) => total.plus(new Wide(m.native!).times(m.share)), new Wide(0));
  return {
    result: "success",
    period,
    ...(amm !== undefined && { amm }),
    start_time: isoTime(start),
    end_time: isoTime(now),
    totals: {
      pairs: listed.length,
      pairs_traded: made.length,
      count: made.reduce((total, m) => total + m.count, 0),
      native_volume: totalNative.toString(),
      amm_share: net === "xahau" || totalNative.isZero() ? "0.0000" : shareText(weighted.dividedBy(totalNative)),
    },
    count: markets.length,
    markets,
  };
}
