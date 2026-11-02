import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { namesCalls } from "../support/names";
import { alerts, expectDegraded, isNoindex, isStored, keysOf, linksTo, unavailable } from "../support/nft-pages";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { holdersMarker, tokenCase } from "../support/token-cases";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// All the holders of a token, `/{net}/token/{token}/holders` (token spec 1.3, 4 and 6), on the real Worker against the generated token answers of the data API
// (test/fixtures/http/*/data-api/tokens/…): what a failed call does to it, the 404 of a token the index lacks (as the token page's), the 404s of a page behind a marker, the calls of a first
// page and of a page behind a marker, the class each answer is stored under (`minute`, behind a marker too), the redirects that make one URL of a token, and Xahau. The off-case of `TOKENS`
// is tokens-off.spec.ts (the `worker-off` project), the names of the page tokens-names.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included, and an error or a degraded page is never stored. So the tests that fail
// a call come first, each on a token that no later test reads, and every test takes the subrequest entries away (`cold`): each call of a render reaches the mock, so an override is always the
// answer and a list of calls does not depend on the order of the tests. The page does not poll, so no call asks for the failure hold; `Date` alone is faked all the same and moved 301 s on after
// each test, past the longest keep (the edge cache's freshness reads `Date`), so that no test reads what an earlier one left. The afterEach below fails a test whose override no request used.

const { get, storedAs } = pageClient("198.18.98");

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
const FEW = await tokenCase("xrpl", "few-holders");
const LP = await tokenCase("xrpl", "lp");
const EVR = await tokenCase("xahau", "evr");
const NOD = await tokenCase("xahau", "xahau-unlisted");
const MORE = await holdersMarker("xrpl");

type Asset = { currency: string; issuer: string };
/** An issuer the fixtures give no token (a valid address): the tokens of the tests that find nothing. */
const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const asset = (currency: string, issuer = ISSUER): Asset => ({ currency, issuer });
const pathOf = (token: Asset) => `${token.currency}.${token.issuer}`;

/** #1: the token. */
const TOKEN = (token: Asset) => `GET /v2/tokens/${pathOf(token)}`;
/** #2: its holders, 50 to a page. */
const HOLDERS = (token: Asset, marker?: string) => `${TOKEN(token)}/holders?limit=50${marker === undefined ? "" : `&marker=${marker}`}`;
/** The `limit=1` list call of the 404. */
const COVERAGE = "GET /v2/tokens?kind=issued&limit=1&min_holders=10";

const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };
const SHORT = { cls: "short", ttl: 30 };
const MINUTE = { cls: "minute", ttl: 60 };
const SLOW = { cls: "slow", ttl: 3600 };

/** The page at `path`: its status, headers and HTML. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

const holdersRows = (html: string) => tableRows(html, "Holders").slice(1);

/** The table of the holders, without the foot of its card. */
const tableOf = (html: string) => {
  const start = html.indexOf('role="table" aria-label="Holders"');
  expect(start, "no table of holders").toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('class="card__foot', start));
};

/** The text of each row of the holders (a row's meter is a box inside it, which `tableRows` stops at): the rank first and the status last, the foot of the card not among them. */
const rowTexts = (html: string) =>
  tableOf(html)
    .split('role="row"')
    .slice(2)
    // A chunk ends where the next row's tag was cut: `<div `.
    .map((row) => textOf(row.slice(row.indexOf(">") + 1).replace(/<[^>]*$/, "")));

// ---- Failures first, each on a token no later test reads -----------------------------------------------------------------------------------------------------------------------------

describe("the call that decides the page fails (spec 1.3)", () => {
  it("Cannot GET of the token is a 503 not stored, and no holders list is drawn", async () => {
    cold();
    const token = asset("AAA");
    mock = mockUpstream("xrpl", { [TOKEN(token)]: dataApiError(404, `Cannot GET /v2/tokens/${pathOf(token)}`) });
    const path = `/xrpl/token/${pathOf(token)}/holders`;
    const { response, text } = await render(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, TOKEN(token))).toEqual([404]);
    expect(text).not.toContain("Cannot GET");
    expect(await isStored(path)).toBe(false);
  });

  it("a 429, a malformed 200 and a 200 for another token are 503s not stored", async () => {
    cold();
    const limited = asset("BBB");
    mock = mockUpstream("xrpl", { [TOKEN(limited)]: dataApiError(429, "slow down") });
    const rate = await render(`/xrpl/token/${pathOf(limited)}/holders`);
    expect(rate.response.status).toBe(503);
    expect(statusesOf(mock, TOKEN(limited))).toEqual([429]);
    expect(await isStored(`/xrpl/token/${pathOf(limited)}/holders`)).toBe(false);
    mock.restore();

    const odd = asset("CCC");
    mock = mockUpstream("xrpl", { [TOKEN(odd)]: { result: "success", coverage: { complete: true, from_ledger_index: 32570 } } });
    expect((await render(`/xrpl/token/${pathOf(odd)}/holders`)).response.status).toBe(503);
    mock.restore();

    const other = asset("DDD");
    mock = mockUpstream("xrpl", { [TOKEN(other)]: (await import("../fixtures/http/xrpl/data-api/tokens/USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B.json")).default });
    expect((await render(`/xrpl/token/${pathOf(other)}/holders`)).response.status).toBe(503);
  });

  it("a 400 for a path the loader checked is a 503 too", async () => {
    cold();
    const token = asset("EEE");
    mock = mockUpstream("xrpl", { [TOKEN(token)]: dataApiError(400, "invalid request") });
    const { response } = await render(`/xrpl/token/${pathOf(token)}/holders`);
    expect(response.status).toBe(503);
    expect(statusesOf(mock, TOKEN(token))).toEqual([400]);
    expect(await isStored(`/xrpl/token/${pathOf(token)}/holders`)).toBe(false);
  });
});

