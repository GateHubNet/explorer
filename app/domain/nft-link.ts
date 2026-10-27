// Where a link to an NFT or to a collection leads (E8): the one decision every inbound NFT link makes, and the two pages' paths. Pure and safe for the
// browser, so that the pages that show an NFT or a collection but are no NFT page (a transaction's sentence, an account's NFTs, the token pages) load only
// this. Types are imported, and erased: it imports nothing at run time.

import type { Features } from "../ui/features";
import type { CollectionKey } from "../server/api-types";

// `CollectionKey` is declared in api-types.ts, so that the data API client imports nothing of the domain, and re-exported here for the pages.
export type { CollectionKey };

/** An NFT's path: `/xrpl/nft/000B013A…`. The id is the 64 hexadecimal digits a loader has validated, so nothing of it is escaped in practice. */
export function nftPath(net: string, id: string): string {
  return `/${net}/nft/${id}`;
}

/**
 * A collection's path: `/xrpl/nfts/rhWTXC…/1` on XRPL, where a collection is an issuer and a taxon (a taxon of 0 is a taxon: `/0`), and `/xahau/nfts/rhWTXC…` on
 * Xahau, where the issuer is the whole collection and the key has no `taxon`. The issuer is the address a loader has validated.
 */
export function collectionPath(net: string, key: CollectionKey): string {
  return `/${net}/nfts/${key.issuer}${key.taxon !== undefined ? `/${key.taxon}` : ""}`;
}

/** The one place an inbound NFT link is decided: the NFT's page while NFTS is on, else null (plain text). */
export function nftLink(net: string, id: string, features: Features): string | null {
  return features.nfts ? nftPath(net, id) : null;
}

/** The one place an inbound collection link is decided: the collection's page while NFTS is on, else null (plain text). */
export function collectionLink(net: string, key: CollectionKey, features: Features): string | null {
  return features.nfts ? collectionPath(net, key) : null;
}
