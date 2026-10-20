import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { USD_ISSUER } from "../../app/domain/network-params";
import { loader } from "../../app/routes/net.markets.$base.$counter";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration, createLoadContext, type Env } from "../../app/server/env";
import type { LivePairData } from "../../app/server/pair-view";
import { anchors, elementText, hrefs, pageClient, tableRows, textOf } from "../support/pages";
import xahauLastValidated from "../fixtures/http/xahau/data-api/last_validated.json";
import xrplLastValidated from "../fixtures/http/xrpl/data-api/last_validated.json";
import { dataApiError, mockUpstream, nodeError, statusesOf, type SeenRequest, type UpstreamMock } from "../support/upstream";

// The market pair page, `/{net}/markets/{base}/{counter}` (markets spec 3), on the real Worker against the derived and synthetic fixtures of
// Task 13 (XRP/RLUSD and LIONS/XRP in both orientations from the recorded ledgers, EVR/XAH on Xahau) and the recorded books and pool: the 404s
// and redirects made before any call, the class each answer is stored under, the calls of each view and how long each is kept, whether the
// market exists, what a failed call does to the page, the AMM parts and their switch, the page without JavaScript, and its tags. The off-case of
// `MARKETS` is markets-off.spec.ts (the `worker-off` project); a herd of visitors, the open page's `.data` URL and the node's failure hold are
// market-pair-live.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included, by the real clock (2 s for #1, #2, #6, #7;
// 5 s for #3, #8, #9, #10 and the short candles; 60 s for the traders and the long candles), and an error is never stored. So the tests that fail
// a call come first, and each overrides a key that no test before it stored: the cards fail on LIONS/XRP in either orientation and on EVR/XAH
// (the pages of the later tests are XRP/RLUSD's), in an order that needs no wait; the page that cannot be built, and whether a market exists,
// are asked of pairs that have no fixture at all (XAH/USD on Xahau; XRP/CAD, XRP/USD, XRP/EUR, XRP/AUD, XRP/CHF, XRP/GBP and XRP/JPY of
// rhub8V…F3wq on XRPL, one test each, their books given). One override is an answer the tests after it read: the pool of LIONS/XRP that the
// share's test gives the node is kept 5 s (see "a call that is one card of the page"). The last block waits out a `last_validated` the tests
// before it kept. The afterEach below fails a test whose override no request used, which is how a key that an earlier test stored shows.
// `Date` alone is faked and moved 31 s on after each test, past the failure hold (the holds are per isolate, and a key held by one test must not
// be the next test's); within a test it stands still, so a second render is within the hold of the first.

const { get, storedAs } = pageClient("198.51.109");

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
  vi.setSystemTime(Date.now() + 31_000);
  expect(unused ?? []).toEqual([]);
});

