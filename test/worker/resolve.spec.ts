import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { encodeCtid } from "../../app/domain/ctid";
import { createDataApi, UpstreamError, type DataApi } from "../../app/server/data-api";
import type { LedgerObjectRef } from "../../app/server/api-types";
import type { Env } from "../../app/server/env";
import { networkOf, type NetworkId } from "../../app/server/networks";
import { createNodeRpc } from "../../app/server/node-rpc";
import { findHash, resolveCtid } from "../../app/server/resolve";
import { recordedHashes } from "../support/ledger-hashes";
import { passThroughCache } from "../support/subrequest-cache";
import { nftAnswerSample, nftSample, NFT_ISSUER, uriTokenSample, URI_TOKEN_ISSUER } from "../support/nft-samples";
import { DELEGATOR, ESCROW_OWNER, ledgerObjectSample } from "../support/object-samples";
import { dataApiError, mockUpstream, nodeError, type Overrides, type UpstreamMock } from "../support/upstream";

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

describe("resolveCtid: when the ledger lists something that is not a transaction hash", () => {
  // The hash goes into the Location of a redirect and the path of a page: it must be 64 hex digits, or it is the upstream's fault
  // (a failure, never stored), not a transaction that does not exist (a 404, stored for 30 s).
  it.each([
    ["text", "not-a-hash"],
    ["a hash of 63 digits", "AB".repeat(31) + "A"],
    ["a hash of 66 digits", "AB".repeat(33)],
    ["a path", "../../etc/passwd"],
    ["a hash with a non-hex digit", `${"AB".repeat(31)}ZZ`],
    ["an empty string", ""],
    ["a number", 17],
    ["null", null],
  ])("lets %s through as an upstream failure", async (_what, entry) => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107600005?transactions=true": { result: "success", ledger: { ledger_index: 107600005, transactions: [entry] } },
    });
    const { api, network } = clientFor("xrpl");
    const failure = await resolveCtid(api, network, encodeCtid(107600005, 0, XRPL_NETWORK_ID)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("lets a list that is not a list through as an upstream failure", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107600006?transactions=true": { result: "success", ledger: { ledger_index: 107600006, transactions: "oops" } },
    });
    const { api, network } = clientFor("xrpl");
    const failure = await resolveCtid(api, network, encodeCtid(107600006, 0, XRPL_NETWORK_ID)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
  });

  it("fails the whole answer for a bad entry anywhere in the list: the client checks the list it stores, which lasts a year", async () => {
    const good = "CD".repeat(32);
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107600007?transactions=true": { result: "success", ledger: { ledger_index: 107600007, transactions: [good, "junk"] } },
    });
    const { api, network } = clientFor("xrpl");
    const failure = await resolveCtid(api, network, encodeCtid(107600007, 0, XRPL_NETWORK_ID)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
  });

  it("still answers null for an index past the end of the list", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107600008?transactions=true": { result: "success", ledger: { ledger_index: 107600008, transactions: ["CD".repeat(32)] } },
    });
    const { api, network } = clientFor("xrpl");
    expect(await resolveCtid(api, network, encodeCtid(107600008, 1, XRPL_NETWORK_ID))).toBeNull();
  });

  // The client keeps such lists out of the cache, so a real client never gives them. `resolveCtid` takes any `DataApi`, and the
  // hash goes into a redirect and a path: it checks the one it takes whatever it was given.
  describe("whatever client it is given", () => {
    const given = (transactions: unknown) => ({ ledger: async () => ({ ledger_index: 107600009, transactions }) }) as unknown as DataApi;

    it.each([["text", "not-a-hash"], ["a path", "../../etc/passwd"], ["63 digits", "AB".repeat(31) + "A"], ["a number", 17], ["null", null]])(
      "throws for %s at the CTID's place",
      async (_what, entry) => {
        const { network } = clientFor("xrpl");
        const failure = await resolveCtid(given([entry]), network, encodeCtid(107600009, 0, XRPL_NETWORK_ID)).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(UpstreamError);
        expect((failure as UpstreamError).kind).toBe("server");
      },
    );

    it("throws for a list that is not a list", async () => {
      const { network } = clientFor("xrpl");
      const failure = await resolveCtid(given("oops"), network, encodeCtid(107600009, 0, XRPL_NETWORK_ID)).catch((error: unknown) => error);
      expect((failure as UpstreamError).kind).toBe("server");
    });

    it("does not look at the entries it does not take", async () => {
      const { network } = clientFor("xrpl");
      expect(await resolveCtid(given(["CD".repeat(32), "junk"]), network, encodeCtid(107600009, 0, XRPL_NETWORK_ID))).toEqual({ hash: "CD".repeat(32) });
      expect(await resolveCtid(given(["junk"]), network, encodeCtid(107600009, 1, XRPL_NETWORK_ID))).toBeNull();
    });
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
/** What `findHash` asks while `NFTS` is off (the questions of before E8): the transaction and the ledger. The NFT cases are below. */
const ASKING = { net: "xrpl", nfts: false, ledgerObjects: false } as const;

/** The keys of the requests a mock has answered. */
const asked = (m: UpstreamMock) => m.requests.map((request) => request.key);

describe("findHash: when the upstream fails", () => {
  it("lets the failure of the data API through when it leaves the question open, and does not ask the node in its place", async () => {
    const hash = "0E".repeat(32);
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: dataApiError(503, "unavailable") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, ASKING).catch((error: unknown) => error);
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

    const failure = await findHash(api, node, hash, ASKING).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
    expect(mock.unusedOverrides()).toEqual([]);
  });

  // A 200 without the transaction in it (a proxy's page, a changed API) is the upstream's failure, not a TypeError that becomes a 500.
  it.each([
    ["no tx at all", { hash: "TXH", ledger_index: 107600011, date: "2026-10-17T16:11:02+00:00" }],
    ["a tx that is not an object", { hash: "TXH", ledger_index: 107600011, tx: "Payment" }],
    ["a tx without a type", { hash: "TXH", ledger_index: 107600011, tx: { Account: "rX" } }],
    ["a tx whose type is not text", { hash: "TXH", ledger_index: 107600011, tx: { TransactionType: 7 } }],
    ["a tx that is null", { hash: "TXH", ledger_index: 107600011, tx: null }],
  ])("counts a 200 with %s as an upstream failure, and does not ask the node in its place", async (_what, transaction) => {
    const hash = "1F".repeat(32);
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: { result: "success", transaction } });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, ASKING).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
    expect(mock.requests.filter((request) => request.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("counts a transaction of the node without a type as an upstream failure (the node client reads less of it)", async () => {
    const hash = "1D".repeat(32);
    mock = mockUpstream("xrpl", {
      [`node tx ${hash}`]: {
        status: "success",
        validated: true,
        ledger_index: 107600020,
        date: 845378370,
        hash,
        Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh",
        Fee: "10",
        meta: { TransactionIndex: 1, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
      },
    });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, ASKING).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers with the ledger when the transaction call came back without a transaction in it", async () => {
    const hash = "1E".repeat(32);
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: { result: "success", transaction: { hash, ledger_index: 107600012 } },
      [`GET /v2/ledgers/${hash}`]: { result: "success", ledger: { ledger_index: 107600013, close_time: 1792253000 } },
    });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, ASKING)).toEqual({ ledger: { index: 107600013, closeTime: 1792253000 } });
  });

  it("answers with what was found when the other call failed", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/ledgers/${TX_HASH}`]: dataApiError(500, "boom") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH, ASKING)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("findHash", () => {
  it("finds a transaction", async () => {
    mock = mockUpstream("xrpl");
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH, ASKING)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(asked(mock).sort()).toEqual([`GET /v2/ledgers/${TX_HASH}`, `GET /v2/transactions/${TX_HASH}`].sort());
  });

  it("finds a ledger", async () => {
    mock = mockUpstream("xrpl");
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, LEDGER_HASH, ASKING)).toEqual({ ledger: { index: 107720688, closeTime: 1792253462 } });
  });

  it("finds both when the data API has both", async () => {
    const hash = "AB".repeat(32);
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: {
        result: "success",
        transaction: {
          hash,
          ledger_index: 107600010,
          date: "2026-10-17T16:11:02+00:00",
          tx: { TransactionType: "Payment", Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" },
          meta: { TransactionIndex: 3, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
        },
      },
      [`GET /v2/ledgers/${hash}`]: { result: "success", ledger: { ledger_index: 107600011, close_time: 1792253000 } },
    });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, ASKING)).toEqual({
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

    expect(await findHash(api, node, TX_HASH, ASKING)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(mock.requests.filter((request) => request.kind === "node").map((request) => request.key.split(" ")[1])).toEqual(
      expect.arrayContaining(["tx", "ledger"]),
    );
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("asks the node when the data API has neither, and finds a ledger there", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/ledgers/${LEDGER_HASH}`]: null });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, LEDGER_HASH, ASKING)).toEqual({ ledger: { index: 107720688, closeTime: 1792253462 } });
    expect(mock.requests.some((request) => request.kind === "node")).toBe(true);
  });

  it("finds nothing for a hash that neither the data API nor the node has", async () => {
    mock = mockUpstream("xrpl");
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, UNKNOWN_HASH, ASKING)).toEqual({});
    expect(mock.requests.map((request) => request.kind).sort()).toEqual(["data-api", "data-api", "node", "node"]);
  });
});

