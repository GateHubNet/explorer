import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CACHE_CLASSES, HOME_CALL_TTL_SECONDS } from "../../app/server/cache-class";
import xrplAmendments from "../fixtures/http/xrpl/data-api/network/amendments.json";
import xahauAmendments from "../fixtures/http/xahau/data-api/network/amendments.json";
import { anchors, elementText, hrefs, pageClient, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { AMENDMENTS, LAST_VALIDATED } from "../support/validators-calls";

// The amendments list, `/{net}/amendments` (validators spec 1.4, 2.2, 5.2 and 5.3), on the real Worker against the generated D1 answers
// (test/fixtures/http/{net}/data-api/network/amendments.json): what a failed call does to it, the calls it makes and for how long each is kept, the redirects that make
// one URL of a view, and the page without JavaScript.
//
// A Worker keeps what it is answered in the Cache API for the rest of the file (an error never): lastValidated for 2 s and A for 60 s of the real clock, one key for each
// network. So the tests that fail a call come first, and the ones that need a call to reach the mock take the Cache API's answer away (`cold`), as the validator page's
// spec does. The page asks for the failure hold on every call (E2 1.7): a failure is remembered for 5 s of `Date`, per Worker instance, so `Date` alone is faked and moved
// 31 s on after each test, past the longest hold (as network-hold.spec.ts does): no test meets an earlier one's hold.

const { get, page, stored, storedAs } = pageClient("198.51.113");

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

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unavailable = () => dataApiError(503, "unavailable");
const keysOf = (requests: UpstreamMock["requests"]) => requests.map((request) => request.key);

const SUBREQUESTS = "https://subrequest-cache.invalid/";
const urlOf = (request: RequestInfo | URL) => (request instanceof Request ? request.url : String(request));

/**
 * The subrequest-cache lookups made from now until the test ends, hits and misses alike. `mock.requests` holds only what reached `fetch`: a call that the Cache API
 * answered from an earlier test never shows there, and a lookup does.
 */
function subrequestLookups(): string[] {
  const urls: string[] = [];
  const match = caches.default.match.bind(caches.default);
  vi.spyOn(caches.default, "match").mockImplementation((request, options) => {
    if (urlOf(request).startsWith(SUBREQUESTS)) urls.push(urlOf(request));
    return match(request, options);
  });
  return urls;
}

/** What the Cache API kept of the tests above (the calls of both networks) must not answer: every call of the render reaches the mock. */
function cold(): void {
  const match = caches.default.match.bind(caches.default);
  vi.spyOn(caches.default, "match").mockImplementation((request, options) => (urlOf(request).startsWith(SUBREQUESTS) ? Promise.resolve(undefined) : match(request, options)));
}

/** Whether the edge cache holds a copy of `path` now: it is stored behind the answer, so a store that is not wanted gets a moment to show. */
async function isStored(path: string) {
  await sleep(120);
  return (await stored(path)) !== undefined;
}

/** The page at `path`: its response, HTML and visible text. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

/**
 * The rows of the Amendments table (its `role="row"` elements, the header first) as arrays of cell texts. A cell of this table holds a `div` (the consensus bar), so a row is
 * cut at the next row and the table at the card's foot, not at a `</div>` (`tableRows` of support/pages.ts).
 */
function amendmentRows(html: string): string[][] {
  const start = html.indexOf('role="table" aria-label="Amendments"');
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

// ---- A call that fails (5.3) ---------------------------------------------------------------------------------------------------------------

describe("a call the list cannot be built without", () => {
  it("xrpl: A answering Cannot GET is a 503 that is not stored (an API without D1)", async () => {
    // `null` is the fixture server's answer to a path the API has no route for: the framework's "Cannot GET" 404, which is an outage.
    mock = mockUpstream("xrpl", { [AMENDMENTS]: null });
    const path = "/xrpl/amendments";
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(statusesOf(mock, AMENDMENTS)).toEqual([404]);
    // Thrown once everything had settled: lastValidated answered.
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([200]);
    expect(html).not.toContain("Cannot GET");

    // The call asks for the failure hold (the page polls): a second render a second later is a 503 that made no request at all.
    advance(1_000);
    expect((await render(path)).response.status).toBe(503);
    expect(statusesOf(mock, AMENDMENTS)).toEqual([404]);
  });

  it("xahau: A answering 503 is a 503 that is not stored", async () => {
    mock = mockUpstream("xahau", { [AMENDMENTS]: unavailable() });
    const path = "/xahau/amendments";
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(statusesOf(mock, AMENDMENTS)).toEqual([503]);
    expect(html).not.toContain("Cannot GET");
  });

  it.each([
    [404, "amendments not found"],
    [400, "bad request"],
  ])("xahau: A answering %i %j is an outage too: the page is A, so a 503 and never a stored 404", async (status, message) => {
    // A is not what the visitor asked for: its absence is the API's fault, not a page that is not there.
    mock = mockUpstream("xahau", { [AMENDMENTS]: dataApiError(status, message) });
    const path = "/xahau/amendments";
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(html).not.toContain("We couldn’t find");
  });

  it("xrpl: lastValidated failing is a 503 that is not stored, once A has answered too", async () => {
    cold();
    mock = mockUpstream("xrpl", { [LAST_VALIDATED]: unavailable() });
    const path = "/xrpl/amendments";
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
    // Nothing runs on behind an answered request: A was awaited, and answered.
    expect(statusesOf(mock, AMENDMENTS)).toEqual([200]);

    // The home page's key is asked for with the failure hold as well.
    advance(1_000);
    expect((await render(path)).response.status).toBe(503);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
  });
});

// ---- The calls, as the spec writes them (2.1) ----------------------------------------------------------------------------------------------

describe("the first render of /xrpl/amendments", () => {
  it("is minute, page and .data, with exactly lastValidated and A", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const puts: Array<string | null> = [];
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.push((response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });
    const path = "/xrpl/amendments";
    const { response, html } = await page(path);

    // `lastValidated` and A, and nothing else: the node is not called, no summary, no list, and every call found its file.
    expect(keysOf(mock.requests).sort()).toEqual([LAST_VALIDATED, AMENDMENTS].sort());
    expect(mock.requests.every((request) => request.kind === "data-api" && request.net === "xrpl" && request.source === "fixture")).toBe(true);

    // What each is kept for: lastValidated the home page's 2 s, A the class `minute`'s 60 s, and the page a day.
    await vi.waitFor(() => expect(puts.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    const counted = (value: string) => puts.filter((control) => control === value).length;
    expect([HOME_CALL_TTL_SECONDS, CACHE_CLASSES.minute.edgeTtl]).toEqual([2, 60]);
    expect(counted(`public, max-age=${HOME_CALL_TTL_SECONDS}`)).toBe(1);
    expect(counted(`public, max-age=${CACHE_CLASSES.minute.edgeTtl}`)).toBe(1);
    expect(counted("public, max-age=86400")).toBe(1);

    // The class of the page: minute, 60 s fresh; the browser is told to revalidate.
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "minute", ttl: CACHE_CLASSES.minute.edgeTtl });
    // The browser never gets the API's URL, nor the node's: the page is the view builder's.
    expect(html).not.toContain("example.invalid");
    expect(html).not.toContain("s1.ripple.com");

    // The route's own request of a client-side navigation: React Router adds `_routes`, which is no part of the view.
    const dataPath = "/xrpl/amendments.data?_routes=routes%2Fnet.amendments";
    const data = await get(dataPath);
    const body = await data.text();
    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    // The loader's data carries the ledger it was built from and the Worker's build, for an open page to order its answers and to tell a deploy.
    expect(body).toContain("anchor");
    expect(body).toContain("test-build");
    expect(body).not.toContain("example.invalid");
    expect(await storedAs(dataPath)).toEqual({ cls: "minute", ttl: CACHE_CLASSES.minute.edgeTtl });
  });

  it("serves every view from the one call to A: the builder filters", async () => {
    mock = mockUpstream("xrpl");
    const obsolete = await page("/xrpl/amendments?status=obsolete");
    const voting = await page("/xrpl/amendments?status=voting");
    // The calls of the first test are still kept (A 60 s, lastValidated 2 s), and a view is not a call: nothing reached the upstream for either.
    expect(statusesOf(mock, AMENDMENTS).length).toBeLessThanOrEqual(1);
    const rowsOf = (html: string) => amendmentRows(html).length - 1;
    expect(rowsOf(obsolete.html)).toBe(xrplAmendments.counts.obsolete);
    expect(rowsOf(voting.html)).toBe(xrplAmendments.counts.voting);
    expect(rowsOf(obsolete.html)).not.toBe(rowsOf(voting.html));
  });
});

// ---- One URL per view (1.4) ----------------------------------------------------------------------------------------------------------------

describe("the query of the URL", () => {
  it.each([
    ["?status=VOTING", "?status=voting"],
    ["?status=all", ""],
    ["?status=", ""],
    ["?status=bogus", ""],
    ["?x=1&status=enabled", "?status=enabled"],
    ["?status=majority&status=voting", "?status=majority"],
    ["?status=Obsolete&x=1", "?status=obsolete"],
  ])("redirects %s to %j with no call", async (query, to) => {
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    const response = await get(`/xrpl/amendments${query}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amendments${to}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    // No call: none reached the upstream, and none was asked of the subrequest cache either (XRPL's calls are warm there from the first render, so an answer from it
    // would not show in `mock.requests`).
    expect(mock.requests).toEqual([]);
    expect(lookups).toEqual([]);
    expect(await storedAs(`/xrpl/amendments${query}`)).toEqual({ cls: "short", ttl: 30 });
  });

  it("is checked by a spy that does see a lookup: a canonical view makes them", async () => {
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    await page("/xrpl/amendments?status=voting");
    expect(lookups.length).toBeGreaterThan(0);
  });
});

// ---- The page without JavaScript (5.1) ----------------------------------------------------------------------------------------------------

describe("the page without JavaScript", () => {
  it("xrpl: holds the activating card, the rules, the chips and every row, with the server's words and no age or countdown", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/amendments");
    const text = textOf(html);

    // Activating soon: the one majority, and its link.
    const majority = xrplAmendments.amendments.find((row) => row.status === "majority")!;
    expect(html).toContain('aria-label="Activating soon"');
    expect(elementText(html, "amendments__soonline")).toBe(`${majority.name} activates on or soon after Oct 21, 2026, 17:08 UTC, if it keeps more than 80%`);
    expect(elementText(html, "amendments__soonunder")).toBe("30 of 33 UNL validators vote yes · majority since Oct 7, 2026, held for 14 days before it activates");
    expect(hrefs(html)).toContain(`/xrpl/amendments/${majority.name}`);

    // The rules paragraph, from the rules, with the flag ledger as text and the server's text of the countdown to it.
    expect(elementText(html, "amendments__rules")).toBe(
      "Validators vote in the ledger before every flag ledger, once every 256 ledgers. An amendment that keeps more than 80% of the UNL for 14 days in a row is enabled at the flag ledger that follows, by an EnableAmendment pseudo-transaction in the ledger after it. Next flag ledger #107,721,472 expected 17:02 UTC.",
    );
    expect(hrefs(html).some((href) => href.includes("107721472"))).toBe(false);

    // The chips, with A's counts, and the table: every amendment, in A's order.
    const chips = anchors(html).map((a) => a.text);
    expect(chips).toEqual(expect.arrayContaining(["All 9", "Activating 1", "Voting 3", "Activated 3", "Obsolete 1", "Unknown 1"]));
    const rows = amendmentRows(html);
    expect(rows[0]).toEqual(["#", "Amendment", "Introduced", "Consensus, UNL", "Status", "Enabled on"]);
    expect(rows.length - 1).toBe(xrplAmendments.count);
    expect(rows.slice(1).map((row) => row[0])).toEqual(xrplAmendments.amendments.map((_, index) => String(index + 1)));
    expect(rows[1]![1]).toContain("MPTokensV1");
    expect(rows[1]![4]).toBe("Activating, expected Oct 21");
    expect(text).toContain("9 amendments · the tick on each bar marks 80%");

    // Nothing that depends on when the page is read.
    expect(text).not.toContain("in ~");
    expect(text).not.toMatch(/\bin \d+ days\b/);
    expect(text).not.toMatch(/\d+ (seconds?|minutes?|hours?) ago/);
    expect(text).not.toContain("at the next flag ledger");
  });

  it("xrpl: the XLS tag is a link to the document that opens a new tab, and a ledger link leads to the ledger", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/amendments");
    const text = textOf(html);
    const xls = anchors(html).find((a) => a.text.startsWith("XLS-33"))!;
    expect(xls.attrs).toContain('href="https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0033-multi-purpose-tokens"');
    expect(xls.attrs).toContain('target="_blank"');
    expect(xls.attrs).toContain('rel="noopener noreferrer"');
    expect(xls.text).toBe("XLS-33 (opens in a new tab)");
    // AMM was enabled in a ledger of the index: the date is over a link to it. fix1201 comes from the metadata file: the date has no link.
    expect(hrefs(html)).toContain("/xrpl/ledger/94982913");
    expect(amendmentRows(html).find((row) => row[1]!.startsWith("fix1201"))![5]).toBe("Nov 14, 2017");
  });

  it("xrpl: a status view holds its rows only, ranked from 1, is noindex and is stored as minute", async () => {
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amendments?status=voting";
    const { html } = await page(path);
    const text = textOf(html);
    const rows = amendmentRows(html).slice(1);
    expect(rows.map((row) => row[0])).toEqual(["1", "2", "3"]);
    expect(rows.map((row) => row[4])).toEqual(["Voting", "Voting", "Voting"]);
    expect(text).toContain("3 amendments · the tick on each bar marks 80%");
    expect(anchors(html).find((a) => a.text === "Voting 3")!.attrs).toContain('aria-current="true"');
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"\/?>/);
    expect(await storedAs(path)).toEqual({ cls: "minute", ttl: CACHE_CLASSES.minute.edgeTtl });
  });

  it("xahau: five days, its retired amendment is always on, and there is no Unknown chip", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/amendments");
    const text = textOf(html);

    expect(text).toContain("Changes to the Xahau protocol.");
    expect(elementText(html, "amendments__rules")).toContain("for 5 days in a row");
    expect(elementText(html, "amendments__soonline")).toBe("Remit activates on or soon after Oct 18, 2026, 17:40 UTC, if it keeps more than 80%");
    expect(elementText(html, "amendments__soonunder")).toBe("27 of 29 UNL validators vote yes · majority since Oct 13, 2026, held for 5 days before it activates");
    // The majority has no indexed EnableAmendment on Xahau, and the page does not need one.
    const chips = anchors(html).map((a) => a.text);
    expect(chips).toEqual(expect.arrayContaining(["All 5", "Activating 1", "Voting 1", "Activated 3", "Obsolete 0"]));
    expect(chips.some((chip) => chip.startsWith("Unknown"))).toBe(false);
    const retired = amendmentRows(html).find((row) => row[1]!.startsWith("XahauGenesis"))!;
    expect(retired[4]).toContain("retired");
    expect(retired[5]).toContain("Always on");
    expect(retired[5]).toContain("retired: always on, not listed in the ledger");
    expect(amendmentRows(html).length - 1).toBe(xahauAmendments.count);
    expect(await storedAs("/xahau/amendments")).toEqual({ cls: "minute", ttl: CACHE_CLASSES.minute.edgeTtl });
  });

  it("holds the heading, the live row and the links of a network's page", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/amendments");
    const text = textOf(html);
    expect(text).toContain("Changes to the XRPL protocol. Each one activates only after the validators on the default UNL vote it in.");
    expect(text).toContain("Live · updates every minute");
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/xrpl/validators", "/xrpl/network", "/xrpl/amendments?status=majority"]));
  });
});
