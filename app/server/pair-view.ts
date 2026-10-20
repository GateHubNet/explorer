// What the pair page shows, worked out in the Worker from the node's and the data API's answers (spec 3.4 to 3.7 and 3.11): the head of the
// pair, the order book's levels, the candles' slots, the trades with their paging, the 24 h figures, the pool, the share of its volume, the
// traders, whether the market exists at all, and the page and the page behind a marker put together from them. Pure: no I/O, no clock. Each
// number is text from the node or the API, or from `bignumber.js` at 80 decimal places, so no float reaches a string of the page, and nothing
// the page shows is written in exponent form.
//
// It is not imported by the page: the page gets the data these functions return, with every price already shown (`formatPrice`), every
// size already compact (`compactNumber`) and every href and label already a string, and formats nothing itself.

import BigNumber from "bignumber.js";

import { accountHref } from "../domain/account-tabs";
import { sameAsset, type Asset } from "../domain/asset";
import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount, formatChange, formatCurrency, formatPrice, formatUtc, shortAddress, shortHash, wholePercent } from "../domain/format";
import { marketHref, naturalOrientation } from "../domain/market-pair";
import { candleWindow, INTERVALS, pairQuery, TRADES_API, type Interval, type PairParams, type TradesFilter } from "../domain/market-params";
import { trailPaging, type Paging } from "../domain/paging";
import type { BarListData, CandleData } from "../ui/charts/types";
import type { SegmentLink } from "../ui/components/SegmentedLinks";
import type { Loaded } from "./account-view";
import { isNumberText } from "./aggregate-shape";
import type { Anchor } from "./anchor";
import type { ActiveAccounts, Candle, Page, PairExchange, ReducedRow } from "./api-types";
import type { Network } from "./networks";
import type { AmmInfo, Book, BookOffer, NodeAmount } from "./node-rpc";

/** The pair page's candle windows are market-params.ts's (Node-safe: the fixture generator uses them); the pair view names the one it uses (P20). */
export { candleWindow };

/** Eighty decimal places, half up: the arithmetic of every view builder. */
const BN = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
const HALF_UP = BigNumber.ROUND_HALF_UP;
const DASH = "—";

// ---- The order book -------------------------------------------------------------------------------------------------------------------------

/** The levels a side of the book shows: the 60 offers read per side fill 10 levels in a liquid book. */
export const BOOK_LEVELS = 10;

export interface BookLevel {
  /** As shown: 8 significant digits, grouped (`formatPrice`). Counter per base. */
  price: string;
  /** The base the level's offers give (asks) or want (bids) that is funded, `compactNumber`. */
  size: string;
  /** The size from the best price out to this level, `compactNumber`. */
  total: string;
  /** `total` over the larger side's last total, from 0 to 1 as a plain decimal of up to 6 places, half up: the width of the level's bar, never a figure. */
  depth: string;
}

export interface BookParts {
  /** The lower of the two answers' ledgers, grouped (`107,721,455`): the book is as old as its older side. */
  ledger: string;
  /** Best (lowest price) first. */
  asks: BookLevel[];
  /** Best (highest price) first. */
  bids: BookLevel[];
  /** The best ask minus the best bid at 8 significant digits, as shown, or a dash where a side is empty or the book is not above 0 apart. */
  spread: string;
  /** `tokenOf` the levels (`asks` and `bids`) alone: the ledger and the spread are left out, so a book that has not changed keeps its token as the chain moves. */
  token: string;
}

/**
 * A number as text (the node's plain decimals, the API's decimal or exponent text): `isNumberText` is the guard before `bignumber.js`, which is strict
 * and throws on what is not a number. `null` where it is not one.
 */
function decimalOf(text: string | undefined): BigNumber | null {
  return isNumberText(text) ? new BN(text) : null;
}

/** The number of an amount the node wrote, or `null` where it is not one. */
function numberOf(amount: NodeAmount | undefined): BigNumber | null {
  return decimalOf(amount?.value);
}

/**
 * `numerator ÷ denominator` (both above 0) to 8 significant digits, half up. The division is made on the two amounts scaled into [1, 10), so that
 * its 80 places are 80 significant digits whatever the size of the amounts: 1e-81 ÷ 9.999999999999999e95 is 1e-177, which 80 places alone would
 * have made 0.
 */
function ratioOf(numerator: BigNumber, denominator: BigNumber): BigNumber {
  const [above, below] = [numerator.e ?? 0, denominator.e ?? 0];
  return numerator.shiftedBy(-above).div(denominator.shiftedBy(-below)).shiftedBy(above - below).precision(8, HALF_UP);
}

