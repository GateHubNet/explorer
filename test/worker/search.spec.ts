import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { encodeCtid } from "../../app/domain/ctid";
import { shortAddress, shortHash } from "../../app/domain/format";
import { loader } from "../../app/routes/net.search";
import type { LedgerObjectRef } from "../../app/server/api-types";
import { createLoadContext, type Env } from "../../app/server/env";
import { recordedHashes } from "../support/ledger-hashes";
import { nftCase } from "../support/nft-cases";
import { nftAnswerSample, nftSample, uriTokenSample } from "../support/nft-samples";
import { isStored } from "../support/nft-pages";
import { objectCase } from "../support/object-cases";
import { CHANNEL_ID, CHECK_ID, DELEGATION_ID, DELEGATOR, ESCROW_ID, ESCROW_OWNER, ledgerObjectSample } from "../support/object-samples";
import { anchors, hrefs, pageClient, textOf } from "../support/pages";
import { dataApiError, mockUpstream, nodeError, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";

// `/{net}/search?q=...` (spec 6) on the real Worker against the recorded answers of the data API and the nodes
// (test/fixtures/http/): the redirects, the choice page, the help text, the not-found pages and the CTIDs.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included, so every scenario that
// overrides an answer asks for a hash or a ledger no other test asks for, and the tests of failing upstreams come first.

const { page, get, storedAs } = pageClient("192.0.2");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

// Recorded XRPL: an AccountDelete (ledger 107671593), a Payment, and ledger 107720688, whose hash is below. Recorded Xahau: a Remit.
const XRPL_TX = "8F2DCA944394B29981E24DDD6C46192C404D90F7F5FC4EAB6813B0AFD7751A2D";
const XRPL_LEDGER_HASH = "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02";
const XRPL_PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const XAHAU_TX = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";
const ADDRESS = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const X_ADDRESS_WITH_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ2qXW7DhMWWpGmjhqyr";
const X_ADDRESS_NO_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ26KqXMt3GKX2eENgJ9";

const search = (q: string) => `/xrpl/search?q=${encodeURIComponent(q)}`;

/** The `<meta name="robots">` of a page. */
function robots(html: string): string | undefined {
  const tag = [...html.matchAll(/<meta\s[^>]*>/g)].map((m) => m[0]).find((t) => /\bname="robots"/.test(t));
  return tag && /\bcontent="([^"]*)"/.exec(tag)?.[1];
}

/** Whether a page is one a search engine is asked to leave out of its index but to follow the links of. */
const isNoindexFollow = (html: string) => robots(html) === "noindex, follow";

/** The upstream keys of the requests a mock has seen. */
const keys = (m: UpstreamMock) => m.requests.map((request) => `${request.net} ${request.key}`);

