import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loader } from "../../app/routes/net.amm.$pool";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration, createLoadContext, type Env } from "../../app/server/env";
import usdPool from "../fixtures/http/xrpl/node/amm_info/rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am.json";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { dataApiError, mockUpstream, nodeError, statusesOf, type UpstreamMock } from "../support/upstream";

// One AMM pool's page, `/{net}/amm/{pool}`, and the pair form that leads to it, `/{net}/amm/{base}/{counter}` (AMM spec 1.2, 1.3, 3 and 4), on the real
// Worker against the generated AMM answers of the data API (test/fixtures/http/xrpl/data-api/amm/pools/…) and the recorded `amm_info` of the node: the 404s
// before any call, what a failed call does to the page (a 503, a page in another mode, or one card that says it could not load), a page behind a marker, the
// class each answer is stored under, the calls of a view and how long each is kept, and the redirects that make one URL of a view. The off-case of
// `AMM_PAGES` is amm-off.spec.ts (the `worker-off` project).
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock (the pool and the live set 60 s, `last_validated` 2 s, the day
// rows and the candles 300 s), and an error or a degraded page is never stored, while the edge answers a 503 with a stored copy of the page when it has one.
// So the tests that fail a call come first, each on a pool account or a view that no later test reads (a valid made-up account with its calls overridden, or
// a view of a featured pool that only that test asks for), and every test takes the subrequest entries away (`cold`): each call of a render reaches the
// mock, so an override is always the answer and a list of calls does not depend on the order of the tests. The page does not poll, so no call asks for the
// failure hold; `Date` alone is faked all the same and moved 301 s on after each test, past the longest keep (the edge cache's freshness reads `Date`). The
// afterEach below fails a test whose override no request used.
//
// The fixtures' featured pools: XRP/RLUSD (rhWTXC…, every period), USDC/RLUSD and XRP/USD (90 days), DVR/XRP (30 days only, and the one create event),
// SNK/XRP (deleted) and VOX/XRP, which the node does not have: under the fixtures its page is the "gone" mode. VOX's code has no text and shows as hex, so no
// test reads its pair as text.

const { get, stored, storedAs } = pageClient("198.18.51");

let mock: UpstreamMock | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  vi.setSystemTime(Date.now() + 301_000);
  expect(unused ?? []).toEqual([]);
});

afterAll(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unavailable = () => dataApiError(503, "unavailable");
const keysOf = (requests: UpstreamMock["requests"]) => requests.map((request) => request.key);

const SUBREQUESTS = "https://subrequest-cache.invalid/";
const urlOf = (request: RequestInfo | URL) => (typeof request === "string" ? request : request instanceof URL ? request.href : request.url);

/**
 * The subrequest cache with nothing in it for this test (amm-list.spec.ts's): every lookup of an entry misses, so every call of a render reaches the mock
 * (what is stored is still written). `kept` is the `Cache-Control` of every entry stored, by the entry's URL.
 */
function cold(): { kept: Map<string, string | null> } {
  const kept = new Map<string, string | null>();
  const match = caches.default.match.bind(caches.default);
  const put = caches.default.put.bind(caches.default);
  vi.spyOn(caches.default, "match").mockImplementation((request, options) => (urlOf(request).startsWith(SUBREQUESTS) ? Promise.resolve(undefined) : match(request, options)));
  vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
    if (urlOf(request).startsWith(SUBREQUESTS)) kept.set(urlOf(request), response.headers.get("Cache-Control"));
    return put(request, response);
  });
  return { kept };
}

