// The client of the GateHub Data API (data-api-new, its /v2 endpoints). Only loaders use it, through the
// Worker's subrequest cache; nothing in the browser talks to the API. Worker-only code.
//
// Every request carries the key from the DATA_API_KEY secret, is limited to 5 s (answer included; the account's counterparties,
// the one slow call, 15 s) and is never redirected. A failure is an `UpstreamError`, which is never cached.

import type { AnalyticsUnit } from "../domain/analytics-params";
import { apiAssetText, type Asset } from "../domain/asset";
import type { CandleApiInterval } from "../domain/market-params";
import type { ValidatorScope } from "../domain/validators-params";
import { checkDaysPage, checkGovernancePage, checkLiquidityPage, checkLiveVolume, checkPool, checkPoolsPage, checkSwapsPage } from "./amm-shape";
import {
  checkActiveAccounts,
  checkCandles,
  checkFeeBucketPage,
  checkFeeStatsPage,
  checkMarkets,
  checkPairExchanges,
  checkReduce,
  checkStatsPage,
  checkValidations,
  checkVolumePage,
} from "./aggregate-shape";
import {
  checkAccountStats,
  checkAnalyticsBalances,
  checkAnalyticsExchanges,
  checkBalanceChanges,
  checkCounterparties,
} from "./analytics-shape";
import type {
  AccountData,
  AccountExchange,
  AccountTxStatsRow,
  AccountValueRow,
  ActiveAccounts,
  AmendmentDetail,
  AmendmentsList,
  AmmFilter,
  AmmGovernanceRow,
  AmmLiquidityEvent,
  AmmPool,
  AmmPoolDay,
  AmmSwap,
  AmmVolumeRow,
  AnalyticsBalanceChanges,
  AnalyticsBalances,
  AnalyticsCounterparties,
  AnalyticsExchanges,
  BalancesResponse,
  Candle,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeRow,
  FeeStatsRow,
  LastValidated,
  Ledger,
  LedgerExpanded,
  LedgerValidations,
  LedgerWithHashes,
  MarketsResponse,
  OrdersResponse,
  Page,
  PairExchange,
  Payment,
  PaymentVolumeComponent,
  ReducedRow,
  StatsRow,
  TxBinary,
  TxObject,
  TxStoredJson,
  ValidatorDetail,
  ValidatorsList,
  ValidatorsSummary,
  ValidatorValidationsPage,
  VolumeRow,
} from "./api-types";
import {
  MARKER_PAGE_CLASS,
  PERIOD_CALL_TTL_SECONDS,
  VALIDATIONS_MARKER_TTL_SECONDS,
  type CacheClass,
  type SubrequestCache,
  type SubrequestOptions,
} from "./cache-class";
import type { Env } from "./env";
import { isMarker } from "./marker";
import type { Network } from "./networks";
import type { paths } from "./openapi";
import { PENDING_PATHS } from "./pending-paths";
import { checkBinaryAnswer, checkIndexTransaction, checkLedgerHashes } from "./tx-shape";
import { ANALYTICS_SLOW_TIMEOUT_MS, clip, DATA_API_TIMEOUT_MS, retryAfterOf, UpstreamError, withDeadline } from "./upstream";
import {
  checkAmendmentDetail,
  checkAmendments,
  checkValidatorDetail,
  checkValidatorsList,
  checkValidatorsSummary,
  checkValidatorValidations,
} from "./validators-shape";

export { UpstreamError } from "./upstream";
export type { UpstreamErrorKind } from "./upstream";

/**
 * The endpoints the client calls, in the OpenAPI document's own spelling (`{name}` marks a path parameter).
 * `satisfies Record<string, keyof paths>` makes the compiler check each against the generated
 * `app/server/openapi.d.ts`: a path that leaves the API fails `pnpm typecheck`.
 */
const PATHS = {
  lastValidated: "/v2/last_validated",
  ledger: "/v2/ledgers/{ledger_param}",
  transaction: "/v2/transactions/{tx_hash}",
  transactions: "/v2/transactions",
  account: "/v2/accounts/{address}",
  balances: "/v2/accounts/{address}/balances",
  orders: "/v2/accounts/{address}/orders",
  accountTransactions: "/v2/accounts/{address}/transactions",
  accountPayments: "/v2/accounts/{address}/payments",
  accountExchanges: "/v2/accounts/{address}/exchanges",
  accountStats: "/v2/accounts/{address}/stats/{family}",
  fees: "/v2/network/fees",
  feeStats: "/v2/network/fee_stats",
  stats: "/v2/stats/{family}",
  paymentVolume: "/v2/network/payment_volume",
  exchangeVolume: "/v2/network/exchange_volume",
  ledgerValidations: "/v2/ledgers/{ledger_hash}/validations",
  pairExchanges: "/v2/exchanges/{base}/{counter}",
  activeAccounts: "/v2/active_accounts/{base}/{counter}",
} as const satisfies Record<string, keyof paths>;

/** A path of `PATHS` or of `PENDING_PATHS` (the routes `openapi.yaml` does not have yet, which the compiler cannot check). */
type Template = (typeof PATHS)[keyof typeof PATHS] | (typeof PENDING_PATHS)[keyof typeof PENDING_PATHS];

/** Paging of a list: `marker` is the opaque token of the previous page's answer. */
export type ListQuery = { descending?: boolean; limit?: number; marker?: string };

/** `fees` by the day: a row for each day that starts within `start` and `end` (`YYYY-MM-DD`). Sent in this order. */
export type FeeBucketQuery = { interval: "day"; start: string; end: string; limit: number };

/** `stats`: a row for each `interval` that starts within `start` and `end` (`YYYY-MM-DD`), of the `metrics` named (all of the family without). Sent in this order. */
export type StatsQuery = { interval: "day" | "week"; start: string; end: string; limit: number; metrics?: readonly string[] };

/**
 * The volumes: a row for each `interval` that starts within `start` and `end` (`YYYY-MM-DD`), in the native currency or, with
 * `exchangeCurrency` (and `exchangeIssuer`, unless it is the native one), in another. Sent in this order, as `exchange_currency` and `exchange_issuer`.
 */
