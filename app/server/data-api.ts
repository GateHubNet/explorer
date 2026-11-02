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
  AccountNamesResponse,
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
  CheckAnswer,
  CollectionKey,
  DelegationsPage,
  EscrowAnswer,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeRow,
  FeeStatsRow,
  LastValidated,
  Ledger,
  LedgerExpanded,
  LedgerObjectRef,
  LedgerValidations,
  LedgerWithHashes,
  MarketsResponse,
  MintedPage,
  MptHoldersPage,
  MptIssuanceAnswer,
  MptLookup,
  MptTokensPage,
  MptTransfersPage,
  NetworkSupply,
  NftAnswer,
  NftCollectionAnswer,
  NftCollectionDays,
  NftCollectionsPage,
  NftEventKind,
  NftEventsPage,
  NftHoldersPage,
  NftOffersPage,
  NftPeriod,
  NftSalesPage,
  NftsPage,
  NftSort,
  NftVolume,
  ObjectHistoryPage,
  OrdersResponse,
  Page,
  PairExchange,
  Payment,
  PaymentChannelAnswer,
  PaymentVolumeComponent,
  ReducedRow,
  StatsRow,
  TokenAnswer,
  TokenHoldersResponse,
  TokensResponse,
  TokenTransfersResponse,
  TomlAnswer,
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
import { checkAccountNames, checkToml } from "./names-shape";
import { checkMptHoldersPage, checkMptIssuance, checkMptLookup, checkMptTokens, checkMptTransfersPage } from "./mpt-shape";
import type { Network } from "./networks";
import {
  checkCollection,
  checkCollectionDays,
  checkCollectionsPage,
  checkHoldersPage,
  checkNft,
  checkNftEventsPage,
  checkNftOffersPage,
  checkNftSalesPage,
  checkNftsPage,
  checkNftVolume,
} from "./nft-shape";
import { checkDelegations, checkLedgerObject, checkObjectAnswer, checkObjectHistory } from "./object-shape";
import type { paths } from "./openapi";
import { PENDING_PATHS } from "./pending-paths";
import { checkMintedPage, checkSupply } from "./supply-shape";
import { checkToken, checkTokenHolders, checkTokens, checkTokenTransfers } from "./token-shape";
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
  // The routes of D1, D2, the AMM data and D2b, which were in PENDING_PATHS until `pnpm api:sync` brought them in with data-api-new `main` 9dbbd8a. A deployed data
  // API that has not merged them answers `Cannot GET`, which the client reads as an outage (`throwUnlessOk`), never as a missing validator, amendment or pool.
  /** The volume of the swaps against AMM pools. The network page asks for it only while `AMM_DATA` is on. */
  ammVolume: "/v2/network/amm_volume",
  /** The trade statistics of every pair that traded in a live period, in one call: the markets page's table (D2). */
  networkMarkets: "/v2/network/markets",
  /** The four analytics routes of an account (D2), which the account page's Analytics tab asks for while `ACCOUNT_ANALYTICS` is on. */
  analyticsBalances: "/v2/accounts/{address}/analytics/balances",
  analyticsBalanceChanges: "/v2/accounts/{address}/analytics/balance_changes",
  analyticsCounterparties: "/v2/accounts/{address}/analytics/counterparties",
  analyticsExchanges: "/v2/accounts/{address}/analytics/exchanges",
  /** D1's six routes, validators and amendments; the path parameters are `key` and `name`. */
  validatorsSummary: "/v2/network/validators/summary",
  validators: "/v2/network/validators",
  validator: "/v2/network/validators/{key}",
  validatorValidations: "/v2/network/validators/{key}/validations",
  amendments: "/v2/network/amendments",
  amendment: "/v2/network/amendments/{name}",
  /** The AMM pool routes, which the AMM pages (E5) ask for only while `AMM_PAGES` is on; the pool is `{pool}`, the pair `{base}/{counter}`. */
  ammPools: "/v2/amm/pools",
  ammPool: "/v2/amm/pools/{pool}",
  ammPoolByPair: "/v2/amm/pools/{base}/{counter}",
  ammPoolHistory: "/v2/amm/pools/{pool}/history",
  ammPoolSwaps: "/v2/amm/pools/{pool}/swaps",
  ammPoolLiquidity: "/v2/amm/pools/{pool}/liquidity",
  ammPoolGovernance: "/v2/amm/pools/{pool}/governance",
  // D3's NFT routes (data-api-new `feat/explorer-data-2`, pinned at `da5ce14`), which the NFT pages (E8) ask for only while `NFTS` is on. A collection is `/{issuer}/{taxon}` on
  // XRPL and `/{issuer}` on Xahau, on each of its routes (`COLLECTION_ROUTES`). Not the account's `/nft_history`, which no page shows.
  /** The NFT sales volume per collection, in the native currency; the live periods and the days. */
  nftVolume: "/v2/network/nft_volume",
  nftSales: "/v2/nft_sales",
  nftCollections: "/v2/nft_collections",
  nftCollectionOfIssuer: "/v2/nft_collections/{issuer}",
  nftCollectionOfTaxon: "/v2/nft_collections/{issuer}/{taxon}",
  nftCollectionNftsOfIssuer: "/v2/nft_collections/{issuer}/nfts",
  nftCollectionNftsOfTaxon: "/v2/nft_collections/{issuer}/{taxon}/nfts",
  nftCollectionHoldersOfIssuer: "/v2/nft_collections/{issuer}/holders",
  nftCollectionHoldersOfTaxon: "/v2/nft_collections/{issuer}/{taxon}/holders",
  nftCollectionSalesOfIssuer: "/v2/nft_collections/{issuer}/sales",
  nftCollectionSalesOfTaxon: "/v2/nft_collections/{issuer}/{taxon}/sales",
  nftCollectionStatsOfIssuer: "/v2/nft_collections/{issuer}/stats",
  nftCollectionStatsOfTaxon: "/v2/nft_collections/{issuer}/{taxon}/stats",
  nft: "/v2/nfts/{nft_id}",
  nftHistory: "/v2/nfts/{nft_id}/history",
  nftOffers: "/v2/nfts/{nft_id}/offers",
  accountNfts: "/v2/accounts/{address}/nfts",
  // D4's two routes (data-api-new `feat/explorer-data-2`, pinned at `3feb11a`), which the display names (E9) ask for only while `NAMES` is on. A data API deployed without D4
  // answers `Cannot GET`, an outage.
  /** The display names of 1 to 100 addresses, `?addresses=a,b,…`. */
  accountNames: "/v2/account_names",
  /** What the toml of a domain says, as D4's `tomls` worker last stored it; the domain is a well-formed lower-case one. */
  toml: "/v2/toml/{domain}",
  // D5's eight routes (data-api-new `feat/explorer-data-2`, pinned at `0c2e58c`), which the ledger-object pages (E10) ask for only while `LEDGER_OBJECTS` (and, for the delegations,
  // `DELEGATION`) is on. The path parameters are the ones of its openapi.yaml: `escrow_id`, `check_id`, `channel_id`, `object_id` and `address`. A data API deployed without D5 answers
  // `Cannot GET`, an outage. (Not `/v2/accounts/{address}/escrows/{sequence}`: E10 works the escrow's ID out itself and redirects to it.)
  escrow: "/v2/escrows/{escrow_id}",
  escrowHistory: "/v2/escrows/{escrow_id}/history",
  check: "/v2/checks/{check_id}",
  checkHistory: "/v2/checks/{check_id}/history",
  paymentChannel: "/v2/payment_channels/{channel_id}",
  paymentChannelHistory: "/v2/payment_channels/{channel_id}/history",
  accountDelegations: "/v2/accounts/{address}/delegations",
  ledgerObject: "/v2/ledger_objects/{object_id}",
  // D6's four routes (data-api `feat/explorer-data-2`, pinned at `2fb4183721af6df58dd345f4a6ef90a293ae70b0`), which the token pages (E11) ask for only while `TOKENS` is on. The token is one
  // segment, `{currency}.{issuer}` (the path parameter is `token`). A data API deployed without D6 answers `Cannot GET`, an outage.
  /** The issued tokens ranked by holders, `?kind=issued&limit=…`. */
  tokens: "/v2/tokens",
  token: "/v2/tokens/{token}",
  tokenHolders: "/v2/tokens/{token}/holders",
  tokenTransfers: "/v2/tokens/{token}/transfers",
  // D7's two routes (data-api `feat/explorer-data-2`, pinned at `31e97efaa1a6e098435b666e8893c79a0c4bee66`), which the supply page (E12) asks for only while `SUPPLY` is on. Neither takes a path
  // parameter. A data API deployed without D7 answers `Cannot GET`, an outage.
  /** The native supply at one ledger, an hourly snapshot. Takes no parameter. */
  networkSupply: "/v2/network/supply",
  /** Xahau's minting per UTC day. */
  networkMinted: "/v2/network/supply/minted",
  // D9's four MPT routes (data-api `feat/explorer-data-2`, pinned at `c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30`), which the MPT pages (E14) ask for only while `MPT` is on. The issuance is
  // `{issuanceId}`, 48 hex digits. A data API deployed without D9 answers `Cannot GET`, an outage. (Not `/v2/accounts/{address}/mpt`, which no page asks for: the account page reads
  // the node's `account_objects`.) `GET /v2/tokens?kind=mpt` is `tokens` above.
  /** One issuance, as of the last run of D9's `mpt_state` job. */
  mpt: "/v2/mpt/{issuanceId}",
  mptHolders: "/v2/mpt/{issuanceId}/holders",
  mptTransfers: "/v2/mpt/{issuanceId}/transfers",
  /** The summary of 1 to 100 issuances, `?ids=a,b,…`. Takes no path parameter. */
  mptLookup: "/v2/mpt",
} as const satisfies Record<string, keyof paths>;

