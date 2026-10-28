// What `/{net}/search` shows when it does not redirect (spec 6, 10; NFT spec 7): the choice between what one hash is (a transaction, a
// ledger, an NFT), the help text, the offer to open a CTID on the other network, and the not-found pages. The page gets this and
// draws it. No I/O.

import { formatAmount, shortHash } from "../domain/format";
import { hashWhat } from "../domain/hash-nouns";
import { collectionLabel, nftWords } from "../domain/nft-params";
import type { NftKind } from "./api-types";
import type { NetworkId } from "./networks";
import type { HashMatches, HashQuestions } from "./resolve";

/** A network as a page names it. */
export interface NetworkName {
  id: NetworkId;
  name: string;
}

export type SearchPageData =
  | {
      /** A hash that is two or three of a transaction, a ledger and an NFT (a URIToken on Xahau): the page links to each that it is, in that order. */
      kind: "choice";
      hash: string;
      tx?: { ledgerIndex: number; type: string };
      /** `closeTime` in unix seconds. */
      ledger?: { index: number; closeTime: number };
      /** `token` is the network's word for it (`NFT`, `URIToken`) and `detail` what follows it in its row ("#4,127 of rLULtF…mB3R · taxon 1", "of rEvRt8…Lk2P"). */
      nft?: { token: string; detail: string; burned: boolean };
    }
  | {
      /** Nothing the box was given looks like anything searchable: the help text. */
      kind: "help";
      query: string;
    }
  | {
      /** A CTID of the other network: a link to the transaction there. */
      kind: "other-network";
      query: string;
      ctid: string;
      other: NetworkName;
    }
  | {
      /** The 404: `what` is a phrase that follows "We couldn't find", `message` replaces that sentence. */
      kind: "not-found";
      query: string;
      what?: string;
      message?: string;
      suggestion?: { href: string; label: string };
    };

/** How much of what the visitor typed a page repeats. An address or a hash is 66 characters at most. */
const MAX_SHOWN = 200;

/** What was typed, as a page repeats it: trimmed and cut short. */
export function shownQuery(typed: string): string {
  const trimmed = typed.trim();
  return trimmed.length > MAX_SHOWN ? `${trimmed.slice(0, MAX_SHOWN)}…` : trimmed;
}

/** The offer of the same search on the other network (`/{other}/search?q={hash}`), for a hash this network does not have. */
export function searchOnOther(hash: string, other: NetworkName): { href: string; label: string } {
  return { href: `/${other.id}/search?q=${hash}`, label: `Search on ${other.name}` };
}

/** The word of a token by its kind, as the NFT pages say it (`nftWords`): an NFT is XRPL's and a URIToken Xahau's, and an index answers only for its own network's. */
const tokenWord = (kind: NftKind): string => nftWords(kind === "uritoken" ? "xahau" : "xrpl").token;

/** The row of an NFT: "{token} #4,127 of {collection}" (an XRPL NFT has a serial; the collection is its issuer and taxon), or "{token} of {issuer}" (a URIToken). */
function nftRow(nft: NonNullable<HashMatches["nft"]>): NonNullable<Extract<SearchPageData, { kind: "choice" }>["nft"]> {
  const collection = collectionLabel({ issuer: nft.issuer, ...(nft.taxon !== undefined && { taxon: nft.taxon }) });
  const serial = nft.serial === undefined ? "" : `#${formatAmount(String(nft.serial))} `;
  return { token: tokenWord(nft.kind), detail: `${serial}of ${collection}`, burned: nft.burned };
}

/** The choice page of a hash that is two or more of a transaction, a ledger and an NFT: a row for each that it is. */
export function choicePage(hash: string, matches: HashMatches): SearchPageData {
  const { tx, ledger, nft } = matches;
  return { kind: "choice", hash, ...(tx && { tx }), ...(ledger && { ledger }), ...(nft && { nft: nftRow(nft) }) };
}

export function helpPage(query: string): SearchPageData {
  return { kind: "help", query };
}

export function otherNetworkPage(query: string, ctid: string, other: NetworkName): SearchPageData {
  return { kind: "other-network", query, ctid, other };
}

/**
 * A hash neither the data API nor the node has on this network: the same search on the other network is offered. `what` names what was asked as the search asked it
 * (`hashWhat`: "transaction or ledger", with `NFTS` on "transaction, ledger or NFT"), so the page never says less than was looked for.
 */
export function hashNotFoundPage(query: string, hash: string, other: NetworkName, asked: HashQuestions): SearchPageData {
  return {
    kind: "not-found",
    query,
    what: `${hashWhat(asked.net, asked)} ${shortHash(hash)}`,
    suggestion: searchOnOther(hash, other),
  };
}

/**
 * A CTID of this network that names no transaction, or one whose network id is neither network's. The other network is not
 * offered: a CTID says which network it is from.
 */
export function ctidNotFoundPage(query: string, ctid: string, networkId: number, covered: boolean): SearchPageData {
  return covered
    ? { kind: "not-found", query, what: `transaction ${ctid}` }
    : { kind: "not-found", query, message: `${ctid} is for network id ${networkId}, which this explorer does not cover.` };
}
