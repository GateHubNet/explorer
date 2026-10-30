import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import { staticClosure, valueImports } from "../../test/support/value-imports";
import type { NftPeriod as ApiPeriod, NftSort as ApiSort } from "../server/api-types";
import { redirectToCanonical } from "../server/pair-route";
import * as nftLinkModule from "./nft-link";
import {
  ARROW,
  COLLECTION_TABS,
  NFT_MEASURES,
  NFT_PERIODS,
  NFT_SORTS,
  collectionHref,
  collectionLabel,
  collectionPath,
  nftHref,
  nftPath,
  nftSalesHref,
  nftWords,
  nftsHref,
  parseCollectionParams,
  parseNftParams,
  parseNftSalesParams,
  parseNftsParams,
  parseTaxon,
  shortNftId,
  type CollectionKey,
  type CollectionQuery,
  type NftPeriod,
  type NftQuery,
  type NftSalesQuery,
  type NftSort,
  type NftsQuery,
} from "./nft-params";
import { queryOf } from "./query-of";

const ISSUER = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const ID = "000813880000000000000000000000000000000000000000000000000000101F";
const XRPL_KEY: CollectionKey = { issuer: ISSUER, taxon: 1 };
const XAHAU_KEY: CollectionKey = { issuer: ISSUER };
const COLLECTION = `/xrpl/nfts/${ISSUER}/1`;
const NFT = `/xrpl/nft/${ID}`;

const nfts = (query: string) => parseNftsParams(new URLSearchParams(query));
const sales = (query: string) => parseNftSalesParams(new URLSearchParams(query));
const collection = (query: string) => parseCollectionParams(new URLSearchParams(query));
const nft = (query: string) => parseNftParams(new URLSearchParams(query));
/** The canonical URL of a query: the href of what it names. */
const nftsCanonical = (query: string) => nftsHref("xrpl", nfts(query));
const salesCanonical = (query: string) => nftSalesHref("xrpl", sales(query));
const collectionCanonical = (query: string) => collectionHref("xrpl", XRPL_KEY, collection(query));
const nftCanonical = (query: string) => nftHref("xrpl", ID, nft(query));
/** The query of a URL after a URL parser has serialized it, as a loader sees `request.url`. */
const serialized = (href: string) => new URL(`https://h${href}`).search;
const queryOfHref = (href: string) => (href.includes("?") ? href.slice(href.indexOf("?")) : "");

describe("the tables", () => {
  it("has the periods, the sorts, the measures and the tabs, in the order of their selectors; the first is the default", () => {
    expect([...NFT_PERIODS]).toEqual(["day", "7day", "30day"]);
    expect([...NFT_SORTS]).toEqual(["volume", "supply", "holders"]);
    expect([...NFT_MEASURES]).toEqual(["volume", "sales", "avg", "low"]);
    expect([...COLLECTION_TABS]).toEqual(["sales", "nfts", "holders"]);
  });

  it("lists exactly the members of the unions D3's client declares (api-types.ts): a union that grows fails the compile here", () => {
    expectTypeOf<(typeof NFT_PERIODS)[number]>().toEqualTypeOf<ApiPeriod>();
    expectTypeOf<(typeof NFT_SORTS)[number]>().toEqualTypeOf<ApiSort>();
    expectTypeOf<NftPeriod>().toEqualTypeOf<ApiPeriod>();
    expectTypeOf<NftSort>().toEqualTypeOf<ApiSort>();
  });

  it("has the periods in the words of D3's 400 for any other: invalid period - use: day, 7day, 30day", () => {
    expect(NFT_PERIODS.join(", ")).toBe("day, 7day, 30day");
  });

  it("re-exports nft-link.ts's paths, the same functions and not copies", () => {
    expect(nftPath).toBe(nftLinkModule.nftPath);
    expect(collectionPath).toBe(nftLinkModule.collectionPath);
  });
});

