import { afterEach, describe, expect, it, vi } from "vitest";

import { CACHE_CLASSES, HOME_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS } from "../../app/server/cache-class";
import xrplAmendments from "../fixtures/http/xrpl/data-api/network/amendments.json";
import xrplSummary from "../fixtures/http/xrpl/data-api/network/validators/summary.json";
import xahauAmendments from "../fixtures/http/xahau/data-api/network/amendments.json";
import { anchors, hrefs, pageClient, tableRows, textOf } from "../support/pages";
import { mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The validators list, `/{net}/validators`, on the real Worker against the generated D1 answers (test/fixtures/http/{net}/data-api/network/
// validators…): the calls it makes, for how long each is kept and under which class the page is stored, the redirects that make one URL of a
// view, and the page without JavaScript. What a failed call does to it is validators-page-failures.spec.ts, a file of its own: a Worker keeps
// what it is answered in the Cache API for the rest of the file, and the tests here count calls that are *not yet* there. They run in the order
// they are written in, and each says what it leaves behind: the first leaves XRPL's four calls (kept 2 s, 10 s and 60 s of the real clock),
// the second Xahau's.

const { get, page, storedAs } = pageClient("198.51.109");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
});

const LAST_VALIDATED = "GET /v2/last_validated";
const SUMMARY = "GET /v2/network/validators/summary";
const LIST = "GET /v2/network/validators?limit=1000&scope=all";
const AMENDMENTS = "GET /v2/network/amendments";

const keysOf = (requests: UpstreamMock["requests"]) => requests.map((request) => request.key);

/**
 * The subrequest-cache lookups made from now until the test ends, hits and misses alike. `mock.requests` holds only what reached `fetch`, and by the time the
 * tests below run XRPL's calls are warm in the Cache API, so a call that was answered from it never shows there: a lookup does.
 */
function subrequestLookups(): string[] {
  const urls: string[] = [];
  const match = caches.default.match.bind(caches.default);
  vi.spyOn(caches.default, "match").mockImplementation((request, options) => {
    const url = request instanceof Request ? request.url : String(request);
    if (url.startsWith("https://subrequest-cache.invalid/")) urls.push(url);
    return match(request, options);
  });
  return urls;
}

/** Whether the filter form has the field `label` ("Listed by" is also a word of the rows' UNL tags: only a label is a field). */
const hasField = (html: string, label: string) => new RegExp(`<label[^>]*>${label}</label>`).test(html);

/** The name and the upper-case ID of the amendment of `list` that has `status`: the first one, as the fixtures hold them. */
function amendmentOf(list: { amendments: Array<{ id: string; name?: string; status: string }> }, status: string) {
  const row = list.amendments.find((amendment) => amendment.status === status);
  expect(row, `no ${status} amendment`).toBeDefined();
  return row!;
}

// ---- The calls, as the spec writes them (2.1) -------------------------------------------------------------------------------------------------

