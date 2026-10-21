import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi, type MockInstance } from "vitest";

import type {
  AccountTxStatsRow,
  AccountValueRow,
  ActiveAccounts,
  AmendmentDetail,
  AmendmentsList,
  AmmGovernanceRow,
  AmmLiquidityEvent,
  AmmPool,
  AmmPoolDay,
  AmmSwap,
  AmmVolumeComponent,
  AmmVolumeRow,
  AnalyticsBalanceChanges,
  AnalyticsBalances,
  AnalyticsCounterparties,
  AnalyticsExchanges,
  Candle,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeRow,
  FeeStatsRow,
  LedgerValidations,
  MarketRow,
  MarketsResponse,
  Page,
  PairExchange,
  PaymentVolumeComponent,
  ReducedRow,
  StatsRow,
  TxObject,
  ValidatorDetail,
  ValidatorsList,
  ValidatorsSummary,
  ValidatorValidationsPage,
  VolumeRow,
} from "../../app/server/api-types";
import {
  CACHE_CLASSES,
  HOME_CALL_TTL_SECONDS,
  MARKER_PAGE_CLASS,
  PERIOD_CALL_TTL_SECONDS,
  VALIDATIONS_CALL_TTL_SECONDS,
  VALIDATIONS_MARKER_TTL_SECONDS,
  VALIDATORS_CALL_TTL_SECONDS,
  type CacheClass,
} from "../../app/server/cache-class";
import { ACTIVE_ACCOUNTS_KEPT, createDataApi, UpstreamError, type DataApi, type FreshOptions } from "../../app/server/data-api";
import { createSubrequestCache } from "../../app/server/edge-cache";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { ANALYTICS_SLOW_TIMEOUT_MS, DATA_API_TIMEOUT_MS } from "../../app/server/upstream";
import {
  AMM_POOL,
  ammDaysSample,
  ammGovernanceSample,
  ammLiquidityPageSample,
  ammLiveVolumeSample,
  ammPoolAccount,
  ammPoolSample,
  ammPoolsSample,
  ammSwapsSample,
} from "../support/amm-samples";
import { amendmentDetailSample, amendmentsSample, SAMPLE_KEYS, summarySample, validationsSample, validatorDetailSample, validatorRowSample } from "../support/d1-samples";
import { passThroughCache, recordingCache } from "../support/subrequest-cache";
import { allSwitches } from "../support/switches";
import { dataApiError, mockUpstream, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";

// The Data API client, in the Workers runtime. Nothing here reaches the network: `fetch` is replaced in every
// test, and the data API hosts of the env are `.invalid` anyway.

const env: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid/",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
const xrpl = networkOf("xrpl", env);
const xahau = networkOf("xahau", env);

const ACCOUNT = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const HASH = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
const BASE = "https://xrpl.data.example.invalid";

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  // Anything a test did not arrange fails loudly instead of going out.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("unexpected network call");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function sentRequest(index = -1): Request {
  const [input, init] = fetchSpy.mock.calls.at(index)!;
  return new Request(input, init);
}

async function failureOf(promise: Promise<unknown>): Promise<UpstreamError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UpstreamError);
  return error as UpstreamError;
}