describe("parseNftsParams and nftsHref: the canonical form of a list query", () => {
  it.each([
    ["", "/xrpl/nfts"],
    ["period=day", "/xrpl/nfts"],
    ["period=7day", "/xrpl/nfts?period=7day"],
    ["period=30day", "/xrpl/nfts?period=30day"],
    ["sort=supply", "/xrpl/nfts?sort=supply"],
    ["sort=holders", "/xrpl/nfts?sort=holders"],
    ["order=asc", "/xrpl/nfts?order=asc"],
    ["period=7day&sort=supply&order=asc", "/xrpl/nfts?period=7day&sort=supply&order=asc"],
    ["order=asc&sort=supply&period=7day", "/xrpl/nfts?period=7day&sort=supply&order=asc"],
    ["order=desc&sort=volume&period=day", "/xrpl/nfts"],
    ["issuer=%20rI%20", "/xrpl/nfts?issuer=rI"],
    ["issuer=rI", "/xrpl/nfts?issuer=rI"],
    ["issuer=rI&issuer=rJ", "/xrpl/nfts?issuer=rI"],
    ["issuer=", "/xrpl/nfts"],
    ["issuer=%20%20", "/xrpl/nfts"],
    ["sort=holders&issuer=rI&order=asc&period=30day", "/xrpl/nfts?period=30day&issuer=rI&sort=holders&order=asc"],
    ["marker=M2&period=7day&back=M1", "/xrpl/nfts?marker=M2&back=M1"],
    ["back=M1&order=asc&sort=supply&issuer=rI&marker=M2", "/xrpl/nfts?issuer=rI&sort=supply&order=asc&marker=M2&back=M1"],
    ["marker=M3&back=M2.M1", "/xrpl/nfts?marker=M3&back=M2.M1"],
    ["back=M1", "/xrpl/nfts"],
    ["issuer=rI&back=M1", "/xrpl/nfts?issuer=rI"],
    ["x=1", "/xrpl/nfts"],
    ["x=1&sort=supply&y=2", "/xrpl/nfts?sort=supply"],
    ["tab=nfts&measure=avg&offers=1&burned=1&owner=rO", "/xrpl/nfts"],
    ["sort=a&sort=supply", "/xrpl/nfts"],
    ["sort=supply&sort=a", "/xrpl/nfts?sort=supply"],
    ["period=7day&period=30day", "/xrpl/nfts?period=7day"],
    ["period=bogus&period=7day", "/xrpl/nfts"],
    ["order=asc&order=desc", "/xrpl/nfts?order=asc"],
    ["order=desc&order=asc", "/xrpl/nfts"],
  ])("%j is %s", (query, href) => {
    expect(nftsCanonical(query)).toBe(href);
  });

  it("reads the periods, the sorts and the order as they are written: in any other case they are unknown values", () => {
    expect(nftsCanonical("period=1day&period=7DAY&sort=Supply&order=ASC")).toBe("/xrpl/nfts");
    expect(nftsCanonical("period=24h&sort=sales&order=ascending")).toBe("/xrpl/nfts");
    expect(nftsCanonical("period=&sort=&order=")).toBe("/xrpl/nfts");
    expect(nftsCanonical("period=%37day")).toBe("/xrpl/nfts?period=7day");
  });

  it("returns the view a query names", () => {
    expect(nfts("")).toEqual({ period: "day", sort: "volume", order: "desc", back: [] });
    expect(nfts("period=7day&sort=supply&order=asc&issuer=rI")).toEqual({ period: "7day", issuer: "rI", sort: "supply", order: "asc", back: [] });
    expect(nfts("marker=M2&back=M1&issuer=rI")).toEqual({ period: "day", issuer: "rI", sort: "volume", order: "desc", marker: "M2", back: ["M1"] });
  });

  it("gives the default period behind a marker (that page has no tiles or chart), and keeps the issuer, the sort and the order", () => {
    expect(nfts("marker=M1&period=30day&sort=holders&order=asc&issuer=rI")).toEqual({
      period: "day",
      issuer: "rI",
      sort: "holders",
      order: "asc",
      marker: "M1",
      back: [],
    });
  });

  it("keeps an issuer as it is given, trimmed, for the loader to check: it does not check an address", () => {
    expect(nfts("issuer=%20not%20an%20address%20").issuer).toBe("not an address");
    expect(nfts("issuer=r+I").issuer).toBe("r I");
    expect(nfts("issuer=%09rI%0A").issuer).toBe("rI");
    expect(nfts("issuer=").issuer).toBeUndefined();
    expect(nfts("").issuer).toBeUndefined();
    expect("issuer" in nfts("")).toBe(false);
  });

  it("gives a trail only behind a marker, and only one that parseTrail accepts", () => {
    expect(nfts("marker=M3&back=M2.M1").back).toEqual(["M2", "M1"]);
    expect(nfts("back=M2.M1").back).toEqual([]);
    expect(nfts("marker=M3&back=M2.bad!").back).toEqual([]);
    expect(nfts("marker=M3&back=").back).toEqual([]);
    const eleven = Array.from({ length: 11 }, (_, at) => `M${at}`).join(".");
    expect(nfts(`marker=M3&back=${eleven}`).back).toEqual([]);
    expect(nfts(`marker=M3&back=${eleven.split(".").slice(0, 10).join(".")}`).back).toHaveLength(10);
  });

  it("returns the marker as it was given, whatever it is: the loader checks isMarker and answers 404", () => {
    expect(nfts("marker=a%27b").marker).toBe("a'b");
    expect(nfts("marker=").marker).toBe("");
    expect(nfts("marker=not%20one").marker).toBe("not one");
    expect(nfts("marker=M1&marker=M2").marker).toBe("M1");
    expect(nftsCanonical("marker=")).toBe("/xrpl/nfts?marker=");
  });
});