describe("the call that decides the page misses the card deadline (spec 1.3, final review M2)", () => {
  it("is a 503 not stored, at the deadline (4.5 s), and no list is drawn: a missed deadline of #1 is an outage, not a bug", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const token = asset("JJJ");
    mock = mockUpstream("xrpl", { [TOKEN(token)]: () => new Promise<Response>(() => {}) });
    const path = `/xrpl/token/${pathOf(token)}/holders`;
    const started = performance.now();
    const { response, text } = await render(path);

    expect(performance.now() - started).toBeLessThan(10_000);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(text).not.toContain("We couldn’t find");
    expect(await isStored(path)).toBe(false);
  });
});

describe("a token the index lacks (spec 1.3), as the token page's", () => {
  it("is a 404 of class short with the issuer's account to open and the coverage note", async () => {
    cold();
    const token = asset("FFF");
    const path = `/xrpl/token/${pathOf(token)}/holders`;
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find FFF issued by rhub8V…F3wq on XRPL.");
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
    const path = `/xrpl/token/${pathOf(token)}/holders`;
    mock = mockUpstream("xrpl", { [COVERAGE]: unavailable() });
    const { response, text } = await render(path);
    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find GGG issued by rhub8V…F3wq on XRPL.");
    expect(text).not.toContain("A token whose trust lines have not changed since");
    // Logged, as the token page's is (final review, T7-T9 Minor 6).
    expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { level: "error", what: "the token list for the coverage note of a missing token could not be loaded", path, error: expect.stringContaining("503") },
    ]);
  });

  it("is the same behind a marker: a token the index lacks, whatever the page", async () => {
    cold();
    const token = asset("HHH");
    mock = mockUpstream("xrpl");
    const { response, text } = await render(`/xrpl/token/${pathOf(token)}/holders?marker=AAAA`);
    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find HHH issued by rhub8V…F3wq on XRPL.");
    expect(statusesOf(mock, TOKEN(token))).toEqual([404]);
  });
});

describe("the holders call fails (spec 4)", () => {
  it("is a 200 with the list's SectionError and Retry, the head standing, and not stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [HOLDERS(FEW)]: unavailable() });
    const path = `/xrpl/token/${FEW.path}/holders`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, HOLDERS(FEW))).toEqual([503]);
    expect(text).toContain("Couldn’t load the holders.");
    expect(alerts(html)).toBe(1);
    expect(html).toContain("Holders of TIN");
    expect(html).not.toContain('role="table"');
    expect(linksTo(html, "Back to TIN")).toEqual([`/xrpl/token/${FEW.path}`]);
  });

  it("is the same behind a marker: a 200 with the SectionError, not stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const key = HOLDERS(USD, "CCCC");
    mock = mockUpstream("xrpl", { [key]: unavailable() });
    const path = `/xrpl/token/${USD.path}/holders?marker=CCCC`;
    const { response, text } = await render(path);

    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the holders.");
  });

  it("does not hold the page for a holders call that never answers: the list says it failed at the card deadline (4.5 s), and the page is not stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [HOLDERS(USD)]: () => new Promise<Response>(() => {}) });
    const path = `/xrpl/token/${USD.path}/holders`;
    const started = performance.now();
    const { response, text } = await render(path);

    expect(performance.now() - started).toBeLessThan(10_000);
    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the holders.");
    expect(text).toContain("Holders of USD");
  });
});