afterAll(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** How many errors the page shows (each `SectionError` is an alert; the node's notices are not). */
const alerts = (html: string) => (html.match(/role="alert"/g) ?? []).length;
const notices = (text: string) => (text.match(/Live state unavailable/g) ?? []).length;

const unavailable = () => dataApiError(503, "unavailable");

// ---- The pairs, as the URL, the data API and the node write them -----------------------------------------------------------------------------

const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const LIONS_HEX = "4C494F4E53000000000000000000000000000000";
const EVR_ISSUER = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
/** XRP/RLUSD's pool: the other side of every swap, and the top of its traders list. */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

/** The assets as the data API's path and the node's subject write them (`CUR+issuer`, the currency as the ledger holds it). */
const R = `${RLUSD_HEX}+${RLUSD_ISSUER}`;
const L = `${LIONS_HEX}+${LIONS_ISSUER}`;
const E = `EVR+${EVR_ISSUER}`;
const USD = `USD+${USD_ISSUER}`;
const EUR = `EUR+${USD_ISSUER}`;
const GBP = `GBP+${USD_ISSUER}`;
const JPY = `JPY+${USD_ISSUER}`;
const AUD = `AUD+${USD_ISSUER}`;
const CAD = `CAD+${USD_ISSUER}`;
const CHF = `CHF+${USD_ISSUER}`;

/** XRP/RLUSD in its natural orientation (RLUSD ranks as a quote, XRP does not) and the other way round. */
const PAIR = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;
const INVERTED = `/xrpl/markets/RLUSD.${RLUSD_ISSUER}/XRP`;
/** LIONS/XRP in its natural orientation (an unranked code against the native one) and the other way round. */
const LIONS = `/xrpl/markets/LIONS.${LIONS_ISSUER}/XRP`;
const XRP_LIONS = `/xrpl/markets/XRP/LIONS.${LIONS_ISSUER}`;
const EVR = `/xahau/markets/EVR.${EVR_ISSUER}/XAH`;

/** T₁ (spec 3.3): the start of the minute of the recorded `last_validated`, minus a day. */
const T1 = { xrpl: "2026-10-16T17:01:00Z", xahau: "2026-10-16T17:47:00Z" } as const;
/** S: the first of the 60 buckets that end with the one holding the recorded close time (XRPL 17:01:12, Xahau 17:47:11 on 2026-10-17). */
const START = {
  xrpl: { "15m": "2026-10-17T02:15:00Z", "1h": "2026-10-15T06:00:00Z", "4h": "2026-10-07T20:00:00Z", "1d": "2026-08-19T00:00:00Z", "1w": "2025-08-25T00:00:00Z" },
  xahau: { "15m": "2026-10-17T03:00:00Z", "1h": "2026-10-15T06:00:00Z", "4h": "2026-10-07T20:00:00Z", "1d": "2026-08-19T00:00:00Z", "1w": "2025-08-25T00:00:00Z" },
} as const;
type Interval = keyof (typeof START)["xrpl"];
const API_INTERVAL = { "15m": "15minute", "1h": "1hour", "4h": "4hour", "1d": "1day", "1w": "7day" } as const satisfies Record<Interval, string>;
type Net = keyof typeof T1;

// ---- The calls, by the keys the mock names them (its query sorted by name; a node's by its subject) ----------------------------------------

const LAST_VALIDATED = "GET /v2/last_validated";
const ammOf = (amm?: "exclude" | "only") => (amm === undefined ? "" : `amm=${amm}&`);
/** #2: the newest trades, `marker` for a page behind one. */
const tradesKey = (pair: string, amm?: "exclude" | "only", marker?: string) =>
  `GET /v2/exchanges/${pair}?${ammOf(amm)}descending=true&limit=20${marker === undefined ? "" : `&marker=${marker}`}`;
/** #3 and #9: the 24 h figures. */
const reduceKey = (pair: string, start: string, amm?: "exclude" | "only") => `GET /v2/exchanges/${pair}?${ammOf(amm)}reduce=true&start=${start}`;
/** #4: the candles. */
const candlesKey = (pair: string, interval: Interval, start: string, amm?: "exclude" | "only") =>
  `GET /v2/exchanges/${pair}?${ammOf(amm)}interval=${API_INTERVAL[interval]}&limit=61&start=${start}`;
/** #5: the traders. */
const accountsKey = (pair: string) => `GET /v2/active_accounts/${pair}`;
/** #10: the first trade of the pair, whatever its filter. */
const probeKey = (pair: string) => `GET /v2/exchanges/${pair}?descending=true&limit=1`;
/** #6 and #7: a side of the book, by what its offers give and want. */
const bookKey = (gets: string, pays: string) => `node book_offers ${gets}_${pays}`;
/** #8: the pool of a pair. */
const poolKey = (asset: string, asset2: string) => `node amm_info ${asset}_${asset2}`;

/** An asset of a node request as a subject writes it. */
function subjectOf(value: unknown): string {
  const { currency, issuer } = value as { currency: string; issuer?: string };
  return issuer === undefined ? currency : `${currency}+${issuer}`;
}

/** A request as the keys above name it: a data API call by its key, a node call by its method and subject. */
function callOf(request: SeenRequest): string {
  if (request.kind !== "node") return request.key;
  const { method, params } = request.body as { method: string; params: [Record<string, unknown>] };
  const [p] = params;
  if (method === "book_offers") return bookKey(subjectOf(p.taker_gets), subjectOf(p.taker_pays));
  if (method === "amm_info") return p.amm_account === undefined ? poolKey(subjectOf(p.asset), subjectOf(p.asset2)) : `node amm_info ${String(p.amm_account)}`;
  return request.key;
}
const callsOf = (requests: readonly SeenRequest[]) => requests.map(callOf);
/** How many times the mock was asked for `call`. A held call does not reach it. */
const timesAsked = (call: string) => callsOf(mock!.requests).filter((seen) => seen === call).length;

// ---- The subrequest cache's own keys (data-api.ts, node-rpc.ts): which entry a call reads and writes, and for how long ----------------------

const API_BASE = { xrpl: "https://xrpl.data.example.invalid", xahau: "https://xahau.data.example.invalid" } as const;
const NODE_URL = { xrpl: "https://s1.ripple.com:51234/", xahau: "https://xahau.network/" } as const;
/** What the key of a call the page keeps 2 s (`HOME_CALL_TTL_SECONDS`) ends with: the home page's entries are the same. */
const KEPT = " [kept 2 s]";
const SUBREQUESTS = "https://subrequest-cache.invalid/";

/**
 * The cache key of a data API call: the URL with its query in the order spec 3.3 writes it (the client's), written as the client writes it
 * (`URLSearchParams`, which escapes the colons of a time), each path segment escaped.
 */
function apiKey(net: Net, path: string, query: string, kept = false): string {
  const written = new URLSearchParams(query).toString();
  return `GET ${API_BASE[net]}${path}${written === "" ? "" : `?${written}`}${kept ? KEPT : ""}`;
}

/** An asset as the node is sent it. */
const nodeAsset = (text: string) => (text.includes("+") ? { currency: text.split("+")[0], issuer: text.split("+")[1] } : { currency: text });

/** The cache key of a node call: the node's URL and the JSON-RPC body. */
function nodeKey(net: Net, method: string, params: Record<string, unknown>, kept = false): string {
  return `POST ${NODE_URL[net]} ${JSON.stringify({ method, params: [params] })}${kept ? KEPT : ""}`;
}

/** The URL the subrequest cache stores a key under (edge-cache.ts: the build and the SHA-256 of the key). */
async function entryOf(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return `${SUBREQUESTS}${encodeURIComponent(env.BUILD_ID)}/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type Filter = "book" | "amm";

/**
 * The cache keys of the calls of a live view of a pair (spec 3.3), in the table's order, the pair in the URL's orientation. `natural` is the
 * pair as the pool is asked for it (#8), left out where the network has no pools; `amm` is whether the AMM parts exist (#9).
 */
function viewKeys(
  net: Net,
  [base, counter]: [string, string],
  { interval = "1h", trades, amm, natural }: { interval?: Interval; trades?: Filter; amm: boolean; natural?: [string, string] },
): string[] {
  const pair = `/v2/exchanges/${encodeURIComponent(base)}/${encodeURIComponent(counter)}`;
  const filter = trades === undefined ? "" : `&amm=${trades === "book" ? "exclude" : "only"}`;
  const book = (gets: string, pays: string) => ({ taker_gets: nodeAsset(gets), taker_pays: nodeAsset(pays), ledger_index: "validated", limit: 60 });
  return [
    apiKey(net, "/v2/last_validated", "", true),
    apiKey(net, pair, `descending=true&limit=20${filter}`, true),
    apiKey(net, pair, `reduce=true&start=${T1[net]}${filter}`),
    apiKey(net, pair, `interval=${API_INTERVAL[interval]}&start=${START[net][interval]}&limit=61${filter}`),
    apiKey(net, `/v2/active_accounts/${encodeURIComponent(base)}/${encodeURIComponent(counter)}`, ""),
    nodeKey(net, "book_offers", book(base, counter), true),
    nodeKey(net, "book_offers", book(counter, base), true),
    ...(natural === undefined ? [] : [nodeKey(net, "amm_info", { asset: nodeAsset(natural[0]), asset2: nodeAsset(natural[1]), ledger_index: "validated" })]),
    ...(amm ? [apiKey(net, pair, `reduce=true&start=${T1[net]}&amm=${trades === "amm" ? "exclude" : "only"}`)] : []),
  ];
}

/**
 * What the subrequest cache is asked for and given while a test runs: every entry a call looks up (an answer kept by an earlier render is looked
 * up all the same, so this is every call the loader made), and the `Cache-Control` of every entry stored.
 */
function watchSubrequests() {
  const looked: string[] = [];
  const kept = new Map<string, string | null>();
  const match = caches.default.match.bind(caches.default);
  const put = caches.default.put.bind(caches.default);
  vi.spyOn(caches.default, "match").mockImplementation(async (request, options) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    if (url.startsWith(SUBREQUESTS)) looked.push(url);
    return match(request, options);
  });
  vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    if (url.startsWith(SUBREQUESTS)) kept.set(url, (response as Response).headers.get("Cache-Control"));
    return put(request, response);
  });
  /**
   * The keys looked up (those from the `from`th lookup to the `to`th: one render's, where a test makes two), by the names `keys` gives them; an
   * entry of no key among them is shown by its URL.
   */
  async function lookedUp(keys: readonly string[], from = 0, to = looked.length): Promise<string[]> {
    const names = new Map(await Promise.all(keys.map(async (key) => [await entryOf(key), key] as const)));
    return looked.slice(from, to).map((url) => names.get(url) ?? `an entry of another key: ${url}`);
  }
  /** How long the entry of `key` was stored for (`max-age=N`), once it has been. */
  async function keptFor(key: string): Promise<string | null | undefined> {
    const entry = await entryOf(key);
    await vi.waitFor(() => expect(kept.has(entry), `nothing stored for ${key}`).toBe(true), { timeout: 5_000 });
    return kept.get(entry);
  }
  return { lookedUp, keptFor, lookups: () => looked.length };
}

/** The page data a loader run directly answers with (`cached`: React Router's `data()`). */
type Cached<T> = { data: T; init: ResponseInit | null };

/** A pool of LIONS/XRP, which the node does not have: for the pool card's share, whose failure shows only beside a pool. */
const LIONS_POOL_ACCOUNT = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const LIONS_POOL = {
  amm: {
    account: LIONS_POOL_ACCOUNT,
    amount: { currency: LIONS_HEX, issuer: LIONS_ISSUER, value: "1250000" },
    amount2: "5000000000",
    lp_token: { currency: "03C2B4D6E8F0123456789ABCDEF0123456789ABC", issuer: LIONS_POOL_ACCOUNT, value: "79056.94" },
    trading_fee: 300,
    vote_slots: [],
  },
  ledger_index: 107721455,
  validated: true,
};

/** A list with no trade, and a pair nobody traded, as the data API answers them. */
const NO_TRADES = { count: 0, exchanges: [], result: "success" };
const NO_TRADERS = { accounts: [], count: 0, exchanges_count: 0, result: "success" };

/** A side of a book with no offer in it, as the node answers it (its `result`). */
const EMPTY_BOOK = { ledger_index: 107721455, offers: [], validated: true };

/** One trade of XRP/AUD (rhub8V…F3wq), as the data API writes it: what #10 finds when the filtered list is empty and the market is not. */
const ONE_AUD_TRADE = {
  count: 1,
  exchanges: [
    {
      base_amount: "100",
      base_currency: "XRP",
      buyer: "rKYdJJLAgxbJcn9Ria2X5jMMiqP91r4qy",
      counter_amount: "245",
      counter_currency: "AUD",
      counter_issuer: USD_ISSUER,
      executed_time: "2026-10-17T16:40:00Z",
      ledger_index: 107721100,
      node_index: 2,
      offer_sequence: 12,
      provider: "rKYdJJLAgxbJcn9Ria2X5jMMiqP91r4qy",
      rate: "2.45",
      seller: "rHciXfG7ZxFNTYZajwGH7sxCjGJV9rJrHC",
      taker: "rHciXfG7ZxFNTYZajwGH7sxCjGJV9rJrHC",
      tx_hash: "AB".repeat(32),
      tx_index: 4,
      tx_type: "OfferCreate",
    },
  ],
  result: "success",
};

// ---- Failures first ---------------------------------------------------------------------------------------------------------------------

describe("a call the page cannot be built without", () => {
  it("answers 503 with Retry-After, not stored, when last_validated fails: the rest was asked and settled, no chain went on, and the failure is held", async () => {
    // XAH/USD of rhub8V…F3wq on Xahau: a pair of its own (its book is no later test's), every other call of it answered by an override.
    const pair = `XAH/${USD}`;
    const path = `/xahau/markets/XAH/USD.${USD_ISSUER}`;
    mock = mockUpstream("xahau", {
      [LAST_VALIDATED]: unavailable(),
      [tradesKey(pair)]: NO_TRADES,
      [accountsKey(pair)]: NO_TRADERS,
      [bookKey("XAH", USD)]: EMPTY_BOOK,
      [bookKey(USD, "XAH")]: EMPTY_BOOK,
    });
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    // #2, #5, #6 and #7 were asked side by side and answered; #3 and #4 follow the anchor and were not asked; Xahau has no #8 or #9.
    expect(callsOf(mock.requests).sort()).toEqual([LAST_VALIDATED, tradesKey(pair), accountsKey(pair), bookKey("XAH", USD), bookKey(USD, "XAH")].sort());
    expect(mock.requests.filter((request) => request.key !== LAST_VALIDATED).map((request) => request.status)).toEqual([200, 200, 200, 200]);

    // A second render a moment later is given the held failure: last_validated is not asked again.
    expect((await render(path)).response.status).toBe(503);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
  });

  it("answers 503 when the trades fail, once every other call has settled, and holds that failure too", async () => {
    // XRP/CAD of rhub8V…F3wq: no fixture, so its other calls answer what the API says of a pair it has nothing of ("Cannot GET", an empty
    // book, no pool). They are answered all the same, and awaited.
    const pair = `XRP/${CAD}`;
    const path = `/xrpl/markets/XRP/CAD.${USD_ISSUER}`;
    mock = mockUpstream("xrpl", { [tradesKey(pair)]: unavailable(), [bookKey("XRP", CAD)]: EMPTY_BOOK, [bookKey(CAD, "XRP")]: EMPTY_BOOK });
    const watched = watchSubrequests();
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    // Every call of the view was made and answered (nothing runs on behind an answered request): #1, the two chains, the cards, the node's.
    expect(callsOf(mock.requests).sort()).toEqual(
      [
        LAST_VALIDATED,
        tradesKey(pair),
        reduceKey(pair, T1.xrpl),
        candlesKey(pair, "1h", START.xrpl["1h"]),
        accountsKey(pair),
        bookKey("XRP", CAD),
        bookKey(CAD, "XRP"),
        poolKey("XRP", CAD),
        reduceKey(pair, T1.xrpl, "only"),
      ].sort(),
    );
    expect(mock.requests.every((request) => request.status > 0)).toBe(true);
    // The first render of XRPL in the file: #1 is stored here, under the home page's key, for 2 s.
    expect(await watched.keptFor(apiKey("xrpl", "/v2/last_validated", "", true))).toBe("public, max-age=2");

    expect((await render(path)).response.status).toBe(503);
    expect(statusesOf(mock, tradesKey(pair))).toEqual([503]);
  });
});

describe("whether the market exists", () => {
  // Each test is a pair of its own that has no fixture, its two book sides given empty, so that no test reads a book an earlier one kept.

  it("is a 404 of class short, with the search box, for a pair with no trade and an empty book, and asks for no unfiltered trade", async () => {
    const path = `/xrpl/markets/XRP/USD.${USD_ISSUER}`;
    mock = mockUpstream("xrpl", { [tradesKey(`XRP/${USD}`)]: NO_TRADES, [bookKey("XRP", USD)]: EMPTY_BOOK, [bookKey(USD, "XRP")]: EMPTY_BOOK });
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find a market for XRP/USD (USD issued by rhub8V…F3wq) on XRPL.");
    expect(html).toContain('name="q"');
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
    // #10 is for a filtered list alone.
    expect(callsOf(mock.requests)).not.toContain(probeKey(`XRP/${USD}`));
    expect(timesAsked(bookKey("XRP", USD))).toBe(1);
    expect(timesAsked(bookKey(USD, "XRP"))).toBe(1);
  });

  it("is a 503, not stored, for a pair with no trade whose book could not be read: an empty market cannot be told from a failed node", async () => {
    const path = `/xrpl/markets/XRP/EUR.${USD_ISSUER}`;
    mock = mockUpstream("xrpl", { [tradesKey(`XRP/${EUR}`)]: NO_TRADES, [bookKey("XRP", EUR)]: nodeError("noNetwork"), [bookKey(EUR, "XRP")]: EMPTY_BOOK });
    const { response, text } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(text).not.toContain("We couldn’t find");
    expect(await isStored(path)).toBe(false);
  });

  it("asks for the first unfiltered trade (#10, live: kept 5 s) when a filtered list and the book are empty, and is the page when there is one", async () => {
    const path = `/xrpl/markets/XRP/AUD.${USD_ISSUER}?trades=book`;
    mock = mockUpstream("xrpl", {
      [tradesKey(`XRP/${AUD}`, "exclude")]: NO_TRADES,
      [probeKey(`XRP/${AUD}`)]: ONE_AUD_TRADE,
      [bookKey("XRP", AUD)]: EMPTY_BOOK,
      [bookKey(AUD, "XRP")]: EMPTY_BOOK,
    });
    const watched = watchSubrequests();
    const { response, text } = await render(path);

    // The market exists; its other calls have no fixture (the API's "Cannot GET"), so its cards failed, and the page is degraded.
    await expectDegraded(path, response);
    expect(statusesOf(mock, probeKey(`XRP/${AUD}`))).toEqual([200]);
    // The pair has traded; the filter's list is what is empty, and the page says so in its words.
    expect(text).toContain("No order-book trades yet.");
    expect(text).not.toContain("No trades yet");
    // #10 has no `amm` and no TTL of its own: class `live`, 5 s.
    expect(await watched.keptFor(apiKey("xrpl", `/v2/exchanges/XRP/${encodeURIComponent(AUD)}`, "descending=true&limit=1"))).toBe("public, max-age=5");
  });

  it("is a 404 when the first unfiltered trade is not there either", async () => {
    const path = `/xrpl/markets/XRP/CHF.${USD_ISSUER}?trades=amm`;
    mock = mockUpstream("xrpl", {
      [tradesKey(`XRP/${CHF}`, "only")]: NO_TRADES,
      [probeKey(`XRP/${CHF}`)]: NO_TRADES,
      [bookKey("XRP", CHF)]: EMPTY_BOOK,
      [bookKey(CHF, "XRP")]: EMPTY_BOOK,
    });
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find a market for XRP/CHF (CHF issued by rhub8V…F3wq) on XRPL.");
    expect(statusesOf(mock, probeKey(`XRP/${CHF}`))).toEqual([200]);
  });

  it("is a 503 when the first unfiltered trade could not be asked for, and holds that failure", async () => {
    const path = `/xrpl/markets/XRP/GBP.${USD_ISSUER}?trades=book`;
    mock = mockUpstream("xrpl", {
      [tradesKey(`XRP/${GBP}`, "exclude")]: NO_TRADES,
      [probeKey(`XRP/${GBP}`)]: unavailable(),
      [bookKey("XRP", GBP)]: EMPTY_BOOK,
      [bookKey(GBP, "XRP")]: EMPTY_BOOK,
    });
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
    expect((await render(path)).response.status).toBe(503);
    expect(statusesOf(mock, probeKey(`XRP/${GBP}`))).toEqual([503]);
  });
});

// The cards fail on LIONS/XRP in both orientations and on EVR/XAH, in an order that needs no wait: each test fails keys that no test before it
// kept. The second gives the node a pool of LIONS/XRP (a 200, kept 5 s): the tests that follow it within 5 s draw that pool and none of them
// says anything of the pool card; the one that fails amm_info, which must reach the node, comes after the two that wait out the node's 3 s
// and the card's 4.5 s. The one that fails #9 beside no pool comes first of all, before the node is given a pool.
describe("a call that is one card of the page", () => {
  it("stores a pair without a pool as live-home when #9 fails: the share is a line of the pool card, so nothing on the page failed", async () => {
    // First of the block: the node's own answer for LIONS/XRP (no pool, which is not stored) is what this test reads, before the next test gives
    // it a pool; the failed #9 is not stored either, so the next test's override of it reaches the mock.
    const pair = `${L}/XRP`;
    const path = `${LIONS}?interval=1d`;
    mock = mockUpstream("xrpl", { [reduceKey(pair, T1.xrpl, "only")]: unavailable() });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { response, html, text } = await render(path);

    expect(statusesOf(mock, reduceKey(pair, T1.xrpl, "only"))).toEqual([503]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "live-home", ttl: 1 });
    expect(text).not.toContain("LIONS/XRP AMM pool");
    expect(text).not.toContain("Couldn’t load");
    expect(alerts(html)).toBe(0);
    // Nothing is logged as a failure of the page.
    expect(errors.mock.calls.filter(([line]) => String(line).includes("the market pair page's"))).toEqual([]);
  });

  it("reads — Couldn’t load beside a pool when #9 fails, marks the page degraded, and holds the failure", async () => {
    const pair = `${L}/XRP`;
    const path = `${LIONS}?interval=15m`;
    mock = mockUpstream("xrpl", { [poolKey(L, "XRP")]: LIONS_POOL, [reduceKey(pair, T1.xrpl, "only")]: unavailable() });
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("LIONS/XRP AMM pool");
    expect(text).toContain("Share of pair volume, 24 h — Couldn’t load");
    expect(text).toContain("Trading fee 0.300%");
    expect(alerts(html)).toBe(0);
    expect(text).not.toContain("Couldn’t load the 24 h figures.");

    await render(path);
    expect(statusesOf(mock, reduceKey(pair, T1.xrpl, "only"))).toEqual([503]);
  });

  it("fails the 24 h figures and the traders alone, logs each, says nothing of the error in the page, and holds both failures", async () => {
    const pair = `XRP/${L}`;
    mock = mockUpstream("xrpl", { [reduceKey(pair, T1.xrpl)]: unavailable(), [accountsKey(pair)]: unavailable() });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { response, html, text } = await render(XRP_LIONS);

    await expectDegraded(XRP_LIONS, response);
    expect(text).toContain("Couldn’t load the 24 h figures.");
    expect(text).toContain("Couldn’t load the most active traders.");
    expect(alerts(html)).toBe(2);
    // The six figures are dashes under their labels, and so is the change.
    expect(text).toMatch(/24 h high — 24 h low — VWAP 24 h — Volume XRP — Volume LIONS — Trades 24 h —/);
    // The rest of the page is there: the chart, the book, the trades.
    expect(html).toContain('class="candle"');
    expect(html).toContain('aria-label="Order book"');
    expect(tableRows(html, "Recent trades").length).toBeGreaterThan(1);
    expect(notices(text)).toBe(0);

    // Each was logged with its error; the page's data, which goes to the browser too, holds none of it.
    const logged = errors.mock.calls.map(([line]) => String(line));
    expect(logged.find((line) => line.includes("the market pair page's stats could not be loaded"))).toContain("unavailable");
    expect(logged.find((line) => line.includes("the market pair page's traders could not be loaded"))).toContain("unavailable");
    expect(html).not.toContain("unavailable");

    // A second render a moment later asks neither again.
    expect((await render(XRP_LIONS)).text).toContain("Couldn’t load the 24 h figures.");
    expect(statusesOf(mock, reduceKey(pair, T1.xrpl))).toEqual([503]);
    expect(statusesOf(mock, accountsKey(pair))).toEqual([503]);
  });

  it("fails the price card alone when the candles fail: the error in place of the views and the interval control, and held", async () => {
    const pair = `XRP/${L}`;
    const path = `${XRP_LIONS}?interval=4h`;
    mock = mockUpstream("xrpl", { [candlesKey(pair, "4h", START.xrpl["4h"])]: unavailable() });
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the price chart.");
    expect(alerts(html)).toBe(1);
    expect(html).not.toContain('class="candle"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('aria-label="Candle interval"');
    expect(text).not.toContain("Couldn’t load the 24 h figures.");

    await render(path);
    expect(statusesOf(mock, candlesKey(pair, "4h", START.xrpl["4h"]))).toEqual([503]);
  });

  it("says Live state unavailable in place of the whole book when the node fails, never half a book, and holds both sides", async () => {
    const path = `${EVR}?interval=1d`;
    mock = mockUpstream("xahau", { [bookKey(E, "XAH")]: nodeError("noNetwork"), [bookKey("XAH", E)]: nodeError("slowDown") });
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("The network node did not answer, so the order book is missing.");
    expect(notices(text)).toBe(1);
    expect(html).not.toContain('aria-label="Order book"');
    expect(text).not.toContain("No asks");
    // The trades and the price are the index's.
    expect(tableRows(html, "Recent trades").length).toBeGreaterThan(1);

    await render(path);
    expect(timesAsked(bookKey(E, "XAH"))).toBe(1);
    expect(timesAsked(bookKey("XAH", E))).toBe(1);
  });

  it("says the same when one side has not answered in the node's 3 s, and the page does not wait for the card's 4.5 s", async () => {
    const path = `${EVR}?interval=1w`;
    mock = mockUpstream("xahau", { [bookKey(E, "XAH")]: () => new Promise<Response>(() => {}) });
    const started = performance.now();
    const { response, html, text } = await render(path);
    const took = performance.now() - started;

    await expectDegraded(path, response);
    expect(took).toBeGreaterThanOrEqual(2_900);
    expect(took).toBeLessThan(4_400);
    expect(text).toContain("The network node did not answer, so the order book is missing.");
    expect(html).not.toContain('aria-label="Order book"');
  }, 15_000);

  it("gives up on a card that has not answered 4.5 s after the loader began, logs that it took too long, and answers 200 all the same", async () => {
    const pair = `XRP/${L}`;
    const path = `${XRP_LIONS}?interval=1d`;
    mock = mockUpstream("xrpl", { [candlesKey(pair, "1d", START.xrpl["1d"])]: () => new Promise<Response>(() => {}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const started = performance.now();
    const { response, text } = await render(path);
    const took = performance.now() - started;

    await expectDegraded(path, response);
    // The card's deadline; the data API client would have given up at 5 s.
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(text).toContain("Couldn’t load the price chart.");
    expect(errors.mock.calls.some(([line]) => String(line).includes("the market pair page's candles took too long"))).toBe(true);
  }, 15_000);

  it("keeps the pool card with its title and the node's notice when amm_info fails, and asks the node once in the hold", async () => {
    const path = `${LIONS}?interval=4h`;
    mock = mockUpstream("xrpl", { [poolKey(L, "XRP")]: nodeError("internal") });
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("LIONS/XRP AMM pool");
    expect(text).toContain("The network node did not answer, so the pool’s reserves and fee are missing.");
    expect(notices(text)).toBe(1);
    expect(alerts(html)).toBe(0);
    // The book is another call's.
    expect(html).toContain('aria-label="Order book"');

    await render(path);
    expect(timesAsked(poolKey(L, "XRP"))).toBe(1);
  });
});

// ---- Validation and redirects: before any call ------------------------------------------------------------------------------------------

describe("what is not a pair", () => {
  it.each([
    ["an issued code without an issuer", "/xrpl/markets/XRP/USD", '"XRP/USD"'],
    ["the native code with an issuer", `/xrpl/markets/XRP.${RLUSD_ISSUER}/RLUSD.${RLUSD_ISSUER}`, `"XRP.${RLUSD_ISSUER}/R"`],
    ["Xahau's native code with an issuer", `/xahau/markets/XAH.${EVR_ISSUER}/EVR.${EVR_ISSUER}`, `"XAH.${EVR_ISSUER}/E"`],
    ["an issuer whose checksum is wrong", "/xrpl/markets/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5Dx", '"XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8"'],
    ["an X-address as the issuer", "/xrpl/markets/XRP/USD.X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ", '"XRP/USD.X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5"'],
    ["the same asset on both sides", "/xrpl/markets/XRP/XRP", '"XRP/XRP"'],
    ["the same issued asset on both sides", `/xrpl/markets/RLUSD.${RLUSD_ISSUER}/RLUSD+${RLUSD_ISSUER}`, `"RLUSD.${RLUSD_ISSUER}"`],
    ["more than one separator", `/xrpl/markets/XRP/USD.${USD_ISSUER}.x`, '"XRP/USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3"'],
    ["a code holding a |", `/xrpl/markets/XRP/U%7CSD.${USD_ISSUER}`, '"XRP/U|SD.rhub8VRN55s94qWKDv6jmDy1pUykJzF"'],
    ["the native code's 40 zeros", `/xrpl/markets/XRP/${"0".repeat(40)}.${USD_ISSUER}`, `"XRP/${"0".repeat(36)}"`],
    ["an escape that is not one", "/xrpl/markets/XRP/%E0%A4%A", '"XRP/%E0%A4%A"'],
    ["a text cut to 40 characters", `/xrpl/markets/${"A".repeat(25)}/${"B".repeat(25)}`, `"${"A".repeat(25)}/${"B".repeat(14)}"`],
  ])("is a 404 of class short for %s, before any call, saying what was asked", async (_what, path, asked) => {
    mock = mockUpstream(path.startsWith("/xahau") ? "xahau" : "xrpl");
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(`We couldn’t find a market for ${asked} on`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it.each([
    ["one segment", "/xrpl/markets/XRP"],
    ["three segments", `${PAIR}/more`],
    ["a network that does not exist", `/bitcoin/markets/XRP/RLUSD.${RLUSD_ISSUER}`],
  ])("is a 404 for %s, before any call", async (_what, path) => {
    mock = mockUpstream("xrpl");
    const { response } = await render(path);
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 of class short for a marker that is not one, before the query is tidied and before any call", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/markets/xrp/RLUSD.${RLUSD_ISSUER}?interval=4h&marker=%21%21`;
    const { response, html, text } = await render(path);
    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find that page of the market’s trades on XRPL.");
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});

describe("the one URL of a view", () => {
  it.each([
    ["a standard code in lower case", `/xrpl/markets/xrp/RLUSD.${RLUSD_ISSUER}`, PAIR],
    ["the + separator", `/xrpl/markets/XRP/RLUSD+${RLUSD_ISSUER}`, PAIR],
    ["the escaped + separator", `/xrpl/markets/XRP/RLUSD%2B${RLUSD_ISSUER}`, PAIR],
    ["the hex of a text code", `/xrpl/markets/XRP/${RLUSD_HEX}.${RLUSD_ISSUER}`, PAIR],
    ["the route's word in another case", `/xrpl/Markets/XRP/RLUSD.${RLUSD_ISSUER}`, PAIR],
    ["usd for USD", `/xrpl/markets/XRP/usd.${USD_ISSUER}`, `/xrpl/markets/XRP/USD.${USD_ISSUER}`],
  ])("redirects %s to the canonical path, class immutable, before any call", async (_what, from, to) => {
    mock = mockUpstream("xrpl");
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(to);
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual({ cls: "immutable", ttl: 31_536_000 });
  });

  it.each([
    [`${PAIR}?interval=1h`, PAIR],
    [`${PAIR}?trades=AMM&interval=4h&x=1`, `${PAIR}?interval=4h&trades=amm`],
    [`${PAIR}?marker=WzEwNzY3MTU5MSwxNCwxXQ&interval=4h`, `${PAIR}?marker=WzEwNzY3MTU5MSwxNCwxXQ`],
    [`/xrpl/markets/xrp/RLUSD+${RLUSD_ISSUER}?interval=1w&interval=1d`, `${PAIR}?interval=1w`],
    [`${EVR}?trades=amm`, EVR],
  ])("redirects %s to %s, class short: the query changed", async (from, to) => {
    mock = mockUpstream("xrpl");
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(to);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual({ cls: "short", ttl: 30 });
  });

  it("tidies the .data URL the same way, with the class of the change, and the loader's own answer names it", async () => {
    mock = mockUpstream("xrpl");
    const ROUTES = "_routes=routes%2Fnet.markets.%24base.%24counter";
    const pathOnly = await get(`/xrpl/markets/xrp/RLUSD.${RLUSD_ISSUER}.data?${ROUTES}`);
    const body = await pathOnly.text();
    expect(pathOnly.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain(PAIR);
    expect(pathOnly.headers.get("Cache-Control")).toBe("max-age=60");

    const query = await get(`${PAIR}.data?${ROUTES}&interval=1h`);
    expect(query.status).toBe(202);
    expect(await query.text()).toContain("SingleFetchRedirect");
    expect(query.headers.get("Cache-Control")).toBe("max-age=0");
    expect(mock.requests).toEqual([]);

    // The Cache API keeps no 202, so the class is read from the loader's own answer to those requests.
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const own = async (path: string, url: string) =>
      (await loader({
        request: new Request(`https://explorer.test${path}`),
        url: new URL(`https://explorer.test${url}`),
        params: { net: "xrpl" },
        context: createLoadContext(env as unknown as Env, ctx),
      } as never)) as Response;
    const immutable = await own(`/xrpl/markets/xrp/RLUSD.${RLUSD_ISSUER}.data?${ROUTES}`, `/xrpl/markets/xrp/RLUSD.${RLUSD_ISSUER}`);
    expect([immutable.status, immutable.headers.get("Location"), immutable.headers.get("X-Cache-Class")]).toEqual([302, PAIR, "immutable"]);
    const short = await own(`${PAIR}.data?${ROUTES}&interval=1h`, `${PAIR}?interval=1h`);
    expect([short.status, short.headers.get("Location"), short.headers.get("X-Cache-Class")]).toEqual([302, PAIR, "short"]);
    expect(mock.requests).toEqual([]);
  });
});

// ---- The calls of each view, and how long each is kept -------------------------------------------------------------------------------------

describe("the calls of a view", () => {
  it("are spec 3.3's on a first render of XRP/RLUSD, each kept as long as the table says; the inverted pair finds the book and the pool where it kept them", async () => {
    mock = mockUpstream("xrpl");
    const watched = watchSubrequests();
    const natural = await render(PAIR);
    const [asked, looked] = [mock.requests.length, watched.lookups()];
    // The inverted pair at once, while the natural page's entries of 2 s are surely there.
    const inverted = await render(INVERTED);
    for (const { response, text } of [natural, inverted]) {
      expect(response.status).toBe(200);
      expect(text).not.toContain("Couldn’t load");
    }

    // Every call of the view reached the API, but #1, which an earlier render of the file may have kept (it is every XRPL page's key; how long
    // it is kept is pinned where it is first asked for, in the test of failing trades).
    const pair = `XRP/${R}`;
    expect(callsOf(mock.requests.slice(0, asked)).filter((call) => call !== LAST_VALIDATED).sort()).toEqual(
      [
        tradesKey(pair),
        reduceKey(pair, T1.xrpl),
        candlesKey(pair, "1h", START.xrpl["1h"]),
        accountsKey(pair),
        bookKey("XRP", R),
        bookKey(R, "XRP"),
        poolKey("XRP", R),
        reduceKey(pair, T1.xrpl, "only"),
      ].sort(),
    );
    expect(mock.requests.every((request) => request.source === "fixture")).toBe(true);
    const keys = viewKeys("xrpl", ["XRP", R], { amm: true, natural: ["XRP", R] });
    expect((await watched.lookedUp(keys, 0, looked)).sort()).toEqual([...keys].sort());

    // The inverted page looked up its own index calls and the node's entries the natural page had stored (its asks are the natural page's
    // bids, its pool the same pair's), and asked the node nothing.
    const invertedPair = `${R}/XRP`;
    const invertedKeys = viewKeys("xrpl", [R, "XRP"], { amm: true, natural: ["XRP", R] });
    const invertedLooked = await watched.lookedUp(invertedKeys, looked);
    expect([...invertedLooked].sort()).toEqual([...invertedKeys].sort());
    expect(invertedLooked.filter((key) => key.startsWith("POST ")).sort()).toEqual(keys.filter((key) => key.startsWith("POST ")).sort());
    expect(callsOf(mock.requests.slice(asked)).filter((call) => call.startsWith("node "))).toEqual([]);
    expect(callsOf(mock.requests.slice(asked)).filter((call) => call !== LAST_VALIDATED).sort()).toEqual(
      [
        tradesKey(invertedPair),
        reduceKey(invertedPair, T1.xrpl),
        candlesKey(invertedPair, "1h", START.xrpl["1h"]),
        accountsKey(invertedPair),
        reduceKey(invertedPair, T1.xrpl, "only"),
      ].sort(),
    );

    // #1 is looked up under the home page's key (`[kept 2 s]`, above); #2 under a key of its own, kept 2 s, and so are the two sides of the book;
    // #3, #4 (1 h), #8 and #9 at their class, live, 5 s; #5 at minute's 60 s.
    const [, trades, stats, candles, traders, asks, bids, pool, share] = keys as [string, string, string, string, string, string, string, string, string];
    for (const key of [trades, asks, bids]) expect(await watched.keptFor(key), key).toBe("public, max-age=2");
    for (const key of [stats, candles, pool, share]) expect(await watched.keptFor(key), key).toBe("public, max-age=5");
    expect(await watched.keptFor(traders)).toBe("public, max-age=60");
  });

  it.each([
    ["15m", "public, max-age=5"],
    ["4h", "public, max-age=60"],
    ["1d", "public, max-age=60"],
    ["1w", "public, max-age=60"],
  ] as const)("asks for the %s candles from S with limit=61, kept %s", async (interval, kept) => {
    mock = mockUpstream("xrpl");
    const watched = watchSubrequests();
    const path = `${PAIR}?interval=${interval}`;
    const { response, html } = await render(path);
    expect(response.status).toBe(200);
    expect(html).toContain('class="candle"');

    const keys = viewKeys("xrpl", ["XRP", R], { interval, amm: true, natural: ["XRP", R] });
    expect((await watched.lookedUp(keys)).sort()).toEqual([...keys].sort());
    expect(await watched.keptFor(keys[3]!)).toBe(kept);
    expect(statusesOf(mock, candlesKey(`XRP/${R}`, interval, START.xrpl[interval]))).toEqual([200]);
  });

  it.each([
    ["book", "?trades=book"],
    ["amm", "?trades=amm"],
  ] as const)("sends the Trades filter %s with #2, #3 and #4, and asks #9 for the other trades", async (trades, query) => {
    mock = mockUpstream("xrpl");
    const watched = watchSubrequests();
    const { response, text } = await render(`${PAIR}${query}`);
    expect(response.status).toBe(200);
    expect(text).not.toContain("Couldn’t load");

    const keys = viewKeys("xrpl", ["XRP", R], { trades, amm: true, natural: ["XRP", R] });
    expect((await watched.lookedUp(keys)).sort()).toEqual([...keys].sort());
    // No unfiltered call but the traders' (which has no filter), and no #10: the list has trades.
    expect(keys.filter((key) => key.includes("/v2/exchanges/") && !key.includes("amm="))).toEqual([]);
    expect(callsOf(mock.requests)).not.toContain(probeKey(`XRP/${R}`));
  });

  it("makes no #8 or #9 on Xahau: the network has no pools", async () => {
    mock = mockUpstream("xahau");
    const watched = watchSubrequests();
    const path = `${EVR}?interval=15m`;
    const { response, html, text } = await render(path);
    expect(response.status).toBe(200);
    expect(text).not.toContain("Couldn’t load");

    const keys = viewKeys("xahau", [E, "XAH"], { interval: "15m", amm: false });
    expect(keys).toHaveLength(7);
    expect((await watched.lookedUp(keys)).sort()).toEqual([...keys].sort());
    expect(callsOf(mock.requests).some((call) => call.startsWith("node amm_info") || call.includes("amm="))).toBe(false);
    expect(html).not.toContain("AMM pool");
    expect(html).not.toContain(">Via<");
  });
});

// ---- The class --------------------------------------------------------------------------------------------------------------------------

describe("the class of the page", () => {
  const ROUTES = "_routes=routes%2Fnet.markets.%24base.%24counter";

  it("stores the live page and its .data URL as live-home, kept 1 s, and the .data URL of a canonical view answers its data, not a 404 or a 302", async () => {
    mock = mockUpstream("xrpl");
    const { response } = await render(PAIR);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(PAIR)).toEqual({ cls: "live-home", ttl: 1 });

    // The route's own request of an open page: React Router adds `_routes`, which is no part of the view, wherever it stands.
    for (const path of [`${PAIR}.data?${ROUTES}`, `${PAIR}.data?interval=4h&${ROUTES}`, `${PAIR}.data?${ROUTES}&interval=4h`]) {
      const data = await get(path);
      const body = await data.text();
      expect(data.status, path).toBe(200);
      expect(data.headers.get("Content-Type")).toContain("text/x-script");
      expect(data.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
      expect(await storedAs(path)).toEqual({ cls: "live-home", ttl: 1 });
      // The build, and the ledger the page stands at.
      expect(body).toContain("test-build");
      expect(body).toContain("107721455");
    }
  });

  it("stores a page behind a marker as MARKER_PAGE_CLASS (slow): old trades, a note to the market's page, no live row, no node call", async () => {
    mock = mockUpstream("xrpl");
    const marker = "WzEwNzY3MTU5MSwxNCwxXQ";
    const path = `${PAIR}?marker=${marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    expect(textOf(elementText(html, "pair__older")!)).toBe("Older trades of XRP/RLUSD. The price, chart and order book are on the market's page.");
    expect(text).not.toContain("Live · updates every ledger");
    expect(html).not.toContain('aria-label="Order book"');
    expect(html).not.toContain('class="candle"');
    // One call: the page of trades behind the marker.
    expect(callsOf(mock.requests)).toEqual([tradesKey(`XRP/${R}`, undefined, marker)]);
    // Newer is the first page: no marker at all.
    expect(anchors(html).find((a) => a.text === "Newer")?.attrs).toContain(`href="${PAIR}"`);
    expect(tableRows(html, "Recent trades").length).toBeGreaterThan(1);
  });

  it.each([
    ["the API refuses the marker", "AAAAAAAA", dataApiError(400, "invalid marker")],
    ["there is nothing behind it", "BBBBBBBB", NO_TRADES],
  ])("is a 404 of class short behind a marker when %s", async (_what, marker, answer) => {
    mock = mockUpstream("xrpl", { [tradesKey(`${L}/XRP`, undefined, marker)]: answer });
    const path = `${LIONS}?marker=${marker}`;
    const { response, html, text } = await render(path);
    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find that page of the market’s trades on XRPL.");
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});

// ---- The AMM parts and their switch ------------------------------------------------------------------------------------------------------

describe("the AMM parts", () => {
  it("are there on XRPL with AMM_DATA on: the Via column, the Trades filter, the pool with its share, and the traders without the pool", async () => {
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render(PAIR);
    expect(response.status).toBe(200);

    const rows = tableRows(html, "Recent trades");
    expect(rows[0]).toContain("Via");
    expect(rows.slice(1).filter((row) => row.at(-1) === "AMM")).toHaveLength(4);
    expect(rows.slice(1).filter((row) => row.at(-1) === "Book")).toHaveLength(16);
    const filter = anchors(html).filter((a) => /trades=(book|amm)/.test(a.attrs) || a.text === "All");
    expect(filter.map((a) => a.text)).toEqual(expect.arrayContaining(["All", "Order book", "AMM"]));
    expect(text).toContain("Applies to the chart, the 24 h figures and the trade list.");
    // #9 over #3 with no filter: 418.293119 of 430.097276 XRP.
    expect(text).toContain("Share of pair volume, 24 h 97%");
    expect(text).toContain("XRP/RLUSD AMM pool");
    expect(text).toContain("Trading fee 0.205%");
    // The pool is the other side of every swap: left out of the traders, and the note says so.
    const traders = html.slice(html.indexOf("Most active traders, 24 h"));
    expect(anchors(traders).some((a) => a.attrs.includes(`/xrpl/account/${POOL}"`) && a.text !== "Pool account →")).toBe(false);
    expect(text).toContain("The XRP/RLUSD AMM pool, the other side of every swap, is left out.");
  });

  describe("with AMM_DATA off (the route's loader, with a load context of its own)", () => {
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const run = (path: string) =>
      loader({
        request: new Request(`https://explorer.test${path}`),
        url: new URL(`https://explorer.test${path}`),
        params: { net: "xrpl" },
        context: createLoadContext({ ...(env as unknown as Env), AMM_DATA: "off" }, ctx),
      } as never);

    it("has no Via, no Trades filter and no share, and makes no #9 call; the pool card stays", async () => {
      mock = mockUpstream("xrpl");
      const watched = watchSubrequests();
      const result = (await run(PAIR)) as Cached<LivePairData>;
      const page = result.data;

      expect(page.mode).toBe("live");
      expect(page.ammParts).toBe(false);
      expect(page.filters.trades).toBeNull();
      expect(page.trades.rows.length).toBe(20);
      expect(page.trades.rows.every((row) => row.via === null)).toBe(true);
      expect(page.share).toEqual({ state: "off" });
      expect(page.pool.state).toBe("ok");
      expect(new Headers(result.init?.headers).get("X-Cache-Class")).toBe("live-home");

      const keys = viewKeys("xrpl", ["XRP", R], { amm: false, natural: ["XRP", R] });
      expect((await watched.lookedUp(keys)).sort()).toEqual([...keys].sort());
      expect(callsOf(mock.requests).some((call) => call.includes("amm="))).toBe(false);
    });

    it("redirects ?trades=amm away, class short, before any call: the filter is not a parameter there", async () => {
      mock = mockUpstream("xrpl");
      const response = (await run(`${PAIR}?trades=amm&interval=4h`)) as Response;

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`${PAIR}?interval=4h`);
      expect(response.headers.get("X-Cache-Class")).toBe("short");
      expect(mock.requests).toEqual([]);
    });
  });
});

// ---- The page without JavaScript ---------------------------------------------------------------------------------------------------------

describe("the page without JavaScript", () => {
  it("holds the candles, the volume columns, both views of the chart, the book, the trades and their pager, in the HTML", async () => {
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render(PAIR);
    expect(response.status).toBe(200);

    // The 8 hours of the 60 that have trades, each a candle over its volume column; the other 52 are gaps.
    expect((html.match(/class="candle"/g) ?? []).length).toBe(8);
    expect((html.match(/class="col__bar col__bar--volume"/g) ?? []).length).toBe(8);
    // The chart and its table, and the radios that swap them without a script.
    expect((html.match(/class="chart__table"/g) ?? []).length).toBe(1);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
    // The book: levels on both sides, the middle row with the last price and the spread, and the ledger it was read at.
    const levels = (html.match(/class="pair__book-row pair__level"/g) ?? []).length;
    expect(levels).toBeGreaterThan(2);
    expect(levels).toBeLessThanOrEqual(20);
    expect(text).toMatch(/live from the node · book_offers · ledger #\s?107,780,245/);
    expect(text).toContain("spread");
    // The trades, newest first, and Older to the next page.
    const rows = tableRows(html, "Recent trades");
    expect(rows).toHaveLength(21);
    expect(rows[1]![0]).toMatch(/^2026-10-17 17:01:12/);
    expect(hrefs(html)).toContain(`${PAIR}?marker=WzEwNzY3MTU5MSwxNCwxXQ`);
    // The price and the change from the 24 h open (1.2890268 ÷ 1.3033792 − 1).
    expect(elementText(html, "pair__figure")).toBe("1.2890268");
    expect(text).toContain("−1.10%");
    expect(text).toContain("Live · updates every ledger");
  });
});

// ---- The tags --------------------------------------------------------------------------------------------------------------------------

describe("the tags of the page", () => {
  const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
  const robotsOf = (html: string) => /<meta name="robots" content="([^"]*)"/.exec(html)?.[1];

  it("is indexable on the natural default view with a trade: a canonical URL and sharing tags, and no image", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await render(PAIR);
    expect(titleOf(html)).toBe("XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · explorer");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${PAIR}"`);
    expect(html).toContain(`<meta property="og:url" content="https://explorer.test${PAIR}"`);
    expect(html).not.toContain("og:image");
    expect(robotsOf(html)).toBeUndefined();
  });

  it.each([
    ["the inverted pair", INVERTED],
    ["a filtered view", `${PAIR}?trades=book`],
    ["another interval", `${PAIR}?interval=1d`],
    ["a page behind a marker", `${PAIR}?marker=WzEwNzY3MTU5MSwxNCwxXQ`],
  ])("is noindex, follow for %s, without a canonical URL or sharing tags", async (_what, path) => {
    mock = mockUpstream("xrpl");
    const { html } = await render(path);
    expect(robotsOf(html)).toBe("noindex, follow");
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("og:title");
    expect(html).not.toContain("twitter:card");
  });

  it("is noindex, follow for a pair with offers and no trade yet, in its natural orientation", async () => {
    const offer = {
      Account: "rKYdJJLAgxbJcn9Ria2X5jMMiqP91r4qy",
      Sequence: 7,
      TakerGets: "100000000",
      TakerPays: { currency: "JPY", issuer: USD_ISSUER, value: "36000" },
    };
    mock = mockUpstream("xrpl", {
      [tradesKey(`XRP/${JPY}`)]: NO_TRADES,
      [bookKey("XRP", JPY)]: { ...EMPTY_BOOK, offers: [offer] },
      [bookKey(JPY, "XRP")]: EMPTY_BOOK,
    });
    const path = `/xrpl/markets/XRP/JPY.${USD_ISSUER}`;
    const { response, html, text } = await render(path);

    // It exists (an offer), and has no trade; its other calls have no fixture, so the page is degraded.
    await expectDegraded(path, response);
    expect(text).toContain("No trades yet");
    expect(robotsOf(html)).toBe("noindex, follow");
    expect(html).not.toContain('rel="canonical"');
  });
});

