import { describe, expect, it } from "vitest";

import { choicePage, ctidNotFoundPage, hashNotFoundPage, helpPage, otherNetworkPage, shownQuery } from "./search-view";

const HASH = "4BC50C9B0D8515D3EAAE1E74B29A95804346C491EE1A95BF25E4AAB854A6A651";
const ISSUER = "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy";
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

  it("builds the choice of a transaction, a ledger and an NFT, the NFT's row in the words of the network's tokens", () => {
    const tx = { ledgerIndex: 5, type: "Payment" };
    const ledger = { index: 6, closeTime: 7 };
    expect(choicePage(HASH, { tx, ledger, nft: { kind: "nftoken", issuer: ISSUER, taxon: 1, serial: 4127, burned: false } })).toEqual({
      kind: "choice",
      hash: HASH,
      tx,
      ledger,
      nft: { token: "NFT", detail: "#4,127 of rLxc1b…rwMy · taxon 1", burned: false },
    });
  });

  it("builds the choice of two of them, whichever two: the rows that were not found are not there", () => {
    const tx = { ledgerIndex: 5, type: "Payment" };
    const ledger = { index: 6, closeTime: 7 };
    const nft = { kind: "nftoken", issuer: ISSUER, taxon: 0, serial: 1, burned: false } as const;

    const withTx = choicePage(HASH, { tx, nft });
    expect(withTx).toEqual({ kind: "choice", hash: HASH, tx, nft: { token: "NFT", detail: "#1 of rLxc1b…rwMy · taxon 0", burned: false } });
    expect(withTx).not.toHaveProperty("ledger");

    const withLedger = choicePage(HASH, { ledger, nft });
    expect(withLedger).toEqual({ kind: "choice", hash: HASH, ledger, nft: { token: "NFT", detail: "#1 of rLxc1b…rwMy · taxon 0", burned: false } });
    expect(withLedger).not.toHaveProperty("tx");

    // Without an NFT it is what it was: the transaction and the ledger, and no `nft` key.
    expect(choicePage(HASH, { tx, ledger })).not.toHaveProperty("nft");
  });

  it("says 'burned' of a burned NFT, and names a URIToken by its issuer alone: it has no serial and no taxon", () => {
    const tx = { ledgerIndex: 5, type: "URITokenMint" };
    expect(choicePage(HASH, { tx, nft: { kind: "nftoken", issuer: ISSUER, taxon: 4294967295, serial: 1234567, burned: true } })).toMatchObject({
      nft: { token: "NFT", detail: "#1,234,567 of rLxc1b…rwMy · taxon 4,294,967,295", burned: true },
    });
    expect(choicePage(HASH, { tx, nft: { kind: "uritoken", issuer: ISSUER, burned: false } })).toMatchObject({
      nft: { token: "URIToken", detail: "of rLxc1b…rwMy", burned: false },
    });
    expect(choicePage(HASH, { tx, nft: { kind: "uritoken", issuer: ISSUER, burned: true } })).toMatchObject({ nft: { token: "URIToken", burned: true } });
  });

  it("names an NFT without a serial or a taxon by its issuer alone", () => {
    expect(choicePage(HASH, { tx: { ledgerIndex: 5, type: "Payment" }, nft: { kind: "nftoken", issuer: ISSUER, burned: false } })).toMatchObject({
      nft: { token: "NFT", detail: "of rLxc1b…rwMy" },
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
    expect(hashNotFoundPage(HASH.toLowerCase(), HASH, XAHAU, { net: "xrpl", nfts: false })).toEqual({
      kind: "not-found",
      query: HASH.toLowerCase(),
      what: "transaction or ledger 4BC50C…A651",
      suggestion: { href: `/xahau/search?q=${HASH}`, label: "Search on Xahau" },
    });
    expect(hashNotFoundPage(HASH, HASH, XRPL, { net: "xahau", nfts: false })).toMatchObject({
      suggestion: { href: `/xrpl/search?q=${HASH}`, label: "Search on XRPL" },
    });
  });

  it("says what was looked for as the search asked it: with NFTS on an NFT too, a URIToken on Xahau", () => {
    expect(hashNotFoundPage(HASH, HASH, XAHAU, { net: "xrpl", nfts: true })).toMatchObject({ what: "transaction, ledger or NFT 4BC50C…A651" });
    expect(hashNotFoundPage(HASH, HASH, XRPL, { net: "xahau", nfts: true })).toMatchObject({ what: "transaction, ledger or URIToken 4BC50C…A651" });
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
