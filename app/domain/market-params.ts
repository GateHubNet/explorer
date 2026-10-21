// The views of the markets pages and their URLs (spec 1.6 and 3.5): the parameters of each page, their canonical query, the links made
// from them, and the windows of the candle chart. Pure and safe for Node: the loaders, the view builders and the fixture generator import
// this file, so it imports no `.tsx` file and nothing of `app/ui` or of React Router (type imports are erased).
//
// One URL per view (E2 1.2): `parseMarketsParams` and `parsePairParams` give the view a query names and its canonical query, and the
// loader answers a 302 to the canonical URL when the request's query (with its `?`, or empty) is not exactly that. The canonical form
// drops defaults, unknown values, repeats and unknown parameters, and orders the rest as in the tables of the spec.

import type { NativeCode } from "./asset";
import { parseTrail } from "./paging";
import { queryValue } from "./query-of";

/** The markets page's period, and the quotes and trades filter that narrow its table. */
export type MarketsPeriod = "24h" | "7d" | "30d";
export type Quote = "xrp" | "xah" | "usd" | "eur" | "btc";
export type TradesFilter = "book" | "amm";
/** The pair page's candle interval, and the form the data API is sent. */
export type Interval = "15m" | "1h" | "4h" | "1d" | "1w";
export type CandleApiInterval = "15minute" | "1hour" | "4hour" | "1day" | "7day";

export interface MarketsParams {
  period: MarketsPeriod;
  quote: Quote | null;
  trades: TradesFilter | null;
}

/** The pair page's view: `marker` is how a page of trades was reached and `back` the markers of the pages before it, nearest first. */
export interface PairParams {
  interval: Interval;
  trades: TradesFilter | null;
  marker?: string;
  back: readonly string[];
}

/** What the parameters depend on: the network's native code, and whether the Trades filter exists (`net.hasAmm && net.features.ammData`). */
export interface ParamsContext {
  native: NativeCode;
  tradesAllowed: boolean;
}

/** `label` is the selector's text, `words` the page's, `api` the data API's `period`. */
export const PERIODS: Record<MarketsPeriod, { label: string; words: string; api: "day" | "7day" | "30day" }> = {
  "24h": { label: "24 h", words: "24 hours", api: "day" },
  "7d": { label: "7 days", words: "7 days", api: "7day" },
  "30d": { label: "30 days", words: "30 days", api: "30day" },
};

/** The quotes a network's markets can be narrowed to, in the order of the selector. */
export const QUOTES: Record<NativeCode, readonly Quote[]> = {
  XRP: ["xrp", "usd", "eur", "btc"],
  XAH: ["xah", "usd"],
};

/** The data API's `amm` parameter for a Trades filter: the order book alone leaves the pools out, AMM alone keeps only them. */
export const TRADES_API: Record<TradesFilter, "exclude" | "only"> = { book: "exclude", amm: "only" };

/**
 * `label` is the selector's text, `api` the data API's `interval`, `unit` the chart's axis unit, `step` the words of one bucket (the slider's
 * "4 hours by 4 hours"), `span` the words of the 60 buckets ("No trades in these 60 hours"), `long` whether the candles of 60 such buckets are a
 * large read (subrequest class `minute`, not `live`).
 */
export const INTERVALS: Record<
  Interval,
  { label: string; api: CandleApiInterval; unit: "minute" | "hour" | "day" | "week"; step: string; span: string; long: boolean }
> = {
  "15m": { label: "15 m", api: "15minute", unit: "minute", step: "quarter hour", span: "15 hours", long: false },
  "1h": { label: "1 h", api: "1hour", unit: "hour", step: "hour", span: "60 hours", long: false },
  "4h": { label: "4 h", api: "4hour", unit: "hour", step: "4 hours", span: "10 days", long: true },
  "1d": { label: "1 d", api: "1day", unit: "day", step: "day", span: "60 days", long: true },
  "1w": { label: "1 w", api: "7day", unit: "week", step: "week", span: "60 weeks", long: true },
};

/** The buckets of a candle chart; the call asks for one more (`limit=61`) and ignores the one that falls outside the axis. */
export const CANDLE_COUNT = 60;

const DEFAULT_PERIOD: MarketsPeriod = "24h";
const DEFAULT_INTERVAL: Interval = "1h";

function isPeriod(value: string | null): value is MarketsPeriod {
  return value !== null && Object.hasOwn(PERIODS, value);
}

function isInterval(value: string | null): value is Interval {
  return value !== null && Object.hasOwn(INTERVALS, value);
}

function isTradesFilter(value: string | undefined): value is TradesFilter {
  return value !== undefined && Object.hasOwn(TRADES_API, value);
}

/** The Trades filter a query names. It depends on the switch, not on data: where it is not allowed it is an unknown parameter. */
function tradesOf(search: URLSearchParams, ctx: ParamsContext): TradesFilter | null {
  if (!ctx.tradesAllowed) return null;
  const value = search.get("trades")?.toLowerCase();
  return isTradesFilter(value) ? value : null;
}