describe("nftsHref", () => {
  it("is the list with no query for the default view and for no query", () => {
    expect(nftsHref("xrpl")).toBe("/xrpl/nfts");
    expect(nftsHref("xrpl", {})).toBe("/xrpl/nfts");
    expect(nftsHref("xrpl", { period: "day", sort: "volume", order: "desc", back: [] })).toBe("/xrpl/nfts");
    expect(nftsHref("xahau")).toBe("/xahau/nfts");
  });

  it("writes period, issuer, sort, order, marker and back, in that order, and leaves out what is the default's", () => {
    expect(nftsHref("xrpl", { period: "7day" })).toBe("/xrpl/nfts?period=7day");
    expect(nftsHref("xrpl", { sort: "volume", order: "asc" })).toBe("/xrpl/nfts?order=asc");
    expect(nftsHref("xrpl", { order: "asc", sort: "holders", issuer: ISSUER, period: "30day" })).toBe(
      `/xrpl/nfts?period=30day&issuer=${ISSUER}&sort=holders&order=asc`,
    );
    expect(nftsHref("xrpl", { sort: "supply", order: "asc", marker: "M3", back: ["M2", "M1"] })).toBe("/xrpl/nfts?sort=supply&order=asc&marker=M3&back=M2.M1");
  });

  it("writes order only as asc, and an issuer only when it is not empty: it trims it, as the parse does", () => {
    expect(nftsHref("xrpl", { order: "desc" })).toBe("/xrpl/nfts");
    expect(nftsHref("xrpl", { issuer: "" })).toBe("/xrpl/nfts");
    expect(nftsHref("xrpl", { issuer: "  " })).toBe("/xrpl/nfts");
    expect(nftsHref("xrpl", { issuer: " rI " })).toBe("/xrpl/nfts?issuer=rI");
    expect(nftsHref("xrpl", { issuer: undefined })).toBe("/xrpl/nfts");
  });

  it("leaves out the period beside a marker, and writes the trail only behind one", () => {
    expect(nftsHref("xrpl", { period: "30day", marker: "M1" })).toBe("/xrpl/nfts?marker=M1");
    expect(nftsHref("xrpl", { back: ["M2"] })).toBe("/xrpl/nfts");
    expect(nftsHref("xrpl", { period: "7day", back: ["M2"] })).toBe("/xrpl/nfts?period=7day");
    expect(nftsHref("xrpl", { marker: "M3", back: [] })).toBe("/xrpl/nfts?marker=M3");
    expect(nftsHref("xrpl", { marker: "M3" })).toBe("/xrpl/nfts?marker=M3");
    expect(nftsHref("xrpl", { marker: undefined, back: [] })).toBe("/xrpl/nfts");
  });

  it("is the href of the trailPaging shapes: the first page has neither marker nor trail", () => {
    expect(nftsHref("xrpl", { sort: "supply", back: [] })).toBe("/xrpl/nfts?sort=supply");
    expect(nftsHref("xrpl", { sort: "supply", marker: "M2", back: ["M1"] })).toBe("/xrpl/nfts?sort=supply&marker=M2&back=M1");
  });

  it("does not change the trail it is given", () => {
    const back = ["M2", "M1"];
    nftsHref("xrpl", { marker: "M3", back });
    expect(back).toEqual(["M2", "M1"]);
  });
});

describe("parseNftSalesParams and nftSalesHref: the canonical form of the older sales' query", () => {
  it.each([
    ["", "/xrpl/nfts/sales"],
    ["marker=M1", "/xrpl/nfts/sales?marker=M1"],
    ["marker=M3&back=M2.M1", "/xrpl/nfts/sales?marker=M3&back=M2.M1"],
    ["back=M2.M1&marker=M3", "/xrpl/nfts/sales?marker=M3&back=M2.M1"],
    ["marker=M1&marker=M2", "/xrpl/nfts/sales?marker=M1"],
    ["back=M1", "/xrpl/nfts/sales"],
    ["marker=M3&back=M2.bad!", "/xrpl/nfts/sales?marker=M3"],
    ["period=7day&sort=supply&issuer=rI&x=1", "/xrpl/nfts/sales"],
    ["marker=M1&period=7day", "/xrpl/nfts/sales?marker=M1"],
  ])("%j is %s", (query, href) => {
    expect(salesCanonical(query)).toBe(href);
  });

  it("returns the view a query names", () => {
    expect(sales("")).toEqual({ back: [] });
    expect(sales("marker=M3&back=M2.M1")).toEqual({ marker: "M3", back: ["M2", "M1"] });
    expect(sales("back=M2")).toEqual({ back: [] });
    expect(sales("marker=").marker).toBe("");
  });

  it("writes the page's path, then marker and back, behind a marker only", () => {
    expect(nftSalesHref("xrpl")).toBe("/xrpl/nfts/sales");
    expect(nftSalesHref("xahau", {})).toBe("/xahau/nfts/sales");
    expect(nftSalesHref("xrpl", { marker: "M1" })).toBe("/xrpl/nfts/sales?marker=M1");
    expect(nftSalesHref("xrpl", { marker: "M2", back: ["M1"] })).toBe("/xrpl/nfts/sales?marker=M2&back=M1");
    expect(nftSalesHref("xrpl", { back: ["M1"] })).toBe("/xrpl/nfts/sales");
    expect(nftSalesHref("xrpl", { marker: undefined, back: [] })).toBe("/xrpl/nfts/sales");
  });
});

