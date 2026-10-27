import { describe, expect, it, vi } from "vitest";

import { NODE_NFT_ID, nodeNftInfoSample, nodeUriTokenSample, URI_TOKEN_ID } from "../../test/support/nft-samples";
import type { NodeNftOffer, NodeNftOffers } from "./api-types";
import type { NodeRpc } from "./node-rpc";
import { readNodeNft, readNodeOffers } from "./nft-read";
import { UpstreamError } from "./upstream";

// What the page and the image of an NFT read from the node: which command asks for the NFT on each network, and the two sides of an XRPL NFT's offers as one list.

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
