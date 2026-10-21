import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loader } from "../../app/routes/net.amm._index";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration, createLoadContext, type Env } from "../../app/server/env";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { cold, entryOf, keptFor, storedEntries } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The AMM pools list, `/{net}/amm` (AMM spec 1.2, 1.3, 2 and 4), on the real Worker against the generated AMM answers of the data API
// (test/fixtures/http/xrpl/data-api/amm/pools@…, network/amm_volume@…): what a failed call does to it, the 404s of a page behind a marker, the
// class each answer is stored under, the calls of a view and how long each is kept, the filter, Xahau's page and the redirects that make one URL
// of a view. The off-case of `AMM_PAGES` is amm-off.spec.ts (the `worker-off` project).
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included (`last_validated` 2 s, the
// pools and the live set 60 s, the 30 days 300 s), and an error or a degraded page is never stored. So the tests that fail a call come first, each
// on a view that no later test reads, and every test takes the subrequest entries away (`cold`, test/support/subrequest-miss.ts): each call of a render reaches the mock, so an
// override is always the answer and a list of calls does not depend on the order of the tests. The page does not poll, so no call asks for the
// failure hold; `Date` alone is faked all the same and moved 301 s on after each test, past the longest keep (the edge cache's freshness reads
// `Date`), so that no test reads what an earlier one left. The afterEach below fails a test whose override no request used.

const { get, stored, storedAs } = pageClient("198.18.50");

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

/** Whether the head says `noindex, follow`, and has no canonical URL. */
function isNoindex(html: string): boolean {
  return /<meta name="robots" content="noindex, follow"\/?>/.test(html) && !/<link rel="canonical"/.test(html);
}

/** The three tiles of the totals: each one's label and figure. */
function tiles(html: string) {
  return [...html.matchAll(/<div class="stat stat--figure">([\s\S]*?)<\/div>/g)].map((match) => ({
    label: elementText(match[1]!, "stat__label"),
    value: elementText(match[1]!, "stat__value"),
  }));
}

/** The rows of the Pools table, the header first, as arrays of cell texts. */
const poolRows = (html: string) => tableRows(html, "Pools");
/** The Volume 24 h cell of each pool (the fifth column). */
const volumes = (html: string) => poolRows(html).slice(1).map((row) => row[4]);

// ---- The calls, by the keys the mock names them (its query sorted by name) ----------------------------------------------------------------------

const LAST_VALIDATED = "GET /v2/last_validated";
/** #2, the first page of every pool: the key of the default view. */
const POOLS = "GET /v2/amm/pools?limit=20";
/** #3: the live set of the last 24 hours. */
const LIVE = "GET /v2/network/amm_volume?live=day";
/** #4: the 30 days up to the recorded ledger's day (Oct 17, 2026), the network page's call. */
const MONTH = "GET /v2/network/amm_volume?end=2026-10-17&interval=day&limit=1000&start=2026-09-18";

/** The subrequest keys of #1 and #4, as the client writes them (data-api.ts: the URL, then the TTL the caller asked for). */
const API_BASE = "https://xrpl.data.example.invalid";
const LAST_VALIDATED_ENTRY = `GET ${API_BASE}/v2/last_validated [kept 2 s]`;
const MONTH_ENTRY = `GET ${API_BASE}/v2/network/amm_volume?interval=day&start=2026-09-18&end=2026-10-17&limit=1000 [kept 300 s]`;

/** The markers of the pages of the generated list, the second page first (each page's `marker` leads to the next). */
const SECOND = "WzExNTE4LjA3NjI3OCwick1mREZOVDRCU1J4b0EySGIzam9SQWNGOVFZc1pRSk03SiJd";
const THIRD = "WzYzNy4yMTY0MTQsInJOQjJaY1czOHN3WkJuRnVSNE11cEVrcjFKWWZWOGV5RHkiXQ";
const FOURTH = "W251bGwsInI5cnkycUxvR2lWTTM2ODlMN2JmRU0zU3NFTExiYkRLdm4iXQ";
const FIFTH = "W251bGwsInJKRVZ1NzF6RVpKNzRUdW1LdGNnZkJRZGNFd2lRUHpxaWQiXQ";

const RLUSD = "RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const SNK = "SNK.rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm";

// ---- Failures first, each on a view no later test reads ---------------------------------------------------------------------------------------

describe("a call that fails (spec 2.5)", () => {
  it("draws dashes under the tiles with one SectionError, and the Volume column as dashes with a note, when the live set fails (#3, a 503)", async () => {
    cold();
    mock = mockUpstream("xrpl", { [LIVE]: unavailable() });
    const path = "/xrpl/amm?asset=XRP";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, LIVE)).toEqual([503]);
    expect(tiles(html)).toEqual([
      { label: "Swap volume, 24 h", value: "—" },
      { label: "Pools with swaps, 24 h", value: "—" },
      { label: "Busiest pool, 24 h", value: "—" },
    ]);
    expect(text).toContain("Couldn’t load the 24-hour figures.");
    // The table is there, its Volume column has no figure to show, and the card says why.
    expect(poolRows(html)).toHaveLength(21);
    expect(new Set(volumes(html))).toEqual(new Set(["—"]));
    expect(text).toContain("Couldn’t load the 24-hour volume");
    expect((html.match(/role="alert"/g) ?? []).length).toBe(1);
  });

  it("does the same, and logs that the data API serves no AMM volume, for an API without the route (its 'Cannot GET' 404)", async () => {
    cold();
    // `null` is the fixture server's answer to a path the API has no route for: the framework's "Cannot GET" 404, which is an outage.
    mock = mockUpstream("xrpl", { [LIVE]: null });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/amm?asset=${RLUSD}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, LIVE)).toEqual([404]);
    expect(tiles(html).map((tile) => tile.value)).toEqual(["—", "—", "—"]);
    expect(text).toContain("Couldn’t load the 24-hour figures.");
    expect(poolRows(html)).toHaveLength(5);
    expect(new Set(volumes(html))).toEqual(new Set(["—"]));
    expect(text).toContain("Couldn’t load the 24-hour volume");
    const lines = errors.mock.calls.map(([line]) => String(line));
    const logged = lines.filter((line) => line.includes("the data API serves no AMM volume"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("Cannot GET /v2/network/amm_volume");
    // Nothing of the error is in the page, whose data goes to the browser as well.
    expect(html).not.toContain("Cannot GET");
  });

  it("draws the Pools card as a SectionError, with the rest of the page, when the pools fail (#2, a 503)", async () => {
    cold();
    // The deleted pools included: a view no later test reads (the first page's own key is the default view's, which the tests below store).
    const key = "GET /v2/amm/pools?include_deleted=true&limit=20";
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = "/xrpl/amm?deleted=1";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key)).toEqual([503]);
    expect(text).toContain("Couldn’t load the pools.");
    expect(poolRows(html)).toEqual([]);
    // The card keeps its title and source line; the tiles and the chart are drawn.
    expect(text).toContain("/v2/amm/pools · ordered by value");
    expect(tiles(html).map((tile) => tile.value)).not.toContain("—");
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
    expect((html.match(/role="alert"/g) ?? []).length).toBe(1);
    // Logged under the card's name, with the error itself.
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the AMM pools page's pools could not be loaded"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("data API GET /v2/amm/pools?limit=20&include_deleted=true answered 503");
  });

  it("draws the Pools card as a SectionError, never a stored 404, when the API refuses the first page (#2, a 400 with no marker)", async () => {
    cold();
    const key = "GET /v2/amm/pools?asset=XRP&include_deleted=true&limit=20";
    mock = mockUpstream("xrpl", { [key]: dataApiError(400, "invalid asset") });
    const path = "/xrpl/amm?asset=XRP&deleted=1";
    const { response, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key)).toEqual([400]);
    expect(text).toContain("Couldn’t load the pools.");
  });

  it("draws the chart card as a SectionError when the 30 days fail (#4, a 503)", async () => {
    cold();
    mock = mockUpstream("xrpl", { [MONTH]: unavailable() });
    const path = `/xrpl/amm?marker=${THIRD}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, MONTH)).toEqual([503]);
    expect(text).toContain("Couldn’t load the swap volume.");
    expect(text).toContain("AMM swap volume per day, in XRP, last 30 days");
    expect((html.match(/class="col"/g) ?? []).length).toBe(0);
    expect(poolRows(html)).toHaveLength(21);
    expect((html.match(/role="alert"/g) ?? []).length).toBe(1);
  });

  it("draws the chart card as a SectionError, and does not ask for the 30 days, when last_validated fails (#1, a 503)", async () => {
    cold();
    mock = mockUpstream("xrpl", { [LAST_VALIDATED]: unavailable() });
    const path = `/xrpl/amm?marker=${FOURTH}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
    expect(keysOf(mock.requests)).not.toContain(MONTH);
    expect(keysOf(mock.requests).filter((key) => key.startsWith("GET /v2/network/amm_volume?") && key !== LIVE)).toEqual([]);
    expect(text).toContain("Couldn’t load the swap volume.");
    expect(poolRows(html)).toHaveLength(21);
    expect(tiles(html).map((tile) => tile.value)).not.toContain("—");
    expect((html.match(/role="alert"/g) ?? []).length).toBe(1);
  });
});

