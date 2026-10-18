// What the transaction page shows, worked out in the Worker from a transaction, its metadata and the ledger it sits in (spec 3,
// 7.2, 7.3): the title and result, the sentence and the flow of the money, the details, the balance changes, the ledger objects
// touched, the neighbours in the ledger and the raw JSON. The page gets this and draws it; it never gets the transaction as
// data, only as the text of the raw tabs, so the code that reads metadata stays out of the browser bundle. No I/O.

import { encodeCtid } from "../domain/ctid";
import { describe, type Detail, type FlowStep, type Segment } from "../domain/describe";
import { decodeHex } from "../domain/describe/helpers";
import { dropsToNative, formatAmount, formatCurrency, shortAddress, shortHash } from "../domain/format";
import { balanceChanges, objectsTouched } from "../domain/parse";
import { isPoolAccountRoot, nodesOf } from "../domain/parse/objects";
import type { BalanceChange, Native, TouchedObject, TxJson, TxMeta } from "../domain/parse/types";
import type { TxBinary, TxObject, TxStoredJson } from "./api-types";
import type { NodeTx } from "./node-rpc";
import { searchOnOther, type NetworkName, type SearchPageData } from "./search-view";
import { checkNodeTransaction, isObject, malformed } from "./tx-shape";

// ---- What a transaction is, whichever of the data API and the node it came from -------------------------------------

/** A transaction as the page needs it. */
export interface TransactionSource {
  /** Where it came from: the index (the data API) or, when that has not got it yet, the network's own node. */
  origin: "index" | "node";
  /** In upper case. */
  hash: string;
  ledgerIndex: number;
  /** Unix seconds: the close time of its ledger. */
  closeTime: number;
  tx: TxJson;
  meta: TxMeta;
}

/**
 * The data API's `/v2/transactions/{hash}`. The client has checked what it gives (`checkIndexTransaction`, inside the load its cache
 * runs), so this only reads it: the hash in upper case, the time in unix seconds.
 */
export function txFromIndex(object: TxObject): TransactionSource {
  return {
    origin: "index",
    hash: object.hash.toUpperCase(),
    ledgerIndex: object.ledger_index,
    closeTime: Date.parse(object.date) / 1000,
    tx: object.tx,
    meta: object.meta,
  };
}

/** The node's `tx`: a transaction of a validated ledger, its time already in unix seconds. The node client reads less of it, so it is checked here. */
export function txFromNode(object: NodeTx, expectedHash: string): TransactionSource {
  checkNodeTransaction(object, expectedHash);
  return {
    origin: "node",
    hash: object.hash.toUpperCase(),
    ledgerIndex: object.ledger_index,
    closeTime: object.date,
    tx: object.tx,
    meta: object.meta,
  };
}

// ---- Neighbours and the binary form -------------------------------------------------------------------------------------

/** A transaction next to this one in its ledger, by its place (the `TransactionIndex` the ledger page lists). */
export interface Neighbour {
  position: number;
  /** In upper case. */
  hash: string;
}

export interface Neighbours {
  /** How many transactions the ledger has. */
  count: number;
  previous: Neighbour | null;
  next: Neighbour | null;
}

/**
 * The transactions before and after `hash`, from the hashes of its ledger (`/v2/ledgers/{index}?transactions=true`, a list of hashes
 * the client has checked), which are in the order of the ledger: the one at `position` must be this one. A list that says
 * otherwise is the upstream's fault and throws an `UpstreamError`: an immutable page must not store a wrong neighbour.
 */
export function neighboursOf(hashes: readonly string[], hash: string, position: number): Neighbours {
  if (hashes[position]?.toUpperCase() !== hash.toUpperCase()) {
    throw malformed("data API ledger", "a list that does not hold the transaction at its place");
  }
  const at = (place: number): Neighbour | null => {
    const neighbour = hashes[place];
    return neighbour === undefined ? null : { position: place, hash: neighbour.toUpperCase() };
  };
  return { count: hashes.length, previous: at(position - 1), next: at(position + 1) };
}

