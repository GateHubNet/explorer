import { describe, expect, it } from "vitest";

import { decodeCtid, encodeCtid } from "./ctid";

// Each vector is a ledger index, a transaction index, a network id and the CTID they make.
const VECTORS = [
  { ledgerIndex: 107695660, txIndex: 12, networkId: 0, ctid: "C66B4E2C000C0000" },
  { ledgerIndex: 17482913, txIndex: 12, networkId: 21337, ctid: "C10AC4A1000C5359" },
  { ledgerIndex: 0, txIndex: 0, networkId: 0, ctid: "C000000000000000" },
  { ledgerIndex: 268435455, txIndex: 65535, networkId: 65535, ctid: "CFFFFFFFFFFFFFFF" },
];

describe("encodeCtid", () => {
  it.each(VECTORS)("encodes $ctid", ({ ledgerIndex, txIndex, networkId, ctid }) => {
    expect(encodeCtid(ledgerIndex, txIndex, networkId)).toBe(ctid);
  });

  it("refuses a field that does not fit its bits", () => {
    expect(() => encodeCtid(268435456, 0, 0)).toThrow(RangeError);
    expect(() => encodeCtid(-1, 0, 0)).toThrow(RangeError);
    expect(() => encodeCtid(1, 65536, 0)).toThrow(RangeError);
    expect(() => encodeCtid(1, -1, 0)).toThrow(RangeError);
    expect(() => encodeCtid(1, 0, 65536)).toThrow(RangeError);
    expect(() => encodeCtid(1, 0, -1)).toThrow(RangeError);
  });

  it("refuses a field that is not an integer", () => {
    expect(() => encodeCtid(1.5, 0, 0)).toThrow(RangeError);
    expect(() => encodeCtid(1, Number.NaN, 0)).toThrow(RangeError);
    expect(() => encodeCtid(1, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("decodeCtid", () => {
  it.each(VECTORS)("decodes $ctid", ({ ledgerIndex, txIndex, networkId, ctid }) => {
    expect(decodeCtid(ctid)).toEqual({ ledgerIndex, txIndex, networkId });
  });

  it("accepts lower case", () => {
    const { ledgerIndex, txIndex, networkId } = VECTORS[0]!;
    expect(decodeCtid("c66b4e2c000c0000")).toEqual({ ledgerIndex, txIndex, networkId });
    expect(decodeCtid("cFfFfFfFfFfFfFfF")).toEqual({ ledgerIndex: 268435455, txIndex: 65535, networkId: 65535 });
  });

  it("inverts encodeCtid", () => {
    for (const { ledgerIndex, txIndex, networkId } of VECTORS) {
      const ctid = encodeCtid(ledgerIndex, txIndex, networkId);
      expect(decodeCtid(ctid)).toEqual({ ledgerIndex, txIndex, networkId });
    }
  });

  it("returns null for 15 or 17 digits", () => {
    expect(decodeCtid("C66B4E2C000C000")).toBeNull();
    expect(decodeCtid("C66B4E2C000C00000")).toBeNull();
    expect(decodeCtid("")).toBeNull();
    expect(decodeCtid("C")).toBeNull();
  });

  it("returns null when the first digit is not C", () => {
    expect(decodeCtid("D66B4E2C000C0000")).toBeNull();
    expect(decodeCtid("066B4E2C000C0000")).toBeNull();
    expect(decodeCtid("A66B4E2C000C0000")).toBeNull();
  });

  it("returns null for anything that is not hex", () => {
    expect(decodeCtid("C66B4E2C000C000G")).toBeNull();
    expect(decodeCtid("C66B4E2C 00C0000")).toBeNull();
    expect(decodeCtid("C66B4E2C000C000\n")).toBeNull();
    expect(decodeCtid("0xC66B4E2C000C0000")).toBeNull();
  });
});
