import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { CacheClass } from "../../app/server/cache-class";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { createNodeRpc, RIPPLE_EPOCH_OFFSET, UpstreamError } from "../../app/server/node-rpc";
import { passThroughCache, recordingCache } from "../support/subrequest-cache";

// The node client, in the Workers runtime. `fetch` is replaced in every test; nothing reaches a node.

// The metadata of the AMMDeposit 83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B in ledger
// 107671558 (see test/fixtures/PROVENANCE.md and runtime.spec.ts).
import ammDepositMeta from "../fixtures/runtime/amm-deposit.meta.json";

const env: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
const xrpl = networkOf("xrpl", env);
const xahau = networkOf("xahau", env);

const ACCOUNT = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const TX_HASH = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
const LEDGER_HASH = "A".repeat(64);

// 800000000 seconds after 2000-01-01 00:00:00 UTC is 2025-05-08 06:13:20 UTC, unix time 1746684800.
const RIPPLE_TIME = 800_000_000;
const UNIX_TIME = 1_746_684_800;

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("unexpected network call");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** What rippled and xahaud answer with: HTTP 200 and `{ result }`, a failure having `result.status: "error"`. */
function answer(result: Record<string, unknown>, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
const success = (result: Record<string, unknown>) => answer({ ...result, status: "success" });
const failure = (error: string, message = "") =>
  answer({ error, error_code: 1, error_message: message, request: {}, status: "error" });

function sentRequest(index = -1): Request {
  const [input, init] = fetchSpy.mock.calls.at(index)!;
  return new Request(input, init);
}
async function sentBody(index = -1): Promise<unknown> {
  return sentRequest(index).json();
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

const rpc = () => createNodeRpc(xrpl, passThroughCache);

const txResult = {
  Account: ACCOUNT,
  Fee: "10",
  Sequence: 65213621,
  SigningPubKey: "02AB",
  TransactionType: "AMMDeposit",
  TxnSignature: "3045",
  date: RIPPLE_TIME,
  hash: TX_HASH,
  inLedger: 107671558,
  ledger_index: 107671558,
  meta: ammDepositMeta,
  validated: true,
};

const ledgerHeader = {
  account_hash: "C".repeat(64),
  close_flags: 0,
  close_time: RIPPLE_TIME,
  close_time_human: "2025-May-08 06:13:20.000000000 UTC",
  close_time_resolution: 10,
  closed: true,
  ledger_hash: LEDGER_HASH,
  ledger_index: "107695660",
  parent_close_time: RIPPLE_TIME - 10,
  parent_hash: "B".repeat(64),
  total_coins: "99985687626634189",
  transaction_hash: "D".repeat(64),
};
const ledgerResult = { ledger: ledgerHeader, ledger_hash: LEDGER_HASH, ledger_index: 107695660, validated: true };
const clientLedger = {
  ledger_hash: LEDGER_HASH,
  ledger_index: 107695660,
  parent_hash: "B".repeat(64),
  total_coins: "99985687626634189",
  close_time: UNIX_TIME,
  parent_close_time: UNIX_TIME - 10,
  close_time_resolution: 10,
  close_flags: 0,
  account_hash: "C".repeat(64),
  transaction_hash: "D".repeat(64),
};

describe("the Ripple epoch", () => {
  it("is 2000-01-01 00:00:00 UTC, 946684800 seconds after the unix epoch", () => {
    expect(RIPPLE_EPOCH_OFFSET).toBe(946_684_800);
    expect(Date.UTC(2000, 0, 1) / 1000).toBe(946_684_800);
    expect(new Date((RIPPLE_TIME + RIPPLE_EPOCH_OFFSET) * 1000).toISOString()).toBe("2025-05-08T06:13:20.000Z");
  });
});

describe("requests", () => {
  it("POSTs JSON-RPC to the network's node, with no API key", async () => {
    fetchSpy.mockResolvedValueOnce(success(txResult));

    await rpc().tx(TX_HASH);

    const request = sentRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://s1.ripple.com:51234/");
    expect(request.headers.get("Content-Type")).toContain("application/json");
    // The data API's key belongs to the data API.
    expect(request.headers.get("X-API-Key")).toBeNull();
    expect(request.headers.get("Authorization")).toBeNull();
  });

  it("asks the other network's node for the other network", async () => {
    fetchSpy.mockResolvedValueOnce(success(txResult));

    await createNodeRpc(xahau, passThroughCache).tx(TX_HASH);

    expect(sentRequest().url).toBe("https://xahau.network/");
  });

  it("tx: { method: 'tx', params: [{ transaction }] }", async () => {
    fetchSpy.mockResolvedValueOnce(success(txResult));
    await rpc().tx(TX_HASH);
    expect(await sentBody()).toEqual({ method: "tx", params: [{ transaction: TX_HASH }] });
  });

  it("ledger by index: a number, as the node wants it", async () => {
    fetchSpy.mockResolvedValueOnce(success(ledgerResult));
    await rpc().ledger("107695660");
    expect(await sentBody()).toEqual({ method: "ledger", params: [{ ledger_index: 107695660 }] });
  });

  it("ledger by hash", async () => {
    fetchSpy.mockResolvedValueOnce(success(ledgerResult));
    await rpc().ledger(LEDGER_HASH.toLowerCase());
    expect(await sentBody()).toEqual({ method: "ledger", params: [{ ledger_hash: LEDGER_HASH.toLowerCase() }] });
  });

  it("ledger with transaction hashes, and with the transactions in full (which includes the hashes)", async () => {
    fetchSpy.mockImplementation(async () => success(ledgerResult));

    await rpc().ledger("107695660", { transactions: true });
    expect(await sentBody()).toEqual({ method: "ledger", params: [{ ledger_index: 107695660, transactions: true }] });

    await rpc().ledger("107695660", { expand: true });
    expect(await sentBody()).toEqual({
      method: "ledger",
      params: [{ ledger_index: 107695660, transactions: true, expand: true }],
    });

    await rpc().ledger("107695660", { transactions: false, expand: false });
    expect(await sentBody()).toEqual({ method: "ledger", params: [{ ledger_index: 107695660 }] });
  });

  it.each(["validated", "current", "..", "", "12abc", "-5", "1.5", "9".repeat(20), "A".repeat(63), "G".repeat(64)])(
    "ledger refuses %j as an identifier without asking the node",
    async (id) => {
      expect((await failureOf(rpc().ledger(id))).kind).toBe("bad_request");
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("accountInfo reads the newest validated ledger", async () => {
    fetchSpy.mockResolvedValueOnce(
      success({ account_data: { Account: ACCOUNT }, ledger_index: 107695660, validated: true }),
    );
    await rpc().accountInfo(ACCOUNT);
    expect(await sentBody()).toEqual({
      method: "account_info",
      params: [{ account: ACCOUNT, ledger_index: "validated" }],
    });
  });

  it("accountObjects reads the newest validated ledger, with the limit and marker it is given", async () => {
    fetchSpy.mockImplementation(async () =>
      success({ account: ACCOUNT, account_objects: [], ledger_index: 107695660, validated: true }),
    );

    await rpc().accountObjects(ACCOUNT);
    expect(await sentBody()).toEqual({
      method: "account_objects",
      params: [{ account: ACCOUNT, ledger_index: "validated" }],
    });

    await rpc().accountObjects(ACCOUNT, { limit: 50, marker: "ABC123,4" });
    expect(await sentBody()).toEqual({
      method: "account_objects",
      params: [{ account: ACCOUNT, ledger_index: "validated", limit: 50, marker: "ABC123,4" }],
    });
  });

  it("serverState takes empty parameters", async () => {
    fetchSpy.mockResolvedValueOnce(success({ state: { build_version: "2.5.0", complete_ledgers: "1-2", server_state: "full" } }));
    await rpc().serverState();
    expect(await sentBody()).toEqual({ method: "server_state", params: [{}] });
  });
});

describe("answers", () => {
  it("tx: the transaction and its metadata, apart from what the node wraps them in, with the date in unix seconds", async () => {
    fetchSpy.mockResolvedValueOnce(success({ ...txResult, ledger_hash: LEDGER_HASH }));

    const tx = await rpc().tx(TX_HASH);

    expect(tx.hash).toBe(TX_HASH);
    expect(tx.ledger_index).toBe(107671558);
    expect(tx.ledger_hash).toBe(LEDGER_HASH);
    // The node's `date` is 800000000 seconds after 2000-01-01; the client speaks unix seconds.
    expect(tx.date).toBe(UNIX_TIME);
    expect(tx.meta).toEqual(ammDepositMeta);
    expect(tx.tx).toEqual({
      Account: ACCOUNT,
      Fee: "10",
      Sequence: 65213621,
      SigningPubKey: "02AB",
      TransactionType: "AMMDeposit",
      TxnSignature: "3045",
      hash: TX_HASH,
    });
  });

  it("tx: a transaction that is not in a validated ledger is not found (the explorer shows validated history)", async () => {
    fetchSpy.mockResolvedValueOnce(success({ ...txResult, validated: false }));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("not_found");

    const { validated: _validated, ...withoutFlag } = txResult;
    fetchSpy.mockResolvedValueOnce(success(withoutFlag));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("not_found");
  });

  it("ledger: close_time and parent_close_time in unix seconds, the index a number", async () => {
    fetchSpy.mockResolvedValueOnce(success(ledgerResult));

    const ledger = await rpc().ledger("107695660");

    expect(ledger).toEqual(clientLedger);
    expect("transactions" in ledger).toBe(false);
  });

  it("ledger: transaction hashes are passed on", async () => {
    fetchSpy.mockResolvedValueOnce(
      success({ ...ledgerResult, ledger: { ...ledgerHeader, transactions: ["H1", "H2"] } }),
    );

    expect((await rpc().ledger("107695660", { transactions: true })).transactions).toEqual(["H1", "H2"]);
  });

  it("ledger: expanded transactions become the same objects tx gives, dated by the ledger", async () => {
    const payment = { Account: ACCOUNT, Fee: "10", TransactionType: "Payment", hash: "H1" };
    fetchSpy.mockResolvedValueOnce(
      success({
        ...ledgerResult,
        ledger: { ...ledgerHeader, transactions: [{ ...payment, metaData: ammDepositMeta }] },
      }),
    );

    const ledger = await rpc().ledger("107695660", { expand: true });

    expect(ledger.transactions).toEqual([
      { hash: "H1", ledger_index: 107695660, date: UNIX_TIME, tx: payment, meta: ammDepositMeta },
    ]);
  });

  it("ledger: a ledger that is not validated is not found", async () => {
    fetchSpy.mockResolvedValueOnce(success({ ...ledgerResult, validated: false }));
    expect((await failureOf(rpc().ledger("107695660"))).kind).toBe("not_found");
  });

  it("ledger: an answer without a close time is a server error, not a NaN date", async () => {
    const { close_time: _closeTime, ...without } = ledgerHeader;
    fetchSpy.mockResolvedValueOnce(success({ ...ledgerResult, ledger: without }));
    expect((await failureOf(rpc().ledger("107695660"))).kind).toBe("server");
  });

  it("accountInfo: the account root, the ledger it was read at", async () => {
    const accountData = {
      Account: ACCOUNT,
      Balance: "1589621713",
      Flags: 0,
      LedgerEntryType: "AccountRoot",
      OwnerCount: 2671,
      Sequence: 65213621,
      Domain: "6578616D706C652E636F6D",
      RegularKey: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    };
    fetchSpy.mockResolvedValueOnce(success({ account_data: accountData, ledger_index: 107695660, validated: true }));

    expect(await rpc().accountInfo(ACCOUNT)).toEqual({
      account_data: accountData,
      ledger_index: 107695660,
      validated: true,
    });
  });

  it("accountObjects: the objects and the marker for the next page", async () => {
    const objects = [
      { LedgerEntryType: "Escrow", Account: ACCOUNT, Amount: "1000000", index: "E1" },
      { LedgerEntryType: "Check", Account: ACCOUNT, index: "C1" },
    ];
    fetchSpy.mockResolvedValueOnce(
      success({ account: ACCOUNT, account_objects: objects, ledger_index: 107695660, limit: 2, marker: "C1,0", validated: true }),
    );

    expect(await rpc().accountObjects(ACCOUNT, { limit: 2 })).toEqual({
      account: ACCOUNT,
      account_objects: objects,
      ledger_index: 107695660,
      limit: 2,
      marker: "C1,0",
      validated: true,
    });
  });

  it("serverState: the reserves in drops, and the ledger close times in unix seconds", async () => {
    fetchSpy.mockResolvedValueOnce(
      success({
        state: {
          build_version: "2.5.0",
          complete_ledgers: "32570-107695660",
          server_state: "full",
          peers: 25,
          validated_ledger: {
            base_fee: 10,
            close_time: RIPPLE_TIME,
            hash: LEDGER_HASH,
            reserve_base: 1_000_000,
            reserve_inc: 200_000,
            seq: 107695660,
          },
          closed_ledger: {
            base_fee: 10,
            close_time: RIPPLE_TIME + 4,
            hash: "B".repeat(64),
            reserve_base: 1_000_000,
            reserve_inc: 200_000,
            seq: 107695661,
          },
        },
      }),
    );

    const state = await rpc().serverState();

    expect(state.build_version).toBe("2.5.0");
    expect(state.server_state).toBe("full");
    expect(state.validated_ledger).toEqual({
      base_fee: 10,
      close_time: UNIX_TIME,
      hash: LEDGER_HASH,
      reserve_base: 1_000_000,
      reserve_inc: 200_000,
      seq: 107695660,
    });
    expect(state.closed_ledger?.close_time).toBe(UNIX_TIME + 4);
  });

  it("serverState: a node with no validated ledger yet has none to report", async () => {
    fetchSpy.mockResolvedValueOnce(
      success({ state: { build_version: "2.5.0", complete_ledgers: "empty", server_state: "connected" } }),
    );

    expect((await rpc().serverState()).validated_ledger).toBeUndefined();
  });
});

describe("errors", () => {
  it.each([
    ["actNotFound", () => rpc().accountInfo(ACCOUNT)],
    ["actNotFound", () => rpc().accountObjects(ACCOUNT)],
    ["txnNotFound", () => rpc().tx(TX_HASH)],
    ["lgrNotFound", () => rpc().ledger("107695660")],
  ] as const)("%s is not_found", async (code, call) => {
    fetchSpy.mockResolvedValueOnce(failure(code, "Not found."));

    const error = await failureOf(call());

    expect(error.kind).toBe("not_found");
    expect(error.message).toContain(code);
  });

  it("a request the node calls malformed is bad_request", async () => {
    fetchSpy.mockResolvedValueOnce(failure("invalidParams", "Missing field 'account'."));
    const error = await failureOf(rpc().accountInfo(ACCOUNT));
    expect(error.kind).toBe("bad_request");
    expect(error.message).toContain("Missing field 'account'.");

    fetchSpy.mockResolvedValueOnce(failure("actMalformed", "Account malformed."));
    expect((await failureOf(rpc().accountInfo("nope"))).kind).toBe("bad_request");
  });

  it("slowDown is rate_limited", async () => {
    fetchSpy.mockResolvedValueOnce(failure("slowDown", "You are placing too much load on the server."));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("rate_limited");
  });

  it.each(["noNetwork", "tooBusy", "notSynced", "internal", "somethingNew"])("%s is server", async (code) => {
    fetchSpy.mockResolvedValueOnce(failure(code));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("server");
  });

  it("HTTP 429 is rate_limited, with its Retry-After", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "4" } }));

    const error = await failureOf(rpc().tx(TX_HASH));

    expect(error.kind).toBe("rate_limited");
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(4);
  });

  it("any other failing HTTP status is server, even a 404 (a wrong address is not a missing account)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("overloaded", { status: 503 }));
    const unavailable = await failureOf(rpc().tx(TX_HASH));
    expect(unavailable.kind).toBe("server");
    expect(unavailable.status).toBe(503);

    fetchSpy.mockResolvedValueOnce(new Response("not here", { status: 404 }));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("server");
  });

  it("an answer that is not JSON-RPC is server", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("server");

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ nothing: true }), { status: 200 }));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("server");
  });

  it("a connection that fails is network", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Network connection lost."));
    expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("network");
  });

  it("gives up on a node that never answers after 3 s, and aborts the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    fetchSpy.mockImplementation((_input, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    let settled = false;
    const outcome = rpc()
      .serverState()
      .then(
        () => "resolved",
        (reason: unknown) => reason,
      )
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;

    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).kind).toBe("timeout");
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
    const outcome = rpc()
      .serverState()
      .then(
        () => "resolved",
        (reason: unknown) => reason,
      );

    await vi.advanceTimersByTimeAsync(3000);

    expect(((await outcome) as UpstreamError).kind).toBe("timeout");
  });

  it("covers reading the body too", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const outcome = rpc()
      .tx(TX_HASH)
      .then(
        () => "resolved",
        (reason: unknown) => reason,
      );

    await vi.advanceTimersByTimeAsync(3000);

    expect(((await outcome) as UpstreamError).kind).toBe("timeout");
  });
});