/** An offer as the side it is on reads it: the price of the full amounts (the offer's quality), and the base that is funded (its size). */
interface Priced {
  price: BigNumber;
  size: BigNumber;
}

/**
 * An ask gives base and wants counter: its price is `pays ÷ gets` and its size the funded `TakerGets`. A bid gives counter and wants base: its
 * price is `gets ÷ pays` and its size the funded `TakerPays`. `null` for an offer that is not drawn: an amount that is no number or not above 0, and an
 * offer of which either funded amount is 0 (the funded amount is the full one where the node gave none). Native amounts are whole units already.
 */
function pricedOf(offer: BookOffer, side: "ask" | "bid"): Priced | null {
  const [gets, pays] = [numberOf(offer.gets), numberOf(offer.pays)];
  const getsFunded = offer.getsFunded === undefined ? gets : numberOf(offer.getsFunded);
  const paysFunded = offer.paysFunded === undefined ? pays : numberOf(offer.paysFunded);
  if (gets === null || pays === null || getsFunded === null || paysFunded === null) return null;
  if (!gets.gt(0) || !pays.gt(0) || !getsFunded.gt(0) || !paysFunded.gt(0)) return null;
  return side === "ask" ? { price: ratioOf(pays, gets), size: getsFunded } : { price: ratioOf(gets, pays), size: paysFunded };
}

/** A side's levels before they are written: the price (8 significant digits), the exact size, and the total from the best price out. */
interface Level {
  price: BigNumber;
  size: BigNumber;
  total: BigNumber;
}

/**
 * The best `BOOK_LEVELS` levels of a side. Offers whose prices have the same text (8 significant digits) are one level, wherever they stand in the
 * answer, and the levels are put in order here (asks ascending, bids descending: the node's best first) so that the answer's own order is not trusted.
 */
function levelsOf(book: Book, side: "ask" | "bid"): Level[] {
  const merged = new Map<string, { price: BigNumber; size: BigNumber }>();
  for (const offer of book.offers) {
    const priced = pricedOf(offer, side);
    if (priced === null) continue;
    const key = priced.price.toFixed();
    const level = merged.get(key);
    merged.set(key, { price: priced.price, size: level === undefined ? priced.size : level.size.plus(priced.size) });
  }
  const ordered = [...merged.values()].sort((a, b) => (side === "ask" ? a.price.comparedTo(b.price) : b.price.comparedTo(a.price)) ?? 0);
  const levels: Level[] = [];
  let total = new BN(0);
  for (const { price, size } of ordered.slice(0, BOOK_LEVELS)) {
    total = total.plus(size);
    levels.push({ price, size, total });
  }
  return levels;
}

/** The level as the page shows it, on the scale `scale` (the larger side's last total). The depth is a bar's width, so 6 places are all it needs. */
function shown(level: Level, scale: BigNumber): BookLevel {
  return {
    price: formatPrice(level.price.toFixed()),
    size: compactNumber(level.size.toFixed()),
    total: compactNumber(level.total.toFixed()),
    depth: level.total.div(scale).decimalPlaces(6, HALF_UP).toFixed(),
  };
}

/** The best ask minus the best bid at 8 significant digits as the page shows it, or a dash where a side has no level or the difference is not above 0. */
function spreadOf(asks: readonly Level[], bids: readonly Level[]): string {
  const [ask, bid] = [asks[0], bids[0]];
  if (ask === undefined || bid === undefined) return DASH;
  // The prices are the shown ones (8 digits), so the spread is of what is on the page: two prices that read alike have none. `formatPrice` cuts
  // the difference, which is exact, to 8 significant digits, half up.
  const spread = ask.price.minus(bid.price);
  return spread.gt(0) ? formatPrice(spread.toFixed()) : DASH;
}

/**
 * The order book of the pair as shown (spec 3.4). `asks` is the answer of the book where the offers' owners give the base (`TakerGets` is base,
 * `TakerPays` counter), `bids` the one where they give the counter. The inverted page is built from the same two answers swapped.
 *
 * The depth bars of both sides share one scale, the larger of the two last totals. Never half a book: both answers are inputs, or neither (a side
 * whose call failed is not an empty side). An empty side is a side of no levels, and the spread is a dash.
 */
export function bookOf(asks: Book, bids: Book): BookParts {
  const [askLevels, bidLevels] = [levelsOf(asks, "ask"), levelsOf(bids, "bid")];
  const scale = BN.max(askLevels.at(-1)?.total ?? 0, bidLevels.at(-1)?.total ?? 0);
  const levels = { asks: askLevels.map((level) => shown(level, scale)), bids: bidLevels.map((level) => shown(level, scale)) };
  return {
    ledger: formatAmount(String(Math.min(asks.ledgerIndex, bids.ledgerIndex))),
    ...levels,
    spread: spreadOf(askLevels, bidLevels),
    token: tokenOf(levels),
  };
}

