import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { staticClosure, valueImports } from "../../test/support/value-imports";
import { featuresOf, NO_FEATURES } from "../ui/features";
import { collectionLink, collectionPath, nftLink, nftPath, type CollectionKey } from "./nft-link";

const ID = "000B013A95F14B0044F78A264E41713C64B5F89242540EE208C3098E00000D65";
const ISSUER = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const ON = { ...NO_FEATURES, nfts: true };

describe("nftPath and collectionPath", () => {
  it("write an NFT's path and a collection's, with the taxon after the issuer where there is one", () => {
    expect(nftPath("xrpl", ID)).toBe(`/xrpl/nft/${ID}`);
    expect(nftPath("xahau", ID)).toBe(`/xahau/nft/${ID}`);
    expect(collectionPath("xrpl", { issuer: ISSUER, taxon: 1 })).toBe(`/xrpl/nfts/${ISSUER}/1`);
    expect(collectionPath("xrpl", { issuer: ISSUER, taxon: 4294967295 })).toBe(`/xrpl/nfts/${ISSUER}/4294967295`);
    expect(collectionPath("xahau", { issuer: ISSUER })).toBe(`/xahau/nfts/${ISSUER}`);
  });

  it("keep a taxon of 0, which is a taxon and not the lack of one", () => {
    expect(collectionPath("xrpl", { issuer: ISSUER, taxon: 0 })).toBe(`/xrpl/nfts/${ISSUER}/0`);
  });

  it("take the key the data API client takes: CollectionKey is its type, re-exported", () => {
    const key: CollectionKey = { issuer: ISSUER };
    expect(collectionPath("xahau", key)).toBe(`/xahau/nfts/${ISSUER}`);
  });
});

describe("nftLink", () => {
  it("is the NFT's page while NFTS is on, on either network", () => {
    expect(nftLink("xrpl", ID, ON)).toBe(`/xrpl/nft/${ID}`);
    expect(nftLink("xahau", ID, ON)).toBe(`/xahau/nft/${ID}`);
    expect(nftLink("xrpl", ID, ON)).toBe(nftPath("xrpl", ID));
  });

  it("is null, the plain text, while NFTS is off", () => {
    expect(nftLink("xrpl", ID, NO_FEATURES)).toBeNull();
    expect(nftLink("xahau", ID, NO_FEATURES)).toBeNull();
  });

  it("follows NFTS alone: no other switch turns it on, and none turns it off", () => {
    expect(nftLink("xrpl", ID, { ...featuresOf(allSwitches("on")), nfts: false })).toBeNull();
    expect(nftLink("xrpl", ID, { ...featuresOf(allSwitches("off")), nfts: true })).toBe(`/xrpl/nft/${ID}`);
    expect(nftLink("xrpl", ID, featuresOf({ ...allSwitches("off"), NFTS: "on" }))).toBe(`/xrpl/nft/${ID}`);
  });
});

describe("collectionLink", () => {
  it("is the collection's page while NFTS is on: the issuer and taxon on XRPL, the issuer alone on Xahau", () => {
    expect(collectionLink("xrpl", { issuer: ISSUER, taxon: 1 }, ON)).toBe(`/xrpl/nfts/${ISSUER}/1`);
    expect(collectionLink("xrpl", { issuer: ISSUER, taxon: 0 }, ON)).toBe(`/xrpl/nfts/${ISSUER}/0`);
    expect(collectionLink("xahau", { issuer: ISSUER }, ON)).toBe(`/xahau/nfts/${ISSUER}`);
    expect(collectionLink("xrpl", { issuer: ISSUER, taxon: 7 }, ON)).toBe(collectionPath("xrpl", { issuer: ISSUER, taxon: 7 }));
  });

  it("is null, the plain text, while NFTS is off", () => {
    expect(collectionLink("xrpl", { issuer: ISSUER, taxon: 1 }, NO_FEATURES)).toBeNull();
    expect(collectionLink("xrpl", { issuer: ISSUER, taxon: 0 }, NO_FEATURES)).toBeNull();
    expect(collectionLink("xahau", { issuer: ISSUER }, NO_FEATURES)).toBeNull();
    expect(collectionLink("xrpl", { issuer: ISSUER, taxon: 1 }, { ...featuresOf(allSwitches("on")), nfts: false })).toBeNull();
  });
});

describe("the browser bundle", () => {
  // nft-link.ts is what every page with an NFT or a collection link loads (the transaction, account and token pages, the lists). It is pure: it
  // imports the types of the data API client and of the switches, which the compiler erases, and nothing at run time.
  const appDir = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

  it("imports nothing at run time, and so loads no file but itself", () => {
    expect(valueImports(read("domain/nft-link.ts"))).toEqual([]);
    expect(staticClosure(appDir, "domain/nft-link.ts")).toEqual(["domain/nft-link.ts"]);
  });
});
