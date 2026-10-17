// The client of a network's own node (rippled for the XRP Ledger, xahaud for Xahau) over JSON-RPC. The explorer
// asks the node for what the data API does not hold: an account's live state, the reserves, and (spec 10) a
// transaction or ledger the API has not indexed yet. Only loaders use it. Worker-only code.
//
// Every call is limited to 3 s (answer included). The node's failures arrive as `result.status: "error"`
// with HTTP 200; they become `UpstreamError`s, `actNotFound`, `txnNotFound` and `lgrNotFound` as `not_found`.
//
// Times: the node counts seconds from 2000-01-01 (the Ripple epoch). This client converts every such time it
// returns (`date` of a transaction, `close_time` and `parent_close_time` of a ledger, `close_time` of the
// server state's ledgers) to unix seconds at this boundary, so that nothing outside it sees the Ripple epoch.
// Requests are API version 1, the node's default: the shapes below are rippled's v1 shapes.

import type { TxJson, TxMeta } from "../domain/parse/types";
import type { CacheClass, SubrequestCache } from "./cache-class";
import type { Network } from "./networks";
import { clip, NODE_TIMEOUT_MS, retryAfterOf, UpstreamError, withDeadline } from "./upstream";

export { UpstreamError } from "./upstream";
export type { UpstreamErrorKind } from "./upstream";

/** Seconds from the unix epoch to the Ripple epoch, 2000-01-01 00:00:00 UTC. */
export const RIPPLE_EPOCH_OFFSET = 946_684_800;

// ---- What the client returns ---------------------------------------------------------------------------------------

/**
 * A transaction in a validated ledger, in the shape of the data API's `TxObject` except for `date`, which is
 * unix seconds here (the ledger's close time) where the API has an ISO string.
 */
export interface NodeTx {
  hash: string;
  ledger_index: number;
  ledger_hash?: string;
  /** Unix seconds. */
  date: number;
  tx: TxJson;
  meta: TxMeta;
}

/** A validated ledger. */
export interface NodeLedger {
  ledger_hash: string;
  ledger_index: number;
  parent_hash: string;
  /** Drops, exact. */
  total_coins: string;
  /** Unix seconds. */
  close_time: number;
  /** Unix seconds. */
  parent_close_time: number;
  close_time_resolution: number;
  close_flags: number;
  account_hash: string;
  transaction_hash: string;
  /** With `transactions` or `expand`: the hashes, or (with `expand`) the transactions in full, dated by the ledger. */
  transactions?: string[] | NodeTx[];
}

/** The fields of an account's `AccountRoot` ledger entry that the explorer shows. Optional ones are left out when unset. */
export interface AccountRoot {
  LedgerEntryType: "AccountRoot";
  Account: string;
  /** Drops. */
  Balance: string;
  Flags: number;
  OwnerCount: number;
  Sequence: number;
  PreviousTxnID: string;
  PreviousTxnLgrSeq: number;
  /** Hex of the ASCII domain. */
  Domain?: string;
  RegularKey?: string;
  EmailHash?: string;
  MessageKey?: string;
  TickSize?: number;
  TransferRate?: number;
  AccountTxnID?: string;
  TicketCount?: number;
  NFTokenMinter?: string;
  MintedNFTokens?: number;
  BurnedNFTokens?: number;
  FirstNFTokenSequence?: number;
  /** Xahau. */
  AccountIndex?: number;
  index?: string;
}

/** `account_info` on the newest validated ledger. */
export interface AccountInfo {
  account_data: AccountRoot;
  ledger_index: number;
  validated: boolean;
}

/** A ledger entry owned by an account (an escrow, check, payment channel, NFT page, ticket, ...). */
export interface LedgerObject {
  LedgerEntryType: string;
  /** The entry's key in the ledger. */
  index?: string;
  [field: string]: unknown;
}

/** `account_objects` on the newest validated ledger: a page of the account's entries. */
export interface AccountObjects {
  account: string;
  account_objects: LedgerObject[];
  ledger_index: number;
  validated: boolean;
  limit?: number;
  /** Pass back as `marker` for the next page; absent on the last page. */
  marker?: string;
}

/** A ledger as `server_state` reports it. */
export interface ServerStateLedger {
  /** Drops. */
  base_fee: number;
  /** Unix seconds. */
  close_time: number;
  hash: string;
  /** Drops: the reserve every account must hold. */
  reserve_base: number;
  /** Drops: the reserve added for each object an account owns. */
  reserve_inc: number;
  seq: number;
}

/** The `state` of `server_state`. */
export interface ServerState {
  build_version: string;
  complete_ledgers: string;
  server_state: string;
  /** Absent on a node that has not validated a ledger yet. */
  validated_ledger?: ServerStateLedger;
  closed_ledger?: ServerStateLedger;
}

