// What `/{net}/search` shows when it does not redirect (spec 6, 10; NFT spec 7; ledger object pages spec 8): the choice between what one hash is (a transaction, a
// ledger, an NFT, an escrow, a check, a payment channel, a delegation), the help text, the offer to open a CTID on the other network, and the not-found pages. The page gets this and
// draws it. No I/O.

import { formatAmount, shortAddress, shortHash } from "../domain/format";
import { hashWhat } from "../domain/hash-nouns";
import { collectionLabel, nftWords } from "../domain/nft-params";
import { delegationHref, kindOfType, OBJECT_KINDS, objectHref } from "../domain/object-link";
import type { NftKind } from "./api-types";
import type { Network, NetworkId } from "./networks";
import type { HashMatches, HashQuestions, ObjectMatch } from "./resolve";

/** A network as a page names it. */
export interface NetworkName {
  id: NetworkId;
  name: string;
}

export type SearchPageData =
  | {
      /** A hash that is two or more of a transaction, a ledger, an NFT (a URIToken on Xahau) and an object: the page links to each that it is, in that order. */
      kind: "choice";
      hash: string;
      tx?: { ledgerIndex: number; type: string };
      /** `closeTime` in unix seconds. */
      ledger?: { index: number; closeTime: number };
      /** `token` is the network's word for it (`NFT`, `URIToken`) and `detail` what follows it in its row ("#4,127 of rLULtF…mB3R · taxon 1", "of rEvRt8…Lk2P"). */
      nft?: { token: string; detail: string; burned: boolean };
      /**
       * An escrow, a check, a payment channel or a delegation (E10): `noun` is what it is called ("escrow", "check", "payment channel", "delegation"), `detail` what follows it in its row ("of
       * rLULtF…mB3R", the owner, a delegation's delegator), `href` where the row leads (`objectMatchHref`: the server decides it, from the switches), `removed` whether the index says it was deleted.
       */
      object?: { noun: string; detail: string; href: string; removed: boolean };
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

/** What an object is called in the words of the search: "delegation" for a `Delegate`, the pages' words for the three that have a page ("escrow", "check", "payment channel"). */
function objectNoun(type: ObjectMatch["type"]): string {
  if (type === "Delegate") return "delegation";
  return OBJECT_KINDS.find((each) => each.type === type)!.words;
}

/** What decides where an object's link leads: the network's id, its switches and whether its ledger has delegation at all (`Network.hasDelegation`). */
type ObjectLinkNetwork = Pick<Network, "id" | "features" | "hasDelegation">;

/**
 * Where an object that a search found leads (spec 8): its page (`objectHref`) for an escrow, a check or a payment channel, including one that was deleted (the page says so); a
 * `Delegate`'s delegator's Delegation tab (`delegationHref`) while `DELEGATION` is on and the network has delegation (the account route 302s the tab away on one that has not), else the
 * delegator's account page. A deleted Delegate is on the account page too: the tab lists the delegations in the ledger now, so it would not be there (E10Δ3). `features.ledgerObjects` is on
 * whenever an object was asked for; the account page is the one page that exists whatever the switches say, which an object whose own link is off falls back to.
 */
export function objectMatchHref(network: ObjectLinkNetwork, id: string, { type, account, deleted }: ObjectMatch): string {
  const { id: net, features } = network;
  const accountPage = `/${net}/account/${account}`;
  if (type === "Delegate") return (network.hasDelegation && !deleted ? delegationHref(net, account, features) : null) ?? accountPage;
  const kind = kindOfType(type);
  return (kind === undefined ? null : objectHref(net, kind, { id }, features)) ?? accountPage;
}

/** The row of an object: "{noun} of {owner}", with `removed` for one that was deleted. */
function objectRow(hash: string, object: ObjectMatch, network: ObjectLinkNetwork): NonNullable<Extract<SearchPageData, { kind: "choice" }>["object"]> {
  return { noun: objectNoun(object.type), detail: `of ${shortAddress(object.account)}`, href: objectMatchHref(network, hash, object), removed: object.deleted };
}

/** The choice page of a hash that is two or more of a transaction, a ledger, an NFT and an object: a row for each that it is. `network` says where an object's row leads. */
export function choicePage(hash: string, matches: HashMatches, network: ObjectLinkNetwork): SearchPageData {
  const { tx, ledger, nft, object } = matches;
  return {
    kind: "choice",
    hash,
    ...(tx && { tx }),
    ...(ledger && { ledger }),
    ...(nft && { nft: nftRow(nft) }),
    ...(object && { object: objectRow(hash, object, network) }),
  };
}

export function helpPage(query: string): SearchPageData {
  return { kind: "help", query };
}

export function otherNetworkPage(query: string, ctid: string, other: NetworkName): SearchPageData {
  return { kind: "other-network", query, ctid, other };
}

/**
 * A hash neither the data API nor the node has on this network: the same search on the other network is offered. `what` names what was asked as the search asked it
 * (`hashWhat`: "transaction or ledger", with `NFTS` on "transaction, ledger or NFT", with `LEDGER_OBJECTS` on also "escrow, check or payment channel": "transaction, ledger, NFT, escrow,
 * check or payment channel"), so the page never says less than was looked for.
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