describe("the first render of /xrpl/validators", () => {
  it("xrpl: makes exactly the calls of §2.1, stored as their classes, and the page and its .data URL as live", async () => {
    mock = mockUpstream("xrpl");
    const puts: Array<string | null> = [];
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.push((response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });

    const { response, html } = await page("/xrpl/validators");

    // `lastValidated`, S, L and A, and nothing else: the node is not called, and every call found its file.
    expect(keysOf(mock.requests).sort()).toEqual([LAST_VALIDATED, SUMMARY, LIST, AMENDMENTS].sort());
    expect(mock.requests.every((request) => request.kind === "data-api" && request.net === "xrpl")).toBe(true);
    expect(mock.requests.map((request) => request.source)).toEqual(Array(4).fill("fixture"));
    // L is asked once, for every view: `limit=1000&scope=all`, the filters being applied in the Worker.
    expect(statusesOf(mock, LIST)).toEqual([200]);

    // What each is kept for in the Cache API: `lastValidated` the home page's 2 s, S and L 10 s, A the class `minute`'s 60 s, and the page a day.
    await vi.waitFor(() => expect(puts.length).toBeGreaterThanOrEqual(5), { timeout: 10_000 });
    const counted = (value: string) => puts.filter((control) => control === value).length;
    expect([HOME_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS, CACHE_CLASSES.minute.edgeTtl]).toEqual([2, 10, 60]);
    expect(counted(`public, max-age=${HOME_CALL_TTL_SECONDS}`)).toBe(1);
    expect(counted(`public, max-age=${VALIDATORS_CALL_TTL_SECONDS}`)).toBe(2);
    expect(counted(`public, max-age=${CACHE_CLASSES.minute.edgeTtl}`)).toBe(1);
    expect(counted("public, max-age=86400")).toBe(1);

    // The class of the page: live, 5 s fresh; the browser is told to revalidate.
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs("/xrpl/validators")).toEqual({ cls: "live", ttl: 5 });
    // The browser never gets the API's URL, nor the node's: the page is the view builder's.
    expect(html).not.toContain("example.invalid");
    expect(html).not.toContain("s1.ripple.com");

    // The route's own request of a client-side navigation: React Router adds `_routes`, which is no part of the view.
    const dataPath = "/xrpl/validators.data?_routes=routes%2Fnet.validators";
    const data = await get(dataPath);
    const body = await data.text();
    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    // The loader's data carries the ledger it was built from and the Worker's build, for an open page to order its answers and to tell a deploy.
    expect(body).toContain("anchor");
    expect(body).toContain("test-build");
    expect(body).not.toContain("example.invalid");
    expect(await storedAs(dataPath)).toEqual({ cls: "live", ttl: 5 });
  });
});

describe("the other views of /xahau/validators", () => {
  it("xahau: one list call serves ?scope=all, ?q= and ?amendment= in a row", async () => {
    mock = mockUpstream("xahau");
    const voting = amendmentOf(xahauAmendments, "voting");
    expect(voting.name).toBe("URIToken");

    // The canonical URLs of three views of the list: the scope, a search, an amendment being voted on.
    const all = await page("/xahau/validators?scope=all");
    const search = await page("/xahau/validators?q=example");
    const amendment = await page(`/xahau/validators?amendment=${voting.name}`);

    expect(statusesOf(mock, LIST)).toEqual([200]);
    expect(statusesOf(mock, SUMMARY)).toEqual([200]);
    expect(statusesOf(mock, AMENDMENTS)).toEqual([200]);
    // Three views, not one page three times: the rows differ.
    const rowsOf = (html: string) => tableRows(html, "Validators").length - 1;
    expect(rowsOf(all.html)).toBe(41);
    expect(rowsOf(search.html)).toBeGreaterThan(0);
    expect(rowsOf(amendment.html)).toBeGreaterThan(0);
    expect(rowsOf(amendment.html)).toBeLessThan(rowsOf(all.html));
  });
});

// ---- One URL per view (1.4) -----------------------------------------------------------------------------------------------------------------

