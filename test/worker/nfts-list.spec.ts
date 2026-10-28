import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loader as listLoader } from "../../app/routes/net.nfts._index";
import { createLoadContext, type Env } from "../../app/server/env";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { collectionCase, collectionsMarker, nftCase, salesMarker } from "../support/nft-cases";
import { alerts, expectDegraded, isNoindex, isStored, keysOf, linksTo, tiles, unavailable } from "../support/nft-pages";
import { cold, storedEntries, keptFor } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The NFT list, `/{net}/nfts`, and the older sales, `/{net}/nfts/sales` (NFT spec 1.2, 1.3, 2 and 9), on the real Worker against the generated NFT answers of the data API
// (test/fixtures/http/*/data-api/nft_*, network/nft_volume@…): what a failed call does to the list, the 404s of a page behind a marker, the class each answer is stored under,
// the calls of a view and how long each is kept, the issuer form, Xahau's words and the redirects that make one URL of a view. The off-case of `NFTS` is nfts-off.spec.ts
// (the `worker-off` project).
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included, and an error or a degraded page is never stored. So the
// tests that fail a call come first, each on a view that no later test reads (`period`, `sort` and `order` tell the views apart), and every test takes the subrequest entries
// away (`cold`, test/support/subrequest-miss.ts): each call of a render reaches the mock, so an override is always the answer and a list of calls does not depend on the order
// of the tests. The pages do not poll, so no call asks for the failure hold; `Date` alone is faked all the same and moved 301 s on after each test, past the longest keep (the
// edge cache's freshness reads `Date`), so that no test reads what an earlier one left. The afterEach below fails a test whose override no request used.

const { get, stored, storedAs } = pageClient("198.18.60");

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

const collectionRows = (html: string) => tableRows(html, "Collections");
const saleRows = (html: string) => tableRows(html, "Recent sales");

// ---- The calls, by the keys the mock names them (its query sorted by name) ------------------------------------------------------------------------

const LAST_VALIDATED = "GET /v2/last_validated";
/** #2, the live volume of the period: the key of the default view. */
const LIVE = "GET /v2/network/nft_volume?live=day";
/** #3: the 30 days up to the recorded ledger's day (Oct 17, 2026). */
const DAILY = "GET /v2/network/nft_volume?end=2026-10-17&interval=day&limit=1000&start=2026-09-18";
/** #4 */
const SALES = "GET /v2/nft_sales?descending=true&limit=10";
/** #5, the first page of the collections: the key of the default view. */
const COLLECTIONS = "GET /v2/nft_collections?limit=20&sort=volume";
/** What the first page of the default view asks for, sorted. */
const FIRST_PAGE = [LAST_VALIDATED, LIVE, DAILY, SALES, COLLECTIONS].sort();

/** The subrequest keys of #1 and #3, as the client writes them (data-api.ts: the URL, then the TTL the caller asked for). */
const API_BASE = "https://xrpl.data.example.invalid";
const LAST_VALIDATED_ENTRY = `GET ${API_BASE}/v2/last_validated [kept 2 s]`;
const DAILY_ENTRY = `GET ${API_BASE}/v2/network/nft_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000 [kept 300 s]`;

const ISSUER = "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy";
const SHORT = { cls: "short", ttl: 30 };
const MINUTE = { cls: "minute", ttl: 60 };
const MARKER_PAGE = { cls: "slow", ttl: 3600 };

// ---- Failures first, each on a view no later test reads ------------------------------------------------------------------------------------------