/** The two forms of each route of a collection: of an issuer alone (Xahau) and of an issuer and a taxon (XRPL). */
const COLLECTION_ROUTES = {
  collection: { issuer: PATHS.nftCollectionOfIssuer, taxon: PATHS.nftCollectionOfTaxon },
  nfts: { issuer: PATHS.nftCollectionNftsOfIssuer, taxon: PATHS.nftCollectionNftsOfTaxon },
  holders: { issuer: PATHS.nftCollectionHoldersOfIssuer, taxon: PATHS.nftCollectionHoldersOfTaxon },
  sales: { issuer: PATHS.nftCollectionSalesOfIssuer, taxon: PATHS.nftCollectionSalesOfTaxon },
  stats: { issuer: PATHS.nftCollectionStatsOfIssuer, taxon: PATHS.nftCollectionStatsOfTaxon },
} as const;

/** A path of `PATHS` or of `PENDING_PATHS` (the routes `openapi.yaml` does not have yet, which the compiler cannot check). */
type Template = (typeof PATHS)[keyof typeof PATHS] | (typeof PENDING_PATHS)[keyof typeof PENDING_PATHS];

/** Paging of a list: `marker` is the opaque token of the previous page's answer. */
export type ListQuery = { descending?: boolean; limit?: number; marker?: string };

/** A page of older events of an object, newest first: the client asks for no other order, and `marker` is the previous page's. */
export type ObjectHistoryQuery = { descending: true; limit: number; marker?: string };

