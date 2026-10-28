import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loader as collectionLoader } from "../../app/routes/net.nfts.$issuer.$taxon";
import { createLoadContext, type Env } from "../../app/server/env";
import { collectionCase, salesMarker } from "../support/nft-cases";
import { alerts, expectDegraded, isNoindex, isStored, keysOf, linksTo, tiles, unavailable } from "../support/nft-pages";
import { nftSample } from "../support/nft-samples";
import { elementText, hrefs, pageClient, tableRows, textOf } from "../support/pages";
import { cold, keptFor, storedEntries } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// A collection's page, `/{net}/nfts/{issuer}[/{taxon}]` (NFT spec 1.3, 3 and 9), on the real Worker against the generated NFT answers of the data API
// (test/fixtures/http/*/data-api/nft_collections/…): what a failed call does to the page, the 404 of a collection the index does not have and the 503 of an index that failed, the
// class each answer is stored under, the calls of a view and how long each is kept, the owner form, a page behind a marker, Xahau's words, and the redirects and 404s of the URL's own
// parts. The off-case of `NFTS` is nfts-off.spec.ts (the `worker-off` project).
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included, and an error or a degraded page is never stored. So the tests
// that fail a call come first, each on a view that no later test reads (`measure` and `tab` tell the views apart), and every test takes the subrequest entries away (`cold`,
// test/support/subrequest-miss.ts): each call of a render reaches the mock, so an override is always the answer and a list of calls does not depend on the order of the tests. The
// pages do not poll, so no call asks for the failure hold; `Date` alone is faked all the same and moved 301 s on after each test, past the longest keep (the edge cache's freshness
// reads `Date`), so that no test reads what an earlier one left. The afterEach below fails a test whose override no request used.

const { get, stored, storedAs } = pageClient("198.18.61");

// A test here may ask several times whether the edge cache holds a copy it must not hold (`isStored` waits up to 2 s for each: a store runs behind the answer, so "not stored" means it
// only after that wait), which is more than Vitest's 5 s for a test that does it three times.
vi.setConfig({ testTimeout: 30_000 });

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

/** The page at `path`: its status, headers and HTML. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

// ---- The collections of the fixtures and the calls, by the keys the mock names them (its query sorted by name) -----------------------------------------------------------

const FEATURED = await collectionCase("xrpl", "featured");
const QUIET = await collectionCase("xrpl", "quiet");
const URI_FEATURED = await collectionCase("xahau", "featured");
/** A Xahau collection with a day on which its only sale had no price in the native currency (the featured ones have none). */
const URI_UNRATED = await collectionCase("xahau", "other");
const I = FEATURED.issuer;
const T = FEATURED.taxon;
const KEY = `${I}/${T}`;
const PATH = `/xrpl/nfts/${KEY}`;
const URI_I = URI_FEATURED.issuer;
const URI_PATH = `/xahau/nfts/${URI_I}`;
const OWNER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

const LAST_VALIDATED = "GET /v2/last_validated";
const calls = (key: string) => ({
  COLLECTION: `GET /v2/nft_collections/${key}`,
  /** The 30 days up to the recorded ledger's day (Oct 17, 2026). */
  STATS: `GET /v2/nft_collections/${key}/stats?end=2026-10-17&start=2026-09-18`,
  SALES: `GET /v2/nft_collections/${key}/sales?descending=true&limit=20`,
  NFTS: `GET /v2/nft_collections/${key}/nfts?limit=20`,
  HOLDERS: `GET /v2/nft_collections/${key}/holders?limit=20`,
});
const { COLLECTION, STATS, SALES, NFTS, HOLDERS } = calls(KEY);
/** What the first page of the default view asks for, sorted. */
const FIRST_PAGE = [COLLECTION, LAST_VALIDATED, STATS, SALES].sort();

/** The subrequest keys of #1 and #3, as the client writes them (data-api.ts: the URL, then the TTL the caller asked for). */
const API_BASE = "https://xrpl.data.example.invalid";
const LAST_VALIDATED_ENTRY = `GET ${API_BASE}/v2/last_validated [kept 2 s]`;
const STATS_ENTRY = `GET ${API_BASE}/v2/nft_collections/${KEY}/stats?start=2026-09-18&end=2026-10-17 [kept 300 s]`;

/** What an API without D3 answers a collection's routes with: the framework's "Cannot GET" 404 (the fixture server answers `collection not found` to a collection it has no file for, so `null` is not it). */
const cannotGet = (key: string) => dataApiError(404, `Cannot GET ${key.replace(/^GET /, "").split("?")[0]}`);

const SHORT = { cls: "short", ttl: 30 };
const MINUTE = { cls: "minute", ttl: 60 };
const MARKER_PAGE = { cls: "slow", ttl: 3600 };
const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };

/** The links with this text that go to the collection's own page (the header's and the breadcrumb's "NFTs" go to the list). */
const ownLinks = (html: string, text: string, base = PATH) => linksTo(html, text).filter((href) => href?.startsWith(base));