describe("a call that fails (spec 2.2)", () => {
  /** One render of `path` with these overrides, every call reaching the mock (the test has made the subrequest cache `cold`); the overrides must all be used. */
  async function failing(path: string, overrides: Record<string, unknown>) {
    mock = mockUpstream("xrpl", overrides);
    const page = await render(path);
    await expectDegraded(path, page.response);
    expect(mock.unusedOverrides()).toEqual([]);
    return { ...page, mock };
  }

  it("xrpl: each card's failure is told in its place and the page is not stored", async () => {
    cold();
    // #2: the live volume feeds the tiles and the top collections, each told on its own. 7 days: a view of its own.
    let page = await failing("/xrpl/nfts?period=7day", { "GET /v2/network/nft_volume?live=7day": unavailable() });
    expect(statusesOf(page.mock, "GET /v2/network/nft_volume?live=7day")).toEqual([503]);
    expect(tiles(page.html).map((tile) => tile.value)).toEqual(["—", "—", "—", "—"]);
    expect(tiles(page.html).map((tile) => tile.label)).toEqual(["Sales volume, 7 days", "Sales, 7 days", "Collections traded, 7 days", "Average sale, 7 days"]);
    expect(page.text).toContain("Couldn’t load the totals.");
    expect(page.text).toContain("Couldn’t load the top collections.");
    expect(alerts(page.html)).toBe(2);
    // The other cards are drawn.
    expect((page.html.match(/class="col"/g) ?? []).length).toBe(30);
    expect(saleRows(page.html)).toHaveLength(11);
    expect(collectionRows(page.html)).toHaveLength(21);
    page.mock.restore();

    // #3: the 30 days. 30 days: a view of its own.
    page = await failing("/xrpl/nfts?period=30day", { [DAILY]: unavailable() });
    expect(statusesOf(page.mock, DAILY)).toEqual([503]);
    expect(page.text).toContain("Couldn’t load the sales volume.");
    expect(page.text).toContain("Sales volume per day, in XRP, last 30 days");
    expect((page.html.match(/class="col"/g) ?? []).length).toBe(0);
    expect(tiles(page.html).map((tile) => tile.value)).not.toContain("—");
    expect(alerts(page.html)).toBe(1);
    page.mock.restore();

    // #4: the recent sales.
    page = await failing("/xrpl/nfts?sort=supply", { [SALES]: unavailable() });
    expect(statusesOf(page.mock, SALES)).toEqual([503]);
    expect(page.text).toContain("Couldn’t load the recent sales.");
    expect(saleRows(page.html)).toEqual([]);
    expect(collectionRows(page.html)).toHaveLength(21);
    expect(alerts(page.html)).toBe(1);
    page.mock.restore();

    // #5: the collections, and the tile's "of N collections" with them.
    page = await failing("/xrpl/nfts?sort=holders", { "GET /v2/nft_collections?limit=20&sort=holders": unavailable() });
    expect(page.text).toContain("Couldn’t load the collections.");
    expect(collectionRows(page.html)).toEqual([]);
    expect(saleRows(page.html)).toHaveLength(11);
    expect(tiles(page.html)[2]).toEqual({ label: "Collections traded, 24 h", value: "3" });
    expect(page.text).not.toContain("of 46 collections");
    expect(alerts(page.html)).toBe(1);
    page.mock.restore();

    // #1: the newest ledger fails only the chart, and the 30 days are not asked for.
    page = await failing("/xrpl/nfts?sort=supply&order=asc", { [LAST_VALIDATED]: unavailable() });
    expect(statusesOf(page.mock, LAST_VALIDATED)).toEqual([503]);
    expect(keysOf(page.mock.requests).filter((key) => key.startsWith("GET /v2/network/nft_volume?") && !key.includes("live="))).toEqual([]);
    expect(page.text).toContain("Couldn’t load the sales volume.");
    expect(alerts(page.html)).toBe(1);
    expect(collectionRows(page.html)).toHaveLength(21);
  });

  it("logs each failure under its card's name, once, with the error itself", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await failing("/xrpl/nfts?period=7day&sort=holders", { "GET /v2/network/nft_volume?live=7day": unavailable(), "GET /v2/nft_collections?limit=20&sort=holders": unavailable() });
    const lines = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT list"));
    expect(lines).toHaveLength(2);
    expect(lines.filter((line) => line.includes("the NFT list's totals could not be loaded") && line.includes("answered 503"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("the NFT list's collections could not be loaded") && line.includes("answered 503"))).toHaveLength(1);
  });

  it("an API without D3 (Cannot GET) is a failed card, never a stored 404", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // `null` is the fixture server's answer to a path the API has no route for: the framework's "Cannot GET" 404, which is an outage.
    const { html, text, mock: used } = await failing("/xrpl/nfts?period=30day&sort=supply", {
      "GET /v2/network/nft_volume?live=30day": null,
      [DAILY]: null,
      [SALES]: null,
      "GET /v2/nft_collections?limit=20&sort=supply": null,
    });

    expect(statusesOf(used, DAILY)).toEqual([404]);
    expect(tiles(html).map((tile) => tile.value)).toEqual(["—", "—", "—", "—"]);
    for (const failure of ["the totals", "the top collections", "the sales volume", "the recent sales", "the collections"]) expect(text).toContain(`Couldn’t load ${failure}.`);
    expect(alerts(html)).toBe(5);
    // Nothing of the error is in the page, whose data goes to the browser as well.
    expect(html).not.toContain("Cannot GET");
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("Cannot GET /v2/nft_sales"))).toHaveLength(1);
  });

  it("logs a last_validated that gives no anchor as the chart's failure, and does not ask for the 30 days", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { result: "success", ledger_index: "abc", ledger_hash: "AB".repeat(32), parent_hash: "CD".repeat(32), close_time: "not a time" };
    const { html, text, mock: used } = await failing("/xrpl/nfts?order=asc", { [LAST_VALIDATED]: bad });

    expect(keysOf(used.requests)).not.toContain(DAILY);
    expect(text).toContain("Couldn’t load the sales volume.");
    expect(alerts(html)).toBe(1);
    expect((html.match(/class="col"/g) ?? []).length).toBe(0);
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT list's sales volume could not be loaded"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("answered a ledger_index or close_time that is not a number");
  });
});