/**
 * The Binary tab:
 * - `ready`: the hex of the serialization;
 * - `unsupported`: the API's codec cannot serialize this type of transaction and it served the stored JSON instead, which is a
 *   lasting answer (the page is `immutable` and says the index has no binary form);
 * - `failed`: the binary form could not be had, and asking again can help (the page is stored `short`, and says so);
 * - `pending`: a transaction shown from the node, whose binary form appears once it is indexed.
 */
export type BinaryRaw = { state: "ready"; tx: string; meta: string } | { state: "unsupported" } | { state: "failed" } | { state: "pending" };

/** What `binary=true` gave, which the client has checked: hex, or the stored JSON in its place. */
export function binaryOf(answer: TxBinary | TxStoredJson): Extract<BinaryRaw, { state: "ready" | "unsupported" }> {
  return typeof answer.tx === "string" && typeof answer.meta === "string"
    ? { state: "ready", tx: answer.tx, meta: answer.meta }
    : { state: "unsupported" };
}

// ---- The page ------------------------------------------------------------------------------------------------------------

/** What an account was in the transaction, when it was something: the row of the balance changes says so. */
export type ChangeRole = "sender" | "destination" | "pool";

export type ChangeRow = BalanceChange & { role?: ChangeRole };

export interface Memo {
  /** The memo's data: text, or its hex when it is not text; empty for a memo without data. */
  text: string;
  /** `text` is hex, not text. */
  hex: boolean;
  /** Its type and format, as text, joined: `note · text/plain`; empty when it has neither. */
  note: string;
}

export interface TransactionPageData {
  kind: "transaction";
  origin: TransactionSource["origin"];
  /** In upper case. */
  hash: string;
  /** `null` for a place that does not fit one (a ledger index of 2^28 or more). */
  ctid: string | null;
  ledgerIndex: number;
  /** Unix seconds. */
  closeTime: number;
  /** Its place in the ledger (`TransactionIndex`, the number the ledger page's "#" column shows), and how many there are: `null` when not known. */
  position: { index: number; count: number | null };
  /** `TransactionType` as it is. */
  type: string;
  /** What `describe` calls the kind of transaction: `Payment`, `Offer`, `Trust line`. */
  title: string;
  ok: boolean;
  result: { code: string; ok: boolean; text: string };
  sentence: Segment[];
  /** The sentence as plain text, for the page's description. */
  summary: string;
  /** Sender, the pools or offers on the way, destination: only for a transaction that moved something. */
  flow: FlowStep[] | null;
  account: string;
  /** Whole units of the native currency, a plain decimal. */
  fee: string;
  sequence: number | null;
  /** The type's own details, with the destination ahead of them when the type does not list it. */
  details: Detail[];
  memos: Memo[];
  /** The sender's native change is the whole change of its balance, so it includes the fee (spec 1.1). */
  changes: ChangeRow[];
  objects: TouchedObject[];
  /** `null` when they are not shown (a transaction from the node: they appear once it is indexed). */
  neighbours: { previous: Neighbour | null; next: Neighbour | null } | null;
  raw: { tx: string; meta: string; binary: BinaryRaw };
}

/** Memos shown, and the characters of one, before the rest is left to the raw tabs. */
const MAX_MEMOS = 10;
const MAX_MEMO_CHARS = 400;

function cut(text: string): string {
  const characters = Array.from(text);
  return characters.length > MAX_MEMO_CHARS ? `${characters.slice(0, MAX_MEMO_CHARS).join("")}…` : text;
}

/** A memo field (hex on the ledger) as text, when it is text. */
function memoText(raw: unknown): string | undefined {
  return typeof raw === "string" ? decodeHex(raw) : undefined;
}

function memosOf(tx: TxJson): Memo[] {
  if (!Array.isArray(tx.Memos)) return [];
  const memos: Memo[] = [];
  for (const entry of tx.Memos as unknown[]) {
    if (memos.length >= MAX_MEMOS) break;
    const memo = isObject(entry) ? entry.Memo : undefined;
    if (!isObject(memo)) continue;

    const data = memo.MemoData;
    const decoded = memoText(data);
    const note = [memoText(memo.MemoType), memoText(memo.MemoFormat)].filter((part): part is string => part !== undefined && part !== "").join(" · ");
    if (typeof data !== "string") memos.push({ text: "", hex: false, note });
    else if (decoded === undefined) memos.push({ text: cut(data), hex: true, note });
    else memos.push({ text: cut(decoded), hex: false, note });
  }
  return memos;
}