/** A transaction and a ledger the data API answers for `hash`, for the page that offers a choice. */
function bothAnswered(hash: string, ledgerIndex: number) {
  return {
    [`GET /v2/transactions/${hash}`]: {
      result: "success",
      transaction: {
        hash,
        ledger_index: ledgerIndex,
        date: "2026-10-17T16:11:02+00:00",
        tx: { TransactionType: "OfferCreate", Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" },
        meta: { TransactionIndex: 3, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
      },
    },
    [`GET /v2/ledgers/${hash}`]: { result: "success", ledger: { ledger_index: ledgerIndex + 1, close_time: 1792253462 } },
  };
}

/** A hash of its own for a test that overrides what the NFT questions answer (what a Worker stores stays for the rest of the file): `6B01`, `6B02`, ... */
let made = 0;
const fresh = () => `6B${(++made).toString(16).toUpperCase().padStart(2, "0")}`.padEnd(64, "D");

/** The index's NFT (or URIToken) of `hash`, as the data API answers `/v2/nfts/{hash}`. */
const indexedNft = (hash: string, over: Parameters<typeof nftSample>[0] = {}): Overrides => ({
  [`GET /v2/nfts/${hash}`]: nftAnswerSample({ nft: nftSample({ nft_id: hash, ...over }) }),
});
const indexedUriToken = (hash: string, over: Parameters<typeof uriTokenSample>[0] = {}): Overrides => ({
  [`GET /v2/nfts/${hash}`]: nftAnswerSample({ nft: uriTokenSample({ nft_id: hash, ...over }) }),
});
/** The transaction the data API has for `hash` (the half of `bothAnswered`). */
const asTransaction = (hash: string, ledgerIndex: number): Overrides => {
  const both = bothAnswered(hash, ledgerIndex);
  return { [`GET /v2/transactions/${hash}`]: both[`GET /v2/transactions/${hash}`] };
};
/** The ledger the data API has for `hash`. */
const asLedger = (hash: string, ledgerIndex: number): Overrides => {
  const both = bothAnswered(hash, ledgerIndex);
  return { [`GET /v2/ledgers/${hash}`]: both[`GET /v2/ledgers/${hash}`] };
};

/** The index's object for `hash` (`/v2/ledger_objects/{id}`, as the data API answers it): an escrow of `ESCROW_OWNER` unless `over` says otherwise. */
const indexedObject = (hash: string, over: Partial<LedgerObjectRef> = {}): Overrides => ({
  [`GET /v2/ledger_objects/${hash}`]: {
    result: "success",
    ledger_object: ledgerObjectSample({ object_id: hash, object_type: "Escrow", account: ESCROW_OWNER, deleted: false, ...over }),
  },
});
/** What the node's `ledger_entry` says of `hash`: an entry of `type` of `ESCROW_OWNER`, as the node wrote it. */
const nodeEntry = (hash: string, type: string, over: Record<string, unknown> = {}): Overrides => ({
  [`node ledger_entry ${hash}`]: {
    index: hash,
    ledger_index: 107972000,
    node: { LedgerEntryType: type, Account: ESCROW_OWNER, Flags: 0, index: hash, ...over },
    status: "success",
    validated: true,
  },
});

// First in the file: the subrequest cache keeps the answers that worked, so the failing ones are asked for first and for
// hashes and ledgers that nothing else in the file asks for.
describe("when an upstream fails", () => {
  it("answers 503 when the data API fails and the hash is nowhere else, and does not ask the node in its place", async () => {
    const hash = "1A".repeat(32);
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: dataApiError(503, "unavailable") });
    const response = await get(search(hash));
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    // The Worker was given the 503 itself, not a failure to connect.
    expect(statusesOf(mock, `GET /v2/transactions/${hash}`)).toEqual([503]);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
    // An outage is not kept: the next visitor asks again.
    expect(await isStored(search(hash))).toBe(false);
  });

  it("answers 503 when the data API has nothing and the node fails: it cannot tell", async () => {
    const hash = "1B".repeat(32);
    mock = mockUpstream("xrpl", { [`node tx ${hash}`]: () => new Response("down", { status: 500 }) });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await isStored(search(hash))).toBe(false);
  });

  it("answers 503 when the data API cannot read the ledger of a CTID", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107600101?transactions=true": dataApiError(500, "boom") });
    const response = await get(search(encodeCtid(107600101, 4, 0)));
    await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(statusesOf(mock, "GET /v2/ledgers/107600101?transactions=true")).toEqual([500]);
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await isStored(search(encodeCtid(107600101, 4, 0)))).toBe(false);
  });

  it("still redirects to what was found when the other question failed", async () => {
    const hash = "1C".repeat(32);
    mock = mockUpstream("xrpl", {
      [`GET /v2/ledgers/${hash}`]: dataApiError(500, "boom"),
      [`GET /v2/transactions/${hash}`]: bothAnswered(hash, 107600150)[`GET /v2/transactions/${hash}`],
    });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hash}`);
    // The failing question really failed, with the status it was given, and the page went on with the answer it had.
    expect(statusesOf(mock, `GET /v2/ledgers/${hash}`)).toEqual([500]);
    expect(statusesOf(mock, `GET /v2/transactions/${hash}`)).toEqual([200]);
  });
});

// The failure rules of Review Focus 3 with the NFT question (NFT spec 7): the index asks the transaction, the ledger and the NFT side by side.
describe("when the NFT question fails", () => {
  it("answers 503 when the index fails the NFT question and has nothing else, and does not send the visitor to the node's NFT in its place", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", {
      [`GET /v2/nfts/${hash}`]: dataApiError(503, "unavailable"),
      // The node has it: it must not be asked.
      [`node nft_info ${hash}`]: {
        nft_id: hash,
        ledger_index: 107886163,
        owner: "r4Xgqy68ykjLEJAkFQ7EaFs8VEdSiWkSeX",
        is_burned: false,
        flags: 8,
        transfer_fee: 0,
        issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu",
        nft_taxon: 500,
        nft_serial: 7,
        status: "success",
        validated: true,
      },
    });
    const response = await get(search(hash));
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(statusesOf(mock, `GET /v2/nfts/${hash}`)).toEqual([503]);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([`node nft_info ${hash}`]);
    expect(await isStored(search(hash))).toBe(false);
  });

  it("answers 503 for a data API without D3 ('Cannot GET'): an outage, never a 404 that is stored", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`GET /v2/nfts/${hash}`]: dataApiError(404, `Cannot GET /v2/nfts/${hash}`) });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(503);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
    // Neither the 503 nor a "not found" is kept: an API that gets D3 tomorrow is asked again.
    expect(await isStored(search(hash))).toBe(false);
  });

  it("names what it asked for in what its 503 throws, as the 404 does: transaction, ledger, NFT (URIToken on Xahau), escrow, check or payment channel", async () => {
    // The Worker's busy page replaces a 503's body, so the phrase is read where the loader throws it (the log's and the error boundary's).
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    for (const [net, word] of [
      ["xrpl", "NFT"],
      ["xahau", "URIToken"],
    ] as const) {
      const hash = fresh();
      mock = mockUpstream(net, { [`GET /v2/nfts/${hash}`]: dataApiError(503, "unavailable") });
      const thrown = await loader({
        request: new Request(`https://explorer.test/${net}/search?q=${hash}`),
        params: { net },
        context: createLoadContext(env as unknown as Env, ctx),
      } as never).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(thrown, net).toMatchObject({ data: { unavailable: `transaction, ledger, ${word}, escrow, check or payment channel ${hash}` }, init: { status: 503 } });
      mock.restore();
    }
  });

  it("still redirects to the transaction when only the NFT question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asTransaction(hash, 107600300), [`GET /v2/nfts/${hash}`]: dataApiError(500, "boom") });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hash}`);
    expect(statusesOf(mock, `GET /v2/nfts/${hash}`)).toEqual([500]);
  });

  it("still redirects to the NFT when only the transaction question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...indexedNft(hash), [`GET /v2/transactions/${hash}`]: dataApiError(500, "boom") });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/nft/${hash}`);
    expect(statusesOf(mock, `GET /v2/transactions/${hash}`)).toEqual([500]);
  });

  it("answers 503 when the index has nothing and the node fails the NFT question: it cannot tell", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`node nft_info ${hash}`]: nodeError("internal") });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await isStored(search(hash))).toBe(false);
  });
});