export type VolumeQuery = {
  interval: "day" | "week";
  start: string;
  end: string;
  limit: number;
  exchangeCurrency?: string;
  exchangeIssuer?: string;
};

/**
 * The candles of a pair: a row for each `interval` bucket that starts within `start` and `end` (ISO times; the newest ledger when `end` is left out), at most
 * `limit`, oldest first unless `descending`. The pair's trades are the same path with `reduce` or without `interval`. `amm` narrows them like the trades'.
 * Sent in this order, `amm` last.
 */
export type CandleQuery = { interval: CandleApiInterval; start: string; end?: string; limit: number; descending?: boolean; amm?: AmmFilter };

/**
 * What the account analytics calls ask for (E4 spec 2.3): the buckets (`interval`) and the pages (`limit`) of a window that starts on `start` (`YYYY-MM-DD`, UTC) and
 * runs to the newest ledger. Sent in the order `interval`, `limit`, `start`, each call the ones it has.
 */
export type AnalyticsQuery = { interval: AnalyticsUnit; limit: number; start: string };

/** The most accounts of a pair's active accounts that the client keeps (the API sorts them by base volume, largest first, and serves them all). */
export const ACTIVE_ACCOUNTS_KEPT = 10;

/** The most rows of a payments CSV: the API's own maximum for the account lists (it cuts a larger `limit` down to it). */
export const CSV_PAGE_LIMIT = 1000;

/** One page of a CSV list, as the API served it. */
export interface CsvPage {
  /** The CSV, not read yet: stream it on. */
  body: ReadableStream<Uint8Array>;
  /** The marker of the page after this one (from the API's `Link` header), when there is one. */
  nextMarker?: string;
}

/**
 * `ttl`: keep the answer this many seconds instead of the call's class's. It has a cache entry of its own (the key says so), so that an
 * answer kept longer for another caller is not what this one reads. The home page asks for `HOME_CALL_TTL_SECONDS`, the network page
 * for that on three of its calls and for `PERIOD_CALL_TTL_SECONDS` on the ones over a period.
 *
 * `holdFailure`: remember this call's failure for a few seconds (`SubrequestOptions` in cache-class.ts). A page that polls asks for it on
 * every call it makes. It is not part of the key.
 */
export interface FreshOptions {
  ttl?: number;
  holdFailure?: boolean;
}

