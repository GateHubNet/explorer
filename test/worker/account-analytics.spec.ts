import { env } from "cloudflare:workers";
import { encodeAccountID } from "ripple-address-codec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "../../app/routes/net.account.$address";
import type { AccountAnalyticsPageData } from "../../app/server/account-view";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration, createLoadContext, type Env } from "../../app/server/env";
import { anchors, pageClient, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";

// The account's Analytics tab, `/{net}/account/{address}?tab=analytics…`, with ACCOUNT_ANALYTICS on (the `worker` project), on the real Worker
// against the recorded and synthetic answers of test/fixtures/http/ (README "Upstream fixtures"). One URL per view (spec 1.3): the canonical
// query is `tab=analytics`, then `period` when it is not the default; any other query string is a 302 to the canonical URL, of class `short`,
// before any call upstream. The canonical URL is the view (spec 2): its header awaited without the holdings, then its frame and six cards
// streamed. The off case is account-analytics-off.spec.ts; the in-flight sharing and the failure hold, which need an isolate of their own,
// are account-analytics-flight.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included (and an error is never stored), so the tests
// of failing upstreams come first, and each asks for an account nobody else asks for (`account(n)`: a valid address funded in no recording,
// whose header the test gives and whose six calls answer with the recorded XRPL account's). Call 0, `last_validated`, is every view's: the test
// that fails it is the very first.

const { get, page, storedAs } = pageClient("198.18.1");

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  expect(unused ?? []).toEqual([]);
});

// The recorded accounts (test/fixtures/http, README "Upstream fixtures").
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";

const LIVE = { cls: "live", ttl: 5 };
const SHORT = { cls: "short", ttl: 30 };

/** A valid address that no recording has: 20 bytes of `n`. */
const account = (n: number) => encodeAccountID(new Uint8Array(20).fill(n));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

// ---- The views and their calls (spec 2.2 and 2.3) -------------------------------------------------------------------------------------

type Period = "30d" | "90d" | "1y" | "all";
type Card = "value" | "sent" | "changes" | "counterparties" | "balances" | "pairs";
const CARDS: readonly Card[] = ["value", "sent", "changes", "counterparties", "balances", "pairs"];

/** Each view's canonical query, and its interval and S with the recorded `last_validated` (T is 2026-10-17 on both networks). */
const VIEWS: Record<Period, { query: string; interval: "day" | "week" | "month"; start: string }> = {
  "30d": { query: "tab=analytics", interval: "day", start: "2026-09-18" },
  "90d": { query: "tab=analytics&period=90d", interval: "day", start: "2026-07-20" },
  "1y": { query: "tab=analytics&period=1y", interval: "week", start: "2025-10-20" },
  // All's S is the account's: this is the XRPL active account's (and `account(n)`'s), activated on 2025-07-15.
  all: { query: "tab=analytics&period=all", interval: "month", start: "2025-07-01" },
};

/** Each call's path and query after `/v2/accounts/{a}/`, the query sorted as the mock's keys and the fixtures' names have it. */
const CALL: Record<Card, (interval: string, start: string) => string> = {
  value: (interval, start) => `stats/value?interval=${interval}&limit=1000&start=${start}`,
  sent: (interval, start) => `stats/transactions?interval=${interval}&limit=1000&start=${start}`,
  changes: (interval, start) => `analytics/balance_changes?interval=${interval}&start=${start}`,
  counterparties: (_interval, start) => `analytics/counterparties?limit=6&start=${start}`,
  balances: (interval, start) => `analytics/balances?interval=${interval}&limit=4&start=${start}`,
  pairs: (_interval, start) => `analytics/exchanges?limit=6&start=${start}`,
};

/** The mock's key of a card's call for `address` over `period`'s window (or from another start). */
const keyOf = (address: string, card: Card, period: Period, start = VIEWS[period].start) =>
  `GET /v2/accounts/${address}/${CALL[card](VIEWS[period].interval, start)}`;