/** A sentence as plain text: accounts shortened, amounts as the page writes them, a pool by its pair. */
export function plainText(segments: readonly Segment[]): string {
  return segments
    .map((segment) => {
      switch (segment.t) {
        case "text":
          return segment.v;
        case "account":
          return shortAddress(segment.v);
        case "amount":
          return `${formatAmount(segment.value)} ${formatCurrency(segment.currency)}`;
        case "pool":
          return segment.pair;
      }
    })
    .join("");
}

function ctidOf(ledgerIndex: number, position: number, networkId: number): string | null {
  try {
    return encodeCtid(ledgerIndex, position, networkId);
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
}

/** Where each account of the balance changes stands in the transaction: the sender, the destination, an AMM pool. */
function withRoles(changes: BalanceChange[], tx: TxJson, meta: TxMeta): ChangeRow[] {
  const pools = new Set<string>();
  for (const node of nodesOf(meta)) {
    if (isPoolAccountRoot(node) && typeof node.fields.Account === "string") pools.add(node.fields.Account);
  }
  return changes.map((change) => {
    const role: ChangeRole | undefined =
      change.account === tx.Account ? "sender" : change.account === tx.Destination ? "destination" : pools.has(change.account) ? "pool" : undefined;
    return role === undefined ? change : { ...change, role };
  });
}

export function transactionPage(
  source: TransactionSource,
  opts: { network: { native: Native; ctidNetworkId: number }; neighbours: Neighbours | null; binary: BinaryRaw },
): TransactionPageData {
  const { tx, meta } = source;
  const description = describe(tx, meta, { native: opts.network.native });
  const position = meta.TransactionIndex;

  const destination = typeof tx.Destination === "string" && tx.Destination !== "" ? tx.Destination : undefined;
  const details: Detail[] = [...description.details];
  if (destination !== undefined && !details.some((detail) => detail.label === "Destination")) {
    details.unshift({ label: "Destination", value: [{ t: "account", v: destination }] });
  }

  // The tag is part of who gets the money.
  const flow =
    description.flow?.map((step) =>
      step.role === "destination" && typeof tx.DestinationTag === "number" ? { ...step, label: `${step.label} · tag ${tx.DestinationTag}` } : step,
    ) ?? null;

  return {
    kind: "transaction",
    origin: source.origin,
    hash: source.hash,
    ctid: ctidOf(source.ledgerIndex, position, opts.network.ctidNetworkId),
    ledgerIndex: source.ledgerIndex,
    closeTime: source.closeTime,
    position: { index: position, count: opts.neighbours?.count ?? null },
    type: tx.TransactionType,
    title: description.title,
    ok: description.ok,
    result: description.result,
    sentence: description.sentence,
    summary: plainText(description.sentence),
    flow,
    account: tx.Account,
    fee: typeof tx.Fee === "string" ? dropsToNative(tx.Fee) : "0",
    sequence: typeof tx.Sequence === "number" ? tx.Sequence : null,
    details,
    memos: memosOf(tx),
    changes: withRoles(balanceChanges(tx, meta, opts.network.native), tx, meta),
    objects: objectsTouched(meta),
    neighbours: opts.neighbours ? { previous: opts.neighbours.previous, next: opts.neighbours.next } : null,
    raw: { tx: JSON.stringify(tx, null, 2), meta: JSON.stringify(meta, null, 2), binary: opts.binary },
  };
}

/**
 * The page for a transaction that neither the data API nor the node has: the not-found page of the search (`SearchPageData`),
 * with the offer to look for the hash on the other network, where a hash seen here may well be.
 */
export function transactionNotFoundPage(hash: string, other: NetworkName): SearchPageData {
  return {
    kind: "not-found",
    query: hash,
    what: `transaction ${shortHash(hash)}`,
    suggestion: searchOnOther(hash, other),
  };
}
