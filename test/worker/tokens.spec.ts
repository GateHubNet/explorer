import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loader } from "../../app/routes/net.tokens";
import { createLoadContext, type Env } from "../../app/server/env";
import type { TokensPageData } from "../../app/server/token-view";

import xahauList from "../fixtures/http/xahau/data-api/tokens@kind=issued&limit=20&min_holders=10.json";
import xrplList from "../fixtures/http/xrpl/data-api/tokens@kind=issued&limit=20&min_holders=10.json";
import mptHtf from "../fixtures/http/xrpl/data-api/tokens@kind=mpt&limit=20&q=HTF.json";
import mptList from "../fixtures/http/xrpl/data-api/tokens@kind=mpt&limit=20.json";
import mptSecond from "../fixtures/http/xrpl/data-api/tokens@kind=mpt&limit=20&marker=WyJtcHQiLDUsInJMbnc4YmlEa1FSWDZ3akw3ZUwxRDNpTnlSMWY1WmdxSkQiLCIwNTY1MzNGQkQxMzQzOTBEQjAzRjhEMkI1MEE2MjJDOUM5MDYzNjk3OTIwRDIwNjIiXQ.json";
import { MPT_FIXTURE_IDS } from "../support/mpt-case-rules";
import { namesCalls, withoutNames } from "../support/names";
import { expectDegraded, isNoindex, isStored, keysOf, linksTo, tiles, unavailable } from "../support/nft-pages";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { tokensMarker } from "../support/token-cases";
import { cold } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The token list, `/{net}/tokens` (token spec 1.2, 1.3, 2 and 6), on the real Worker against the generated token answers of the data API (test/fixtures/http/*/data-api/tokens@…): what a
// failed call does to it, the 404s of a page behind a marker, the class each answer is stored under, the calls of a view, the search that is too long to ask, Xahau's words and the redirects
// that make one URL of a view. The off-case of `TOKENS` is tokens-off.spec.ts (the `worker-off` project), the names of the issuers tokens-names.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included, and an error or a degraded page is never stored. So the tests that fail
// a call come first, each on a view that no later test reads (`q`, `all` and a marker tell the views apart), and every test takes the subrequest entries away (`cold`): each call of a render
// reaches the mock, so an override is always the answer and a list of calls does not depend on the order of the tests. The page does not poll, so no call asks for the failure hold; `Date`
// alone is faked all the same and moved 301 s on after each test, past the longest keep (the edge cache's freshness reads `Date`), so that no test reads what an earlier one left. The
// afterEach below fails a test whose override no request used.

const { get, page, stored, storedAs } = pageClient("198.18.95");

// A test here may ask several times whether the edge cache holds a copy it must not hold (`isStored` waits up to 2 s for each).
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

const issuedRows = (html: string) => tableRows(html, "Issued tokens");
/** The rows of the table, the header out. */
const rowsOf = (html: string) => issuedRows(html).slice(1);

// ---- The calls, by the keys the mock names them (its query sorted by name) ------------------------------------------------------------------------

/** #1 of the default view: the issued tokens with 10 or more holders. */
const LIST = "GET /v2/tokens?kind=issued&limit=20&min_holders=10";
/** #1 under `all`: without `min_holders`. */
const ALL = "GET /v2/tokens?kind=issued&limit=20";
/** #1 of a search. */
const SEARCH = (q: string) => `GET /v2/tokens?kind=issued&limit=20&min_holders=10&q=${q}`;
/** #1 behind a marker. */
const BEHIND = (marker: string) => `GET /v2/tokens?kind=issued&limit=20&marker=${marker}&min_holders=10`;

/** #1 of the MPT tab (E14 spec 4): D9's list, `kind=mpt` and no `min_holders`. */
const MPT_LIST = "GET /v2/tokens?kind=mpt&limit=20";
const MPT_SEARCH = (q: string) => `GET /v2/tokens?kind=mpt&limit=20&q=${q}`;
const MPT_BEHIND = (marker: string) => `GET /v2/tokens?kind=mpt&limit=20&marker=${marker}`;

const SHORT = { cls: "short", ttl: 30 };
const MINUTE = { cls: "minute", ttl: 60 };

/** What D6 answers for a page behind a marker that holds nothing. */
const NOTHING = { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, kind: "issued", total: 60, total_below: 40, count: 0, tokens: [] };
/** The same from D9's MPT list. */
const MPT_NOTHING = { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, kind: "mpt", total: 25, count: 0, tokens: [] };

/** The rows of the MPT tab's table, the header out. */
const mptRows = (html: string) => tableRows(html, "MPTs").slice(1);

// ---- Failures first, each on a view no later test reads ------------------------------------------------------------------------------------------

describe("a call that fails (spec 1.3)", () => {
  it("xahau: Cannot GET (a data API without D6) is a 503 that is not stored", async () => {
    cold();
    // `null` is the fixture server's answer to a path the API has no route for: the framework's "Cannot GET" 404, which is an outage and never a page.
    mock = mockUpstream("xahau", { [LIST]: null });
    const { response, text } = await render("/xahau/tokens");

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, LIST)).toEqual([404]);
    expect(text).not.toContain("Cannot GET");
    expect(await isStored("/xahau/tokens")).toBe(false);
  });

  it("xrpl: a 5xx of the list is a 503 that is not stored", async () => {
    cold();
    mock = mockUpstream("xrpl", { [ALL]: unavailable() });
    const path = "/xrpl/tokens?all=1";
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, ALL)).toEqual([503]);
    // The list is the page: nothing else was asked for, no names either.
    expect(keysOf(mock.requests)).toEqual([ALL]);
    expect(namesCalls(mock)).toEqual([]);
    expect(await isStored(path)).toBe(false);
  });

  it("is a 503 too for a 400 of the first page, where there is no marker to refuse, and for a malformed 200", async () => {
    cold();
    const bad = SEARCH("zq1");
    mock = mockUpstream("xrpl", { [bad]: dataApiError(400, "invalid request") });
    const failed = await render("/xrpl/tokens?q=zq1");
    expect(failed.response.status).toBe(503);
    expect(statusesOf(mock, bad)).toEqual([400]);
    expect(await isStored("/xrpl/tokens?q=zq1")).toBe(false);
    mock.restore();

    // A 200 that is not what D6 promises: the kind is not issued.
    const odd = SEARCH("zq2");
    mock = mockUpstream("xrpl", { [odd]: { ...NOTHING, kind: "mpt" } });
    const malformed = await render("/xrpl/tokens?q=zq2");
    expect(malformed.response.status).toBe(503);
    expect(await isStored("/xrpl/tokens?q=zq2")).toBe(false);
  });
});