export interface DataApi {
  /** The newest ledger the API has committed. Class `live` (5 s); the home page asks for `{ ttl: HOME_CALL_TTL_SECONDS }`. */
  lastValidated(opts?: FreshOptions): Promise<LastValidated>;
  /**
   * A validated ledger by index, hash or date. `expand` adds its transactions in full, `transactions` their hashes
   * (`expand` wins). Either way `transactions` is always a list, empty for a ledger with no transactions.
   */
  ledger(id: string, opts: { expand: true; transactions?: boolean; holdFailure?: boolean }): Promise<LedgerExpanded>;
  ledger(id: string, opts: { transactions: true; expand?: false; holdFailure?: boolean }): Promise<LedgerWithHashes>;
  ledger(id: string, opts?: { expand?: boolean; transactions?: boolean; holdFailure?: boolean }): Promise<Ledger>;
  /**
   * One transaction by hash. An answer that is not a transaction of that hash, with its type, account and metadata, is an
   * `UpstreamError` of kind `server` (a 200 with the wrong content is the API failing), and is not stored.
   */
  transaction(hash: string): Promise<TxObject>;
  /**
   * The same transaction with `tx` and `meta` as the hex of their serialization (`binary=true`): the blob of `tx` is the one
   * its hash is taken over. For a type the API's codec cannot serialize the API serves the JSON it stored instead (`TxStoredJson`).
   * Asked for beside `transaction` by the transaction page, for its Binary tab.
   */
  transactionBinary(hash: string): Promise<TxBinary | TxStoredJson>;
  /**
   * Transactions of all accounts, oldest first unless `descending`. Class `live`; with `ttl` and **no marker** (in either direction) the
   * answer is kept that long instead. A list reached with a marker keeps the class it has (`MARKER_PAGE_CLASS` when newest first) and ignores `ttl`.
   */
  transactions(q: ListQuery, opts?: FreshOptions): Promise<Page<"transactions", TxObject>>;
  /** How an account was created. 404 (`not_found`) for an address that never was. */
  account(address: string): Promise<AccountData>;
  /** An account's balances on the newest validated ledger, read by the API from a node. */
  balances(address: string): Promise<BalancesResponse>;
  /** An account's open offers, read like the balances. */
  orders(address: string): Promise<OrdersResponse>;
  accountTransactions(address: string, q: ListQuery): Promise<Page<"transactions", TxObject>>;
  accountPayments(address: string, q: ListQuery): Promise<Page<"payments", Payment>>;
  accountExchanges(address: string, q: ListQuery): Promise<Page<"exchanges", AccountExchange>>;
  /**
   * One page of an account's payments as CSV (`format=csv`), newest first, at most `CSV_PAGE_LIMIT` rows, after `marker` when
   * it is given. Not cached, and not read: the body is a stream for the caller to pass on. A 200 that is not CSV is an
   * `UpstreamError` of kind `server`.
   */
  accountPaymentsCsv(address: string, q: { marker?: string }): Promise<CsvPage>;
  /** What the transactions of each ledger paid in fees, one row per ledger. Class `live`; the home page asks for `{ ttl: HOME_CALL_TTL_SECONDS }`. */
  fees(q: { descending: boolean; limit: number }, opts?: FreshOptions): Promise<Page<"rows", FeeRow>>;
  /**
   * What the transactions of each day paid in fees, one row per day, all its ledgers counted. Class `slow`;
   * the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`. A row that is not what the reference promises is an `UpstreamError` of kind `server`.
   */
  fees(q: FeeBucketQuery, opts?: FreshOptions): Promise<Page<"rows", FeeBucketRow>>;
  /**
   * Snapshots of the node's fee state, taken by the data API every 5 s (the open ledger fee, the queue, the open ledger's size): `descending` with
   * `limit: 1` and `start` the day is the newest. Class `live`; the network page asks for `{ ttl: HOME_CALL_TTL_SECONDS }`.
   */
  feeStats(q: { descending: boolean; limit: number; start: string }, opts?: FreshOptions): Promise<Page<"rows", FeeStatsRow>>;
  /**
   * Counts of what happened on the network per day or week: transactions by `type`, or the `metric`s (`accounts_created`, `ledger_count`,
   * `transaction_count`, …). Zero counts are left out of a row. Class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`.
   */
  stats(family: "type" | "metric", q: StatsQuery, opts?: FreshOptions): Promise<Page<"stats", StatsRow>>;
  /** The payment volume of the tracked currencies, per day or week. Class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`. */
  paymentVolume(q: VolumeQuery, opts?: FreshOptions): Promise<Page<"rows", VolumeRow<PaymentVolumeComponent>>>;
  /** The trade volume of the tracked markets, per day or week. Class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`. */
  exchangeVolume(q: VolumeQuery, opts?: FreshOptions): Promise<Page<"rows", VolumeRow<ExchangeVolumeComponent>>>;
  /**
   * The volume of the swaps against AMM pools, one component per pool. Only a data API that has merged `feat/amm-data` has the route (`PENDING_PATHS`): without it the
   * call fails with the missing-route outage (kind `server`), so a page asks only while `AMM_DATA` is on.
   *
   * With a `VolumeQuery`, per day or week: class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`.
   *
   * With `{ live: "day" }` (sent as `live=day`, no `start`, `end` or `interval`), the one row of a rolling day ending now, which the AMM pages show: class `minute`, and the
   * answer is checked to have exactly one row (`checkLiveVolume`).
   */
  ammVolume(q: VolumeQuery | { live: "day" }, opts?: FreshOptions): Promise<Page<"rows", AmmVolumeRow>>;
  /**
   * The validations the network made of one ledger, one per validator, sorted by validator key (the data API keeps them 90 days). Class
   * `live`. `limit` is at most 1000, and no marker is followed: a ledger with more validations than that is cut.
   */
  ledgerValidations(hash: string, q: { limit: number }, opts?: FreshOptions): Promise<LedgerValidations>;
  /**
   * The trades of a pair (offer crossings and swaps against AMM pools) in the orientation asked for, oldest first unless `descending`; `amm` narrows them to the
   * order book (`exclude`) or the swaps (`only`) and is sent last, never as `include`. Class `live`; with `ttl` and **no marker** the answer is kept that long
   * instead, under an entry of its own (the pair page asks for `HOME_CALL_TTL_SECONDS`). A list reached with a marker keeps the class it has
   * (`MARKER_PAGE_CLASS` when newest first) and ignores `ttl`. Each trade is checked inside the load (`checkPairExchanges`).
   */
  pairExchanges(base: Asset, counter: Asset, q: ListQuery & { amm?: AmmFilter }, opts?: FreshOptions): Promise<Page<"exchanges", PairExchange>>;
  /**
   * The candles of a pair (`checkCandles`). Class `live` (5 s) unless the page names another with `cls` (the pair page asks for `minute` for the long
   * intervals), and kept `ttl` seconds, under an entry of its own, when it asks for one. Every part of the query, the interval included, is in the key.
   */
  pairCandles(base: Asset, counter: Asset, q: CandleQuery, opts?: { cls?: CacheClass; ttl?: number; holdFailure?: boolean }): Promise<Page<"exchanges", Candle>>;
  /**
   * The one row that summarizes the pair's trades from `start` (ISO time) to the newest ledger (`reduce=true`). Class `live`. An answer with no row, or with
   * more than one, is an `UpstreamError` of kind `server` and is not stored.
   */
  pairReduce(base: Asset, counter: Asset, q: { start: string; amm?: AmmFilter }, opts?: FreshOptions): Promise<ReducedRow>;
  /**
   * The accounts that traded the pair in the last day, sorted by base volume, largest first: the first `ACTIVE_ACCOUNTS_KEPT` (10) are kept before the answer is
   * cached, and `count` and `exchanges_count` are as the API served them. Class `minute`.
   */
  activeAccounts(base: Asset, counter: Asset, opts?: FreshOptions): Promise<ActiveAccounts>;
  /**
   * The trade statistics of every pair that traded in a live period (`day`, `7day`, `30day`), the markets page's table: at most `limit` markets, with `amm`
   * narrowing them like the trades'. Only a data API that has D2 (`feat/explorer-data`) has the route (`PENDING_PATHS`): without it the call fails with the
   * missing-route outage (kind `server`), held when the call asks and never stored. Class `minute` (60 s). An answer to a filter that does not echo it in
   * `amm` (a data API that ignored the parameter) is kind `server` too: its rows are the unfiltered ones.
   */
  networkMarkets(q: { period: "day" | "7day" | "30day"; limit: number; amm?: AmmFilter }, opts?: FreshOptions): Promise<MarketsResponse>;
  /**
   * The Analytics tab's calls (E4 spec 2.3), D2's `stats/{family}` and `analytics/*` of an account. Every one is kept 60 s (class `minute`: the running bucket and
   * the figures of now move with every transaction of the account), asks for the failure hold and for sharing its load in flight (spec 2.7: the heaviest of the API's
   * account reads, which a page of many visitors must not make once each), and is checked inside the load, so that a 200 that is not what D2 promises (a daily row
   * under `week`: an API that ignored `interval`) is kind `server` and is never stored. Without D2 the API answers `Cannot GET`, which is kind `server` too. They ask for
   * no marker: a window is one page. The answers of `stats/{family}` and of `analytics/{balances,balance_changes}` carry the interval asked for.
   *
   * `stats/value`: what the account held at the end of each bucket, in the native currency, from its first balance. `stats/transactions`: what it sent in each bucket.
   */
  accountStats(address: string, family: "value", q: AnalyticsQuery): Promise<Page<"rows", AccountValueRow>>;
  accountStats(address: string, family: "transactions", q: AnalyticsQuery): Promise<Page<"rows", AccountTxStatsRow>>;
  /** The first `limit` lines of the account's balances (the native one first), and each line's balance at the end of each bucket. */
  analyticsBalances(address: string, q: AnalyticsQuery): Promise<AnalyticsBalances>;
  /** What the balance changes of the window came to by change type, in all and in each bucket (no `limit`: the types are few). */
  analyticsBalanceChanges(address: string, q: Pick<AnalyticsQuery, "interval" | "start">): Promise<AnalyticsBalanceChanges>;
  /**
   * The first `limit` accounts the account paid or was paid by, largest first. D2 expects 2 to 10 s of the heaviest accounts at 1 Y and All, so this call alone
   * has `ANALYTICS_SLOW_TIMEOUT_MS` (15 s) in place of the 5 s of the rest; a page does not await it that long (spec 2.6).
   */
  analyticsCounterparties(address: string, q: Pick<AnalyticsQuery, "limit" | "start">): Promise<AnalyticsCounterparties>;
  /** The first `limit` pairs the account traded, by native volume, largest first. */
  analyticsExchanges(address: string, q: Pick<AnalyticsQuery, "limit" | "start">): Promise<AnalyticsExchanges>;

