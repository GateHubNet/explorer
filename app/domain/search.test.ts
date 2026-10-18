import { describe, expect, it } from "vitest";

import { classify } from "./search";

const HASH = "4BC50C9B0D8515D3EAAE1E74B29A95804346C491EE1A95BF25E4AAB854A6A651";
// A valid classic address, its X-address with the tag 104882, and the same address with no tag.
const ADDRESS = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const X_ADDRESS_WITH_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ2qXW7DhMWWpGmjhqyr";
const X_ADDRESS_NO_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ26KqXMt3GKX2eENgJ9";

/** The same text with the character at `at` replaced by another letter of the base58 alphabet. */
function changeOneCharacter(s: string, at: number): string {
  const replacement = s[at] === "a" ? "b" : "a";
  return s.slice(0, at) + replacement + s.slice(at + 1);
}

describe("classify: ledger index", () => {
  it("reads digits as a ledger index", () => {
    expect(classify("107695660")).toEqual({ kind: "ledger-index", index: 107695660 });
    expect(classify("1")).toEqual({ kind: "ledger-index", index: 1 });
    expect(classify("4294967295")).toEqual({ kind: "ledger-index", index: 4294967295 });
  });

  it("trims the input", () => {
    expect(classify("  107695660 \n")).toEqual({ kind: "ledger-index", index: 107695660 });
  });

  it("finds nothing at either end of the range", () => {
    expect(classify("0")).toEqual({ kind: "none" });
    expect(classify("4294967296")).toEqual({ kind: "none" });
    expect(classify("99999999999999999999")).toEqual({ kind: "none" });
  });

  it("finds nothing in a number that is not plain digits or grouped by thousands", () => {
    expect(classify("-5")).toEqual({ kind: "none" });
    expect(classify("1.5")).toEqual({ kind: "none" });
    expect(classify("1e6")).toEqual({ kind: "none" });
  });

  // The explorer shows a ledger index grouped (`#107,695,660`), and visitors copy it as it is shown.
  it("reads an index grouped by thousands with commas or single spaces", () => {
    expect(classify("107,695,660")).toEqual({ kind: "ledger-index", index: 107695660 });
    expect(classify("107 695 660")).toEqual({ kind: "ledger-index", index: 107695660 });
    expect(classify("  107,695,660\n")).toEqual({ kind: "ledger-index", index: 107695660 });
    expect(classify("1,000")).toEqual({ kind: "ledger-index", index: 1000 });
    expect(classify("12 345")).toEqual({ kind: "ledger-index", index: 12345 });
    expect(classify("4,294,967,295")).toEqual({ kind: "ledger-index", index: 4294967295 });
  });

  it("finds nothing in a grouping that is not by thousands from the first group on", () => {
    expect(classify("1,000,0")).toEqual({ kind: "none" });
    expect(classify("1,0000")).toEqual({ kind: "none" });
    expect(classify("1,00")).toEqual({ kind: "none" });
    expect(classify("1000,000")).toEqual({ kind: "none" });
    expect(classify(",000")).toEqual({ kind: "none" });
    expect(classify("1,000,")).toEqual({ kind: "none" });
    expect(classify("107 695 66")).toEqual({ kind: "none" });
    expect(classify("107  695  660")).toEqual({ kind: "none" });
  });

  it("finds nothing in groups that mix separators", () => {
    expect(classify("107,695 660")).toEqual({ kind: "none" });
    expect(classify("107 695,660")).toEqual({ kind: "none" });
    expect(classify("1,000 000")).toEqual({ kind: "none" });
  });

  it("finds nothing in a grouped number outside the range of ledger indexes", () => {
    expect(classify("0,000")).toEqual({ kind: "none" });
    expect(classify("4,294,967,296")).toEqual({ kind: "none" });
    expect(classify("99,999,999,999,999")).toEqual({ kind: "none" });
  });
});

