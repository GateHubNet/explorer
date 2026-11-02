// The words a network uses for its non-fungible tokens (E8): what the NFT pages call them, and what the account page calls its NFTs tab. A leaf that imports
// nothing at run time, so that the account page and its tags take these words without nft-params.ts, the NFT pages' views and links (and `query-of.ts` with
// them); nft-params.ts re-exports them for the NFT pages.

import type { NetworkId } from "../server/networks";

/** The words a network's NFT pages use for what it calls its non-fungible tokens (NFTs on XRPL, URITokens on Xahau; the testnets take their mainnet's). */
export interface NftWords {
  /** One token: `NFT`, `URIToken`. */
  token: string;
  /** Tokens: `NFTs`, `URITokens`. */
  tokens: string;
  /** The tag of a token's kind: `NFToken`, `URIToken`. */
  kindTag: string;
  /** The tag of a collection: `NFToken collection`, `URIToken collection`. */
  collectionTag: string;
  /** The heading of the list page. */
  listHeading: string;
  /** The heading of the older sales page. */
  salesHeading: string;
}

const WORDS = {
  xrpl: { token: "NFT", tokens: "NFTs", kindTag: "NFToken", collectionTag: "NFToken collection", listHeading: "NFTs", salesHeading: "NFT sales" },
  xahau: { token: "URIToken", tokens: "URITokens", kindTag: "URIToken", collectionTag: "URIToken collection", listHeading: "URITokens", salesHeading: "URIToken sales" },
} as const satisfies Record<NetworkId, NftWords>;

/** The words of a network's NFT pages, by its id (a network's name is the layout's, `network.name`: the words here are the tokens'). */
export function nftWords(net: NetworkId): NftWords {
  return WORDS[net];
}