/** The rows of a table of the page. */
const rowsOf = (html: string, label: string) => tableRows(html, label);

/** The title of the page: the first `<title>`. */
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

// ---- Failures first, each on a view no later test reads ----------------------------------------------------------------------------------------------------------

describe("a call that fails (spec 3.2)", () => {
  /** One render of `path` with these overrides, every call reaching the mock (the test has made the subrequest cache `cold`); the overrides must all be used. */
  async function failing(path: string, overrides: Record<string, unknown>, net: "xrpl" | "xahau" = "xrpl") {
    mock = mockUpstream(net, overrides);
    const page = await render(path);
    await expectDegraded(path, page.response);
    expect(mock.unusedOverrides()).toEqual([]);
    return { ...page, mock };
  }

  it("stats failing fails the chart and the 30-day stats only", async () => {
    cold();
    const path = `${PATH}?measure=sales`;
    const page = await failing(path, { [STATS]: unavailable() });

    expect(statusesOf(page.mock, STATS)).toEqual([503]);
    // The six stats: the four of the collection are there, the two 30-day ones are dashes.
    const stats = tiles(page.html);
    expect(stats.map((tile) => tile.label)).toEqual(["Supply", "Holders", "Sales", "Volume", "Average sale, 30 days", "Lowest sale, 30 days"]);
    expect(stats.slice(0, 4).map((tile) => tile.value)).toEqual(["14", "4", "21", expect.stringMatching(/ XRP$/)]);
    expect(stats.slice(4).map((tile) => tile.value)).toEqual(["—", "—"]);
    expect(page.text).toContain("Couldn’t load the daily figures.");
    expect(alerts(page.html)).toBe(1);
    // The chart is told in its place, titled for the measure, with the measure links; no column.
    expect(page.text).toContain("Sales per day, last 30 days");
    expect(page.text).toContain(`/v2/nft_collections/${KEY}/stats`);
    expect((page.html.match(/class="col"/g) ?? []).length).toBe(0);
    expect(linksTo(page.html, "Average price")).toEqual([`${PATH}?measure=avg`]);
    // The tab is drawn: the sales, and the tabs.
    expect(rowsOf(page.html, "Sales")).toHaveLength(21);
    expect(ownLinks(page.html, "Holders")).toEqual([`${PATH}?measure=sales&tab=holders`]);
  });

  it("a tab failing is told in its place; the tabs stay links", async () => {
    cold();
    // The Sales tab.
    let path = `${PATH}?measure=avg`;
    let page = await failing(path, { [SALES]: unavailable() });
    expect(statusesOf(page.mock, SALES)).toEqual([503]);
    expect(page.text).toContain("Couldn’t load the sales.");
    expect(alerts(page.html)).toBe(1);
    expect(rowsOf(page.html, "Sales")).toEqual([]);
    expect(ownLinks(page.html, "NFTs")).toEqual([`${PATH}?measure=avg&tab=nfts`]);
    expect(ownLinks(page.html, "Holders")).toEqual([`${PATH}?measure=avg&tab=holders`]);
    // The rest is drawn: the stats and the chart's 30 columns.
    expect(tiles(page.html).map((tile) => tile.value)).not.toContain("—");
    expect((page.html.match(/class="col"/g) ?? []).length).toBe(30);
    page.mock.restore();

    // The NFTs tab.
    path = `${PATH}?measure=avg&tab=nfts`;
    page = await failing(path, { [NFTS]: unavailable() });
    expect(page.text).toContain("Couldn’t load the NFTs.");
    expect(alerts(page.html)).toBe(1);
    // The owner form stays, so that the filter can be changed.
    expect(page.html).toContain('name="owner"');
    page.mock.restore();

    // The Holders tab.
    path = `${PATH}?measure=avg&tab=holders`;
    page = await failing(path, { [HOLDERS]: unavailable() });
    expect(page.text).toContain("Couldn’t load the holders.");
    expect(alerts(page.html)).toBe(1);
    expect(ownLinks(page.html, "Sales")).toEqual([`${PATH}?measure=sales&tab=holders`, `${PATH}?measure=avg`]);
  });

  it("logs each failure under its card's name, once, with the error itself", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await failing(`${PATH}?measure=low`, { [STATS]: unavailable(), [SALES]: unavailable() });
    const lines = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT collection"));
    expect(lines).toHaveLength(2);
    expect(lines.filter((line) => line.includes("the NFT collection's daily figures could not be loaded") && line.includes("answered 503"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("the NFT collection's sales could not be loaded") && line.includes("answered 503"))).toHaveLength(1);
  });

  it("an API without D3 (Cannot GET) is a failed card, never a stored 404", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // The framework's "Cannot GET" 404, which the client reads as an outage, not as a collection that is not there.
    const path = `${PATH}?measure=low&tab=holders`;
    const { html, text, mock: used } = await failing(path, { [STATS]: cannotGet(STATS), [HOLDERS]: cannotGet(HOLDERS) });

    expect(statusesOf(used, STATS)).toEqual([404]);
    expect(tiles(html).slice(4).map((tile) => tile.value)).toEqual(["—", "—"]);
    expect(text).toContain("Couldn’t load the daily figures.");
    expect(text).toContain("Couldn’t load the holders.");
    expect(alerts(html)).toBe(2);
    // Nothing of the error is in the page, whose data goes to the browser as well.
    expect(html).not.toContain("Cannot GET");
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("answered 404: Cannot GET /v2/nft_collections/"))).toHaveLength(2);
  });

  it("logs a last_validated that gives no anchor as the daily figures' failure, and does not ask for the 30 days", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { result: "success", ledger_index: "abc", ledger_hash: "AB".repeat(32), parent_hash: "CD".repeat(32), close_time: "not a time" };
    const { html, text, mock: used } = await failing(`${PATH}?measure=sales&tab=holders`, { [LAST_VALIDATED]: bad });

    expect(keysOf(used.requests)).not.toContain(STATS);
    expect(text).toContain("Couldn’t load the daily figures.");
    expect(alerts(html)).toBe(1);
    expect((html.match(/class="col"/g) ?? []).length).toBe(0);
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT collection's daily figures could not be loaded"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("answered a ledger_index or close_time that is not a number");
  });

  it("the newest ledger failing fails the same cards, and the 30 days are not asked for", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { html, text, mock: used } = await failing(`${PATH}?measure=low&tab=nfts`, { [LAST_VALIDATED]: unavailable() });
    expect(statusesOf(used, LAST_VALIDATED)).toEqual([503]);
    expect(keysOf(used.requests)).not.toContain(STATS);
    expect(text).toContain("Couldn’t load the daily figures.");
    expect(alerts(html)).toBe(1);
    const logged = errors.mock.calls.map(([line]) => String(line));
    expect(logged.filter((line) => line.includes("the NFT collection's newest ledger could not be loaded"))).toHaveLength(1);
    // The 30 days were not asked for, so their failure is not logged a second time.
    expect(logged.filter((line) => line.includes("the NFT collection's daily figures"))).toEqual([]);
  });
});