  // D1 (data-api-new `feat/explorer-data`, pinned at `7d495ab`): the validators and amendments pages. Only a data API that has merged D1 has the routes (`PENDING_PATHS`):
  // without it each call fails with the missing-route outage (kind `server`), held when the call asks and never stored; the routes' own "Validator not found" and
  // "amendment not found" stay `not_found`. Every answer is checked inside the load (validators-shape.ts), and one that is not what the reference promises is kind `server` too.
  // The pages ask for `{ ttl }` (VALIDATORS_CALL_TTL_SECONDS, VALIDATIONS_CALL_TTL_SECONDS) and, on a polled page, `holdFailure`: each has a cache entry of its own.
  /** The network overview of the Validators board: counts, the trusted UNL and its publishers, the quorum, the negative UNL, fees, the next flag ledger, versions. Class `live`; the pages ask for `{ ttl: VALIDATORS_CALL_TTL_SECONDS }`. */
  validatorsSummary(opts?: FreshOptions): Promise<ValidatorsSummary>;
  /**
   * The validators of the trusted UNL (`unl`), or of the UNL and every validator seen in 24 hours (`all`), at most `limit` (D1's maximum is 1000), domain-first. The query is
   * `?limit=…&scope=…`; the `marker` of a longer list is not followed. Class `live`; the pages ask for `{ ttl: VALIDATORS_CALL_TTL_SECONDS }`.
   */
  validators(q: { scope: ValidatorScope; limit: number }, opts?: FreshOptions): Promise<ValidatorsList>;
  /**
   * One validator by its master key, its signing key or 66 hex digits (the answer's `validation_public_key` is the master). Class `live`; the pages ask for
   * `{ ttl: VALIDATORS_CALL_TTL_SECONDS }`. `Validator not found` is `not_found`; D1's 400 `invalid validator public key` is `bad_request`.
   */
  validator(key: string, opts?: FreshOptions): Promise<ValidatorDetail>;
  /**
   * A validator's validations of the last 7 days, newest first, `limit` of them after `marker`. Class `live`; the page asks for `{ ttl: VALIDATIONS_CALL_TTL_SECONDS }`. A page after a marker
   * is old rows: class `slow` and kept `VALIDATIONS_MARKER_TTL_SECONDS` whatever `opts.ttl` says (the failure hold goes on). The query is `?limit=…&marker=…`.
   */
  validatorValidations(key: string, q: { limit: number; marker?: string }, opts?: FreshOptions): Promise<ValidatorValidationsPage>;
  /** Every amendment the network knows, with the rules, the newest round and the next flag ledger (D1's G3). Class `minute`, with no TTL constant of its own. */
  amendments(opts?: FreshOptions): Promise<AmendmentsList>;
  /** One amendment by its name or its 64-digit ID, with the envelope of the list, how the validators vote on it, its rounds and its history. Class `minute`. `amendment not found` is `not_found`. */
  amendment(ref: string, opts?: FreshOptions): Promise<AmendmentDetail>;

  // E5's AMM pool calls (data-api-new `feat/amm-data`, pinned at `c3e2302`). Only a data API that has merged it has the routes (`PENDING_PATHS`): without it each call fails with the
  // missing-route outage (kind `server`, never stored), and the routes' own `pool not found` stays `not_found`. The AMM pages ask only while `AMM_PAGES` is on. Every answer is
  // checked inside the load (amm-shape.ts), and one that is not what the reference promises is kind `server` too. These calls take no `FreshOptions`: the pages do not poll, so
  // none asks for the failure hold, and each is kept for the class its page needs (`ammVolume` keeps the options E2 gave it).
  /**
   * The pools, the most valuable first (the pools without a value last), `limit` of them after `marker`; with `asset`, only those that have it on either side, and with
   * `includeDeleted` the deleted ones too. The query is `?limit=…&asset=…&include_deleted=true&marker=…`. Class `minute`.
   */
  ammPools(q: { limit: number; asset?: Asset; includeDeleted?: boolean; marker?: string }): Promise<Page<"pools", AmmPool>>;
  /**
   * One pool by its account (the `pool` of the answer). A pool created less than a minute ago is `not_found` here: the route is served from the table the aggregator rebuilds.
   * An answer for another pool than the one asked for is kind `server`. Class `minute`.
   */
  ammPool(pool: string): Promise<AmmPool>;
  /** One pool by its pair, the assets in either order: the live pool of the pair, else the one deleted last (the `pool` of the answer). Class `minute`. */
  ammPoolByPair(base: Asset, counter: Asset): Promise<AmmPool>;
  /**
   * The days on which a transaction touched the pool, with the stats of the day and the pool's closing state: those that start within `start` and `end` (`YYYY-MM-DD`; the
   * first day when `start` is left out), at most `limit`, oldest first unless `descending`. Unlike the pool, found as soon as its ledger is committed. Class `slow`, kept
   * `PERIOD_CALL_TTL_SECONDS`, under an entry of its own (the key says `[kept 300 s]`).
   */
  ammPoolDays(pool: string, q: { start?: string; end: string; descending?: boolean; limit: number }): Promise<Page<"days", AmmPoolDay>>;
  /** The swaps against the pool, in the pair as the pool stores it. Class `live`, `MARKER_PAGE_CLASS` for a page behind a marker, newest first (`listClass`). */
  ammSwaps(pool: string, q: ListQuery): Promise<Page<"exchanges", AmmSwap>>;
  /**
   * The creation, deposits, withdrawals, clawbacks and deletion of the pool. Class `live`, `MARKER_PAGE_CLASS` behind a marker, newest first; with `event` (the pool's
   * creation, `{ event: "create", limit: 1 }`: the event never changes) class `slow`, and every row must be that event (an API that ignored the filter is kind `server`).
   */
  ammLiquidity(pool: string, q: ListQuery & { event?: "create" }): Promise<Page<"liquidity", AmmLiquidityEvent>>;
  /** The votes on the pool's trading fee and the bids for its auction slot. Class `live`, `MARKER_PAGE_CLASS` behind a marker, newest first (`listClass`). */
  ammGovernance(pool: string, q: ListQuery): Promise<Page<"governance", AmmGovernanceRow>>;
}

