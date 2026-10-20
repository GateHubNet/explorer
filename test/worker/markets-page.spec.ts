import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loader } from "../../app/routes/net.markets";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration, createLoadContext, type Env } from "../../app/server/env";
import type { MarketsPageData } from "../../app/server/markets-view";
import { anchors, elementText, hrefs, pageClient, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The markets page, `/{net}/markets`, on the real Worker against the generated markets sets of the data API (test/fixtures/http/{net}/data-api/
// network/markets@…): what a failed call does to it, the class it is stored under, the redirects that make one URL of a view, the one call it
// makes for a view, and the page without JavaScript. The off-case of `MARKETS` is markets-off.spec.ts (the `worker-off` project); the off-case of
// `AMM_DATA` is here, through the route's loader with a load context of its own.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included (the markets call is kept 60 s), and an error
// is never stored. The page does not poll, so its call does not ask for the failure hold: a failed call is asked again by the next request. The
// failure tests come first all the same, each on a view of its own that no later test reads, and the empty set is given on a key (Xahau's 30
// days) that no later test asks for. The afterEach below fails a test whose override no request used, which is how a key an earlier test stored
// shows.

const { get, storedAs } = pageClient("198.51.107");

let mock: UpstreamMock | undefined;

afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  expect(unused ?? []).toEqual([]);
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

/**
 * The rows of the Pairs table (its `role="row"` elements, the header first) as arrays of cell texts. A cell of this table holds a `div` (the
 * AMM share's meter), so a row is cut at the next row and the table at the card's foot, not at a `</div>` (`tableRows` of support/pages.ts).
 */
function pairRows(html: string): string[][] {
  const start = html.indexOf('role="table" aria-label="Pairs"');
  if (start < 0) return [];
  const end = html.indexOf('class="card__foot', start);
  const table = html.slice(start, end < 0 ? undefined : end);
  return table
    .split('<div role="row"')
    .slice(1)
    .map((row) =>
      row
        .split(/role="(?:cell|columnheader)"/)
        .slice(1)
        // A chunk ends where the next cell's tag was cut: `<span `.
        .map((chunk) => textOf(chunk.slice(chunk.indexOf(">") + 1).replace(/<span\s[^>]*$/, ""))),
    );
}

const withoutArrow = (cell: string) => cell.replace(/\s*[↑↓]$/, "");

/** What a tile of the totals says: its figure and its note. */
function tile(html: string, label: string) {
  const tiles = [...html.matchAll(/<div class="stat stat--figure">([\s\S]*?)<\/div>/g)].map((match) => match[1]!);
  const chunk = tiles.find((tileHtml) => elementText(tileHtml, "stat__label") === label);
  return chunk === undefined ? undefined : { value: elementText(chunk, "stat__value") ?? null, sub: elementText(chunk, "stat__sub") ?? null };
}

const tileLabels = (html: string) =>
  [...html.matchAll(/<div class="stat stat--figure">([\s\S]*?)<\/div>/g)].map((match) => elementText(match[1]!, "stat__label"));

const unavailable = () => dataApiError(503, "unavailable");

/** The one call of the default view on XRPL (24 hours, every trade): the key of the mock. */
const DAY = "GET /v2/network/markets?limit=1000&period=day";

// ---- Failures first ---------------------------------------------------------------------------------------------------------------------

describe("the one call of the page", () => {
  /** A 503 the visitor is told to come back after, and that is stored nowhere. */
  async function expectOutage(path: string, response: Response) {
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
  }

  it("answers 503 with Retry-After, and does not store it, when the data API fails (#1)", async () => {
    mock = mockUpstream("xrpl", { [DAY]: unavailable() });
    const path = "/xrpl/markets?quote=usd";
    const { response } = await render(path);

    await expectOutage(path, response);
    expect(statusesOf(mock, DAY)).toEqual([503]);
    expect(mock.requests.map((request) => request.key)).toEqual([DAY]);
  });

  it("answers 503 for a data API without the route (its 'Cannot GET' 404): an outage, not a page that is not there", async () => {
    // `null` is the fixture server's answer to a path the API has no route for: the framework's "Cannot GET" 404.
    mock = mockUpstream("xrpl", { [DAY]: null });
    const path = "/xrpl/markets?quote=eur";
    const { response, html } = await render(path);

    await expectOutage(path, response);
    expect(statusesOf(mock, DAY)).toEqual([404]);
    expect(html).not.toContain("Cannot GET");
  });

  it("answers 503 for a 200 that is not a markets answer, which is not kept either", async () => {
    mock = mockUpstream("xrpl", { [DAY]: { result: "success", period: "day", count: 1, markets: "not a list" } });
    const path = "/xrpl/markets?quote=btc";
    const { response } = await render(path);

    await expectOutage(path, response);
    expect(statusesOf(mock, DAY)).toEqual([200]);
    // Not held: the page does not poll, so the next request asks again (and gets the fixture).
    mock.restore();
    mock = mockUpstream("xrpl");
    const again = await render("/xrpl/markets?quote=xrp");
    expect(again.response.status).toBe(200);
    expect(statusesOf(mock, DAY)).toEqual([200]);
  });
});

// ---- The class ---------------------------------------------------------------------------------------------------------------------------

describe("the class of the page", () => {
  it("stores /xrpl/markets and its .data URL as minute, kept 60 s, and the .data URL answers the page's data and not a redirect", async () => {
    mock = mockUpstream("xrpl");
    const { response, text } = await render("/xrpl/markets");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(text).toContain("Markets");
    expect(await storedAs("/xrpl/markets")).toEqual({ cls: "minute", ttl: 60 });

    // The route's own request of a client-side navigation: React Router adds `_routes`, which is no part of the view.
    const dataPath = "/xrpl/markets.data?_routes=routes%2Fnet.markets";
    const data = await get(dataPath);
    const body = await data.text();
    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(data.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("SOLO / XRP");
    expect(await storedAs(dataPath)).toEqual({ cls: "minute", ttl: 60 });
    // The browser never gets the API's answer: the rows are the view builder's, and no host or key is in them.
    expect(body).not.toContain("native_volume");
    expect(body).not.toContain("data.example.invalid");
  });
});

// ---- Redirects -----------------------------------------------------------------------------------------------------------------------------

describe("the query of the URL", () => {
  it.each([
    ["/xrpl/markets?period=24h", "/xrpl/markets"],
    ["/xrpl/markets?quote=USD&period=7d", "/xrpl/markets?period=7d&quote=usd"],
    ["/xrpl/markets?trades=AMM&x=1", "/xrpl/markets?trades=amm"],
    ["/xahau/markets?quote=eur&trades=amm", "/xahau/markets"],
  ])("redirects %s to %s, class short, before any call", async (from, to) => {
    mock = mockUpstream("xrpl");
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(to);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual({ cls: "short", ttl: 30 });
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, with no call", async () => {
    mock = mockUpstream("xrpl");
    const tidied = await get("/xrpl/markets.data?_routes=routes%2Fnet.markets&period=24h");
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain("/xrpl/markets");
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 for a network that does not exist, before any call", async () => {
    mock = mockUpstream("xrpl");
    const { response } = await render("/bitcoin/markets?period=7d");
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

// ---- What the page asks for --------------------------------------------------------------------------------------------------------------

describe("the call of a view", () => {
  it("asks for the AMM swaps alone with ?trades=amm, and nothing else", async () => {
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/markets?trades=amm");

    expect(response.status).toBe(200);
    expect(mock.requests.map((request) => request.key)).toEqual(["GET /v2/network/markets?amm=only&limit=1000&period=day"]);
    // The source line names the route and the filter; the table is the filtered set's (8 pairs, the header above them).
    expect(text).toContain("/v2/network/markets?period=day&amm=only");
    expect(pairRows(html)).toHaveLength(9);
    expect(pairRows(html)[1]![1]).toBe("TIDE / XRP TIDE rwYxVU…GCJF");
  });
});

// ---- The page ------------------------------------------------------------------------------------------------------------------------------

describe("the page without JavaScript", () => {
  it("holds the rows of the table, their links and the sparklines' labels, in the HTML", async () => {
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/markets");
    expect(response.status).toBe(200);

    const rows = pairRows(html);
    // The header and the 40 pairs of the set: fewer than the 100 the HTML holds at most.
    expect(rows).toHaveLength(41);
    // The sorted column's arrow, a picture, is no part of its name.
    expect(rows[0]!.map(withoutArrow)).toEqual(["#", "Pair", "Last price", "Change", "Low – high", "Volume (XRP)", "Trades", "AMM share", "7 days"]);
    expect(rows[1]!.slice(0, 8)).toEqual(["1", "SOLO / XRP SOLO rHi5oN…zRnA", "0.0005379799", "+0.42%", "0.00053394261 – 0.00053900299", "74K", "35", "0%"]);
    // Shown inverted from the API's stored AUD/XRP, so that XRP is the base.
    expect(rows[8]!.slice(0, 3)).toEqual(["8", "XRP / AUD AUD rw4HFp…zcTZ", "17.507277"]);
    // The two issuers of USD/USD, and a pair with no native volume, last.
    expect(rows[20]![1]).toBe("USD / USD USD rBdXtK…zZL3 · USD rMJHeQ…MYYs");
    expect(rows[20]![7]).toBe("no pool");
    expect(rows[40]!.slice(0, 6)).toEqual(["40", "XAG / XAU XAG rS7HqD…F2JV · XAU rhzZry…Vgzu", "0.011303013", "−1.21%", "0.011288554 – 0.011450888", "—"]);

    // A row is one link, to the pair page in the row's orientation; the lower-case `usd` (which the data API cannot be asked for) is text.
    const links = anchors(html).filter((a) => /href="\/xrpl\/markets\//.test(a.attrs));
    expect(links).toHaveLength(39);
    expect(links[0]!.attrs).toContain('href="/xrpl/markets/SOLO.rHi5oN49Nazc2KR4x2whXEPqNv4gszRnA/XRP"');
    expect(links[7]!.attrs).toContain('href="/xrpl/markets/XRP/AUD.rw4HFpnCJ8msBFNQbTdntj3XYMbGoyzcTZ"');
    expect(rows[25]![1]).toBe("usd / XRP usd r1oiTL…jx5V");
    expect(links.some((a) => a.text.startsWith("usd / XRP"))).toBe(false);

    // Each sparkline is one image, named by the view builder.
    expect(html).toContain('role="img" aria-label="7-day price, from 0.00057987879 to 0.0005379799 (today so far), −7.2%"');
    expect((html.match(/<svg class="spark" role="img"/g) ?? []).length).toBe(40);

    // The tiles, the note, the count line and the footnote.
    expect(tile(html, "DEX volume")).toEqual({ value: "991K XRP", sub: "last 24 hours, pairs listed" });
    expect(tile(html, "Pairs shown")).toEqual({ value: "40", sub: "of 157 with trades" });
    expect(tile(html, "AMM share of volume")).toEqual({ value: "12%", sub: "swaps against AMM pools" });
    expect(text).toContain("Figures cover Oct 16, 17:00 to Oct 17, 17:01 UTC: the 24 hours from the start of an hour, recomputed every minute.");
    expect(elementText(html, "markets__count")).toBe("40 pairs, by volume, largest first");
    expect(html).toMatch(/<p role="status" class="markets__count"/);
    expect(text).toContain("Pairs with at least 10 trades in the period. Volume in XRP: the XRP side of pairs against XRP, other pairs at the period's rate.");
    expect(text).toContain("Prices are counter per base.");
  });

  it("leaves out what only a script can do: the text filter and the sort buttons; the headers say the order with aria-sort", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/markets");
    expect(html).not.toContain("Filter by currency or issuer");
    expect(html).not.toContain('class="markets__sort"');
    expect(html).toMatch(/role="columnheader" aria-sort="descending"[^>]*>Volume \(XRP\)</);
    expect((html.match(/aria-sort="none"/g) ?? []).length).toBe(3);
    // The filters are links, the view's own marked: the views are URLs.
    // (The header's network switch marks XRPL the same way: it links to the home page.)
    const current = anchors(html).filter((a) => /aria-current="true"/.test(a.attrs) && /href="\/xrpl\/markets/.test(a.attrs));
    expect(current.map((a) => a.text)).toEqual(["24 h", "All", "All"]);
    expect(current.every((a) => /href="\/xrpl\/markets"/.test(a.attrs))).toBe(true);
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/xrpl/markets?period=7d", "/xrpl/markets?quote=usd", "/xrpl/markets?trades=amm"]));
  });

  it("is a page of the section: the header marks Markets as the current page", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/markets?period=7d");
    expect(html).toMatch(/<a class="nav-item is-current" aria-current="page" href="\/xrpl\/markets"/);
  });

  it("has no AMM column on Xahau, and its AMM tile says why", async () => {
    mock = mockUpstream("xahau");
    const { response, html, text } = await render("/xahau/markets");
    expect(response.status).toBe(200);

    const rows = pairRows(html);
    expect(rows[0]!.map(withoutArrow)).toEqual(["#", "Pair", "Last price", "Change", "Low – high", "Volume (XAH)", "Trades", "7 days"]);
    expect(rows).toHaveLength(12);
    expect(tile(html, "AMM share of volume")).toEqual({ value: "—", sub: "Xahau has no AMM" });
    expect(text).toContain("Trades on the Xahau DEX. Xahau has no AMM, so every trade is an order-book crossing.");
    expect(html).not.toContain("AMM share</span>");
    expect(html).not.toContain('class="meter');
    // No Trades filter on Xahau.
    expect(html).not.toContain("?trades=");
  });

  it("says when the data API has no set yet, and leaves the tiles out", async () => {
    mock = mockUpstream("xahau", { "GET /v2/network/markets?limit=1000&period=30day": { result: "success", period: "30day", count: 0, markets: [] } });
    const { response, html, text } = await render("/xahau/markets?period=30d");

    expect(response.status).toBe(200);
    expect(text).toContain("No market figures yet for this period. The data API computes them every five minutes.");
    expect(tileLabels(html)).toEqual([]);
    expect(pairRows(html)).toHaveLength(1);
    expect(text).not.toContain("Figures cover");
  });
});

// ---- AMM_DATA off ------------------------------------------------------------------------------------------------------------------------

describe("the page with AMM_DATA off (the route's loader, with a load context of its own)", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const run = (path: string) =>
    loader({
      request: new Request(`https://explorer.test${path}`),
      params: { net: "xrpl" },
      context: createLoadContext({ ...(env as unknown as Env), AMM_DATA: "off" }, ctx),
    } as never);

  it("has no AMM tile, no AMM column and no Trades filter, and its intro claims no swaps", async () => {
    mock = mockUpstream("xrpl");
    const result = (await run("/xrpl/markets")) as { data: MarketsPageData; init: ResponseInit | null };
    const page = result.data;

    expect(page.ammColumn).toBe(false);
    expect(page.tiles?.map((t) => t.label)).toEqual(["DEX volume", "Trades", "Pairs shown"]);
    expect(page.rows.every((row) => row.amm === null)).toBe(true);
    expect(page.filters.trades).toBeNull();
    expect(page.intro).toBe("Trades on the XRP Ledger DEX.");
    expect(new Headers(result.init?.headers).get("X-Cache-Class")).toBe("minute");
  });

  it("redirects ?trades=amm away, before any call: the filter is not a parameter there", async () => {
    mock = mockUpstream("xrpl");
    const response = (await run("/xrpl/markets?trades=amm&period=7d")) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/markets?period=7d");
    expect(response.headers.get("X-Cache-Class")).toBe("short");
    expect(mock.requests).toEqual([]);
  });
});
