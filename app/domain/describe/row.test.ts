import { describe, expect, it } from "vitest";

import { loadManifest, loadTx } from "../../../test/support/ledgers";
import type { TxJson, TxMeta } from "../parse/types";
import { describe as describeTx, headlineAmount, rowSentence } from "./index";
import { mptSegment } from "./helpers";
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

  it("ends a delegated row with · sent by {delegate}, and on the delegate's page with · sent by this account as its delegate", () => {
    const CAROL = "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh";
    const description = describeTx(payment({ Delegate: CAROL }), { ...SUCCESS, delivered_amount: "5000000" }, { native: "XRP" });
    const sent: Segment[] = [
      { t: "text", v: "Sent " },
      { t: "amount", value: "5", currency: "XRP" },
      { t: "text", v: " to " },
      { t: "account", v: BOB },
    ];
    // The delegate is an account segment: a link, which the list's names call asks for.
    expect(rowSentence(description)).toEqual<Segment[]>([...sent, { t: "text", v: " · sent by " }, { t: "account", v: CAROL }]);
    // On the page of the account it acted for (the sender), and of any other account, the same.
    expect(rowSentence(description, ALICE)).toEqual(rowSentence(description));
    expect(rowSentence(description, BOB)).toEqual(rowSentence(description));
    expect(rowSentence(description, CAROL)).toEqual<Segment[]>([...sent, { t: "text", v: " · sent by this account as its delegate" }]);

    // A failure keeps the tail, after the sentence without its reason.
    const failed = rowSentence(describeTx(payment({ Delegate: CAROL }), { ...SUCCESS, TransactionResult: "tecPATH_DRY" }, { native: "XRP" }));
    expect(failed[0]).toEqual({ t: "text", v: "Tried to send " });
    expect(failed.slice(-3)).toEqual<Segment[]>([{ t: "account", v: BOB }, { t: "text", v: " · sent by " }, { t: "account", v: CAROL }]);
    // A row of a transaction without a delegate has no tail.
    expect(JSON.stringify(rowSentence(describeTx(payment(), SUCCESS, { native: "XRP" })))).not.toContain("sent by");
  });

  describe("of an NFT mint, recorded", () => {
    const MINTED = "0019000040FEFE9E7C73D4F8A4DC7A7A09DD13B724827F945B2680E5061B0D4A";
    const mint = (name: string) => {
      const { tx, meta } = loadTx("xrpl-nft", loadManifest("xrpl-nft").cases[name]!.hash);
      return describeTx(tx, meta, { native: "XRP" });
    };

    it("reads 'Minted NFT {nft}' with the NFT as an nft segment, the minter left out and the sentence's own full stop", () => {
      const description = mint("mint");
      // The sentence starts with the minter, which a row leaves to its own column; the NFT is a segment of its own, not text.
      expect(description.sentence[0]).toMatchObject({ t: "account" });
      expect(description.sentence.slice(1, 3)).toEqual<Segment[]>([
        { t: "text", v: " minted NFT " },
        { t: "nft", v: MINTED },
      ]);
      const row = rowSentence(description);
      expect(row.slice(0, 2)).toEqual<Segment[]>([
        { t: "text", v: "Minted NFT " },
        { t: "nft", v: MINTED },
      ]);
      // It is the one NFT: the row has no other, no account and no amount; the rest is the words that follow the id, without the full stop.
      expect(row.filter((segment) => segment.t !== "text")).toEqual([{ t: "nft", v: MINTED }]);
      const last = row.at(-1)!;
      expect(last.t).toBe("text");
      expect((last as { v: string }).v.endsWith(".")).toBe(false);
    });

    it("names the NFT of a mint that also made an offer or split a page, and no NFT for a mint that failed", () => {
      for (const name of ["mint_with_offer", "page_split_with_mint"]) {
        const row = rowSentence(mint(name));
        expect(row[0], name).toEqual({ t: "text", v: "Minted NFT " });
        expect(row[1], name).toMatchObject({ t: "nft" });
        expect((row[1] as { v: string }).v, name).toMatch(/^[0-9A-F]{64}$/);
      }
      const { tx, meta } = loadTx("xrpl-nft", loadManifest("xrpl-nft").cases.mint!.hash);
      const failed = rowSentence(describeTx(tx, { ...meta, TransactionResult: "tecNO_PERMISSION" }, { native: "XRP" }));
      expect(failed.some((segment) => segment.t === "nft")).toBe(false);
      expect((failed[0] as { v: string }).v).toMatch(/^Tried to mint/);
    });
  });
});