describe("a card that has not answered (spec 2.2)", () => {
  it("gives up on the recent sales 4.5 s after the loader began, logs that it took too long, and answers 200 all the same, not stored", async () => {
    cold();
    mock = mockUpstream("xrpl", { [SALES]: () => new Promise<Response>(() => {}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = "/xrpl/nfts?period=30day&sort=holders";
    const started = performance.now();
    const { response, html, text } = await render(path);
    const took = performance.now() - started;

    await expectDegraded(path, response);
    // The card's deadline; the data API client would have given up at 5 s.
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(text).toContain("Couldn’t load the recent sales.");
    expect(saleRows(html)).toEqual([]);
    expect(collectionRows(html)).toHaveLength(21);
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the NFT list's recent sales took too long"))).toHaveLength(1);
  }, 15_000);
});

// ---- The 404s and the form error (spec 1.3) ----------------------------------------------------------------------------------------------------

describe("a page behind a marker that is not there (spec 1.3)", () => {
  it("is a 404 of class short, before any call and before any redirect, for a marker that is not one", async () => {
    mock = mockUpstream("xrpl");
    for (const path of ["/xrpl/nfts?marker=%25", "/xrpl/nfts?back=AAAA&marker=%25&x=1", `/xrpl/nfts?issuer=${ISSUER}&marker=%25`]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the NFT collections");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 of class short, and no call, for a marker of a view whose issuer is no address", async () => {
    mock = mockUpstream("xrpl");
    for (const path of ["/xrpl/nfts?issuer=nope&marker=AAAA", "/xrpl/nfts?marker=AAAA&issuer=rNopeNopeNope&sort=supply"]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the NFT collections");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 of class short when the API refuses the marker (a 400)", async () => {
    cold();
    const key = "GET /v2/nft_collections?limit=20&marker=AAAA&sort=volume";
    mock = mockUpstream("xrpl", { [key]: dataApiError(400, "invalid marker") });
    const path = "/xrpl/nfts?marker=AAAA";
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, key)).toEqual([400]);
    expect(text).toContain("that page of the NFT collections");
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is a 404 of class short when nothing is behind the marker", async () => {
    cold();
    const key = "GET /v2/nft_collections?limit=20&marker=BBBB&sort=volume";
    mock = mockUpstream("xrpl", { [key]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, total: 46, count: 0, collections: [] } });
    const path = "/xrpl/nfts?marker=BBBB";
    const { response } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, key)).toEqual([200]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is a 503, never stored, when the call fails (the API without D3 included)", async () => {
    cold();
    const key = "GET /v2/nft_collections?limit=20&marker=CCCC&sort=supply";
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const path = "/xrpl/nfts?sort=supply&marker=CCCC";
    const failed = await render(path);
    expect(failed.response.status).toBe(503);
    expect(failed.response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, key)).toEqual([503]);
    expect(await isStored(path)).toBe(false);
    mock.restore();

    const missing = "GET /v2/nft_collections?limit=20&marker=DDDD&sort=supply";
    mock = mockUpstream("xrpl", { [missing]: null });
    const absent = await render("/xrpl/nfts?sort=supply&marker=DDDD");
    expect(absent.response.status).toBe(503);
    expect(statusesOf(mock, missing)).toEqual([404]);
    expect(await isStored("/xrpl/nfts?sort=supply&marker=DDDD")).toBe(false);
  });
});

describe("the issuer form (spec 1.2, 1.3)", () => {
  it("says what is wrong under the field for an issuer that is no address, asks for no collections, and is short, noindex, follow", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = "/xrpl/nfts?issuer=nope";
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(elementText(html, "nfts__error")).toBe("Write a classic address (r…).");
    expect(html).toContain('value="nope"');
    expect(html).toContain('aria-invalid="true"');
    expect(keysOf(mock.requests).filter((key) => key.startsWith("GET /v2/nft_collections"))).toEqual([]);
    // The other calls are made: the tiles, the chart and the sales are drawn, and there is no Collections table.
    expect([...keysOf(mock.requests)].sort()).toEqual([LAST_VALIDATED, LIVE, DAILY, SALES].sort());
    expect(collectionRows(html)).toEqual([]);
    // The message is the one alert (a screen reader reads it when Show brings it): no card failed.
    expect(alerts(html)).toBe(1);
    expect(html).toMatch(/<p id="[^"]+" role="alert" class="nfts__error">/);
    expect(await storedAs(path)).toEqual(SHORT);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>NFTs · XRPL · explorer</title>");
  });

  it("asks for the collections of one issuer, with the period, the sort and the order, and keeps them in hidden fields", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/nfts?period=7day&issuer=${ISSUER}&sort=supply&order=asc`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([LAST_VALIDATED, "GET /v2/network/nft_volume?live=7day", DAILY, SALES, `GET /v2/nft_collections?descending=false&issuer=${ISSUER}&limit=20&sort=supply`].sort());
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(html)).toBe(true);
    expect(collectionRows(html)).toHaveLength(3);
    // The form shows the view as the URL has it, so that Show keeps it.
    expect(html).toMatch(/<form [^>]*action="\/xrpl\/nfts" method="get">/);
    expect([...html.matchAll(/<input [^>]*>/g)].map((match) => /name="([^"]*)"/.exec(match[0])![1]).filter((name) => ["period", "issuer", "sort", "order"].includes(name!))).toEqual(["period", "issuer", "sort", "order"]);
    expect(html).toContain(`value="${ISSUER}"`);
    expect(text).toContain("Collections of an issuer");
    // The tile's "of N collections" is the network's, which an issuer's total is not: left out.
    expect(text).not.toMatch(/of \d+ collections/);
  });

  it("says that an issuer has no collection in the index", async () => {
    cold();
    const issuer = "rf1BiGeXwwQoi8Z2ueFYTEXSwuJYfV2Jpn";
    const key = `GET /v2/nft_collections?issuer=${issuer}&limit=20&sort=volume`;
    mock = mockUpstream("xrpl", { [key]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, total: 0, count: 0, collections: [] } });
    const { response, text } = await render(`/xrpl/nfts?issuer=${issuer}`);
    expect(response.status).toBe(200);
    expect(text).toContain(`No collection of ${issuer} in the index.`);
  });
});

// ---- The class, the calls and the page --------------------------------------------------------------------------------------------------------

describe("the first page", () => {
  it("xrpl: makes exactly the calls of spec §2.2 with their classes and stores the page as minute", async () => {
    cold();
    const kept = storedEntries();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/nfts");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs("/xrpl/nfts")).toEqual(MINUTE);
    expect([...keysOf(mock.requests)].sort()).toEqual(FIRST_PAGE);
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    // #1 is kept 2 s under the home page's key, #3 300 s under a key of its own; the live set, the collections and the sales are the class's own.
    expect(await keptFor(kept, LAST_VALIDATED_ENTRY)).toBe("public, max-age=2");
    expect(await keptFor(kept, DAILY_ENTRY)).toBe("public, max-age=300");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/network/nft_volume?live=day`)).toBe("public, max-age=60");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/nft_collections?limit=20&sort=volume`)).toBe("public, max-age=60");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/nft_sales?descending=true&limit=10`)).toBe("public, max-age=5");

    expect(tiles(html)).toEqual([
      { label: "Sales volume, 24 h", value: "270.67 XRP" },
      { label: "Sales, 24 h", value: "5" },
      { label: "Collections traded, 24 h", value: "3" },
      { label: "Average sale, 24 h", value: "54 XRP" },
    ]);
    expect(text).toContain("of 46 collections");
    // The chart: 30 days, one column a day, the table view in the page; the running day marked so far.
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
    const volume = tableRows(html, "Sales volume per day, in XRP, last 30 days");
    expect(volume).toHaveLength(31);
    expect(volume[1]![0]).toBe("Oct 17, 2026, so far");
    expect(volume[30]![0]).toBe("Sep 18, 2026");
    expect(text).toContain("/v2/network/nft_volume?interval=day");
    expect(text).toContain("/v2/network/nft_volume?live=day");
    // The top collections, the recent sales (10) and the collections (20), each with its header.
    expect(text).toContain("Top collections, 24 h");
    expect((html.match(/class="barlist__item"/g) ?? []).length).toBe(3);
    expect(saleRows(html)).toHaveLength(11);
    expect(saleRows(html)[0]).toEqual(["Time", "NFT", "Collection", "Price", "Seller → to buyer", "Sale", "Royalty, est."]);
    expect(collectionRows(html)).toHaveLength(21);
    expect(collectionRows(html)[0]!.map((cell) => cell.replace(/[↑↓]/, "").trim())).toEqual(["Collection", "Supply", "Holders", "Minted / burned", "Sales", "Volume (XRP)", "Last mint"]);
    // The links: older sales, more collections, the sorts; indexable, no failure, complete coverage says nothing.
    expect(linksTo(html, "Older sales")).toEqual(["/xrpl/nfts/sales?marker=WzEwNzg4NjE2Myw4MywxXQ"]);
    expect(linksTo(html, "More collections")).toEqual(["/xrpl/nfts?marker=WzAsInI0cUhNN3ZXZUxUdFdQVm9FekRqVDZBc2twUWpTbXVpN0IiLDBd"]);
    expect(linksTo(html, "Supply")).toEqual(["/xrpl/nfts?sort=supply"]);
    expect(html).toContain('<link rel="canonical" href="https://explorer.test/xrpl/nfts"/>');
    expect(html).toContain("<title>NFTs · XRPL · explorer</title>");
    expect(isNoindex(html)).toBe(false);
    expect(alerts(html)).toBe(0);
    expect(html).not.toContain('role="note"');
  });

  it("answers its .data URL with the page's data and not a redirect: React Router's _routes is no part of the view", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response } = await render("/xrpl/nfts.data?_routes=routes%2Fnet.nfts._index");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/x-script");
    expect([...keysOf(mock.requests)].sort()).toEqual(FIRST_PAGE);
  });

  it("asks for the 7 days of the period's live set, and says so in the tiles and the links", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = "/xrpl/nfts?period=7day&sort=holders&order=asc";
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([LAST_VALIDATED, "GET /v2/network/nft_volume?live=7day", DAILY, SALES, "GET /v2/nft_collections?descending=false&limit=20&sort=holders"].sort());
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Sales volume, 7 days", "Sales, 7 days", "Collections traded, 7 days", "Average sale, 7 days"]);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>NFTs · XRPL · explorer</title>");
    expect(linksTo(html, "30 days")).toEqual(["/xrpl/nfts?period=30day&sort=holders&order=asc"]);
    // The current sort's link flips the order, and has its arrow: ascending is the one the URL asked for.
    expect(linksTo(html, "Holders ↑")).toEqual(["/xrpl/nfts?period=7day&sort=holders"]);
  });
});