// Bodies in the shapes of data-api-new/docs/api-reference.md.
const lastValidatedBody = {
  result: "success",
  ledger_index: "107695660",
  ledger_hash: "A".repeat(64),
  parent_hash: "B".repeat(64),
  close_time: "2026-10-16T12:00:00Z",
};
const ledgerBody = {
  result: "success",
  ledger: {
    ledger_hash: "A".repeat(64),
    ledger_index: 107695660,
    parent_hash: "B".repeat(64),
    total_coins: "99985687626634189",
    close_time: 1792152000,
    close_time_human: "2026-Oct-16 12:00:00",
    close_time_resolution: "10",
    close_flags: "0",
    parent_close_time: 1792151990,
    account_hash: "C".repeat(64),
    transaction_hash: "D".repeat(64),
    hash: "A".repeat(64),
    seqNum: "107695660",
    totalCoins: "99985687626634189",
    accepted: "true",
    closed: "true",
  },
};
const txObject = {
  hash: HASH,
  ledger_index: 107671558,
  date: "2026-10-13T09:04:30+00:00",
  tx: { TransactionType: "Payment", Account: ACCOUNT, Fee: "10" },
  meta: { TransactionIndex: 12, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
};
const expandedLedgerBody = { ...ledgerBody, ledger: { ...ledgerBody.ledger, transactions: [txObject] } };
const hashedLedgerBody = { ...ledgerBody, ledger: { ...ledgerBody.ledger, transactions: [HASH] } };
const transactionBody = { result: "success", transaction: txObject };
const binaryObject = { hash: HASH, ledger_index: 107671558, date: "2026-10-13T09:04:30+00:00", tx: "120000220000000024", meta: "201C0000000C" };
const binaryBody = { result: "success", transaction: binaryObject };
const transactionsBody = { result: "success", count: 1, marker: "WzEwNzY3MDM2MCw1XQ", transactions: [txObject] };
const accountBody = {
  result: "success",
  account_data: {
    account: ACCOUNT,
    parent: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    initial_balance: "100",
    inception: "2015-01-14T18:27:20Z",
    ledger_index: 11119603,
    tx_hash: HASH,
  },
};
const balancesBody = {
  result: "success",
  ledger_index: 107695660,
  limit: 200,
  balances: [{ currency: "XRP", value: "1000.5" }],
};
const ordersBody = { result: "success", ledger_index: 107695660, limit: 200, orders: [] };
const paymentsBody = { result: "success", count: 0, payments: [] };
const exchangesBody = { result: "success", count: 0, exchanges: [] };
const feesBody = {
  result: "success",
  count: 1,
  rows: [
    { avg: 0.00001, max: 0.00001, min: 0.00001, total: 0.00013, tx_count: 13, date: "2026-10-16T12:00:00Z", ledger_index: 107695660 },
  ],
};

// The calls of the network page. Bodies in the shapes of the reference's sections "Network", "Validations" and "Stats", and of "amm_volume" on feat/amm-data.
const statsTypeBody = {
  result: "success",
  count: 2,
  stats: [
    { OfferCreate: 4000, Payment: 3000, date: "2026-10-16T00:00:00Z" },
    { OfferCreate: 3800, Payment: 3100, TrustSet: 12, date: "2026-10-17T00:00:00Z" },
  ],
};
const statsMetricBody = {
  result: "success",
  count: 1,
  stats: [{ accounts_created: 12, date: "2026-10-17T00:00:00Z", ledger_count: 24000, payments_count: 2900, transaction_count: 7000 }],
};
const feeBucketsBody = {
  result: "success",
  count: 2,
  rows: [
    { avg: 0.010615, max: 0.011, min: 0.00001, total: 0.138, tx_count: 13, date: "2026-10-16T00:00:00Z" },
    { avg: 0.00001, max: 0.00001, min: 0.00001, total: 0.0001, tx_count: 10, date: "2026-10-17T00:00:00Z" },
  ],
};
const feeStatsBody = {
  result: "success",
  count: 1,
  rows: [
    {
      current_ledger_size: 54,
      current_queue_size: 0,
      date: "2026-10-17T12:00:05Z",
      expected_ledger_size: 53,
      median_fee: 0.000005,
      minimum_fee: 0.00001,
      open_ledger_fee: 0.00001,
      pct_max_queue_size: 0,
    },
  ],
};
const USD_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const LEDGER_HASH = "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092";
const volumeRow = (components: unknown[]) => ({
  components,
  count: 120,
  exchange: { currency: "XRP" },
  total: "45454.545",
  exchange_rate: "1.0000000",
  start_time: "2026-10-16T00:00:00Z",
  end_time: "2026-10-17T00:00:00Z",
});
const paymentVolumeBody = {
  result: "success",
  count: 1,
  rows: [volumeRow([{ currency: "USD", issuer: USD_ISSUER, amount: "5000", count: 100, rate: "0.0090909091", converted_amount: "45454.545" }])],
};
const exchangeVolumeBody = {
  result: "success",
  count: 1,
  rows: [
    volumeRow([
      { count: 120, rate: "0.0090909091", amount: "5000", base: { currency: "USD", issuer: USD_ISSUER }, counter: { currency: "XRP" }, converted_amount: "45454.545" },
    ]),
  ],
};
const ammVolumeBody = {
  result: "success",
  count: 1,
  rows: [
    volumeRow([
      {
        amm_account: "rhWj9gtLMopk5vs8Hwuw5kVRLEuPGnq3Yi",
        base: { currency: "USD", issuer: USD_ISSUER },
        counter: { currency: "XRP" },
        count: 31,
        amount: "1500.25",
        rate: "0.5",
        converted_amount: "3000.5",
      },
    ]),
  ],
};
const validationsBody = {
  result: "success",
  ledger_hash: LEDGER_HASH,
  count: 1,
  validations: [
    {
      count: 3,
      first_datetime: "2026-10-16T12:00:01.123Z",
      flags: "2147483649",
      full: "true",
      last_datetime: "2026-10-16T12:00:02.456Z",
      ledger_hash: LEDGER_HASH,
      ledger_index: "107695660",
      reporter_public_key: "n9KDJnd1X4fG7sdzDV7SWGnkJ2YsqnEcnXJ3GMBGX1kJUVHJr3NP",
      signing_time: "814567890",
      validation_public_key: "n9KDJnd1X4fG7sdzDV7SWGnkJ2YsqnEcnXJ3GMBGX1kJUVHJr3NP",
    },
  ],
};
// The pair page's and the markets page's calls. Bodies in the shapes of the reference's sections "Exchanges" and "Active accounts" (main), "network/markets"
// (feat/explorer-data 7d495ab) and the AMM keys of D2b.1 / feat/amm-data.
const XRP_ASSET = { currency: "XRP" };
const RLUSD_CODE = "524C555344000000000000000000000000000000";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD_ASSET = { currency: RLUSD_CODE, issuer: RLUSD_ISSUER };
/** The pair XRP/RLUSD as the data API's path has it: `CUR+issuer`, the `+` escaped. */
const PAIR_PATH = `/v2/exchanges/XRP/${RLUSD_CODE}%2B${RLUSD_ISSUER}`;
const ACTIVE_PATH = `/v2/active_accounts/XRP/${RLUSD_CODE}%2B${RLUSD_ISSUER}`;
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const pairTrade = {
  base_amount: "50",
  counter_amount: "122.5",
  node_index: 4,
  rate: "2.45",
  tx_index: 12,
  buyer: ACCOUNT,
  executed_time: "2026-10-17T12:00:03Z",
  ledger_index: 107695660,
  offer_sequence: 1517,
  provider: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  seller: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  taker: ACCOUNT,
  tx_hash: HASH,
  tx_type: "OfferCreate",
  base_currency: "XRP",
  counter_currency: RLUSD_CODE,
  counter_issuer: RLUSD_ISSUER,
};
const pairSwap = { ...pairTrade, node_index: 9, offer_sequence: 0, provider: POOL, seller: POOL, tx_type: "Payment", amm_account: POOL };
const pairExchangesBody = { result: "success", count: 2, marker: "WzEwNzY3MDM2MCw1XQ", exchanges: [pairTrade, pairSwap] };
const pairCandle = {
  base_volume: "1500",
  buy_volume: 600,
  close: "2.45000000",
  close_time: "2026-10-17T11:59:50Z",
  count: 12,
  counter_volume: "3675",
  high: "2.50000000",
  low: "2.40000000",
  open: "2.42000000",
  open_time: "2026-10-17T11:00:10Z",
  start: "2026-10-17T11:00:00Z",
  vwap: "2.45000000",
  base_currency: "XRP",
  counter_currency: RLUSD_CODE,
  counter_issuer: RLUSD_ISSUER,
};
const pairCandlesBody = { result: "success", count: 2, marker: "MTc5MjE0ODQwMA", exchanges: [pairCandle, { ...pairCandle, start: "2026-10-17T12:00:00Z" }] };
const pairReduceRow = {
  open: "2.42000000",
  high: "2.50000000",
  low: "2.40000000",
  close: "2.45000000",
  base_volume: "36000",
  counter_volume: "88200",
  buy_volume: 14400,
  count: 288,
  open_time: "2026-10-16T17:01:10Z",
  close_time: "2026-10-17T16:59:50Z",
  vwap: "2.45000000",
  start: "2026-10-16T17:01:00Z",
  base_currency: "XRP",
  counter_currency: RLUSD_CODE,
  counter_issuer: RLUSD_ISSUER,
};
const pairReduceBody = { result: "success", count: 1, exchanges: [pairReduceRow] };
const activeAccount = (n: number) => ({
  buy: { base_volume: String(1000 - n * 10), counter_volume: "2450", count: 3 },
  sell: { base_volume: "0", counter_volume: "0", count: 0 },
  account: `rActive${String(n).padStart(2, "0")}`,
  base_volume: String(1000 - n * 10),
  counter_volume: "2450",
  count: 3,
});
const activeAccountsBody = { result: "success", count: 2, exchanges_count: 12, accounts: [activeAccount(1), activeAccount(2)] };
const marketRow = {
  base_currency: "USD",
  base_issuer: USD_ISSUER,
  counter_currency: "XRP",
  count: 13,
  base_volume: "130",
  counter_volume: "65",
  native_volume: "65",
  open: "0.50000000",
  high: "0.80000000",
  low: "0.30000000",
  last: "0.40000000",
  change: "-20.00",
  open_time: "2026-10-16T12:00:00Z",
  last_time: "2026-10-17T10:42:17Z",
  sparkline: [
    { date: "2026-10-11T00:00:00Z" },
    { date: "2026-10-12T00:00:00Z" },
    { date: "2026-10-13T00:00:00Z", close: "0.52500000" },
    { date: "2026-10-14T00:00:00Z", close: "0.52500000" },
    { date: "2026-10-15T00:00:00Z", close: "0.52500000" },
    { date: "2026-10-16T00:00:00Z", close: "0.50000000" },
    { date: "2026-10-17T00:00:00Z", close: "0.40000000" },
  ],
};
const marketsBody = {
  result: "success",
  period: "day",
  start_time: "2026-10-16T10:00:00Z",
  end_time: "2026-10-17T10:42:17Z",
  totals: { pairs: 9, pairs_traded: 11, count: 112, native_volume: "243.5" },
  count: 1,
  markets: [marketRow],
};
/** The answer to a request with the filter: D2b's `amm` after `period`, and the shares of D2b.1 (4 decimals), `totals.amm_share` after `native_volume`. */
const marketsWithAmm = (amm: "include" | "exclude" | "only") => ({
  result: "success",
  period: "day",
  amm,
  start_time: "2026-10-16T10:00:00Z",
  end_time: "2026-10-17T10:42:17Z",
  totals: { ...marketsBody.totals, amm_share: "0.2150" },
  count: 1,
  markets: [{ ...marketRow, amm_share: "0.3400", amm_pool: true }],
});
/** The window the network page asks for on 2026-10-17 (the index day): 30 days of buckets, up to and with that day. */
const PERIOD = { start: "2026-09-18", end: "2026-10-17" };

/** The list route's answer: two rows. */
function validatorsListBody(): ValidatorsList {
  return { result: "success", count: 2, validators: [validatorRowSample(), validatorRowSample({ validation_public_key: SAMPLE_KEYS[1], domain: "shoreline.example" })] };
}

type Case = {
  name: string;
  call: (api: DataApi, opts?: FreshOptions) => Promise<unknown>;
  /** Path and query of the request, after the host. */
  url: string;
  /** What the data API answers. */
  body: unknown;
  /** What the client resolves to. */
  result: unknown;
  /** The cache class the answer is stored under. */
  cls: CacheClass;
  /** The call takes the options every call of a polled page does (`FreshOptions`) and passes them on. */
  fresh?: true;
};

const cases: Case[] = [
  {
    // `live` (5 s) by default, for the ledger page and the image route. The home page asks for HOME_CALL_TTL_SECONDS instead (below).
    name: "lastValidated",
    cls: "live",
    call: (a) => a.lastValidated(),
    url: "/v2/last_validated",
    body: lastValidatedBody,
    result: lastValidatedBody,
  },
  {
    name: "ledger by index",
    cls: "immutable",
    call: (a) => a.ledger("107695660"),
    url: "/v2/ledgers/107695660",
    body: ledgerBody,
    result: ledgerBody.ledger,
  },
  {
    name: "ledger by hash, expanded",
    cls: "immutable",
    call: (a) => a.ledger(HASH, { expand: true }),
    // `transactions=true` goes with `expand=true`, so that the key is there for a ledger with no transactions.
    url: `/v2/ledgers/${HASH}?expand=true&transactions=true`,
    body: expandedLedgerBody,
    result: expandedLedgerBody.ledger,
  },
  {
    name: "ledger with transaction hashes",
    cls: "immutable",
    call: (a) => a.ledger("107695660", { transactions: true }),
    url: "/v2/ledgers/107695660?transactions=true",
    body: hashedLedgerBody,
    result: hashedLedgerBody.ledger,
  },
  {
    name: "transaction",
    cls: "immutable",
    call: (a) => a.transaction(HASH),
    url: `/v2/transactions/${HASH}`,
    body: transactionBody,
    result: txObject,
  },
  {
    // The serialization, as hex, of the transaction and its metadata (`binary=true`): for the page's Binary tab.
    name: "transaction, binary",
    cls: "immutable",
    call: (a) => a.transactionBinary(HASH),
    url: `/v2/transactions/${HASH}?binary=true`,
    body: binaryBody,
    result: binaryObject,
  },
  {
    name: "transactions, first page",
    cls: "live",
    call: (a) => a.transactions({ descending: true, limit: 8 }),
    url: "/v2/transactions?descending=true&limit=8",
    body: transactionsBody,
    result: transactionsBody,
  },
  {
    name: "transactions, after a marker",
    // `slow`, not `immutable` (MARKER_PAGE_CLASS in cache-class.ts): backfill and gap repair write history below the marker.
    cls: "slow",
    call: (a) => a.transactions({ descending: true, limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" }),
    url: "/v2/transactions?descending=true&limit=20&marker=WzEwNzY3MDM2MCw1XQ",
    body: transactionsBody,
    result: transactionsBody,
  },
  {
    name: "account",
    cls: "slow",
    call: (a) => a.account(ACCOUNT),
    url: `/v2/accounts/${ACCOUNT}`,
    body: accountBody,
    result: accountBody.account_data,
  },
  {
    name: "balances",
    cls: "live",
    call: (a) => a.balances(ACCOUNT),
    url: `/v2/accounts/${ACCOUNT}/balances`,
    body: balancesBody,
    result: balancesBody,
  },
  {
    name: "orders",
    cls: "live",
    call: (a) => a.orders(ACCOUNT),
    url: `/v2/accounts/${ACCOUNT}/orders`,
    body: ordersBody,
    result: ordersBody,
  },
  {
    name: "accountTransactions, first page",
    cls: "live",
    call: (a) => a.accountTransactions(ACCOUNT, { descending: true, limit: 20 }),
    url: `/v2/accounts/${ACCOUNT}/transactions?descending=true&limit=20`,
    body: transactionsBody,
    result: transactionsBody,
  },
  {
    name: "accountTransactions, after a marker",
    // `slow`, not `immutable` (MARKER_PAGE_CLASS in cache-class.ts): backfill and gap repair write history below the marker.
    cls: "slow",
    call: (a) => a.accountTransactions(ACCOUNT, { descending: true, limit: 20, marker: "abc" }),
    url: `/v2/accounts/${ACCOUNT}/transactions?descending=true&limit=20&marker=abc`,
    body: transactionsBody,
    result: transactionsBody,
  },
  {
    name: "accountPayments, first page",
    cls: "live",
    call: (a) => a.accountPayments(ACCOUNT, { descending: true, limit: 20 }),
    url: `/v2/accounts/${ACCOUNT}/payments?descending=true&limit=20`,
    body: paymentsBody,
    result: paymentsBody,
  },
  {
    name: "accountPayments, after a marker",
    // `slow`, not `immutable` (MARKER_PAGE_CLASS in cache-class.ts): backfill and gap repair write history below the marker.
    cls: "slow",
    call: (a) => a.accountPayments(ACCOUNT, { descending: true, limit: 20, marker: "abc" }),
    url: `/v2/accounts/${ACCOUNT}/payments?descending=true&limit=20&marker=abc`,
    body: paymentsBody,
    result: paymentsBody,
  },
  {
    name: "accountExchanges, first page",
    cls: "live",
    call: (a) => a.accountExchanges(ACCOUNT, { descending: true, limit: 20 }),
    url: `/v2/accounts/${ACCOUNT}/exchanges?descending=true&limit=20`,
    body: exchangesBody,
    result: exchangesBody,
  },
  {
    name: "accountExchanges, after a marker",
    // `slow`, not `immutable` (MARKER_PAGE_CLASS in cache-class.ts): backfill and gap repair write history below the marker.
    cls: "slow",
    call: (a) => a.accountExchanges(ACCOUNT, { descending: true, limit: 20, marker: "abc" }),
    url: `/v2/accounts/${ACCOUNT}/exchanges?descending=true&limit=20&marker=abc`,
    body: exchangesBody,
    result: exchangesBody,
  },
  {
    name: "fees",
    cls: "live",
    call: (a) => a.fees({ descending: true, limit: 8 }),
    url: "/v2/network/fees?descending=true&limit=8",
    body: feesBody,
    result: feesBody,
  },
  {
    // The same path with an interval: a row per day, a list that changes once a day, so it is `slow`.
    name: "fees by day",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.fees({ interval: "day", ...PERIOD, limit: 1000 }, o),
    url: "/v2/network/fees?interval=day&start=2026-09-18&end=2026-10-17&limit=1000",
    body: feeBucketsBody,
    result: feeBucketsBody,
  },
  {
    name: "feeStats",
    cls: "live",
    fresh: true,
    call: (a, o) => a.feeStats({ descending: true, limit: 1, start: "2026-10-17" }, o),
    url: "/v2/network/fee_stats?descending=true&limit=1&start=2026-10-17",
    body: feeStatsBody,
    result: feeStatsBody,
  },
  {
    name: "stats of the transaction types",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.stats("type", { interval: "day", ...PERIOD, limit: 1000 }, o),
    url: "/v2/stats/type?interval=day&start=2026-09-18&end=2026-10-17&limit=1000",
    body: statsTypeBody,
    result: statsTypeBody,
  },
  {
    name: "stats of the metrics",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.stats("metric", { interval: "week", start: "2024-10-14", end: "2026-10-17", limit: 1000, metrics: ["accounts_created", "ledger_count", "transaction_count"] }, o),
    url: "/v2/stats/metric?interval=week&start=2024-10-14&end=2026-10-17&limit=1000&metrics=accounts_created%2Cledger_count%2Ctransaction_count",
    body: statsMetricBody,
    result: statsMetricBody,
  },
  {
    name: "paymentVolume",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.paymentVolume({ interval: "day", ...PERIOD, limit: 1000 }, o),
    url: "/v2/network/payment_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000",
    body: paymentVolumeBody,
    result: paymentVolumeBody,
  },
  {
    name: "paymentVolume, in another currency",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.paymentVolume({ interval: "week", start: "2024-10-14", end: "2026-10-17", limit: 1000, exchangeCurrency: "USD", exchangeIssuer: USD_ISSUER }, o),
    url: `/v2/network/payment_volume?interval=week&start=2024-10-14&end=2026-10-17&limit=1000&exchange_currency=USD&exchange_issuer=${USD_ISSUER}`,
    body: paymentVolumeBody,
    result: paymentVolumeBody,
  },
  {
    name: "exchangeVolume",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.exchangeVolume({ interval: "day", ...PERIOD, limit: 1000 }, o),
    url: "/v2/network/exchange_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000",
    body: exchangeVolumeBody,
    result: exchangeVolumeBody,
  },
  {
    name: "exchangeVolume, in another currency",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.exchangeVolume({ interval: "week", start: "2024-10-14", end: "2026-10-17", limit: 1000, exchangeCurrency: "USD", exchangeIssuer: USD_ISSUER }, o),
    url: `/v2/network/exchange_volume?interval=week&start=2024-10-14&end=2026-10-17&limit=1000&exchange_currency=USD&exchange_issuer=${USD_ISSUER}`,
    body: exchangeVolumeBody,
    result: exchangeVolumeBody,
  },
  {
    // Its path is in PENDING_PATHS: openapi.yaml has no `amm_volume` yet.
    name: "ammVolume",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.ammVolume({ interval: "day", ...PERIOD, limit: 1000 }, o),
    url: "/v2/network/amm_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000",
    body: ammVolumeBody,
    result: ammVolumeBody,
  },
  {
    name: "ammVolume, in another currency",
    cls: "slow",
    fresh: true,
    call: (a, o) => a.ammVolume({ interval: "week", start: "2024-10-14", end: "2026-10-17", limit: 1000, exchangeCurrency: "USD", exchangeIssuer: USD_ISSUER }, o),
    url: `/v2/network/amm_volume?interval=week&start=2024-10-14&end=2026-10-17&limit=1000&exchange_currency=USD&exchange_issuer=${USD_ISSUER}`,
    body: ammVolumeBody,
    result: ammVolumeBody,
  },
  {
    name: "ledgerValidations",
    cls: "live",
    fresh: true,
    call: (a, o) => a.ledgerValidations(LEDGER_HASH, { limit: 1000 }, o),
    url: `/v2/ledgers/${LEDGER_HASH}/validations?limit=1000`,
    body: validationsBody,
    result: validationsBody,
  },
  {
    // The pair page's trades. Asset segments are `CUR+issuer` with the `+` escaped. `live` (5 s) by default; the page asks for HOME_CALL_TTL_SECONDS (below).
    name: "pairExchanges, first page",
    cls: "live",
    call: (a) => a.pairExchanges(XRP_ASSET, RLUSD_ASSET, { descending: true, limit: 20 }),
    url: `${PAIR_PATH}?descending=true&limit=20`,
    body: pairExchangesBody,
    result: pairExchangesBody,
  },
  {
    name: "pairExchanges, after a marker",
    // `slow`, not `immutable` (MARKER_PAGE_CLASS in cache-class.ts): backfill and gap repair write history below the marker.
    cls: "slow",
    call: (a) => a.pairExchanges(XRP_ASSET, RLUSD_ASSET, { descending: true, limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" }),
    url: `${PAIR_PATH}?descending=true&limit=20&marker=WzEwNzY3MDM2MCw1XQ`,
    body: pairExchangesBody,
    result: pairExchangesBody,
  },
  {
    name: "pairExchanges, the swaps against pools only, in the other orientation",
    cls: "live",
    call: (a) => a.pairExchanges(RLUSD_ASSET, XRP_ASSET, { descending: true, limit: 20, amm: "only" }),
    url: `/v2/exchanges/${RLUSD_CODE}%2B${RLUSD_ISSUER}/XRP?descending=true&limit=20&amm=only`,
    body: pairExchangesBody,
    result: pairExchangesBody,
  },
  {
    name: "pairExchanges, the order book only",
    cls: "live",
    call: (a) => a.pairExchanges(XRP_ASSET, RLUSD_ASSET, { descending: true, limit: 20, amm: "exclude" }),
    url: `${PAIR_PATH}?descending=true&limit=20&amm=exclude`,
    body: pairExchangesBody,
    result: pairExchangesBody,
  },
  {
    // Candles are `live` unless the page says otherwise (`cls`), and `exchanges` is the key their rows come under.
    name: "pairCandles",
    cls: "live",
    call: (a) => a.pairCandles(XRP_ASSET, RLUSD_ASSET, { interval: "1hour", start: "2026-10-14T05:00:00Z", limit: 61 }),
    url: `${PAIR_PATH}?interval=1hour&start=2026-10-14T05%3A00%3A00Z&limit=61`,
    body: pairCandlesBody,
    result: pairCandlesBody,
  },
  {
    name: "pairCandles, up to an end, newest first, the order book only",
    cls: "live",
    call: (a) =>
      a.pairCandles(XRP_ASSET, RLUSD_ASSET, { interval: "1day", start: "2026-08-18T00:00:00Z", end: "2026-10-17T00:00:00Z", limit: 61, descending: true, amm: "exclude" }),
    url: `${PAIR_PATH}?interval=1day&start=2026-08-18T00%3A00%3A00Z&end=2026-10-17T00%3A00%3A00Z&limit=61&descending=true&amm=exclude`,
    body: pairCandlesBody,
    result: pairCandlesBody,
  },
  {
    // The one reduced row is what the call gives back, not the answer around it.
    name: "pairReduce",
    cls: "live",
    call: (a, o) => a.pairReduce(XRP_ASSET, RLUSD_ASSET, { start: "2026-10-16T17:01:00Z" }, o),
    url: `${PAIR_PATH}?reduce=true&start=2026-10-16T17%3A01%3A00Z`,
    body: pairReduceBody,
    result: pairReduceRow,
  },
  {
    name: "pairReduce, the swaps against pools only",
    cls: "live",
    call: (a, o) => a.pairReduce(XRP_ASSET, RLUSD_ASSET, { start: "2026-10-16T17:01:00Z", amm: "only" }, o),
    url: `${PAIR_PATH}?reduce=true&start=2026-10-16T17%3A01%3A00Z&amm=only`,
    body: pairReduceBody,
    result: pairReduceRow,
  },
  {
    // `minute`: the accounts of a day change as trades come in, but the traders tile need not be fresher than the markets table.
    name: "activeAccounts",
    cls: "minute",
    call: (a, o) => a.activeAccounts(XRP_ASSET, RLUSD_ASSET, o),
    url: ACTIVE_PATH,
    body: activeAccountsBody,
    result: activeAccountsBody,
  },
  {
    // Its path is in PENDING_PATHS: openapi.yaml has no `network/markets` yet (data-api-new `feat/explorer-data`).
    name: "networkMarkets",
    cls: "minute",
    call: (a, o) => a.networkMarkets({ period: "day", limit: 1000 }, o),
    url: "/v2/network/markets?limit=1000&period=day",
    body: marketsBody,
    result: marketsBody,
  },
  {
    name: "networkMarkets, the order book only, over 7 days",
    cls: "minute",
    call: (a, o) => a.networkMarkets({ period: "7day", limit: 1000, amm: "exclude" }, o),
    url: "/v2/network/markets?limit=1000&period=7day&amm=exclude",
    body: { ...marketsWithAmm("exclude"), period: "7day" },
    result: { ...marketsWithAmm("exclude"), period: "7day" },
  },
  {
    name: "networkMarkets, the swaps only, over 30 days",
    cls: "minute",
    call: (a, o) => a.networkMarkets({ period: "30day", limit: 1000, amm: "only" }, o),
    url: "/v2/network/markets?limit=1000&period=30day&amm=only",
    body: { ...marketsWithAmm("only"), period: "30day" },
    result: { ...marketsWithAmm("only"), period: "30day" },
  },
  // D1's six calls (validators spec 2.1; their paths are in PENDING_PATHS). The options they take, the marker view and the failures are in "D1's validators and amendments calls".
  {
    name: "validatorsSummary",
    cls: "live",
    call: (a) => a.validatorsSummary(),
    url: "/v2/network/validators/summary",
    body: summarySample(),
    result: summarySample(),
  },
  {
    name: "validators",
    cls: "live",
    call: (a) => a.validators({ scope: "all", limit: 1000 }),
    url: "/v2/network/validators?limit=1000&scope=all",
    body: validatorsListBody(),
    result: validatorsListBody(),
  },
  {
    name: "validator",
    cls: "live",
    call: (a) => a.validator(SAMPLE_KEYS[0]),
    url: `/v2/network/validators/${SAMPLE_KEYS[0]}`,
    body: validatorDetailSample(),
    result: validatorDetailSample(),
  },
  {
    name: "validatorValidations, the first page",
    cls: "live",
    call: (a) => a.validatorValidations(SAMPLE_KEYS[0], { limit: 20 }),
    url: `/v2/network/validators/${SAMPLE_KEYS[0]}/validations?limit=20`,
    body: validationsSample(),
    result: validationsSample(),
  },
  {
    name: "amendments",
    cls: "minute",
    call: (a) => a.amendments(),
    url: "/v2/network/amendments",
    body: amendmentsSample(),
    result: amendmentsSample(),
  },
  {
    name: "amendment",
    cls: "minute",
    call: (a) => a.amendment("AMM"),
    url: "/v2/network/amendments/AMM",
    body: amendmentDetailSample(),
    result: amendmentDetailSample(),
  },
];

describe("requests", () => {
  it.each(cases)("$name: GET <dataApiUrl>$url with the API key, and resolves to the part of the answer it is for", async (c) => {
    fetchSpy.mockResolvedValueOnce(json(c.body));

    const result = await c.call(createDataApi(xrpl, env, passThroughCache));

    expect(result).toEqual(c.result);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = sentRequest();
    expect(request.method).toBe("GET");
    expect(request.url).toBe(`${BASE}${c.url}`);
    expect(request.headers.get("X-API-Key")).toBe("test-key");
  });

  /** What the API answers for a ledger by what is asked: its transactions in full, their hashes, or neither. */
  const ledgerAnswer = async (input: RequestInfo | URL) => {
    const query = new URL(input instanceof Request ? input.url : String(input)).searchParams;
    return json(query.get("expand") === "true" ? expandedLedgerBody : query.get("transactions") === "true" ? hashedLedgerBody : ledgerBody);
  };

  it("asks for the transactions whenever it asks for them in full, which the API otherwise leaves out of an empty ledger", async () => {
    fetchSpy.mockImplementation(ledgerAnswer);
    const api = createDataApi(xrpl, env, passThroughCache);
    const queryOf = async (opts?: { expand?: boolean; transactions?: boolean }) => {
      await api.ledger("107695660", opts);
      return new URL(sentRequest().url).search;
    };

    expect(await queryOf({ expand: true })).toBe("?expand=true&transactions=true");
    expect(await queryOf({ expand: true, transactions: false })).toBe("?expand=true&transactions=true");
    expect(await queryOf({ expand: true, transactions: true })).toBe("?expand=true&transactions=true");
    expect(await queryOf({ transactions: true })).toBe("?transactions=true");
    expect(await queryOf({ expand: false, transactions: false })).toBe("");
    expect(await queryOf()).toBe("");
  });

  it("an expanded ledger with no transactions has an empty list", async () => {
    fetchSpy.mockResolvedValueOnce(json({ ...ledgerBody, ledger: { ...ledgerBody.ledger, transactions: [] } }));

    const ledger = await createDataApi(xrpl, env, passThroughCache).ledger("107695660", { expand: true });

    expect(ledger.transactions).toEqual([]);
  });

  it("is an empty list for an expanded ledger when the answer leaves the key out (the API does for expand alone on an empty ledger)", async () => {
    fetchSpy.mockImplementation(async () => json(ledgerBody));
    const api = createDataApi(xrpl, env, passThroughCache);

    const expanded = await api.ledger("107695660", { expand: true });

    expect(expanded.transactions).toEqual([]);
    expect(expanded.ledger_index).toBe(107695660);
  });

  it("is not an empty list for the hashes of a ledger when the answer leaves the key out: it is always there, and a page would take the ledger for an empty one", async () => {
    fetchSpy.mockImplementation(async () => json(ledgerBody));
    const failure = await failureOf(createDataApi(xrpl, env, passThroughCache).ledger("107695660", { transactions: true }));
    expect(failure.kind).toBe("server");
  });

  it("leaves a ledger fetched without its transactions without a transactions key", async () => {
    fetchSpy.mockResolvedValueOnce(json(ledgerBody));

    const ledger = await createDataApi(xrpl, env, passThroughCache).ledger("107695660");

    expect("transactions" in ledger).toBe(false);
  });

  it("types the transactions of a ledger by what was asked for", async () => {
    fetchSpy.mockImplementation(ledgerAnswer);
    const api = createDataApi(xrpl, env, passThroughCache);

    const expanded = await api.ledger("107695660", { expand: true });
    const hashes = await api.ledger("107695660", { transactions: true });
    const plain = await api.ledger("107695660");

    expectTypeOf(expanded.transactions).toEqualTypeOf<TxObject[]>();
    expectTypeOf(hashes.transactions).toEqualTypeOf<string[]>();
    expectTypeOf(plain.transactions).toEqualTypeOf<string[] | TxObject[] | undefined>();
  });

  it("sends the key of the env it was created with", async () => {
    fetchSpy.mockResolvedValueOnce(json(lastValidatedBody));
    await createDataApi(xrpl, { ...env, DATA_API_KEY: "another-key" }, passThroughCache).lastValidated();
    expect(sentRequest().headers.get("X-API-Key")).toBe("another-key");
  });

  it("asks the host of the network it was created for, with or without a trailing slash in the setting", async () => {
    fetchSpy.mockImplementation(async () => json(lastValidatedBody));

    await createDataApi(xahau, env, passThroughCache).lastValidated();

    expect(sentRequest().url).toBe("https://xahau.data.example.invalid/v2/last_validated");
  });

  it("leaves descending and the marker out when they are not asked for", async () => {
    fetchSpy.mockResolvedValueOnce(json(transactionsBody));
    await createDataApi(xrpl, env, passThroughCache).transactions({});
    expect(sentRequest().url).toBe(`${BASE}/v2/transactions`);

    fetchSpy.mockResolvedValueOnce(json(transactionsBody));
    await createDataApi(xrpl, env, passThroughCache).transactions({ descending: false, limit: 5 });
    expect(sentRequest().url).toBe(`${BASE}/v2/transactions?limit=5`);
  });

  it("escapes a marker, which is opaque text", async () => {
    fetchSpy.mockResolvedValueOnce(json(transactionsBody));
    await createDataApi(xrpl, env, passThroughCache).transactions({ marker: "a+b/c=&d" });
    expect(new URL(sentRequest().url).searchParams.get("marker")).toBe("a+b/c=&d");
    expect(sentRequest().url).toBe(`${BASE}/v2/transactions?marker=a%2Bb%2Fc%3D%26d`);
  });

  it("escapes what it puts in a path, so an identifier cannot reach another endpoint", async () => {
    fetchSpy.mockResolvedValueOnce(json(transactionBody));
    // (The answer is the transaction of HASH, not of this identifier: the client says so, which does not matter here.)
    await createDataApi(xrpl, env, passThroughCache).transaction("AB/CD?x#y").catch(() => undefined);
    expect(sentRequest().url).toBe(`${BASE}/v2/transactions/AB%2FCD%3Fx%23y`);
  });

  it("leaves out what a query does not name: no metrics for an empty list, no display currency", async () => {
    fetchSpy.mockResolvedValue(json(statsMetricBody));
    await createDataApi(xrpl, env, passThroughCache).stats("metric", { interval: "day", ...PERIOD, limit: 1000, metrics: [] });
    expect(sentRequest().url).toBe(`${BASE}/v2/stats/metric?interval=day&start=2026-09-18&end=2026-10-17&limit=1000`);

    fetchSpy.mockResolvedValue(json(paymentVolumeBody));
    await createDataApi(xrpl, env, passThroughCache).paymentVolume({ interval: "day", ...PERIOD, limit: 1000 });
    expect(sentRequest().url).toBe(`${BASE}/v2/network/payment_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000`);
  });

  it("escapes the hash of the validations it puts in a path", async () => {
    fetchSpy.mockResolvedValueOnce(json(validationsBody));
    await createDataApi(xrpl, env, passThroughCache).ledgerValidations("AB/CD?x#y", { limit: 1000 });
    expect(sentRequest().url).toBe(`${BASE}/v2/ledgers/AB%2FCD%3Fx%23y/validations?limit=1000`);
  });

  it("types the rows of each call by what the reference gives it", () => {
    // A cache that answers nothing: only the types of the calls are looked at, and the promises are left alone.
    const api = createDataApi(xrpl, env, { json: () => new Promise<never>(() => {}) });
    const period = { interval: "day", ...PERIOD, limit: 1000 } as const;

    expectTypeOf(api.fees({ descending: true, limit: 8 })).toEqualTypeOf<Promise<Page<"rows", FeeRow>>>();
    expectTypeOf(api.fees({ interval: "day", start: "2026-09-18", end: "2026-10-17", limit: 1000 })).toEqualTypeOf<Promise<Page<"rows", FeeBucketRow>>>();
    expectTypeOf(api.feeStats({ descending: true, limit: 1, start: "2026-10-17" })).toEqualTypeOf<Promise<Page<"rows", FeeStatsRow>>>();
    expectTypeOf(api.stats("type", period)).toEqualTypeOf<Promise<Page<"stats", StatsRow>>>();
    expectTypeOf(api.paymentVolume(period)).toEqualTypeOf<Promise<Page<"rows", VolumeRow<PaymentVolumeComponent>>>>();
    expectTypeOf(api.exchangeVolume(period)).toEqualTypeOf<Promise<Page<"rows", VolumeRow<ExchangeVolumeComponent>>>>();
    expectTypeOf(api.ammVolume(period)).toEqualTypeOf<Promise<Page<"rows", VolumeRow<AmmVolumeComponent>>>>();
    expectTypeOf(api.ledgerValidations(HASH, { limit: 1000 })).toEqualTypeOf<Promise<LedgerValidations>>();
    expectTypeOf(api.pairExchanges(XRP_ASSET, RLUSD_ASSET, { limit: 20 })).toEqualTypeOf<Promise<Page<"exchanges", PairExchange>>>();
    expectTypeOf(api.pairCandles(XRP_ASSET, RLUSD_ASSET, { interval: "1hour", start: "2026-10-14T05:00:00Z", limit: 61 })).toEqualTypeOf<Promise<Page<"exchanges", Candle>>>();
    expectTypeOf(api.pairReduce(XRP_ASSET, RLUSD_ASSET, { start: "2026-10-16T17:01:00Z" })).toEqualTypeOf<Promise<ReducedRow>>();
    expectTypeOf(api.activeAccounts(XRP_ASSET, RLUSD_ASSET)).toEqualTypeOf<Promise<ActiveAccounts>>();
    expectTypeOf(api.networkMarkets({ period: "day", limit: 1000 })).toEqualTypeOf<Promise<MarketsResponse>>();
    // `change` is the one market key the reference lets a market go without (D2: left out where `open` is not above 0); the AMM keys are there only when known.
    expectTypeOf<MarketRow["change"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<MarketRow["amm_share"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<MarketRow["amm_pool"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<NonNullable<MarketsResponse["totals"]>["amm_share"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<MarketsResponse["amm"]>().toEqualTypeOf<"include" | "exclude" | "only" | undefined>();
  });

  it.each(["..", ".", ""])("refuses %j as an identifier without sending anything", async (id) => {
    const api = createDataApi(xrpl, env, passThroughCache);
    expect((await failureOf(api.ledger(id))).kind).toBe("bad_request");
    expect((await failureOf(api.transaction(id))).kind).toBe("bad_request");
    expect((await failureOf(api.account(id))).kind).toBe("bad_request");
    expect((await failureOf(api.ledgerValidations(id, { limit: 1000 }))).kind).toBe("bad_request");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  const api = () => createDataApi(xrpl, env, passThroughCache);

  it("404 is not_found, with the API's own words", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "transaction not found" }, { status: 404 }));

    const error = await failureOf(api().transaction(HASH));

    expect(error.kind).toBe("not_found");
    expect(error.status).toBe(404);
    expect(error.message).toContain("transaction not found");
    expect(error.name).toBe("UpstreamError");
    expect(error).toBeInstanceOf(Error);
  });

  // The data API's framework answers a path it has no route for (an API deployed without the sub-project that adds it) with this 404. It is
  // the API missing, not a thing that does not exist: an outage (spec 6.4), never a stored 404 page.
  it("a 404 'Cannot GET …' is server, whatever the route: the API has no such route", async () => {
    // amm_volume is the route an API without feat/amm-data lacks.
    const path = "/v2/network/amm_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000";
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: `Cannot GET ${path}` }, { status: 404 }));

    const error = await failureOf(api().ammVolume({ interval: "day", ...PERIOD, limit: 1000 }));

    expect(error.kind).toBe("server");
    expect(error.status).toBe(404);
    expect(error.message).toBe(`data API GET ${path} answered 404: Cannot GET ${path} (the data API has no such route)`);

    // A route with an id in it too: the rule is about the message, not about which routes may be missing.
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: `Cannot GET /v2/transactions/${HASH}` }, { status: 404 }));
    expect((await failureOf(api().transaction(HASH))).kind).toBe("server");
  });

  it.each([
    ["ledger not found", () => api().ledger("1")],
    ["Account not found", () => api().account(ACCOUNT)],
    ["validation not found", () => api().ledgerValidations(LEDGER_HASH, { limit: 1000 })],
    ["transaction not found: Cannot GET", () => api().transaction(HASH)],
  ])("a 404 '%s' is still not_found: only a message that starts with 'Cannot GET ' means a missing route", async (message, call) => {
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message }, { status: 404 }));

    const error = await failureOf(call());

    expect(error.kind).toBe("not_found");
    expect(error.status).toBe(404);
    expect(error.message).not.toContain("no such route");
  });

  it("a 404 without a message, or with one that is not text, is still not_found", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("<html>Not Found</html>", { status: 404, headers: { "Content-Type": "text/html" } }));
    expect((await failureOf(api().lastValidated())).kind).toBe("not_found");
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: { text: "Cannot GET /v2/last_validated" } }, { status: 404 }));
    expect((await failureOf(api().lastValidated())).kind).toBe("not_found");
  });

  it("the words 'Cannot GET' make only a 404 the missing-route outage: any other status keeps its own kind", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "Cannot GET /v2/last_validated" }, { status: 400 }));
    expect((await failureOf(api().lastValidated())).kind).toBe("bad_request");
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "Cannot GET /v2/last_validated" }, { status: 500 }));
    const error = await failureOf(api().lastValidated());
    expect(error.kind).toBe("server");
    expect(error.message).not.toContain("no such route");
  });

  describe("through the Worker's subrequest cache", () => {
    // A host of its own for each case: this file's Cache API and the hold outlive a test.
    const apiAt = (host: string) => {
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      return createDataApi(networkOf("xrpl", { ...env, XRPL_DATA_API_URL: `https://${host}.example.invalid` }), env, createSubrequestCache(ctx, "cannot-get"));
    };
    const cannotGet = async () => json({ result: "error", message: "Cannot GET /v2/last_validated" }, { status: 404 });

    it("is never stored: the next call asks the API again", async () => {
      fetchSpy.mockImplementation(cannotGet);
      const api = apiAt("cannot-get-stored");

      expect((await failureOf(api.lastValidated())).kind).toBe("server");
      expect((await failureOf(api.lastValidated())).kind).toBe("server");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("is held with holdFailure: one request, and both calls throw", async () => {
      fetchSpy.mockImplementation(cannotGet);
      const api = apiAt("cannot-get-held");

      const first = await failureOf(api.lastValidated({ holdFailure: true }));
      const second = await failureOf(api.lastValidated({ holdFailure: true }));

      expect(first.kind).toBe("server");
      expect(second).toBe(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // A failure that takes the whole 5 s deadline to come: while the probe of an expired hold waits for it, every render that starts is held,
    // so the API is asked once in a hold cycle and not by every render of the 5 s in which the call is out.
    it("asks an API that never answers once in a hold cycle: the calls that start while the probe waits get the held error", async () => {
      vi.useFakeTimers();
      fetchSpy.mockImplementation(() => new Promise<Response>(() => {}));
      const api = apiAt("timeout-probe");
      const ask = () => failureOf(api.lastValidated({ ttl: 0, holdFailure: true }));

      const first = ask();
      await vi.advanceTimersByTimeAsync(5_000);
      const timedOut = await first;
      expect(timedOut.kind).toBe("timeout");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Held for 5 s from the failure.
      await vi.advanceTimersByTimeAsync(4_999);
      expect(await ask()).toBe(timedOut);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Over: the next call is the probe, and waits out its own 5 s. A beat of every tab in that time is held.
      await vi.advanceTimersByTimeAsync(1);
      const probe = ask();
      const beats: Promise<UpstreamError>[] = [];
      for (let beat = 0; beat < 9; beat += 1) {
        await vi.advanceTimersByTimeAsync(500);
        beats.push(ask());
      }
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      for (const beat of beats) expect(await beat).toBe(timedOut);

      // The probe times out in turn: its failure is held for 5 s more, and nothing is asked.
      await vi.advanceTimersByTimeAsync(500);
      const found = await probe;
      expect(found.kind).toBe("timeout");
      expect(await ask()).toBe(found);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // And the cycle goes on: held to 5 s, a probe after it.
      await vi.advanceTimersByTimeAsync(5_001);
      void ask().catch(() => {});
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  it("400 is bad_request", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "invalid marker" }, { status: 400 }));

    const error = await failureOf(api().transactions({ marker: "x" }));

    expect(error.kind).toBe("bad_request");
    expect(error.status).toBe(400);
    expect(error.message).toContain("invalid marker");
  });

  it("429 with Retry-After: 4 is rate_limited, 4 seconds", async () => {
    fetchSpy.mockResolvedValueOnce(
      json({ error: "Rate limit exceeded, retry in 3.27sec" }, { status: 429, headers: { "Retry-After": "4" } }),
    );

    const error = await failureOf(api().lastValidated());

    expect(error.kind).toBe("rate_limited");
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(4);
  });

  it("429 without a usable Retry-After has no retryAfter", async () => {
    fetchSpy.mockResolvedValueOnce(json({ error: "Rate limit exceeded" }, { status: 429 }));
    expect((await failureOf(api().lastValidated())).retryAfter).toBeUndefined();

    fetchSpy.mockResolvedValueOnce(json({}, { status: 429, headers: { "Retry-After": "soon" } }));
    expect((await failureOf(api().lastValidated())).retryAfter).toBeUndefined();
  });

  it("500 is server, with the status", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "unable to retrieve ledger" }, { status: 500 }));

    const error = await failureOf(api().ledger("1"));

    expect(error.kind).toBe("server");
    expect(error.status).toBe(500);
    expect(error.message).toContain("unable to retrieve ledger");
  });

  it("a proxy's HTML error page is server too, and a Retry-After on it is kept", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>Bad gateway</html>", { status: 503, headers: { "Retry-After": "7", "Content-Type": "text/html" } }),
    );

    const error = await failureOf(api().lastValidated());

    expect(error.kind).toBe("server");
    expect(error.status).toBe(503);
    expect(error.retryAfter).toBe(7);
  });

  it("a rejected key (401) is a server-side problem, not something the visitor did", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "Missing or invalid API key." }, { status: 401 }));

    const error = await failureOf(api().lastValidated());

    expect(error.kind).toBe("server");
    expect(error.status).toBe(401);
  });

  it("does not follow a redirect, which would carry the key to wherever it points", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: "https://elsewhere.invalid/" } }));

    const error = await failureOf(api().lastValidated());

    expect(error.kind).toBe("server");
    expect(error.status).toBe(301);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentRequest().redirect).toBe("manual");
  });

  it("a connection that fails is network, and keeps its cause", async () => {
    const cause = new TypeError("Network connection lost.");
    fetchSpy.mockRejectedValueOnce(cause);

    const error = await failureOf(api().lastValidated());

    expect(error.kind).toBe("network");
    expect(error.status).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  it("an answer that is not JSON is server", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("<html>hello</html>", { status: 200 }));

    expect((await failureOf(api().lastValidated())).kind).toBe("server");
  });

  it("an answer without the part the client unwraps is server", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "success" }));

    expect((await failureOf(api().transaction(HASH))).kind).toBe("server");
  });
});