describe("a card that has not answered (spec 2.3)", () => {
  it("gives up on the live set 4.5 s after the loader began, logs that it took too long, and answers 200 all the same, not stored", async () => {
    cold();
    mock = mockUpstream("xrpl", { [LIVE]: () => new Promise<Response>(() => {}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/amm?marker=${FIFTH}`;
    const started = performance.now();
    const { response, html, text } = await render(path);
    const took = performance.now() - started;

    await expectDegraded(path, response);
    // The card's deadline; the data API client would have given up at 5 s.
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(tiles(html).map((tile) => tile.value)).toEqual(["—", "—", "—"]);
    expect(text).toContain("Couldn’t load the 24-hour figures.");
    expect(new Set(volumes(html))).toEqual(new Set(["—"]));
    expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the AMM pools page's totals took too long"))).toHaveLength(1);
  }, 15_000);
});

describe("a page behind a marker that is not there (spec 1.3)", () => {
  it("is a 404 of class short when the API refuses the marker (a 400)", async () => {
    cold();
    const key = "GET /v2/amm/pools?limit=20&marker=AAAA";
    mock = mockUpstream("xrpl", { [key]: dataApiError(400, "invalid marker") });
    const path = "/xrpl/amm?marker=AAAA";
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, key)).toEqual([400]);
    expect(text).toContain("that page of the AMM pools");
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 of class short when nothing is behind the marker", async () => {
    cold();
    const key = "GET /v2/amm/pools?limit=20&marker=BBBB";
    mock = mockUpstream("xrpl", { [key]: { result: "success", count: 0, pools: [] } });
    const path = "/xrpl/amm?marker=BBBB";
    const { response } = await render(path);

    expect(response.status).toBe(404);
    expect(statusesOf(mock, key)).toEqual([200]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 of class short, before any call and before any redirect, for a marker that is not one", async () => {
    mock = mockUpstream("xrpl");
    for (const path of ["/xrpl/amm?marker=%25", "/xrpl/amm?back=AAAA&marker=%25&x=1"]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the AMM pools");
      expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
    }
    expect(mock.requests).toEqual([]);
  });
});

// ---- The class, the calls and the page --------------------------------------------------------------------------------------------------------

describe("the first page", () => {
  it("is stored as live (5 s) and makes exactly the four calls of spec 2.2, the kept ones under the home and network pages' keys", async () => {
    cold();
    const kept = storedEntries();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/amm");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs("/xrpl/amm")).toEqual({ cls: "live", ttl: 5 });
    expect([...keysOf(mock.requests)].sort()).toEqual([LAST_VALIDATED, POOLS, LIVE, MONTH].sort());
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    // #1 is kept 2 s under the home page's key, #4 300 s under the network page's 30-day key; #2 and #3 are E3's class `minute`, 60 s.
    expect(await keptFor(kept, LAST_VALIDATED_ENTRY)).toBe("public, max-age=2");
    expect(await keptFor(kept, MONTH_ENTRY)).toBe("public, max-age=300");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/amm/pools?limit=20`)).toBe("public, max-age=60");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/network/amm_volume?live=day`)).toBe("public, max-age=60");

    // The table of 20 pools, the header first, and the link to the next page.
    expect(poolRows(html)).toHaveLength(21);
    expect(poolRows(html)[0]).toEqual(["Pool", "Value (XRP)", "Reserves", "Fee", "Volume 24 h", "Auction slot", "Created"]);
    const more = anchors(html).filter((a) => a.text === "More pools");
    expect(more.map((a) => /href="([^"]*)"/.exec(a.attrs)?.[1])).toEqual([`/xrpl/amm?marker=${SECOND}`]);
    expect(anchors(html).some((a) => a.text === "Previous")).toBe(false);
    // The tiles of the live set, and the head of the list, indexable.
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Swap volume, 24 h", "Pools with swaps, 24 h", "Busiest pool, 24 h"]);
    expect(tiles(html).map((tile) => tile.value)).not.toContain("—");
    expect(text).toContain("As of 17:01 UTC.");
    expect(html).toContain('<link rel="canonical" href="https://explorer.test/xrpl/amm"/>');
    expect(isNoindex(html)).toBe(false);
    expect((html.match(/role="alert"/g) ?? []).length).toBe(0);
  });

  it("asks for the 30 days with the network page's own call: its 30-day view looks up the same entry, as it does last_validated's", async () => {
    const { looked } = cold();
    mock = mockUpstream("xrpl");
    expect((await render("/xrpl/amm?asset=XRP&marker=AAAA")).response.status).toBe(200);
    const list = [...looked];
    expect(list).toHaveLength(4);
    looked.length = 0;
    // The network page's default view is its 30 days.
    expect((await render("/xrpl/network")).response.status).toBe(200);
    const shared = list.filter((entry) => looked.includes(entry));
    expect(shared.sort()).toEqual([await entryOf(LAST_VALIDATED_ENTRY), await entryOf(MONTH_ENTRY)].sort());
  });

  it("holds the chart's columns and its table in the HTML, without JavaScript, the running day marked so far", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/amm");

    expect(response.status).toBe(200);
    // 30 days, one column a day.
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
    const rows = tableRows(html, "AMM swap volume per day, in XRP, last 30 days");
    expect(rows).toHaveLength(31);
    expect(rows[1]![0]).toBe("Oct 17, 2026, so far");
    expect(rows[30]![0]).toBe("Sep 18, 2026");
    expect(text).toContain("/v2/network/amm_volume?interval=day");
    // The filter is a GET form to the list, which works without a script.
    expect(html).toMatch(/<form [^>]*action="\/xrpl\/amm" method="get">/);
  });

  it("answers its .data URL with the page's data and not a redirect: React Router's _routes is no part of the view (P1)", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const dataPath = "/xrpl/amm.data?_routes=routes%2Fnet.amm._index";
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("AMM swap volume per day, in XRP, last 30 days");
    expect(await storedAs(dataPath)).toEqual({ cls: "live", ttl: 5 });
    // The browser never gets the API's answer: the rows are the view builder's, and no host or key is in them.
    expect(body).not.toContain("value_native");
    expect(body).not.toContain("data.example.invalid");
  });

  it("answers the .data URL of a page behind a marker, as the pager asks for it, with its data and not a redirect", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const dataPath = `/xrpl/amm.data?marker=${SECOND}&_routes=routes%2Fnet.amm._index`;
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(keysOf(mock.requests)).toContain(`GET /v2/amm/pools?limit=20&marker=${SECOND}`);
    // The link to the page after it, as the page's data has it.
    expect(body).toContain(`/xrpl/amm?marker=${THIRD}&back=${SECOND}`);
    expect(await storedAs(dataPath)).toEqual({ cls: "live", ttl: 5 });
  });

  it("is a page of its own behind the marker of its More pools link: live, noindex, follow, with Previous back to the first page", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm?marker=${SECOND}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toContain(`GET /v2/amm/pools?limit=20&marker=${SECOND}`);
    expect(await storedAs(path)).toEqual({ cls: "live", ttl: 5 });
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>More AMM pools · XRPL · explorer</title>");
    expect(poolRows(html)).toHaveLength(21);
    const previous = anchors(html).filter((a) => a.text === "Previous");
    expect(previous.map((a) => /href="([^"]*)"/.exec(a.attrs)?.[1])).toEqual(["/xrpl/amm"]);
    const more = anchors(html).filter((a) => a.text === "More pools");
    // The trail of the pages before it: this page's marker (`&` written as HTML writes it in an attribute).
    expect(more.map((a) => /href="([^"]*)"/.exec(a.attrs)?.[1])).toEqual([`/xrpl/amm?marker=${THIRD}&amp;back=${SECOND}`]);
  });
});

describe("the filter (spec 1.2, 1.3)", () => {
  it("asks for the pools of one asset, the deleted ones included, and tags a deleted pool", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amm?asset=${SNK}&deleted=1`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toContain("GET /v2/amm/pools?asset=SNK+rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm&include_deleted=true&limit=20");
    expect(await storedAs(path)).toEqual({ cls: "live", ttl: 5 });
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>AMM pools with SNK (deleted included) · XRPL · explorer</title>");
    const rows = poolRows(html);
    expect(rows).toHaveLength(2);
    expect(rows[1]![0]).toContain("SNK / XRP");
    expect(rows[1]![0]).toContain("Deleted");
    expect(html).toContain('<span class="tag tag--icon">');
    // The form shows the filter as the URL has it.
    expect(html).toContain(`value="${SNK}"`);
    expect(text).toContain("Include deleted pools");
  });

  it("lists the deleted pools too with ?deleted=1, page after page, the deleted SNK/XRP among the pools without a value with its Deleted tag", async () => {
    cold();
    mock = mockUpstream("xrpl");
    let path: string | undefined = "/xrpl/amm?deleted=1";
    const seen: string[] = [];
    let found: string[] | undefined;
    while (path !== undefined && found === undefined) {
      const { response, html } = await render(path);
      expect(response.status, path).toBe(200);
      expect(await storedAs(path)).toEqual({ cls: "live", ttl: 5 });
      expect(isNoindex(html)).toBe(true);
      seen.push(path);
      found = poolRows(html).find((row) => row[0]!.includes("SNK / XRP"));
      if (found !== undefined) expect(html).toContain('<span class="tag tag--icon">');
      // The pager keeps the filter.
      const next = anchors(html).find((a) => a.text === "More pools");
      path = next === undefined ? undefined : /href="([^"]*)"/.exec(next.attrs)![1]!.replace(/&amp;/g, "&");
    }
    expect(found?.[0]).toContain("Deleted");
    // A deleted pool has no value and no slot; its reserves are the index's last, emptied by the withdrawal that deleted it.
    expect(found?.slice(1, 3)).toEqual(["—", "0 SNK 0 XRP"]);
    expect(found?.[5]).toBe("—");
    expect(seen).toEqual(["/xrpl/amm?deleted=1", `/xrpl/amm?deleted=1&marker=${SECOND}`, `/xrpl/amm?deleted=1&marker=${THIRD}&back=${SECOND}`, `/xrpl/amm?deleted=1&marker=${FOURTH}&back=${THIRD}.${SECOND}`]);
    expect(keysOf(mock.requests).filter((key) => key.startsWith("GET /v2/amm/pools?"))).toEqual([
      "GET /v2/amm/pools?include_deleted=true&limit=20",
      `GET /v2/amm/pools?include_deleted=true&limit=20&marker=${SECOND}`,
      `GET /v2/amm/pools?include_deleted=true&limit=20&marker=${THIRD}`,
      `GET /v2/amm/pools?include_deleted=true&limit=20&marker=${FOURTH}`,
    ]);
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
  });

  it("says what is wrong under the field for an asset that does not parse, asks for no pools, and is short, noindex, follow", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amm?asset=nope";
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(elementText(html, "amm__error")).toBe("Write an asset as XRP, or as a currency and its issuer: RLUSD.rMxCK…");
    expect(html).toContain('value="nope"');
    expect(html).toContain('aria-invalid="true"');
    expect(keysOf(mock.requests).filter((key) => key.startsWith("GET /v2/amm/"))).toEqual([]);
    // The other calls are made: the tiles and the chart are drawn, and there is no Pools card.
    expect([...keysOf(mock.requests)].sort()).toEqual([LAST_VALIDATED, LIVE, MONTH].sort());
    expect(poolRows(html)).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>AMM pools · XRPL · explorer</title>");
  });
});

