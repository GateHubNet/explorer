import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { USD_ISSUER } from "../../app/domain/network-params";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import xahauLastValidated from "../fixtures/http/xahau/data-api/last_validated.json";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The network page, `/{net}/network`, on the real Worker against the recorded and generated answers of the data API (test/fixtures/http/): the
// class it is stored under, the redirects that make one URL of a view, what a failed call does to the page, and the page without JavaScript.
// What the page asks the data API for is test/worker/network-calls.spec.ts (a file of its own, because it counts calls that are not yet in the
// cache), and what is held when a call fails is network-hold.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file, so the tests that fail a call come first and a failed page is
// never stored. But the calls of one network that every view shares (`last_validated`, the fees list, `fee_stats`, the validations of the newest
// ledger) are kept for 2 s and 5 s of the real clock, whatever `Date` says, and a test that fails one of them would find an earlier test's
// copy and never reach its override. So the subrequest cache is read as empty for the whole file (`beforeEach` below): every call reaches the
// mock, and the pages are still stored and served by the edge cache as they are. `Date` alone is faked and moved 31 s on after each test,
// past the failure hold (the holds are per isolate, and a key held by one test must not be the next test's).

const { get, storedAs } = pageClient("198.51.104");

let mock: UpstreamMock | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

beforeEach(() => {
  // The subrequest cache reads nothing (see above); the edge cache is the one under test.
  const match = caches.default.match.bind(caches.default);
  vi.spyOn(caches.default, "match").mockImplementation((request, options) => {
    const url = request instanceof Request ? request.url : String(request);
    return url.startsWith("https://subrequest-cache.invalid/") ? Promise.resolve(undefined) : match(request, options);
  });
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

/** What a tile of the totals says: its figure, its change and its note (`null` where it has none). */
function tile(html: string, label: string) {
  const tiles = [...html.matchAll(/<div class="stat stat--figure">([\s\S]*?)<\/div>/g)].map((match) => match[1]!);
  const chunk = tiles.find((tileHtml) => elementText(tileHtml, "stat__label") === label);
  expect(chunk, `no tile ${label}`).toBeDefined();
  return {
    value: elementText(chunk!, "stat__value") ?? null,
    delta: elementText(chunk!, "stat__delta") ?? null,
    sub: elementText(chunk!, "stat__sub") ?? null,
  };
}

/** How many errors the page shows (each `SectionError` is an alert). */
const alerts = (html: string) => (html.match(/role="alert"/g) ?? []).length;

const unavailable = () => dataApiError(503, "unavailable");

// ---- The calls the tests fail, by the keys the mock names them (spec 1.4; the dates are the recorded `last_validated`'s) -----------------------

const LAST_VALIDATED = "GET /v2/last_validated";
const FEES_LIST = "GET /v2/network/fees?descending=true&limit=8";
const XRPL_VALIDATIONS = "GET /v2/ledgers/68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092/validations?limit=1000";
const FEE_STATS = "GET /v2/network/fee_stats?descending=true&limit=1&start=2026-10-17";
const USD = `&exchange_currency=USD&exchange_issuer=${USD_ISSUER}`;

// ---- Failures first ---------------------------------------------------------------------------------------------------------------------

describe("a call the page cannot be built without", () => {
  it("answers 503 with Retry-After, and does not store it, when last_validated fails", async () => {
    mock = mockUpstream("xahau", { [LAST_VALIDATED]: unavailable() });
    const { response } = await render("/xahau/network");

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored("/xahau/network")).toBe(false);
    // Nothing else was asked: without the anchor there is no window to ask for.
    expect(mock.requests.map((request) => request.key)).toEqual([LAST_VALIDATED]);
  });

  it("answers 503 when the fees list fails, once every other call has settled", async () => {
    mock = mockUpstream("xahau", { [FEES_LIST]: unavailable() });
    const { response } = await render("/xahau/network");

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored("/xahau/network")).toBe(false);
    // The loader waited for the others (none runs on behind an answered request): the stats and the volumes were asked for and answered.
    const answered = mock.requests.filter((request) => request.status === 200).map((request) => request.key);
    expect(answered).toEqual(
      expect.arrayContaining([
        "GET /v2/network/fee_stats?descending=true&limit=1&start=2026-10-17",
        "GET /v2/stats/type?end=2026-10-17&interval=day&limit=1000&start=2026-09-18",
        "GET /v2/network/payment_volume?end=2026-10-17&interval=day&limit=1000&start=2026-08-18",
        "GET /v2/network/exchange_volume?end=2026-10-17&interval=day&limit=1000&start=2026-09-18",
      ]),
    );
  });

  it.each([
    ["a close time that is not a time", { close_time: "yesterday" }],
    ["a ledger index that is not a number", { ledger_index: "latest" }],
  ])("answers 503, and not 500, when last_validated has %s: no window can be worked out from it", async (_what, broken) => {
    mock = mockUpstream("xahau", { [LAST_VALIDATED]: { ...xahauLastValidated, ...broken } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { response } = await render("/xahau/network?period=7d");

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored("/xahau/network?period=7d")).toBe(false);
    expect(mock.requests.map((request) => request.key)).toEqual([LAST_VALIDATED]);
    expect(errors.mock.calls.some(([line]) => String(line).includes("the network page has no anchor"))).toBe(true);
  });
});

describe("a call that is one card of the page", () => {
  /** A degraded page: 200, never kept by the browser or the edge. */
  async function expectDegraded(path: string, response: Response) {
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
  }

  it("fails the validators card alone when the validations fail (#4)", async () => {
    mock = mockUpstream("xrpl", { [XRPL_VALIDATIONS]: unavailable() });
    const path = "/xrpl/network?period=7d";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the validators.");
    expect(alerts(html)).toBe(1);
    // The rest of the page is there.
    expect(text).toContain("Open ledger fee 10 drops");
    expect(text).toContain("Transactions by type, per day");
    expect(tile(html, "Transactions").value).not.toBe("—");
  });

  it("fails the open ledger block alone when fee_stats fails (#5), and leaves the last sentence out of the fee note", async () => {
    mock = mockUpstream("xrpl", { [FEE_STATS]: unavailable() });
    const path = "/xrpl/network";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the open ledger.");
    expect(alerts(html)).toBe(1);
    expect(text).not.toContain("Open ledger fee");
    expect(text).toContain("1 XRP = 1,000,000 drops. Spikes mean the open ledger was busy.");
    expect(text).not.toContain("The minimum to enter the queue");
    // The strip is the fees list's, not fee_stats'.
    expect(text).toContain("#107,721,455");
  });

  it("fails the transactions by type card alone when stats/type fails (#6)", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/stats/type?end=2026-10-17&interval=day&limit=1000&start=2026-10-11": unavailable() });
    const path = "/xrpl/network?period=7d";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load transactions by type.");
    expect(alerts(html)).toBe(1);
    // In place of the plot and its toggle: the card has no radios, the other three charts do.
    expect((html.match(/type="radio"/g) ?? []).length).toBe(6);
    expect(tile(html, "Transactions").value).not.toBe("—");
  });

  it("dashes the four tiles of stats/metric and says so once when it fails (#7)", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/stats/metric?end=2026-10-17&interval=day&limit=1000&metrics=accounts_created,ledger_count,transaction_count&start=2026-04-20": unavailable(),
    });
    const path = "/xrpl/network?period=90d";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    for (const label of ["Transactions", "Ledger interval", "Transactions per ledger", "Accounts created"]) {
      expect(tile(html, label), label).toMatchObject({ value: "—", sub: "Couldn’t load" });
    }
    expect(text.match(/Couldn’t load some totals\./g)).toHaveLength(1);
    expect(alerts(html)).toBe(1);
    // The tiles of the volumes are another call's.
    expect(tile(html, "Payment volume").value).not.toBe("—");
    expect(tile(html, "DEX volume").value).not.toBe("—");
  });

  it("fails the average fee card alone when the daily fees fail (#8)", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/network/fees?end=2026-10-17&interval=day&limit=1000&start=2025-10-20": unavailable() });
    const path = "/xrpl/network?period=1y";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the average fee.");
    expect(alerts(html)).toBe(1);
    expect(text).toContain("Transactions by type, per week");
  });

  it("dashes the payment tile and fails the volume and by-currency cards when the payment volume fails (#9)", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/network/payment_volume?end=2026-10-17${USD}&interval=day&limit=1000&start=2026-10-03`]: unavailable() });
    const path = "/xrpl/network?period=7d&in=usd";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(tile(html, "Payment volume")).toMatchObject({ value: "—", sub: "Couldn’t load" });
    expect(tile(html, "DEX volume").value).not.toBe("—");
    expect(text).toContain("Couldn’t load payment and DEX volume.");
    expect(text).toContain("Couldn’t load payment volume by currency.");
    expect(text).toContain("Couldn’t load some totals.");
    expect(alerts(html)).toBe(3);
  });

  it("dashes the DEX tile and fails the volume card when the exchange volume fails (#10)", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/network/exchange_volume?end=2026-10-17${USD}&interval=day&limit=1000&start=2026-09-18`]: unavailable() });
    const path = "/xrpl/network?in=usd";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(tile(html, "DEX volume")).toMatchObject({ value: "—", sub: "Couldn’t load" });
    expect(tile(html, "Payment volume").value).not.toBe("—");
    expect(text).toContain("Couldn’t load payment and DEX volume.");
    expect(text).not.toContain("Couldn’t load payment volume by currency.");
    expect(alerts(html)).toBe(2);
  });

  it("draws the volume card without the AMM line, says so, and holds the failure when amm_volume has no route (#11)", async () => {
    // `null` is the fixture server's answer to a path the API has no route for: the framework's "Cannot GET" 404, which is an outage.
    const amm = `GET /v2/network/amm_volume?end=2026-10-17${USD}&interval=day&limit=1000&start=2026-07-20`;
    mock = mockUpstream("xrpl", { [amm]: null });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = "/xrpl/network?period=90d&in=usd";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("AMM swaps couldn’t be loaded.");
    expect(alerts(html)).toBe(1);
    // The DEX tile does not claim the AMM total, and the card still draws the lines it has (Payments, DEX trades).
    expect(tile(html, "DEX volume").sub).toBe("tracked markets, AMM swaps included; to Oct 16; Oct 17 not computed yet");
    expect(text).toContain("DEX trades, tracked markets, AMM swaps included");
    expect(text).not.toContain("AMM swaps, all pools");
    // It was logged (the answer was marked degraded for the edge: `no-store` and not stored, above).
    expect(errors.mock.calls.some(([line]) => String(line).includes("the network page's amm could not be loaded"))).toBe(true);

    // A second render a moment later does not ask the API for the route again: the failure is held.
    const second = await render(path);
    expect(second.response.status).toBe(200);
    expect(second.text).toContain("AMM swaps couldn’t be loaded.");
    expect(statusesOf(mock, amm)).toEqual([404]);
  });

  it("gives up on a card that has not answered in 4.5 s, and answers 200 all the same (#6 that never answers)", async () => {
    const types = "GET /v2/stats/type?end=2026-10-17&interval=week&limit=1000&start=2025-10-20";
    mock = mockUpstream("xahau", { [types]: () => new Promise<Response>(() => {}) });
    const path = "/xahau/network?period=1y";
    const started = performance.now();
    const { response, html, text } = await render(path);
    const took = performance.now() - started;

    await expectDegraded(path, response);
    // The card's deadline, 4.5 s after the loader began; the data API client would have given up at 5 s.
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(text).toContain("Couldn’t load transactions by type.");
    expect(alerts(html)).toBe(1);
    // The rest of the page was not held up behind it.
    expect(tile(html, "Payment volume").value).not.toBe("—");
  }, 15_000);
});

