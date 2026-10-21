import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classicAddressToXAddress, encodeAccountID, xAddressToClassicAddress } from "ripple-address-codec";

import { shortAddress } from "../../app/domain/format";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import { encodeQr, qrPath } from "../../app/server/qr";
import { anchors, elementText, hrefs as rawHrefs, pageClient, tableRows, textOf } from "../support/pages";
import { dataApiError, mockUpstream, nodeError, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";

// The account page, `/{net}/account/{address}`, on the real Worker against the recorded answers of the data API and the nodes
// (test/fixtures/http/) and, where a test needs what the recordings do not hold (offers, escrows, an LP token, a domain, a node that
// is down), answers of its own.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included (and an error is never stored), so:
// the tests of failing upstreams come first, and each of them asks for an account nobody else asks for (`account(n)` makes one
// from a number: a valid address, funded in no recording, whose every answer the test gives). The server_state of the node is
// shared, so the one test that makes it fail is the very first.

const { page, get, stored, storedAs } = pageClient("198.18.0");

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

// The recorded accounts (test/fixtures/http, README "Upstream fixtures").
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const XAHAU_DELETED = "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD";
const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
const TAGGED = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const X_ADDRESS_WITH_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ2qXW7DhMWWpGmjhqyr";
const X_ADDRESS_NO_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ26KqXMt3GKX2eENgJ9";

const LIVE = { cls: "live", ttl: 5 };
const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };
// A page reached with a marker: `slow`, not `immutable` (MARKER_PAGE_CLASS in cache-class.ts), because backfill writes history below the marker.
const MARKER_PAGE = { cls: "slow", ttl: 3_600 };
const SHORT = { cls: "short", ttl: 30 };

/** A valid address that no recording has: 20 bytes of `n`. */
const account = (n: number) => encodeAccountID(new Uint8Array(20).fill(n));

/** The `href`s of a page as a browser reads them (`&amp;` is `&`). */
const hrefs = (html: string) => rawHrefs(html).map((href) => href.replace(/&amp;/g, "&"));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

// ---- Answers ---------------------------------------------------------------------------------------------------------------

const nodeOk = (result: Record<string, unknown>) => Response.json({ result: { ...result, status: "success" } });
const nodeDown = () => new Response("down", { status: 500 });

/** The rows of the recorded transaction list of the XRPL account, for accounts that need a history to show. */
const rawLists = import.meta.glob("../fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/*.json", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;
async function recordedList(name: string): Promise<{ result: string; count: number; marker?: string; transactions?: unknown[]; payments?: unknown[]; exchanges?: unknown[] }> {
  const load = rawLists[`../fixtures/http/xrpl/data-api/accounts/${ACTIVE}/${name}.json`];
  if (!load) throw new Error(`no recorded list ${name}`);
  return JSON.parse(await load());
}

interface Health {
  /** The account's `account_info` fields over the defaults. */
  info?: Record<string, unknown>;
  /** What the node lists as its objects, and a marker when it has more. */
  objects?: Array<Record<string, unknown>>;
  objectsMarker?: string;
  /** The balances after the native one. */
  tokens?: Array<Record<string, unknown>>;
}

/** The answers of a healthy active account of `address` on the XRP Ledger, except for its lists, which a test adds. */
function healthy(address: string, health: Health = {}): Overrides {
  const objects = health.objects ?? [];
  return {
    [`GET /v2/accounts/${address}`]: {
      result: "success",
      account_data: { account: address, parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", initial_balance: "25", inception: "2025-07-15T18:30:43Z", ledger_index: 97500000, tx_hash: "9B".repeat(32) },
    },
    [`GET /v2/accounts/${address}/balances`]: {
      result: "success",
      ledger_index: 107721455,
      limit: 200,
      balances: [{ currency: "XRP", value: "25" }, ...(health.tokens ?? [])],
    },
    [`node account_info ${address}`]: {
      account_data: {
        Account: address,
        Balance: "25000000",
        Flags: 0,
        LedgerEntryType: "AccountRoot",
        OwnerCount: objects.length,
        PreviousTxnID: "C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143",
        PreviousTxnLgrSeq: 107720688,
        Sequence: 12,
        ...health.info,
      },
      ledger_index: 107721455,
      validated: true,
    },
    [`node account_objects ${address}`]: {
      account: address,
      account_objects: objects,
      ledger_index: 107721455,
      validated: true,
      ...(health.objectsMarker ? { marker: health.objectsMarker } : {}),
    },
  };
}

const LIST = (address: string, kind: "transactions" | "payments" | "exchanges", marker?: string) =>
  `GET /v2/accounts/${address}/${kind}?descending=true&limit=20${marker ? `&marker=${marker}` : ""}`;

/** `healthy` with the account's recorded history as its list of transactions. */
async function withHistory(address: string, health: Health = {}, extra: Overrides = {}): Promise<Overrides> {
  return { ...healthy(address, health), [LIST(address, "transactions")]: await recordedList("transactions@descending=true&limit=20"), ...extra };
}

const requests = (m: UpstreamMock, kind: "node" | "data-api") => m.requests.filter((r) => r.kind === kind);

/**
 * What a `.data` URL (a client-side navigation, a Retry) answers, decoded. It is turbo-stream: a flat list in which every key, string and
 * value is an element and objects and lists refer to elements by index, then one line `P<id>:[...]` for each promise of the data when it
 * settles, continuing the same index space. A promise is decoded in place; one that never settled is `"pending"`.
 */
function decodeData(body: string): Record<string, { data: Record<string, unknown> }> {
  const [first, ...rest] = body.split("\n").filter(Boolean);
  const flat: unknown[] = JSON.parse(first!);
  const settled = new Map<number, number>();
  for (const line of rest) {
    const match = /^P(\d+):(.*)$/.exec(line);
    if (!match) throw new Error(`not a promise line: ${line.slice(0, 80)}`);
    settled.set(Number(match[1]), flat.length);
    flat.push(...(JSON.parse(match[2]!) as unknown[]));
  }
  const decode = (index: number): unknown => {
    // -5 is null and -1 is undefined; the data has neither a NaN nor an infinity.
    if (index < 0) return index === -5 ? null : undefined;
    const item = flat[index];
    if (Array.isArray(item)) {
      if (item[0] === "P") return settled.has(item[1] as number) ? decode(settled.get(item[1] as number)!) : "pending";
      return item.map((entry) => decode(entry as number));
    }
    if (typeof item === "object" && item !== null) {
      return Object.fromEntries(Object.entries(item).map(([key, value]) => [flat[Number(key.slice(1))] as string, decode(value as number)]));
    }
    return item;
  };
  return decode(0) as Record<string, { data: Record<string, unknown> }>;
}
const ACCOUNT_ROUTE = "routes/net.account.$address";

// ---------------------------------------------------------------------------------------------------------------------------
// When an upstream fails. First in the file.

describe("when the node cannot tell the reserves", () => {
  it("shows the account with its balance, without the reserve, says the live state is unavailable, and does not store the page", async () => {
    const a = account(1);
    mock = mockUpstream("xrpl", { ...(await withHistory(a)), "node server_state": () => nodeDown() });

    const response = await get(`/xrpl/account/${a}`);
    const html = await response.text();
    const text = textOf(html);

    expect(response.status).toBe(200);
    expect(text).toContain("Live state unavailable");
    expect(text).toContain("XRP balance 25");
    expect(text).not.toContain("Available");
    expect(text).not.toContain("Reserve");
    // The history is the index's, and is there.
    expect(tableRows(html, "Transactions")).toHaveLength(5);
    expect(statusesOf(mock, "node server_state")).toEqual([500]);
    // A degraded answer is not kept by the browser either.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("when the node is down", () => {
  it("renders the history with 'Live state unavailable' and the index's balance, stores nothing, and a later good render is stored", async () => {
    const a = account(2);
    let down = true;
    const overrides = await withHistory(a);
    mock = mockUpstream("xrpl", {
      ...overrides,
      [`node account_info ${a}`]: () => (down ? nodeDown() : nodeOk(overrides[`node account_info ${a}`] as Record<string, unknown>)),
      [`node account_objects ${a}`]: () => (down ? nodeDown() : nodeOk(overrides[`node account_objects ${a}`] as Record<string, unknown>)),
    });

    const first = await get(`/xrpl/account/${a}`);
    const html = await first.text();
    const text = textOf(html);
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(text).toContain("Live state unavailable");
    // The account page's notice is a live region (the pair page's is not): a screen reader hears it.
    expect(html).toMatch(/class="notice notice--warning" role="status"/);
    expect(text).toContain("XRP balance 25");
    // What only the node tells is not there.
    expect(text).not.toContain("Sequence");
    expect(text).not.toContain("Owned objects");
    expect(text).not.toContain("Reserve");
    expect(html).toContain("Retry");
    expect(tableRows(html, "Transactions")).toHaveLength(5);
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);

    down = false;
    const good = await get(`/xrpl/account/${a}`);
    const goodText = textOf(await good.text());
    expect(good.headers.get("X-Cache")).toBe("MISS");
    expect(goodText).not.toContain("Live state unavailable");
    expect(goodText).toContain("Sequence 12");
    expect(goodText).toContain("Reserve 1 XRP = 1 base + 0 objects × 0.2");
    expect(await storedAs(`/xrpl/account/${a}`)).toEqual(LIVE);
  });

  it("says the same when only the objects cannot be read: the rest of the live state is there, the owned objects are not", async () => {
    const a = account(3);
    mock = mockUpstream("xrpl", { ...(await withHistory(a)), [`node account_objects ${a}`]: () => nodeDown() });
    const response = await get(`/xrpl/account/${a}`);
    const text = textOf(await response.text());
    expect(response.status).toBe(200);
    expect(text).toContain("Live state unavailable");
    expect(text).toContain("Sequence 12");
    expect(text).not.toContain("Owned objects");
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);
  });
});

describe("when the list of the tab cannot be loaded", () => {
  it("renders the header, says 'Couldn’t load transactions' with a Retry in place of the list, stores nothing, and stores the next good render", async () => {
    const a = account(4);
    let calls = 0;
    const history = await recordedList("transactions@descending=true&limit=20");
    mock = mockUpstream("xrpl", {
      ...healthy(a),
      [LIST(a, "transactions")]: () => (++calls === 1 ? dataApiError(503, "unavailable") : Response.json(history)),
    });

    const first = await get(`/xrpl/account/${a}`);
    const html = await first.text();
    const text = textOf(html);
    expect(first.status).toBe(200);
    expect(text).toContain(a);
    expect(text).toContain("XRP balance 25");
    expect(text).toContain("Couldn’t load transactions");
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(tableRows(html, "Transactions")).toEqual([]);
    expect(statusesOf(mock, LIST(a, "transactions"))).toEqual([503]);
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);

    const second = await get(`/xrpl/account/${a}`);
    const again = await second.text();
    expect(second.headers.get("X-Cache")).toBe("MISS");
    expect(textOf(again)).not.toContain("Couldn’t load");
    expect(tableRows(again, "Transactions")).toHaveLength(5);
    expect(await storedAs(`/xrpl/account/${a}`)).toEqual(LIVE);
  });

  it("does the same on the data URL a client-side navigation (and a Retry) fetches, and a later good one is stored", async () => {
    const a = account(5);
    let calls = 0;
    const history = await recordedList("transactions@descending=true&limit=20");
    mock = mockUpstream("xrpl", {
      ...healthy(a),
      [LIST(a, "transactions")]: () => (++calls === 1 ? dataApiError(500, "boom") : Response.json(history)),
    });

    const first = await get(`/xrpl/account/${a}.data`);
    const failed = decodeData(await first.text())[ACCOUNT_ROUTE]!.data;
    expect(first.status).toBe(200);
    // The header is the page's own, and the list is the failed state the page shows "Couldn’t load transactions" for.
    expect(failed).toMatchObject({ kind: "account", mode: "live", address: a, tab: "transactions", header: { status: "active" } });
    expect(failed.list).toEqual({ state: "failed", what: "transactions" });
    expect(await isStored(`/xrpl/account/${a}.data`)).toBe(false);

    const second = await get(`/xrpl/account/${a}.data`);
    const good = decodeData(await second.text())[ACCOUNT_ROUTE]!.data;
    expect(second.headers.get("X-Cache")).toBe("MISS");
    expect(good.list).toMatchObject({ state: "ok", tab: "transactions", paging: { newerHref: null, olderHref: `/xrpl/account/${a}?marker=WzEwNzYxMjU3MywyNV0` } });
    expect((good.list as { rows: Array<{ type: string }> }).rows.map((row) => row.type)).toEqual(["OfferCreate", "OfferCreate", "Payment", "OfferCreate"]);
    expect(await storedAs(`/xrpl/account/${a}.data`)).toEqual(LIVE);
  });

  it("gives up on a list that takes longer than 4.5 s, before the framework stops streaming at 5 s, and does not store the page", async () => {
    const a = account(6);
    mock = mockUpstream("xrpl", { ...healthy(a), [LIST(a, "transactions")]: () => new Promise<Response>(() => {}) });
    const started = Date.now();
    const response = await get(`/xrpl/account/${a}`);
    const html = await response.text();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(textOf(html)).toContain("Couldn’t load transactions");
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);
  }, 15_000);

  it("says the same of the payments, and of the trades", async () => {
    const a = account(7);
    mock = mockUpstream("xrpl", {
      ...healthy(a),
      [LIST(a, "payments")]: () => dataApiError(500, "boom"),
      [LIST(a, "exchanges")]: () => dataApiError(500, "boom"),
    });
    for (const [tab, what] of [["payments", "payments"], ["trades", "trades"]] as const) {
      const { html } = await page(`/xrpl/account/${a}?tab=${tab}`);
      expect(textOf(html)).toContain(`Couldn’t load ${what}`);
      expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
    }
  });
});

