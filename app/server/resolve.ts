// What a search input names, found out by asking the data API and, for a hash it has not indexed, the node (spec 3, 6, 10;
// NFT spec 7; ledger object pages spec 8): the transaction behind a CTID, and what a 64-digit hash is. Both answer "nothing" for a thing that does not exist and
// let an upstream failure through, because the two are different pages: "not found" is a 404 that may be stored for 30 s,
// a failure is a 503 that is never stored. Worker-only code, for loaders; the callers map failures with `upstreamFailure`.

import { isValidClassicAddress } from "ripple-address-codec";

import { decodeCtid } from "../domain/ctid";
import type { HashNounOptions } from "../domain/hash-nouns";
import type { LedgerObjectRef, NftAnswer, NftKind } from "./api-types";
import type { DataApi } from "./data-api";
import { networkIdOfCtid, type Network, type NetworkId } from "./networks";
import { toUriToken, type LedgerEntry, type NodeRpc } from "./node-rpc";
import { readNodeNft, type NodeNft } from "./nft-read";
import { OBJECT_TYPES } from "./object-shape";
import { UpstreamError } from "./upstream";

const HEX_64 = /^[0-9A-Fa-f]{64}$/;

/** An answer that is not what the upstream's reference promises: its failure, never a page that says "not found". */
const malformed = (what: string) => new UpstreamError("server", `${what} answered something unexpected`, { status: 200 });

/** Whether an upstream says the thing is not there (or refuses its name as malformed, which for a name we built is the same). */
function isMissing(err: unknown): boolean {
  return err instanceof UpstreamError && (err.kind === "not_found" || err.kind === "bad_request");
}

/**
 * The transaction a CTID names (spec 3). The data API is asked for the ledger the CTID says, with its transactions' hashes,
 * and the hash at the CTID's transaction index is the answer.
 *
 * - `{ hash }`: the transaction, in upper case.
 * - `{ otherNetwork }`: the CTID belongs to the other network (its network id is that network's, of the kind the environment shows); nobody is asked.
 * - `null`: there is no such transaction. That is a ledger the data API does not have, an index past the end of the ledger,
 *   text that is not a CTID, and a network id that is neither of the two networks of this environment's kind (a mainnet CTID in the sandbox, a
 *   testnet one in production): never taken for one of the two.
 *
 * An upstream failure other than "not found" is thrown as it is (an `UpstreamError`): the caller decides what the visitor sees.
 * So is an answer that cannot be right: a list of hashes that is not a list, or a hash in it that is not 64 hex digits (it goes
 * into a redirect and a path, and a ledger that has one is the upstream's fault, not a transaction that does not exist).
 */
export async function resolveCtid(
  api: DataApi,
  net: Network,
  ctid: string,
): Promise<{ hash: string } | { otherNetwork: NetworkId } | null> {
  const decoded = decodeCtid(ctid);
  if (!decoded) return null;

  const owner = networkIdOfCtid(decoded.networkId, net.kind);
  if (owner === undefined) return null;
  if (owner !== net.id) return { otherNetwork: owner };

  let ledger;
  try {
    ledger = await api.ledger(String(decoded.ledgerIndex), { transactions: true });
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }

  const hashes: unknown = ledger.transactions;
  if (!Array.isArray(hashes)) throw malformed(`data API ledger ${decoded.ledgerIndex}`);
  if (decoded.txIndex >= hashes.length) return null;

  const hash: unknown = hashes[decoded.txIndex];
  if (typeof hash !== "string" || !HEX_64.test(hash)) throw malformed(`data API ledger ${decoded.ledgerIndex}`);
  return { hash: hash.toUpperCase() };
}

/**
 * What a hash is, as far as the choice page needs to say. Any of the parts, several or none is there. `nft` is an NFT of XRPL or a URIToken of Xahau whose id this is: its issuer
 * (and, for an NFT, its taxon and serial, which a URIToken does not have) and whether it is burned, which is all the choice page says of it. `object` is an escrow, a check, a payment
 * channel or a delegation (E10): its `type` (the ledger entry type), its owner (the delegator of a `Delegate`) and whether it was deleted; an object the node holds is in the ledger now,
 * so never deleted.
 */
export interface HashMatches {
  tx?: { ledgerIndex: number; type: string };
  /** `closeTime` in unix seconds. */
  ledger?: { index: number; closeTime: number };
  nft?: { kind: NftKind; issuer: string; taxon?: number; serial?: number; burned: boolean };
  object?: { type: LedgerObjectRef["object_type"]; account: string; deleted: boolean };
}