// The failure rules of Review Focus 3 with the object question (ledger object pages spec 8): the index asks the transaction, the ledger, the NFT and the object side by side; the node is asked
// only when the index had none of them and none of its questions failed.
describe("when the object question fails", () => {
  it("answers 503 when the index fails the object question and has nothing else, and does not send the visitor to the node's entry in its place", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`GET /v2/ledger_objects/${hash}`]: dataApiError(503, "unavailable"), ...nodeEntry(hash, "Escrow") });
    const response = await get(search(hash));
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(statusesOf(mock, `GET /v2/ledger_objects/${hash}`)).toEqual([503]);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([`node ledger_entry ${hash}`]);
    expect(await isStored(search(hash))).toBe(false);
  });

  it("answers 503 for a data API without D5 ('Cannot GET'): an outage, never a 404 that is stored", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`GET /v2/ledger_objects/${hash}`]: dataApiError(404, `Cannot GET /v2/ledger_objects/${hash}`) });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(503);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await isStored(search(hash))).toBe(false);
  });

  it("still redirects to the transaction when only the object question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...asTransaction(hash, 107600700), [`GET /v2/ledger_objects/${hash}`]: dataApiError(500, "boom") });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hash}`);
    expect(statusesOf(mock, `GET /v2/ledger_objects/${hash}`)).toEqual([500]);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
  });

  it("still redirects to the object when only the transaction question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { ...indexedObject(hash), [`GET /v2/transactions/${hash}`]: dataApiError(500, "boom") });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/escrows/${hash}`);
    expect(statusesOf(mock, `GET /v2/transactions/${hash}`)).toEqual([500]);
  });

  it("answers 503 when the index has nothing and the node fails the object question: it cannot tell", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", { [`node ledger_entry ${hash}`]: nodeError("internal") });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await isStored(search(hash))).toBe(false);
  });

  it("still redirects to the transaction the node has when the node's object question failed", async () => {
    const hash = fresh();
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: null,
      [`node tx ${hash}`]: {
        status: "success",
        validated: true,
        ledger_index: 107600710,
        date: 845378370,
        hash,
        tx_json: { TransactionType: "Payment", Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", Fee: "10" },
        Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh",
        TransactionType: "Payment",
        Fee: "10",
        meta: { TransactionIndex: 1, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
      },
      [`node ledger_entry ${hash}`]: nodeError("internal"),
    });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hash}`);
  });
});

describe("a ledger index", () => {
  it("redirects to the ledger, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search("107695660"));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/ledger/107695660");
    expect(mock.requests).toEqual([]);
  });

  it("reads an index grouped by thousands, the way the explorer shows it", async () => {
    mock = mockUpstream("xrpl");
    for (const q of ["107,695,660", "107 695 660"]) {
      const response = await get(search(q));
      await response.text();
      expect(response.status, q).toBe(302);
      expect(response.headers.get("Location"), q).toBe("/xrpl/ledger/107695660");
    }
    // A form submitted without JavaScript puts a plus sign where the space was.
    const plus = await get("/xrpl/search?q=107+695+660");
    await plus.text();
    expect(plus.headers.get("Location")).toBe("/xrpl/ledger/107695660");
  });

  it("keeps the network it was asked on", async () => {
    mock = mockUpstream("xahau");
    const response = await get("/xahau/search?q=26540187");
    await response.text();
    expect(response.headers.get("Location")).toBe("/xahau/ledger/26540187");
  });

  it("is stored for the short class, and the browser is not given the internal headers", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search("107695661"));
    await response.text();

    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(response.headers.has("X-Cache-Ttl")).toBe(false);
    expect(await storedAs(search("107695661"))).toEqual({ cls: "short", ttl: 30 });
  });
});

describe("a 64-digit hash", () => {
  it("redirects a transaction hash to the transaction", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(XRPL_TX));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${XRPL_TX}`);
    // The NFT and object questions are asked with the others while their switches are on; the node is not asked, as the index had an answer.
    expect(keys(mock).sort()).toEqual([
      `xrpl GET /v2/ledger_objects/${XRPL_TX}`,
      `xrpl GET /v2/ledgers/${XRPL_TX}`,
      `xrpl GET /v2/nfts/${XRPL_TX}`,
      `xrpl GET /v2/transactions/${XRPL_TX}`,
    ]);
    expect(await storedAs(search(XRPL_TX))).toEqual({ cls: "short", ttl: 30 });
  });

  it("redirects a ledger hash to the ledger", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(XRPL_LEDGER_HASH));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/ledger/${XRPL_LEDGER_HASH}`);
    expect(await storedAs(search(XRPL_LEDGER_HASH))).toEqual({ cls: "short", ttl: 30 });
  });

  it("sends the hash on in upper case, whatever was typed, with or without 0x and spaces", async () => {
    mock = mockUpstream("xrpl");
    for (const q of [XRPL_TX.toLowerCase(), `0x${XRPL_TX}`, `  ${XRPL_TX.toLowerCase()} `]) {
      const response = await get(search(q));
      await response.text();
      expect(response.headers.get("Location"), q).toBe(`/xrpl/tx/${XRPL_TX}`);
    }
  });

  it("shows both when the hash is a transaction and a ledger", async () => {
    const hash = "2A".repeat(32);
    mock = mockUpstream("xrpl", bothAnswered(hash, 107600200));
    const { response, html } = await page(search(hash));
    const text = textOf(html);

    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(hrefs(html)).toContain(`/xrpl/tx/${hash}`);
    expect(hrefs(html)).toContain(`/xrpl/ledger/${hash}`);
    // What each one is, so that the choice can be made.
    expect(text).toContain("OfferCreate in ledger #107,600,200");
    expect(text).toContain("#107,600,201, closed 2026-10-17 16:11:02 UTC");
    expect(text).toContain(hash);
    expect(isNoindexFollow(html)).toBe(true);
    expect(await storedAs(search(hash))).toEqual({ cls: "short", ttl: 30 });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("finds a transaction the data API has not indexed in the node (spec 10)", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${XRPL_PAYMENT}`]: null });
    const response = await get(search(XRPL_PAYMENT));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${XRPL_PAYMENT}`);
    expect(mock.requests.filter((r) => r.kind === "node").length).toBeGreaterThan(0);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  describe("that is an NFT (NFT spec 7)", () => {
    it("redirects the id of an NFT of the index to the NFT's page, with the NFT and object questions asked and the node not", async () => {
      const { id } = await nftCase("xrpl", "featured");
      mock = mockUpstream("xrpl");
      const response = await get(search(id));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/nft/${id}`);
      expect(keys(mock).sort()).toEqual([`xrpl GET /v2/ledger_objects/${id}`, `xrpl GET /v2/ledgers/${id}`, `xrpl GET /v2/nfts/${id}`, `xrpl GET /v2/transactions/${id}`]);
      expect(await storedAs(search(id))).toEqual({ cls: "short", ttl: 30 });
    });

    it("sends the id on in upper case, whatever was typed, with or without 0x", async () => {
      const { id } = await nftCase("xrpl", "featured");
      mock = mockUpstream("xrpl");
      for (const q of [id.toLowerCase(), `0x${id}`]) {
        const response = await get(search(q));
        await response.text();
        expect(response.headers.get("Location"), q).toBe(`/xrpl/nft/${id}`);
      }
    });

    it("redirects an NFT that only the node knows to its page: the page shows it from the network", async () => {
      const { id } = await nftCase("xrpl", "network");
      mock = mockUpstream("xrpl");
      const response = await get(search(id));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/nft/${id}`);
      // The index said "nft not found" (and had neither a transaction nor a ledger nor an object), so the node was asked, for the same four.
      expect(keys(mock).filter((key) => key.includes("node")).sort()).toEqual(
        [
          `xrpl node ledger ledger_hash=${id}`,
          `xrpl node ledger_entry index=${id}&ledger_index=validated`,
          `xrpl node nft_info ledger_index=validated&nft_id=${id}`,
          `xrpl node tx transaction=${id}`,
        ].sort(),
      );
      expect(await storedAs(search(id))).toEqual({ cls: "short", ttl: 30 });
    });

    it("redirects an NFT that the node says is burned to its page as well", async () => {
      const { id } = await nftCase("xrpl", "network-burned");
      mock = mockUpstream("xrpl");
      const response = await get(search(id));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/nft/${id}`);
    });

    it("redirects the id of a URIToken of Xahau to its page, from the index and from the node", async () => {
      for (const which of ["featured", "network"] as const) {
        const { id } = await nftCase("xahau", which);
        mock = mockUpstream("xahau");
        const response = await get(`/xahau/search?q=${id}`);
        await response.text();

        expect(response.status, which).toBe(302);
        expect(response.headers.get("Location"), which).toBe(`/xahau/nft/${id}`);
        mock.restore();
      }
    });

    it("is a choice between the transaction and the NFT when the id is both, each row leading to its page", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { ...asTransaction(hash, 107600400), ...indexedNft(hash, { taxon: 1, serial: 4127 }) });
      const { response, html } = await page(search(hash));
      const text = textOf(html);

      expect(response.headers.get("Cache-Control")).toBe("max-age=0");
      expect(text).toContain("Transaction or NFT?");
      expect(text).toContain("both a transaction and an NFT on XRPL");
      expect(hrefs(html)).toContain(`/xrpl/tx/${hash}`);
      expect(hrefs(html)).toContain(`/xrpl/nft/${hash}`);
      expect(hrefs(html)).not.toContain(`/xrpl/ledger/${hash}`);
      expect(text).toContain("OfferCreate in ledger #107,600,400");
      expect(text).toContain("NFT #4,127 of r4PP7g…CzT3 · taxon 1");
      expect(text).not.toContain("burned");
      expect(isNoindexFollow(html)).toBe(true);
      expect(await storedAs(search(hash))).toEqual({ cls: "short", ttl: 30 });
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(mock.unusedOverrides()).toEqual([]);
    });

    it("is a choice among all three, and says 'burned' of a burned NFT", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", {
        ...asTransaction(hash, 107600500),
        ...asLedger(hash, 107600501),
        ...indexedNft(hash, { burned: true, owner: undefined, owner_since: undefined, burned_at: { ledger_index: 107886000, tx_hash: "AB".repeat(32), executed_time: "2026-10-24T16:08:12Z", by: "r4PP7gwuVfxzLPWFiJXjLUtvzA7F97CzT3" } }),
      });
      const { html } = await page(search(hash));
      const text = textOf(html);

      expect(text).toContain("Transaction, ledger or NFT?");
      expect(hrefs(html).filter((href) => href.includes(hash))).toEqual([`/xrpl/tx/${hash}`, `/xrpl/ledger/${hash}`, `/xrpl/nft/${hash}`]);
      expect(text).toContain("NFT #95,234,705 of r4PP7g…CzT3 · taxon 10 burned");
    });

    it("is a choice on Xahau that calls the token a URIToken, of its issuer", async () => {
      const hash = fresh();
      mock = mockUpstream("xahau", { ...asTransaction(hash, 26800000), ...indexedUriToken(hash) });
      const { html } = await page(`/xahau/search?q=${hash}`);
      const text = textOf(html);

      expect(text).toContain("Transaction or URIToken?");
      expect(text).toContain("URIToken of rodinG…zKyb");
      expect(hrefs(html)).toContain(`/xahau/nft/${hash}`);
    });

    it("is a choice between the ledger and the NFT when the id is a ledger's hash and an NFT's", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { ...asLedger(hash, 107600600), ...indexedNft(hash) });
      const { html } = await page(search(hash));
      expect(textOf(html)).toContain("Ledger or NFT?");
      expect(hrefs(html).filter((href) => href.includes(hash))).toEqual([`/xrpl/ledger/${hash}`, `/xrpl/nft/${hash}`]);
    });
  });

  describe("that is a ledger object (ledger object pages spec 8)", () => {
    const rowsOf = (html: string) => hrefs(html).filter((href) => href.includes("/escrows/") || href.includes("/checks/") || href.includes("/payment-channels/") || href.includes("/account/"));

    it.each([
      ["an escrow", ESCROW_ID, "escrows"],
      ["a check", CHECK_ID, "checks"],
      ["a payment channel", CHANNEL_ID, "payment-channels"],
    ] as const)("redirects the ID of %s of the index to its page, with the object question asked beside the others and the node not", async (_what, id, segment) => {
      mock = mockUpstream("xrpl");
      const response = await get(search(id));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/${segment}/${id}`);
      expect(keys(mock).sort()).toEqual([`xrpl GET /v2/ledger_objects/${id}`, `xrpl GET /v2/ledgers/${id}`, `xrpl GET /v2/nfts/${id}`, `xrpl GET /v2/transactions/${id}`]);
      expect(await storedAs(search(id))).toEqual({ cls: "short", ttl: 30 });
    });

    it("sends the ID on in upper case, whatever was typed, with or without 0x", async () => {
      mock = mockUpstream("xrpl");
      for (const q of [ESCROW_ID.toLowerCase(), `0x${ESCROW_ID}`]) {
        const response = await get(search(q));
        await response.text();
        expect(response.headers.get("Location"), q).toBe(`/xrpl/escrows/${ESCROW_ID}`);
      }
    });

    it("redirects the ID of a removed escrow to its page, which says that it was removed", async () => {
      // The recorded escrow that the index says was deleted (test/fixtures/http/xrpl/data-api/ledger_objects/).
      const removed = "03256CCB3E90DBCFC6AE5E78E72095EB67595B0844BD85F152577C11B103C698";
      mock = mockUpstream("xrpl");
      const response = await get(search(removed));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/escrows/${removed}`);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    });

    it("redirects the ID of a Delegate to its delegator's Delegation tab", async () => {
      mock = mockUpstream("xrpl");
      const response = await get(search(DELEGATION_ID));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/account/${DELEGATOR}?tab=delegation`);
      expect(await storedAs(search(DELEGATION_ID))).toEqual({ cls: "short", ttl: 30 });
    });

    it("redirects the ID of a removed Delegate to its delegator's account page: the tab lists the delegations in the ledger now (E10Δ3)", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", indexedObject(hash, { object_type: "Delegate", account: DELEGATOR, deleted: true }));
      const response = await get(search(hash));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/account/${DELEGATOR}`);
    });

    it("redirects the ID of a Delegate on Xahau, whose ledger has no delegation, to its delegator's account page: the tab is not there", async () => {
      const hash = fresh();
      mock = mockUpstream("xahau", indexedObject(hash, { object_type: "Delegate", account: DELEGATOR }));
      const response = await get(`/xahau/search?q=${hash}`);
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xahau/account/${DELEGATOR}`);
    });

    it.each([
      ["an escrow", "escrow-node-only", "escrows"],
      ["a check", "check-node-only", "checks"],
    ] as const)("redirects the ID of %s that only the node has to its page: the page shows it from the network", async (_what, which, segment) => {
      const { id } = await objectCase("xrpl", which);
      mock = mockUpstream("xrpl");
      const response = await get(search(id));
      await response.text();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/${segment}/${id}`);
      // The index had no object (and neither a transaction nor a ledger nor an NFT), so the node was asked, for the same four.
      expect(keys(mock).filter((key) => key.includes("node")).sort()).toEqual(
        [
          `xrpl node ledger ledger_hash=${id}`,
          `xrpl node ledger_entry index=${id}&ledger_index=validated`,
          `xrpl node nft_info ledger_index=validated&nft_id=${id}`,
          `xrpl node tx transaction=${id}`,
        ].sort(),
      );
      expect(await storedAs(search(id))).toEqual({ cls: "short", ttl: 30 });
    });

    it("redirects the ID of an escrow of Xahau to its page, from the index and from the node, the node asked once for the URIToken and the object together", async () => {
      const { id } = await objectCase("xahau", "xahau-escrow");
      mock = mockUpstream("xahau");
      const fromIndex = await get(`/xahau/search?q=${id}`);
      await fromIndex.text();
      expect(fromIndex.status).toBe(302);
      expect(fromIndex.headers.get("Location")).toBe(`/xahau/escrows/${id}`);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      mock.restore();

      const hash = fresh();
      mock = mockUpstream("xahau", nodeEntry(hash, "Escrow"));
      const fromNode = await get(`/xahau/search?q=${hash}`);
      await fromNode.text();
      expect(fromNode.status).toBe(302);
      expect(fromNode.headers.get("Location")).toBe(`/xahau/escrows/${hash}`);
      expect(keys(mock).filter((key) => key.startsWith("xahau node ledger_entry"))).toEqual([`xahau node ledger_entry index=${hash}&ledger_index=validated`]);
    });

    it("is a 404 for an entry of a type that has no page: it counts as nothing", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", nodeEntry(hash, "AccountRoot"));
      const { html } = await page(search(hash), 404);

      expect(textOf(html)).toContain(`We couldn’t find transaction, ledger, NFT, escrow, check or payment channel ${shortHash(hash)} on XRPL.`);
      expect(mock.unusedOverrides()).toEqual([]);
    });

    it("is a choice between the transaction and the object when the ID is both, each row leading to its page", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { ...asTransaction(hash, 107600800), ...indexedObject(hash) });
      const { response, html } = await page(search(hash));
      const text = textOf(html);

      expect(response.headers.get("Cache-Control")).toBe("max-age=0");
      expect(text).toContain("Transaction or escrow?");
      expect(text).toContain("both a transaction and an escrow on XRPL");
      expect(hrefs(html)).toContain(`/xrpl/tx/${hash}`);
      expect(hrefs(html)).toContain(`/xrpl/escrows/${hash}`);
      expect(hrefs(html)).not.toContain(`/xrpl/ledger/${hash}`);
      expect(text).toContain("OfferCreate in ledger #107,600,800");
      expect(text).toContain(`Escrow of ${shortAddress(ESCROW_OWNER)}`);
      expect(text).not.toContain("removed");
      expect(isNoindexFollow(html)).toBe(true);
      expect(await storedAs(search(hash))).toEqual({ cls: "short", ttl: 30 });
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(mock.unusedOverrides()).toEqual([]);
    });

    it.each([
      ["a check", "Check", "checks", "Check of"],
      ["a payment channel", "PayChannel", "payment-channels", "Payment channel of"],
    ] as const)("names %s in its row: '%s of {owner}', and says 'removed' of one that was deleted", async (_what, type, segment, words) => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { ...asLedger(hash, 107600900), ...indexedObject(hash, { object_type: type, deleted: true }) });
      const { html } = await page(search(hash));
      const text = textOf(html);

      expect(hrefs(html).filter((href) => href.includes(hash))).toEqual([`/xrpl/ledger/${hash}`, `/xrpl/${segment}/${hash}`]);
      expect(text).toContain(`${words} ${shortAddress(ESCROW_OWNER)} removed`);
    });

    it("names a delegation in its row, 'Delegation of {delegator}', leading to the Delegation tab", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { ...asTransaction(hash, 107601000), ...indexedObject(hash, { object_type: "Delegate", account: DELEGATOR }) });
      const { html } = await page(search(hash));

      expect(textOf(html)).toContain("Transaction or delegation?");
      expect(textOf(html)).toContain(`Delegation of ${shortAddress(DELEGATOR)}`);
      expect(textOf(html)).not.toContain("removed");
      expect(rowsOf(html)).toEqual([`/xrpl/account/${DELEGATOR}?tab=delegation`]);
    });

    it("leads the row of a removed delegation to the account page, with 'removed' (E10Δ3)", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { ...asTransaction(hash, 107601100), ...indexedObject(hash, { object_type: "Delegate", account: DELEGATOR, deleted: true }) });
      const { html } = await page(search(hash));

      expect(textOf(html)).toContain(`Delegation of ${shortAddress(DELEGATOR)} removed`);
      expect(rowsOf(html)).toEqual([`/xrpl/account/${DELEGATOR}`]);
    });

    it("is a choice among all four, in the order the search asks them: the transaction, the ledger, the NFT and the object", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { ...asTransaction(hash, 107601200), ...asLedger(hash, 107601201), ...indexedNft(hash), ...indexedObject(hash) });
      const { html } = await page(search(hash));

      expect(textOf(html)).toContain("Transaction, ledger, NFT or escrow?");
      expect(hrefs(html).filter((href) => href.includes(hash))).toEqual([`/xrpl/tx/${hash}`, `/xrpl/ledger/${hash}`, `/xrpl/nft/${hash}`, `/xrpl/escrows/${hash}`]);
    });

    it("is a choice on Xahau between the transaction and the escrow, each row leading to Xahau's page", async () => {
      const hash = fresh();
      mock = mockUpstream("xahau", { ...asTransaction(hash, 26800100), ...indexedObject(hash, { account: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb" }) });
      const { html } = await page(`/xahau/search?q=${hash}`);

      expect(textOf(html)).toContain("Transaction or escrow?");
      expect(textOf(html)).toContain("both a transaction and an escrow on Xahau");
      expect(hrefs(html).filter((href) => href.includes(hash))).toEqual([`/xahau/tx/${hash}`, `/xahau/escrows/${hash}`]);
    });
  });

  describe("that nothing has", () => {
    const UNKNOWN = "3B".repeat(32);

    it("is a 404 page that offers the same search on the other network", async () => {
      mock = mockUpstream("xrpl");
      const { response, html } = await page(search(UNKNOWN), 404);
      const text = textOf(html);

      expect(text).toContain(`We couldn’t find transaction, ledger, NFT, escrow, check or payment channel ${shortHash(UNKNOWN)} on XRPL.`);
      const link = anchors(html).find((a) => a.text === "Search on Xahau");
      expect(link?.attrs).toContain(`href="/xahau/search?q=${UNKNOWN}"`);
      // The box keeps what was typed, and the way home is there.
      expect(html).toContain(`value="${UNKNOWN}"`);
      expect(hrefs(html)).toContain("/xrpl");
      expect(response.headers.get("Cache-Control")).toBe("max-age=0");
      expect(isNoindexFollow(html)).toBe(true);
      expect(await storedAs(search(UNKNOWN))).toEqual({ cls: "short", ttl: 30 });
    });

    it("asked the data API for the transaction, the ledger, the NFT and the object, and then the node for the same four", async () => {
      const hash = "3C".repeat(32);
      mock = mockUpstream("xrpl");
      await page(search(hash), 404);
      expect(keys(mock).sort()).toEqual(
        [
          `xrpl GET /v2/ledger_objects/${hash}`,
          `xrpl GET /v2/ledgers/${hash}`,
          `xrpl GET /v2/nfts/${hash}`,
          `xrpl GET /v2/transactions/${hash}`,
          `xrpl node ledger ledger_hash=${hash}`,
          `xrpl node ledger_entry index=${hash}&ledger_index=validated`,
          `xrpl node nft_info ledger_index=validated&nft_id=${hash}`,
          `xrpl node tx transaction=${hash}`,
        ].sort(),
      );
    });

    it("asks Xahau's node for the URIToken and the object with the one ledger entry, not XRPL's command, and asks it once", async () => {
      const hash = "3E".repeat(32);
      mock = mockUpstream("xahau");
      await page(`/xahau/search?q=${hash}`, 404);
      expect(keys(mock).sort()).toEqual(
        [
          `xahau GET /v2/ledger_objects/${hash}`,
          `xahau GET /v2/ledgers/${hash}`,
          `xahau GET /v2/nfts/${hash}`,
          `xahau GET /v2/transactions/${hash}`,
          `xahau node ledger ledger_hash=${hash}`,
          `xahau node ledger_entry index=${hash}&ledger_index=validated`,
          `xahau node tx transaction=${hash}`,
        ].sort(),
      );
    });

    it("is still a 404 when the node does not know the NFT command (a node that is not Clio): that is no failure", async () => {
      const hash = fresh();
      mock = mockUpstream("xrpl", { [`node nft_info ${hash}`]: nodeError("unknownCmd") });
      const { html } = await page(search(hash), 404);

      expect(textOf(html)).toContain(`We couldn’t find transaction, ledger, NFT, escrow, check or payment channel ${shortHash(hash)} on XRPL.`);
      expect(mock.unusedOverrides()).toEqual([]);
    });

    it("offers XRPL from Xahau, with the hash in upper case", async () => {
      const hash = "3D".repeat(32);
      mock = mockUpstream("xahau");
      const { html } = await page(`/xahau/search?q=${hash.toLowerCase()}`, 404);
      const link = anchors(html).find((a) => a.text === "Search on XRPL");
      expect(link?.attrs).toContain(`href="/xrpl/search?q=${hash}"`);
      // What was looked for is what the search asked: Xahau's token is a URIToken.
      expect(textOf(html)).toContain(`We couldn’t find transaction, ledger, URIToken, escrow, check or payment channel ${shortHash(hash)} on Xahau.`);
    });

    it("leads to the transaction when the other network has it", async () => {
      mock = mockUpstream("xrpl");
      // A Xahau transaction is not on XRPL ...
      const { html } = await page(search(XAHAU_TX), 404);
      const href = /href="([^"]*)"[^>]*>Search on Xahau</.exec(html)?.[1];
      expect(href).toBe(`/xahau/search?q=${XAHAU_TX}`);

      // ... and the link finds it there.
      const there = await get(href!);
      await there.text();
      expect(there.status).toBe(302);
      expect(there.headers.get("Location")).toBe(`/xahau/tx/${XAHAU_TX}`);
    });
  });
});