describe("when the index cannot give the balances", () => {
  it("shows the account, says 'Couldn’t load tokens' with a Retry, and stores nothing", async () => {
    const a = account(8);
    mock = mockUpstream("xrpl", { ...(await withHistory(a)), [`GET /v2/accounts/${a}/balances`]: () => dataApiError(500, "boom") });
    const response = await get(`/xrpl/account/${a}`);
    const html = await response.text();
    const text = textOf(html);
    expect(response.status).toBe(200);
    expect(text).toContain("Couldn’t load tokens");
    // The node's balance is there anyway, and so is the rest.
    expect(text).toContain("XRP balance 25");
    expect(text).toContain("Sequence 12");
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);
  });
});

describe("when the account cannot be told apart from one that does not exist", () => {
  it("answers 503 when the index fails on the account", async () => {
    const a = account(9);
    mock = mockUpstream("xrpl", { ...healthy(a), [`GET /v2/accounts/${a}`]: () => dataApiError(500, "boom") });
    const response = await get(`/xrpl/account/${a}`);
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);
  });

  it("answers 503, not 'never activated', when the index has no creation and the node did not answer", async () => {
    const a = account(10);
    mock = mockUpstream("xrpl", { ...healthy(a), [`GET /v2/accounts/${a}`]: null, [`node account_info ${a}`]: () => nodeDown() });
    const response = await get(`/xrpl/account/${a}`);
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(textOf(html)).not.toContain("never been activated");
    // The node failing is already the answer: nobody asks the history.
    expect(mock.requests.some((r) => r.key.endsWith("/transactions?limit=1"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Addresses that are not an account, and an account that is not there

describe("an address that is not an account", () => {
  it("is a 404 of class short without a call for an address with a wrong checksum", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jX", 404);
    expect(textOf(html)).toContain("We couldn’t find account");
    expect(mock.requests).toEqual([]);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
    expect(await storedAs("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jX")).toEqual(SHORT);
  });

  it.each(["hello", "0".repeat(200), "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh%0A", "%3Cscript%3E"])("is a 404 for %s, without a call", async (id) => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${id}`, 404);
    expect(html).not.toContain("<script>alert");
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 for an address on a network that does not exist", async () => {
    mock = mockUpstream("xrpl");
    await page(`/bitcoin/account/${ACTIVE}`, 404);
    expect(mock.requests).toEqual([]);
  });
});

describe("an X-address", () => {
  it("is a 302 of class immutable to the classic address with its tag, without a call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/account/${X_ADDRESS_WITH_TAG}`);
    await response.text();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/account/${TAGGED}?tag=104882`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(`/xrpl/account/${X_ADDRESS_WITH_TAG}`)).toEqual(IMMUTABLE);
  });

  it("leaves the tag out when it has none, and keeps the network", async () => {
    mock = mockUpstream("xahau");
    const response = await get(`/xahau/account/${X_ADDRESS_NO_TAG}`);
    await response.text();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xahau/account/${TAGGED}`);
  });
});

describe("an address that was never activated", () => {
  it("is a 404 of class short, noindex, that says so and offers the other network", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${NEVER_FUNDED}`, 404);
    const text = textOf(html);
    expect(text).toContain("This address has never been activated");
    expect(text).toContain(NEVER_FUNDED);
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
    expect(html).toContain("<title>Address not activated · XRPL · explorer</title>");
    expect(hrefs(html)).toContain(`/xahau/account/${NEVER_FUNDED}`);
    expect(await storedAs(`/xrpl/account/${NEVER_FUNDED}`)).toEqual(SHORT);
    // Three questions were asked: the index, the node and, since neither has the account, whether the index has a history of it.
    expect(mock.requests.some((r) => r.kind === "node" && r.key.startsWith("node account_info"))).toBe(true);
    expect(mock.requests.some((r) => r.key === `GET /v2/accounts/${NEVER_FUNDED}`)).toBe(true);
    expect(statusesOf(mock, `GET /v2/accounts/${NEVER_FUNDED}/transactions?limit=1`)).toEqual([200]);
  });

  /** An address the index has no creation of and the node has no account for: only its history decides. */
  const unknown = (a: string, history: unknown): Overrides => ({
    [`GET /v2/accounts/${a}`]: null,
    [`GET /v2/accounts/${a}/balances`]: null,
    [`node account_info ${a}`]: nodeError("actNotFound"),
    [`node account_objects ${a}`]: nodeError("actNotFound"),
    [`GET /v2/accounts/${a}/transactions?limit=1`]: history as never,
    [LIST(a, "transactions")]: history as never,
  });

  it("is a 404 when the history is empty too, and the history was asked for as one row, once", async () => {
    const a = account(60);
    mock = mockUpstream("xrpl", unknown(a, { result: "success", count: 0, transactions: [] }));
    const { html } = await page(`/xrpl/account/${a}`, 404);
    expect(textOf(html)).toContain("This address has never been activated");
    expect(statusesOf(mock, `GET /v2/accounts/${a}/transactions?limit=1`)).toEqual([200]);
    expect(await storedAs(`/xrpl/account/${a}`)).toEqual(SHORT);
  });

  it("is the deleted account's history, with the activation unknown, when the index has a history of it", async () => {
    const a = account(61);
    const history = await recordedList("transactions@descending=true&limit=20");
    mock = mockUpstream("xrpl", unknown(a, history));
    const { html } = await page(`/xrpl/account/${a}`);
    const text = textOf(html);
    expect(text).toContain("Deleted This account was deleted from the ledger");
    expect(text).toContain("Activation is not in the index.");
    expect(text).not.toContain("never been activated");
    expect(text).not.toContain("Live state unavailable");
    expect(tableRows(html, "Transactions")).toHaveLength(5);
    expect(statusesOf(mock, `GET /v2/accounts/${a}/transactions?limit=1`)).toEqual([200]);
    expect(await storedAs(`/xrpl/account/${a}`)).toEqual(LIVE);
  });

  it("answers 503, not 'never activated', when the history cannot be asked for, and stores nothing", async () => {
    const a = account(62);
    mock = mockUpstream("xrpl", {
      ...unknown(a, { result: "success", count: 0, transactions: [] }),
      [`GET /v2/accounts/${a}/transactions?limit=1`]: () => dataApiError(500, "boom"),
    });
    const response = await get(`/xrpl/account/${a}`);
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(textOf(html)).not.toContain("never been activated");
    expect(statusesOf(mock, `GET /v2/accounts/${a}/transactions?limit=1`)).toEqual([500]);
    expect(await isStored(`/xrpl/account/${a}`)).toBe(false);
  });

  it("asks for the history of no account the index or the node knows", async () => {
    const a = account(63);
    mock = mockUpstream("xrpl", { ...(await withHistory(a)), [`GET /v2/accounts/${a}`]: null });
    await page(`/xrpl/account/${a}`);
    expect(mock.requests.some((r) => r.key.endsWith("/transactions?limit=1"))).toBe(false);
  });

  it("is the same on Xahau", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/account/${NEVER_FUNDED}`, 404);
    expect(textOf(html)).toContain("This address has never been activated on Xahau");
    expect(hrefs(html)).toContain(`/xrpl/account/${NEVER_FUNDED}`);
  });
});