describe("classify: hash", () => {
  it("reads 64 hex digits as a hash, in upper case", () => {
    expect(classify(HASH)).toEqual({ kind: "hash", hash: HASH });
    expect(classify(HASH.toLowerCase())).toEqual({ kind: "hash", hash: HASH });
  });

  it("drops a 0x prefix and the whitespace around the input", () => {
    expect(classify(` 0x${HASH.toLowerCase()}\n`)).toEqual({ kind: "hash", hash: HASH });
    expect(classify(`0X${HASH}`)).toEqual({ kind: "hash", hash: HASH });
  });

  it("is a hash even when all 64 digits are decimal", () => {
    const digits = "1234567890".repeat(6) + "1234";
    expect(classify(digits)).toEqual({ kind: "hash", hash: digits });
  });

  it("finds nothing in the wrong length or a non-hex digit", () => {
    expect(classify(HASH.slice(1))).toEqual({ kind: "none" });
    expect(classify(`${HASH}A`)).toEqual({ kind: "none" });
    expect(classify(`G${HASH.slice(1)}`)).toEqual({ kind: "none" });
    expect(classify(`0x0x${HASH}`)).toEqual({ kind: "none" });
  });
});

describe("classify: CTID", () => {
  it("reads a CTID and decodes it, in upper case", () => {
    expect(classify("C66B4E2C000C0000")).toEqual({
      kind: "ctid",
      ctid: "C66B4E2C000C0000",
      ledgerIndex: 107695660,
      txIndex: 12,
      networkId: 0,
    });
    expect(classify("c66b4e2c000c0000")).toEqual({
      kind: "ctid",
      ctid: "C66B4E2C000C0000",
      ledgerIndex: 107695660,
      txIndex: 12,
      networkId: 0,
    });
  });

  it("decodes the network id of a Xahau CTID", () => {
    expect(classify(" C10AC4A1000C5359 ")).toEqual({
      kind: "ctid",
      ctid: "C10AC4A1000C5359",
      ledgerIndex: 17482913,
      txIndex: 12,
      networkId: 21337,
    });
  });

  it("finds nothing in 15 or 17 digits, or a first digit other than C", () => {
    expect(classify("C66B4E2C000C000")).toEqual({ kind: "none" });
    expect(classify("C66B4E2C000C00000")).toEqual({ kind: "none" });
    expect(classify("D66B4E2C000C0000")).toEqual({ kind: "none" });
  });
});

describe("classify: account", () => {
  it("reads a classic address", () => {
    expect(classify(ADDRESS)).toEqual({ kind: "account", address: ADDRESS });
    expect(classify(`  ${ADDRESS}\n`)).toEqual({ kind: "account", address: ADDRESS });
  });

  it("keeps the case of an address, which is part of it", () => {
    expect(classify(ADDRESS.toLowerCase())).toEqual({ kind: "none" });
  });

  it("finds nothing in an address with one character changed", () => {
    expect(classify(changeOneCharacter(ADDRESS, 10))).toEqual({ kind: "none" });
    expect(classify(changeOneCharacter(ADDRESS, 1))).toEqual({ kind: "none" });
    expect(classify(ADDRESS.slice(0, -1))).toEqual({ kind: "none" });
  });

  it("reads an X-address as the classic address and the tag inside it", () => {
    expect(classify(X_ADDRESS_WITH_TAG)).toEqual({ kind: "account", address: ADDRESS, tag: 104882 });
  });

  it("gives an X-address without a tag no tag", () => {
    const result = classify(X_ADDRESS_NO_TAG);
    expect(result).toEqual({ kind: "account", address: ADDRESS });
    expect(result).not.toHaveProperty("tag");
  });

  it("finds nothing in an X-address with one character changed", () => {
    expect(classify(changeOneCharacter(X_ADDRESS_WITH_TAG, 20))).toEqual({ kind: "none" });
  });
});

describe("classify: nothing", () => {
  it("finds nothing in text, whitespace or an empty box", () => {
    expect(classify("hello")).toEqual({ kind: "none" });
    expect(classify("")).toEqual({ kind: "none" });
    expect(classify("   \n")).toEqual({ kind: "none" });
    expect(classify("xrpl.org")).toEqual({ kind: "none" });
  });
});
