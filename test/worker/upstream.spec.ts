import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { createDataApi, UpstreamError } from "../../app/server/data-api";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { createNodeRpc } from "../../app/server/node-rpc";
import { passThroughCache } from "../support/subrequest-cache";
import { allSwitches } from "../support/switches";
import { dataApiError, mockUpstream, nodeError, statusesOf, type UpstreamMock } from "../support/upstream";
import { warmWorker } from "../support/warm-worker";

// The upstream mock: the data API and the nodes of both networks, answered from test/fixtures/http/.

warmWorker();

const env: Env = {
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
const xrplApi = () => createDataApi(xrpl, env, passThroughCache);
const xrplNode = () => createNodeRpc(xrpl, passThroughCache);

// What the fixtures hold (README.md, "Upstream fixtures").
const AMM_DEPOSIT = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
const HEAD = { index: 107721455, hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092" };
const OTHER = { index: 107720688, hash: "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02" };
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
const XAHAU_HEAD = { index: 26596843, hash: "EFA9CD5F98635E5E505EF63AECEF1576D324AF95BED7D3C3897B2BB20203E0B5" };
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

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

describe("mockUpstream", () => {
  it("answers the data API client with a fixture transaction", async () => {
    mock = mockUpstream("xrpl");
    const tx = await xrplApi().transaction(AMM_DEPOSIT);
    expect(tx.hash).toBe(AMM_DEPOSIT);
    expect(tx.tx.TransactionType).toBe("AMMDeposit");
  });

  it("answers an unknown transaction with the API's 404", async () => {
    mock = mockUpstream("xrpl");
    const error = await failureOf(xrplApi().transaction("A".repeat(64)));
    expect(error.kind).toBe("not_found");
    expect(error.status).toBe(404);
    expect(error.message).toContain("transaction not found");
  });

  it("answers account_info of a never-funded address with actNotFound", async () => {
    mock = mockUpstream("xrpl");
    const error = await failureOf(xrplNode().accountInfo(NEVER_FUNDED));
    expect(error.kind).toBe("not_found");
    expect(error.message).toContain("actNotFound");
  });

  describe("the data API", () => {
    it("serves last_validated, and the ledger of that index in its three shapes", async () => {
      mock = mockUpstream("xrpl");
      const api = xrplApi();
      const last = await api.lastValidated();
      expect(last).toMatchObject({ result: "success", ledger_index: String(HEAD.index), ledger_hash: HEAD.hash });

      const plain = await api.ledger(String(HEAD.index));
      expect(plain).toMatchObject({ ledger_index: HEAD.index, ledger_hash: HEAD.hash, hash: HEAD.hash, closed: "true" });
      expect(plain.transactions).toBeUndefined();

      const hashes = await api.ledger(String(HEAD.index), { transactions: true });
      const expanded = await api.ledger(String(HEAD.index), { expand: true });
      expect(hashes.transactions.length).toBeGreaterThan(50);
      expect(expanded.transactions.map((tx) => tx.hash)).toEqual(hashes.transactions);
      // Ledger order: the position in the list is the transaction's own index.
      expect(expanded.transactions.map((tx) => tx.meta.TransactionIndex)).toEqual(hashes.transactions.map((_hash, i) => i));
      expect(expanded.transactions[0]).not.toHaveProperty("ledger_hash");
    });

    it("finds a ledger by its hash, in any letter case of the hash, and asks for it as the client does", async () => {
      mock = mockUpstream("xrpl");
      const byIndex = await xrplApi().ledger(String(OTHER.index), { expand: true });
      const byHash = await xrplApi().ledger(OTHER.hash.toLowerCase(), { expand: true });
      expect(byHash).toEqual(byIndex);
      expect(mock.requests.map((r) => r.key)).toEqual([
        `GET /v2/ledgers/${OTHER.index}?expand=true&transactions=true`,
        `GET /v2/ledgers/${OTHER.hash}?expand=true&transactions=true`,
      ]);
    });

    it("serves a transaction in the canonical form of the API", async () => {
      mock = mockUpstream("xrpl");
      const payment = await xrplApi().transaction("52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60");
      expect(payment.tx.TransactionType).toBe("Payment");
      expect(payment.tx).not.toHaveProperty("hash");
      expect(payment.tx).not.toHaveProperty("DeliverMax");
      expect(payment.meta.delivered_amount).toBeDefined();
      expect(payment.date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/);
      expect(payment).not.toHaveProperty("ledger_hash");
    });

    it("lists the newest transactions and fees as the home page asks for them", async () => {
      mock = mockUpstream("xrpl");
      const api = xrplApi();
      const newest = await api.transactions({ descending: true, limit: 8 });
      expect(newest.count).toBe(8);
      expect(newest.transactions).toHaveLength(8);
      expect(newest.transactions.every((tx) => tx.ledger_hash === HEAD.hash)).toBe(true);
      expect(newest.marker).toBeTruthy();

      const fees = await api.fees({ descending: true, limit: 8 });
      expect(fees.rows).toHaveLength(8);
      expect(fees.rows[0]).toMatchObject({ ledger_index: HEAD.index, tx_count: expect.any(Number), date: "2026-10-17T17:01:12Z" });
      expect(fees.rows.map((row) => row.ledger_index)).toEqual([...fees.rows.map((row) => row.ledger_index)].sort((a, b) => b - a));
    });

    it("serves the active account's pages, linked by a marker", async () => {
      mock = mockUpstream("xrpl");
      const api = xrplApi();
      expect(await api.account(ACTIVE)).toMatchObject({ account: ACTIVE, initial_balance: "25" });
      const balances = await api.balances(ACTIVE);
      expect(balances.balances[0]).toEqual({ currency: "XRP", value: "10.001625" });
      expect(balances.balances).toHaveLength(2);
      expect((await api.orders(ACTIVE)).orders).toEqual([]);

      const first = await api.accountTransactions(ACTIVE, { descending: true, limit: 20 });
      expect(first.marker).toBeTruthy();
      const second = await api.accountTransactions(ACTIVE, { descending: true, limit: 20, marker: first.marker });
      expect(second.marker).toBeUndefined();
      const hashes = [...first.transactions, ...second.transactions].map((tx) => tx.hash);
      expect(new Set(hashes).size).toBe(hashes.length);

      const payments = await api.accountPayments(ACTIVE, { descending: true, limit: 20 });
      expect(payments.marker).toBeTruthy();
      expect((await api.accountPayments(ACTIVE, { descending: true, limit: 20, marker: payments.marker })).marker).toBeUndefined();
      const exchanges = await api.accountExchanges(ACTIVE, { descending: true, limit: 20 });
      expect(exchanges.marker).toBeTruthy();
      expect((await api.accountExchanges(ACTIVE, { descending: true, limit: 20, marker: exchanges.marker })).exchanges).toHaveLength(1);
    });

    it("knows a deleted account from its history, but not its balances", async () => {
      mock = mockUpstream("xrpl");
      const api = xrplApi();
      expect(await api.account(DELETED)).toMatchObject({ account: DELETED });
      const history = await api.accountTransactions(DELETED, { descending: true, limit: 20 });
      expect(history.transactions.map((tx) => tx.tx.TransactionType)).toEqual(["AccountDelete"]);
      expect(history.marker).toBeUndefined();
      expect((await failureOf(api.balances(DELETED))).message).toContain("account not found");
      expect((await failureOf(api.orders(DELETED))).kind).toBe("not_found");
    });

    it("says a never-funded address has no account but an empty history", async () => {
      mock = mockUpstream("xrpl");
      const api = xrplApi();
      expect((await failureOf(api.account(NEVER_FUNDED))).message).toContain("Account not found");
      expect((await failureOf(api.balances(NEVER_FUNDED))).kind).toBe("not_found");
      expect(await api.accountTransactions(NEVER_FUNDED, { descending: true, limit: 20 })).toEqual({
        result: "success",
        count: 0,
        transactions: [],
      });
    });

    it("answers what has no fixture with the API's 404 body, whatever the endpoint", async () => {
      mock = mockUpstream("xrpl");
      for (const [path, message] of [
        ["/v2/ledgers/1", "ledger not found"],
        ["/v2/accounts/rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", "Account not found"],
        ["/v2/nope", "Cannot GET /v2/nope"],
      ] as const) {
        const response = await fetch(`${xrpl.dataApiUrl}${path}`, { headers: { "X-API-Key": "k" } });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ result: "error", message });
      }
    });

    it("does not mind the order of the query, or a query it has no fixture for", async () => {
      mock = mockUpstream("xrpl");
      const headers = { "X-API-Key": "k" };
      const reordered = await fetch(`${xrpl.dataApiUrl}/v2/ledgers/${HEAD.index}?transactions=true&expand=true`, { headers });
      expect(reordered.status).toBe(200);
      const other = await fetch(`${xrpl.dataApiUrl}/v2/transactions?descending=true&limit=9`, { headers });
      expect(other.status).toBe(404);
    });

    it("finds no fixture for a path that is escaped or climbs, and answers as for any other thing that is absent", async () => {
      mock = mockUpstream("xrpl");
      for (const path of ["/v2/%252e%252e/%252e%252e/package", "/v2/accounts/..%255c..%255cpackage", "/v2/transactions/%2e%2e%2f%2e%2e%2fpackage"]) {
        const response = await fetch(`${xrpl.dataApiUrl}${path}`, { headers: { "X-API-Key": "k" } });
        expect(response.status, path).toBe(404);
      }
      const node = await fetch(xrpl.nodeUrl, { method: "POST", body: JSON.stringify({ method: "account_info", params: [{ account: "%2e%2e/%2e%2e/package" }] }) });
      expect(((await node.json()) as { result: { error: string } }).result.error).toBe("actNotFound");
    });

    it("refuses a request without the API key, as the API does", async () => {
      mock = mockUpstream("xrpl");
      const response = await fetch(`${xrpl.dataApiUrl}/v2/last_validated`);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: "error", message: "Missing or invalid API key." });
    });
  });

  describe("the nodes", () => {
    it("serves tx with the Ripple-epoch date of its ledger, which the client converts", async () => {
      mock = mockUpstream("xrpl");
      const tx = await xrplNode().tx(AMM_DEPOSIT);
      expect(tx.hash).toBe(AMM_DEPOSIT);
      expect(tx.ledger_index).toBe(107671558);
      expect(tx.date).toBe(1792063031); // 845378231 + 946684800: 2026-10-15 11:17:11 UTC
      expect(tx.meta.TransactionResult).toBe("tesSUCCESS");
    });

    it("serves ledger by index and by hash, in the shapes the client asks for", async () => {
      mock = mockUpstream("xrpl");
      const node = xrplNode();
      const plain = await node.ledger(String(HEAD.index));
      expect(plain).toMatchObject({ ledger_hash: HEAD.hash, ledger_index: HEAD.index });
      expect(plain.transactions).toBeUndefined();
      const hashes = await node.ledger(HEAD.hash, { transactions: true });
      const expanded = await node.ledger(String(HEAD.index), { expand: true });
      expect(hashes.transactions).toHaveLength(107);
      expect((expanded.transactions as Array<{ hash: string }>).map((tx) => tx.hash).sort()).toEqual([...(hashes.transactions as string[])].sort());
      expect((await failureOf(node.ledger("1"))).message).toContain("lgrNotFound");
    });

    it("serves the active account's state, and says a deleted one is gone", async () => {
      mock = mockUpstream("xrpl");
      const node = xrplNode();
      const info = await node.accountInfo(ACTIVE);
      expect(info).toMatchObject({ validated: true, ledger_index: HEAD.index });
      expect(info.account_data).toMatchObject({ Account: ACTIVE, Balance: "10001625", OwnerCount: 1, Sequence: 98986800 });
      const objects = await node.accountObjects(ACTIVE);
      expect(objects.account_objects.map((object) => object.LedgerEntryType)).toEqual(["RippleState"]);
      expect(objects.marker).toBeUndefined();

      expect((await failureOf(node.accountInfo(DELETED))).message).toContain("actNotFound");
      expect((await failureOf(node.accountObjects(NEVER_FUNDED))).kind).toBe("not_found");
    });

    it("serves server_state with the reserves and the ledger the data API calls the last validated", async () => {
      mock = mockUpstream("xrpl");
      const state = await xrplNode().serverState();
      expect(state.validated_ledger).toMatchObject({ reserve_base: 1_000_000, reserve_inc: 200_000, seq: HEAD.index, hash: HEAD.hash });
      expect(state.validated_ledger?.close_time).toBe(845571672 + 946684800);
    });
  });

  describe("both networks", () => {
    it("answers Xahau's upstreams too, whichever network the mock was made for", async () => {
      mock = mockUpstream("xrpl");
      const api = createDataApi(xahau, env, passThroughCache);
      expect((await api.lastValidated()).ledger_hash).toBe(XAHAU_HEAD.hash);
      const state = await createNodeRpc(xahau, passThroughCache).serverState();
      expect(state.validated_ledger?.seq).toBe(XAHAU_HEAD.index);
      expect(mock.requests.map((r) => r.net)).toEqual(["xahau", "xahau"]);
      // A transaction of one network is not found on the other.
      expect((await failureOf(api.transaction(AMM_DEPOSIT))).kind).toBe("not_found");
    });

    it("has consecutive Xahau ledgers for the previous and next links", async () => {
      mock = mockUpstream("xahau");
      const api = createDataApi(xahau, env, passThroughCache);
      const first = await api.ledger("26540187", { expand: true });
      const next = await api.ledger("26540188", { transactions: true });
      expect(first.ledger_index + 1).toBe(next.ledger_index);
      expect(first.transactions).toHaveLength(16);
    });

    it("serves Xahau's active account", async () => {
      mock = mockUpstream("xahau");
      const api = createDataApi(xahau, env, passThroughCache);
      expect((await api.balances(XAHAU_ACTIVE)).balances[0]).toEqual({ currency: "XAH", value: "9351.039221" });
      const info = await createNodeRpc(xahau, passThroughCache).accountInfo(XAHAU_ACTIVE);
      expect(info.account_data.Account).toBe(XAHAU_ACTIVE);
    });
  });

  describe("overrides", () => {
    it("replaces a data API answer with a value, a function, a Response, or nothing", async () => {
      const body = { result: "success", ledger_index: "1", ledger_hash: "B".repeat(64), parent_hash: "C".repeat(64), close_time: "2026-01-01T00:00:00Z" };
      mock = mockUpstream("xrpl", {
        "GET /v2/last_validated": body,
        [`GET /v2/transactions/${AMM_DEPOSIT}`]: () => dataApiError(503, "unavailable"),
        "GET /v2/ledgers/5": new Response(JSON.stringify({ result: "success", ledger: { ledger_index: 5 } })),
        [`GET /v2/ledgers/${HEAD.index}`]: null,
      });
      const api = xrplApi();
      expect(await api.lastValidated()).toEqual(body);
      expect((await failureOf(api.transaction(AMM_DEPOSIT))).kind).toBe("server");
      expect((await api.ledger("5")).ledger_index).toBe(5);
      expect((await api.ledger("5")).ledger_index).toBe(5); // a Response can be used again
      expect((await failureOf(api.ledger(String(HEAD.index)))).message).toContain("ledger not found");
      // Only the key that was overridden: the other shapes of that ledger are the fixtures.
      expect((await api.ledger(String(HEAD.index), { transactions: true })).transactions.length).toBeGreaterThan(0);
      expect(mock.requests.filter((r) => r.source === "override")).toHaveLength(5);
    });

    it("reaches the Worker as that response when a page is asked for, as a value or as a function", async () => {
      // A Response made here is read in the Worker's request, which workerd refuses for a body that was not captured in this one
      // ("Cannot perform I/O on behalf of a different request"): the Worker would then see a connection failure, whatever the status.
      const asked = async (path: string, visitor: number) => {
        const response = await exports.default.fetch(`https://explorer.test${path}`, {
          headers: { "CF-Connecting-IP": `203.0.113.${visitor}` },
          redirect: "manual",
        });
        await response.text();
        return response;
      };
      mock = mockUpstream("xrpl", {
        "GET /v2/ledgers/107700091?expand=true&transactions=true": dataApiError(503, "unavailable"),
        "GET /v2/ledgers/107700092?expand=true&transactions=true": () => dataApiError(500, "boom"),
        "GET /v2/ledgers/107700093?expand=true&transactions=true": Response.json({ result: "error", message: "slow down" }, { status: 429, headers: { "Retry-After": "7" } }),
      });
      expect((await asked("/xrpl/ledger/107700091", 1)).status).toBe(503);
      expect((await asked("/xrpl/ledger/107700092", 2)).status).toBe(503);
      expect((await asked("/xrpl/ledger/107700093", 3)).status).toBe(503);
      expect(statusesOf(mock, "GET /v2/ledgers/107700091?expand=true&transactions=true")).toEqual([503]);
      expect(statusesOf(mock, "GET /v2/ledgers/107700092?expand=true&transactions=true")).toEqual([500]);
      expect(statusesOf(mock, "GET /v2/ledgers/107700093?expand=true&transactions=true")).toEqual([429]);
      expect(mock.unusedOverrides()).toEqual([]);
    });

    it("gives a function the request, key header included", async () => {
      let seen: Request | undefined;
      mock = mockUpstream("xrpl", {
        "GET /v2/last_validated": (req: Request) => {
          seen = req;
          return Response.json({ result: "error", message: "slow down" }, { status: 429, headers: { "Retry-After": "7" } });
        },
      });
      const error = await failureOf(xrplApi().lastValidated());
      expect(error).toMatchObject({ kind: "rate_limited", retryAfter: 7 });
      expect(seen?.headers.get("X-API-Key")).toBe("test-key");
    });

    it("replaces a node answer by its subject or by all its parameters, the most specific key first", async () => {
      mock = mockUpstream("xrpl", {
        [`node account_info ${ACTIVE}`]: nodeError("actNotFound"),
        [`node account_info account=${DELETED}&ledger_index=validated`]: { account_data: { Account: DELETED, Balance: "1" }, ledger_index: 5, validated: true, status: "success" },
        [`node account_info ${DELETED}`]: nodeError("noNetwork"),
        "node server_state": () => Response.json({ result: { state: { server_state: "syncing" }, status: "success" } }),
      });
      const node = xrplNode();
      expect((await failureOf(node.accountInfo(ACTIVE))).message).toContain("actNotFound");
      expect((await node.accountInfo(DELETED)).account_data.Balance).toBe("1");
      expect((await node.serverState()).server_state).toBe("syncing");
    });

    it("lets a test remove a node fixture, so the data API's 404 can meet a node that has it, or not", async () => {
      mock = mockUpstream("xrpl", { [`node tx ${AMM_DEPOSIT.toLowerCase()}`]: null });
      expect((await failureOf(xrplNode().tx(AMM_DEPOSIT))).message).toContain("txnNotFound");
    });

    it("fails loudly when an override function does not return a Response", async () => {
      mock = mockUpstream("xrpl", { "GET /v2/last_validated": (() => ({ result: "success" })) as unknown as () => Response });
      expect((await failureOf(xrplApi().lastValidated())).message).toContain("must return a Response");
    });

    it("takes keys for the other network when they are prefixed with it", async () => {
      mock = mockUpstream("xrpl", { "xahau GET /v2/last_validated": dataApiError(500, "unavailable") });
      expect((await xrplApi().lastValidated()).ledger_index).toBe(String(HEAD.index));
      expect((await failureOf(createDataApi(xahau, env, passThroughCache).lastValidated())).kind).toBe("server");
    });

    it("rejects a key it does not understand, and names the keys no request used", async () => {
      expect(() => mockUpstream("xrpl", { "POST /v2/ledgers": {} })).toThrow(/not an override key/);
      expect(() => mockUpstream("xrpl", { last_validated: {} })).toThrow(/not an override key/);
      mock = mockUpstream("xrpl", { "GET /v2/last_validated": null, "GET /v2/ledgers/9": null, [`xahau node tx ${AMM_DEPOSIT}`]: null });
      await failureOf(xrplApi().lastValidated());
      expect(mock.unusedOverrides()).toEqual(["GET /v2/ledgers/9", `xahau node tx ${AMM_DEPOSIT}`]);
    });
  });

  describe("the record of requests", () => {
    it("lists every request with its network, kind, key, status and where the answer came from", async () => {
      mock = mockUpstream("xrpl");
      await xrplApi().lastValidated();
      await failureOf(xrplApi().transaction("A".repeat(64)));
      await failureOf(xrplNode().tx(AMM_DEPOSIT.replace("83", "84")));
      await xrplNode().serverState();
      expect(mock.requests.map(({ net, kind, key, status, source }) => ({ net, kind, key, status, source }))).toEqual([
        { net: "xrpl", kind: "data-api", key: "GET /v2/last_validated", status: 200, source: "fixture" },
        { net: "xrpl", kind: "data-api", key: `GET /v2/transactions/${"A".repeat(64)}`, status: 404, source: "absent" },
        { net: "xrpl", kind: "node", key: `node tx transaction=${AMM_DEPOSIT.replace("83", "84")}`, status: 200, source: "absent" },
        { net: "xrpl", kind: "node", key: "node server_state", status: 200, source: "fixture" },
      ]);
      expect(mock.requests[0]!.headers.get("X-API-Key")).toBe("test-key");
      expect(mock.requests[2]!.body).toEqual({ method: "tx", params: [{ transaction: AMM_DEPOSIT.replace("83", "84") }] });
    });

    it("is empty when nothing was fetched", () => {
      mock = mockUpstream("xrpl");
      expect(mock.requests).toEqual([]);
    });
  });

  describe("fetch", () => {
    it("throws for a URL that is none of the upstreams, and records nothing", async () => {
      mock = mockUpstream("xrpl");
      await expect(fetch("https://example.com/")).rejects.toThrow(/unexpected network call: GET https:\/\/example.com\//);
      expect(mock.requests).toEqual([]);
    });

    it("fails a request that is aborted while its answer is pending", async () => {
      mock = mockUpstream("xrpl", { "GET /v2/last_validated": () => new Promise<Response>(() => {}) as unknown as Response });
      const controller = new AbortController();
      const pending = fetch(`${xrpl.dataApiUrl}/v2/last_validated`, { headers: { "X-API-Key": "k" }, signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });

    it("is the real fetch again after restore()", () => {
      const before = globalThis.fetch;
      const restorable = mockUpstream("xrpl");
      expect(globalThis.fetch).not.toBe(before);
      restorable.restore();
      expect(globalThis.fetch).toBe(before);
    });
  });
});
