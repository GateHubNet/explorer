import { afterEach, describe, expect, it } from "vitest";

import { createDataApi } from "../../app/server/data-api";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { createNodeRpc } from "../../app/server/node-rpc";
import { holderCase, nftCase, NFT_CASES } from "../support/nft-cases";
import { passThroughCache } from "../support/subrequest-cache";
import { allSwitches } from "../support/switches";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The generated NFT fixtures (scripts/nft-fixtures.ts), read in the Workers runtime by the clients that read them: the data API client's NFT, history, offers and account calls,
// and the node client's NFT readers, on the files the committed fixtures hold; and the cases of test/support/nft-cases.ts, found in those files by the rules of
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
