import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { namesCalls } from "../support/names";
import { alerts, expectDegraded, isNoindex, isStored, keysOf, linksTo, tiles, unavailable } from "../support/nft-pages";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { tokenCase, transfersMarker } from "../support/token-cases";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// One issued token's page, `/{net}/token/{token}` (token spec 1.3, 3 and 6), on the real Worker against the generated token answers of the data API (test/fixtures/http/*/data-api/tokens/…):
// what a failed call does to it, the 404 of a token the index lacks (with and without the coverage note), what a failed card does, the calls of a first page and of a page behind a marker, the
// class each answer is stored under, the redirects that make one URL of a token, and Xahau. The off-case of `TOKENS` is tokens-off.spec.ts (the `worker-off` project), the names of the page
// tokens-names.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included, and an error or a degraded page is never stored. So the tests that fail
// a call come first, each on a token that no later test reads, and every test takes the subrequest entries away (`cold`): each call of a render reaches the mock, so an override is always the
// answer and a list of calls does not depend on the order of the tests. The page does not poll, so no call asks for the failure hold; `Date` alone is faked all the same and moved 301 s on after
// each test, past the longest keep (the edge cache's freshness reads `Date`), so that no test reads what an earlier one left. The afterEach below fails a test whose override no request used.

const { get, page, stored, storedAs } = pageClient("198.18.97");

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

// ---- The tokens of the fixtures and the calls, by the keys the mock names them (its query sorted by name) ---------------------------------------------------------------------------

const RLUSD = await tokenCase("xrpl", "rlusd");
const USD = await tokenCase("xrpl", "usd");
const LIONS = await tokenCase("xrpl", "lions");
const FEW = await tokenCase("xrpl", "few-holders");
const LP = await tokenCase("xrpl", "lp");
const EVR = await tokenCase("xahau", "evr");

type Asset = { currency: string; issuer: string };
/** Issuers the fixtures give no token (valid addresses): the tokens of the tests that make a call fail or find nothing. */
const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const OTHER_ISSUER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const asset = (currency: string, issuer = ISSUER): Asset => ({ currency, issuer });
const pathOf = (token: Asset) => `${token.currency}.${token.issuer}`;

/** #1: the token. */
const TOKEN = (token: Asset) => `GET /v2/tokens/${pathOf(token)}`;
/** #2: its top holders. */
const HOLDERS = (token: Asset) => `${TOKEN(token)}/holders?limit=10`;
/** #3: its transfers, newest first. */
const TRANSFERS = (token: Asset, marker?: string) => `${TOKEN(token)}/transfers?descending=true&limit=20${marker === undefined ? "" : `&marker=${marker}`}`;
/** #4: the pools holding it, which is the AMM list's key for the asset (as the mock names a request: a plus is a plus). */
const POOLS = (token: Asset) => `GET /v2/amm/pools?asset=${token.currency}+${token.issuer}&limit=20`;
/** The same as an override names it: a plus in a query is a space, so the separator is written as the request escapes it. */
const POOLS_OVERRIDE = (token: Asset) => `GET /v2/amm/pools?asset=${token.currency}%2B${token.issuer}&limit=20`;
/** #5: the live AMM volume. */
const VOLUME = "GET /v2/network/amm_volume?live=day";
/** The `limit=1` list call of the 404. */
const COVERAGE = "GET /v2/tokens?kind=issued&limit=1&min_holders=10";
/** #7: the node's account of the issuer. */
const ACCOUNT_INFO = (issuer: string) => `node account_info account=${issuer}&ledger_index=validated`;

const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };
const SHORT = { cls: "short", ttl: 30 };
const LIVE = { cls: "live", ttl: 5 };
const SLOW = { cls: "slow", ttl: 3600 };

/** The page at `path`: its status, headers and HTML. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

/** The HTML of the card titled `title` (the HTML escapes an apostrophe), up to the next card's heading. */
const cardOf = (html: string, title: string) => {
  const start = html.indexOf(`>${title.replace(/'/g, "&#x27;")}</h2>`);
  expect(start, `no card ${title}`).toBeGreaterThan(-1);
  const next = html.indexOf('<h2 id="', start + 10);
  return html.slice(start, next < 0 ? undefined : next);
};

// ---- Failures first, each on a token no later test reads -----------------------------------------------------------------------------------------------------------------------------

