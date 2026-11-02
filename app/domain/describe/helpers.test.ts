import { describe, expect, it } from "vitest";

import { isMptIssuanceId } from "../mpt-id";
import type { TxMeta } from "../parse/types";
import { amountSegment, deliveredMptAmount, fieldValue, mptFlowAmount, mptIdOf, mptIssuerOf, mptSegment, parseAmount, parseMptAmount } from "./helpers";

/** The issuer whose AccountID is 0x00…01, so that an ID's last byte is the one to look at. */
const ACCOUNT_ONE = "rrrrrrrrrrrrrrrrrrrrBZbvji";
const ISSUER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

describe("mptIdOf and mptIssuerOf", () => {
  it("writes the sequence as 4 big-endian bytes and then the issuer's AccountID, in upper-case hex", () => {
    expect(mptIdOf(298, ACCOUNT_ONE)).toBe("0000012A" + "0".repeat(38) + "01");
    expect(mptIdOf(66_652_146, ISSUER)).toMatch(/^03F907F2[0-9A-F]{40}$/);
    expect(mptIdOf(0, ACCOUNT_ONE)).toBe("00000000" + "0".repeat(38) + "01");
    expect(mptIdOf(4_294_967_295, ACCOUNT_ONE)).toBe("FFFFFFFF" + "0".repeat(38) + "01");
  });

  it("gives the issuer back, from an ID of either case", () => {
    const id = "0000012A" + "0".repeat(38) + "01";
    expect(mptIssuerOf(id.toLowerCase())).toBe(ACCOUNT_ONE);
    expect(mptIssuerOf(id)).toBe(ACCOUNT_ONE);
    expect(mptIssuerOf(mptIdOf(7, ISSUER))).toBe(ISSUER);
    expect(mptIssuerOf(mptIdOf(7, ISSUER).toLowerCase())).toBe(ISSUER);
  });

  it("refuses a sequence that is not 32 bits, and an ID that is not 48 hex digits", () => {
    for (const sequence of [-1, 1.5, 4_294_967_296, Number.NaN]) expect(() => mptIdOf(sequence, ISSUER), String(sequence)).toThrow(RangeError);
    for (const id of ["", "0000012A", "0".repeat(47), "0".repeat(49), "G".repeat(48), `${"0".repeat(47)} `]) expect(() => mptIssuerOf(id), id).toThrow(RangeError);
  });

  it("tests an ID's text in the one place parse/ and describe/ test it: 48 hex digits in either case, and only text", () => {
    const id = mptIdOf(298, ISSUER);
    expect([id, id.toLowerCase(), "0".repeat(48)].map(isMptIssuanceId)).toEqual([true, true, true]);
    expect(["", "0".repeat(47), "0".repeat(49), "G".repeat(48), `${id} `, 12, undefined, null, { id }].map(isMptIssuanceId)).toEqual(Array(9).fill(false));
  });

  it("is exported from helpers.ts, where the spec names it, and is the leaf's own function", async () => {
    const leaf = await import("../mpt-id");
    expect(mptIdOf).toBe(leaf.mptIdOf);
    expect(mptIssuerOf).toBe(leaf.mptIssuerOf);
  });
});

