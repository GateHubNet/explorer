// What the markets page shows, worked out in the Worker from the data API's one markets answer (spec 2.4): every row in the orientation it is
// displayed in, every price, change, volume and label as text, every href as a string, and the ranks the browser sorts by. No I/O, no clock,
// no `Intl`: each number is text from the API or from `bignumber.js` at 80 decimal places, so no float reaches a string of the page.
//
// It value-imports `app/domain/asset.ts` and `market-pair.ts` (issuer checksums, `ripple-address-codec`), so only the Worker, the scripts and the
// tests import this file: the page gets the data it returns and nothing else (test/unit/markets-bundle.test.ts).

import BigNumber from "bignumber.js";

import { apiAssetText, assetText, parseAssetText, sameAsset, type Asset, type NativeCode } from "../domain/asset";
import { tokenOf } from "../domain/fnv";
import {
  compactNumber,
  formatAmount,
  formatChange,
  formatCurrency,
  formatPrice,
  formatUtcDay,
  shortAddress,
  wholePercent,
} from "../domain/format";
import { marketHref, naturalOrientation } from "../domain/market-pair";
import { marketsHref, PERIODS, QUOTES, TRADES_API, type MarketsParams, type Quote } from "../domain/market-params";
import type { MeterData } from "../ui/charts/types";
import type { SegmentLink } from "../ui/components/SegmentedLinks";
import { isNumberText } from "./aggregate-shape";
import type { MarketRow, MarketsResponse } from "./api-types";
import type { Network } from "./networks";

/** XRPL with `AMM_DATA` on · XRPL with it off (the AMM fields are not read, whatever the answer holds) · Xahau (whatever the answer says). */
export type AmmState = "on" | "off" | "none";

export interface MarketRowView {
  /** The row's own key: the stored pair as the API writes it, so two rows never share one. */
  key: string;
  /** "XRP / USD", in the orientation of `naturalOrientation` (or the Quote filter's). */
  pair: string;
  /** The pair page in that orientation; `null` when the data API could not be asked for the pair (a lower-case standard code). */
  href: string | null;
  /** "USD rhub8V…F3wq · …": each issued side's code and short issuer, base first. */
  issuers: string;
  last: string;
  /** "+2.38%"; "—" and `flat` without one. */
  change: { text: string; dir: "up" | "down" | "flat" };
  /** "2.389 – 2.4501". */
  range: string;
  /** `compactNumber` of the native volume, or "—". */
  volume: string;
  /** The trade count, grouped. */
  trades: string;
  /** `null` unless the AMM state is "on". */
  amm: { text: string; meter: MeterData | null } | null;
  spark: { closes: (string | null)[]; label: string; token: string };
  /** Lower case: the pair as "base/counter", the raw codes and the issuers. The text filter matches a substring of it. */
  search: string;
  /**
   * Each row's place (from 0) in an exact ascending sort of what the row shows, a tie keeping the API's order. `last`, `change` and `volume`
   * are `null` for a row without one (a price that cannot be inverted, a missing change, a pair with no native volume), which the browser puts
   * last in both directions. The browser sorts by these integers and compares no decimal.
   */
  ranks: { last: number | null; change: number | null; volume: number | null; trades: number };
}

export interface MarketsPageData {
  intro: string;
  filters: { period: SegmentLink[]; quote: SegmentLink[]; trades: SegmentLink[] | null };
  note: string | null;
  tiles: { label: string; value: string; sub: string }[] | null;
  source: string;
  rows: MarketRowView[];
  empty: string | null;
  footnote: { left: string; right: string };
  ammColumn: boolean;
  /** The words a non-default view adds to the page title ("last 7 days", "USD", "AMM swaps"). */
  view: string[];
  /** The view's period as the page's sentences say it: "last 24 hours", "last 7 days", "last 30 days" (the description of its tags). */
  periodWords: string;
  indexable: boolean;
}