/** `fees` by the day: a row for each day that starts within `start` and `end` (`YYYY-MM-DD`). Sent in this order. */
export type FeeBucketQuery = { interval: "day"; start: string; end: string; limit: number };
/** The days of `networkMinted`: the same window as the fees by day, written in this order. */
export type MintedQuery = { interval: "day"; start: string; end: string; limit: number };

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
   * The volume of the swaps against AMM pools, one component per pool. Only a data API that has merged `feat/amm-data` has the route: without it the
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
   * narrowing them like the trades'. Only a data API that has D2 (`feat/explorer-data`) has the route: without it the call fails with the
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

  // D1 (data-api-new `feat/explorer-data`, pinned at `7d495ab`): the validators and amendments pages. Only a data API that has merged D1 has the routes:
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

  // E5's AMM pool calls (data-api-new `feat/amm-data`, pinned at `c3e2302`). Only a data API that has merged it has the routes: without it each call fails with the
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

  // E8's NFT calls (data-api-new D3, `feat/explorer-data-2`, pinned at `da5ce14`). Only a data API that has D3 has the routes: without it each call fails with the missing-route
  // outage (kind `server`, never stored), and the routes' own `nft not found` and `collection not found` stay `not_found`. The NFT pages ask only while `NFTS` is on. Every answer is
  // checked inside the load (nft-shape.ts, and its `coverage` with it), and one that is not what the reference promises is kind `server` too. A list reached with a marker, of
  // whichever order, is `MARKER_PAGE_CLASS` (`nftListClass`).
  /**
   * The volume of the NFT sales of the network, one component per collection, in the native currency (`checkNftVolume`).
   *
   * With `{ live: NftPeriod }` (sent as `live=day`, `7day` or `30day`, no `start`, `end` or `interval`), the one row of a rolling period ending now, or none while D3's syncer has
   * not written the period's set (`rows: []`, an answer): class `minute`, and the answer is checked to have no more than one row.
   *
   * With a `VolumeQuery`, per day or week (the network page of the NFT pages asks for days): class `slow`; the page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`.
   */
  nftVolume(q: VolumeQuery | { live: NftPeriod }, opts?: FreshOptions): Promise<NftVolume>;
  /** The sales of the network, oldest first unless `descending`. Class `live`, `MARKER_PAGE_CLASS` behind a marker. */
  nftSales(q: ListQuery): Promise<NftSalesPage>;
  /**
   * The collections by `sort` (default `volume`), the biggest first unless `descending: false` (sent as the text `descending=false`: D3 reads the ascending order from that
   * word alone, and the client leaves a boolean `false` out), `limit` of them after `marker`; with `issuer`, only that issuer's. `total` is how many match, whatever the page.
   * Class `minute`, `MARKER_PAGE_CLASS` behind a marker.
   */
  nftCollections(q: { limit: number; sort?: NftSort; descending?: boolean; issuer?: string; marker?: string }): Promise<NftCollectionsPage>;
  /** One collection. Class `minute`. `collection not found` is `not_found`: no such collection, the other network's form of the path, or one the aggregator has not counted yet. */
  nftCollection(key: CollectionKey): Promise<NftCollectionAnswer>;
  /** The days of a collection that start within `start` and `end` (`YYYY-MM-DD`; D3's window is at most 366 days) on which it had a sale, a mint or a burn. Class `slow`, kept `PERIOD_CALL_TTL_SECONDS`. */
  nftCollectionStats(key: CollectionKey, q: { start: string; end: string }): Promise<NftCollectionDays>;
  /** The sales of the collection's NFTs. Class `live`, `MARKER_PAGE_CLASS` behind a marker. */
  nftCollectionSales(key: CollectionKey, q: ListQuery): Promise<NftSalesPage>;
  /**
   * The NFTs of the collection, by serial, the burned ones left out unless `includeBurned`; with `owner`, only that account's. Every NFT of the answer must be of the
   * collection asked for (`checkNftsPage`). Class `live`, `MARKER_PAGE_CLASS` behind a marker.
   */
  nftCollectionNfts(key: CollectionKey, q: ListQuery & { owner?: string; includeBurned?: boolean }): Promise<NftsPage>;
  /** The accounts that hold NFTs of the collection and how many, the most first. Class `live`, `MARKER_PAGE_CLASS` behind a marker. */
  nftCollectionHolders(key: CollectionKey, q: ListQuery): Promise<NftHoldersPage>;
  /** One NFT or URIToken by its id (any case; the answer's is upper-case), with its own coverage. Class `live`. `nft not found` is `not_found`. */
  nft(id: string): Promise<NftAnswer>;
  /** The open offers of an NFT, newest first. Class `live`, `MARKER_PAGE_CLASS` behind a marker. `nft not found` is `not_found`. */
  nftOffers(id: string, q: { limit: number; marker?: string }): Promise<NftOffersPage>;
  /** The events of an NFT, oldest first unless `descending`; with `event`, only those (sent as one comma list). Class `live`, `MARKER_PAGE_CLASS` behind a marker. */
  nftHistory(id: string, q: ListQuery & { event?: readonly NftEventKind[] }): Promise<NftEventsPage>;
  /** The NFTs an account holds now, by collection and serial. D3 answers an address that holds none, or is none, with an empty page. Class `live`, `MARKER_PAGE_CLASS` behind a marker. */
  accountNfts(address: string, q: ListQuery): Promise<NftsPage>;
  /**
   * The display names of 1 to 100 classic addresses, one entry for each, in the order given (`loadNames` sorts them and keeps a call to 100). Sent as given,
   * `?addresses=a,b,…`. Class `minute`: D4 reloads the names every 60 s and answers `max-age=60`. Checked inside the load by `checkAccountNames` (the count and the list as
   * long as the addresses, each entry the address asked at its place, the shape of a name and of the labels), so that an answer that is not right is a failure of kind
   * `server`, never stored. A polled page asks for `holdFailure`.
   */
  accountNames(addresses: readonly string[], opts?: FreshOptions): Promise<AccountNamesResponse>;
  /**
   * What the toml of a domain says (a well-formed lower-case domain: E9 asks for no other). Class `minute`: D4 changes a toml's row hourly and answers `max-age=60`.
   * `toml not found` (the domain was never checked) is `not_found`; `Cannot GET` (a data API without D4) is `server`. Checked inside the load by `checkToml` (the domain, the
   * status, the lists' shapes).
   */
  toml(domain: string): Promise<TomlAnswer>;

  // E10's object calls (data-api-new D5, `feat/explorer-data-2`, pinned at `0c2e58c`). Only a data API that has D5 has the routes: without it each call fails with the missing-route
  // outage (kind `server`, never stored), and the routes' own `escrow not found`, `check not found`, `payment channel not found` and `ledger object not found` stay `not_found`. The
  // ledger-object pages ask only while `LEDGER_OBJECTS` is on. Every answer is checked inside the load (object-shape.ts, and its `coverage` with it), and one that is not what the
  // reference promises, or is another object's than the ID asked for, is kind `server`, never stored. D5's 400s (`invalid escrow id`, `invalid marker`) are `bad_request`: E10 checks
  // IDs before it asks.
  /** One escrow by its ID (any case; the answer's is upper-case) as of the newest committed ledger, with its newest 50 events, newest first, and its own coverage. Class `live`. */
  escrow(id: string): Promise<EscrowAnswer>;
  /** The events of an escrow, newest first. Class `MARKER_PAGE_CLASS` behind a marker (a page of older events), `live` without one. */
  escrowHistory(id: string, q: ObjectHistoryQuery): Promise<ObjectHistoryPage>;
  /** One check, as `escrow`. Class `live`. */
  check(id: string): Promise<CheckAnswer>;
  /** The events of a check, as `escrowHistory`. */
  checkHistory(id: string, q: ObjectHistoryQuery): Promise<ObjectHistoryPage>;
  /** One payment channel, as `escrow`. Class `live`. */
  paymentChannel(id: string): Promise<PaymentChannelAnswer>;
  /** The events of a payment channel, as `escrowHistory`. */
  paymentChannelHistory(id: string, q: ObjectHistoryQuery): Promise<ObjectHistoryPage>;
  /**
   * The delegations an account gave (`given`) or holds (`held`), the one changed last first, at most `limit` (D5's default is 200 and its maximum 1000). Xahau has none: an empty page
   * with a complete coverage. Class `live`.
   */
  accountDelegations(address: string, q: { direction: "given" | "held"; limit: number }): Promise<DelegationsPage>;
  /** Which kind of object an ID is, who owns it and whether it is deleted (the part under `ledger_object`; `ledger object not found` is `not_found`). Class `live`. */
  ledgerObject(id: string): Promise<LedgerObjectRef>;

  // E11's token calls (data-api D6, `feat/explorer-data-2`, pinned at `2fb4183721af6df58dd345f4a6ef90a293ae70b0`). Only a data API that has D6 has the routes: without it each call fails with the
  // missing-route outage (kind `server`, never stored), and the routes' own `token not found` stays `not_found`. The token pages ask only while `TOKENS` is on. Every answer is checked inside the
  // load (token-shape.ts, and its `coverage` with it), and one that is not what the reference promises, or is another token's than the one asked for, is kind `server` too. A token is a currency as
  // the ledger holds it (3 characters, or 40 upper-case hex digits) and its issuer; the path segment is `{currency}.{issuer}`.
  /**
   * The issued tokens, the most held first: `limit` of them after `marker`; with `minHolders` (D6 reads 0 to 1,000,000,000) only those with at least that many holders, with `q` (1 to 64 characters: an
   * issuer address, or text in the code, name or domain, a currency in hex, an issuer prefix) only those it matches. Sent as `kind`, `limit`, `marker`, `min_holders`, `q`. Class `minute`, whatever the
   * page: D6 rebuilds the ranking each minute, so a marker is a cursor into this minute's. This overload takes `kind: "issued"` (answered as `TokensResponse`, checked as issued tokens);
   * `kind: "mpt"` is the next one's (E14's, answered as `MptTokensPage`), and the kind of the query decides which.
   */
  tokens(q: IssuedTokensQuery, opts?: FreshOptions): Promise<TokensResponse>;
  /**
   * The MPT issuances, the most held first (E14's tab; D9's `kind=mpt`, "additive to D6"): `limit` of them after `marker`; with `q` (1 to 64 characters: an issuer address, an issuance ID, text in the
   * ticker or name, an issuer prefix, an ID prefix of 8 hex digits or more) only those it matches. Sent as `kind`, `limit`, `marker`, `q`, and no `min_holders`. Class `minute`, as the issued list: the
   * ranking is rebuilt each minute. The answer is checked as an MPT list (`checkMptTokens`), so a body of issued tokens is kind `server`.
   */
  tokens(q: MptTokensQuery, opts?: FreshOptions): Promise<MptTokensPage>;
  /** One token, with its toml, its issuer's settings and its markets: the whole answer, which must be of the token asked for. Class `minute`. `token not found` is `not_found`. */
  token(asset: { currency: string; issuer: string }, opts?: FreshOptions): Promise<TokenAnswer>;
  /** The holders of a token, the largest balance first. Class `minute`, whatever the page. `token not found` is `not_found`. */
  tokenHolders(asset: { currency: string; issuer: string }, q: { limit: number; marker?: string }, opts?: FreshOptions): Promise<TokenHoldersResponse>;
  /**
   * The payments that delivered the token, newest first (sent as `descending=true`, `limit`, `marker`). Class `live`, `MARKER_PAGE_CLASS` behind a marker (`listClass`: it is newest first); the TTL is for
   * a first page only. D6 does not look the token up: a token nobody was paid in has no transfers, which is an answer, and there is no 404.
   */
  tokenTransfers(asset: { currency: string; issuer: string }, q: { limit: number; marker?: string }, opts?: FreshOptions): Promise<TokenTransfersResponse>;

  // E12's supply calls (data-api D7, `feat/explorer-data-2`, pinned at `31e97efaa1a6e098435b666e8893c79a0c4bee66`). Only a data API that has D7 has the routes: without it each call fails with the
  // missing-route outage (kind `server`, never stored). The supply page asks only while `SUPPLY` is on. Each answer is checked inside the load (supply-shape.ts), and one that is not what the
  // reference promises is kind `server` too.
  /**
   * The native supply of the network at one ledger: the newest hourly snapshot, every figure as of `ledger_index`, with the `coverage` of each part read from the history. Takes no parameter. Class
   * `slow`; the supply page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`. Before the first snapshot exists D7 answers 404 `supply not computed yet` (`not_found`; the page tells it as an outage), and a
   * snapshot of another currency than the network's native one is kind `server`.
   */
  networkSupply(opts?: FreshOptions): Promise<NetworkSupply>;
  /**
   * What was minted on each UTC day, by source: `limit` days from `start` to `end` (`YYYY-MM-DD`), with the coverage of the mints. Xahau mints; the XRP Ledger answers an empty list. Class `slow`;
   * the supply page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`.
   */
  networkMinted(q: MintedQuery, opts?: FreshOptions): Promise<MintedPage>;

  // E14's MPT calls (data-api D9, `feat/explorer-data-2`, pinned at `c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30`). Only a data API that has D9 has the routes: without it each call fails with the missing-route
  // outage (kind `server`, never stored), and a route's own `issuance not found` (every ID on a network without MPT too) stays `not_found`. The MPT pages ask only while `MPT` is on. Every answer is checked
  // inside the load (mpt-shape.ts, and its `coverage` with it), and one that is not what the reference promises is kind `server` too. An issuance ID is 48 upper-case hex digits (the pages have checked and
  // upper-cased it before any call); no call asks for the failure hold, as no MPT page polls.
  /** One issuance, with its metadata as D9 decoded it. The answer must be the issuance asked for, by the text of `id` (a lower-case ID is refused as another's). Class `minute`. `issuance not found` is `not_found`. */
  mpt(id: string): Promise<MptIssuanceAnswer>;
  /**
   * The holders of an issuance, the largest balance first (`amount` and `escrowed_amount` together). Class `minute`, `MARKER_PAGE_CLASS` behind a marker (a list that is not newest first is not stable, but is
   * rarely asked for again: `nftListClass`). `issuance not found` is `not_found`.
   */
  mptHolders(id: string, q: { limit: number; marker?: string }): Promise<MptHoldersPage>;
  /** The transfers of an issuance, newest first (sent as `descending=true`, `limit`, `marker`). Class `minute`, `MARKER_PAGE_CLASS` behind a marker. `issuance not found` is `not_found`. */
  mptTransfers(id: string, q: { descending: true; limit: number; marker?: string }): Promise<MptTransfersPage>;
  /**
   * A summary of each of the issuances (D9: 1 to 100), `?ids=` the IDs sorted and without duplicates, so that the key of a page's lookup is the same whatever order its amounts came in; an ID the index
   * has no state for is answered as the ID alone (`checkMptLookup`: one entry for each ID, in order). Each ID is upper-cased first (so `ids` and the answer are the upper-case IDs, whatever case the
   * caller had), and the pages upper-case theirs before any call anyway. Class `slow`. A `RangeError`, with no request, for an ID that is not 48 hex digits (one stray ID would fail the whole lookup), for
   * none and for more than 100 distinct IDs: the caller keeps to the first 100 (the page's rule) and to a page that has one.
   */
  mptLookup(ids: readonly string[]): Promise<MptLookup>;
}