describe("timeout", () => {
  it("gives up on a request that never answers after 5 s, and aborts it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    fetchSpy.mockImplementation((_input, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    let settled = false;
    const outcome = createDataApi(xrpl, env, passThroughCache)
      .lastValidated()
      .then(
        () => "resolved",
        (reason: unknown) => reason,
      )
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;

    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).kind).toBe("timeout");
    expect((error as UpstreamError).status).toBeUndefined();
    expect(signal?.aborted).toBe(true);
  });

  it("reports a timeout, not an abort, when the request gives up as soon as it is aborted", async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
        }),
    );
    const outcome = createDataApi(xrpl, env, passThroughCache)
      .lastValidated()
      .then(
        () => "resolved",
        (reason: unknown) => reason,
      );

    await vi.advanceTimersByTimeAsync(5000);

    expect(((await outcome) as UpstreamError).kind).toBe("timeout");
  });

  it("covers reading the body, not only the headers", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const outcome = createDataApi(xrpl, env, passThroughCache)
      .lastValidated()
      .then(
        () => "resolved",
        (reason: unknown) => reason,
      );

    await vi.advanceTimersByTimeAsync(5000);

    expect(((await outcome) as UpstreamError).kind).toBe("timeout");
  });

  it("does not leave its timer running after an answer", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValueOnce(json(lastValidatedBody));

    await createDataApi(xrpl, env, passThroughCache).lastValidated();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("cache", () => {
  it.each(cases)("$name is stored as $cls", async (c) => {
    const cache = recordingCache();
    fetchSpy.mockResolvedValueOnce(json(c.body));

    await c.call(createDataApi(xrpl, env, cache));

    expect(cache.calls).toHaveLength(1);
    expect(cache.calls[0]!.cls).toBe(c.cls);
    expect(cache.calls[0]!.ttlOverride).toBeUndefined();
    // The key is the request, so equal requests share an entry.
    expect(cache.calls[0]!.key).toContain(`${BASE}${c.url}`);
  });

  // The polling pages (the home page, the network page) ask for the failure hold on their calls (spec 1.7). It is the cache's option, not a part of
  // the call's key: a call that asks and one that does not share their entries.
  describe("the failure hold, which a polled call asks for", () => {
    const answer = async (input: RequestInfo | URL) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      return json(
        path.endsWith("/last_validated") ? lastValidatedBody : path.endsWith("/fees") ? feesBody : path.includes("/ledgers/") ? ledgerBody : transactionsBody,
      );
    };
    const q = { descending: true, limit: 8 };

    it("is passed to the cache by lastValidated, fees, transactions and ledger when asked, and by nothing else", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(answer);
      const api = createDataApi(xrpl, env, cache);

      await api.lastValidated({ ttl: 2, holdFailure: true });
      await api.fees(q, { holdFailure: true });
      await api.transactions(q, { holdFailure: true });
      await api.ledger("1", { holdFailure: true });
      expect(cache.calls.map((call) => call.holdFailure)).toEqual([true, true, true, true]);
      expect(cache.calls[0]!.ttlOverride).toBe(2);

      cache.calls.length = 0;
      await api.lastValidated({ ttl: 2 });
      await api.fees(q, { ttl: 2 });
      await api.transactions(q);
      await api.ledger("1");
      await api.lastValidated({ holdFailure: false });
      expect(cache.calls.map((call) => "holdFailure" in call)).toEqual([false, false, false, false, false]);
    });

    it("is not part of a key: the same call, with it and without, is the same entry", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(answer);
      const api = createDataApi(xrpl, env, cache);

      await api.lastValidated({ ttl: 2 });
      await api.lastValidated({ ttl: 2, holdFailure: true });
      await api.fees(q);
      await api.fees(q, { holdFailure: true });
      await api.transactions(q);
      await api.transactions(q, { holdFailure: true });
      await api.ledger("1");
      await api.ledger("1", { holdFailure: true });

      const keys = cache.calls.map((call) => call.key);
      expect(keys[0]).toBe(keys[1]);
      expect(keys[2]).toBe(keys[3]);
      expect(keys[4]).toBe(keys[5]);
      expect(keys[6]).toBe(keys[7]);
      expect(new Set(keys).size).toBe(4);
    });

    it("is passed on for a page after a marker too, whose TTL it ignores", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(answer);

      await createDataApi(xrpl, env, cache).transactions({ ...q, marker: "m" }, { ttl: 2, holdFailure: true });

      expect(cache.calls).toHaveLength(1);
      expect(cache.calls[0]!.ttlOverride).toBeUndefined();
      expect(cache.calls[0]!.holdFailure).toBe(true);
    });
  });

  it("a page after a marker is kept longer than a first page only when the list is newest first", async () => {
    const cache = recordingCache();
    fetchSpy.mockImplementation(async () => json(transactionsBody));
    const api = createDataApi(xrpl, env, cache);

    await api.transactions({ limit: 20, marker: "m" });
    await api.accountTransactions(ACCOUNT, { descending: false, limit: 20, marker: "m" });

    expect(cache.calls.map((c) => c.cls)).toEqual(["live", "live"]);
  });

  // The home page follows the chain (a ledger every 3-4 s), so it asks for its three calls at HOME_CALL_TTL_SECONDS: a little longer than the
  // edge's 1 s, so that a refresh at the edge finds them warm, and about a ledger at the most. Nothing else is shortened: the ledger page and the
  // image route read lastValidated at its class (5 s), and a list reached with a marker keeps the class it has.
  describe("the home page's calls, asked for at HOME_CALL_TTL_SECONDS", () => {
    const ttl = HOME_CALL_TTL_SECONDS;

    it("is 2 s, a little longer than the edge's 1 s", () => {
      expect(ttl).toBe(2);
      expect(ttl).toBeGreaterThan(CACHE_CLASSES["live-home"].edgeTtl);
      expect(ttl).toBeLessThan(CACHE_CLASSES.live.edgeTtl);
    });

    it("keeps the class of the call and overrides only its TTL, for lastValidated, fees and the first page of transactions", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async (input) => {
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        return json(path.endsWith("/last_validated") ? lastValidatedBody : path.endsWith("/fees") ? feesBody : transactionsBody);
      });
      const api = createDataApi(xrpl, env, cache);

      await api.lastValidated({ ttl });
      await api.fees({ descending: true, limit: 8 }, { ttl });
      await api.transactions({ descending: true, limit: 8 }, { ttl });

      expect(cache.calls.map(({ cls, ttlOverride }) => ({ cls, ttlOverride }))).toEqual([
        { cls: "live", ttlOverride: 2 },
        { cls: "live", ttlOverride: 2 },
        { cls: "live", ttlOverride: 2 },
      ]);
    });

    it("has a key of its own, so that an answer kept for the call's own class is not what the home page reads", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async () => json(lastValidatedBody));
      const api = createDataApi(xrpl, env, cache);
      await api.lastValidated();
      await api.lastValidated({ ttl });
      await api.lastValidated({ ttl });
      const [plain, short, again] = cache.calls.map((call) => call.key);
      expect(plain).toBe(`GET ${BASE}/v2/last_validated`);
      expect(short).not.toBe(plain);
      expect(short).toContain(`${BASE}/v2/last_validated`);
      expect(again).toBe(short);
    });

    it("is not applied to a list reached with a marker, in either direction: it keeps what it had", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async () => json(transactionsBody));
      const api = createDataApi(xrpl, env, cache);

      await api.transactions({ descending: true, limit: 8, marker: "m" }, { ttl });
      await api.transactions({ descending: false, limit: 8, marker: "m" }, { ttl });

      expect(cache.calls.map(({ cls, ttlOverride }) => ({ cls, ttlOverride }))).toEqual([
        { cls: MARKER_PAGE_CLASS },
        { cls: "live" },
      ]);
    });

    it("is not what a call without it does: lastValidated, fees and transactions are `live`, with no override", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async (input) => {
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        return json(path.endsWith("/last_validated") ? lastValidatedBody : path.endsWith("/fees") ? feesBody : transactionsBody);
      });
      const api = createDataApi(xrpl, env, cache);
      await api.lastValidated();
      await api.fees({ descending: true, limit: 8 });
      await api.transactions({ descending: true, limit: 8 });
      expect(cache.calls.map(({ cls, ttlOverride }) => ({ cls, ttlOverride }))).toEqual([{ cls: "live" }, { cls: "live" }, { cls: "live" }]);
    });
  });

  // The network page's calls: the home page's kind of call (`holdFailure`, and `ttl` for the two it keeps 2 s), and the six over a period, kept
  // PERIOD_CALL_TTL_SECONDS (spec 1.4). Each keeps the class it has and overrides only the TTL, in an entry of its own.
  describe("the network page's calls", () => {
    const freshCases = cases.filter((c) => c.fresh);
    const periodCases = freshCases.filter((c) => c.cls === "slow");

    it("keep the class of the call, whatever TTL they are asked for, and pass the failure hold on", async () => {
      for (const c of freshCases) {
        const cache = recordingCache();
        fetchSpy.mockResolvedValueOnce(json(c.body));

        await c.call(createDataApi(xrpl, env, cache), { ttl: PERIOD_CALL_TTL_SECONDS, holdFailure: true });

        expect(cache.calls, c.name).toHaveLength(1);
        expect(cache.calls[0]!.cls, c.name).toBe(c.cls);
        expect(cache.calls[0]!.ttlOverride, c.name).toBe(300);
        expect(cache.calls[0]!.holdFailure, c.name).toBe(true);
        expect(cache.calls[0]!.key, c.name).toBe(`GET ${BASE}${c.url} [kept 300 s]`);
      }
    });

    it("send the failure hold to the cache only when it is asked for, and it is no part of a key", async () => {
      for (const c of freshCases) {
        const cache = recordingCache();
        fetchSpy.mockImplementation(async () => json(c.body));
        const api = createDataApi(xrpl, env, cache);

        await c.call(api);
        await c.call(api, { holdFailure: false });
        await c.call(api, { holdFailure: true });
        await c.call(api, { ttl: 2 });
        await c.call(api, { ttl: 2, holdFailure: true });

        expect(cache.calls.map((call) => call.holdFailure), c.name).toEqual([undefined, undefined, true, undefined, true]);
        const keys = cache.calls.map((call) => call.key);
        expect(new Set(keys.slice(0, 3)).size, c.name).toBe(1);
        expect(new Set(keys.slice(3)).size, c.name).toBe(1);
        // The answer kept for the call's own class is not what a call with a TTL of its own reads.
        expect(keys[3], c.name).not.toBe(keys[0]);
        expect(keys[3], c.name).toBe(`${keys[0]} [kept 2 s]`);
      }
    });

    it("are `slow` for the six over a period (the stats, the fees by day and the three volumes) and `live` for the snapshot and the validations", () => {
      expect(periodCases.map((c) => c.name)).toEqual([
        "fees by day",
        "stats of the transaction types",
        "stats of the metrics",
        "paymentVolume",
        "paymentVolume, in another currency",
        "exchangeVolume",
        "exchangeVolume, in another currency",
        "ammVolume",
        "ammVolume, in another currency",
      ]);
      expect(freshCases.filter((c) => c.cls === "live").map((c) => c.name)).toEqual(["feeStats", "ledgerValidations"]);
    });

    it("are really stored for 300 s (the period calls) or 2 s (the snapshot), and the validations for 5 s by class", async () => {
      const puts: Array<string | null> = [];
      const put = caches.default.put.bind(caches.default);
      vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
        puts.push((response as Response).headers.get("Cache-Control"));
        return put(request, response);
      });
      const pending: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
      // A host of its own: this file's Cache API outlives the test.
      const network = networkOf("xrpl", { ...env, XRPL_DATA_API_URL: "https://stored-for-five-minutes.example.invalid" });
      const api = createDataApi(network, env, createSubrequestCache(ctx, "period-ttl-test"));
      fetchSpy.mockImplementation(async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        return json(freshCases.find((c) => c.url === url.pathname + url.search)!.body);
      });
      const storedBy = async (c: Case, opts?: FreshOptions) => {
        puts.length = 0;
        await c.call(api, opts);
        await Promise.all(pending.splice(0));
        return [...puts];
      };

      for (const c of periodCases) expect(await storedBy(c, { ttl: PERIOD_CALL_TTL_SECONDS }), c.name).toEqual(["public, max-age=300"]);
      const snapshot = freshCases.find((c) => c.name === "feeStats")!;
      const validations = freshCases.find((c) => c.name === "ledgerValidations")!;
      expect(await storedBy(snapshot, { ttl: HOME_CALL_TTL_SECONDS })).toEqual(["public, max-age=2"]);
      expect(await storedBy(validations)).toEqual(["public, max-age=5"]);
    });
  });

  it("really stores the answers for the TTL the call asks for: 5 s by class, 2 s for the home page's, an hour after a marker", async () => {
    // The Worker's own subrequest cache, not a recording: the Cache-Control it puts on an entry is what the Cache API expires it by.
    const puts: Array<string | null> = [];
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.push((response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    // A host of its own: this file's Cache API outlives the test.
    const network = networkOf("xrpl", { ...env, XRPL_DATA_API_URL: "https://stored-for-a-second.example.invalid" });
    const api = createDataApi(network, env, createSubrequestCache(ctx, "ttl-test"));
    fetchSpy.mockImplementation(async (input) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      return json(path.endsWith("/last_validated") ? lastValidatedBody : path.endsWith("/fees") ? feesBody : path.endsWith("/balances") ? balancesBody : transactionsBody);
    });
    const storedBy = async (call: () => Promise<unknown>) => {
      puts.length = 0;
      await call();
      await Promise.all(pending.splice(0));
      return [...puts];
    };

    expect(await storedBy(() => api.lastValidated())).toEqual(["public, max-age=5"]);
    // Its own entry: an answer kept 5 s for the ledger page must not be what the home page reads, which would be up to 5 s old.
    expect(await storedBy(() => api.lastValidated({ ttl: 2 }))).toEqual(["public, max-age=2"]);
    expect(await storedBy(() => api.fees({ descending: true, limit: 8 }, { ttl: 2 }))).toEqual(["public, max-age=2"]);
    expect(await storedBy(() => api.transactions({ descending: true, limit: 8 }, { ttl: 2 }))).toEqual(["public, max-age=2"]);
    expect(await storedBy(() => api.balances(ACCOUNT))).toEqual(["public, max-age=5"]);
    // A page of the list reached with a marker keeps its own class, whatever TTL is asked.
    expect(await storedBy(() => api.transactions({ descending: true, limit: 8, marker: "WzEwNzY3MDM2MCw1XQ" }, { ttl: 2 }))).toEqual(["public, max-age=3600"]);
  });

  // A deliberate deviation from spec 2 (which has them immutable): data-api-new's range backfill, `--reprocess` and gap repair write history
  // below the frontier, so a marker is stable only at the head. MARKER_PAGE_CLASS says where to flip it back once backfill is finished.
  it("keeps a page after a marker for an hour, not a year, while history can still be rewritten", () => {
    expect(MARKER_PAGE_CLASS).toBe("slow");
    expect(CACHE_CLASSES[MARKER_PAGE_CLASS].edgeTtl).toBe(3600);
  });

  it("does not look in the cache for the request it refuses", async () => {
    const cache = recordingCache();
    await failureOf(createDataApi(xrpl, env, cache).ledger(".."));
    expect(cache.calls).toEqual([]);
  });

  it("keys the two networks apart", async () => {
    const cache = recordingCache();
    fetchSpy.mockImplementation(async () => json(lastValidatedBody));

    await createDataApi(xrpl, env, cache).lastValidated();
    await createDataApi(xahau, env, cache).lastValidated();

    expect(new Set(cache.calls.map((c) => c.key)).size).toBe(2);
  });

  it("passes on what the cache gives back, without asking the data API", async () => {
    const cached = { ...lastValidatedBody, ledger_index: "1" };
    const cache = { json: async () => cached } as never;

    expect(await createDataApi(xrpl, env, cache).lastValidated()).toBe(cached);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a failed request leaves nothing behind for a cache to keep", async () => {
    // The client throws out of `load`; a cache that stores only what `load` returns stores nothing here.
    const store = new Map<string, unknown>();
    const cache = {
      async json<T>(key: string, _cls: CacheClass, load: () => Promise<T>): Promise<T> {
        if (store.has(key)) return store.get(key) as T;
        const value = await load();
        store.set(key, value);
        return value;
      },
    };
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "transaction not found" }, { status: 404 }));
    fetchSpy.mockResolvedValueOnce(json(transactionBody));
    const api = createDataApi(xrpl, env, cache);

    await failureOf(api.transaction(HASH));
    expect(await api.transaction(HASH)).toEqual(txObject);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(1);
  });
});