export interface MarketsInput {
  network: Pick<Network, "id" | "name" | "native" | "hasAmm" | "features">;
  params: MarketsParams;
  answer: MarketsResponse;
}

/** Eighty decimal places hold the 8 significant digits of any inverse the scaling in `inverse` leaves in [1, 10]. */
const BN = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
const HALF_UP = BigNumber.ROUND_HALF_UP;

const DASH = "\u2014";
const RANGE_DASH = "\u2013";
const MINUS = "\u2212";
const SEPARATOR = " \u00b7 ";

const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/;

// ---- Numbers --------------------------------------------------------------------------------------------------------------------------

/**
 * A number the API wrote (decimal or exponent text, `isNumberText`), or `null` where it is not one. The text is tested first: bignumber.js is
 * strict, so `new BigNumber("abc")` throws instead of giving NaN.
 */
function numberOf(text: string | undefined): BigNumber | null {
  return isNumberText(text) ? new BN(text) : null;
}

/** A plain decimal text: as it was written when it already is one, and written out in full when it is in exponent form; `null` for no number. */
function plainText(text: string): string | null {
  if (PLAIN_DECIMAL.test(text)) return text;
  return numberOf(text)?.toFixed() ?? null;
}

/** A price as the page shows it: `formatPrice`, or a dash where the text is no number. */
function priceText(text: string): string {
  return numberOf(text) === null ? DASH : formatPrice(text);
}

/**
 * 1 ÷ a price, to the 80 decimal places the clone holds, or `null` for what is not above 0 (a price of nothing has no inverse). The division is
 * made on the price scaled into [1, 10), so that the 80 places are 80 significant digits whatever its size: 1 ÷ 3e95 is 3.3333333e-96, and
 * the places alone would have made it 0.
 */
function inverse(price: string): BigNumber | null {
  const value = numberOf(price);
  if (value === null || !value.gt(0)) return null;
  const shift = (value.e ?? 0) + 1;
  return new BN(1).shiftedBy(shift).div(value).shiftedBy(-shift);
}

/** A price to 8 significant digits, half up, as plain text (the form a sparkline close travels in). */
function eightDigits(value: BigNumber): string {
  return value.precision(8, HALF_UP).toFixed();
}

/** The place of each value in an ascending sort, a tie keeping the order the values came in; `null` for a value that is not there. */
function ranksOf(values: (BigNumber | null)[]): (number | null)[] {
  const listed = values.flatMap((value, at) => (value === null ? [] : [{ value, at }]));
  listed.sort((a, b) => a.value.comparedTo(b.value) || a.at - b.at);
  const ranks: (number | null)[] = values.map(() => null);
  for (const [place, { at }] of listed.entries()) ranks[at] = place;
  return ranks;
}

/** A whole count with its thousands grouped. */
function groupedCount(count: number | BigNumber): string {
  return formatAmount(new BN(count).toFixed());
}

// ---- Orientation ------------------------------------------------------------------------------------------------------------------------

function sideOf(currency: string, issuer: string | undefined): Asset {
  return issuer ? { currency, issuer } : { currency };
}

/**
 * Whether a side is the quote currency: the native code for a quote that is one (and only a side without an issuer is native), otherwise a
 * side with an issuer whose display code is the quote's (so the hex of USD is USD, and `usd` is not).
 */
function isQuote(side: Asset, quote: Quote, native: NativeCode): boolean {
  const code = quote.toUpperCase();
  if (!side.issuer) return side.currency === code;
  return code !== native && formatCurrency(side.currency) === code;
}