describe("the call that decides the page fails (spec 1.3)", () => {
  it("Cannot GET of the token is a 503 not stored", async () => {
    cold();
    const token = asset("AAA");
    // The framework's "Cannot GET" 404, which a data API without D6 answers: an outage and never a page (`null` would be the route's own `token not found`).
    mock = mockUpstream("xrpl", { [TOKEN(token)]: dataApiError(404, `Cannot GET /v2/tokens/${pathOf(token)}`) });
    const { response, text } = await render(`/xrpl/token/${pathOf(token)}`);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, TOKEN(token))).toEqual([404]);
    expect(text).not.toContain("Cannot GET");
    expect(await isStored(`/xrpl/token/${pathOf(token)}`)).toBe(false);
  });

  it("a 429 and a malformed 200 of the token are 503s not stored", async () => {
    cold();
    const limited = asset("BBB");
    mock = mockUpstream("xrpl", { [TOKEN(limited)]: dataApiError(429, "slow down") });
    const rate = await render(`/xrpl/token/${pathOf(limited)}`);
    expect(rate.response.status).toBe(503);
    expect(statusesOf(mock, TOKEN(limited))).toEqual([429]);
    expect(await isStored(`/xrpl/token/${pathOf(limited)}`)).toBe(false);
    mock.restore();

    // A 200 that is not what D6 promises: no token in it.
    const odd = asset("CCC");
    mock = mockUpstream("xrpl", { [TOKEN(odd)]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 } } });
    const malformed = await render(`/xrpl/token/${pathOf(odd)}`);
    expect(malformed.response.status).toBe(503);
    expect(await isStored(`/xrpl/token/${pathOf(odd)}`)).toBe(false);
    mock.restore();

    // A 200 for another token than the one asked for is no answer to it either.
    const other = asset("DDD");
    mock = mockUpstream("xrpl", { [TOKEN(other)]: (await import("../fixtures/http/xrpl/data-api/tokens/USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B.json")).default });
    const wrong = await render(`/xrpl/token/${pathOf(other)}`);
    expect(wrong.response.status).toBe(503);
  });

  it("a 400 for a path the loader checked is a 503 too", async () => {
    cold();
    const token = asset("EEE");
    mock = mockUpstream("xrpl", { [TOKEN(token)]: dataApiError(400, "invalid request") });
    const { response } = await render(`/xrpl/token/${pathOf(token)}`);
    expect(response.status).toBe(503);
    expect(statusesOf(mock, TOKEN(token))).toEqual([400]);
    expect(await isStored(`/xrpl/token/${pathOf(token)}`)).toBe(false);
  });
});

describe("the call that decides the page misses the card deadline (spec 1.3, final review M2)", () => {
  it("is a 503 not stored, at the deadline (4.5 s), and no page is drawn: a missed deadline of #1 is an outage, not a bug", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const token = asset("JJJ");
    // The token's call never answers; the other calls of the page are not found for a token the fixtures lack.
    mock = mockUpstream("xrpl", { [TOKEN(token)]: () => new Promise<Response>(() => {}) });
    const path = `/xrpl/token/${pathOf(token)}`;
    const started = performance.now();
    const { response, html, text } = await render(path);

    expect(performance.now() - started).toBeLessThan(10_000);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(html).not.toContain('<h1 id="token-title"');
    expect(text).not.toContain("We couldn’t find");
    expect(await isStored(path)).toBe(false);
  });
});