describe("cache", () => {
  it("answers about the live node are stored as live (5 s), the server state as slow with a 300 s TTL", async () => {
    const cache = recordingCache();
    const node = createNodeRpc(xrpl, cache);
    fetchSpy
      .mockResolvedValueOnce(success(txResult))
      .mockResolvedValueOnce(success(ledgerResult))
      .mockResolvedValueOnce(success({ account_data: { Account: ACCOUNT }, ledger_index: 1, validated: true }))
      .mockResolvedValueOnce(success({ account: ACCOUNT, account_objects: [], ledger_index: 1, validated: true }))
      .mockResolvedValueOnce(success({ state: { build_version: "2.5.0", complete_ledgers: "1-2", server_state: "full" } }));

    await node.tx(TX_HASH);
    await node.ledger("107695660");
    await node.accountInfo(ACCOUNT);
    await node.accountObjects(ACCOUNT);
    await node.serverState();

    const classes: [CacheClass, number | undefined][] = cache.calls.map((c) => [c.cls, c.ttlOverride]);
    expect(classes).toEqual([
      ["live", undefined],
      ["live", undefined],
      ["live", undefined],
      ["live", undefined],
      ["slow", 300],
    ]);
  });

  it("keys a call by the node, the method and the parameters", async () => {
    const cache = recordingCache();
    fetchSpy.mockImplementation(async () => success({ account: ACCOUNT, account_objects: [], ledger_index: 1, validated: true }));

    await createNodeRpc(xrpl, cache).accountObjects(ACCOUNT, { limit: 10 });
    await createNodeRpc(xrpl, cache).accountObjects(ACCOUNT, { limit: 20 });
    await createNodeRpc(xahau, cache).accountObjects(ACCOUNT, { limit: 10 });
    await createNodeRpc(xrpl, cache).accountObjects(ACCOUNT, { limit: 10 });

    const keys = cache.calls.map((c) => c.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe(keys[3]);
    expect(keys[0]).toContain("https://s1.ripple.com:51234/");
    expect(keys[0]).toContain("account_objects");
    expect(keys[0]).toContain(ACCOUNT);
  });

  it("does not look in the cache for the request it refuses", async () => {
    const cache = recordingCache();
    await failureOf(createNodeRpc(xrpl, cache).ledger("validated"));
    expect(cache.calls).toEqual([]);
  });
});