// ---- With NFTs (NFT spec 7, Review Focus 3) -------------------------------------------------------------------------------------------------------------------

// The sequence's own rules, against the questions of `NFTS` on: the index is asked side by side for the transaction, the ledger and the NFT; only when it found none of them, and
// none of its questions failed, the node is asked side by side for the same three (XRPL's `nft_info`, Xahau's `ledger_entry` of a URIToken). A found answer wins over another
// question's failure, and the node is never asked in place of a failed index.

const NFTS = { net: "xrpl", nfts: true, ledgerObjects: false } as const;
const XAHAU_NFTS = { net: "xahau", nfts: true, ledgerObjects: false } as const;

/** A hash of its own for each test: the mock answers "not found" for it unless a test says otherwise. */
let made = 0;
const fresh = () => `5A${(++made).toString(16).toUpperCase().padStart(2, "0")}`.padEnd(64, "C");

/** The data API's answer for `hash` as a transaction (ledger `ledgerIndex`), as a ledger (`ledgerIndex + 1`), as an NFT (or a URIToken) with the fields `over` overrides. */
const asTransaction = (hash: string, ledgerIndex = 107600010): Overrides => ({
  [`GET /v2/transactions/${hash}`]: {
    result: "success",
    transaction: {
      hash,
      ledger_index: ledgerIndex,
      date: "2026-10-17T16:11:02+00:00",
      tx: { TransactionType: "Payment", Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" },
      meta: { TransactionIndex: 3, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
    },
  },
});
const asLedger = (hash: string, ledgerIndex = 107600011): Overrides => ({
  [`GET /v2/ledgers/${hash}`]: { result: "success", ledger: { ledger_index: ledgerIndex, close_time: 1792253000 } },
});
const asIndexedNft = (hash: string, over: Parameters<typeof nftSample>[0] = {}): Overrides => ({
  [`GET /v2/nfts/${hash}`]: nftAnswerSample({ nft: nftSample({ nft_id: hash, ...over }) }),
});
const asIndexedUriToken = (hash: string, over: Parameters<typeof uriTokenSample>[0] = {}): Overrides => ({
  [`GET /v2/nfts/${hash}`]: nftAnswerSample({ nft: uriTokenSample({ nft_id: hash, ...over }) }),
});
/** What Clio's `nft_info` says of an NFT, and what xahaud's `ledger_entry` says of a URIToken. */
const asClioNft = (hash: string, over: Record<string, unknown> = {}): Overrides => ({
  [`node nft_info ${hash}`]: {
    nft_id: hash,
    ledger_index: 107886163,
    owner: "r4Xgqy68ykjLEJAkFQ7EaFs8VEdSiWkSeX",
    is_burned: false,
    flags: 8,
    transfer_fee: 5000,
    issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu",
    nft_taxon: 500,
    nft_serial: 106293080,
    status: "success",
    validated: true,
    ...over,
  },
});
const asUriTokenEntry = (hash: string): Overrides => ({
  [`node ledger_entry ${hash}`]: {
    index: hash,
    ledger_index: 26774724,
    node: { Flags: 0, Issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb", LedgerEntryType: "URIToken", Owner: "rAucmWmE8yiueemhmrGh5MyD2mNjXfpQp", URI: "6F64696E", index: hash },
    status: "success",
    validated: true,
  },
});

/** The requests of a kind, as the mock names them. */
const asked2 = (m: UpstreamMock, kind: "data-api" | "node") => m.requests.filter((request) => request.kind === kind).map((request) => request.key);

describe("findHash with NFTs: what the index has", () => {
  it("finds an NFT that is neither a transaction nor a ledger, and does not ask the node", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedNft(hash));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({ nft: { kind: "nftoken", issuer: NFT_ISSUER, taxon: 10, serial: 95234705, burned: false } });
    expect(asked2(mock, "data-api").sort()).toEqual([`GET /v2/ledgers/${hash}`, `GET /v2/nfts/${hash}`, `GET /v2/transactions/${hash}`].sort());
    expect(asked2(mock, "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("says that an NFT is burned", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedNft(hash, { burned: true, owner: undefined, burned_at: { ledger_index: 107886000, tx_hash: "AB".repeat(32), executed_time: "2026-10-24T16:08:12Z", by: NFT_ISSUER } }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({ nft: { kind: "nftoken", issuer: NFT_ISSUER, taxon: 10, serial: 95234705, burned: true } });
  });

  it("finds a URIToken of Xahau by its issuer alone: it has no taxon and no serial", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", asIndexedUriToken(hash));
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_NFTS)).toEqual({ nft: { kind: "uritoken", issuer: URI_TOKEN_ISSUER, burned: false } });
  });

  it("finds a transaction that is also an NFT: both", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asTransaction(hash), ...asIndexedNft(hash) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({
      tx: { ledgerIndex: 107600010, type: "Payment" },
      nft: { kind: "nftoken", issuer: NFT_ISSUER, taxon: 10, serial: 95234705, burned: false },
    });
    expect(asked2(mock, "node")).toEqual([]);
  });

  it("finds a transaction, a ledger and an NFT: all three", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asTransaction(hash), ...asLedger(hash), ...asIndexedNft(hash) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({
      tx: { ledgerIndex: 107600010, type: "Payment" },
      ledger: { index: 107600011, closeTime: 1792253000 },
      nft: { kind: "nftoken", issuer: NFT_ISSUER, taxon: 10, serial: 95234705, burned: false },
    });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("does not ask the node for an NFT the index has without an owner: it is found, and its page reads the owner", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedNft(hash, { owner: undefined, owner_since: undefined }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toMatchObject({ nft: { burned: false } });
    expect(asked2(mock, "node")).toEqual([]);
  });
});