describe("parseCollectionParams and collectionHref: the canonical form of a collection query", () => {
  it.each([
    ["", COLLECTION],
    ["measure=volume&tab=sales", COLLECTION],
    ["measure=sales", `${COLLECTION}?measure=sales`],
    ["measure=avg", `${COLLECTION}?measure=avg`],
    ["measure=low", `${COLLECTION}?measure=low`],
    ["tab=holders&measure=avg", `${COLLECTION}?measure=avg&tab=holders`],
    ["tab=nfts", `${COLLECTION}?tab=nfts`],
    ["owner=rO&tab=sales", COLLECTION],
    ["owner=rO", COLLECTION],
    ["owner=rO&tab=holders", `${COLLECTION}?tab=holders`],
    ["burned=1&tab=sales", COLLECTION],
    ["burned=1", COLLECTION],
    ["burned=1&tab=holders&owner=rO", `${COLLECTION}?tab=holders`],
    ["tab=nfts&burned=1&owner=rO", `${COLLECTION}?tab=nfts&owner=rO&burned=1`],
    ["owner=rO&burned=1&tab=nfts", `${COLLECTION}?tab=nfts&owner=rO&burned=1`],
    ["burned=yes&tab=nfts", `${COLLECTION}?tab=nfts`],
    ["burned=true&tab=nfts", `${COLLECTION}?tab=nfts`],
    ["burned=0&tab=nfts", `${COLLECTION}?tab=nfts`],
    ["burned=&tab=nfts", `${COLLECTION}?tab=nfts`],
    ["burned=1&burned=0&tab=nfts", `${COLLECTION}?tab=nfts&burned=1`],
    ["burned=0&burned=1&tab=nfts", `${COLLECTION}?tab=nfts`],
    ["tab=nfts&owner=%20rO%20", `${COLLECTION}?tab=nfts&owner=rO`],
    ["tab=nfts&owner=rO&owner=rP", `${COLLECTION}?tab=nfts&owner=rO`],
    ["tab=nfts&owner=", `${COLLECTION}?tab=nfts`],
    ["tab=nfts&owner=%20", `${COLLECTION}?tab=nfts`],
    ["measure=bogus", COLLECTION],
    ["tab=bogus", COLLECTION],
    ["measure=avg&measure=low", `${COLLECTION}?measure=avg`],
    ["measure=bogus&measure=low", COLLECTION],
    ["tab=holders&tab=nfts", `${COLLECTION}?tab=holders`],
    ["marker=M1&measure=avg&tab=holders", `${COLLECTION}?tab=holders&marker=M1`],
    ["marker=M1&tab=nfts&owner=rO&burned=1&back=M0", `${COLLECTION}?tab=nfts&owner=rO&burned=1&marker=M1&back=M0`],
    ["marker=M3&back=M2.M1", `${COLLECTION}?marker=M3&back=M2.M1`],
    ["back=M0", COLLECTION],
    ["tab=nfts&back=M0", `${COLLECTION}?tab=nfts`],
    ["x=1", COLLECTION],
    ["period=7day&sort=supply&issuer=rI&offers=1", COLLECTION],
  ])("%j is %s", (query, href) => {
    expect(collectionCanonical(query)).toBe(href);
  });

  it("returns the view a query names", () => {
    expect(collection("")).toEqual({ measure: "volume", tab: "sales", burned: false, back: [] });
    expect(collection("measure=avg&tab=holders")).toEqual({ measure: "avg", tab: "holders", burned: false, back: [] });
    expect(collection("tab=nfts&owner=rO&burned=1")).toEqual({ measure: "volume", tab: "nfts", owner: "rO", burned: true, back: [] });
    expect(collection("tab=nfts&burned=1")).toEqual({ measure: "volume", tab: "nfts", burned: true, back: [] });
  });

  it("keeps owner and burned only with the NFTs tab: on another tab they are not the view's", () => {
    expect(collection("owner=rO&burned=1")).toEqual({ measure: "volume", tab: "sales", burned: false, back: [] });
    expect(collection("tab=holders&owner=rO&burned=1")).toEqual({ measure: "volume", tab: "holders", burned: false, back: [] });
    expect("owner" in collection("tab=sales&owner=rO")).toBe(false);
  });

  it("gives the default measure behind a marker (that page has no chart), and keeps the tab and its filters", () => {
    expect(collection("marker=M1&measure=low&tab=nfts&owner=rO&burned=1")).toEqual({
      measure: "volume",
      tab: "nfts",
      owner: "rO",
      burned: true,
      marker: "M1",
      back: [],
    });
  });

  it("keeps an owner as it is given, trimmed, for the loader to check", () => {
    expect(collection("tab=nfts&owner=%20not%20an%20address%20").owner).toBe("not an address");
    expect(collection("tab=nfts&owner=").owner).toBeUndefined();
  });

  it("returns the marker as it was given, whatever it is, and a trail only behind one", () => {
    expect(collection("marker=").marker).toBe("");
    expect(collection("marker=a%27b").marker).toBe("a'b");
    expect(collection("marker=M3&back=M2.M1").back).toEqual(["M2", "M1"]);
    expect(collection("back=M2.M1").back).toEqual([]);
  });
});