/**
 * What a search asks of a 64-digit hash besides the transaction and the ledger, which it always asks: `net` says which command asks the node for an NFT (XRPL's `nft_info`,
 * Xahau's `ledger_entry` of a URIToken), and the switches (`HashNounOptions`, app/domain/hash-nouns.ts, which the words of the search read too) whether it asks for one at all: `nfts`, the
 * `NFTS` switch, while it is off no NFT question is asked of the index or the node, and `ledgerObjects`, the `LEDGER_OBJECTS` switch, the same for the object question (E10). A feature that
 * adds a question adds its switch to `HashNounOptions`, not here.
 */
export interface HashQuestions extends HashNounOptions {
  net: NetworkId;
}

type NftMatch = NonNullable<HashMatches["nft"]>;

/** The NFT of the index's answer (`/v2/nfts/{id}`, whose shape the client has checked: the kind, the issuer, the whole numbers and `burned`). */
function nftOfIndex({ nft }: NftAnswer): NftMatch {
  return { kind: nft.kind, issuer: nft.issuer, ...(nft.taxon !== undefined && { taxon: nft.taxon }), ...(nft.serial !== undefined && { serial: nft.serial }), burned: nft.burned };
}

/** The NFT of the node's answer (XRPL's `nft_info`, Xahau's URIToken entry: a burned URIToken is no entry, so one that the node has is not burned). */
function nftOfNode(entry: NodeNft): NftMatch {
  return "nft_id" in entry
    ? { kind: "nftoken", issuer: entry.issuer, taxon: entry.nft_taxon, serial: entry.nft_serial, burned: entry.is_burned }
    : { kind: "uritoken", issuer: entry.Issuer, burned: false };
}

/** An object a search found: the part of `HashMatches` that says so. */
export type ObjectMatch = NonNullable<HashMatches["object"]>;

/** Whether a ledger entry type is one the index tracks as an object (`OBJECT_TYPES`, object-shape.ts: the list its answers are checked by): any other entry the node holds is nothing to a search. */
const isObjectType = (type: string): type is ObjectMatch["type"] => (OBJECT_TYPES as readonly string[]).includes(type);

/** The object of the index's answer (`/v2/ledger_objects/{id}`, whose shape the client has checked: the type, the account and `deleted`). */
function objectOfIndex({ object_type: type, account, deleted }: LedgerObjectRef): ObjectMatch {
  return { type, account, deleted };
}

/**
 * The object of the node's entry (`ledger_entry`), or none for an entry of a type the index does not track (an account root, an offer, a URIToken): nothing, which is no failure. An
 * entry of a tracked type that has no account is the node failing (the account goes into a link and a row). The node holds what is in the ledger now: never deleted.
 */
function objectOfEntry({ node }: LedgerEntry): ObjectMatch | undefined {
  const type = node.LedgerEntryType;
  if (!isObjectType(type)) return undefined;
  const account = node.Account;
  if (typeof account !== "string" || !isValidClassicAddress(account)) throw malformed("ledger entry lookup");
  return { type, account, deleted: false };
}

/** The questions of one side (the index's or the node's): `nft` and `object` are there only while their switches are on. A question that is answered with `undefined` found nothing. */
interface Questions {
  transaction: () => Promise<{ ledger_index: unknown; tx?: unknown }>;
  ledger: () => Promise<{ ledger_index: unknown; close_time: unknown }>;
  nft?: () => Promise<NftMatch | undefined>;
  object?: () => Promise<ObjectMatch | undefined>;
}

interface Asked {
  matches: HashMatches;
  /** The failures that are not "not found". */
  failures: unknown[];
}

/**
 * Asks the questions of one side side by side, and waits for all of them, so that nothing runs on after the answer. What the answers of the transaction and the ledger hold is
 * checked here, because a 200 is not proof of a transaction: one without its `tx` (or a ledger without its index) is the upstream failing, and is counted as a failure, not read
 * through (a TypeError would be a 500). The NFT and object questions are made of answers that are already checked (the clients check their shapes; the node's entry is checked where it is
 * turned into a match), so their failures are the clients'.
 */
