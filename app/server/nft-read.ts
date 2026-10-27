// What the NFT page and its link-preview image read from the node (NFT spec 4.1, 4.3), the two reads that are the node's alone: the NFT itself (#2, which the index lacks or holds without an
// owner) and, for an NFT shown from the network, its open offers. Which command asks depends on the network: XRPL's Clio `nft_info`, Xahau's `ledger_entry` of a URIToken. Worker-only code.

import type { NodeNftInfo, NodeNftOffers, NodeUriToken } from "./api-types";
import type { Network } from "./networks";
import type { NodeRpc } from "./node-rpc";

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
