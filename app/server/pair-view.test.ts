import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { bookFile, LIONS, RLUSD, XRP, type Asset as FixtureAsset } from "../../test/support/book-fixtures";
import type { Asset } from "../domain/asset";
import { dropsToNative } from "../domain/format";
import { candleWindow as marketParamsWindow, INTERVALS, type Interval, type PairParams } from "../domain/market-params";
import type { Loaded } from "./account-view";
import type { ActiveAccount, ActiveAccounts, Candle, Page, PairExchange, ReducedRow } from "./api-types";
import type { AmmInfo, Book, BookOffer, NodeAmount } from "./node-rpc";
import {
  BOOK_LEVELS,
  bookOf,
  candlesOf,
  candleWindow,
  existenceOf,
  olderPage,
  pairHead,
  pairPage,
  poolOf,
  statsOf,
  tradersOf,
  tradesOf,
  type PairInput,
} from "./pair-view";

// ---- The order book: hand-made books of XRP/RLUSD -------------------------------------------------------------------------------------

const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const DASH = "—";

/** The arithmetic of the view builder, for the expected values: 80 places, half up. */
const BN = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

/** A depth as the page gets it: `part` over `whole`, 6 decimal places, half up. */
const depthOf = (part: BigNumber.Value, whole: BigNumber.Value): string => new BN(part).div(whole).decimalPlaces(6).toFixed();

const xrp = (value: string): NodeAmount => ({ currency: "XRP", value });
const rlusd = (value: string): NodeAmount => ({ currency: RLUSD_HEX, issuer: RL, value });

const book = (offers: BookOffer[], ledgerIndex = 107_721_455): Book => ({ ledgerIndex, offers });
let sequence = 0;
/** An offer of a book. */
const offer = (gets: NodeAmount, pays: NodeAmount, funded: { getsFunded?: NodeAmount; paysFunded?: NodeAmount } = {}): BookOffer => ({
  account: "rOwner",
  sequence: (sequence += 1),
  gets,
  pays,
  ...funded,
});

// The plan's offers, shown as XRP / RLUSD: the asks give XRP and want RLUSD; the bid gives RLUSD and wants XRP.
const A = offer(xrp("100"), rlusd("130"), { getsFunded: xrp("50"), paysFunded: rlusd("65") });
const B = offer(xrp("200"), rlusd("260"));
const C = offer(xrp("10"), rlusd("13.5"), { getsFunded: xrp("0") });
const D = offer(rlusd("125"), xrp("100"));

const ASKS = book([A, B, C]);
const BIDS = book([D]);

/** An exponent in a number the page shows: a digit, `e`, an optional sign and a digit. */
const EXPONENT = /\d[eE][+-]?\d/;

