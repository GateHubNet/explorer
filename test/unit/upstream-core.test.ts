import { describe, expect, it } from "vitest";

import {
  canonicalQuery,
  createUpstream,
  dataApiError,
  dataApiFile,
  dataApiKey,
  nodeError,
  nodeFile,
  nodeKeys,
  type FixtureFiles,
  type UpstreamBases,
} from "../support/upstream-core";

// The rules that find a fixture file for a request, and the answers for what has none, without any runtime.

/** A response's JSON (`unknown` under the Node types, `any` under the Workers'). */
const jsonOf = (response: Response | undefined): Promise<any> => response!.json();

const HASH = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
const ACCOUNT = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

describe("keys and file names", () => {
  it("sorts the query, so that the order a client sends it in is not a difference", () => {
    expect(canonicalQuery("transactions=true&expand=true")).toBe("expand=true&transactions=true");
    expect(canonicalQuery("?limit=20&descending=true&marker=abc")).toBe("descending=true&limit=20&marker=abc");
    expect(canonicalQuery("")).toBe("");
  });

  it("keys a data API request by path and sorted query, upper-casing a hash", () => {
    expect(dataApiKey("/v2/transactions/" + HASH.toLowerCase(), "")).toBe(`GET /v2/transactions/${HASH}`);
    expect(dataApiKey("/v2/ledgers/5", "?transactions=true&expand=true")).toBe("GET /v2/ledgers/5?expand=true&transactions=true");
    expect(dataApiKey("/v2/accounts/%72Bb/balances", "")).toBe("GET /v2/accounts/rBb/balances");
  });

  it("names the file of a data API request below the network, after /v2", () => {
    expect(dataApiFile("xrpl", "/v2/last_validated", "")).toBe("xrpl/data-api/last_validated.json");
    expect(dataApiFile("xahau", "/v2/ledgers/26540187", "transactions=true&expand=true")).toBe("xahau/data-api/ledgers/26540187@expand=true&transactions=true.json");
    expect(dataApiFile("xrpl", "/v2/accounts/" + ACCOUNT + "/transactions", "limit=20&descending=true")).toBe(`xrpl/data-api/accounts/${ACCOUNT}/transactions@descending=true&limit=20.json`);
    expect(dataApiFile("xrpl", "/elsewhere", "")).toBeUndefined();
  });

  it("keys a node request by all its parameters and by its subject, the first being the more specific", () => {
    expect(nodeKeys("tx", { transaction: HASH })).toEqual([`node tx transaction=${HASH}`, `node tx ${HASH}`]);
    expect(nodeKeys("ledger", { ledger_index: 5, transactions: true, expand: true })).toEqual(["node ledger expand=true&ledger_index=5&transactions=true", "node ledger 5"]);
    expect(nodeKeys("ledger", { ledger_hash: HASH.toLowerCase() })[1]).toBe(`node ledger ${HASH}`);
    expect(nodeKeys("account_info", { account: ACCOUNT, ledger_index: "validated" })).toEqual([`node account_info account=${ACCOUNT}&ledger_index=validated`, `node account_info ${ACCOUNT}`]);
    expect(nodeKeys("server_state", {})).toEqual(["node server_state"]);
  });

  it("names the file of a node request below the network, by subject, leaving the default ledger out", () => {
    expect(nodeFile("xrpl", "tx", { transaction: HASH })).toBe(`xrpl/node/tx/${HASH}.json`);
    expect(nodeFile("xrpl", "account_info", { account: ACCOUNT, ledger_index: "validated" })).toBe(`xrpl/node/account_info/${ACCOUNT}.json`);
    expect(nodeFile("xrpl", "account_objects", { account: ACCOUNT, ledger_index: "validated", marker: "M1" })).toBe(`xrpl/node/account_objects/${ACCOUNT}@marker=M1.json`);
    expect(nodeFile("xahau", "ledger", { ledger_index: 5, transactions: true, expand: true })).toBe("xahau/node/ledger/5@expand=true&transactions=true.json");
    expect(nodeFile("xahau", "ledger", { ledger_hash: HASH }, 5)).toBe("xahau/node/ledger/5.json");
    expect(nodeFile("xrpl", "server_state", {})).toBe("xrpl/node/server_state.json");
  });
});