// ---- The class ---------------------------------------------------------------------------------------------------------------------------

describe("the class of the page", () => {
  it("stores /xahau/network and its .data URL as live-home, kept 1 s, and the .data URL answers the page and not a redirect", async () => {
    mock = mockUpstream("xahau");
    const { response, text } = await render("/xahau/network");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(text).toContain("Xahau network");
    expect(await storedAs("/xahau/network")).toEqual({ cls: "live-home", ttl: 1 });

    // The route's own request of an open page: React Router adds `_routes`, which is no part of the view.
    const dataPath = "/xahau/network.data?_routes=routes%2Fnet.network";
    const data = await get(dataPath);
    const body = await data.text();
    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(data.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(dataPath)).toEqual({ cls: "live-home", ttl: 1 });
    // The build the Worker is of, so that an open page of an older build can tell, and the ledger the page is at.
    expect(body).toContain("test-build");
    expect(body).toContain("26596843");
    expect(body).not.toContain('"origin"');
  });
});

// ---- Redirects -----------------------------------------------------------------------------------------------------------------------------

describe("the query of the URL", () => {
  it.each([
    ["/xrpl/network?period=30d", "/xrpl/network"],
    ["/xrpl/network?in=usd&period=1y", "/xrpl/network?period=1y&in=usd"],
    ["/xahau/network?in=usd", "/xahau/network"],
    ["/xrpl/network?x=1", "/xrpl/network"],
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

  it("tidies the .data URL of an open page the same way: a redirect for React Router to follow, and the page for a view that is canonical", async () => {
    mock = mockUpstream("xrpl");
    // `_routes` is React Router's own pair, wherever it stands in the query: it is no part of the view.
    const tidied = await get("/xrpl/network.data?_routes=routes%2Fnet.network&period=30d");
    const redirect = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(redirect).toContain("SingleFetchRedirect");
    expect(redirect).toContain("/xrpl/network");
    expect(mock.requests).toEqual([]);

    const year = await get("/xrpl/network.data?period=1y&in=usd&_routes=routes%2Fnet.network");
    const body = await year.text();
    expect(year.status).toBe(200);
    expect(body).toContain("routes/net.network");
    expect(body).toContain("USD");
  });

  it("is a 404 for a network that does not exist, before any call", async () => {
    mock = mockUpstream("xrpl");
    const { response } = await render("/bitcoin/network?period=1y");
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

// ---- The page ------------------------------------------------------------------------------------------------------------------------------

describe("the page without JavaScript", () => {
  it("holds the columns, the lines, the area, the tables, the radios and the running day, in the HTML", async () => {
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/network");

    expect(response.status).toBe(200);
    // 30 days of columns; four lines (the fee and three of volume) and one area.
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
    expect((html.match(/<path class="line"/g) ?? []).length).toBe(4);
    expect((html.match(/<path class="area"/g) ?? []).length).toBe(1);
    // Both views of each chart, and the radios that swap them without a script.
    expect((html.match(/class="chart__table"/g) ?? []).length).toBe(4);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(8);
    const rows = tableRows(html, "Transactions by type, per day");
    expect(rows).toHaveLength(31);
    expect(rows[0]![0]).toBe("Day (UTC)");
    expect(rows[1]![0]).toBe("Oct 17, 2026, so far");
    expect(rows[30]![0]).toBe("Sep 18, 2026");
    // The running day, in the tables of the other charts too.
    expect(tableRows(html, "Average fee per transaction, in drops")[1]![0]).toBe("Oct 17, 2026, so far");
    expect(text).toContain("Oct 17, 2026, so far");
    // The volumes have no row for it yet: a gap, and the card says so.
    expect(text).toContain("Oct 17 is not computed yet.");
  });

  it("is a page of the section: the header marks Network as the current page", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/network?period=7d");
    const network = anchors(html).filter((a) => /href="\/xrpl\/network"/.test(a.attrs));
    expect(network.map((a) => a.text)).toContain("Network");
    expect(network.some((a) => /aria-current="page"/.test(a.attrs) && /is-current/.test(a.attrs))).toBe(true);
  });

  it("says the totals, the strip and the validators of the recording", async () => {
    mock = mockUpstream("xrpl");
    const { html, text } = await render("/xrpl/network?period=7d");

    expect(text).toContain("Totals and charts cover the 7 days from Oct 11 to Oct 17, 2026 (UTC), today so far");
    expect(elementText(html, "network__signed")).toMatch(/^35 validators signed ledger #107,721,455$/);
    expect(text).toContain("#107,721,455 107 txs");
    expect(text).toContain("Open ledger fee 10 drops Queue 0 · 84 of 96 expected in the open ledger as of 17:01:10 UTC");
    // `VALIDATORS` is off until E6 builds its pages: the link is the header's "soon" style.
    expect(text).toContain("All validators soon");
    expect(anchors(html).some((a) => /\/validators/.test(a.attrs))).toBe(false);
  });

  it("is Xahau's on Xahau: no choice of currency, the order-book wording", async () => {
    mock = mockUpstream("xahau");
    const { text } = await render("/xahau/network?period=7d");
    expect(text).not.toContain("Amounts in");
    expect(text).toContain("order book only, no AMM on Xahau");
    expect(text).toContain("Xahau has no AMM; DEX trades are order-book trades of the markets the data API tracks.");
    expect(text).toContain("1 XAH = 1,000,000 drops.");
  });

  it("is in USD on request, and says whose USD", async () => {
    mock = mockUpstream("xrpl");
    const { text } = await render("/xrpl/network?period=7d&in=usd");
    expect(text).toContain("amounts in USD issued by GateHub at each day's DEX rate");
    expect(text).toContain("Volume per day, in USD");
  });
});

describe("the tags of the page", () => {
  const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
  const robotsOf = (html: string) => /<meta name="robots" content="([^"]*)"/.exec(html)?.[1];

  it("has a canonical URL and sharing tags on the default view, and no image", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/network");
    expect(titleOf(html)).toBe("XRPL network · explorer");
    expect(html).toContain('<link rel="canonical" href="https://explorer.test/xrpl/network"');
    expect(html).toContain('<meta property="og:url" content="https://explorer.test/xrpl/network"');
    expect(html).toContain('<meta name="twitter:card" content="summary"');
    expect(html).not.toContain("og:image");
    expect(robotsOf(html)).toBeUndefined();
  });

  it("is noindex, follow on the 90 days in USD, without a canonical URL or sharing tags", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/network?period=90d&in=usd");
    expect(titleOf(html)).toBe("XRPL network · last 90 days · in USD · explorer");
    expect(robotsOf(html)).toBe("noindex, follow");
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("og:title");
    expect(html).not.toContain("twitter:card");
  });
});
