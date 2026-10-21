// The shapes of the GateHub Data API's answers, written by hand from its reference
// (data-api-new/docs/api-reference.md): the generated api/openapi.yaml lists parameters but no response schemas.
// Key names and types are the reference's; where it says "omitted when there is none", the field is optional.
//
// Times: the API sends unix seconds as a number only for a ledger's `close_time` and `parent_close_time`;
// everywhere else a time is an ISO 8601 string in UTC. Amounts are exact decimal strings in whole units of the
// currency (the native currency included), never numbers. Types only: nothing here runs.

import type { AmendmentStatus } from "../domain/amendments-params";
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
 * or `false`. `amm_share` is decimal text from 0 to 1 (D2b.1 writes 4 decimals, `"0.3400"`: the AMM part of the pair's base volume), `amm_pool` whether the
 * pair has a pool. On Xahau they are `"0.0000"` and `false`. `checkMarkets` deletes either when it is not that, so that it reads as not known.
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
  /** Known only like `MarketRow.amm_share`, and the same decimal text: the AMM part of the native volume. */
  amm_share?: string;
}

/**
 * `GET /v2/network/markets` (`period`, `limit`, `amm`): the trade statistics of every pair that traded in a live period, in one call. The shape is that of
 * the data API's `docs/api-reference.md` at data-api-new `feat/explorer-data` commit `7d495ab` (the merge of D2; section `GET /v2/network/markets`), with the AMM
 * keys placed as D2 spec 7 and formatted as D2b.1 say (they are not in that reference, which serves no AMM field): `amm` after `period`, `totals.amm_share`
 * after `converted_volume`, `amm_share` and `amm_pool` before `sparkline`. `amm` echoes the filter that was asked for; the client refuses a filtered answer
 * that does not (an API that ignored the filter), and reads no `amm` of an unfiltered one. `exchange` and `exchange_rate` (after `end_time`) answer an `exchange_currency`, which the explorer does not
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

/** A row of `amm_volume`: one per bucket of the historical form, and the one row of a rolling day (`live=day`) of the live form. */
export type AmmVolumeRow = VolumeRow<AmmVolumeComponent>;

// ---- AMM: GET /v2/amm/pools, /v2/amm/pools/{pool}, /v2/amm/pools/{base}/{counter} and /v2/amm/pools/{pool}/{history,swaps,liquidity,governance} ------------

// The reference's rules for these objects (data-api-new `feat/amm-data` at `c3e23026b3405fc2fd27fc897e724df4dfe106f1`, `docs/api-reference.md` "AMM" and
// `apps/api/src/amm/amm-objects.ts`), which the types below follow in the reference's key order:
//   - the pair of a pool is flat (`base_currency`, `base_issuer?`, `counter_currency`, `counter_issuer?`), in the order the pool is stored in, and the native currency has no issuer key;
//   - amounts are exact decimal strings in whole units, BigNumber's `toString()` (so an exponent below 1e-6 and from 1e21 is possible; `value_native` alone is never one);
//   - `trading_fee` and the other fees are numbers in units of 1/100000 (`500` is 0.5%, the ledger's largest is 1000); counts and ledger indexes are numbers, times are
//     `YYYY-MM-DDTHH:mm:ssZ` text;
//   - a key whose value is unknown is left out, `null` is never served, and a fee of 0 is a value.

/** The auction slot of a pool, grouped; left out of the pool when it has none of it. `expiration` is a time. */
export interface AmmAuctionSlot {
  holder?: string;
  price?: string;
  discounted_fee?: number;
  expiration?: string;
}

/**
 * A pool in its current state (`GET /v2/amm/pools`, and `pool` of `GET /v2/amm/pools/{pool}`). `lp_currency` is the 40-hex-digit currency of the LP token the pool issues,
 * `last_ledger` the newest ledger its state has seen, `created_ledger` and `created_by` are left out for a pool whose creation was not ingested, `value_native` (eight
 * significant digits, a plain decimal) for a pool without a rate and for a deleted one.
 */
export interface AmmPool {
  amm_account: string;
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
  reserve_base?: string;
  reserve_counter?: string;
  lp_supply?: string;
  lp_currency?: string;
  trading_fee?: number;
  auction_slot?: AmmAuctionSlot;
  value_native?: string;
  created_ledger?: number;
  created_by?: string;
  last_ledger: number;
  deleted: boolean;
}

