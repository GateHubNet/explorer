// The shapes of the GateHub Data API's answers, written by hand from its reference
// (data-api-new/docs/api-reference.md): the generated api/openapi.yaml lists parameters but no response schemas.
// Key names and types are the reference's; where it says "omitted when there is none", the field is optional.
//
// Times: the API sends unix seconds as a number only for a ledger's `close_time` and `parent_close_time`;
// everywhere else a time is an ISO 8601 string in UTC. Amounts are exact decimal strings in whole units of the
// currency (the native currency included), never numbers. Types only: nothing here runs.

import type { AnalyticsUnit } from "../domain/analytics-params";
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
 * What `?binary=true` serves for a transaction the API's codec cannot serialize (a type missing from its definitions): the JSON it
 * stored, in the places of the hex (api-reference.md, "Differences from data.ripple.com"). A lasting answer, not an error.
 */
export interface TxStoredJson {
  hash: string;
  ledger_index: number;
  /** `YYYY-MM-DDTHH:mm:ss+00:00`. */
  date: string;
  tx: Record<string, unknown>;
  meta: Record<string, unknown>;
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

// ---- A pair: GET /v2/exchanges/{base}/{counter}, GET /v2/active_accounts/{base}/{counter} ---------------------------------------------------------------

/**
 * The `amm` filter of the exchange lists and the markets table: `exclude` is the order book alone, `only` the swaps against AMM pools alone. The explorer
 * never sends `include` (the API's default), so that its requests are the same before and after the data API merges `feat/amm-data`. Everything about it
 * is read from the data API's `feat/amm-data` branch (`c3e23026b3405fc2fd27fc897e724df4dfe106f1`, `docs/api-reference.md`).
 */
export type AmmFilter = "exclude" | "only";

/**
 * A trade of a pair (an offer crossing or a swap against an AMM pool), as `GET /v2/exchanges/{base}/{counter}` serves it, oldest first unless
 * `descending`: the key order of the original's row, then `amm_account` last. In the orientation of the request (the API inverts a pair that is asked for
 * the other way round than it is stored). `rate` is counter per base, 8 significant digits; a price below 1e-6 or from 1e8 is in exponent form (`1.2000000e-7`). A swap has
 * `amm_account` (the pool, also its `provider`) and an `offer_sequence` of 0. The native currency has no issuer key; the autobridged keys are on an
 * autobridged trade only. Unlike an account's trade (`AccountExchange`) it has no `client`.
 */
export interface PairExchange {
  base_amount: string;
  counter_amount: string;
  node_index: number;
  rate: string;
  tx_index: number;
  autobridged_currency?: string;
  autobridged_issuer?: string;
  buyer: string;
  /** `YYYY-MM-DDTHH:mm:ssZ`, the close time of the ledger. */
  executed_time: string;
  ledger_index: number;
  offer_sequence: number;
  provider: string;
  seller: string;
  taker: string;
  tx_hash: string;
  tx_type: string;
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
  /** The pool, on a swap against an AMM pool (`feat/amm-data`). */
  amm_account?: string;
}

/**
 * A candle of a pair (`interval=`): the buckets that start within the window, whole. Prices are strings of 8 significant digits, volumes exact decimal
 * strings, `count` and `buy_volume` numbers (`buy_volume` is the base bought, a JavaScript number, so it may have a fraction). The pair is the one asked
 * for. A page's marker is the base64url of the start of the bucket of its last candle.
 */
export interface Candle {
  base_volume: string;
  buy_volume: number;
  close: string;
  close_time: string;
  count: number;
  counter_volume: string;
  high: string;
  low: string;
  open: string;
  open_time: string;
  start: string;
  vwap: string;
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
}

/**
 * The one row of `reduce=true`: a summary of the whole window, from `start`. With no trade the row is all zeros (`"0.0000000"` prices, `"0"` volumes) and
 * has no `open_time` and `close_time`. `limit` and `marker` are ignored and there is no marker.
 */
export interface ReducedRow {
  open: string;
  high: string;
  low: string;
  close: string;
  base_volume: string;
  counter_volume: string;
  buy_volume: number;
  count: number;
  open_time?: string;
  close_time?: string;
  vwap: string;
  start: string;
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
}

/** What an account did on one side of a pair in the window. */
export interface ActiveAccountSide {
  base_volume: string;
  counter_volume: string;
  count: number;
}

/** An account that traded the pair, with what it bought and sold of the base and in all. */
export interface ActiveAccount {
  buy: ActiveAccountSide;
  sell: ActiveAccountSide;
  account: string;
  base_volume: string;
  counter_volume: string;
  count: number;
}

/**
 * `GET /v2/active_accounts/{base}/{counter}` (the `1day` period): the accounts that traded the pair, sorted by base volume, the largest first. An account is
 * on the list as a seller and as a buyer of every trade. The client keeps the first `ACTIVE_ACCOUNTS_KEPT` (10) of `accounts` before it caches the answer;
 * `count` (the accounts the API found) and `exchanges_count` are as it served them.
 */
export interface ActiveAccounts {
  result: "success";
  count: number;
  exchanges_count: number;
  accounts: ActiveAccount[];
}

// ---- Markets: GET /v2/network/markets -------------------------------------------------------------------------------------------------------------------

/** A tick of a market's sparkline: the start of a UTC day, and the close of the last trade up to the end of that day (left out for a day with none before it). */
export interface SparklineDay {
  date: string;
  close?: string;
}

/**
 * A row of the markets table: one pair that traded in the window, in the canonical stored orientation (a price is counter per base). Keys in the reference's
 * order. `open`, `high`, `low` and `last` have 8 significant digits (and an exponent below 1e-6 or from 1e8). `native_volume` is left out for a pair without
 * a rate on either side. `change` is `(last / open - 1) * 100`, 2 decimals, and is left out where `open` is not above 0. `converted_volume` is only there
 * with a display currency, which the explorer does not ask for.
 *
 * The AMM keys (D2 spec 7, D2b.1) are there **only when known** (every ledger of the window was parsed with AMM support); an absent key is "not known", never 0
 * or `false`. `amm_share` is a string with exactly 4 decimals (`"0.3400"`: the AMM part of the pair's base volume), `amm_pool` whether the pair has a pool.
 * On Xahau they are `"0.0000"` and `false`.
 */
export interface MarketRow {
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
  count: number;
  base_volume: string;
  counter_volume: string;
  native_volume?: string;
  converted_volume?: string;
  open: string;
  high: string;
  low: string;
  last: string;
  change?: string;
  open_time: string;
  last_time: string;
  amm_share?: string;
  amm_pool?: boolean;
  sparkline: SparklineDay[];
}

/** The totals of a markets answer: `pairs` is the number of listed pairs (those with at least `min_trades` trades), the rest is over every pair that traded. */
export interface MarketsTotals {
  pairs: number;
  pairs_traded: number;
  count: number;
  native_volume: string;
  converted_volume?: string;
  /** Known only like `MarketRow.amm_share`: the AMM part of the native volume, 4 decimals. */
  amm_share?: string;
}

/**
 * `GET /v2/network/markets` (`period`, `limit`, `amm`): the trade statistics of every pair that traded in a live period, in one call. The shape is that of
 * the data API's `docs/api-reference.md` at data-api-new `feat/explorer-data` commit `7d495ab` (the merge of D2; section `GET /v2/network/markets`), with the AMM
 * keys placed as D2 spec 7 and formatted as D2b.1 say (they are not in that reference, which serves no AMM field): `amm` after `period`, `totals.amm_share`
 * after `converted_volume`, `amm_share` and `amm_pool` before `sparkline`. `amm` echoes the filter that was asked for; the client refuses an answer that
 * does not (an API that ignored the filter). `exchange` and `exchange_rate` (after `end_time`) answer an `exchange_currency`, which the explorer does not
 * send. `start_time` (the hour that is a window before `end_time`) and `end_time` (the close time of the newest ledger the set covers) and `totals` are
 * missing when the aggregator has not written a set yet: `{ result, period: "day", count: 0, markets: [] }`. `count` is the number of markets served.
 */
export interface MarketsResponse {
  result: "success";
  period: "day" | "7day" | "30day";
  amm?: "include" | "exclude" | "only";
  start_time?: string;
  end_time?: string;
  exchange?: AssetRef;
  exchange_rate?: string;
  totals?: MarketsTotals;
  count: number;
  markets: MarketRow[];
}

// ---- Network: GET /v2/network/fees --------------------------------------------------------------------------------

/**
 * A row of `/v2/network/fees` with `interval=ledger` (the default): the fees paid by the transactions of one
 * ledger. Amounts are JSON numbers, whole units of the native currency. (Rows of `interval=hour` and `day` are `FeeBucketRow`.)
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

/**
 * A row of `/v2/network/fees` with `interval=hour` or `day`: what the transactions of the hour or day paid, all its ledgers counted. Keys and
 * numbers as in `FeeRow`, without `ledger_index`. A bucket without transactions has `avg` 0.
 */
export interface FeeBucketRow {
  avg: number;
  max: number;
  min: number;
  total: number;
  tx_count: number;
  /** `YYYY-MM-DDTHH:mm:ssZ`, the start of the hour or day. */
  date: string;
}

// ---- Network: GET /v2/network/fee_stats ---------------------------------------------------------------------------

/**
 * A row of `/v2/network/fee_stats`: a snapshot of the node's `fee` command, taken every 5 s by the data API's syncer. Fees are JSON
 * numbers in whole units of the native currency, `pct_max_queue_size` is `current_queue_size / (expected_ledger_size × 20) × 100`.
 */
export interface FeeStatsRow {
  current_ledger_size: number;
  current_queue_size: number;
  /** `YYYY-MM-DDTHH:mm:ssZ`, when the snapshot was taken. */
  date: string;
  expected_ledger_size: number;
  median_fee: number;
  minimum_fee: number;
  open_ledger_fee: number;
  pct_max_queue_size: number;
}

// ---- Stats: GET /v2/stats/{family} --------------------------------------------------------------------------------

/**
 * A flat row of `/v2/stats/{family}` (`type`, `result` or `metric`): the start of the bucket, and a JSON number for each name of the family
 * (`Payment: 3000`, `ledger_count: 24000`). A zero count is left out, so a name can be missing; a bucket with none is not a row. Without a family
 * the API nests the families in a row, which the client never asks for.
 */
export type StatsRow = { date: string } & Record<string, number | string>;

// ---- Network: GET /v2/network/{payment,exchange,amm}_volume ------------------------------------------------------

/** A currency: `issuer` is absent for the native one. */
export interface AssetRef {
  currency: string;
  issuer?: string;
}

/** What one tracked currency was paid in a bucket. `amount` is in the currency, `converted_amount` in the row's `exchange`, `rate` is the units of the currency one native coin buys. */
export interface PaymentVolumeComponent {
  currency: string;
  issuer?: string;
  amount: string;
  count: number;
  rate: string;
  converted_amount: string;
}

/** What one tracked market traded in a bucket. `amount` is the volume of `base`. */
export interface ExchangeVolumeComponent {
  count: number;
  rate: string;
  amount: string;
  base: AssetRef;
  counter: AssetRef;
  converted_amount: string;
}

/** What one AMM pool swapped in a bucket (`feat/amm-data`). `amount` is the volume of `base`. */
export interface AmmVolumeComponent {
  amm_account: string;
  base: AssetRef;
  counter: AssetRef;
  count: number;
  amount: string;
  rate: string;
  converted_amount: string;
}

/**
 * A row of the historical volume routes (`start` or `end` given): one `interval` (`day`, `week` from Monday, UTC). Amounts are decimal strings,
 * `total` and `converted_amount` in `exchange` (the native currency unless asked for another), `count` the number of trades or payments, the
 * components sorted by converted amount, largest first. `end_time` is the start of the next bucket.
 */
export interface VolumeRow<C> {
  components: C[];
  count: number;
  exchange: AssetRef;
  total: string;
  exchange_rate: string;
  start_time: string;
  end_time: string;
}

// ---- Validations: GET /v2/ledgers/{ledger_hash}/validations -------------------------------------------------------

/**
 * A validation of a ledger by one validator. Values are text except `count` (how often a collector saw it); an empty column is absent. The
 * times are `YYYY-MM-DDTHH:mm:ss.SSSZ`, the first and last time a collector saw it.
 */
export interface Validation {
  count: number;
  first_datetime: string;
  flags: string;
  last_datetime: string;
  ledger_hash: string;
  ledger_index: string;
  signing_time: string;
  validation_public_key: string;
  amendments?: string;
  base_fee?: string;
  ephemeral_public_key?: string;
  full?: string;
  load_fee?: string;
  reporter_public_key?: string;
  reserve_base?: string;
  reserve_inc?: string;
  signature?: string;
}

/** `GET /v2/ledgers/{ledger_hash}/validations`: the validations of one ledger, one per validator, sorted by validator key. `marker` is there when there are more. */
export interface LedgerValidations {
  result: "success";
  ledger_hash: string;
  count: number;
  marker?: string;
  validations: Validation[];
}

// ---- Account analytics: GET /v2/accounts/{address}/stats/{family}?interval= and /analytics/{balances,balance_changes,counterparties,exchanges} -----
// (D2, `feat/explorer-data` 7d495ab; checked by `analytics-shape.ts`.) Amounts are whole units, values are in the native currency, both exact decimal
// strings; counts are whole numbers; a time is `YYYY-MM-DDTHH:mm:ssZ` and the `date` of a bucket is its start (UTC midnight, a Monday for a week, the 1st
// for a month). A key without a value is left out, `null` is never served. `start` and `end` are the window widened to whole buckets, `end` exclusive.
// The lists are whole answers or top lists: there is no `marker`.

/** One of the ten kinds of balance change of `balance_changes`; a change of a transaction type the original never classified has none. */
export type ChangeType =
  | "transaction_cost"
  | "payment_destination"
  | "payment_source"
  | "exchange"
  | "intermediary"
  | "escrow_create"
  | "escrow_finish"
  | "escrow_cancel"
  | "paychannel_fund"
  | "paychannel_payout";

/** `stats/value?interval=`: what the account held at the end of the bucket's last day, in the native currency. A row for every bucket from its first balance. */
export interface AccountValueRow {
  date: string;
  account_value: string;
  balance_change_count: number;
}

/** `stats/transactions?interval=`: what the account sent in the bucket (a bucket in which it sent nothing has no row), by result code and by type. */
export interface AccountTxStatsRow {
  date: string;
  transaction_count: number;
  result: Record<string, number>;
  type: Record<string, number>;
}
// `stats/{family}` answers are `Page<"rows", AccountValueRow>` and `Page<"rows", AccountTxStatsRow>`. With `limit=1000` they have no `marker`.

/** A trust line, or the native balance (no `counterparty`), at the end of the window. */
export interface AnalyticsBalanceLine {
  currency: string;
  counterparty?: string;
  /** Negative: what the account owes on the line. */
  balance: string;
}

/** The balance of a line at the end of a bucket. */
export interface AnalyticsBalanceRow {
  date: string;
  currency: string;
  counterparty?: string;
  balance: string;
}

/** `analytics/balances`: the first `limit` lines (the native line first, then by what they are worth) of `lines_total`, and a row for each line and bucket. The answer always carries `interval`. */
export interface AnalyticsBalances {
  result: "success";
  start: string;
  end: string;
  interval: AnalyticsUnit;
  lines_total: number;
  lines: AnalyticsBalanceLine[];
  /** The number of `rows`. */
  count: number;
  rows: AnalyticsBalanceRow[];
}

/** What the changes of a type came to in the window, in native-currency values: `in_value` the positive changes, `out_value` the negative ones as a positive amount. */
export interface BalanceChangeTotal {
  change_type?: string;
  count: number;
  in_value: string;
  out_value: string;
  net_value: string;
}

/** What the changes of a type came to in a bucket (a bucket or type with no change has no row). */
export interface BalanceChangeBucket {
  date: string;
  change_type?: string;
  count: number;
  in_value: string;
  out_value: string;
}

/**
 * `analytics/balance_changes?interval=`. The reference's answer with no `interval` (rows per change type and asset, with `currency`, `issuer`, `in` and
 * `out`) is not modelled: the explorer always asks with one, and the answer then always carries it.
 */
export interface AnalyticsBalanceChanges {
  result: "success";
  start: string;
  end: string;
  interval: AnalyticsUnit;
  totals: BalanceChangeTotal[];
  /** The number of `rows`. */
  count: number;
  rows: BalanceChangeBucket[];
}

/** An account the account paid or was paid by. The values are what the payments were worth; `first` and `last` the times of the first and last payment. */
export interface AnalyticsCounterparty {
  account: string;
  sent_value: string;
  received_value: string;
  total_value: string;
  payments_sent: number;
  payments_received: number;
  first: string;
  last: string;
}

/** `analytics/counterparties`: the first `limit` of `total` counterparties by `sort`, largest first. */
export interface AnalyticsCounterparties {
  result: "success";
  start: string;
  end: string;
  sort: "value" | "count";
  total: number;
  /** The number served. */
  count: number;
  counterparties: AnalyticsCounterparty[];
}

/**
 * A pair the account traded, in the canonical stored order (as `/v2/exchanges` serves a pair). `bought` is the base it received and `sold` the base it gave;
 * `bought_counter` the counter it paid for what it bought, `sold_counter` the counter it received for what it sold. `native_volume` is left out when no day
 * of the pair had a rate.
 */
export interface AnalyticsPair {
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
  count: number;
  base_volume: string;
  counter_volume: string;
  bought: string;
  sold: string;
  bought_counter: string;
  sold_counter: string;
  native_volume?: string;
}

/** `analytics/exchanges`: the first `limit` of `total` pairs, by native volume, largest first. */
export interface AnalyticsExchanges {
  result: "success";
  start: string;
  end: string;
  total: number;
  /** The number served. */
  count: number;
  pairs: AnalyticsPair[];
}
