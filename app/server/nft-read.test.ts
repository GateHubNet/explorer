import { describe, expect, it, vi } from "vitest";

import { NFT_ID, nftAnswerSample, nftSample, NODE_NFT_ID, nodeNftInfoSample, nodeUriTokenSample, URI_TOKEN_ID } from "../../test/support/nft-samples";
import type { Nft, NodeNftOffer, NodeNftOffers } from "./api-types";
import type { DataApi } from "./data-api";
import { TooLate } from "./deadline";
import type { NodeRpc } from "./node-rpc";
import { readNodeNft, readNodeOffers, settleNft } from "./nft-read";
import { UpstreamError } from "./upstream";

// What the page and the image of an NFT read from the node: which command asks for the NFT on each network, the two sides of an XRPL NFT's offers as one list, and the one decision of
// both routes (`settleNft`: #1, #2 where it is needed, the mode, and why a page is unavailable), over the index's answers × the node's.

const SELL: NodeNftOffer = { nft_offer_index: "A".repeat(64), flags: 1, owner: "rhv9jFwfWfH4Cd1uX4b3ACkdgDKASFz7Dz", amount: { currency: "XRP", value: "1600" } };
const BUY: NodeNftOffer = { nft_offer_index: "B".repeat(64), flags: 0, owner: "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx", amount: { currency: "XRP", value: "1200" } };
const INFO = nodeNftInfoSample();
const OUTAGE = new UpstreamError("server", "the node answered 503", { status: 503 });

/** A node with only the readers these functions use. */
function node(over: Partial<NodeRpc> = {}) {
  return {
    nftInfo: vi.fn(() => Promise.resolve(nodeNftInfoSample())),
    uriToken: vi.fn(() => Promise.resolve(nodeUriTokenSample())),
    nftSellOffers: vi.fn((): Promise<NodeNftOffers> => Promise.resolve({ offers: [SELL], more: false })),
    nftBuyOffers: vi.fn((): Promise<NodeNftOffers> => Promise.resolve({ offers: [BUY], more: false })),
    ...over,
  } as unknown as NodeRpc & Record<"nftInfo" | "uriToken" | "nftSellOffers" | "nftBuyOffers", ReturnType<typeof vi.fn>>;
}

describe("readNodeNft", () => {
  it("asks Clio's nft_info on XRPL, whatever its network's name, and the URIToken's ledger entry on Xahau", async () => {
    const rpc = node();
    expect(await readNodeNft(rpc, { id: "xrpl" }, NODE_NFT_ID)).toEqual(nodeNftInfoSample());
    expect(rpc.nftInfo).toHaveBeenCalledWith(NODE_NFT_ID);
    expect(rpc.uriToken).not.toHaveBeenCalled();
    expect(await readNodeNft(rpc, { id: "xahau" }, URI_TOKEN_ID)).toEqual(nodeUriTokenSample());
    expect(rpc.uriToken).toHaveBeenCalledWith(URI_TOKEN_ID);
    expect(rpc.nftInfo).toHaveBeenCalledTimes(1);
  });

  it("gives what the node's reader says, a not_found included", async () => {
    const missing = new UpstreamError("not_found", "nft_info failed with objectNotFound", { status: 200 });
    const rpc = node({ nftInfo: vi.fn(() => Promise.reject(missing)) });
    await expect(readNodeNft(rpc, { id: "xrpl" }, NODE_NFT_ID)).rejects.toBe(missing);
  });
});

describe("readNodeOffers", () => {
  it("joins the two sides into one list, sell first, and asks both for the same NFT", async () => {
    const rpc = node();
    expect(await readNodeOffers(rpc, NODE_NFT_ID, INFO)).toEqual({ offers: [SELL, BUY], more: false });
    expect(rpc.nftSellOffers).toHaveBeenCalledWith(NODE_NFT_ID);
    expect(rpc.nftBuyOffers).toHaveBeenCalledWith(NODE_NFT_ID);
  });

  it.each([
    ["the sell side", { sell: true, buy: false }],
    ["the buy side", { sell: false, buy: true }],
    ["both", { sell: true, buy: true }],
  ])("has more when %s had a marker", async (_name, more) => {
    const rpc = node({
      nftSellOffers: vi.fn(() => Promise.resolve({ offers: [SELL], more: more.sell })),
      nftBuyOffers: vi.fn(() => Promise.resolve({ offers: [BUY], more: more.buy })),
    });
    expect(await readNodeOffers(rpc, NODE_NFT_ID, INFO)).toMatchObject({ more: true });
    expect(await readNodeOffers(node(), NODE_NFT_ID, INFO)).toMatchObject({ more: false });
  });

  it("keeps sell offers first when the buy side has none, and the other way round", async () => {
    expect(await readNodeOffers(node({ nftBuyOffers: vi.fn(() => Promise.resolve({ offers: [], more: false })) }), NODE_NFT_ID, INFO)).toEqual({ offers: [SELL], more: false });
    expect(await readNodeOffers(node({ nftSellOffers: vi.fn(() => Promise.resolve({ offers: [], more: false })) }), NODE_NFT_ID, INFO)).toEqual({ offers: [BUY], more: false });
  });

  it("is a URIToken's entry itself, with no call of the node: its sell offer is on it", async () => {
    const rpc = node();
    const entry = nodeUriTokenSample({ Amount: { currency: "XAH", value: "2200" } });
    expect(await readNodeOffers(rpc, URI_TOKEN_ID, entry)).toBe(entry);
    expect(rpc.nftSellOffers).not.toHaveBeenCalled();
    expect(rpc.nftBuyOffers).not.toHaveBeenCalled();
  });

  it("fails when either side fails, as a list that holds half of what the node has would be told as the whole", async () => {
    await expect(readNodeOffers(node({ nftBuyOffers: vi.fn(() => Promise.reject(OUTAGE)) }), NODE_NFT_ID, INFO)).rejects.toBe(OUTAGE);
    await expect(readNodeOffers(node({ nftSellOffers: vi.fn(() => Promise.reject(OUTAGE)) }), NODE_NFT_ID, INFO)).rejects.toBe(OUTAGE);
  });
});

