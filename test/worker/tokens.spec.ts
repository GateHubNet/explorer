import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import xahauList from "../fixtures/http/xahau/data-api/tokens@kind=issued&limit=20&min_holders=10.json";
import xrplList from "../fixtures/http/xrpl/data-api/tokens@kind=issued&limit=20&min_holders=10.json";
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

const SHORT = { cls: "short", ttl: 30 };
const MINUTE = { cls: "minute", ttl: 60 };

/** What D6 answers for a page behind a marker that holds nothing. */
const NOTHING = { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, kind: "issued", total: 60, total_below: 40, count: 0, tokens: [] };

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
    expect(html).toMatch(/aria-disabled="true"[^>]*>MPT<span class="soon">soon<\/span>/);

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
    const path = "/xrpl/tokens.data?_routes=routes%2Fnet.tokens&kind=mpt";
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain("/xrpl/tokens");
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
    ["?kind=mpt", ""],
    ["?back=M1", ""],
    ["?q=&x=1", ""],
    ["?all=1&q=USD", "?q=USD&all=1"],
    ["?all=0", ""],
    ["?q=USD&q=EUR", "?q=USD"],
    ["?q=%20USD%20", "?q=USD"],
    ["?back=B%25&marker=AAAA", "?marker=AAAA"],
    ["?back=BBBB&marker=AAAA&q=USD", "?q=USD&marker=AAAA&back=BBBB"],
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