describe("findHash with NFTs: when the index fails (Review Focus 3)", () => {
  it("answers with what was found when the NFT question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asTransaction(hash), [`GET /v2/nfts/${hash}`]: dataApiError(503, "unavailable") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({ tx: { ledgerIndex: 107600010, type: "Payment" } });
    expect(asked2(mock, "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers with the NFT when the transaction question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asIndexedNft(hash), [`GET /v2/transactions/${hash}`]: dataApiError(500, "boom") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toMatchObject({ nft: { kind: "nftoken" } });
    expect(asked2(mock, "node")).toEqual([]);
  });

  it.each([
    ["a 503", dataApiError(503, "unavailable"), "server"],
    ["a 429", dataApiError(429, "slow down"), "rate_limited"],
    ["a data API without D3 ('Cannot GET')", dataApiError(404, "Cannot GET /v2/nfts/HASH"), "server"],
    ["a 200 that is no NFT", { result: "success", coverage: { complete: true }, nft: "none" }, "server"],
  ])("throws when the NFT question failed with %s and nothing else was found, and does not ask the node in its place", async (_what, answer, kind) => {
    const hash = fresh();
    // The node has the NFT: the visitor must not be sent to it while the index could not say.
    mock = mockUpstream("xrpl", { ...asClioNft(hash), [`GET /v2/nfts/${hash}`]: answer });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, NFTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe(kind);
    expect(asked2(mock, "data-api").sort()).toEqual([`GET /v2/ledgers/${hash}`, `GET /v2/nfts/${hash}`, `GET /v2/transactions/${hash}`].sort());
    expect(asked2(mock, "node")).toEqual([]);
  });

  it("throws when the transaction question failed and the NFT is not in the index, and does not ask the node for the NFT in its place", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asClioNft(hash), [`GET /v2/transactions/${hash}`]: dataApiError(503, "unavailable") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, NFTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect(asked2(mock, "node")).toEqual([]);
  });
});