/** Query parameters; `undefined` and `false` are left out (every flag of the API is off unless it says `true`). */
type Query = Record<string, string | number | boolean | undefined>;

/** One path segment, escaped. `.` and `..` would be resolved away by the URL parser and reach another endpoint. */
function segment(name: string, value: string): string {
  if (value === "" || value === "." || value === "..") {
    throw new UpstreamError("bad_request", `${JSON.stringify(value)} is not a valid ${name}`);
  }
  return encodeURIComponent(value);
}

/** The reason an upstream gave for a failure: `message` of the data API's errors, `error` of its 429. */
async function reasonOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { message, error } = body as { message?: unknown; error?: unknown };
      if (typeof message === "string") return clip(message);
      if (typeof error === "string") return clip(error);
    }
  } catch {
    // Not JSON (a proxy's page, no body): the status says enough.
  }
  return undefined;
}

/**
 * The marker of the next page in the `Link` header of a list (`<https://host/v2/...?marker=M>; rel="next"`). The header names
 * the API's own URL, which is never followed or passed on: only a marker that is one is taken out of it.
 */
function nextMarkerOf(link: string | null): string | undefined {
  const next = link === null ? undefined : /<([^>]*)>\s*;\s*rel="?next"?/i.exec(link)?.[1];
  if (next === undefined) return undefined;
  let marker: string | null;
  try {
    marker = new URL(next, "http://api.invalid").searchParams.get("marker");
  } catch {
    return undefined;
  }
  return isMarker(marker) ? marker : undefined;
}