describe("a deleted account", () => {
  it("renders its history with a 'Deleted' banner, without a balance or live state, and is stored as live", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${DELETED}`);
    const text = textOf(html);
    expect(text).toContain("Deleted This account was deleted from the ledger");
    expect(text).toContain("The account no longer exists");
    expect(text).not.toContain("Live state unavailable");
    expect(text).not.toContain("Tokens");
    expect(text).not.toContain("Owned objects");
    expect(text).not.toContain("Sequence");
    const rows = tableRows(html, "Transactions");
    expect(rows).toHaveLength(2);
    expect(rows[1]![1]).toBe("AccountDelete");
    // The index knows it, so nobody asks whether it has a history.
    expect(mock.requests.some((r) => r.key.endsWith("/transactions?limit=1"))).toBe(false);
    expect(await storedAs(`/xrpl/account/${DELETED}`)).toEqual(LIVE);
  });

  it("is the same on Xahau, and the other tabs have nothing to read for it", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/account/${XAHAU_DELETED}`);
    expect(textOf(html)).toContain("This account was deleted from the ledger");
    expect(tableRows(html, "Transactions").length).toBeGreaterThan(1);
    const objects = await page(`/xahau/account/${XAHAU_DELETED}?tab=objects`);
    expect(textOf(objects.html)).toContain("This account owns no other objects");
    const offers = await page(`/xahau/account/${XAHAU_DELETED}?tab=offers`);
    expect(textOf(offers.html)).toContain("This account has no open offers");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The active XRPL account

describe("the active XRPL account", () => {
  const path = `/xrpl/account/${ACTIVE}`;

  it("shows the address, how it was activated, the sequence, the balance with the reserve computed from server_state, and the tokens", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page(path);
    const text = textOf(html);

    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(elementText(html, "account-id__address")).toContain(ACTIVE);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${ACTIVE}</h1>`));

    expect(text).toContain(`Activated on 2025-07-15 18:30:43 UTC by ${shortAddress("rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ")} with 25 XRP`);
    expect(hrefs(html)).toContain("/xrpl/account/rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ");
    expect(hrefs(html)).toContain(`/xrpl/tx/9B107B80D5606BB743A58ED7EA6DCA1BDC1E8619FBFA531CD881523C1DCC76F1`);
    expect(text).toContain("Sequence 98,986,800");
    expect(text).toContain("XRP balance 10.001625");
    // 1 base + 1 object * 0.2 = 1.2 reserve, from the node's server_state; 10.001625 - 1.2 available.
    expect(text).toContain("Available 8.801625");
    expect(text).toContain("Reserve 1.2 XRP = 1 base + 1 object × 0.2");
    expect(text).toContain("Read live from the network at ledger #107,721,455.");

    // Tokens: the LIONS line, its code as text, its issuer, its balance.
    expect(text).toContain("Tokens 1 trust line");
    expect(text).toContain("LIONS rGHtf1…AuzS 48,329.908117603");
    expect(hrefs(html)).toContain("/xrpl/account/rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS");
    // Owned objects: counts by type.
    expect(text).toContain("Owned objects 1 trust line");
  });

  it("shows the last activity as a link to the transaction, with its time and never an age", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(path);
    expect(hrefs(html)).toContain("/xrpl/tx/C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143");
    expect(textOf(html)).toContain("Last active 2026-10-17 16:11:02 UTC");
    expect(textOf(html)).not.toMatch(/\d+ (s|min|h|d) ago/);
  });

  it("has the QR code of the address in the page, inside a closed <details>, and the copy button", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(path);
    const details = /<details class="qr">([\s\S]*?)<\/details>/.exec(html);
    expect(details).not.toBeNull();
    expect(details![0]).not.toContain(" open");
    expect(details![1]).toContain(`aria-label="QR code of the address ${ACTIVE}"`);
    expect(details![1]).toMatch(/<path d="M\d+ \d+h\d+v1h-\d+z/);
    expect(html).toContain('aria-label="Show QR code"');
    expect(html).toContain('aria-label="Copy address"');
    // An identicon is drawn from the address.
    expect(html).toMatch(/<svg class="identicon"[^>]*aria-hidden="true"/);
  });

  it("draws the QR code of the X-address, destination tag included, when the URL has a valid ?tag, and of the classic address otherwise", async () => {
    const a = account(28);
    mock = mockUpstream("xrpl", await withHistory(a));
    const pathOf = (html: string) => /<svg class="qr__code"[^>]*>[\s\S]*?<path d="([^"]*)"/.exec(html)![1];
    const x = classicAddressToXAddress(a, 104882, false);
    // The X-address is the address with the tag, whichever way it is written.
    expect(xAddressToClassicAddress(x)).toMatchObject({ classicAddress: a, tag: 104882 });

    const plain = await page(`/xrpl/account/${a}`);
    expect(pathOf(plain.html)).toBe(qrPath(encodeQr(a)));
    expect(plain.html).toContain(`aria-label="QR code of the address ${a}"`);
    expect(textOf(plain.html)).toContain("Scan it with a wallet to get the address.");

    const tagged = await page(`/xrpl/account/${a}?tag=104882`);
    expect(pathOf(tagged.html)).toBe(qrPath(encodeQr(x)));
    expect(pathOf(tagged.html)).not.toBe(pathOf(plain.html));
    expect(tagged.html).toContain(`aria-label="QR code of the X-address ${x}, which is the address with destination tag 104882"`);
    expect(textOf(tagged.html)).toContain("Scan it with a wallet to get the address and destination tag 104882.");

    // A tag that is not one is not in the code, as it is not on the page.
    const bad = await page(`/xrpl/account/${a}?tag=abc`);
    expect(pathOf(bad.html)).toBe(qrPath(encodeQr(a)));
  });

  it("lists the transactions newest first with what the account's balance did, and links each to its page", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(path);
    const rows = tableRows(html, "Transactions");
    expect(rows[0]).toEqual(["Date (UTC)", "Type", "What happened", "Change (XRP)", "Result"]);
    expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual([
      ["2026-10-17 16:11:02", "OfferCreate"],
      ["2026-10-17 15:34:10", "OfferCreate"],
      ["2026-10-13 21:34:30", "Payment"],
      ["2026-10-12 19:36:41", "OfferCreate"],
    ]);
    // Someone else's transaction names its sender; the account's own does not.
    expect(rows[1]![2]).toMatch(/^rDFDjd…fy48 offered to buy 15,235\.08 LIONS for 2\.411362 XRP$/);
    expect(rows[2]![2]).toMatch(/^Offered to buy 14,822\.07 LIONS for 2\.345993 XRP$/);
    expect(rows[1]![3]).toBe("+2.411362 XRP +1 more");
    expect(rows[2]![3]).toBe("−2.346005 XRP +1 more");
    expect(rows[3]![3]).toBe("+0.00001 XRP");
    expect(rows[4]![3]).toBe("−0.000012 XRP");
    expect(rows.slice(1).every((r) => r[4] === "Success")).toBe(true);
    expect(hrefs(html)).toContain("/xrpl/tx/C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143");
    expect(textOf(html)).toContain("4 transactions");
  });

  it("has the six tabs as links, Analytics with rel=nofollow (ACCOUNT_ANALYTICS is on here; account-analytics-off.spec.ts has it off)", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(path);
    const nav = /<nav class="tabs" aria-label="Account activity">([\s\S]*?)<\/nav>/.exec(html);
    expect(nav).not.toBeNull();
    const tabs = anchors(nav![1]!).map((a) => [a.text, /href="([^"]*)"/.exec(a.attrs)![1], a.attrs.includes('aria-current="page"'), /rel="([^"]*)"/.exec(a.attrs)?.[1] ?? null]);
    expect(tabs).toEqual([
      ["Transactions", `/xrpl/account/${ACTIVE}`, true, null],
      ["Payments", `/xrpl/account/${ACTIVE}?tab=payments`, false, null],
      ["Trades", `/xrpl/account/${ACTIVE}?tab=trades`, false, null],
      ["Offers", `/xrpl/account/${ACTIVE}?tab=offers`, false, null],
      ["Objects", `/xrpl/account/${ACTIVE}?tab=objects`, false, null],
      ["Analytics", `/xrpl/account/${ACTIVE}?tab=analytics`, false, "nofollow"],
    ]);
    expect(nav![1]).not.toContain("is-soon");
  });

  it("is stored as class live: 5 s at the edge, revalidated by the browser", async () => {
    mock = mockUpstream("xrpl");
    await page(path);
    expect(await storedAs(path)).toEqual(LIVE);
  });

  it("has a title and a description built from its data, and is indexable", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(path);
    expect(html).toContain(`<title>Account ${shortAddress(ACTIVE)} · XRPL · explorer</title>`);
    expect(html).toMatch(new RegExp(`<meta name="description" content="${ACTIVE} on XRPL: Balance 10\\.001625 XRP, activated 2025-07-15\\.`));
    expect(html).not.toMatch(/<meta name="robots"/);
  });

  it("asks the data API for the account, its balances, the first page of the tab and the ledger of its last transaction, and the node for the account and its objects: nothing else, once, and shows none of it", async () => {
    // A made-up account, so that nothing it asks for is in the subrequest cache already (the tests above fill it for the recorded one) and
    // every request reaches the mock. server_state is the one answer all accounts share, cached for 5 minutes: it is asked for at most once.
    const a = account(66);
    mock = mockUpstream("xrpl", {
      ...(await withHistory(a, { info: { PreviousTxnLgrSeq: 107700777 } })),
      "GET /v2/ledgers/107700777": { result: "success", ledger: { ledger_index: 107700777, close_time: 1792253462 } },
    });
    const { html } = await page(`/xrpl/account/${a}`);

    const asked = mock.requests.filter((r) => r.key !== "node server_state").map((r) => r.key).sort();
    expect(asked).toEqual(
      [
        `GET /v2/accounts/${a}`,
        `GET /v2/accounts/${a}/balances`,
        `GET /v2/accounts/${a}/transactions?descending=true&limit=20`,
        "GET /v2/ledgers/107700777",
        `node account_info account=${a}&ledger_index=validated`,
        `node account_objects account=${a}&ledger_index=validated&limit=400`,
      ].sort(),
    );
    expect(mock.requests.filter((r) => r.key === "node server_state").length).toBeLessThanOrEqual(1);
    expect(mock.requests.every((r) => r.net === "xrpl")).toBe(true);
    expect(mock.requests.every((r) => r.status === 200)).toBe(true);

    for (const request of requests(mock, "data-api")) {
      expect(request.method).toBe("GET");
      expect(request.headers.get("X-API-Key")).toBe("test-key");
    }
    for (const request of requests(mock, "node")) expect(request.method).toBe("POST");

    // The browser never reaches the data API or the node: the page names neither host, nor the key, in its markup or its data.
    const hosts = [env.XRPL_DATA_API_URL, env.XAHAU_DATA_API_URL, env.XRPL_NODE_URL, env.XAHAU_NODE_URL].map((url) => new URL(url).host);
    expect(hosts.length).toBe(4);
    for (const host of hosts) expect(html, host).not.toContain(host);
    expect(html).not.toContain("example.invalid");
    expect(html).not.toContain("test-key");
  });
});

describe("the active Xahau account", () => {
  it("shows XAH, a regular key and a disabled master key, and its reserve from its own server_state", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/account/${XAHAU_ACTIVE}`);
    const text = textOf(html);
    expect(text).toContain("XAH balance 9,351.039221");
    expect(text).toContain("Master key disabled");
    expect(text).toContain("Regular key set");
    expect(text).toContain("Sequence 755,783,996");
    expect(text).toContain("Available 9,349.639221");
    expect(text).toContain("Reserve 1.4 XAH = 1 base + 2 objects × 0.2");
    expect(text).toContain("EVR rEvern…HXr8 28,437,367.3675102");
    expect(html).toContain(`<title>Account ${shortAddress(XAHAU_ACTIVE)} · Xahau · explorer</title>`);
    expect(await storedAs(`/xahau/account/${XAHAU_ACTIVE}`)).toEqual(LIVE);
  });
});

describe("what the recordings do not hold", () => {
  it("decodes the domain from hex and shows it as text, never as a link", async () => {
    const a = account(20);
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { Domain: "6578616D706C652E636F6D" } })) });
    const { html } = await page(`/xrpl/account/${a}`);
    expect(textOf(html)).toContain("· domain example.com");
    expect(hrefs(html).some((href) => href.includes("example.com"))).toBe(false);
  });

  it("names the flag that asks not to receive XRP as an ask, not a block", async () => {
    const a = account(27);
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { Flags: 0x00080000 } })) });
    const { html } = await page(`/xrpl/account/${a}`);
    expect(textOf(html)).toContain("Asks not to receive XRP");
    expect(textOf(html)).not.toContain("Blocks incoming");
  });

  it("names the flags of the account and its regular key", async () => {
    const a = account(21);
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { Flags: 0x00020000 | 0x00800000, RegularKey: account(99) } })) });
    const { html } = await page(`/xrpl/account/${a}`);
    const text = textOf(html);
    expect(text).toContain("Requires destination tag");
    expect(text).toContain("Default ripple");
    expect(text).toContain("Regular key set");
  });

  it("shows an LP token as 'LP token' with its AMM pool", async () => {
    const a = account(22);
    const pool = account(98);
    const lp = `03${"AB".repeat(19)}`;
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { tokens: [{ currency: lp, counterparty: pool, value: "1042.77" }, { currency: "USD", counterparty: account(97), value: "3120.50" }] })) });
    const { html } = await page(`/xrpl/account/${a}`);
    const text = textOf(html);
    expect(text).toContain(`LP token AMM pool ${shortAddress(pool)} 1,042.77`);
    expect(text).toContain(`USD ${shortAddress(account(97))} 3,120.50`);
    expect(text).toContain("Tokens 2 trust lines");
    // AMM_PAGES is on (the top level): "AMM pool r…" is one link, to the pool page. worker-off's amm-off.spec.ts has the account page's link.
    const poolLink = anchors(html).find((a) => a.text === `AMM pool ${shortAddress(pool)}`);
    expect(poolLink?.attrs).toContain(`href="/xrpl/amm/${pool}"`);
    expect(hrefs(html)).not.toContain(`/xrpl/account/${pool}`);
  });

  it("says on a pool account's page that it is one, with a link to the pool page, while AMM_PAGES is on", async () => {
    const a = account(70);
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { Flags: 0x02000000 } })) });
    const { html } = await page(`/xrpl/account/${a}`);
    const text = textOf(html);
    expect(text).toContain("AMM pool account");
    expect(elementText(html, "account-id__pool")).toBe("This account is an AMM pool. See the pool →");
    expect(anchors(html).find((a) => a.text === "See the pool →")?.attrs).toContain(`href="/xrpl/amm/${a}"`);
  });

  it("shows more than ten tokens with the rest under 'Show N more'", async () => {
    const a = account(23);
    const tokens = Array.from({ length: 13 }, (_, i) => ({ currency: "USD", counterparty: account(120 + i), value: String(i + 1) }));
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { tokens })) });
    const { html } = await page(`/xrpl/account/${a}`);
    expect(textOf(html)).toContain("Show 3 more");
    expect(html).toMatch(/<details class="more"><summary>Show 3 more<\/summary>/);
  });

  it("counts the objects it owns by type", async () => {
    const a = account(24);
    const objects = [{ LedgerEntryType: "RippleState" }, { LedgerEntryType: "RippleState" }, { LedgerEntryType: "Offer" }, { LedgerEntryType: "Escrow" }];
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { objects })) });
    const { html } = await page(`/xrpl/account/${a}`);
    const text = textOf(html);
    expect(text).toContain("Owned objects 2 trust lines 1 offer 1 escrow");
    expect(text).toContain("Reserve 1.8 XRP = 1 base + 4 objects × 0.2");
  });

  it("works out the reserve and the available balance from the reserves the node reports, in exact amounts", async () => {
    const a = account(25);
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { Balance: "99999999999999999", OwnerCount: 3 } })) });
    const { html } = await page(`/xrpl/account/${a}`);
    const text = textOf(html);
    expect(text).toContain("XRP balance 99,999,999,999.999999");
    expect(text).toContain("Available 99,999,999,998.399999");
  });

  it("has nothing available when the balance is under the reserve", async () => {
    const a = account(26);
    mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { Balance: "500000", OwnerCount: 2 } })) });
    const { html } = await page(`/xrpl/account/${a}`);
    expect(textOf(html)).toContain("Available 0");
  });
});

describe("the last activity", () => {
  // The time of "Last active" is the close time of the ledger of the account's last transaction: one more call, which the page does
  // without when it is slow, and which does not make the header wait for the rest of its calls.
  const ledgerAnswer = (index: number) => ({ result: "success", ledger: { ledger_index: index, close_time: 1792253462 } });

  it("starts the lookup as soon as account_info has answered, so the header takes as long as its slowest call, not two calls", async () => {
    const a = account(64);
    mock = mockUpstream("xrpl", {
      ...(await withHistory(a, { info: { PreviousTxnLgrSeq: 107700124 } })),
      [`GET /v2/accounts/${a}/balances`]: async () => {
        await sleep(1_200);
        return Response.json({ result: "success", ledger_index: 107721455, limit: 200, balances: [{ currency: "XRP", value: "25" }] });
      },
      "GET /v2/ledgers/107700124": async () => {
        await sleep(1_000);
        return Response.json(ledgerAnswer(107700124));
      },
    });
    const started = Date.now();
    const { html } = await page(`/xrpl/account/${a}`);
    // Sequential, the two would take 2.2 s.
    expect(Date.now() - started).toBeLessThan(1_900);
    expect(textOf(html)).toContain("Last active 2026-10-17 16:11:02 UTC");
  });

  // The ledger of the last transaction is not in the index while the index is behind the node (it is not yet ingested): that is an ordinary state
  // of an account that has just been active, not a problem to log for every visit. A failure of the lookup that is one still is.
  describe("when the lookup does not find a time", () => {
    const problemsLogged = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.flatMap(([line]) => {
        try {
          const parsed = JSON.parse(String(line)) as Record<string, unknown>;
          return String(parsed.what).includes("last transaction could not be read") ? [parsed] : [];
        } catch {
          return [];
        }
      });

    it("logs nothing when the ledger is not in the index yet, and the page shows the ledger instead of a time", async () => {
      const a = account(68);
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { PreviousTxnLgrSeq: 107700126 } })), "GET /v2/ledgers/107700126": null });
        const { html } = await page(`/xrpl/account/${a}`);
        expect(textOf(html)).toContain("Last active ledger #107,700,126");
        expect(statusesOf(mock, "GET /v2/ledgers/107700126")).toEqual([404]);
        expect(problemsLogged(logged)).toEqual([]);
        expect(await storedAs(`/xrpl/account/${a}`)).toEqual(LIVE);
      } finally {
        logged.mockRestore();
      }
    });

    it("still logs any other failure of the lookup, once, with the path", async () => {
      const a = account(69);
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        mock = mockUpstream("xrpl", { ...(await withHistory(a, { info: { PreviousTxnLgrSeq: 107700127 } })), "GET /v2/ledgers/107700127": () => dataApiError(500, "boom") });
        const { html } = await page(`/xrpl/account/${a}`);
        expect(textOf(html)).toContain("Last active ledger #107,700,127");
        const lines = problemsLogged(logged);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ level: "error", path: `/xrpl/account/${a}` });
        expect(String(lines[0]!.error)).toContain("500");
      } finally {
        logged.mockRestore();
      }
    });
  });

  it("gives up on the lookup after 1.5 s: the header shows the ledger instead of a time, and the page is not degraded", async () => {
    const a = account(65);
    mock = mockUpstream("xrpl", {
      ...(await withHistory(a, { info: { PreviousTxnLgrSeq: 107700125 } })),
      "GET /v2/ledgers/107700125": () => new Promise<Response>(() => {}),
    });
    const started = Date.now();
    const { html } = await page(`/xrpl/account/${a}`);
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(1_400);
    expect(took).toBeLessThan(2_600);
    const text = textOf(html);
    expect(text).toContain("Last active ledger #107,700,125");
    expect(text).toContain("Sequence 12");
    expect(text).not.toContain("Live state unavailable");
    expect(hrefs(html)).toContain("/xrpl/tx/C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143");
    // A page without a time is still a good page.
    expect(await storedAs(`/xrpl/account/${a}`)).toEqual(LIVE);
  }, 15_000);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The tabs

describe("the tabs", () => {
  it("?tab=transactions is the transactions", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=transactions`);
    expect(tableRows(html, "Transactions")).toHaveLength(5);
    expect(await storedAs(`/xrpl/account/${ACTIVE}?tab=transactions`)).toEqual(LIVE);
  });

  it("?tab=payments lists the payments, signed from the account's side, and links to the explorer's own CSV", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=payments`);
    const rows = tableRows(html, "Payments");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["Date (UTC)", "Direction", "Counterparty", "Delivered", "Tag"]);
    expect(rows[1]).toEqual(["2026-10-13 21:34:30", "Received", expect.stringMatching(/^rDQSFB…[A-Za-z0-9]{4}$/), "+0.00001 XRP", ""]);
    const csv = anchors(html).find((a) => a.text === "Download CSV");
    expect(csv?.attrs).toContain(`href="/xrpl/account/${ACTIVE}/payments.csv"`);
    expect(csv?.attrs).toContain("download");
    // A crawler does not follow it (each crawl would cost an upstream CSV); robots.txt says the same.
    expect(csv?.attrs).toContain('rel="nofollow"');
    expect(hrefs(html)).toContain(`/xrpl/account/${ACTIVE}?tab=payments&marker=WzEwNzYzNjY3Myw3OF0`);
    expect(await storedAs(`/xrpl/account/${ACTIVE}?tab=payments`)).toEqual(LIVE);
  });

  it("?tab=trades lists the trades with the side, the pair, the amount, the rate and the counterparty", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=trades`);
    const rows = tableRows(html, "Trades");
    expect(rows[0]).toEqual(["Date (UTC)", "Pair", "Side", "Amount", "Price", "Against"]);
    expect(rows).toHaveLength(3);
    // The account was the seller of the first (the taker bought), the buyer of the second.
    expect(rows[1]!.slice(1, 5)).toEqual(["LIONS/XRP", "Sell", "15,235.08 LIONS", "0.00015827695 XRP"]);
    expect(rows[2]!.slice(1, 5)).toEqual(["LIONS/XRP", "Buy", "14,822.07 LIONS", "0.00015827702 XRP"]);
    expect(hrefs(html)).toContain(`/xrpl/account/${ACTIVE}?tab=trades&marker=WzEwNzcyMDExNSw1MV0`);
  });

  it("?tab=offers lists the open offers read live, with the rate worked out from the quantity and the total", async () => {
    const a = account(30);
    mock = mockUpstream("xrpl", {
      ...healthy(a),
      [`GET /v2/accounts/${a}/orders`]: {
        result: "success",
        ledger_index: 107721455,
        orders: [
          { specification: { direction: "sell", quantity: { currency: "XRP", value: "500" }, totalPrice: { currency: "USD", value: "1240.00", counterparty: account(31) } }, properties: { maker: a, flags: 131072, sequence: 46118301 } },
          { specification: { direction: "buy", quantity: { currency: "BTC", value: "0.01", counterparty: account(32) }, totalPrice: { currency: "XRP", value: "6300" } }, properties: { maker: a, flags: 0, sequence: 46117950 } },
        ],
      },
    });
    const { html } = await page(`/xrpl/account/${a}?tab=offers`);
    expect(tableRows(html, "Open offers")).toEqual([
      ["Side", "Quantity", "Total price", "Rate", "Sequence"],
      ["Sell", "500 XRP", "1,240.00 USD", "2.48 USD / XRP", "46,118,301"],
      ["Buy", "0.01 BTC", "6,300 XRP", "630,000 XRP / BTC", "46,117,950"],
    ]);
    expect(textOf(html)).toContain("Open offers, read live at ledger #107,721,455");
    expect(textOf(html)).toContain("All 2 open offers");
    expect(await storedAs(`/xrpl/account/${a}?tab=offers`)).toEqual(LIVE);
  });

  it("?tab=offers says 'Showing the first 200 open offers', not a total, when the API's page was full", async () => {
    const a = account(35);
    const offer = (sequence: number) => ({
      specification: { direction: "sell", quantity: { currency: "XRP", value: "1" }, totalPrice: { currency: "USD", value: "2", counterparty: account(36) } },
      properties: { maker: a, flags: 0, sequence },
    });
    mock = mockUpstream("xrpl", {
      ...healthy(a),
      [`GET /v2/accounts/${a}/orders`]: { result: "success", ledger_index: 107721455, limit: 200, orders: Array.from({ length: 200 }, (_, i) => offer(i + 1)) },
    });
    const { html } = await page(`/xrpl/account/${a}?tab=offers`);
    expect(textOf(html)).toContain("Showing the first 200 open offers");
    expect(textOf(html)).not.toContain("All 200");
    expect(tableRows(html, "Open offers")).toHaveLength(201);
  });

  it("?tab=offers says 'All 1 open offer' for one that fits", async () => {
    const a = account(37);
    mock = mockUpstream("xrpl", {
      ...healthy(a),
      [`GET /v2/accounts/${a}/orders`]: {
        result: "success",
        ledger_index: 107721455,
        limit: 200,
        orders: [{ specification: { direction: "buy", quantity: { currency: "XRP", value: "1" }, totalPrice: { currency: "USD", value: "2" } }, properties: { maker: a, flags: 0, sequence: 9 } }],
      },
    });
    const { html } = await page(`/xrpl/account/${a}?tab=offers`);
    expect(textOf(html)).toContain("All 1 open offer");
    expect(textOf(html)).not.toContain("Showing the first");
  });

  it("?tab=offers on an account with none says so", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=offers`);
    expect(textOf(html)).toContain("This account has no open offers");
    expect(textOf(html)).toContain("No open offers");
  });

  it("?tab=objects lists what the account owns besides trust lines and offers, and says when the node has more than the first page", async () => {
    const a = account(33);
    const objects = [
      { LedgerEntryType: "RippleState", index: "R".repeat(64) },
      { LedgerEntryType: "Offer", index: "O".repeat(64) },
      { LedgerEntryType: "Escrow", index: "E".repeat(64), Amount: "1000000000", Destination: account(34), FinishAfter: 1792000000 - 946684800, CancelAfter: 1798000000 - 946684800, PreviousTxnID: "AB".repeat(32) },
    ];
    mock = mockUpstream("xrpl", { ...healthy(a, { objects, objectsMarker: "MORE" }) });
    const { html } = await page(`/xrpl/account/${a}?tab=objects`);
    const text = textOf(html);
    expect(text).toContain("Showing the first 400 objects");
    expect(text).toContain(`Escrow Amount 1,000 XRP To ${shortAddress(account(34))} Can finish after 2026-10-14 17:46:40 UTC Can cancel after 2026-12-23 04:26:40 UTC`);
    expect(text).toContain("Trust lines (1) and offers (1) have their own places");
    expect(text).toContain("Counted over the first 400 objects");
    expect(hrefs(html)).toContain(`/xrpl/tx/${"AB".repeat(32)}`);
    expect(await storedAs(`/xrpl/account/${a}?tab=objects`)).toEqual(LIVE);
  });

  it("?tab=objects without more than one page does not say it is cut", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=objects`);
    expect(textOf(html)).not.toContain("Showing the first 400");
    expect(textOf(html)).toContain("This account owns no other objects");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Streaming