// ---- The candles ----------------------------------------------------------------------------------------------------------------------------

/**
 * The candles of a pair as the chart kit draws them (spec 3.5). `window` is `candleWindow`'s: the 60 bucket starts, oldest first, the last one the
 * running bucket. The candles are aligned to it by `start`, as moments (the API may write `.000Z`): a bucket without a candle is `null`, and a candle
 * outside the window (the 61st when the index is a moment ahead of the anchor and a new bucket has begun) is ignored. The prices and the volume are the
 * API's own text, which the kit reads and writes its own labels from. `codes` are the display codes of the pair as it is shown.
 */
export function candlesOf(
  page: Page<"exchanges", Candle>,
  window: { buckets: string[] },
  interval: Interval,
  codes: { base: string; counter: string },
): { data: CandleData; empty: string | null } {
  const served = new Map<number, Candle>();
  for (const candle of page.exchanges) {
    const at = Date.parse(candle.start);
    // A repeated start keeps the first. Defensive only: the API serves one candle a bucket and never repeats a start.
    if (!served.has(at)) served.set(at, candle);
  }
  const candles = window.buckets.map((bucket) => {
    const candle = served.get(Date.parse(bucket));
    if (candle === undefined) return null;
    return { o: candle.open, h: candle.high, l: candle.low, c: candle.close, v: candle.base_volume, n: String(candle.count) };
  });
  const data: Omit<CandleData, "token"> = {
    axis: { unit: INTERVALS[interval].unit, buckets: [...window.buckets] },
    candles,
    format: { kind: "price", unit: codes.counter },
    volume: { kind: "amount", unit: codes.base },
    forming: true,
  };
  return {
    data: { ...data, token: tokenOf(data) },
    empty: candles.some((candle) => candle !== null) ? null : `No trades in these ${INTERVALS[interval].span}`,
  };
}

// ---- The page's types -----------------------------------------------------------------------------------------------------------------------

/** What the page shows of the pair itself: its codes, its issuers, and the links that leave the view for another (spec 3.1). */
export interface PairHead {
  /** "XRP/USD": the display codes (`formatCurrency`: "LP token" for an LP token) in the orientation of the page. */
  title: string;
  /** "XRP / USD". */
  heading: string;
  base: string;
  counter: string;
  /** The issued sides, base first. `code` is the display code, and the whole 40 hex digits where the code does not decode. */
  issuers: { code: string; address: string; href: string }[];
  /** The sides without an issuer: ["XRP"], the page's "XRP is native". */
  natives: string[];
  /** "USD rhub8V…F3wq" for each issued side. */
  issued: string[];
  /** "USD issued by rhub8V…F3wq", the issued sides joined by ", ". */
  issuedBy: string;
  /** The page of the other way round ("Show USD/XRP"), keeping the interval and the Trades filter. */
  invert: { label: string; href: string };
  /** The first page of the pair's trades, which is the market's page, keeping the Trades filter. */
  firstPage: string;
}

export interface TradeRowView {
  /** `ledger_index:tx_index:node_index`, the API's key. */
  key: string;
  /** "2026-10-17 15:42:51", UTC. */
  time: string;
  txHref: string;
  /** The part of the time link's name that only a screen reader reads: ", transaction 76018A…D8AB". */
  txHidden: string;
  /** The taker's side: Buy when the taker is the buyer, Sell when the seller, a dash for neither. */
  side: "Buy" | "Sell" | "—";
  dot: "up" | "down" | null;
  price: string;
  base: string;
  counter: string;
  /** The taker's whole address: the page makes the link and the short form. */
  taker: string;
  /** `null` while the AMM parts are off. */
  via: "AMM" | "Book" | null;
}

export interface TradesView {
  rows: TradeRowView[];
  paging: Paging;
  /** The route the list came from. */
  source: string;
}

/** What the answers say of whether the market exists: see `existenceOf`. */
export type PairExistence = "exists" | "absent" | "outage" | "ask-unfiltered";

