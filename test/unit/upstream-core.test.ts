import { classicAddressToXAddress, encodeAccountID } from "ripple-address-codec";
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

  // D6's detail and holders answer `token not found` for what the index does not know; its transfers never do (the list does not look the token up, D6's "No 404"): an empty page with
  // the feature's coverage, as D3 answers the NFTs of any account. Its list is a route like any other: without a file it stays a missing route, `Cannot GET`.
  it("answers an unknown token and its holders with token not found, its transfers with an empty page of the first recorded ledger's coverage", async () => {
    const upstream = make();
    const token = `ZZZ.${ACCOUNT}`;
    for (const path of [`/v2/tokens/${token}`, `/v2/tokens/${token}/holders?limit=50`, `/v2/tokens/${token}/holders?limit=50&marker=M`]) {
      const answer = await upstream.handle(get(`/xrpl${path}`));
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: "token not found" });
    }
    // A `null` override is the same "absent" answer.
    const removed = await make({ [`GET /v2/tokens/${token}`]: null }).handle(get(`/xrpl/v2/tokens/${token}`));
    expect(await jsonOf(removed)).toEqual({ result: "error", message: "token not found" });

    for (const [net, from_ledger_index] of [["xrpl", 93663334], ["xahau", 26540187]] as const) {
      for (const path of [`/v2/tokens/${token}/transfers`, `/v2/tokens/${token}/transfers?descending=true&limit=20`]) {
        const answer = await upstream.handle(get(`/${net}${path}`));
        expect(answer!.status, path).toBe(200);
        expect(await jsonOf(answer), path).toEqual({ result: "success", coverage: { from_ledger_index, complete: false }, count: 0, transfers: [] });
      }
    }

    // The list without a file, and any other path below a token, stay missing routes.
    for (const path of ["/v2/tokens", "/v2/tokens?kind=issued&limit=20", `/v2/tokens/${token}/supply`, `/v2/tokens/${token}/holders/more`, `/v2/tokens/${token}/transfers/more`]) {
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
  // network's NFT index, the feature's: the fixtures' (scripts/nft-fixtures.ts, `FEATURE_COVERAGE`; test/unit/nft-fixtures.test.ts compares the pages). XRPL's feature is as old
  // as the network, complete from its first ledger, 32,570; Xahau's starts at the first ledger of the recordings D3's own tests seed, as the reference's example has it: not whole.
  it("answers the NFTs of any account with D3's empty page and the coverage of the network, as an answer that has no fixture", async () => {
    const upstream = make();
    const xrpl = await upstream.handle(get(`/xrpl/v2/accounts/${ACCOUNT}/nfts?limit=20`));
    expect(xrpl!.status).toBe(200);
    const body = await jsonOf(xrpl);
    expect(body).toEqual({ result: "success", coverage: { from_ledger_index: 32570, complete: true }, count: 0, nfts: [] });
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

  // D5's escrows, checks and payment channels, and the lookup of an ID: each route's own 404, for the object and the pages of its history (scripts/object-fixtures.ts writes a file
  // for every object of the recordings); a node has no entry of an ID it does not hold.
  it("answers an unknown object with D5's not-found messages and an unknown ledger entry with entryNotFound", async () => {
    const upstream = make();
    const id = "B95064B1A92F02EE009E6BDFB369CF476FB925BB8615456970E38774034A5D30";
    for (const [route, message] of [
      ["escrows", "escrow not found"],
      ["checks", "check not found"],
      ["payment_channels", "payment channel not found"],
    ] as const) {
      for (const path of [`/v2/${route}/${id}`, `/v2/${route}/${id.toLowerCase()}`, `/v2/${route}/${id}/history?descending=true&limit=50&marker=WzEsMl0`]) {
        const answer = await upstream.handle(get(`/xrpl${path}`));
        expect(answer!.status, path).toBe(404);
        expect(await jsonOf(answer), path).toEqual({ result: "error", message });
      }
      // Nothing else is below an object, and the route has no list.
      expect(await jsonOf(await upstream.handle(get(`/xrpl/v2/${route}/${id}/offers`)))).toEqual({ result: "error", message: `Cannot GET /v2/${route}/${id}/offers` });
      expect(await jsonOf(await upstream.handle(get(`/xrpl/v2/${route}`)))).toEqual({ result: "error", message: `Cannot GET /v2/${route}` });
    }
    // A path whose first segment is a name the table's prototype has (`constructor`, `toString`) is no object route: still `Cannot GET`, never the prototype's value.
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const answer = await upstream.handle(get(`/xrpl/v2/${name}/${id}`));
      expect(answer!.status, name).toBe(404);
      expect(await jsonOf(answer), name).toEqual({ result: "error", message: `Cannot GET /v2/${name}/${id}` });
    }
    const lookup = await upstream.handle(get(`/xahau/v2/ledger_objects/${id}`));
    expect(lookup!.status).toBe(404);
    expect(await jsonOf(lookup)).toEqual({ result: "error", message: "ledger object not found" });
    // A `null` override is the same "absent" answer.
    expect(await jsonOf(await make({ [`GET /v2/escrows/${id}`]: null }).handle(get(`/xrpl/v2/escrows/${id}`)))).toEqual({ result: "error", message: "escrow not found" });

    const entry = await upstream.handle(rpc("http://fixtures.test/xrpl-node", "ledger_entry", { index: id, ledger_index: "validated" }));
    expect(entry!.status).toBe(200);
    expect((await jsonOf(entry)).result).toEqual({ error: "entryNotFound", request: { index: id, ledger_index: "validated", command: "ledger_entry" }, status: "error" });
  });

  // D5 answers the delegations of any valid address, and of an address with none an empty page with the delegations' coverage and the ledger it is as of (C11; the objects'
  // recordings' newest ledger, scripts/object-fixtures.ts; test/unit/object-fixtures.test.ts compares the pages); its two 400s come first.
  it("answers the delegations of an account without a file with D5's empty page, and D5's 400s", async () => {
    const upstream = make();
    for (const query of ["", "?direction=given&limit=200", "?direction=&limit=200", "?direction=held&limit=200"]) {
      const answer = await upstream.handle(get(`/xrpl/v2/accounts/${ACCOUNT}/delegations${query}`));
      expect(answer!.status, query).toBe(200);
      const body = await jsonOf(answer);
      expect(body, query).toEqual({
        result: "success",
        coverage: { from_ledger_index: 102145584, complete: true },
        ledger_index: 107972102,
        close_time: "2026-10-29T03:50:41Z",
        count: 0,
        delegations: [],
      });
      expect(Object.keys(body)).toEqual(["result", "coverage", "ledger_index", "close_time", "count", "delegations"]);
    }
    expect(await jsonOf(await upstream.handle(get(`/xahau/v2/accounts/${ACCOUNT}/delegations`)))).toMatchObject({ coverage: { from_ledger_index: 8852809, complete: true }, ledger_index: 26399329 });
    const wrong = await upstream.handle(get(`/xrpl/v2/accounts/${ACCOUNT}/delegations?direction=both`));
    expect(wrong!.status).toBe(400);
    expect(await jsonOf(wrong)).toEqual({ result: "error", message: "invalid direction" });
    const xAddress = classicAddressToXAddress(ACCOUNT, false, false);
    expect(await jsonOf(await upstream.handle(get(`/xrpl/v2/accounts/${xAddress}/delegations`)))).toEqual({ result: "error", message: "invalid ripple address" });
    expect(upstream.requests.map((request) => request.source).every((source) => source === "absent")).toBe(true);
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

// D4's names batch (data-api-new `feat/explorer-data-2` at 3feb11a, docs/api-reference.md, "Account names and tomls"; `parseAddresses` of
// apps/api/src/names/account-names.controller.ts): the mock composes it from the network's `account_names.json`, after the overrides and before any file.
describe("GET /v2/account_names, composed as D4 answers it", () => {
  const NP = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
  const HARBOR = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
  const UNNAMED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
  const TW = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
  const NP_ENTRY = { address: NP, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" };
  const HARBOR_ENTRY = { address: HARBOR, display_name: { text: "Harborline Exchange", kind: "account" }, account_name: "Harborline Exchange" };
  const TW_ENTRY = { address: TW, display_name: { text: "Tidewater Reserve", kind: "verified" }, domain: "tidewater.example" };
  const TOML = { result: "success", toml: { domain: "northpeak.example", toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml", status: "ok", checked: "2026-10-17T06:00:00.000Z" } };
  const store = new Map<string, string>([
    ["xrpl/data-api/account_names.json", `{\n  ${JSON.stringify(NP)}: ${JSON.stringify(NP_ENTRY)},\n  ${JSON.stringify(HARBOR)}: ${JSON.stringify(HARBOR_ENTRY)}\n}\n`],
    ["xahau/data-api/account_names.json", `{\n  ${JSON.stringify(TW)}: ${JSON.stringify(TW_ENTRY)}\n}\n`],
    ["xrpl/data-api/toml/northpeak.example.json", JSON.stringify(TOML)],
  ]);
  const bases: UpstreamBases = {
    xrpl: { dataApi: "http://fixtures.test/xrpl", node: "http://fixtures.test/xrpl-node" },
    xahau: { dataApi: "http://fixtures.test/xahau", node: "http://fixtures.test/xahau-node" },
  };
  const make = (overrides = {}) => createUpstream({ files: { read: async (path) => store.get(path) }, bases, primary: "xrpl", overrides });
  const names = (upstream: ReturnType<typeof make>, query: string, net = "xrpl") =>
    upstream.handle(new Request(`http://fixtures.test/${net}/v2/account_names${query}`, { headers: { "X-API-Key": "k" } }));
  /** The `n`-th valid classic address of a series (the AccountID is the number), as D4's own spec makes them. */
  const nth = (n: number): string => {
    const id = new Uint8Array(20);
    new DataView(id.buffer).setUint32(16, n);
    return encodeAccountID(id);
  };

  it("answers each address asked in the order asked, a repeated one at each place and an unnamed one as its address alone, with the count", async () => {
    const upstream = make();
    const answer = await names(upstream, `?addresses=${HARBOR},${UNNAMED},${NP},${HARBOR}`);
    expect(answer!.status).toBe(200);
    const body = await jsonOf(answer);
    expect(body).toEqual({ result: "success", count: 4, account_names: [HARBOR_ENTRY, { address: UNNAMED }, NP_ENTRY, HARBOR_ENTRY] });
    expect(Object.keys(body)).toEqual(["result", "count", "account_names"]);
    expect(Object.keys(body.account_names[0])).toEqual(["address", "display_name", "account_name"]);
    expect(upstream.requests.map((request) => [request.key, request.source, request.status])).toEqual([[`GET /v2/account_names?addresses=${HARBOR},${UNNAMED},${NP},${HARBOR}`, "fixture", 200]]);
    // the commas as a client's URLSearchParams sends them, and the first of a repeated parameter
    expect(await jsonOf(await names(upstream, `?addresses=${NP}%2C${UNNAMED}&addresses=${HARBOR}`))).toEqual({ result: "success", count: 2, account_names: [NP_ENTRY, { address: UNNAMED }] });
  });

  it("answers from the names of the network asked, and an address as its address alone where the network has no names file", async () => {
    const upstream = make();
    expect(await jsonOf(await names(upstream, `?addresses=${TW},${NP}`, "xahau"))).toEqual({ result: "success", count: 2, account_names: [TW_ENTRY, { address: NP }] });
    const bare = createUpstream({ files: { read: async () => undefined }, bases, primary: "xrpl" });
    expect(await jsonOf(await names(bare, `?addresses=${NP}`))).toEqual({ result: "success", count: 1, account_names: [{ address: NP }] });
  });

  it("answers D4's three 400s, in D4's order: missing or empty, more than 100 elements, an element that is no classic address", async () => {
    const upstream = make();
    const hundred = Array.from({ length: 100 }, (_, i) => nth(i + 1));
    expect(await jsonOf(await names(upstream, `?addresses=${hundred.join(",")}`))).toMatchObject({ result: "success", count: 100 });
    const cases: Array<[query: string, message: string]> = [
      ["", "addresses is required"],
      ["?addresses=", "addresses is required"],
      [`?other=${NP}`, "addresses is required"],
      [`?addresses=&addresses=${NP}`, "addresses is required"],
      [`?addresses=${[...hundred, nth(101)].join(",")}`, "too many addresses - at most 100"],
      [`?addresses=${Array(101).fill("x").join(",")}`, "too many addresses - at most 100"],
      [`?addresses=${",".repeat(100)}`, "too many addresses - at most 100"],
      [`?addresses=${",".repeat(99)}`, "invalid ripple address"],
      [`?addresses=${NP},,${HARBOR}`, "invalid ripple address"],
      [`?addresses=${NP},`, "invalid ripple address"],
      [`?addresses=${classicAddressToXAddress(NP, false, false)}`, "invalid ripple address"],
      [`?addresses=${NP.slice(0, -1)}${NP.endsWith("h") ? "g" : "h"}`, "invalid ripple address"],
      [`?addresses=${NP.toLowerCase()}`, "invalid ripple address"],
      [`?addresses=${NP},%20${HARBOR}`, "invalid ripple address"],
      ["?addresses=not-an-address", "invalid ripple address"],
    ];
    for (const [query, message] of cases) {
      const answer = await names(upstream, query);
      expect(answer!.status, query).toBe(400);
      expect(answer!.headers.get("Cache-Control"), query).toBe("no-store");
      expect(await jsonOf(answer), query).toEqual({ result: "error", message });
    }
  });

  it("is replaced for every names call by an override keyed `GET /v2/account_names` without a query, and an override of the exact key wins over it", async () => {
    const failing = make({ "GET /v2/account_names": dataApiError(503, "unavailable") });
    for (const query of [`?addresses=${NP}`, `?addresses=${HARBOR},${NP}`, "?addresses=nope", ""]) {
      const answer = await names(failing, query);
      expect(answer!.status, query).toBe(503);
      expect(await jsonOf(answer), query).toEqual({ result: "error", message: "unavailable" });
    }
    expect(failing.requests.every((request) => request.source === "override")).toBe(true);
    expect(failing.unusedOverrides()).toEqual([]);
    // only the network it is keyed for
    expect((await names(failing, `?addresses=${TW}`, "xahau"))!.status).toBe(200);

    const exact = { result: "success", count: 1, account_names: [{ address: NP, display_name: { text: "Override", kind: "account" }, account_name: "Override" }] };
    const both = make({ "GET /v2/account_names": dataApiError(503, "unavailable"), [`GET /v2/account_names?addresses=${NP}`]: exact });
    expect(await jsonOf(await names(both, `?addresses=${NP}`))).toEqual(exact);
    expect((await names(both, `?addresses=${HARBOR}`))!.status).toBe(503);
    expect(both.unusedOverrides()).toEqual([]);

    // an exact key alone leaves every other names call to the composition
    const one = make({ [`GET /v2/account_names?addresses=${NP}`]: exact });
    expect(await jsonOf(await names(one, `?addresses=${HARBOR}`))).toEqual({ result: "success", count: 1, account_names: [HARBOR_ENTRY] });
  });

  it("answers a toml from its file, and a domain with none `toml not found`", async () => {
    const upstream = make();
    const get = (path: string) => upstream.handle(new Request(`http://fixtures.test/xrpl${path}`, { headers: { "X-API-Key": "k" } }));
    expect(await jsonOf(await get("/v2/toml/northpeak.example"))).toEqual(TOML);
    const missing = await get("/v2/toml/nope.example");
    expect(missing!.status).toBe(404);
    expect(await jsonOf(missing)).toEqual({ result: "error", message: "toml not found" });
    // a `null` override is the same "absent" answer; the route has nothing below a domain, and `/v2/toml` alone is no route
    expect(await jsonOf(await make({ "GET /v2/toml/northpeak.example": null }).handle(new Request("http://fixtures.test/xrpl/v2/toml/northpeak.example", { headers: { "X-API-Key": "k" } })))).toEqual({
      result: "error",
      message: "toml not found",
    });
    expect(await jsonOf(await get("/v2/toml"))).toEqual({ result: "error", message: "Cannot GET /v2/toml" });
    expect(await jsonOf(await get("/v2/toml/northpeak.example/accounts"))).toEqual({ result: "error", message: "Cannot GET /v2/toml/northpeak.example/accounts" });
  });
});

describe("D9's MPT routes, as the mock answers them", () => {
  const A = "03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80";
  const B = "05AC2E9BD957F450A34D46B9F70983D04DB415D20EC3A1DF";
  const C = "0663EACAC1E295FCE4BA9E9ECD5EC0E84C5089AEE6B00E65";
  const SUMMARY_A = { mpt_issuance_id: A, issuer: "rBEERdzDHqDyYmfw2jqzyMNBZu31yzfg6q", asset_scale: 4, outstanding_amount: "1", holders: 1, transfer_fee: 0, flags: { locked: false }, destroyed: false };
  const store = new Map<string, string>([
    [`xrpl/data-api/mpt/${A}.json`, '{"result":"success","issuance":{"mpt_issuance_id":"' + A + '"}}'],
    ["xrpl/data-api/mpt_lookup.json", JSON.stringify({ [A]: SUMMARY_A })],
    [`xrpl/node/ledger_entry/mpt_issuance_${B}.json`, '{"result":{"index":"K","node":{"LedgerEntryType":"MPTokenIssuance"},"validated":true,"status":"success"}}'],
  ]);
  const bases: UpstreamBases = {
    xrpl: { dataApi: "http://fixtures.test/xrpl", node: "http://fixtures.test/xrpl-node" },
    xahau: { dataApi: "http://fixtures.test/xahau", node: "http://fixtures.test/xahau-node" },
  };
  const make = (overrides = {}) => createUpstream({ files: { read: async (path) => store.get(path) }, bases, primary: "xrpl", overrides });
  const api = (upstream: ReturnType<typeof make>, path: string, net = "xrpl") => upstream.handle(new Request(`http://fixtures.test/${net}${path}`, { headers: { "X-API-Key": "k" } }));
  const lookup = (upstream: ReturnType<typeof make>, ids: string, net = "xrpl") => api(upstream, `/v2/mpt?ids=${ids}`, net);

  it("makes the subject of a ledger_entry asked by mpt_issuance `mpt_issuance_<ID>` in upper case, and names its file by it, with no other parameter in the name", () => {
    const request = { mpt_issuance: B.toLowerCase(), ledger_index: "validated" };
    expect(nodeSubject("ledger_entry", request)).toBe(`mpt_issuance_${B}`);
    // The exact key keeps the parameter as it was asked (only a 64-digit hash is upper-cased there: the client asks for an ID in upper case), the subject's is the ID's.
    expect(nodeKeys("ledger_entry", { ...request, mpt_issuance: B })).toEqual([`node ledger_entry ledger_index=validated&mpt_issuance=${B}`, `node ledger_entry mpt_issuance_${B}`]);
    expect(nodeKeys("ledger_entry", request)[1]).toBe(`node ledger_entry mpt_issuance_${B}`);
    expect(nodeFile("xrpl", "ledger_entry", request)).toBe(`xrpl/node/ledger_entry/mpt_issuance_${B}.json`);
    // An entry asked by index keeps its own subject, and an ID that is no safe piece is no file.
    expect(nodeSubject("ledger_entry", { index: URI_TOKEN, ledger_index: "validated" })).toBe(URI_TOKEN);
    expect(nodeFile("xrpl", "ledger_entry", { mpt_issuance: "../../package" })).toBeUndefined();
  });

  it("answers an issuance from its file, and an issuance with none, with its holders and its transfers, 404 `issuance not found` (every ID is that on a network without MPT); an ID that is no 48 digits is a 400", async () => {
    const upstream = make();
    expect(await jsonOf(await api(upstream, `/v2/mpt/${A}`))).toMatchObject({ result: "success" });
    for (const path of [`/v2/mpt/${B}`, `/v2/mpt/${B}/holders`, `/v2/mpt/${B}/transfers`]) {
      const answer = await api(upstream, `${path}?limit=10`);
      expect(answer!.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ result: "error", message: "issuance not found" });
    }
    expect((await api(upstream, `/v2/mpt/${A}`, "xahau"))!.status).toBe(404);
    for (const path of ["/v2/mpt/xyz", `/v2/mpt/${A.slice(1)}`, `/v2/mpt/${A}0/holders`]) {
      const answer = await api(upstream, path);
      expect([answer!.status, (await jsonOf(answer)).message], path).toEqual([400, "invalid mpt issuance id"]);
    }
    // Nothing else is below an issuance.
    expect(await jsonOf(await api(upstream, `/v2/mpt/${A}/history`))).toEqual({ result: "error", message: `Cannot GET /v2/mpt/${A}/history` });
    // A `null` override is the same absent answer.
    expect(await jsonOf(await api(make({ [`GET /v2/mpt/${A}`]: null }), `/v2/mpt/${A}`))).toEqual({ result: "error", message: "issuance not found" });
  });

  it("answers a ledger_entry by mpt_issuance from its file, and one with none with entryNotFound, at HTTP 200", async () => {
    const upstream = make();
    const ask = (id: string) => upstream.handle(new Request("http://fixtures.test/xrpl-node", { method: "POST", body: JSON.stringify({ method: "ledger_entry", params: [{ mpt_issuance: id, ledger_index: "validated" }] }) }));
    expect((await jsonOf(await ask(B))).result).toMatchObject({ index: "K", validated: true, status: "success" });
    const missing = await ask(C);
    expect(missing!.status).toBe(200);
    expect((await jsonOf(missing)).result).toMatchObject({ error: "entryNotFound", status: "error" });
    // An override keyed by the subject wins, as for any node request.
    const overridden = make({ [`node ledger_entry mpt_issuance_${C}`]: { index: "O", node: { LedgerEntryType: "MPTokenIssuance" }, validated: true, status: "success" } });
    expect((await jsonOf(await overridden.handle(new Request("http://fixtures.test/xrpl-node", { method: "POST", body: JSON.stringify({ method: "ledger_entry", params: [{ mpt_issuance: C, ledger_index: "validated" }] }) })))).result.index).toBe("O");
    expect(overridden.unusedOverrides()).toEqual([]);
  });

  it("answers `GET /v2/mpt?ids=` as D9 does: one entry for each ID in the order asked, a repeated one at each place, the network's summary or the ID alone, with the count and the IDs in upper case", async () => {
    const upstream = make();
    const answer = await lookup(upstream, `${B},${A.toLowerCase()},${C},${A}`);
    expect(answer!.status).toBe(200);
    const body = await jsonOf(answer);
    expect(Object.keys(body)).toEqual(["result", "count", "issuances"]);
    expect(body).toEqual({ result: "success", count: 4, issuances: [{ mpt_issuance_id: B }, SUMMARY_A, { mpt_issuance_id: C }, SUMMARY_A] });
    // The table is the network's: Xahau has none, so every ID is the ID alone.
    expect(await jsonOf(await lookup(upstream, A, "xahau"))).toEqual({ result: "success", count: 1, issuances: [{ mpt_issuance_id: A }] });
  });

  it("answers D9's three 400s of the lookup, in D9's order: ids missing or empty, more than 100 whatever they are, an element that is not 48 hex digits (an empty one too)", async () => {
    const upstream = make();
    const body = async (path: string) => [(await api(upstream, path))!.status, (await jsonOf(await api(upstream, path))).message];
    expect(await body("/v2/mpt")).toEqual([400, "ids is required"]);
    expect(await body("/v2/mpt?ids=")).toEqual([400, "ids is required"]);
    expect(await body(`/v2/mpt?ids=${Array.from({ length: 101 }, () => "x").join(",")}`)).toEqual([400, "too many ids"]);
    expect(await body(`/v2/mpt?ids=${Array.from({ length: 101 }, () => A).join(",")}`)).toEqual([400, "too many ids"]);
    for (const ids of [`${A},xyz`, `${A},`, `,${A}`, `${A},${A}0`, `${A} `]) expect(await body(`/v2/mpt?ids=${encodeURIComponent(ids)}`), ids).toEqual([400, "invalid mpt issuance id"]);
    // 100 is the limit.
    expect((await api(upstream, `/v2/mpt?ids=${Array.from({ length: 100 }, () => A).join(",")}`))!.status).toBe(200);
  });

  it("takes an override of the exact request over the composition, and a `null` override is the route's absent answer: a missing route, as the lookup has no 404", async () => {
    const exact = { result: "success", count: 1, issuances: [{ mpt_issuance_id: A, overridden: true }] };
    const upstream = make({ [`GET /v2/mpt?ids=${A}`]: exact });
    expect(await jsonOf(await lookup(upstream, A))).toEqual(exact);
    expect(await jsonOf(await lookup(upstream, `${A},${B}`))).toMatchObject({ count: 2 });
    expect(upstream.unusedOverrides()).toEqual([]);
    expect(await jsonOf(await lookup(make({ [`GET /v2/mpt?ids=${A}`]: null }), A))).toEqual({ result: "error", message: "Cannot GET /v2/mpt" });
    // The comma may be written escaped, as a client's URL writes it.
    expect(await jsonOf(await lookup(make(), `${A}%2C${B}`))).toMatchObject({ count: 2 });
  });
});