describe("an MPT payment's row", () => {
  const mint = () => {
    const { tx, meta } = loadTx("xrpl-mpt", loadManifest("xrpl-mpt").cases.payment_mint!.hash);
    return { tx, meta };
  };
  const ID = "064E273A6D15D1F5614B4D4E3183F835BCD62E7F6FD9FFD8";
  const ISSUER = "rwA8orrVtNPuBykRvQdDJzRDQbe7CuxCiR";
  const HOLDER = "rMNysCkYEX9L3SrSPqavVVXYFT2v5CEVpo";

  it("keeps the MPT amount as a segment of its own, the issuer left to its column: 'Issued {amount} to {account}'", () => {
    const { tx, meta } = mint();
    expect(rowSentence(describeTx(tx, meta, { native: "XRP" }))).toEqual<Segment[]>([
      { t: "text", v: "Issued " },
      mptSegment(ID, "1"),
      { t: "text", v: " to " },
      { t: "account", v: HOLDER },
    ]);
  });

  it("says 'Tried to send' for a failure, with the amount it was for", () => {
    const { tx, meta } = loadTx("xrpl-mpt", loadManifest("xrpl-mpt").cases.payment_failed!.hash);
    const row = rowSentence(describeTx(tx, meta, { native: "XRP" }));
    expect(row.slice(0, 3)).toEqual<Segment[]>([{ t: "text", v: "Tried to issue " }, mptSegment(ID, "10"), { t: "text", v: " to " }]);
  });

  it("has an MPT headline amount of the ID, its issuer and the units: what the payment delivered", () => {
    const { tx, meta } = mint();
    expect(headlineAmount(tx, meta, "XRP")).toEqual({ mpt: ID, issuer: ISSUER, units: "1" });
    // From the ledger's own DeliveredAmount when the API's delivered_amount is not there, and from the Amount when the payment delivered nothing.
    const { delivered_amount: _api, ...bare } = meta;
    expect(headlineAmount(tx, { ...bare, DeliveredAmount: { mpt_issuance_id: ID, value: "7" } }, "XRP")).toEqual({ mpt: ID, issuer: ISSUER, units: "7" });
    expect(headlineAmount(tx, bare, "XRP")).toEqual({ mpt: ID, issuer: ISSUER, units: "1" });
    expect(headlineAmount(tx, { ...meta, TransactionResult: "tecNO_AUTH", delivered_amount: undefined }, "XRP")).toEqual({ mpt: ID, issuer: ISSUER, units: "1" });
  });

  it("has the Amount of a clawback of an MPT, and of an issued token's with the sender as its issuer, as the sentence shows it", () => {
    const { tx, meta } = loadTx("xrpl-mpt", loadManifest("xrpl-mpt").cases.clawback_full!.hash);
    expect(headlineAmount(tx, meta, "XRP")).toEqual({ mpt: ID, issuer: ISSUER, units: "1" });
    const issued = loadTx("xrpl-mpt", loadManifest("xrpl-mpt").cases.clawback_issued!.hash);
    expect(headlineAmount(issued.tx, issued.meta, "XRP")).toEqual({ value: "1", currency: "594F494E4B000000000000000000000000000000", issuer: "rYNKrtQaf3vUVWVK5sw9rJdPGDLbxZu89" });
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