describe("an address", () => {
  it("redirects to the account, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(ADDRESS));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/account/${ADDRESS}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search(ADDRESS))).toEqual({ cls: "short", ttl: 30 });
  });

  it("redirects an X-address to the classic address with the tag", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(X_ADDRESS_WITH_TAG));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/account/${ADDRESS}?tag=104882`);
  });

  it("leaves the tag out when the X-address has none", async () => {
    mock = mockUpstream("xahau");
    const response = await get(`/xahau/search?q=${X_ADDRESS_NO_TAG}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xahau/account/${ADDRESS}`);
  });

  it("does not take an address with a wrong checksum for one", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(search(`${ADDRESS.slice(0, -1)}y`));
    expect(textOf(html)).toContain("Nothing on XRPL looks like");
  });
});

describe("a CTID", () => {
  it("redirects a CTID of the network to the transaction at its place in the ledger", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 107720688);
    const ctid = encodeCtid(107720688, 17, 0);
    const response = await get(search(ctid));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hashes[17]}`);
    expect(keys(mock)).toEqual(["xrpl GET /v2/ledgers/107720688?transactions=true"]);
    expect(await storedAs(search(ctid))).toEqual({ cls: "short", ttl: 30 });
  });

  it("takes a CTID in lower case", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 107720688);
    const response = await get(search(encodeCtid(107720688, 3, 0).toLowerCase()));
    await response.text();
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hashes[3]}`);
  });

  it("redirects a Xahau CTID on Xahau", async () => {
    mock = mockUpstream("xahau");
    const hashes = await recordedHashes("xahau", 26540187);
    const response = await get(`/xahau/search?q=${encodeCtid(26540187, 5, 21337)}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xahau/tx/${hashes[5]}`);
  });

  it("offers the transaction on the other network when the CTID belongs there, and asks nobody", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(26540187, 5, 21337);
    const { response, html } = await page(search(ctid));
    const text = textOf(html);

    expect(text).toContain("That CTID is on Xahau");
    expect(text).toContain(`${ctid} belongs to Xahau, so it is not a transaction on XRPL.`);
    const link = anchors(html).find((a) => a.attrs.includes(`href="/xahau/tx/${ctid}"`));
    expect(link?.text).toBe("Open the transaction on Xahau");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(isNoindexFollow(html)).toBe(true);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search(ctid))).toEqual({ cls: "short", ttl: 30 });
  });

  it("offers the transaction on XRPL when an XRPL CTID is searched on Xahau", async () => {
    mock = mockUpstream("xahau");
    const ctid = encodeCtid(107720688, 5, 0);
    const { html } = await page(`/xahau/search?q=${ctid}`);
    expect(hrefs(html)).toContain(`/xrpl/tx/${ctid}`);
    expect(textOf(html)).toContain("That CTID is on XRPL");
  });

  it("is a 404 for a ledger the data API does not have, and for an index past the end of the ledger", async () => {
    mock = mockUpstream("xrpl");
    for (const ctid of [encodeCtid(107600301, 0, 0), encodeCtid(107720688, 66, 0)]) {
      const { response, html } = await page(search(ctid), 404);
      expect(textOf(html), ctid).toContain(`We couldn’t find transaction ${ctid} on XRPL.`);
      // The network id in a CTID is its network's: there is nothing to look for on the other one.
      expect(textOf(html), ctid).not.toContain("Search on Xahau");
      expect(isNoindexFollow(html), ctid).toBe(true);
      expect(response.headers.get("Cache-Control"), ctid).toBe("max-age=0");
    }
    expect(await storedAs(search(encodeCtid(107600301, 0, 0)))).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 for a network id that is neither XRPL's nor Xahau's, on either network, and asks nobody", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(107720688, 5, 1);
    for (const net of ["xrpl", "xahau"]) {
      const { html } = await page(`/${net}/search?q=${ctid}`, 404);
      const text = textOf(html);
      expect(text).toContain(`${ctid} is for network id 1, which this explorer does not cover.`);
      expect(hrefs(html).filter((href) => href.includes("/tx/"))).toEqual([]);
      expect(text).not.toContain("Search on");
    }
    expect(mock.requests).toEqual([]);
  });
});

describe("anything else", () => {
  it("shows what can be searched for, with the box holding what was typed", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page(search("hello"));
    const text = textOf(html);

    expect(text).toContain("No match");
    expect(text).toContain("Nothing on XRPL looks like “hello”.");
    expect(text).toContain("An account address");
    expect(text).toContain("A transaction or ledger hash: 64 hexadecimal characters");
    expect(text).toContain("A ledger index");
    expect(text).toContain("A CTID: C followed by 15 hexadecimal characters");
    expect(html).toContain('value="hello"');
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(isNoindexFollow(html)).toBe(true);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search("hello"))).toEqual({ cls: "short", ttl: 30 });
  });

  it("is the same page for an empty box, and for no box at all", async () => {
    mock = mockUpstream("xrpl");
    for (const path of ["/xrpl/search?q=", "/xrpl/search?q=%20%20", "/xrpl/search"]) {
      const { html } = await page(path);
      expect(textOf(html), path).toContain("Search XRPL");
      expect(textOf(html), path).toContain("A CTID: C followed by 15 hexadecimal characters");
      expect(isNoindexFollow(html), path).toBe(true);
    }
  });

  it("says what a hash can be as the search asks it with NFTS and LEDGER_OBJECTS on, on each network, in the prompt of an empty box, the help's bullets and the box's own words", async () => {
    mock = mockUpstream("xrpl");
    const xrpl = await page(search(""));
    expect(textOf(xrpl.html)).toContain("Enter an address, a transaction, ledger, NFT, escrow, check or payment channel hash, a ledger index or a CTID.");
    expect(textOf(xrpl.html)).toContain("An NFT or URIToken id: 64 hexadecimal characters");
    expect(textOf(xrpl.html)).toContain("An escrow, check or payment channel id: 64 hexadecimal characters");
    // The box's placeholders, the header's and the page's own.
    expect(xrpl.html).toContain('placeholder="Address, hash, ledger, CTID, NFT id or object id"');
    expect(xrpl.html).toContain('placeholder="Address, transaction hash, ledger index, CTID, NFT id or object id"');
    mock.restore();
    mock = mockUpstream("xahau");
    const xahau = await page("/xahau/search?q=");
    expect(textOf(xahau.html)).toContain("Enter an address, a transaction, ledger, URIToken, escrow, check or payment channel hash, a ledger index or a CTID.");
  });

  it("shows a long or hostile input as text, cut short", async () => {
    mock = mockUpstream("xrpl");
    const hostile = `<script>alert(1)</script>${"x".repeat(500)}`;
    const { html } = await page(search(hostile));

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("x".repeat(300));
  });

  it("is on Xahau what it is on XRPL", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/search?q=hello");
    expect(textOf(html)).toContain("Nothing on Xahau looks like “hello”.");
    expect(html).toContain('data-net="xahau"');
  });
});

describe("a token (E11 spec 5.3)", () => {
  const BITSTAMP = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
  const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
  const EVR_ISSUER = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
  const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
  const LP = "03B245BE580EC4F4386A751C084489EC4B514A2F";
  /** The `href`s of the links to the list of tokens that a page offers. */
  const tokensLinks = (html: string) => anchors(html).filter((a) => /among tokens/.test(a.text)).map((a) => /href="([^"]*)"/.exec(a.attrs)?.[1]);

  // None of them asks anyone: the token page answers its own 404, so a search for a token that is not there still leads to it.
  it.each([
    ["a standard code and its issuer", `USD.${BITSTAMP}`, `/xrpl/token/USD.${BITSTAMP}`],
    ["a code in lower case", `usd.${BITSTAMP}`, `/xrpl/token/USD.${BITSTAMP}`],
    ["a space for the dot", `usd ${BITSTAMP}`, `/xrpl/token/USD.${BITSTAMP}`],
    ["a plus for the dot", `usd+${BITSTAMP}`, `/xrpl/token/USD.${BITSTAMP}`],
    ["a pipe for the dot", `USD|${BITSTAMP}`, `/xrpl/token/USD.${BITSTAMP}`],
    ["spaces around it", `  USD.${BITSTAMP}\n`, `/xrpl/token/USD.${BITSTAMP}`],
    // A text code is its bytes: rlusd is another code than RLUSD, and its page answers its own 404.
    ["a text code in lower case", `rlusd+${RLUSD_ISSUER}`, `/xrpl/token/rlusd.${RLUSD_ISSUER}`],
    ["a text code", `RLUSD.${RLUSD_ISSUER}`, `/xrpl/token/RLUSD.${RLUSD_ISSUER}`],
    ["the 40 hex digits of a text code", `524C555344000000000000000000000000000000.${RLUSD_ISSUER}`, `/xrpl/token/RLUSD.${RLUSD_ISSUER}`],
  ])("redirects %s to the token's page, without asking anyone", async (_what, q, location) => {
    mock = mockUpstream("xrpl");
    const response = await get(search(q));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(location);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search(q))).toEqual({ cls: "short", ttl: 30 });
  });

  it("reads the plus sign a form without JavaScript puts where the space was", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/search?q=usd+${BITSTAMP}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/token/USD.${BITSTAMP}`);
    expect(mock.requests).toEqual([]);
  });

  it("keeps the network it was asked on, and Xahau's own code is no token", async () => {
    mock = mockUpstream("xahau");
    const evr = await get(`/xahau/search?q=EVR.${EVR_ISSUER}`);
    await evr.text();
    expect(evr.status).toBe(302);
    expect(evr.headers.get("Location")).toBe(`/xahau/token/EVR.${EVR_ISSUER}`);
    // XRP is a token on Xahau; XAH is its currency, and with an issuer it is none.
    const xrp = await get(`/xahau/search?q=XRP.${EVR_ISSUER}`);
    await xrp.text();
    expect(xrp.headers.get("Location")).toBe(`/xahau/token/XRP.${EVR_ISSUER}`);
    const xah = await page(`/xahau/search?q=XAH.${EVR_ISSUER}`);
    expect(xah.response.status).toBe(200);
    expect(xah.response.headers.get("Location")).toBeNull();
    expect(mock.requests).toEqual([]);
  });

  it("redirects an LP token to its pool, class short, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    for (const q of [`${LP}+${POOL}`, `${LP.toLowerCase()}.${POOL}`]) {
      const response = await get(search(q));
      await response.text();
      expect(response.status, q).toBe(302);
      expect(response.headers.get("Location"), q).toBe(`/xrpl/amm/${POOL}`);
      expect(await storedAs(search(q)), q).toEqual({ cls: "short", ttl: 30 });
    }
    expect(mock.requests).toEqual([]);
  });

  it("redirects in the `.data` response a client-side navigation reads", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/search.data?q=USD.${BITSTAMP}`);
    const body = await response.text();

    expect(response.status).toBe(202);
    expect(body).toContain(`/xrpl/token/USD.${BITSTAMP}`);
    expect(body).toContain("SingleFetchRedirect");
  });

  it("offers the list of tokens for a text that is no token, on the help page", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page(search("RLUSD"));
    const text = textOf(html);

    expect(response.status).toBe(200);
    expect(text).toContain("Nothing on XRPL looks like “RLUSD”.");
    expect(text).toContain("A token: its code and issuer");
    expect(text).toContain("Look for “RLUSD” among tokens →");
    expect(tokensLinks(html)).toEqual(["/xrpl/tokens?q=RLUSD"]);
    expect(html).toContain('value="RLUSD"');
    expect(isNoindexFollow(html)).toBe(true);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search("RLUSD"))).toEqual({ cls: "short", ttl: 30 });
  });

  it.each([
    ["the native code alone, which is no token", "XRP", "/xrpl/tokens?q=XRP"],
    ["a code with an issuer that is not an address", "USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59C", "/xrpl/tokens?q=USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59C"],
    ["a word of a name", "Ripple USD", "/xrpl/tokens?q=Ripple%20USD"],
    ["a text with an ampersand, a quote and a hash", "A&B 'x' #1", "/xrpl/tokens?q=A%26B%20%27x%27%20%231"],
    ["a text trimmed", "  gateway \t", "/xrpl/tokens?q=gateway"],
  ])("offers the list for %s", async (_what, q, href) => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page(search(q));

    expect(response.status).toBe(200);
    expect(tokensLinks(html)).toEqual([href]);
    expect(mock.requests).toEqual([]);
  });

  it("offers it on Xahau as well, for its own native code too", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/search?q=XAH");
    expect(tokensLinks(html)).toEqual(["/xahau/tokens?q=XAH"]);
    expect(textOf(html)).toContain("Look for “XAH” among tokens →");
  });

  // The list's own limit (spec 2.4), counted in code points as D6 does (C18): a text beyond it would get the list's message and no list.
  it.each([
    ["64 characters", "x".repeat(64), true],
    ["65 characters", "x".repeat(65), false],
    ["64 emoji, which are 128 UTF-16 units", "😀".repeat(64), true],
    ["65 emoji", "😀".repeat(65), false],
  ])("offers the list for %s only up to 64 characters", async (_what, q, offered) => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page(search(q));

    expect(response.status).toBe(200);
    expect(tokensLinks(html)).toHaveLength(offered ? 1 : 0);
    expect(textOf(html)).toContain("Nothing on XRPL looks like");
    expect(mock.requests).toEqual([]);
  });

  it("writes a hostile text as text, in the label and in the query", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(search("<b>x</b>"));

    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("Look for “&lt;b&gt;x&lt;/b&gt;” among tokens →");
    expect(tokensLinks(html)).toEqual(["/xrpl/tokens?q=%3Cb%3Ex%3C%2Fb%3E"]);
  });

  it("leaves what classify knows alone: an address, a hash, a ledger index, a CTID and an empty box are what they were", async () => {
    mock = mockUpstream("xrpl");
    const address = await get(search(ADDRESS));
    await address.text();
    expect(address.headers.get("Location")).toBe(`/xrpl/account/${ADDRESS}`);
    const index = await get(search("107695660"));
    await index.text();
    expect(index.headers.get("Location")).toBe("/xrpl/ledger/107695660");
    const empty = await page(search(""));
    expect(tokensLinks(empty.html)).toEqual([]);
    expect(textOf(empty.html)).toContain("Search XRPL");
  });
});

describe("the route", () => {
  it("sets a title that names the search and the network", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(search("hello"));
    expect(html).toMatch(/<title>[^<]*Search[^<]*XRPL[^<]*<\/title>/);
  });

  // What a search from the box does once JavaScript has loaded: React Router asks for the `.data` URL and follows the redirect.
  it("redirects in the `.data` response a client-side navigation reads", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/search.data?q=107695660");
    const body = await response.text();

    expect(response.status).toBe(202);
    expect(body).toContain("/xrpl/ledger/107695660");
    expect(body).toContain("SingleFetchRedirect");
  });

  it("answers the `.data` URL of a page with the page's data, stored for the short class", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/search.data?q=hello+there");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("hello there");
    expect(await storedAs("/xrpl/search.data?q=hello+there")).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 of class short on a network that does not exist", async () => {
    const response = await get("/doge/search?q=1");
    await response.text();
    expect(response.status).toBe(404);
    expect(await storedAs("/doge/search?q=1")).toEqual({ cls: "short", ttl: 30 });
  });
});
