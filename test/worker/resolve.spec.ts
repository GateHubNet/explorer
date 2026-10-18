import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { encodeCtid } from "../../app/domain/ctid";
import { createDataApi, UpstreamError } from "../../app/server/data-api";
import type { Env } from "../../app/server/env";
import { networkOf, type NetworkId } from "../../app/server/networks";
import { createNodeRpc } from "../../app/server/node-rpc";
import { findHash, resolveCtid } from "../../app/server/resolve";
import { recordedHashes } from "../support/ledger-hashes";
import { passThroughCache } from "../support/subrequest-cache";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// `resolveCtid` (spec 3): a CTID to the hash of the transaction at that place, and `findHash` (spec 6, 10): what a 64-digit hash
// names, against the recorded answers of the data API and the nodes (test/fixtures/http/). Recorded with their transactions'
// hashes: XRPL 107720688 (66 transactions) and Xahau 26540187 (16). Neither function goes through the Worker, so the clients
// here use a cache that remembers nothing and the order of the tests does not matter.

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const XRPL_NETWORK_ID = 0;
const XAHAU_NETWORK_ID = 21337;

function clientFor(net: NetworkId) {
  const network = networkOf(net, env as unknown as Env);
  return { network, api: createDataApi(network, env as unknown as Env, passThroughCache) };
}

function nodeFor(net: NetworkId) {
  return { node: createNodeRpc(networkOf(net, env as unknown as Env), passThroughCache) };
}

describe("resolveCtid: when the upstream fails", () => {
  // These ledgers are not in the fixtures, so the answer is the override's alone.
  it.each([
    ["the data API is down", dataApiError(503, "unavailable"), "server"],
    ["the data API limits the requests", dataApiError(429, "slow down"), "rate_limited"],
    ["the data API answers something that is not a ledger", new Response("<html>", { status: 502 }), "server"],
  ] as const)("lets the failure through when %s", async (_what, answer, kind) => {
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107600001?transactions=true": answer });
    const { api, network } = clientFor("xrpl");
    const failure = await resolveCtid(api, network, encodeCtid(107600001, 0, XRPL_NETWORK_ID)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe(kind);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("resolveCtid: a CTID of the network asked", () => {
  it("returns the hash at the transaction's place in the ledger", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 107720688);
    const { api, network } = clientFor("xrpl");

    for (const place of [0, 1, 17, 65]) {
      expect(await resolveCtid(api, network, encodeCtid(107720688, place, XRPL_NETWORK_ID))).toEqual({ hash: hashes[place] });
    }
  });

  it("reads one ledger with its hashes, and nothing else", async () => {
    mock = mockUpstream("xrpl");
    const { api, network } = clientFor("xrpl");

    await resolveCtid(api, network, encodeCtid(107720688, 2, XRPL_NETWORK_ID));
    expect(mock.requests.map((request) => request.key)).toEqual(["GET /v2/ledgers/107720688?transactions=true"]);
  });

  it("resolves a Xahau CTID on Xahau", async () => {
    mock = mockUpstream("xahau");
    const hashes = await recordedHashes("xahau", 26540187);
    const { api, network } = clientFor("xahau");

    expect(hashes).toHaveLength(16);
    expect(await resolveCtid(api, network, encodeCtid(26540187, 15, XAHAU_NETWORK_ID))).toEqual({ hash: hashes[15] });
  });

  it("takes a CTID in lower case", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 107720688);
    const { api, network } = clientFor("xrpl");

    expect(await resolveCtid(api, network, encodeCtid(107720688, 5, XRPL_NETWORK_ID).toLowerCase())).toEqual({ hash: hashes[5] });
  });

  it("returns the hash in upper case, the one form an object has in a URL", async () => {
    const lower = "ab".repeat(32);
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107600002?transactions=true": { result: "success", ledger: { ledger_index: 107600002, transactions: [lower] } },
    });
    const { api, network } = clientFor("xrpl");

    expect(await resolveCtid(api, network, encodeCtid(107600002, 0, XRPL_NETWORK_ID))).toEqual({ hash: lower.toUpperCase() });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("returns null for an index past the end of the ledger", async () => {
    mock = mockUpstream("xrpl");
    const { api, network } = clientFor("xrpl");

    expect(await resolveCtid(api, network, encodeCtid(107720688, 66, XRPL_NETWORK_ID))).toBeNull();
    expect(await resolveCtid(api, network, encodeCtid(107720688, 65535, XRPL_NETWORK_ID))).toBeNull();
  });

  it("returns null for a ledger the data API does not have", async () => {
    mock = mockUpstream("xrpl");
    const { api, network } = clientFor("xrpl");

    expect(await resolveCtid(api, network, encodeCtid(107600003, 0, XRPL_NETWORK_ID))).toBeNull();
  });

  it("returns null for a ledger with no transactions", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107600004?transactions=true": { result: "success", ledger: { ledger_index: 107600004, transactions: [] } },
    });
    const { api, network } = clientFor("xrpl");

    expect(await resolveCtid(api, network, encodeCtid(107600004, 0, XRPL_NETWORK_ID))).toBeNull();
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("returns null when the data API refuses the ledger index as malformed", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/0?transactions=true": dataApiError(400, "invalid ledger parameter") });
    const { api, network } = clientFor("xrpl");

    expect(await resolveCtid(api, network, encodeCtid(0, 0, XRPL_NETWORK_ID))).toBeNull();
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("returns null for text that is not a CTID, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    const { api, network } = clientFor("xrpl");

    for (const text of ["", "hello", "C66B4E2C000C000", "D66B4E2C000C0000", "C66B4E2C000C00000"]) {
      expect(await resolveCtid(api, network, text)).toBeNull();
    }
    expect(mock.requests).toEqual([]);
  });
});