describe("bookOf", () => {
  it("keeps 10 levels a side", () => {
    expect(BOOK_LEVELS).toBe(10);
  });

  it("builds the levels of XRP / RLUSD: the price from the full amounts, the size from the funded ones, equal prices merged, a zero-funded offer left out", () => {
    const parts = bookOf(ASKS, BIDS);
    // A (funded 50) and B (200) are the one price, 1.3. C is funded nothing.
    expect(parts.asks).toEqual([{ price: "1.3", size: "250", total: "250", depth: "1" }]);
    expect(parts.bids).toEqual([{ price: "1.25", size: "100", total: "100", depth: "0.4" }]);
    expect(parts.spread).toBe("0.05");
    expect(parts.ledger).toBe("107,721,455");
  });

  it("builds the inverted page, RLUSD / XRP, from the same two answers swapped", () => {
    const parts = bookOf(BIDS, ASKS);
    // Its asks give RLUSD: D, at 100 ÷ 125. Its bids give XRP: A (funded 65 RLUSD) and B (260) at 100 ÷ 130 and 200 ÷ 260; C is funded nothing.
    expect(parts.asks).toEqual([{ price: "0.8", size: "125", total: "125", depth: depthOf(125, 325) }]);
    expect(parts.bids).toEqual([{ price: "0.76923077", size: "325", total: "325", depth: "1" }]);
    expect(parts.spread).toBe("0.03076923");
  });

  it("gives the depth on one scale for both sides: the larger side's last total", () => {
    const asks = book([offer(xrp("10"), rlusd("13")), offer(xrp("30"), rlusd("42"))]);
    const bids = book([offer(rlusd("12"), xrp("10")), offer(rlusd("22"), xrp("20")), offer(rlusd("30"), xrp("50"))]);
    const parts = bookOf(asks, bids);
    // Asks 10 and 40; bids 10, 30 and 80: the scale is 80.
    expect(parts.asks.map((level) => level.total)).toEqual(["10", "40"]);
    expect(parts.bids.map((level) => level.total)).toEqual(["10", "30", "80"]);
    expect(parts.asks.map((level) => level.depth)).toEqual(["0.125", "0.5"]);
    expect(parts.bids.map((level) => level.depth)).toEqual(["0.125", "0.375", "1"]);
  });

  it("writes a depth that is not exact to 6 decimal places, half up, as a plain decimal", () => {
    const parts = bookOf(book([offer(xrp("1"), rlusd("2"))]), book([offer(rlusd("3"), xrp("3")), offer(rlusd("3"), xrp("0.5"))]));
    // 1 ÷ 3.5 = 0.2857142857…: the bids' last total is the scale.
    expect(parts.asks[0]!.depth).toBe("0.285714");
    expect(parts.bids.map((level) => level.depth)).toEqual(["0.142857", "1"]);
    // 2 ÷ 3 rounds up, 1 ÷ 3 down; 5e-7 is 1e-6 (half up) and 3.3e-7 is nothing.
    const thirds = bookOf(book([offer(xrp("1"), rlusd("2")), offer(xrp("1"), rlusd("3"))]), book([offer(rlusd("3"), xrp("3"))]));
    expect(thirds.asks.map((level) => level.depth)).toEqual(["0.333333", "0.666667"]);
    const tiny = bookOf(book([offer(xrp("1"), rlusd("2"))]), book([offer(rlusd("3"), xrp("2000000"))]));
    expect(tiny.asks[0]!.depth).toBe("0.000001");
    expect(bookOf(book([offer(xrp("1"), rlusd("2"))]), book([offer(rlusd("3"), xrp("3000000"))])).asks[0]!.depth).toBe("0");
    for (const level of [...parts.asks, ...parts.bids, ...thirds.asks, ...tiny.asks]) expect(level.depth).toMatch(/^(?:0|1|0\.\d{1,6})$/);
  });

  it("keeps the best 10 of more than 10 asks", () => {
    // Prices 1.1 to 2.2 in the node's order, 10 XRP each.
    const asks = book(Array.from({ length: 12 }, (_, at) => offer(xrp("10"), rlusd(String(11 + at)))));
    const parts = bookOf(asks, book([]));
    expect(parts.asks).toHaveLength(10);
    expect(parts.asks.map((level) => level.price)).toEqual(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "2"]);
    // The 11th and the 12th are out of the totals and of the depth scale.
    expect(parts.asks[0]).toEqual({ price: "1.1", size: "10", total: "10", depth: "0.1" });
    expect(parts.asks[9]).toEqual({ price: "2", size: "10", total: "100", depth: "1" });
  });

  it("keeps the best 10 of more than 10 bids, the highest price first", () => {
    // A bid gives RLUSD and wants XRP: 10 RLUSD for 5 XRP is 2, for 14 XRP 0.71428571. Its size is the XRP it wants.
    const bids = book(Array.from({ length: 12 }, (_, at) => offer(rlusd("10"), xrp(String(5 + at)))));
    const parts = bookOf(book([]), bids);
    expect(parts.bids).toHaveLength(10);
    expect(parts.bids.map((level) => level.size)).toEqual(["5", "6", "7", "8", "9", "10", "11", "12", "13", "14"]);
    expect(parts.bids[0]).toEqual({ price: "2", size: "5", total: "5", depth: depthOf(5, 95) });
    expect(parts.bids[1]!.price).toBe("1.6666667");
    expect(parts.bids[9]!.price).toBe("0.71428571");
    expect(parts.bids[9]!.depth).toBe("1");
  });

  it("sorts the levels itself: an answer out of order still gives asks ascending and bids descending", () => {
    const asks = book([offer(xrp("10"), rlusd("15")), offer(xrp("10"), rlusd("12")), offer(xrp("10"), rlusd("13"))]);
    const bids = book([offer(rlusd("10"), xrp("10")), offer(rlusd("12"), xrp("10")), offer(rlusd("11"), xrp("10"))]);
    const parts = bookOf(asks, bids);
    expect(parts.asks.map((level) => level.price)).toEqual(["1.2", "1.3", "1.5"]);
    expect(parts.bids.map((level) => level.price)).toEqual(["1.2", "1.1", "1"]);
    // The totals run from the best price out.
    expect(parts.asks.map((level) => level.total)).toEqual(["10", "20", "30"]);
    expect(parts.bids.map((level) => level.total)).toEqual(["10", "20", "30"]);
  });

  it("totals the levels cumulatively from the best price out, sizes and totals as compact numbers", () => {
    const asks = book([offer(xrp("10"), rlusd("11")), offer(xrp("20.5"), rlusd("24")), offer(xrp("30000"), rlusd("40000"))]);
    const parts = bookOf(asks, book([]));
    expect(parts.asks.map((level) => level.size)).toEqual(["10", "20.5", "30K"]);
    expect(parts.asks.map((level) => level.total)).toEqual(["10", "30.5", "30K"]);
    expect(parts.asks.map((level) => level.depth)).toEqual([
      depthOf(10, "30030.5"),
      depthOf("30.5", "30030.5"),
      "1",
    ]);
  });

  it("merges the offers whose prices read the same at 8 significant digits, not only equal prices", () => {
    // 1.300000001 and 1.300000004 are 1.3 at 8 digits; 1.30000005 is 1.3000001.
    const asks = book([
      offer(xrp("1000000000"), rlusd("1300000001")),
      offer(xrp("1000000000"), rlusd("1300000004")),
      offer(xrp("1000000"), rlusd("1300000.05")),
    ]);
    const parts = bookOf(asks, book([]));
    expect(parts.asks.map((level) => [level.price, level.size])).toEqual([
      ["1.3", "2B"],
      ["1.3000001", "1M"],
    ]);
  });

  it("merges the offers of one price wherever they stand in the answer", () => {
    const asks = book([offer(xrp("10"), rlusd("13")), offer(xrp("10"), rlusd("14")), offer(xrp("5"), rlusd("6.5"))]);
    const parts = bookOf(asks, book([]));
    expect(parts.asks.map((level) => [level.price, level.size, level.total])).toEqual([
      ["1.3", "15", "15"],
      ["1.4", "10", "25"],
    ]);
  });

  it("takes the price from the full amounts, whatever is funded", () => {
    // Funded 40 of 100 XRP and 10 of 130 RLUSD: the funded ratio would be 0.25, the offer's price is 1.3.
    const asks = book([offer(xrp("100"), rlusd("130"), { getsFunded: xrp("40"), paysFunded: rlusd("10") })]);
    const bids = book([offer(rlusd("125"), xrp("100"), { getsFunded: rlusd("1"), paysFunded: xrp("60") })]);
    const parts = bookOf(asks, bids);
    expect(parts.asks).toEqual([{ price: "1.3", size: "40", total: "40", depth: depthOf(40, 60) }]);
    expect(parts.bids).toEqual([{ price: "1.25", size: "60", total: "60", depth: "1" }]);
  });

  it("uses the full amount of a side that has no funded amount", () => {
    const asks = book([offer(xrp("100"), rlusd("130"), { paysFunded: rlusd("65") })]);
    const bids = book([offer(rlusd("125"), xrp("100"), { getsFunded: rlusd("62.5") })]);
    const parts = bookOf(asks, bids);
    expect(parts.asks[0]!.size).toBe("100");
    expect(parts.bids[0]!.size).toBe("100");
  });

  it("leaves an offer out when either funded amount is 0", () => {
    const asks = book([
      offer(xrp("10"), rlusd("12"), { getsFunded: xrp("0") }),
      offer(xrp("10"), rlusd("12.1"), { paysFunded: rlusd("0") }),
      offer(xrp("10"), rlusd("12.2"), { getsFunded: xrp("0"), paysFunded: rlusd("0") }),
      offer(xrp("10"), rlusd("12.3")),
    ]);
    const bids = book([
      offer(rlusd("12"), xrp("10"), { paysFunded: xrp("0") }),
      offer(rlusd("11.9"), xrp("10"), { getsFunded: rlusd("0") }),
      offer(rlusd("11.8"), xrp("10")),
    ]);
    const parts = bookOf(asks, bids);
    expect(parts.asks.map((level) => level.price)).toEqual(["1.23"]);
    expect(parts.bids.map((level) => level.price)).toEqual(["1.18"]);
    expect(parts.spread).toBe("0.05");
  });

  it("leaves an offer out that cannot be drawn: an amount of nothing, below nothing, or no number", () => {
    const asks = book([
      offer(xrp("0"), rlusd("12")),
      offer(xrp("10"), rlusd("0")),
      offer(xrp("10"), rlusd("12"), { getsFunded: xrp("-1") }),
      offer(xrp("abc"), rlusd("1")),
      offer(xrp("10"), rlusd("13")),
    ]);
    expect(bookOf(asks, book([])).asks.map((level) => level.price)).toEqual(["1.3"]);
  });

  it("has no level, and no spread, on a side whose every offer is funded nothing", () => {
    const parts = bookOf(book([offer(xrp("10"), rlusd("13"), { getsFunded: xrp("0") })]), BIDS);
    expect(parts.asks).toEqual([]);
    expect(parts.bids).toEqual([{ price: "1.25", size: "100", total: "100", depth: "1" }]);
    expect(parts.spread).toBe(DASH);
  });

  it("has no spread when a side is empty, and a depth for the side that has levels", () => {
    expect(bookOf(book([]), BIDS)).toMatchObject({ asks: [], spread: DASH, bids: [{ price: "1.25", depth: "1" }] });
    expect(bookOf(ASKS, book([]))).toMatchObject({ bids: [], spread: DASH, asks: [{ price: "1.3", depth: "1" }] });
    expect(bookOf(book([]), book([]))).toMatchObject({ asks: [], bids: [], spread: DASH });
  });

  it("has no spread when the book is crossed or the best prices are equal", () => {
    const crossed = bookOf(book([offer(xrp("10"), rlusd("12"))]), BIDS);
    expect(crossed.asks[0]!.price).toBe("1.2");
    expect(crossed.bids[0]!.price).toBe("1.25");
    expect(crossed.spread).toBe(DASH);
    expect(bookOf(book([offer(xrp("10"), rlusd("12.5"))]), BIDS).spread).toBe(DASH);
  });

  it("has no spread when the best prices read the same at 8 digits though the exact ones differ", () => {
    // 1.300000004 and 1.300000001 both read 1.3, which is what the page shows: a spread shown beside them would be of nothing.
    const parts = bookOf(book([offer(xrp("1000000000"), rlusd("1300000004"))]), book([offer(rlusd("1300000001"), xrp("1000000000"))]));
    expect(parts.asks[0]!.price).toBe("1.3");
    expect(parts.bids[0]!.price).toBe("1.3");
    expect(parts.spread).toBe(DASH);
  });

  it("writes the spread at 8 significant digits, half up, grouped", () => {
    const wide = bookOf(book([offer(xrp("1"), rlusd("1234.5678"))]), book([offer(rlusd("2.5"), xrp("1"))]));
    expect(wide.asks[0]!.price).toBe("1,234.5678");
    expect(wide.spread).toBe("1,232.0678");
    // 12.345678 − 0.0001225 = 12.3455555, which is 12.345556 at 8 digits.
    const half = bookOf(book([offer(xrp("1000000"), rlusd("12345678"))]), book([offer(rlusd("1225"), xrp("10000000"))]));
    expect(half.asks[0]!.price).toBe("12.345678");
    expect(half.bids[0]!.price).toBe("0.0001225");
    expect(half.spread).toBe("12.345556");
  });

  it("names the ledger as the lower of the two, grouped", () => {
    expect(bookOf(book([A], 107_721_456), book([D], 107_721_455)).ledger).toBe("107,721,455");
    expect(bookOf(book([A], 107_721_455), book([D], 107_721_456)).ledger).toBe("107,721,455");
    expect(bookOf(book([A], 999), book([D], 999)).ledger).toBe("999");
    expect(bookOf(book([], 5_000), book([], 1_000_000)).ledger).toBe("5,000");
  });

  it("gives a token that is stable for the same books and changes with anything drawn", () => {
    const token = bookOf(ASKS, BIDS).token;
    expect(token).toMatch(/^[0-9a-f]{8}$/);
    expect(bookOf(ASKS, BIDS).token).toBe(token);
    // The same books in other objects.
    expect(bookOf(book([A, B, C]), book([D])).token).toBe(token);
    const changed: Record<string, string> = {
      "a price": bookOf(book([A, B, offer(xrp("10"), rlusd("14"))]), BIDS).token,
      "a size": bookOf(book([A, offer(xrp("201"), rlusd("261.3")), C]), BIDS).token,
      "a bid": bookOf(ASKS, book([offer(rlusd("125"), xrp("101"))])).token,
      "an empty side": bookOf(ASKS, book([])).token,
      "swapped sides": bookOf(BIDS, ASKS).token,
      // The same levels on the ask side; only the depth scale (the bids) moved.
      "the depth scale": bookOf(ASKS, book([offer(rlusd("625"), xrp("500"))])).token,
    };
    for (const [what, other] of Object.entries(changed)) expect(other, what).not.toBe(token);
    expect(new Set(Object.values(changed)).size).toBe(Object.keys(changed).length);
  });

  it("changes the token when only an ask does, under a bid side that sets the depth scale", () => {
    const deep = book([offer(rlusd("1000"), xrp("1000"))]);
    const [before, after] = [bookOf(book([offer(xrp("10"), rlusd("13"))]), deep), bookOf(book([offer(xrp("10"), rlusd("14"))]), deep)];
    expect(after.bids).toEqual(before.bids);
    expect(after.token).not.toBe(before.token);
  });

  it("keeps the token of a book whose levels have not changed when only the ledger has", () => {
    const token = bookOf(ASKS, BIDS).token;
    // The ledger shown is the lower of the two: either one moving changes it, and neither moves the token.
    const older = bookOf(book([A, B, C], 107_721_453), BIDS);
    const newer = bookOf(book([A, B, C], 107_721_460), book([D], 107_721_470));
    expect(older.ledger).toBe("107,721,453");
    expect(newer.ledger).toBe("107,721,460");
    expect(bookOf(ASKS, book([D], 107_721_454)).ledger).toBe("107,721,454");
    for (const same of [older, newer, bookOf(ASKS, book([D], 107_721_454))]) expect(same.token).toBe(token);
    // The token is of what is drawn: one offer of the same price and size is the same level.
    expect(bookOf(book([offer(xrp("250"), rlusd("325"))], 1), BIDS).token).toBe(token);
  });

  describe("at the edges of what a ledger holds", () => {
    // rippled's amounts run from 1e-81 to 9999999999999999e80 (the node reader checks it), so a price is a ratio of two of them: 1e-177 to 1e177.
    const SMALLEST = `0.${"0".repeat(80)}1`;
    const LARGEST = `9999999999999999${"0".repeat(80)}`;

    it("writes a price of 1e177 in plain digits, and the sizes and depths with it", () => {
      const parts = bookOf(book([offer(xrp(SMALLEST), rlusd(LARGEST))]), book([offer(rlusd(LARGEST), xrp(SMALLEST))]));
      // 9999999999999999e80 ÷ 1e-81 = 9.999999999999999e176, which is 1.0000000e177 at 8 digits.
      const [ask, bid] = [parts.asks[0]!, parts.bids[0]!];
      expect(ask.price.replaceAll(",", "")).toBe(`1${"0".repeat(177)}`);
      expect(bid.price.replaceAll(",", "")).toBe(`1${"0".repeat(177)}`);
      expect(ask).toMatchObject({ size: SMALLEST, total: SMALLEST, depth: "1" });
      for (const text of [...Object.values(ask), ...Object.values(bid), parts.spread]) expect(text).not.toMatch(EXPONENT);
      // The two prices are equal: crossed.
      expect(parts.spread).toBe(DASH);
    });

    it("writes a price of 1e-177 in plain digits, and a size of 1e96 with it", () => {
      const parts = bookOf(book([offer(xrp(LARGEST), rlusd(SMALLEST))]), book([]));
      // 1e-81 ÷ 9.999999999999999e95 = 1.0000000000000001e-177: 1e-177 at 8 digits.
      expect(parts.asks[0]!.price).toBe(`0.${"0".repeat(176)}1`);
      expect(parts.asks[0]!.size).toMatch(/^1(,\d{3})+T$/);
      expect(parts.asks[0]!.size.replaceAll(",", "")).toBe(`1${"0".repeat(84)}T`);
      for (const text of Object.values(parts.asks[0]!)) expect(text).not.toMatch(EXPONENT);
    });

    it("gives the spread of the two extremes in plain digits", () => {
      const parts = bookOf(book([offer(xrp(SMALLEST), rlusd(LARGEST))]), book([offer(rlusd(SMALLEST), xrp(LARGEST))]));
      expect(parts.spread.replaceAll(",", "")).toBe(`1${"0".repeat(177)}`);
    });

    it("gets the 8 digits right where the quotient is not exact, whatever the size of the amounts", () => {
      // 2e-60 ÷ 3e70 = 6.6666667e-131: 80 places alone would keep none of it, so the division is made on the amounts scaled into [1, 10).
      const asks = book([offer(xrp(`3${"0".repeat(70)}`), rlusd(`0.${"0".repeat(59)}2`))]);
      expect(bookOf(asks, book([])).asks[0]!.price).toBe(`0.${"0".repeat(130)}66666667`);
      // 3e-60 ÷ 7e70 = 4.2857143e-131, rounded half up from 4.28571428…
      const rounded = book([offer(xrp(`7${"0".repeat(70)}`), rlusd(`0.${"0".repeat(59)}3`))]);
      expect(bookOf(rounded, book([])).asks[0]!.price).toBe(`0.${"0".repeat(130)}42857143`);
    });

    it("reads amounts of 98 characters", () => {
      const long = `${"9".repeat(40)}.${"1".repeat(57)}`;
      expect(long).toHaveLength(98);
      const parts = bookOf(book([offer(xrp(long), rlusd(long))]), book([]));
      expect(parts.asks[0]!.price).toBe("1");
      expect(parts.asks[0]!.size).toMatch(/^[\d,]+T$/);
      expect(parts.asks[0]!.size).not.toMatch(EXPONENT);
    });
  });
});

// ---- The recorded books ------------------------------------------------------------------------------------------------------------------------

type RawAmount = string | { currency: string; issuer: string; value: string };
interface RawOffer {
  Account: string;
  Sequence: number;
  TakerGets: RawAmount;
  TakerPays: RawAmount;
  taker_gets_funded?: RawAmount;
  taker_pays_funded?: RawAmount;
}

/** An amount as `node-rpc.ts` reads it: drops become whole units, an issued value is written out in plain digits. */
function amountOf(raw: RawAmount): NodeAmount {
  if (typeof raw === "string") return { currency: "XRP", value: dropsToNative(raw) };
  return { currency: raw.currency, issuer: raw.issuer, value: new BigNumber(raw.value).toFixed() };
}

/** A recorded answer to `book_offers` in the shape the node client gives it (the recording itself is pinned by market-fixtures.test.ts). */
function recorded(gets: FixtureAsset, pays: FixtureAsset): Book {
  const answer = JSON.parse(readFileSync(new URL(`../../test/fixtures/http/${bookFile({ net: "xrpl", gets, pays })}`, import.meta.url), "utf8")) as {
    result: { ledger_index: number; offers: RawOffer[] };
  };
  return {
    ledgerIndex: answer.result.ledger_index,
    offers: answer.result.offers.map((raw) => ({
      account: raw.Account,
      sequence: raw.Sequence,
      gets: amountOf(raw.TakerGets),
      pays: amountOf(raw.TakerPays),
      ...(raw.taker_gets_funded === undefined ? {} : { getsFunded: amountOf(raw.taker_gets_funded) }),
      ...(raw.taker_pays_funded === undefined ? {} : { paysFunded: amountOf(raw.taker_pays_funded) }),
    })),
  };
}

