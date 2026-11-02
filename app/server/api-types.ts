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
 * after `converted_volume`, `amm_share` and `amm_pool` before `sparkline`. `amm` echoes the filter that was asked for, `include` when none was (D2b.1 at
 * data-api-new 9dbbd8a); the client refuses a filtered answer that does not (an API that ignored the filter), and reads no `amm` of an unfiltered one (a D2 API has none). `exchange` and `exchange_rate` (after `end_time`) answer an `exchange_currency`, which the explorer does not
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
  /**
   * Only on the live day row (`live=day`, D2b.3): the trading fees the pool's swaps of the 24 hours are estimated to have paid, converted like `converted_amount` and
   * written like it; left out when a swap's fee is not known. The explorer does not read it.
   */
  fees_est?: string;
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

/**
 * A row of `amm_volume`: one per bucket of the historical form, and the one row of a rolling day (`live=day`) of the live form. `fees_est` (after `end_time`, D2b.3) is
 * on that live day row only, the sum of its components' estimates, and only when it lists a component and every one has one.
 */
export type AmmVolumeRow = VolumeRow<AmmVolumeComponent> & { fees_est?: string };

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

/**
 * A page of `GET /v2/amm/pools/{pool}/history?interval=day`, in the reference's key order. `computed_start` and `computed_end` (`YYYY-MM-DD`, D2b.4) are the days of the
 * request's window that the data API has computed for every pool: a day inside the range without a row is a quiet day of the pool, a day outside it is not computed
 * yet. Both are left out when no day of the window is computed, and are the same on every page of an answer. The explorer does not read them.
 */