/** The URL the subrequest cache stores a key under (edge-cache.ts: the build and the SHA-256 of the key). */
async function entryOf(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return `${SUBREQUESTS}${encodeURIComponent(env.BUILD_ID)}/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** How long the entry of `key` was stored for (`max-age=N`), once it has been: it is written behind the answer. */
async function keptFor(kept: Map<string, string | null>, key: string): Promise<string | null | undefined> {
  const entry = await entryOf(key);
  await vi.waitFor(() => expect(kept.has(entry), `nothing stored for ${key}`).toBe(true), { timeout: 5_000 });
  return kept.get(entry);
}

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

/** The page at `path`: its status, headers and HTML. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

/** A degraded page: 200, never kept by the browser or the edge. */
async function expectDegraded(path: string, response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await isStored(path)).toBe(false);
}

/** A 503: `Retry-After`, never stored. */
async function expectOutage(path: string, response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("30");
  expect(await isStored(path)).toBe(false);
}

/** The `robots` of the head, and whether it has a canonical URL. */
const robotsOf = (html: string) => /<meta name="robots" content="([^"]*)"\/?>/.exec(html)?.[1];
const hasCanonical = (html: string) => /<link rel="canonical"/.test(html);

/** The stats of the state card: each one's label, figure and the words under it. */
function stats(html: string) {
  return [...html.matchAll(/<div class="stat(?: stat--figure)?">([\s\S]*?)<\/div>/g)].map((match) => ({
    label: elementText(match[1]!, "stat__label"),
    value: elementText(match[1]!, "stat__value"),
    sub: elementText(match[1]!, "stat__sub"),
  }));
}

/** The `SectionError`s of the page: what each says it could not load. */
const sectionErrors = (html: string) => [...html.matchAll(/<div class="notice notice--error" role="alert">([\s\S]*?)<button/g)].map((match) => textOf(match[1]!));

/** The links of the tabs of the activity card, by their text. */
function tabLinks(html: string): Record<string, string | undefined> {
  return Object.fromEntries(
    anchors(html)
      .filter((a) => /class="tabs__item/.test(a.attrs))
      .map((a) => [a.text, /href="([^"]*)"/.exec(a.attrs)?.[1]?.replace(/&amp;/g, "&")]),
  );
}

/** The `href` of the anchor with this text. */
const linkTo = (html: string, text: string) => anchors(html).filter((a) => a.text === text).map((a) => /href="([^"]*)"/.exec(a.attrs)?.[1]?.replace(/&amp;/g, "&"));

// ---- The pools and the calls, by the keys the mock names them (its query sorted by name) ------------------------------------------------------------

/** XRP/RLUSD, stored RLUSD/XRP: every period has its files. */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
/** USDC/RLUSD, the 90 days. */
const USDC_POOL = "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb";
/** XRP/USD, the 90 days. */
const USD_POOL = "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am";
/** DVR/XRP: the 30 days only, and the one pool with a create event. */
const DVR_POOL = "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG";
/** VOX/XRP: the index's live pool, which the node does not have. */
const VOX_POOL = "rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef";
/** SNK/XRP: deleted. */
const SNK_POOL = "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz";

/** Valid classic addresses that are no pool of the fixtures: each test that overrides a pool's calls has one of its own. */
const MADE_UP = {
  index503: "rai1C6qtmzdZaEftEY1ncbTbLqvCEV1Ucp",
  cannotGet: "r3stnzmY7X1S3SB7iRTjBBAvG81KxWKMfT",
  nodeDown: "r9NtWH6UBnfKwdEnTJh4j8SEUjozgXTMXD",
  none: "rwRtv2cq1cMUUFJghwCpJ4v23gkC4aREA4",
  slow: "rBcuL1YV29bnEr4GCsECiyQuhd6L9M4BRV",
  network: "rUoumw79GgFxHUR1EuiKRZuDz2dVxy5xhT",
  olderMissing: "rDzvBTP8yNhqKPVTi8SxzwPYk86gpc3P5p",
  olderFailing: "rEBvbkKSCmJ5M2ZhTCscY6c9fvQgp49Q8V",
} as const;

const RLUSD = "524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const API_BASE = "https://xrpl.data.example.invalid";

const LAST_VALIDATED = "GET /v2/last_validated";
const LIVE = "GET /v2/network/amm_volume?live=day";
const poolKey = (pool: string) => `GET /v2/amm/pools/${pool}`;
/** The node's `amm_info` by its subject (an override key), and as a request names it (`SeenRequest.key`, the most specific key). */
const nodeKey = (pool: string) => `node amm_info ${pool}`;
const nodeRequest = (pool: string) => `node amm_info amm_account=${pool}&ledger_index=validated`;
const daysKey = (pool: string, start: string) => `GET /v2/amm/pools/${pool}/history?end=2026-10-17&interval=day&limit=1000&start=${start}`;
const carryInKey = (pool: string, end: string) => `GET /v2/amm/pools/${pool}/history?descending=true&end=${end}&interval=day&limit=1`;
const lastDayKey = (pool: string) => `GET /v2/amm/pools/${pool}/history?end=2026-10-16&interval=day&limit=1&start=2026-10-16`;
const candlesKey = (pair: string, interval: "1day" | "7day", start: string) => `GET /v2/exchanges/${pair}?amm=only&end=2026-10-17&interval=${interval}&limit=400&start=${start}`;
const TAB_PATHS = { swaps: "swaps", liquidity: "liquidity", governance: "governance" } as const;
const tabKey = (pool: string, tab: keyof typeof TAB_PATHS, marker?: string) =>
  `GET /v2/amm/pools/${pool}/${TAB_PATHS[tab]}?descending=true&limit=20${marker === undefined ? "" : `&marker=${marker}`}`;
const createKey = (pool: string) => `GET /v2/amm/pools/${pool}/liquidity?event=create&limit=1`;

/** The windows of the recorded ledger's day (Oct 17, 2026): their first day and the day before it. */
const WINDOWS = {
  "30d": { start: "2026-09-18", carryIn: "2026-09-17", interval: "1day" },
  "90d": { start: "2026-07-20", carryIn: "2026-07-19", interval: "1day" },
  "1y": { start: "2025-10-20", carryIn: "2025-10-19", interval: "7day" },
} as const;

/** The ten calls of a first page (spec 3.2), as the mock names them. */
function firstPageCalls(pool: string, pair: string, period: keyof typeof WINDOWS, tab: keyof typeof TAB_PATHS = "swaps"): string[] {
  const w = WINDOWS[period];
  return [
    poolKey(pool),
    nodeRequest(pool),
    LAST_VALIDATED,
    daysKey(pool, w.start),
    carryInKey(pool, w.carryIn),
    candlesKey(pair, w.interval, w.start),
    tabKey(pool, tab),
    createKey(pool),
    LIVE,
    lastDayKey(pool),
  ].sort();
}

// ---- Validation, before any call --------------------------------------------------------------------------------------------------------------------

describe("what the URL carries, checked before any call (spec 1.3)", () => {
  it.each([
    ["/xrpl/amm/nope", 'We couldn’t find AMM pool "nope" on XRPL.'],
    // An X-address names an account and a tag: a pool takes no tag. What is repeated is cut to 40 characters (`echoOf`).
    ["/xrpl/amm/X7ey8zNwYihxNyzKCRHtH1kCYvz3KWcG1bsuVL71p2keNDf", 'We couldn’t find AMM pool "X7ey8zNwYihxNyzKCRHtH1kCYvz3KWcG1bsuVL71" on XRPL.'],
    // A checksum that does not hold.
    ["/xrpl/amm/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS4", 'We couldn’t find AMM pool "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS4" on XRPL.'],
    // A bidi override is left out of what is repeated.
    ["/xrpl/amm/r%E2%80%AEnope", 'We couldn’t find AMM pool "rnope" on XRPL.'],
  ])("%s is a 404 of class short that repeats what was asked, with no call", async (path, sentence) => {
    mock = mockUpstream("xrpl");
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(sentence);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 on Xahau for a valid address, with the note that says why and the way to the pool on XRPL, with no call", async () => {
    mock = mockUpstream("xahau");
    const path = `/xahau/amm/${POOL}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
    const sentence = "We couldn’t find AMM pool rhWTXC…tcS3 on Xahau.";
    const note = "Xahau has no AMM, so this pool exists only on the XRP Ledger.";
    expect(text).toContain(sentence);
    expect(text).toContain(note);
    // The sentence, then the note, then the offer.
    expect(html.indexOf(note)).toBeGreaterThan(html.indexOf("rhWTXC…tcS3 on Xahau"));
    expect(html.indexOf("Open it on XRPL")).toBeGreaterThan(html.indexOf(note));
    expect(linkTo(html, "Open it on XRPL")).toEqual([`/xrpl/amm/${POOL}`]);
    expect(robotsOf(html)).toBe("noindex");
  });

  it("is a 404 of class short, before any call and before any redirect, for a marker that is not one", async () => {
    mock = mockUpstream("xrpl");
    for (const path of [`/xrpl/amm/${POOL}?marker=%25`, `/xrpl/amm/${POOL}?period=30d&marker=%25&x=1`]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the AMM pool");
      expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
    }
    expect(mock.requests).toEqual([]);
  });
});

