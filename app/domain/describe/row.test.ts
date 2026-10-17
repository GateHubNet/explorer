import { describe, expect, it } from "vitest";

import type { TxJson, TxMeta } from "../parse/types";
import { describe as describeTx, headlineAmount, rowSentence } from "./index";
import type { Segment } from "./types";

// What a table row shows of a transaction: the sentence of `describe()` without its subject (the Account column has
// it) and without the reason of a failure (the Result column has the code), and the one amount that says the most.

const SUCCESS: TxMeta = { TransactionIndex: 0, TransactionResult: "tesSUCCESS", AffectedNodes: [] };
const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";

const payment = (extra: Record<string, unknown> = {}): TxJson => ({
  TransactionType: "Payment",
  Account: ALICE,
  Destination: BOB,
  Amount: "5000000",
  Fee: "12",
  ...extra,
});

describe("rowSentence", () => {
  it("drops the sender, which has a column of its own, and starts with a capital", () => {
    const description = describeTx(payment(), { ...SUCCESS, delivered_amount: "5000000" }, { native: "XRP" });
    expect(rowSentence(description)).toEqual<Segment[]>([
      { t: "text", v: "Sent " },
      { t: "amount", value: "5", currency: "XRP" },
      { t: "text", v: " to " },
      { t: "account", v: BOB },
    ]);
  });

  it("reads 'Tried to …' for a failure and leaves the reason to the Result column", () => {
    const meta: TxMeta = { ...SUCCESS, TransactionResult: "tecPATH_DRY" };
    const description = describeTx(payment(), meta, { native: "XRP" });
    // The full sentence says why, after the full stop.
    expect(description.sentence.at(-1)).toMatchObject({ t: "text" });
    const row = rowSentence(description);
    expect(row[0]).toEqual({ t: "text", v: "Tried to send " });
    expect(row.at(-1)).toEqual({ t: "account", v: BOB });
    expect(row.some((segment) => segment.t === "text" && segment.v.includes("liquidity"))).toBe(false);
  });

  it("takes the full stop off a sentence that ends in text", () => {
    const tx: TxJson = { TransactionType: "AccountSet", Account: ALICE, Fee: "12", SetFlag: 8 };
    const row = rowSentence(describeTx(tx, SUCCESS, { native: "XRP" }));
    const last = row.at(-1)!;
    expect(last.t).toBe("text");
    expect((last as { v: string }).v.endsWith(".")).toBe(false);
    expect((row[0] as { v: string }).v[0]).toMatch(/[A-Z]/);
  });

  it("keeps what is not text as it is", () => {
    const row = rowSentence({ ok: true, sentence: [{ t: "account", v: ALICE }, { t: "text", v: " paid " }, { t: "account", v: BOB }, { t: "text", v: "." }] });
    expect(row).toEqual([{ t: "text", v: "Paid " }, { t: "account", v: BOB }]);
  });

  it("does not drop a first segment that is not the sender", () => {
    // A transaction with no Account reads "an unknown account …": text, which is not the sender's chip.
    const row = rowSentence({ ok: true, sentence: [{ t: "text", v: "an unknown account did something." }] });
    expect(row).toEqual([{ t: "text", v: "An unknown account did something" }]);
  });

  it("returns nothing for an empty sentence", () => {
    expect(rowSentence({ ok: true, sentence: [] })).toEqual([]);
  });
});

describe("headlineAmount", () => {
  it("is what a payment delivered", () => {
    expect(headlineAmount(payment({ Amount: "9000000" }), { ...SUCCESS, delivered_amount: "5000000" }, "XRP")).toEqual({
      value: "5",
      currency: "XRP",
    });
    const issued = { currency: "USD", issuer: BOB, value: "12.50" };
    expect(headlineAmount(payment({ Amount: issued }), { ...SUCCESS, delivered_amount: issued }, "XRP")).toEqual(issued);
  });

  it("is the amount a payment was for when it delivered nothing (a failure) or the node could not say", () => {
    expect(headlineAmount(payment(), { ...SUCCESS, TransactionResult: "tecPATH_DRY" }, "XRP")).toEqual({ value: "5", currency: "XRP" });
    expect(headlineAmount(payment(), { ...SUCCESS, delivered_amount: "unavailable" as never }, "XRP")).toEqual({ value: "5", currency: "XRP" });
    const deliverMax = payment({ Amount: undefined, DeliverMax: "2500000" });
    expect(headlineAmount(deliverMax, SUCCESS, "XAH")).toEqual({ value: "2.5", currency: "XAH" });
  });

  it("is what an offer sells", () => {
    const tx: TxJson = { TransactionType: "OfferCreate", Account: ALICE, Fee: "12", TakerGets: "417138606", TakerPays: { currency: "USD", issuer: BOB, value: "3" } };
    expect(headlineAmount(tx, SUCCESS, "XRP")).toEqual({ value: "417.138606", currency: "XRP" });
  });

  it("is the Amount of any other type that has one", () => {
    const tx: TxJson = { TransactionType: "EscrowCreate", Account: ALICE, Fee: "12", Amount: "1000000", Destination: BOB };
    expect(headlineAmount(tx, SUCCESS, "XRP")).toEqual({ value: "1", currency: "XRP" });
  });

  it("is nothing for a type without an amount, and for an amount it cannot read", () => {
    expect(headlineAmount({ TransactionType: "OfferCancel", Account: ALICE, Fee: "12", OfferSequence: 4 }, SUCCESS, "XRP")).toBeUndefined();
    expect(headlineAmount(payment({ Amount: { mpt_issuance_id: "00", value: "5" } }), SUCCESS, "XRP")).toBeUndefined();
    expect(headlineAmount({ TransactionType: "Batch", Account: ALICE, Fee: "12" }, SUCCESS, "XRP")).toBeUndefined();
  });
});