describe("resolveCtid: a CTID of the other network", () => {
  it("names the network a Xahau CTID belongs to when asked on XRPL, and asks nobody", async () => {
    mock = mockUpstream("xrpl");
    const { api, network } = clientFor("xrpl");

    expect(await resolveCtid(api, network, encodeCtid(26540187, 3, XAHAU_NETWORK_ID))).toEqual({ otherNetwork: "xahau" });
    expect(mock.requests).toEqual([]);
  });

  it("names XRPL when an XRPL CTID is asked on Xahau", async () => {
    mock = mockUpstream("xahau");
    const { api, network } = clientFor("xahau");

    expect(await resolveCtid(api, network, encodeCtid(107720688, 3, XRPL_NETWORK_ID))).toEqual({ otherNetwork: "xrpl" });
    expect(mock.requests).toEqual([]);
  });
});

describe("resolveCtid: a CTID of no network the explorer covers", () => {
  // A testnet is 1, the other XRPL test networks and the sidechains have ids of their own: never taken for XRPL or Xahau.
  it.each([1, 2, 1337, 21336, 21338, 65535])("returns null for the network id %i on either network, without asking anyone", async (networkId) => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(107720688, 3, networkId);

    for (const net of ["xrpl", "xahau"] as const) {
      const { api, network } = clientFor(net);
      expect(await resolveCtid(api, network, ctid)).toBeNull();
    }
    expect(mock.requests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------

// A recorded XRPL transaction (ledger 107671593, an AccountDelete) and the hash of a recorded XRPL ledger, 107720688.
const TX_HASH = "8F2DCA944394B29981E24DDD6C46192C404D90F7F5FC4EAB6813B0AFD7751A2D";
const LEDGER_HASH = "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02";
const UNKNOWN_HASH = "0D".repeat(32);

/** The keys of the requests a mock has answered. */
const asked = (m: UpstreamMock) => m.requests.map((request) => request.key);

describe("findHash: when the upstream fails", () => {
  it("lets the failure of the data API through when it leaves the question open, and does not ask the node in its place", async () => {
    const hash = "0E".repeat(32);
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: dataApiError(503, "unavailable") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
    // Both data API calls were made and waited for, the node's were not.
    expect(asked(mock).sort()).toEqual([`GET /v2/ledgers/${hash}`, `GET /v2/transactions/${hash}`].sort());
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("lets the failure of the node through when the data API has neither", async () => {
    const hash = "0F".repeat(32);
    mock = mockUpstream("xrpl", { [`node tx ${hash}`]: new Response("busy", { status: 503 }) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers with what was found when the other call failed", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/ledgers/${TX_HASH}`]: dataApiError(500, "boom") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("findHash", () => {
  it("finds a transaction", async () => {
    mock = mockUpstream("xrpl");
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(asked(mock).sort()).toEqual([`GET /v2/ledgers/${TX_HASH}`, `GET /v2/transactions/${TX_HASH}`].sort());
  });

  it("finds a ledger", async () => {
    mock = mockUpstream("xrpl");
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, LEDGER_HASH)).toEqual({ ledger: { index: 107720688, closeTime: 1792253462 } });
  });

  it("finds both when the data API has both", async () => {
    const hash = "AB".repeat(32);
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: {
        result: "success",
        transaction: { hash, ledger_index: 107600010, date: "2026-10-17T16:11:02+00:00", tx: { TransactionType: "Payment" }, meta: {} },
      },
      [`GET /v2/ledgers/${hash}`]: { result: "success", ledger: { ledger_index: 107600011, close_time: 1792253000 } },
    });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash)).toEqual({
      tx: { ledgerIndex: 107600010, type: "Payment" },
      ledger: { index: 107600011, closeTime: 1792253000 },
    });
    expect(mock.unusedOverrides()).toEqual([]);
    expect(mock.requests.filter((request) => request.kind === "node")).toEqual([]);
  });

  it("asks the node when the data API has neither, and finds a transaction there", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${TX_HASH}`]: null, [`GET /v2/ledgers/${TX_HASH}`]: null });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(mock.requests.filter((request) => request.kind === "node").map((request) => request.key.split(" ")[1])).toEqual(
      expect.arrayContaining(["tx", "ledger"]),
    );
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("asks the node when the data API has neither, and finds a ledger there", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/ledgers/${LEDGER_HASH}`]: null });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, LEDGER_HASH)).toEqual({ ledger: { index: 107720688, closeTime: 1792253462 } });
    expect(mock.requests.some((request) => request.kind === "node")).toBe(true);
  });

  it("finds nothing for a hash that neither the data API nor the node has", async () => {
    mock = mockUpstream("xrpl");
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, UNKNOWN_HASH)).toEqual({});
    expect(mock.requests.map((request) => request.kind).sort()).toEqual(["data-api", "data-api", "node", "node"]);
  });
});