describe("a page behind a marker", () => {
  it("makes the collections call alone and is stored as MARKER_PAGE_CLASS, noindex, follow, with Newer back to the first page", async () => {
    cold();
    const marker = await collectionsMarker("xrpl");
    mock = mockUpstream("xrpl");
    const path = `/xrpl/nfts?marker=${marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([`GET /v2/nft_collections?limit=20&marker=${marker}&sort=volume`]);
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>More NFT collections · XRPL · explorer</title>");
    expect(elementText(html, "nfts__title")).toBe("More NFT collections");
    // The collections table alone: no tiles, no chart, no sales, no period.
    expect(tiles(html)).toEqual([]);
    expect(saleRows(html)).toEqual([]);
    expect(text).not.toContain("Top collections");
    expect(text).not.toContain("Sales volume per day");
    expect(collectionRows(html)).toHaveLength(21);
    expect(linksTo(html, "Newer")).toEqual(["/xrpl/nfts"]);
    // The list has a third page: its marker, with the trail back to the first.
    expect(linksTo(html, "More collections")).toEqual([expect.stringMatching(new RegExp(`^/xrpl/nfts\\?marker=[A-Za-z0-9_-]+&back=${marker}$`))]);
  });

  it("keeps the sort, the order and the issuer in the call and in the links, and has no period", async () => {
    cold();
    const marker = "WzAsInJoUGVqMWk0OUdNMmZ0dUtYaEY4SzVQRkZRcUdNa3BoN2siLDFd";
    const key = `GET /v2/nft_collections?descending=false&issuer=${ISSUER}&limit=20&marker=${marker}&sort=supply`;
    // The marker is not in the fixtures for this view: an answer of its own.
    const collection = { burned: 0, holders: 1, issuer: ISSUER, kind: "nftoken", last_ledger: 107879890, minted: 0, sales_count: 2, supply: 1, taxon: 9394, volume_native: "1.32" };
    mock = mockUpstream("xrpl", { [key]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, total: 40, count: 1, marker: "NEXT", collections: [collection] } });
    const path = `/xrpl/nfts?issuer=${ISSUER}&sort=supply&order=asc&marker=${marker}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([key]);
    expect(linksTo(html, "Newer")).toEqual([`/xrpl/nfts?issuer=${ISSUER}&sort=supply&order=asc`]);
    expect(linksTo(html, "More collections")).toEqual([`/xrpl/nfts?issuer=${ISSUER}&sort=supply&order=asc&marker=NEXT&back=${marker}`]);
    // A new sort starts on the first page, with the period it never had.
    expect(linksTo(html, "Holders")).toEqual([`/xrpl/nfts?issuer=${ISSUER}&sort=holders`]);
    expect(html).toContain(`value="${ISSUER}"`);
    expect(html).not.toMatch(/name="period"/);
  });
});