describe("findHash with NFTs: what only the node has", () => {
  it("asks the node, side by side, when the index has none of the three, and finds an XRPL NFT with nft_info", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asClioNft(hash));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({ nft: { kind: "nftoken", issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu", taxon: 500, serial: 106293080, burned: false } });
    expect(asked2(mock, "data-api").sort()).toEqual([`GET /v2/ledgers/${hash}`, `GET /v2/nfts/${hash}`, `GET /v2/transactions/${hash}`].sort());
    expect(asked2(mock, "node").map((key) => key.split(" ")[1]).sort()).toEqual(["ledger", "nft_info", "tx"]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("says that the node's NFT is burned when Clio says so", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asClioNft(hash, { is_burned: true }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toMatchObject({ nft: { kind: "nftoken", burned: true } });
  });

  it("finds a Xahau URIToken with the ledger entry of its id", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", asUriTokenEntry(hash));
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_NFTS)).toEqual({ nft: { kind: "uritoken", issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb", burned: false } });
    expect(asked2(mock, "node").map((key) => key.split(" ")[1]).sort()).toEqual(["ledger", "ledger_entry", "tx"]);
    // XRPL's command is not asked of Xahau.
    expect(asked2(mock, "node").some((key) => key.includes("nft_info"))).toBe(false);
  });

  it("finds a transaction the node has and an NFT it has too: both, from the node's round", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${TX_HASH}`]: null, ...asClioNft(TX_HASH) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH, NFTS)).toEqual({
      tx: { ledgerIndex: 107671593, type: "AccountDelete" },
      nft: { kind: "nftoken", issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu", taxon: 500, serial: 106293080, burned: false },
    });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it.each(["unknownCmd", "notImpl", "objectNotFound"])("finds nothing when the node says %s of the NFT: a node that is not Clio does not know the command, which is 'not found' and no failure", async (code) => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`node nft_info ${hash}`]: nodeError(code) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({});
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("finds nothing for an entry of Xahau that is no URIToken, or none (entryNotFound)", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", { [`node ledger_entry ${hash}`]: nodeError("entryNotFound") });
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_NFTS)).toEqual({});
  });

  it("answers with the NFT when the node's transaction question failed: something found wins", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asClioNft(hash), [`node tx ${hash}`]: new Response("busy", { status: 503 }) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toMatchObject({ nft: { kind: "nftoken" } });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers with the transaction when the node's NFT question failed: something found wins", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${TX_HASH}`]: null, [`node nft_info ${TX_HASH}`]: nodeError("internal") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH, NFTS)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it.each([
    ["a node that gives nothing readable", () => new Response("not json", { status: 200 })],
    ["a node that fails at the gateway", () => new Response("bad gateway", { status: 502 })],
    ["a node that is not synced", nodeError("noNetwork")],
  ])("throws when the node's NFT question failed with %s and nothing was found", async (_what, answer) => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`node nft_info ${hash}`]: answer });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, NFTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
  });
});