export interface AmmPoolDaysPage {
  result: "success";
  computed_start?: string;
  computed_end?: string;
  count: number;
  marker?: string;
  days: AmmPoolDay[];
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
 * What a validator's verified toml says about it (D8 §4.1, `docs/api-reference.md` of the data API at the commit `test/fixtures/PROVENANCE.md` names): each key is absent
 * when the file gives no valid value, and `{}` when it gives none of the four. These are the file's claims, nothing checks them: a `network` naming another network is
 * shown as it is, a country is an upper-case ISO 3166-1 alpha-2 code or `XK`, `network` is lower case (`main`, `testnet`, `21337`) and `unl` an https URL, text and never
 * followed.
 */
export interface ValidatorToml {
  owner_country?: string;
  server_country?: string;
  network?: string;
  unl?: string;
}

/**
 * The detail's `toml` (D8 §4.2): the row's, then its domain's facts from the toml store, which can be a check newer or older than the row's (they are the domain's,
 * not the validator's, so `accounts_listed` can be below the addresses served). `principals` are at most 10 names in file order, `modified` is `YYYY-MM-DDTHH:mm:ssZ`,
 * `currencies` the first 10 entries that count on the network and `fetched` an instant of receipt; each is absent when there is none.
 */
export interface ValidatorTomlDetail extends ValidatorToml {
  principals?: string[];
  modified?: string;
  accounts_listed?: number;
  currencies?: { code: string; issuer?: string }[];
  currencies_listed?: number;
  fetched?: string;
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
  /** Present when the domain is `verified` and was read by D8's checker; `{}` when its `[[VALIDATORS]]` entry gives none of the four. */
  toml?: ValidatorToml;
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
export interface ValidatorDetail extends Omit<ValidatorRow, "amendment_votes" | "toml"> {
  amendment_votes: { ledger_index?: number; yes: YesEntry[]; votes: ValidatorVote[] };
  /** The row's `toml`, then the facts of its domain (D8 §4.2). */
  toml?: ValidatorTomlDetail;
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

// ---- NFTs: GET /v2/nfts/{nft_id}[/history|/offers], GET /v2/accounts/{address}/nfts, GET /v2/nft_collections[/{issuer}[/{taxon}][/nfts|/holders|/sales|/stats]], GET /v2/nft_sales,
// ---- GET /v2/network/nft_volume -------------------------------------------------------------------------------------------------------------------------------------

// D3 (data-api-new `feat/explorer-data-2`, pinned at `da5ce14ccfe9e429aacaf5ab6672eac15ce0d1de`; the sections "NFTs" and "Coverage" of its docs/api-reference.md, and
// `apps/api/src/nft/nft-objects.ts`). Keys are in the reference's order (its "Keys of …" lines); a key it marks `?` is left out of an answer when it has no value, `null` is
// never served, and so those keys are optional here and every other key is there. The answers' own `result: "success"` (the key before `coverage`) is not a part of the types:
// no reader looks at it. The facts the reference states, which the checks (nft-shape.ts) make true:
//   - `kind` is `nftoken` (XRPL) or `uritoken` (Xahau). `taxon`, `serial` and `transfer_fee` are decoded from an XRPL id and are left out for a URIToken;
//   - an NFT id (and an offer id) is 64 hexadecimal digits, upper-case in every answer; amounts are exact decimal strings in whole units, `converted_amount` and every
//     `*_native` value the price in the native currency (at most 6 decimals); times are `YYYY-MM-DDTHH:mm:ssZ`, days `YYYY-MM-DDT00:00:00Z`;
//   - `flags` is the number the ledger holds, `transfer_fee` the number in units of 1/100000 (`5000` is 5%), `uri` hex as on the ledger.

/** The periods of the live `nft_volume` (`?live=`); the other volumes have more. */
export type NftPeriod = "day" | "7day" | "30day";
/** What `GET /v2/nft_collections` sorts by (`?sort=`). */
export type NftSort = "volume" | "supply" | "holders";

/**
 * A collection as a path has it: `/{issuer}/{taxon}` on XRPL, `/{issuer}` on Xahau (where the issuer is the whole collection, so there is no `taxon`). Declared here and
 * re-exported by `app/domain/nft-link.ts` (E8 Task 2), so that the data API client imports nothing of the domain.
 */
export type CollectionKey = { issuer: string; taxon?: number };

/**
 * How much of the ledger history an answer's index holds (D3 "Coverage"): `from_ledger_index` is where the feature's rows start (left out when no ledger is stored at all),
 * and `complete` that nothing before it can be missing. `coverage` is the key after `result` on every NFT answer.
 */
export interface Coverage {
  from_ledger_index?: number;
  complete: boolean;
}

export type NftKind = "nftoken" | "uritoken";

/** The events of an NFT's history. `transfer` is an owner change with no price (a zero-amount accept, a Xahau `Remit`). */
export type NftEventKind = "mint" | "burn" | "modify" | "offer_create" | "offer_cancel" | "offer_removed" | "sale" | "transfer";

/** The place of a fact in the ledger history: `owner_since` of an NFT, `first_mint` and `last_mint` of a collection. */
export interface NftPoint {
  ledger_index: number;
  tx_hash: string;
  executed_time: string;
}

/** The mint of an NFT: `by` the account that sent it (the issuer, or a minter the issuer authorised), `to` the first owner. */
export interface NftMinted extends NftPoint {
  by: string;
  to: string;
}

/** The burn of an NFT, `by` the account that sent it. */
export interface NftBurnedAt extends NftPoint {
  by: string;
}

/** The newest sale of an NFT. `converted_amount` is left out of an NFT in a list (an account's or a collection's), and of a price in an asset that has no rate that day. */
export interface NftLastSale {
  amount: string;
  currency: string;
  amount_issuer?: string;
  converted_amount?: string;
  ledger_index: number;
  tx_hash: string;
  executed_time: string;
}

/**
 * One NFT or URIToken. `owner` is the holder after the newest mint, sale or transfer: left out for a burned NFT and when no indexed event names one (an NFT whose history
 * starts after its mint); `minted` is left out when the mint is not in the index; `uri` is the newest mint's or modify's, `digest` a URIToken's.
 */
export interface Nft {
  nft_id: string;
  kind: NftKind;
  issuer: string;
  taxon?: number;
  serial?: number;
  flags: number;
  transfer_fee?: number;
  owner?: string;
  owner_since?: NftPoint;
  uri?: string;
  digest?: string;
  minted?: NftMinted;
  burned: boolean;
  burned_at?: NftBurnedAt;
  sale_count: number;
  last_sale?: NftLastSale;
}

/**
 * One event of an NFT (`/v2/nfts/{nft_id}/history`). `account` is who did it (for an offer event the offer's owner, else the sender), `from` and `to` the owners before and
 * after, `offer_id` the offer (on Xahau the URIToken id), `expiration` an offer's, `removed_by` why an `offer_removed` happened (`sale`, `burn`, `transfer`, or `other`).
 * `converted_amount` is on sales only; `royalty_est` is an estimate and is left out when no royalty applies.
 */
export interface NftEvent {
  nft_id: string;
  kind: NftKind;
  issuer: string;
  taxon?: number;
  serial?: number;
  ledger_index: number;
  tx_index: number;
  event_index: number;
  tx_hash: string;
  tx_type: string;
  executed_time: string;
  event: NftEventKind;
  account?: string;
  from?: string;
  to?: string;
  offer_id?: string;
  is_sell_offer?: boolean;
  amount?: string;
  currency?: string;
  amount_issuer?: string;
  converted_amount?: string;
  destination?: string;
  expiration?: string;
  broker?: string;
  broker_fee?: string;
  royalty_est?: string;
  removed_by?: OpenWord<"sale" | "burn" | "transfer" | "other">;
  uri?: string;
}

/** One sale (`/v2/nft_sales`, a collection's `/sales`): `mode` is `brokered` when a broker is set (XRPL), `direct` otherwise. */
export interface NftSale {
  nft_id: string;
  kind: NftKind;
  issuer: string;
  taxon?: number;
  serial?: number;
  ledger_index: number;
  tx_index: number;
  event_index: number;
  tx_hash: string;
  executed_time: string;
  seller: string;
  buyer: string;
  mode: "direct" | "brokered";
  amount: string;
  currency: string;
  amount_issuer?: string;
  converted_amount?: string;
  broker?: string;
  broker_fee?: string;
  royalty_est?: string;
}

/** An offer on an NFT that is still open (`/v2/nfts/{nft_id}/offers`), as made by the `offer_create` event. `expiration` is a time. */
export interface NftOffer {
  offer_id: string;
  is_sell_offer: boolean;
  owner: string;
  amount: string;
  currency: string;
  amount_issuer?: string;
  destination?: string;
  expiration?: string;
  created_ledger: number;
  created_tx_hash: string;
  created_time: string;
}

/**
 * A collection in its current state: an issuer and a taxon on XRPL, an issuer alone on Xahau. `supply` is the NFTs not burned, `holders` the accounts holding one,
 * `minted` and `burned` the mints and burns in the index, `volume_native` the converted prices of its sales summed (exact text); `first_mint` and `last_mint` are left
 * out for a collection whose mints all came before the coverage starts, `last_ledger` is the newest ledger that changed one of its NFTs.
 */
export interface NftCollection {
  issuer: string;
  taxon?: number;
  kind: NftKind;
  supply: number;
  holders: number;
  minted: number;
  burned: number;
  sales_count: number;
  volume_native: string;
  first_mint?: NftPoint;
  last_mint?: NftPoint;
  last_ledger: number;
}

/** One UTC day of a collection on which it had a sale, a mint or a burn (`/stats`). The two prices are left out on a day with no sale that has a converted price. */
export interface NftCollectionDay {
  date: string;
  sales_count: number;
  volume_native: string;
  avg_price_native?: string;
  min_price_native?: string;
  mints: number;
  burns: number;
}

/** An account that holds NFTs of a collection, and how many (`/holders`). */
export interface NftHolder {
  owner: string;
  held: number;
}

/**
 * What one collection's sales came to in a bucket of `nft_volume`: `amount` the volume in the native currency of the sales that have a price in it, `count` those sales;
 * `rate` is `"1.0000000"` and `converted_amount` equals `amount` until `exchange_currency` shows them in another currency. `taxon` is the XRPL taxon.
 */
export interface NftVolumeComponent {
  issuer: string;
  taxon?: number;
  count: number;
  amount: string;
  rate: string;
  converted_amount: string;
}

/** A row of `GET /v2/network/nft_volume`: the row of the other volumes. Its `count` is every sale of the window (those with no rate included), `total` the components' sum. */
export type NftVolumeRow = VolumeRow<NftVolumeComponent>;

/** `GET /v2/nfts/{nft_id}`. The coverage is the NFT's own: `complete` when its mint is indexed. */
export interface NftAnswer {
  coverage: Coverage;
  nft: Nft;
}
/** `GET /v2/nfts/{nft_id}/history`, oldest first unless `descending`. */
export interface NftEventsPage {
  coverage: Coverage;
  count: number;
  marker?: string;
  events: NftEvent[];
}
/** `GET /v2/nfts/{nft_id}/offers`, newest first. */
export interface NftOffersPage {
  coverage: Coverage;
  count: number;
  marker?: string;
  offers: NftOffer[];
}
/** `GET /v2/accounts/{address}/nfts` and a collection's `/nfts`. */
export interface NftsPage {
  coverage: Coverage;
  count: number;
  marker?: string;
  nfts: Nft[];
}
/** `GET /v2/nft_sales` and a collection's `/sales`. */
export interface NftSalesPage {
  coverage: Coverage;
  count: number;
  marker?: string;
  sales: NftSale[];
}
/** A collection's `/holders`, the most first. */
export interface NftHoldersPage {
  coverage: Coverage;
  count: number;
  marker?: string;
  holders: NftHolder[];
}
/** `GET /v2/nft_collections`: `total` is how many collections the filter matches, whatever the page. */
export interface NftCollectionsPage {
  coverage: Coverage;
  total: number;
  count: number;
  marker?: string;
  collections: NftCollection[];
}
/** `GET /v2/nft_collections/{issuer}[/{taxon}]`. */
export interface NftCollectionAnswer {
  coverage: Coverage;
  collection: NftCollection;
}
/** A collection's `/stats`: one row for each UTC day of the window with activity, and no `marker` (the window is at most 366 days). */
export interface NftCollectionDays {
  coverage: Coverage;
  count: number;
  days: NftCollectionDay[];
}
/**
 * `GET /v2/network/nft_volume`: the rows of the buckets asked for, or for a rolling period (`live`) one row or none (D3 writes none until its syncer has the period's set). An
 * answer may hold no row (`checkNftVolume`).
 */
export interface NftVolume {
  coverage: Coverage;
  count: number;
  marker?: string;
  rows: NftVolumeRow[];
}

// ---- Account names and tomls: GET /v2/account_names, GET /v2/toml/{domain} -----------------------------------------------------------------------------------------
//
// Written from D4's reference (data-api-new `feat/explorer-data-2` at 3feb11a, docs/api-reference.md, "Account names and tomls"); api/openapi.yaml has the two paths and no
// response schemas. A key without a value is left out, never `null`. `names-shape.ts` checks what the pages read of them.

/**
 * The kinds of display name D4 serves: a `verified` name (the toml of the account's domain lists the address), a name the operator gave the `account`, or the account's
 * `domain`, which nothing vouches for.
 */
export type DisplayNameKind = "verified" | "account" | "domain";

/** A label the operator put on an address (`scam`, `spam` or `advisory`); `description` may be empty. */
export interface LabelData {
  description: string;
  source?: string;
  url?: string;
}

/**
 * One address of `GET /v2/account_names`. `domain` is the account domain whatever its state (and may come with no `display_name`: that is how D4 answers when it could not read its
 * toml store). `account_name` and `account_network_name` are the operator's names for the address, `labels` its labels in the order `scam`, `spam`, `advisory`.
 */
export interface AccountNameEntry {
  address: string;
  /** `kind` is a DisplayNameKind, or a kind of a newer API, which this build reads as no name. */
  display_name?: { text: string; kind: string };
  domain?: string;
  account_name?: string;
  account_network_name?: string;
  labels?: Record<string, LabelData>;
}

/** `GET /v2/account_names?addresses=a,b,…`: one entry for each address asked, in the order asked (an address asked twice is answered at each place). */
export interface AccountNamesResponse {
  result: "success";
  count: number;
  account_names: AccountNameEntry[];
}

/**
 * What the toml of a domain says, as D4's `tomls` worker last stored it. `status` `failed` has a `reason` (`http_status` has the `status_code` too); `fetched` is when the
 * content was read and is there while the content is in effect, also on a failed read within the grace of a transient failure. Empty lists are left out. `accounts` may
 * repeat an address, once for each counting network.
 */
export interface TomlData {
  domain: string;
  toml_url: string;
  status: "ok" | "failed";
  reason?: string;
  status_code?: number;
  checked: string;
  fetched?: string;
  modified?: string;
  expires?: string;
  accounts?: { address: string; desc?: string }[];
  currencies?: { code: string; issuer?: string; display_decimals?: number; symbol?: string; name?: string; desc?: string }[];
  principals?: string[];
  validators?: { public_key: string; owner_country?: string; server_country?: string; unl?: string }[];
}

/** `GET /v2/toml/{domain}`. */
export interface TomlAnswer {
  result: "success";
  toml: TomlData;
}

// ---- Ledger objects: GET /v2/escrows/{escrow_id}, /v2/checks/{check_id}, /v2/payment_channels/{channel_id} (each with /history), GET /v2/accounts/{address}/delegations, ----
// ---- GET /v2/ledger_objects/{object_id} ---------------------------------------------------------------------------------------------------------------------------------
//
// D5 (data-api-new `feat/explorer-data-2`, pinned at `0c2e58c3995cb3fdc240c3bf89dea9c4ab1e8adb`; the section "Ledger objects" of its docs/api-reference.md). Keys are in the
// reference's order (its "Keys of …" lines); a key it marks `?` is left out of an answer when it has no value, `null` is never served, so those keys are optional here and every
// other key is there, with these exceptions: D5 drops a field it cannot read (`compact` in object-views.ts), so an escrow's `amount`, a check's `send_max` and a channel's `amount`,
// `balance`, `remaining`, `settle_delay` and `public_key` are optional too (a page draws "—" for one that is missing). `object-shape.ts` makes the rest true. The facts the reference states:
//   - an object ID (and a transaction hash) is 64 hexadecimal digits, upper-case in every answer; the routes accept any case. Times are `YYYY-MM-DDTHH:mm:ssZ`;
//   - an amount is `{ currency, issuer?, value, mpt_issuance_id? }`: the native currency's code with no issuer and its value in whole units; an issued token as on the ledger (its
//     `value` text is the ledger's, so it may be in exponent form); an MPT with its 48-digit issuance ID in `currency` and again in `mpt_issuance_id`, `value` the raw integer units.
//     What D5 computes (`remaining`, `amount_change`, `balance_change`) is plain decimal text in every currency;
//   - every answer but the lookup has `result`, `coverage` (whether the history it is read from is whole: complete when the object's creation is indexed), then `ledger_index` and
//     `close_time`, the newest committed ledger and when it closed, which the object, its `history` and its `status` are as of;
//   - the detail embeds the newest 50 events, newest first, with `history_marker` when there are more; the history route is oldest first unless asked `descending`.

/** An amount of a ledger object. Native: no `issuer`. Issued token: `issuer`, no `mpt_issuance_id`. MPT: `currency` and `mpt_issuance_id` are the same 48 upper-case hex digits. */
export type ObjectAmount = { currency: string; issuer?: string; value: string; mpt_issuance_id?: string };

/** The place of a fact in the ledger history (`created`, a delegation's `updated`); `removed` also has the type of the transaction that deleted the object. */
export type ObjectRef = { ledger_index: number; time: string; tx_hash: string; tx_type?: string }; // tx_type on `removed`

export type EscrowStatus = "pending" | "can_be_finished" | "can_be_cancelled" | "finished" | "cancelled" | "removed";
export type CheckStatus = "open" | "expired" | "cashed" | "cancelled" | "removed";
export type ChannelStatus = "open" | "closing" | "closed" | "removed";

/** An escrow. `sequence` is left out when no indexed row says it, `created` when its creation is not indexed, `removed` while it is in the ledger. */
export interface EscrowObject {
  escrow_id: string;
  account: string;
  sequence?: number;
  destination: string;
  amount?: ObjectAmount;
  finish_after?: string;
  cancel_after?: string;
  condition?: string;
  fulfillment?: string;
  destination_tag?: number;
  source_tag?: number;
  transfer_rate?: number;
  status: EscrowStatus;
  created?: ObjectRef;
  removed?: ObjectRef;
}

/** A check. `delivered` is there once it is cashed. */
export interface CheckObject {
  check_id: string;
  account: string;
  sequence?: number;
  destination: string;
  send_max?: ObjectAmount;
  expiration?: string;
  invoice_id?: string;
  destination_tag?: number;
  source_tag?: number;
  delivered?: ObjectAmount;
  status: CheckStatus;
  created?: ObjectRef;
  removed?: ObjectRef;
}

/**
 * A payment channel: `amount` is what was deposited in all, `balance` what was paid out so far, `remaining` their difference (D5 computes it, so it is missing when either is). `funds`
 * and `claims` count the events of the whole history.
 */
export interface PaymentChannelObject {
  channel_id: string;
  account: string;
  sequence?: number;
  destination: string;
  amount?: ObjectAmount;
  balance?: ObjectAmount;
  remaining?: ObjectAmount;
  settle_delay?: number;
  public_key?: string;
  expiration?: string;
  cancel_after?: string;
  destination_tag?: number;
  source_tag?: number;
  status: ChannelStatus;
  opened_with?: ObjectAmount;
  funds: number;
  claims: number;
  created?: ObjectRef;
  removed?: ObjectRef;
}

/**
 * One event of an object's history: the transaction, then the facts of the object's type. An escrow's adds `amount` (a `create`) and `fulfillment` (a `finish`); a check's `send_max`
 * and `expiration` (a `create`) and `delivered` (a `cash`); a channel's `amount` and `balance` (every event), `amount_change` and `balance_change` (only when nonzero), `expiration`
 * (when it has one after the transaction; D5 leaves out an `amount` or `balance` it cannot read) and `settle_delay` (a `create`). `account` is the sender of the transaction, `delegate` the account that sent it for `account`.
 */
export interface ObjectEvent {
  event: string;
  ledger_index: number;
  time: string;
  tx_hash: string;
  tx_type: string;
  account: string;
  delegate?: string;
  result: string;
  amount?: ObjectAmount;
  fulfillment?: string;
  send_max?: ObjectAmount;
  expiration?: string;
  delivered?: ObjectAmount;
  balance?: ObjectAmount;
  amount_change?: ObjectAmount;
  balance_change?: ObjectAmount;
  settle_delay?: number;
}

/** What every answer but the lookup starts with. */
interface AsOfAnswer {
  result: "success";
  coverage: Coverage;
  ledger_index: number;
  close_time: string;
}

export interface EscrowAnswer extends AsOfAnswer {
  escrow: EscrowObject;
  history: ObjectEvent[];
  history_marker?: string;
}

export interface CheckAnswer extends AsOfAnswer {
  check: CheckObject;
  history: ObjectEvent[];
  history_marker?: string;
}

export interface PaymentChannelAnswer extends AsOfAnswer {
  payment_channel: PaymentChannelObject;
  history: ObjectEvent[];
  history_marker?: string;
}

/** `/{id}/history` of each of the three: a page of events, with the `coverage` of the object. */
export interface ObjectHistoryPage extends AsOfAnswer {
  count: number;
  marker?: string;
  history: ObjectEvent[];
}

/** One permission of a delegation. `kind` is `transaction` for a transaction type's name, `granular` for one of the 12 granular permissions (which also gives the `transaction_type` it narrows), `unknown` for a number. */
export interface DelegationPermission {
  permission: string;
  kind: "transaction" | "granular" | "unknown";
  transaction_type?: string;
}

/** A delegation (XLS-75): `account` lets `authorize` send the transactions of `permissions` for it. `created` is left out when its transaction is not indexed. */
export interface Delegation {
  delegation_id: string;
  account: string;
  authorize: string;
  permissions: DelegationPermission[];
  updated: ObjectRef;
  created?: ObjectRef;
}

/** `GET /v2/accounts/{address}/delegations`: the delegations in the ledger now, the one changed last first. Xahau has none: an empty list with a complete coverage. */
export interface DelegationsPage extends AsOfAnswer {
  count: number;
  marker?: string;
  delegations: Delegation[];
}

/** `ledger_object` of `GET /v2/ledger_objects/{object_id}`: which kind of object an ID is. `deleted` is whether the newest row of the object deleted it, `ledger_index` the ledger of that row. */
export interface LedgerObjectRef {
  object_id: string;
  object_type: "Escrow" | "Check" | "PayChannel" | "Delegate";
  account: string;
  deleted: boolean;
  ledger_index: number;
}

/** The three objects that have a detail and a history, as the explorer names them. */
export type ObjectApiKind = "escrow" | "check" | "payment_channel";
export type ObjectAnswer = EscrowAnswer | CheckAnswer | PaymentChannelAnswer;

// ---- Tokens: GET /v2/tokens, GET /v2/tokens/{token}, GET /v2/tokens/{token}/holders, GET /v2/tokens/{token}/transfers --------------------------------------------------------------
//
// D6 (data-api `feat/explorer-data-2`, pinned at `2fb4183721af6df58dd345f4a6ef90a293ae70b0`; the section "Tokens" of its docs/api-reference.md). Keys are in the reference's order
// (its "Keys of …" lines); a key it marks `?` is left out of an answer when it has no value, `null` is never served, so those keys are optional here and every other key is there.
// `token-shape.ts` makes that true. The facts the reference states:
//   - the tokens are the issued tokens of the network (a currency and its issuer with at least one trust line that counts), ranked by holders; `kind` is `issued`, the only kind
//     there is. `rank` is the place of a token or a holder in the whole ordered list, whatever the page;
//   - the list, the detail and the holders have `ledger_index` and `close_time` after `coverage`: the ledger the live generation of the aggregate is through. The list has none (and no
//     `totals`, `total`) before the first generation exists: then it is `{ result, coverage, kind, count: 0, tokens: [] }`, and the detail and the holders are a 404;
//   - amounts (`supply`, `balance`, `limit`, `volume`, `counter_volume`, `native_volume`, `amount`) are exact text in whole units, and `price` and `last` are 8 significant digits that come as
//     exponent text below 0.000001 and from 100,000,000 (`"9.9000000e-7"`): number text (`isNumberText`). `price_change`, `change` and `transfer_fee` are plain decimal text (percent,
//     2 decimals; `transfer_fee` exact); `share` is `"0.117300"`, 6 decimals. A market's `last` is the other asset per token and is `"Infinity"` for a pair whose stored rate is 0
//     (D6 declined to fix it), and so is the `price` of a token that is the counter side of its pair with the native currency: `token-shape.ts` leaves that key out of the market, the row or
//     the detail, which is why `last` is optional on `TokenMarket` and `price` on the row and the detail;
//   - `totals.holders` is left out while the tokens job has not counted the distinct holders (never a false 0), and `totals.native_volume` while there is no `day` set of the markets.

/**
 * A row of the list: an issued token with its holders, supply and the price and volume of the day. A token that has not traded against the native currency in 30 days has no `price` and no
 * `price_time`, and the `price_change` is there only when the price is of the day; `native_volume` and `trades` are `"0"` and 0 for a token with no pair, and left out only while D6 has no `day` set.
 */
export interface IssuedTokenRow {
  rank: number;
  /** As the ledger holds it: the 3 characters, or 40 upper-case hex digits. */
  currency: string;
  /** The 3-character code, or the text of the hex when it is printable ASCII; left out otherwise. */
  code?: string;
  issuer: string;
  holders: number;
  trust_lines: number;
  supply: string;
  price?: string;
  price_change?: string;
  price_time?: string;
  native_volume?: string;
  trades?: number;
  domain?: string;
  listed: boolean;
  name?: string;
}

/** What describes the whole kind, whatever the filters. */
export interface IssuedTokensTotals {
  tokens: number;
  tokens_with_10_holders: number;
  /** The distinct accounts that hold any token; left out until the job has counted them. */
  holders?: number;
  native_volume?: string;
}

/** `GET /v2/tokens`. `total` is the number of tokens the filters select, `total_below` (with `min_holders`) the number that match the search but have fewer holders. */
export interface TokensResponse {
  result: "success";
  coverage: Coverage;
  kind: "issued";
  ledger_index?: number;
  close_time?: string;
  totals?: IssuedTokensTotals;
  total?: number;
  total_below?: number;
  count: number;
  marker?: string;
  tokens: IssuedTokenRow[];
}

/** What the issuer's toml says of a token, each as the toml gives it (text), `display_decimals` a whole number 0 to 30. Left out when the token is not listed, and when the listed entry has none of these fields. */
export interface TokenToml {
  name?: string;
  desc?: string;
  icon?: string;
  symbol?: string;
  display_decimals?: number;
  asset_class?: string;
  asset_subclass?: string;
  attestation?: string;
}

/** The settings of the issuer's account: `transfer_fee` a percent, exact (`"0.2"`, none is `"0"`). Left out while the issuer has no row in the state tables (unknown, not off). */
export interface IssuerSettings {
  transfer_fee: string;
  global_freeze: boolean;
  no_freeze: boolean;
  allow_trust_line_clawback: boolean;
  require_auth: boolean;
  default_ripple: boolean;
}

/**
 * A pair of the `day` set of the markets with the token on a side, turned so that the token is the base: `volume` is the token's side, `counter_volume` the other, `last` the other
 * asset per token. `last` is optional because D6 writes `"Infinity"` for a pair whose stored rate is 0, and `token-shape.ts` leaves it out then (a page draws "—").
 */
export interface TokenMarket {
  counter_currency: string;
  counter_issuer?: string;
  count: number;
  volume: string;
  counter_volume: string;
  native_volume?: string;
  last?: string;
  change?: string;
  last_time: string;
  amm_pool?: boolean;
}

/** The token of `GET /v2/tokens/{token}`: the keys of a row of the list without `rank`, and the rest. `last_ledger` is the newest ledger in which one of its lines changed. */
export interface TokenDetail {
  currency: string;
  code?: string;
  issuer: string;
  holders: number;
  trust_lines: number;
  supply: string;
  price?: string;
  price_change?: string;
  price_time?: string;
  native_volume?: string;
  trades?: number;
  domain?: string;
  toml_url?: string;
  listed: boolean;
  toml?: TokenToml;
  issuer_settings?: IssuerSettings;
  /** At most 20, the biggest by native volume first; `[]` for a token with no pair in the day set. */
  markets: TokenMarket[];
  last_ledger: number;
}

/** `GET /v2/tokens/{token}`. */
export interface TokenAnswer {
  result: "success";
  coverage: Coverage;
  ledger_index: number;
  close_time: string;
  token: TokenDetail;
}

/** A holder of a token: `share` is the balance over the token's `supply`, 6 decimals (`"0.048214"`); `limit` is the holder's own limit. */
export interface TokenHolder {
  rank: number;
  holder: string;
  balance: string;
  share: string;
  limit: string;
  frozen: boolean;
  authorized: boolean;
}

/** `GET /v2/tokens/{token}/holders`, the largest balance first. `supply` is the token's. */
export interface TokenHoldersResponse {
  result: "success";
  coverage: Coverage;
  ledger_index: number;
  close_time: string;
  supply: string;
  count: number;
  marker?: string;
  holders: TokenHolder[];
}

/** A payment that delivered the token: `amount` is what it delivered, not what it asked for. A tag of 0 is a tag and is served. */
export interface TokenTransfer {
  hash: string;
  ledger_index: number;
  executed_time: string;
  source: string;
  destination: string;
  amount: string;
  source_tag?: number;
  destination_tag?: number;
}

/** `GET /v2/tokens/{token}/transfers`: no ledger of its own, and a `coverage` of the payments of the ledgers (not of the state tables). Never a 404: no transfers is `count: 0`. */
export interface TokenTransfersResponse {
  result: "success";
  coverage: Coverage;
  count: number;
  marker?: string;
  transfers: TokenTransfer[];
}

// ---- Supply: GET /v2/network/supply, GET /v2/network/supply/minted -----------------------------------------------------------------------------------------------------
//
// D7 (data-api `feat/explorer-data-2`, pinned at `31e97efaa1a6e098435b666e8893c79a0c4bee66`; the section "Network" of its docs/api-reference.md, `GET /v2/network/supply` and
// `GET /v2/network/supply/minted`). Keys are in the reference's order (its "Keys of …" lines); a key it marks `?` is left out of an answer, `null` is never served, so those keys are
// optional here and every other key is there. `supply-shape.ts` makes that true. The facts the reference states:
//   - the supply is a snapshot, one row an hour: every figure is as of `ledger_index` and its `close_time`, written at `computed_at`. Before the first snapshot the answer is a 404,
//     `supply not computed yet`. It takes no parameter;
//   - an amount is exact decimal text in whole units of the native currency (`"64772465269.314"`, trailing zeros dropped), a count is a number. `minted` is there only on a network that
//     mints (Xahau), `amm` only where AMM exists (the XRP Ledger), `reserves` only when a reserve value is known at the snapshot ledger;
//   - a part read from the indexed history ends with its own `coverage`; `total` has none, and neither has the `burned` of the XRP Ledger (exactly 100 billion XRP less `total`, from the
//     ledger header), which is why `coverage` is optional on `SupplyPart`. The answer has no `coverage` of its own;
//   - `circulating` is `total` less `escrowed` and states the coverage of `escrowed`; `minted.amount` is `rewards` + `import` + `genesis_mint`; `reserves.amount` is
//     `accounts` × `base` + `owner_count` × `increment`;
//   - the minted route is one row a UTC day on Xahau, with no gap (a day with no mint is a row of zeros) and the running day last, and `coverage` right after `result`. On a network that
//     cannot mint it answers `count: 0` and `rows: []`.

/** One figure of the supply: its amount, and the coverage of the history it is read from (left out where none is needed). */
export interface SupplyPart {
  amount: string;
  coverage?: Coverage;
}

/** The native currency in open native escrows, and how many there are. */
export interface EscrowedPart extends SupplyPart {
  escrows: number;
}

/** The native currency in the pools of automated market makers (the XRP Ledger), and the number of live pools with a native reserve above 0. */
export interface AmmPart extends SupplyPart {
  pools: number;
}

/** What the accounts must keep: `accounts` × `base` + `owner_count` × `increment`, the reserve values in force at the snapshot ledger. */
export interface ReservesPart extends SupplyPart {
  accounts: number;
  owner_count: number;
  base: string;
  increment: string;
}

/** What the indexed ledgers created (Xahau): `amount` is `rewards` + `import` + `genesis_mint`. */
export interface MintedPart extends SupplyPart {
  rewards: string;
  import: string;
  genesis_mint: string;
}

/** `GET /v2/network/supply`: the native supply at one ledger. */
export interface NetworkSupply {
  result: "success";
  ledger_index: number;
  close_time: string;
  computed_at: string;
  currency: "XRP" | "XAH";
  total: string;
  burned: SupplyPart;
  minted?: MintedPart;
  escrowed: EscrowedPart;
  circulating: SupplyPart;
  amm?: AmmPart;
  reserves?: ReservesPart;
}

/** A UTC day of the minted route: `date` is its start, `amount` the sum of the three sources. Every key is there. */
export interface MintedRow {
  date: string;
  amount: string;
  rewards: string;
  import: string;
  genesis_mint: string;
}

/** `GET /v2/network/supply/minted`: the native currency created on each UTC day. `coverage` is the feature `mints`'s; `marker` is there only when there is a next page. */
export interface MintedPage {
  result: "success";
  coverage: Coverage;
  marker?: string;
  count: number;
  rows: MintedRow[];
}

// ---- What the node answers for an NFT --------------------------------------------------------------------------------------------------------------------------

// The node's answers as `node-rpc.ts` returns them (read on 2026-10-24 from `https://s1.ripple.com:51234/`, a Clio server, and `https://xahau.network/`): times in unix seconds
// and native amounts as whole units, the rest as the node writes it. They are here with the data API's, and `NodeAmount` with them, because this file is in the Node type-check
// project (tsconfig.node.json) and `node-rpc.ts`, which needs the Workers' types, is not: `node-rpc.ts` re-exports them all, so that either file names them.

/** An amount as the explorer reads it: native amounts converted from drops to whole units at this boundary. */
export interface NodeAmount {
  /** The native code (`XRP`, `XAH`) with no issuer, or the currency as the ledger holds it (3 characters, or 40 hex digits in upper case). */
  currency: string;
  issuer?: string;
  /** A plain decimal: whole units, never in exponent form. */
  value: string;
}

/** Clio's `nft_info` on the newest validated ledger. `uri` is hex and is left out when the NFT has none (a burned one has none). */
export interface NodeNftInfo {
  nft_id: string;
  ledger_index: number;
  owner: string;
  is_burned: boolean;
  flags: number;
  transfer_fee: number;
  issuer: string;
  nft_taxon: number;
  nft_serial: number;
  uri?: string;
}

/** An offer of `nft_sell_offers` or `nft_buy_offers`. `expiration` is unix seconds. */
export interface NodeNftOffer {
  nft_offer_index: string;
  flags: number;
  owner: string;
  amount: NodeAmount;
  destination?: string;
  expiration?: number;
}

/** The first offers (at most 50) of an NFT on one side; `more` when the node had a marker for more. */
export interface NodeNftOffers {
  offers: NodeNftOffer[];
  more: boolean;
}

/** A Xahau `URIToken` ledger entry (`ledger_entry` by `index`). `Amount` and `Destination` are its sell offer's, when it has one. */
export interface NodeUriToken {
  index: string;
  ledger_index: number;
  Owner: string;
  Issuer: string;
  URI: string;
  Digest?: string;
  Flags: number;
  Amount?: NodeAmount;
  Destination?: string;
}