// ---- settleNft (spec 4.1, Review Focus 2) ----------------------------------------------------------------------------------------------------------------

const NOT_FOUND = new UpstreamError("not_found", "nft not found", { status: 404 });
const FAILURES: Array<[string, unknown]> = [
  ["a 5xx", new UpstreamError("server", "answered 503", { status: 503 })],
  ["a 429", new UpstreamError("rate_limited", "answered 429", { status: 429, retryAfter: 3 })],
  ["a malformed 200", new UpstreamError("server", "answered something unexpected", { status: 200 })],
  ["a Cannot GET", new UpstreamError("server", "Cannot GET /v2/nfts/X", { status: 404 })],
  ["a 400 for an id the route checked", new UpstreamError("bad_request", "invalid nft id", { status: 400 })],
  ["a timeout", new UpstreamError("timeout", "did not answer within 3000 ms")],
  ["a connection failure", new UpstreamError("network", "connection failed")],
  ["a TooLate", new TooLate()],
  ["a bug", new TypeError("x is not a function")],
];

const answer = (over: Partial<Nft> = {}) => nftAnswerSample({ nft: nftSample(over) });
const UNOWNED: Partial<Nft> = { owner: undefined, owner_since: undefined };
const BURNED: Partial<Nft> = { owner: undefined, owner_since: undefined, burned: true };

/** A data API whose `nft` answers (or fails with) `result`, and a node as above; both count their calls in the order they were made. */
function world(result: unknown, nodeAnswer?: { info?: unknown; entry?: unknown }) {
  const order: string[] = [];
  const settle = (what: string, value: unknown) => {
    order.push(what);
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  const api = { nft: vi.fn((id: string) => settle(`index ${id}`, result)) } as unknown as DataApi & { nft: ReturnType<typeof vi.fn> };
  const rpc = node({
    nftInfo: vi.fn((id: string) => settle(`info ${id}`, nodeAnswer?.info ?? nodeNftInfoSample())) as unknown as NodeRpc["nftInfo"],
    uriToken: vi.fn((id: string) => settle(`entry ${id}`, nodeAnswer?.entry ?? nodeUriTokenSample())) as unknown as NodeRpc["uriToken"],
  });
  return { api, rpc, order };
}

describe("settleNft: the NFT the index has with an owner, or burned, never asks the node", () => {
  it("is indexed with an owner", async () => {
    const { api, rpc, order } = world(answer());
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID);
    expect(read.mode).toBe("indexed");
    expect(read.index).toEqual({ status: "fulfilled", value: answer() });
    expect(read.fromNode).toBeNull();
    expect(read.outageReason).toBeUndefined();
    expect(order).toEqual([`index ${NFT_ID}`]);
  });

  it("is burned, whatever the node would have said", async () => {
    const { api, rpc } = world(answer(BURNED));
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID);
    expect(read.mode).toBe("burned");
    expect(read.fromNode).toBeNull();
    expect(rpc.nftInfo).not.toHaveBeenCalled();
  });
});

describe("settleNft: the NFT the index has without an owner asks the node, after the index", () => {
  it.each([
    ["has it: the owner is the node's", {}, "indexed-network-owner"],
    ["says it is burned: the owner is unknown", { info: nodeNftInfoSample({ is_burned: true }) }, "indexed-owner-unknown"],
  ])("a node that %s", async (_what, node, mode) => {
    const { api, rpc, order } = world(answer(UNOWNED), node);
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID);
    expect(read.mode).toBe(mode);
    expect(read.fromNode).toMatchObject({ status: "fulfilled" });
    expect(read.outageReason).toBeUndefined();
    expect(order).toEqual([`index ${NFT_ID}`, `info ${NFT_ID}`]);
  });

  it.each([["not found", NOT_FOUND], ...FAILURES])("a node that fails with %s leaves the owner unknown, never a 503 or a 404, and is the loader's to tell", async (_what, reason) => {
    const { api, rpc } = world(answer(UNOWNED), { info: reason });
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID);
    expect(read.mode).toBe("indexed-owner-unknown");
    expect(read.fromNode).toEqual({ status: "rejected", reason });
    expect(read.outageReason).toBeUndefined();
  });

  it("asks a Xahau node for the URIToken's entry", async () => {
    const { api, rpc, order } = world(answer({ ...UNOWNED, kind: "uritoken" }), {});
    const read = await settleNft(api, rpc, { id: "xahau" }, URI_TOKEN_ID);
    expect(read.mode).toBe("indexed-network-owner");
    expect(order).toEqual([`index ${URI_TOKEN_ID}`, `entry ${URI_TOKEN_ID}`]);
    expect(rpc.nftInfo).not.toHaveBeenCalled();
  });
});