describe("a call of the MPT tab that fails (E14 spec 4)", () => {
  it("a 5xx of D9's list is a 503 that is not stored, and nothing else is asked for, no names either", async () => {
    cold();
    mock = mockUpstream("xrpl", { [MPT_SEARCH("zq4")]: unavailable() });
    const path = "/xrpl/tokens?kind=mpt&q=zq4";
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, MPT_SEARCH("zq4"))).toEqual([503]);
    expect(keysOf(mock.requests)).toEqual([MPT_SEARCH("zq4")]);
    expect(namesCalls(mock)).toEqual([]);
    expect(await isStored(path)).toBe(false);
  });

  it("is a 503 for a data API without D9 (a Cannot GET), for a 400 of the first page, and for a body of the other kind", async () => {
    cold();
    mock = mockUpstream("xrpl", { [MPT_SEARCH("zq5")]: null });
    const missing = await render("/xrpl/tokens?kind=mpt&q=zq5");
    expect(missing.response.status).toBe(503);
    expect(statusesOf(mock, MPT_SEARCH("zq5"))).toEqual([404]);
    expect(missing.text).not.toContain("Cannot GET");
    expect(await isStored("/xrpl/tokens?kind=mpt&q=zq5")).toBe(false);
    mock.restore();

    mock = mockUpstream("xrpl", { [MPT_SEARCH("zq6")]: dataApiError(400, "invalid request") });
    expect((await render("/xrpl/tokens?kind=mpt&q=zq6")).response.status).toBe(503);
    mock.restore();

    // A 200 that is not what D9 promises: the issued list's kind.
    mock = mockUpstream("xrpl", { [MPT_SEARCH("zq7")]: { ...NOTHING, total_below: undefined } });
    const odd = await render("/xrpl/tokens?kind=mpt&q=zq7");
    expect(odd.response.status).toBe(503);
    expect(await isStored("/xrpl/tokens?kind=mpt&q=zq7")).toBe(false);
  });
});