// The values below were worked out outside the code (Python's decimal module, 80 digits) from the recorded files.
describe("bookOf over the recorded books", () => {
  it("builds XRP / LIONS: a thin side of 3 offers, and a side of 37 offers of which 33 are funded nothing", () => {
    const [asksBook, bidsBook] = [recorded(XRP, LIONS), recorded(LIONS, XRP)];
    expect(asksBook.offers).toHaveLength(37);
    expect(bidsBook.offers).toHaveLength(3);
    const parts = bookOf(asksBook, bidsBook);
    expect(parts.ledger).toBe("107,780,245");
    // The bids' total, 23,372.273255, is the larger: the scale of both sides.
    const scale = new BN("23372.273255");
    expect(parts.bids).toEqual([
      { price: "1.0417752", size: "9,714.86", total: "9,714.86", depth: depthOf("9714.85993", scale) },
      { price: "1.0416667", size: "1,587.41", total: "11.3K", depth: depthOf("11302.273255", scale) },
      { price: "0.01", size: "12.1K", total: "23.4K", depth: "1" },
    ]);
    // The four offers that are funded: the last is 1 XRP at 100,000,000 LIONS.
    expect(parts.asks).toEqual([
      { price: "7,092.1986", size: "10", total: "10", depth: depthOf(10, scale) },
      { price: "7,246.3768", size: "6.82", total: "16.82", depth: depthOf("16.822751", scale) },
      { price: "7,633.5878", size: "0.384", total: "17.21", depth: depthOf("17.206943", scale) },
      { price: "100,000,000", size: "1", total: "18.21", depth: depthOf("18.206943", scale) },
    ]);
    // The best ask is far above the best bid, and the spread is of the two shown prices: 7092.1986 − 1.0417752.
    expect(parts.spread).toBe("7,091.1568");
  });

  it("builds XRP / RLUSD: 10 levels a side, in order, on one scale", () => {
    const parts = bookOf(recorded(XRP, RLUSD), recorded(RLUSD, XRP));
    expect(parts.ledger).toBe("107,780,245");
    expect(parts.asks).toHaveLength(10);
    expect(parts.bids).toHaveLength(10);
    expect(parts.asks[0]).toMatchObject({ price: "1.29643", size: "7,717.67", total: "7,717.67" });
    expect(parts.bids[0]).toEqual({ price: "1.2956", size: "1", total: "1", depth: depthOf(1, "10960.893152") });
    expect(parts.spread).toBe("0.00083");
    // Asks total 10,960.893152 and bids 2,368.322576: the asks reach the depth 1 and the bids a fraction of it.
    expect(parts.asks[9]).toMatchObject({ price: "1.297884", total: "11K", depth: "1" });
    expect(parts.bids[9]).toMatchObject({ price: "1.2943466", total: "2,368.32", depth: depthOf("2368.322576", "10960.893152") });
    for (const level of [...parts.asks, ...parts.bids]) {
      for (const text of Object.values(level)) expect(text).not.toMatch(EXPONENT);
    }
  });

  it("builds the inverted page, RLUSD / XRP, from the same two answers swapped", () => {
    const parts = bookOf(recorded(RLUSD, XRP), recorded(XRP, RLUSD));
    expect(parts.ledger).toBe("107,780,245");
    // The asks are the offers that give RLUSD: 1 ÷ 1.2956 XRP per RLUSD. The bids give XRP: 1.2956 ÷ ... the larger side is the bids, 14,212.449684083.
    expect(parts.asks[0]).toEqual({ price: "0.77184316", size: "1.3", total: "1.3", depth: depthOf("1.2956", "14212.449684083") });
    expect(parts.bids[0]).toMatchObject({ price: "0.77134901", size: "10K", total: "10K" });
    expect(parts.bids[9]).toMatchObject({ total: "14.2K", depth: "1" });
    expect(parts.asks[9]).toMatchObject({ total: "3,065.93", depth: depthOf("3065.92918233191525", "14212.449684083") });
    expect(parts.spread).toBe("0.00049415");
  });
});

// ---- The candles --------------------------------------------------------------------------------------------------------------------------------

const T = 1_792_256_472; // 2026-10-17T17:01:12Z, the recorded XRPL close time
const CODES = { base: "XRP", counter: "RLUSD" };

function candle(start: string, over: Partial<Candle> = {}): Candle {
  return {
    base_volume: "1250.5",
    buy_volume: 700,
    close: "1.3",
    close_time: start,
    count: 12,
    counter_volume: "1625.65",
    high: "1.31",
    low: "1.29",
    open: "1.295",
    open_time: start,
    start,
    vwap: "1.3",
    base_currency: "XRP",
    counter_currency: RLUSD_HEX,
    counter_issuer: RL,
    ...over,
  };
}

const page = (candles: Candle[]): Page<"exchanges", Candle> => ({ result: "success", count: candles.length, exchanges: candles });

describe("candleWindow", () => {
  it("is the one of the market parameters (P20: it stays there, and the pair view names it)", () => {
    expect(candleWindow).toBe(marketParamsWindow);
  });
});

describe("candlesOf", () => {
  const window = candleWindow(T, "1h");

  it("aligns the candles to the 60 buckets by `start`; a bucket without a candle is null", () => {
    const { data } = candlesOf(
      page([
        candle(window.buckets[59]!, { open: "1.31", high: "1.35", low: "1.3", close: "1.33", base_volume: "800", count: 4 }),
        candle(window.buckets[10]!, { open: "1.2", high: "1.4", low: "1.1", close: "1.25", base_volume: "5000.25", count: 40 }),
      ]),
      window,
      "1h",
      CODES,
    );
    expect(data.candles).toHaveLength(60);
    expect(data.candles[59]).toEqual({ o: "1.31", h: "1.35", l: "1.3", c: "1.33", v: "800", n: "4" });
    expect(data.candles[10]).toEqual({ o: "1.2", h: "1.4", l: "1.1", c: "1.25", v: "5000.25", n: "40" });
    expect(data.candles.flatMap((slot, at) => (slot === null ? [] : [at]))).toEqual([10, 59]);
    expect(data.axis).toEqual({ unit: "hour", buckets: window.buckets });
  });

  it("aligns candles given in any order, the first bucket and the last included", () => {
    const { data } = candlesOf(page([candle(window.buckets[59]!), candle(window.buckets[0]!), candle(window.buckets[30]!)]), window, "1h", CODES);
    expect(data.candles.flatMap((slot, at) => (slot === null ? [] : [at]))).toEqual([0, 30, 59]);
  });

  it("ignores a 61st candle that starts after the last bucket", () => {
    // The index is a moment ahead of T and the next hour has begun: limit=61 brings its candle, which is outside the axis.
    expect(window.buckets[59]).toBe("2026-10-17T17:00:00Z");
    const { data, empty } = candlesOf(page([candle(window.buckets[59]!, { close: "1.33" }), candle("2026-10-17T18:00:00Z", { close: "9.99" })]), window, "1h", CODES);
    expect(data.candles).toHaveLength(60);
    expect(data.candles[59]!.c).toBe("1.33");
    expect(JSON.stringify(data)).not.toContain("9.99");
    expect(empty).toBeNull();
  });

  it("is empty when the only candle is the 61st, or one before the first bucket, or one between two buckets", () => {
    for (const start of ["2026-10-17T18:00:00Z", "2026-10-15T05:00:00Z", "2026-10-16T08:30:00Z"]) {
      const { data, empty } = candlesOf(page([candle(start)]), window, "1h", CODES);
      expect(data.candles.every((slot) => slot === null), start).toBe(true);
      expect(empty, start).toBe("No trades in these 60 hours");
    }
  });

  it("reads a start written with milliseconds as the same moment", () => {
    const { data } = candlesOf(page([candle("2026-10-17T16:00:00.000Z", { close: "1.4" })]), window, "1h", CODES);
    expect(data.candles[58]!.c).toBe("1.4");
  });

  it("keeps the first of two candles that start together", () => {
    const start = window.buckets[20]!;
    const { data } = candlesOf(page([candle(start, { close: "1.1" }), candle(start, { close: "1.2" })]), window, "1h", CODES);
    expect(data.candles[20]!.c).toBe("1.1");
  });

  it("gives the API's text for the prices and the volume as it is, an exponent text included", () => {
    const { data } = candlesOf(
      page([candle(window.buckets[59]!, { open: "1.0000000e-7", high: "1.2345679e+8", low: "5.0000000e-8", close: "0.40990000", base_volume: "1e+21", count: 1 })]),
      window,
      "1h",
      CODES,
    );
    // The kit reads these texts and writes its own labels from them with `formatPrice` and `formatAmount`.
    expect(data.candles[59]).toEqual({ o: "1.0000000e-7", h: "1.2345679e+8", l: "5.0000000e-8", c: "0.40990000", v: "1e+21", n: "1" });
  });

  it("marks the newest bucket as the running one and names the units", () => {
    const { data } = candlesOf(page([candle(window.buckets[59]!)]), window, "1h", CODES);
    expect(data.forming).toBe(true);
    expect(data.format).toEqual({ kind: "price", unit: "RLUSD" });
    expect(data.volume).toEqual({ kind: "amount", unit: "XRP" });
  });

  it("marks the newest bucket as running when it has no candle either", () => {
    expect(candlesOf(page([candle(window.buckets[3]!)]), window, "1h", CODES).data.forming).toBe(true);
  });

  it("uses the axis unit of the interval, over the window it is given", () => {
    const units: [Interval, string][] = [
      ["15m", "minute"],
      ["1h", "hour"],
      ["4h", "hour"],
      ["1d", "day"],
      ["1w", "week"],
    ];
    for (const [interval, unit] of units) {
      const of = candleWindow(T, interval);
      const { data } = candlesOf(page([candle(of.buckets[59]!)]), of, interval, CODES);
      expect(data.axis.unit, interval).toBe(unit);
      expect(data.axis.buckets, interval).toEqual(of.buckets);
      expect(data.candles, interval).toHaveLength(60);
      expect(data.candles[59], interval).not.toBeNull();
    }
  });

  it("aligns the weeks from Monday and the four-hour blocks from midnight", () => {
    const weeks = candleWindow(T, "1w");
    expect(weeks.buckets[59]).toBe("2026-10-12T00:00:00Z");
    const week = candlesOf(page([candle("2026-10-12T00:00:00Z"), candle("2026-10-05T00:00:00Z", { close: "1.1" })]), weeks, "1w", CODES).data;
    expect(week.candles[59]).not.toBeNull();
    expect(week.candles[58]!.c).toBe("1.1");
    const blocks = candleWindow(T, "4h");
    expect(candlesOf(page([candle("2026-10-17T16:00:00Z")]), blocks, "4h", CODES).data.candles[59]).not.toBeNull();
    // The 15:00 hour is not a four-hour bucket.
    expect(candlesOf(page([candle("2026-10-17T15:00:00Z")]), blocks, "4h", CODES).data.candles.every((slot) => slot === null)).toBe(true);
  });

  it("says there was no trade, in the words of the window, when no candle is drawn", () => {
    const words: [Interval, string][] = [
      ["15m", "No trades in these 15 hours"],
      ["1h", "No trades in these 60 hours"],
      ["4h", "No trades in these 10 days"],
      ["1d", "No trades in these 60 days"],
      ["1w", "No trades in these 60 weeks"],
    ];
    for (const [interval, text] of words) {
      const result = candlesOf(page([]), candleWindow(T, interval), interval, CODES);
      expect(result.empty, interval).toBe(text);
      expect(text).toBe(`No trades in these ${INTERVALS[interval].span}`);
      expect(result.data.candles, interval).toHaveLength(60);
      expect(result.data.candles.every((slot) => slot === null)).toBe(true);
    }
  });

  it("is not empty once a candle is drawn", () => {
    expect(candlesOf(page([candle(window.buckets[3]!)]), window, "1h", CODES).empty).toBeNull();
  });

  it("gives a token that is stable for the same data and changes with any drawn value", () => {
    const [start, other] = [window.buckets[59]!, window.buckets[40]!];
    const token = (candles: Candle[], of = window, codes = CODES): string => candlesOf(page(candles), of, "1h", codes).data.token;
    const base = token([candle(start), candle(other)]);
    expect(base).toMatch(/^[0-9a-f]{8}$/);
    expect(token([candle(start), candle(other)])).toBe(base);
    // What is not drawn does not move it.
    expect(token([candle(start, { vwap: "9", buy_volume: 1, counter_volume: "7", close_time: "2026-10-17T17:00:30Z" }), candle(other)])).toBe(base);
    const changed: Record<string, string> = {
      open: token([candle(start, { open: "1.296" }), candle(other)]),
      high: token([candle(start, { high: "1.32" }), candle(other)]),
      low: token([candle(start, { low: "1.28" }), candle(other)]),
      close: token([candle(start, { close: "1.301" }), candle(other)]),
      volume: token([candle(start, { base_volume: "1250.6" }), candle(other)]),
      count: token([candle(start, { count: 13 }), candle(other)]),
      "a slot": token([candle(start), candle(window.buckets[41]!)]),
      "a gap filled": token([candle(start), candle(other), candle(window.buckets[39]!)]),
      "a candle gone": token([candle(start)]),
      "the next bucket": token([candle(start), candle(other)], candleWindow(T + 3600, "1h")),
      // No candle at all, and only the axis moves.
      "an empty axis": token([]),
      "an empty axis, a bucket later": token([], candleWindow(T + 3600, "1h")),
      "the price unit": token([candle(start), candle(other)], window, { base: "XRP", counter: "USD" }),
      "the volume unit": token([candle(start), candle(other)], window, { base: "XAH", counter: "RLUSD" }),
    };
    for (const [what, value] of Object.entries(changed)) expect(value, what).not.toBe(base);
    expect(new Set(Object.values(changed)).size).toBe(Object.keys(changed).length);
  });

  it("changes neither the page nor the window it is given", () => {
    const given = page([candle(window.buckets[59]!), candle("2026-10-17T18:00:00Z")]);
    const before = JSON.stringify([given, window]);
    const { data } = candlesOf(given, window, "1h", CODES);
    expect(JSON.stringify([given, window])).toBe(before);
    expect(data.axis.buckets).not.toBe(window.buckets);
  });
});