// ---- Failures first, each on a pool or a view no later test reads ---------------------------------------------------------------------------------

describe("the index or the node failing for the whole page (spec 1.3, 3.3, 3.6)", () => {
  it("is a 503, not stored, when the index fails (#1, a 503)", async () => {
    cold();
    const pool = MADE_UP.index503;
    mock = mockUpstream("xrpl", { [poolKey(pool)]: unavailable() });
    const path = `/xrpl/amm/${pool}`;
    const { response } = await render(path);

    await expectOutage(path, response);
    expect(statusesOf(mock, poolKey(pool))).toEqual([503]);
  });

  it("is a 503, not stored and logged, for an API without the AMM routes (#1, its 'Cannot GET' 404), never a stored 404", async () => {
    cold();
    const pool = MADE_UP.cannotGet;
    mock = mockUpstream("xrpl", { [poolKey(pool)]: dataApiError(404, `Cannot GET /v2/amm/pools/${pool}`) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/amm/${pool}`;
    const { response, html } = await render(path);

    await expectOutage(path, response);
    expect(statusesOf(mock, poolKey(pool))).toEqual([404]);
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the data API serves no AMM pools"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("Cannot GET");
    expect(html).not.toContain("Cannot GET");
  });

  it("is a 503, not stored, when the index has no such pool and the node fails (#1 pool not found, #2 failing): a missing pool cannot be told from an outage", async () => {
    cold();
    const pool = MADE_UP.nodeDown;
    mock = mockUpstream("xrpl", { [poolKey(pool)]: dataApiError(404, "pool not found"), [nodeKey(pool)]: nodeError("noNetwork") });
    const path = `/xrpl/amm/${pool}`;
    const { response } = await render(path);

    await expectOutage(path, response);
    expect(statusesOf(mock, poolKey(pool))).toEqual([404]);
    expect(keysOf(mock.requests)).toContain(nodeRequest(pool));
  });

  it("is a 503, not a 500, when the index does not answer by the deadline (a missed deadline is an outage)", async () => {
    cold();
    const pool = MADE_UP.slow;
    mock = mockUpstream("xrpl", { [poolKey(pool)]: () => new Promise<Response>(() => {}) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/amm/${pool}`;
    const started = performance.now();
    const { response } = await render(path);
    const took = performance.now() - started;

    await expectOutage(path, response);
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
  }, 15_000);

  it("is a 404 of class short that offers the account page when neither the index nor the node has the pool", async () => {
    cold();
    const pool = MADE_UP.none;
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm/${pool}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, poolKey(pool))).toEqual([404]);
    expect(keysOf(mock.requests)).toContain(nodeRequest(pool));
    expect(text).toContain(`We couldn’t find AMM pool ${pool.slice(0, 6)}…${pool.slice(-4)} on XRPL.`);
    expect(linkTo(html, "Open it as an account")).toEqual([`/xrpl/account/${pool}`]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});

describe("a pool the index does not have yet (spec 3.3, the network mode)", () => {
  it("is drawn from the node: class short kept 60 s, the network notice, noindex, an empty chart and table, and not degraded", async () => {
    cold();
    const pool = MADE_UP.network;
    // The node's XRP/USD pool, as if it were this account's (its LP token is the pool's own).
    const { amm } = usdPool.result;
    const fromNode = { ...usdPool.result, amm: { ...amm, account: pool, lp_token: { ...amm.lp_token, issuer: pool }, auction_slot: undefined } };
    mock = mockUpstream("xrpl", { [nodeKey(pool)]: fromNode });
    const path = `/xrpl/amm/${pool}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).not.toBe("no-store");
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 60 });
    // The index has no committed state of it yet: #1, #4, #5, #7, #8 and #10 answer pool not found, and #6 asks for the node's pair in the stored order.
    for (const key of [poolKey(pool), daysKey(pool, WINDOWS["90d"].start), carryInKey(pool, WINDOWS["90d"].carryIn), tabKey(pool, "swaps"), createKey(pool), lastDayKey(pool)]) {
      expect(statusesOf(mock, key), key).toEqual([404]);
    }
    expect(keysOf(mock.requests)).toContain(candlesKey("USD+rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B/XRP", "1day", WINDOWS["90d"].start));
    expect(text).toContain("Not in the index yet, shown from the network. Its history appears once the index has it.");
    expect(text).toContain("XRP / USD pool");
    expect(robotsOf(html)).toBe("noindex");
    expect(hasCanonical(html)).toBe(false);
    expect(html).not.toContain('property="og:');
    // The state from the node; the charts in their "No data" state, the table empty, and no card that failed.
    expect(stats(html).find((stat) => stat.label === "Reserves")?.value).toBe("3,316.368141 XRP4,794.265265945032 USD");
    expect(html).not.toMatch(/<path class="line"/);
    expect(text).toContain("No swaps to show.");
    expect(sectionErrors(html)).toEqual([]);
  });
});

describe("the node failing, or not having the pool (spec 3.3, 3.6)", () => {
  it("shows the state from the index with its notice and fails the votes when the node fails (#2): served, not stored", async () => {
    cold();
    mock = mockUpstream("xrpl", { [nodeKey(USDC_POOL)]: nodeError("noNetwork") });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/amm/${USDC_POOL}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Live state unavailable; shown from the index");
    expect(sectionErrors(html)).toEqual(["Couldn’t load the fee votes."]);
    expect(html).toContain('aria-label="Pool state"');
    expect(text).toContain("Auction slot");
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the AMM pool page could not load a card"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("the live state");
  });

  it("draws the charts as one SectionError when last_validated fails (#3), and asks for none of their calls", async () => {
    cold();
    mock = mockUpstream("xrpl", { [LAST_VALIDATED]: unavailable() });
    const path = `/xrpl/amm/${USD_POOL}?tab=governance`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
    expect(keysOf(mock.requests).filter((key) => key.includes("/history?") || key.startsWith("GET /v2/exchanges/"))).toEqual([]);
    expect(sectionErrors(html)).toEqual(["Couldn’t load the charts."]);
    // The rest of the page is drawn: the state (whose Fees earned stat needs the day as well), the slot, the votes and the tab.
    expect(html).toContain('aria-label="Pool state"');
    expect(stats(html).find((stat) => stat.label === "Fees earned, last day")).toEqual({ label: "Fees earned, last day", value: "—", sub: "Couldn’t load" });
    expect(text).toContain("Fee votes");
    expect(tableRows(html, "Votes and bids").length).toBeGreaterThan(1);
  });

  it("fails the four cards of the day rows, and draws the volume without its fee estimates, when the window's days fail (#4)", async () => {
    cold();
    const key = daysKey(POOL, WINDOWS["30d"].start);
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const path = `/xrpl/amm/${POOL}?period=30d&tab=liquidity`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key)).toEqual([503]);
    expect(sectionErrors(html)).toEqual(["Couldn’t load the pool value.", "Couldn’t load the pool price.", "Couldn’t load the trading fee.", "Couldn’t load the reserves."]);
    expect(text).toContain("The fee estimates couldn't be loaded.");
    // The volume is the candles': 30 columns.
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
  });

  it("fails the volume card when the candles fail (#6)", async () => {
    cold();
    const key = candlesKey(`${RLUSD}/XRP`, "7day", WINDOWS["1y"].start);
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const path = `/xrpl/amm/${POOL}?period=1y&tab=liquidity`;
    const { response, html } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key)).toEqual([503]);
    expect(sectionErrors(html)).toEqual(["Couldn’t load the swap volume."]);
    expect((html.match(/class="col"/g) ?? []).length).toBe(0);
    expect((html.match(/<path class="line"/g) ?? []).length).toBe(5);
  });

  it.each([
    ["swaps", USD_POOL, "", "Couldn’t load the swaps."],
    ["liquidity", POOL, "?tab=liquidity", "Couldn’t load the liquidity events."],
    ["governance", POOL, "?tab=governance", "Couldn’t load the votes and bids."],
  ] as const)("fails the table of the %s tab when its page fails (#7), the tabs still links", async (tab, pool, query, said) => {
    cold();
    const key = tabKey(pool, tab);
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const path = `/xrpl/amm/${pool}${query}`;
    const { response, html } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key)).toEqual([503]);
    expect(sectionErrors(html)).toEqual([said]);
    expect(tabLinks(html)).toEqual({ Swaps: `/xrpl/amm/${pool}`, Liquidity: `/xrpl/amm/${pool}?tab=liquidity`, "Votes and bids": `/xrpl/amm/${pool}?tab=governance` });
  });

  it("reads the 24-hour volume as a dash it could not load when the live set fails (#9)", async () => {
    cold();
    mock = mockUpstream("xrpl", { [LIVE]: unavailable() });
    const path = `/xrpl/amm/${POOL}?period=1y&tab=governance`;
    const { response, html } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, LIVE)).toEqual([503]);
    expect(stats(html).find((stat) => stat.label === "Swap volume, 24 h")).toEqual({ label: "Swap volume, 24 h", value: "—", sub: "Couldn’t load" });
    expect(sectionErrors(html)).toEqual([]);
  });

  it("reads the fees of the last day as a dash it could not load when the last day fails (#10)", async () => {
    cold();
    const key = lastDayKey(POOL);
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const path = `/xrpl/amm/${POOL}?period=30d&tab=governance`;
    const { response, html } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key)).toEqual([503]);
    expect(stats(html).find((stat) => stat.label === "Fees earned, Oct 16")).toEqual({ label: "Fees earned, Oct 16", value: "—", sub: "Couldn’t load" });
    expect(sectionErrors(html)).toEqual([]);
  });

  it("leaves the Created line out when the create event fails (#8), logs it, and stores the page live: it is whole without it", async () => {
    cold();
    const key = createKey(DVR_POOL);
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/amm/${DVR_POOL}?period=30d`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(statusesOf(mock, key)).toEqual([503]);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "live", ttl: 5 });
    expect(text).not.toContain("Created");
    expect(sectionErrors(html)).toEqual([]);
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the AMM pool page left a line out"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("the creation event");
  });
});

// ---- Behind a marker -------------------------------------------------------------------------------------------------------------------------------

describe("a page of older rows (spec 3.3, step 2)", () => {
  it("is a 404 of class short when the API refuses the marker (a 400)", async () => {
    cold();
    const key = tabKey(POOL, "swaps", "AAAA");
    mock = mockUpstream("xrpl", { [key]: dataApiError(400, "invalid marker") });
    const path = `/xrpl/amm/${POOL}?marker=AAAA`;
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, key)).toEqual([400]);
    expect(text).toContain("that page of the AMM pool");
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 of class short when nothing is behind the marker", async () => {
    cold();
    const key = tabKey(POOL, "governance", "BBBB");
    mock = mockUpstream("xrpl", { [key]: { count: 0, governance: [], result: "success" } });
    const path = `/xrpl/amm/${POOL}?tab=governance&marker=BBBB`;
    const { response } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, key)).toEqual([200]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 of class short when the index has no such pool, and a 503 when it fails", async () => {
    cold();
    mock = mockUpstream("xrpl", { [poolKey(MADE_UP.olderFailing)]: unavailable() });
    const missing = `/xrpl/amm/${MADE_UP.olderMissing}?marker=CCCC`;
    const first = await render(missing);
    expect(first.response.status).toBe(404);
    expect(statusesOf(mock, poolKey(MADE_UP.olderMissing))).toEqual([404]);
    expect(await storedAs(missing)).toEqual({ cls: "short", ttl: 30 });

    const failing = `/xrpl/amm/${MADE_UP.olderFailing}?marker=CCCC`;
    await expectOutage(failing, (await render(failing)).response);
  });

  it("asks for the pool and the tab's page only, is stored as MARKER_PAGE_CLASS, noindex, follow, with the way back to the pool", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const marker = "WzEwNzY5OTY1NiwxNCwzXQ";
    const path = `/xrpl/amm/${POOL}?marker=${marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([poolKey(POOL), tabKey(POOL, "swaps", marker)].sort());
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    expect(robotsOf(html)).toBe("noindex, follow");
    expect(hasCanonical(html)).toBe(false);
    expect(html).toContain("<title>Older swaps of the XRP/RLUSD AMM pool · XRPL · explorer</title>");
    expect(linkTo(html, "Back to the pool")).toEqual([`/xrpl/amm/${POOL}`]);
    expect(tableRows(html, "Swaps").length).toBeGreaterThan(1);
    // No state, slot, votes or charts: they would be as old as the stored page.
    expect(html).not.toContain('aria-label="Pool state"');
    expect(text).not.toContain("Auction slot");
    expect((html.match(/class="col"/g) ?? []).length).toBe(0);
  });

  it("keeps the tab behind a marker, its way back to that tab", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const marker = "WzEwNzcwMzcwNywzNl0";
    const path = `/xrpl/amm/${POOL}?tab=liquidity&marker=${marker}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([poolKey(POOL), tabKey(POOL, "liquidity", marker)].sort());
    expect(html).toContain("<title>Older liquidity events of the XRP/RLUSD AMM pool · XRPL · explorer</title>");
    expect(linkTo(html, "Back to the pool")).toEqual([`/xrpl/amm/${POOL}?tab=liquidity`]);
  });
});