describe("Xahau (the same page with URIToken words)", () => {
  it("xahau: the same page with URIToken words", async () => {
    cold();
    mock = mockUpstream("xahau");
    const path = "/xahau/nfts";
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual(["GET /v2/last_validated", "GET /v2/network/nft_volume?live=day", "GET /v2/network/nft_volume?end=2026-10-17&interval=day&limit=1000&start=2026-09-18", SALES, COLLECTIONS].sort());
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(html).toContain("<title>URITokens · Xahau · explorer</title>");
    expect(html).toContain('<link rel="canonical" href="https://explorer.test/xahau/nfts"/>');
    expect(elementText(html, "nfts__title")).toBe("URITokens");
    expect(text).toContain("URITokens, the non-fungible tokens of Xahau: sales, collections and their holders. A collection is everything one issuer minted.");
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Sales volume, 24 h", "Sales, 24 h", "Collections traded, 24 h", "Average sale, 24 h"]);
    expect(tiles(html)[0]!.value).toMatch(/ XAH$/);
    expect(text).toContain("URITokenBuy");
    expect(text).toContain("Sales volume per day, in XAH, last 30 days");
    expect(saleRows(html)[0]).toEqual(["Time", "URIToken", "Collection", "Price", "Seller → to buyer", "Sale", "Royalty"]);
    expect(saleRows(html).slice(1).every((row) => row[6] === "—")).toBe(true);
    expect(collectionRows(html)[0]!.map((cell) => cell.replace(/[↑↓]/, "").trim())[5]).toBe("Volume (XAH)");
    expect(collectionRows(html)[1]![0]).toContain("every URIToken of this issuer");
    expect(text).toContain("A sale is a URITokenBuy of a token offered for sale. URITokens carry no transfer fee, so there is no royalty.");
    // Xahau's coverage is not complete: each list says where its history starts, in URIToken words, and none claims to fail.
    expect(text).toContain("Covers ledger #26,533,927 onwards: earlier URIToken sales are not in the index yet.");
    expect(text).toContain("Covers ledger #26,533,927 onwards: earlier collections are not in the index yet.");
    expect((html.match(/role="note"/g) ?? []).length).toBe(4);
    expect(alerts(html)).toBe(0);
  });
});