describe("a token the index lacks (spec 1.3)", () => {
  it("is a 404 of class short with the issuer's account to open and the coverage note", async () => {
    cold();
    const token = asset("FFF");
    const path = `/xrpl/token/${pathOf(token)}`;
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find FFF issued by rhub8V…F3wq on XRPL.");
    // The index is not complete (the fixtures' coverage starts at a ledger), so a token that exists may be missing from it: the note says so, from the `limit=1` list call made only here.
    expect(text).toContain("Covers ledger #93,663,334 onwards: earlier trust lines are not in the index yet. A token whose trust lines have not changed since is not listed yet.");
    expect(statusesOf(mock, TOKEN(token))).toEqual([404]);
    expect(statusesOf(mock, COVERAGE)).toEqual([200]);
    expect(linksTo(html, "Open the issuer's account")).toEqual([`/xrpl/account/${ISSUER}`]);
    expect(await storedAs(path)).toEqual(SHORT);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
  });

  it("is a 404 without the note when the coverage call fails", async () => {
    cold();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = asset("GGG");
    const path = `/xrpl/token/${pathOf(token)}`;
    mock = mockUpstream("xrpl", { [COVERAGE]: unavailable() });
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find GGG issued by rhub8V…F3wq on XRPL.");
    expect(text).not.toContain("A token whose trust lines have not changed since");
    expect(statusesOf(mock, COVERAGE)).toEqual([503]);
    // The failed call changes only the words, but it is logged: a list of D6's that is down must not be a silent path (final review, T7-T9 Minor 6).
    expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { level: "error", what: "the token list for the coverage note of a missing token could not be loaded", path, error: expect.stringContaining("503") },
    ]);
    expect(linksTo(html, "Open the issuer's account")).toEqual([`/xrpl/account/${ISSUER}`]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is a 404 without the note when the index is complete", async () => {
    cold();
    const token = asset("HHH");
    mock = mockUpstream("xrpl", { [COVERAGE]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, kind: "issued", count: 0, tokens: [] } });
    const { response, text } = await render(`/xrpl/token/${pathOf(token)}`);
    expect(response.status).toBe(404);
    expect(text).not.toContain("not listed yet");
  });

  it("is the same behind a marker: a token the index lacks, whatever the page", async () => {
    cold();
    const token = asset("III");
    mock = mockUpstream("xrpl");
    const { response, text } = await render(`/xrpl/token/${pathOf(token)}?marker=AAAA`);
    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find III issued by rhub8V…F3wq on XRPL.");
    expect(statusesOf(mock, TOKEN(token))).toEqual([404]);
  });
});