describe("a page behind a marker that is not there (spec 1.3)", () => {
  it("is a 404 of class short, before any call and before any redirect, for a marker that is not one", async () => {
    mock = mockUpstream("xrpl");
    for (const path of ["/xrpl/tokens?marker=%25", "/xrpl/tokens?back=AAAA&marker=%25&x=1", "/xrpl/tokens?q=USD&marker=%25"]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the tokens");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 of class short when the API refuses the marker (a 400), and when nothing is behind it", async () => {
    cold();
    mock = mockUpstream("xrpl", { [BEHIND("AAAA")]: dataApiError(400, "invalid marker"), [BEHIND("BBBB")]: NOTHING });
    const refused = await render("/xrpl/tokens?marker=AAAA");
    expect(refused.response.status).toBe(404);
    expect(statusesOf(mock, BEHIND("AAAA"))).toEqual([400]);
    expect(refused.text).toContain("that page of the tokens");
    expect(await storedAs("/xrpl/tokens?marker=AAAA")).toEqual(SHORT);

    const empty = await render("/xrpl/tokens?marker=BBBB");
    expect(empty.response.status).toBe(404);
    expect(statusesOf(mock, BEHIND("BBBB"))).toEqual([200]);
    expect(await storedAs("/xrpl/tokens?marker=BBBB")).toEqual(SHORT);
    // Neither asked for names: there was no row to name.
    expect(namesCalls(mock)).toEqual([]);
  });

  it("is the same on the MPT tab: a 404 of class short when D9 refuses the marker (a 400), when nothing is behind it, and for a marker that is not one", async () => {
    cold();
    mock = mockUpstream("xrpl", { [MPT_BEHIND("AAAA")]: dataApiError(400, "invalid marker"), [MPT_BEHIND("BBBB")]: MPT_NOTHING });
    const refused = await render("/xrpl/tokens?kind=mpt&marker=AAAA");
    expect(refused.response.status).toBe(404);
    expect(statusesOf(mock, MPT_BEHIND("AAAA"))).toEqual([400]);
    expect(refused.text).toContain("that page of the tokens");
    expect(await storedAs("/xrpl/tokens?kind=mpt&marker=AAAA")).toEqual(SHORT);

    const empty = await render("/xrpl/tokens?kind=mpt&marker=BBBB");
    expect(empty.response.status).toBe(404);
    expect(statusesOf(mock, MPT_BEHIND("BBBB"))).toEqual([200]);
    expect(await storedAs("/xrpl/tokens?kind=mpt&marker=BBBB")).toEqual(SHORT);
    expect(namesCalls(mock)).toEqual([]);

    // A marker that is none is a 404 before the redirect and before any call.
    mock.restore();
    mock = mockUpstream("xrpl");
    const none = await render("/xrpl/tokens?kind=mpt&marker=%25");
    expect(none.response.status).toBe(404);
    expect(await storedAs("/xrpl/tokens?kind=mpt&marker=%25")).toEqual(SHORT);
    expect(mock.requests).toEqual([]);
  });

  it("is a 503, never stored, when the call behind a marker fails", async () => {
    cold();
    mock = mockUpstream("xrpl", { [BEHIND("CCCC")]: unavailable() });
    const failed = await render("/xrpl/tokens?marker=CCCC");
    expect(failed.response.status).toBe(503);
    expect(await isStored("/xrpl/tokens?marker=CCCC")).toBe(false);
  });
});

describe("the names call failing", () => {
  it("serves the page with the issuers as addresses and does not store it", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    // A view of its own: the test of the search below stores its page, and this one is the first to ask for it.
    const path = "/xrpl/tokens?q=USD";
    const { response, html } = await render(path);

    await expectDegraded(path, response);
    expect(rowsOf(html).length).toBeGreaterThan(1);
    expect(errors.mock.calls.filter(([line]) => String(line).includes("names could not be loaded"))).toHaveLength(1);
  });
});

// ---- The first page ---------------------------------------------------------------------------------------------------------------------------

describe("the default view", () => {
  it("makes exactly call #1 and the names call, and is stored for a minute", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/tokens");

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([LIST]);
    // One names call, after it, for the issuers of the rows.
    expect(namesCalls(mock)).toHaveLength(1);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    expect(withoutNames(mock.requests)).toHaveLength(1);
    expect(await storedAs("/xrpl/tokens")).toEqual(MINUTE);
    expect(isNoindex(html)).toBe(false);

    // The head, the tabs and the totals of the kind.
    expect(html).toContain("<title>Tokens · XRPL · explorer</title>");
    expect(text).toContain("Tokens on XRPL, ranked by holders. Names come from each issuer's toml.");
    expect(text).toContain("/v2/tokens?kind=issued&min_holders=10");
    expect(tiles(html)).toEqual([
      { label: "Tokens with 10+ holders", value: "60" },
      { label: "Holders", value: "1,579" },
      { label: "Volume, 24 h", value: "17.1M XRP" },
    ]);
    expect(text).toContain("40 more have fewer than 10 holders");
    expect(text).toContain("DEX and AMM trades of every pair");
    expect(html).toMatch(/aria-current="true"[^>]*>Issued tokens<\/a>/);
    // MPT is on in this project (README "Switches"): the tab is a link to the kind's first page. (The off-case is the loader test below, the switch off in its bindings.)
    expect(linksTo(html, "MPT")).toEqual(["/xrpl/tokens?kind=mpt"]);
    expect(html).not.toContain('class="soon"');

    // The table: 20 rows in the order of the answer, the first the answer's first.
    const rows = rowsOf(html);
    expect(rows).toHaveLength(20);
    expect(rows[0]![0]).toBe("1");
    expect(rows[0]![1]).toContain("RLUSD");
    expect(rows[0]![1]).toContain("Ripple USD");
    expect(rows[0]![3]).toBe("96");
    expect(rows.map((row) => row[0])).toEqual(Array.from({ length: 20 }, (_, at) => String(at + 1)));
    expect(rows.map((row) => row[7]?.startsWith("listed"))).toEqual(xrplList.tokens.map((token) => token.listed));
    // The note, the definitions, the coverage of the fixtures (the index starts at a ledger) and the pager.
    expect(text).toContain("Showing 1–20 of 60 tokens with 10 or more holders");
    expect(text).toContain("Holders: accounts with a positive balance. Supply: the sum of their balances. Price: the last trade against XRP.");
    expect(text).toContain("Covers ledger #93,663,334 onwards: earlier trust lines are not in the index yet.");
    expect(linksTo(html, "More tokens")).toEqual([`/xrpl/tokens?marker=${xrplList.marker}`]);
    expect(linksTo(html, "Show all (40 hidden)")).toEqual(["/xrpl/tokens?all=1"]);
    // The header marks the section: the Tokens item is the page of the section.
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Tokens<\/a>/);
  });

  it("links each token of the table to its page, through tokenLink: a code as the ledger holds it, spelled as the page's path is", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/tokens");
    const links = anchors(html).filter((a) => /href="\/xrpl\/token\//.test(a.attrs));
    expect(links).toHaveLength(20);
    expect(links[0]!.attrs).toContain('href="/xrpl/token/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"');
    // The hex code that decodes to a name with a dot in it is a hex in the path; a 3-character code is itself.
    expect(links[1]!.attrs).toContain('href="/xrpl/token/GBP.rnzjfsruieJp3cnnKZotMS3FE61fe3WdPJ"');
  });

  it("answers its .data URL with the page's data and not a redirect: React Router's _routes is no part of the view", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const dataPath = "/xrpl/tokens.data?_routes=routes%2Fnet.tokens";
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("Tokens with 10+ holders");
    expect(await storedAs(dataPath)).toEqual(MINUTE);
    // The browser never gets the API's answer: the rows are the view builder's, and no host or key is in them.
    expect(body).not.toContain("trust_lines");
    expect(body).not.toContain("data.example.invalid");
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    const path = "/xrpl/tokens.data?_routes=routes%2Fnet.tokens&kind=mpt&all=1";
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain("/xrpl/tokens?kind=mpt");
    expect(body).not.toContain("all=1");
    expect(mock.requests).toEqual([]);
    expect(await stored(path)).toBeUndefined();
  });
});