describe("a page behind a marker that is not there (spec 1.3)", () => {
  it("is a 404 of class short for a marker the API refuses and for a page with nothing behind it", async () => {
    cold();
    const refused = HOLDERS(RLUSD, "AAAA");
    const empty = HOLDERS(RLUSD, "BBBB");
    mock = mockUpstream("xrpl", {
      [refused]: dataApiError(400, "invalid marker"),
      [empty]: { result: "success", coverage: { complete: false, from_ledger_index: 93663334 }, ledger_index: 107000000, close_time: "2026-10-24T14:21:42Z", supply: "21898528.59363", count: 0, holders: [] },
    });
    const one = await render(`/xrpl/token/${RLUSD.path}/holders?marker=AAAA`);
    expect(one.response.status).toBe(404);
    expect(one.text).toContain("that page of the holders of RLUSD");
    expect(statusesOf(mock, refused)).toEqual([400]);
    expect(await storedAs(`/xrpl/token/${RLUSD.path}/holders?marker=AAAA`)).toEqual(SHORT);

    const two = await render(`/xrpl/token/${RLUSD.path}/holders?marker=BBBB`);
    expect(two.response.status).toBe(404);
    expect(statusesOf(mock, empty)).toEqual([200]);
    expect(await storedAs(`/xrpl/token/${RLUSD.path}/holders?marker=BBBB`)).toEqual(SHORT);
  });

  it("is a 404 of class short, before any call and before any redirect, for a marker that is none", async () => {
    mock = mockUpstream("xrpl");
    for (const path of [`/xrpl/token/${RLUSD.path}/holders?marker=%25`, `/xrpl/token/${RLUSD.path}/holders?back=AAAA&marker=%25&x=1`, `/xrpl/token/usd.${USD.issuer}/holders?marker=%25`]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text).toContain("that page of the holders of");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });
});

// ---- The first page --------------------------------------------------------------------------------------------------------------------------------------------------------

describe("the first page of the holders of a token", () => {
  it("makes exactly the token call, the holders call with limit 50 and the names call for RLUSD, and is stored minute", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/token/${RLUSD.path}/holders`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests).sort()).toEqual([TOKEN(RLUSD), HOLDERS(RLUSD)].sort());
    // The calls of the token page that this page does not need are not made: no transfers, no pools, no volume, no node.
    expect(mock.requests.some((request) => request.key.startsWith("node ") || request.url.includes("/transfers") || request.url.includes("/amm/") || request.url.includes("amm_volume"))).toBe(false);
    expect(namesCalls(mock)).toHaveLength(1);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(html)).toBe(false);

    // The head.
    expect(html).toContain("<title>Holders of RLUSD · XRPL · explorer</title>");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test/xrpl/token/${RLUSD.path}/holders"/>`);
    expect(html).not.toContain("og:image");
    expect(elementText(html, "tokens__title")).toBe("Holders of RLUSD");
    expect(text).toContain("XRPL / Tokens / RLUSD / Holders");
    expect(text).toContain("96 accounts hold 21,898,528.59363 RLUSD");
    expect(linksTo(html, "Back to RLUSD")).toEqual([`/xrpl/token/${RLUSD.path}`]);
    // The header's Tokens item is the page of the section (aria-current="true").
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*>Tokens<\/a>/);

    // The table: 50 rows, the columns of the top holders and Limit and Status; D6's own text for the figures.
    expect(tableRows(html, "Holders")[0]).toEqual(["#", "Holder", "Balance (RLUSD)", "Share of supply", "Limit", "Status"]);
    const rows = holdersRows(html);
    expect(rows).toHaveLength(50);
    expect(rows[0]![0]).toBe("1");
    expect(rows[49]![0]).toBe("50");
    // The second line of RLUSD's fixtures is frozen: its status says so in a word, in its own column, and the first line has none.
    const texts = rowTexts(html);
    expect(texts[0]).toMatch(/ — none$/);
    expect(texts[1]).toMatch(/^2 .* Frozen$/);
    expect(tableOf(html).match(/>Frozen</g)).toHaveLength(1);
    expect(text).toContain("Covers ledger #93,663,334 onwards: earlier trust lines are not in the index yet.");
    expect(text).toContain("Largest balance first.");
  });

  it("has Previous disabled and More holders carrying the holders answer's marker", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render(`/xrpl/token/${RLUSD.path}/holders`);
    const next = linksTo(html, "More holders");
    expect(next).toEqual([expect.stringMatching(new RegExp(`^/xrpl/token/${RLUSD.path.replace(/\./g, "\\.")}/holders\\?marker=[A-Za-z0-9_-]+$`))]);
    expect(linksTo(html, "Previous")).toEqual([]);
    expect(html).toMatch(/class="btn is-disabled" aria-disabled="true"[^>]*>(<svg[^>]*>.*?<\/svg>)?Previous/);
  });

  it("links every holder to its account", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render(`/xrpl/token/${RLUSD.path}/holders`);
    const accounts = anchors(html).flatMap((a) => /href="(\/xrpl\/account\/[^"]*)"/.exec(a.attrs)?.[1] ?? []);
    expect(accounts.length).toBeGreaterThanOrEqual(50);
  });

  it("says Authorized of no line when the issuer does not require authorisation (USD)", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { html } = await render(`/xrpl/token/${USD.path}/holders`);
    expect(tableOf(html)).not.toContain("Authorized");
  });
});

