import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startFixtureServer, type FixtureServer } from "../support/fixture-server";

// The Node HTTP server of the end-to-end suite: the same fixtures as mockUpstream(), one origin, a base path per upstream.

const HASH = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
const KEY = { "X-API-Key": "k" };

/** A response's JSON (`unknown` under the Node types, `any` under the Workers'). */
const jsonOf = (response: Response): Promise<any> => response.json();

let server: FixtureServer;
beforeAll(async () => {
  server = await startFixtureServer(0);
});
afterAll(async () => {
  await server.close();
});

const rpc = (path: string, method: string, params: unknown) =>
  fetch(`${server.url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, params: [params] }) });

describe("startFixtureServer", () => {
  it("listens on the loopback address and says where", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("serves each network's data API under its own base path", async () => {
    const xrpl = await jsonOf(await fetch(`${server.url}/xrpl/v2/last_validated`, { headers: KEY }));
    const xahau = await jsonOf(await fetch(`${server.url}/xahau/v2/last_validated`, { headers: KEY }));
    expect(xrpl).toMatchObject({ result: "success", ledger_index: "107721455" });
    expect(xahau).toMatchObject({ result: "success", ledger_index: "26596843" });
  });

  it("serves a transaction, a query in any order, and a ledger by hash", async () => {
    const tx = await fetch(`${server.url}/xrpl/v2/transactions/${HASH}`, { headers: KEY });
    expect(tx.status).toBe(200);
    expect(tx.headers.get("Content-Type")).toContain("application/json");
    expect((await jsonOf(tx)).transaction.hash).toBe(HASH);

    const byIndex = await jsonOf(await fetch(`${server.url}/xrpl/v2/ledgers/107720688?transactions=true&expand=true`, { headers: KEY }));
    const byHash = await jsonOf(await fetch(`${server.url}/xrpl/v2/ledgers/${byIndex.ledger.ledger_hash}?expand=true&transactions=true`, { headers: KEY }));
    expect(byHash).toEqual(byIndex);
  });

  it("answers what it has no file for with the API's 404 body, and a request without the key with 401", async () => {
    const missing = await fetch(`${server.url}/xrpl/v2/transactions/${"A".repeat(64)}`, { headers: KEY });
    expect(missing.status).toBe(404);
    expect(await jsonOf(missing)).toEqual({ result: "error", message: "transaction not found" });
    expect((await fetch(`${server.url}/xrpl/v2/last_validated`)).status).toBe(401);
  });

  it("serves each node under its own base path, as JSON-RPC", async () => {
    const tx = await jsonOf(await rpc("/xrpl-node", "tx", { transaction: HASH }));
    expect(tx.result).toMatchObject({ hash: HASH, validated: true, status: "success" });
    // The same hash is not on Xahau.
    const other = await jsonOf(await rpc("/xahau-node", "tx", { transaction: HASH }));
    expect(other.result).toMatchObject({ error: "txnNotFound", status: "error" });
    const state = await jsonOf(await rpc("/xahau-node", "server_state", {}));
    expect(state.result.state.validated_ledger.seq).toBe(26596843);
    const gone = await jsonOf(await rpc("/xrpl-node", "account_info", { account: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC", ledger_index: "validated" }));
    expect(gone.result.error).toBe("actNotFound");
  });

  it("is not the other network's upstream, and not anything else", async () => {
    // A node is not reached through the data API's path, nor the data API through the node's.
    expect((await fetch(`${server.url}/xrpl-node/v2/last_validated`, { headers: KEY })).status).toBe(404);
    expect((await fetch(`${server.url}/`)).status).toBe(404);
    expect((await fetch(`${server.url}/other/v2/last_validated`, { headers: KEY })).status).toBe(404);
  });

  it("does not read outside the fixtures, whatever the path", async () => {
    for (const path of ["/xrpl/v2/%2e%2e/%2e%2e/%2e%2e/package", "/xrpl/v2/..%2f..%2f..%2fpackage", `/xrpl/v2/accounts/${"%2e%2e%2f".repeat(6)}package`]) {
      const response = await fetch(`${server.url}${path}`, { headers: KEY });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain('"name"');
    }
  });

  it("writes down what it was asked", async () => {
    const before = server.requests.length;
    await fetch(`${server.url}/xahau/v2/last_validated`, { headers: KEY });
    expect(server.requests.slice(before).map(({ net, kind, key }) => ({ net, kind, key }))).toEqual([{ net: "xahau", kind: "data-api", key: "GET /v2/last_validated" }]);
  });

  it("stops listening when closed", async () => {
    const another = await startFixtureServer(0);
    const url = another.url;
    await another.close();
    await expect(fetch(`${url}/xrpl/v2/last_validated`, { headers: KEY })).rejects.toThrow();
  });
});