/** What each card's section error names (its `what`, spec 3), and the label of its tile for the four that have one. */
const WHAT: Record<Card, { what: string; tile: string | null }> = {
  value: { what: "the account value", tile: "Account value now" },
  sent: { what: "the transactions sent", tile: "Transactions sent" },
  changes: { what: "the balance changes", tile: "Fees paid" },
  counterparties: { what: "the counterparties", tile: "Counterparties" },
  balances: { what: "the balance history", tile: null },
  pairs: { what: "the DEX trading", tile: null },
};

const recordings = import.meta.glob(
  [
    "../fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/{stats,analytics}/*.json",
    "../fixtures/http/xrpl/data-api/accounts/r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC/transactions@descending=true&limit=20.json",
  ],
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;

async function recorded(path: string): Promise<Record<string, unknown>> {
  const load = recordings[`../fixtures/http/xrpl/data-api/accounts/${path}.json`];
  if (!load) throw new Error(`no recording ${path}`);
  return JSON.parse(await load()) as Record<string, unknown>;
}

/** The recorded XRPL account's answer to a card's call over `period`'s window. */
const recordedAnswer = (card: Card, period: Period) => recorded(`${ACTIVE}/${CALL[card](VIEWS[period].interval, VIEWS[period].start).replace("?", "@")}`);

const nodeOk = (result: Record<string, unknown>) => Response.json({ result: { ...result, status: "success" } });
const nodeDown = () => new Response("down", { status: 500 });

/**
 * The header's answers for an active XRPL account `address`: its creation record (activated 2025-07-15, as the recorded account) and the node's
 * account_info, whose last transaction is in a recorded ledger. `wait` holds the node's answer back, so that a call that fails at once has failed
 * before the header is in, and the page knows it is degraded before its head is sent. (A card that fails later is marked when it does: the copy
 * is not stored all the same, but the head has gone out without `no-store`.)
 */
function header(address: string, wait = 0): Overrides {
  const info = {
    account_data: {
      Account: address,
      Balance: "25000000",
      Flags: 0,
      LedgerEntryType: "AccountRoot",
      OwnerCount: 0,
      PreviousTxnID: "C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143",
      PreviousTxnLgrSeq: 107720688,
      Sequence: 12,
    },
    ledger_index: 107721455,
    validated: true,
  };
  return {
    [`GET /v2/accounts/${address}`]: {
      result: "success",
      account_data: { account: address, parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", initial_balance: "25", inception: "2025-07-15T18:30:43Z", ledger_index: 97500000, tx_hash: "9B".repeat(32) },
    },
    [`node account_info ${address}`]: wait > 0 ? async () => (await sleep(wait), nodeOk(info)) : info,
  };
}

/** An active `address` whose six calls over `period` answer with the recorded account's, and `extra` over those. */
async function activeView(address: string, period: Period, extra: Overrides = {}, wait = 0): Promise<Overrides> {
  const calls = await Promise.all(CARDS.map(async (card) => [keyOf(address, card, period), await recordedAnswer(card, period)] as const));
  return { ...header(address, wait), ...Object.fromEntries(calls), ...extra };
}

const pathOf = (address: string, period: Period = "30d", net = "xrpl") => `/${net}/account/${address}?${VIEWS[period].query}`;

/** The texts of the summary's tiles labelled `label`: a placeholder and the content streamed after it are two. */
function tilesNamed(html: string, label: string): string[] {
  return [...html.matchAll(/<div class="stat stat--figure"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => textOf(match[1]!)).filter((text) => text.startsWith(`${label} `));
}

/** Whether a tile's text has its figure (a number after the label), not the placeholder's nothing or the "—" of a card that is not there. */
const hasFigure = (text: string, label: string) => new RegExp(`^${label} \\d`).test(text);

/** How often `needle` is in `haystack`. */
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------------------------------------------------------
// When an upstream fails. First in the file; call 0's first of all.

describe("when call 0 fails", () => {
  it("shows one 'Couldn’t load the analytics.' in place of the tiles and cards, asks for none of the six, and does not store the page", async () => {
    const a = account(100);
    mock = mockUpstream("xrpl", { ...header(a, 150), "GET /v2/last_validated": dataApiError(500, "boom") });
    const path = pathOf(a);

    const response = await get(path);
    const html = await response.text();
    const text = textOf(html);
    expect(response.status, html.slice(0, 400)).toBe(200);
    // The header is the page's own.
    expect(html).toContain(`<h1 class="mono">${a}</h1>`);
    expect(count(text, "Couldn’t load the analytics.")).toBe(1);
    for (const card of CARDS) expect(text).not.toContain(`Couldn’t load ${WHAT[card].what}.`);
    expect(tilesNamed(html, "Account value now")).toEqual([]);
    expect(mock.requests.filter((request) => /\/(stats|analytics)\//.test(request.key))).toEqual([]);
    expect(statusesOf(mock, "GET /v2/last_validated")).toEqual([500]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
  });
});

describe("when a call fails", () => {
  it.each(CARDS.map((card, i) => [card, i] as const))(
    "shows %s's own section error and its tile's 'Couldn’t load', the rest of the view, and stores nothing",
    async (card, i) => {
      const a = account(101 + i);
      mock = mockUpstream("xrpl", await activeView(a, "30d", { [keyOf(a, card, "30d")]: dataApiError(500, "boom") }, 150));
      const path = pathOf(a);

      const response = await get(path);
      const html = await response.text();
      const text = textOf(html);
      expect(response.status).toBe(200);
      expect(text).toContain(`Couldn’t load ${WHAT[card].what}. Retry`);
      const { tile } = WHAT[card];
      if (tile) expect(tilesNamed(html, tile).some((t) => t.startsWith(`${tile} — Couldn’t load`))).toBe(true);
      // Every other card is there.
      for (const other of CARDS.filter((c) => c !== card)) expect(text).not.toContain(`Couldn’t load ${WHAT[other].what}.`);
      expect(text).not.toContain("Couldn’t load the analytics.");
      expect(statusesOf(mock, keyOf(a, card, "30d"))).toEqual([500]);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await isStored(path)).toBe(false);
    },
  );

  it.each<[string, number, () => unknown]>([
    ["a 429", 110, () => dataApiError(429, "Rate limit exceeded")],
    ["the API's 'Cannot GET' (no such route)", 111, () => null],
    ["a malformed 200", 112, () => ({ result: "success", interval: "day", rows: "none" })],
  ])("fails the balance changes on %s the same way", async (_what, n, answer) => {
    const a = account(n);
    mock = mockUpstream("xrpl", await activeView(a, "30d", { [keyOf(a, "changes", "30d")]: answer() }, 150));
    const path = pathOf(a);

    const response = await get(path);
    const html = await response.text();
    expect(textOf(html)).toContain("Couldn’t load the balance changes. Retry");
    expect(tilesNamed(html, "Fees paid").some((t) => t.startsWith("Fees paid — Couldn’t load"))).toBe(true);
    expect(textOf(html)).not.toContain("Couldn’t load the account value.");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
  });

  it("fails the balance changes of 1 year on a row that is a day, not a week (an API that ignores `interval`)", async () => {
    const a = account(113);
    const weekly = await recordedAnswer("changes", "1y");
    const rows = weekly.rows as Array<{ date: string }>;
    // 2025-10-21 is a Tuesday.
    const daily = { ...weekly, rows: [{ ...rows[0]!, date: "2025-10-21T00:00:00Z" }, ...rows.slice(1)] };
    mock = mockUpstream("xrpl", await activeView(a, "1y", { [keyOf(a, "changes", "1y")]: daily }, 150));
    const path = pathOf(a, "1y");

    const response = await get(path);
    const html = await response.text();
    expect(textOf(html)).toContain("Couldn’t load the balance changes. Retry");
    expect(textOf(html)).not.toContain("Couldn’t load the account value.");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
  });
});

describe("the deadline", () => {
  it("says 'Still working on the balance history.' within 5 s of a call that never answers, and does not store the page", async () => {
    const a = account(120);
    mock = mockUpstream("xrpl", await activeView(a, "30d", { [keyOf(a, "balances", "30d")]: () => new Promise<Response>(() => {}) }));
    const path = pathOf(a);

    const started = Date.now();
    const response = await get(path);
    const html = await response.text();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(textOf(html)).toContain("Still working on the balance history. Retry in a few seconds.");
    // The rest of the view is there.
    expect(textOf(html)).not.toContain("Couldn’t load");
    expect(await isStored(path)).toBe(false);
  }, 15_000);

  it("finishes a late counterparties call in the background: a render 3 s later shows the card without asking again", async () => {
    const a = account(121);
    const answer = await recordedAnswer("counterparties", "30d");
    const key = keyOf(a, "counterparties", "30d");
    mock = mockUpstream("xrpl", await activeView(a, "30d", { [key]: async () => (await sleep(6_000), Response.json(answer)) }));
    const path = pathOf(a);

    const first = await page(path);
    expect(textOf(first.html)).toContain("Still working on the counterparties. Retry in a few seconds.");
    expect(tilesNamed(first.html, "Counterparties").some((t) => t.startsWith("Counterparties — Still working on it"))).toBe(true);
    expect(await isStored(path)).toBe(false);

    await sleep(3_000);
    const second = await page(path);
    const text = textOf(second.html);
    expect(text).not.toContain("Still working");
    expect(text).not.toContain("Couldn’t load");
    expect(tilesNamed(second.html, "Counterparties").some((t) => t.startsWith("Counterparties 2 accounts it paid or was paid by"))).toBe(true);
    // One call: the second render found its answer kept.
    expect(statusesOf(mock, key)).toEqual([200]);
  }, 20_000);
});

describe("when the node is down", () => {
  it("says 'Live state unavailable' and 'The balance could not be read.', shows every card, and does not store the page", async () => {
    const a = account(122);
    mock = mockUpstream("xrpl", await activeView(a, "30d", { [`node account_info ${a}`]: () => nodeDown() }));
    const path = pathOf(a);

    const response = await get(path);
    const html = await response.text();
    const text = textOf(html);
    expect(response.status).toBe(200);
    expect(text).toContain("Live state unavailable");
    expect(text).toContain("The balance could not be read.");
    expect(text).not.toContain("Couldn’t load");
    expect(text).not.toContain("Still working");
    for (const tile of ["Account value now", "Transactions sent", "Fees paid", "Counterparties"]) {
      expect(tilesNamed(html, tile).some((t) => hasFigure(t, tile)), tile).toBe(true);
    }
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
  });
});

describe("an address that was never activated", () => {
  it("is the 404 of the account page, without a word of the analytics, and is stored as short: the abandoned cards marked nothing", async () => {
    const a = account(123);
    // The six calls are answered "Cannot GET" (nothing is recorded for the address), which a view would show as six failed cards.
    mock = mockUpstream("xrpl", {
      [`GET /v2/accounts/${a}`]: null,
      [`GET /v2/accounts/${a}/transactions?limit=1`]: { result: "success", count: 0, transactions: [] },
    });
    const { html } = await page(pathOf(a), 404);
    expect(textOf(html)).toContain("This address has never been activated");
    expect(textOf(html)).not.toContain("Couldn’t load");
    expect(await storedAs(pathOf(a))).toEqual(SHORT);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// What the view asks for

describe("the calls", () => {
  // Every read of the Cache API misses, so that each render asks for each of its calls and the list is exact whatever was rendered before.
  beforeEach(() => {
    vi.spyOn(caches.default, "match").mockResolvedValue(undefined);
  });

  /** The header's calls of an active account: the account, the node's account_info and server_state, and the ledger of its last transaction. */
  const headerCalls = (address: string, lastLedger: number) => [
    `GET /v2/accounts/${address}`,
    `node account_info account=${address}&ledger_index=validated`,
    "node server_state",
    `GET /v2/ledgers/${lastLedger}`,
  ];

  it.each([
    ["xrpl", "30d", "2026-09-18", ACTIVE, 107720688],
    ["xrpl", "90d", "2026-07-20", ACTIVE, 107720688],
    ["xrpl", "1y", "2025-10-20", ACTIVE, 107720688],
    ["xrpl", "all", "2025-07-01", ACTIVE, 107720688],
    ["xahau", "30d", "2026-09-18", XAHAU_ACTIVE, 26596843],
    ["xahau", "90d", "2026-07-20", XAHAU_ACTIVE, 26596843],
    ["xahau", "1y", "2025-10-20", XAHAU_ACTIVE, 26596843],
    ["xahau", "all", "2026-08-01", XAHAU_ACTIVE, 26596843],
  ] as const)(
    "asks %s's active account for %s: call 0, the header's calls and the six from %s, once each, and none of the holdings",
    async (net, period, start, address, lastLedger) => {
      mock = mockUpstream(net);
      await page(pathOf(address, period, net));

      const asked = mock.requests.map((request) => request.key).sort();
      expect(asked).toEqual(["GET /v2/last_validated", ...headerCalls(address, lastLedger), ...CARDS.map((card) => keyOf(address, card, period, start))].sort());
      expect(mock.requests.every((request) => request.net === net && request.status === 200)).toBe(true);
      expect(asked).not.toContain(`GET /v2/accounts/${address}/balances`);
      expect(asked.some((key) => key.startsWith("node account_objects") || key.includes("amm_volume"))).toBe(false);
    },
  );

  it("asks the existence probe once for a deleted account without a creation record, and starts All at the month of its oldest transaction", async () => {
    const history = await recorded(`${DELETED}/transactions@descending=true&limit=20`);
    const oldest = { ...(history.transactions as Array<Record<string, unknown>>).at(-1)!, date: "2024-08-12T10:02:43+00:00" };
    const probe = `GET /v2/accounts/${DELETED}/transactions?limit=1`;
    mock = mockUpstream("xrpl", {
      // The API's 404 "Account not found": the index has no creation record of the account.
      [`GET /v2/accounts/${DELETED}`]: null,
      [probe]: { result: "success", count: 1, transactions: [oldest] },
    });
    const { html } = await page(pathOf(DELETED, "all"));

    expect(statusesOf(mock, probe)).toEqual([200]);
    expect(mock.requests.map((request) => request.key).sort()).toEqual(
      [
        "GET /v2/last_validated",
        `GET /v2/accounts/${DELETED}`,
        probe,
        `node account_info account=${DELETED}&ledger_index=validated`,
        "node server_state",
        ...CARDS.map((card) => keyOf(DELETED, card, "all", "2024-08-01")),
      ].sort(),
    );
    const text = textOf(html);
    expect(text).toContain("Since Aug 2024, the month of its oldest transaction in the index, per month (UTC).");
    expect(text).toContain("This account was deleted; All covers its whole history.");
  });
});

describe("the DEX wording (the route's loader, with a load context of its own)", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

  /** The DEX trades row's hint and the pairs' notes of a view, as the loader settles them with AMM_DATA at `ammData`. */
  async function wordingOf(net: "xrpl" | "xahau", address: string, ammData: "on" | "off") {
    const result = (await loader({
      request: new Request(`https://explorer.test${pathOf(address, "30d", net)}`),
      params: { net, address },
      context: createLoadContext({ ...(env as unknown as Env), AMM_DATA: ammData }, ctx),
    } as never)) as { data: AccountAnalyticsPageData };
    const [changes, pairs] = await Promise.all([result.data.analytics.changes, result.data.analytics.pairs]);
    if (changes.state !== "ok" || pairs.state !== "ok") throw new Error(`the cards are ${changes.state} and ${pairs.state}`);
    return { hint: changes.sources.rows.find((row) => row.id === "dex")?.hint, notes: pairs.notes };
  }

  it("says XRPL's swaps are included only while AMM_DATA is on, and claims neither while it is off", async () => {
    mock = mockUpstream("xrpl");
    expect(await wordingOf("xrpl", ACTIVE, "on")).toEqual({
      hint: "order book and AMM",
      notes: ["Includes swaps against AMM pools.", "Bought and sold are of each pair's base as shown."],
    });
    expect(await wordingOf("xrpl", ACTIVE, "off")).toEqual({ hint: "on the DEX", notes: ["Bought and sold are of each pair's base as shown."] });
    expect(mock.requests.some((request) => request.key.includes("amm_volume"))).toBe(false);
  });

  it("says Xahau has no AMM whatever the switch", async () => {
    mock = mockUpstream("xahau");
    for (const ammData of ["on", "off"] as const) {
      expect(await wordingOf("xahau", XAHAU_ACTIVE, ammData)).toEqual({
        hint: "order book",
        notes: ["Order-book trades only; Xahau has no AMM.", "Bought and sold are of each pair's base as shown."],
      });
    }
    expect(mock.requests.some((request) => request.key.includes("amm_volume"))).toBe(false);
  });
});

describe("the classes", () => {
  it("stores the view and its data URL as live", async () => {
    const a = account(130);
    mock = mockUpstream("xrpl", await activeView(a, "90d"));
    await page(pathOf(a, "90d"));
    expect(await storedAs(pathOf(a, "90d"))).toEqual(LIVE);

    const dataPath = `/xrpl/account/${a}.data?${VIEWS["90d"].query}`;
    const data = await get(dataPath);
    expect(data.status).toBe(200);
    expect(await data.text()).toContain("Includes swaps against AMM pools.");
    expect(await storedAs(dataPath)).toEqual(LIVE);
  });

  it("keeps each of the six calls a minute (class minute: public, max-age=60)", async () => {
    const a = account(131);
    const puts = new Map<string, string | null>();
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.set(request instanceof Request ? request.url : String(request), (response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });
    mock = mockUpstream("xrpl", await activeView(a, "1y"));
    await page(pathOf(a, "1y"));

    /** The Cache API key of a data API call, as the subrequest cache writes it (`subrequestKey` in edge-cache.ts). */
    const keyFor = async (card: Card) => {
      const call = `GET ${env.XRPL_DATA_API_URL}/v2/accounts/${a}/${CALL[card](VIEWS["1y"].interval, VIEWS["1y"].start)}`;
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(call)));
      return `https://subrequest-cache.invalid/${encodeURIComponent(env.BUILD_ID)}/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    };
    const keys = await Promise.all(CARDS.map(keyFor));
    for (let tries = 0; tries < 80 && !keys.every((key) => puts.has(key)); tries += 1) await sleep(25);
    expect(keys.map((key) => puts.get(key))).toEqual(CARDS.map(() => "public, max-age=60"));
  });
});

describe("the view streams after the header", () => {
  it("sends the header and the cards' places before the account value's call has answered, and its figure when it has", async () => {
    const a = account(140);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const value = await recordedAnswer("value", "30d");
    mock = mockUpstream("xrpl", await activeView(a, "30d", { [keyOf(a, "value", "30d")]: async () => (await gate, Response.json(value)) }));

    const response = await get(pathOf(a));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    const until = Date.now() + 4_000;
    while (!seen.includes("Account value now") && Date.now() < until) {
      const part = await reader.read();
      if (part.done) break;
      seen += decoder.decode(part.value, { stream: true });
    }
    const first = seen;
    release();
    for (let part = await reader.read(); !part.done; part = await reader.read()) seen += decoder.decode(part.value, { stream: true });

    // The header is in, the tile is a placeholder, and nothing of its figure has been sent: its call is still waiting.
    expect(first).toContain(`<h1 class="mono">${a}</h1>`);
    expect(first).toContain("Account value now");
    // The recorded account's value on T, with two decimals, is the tile's figure.
    expect(first).not.toContain("17.54 XRP");
    expect(tilesNamed(seen, "Account value now").some((t) => t.startsWith("Account value now 17.54 XRP"))).toBe(true);
    expect(seen.indexOf(`<h1 class="mono">${a}</h1>`)).toBeLessThan(seen.indexOf("17.54 XRP"));
    expect(await storedAs(pathOf(a))).toEqual(LIVE);
  });

  it("serves a search engine's crawler the whole view: the answer starts only once every card is in", async () => {
    const a = account(141);
    const answer = await recordedAnswer("pairs", "30d");
    mock = mockUpstream("xrpl", await activeView(a, "30d", { [keyOf(a, "pairs", "30d")]: async () => (await sleep(300), Response.json(answer)) }));
    const started = Date.now();
    const response = await get(pathOf(a), { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    // The head waited for the slowest card (`allReady` in entry.server.tsx), not only for the header.
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    const html = await response.text();
    expect(response.status).toBe(200);
    const text = textOf(html);
    expect(text).not.toContain("Couldn’t load");
    expect(text).not.toContain("Still working");
    expect(text).toContain("Bought and sold are of each pair's base as shown.");
    for (const tile of ["Account value now", "Transactions sent", "Fees paid", "Counterparties"]) {
      expect(tilesNamed(html, tile).some((t) => hasFigure(t, tile)), tile).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The URL

/** The answer to `path`: a 302, where it leads, and what was asked upstream for it. */
async function redirectOf(path: string) {
  mock = mockUpstream(path.startsWith("/xahau/") ? "xahau" : "xrpl");
  const response = await get(path);
  await response.text();
  return { status: response.status, location: response.headers.get("Location"), requests: mock.requests };
}

describe("the URL of the analytics view", () => {
  const base = `/xrpl/account/${ACTIVE}`;

  it.each([
    ["the default period named", "tab=analytics&period=30d", "tab=analytics"],
    ["the period first", "period=90d&tab=analytics", "tab=analytics&period=90d"],
    ["a marker", "tab=analytics&marker=WzEwNzYxMjU3MywyNV0", "tab=analytics"],
    ["a trail of markers", "tab=analytics&back=a", "tab=analytics"],
    ["a destination tag", "tab=analytics&tag=5", "tab=analytics"],
    ["a currency", "tab=analytics&in=usd", "tab=analytics"],
    ["an unknown parameter", "tab=analytics&x=1", "tab=analytics"],
    ["an unknown period", "tab=analytics&period=2y", "tab=analytics"],
    ["a period twice", "tab=analytics&period=90d&period=1y", "tab=analytics&period=90d"],
    ["a period in capitals", "tab=analytics&period=1Y", "tab=analytics"],
    ["a period after a marker", "tab=analytics&marker=WzEwNzYxMjU3MywyNV0&period=all", "tab=analytics&period=all"],
    ["the tab twice", "tab=analytics&tab=analytics", "tab=analytics"],
    ["an escaped spelling of the tab", "tab=%61nalytics", "tab=analytics"],
    ["an escaped spelling of the period", "tab=analytics&period=%31y", "tab=analytics&period=1y"],
    ["an empty parameter", "tab=analytics&", "tab=analytics"],
  ])("redirects %s (?%s) to its canonical URL, class short, without a call", async (_what, query, canonical) => {
    const path = `${base}?${query}`;
    expect(await redirectOf(path)).toEqual({ status: 302, location: `${base}?${canonical}`, requests: [] });
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("redirects on Xahau to Xahau's canonical URL", async () => {
    const path = `/xahau/account/${XAHAU_ACTIVE}?period=all&tab=analytics&x=1`;
    expect(await redirectOf(path)).toEqual({ status: 302, location: `/xahau/account/${XAHAU_ACTIVE}?tab=analytics&period=all`, requests: [] });
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it.each(["tab=analytics", "tab=analytics&period=90d", "tab=analytics&period=1y", "tab=analytics&period=all"])(
    "answers the canonical ?%s with the view itself, its tab the current one",
    async (query) => {
      mock = mockUpstream("xrpl");
      const { html } = await page(`${base}?${query}`);
      expect(html).toContain(`<h1 class="mono">${ACTIVE}</h1>`);
      const tab = anchors(html).find((a) => a.text === "Analytics");
      expect(tab?.attrs).toContain('aria-current="page"');
    },
  );
});