/** `?…`, or the empty text for the default view: `period`, `quote`, `trades`. */
function marketsQuery(params: Partial<MarketsParams>): string {
  const pairs: string[] = [];
  if (params.period !== undefined && params.period !== DEFAULT_PERIOD) pairs.push(`period=${params.period}`);
  if (params.quote) pairs.push(`quote=${params.quote}`);
  if (params.trades) pairs.push(`trades=${params.trades}`);
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

/**
 * The view of the markets page a query names, and its canonical query (`""` or `"?…"`). Only the first value of a parameter is read.
 * `period` is exact (case counts); `quote` and `trades` are read in any case and written in lower case; a quote the network does not
 * have, and `trades` where it is not allowed, are dropped.
 */
export function parseMarketsParams(search: URLSearchParams, ctx: ParamsContext): { params: MarketsParams; canonical: string } {
  const period = search.get("period");
  const quote = search.get("quote")?.toLowerCase();
  const params: MarketsParams = {
    period: isPeriod(period) ? period : DEFAULT_PERIOD,
    quote: QUOTES[ctx.native].find((id) => id === quote) ?? null,
    trades: tradesOf(search, ctx),
  };
  return { params, canonical: marketsQuery(params) };
}

/** The link to a view of the markets page: `/xrpl/markets`, `/xrpl/markets?period=7d&quote=usd`. A parameter that is left out is the default's. */
export function marketsHref(net: string, params: Partial<MarketsParams> = {}): string {
  return `/${net}/markets${marketsQuery(params)}`;
}

/**
 * `?…`, or the empty text for the default view, in the canonical order: `interval` (not the default, and not behind a marker, where there
 * is no chart), `trades`, `marker`, `back` (only behind a marker, and only a trail that is not empty). An absent `marker` is the first
 * page, which is how `trailPaging` asks for it. The markers are written as given (escaped for a query): a caller checks `isMarker` before
 * it builds a link, and a loader before it redirects to one.
 */
export function pairQuery(params: Partial<PairParams>): string {
  const { interval, trades, marker, back } = params;
  const pairs: string[] = [];
  if (marker === undefined && interval !== undefined && interval !== DEFAULT_INTERVAL) pairs.push(`interval=${interval}`);
  if (trades) pairs.push(`trades=${trades}`);
  if (marker !== undefined) {
    pairs.push(`marker=${queryValue(marker)}`);
    if (back !== undefined && back.length > 0) pairs.push(`back=${back.map(queryValue).join(".")}`);
  }
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

/**
 * The view of the pair page a query names, and its canonical query (`""` or `"?…"`). Behind a marker the interval is the default's (that
 * page has no chart), and the trail is what `parseTrail` accepts; without a marker there is no trail. The raw `marker` is returned as it
 * was given, whatever it is: the loader checks `isMarker` on it, and answers a 404, before it compares the query or redirects.
 */
export function parsePairParams(search: URLSearchParams, ctx: ParamsContext): { params: PairParams; canonical: string } {
  const interval = search.get("interval");
  const marker = search.get("marker") ?? undefined;
  const params: PairParams = {
    interval: marker === undefined && isInterval(interval) ? interval : DEFAULT_INTERVAL,
    trades: tradesOf(search, ctx),
    ...(marker === undefined ? {} : { marker }),
    back: marker === undefined ? [] : parseTrail(search.get("back")),
  };
  return { params, canonical: pairQuery(params) };
}

/** The seconds of a bucket; and the Monday 00:00 UTC the week buckets count from, in unix seconds (the epoch was a Thursday, so it is 3 days before it). */
const BUCKET_SECONDS: Record<Interval, number> = { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400, "1w": 604_800 };
const MONDAY_BEFORE_EPOCH = -3 * 86_400;

/** `YYYY-MM-DDTHH:mm:ssZ` for a time in unix seconds. */
function isoSeconds(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 19)}Z`;
}

function requireTime(closeTime: number): void {
  if (!Number.isFinite(closeTime)) throw new RangeError(`a close time is a number of seconds, not ${closeTime}`);
}

/**
 * The 60 bucket starts (`YYYY-MM-DDTHH:mm:ssZ`, oldest first) that end with the bucket that holds `closeTime` (unix seconds, the anchor's:
 * the index's `T`), and `start`, the first. The buckets are the API's: the clock's quarter hours, hours and 4-hour blocks from midnight,
 * UTC days, and weeks from Monday 00:00 UTC. All of UTC, so a bucket is a fixed number of seconds long.
 *
 * The candle call gives `start` and no `end`, so its key changes once per bucket and not once per ledger.
 */
export function candleWindow(closeTime: number, interval: Interval): { buckets: string[]; start: string } {
  requireTime(closeTime);
  const size = BUCKET_SECONDS[interval];
  // Whole buckets from the origin: the epoch itself for all but the week, whose bucket starts on a Monday.
  const origin = interval === "1w" ? MONDAY_BEFORE_EPOCH : 0;
  const last = origin + Math.floor((closeTime - origin) / size) * size;
  const buckets: string[] = [];
  for (let at = CANDLE_COUNT - 1; at >= 0; at--) buckets.push(isoSeconds(last - at * size));
  return { buckets, start: buckets[0]! };
}

/** T1: the start of `closeTime`'s minute minus 24 hours, `YYYY-MM-DDTHH:mm:00Z`; where the 24 h calls start. */
export function dayWindowStart(closeTime: number): string {
  requireTime(closeTime);
  return isoSeconds(Math.floor(closeTime / 60) * 60 - 86_400);
}
