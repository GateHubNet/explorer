import { describe, expect, it } from "vitest";

import { NO_FEATURES } from "../ui/features";
import { capitalized, hashNouns, hashWhat, joinNouns, NO_HASH_NOUNS } from "./hash-nouns";
import { nftWords } from "./nft-params";

describe("the nouns of a 64-hexadecimal search", () => {
  it("names a transaction and a ledger while NFTS is off, on either network", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      expect(hashNouns(net, { nfts: false })).toEqual(["transaction", "ledger"]);
      expect(hashWhat(net, { nfts: false })).toBe("transaction or ledger");
    }
  });

  it("adds the network's word for its token while NFTS is on, after the ledger (the order the search asks)", () => {
    expect(hashNouns("xrpl", { nfts: true })).toEqual(["transaction", "ledger", "NFT"]);
    expect(hashWhat("xrpl", { nfts: true })).toBe("transaction, ledger or NFT");
    expect(hashNouns("xahau", { nfts: true })).toEqual(["transaction", "ledger", "URIToken"]);
    expect(hashWhat("xahau", { nfts: true })).toBe("transaction, ledger or URIToken");
  });

  it("says the token as the NFT pages do (the box does not load their words: every page has the box)", () => {
    for (const net of ["xrpl", "xahau"] as const) expect(hashNouns(net, { nfts: true }).at(-1)).toBe(nftWords(net).token);
  });

  it("joins any number of nouns the way a sentence does, so that a later feature's noun is one more entry of the list", () => {
    expect(joinNouns([])).toBe("");
    expect(joinNouns(["transaction"])).toBe("transaction");
    expect(joinNouns(["transaction", "ledger"])).toBe("transaction or ledger");
    expect(joinNouns(["transaction", "ledger", "NFT", "ledger object"])).toBe("transaction, ledger, NFT or ledger object");
  });

  it("is read from the layout's Features as they are (a Features is a HashNounOptions), and has every switch off by default", () => {
    expect(hashWhat("xrpl", { ...NO_FEATURES, nfts: true })).toBe("transaction, ledger or NFT");
    expect(hashWhat("xrpl", NO_FEATURES)).toBe("transaction or ledger");
    expect(NO_HASH_NOUNS).toEqual({ nfts: false });
    expect(Object.keys(NO_HASH_NOUNS).every((name) => name in NO_FEATURES)).toBe(true);
  });

  it("writes the first letter in capitals for a title or a label, and nothing else", () => {
    expect(capitalized("transaction, ledger or NFT")).toBe("Transaction, ledger or NFT");
    expect(capitalized("URIToken")).toBe("URIToken");
    expect(capitalized("")).toBe("");
  });
});