describe("Xahau (spec 1.3)", () => {
  it("is the explanation, class slow, with no call at all, noindex, follow", async () => {
    mock = mockUpstream("xahau");
    const { response, html, text } = await render("/xahau/amm");

    expect(response.status).toBe(200);
    expect(mock.requests).toEqual([]);
    expect(text).toContain("Xahau has no AMM");
    expect(text).toContain("The AMM amendment is not part of Xahau, so there are no pools to show.");
    expect(anchors(html).filter((a) => a.text === "Switch to XRPL pools").map((a) => /href="([^"]*)"/.exec(a.attrs)?.[1])).toEqual(["/xrpl/amm"]);
    expect(await storedAs("/xahau/amm")).toEqual({ cls: "slow", ttl: 3600 });
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>AMM pools · Xahau · explorer</title>");
  });

  it("redirects any query to the bare path, class short, with no call", async () => {
    mock = mockUpstream("xahau");
    const response = await get("/xahau/amm?x=1");
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xahau/amm");
    expect(mock.requests).toEqual([]);
    expect(await storedAs("/xahau/amm?x=1")).toEqual({ cls: "short", ttl: 30 });
  });
});

// ---- Redirects -----------------------------------------------------------------------------------------------------------------------------

describe("the query of the URL (spec 1.2)", () => {
  it.each([
    ["/xrpl/amm?deleted=yes", "/xrpl/amm"],
    ["/xrpl/amm?x=1", "/xrpl/amm"],
    ["/xrpl/amm?back=M", "/xrpl/amm"],
    ["/xrpl/amm?asset=", "/xrpl/amm"],
    ["/xrpl/amm?deleted=1&asset=XRP", "/xrpl/amm?asset=XRP&deleted=1"],
    ["/xrpl/amm?asset=xrp", "/xrpl/amm?asset=XRP"],
    ["/xrpl/amm?asset=usd.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", "/xrpl/amm?asset=USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"],
    // A raw `+` in a query string is a space, which `parseAssetText` reads as the separator.
    ["/xrpl/amm?asset=RLUSD+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", `/xrpl/amm?asset=${RLUSD}`],
    ["/xrpl/amm?asset=524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", `/xrpl/amm?asset=${RLUSD}`],
    // An asset that does not parse keeps its text and `deleted`, and has no page behind a marker.
    ["/xrpl/amm?asset=nope&deleted=1&marker=AAAA&back=BBBB", "/xrpl/amm?asset=nope&deleted=1"],
    ["/xrpl/amm?asset=nope+too", "/xrpl/amm?asset=nope%20too"],
    [`/xrpl/amm?back=BBBB&marker=AAAA&asset=XRP`, "/xrpl/amm?asset=XRP&marker=AAAA&back=BBBB"],
    [`/xrpl/amm?marker=AAAA&back=B%25`, "/xrpl/amm?marker=AAAA"],
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

  it("redirects the path /xrpl/AMM to /xrpl/amm, class immutable (the path alone), before any call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/AMM");
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/amm");
    expect(mock.requests).toEqual([]);
    expect(await storedAs("/xrpl/AMM")).toEqual({ cls: "immutable", ttl: 31_536_000 });
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amm.data?_routes=routes%2Fnet.amm._index&deleted=yes";
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain("/xrpl/amm");
    expect(mock.requests).toEqual([]);
    expect(tidied.headers.get("Cache-Control")).toBe("max-age=0");
    // The Cache API keeps no 202 (markets-page.spec.ts says why); the loader's own answer to that request names the class.
    expect(await stored(path)).toBeUndefined();
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    // React Router hands the loader the URL without its `.data`.
    const own = (await loader({
      request: new Request(`https://explorer.test${path}`),
      url: new URL(`https://explorer.test${path.replace(".data", "")}`),
      params: { net: "xrpl" },
      context: createLoadContext(env as unknown as Env, ctx),
    } as never)) as Response;
    expect(own.status).toBe(302);
    expect(own.headers.get("Location")).toBe("/xrpl/amm");
    expect(own.headers.get("X-Cache-Class")).toBe("short");
  });
});
