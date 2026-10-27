// What a search input names, found out by asking the data API and, for a hash it has not indexed, the node (spec 3, 6, 10;
// NFT spec 7): the transaction behind a CTID, and what a 64-digit hash is. Both answer "nothing" for a thing that does not exist and
// let an upstream failure through, because the two are different pages: "not found" is a 404 that may be stored for 30 s,
// a failure is a 503 that is never stored. Worker-only code, for loaders; the callers map failures with `upstreamFailure`.

import { decodeCtid } from "../domain/ctid";
import type { NftAnswer, NftKind } from "./api-types";
import type { DataApi } from "./data-api";
import { networkIdOfCtid, type Network, type NetworkId } from "./networks";
import type { NodeRpc } from "./node-rpc";
import { readNodeNft, type NodeNft } from "./nft-read";
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
 * (and, for an NFT, its taxon and serial, which a URIToken does not have) and whether it is burned, which is all the choice page says of it.
 */
export interface HashMatches {
  tx?: { ledgerIndex: number; type: string };
  /** `closeTime` in unix seconds. */
  ledger?: { index: number; closeTime: number };
  nft?: { kind: NftKind; issuer: string; taxon?: number; serial?: number; burned: boolean };
}

/**
 * What a search asks of a 64-digit hash besides the transaction and the ledger, which it always asks: `net` says which command asks the node for an NFT (XRPL's `nft_info`,
 * Xahau's `ledger_entry` of a URIToken), and `nfts` whether it asks for one at all (the `NFTS` switch: while it is off no NFT question is asked of the index or the node).
 * Later features add their questions here (E10: `ledgerObjects`).
 */
export interface HashQuestions {
  net: NetworkId;
  nfts: boolean;
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

/** The questions of one side (the index's or the node's): `nft` is there only while the switch is on. */
interface Questions {
  transaction: () => Promise<{ ledger_index: unknown; tx?: unknown }>;
  ledger: () => Promise<{ ledger_index: unknown; close_time: unknown }>;
  nft?: () => Promise<NftMatch>;
}

interface Asked {
  matches: HashMatches;
  /** The failures that are not "not found". */
  failures: unknown[];
}

/**
 * Asks the questions of one side side by side, and waits for all of them, so that nothing runs on after the answer. What the answers of the transaction and the ledger hold is
 * checked here, because a 200 is not proof of a transaction: one without its `tx` (or a ledger without its index) is the upstream failing, and is counted as a failure, not read
 * through (a TypeError would be a 500). The NFT question is made of an answer that is already checked (the clients check the NFT's shape), so its failures are the clients'.
 */
async function ask({ transaction, ledger, nft }: Questions): Promise<Asked> {
  const [tx, lgr, token] = await Promise.allSettled([transaction(), ledger(), nft?.()]);
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
  return { matches, failures };
}

/**
 * What a 64-hex hash names (spec 6; NFT spec 7): a transaction, a ledger, an NFT (a URIToken on Xahau), several (the choice page) or none (`{}`).
 *
 * The sequence, whose parts later features extend: (1) the data API is asked side by side for the transaction, the ledger and, while `nfts`, the NFT (`api.nft`); (2) only when it
 * has none of them, the node is (spec 10: history before the backfill, the seconds before ingest), side by side for `tx`, `ledger` and, while `nfts`, the NFT (`nftInfo` on XRPL, `uriToken`
 * on Xahau, by `readNodeNft`, which the NFT page reads the node with: a node that is not Clio is "not found", not a failure). A failure of the side asked is thrown, but only when it
 * leaves the question open: something found is an answer however another question of its side went, and the node is not asked in place of a data API with a question that failed.
 *
 * The NFT page's own rule (`settleNft`: the index first and the node after it where `needsNode` says so) is not what this asks: a search needs to know that there is an NFT, so an
 * NFT of the index with no owner is found as it is, and the node's NFT is asked only when the index had none of the three (the NFT page asks the node whenever the index lacks the NFT).
 */
export async function findHash(api: DataApi, node: NodeRpc, hash: string, { net, nfts }: HashQuestions): Promise<HashMatches> {
  for (const asked of [
    () => ask({ transaction: () => api.transaction(hash), ledger: () => api.ledger(hash), ...(nfts && { nft: () => api.nft(hash).then(nftOfIndex) }) }),
    () => ask({ transaction: () => node.tx(hash), ledger: () => node.ledger(hash), ...(nfts && { nft: () => readNodeNft(node, { id: net }, hash).then(nftOfNode) }) }),
  ]) {
    const { matches, failures } = await asked();
    if (matches.tx || matches.ledger || matches.nft) return matches;
    if (failures.length > 0) throw failures[0];
  }
  return {};
}