/**
 * A UTC day on which a transaction touched the pool, with the stats of the day and the pool's closing state (`GET /v2/amm/pools/{pool}/history?interval=day`; a day without
 * activity has no row). `date` is the start of the day. `volume_*` are the amounts that went into the pool, by side; `fees_*_est` are estimates, left out when a swap into
 * that side had no known fee (not the same as `"0"`, a known zero).
 */
export interface AmmPoolDay {
  amm_account: string;
  date: string;
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
  swap_count: number;
  volume_base: string;
  volume_counter: string;
  fees_base_est?: string;
  fees_counter_est?: string;
  deposit_count: number;
  withdraw_count: number;
  liquidity_in_base: string;
  liquidity_in_counter: string;
  liquidity_out_base: string;
  liquidity_out_counter: string;
  reserve_base?: string;
  reserve_counter?: string;
  lp_supply?: string;
  trading_fee?: number;
  value_native?: string;
}

/** A swap against a pool (`GET /v2/amm/pools/{pool}/swaps`): an exchange of the pool's own pair, with the pool as its `amm_account`. */
export type AmmSwap = PairExchange & { amm_account: string };

/**
 * One creation, deposit, withdrawal, clawback or deletion of a pool (`GET /v2/amm/pools/{pool}/liquidity`), oldest first. The amounts are signed from the pool's side
 * (a withdrawal has negative ones) and on the pool's own `base` and `counter`: the event carries no pair. `account` is the liquidity provider, `initiator` who sent the
 * transaction (a clawback's differ). `mode` is left out for a creation, a deletion, a clawback and a transaction with no mode flag or several.
 */
export interface AmmLiquidityEvent {
  amm_account: string;
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  executed_time: string;
  account: string;
  initiator: string;
  event: "create" | "deposit" | "withdraw" | "clawback" | "delete";
  mode?: string;
  base_amount: string;
  counter_amount: string;
  lp_tokens: string;
}

/** A vote on the trading fee (`GET /v2/amm/pools/{pool}/governance`): the fee the voter asked for, and the pool's fee after the vote. A vote carries nothing of a bid. */
export interface AmmVote {
  amm_account: string;
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  executed_time: string;
  type: "vote";
  account: string;
  fee_voted?: number;
  trading_fee_after?: number;
}

/**
 * A bid for the auction slot (`GET /v2/amm/pools/{pool}/governance`). `price_paid` is the LP tokens the bid burned; `auction_slot` is the slot after the bid, left out when
 * the row holds none of it, with `auth_accounts` always a list. A bid carries nothing of a vote.
 */
export interface AmmBid {
  amm_account: string;
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  executed_time: string;
  type: "bid";
  account: string;
  bid_min?: string;
  bid_max?: string;
  price_paid?: string;
  auction_slot?: { holder?: string; discounted_fee?: number; expiration?: string; auth_accounts: string[] };
}

/** A row of a pool's governance list. */
export type AmmGovernanceRow = AmmVote | AmmBid;

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
// (D2, `feat/explorer-data` 7d495ab; checked by `analytics-shape.ts`.) Amounts are whole units, values are in the native currency, both exact numbers as
// text (bignumber.js's `toString()`: a decimal, in exponent form below 1e-6 and from 1e21); counts are whole numbers; a time is `YYYY-MM-DDTHH:mm:ssZ` and the `date` of a bucket is its start (UTC midnight, a Monday for a week, the 1st
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

// ---- Validators and amendments: GET /v2/network/validators…, GET /v2/network/amendments… -----------------------------------------------------------------

// D1 (data-api-new `feat/explorer-data`, pinned at `7d495ab`; the section "Validators and amendments" of its docs/api-reference.md). Keys are in the order the
// reference lists them (its "Keys of …" lines). A key without a value is **absent**, never `null`: the keys the reference says are absent in some case are
// optional here, and every other key is there. Instants of receipt (`first_seen`, `last_seen`, `fetched`, `checked`, `updated`, `first_datetime`, `last_datetime`)
// are `YYYY-MM-DDTHH:mm:ss.SSSZ`; ledger and wall times (`close_time`, `expiration`, `expected`, `date`, `signing_time`, `since`) are `YYYY-MM-DDTHH:mm:ssZ`; days are
// `YYYY-MM-DD`. Native amounts are whole units as exact decimal text (`"0.00001"`), counts are numbers, `pct` is a number to two decimals, and a `score` is text to four
// decimals. A key is a base58 node public key (`nH…` a master key, `n9…` a signing key); an amendment ID and a transaction hash are 64 hex digits in upper case.