describe("a card that has not answered (spec 3.2)", () => {
  it("gives up on the sales 4.5 s after the loader began, logs that it took too long, and answers 200 all the same, not stored", async () => {
    cold();
    mock = mockUpstream("xrpl", { [SALES]: () => new Promise<Response>(() => {}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `${PATH}?measure=low`;
    const started = performance.now();
    const { response, html, text } = await render(path);
    const took = performance.now() - started;

    await expectDegraded(path, response);
    // The card's deadline; the data API client would have given up at 5 s.
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(text).toContain("Couldn’t load the sales.");
    expect(rowsOf(html, "Sales")).toEqual([]);
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT collection's sales took too long"))).toHaveLength(1);
  }, 15_000);
});

describe("the collection that has not answered (spec 3.2)", () => {
  it("is a 503 with Retry-After, never stored, 4.5 s after the loader began: the page is the collection's, and has nothing to show without it", async () => {
    cold();
    mock = mockUpstream("xrpl", { [COLLECTION]: () => new Promise<Response>(() => {}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `${PATH}?measure=avg&tab=holders`;
    const started = performance.now();
    const { response } = await render(path);
    const took = performance.now() - started;

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(await isStored(path)).toBe(false);
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT collection's collection took too long"))).toHaveLength(1);
  }, 15_000);
});

// ---- The collection the page is about: a 404 that names it, a 503 that is not stored ---------------------------------------------------------------------------

describe("the collection (call #1)", () => {
  it("collection not found is a 404 that names the collection; a 5xx on #1 is a 503 not stored", async () => {
    cold();
    // The index has no such collection (the fixtures have no file for it): the 404 of class short names it, as `collectionNotFound` words it, on the network's name.
    mock = mockUpstream("xrpl");
    const absent = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
    let path = `/xrpl/nfts/${absent}/5`;
    let page = await render(path);
    expect(page.response.status).toBe(404);
    expect(page.text).toContain("We couldn’t find NFT collection rPzx7u…U9SC · taxon 5 on XRPL.");
    expect(page.text).toContain("Not found");
    expect(await storedAs(path)).toEqual(SHORT);
    expect(statusesOf(mock, `GET /v2/nft_collections/${absent}/5`)).toEqual([404]);
    mock.restore();

    // Xahau's words.
    mock = mockUpstream("xahau");
    path = `/xahau/nfts/${absent}`;
    page = await render(path);
    expect(page.response.status).toBe(404);
    expect(page.text).toContain("We couldn’t find URIToken collection rPzx7u…U9SC on Xahau.");
    expect(await storedAs(path)).toEqual(SHORT);
    mock.restore();

    // A 5xx on #1 is a 503 with Retry-After, and nothing is stored (not the 404 either).
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [COLLECTION]: unavailable() });
    path = `${PATH}?measure=sales&tab=nfts`;
    page = await render(path);
    expect(page.response.status).toBe(503);
    expect(page.response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, COLLECTION)).toEqual([503]);
    expect(await isStored(path)).toBe(false);
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT collection's collection could not be loaded"))).toHaveLength(1);
    mock.restore();

    // An API without D3 ("Cannot GET") is an outage too, never a stored 404.
    mock = mockUpstream("xrpl", { [COLLECTION]: cannotGet(COLLECTION) });
    path = `${PATH}?measure=sales&tab=holders`;
    page = await render(path);
    expect(page.response.status).toBe(503);
    expect(statusesOf(mock, COLLECTION)).toEqual([404]);
    expect(await isStored(path)).toBe(false);
  });
});

// ---- The URL's own parts: redirects and 404s, before any call -------------------------------------------------------------------------------------------------

describe("the URL (spec 1.2, 1.3)", () => {
  it.each([
    [`/xrpl/nfts/${I}/01`, `/xrpl/nfts/${I}/1`, "immutable"],
    [`/xrpl/nfts/${I}`, `/xrpl/nfts?issuer=${I}`, "short"],
    [`/xahau/nfts/${I}/1`, `/xahau/nfts/${I}`, "short"],
  ])("redirects %s to %s (%s)", async (from, to, cls) => {
    mock = mockUpstream(from.startsWith("/xahau") ? "xahau" : "xrpl");
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(to);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(cls === "immutable" ? IMMUTABLE : SHORT);
  });

  it.each([
    [`/xrpl/nfts/${I}/0?tab=nfts&x=1&burned=1`, `/xrpl/nfts/${I}/0?tab=nfts&burned=1`, "short"],
    [`/xrpl/nfts/${I}/0?tab=sales&owner=${OWNER}&burned=1&measure=volume`, `/xrpl/nfts/${I}/0`, "short"],
    [`/xrpl/nfts/${I}/0?tab=nfts&owner=%20${OWNER}%20&measure=avg`, `/xrpl/nfts/${I}/0?measure=avg&tab=nfts&owner=${OWNER}`, "short"],
    [`/xrpl/nfts/${I}/0?tab=nfts&owner=&burned=0`, `/xrpl/nfts/${I}/0?tab=nfts`, "short"],
    [`/xrpl/nfts/${I}/0?measure=week&tab=staking`, `/xrpl/nfts/${I}/0`, "short"],
    [`/xrpl/nfts/${I}/0?measure=avg&measure=low`, `/xrpl/nfts/${I}/0?measure=avg`, "short"],
    // A page behind a marker has no measure.
    [`/xrpl/nfts/${I}/0?measure=low&marker=AAAA`, `/xrpl/nfts/${I}/0?marker=AAAA`, "short"],
    [`/xrpl/nfts/${I}/0?back=BBBB&marker=AAAA&tab=holders`, `/xrpl/nfts/${I}/0?tab=holders&marker=AAAA&back=BBBB`, "short"],
    [`/xrpl/nfts/${I}/0?back=M1`, `/xrpl/nfts/${I}/0`, "short"],
    // The path in another case, and a leading-zero taxon with its query: the query is kept and the answer is for the path alone.
    [`/xrpl/NFTs/${I}/0`, `/xrpl/nfts/${I}/0`, "immutable"],
    [`/xrpl/nfts/${I}/00?tab=holders`, `/xrpl/nfts/${I}/0?tab=holders`, "immutable"],
    // Xahau with a taxon: the same view of the issuer's collection.
    [`/xahau/nfts/${I}/1?tab=holders&x=1`, `/xahau/nfts/${I}?tab=holders`, "short"],
  ])("redirects %s to %s (%s) with no call", async (from, to, cls) => {
    mock = mockUpstream(from.startsWith("/xahau") ? "xahau" : "xrpl");
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(to);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(cls === "immutable" ? IMMUTABLE : SHORT);
  });

  it.each(["/xrpl/nfts/rBad/1", `/xrpl/nfts/${I}/4294967296`, `/xrpl/nfts/${I}/x`, `/xrpl/nfts/${I}/-1`, `/xrpl/nfts/${I}/1.0`, "/xahau/nfts/rBad", `/xahau/nfts/${I}/x`])(
    "%s is a 404 without a call",
    async (path) => {
      mock = mockUpstream(path.startsWith("/xahau") ? "xahau" : "xrpl");
      const { response, text } = await render(path);

      expect(response.status).toBe(404);
      expect(text).toMatch(/We couldn’t find (NFT|URIToken) collection ".*" on (XRPL|Xahau)\./);
      expect(mock.requests).toEqual([]);
      expect(await storedAs(path)).toEqual(SHORT);
    },
  );

  it("is a 404 of class short, before any call and before any redirect, for a marker that is not one", async () => {
    mock = mockUpstream("xrpl");
    for (const path of [`${PATH}?marker=%25`, `${PATH}?back=AAAA&marker=%25&x=1`, `/xrpl/nfts/${I}/01?marker=%25`, `/xrpl/nfts/${I}?marker=%25`]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text, path).toContain("that page of NFT collection");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 of class short, and no call, for a marker of a view whose owner is no address", async () => {
    mock = mockUpstream("xrpl");
    for (const path of [`${PATH}?tab=nfts&owner=nope&marker=AAAA`, `${PATH}?marker=AAAA&owner=rNopeNopeNope&tab=nfts&burned=1`]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of NFT collection");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("answers its .data URL with the page's data and not a redirect: React Router's _routes is no part of the view", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response } = await render(`${PATH}.data?_routes=routes%2Fnet.nfts.%24issuer.%24taxon`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/x-script");
    expect([...keysOf(mock.requests)].sort()).toEqual(FIRST_PAGE);
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    const path = `${PATH}.data?_routes=routes%2Fnet.nfts.%24issuer.%24taxon&measure=volume`;
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain(PATH);
    expect(mock.requests).toEqual([]);
    expect(tidied.headers.get("Cache-Control")).toBe("max-age=0");
    // The Cache API keeps no 202; the loader's own answer to that request names the class.
    expect(await stored(path)).toBeUndefined();
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const own = (await collectionLoader({
      request: new Request(`https://explorer.test${path}`),
      url: new URL(`https://explorer.test${path.replace(".data", "")}`),
      params: { net: "xrpl", issuer: I, taxon: String(T) },
      context: createLoadContext(env as unknown as Env, ctx),
    } as never)) as Response;
    expect(own.status).toBe(302);
    expect(own.headers.get("Location")).toBe(PATH);
    expect(own.headers.get("X-Cache-Class")).toBe("short");
  });
});

// ---- The class, the calls and the page -------------------------------------------------------------------------------------------------------------------------

describe("the first page", () => {
  it("xrpl: the calls of spec §3.2 with their classes, stored as minute", async () => {
    cold();
    const kept = storedEntries();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render(PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(PATH)).toEqual(MINUTE);
    expect([...keysOf(mock.requests)].sort()).toEqual(FIRST_PAGE);
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    // #2 is kept 2 s under the home page's key, #3 300 s under a key of its own; the collection and the tab's list are the class's own.
    expect(await keptFor(kept, LAST_VALIDATED_ENTRY)).toBe("public, max-age=2");
    expect(await keptFor(kept, STATS_ENTRY)).toBe("public, max-age=300");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/nft_collections/${KEY}`)).toBe("public, max-age=60");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/nft_collections/${KEY}/sales?descending=true&limit=20`)).toBe("public, max-age=5");

    // The header card.
    expect(titleOf(html)).toBe(`Collection rLxc1b…rwMy · taxon ${T} · XRPL · explorer`);
    expect(elementText(html, "nft-coll__title")).toBe(`Collection rLxc1b…rwMy · taxon ${T}`);
    expect(text).toContain("XRPL / NFTs / rLxc1b…rwMy · taxon 0");
    expect(text).toContain("NFToken collection");
    expect(text).toContain(`Issuer ${I}`);
    expect(html).toContain(`href="/xrpl/account/${I}"`);
    expect(text).toContain(`Taxon ${T}`);
    expect(text).toMatch(/First mint [A-Z][a-z]{2} \d{1,2}, \d{4} · last mint [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    // The six stats.
    const stats = tiles(html);
    expect(stats.map((tile) => tile.label)).toEqual(["Supply", "Holders", "Sales", "Volume", "Average sale, 30 days", "Lowest sale, 30 days"]);
    expect(stats.map((tile) => tile.value)).toEqual(["14", "4", "21", "3,695.22 XRP", "185 XRP", "20 XRP"]);
    expect(text).toContain("20 sales");
    expect(text).toContain("a sale, not an open offer");
    // The chart: 30 days, one column a day, the table view in the page, the running day marked so far; the note, and the source line.
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
    const volume = rowsOf(html, "Sales volume per day, in XRP, last 30 days");
    expect(volume).toHaveLength(31);
    expect(volume[1]![0]).toBe("Oct 17, 2026, so far");
    expect(volume[30]![0]).toBe("Sep 18, 2026");
    expect(volume[0]).toEqual(["Day (UTC)", "Volume", "Sales", "Average", "Lowest", "Minted"]);
    expect(text).toContain("One bar a UTC day. A day with no sale has no average or lowest price.");
    expect(text).toContain(`/v2/nft_collections/${KEY}/stats`);
    // The measure links, the tab links and the Sales tab: 20 rows, no Collection column, Older to the second page.
    expect(["Volume", "Sales", "Average price", "Lowest price"].map((label) => linksTo(html, label)[0])).toEqual([PATH, `${PATH}?measure=sales`, `${PATH}?measure=avg`, `${PATH}?measure=low`]);
    expect(ownLinks(html, "Sales")).toEqual([`${PATH}?measure=sales`, PATH]);
    expect(ownLinks(html, "NFTs")).toEqual([`${PATH}?tab=nfts`]);
    expect(ownLinks(html, "Holders")).toEqual([`${PATH}?tab=holders`]);
    const sales = rowsOf(html, "Sales");
    expect(sales).toHaveLength(21);
    expect(sales[0]).toEqual(["Time", "NFT", "Price", "Seller → buyer", "Sale", "Royalty, est."]);
    const marker = await salesMarker("xrpl");
    expect(linksTo(html, "Older")).toEqual([`${PATH}?marker=${marker}`]);
    expect(linksTo(html, "Newer")).toEqual([]);
    // Each row links its NFT, which has a page of its own.
    expect(hrefs(html).filter((href) => /^\/xrpl\/nft\/[0-9A-F]{64}$/.test(href))).toHaveLength(20);
    // The board's note under the tabs; indexable; complete coverage says nothing, and nothing failed.
    expect(text).toContain("A collection is every NFT of one issuer and one taxon. Names and images live in each NFT’s metadata, which the explorer does not fetch, so tokens are shown by serial and id.");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${PATH}"/>`);
    expect(isNoindex(html)).toBe(false);
    expect(alerts(html)).toBe(0);
    expect(html).not.toContain('role="note"');
  });

  it("xahau: /xahau/nfts/{issuer}", async () => {
    cold();
    mock = mockUpstream("xahau");
    const { response, html, text } = await render(URI_PATH);
    const keys = calls(URI_I);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([keys.COLLECTION, LAST_VALIDATED, keys.STATS, keys.SALES].sort());
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    expect(await storedAs(URI_PATH)).toEqual(MINUTE);
    expect(titleOf(html)).toBe("URITokens of rodinG…zKyb · Xahau · explorer");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${URI_PATH}"/>`);
    expect(text).toContain("Xahau / URITokens / rodinG…zKyb");
    expect(text).toContain("URIToken collection");
    expect(text).not.toContain("Taxon");
    expect(tiles(html).map((tile) => tile.value)).toEqual(["9", "6", "21", "70.1K XAH", "3,503 XAH", "1,017.12 XAH"]);
    expect(text).toContain("Sales volume per day, in XAH, last 30 days");
    expect(rowsOf(html, "Sales")[0]).toEqual(["Time", "URIToken", "Price", "Seller → buyer", "Sale", "Royalty"]);
    expect(ownLinks(html, "URITokens", URI_PATH)).toEqual([`${URI_PATH}?tab=nfts`]);
    expect(text).toContain("A collection is every URIToken of one issuer. Names and images live in each URIToken’s metadata, which the explorer does not fetch, so tokens are shown by id.");
    // Xahau's coverage is not complete: the chart and the list say where their history starts, in URIToken words.
    expect(text.match(/Covers ledger #26,533,927 onwards: earlier URIToken sales are not in the index yet\./g)).toHaveLength(2);
    expect(alerts(html)).toBe(0);
  });

  it("says that a day's only sale had no rate, on a Xahau collection that has such a day", async () => {
    cold();
    mock = mockUpstream("xahau");
    const { response, text, html } = await render(`/xahau/nfts/${URI_UNRATED.issuer}`);
    expect(response.status).toBe(200);
    expect(tiles(html).slice(4)).toEqual([
      { label: "Average sale, 30 days", value: "—" },
      { label: "Lowest sale, 30 days", value: "—" },
    ]);
    expect(text).toContain("1 sale, none with a daily XAH rate");
    expect(alerts(html)).toBe(0);
  });

  it("says no sale in 30 days for a collection that has none", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, text } = await render(`/xrpl/nfts/${QUIET.issuer}/${QUIET.taxon}`);
    expect(response.status).toBe(200);
    expect(text).toContain("no sale in 30 days");
    expect(text).toContain("No sale of this collection is in the index.");
  });

  it("another measure and tab: the measure's chart, noindex, follow, minute", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `${PATH}?measure=avg&tab=holders`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([COLLECTION, LAST_VALIDATED, STATS, HOLDERS].sort());
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(html)).toBe(true);
    expect(text).toContain("Average sale price per day, in XRP, last 30 days");
    expect(titleOf(html)).toBe(`Collection rLxc1b…rwMy · taxon ${T} · XRPL · explorer`);
    expect(rowsOf(html, "Holders")[0]).toEqual(["Holder", "NFTs held", "Share of supply"]);
  });

  it("the Holders tab at the default measure is indexable, with the tab in its canonical URL", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `${PATH}?tab=holders`;
    const { response, html } = await render(path);
    expect(response.status).toBe(200);
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${PATH}?tab=holders"/>`);
    expect(isNoindex(html)).toBe(false);
    const holders = rowsOf(html, "Holders");
    expect(holders.length).toBeGreaterThan(1);
    expect(holders[1]![2]).toMatch(/^(<0\.1|\d+\.\d)%$/);
  });
});