/** The orientation a row is shown in, or `null` when the Quote filter leaves the row out. `inverted` is relative to the stored order. */
function orientationOf(
  stored: { base: Asset; counter: Asset },
  quote: Quote | null,
  native: NativeCode,
): { base: Asset; counter: Asset; inverted: boolean } | null {
  const { base, counter } = stored;
  if (quote !== null) {
    const [baseIsQuote, counterIsQuote] = [isQuote(base, quote, native), isQuote(counter, quote, native)];
    if (!baseIsQuote && !counterIsQuote) return null;
    // The quote is the counter. With the quote on both sides (two issuers) nothing says which, so it is the natural orientation.
    if (counterIsQuote && !baseIsQuote) return { base, counter, inverted: false };
    if (baseIsQuote && !counterIsQuote) return { base: counter, counter: base, inverted: true };
  }
  return naturalOrientation(base, counter, native);
}

// ---- One row ----------------------------------------------------------------------------------------------------------------------------

/** What a row shows of its prices: all of it in the orientation it is displayed in, before the page's formatting of the AMM and the ranks. */
interface Prices {
  last: string;
  /** The price as it is shown, for the rank; `null` where there is none. */
  lastValue: BigNumber | null;
  change: { text: string; dir: "up" | "down" | "flat" };
  /** The change as it is shown (2 decimals), for the rank. */
  changeValue: BigNumber | null;
  range: string;
  closes: (string | null)[];
}

const NO_CHANGE = { text: DASH, dir: "flat" } as const;

/** The signed percent change as the row shows it. */
function changeOf(change: BigNumber | null): { text: string; dir: "up" | "down" | "flat" } {
  if (change === null) return NO_CHANGE;
  const shown = change.decimalPlaces(2, HALF_UP);
  const dir = shown.isZero() ? "flat" : shown.isNegative() ? "down" : "up";
  return { text: `${formatChange(change.toFixed())}%`, dir };
}

/** `(open ÷ last − 1) × 100`, which is the change of the inverse price; `null` where either price is not above 0. */
function invertedChange(open: string, last: string): BigNumber | null {
  const [from, to] = [numberOf(open), numberOf(last)];
  if (from === null || to === null || !from.gt(0) || !to.gt(0)) return null;
  return from.div(to).minus(1).times(100);
}

function storedPrices(row: MarketRow): Prices {
  const last = numberOf(row.last);
  const change = numberOf(row.change);
  const [low, high] = [priceText(row.low), priceText(row.high)];
  return {
    last: priceText(row.last),
    lastValue: last === null ? null : last.precision(8, HALF_UP),
    change: changeOf(change),
    changeValue: change === null ? null : change.decimalPlaces(2, HALF_UP),
    range: low === DASH || high === DASH ? DASH : `${low} ${RANGE_DASH} ${high}`,
    closes: row.sparkline.map(({ close }) => (close === undefined ? null : plainText(close))),
  };
}

/** The prices of the inverse pair: `1/last`, high' = `1/low`, low' = `1/high`, the change from the API's own open and last, each close inverted. */
function invertedPrices(row: MarketRow): Prices {
  const last = inverse(row.last);
  const [high, low] = [inverse(row.low), inverse(row.high)];
  const change = invertedChange(row.open, row.last);
  return {
    last: last === null ? DASH : formatPrice(eightDigits(last)),
    lastValue: last === null ? null : last.precision(8, HALF_UP),
    change: changeOf(change),
    changeValue: change === null ? null : change.decimalPlaces(2, HALF_UP),
    range: low === null || high === null ? DASH : `${formatPrice(eightDigits(low))} ${RANGE_DASH} ${formatPrice(eightDigits(high))}`,
    closes: row.sparkline.map(({ close }) => {
      const flipped = close === undefined ? null : inverse(close);
      return flipped === null ? null : eightDigits(flipped);
    }),
  };
}

/**
 * "7-day price, from 2.38 to 2.44 (today so far), +2.5%": the first and the last close there is, and the change between them to one decimal,
 * half up. The last day of a sparkline is the running one (R5), so a last close that is that day's says "(today so far)".
 */