describe("a card that fails (spec 3.5)", () => {
  const SECTION_ERRORS = [
    ["the top holders", (token: Asset) => HOLDERS(token), "Couldn’t load the top holders."],
    ["the transfers", (token: Asset) => TRANSFERS(token), "Couldn’t load the transfers."],
    ["the AMM pools", (token: Asset) => POOLS_OVERRIDE(token), "Couldn’t load the AMM pools."],
  ] as const;

  it.each(SECTION_ERRORS)("is a 200 with its SectionError and not stored when %s cannot be had, and the rest of the page stands", async (_part, key, words) => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [key(RLUSD)]: unavailable() });
    const path = `/xrpl/token/${RLUSD.path}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain(words);
    expect(alerts(html)).toBe(1);
    expect(html).toContain('<h1 id="token-title"');
    // The other cards are told as they are.
    expect(text).toContain("Issuer settings");
    expect(text).toContain("Markets");
  });

  it("keeps the pools and says the volume could not be had when the live AMM volume fails, not stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [VOLUME]: unavailable() });
    const path = `/xrpl/token/${RLUSD.path}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Couldn't load the 24-hour volume");
    expect(alerts(html)).toBe(0);
    expect(tableRows(html, "AMM pools").slice(1).length).toBeGreaterThan(0);
  });

  it("says the settings couldn't be read, with Retry, when D6 has none and the node fails (LIONS), not stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const info = ACCOUNT_INFO(LIONS.issuer);
    mock = mockUpstream("xrpl", { [info]: () => new Response("down", { status: 503 }) });
    const path = `/xrpl/token/${LIONS.path}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, info)).toEqual([503]);
    expect(text).toContain("The issuer's settings couldn't be read.");
    expect(alerts(html)).toBe(1);
  });

  it("does not hold the page for a node that is slow: the settings card says so at the card deadline (4.5 s), and the page is not stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const info = ACCOUNT_INFO(LIONS.issuer);
    // LIONS has no settings of D6's, so the node is asked, and its call never answers.
    mock = mockUpstream("xrpl", { [info]: () => new Promise<Response>(() => {}) });
    const path = `/xrpl/token/${LIONS.path}`;
    const started = performance.now();
    const { response, text } = await render(path);

    expect(performance.now() - started).toBeLessThan(10_000);
    await expectDegraded(path, response);
    expect(text).toContain("The issuer's settings couldn't be read.");
    // The rest of the page stands.
    expect(text).toContain("Recent transfers");
  });
});

// ---- The first page --------------------------------------------------------------------------------------------------------------------------------------------------------

describe("the first page of a token on XRPL", () => {
  it("makes exactly calls #1 to #5 and the names call for RLUSD, and is stored live", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/token/${RLUSD.path}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests).sort()).toEqual([TOKEN(RLUSD), HOLDERS(RLUSD), TRANSFERS(RLUSD), POOLS(RLUSD), VOLUME].sort());
    // The issuer's settings are D6's, so the node is not asked, and the names are one call, after them.
    expect(mock.requests.some((request) => request.key.startsWith("node "))).toBe(false);
    expect(namesCalls(mock)).toHaveLength(1);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    expect(await storedAs(path)).toEqual(LIVE);
    expect(isNoindex(html)).toBe(false);

    // The head.
    expect(html).toContain("<title>Ripple USD (RLUSD) · XRPL · explorer</title>");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test/xrpl/token/${RLUSD.path}"/>`);
    expect(html).toContain(`<meta property="og:image" content="https://explorer.test/og/xrpl/token/${RLUSD.path}.png"/>`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(elementText(html, "token-page__title")).toBe("Ripple USD");
    // The breadcrumb and the header's Tokens item (the page of the section, aria-current="true").
    expect(text).toContain("XRPL / Tokens / RLUSD");
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*>Tokens<\/a>/);
    expect(text).toContain("Issued token");
    expect(linksTo(html, "Issuer account")).toEqual([`/xrpl/account/${RLUSD.issuer}`]);

    // The figures: D6's own text.
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Supply", "Holders", "Trust lines", "Price", "Volume, 24 h"]);
    expect(tiles(html).map((tile) => tile.value)).toEqual(["21,898,528.59363", "96", "127", "0.40742598 XRP", "7,307.43 XRP"]);
    expect(text).toContain("−9.34% in 24 h");
    expect(text).toContain("31 of them with a zero balance");
    expect(text).toContain("Covers ledger #93,663,334 onwards: earlier trust lines are not in the index yet.");

    // The cards, top to bottom.
    const titles = [...html.matchAll(/<h2 id="[^"]*" class="card__title">([^<]*)<\/h2>/g)].map((match) => textOf(match[1]!));
    expect(titles).toEqual(["From ripple.com's toml", "Issuer settings", "Markets", "AMM pools", "Top holders", "Recent transfers"]);
    expect(cardOf(html, "From ripple.com's toml")).toContain("A US dollar stablecoin");
    expect(cardOf(html, "Issuer settings")).toContain("The issuer can take RLUSD back from a holder");
    expect(tableRows(html, "Markets").slice(1)).toHaveLength(3);
    expect(tableRows(html, "AMM pools").slice(1)).toHaveLength(4);
    expect(tableRows(html, "Recent transfers").slice(1)).toHaveLength(20);
    expect(cardOf(html, "Top holders")).toContain("The top 10 hold");
    expect(linksTo(html, "All 96 holders →")).toEqual([`/xrpl/token/${RLUSD.path}/holders`]);
    expect(text).toContain("Newest first. A transfer from");
    // The transfers' Older link carries the marker and the page's own trail.
    expect(linksTo(html, "Older")).toEqual([expect.stringMatching(new RegExp(`^/xrpl/token/${RLUSD.path.replace(/\./g, "\\.")}\\?marker=`))]);
  });

  it("links the markets to the pair page and the pools to their page", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render(`/xrpl/token/${RLUSD.path}`);
    const hrefs = anchors(html).flatMap((a) => /href="([^"]*)"/.exec(a.attrs)?.[1] ?? []);
    expect(hrefs).toContain(`/xrpl/markets/XRP/${RLUSD.path}`);
    expect(hrefs.filter((href) => href.startsWith("/xrpl/amm/"))).toHaveLength(4);
    expect(hrefs.filter((href) => href.startsWith("/xrpl/tx/"))).toHaveLength(20);
  });

  it("asks the pools with the AMM list's own key for that asset, so that the two pages share one entry", async () => {
    cold();
    mock = mockUpstream("xrpl");
    await render(`/xrpl/amm?asset=${RLUSD.path}`);
    expect(keysOf(mock.requests)).toContain(POOLS(RLUSD));
  });

  it("asks the node's account_info for LIONS, whose answer has no issuer_settings, and only then", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/token/${LIONS.path}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(200);
    expect(mock.requests.filter((request) => request.key.startsWith("node ")).map((request) => request.key)).toEqual([ACCOUNT_INFO(LIONS.issuer)]);
    expect(text).toContain("Read live from the network");
    // Flags 0x980000: default ripple on, nothing else of the six.
    expect(text).toContain("Default ripple On");
    expect(await storedAs(path)).toEqual(LIVE);
  });

  it("is a token with a name, with no toml, a transfer fee and a 3-character code: USD", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render(`/xrpl/token/${USD.path}`);
    expect(response.status).toBe(200);
    expect(html).toContain(`<title>USD by ${USD.issuer.slice(0, 6)}…${USD.issuer.slice(-4)} · XRPL · explorer</title>`);
    expect(text).toContain("Transfer fee 0.2%");
    // A domain whose toml does not list the token, and a toml_url to its file.
    expect(text).toContain("bitstamp.net's toml has no [[CURRENCIES]] entry for USD by this issuer.");
    expect(linksTo(html, "xrp-ledger.toml (opens in a new tab)")).toEqual(["https://bitstamp.net/.well-known/xrp-ledger.toml"]);
  });
});