describe("the older sales", () => {
  const PAGE_KEY = "GET /v2/nft_sales?descending=true&limit=20";

  it("older sales: first page minute, marker page MARKER_PAGE_CLASS, a failure 503", async () => {
    // The first page: minute, noindex, follow, 20 rows, the one call.
    cold();
    mock = mockUpstream("xrpl");
    let path = "/xrpl/nfts/sales";
    let page = await render(path);
    expect(page.response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([PAGE_KEY]);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(page.html)).toBe(true);
    expect(page.html).toContain("<title>NFT sales · XRPL · explorer</title>");
    expect(elementText(page.html, "nfts__title")).toBe("NFT sales");
    expect(tableRows(page.html, "Sales")).toHaveLength(21);
    expect(page.text).toContain("XRPL / NFTs / Sales");
    const marker = await salesMarker("xrpl");
    expect(linksTo(page.html, "Older")).toEqual([`/xrpl/nfts/sales?marker=${marker}`]);
    expect(linksTo(page.html, "Newer")).toEqual([]);
    mock.restore();

    // A page behind a marker: MARKER_PAGE_CLASS, with Newer back to the first page.
    mock = mockUpstream("xrpl");
    path = `/xrpl/nfts/sales?marker=${marker}`;
    page = await render(path);
    expect(page.response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([`${PAGE_KEY}&marker=${marker}`]);
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
    expect(isNoindex(page.html)).toBe(true);
    expect(linksTo(page.html, "Newer")).toEqual(["/xrpl/nfts/sales"]);
    mock.restore();

    // A failure is a 503, and nothing is stored: the first page, and a page behind a marker.
    mock = mockUpstream("xrpl", { [`${PAGE_KEY}&marker=EEEE`]: unavailable() });
    page = await render("/xrpl/nfts/sales?marker=EEEE");
    expect(page.response.status).toBe(503);
    expect(page.response.headers.get("Retry-After")).not.toBeNull();
    expect(await isStored("/xrpl/nfts/sales?marker=EEEE")).toBe(false);
    mock.restore();

    // The first page of the other network, which no copy was stored of yet (the Worker answers a 5xx with the stored copy of the page, if there is one): the API without D3.
    mock = mockUpstream("xahau", { [PAGE_KEY]: null });
    page = await render("/xahau/nfts/sales");
    expect(page.response.status).toBe(503);
    expect(statusesOf(mock, PAGE_KEY)).toEqual([404]);
    expect(await isStored("/xahau/nfts/sales")).toBe(false);
  });

  it("is a 404 of class short for a marker that is not one, one the API refuses (a 400) and one with nothing behind it", async () => {
    cold();
    mock = mockUpstream("xrpl");
    for (const path of ["/xrpl/nfts/sales?marker=%25", "/xrpl/nfts/sales?back=AAAA&marker=%25&x=1"]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the NFT sales");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
    mock.restore();

    mock = mockUpstream("xrpl", { [`${PAGE_KEY}&marker=FFFF`]: dataApiError(400, "invalid marker"), [`${PAGE_KEY}&marker=GGGG`]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, count: 0, sales: [] } });
    for (const marker of ["FFFF", "GGGG"]) {
      const path = `/xrpl/nfts/sales?marker=${marker}`;
      const { response } = await render(path);
      expect(response.status, path).toBe(404);
      expect(await storedAs(path)).toEqual(SHORT);
    }
  });

  it("redirects a query that is not the view's canonical one, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    for (const [from, to] of [
      ["/xrpl/nfts/sales?x=1", "/xrpl/nfts/sales"],
      ["/xrpl/nfts/sales?back=M1", "/xrpl/nfts/sales"],
      ["/xrpl/nfts/sales?back=BBBB&marker=AAAA&x=1", "/xrpl/nfts/sales?marker=AAAA&back=BBBB"],
    ]) {
      const response = await get(from);
      await response.text();
      expect(response.status, from).toBe(302);
      expect(response.headers.get("Location")).toBe(to);
      expect(await storedAs(from)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("is Xahau's: URIToken sales, with the URIToken column", async () => {
    cold();
    mock = mockUpstream("xahau");
    const { response, html, text } = await render("/xahau/nfts/sales");
    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([PAGE_KEY]);
    expect(html).toContain("<title>URIToken sales · Xahau · explorer</title>");
    expect(text).toContain("Xahau / URITokens / Sales");
    expect(tableRows(html, "Sales")[0]).toEqual(["Time", "URIToken", "Collection", "Price", "Seller → to buyer", "Sale", "Royalty"]);
    expect(text).toContain("Covers ledger #26,533,927 onwards: earlier URIToken sales are not in the index yet.");
  });
});

// ---- Redirects -----------------------------------------------------------------------------------------------------------------------------

describe("the query of the URL (spec 1.2)", () => {
  it.each([
    ["?period=day", ""],
    ["?order=desc&sort=volume", ""],
    ["?back=M1", ""],
    ["?x=1&period=7day", "?period=7day"],
    ["?sort=holders&period=30day", "?period=30day&sort=holders"],
    ["?order=asc&issuer=%20rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy%20", "?issuer=rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy&order=asc"],
    ["?issuer=", ""],
    ["?period=week&sort=price", ""],
    ["?period=7day&period=30day", "?period=7day"],
    // A page behind a marker has no period.
    ["?period=7day&marker=AAAA", "?marker=AAAA"],
    ["?back=BBBB&marker=AAAA&sort=supply", "?sort=supply&marker=AAAA&back=BBBB"],
    ["?marker=AAAA&back=B%25", "?marker=AAAA"],
  ])("redirects %s to %j with no call", async (query, canonical) => {
    mock = mockUpstream("xrpl");
    const from = `/xrpl/nfts${query}`;
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/nfts${canonical}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(SHORT);
  });

  it("redirects the path /xrpl/NFTs to /xrpl/nfts, class immutable (the path alone), before any call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/NFTs");
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/nfts");
    expect(mock.requests).toEqual([]);
    expect(await storedAs("/xrpl/NFTs")).toEqual({ cls: "immutable", ttl: 31_536_000 });
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    const path = "/xrpl/nfts.data?_routes=routes%2Fnet.nfts._index&period=day";
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain("/xrpl/nfts");
    expect(mock.requests).toEqual([]);
    expect(tidied.headers.get("Cache-Control")).toBe("max-age=0");
    // The Cache API keeps no 202; the loader's own answer to that request names the class.
    expect(await stored(path)).toBeUndefined();
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const own = (await listLoader({
      request: new Request(`https://explorer.test${path}`),
      url: new URL(`https://explorer.test${path.replace(".data", "")}`),
      params: { net: "xrpl" },
      context: createLoadContext(env as unknown as Env, ctx),
    } as never)) as Response;
    expect(own.status).toBe(302);
    expect(own.headers.get("Location")).toBe("/xrpl/nfts");
    expect(own.headers.get("X-Cache-Class")).toBe("short");
  });
});