describe("the list streams after the header", () => {
  it("sends the header and the list's place before the list's upstream has answered, and the list when it has", async () => {
    const a = account(40);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const history = await recordedList("transactions@descending=true&limit=20");
    mock = mockUpstream("xrpl", {
      ...healthy(a),
      [LIST(a, "transactions")]: async () => {
        await gate;
        return Response.json(history);
      },
    });

    const response = await get(`/xrpl/account/${a}`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    const deadline = Date.now() + 4_000;
    while (!seen.includes("Loading transactions") && Date.now() < deadline) {
      const part = await reader.read();
      if (part.done) break;
      seen += decoder.decode(part.value, { stream: true });
    }
    // The header is in, the list is a placeholder, and nothing of the list has been sent: its upstream is still waiting.
    expect(seen).toContain(`<h1 class="mono">${a}</h1>`);
    expect(seen).toContain('class="account-balance__value amt num">25<');
    expect(seen).toContain("Loading transactions");
    expect(seen).not.toContain("OfferCreate");

    release();
    for (let part = await reader.read(); !part.done; part = await reader.read()) seen += decoder.decode(part.value, { stream: true });
    const text = textOf(seen);
    expect(text).toContain("OfferCreate");
    // The header comes before the list in the document.
    expect(seen.indexOf(`<h1 class="mono">${a}</h1>`)).toBeLessThan(seen.indexOf("OfferCreate"));
    expect(await storedAs(`/xrpl/account/${a}`)).toEqual(LIVE);
    // What was stored is the whole page, the list included.
    const copy = await stored(`/xrpl/account/${a}`);
    expect(await copy!.text()).toContain("OfferCreate");
  });

  it("has the list's resolved markup after the header in the document, for the recorded account", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?case=order`);
    expect(html.indexOf(`<h1 class="mono">${ACTIVE}</h1>`)).toBeGreaterThan(-1);
    expect(html.indexOf(`<h1 class="mono">${ACTIVE}</h1>`)).toBeLessThan(html.indexOf("OfferCreate"));
  });

  it("serves a visitor who is a search engine's crawler the whole page: the list is in the document", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/account/${ACTIVE}?case=bot`, { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(textOf(html)).toContain("OfferCreate");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Paging

describe("paging", () => {
  it("links Older to the API's marker on the first page, and the page behind it is class slow (an hour, not a year) and noindex, follow", async () => {
    mock = mockUpstream("xrpl");
    const first = await page(`/xrpl/account/${ACTIVE}?case=paging`);
    expect(hrefs(first.html)).toContain(`/xrpl/account/${ACTIVE}?marker=WzEwNzYxMjU3MywyNV0`);

    const { html } = await page(`/xrpl/account/${ACTIVE}?marker=WzEwNzYxMjU3MywyNV0`);
    expect(await storedAs(`/xrpl/account/${ACTIVE}?marker=WzEwNzYxMjU3MywyNV0`)).toEqual(MARKER_PAGE);
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"/);
    expect(tableRows(html, "Transactions").slice(1).map((r) => [r[0], r[1]])).toEqual([
      ["2026-10-08 01:43:52", "OfferCreate"],
      ["2026-02-12 01:07:50", "Payment"],
    ]);
    // Newer goes back to the first page; there is nothing older.
    expect(hrefs(html)).toContain(`/xrpl/account/${ACTIVE}`);
    const nav = /<nav class="pager"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1]!;
    expect(anchors(nav).map((a) => a.text)).toEqual(["Newer"]);
    expect(nav).toContain('aria-disabled="true"');
  });

  it("carries no live state and no activation on a page behind a marker: both would be as old as the page", async () => {
    const a = account(50);
    mock = mockUpstream("xrpl", {
      [LIST(a, "transactions", "M1")]: await recordedList("transactions@descending=true&limit=20&marker=WzEwNzYxMjU3MywyNV0"),
    });
    const { html } = await page(`/xrpl/account/${a}?marker=M1`);
    const text = textOf(html);
    expect(text).not.toContain("Activated on");
    expect(text).not.toContain("Activation is not in the index");
    expect(text).toContain("does not show the balance or the live state");
    expect(text).not.toContain("Sequence");
    expect(text).not.toContain("Tokens");
    expect(text).not.toContain("Owned objects");
    expect(text).not.toContain("Live state unavailable");
    expect(hrefs(html)).toContain(`/xrpl/account/${a}`);
    // Nothing but the page's own list was asked for: not the node, not the balances, not the creation of the account.
    expect(mock.requests.map((r) => r.key)).toEqual([LIST(a, "transactions", "M1")]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("shows the older history of an account the index has no creation record of (the index is filled by range, genesis accounts have none)", async () => {
    const a = account(56);
    // The mock answers the creation record's URL with the API's own 404, as the API does for such an account; nothing asks for it.
    mock = mockUpstream("xrpl", {
      [LIST(a, "transactions", "M1")]: await recordedList("transactions@descending=true&limit=20&marker=WzEwNzYxMjU3MywyNV0"),
    });
    const { html } = await page(`/xrpl/account/${a}?marker=M1`);
    expect(tableRows(html, "Transactions")).toHaveLength(3);
    expect(textOf(html)).not.toContain("Activat");
    expect(await storedAs(`/xrpl/account/${a}?marker=M1`)).toEqual(MARKER_PAGE);
    // The creation record was never asked for, so its absence cannot make the page a 404.
    expect(mock.requests.some((r) => r.key === `GET /v2/accounts/${a}`)).toBe(false);
  });

  it("goes back one page at a time: each page's URL remembers the markers before it", async () => {
    const a = account(51);
    const row = (await recordedList("transactions@descending=true&limit=20&marker=WzEwNzYxMjU3MywyNV0")).transactions!.slice(0, 1);
    const list = (marker?: string) => ({ result: "success", count: 1, ...(marker ? { marker } : {}), transactions: row });
    mock = mockUpstream("xrpl", {
      [LIST(a, "transactions", "M1")]: list("M2"),
      [LIST(a, "transactions", "M2")]: list("M3"),
      [LIST(a, "transactions", "M3")]: list(),
    });
    const second = await page(`/xrpl/account/${a}?marker=M1`);
    expect(hrefs(second.html)).toContain(`/xrpl/account/${a}`);
    expect(hrefs(second.html)).toContain(`/xrpl/account/${a}?marker=M2&back=M1`);

    const third = await page(`/xrpl/account/${a}?marker=M2&back=M1`);
    expect(hrefs(third.html)).toContain(`/xrpl/account/${a}?marker=M1`);
    expect(hrefs(third.html)).toContain(`/xrpl/account/${a}?marker=M3&back=M2.M1`);

    const fourth = await page(`/xrpl/account/${a}?marker=M3&back=M2.M1`);
    expect(hrefs(fourth.html)).toContain(`/xrpl/account/${a}?marker=M2&back=M1`);
    expect(anchors(/<nav class="pager"[^>]*>([\s\S]*?)<\/nav>/.exec(fourth.html)![1]!).map((x) => x.text)).toEqual(["Newer"]);
  });

  it("has the same QR code behind a marker: the X-address of the address with its tag, a tag of 0 included", async () => {
    const a = account(58);
    mock = mockUpstream("xrpl", { [LIST(a, "transactions", "M1")]: await recordedList("transactions@descending=true&limit=20&marker=WzEwNzYxMjU3MywyNV0") });
    const { html } = await page(`/xrpl/account/${a}?marker=M1&tag=0`);
    const x = classicAddressToXAddress(a, 0, false);
    expect(/<svg class="qr__code"[^>]*>[\s\S]*?<path d="([^"]*)"/.exec(html)![1]).toBe(qrPath(encodeQr(x)));
    expect(html).toContain(`aria-label="QR code of the X-address ${x}, which is the address with destination tag 0"`);
  });

  it("pages the payments and the trades by their own markers, keeping the tab", async () => {
    mock = mockUpstream("xrpl");
    const payments = await page(`/xrpl/account/${ACTIVE}?tab=payments&marker=WzEwNzYzNjY3Myw3OF0`);
    expect(tableRows(payments.html, "Payments")).toHaveLength(2);
    expect(hrefs(payments.html)).toContain(`/xrpl/account/${ACTIVE}?tab=payments`);
    expect(payments.html).toMatch(/<meta name="robots" content="noindex, follow"/);
    expect(await storedAs(`/xrpl/account/${ACTIVE}?tab=payments&marker=WzEwNzYzNjY3Myw3OF0`)).toEqual(MARKER_PAGE);
    // The CSV link is the same on every page of the list.
    expect(anchors(payments.html).find((a) => a.text === "Download CSV")?.attrs).toContain(`href="/xrpl/account/${ACTIVE}/payments.csv"`);

    const trades = await page(`/xrpl/account/${ACTIVE}?tab=trades&marker=WzEwNzcyMDExNSw1MV0`);
    expect(tableRows(trades.html, "Trades")).toHaveLength(2);
  });

  it("is a 404 of class short when the API refuses the marker", async () => {
    const a = account(52);
    mock = mockUpstream("xrpl", { [LIST(a, "transactions", "NOPE")]: () => dataApiError(400, "invalid marker") });
    const { html } = await page(`/xrpl/account/${a}?marker=NOPE`, 404);
    expect(textOf(html)).toContain("We couldn’t find that page of the account");
    expect(await storedAs(`/xrpl/account/${a}?marker=NOPE`)).toEqual(SHORT);
  });

  it.each([
    ["not base64url", "%3Cscript%3E"],
    ["empty", ""],
    ["far too long", "A".repeat(600)],
  ])("is a 404 for a marker that is %s, without a call", async (_what, marker) => {
    mock = mockUpstream("xrpl");
    await page(`/xrpl/account/${account(53)}?marker=${marker}`, 404);
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 of class short when the list behind the marker comes back empty: no such page", async () => {
    const a = account(54);
    mock = mockUpstream("xrpl", { [LIST(a, "transactions", "M1")]: { result: "success", count: 0, transactions: [] } });
    const { html } = await page(`/xrpl/account/${a}?marker=M1`, 404);
    expect(textOf(html)).toContain("We couldn’t find that page of the account");
    expect(await storedAs(`/xrpl/account/${a}?marker=M1`)).toEqual(SHORT);
  });

  it("is a 404 for an empty page of the payments and of the trades too", async () => {
    const a = account(57);
    mock = mockUpstream("xrpl", {
      [LIST(a, "payments", "M1")]: { result: "success", count: 0, payments: [] },
      [LIST(a, "exchanges", "M1")]: { result: "success", count: 0, exchanges: [] },
    });
    await page(`/xrpl/account/${a}?tab=payments&marker=M1`, 404);
    await page(`/xrpl/account/${a}?tab=trades&marker=M1`, 404);
  });

  it("answers 503, not a page, when the list behind a marker cannot be loaded: an old page must be whole", async () => {
    const a = account(55);
    mock = mockUpstream("xrpl", { [LIST(a, "transactions", "M1")]: () => dataApiError(500, "boom") });
    const response = await get(`/xrpl/account/${a}?marker=M1`);
    await response.text();
    expect(response.status).toBe(503);
    expect(await isStored(`/xrpl/account/${a}?marker=M1`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The URL

describe("the query of the URL", () => {
  it.each(["bogus", "", "Payments", "Analytics", "transactions,payments"])("redirects an unknown ?tab=%j to the URL without it, class short", async (tab) => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/account/${ACTIVE}?tab=${encodeURIComponent(tab)}`);
    await response.text();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/account/${ACTIVE}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(`/xrpl/account/${ACTIVE}?tab=${encodeURIComponent(tab)}`)).toEqual(SHORT);
  });

  it("keeps the rest of the query when it drops an unknown tab", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/account/${ACTIVE}?tab=nope&tag=7`);
    await response.text();
    expect(response.headers.get("Location")).toBe(`/xrpl/account/${ACTIVE}?tag=7`);
  });

  it("redirects a marker on a tab that has no pages to the URL without it", async () => {
    mock = mockUpstream("xrpl");
    for (const tab of ["offers", "objects"]) {
      const response = await get(`/xrpl/account/${ACTIVE}?tab=${tab}&marker=M1&back=M0`);
      await response.text();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/account/${ACTIVE}?tab=${tab}`);
    }
  });

  it("shows the destination tag of an X-address in a note", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tag=104882`);
    const text = textOf(html);
    expect(text).toContain("Destination tag 104882");
    expect(text).toContain("enter 104882 as the destination tag");
    expect(await storedAs(`/xrpl/account/${ACTIVE}?tag=104882`)).toEqual(LIVE);
  });

  it("shows a tag of 0, and the biggest there is", async () => {
    mock = mockUpstream("xrpl");
    expect(textOf((await page(`/xrpl/account/${ACTIVE}?tag=0`)).html)).toContain("Destination tag 0");
    expect(textOf((await page(`/xrpl/account/${ACTIVE}?tag=4294967295`)).html)).toContain("Destination tag 4294967295");
  });

  it.each(["abc", "4294967296", "-1", "1.5", "007", "1e3", "%3Cb%3E1%3C%2Fb%3E", "99999999999999999999", ""])(
    "shows no note, and does not echo, ?tag=%s",
    async (tag) => {
      mock = mockUpstream("xrpl");
      const { html } = await page(`/xrpl/account/${ACTIVE}?tag=${tag}`);
      expect(textOf(html)).not.toContain("Destination tag");
      const decoded = decodeURIComponent(tag);
      // Not the whole HTML: its scripts hold the route manifest's random version (and ids), which meets a short tag like 007 now and then.
      if (decoded.length > 2) expect(toldBy(html).filter((told) => told.includes(decoded))).toEqual([]);
    },
  );
});

/**
 * What a page tells, apart from its scripts: its visible text and the values of the attributes of its tags, outside `<script>` and `<style>`
 * elements (a canonical link, a `content`, an `href`, a `value`). The names of the build's own files (`/assets/...`, hashed with random text) are
 * not told by anybody.
 */
function toldBy(html: string): string[] {
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, "<script></script>").replace(/<style\b[\s\S]*?<\/style>/gi, "<style></style>");
  const values = [...markup.matchAll(/<[a-zA-Z][^>]*>/g)].flatMap((tag) =>
    [...tag[0].matchAll(/\s[\w:.-]+="([^"]*)"/g)].map((attribute) => attribute[1]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")),
  );
  return [textOf(html), ...values.filter((value) => !value.startsWith("/assets/"))];
}

describe("what a page tells (toldBy, for the ?tag tests above)", () => {
  const sample = '<html><head><link rel="modulepreload" href="/assets/root-A007bcDe.js"><meta property="og:url" content="https://explorer.test/xrpl/account/rX"></head>' +
    '<body><main><p>An account</p><a href="/xrpl/account/rX?tab=payments">Payments</a><input value="rX"></main></body></html>';
  const withScript = (digits: string) =>
    sample.replace("</body>", `<script>window.__reactRouterManifest={"version":"f${digits}b","routes":{}};</script><script src="/assets/entry.js">${digits}</script></body>`);

  // The flake: a tag of 007 was "found" in the HTML of a page whose manifest version happened to have those digits in it.
  it("does not find digits that are only in a script, which the whole HTML does", () => {
    const html = withScript("007");
    expect(html).toContain("007");
    expect(toldBy(html).filter((told) => told.includes("007"))).toEqual([]);
  });

  it("does not find digits in the name of a file of the build, or in a style", () => {
    const html = sample.replace("</head>", "<style>.a007{color:red}</style></head>");
    expect(html).toContain("007");
    expect(toldBy(html).filter((told) => told.includes("007"))).toEqual([]);
  });

  it.each([
    ["the visible text", (html: string) => html.replace("An account", "An account 007")],
    ["a link", (html: string) => html.replace("?tab=payments", "?tab=payments&tag=007")],
    ["a meta tag", (html: string) => html.replace("explorer.test/xrpl/account/rX", "explorer.test/xrpl/account/rX?tag=007")],
    ["a field's value", (html: string) => html.replace('value="rX"', 'value="rX 007"')],
    ["an attribute, with its entities", (html: string) => html.replace("<p>", '<p title="a &amp; 007">')],
  ])("finds digits in %s", (_where, put) => {
    expect(toldBy(put(sample)).filter((told) => told.includes("007"))).not.toEqual([]);
    // Also with a script that has them too.
    expect(toldBy(put(withScript("007"))).filter((told) => told.includes("007"))).not.toEqual([]);
  });
});