describe("the other views", () => {
  it("asks without min_holders under all=1, and with q for a search", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const all = await render("/xrpl/tokens?all=1");
    expect(keysOf(mock.requests)).toEqual([ALL]);
    expect(await storedAs("/xrpl/tokens?all=1")).toEqual(MINUTE);
    expect(all.text).toContain("/v2/tokens?kind=issued ");
    expect(all.text).toContain("Showing 1–20 of 100 tokens");
    expect(linksTo(all.html, "Hide tokens with fewer than 10 holders")).toEqual(["/xrpl/tokens"]);
    expect(all.html).toContain("<title>All tokens · XRPL · explorer</title>");
    expect(isNoindex(all.html)).toBe(true);
    // `all=1` is a hidden field of the form, after the field.
    expect(all.html).toMatch(/name="q"[^>]*>[\s\S]*<input type="hidden" name="all" value="1"/);
    mock.restore();

    mock = mockUpstream("xrpl");
    const search = await render("/xrpl/tokens?q=USD");
    expect(keysOf(mock.requests)).toEqual([SEARCH("USD")]);
    expect(await storedAs("/xrpl/tokens?q=USD")).toEqual(MINUTE);
    expect(issuedRows(search.html)).toHaveLength(7);
    expect(search.text).toContain("6 matches · 3 more among tokens with fewer than 10 holders");
    expect(linksTo(search.html, "3 more among tokens with fewer than 10 holders")).toEqual(["/xrpl/tokens?q=USD&all=1"]);
    expect(search.html).toContain("<title>Tokens matching “USD” · XRPL · explorer</title>");
    expect(isNoindex(search.html)).toBe(true);
    expect(search.html).toContain('value="USD"');
  });

  it("is a page behind the marker of its More tokens link: stored for a minute, noindex, follow, with Previous back to the first page", async () => {
    cold();
    const marker = await tokensMarker("xrpl");
    mock = mockUpstream("xrpl");
    const path = `/xrpl/tokens?marker=${marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([BEHIND(marker)]);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>More tokens · XRPL · explorer</title>");
    expect(issuedRows(html)).toHaveLength(21);
    expect(text).toContain("Showing 21–40 of 60 tokens with 10 or more holders");
    expect(linksTo(html, "Previous")).toEqual(["/xrpl/tokens"]);
  });

  it("searches under all without min_holders, keeps the search in the way back, and has no link to more tokens that it has already", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/tokens?q=USD&all=1");
    expect(keysOf(mock.requests)).toEqual(["GET /v2/tokens?kind=issued&limit=20&q=USD"]);
    expect(elementText(html, "tokens__notes")).toContain("9 matches");
    expect(elementText(html, "tokens__notes")).not.toContain("more among");
    expect(linksTo(html, "Hide tokens with fewer than 10 holders")).toEqual(["/xrpl/tokens?q=USD"]);
    // 9 matches, all on the page: no next page.
    expect(anchors(html).filter((a) => a.text === "More tokens")).toEqual([]);
  });
});

// ---- The MPT tab (E14 spec 4) --------------------------------------------------------------------------------------------------------------------------------------------------

describe("the MPT tab", () => {
  it("makes exactly D9's call #1 and the names call, and is stored for a minute, as every view of the list", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/tokens?kind=mpt");

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([MPT_LIST]);
    // One names call, after it, for the issuers of the rows.
    expect(namesCalls(mock)).toHaveLength(1);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    expect(withoutNames(mock.requests)).toHaveLength(1);
    expect(await storedAs("/xrpl/tokens?kind=mpt")).toEqual(MINUTE);

    // The tags: indexable, with the canonical URL that holds the kind.
    expect(isNoindex(html)).toBe(false);
    expect(html).toContain("<title>MPTs · XRPL · explorer</title>");
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/xrpl\/tokens\?kind=mpt"\/?>/);
    expect(html).toMatch(/<meta name="description" content="MPT issuances on the XRP Ledger, ranked by holders\."\/?>/);

    // The head, the tabs, the totals of the kind and the source line.
    expect(text).toContain("Tokens on XRPL, ranked by holders. Tickers and names come from each issuance's metadata.");
    expect(text).toContain("/v2/tokens?kind=mpt");
    expect(text).not.toContain("min_holders");
    expect(tiles(html)).toEqual([
      { label: "MPT issuances", value: "25" },
      { label: "Holders", value: "329" },
      { label: "Transfers, 24 h", value: "96" },
    ]);
    expect(text).toContain("on XRPL, with any number of holders");
    expect(html).toMatch(/aria-current="true"[^>]*>MPT<\/a>/);
    expect(linksTo(html, "Issued tokens")).toEqual(["/xrpl/tokens"]);
    expect(html).not.toContain('class="soon"');

    // The table: the board's columns, 20 rows in the order of the answer, the first the answer's first.
    expect(tableRows(html, "MPTs")[0]).toEqual(["#", "Token", "Issuer", "Holders", "Outstanding", "Max amount", "Flags", "Transfers 24 h"]);
    const rows = mptRows(html);
    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row[0])).toEqual(Array.from({ length: 20 }, (_, at) => String(at + 1)));
    // XAU: scale 4, 612344999968 units outstanding are 61,234,499.9968 (compact 61.2M), the maximum 1000000000000 are 100,000,000 (100M).
    expect(rows[0]![1]).toBe("X XAU Tokenized Gold (XAU)");
    expect(rows[0]!.slice(3)).toEqual(["63", "61.2M", "100M", "Transfer Trade Lock Clawback Escrow Auth", "4"]);
    // An issuance with no metadata: the no-metadata cell, the maximum not set, the pills it has.
    expect(rows[1]![1]).toBe("? No metadata 0598F6E0…00E3");
    // The fixtures' `nonConforming` issuance (C17): a name of 128 characters with no space is drawn whole, in the Token cell (it breaks at the edge of the cell: pages.css, pinned).
    const long = mptList.tokens.find((token) => token.mpt_issuance_id === MPT_FIXTURE_IDS.nonConforming)!;
    expect(long.name).toHaveLength(128);
    expect(rows.find((row) => row[1]!.endsWith(long.name!))![1]).toBe(`${long.ticker![0]} ${long.ticker} ${long.name}`);
    expect(rows.every((row) => row.length === 8)).toBe(true);
    expect(rows.map((row) => row[6])).toContain("none");
    expect(rows.map((row) => row[5])).toContain("not set");
    // The note, the legend, the coverage of the fixtures (complete) and the pager.
    expect(text).toContain("Showing 1–20 of 25 issuances");
    expect(text).toContain("Flags: Transfer, holders can send it to each other · Trade, the issuer allows it on the DEX (MPT trading isn't enabled on XRPL yet)");
    expect(text).not.toContain("are not in the index yet");
    expect(linksTo(html, "More tokens")).toEqual([`/xrpl/tokens?kind=mpt&marker=${mptList.marker}`]);
    // No Show all: `all` is the issued list's.
    expect(text).not.toContain("Show all");
    // The header marks the section: the Tokens item is the page of the section.
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Tokens<\/a>/);
  });

  it("links each row to its issuance's page by the ID in capitals, and each issuer to its account", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/tokens?kind=mpt");
    const links = anchors(html).filter((a) => /href="\/xrpl\/mpt\//.test(a.attrs));
    expect(links).toHaveLength(20);
    expect(links.map((a) => /href="\/xrpl\/mpt\/([0-9A-F]{48})"/.exec(a.attrs)?.[1])).toEqual(mptList.tokens.map((token) => token.mpt_issuance_id));
    expect(links[0]!.attrs).toContain(`href="/xrpl/mpt/${mptList.tokens[0]!.mpt_issuance_id}"`);
    expect(anchors(html).filter((a) => a.attrs.includes(`href="/xrpl/account/${mptList.tokens[0]!.issuer}"`))).toHaveLength(1);
  });

  it("answers its .data URL with the page's data, stored for a minute, and the browser never gets the API's answer", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const dataPath = "/xrpl/tokens.data?_routes=routes%2Fnet.tokens&kind=mpt";
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("MPT issuances");
    expect(body).toContain("Tokenized Gold (XAU)");
    expect(await storedAs(dataPath)).toEqual(MINUTE);
    expect(body).not.toContain("transfers_24h");
    expect(body).not.toContain("data.example.invalid");
  });

  it("is a page behind the marker of its More tokens link: asked with that marker, stored for a minute, noindex, follow, with Previous back to the first page", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/tokens?kind=mpt&marker=${mptList.marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([MPT_BEHIND(mptList.marker)]);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>More MPTs · XRPL · explorer</title>");
    expect(mptRows(html).map((row) => row[0])).toEqual(["21", "22", "23", "24", "25"]);
    expect(text).toContain("Showing 21–25 of 25 issuances");
    expect(linksTo(html, "Previous")).toEqual(["/xrpl/tokens?kind=mpt"]);
    expect(anchors(html).filter((a) => a.text === "More tokens")).toEqual([]);
    // The names are the rows of this page's.
    expect(namesCalls(mock)).toHaveLength(1);
    expect(namesCalls(mock)[0]).toEqual([...new Set(mptSecond.tokens.map((token) => token.issuer))].sort());
  });

  it("searches D9 with q: one row, '1 match', and the coverage note of the answer, which is not complete in the fixtures", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = "/xrpl/tokens?kind=mpt&q=HTF";
    const { html, text } = await render(path);

    expect(keysOf(mock.requests)).toEqual([MPT_SEARCH("HTF")]);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(html).toContain("<title>MPTs matching “HTF” · XRPL · explorer</title>");
    expect(isNoindex(html)).toBe(true);
    expect(mptRows(html)).toHaveLength(1);
    expect(mptRows(html)[0]![1]).toBe("H HTF Harborline Treasury Fund");
    expect(text).toContain("1 match");
    expect(text).toContain(`Covers ledger #${mptHtf.coverage.from_ledger_index.toLocaleString("en-US")} onwards: earlier issuances are not in the index yet.`);
    // The field has the search, and kind=mpt is a hidden field before it (a submit is already canonical).
    expect(html).toContain('value="HTF"');
    expect(html).toMatch(/<input type="hidden" name="kind" value="mpt"\/?>[\s\S]*name="q"/);
    expect(text).toContain("Ticker, name, issuer or issuance ID");
  });

  it("says what a search that matches nothing says, 'No MPTs match', makes no names call for a page with no row, and still lists the page's frame", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html, text } = await render("/xrpl/tokens?kind=mpt&q=zzz");

    expect(keysOf(mock.requests)).toEqual([MPT_SEARCH("zzz")]);
    expect(namesCalls(mock)).toEqual([]);
    expect(mptRows(html)).toEqual([]);
    expect(text).toContain("No MPTs match “zzz”.");
    expect(text).toContain("0 matches");
  });

  it("draws a dash for each tile and no pager when D9 has no totals yet (its first generation has not run): a page, not a 503", async () => {
    cold();
    const fresh = { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, kind: "mpt", count: 0, tokens: [] };
    mock = mockUpstream("xrpl", { [MPT_SEARCH("fresh")]: fresh });
    const { response, html, text } = await render("/xrpl/tokens?kind=mpt&q=fresh");

    expect(response.status).toBe(200);
    expect(tiles(html).map((tile) => tile.value)).toEqual(["—", "—", "—"]);
    expect(text).toContain("No MPTs match “fresh”.");
    expect(text).not.toMatch(/\d+ matches?/);
    expect(html).not.toMatch(/aria-label="Pagination"[^>]*>[\s\S]*href=/);
  });

  it("keeps whatever the issuer wrote as text: a ticker and a name with markup are drawn escaped in the page, its hydration data and nothing else of the page", async () => {
    cold();
    const hostile = { ...mptHtf.tokens[0]!, ticker: '"></script><u x>', name: "<img src=x onerror=alert(1)>" };
    mock = mockUpstream("xrpl", { [MPT_SEARCH("hostile")]: { ...mptHtf, tokens: [hostile] } });
    const { html } = await render("/xrpl/tokens?kind=mpt&q=hostile");

    expect(html).not.toContain("<u x>");
    expect(html).not.toContain("<img src=x");
    // The coin (the ticker's first character), the ticker and the name, as text.
    expect(mptRows(html)[0]![1]).toBe('" "></script><u x> <img src=x onerror=alert(1)>');
    // The hydration data is a script: nothing of the issuer's text closes it, and the page holds the text escaped.
    expect(html).not.toContain('"></script><u');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("answers a search of more than 64 characters with the field's message, class short, noindex, with no call at all", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/tokens?kind=mpt&q=${"x".repeat(65)}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(mock.requests).toEqual([]);
    expect(text).toContain("Search for at most 64 characters");
    expect(html).toContain('aria-invalid="true"');
    expect(mptRows(html)).toEqual([]);
    expect(html).not.toContain('aria-label="Pagination"');
    expect(await storedAs(path)).toEqual(SHORT);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>MPTs · XRPL · explorer</title>");
    expect(html).not.toContain(`matching “${"x".repeat(65)}”`);
  });

  it("is E11's issued list when the kind is another, with its tab a link", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render("/xrpl/tokens");
    expect(keysOf(mock.requests)).toEqual([LIST]);
    expect(mptRows(html)).toEqual([]);
    expect(linksTo(html, "MPT")).toEqual(["/xrpl/tokens?kind=mpt"]);
  });
});