/**
 * The Worker's own subrequest cache over a host of its own (this file's Cache API outlives a test): `storedBy` runs a call and answers the
 * `Cache-Control` of every entry it stored, which is what the Cache API expires the entry by.
 */
function storing(host: string) {
  const puts: Array<string | null> = [];
  const put = caches.default.put.bind(caches.default);
  vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
    puts.push((response as Response).headers.get("Cache-Control"));
    return put(request, response);
  });
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const network = networkOf("xrpl", { ...env, XRPL_DATA_API_URL: `https://${host}.example.invalid` });
  const api = createDataApi(network, env, createSubrequestCache(ctx, host));
  const storedBy = async (call: (api: DataApi) => Promise<unknown>) => {
    puts.length = 0;
    await call(api);
    await Promise.all(pending.splice(0));
    return [...puts];
  };
  return { api, storedBy };
}

/**
 * For the calls of one key that overlap: `overlapped(calls)` polls until that many reads of the Cache API have been answered (each call has missed it,
 * and so has joined the flight of its key or started it) and the fetch spy has been called, then yields one turn more, in which a call that had not
 * joined the flight would have made a request of its own. No time is slept.
 */
function overlapping() {
  const match = caches.default.match.bind(caches.default);
  let answered = 0;
  vi.spyOn(caches.default, "match").mockImplementation(async (request, options) => {
    try {
      return await match(request, options);
    } finally {
      answered += 1;
    }
  });
  return async (calls: number) => {
    await vi.waitFor(
      () => {
        expect(answered).toBe(calls);
        expect(fetchSpy).toHaveBeenCalled();
      },
      { interval: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

// The pair page's calls and the markets table's (markets spec 3.3): each is kept for the class the page needs, and its answer is checked inside the load.
describe("the pair page's and the markets page's calls", () => {
  const recording = () => {
    const cache = recordingCache();
    return { cache, api: createDataApi(xrpl, env, cache) };
  };

  describe("the missing route and the failure hold", () => {
    // Failure tests first, each on a host of its own: the Cache API and the hold of this file outlive a test.
    it("a 404 'Cannot GET' for the markets route (a data API without D2) is kind server, and is never stored: the next call asks again", async () => {
      const { api, storedBy } = storing("markets-cannot-get");
      const cannotGet = async () => json({ result: "error", message: "Cannot GET /v2/network/markets?limit=1000&period=day" }, { status: 404 });
      fetchSpy.mockImplementation(cannotGet);

      const first = await failureOf(api.networkMarkets({ period: "day", limit: 1000 }));
      expect(first.kind).toBe("server");
      expect(first.status).toBe(404);
      expect(first.message).toContain("(the data API has no such route)");
      expect(await storedBy(() => api.networkMarkets({ period: "day", limit: 1000 }).catch(() => undefined))).toEqual([]);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("is held with holdFailure: one request, and both calls throw the same error", async () => {
      const { api } = storing("markets-cannot-get-held");
      fetchSpy.mockImplementation(async () => json({ result: "error", message: "Cannot GET /v2/network/markets?limit=1000&period=day" }, { status: 404 }));

      const first = await failureOf(api.networkMarkets({ period: "day", limit: 1000 }, { holdFailure: true }));
      const second = await failureOf(api.networkMarkets({ period: "day", limit: 1000 }, { holdFailure: true }));

      expect(first.kind).toBe("server");
      expect(second).toBe(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("any other 404 of a pair route stays not_found: a pair the API has no trades of is an answer of its own", async () => {
      const { api } = recording();
      fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "pair not found" }, { status: 404 }));

      expect((await failureOf(api.pairExchanges(XRP_ASSET, RLUSD_ASSET, { limit: 20 }))).kind).toBe("not_found");
    });

    it("a 400 of a pair route (an invalid marker, an issuer that is none) is bad_request", async () => {
      const { api } = recording();
      fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "invalid marker" }, { status: 400 }));

      expect((await failureOf(api.pairExchanges(XRP_ASSET, RLUSD_ASSET, { limit: 20, marker: "x" }))).kind).toBe("bad_request");
    });
  });

  describe("pairExchanges", () => {
    const q = { descending: true, limit: 20 };

    it("is class `live` and, with a ttl, an entry of its own that says so (`[kept 2 s]`); the failure hold is no part of a key", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(pairExchangesBody));

      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, q);
      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, q, { holdFailure: true });
      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, q, { ttl: HOME_CALL_TTL_SECONDS });
      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, q, { ttl: HOME_CALL_TTL_SECONDS, holdFailure: true });

      expect(cache.calls.map((call) => call.cls)).toEqual(["live", "live", "live", "live"]);
      expect(cache.calls.map((call) => call.ttlOverride)).toEqual([undefined, undefined, 2, 2]);
      expect(cache.calls.map((call) => call.holdFailure)).toEqual([undefined, true, undefined, true]);
      const [plain, held, kept, keptHeld] = cache.calls.map((call) => call.key);
      expect(plain).toBe(`GET ${BASE}${PAIR_PATH}?descending=true&limit=20`);
      expect(held).toBe(plain);
      expect(kept).toBe(`${plain} [kept 2 s]`);
      expect(keptHeld).toBe(kept);
    });

    it("keeps MARKER_PAGE_CLASS for a page after a marker, newest first, and ignores the ttl: that page has no entry of its own", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(pairExchangesBody));

      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, { ...q, marker: "WzEwNzY3MDM2MCw1XQ" }, { ttl: HOME_CALL_TTL_SECONDS, holdFailure: true });
      // Oldest first, a list grows at its end: a page after a marker is `live` there.
      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, { limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" });

      expect(MARKER_PAGE_CLASS).toBe("slow");
      expect(cache.calls.map((call) => call.cls)).toEqual([MARKER_PAGE_CLASS, "live"]);
      expect(cache.calls[0]!.ttlOverride).toBeUndefined();
      expect(cache.calls[0]!.key).not.toContain("[kept");
      expect(cache.calls[0]!.holdFailure).toBe(true);
    });

    it("has an entry for each filter and each orientation, so that none is read for another", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(pairExchangesBody));

      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, q);
      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, { ...q, amm: "exclude" });
      await api.pairExchanges(XRP_ASSET, RLUSD_ASSET, { ...q, amm: "only" });
      await api.pairExchanges(RLUSD_ASSET, XRP_ASSET, q);

      expect(new Set(cache.calls.map((call) => call.key)).size).toBe(4);
    });

    it("sends the filter in the query and never `include`: the type has no such value, so that the keys are the same before and after feat/amm-data", () => {
      expectTypeOf<NonNullable<Parameters<DataApi["pairExchanges"]>[2]["amm"]>>().toEqualTypeOf<"exclude" | "only">();
    });

    it.each([
      ["a base with no currency", { currency: "" }, RLUSD_ASSET],
      ["a counter with no currency", XRP_ASSET, { currency: "" }],
    ])("refuses %s before anything is sent or looked up: its segment would be resolved away", async (_what, base, counter) => {
      const { cache, api } = recording();

      expect((await failureOf(api.pairExchanges(base, counter, q))).kind).toBe("bad_request");
      expect((await failureOf(api.pairCandles(base, counter, { interval: "1hour", start: "2026-10-14T05:00:00Z", limit: 61 }))).kind).toBe("bad_request");
      expect((await failureOf(api.pairReduce(base, counter, { start: "2026-10-16T17:01:00Z" }))).kind).toBe("bad_request");
      expect((await failureOf(api.activeAccounts(base, counter))).kind).toBe("bad_request");
      expect(cache.calls).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sends an asset as CUR+issuer with the `+` escaped, and the native currency alone", async () => {
      const { api } = recording();
      fetchSpy.mockImplementation(async () => json(pairExchangesBody));

      await api.pairExchanges({ currency: "USD", issuer: USD_ISSUER }, XRP_ASSET, q);

      expect(sentRequest().url).toBe(`${BASE}/v2/exchanges/USD%2B${USD_ISSUER}/XRP?descending=true&limit=20`);
    });
  });

  describe("pairCandles", () => {
    const hourly = { interval: "1hour", start: "2026-10-14T05:00:00Z", limit: 61 } as const;

    it("is stored 5 s by default (class live), 60 s as class minute, and 300 s as class slow kept 300 s", async () => {
      const { storedBy } = storing("candles-stored");
      fetchSpy.mockImplementation(async () => json(pairCandlesBody));

      expect(await storedBy((a) => a.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, interval: "15minute" }))).toEqual(["public, max-age=5"]);
      expect(await storedBy((a) => a.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, interval: "4hour" }, { cls: "minute" }))).toEqual(["public, max-age=60"]);
      expect(await storedBy((a) => a.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, interval: "7day" }, { cls: "slow", ttl: PERIOD_CALL_TTL_SECONDS }))).toEqual([
        "public, max-age=300",
      ]);
    });

    it("passes the class, the ttl and the failure hold of the page on; the class is `live` without one", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(pairCandlesBody));

      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, hourly);
      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, hourly, { holdFailure: true });
      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, interval: "1day" }, { cls: "minute", holdFailure: true });
      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, interval: "7day" }, { cls: "slow", ttl: PERIOD_CALL_TTL_SECONDS, holdFailure: true });

      expect(cache.calls.map((call) => call.cls)).toEqual(["live", "live", "minute", "slow"]);
      expect(cache.calls.map((call) => call.ttlOverride)).toEqual([undefined, undefined, undefined, 300]);
      expect(cache.calls.map((call) => call.holdFailure)).toEqual([undefined, true, true, true]);
      expect(cache.calls[3]!.key).toMatch(/interval=7day.* \[kept 300 s\]$/);
    });

    it("has an entry for each interval, window and filter, so that none is read for another", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(pairCandlesBody));

      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, hourly);
      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, interval: "4hour" });
      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, start: "2026-10-14T06:00:00Z" });
      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, end: "2026-10-17T00:00:00Z" });
      await api.pairCandles(XRP_ASSET, RLUSD_ASSET, { ...hourly, amm: "only" });

      expect(new Set(cache.calls.map((call) => call.key)).size).toBe(5);
    });
  });

  describe("pairReduce", () => {
    it("is class `live` and takes the options of a polled call", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(pairReduceBody));
      const q = { start: "2026-10-16T17:01:00Z" };

      await api.pairReduce(XRP_ASSET, RLUSD_ASSET, q);
      await api.pairReduce(XRP_ASSET, RLUSD_ASSET, q, { ttl: 5, holdFailure: true });

      expect(cache.calls.map((call) => call.cls)).toEqual(["live", "live"]);
      expect(cache.calls.map((call) => call.ttlOverride)).toEqual([undefined, 5]);
      expect(cache.calls.map((call) => call.holdFailure)).toEqual([undefined, true]);
      expect(cache.calls[1]!.key).toBe(`${cache.calls[0]!.key} [kept 5 s]`);
    });

    it("has an entry for each filter", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(pairReduceBody));
      const q = { start: "2026-10-16T17:01:00Z" };

      await api.pairReduce(XRP_ASSET, RLUSD_ASSET, q);
      await api.pairReduce(XRP_ASSET, RLUSD_ASSET, { ...q, amm: "exclude" });
      await api.pairReduce(XRP_ASSET, RLUSD_ASSET, { ...q, amm: "only" });

      expect(new Set(cache.calls.map((call) => call.key)).size).toBe(3);
    });

    it("takes the row of a window with no trade: prices 0.0000000, volumes 0, no open_time or close_time", async () => {
      const { api } = recording();
      const { open_time: _open, close_time: _close, ...bare } = pairReduceRow;
      const empty = { ...bare, open: "0.0000000", high: "0.0000000", low: "0.0000000", close: "0.0000000", vwap: "0.0000000", base_volume: "0", counter_volume: "0", buy_volume: 0, count: 0 };
      fetchSpy.mockResolvedValueOnce(json({ result: "success", count: 1, exchanges: [empty] }));

      expect(await api.pairReduce(XRP_ASSET, RLUSD_ASSET, { start: "2026-10-16T17:01:00Z" })).toEqual(empty);
    });
  });

  describe("activeAccounts", () => {
    const twelve = {
      result: "success",
      count: 12,
      exchanges_count: 36,
      accounts: Array.from({ length: 12 }, (_value, index) => activeAccount(index + 1)),
    };

    it("keeps the first 10 of 12 accounts, in the order the API sorted them (by base volume), and the counts as the API gave them", async () => {
      const { api } = recording();
      fetchSpy.mockResolvedValueOnce(json(twelve));

      const answer = await api.activeAccounts(XRP_ASSET, RLUSD_ASSET);

      expect(ACTIVE_ACCOUNTS_KEPT).toBe(10);
      expect(answer.accounts).toEqual(twelve.accounts.slice(0, 10));
      expect(answer.accounts.map((account) => account.account)).toEqual(Array.from({ length: 10 }, (_value, index) => `rActive${String(index + 1).padStart(2, "0")}`));
      expect(answer.count).toBe(12);
      expect(answer.exchanges_count).toBe(36);
      expect(answer.result).toBe("success");
    });

    it("stores the 10, not the 12: the cut is made before the subrequest cache keeps it", async () => {
      const cache = new Map<string, unknown>();
      const api = createDataApi(xrpl, env, {
        async json<T>(key: string, _cls: CacheClass, load: () => Promise<T>) {
          const value = await load();
          cache.set(key, value);
          return value;
        },
      });
      fetchSpy.mockResolvedValueOnce(json(twelve));

      await api.activeAccounts(XRP_ASSET, RLUSD_ASSET);

      expect([...cache.values()].map((value) => (value as { accounts: unknown[] }).accounts.length)).toEqual([10]);
    });

    it("leaves a short list as it is", async () => {
      const { api } = recording();
      fetchSpy.mockResolvedValueOnce(json(activeAccountsBody));

      expect((await api.activeAccounts(XRP_ASSET, RLUSD_ASSET)).accounts).toHaveLength(2);
    });

    it("is stored 60 s: class minute", async () => {
      const { storedBy } = storing("active-accounts-stored");
      fetchSpy.mockImplementation(async () => json(twelve));

      expect(await storedBy((a) => a.activeAccounts(XRP_ASSET, RLUSD_ASSET))).toEqual(["public, max-age=60"]);
    });

    it("takes the options of a polled call", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(activeAccountsBody));

      await api.activeAccounts(XRP_ASSET, RLUSD_ASSET, { holdFailure: true });
      await api.activeAccounts(XRP_ASSET, RLUSD_ASSET, { ttl: 30 });

      expect(cache.calls.map((call) => call.cls)).toEqual(["minute", "minute"]);
      expect(cache.calls.map((call) => call.holdFailure)).toEqual([true, undefined]);
      expect(cache.calls.map((call) => call.ttlOverride)).toEqual([undefined, 30]);
      expect(cache.calls[1]!.key).toBe(`${cache.calls[0]!.key} [kept 30 s]`);
    });
  });

  describe("networkMarkets", () => {
    it("is stored 60 s by its class, with no TTL of its own", async () => {
      const { storedBy } = storing("markets-stored");
      fetchSpy.mockImplementation(async () => json(marketsBody));

      expect(await storedBy((a) => a.networkMarkets({ period: "day", limit: 1000 }))).toEqual(["public, max-age=60"]);
      expect(CACHE_CLASSES.minute.edgeTtl).toBe(60);
    });

    it("passes the failure hold and a ttl on; a ttl is an entry of its own", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async () => json(marketsBody));
      const q = { period: "day", limit: 1000 } as const;

      await api.networkMarkets(q);
      await api.networkMarkets(q, { holdFailure: true });
      await api.networkMarkets(q, { ttl: 20 });

      expect(cache.calls.map((call) => call.cls)).toEqual(["minute", "minute", "minute"]);
      expect(cache.calls.map((call) => call.holdFailure)).toEqual([undefined, true, undefined]);
      expect(cache.calls.map((call) => call.ttlOverride)).toEqual([undefined, undefined, 20]);
      expect(cache.calls[1]!.key).toBe(cache.calls[0]!.key);
      expect(cache.calls[2]!.key).toBe(`${cache.calls[0]!.key} [kept 20 s]`);
    });

    it("has an entry for each period and each filter, so that none is read for another", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(async (input) => {
        const query = new URL(input instanceof Request ? input.url : String(input)).searchParams;
        const amm = query.get("amm");
        return json({ ...(amm ? marketsWithAmm(amm as "exclude" | "only") : marketsBody), period: query.get("period") });
      });

      for (const period of ["day", "7day", "30day"] as const) {
        await api.networkMarkets({ period, limit: 1000 });
        await api.networkMarkets({ period, limit: 1000, amm: "exclude" });
        await api.networkMarkets({ period, limit: 1000, amm: "only" });
      }

      expect(new Set(cache.calls.map((call) => call.key)).size).toBe(9);
    });

    it("takes the answer to a filter that echoes it, and keeps what the API wrote of the shares", async () => {
      const { api } = recording();
      for (const amm of ["exclude", "only"] as const) {
        fetchSpy.mockResolvedValueOnce(json(marketsWithAmm(amm)));
        const answer = await api.networkMarkets({ period: "day", limit: 1000, amm });
        expect(answer.amm).toBe(amm);
        expect(answer.totals?.amm_share).toBe("0.2150");
        expect(answer.markets[0]).toMatchObject({ amm_share: "0.3400", amm_pool: true });
      }
    });

    it("takes the Xahau answer, whose shares are 0.0000 and whose pools are false (the page ignores them there)", async () => {
      const { api } = recording();
      const answer = { ...marketsBody, totals: { ...marketsBody.totals, amm_share: "0.0000" }, markets: [{ ...marketRow, amm_share: "0.0000", amm_pool: false }] };
      fetchSpy.mockResolvedValueOnce(json(answer));

      expect(await createDataApi(xahau, env, passThroughCache).networkMarkets({ period: "day", limit: 1000 })).toEqual(answer);
      expect(sentRequest().url).toBe("https://xahau.data.example.invalid/v2/network/markets?limit=1000&period=day");
    });
  });
});

