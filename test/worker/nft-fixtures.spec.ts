import { afterEach, describe, expect, it } from "vitest";

import { createDataApi } from "../../app/server/data-api";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { createNodeRpc } from "../../app/server/node-rpc";
import { windowOf } from "../../app/domain/window";
import { collectionCase, collectionsMarker, COLLECTION_CASES, holderCase, nftCase, NFT_CASES, salesMarker } from "../support/nft-cases";
import { XAHAU_COLLECTION, XAHAU_NFT, XRPL_COLLECTION, XRPL_NFT } from "../support/nft-names";
import { passThroughCache } from "../support/subrequest-cache";
import { allSwitches } from "../support/switches";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The generated NFT fixtures (scripts/nft-fixtures.ts), read in the Workers runtime by the clients that read them: the data API client's NFT, history, offers and account calls,
// the node client's NFT readers, and the collections, sales and volume calls, on the files the committed fixtures hold; and the cases of test/support/nft-cases.ts, found in those files by the rules of
// nft-case-rules.ts. The requests are the clients' own, through `mockUpstream`, so a file named otherwise than the request the client makes is an absent answer here, and the
// client's checks run on every answer. (test/unit/nft-fixtures.test.ts checks the files against D3's rules in Node.)

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("on"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

/** Every request the mock answered was answered from a fixture file, with a 200. */
function allFromFiles(): void {
  expect(mock!.requests.length).toBeGreaterThan(0);
  for (const request of mock!.requests) expect([request.key, request.source, request.status]).toEqual([request.key, "fixture", 200]);
}

describe.each(["xrpl", "xahau"] as const)("%s: the NFT fixtures, read in the Workers runtime", (net) => {
  const network = networkOf(net, env);

  it("holds an NFT of every case, and an account that holds some (Xahau has no burned URIToken for the node to name)", async () => {
    const found = new Map<string, string>();
    for (const which of NFT_CASES) {
      if (net === "xahau" && which === "network-burned") {
        await expect(nftCase(net, which)).rejects.toThrow(/no network-burned NFT/);
        continue;
      }
      const { id, issuer } = await nftCase(net, which);
      expect(id, which).toMatch(/^[0-9A-F]{64}$/);
      expect(issuer, which).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
      found.set(which, id);
    }
    expect(new Set(found.values()).size).toBe(found.size);
    expect(await holderCase(net)).toBe(net === "xrpl" ? "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" : "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto");
  });

  it("serves the featured NFT's detail, its two pages of history (the second behind the marker), the event filter and its offers", async () => {
    mock = mockUpstream(net);
    const api = createDataApi(network, env, passThroughCache);
    const featured = await nftCase(net, "featured");
    const { nft, coverage } = await api.nft(featured.id);
    expect(nft).toMatchObject({ nft_id: featured.id, sale_count: 1 });
    // not complete: its first indexed event is an offer, not its mint
    expect(coverage.complete).toBe(false);
    const first = await api.nftHistory(featured.id, { descending: true, limit: 20 });
    expect(first.events).toHaveLength(20);
    expect(first.marker).toBeDefined();
    const second = await api.nftHistory(featured.id, { descending: true, limit: 20, marker: first.marker });
    expect(second.events.length).toBeGreaterThan(0);
    expect(second.marker).toBeUndefined();
    const own = await api.nftHistory(featured.id, { descending: true, limit: 20, event: ["mint", "burn", "modify", "sale", "transfer"] });
    expect(own.events.map((e) => e.event)).toEqual(["sale"]);
    const offers = await api.nftOffers(featured.id, { limit: 50 });
    expect(offers.offers).toHaveLength(net === "xrpl" ? 2 : 0);
    allFromFiles();
  });

  it("serves the burned NFT and the unowned one, and the holder's NFTs, which the client's checks accept", async () => {
    mock = mockUpstream(net);
    const api = createDataApi(network, env, passThroughCache);
    const burned = await nftCase(net, "burned");
    expect((await api.nft(burned.id)).nft).toMatchObject({ burned: true });
    const unowned = await nftCase(net, "unowned");
    const answer = await api.nft(unowned.id);
    expect(answer.nft).not.toHaveProperty("owner");
    expect((await api.nftOffers(unowned.id, { limit: 50 })).offers.length).toBeGreaterThan(0);
    const holder = await holderCase(net);
    const held = await api.accountNfts(holder, { limit: 20 });
    expect(held.nfts).toHaveLength(net === "xrpl" ? 3 : 2);
    expect(held.nfts.every((each) => each.owner === holder)).toBe(true);
    // an account that holds none gets the empty page (a hand-written one has its file, an address of nobody the mock's)
    for (const address of ["r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC", "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC", "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x"]) {
      expect(await api.accountNfts(address, { limit: 20 })).toMatchObject({ count: 0, nfts: [] });
    }
    for (const request of mock.requests) expect([request.key, request.status]).toEqual([request.key, 200]);
  });

  it("serves what the index lacks from the node: the unowned NFT's owner, a token of the network, and (XRPL) its offers and a burned NFT", async () => {
    mock = mockUpstream(net);
    const node = createNodeRpc(network, passThroughCache);
    const unowned = await nftCase(net, "unowned");
    const network_ = await nftCase(net, "network");
    if (net === "xrpl") {
      const owner = (await node.nftInfo(unowned.id)).owner;
      expect(owner).toMatch(/^r/);
      const read = await node.nftInfo(network_.id);
      expect(read).toMatchObject({ nft_id: network_.id, is_burned: false, issuer: network_.issuer, nft_taxon: network_.taxon, nft_serial: network_.serial });
      expect((await node.nftSellOffers(network_.id)).offers).toHaveLength(1);
      expect((await node.nftBuyOffers(network_.id)).offers).toHaveLength(1);
      const burned = await nftCase(net, "network-burned");
      expect(await node.nftInfo(burned.id)).toMatchObject({ is_burned: true });
    } else {
      expect(await node.uriToken(unowned.id)).toMatchObject({ index: unowned.id, Amount: { currency: "XAH", value: "2200" } });
      expect(await node.uriToken(network_.id)).toMatchObject({ index: network_.id, Issuer: network_.issuer });
    }
    allFromFiles();
  });

  it("has no file for the missing id, so that the index says nft not found and the node not_found", async () => {
    mock = mockUpstream(net);
    const missing = await nftCase(net, "missing");
    await expect(createDataApi(network, env, passThroughCache).nft(missing.id)).rejects.toMatchObject({ kind: "not_found" });
    const node = createNodeRpc(network, passThroughCache);
    await expect(net === "xrpl" ? node.nftInfo(missing.id) : node.uriToken(missing.id)).rejects.toMatchObject({ kind: "not_found" });
    // and an NFT of the node's alone is not in the index
    const network_ = await nftCase(net, "network");
    await expect(createDataApi(network, env, passThroughCache).nft(network_.id)).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe.each(["xrpl", "xahau"] as const)("%s: the NFT aggregates, read in the Workers runtime", (net) => {
  const network = networkOf(net, env);
  const coverage = net === "xrpl" ? { from_ledger_index: 32570, complete: true } : { from_ledger_index: 26533927, complete: false };
  const placeOf = (place: { issuer: string; taxon?: number }) => (place.taxon === undefined ? { issuer: place.issuer } : { issuer: place.issuer, taxon: place.taxon });

  it("holds a collection of every case, and the marker of the list's second page and of the sales'", async () => {
    const found = new Set<string>();
    for (const which of COLLECTION_CASES) {
      const place = await collectionCase(net, which);
      expect(place.issuer, which).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
      expect(place.taxon === undefined, which).toBe(net === "xahau");
      found.add(`${place.issuer}/${place.taxon ?? ""}`);
    }
    expect(found.size).toBe(3);
    expect(await collectionCase(net, "featured")).toEqual(placeOf(await nftCase(net, "featured")));
    expect(await collectionsMarker(net)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await salesMarker(net)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("serves the collections in each sort and order, the marker page, and the filters by issuer, with the feature's coverage", async () => {
    mock = mockUpstream(net);
    const api = createDataApi(network, env, passThroughCache);
    const first = await api.nftCollections({ limit: 20, sort: "volume" });
    expect(first.coverage).toEqual(coverage);
    expect(first.collections).toHaveLength(20);
    expect(first.total).toBeGreaterThan(20);
    expect(first.marker).toBe(await collectionsMarker(net));
    const second = await api.nftCollections({ limit: 20, sort: "volume", marker: first.marker });
    expect(second.collections.length).toBeGreaterThan(0);
    for (const sort of ["supply", "holders"] as const) {
      const desc = await api.nftCollections({ limit: 20, sort });
      // ascending is the text "false" (the client sends nothing for descending): its own files
      const asc = await api.nftCollections({ limit: 20, sort, descending: false });
      expect(asc.total).toBe(desc.total);
      expect(Number(asc.collections[0]![sort])).toBeLessThanOrEqual(Number(desc.collections[0]![sort]));
    }
    expect(mock.requests.some((request) => request.key === "GET /v2/nft_collections?descending=false&limit=20&sort=supply")).toBe(true);
    const featured = await collectionCase(net, "featured");
    expect((await api.nftCollections({ limit: 20, sort: "volume", issuer: featured.issuer })).total).toBe(net === "xrpl" ? 2 : 1);
    expect(await api.nftCollections({ limit: 20, sort: "volume", issuer: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC" })).toMatchObject({ total: 0, count: 0, collections: [] });
    allFromFiles();
  });

  it("serves each case's collection, stats, sales, NFTs (burned, and held by the active account) and holders, and the featured sales' second page", async () => {
    mock = mockUpstream(net);
    const api = createDataApi(network, env, passThroughCache);
    const last = await api.lastValidated();
    const window = windowOf(last.close_time.slice(0, 10), "30d");
    const holder = await holderCase(net);
    for (const which of COLLECTION_CASES) {
      const key = await collectionCase(net, which);
      const { collection, coverage: seen } = await api.nftCollection(key);
      expect(seen).toEqual(coverage);
      expect(collection).toMatchObject(key);
      const { days } = await api.nftCollectionStats(key, { start: window.start, end: window.end });
      expect(days.reduce((total, day) => total + day.sales_count, 0), which).toBe(collection.sales_count);
      const sales = await api.nftCollectionSales(key, { descending: true, limit: 20 });
      expect(sales.sales.length, which).toBe(Math.min(collection.sales_count, 20));
      const nfts = await api.nftCollectionNfts(key, { limit: 20 });
      expect(nfts.nfts.length, which).toBe(collection.supply);
      const mine = await api.nftCollectionNfts(key, { limit: 20, owner: holder });
      expect(mine.nfts.every((nft) => nft.owner === holder)).toBe(true);
      expect((await api.nftCollectionHolders(key, { limit: 20 })).holders.length, which).toBeGreaterThanOrEqual(collection.supply > 0 ? 1 : 0);
    }
    const featured = await collectionCase(net, "featured");
    expect((await api.nftCollectionNfts(featured, { limit: 20, includeBurned: true })).nfts.filter((nft) => nft.burned)).toHaveLength(1);
    expect((await api.nftCollectionNfts(featured, { limit: 20, owner: holder })).nfts.length).toBeGreaterThan(0);
    const page = await api.nftCollectionSales(featured, { descending: true, limit: 20, marker: await salesMarker(net) });
    expect(page.sales.length).toBeGreaterThan(0);
    expect(page.marker).toBeUndefined();
    allFromFiles();
  });

  it("serves the sales of the network (ten, twenty, the page behind the marker of each) and the volume (the three rolling periods, the days), with the feature's coverage", async () => {
    mock = mockUpstream(net);
    const api = createDataApi(network, env, passThroughCache);
    const ten = await api.nftSales({ descending: true, limit: 10 });
    expect(ten).toMatchObject({ count: 10, coverage });
    const twenty = await api.nftSales({ descending: true, limit: 20 });
    expect(twenty.sales.slice(0, 10)).toEqual(ten.sales);
    expect(twenty.marker).toBe(await salesMarker(net));
    const behind = await api.nftSales({ descending: true, limit: 20, marker: twenty.marker });
    expect(behind.sales.length).toBeGreaterThan(0);
    expect((await api.nftSales({ descending: true, limit: 20, marker: ten.marker })).sales).toEqual([...twenty.sales.slice(10), ...behind.sales]);
    for (const period of ["day", "7day", "30day"] as const) {
      const { rows, coverage: seen } = await api.nftVolume({ live: period });
      expect(seen).toEqual(coverage);
      expect(rows).toHaveLength(1);
    }
    const last = await api.lastValidated();
    const window = windowOf(last.close_time.slice(0, 10), "30d");
    const daily = await api.nftVolume({ interval: "day", start: window.start, end: window.end, limit: 1000 });
    expect(daily.rows).toHaveLength(window.buckets.length - 1);
    allFromFiles();
  });
});

// The ids the end-to-end suite names (test/support/nft-names.ts) are the cases the rules find in the files: a regeneration that moves a case fails here, with the new id, and not in a
// browser test a long way from the cause.
describe("the e2e suite's constants", () => {
  it("name the NFTs of every case, on both networks", async () => {
    for (const [net, named] of [
      ["xrpl", XRPL_NFT],
      ["xahau", XAHAU_NFT],
    ] as const) {
      const wanted: Record<string, string | undefined> = {
        featured: named.featured,
        burned: named.burned,
        unowned: named.unowned,
        network: named.network,
        "network-burned": "networkBurned" in named ? named.networkBurned : undefined,
        missing: named.missing,
      };
      for (const which of NFT_CASES) {
        const found = wanted[which] === undefined ? undefined : (await nftCase(net, which)).id;
        expect([net, which, found]).toEqual([net, which, wanted[which]]);
      }
    }
  });

  it("name the collection of every case, on both networks", async () => {
    for (const [net, named] of [
      ["xrpl", XRPL_COLLECTION],
      ["xahau", XAHAU_COLLECTION],
    ] as const) {
      for (const which of COLLECTION_CASES) {
        const { issuer, taxon } = await collectionCase(net, which);
        expect([net, which, issuer, taxon]).toEqual([net, which, named[which].issuer, "taxon" in named[which] ? (named[which] as { taxon: number }).taxon : undefined]);
      }
    }
  });
});
