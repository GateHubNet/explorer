// What the pair page shows, worked out in the Worker from the node's and the data API's answers (spec 3.4 and 3.5): this part is the order book's
// levels and the candles' slots. Pure: no I/O, no clock. Each number is text from the node or the API, or from `bignumber.js` at 80 decimal places,
// so no float reaches a string of the page, and nothing the page shows is written in exponent form.
//
// It is not imported by the page: the page gets the data these functions return, with every price already shown (`formatPrice`) and every size
// already compact (`compactNumber`), and formats nothing itself.

import BigNumber from "bignumber.js";

import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount, formatPrice } from "../domain/format";
import { INTERVALS, type Interval } from "../domain/market-params";
import type { CandleData } from "../ui/charts/types";
import { isNumberText } from "./aggregate-shape";
import type { Candle, Page } from "./api-types";
import type { Book, BookOffer, NodeAmount } from "./node-rpc";

/** The pair page's candle windows are market-params.ts's (Node-safe: the fixture generator uses them); the pair view names the one it uses (P20). */
export { candleWindow } from "../domain/market-params";

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
  /** `total` over the larger side's last total, exact text from 0 to 1 (a plain decimal of up to 80 places): the width of the level's bar. */
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
  token: string;
}

/**
 * A number the node wrote (plain decimal text; `isNumberText` is the guard before `bignumber.js`, which has no say on what is not a number), or
 * `null` where it is not one.
 */
function numberOf(amount: NodeAmount | undefined): BigNumber | null {
  return amount !== undefined && isNumberText(amount.value) ? new BN(amount.value) : null;
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
  let total = new BN(0);
  return ordered.slice(0, BOOK_LEVELS).map(({ price, size }) => {
    total = total.plus(size);
    return { price, size, total };
  });
}

/** The level as the page shows it, on the scale `scale` (the larger side's last total). */
function shown(level: Level, scale: BigNumber): BookLevel {
  return {
    price: formatPrice(level.price.toFixed()),
    size: compactNumber(level.size.toFixed()),
    total: compactNumber(level.total.toFixed()),
    depth: level.total.div(scale).toFixed(),
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
  const parts = {
    ledger: formatAmount(String(Math.min(asks.ledgerIndex, bids.ledgerIndex))),
    asks: askLevels.map((level) => shown(level, scale)),
    bids: bidLevels.map((level) => shown(level, scale)),
    spread: spreadOf(askLevels, bidLevels),
  };
  return { ...parts, token: tokenOf(parts) };
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
