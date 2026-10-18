// The shapes of the GateHub Data API's answers, written by hand from its reference
// (data-api-new/docs/api-reference.md): the generated api/openapi.yaml lists parameters but no response schemas.
// Key names and types are the reference's; where it says "omitted when there is none", the field is optional.
//
// Times: the API sends unix seconds as a number only for a ledger's `close_time` and `parent_close_time`;
// everywhere else a time is an ISO 8601 string in UTC. Amounts are exact decimal strings in whole units of the
// currency (the native currency included), never numbers. Types only: nothing here runs.

import type { TxJson, TxMeta } from "../domain/parse/types";

// ---- Ledgers: GET /v2/ledgers/{ledger_param}, GET /v2/last_validated ----------------------------------------------

/**
 * A validated ledger (`ledger` of `/v2/ledgers/{ledger_param}`). Everything is text except `ledger_index`,
 * `close_time` and `parent_close_time`. The last five fields are the raw ledger's leftovers, kept for clients of the
 * original Ripple API; `accepted` and `closed` are the text `"true"`.
 *
 * `transactions` is there when asked for: transaction hashes with `transactions=true`, transaction objects with
 * `expand=true` (`DataApi.ledger` narrows it by the options it is given). The API itself leaves the key out of an
 * empty ledger fetched with `expand=true` alone, so the client sends `transactions=true` with it and makes sure the
 * list is there (`[]` when empty).
 */
export interface Ledger {
  ledger_hash: string;
  ledger_index: number;
  parent_hash: string;
  /** Drops, exact. */
  total_coins: string;
  /** Unix seconds. */
  close_time: number;
  /** `YYYY-MMM-DD HH:mm:ss`, UTC. */
  close_time_human: string;
  close_time_resolution: string;
  close_flags: string;
  /** Unix seconds; left out for a ledger that has none. */
  parent_close_time?: number;
  account_hash: string;
  transaction_hash: string;
  hash: string;
  seqNum: string;
  totalCoins: string;
  accepted: string;
  closed: string;
  transactions?: string[] | TxObject[];
}

/** A ledger fetched with `transactions=true`: the hashes of its transactions; `[]` for an empty ledger. */
export interface LedgerWithHashes extends Ledger {
  transactions: string[];
}

/** A ledger fetched with `expand=true`: its transactions in full, without `ledger_hash`; `[]` for an empty ledger. */
export interface LedgerExpanded extends Ledger {
  transactions: TxObject[];
}

/** `GET /v2/last_validated`: the newest ledger the API has committed. */
export interface LastValidated {
  result: "success";
  /** A string, as the original served it. */
  ledger_index: string;
  ledger_hash: string;
  parent_hash: string;
  /** `YYYY-MM-DDTHH:mm:ssZ`. */
  close_time: string;
}

// ---- Transactions: GET /v2/transactions[/{tx_hash}], GET /v2/accounts/{address}/transactions -----------------------

/**
 * A transaction as the API serves it: `{hash, ledger_index, date, ledger_hash?, tx, meta}`. `ledger_hash` is
 * there on `/v2/transactions` and not in the transactions of a ledger, a single transaction or an account's list.
 * `meta.delivered_amount` is added to every successful `Payment`.
 */
export interface TxObject {
  hash: string;
  ledger_index: number;
  /** `YYYY-MM-DDTHH:mm:ss+00:00`. */
  date: string;
  ledger_hash?: string;
  tx: TxJson;
  meta: TxMeta;
}

/**
 * A transaction as `GET /v2/transactions/{hash}?binary=true` serves it: the same head, and `tx` and `meta` as the upper-case hex
 * of their serialization (the blob of `tx` is the one the transaction's hash is taken over).
 */
export interface TxBinary {
  hash: string;
  ledger_index: number;
  /** `YYYY-MM-DDTHH:mm:ss+00:00`. */
  date: string;
  tx: string;
  meta: string;
}

/**
 * A list answer: `{ result, count, marker?, <rows> }`. `K` is the key the rows come under (`transactions`,
 * `payments`, `exchanges`, `rows`). `marker` is there when there is a next page; pass it back as `marker` (it is
 * opaque, and works only for the endpoint and sort direction it came from).
 */
export type Page<K extends string, T> = { result: "success"; count: number; marker?: string } & Record<K, T[]>;

// ---- Accounts: GET /v2/accounts/{address}[/balances|/orders|/payments|/exchanges] ----------------------------------

/**
 * `account_data` of `GET /v2/accounts/{address}`: how the account was created (its latest creation, if it was
 * deleted and funded again).
 */