export interface LivePairData {
  mode: "live";
  head: PairHead;
  anchor: Anchor;
  build: string;
  indexable: boolean;
  /** The words a non-default view adds to the page title ("4 h candles", "order-book trades", "AMM swaps"). */
  view: string[];
  /** Whether the AMM parts exist on this page: XRPL with `AMM_DATA` on. */
  ammParts: boolean;
  filters: { trades: SegmentLink[] | null; interval: SegmentLink[] };
  price: { text: string; unit: string; note: string | null; change: { text: string; dir: "up" | "down" | "flat" } | null; token: string };
  stats: { state: "ok"; items: { label: string; value: string }[]; note: string | null; token: string } | { state: "failed" };
  candles: { state: "ok"; data: CandleData; source: string; empty: string | null } | { state: "failed" };
  trades: TradesView;
  book: ({ state: "ok" } & BookParts) | { state: "failed" };
  pool:
    | {
        state: "ok";
        title: string;
        source: string;
        ledger: string;
        reserves: string;
        price: string;
        fee: string;
        link: { href: string; label: string };
        token: string;
      }
    | { state: "missing" }
    | { state: "failed" };
  share: { state: "ok"; text: string } | { state: "off" } | { state: "failed" };
  traders: { state: "ok"; data: BarListData; note: string } | { state: "failed" };
}

/** The page behind a marker: old trades only, with no chart, no book and no live row. */
export interface OlderPairData {
  mode: "older";
  head: PairHead;
  build: string;
  view: string[];
  /** `link` is the part of `text` that links to `href`, the market's page. */
  note: { text: string; link: string; href: string };
  trades: TradesView;
}

export type PairPageData = LivePairData | OlderPairData;

export interface PairInput {
  network: Pick<Network, "id" | "name" | "native" | "hasAmm" | "features">;
  /** The pair in the orientation of the page (the URL's), not necessarily the natural one. */
  base: Asset;
  counter: Asset;
  params: PairParams;
  /** The anchor's close time, unix seconds. */
  closeTime: number;
  /** Call #2: the newest trades, in the orientation of the page. */
  trades: Page<"exchanges", PairExchange>;
  /** Whether the index has a trade of the pair: #2's, or #10's when the list is filtered and empty. */
  hasTrade: boolean;
  stats: Loaded<ReducedRow>;
  candles: Loaded<Page<"exchanges", Candle>>;
  traders: Loaded<ActiveAccounts>;
  asks: Loaded<Book>;
  bids: Loaded<Book>;
  /** `null`: not asked (Xahau). */
  pool: Loaded<AmmInfo> | null;
  /** `null`: not asked (no AMM parts). */
  share: Loaded<ReducedRow> | null;
}

/** The names of the page's parts that can fail alone, in the order they are listed in `problems`. */
type PartName = "stats" | "candles" | "traders" | "book" | "pool" | "share";

const FAILED_PART = { state: "failed" } as const;

// ---- Shared ---------------------------------------------------------------------------------------------------------------------------------

/** XRPL with `AMM_DATA` on: the Trades filter, the Via column and the pool card's share exist (R2); on Xahau `hasAmm` is false whatever the switch says. */
function hasAmmParts(network: PairInput["network"]): boolean {
  return network.hasAmm && network.features.ammData;
}

/** The params the page is built from: a Trades filter that the network does not have is not one, so no link, source or title names it. */
function viewParams(network: PairInput["network"], params: PairParams): PairParams {
  return params.trades === null || hasAmmParts(network) ? params : { ...params, trades: null };
}

/** A price as the page shows it: `formatPrice`, or a dash where the text is no number. */
function priceText(text: string | undefined): string {
  return isNumberText(text) ? formatPrice(text) : DASH;
}

/** A volume as a summary shows it: `compactNumber`, or a dash where the text is no number. */
function summaryText(text: string | undefined): string {
  return isNumberText(text) ? compactNumber(text) : DASH;
}

/** The data API's `amm` parameter of a Trades filter, as it follows the other parameters of a source line. */
function ammQuery(trades: TradesFilter | null): string {
  return trades === null ? "" : `&amm=${TRADES_API[trades]}`;
}

// ---- The head -------------------------------------------------------------------------------------------------------------------------------

const HEX_CURRENCY = /^[0-9A-Fa-f]{40}$/;
const ELLIPSIS = "…";

/** The code of an issuer's currency on the issuer line: the display code, and a 40-hex code that does not decode written out in full. */
function issuerCode(currency: string, shown: string): string {
  return HEX_CURRENCY.test(currency) && shown.endsWith(ELLIPSIS) ? currency.toUpperCase() : shown;
}

/**
 * The head of the page of `base`/`counter` as it is asked for (the URL's orientation): the codes, the issuers, and the links to the other way round
 * and to the first page. The links keep the Trades filter where the network has one (the interval too, in the one to the other way round) and never
 * a marker.
 */
