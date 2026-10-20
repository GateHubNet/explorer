import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { bookFile, LIONS, RLUSD, XRP, type Asset as FixtureAsset } from "../../test/support/book-fixtures";
import { dropsToNative } from "../domain/format";
import { candleWindow as marketParamsWindow, INTERVALS, type Interval } from "../domain/market-params";
import type { Candle, Page } from "./api-types";
import type { Book, BookOffer, NodeAmount } from "./node-rpc";
import { BOOK_LEVELS, bookOf, candlesOf, candleWindow } from "./pair-view";

// ---- The order book: hand-made books of XRP/RLUSD -------------------------------------------------------------------------------------

const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const DASH = "—";

/** The arithmetic of the view builder, for the expected values: 80 places, half up. */
const BN = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

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
    expect(parts.asks).toEqual([{ price: "0.8", size: "125", total: "125", depth: new BN(125).div(325).toFixed() }]);
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

  it("writes a depth that is not exact in 80 places, as the arithmetic of the page does", () => {
    const parts = bookOf(book([offer(xrp("1"), rlusd("2"))]), book([offer(rlusd("3"), xrp("3")), offer(rlusd("3"), xrp("0.5"))]));
    // 1 ÷ 3.5: the bids' last total is the scale.
    expect(parts.asks[0]!.depth).toBe(new BN(1).div(new BN("3.5")).toFixed());
    expect(parts.asks[0]!.depth).toMatch(/^0\.285714285714285714285714\d{56}$/);
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
    expect(parts.bids[0]).toEqual({ price: "2", size: "5", total: "5", depth: new BN(5).div(95).toFixed() });
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
      new BN(10).div("30030.5").toFixed(),
      new BN("30.5").div("30030.5").toFixed(),
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
    expect(parts.asks).toEqual([{ price: "1.3", size: "40", total: "40", depth: new BN(40).div(60).toFixed() }]);
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
      // The ledger shown is the lower of the two.
      "the asks' ledger": bookOf(book([A, B, C], 107_721_453), BIDS).token,
      "the bids' ledger": bookOf(ASKS, book([D], 107_721_454)).token,
      "an empty side": bookOf(ASKS, book([])).token,
      "swapped sides": bookOf(BIDS, ASKS).token,
      // The same levels on the ask side; only the depth scale (the bids) moved.
      "the depth scale": bookOf(ASKS, book([offer(rlusd("625"), xrp("500"))])).token,
    };
    for (const [what, other] of Object.entries(changed)) expect(other, what).not.toBe(token);
    expect(new Set(Object.values(changed)).size).toBe(Object.keys(changed).length);
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
      { price: "1.0417752", size: "9,714.86", total: "9,714.86", depth: new BN("9714.85993").div(scale).toFixed() },
      { price: "1.0416667", size: "1,587.41", total: "11.3K", depth: new BN("11302.273255").div(scale).toFixed() },
      { price: "0.01", size: "12.1K", total: "23.4K", depth: "1" },
    ]);
    // The four offers that are funded: the last is 1 XRP at 100,000,000 LIONS.
    expect(parts.asks).toEqual([
      { price: "7,092.1986", size: "10", total: "10", depth: new BN(10).div(scale).toFixed() },
      { price: "7,246.3768", size: "6.82", total: "16.82", depth: new BN("16.822751").div(scale).toFixed() },
      { price: "7,633.5878", size: "0.384", total: "17.21", depth: new BN("17.206943").div(scale).toFixed() },
      { price: "100,000,000", size: "1", total: "18.21", depth: new BN("18.206943").div(scale).toFixed() },
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
    expect(parts.bids[0]).toEqual({ price: "1.2956", size: "1", total: "1", depth: new BN(1).div("10960.893152").toFixed() });
    expect(parts.spread).toBe("0.00083");
    // Asks total 10,960.893152 and bids 2,368.322576: the asks reach the depth 1 and the bids a fraction of it.
    expect(parts.asks[9]).toMatchObject({ price: "1.297884", total: "11K", depth: "1" });
    expect(parts.bids[9]).toMatchObject({ price: "1.2943466", total: "2,368.32", depth: new BN("2368.322576").div("10960.893152").toFixed() });
    for (const level of [...parts.asks, ...parts.bids]) {
      for (const text of Object.values(level)) expect(text).not.toMatch(EXPONENT);
    }
  });

  it("builds the inverted page, RLUSD / XRP, from the same two answers swapped", () => {
    const parts = bookOf(recorded(RLUSD, XRP), recorded(XRP, RLUSD));
    expect(parts.ledger).toBe("107,780,245");
    // The asks are the offers that give RLUSD: 1 ÷ 1.2956 XRP per RLUSD. The bids give XRP: 1.2956 ÷ ... the larger side is the bids, 14,212.449684083.
    expect(parts.asks[0]).toEqual({ price: "0.77184316", size: "1.3", total: "1.3", depth: new BN("1.2956").div("14212.449684083").toFixed() });
    expect(parts.bids[0]).toMatchObject({ price: "0.77134901", size: "10K", total: "10K" });
    expect(parts.bids[9]).toMatchObject({ total: "14.2K", depth: "1" });
    expect(parts.asks[9]).toMatchObject({ total: "3,065.93", depth: new BN("3065.92918233191525").div("14212.449684083").toFixed() });
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
    expect(Object.keys(data)).toEqual(["axis", "candles", "format", "volume", "forming", "token"]);
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