// ---- The modes, the class, the calls and the page -----------------------------------------------------------------------------------------------

describe("the first page", () => {
  it("is stored as live (5 s) and makes exactly the ten calls of spec 3.2, each kept as long as its class says", async () => {
    const { kept } = cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm/${POOL}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "live", ttl: 5 });
    expect([...keysOf(mock.requests)].sort()).toEqual(firstPageCalls(POOL, `${RLUSD}/XRP`, "90d"));
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    // #3 is the home page's key, kept 2 s; the day rows (#4, #5, #10) and the candles (#6) are kept 300 s; the pool and the live set are `minute`, 60 s;
    // the tab and the node `live`, 5 s; the create event `slow`, an hour.
    expect(await keptFor(kept, `GET ${API_BASE}/v2/last_validated [kept 2 s]`)).toBe("public, max-age=2");
    for (const query of ["interval=day&start=2026-07-20&end=2026-10-17&limit=1000", "interval=day&end=2026-07-19&descending=true&limit=1", "interval=day&start=2026-10-16&end=2026-10-16&limit=1"]) {
      expect(await keptFor(kept, `GET ${API_BASE}/v2/amm/pools/${POOL}/history?${query} [kept 300 s]`), query).toBe("public, max-age=300");
    }
    const candles = `GET ${API_BASE}/v2/exchanges/${RLUSD.replace("+", "%2B")}/XRP?interval=1day&start=2026-07-20&end=2026-10-17&limit=400&amm=only [kept 300 s]`;
    expect(await keptFor(kept, candles)).toBe("public, max-age=300");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/amm/pools/${POOL}`)).toBe("public, max-age=60");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/network/amm_volume?live=day`)).toBe("public, max-age=60");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/amm/pools/${POOL}/swaps?descending=true&limit=20`)).toBe("public, max-age=5");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/amm/pools/${POOL}/liquidity?event=create&limit=1`)).toBe("public, max-age=3600");

    // The page: the pool card, the state, the charts, the slot and the votes, the tab; indexable, with no card that failed.
    expect(text).toContain("XRP / RLUSD pool");
    expect(html).toContain('aria-label="Pool state"');
    expect(stats(html).map((stat) => stat.label)).toEqual(["Value", "Reserves", "Pool price", "Trading fee", "LP tokens", "Swap volume, 24 h", "Fees earned, Oct 16"]);
    expect(text).toContain("Charts cover the 90 days from Jul 20 to Oct 17, 2026 (UTC), today so far");
    expect(text).toContain("Auction slot");
    expect(text).toContain("Fee votes");
    // The generated pool's newest page holds two swaps, and the way to the older ones.
    expect(tableRows(html, "Swaps")).toHaveLength(3);
    expect(linkTo(html, "Older")).toEqual([`/xrpl/amm/${POOL}?marker=WzEwNzY5OTY1NiwxNCwzXQ`]);
    expect(sectionErrors(html)).toEqual([]);
    expect(robotsOf(html)).toBeUndefined();
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test/xrpl/amm/${POOL}"/>`);
  });

  it("holds the charts' marks and their tables in the HTML, without JavaScript, the running day marked so far", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html } = await render(`/xrpl/amm/${POOL}`);

    expect(response.status).toBe(200);
    // The volume, a column a day; the value (an area and its line), the price, the fee and the two reserves' panels, a line each.
    expect((html.match(/class="col"/g) ?? []).length).toBe(90);
    expect((html.match(/<path class="area"/g) ?? []).length).toBe(1);
    expect((html.match(/<path class="line"/g) ?? []).length).toBe(5);
    const rows = tableRows(html, "Pool value, in XRP");
    expect(rows).toHaveLength(91);
    expect(rows[1]![0]).toBe("Oct 17, 2026, so far");
    expect(rows[90]![0]).toBe("Jul 20, 2026");
    // The period links work without a script.
    expect(linkTo(html, "30 days")).toEqual([`/xrpl/amm/${POOL}?period=30d`]);
    expect(linkTo(html, "1 year")).toEqual([`/xrpl/amm/${POOL}?period=1y`]);
  });

  it.each([
    ["30d", 30],
    ["1y", 52],
  ] as const)("asks for the window of ?period=%s with the queries of poolQueries, and draws its buckets", async (period, buckets) => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm/${POOL}?period=${period}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual(firstPageCalls(POOL, `${RLUSD}/XRP`, period));
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    expect(await storedAs(path)).toEqual({ cls: "live", ttl: 5 });
    expect((html.match(/class="col"/g) ?? []).length).toBe(buckets);
    expect(robotsOf(html)).toBe("noindex, follow");
    expect(hasCanonical(html)).toBe(false);
  });

  it("answers its .data URL with the page's data and not a redirect: React Router's _routes is no part of the view (P1)", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const dataPath = `/xrpl/amm/${POOL}.data?_routes=routes%2Fnet.amm.%24pool`;
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("XRP / RLUSD pool");
    expect(await storedAs(dataPath)).toEqual({ cls: "live", ttl: 5 });
    // The browser never gets the API's answer: no raw field of it, no host.
    expect(body).not.toContain("value_native");
    expect(body).not.toContain("data.example.invalid");
  });

  it("answers the .data URL of a tab behind a marker, as the pager asks for it, with its data", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const marker = "WzEwNzY5OTY1NiwxNCwzXQ";
    const dataPath = `/xrpl/amm/${POOL}.data?marker=${marker}&_routes=routes%2Fnet.amm.%24pool`;
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(body).not.toContain("SingleFetchRedirect");
    expect(keysOf(mock.requests)).toContain(tabKey(POOL, "swaps", marker));
    expect(await storedAs(dataPath)).toEqual({ cls: "slow", ttl: 3600 });
  });

  it("is the gone mode for a pool the index has and the node does not (#2 actNotFound): live, with its notice, no slot or votes, not degraded", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm/${VOX_POOL}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(statusesOf(mock, nodeRequest(VOX_POOL))).toEqual([200]);
    expect(await storedAs(path)).toEqual({ cls: "live", ttl: 5 });
    expect(text).toContain("The network no longer has this pool; the index may not have seen its deletion yet.");
    expect(html).toContain('aria-label="Pool state"');
    expect(text).not.toContain("Auction slot");
    expect(text).not.toContain("Fee votes");
    expect(sectionErrors(html)).toEqual([]);
  });

  it("shows a deleted pool's history: class slow, the deleted banner, no state, slot or votes", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm/${SNK_POOL}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    expect(text).toContain("This pool was deleted. The last ledger that touched it is #100,132,150");
    expect(linkTo(html, "#100,132,150")).toEqual(["/xrpl/ledger/100132150"]);
    expect(html).not.toContain('aria-label="Pool state"');
    expect(text).not.toContain("Auction slot");
    expect(text).not.toContain("Fee votes");
    expect(html).toContain("<title>SNK/XRP AMM pool (deleted) · XRPL · explorer</title>");
    // Its charts and its activity.
    expect((html.match(/class="col"/g) ?? []).length).toBe(90);
    expect(sectionErrors(html)).toEqual([]);
  });
});