export function pairHead(network: PairInput["network"], base: Asset, counter: Asset, params: PairParams): PairHead {
  const shown = viewParams(network, params);
  const sides = [base, counter].map((side) => ({ side, code: formatCurrency(side.currency) }));
  const issued = sides.filter(({ side }) => side.issuer);
  const [first, second] = sides;
  return {
    title: `${first!.code}/${second!.code}`,
    heading: `${first!.code} / ${second!.code}`,
    base: first!.code,
    counter: second!.code,
    issuers: issued.map(({ side, code }) => ({
      code: issuerCode(side.currency, code),
      address: side.issuer!,
      href: accountHref(network.id, side.issuer!, {}),
    })),
    natives: sides.filter(({ side }) => !side.issuer).map(({ code }) => code),
    issued: issued.map(({ side, code }) => `${code} ${shortAddress(side.issuer!)}`),
    issuedBy: issued.map(({ side, code }) => `${code} issued by ${shortAddress(side.issuer!)}`).join(", "),
    invert: {
      label: `Show ${second!.code}/${first!.code}`,
      href: marketHref(network.id, counter, base, { interval: shown.interval, trades: shown.trades }),
    },
    firstPage: marketHref(network.id, base, counter, { trades: shown.trades }),
  };
}

// ---- The trades -----------------------------------------------------------------------------------------------------------------------------

/**
 * The trades list of the page (spec 3.6): a row for each trade of `page`, newest first as the API gives them, and the Newer and Older links of the
 * list (`trailPaging`, with the pair's URLs). `via` says whether the Via column exists (the AMM parts); the Trades filter of `params` is kept in
 * every link, because a marker belongs to the list it came from.
 */
export function tradesOf(
  page: Page<"exchanges", PairExchange>,
  ctx: { net: string; base: Asset; counter: Asset; params: PairParams; via: boolean },
): TradesView {
  const { net, base, counter, params } = ctx;
  const rows = page.exchanges.map((trade): TradeRowView => {
    // A trade with oneself is a Buy: the buyer is looked at first.
    const side = trade.taker === trade.buyer ? "Buy" : trade.taker === trade.seller ? "Sell" : DASH;
    return {
      key: `${trade.ledger_index}:${trade.tx_index}:${trade.node_index}`,
      time: formatUtc(trade.executed_time).replace(/ UTC$/, ""),
      txHref: `/${net}/tx/${trade.tx_hash}`,
      txHidden: `, transaction ${shortHash(trade.tx_hash)}`,
      side,
      dot: side === "Buy" ? "up" : side === "Sell" ? "down" : null,
      price: priceText(trade.rate),
      base: formatAmount(trade.base_amount),
      counter: formatAmount(trade.counter_amount),
      taker: trade.taker,
      via: ctx.via ? (trade.amm_account === undefined ? "Book" : "AMM") : null,
    };
  });
  // The first page is asked for with no marker at all (`pairQuery` reads an absent one as the first page).
  const paging = trailPaging({ marker: params.marker, back: params.back, next: page.marker }, (to) =>
    marketHref(net, base, counter, { trades: params.trades, ...to }),
  );
  return { rows, paging, source: `/v2/exchanges/{base}/{counter}?descending=true${ammQuery(params.trades)}` };
}

// ---- The 24 h figures and the price ---------------------------------------------------------------------------------------------------------

/**
 * The six figures of the 24 hours (spec 3.1) from the one row of `reduce=true`: high, low and VWAP with `formatPrice`, the two volumes compact, the
 * trades grouped. A window with no trade has dashes for the prices and "0" for the rest (its row is all zeros), and a note that says so.
 */
export function statsOf(row: ReducedRow, codes: { base: string; counter: string }): Extract<LivePairData["stats"], { state: "ok" }> {
  const traded = row.count > 0;
  const items = [
    { label: "24 h high", value: traded ? priceText(row.high) : DASH },
    { label: "24 h low", value: traded ? priceText(row.low) : DASH },
    { label: "VWAP 24 h", value: traded ? priceText(row.vwap) : DASH },
    { label: `Volume ${codes.base}`, value: traded ? summaryText(row.base_volume) : "0" },
    { label: `Volume ${codes.counter}`, value: traded ? summaryText(row.counter_volume) : "0" },
    { label: "Trades 24 h", value: formatAmount(String(row.count)) },
  ];
  const note = traded ? null : "No trades in the last 24 hours.";
  return { state: "ok", items, note, token: tokenOf({ items, note }) };
}

const DAY_SECONDS = 86_400;

/** `(last ÷ open − 1) × 100` as the page shows it (2 decimals, half up, signed), or `null` where either price is not a number or `open` is not above 0. */
function changeOf(last: string, open: string): NonNullable<LivePairData["price"]["change"]> | null {
  const [now, then] = [decimalOf(last), decimalOf(open)];
  if (now === null || then === null || !then.gt(0)) return null;
  const change = now.div(then).minus(1).times(100);
  const rounded = change.decimalPlaces(2, HALF_UP);
  return { text: `${formatChange(change.toFixed())}%`, dir: rounded.isZero() ? "flat" : rounded.isNegative() ? "down" : "up" };
}

