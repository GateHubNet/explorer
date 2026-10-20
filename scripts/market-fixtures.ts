// The data API's answers for the markets pages (E3): for each pair the pages show, its trades (a page at a time, newest first), its candles of the five
// intervals, its 24-hour row and its active accounts (the data API calls of spec 3.3 for the default view); and for each network the markets table
// (`/v2/network/markets`) of the three periods. http-fixtures.ts calls `marketFixtures` from `generate()`, so `pnpm fixtures:sync` writes the files, and
// test/fixtures/PROVENANCE.md ("Synthetic aggregates", "Derived trades and pool states") says what they are made of and follow.
//
// Two kinds of trades go in, and every figure is made of them by one set of rules, the reference's:
//
//   derived     the XRPL trades worked out from the recorded ledgers (`derivedExchanges`, scripts/derived-trades.ts): XRP/RLUSD and LIONS/XRP in both
//               orientations (the other one by `invertedExchange`, which inverts the rate the trade stored), and every recorded pair in the markets table
//   synthetic   drawn from `mulberry32(seedOf(net, endpoint))` (scripts/synthetic.ts): the trades of Xahau's EVR/XAH (`exchanges/EVR+r…/XAH`), and the
//               seeded pairs of the markets tables (`network/markets`), with issuers that ripple-address-codec encodes from seeded bytes
//
// The rules (data-api-new; the commits are in PROVENANCE.md, read with `git show`, never imported):
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
//                                                   listed, sorted by native volume (the pairs without one last by count, then the pair), the native
//                                                   volume and the rate of an asset, the 7 daily closes, `change` of the exact rates, 2 decimals
//   docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md, D2b.1
//                                                   the AMM fields: `amm_share` (the AMM part of the pair's base volume, all trades of the window, 4
//                                                   decimals, the same in every filter's set), `amm_pool`, `totals.amm_share` (Σ native × share ÷
//                                                   Σ native over the set's pairs, of the exact shares, rounded once); `"0.0000"` and `false` on Xahau;
//                                                   `amm` echoed after `period` by a filtered answer
//
// A derived trade's rate is known to its first 8 significant digits only (`rate`): that is all a candle, a reduced row, a market's prices and its closes
// show, and the order of 8-digit rates is the order of the rates. `change` is of the exact rates: for a derived pair it is worked out at both ends of what
// the 8 digits leave open, and the generator throws if the two disagree (they agree for every recorded pair). The sums are exact (BigInt): an amount must
// fit the reference's exact sums (at most 30 decimal places, below 1e36), or the generator throws rather than fall back to the floats the API would.
//
// Only integer arithmetic and the four operations of IEEE doubles go into the draws (synthetic.ts), so every Node writes the same bytes.

import BigNumber from "bignumber.js";
import { encodeAccountID } from "ripple-address-codec";

import { apiAssetText, canonicalPair, sameAsset, type Asset, type NativeCode } from "../app/domain/asset";
import { candleWindow, dayWindowStart, INTERVALS, type Interval } from "../app/domain/market-params";
import type { ActiveAccount, ActiveAccounts, ActiveAccountSide, AmmFilter, Candle, MarketRow, MarketsResponse, Page, PairExchange, ReducedRow } from "../app/server/api-types";
import { dataApiFile, type NetworkName } from "../test/support/upstream-core";
import { derivedExchanges, invertedExchange } from "./derived-trades";
import { fixtureText, isoTime, readLedgers, unixOf } from "./http-fixtures";
import { mulberry32, seedOf } from "./synthetic";

// ---- Numbers ---------------------------------------------------------------------------------------------------------