describe("the NFTs and the Holders tabs", () => {
  it("tabs nfts (owner, burned) and holders call their routes", async () => {
    cold();
    // The NFTs tab.
    mock = mockUpstream("xrpl");
    let path = `${PATH}?tab=nfts`;
    let page = await render(path);
    expect(page.response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([COLLECTION, LAST_VALIDATED, STATS, NFTS].sort());
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(rowsOf(page.html, "NFTs")[0]).toEqual(["NFT", "Owner", "Sales", "Last sale", "Flags", "Minted"]);
    expect(rowsOf(page.html, "NFTs").length).toBeGreaterThan(1);
    // The owner form: a GET form to the collection's path, with the view's tab as a hidden field before the owner and the burned fields.
    expect(page.html).toMatch(new RegExp(`<form [^>]*action="${PATH}" method="get"`));
    expect([...page.html.matchAll(/<input [^>]*>/g)].map((match) => /name="([^"]*)"/.exec(match[0])![1]).filter((name) => ["measure", "tab", "owner", "burned"].includes(name!))).toEqual(["tab", "owner", "burned"]);
    expect(page.text).toContain("Held by an account");
    expect(page.text).toContain("Include burned");
    expect(isNoindex(page.html)).toBe(false);
    expect(page.html).toContain(`<link rel="canonical" href="https://explorer.test${PATH}?tab=nfts"/>`);
    mock.restore();

    // An owner: its call, and noindex, follow.
    mock = mockUpstream("xrpl");
    path = `${PATH}?tab=nfts&owner=${OWNER}`;
    page = await render(path);
    expect(page.response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([COLLECTION, LAST_VALIDATED, STATS, `GET /v2/nft_collections/${KEY}/nfts?limit=20&owner=${OWNER}`].sort());
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(page.html)).toBe(true);
    expect(page.html).toContain(`value="${OWNER}"`);
    expect(rowsOf(page.html, "NFTs").length).toBeGreaterThan(1);
    mock.restore();

    // Include burned: its call, and the box checked.
    mock = mockUpstream("xrpl");
    path = `${PATH}?tab=nfts&burned=1`;
    page = await render(path);
    expect(page.response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([COLLECTION, LAST_VALIDATED, STATS, `GET /v2/nft_collections/${KEY}/nfts?include_burned=true&limit=20`].sort());
    expect(isNoindex(page.html)).toBe(true);
    expect(page.html).toMatch(/<input [^>]*name="burned"[^>]*checked=""|<input [^>]*checked=""[^>]*name="burned"/);
    expect(page.text).toContain("burned");
    mock.restore();

    // The Holders tab.
    mock = mockUpstream("xrpl");
    path = `${PATH}?tab=holders`;
    page = await render(path);
    expect([...keysOf(mock.requests)].sort()).toEqual([COLLECTION, LAST_VALIDATED, STATS, HOLDERS].sort());
    expect(await storedAs(path)).toEqual(MINUTE);
  });

  it("says what is wrong under the owner field for an owner that is no address, asks for no NFTs, and is short, noindex, follow", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `${PATH}?tab=nfts&owner=nope`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(elementText(html, "nfts__error")).toBe("Write a classic address (r…).");
    expect(html).toContain('value="nope"');
    expect(html).toContain('aria-invalid="true"');
    expect(keysOf(mock.requests).filter((key) => key.includes("/nfts"))).toEqual([]);
    // The other calls are made: the stats and the chart are drawn, and there is no NFTs table.
    expect([...keysOf(mock.requests)].sort()).toEqual([COLLECTION, LAST_VALIDATED, STATS].sort());
    expect(rowsOf(html, "NFTs")).toEqual([]);
    expect(alerts(html)).toBe(0);
    expect(await storedAs(path)).toEqual(SHORT);
    expect(isNoindex(html)).toBe(true);
    expect(titleOf(html)).toBe(`Collection rLxc1b…rwMy · taxon ${T} · XRPL · explorer`);
  });

  it("says that the owner holds no NFT of the collection", async () => {
    cold();
    const holder = "rf1BiGeXwwQoi8Z2ueFYTEXSwuJYfV2Jpn";
    const key = `GET /v2/nft_collections/${KEY}/nfts?limit=20&owner=${holder}`;
    mock = mockUpstream("xrpl", { [key]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, count: 0, nfts: [] } });
    const { response, text } = await render(`${PATH}?tab=nfts&owner=${holder}`);
    expect(response.status).toBe(200);
    expect(text).toContain(`No NFT of this collection is held by ${holder}.`);
  });

  it("is Xahau's: the URIToken tab calls its route, and the owner form and the burned box are there", async () => {
    cold();
    mock = mockUpstream("xahau");
    const keys = calls(URI_I);
    const { response, html, text } = await render(`${URI_PATH}?tab=nfts`);
    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([keys.COLLECTION, LAST_VALIDATED, keys.STATS, keys.NFTS].sort());
    expect(rowsOf(html, "URITokens")[0]).toEqual(["URIToken", "Owner", "Sales", "Last sale", "Flags", "Minted"]);
    expect(text).toContain("Held by an account");
  });
});