describe("the MPT tab where there is none", () => {
  it("is a 302 to the issued list on Xahau, class short, before any call, whatever the switch says", async () => {
    mock = mockUpstream("xahau");
    for (const [query, to] of [
      ["?kind=mpt", ""],
      ["?kind=mpt&q=HTF", "?q=HTF"],
      ["?kind=mpt&all=1", "?all=1"],
      ["?kind=mpt&marker=AAAA&back=BBBB", "?marker=AAAA&back=BBBB"],
    ] as const) {
      const response = await get(`/xahau/tokens${query}`);
      await response.text();
      expect(response.status, query).toBe(302);
      expect(response.headers.get("Location"), query).toBe(`/xahau/tokens${to}`);
      expect(await storedAs(`/xahau/tokens${query}`), query).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  // `worker-off` has every switch off, and `TOKENS` off is a 404 of the whole list (tokens-off.spec.ts), so the case of `MPT` off beside `TOKENS` on is the route's loader with a load context of its own
  // (the bindings of this project, `MPT` "off"): the redirect of `?kind=mpt` and the tab as E11's "soon" (ruling C21).
  describe("with MPT off and TOKENS on (the route's loader, with a load context of its own)", () => {
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

    async function loaded(net: "xrpl" | "xahau", search: string, mpt: "on" | "off") {
      const request = new Request(`https://explorer.test/${net}/tokens${search}`);
      return await loader({
        request,
        url: new URL(request.url),
        params: { net },
        context: createLoadContext({ ...(env as unknown as Env), TOKENS: "on", MPT: mpt }, ctx),
      } as never);
    }

    it("redirects kind=mpt to /xrpl/tokens, class short, with no call, and keeps the rest of the query", async () => {
      mock = mockUpstream("xrpl");
      for (const [search, to] of [["?kind=mpt", "/xrpl/tokens"], ["?kind=mpt&q=HTF&marker=M1", "/xrpl/tokens?q=HTF&marker=M1"], ["?kind=mpt&all=1", "/xrpl/tokens?all=1"]] as const) {
        const result = await loaded("xrpl", search, "off");
        expect(result, search).toBeInstanceOf(Response);
        const response = result as Response;
        expect(response.status, search).toBe(302);
        expect(response.headers.get("Location"), search).toBe(to);
        expect(response.headers.get("X-Cache-Class"), search).toBe("short");
      }
      expect(mock.requests).toEqual([]);
    });

    it("draws the tab as E11's disabled 'soon' control while MPT is off, and as a link while it is on", async () => {
      mock = mockUpstream("xrpl");
      const off = (await loaded("xrpl", "", "off")) as { data: TokensPageData };
      expect(off.data.tabs[1]).toEqual({ label: "MPT", href: "/xrpl/tokens?kind=mpt", current: false, disabled: { tag: "soon" } });
      expect(off.data.tokenKind).toBe("issued");
      mock.restore();
      mock = mockUpstream("xrpl");
      const on = (await loaded("xrpl", "", "on")) as { data: TokensPageData };
      expect(on.data.tabs[1]).toEqual({ label: "MPT", href: "/xrpl/tokens?kind=mpt", current: false });
    });

    it("keeps Xahau's tab disabled with its note even with MPT on, and redirects its kind=mpt", async () => {
      mock = mockUpstream("xahau");
      const xahau = (await loaded("xahau", "", "on")) as { data: TokensPageData };
      expect(xahau.data.tabs[1]).toMatchObject({ label: "MPT", disabled: { note: "MPT isn't enabled on Xahau." } });
      const redirect = (await loaded("xahau", "?kind=mpt", "on")) as Response;
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("Location")).toBe("/xahau/tokens");
    });
  });
});

// ---- The search that is too long (spec 1.3) --------------------------------------------------------------------------------------------------

describe("a search of more than 64 characters", () => {
  it("answers the page with the field's message, class short, noindex, with no call at all", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/tokens?q=${"x".repeat(65)}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(mock.requests).toEqual([]);
    expect(text).toContain("Search for at most 64 characters");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/<p id="[^"]+" role="alert" class="tokens__error">/);
    expect(issuedRows(html)).toEqual([]);
    expect(html).not.toContain('aria-label="Pagination"');
    expect(await storedAs(path)).toEqual(SHORT);
    expect(isNoindex(html)).toBe(true);
    // The tags do not repeat what was typed.
    expect(html).toContain("<title>Tokens · XRPL · explorer</title>");
    expect(html).not.toContain(`matching “${"x".repeat(65)}”`);
  });

  it("counts code points as D6 does: 64 emoji are a search, and 65 are too long", async () => {
    cold();
    const ok = "😀".repeat(64);
    const key = SEARCH(ok);
    mock = mockUpstream("xrpl", { [key]: { ...NOTHING, total: 0, total_below: 0, marker: undefined } });
    const asked = await render(`/xrpl/tokens?q=${encodeURIComponent(ok)}`);
    expect(asked.response.status).toBe(200);
    expect(statusesOf(mock, key)).toEqual([200]);
    expect(asked.text).toContain(`No issued tokens match “${ok}”.`);
    expect(asked.text).not.toContain("Search for at most 64 characters");
    mock.restore();

    mock = mockUpstream("xrpl");
    const long = await render(`/xrpl/tokens?q=${encodeURIComponent("😀".repeat(65))}`);
    expect(long.response.status).toBe(200);
    expect(mock.requests).toEqual([]);
    expect(long.text).toContain("Search for at most 64 characters");
  });
});