/** BigNumber as the data API has it: 20 decimal places, half up, the exponent form from 1e21 and below 1e-6. */
const Api = BigNumber.clone({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP, EXPONENTIAL_AT: [-7, 20] });
/** The room of a quotient of rates (`ratio` of the shared package): 200 decimal places. */
const Wide = BigNumber.clone({ DECIMAL_PLACES: 200, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
/** `change`: the quotient rounded once, half up, to the 2 decimals it is shown with. */
const Percent = BigNumber.clone({ DECIMAL_PLACES: 2, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

const ratio = (a: BigNumber.Value, b: BigNumber.Value): BigNumber => new Api(new Wide(a).dividedBy(b));
/** A rate, a price or a vwap as the API writes it: 8 significant digits (`precision8`). */
const precision8 = (value: BigNumber.Value): string => new Api(value).toPrecision(8);
const ZERO_PRICE = precision8(0);
/** The significant digits of a native volume worked out by a rate (`QUOTIENT_DIGITS`). */
const QUOTIENT_DIGITS = 17;

/** An exact decimal: `units` of 10^-`scale`. The sums of the aggregates are made of these, as the reference's `Decimal256(30)` sums are exact. */
interface Exact {
  units: bigint;
  scale: number;
}
const NOTHING: Exact = { units: 0n, scale: 0 };
const PLAIN = /^(\d+)(?:\.(\d+))?$/;

/** An amount of a trade as an exact decimal. The reference sums it exactly only below 1e36 and to 30 decimal places; this generator has no other sum. */
function exactOf(text: string): Exact {
  const match = PLAIN.exec(text);
  if (!match) throw new Error(`${text}: not a plain decimal amount`);
  const [, whole, fraction = ""] = match as unknown as [string, string, string | undefined];
  if (fraction.length > 30 || whole.replace(/^0+/, "").length > 36) throw new Error(`${text}: an amount the exact sums of the data API cannot hold`);
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function plus(a: Exact, b: Exact): Exact {
  if (a.scale === b.scale) return { units: a.units + b.units, scale: a.scale };
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}

/** The plain decimal text of an exact decimal, without trailing zeros. */
function plainText({ units, scale }: Exact): string {
  const digits = units.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** A sum as the API writes it: BigNumber's `toString()` (the exponent form from 1e21 and below 1e-6). */
const sumText = (value: Exact): string => new Api(plainText(value)).toString();
const isPositive = (value: Exact): boolean => value.units > 0n;

// ---- Trades ----------------------------------------------------------------------------------------------------------

/** A trade as the aggregates read it, in one orientation of its pair. */
interface Fill {
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
const baseOf = (row: PairExchange): Asset => sideOf(row.base_currency, row.base_issuer);
const counterOf = (row: PairExchange): Asset => sideOf(row.counter_currency, row.counter_issuer);
function sideOf(currency: string, issuer: string | undefined): Asset {
  return issuer === undefined ? { currency } : { currency, issuer };
}

/** A trade of a list as the aggregates read it. `exact`: its rate is the stored one (synthetic), else its 8 digits (derived). */
function fillOf(row: PairExchange, native: string, exact: boolean): Fill {
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

const compareKey = (a: readonly number[], b: readonly number[]): number => {
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return a[at]! - b[at]!;
  return 0;
};
const byKey = (a: { key: readonly number[] }, b: { key: readonly number[] }): number => compareKey(a.key, b.key);
const rowKey = (row: PairExchange): [number, number, number] => [row.ledger_index, row.tx_index, row.node_index];
/** The marker of a page: the base64url of the JSON of the key of its last row (`encodeMarker` of the reference). */
const markerOf = (values: readonly number[]): string => Buffer.from(JSON.stringify(values)).toString("base64url");

type Filter = AmmFilter | undefined;
const takes = (filter: Filter) => (fill: Fill) => filter === undefined || (filter === "only") === fill.amm;

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

// ---- A pair's files: trades, candles, the 24-hour row, active accounts ------------------------------------------------

/** The pair fields of an aggregate: the pair as asked for, the native currency without an issuer key. */
function pairFields(base: Asset, counter: Asset): Pick<Candle, "base_currency" | "base_issuer" | "counter_currency" | "counter_issuer"> {
  return {
    base_currency: base.currency,
    ...(base.issuer !== undefined && { base_issuer: base.issuer }),
    counter_currency: counter.currency,
    ...(counter.issuer !== undefined && { counter_issuer: counter.issuer }),
  };
}

/** The pages of a list asked newest first, `limit` to a page: the marker each is reached by (none for the first), and the page. */
function listPages(rows: readonly PairExchange[], limit: number): Array<{ marker?: string; page: Page<"exchanges", PairExchange> }> {
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
function candlesOf(fills: readonly Fill[], interval: Interval, start: string, base: Asset, counter: Asset, limit: number): Page<"exchanges", Candle> {
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
function reducedOf(fills: readonly Fill[], start: string, base: Asset, counter: Asset): Page<"exchanges", ReducedRow> {
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
function activeAccountsOf(rows: readonly PairExchange[], now: number): ActiveAccounts {
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

/** What the pair page asks of one orientation of a pair (spec 3.3), beyond the calls without a filter. */
interface PairCalls {
  /** The Trades filters whose lists and candles are asked for. */
  filters: AmmFilter[];
  /** The filters of the 24-hour row (#9 is `only`, the AMM share of the volume). */
  reduces: AmmFilter[];
  /** #10, the one-row probe of whether the pair has any trade. */
  probe: boolean;
}

interface FileOut {
  path: string;
  query: string;
  value: unknown;
  rowLists: readonly string[];
}

/** The rows of a pair's files that are one line each: the trades, the candles and the reduced row, the accounts. */
const PAIR_ROW_LISTS = ["exchanges", "accounts"] as const;
/** The trades of a page of the pair page, and the candles it asks for (`CANDLE_COUNT` and one more). */
const TRADES_PAGE = 20;
const CANDLE_LIMIT = 61;

/** A query as data-api.ts writes it: in its order, `amm` last, what is left out not there. */
const queryOf = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

/** Every file of one orientation of a pair: `rows` its trades as served in that orientation, oldest first. */
function pairFiles(net: NetworkName, native: string, base: Asset, counter: Asset, rows: readonly PairExchange[], exact: boolean, now: number, calls: PairCalls): FileOut[] {
  const path = `/v2/exchanges/${apiAssetText(base)}/${apiAssetText(counter)}`;
  const files: FileOut[] = [];
  const out = (where: string, query: string, value: unknown) => files.push({ path: where, query, value, rowLists: PAIR_ROW_LISTS });
  const fillsOf = (filter: Filter) => rows.map((row) => fillOf(row, native, exact)).filter(takes(filter));
  const rowsOf = (filter: Filter) => rows.filter((row) => filter === undefined || (filter === "only") === (row.amm_account !== undefined));

  for (const filter of [undefined, ...calls.filters]) {
    for (const { marker, page } of listPages(rowsOf(filter), TRADES_PAGE)) {
      out(path, queryOf({ descending: "true", limit: TRADES_PAGE, marker, amm: filter }), page);
    }
    for (const interval of Object.keys(INTERVALS) as Interval[]) {
      const { start } = candleWindow(now, interval);
      out(path, queryOf({ interval: INTERVALS[interval].api, start, limit: CANDLE_LIMIT, amm: filter }), candlesOf(fillsOf(filter), interval, start, base, counter, CANDLE_LIMIT));
    }
  }
  const dayStart = dayWindowStart(now);
  for (const filter of [undefined, ...calls.reduces]) out(path, queryOf({ reduce: "true", start: dayStart, amm: filter }), reducedOf(fillsOf(filter), dayStart, base, counter));
  out(`/v2/active_accounts/${apiAssetText(base)}/${apiAssetText(counter)}`, "", activeAccountsOf(rows, now));
  if (calls.probe) out(path, queryOf({ descending: "true", limit: 1 }), listPages(rows, 1)[0]!.page);
  return files;
}

// ---- The markets table -----------------------------------------------------------------------------------------------

type MarketsPeriod = "day" | "7day" | "30day";
const PERIOD_HOURS: Record<MarketsPeriod, number> = { day: 24, "7day": 168, "30day": 720 };
/** `min_trades` and `limit` of the call (the reference's default and the explorer's `limit`). */
const MIN_TRADES = 10;
const MARKETS_LIMIT = 1000;
const SPARKLINE_DAYS = 7;
const HOUR = 3600;
const DAY = 86_400;

/** A pair of the markets table: in its stored order, its trades oldest first (stored orientation), and whether it has a pool. */
interface MarketPair {
  base: Asset;
  counter: Asset;
  fills: Fill[];
  pool: boolean;
}

const assetKey = (asset: Asset): string => `${asset.currency}+${asset.issuer ?? ""}`;
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
function marketsAnswer(net: NetworkName, native: string, pairs: readonly MarketPair[], period: MarketsPeriod, amm: Filter, now: number): MarketsResponse {
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
      base_currency: pair.base.currency,
      ...(pair.base.issuer !== undefined && { base_issuer: pair.base.issuer }),
      counter_currency: pair.counter.currency,
      ...(pair.counter.issuer !== undefined && { counter_issuer: pair.counter.issuer }),
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

  // Listed: 10 trades or more; by native volume, the largest first, the pairs without one last; ties by count, the largest first, then by the pair.
  const listed = made
    .filter((m) => m.count >= MIN_TRADES)
    .sort((a, b) => {
      if (a.native && b.native) return b.native.comparedTo(a.native)! || b.count - a.count || byPair(a.pair, b.pair);
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

// ---- Synthetic trades ------------------------------------------------------------------------------------------------

/** What each network looks like to the generator. */
interface Profile {
  native: NativeCode;
  /** Seconds between ledgers, for the ledger of a synthetic trade. */
  ledgerSeconds: number;
  /** How many seeded pairs of each tier: busy enough to be listed in the 24 hours, in 7 days, in 30 days, and traded but never listed. */
  tiers: Record<Tier, number>;
  /** Whether the network has AMM pools. */
  amm: boolean;
}

type Tier = "day" | "week" | "month" | "thin";

const PROFILES: Record<NetworkName, Profile> = {
  xrpl: { native: "XRP", ledgerSeconds: 3.9, tiers: { day: 40, week: 42, month: 75, thin: 30 }, amm: true },
  xahau: { native: "XAH", ledgerSeconds: 4, tiers: { day: 10, week: 12, month: 18, thin: 8 }, amm: false },
};

/**
 * The trades a day of each tier has (the draws make it 75% to 125% of a number drawn from the range, a fraction being a chance of one more), the size of
 * a trade in native coins (10% to 200% of a size drawn from the range, small ones more often), and the chance that a pair of the tier has a pool.
 */
const TIERS: Record<Tier, { perDay: [number, number]; size: [number, number]; pool: number }> = {
  day: { perDay: [12, 32], size: [150, 4000], pool: 0.6 },
  week: { perDay: [2.2, 6], size: [40, 1500], pool: 0.4 },
  month: { perDay: [0.5, 1.1], size: [15, 600], pool: 0.25 },
  thin: { perDay: [0.04, 0.22], size: [5, 200], pool: 0.1 },
};

/** The codes of the seeded assets: 3-character ones, and text ones the ledger holds as 40 hex digits. */
const CODES = [
  "USD", "EUR", "GBP", "JPY", "CNY", "BTC", "ETH", "CHF", "AUD", "CAD", "KRW", "SGD", "MXN", "BRL", "XAU", "XAG", "CSC", "ELS", "XLM", "LTC",
  "SOL", "ADA", "DOT", "FLR", "SGB", "XAH", "EVR", "VGB", "ATM", "PLX", "MAG", "XPM", "OVO", "ARK", "BXE", "GZX", "XRH", "RPR", "LOX", "ZEN",
  "SOLO", "CORE", "XRdoge", "Schmeckles", "FUZZY", "BEAR", "PHNIX", "ARMY", "XCORE", "RLUSD", "USDC", "USDT", "EURQ", "BLORD", "LIONS", "SIGMA",
  "TAZZ", "aura", "MASK", "CHAR", "XMETA", "POWDER", "STEVE", "SEAL", "Opulence", "HOOTS", "XRPBR", "BUSD", "XSPEC", "MOON",
];

/** A text code as the ledger holds it: its bytes, left-aligned and zero-padded, 40 hex digits in upper case. */
function heldCode(code: string): string {
  if (code.length === 3) return code;
  let hex = "";
  for (let at = 0; at < code.length; at++) hex += code.charCodeAt(at).toString(16).padStart(2, "0");
  return hex.toUpperCase().padEnd(40, "0");
}

/** A seeded asset: what it is worth in native coins, and the decimals of its amounts. */
interface Seeded {
  asset: Asset;
  value: number;
  decimals: number;
}

const decimalsOf = (value: number): number => (value >= 100 ? 8 : value >= 0.01 ? 6 : value >= 1e-4 ? 4 : 2);

/** A pair of the seeded universe before its trades: its assets as drawn (not yet in the stored order), its tier and its pool. */
interface Spec {
  a: Seeded;
  b: Seeded;
  tier: Tier;
}

/** A round decimal of `units` of 10^-`decimals`. */
const unitsText = (units: number, decimals: number): Exact => {
  if (!Number.isSafeInteger(units) || units < 1) throw new Error(`${units}: not a positive whole number of units`);
  return { units: BigInt(units), scale: decimals };
};

/**
 * A rate as a synthetic trade stores it: the 8 significant digits of a drawn number, which `precision8` serves as they are (`toPrecision` of a number writes
 * the exponent form where BigNumber's does: below 1e-6 and from 1e8).
 */
const rateText = (value: number): string => value.toPrecision(8);

class Draws {
  readonly next: () => number;
  constructor(net: NetworkName, endpoint: string) {
    this.next = mulberry32(seedOf(net, endpoint));
  }
  /** A number in [low, high). */
  between(low: number, high: number): number {
    return low + (high - low) * this.next();
  }
  /** A whole number in [0, n). */
  below(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** A classic address of 20 seeded bytes. */
  account(): string {
    return encodeAccountID(Uint8Array.from({ length: 20 }, () => this.below(256)));
  }
  /** Of a number of trades a day drawn from the range, the trades of one day: 75% to 125% of it, and a fraction a chance of one more. */
  trades(perDay: number, part: number): number {
    return Math.floor(perDay * part * (0.75 + 0.5 * this.next()) + this.next());
  }
}

/**
 * The seeded pairs of a network's markets tables and their trades, from `seedOf(net, "network/markets")`. Every pair is drawn first (its assets, the
 * value of each in native coins, its tier and pool), then the trades of each pair day by day, from the day before the 30-day window to T, so adding a
 * pair at the end changes no other. Some pairs are there on purpose: an asset with a lower-case standard code, EUR/USD and USD/USD (two issuers) beside
 * the native pairs of their assets, a pair of two assets that have no native pair (no native volume), an asset worth less than a millionth of a native
 * coin (prices in exponent form), and one whose code sorts after the native currency's (stored with the native currency as base).
 */
function seededPairs(net: NetworkName, profile: Profile, now: number): MarketPair[] {
  const draws = new Draws(net, "network/markets");
  const native: Seeded = { asset: { currency: profile.native }, value: 1, decimals: 6 };
  const usdValue = net === "xrpl" ? 1 / 2.4 : 1 / 0.04;
  const seeded = (code: string, value: number): Seeded => ({ asset: { currency: heldCode(code), issuer: draws.account() }, value, decimals: decimalsOf(value) });
  const token = (): Seeded => {
    // Any code but the native one's, which an issued currency may have but which the table would show as the native currency's.
    let code = CODES[draws.below(CODES.length)]!;
    while (code === profile.native) code = CODES[draws.below(CODES.length)]!;
    // A token is worth 1e-5 to 11 native coins, spread evenly over the powers of ten (a product of draws, no fractional power).
    let value = 1e-5;
    for (let steps = draws.below(14); steps > 0; steps--) value *= 2.7;
    return seeded(code, value * draws.between(1, 2.7));
  };

  // The special pairs, then the drawn ones of each tier.
  const eur = seeded("EUR", usdValue * 1.09);
  const usdA = seeded("USD", usdValue);
  const usdB = seeded("USD", usdValue * draws.between(0.995, 1.005));
  const lower = seeded("usd", usdValue * draws.between(0.6, 0.9));
  const gold = seeded("XAU", usdValue * 2650);
  const silver = seeded("XAG", usdValue * 31);
  const junk = seeded("PEPE", 3.2e-7 * draws.between(0.8, 1.2));
  const late = seeded("ZAR", usdValue / 18);
  const specs: Spec[] = [
    { a: lower, b: native, tier: "day" },
    { a: eur, b: native, tier: "day" },
    { a: usdA, b: native, tier: "day" },
    { a: eur, b: usdA, tier: "day" },
    { a: usdA, b: usdB, tier: "day" },
    { a: gold, b: silver, tier: "day" },
    { a: usdB, b: native, tier: "week" },
    { a: junk, b: native, tier: "week" },
    { a: late, b: native, tier: "week" },
  ];
  const special: Record<Tier, number> = { day: 0, week: 0, month: 0, thin: 0 };
  for (const spec of specs) special[spec.tier]++;
  for (const tier of ["day", "week", "month", "thin"] as const) {
    for (let at = special[tier]; at < profile.tiers[tier]; at++) {
      // One in ten drawn pairs is between two tokens; the rest are against the native currency.
      const a = token();
      specs.push({ a, b: draws.next() < 0.1 ? token() : native, tier });
    }
  }

  const today = Math.floor(now / DAY) * DAY;
  const first = Math.floor((Math.floor(now / HOUR) * HOUR - PERIOD_HOURS["30day"] * HOUR) / DAY) * DAY - DAY;
  const pairs: MarketPair[] = [];
  // The profile of each pair, drawn before any trade.
  const drawn = specs.map((spec) => {
    const tier = TIERS[spec.tier];
    const pool = profile.amm && draws.next() < tier.pool;
    return {
      spec,
      perDay: draws.between(...tier.perDay),
      size: draws.between(...tier.size),
      pool,
      // Some pools see no swap in a month: a pair with a pool and a share of 0.
      swaps: pool && draws.next() < 0.85 ? draws.between(0.05, 0.8) : 0,
    };
  });
  for (const { spec, perDay, size, pool, swaps } of drawn) {
    const [base, counter] = sameAsset(canonicalPair(spec.a.asset, spec.b.asset)[0], spec.a.asset) ? [spec.a, spec.b] : [spec.b, spec.a];
    const fills: Fill[] = [];
    let mid = base.value / counter.value;
    let sequence = 0;
    for (let day = first; day <= today; day += DAY) {
      mid *= 0.97 + 0.06 * draws.next();
      const length = day === today ? now - day : DAY;
      const times = Array.from({ length: draws.trades(perDay, length / DAY) }, () => day + draws.below(length + (day === today ? 1 : 0))).sort((x, y) => x - y);
      for (const time of times) {
        const rate = rateText(mid * (0.996 + 0.008 * draws.next()));
        const coins = size * (0.1 + 1.9 * draws.next() * draws.next());
        const baseUnits = Math.max(1, Math.round((coins / base.value) * 10 ** base.decimals));
        const baseAmount = unitsText(baseUnits, base.decimals);
        const counterUnits = Math.max(1, Math.round((baseUnits / 10 ** base.decimals) * Number(rate) * 10 ** counter.decimals));
        const amm = swaps > 0 && draws.next() < swaps;
        fills.push({
          key: [time, sequence++, 0],
          time,
          rate,
          value: Number(rate),
          base: baseAmount,
          counter: unitsText(counterUnits, counter.decimals),
          amm,
          kept: true,
          bought: draws.next() < 0.5,
          exact: true,
        });
      }
    }
    pairs.push({ base: base.asset, counter: counter.asset, fills, pool });
  }
  return pairs;
}

/**
 * The trades of Xahau's EVR/XAH, from `seedOf("xahau", "exchanges/EVR+r…/XAH")`: from the first week of the weekly candles to T, busier the nearer to T
 * (16 a day in the last two days, 5 in the eight before, 1 in the fifty before those, and one in eight days before that), at the ledgers of the Xahau
 * chain (one every 4 s back from the newest recorded ledger), among 24 seeded accounts. The third newest has an XAH leg of 0.0004 (dust: in the list
 * and the active accounts, in no aggregate).
 */
function evrTrades(newest: number, now: number): PairExchange[] {
  const draws = new Draws("xahau", `exchanges/${apiAssetText(EVR)}/XAH`);
  const accounts = Array.from({ length: 24 }, () => draws.account());
  const someone = () => accounts[draws.below(accounts.length)]!;
  const firstDay = Date.parse(candleWindow(now, "1w").start) / 1000;
  const today = Math.floor(now / DAY) * DAY;
  const seconds = PROFILES.xahau.ledgerSeconds;
  const taken = new Set<string>();
  const rows: PairExchange[] = [];
  let mid = 3.5;
  for (let day = firstDay; day <= today; day += DAY) {
    mid *= 0.985 + 0.03 * draws.next();
    const age = (today - day) / DAY;
    const perDay = age <= 1 ? 16 : age <= 9 ? 5 : age <= 59 ? 1 : 0.125;
    const length = day === today ? now - day : DAY;
    for (let n = draws.trades(perDay, length / DAY); n > 0; n--) {
      const time = day + draws.below(length);
      const ledger = newest - Math.round((now - time) / seconds);
      let [tx, node] = [draws.below(40), 1 + draws.below(12)];
      while (taken.has(`${ledger}/${tx}/${node}`)) node++;
      taken.add(`${ledger}/${tx}/${node}`);
      const rate = rateText(mid * (0.99 + 0.02 * draws.next()));
      const evr = Math.max(1, Math.round((5 + 900 * draws.next() * draws.next()) * 1e6));
      const xah = Math.max(1, Math.round((evr / 1e6) * Number(rate) * 1e6));
      const [provider, taker] = [someone(), someone()];
      const takerBuys = draws.next() < 0.5;
      const payment = draws.next() < 0.15;
      rows.push({
        base_amount: plainText({ units: BigInt(evr), scale: 6 }),
        counter_amount: plainText({ units: BigInt(xah), scale: 6 }),
        node_index: node,
        rate,
        tx_index: tx,
        buyer: takerBuys ? taker : provider,
        executed_time: isoTime(now - Math.round((newest - ledger) * seconds)),
        ledger_index: ledger,
        offer_sequence: 1 + draws.below(9_000_000),
        provider,
        seller: takerBuys ? provider : taker,
        taker,
        tx_hash: Array.from({ length: 32 }, () => draws.below(256).toString(16).padStart(2, "0")).join("").toUpperCase(),
        tx_type: payment ? "Payment" : "OfferCreate",
        base_currency: EVR.currency,
        base_issuer: EVR.issuer,
        counter_currency: "XAH",
      });
    }
  }
  rows.sort((a, b) => compareKey(rowKey(a), rowKey(b)));
  const dust = rows.at(-3);
  if (dust === undefined || Date.parse(dust.executed_time) / 1000 < Date.parse(candleWindow(now, "15m").start) / 1000) {
    throw new Error("EVR/XAH: no trade in the window of the 15-minute candles to make the dust one");
  }
  dust.base_amount = "0.000114";
  dust.counter_amount = "0.0004";
  return rows;
}

// ---- The files -------------------------------------------------------------------------------------------------------

const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const LIONS: Asset = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };

/** The pairs of the pair page's fixtures, each in both orientations on XRPL; what the natural orientation of XRP/RLUSD asks beyond the default view. */
const XRPL_PAIRS: Array<{ base: Asset; counter: Asset; calls: PairCalls }> = [
  { base: { currency: "XRP" }, counter: RLUSD, calls: { filters: ["exclude", "only"], reduces: ["exclude", "only"], probe: true } },
  { base: RLUSD, counter: { currency: "XRP" }, calls: { filters: [], reduces: ["only"], probe: false } },
  { base: LIONS, counter: { currency: "XRP" }, calls: { filters: [], reduces: ["only"], probe: false } },
  { base: { currency: "XRP" }, counter: LIONS, calls: { filters: [], reduces: ["only"], probe: false } },
];

/** The stored pair a row is of: its base and counter as the API stores them. */
const storedKey = (row: PairExchange): string => `${assetKey(baseOf(row))}/${assetKey(counterOf(row))}`;

/** Every file of the markets pages' fixtures: path below test/fixtures/http/ and text. */
export function marketFixtures(): Map<string, string> {
  const files = new Map<string, string>();
  const put = (net: NetworkName, file: FileOut) => {
    const path = dataApiFile(net, file.path, file.query);
    if (path === undefined) throw new Error(`no fixture file for ${file.path}?${file.query}`);
    if (files.has(path)) throw new Error(`${path} is written twice`);
    files.set(path, fixtureText(file.value, file.rowLists));
  };
  const periods: MarketsPeriod[] = ["day", "7day", "30day"];

  for (const net of ["xrpl", "xahau"] as const) {
    const ledgers = readLedgers(net);
    const head = ledgers.at(-1)!;
    const now = unixOf(head.ledger.close_time);
    const newest = Number(head.ledger.ledger_index);
    const profile = PROFILES[net];
    const native = profile.native;
    const pairs: MarketPair[] = [];

    if (net === "xrpl") {
      // The derived trades, by the pair they are stored under: the pair page's pairs, and the recorded pairs of the markets table.
      const byStored = new Map<string, PairExchange[]>();
      for (const row of derivedExchanges(ledgers)) byStored.set(storedKey(row), [...(byStored.get(storedKey(row)) ?? []), row]);
      for (const { base, counter, calls } of XRPL_PAIRS) {
        const [first, second] = canonicalPair(base, counter);
        const stored = byStored.get(`${assetKey(first)}/${assetKey(second)}`) ?? [];
        if (stored.length === 0) throw new Error(`no derived trade of ${apiAssetText(first)}/${apiAssetText(second)}`);
        // `invertedExchange` takes the derived rows themselves: it inverts the rate each stored, which its 8 digits do not give back.
        const rows = sameAsset(first, base) ? stored : stored.map(invertedExchange);
        for (const file of pairFiles(net, native, base, counter, rows, false, now, calls)) put(net, file);
      }
      for (const rows of byStored.values()) {
        const fills = rows.map((row) => fillOf(row, native, false)).sort(byKey);
        pairs.push({ base: baseOf(rows[0]!), counter: counterOf(rows[0]!), fills, pool: fills.some((fill) => fill.amm) });
      }
    } else {
      const rows = evrTrades(newest, now);
      for (const file of pairFiles(net, native, EVR, { currency: native }, rows, true, now, { filters: [], reduces: [], probe: false })) put(net, file);
      pairs.push({ base: EVR, counter: { currency: native }, fills: rows.map((row) => fillOf(row, native, true)), pool: false });
    }

    pairs.push(...seededPairs(net, profile, now));
    for (const period of periods) {
      for (const amm of profile.amm ? [undefined, "exclude", "only"] as const : [undefined]) {
        put(net, { path: "/v2/network/markets", query: queryOf({ limit: MARKETS_LIMIT, period, amm }), value: marketsAnswer(net, native, pairs, period, amm, now), rowLists: ["markets"] });
      }
    }
  }
  return files;
}