/** What `tokens` takes for the issued list (D6). */
type IssuedTokensQuery = { kind: "issued"; limit: number; minHolders?: number; q?: string; marker?: string };
/** What `tokens` takes for the MPT list (D9). */
type MptTokensQuery = { kind: "mpt"; limit: number; q?: string; marker?: string };

/** How many issuances one lookup may ask for: D9's limit. */
export const MPT_LOOKUP_MAX = 100;
/** An issuance ID, in either case: D9 upper-cases the IDs of a lookup and answers each as it has it, so the client does that first (and `checkMptLookup` compares the upper-case text). */
const MPT_LOOKUP_ID = /^[0-9A-Fa-f]{48}$/;

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
   * The class of an NFT list: `MARKER_PAGE_CLASS` behind a marker, whichever way the list runs (`first` otherwise), unlike `listClass`, which has it for a newest-first list only.
   * A page behind a marker is not stable: the collections are re-sorted every few minutes, and the last page of an oldest-first list grows. It is `MARKER_PAGE_CLASS` all the
   * same because it is rarely asked for again, and what a visitor sees of it a little late (an hour at most) costs nothing: it is cheap to serve stale.
   */
  const nftListClass = (q: { marker?: string }, first: CacheClass = "live"): CacheClass => (q.marker ? MARKER_PAGE_CLASS : first);

  /** The path of one of a collection's routes, and its parameters: `/{issuer}/{taxon}` when the key has a taxon (a taxon of 0 included), else `/{issuer}`. */
  const collectionAt = (route: keyof typeof COLLECTION_ROUTES, key: CollectionKey): { template: Template; params: Record<string, string> } =>
    key.taxon === undefined
      ? { template: COLLECTION_ROUTES[route].issuer, params: { issuer: key.issuer } }
      : { template: COLLECTION_ROUTES[route].taxon, params: { issuer: key.issuer, taxon: String(key.taxon) } };

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

  /** The path parameter of a token's routes: `{currency}.{issuer}`, the currency as the ledger holds it. `get` escapes it as one segment. */
  const tokenOf = (asset: { currency: string; issuer: string }) => ({ token: `${asset.currency}.${asset.issuer}` });

  /** What every account analytics call asks of the cache (spec 2.7): its failure held a few seconds, and its load shared with the same load in flight. */
  const analyticsOptions = { holdFailure: true, shareInFlight: true } as const;

  /** The list of a kind, a minute whatever its page; the kind says what the answer must be (`kind=mpt` is E14's). Written in the order of the reference's table. */
  function tokens(q: IssuedTokensQuery, opts?: FreshOptions): Promise<TokensResponse>;
  function tokens(q: MptTokensQuery, opts?: FreshOptions): Promise<MptTokensPage>;
  function tokens(q: IssuedTokensQuery | MptTokensQuery, opts?: FreshOptions): Promise<TokensResponse | MptTokensPage> {
    const query = { kind: q.kind, limit: q.limit, marker: q.marker || undefined, min_holders: q.kind === "issued" ? q.minHolders : undefined, q: q.q || undefined };
    return q.kind === "mpt"
      ? get<MptTokensPage>(PATHS.tokens, {}, query, "minute", { ...fresh(opts), finish: checkMptTokens })
      : get<TokensResponse>(PATHS.tokens, {}, query, "minute", { ...fresh(opts), finish: checkTokens });
  }

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
        ? get<Page<"rows", AmmVolumeRow>>(PATHS.ammVolume, {}, { live: q.live }, "minute", { ...fresh(opts), finish: checkLiveVolume })
        : get<Page<"rows", AmmVolumeRow>>(PATHS.ammVolume, {}, volumeQuery(q), "slow", {
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
      get<MarketsResponse>(PATHS.networkMarkets, {}, { limit: q.limit, period: q.period, amm: q.amm }, "minute", {
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
      get<AnalyticsBalances>(PATHS.analyticsBalances, { address }, { interval: q.interval, limit: q.limit, start: q.start }, "minute", {
        ...analyticsOptions,
        finish: (body) => checkAnalyticsBalances(body, q.interval, "data API analytics balances"),
      }),
    analyticsBalanceChanges: (address, q) =>
      get<AnalyticsBalanceChanges>(PATHS.analyticsBalanceChanges, { address }, { interval: q.interval, start: q.start }, "minute", {
        ...analyticsOptions,
        finish: (body) => checkBalanceChanges(body, q.interval, "data API analytics balance changes"),
      }),
    analyticsCounterparties: (address, q) =>
      get<AnalyticsCounterparties>(PATHS.analyticsCounterparties, { address }, { limit: q.limit, start: q.start }, "minute", {
        ...analyticsOptions,
        // The slow one (D2 sections 9 and 13); the other calls keep the 5 s.
        timeoutMs: ANALYTICS_SLOW_TIMEOUT_MS,
        finish: (body) => checkCounterparties(body, "data API analytics counterparties"),
      }),
    analyticsExchanges: (address, q) =>
      get<AnalyticsExchanges>(PATHS.analyticsExchanges, { address }, { limit: q.limit, start: q.start }, "minute", {
        ...analyticsOptions,
        finish: (body) => checkAnalyticsExchanges(body, "data API analytics exchanges"),
      }),
    // D1's six calls. A query is written in the order `limit`, `marker`, `scope`. A validator is addressed by `key` and an amendment by `name`, as D1's openapi.yaml names them.
    validatorsSummary: (opts) => get<ValidatorsSummary>(PATHS.validatorsSummary, {}, {}, "live", { ...fresh(opts), finish: checkValidatorsSummary }),
    validators: (q, opts) => get<ValidatorsList>(PATHS.validators, {}, { limit: q.limit, scope: q.scope }, "live", { ...fresh(opts), finish: checkValidatorsList }),
    validator: (key, opts) => get<ValidatorDetail>(PATHS.validator, { key }, {}, "live", { ...fresh(opts), finish: checkValidatorDetail }),
    validatorValidations: (key, q, opts) =>
      get<ValidatorValidationsPage>(PATHS.validatorValidations, { key }, { limit: q.limit, marker: q.marker || undefined }, q.marker ? "slow" : "live", {
        // A page after a marker is old rows, read from a call kept as long as D1 says (`max-age=300`): the caller's TTL (the newest rows') does not apply to it.
        ttl: q.marker ? VALIDATIONS_MARKER_TTL_SECONDS : opts?.ttl,
        holdFailure: opts?.holdFailure,
        finish: checkValidatorValidations,
      }),
    amendments: (opts) => get<AmendmentsList>(PATHS.amendments, {}, {}, "minute", { ...fresh(opts), finish: checkAmendments }),
    amendment: (ref, opts) => get<AmendmentDetail>(PATHS.amendment, { name: ref }, {}, "minute", { ...fresh(opts), finish: checkAmendmentDetail }),
    // E5's AMM pool calls. A pool is the `pool` of its answer; a pair is in the exchanges' path form, in the order asked.
    ammPools: (q) =>
      get<Page<"pools", AmmPool>>(
        PATHS.ammPools,
        {},
        { limit: q.limit, asset: q.asset === undefined ? undefined : apiAssetText(q.asset), include_deleted: q.includeDeleted, marker: q.marker || undefined },
        "minute",
        { finish: checkPoolsPage },
      ),
    ammPool: (pool) => get<AmmPool>(PATHS.ammPool, { pool }, {}, "minute", { unwrap: "pool", finish: (found) => checkPool(found, pool) }),
    ammPoolByPair: (base, counter) => get<AmmPool>(PATHS.ammPoolByPair, pairOf(base, counter), {}, "minute", { unwrap: "pool", finish: (found) => checkPool(found) }),
    ammPoolDays: (pool, q) =>
      get<Page<"days", AmmPoolDay>>(
        PATHS.ammPoolHistory,
        { pool },
        { interval: "day", start: q.start, end: q.end, descending: q.descending, limit: q.limit },
        "slow",
        { ttl: PERIOD_CALL_TTL_SECONDS, finish: checkDaysPage },
      ),
    ammSwaps: (pool, q) => get<Page<"exchanges", AmmSwap>>(PATHS.ammPoolSwaps, { pool }, listQuery(q), listClass(q), { finish: checkSwapsPage }),
    // The create event is the pool's first and never changes: `slow` whatever the page. `event` goes first (`liquidity?event=create&limit=1`).
    ammLiquidity: (pool, q) =>
      get<Page<"liquidity", AmmLiquidityEvent>>(PATHS.ammPoolLiquidity, { pool }, { event: q.event, ...listQuery(q) }, q.event ? "slow" : listClass(q), {
        finish: (page) => checkLiquidityPage(page, q.event),
      }),
    ammGovernance: (pool, q) =>
      get<Page<"governance", AmmGovernanceRow>>(PATHS.ammPoolGovernance, { pool }, listQuery(q), listClass(q), { finish: checkGovernancePage }),
    // E8's NFT calls. A collection key picks the form of the path; a query is written in the order of the reference's table, the page (`descending`, `limit`, `marker`) last.
    nftVolume: (q, opts) =>
      "live" in q
        ? get<NftVolume>(PATHS.nftVolume, {}, { live: q.live }, "minute", { ...fresh(opts), finish: (body, path) => checkNftVolume(body, path, "live") })
        : get<NftVolume>(PATHS.nftVolume, {}, volumeQuery(q), "slow", { ...fresh(opts), finish: (body, path) => checkNftVolume(body, path, "daily") }),
    nftSales: (q) => get<NftSalesPage>(PATHS.nftSales, {}, listQuery(q), nftListClass(q), { finish: checkNftSalesPage }),
    // `get` leaves a `false` out, and D3 is ascending only for the text "false": ascending is that text, descending (D3's default) nothing.
    nftCollections: (q) =>
      get<NftCollectionsPage>(
        PATHS.nftCollections,
        {},
        { limit: q.limit, sort: q.sort, descending: q.descending === false ? "false" : undefined, issuer: q.issuer || undefined, marker: q.marker || undefined },
        nftListClass(q, "minute"),
        { finish: checkCollectionsPage },
      ),
    nftCollection: (key) => {
      const { template, params } = collectionAt("collection", key);
      return get<NftCollectionAnswer>(template, params, {}, "minute", { finish: checkCollection });
    },
    nftCollectionStats: (key, q) => {
      const { template, params } = collectionAt("stats", key);
      return get<NftCollectionDays>(template, params, { start: q.start, end: q.end }, "slow", { ttl: PERIOD_CALL_TTL_SECONDS, finish: checkCollectionDays });
    },
    nftCollectionSales: (key, q) => {
      const { template, params } = collectionAt("sales", key);
      return get<NftSalesPage>(template, params, listQuery(q), nftListClass(q), { finish: checkNftSalesPage });
    },
    nftCollectionNfts: (key, q) => {
      const { template, params } = collectionAt("nfts", key);
      return get<NftsPage>(template, params, { owner: q.owner || undefined, include_burned: q.includeBurned, ...listQuery(q) }, nftListClass(q), {
        finish: (body, path) => checkNftsPage(body, path, key),
      });
    },
    nftCollectionHolders: (key, q) => {
      const { template, params } = collectionAt("holders", key);
      return get<NftHoldersPage>(template, params, listQuery(q), nftListClass(q), { finish: checkHoldersPage });
    },
    nft: (id) => get<NftAnswer>(PATHS.nft, { nft_id: id }, {}, "live", { finish: checkNft }),
    nftOffers: (id, q) =>
      get<NftOffersPage>(PATHS.nftOffers, { nft_id: id }, { limit: q.limit, marker: q.marker || undefined }, nftListClass(q), { finish: checkNftOffersPage }),
    nftHistory: (id, q) =>
      get<NftEventsPage>(PATHS.nftHistory, { nft_id: id }, { event: q.event?.length ? q.event.join(",") : undefined, ...listQuery(q) }, nftListClass(q), {
        finish: checkNftEventsPage,
      }),
    accountNfts: (address, q) => get<NftsPage>(PATHS.accountNfts, { address }, listQuery(q), nftListClass(q), { finish: checkNftsPage }),
    // E9's names and toml calls. The addresses go as given, in one comma list (`URLSearchParams` writes the commas as `%2C`).
    accountNames: (addresses, opts) =>
      get<AccountNamesResponse>(PATHS.accountNames, {}, { addresses: addresses.join(",") }, "minute", {
        ...fresh(opts),
        finish: (body) => checkAccountNames(body, addresses),
      }),
    toml: (domain) => get<TomlAnswer>(PATHS.toml, { domain }, {}, "minute", { finish: (body) => checkToml(body, domain) }),
    // E10's object calls. The object and the lookup are in the ledger as of now: `live`. A history is newest first and written `descending`, `limit`, `marker`; behind a marker it is
    // `MARKER_PAGE_CLASS` (`listClass`: it is newest first), the first page `live`. The lookup answers `{ result, ledger_object }`: the part under `ledger_object` is what is checked and returned.
    escrow: (id) => get<EscrowAnswer>(PATHS.escrow, { escrow_id: id }, {}, "live", { finish: (body, path) => checkObjectAnswer("escrow", body, path) }),
    escrowHistory: (id, q) =>
      get<ObjectHistoryPage>(PATHS.escrowHistory, { escrow_id: id }, listQuery(q), listClass(q), { finish: (body, path) => checkObjectHistory("escrow", body, path) }),
    check: (id) => get<CheckAnswer>(PATHS.check, { check_id: id }, {}, "live", { finish: (body, path) => checkObjectAnswer("check", body, path) }),
    checkHistory: (id, q) =>
      get<ObjectHistoryPage>(PATHS.checkHistory, { check_id: id }, listQuery(q), listClass(q), { finish: (body, path) => checkObjectHistory("check", body, path) }),
    paymentChannel: (id) =>
      get<PaymentChannelAnswer>(PATHS.paymentChannel, { channel_id: id }, {}, "live", { finish: (body, path) => checkObjectAnswer("payment_channel", body, path) }),
    paymentChannelHistory: (id, q) =>
      get<ObjectHistoryPage>(PATHS.paymentChannelHistory, { channel_id: id }, listQuery(q), listClass(q), {
        finish: (body, path) => checkObjectHistory("payment_channel", body, path),
      }),
    accountDelegations: (address, q) =>
      get<DelegationsPage>(PATHS.accountDelegations, { address }, { direction: q.direction, limit: q.limit }, "live", { finish: checkDelegations }),
    ledgerObject: (id) => get<LedgerObjectRef>(PATHS.ledgerObject, { object_id: id }, {}, "live", { unwrap: "ledger_object", finish: checkLedgerObject }),
    // E11's token calls. The list, the detail and the holders are a minute, whatever the page (D6's ranking is rebuilt each minute); the transfers are the payments of the ledgers, newest first:
    // `live`, and `MARKER_PAGE_CLASS` behind a marker, with the TTL for a first page only (`listClass`). A query is written in the order of the reference's table.
    tokens,
    token: (asset, opts) =>
      get<TokenAnswer>(PATHS.token, tokenOf(asset), {}, "minute", { ...fresh(opts), finish: (body, path) => checkToken(body, path, asset) }),
    tokenHolders: (asset, q, opts) =>
      get<TokenHoldersResponse>(PATHS.tokenHolders, tokenOf(asset), { limit: q.limit, marker: q.marker || undefined }, "minute", { ...fresh(opts), finish: checkTokenHolders }),
    tokenTransfers: (asset, q, opts) => {
      const newestFirst = { descending: true, limit: q.limit, marker: q.marker } as const;
      return get<TokenTransfersResponse>(PATHS.tokenTransfers, tokenOf(asset), listQuery(newestFirst), listClass(newestFirst), {
        ttl: q.marker ? undefined : opts?.ttl,
        holdFailure: opts?.holdFailure,
        finish: checkTokenTransfers,
      });
    },
    // E12's supply calls: both `slow`, whatever TTL the page keeps them for. The snapshot is told the native currency of the network, so that a data API answering the other network's is a failure.
    networkSupply: (opts) =>
      get<NetworkSupply>(PATHS.networkSupply, {}, {}, "slow", { ...fresh(opts), finish: (body, path) => checkSupply(body, path, net.native) }),
    networkMinted: (q, opts) =>
      get<MintedPage>(PATHS.networkMinted, {}, { interval: q.interval, start: q.start, end: q.end, limit: q.limit }, "slow", { ...fresh(opts), finish: checkMintedPage }),
    // E14's MPT calls. An issuance, its holders and its transfers are a minute (D9's `mpt_state` job runs every tick of the syncer, and what a page says of an issuance may be a minute late); behind a marker a list is
    // `MARKER_PAGE_CLASS`, whichever way it runs (`nftListClass`, not `listClass`, which gives `live` for a first page). The lookup is `slow`: what an issuance is called and how it is scaled rarely changes.
    mpt: (id) => get<MptIssuanceAnswer>(PATHS.mpt, { issuanceId: id }, {}, "minute", { finish: (body, path) => checkMptIssuance(body, path, id) }),
    mptHolders: (id, q) =>
      get<MptHoldersPage>(PATHS.mptHolders, { issuanceId: id }, { limit: q.limit, marker: q.marker || undefined }, nftListClass(q, "minute"), { finish: checkMptHoldersPage }),
    mptTransfers: (id, q) => get<MptTransfersPage>(PATHS.mptTransfers, { issuanceId: id }, listQuery(q), nftListClass(q, "minute"), { finish: checkMptTransfersPage }),
    mptLookup: async (ids) => {
      const bad = ids.find((id) => !MPT_LOOKUP_ID.test(id));
      if (bad !== undefined) throw new RangeError(`a lookup of MPT issuances takes IDs of 48 hex digits, not ${JSON.stringify(bad)}`);
      const asked = [...new Set(ids.map((id) => id.toUpperCase()))].sort();
      if (asked.length < 1 || asked.length > MPT_LOOKUP_MAX) throw new RangeError(`a lookup of MPT issuances takes 1 to ${MPT_LOOKUP_MAX} distinct IDs, not ${asked.length}`);
      return get<MptLookup>(PATHS.mptLookup, {}, { ids: asked.join(",") }, "slow", { finish: (body, path) => checkMptLookup(body, asked, path) });
    },
  };
}