async function ask({ transaction, ledger, nft, object }: Questions): Promise<Asked> {
  const [tx, lgr, token, thing] = await Promise.allSettled([transaction(), ledger(), nft?.(), object?.()]);
  const matches: HashMatches = {};
  const failures: unknown[] = [];

  if (tx.status === "fulfilled") {
    const { ledger_index: ledgerIndex, tx: body } = tx.value ?? {};
    const type = typeof body === "object" && body !== null ? (body as { TransactionType?: unknown }).TransactionType : undefined;
    if (typeof type === "string" && typeof ledgerIndex === "number" && Number.isFinite(ledgerIndex)) {
      matches.tx = { ledgerIndex, type };
    } else {
      failures.push(malformed("transaction lookup"));
    }
  } else if (!isMissing(tx.reason)) {
    failures.push(tx.reason);
  }

  if (lgr.status === "fulfilled") {
    const { ledger_index: index, close_time: closeTime } = lgr.value ?? {};
    if (typeof index === "number" && Number.isFinite(index) && typeof closeTime === "number" && Number.isFinite(closeTime)) {
      matches.ledger = { index, closeTime };
    } else {
      failures.push(malformed("ledger lookup"));
    }
  } else if (!isMissing(lgr.reason)) {
    failures.push(lgr.reason);
  }

  if (token.status === "fulfilled") {
    if (token.value !== undefined) matches.nft = token.value;
  } else if (!isMissing(token.reason)) {
    failures.push(token.reason);
  }

  if (thing.status === "fulfilled") {
    if (thing.value !== undefined) matches.object = thing.value;
  } else if (!isMissing(thing.reason)) {
    failures.push(thing.reason);
  }
  return { matches, failures };
}

/**
 * The node's NFT and object questions. XRPL asks two commands (`nft_info` and `ledger_entry`); Xahau reads a URIToken and an object with the one, `ledger_entry` by id, so while both
 * switches are on it is asked once and both questions read its answer (the failure, "not found" and the entry alike). The URIToken is read from that entry by the reader `uriToken` uses
 * (`toUriToken`: an entry of another type is "not found", a corrupt one a failure), so it is found or fails as it does with `NFTS` alone. With one switch on the questions are what they
 * were: the NFT page's reader for the NFT, the entry for the object.
 */
function entryQuestions(node: NodeRpc, net: NetworkId, hash: string, { nfts, ledgerObjects }: HashNounOptions): Pick<Questions, "nft" | "object"> {
  if (net === "xahau" && nfts && ledgerObjects) {
    let read: Promise<LedgerEntry> | undefined;
    const entry = () => (read ??= node.ledgerEntry(hash));
    // The reader needs the native currency of the network for a sell offer's amount; the search says nothing of it, and this branch is Xahau's.
    return { nft: () => entry().then((read) => nftOfNode(toUriToken("node ledger_entry", "XAH", read))), object: () => entry().then(objectOfEntry) };
  }
  return {
    ...(nfts && { nft: () => readNodeNft(node, { id: net }, hash).then(nftOfNode) }),
    ...(ledgerObjects && { object: () => node.ledgerEntry(hash).then(objectOfEntry) }),
  };
}

/**
 * What a 64-hex hash names (spec 6; NFT spec 7; ledger object pages spec 8): a transaction, a ledger, an NFT (a URIToken on Xahau), an escrow, a check, a payment channel or a delegation, several
 * (the choice page) or none (`{}`).
 *
 * The sequence, whose parts later features extend: (1) the data API is asked side by side for the transaction, the ledger, while `nfts` the NFT (`api.nft`) and while `ledgerObjects` the
 * object (`api.ledgerObject`); (2) only when it has none of them, the node is (spec 10: history before the backfill, the seconds before ingest), side by side for `tx`, `ledger`, while `nfts` the NFT
 * (`nftInfo` on XRPL, `uriToken` on Xahau, by `readNodeNft`, which the NFT page reads the node with: a node that is not Clio is "not found", not a failure) and while `ledgerObjects` the object
 * (`ledgerEntry`, of a tracked type: any other entry is nothing; on Xahau one `ledger_entry` read answers both, `entryQuestions`). A failure of the side asked is thrown, but only when it
 * leaves the question open: something found is an answer however another question of its side went, and the node is not asked in place of a data API with a question that failed.
 *
 * The NFT page's own rule (`settleNft`: the index first and the node after it where `needsNode` says so) is not what this asks: a search needs to know that there is an NFT, so an
 * NFT of the index with no owner is found as it is, and the node's NFT is asked only when the index had none of the three (the NFT page asks the node whenever the index lacks the NFT).
 */
export async function findHash(api: DataApi, node: NodeRpc, hash: string, questions: HashQuestions): Promise<HashMatches> {
  const { net, nfts, ledgerObjects } = questions;
  for (const asked of [
    () =>
      ask({
        transaction: () => api.transaction(hash),
        ledger: () => api.ledger(hash),
        ...(nfts && { nft: () => api.nft(hash).then(nftOfIndex) }),
        ...(ledgerObjects && { object: () => api.ledgerObject(hash).then(objectOfIndex) }),
      }),
    () => ask({ transaction: () => node.tx(hash), ledger: () => node.ledger(hash), ...entryQuestions(node, net, hash, questions) }),
  ]) {
    const { matches, failures } = await asked();
    if (matches.tx || matches.ledger || matches.nft || matches.object) return matches;
    if (failures.length > 0) throw failures[0];
  }
  return {};
}
