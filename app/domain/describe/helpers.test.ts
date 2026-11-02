import { describe, expect, it } from "vitest";

import { mptIdOf, mptIssuerOf } from "./helpers";

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

  it("is exported from helpers.ts, where the spec names it, and is the leaf's own function", async () => {
    const leaf = await import("../mpt-id");
    expect(mptIdOf).toBe(leaf.mptIdOf);
    expect(mptIssuerOf).toBe(leaf.mptIssuerOf);
  });
});