// An MPT's amount (spec 5.1, Task 5): the issuance ID beside an integer number of units, as D9 and rippled write it, with the issuer decoded from the ID.
describe("an MPT's amount", () => {
  const ID = mptIdOf(298, ISSUER);
  const lower = ID.toLowerCase();
  const RAW = { mpt_issuance_id: lower, value: "2500000" };

  describe("deliveredMptAmount", () => {
    const meta = (over: Record<string, unknown>): TxMeta => ({ TransactionIndex: 0, TransactionResult: "tesSUCCESS", AffectedNodes: [], ...over });
    const of = (value: string, id = ID) => ({ mpt_issuance_id: id, value });

    it("gives delivered_amount first, else DeliveredAmount, with the ID in capitals", () => {
      expect(deliveredMptAmount(meta({ delivered_amount: of("7", lower), DeliveredAmount: of("9") }), ID)).toEqual({ id: ID, units: "7" });
      expect(deliveredMptAmount(meta({ DeliveredAmount: of("9") }), ID)).toEqual({ id: ID, units: "9" });
      expect(deliveredMptAmount(meta({ delivered_amount: "unavailable", DeliveredAmount: of("9") }), lower)).toEqual({ id: ID, units: "9" });
    });

    it("gives none when the metadata has neither, or neither reads as an MPT amount", () => {
      expect(deliveredMptAmount(meta({}), ID)).toBeUndefined();
      expect(deliveredMptAmount(meta({ delivered_amount: "unavailable" }), ID)).toBeUndefined();
      expect(deliveredMptAmount(meta({ delivered_amount: "1000000" }), ID)).toBeUndefined();
      expect(deliveredMptAmount(meta({ delivered_amount: of("1.5") }), ID)).toBeUndefined();
    });

    it("refuses a delivered amount of another issuance, in either field", () => {
      const other = mptIdOf(299, ISSUER);
      expect(deliveredMptAmount(meta({ delivered_amount: of("7", other) }), ID)).toBeUndefined();
      expect(deliveredMptAmount(meta({ DeliveredAmount: of("7", other) }), ID)).toBeUndefined();
      expect(deliveredMptAmount(meta({ delivered_amount: of("7"), DeliveredAmount: of("7", other) }), ID)).toBeUndefined();
    });
  });

  describe("parseMptAmount", () => {
    it("gives the ID in capitals and the units of an object with a 48-hex mpt_issuance_id and an integer value", () => {
      expect(parseMptAmount(RAW)).toEqual({ id: ID, units: "2500000" });
      expect(parseMptAmount({ mpt_issuance_id: ID, value: "0" })).toEqual({ id: ID, units: "0" });
      expect(parseMptAmount({ mpt_issuance_id: ID, value: "9223372036854775807" })).toEqual({ id: ID, units: "9223372036854775807" });
    });

    it.each([
      ["a value with a fraction", { mpt_issuance_id: ID, value: "1.5" }],
      ["a negative value", { mpt_issuance_id: ID, value: "-1" }],
      ["an exponent", { mpt_issuance_id: ID, value: "1e3" }],
      ["an empty value", { mpt_issuance_id: ID, value: "" }],
      ["a value with a space", { mpt_issuance_id: ID, value: " 5" }],
      ["a number for a value", { mpt_issuance_id: ID, value: 5 }],
      ["no value", { mpt_issuance_id: ID }],
      ["no ID", { value: "1.5" }],
      ["an issued amount", { currency: "USD", issuer: ISSUER, value: "5" }],
      ["an ID of 40 hex digits (a currency code's size)", { mpt_issuance_id: "A".repeat(40), value: "5" }],
      ["an ID of 47 digits", { mpt_issuance_id: ID.slice(1), value: "5" }],
      ["an ID of 49 digits", { mpt_issuance_id: `${ID}0`, value: "5" }],
      ["an ID that is not hex", { mpt_issuance_id: `${ID.slice(1)}G`, value: "5" }],
      ["an ID that is not a string", { mpt_issuance_id: 12, value: "5" }],
      ["drops", "5000000"],
      ["null", null],
      ["nothing", undefined],
      ["an array", [ID, "5"]],
    ])("gives nothing for %s", (_, raw) => {
      expect(parseMptAmount(raw)).toBeUndefined();
    });
  });

  describe("mptSegment", () => {
    it("is an amount with units, the issuer decoded from the ID, which it puts in capitals", () => {
      expect(mptSegment(lower, "2500000")).toStrictEqual({ t: "mpt", id: ID, issuer: ISSUER, units: "2500000" });
    });

    it("is a reference to the issuance without units, and has no `units` key at all", () => {
      const reference = mptSegment(ID);
      expect(reference).toStrictEqual({ t: "mpt", id: ID, issuer: ISSUER });
      expect("units" in reference).toBe(false);
    });
  });

  describe("amountSegment", () => {
    it("gives an MPT segment for an MPT amount of either case", () => {
      expect(amountSegment(RAW, "XRP")).toStrictEqual({ t: "mpt", id: ID, issuer: ISSUER, units: "2500000" });
      expect(amountSegment({ mpt_issuance_id: ID, value: "7" }, "XAH")).toStrictEqual({ t: "mpt", id: ID, issuer: ISSUER, units: "7" });
    });

    it("shows what is not an MPT amount as it did, in text: a value alone, and an ID of 40 digits", () => {
      expect(amountSegment({ value: "1.5" }, "XRP")).toStrictEqual({ t: "text", v: '{"value":"1.5"}' });
      const short = { mpt_issuance_id: "AB".repeat(20), value: "5" };
      expect(amountSegment(short, "XRP")).toStrictEqual({ t: "text", v: JSON.stringify(short) });
    });

    it("still gives drops and issued amounts what they had", () => {
      expect(amountSegment("2500000", "XRP")).toStrictEqual({ t: "amount", value: "2.5", currency: "XRP" });
      expect(amountSegment({ currency: "USD", issuer: ISSUER, value: "3" }, "XRP")).toStrictEqual({ t: "amount", value: "3", currency: "USD", issuer: ISSUER });
    });
  });

  describe("fieldValue", () => {
    it("gives an MPT amount field an MPT segment, whatever the field's name", () => {
      expect(fieldValue("Amount", RAW, "XRP")).toStrictEqual([{ t: "mpt", id: ID, issuer: ISSUER, units: "2500000" }]);
      expect(fieldValue("SendMax", RAW, "XRP")).toStrictEqual([{ t: "mpt", id: ID, issuer: ISSUER, units: "2500000" }]);
      expect(fieldValue("Anything", RAW, "XRP")).toStrictEqual([{ t: "mpt", id: ID, issuer: ISSUER, units: "2500000" }]);
    });

    it("gives MPTokenIssuanceID a reference to the issuance, without units, in capitals", () => {
      expect(fieldValue("MPTokenIssuanceID", lower, "XRP")).toStrictEqual([{ t: "mpt", id: ID, issuer: ISSUER }]);
    });

    it("shows an MPTokenIssuanceID that is no ID, and an ID in another field, as the text they are", () => {
      expect(fieldValue("MPTokenIssuanceID", "00AB", "XRP")).toStrictEqual([{ t: "text", v: "00AB" }]);
      expect(fieldValue("InvoiceID", ID, "XRP")).toStrictEqual([{ t: "text", v: ID }]);
    });
  });

  describe("mptFlowAmount", () => {
    it("gives the ID, its issuer and the units of an MPT payment's Amount", () => {
      expect(mptFlowAmount(RAW)).toStrictEqual({ mpt: ID, issuer: ISSUER, units: "2500000" });
    });

    it("gives nothing for drops, an issued amount or a malformed one", () => {
      expect(mptFlowAmount("2500000")).toBeUndefined();
      expect(mptFlowAmount({ currency: "USD", issuer: ISSUER, value: "3" })).toBeUndefined();
      expect(mptFlowAmount({ mpt_issuance_id: ID, value: "1.5" })).toBeUndefined();
    });
  });

  it("is not an amount of a currency: parseAmount stays the currency form", () => {
    expect(parseAmount(RAW, "XRP")).toBeUndefined();
  });
});
