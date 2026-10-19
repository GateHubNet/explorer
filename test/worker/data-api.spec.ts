import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi, type MockInstance } from "vitest";

import type {
  AmmVolumeComponent,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeRow,
  FeeStatsRow,
  LedgerValidations,
  Page,
  PaymentVolumeComponent,
  StatsRow,
  TxObject,
  VolumeRow,
} from "../../app/server/api-types";
import { CACHE_CLASSES, HOME_CALL_TTL_SECONDS, MARKER_PAGE_CLASS, PERIOD_CALL_TTL_SECONDS, type CacheClass } from "../../app/server/cache-class";
import { createDataApi, UpstreamError, type DataApi, type FreshOptions } from "../../app/server/data-api";
import { createSubrequestCache } from "../../app/server/edge-cache";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { passThroughCache, recordingCache } from "../support/subrequest-cache";
import { allSwitches } from "../support/switches";

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
/** The window the network page asks for on 2026-10-17 (the index day): 30 days of buckets, up to and with that day. */
const PERIOD = { start: "2026-09-18", end: "2026-10-17" };

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
        [`a ${name} component whose converted_amount is "1e3"`, broken(good, (b) => (b.rows[0].components[0].converted_amount = "1e3")), call, good],
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