// ---- A page behind a marker ----------------------------------------------------------------------------------------------------------------------------------------

describe("a page behind a marker", () => {
  it("a marker page calls #1 and #4 only, MARKER_PAGE_CLASS", async () => {
    cold();
    const marker = await salesMarker("xrpl");
    mock = mockUpstream("xrpl");
    const path = `${PATH}?marker=${marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([COLLECTION, `${SALES}&marker=${marker}`].sort());
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
    expect(isNoindex(html)).toBe(true);
    expect(titleOf(html)).toBe(`Older sales of rLxc1b…rwMy · taxon ${T} · XRPL · explorer`);
    expect(elementText(html, "nft-coll__title")).toBe(`Older sales of rLxc1b…rwMy · taxon ${T}`);
    // The header card without its dates, Back to the collection, the tab's rows: no stats, no chart, no tabs, no measure.
    expect(text).not.toMatch(/First mint|last mint/);
    expect(linksTo(html, "Back to the collection")).toEqual([PATH]);
    expect(tiles(html)).toEqual([]);
    expect(text).not.toContain("per day, last 30 days");
    expect(html).not.toContain('aria-label="Collection lists"><ul>');
    expect(rowsOf(html, "Sales").length).toBeGreaterThan(1);
    expect(linksTo(html, "Newer")).toEqual([PATH]);
  });

  it("keeps the tab and its filter in the call and in the links, and goes back to the tab's first page", async () => {
    cold();
    const marker = "WzEwNzg4MTUzMCwxNjIsMV0";
    const key = `GET /v2/nft_collections/${KEY}/nfts?include_burned=true&limit=20&marker=${marker}&owner=${OWNER}`;
    const nft = nftSample();
    mock = mockUpstream("xrpl", { [key]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, count: 1, marker: "NEXT", nfts: [{ ...nft, issuer: I, taxon: T }] } });
    const path = `${PATH}?tab=nfts&owner=${OWNER}&burned=1&marker=${marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests).filter((request) => request.includes("/nfts"))).toEqual([key]);
    expect(elementText(html, "nft-coll__title")).toBe(`Older NFTs of rLxc1b…rwMy · taxon ${T}`);
    expect(linksTo(html, "Back to the collection")).toEqual([`${PATH}?tab=nfts&owner=${OWNER}&burned=1`]);
    expect(linksTo(html, "Newer")).toEqual([`${PATH}?tab=nfts&owner=${OWNER}&burned=1`]);
    expect(linksTo(html, "Older")).toEqual([`${PATH}?tab=nfts&owner=${OWNER}&burned=1&marker=NEXT&back=${marker}`]);
    expect(text).not.toContain("Held by an account");
  });

  it("is a 404 of class short when the API refuses the marker (a 400), or nothing is behind it, or the collection is not there", async () => {
    cold();
    mock = mockUpstream("xrpl", { [`${SALES}&marker=AAAA`]: dataApiError(400, "invalid marker") });
    let path = `${PATH}?marker=AAAA`;
    let page = await render(path);
    expect(page.response.status).toBe(404);
    expect(page.text).toContain("We couldn’t find that page of NFT collection rLxc1b…rwMy · taxon 0 on XRPL.");
    expect(await storedAs(path)).toEqual(SHORT);
    mock.restore();

    mock = mockUpstream("xrpl", { [`${SALES}&marker=BBBB`]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, count: 0, sales: [] } });
    path = `${PATH}?marker=BBBB`;
    page = await render(path);
    expect(page.response.status).toBe(404);
    expect(statusesOf(mock, `${SALES}&marker=BBBB`)).toEqual([200]);
    expect(await storedAs(path)).toEqual(SHORT);
    mock.restore();

    // The collection is not there: the 404 names it, not the page.
    const absent = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
    mock = mockUpstream("xrpl");
    path = `/xrpl/nfts/${absent}/5?marker=AAAA`;
    page = await render(path);
    expect(page.response.status).toBe(404);
    expect(page.text).toContain("We couldn’t find NFT collection rPzx7u…U9SC · taxon 5 on XRPL.");
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is a 503, never stored, when a call fails (the API without D3 included)", async () => {
    cold();
    mock = mockUpstream("xrpl", { [`${HOLDERS}&marker=CCCC`]: unavailable() });
    let path = `${PATH}?tab=holders&marker=CCCC`;
    let page = await render(path);
    expect(page.response.status).toBe(503);
    expect(page.response.headers.get("Retry-After")).not.toBeNull();
    expect(await isStored(path)).toBe(false);
    mock.restore();

    mock = mockUpstream("xrpl", { [`${HOLDERS}&marker=DDDD`]: cannotGet(HOLDERS) });
    path = `${PATH}?tab=holders&marker=DDDD`;
    page = await render(path);
    expect(page.response.status).toBe(503);
    expect(statusesOf(mock, `${HOLDERS}&marker=DDDD`)).toEqual([404]);
    expect(await isStored(path)).toBe(false);
    mock.restore();

    // The collection's own failure.
    mock = mockUpstream("xrpl", { [COLLECTION]: unavailable() });
    path = `${PATH}?marker=EEEE`;
    page = await render(path);
    expect(page.response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
    // The class of a marker page that is not stored is not asked for: the unused override of the sales call is not an error, the call having been made beside #1.
    mock.restore();
  });
});