// ---- The pair page: the head, the trades, the stats, the pool, the traders, existence and the page ---------------------------------------

const GH = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const BS = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const TX = "76018ADC532CD195BE2ACEF9D4B4D1CB32D93FD4BE9ACC2693C9B856D1D8D8AB";
const UNDECODABLE = "0123456789ABCDEF0123456789ABCDEF01234567";
const LP_TOKEN = "03F5BC4D66B44AEAD668A84F094E08C8C13F5EE2";

const XRP_ASSET: Asset = { currency: "XRP" };
const USD_ASSET: Asset = { currency: "USD", issuer: GH };
const EUR_ASSET: Asset = { currency: "EUR", issuer: BS };

const FEATURES = { validators: false, ammData: true, markets: true };
const XRPL: PairInput["network"] = { id: "xrpl", name: "XRPL", native: "XRP", hasAmm: true, features: FEATURES };
const XRPL_AMM_OFF: PairInput["network"] = { ...XRPL, features: { ...FEATURES, ammData: false } };
/** The switch is "on" at the top level of every environment, Xahau's included: `hasAmm` is what rules there. */
const XAHAU: PairInput["network"] = { id: "xahau", name: "Xahau", native: "XAH", hasAmm: false, features: FEATURES };

const DEFAULT_PARAMS: PairParams = { interval: "1h", trades: null, back: [] };
const usd = (value: string): NodeAmount => ({ currency: "USD", issuer: GH, value });

const ok = <T>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED: Loaded<never> = { state: "failed" };
const MISSING: Loaded<never> = { state: "missing" };

/** A trade of XRP / USD: the taker is the buyer, no swap. */
function trade(over: Partial<PairExchange> = {}): PairExchange {
  return {
    base_amount: "1250.5",
    counter_amount: "3050.2",
    node_index: 3,
    rate: "2.4393",
    tx_index: 12,
    buyer: "rBuyer",
    executed_time: "2026-10-17T15:42:51Z",
    ledger_index: 107_721_455,
    offer_sequence: 4455,
    provider: "rBuyer",
    seller: "rSeller",
    taker: "rBuyer",
    tx_hash: TX,
    tx_type: "OfferCreate",
    base_currency: "XRP",
    counter_currency: "USD",
    counter_issuer: GH,
    ...over,
  };
}

const tradePage = (rows: PairExchange[], marker?: string): Page<"exchanges", PairExchange> => ({
  result: "success",
  count: rows.length,
  ...(marker === undefined ? {} : { marker }),
  exchanges: rows,
});

/** The one row of `reduce=true` for a window of 694 trades. */
function reduced(over: Partial<ReducedRow> = {}): ReducedRow {
  return {
    open: "2.3952",
    high: "2.4501",
    low: "2.3790",
    close: "2.4393",
    base_volume: "1000",
    counter_volume: "2439.3",
    buy_volume: 400,
    count: 694,
    open_time: "2026-10-16T17:03:00Z",
    close_time: "2026-10-17T16:58:00Z",
    vwap: "2.4250",
    start: "2026-10-16T17:01:00Z",
    base_currency: "XRP",
    counter_currency: "USD",
    counter_issuer: GH,
    ...over,
  };
}

/** The one row of a window without a trade: all zeros, and no open_time or close_time. */
function nothing(): ReducedRow {
  const { open_time: _openTime, close_time: _closeTime, ...rest } = reduced();
  return { ...rest, open: "0.0000000", high: "0.0000000", low: "0.0000000", close: "0.0000000", vwap: "0.0000000", base_volume: "0", counter_volume: "0", buy_volume: 0, count: 0 };
}

/** The pool of XRP / USD: 1,800,000 XRP against 4,390,740 USD, a 0.300% fee. */
function poolInfo(over: Partial<AmmInfo> = {}): AmmInfo {
  return {
    account: POOL,
    amount: xrp("1800000"),
    amount2: usd("4390740"),
    lp_token: { currency: LP_TOKEN, issuer: POOL, value: "2810000" },
    trading_fee: 300,
    vote_slots: [],
    ledger_index: 107_780_245,
    ...over,
  };
}

/** A trader of the pair: `r1QQQ…`, `r2QQQ…`, so that the short forms differ. */
const trader = (n: number): string => `r${n}${"Q".repeat(30)}`;

function activeAccount(account: string, baseVolume: string, count: number): ActiveAccount {
  const side = { base_volume: "0", counter_volume: "0", count: 0 };
  return { buy: side, sell: side, account, base_volume: baseVolume, counter_volume: "0", count };
}

const active = (accounts: ActiveAccount[], count = accounts.length): ActiveAccounts => ({ result: "success", count, exchanges_count: 9999, accounts });

/** Seven traders, the largest first: 7M XRP and 390 trades down to 1M XRP and 330. */
const TRADERS = [1, 2, 3, 4, 5, 6, 7].map((n) => activeAccount(trader(n), String((8 - n) * 1_000_000), 400 - n * 10));

const HEAD = pairHead(XRPL, XRP_ASSET, USD_ASSET, DEFAULT_PARAMS);
const PAIR = `/xrpl/markets/XRP/USD.${GH}`;
const INVERTED = `/xrpl/markets/USD.${GH}/XRP`;

describe("pairHead", () => {
  it("writes XRP / USD: the codes, the issuer, the native side and the links", () => {
    expect(pairHead(XRPL, XRP_ASSET, USD_ASSET, DEFAULT_PARAMS)).toEqual({
      title: "XRP/USD",
      heading: "XRP / USD",
      base: "XRP",
      counter: "USD",
      issuers: [{ code: "USD", address: GH, href: `/xrpl/account/${GH}` }],
      natives: ["XRP"],
      issued: ["USD rhub8V…F3wq"],
      issuedBy: "USD issued by rhub8V…F3wq",
      invert: { label: "Show USD/XRP", href: INVERTED },
      firstPage: PAIR,
    });
  });

  it("is the page as it is asked for: the inverted pair has its own heading and links back to the natural one", () => {
    const head = pairHead(XRPL, USD_ASSET, XRP_ASSET, DEFAULT_PARAMS);
    expect(head).toMatchObject({ title: "USD/XRP", heading: "USD / XRP", base: "USD", counter: "XRP", natives: ["XRP"], issuedBy: "USD issued by rhub8V…F3wq" });
    expect(head.invert).toEqual({ label: "Show XRP/USD", href: PAIR });
    expect(head.firstPage).toBe(INVERTED);
  });

  it("keeps the interval and the Trades filter in the link to the other way round, and the filter alone in the first page", () => {
    const head = pairHead(XRPL, XRP_ASSET, USD_ASSET, { interval: "4h", trades: "amm", back: [] });
    expect(head.invert.href).toBe(`${INVERTED}?interval=4h&trades=amm`);
    expect(head.firstPage).toBe(`${PAIR}?trades=amm`);
    expect(pairHead(XRPL, XRP_ASSET, USD_ASSET, { interval: "1w", trades: null, back: [] }).invert.href).toBe(`${INVERTED}?interval=1w`);
  });

  it("does not keep a marker or a trail: the other way round and the first page are first pages", () => {
    const head = pairHead(XRPL, XRP_ASSET, USD_ASSET, { interval: "1h", trades: "book", marker: "M1", back: ["M0"] });
    expect(head.invert.href).toBe(`${INVERTED}?trades=book`);
    expect(head.firstPage).toBe(`${PAIR}?trades=book`);
  });

  it("names a Trades filter only where the network has the AMM parts: not on Xahau, not while AMM_DATA is off", () => {
    const params: PairParams = { interval: "1h", trades: "amm", back: [] };
    expect(pairHead(XRPL_AMM_OFF, XRP_ASSET, USD_ASSET, params).firstPage).toBe(PAIR);
    expect(pairHead(XRPL_AMM_OFF, XRP_ASSET, USD_ASSET, params).invert.href).toBe(INVERTED);
    const xahau = pairHead(XAHAU, { currency: "XAH" }, USD_ASSET, params);
    expect(xahau).toMatchObject({ title: "XAH/USD", natives: ["XAH"], firstPage: `/xahau/markets/XAH/USD.${GH}` });
    expect(xahau.invert.href).toBe(`/xahau/markets/USD.${GH}/XAH`);
    expect(xahau.issuers[0]!.href).toBe(`/xahau/account/${GH}`);
  });

  it("lists both issuers, base first, when both sides are issued, and has no native side", () => {
    const head = pairHead(XRPL, EUR_ASSET, USD_ASSET, DEFAULT_PARAMS);
    expect(head.natives).toEqual([]);
    expect(head.issuers.map((issuer) => [issuer.code, issuer.address])).toEqual([
      ["EUR", BS],
      ["USD", GH],
    ]);
    expect(head.issued).toEqual(["EUR rvYAfW…s59B", "USD rhub8V…F3wq"]);
    expect(head.issuedBy).toBe("EUR issued by rvYAfW…s59B, USD issued by rhub8V…F3wq");
  });

  it("writes an undecodable hex code in full in the issuers, and as the display code (its first 8 digits) elsewhere", () => {
    const head = pairHead(XRPL, { currency: UNDECODABLE, issuer: BS }, XRP_ASSET, DEFAULT_PARAMS);
    expect(head.base).toBe("01234567…");
    expect(head.heading).toBe("01234567… / XRP");
    expect(head.issuers).toEqual([{ code: UNDECODABLE, address: BS, href: `/xrpl/account/${BS}` }]);
    expect(head.issued).toEqual(["01234567… rvYAfW…s59B"]);
    // A code the ledger holds in lower case is written as it is held: upper case.
    expect(pairHead(XRPL, { currency: UNDECODABLE.toLowerCase(), issuer: BS }, XRP_ASSET, DEFAULT_PARAMS).issuers[0]!.code).toBe(UNDECODABLE);
  });

  it("shows a decodable hex code as its text, and an LP token as \"LP token\"", () => {
    expect(pairHead(XRPL, { currency: RLUSD_HEX, issuer: RL }, XRP_ASSET, DEFAULT_PARAMS)).toMatchObject({
      title: "RLUSD/XRP",
      issuers: [{ code: "RLUSD", address: RL }],
    });
    const lp = pairHead(XRPL, { currency: LP_TOKEN, issuer: POOL }, XRP_ASSET, DEFAULT_PARAMS);
    expect(lp).toMatchObject({ heading: "LP token / XRP", base: "LP token", issuers: [{ code: "LP token", address: POOL }] });
  });

  it("writes no control or bidi character that the asset text did not hold: a code of control bytes is shown as hex", () => {
    const head = pairHead(XRPL, { currency: "0700202E202E0000000000000000000000000000", issuer: BS }, XRP_ASSET, DEFAULT_PARAMS);
    expect(head.base).toBe("0700202E…");
    expect(JSON.stringify(head)).not.toMatch(/[\p{Cc}‪-‮⁦-⁩]/u);
  });
});

