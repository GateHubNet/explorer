// What a search input names, found out by asking the data API and, for a hash it has not indexed, the node (spec 3, 6, 10):
// the transaction behind a CTID, and what a 64-digit hash is. Both answer "nothing" for a thing that does not exist and
// let an upstream failure through, because the two are different pages: "not found" is a 404 that may be stored for 30 s,
// a failure is a 503 that is never stored. Worker-only code, for loaders; the callers map failures with `upstreamFailure`.

import { decodeCtid } from "../domain/ctid";
import type { DataApi } from "./data-api";
import { networkIdOfCtid, type Network, type NetworkId } from "./networks";
import type { NodeRpc } from "./node-rpc";
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

/** What a hash is, as far as the choice page needs to say. Either part, both or neither is there. */
export interface HashMatches {
  tx?: { ledgerIndex: number; type: string };
  /** `closeTime` in unix seconds. */
  ledger?: { index: number; closeTime: number };
}

interface Asked {
  matches: HashMatches;
  /** The failures that are not "not found". */
  failures: unknown[];
}

/**
 * Asks for the transaction and the ledger of a hash side by side, and waits for both, so that nothing runs on after the answer.
 * What the answers hold is checked here, because a 200 is not proof of a transaction: one without its `tx` (or a ledger without
 * its index) is the upstream failing, and is counted as a failure, not read through (a TypeError would be a 500).
 */
async function ask(
  transaction: () => Promise<{ ledger_index: unknown; tx?: unknown }>,
  ledger: () => Promise<{ ledger_index: unknown; close_time: unknown }>,
): Promise<Asked> {
  const [tx, lgr] = await Promise.allSettled([transaction(), ledger()]);
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
  return { matches, failures };
}

/**
 * What a 64-hex hash names (spec 6): a transaction, a ledger, both (the choice page) or neither (`{}`).
 *
 * The data API is asked for both. When it has neither, the node is (spec 10: history before the backfill, the seconds before
 * ingest), so that a search finds what the page itself could show. A failure of the one asked is thrown, but only when it
 * leaves the question open: something found is an answer however the other call went, and the node is not asked in place of
 * a data API that failed.
 */
export async function findHash(api: DataApi, node: NodeRpc, hash: string): Promise<HashMatches> {
  for (const asked of [
    () => ask(() => api.transaction(hash), () => api.ledger(hash)),
    () => ask(() => node.tx(hash), () => node.ledger(hash)),
  ]) {
    const { matches, failures } = await asked();
    if (matches.tx || matches.ledger) return matches;
    if (failures.length > 0) throw failures[0];
  }
  return {};
}