export interface NodeRpc {
  /** A transaction by hash. Only a transaction in a validated ledger is returned; any other is `not_found`. */
  tx(hash: string): Promise<NodeTx>;
  /**
   * A validated ledger by index or by hash (any other ledger is `not_found`). `transactions` adds their hashes;
   * `expand` adds them in full.
   */
  ledger(id: string, opts?: { transactions?: boolean; expand?: boolean }): Promise<NodeLedger>;
  /** An account's root on the newest validated ledger. `not_found` for an address that has no account. */
  accountInfo(address: string): Promise<AccountInfo>;
  /** A page of the entries an account owns, on the newest validated ledger. */
  accountObjects(address: string, opts?: { limit?: number; marker?: string }): Promise<AccountObjects>;
  /** The node's state: the reserves in force (`validated_ledger.reserve_base` and `reserve_inc`) among it. */
  serverState(): Promise<ServerState>;
}

// ---- Reading the node's answers ------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function malformed(what: string, detail: string): UpstreamError {
  return new UpstreamError("server", `${what} answered something unexpected: ${detail}`, { status: 200 });
}

function objectField(what: string, from: Json, key: string): Json {
  const value = from[key];
  if (!isObject(value)) throw malformed(what, `no "${key}" object`);
  return value;
}
function textField(what: string, from: Json, key: string): string {
  const value = from[key];
  if (typeof value !== "string") throw malformed(what, `no "${key}" text`);
  return value;
}
function numberField(what: string, from: Json, key: string): number {
  const value = from[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw malformed(what, `no "${key}" number`);
  return value;
}
/** A time of the node, which counts from the Ripple epoch, as unix seconds. */
function timeField(what: string, from: Json, key: string): number {
  return numberField(what, from, key) + RIPPLE_EPOCH_OFFSET;
}

/** `validated` must be `true`: the explorer shows validated history only. */
function requireValidated(what: string, result: Json): void {
  if (result.validated !== true) {
    throw new UpstreamError("not_found", `${what}: not in a validated ledger`, { status: 200 });
  }
}

/** Error codes of a request the node finds malformed. */
const MALFORMED_REQUEST = [
  "invalidParams",
  "actMalformed",
  "malformedAddress",
  "malformedRequest",
  "lgrIdxMalformed",
  "lgrIdxsInvalid",
];

/** The `result` of a failed call as an UpstreamError. */
function errorOf(what: string, result: Json): UpstreamError {
  const code = typeof result.error === "string" ? result.error : "unknown";
  const message = typeof result.error_message === "string" && result.error_message ? ` (${clip(result.error_message)})` : "";
  const text = `${what} failed with ${code}${message}`;

  if (code === "actNotFound" || code === "txnNotFound" || code === "lgrNotFound") {
    return new UpstreamError("not_found", text, { status: 200 });
  }
  if (MALFORMED_REQUEST.includes(code)) return new UpstreamError("bad_request", text, { status: 200 });
  if (code === "slowDown") return new UpstreamError("rate_limited", text, { status: 200 });
  return new UpstreamError("server", text, { status: 200 });
}

/** A transaction as the `tx` command and a ledger's expanded list both give it, once the pieces are taken out. */
function nodeTx(what: string, whole: Json, meta: unknown, ledgerIndex: number, date: number): NodeTx {
  if (!isObject(meta)) throw malformed(what, "a transaction without metadata");
  const tx = whole as TxJson;
  return { hash: textField(what, whole, "hash"), ledger_index: ledgerIndex, date, tx, meta: meta as TxMeta };
}

function toTx(what: string, result: Json): NodeTx {
  requireValidated(what, result);
  // The wrapper the node puts around the transaction's own fields.
  const { meta, validated, status, date, inLedger, ledger_index, ledger_hash, ctid, close_time_iso, ...tx } = result;
  const found = nodeTx(what, tx, meta, numberField(what, result, "ledger_index"), timeField(what, result, "date"));
  return typeof ledger_hash === "string" ? { ...found, ledger_hash } : found;
}

function toLedger(what: string, result: Json): NodeLedger {
  requireValidated(what, result);
  const header = objectField(what, result, "ledger");

  const index = Number(textField(what, header, "ledger_index"));
  if (!Number.isSafeInteger(index)) throw malformed(what, "a ledger_index that is not a number");
  const closeTime = timeField(what, header, "close_time");

  const ledger: NodeLedger = {
    ledger_hash: textField(what, header, "ledger_hash"),
    ledger_index: index,
    parent_hash: textField(what, header, "parent_hash"),
    total_coins: textField(what, header, "total_coins"),
    close_time: closeTime,
    parent_close_time: timeField(what, header, "parent_close_time"),
    close_time_resolution: numberField(what, header, "close_time_resolution"),
    close_flags: numberField(what, header, "close_flags"),
    account_hash: textField(what, header, "account_hash"),
    transaction_hash: textField(what, header, "transaction_hash"),
  };

  const transactions = header.transactions;
  if (Array.isArray(transactions)) {
    ledger.transactions = transactions.map((entry: unknown) => {
      if (typeof entry === "string") return entry;
      if (!isObject(entry)) throw malformed(what, "a transaction that is neither a hash nor an object");
      // A ledger's transactions carry their metadata as `metaData`; they have no date of their own.
      const { metaData, meta, ...tx } = entry;
      return nodeTx(what, tx, metaData ?? meta, index, closeTime);
    }) as string[] | NodeTx[];
  }
  return ledger;
}

function toAccountInfo(what: string, result: Json): AccountInfo {
  return {
    account_data: objectField(what, result, "account_data") as unknown as AccountRoot,
    ledger_index: numberField(what, result, "ledger_index"),
    validated: result.validated === true,
  };
}

function toAccountObjects(what: string, result: Json): AccountObjects {
  const objects = result.account_objects;
  if (!Array.isArray(objects)) throw malformed(what, 'no "account_objects" list');
  const page: AccountObjects = {
    account: textField(what, result, "account"),
    account_objects: objects as LedgerObject[],
    ledger_index: numberField(what, result, "ledger_index"),
    validated: result.validated === true,
  };
  if (typeof result.limit === "number") page.limit = result.limit;
  if (typeof result.marker === "string") page.marker = result.marker;
  return page;
}

function toServerState(what: string, result: Json): ServerState {
  const state = objectField(what, result, "state");
  const converted: Json = { ...state };
  for (const key of ["validated_ledger", "closed_ledger"] as const) {
    if (state[key] === undefined) continue;
    const ledger = objectField(what, state, key);
    numberField(what, ledger, "reserve_base");
    numberField(what, ledger, "reserve_inc");
    converted[key] = { ...ledger, close_time: timeField(what, ledger, "close_time") };
  }
  return converted as unknown as ServerState;
}

/** The node's selector for a ledger given as an index or a hash. */
function ledgerSelector(id: string): { ledger_hash: string } | { ledger_index: number } {
  if (/^[0-9A-Fa-f]{64}$/.test(id)) return { ledger_hash: id };
  if (/^\d+$/.test(id) && Number.isSafeInteger(Number(id))) return { ledger_index: Number(id) };
  throw new UpstreamError("bad_request", `${JSON.stringify(id)} is neither a ledger index nor a ledger hash`);
}

// ---- The client ---------------------------------------------------------------------------------------------------

export function createNodeRpc(net: Network, cache: SubrequestCache): NodeRpc {
  /** Posts one command and returns the node's `result` of a success; a failure throws. */
  function post(method: string, body: string): Promise<Json> {
    const what = `node ${method}`;
    return withDeadline(NODE_TIMEOUT_MS, what, async (signal) => {
      const response = await fetch(net.nodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        signal,
      });

      if (!response.ok) {
        void response.body?.cancel();
        throw new UpstreamError(response.status === 429 ? "rate_limited" : "server", `${what} answered ${response.status}`, {
          status: response.status,
          retryAfter: retryAfterOf(response.headers),
        });
      }

      let answer: unknown;
      try {
        answer = await response.json();
      } catch (cause) {
        throw new UpstreamError("server", `${what} answered something that is not JSON`, { status: response.status, cause });
      }
      const result = isObject(answer) ? answer.result : undefined;
      if (!isObject(result)) throw malformed(what, 'no "result"');
      if (result.status === "error") throw errorOf(what, result);
      return result;
    });
  }

  /** One cached command; what `read` makes of its `result` is what is returned and cached. */
  async function call<T>(
    method: string,
    params: Json,
    cls: CacheClass,
    read: (what: string, result: Json) => T,
    ttlOverride?: number,
  ): Promise<T> {
    const body = JSON.stringify({ method, params: [params] });
    return cache.json(
      `POST ${net.nodeUrl} ${body}`,
      cls,
      async () => read(`node ${method}`, await post(method, body)),
      ttlOverride,
    );
  }

  return {
    // A node answers about the ledgers it is validating, so what it says may still change (a transaction is not
    // found, then is): 5 s, like the rest of what is live, and never "immutable".
    tx: (hash) => call("tx", { transaction: hash }, "live", toTx),
    ledger: async (id, opts) =>
      call(
        "ledger",
        {
          ...ledgerSelector(id),
          ...((opts?.transactions || opts?.expand) && { transactions: true }),
          ...(opts?.expand && { expand: true }),
        },
        "live",
        toLedger,
      ),
    accountInfo: (address) => call("account_info", { account: address, ledger_index: "validated" }, "live", toAccountInfo),
    accountObjects: (address, opts) =>
      call(
        "account_objects",
        { account: address, ledger_index: "validated", limit: opts?.limit, marker: opts?.marker },
        "live",
        toAccountObjects,
      ),
    // The reserves change by a vote, rarely: 5 minutes.
    serverState: () => call("server_state", {}, "slow", toServerState, 300),
  };
}