describe("collectionHref", () => {
  it("is the collection's path with no query for the default view: the issuer and the taxon on XRPL, the issuer alone on Xahau", () => {
    expect(collectionHref("xrpl", XRPL_KEY)).toBe(COLLECTION);
    expect(collectionHref("xrpl", XRPL_KEY, {})).toBe(COLLECTION);
    expect(collectionHref("xrpl", XRPL_KEY, { measure: "volume", tab: "sales", burned: false, back: [] })).toBe(COLLECTION);
    expect(collectionHref("xahau", { issuer: ISSUER })).toBe(`/xahau/nfts/${ISSUER}`);
    expect(collectionHref("xahau", XAHAU_KEY, { tab: "holders" })).toBe(`/xahau/nfts/${ISSUER}?tab=holders`);
  });

  it("keeps a taxon of 0, which is a taxon and not the lack of one, and the largest taxon", () => {
    expect(collectionHref("xrpl", { issuer: ISSUER, taxon: 0 })).toBe(`/xrpl/nfts/${ISSUER}/0`);
    expect(collectionHref("xrpl", { issuer: ISSUER, taxon: 4294967295 }, { tab: "nfts" })).toBe(`/xrpl/nfts/${ISSUER}/4294967295?tab=nfts`);
  });

  it("is collectionPath's path, then ? and the query, or the path alone when there is no query", () => {
    for (const key of [XRPL_KEY, XAHAU_KEY, { issuer: ISSUER, taxon: 0 }]) {
      expect(collectionHref("xrpl", key)).toBe(collectionPath("xrpl", key));
      expect(collectionHref("xrpl", key, { measure: "avg" })).toBe(`${collectionPath("xrpl", key)}?measure=avg`);
    }
  });

  it("writes measure, tab, owner, burned, marker and back, in that order, and leaves out what is the default's", () => {
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "holders", measure: "avg" })).toBe(`${COLLECTION}?measure=avg&tab=holders`);
    expect(collectionHref("xrpl", XRPL_KEY, { burned: true, owner: ISSUER, tab: "nfts" })).toBe(`${COLLECTION}?tab=nfts&owner=${ISSUER}&burned=1`);
    expect(collectionHref("xrpl", XRPL_KEY, { measure: "low", tab: "nfts", owner: "rO", burned: true, marker: "M3", back: ["M2", "M1"] })).toBe(
      `${COLLECTION}?tab=nfts&owner=rO&burned=1&marker=M3&back=M2.M1`,
    );
    expect(collectionHref("xrpl", XRPL_KEY, { measure: "volume", tab: "sales" })).toBe(COLLECTION);
  });

  it("writes owner and burned only with the NFTs tab, burned only as 1, and an owner only when it is not empty, trimmed", () => {
    expect(collectionHref("xrpl", XRPL_KEY, { owner: "rO", burned: true })).toBe(COLLECTION);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "sales", owner: "rO", burned: true })).toBe(COLLECTION);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "holders", owner: "rO", burned: true })).toBe(`${COLLECTION}?tab=holders`);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "nfts", burned: false })).toBe(`${COLLECTION}?tab=nfts`);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "nfts", owner: "" })).toBe(`${COLLECTION}?tab=nfts`);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "nfts", owner: " " })).toBe(`${COLLECTION}?tab=nfts`);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "nfts", owner: " rO " })).toBe(`${COLLECTION}?tab=nfts&owner=rO`);
  });

  it("leaves out the measure beside a marker, and writes the trail only behind one", () => {
    expect(collectionHref("xrpl", XRPL_KEY, { measure: "avg", marker: "M1" })).toBe(`${COLLECTION}?marker=M1`);
    expect(collectionHref("xrpl", XRPL_KEY, { measure: "avg", back: ["M1"] })).toBe(`${COLLECTION}?measure=avg`);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "holders", marker: "M2", back: ["M1"] })).toBe(`${COLLECTION}?tab=holders&marker=M2&back=M1`);
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "holders", marker: "M2", back: [] })).toBe(`${COLLECTION}?tab=holders&marker=M2`);
  });
});

describe("parseNftParams and nftHref: the canonical form of an NFT query", () => {
  it.each([
    ["", NFT],
    ["offers=1", `${NFT}?offers=1`],
    ["offers=1&marker=M", `${NFT}?offers=1&marker=M`],
    ["marker=M&offers=1", `${NFT}?offers=1&marker=M`],
    ["offers=0", NFT],
    ["offers=true", NFT],
    ["offers=yes", NFT],
    ["offers=", NFT],
    ["offers=1&offers=0", `${NFT}?offers=1`],
    ["offers=0&offers=1", NFT],
    ["marker=M2&back=M1", `${NFT}?marker=M2&back=M1`],
    ["offers=1&marker=M3&back=M2.M1", `${NFT}?offers=1&marker=M3&back=M2.M1`],
    ["back=M1", NFT],
    ["offers=1&back=M1", `${NFT}?offers=1`],
    ["x=1&period=7day&tab=nfts", NFT],
  ])("%j is %s", (query, href) => {
    expect(nftCanonical(query)).toBe(href);
  });

  it("returns the view a query names", () => {
    expect(nft("")).toEqual({ offers: false, back: [] });
    expect(nft("offers=1")).toEqual({ offers: true, back: [] });
    expect(nft("offers=1&marker=M3&back=M2.M1")).toEqual({ offers: true, marker: "M3", back: ["M2", "M1"] });
    expect(nft("marker=").marker).toBe("");
  });

  it("keeps offers beside a marker: the history's next page shows the same events", () => {
    expect(nft("marker=M1&offers=1").offers).toBe(true);
  });

  it("writes the NFT's path, then offers, marker and back", () => {
    expect(nftHref("xrpl", ID)).toBe(NFT);
    expect(nftHref("xahau", ID, {})).toBe(`/xahau/nft/${ID}`);
    expect(nftHref("xrpl", ID, { offers: false, back: [] })).toBe(NFT);
    expect(nftHref("xrpl", ID, { offers: true })).toBe(`${NFT}?offers=1`);
    expect(nftHref("xrpl", ID, { offers: true, marker: "M2", back: ["M1"] })).toBe(`${NFT}?offers=1&marker=M2&back=M1`);
    expect(nftHref("xrpl", ID, { back: ["M1"] })).toBe(NFT);
    expect(nftHref("xrpl", ID)).toBe(nftPath("xrpl", ID));
  });
});