describe("a page of more holders", () => {
  it("makes the token call and the holders call with the marker and the names call, is stored minute, noindex, and continues the ranks", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/token/${MORE.token}/holders?marker=${MORE.marker}`;
    const token = await tokenCase("xrpl", "lions");
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests).sort()).toEqual([TOKEN(token), HOLDERS(token, MORE.marker)].sort());
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>Holders of LIONS · XRPL · explorer</title>");
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("og:title");
    // The second page: ranks continue from 51, and Previous goes back to the first page.
    const rows = holdersRows(html);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]![0]).toBe("51");
    expect(linksTo(html, "Previous")).toEqual([`/xrpl/token/${MORE.token}/holders`]);
    expect(text).toContain("accounts hold");
  });
});

describe("Xahau", () => {
  it("makes no AMM call, names its page for the network, and the holders of EVR are D6's", async () => {
    cold();
    mock = mockUpstream("xahau");
    const path = `/xahau/token/${EVR.path}/holders`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(keysOf(mock.requests).sort()).toEqual([TOKEN(EVR), HOLDERS(EVR)].sort());
    expect(html).toContain("<title>Holders of EVR · Xahau · explorer</title>");
    expect(text).toContain("Xahau / Tokens / EVR / Holders");
    expect(holdersRows(html)).toHaveLength(50);
    expect(await storedAs(path)).toEqual(MINUTE);
  });

  it("says Authorized for the lines of an issuer that requires authorisation (NOD)", async () => {
    cold();
    mock = mockUpstream("xahau");
    const { html } = await render(`/xahau/token/${NOD.path}/holders`);
    // NOD's issuer requires authorisation and D6 gives its lines as authorized.
    expect(rowTexts(html).filter((row) => row.endsWith("Authorized")).length).toBeGreaterThan(0);
    expect(tableOf(html).match(/>Authorized</g)!.length).toBeGreaterThan(10);
  });
});

// ---- Redirects and what is no token (spec 1.3), all before any call ---------------------------------------------------------------------------------------------------------------

describe("the URL of the holders", () => {
  it.each([
    [`usd.${USD.issuer}/holders`, `/xrpl/token/USD.${USD.issuer}/holders`, IMMUTABLE],
    [`${RLUSD.currency}+${RLUSD.issuer}/holders`, `/xrpl/token/RLUSD.${RLUSD.issuer}/holders`, IMMUTABLE],
    [`0000000000000000000000005553440000000000.${USD.issuer}/holders`, `/xrpl/token/USD.${USD.issuer}/holders`, IMMUTABLE],
    [`RLUSD.${RLUSD.issuer}/holders?x=1&back=M`, `/xrpl/token/RLUSD.${RLUSD.issuer}/holders`, SHORT],
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
    const kept = await get(`/xrpl/token/usd.${USD.issuer}/holders?marker=M2&back=M1`);
    await kept.text();
    expect(kept.headers.get("Location")).toBe(`/xrpl/token/USD.${USD.issuer}/holders?marker=M2&back=M1`);
    expect(await storedAs(`/xrpl/token/usd.${USD.issuer}/holders?marker=M2&back=M1`)).toEqual(IMMUTABLE);
    expect(mock.requests).toEqual([]);
  });

  it("redirects an LP token to its pool, class slow, with no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/token/${LP.path}/holders`);
    await response.text();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amm/${LP.issuer}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(`/xrpl/token/${LP.path}/holders`)).toEqual(SLOW);
  });

  it("is a 404 with its note for XRP alone, and for USD alone, with no call", async () => {
    mock = mockUpstream("xrpl");
    const native = await render("/xrpl/token/XRP/holders");
    expect(native.response.status).toBe(404);
    expect(native.text).toContain("XRP is XRPL's own currency, not an issued token.");
    expect(await storedAs("/xrpl/token/XRP/holders")).toEqual(SHORT);
    const code = await render("/xrpl/token/USD/holders");
    expect(code.response.status).toBe(404);
    expect(code.text).not.toContain("own currency");
    expect(mock.requests).toEqual([]);
  });

  it("is not a page under another path: the token page's other segments are the not-found page, with no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/token/${RLUSD.path}/holder`);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the .data URL of the holders (a client-side navigation)", () => {
  it("answers the page's data and not a redirect for the canonical URL, and carries no host or key", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const dataPath = `/xrpl/token/${RLUSD.path}/holders.data?_routes=routes%2Fnet.token.%24token.holders`;
    const data = await get(dataPath);
    const body = await data.text();

    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("Holders of RLUSD");
    expect(body).not.toContain("trust_lines");
    expect(body).not.toContain("data.example.invalid");
  });
});