// ---- Redirects ---------------------------------------------------------------------------------------------------------------------------------

describe("the query of the URL (spec 1.2)", () => {
  it.each([
    ["?kind=issued", ""],
    ["?kind=bogus", ""],
    ["?kind=MPT", ""],
    ["?back=M1", ""],
    ["?q=&x=1", ""],
    ["?all=1&q=USD", "?q=USD&all=1"],
    ["?all=0", ""],
    ["?q=USD&q=EUR", "?q=USD"],
    ["?q=%20USD%20", "?q=USD"],
    ["?back=B%25&marker=AAAA", "?marker=AAAA"],
    ["?back=BBBB&marker=AAAA&q=USD", "?q=USD&marker=AAAA&back=BBBB"],
    // The MPT tab (E14 spec 4): `all` is the issued list's alone, `q` follows `kind`, and the rest of the canonical query is the issued list's.
    ["?kind=mpt&all=1", "?kind=mpt"],
    ["?all=1&kind=mpt&q=HTF", "?kind=mpt&q=HTF"],
    ["?q=HTF&kind=mpt", "?kind=mpt&q=HTF"],
    ["?kind=mpt&q=%20HTF%20&x=1", "?kind=mpt&q=HTF"],
    ["?kind=mpt&back=M1", "?kind=mpt"],
    ["?kind=mpt&kind=issued&q=a", "?kind=mpt&q=a"],
    ["?kind=mpt&back=BBBB&marker=AAAA", "?kind=mpt&marker=AAAA&back=BBBB"],
  ])("redirects %s to %j, class short, before any call", async (query, to) => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/tokens${query}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tokens${to}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(`/xrpl/tokens${query}`)).toEqual(SHORT);
  });

  it("redirects the path /xrpl/TOKENS to /xrpl/tokens, class immutable (the path alone), before any call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/TOKENS");
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/tokens");
    expect(mock.requests).toEqual([]);
    expect(await storedAs("/xrpl/TOKENS")).toEqual({ cls: "immutable", ttl: 31_536_000 });
  });
});