describe("parseTaxon", () => {
  it("reads a decimal UInt32 and gives its number and its plain form", () => {
    expect(parseTaxon("0")).toEqual({ taxon: 0, plain: "0" });
    expect(parseTaxon("1")).toEqual({ taxon: 1, plain: "1" });
    expect(parseTaxon("500")).toEqual({ taxon: 500, plain: "500" });
    expect(parseTaxon("4294967295")).toEqual({ taxon: 4294967295, plain: "4294967295" });
  });

  it("gives the plain form of a taxon with leading zeros, which the loader redirects to", () => {
    expect(parseTaxon("01")).toEqual({ taxon: 1, plain: "1" });
    expect(parseTaxon("00")).toEqual({ taxon: 0, plain: "0" });
    expect(parseTaxon("0000000500")).toEqual({ taxon: 500, plain: "500" });
    expect(parseTaxon("0004294967")).toEqual({ taxon: 4294967, plain: "4294967" });
  });

  it("is null for everything that is no decimal UInt32", () => {
    for (const raw of ["4294967296", "9999999999", "-1", "+1", "1.0", "1.", ".5", "1e3", "0x1", "x", "", " ", " 1", "1 ", "1\n", "１", "1_000", "NaN", "Infinity"]) {
      expect([raw, parseTaxon(raw)]).toEqual([raw, null]);
    }
  });

  it("refuses what D3's taxonParam refuses: more than ten digits are no taxon, even when they are zeros and a small number", () => {
    expect(parseTaxon("0000000001")).toEqual({ taxon: 1, plain: "1" });
    expect(parseTaxon("00000000001")).toBeNull();
    expect(parseTaxon("04294967295")).toBeNull();
    expect(parseTaxon("12345678901")).toBeNull();
  });
});

describe("ARROW", () => {
  it("is the arrow of a seller → buyer with a space on each side: the Accounts cell's text segment that the page draws as an arrow and a hidden 'to'", () => {
    expect(ARROW).toBe(" → ");
  });
});

describe("shortNftId", () => {
  it("is the first 8 characters, an ellipsis and the last 4", () => {
    expect(shortNftId(ID)).toBe("00081388…101F");
    expect(shortNftId("00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255FA9ECC9070655E758")).toBe("00081388…E758");
    expect(shortNftId("A1F04C770000000000000000000000000000000000000000000000000000D10D")).toBe("A1F04C77…D10D");
  });

  it("gives a text that is no longer than its short form as it is", () => {
    expect(shortNftId("")).toBe("");
    expect(shortNftId("00081388101F")).toBe("00081388101F");
    expect(shortNftId("00081388A101F")).toBe("00081388A101F");
    expect(shortNftId("00081388AB101F")).toBe("00081388…101F");
  });
});

describe("collectionLabel", () => {
  it("is the short issuer and the taxon on XRPL", () => {
    expect(collectionLabel({ issuer: "rLULtFd6VSqPcfBwf1PcpsYMmB3R", taxon: 1 })).toBe("rLULtF…mB3R · taxon 1");
    expect(collectionLabel(XRPL_KEY)).toBe("rhWTXC…tcS3 · taxon 1");
  });

  it("is the short issuer alone on Xahau, where the key has no taxon", () => {
    expect(collectionLabel({ issuer: "rEvRt8Qk3XvZtN7cKyW4eFb9HuDpJ2Lk2P" })).toBe("rEvRt8…Lk2P");
    expect(collectionLabel(XAHAU_KEY)).toBe("rhWTXC…tcS3");
  });

  it("keeps a taxon of 0, which is a taxon, and writes a large one with its digits grouped as the page's other numbers are", () => {
    expect(collectionLabel({ issuer: ISSUER, taxon: 0 })).toBe("rhWTXC…tcS3 · taxon 0");
    expect(collectionLabel({ issuer: ISSUER, taxon: 500 })).toBe("rhWTXC…tcS3 · taxon 500");
    expect(collectionLabel({ issuer: ISSUER, taxon: 4294967295 })).toBe("rhWTXC…tcS3 · taxon 4,294,967,295");
  });
});

describe("nftWords", () => {
  it("is the NFT's words on XRPL", () => {
    expect(nftWords("xrpl")).toEqual({
      token: "NFT",
      tokens: "NFTs",
      kindTag: "NFToken",
      collectionTag: "NFToken collection",
      listHeading: "NFTs",
      salesHeading: "NFT sales",
    });
  });

  it("is the URIToken's words on Xahau", () => {
    expect(nftWords("xahau")).toEqual({
      token: "URIToken",
      tokens: "URITokens",
      kindTag: "URIToken",
      collectionTag: "URIToken collection",
      listHeading: "URITokens",
      salesHeading: "URIToken sales",
    });
  });

  it("has the same keys for both networks", () => {
    expect(Object.keys(nftWords("xahau")).sort()).toEqual(Object.keys(nftWords("xrpl")).sort());
  });
});