/**
 * The price of the summary (spec 3.7): the newest trade's rate, a dash and "No trades yet" without one, and "last trade 2026-10-03" when that trade is
 * more than 24 hours before the close time. The change is from the 24 h open, so it exists only when the window has a trade; both prices follow the
 * Trades filter, and so describe the same trades.
 */
function priceOf(
  trades: readonly PairExchange[],
  stats: Loaded<ReducedRow>,
  closeTime: number,
  head: PairHead,
): LivePairData["price"] {
  const unit = `${head.counter} per ${head.base}`;
  const newest = trades[0];
  let text = DASH;
  let note: string | null = "No trades yet";
  let change: LivePairData["price"]["change"] = null;
  if (newest !== undefined) {
    text = priceText(newest.rate);
    note = Date.parse(newest.executed_time) / 1000 < closeTime - DAY_SECONDS ? `last trade ${newest.executed_time.slice(0, 10)}` : null;
    if (stats.state === "ok" && stats.value.count > 0) change = changeOf(newest.rate, stats.value.open);
  }
  return { text, unit, note, change, token: tokenOf({ text, unit, note, change }) };
}

// ---- The pool -------------------------------------------------------------------------------------------------------------------------------

/** The pool's two reserves as the page's base and counter, matched by asset (`amount` is whichever side the node was asked for first), or `null` for a pool of another pair. */
function poolSides(info: AmmInfo, base: Asset, counter: Asset): { base: NodeAmount; counter: NodeAmount } | null {
  const assetOf = ({ currency, issuer }: NodeAmount): Asset => (issuer ? { currency, issuer } : { currency });
  const [one, two] = [assetOf(info.amount), assetOf(info.amount2)];
  if (sameAsset(one, base) && sameAsset(two, counter)) return { base: info.amount, counter: info.amount2 };
  if (sameAsset(two, base) && sameAsset(one, counter)) return { base: info.amount2, counter: info.amount };
  return null;
}

/**
 * The pool card of the pair (spec 3.1 and 3.7): its reserves compact and oriented to the page, the spot price (the counter reserve over the base
 * reserve, fee-free, 8 significant digits), the fee (the node's units of 1/100000 are thousandths of a percent) and the link to the pool account. The
 * pool must be the pair's: its amounts are matched to the page's assets, and a pool of another pair is a bug of the caller's (`pairPage` makes it a
 * failed card). The token is of the figures and the link; the ledger, which changes every ledger, is not in it.
 */
export function poolOf(
  info: AmmInfo,
  net: string,
  base: Asset,
  counter: Asset,
  head: PairHead,
): Extract<LivePairData["pool"], { state: "ok" }> {
  const sides = poolSides(info, base, counter);
  if (sides === null) throw new RangeError(`the pool ${info.account} does not hold ${head.title}`);
  const ledger = formatAmount(String(info.ledger_index));
  const [baseReserve, counterReserve] = [decimalOf(sides.base.value), decimalOf(sides.counter.value)];
  const price =
    baseReserve !== null && counterReserve !== null && baseReserve.gt(0) && counterReserve.gt(0)
      ? formatPrice(ratioOf(counterReserve, baseReserve).toFixed())
      : DASH;
  const title = `${head.title} AMM pool`;
  const reserves = `${summaryText(sides.base.value)} ${head.base} · ${summaryText(sides.counter.value)} ${head.counter}`;
  const fee = `${new BN(info.trading_fee).div(1000).toFixed(3)}%`;
  const link = { href: accountHref(net, info.account, {}), label: "Pool account →" };
  const source = `live from the node · amm_info · ledger #${ledger}`;
  return { state: "ok", title, source, ledger, reserves, price, fee, link, token: tokenOf({ title, reserves, price, fee, link }) };
}

/**
 * The AMM's share of the pair's volume (spec 3.7) as a whole percent, from the page's own 24 h figure (#3) and the other call (#9), or `null` where a
 * volume is no number. With the AMM filter #3 is the AMM's volume and #9 the book's (`amm=exclude`): the share is #3 over both. With the order-book
 * filter #3 is the book's and #9 the AMM's (`amm=only`): #9 over both. With no filter #3 is all of it and #9 the AMM's: #9 over #3, which is never
 * above all of it (the two calls are made apart in time, and may disagree by a trade).
 */
