// What the NFT page and its link-preview image read (NFT spec 4.1, 4.3): the decision they share (`settleNft`: #1, #2 where it is needed, and the mode they make), and the two reads that are
// the node's alone: the NFT itself (#2, which the index lacks or holds without an owner) and, for an NFT shown from the network, its open offers. Which command asks depends on the network: XRPL's Clio `nft_info`, Xahau's `ledger_entry` of a URIToken. Worker-only code.

import type { NftAnswer, NodeNftInfo, NodeNftOffers, NodeUriToken } from "./api-types";
import type { DataApi } from "./data-api";
import { byDeadline, outcome } from "./deadline";
import type { Network } from "./networks";
import type { NodeRpc } from "./node-rpc";
import { needsNode, nftModeOf, type NftMode } from "./nft-view";
import { isNotFound } from "./upstream";

/** What the node says of an NFT: Clio's `nft_info` (XRPL) or the URIToken's ledger entry (Xahau). */
export type NodeNft = NodeNftInfo | NodeUriToken;

/** #2: the NFT as the network's node has it (`not_found` for one it has none of: `NodeRpc.nftInfo`, `NodeRpc.uriToken` say which codes those are). */
export function readNodeNft(node: NodeRpc, net: Pick<Network, "id">, id: string): Promise<NodeNft> {
  return net.id === "xrpl" ? node.nftInfo(id) : node.uriToken(id);
}

/**
 * The open offers (#3) of an NFT shown from the network, from what #2 read. XRPL's are the first 50 offers to sell and the first 50 to buy, asked at once and joined into one list, sell
 * first, with `more` when either side had a marker for more; a failure of either is the failure of the whole, as a list that holds half of what the node has would be told as the whole
 * (an NFT with no offer to buy, when the node did not answer). A Xahau URIToken has no call of its own: its one sell offer is on the entry that #2 read, which `offerRows` reads it from.
 */
export async function readNodeOffers(node: NodeRpc, id: string, entry: NodeNft): Promise<NodeNftOffers | NodeUriToken> {
  if (!("nft_id" in entry)) return entry;
  const [sell, buy] = await Promise.all([node.nftSellOffers(id), node.nftBuyOffers(id)]);
  return { offers: [...sell.offers, ...buy.offers], more: sell.more || buy.more };
}

/**
 * What the page and the image of an NFT make of the index's answer (#1) and the node's (#2): the settled results, the mode (`nftModeOf`) and, for `unavailable`, why. `fromNode` is `null`
 * when the node was not asked. `outageReason` is only there for `unavailable`: the index's failure, or the node's when the index said there is no such NFT and the node could not say.
 */
export interface NftRead {
  index: PromiseSettledResult<NftAnswer>;
  fromNode: PromiseSettledResult<NodeNft> | null;
  mode: NftMode;
  outageReason?: unknown;
}

/**
 * The decision of Review Focus 2, once for the page and for its image: #1 the index's NFT, then #2 the node's where `needsNode` says so (the index has no such NFT, or has it without an
 * owner and not burned), never in place of an index that failed, and the mode they make (`nftModeOf`). Both calls are settled, so nothing is left running or unhandled; with a `deadline`
 * (the page's, an absolute time as `Date.now()`) a call that has not answered by it has failed as `TooLate`, and without one (the image's) they take as long as the clients let them.
 * Only a failed index is `unavailable`, and `outageReason` is then the reason to answer a 503 with.
 */
export async function settleNft(api: DataApi, node: NodeRpc, net: Pick<Network, "id">, id: string, deadline?: number): Promise<NftRead> {
  const settled = <T>(work: Promise<T>) => outcome(deadline === undefined ? work : byDeadline(work, deadline));
  const index = await settled(api.nft(id));
  const fromNode = needsNode(index) ? await settled(readNodeNft(node, net, id)) : null;
  const mode = nftModeOf(index, fromNode);
  if (mode !== "unavailable") return { index, fromNode, mode };
  if (index.status !== "rejected") throw new Error("an NFT that the index has is never unavailable");
  return { index, fromNode, mode, outageReason: isNotFound(index.reason) && fromNode?.status === "rejected" ? fromNode.reason : index.reason };
}
