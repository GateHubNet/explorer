// What the ledger page shows, worked out in the Worker from a ledger and its transactions (spec 3): the header, the counts
// by type and by result, the fees, the accounts created and one row per transaction with its summary. The page gets this
// and never the transactions' JSON, so the code that reads metadata stays out of the browser bundle. No I/O.

import { describe, rowSentence, type Segment } from "../domain/describe";
import { dropsToNative } from "../domain/format";
import { accountsCreated } from "../domain/parse";
import type { Native, TxJson, TxMeta } from "../domain/parse/types";
import type { LedgerExpanded } from "./api-types";
import type { NodeLedger, NodeTx } from "./node-rpc";

/** A ledger as the page needs it, whichever of the data API and the node it came from. */
export interface LedgerSource {
  /** Where it came from: the index (the data API) or, when that has not got it yet, the network's own node. */
  origin: "index" | "node";
  index: number;
  hash: string;
  parentHash: string;
  /** Drops. */
  totalCoins: string;
  /** Unix seconds. */
  closeTime: number;
  /** Seconds. */
  resolution: number;
  accountHash: string;
  transactionHash: string;
  transactions: ReadonlyArray<{ hash: string; tx: TxJson; meta: TxMeta }>;
  /** The header as the source served it, for the "Raw ledger header" block. */
  raw: Record<string, unknown>;
}

/** The data API's `/v2/ledgers/{id}?expand=true`. */
export function sourceFromIndex(ledger: LedgerExpanded): LedgerSource {
  const hash = ledger.ledger_hash ?? ledger.hash;
  return {
    origin: "index",
    index: ledger.ledger_index,
    hash,
    parentHash: ledger.parent_hash,
    totalCoins: ledger.total_coins,
    closeTime: ledger.close_time,
    resolution: Number(ledger.close_time_resolution),
    accountHash: ledger.account_hash,
    transactionHash: ledger.transaction_hash,
    transactions: ledger.transactions,
    raw: {
      ledger_hash: hash,
      ledger_index: ledger.ledger_index,
      parent_hash: ledger.parent_hash,
      total_coins: ledger.total_coins,
      close_time: ledger.close_time,
      close_time_human: ledger.close_time_human,
      close_time_resolution: ledger.close_time_resolution,
      close_flags: ledger.close_flags,
      account_hash: ledger.account_hash,
      transaction_hash: ledger.transaction_hash,
    },
  };
}

/** The node's `ledger` with `expand`: a validated ledger, its times already in unix seconds. */
export function sourceFromNode(ledger: NodeLedger): LedgerSource {
  const transactions = (ledger.transactions ?? []).filter((entry): entry is NodeTx => typeof entry !== "string");
  return {
    origin: "node",
    index: ledger.ledger_index,
    hash: ledger.ledger_hash,
    parentHash: ledger.parent_hash,
    totalCoins: ledger.total_coins,
    closeTime: ledger.close_time,
    resolution: ledger.close_time_resolution,
    accountHash: ledger.account_hash,
    transactionHash: ledger.transaction_hash,
    transactions,
    raw: {
      ledger_hash: ledger.ledger_hash,
      ledger_index: ledger.ledger_index,
      parent_hash: ledger.parent_hash,
      total_coins: ledger.total_coins,
      close_time: ledger.close_time,
      close_time_resolution: ledger.close_time_resolution,
      close_flags: ledger.close_flags,
      account_hash: ledger.account_hash,
      transaction_hash: ledger.transaction_hash,
    },
  };
}

/** One row of the ledger's transaction list. */
export interface LedgerRow {
  /** Its position in the ledger (`TransactionIndex`). */
  index: number;
  type: string;
  hash: string;
  account: string;
  /** `rowSentence` of its description: what happened, without the sender and the reason of a failure. */
  what: Segment[];
  /** Whether it succeeded, and its result code. */
  ok: boolean;
  code: string;
  /** What it paid in fees: whole units of the native currency, a plain decimal. */
  fee: string;
}

export interface LedgerPageData {
  origin: LedgerSource["origin"];
  header: {
    index: number;
    hash: string;
    parentHash: string;
    /** Unix seconds. */
    closeTime: number;
    resolution: number;
    /** The total supply in whole units of the native currency. */
    supply: string;
    accountHash: string;
    transactionHash: string;
  };
  /** Whether a later ledger is validated (the next button leads somewhere). */
  hasNext: boolean;
  txCount: number;
  succeeded: number;
  /** The result codes of the failures, with how many each, the commonest first. */
  failures: Array<{ code: string; count: number }>;
  /** The transaction types, with how many each, the commonest first. */
  types: Array<{ type: string; count: number }>;
  /** The accounts the ledger's transactions created, each once, in ledger order. */
  accountsCreated: string[];
  /** What the transactions paid in fees, whole units of the native currency; `null` for a ledger with no transactions. */
  fees: { total: string; min: string; max: string } | null;
  /** In ledger order. */
  rows: LedgerRow[];
  /** The header as JSON text. */
  raw: string;
}

const DROPS = /^\d+$/;

/** Most first, ties by name. */
function ranked<K extends string>(counts: Map<string, number>, key: K): Array<{ [P in K]: string } & { count: number }> {
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, count]) => ({ [key]: name, count }) as { [P in K]: string } & { count: number });
}

export function ledgerPage(source: LedgerSource, opts: { native: Native; hasNext: boolean }): LedgerPageData {
  const transactions = [...source.transactions].sort((a, b) => a.meta.TransactionIndex - b.meta.TransactionIndex);

  const types = new Map<string, number>();
  const failures = new Map<string, number>();
  const created = new Set<string>();
  let succeeded = 0;
  let total = 0n;
  let min: bigint | undefined;
  let max: bigint | undefined;

  const rows: LedgerRow[] = transactions.map(({ hash, tx, meta }) => {
    const description = describe(tx, meta, { native: opts.native });
    types.set(tx.TransactionType, (types.get(tx.TransactionType) ?? 0) + 1);
    if (description.ok) succeeded += 1;
    else failures.set(description.result.code, (failures.get(description.result.code) ?? 0) + 1);
    for (const account of accountsCreated(meta)) created.add(account);

    if (DROPS.test(tx.Fee)) {
      const drops = BigInt(tx.Fee);
      total += drops;
      if (min === undefined || drops < min) min = drops;
      if (max === undefined || drops > max) max = drops;
    }

    return {
      index: meta.TransactionIndex,
      type: tx.TransactionType,
      hash,
      account: tx.Account,
      what: rowSentence(description),
      ok: description.ok,
      code: description.result.code,
      fee: dropsToNative(tx.Fee),
    };
  });

  return {
    origin: source.origin,
    header: {
      index: source.index,
      hash: source.hash,
      parentHash: source.parentHash,
      closeTime: source.closeTime,
      resolution: source.resolution,
      supply: dropsToNative(source.totalCoins),
      accountHash: source.accountHash,
      transactionHash: source.transactionHash,
    },
    hasNext: opts.hasNext,
    txCount: rows.length,
    succeeded,
    failures: ranked(failures, "code"),
    types: ranked(types, "type"),
    accountsCreated: [...created],
    fees:
      min === undefined || max === undefined
        ? null
        : { total: dropsToNative(String(total)), min: dropsToNative(String(min)), max: dropsToNative(String(max)) },
    rows,
    raw: JSON.stringify(source.raw, null, 2),
  };
}