function shareText(filter: TradesFilter | null, stats: ReducedRow, other: ReducedRow): string | null {
  const [here, there] = [decimalOf(stats.base_volume), decimalOf(other.base_volume)];
  if (here === null || there === null) return null;
  const [part, whole] = filter === "amm" ? [here, here.plus(there)] : filter === "book" ? [there, there.plus(here)] : [BN.min(there, here), here];
  return wholePercent(part.toFixed(), whole.toFixed());
}

// ---- The traders ----------------------------------------------------------------------------------------------------------------------------

/** The traders the card shows: the top 5 of the 10 the load keeps. */
const TRADERS_SHOWN = 5;

/**
 * The most active traders card (spec 3.1 and 3.7): the top 5 accounts by base volume, each a link to its page with its volume and its trades. `pool`
 * is the pair's AMM pool account when the node named it: it is the other side of every swap and so leads the list once the index records swaps, and it
 * is left out when it is among the accounts (and the note says so). Nothing is left out where the node named no pool. The Trades filter does not apply
 * to this list (the API has no such filter), which the note says when the page has one.
 */
export function tradersOf(
  answer: ActiveAccounts,
  pool: string | null,
  ctx: { net: string; head: PairHead; filtered: boolean },
): Extract<LivePairData["traders"], { state: "ok" }> {
  const { head } = ctx;
  const leftOut = pool !== null && answer.accounts.some((account) => account.account === pool);
  const items = answer.accounts
    .filter((account) => account.account !== pool)
    .slice(0, TRADERS_SHOWN)
    .map((account) => ({
      id: account.account,
      label: shortAddress(account.account),
      href: accountHref(ctx.net, account.account, {}),
      value: account.base_volume,
      count: String(account.count),
    }));
  const format: BarListData["format"] = { kind: "amount", unit: head.base };
  const noun = answer.count === 1 ? "account" : "accounts";
  const note = [
    `${items.length} of ${formatAmount(String(answer.count))} ${noun} that traded ${head.title} in the last 24 hours, by ${head.base} volume.`,
    "A trade counts for its buyer and its seller.",
    ...(ctx.filtered ? ["All trades: this list has no filter."] : []),
    ...(leftOut ? [`The ${head.title} AMM pool, the other side of every swap, is left out.`] : []),
  ].join(" ");
  return { state: "ok", data: { items, format, token: tokenOf({ items, format }) }, note };
}

// ---- Whether the market exists --------------------------------------------------------------------------------------------------------------

/**
 * Whether the market exists (spec 1.4), from the first page of its trades and the two sides of its book.
 *
 * - A trade: `exists`. Otherwise the book has to say: if either side could not be read, nothing can be told (an empty market is not a failed one) and
 *   it is an `outage`; an offer on either side is a market with offers and no trade yet, `exists`; both sides empty is `absent`.
 * - With a Trades filter the list may be empty while the pair has other trades. Then, with both sides of the book read and empty, the caller must ask
 *   for the first page without the filter (call #10): `ask-unfiltered`. Given that answer (`unfiltered`), a row is `exists`, none is `absent`, and a
 *   failure is an `outage`.
 */
export function existenceOf(
  trades: readonly PairExchange[],
  book: { asks: Loaded<Book>; bids: Loaded<Book> },
  filtered: boolean,
  unfiltered?: Loaded<Page<"exchanges", PairExchange>>,
): PairExistence {
  if (trades.length > 0) return "exists";
  const { asks, bids } = book;
  if (asks.state !== "ok" || bids.state !== "ok") return "outage";
  if (asks.value.offers.length > 0 || bids.value.offers.length > 0) return "exists";
  if (!filtered) return "absent";
  if (unfiltered === undefined) return "ask-unfiltered";
  if (unfiltered.state !== "ok") return "outage";
  return unfiltered.value.exchanges.length > 0 ? "exists" : "absent";
}

// ---- The pages ------------------------------------------------------------------------------------------------------------------------------

/** "4 h candles" for an interval that is not the default (the default has no words in a title). */
function intervalWords(params: PairParams): string[] {
  // `pairQuery` drops the default interval, so a query that is not empty names another.
  return pairQuery({ interval: params.interval }) === "" ? [] : [`${INTERVALS[params.interval].label} candles`];
}

/** "order-book trades" or "AMM swaps" for a Trades filter. */
function tradesWords(params: PairParams): string[] {
  return params.trades === null ? [] : [params.trades === "amm" ? "AMM swaps" : "order-book trades"];
}