function sparkLabel(closes: readonly (string | null)[]): string {
  const seen = closes.filter((close): close is string => close !== null);
  const [first, last] = [seen[0], seen[seen.length - 1]];
  if (first === undefined || last === undefined) return "No trades in the last 7 days";
  const from = numberOf(first);
  const to = numberOf(last);
  const running = closes[closes.length - 1] === last ? " (today so far)" : "";
  const head = `7-day price, from ${priceText(first)} to ${priceText(last)}${running}`;
  if (from === null || to === null || !from.gt(0)) return head;
  const change = to.div(from).minus(1).times(100).decimalPlaces(1, HALF_UP);
  const text = change.isZero() ? "0.0" : `${change.isNegative() ? MINUS : "+"}${formatAmount(change.abs().toFixed(1))}`;
  return `${head}, ${text}%`;
}

/** The AMM cell of a row: its share of the pair's volume as a whole percent, and a meter of it (decorative: the text says the value). */
function ammCell(row: MarketRow): { text: string; meter: MeterData | null } {
  const share = numberOf(row.amm_share);
  if (row.amm_share === undefined || share === null) return { text: DASH, meter: null };
  // A share of 0 for a pair with no pool says so; a share above 0 without a pool (deleted in the window) keeps its percent.
  if (share.isZero() && row.amm_pool === false) return { text: "no pool", meter: null };
  const text = wholePercent(row.amm_share, "1");
  return { text, meter: { value: row.amm_share, max: "1", label: `AMM share ${text}` } };
}

/** The pair's issued sides, base first: "USD rhub8V…F3wq · EUR rvYAfW…s59B". */
function issuersOf(base: Asset, counter: Asset): string {
  return [base, counter]
    .filter((side) => side.issuer)
    .map((side) => `${formatCurrency(side.currency)} ${shortAddress(side.issuer!)}`)
    .join(SEPARATOR);
}

/** Whether the data API can be asked for the pair: each side must read back from its URL form as the same asset (`usd` reads back as `USD`). */
function isLinkable(sides: readonly Asset[], native: NativeCode): boolean {
  return sides.every((side) => {
    const read = parseAssetText(assetText(side), { native });
    return read !== null && sameAsset(read, side);
  });
}

// ---- The page -------------------------------------------------------------------------------------------------------------------------

function ammStateOf(network: MarketsInput["network"]): AmmState {
  if (!network.hasAmm) return "none";
  return network.features.ammData ? "on" : "off";
}

/** "Oct 18, 11:00" from a `YYYY-MM-DDTHH:mm:ss…Z` time: the minutes cut, the seconds dropped, not rounded. */
function momentText(time: string): string {
  return `${formatUtcDay(time.slice(0, 10))}, ${time.slice(11, 16)}`;
}

/** How often the data API computes a period's set (D2 3.3): the 24 hours every minute, 7 and 30 days every five minutes. */
function cadenceOf(period: MarketsParams["period"]): string {
  return period === "24h" ? "minute" : "five minutes";
}

function noteOf(answer: MarketsResponse, period: MarketsParams["period"]): string | null {
  const { start_time: start, end_time: end } = answer;
  if (start === undefined || end === undefined) return null;
  const cadence = cadenceOf(period);
  return `Figures cover ${momentText(start)} to ${momentText(end)} UTC: the ${PERIODS[period].words} from the start of an hour, recomputed every ${cadence}.`;
}