describe("values are escaped for a query", () => {
  it("writes a marker and the pieces of a trail with encodeURIComponent, and leaves - and _ as they are", () => {
    expect(nftsHref("xrpl", { marker: "AB-cd_EF" })).toBe("/xrpl/nfts?marker=AB-cd_EF");
    expect(nftSalesHref("xrpl", { marker: "M3", back: ["A_b-C", "M1"] })).toBe("/xrpl/nfts/sales?marker=M3&back=A_b-C.M1");
    expect(nftHref("xrpl", ID, { marker: "ab==" })).toBe(`${NFT}?marker=ab%3D%3D`);
    expect(collectionHref("xrpl", XRPL_KEY, { marker: "a b&c=d" })).toBe(`${COLLECTION}?marker=a%20b%26c%3Dd`);
    expect(nftsHref("xrpl", { marker: "a b&c=d", back: ["A+B=", "C/D"] })).toBe("/xrpl/nfts?marker=a%20b%26c%3Dd&back=A%2BB%3D.C%2FD");
  });

  it("writes an issuer and an owner with encodeURIComponent, so that nothing of them ends or splits a value", () => {
    expect(nftsHref("xrpl", { issuer: "a&b=c d#e" })).toBe("/xrpl/nfts?issuer=a%26b%3Dc%20d%23e");
    expect(collectionHref("xrpl", XRPL_KEY, { tab: "nfts", owner: "a&b=c d#e" })).toBe(`${COLLECTION}?tab=nfts&owner=a%26b%3Dc%20d%23e`);
  });

  it("escapes ' as %27, which a URL parser would write in a query anyway (E3's rule)", () => {
    const href = nftsHref("xrpl", { issuer: "a'b", marker: "a'b", back: ["x'y", "M1"] });
    expect(href).toBe("/xrpl/nfts?issuer=a%27b&marker=a%27b&back=x%27y.M1");
    expect(serialized(href)).toBe(queryOfHref(href));
    const owner = collectionHref("xrpl", XRPL_KEY, { tab: "nfts", owner: "o'k" });
    expect(owner).toBe(`${COLLECTION}?tab=nfts&owner=o%27k`);
    expect(serialized(owner)).toBe(queryOfHref(owner));
    expect(nftHref("xrpl", ID, { marker: "a'b" })).toBe(`${NFT}?marker=a%27b`);
  });
});

/** A small seeded generator, so that a failure can be repeated. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("a canonical href is a fixed point of parse-then-write (the routes compare what the request says to it)", () => {
  const characters = [..."'\"<> #%&+=?/\\^`{|}~!$()*,:;@[]-_.é\u{1F600}"];
  for (let code = 0x20; code < 0x7f; code++) characters.push(String.fromCharCode(code));

  /** The path and the query (without its `?`) of an href. */
  const split = (href: string): { path: string; search: string } => {
    const at = href.indexOf("?");
    return at < 0 ? { path: href, search: "" } : { path: href.slice(0, at), search: href.slice(at + 1) };
  };

  /**
   * What a loader does with a request whose query is `query`: parse it, take the canonical path and query (the `{ path, search }` it hands to
   * `redirectToCanonical`), and compare them with the request's `url.pathname` and `queryOf(request.url)`. The canonical href must be what a URL
   * parser leaves of it (so a redirect to it is not redirected again), and what it asks for again is the same href.
   */
  function loop(canonicalOf: (query: string) => string, query: string): void {
    const href = canonicalOf(query);
    const { path, search } = split(href);
    // the canonical URL, as it arrives once serialized: no redirect
    const arrived = new URL(`https://h${href}`);
    expect(arrived.pathname).toBe(path);
    expect(queryOf(arrived.href)).toBe(search);
    expect(serialized(href)).toBe(queryOfHref(href));
    expect(redirectToCanonical({ path: arrived.pathname, search: queryOf(arrived.href) }, { path, search })).toBeNull();
    expect(canonicalOf(queryOf(arrived.href))).toBe(href);
    // the request that was made: no redirect, or one to that href, which then is not redirected
    const asked = new URL(`https://h${path}${query === "" ? "" : `?${query}`}`);
    const answer = redirectToCanonical({ path: asked.pathname, search: queryOf(asked.href) }, { path, search });
    if (answer !== null) {
      expect(answer.status).toBe(302);
      expect(answer.headers.get("Location")).toBe(href);
    }
  }
  const views = [nftsCanonical, salesCanonical, collectionCanonical, nftCanonical];

  it("holds for any character of an issuer, an owner, a marker or a trail", () => {
    for (const character of characters) {
      const text = `a${character}b`;
      const value = encodeURIComponent(text);
      loop(nftsCanonical, `issuer=${value}`);
      loop(nftsCanonical, `issuer=${value}&sort=supply&order=asc&marker=M3&back=${value}.M1`);
      loop(nftsCanonical, `marker=${value}`);
      loop(nftsCanonical, `marker=M3&back=${encodeURIComponent(`M${character}`)}`);
      loop(salesCanonical, `marker=${value}&back=M2.${value}`);
      loop(collectionCanonical, `tab=nfts&owner=${value}&burned=1&marker=${value}`);
      loop(collectionCanonical, `tab=holders&marker=M3&back=M2.${value}`);
      loop(nftCanonical, `offers=1&marker=${value}`);
      loop(nftCanonical, `marker=M3&back=${value}`);
    }
  });

  it("holds for a raw query, where the characters come unescaped and a + is a space", () => {
    const queries = ["issuer=r+I", "issuer=a'b", "marker=a'b&back=c'd", "issuer=%zz", "marker=%E0%A4%A", "issuer=a%2Bb", "marker=ab%3d", "sort=%73upply", "period=%37day", "tab=%6Eftsx", "owner=%20", "offers=%31"];
    for (const query of queries) for (const view of views) loop(view, query);
  });

  it("holds for random queries of the known parameters, unknown ones and repeats", () => {
    const next = lcg(20261024);
    const keys = ["period", "issuer", "sort", "order", "measure", "tab", "owner", "burned", "offers", "marker", "back", "x", "_routes"];
    const values = ["", "1", "0", "yes", "day", "7day", "30day", "1day", "volume", "supply", "holders", "sales", "avg", "low", "nfts", "bogus", "asc", "desc", "rI", " rI ", "%20", "M1", "M2.M1", "a'b", "a%27b", "%", "ab%3D%3D", "é", "a.b.c", "M0.M1.M2.M3.M4.M5.M6.M7.M8.M9.M10"];
    const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    for (let round = 0; round < 400; round++) {
      const pairs: string[] = [];
      for (let count = Math.floor(next() * 8); count > 0; count--) pairs.push(`${pick(keys)}=${pick(values)}`);
      const query = pairs.join("&");
      for (const view of views) loop(view, query);
    }
  });

  it("writes the same href again from what it has written, for the views the selectors link to", () => {
    const cases: [string, (query: string) => string][] = [
      [nftsHref("xrpl", { period: "30day", sort: "holders", order: "asc", issuer: ISSUER }), nftsCanonical],
      [nftsHref("xrpl", { sort: "supply", marker: "M3", back: ["M2", "M1"] }), nftsCanonical],
      [nftSalesHref("xrpl", { marker: "M3", back: ["M2"] }), salesCanonical],
      [collectionHref("xrpl", XRPL_KEY, { measure: "avg", tab: "holders" }), collectionCanonical],
      [collectionHref("xrpl", XRPL_KEY, { tab: "nfts", owner: ISSUER, burned: true, marker: "M3", back: ["M2", "M1"] }), collectionCanonical],
      [nftHref("xrpl", ID, { offers: true, marker: "M2", back: ["M1"] }), nftCanonical],
    ];
    for (const [href, canonicalOf] of cases) expect(canonicalOf(queryOfHref(href).slice(1))).toBe(href);
  });
});

