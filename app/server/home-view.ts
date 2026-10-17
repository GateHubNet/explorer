// What the home page shows, worked out in the Worker from four data API answers (spec 3): the newest ledger, the newest
// ledgers with their transaction counts and fees, and the newest transactions. No I/O.

import { encodeCtid } from "../domain/ctid";
import { headlineAmount, type FlowAmount } from "../domain/describe";
import { dropsToNative, formatAmount, shortAddress, shortHash } from "../domain/format";
import { resultText } from "../domain/results";
import type { FeeRow, LastValidated, Ledger, TxObject } from "./api-types";
import type { Network } from "./networks";

export interface HomeLedgerRow {
  index: number;
  txCount: number;
  /** Unix seconds. */
  closeTime: number;
}

export interface HomeTxRow {
  type: string;
  hash: string;
  account: string;
  /** `headlineAmount`: what the transaction moved or offered, when it has one. */
  amount: FlowAmount | null;
  ok: boolean;
  code: string;
  /** Unix seconds: when its ledger closed. */
  date: number;
}

/** A search the hero suggests: made of what is on the page, and leading straight to the page it finds. */
export interface HomeExample {
  kind: "Ledger" | "Account" | "Transaction" | "CTID";
  /** Shortened for the chip. */
  label: string;
  /** The whole value, for the hover text. */
  title: string;
  href: string;
}

export interface HomePageData {
  latest: {
    index: number;
    hash: string;
    /** Unix seconds. */
    closeTime: number;
    /** The total supply in whole units of the native currency. */
    supply: string;
  };
  /** Transactions in the newest ledger, when `/v2/network/fees` has counted it. */
  txCount: number | null;
  /** The mean number of transactions of the ledgers listed, rounded. */
  average: { transactions: number; ledgers: number } | null;
  /** What the newest ledger's transactions paid, whole units of the native currency (JSON numbers as text). */
  fees: { total: string; average: string; max: string } | null;
  ledgers: HomeLedgerRow[];
  transactions: HomeTxRow[];
  examples: HomeExample[];
}

/** An ISO 8601 time of the data API as unix seconds. */
const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export function homePage(input: {
  network: Pick<Network, "id" | "ctidNetworkId" | "native">;
  last: LastValidated;
  ledger: Ledger;
  fees: readonly FeeRow[];
  transactions: readonly TxObject[];
}): HomePageData {
  const { network, last, ledger, fees, transactions } = input;
  const index = Number(last.ledger_index);

  const counted = fees.find((row) => row.ledger_index === index);
  const rows: HomeTxRow[] = transactions.map(({ hash, tx, meta, date }) => ({
    type: tx.TransactionType,
    hash,
    account: tx.Account,
    amount: headlineAmount(tx, meta, network.native) ?? null,
    ok: resultText(meta.TransactionResult).ok,
    code: meta.TransactionResult,
    date: seconds(date),
  }));

  const examples: HomeExample[] = [
    { kind: "Ledger", label: formatAmount(String(index)), title: String(index), href: `/${network.id}/ledger/${index}` },
  ];
  const newest = transactions[0];
  if (newest) {
    examples.push(
      {
        kind: "Account",
        label: shortAddress(newest.tx.Account),
        title: newest.tx.Account,
        href: `/${network.id}/account/${newest.tx.Account}`,
      },
      { kind: "Transaction", label: shortHash(newest.hash), title: newest.hash, href: `/${network.id}/tx/${newest.hash}` },
    );
    try {
      const ctid = encodeCtid(newest.ledger_index, newest.meta.TransactionIndex, network.ctidNetworkId);
      examples.push({ kind: "CTID", label: `${ctid.slice(0, 9)}…`, title: ctid, href: `/${network.id}/tx/${ctid}` });
    } catch {
      // A position that does not fit a CTID: no example of one.
    }
  }

  return {
    latest: {
      index,
      hash: last.ledger_hash,
      closeTime: ledger.close_time,
      supply: dropsToNative(ledger.total_coins),
    },
    txCount: counted?.tx_count ?? null,
    average:
      fees.length === 0
        ? null
        : {
            transactions: Math.round(fees.reduce((sum, row) => sum + row.tx_count, 0) / fees.length),
            ledgers: fees.length,
          },
    fees: counted ? { total: String(counted.total), average: String(counted.avg), max: String(counted.max) } : null,
    ledgers: fees.map((row) => ({ index: row.ledger_index, txCount: row.tx_count, closeTime: seconds(row.date) })),
    transactions: rows,
    examples,
  };
}