describe("the query of the URL", () => {
  it.each([
    ["?scope=unl", ""],
    ["?scope=all&publisher=&amendment=&q=", "?scope=all"],
    ["?x=1&q=a&q=b", "?q=a"],
  ])("redirects %s to %j with no call", async (query, to) => {
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    const response = await get(`/xrpl/validators${query}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/validators${to}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    // No call: none reached the upstream, and none was asked of the subrequest cache either (XRPL's calls are warm there from the first test, so an answer from
    // it would not show in `mock.requests`).
    expect(mock.requests).toEqual([]);
    expect(lookups).toEqual([]);
    expect(await storedAs(`/xrpl/validators${query}`)).toEqual({ cls: "short", ttl: 30 });
  });

  it("sends one 302 carrying both kinds of change", async () => {
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    const named = amendmentOf(xrplAmendments, "voting");
    expect(named.name).toBe("DynamicNFT");

    const cases: Array<[string, string]> = [
      // A publisher in the wrong case (S's spelling is not known before S answers) and a search to trim (known at once).
      ["?publisher=VL.RIPPLE.COM&q=%20a%20", "?publisher=vl.ripple.com&q=a"],
      // The ID of a named amendment, in lower case, becomes its name.
      [`?amendment=${named.id.toLowerCase()}`, `?amendment=${named.name}`],
      // A name in the wrong case becomes A's spelling, and a search is kept beside it.
      [`?q=x&amendment=${named.name!.toLowerCase()}`, `?amendment=${named.name}&q=x`],
      // An amendment that is not being voted on (AMM is enabled) is dropped, and nothing is left of the query.
      ["?amendment=AMM", ""],
      // A publisher S does not have is dropped.
      ["?publisher=nobody.example&scope=all", "?scope=all"],
    ];
    for (const [from, to] of cases) {
      const response = await get(`/xrpl/validators${from}`);
      await response.text();
      expect(response.status, from).toBe(302);
      expect(response.headers.get("Location"), from).toBe(`/xrpl/validators${to}`);
      expect(response.headers.get("Cache-Control"), from).toBe("max-age=0");
      expect(await storedAs(`/xrpl/validators${from}`), from).toEqual({ cls: "short", ttl: 30 });
    }
    // The control of the check above: these redirects wait for S and A, so the spy does see lookups of the subrequest cache (it is not blind to them).
    expect(lookups.length).toBeGreaterThan(0);
  });
});

// ---- The page without JavaScript (3.1) ----------------------------------------------------------------------------------------------------

/** The segments the share bar of the versions draws: the shown versions that have validators, and "Other" while it has any. */
function drawnSegments(summary: typeof xrplSummary): number {
  const shown = summary.versions.slice(0, 4);
  const older = summary.versions.slice(4);
  const row = (of: "unl" | "all") => shown.filter((v) => v[of] > 0).length + (older.reduce((n, v) => n + v[of], 0) + summary.versions_unknown[of] > 0 ? 1 : 0);
  return row("unl") + row("all");
}

describe("the page without JavaScript", () => {
  it("holds the share bar's segments and both views, and no age or countdown, in the stored HTML", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/validators");
    const text = textOf(html);

    // The bar: one row for the UNL and one for all, a box for each segment, and the legend of the versions.
    expect((html.match(/class="share__seg/g) ?? []).length).toBe(drawnSegments(xrplSummary));
    expect(html).toContain('class="share__name"');
    for (const version of xrplSummary.versions.filter((v) => v.unl + v.all > 0)) expect(text, version.version).toContain(version.version);

    // Both views of the card: the chart, and the table its Table radio shows, which is in the HTML (the radios are a form, working without a script).
    const rows = tableRows(html, "Validator software versions");
    expect(rows[0]).toEqual(["Version", "UNL", "UNL share", "All", "All share"]);
    expect(rows.slice(1).map((row) => row[0])).toEqual([...xrplSummary.versions.map((v) => v.version), "Unknown"]);

    // The table of the validators holds the UNL's rows, and the page says nothing that depends on when it is read: no age, no countdown.
    expect(tableRows(html, "Validators").length - 1).toBe(35);
    expect(html).not.toMatch(/ ago</);
    expect(html).not.toContain("in ~");
    expect(text).not.toMatch(/\d+ (seconds?|minutes?|hours?) ago/);
  });

  it("has Listed by on XRPL and not on Xahau", async () => {
    mock = mockUpstream("xrpl");
    const xrpl = await page("/xrpl/validators");
    // Two publishers: a choice among them, with the ids as S writes them.
    expect(hasField(xrpl.html, "Listed by")).toBe(true);
    const options = [...xrpl.html.matchAll(/<option value="([^"]*)"[^>]*>/g)].map((match) => match[1]);
    expect(options).toEqual(expect.arrayContaining(["unl.xrplf.org", "vl.ripple.com"]));
    expect(anchors(xrpl.html).some((a) => /href="\/xrpl\/amendments"/.test(a.attrs))).toBe(true);
    // The rows' links are the validators' pages, and the amendments they vote for.
    expect(hrefs(xrpl.html).filter((href) => /^\/xrpl\/validators\/n/.test(href)).length).toBeGreaterThan(0);

    // One publisher: nothing to choose, so no field.
    const xahau = await page("/xahau/validators");
    expect(hasField(xahau.html, "Listed by")).toBe(false);
    expect(xahau.html).not.toContain('name="publisher"');
    expect(hasField(xahau.html, "Votes yes for")).toBe(true);
  });
});
