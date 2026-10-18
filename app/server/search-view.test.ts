import { describe, expect, it } from "vitest";

import { choicePage, ctidNotFoundPage, hashNotFoundPage, helpPage, otherNetworkPage, shownQuery } from "./search-view";

const HASH = "4BC50C9B0D8515D3EAAE1E74B29A95804346C491EE1A95BF25E4AAB854A6A651";
const XAHAU = { id: "xahau", name: "Xahau" } as const;
const XRPL = { id: "xrpl", name: "XRPL" } as const;

describe("shownQuery", () => {
  it("trims what was typed", () => {
    expect(shownQuery("  hello \n")).toBe("hello");
    expect(shownQuery("")).toBe("");
  });

  it("cuts a long input short, with an ellipsis", () => {
    expect(shownQuery("x".repeat(200))).toBe("x".repeat(200));
    expect(shownQuery("x".repeat(201))).toBe(`${"x".repeat(200)}…`);
  });
});

describe("the pages", () => {
  it("builds the choice from the hash and what was found", () => {
    expect(choicePage(HASH, { tx: { ledgerIndex: 5, type: "Payment" }, ledger: { index: 6, closeTime: 7 } })).toEqual({
      kind: "choice",
      hash: HASH,
      tx: { ledgerIndex: 5, type: "Payment" },
      ledger: { index: 6, closeTime: 7 },
    });
  });

  it("builds the help from what was typed", () => {
    expect(helpPage("hello")).toEqual({ kind: "help", query: "hello" });
  });

  it("builds the offer of a CTID of the other network", () => {
    expect(otherNetworkPage("c10ac4a1000c5359", "C10AC4A1000C5359", XAHAU)).toEqual({
      kind: "other-network",
      query: "c10ac4a1000c5359",
      ctid: "C10AC4A1000C5359",
      other: XAHAU,
    });
  });

  it("offers the same hash on the other network when a hash is not found, in upper case whatever was typed", () => {
    expect(hashNotFoundPage(HASH.toLowerCase(), HASH, XAHAU)).toEqual({
      kind: "not-found",
      query: HASH.toLowerCase(),
      what: "transaction or ledger 4BC50C…A651",
      suggestion: { href: `/xahau/search?q=${HASH}`, label: "Search on Xahau" },
    });
    expect(hashNotFoundPage(HASH, HASH, XRPL)).toMatchObject({
      suggestion: { href: `/xrpl/search?q=${HASH}`, label: "Search on XRPL" },
    });
  });

  it("does not offer the other network for a CTID, which says which network it is from", () => {
    const missing = ctidNotFoundPage("C10AC4A1000C5359", "C10AC4A1000C5359", 21337, true);
    expect(missing).toEqual({ kind: "not-found", query: "C10AC4A1000C5359", what: "transaction C10AC4A1000C5359" });
    expect(missing).not.toHaveProperty("suggestion");

    const unknown = ctidNotFoundPage("C000000100000001", "C000000100000001", 1, false);
    expect(unknown).toEqual({
      kind: "not-found",
      query: "C000000100000001",
      message: "C000000100000001 is for network id 1, which this explorer does not cover.",
    });
    expect(unknown).not.toHaveProperty("suggestion");
  });
});