describe("findHash with NFTs off", () => {
  it.each(["xrpl", "xahau"] as const)("asks no NFT question of the index or the node on %s", async (net) => {
    const hash = fresh();
    mock = mockUpstream(net);
    const { api } = clientFor(net);
    const { node } = nodeFor(net);

    expect(await findHash(api, node, hash, { net, nfts: false, ledgerObjects: false })).toEqual({});
    expect(asked2(mock, "data-api").sort()).toEqual([`GET /v2/ledgers/${hash}`, `GET /v2/transactions/${hash}`].sort());
    expect(asked2(mock, "node").map((key) => key.split(" ")[1]).sort()).toEqual(["ledger", "tx"]);
  });

  it("does not look for an NFT: the index's NFT is not found by a search that asks no NFT question", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedNft(hash));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, { net: "xrpl", nfts: false, ledgerObjects: false })).toEqual({});
    expect(asked2(mock, "data-api").some((key) => key.includes("/v2/nfts/"))).toBe(false);
  });
});

// ---- With ledger objects (E10, spec 8) ----------------------------------------------------------------------------------------------------------------------

// E10 extends the same two steps: while `ledgerObjects` the index is asked `ledgerObject(id)` beside the transaction, the ledger and the NFT; only when it has none of them, and none
// of its questions failed, the node is asked `ledgerEntry(id)` beside its others (an entry of a type the index does not track is nothing, and a node's object is never deleted). On Xahau one
// `ledger_entry` read answers the URIToken question and the object question: the node is asked once.

const OBJECTS = { net: "xrpl", nfts: false, ledgerObjects: true } as const;
const XAHAU_OBJECTS = { net: "xahau", nfts: false, ledgerObjects: true } as const;
const BOTH = { net: "xrpl", nfts: true, ledgerObjects: true } as const;
const XAHAU_BOTH = { net: "xahau", nfts: true, ledgerObjects: true } as const;

/** The data API's answer for `hash` as an object (`/v2/ledger_objects/{id}`): an escrow of `ESCROW_OWNER` unless `over` says otherwise. */
const asIndexedObject = (hash: string, over: Partial<LedgerObjectRef> = {}): Overrides => ({
  [`GET /v2/ledger_objects/${hash}`]: {
    result: "success",
    ledger_object: ledgerObjectSample({ object_id: hash, object_type: "Escrow", account: ESCROW_OWNER, deleted: false, ...over }),
  },
});
/** What the node's `ledger_entry` says of `hash`: an entry of `type` with the fields `over` adds, as the node wrote it (`Account` unless `over` says otherwise). */
const asNodeEntry = (hash: string, type: string, over: Record<string, unknown> = {}): Overrides => ({
  [`node ledger_entry ${hash}`]: {
    index: hash,
    ledger_index: 107972000,
    node: { LedgerEntryType: type, Account: ESCROW_OWNER, Flags: 0, index: hash, ...over },
    status: "success",
    validated: true,
  },
});
const objectCalls = (hash: string) => `GET /v2/ledger_objects/${hash}`;
const indexCalls = (hash: string, more: string[] = []) => [`GET /v2/ledgers/${hash}`, `GET /v2/transactions/${hash}`, ...more].sort();
const methodsOf = (m: UpstreamMock) => asked2(m, "node").map((key) => key.split(" ")[1]).sort();