describe("tradesOf", () => {
  const CTX = { net: "xrpl", base: XRP_ASSET, counter: USD_ASSET, params: DEFAULT_PARAMS, via: true };

  it("writes a row: its key, the UTC time, the link to the transaction with its hidden name, the side, the price, exact amounts and the taker", () => {
    expect(tradesOf(tradePage([trade()]), CTX).rows).toEqual([
      {
        key: "107721455:12:3",
        time: "2026-10-17 15:42:51",
        txHref: `/xrpl/tx/${TX}`,
        txHidden: ", transaction 76018A…D8AB",
        side: "Buy",
        dot: "up",
        price: "2.4393",
        base: "1,250.5",
        counter: "3,050.2",
        taker: "rBuyer",
        via: "Book",
      },
    ]);
  });

  it("takes the side of the taker: Buy for the buyer, Sell for the seller, a dash for neither", () => {
    const view = tradesOf(
      tradePage([trade({ taker: "rBuyer" }), trade({ taker: "rSeller", node_index: 4 }), trade({ taker: "rBroker", node_index: 5 })]),
      CTX,
    );
    expect(view.rows.map((row) => [row.side, row.dot])).toEqual([
      ["Buy", "up"],
      ["Sell", "down"],
      ["—", null],
    ]);
  });

  it("reads a taker that is the buyer and the seller (a trade with oneself) as Buy", () => {
    const [row] = tradesOf(tradePage([trade({ taker: "rSelf", buyer: "rSelf", seller: "rSelf" })]), CTX).rows;
    expect(row).toMatchObject({ side: "Buy", dot: "up", taker: "rSelf" });
  });

  it("tags Via: AMM for a swap (the API puts the pool in amm_account), Book otherwise, and nothing while the AMM parts are off", () => {
    const page = tradePage([trade({ amm_account: POOL, node_index: 1 }), trade({ node_index: 2 })]);
    expect(tradesOf(page, CTX).rows.map((row) => row.via)).toEqual(["AMM", "Book"]);
    expect(tradesOf(page, { ...CTX, via: false }).rows.map((row) => row.via)).toEqual([null, null]);
  });

  it("keys a row by ledger_index:tx_index:node_index, which is unique", () => {
    const page = tradePage([trade({ ledger_index: 10, tx_index: 2, node_index: 1 }), trade({ ledger_index: 10, tx_index: 2, node_index: 2 }), trade({ ledger_index: 10, tx_index: 3, node_index: 1 })]);
    const keys = tradesOf(page, CTX).rows.map((row) => row.key);
    expect(keys).toEqual(["10:2:1", "10:2:2", "10:3:1"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("writes the price with formatPrice (8 significant digits, never an exponent) and the amounts in full", () => {
    const [row] = tradesOf(
      tradePage([trade({ rate: "1.2000000e-7", base_amount: "1234567.891234", counter_amount: "0.000148148", executed_time: "2026-01-02T03:04:05Z" })]),
      CTX,
    ).rows;
    expect(row).toMatchObject({ price: "0.00000012", base: "1,234,567.891234", counter: "0.000148148", time: "2026-01-02 03:04:05" });
    const [big] = tradesOf(tradePage([trade({ rate: "1.2345679e+8" })]), CTX).rows;
    expect(big!.price).toBe("123,456,790");
  });

  it("has no paging on a first page of one page, and an Older link when the API gave a marker", () => {
    expect(tradesOf(tradePage([trade()]), CTX).paging).toEqual({ newerHref: null, olderHref: null });
    expect(tradesOf(tradePage([trade()], "M1"), CTX).paging).toEqual({ newerHref: null, olderHref: `${PAIR}?marker=M1` });
  });

  it("pages from a marker with the way back in the URL, keeping the Trades filter", () => {
    const params = (marker: string, back: string[]): PairParams => ({ interval: "1h", trades: "amm", marker, back });
    // The second page: Newer is the first page, which has no marker (the way trailPaging asks for it).
    expect(tradesOf(tradePage([trade()], "M2"), { ...CTX, params: params("M1", []) }).paging).toEqual({
      newerHref: `${PAIR}?trades=amm`,
      olderHref: `${PAIR}?trades=amm&marker=M2&back=M1`,
    });
    // The third: Newer is the second, and Older remembers both.
    expect(tradesOf(tradePage([trade()], "M3"), { ...CTX, params: params("M2", ["M1"]) }).paging).toEqual({
      newerHref: `${PAIR}?trades=amm&marker=M1`,
      olderHref: `${PAIR}?trades=amm&marker=M3&back=M2.M1`,
    });
    // The last page has no Older.
    expect(tradesOf(tradePage([trade()]), { ...CTX, params: params("M3", ["M2", "M1"]) }).paging).toEqual({
      newerHref: `${PAIR}?trades=amm&marker=M2&back=M1`,
      olderHref: null,
    });
  });

  it("pages the inverted pair in its own orientation", () => {
    const view = tradesOf(tradePage([trade()], "M1"), { ...CTX, base: USD_ASSET, counter: XRP_ASSET });
    expect(view.paging.olderHref).toBe(`${INVERTED}?marker=M1`);
  });

  it("names the route it came from: the list, with the filter's amm parameter when there is one", () => {
    expect(tradesOf(tradePage([]), CTX).source).toBe("/v2/exchanges/{base}/{counter}?descending=true");
    expect(tradesOf(tradePage([]), { ...CTX, params: { ...DEFAULT_PARAMS, trades: "book" } }).source).toBe("/v2/exchanges/{base}/{counter}?descending=true&amm=exclude");
    expect(tradesOf(tradePage([]), { ...CTX, params: { ...DEFAULT_PARAMS, trades: "amm" } }).source).toBe("/v2/exchanges/{base}/{counter}?descending=true&amm=only");
  });

  it("is an empty table, with no paging, for a page without a trade", () => {
    expect(tradesOf(tradePage([]), CTX)).toEqual({
      rows: [],
      paging: { newerHref: null, olderHref: null },
      source: "/v2/exchanges/{base}/{counter}?descending=true",
    });
  });
});

describe("statsOf", () => {
  const CODES_XRP_USD = { base: "XRP", counter: "USD" };

  it("labels the six figures and writes them: prices with formatPrice, volumes compact, the count grouped", () => {
    const stats = statsOf(reduced({ base_volume: "1600000", counter_volume: "3880000", count: 1204 }), CODES_XRP_USD);
    expect(stats.state).toBe("ok");
    expect(stats.items).toEqual([
      { label: "24 h high", value: "2.4501" },
      { label: "24 h low", value: "2.379" },
      { label: "VWAP 24 h", value: "2.425" },
      { label: "Volume XRP", value: "1.6M" },
      { label: "Volume USD", value: "3.88M" },
      { label: "Trades 24 h", value: "1,204" },
    ]);
    expect(stats.note).toBeNull();
  });

  it("labels the volumes with the codes it is given", () => {
    const stats = statsOf(reduced(), { base: "LP token", counter: "RLUSD" });
    expect(stats.items.map((item) => item.label).slice(3, 5)).toEqual(["Volume LP token", "Volume RLUSD"]);
  });

  it("writes a price in exponent form in plain digits", () => {
    const stats = statsOf(reduced({ high: "1.2345679e+8", low: "1.0000000e-7", vwap: "5.0000000e-7" }), CODES_XRP_USD);
    expect(stats.items.slice(0, 3).map((item) => item.value)).toEqual(["123,456,790", "0.0000001", "0.0000005"]);
  });

  it("reads a window without a trade as dashes for the prices and \"0\" for the volumes and the trades, with a note", () => {
    const stats = statsOf(nothing(), CODES_XRP_USD);
    expect(stats.items.map((item) => item.value)).toEqual(["—", "—", "—", "0", "0", "0"]);
    expect(stats.note).toBe("No trades in the last 24 hours.");
  });

  it("carries a token of what it draws: the same for the same figures, another for any change", () => {
    const token = (row: ReducedRow) => statsOf(row, CODES_XRP_USD).token;
    const base = token(reduced());
    expect(token(reduced())).toBe(base);
    for (const row of [reduced({ high: "2.46" }), reduced({ low: "2.37" }), reduced({ vwap: "2.43" }), reduced({ base_volume: "1001" }), reduced({ counter_volume: "2440" }), reduced({ count: 695 }), nothing()]) {
      expect(token(row)).not.toBe(base);
    }
    expect(statsOf(reduced(), { base: "XRP", counter: "EUR" }).token).not.toBe(base);
  });
});

describe("poolOf", () => {
  it("writes the pool card of XRP / USD: reserves, the spot price, the fee and the link", () => {
    expect(poolOf(poolInfo(), "xrpl", XRP_ASSET, USD_ASSET, HEAD)).toEqual({
      state: "ok",
      title: "XRP/USD AMM pool",
      source: "live from the node · amm_info · ledger #107,780,245",
      ledger: "107,780,245",
      reserves: "1.8M XRP · 4.39M USD",
      price: "2.4393",
      fee: "0.300%",
      link: { href: `/xrpl/account/${POOL}`, label: "Pool account →" },
      token: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
  });

  it("matches the pool's amounts to the page by asset: amount2 as the base is the same card", () => {
    const swapped = poolInfo({ amount: usd("4390740"), amount2: xrp("1800000") });
    expect(poolOf(swapped, "xrpl", XRP_ASSET, USD_ASSET, HEAD)).toEqual(poolOf(poolInfo(), "xrpl", XRP_ASSET, USD_ASSET, HEAD));
  });

  it("orients the card to the inverted page: USD / XRP shows the USD reserve first and the price in XRP per USD", () => {
    const head = pairHead(XRPL, USD_ASSET, XRP_ASSET, DEFAULT_PARAMS);
    for (const info of [poolInfo(), poolInfo({ amount: usd("4390740"), amount2: xrp("1800000") })]) {
      const card = poolOf(info, "xrpl", USD_ASSET, XRP_ASSET, head);
      expect(card).toMatchObject({ title: "USD/XRP AMM pool", reserves: "4.39M USD · 1.8M XRP", price: "0.40995368" });
    }
  });

  it("writes the fee as the node's units over 1000 with three decimals and a percent sign", () => {
    const fee = (trading_fee: number) => poolOf(poolInfo({ trading_fee }), "xrpl", XRP_ASSET, USD_ASSET, HEAD).fee;
    expect(fee(300)).toBe("0.300%");
    expect(fee(0)).toBe("0.000%");
    expect(fee(1000)).toBe("1.000%");
    expect(fee(1)).toBe("0.001%");
    expect(fee(35)).toBe("0.035%");
  });

  it("matches a pool of two issued currencies by currency and issuer", () => {
    const eur = { currency: "EUR", issuer: BS, value: "1000" };
    const head = pairHead(XRPL, EUR_ASSET, USD_ASSET, DEFAULT_PARAMS);
    const card = poolOf(poolInfo({ amount: usd("1090"), amount2: eur }), "xrpl", EUR_ASSET, USD_ASSET, head);
    expect(card).toMatchObject({ title: "EUR/USD AMM pool", reserves: "1,000 EUR · 1,090 USD", price: "1.09" });
  });

  it("has no price for a pool whose base reserve is nothing", () => {
    expect(poolOf(poolInfo({ amount: xrp("0") }), "xrpl", XRP_ASSET, USD_ASSET, HEAD)).toMatchObject({ price: "—", reserves: "0 XRP · 4.39M USD" });
    expect(poolOf(poolInfo({ amount2: usd("0") }), "xrpl", XRP_ASSET, USD_ASSET, HEAD)).toMatchObject({ price: "—" });
  });

  it("gets 8 digits right at any size: a price of 1e-30 and of 1e30 in plain digits", () => {
    const tiny = poolOf(poolInfo({ amount: xrp("1000000000000000"), amount2: usd("0.000000000000000000000000000001") }), "xrpl", XRP_ASSET, USD_ASSET, HEAD);
    expect(tiny.price).toBe(`0.${"0".repeat(44)}1`);
    expect(tiny.price).not.toMatch(EXPONENT);
    const huge = poolOf(poolInfo({ amount: xrp("0.000000000001"), amount2: usd("1000000000000000000") }), "xrpl", XRP_ASSET, USD_ASSET, HEAD);
    expect(huge.price.replaceAll(",", "")).toBe(`1${"0".repeat(30)}`);
  });

  it("links the pool account on the network of the page", () => {
    expect(poolOf(poolInfo(), "xahau", XRP_ASSET, USD_ASSET, HEAD).link.href).toBe(`/xahau/account/${POOL}`);
  });

  it("keeps the token of a pool whose figures have not changed when only the ledger has, and changes it with any figure", () => {
    const token = (info: AmmInfo) => poolOf(info, "xrpl", XRP_ASSET, USD_ASSET, HEAD).token;
    const base = token(poolInfo());
    expect(token(poolInfo({ ledger_index: 107_780_246 }))).toBe(base);
    for (const info of [
      poolInfo({ amount: xrp("1800001") }),
      poolInfo({ amount2: usd("4390741") }),
      poolInfo({ trading_fee: 301 }),
      poolInfo({ account: "rOtherPool" }),
      // The same price from twice the reserves: only the reserves differ.
      poolInfo({ amount: xrp("3600000"), amount2: usd("8781480") }),
    ]) {
      expect(token(info)).not.toBe(base);
    }
    expect(poolOf(poolInfo({ ledger_index: 107_780_246 }), "xrpl", XRP_ASSET, USD_ASSET, HEAD).ledger).toBe("107,780,246");
  });

  it("does not write a pool of another pair: the amounts must be the page's assets", () => {
    expect(() => poolOf(poolInfo({ amount2: { currency: "EUR", issuer: BS, value: "5" } }), "xrpl", XRP_ASSET, USD_ASSET, HEAD)).toThrow(/does not hold/);
  });
});

describe("tradersOf", () => {
  const CTX = { net: "xrpl", head: HEAD, filtered: false };
  const NOTE = "5 of 1,204 accounts that traded XRP/USD in the last 24 hours, by XRP volume. A trade counts for its buyer and its seller.";
  const POOL_SENTENCE = " The XRP/USD AMM pool, the other side of every swap, is left out.";

  it("shows the top 5 of the accounts with the account, its link, its base volume and its trades, and says how many there were", () => {
    const view = tradersOf(active(TRADERS, 1204), null, CTX);
    expect(view.state).toBe("ok");
    expect(view.data.items).toEqual([
      { id: trader(1), label: "r1QQQQ…QQQQ", href: `/xrpl/account/${trader(1)}`, value: "7000000", count: "390" },
      { id: trader(2), label: "r2QQQQ…QQQQ", href: `/xrpl/account/${trader(2)}`, value: "6000000", count: "380" },
      { id: trader(3), label: "r3QQQQ…QQQQ", href: `/xrpl/account/${trader(3)}`, value: "5000000", count: "370" },
      { id: trader(4), label: "r4QQQQ…QQQQ", href: `/xrpl/account/${trader(4)}`, value: "4000000", count: "360" },
      { id: trader(5), label: "r5QQQQ…QQQQ", href: `/xrpl/account/${trader(5)}`, value: "3000000", count: "350" },
    ]);
    expect(view.data.format).toEqual({ kind: "amount", unit: "XRP" });
    expect(view.note).toBe(NOTE);
  });

  it("leaves the pool account out when the node named it and it is among the accounts, and says so", () => {
    const accounts = [activeAccount(POOL, "9000000", 900), ...TRADERS];
    const view = tradersOf(active(accounts, 1204), POOL, CTX);
    expect(view.data.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5].map(trader));
    expect(view.note).toBe(NOTE + POOL_SENTENCE);
  });

  it("leaves it out wherever it stands in the list, even past the first 5", () => {
    const accounts = [...TRADERS.slice(0, 6), activeAccount(POOL, "500", 2)];
    const view = tradersOf(active(accounts, 800), POOL, CTX);
    expect(view.data.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5].map(trader));
    expect(view.note).toContain(POOL_SENTENCE);
  });

  it("keeps the pool account when the node did not name it (it failed, or there is no pool)", () => {
    const accounts = [activeAccount(POOL, "9000000", 900), ...TRADERS];
    const view = tradersOf(active(accounts, 1204), null, CTX);
    expect(view.data.items.map((item) => item.id)).toEqual([POOL, ...[1, 2, 3, 4].map(trader)]);
    expect(view.note).toBe(NOTE);
  });

  it("says nothing of the pool when it is named but is not among the accounts", () => {
    const view = tradersOf(active(TRADERS, 1204), POOL, CTX);
    expect(view.note).toBe(NOTE);
    expect(view.data.items).toHaveLength(5);
  });

  it("adds that the list has no filter when the page has a Trades filter, before the pool sentence", () => {
    const view = tradersOf(active([activeAccount(POOL, "9000000", 900), ...TRADERS], 1204), POOL, { ...CTX, filtered: true });
    expect(view.note).toBe(`${NOTE} All trades: this list has no filter.${POOL_SENTENCE}`);
    expect(tradersOf(active(TRADERS, 1204), null, { ...CTX, filtered: true }).note).toBe(`${NOTE} All trades: this list has no filter.`);
  });

  it("names the pair and the base the page shows, the inverted one included", () => {
    const head = pairHead(XRPL, USD_ASSET, XRP_ASSET, DEFAULT_PARAMS);
    const view = tradersOf(active(TRADERS, 1204), null, { ...CTX, head });
    expect(view.note).toBe("5 of 1,204 accounts that traded USD/XRP in the last 24 hours, by USD volume. A trade counts for its buyer and its seller.");
    expect(view.data.format).toEqual({ kind: "amount", unit: "USD" });
  });

  it("shows fewer than 5 when there are fewer, counting the accounts there are", () => {
    const view = tradersOf(active(TRADERS.slice(0, 3)), null, CTX);
    expect(view.data.items).toHaveLength(3);
    expect(view.note).toMatch(/^3 of 3 accounts that traded XRP\/USD/);
    expect(tradersOf(active(TRADERS.slice(0, 1)), null, CTX).note).toMatch(/^1 of 1 account that traded XRP\/USD/);
  });

  it("is an empty list for a pair nobody traded", () => {
    const view = tradersOf(active([], 0), null, CTX);
    expect(view.data.items).toEqual([]);
    expect(view.note).toMatch(/^0 of 0 accounts that traded XRP\/USD/);
  });

  it("carries a token of the list: the same for the same list, another for any change in it", () => {
    const token = (accounts: ActiveAccount[], pool: string | null = null) => tradersOf(active(accounts, 1204), pool, CTX).data.token;
    const base = token(TRADERS);
    expect(token(TRADERS)).toBe(base);
    expect(token([activeAccount(trader(1), "7000001", 390), ...TRADERS.slice(1)])).not.toBe(base);
    expect(token([activeAccount(trader(1), "7000000", 391), ...TRADERS.slice(1)])).not.toBe(base);
    expect(token([...TRADERS.slice(1), activeAccount(trader(8), "1", 1)])).not.toBe(base);
    expect(token([activeAccount(POOL, "9000000", 900), ...TRADERS], POOL)).toBe(base);
    // The same list in the unit of the other way round.
    const inverted = pairHead(XRPL, USD_ASSET, XRP_ASSET, DEFAULT_PARAMS);
    expect(tradersOf(active(TRADERS, 1204), null, { ...CTX, head: inverted }).data.token).not.toBe(base);
  });
});

describe("existenceOf", () => {
  const empty = ok(book([]));
  const withOffer = ok(book([offer(xrp("10"), usd("24"))]));
  const sides = (asks: Loaded<Book>, bids: Loaded<Book>) => ({ asks, bids });

  it("exists when the list has a trade, whatever the book or the filter", () => {
    expect(existenceOf([trade()], sides(empty, empty), false)).toBe("exists");
    expect(existenceOf([trade()], sides(FAILED, FAILED), false)).toBe("exists");
    expect(existenceOf([trade()], sides(empty, empty), true)).toBe("exists");
  });

  it("is an outage without a trade when either side of the book could not be read: it cannot be told from an empty market", () => {
    for (const [asks, bids] of [
      [FAILED, empty],
      [empty, FAILED],
      [FAILED, FAILED],
      [MISSING, empty],
      [withOffer, FAILED],
    ] as const) {
      expect(existenceOf([], sides(asks, bids), false)).toBe("outage");
      // With a filter too: the unfiltered list is not asked for when the book already cannot tell.
      expect(existenceOf([], sides(asks, bids), true)).toBe("outage");
    }
  });

  it("exists without a trade when either side of the book has an offer, with a filter or without", () => {
    expect(existenceOf([], sides(withOffer, empty), false)).toBe("exists");
    expect(existenceOf([], sides(empty, withOffer), false)).toBe("exists");
    expect(existenceOf([], sides(withOffer, withOffer), true)).toBe("exists");
  });

  it("is absent with no trade, both sides read and empty, and no filter", () => {
    expect(existenceOf([], sides(empty, empty), false)).toBe("absent");
  });

  it("asks for the unfiltered list when a filter shows no trade and the book is empty", () => {
    expect(existenceOf([], sides(empty, empty), true)).toBe("ask-unfiltered");
  });

  it("then goes by the unfiltered answer: a row exists, none is absent, a failure is an outage", () => {
    expect(existenceOf([], sides(empty, empty), true, ok(tradePage([trade()])))).toBe("exists");
    expect(existenceOf([], sides(empty, empty), true, ok(tradePage([])))).toBe("absent");
    expect(existenceOf([], sides(empty, empty), true, FAILED)).toBe("outage");
    expect(existenceOf([], sides(empty, empty), true, MISSING)).toBe("outage");
  });
});

// ---- The page ------------------------------------------------------------------------------------------------------------------------------

/** A page of XRP / USD in which everything is there: a trade, the 24 h figures, a candle, traders, the books, the pool and the AMM share. */
function pairInput(over: Partial<PairInput> = {}): PairInput {
  return {
    network: XRPL,
    base: XRP_ASSET,
    counter: USD_ASSET,
    params: DEFAULT_PARAMS,
    closeTime: T,
    trades: tradePage([trade()]),
    hasTrade: true,
    stats: ok(reduced()),
    candles: ok(page([candle(candleWindow(T, "1h").buckets[59]!)])),
    traders: ok(active(TRADERS, 1204)),
    asks: ok(book([offer(xrp("100"), usd("243.93"))])),
    bids: ok(book([offer(usd("243"), xrp("100"))])),
    pool: ok(poolInfo()),
    share: ok(reduced({ base_volume: "340" })),
    ...over,
  };
}

const build = (over: Partial<PairInput> = {}) => pairPage(pairInput(over));

describe("pairPage", () => {
  it("builds the page of XRP / USD from the answers", () => {
    const { page: built, problems } = build();
    expect(problems).toEqual([]);
    expect(built).toMatchObject({ mode: "live", head: HEAD, indexable: true, view: [], ammParts: true });
    expect(built.trades.rows).toHaveLength(1);
    expect(built.stats).toMatchObject({ state: "ok", note: null });
    expect(built.candles).toMatchObject({ state: "ok", source: "/v2/exchanges/{base}/{counter}?interval=1hour", empty: null });
    expect(built.book).toMatchObject({ state: "ok", ledger: "107,721,455", spread: "0.0093", asks: [{ price: "2.4393" }], bids: [{ price: "2.43" }] });
    expect(built.pool).toMatchObject({ state: "ok", title: "XRP/USD AMM pool", price: "2.4393" });
    expect(built.share).toEqual({ state: "ok", text: "34%" });
    expect(built.traders).toMatchObject({ state: "ok", note: expect.stringMatching(/^5 of 1,204 accounts/) });
    // The route adds the anchor and the build.
    expect(built).not.toHaveProperty("anchor");
    expect(built).not.toHaveProperty("build");
  });

  it("draws the candles in the 60-bucket window that ends with the bucket that holds the close time", () => {
    const { page: built } = build();
    if (built.candles.state !== "ok") throw new Error("candles");
    expect(built.candles.data.axis.buckets).toEqual(candleWindow(T, "1h").buckets);
    expect(built.candles.data.format).toEqual({ kind: "price", unit: "USD" });
    expect(built.candles.data.volume).toEqual({ kind: "amount", unit: "XRP" });
    expect(built.candles.data.candles[59]).not.toBeNull();
    expect(built.candles.data.candles[58]).toBeNull();
    const other = build({ params: { ...DEFAULT_PARAMS, interval: "1d" }, candles: ok(page([])) }).page;
    expect(other.candles).toMatchObject({ state: "ok", empty: "No trades in these 60 days", source: "/v2/exchanges/{base}/{counter}?interval=1day" });
  });

  describe("the head and the selectors", () => {
    it("links every interval, keeping the Trades filter, and every filter, keeping the interval", () => {
      const { page: built } = build({ params: { interval: "4h", trades: "amm", back: [] } });
      expect(built.filters.interval).toEqual([
        { label: "15 m", href: `${PAIR}?interval=15m&trades=amm`, current: false },
        { label: "1 h", href: `${PAIR}?trades=amm`, current: false },
        { label: "4 h", href: `${PAIR}?interval=4h&trades=amm`, current: true },
        { label: "1 d", href: `${PAIR}?interval=1d&trades=amm`, current: false },
        { label: "1 w", href: `${PAIR}?interval=1w&trades=amm`, current: false },
      ]);
      expect(built.filters.trades).toEqual([
        { label: "All", href: `${PAIR}?interval=4h`, current: false },
        { label: "Order book", href: `${PAIR}?interval=4h&trades=book`, current: false },
        { label: "AMM", href: `${PAIR}?interval=4h&trades=amm`, current: true },
      ]);
    });

    it("marks the default view current: 1 h, and All", () => {
      const { page: built } = build();
      expect(built.filters.interval.filter((link) => link.current).map((link) => link.label)).toEqual(["1 h"]);
      expect(built.filters.trades!.filter((link) => link.current).map((link) => link.label)).toEqual(["All"]);
    });

    it("words the view for the title: the interval (not 1 h), then the Trades filter", () => {
      const view = (params: Partial<PairParams>) => build({ params: { ...DEFAULT_PARAMS, ...params } }).page.view;
      expect(view({})).toEqual([]);
      expect(view({ interval: "15m" })).toEqual(["15 m candles"]);
      expect(view({ interval: "4h" })).toEqual(["4 h candles"]);
      expect(view({ interval: "1w" })).toEqual(["1 w candles"]);
      expect(view({ trades: "book" })).toEqual(["order-book trades"]);
      expect(view({ trades: "amm" })).toEqual(["AMM swaps"]);
      expect(view({ interval: "4h", trades: "amm" })).toEqual(["4 h candles", "AMM swaps"]);
    });

    it("names the amm parameter in the sources of the chart and of the trades when there is a filter", () => {
      const { page: built } = build({ params: { interval: "15m", trades: "book", back: [] } });
      expect(built.candles).toMatchObject({ source: "/v2/exchanges/{base}/{counter}?interval=15minute&amm=exclude" });
      expect(built.trades.source).toBe("/v2/exchanges/{base}/{counter}?descending=true&amm=exclude");
    });
  });

  describe("indexable", () => {
    it("is for the natural orientation, the default query and a pair with a trade", () => {
      expect(build().page.indexable).toBe(true);
    });

    it("is not for the other way round: USD / XRP is the same market on a page of its own", () => {
      const { page: built } = build({ base: USD_ASSET, counter: XRP_ASSET });
      expect(built.indexable).toBe(false);
      expect(built.head.heading).toBe("USD / XRP");
      expect(built.price.unit).toBe("XRP per USD");
    });

    it("is not for another interval, a Trades filter, or a pair that has offers but no trade", () => {
      expect(build({ params: { ...DEFAULT_PARAMS, interval: "4h" } }).page.indexable).toBe(false);
      expect(build({ params: { ...DEFAULT_PARAMS, trades: "amm" } }).page.indexable).toBe(false);
      expect(build({ hasTrade: false, trades: tradePage([]) }).page.indexable).toBe(false);
    });

    it("is the natural orientation of the network's native code: EVR / XAH on Xahau, XAH / USD", () => {
      const EVR = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
      const xahauXah = { currency: "XAH" };
      expect(build({ network: XAHAU, base: EVR, counter: xahauXah, pool: null, share: null }).page.indexable).toBe(true);
      expect(build({ network: XAHAU, base: xahauXah, counter: EVR, pool: null, share: null }).page.indexable).toBe(false);
    });
  });

  describe("the price and the change", () => {
    it("is the newest trade's price in the counter per base, with the change from the 24 h open", () => {
      const { price } = build().page;
      // 2.4393 ÷ 2.3952 − 1 = +1.8412%.
      expect(price).toEqual({ text: "2.4393", unit: "USD per XRP", note: null, change: { text: "+1.84%", dir: "up" }, token: expect.stringMatching(/^[0-9a-f]{8}$/) });
    });

    it("signs a fall with U+2212 and calls an unchanged price flat", () => {
      const change = (last: string, open: string) => build({ trades: tradePage([trade({ rate: last })]), stats: ok(reduced({ open })) }).page.price.change;
      expect(change("1.5", "2")).toEqual({ text: "−25.00%", dir: "down" });
      expect(change("2", "2")).toEqual({ text: "0.00%", dir: "flat" });
      // +0.0005% rounds to nothing: no sign, flat.
      expect(change("2.00001", "2")).toEqual({ text: "0.00%", dir: "flat" });
      expect(change("3", "2")).toEqual({ text: "+50.00%", dir: "up" });
    });

    it("rounds the change half up to two decimals", () => {
      // 1.00005 ÷ 1 − 1 = 0.005% → +0.01 half up at two places of a percent (0.005 → 0.01).
      const change = (last: string, open: string) => build({ trades: tradePage([trade({ rate: last })]), stats: ok(reduced({ open })) }).page.price.change;
      expect(change("1.0000500", "1")).toEqual({ text: "+0.01%", dir: "up" });
      expect(change("0.9999500", "1")).toEqual({ text: "−0.01%", dir: "down" });
    });

    it("has no change for a window without a trade, or one whose open is not above 0, or with its figures missing", () => {
      expect(build({ stats: ok(nothing()) }).page.price.change).toBeNull();
      expect(build({ stats: ok(reduced({ open: "0" })) }).page.price.change).toBeNull();
      // A count of 0 is no change, whatever open says.
      expect(build({ stats: ok(reduced({ count: 0 })) }).page.price.change).toBeNull();
      expect(build({ stats: FAILED }).page.price.change).toBeNull();
      expect(build({ stats: ok(reduced({ open: "x" })) }).page.price.change).toBeNull();
    });

    it("reads a price in exponent form: the price shows in plain digits and the change is of the exact figures", () => {
      const { price } = build({ trades: tradePage([trade({ rate: "1.2000000e-7" })]), stats: ok(reduced({ open: "1.0000000e-7" })) }).page;
      expect(price).toMatchObject({ text: "0.00000012", change: { text: "+20.00%", dir: "up" } });
    });

    it("is a dash and \"No trades yet\" for a pair with no trade", () => {
      const { price } = build({ trades: tradePage([]), hasTrade: false, stats: ok(nothing()) }).page;
      expect(price).toMatchObject({ text: "—", unit: "USD per XRP", note: "No trades yet", change: null });
    });

    it("keeps the price and notes when the newest trade is more than 24 hours before the close time", () => {
      // T is 2026-10-17T17:01:12Z: 24 hours before is 2026-10-16T17:01:12Z exactly.
      const note = (executed_time: string) => build({ trades: tradePage([trade({ executed_time })]), stats: ok(nothing()) }).page.price;
      expect(note("2026-10-16T17:01:12Z").note).toBeNull();
      expect(note("2026-10-16T17:01:11Z")).toMatchObject({ text: "2.4393", note: "last trade 2026-10-16" });
      expect(note("2026-10-03T09:00:00Z")).toMatchObject({ text: "2.4393", note: "last trade 2026-10-03", change: null });
      // A trade a moment after the close time (the index is ahead of the anchor) is not old.
      expect(note("2026-10-17T17:01:30Z").note).toBeNull();
    });

    it("carries a token of what it draws", () => {
      const token = (over: Partial<PairInput>) => build(over).page.price.token;
      const base = token({});
      expect(token({})).toBe(base);
      expect(token({ trades: tradePage([trade({ rate: "2.4394" })]) })).not.toBe(base);
      expect(token({ stats: ok(reduced({ open: "2.4000" })) })).not.toBe(base);
      expect(token({ stats: ok(nothing()) })).not.toBe(base);
    });
  });

  describe("the 24 h figures", () => {
    it("are the stats of the window", () => {
      const { stats } = build({ stats: ok(reduced({ base_volume: "1600000", counter_volume: "3880000" })) }).page;
      expect(stats).toMatchObject({ state: "ok", note: null });
      if (stats.state !== "ok") throw new Error("stats");
      expect(stats.items.map((item) => item.label)).toEqual(["24 h high", "24 h low", "VWAP 24 h", "Volume XRP", "Volume USD", "Trades 24 h"]);
      expect(stats.items.map((item) => item.value)).toEqual(["2.4501", "2.379", "2.425", "1.6M", "3.88M", "694"]);
    });

    it("says there were no trades in the window when there were none", () => {
      const { stats } = build({ stats: ok(nothing()) }).page;
      expect(stats).toMatchObject({ state: "ok", note: "No trades in the last 24 hours." });
    });
  });

  describe("the AMM parts", () => {
    it("are on XRPL with AMM_DATA on: the Trades filter, the Via column, the share", () => {
      const { page: built } = build({ trades: tradePage([trade({ amm_account: POOL })]) });
      expect(built.ammParts).toBe(true);
      expect(built.filters.trades).not.toBeNull();
      expect(built.trades.rows[0]!.via).toBe("AMM");
      expect(built.share.state).toBe("ok");
    });

    it("are left out while AMM_DATA is off: no Trades filter, no Via, no share, and a share that was given is not shown", () => {
      const { page: built, problems } = build({ network: XRPL_AMM_OFF, trades: tradePage([trade({ amm_account: POOL })]) });
      expect(built.ammParts).toBe(false);
      expect(built.filters.trades).toBeNull();
      expect(built.trades.rows[0]!.via).toBeNull();
      expect(built.share).toEqual({ state: "off" });
      // The pool is still the node's answer: the card stays, without the share.
      expect(built.pool.state).toBe("ok");
      expect(problems).toEqual([]);
    });

    it("are left out on Xahau, which has no pool either", () => {
      const { page: built, problems } = build({ network: XAHAU, pool: null, share: null });
      expect(built).toMatchObject({ ammParts: false, filters: { trades: null }, share: { state: "off" }, pool: { state: "missing" } });
      expect(built.trades.rows[0]!.via).toBeNull();
      expect(problems).toEqual([]);
    });

    it("never name a Trades filter the network does not have, in a link, a source or the title", () => {
      const { page: built } = build({ network: XRPL_AMM_OFF, params: { interval: "4h", trades: "amm", back: [] } });
      expect(built.view).toEqual(["4 h candles"]);
      expect(built.head.firstPage).toBe(PAIR);
      expect(built.trades.source).toBe("/v2/exchanges/{base}/{counter}?descending=true");
      expect(built.candles).toMatchObject({ source: "/v2/exchanges/{base}/{counter}?interval=4hour" });
      expect(built.filters.interval.every((link) => !link.href.includes("trades"))).toBe(true);
      expect(built.traders).toMatchObject({ state: "ok", note: expect.not.stringContaining("no filter") });
    });
  });

  describe("the share of the pair's volume", () => {
    const share = (over: Partial<PairInput>) => build(over).page.share;
    const pairVolume = (trades: PairParams["trades"], stats: string, shareRow: string) =>
      share({ params: { ...DEFAULT_PARAMS, trades }, stats: ok(reduced({ base_volume: stats })), share: ok(reduced({ base_volume: shareRow })) });

    it("with no filter is the AMM's volume (amm=only) over all of it", () => {
      expect(pairVolume(null, "1000", "340")).toEqual({ state: "ok", text: "34%" });
    });

    it("with the order-book filter is the AMM's volume (amm=only) over the book's and the AMM's together", () => {
      expect(pairVolume("book", "660", "340")).toEqual({ state: "ok", text: "34%" });
    });

    it("with the AMM filter is the AMM's volume (the page's own figure) over the book's (amm=exclude) and the AMM's together", () => {
      expect(pairVolume("amm", "340", "660")).toEqual({ state: "ok", text: "34%" });
    });

    it("rounds half up to a whole percent, writes \"<1%\" below one half and \"0%\" for nothing", () => {
      expect(pairVolume(null, "1000", "5")).toMatchObject({ text: "1%" });
      expect(pairVolume(null, "1000", "4.99")).toMatchObject({ text: "<1%" });
      expect(pairVolume(null, "1000", "345")).toMatchObject({ text: "35%" });
      expect(pairVolume(null, "1000", "344.99")).toMatchObject({ text: "34%" });
      expect(pairVolume(null, "1000", "0")).toMatchObject({ text: "0%" });
      expect(pairVolume(null, "1000", "1000")).toMatchObject({ text: "100%" });
    });

    it("is a dash when there is no volume to take a share of", () => {
      expect(pairVolume(null, "0", "0")).toMatchObject({ state: "ok", text: "—" });
      expect(pairVolume("book", "0", "0")).toMatchObject({ text: "—" });
      expect(pairVolume("amm", "0", "0")).toMatchObject({ text: "—" });
    });

    it("is never above 100%: two calls made apart in time can disagree by a trade", () => {
      expect(pairVolume(null, "1000", "1003")).toMatchObject({ text: "100%" });
      expect(pairVolume(null, "1000", "1200")).toMatchObject({ text: "100%" });
    });

    it("reads volumes in exponent form", () => {
      expect(pairVolume(null, "1e3", "3.4e+2")).toMatchObject({ text: "34%" });
    });

    it("failed when either call failed, or the figure is not a number", () => {
      expect(share({ share: FAILED })).toEqual({ state: "failed" });
      expect(share({ share: MISSING })).toEqual({ state: "failed" });
      expect(share({ stats: FAILED })).toEqual({ state: "failed" });
      expect(pairVolume(null, "1000", "x")).toEqual({ state: "failed" });
    });

    it("is off when it was not asked for", () => {
      expect(share({ share: null })).toEqual({ state: "off" });
    });
  });

  describe("the pool card", () => {
    it("is the pool the node found, oriented to the page", () => {
      const { pool } = build().page;
      expect(pool).toMatchObject({ state: "ok", reserves: "1.8M XRP · 4.39M USD", fee: "0.300%" });
      const inverted = build({ base: USD_ASSET, counter: XRP_ASSET }).page.pool;
      expect(inverted).toMatchObject({ state: "ok", title: "USD/XRP AMM pool", reserves: "4.39M USD · 1.8M XRP", price: "0.40995368" });
    });

    it("is missing, and no problem, for a pair with no pool, and when the node was not asked", () => {
      expect(build({ pool: MISSING })).toMatchObject({ page: { pool: { state: "missing" } }, problems: [] });
      expect(build({ pool: null })).toMatchObject({ page: { pool: { state: "missing" } }, problems: [] });
    });

    it("failed, and a problem, when the node could not answer: that is not \"no pool\"", () => {
      expect(build({ pool: FAILED })).toMatchObject({ page: { pool: { state: "failed" } }, problems: ["pool"] });
    });

    it("failed, and a problem, when the node's pool is not of the pair: an answer for another pair is no answer", () => {
      const other = poolInfo({ amount2: { currency: "EUR", issuer: BS, value: "5" } });
      expect(build({ pool: ok(other) })).toMatchObject({ page: { pool: { state: "failed" } }, problems: ["pool"] });
    });
  });

  describe("the traders", () => {
    it("leave out the pool account when the node named it", () => {
      const accounts = [activeAccount(POOL, "9000000", 900), ...TRADERS];
      const { traders } = build({ traders: ok(active(accounts, 1204)) }).page;
      if (traders.state !== "ok") throw new Error("traders");
      expect(traders.data.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5].map(trader));
      expect(traders.note).toContain("The XRP/USD AMM pool, the other side of every swap, is left out.");
    });

    it("keep it when the node failed, or has no pool", () => {
      const accounts = [activeAccount(POOL, "9000000", 900), ...TRADERS];
      for (const pool of [FAILED, MISSING, null]) {
        const { traders } = build({ traders: ok(active(accounts, 1204)), pool }).page;
        if (traders.state !== "ok") throw new Error("traders");
        expect(traders.data.items[0]!.id).toBe(POOL);
        expect(traders.note).not.toContain("is left out");
      }
    });

    it("say that the list has no filter when the page has one", () => {
      const { traders } = build({ params: { ...DEFAULT_PARAMS, trades: "book" } }).page;
      if (traders.state !== "ok") throw new Error("traders");
      expect(traders.note).toContain(" All trades: this list has no filter.");
    });
  });

  describe("a Trades filter whose list is empty while the pair has other trades", () => {
    it("is a page with an empty list and no price, which is a market that exists", () => {
      const { page: built, problems } = build({
        params: { ...DEFAULT_PARAMS, trades: "amm" },
        trades: tradePage([]),
        hasTrade: false,
        stats: ok(nothing()),
        candles: ok(page([])),
        share: ok(nothing()),
      });
      expect(problems).toEqual([]);
      expect(built.trades.rows).toEqual([]);
      expect(built.price).toMatchObject({ text: "—", note: "No trades yet", change: null });
      expect(built.stats).toMatchObject({ state: "ok", note: "No trades in the last 24 hours." });
      expect(built.candles).toMatchObject({ state: "ok", empty: "No trades in these 60 hours" });
      expect(built.indexable).toBe(false);
    });
  });

  describe("a part that failed", () => {
    it("gives each part its own failed state and its name in the problems", () => {
      expect(build({ stats: FAILED, share: null })).toMatchObject({ page: { stats: { state: "failed" } }, problems: ["stats"] });
      expect(build({ candles: FAILED })).toMatchObject({ page: { candles: { state: "failed" } }, problems: ["candles"] });
      expect(build({ traders: FAILED })).toMatchObject({ page: { traders: { state: "failed" } }, problems: ["traders"] });
      expect(build({ pool: FAILED })).toMatchObject({ page: { pool: { state: "failed" } }, problems: ["pool"] });
      expect(build({ share: FAILED })).toMatchObject({ page: { share: { state: "failed" } }, problems: ["share"] });
    });

    it("fails the book whole when either side failed: half a book is never shown", () => {
      expect(build({ asks: FAILED })).toMatchObject({ page: { book: { state: "failed" } }, problems: ["book"] });
      expect(build({ bids: FAILED })).toMatchObject({ page: { book: { state: "failed" } }, problems: ["book"] });
      expect(build({ asks: FAILED, bids: FAILED })).toMatchObject({ page: { book: { state: "failed" } }, problems: ["book"] });
    });

    it("lists the failed parts once each, in the order of the page's parts", () => {
      const { problems } = build({ share: FAILED, pool: FAILED, bids: FAILED, traders: FAILED, candles: FAILED, stats: FAILED });
      expect(problems).toEqual(["stats", "candles", "traders", "book", "pool", "share"]);
    });

    it("fails the share too when the 24 h figures it needs are what failed: it shows its error, so it is named", () => {
      const { page: built, problems } = build({ stats: FAILED });
      expect(built.share).toEqual({ state: "failed" });
      expect(problems).toEqual(["stats", "share"]);
      // Where the share is not asked for, only the figures failed.
      expect(build({ stats: FAILED, network: XRPL_AMM_OFF }).problems).toEqual(["stats"]);
    });

    it("keeps the other parts: the trades and the head do not depend on the cards", () => {
      const { page: built } = build({ stats: FAILED, candles: FAILED, traders: FAILED, asks: FAILED, pool: FAILED, share: FAILED });
      expect(built.trades.rows).toHaveLength(1);
      expect(built.head).toEqual(HEAD);
      expect(built.price.text).toBe("2.4393");
    });

    it("treats a part that is missing as failed, except the pool", () => {
      expect(build({ stats: MISSING, share: null })).toMatchObject({ page: { stats: { state: "failed" } }, problems: ["stats"] });
      expect(build({ bids: MISSING })).toMatchObject({ page: { book: { state: "failed" } }, problems: ["book"] });
    });
  });

  it("changes neither its input nor the params it is given", () => {
    const input = pairInput({ params: { interval: "4h", trades: "amm", marker: undefined, back: [] } });
    const before = JSON.stringify(input);
    pairPage(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("olderPage", () => {
  const input = (over: Partial<Parameters<typeof olderPage>[0]> = {}): Parameters<typeof olderPage>[0] => ({
    network: XRPL,
    base: XRP_ASSET,
    counter: USD_ASSET,
    params: { interval: "1h", trades: null, marker: "M1", back: [] },
    trades: tradePage([trade({ amm_account: POOL })], "M2"),
    ...over,
  });

  it("is the head, the note that points to the market's page, and the trades with their paging", () => {
    const older = olderPage(input());
    expect(older).toMatchObject({
      mode: "older",
      head: HEAD,
      view: ["older trades"],
      note: { text: "Older trades of XRP/USD. The price, chart and order book are on the market's page.", link: "the market's page", href: PAIR },
    });
    expect(older.note.text).toContain(older.note.link);
    expect(older.trades.rows).toHaveLength(1);
    expect(older.trades.paging).toEqual({ newerHref: PAIR, olderHref: `${PAIR}?marker=M2&back=M1` });
    expect(older).not.toHaveProperty("build");
  });

  it("keeps the Trades filter in the link to the market's page and in the paging, and adds it to the title words", () => {
    const older = olderPage(input({ params: { interval: "1h", trades: "amm", marker: "M1", back: [] } }));
    expect(older.view).toEqual(["AMM swaps", "older trades"]);
    expect(older.note.href).toBe(`${PAIR}?trades=amm`);
    expect(older.head.firstPage).toBe(`${PAIR}?trades=amm`);
    expect(older.trades.paging.newerHref).toBe(`${PAIR}?trades=amm`);
    expect(older.trades.source).toBe("/v2/exchanges/{base}/{counter}?descending=true&amm=only");
  });

  it("has the Via column while the AMM parts are on, and not while they are off or on Xahau", () => {
    expect(olderPage(input()).trades.rows[0]!.via).toBe("AMM");
    expect(olderPage(input({ network: XRPL_AMM_OFF })).trades.rows[0]!.via).toBeNull();
    expect(olderPage(input({ network: XAHAU })).trades.rows[0]!.via).toBeNull();
  });

  it("is a page of the other way round too: its note names the pair as it is asked for and points to its own market page", () => {
    const older = olderPage(input({ base: USD_ASSET, counter: XRP_ASSET }));
    expect(older.note).toMatchObject({ text: "Older trades of USD/XRP. The price, chart and order book are on the market's page.", href: INVERTED });
    expect(older.head.invert.href).toBe(PAIR);
  });

  it("leaves a trail of ten markers as it is, and drops the oldest from the way back", () => {
    const back = ["M10", "M9", "M8", "M7", "M6", "M5", "M4", "M3", "M2", "M1"];
    const older = olderPage(input({ params: { interval: "1h", trades: null, marker: "M11", back }, trades: tradePage([trade()], "M12") }));
    expect(older.trades.paging.olderHref).toBe(`${PAIR}?marker=M12&back=M11.M10.M9.M8.M7.M6.M5.M4.M3.M2`);
  });
});