// ---- Redirects -----------------------------------------------------------------------------------------------------------------------------------

describe("the query of the URL (spec 1.2)", () => {
  it.each([
    [`?period=90d`, ""],
    [`?tab=swaps`, ""],
    [`?tab=bogus`, ""],
    [`?x=1`, ""],
    [`?back=M`, ""],
    [`?tab=liquidity&period=30d`, "?period=30d&tab=liquidity"],
    [`?period=30d&period=1y`, "?period=30d"],
    [`?marker=M&period=1y`, "?marker=M"],
    [`?back=M1&marker=M2&tab=governance`, "?tab=governance&marker=M2&back=M1"],
  ])("redirects ?%s to the canonical %s, class short, before any call", async (from, to) => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm/${POOL}${from}`;
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amm/${POOL}${to}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("redirects the path /xrpl/AMM/{pool} to /xrpl/amm/{pool}, class immutable (the path alone), before any call", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/AMM/${POOL}`;
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amm/${POOL}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "immutable", ttl: 31_536_000 });
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm/${POOL}.data?_routes=routes%2Fnet.amm.%24pool&tab=swaps`;
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(mock.requests).toEqual([]);
    expect(await stored(path)).toBeUndefined();
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    // React Router hands the loader the URL without its `.data`.
    const own = (await loader({
      request: new Request(`https://explorer.test${path}`),
      url: new URL(`https://explorer.test${path.replace(".data", "")}`),
      params: { net: "xrpl", pool: POOL },
      context: createLoadContext(env as unknown as Env, ctx),
    } as never)) as Response;
    expect(own.status).toBe(302);
    expect(own.headers.get("Location")).toBe(`/xrpl/amm/${POOL}`);
    expect(own.headers.get("X-Cache-Class")).toBe("short");
  });
});

