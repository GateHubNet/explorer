import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fileReader, startFixtureServer, type FixtureServer } from "../support/fixture-server";

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

  // The repository's package.json is what the exploits below would have read: `"name"` is in it.
  const LEAK = '"name"';
  const UP = (n: number, encoded: string) => encoded.repeat(n);

  it("does not read outside the fixtures through a data API path, however the dots and slashes are written", async () => {
    const paths = [
      "/xrpl/v2/%2e%2e/%2e%2e/%2e%2e/package",
      "/xrpl/v2/..%2f..%2f..%2fpackage",
      `/xrpl/v2/accounts/${UP(6, "%2e%2e%2f")}package`,
      // Decoded once by the router, which left `%2e%2e` for the URL parser of the file path to read as dots.
      `/xrpl/v2/${UP(5, "%252e%252e/")}package`,
      `/xrpl/v2/accounts/${UP(6, "%252e%252e%252f")}package`,
      `/xrpl/v2/accounts/${UP(6, "..%5c")}package`,
      `/xrpl/v2/accounts/${UP(6, "..%255c")}package`,
      "/xrpl/v2/accounts/%00",
    ];
    for (const path of paths) {
      const response = await fetch(`${server.url}${path}`, { headers: KEY });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain(LEAK);
    }
  });

  it("does not read outside the fixtures through what a JSON-RPC request names", async () => {
    const climb = (separator: string) => `${UP(6, `..${separator}`)}package`;
    const bodies: Array<[string, Record<string, unknown>]> = [
      ["account_info", { account: climb("/") }],
      ["account_info", { account: climb("%2f") }],
      ["account_info", { account: UP(6, "%2e%2e/") + "package" }],
      ["account_info", { account: UP(6, "%2e%2e%2f") + "package" }],
      ["account_info", { account: climb("\\") }],
      ["account_objects", { account: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC", marker: climb("/") }],
      ["tx", { transaction: climb("/") }],
      ["ledger", { ledger_index: climb("/") }],
      ["ledger", { ledger_hash: climb("/") }],
      ["../../../../../../package", { account: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC" }],
    ];
    for (const [method, params] of bodies) {
      const text = await (await rpc("/xrpl-node", method, params)).text();
      expect(text, `${method} ${JSON.stringify(params)}`).not.toContain(LEAK);
      expect(JSON.parse(text).result.status, text).toBe("error");
    }
  });

  it("answers a JSON-RPC subject that is not a name with the node's own not-found", async () => {
    const body = await jsonOf(await rpc("/xrpl-node", "account_info", { account: "%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/package" }));
    expect(body.result.error).toBe("actNotFound");
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

describe("fileReader", () => {
  // <tmp>/http is the root; <tmp>/http-secret begins with the root's name and is not in it.
  let tmp: string;
  let reader: ReturnType<typeof fileReader>;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "fixture-root-"));
    mkdirSync(join(tmp, "http", "xrpl", "data-api"), { recursive: true });
    mkdirSync(join(tmp, "http-secret"));
    writeFileSync(join(tmp, "http", "xrpl", "data-api", "ok.json"), '{"ok":true}');
    writeFileSync(join(tmp, "http-secret", "secret.json"), '{"secret":true}');
    writeFileSync(join(tmp, "secret.json"), '{"secret":true}');
    symlinkSync(join(tmp, "http-secret"), join(tmp, "http", "xrpl", "link"));
    reader = fileReader(pathToFileURL(join(tmp, "http") + "/"));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("reads a file inside its root", async () => {
    expect(await reader.read("xrpl/data-api/ok.json")).toBe('{"ok":true}');
    expect(await reader.read("xrpl/data-api/missing.json")).toBeUndefined();
  });

  it("does not leave its root: not by dots, not into a sibling whose name begins with the root's, not by an absolute path", async () => {
    for (const path of [
      "../http-secret/secret.json",
      "xrpl/../../http-secret/secret.json",
      "../secret.json",
      join(tmp, "http-secret", "secret.json"),
      join(tmp, "secret.json"),
      "/etc/hosts",
      "../http/xrpl/data-api/ok.json/../../../../http-secret/secret.json",
    ]) {
      expect(await reader.read(path), path).toBeUndefined();
    }
  });

  it("does not read a path that is escaped, or has a backslash, a query, a fragment or a NUL", async () => {
    for (const path of ["%2e%2e/http-secret/secret.json", "xrpl/%2e%2e/%2e%2e/http-secret/secret.json", "xrpl\\data-api\\ok.json", "xrpl/data-api/ok.json?x", "xrpl/data-api/ok.json#x", "xrpl/data-api/ok.json\0"]) {
      expect(await reader.read(path), path).toBeUndefined();
    }
  });

  it("does not follow a link out of its root", async () => {
    expect(await reader.read("xrpl/link/secret.json")).toBeUndefined();
  });
});
