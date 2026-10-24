import { encodeAccountID } from "ripple-address-codec";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { Asset } from "../../app/domain/asset";
import type { CacheClass } from "../../app/server/cache-class";
import { createSubrequestCache } from "../../app/server/edge-cache";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { BOOK_OFFERS_LIMIT, createNodeRpc, RIPPLE_EPOCH_OFFSET, UpstreamError } from "../../app/server/node-rpc";
import { passThroughCache, recordingCache } from "../support/subrequest-cache";
import { allSwitches } from "../support/switches";

// The node client, in the Workers runtime. `fetch` is replaced in every test; nothing reaches a node.

// The metadata of the AMMDeposit 83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B in ledger
// 107671558 (see test/fixtures/PROVENANCE.md and runtime.spec.ts).
import ammDepositMeta from "../fixtures/runtime/amm-deposit.meta.json";

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
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

// ---- book_offers and amm_info ---------------------------------------------------------------------------------------

const XRP: Asset = { currency: "XRP" };
const XAH: Asset = { currency: "XAH" };
const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const LIONS: Asset = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

const issued = (asset: Asset, value: string) => ({ currency: asset.currency, issuer: asset.issuer, value });
const rlusd = (value: string) => issued(RLUSD, value);

/** An offer as the node lists it: the whole ledger entry and what `book_offers` adds, of which the client keeps a few fields. */
function offerOf(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Account: ACCOUNT,
    BookDirectory: "54123B870896F4964184D7042DB75D78913D3E377BFC4ECA4F0497E2BD3AE800",
    BookNode: "0",
    Flags: 0,
    LedgerEntryType: "Offer",
    OwnerNode: "0",
    PreviousTxnID: TX_HASH,
    PreviousTxnLgrSeq: 107779810,
    Sequence: 107422249,
    TakerGets: "1500000",
    TakerPays: rlusd("1.93935"),
    index: "923F7AACCA51D885462A50A85D27745AF155A510F12696037DB39DD99AEA3A1B",
    owner_funds: "6930053",
    quality: "0.00000129290",
    ...extra,
  };
}
/** Clio's `book_offers` result for `ledger_index: "validated"` has no `validated`; rippled's and xahaud's have (see the comment on `toBook`). */
const bookResult = (offers: unknown, extra: Record<string, unknown> = {}) => ({
  ledger_hash: LEDGER_HASH,
  ledger_index: 107779813,
  offers,
  validated: true,
  ...extra,
});