/**
 * One of D1's words that a newer D1 may add to (an amendment's status, a domain check's status, the status of a validator's vote, a history event): the words named, or
 * another text. The shape checks (validators-shape.ts) let any word through, and every reader has a default for a word it does not know: the pages show it as their
 * "Unknown" (or "not verified"), or leave it out, and never refuse the answer for it.
 */
export type OpenWord<Known extends string> = Known | (string & {});

/** One publisher of the trusted UNL (`unl.publishers[]` of the summary). Everything after `status` is there only with a list, or after a failed fetch. */
export interface UnlPublisher {
  /** The URL without its scheme: `vl.ripple.com`. Also what `?publisher=` takes. */
  id: string;
  url: string;
  /** The key the publisher is configured with: 66 hex digits. */
  public_key: string;
  /** `ok`: a current list; `expired`: only an expired list, which is still used; `unavailable`: no list in use. */
  status: "ok" | "expired" | "unavailable";
  sequence?: number;
  /** The list's format version: 1 or 2. */
  version?: number;
  expiration?: string;
  fetched?: string;
  /** The validators on the list. */
  validators?: number;
  seen_24h?: number;
  /** The reason code of the newest fetch, when it failed (whatever the status). */
  last_error?: string;
  last_error_at?: string;
}

/** The next multiple of 256 above the newest ledger, the voting ledger before it, and when it is expected (absent while the mean ledger interval is unknown). */
export interface NextFlagLedger {
  ledger_index: number;
  voting_ledger: number;
  expected?: string;
}

/** The three fees, in whole units of the native currency, exact decimal text. */
export interface NativeFees {
  base_fee: string;
  reserve_base: string;
  reserve_inc: string;
}

/** A software version and how many of the trusted validators (`unl`) and of the validators seen in 24 hours (`all`) run it. */
export interface VersionCount {
  version: string;
  unl: number;
  all: number;
}

/** A validator on the negative UNL: its master key and the ledger it was disabled in. */
export interface NegativeUnlMember {
  validation_public_key: string;
  first_ledger: number;
}

/**
 * `GET /v2/network/validators/summary`: the figures of the Validators board. The newest ledger (`ledger_index`, `close_time`) is missing from a database that has
 * none, and with it `next_flag_ledger`; `fees`, `latest_version`, `agreement_through` and `votes_through_ledger` are missing while nothing gives them. `unl.threshold` is
 * missing while no publisher is known; `quorum.node` is there only when the node reports a quorum above 0.
 */
export interface ValidatorsSummary {
  result: "success";
  ledger_index?: number;
  close_time?: string;
  validators: { seen_24h: number; unl_seen_24h: number; others_seen_24h: number; all: number };
  unl: { trusted: number; threshold?: number; publishers: UnlPublisher[] };
  quorum: { value: number; unl_size: number; negative_unl: number; node?: number };
  negative_unl: NegativeUnlMember[];
  /** There only when a validator is about to be disabled or re-enabled. */
  negative_unl_pending?: { to_disable?: string; to_reenable?: string };
  fees?: NativeFees;
  next_flag_ledger?: NextFlagLedger;
  latest_version?: string;
  versions: VersionCount[];
  /** The validators that reported no version. */
  versions_unknown: { unl: number; all: number };
  agreement_through?: string;
  votes_through_ledger?: number;
  updated: string;
}

/** A window of agreement: `missed` of `total` ledgers. `score` is `(total - missed) / total` as text to four decimals, absent when `total` is 0. `partial` counts the partial validations. */
export interface Agreement {
  missed: number;
  total: number;
  score?: string;
  incomplete: boolean;
  partial: number;
}

/**
 * Whether a validator's domain confirms it. Absent from a row that has no `domain`. `reason` is there for `unverified` only (and `status_code` for its
 * `http_status`), `checked` and `verified` are absent while `pending`, and `accounts` (G1) comes last, only for `verified`, and is absent when the file lists none.
 */
export interface DomainVerification {
  status: OpenWord<"verified" | "unverified" | "pending">;
  reason?: string;
  status_code?: number;
  toml_url: string;
  checked?: string;
  verified?: string;
  accounts?: string[];
}

/** The fees a validator votes for, in whole units, and the voting ledger of the record. */
export interface FeeVote {
  ledger_index: number;
  base_fee: string;
  reserve_base: string;
  reserve_inc: string;
}

/** An amendment a validator votes yes for: its ID, and its name where the amendments know one. */
export interface YesEntry {
  id: string;
  name?: string;
}