describe("Xahau", () => {
  it("makes no AMM call, says the token trades on the order book only, and names its toml xahau.toml", async () => {
    cold();
    mock = mockUpstream("xahau");
    const path = `/xahau/token/${EVR.path}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests).sort()).toEqual([TOKEN(EVR), HOLDERS(EVR), TRANSFERS(EVR)].sort());
    expect(mock.requests.some((request) => request.url.includes("/v2/amm/") || request.url.includes("amm_volume"))).toBe(false);
    expect(text).toContain("Xahau has no AMM, so EVR trades only on the order book here.");
    expect(text).toContain("DEX trades of the last 24 hours");
    expect(text).toContain("xahau.toml");
    expect(html).toContain("<title>Evernode (EVR) · Xahau · explorer</title>");
    expect(tiles(html)[3]!.value).toBe("0.12045842 XAH");
    // The toml's icon is not an https: URL: it is text, never a link or an image.
    expect(cardOf(html, "From evernode.org's toml")).toContain("ipfs://evernode/evr.png");
    expect(html).not.toContain('href="ipfs:');
    expect(html).not.toMatch(/<img[^>]*evr\.png/);
    expect(await storedAs(path)).toEqual(LIVE);
  });
});

// ---- A page behind a marker -------------------------------------------------------------------------------------------------------------------------------------------------

describe("a page of older transfers", () => {
  it("makes #1 and #3 with the marker and the names call, is stored slow, noindex, and is the header and the transfers only", async () => {
    cold();
    const older = await transfersMarker("xrpl");
    mock = mockUpstream("xrpl");
    const path = `/xrpl/token/${older.token}?marker=${older.marker}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests).sort()).toEqual([TOKEN(RLUSD), TRANSFERS(RLUSD, older.marker)].sort());
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>Older transfers of RLUSD · XRPL · explorer</title>");
    expect(html).not.toContain("og:image");
    expect(tableRows(html, "Older transfers").slice(1).length).toBeGreaterThan(0);
    expect([...html.matchAll(/<h2 id="[^"]*" class="card__title">([^<]*)<\/h2>/g)].map((match) => match[1])).toEqual(["Older transfers"]);
    expect(html).not.toContain('aria-label="Figures"');
    expect(linksTo(html, "Back to RLUSD")).toEqual([`/xrpl/token/${older.token}`]);
    // Newer goes back to the first page.
    expect(linksTo(html, "Newer")).toEqual([`/xrpl/token/${older.token}`]);
  });

  it("is a 404 of class short for a marker the API refuses and for a page with nothing behind it", async () => {
    cold();
    const refused = TRANSFERS(RLUSD, "AAAA");
    const empty = TRANSFERS(RLUSD, "BBBB");
    mock = mockUpstream("xrpl", {
      [refused]: dataApiError(400, "invalid marker"),
      [empty]: { result: "success", coverage: { complete: false, from_ledger_index: 93663334 }, count: 0, transfers: [] },
    });
    const one = await render(`/xrpl/token/${RLUSD.path}?marker=AAAA`);
    expect(one.response.status).toBe(404);
    expect(one.text).toContain("that page of the transfers of RLUSD");
    expect(statusesOf(mock, refused)).toEqual([400]);
    expect(await storedAs(`/xrpl/token/${RLUSD.path}?marker=AAAA`)).toEqual(SHORT);

    const two = await render(`/xrpl/token/${RLUSD.path}?marker=BBBB`);
    expect(two.response.status).toBe(404);
    expect(statusesOf(mock, empty)).toEqual([200]);
    expect(await storedAs(`/xrpl/token/${RLUSD.path}?marker=BBBB`)).toEqual(SHORT);
  });

  it("is a 404 of class short, before any call and before any redirect, for a marker that is none", async () => {
    mock = mockUpstream("xrpl");
    for (const path of [`/xrpl/token/${RLUSD.path}?marker=%25`, `/xrpl/token/${RLUSD.path}?back=AAAA&marker=%25&x=1`, `/xrpl/token/usd.${USD.issuer}?marker=%25`]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the transfers of");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("is a 503, never stored, when the transfers behind a marker cannot be had", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const key = TRANSFERS(RLUSD, "CCCC");
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const path = `/xrpl/token/${RLUSD.path}?marker=CCCC`;
    const { response } = await render(path);
    expect(response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
  });
});

// ---- Redirects and what is no token (spec 1.3), all before any call ---------------------------------------------------------------------------------------------------------------

describe("the URL of a token", () => {
  it.each([
    [`usd.${USD.issuer}`, `/xrpl/token/USD.${USD.issuer}`, IMMUTABLE],
    [`${RLUSD.currency}+${RLUSD.issuer}`, `/xrpl/token/RLUSD.${RLUSD.issuer}`, IMMUTABLE],
    [`0000000000000000000000005553440000000000.${USD.issuer}`, `/xrpl/token/USD.${USD.issuer}`, IMMUTABLE],
    [`RLUSD.${RLUSD.issuer}?x=1&back=M`, `/xrpl/token/RLUSD.${RLUSD.issuer}`, SHORT],
  ])("redirects %s to %s with no call", async (from, to, cls) => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/token/${from}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(to);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(`/xrpl/token/${from}`)).toEqual(cls);
  });

  it("keeps a marker and its trail through the redirect of a path, which is the path alone: class immutable", async () => {
    mock = mockUpstream("xrpl");
    const kept = await get(`/xrpl/token/usd.${USD.issuer}?marker=M2&back=M1`);
    await kept.text();
    expect(kept.headers.get("Location")).toBe(`/xrpl/token/USD.${USD.issuer}?marker=M2&back=M1`);
    expect(await storedAs(`/xrpl/token/usd.${USD.issuer}?marker=M2&back=M1`)).toEqual(IMMUTABLE);
    expect(mock.requests).toEqual([]);
  });

  it("redirects an LP token to its pool, class slow, with no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/token/${LP.path}`);
    await response.text();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amm/${LP.issuer}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(`/xrpl/token/${LP.path}`)).toEqual(SLOW);
  });

  it("redirects an LP token on Xahau to the path of a pool the network does not have: a 404 there, with its note", async () => {
    mock = mockUpstream("xahau");
    // A currency of 03 and 38 digits is an LP token's on any network (token-params.ts); Xahau has no AMM, so its pool page is the 404 that says so.
    const lp = `03${"AB".repeat(19)}.${EVR.issuer}`;
    const redirect = await get(`/xahau/token/${lp}`);
    await redirect.text();
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe(`/xahau/amm/${EVR.issuer}`);
    expect(mock.requests).toEqual([]);
    const pool = await render(redirect.headers.get("Location")!);
    expect(pool.response.status).toBe(404);
    expect(pool.text).toContain("Xahau has no AMM");
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 with its note for XRP alone, and a 404 for USD alone, with no call", async () => {
    mock = mockUpstream("xrpl");
    const native = await render("/xrpl/token/XRP");
    expect(native.response.status).toBe(404);
    expect(native.text).toContain("We couldn’t find token \"XRP\" on XRPL.");
    expect(native.text).toContain("XRP is XRPL's own currency, not an issued token.");
    expect(await storedAs("/xrpl/token/XRP")).toEqual(SHORT);

    const code = await render("/xrpl/token/USD");
    expect(code.response.status).toBe(404);
    expect(code.text).toContain("We couldn’t find token \"USD\" on XRPL.");
    expect(code.text).not.toContain("own currency");

    // An issuer that is no address, an X-address and an escape that is malformed: none names a token.
    for (const segment of ["USD.notanaddress", `USD.${USD.issuer}%2`, "%E0%A4%A"]) {
      const none = await render(`/xrpl/token/${segment}`);
      expect(none.response.status, segment).toBe(404);
    }
    expect(mock.requests).toEqual([]);
  });

  it("says the native currency of Xahau in its note", async () => {
    mock = mockUpstream("xahau");
    const native = await render("/xahau/token/XAH");
    expect(native.response.status).toBe(404);
    expect(native.text).toContain("XAH is Xahau's own currency, not an issued token.");
    expect(mock.requests).toEqual([]);
  });
});

describe("the .data URL of a token (a client-side navigation)", () => {
  it("answers the page's data and not a redirect for the canonical URL, and carries no host or key", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const dataPath = `/xrpl/token/${RLUSD.path}.data?_routes=routes%2Fnet.token.%24token`;
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("Ripple USD");
    expect(body).not.toContain("trust_lines");
    expect(body).not.toContain("data.example.invalid");
    expect((await stored(dataPath)) !== undefined).toBe(true);
  });
});
