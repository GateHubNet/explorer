// What `/{net}/search` shows when it does not redirect (spec 6, 10): the choice between a transaction and a ledger of the
// same hash, the help text, the offer to open a CTID on the other network, and the not-found pages. The page gets this and
// draws it. No I/O.

import { shortHash } from "../domain/format";
import type { NetworkId } from "./networks";
import type { HashMatches } from "./resolve";

/** A network as a page names it. */
export interface NetworkName {
  id: NetworkId;
  name: string;
}

export type SearchPageData =
  | {
      /** A hash that is a transaction and a ledger: the page links to both. */
      kind: "choice";
      hash: string;
      tx: { ledgerIndex: number; type: string };
      /** `closeTime` in unix seconds. */
      ledger: { index: number; closeTime: number };
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

export function choicePage(hash: string, matches: Required<HashMatches>): SearchPageData {
  return { kind: "choice", hash, tx: matches.tx, ledger: matches.ledger };
}

export function helpPage(query: string): SearchPageData {
  return { kind: "help", query };
}

export function otherNetworkPage(query: string, ctid: string, other: NetworkName): SearchPageData {
  return { kind: "other-network", query, ctid, other };
}

/** A hash neither the data API nor the node has on this network: the same search on the other network is offered. */
export function hashNotFoundPage(query: string, hash: string, other: NetworkName): SearchPageData {
  return {
    kind: "not-found",
    query,
    what: `transaction or ledger ${shortHash(hash)}`,
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
