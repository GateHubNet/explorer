import { describe, expect, it } from "vitest";

import {
  canonicalQuery,
  createUpstream,
  dataApiError,
  dataApiFile,
  dataApiKey,
  isSafePart,
  nodeError,
  nodeFile,
  nodeKeys,
  nodeSubject,
  type FixtureFiles,
  type UpstreamBases,
} from "../support/upstream-core";

// The rules that find a fixture file for a request, and the answers for what has none, without any runtime.

/** A response's JSON (`unknown` under the Node types, `any` under the Workers'). */
const jsonOf = (response: Response | undefined): Promise<any> => response!.json();

const HASH = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
const ACCOUNT = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const RLUSD = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const RLUSD_TEXT = "524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const BOOK = { taker_gets: { currency: "XRP" }, taker_pays: RLUSD, ledger_index: "validated", limit: 60 };
const NFT = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255FA9ECC9070655E758";
const URI_TOKEN = "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE9";

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

  // book_offers and amm_info have a subject made of asset objects, written in the API's form (the native code, or CUR+issuer).
  it("makes the subject of a book_offers request of its two assets, taker_gets first", () => {
    expect(nodeSubject("book_offers", BOOK)).toBe(`XRP_${RLUSD_TEXT}`);
    expect(nodeSubject("book_offers", { ...BOOK, taker_gets: RLUSD, taker_pays: { currency: "XRP" } })).toBe(`${RLUSD_TEXT}_XRP`);
    expect(nodeSubject("book_offers", { ...BOOK, taker_gets: { currency: "XAH" } })).toBe(`XAH_${RLUSD_TEXT}`);
    expect(nodeSubject("book_offers", { ...BOOK, taker_gets: { currency: "USD", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" } })).toBe(`USD+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS_${RLUSD_TEXT}`);
  });

  it("makes the subject of an amm_info request the pool account, or its two assets when it is asked by pair", () => {
    expect(nodeSubject("amm_info", { amm_account: POOL, ledger_index: "validated" })).toBe(POOL);
    expect(nodeSubject("amm_info", { asset: { currency: "XRP" }, asset2: RLUSD, ledger_index: "validated" })).toBe(`XRP_${RLUSD_TEXT}`);
    expect(nodeSubject("amm_info", { asset: RLUSD, asset2: { currency: "XRP" }, ledger_index: "validated" })).toBe(`${RLUSD_TEXT}_XRP`);
  });

  it("has no subject for assets it cannot write, and never joins what is not an asset", () => {
    expect(nodeSubject("book_offers", { taker_gets: "XRP", taker_pays: RLUSD })).toBeUndefined();
    expect(nodeSubject("book_offers", { taker_gets: { currency: "XRP" } })).toBeUndefined();
    expect(nodeSubject("book_offers", { taker_gets: { currency: 5 }, taker_pays: RLUSD })).toBeUndefined();
    expect(nodeSubject("book_offers", { taker_gets: { currency: "XRP", issuer: 5 }, taker_pays: RLUSD })).toBeUndefined();
    expect(nodeSubject("amm_info", { asset: { currency: "XRP" } })).toBeUndefined();
    expect(nodeSubject("amm_info", { ledger_index: "validated" })).toBeUndefined();
  });

  it("keys a book_offers and an amm_info request by all its parameters and by its subject", () => {
    const [exact, subject] = nodeKeys("book_offers", BOOK);
    expect(exact).toBe(`node book_offers ledger_index=validated&limit=60&taker_gets={"currency":"XRP"}&taker_pays=${JSON.stringify(RLUSD)}`);
    expect(subject).toBe(`node book_offers XRP_${RLUSD_TEXT}`);
    expect(nodeKeys("amm_info", { amm_account: POOL, ledger_index: "validated" })).toEqual([`node amm_info amm_account=${POOL}&ledger_index=validated`, `node amm_info ${POOL}`]);
    expect(nodeKeys("amm_info", { asset: { currency: "XRP" }, asset2: RLUSD, ledger_index: "validated" })[1]).toBe(`node amm_info XRP_${RLUSD_TEXT}`);
  });

  it("names the file of a node request below the network, by subject, leaving the default ledger out", () => {
    expect(nodeFile("xrpl", "tx", { transaction: HASH })).toBe(`xrpl/node/tx/${HASH}.json`);
    expect(nodeFile("xrpl", "account_info", { account: ACCOUNT, ledger_index: "validated" })).toBe(`xrpl/node/account_info/${ACCOUNT}.json`);
    expect(nodeFile("xrpl", "account_objects", { account: ACCOUNT, ledger_index: "validated", marker: "M1" })).toBe(`xrpl/node/account_objects/${ACCOUNT}@marker=M1.json`);
    expect(nodeFile("xahau", "ledger", { ledger_index: 5, transactions: true, expand: true })).toBe("xahau/node/ledger/5@expand=true&transactions=true.json");
    expect(nodeFile("xahau", "ledger", { ledger_hash: HASH }, 5)).toBe("xahau/node/ledger/5.json");
    expect(nodeFile("xrpl", "server_state", {})).toBe("xrpl/node/server_state.json");
  });

  it("names the file of a book_offers or amm_info request by its subject, with the subject's parameters and the default ledger left out", () => {
    expect(nodeFile("xrpl", "book_offers", BOOK)).toBe(`xrpl/node/book_offers/XRP_${RLUSD_TEXT}@limit=60.json`);
    expect(nodeFile("xrpl", "book_offers", { ...BOOK, taker_gets: RLUSD, taker_pays: { currency: "XRP" } })).toBe(`xrpl/node/book_offers/${RLUSD_TEXT}_XRP@limit=60.json`);
    expect(nodeFile("xahau", "book_offers", { ...BOOK, taker_gets: { currency: "XAH" }, taker_pays: { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" } })).toBe("xahau/node/book_offers/XAH_EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8@limit=60.json");
    expect(nodeFile("xrpl", "amm_info", { amm_account: POOL, ledger_index: "validated" })).toBe(`xrpl/node/amm_info/${POOL}.json`);
    expect(nodeFile("xrpl", "amm_info", { asset: { currency: "XRP" }, asset2: RLUSD, ledger_index: "validated" })).toBe(`xrpl/node/amm_info/XRP_${RLUSD_TEXT}.json`);
  });

  // The three NFT commands are about one NFT, whose id is the subject; `ledger_entry` of D3's URIToken is about an entry, whose key is `index`.
  it("makes the subject of an NFT command its nft_id, and of a ledger_entry its index, upper-casing the 64 digits", () => {
    expect(nodeSubject("nft_info", { nft_id: NFT.toLowerCase(), ledger_index: "validated" })).toBe(NFT);
    expect(nodeSubject("nft_sell_offers", { nft_id: NFT, ledger_index: "validated", limit: 50 })).toBe(NFT);
    expect(nodeSubject("nft_buy_offers", { nft_id: NFT, ledger_index: "validated", limit: 50 })).toBe(NFT);
    expect(nodeSubject("ledger_entry", { index: URI_TOKEN, ledger_index: "validated" })).toBe(URI_TOKEN);
    expect(nodeSubject("nft_info", { ledger_index: "validated" })).toBeUndefined();
    expect(nodeKeys("nft_info", { nft_id: NFT, ledger_index: "validated" })).toEqual([`node nft_info ledger_index=validated&nft_id=${NFT}`, `node nft_info ${NFT}`]);
    expect(nodeKeys("ledger_entry", { index: URI_TOKEN, ledger_index: "validated" })[1]).toBe(`node ledger_entry ${URI_TOKEN}`);
  });

  it("names the file of an NFT command by the NFT, and of a ledger_entry by its index, with the default ledger left out and the offers' limit in the name", () => {
    expect(nodeFile("xrpl", "nft_info", { nft_id: NFT, ledger_index: "validated" })).toBe(`xrpl/node/nft_info/${NFT}.json`);
    expect(nodeFile("xrpl", "nft_sell_offers", { nft_id: NFT, ledger_index: "validated", limit: 50 })).toBe(`xrpl/node/nft_sell_offers/${NFT}@limit=50.json`);
    expect(nodeFile("xrpl", "nft_buy_offers", { nft_id: NFT, ledger_index: "validated", limit: 50 })).toBe(`xrpl/node/nft_buy_offers/${NFT}@limit=50.json`);
    expect(nodeFile("xahau", "ledger_entry", { index: URI_TOKEN, ledger_index: "validated" })).toBe(`xahau/node/ledger_entry/${URI_TOKEN}.json`);
    // A request that is no hash is no file.
    expect(nodeFile("xrpl", "nft_info", { nft_id: "../../package" })).toBeUndefined();
    expect(nodeFile("xahau", "ledger_entry", { index: "..\\..\\package" })).toBeUndefined();
  });

  it("names the file of the data API's NFT routes below the network, after /v2", () => {
    expect(dataApiFile("xrpl", `/v2/nfts/${NFT}/history`, "descending=true&limit=20&event=mint%2Csale")).toBe(`xrpl/data-api/nfts/${NFT}/history@descending=true&event=mint,sale&limit=20.json`);
    expect(dataApiFile("xahau", "/v2/nft_collections/rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb/stats", "start=2026-10-20&end=2026-10-27")).toBe(
      "xahau/data-api/nft_collections/rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb/stats@end=2026-10-27&start=2026-10-20.json",
    );
    expect(dataApiFile("xrpl", `/v2/accounts/${ACCOUNT}/nfts`, "limit=20")).toBe(`xrpl/data-api/accounts/${ACCOUNT}/nfts@limit=20.json`);
  });
});

describe("what a request may make of a file path", () => {
  it("lets a piece through unless it could name another directory or be read as an escape", () => {
    for (const fine of [HASH, ACCOUNT, "107721455", "descending=true&limit=20&marker=WzEwNzY3MDM2MCw1XQ", "expand=true&transactions=true", "a.b"]) {
      expect(isSafePart(fine), fine).toBe(true);
    }
    for (const bad of ["", ".", "..", "a/b", "../x", "a\\b", "%2e%2e", "%252e", "a%2fb", "a?b", "a#b", "a\0b"]) {
      expect(isSafePart(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("names no file for a data API path or query that holds such a piece, however it is written", () => {
    for (const path of [
      "/v2/%2e%2e/%2e%2e/package",
      "/v2/%252e%252e/%252e%252e/package",
      "/v2/accounts/..%2f..%2fpackage",
      "/v2/accounts/..%5cpackage",
      "/v2/accounts/..%255cpackage",
      "/v2/accounts/%00",
    ]) {
      expect(dataApiFile("xrpl", path, ""), path).toBeUndefined();
    }
    expect(dataApiFile("xrpl", "/v2/ledgers/5", "marker=../../x")).toBeUndefined();
    // Dots inside a longer name are no dot segment: this is one file name, in the directory it always is in.
    expect(dataApiFile("xrpl", "/v2/ledgers/5", "marker=%2e%2e")).toBe("xrpl/data-api/ledgers/5@marker=...json");
  });

  it("names no file for a node method, subject or parameter that holds such a piece", () => {
    const up = "../../../../../../package";
    expect(nodeFile("xrpl", "account_info", { account: up })).toBeUndefined();
    expect(nodeFile("xrpl", "account_info", { account: "%2e%2e/%2e%2e/package" })).toBeUndefined();
    expect(nodeFile("xrpl", "account_info", { account: "..\\..\\package" })).toBeUndefined();
    expect(nodeFile("xrpl", "account_objects", { account: ACCOUNT, marker: up })).toBeUndefined();
    expect(nodeFile("xrpl", "tx", { transaction: up })).toBeUndefined();
    expect(nodeFile("xrpl", "ledger", { ledger_index: up })).toBeUndefined();
    expect(nodeFile("xrpl", "../../package", { account: ACCOUNT })).toBeUndefined();
    expect(nodeFile("xrpl", "Account_Info", { account: ACCOUNT })).toBeUndefined();
    // An asset is a piece of the subject too.
    expect(nodeFile("xrpl", "book_offers", { ...BOOK, taker_pays: { currency: "XRP", issuer: up } })).toBeUndefined();
    expect(nodeFile("xrpl", "book_offers", { ...BOOK, taker_gets: { currency: "%2e%2e/%2e%2e" } })).toBeUndefined();
    expect(nodeFile("xrpl", "amm_info", { asset: { currency: "XRP" }, asset2: { currency: "..", issuer: "..\\.." } })).toBeUndefined();
    expect(nodeFile("xrpl", "amm_info", { amm_account: up })).toBeUndefined();
  });

  it("never asks the files for a path that is not made of safe pieces", async () => {
    const asked: string[] = [];
    const files: FixtureFiles = { read: async (path) => (asked.push(path), undefined) };
    const upstream = createUpstream({
      files,
      primary: "xrpl",
      bases: {
        xrpl: { dataApi: "http://fixtures.test/xrpl", node: "http://fixtures.test/xrpl-node" },
        xahau: { dataApi: "http://fixtures.test/xahau", node: "http://fixtures.test/xahau-node" },
      },
    });
    const up = "../../../../../../package";
    for (const path of ["/xrpl/v2/%252e%252e/%252e%252e/package", "/xrpl/v2/accounts/..%255c..%255cpackage", "/xrpl/v2/accounts/%2e%2e%2f%2e%2e%2fpackage"]) {
      const response = await upstream.handle(new Request(`http://fixtures.test${path}`, { headers: { "X-API-Key": "k" } }));
      expect(response!.status, path).toBe(404);
    }
    for (const [method, params] of [
      ["account_info", { account: "%2e%2e/%2e%2e/%2e%2e/package" }],
      ["account_info", { account: up }],
      ["account_info", { account: "..\\..\\package" }],
      ["tx", { transaction: up }],
      ["ledger", { ledger_hash: up }],
      ["account_objects", { account: ACCOUNT, marker: up }],
      [up, {}],
    ] as const) {
      const response = await upstream.handle(new Request("http://fixtures.test/xrpl-node", { method: "POST", body: JSON.stringify({ method, params: [params] }) }));
      expect((await jsonOf(response)).result.status, `${method} ${JSON.stringify(params)}`).toBe("error");
    }
    expect(asked.filter((path) => path.includes("package") || /[%\\]|\.\./.test(path))).toEqual([]);
  });
});

describe("createUpstream", () => {
  const store = new Map<string, string>([
    ["xrpl/data-api/last_validated.json", '{"result":"success","ledger_index":"5"}'],
    ["xrpl/data-api/ledgers/5.json", '{"result":"success","ledger":{"ledger_index":5}}'],
    ["xrpl/ledger-hashes.json", JSON.stringify({ [HASH]: 5 })],
    [`xrpl/node/tx/${HASH}.json`, '{"result":{"status":"success"}}'],
    ["xrpl/node/ledger/5.json", '{"result":{"ledger_index":5,"status":"success"}}'],
    [`xrpl/node/book_offers/XRP_${RLUSD_TEXT}@limit=60.json`, '{"result":{"ledger_index":5,"offers":[{"Account":"rA","Sequence":1}],"status":"success"}}'],
    [`xrpl/node/amm_info/${POOL}.json`, '{"result":{"amm":{"account":"pool"},"ledger_index":5,"validated":true,"status":"success"}}'],
    [`xrpl/node/amm_info/XRP_${RLUSD_TEXT}.json`, '{"result":{"amm":{"account":"pool"},"ledger_index":5,"validated":true,"status":"success"}}'],
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

  it("answers an unknown validator and amendment with the routes' own not-found messages", async () => {
    const upstream = make();
    const key = "nHUkKoJy83JptKcB56T38wQwjvH3EVYdcvwAfLDHwH7QBkLEv4nD";
    for (const path of [`/v2/network/validators/${key}`, `/v2/network/validators/${key}/validations?limit=20`]) {
      const answer = await upstream.handle(get(`/xrpl${path}`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: "Validator not found" });
    }
    const amendment = await upstream.handle(get("/xrpl/v2/network/amendments/fixNothing"));
    expect(amendment!.status).toBe(404);
    expect(await jsonOf(amendment)).toEqual({ result: "error", message: "amendment not found" });
    // A `null` override is the same "absent" answer.
    const removed = await make({ [`GET /v2/network/validators/${key}`]: null }).handle(get(`/xrpl/v2/network/validators/${key}`));
    expect(await jsonOf(removed)).toEqual({ result: "error", message: "Validator not found" });

    // The summary, the list, the amendments and any other path below them stay D1's missing routes: `Cannot GET`, an outage.
    for (const path of [
      "/v2/network/validators/summary",
      "/v2/network/validators",
      "/v2/network/amendments",
      "/v2/network/validators/summary/validations",
      `/v2/network/validators/${key}/manifests`,
      `/v2/network/validators/${key}/validations/more`,
      "/v2/network/amendments/AMM/votes",
    ]) {
      const answer = await upstream.handle(get(`/xrpl${path}?limit=1`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: `Cannot GET ${path}` });
    }
  });

  // The pool route and everything below it (the pair form, the history, the swaps, the liquidity, the governance) answer for a pool that is none; the list
  // is a route like any other. A thing that is missing and a route that is missing are told apart by the message (`throwUnlessOk`).
  it("answers an unknown AMM pool, and anything below it, with the route's own `pool not found`; the list and the volume stay missing routes", async () => {
    const upstream = make();
    for (const path of [
      "/v2/amm/pools/rX",
      "/v2/amm/pools/rX/history?interval=day",
      "/v2/amm/pools/rX/swaps?descending=true&limit=20",
      "/v2/amm/pools/rX/liquidity?event=create&limit=1",
      "/v2/amm/pools/rX/governance",
      `/v2/amm/pools/XRP/${RLUSD_TEXT.replace("+", "%2B")}`,
      `/v2/amm/pools/${POOL}`,
    ]) {
      const answer = await upstream.handle(get(`/xrpl${path}`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: "pool not found" });
    }
    // A `null` override is the same "absent" answer, so a test of a missing route names its body (`dataApiError(404, "Cannot GET …")`).
    const removed = await make({ [`GET /v2/amm/pools/${POOL}`]: null }).handle(get(`/xrpl/v2/amm/pools/${POOL}`));
    expect(await jsonOf(removed)).toEqual({ result: "error", message: "pool not found" });

    for (const path of ["/v2/amm/pools?limit=20", "/v2/amm/pools", "/v2/network/amm_volume?live=day", "/v2/amm"]) {
      const answer = await upstream.handle(get(`/xrpl${path}`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: `Cannot GET ${path.split("?")[0]}` });
    }
  });

  // D3's detail routes answer `nft not found` and `collection not found` for what the index has none of, and everything below them with the same words; its lists are
  // routes like any other (no such thing as a missing list), so they stay missing routes here, `Cannot GET`, like the AMM list.
  it("answers an unknown NFT, and anything below it, with the route's own `nft not found`", async () => {
    const upstream = make();
    for (const path of [`/v2/nfts/${NFT}`, `/v2/nfts/${NFT.toLowerCase()}`, `/v2/nfts/${NFT}/history?descending=true&event=mint%2Csale&limit=20`, `/v2/nfts/${NFT}/offers?limit=50`]) {
      const answer = await upstream.handle(get(`/xrpl${path}`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: "nft not found" });
    }
    // A `null` override is the same "absent" answer.
    const removed = await make({ [`GET /v2/nfts/${NFT}`]: null }).handle(get(`/xrpl/v2/nfts/${NFT}`));
    expect(await jsonOf(removed)).toEqual({ result: "error", message: "nft not found" });
    // The network's own list of NFTs is none: `/v2/nfts` is no route.
    expect(await jsonOf(await upstream.handle(get("/xrpl/v2/nfts")))).toEqual({ result: "error", message: "Cannot GET /v2/nfts" });
  });

  it("answers an unknown collection, and the lists below it, with `collection not found`; the network's lists of collections and sales and the volume stay missing routes", async () => {
    const upstream = make();
    const issuer = "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb";
    for (const path of [
      `/v2/nft_collections/${issuer}`,
      `/v2/nft_collections/${issuer}/1`,
      `/v2/nft_collections/${issuer}/1/nfts?limit=20&marker=M`,
      `/v2/nft_collections/${issuer}/holders?limit=20`,
      `/v2/nft_collections/${issuer}/1/sales?descending=true&limit=20`,
      `/v2/nft_collections/${issuer}/stats?end=2026-10-27&start=2026-10-20`,
    ]) {
      const answer = await upstream.handle(get(`/xrpl${path}`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: "collection not found" });
    }
    for (const path of ["/v2/nft_collections?limit=20&sort=volume", "/v2/nft_collections", "/v2/nft_sales?descending=true&limit=10", "/v2/network/nft_volume?live=day"]) {
      const answer = await upstream.handle(get(`/xrpl${path}`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: `Cannot GET ${path.split("?")[0]}` });
    }
  });

  // D3 answers 200 with an empty page for any address ("an address in a path under /v2/accounts is not checked: one that is none holds nothing"), with the coverage of the
  // network's NFT index. The mock's is the first ledger of the recordings D3's own tests seed, as the reference's examples have it: not whole, nothing before it is indexed.
  it("answers the NFTs of any account with D3's empty page and the coverage of the network, as an answer that has no fixture", async () => {
    const upstream = make();
    const xrpl = await upstream.handle(get(`/xrpl/v2/accounts/${ACCOUNT}/nfts?limit=20`));
    expect(xrpl!.status).toBe(200);
    const body = await jsonOf(xrpl);
    expect(body).toEqual({ result: "success", coverage: { from_ledger_index: 107874617, complete: false }, count: 0, nfts: [] });
    // The keys are in D3's order: no marker, as there is no next page.
    expect(Object.keys(body)).toEqual(["result", "coverage", "count", "nfts"]);
    expect(Object.keys(body.coverage)).toEqual(["from_ledger_index", "complete"]);

    const xahau = await upstream.handle(get(`/xahau/v2/accounts/${ACCOUNT}/nfts?limit=20&issuer=rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb`));
    expect(await jsonOf(xahau)).toEqual({ result: "success", coverage: { from_ledger_index: 26533927, complete: false }, count: 0, nfts: [] });
    expect(upstream.requests.map((request) => [request.net, request.source, request.status])).toEqual([
      ["xrpl", "absent", 200],
      ["xahau", "absent", 200],
    ]);
    // The account's own routes are as they were: the account is not found, the NFT history is no route here (no page shows it).
    expect((await upstream.handle(get(`/xrpl/v2/accounts/${ACCOUNT}`)))!.status).toBe(404);
    expect(await jsonOf(await upstream.handle(get(`/xrpl/v2/accounts/${ACCOUNT}/nft_history`)))).toEqual({ result: "error", message: `Cannot GET /v2/accounts/${ACCOUNT}/nft_history` });
  });

  it("is given a file for an account's NFTs, which is what it answers", async () => {
    const page = { result: "success", coverage: { complete: true }, count: 0, nfts: [] };
    const filed = createUpstream({ files: { read: async (path) => (path === `xrpl/data-api/accounts/${ACCOUNT}/nfts@limit=20.json` ? JSON.stringify(page) : undefined) }, bases, primary: "xrpl" });
    expect(await jsonOf(await filed.handle(get(`/xrpl/v2/accounts/${ACCOUNT}/nfts?limit=20`)))).toEqual(page);
    expect(filed.requests[0]!.source).toBe("fixture");
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

  // What the nodes said on 2026-10-24: Clio (s1.ripple.com) answers an NFT it has none of with `objectNotFound`, 92, "NFT not found" (its offers commands: "notFound");
  // xahaud (xahau.network) answers a ledger entry it has none of with `entryNotFound` and no `error_code`.
  it("answers an NFT command about an NFT with objectNotFound and a ledger_entry about an entry with entryNotFound, at HTTP 200", async () => {
    const upstream = make();
    const url = "http://fixtures.test/xrpl-node";
    for (const [method, params] of [
      ["nft_info", { nft_id: NFT, ledger_index: "validated" }],
      ["nft_sell_offers", { nft_id: NFT, ledger_index: "validated", limit: 50 }],
      ["nft_buy_offers", { nft_id: NFT, ledger_index: "validated", limit: 50 }],
    ] as const) {
      const answer = await upstream.handle(rpc(url, method, params));
      expect(answer!.status, method).toBe(200);
      expect((await jsonOf(answer)).result, method).toEqual({
        error: "objectNotFound",
        error_code: 92,
        error_message: "NFT not found",
        request: { ...params, command: method },
        status: "error",
      });
    }
    const entry = await upstream.handle(rpc("http://fixtures.test/xahau-node", "ledger_entry", { index: URI_TOKEN, ledger_index: "validated" }));
    expect(entry!.status).toBe(200);
    const result = (await jsonOf(entry)).result;
    expect(result).toEqual({ error: "entryNotFound", request: { index: URI_TOKEN, ledger_index: "validated", command: "ledger_entry" }, status: "error" });
    expect(Object.keys(result)).not.toContain("error_code");
    expect(upstream.requests.map((request) => request.source)).toEqual(["absent", "absent", "absent", "absent"]);
  });

  it("takes an override keyed by the NFT, and answers one that is `null` with the NFT's absent answer", async () => {
    const upstream = make({ [`node nft_info ${NFT}`]: { nft_id: NFT, validated: true, status: "success" }, [`node ledger_entry ${URI_TOKEN}`]: null });
    const url = "http://fixtures.test/xrpl-node";
    expect((await jsonOf(await upstream.handle(rpc(url, "nft_info", { nft_id: NFT.toLowerCase(), ledger_index: "validated" })))).result.nft_id).toBe(NFT);
    expect((await jsonOf(await upstream.handle(rpc(url, "ledger_entry", { index: URI_TOKEN, ledger_index: "validated" })))).result.error).toBe("entryNotFound");
    expect(upstream.unusedOverrides()).toEqual([]);
  });

  it("answers an NFT command from its file, by NFT", async () => {
    const files: FixtureFiles = {
      read: async (path) =>
        path === `xrpl/node/nft_info/${NFT}.json`
          ? '{"result":{"nft_id":"00081388AF09","validated":true,"status":"success"}}'
          : path === `xrpl/node/nft_sell_offers/${NFT}@limit=50.json`
            ? '{"result":{"offers":[],"status":"success"}}'
            : undefined,
    };
    const upstream = createUpstream({ files, bases, primary: "xrpl" });
    const url = "http://fixtures.test/xrpl-node";
    expect((await jsonOf(await upstream.handle(rpc(url, "nft_info", { nft_id: NFT, ledger_index: "validated" })))).result.validated).toBe(true);
    expect((await jsonOf(await upstream.handle(rpc(url, "nft_sell_offers", { nft_id: NFT, ledger_index: "validated", limit: 50 })))).result.offers).toEqual([]);
    // The limit is in the file's name: no file for another limit, which the node would answer for as well, so it is absent.
    expect((await jsonOf(await upstream.handle(rpc(url, "nft_sell_offers", { nft_id: NFT, ledger_index: "validated", limit: 100 })))).result.error).toBe("objectNotFound");
    expect(upstream.requests.map((request) => request.source)).toEqual(["fixture", "fixture", "absent"]);
  });

  it("answers a book_offers and an amm_info request from their files, by subject", async () => {
    const upstream = make();
    const url = "http://fixtures.test/xrpl-node";
    const book = (await jsonOf(await upstream.handle(rpc(url, "book_offers", BOOK)))).result;
    expect(book.offers).toEqual([{ Account: "rA", Sequence: 1 }]);
    // The limit is part of the file's name: another limit is another file.
    expect((await jsonOf(await upstream.handle(rpc(url, "book_offers", { ...BOOK, limit: 20 })))).result.offers).toEqual([]);
    const byPool = (await jsonOf(await upstream.handle(rpc(url, "amm_info", { amm_account: POOL, ledger_index: "validated" })))).result;
    const byPair = (await jsonOf(await upstream.handle(rpc(url, "amm_info", { asset: { currency: "XRP" }, asset2: RLUSD, ledger_index: "validated" })))).result;
    expect(byPool.amm.account).toBe("pool");
    expect(byPair).toEqual(byPool);
    expect(upstream.requests.map((request) => request.key)).toEqual([
      `node book_offers ledger_index=validated&limit=60&taker_gets={"currency":"XRP"}&taker_pays=${JSON.stringify(RLUSD)}`,
      `node book_offers ledger_index=validated&limit=20&taker_gets={"currency":"XRP"}&taker_pays=${JSON.stringify(RLUSD)}`,
      `node amm_info amm_account=${POOL}&ledger_index=validated`,
      `node amm_info asset={"currency":"XRP"}&asset2=${JSON.stringify(RLUSD)}&ledger_index=validated`,
    ]);
  });

  it("takes an override keyed by the subject of a book_offers or amm_info request", async () => {
    const upstream = make({
      [`node book_offers XRP_${RLUSD_TEXT}`]: { ledger_index: 9, offers: [], validated: true },
      [`node amm_info ${POOL}`]: nodeError("slowDown"),
      [`node amm_info XRP_${RLUSD_TEXT}`]: null,
    });
    const url = "http://fixtures.test/xrpl-node";
    expect((await jsonOf(await upstream.handle(rpc(url, "book_offers", BOOK)))).result.ledger_index).toBe(9);
    expect((await jsonOf(await upstream.handle(rpc(url, "amm_info", { amm_account: POOL, ledger_index: "validated" })))).result.error).toBe("slowDown");
    expect((await jsonOf(await upstream.handle(rpc(url, "amm_info", { asset: { currency: "XRP" }, asset2: RLUSD, ledger_index: "validated" })))).result.error).toBe("actNotFound");
    expect(upstream.unusedOverrides()).toEqual([]);
  });

  it("answers an amm_info for a pair or an account without a pool with actNotFound", async () => {
    const upstream = make();
    const url = "http://fixtures.test/xrpl-node";
    const lions = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
    for (const params of [
      { asset: { currency: "XRP" }, asset2: lions, ledger_index: "validated" },
      { amm_account: ACCOUNT, ledger_index: "validated" },
    ]) {
      const answer = await upstream.handle(rpc(url, "amm_info", params));
      expect(answer!.status).toBe(200);
      expect((await jsonOf(answer)).result).toMatchObject({ error: "actNotFound", status: "error" });
    }
  });

  it("answers a book nobody offers in with an empty validated book at the newest recorded ledger of the network", async () => {
    const upstream = make();
    const lions = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
    const empty = await upstream.handle(rpc("http://fixtures.test/xrpl-node", "book_offers", { ...BOOK, taker_pays: lions }));
    expect(empty!.status).toBe(200);
    expect((await jsonOf(empty)).result).toEqual({ ledger_index: 5, offers: [], validated: true });

    // Each network's own recording: the ledger of Xahau is not the XRP Ledger's.
    const both: FixtureFiles = { read: async (path) => (path === "xahau/data-api/last_validated.json" ? '{"result":"success","ledger_index":"26596843"}' : store.get(path)) };
    const together = createUpstream({ files: both, bases, primary: "xrpl" });
    const xahau = await together.handle(rpc("http://fixtures.test/xahau-node", "book_offers", { ...BOOK, taker_gets: { currency: "XAH" } }));
    expect((await jsonOf(xahau)).result).toEqual({ ledger_index: 26596843, offers: [], validated: true });
    expect((await jsonOf(await together.handle(rpc("http://fixtures.test/xrpl-node", "book_offers", { ...BOOK, taker_pays: lions })))).result.ledger_index).toBe(5);
    expect(upstream.requests.map((request) => request.source)).toEqual(["absent"]);
    expect(together.requests.map((request) => request.source)).toEqual(["absent", "absent"]);
  });

  it("has no book to answer with when the network has no recorded ledger", async () => {
    const empty = createUpstream({ files: { read: async () => undefined }, bases, primary: "xrpl" });
    const answer = await empty.handle(rpc("http://fixtures.test/xrpl-node", "book_offers", BOOK));
    expect((await jsonOf(answer)).result).toMatchObject({ error: "noNetwork", status: "error" });
    // A record that names no ledger, or is no JSON, is none.
    for (const recorded of ['{"ledger_index":"soon"}', '{"result":"success"}', "not json"]) {
      const unreadable = createUpstream({
        files: { read: async (path) => (path === "xrpl/data-api/last_validated.json" ? recorded : undefined) },
        bases,
        primary: "xrpl",
      });
      expect((await jsonOf(await unreadable.handle(rpc("http://fixtures.test/xrpl-node", "book_offers", BOOK)))).result.error, recorded).toBe("noNetwork");
    }
  });

  describe("a Response given as an override", () => {
    const KEY = "GET /v2/last_validated";

    it("is captured when the mock is made, and every request gets a Response of its own built from it", async () => {
      const original = Response.json({ result: "error", message: "unavailable" }, { status: 503, headers: { "Retry-After": "7", "X-Kept": "1" } });
      const upstream = make({ [KEY]: original });
      // What happens to the original afterwards - its body read, its headers changed - is no concern of the mock.
      await original.text();
      original.headers.set("X-Late", "1");

      const first = (await upstream.handle(get("/xrpl/v2/last_validated")))!;
      const second = (await upstream.handle(get("/xrpl/v2/last_validated")))!;
      expect(first).not.toBe(second);
      for (const answer of [first, second]) {
        expect(answer.status).toBe(503);
        expect(answer.headers.get("Retry-After")).toBe("7");
        expect(answer.headers.get("X-Kept")).toBe("1");
        expect(answer.headers.has("X-Late")).toBe(false);
      }
      expect(await jsonOf(first)).toEqual({ result: "error", message: "unavailable" });
      expect(await jsonOf(second)).toEqual({ result: "error", message: "unavailable" });
    });

    it("keeps the status text, and answers a status that has no body without one", async () => {
      const upstream = make({ [KEY]: new Response(null, { status: 304, statusText: "Not Modified", headers: { ETag: "x" } }) });
      const answer = (await upstream.handle(get("/xrpl/v2/last_validated")))!;
      expect(answer.status).toBe(304);
      expect(answer.statusText).toBe("Not Modified");
      expect(answer.headers.get("ETag")).toBe("x");
      expect(answer.body).toBeNull();
    });

    it("is not mistaken for a JSON body, and a plain object still is one", async () => {
      const upstream = make({ [KEY]: { result: "success", ledger_index: "9" } });
      const answer = (await upstream.handle(get("/xrpl/v2/last_validated")))!;
      expect(answer.status).toBe(200);
      expect(await jsonOf(answer)).toEqual({ result: "success", ledger_index: "9" });
    });
  });

  it("describes the errors it makes as the servers do", () => {
    expect(nodeError("txnNotFound")).toMatchObject({ error: "txnNotFound", error_code: 29, status: "error" });
    expect(nodeError("somethingElse")).toMatchObject({ error: "somethingElse", error_code: 73 });
    expect(nodeError("actMalformed")).toMatchObject({ error: "actMalformed", error_code: 35, error_message: "Account malformed.", status: "error" });
    expect(nodeError("objectNotFound")).toMatchObject({ error: "objectNotFound", error_code: 92, error_message: "NFT not found", status: "error" });
    // xahaud's `entryNotFound` is the code and nothing else: no `error_code`, no `error_message`. The others keep their keys in the order they have always had.
    expect(nodeError("entryNotFound", { index: "A" })).toEqual({ error: "entryNotFound", request: { index: "A" }, status: "error" });
    expect(Object.keys(nodeError("entryNotFound"))).toEqual(["error", "request", "status"]);
    expect(Object.keys(nodeError("txnNotFound"))).toEqual(["error", "error_code", "error_message", "request", "status"]);
    const limited = dataApiError(429, "slow down", { "Retry-After": "3" });
    expect(limited.headers.get("Retry-After")).toBe("3");
    return jsonOf(limited).then((body) => expect(body).toEqual({ result: "error", message: "slow down" }));
  });
});