export function createDataApi(net: Network, env: Env, cache: SubrequestCache): DataApi {
  const base = net.dataApiUrl.replace(/\/+$/, "");

  /** Sends the one kind of request the client makes: the key in its header, never redirected. */
  async function send(path: string, accept: string, signal: AbortSignal): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: "GET",
      headers: { "X-API-Key": env.DATA_API_KEY, Accept: accept },
      // A redirect would carry the key to wherever it points; the API never redirects.
      redirect: "manual",
      signal,
    });
  }

  /** Throws the `UpstreamError` of an answer that is not 2xx; `what` says which request it was. */
  async function throwUnlessOk(response: Response, what: string): Promise<void> {
    if (response.status >= 200 && response.status <= 299) return;
    const { status } = response;
    const reason = await reasonOf(response);
    // The API's framework answers a path it has no route for with `Cannot GET …` (an API deployed without the sub-project that adds the route,
    // spec 6.4). That is an outage and not a thing that does not exist: kind `server`, so never a stored 404 page, and held when the call asks.
    // Every other 404, each route's own not-found message included, stays `not_found`. This is the one place that tells the two apart.
    const missingRoute = status === 404 && reason?.startsWith("Cannot GET ") === true;
    const kind = missingRoute ? "server" : status === 404 ? "not_found" : status === 400 ? "bad_request" : status === 429 ? "rate_limited" : "server";
    throw new UpstreamError(kind, `${what} answered ${status}${reason ? `: ${reason}` : ""}${missingRoute ? " (the data API has no such route)" : ""}`, {
      status,
      retryAfter: retryAfterOf(response.headers),
    });
  }

  /** Fetches `path` and returns the JSON body of a 2xx answer; any other answer throws. The call has `timeoutMs` ms, answer included. */
  function fetchJson(path: string, timeoutMs: number = DATA_API_TIMEOUT_MS): Promise<unknown> {
    const what = `data API GET ${path}`;
    return withDeadline(timeoutMs, what, async (signal) => {
      const response = await send(path, "application/json", signal);
      await throwUnlessOk(response, what);

      try {
        return (await response.json()) as unknown;
      } catch (cause) {
        throw new UpstreamError("server", `${what} answered something that is not JSON`, {
          status: response.status,
          cause,
        });
      }
    });
  }

  /**
   * One cached GET. `template` is a value of `PATHS` or of `PENDING_PATHS`, `params` fill its `{name}`s. With `unwrap`, the part
   * of the answer under that key is what is returned (and cached), otherwise the whole answer. `finish` shapes (or checks) what
   * is returned, the unwrapped part or the whole answer, before it is cached; it is given the request's path and query too, for a check
   * to name the request in its message. `ttl`, `holdFailure` and `shareInFlight` are the cache's options (cache-class.ts): `ttl` is part of the
   * key, the other two are not. `timeoutMs` is how long the request may take, answer included: `DATA_API_TIMEOUT_MS` unless given (it is no
   * part of the key: a call that is given longer is the same call).
   */
  async function get<T>(
    template: Template,
    params: Record<string, string>,
    query: Query,
    cls: CacheClass,
    { unwrap, finish, ttl, holdFailure, shareInFlight, timeoutMs }: { unwrap?: string; finish?: (value: T, path: string) => T; ttl?: number; timeoutMs?: number } & SubrequestOptions = {},
  ): Promise<T> {
    const path = template.replace(/\{(\w+)\}/g, (_match, name: string) => segment(name, params[name] ?? ""));
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== false) search.set(key, String(value));
    }
    const queryString = search.toString();
    const url = queryString ? `${path}?${queryString}` : path;

    // An answer kept for a TTL of the caller's own is not the one another caller reads, which may have been kept longer.
    const key = ttl === undefined ? `GET ${base}${url}` : `GET ${base}${url} [kept ${ttl} s]`;
    return cache.json(
      key,
      cls,
      async () => {
        const body = await fetchJson(url, timeoutMs);
        if (unwrap === undefined) return finish ? finish(body as T, url) : (body as T);
        const part = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[unwrap] : undefined;
        if (part === undefined || part === null) {
          throw new UpstreamError("server", `data API GET ${url} answered without "${unwrap}"`, { status: 200 });
        }
        return finish ? finish(part as T, url) : (part as T);
      },
      ttl,
      { holdFailure, shareInFlight },
    );
  }

  /**
   * Fetches a CSV page. The deadline holds until the answer starts (its status and headers), not for the body, which the caller
   * streams on: a body that stalls is the runtime's to cut, and the visitor sees a CSV that ends early.
   */
  function fetchCsv(path: string): Promise<CsvPage> {
    const what = `data API GET ${path}`;
    return withDeadline(DATA_API_TIMEOUT_MS, what, async (signal) => {
      const response = await send(path, "text/csv", signal);
      await throwUnlessOk(response, what);

      if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/csv")) {
        void response.body?.cancel();
        throw new UpstreamError("server", `${what} answered something that is not CSV`, { status: response.status });
      }
      const body = response.body ?? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
      const nextMarker = nextMarkerOf(response.headers.get("Link"));
      return nextMarker === undefined ? { body } : { body, nextMarker };
    });
  }

  /** A volume's query in the order of `VolumeQuery`, with the API's names for the display currency. */
  const volumeQuery = (q: VolumeQuery): Query => ({
    interval: q.interval,
    start: q.start,
    end: q.end,
    limit: q.limit,
    exchange_currency: q.exchangeCurrency,
    exchange_issuer: q.exchangeIssuer,
  });
  const listQuery = (q: ListQuery): Query => ({
    descending: q.descending,
    limit: q.limit,
    marker: q.marker || undefined,
  });
  /**
   * A page reached with a marker is stable under new data only when the list runs newest first: then it is the
   * history before the marker. An oldest-first list grows at the end. Even so it is only `MARKER_PAGE_CLASS`, which is not
   * `immutable` while the index can still be backfilled (see there).
   */
  const listClass = (q: ListQuery): CacheClass => (q.marker && q.descending ? MARKER_PAGE_CLASS : "live");

  /**
   * The API adds `transactions` to an expanded ledger only when the ledger has some, unless `transactions=true` is
   * sent too, which makes the key always there (`[]` for none). So `expand` always goes with `transactions=true`,
   * and an expanded ledger has a list even if the answer, against the reference, left the key out.
   *
   * The hashes of a ledger (`transactions` without `expand`) are not defaulted: a list that is not there is not an empty ledger, and
   * a page that took it for one would have every transaction of the ledger fail (and the answer would be stored for a year). The
   * list must be a list of hashes, or the answer is a failure (`checkLedgerHashes`) and nothing is stored.
   */
  const ledger = (id: string, opts?: { expand?: boolean; transactions?: boolean; holdFailure?: boolean }) => {
    const withTransactions = Boolean(opts?.expand || opts?.transactions);
    const hashesOnly = Boolean(opts?.transactions && !opts.expand);
    return get<Ledger>(PATHS.ledger, { ledger_param: id }, { expand: opts?.expand, transactions: withTransactions }, "immutable", {
      unwrap: "ledger",
      finish: hashesOnly
        ? (found) => {
            checkLedgerHashes(found);
            return found;
          }
        : withTransactions
          ? (found) => ({ ...found, transactions: found.transactions ?? [] })
          : undefined,
      holdFailure: opts?.holdFailure,
    });
  };

  /** The two path parameters of a pair route: each asset as the API writes it, `CUR+issuer` or the native code, escaped by `get` like any segment. */
  const pairOf = (base: Asset, counter: Asset) => ({ base: apiAssetText(base), counter: apiAssetText(counter) });

  /** The options of a call that takes `FreshOptions`, as `get` takes them. */
  const fresh = (opts?: FreshOptions) => ({ ttl: opts?.ttl, holdFailure: opts?.holdFailure });

  /** What every account analytics call asks of the cache (spec 2.7): its failure held a few seconds, and its load shared with the same load in flight. */
  const analyticsOptions = { holdFailure: true, shareInFlight: true } as const;

  return {
    // The home page follows the chain and asks for these three at `HOME_CALL_TTL_SECONDS` (`opts.ttl`); the ledger page (its Next at the
    // newest ledger) and the image route read `lastValidated` at its class, 5 s, and are not asked to be any fresher.
    lastValidated: (opts) => get<LastValidated>(PATHS.lastValidated, {}, {}, "live", fresh(opts)),
    // The overloads of the interface narrow `transactions` by the options; the answer is the same either way.
    ledger: ledger as DataApi["ledger"],
    // What the pages read of a transaction is checked inside the load, so that an answer that is not one is a failure and not stored.
    transaction: (hash) =>
      get<TxObject>(PATHS.transaction, { tx_hash: hash }, {}, "immutable", {
        unwrap: "transaction",
        finish: (found) => {
          checkIndexTransaction(found, hash);
          return found;
        },
      }),
    transactionBinary: (hash) =>
      get<TxBinary | TxStoredJson>(PATHS.transaction, { tx_hash: hash }, { binary: true }, "immutable", {
        unwrap: "transaction",
        finish: (found) => {
          checkBinaryAnswer(found, hash);
          return found;
        },
      }),
    // The TTL is for a first page only: a list reached with a marker, in either direction, is the class it has.
    transactions: (q, opts) => get(PATHS.transactions, {}, listQuery(q), listClass(q), { ttl: q.marker ? undefined : opts?.ttl, holdFailure: opts?.holdFailure }),
    account: (address) => get<AccountData>(PATHS.account, { address }, {}, "slow", { unwrap: "account_data" }),
    balances: (address) => get(PATHS.balances, { address }, {}, "live"),
    orders: (address) => get(PATHS.orders, { address }, {}, "live"),
    accountTransactions: (address, q) => get(PATHS.accountTransactions, { address }, listQuery(q), listClass(q)),
    accountPayments: (address, q) => get(PATHS.accountPayments, { address }, listQuery(q), listClass(q)),
    accountExchanges: (address, q) => get(PATHS.accountExchanges, { address }, listQuery(q), listClass(q)),
    accountPaymentsCsv: async (address, q) => {
      const path = PATHS.accountPayments.replace("{address}", segment("address", address));
      const search = new URLSearchParams({ descending: "true", format: "csv", limit: String(CSV_PAGE_LIMIT) });
      if (q.marker) search.set("marker", q.marker);
      return fetchCsv(`${path}?${search}`);
    },
    // The ledgers of the list (`interval` left out) are `live`, the days of the fee chart `slow`: the overloads tell them apart by `interval`.
    fees: ((q: { descending: boolean; limit: number } | FeeBucketQuery, opts?: FreshOptions) =>
      "interval" in q
        ? get<Page<"rows", FeeBucketRow>>(PATHS.fees, {}, { interval: q.interval, start: q.start, end: q.end, limit: q.limit }, "slow", {
            ...fresh(opts),
            finish: checkFeeBucketPage,
          })
        : get(PATHS.fees, {}, { descending: q.descending, limit: q.limit }, "live", fresh(opts))) as DataApi["fees"],
    feeStats: (q, opts) =>
      get<Page<"rows", FeeStatsRow>>(PATHS.feeStats, {}, { descending: q.descending, limit: q.limit, start: q.start }, "live", {
        ...fresh(opts),
        finish: checkFeeStatsPage,
      }),
    stats: (family, q, opts) =>
      get<Page<"stats", StatsRow>>(
        PATHS.stats,
        { family },
        { interval: q.interval, start: q.start, end: q.end, limit: q.limit, metrics: q.metrics?.length ? q.metrics.join(",") : undefined },
        "slow",
        { ...fresh(opts), finish: checkStatsPage },
      ),
    paymentVolume: (q, opts) =>
      get<Page<"rows", VolumeRow<PaymentVolumeComponent>>>(PATHS.paymentVolume, {}, volumeQuery(q), "slow", {
        ...fresh(opts),
        finish: (page) => checkVolumePage("payment", page),
      }),
    exchangeVolume: (q, opts) =>
      get<Page<"rows", VolumeRow<ExchangeVolumeComponent>>>(PATHS.exchangeVolume, {}, volumeQuery(q), "slow", {
        ...fresh(opts),
        finish: (page) => checkVolumePage("exchange", page),
      }),
    // The live form is the AMM pages' (`live=day`, no window): a minute, and exactly one row. The historical form is the network page's, and keeps its class, key and answer.
    ammVolume: (q, opts) =>
      "live" in q
        ? get<Page<"rows", AmmVolumeRow>>(PENDING_PATHS.ammVolume, {}, { live: q.live }, "minute", { ...fresh(opts), finish: checkLiveVolume })
        : get<Page<"rows", AmmVolumeRow>>(PENDING_PATHS.ammVolume, {}, volumeQuery(q), "slow", {
            ...fresh(opts),
            finish: (page) => checkVolumePage("amm", page),
          }),
    ledgerValidations: (hash, q, opts) =>
      get<LedgerValidations>(PATHS.ledgerValidations, { ledger_hash: hash }, { limit: q.limit }, "live", { ...fresh(opts), finish: checkValidations }),
    // The pair page's calls. The pair is the one in the URL's orientation (the API inverts when it is not the stored one); `amm` goes last in every query.
    pairExchanges: (base, counter, q, opts) =>
      get<Page<"exchanges", PairExchange>>(PATHS.pairExchanges, pairOf(base, counter), { ...listQuery(q), amm: q.amm }, listClass(q), {
        ttl: q.marker ? undefined : opts?.ttl,
        holdFailure: opts?.holdFailure,
        finish: checkPairExchanges,
      }),
    pairCandles: (base, counter, q, opts) =>
      get<Page<"exchanges", Candle>>(
        PATHS.pairExchanges,
        pairOf(base, counter),
        { interval: q.interval, start: q.start, end: q.end, limit: q.limit, descending: q.descending, amm: q.amm },
        opts?.cls ?? "live",
        { ttl: opts?.ttl, holdFailure: opts?.holdFailure, finish: checkCandles },
      ),
    pairReduce: async (base, counter, q, opts) => {
      const page = await get<Page<"exchanges", ReducedRow>>(PATHS.pairExchanges, pairOf(base, counter), { reduce: true, start: q.start, amm: q.amm }, "live", {
        ...fresh(opts),
        finish: checkReduce,
      });
      const [row] = page.exchanges;
      // Unreachable: checkReduce admits exactly one row. Kept so that the return needs no assertion, and still holds if `noUncheckedIndexedAccess` is ever turned on.
      if (row === undefined) throw new UpstreamError("server", "data API reduced exchanges answered without a row", { status: 200 });
      return row;
    },
    activeAccounts: (base, counter, opts) =>
      get<ActiveAccounts>(PATHS.activeAccounts, pairOf(base, counter), {}, "minute", {
        ...fresh(opts),
        // All are checked, then the first ten kept: what is cached is what the page can show.
        finish: (body) => {
          const checked = checkActiveAccounts(body);
          return { ...checked, accounts: checked.accounts.slice(0, ACTIVE_ACCOUNTS_KEPT) };
        },
      }),
    networkMarkets: (q, opts) =>
      get<MarketsResponse>(PENDING_PATHS.networkMarkets, {}, { limit: q.limit, period: q.period, amm: q.amm }, "minute", {
        ...fresh(opts),
        finish: (body) => checkMarkets(body, q.amm),
      }),
    // The Analytics tab's calls: a minute, held on failure, shared in flight, and each answer checked inside the load.
    accountStats: ((address: string, family: "value" | "transactions", q: AnalyticsQuery) =>
      get<Page<"rows", AccountValueRow> | Page<"rows", AccountTxStatsRow>>(
        PATHS.accountStats,
        { address, family },
        { interval: q.interval, limit: q.limit, start: q.start },
        "minute",
        { ...analyticsOptions, finish: (body) => checkAccountStats(body, family, q.interval, `data API account ${family} stats`) },
      )) as DataApi["accountStats"],
    analyticsBalances: (address, q) =>
      get<AnalyticsBalances>(PENDING_PATHS.analyticsBalances, { address }, { interval: q.interval, limit: q.limit, start: q.start }, "minute", {
        ...analyticsOptions,
        finish: (body) => checkAnalyticsBalances(body, q.interval, "data API analytics balances"),
      }),
    analyticsBalanceChanges: (address, q) =>
      get<AnalyticsBalanceChanges>(PENDING_PATHS.analyticsBalanceChanges, { address }, { interval: q.interval, start: q.start }, "minute", {
        ...analyticsOptions,
        finish: (body) => checkBalanceChanges(body, q.interval, "data API analytics balance changes"),
      }),
    analyticsCounterparties: (address, q) =>
      get<AnalyticsCounterparties>(PENDING_PATHS.analyticsCounterparties, { address }, { limit: q.limit, start: q.start }, "minute", {
        ...analyticsOptions,
        // The slow one (D2 sections 9 and 13); the other calls keep the 5 s.
        timeoutMs: ANALYTICS_SLOW_TIMEOUT_MS,
        finish: (body) => checkCounterparties(body, "data API analytics counterparties"),
      }),
    analyticsExchanges: (address, q) =>
      get<AnalyticsExchanges>(PENDING_PATHS.analyticsExchanges, { address }, { limit: q.limit, start: q.start }, "minute", {
        ...analyticsOptions,
        finish: (body) => checkAnalyticsExchanges(body, "data API analytics exchanges"),
      }),
    // D1's six calls. A query is written in the order `limit`, `marker`, `scope`. A validator is addressed by `key` and an amendment by `name`, as D1's openapi.yaml names them.
    validatorsSummary: (opts) => get<ValidatorsSummary>(PENDING_PATHS.validatorsSummary, {}, {}, "live", { ...fresh(opts), finish: checkValidatorsSummary }),
    validators: (q, opts) => get<ValidatorsList>(PENDING_PATHS.validators, {}, { limit: q.limit, scope: q.scope }, "live", { ...fresh(opts), finish: checkValidatorsList }),
    validator: (key, opts) => get<ValidatorDetail>(PENDING_PATHS.validator, { key }, {}, "live", { ...fresh(opts), finish: checkValidatorDetail }),
    validatorValidations: (key, q, opts) =>
      get<ValidatorValidationsPage>(PENDING_PATHS.validatorValidations, { key }, { limit: q.limit, marker: q.marker || undefined }, q.marker ? "slow" : "live", {
        // A page after a marker is old rows, read from a call kept as long as D1 says (`max-age=300`): the caller's TTL (the newest rows') does not apply to it.
        ttl: q.marker ? VALIDATIONS_MARKER_TTL_SECONDS : opts?.ttl,
        holdFailure: opts?.holdFailure,
        finish: checkValidatorValidations,
      }),
    amendments: (opts) => get<AmendmentsList>(PENDING_PATHS.amendments, {}, {}, "minute", { ...fresh(opts), finish: checkAmendments }),
    amendment: (ref, opts) => get<AmendmentDetail>(PENDING_PATHS.amendment, { name: ref }, {}, "minute", { ...fresh(opts), finish: checkAmendmentDetail }),
    // E5's AMM pool calls. A pool is the `pool` of its answer; a pair is in the exchanges' path form, in the order asked.
    ammPools: (q) =>
      get<Page<"pools", AmmPool>>(
        PENDING_PATHS.ammPools,
        {},
        { limit: q.limit, asset: q.asset === undefined ? undefined : apiAssetText(q.asset), include_deleted: q.includeDeleted, marker: q.marker || undefined },
        "minute",
        { finish: checkPoolsPage },
      ),
    ammPool: (pool) => get<AmmPool>(PENDING_PATHS.ammPool, { pool }, {}, "minute", { unwrap: "pool", finish: (found) => checkPool(found, pool) }),
    ammPoolByPair: (base, counter) => get<AmmPool>(PENDING_PATHS.ammPoolByPair, pairOf(base, counter), {}, "minute", { unwrap: "pool", finish: (found) => checkPool(found) }),
    ammPoolDays: (pool, q) =>
      get<Page<"days", AmmPoolDay>>(
        PENDING_PATHS.ammPoolHistory,
        { pool },
        { interval: "day", start: q.start, end: q.end, descending: q.descending, limit: q.limit },
        "slow",
        { ttl: PERIOD_CALL_TTL_SECONDS, finish: checkDaysPage },
      ),
    ammSwaps: (pool, q) => get<Page<"exchanges", AmmSwap>>(PENDING_PATHS.ammPoolSwaps, { pool }, listQuery(q), listClass(q), { finish: checkSwapsPage }),
    // The create event is the pool's first and never changes: `slow` whatever the page. `event` goes first (`liquidity?event=create&limit=1`).
    ammLiquidity: (pool, q) =>
      get<Page<"liquidity", AmmLiquidityEvent>>(PENDING_PATHS.ammPoolLiquidity, { pool }, { event: q.event, ...listQuery(q) }, q.event ? "slow" : listClass(q), {
        finish: (page) => checkLiquidityPage(page, q.event),
      }),
    ammGovernance: (pool, q) =>
      get<Page<"governance", AmmGovernanceRow>>(PENDING_PATHS.ammPoolGovernance, { pool }, listQuery(q), listClass(q), { finish: checkGovernancePage }),
  };
}