/**
 * A validator of the list. A member of the UNL that was never seen has only the keys down to `negative_unl` (with `signing_key` when a manifest names one);
 * `version`, `version_build` and `version_latest` are absent for a validator that reported no version (an unrecognised number has `server_version` only), and
 * `amendment_votes` for one without a vote record.
 */
export interface ValidatorRow {
  /** The master key. */
  validation_public_key: string;
  domain?: string;
  /** The ledger of the newest validation among the last 300, and `partial` whether it was partial. Both are absent when there is none. */
  current_index?: number;
  agreement_1h: Agreement;
  agreement_24h: Agreement;
  partial?: boolean;
  unl: boolean;
  agreement_30d: Agreement;
  signing_key?: string;
  domain_verification?: DomainVerification;
  /** The ids of the publishers whose list in use names the validator, sorted. Empty off the UNL. */
  unl_lists: string[];
  negative_unl: boolean;
  version?: string;
  /** The build after the version (Xahau, when not 0). */
  version_build?: number;
  /** Whether `version` is at least the summary's `latest_version`. */
  version_latest?: boolean;
  /** The number as reported, decimal text. */
  server_version?: string;
  fee_vote?: FeeVote;
  amendment_votes?: { ledger_index: number; yes: YesEntry[] };
  first_seen?: string;
  last_seen?: string;
}

/** `GET /v2/network/validators`: the page, domain-first alphabetical, then by key. `marker` is there only when more follow. */
export interface ValidatorsList {
  result: "success";
  count: number;
  marker?: string;
  validators: ValidatorRow[];
}

/** A validator's vote on an amendment that is still being decided (`voting`, `majority`, or `unknown`, G4). `name` is absent for an amendment nobody has named; `none` is a validator with no vote record. */
export interface ValidatorVote {
  id: string;
  name?: string;
  status: OpenWord<"voting" | "majority" | "unknown">;
  vote: "yes" | "no" | "none";
}

/** One of the 30 days of `daily_agreement`, oldest first: an agreement window and its day. A day with no data has `total` 0 and no `score`. */
export interface DailyAgreement {
  date: string;
  missed: number;
  total: number;
  score?: string;
  incomplete: boolean;
  partial: number;
}

/** The newest manifest of a validator: its sequence, the signing key it names, how many signing keys were seen for the master key, and its domain. */
export interface ValidatorManifest {
  sequence: number;
  signing_key?: string;
  signing_keys_seen: number;
  domain?: string;
}

/**
 * `GET /v2/network/validators/{key}`: the row, with `amendment_votes` always there (`ledger_index` is absent for a validator with no record, and `votes` then holds
 * `none` for every amendment being decided), then the manifest (absent without one) and the agreement of each of the last 30 days (empty while no hour is final).
 */
export interface ValidatorDetail extends Omit<ValidatorRow, "amendment_votes"> {
  amendment_votes: { ledger_index?: number; yes: YesEntry[]; votes: ValidatorVote[] };
  manifest?: ValidatorManifest;
  daily_agreement: DailyAgreement[];
  result: "success";
}

/**
 * One validation of a validator: the sightings of one ledger and hash added up. `validated_hash` is there only when `validated` is `different` (the hash the indexer
 * holds at that index). `signing_key` is that of the earliest sighting.
 */
export interface ValidatorValidation {
  ledger_index: number;
  ledger_hash: string;
  validated: "matches" | "different" | "unknown";
  validated_hash?: string;
  full: boolean;
  signing_key: string;
  signing_time: string;
  first_datetime: string;
  last_datetime: string;
  count: number;
}

/**
 * `GET /v2/network/validators/{key}/validations`: a page of a validator's validations, newest first. `marker` (and a `Link` header) is there only when more follow.
 * (Not `Validation`, which is the validation of a ledger by one validator.)
 */
export interface ValidatorValidationsPage {
  result: "success";
  validation_public_key: string;
  count: number;
  marker?: string;
  validations: ValidatorValidation[];
}

/** The rules of the network: an amendment needs more than `threshold_percent` of the trusted validators, and holds its majority `majority_hold_seconds` before it is enabled. */
export interface AmendmentRules {
  threshold_percent: number;
  majority_hold_seconds: number;
  flag_interval: number;
}

/** The newest stored voting round: `trusted` are the validators of the UNL with a vote record, `threshold` the votes an amendment has to exceed, and `needed` the votes that pass. */
export interface AmendmentRound {
  ledger_index: number;
  date: string;
  unl_size: number;
  trusted: number;
  threshold: number;
  needed: number;
  observed: number;
}