// ---- A last_validated that the windows cannot be worked out from ----------------------------------------------------------------------------
// Last, because the answer cannot have a key of its own: `last_validated` is one key for every page of a network, a malformed 200 is kept like
// any other for 2 s, and the tests above kept good ones. So the block waits for what is kept to expire, and each of its tests is on another
// network. The views are ones no test above has a stored page of: a failed render is answered with the stored copy of its page, if there is one.

describe("a last_validated that the windows cannot be worked out from", () => {
  beforeAll(() => sleep(2_100));

  it.each([
    ["xahau", "a close time that is not a time", { close_time: "yesterday" }, xahauLastValidated, `${EVR}?interval=4h`, `${E}/XAH`],
    ["xrpl", "a ledger index that is not a number", { ledger_index: "latest" }, xrplLastValidated, `${LIONS}?interval=1w`, `${L}/XRP`],
  ] as const)("answers 503, and not 500, on %s when last_validated has %s, and the chains ask nothing", async (net, _what, broken, recorded, path, pair) => {
    mock = mockUpstream(net, { [LAST_VALIDATED]: { ...recorded, ...broken } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(errors.mock.calls.some(([line]) => String(line).includes("the market pair page has no anchor"))).toBe(true);
    // No window follows from it: neither chain asked for the 24 h figures or the candles.
    expect(callsOf(mock.requests).filter((call) => call.startsWith(`GET /v2/exchanges/${pair}?`) && /reduce=|interval=/.test(call))).toEqual([]);
  });
});
