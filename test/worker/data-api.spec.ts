import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi, type MockInstance } from "vitest";

import type { TxObject } from "../../app/server/api-types";
import type { CacheClass } from "../../app/server/cache-class";
import { createDataApi, UpstreamError, type DataApi } from "../../app/server/data-api";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { passThroughCache, recordingCache } from "../support/subrequest-cache";

// The Data API client, in the Workers runtime. Nothing here reaches the network: `fetch` is replaced in every
// test, and the data API hosts of the env are `.invalid` anyway.

const env: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid/",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
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

type Case = {
  name: string;
  call: (api: DataApi) => Promise<unknown>;
  /** Path and query of the request, after the host. */
  url: string;
  /** What the data API answers. */
  body: unknown;
  /** What the client resolves to. */
  result: unknown;
  /** The cache class the answer is stored under. */
  cls: CacheClass;
};

const cases: Case[] = [
  {
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
    cls: "immutable",
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
    cls: "immutable",
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
    cls: "immutable",
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
    cls: "immutable",
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

  it("asks for the transactions whenever it asks for them in full, which the API otherwise leaves out of an empty ledger", async () => {
    fetchSpy.mockImplementation(async () => json(expandedLedgerBody));
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

  it("is an empty list too when the answer leaves the key out (the API does for expand alone on an empty ledger)", async () => {
    fetchSpy.mockImplementation(async () => json(ledgerBody));
    const api = createDataApi(xrpl, env, passThroughCache);

    const expanded = await api.ledger("107695660", { expand: true });
    const hashes = await api.ledger("107695660", { transactions: true });

    expect(expanded.transactions).toEqual([]);
    expect(hashes.transactions).toEqual([]);
    expect(expanded.ledger_index).toBe(107695660);
  });

  it("leaves a ledger fetched without its transactions without a transactions key", async () => {
    fetchSpy.mockResolvedValueOnce(json(ledgerBody));

    const ledger = await createDataApi(xrpl, env, passThroughCache).ledger("107695660");

    expect("transactions" in ledger).toBe(false);
  });

  it("types the transactions of a ledger by what was asked for", async () => {
    fetchSpy.mockImplementation(async () => json(expandedLedgerBody));
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
    await createDataApi(xrpl, env, passThroughCache).transaction("AB/CD?x#y");
    expect(sentRequest().url).toBe(`${BASE}/v2/transactions/AB%2FCD%3Fx%23y`);
  });

  it.each(["..", ".", ""])("refuses %j as an identifier without sending anything", async (id) => {
    const api = createDataApi(xrpl, env, passThroughCache);
    expect((await failureOf(api.ledger(id))).kind).toBe("bad_request");
    expect((await failureOf(api.transaction(id))).kind).toBe("bad_request");
    expect((await failureOf(api.account(id))).kind).toBe("bad_request");
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

  it("a page after a marker is stable only when the list is newest first", async () => {
    const cache = recordingCache();
    fetchSpy.mockImplementation(async () => json(transactionsBody));
    const api = createDataApi(xrpl, env, cache);

    await api.transactions({ limit: 20, marker: "m" });
    await api.accountTransactions(ACCOUNT, { descending: false, limit: 20, marker: "m" });

    expect(cache.calls.map((c) => c.cls)).toEqual(["live", "live"]);
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