describe("createUpstream", () => {
  const store = new Map<string, string>([
    ["xrpl/data-api/last_validated.json", '{"result":"success","ledger_index":"5"}'],
    ["xrpl/data-api/ledgers/5.json", '{"result":"success","ledger":{"ledger_index":5}}'],
    ["xrpl/ledger-hashes.json", JSON.stringify({ [HASH]: 5 })],
    [`xrpl/node/tx/${HASH}.json`, '{"result":{"status":"success"}}'],
    ["xrpl/node/ledger/5.json", '{"result":{"ledger_index":5,"status":"success"}}'],
  ]);
  const files: FixtureFiles = { read: async (path) => store.get(path) };
  const bases: UpstreamBases = {
    xrpl: { dataApi: "http://fixtures.test/xrpl", node: "http://fixtures.test/xrpl-node" },
    xahau: { dataApi: "http://fixtures.test/xahau", node: "http://fixtures.test/xahau-node" },
  };
  const make = (overrides = {}) => createUpstream({ files, bases, primary: "xrpl", overrides });
  const get = (path: string, key: string | null = "k") =>
    new Request(`http://fixtures.test${path}`, { headers: key === null ? {} : { "X-API-Key": key } });
  const rpc = (url: string, method: string, ...params: unknown[]) =>
    new Request(url, { method: "POST", body: JSON.stringify({ method, params }) });

  it("answers a path below a network's base and leaves any other URL alone", async () => {
    const upstream = make();
    expect(await jsonOf(await upstream.handle(get("/xrpl/v2/last_validated")))).toEqual({ result: "success", ledger_index: "5" });
    expect(await upstream.handle(get("/elsewhere/v2/last_validated"))).toBeUndefined();
    expect(await upstream.handle(new Request("http://other.test/xrpl/v2/last_validated"))).toBeUndefined();
    // One origin, the networks told apart by their base path; `/xrpl-node` is not below `/xrpl`.
    expect((await make().handle(get("/xahau/v2/last_validated")))!.status).toBe(404);
  });

  it("finds a ledger by its hash through the table of hashes, and answers an unknown one with 404", async () => {
    const upstream = make();
    expect((await upstream.handle(get(`/xrpl/v2/ledgers/${HASH.toLowerCase()}`)))!.status).toBe(200);
    const unknown = await upstream.handle(get(`/xrpl/v2/ledgers/${"B".repeat(64)}`));
    expect(unknown!.status).toBe(404);
    expect(await jsonOf(unknown)).toEqual({ result: "error", message: "ledger not found" });
  });

  it("answers 401 without the key, 404 for a method the API does not have, and never caches an error", async () => {
    const upstream = make();
    const noKey = await upstream.handle(get("/xrpl/v2/last_validated", null));
    expect(noKey!.status).toBe(401);
    expect(noKey!.headers.get("Cache-Control")).toBe("no-store");
    const post = await upstream.handle(new Request("http://fixtures.test/xrpl/v2/last_validated", { method: "POST", headers: { "X-API-Key": "k" } }));
    expect(post!.status).toBe(404);
  });

  it("answers a node request from its file, by index or by hash for a ledger", async () => {
    const upstream = make();
    const url = "http://fixtures.test/xrpl-node";
    expect((await jsonOf(await upstream.handle(rpc(url, "tx", { transaction: HASH })))).result.status).toBe("success");
    expect((await jsonOf(await upstream.handle(rpc(url, "ledger", { ledger_hash: HASH })))).result.ledger_index).toBe(5);
    expect((await jsonOf(await upstream.handle(rpc(url, "ledger", { ledger_index: 5 })))).result.ledger_index).toBe(5);
  });

  it("answers what a node does not have with the node's own error, at HTTP 200", async () => {
    const upstream = make();
    const url = "http://fixtures.test/xrpl-node";
    const missing = await upstream.handle(rpc(url, "account_info", { account: ACCOUNT, ledger_index: "validated" }));
    expect(missing!.status).toBe(200);
    expect((await jsonOf(missing)).result).toEqual({
      account: ACCOUNT,
      validated: true,
      ...nodeError("actNotFound", { account: ACCOUNT, ledger_index: "validated", command: "account_info" }),
    });
    expect((await jsonOf(await upstream.handle(rpc(url, "tx", { transaction: "C".repeat(64) })))).result.error).toBe("txnNotFound");
    expect((await jsonOf(await upstream.handle(rpc(url, "ledger", { ledger_index: 99 })))).result.error).toBe("lgrNotFound");
    expect((await jsonOf(await upstream.handle(rpc(url, "ledger", { ledger_index: "validated" })))).result.error).toBe("lgrNotFound");
    expect((await jsonOf(await upstream.handle(rpc(url, "feature", {})))).result.error).toBe("unknownCmd");
    const garbage = await upstream.handle(new Request(url, { method: "POST", body: "not json" }));
    expect((await jsonOf(garbage)).result.error).toBe("invalidParams");
  });

  it("describes the errors it makes as the servers do", () => {
    expect(nodeError("txnNotFound")).toMatchObject({ error: "txnNotFound", error_code: 29, status: "error" });
    expect(nodeError("somethingElse")).toMatchObject({ error: "somethingElse", error_code: 73 });
    const limited = dataApiError(429, "slow down", { "Retry-After": "3" });
    expect(limited.headers.get("Retry-After")).toBe("3");
    return jsonOf(limited).then((body) => expect(body).toEqual({ result: "error", message: "slow down" }));
  });
});