// The AMM pool calls (E5; `feat/amm-data` c3e2302, the bodies are test/support/amm-samples.ts's): the pools list, one pool by its account or by its pair, a pool's days, swaps,
// liquidity events and governance, and the live form of `ammVolume`. Each is kept for the class its page needs and its answer is checked inside the load (amm-shape.ts), so that
// a 200 that is not what the reference promises is kind `server` and is never stored. A route the API lacks answers `Cannot GET …` (kind `server`: an outage, never a missing pool);
// a pool it lacks answers `pool not found` (`not_found`).
describe("the AMM pool calls", () => {
  let mock: UpstreamMock | undefined;
  afterEach(() => {
    mock?.restore();
    mock = undefined;
  });

  let poolNumber = 0;
  /** A pool no other test uses: this file's Cache API outlives a test. */
  const freshPool = () => ammPoolAccount((poolNumber += 1));

  let builds = 0;
  /** The client over the Worker's own subrequest cache, as a page has it, under a build id of its own, with the upstream mock answering as `overrides` say. */
  function throughCache(overrides: Overrides) {
    const upstream = (mock = mockUpstream("xrpl", overrides));
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    builds += 1;
    return { api: createDataApi(xrpl, env, createSubrequestCache(ctx, `amm-calls-${builds}`)), mock: upstream };
  }

  /** What the data API answers a request of these calls, by its path: a good answer, for the pool asked for where the path names one. */
  function ammAnswer(input: RequestInfo | URL): Response {
    const parts = new URL(input instanceof Request ? input.url : String(input)).pathname.split("/").filter(Boolean);
    if (parts[1] === "network") return json(ammLiveVolumeSample());
    const [, , , pool, tail] = parts;
    if (pool === undefined) return json(ammPoolsSample());
    if (tail === "history") return json(ammDaysSample());
    if (tail === "swaps") return json(ammSwapsSample());
    if (tail === "liquidity") return json(ammLiquidityPageSample());
    if (tail === "governance") return json(ammGovernanceSample());
    // A pool by its account is that pool; by its pair, the sample's.
    return json({ result: "success", pool: ammPoolSample(tail === undefined ? { amm_account: pool } : {}) });
  }

  interface AmmCall {
    name: string;
    /** Whether the route is one of a pool (it answers `pool not found` for a pool the API does not have), or the list or the volume. */
    ofPool: boolean;
    call: (api: DataApi, pool: string) => Promise<unknown>;
    /** The override key of the request `call` makes, with its query in alphabetical order. */
    key: (pool: string) => string;
    /** A good answer to it. */
    good: (pool: string) => any;
    /** The key a pool is unwrapped from, if the answer has one. */
    unwrap?: "pool";
    /** What makes `good` an answer the check refuses, and the field the message names. */
    broken: (body: any) => void;
    field: string;
  }
  const poolBroken = (body: any) => (body.pool.trading_fee = 1001);
  const calls: AmmCall[] = [
    {
      name: "ammPool",
      ofPool: true,
      call: (api, pool) => api.ammPool(pool),
      key: (pool) => `GET /v2/amm/pools/${pool}`,
      good: (pool) => ({ result: "success", pool: ammPoolSample({ amm_account: pool }) }),
      unwrap: "pool",
      broken: poolBroken,
      field: "trading_fee",
    },
    {
      name: "ammPoolByPair",
      ofPool: true,
      call: (api, pool) => api.ammPoolByPair(XRP_ASSET, { currency: "USD", issuer: pool }),
      key: (pool) => `GET /v2/amm/pools/XRP/USD+${pool}`,
      good: () => ({ result: "success", pool: ammPoolSample() }),
      unwrap: "pool",
      broken: poolBroken,
      field: "trading_fee",
    },
    {
      name: "ammPoolDays",
      ofPool: true,
      call: (api, pool) => api.ammPoolDays(pool, { end: "2026-10-17", limit: 1000 }),
      key: (pool) => `GET /v2/amm/pools/${pool}/history?end=2026-10-17&interval=day&limit=1000`,
      good: () => ammDaysSample(),
      broken: (body) => (body.days[0].swap_count = "3"),
      field: "swap_count",
    },
    {
      name: "ammSwaps",
      ofPool: true,
      call: (api, pool) => api.ammSwaps(pool, { descending: true, limit: 20 }),
      key: (pool) => `GET /v2/amm/pools/${pool}/swaps?descending=true&limit=20`,
      good: () => ammSwapsSample(),
      broken: (body) => delete body.exchanges[0].amm_account,
      field: "amm_account",
    },
    {
      name: "ammLiquidity",
      ofPool: true,
      call: (api, pool) => api.ammLiquidity(pool, { descending: true, limit: 20 }),
      key: (pool) => `GET /v2/amm/pools/${pool}/liquidity?descending=true&limit=20`,
      good: () => ammLiquidityPageSample(),
      broken: (body) => (body.liquidity[0].event = "mint"),
      field: "event",
    },
    {
      name: "ammGovernance",
      ofPool: true,
      call: (api, pool) => api.ammGovernance(pool, { descending: true, limit: 20 }),
      key: (pool) => `GET /v2/amm/pools/${pool}/governance?descending=true&limit=20`,
      good: () => ammGovernanceSample(),
      broken: (body) => (body.governance[0].type = "both"),
      field: "type",
    },
    {
      name: "ammPools",
      ofPool: false,
      call: (api) => api.ammPools({ limit: 20 }),
      key: () => "GET /v2/amm/pools?limit=20",
      good: () => ammPoolsSample(),
      broken: (body) => (body.pools[0].deleted = "false"),
      field: "deleted",
    },
    {
      name: "ammVolume, live",
      ofPool: false,
      call: (api) => api.ammVolume({ live: "day" }),
      key: () => "GET /v2/network/amm_volume?live=day",
      good: () => ammLiveVolumeSample(),
      broken: (body) => body.rows.push(structuredClone(body.rows[0])),
      field: "rows",
    },
  ];
  const everyCall = calls.map((c) => [c.name, c] as const);
  const poolCalls = everyCall.filter(([, c]) => c.ofPool);

  // Failure tests first, each on a build id and a pool of its own.
  describe("a pool the data API does not have, and a route it does not have", () => {
    it.each(poolCalls)("%s: `pool not found` is not_found, with the API's own words", async (_name, c) => {
      const pool = freshPool();
      const { api } = throughCache({ [c.key(pool)]: dataApiError(404, "pool not found") });

      const error = await failureOf(c.call(api, pool));

      expect(error.kind).toBe("not_found");
      expect(error.status).toBe(404);
      expect(error.message).toContain("pool not found");
    });

    it.each(everyCall)("%s: `Cannot GET …` (a data API without feat/amm-data) is kind server, the API missing and not a pool; nothing is stored or held", async (_name, c) => {
      const pool = freshPool();
      const key = c.key(pool);
      const { api, mock: seen } = throughCache({ [key]: dataApiError(404, `Cannot GET ${key.slice("GET ".length)}`) });

      const first = await failureOf(c.call(api, pool));
      const second = await failureOf(c.call(api, pool));

      expect(first.kind).toBe("server");
      expect(first.status).toBe(404);
      expect(first.message).toContain("(the data API has no such route)");
      expect(second.kind).toBe("server");
      expect(statusesOf(seen, key)).toEqual([404, 404]);
    });

    it.each(everyCall)("%s: the mock's own absent answer (a `null` override) is what the API says: `pool not found` for a pool's routes, `Cannot GET` for the list and the volume", async (_name, c) => {
      const pool = freshPool();
      const { api } = throughCache({ [c.key(pool)]: null });

      const error = await failureOf(c.call(api, pool));

      expect(error.kind).toBe(c.ofPool ? "not_found" : "server");
      expect(error.message).toContain(c.ofPool ? "pool not found" : "Cannot GET");
    });

    it("a 400 (an invalid pool, an invalid marker) is bad_request, and a 503 is server", async () => {
      const pool = freshPool();
      const { api } = throughCache({
        [`GET /v2/amm/pools/${pool}/swaps?descending=true&limit=20`]: dataApiError(400, "invalid marker"),
        [`GET /v2/amm/pools/${pool}`]: dataApiError(503, "unavailable"),
      });

      expect((await failureOf(api.ammSwaps(pool, { descending: true, limit: 20 }))).kind).toBe("bad_request");
      expect((await failureOf(api.ammPool(pool))).kind).toBe("server");
    });
  });

  describe("an answer that is not what the reference promises", () => {
    it.each(everyCall)("%s: is kind server (status 200, the field named), and is not stored: the next call asks the API again", async (_name, c) => {
      const pool = freshPool();
      const key = c.key(pool);
      const body = c.good(pool);
      c.broken(body);
      const { api, mock: seen } = throughCache({ [key]: body });

      const first = await failureOf(c.call(api, pool));
      const second = await failureOf(c.call(api, pool));

      expect(first.kind).toBe("server");
      expect(first.status).toBe(200);
      expect(first.message).toContain(c.field);
      expect(second.kind).toBe("server");
      expect(statusesOf(seen, key)).toEqual([200, 200]);
    });

    it("ammPool answered with another pool's amm_account is kind server, and not stored", async () => {
      const asked = freshPool();
      const other = freshPool();
      const key = `GET /v2/amm/pools/${asked}`;
      const { api, mock: seen } = throughCache({ [key]: { result: "success", pool: ammPoolSample({ amm_account: other }) } });

      const first = await failureOf(api.ammPool(asked));
      await failureOf(api.ammPool(asked));

      expect(first.kind).toBe("server");
      expect(first.status).toBe(200);
      expect(first.message).toContain("amm_account");
      expect(first.message).toContain(asked);
      expect(first.message).toContain(other);
      expect(statusesOf(seen, key)).toEqual([200, 200]);
    });

    it.each([
      ["ammPool", (api: DataApi, pool: string) => api.ammPool(pool), (pool: string) => `GET /v2/amm/pools/${pool}`],
      ["ammPoolByPair", (api: DataApi, pool: string) => api.ammPoolByPair(XRP_ASSET, { currency: "USD", issuer: pool }), (pool: string) => `GET /v2/amm/pools/XRP/USD+${pool}`],
    ])("%s: an answer without its `pool` is kind server", async (_name, call, key) => {
      const pool = freshPool();
      const { api } = throughCache({ [key(pool)]: { result: "success" } });

      const error = await failureOf(call(api, pool));

      expect(error.kind).toBe("server");
      expect(error.status).toBe(200);
      expect(error.message).toContain('"pool"');
    });
  });

  describe("a good answer", () => {
    it.each(everyCall)("%s: is what the API said (the pool under `pool` unwrapped), through the Worker's own cache", async (_name, c) => {
      const pool = freshPool();
      const body = c.good(pool);
      const { api } = throughCache({ [c.key(pool)]: body });

      expect(await c.call(api, pool)).toEqual(c.unwrap ? body[c.unwrap] : body);
    });

    it("takes the amounts as BigNumber writes them (a dust reserve), and a pool the index has not seen the creation of", async () => {
      const pool = freshPool();
      const bare = { amm_account: pool, base_currency: "USD", counter_currency: "XRP", reserve_base: "1.5e-7", last_ledger: 107717584, deleted: true };
      const { api } = throughCache({ [`GET /v2/amm/pools/${pool}`]: { result: "success", pool: bare } });

      expect(await api.ammPool(pool)).toEqual(bare);
    });
  });

  describe("what is stored, and for how long", () => {
    it("keeps the pools, a pool, a pool by its pair and the live volume a minute (class minute)", async () => {
      const pool = freshPool();
      const { storedBy } = storing("amm-stored-minute");
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));

      expect(await storedBy((a) => a.ammPools({ limit: 20 }))).toEqual(["public, max-age=60"]);
      expect(await storedBy((a) => a.ammPool(pool))).toEqual(["public, max-age=60"]);
      expect(await storedBy((a) => a.ammPoolByPair(XRP_ASSET, { currency: "USD", issuer: pool }))).toEqual(["public, max-age=60"]);
      expect(await storedBy((a) => a.ammVolume({ live: "day" }))).toEqual(["public, max-age=60"]);
      expect(CACHE_CLASSES.minute.edgeTtl).toBe(60);
    });

    it("keeps a pool's days 300 s (class slow, kept PERIOD_CALL_TTL_SECONDS), under an entry of its own", async () => {
      const pool = freshPool();
      const { storedBy } = storing("amm-stored-days");
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));

      expect(await storedBy((a) => a.ammPoolDays(pool, { end: "2026-10-17", limit: 1000 }))).toEqual(["public, max-age=300"]);
      expect(PERIOD_CALL_TTL_SECONDS).toBe(300);
    });

    it("keeps the first page of the swaps 5 s (class live) and a page behind a marker, newest first, MARKER_PAGE_CLASS's 3600 s", async () => {
      const pool = freshPool();
      const { storedBy } = storing("amm-stored-swaps");
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));

      expect(await storedBy((a) => a.ammSwaps(pool, { descending: true, limit: 20 }))).toEqual(["public, max-age=5"]);
      expect(await storedBy((a) => a.ammSwaps(pool, { limit: 20 }))).toEqual(["public, max-age=5"]);
      expect(await storedBy((a) => a.ammSwaps(pool, { descending: true, limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" }))).toEqual(["public, max-age=3600"]);
      // Oldest first, a list grows at its end: a page behind a marker is the newest rows still.
      expect(await storedBy((a) => a.ammSwaps(pool, { limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" }))).toEqual(["public, max-age=5"]);
      expect(MARKER_PAGE_CLASS).toBe("slow");
      expect(CACHE_CLASSES[MARKER_PAGE_CLASS].edgeTtl).toBe(3600);
    });

    it("keeps the liquidity events like the swaps, and the create event an hour (class slow)", async () => {
      const pool = freshPool();
      const { storedBy } = storing("amm-stored-liquidity");
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));

      expect(await storedBy((a) => a.ammLiquidity(pool, { descending: true, limit: 20 }))).toEqual(["public, max-age=5"]);
      expect(await storedBy((a) => a.ammLiquidity(pool, { descending: true, limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" }))).toEqual(["public, max-age=3600"]);
      expect(await storedBy((a) => a.ammLiquidity(pool, { event: "create", limit: 1 }))).toEqual(["public, max-age=3600"]);
    });

    it("keeps the governance rows like the swaps", async () => {
      const pool = freshPool();
      const { storedBy } = storing("amm-stored-governance");
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));

      expect(await storedBy((a) => a.ammGovernance(pool, { descending: true, limit: 20 }))).toEqual(["public, max-age=5"]);
      expect(await storedBy((a) => a.ammGovernance(pool, { descending: true, limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" }))).toEqual(["public, max-age=3600"]);
    });

    it("asks the cache for each call's class, and for a TTL only on the days; the volume's live form is class minute, its historical form class slow", async () => {
      const cache = recordingCache();
      const api = createDataApi(xrpl, env, cache);
      const pool = freshPool();
      const marker = "WzEwNzY3MDM2MCw1XQ";
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));

      await api.ammPools({ limit: 20 });
      await api.ammPool(pool);
      await api.ammPoolByPair(XRP_ASSET, RLUSD_ASSET);
      await api.ammPoolDays(pool, { end: "2026-10-17", limit: 1000 });
      await api.ammSwaps(pool, { descending: true, limit: 20 });
      await api.ammSwaps(pool, { descending: true, limit: 20, marker });
      await api.ammLiquidity(pool, { limit: 20 });
      await api.ammLiquidity(pool, { event: "create", limit: 1 });
      await api.ammGovernance(pool, { limit: 20 });
      await api.ammGovernance(pool, { descending: true, limit: 20, marker });
      await api.ammVolume({ live: "day" });
      await api.ammVolume({ interval: "day", ...PERIOD, limit: 1000 });

      expect(cache.calls.map(({ cls, ttlOverride }) => ({ cls, ttlOverride }))).toEqual([
        { cls: "minute" },
        { cls: "minute" },
        { cls: "minute" },
        { cls: "slow", ttlOverride: PERIOD_CALL_TTL_SECONDS },
        { cls: "live" },
        { cls: MARKER_PAGE_CLASS },
        { cls: "live" },
        { cls: "slow" },
        { cls: "live" },
        { cls: MARKER_PAGE_CLASS },
        { cls: "minute" },
        { cls: "slow" },
      ]);
      expect(cache.calls[3]!.key).toBe(`GET ${BASE}/v2/amm/pools/${pool}/history?interval=day&end=2026-10-17&limit=1000 [kept 300 s]`);
      // The two forms of the volume are two entries.
      expect(cache.calls[10]!.key).toBe(`GET ${BASE}/v2/network/amm_volume?live=day`);
      expect(cache.calls[11]!.key).toBe(`GET ${BASE}/v2/network/amm_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000`);
    });

    it("has an entry for each filter, window and page, so that none is read for another; the failure hold is no part of the live volume's key", async () => {
      const cache = recordingCache();
      const api = createDataApi(xrpl, env, cache);
      const pool = freshPool();
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));

      await api.ammPools({ limit: 20 });
      await api.ammPools({ limit: 20, asset: RLUSD_ASSET });
      await api.ammPools({ limit: 20, includeDeleted: true });
      await api.ammPools({ limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" });
      await api.ammPoolDays(pool, { end: "2026-10-17", limit: 1000 });
      await api.ammPoolDays(pool, { end: "2026-10-17", descending: true, limit: 1 });
      await api.ammPoolDays(pool, { start: "2026-07-20", end: "2026-10-17", limit: 1000 });
      await api.ammLiquidity(pool, { limit: 20 });
      await api.ammLiquidity(pool, { event: "create", limit: 20 });
      expect(new Set(cache.calls.map((call) => call.key)).size).toBe(9);

      cache.calls.length = 0;
      await api.ammVolume({ live: "day" });
      await api.ammVolume({ live: "day" }, { holdFailure: true });
      expect(cache.calls.map((call) => call.holdFailure)).toEqual([undefined, true]);
      expect(cache.calls[1]!.key).toBe(cache.calls[0]!.key);
    });
  });

  describe("the requests", () => {
    const api = () => createDataApi(xrpl, env, passThroughCache);
    beforeEach(() => {
      fetchSpy.mockImplementation(async (input) => ammAnswer(input));
    });

    it("asks for the pools with limit, asset, include_deleted and marker, in that order; an asset is CUR+issuer with the + escaped, the native currency alone", async () => {
      await api().ammPools({ limit: 20, asset: RLUSD_ASSET, includeDeleted: true });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools?limit=20&asset=${RLUSD_CODE}%2B${RLUSD_ISSUER}&include_deleted=true`);

      await api().ammPools({ limit: 20, asset: XRP_ASSET, includeDeleted: false, marker: "WzEwNzY3MDM2MCw1XQ" });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools?limit=20&asset=XRP&marker=WzEwNzY3MDM2MCw1XQ`);

      await api().ammPools({ limit: 20, marker: "" });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools?limit=20`);
    });

    it("asks for a pool by its account, and by its pair in the order given with each asset as the exchanges' path has it", async () => {
      await api().ammPool(AMM_POOL);
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}`);

      await api().ammPoolByPair(XRP_ASSET, RLUSD_ASSET);
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/XRP/${RLUSD_CODE}%2B${RLUSD_ISSUER}`);

      await api().ammPoolByPair(RLUSD_ASSET, XRP_ASSET);
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${RLUSD_CODE}%2B${RLUSD_ISSUER}/XRP`);
    });

    it("asks for the days with interval=day first, then start, end, descending and limit; start and descending are left out when there are none", async () => {
      await api().ammPoolDays(AMM_POOL, { end: "2026-07-19", descending: true, limit: 1 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/history?interval=day&end=2026-07-19&descending=true&limit=1`);

      await api().ammPoolDays(AMM_POOL, { start: "2026-07-20", end: "2026-10-17", limit: 1000 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/history?interval=day&start=2026-07-20&end=2026-10-17&limit=1000`);

      await api().ammPoolDays(AMM_POOL, { start: "2026-07-20", end: "2026-10-17", descending: false, limit: 1000 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/history?interval=day&start=2026-07-20&end=2026-10-17&limit=1000`);
    });

    it("asks for the swaps, the liquidity events and the governance rows with descending, limit and marker; the create event first", async () => {
      await api().ammSwaps(AMM_POOL, { descending: true, limit: 20 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/swaps?descending=true&limit=20`);

      await api().ammSwaps(AMM_POOL, { descending: true, limit: 20, marker: "WzEwNzY3MDM2MCw1XQ" });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/swaps?descending=true&limit=20&marker=WzEwNzY3MDM2MCw1XQ`);

      await api().ammLiquidity(AMM_POOL, { descending: true, limit: 20 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/liquidity?descending=true&limit=20`);

      await api().ammLiquidity(AMM_POOL, { event: "create", limit: 1 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/liquidity?event=create&limit=1`);

      await api().ammGovernance(AMM_POOL, { descending: true, limit: 20 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/${AMM_POOL}/governance?descending=true&limit=20`);
    });

    it("asks for the live volume with live=day alone, and the historical volume as it always did", async () => {
      await api().ammVolume({ live: "day" });
      expect(sentRequest().url).toBe(`${BASE}/v2/network/amm_volume?live=day`);

      await api().ammVolume({ interval: "day", ...PERIOD, limit: 1000 });
      expect(sentRequest().url).toBe(`${BASE}/v2/network/amm_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000`);
    });

    it("escapes the pool it puts in a path", async () => {
      await api().ammPoolDays("AB/CD?x#y", { end: "2026-10-17", limit: 1000 });
      expect(sentRequest().url).toBe(`${BASE}/v2/amm/pools/AB%2FCD%3Fx%23y/history?interval=day&end=2026-10-17&limit=1000`);
    });

    it.each(["..", ".", ""])("refuses %j as a pool without sending anything: its segment would be resolved away", async (pool) => {
      const client = api();

      expect((await failureOf(client.ammPool(pool))).kind).toBe("bad_request");
      expect((await failureOf(client.ammPoolDays(pool, { end: "2026-10-17", limit: 1000 }))).kind).toBe("bad_request");
      expect((await failureOf(client.ammSwaps(pool, { limit: 20 }))).kind).toBe("bad_request");
      expect((await failureOf(client.ammLiquidity(pool, { limit: 20 }))).kind).toBe("bad_request");
      expect((await failureOf(client.ammGovernance(pool, { limit: 20 }))).kind).toBe("bad_request");
      expect((await failureOf(client.ammPoolByPair(XRP_ASSET, { currency: "" }))).kind).toBe("bad_request");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("types the answer of each call by what the reference gives it", () => {
    // A cache that answers nothing: only the types of the calls are looked at, and the promises are left alone.
    const api = createDataApi(xrpl, env, { json: () => new Promise<never>(() => {}) });

    expectTypeOf(api.ammPools({ limit: 20 })).toEqualTypeOf<Promise<Page<"pools", AmmPool>>>();
    expectTypeOf(api.ammPool(AMM_POOL)).toEqualTypeOf<Promise<AmmPool>>();
    expectTypeOf(api.ammPoolByPair(XRP_ASSET, RLUSD_ASSET)).toEqualTypeOf<Promise<AmmPool>>();
    expectTypeOf(api.ammPoolDays(AMM_POOL, { end: "2026-10-17", limit: 1000 })).toEqualTypeOf<Promise<Page<"days", AmmPoolDay>>>();
    expectTypeOf(api.ammSwaps(AMM_POOL, { limit: 20 })).toEqualTypeOf<Promise<Page<"exchanges", AmmSwap>>>();
    expectTypeOf(api.ammLiquidity(AMM_POOL, { limit: 20 })).toEqualTypeOf<Promise<Page<"liquidity", AmmLiquidityEvent>>>();
    expectTypeOf(api.ammGovernance(AMM_POOL, { limit: 20 })).toEqualTypeOf<Promise<Page<"governance", AmmGovernanceRow>>>();
    expectTypeOf(api.ammVolume({ live: "day" })).toEqualTypeOf<Promise<Page<"rows", AmmVolumeRow>>>();
    expectTypeOf(api.ammVolume({ interval: "day", ...PERIOD, limit: 1000 })).toEqualTypeOf<Promise<Page<"rows", VolumeRow<AmmVolumeComponent>>>>();
    // The only event the page asks the liquidity route for is the creation.
    expectTypeOf<NonNullable<Parameters<DataApi["ammLiquidity"]>[1]["event"]>>().toEqualTypeOf<"create">();
  });
});

// The Analytics tab of the account page's calls (E4 spec 2.3, 2.6 and 2.7): D2's `stats/{family}` and `analytics/*` routes. Each is kept a minute (class `minute`),
// held on failure and shared in flight, and checked inside the load; the counterparties call, which D2 expects to take seconds for a heavy account, is given 15 s.
describe("the account analytics calls", () => {
  const START = "2026-09-18";
  const OTHER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
  const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
  const WINDOW = { start: "2026-09-18T00:00:00Z", end: "2026-10-18T00:00:00Z" };

  // The answers, in the shapes of D2's built reference (the ones analytics-shape.test.ts takes).
  const valueBody = { result: "success", count: 2, rows: [{ date: "2026-10-16T00:00:00Z", account_value: "100.5", balance_change_count: 2 }, { date: "2026-10-17T00:00:00Z", account_value: "98", balance_change_count: 1 }] };
  const transactionsBody = {
    result: "success",
    count: 1,
    rows: [{ date: "2026-10-17T00:00:00Z", transaction_count: 3, result: { tesSUCCESS: 3 }, type: { Payment: 2, TrustSet: 1 } }],
  };
  const balancesBody = {
    result: "success",
    ...WINDOW,
    interval: "day",
    lines_total: 2,
    lines: [{ currency: "XRP", balance: "98" }, { currency: "USD", counterparty: ISSUER, balance: "20" }],
    count: 2,
    rows: [{ date: "2026-10-17T00:00:00Z", currency: "XRP", balance: "98" }, { date: "2026-10-17T00:00:00Z", currency: "USD", counterparty: ISSUER, balance: "20" }],
  };
  const changesBody = {
    result: "success",
    ...WINDOW,
    interval: "day",
    totals: [{ change_type: "payment_source", count: 2, in_value: "0", out_value: "12", net_value: "-12" }],
    count: 1,
    rows: [{ date: "2026-10-17T00:00:00Z", change_type: "payment_source", count: 2, in_value: "0", out_value: "12" }],
  };
  const counterpartiesBody = {
    result: "success",
    ...WINDOW,
    sort: "value",
    total: 1,
    count: 1,
    counterparties: [
      { account: OTHER, sent_value: "15", received_value: "24", total_value: "39", payments_sent: 2, payments_received: 3, first: "2026-09-20T09:00:00Z", last: "2026-10-15T09:00:00Z" },
    ],
  };
  const exchangesBody = {
    result: "success",
    ...WINDOW,
    total: 1,
    count: 1,
    pairs: [
      {
        base_currency: "USD",
        base_issuer: ISSUER,
        counter_currency: "XRP",
        count: 4,
        base_volume: "35.5",
        counter_volume: "13.25",
        bought: "15.5",
        sold: "21",
        bought_counter: "8.25",
        sold_counter: "5.25",
        native_volume: "13.25",
      },
    ],
  };

  const dayQuery = { interval: "day", limit: 1000, start: START } as const;
  type AnalyticsCase = {
    name: string;
    call: (api: DataApi, address?: string) => Promise<unknown>;
    /** Path and query of the request, after the host (the account is `ACCOUNT`). */
    url: string;
    body: unknown;
    /** A change that makes the answer one that is not what the reference promises (a daily row under `week` and the like). */
    broken: (copy: any) => void;
  };
  const analyticsCases: AnalyticsCase[] = [
    {
      name: "accountStats value",
      call: (api, address = ACCOUNT) => api.accountStats(address, "value", dayQuery),
      url: `/v2/accounts/${ACCOUNT}/stats/value?interval=day&limit=1000&start=${START}`,
      body: valueBody,
      broken: (copy) => (copy.rows[0].account_value = 100.5),
    },
    {
      name: "accountStats transactions",
      call: (api, address = ACCOUNT) => api.accountStats(address, "transactions", dayQuery),
      url: `/v2/accounts/${ACCOUNT}/stats/transactions?interval=day&limit=1000&start=${START}`,
      body: transactionsBody,
      broken: (copy) => (copy.marker = "MjAyNi0xMC0xNw"),
    },
    {
      name: "analyticsBalances",
      call: (api, address = ACCOUNT) => api.analyticsBalances(address, { interval: "day", limit: 4, start: START }),
      url: `/v2/accounts/${ACCOUNT}/analytics/balances?interval=day&limit=4&start=${START}`,
      body: balancesBody,
      broken: (copy) => (copy.interval = "week"),
    },
    {
      name: "analyticsBalanceChanges",
      call: (api, address = ACCOUNT) => api.analyticsBalanceChanges(address, { interval: "day", start: START }),
      url: `/v2/accounts/${ACCOUNT}/analytics/balance_changes?interval=day&start=${START}`,
      body: changesBody,
      broken: (copy) => delete copy.interval,
    },
    {
      name: "analyticsCounterparties",
      call: (api, address = ACCOUNT) => api.analyticsCounterparties(address, { limit: 6, start: START }),
      url: `/v2/accounts/${ACCOUNT}/analytics/counterparties?limit=6&start=${START}`,
      body: counterpartiesBody,
      broken: (copy) => (copy.counterparties[0].account = "rrrrUBy92h6worVCYERZcVCzgzgmHb17Dx"),
    },
    {
      name: "analyticsExchanges",
      call: (api, address = ACCOUNT) => api.analyticsExchanges(address, { limit: 6, start: START }),
      url: `/v2/accounts/${ACCOUNT}/analytics/exchanges?limit=6&start=${START}`,
      body: exchangesBody,
      broken: (copy) => (copy.pairs[0].count = "4"),
    },
  ];
  /** What the fixture host answers: the body of the route asked for. */
  const answerByPath = async (input: RequestInfo | URL) => {
    const { pathname, search } = new URL(input instanceof Request ? input.url : String(input));
    const found = analyticsCases.find((c) => c.url === pathname + search);
    if (!found) throw new Error(`unexpected request ${pathname}${search}`);
    return json(found.body);
  };

  describe("the requests", () => {
    it.each(analyticsCases)("$name asks for its route, with its query in the order of the call, and the key", async (c) => {
      fetchSpy.mockResolvedValueOnce(json(c.body));

      const answer = await c.call(createDataApi(xrpl, env, passThroughCache));

      expect(answer).toEqual(c.body);
      expect(sentRequest().url).toBe(`${BASE}${c.url}`);
      expect(sentRequest().method).toBe("GET");
      expect(sentRequest().headers.get("X-API-Key")).toBe("test-key");
    });

    it("sends the interval of the call, whichever it is, and keeps the order: interval, limit, start", async () => {
      const api = createDataApi(xrpl, env, passThroughCache);
      // Rows dated on the start of a bucket of the interval asked for, so that the checks take the answers.
      fetchSpy.mockResolvedValueOnce(json({ ...valueBody, rows: [{ date: "2026-10-12T00:00:00Z", account_value: "1", balance_change_count: 1 }] }));
      fetchSpy.mockResolvedValueOnce(json({ ...valueBody, rows: [{ date: "2026-10-01T00:00:00Z", account_value: "1", balance_change_count: 1 }] }));

      await api.accountStats(ACCOUNT, "value", { interval: "week", limit: 1000, start: "2026-07-20" });
      expect(sentRequest().url).toBe(`${BASE}/v2/accounts/${ACCOUNT}/stats/value?interval=week&limit=1000&start=2026-07-20`);
      await api.accountStats(ACCOUNT, "value", { interval: "month", limit: 1000, start: "2025-07-01" });
      expect(sentRequest().url).toBe(`${BASE}/v2/accounts/${ACCOUNT}/stats/value?interval=month&limit=1000&start=2025-07-01`);
    });

    it("asks the host of the network it was created for", async () => {
      fetchSpy.mockResolvedValueOnce(json(counterpartiesBody));

      await createDataApi(xahau, env, passThroughCache).analyticsCounterparties(ACCOUNT, { limit: 6, start: START });

      expect(sentRequest().url).toBe(`https://xahau.data.example.invalid/v2/accounts/${ACCOUNT}/analytics/counterparties?limit=6&start=${START}`);
    });

    it.each(analyticsCases)("$name refuses an address that would be resolved away as a path (empty, . and ..) before any call, and escapes the rest", async (c) => {
      const api = createDataApi(xrpl, env, passThroughCache);
      for (const address of ["", ".", ".."]) expect((await failureOf(c.call(api, address))).kind).toBe("bad_request");
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockResolvedValueOnce(json(c.body));
      await c.call(api, "a/b?c");
      expect(new URL(sentRequest().url).pathname).toContain("/accounts/a%2Fb%3Fc/");
    });

    it("types the answers by what the reference gives them", () => {
      // A cache that answers nothing: only the types of the calls are looked at, and the promises are left alone.
      const api = createDataApi(xrpl, env, { json: () => new Promise<never>(() => {}) });

      expectTypeOf(api.accountStats(ACCOUNT, "value", dayQuery)).toEqualTypeOf<Promise<Page<"rows", AccountValueRow>>>();
      expectTypeOf(api.accountStats(ACCOUNT, "transactions", dayQuery)).toEqualTypeOf<Promise<Page<"rows", AccountTxStatsRow>>>();
      expectTypeOf(api.analyticsBalances(ACCOUNT, { interval: "week", limit: 4, start: START })).toEqualTypeOf<Promise<AnalyticsBalances>>();
      expectTypeOf(api.analyticsBalanceChanges(ACCOUNT, { interval: "month", start: START })).toEqualTypeOf<Promise<AnalyticsBalanceChanges>>();
      expectTypeOf(api.analyticsCounterparties(ACCOUNT, { limit: 6, start: START })).toEqualTypeOf<Promise<AnalyticsCounterparties>>();
      expectTypeOf(api.analyticsExchanges(ACCOUNT, { limit: 6, start: START })).toEqualTypeOf<Promise<AnalyticsExchanges>>();
    });
  });

  describe("the cache", () => {
    it.each(analyticsCases)("$name is class minute, held on failure and shared in flight, with no TTL of its own", async (c) => {
      const cache = recordingCache();
      fetchSpy.mockResolvedValueOnce(json(c.body));

      await c.call(createDataApi(xrpl, env, cache));

      expect(cache.calls).toEqual([{ key: `GET ${BASE}${c.url}`, cls: "minute", holdFailure: true, shareInFlight: true }]);
    });

    it("has an entry for each route, interval and window, so that none is read for another", async () => {
      const cache = recordingCache();
      const api = createDataApi(xrpl, env, cache);
      fetchSpy.mockImplementation(async (input) => {
        const interval = new URL(input instanceof Request ? input.url : String(input)).searchParams.get("interval") ?? "day";
        // A daily answer for a daily request, the first of the month for a monthly one: the checks take both.
        const date = interval === "month" ? "2026-10-01T00:00:00Z" : "2026-10-12T00:00:00Z";
        return json({ ...valueBody, rows: [{ ...valueBody.rows[0], date }] });
      });

      await api.accountStats(ACCOUNT, "value", { interval: "month", limit: 1000, start: "2025-07-01" });
      await api.accountStats(ACCOUNT, "value", { interval: "week", limit: 1000, start: "2025-07-01" });
      await api.accountStats(ACCOUNT, "value", { interval: "week", limit: 1000, start: "2025-07-02" });
      await api.accountStats(ACCOUNT, "value", { interval: "week", limit: 1000, start: "2025-07-01" });

      expect(cache.calls.map((call) => call.key)).toEqual([
        `GET ${BASE}/v2/accounts/${ACCOUNT}/stats/value?interval=month&limit=1000&start=2025-07-01`,
        `GET ${BASE}/v2/accounts/${ACCOUNT}/stats/value?interval=week&limit=1000&start=2025-07-01`,
        `GET ${BASE}/v2/accounts/${ACCOUNT}/stats/value?interval=week&limit=1000&start=2025-07-02`,
        `GET ${BASE}/v2/accounts/${ACCOUNT}/stats/value?interval=week&limit=1000&start=2025-07-01`,
      ]);
    });

    it("is not what a call of another page asks for: a polled call passes the failure hold and no sharing", async () => {
      const cache = recordingCache();
      fetchSpy.mockResolvedValue(json(lastValidatedBody));

      await createDataApi(xrpl, env, cache).lastValidated({ holdFailure: true });

      expect(cache.calls).toEqual([{ key: `GET ${BASE}/v2/last_validated`, cls: "live", holdFailure: true }]);
    });

    it("really stores each answer for 60 s", async () => {
      const { api, storedBy } = storing("analytics-stored");
      fetchSpy.mockImplementation(answerByPath);

      for (const c of analyticsCases) expect(await storedBy((a) => c.call(a)), c.name).toEqual(["public, max-age=60"]);
      expect(CACHE_CLASSES.minute.edgeTtl).toBe(60);
      expect(fetchSpy).toHaveBeenCalledTimes(analyticsCases.length);

      // Stored: the next call of each is the cache's, not the API's.
      for (const c of analyticsCases) expect(await c.call(api), c.name).toEqual(c.body);
      expect(fetchSpy).toHaveBeenCalledTimes(analyticsCases.length);
    });

    it("shares one request between the calls of one key that overlap, whichever of them asks: each is given its own copy of the answer", async () => {
      const { api } = storing("analytics-shared");
      const overlapped = overlapping();
      let answer: (response: Response) => void = () => {};
      fetchSpy.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));

      const first = api.analyticsCounterparties(ACCOUNT, { limit: 6, start: START });
      const second = api.analyticsCounterparties(ACCOUNT, { limit: 6, start: START });
      // Both have missed the Cache API, and the second has joined the first's request.
      await overlapped(2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      answer(json(counterpartiesBody));
      const [a, b] = await Promise.all([first, second]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(a).toEqual(counterpartiesBody);
      expect(b).toEqual(counterpartiesBody);
      expect(a).not.toBe(b);
    });
  });

  describe("the deadlines", () => {
    /** The call ends with `kind: timeout` after `ms` ms, not before; its request is aborted then. */
    async function timesOutAt(ms: number, call: (api: DataApi) => Promise<unknown>) {
      vi.useFakeTimers();
      let signal: AbortSignal | null | undefined;
      fetchSpy.mockImplementation((_input, init) => {
        signal = init?.signal;
        return new Promise<Response>(() => {});
      });
      let settled = false;
      const outcome = call(createDataApi(xrpl, env, passThroughCache))
        .then(
          () => "resolved",
          (reason: unknown) => reason,
        )
        .finally(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(settled).toBe(false);
      expect(signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const error = await outcome;
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).kind).toBe("timeout");
      expect(signal?.aborted).toBe(true);
    }

    it("gives analytics/counterparties 15 s: it has not settled at 14,999 ms and is a timeout at 15,000 ms", async () => {
      await timesOutAt(15_000, (api) => api.analyticsCounterparties(ACCOUNT, { limit: 6, start: START }));
    });

    it("is 15,000 ms for it, three times the data API's 5,000 ms", () => {
      expect(ANALYTICS_SLOW_TIMEOUT_MS).toBe(15_000);
      expect(DATA_API_TIMEOUT_MS).toBe(5_000);
    });

    it.each(analyticsCases.filter((c) => c.name !== "analyticsCounterparties"))("gives $name the data API's 5 s: a timeout at 5,000 ms", async (c) => {
      await timesOutAt(5_000, (api) => c.call(api));
    });

    it("an answer after 14 s is the answer: the 15 s is the deadline of the whole call, body included", async () => {
      vi.useFakeTimers();
      fetchSpy.mockImplementation(() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(counterpartiesBody)), 14_000)));
      const outcome = createDataApi(xrpl, env, passThroughCache).analyticsCounterparties(ACCOUNT, { limit: 6, start: START });

      await vi.advanceTimersByTimeAsync(14_000);

      expect(await outcome).toEqual(counterpartiesBody);
    });
  });

  describe("a failure", () => {
    // Each on a host of its own: the Cache API and the failure hold of this file outlive a test.
    it("a 404 'Cannot GET' (a data API without D2) is kind server, whatever the route, and is never stored", async () => {
      const { api, storedBy } = storing("analytics-cannot-get");
      fetchSpy.mockImplementation(async () => json({ result: "error", message: `Cannot GET /v2/accounts/${ACCOUNT}/analytics/balances` }, { status: 404 }));

      const error = await failureOf(api.analyticsBalances(ACCOUNT, { interval: "day", limit: 4, start: START }));
      expect(error.kind).toBe("server");
      expect(error.status).toBe(404);
      expect(error.message).toContain("(the data API has no such route)");
      expect(await storedBy(() => api.analyticsBalances(ACCOUNT, { interval: "day", limit: 4, start: START }).catch(() => undefined))).toEqual([]);
    });

    it("a 404 of another message stays not_found, and a 400 bad_request: the routes have no not-found of their own, and the caller fails the card with either", async () => {
      const { api } = storing("analytics-not-found");
      fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "account not found" }, { status: 404 }));
      fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "invalid start" }, { status: 400 }));

      expect((await failureOf(api.analyticsExchanges(ACCOUNT, { limit: 6, start: START }))).kind).toBe("not_found");
      expect((await failureOf(api.analyticsBalanceChanges(ACCOUNT, { interval: "day", start: START }))).kind).toBe("bad_request");
    });

    it.each(analyticsCases)("an answer to $name that is not what the reference promises is kind server, status 200, and is never stored", async (c) => {
      const { api, storedBy } = storing(`analytics-malformed-${c.name.replace(/\W+/g, "-").toLowerCase()}`);
      const copy = structuredClone(c.body);
      c.broken(copy);
      fetchSpy.mockImplementation(async () => json(copy));

      const error = await failureOf(c.call(api));
      expect(error.kind).toBe("server");
      expect(error.status).toBe(200);
      expect(error.message).toContain("answered something unexpected");
      expect(await storedBy(() => c.call(api).catch(() => undefined))).toEqual([]);
    });

    it("is a daily row under `week`, the answer of an API that ignores the interval: kind server, and is never stored", async () => {
      const { api, storedBy } = storing("analytics-daily-under-week");
      // A Tuesday: a week starts on a Monday.
      fetchSpy.mockImplementation(async () => json({ ...valueBody, rows: [{ date: "2026-10-13T00:00:00Z", account_value: "100.5", balance_change_count: 2 }] }));
      const call = (a: DataApi) => a.accountStats(ACCOUNT, "value", { interval: "week", limit: 1000, start: "2026-07-20" });

      const error = await failureOf(call(api));
      expect(error.kind).toBe("server");
      expect(error.status).toBe(200);
      expect(error.message).toContain("data API account value stats");
      expect(await storedBy((a) => call(a).catch(() => undefined))).toEqual([]);
    });

    it("an answer for another interval than the one asked for is kind server, in each route that echoes it", async () => {
      const api = createDataApi(xrpl, env, passThroughCache);
      fetchSpy.mockResolvedValueOnce(json({ ...balancesBody, interval: "day" }));
      fetchSpy.mockResolvedValueOnce(json({ ...changesBody, interval: "day" }));

      expect((await failureOf(api.analyticsBalances(ACCOUNT, { interval: "week", limit: 4, start: START }))).kind).toBe("server");
      expect((await failureOf(api.analyticsBalanceChanges(ACCOUNT, { interval: "week", start: START }))).kind).toBe("server");
    });

    it("is held, as any failure of the API: a route that fails is asked once, and the calls after it get the same error", async () => {
      const { api } = storing("analytics-held");
      fetchSpy.mockImplementation(async () => json({ result: "error", message: "boom" }, { status: 500 }));
      const call = () => api.analyticsExchanges(ACCOUNT, { limit: 6, start: START });

      const first = await failureOf(call());
      const second = await failureOf(call());

      expect(first.kind).toBe("server");
      expect(second).toBe(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("is shared in flight as it fails: the calls that overlap get the one error, from one request", async () => {
      const { api } = storing("analytics-shared-failure");
      const overlapped = overlapping();
      let answer: (response: Response) => void = () => {};
      fetchSpy.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
      const call = () => api.analyticsBalances(ACCOUNT, { interval: "day", limit: 4, start: START }).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      const calls = [call(), call(), call()];
      // All three have missed the Cache API, and the second and the third have joined the first's request.
      await overlapped(3);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      answer(json({ result: "error", message: "boom" }, { status: 503 }));
      const errors = await Promise.all(calls);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      for (const error of errors) expect((error as UpstreamError).kind).toBe("server");
      expect(errors[1]).toBe(errors[0]);
    });
  });
});

// D1's six calls (validators spec 2.1 and 9; data-api-new `feat/explorer-data`, pinned at 7d495ab). Their paths are in PENDING_PATHS, outside the compile-time
// check: openapi.yaml has no `network/validators` or `network/amendments` yet. Each answer is checked inside the load, and a 200 that is not what the reference
// promises is a failure of kind `server` that is never stored. Failure tests first, each on a host of its own: this file's Cache API and the hold outlive a test.
describe("D1's validators and amendments calls", () => {
  const KEY = SAMPLE_KEYS[0];
  const amendmentName = "AMM";

  type Six = [name: string, call: (api: DataApi, opts?: FreshOptions) => Promise<unknown>, good: unknown, bad: unknown, path: string];
  const SIX_METHODS: Six[] = [
    ["validatorsSummary", (a, o) => a.validatorsSummary(o), summarySample(), { ...summarySample(), validators: "many" }, "/v2/network/validators/summary"],
    [
      "validators",
      (a, o) => a.validators({ scope: "all", limit: 1000 }, o),
      validatorsListBody(),
      { ...validatorsListBody(), validators: {} },
      "/v2/network/validators?limit=1000&scope=all",
    ],
    ["validator", (a, o) => a.validator(KEY, o), validatorDetailSample(), { ...validatorDetailSample(), daily_agreement: {} }, `/v2/network/validators/${KEY}`],
    [
      "validatorValidations",
      (a, o) => a.validatorValidations(KEY, { limit: 20 }, o),
      validationsSample(),
      { ...validationsSample(), validations: {} },
      `/v2/network/validators/${KEY}/validations?limit=20`,
    ],
    ["amendments", (a, o) => a.amendments(o), amendmentsSample(), { ...amendmentsSample(), amendments: {} }, "/v2/network/amendments"],
    ["amendment", (a, o) => a.amendment(amendmentName, o), amendmentDetailSample(), { ...amendmentDetailSample(), rounds: {} }, `/v2/network/amendments/${amendmentName}`],
  ];

  /** What D1 answers for the path asked, in the body of the sample of that route. */
  const answer = async (input: RequestInfo | URL) => {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input));
    if (pathname.endsWith("/validators/summary")) return json(summarySample());
    if (pathname.endsWith("/validations")) return json(validationsSample());
    if (pathname.endsWith("/validators")) return json(validatorsListBody());
    if (pathname.includes("/validators/")) return json(validatorDetailSample());
    if (pathname.endsWith("/amendments")) return json(amendmentsSample());
    return json(amendmentDetailSample());
  };

  it.each(SIX_METHODS)("%s: a malformed 200 is a server error and is not stored", async (name, call, good, bad) => {
    const { api, storedBy } = storing(`d1-malformed-${name}`);
    fetchSpy.mockResolvedValueOnce(json(bad));

    const error = await failureOf(call(api));
    expect(error.kind).toBe("server");
    expect(error.status).toBe(200);
    expect(error.message).toContain("answered something unexpected");

    // Nothing was stored: the next call, and the one after it, make new upstream requests; only the good answer is stored.
    fetchSpy.mockResolvedValueOnce(json(bad));
    expect(await storedBy(() => call(api).catch(() => undefined))).toEqual([]);
    fetchSpy.mockResolvedValueOnce(json(good));
    expect((await storedBy(() => call(api))).length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("the error names the request: the path and the query that were asked for", async () => {
    const { api } = storing("d1-malformed-names-the-request");
    fetchSpy.mockResolvedValueOnce(json({ ...validatorsListBody(), validators: {} }));

    const error = await failureOf(api.validators({ scope: "all", limit: 1000 }));

    expect(error.message).toBe("data API GET /v2/network/validators?limit=1000&scope=all answered something unexpected: validators is not a list");
  });

  it("a malformed 200 of a call that asks for the failure hold is held: one request, and both calls throw the same error", async () => {
    const { api } = storing("d1-malformed-held");
    fetchSpy.mockImplementation(async () => json({ ...amendmentsSample(), counts: {} }));

    const first = await failureOf(api.amendments({ holdFailure: true }));
    const second = await failureOf(api.amendments({ holdFailure: true }));

    expect(first.kind).toBe("server");
    expect(second).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  describe("the failures D1 answers with", () => {
    const notFound = (message: string) => json({ result: "error", message }, { status: 404 });

    it("keeps 'Validator not found' and 'amendment not found' as not_found, and a 400 as bad_request", async () => {
      const { api } = storing("d1-not-found");
      const cases: Array<[string, (api: DataApi) => Promise<unknown>, Response, UpstreamError["kind"]]> = [
        ["validator", (a) => a.validator(KEY), notFound("Validator not found"), "not_found"],
        ["validatorValidations", (a) => a.validatorValidations(KEY, { limit: 20 }), notFound("Validator not found"), "not_found"],
        ["amendment", (a) => a.amendment("NoSuchAmendment"), notFound("amendment not found"), "not_found"],
        ["validator, a key of no form", (a) => a.validator(KEY), json({ result: "error", message: "invalid validator public key" }, { status: 400 }), "bad_request"],
        ["validators, a bad scope", (a) => a.validators({ scope: "all", limit: 1000 }), json({ result: "error", message: "invalid scope" }, { status: 400 }), "bad_request"],
        [
          "validatorValidations, a bad marker",
          (a) => a.validatorValidations(KEY, { limit: 20, marker: "x" }),
          json({ result: "error", message: "invalid marker" }, { status: 400 }),
          "bad_request",
        ],
        ["validatorsSummary, a database error", (a) => a.validatorsSummary(), json({ result: "error", message: "unable to retrieve validator(s)" }, { status: 500 }), "server"],
      ];
      for (const [name, call, response, kind] of cases) {
        fetchSpy.mockResolvedValueOnce(response);
        const error = await failureOf(call(api));
        expect([name, error.kind]).toEqual([name, kind]);
        expect(error.message, name).not.toContain("no such route");
      }
    });

    it.each(SIX_METHODS)("%s: a 404 'Cannot GET …' (a data API without D1) is kind server, is never stored, and is held when the call asks", async (name, call, _good, _bad, path) => {
      const { api, storedBy } = storing(`d1-cannot-get-${name}`);
      fetchSpy.mockImplementation(async () => notFound(`Cannot GET ${path}`));

      const first = await failureOf(call(api));
      expect(first.kind).toBe("server");
      expect(first.status).toBe(404);
      expect(first.message).toBe(`data API GET ${path} answered 404: Cannot GET ${path} (the data API has no such route)`);
      expect(await storedBy(() => call(api).catch(() => undefined))).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockClear();
      const held = await failureOf(call(api, { holdFailure: true }));
      const again = await failureOf(call(api, { holdFailure: true }));
      expect(again).toBe(held);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  const recording = () => {
    const cache = recordingCache();
    return { cache, api: createDataApi(xrpl, env, cache) };
  };

  it("asks D1's six paths with their queries, classes and TTLs", async () => {
    const { cache, api } = recording();
    fetchSpy.mockImplementation(answer);

    await api.validatorsSummary({ ttl: VALIDATORS_CALL_TTL_SECONDS });
    await api.validators({ scope: "all", limit: 1000 }, { ttl: VALIDATORS_CALL_TTL_SECONDS });
    await api.validator(KEY, { ttl: VALIDATORS_CALL_TTL_SECONDS });
    await api.validatorValidations(KEY, { limit: 20 }, { ttl: VALIDATIONS_CALL_TTL_SECONDS });
    // A page after a marker is old rows: `slow`, kept 300 s whatever TTL the caller names.
    await api.validatorValidations(KEY, { limit: 20, marker: "M1" }, { ttl: VALIDATIONS_CALL_TTL_SECONDS });
    await api.amendments();
    await api.amendment(amendmentName);

    expect(cache.calls.map((call) => [call.key, call.cls, call.ttlOverride])).toEqual([
      [`GET ${BASE}/v2/network/validators/summary [kept 10 s]`, "live", 10],
      [`GET ${BASE}/v2/network/validators?limit=1000&scope=all [kept 10 s]`, "live", 10],
      [`GET ${BASE}/v2/network/validators/${KEY} [kept 10 s]`, "live", 10],
      [`GET ${BASE}/v2/network/validators/${KEY}/validations?limit=20 [kept 2 s]`, "live", 2],
      [`GET ${BASE}/v2/network/validators/${KEY}/validations?limit=20&marker=M1 [kept 300 s]`, "slow", 300],
      [`GET ${BASE}/v2/network/amendments`, "minute", undefined],
      [`GET ${BASE}/v2/network/amendments/AMM`, "minute", undefined],
    ]);
    expect(fetchSpy.mock.calls.map((_call, index) => sentRequest(index).url)).toEqual([
      `${BASE}/v2/network/validators/summary`,
      `${BASE}/v2/network/validators?limit=1000&scope=all`,
      `${BASE}/v2/network/validators/${KEY}`,
      `${BASE}/v2/network/validators/${KEY}/validations?limit=20`,
      `${BASE}/v2/network/validators/${KEY}/validations?limit=20&marker=M1`,
      `${BASE}/v2/network/amendments`,
      `${BASE}/v2/network/amendments/AMM`,
    ]);
    expect(CACHE_CLASSES.minute.edgeTtl).toBe(60);
  });

  it("keeps the class of each call and makes an entry of its own for a TTL a caller names (the validations before a marker are below)", async () => {
    for (const [name, call, , , path] of SIX_METHODS) {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(answer);

      await call(api);
      await call(api, { ttl: 7 });

      expect(cache.calls[1]!.key, name).toBe(`${cache.calls[0]!.key} [kept 7 s]`);
      expect(cache.calls[0]!.key, name).toBe(`GET ${BASE}${path}`);
      expect(cache.calls[1]!.cls, name).toBe(cache.calls[0]!.cls);
      expect(cache.calls[0]!.ttlOverride, name).toBeUndefined();
      expect(cache.calls[1]!.ttlOverride, name).toBe(7);
    }
  });

  it("passes the failure hold on when it is asked for, and it is no part of a key", async () => {
    for (const [name, call] of SIX_METHODS) {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(answer);

      await call(api);
      await call(api, { holdFailure: false });
      await call(api, { holdFailure: true });

      expect(cache.calls.map((c) => c.holdFailure), name).toEqual([undefined, undefined, true]);
      expect(new Set(cache.calls.map((c) => c.key)).size, name).toBe(1);
    }
  });

  describe("validatorValidations after a marker", () => {
    it("is old rows: `slow`, kept 300 s whatever TTL it is asked for, and the failure hold goes on", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(answer);

      await api.validatorValidations(KEY, { limit: 20, marker: "M1" });
      await api.validatorValidations(KEY, { limit: 20, marker: "M1" }, { ttl: 2, holdFailure: true });
      await api.validatorValidations(KEY, { limit: 20, marker: "M1" }, { ttl: 99 });

      expect(cache.calls.map((c) => [c.cls, c.ttlOverride, c.holdFailure])).toEqual([
        ["slow", VALIDATIONS_MARKER_TTL_SECONDS, undefined],
        ["slow", VALIDATIONS_MARKER_TTL_SECONDS, true],
        ["slow", VALIDATIONS_MARKER_TTL_SECONDS, undefined],
      ]);
      // One entry for the page, whoever asked: a TTL a caller names is not part of its key.
      expect(new Set(cache.calls.map((c) => c.key))).toEqual(new Set([`GET ${BASE}/v2/network/validators/${KEY}/validations?limit=20&marker=M1 [kept 300 s]`]));
    });

    it("escapes the marker, which is opaque text, and takes an empty marker for none", async () => {
      const { cache, api } = recording();
      fetchSpy.mockImplementation(answer);

      await api.validatorValidations(KEY, { limit: 20, marker: "a+b/c=&d" });
      expect(new URL(sentRequest().url).searchParams.get("marker")).toBe("a+b/c=&d");
      expect(sentRequest().url).toBe(`${BASE}/v2/network/validators/${KEY}/validations?limit=20&marker=a%2Bb%2Fc%3D%26d`);

      await api.validatorValidations(KEY, { limit: 20, marker: "" }, { ttl: 2 });
      expect(sentRequest().url).toBe(`${BASE}/v2/network/validators/${KEY}/validations?limit=20`);
      expect(cache.calls[1]).toMatchObject({ cls: "live", ttlOverride: 2 });
    });
  });

  it("writes the list's query as limit, then scope, for either scope", async () => {
    fetchSpy.mockImplementation(answer);
    const api = createDataApi(xrpl, env, passThroughCache);

    await api.validators({ scope: "unl", limit: 200 });
    expect(sentRequest().url).toBe(`${BASE}/v2/network/validators?limit=200&scope=unl`);
    await api.validators({ scope: "all", limit: 1000 });
    expect(sentRequest().url).toBe(`${BASE}/v2/network/validators?limit=1000&scope=all`);
  });

  it("asks the host of the network it was created for, with the key", async () => {
    fetchSpy.mockImplementation(answer);

    await createDataApi(xahau, env, passThroughCache).amendments();

    expect(sentRequest().url).toBe("https://xahau.data.example.invalid/v2/network/amendments");
    expect(sentRequest().headers.get("X-API-Key")).toBe("test-key");
  });

  it("escapes the key and the name it puts in a path, so that an identifier cannot reach another endpoint", async () => {
    fetchSpy.mockImplementation(answer);
    const api = createDataApi(xrpl, env, passThroughCache);

    await api.validator("a/b?c#d").catch(() => undefined);
    expect(sentRequest().url).toBe(`${BASE}/v2/network/validators/a%2Fb%3Fc%23d`);
    await api.validatorValidations("a/b", { limit: 20 }).catch(() => undefined);
    expect(sentRequest().url).toBe(`${BASE}/v2/network/validators/a%2Fb/validations?limit=20`);
    await api.amendment("a/b?c#d").catch(() => undefined);
    expect(sentRequest().url).toBe(`${BASE}/v2/network/amendments/a%2Fb%3Fc%23d`);
  });

  it.each(["..", ".", ""])("refuses %j as a key or a name without sending anything", async (id) => {
    const api = createDataApi(xrpl, env, passThroughCache);

    expect((await failureOf(api.validator(id))).kind).toBe("bad_request");
    expect((await failureOf(api.validatorValidations(id, { limit: 20 }))).kind).toBe("bad_request");
    expect((await failureOf(api.amendment(id))).kind).toBe("bad_request");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keys the two networks apart", async () => {
    const cache = recordingCache();
    fetchSpy.mockImplementation(answer);

    await createDataApi(xrpl, env, cache).validatorsSummary();
    await createDataApi(xahau, env, cache).validatorsSummary();

    expect(new Set(cache.calls.map((c) => c.key)).size).toBe(2);
  });

  it("types each answer by what the reference gives it", () => {
    // A cache that answers nothing: only the types of the calls are looked at, and the promises are left alone.
    const api = createDataApi(xrpl, env, { json: () => new Promise<never>(() => {}) });

    expectTypeOf(api.validatorsSummary()).toEqualTypeOf<Promise<ValidatorsSummary>>();
    expectTypeOf(api.validators({ scope: "all", limit: 1000 })).toEqualTypeOf<Promise<ValidatorsList>>();
    expectTypeOf(api.validator(KEY)).toEqualTypeOf<Promise<ValidatorDetail>>();
    expectTypeOf(api.validatorValidations(KEY, { limit: 20 })).toEqualTypeOf<Promise<ValidatorValidationsPage>>();
    expectTypeOf(api.amendments()).toEqualTypeOf<Promise<AmendmentsList>>();
    expectTypeOf(api.amendment("AMM")).toEqualTypeOf<Promise<AmendmentDetail>>();
    // The keys the reference lets an answer go without.
    expectTypeOf<ValidatorsSummary["ledger_index"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ValidatorsSummary["agreement_through"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<ValidatorsSummary["quorum"]>["node"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<NonNullable<NonNullable<ValidatorDetail["domain_verification"]>["accounts"]>>().toEqualTypeOf<string[]>();
    expectTypeOf<AmendmentsList["amendments"][number]["xls_url"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<AmendmentsList["amendments"][number]["majority"]>["ledger_index"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<NonNullable<AmendmentsList["amendments"][number]["majority"]>["tx_hash"]>().toEqualTypeOf<string | undefined>();
  });
});

// A 200 that is not what the reference promises is the API failing, not an answer: the subrequest cache stores what the client returns
// for a year (class immutable), so a shape that the pages cannot use would be stored with it. The checks are in the client, inside the
// load the cache runs, and a load that throws stores nothing.
describe("an answer that is not what the reference promises", () => {
  /** A cache that stores what `load` returns, as the Worker's does, so that a stored answer shows. */
  function storingCache() {
    const store = new Map<string, unknown>();
    const cache = {
      store,
      async json<T>(key: string, _cls: CacheClass, load: () => Promise<T>): Promise<T> {
        if (store.has(key)) return store.get(key) as T;
        const value = await load();
        store.set(key, value);
        return value;
      },
    };
    return cache;
  }

  /** The call fails as an upstream failure of kind `server` (a 200 with the wrong content), and nothing is stored; a good answer then is. */
  async function failsWithoutStoring(body: unknown, call: (api: DataApi) => Promise<unknown>, good: unknown) {
    const cache = storingCache();
    const api = createDataApi(xrpl, env, cache);
    fetchSpy.mockResolvedValueOnce(json(body));
    const error = await failureOf(call(api));
    expect(error.kind).toBe("server");
    expect(error.status).toBe(200);
    expect(cache.store.size).toBe(0);

    fetchSpy.mockResolvedValueOnce(json(good));
    await call(api);
    expect(cache.store.size).toBe(1);
  }

  const withTransaction = (change: Record<string, unknown>) => ({ result: "success", transaction: { ...txObject, ...change } });

  describe("for a transaction", () => {
    it.each<[string, Record<string, unknown>]>([
      ["no tx", { tx: undefined }],
      ["a tx that is text", { tx: "Payment" }],
      ["a tx that is null", { tx: null }],
      ["a tx without a type", { tx: { Account: ACCOUNT } }],
      ["a tx whose type is not text", { tx: { TransactionType: 7, Account: ACCOUNT } }],
      ["a tx without an account", { tx: { TransactionType: "Payment" } }],
      ["no meta", { meta: undefined }],
      ["a meta without a result", { meta: { TransactionIndex: 3, AffectedNodes: [] } }],
      ["a meta without a place in the ledger", { meta: { TransactionResult: "tesSUCCESS", AffectedNodes: [] } }],
      ["a negative place", { meta: { TransactionIndex: -1, TransactionResult: "tesSUCCESS", AffectedNodes: [] } }],
      ["a meta whose nodes are not a list", { meta: { TransactionIndex: 3, TransactionResult: "tesSUCCESS", AffectedNodes: "none" } }],
      ["a ledger that is not a number", { ledger_index: "107" }],
      ["a date that is not a date", { date: "yesterday" }],
      ["no date", { date: undefined }],
      ["the hash of another transaction", { hash: "AB".repeat(32) }],
      ["no hash", { hash: undefined }],
    ])("is a failure for %s, is not stored, and the good answer after it is", async (_what, change) => {
      await failsWithoutStoring(withTransaction(change), (api) => api.transaction(HASH), transactionBody);
    });

    it("is a failure for an answer that is not an object at all", async () => {
      await failsWithoutStoring({ result: "success", transaction: "gone" }, (api) => api.transaction(HASH), transactionBody);
    });

    it("takes the hash in any case, and a pseudo-transaction with an empty account", async () => {
      fetchSpy.mockResolvedValueOnce(json(withTransaction({ hash: HASH.toLowerCase(), tx: { TransactionType: "UNLReport", Account: "" } })));
      const found = await createDataApi(xrpl, env, passThroughCache).transaction(HASH);
      expect(found.tx.TransactionType).toBe("UNLReport");
    });
  });

  describe("for the binary form of a transaction", () => {
    const binary = { ...binaryObject };
    const withBinary = (change: Record<string, unknown>) => ({ result: "success", transaction: { ...binary, ...change } });

    it.each<[string, Record<string, unknown>]>([
      ["a tx that is not hex", { tx: "XYZ1" }],
      ["a tx of an odd length", { tx: "ABC" }],
      ["an empty tx", { tx: "" }],
      ["a tx that is a number", { tx: 7 }],
      ["a meta that is not hex", { meta: "zz" }],
      ["no meta", { meta: undefined }],
      ["no tx", { tx: undefined }],
      ["hex and JSON mixed", { meta: { TransactionResult: "tesSUCCESS" } }],
      ["a tx that is a list", { tx: ["AB"], meta: ["CD"] }],
      ["the hash of another transaction", { hash: "AB".repeat(32) }],
    ])("is a failure for %s, is not stored, and the good answer after it is", async (_what, change) => {
      await failsWithoutStoring(withBinary(change), (api) => api.transactionBinary(HASH), binaryBody);
    });

    it("is an answer when tx and meta are JSON: the API serves a transaction its codec cannot serialize as it stored it (api-reference.md)", async () => {
      const stored = { tx: { TransactionType: "Payment", Account: ACCOUNT }, meta: { TransactionResult: "tesSUCCESS" } };
      const cache = storingCache();
      fetchSpy.mockResolvedValueOnce(json(withBinary(stored)));

      const found = await createDataApi(xrpl, env, cache).transactionBinary(HASH);

      expect(found.tx).toEqual(stored.tx);
      expect(found.meta).toEqual(stored.meta);
      expect(cache.store.size).toBe(1);
    });
  });

  describe("for the hashes of a ledger", () => {
    const withList = (transactions: unknown) => ({
      ...hashedLedgerBody,
      ledger: transactions === undefined ? { ...ledgerBody.ledger } : { ...ledgerBody.ledger, transactions },
    });

    it.each<[string, unknown]>([
      ["no list", undefined],
      ["a list that is text", "oops"],
      ["a list that is an object", { 0: HASH }],
      ["a list that is null", null],
      ["a hash that is not hex", [HASH, "not-a-hash"]],
      ["a hash of 63 digits", [HASH.slice(1)]],
      ["a hash of 66 digits", [`${HASH}AB`]],
      ["a path", ["../../etc/passwd"]],
      ["a number", [7]],
      ["null", [null]],
    ])("is a failure for %s, is not stored, and the good answer after it is", async (_what, list) => {
      await failsWithoutStoring(withList(list), (api) => api.ledger("107695660", { transactions: true }), hashedLedgerBody);
    });

    it("is an answer for no transactions, an empty list: a ledger with none", async () => {
      fetchSpy.mockResolvedValueOnce(json(withList([])));
      const ledger = await createDataApi(xrpl, env, passThroughCache).ledger("107695660", { transactions: true });
      expect(ledger.transactions).toEqual([]);
    });

    it("takes hashes in either case", async () => {
      fetchSpy.mockResolvedValueOnce(json(withList([HASH.toLowerCase()])));
      const ledger = await createDataApi(xrpl, env, passThroughCache).ledger("107695660", { transactions: true });
      expect(ledger.transactions).toEqual([HASH.toLowerCase()]);
    });
  });

  // The aggregates of the network page (aggregate-shape.ts): a list where a list belongs, dates as ISO text, amounts as decimal strings.
  describe("for the aggregates of the network page", () => {
    const period = { interval: "day", ...PERIOD, limit: 1000 } as const;
    /** A copy of `body` that `change` has broken. */
    const broken = (body: unknown, change: (copy: any) => void) => {
      const copy = structuredClone(body);
      change(copy);
      return copy;
    };
    const volumes: Array<[string, (api: DataApi) => Promise<unknown>, any]> = [
      ["payment volume", (api) => api.paymentVolume(period), paymentVolumeBody],
      ["exchange volume", (api) => api.exchangeVolume(period), exchangeVolumeBody],
      ["AMM volume", (api) => api.ammVolume(period), ammVolumeBody],
    ];

    it.each<[string, unknown, (api: DataApi) => Promise<unknown>, unknown]>([
      ["stats that are not a list", broken(statsTypeBody, (b) => (b.stats = { 0: b.stats[0] })), (api) => api.stats("type", period), statsTypeBody],
      ["no stats at all", broken(statsTypeBody, (b) => delete b.stats), (api) => api.stats("type", period), statsTypeBody],
      ["a stats row with a count that is text", broken(statsTypeBody, (b) => (b.stats[0].Payment = "12")), (api) => api.stats("type", period), statsTypeBody],
      ["a stats row whose date is not ISO", broken(statsTypeBody, (b) => (b.stats[1].date = "2026-10-17")), (api) => api.stats("type", period), statsTypeBody],
      ["a metric that is text", broken(statsMetricBody, (b) => (b.stats[0].ledger_count = "24000")), (api) => api.stats("metric", period), statsMetricBody],
      ["a fee row whose avg is text", broken(feeBucketsBody, (b) => (b.rows[0].avg = "0.01")), (api) => api.fees({ interval: "day", ...PERIOD, limit: 1000 }), feeBucketsBody],
      ["fee rows that are not a list", broken(feeBucketsBody, (b) => (b.rows = "none")), (api) => api.fees({ interval: "day", ...PERIOD, limit: 1000 }), feeBucketsBody],
      [
        "a fee_stats row whose open_ledger_fee is text",
        broken(feeStatsBody, (b) => (b.rows[0].open_ledger_fee = "0.00001")),
        (api) => api.feeStats({ descending: true, limit: 1, start: "2026-10-17" }),
        feeStatsBody,
      ],
      ...volumes.flatMap(([name, call, good]): Array<[string, unknown, (api: DataApi) => Promise<unknown>, unknown]> => [
        [`a ${name} row whose total is a number`, broken(good, (b) => (b.rows[0].total = 12.5)), call, good],
        [`a ${name} row without components`, broken(good, (b) => delete b.rows[0].components), call, good],
        [`a ${name} component whose converted_amount is "1e1000" (an exponent of 4 digits)`, broken(good, (b) => (b.rows[0].components[0].converted_amount = "1e1000")), call, good],
      ]),
      ["validations that are not a list", broken(validationsBody, (b) => (b.validations = {})), (api) => api.ledgerValidations(LEDGER_HASH, { limit: 1000 }), validationsBody],
      [
        "a validation without validation_public_key",
        broken(validationsBody, (b) => delete b.validations[0].validation_public_key),
        (api) => api.ledgerValidations(LEDGER_HASH, { limit: 1000 }),
        validationsBody,
      ],
    ])("is a failure for %s, is not stored, and the good answer after it is", async (_what, body, call, good) => {
      await failsWithoutStoring(body, call, good);
    });

    it("is not kept by the Worker's subrequest cache either: the next call asks the API again", async () => {
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      const network = networkOf("xrpl", { ...env, XRPL_DATA_API_URL: "https://malformed-aggregate.example.invalid" });
      const api = createDataApi(network, env, createSubrequestCache(ctx, "malformed"));
      fetchSpy.mockImplementation(async () => json({ ...statsTypeBody, stats: "none" }));

      expect((await failureOf(api.stats("type", period))).kind).toBe("server");
      expect((await failureOf(api.stats("type", period))).kind).toBe("server");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("is held with holdFailure, as any other failure of the API: one request, and both calls throw", async () => {
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      const network = networkOf("xrpl", { ...env, XRPL_DATA_API_URL: "https://malformed-aggregate-held.example.invalid" });
      const api = createDataApi(network, env, createSubrequestCache(ctx, "malformed-held"));
      fetchSpy.mockImplementation(async () => json({ ...feeStatsBody, rows: "none" }));
      const q = { descending: true, limit: 1, start: "2026-10-17" };

      const first = await failureOf(api.feeStats(q, { holdFailure: true }));
      const second = await failureOf(api.feeStats(q, { holdFailure: true }));

      expect(first.kind).toBe("server");
      expect(second).toBe(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("takes a volume component in exponent form, which BigNumber's text has for a tiny amount or a rate from 1e8", async () => {
      for (const [name, call, good] of volumes) {
        const dust = broken(good, (b) => Object.assign(b.rows[0].components[0], { amount: "2.5e-7", rate: "1.2345679e+8", converted_amount: "1.5e-7" }));
        fetchSpy.mockResolvedValueOnce(json(dust));
        expect(await call(createDataApi(xrpl, env, passThroughCache)), name).toEqual(dust);
      }
    });

    it("takes a volume row whose total and exchange_rate are in exponent form: String() of a JS number, and precision8 (a day of dust trades)", async () => {
      for (const [name, call, good] of volumes) {
        const dust = broken(good, (b) => Object.assign(b.rows[0], { total: "4e-7", exchange_rate: "1.0000000e-7" }));
        fetchSpy.mockResolvedValueOnce(json(dust));
        expect(await call(createDataApi(xrpl, env, passThroughCache)), name).toEqual(dust);
      }
    });

    it("takes the good answers, each as it came", async () => {
      for (const [name, call, good] of volumes) {
        fetchSpy.mockResolvedValueOnce(json(good));
        expect(await call(createDataApi(xrpl, env, passThroughCache)), name).toEqual(good);
      }
    });

    it("takes an answer with no rows, which is a window the API has no data for", async () => {
      fetchSpy.mockResolvedValueOnce(json({ result: "success", count: 0, stats: [] }));
      expect((await createDataApi(xrpl, env, passThroughCache).stats("type", period)).stats).toEqual([]);
      fetchSpy.mockResolvedValueOnce(json({ result: "success", count: 0, rows: [] }));
      expect((await createDataApi(xrpl, env, passThroughCache).ammVolume(period)).rows).toEqual([]);
      fetchSpy.mockResolvedValueOnce(json({ result: "success", ledger_hash: LEDGER_HASH, count: 0, validations: [] }));
      expect((await createDataApi(xrpl, env, passThroughCache).ledgerValidations(LEDGER_HASH, { limit: 1000 })).validations).toEqual([]);
    });
  });

  /** A copy of `body` that `change` has broken. */
  const broken = (body: unknown, change: (copy: any) => void) => {
    const copy = structuredClone(body);
    change(copy);
    return copy;
  };

  describe("for the pair page's and the markets page's calls", () => {
    const base = XRP_ASSET;
    const counter = RLUSD_ASSET;
    const hourly = { interval: "1hour", start: "2026-10-14T05:00:00Z", limit: 61 } as const;
    const markets = (api: DataApi) => api.networkMarkets({ period: "day", limit: 1000 });
    const only = (api: DataApi) => api.networkMarkets({ period: "day", limit: 1000, amm: "only" });
    const reduce = (api: DataApi) => api.pairReduce(base, counter, { start: "2026-10-16T17:01:00Z" });
    const trades = (api: DataApi) => api.pairExchanges(base, counter, { descending: true, limit: 20 });
    const candles = (api: DataApi) => api.pairCandles(base, counter, hourly);
    const active = (api: DataApi) => api.activeAccounts(base, counter);

    it.each<[string, unknown, (api: DataApi) => Promise<unknown>, unknown]>([
      // The trades
      ["trades that are not a list", broken(pairExchangesBody, (b) => (b.exchanges = { 0: pairTrade })), trades, pairExchangesBody],
      ["a trade whose rate is a number", broken(pairExchangesBody, (b) => (b.exchanges[0].rate = 2.45)), trades, pairExchangesBody],
      ["a trade whose base_amount is a number", broken(pairExchangesBody, (b) => (b.exchanges[0].base_amount = 50)), trades, pairExchangesBody],
      ["a trade without a tx_hash", broken(pairExchangesBody, (b) => delete b.exchanges[0].tx_hash), trades, pairExchangesBody],
      ["a trade whose executed_time is not ISO", broken(pairExchangesBody, (b) => (b.exchanges[1].executed_time = "yesterday")), trades, pairExchangesBody],
      ["a marker that is not a marker", broken(pairExchangesBody, (b) => (b.marker = "2026-10-17T12:00:00Z")), trades, pairExchangesBody],
      // The candles
      ["candles that are not a list", broken(pairCandlesBody, (b) => (b.exchanges = "none")), candles, pairCandlesBody],
      ["a candle whose close is a number", broken(pairCandlesBody, (b) => (b.exchanges[0].close = 2.45)), candles, pairCandlesBody],
      ["a candle whose buy_volume is text", broken(pairCandlesBody, (b) => (b.exchanges[1].buy_volume = "600")), candles, pairCandlesBody],
      ["a candle whose start is not ISO", broken(pairCandlesBody, (b) => (b.exchanges[0].start = "2026-10-17")), candles, pairCandlesBody],
      // The reduced row
      ["a reduce answer with no row", broken(pairReduceBody, (b) => (b.exchanges = [])), reduce, pairReduceBody],
      ["a reduce answer with two rows", broken(pairReduceBody, (b) => b.exchanges.push({ ...pairReduceRow })), reduce, pairReduceBody],
      ["a reduce answer whose row has a count that is text", broken(pairReduceBody, (b) => (b.exchanges[0].count = "288")), reduce, pairReduceBody],
      ["a reduce answer whose row has a vwap that is a number", broken(pairReduceBody, (b) => (b.exchanges[0].vwap = 2.45)), reduce, pairReduceBody],
      // The active accounts
      ["accounts that are not a list", broken(activeAccountsBody, (b) => (b.accounts = {})), active, activeAccountsBody],
      ["an account without a sell side", broken(activeAccountsBody, (b) => delete b.accounts[0].sell), active, activeAccountsBody],
      ["an account whose base_volume is a number", broken(activeAccountsBody, (b) => (b.accounts[0].base_volume = 990)), active, activeAccountsBody],
      ["an account beyond the first 10 that is malformed (all are checked, then cut)", broken({ ...activeAccountsBody, accounts: Array.from({ length: 12 }, (_v, i) => activeAccount(i + 1)) }, (b) => delete b.accounts[11].account), active, activeAccountsBody],
      // The markets table
      ["markets that are not a list", broken(marketsBody, (b) => (b.markets = { 0: marketRow })), markets, marketsBody],
      ["no markets", broken(marketsBody, (b) => delete b.markets), markets, marketsBody],
      ["a market whose last is a number", broken(marketsBody, (b) => (b.markets[0].last = 0.4)), markets, marketsBody],
      ["a market whose sparkline is not a list", broken(marketsBody, (b) => (b.markets[0].sparkline = "0.4")), markets, marketsBody],
      ["a market whose sparkline holds a text", broken(marketsBody, (b) => b.markets[0].sparkline.push("2026-10-18T00:00:00Z")), markets, marketsBody],
      ["a market whose sparkline close is a number", broken(marketsBody, (b) => (b.markets[0].sparkline[2].close = 0.525)), markets, marketsBody],
      ["totals that are not an object", broken(marketsBody, (b) => (b.totals = [])), markets, marketsBody],
      ["totals that are text", broken(marketsBody, (b) => (b.totals = "9 pairs")), markets, marketsBody],
      // The filter that was asked for
      ["an answer to amm=only with no amm: an API that ignored the filter", marketsBody, only, marketsWithAmm("only")],
      ["an answer to amm=only that says include", marketsWithAmm("include"), only, marketsWithAmm("only")],
      ["an answer to amm=only that says exclude", marketsWithAmm("exclude"), only, marketsWithAmm("only")],
      ["an answer to amm=only that says null", { ...marketsWithAmm("only"), amm: null }, only, marketsWithAmm("only")],
    ])("is a failure for %s, is not stored, and the good answer after it is", async (_what, body, call, good) => {
      await failsWithoutStoring(body, call, good);
    });

    it("takes a markets answer whose AMM fields it cannot read, without them: they are not known (D2), and never take the table down", async () => {
      const unread = broken(marketsBody, (b) => {
        b.totals.amm_share = 0.12;
        b.markets[0].amm_share = "abc";
        b.markets[0].amm_pool = "yes";
      });
      fetchSpy.mockResolvedValueOnce(json(unread));
      const answer = await markets(createDataApi(xrpl, env, passThroughCache));
      expect(answer.totals).not.toHaveProperty("amm_share");
      expect(answer.markets[0]).not.toHaveProperty("amm_share");
      expect(answer.markets[0]).not.toHaveProperty("amm_pool");
      expect(answer.markets[0]!.last).toBe(marketsBody.markets[0]!.last);
    });

    it("reads no amm of the answer to a request without a filter, whatever it says", async () => {
      for (const amm of ["include", "exclude", "only", null]) {
        const body = { ...marketsBody, amm };
        fetchSpy.mockResolvedValueOnce(json(body));
        expect(await markets(createDataApi(xrpl, env, passThroughCache))).toEqual(body);
      }
    });

    it("takes the answer to amm=only that says only, and the one to amm=exclude that says exclude", async () => {
      fetchSpy.mockResolvedValueOnce(json(marketsWithAmm("only")));
      expect(await only(createDataApi(xrpl, env, passThroughCache))).toEqual(marketsWithAmm("only"));
      fetchSpy.mockResolvedValueOnce(json(marketsWithAmm("exclude")));
      expect(await createDataApi(xrpl, env, passThroughCache).networkMarkets({ period: "day", limit: 1000, amm: "exclude" })).toEqual(marketsWithAmm("exclude"));
    });

    it("takes the figures the API writes in exponent form: a price below 1e-6 or from 1e8 (BigNumber's toPrecision(8)), a sum below 1e-6", async () => {
      const junk = broken(marketsBody, (b) => Object.assign(b.markets[0], { open: "1.0000000e-7", last: "1.2345679e+8", base_volume: "5e-7" }));
      fetchSpy.mockResolvedValueOnce(json(junk));
      expect(await markets(createDataApi(xrpl, env, passThroughCache))).toEqual(junk);

      const trade = broken(pairExchangesBody, (b) => (b.exchanges[0].rate = "1.2000000e-7"));
      fetchSpy.mockResolvedValueOnce(json(trade));
      expect(await trades(createDataApi(xrpl, env, passThroughCache))).toEqual(trade);

      const candle = broken(pairCandlesBody, (b) => Object.assign(b.exchanges[0], { open: "1.2000000e-7", base_volume: "5e-7" }));
      fetchSpy.mockResolvedValueOnce(json(candle));
      expect(await candles(createDataApi(xrpl, env, passThroughCache))).toEqual(candle);
    });

    it("takes the good answers, each as it came, and an empty page: no trades, no candles, no accounts, no markets yet", async () => {
      const api = createDataApi(xrpl, env, passThroughCache);
      fetchSpy.mockResolvedValueOnce(json(pairExchangesBody));
      expect(await trades(api)).toEqual(pairExchangesBody);
      fetchSpy.mockResolvedValueOnce(json(pairCandlesBody));
      expect(await candles(api)).toEqual(pairCandlesBody);

      fetchSpy.mockResolvedValueOnce(json({ result: "success", count: 0, exchanges: [] }));
      expect((await trades(api)).exchanges).toEqual([]);
      fetchSpy.mockResolvedValueOnce(json({ result: "success", count: 0, exchanges: [] }));
      expect((await candles(api)).exchanges).toEqual([]);
      fetchSpy.mockResolvedValueOnce(json({ result: "success", count: 0, exchanges_count: 0, accounts: [] }));
      expect((await active(api)).accounts).toEqual([]);
      // "No set yet" (a database whose aggregator has not written one): no window, no totals.
      const none = { result: "success", period: "day", count: 0, markets: [] };
      fetchSpy.mockResolvedValueOnce(json(none));
      expect(await markets(api)).toEqual(none);
    });

    it("is not kept by the Worker's subrequest cache either, and is held with holdFailure: one request, and both calls throw", async () => {
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      const network = networkOf("xrpl", { ...env, XRPL_DATA_API_URL: "https://malformed-markets.example.invalid" });
      const api = createDataApi(network, env, createSubrequestCache(ctx, "malformed-markets"));
      fetchSpy.mockImplementation(async () => json({ ...marketsBody, markets: "none" }));

      expect((await failureOf(markets(api))).kind).toBe("server");
      expect((await failureOf(markets(api))).kind).toBe("server");
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockClear();
      const first = await failureOf(api.networkMarkets({ period: "7day", limit: 1000 }, { holdFailure: true }));
      const second = await failureOf(api.networkMarkets({ period: "7day", limit: 1000 }, { holdFailure: true }));
      expect(second).toBe(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the CSV of an account's payments", () => {
  const api = () => createDataApi(xrpl, env, passThroughCache);
  const CSV = '"source","destination"\n"rA","rB"\n';
  const csv = (init: { headers?: Record<string, string> } = {}, body: BodyInit | null = CSV) =>
    new Response(body, { status: 200, headers: { "Content-Type": "text/csv", ...init.headers } });

  it("asks for one page of the newest payments in CSV, at the most the API serves, with the key and nothing else", async () => {
    fetchSpy.mockResolvedValueOnce(csv());
    await api().accountPaymentsCsv(ACCOUNT, {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = sentRequest();
    expect(request.method).toBe("GET");
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/v2/accounts/${ACCOUNT}/payments`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ descending: "true", format: "csv", limit: "1000" });
    expect(request.headers.get("X-API-Key")).toBe("test-key");
    expect(request.headers.get("Accept")).toBe("text/csv");
    expect(fetchSpy.mock.calls[0]![1]?.redirect).toBe("manual");
  });

  it("passes the visitor's marker on, in the query", async () => {
    fetchSpy.mockResolvedValueOnce(csv());
    await api().accountPaymentsCsv(ACCOUNT, { marker: "WzEwNzYzNjY3Myw3OF0" });
    expect(new URL(sentRequest().url).searchParams.get("marker")).toBe("WzEwNzYzNjY3Myw3OF0");
  });

  it("returns the body unread, so that it can be streamed", async () => {
    fetchSpy.mockResolvedValueOnce(csv());
    const page = await api().accountPaymentsCsv(ACCOUNT, {});
    expect(page.body).toBeInstanceOf(ReadableStream);
    expect(page.body.locked).toBe(false);
    expect(await new Response(page.body).text()).toBe(CSV);
  });

  it("takes the marker of the next page from the Link header, never the URL the header names", async () => {
    const link = `<https://xrpl.data.example.com/v2/accounts/${ACCOUNT}/payments?limit=1000&marker=WzEwNzY3MDM2MCw1XQ&format=csv>; rel="next"`;
    fetchSpy.mockResolvedValueOnce(csv({ headers: { Link: link } }));
    const page = await api().accountPaymentsCsv(ACCOUNT, {});
    expect(page.nextMarker).toBe("WzEwNzY3MDM2MCw1XQ");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no Link header", undefined],
    ["a Link that is not a next page", `<https://x.example/v2?marker=ABC>; rel="prev"`],
    ["a next page with no marker", `<https://x.example/v2/accounts/${ACCOUNT}/payments?limit=1000>; rel="next"`],
    ["a marker that is not one", `<https://x.example/v2?marker=%3Cscript%3E>; rel="next"`],
    ["a marker that is far too long", `<https://x.example/v2?marker=${"A".repeat(600)}>; rel="next"`],
    ["something that is not a Link at all", "garbage"],
  ])("has no next marker for %s", async (_what, link) => {
    fetchSpy.mockResolvedValueOnce(csv(link === undefined ? {} : { headers: { Link: link } }));
    expect((await api().accountPaymentsCsv(ACCOUNT, {})).nextMarker).toBeUndefined();
  });

  it("is not_found for a 404, bad_request for a 400 (a marker that is not one), rate_limited for a 429 and server for a 500", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "Account not found" }, { status: 404 }));
    expect((await failureOf(api().accountPaymentsCsv(ACCOUNT, {}))).kind).toBe("not_found");
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "invalid marker" }, { status: 400 }));
    const bad = await failureOf(api().accountPaymentsCsv(ACCOUNT, { marker: "x" }));
    expect(bad.kind).toBe("bad_request");
    expect(bad.message).toContain("invalid marker");
    fetchSpy.mockResolvedValueOnce(json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": "4" } }));
    expect(await failureOf(api().accountPaymentsCsv(ACCOUNT, {}))).toMatchObject({ kind: "rate_limited", retryAfter: 4 });
    fetchSpy.mockResolvedValueOnce(json({ result: "error", message: "unable to retrieve payments" }, { status: 500 }));
    expect((await failureOf(api().accountPaymentsCsv(ACCOUNT, {}))).kind).toBe("server");
  });

  it("is a failure for a 200 that is not CSV (a proxy's page, JSON), and cancels what it did not read", async () => {
    fetchSpy.mockResolvedValueOnce(json({ result: "success", payments: [] }));
    const error = await failureOf(api().accountPaymentsCsv(ACCOUNT, {}));
    expect(error.kind).toBe("server");
    expect(error.message).toContain("not CSV");
    fetchSpy.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    expect((await failureOf(api().accountPaymentsCsv(ACCOUNT, {}))).kind).toBe("server");
  });

  it("gives up on an API that does not answer within 5 s, like any other request", async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation(() => new Promise<Response>(() => {}));
    const outcome = failureOf(api().accountPaymentsCsv(ACCOUNT, {}));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await outcome).kind).toBe("timeout");
  });

  it("refuses an address that would be resolved away as a path (empty, . and ..) before any call, and escapes the rest", async () => {
    for (const bad of ["", ".", ".."]) {
      const error = await api().accountPaymentsCsv(bad, {}).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error, JSON.stringify(bad)).toBeInstanceOf(UpstreamError);
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValueOnce(csv());
    await api().accountPaymentsCsv("a/b?c", {});
    expect(new URL(sentRequest().url).pathname).toBe("/v2/accounts/a%2Fb%3Fc/payments");
  });

  it("is never kept by the subrequest cache: the body is a stream", async () => {
    const cache = recordingCache();
    fetchSpy.mockResolvedValueOnce(csv());
    await createDataApi(xrpl, env, cache).accountPaymentsCsv(ACCOUNT, {});
    expect(cache.calls).toEqual([]);
  });
});