describe("the query types", () => {
  it("are the ones the parses return and the hrefs take", () => {
    expectTypeOf(nfts("")).toEqualTypeOf<NftsQuery>();
    expectTypeOf(sales("")).toEqualTypeOf<NftSalesQuery>();
    expectTypeOf(collection("")).toEqualTypeOf<CollectionQuery>();
    expectTypeOf(nft("")).toEqualTypeOf<NftQuery>();
    expectTypeOf<NftsQuery["order"]>().toEqualTypeOf<"asc" | "desc">();
    expectTypeOf<NftsQuery["back"]>().toEqualTypeOf<readonly string[]>();
  });
});

describe("the browser bundle", () => {
  // nft-params.ts is in the browser bundle of every NFT page (the links of its selectors, the labels, the words) and of the pages that write a collection's label.
  // It imports the types of the data API client and of the networks, which the compiler erases, and the pure files below at run time: nothing of the Worker, of
  // `asset.ts` (the issuer checksums of `ripple-address-codec`), of the describe and parse trees, and not nft-id.ts, which belongs to the Worker.
  const appDir = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

  const FORBIDDEN = (from: string) =>
    /(^|\/)server(\/|$)/.test(from) ||
    /ripple-/.test(from) ||
    /(^|\/)domain\/(describe|parse|asset|nft-id)(\/|\.ts|$)/.test(from) ||
    /^\.\/(describe|parse|asset|nft-id)(\/|\.ts|$)/.test(from);

  it("nft-params.ts imports nothing of app/server, domain/describe, domain/parse, domain/asset, domain/nft-id or ripple-* as a value", () => {
    expect(valueImports(read("domain/nft-params.ts")).filter(FORBIDDEN)).toEqual([]);
  });

  it("imports only format.ts, nft-link.ts, nft-words.ts, paging.ts and query-of.ts at run time", () => {
    expect([...new Set(valueImports(read("domain/nft-params.ts")))].sort()).toEqual(["./format", "./nft-link", "./nft-words", "./paging", "./query-of"]);
  });

  it("has the networks' words in nft-words.ts, a leaf that imports nothing at run time, which the account page and its tags load without nft-params.ts", () => {
    expect(valueImports(read("domain/nft-words.ts"))).toEqual([]);
    for (const file of ["ui/pages/AccountPage.tsx", "server/meta-account.ts"]) {
      expect(valueImports(read(file)), file).toContain(file.startsWith("ui/") ? "../../domain/nft-words" : "../domain/nft-words");
      expect(staticClosure(appDir, file), file).not.toContain("domain/nft-params.ts");
    }
  });

  it("loads none of those through the files it imports either; the only file of app/server it reaches is the marker alphabet, a leaf", () => {
    const closure = staticClosure(appDir, "domain/nft-params.ts");
    expect(closure).toEqual(["domain/format.ts", "domain/nft-link.ts", "domain/nft-params.ts", "domain/nft-words.ts", "domain/paging.ts", "domain/query-of.ts", "server/marker.ts"]);
    expect(closure.filter((path) => FORBIDDEN(path) && path !== "server/marker.ts")).toEqual([]);
    expect(valueImports(read("server/marker.ts"))).toEqual([]);
  });

  it("is checked by a filter that sees each of those", () => {
    const source = [
      'import { isMarker } from "../server/marker";',
      'import { parseAssetText } from "./asset";',
      'import { decodeNftId } from "./nft-id";',
      'import { describeTx } from "./describe/describe";',
      'import { parseTx } from "../domain/parse/index";',
      'import { encodeAccountID } from "ripple-address-codec";',
      'import { parseTrail } from "./paging";',
      'import type { Asset } from "./asset";',
      'import { type Asset as A } from "./asset";',
    ].join("\n");
    expect(valueImports(source).filter(FORBIDDEN)).toEqual([
      "../server/marker",
      "./asset",
      "./nft-id",
      "./describe/describe",
      "../domain/parse/index",
      "ripple-address-codec",
    ]);
  });
});