export interface AccountData {
  account: string;
  /** The sender of the transaction that created the account. */
  parent: string;
  /** The balance it was created with, whole units of the native currency. */
  initial_balance: string;
  /** `YYYY-MM-DDTHH:mm:ssZ`, the close time of the ledger that created it. */
  inception: string;
  ledger_index: number;
  tx_hash: string;
  /** Only on an account of the genesis ledger, once a history import has loaded it. */
  genesis_balance?: string;
  genesis_index?: number;
}

/** A balance of an account: the native one comes first and has no `counterparty` (the issuer of a trust line). */
export interface Balance {
  currency: string;
  counterparty?: string;
  value: string;
}

/**
 * `GET /v2/accounts/{address}/balances`: read from the live node, on the ledger named by `ledger_index`
 * (the newest validated one unless the request chose another). Without a `limit` the API returns at most 200.
 */
export interface BalancesResponse {
  result: "success";
  ledger_index?: number;
  /** `YYYY-MM-DDTHH:mm:ssZ`; only when a `date` chose the ledger. */
  close_time?: string;
  limit?: number;
  balances: Balance[];
}

/** An amount of an order: the native currency has no `counterparty`. */
export interface OrderAmount {
  currency: string;
  value: string;
  counterparty?: string;
}

/** An open offer of an account. A buy gives `totalPrice` for `quantity`; a sell gives up `quantity` for `totalPrice`. */
export interface Order {
  specification: {
    direction: "buy" | "sell";
    quantity: OrderAmount;
    totalPrice: OrderAmount;
  };
  properties: {
    maker: string;
    flags: number;
    sequence: number;
    /** The offer's quality, whole units. */
    makerExchangeRate?: string;
  };
}

/** `GET /v2/accounts/{address}/orders`: the open offers, read from the live node (same envelope as the balances). */
export interface OrdersResponse {
  result: "success";
  ledger_index?: number;
  close_time?: string;
  limit?: number;
  orders: Order[];
}

// ---- Payments: GET /v2/accounts/{address}/payments ----------------------------------------------------------------

/** A balance change of a payment's source or destination; `counterparty` is `""` for the native currency. */
export interface PaymentBalanceChange {
  counterparty: string;
  currency: string;
  value: string;
}

/**
 * A successful payment between two accounts. A field the payment does not have is left out (a tag of `0` is a tag
 * and is there). The source's native balance change leaves the fee out; the fee is `transaction_cost`.
 */
export interface Payment {
  amount: string;
  delivered_amount: string;
  destination_balance_changes: PaymentBalanceChange[];
  max_amount?: string;
  source_balance_changes: PaymentBalanceChange[];
  tx_index: number;
  currency: string;
  destination: string;
  destination_tag?: number;
  /** `YYYY-MM-DDTHH:mm:ssZ`, the close time of the ledger. */
  executed_time: string;
  invoice_id?: string;
  /** Left out for the native currency. */
  issuer?: string;
  ledger_index: number;
  source: string;
  source_currency: string;
  source_tag?: number;
  tx_hash: string;
  /** The fee, whole units of the native currency. */
  transaction_cost: string;
}

// ---- Exchanges: GET /v2/accounts/{address}/exchanges --------------------------------------------------------------

/** A trade (an offer crossing or an AMM swap) an account took part in, with the pair among the other fields. */
export interface AccountExchange {
  base_amount: string;
  counter_amount: string;
  node_index: number;
  /** Counter per base, 8 significant digits. */
  rate: string;
  tx_index: number;
  /** Only on an autobridged trade. */
  autobridged_currency?: string;
  autobridged_issuer?: string;
  base_currency: string;
  /** Left out for the native currency. */
  base_issuer?: string;
  buyer: string;
  /** What the importer recorded as the client of the transaction, when it knew it. */
  client?: string;
  counter_currency: string;
  counter_issuer?: string;
  /** `YYYY-MM-DDTHH:mm:ssZ`, the close time of the ledger. */
  executed_time: string;
  ledger_index: number;
  offer_sequence: number;
  provider: string;
  seller: string;
  taker: string;
  tx_hash: string;
  tx_type: string;
}

// ---- Network: GET /v2/network/fees --------------------------------------------------------------------------------

/**
 * A row of `/v2/network/fees` with `interval=ledger` (the default, and the only one the explorer asks for):
 * the fees paid by the transactions of one ledger. Amounts are JSON numbers, whole units of the native currency.
 * (Rows of `interval=hour` and `day` have no `ledger_index`; they are not modelled.)
 */
export interface FeeRow {
  avg: number;
  max: number;
  min: number;
  total: number;
  tx_count: number;
  /** `YYYY-MM-DDTHH:mm:ssZ`, the close time of the ledger. */
  date: string;
  ledger_index: number;
}