// The header's NFTs item is the current section on every NFT page (`navSection: "nfts"`): `aria-current="page"` on the item's own page, the list, whatever its query, and `"true"` on any other
// page of the section (the older sales, a collection, an NFT), as the Header's comment says and the README's routes bullet.
describe("the header's NFTs item", () => {
  /** The `aria-current` of the header's NFTs item on `path` (`undefined` when it is not marked current), and that the item is marked current at all. */
  async function currentOf(net: "xrpl" | "xahau", path: string) {
    cold();
    mock = mockUpstream(net);
    const { response, html } = await render(path);
    expect(response.status, path).toBe(200);
    const item = anchors(html).find((a) => a.attrs.includes("nav-item") && a.attrs.includes(`href="/${net}/nfts"`));
    expect(item, `the header's NFTs item on ${path}`).toBeDefined();
    return { current: /aria-current="([^"]*)"/.exec(item!.attrs)?.[1], marked: item!.attrs.includes("is-current") };
  }

  it("is current as 'page' on the list, whatever its query, and as 'true' on the older sales, first page or behind a marker", async () => {
    expect(await currentOf("xrpl", "/xrpl/nfts?period=30day&sort=holders")).toEqual({ current: "page", marked: true });
    mock!.restore();
    expect(await currentOf("xrpl", "/xrpl/nfts/sales")).toEqual({ current: "true", marked: true });
    mock!.restore();
    expect(await currentOf("xrpl", `/xrpl/nfts/sales?marker=${await salesMarker("xrpl")}`)).toEqual({ current: "true", marked: true });
    mock!.restore();
    expect(await currentOf("xahau", "/xahau/nfts/sales")).toEqual({ current: "true", marked: true });
  });

  it("is current as 'true' on a collection and on an NFT", async () => {
    const collection = await collectionCase("xrpl", "featured");
    const nft = await nftCase("xrpl", "featured");
    expect(await currentOf("xrpl", `/xrpl/nfts/${collection.issuer}/${collection.taxon}`)).toEqual({ current: "true", marked: true });
    mock!.restore();
    expect(await currentOf("xrpl", `/xrpl/nft/${nft.id}`)).toEqual({ current: "true", marked: true });
  });
});