// ---- Xahau (spec 10) ---------------------------------------------------------------------------------------------------------------------------

describe("Xahau", () => {
  it("lists in XAH with the DEX's words, the MPT tab disabled with the note, and the network's own title", async () => {
    cold();
    mock = mockUpstream("xahau");
    const { response, html, text } = await render("/xahau/tokens");

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests)).toEqual([LIST]);
    expect(html).toContain("<title>Tokens · Xahau · explorer</title>");
    expect(text).toContain("Tokens on Xahau, ranked by holders. Names come from each issuer's toml.");
    expect(tiles(html)).toEqual([
      { label: "Tokens with 10+ holders", value: "60" },
      { label: "Holders", value: "1,350" },
      { label: "Volume, 24 h", value: "15.4M XAH" },
    ]);
    expect(text).toContain("DEX trades of every pair");
    expect(text).not.toContain("DEX and AMM");
    expect(issuedRows(html)[0]).toEqual(["#", "Token", "Issuer", "Holders", "Supply", "Price (XAH)", "Volume 24 h (XAH)", "Listed in the issuer's toml"]);
    expect(text).toContain("Price: the last trade against XAH.");
    expect(text).toContain("MPT isn't enabled on Xahau.");
    expect(rowsOf(html)).toHaveLength(xahauList.count);
    expect(await storedAs("/xahau/tokens")).toEqual(MINUTE);
  });
});