// ---- The pair form ---------------------------------------------------------------------------------------------------------------------------------

describe("the pair form, /{net}/amm/{base}/{counter} (spec 1.3)", () => {
  const pairKey = (base: string, counter: string) => `GET /v2/amm/pools/${base}/${counter}`;

  it("redirects a pair to its live pool, class slow", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amm/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amm/${POOL}`);
    expect(keysOf(mock.requests)).toEqual([pairKey("XRP", RLUSD)]);
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
  });

  it("redirects a pair whose pool was deleted to it, class short: a new pool of the pair may come", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amm/SNK.rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm/XRP";
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amm/${SNK_POOL}`);
    expect(keysOf(mock.requests)).toEqual([pairKey("SNK+rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm", "XRP")]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 that names the pair in its natural orientation when the API has no pool of it", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amm/USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq/XRP";
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, pairKey("USD+rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", "XRP"))).toEqual([404]);
    expect(text).toContain("We couldn’t find an AMM pool for XRP/USD on XRPL.");
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 503, not stored, when the API fails, and when it has no AMM routes ('Cannot GET'), which is logged", async () => {
    cold();
    const eur = "EUR+rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
    const gbp = "GBP+rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
    mock = mockUpstream("xrpl", { [pairKey("XRP", eur)]: unavailable(), [pairKey("XRP", gbp)]: dataApiError(404, `Cannot GET /v2/amm/pools/XRP/${gbp}`) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const path of ["/xrpl/amm/XRP/EUR.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", "/xrpl/amm/XRP/GBP.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"]) {
      await expectOutage(path, (await render(path)).response);
    }
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the data API serves no AMM pools"))).toHaveLength(1);
  });

  it.each([
    ["/xrpl/amm/nope/XRP", 'We couldn’t find an AMM pool for "nope/XRP" on XRPL.'],
    ["/xrpl/amm/XRP/XRP", 'We couldn’t find an AMM pool for "XRP/XRP" on XRPL.'],
    // A currency other than the native one needs its issuer.
    ["/xrpl/amm/XRP/USD", 'We couldn’t find an AMM pool for "XRP/USD" on XRPL.'],
    ["/xrpl/amm/XRP/r%E2%80%AEUSD", 'We couldn’t find an AMM pool for "XRP/rUSD" on XRPL.'],
  ])("%s is a 404 of class short that repeats what was asked, with no call", async (path, sentence) => {
    mock = mockUpstream("xrpl");
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(sentence);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 on Xahau, which has no pool, before the pair is read and with no call", async () => {
    mock = mockUpstream("xahau");
    for (const path of ["/xahau/amm/XAH/USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", "/xahau/amm/nope/nope"]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("on Xahau.");
      expect(text).toContain("Xahau has no AMM.");
      expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
    }
    expect(mock.requests).toEqual([]);
  });

  it("redirects a query to the bare pair, class short, before any call: the form has no parameters", async () => {
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amm/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De?tab=liquidity";
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/amm/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});
