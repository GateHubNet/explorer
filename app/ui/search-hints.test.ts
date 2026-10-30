import { describe, expect, it } from "vitest";

import { nftWords } from "../domain/nft-params";
import { classify } from "../domain/search";
import { NO_FEATURES } from "./features";
import { hintsFor } from "./search-hints";

const ADDRESS = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const HASH = "67F91E110D4E3E6C2E6DA3D42EDFB36D9860D024406F58A12CDDF09B65057C31";

describe("hintsFor", () => {
  it("sends a ledger index straight to the ledger", () => {
    expect(hintsFor(classify("107695660"), "xahau")).toEqual([
      { kind: "Ledger", detail: "#107,695,660", href: "/xahau/ledger/107695660" },
    ]);
  });

  it("sends an address straight to the account, and keeps the tag of an X-address", () => {
    expect(hintsFor(classify(ADDRESS), "xrpl")).toEqual([
      { kind: "Account", detail: ADDRESS, href: `/xrpl/account/${ADDRESS}` },
    ]);
    expect(hintsFor({ kind: "account", address: ADDRESS, tag: 0 }, "xrpl")[0]!.href).toBe(`/xrpl/account/${ADDRESS}?tag=0`);
  });

  it("leaves a hash and a CTID to the search, which knows what exists and on which network", () => {
    expect(hintsFor(classify(HASH.toLowerCase()), "xrpl")[0]).toMatchObject({ href: `/xrpl/search?q=${HASH}` });
    expect(hintsFor(classify("c66b4e4c00450000"), "xahau")[0]).toMatchObject({
      kind: "Transaction",
      detail: "CTID C66B4E4C00450000",
      href: "/xahau/search?q=C66B4E4C00450000",
    });
  });

  it("says what a hash can be, by network, with NFTs: a transaction, a ledger or an NFT (a URIToken on Xahau)", () => {
    expect(hintsFor(classify(HASH), "xrpl", { nfts: true, ledgerObjects: false })).toEqual([
      { kind: "Transaction, ledger or NFT", detail: HASH, href: `/xrpl/search?q=${HASH}` },
    ]);
    expect(hintsFor(classify(HASH), "xahau", { nfts: true, ledgerObjects: false })).toEqual([
      { kind: "Transaction, ledger or URIToken", detail: HASH, href: `/xahau/search?q=${HASH}` },
    ]);
  });

  // E10: the objects' words, each part only while its switch is on (the spec's "Transaction, ledger, NFT, escrow, check or payment channel").
  it.each([
    ["xrpl", { nfts: false, ledgerObjects: false }, "Transaction or ledger"],
    ["xrpl", { nfts: true, ledgerObjects: false }, "Transaction, ledger or NFT"],
    ["xrpl", { nfts: false, ledgerObjects: true }, "Transaction, ledger, escrow, check or payment channel"],
    ["xrpl", { nfts: true, ledgerObjects: true }, "Transaction, ledger, NFT, escrow, check or payment channel"],
    ["xahau", { nfts: false, ledgerObjects: false }, "Transaction or ledger"],
    ["xahau", { nfts: true, ledgerObjects: false }, "Transaction, ledger or URIToken"],
    ["xahau", { nfts: false, ledgerObjects: true }, "Transaction, ledger, escrow, check or payment channel"],
    ["xahau", { nfts: true, ledgerObjects: true }, "Transaction, ledger, URIToken, escrow, check or payment channel"],
  ] as const)("says what a hash can be on %s with %j: %s", (net, features, words) => {
    expect(hintsFor(classify(HASH), net, features)).toEqual([{ kind: words, detail: HASH, href: `/${net}/search?q=${HASH}` }]);
  });

  it("keeps its words without NFTs or objects, whether the switches say so or are not given", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      for (const opts of [undefined, { nfts: false, ledgerObjects: false }, NO_FEATURES]) {
        expect(hintsFor(classify(HASH), net, opts)[0], `${net} ${JSON.stringify(opts)}`).toMatchObject({ kind: "Transaction or ledger" });
      }
    }
  });

  it("says the token of each network as the NFT pages do (the box does not load their words: every page has the box)", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      expect(hintsFor(classify(HASH), net, { nfts: true, ledgerObjects: false })[0]!.kind).toBe(`Transaction, ledger or ${nftWords(net).token}`);
    }
  });

  it("takes the layout's Features as they are, as the box passes them: the switches of the words are the Features' own", () => {
    expect(hintsFor(classify(HASH), "xrpl", { ...NO_FEATURES, nfts: true })[0]!.kind).toBe("Transaction, ledger or NFT");
    expect(hintsFor(classify(HASH), "xrpl", { ...NO_FEATURES, ledgerObjects: true })[0]!.kind).toBe("Transaction, ledger, escrow, check or payment channel");
    expect(hintsFor(classify(HASH), "xahau", NO_FEATURES)[0]!.kind).toBe("Transaction or ledger");
  });

  it("changes nothing else with NFTs or objects: a ledger, an account and a CTID are as they were", () => {
    for (const input of ["107695660", ADDRESS, "c66b4e4c00450000"]) {
      for (const features of [{ nfts: true, ledgerObjects: false }, { nfts: false, ledgerObjects: true }, { nfts: true, ledgerObjects: true }]) {
        expect(hintsFor(classify(input), "xrpl", features)).toEqual(hintsFor(classify(input), "xrpl"));
      }
    }
  });

  it("offers nothing for what is none of those", () => {
    expect(hintsFor(classify("hello"), "xrpl")).toEqual([]);
    expect(hintsFor(classify(""), "xrpl")).toEqual([]);
  });
});
