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

/**
 * What the home route's loader returns: the page, and the `BUILD_ID` of the Worker that made it (a short git commit, not a secret). An open
 * page compares it with the build it was loaded with: after a deploy, data of a new shape must not be drawn by the old code, so it reloads
 * (`app/ui/home-live.ts`).
 */
export interface HomeLoaderData extends HomePageData {
  build: string;
}

/** An ISO 8601 time of the data API as unix seconds. */
const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/**
 * The ledger the page shows as the latest, whose header the loader asks for: `last_validated`'s, unless the fees list is not up to it.
 * The two are read from different places and can disagree for a moment (the list is computed from the ledger table, which may not have the
 * ledger `last_validated` names yet). The page used to say "—" for that ledger's transactions and fees for a beat, and the next beat had them:
 * the tiles flickered. Now the newest ledger the list has is the latest, so that the page is at most a ledger behind and has no hole. A
 * list that is ahead of `last_validated`, or has no rows, changes nothing.
 */
export function latestLedgerIndex(last: LastValidated, fees: readonly FeeRow[]): number {
  const named = Number(last.ledger_index);
  if (fees.length === 0) return named;
  const newestCounted = Math.max(...fees.map((row) => row.ledger_index));
  return newestCounted < named ? newestCounted : named;
}

/**
 * The page's data. Everything about the latest ledger (its index, hash, close time, supply, and the fees row that counts it) is that of
 * `ledger`, whose index `latestLedgerIndex` chose, so the tiles and the hero always say the same ledger.
 */
export function homePage(input: {
  network: Pick<Network, "id" | "ctidNetworkId" | "native">;
  ledger: Ledger;
  fees: readonly FeeRow[];
  transactions: readonly TxObject[];
}): HomePageData {
  const { network, ledger, fees, transactions } = input;
  const index = Number(ledger.ledger_index);

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
      hash: ledger.ledger_hash,
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