/** The totals over the rows listed, exact; the AMM tile is the answer's own (a dash while its window is incomplete), or left out. */
function tilesOf(
  rows: readonly MarketRow[],
  input: MarketsInput,
  ammState: AmmState,
): { label: string; value: string; sub: string }[] | null {
  const { answer, params, network } = input;
  if (answer.totals === undefined) return null;
  const sub = `last ${PERIODS[params.period].words}, pairs listed`;
  const volume = rows.reduce((sum, row) => sum.plus(numberOf(row.native_volume) ?? 0), new BN(0));
  const trades = rows.reduce((sum, row) => sum.plus(row.count), new BN(0));
  const tiles = [
    { label: "DEX volume", value: `${compactNumber(volume.toFixed())} ${network.native}`, sub },
    { label: "Trades", value: groupedCount(trades), sub },
    { label: "Pairs shown", value: groupedCount(rows.length), sub: `of ${groupedCount(answer.totals.pairs_traded)} with trades` },
  ];
  if (ammState === "off") return tiles;
  if (ammState === "none") return [...tiles, { label: "AMM share of volume", value: DASH, sub: "Xahau has no AMM" }];
  const share = answer.totals.amm_share;
  const ammTile =
    share === undefined
      ? { label: "AMM share of volume", value: DASH, sub: "not complete for this period yet" }
      : { label: "AMM share of volume", value: wholePercent(share, "1"), sub: "swaps against AMM pools" };
  return [...tiles, ammTile];
}

function introOf(ammState: AmmState): string {
  if (ammState === "none") return "Trades on the Xahau DEX. Xahau has no AMM, so every trade is an order-book crossing.";
  return ammState === "on"
    ? "Trades on the XRP Ledger DEX: order-book crossings and swaps against AMM pools."
    : "Trades on the XRP Ledger DEX.";
}

/** " The 1,000 pairs with the most volume of 2,140." when the API served fewer pairs than qualify (the footnote's sentence), else nothing. */
function servedNote(answer: MarketsResponse): string {
  const served = answer.markets.length;
  return answer.totals !== undefined && served > 0 && answer.totals.pairs > served
    ? ` The ${groupedCount(served)} pairs with the most volume of ${groupedCount(answer.totals.pairs)}.`
    : "";
}

function emptyOf(input: MarketsInput, listed: number): string | null {
  const { answer, params } = input;
  if (listed > 0) return null;
  // The API has no set yet: no window, no totals, no pair at all.
  if (answer.totals === undefined && answer.markets.length === 0) {
    return `No market figures yet for this period. The data API computes them every ${cadenceOf(params.period)}.`;
  }
  const quote = params.quote === null ? "" : `${params.quote.toUpperCase()} `;
  // Only the pairs served were looked at: "No USD pairs" must not read as a fact about pairs the API did not send.
  return `No ${quote}pairs with at least 10 trades in the last ${PERIODS[params.period].words}.${servedNote(answer)}`;
}

/** A period in words: "last 24 hours", "last 7 days". */
function periodWordsOf(period: MarketsParams["period"]): string {
  return `last ${PERIODS[period].words}`;
}

/** The title words of a view that is not the default: "last 7 days", "USD", "AMM swaps". */
function viewWords(params: MarketsParams): string[] {
  const words: string[] = [];
  if (params.period !== "24h") words.push(periodWordsOf(params.period));
  if (params.quote !== null) words.push(params.quote.toUpperCase());
  if (params.trades !== null) words.push(params.trades === "amm" ? "AMM swaps" : "order-book trades");
  return words;
}

/**
 * The markets page's data (spec 2.4). Pure: the answer is the API's one markets call, `params` the view (its canonical parameters), and the
 * network says which AMM parts exist. With a Quote filter only the rows with the currency on either side are listed, each oriented so that it
 * is the counter; otherwise each row is in the natural orientation. An inverted row's prices are recomputed from the API's own strings.
 */