describe("book_offers", () => {
  it("has a limit of 60, the default of rippled and Clio", () => {
    expect(BOOK_OFFERS_LIMIT).toBe(60);
  });

  describe("requests", () => {
    it("bookOffers(XRP, RLUSD): taker_gets, taker_pays, the newest validated ledger and the limit", async () => {
      fetchSpy.mockResolvedValueOnce(success(bookResult([])));

      await rpc().bookOffers(XRP, RLUSD);

      expect(sentRequest().url).toBe("https://s1.ripple.com:51234/");
      expect(await sentBody()).toEqual({
        method: "book_offers",
        params: [{ taker_gets: { currency: "XRP" }, taker_pays: { currency: RLUSD.currency, issuer: RLUSD.issuer }, ledger_index: "validated", limit: 60 }],
      });
    });

    it("sends the issued asset first when it is taker_gets, with its currency as the ledger holds it", async () => {
      fetchSpy.mockResolvedValueOnce(success(bookResult([])));

      await rpc().bookOffers(LIONS, XRP);

      expect(await sentBody()).toEqual({
        method: "book_offers",
        params: [{ taker_gets: { currency: LIONS.currency, issuer: LIONS.issuer }, taker_pays: { currency: "XRP" }, ledger_index: "validated", limit: 60 }],
      });
    });

    it("sends a standard code as its three characters", async () => {
      fetchSpy.mockResolvedValueOnce(success(bookResult([])));
      await rpc().bookOffers({ currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" }, XRP);
      const [params] = ((await sentBody()) as { params: Record<string, unknown>[] }).params;
      expect(params!.taker_gets).toEqual({ currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" });
    });

    it("on Xahau the native side is { currency: 'XAH' }, and the node is Xahau's", async () => {
      fetchSpy.mockResolvedValueOnce(success(bookResult([])));

      await createNodeRpc(xahau, passThroughCache).bookOffers(XAH, EVR);

      expect(sentRequest().url).toBe("https://xahau.network/");
      expect(await sentBody()).toEqual({
        method: "book_offers",
        params: [{ taker_gets: { currency: "XAH" }, taker_pays: { currency: "EVR", issuer: EVR.issuer }, ledger_index: "validated", limit: 60 }],
      });

      fetchSpy.mockResolvedValueOnce(success(bookResult([])));
      await createNodeRpc(xahau, passThroughCache).bookOffers(EVR, XAH);
      const [params] = ((await sentBody()) as { params: Record<string, unknown>[] }).params;
      expect(params).toMatchObject({ taker_gets: { currency: "EVR" }, taker_pays: { currency: "XAH" } });
    });

    it("refuses a native asset that is not the network's own, without asking the node or the cache", async () => {
      const cache = recordingCache();
      expect((await failureOf(createNodeRpc(xrpl, cache).bookOffers(XAH, RLUSD))).kind).toBe("bad_request");
      expect((await failureOf(createNodeRpc(xahau, cache).bookOffers(EVR, XRP))).kind).toBe("bad_request");
      expect((await failureOf(createNodeRpc(xrpl, cache).ammInfoByPair(XRP, XAH))).kind).toBe("bad_request");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(cache.calls).toEqual([]);
    });
  });

  describe("answers", () => {
    it("the ledger it was read at and the offers trimmed to their account, sequence and amounts, native drops in whole units", async () => {
      fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf(), offerOf({ Account: "rOther", Sequence: 9, TakerGets: "1000000", TakerPays: rlusd("1.5") })])));

      const book = await rpc().bookOffers(XRP, RLUSD);

      expect(book).toEqual({
        ledgerIndex: 107779813,
        offers: [
          { account: ACCOUNT, sequence: 107422249, gets: { currency: "XRP", value: "1.5" }, pays: rlusd("1.93935") },
          { account: "rOther", sequence: 9, gets: { currency: "XRP", value: "1" }, pays: rlusd("1.5") },
        ],
      });
      // Nothing else of the ledger entry is kept: a cached book is small.
      expect(Object.keys(book.offers[0]!)).toEqual(["account", "sequence", "gets", "pays"]);
    });

    it("drops become whole units exactly: 1500000 is 1.5, one drop 0.000001, and a whole number has no point", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(bookResult([offerOf({ TakerGets: "1500000" }), offerOf({ TakerGets: "1" }), offerOf({ TakerGets: "2000000" }), offerOf({ TakerGets: "0012000000" })])),
      );
      const book = await rpc().bookOffers(XRP, RLUSD);
      expect(book.offers.map((offer) => offer.gets.value)).toEqual(["1.5", "0.000001", "2", "12"]);
    });

    it("converts the native side of either direction, and Xahau's native amount to XAH", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(bookResult([offerOf({ TakerGets: rlusd("5"), TakerPays: "2500000" })])),
      );
      expect((await rpc().bookOffers(RLUSD, XRP)).offers[0]).toMatchObject({ gets: rlusd("5"), pays: { currency: "XRP", value: "2.5" } });

      fetchSpy.mockResolvedValueOnce(
        success(bookResult([offerOf({ TakerGets: "7308680909", TakerPays: issued(EVR, "1029.391677323944") })], { ledger_index: 26659639 })),
      );
      const book = await createNodeRpc(xahau, passThroughCache).bookOffers(XAH, EVR);
      expect(book.ledgerIndex).toBe(26659639);
      expect(book.offers[0]).toMatchObject({ gets: { currency: "XAH", value: "7308.680909" }, pays: issued(EVR, "1029.391677323944") });
    });

    it("keeps the funded amounts of a partly funded offer, in whole units, and leaves them out of a funded one", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(
          bookResult([
            offerOf({ TakerGets: "4000000", TakerPays: rlusd("5"), taker_gets_funded: "2500000", taker_pays_funded: rlusd("3.125") }),
            offerOf({ TakerGets: "4000000", TakerPays: rlusd("5"), taker_gets_funded: "0", taker_pays_funded: rlusd("0") }),
            offerOf({ TakerGets: "4000000", TakerPays: rlusd("5") }),
          ]),
        ),
      );

      const { offers } = await rpc().bookOffers(XRP, RLUSD);

      expect(offers[0]).toEqual({
        account: ACCOUNT,
        sequence: 107422249,
        gets: { currency: "XRP", value: "4" },
        pays: rlusd("5"),
        getsFunded: { currency: "XRP", value: "2.5" },
        paysFunded: rlusd("3.125"),
      });
      expect(offers[1]).toMatchObject({ getsFunded: { currency: "XRP", value: "0" }, paysFunded: rlusd("0") });
      expect("getsFunded" in offers[2]!).toBe(false);
      expect("paysFunded" in offers[2]!).toBe(false);
    });

    it("an empty book is an answer: no offers, and the ledger it was read at", async () => {
      fetchSpy.mockResolvedValueOnce(success(bookResult([])));
      expect(await rpc().bookOffers(XRP, LIONS)).toEqual({ ledgerIndex: 107779813, offers: [] });
    });

    it("writes an issued amount the node gives with an exponent as a plain decimal", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(
          bookResult([
            offerOf({ TakerGets: rlusd("5876901213283910e-4"), TakerPays: issued(LIONS, "1000000000000000e-30"), taker_gets_funded: rlusd("9999999999999999e-2") }),
          ]),
        ),
      );

      const [offer] = (await rpc().bookOffers(RLUSD, LIONS)).offers;

      expect(offer!.gets.value).toBe("587690121328.391");
      expect(offer!.pays.value).toBe("0.000000000000001");
      expect(offer!.getsFunded!.value).toBe("99999999999999.99");
    });

    it("a result without `validated` is accepted (Clio's book_offers has none for the validated ledger), but not a `validated: false`", async () => {
      const { validated: _validated, ...clio } = bookResult([offerOf()]);
      fetchSpy.mockResolvedValueOnce(success(clio));
      expect((await rpc().bookOffers(XRP, RLUSD)).offers).toHaveLength(1);

      for (const validated of [false, "true", 1, null]) {
        fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf()], { validated })));
        expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind, JSON.stringify(validated)).toBe("server");
      }
    });

    it.each([
      ["no offers list", () => bookResult(undefined)],
      ["offers that is not a list", () => bookResult({ 0: offerOf() })],
      ["no ledger_index", () => bookResult([], { ledger_index: undefined })],
      ["a ledger_index that is text", () => bookResult([], { ledger_index: "107779813" })],
      ["an offer that is not an object", () => bookResult(["offer"])],
      ["an offer without an account", () => bookResult([offerOf({ Account: undefined })])],
      ["an offer without a sequence", () => bookResult([offerOf({ Sequence: undefined })])],
      ["an offer with a sequence that is text", () => bookResult([offerOf({ Sequence: "7" })])],
      ["an offer without TakerGets", () => bookResult([offerOf({ TakerGets: undefined })])],
      ["an offer without TakerPays", () => bookResult([offerOf({ TakerPays: undefined })])],
      ["drops that are not whole", () => bookResult([offerOf({ TakerGets: "1.5" })])],
      ["drops that are negative", () => bookResult([offerOf({ TakerGets: "-1" })])],
      ["drops that are text", () => bookResult([offerOf({ TakerGets: "many" })])],
      ["an amount that is a number", () => bookResult([offerOf({ TakerGets: 1500000 })])],
      ["an issued amount without a value", () => bookResult([offerOf({ TakerPays: { currency: RLUSD.currency, issuer: RLUSD.issuer } })])],
      ["an issued amount with a value that is not a number", () => bookResult([offerOf({ TakerPays: rlusd("lots") })])],
      ["an issued amount with a negative value", () => bookResult([offerOf({ TakerPays: rlusd("-1") })])],
      ["an issued amount with a value that is a number", () => bookResult([offerOf({ TakerPays: { ...RLUSD, value: 1.5 } })])],
      ["an issued amount without a currency", () => bookResult([offerOf({ TakerPays: { issuer: RLUSD.issuer, value: "1" } })])],
      ["an issued amount without an issuer", () => bookResult([offerOf({ TakerPays: { currency: RLUSD.currency, value: "1" } })])],
      ["a funded amount that is not an amount", () => bookResult([offerOf({ taker_gets_funded: "half" })])],
      ["a funded amount that is null", () => bookResult([offerOf({ taker_pays_funded: null })])],
    ])("%s is a server error, not half a book", async (_what, make) => {
      fetchSpy.mockResolvedValueOnce(success(make()));
      expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind).toBe("server");
    });

    it("a full amount of zero is a server error, because the price is the ratio of the full amounts; a funded zero is not", async () => {
      for (const change of [
        { TakerGets: "0" },
        { TakerPays: rlusd("0") },
        { TakerPays: rlusd("0.000") },
        { TakerGets: "000" },
      ]) {
        fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf(change)])));
        const error = await failureOf(rpc().bookOffers(XRP, RLUSD));
        expect(error.kind, JSON.stringify(change)).toBe("server");
      }
      fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf({ taker_gets_funded: "0", taker_pays_funded: rlusd("0") })])));
      expect((await rpc().bookOffers(XRP, RLUSD)).offers).toHaveLength(1);
    });

    it("an offer must be of the assets asked for, full and funded amounts alike", async () => {
      const dollars = (value: string) => issued({ ...RLUSD, issuer: LIONS.issuer }, value);
      for (const [what, change] of [
        ["TakerGets of another currency", { TakerGets: issued(LIONS, "5") }],
        ["TakerGets the wrong way round", { TakerGets: rlusd("5") }],
        ["TakerPays native", { TakerPays: "5000000" }],
        ["TakerPays of the right currency and another issuer", { TakerPays: dollars("5") }],
        ["a funded amount of another asset", { taker_gets_funded: rlusd("1") }],
        ["a funded amount of another issuer", { taker_pays_funded: dollars("1") }],
      ] as const) {
        fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf(), offerOf(change)])));
        expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind, what).toBe("server");
      }
      // The same offer is right for the book the other way round, and wrong for the book it was not asked for.
      fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf({ TakerGets: rlusd("5"), TakerPays: "2500000" })])));
      expect((await rpc().bookOffers(RLUSD, XRP)).offers).toHaveLength(1);
      fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf({ TakerGets: rlusd("5"), TakerPays: "2500000" })])));
      expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind).toBe("server");
    });

    it("no more offers than were asked for", async () => {
      const offers = (count: number) => Array.from({ length: count }, (_, at) => offerOf({ Sequence: at }));
      fetchSpy.mockResolvedValueOnce(success(bookResult(offers(BOOK_OFFERS_LIMIT))));
      expect((await rpc().bookOffers(XRP, RLUSD)).offers).toHaveLength(60);
      fetchSpy.mockResolvedValueOnce(success(bookResult(offers(BOOK_OFFERS_LIMIT + 1))));
      const error = await failureOf(rpc().bookOffers(XRP, RLUSD));
      expect(error.kind).toBe("server");
      expect(error.message).toContain("offers");
    });

    it("a sequence and a ledger index are whole numbers from zero", async () => {
      for (const change of [{ Sequence: 1.5 }, { Sequence: -1 }]) {
        fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf(change)])));
        expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind, JSON.stringify(change)).toBe("server");
      }
      for (const ledger_index of [1.5, -1]) {
        fetchSpy.mockResolvedValueOnce(success(bookResult([], { ledger_index })));
        expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind, String(ledger_index)).toBe("server");
      }
      fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf({ Sequence: 0 })], { ledger_index: 0 })));
      expect(await rpc().bookOffers(XRP, RLUSD)).toMatchObject({ ledgerIndex: 0 });
    });

    describe("an issued value is in the range rippled can write", () => {
      it.each([
        "1000000000000000e-96",
        "9999999999999999e80",
        "1e-81",
        "5e80",
        "0.000000000000000000000001234567890123456",
      ])("%s is read", async (value) => {
        fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf({ TakerPays: rlusd(value) })])));
        expect((await rpc().bookOffers(XRP, RLUSD)).offers[0]!.pays.value).toMatch(/^\d+(\.\d+)?$/);
      });

      it.each([
        "1e81",
        "1e-97",
        "1000000000000000e-97",
        "9999999999999999e81",
        "1e-82",
        "9999999999999999e80000",
        "1e999",
        "1e9999",
        `0.${"0".repeat(70)}1`,
        "1".repeat(65),
      ])("%s is a server error", async (value) => {
        fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf({ TakerPays: rlusd(value) })])));
        expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind).toBe("server");
      });
    });

    it("one bad offer fails the whole book", async () => {
      fetchSpy.mockResolvedValueOnce(success(bookResult([offerOf(), offerOf({ TakerGets: "x" }), offerOf()])));
      expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind).toBe("server");
    });
  });

  describe("errors", () => {
    it.each(["srcCurMalformed", "srcIsrMalformed", "dstAmtMalformed", "dstIsrMalformed", "badMarket", "issueMalformed", "invalidParams"])(
      "%s is bad_request",
      async (code) => {
        fetchSpy.mockResolvedValueOnce(failure(code, "Invalid field 'taker_gets.issuer', expected non-XRP issuer."));

        const error = await failureOf(rpc().bookOffers(XRP, RLUSD));

        expect(error.kind).toBe("bad_request");
        expect(error.message).toContain(code);
      },
    );

    it.each(["actNotFound", "lgrNotFound", "txnNotFound"])(
      "%s is server for a book, which has no 'not found': a node with no validated ledger is an outage, not a market that is not there",
      async (code) => {
        fetchSpy.mockResolvedValueOnce(failure(code, "ledgerNotFound"));

        const error = await failureOf(rpc().bookOffers(XRP, RLUSD));

        expect(error.kind).toBe("server");
        expect(error.message).toContain(code);
      },
    );

    it("a malformed account is still bad_request for a book", async () => {
      fetchSpy.mockResolvedValueOnce(failure("actMalformed", "Account malformed."));
      expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind).toBe("bad_request");
    });

    it("a node that is busy or unsynced is server, and slowDown rate_limited", async () => {
      fetchSpy.mockResolvedValueOnce(failure("noNetwork"));
      expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind).toBe("server");
      fetchSpy.mockResolvedValueOnce(failure("slowDown"));
      expect((await failureOf(rpc().bookOffers(XRP, RLUSD))).kind).toBe("rate_limited");
    });

    it("the new codes are bad_request for every call, not for book_offers alone", async () => {
      fetchSpy.mockResolvedValueOnce(failure("badMarket"));
      expect((await failureOf(rpc().tx(TX_HASH))).kind).toBe("bad_request");
    });
  });

  describe("cache", () => {
    it("is class live, keyed by the node, the method and the assets, with no TTL of its own unless it is asked for", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async () => success(bookResult([])));

      await createNodeRpc(xrpl, cache).bookOffers(XRP, RLUSD);
      await createNodeRpc(xrpl, cache).bookOffers(RLUSD, XRP);
      await createNodeRpc(xrpl, cache).bookOffers(XRP, RLUSD);

      expect(cache.calls.map((call) => [call.cls, call.ttlOverride])).toEqual([["live", undefined], ["live", undefined], ["live", undefined]]);
      expect(cache.calls[0]!.key).toBe(cache.calls[2]!.key);
      expect(cache.calls[0]!.key).not.toBe(cache.calls[1]!.key);
      expect(cache.calls[0]!.key).toContain("https://s1.ripple.com:51234/");
      expect(cache.calls[0]!.key).toContain("book_offers");
      expect(cache.calls[0]!.key).not.toContain("kept");
    });

    it("with { ttl: 2 } the answer is kept 2 s under a key of its own, ending ` [kept 2 s]`", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async () => success(bookResult([])));
      const node = createNodeRpc(xrpl, cache);

      await node.bookOffers(XRP, RLUSD);
      await node.bookOffers(XRP, RLUSD, { ttl: 2 });

      expect(cache.calls[1]).toMatchObject({ cls: "live", ttlOverride: 2 });
      expect(cache.calls[1]!.key.endsWith(" [kept 2 s]")).toBe(true);
      expect(cache.calls[1]!.key).toBe(`${cache.calls[0]!.key} [kept 2 s]`);
    });

    it("a TTL of zero is a TTL: kept 0 s, under its own key", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async () => success(bookResult([])));
      await createNodeRpc(xrpl, cache).bookOffers(XRP, RLUSD, { ttl: 0 });
      expect(cache.calls[0]).toMatchObject({ ttlOverride: 0 });
      expect(cache.calls[0]!.key.endsWith(" [kept 0 s]")).toBe(true);
    });

    it("asks for the failure hold only when it is told to, and the hold is not part of the key", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async () => success(bookResult([])));
      const node = createNodeRpc(xrpl, cache);

      await node.bookOffers(XRP, RLUSD);
      await node.bookOffers(XRP, RLUSD, { holdFailure: true });
      await node.bookOffers(XRP, RLUSD, { ttl: 2, holdFailure: true });
      await node.bookOffers(XRP, RLUSD, { holdFailure: false });

      expect(cache.calls.map((call) => call.holdFailure === true)).toEqual([false, true, true, false]);
      expect(cache.calls[1]!.key).toBe(cache.calls[0]!.key);
      expect(cache.calls[2]!.key).toBe(`${cache.calls[0]!.key} [kept 2 s]`);
    });

    it("the server state keeps the key it has: its 300 s are no `ttl` of the caller's", async () => {
      const cache = recordingCache();
      fetchSpy.mockResolvedValueOnce(success({ state: { build_version: "2.5.0", complete_ledgers: "1-2", server_state: "full" } }));

      await createNodeRpc(xrpl, cache).serverState();

      expect(cache.calls).toEqual([{ key: 'POST https://s1.ripple.com:51234/ {"method":"server_state","params":[{}]}', cls: "slow", ttlOverride: 300 }]);
    });

    describe("through the Worker's subrequest cache", () => {
      // A pair of its own for each case: this file's Cache API and the hold outlive a test.
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      const nodeOf = () => createNodeRpc(xrpl, createSubrequestCache(ctx, "node-hold"));
      const heldAsset = (code: string): Asset => ({ currency: code, issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" });

      it("holds a failing book: a second call within 5 s makes no request, and throws the same failure", async () => {
        fetchSpy.mockImplementation(async () => failure("noNetwork", "Not synced to the network."));
        const node = nodeOf();
        const pays = heldAsset("HL1");

        const first = await failureOf(node.bookOffers(XRP, pays, { ttl: 2, holdFailure: true }));
        const second = await failureOf(node.bookOffers(XRP, pays, { ttl: 2, holdFailure: true }));

        expect(first.kind).toBe("server");
        expect(second).toBe(first);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      it("holds nothing for a call that does not ask: it asks the node again", async () => {
        fetchSpy.mockImplementation(async () => failure("noNetwork", "Not synced to the network."));
        const node = nodeOf();
        const pays = heldAsset("HL2");

        await failureOf(node.bookOffers(XRP, pays));
        await failureOf(node.bookOffers(XRP, pays));

        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it("never holds a market the node does not know or finds malformed, which is the page's answer and not an outage", async () => {
        fetchSpy.mockImplementation(async () => failure("badMarket"));
        const node = nodeOf();
        const pays = heldAsset("HL3");

        expect((await failureOf(node.bookOffers(XRP, pays, { holdFailure: true }))).kind).toBe("bad_request");
        expect((await failureOf(node.bookOffers(XRP, pays, { holdFailure: true }))).kind).toBe("bad_request");
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it("holds a failing amm_info in both forms, and a pool that is not there is no failure to hold", async () => {
        fetchSpy.mockImplementation(async () => failure("tooBusy", "The server is too busy to help you now."));
        const node = nodeOf();

        await failureOf(node.ammInfo("rHeldPoo1111111111111111111111111", { holdFailure: true }));
        await failureOf(node.ammInfo("rHeldPoo1111111111111111111111111", { holdFailure: true }));
        await failureOf(node.ammInfoByPair(XRP, heldAsset("HL4"), { holdFailure: true }));
        await failureOf(node.ammInfoByPair(XRP, heldAsset("HL4"), { holdFailure: true }));
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        // A node with no validated ledger yet is an outage and is held, where "no such pool" is an answer.
        fetchSpy.mockImplementation(async () => failure("lgrNotFound", "ledgerNotFound"));
        await failureOf(node.ammInfoByPair(XRP, heldAsset("HL6"), { holdFailure: true }));
        await failureOf(node.ammInfoByPair(XRP, heldAsset("HL6"), { holdFailure: true }));
        expect(fetchSpy).toHaveBeenCalledTimes(3);

        fetchSpy.mockImplementation(async () => failure("actNotFound", "Account not found."));
        expect((await failureOf(node.ammInfoByPair(XRP, heldAsset("HL5"), { holdFailure: true }))).kind).toBe("not_found");
        expect((await failureOf(node.ammInfoByPair(XRP, heldAsset("HL5"), { holdFailure: true }))).kind).toBe("not_found");
        expect(fetchSpy).toHaveBeenCalledTimes(5);
      });
    });
  });
});

const LP_TOKEN = { currency: "03B245BE580EC4F4386A751C084489EC4B514A2F", issuer: POOL, value: "1788108282.274566" };

/** The `amm` of a pool's `amm_info` answer as Clio gives it (the XRP/RLUSD pool, trimmed to two vote slots and two authorised accounts). */
function ammBlock(): Record<string, any> {
  return {
    lp_token: LP_TOKEN,
    amount: "1854660697034",
    amount2: rlusd("2401386.528853604"),
    account: POOL,
    trading_fee: 205,
    auction_slot: {
      time_interval: 20,
      price: { ...LP_TOKEN, value: "131482.3939333034" },
      discounted_fee: 20,
      account: "r4uKh2rHuarMZdAgSBYqqicX7MxPBegttw",
      expiration: "2026-03-02T17:05:00+0000",
      auth_accounts: [{ account: "rNy92d5CrBQ1eC5HUokq1LDfcuLPvTfh4X" }, { account: "rJrFQCQKgUJwG6bnDLyX33ea4DwWcjk6P3" }],
    },
    vote_slots: [
      { account: "rJ4XeEzorvsQp6un4h9CjtANEsB3Qcc8iA", trading_fee: 300, vote_weight: 2936 },
      { account: "rDu4vMpZU5WcwVME6oorzSov4DMLWXUEDf", trading_fee: 0, vote_weight: 1951 },
    ],
    asset2_frozen: false,
  };
}
const ammResult = (amm: unknown = ammBlock(), extra: Record<string, unknown> = {}) => ({
  amm,
  ledger_index: 107779805,
  ledger_hash: LEDGER_HASH,
  validated: true,
  ...extra,
});
/** A classic address of its own for each `at`: an account ID of 20 bytes, each `at + 1`. */
const accountAt = (at: number) => encodeAccountID(new Uint8Array(20).fill(at + 1));
/** A pool's answer after `change` has altered its `amm`. */
function ammChanged(change: (amm: Record<string, any>) => void): Record<string, unknown> {
  const amm = ammBlock();
  change(amm);
  return ammResult(amm);
}

/** What the client returns for `ammBlock()` read at ledger 107779805. */
const clientAmm = {
  account: POOL,
  amount: { currency: "XRP", value: "1854660.697034" },
  amount2: rlusd("2401386.528853604"),
  asset2_frozen: false,
  lp_token: LP_TOKEN,
  trading_fee: 205,
  vote_slots: [
    { account: "rJ4XeEzorvsQp6un4h9CjtANEsB3Qcc8iA", trading_fee: 300, vote_weight: 2936 },
    { account: "rDu4vMpZU5WcwVME6oorzSov4DMLWXUEDf", trading_fee: 0, vote_weight: 1951 },
  ],
  auction_slot: {
    account: "r4uKh2rHuarMZdAgSBYqqicX7MxPBegttw",
    auth_accounts: ["rNy92d5CrBQ1eC5HUokq1LDfcuLPvTfh4X", "rJrFQCQKgUJwG6bnDLyX33ea4DwWcjk6P3"],
    discounted_fee: 20,
    expiration: 1_772_471_100,
    price: { ...LP_TOKEN, value: "131482.3939333034" },
    time_interval: 20,
  },
  ledger_index: 107779805,
};

describe("amm_info", () => {
  describe("requests", () => {
    it("ammInfo(pool): { amm_account, ledger_index: 'validated' }", async () => {
      fetchSpy.mockResolvedValueOnce(success(ammResult()));

      await rpc().ammInfo(POOL);

      expect(sentRequest().url).toBe("https://s1.ripple.com:51234/");
      expect(await sentBody()).toEqual({ method: "amm_info", params: [{ amm_account: POOL, ledger_index: "validated" }] });
    });

    it("ammInfoByPair(a, b): { asset, asset2, ledger_index: 'validated' }, the assets written as for book_offers", async () => {
      fetchSpy.mockResolvedValueOnce(success(ammResult()));

      await rpc().ammInfoByPair(XRP, RLUSD);

      expect(await sentBody()).toEqual({
        method: "amm_info",
        params: [{ asset: { currency: "XRP" }, asset2: { currency: RLUSD.currency, issuer: RLUSD.issuer }, ledger_index: "validated" }],
      });
    });
  });

  describe("answers", () => {
    it("reads a pool by its account: native in whole units, the slot's expiration in unix seconds, the authorised accounts as addresses", async () => {
      fetchSpy.mockResolvedValueOnce(success(ammResult()));
      expect(await rpc().ammInfo(POOL)).toEqual(clientAmm);
    });

    it("reads a pool by its pair, whichever order the node gives the amounts in", async () => {
      fetchSpy.mockResolvedValueOnce(success(ammResult()));
      expect(await rpc().ammInfoByPair(XRP, RLUSD)).toEqual(clientAmm);

      // Asked the other way round, the node answers in the order it was asked: amount is RLUSD, amount2 the XRP.
      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => ([amm.amount, amm.amount2] = [amm.amount2, amm.amount]))));
      const swapped = await rpc().ammInfoByPair(RLUSD, XRP);
      expect(swapped.amount).toEqual(rlusd("2401386.528853604"));
      expect(swapped.amount2).toEqual({ currency: "XRP", value: "1854660.697034" });

      // And the pair as asked need not be the order the answer has.
      fetchSpy.mockResolvedValueOnce(success(ammResult()));
      expect((await rpc().ammInfoByPair(RLUSD, XRP)).account).toBe(POOL);
    });

    it("keeps asset_frozen and asset2_frozen when the node gives them, and leaves them out when it does not", async () => {
      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => Object.assign(amm, { asset_frozen: true, asset2_frozen: false }))));
      const frozen = await rpc().ammInfo(POOL);
      expect(frozen.asset_frozen).toBe(true);
      expect(frozen.asset2_frozen).toBe(false);

      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => delete amm.asset2_frozen)));
      const plain = await rpc().ammInfo(POOL);
      expect("asset_frozen" in plain).toBe(false);
      expect("asset2_frozen" in plain).toBe(false);
    });

    it("a missing vote_slots is [], a missing auth_accounts is [], and a pool with no auction slot has no slot", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(
          ammChanged((amm) => {
            delete amm.vote_slots;
            delete amm.auction_slot.auth_accounts;
          }),
        ),
      );
      const bare = await rpc().ammInfo(POOL);
      expect(bare.vote_slots).toEqual([]);
      expect(bare.auction_slot!.auth_accounts).toEqual([]);

      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => delete amm.auction_slot)));
      const noSlot = await rpc().ammInfo(POOL);
      expect("auction_slot" in noSlot).toBe(false);
    });

    it("an open auction slot has no account", async () => {
      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => delete amm.auction_slot.account)));
      const { auction_slot } = await rpc().ammInfo(POOL);
      expect("account" in auction_slot!).toBe(false);
      expect(auction_slot!.price).toEqual({ ...LP_TOKEN, value: "131482.3939333034" });
    });

    it("amounts the node gives with an exponent are plain decimals", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(ammChanged((amm) => Object.assign(amm, { amount2: rlusd("5876901213283910e-4"), lp_token: { ...LP_TOKEN, value: "1000000000000000e-18" } }))),
      );
      const pool = await rpc().ammInfo(POOL);
      expect(pool.amount2.value).toBe("587690121328.391");
      expect(pool.lp_token.value).toBe("0.001");
    });

    it("trading fees at both ends of their range and the longest time interval are fine", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(
          ammChanged((amm) => {
            amm.trading_fee = 1000;
            amm.vote_slots[0].trading_fee = 1000;
            amm.vote_slots[1].trading_fee = 0;
            amm.auction_slot.time_interval = 0;
          }),
        ),
      );
      const pool = await rpc().ammInfo(POOL);
      expect(pool.trading_fee).toBe(1000);
      expect(pool.auction_slot!.time_interval).toBe(0);
    });

    describe("the expiration", () => {
      const read = async (expiration: unknown) => {
        fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => (amm.auction_slot.expiration = expiration))));
        return (await rpc().ammInfo(POOL)).auction_slot!.expiration;
      };

      it.each([
        ["2026-03-02T17:05:00+0000", 1_772_471_100],
        ["2025-07-12T08:01:22+0000", 1_752_307_282],
        ["2026-03-02T17:05:00Z", 1_772_471_100],
        ["2026-03-02T17:05:00+00:00", 1_772_471_100],
        ["2026-03-02T17:05:00-0000", 1_772_471_100],
        ["2026-03-02T18:05:00+01:00", 1_772_471_100],
        ["2026-03-02T12:35:00-0430", 1_772_471_100],
        ["2026-03-02T19:05:00+02", 1_772_471_100],
        ["2026-03-02T17:05:00.987Z", 1_772_471_100],
        ["2026-03-02T17:05:00.5+0000", 1_772_471_100],
        ["2024-02-29T00:00:00+0000", 1_709_164_800],
        ["2000-01-01T00:00:00+0000", 946_684_800],
      ])("%s is unix second %d", async (text, seconds) => {
        expect(await read(text)).toBe(seconds);
      });

      it.each([
        "",
        "soon",
        "2026-03-02",
        "2026-03-02T17:05:00",
        "2026-03-02 17:05:00+0000",
        "2026-Mar-02 17:05:00.000000000 UTC",
        "Mon, 02 Mar 2026 17:05:00 GMT",
        "2026-02-30T00:00:00+0000",
        "2026-13-01T00:00:00+0000",
        "2026-00-10T00:00:00+0000",
        "2026-03-02T24:00:00+0000",
        "2026-03-02T17:60:00+0000",
        "2026-03-02T17:05:60+0000",
        "2026-03-02T17:05:00+2400",
        "2026-03-02T17:05:00+0060",
        "2026-03-02T17:05:00+00:0",
        "2026-03-02T17:05:00Zjunk",
        "+002026-03-02T17:05:00Z",
        "1772471100",
        1_772_471_100,
        795_000_000,
        null,
        undefined,
        {},
      ])("%j is a server error", async (text) => {
        fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => (amm.auction_slot.expiration = text))));
        expect((await failureOf(rpc().ammInfo(POOL))).kind).toBe("server");
      });
    });
  });

  describe("what makes an answer wrong", () => {
    it("an answer that does not say validated: true is a server error, not a missing pool", async () => {
      for (const validated of [false, undefined, "true", 1]) {
        fetchSpy.mockResolvedValueOnce(success(ammResult(ammBlock(), { validated })));
        const error = await failureOf(rpc().ammInfo(POOL));
        expect(error.kind, JSON.stringify(validated)).toBe("server");
        expect(error.message).toContain("validated");
      }
      fetchSpy.mockResolvedValueOnce(success(ammResult(ammBlock(), { validated: false })));
      expect((await failureOf(rpc().ammInfoByPair(XRP, RLUSD))).kind).toBe("server");
    });

    it("the pool form answers for the pool asked for, not another", async () => {
      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => (amm.account = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh"))));
      const error = await failureOf(rpc().ammInfo(POOL));
      expect(error.kind).toBe("server");
      expect(error.message).toContain("account");
    });

    it("the pair form answers for the two assets asked for, not others", async () => {
      // The pool of XRP and RLUSD, asked for XRP and LIONS.
      fetchSpy.mockResolvedValueOnce(success(ammResult()));
      expect((await failureOf(rpc().ammInfoByPair(XRP, LIONS))).kind).toBe("server");
      // One of the two right.
      fetchSpy.mockResolvedValueOnce(success(ammResult()));
      expect((await failureOf(rpc().ammInfoByPair(LIONS, RLUSD))).kind).toBe("server");
      // The same currency from another issuer.
      fetchSpy.mockResolvedValueOnce(success(ammResult()));
      expect((await failureOf(rpc().ammInfoByPair(XRP, { ...RLUSD, issuer: LIONS.issuer }))).kind).toBe("server");
      // Both amounts of the same asset.
      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => (amm.amount = rlusd("1")))));
      expect((await failureOf(rpc().ammInfoByPair(XRP, RLUSD))).kind).toBe("server");
    });

    it.each([
      ["no amm object", () => ({ ledger_index: 1, validated: true })],
      ["an amm that is a list", () => ammResult([])],
      ["no account", () => ammChanged((amm) => delete amm.account)],
      ["no amount", () => ammChanged((amm) => delete amm.amount)],
      ["no amount2", () => ammChanged((amm) => delete amm.amount2)],
      ["an amount that is a number", () => ammChanged((amm) => (amm.amount = 1854660697034))],
      ["drops that are not whole", () => ammChanged((amm) => (amm.amount = "1854660.5"))],
      ["drops that are negative", () => ammChanged((amm) => (amm.amount = "-5"))],
      ["an issued amount with a value that is not a number", () => ammChanged((amm) => (amm.amount2 = rlusd("many")))],
      ["an issued amount without an issuer", () => ammChanged((amm) => (amm.amount2 = { currency: RLUSD.currency, value: "1" }))],
      ["no lp_token", () => ammChanged((amm) => delete amm.lp_token)],
      ["an lp_token in drops", () => ammChanged((amm) => (amm.lp_token = "1000"))],
      ["an lp_token without a value", () => ammChanged((amm) => (amm.lp_token = { currency: LP_TOKEN.currency, issuer: POOL }))],
      ["no trading_fee", () => ammChanged((amm) => delete amm.trading_fee)],
      ["a trading_fee that is text", () => ammChanged((amm) => (amm.trading_fee = "205"))],
      ["a trading_fee above 1000", () => ammChanged((amm) => (amm.trading_fee = 1001))],
      ["a trading_fee below 0", () => ammChanged((amm) => (amm.trading_fee = -1))],
      ["a trading_fee that is not whole", () => ammChanged((amm) => (amm.trading_fee = 2.5))],
      ["a trading_fee that is not finite", () => ammChanged((amm) => (amm.trading_fee = null))],
      ["vote_slots that is not a list", () => ammChanged((amm) => (amm.vote_slots = {}))],
      ["a vote slot that is not an object", () => ammChanged((amm) => (amm.vote_slots = ["rJ4X"]))],
      ["a vote slot without an account", () => ammChanged((amm) => delete amm.vote_slots[0].account)],
      // The accounts of the votes, the slot's holder and its authorised accounts go into links: each is a classic address with a valid checksum.
      ["a vote slot account that is not an address", () => ammChanged((amm) => (amm.vote_slots[0].account = "nope"))],
      ["a vote slot account with a wrong checksum", () => ammChanged((amm) => (amm.vote_slots[1].account = "rDu4vMpZU5WcwVME6oorzSov4DMLWXUEDg"))],
      ["a vote slot fee above 1000", () => ammChanged((amm) => (amm.vote_slots[0].trading_fee = 1001))],
      ["a vote slot without a weight", () => ammChanged((amm) => delete amm.vote_slots[0].vote_weight)],
      ["a vote slot weight that is negative", () => ammChanged((amm) => (amm.vote_slots[0].vote_weight = -1))],
      ["an auction_slot that is not an object", () => ammChanged((amm) => (amm.auction_slot = "open"))],
      ["an auction slot with a time_interval above 20", () => ammChanged((amm) => (amm.auction_slot.time_interval = 21))],
      ["an auction slot with a time_interval below 0", () => ammChanged((amm) => (amm.auction_slot.time_interval = -1))],
      ["an auction slot with a time_interval that is not whole", () => ammChanged((amm) => (amm.auction_slot.time_interval = 2.5))],
      ["an auction slot without a time_interval", () => ammChanged((amm) => delete amm.auction_slot.time_interval)],
      ["an auction slot without a price", () => ammChanged((amm) => delete amm.auction_slot.price)],
      ["an auction slot price in drops", () => ammChanged((amm) => (amm.auction_slot.price = "5"))],
      ["an auction slot without a discounted_fee", () => ammChanged((amm) => delete amm.auction_slot.discounted_fee)],
      ["an auction slot discounted_fee that is not whole", () => ammChanged((amm) => (amm.auction_slot.discounted_fee = 0.5))],
      ["an auction slot account that is not text", () => ammChanged((amm) => (amm.auction_slot.account = 5))],
      ["an auction slot account that is not an address", () => ammChanged((amm) => (amm.auction_slot.account = "r4uKh2"))],
      ["an auction slot account that is an X-address", () => ammChanged((amm) => (amm.auction_slot.account = "X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ"))],
      ["auth_accounts that is not a list", () => ammChanged((amm) => (amm.auction_slot.auth_accounts = "none"))],
      ["an authorised account that is not an object", () => ammChanged((amm) => (amm.auction_slot.auth_accounts = ["rNy9"]))],
      ["an authorised account without an address", () => ammChanged((amm) => (amm.auction_slot.auth_accounts = [{}]))],
      ["an authorised account that is not an address", () => ammChanged((amm) => (amm.auction_slot.auth_accounts[1] = { account: "rJrF\"><b>" }))],
      ["an asset_frozen that is not true or false", () => ammChanged((amm) => (amm.asset_frozen = "no"))],
      ["no ledger_index", () => ammResult(ammBlock(), { ledger_index: undefined })],
      ["a ledger_index that is text", () => ammResult(ammBlock(), { ledger_index: "107779805" })],
      ["a ledger_index that is not whole", () => ammResult(ammBlock(), { ledger_index: 1.5 })],
      ["a ledger_index below zero", () => ammResult(ammBlock(), { ledger_index: -1 })],
      ["an lp_token of another issuer than the pool", () => ammChanged((amm) => (amm.lp_token = { ...LP_TOKEN, issuer: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" }))],
      ["an lp_token with no issuer", () => ammChanged((amm) => (amm.lp_token = { currency: LP_TOKEN.currency, value: "1" }))],
      ["nine vote slots, where there are at most eight", () => ammChanged((amm) => (amm.vote_slots = Array.from({ length: 9 }, () => amm.vote_slots[0])))],
      ["five authorised accounts, where there are at most four", () => ammChanged((amm) => (amm.auction_slot.auth_accounts = Array.from({ length: 5 }, () => amm.auction_slot.auth_accounts[0])))],
      ["a value beyond the range of an amount", () => ammChanged((amm) => (amm.amount2 = rlusd("1e81")))],
      ["a price beyond the range of an amount", () => ammChanged((amm) => (amm.auction_slot.price = { ...LP_TOKEN, value: "1e-97" }))],
    ])("%s is a server error", async (_what, make) => {
      fetchSpy.mockResolvedValueOnce(success(make()));
      expect((await failureOf(rpc().ammInfo(POOL))).kind).toBe("server");
    });

    it("says which account is not a classic address: a vote's, the slot holder's or an authorised account's", async () => {
      const cases: Array<[string, (amm: Record<string, any>) => void]> = [
        ['a vote slot\'s "account" is not a classic address', (amm) => (amm.vote_slots[0].account = "nope")],
        ['the auction slot\'s "account" is not a classic address', (amm) => (amm.auction_slot.account = "nope")],
        ['an authorised account\'s "account" is not a classic address', (amm) => (amm.auction_slot.auth_accounts[0].account = "nope")],
      ];
      for (const [message, change] of cases) {
        fetchSpy.mockResolvedValueOnce(success(ammChanged(change)));
        const error = await failureOf(rpc().ammInfo(POOL));
        expect(error.kind, message).toBe("server");
        expect(error.message).toContain(message);
      }
    });

    it("the most vote slots and authorised accounts there can be are fine", async () => {
      fetchSpy.mockResolvedValueOnce(
        success(
          ammChanged((amm) => {
            amm.vote_slots = Array.from({ length: 8 }, (_, at) => ({ account: accountAt(at), trading_fee: 100 + at, vote_weight: 12_500 }));
            amm.auction_slot.auth_accounts = Array.from({ length: 4 }, (_, at) => ({ account: accountAt(10 + at) }));
          }),
        ),
      );
      const pool = await rpc().ammInfo(POOL);
      expect(pool.vote_slots).toHaveLength(8);
      expect(pool.auction_slot!.auth_accounts).toEqual([10, 11, 12, 13].map(accountAt));
    });

    it("says what is wrong without repeating a node's text in full", async () => {
      const long = `r${"x".repeat(5000)}`;
      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => (amm.account = long))));
      const error = await failureOf(rpc().ammInfo(POOL));
      expect(error.kind).toBe("server");
      expect(error.message.length).toBeLessThan(500);

      fetchSpy.mockResolvedValueOnce(success(ammChanged((amm) => (amm.lp_token = { ...LP_TOKEN, issuer: long }))));
      const lp = await failureOf(rpc().ammInfo(POOL));
      expect(lp.kind).toBe("server");
      expect(lp.message.length).toBeLessThan(500);
    });
  });

  describe("errors", () => {
    it.each(["actNotFound", "actMalformed"])("%s is not_found, in both forms: the Worker has checked the address and the pair", async (code) => {
      fetchSpy.mockResolvedValueOnce(failure(code, "Account not found."));
      const byPool = await failureOf(rpc().ammInfo(POOL));
      expect(byPool.kind).toBe("not_found");
      expect(byPool.message).toContain(code);

      fetchSpy.mockResolvedValueOnce(failure(code, "Account not found."));
      expect((await failureOf(rpc().ammInfoByPair(XRP, LIONS))).kind).toBe("not_found");
    });

    it.each(["lgrNotFound", "txnNotFound"])(
      "%s is server for a pool in both forms: a node with no validated ledger yet does not say 'no pool', which a page would store",
      async (code) => {
        fetchSpy.mockResolvedValueOnce(failure(code, "ledgerNotFound"));
        const byPool = await failureOf(rpc().ammInfo(POOL));
        expect(byPool.kind).toBe("server");
        expect(byPool.message).toContain(code);

        fetchSpy.mockResolvedValueOnce(failure(code, "ledgerNotFound"));
        expect((await failureOf(rpc().ammInfoByPair(XRP, RLUSD))).kind).toBe("server");
      },
    );

    it("the older calls read the three not-found codes as before", async () => {
      for (const [code, call] of [
        ["lgrNotFound", () => rpc().tx(TX_HASH)],
        ["txnNotFound", () => rpc().ledger("107695660")],
        ["lgrNotFound", () => rpc().accountInfo(ACCOUNT)],
        ["txnNotFound", () => rpc().accountObjects(ACCOUNT)],
        ["actNotFound", () => rpc().tx(TX_HASH)],
      ] as const) {
        fetchSpy.mockResolvedValueOnce(failure(code));
        expect((await failureOf(call())).kind, code).toBe("not_found");
      }
    });

    it("the node's malformed-request codes are bad_request, and the rest as for every call", async () => {
      for (const code of ["invalidParams", "issueMalformed", "malformedRequest"]) {
        fetchSpy.mockResolvedValueOnce(failure(code));
        expect((await failureOf(rpc().ammInfoByPair(XRP, RLUSD))).kind, code).toBe("bad_request");
      }
      fetchSpy.mockResolvedValueOnce(failure("slowDown"));
      expect((await failureOf(rpc().ammInfo(POOL))).kind).toBe("rate_limited");
      fetchSpy.mockResolvedValueOnce(failure("noNetwork"));
      expect((await failureOf(rpc().ammInfo(POOL))).kind).toBe("server");
      fetchSpy.mockResolvedValueOnce(new Response("overloaded", { status: 503 }));
      expect((await failureOf(rpc().ammInfo(POOL))).kind).toBe("server");
    });

    it("actMalformed is still bad_request for the calls that are about an account, not a pool", async () => {
      fetchSpy.mockResolvedValueOnce(failure("actMalformed", "Account malformed."));
      expect((await failureOf(rpc().accountInfo(ACCOUNT))).kind).toBe("bad_request");
    });
  });

  describe("cache", () => {
    it("is class live, a pool and a pair under keys of their own, kept as long as it is asked to be", async () => {
      const cache = recordingCache();
      fetchSpy.mockImplementation(async () => success(ammResult()));
      const node = createNodeRpc(xrpl, cache);

      await node.ammInfo(POOL);
      await node.ammInfoByPair(XRP, RLUSD);
      await node.ammInfo(POOL, { ttl: 2, holdFailure: true });
      await node.ammInfoByPair(XRP, RLUSD, { ttl: 5, holdFailure: true });

      expect(cache.calls.map((call) => [call.cls, call.ttlOverride, call.holdFailure === true])).toEqual([
        ["live", undefined, false],
        ["live", undefined, false],
        ["live", 2, true],
        ["live", 5, true],
      ]);
      expect(cache.calls[0]!.key).not.toBe(cache.calls[1]!.key);
      expect(cache.calls[0]!.key).toContain("amm_info");
      expect(cache.calls[0]!.key).toContain(POOL);
      expect(cache.calls[2]!.key).toBe(`${cache.calls[0]!.key} [kept 2 s]`);
      expect(cache.calls[3]!.key).toBe(`${cache.calls[1]!.key} [kept 5 s]`);
    });
  });
});