/** What the newest round says of an amendment that is `majority`, `voting` or `unknown`. `pct` is `yes / trusted × 100` to two decimals. */
export interface AmendmentTally {
  ledger_index: number;
  yes: number;
  trusted: number;
  needed: number;
  pct: number;
}

/**
 * An amendment that has a majority. `ledger_index` and `tx_hash` (G5) are those of the newest indexed EnableAmendment that gave it the majority, and are absent
 * when none is indexed (a majority gained before the indexed history, or regained and not indexed yet).
 */
export interface AmendmentMajority {
  since: string;
  ledger_index?: number;
  tx_hash?: string;
  expected_activation: string;
}

/**
 * An enabled amendment: from the indexed EnableAmendment (`source: "ledger"`, with `ledger_index`, `date` as a close time and `tx_hash`), else from the metadata file
 * (`source: "metadata"`, where `ledger_index` and `date`, a day, may each be missing).
 */
export interface AmendmentEnabled {
  ledger_index?: number;
  date?: string;
  tx_hash?: string;
  source: "ledger" | "metadata";
}

/**
 * An amendment of the list. Only `id` and `status` are always there. `name` is absent for an amendment nobody has named; `retired` is `true` or absent; `introduced`,
 * `xls`, `xls_url` (G2, under `https://github.com/XRPLF/XRPL-Standards/`) and `description` are those of the metadata file, absent for an amendment it does not have;
 * `votes` is there for `majority`, `voting` and `unknown` once a round is stored; `majority` for one that has a majority; `enabled` for an enabled one that the index or the metadata file knows of.
 */
export interface AmendmentRow {
  /** 64 hex digits, upper case: the SHA-512Half of the name. */
  id: string;
  name?: string;
  status: OpenWord<AmendmentStatus>;
  retired?: true;
  introduced?: string;
  xls?: string;
  xls_url?: string;
  description?: string;
  node_supported?: boolean;
  votes?: AmendmentTally;
  majority?: AmendmentMajority;
  enabled?: AmendmentEnabled;
}

/** What both amendment routes start with (G3). `ledger_index`, `round` and `next_flag_ledger` are absent from the answer of a database that has no ledger, no round or no head yet. */
export interface AmendmentsEnvelope {
  ledger_index?: number;
  rules: AmendmentRules;
  round?: AmendmentRound;
  next_flag_ledger?: NextFlagLedger;
}

/** `GET /v2/network/amendments`: the envelope, how many amendments there are of each status (all of them, whatever `status` asks for), and the amendments listed, in D1's order. */
export interface AmendmentsList extends AmendmentsEnvelope {
  result: "success";
  counts: Record<AmendmentStatus, number>;
  count: number;
  amendments: AmendmentRow[];
}

/**
 * How a validator votes on an amendment. `none` is a validator of the UNL with no vote record. `last_seen` is absent for a validator that was never seen, and
 * `version_supports` (that version is at least `introduced`) when either version is unknown.
 */
export interface AmendmentVote {
  validation_public_key: string;
  domain?: string;
  vote: "yes" | "no" | "none";
  version?: string;
  version_supports?: boolean;
  last_seen?: string;
}

/** A stored voting round of the last 30 days: the votes the amendment had in it (0 when the round has no tally of it) and whether they carried it. */
export interface AmendmentRoundPoint {
  ledger_index: number;
  flag_ledger: number;
  date: string;
  yes: number;
  trusted: number;
  threshold: number;
  passes: boolean;
}

/** An indexed EnableAmendment transaction of the amendment. */
export interface AmendmentHistoryEvent {
  event: OpenWord<"got_majority" | "lost_majority" | "enabled">;
  ledger_index: number;
  date: string;
  tx_hash: string;
}

/**
 * `GET /v2/network/amendments/{name}`: the envelope of the list, the amendment as the list has it, how the validators vote on it (`unl_votes`: every validator of the newest
 * round's UNL; `other_votes`: the validators seen in 24 hours that have a record and are not on it), its rounds of the last 30 days, oldest first, and its history, oldest first.
 */
export interface AmendmentDetail extends AmendmentsEnvelope, AmendmentRow {
  unl_votes: AmendmentVote[];
  other_votes: AmendmentVote[];
  rounds: AmendmentRoundPoint[];
  history: AmendmentHistoryEvent[];
  result: "success";
}