export function marketsPage(input: MarketsInput): MarketsPageData {
  const { network, answer } = input;
  const native = network.native;
  const ammState = ammStateOf(network);
  // The Trades filter is a parameter only where it exists; a link or a title never names one that is not there.
  const params: MarketsParams = { ...input.params, trades: ammState === "on" ? input.params.trades : null };
  const tradesShown = ammState === "on" && answer.totals?.amm_share !== undefined;
  // While the filter is not shown the other filters' links drop it, so that a view filtered by it can be left.
  const linkTrades = tradesShown ? params.trades : null;
  const link = (change: Partial<MarketsParams>): string =>
    marketsHref(network.id, { period: params.period, quote: params.quote, trades: linkTrades, ...change });

  const listed = answer.markets.flatMap((row) => {
    const stored = { base: sideOf(row.base_currency, row.base_issuer), counter: sideOf(row.counter_currency, row.counter_issuer) };
    const shown = orientationOf(stored, params.quote, native);
    return shown === null ? [] : [{ row, stored, shown }];
  });

  const prices = listed.map(({ row, shown }) => (shown.inverted ? invertedPrices(row) : storedPrices(row)));
  const [lastRanks, changeRanks, volumeRanks, tradesRanks] = [
    ranksOf(prices.map((price) => price.lastValue)),
    ranksOf(prices.map((price) => price.changeValue)),
    ranksOf(listed.map(({ row }) => numberOf(row.native_volume))),
    ranksOf(listed.map(({ row }) => new BN(row.count))),
  ];

  const rows = listed.map(({ row, stored, shown }, at): MarketRowView => {
    const price = prices[at]!;
    const label = sparkLabel(price.closes);
    const codes = [shown.base, shown.counter].map((side) => formatCurrency(side.currency));
    const issuers = [shown.base, shown.counter].flatMap((side) => (side.issuer ? [side.issuer] : []));
    return {
      key: `${apiAssetText(stored.base)}/${apiAssetText(stored.counter)}`,
      pair: `${codes[0]} / ${codes[1]}`,
      href: isLinkable([shown.base, shown.counter], native) ? marketHref(network.id, shown.base, shown.counter) : null,
      issuers: issuersOf(shown.base, shown.counter),
      last: price.last,
      change: price.change,
      range: price.range,
      volume: numberOf(row.native_volume) === null ? DASH : compactNumber(row.native_volume!),
      trades: groupedCount(row.count),
      amm: ammState === "on" ? ammCell(row) : null,
      spark: { closes: price.closes, label, token: tokenOf(price.closes) },
      search: [`${codes[0]}/${codes[1]}`, shown.base.currency, shown.counter.currency, ...issuers].join(" ").toLowerCase(),
      ranks: { last: lastRanks[at] ?? null, change: changeRanks[at] ?? null, volume: volumeRanks[at] ?? null, trades: tradesRanks[at]! },
    };
  });

  const view = viewWords(params);
  const tradesLinks: SegmentLink[] | null = tradesShown
    ? [
        { label: "All", href: link({ trades: null }), current: params.trades === null },
        { label: "Order book", href: link({ trades: "book" }), current: params.trades === "book" },
        { label: "AMM", href: link({ trades: "amm" }), current: params.trades === "amm" },
      ]
    : null;

  return {
    intro: introOf(ammState),
    filters: {
      period: (Object.keys(PERIODS) as MarketsParams["period"][]).map((period) => ({
        label: PERIODS[period].label,
        href: link({ period }),
        current: params.period === period,
      })),
      quote: [
        { label: "All", href: link({ quote: null }), current: params.quote === null },
        ...QUOTES[native].map((quote) => ({ label: quote.toUpperCase(), href: link({ quote }), current: params.quote === quote })),
      ],
      trades: tradesLinks,
    },
    note: noteOf(answer, params.period),
    tiles: tilesOf(
      listed.map(({ row }) => row),
      { ...input, params },
      ammState,
    ),
    source: `/v2/network/markets?period=${PERIODS[params.period].api}${params.trades === null ? "" : `&amm=${TRADES_API[params.trades]}`}`,
    rows,
    empty: emptyOf({ ...input, params }, rows.length),
    footnote: {
      left: `Pairs with at least 10 trades in the period. Volume in ${native}: the ${native} side of pairs against ${native}, other pairs at the period's rate.${servedNote(answer)}`,
      right: "Prices are counter per base.",
    },
    ammColumn: ammState === "on",
    view,
    periodWords: periodWordsOf(params.period),
    indexable: view.length === 0,
  };
}