/**
 * The page of a pair (spec 3.7), put together from the answers of its calls: the part that failed is `failed` and its name is in `problems` (in the
 * order the parts are listed in), and everything else is shown. `problems` is what the route logs and marks the request degraded with. An absent
 * pool (`missing`, or not asked on Xahau) and the AMM parts that the network does not have are answers, not problems. The anchor and the build are the
 * route's to add.
 *
 * The page is in the orientation of the URL: the asks and bids, the trades, the figures and the candles are the API's and the node's for that
 * orientation, and the pool's amounts are matched to it by asset.
 */
export function pairPage(input: PairInput): { page: Omit<LivePairData, "anchor" | "build">; problems: string[] } {
  const { network, base, counter } = input;
  const params = viewParams(network, input.params);
  const ammParts = hasAmmParts(network);
  const head = pairHead(network, base, counter, params);
  const codes = { base: head.base, counter: head.counter };
  const linkTo = (change: Partial<PairParams>): string =>
    marketHref(network.id, base, counter, { interval: params.interval, trades: params.trades, ...change });

  const stats = input.stats.state === "ok" ? statsOf(input.stats.value, codes) : FAILED_PART;
  const candles =
    input.candles.state === "ok"
      ? {
          state: "ok" as const,
          ...candlesOf(input.candles.value, candleWindow(input.closeTime, params.interval), params.interval, codes),
          source: `/v2/exchanges/{base}/{counter}?interval=${INTERVALS[params.interval].api}${ammQuery(params.trades)}`,
        }
      : FAILED_PART;
  const pool: LivePairData["pool"] =
    input.pool === null || input.pool.state === "missing"
      ? { state: "missing" }
      : input.pool.state === "ok" && poolSides(input.pool.value, base, counter) !== null
        ? poolOf(input.pool.value, network.id, base, counter, head)
        : FAILED_PART;
  const poolAccount = input.pool?.state === "ok" && pool.state === "ok" ? input.pool.value.account : null;
  const traders =
    input.traders.state === "ok"
      ? tradersOf(input.traders.value, poolAccount, { net: network.id, head, filtered: params.trades !== null })
      : FAILED_PART;
  const book =
    input.asks.state === "ok" && input.bids.state === "ok"
      ? { state: "ok" as const, ...bookOf(input.asks.value, input.bids.value) }
      : FAILED_PART;
  let share: LivePairData["share"] = { state: "off" };
  if (ammParts && input.share !== null) {
    const text = input.share.state === "ok" && input.stats.state === "ok" ? shareText(params.trades, input.stats.value, input.share.value) : null;
    share = text === null ? FAILED_PART : { state: "ok", text };
  }

  const parts: Record<PartName, { state: string }> = { stats, candles, traders, book, pool, share };
  const problems = (Object.keys(parts) as PartName[]).filter((name) => parts[name].state === "failed");

  const trades = tradesOf(input.trades, { net: network.id, base, counter, params, via: ammParts });
  const page: Omit<LivePairData, "anchor" | "build"> = {
    mode: "live",
    head,
    indexable: input.hasTrade && !naturalOrientation(base, counter, network.native).inverted && pairQuery(params) === "",
    view: [...intervalWords(params), ...tradesWords(params)],
    ammParts,
    filters: {
      trades: ammParts
        ? [
            { label: "All", href: linkTo({ trades: null }), current: params.trades === null },
            { label: "Order book", href: linkTo({ trades: "book" }), current: params.trades === "book" },
            { label: "AMM", href: linkTo({ trades: "amm" }), current: params.trades === "amm" },
          ]
        : null,
      interval: (Object.keys(INTERVALS) as Interval[]).map((interval) => ({
        label: INTERVALS[interval].label,
        href: linkTo({ interval }),
        current: params.interval === interval,
      })),
    },
    price: priceOf(input.trades.exchanges, input.stats, input.closeTime, head),
    stats,
    candles,
    trades,
    book,
    pool,
    share,
    traders,
  };
  return { page, problems };
}

/**
 * The page behind a marker (spec 3.11): old trades only. The head, a note that sends the visitor to the market's page for the price, the chart and the
 * book, and the trades with their paging. There is no chart, book, pool or live row, so none of those is asked for or built.
 */
export function olderPage(input: Pick<PairInput, "network" | "base" | "counter" | "params" | "trades">): Omit<OlderPairData, "build"> {
  const { network, base, counter } = input;
  const params = viewParams(network, input.params);
  const head = pairHead(network, base, counter, params);
  return {
    mode: "older",
    head,
    view: [...tradesWords(params), "older trades"],
    note: {
      text: `Older trades of ${head.title}. The price, chart and order book are on the market's page.`,
      link: "the market's page",
      href: head.firstPage,
    },
    trades: tradesOf(input.trades, { net: network.id, base, counter, params, via: hasAmmParts(network) }),
  };
}