describe("findHash with ledger objects: what the index has", () => {
  it("finds an escrow in the index beside a transaction miss, and does not ask the node", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedObject(hash));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({ object: { type: "Escrow", account: ESCROW_OWNER, deleted: false } });
    expect(asked2(mock, "data-api").sort()).toEqual(indexCalls(hash, [objectCalls(hash)]));
    expect(asked2(mock, "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it.each(["Check", "PayChannel", "Delegate"] as const)("finds a %s in the index, with its account", async (type) => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedObject(hash, { object_type: type, account: DELEGATOR }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({ object: { type, account: DELEGATOR, deleted: false } });
    expect(asked2(mock, "node")).toEqual([]);
  });

  it("says that an object is removed when the index says it was deleted, and still finds it", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedObject(hash, { deleted: true }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({ object: { type: "Escrow", account: ESCROW_OWNER, deleted: true } });
    expect(asked2(mock, "node")).toEqual([]);
  });

  it("finds a transaction that is also an object: both, and the node is not asked", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asTransaction(hash), ...asIndexedObject(hash, { object_type: "Check" }) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({
      tx: { ledgerIndex: 107600010, type: "Payment" },
      object: { type: "Check", account: ESCROW_OWNER, deleted: false },
    });
    expect(asked2(mock, "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("asks the object question beside the NFT's while both switches are on, side by side with the transaction and the ledger", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedObject(hash, { object_type: "PayChannel" }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, BOTH)).toEqual({ object: { type: "PayChannel", account: ESCROW_OWNER, deleted: false } });
    expect(asked2(mock, "data-api").sort()).toEqual(indexCalls(hash, [objectCalls(hash), `GET /v2/nfts/${hash}`]));
    expect(asked2(mock, "node")).toEqual([]);
  });
});

describe("findHash with ledger objects: when the index fails", () => {
  it("answers with what was found when the object question failed, and does not ask the node", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asTransaction(hash), [objectCalls(hash)]: dataApiError(503, "unavailable") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({ tx: { ledgerIndex: 107600010, type: "Payment" } });
    expect(asked2(mock, "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers with the object when the transaction question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asIndexedObject(hash), [`GET /v2/transactions/${hash}`]: dataApiError(500, "boom") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toMatchObject({ object: { type: "Escrow" } });
    expect(asked2(mock, "node")).toEqual([]);
  });

  it.each([
    ["a 503", dataApiError(503, "unavailable"), "server"],
    ["a 429", dataApiError(429, "slow down"), "rate_limited"],
    ["a data API without D5 ('Cannot GET')", dataApiError(404, "Cannot GET /v2/ledger_objects/HASH"), "server"],
    ["a 200 that is no object", { result: "success", ledger_object: "none" }, "server"],
    ["a 200 of an entry type the index does not track", { result: "success", ledger_object: { object_type: "Offer" } }, "server"],
  ])("throws when the object question failed with %s and nothing else was found, and does not ask the node in its place", async (_what, answer, kind) => {
    const hash = fresh();
    // The node has the escrow: the visitor must not be sent to it while the index could not say.
    mock = mockUpstream("xrpl", { ...asNodeEntry(hash, "Escrow"), [objectCalls(hash)]: answer });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, OBJECTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe(kind);
    expect(asked2(mock, "data-api").sort()).toEqual(indexCalls(hash, [objectCalls(hash)]));
    expect(asked2(mock, "node")).toEqual([]);
  });

  it("throws when the transaction question failed and the object is not in the index, and does not ask the node for it in its place", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asNodeEntry(hash, "Check"), [`GET /v2/transactions/${hash}`]: dataApiError(503, "unavailable") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, OBJECTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect(asked2(mock, "node")).toEqual([]);
  });
});

describe("findHash with ledger objects: what only the node has", () => {
  it("asks the node's ledger_entry beside its tx and ledger only when the index has nothing, and finds an escrow there, never deleted", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asNodeEntry(hash, "Escrow"));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({ object: { type: "Escrow", account: ESCROW_OWNER, deleted: false } });
    // The index was asked first, for all of its questions; then the node, side by side, for its three.
    expect(asked2(mock, "data-api").sort()).toEqual(indexCalls(hash, [objectCalls(hash)]));
    expect(methodsOf(mock)).toEqual(["ledger", "ledger_entry", "tx"]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it.each(["Check", "PayChannel", "Delegate"] as const)("finds a %s of the node, with the account it says", async (type) => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asNodeEntry(hash, type, { Account: DELEGATOR }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({ object: { type, account: DELEGATOR, deleted: false } });
  });

  it("does not ask the node when the index has the object: the node's entry is never read", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asIndexedObject(hash, { deleted: true }), ...asNodeEntry(hash, "Escrow", { Account: DELEGATOR }) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({ object: { type: "Escrow", account: ESCROW_OWNER, deleted: true } });
    expect(asked2(mock, "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([`node ledger_entry ${hash}`]);
  });

  it("asks the node's nft_info and ledger_entry, which are two commands, side by side with tx and ledger when both switches are on", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asNodeEntry(hash, "Check"));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, BOTH)).toEqual({ object: { type: "Check", account: ESCROW_OWNER, deleted: false } });
    expect(methodsOf(mock)).toEqual(["ledger", "ledger_entry", "nft_info", "tx"]);
  });

  it.each(["AccountRoot", "NFTokenPage", "Offer", "RippleState", "URIToken"])("counts an entry of the type %s as nothing, and is no failure", async (type) => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asNodeEntry(hash, type));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({});
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("finds nothing when the node has no entry (entryNotFound) either", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl");
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toEqual({});
    expect(asked2(mock, "data-api").sort()).toEqual(indexCalls(hash, [objectCalls(hash)]));
    expect(methodsOf(mock)).toEqual(["ledger", "ledger_entry", "tx"]);
  });

  it("finds a transaction the node has and an object it has too: both, from the node's round", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${TX_HASH}`]: null, ...asNodeEntry(TX_HASH, "Escrow") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH, OBJECTS)).toEqual({
      tx: { ledgerIndex: 107671593, type: "AccountDelete" },
      object: { type: "Escrow", account: ESCROW_OWNER, deleted: false },
    });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers with the object when the node's transaction question failed: something found wins", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asNodeEntry(hash, "Escrow"), [`node tx ${hash}`]: new Response("busy", { status: 503 }) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, OBJECTS)).toMatchObject({ object: { type: "Escrow" } });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers with the transaction when the node's object question failed: something found wins", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${TX_HASH}`]: null, [`node ledger_entry ${TX_HASH}`]: nodeError("internal") });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH, OBJECTS)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it.each([
    ["a node that gives nothing readable", () => new Response("not json", { status: 200 })],
    ["a node that fails at the gateway", () => new Response("bad gateway", { status: 502 })],
    ["a node that is not synced", nodeError("noNetwork")],
    ["an entry that is not validated", { index: "", ledger_index: 1, node: { LedgerEntryType: "Escrow", Account: ESCROW_OWNER }, status: "success", validated: false }],
  ])("throws when the node's object question failed with %s and nothing was found", async (_what, answer) => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`node ledger_entry ${hash}`]: answer });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, OBJECTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
  });

  // An escrow, check, channel or delegation without an account is the node failing, not a thing that is nothing (the account goes into a path and a row).
  it.each([
    ["no account", undefined],
    ["an account that is no address", "not-an-address"],
    ["an account that is not text", 7],
  ])("counts an object of a tracked type with %s as an upstream failure", async (_what, account) => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asNodeEntry(hash, "Escrow", { Account: account }));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    const failure = await findHash(api, node, hash, OBJECTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).kind).toBe("server");
  });

  it("answers with the transaction when the node's entry is unreadable: something found wins", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${TX_HASH}`]: null, ...asNodeEntry(TX_HASH, "Escrow", { Account: undefined }) });
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, TX_HASH, OBJECTS)).toEqual({ tx: { ledgerIndex: 107671593, type: "AccountDelete" } });
  });
});

describe("findHash with ledger objects on Xahau: one ledger_entry read answers both questions", () => {
  const readsOf = (m: UpstreamMock) => asked2(m, "node").filter((key) => key.startsWith("node ledger_entry"));

  it("finds a URIToken with the one read, and the entry is no object", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", asUriTokenEntry(hash));
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_BOTH)).toEqual({ nft: { kind: "uritoken", issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb", burned: false } });
    expect(readsOf(mock)).toHaveLength(1);
    expect(methodsOf(mock)).toEqual(["ledger", "ledger_entry", "tx"]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("finds an escrow with the one read, and the entry is no URIToken", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", asNodeEntry(hash, "Escrow"));
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_BOTH)).toEqual({ object: { type: "Escrow", account: ESCROW_OWNER, deleted: false } });
    expect(readsOf(mock)).toHaveLength(1);
  });

  it("finds nothing with the one read when the node has no entry", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau");
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_BOTH)).toEqual({});
    expect(readsOf(mock)).toHaveLength(1);
  });

  it("finds nothing with the one read when the entry is of a type that is neither a URIToken nor tracked", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", asNodeEntry(hash, "AccountRoot"));
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_BOTH)).toEqual({});
    expect(readsOf(mock)).toHaveLength(1);
  });

  // The URIToken is read from the one entry by node-rpc's own reader, `uriToken`'s: a URIToken with a valid issuer and a body that is corrupt fails as it does with `NFTS` alone (E8), and is not "found".
  const corruptUriToken = (hash: string, node: Record<string, unknown>): Overrides => ({
    [`node ledger_entry ${hash}`]: {
      index: hash,
      ledger_index: 26774724,
      node: { Flags: 0, Issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb", LedgerEntryType: "URIToken", Owner: "rAucmWmE8yiueemhmrGh5MyD2mNjXfpQp", URI: "6F64696E", index: hash, ...node },
      status: "success",
      validated: true,
    },
  });
  const CORRUPT = [
    ["an owner that is no address", { Owner: "not-an-address" }],
    ["a URI that is not hex", { URI: "ZZ" }],
    ["flags that are not a whole number", { Flags: "none" }],
    ["a digest that is not 64 hex digits", { Digest: "ABCD" }],
    ["a sell offer that is not an amount", { Amount: { value: "x" } }],
  ] as const;

  it.each(CORRUPT)("fails for a URIToken with %s as it does with NFTS alone, from the one read", async (_what, node) => {
    const failures: UpstreamError[] = [];
    for (const asked of [XAHAU_NFTS, XAHAU_BOTH]) {
      const hash = fresh();
      mock = mockUpstream("xahau", corruptUriToken(hash, node));
      const { api } = clientFor("xahau");
      const { node: rpc } = nodeFor("xahau");

      const failure = await findHash(api, rpc, hash, asked).catch((error: unknown) => error);
      expect(failure, JSON.stringify(asked)).toBeInstanceOf(UpstreamError);
      expect((failure as UpstreamError).kind).toBe("server");
      expect(readsOf(mock)).toHaveLength(1);
      failures.push(failure as UpstreamError);
      mock.restore();
    }
    // The same failure, but for the ID it names.
    const [alone, both] = failures.map((failure) => failure.message.replace(/[0-9A-F]{64}/g, "HASH"));
    expect(both).toBe(alone);
  });

  it("answers with the transaction when the URIToken beside it is corrupt: something found wins, as with NFTS alone", async () => {
    // A recorded Xahau transaction (a Remit) that the index does not have, so that the node's round finds it beside the entry.
    const hash = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";
    mock = mockUpstream("xahau", { [`GET /v2/transactions/${hash}`]: null, ...corruptUriToken(hash, { Owner: "not-an-address" }) });
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_BOTH)).toMatchObject({ tx: { type: "Remit" } });
    expect(readsOf(mock)).toHaveLength(1);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("finds a URIToken that has a sell offer, as with NFTS alone: its amount is read in the network's own currency", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", corruptUriToken(hash, { Amount: "4200000000", Destination: "rAucmWmE8yiueemhmrGh5MyD2mNjXfpQp" }));
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_BOTH)).toEqual({ nft: { kind: "uritoken", issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb", burned: false } });
    expect(readsOf(mock)).toHaveLength(1);
  });

  it("throws the one read's failure when nothing was found, as one failure of the one read", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", { [`node ledger_entry ${hash}`]: nodeError("internal") });
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    const failure = await findHash(api, node, hash, XAHAU_BOTH).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect(readsOf(mock)).toHaveLength(1);
  });

  it("asks the node once with the object question alone (no NFT question), and once with the NFT question alone, as before", async () => {
    const hash = fresh();
    mock = mockUpstream("xahau", asNodeEntry(hash, "PayChannel"));
    const { api } = clientFor("xahau");
    const { node } = nodeFor("xahau");

    expect(await findHash(api, node, hash, XAHAU_OBJECTS)).toMatchObject({ object: { type: "PayChannel" } });
    expect(readsOf(mock)).toHaveLength(1);
    mock.restore();

    const token = fresh();
    mock = mockUpstream("xahau", asUriTokenEntry(token));
    expect(await findHash(api, node, token, XAHAU_NFTS)).toMatchObject({ nft: { kind: "uritoken" } });
    expect(readsOf(mock)).toHaveLength(1);
  });
});

describe("findHash with ledger objects off", () => {
  it.each(["xrpl", "xahau"] as const)("asks no object question of the index or the node on %s: the index's object and the node's entry are not found", async (net) => {
    const hash = fresh();
    mock = mockUpstream(net, { ...asIndexedObject(hash), ...asNodeEntry(hash, "Escrow") });
    const { api } = clientFor(net);
    const { node } = nodeFor(net);

    expect(await findHash(api, node, hash, { net, nfts: false, ledgerObjects: false })).toEqual({});
    expect(asked2(mock, "data-api").sort()).toEqual(indexCalls(hash));
    expect(methodsOf(mock)).toEqual(["ledger", "tx"]);
    expect(asked2(mock, "data-api").some((key) => key.includes("/v2/ledger_objects/"))).toBe(false);
    expect(mock.unusedOverrides().sort()).toEqual([objectCalls(hash), `node ledger_entry ${hash}`].sort());
  });

  it("asks no object question with the NFT question on either: the NFT's questions are what they were", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", asIndexedObject(hash));
    const { api } = clientFor("xrpl");
    const { node } = nodeFor("xrpl");

    expect(await findHash(api, node, hash, NFTS)).toEqual({});
    expect(asked2(mock, "data-api").sort()).toEqual(indexCalls(hash, [`GET /v2/nfts/${hash}`]));
    expect(methodsOf(mock)).toEqual(["ledger", "nft_info", "tx"]);
  });
});
