// What a transaction, its binary form and the hashes of a ledger must look like for the pages to use them, checked where they come
// in. The data API client runs the checks inside the load its subrequest cache runs: an answer is stored for a year (class
// immutable), so a 200 that is not what the reference promises must be a failure there, never a value. The transaction view
// runs the check of a transaction on what the node gives (the node client reads less of it). A failure is an `UpstreamError`
// of kind `server` (a 503 that is never stored); `status: 200` marks it as an answer of the upstream, not a transport failure.
// Worker-only code, no I/O.

import { UpstreamError } from "./upstream";

export const HEX_64 = /^[0-9A-Fa-f]{64}$/;
/** A blob of hex: whole bytes, at least one. */
const HEX_BLOB = /^(?:[0-9A-Fa-f]{2})+$/;

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** An answer that is not what the upstream's reference promises. */
export function malformed(what: string, why: string): UpstreamError {
  return new UpstreamError("server", `${what} answered something unexpected: ${why}`, { status: 200 });
}

/** The parts of a transaction as an upstream gives them, before they are known to be one. */
export interface UncheckedTransaction {
  hash: unknown;
  ledgerIndex: unknown;
  /** Unix seconds; `NaN` when the upstream gave no usable time. */
  closeTime: number;
  tx: unknown;
  meta: unknown;
}

/**
 * Throws unless the parts are a transaction the page can describe: the hash asked for, a ledger index, a time, a transaction with
 * its type and account, and metadata with its result, its place in the ledger and its nodes (`describe` and `parse` read those).
 */
export function checkTransaction(what: string, parts: UncheckedTransaction, expectedHash: string): void {
  const { hash, ledgerIndex, closeTime, tx, meta } = parts;
  if (typeof hash !== "string" || !HEX_64.test(hash) || hash.toUpperCase() !== expectedHash.toUpperCase()) {
    throw malformed(what, "a transaction with another hash than the one asked for");
  }
  if (typeof ledgerIndex !== "number" || !Number.isSafeInteger(ledgerIndex) || ledgerIndex < 0) throw malformed(what, "no ledger index");
  if (!Number.isFinite(closeTime)) throw malformed(what, "no time");
  if (!isObject(tx) || typeof tx.TransactionType !== "string" || typeof tx.Account !== "string") {
    throw malformed(what, "a transaction without its type and account");
  }
  if (
    !isObject(meta) ||
    typeof meta.TransactionResult !== "string" ||
    typeof meta.TransactionIndex !== "number" ||
    !Number.isInteger(meta.TransactionIndex) ||
    meta.TransactionIndex < 0 ||
    !Array.isArray(meta.AffectedNodes)
  ) {
    throw malformed(what, "metadata without its result, place and nodes");
  }
}

/** `GET /v2/transactions/{hash}`: the transaction of `expectedHash`, whole. */
export function checkIndexTransaction(object: unknown, expectedHash: string): void {
  const o: Record<string, unknown> = isObject(object) ? object : {};
  const closeTime = typeof o.date === "string" ? Date.parse(o.date) / 1000 : Number.NaN;
  checkTransaction("data API transaction", { hash: o.hash, ledgerIndex: o.ledger_index, closeTime, tx: o.tx, meta: o.meta }, expectedHash);
}

/** The node's `tx`: a transaction in a validated ledger, its time already in unix seconds. */
export function checkNodeTransaction(object: unknown, expectedHash: string): void {
  const o: Record<string, unknown> = isObject(object) ? object : {};
  const closeTime = typeof o.date === "number" ? o.date : Number.NaN;
  checkTransaction("node transaction", { hash: o.hash, ledgerIndex: o.ledger_index, closeTime, tx: o.tx, meta: o.meta }, expectedHash);
}

/**
 * `GET /v2/transactions/{hash}?binary=true`: `tx` and `meta` as the hex of the serialization, or, for a type the API's codec
 * cannot serialize, as the JSON it stored (api-reference.md: it serves that instead of failing the page). Both are lasting answers.
 * Hex in one and JSON in the other, or anything else, is not.
 */
export function checkBinaryAnswer(object: unknown, expectedHash: string): void {
  const what = "data API transaction (binary)";
  const o: Record<string, unknown> = isObject(object) ? object : {};
  if (typeof o.hash !== "string" || !HEX_64.test(o.hash) || o.hash.toUpperCase() !== expectedHash.toUpperCase()) {
    throw malformed(what, "a transaction with another hash than the one asked for");
  }
  const { tx, meta } = o;
  if (typeof tx === "string" && typeof meta === "string") {
    if (!HEX_BLOB.test(tx)) throw malformed(what, "tx is not hex");
    if (!HEX_BLOB.test(meta)) throw malformed(what, "meta is not hex");
    return;
  }
  if (isObject(tx) && isObject(meta)) return;
  throw malformed(what, "tx and meta are neither both hex nor both JSON");
}

/** `GET /v2/ledgers/{id}?transactions=true`: a ledger with its list of transaction hashes (`[]` for none), every one 64 hex digits. */
export function checkLedgerHashes(ledger: unknown): void {
  const what = "data API ledger";
  const list = isObject(ledger) ? ledger.transactions : undefined;
  if (!Array.isArray(list)) throw malformed(what, "no list of transactions");
  for (const hash of list as unknown[]) {
    if (typeof hash !== "string" || !HEX_64.test(hash)) throw malformed(what, "a transaction that is not a hash");
  }
}
