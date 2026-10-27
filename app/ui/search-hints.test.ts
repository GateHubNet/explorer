import { describe, expect, it } from "vitest";

import { nftWords } from "../domain/nft-params";
import { classify } from "../domain/search";
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
    expect(hintsFor(classify(HASH), "xrpl", { nfts: true })).toEqual([
      { kind: "Transaction, ledger or NFT", detail: HASH, href: `/xrpl/search?q=${HASH}` },
    ]);
    expect(hintsFor(classify(HASH), "xahau", { nfts: true })).toEqual([
      { kind: "Transaction, ledger or URIToken", detail: HASH, href: `/xahau/search?q=${HASH}` },
    ]);
  });

  it("keeps its words without NFTs, whether the option says so or is not given", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      for (const opts of [undefined, {}, { nfts: false }]) {
        expect(hintsFor(classify(HASH), net, opts)[0], `${net} ${JSON.stringify(opts)}`).toMatchObject({ kind: "Transaction or ledger" });
      }
    }
  });

  it("says the token of each network as the NFT pages do (the box does not load their words: every page has the box)", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      expect(hintsFor(classify(HASH), net, { nfts: true })[0]!.kind).toBe(`Transaction, ledger or ${nftWords(net).token}`);
    }
  });

  it("changes nothing else with NFTs: a ledger, an account and a CTID are as they were", () => {
    for (const input of ["107695660", ADDRESS, "c66b4e4c00450000"]) {
      expect(hintsFor(classify(input), "xrpl", { nfts: true })).toEqual(hintsFor(classify(input), "xrpl"));
    }
  });

  it("offers nothing for what is none of those", () => {
    expect(hintsFor(classify("hello"), "xrpl")).toEqual([]);
    expect(hintsFor(classify(""), "xrpl")).toEqual([]);
  });
});