describe("settleNft: the NFT the index lacks asks the node", () => {
  it.each([
    ["has it", {}, "network"],
    ["says it is burned", { info: nodeNftInfoSample({ is_burned: true }) }, "network-burned"],
  ])("a node that %s", async (_what, node, mode) => {
    const { api, rpc, order } = world(NOT_FOUND, node);
    const read = await settleNft(api, rpc, { id: "xrpl" }, NODE_NFT_ID);
    expect(read.mode).toBe(mode);
    expect(read.index).toEqual({ status: "rejected", reason: NOT_FOUND });
    expect(read.outageReason).toBeUndefined();
    expect(order).toEqual([`index ${NODE_NFT_ID}`, `info ${NODE_NFT_ID}`]);
  });

  it("is none when the node has none either: the one answer that is a 404", async () => {
    const { api, rpc } = world(NOT_FOUND, { info: NOT_FOUND });
    const read = await settleNft(api, rpc, { id: "xrpl" }, NODE_NFT_ID);
    expect(read.mode).toBe("none");
    expect(read.outageReason).toBeUndefined();
  });

  it.each(FAILURES)("is unavailable when the node fails with %s, for that reason, and never a stored 404", async (_what, reason) => {
    const { api, rpc } = world(NOT_FOUND, { info: reason });
    const read = await settleNft(api, rpc, { id: "xrpl" }, NODE_NFT_ID);
    expect(read.mode).toBe("unavailable");
    expect(read.outageReason).toBe(reason);
  });
});

describe("settleNft: an index that failed is unavailable and never asks the node in its place", () => {
  it.each(FAILURES)("%s is the reason", async (_what, reason) => {
    const { api, rpc, order } = world(reason);
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID);
    expect(read.mode).toBe("unavailable");
    expect(read.outageReason).toBe(reason);
    expect(read.fromNode).toBeNull();
    expect(order).toEqual([`index ${NFT_ID}`]);
    expect(rpc.nftInfo).not.toHaveBeenCalled();
    expect(rpc.uriToken).not.toHaveBeenCalled();
  });
});

describe("settleNft: the deadline of a page", () => {
  const never = () => new Promise(() => {});

  it("gives up on an index that has not answered by it, as TooLate, and is unavailable without asking the node", async () => {
    const rpc = node();
    const api = { nft: vi.fn(never) } as unknown as DataApi;
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID, Date.now() + 20);
    expect(read.mode).toBe("unavailable");
    expect(read.outageReason).toBeInstanceOf(TooLate);
    expect(rpc.nftInfo).not.toHaveBeenCalled();
  });

  it("gives up on a node that has not answered by it, and leaves the owner of an NFT the index has unknown", async () => {
    const rpc = node({ nftInfo: vi.fn(never) as unknown as NodeRpc["nftInfo"] });
    const api = { nft: vi.fn(() => Promise.resolve(answer(UNOWNED))) } as unknown as DataApi;
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID, Date.now() + 20);
    expect(read.mode).toBe("indexed-owner-unknown");
    expect(read.fromNode).toMatchObject({ status: "rejected", reason: expect.any(TooLate) });
  });

  it("is unavailable, for the node's TooLate, when the index has none and the node did not answer in time", async () => {
    const rpc = node({ nftInfo: vi.fn(never) as unknown as NodeRpc["nftInfo"] });
    const api = { nft: vi.fn(() => Promise.reject(NOT_FOUND)) } as unknown as DataApi;
    const read = await settleNft(api, rpc, { id: "xrpl" }, NODE_NFT_ID, Date.now() + 20);
    expect(read.mode).toBe("unavailable");
    expect(read.outageReason).toBeInstanceOf(TooLate);
  });

  it("waits as long as the calls take when it has no deadline (the image's)", async () => {
    const slow = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 40));
    const rpc = node({ nftInfo: vi.fn(() => slow(nodeNftInfoSample())) });
    const api = { nft: vi.fn(() => slow(answer(UNOWNED))) } as unknown as DataApi;
    const read = await settleNft(api, rpc, { id: "xrpl" }, NFT_ID);
    expect(read.mode).toBe("indexed-network-owner");
  });
});
