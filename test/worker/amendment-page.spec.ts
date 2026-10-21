import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { formatUtc, shortHash } from "../../app/domain/format";
import { CACHE_CLASSES, HOME_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS } from "../../app/server/cache-class";
import xahauLastValidated from "../fixtures/http/xahau/data-api/last_validated.json";
import xrplLastValidated from "../fixtures/http/xrpl/data-api/last_validated.json";
import xrplAmm from "../fixtures/http/xrpl/data-api/network/amendments/AMM.json";
import xrplMajority from "../fixtures/http/xrpl/data-api/network/amendments/MPTokensV1.json";
import { anchors, elementText, pageClient, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { amendmentCall, LAST_VALIDATED, SUMMARY } from "../support/validators-calls";
import { amendmentCase } from "../support/validators-cases";

// One amendment, `/{net}/amendments/{name}` (validators spec 1.3, 1.4, 2.2, 6.3 and 6.6), on the real Worker against the generated D1 answers
// (test/fixtures/http/{net}/data-api/network/amendments/…): what a failed call does to it, the redirects that make one URL of an amendment, the calls it makes and for
// how long each is kept, the size of the page of a full 30 days, and the stored HTML.
//
// A Worker keeps what it is answered in the Cache API for the rest of the file (an error never): lastValidated for 2 s, S for 10 s and AD for 60 s of the real clock,
// one key for each network (S, lastValidated) or amendment (AD). So the tests that fail a call come first, an override of AD names an amendment no earlier test has asked
// for, and the test of the calls takes the Cache API's answers away (`cold`). The page asks for the failure hold on every call (E2 1.7): a failure is remembered for 5 s
// of `Date`, per Worker instance, so `Date` alone is faked and moved 31 s on after each test, past the longest hold (as network-hold.spec.ts does): no test meets an
// earlier one's hold, which is how test 2 comes to ask the mock for S after test 1 failed it.

const { get, page, stored, storedAs } = pageClient("198.51.114");

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

/** What the Cache API kept of the tests above must not answer: every call of the render reaches the mock. */
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

/** A redirect: its answer read, and the answer returned. */
async function redirected(path: string) {
  const response = await get(path);
  await response.text();
  return response;
}

/** The size of `text` gzipped, as a browser would be sent it (the Web's own `CompressionStream`). */
async function gzipped(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

// ---- A call that fails (6.6) ---------------------------------------------------------------------------------------------------------------

describe("a call that fails", () => {
  it("xrpl: lastValidated failing is a 503 that is not stored", async () => {
    const { name } = await amendmentCase("xrpl", "voting");
    mock = mockUpstream("xrpl", { [LAST_VALIDATED]: unavailable(), [SUMMARY]: null });
    const path = `/xrpl/amendments/${name}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(html).not.toContain("Cannot GET");
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
    // Thrown once everything had settled: AD answered, and S said Cannot GET.
    expect(statusesOf(mock, amendmentCall(name!))).toEqual([200]);
    expect(statusesOf(mock, SUMMARY)).toEqual([404]);

    // The home page's key is asked for with the failure hold: a second render a second later is a 503 that asked nothing again.
    advance(1_000);
    expect((await render(path)).response.status).toBe(503);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
  });

  it("xrpl: S Cannot GET leaves out 'on {publishers}' and 'of the N … seen'", async () => {
    // `Date` is 31 s on: the hold of S that test 1 made is over, and S asks the mock again.
    mock = mockUpstream("xrpl", { [SUMMARY]: null });
    const path = "/xrpl/amendments/MPTokensV1";
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
    expect(statusesOf(mock, SUMMARY)).toEqual([404]);
    // The head counts the UNL's votes and names no publisher; the footer of the other validators says how many are shown, and not of how many seen.
    const tally = (vote: string) => xrplMajority.unl_votes.filter((row) => row.vote === vote).length;
    const none = tally("none");
    expect(elementText(html, "amendment__count")).toBe(`${tally("yes")} yes · ${tally("no")} no${none > 0 ? ` · ${none} without a recent vote` : ""}`);
    expect(elementText(html, "amendment__foot")).toBe(`Showing ${xrplMajority.other_votes.length} other validators: those with a vote recorded. All validators →`);
    expect(text).not.toContain("seen in the last 24 hours");
    // The rest of the page is AD's, and is there.
    expect(html).toContain('aria-label="Yes votes per flag ledger, changes only"');
    expect(text).toContain("Got majority");
  });

  it("an amendment the network does not know is a 404 short with the offer of the other network", async () => {
    // XChainBridge is XRPL's: Xahau's AD answers its own not-found message, "amendment not found".
    mock = mockUpstream("xahau");
    const path = "/xahau/amendments/XChainBridge";
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find amendment XChainBridge on Xahau.");
    const offer = anchors(html).find((anchor) => anchor.text === "Look for it on XRPL");
    expect(offer?.attrs).toContain('href="/xrpl/amendments/XChainBridge"');
    expect(statusesOf(mock, amendmentCall("XChainBridge"))).toEqual([404]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("an ID the network does not know is a 404 short that names it short, and offers the other network the segment as it was written", async () => {
    const id = "ab".repeat(32);
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amendments/${id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(`We couldn’t find amendment ${shortHash(id.toUpperCase())} on XRPL.`);
    expect(anchors(html).find((anchor) => anchor.text === "Look for it on Xahau")?.attrs).toContain(`href="/xahau/amendments/${id}"`);
    expect(statusesOf(mock, amendmentCall(id.toUpperCase()))).toEqual([404]);
  });

  it.each([
    ["Cannot GET", "XChainBridge", dataApiError(404, "Cannot GET /v2/network/amendments/XChainBridge")],
    ["a 400", "PermissionedDomains", dataApiError(400, "invalid amendment")],
  ])("AD answering %s is a 503", async (_name, name, answer) => {
    mock = mockUpstream("xrpl", { [amendmentCall(name)]: answer });
    const path = `/xrpl/amendments/${name}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(html).not.toContain("We couldn’t find");
    expect(html).not.toContain("Cannot GET");
  });
});

// ---- One URL per amendment (1.3, 1.4) ------------------------------------------------------------------------------------------------------

describe("the URL of an amendment", () => {
  it("redirects a case variant, slow", async () => {
    // D1 takes a name in any case when that is unique, and answers with the row as it names it.
    mock = mockUpstream("xrpl", { [amendmentCall("amm")]: xrplAmm });
    const response = await redirected("/xrpl/amendments/amm");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/amendments/AMM");
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(await storedAs("/xrpl/amendments/amm")).toEqual({ cls: "slow", ttl: CACHE_CLASSES.slow.edgeTtl });
    expect(statusesOf(mock, amendmentCall("amm"))).toEqual([200]);
  });

  it("redirects the lower-case ID of a named amendment to its name, slow", async () => {
    const { id, name } = await amendmentCase("xrpl", "enabled-ledger");
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amendments/${id.toLowerCase()}`;
    const response = await redirected(path);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amendments/${name}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: CACHE_CLASSES.slow.edgeTtl });
    // AD was asked for the ID in upper case, as the parser writes it.
    expect(statusesOf(mock, amendmentCall(id))).toEqual([200]);
  });

  it("redirects the lower-case ID of a nameless amendment to the upper-case ID, slow", async () => {
    const { id, name } = await amendmentCase("xrpl", "unknown");
    expect(name).toBeUndefined();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/amendments/${id.toLowerCase()}`;
    const response = await redirected(path);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/amendments/${id}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: CACHE_CLASSES.slow.edgeTtl });
  });

  it.each(["fix-1201", "a".repeat(65)])("%s is a 404 with no call", async (segment) => {
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    const path = `/xrpl/amendments/${segment}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(`We couldn’t find amendment ${JSON.stringify(segment.slice(0, 40))} on XRPL.`);
    expect(mock.requests).toEqual([]);
    expect(lookups).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("sends any query string to the bare path, short, with no call", async () => {
    const { id } = await amendmentCase("xrpl", "unknown");
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    for (const [asked, to] of [
      ["/xrpl/amendments/AMM?x=1", "/xrpl/amendments/AMM"],
      // The name as it was typed: which amendment it is, is for AD to say, and the bare path asks it.
      ["/xrpl/amendments/amm?status=voting&x=", "/xrpl/amendments/amm"],
      // An ID in upper case, as the parser writes it.
      [`/xrpl/amendments/${id.toLowerCase()}?a=1&b=2`, `/xrpl/amendments/${id}`],
    ]) {
      const response = await redirected(asked!);
      expect(response.status, asked).toBe(302);
      expect(response.headers.get("Location")).toBe(to);
      expect(response.headers.get("Cache-Control")).toBe("max-age=0");
      expect(await storedAs(asked!)).toEqual({ cls: "short", ttl: 30 });
    }
    // No call: none reached the upstream, and none was asked of the subrequest cache either (S and lastValidated may be warm there from the tests above, and an answer
    // from it would not show in `mock.requests`).
    expect(mock.requests).toEqual([]);
    expect(lookups).toEqual([]);
  });
});

// ---- The calls, as the spec writes them (2.1) ----------------------------------------------------------------------------------------------

describe("the first render of an amendment", () => {
  it("is minute, page and .data, with exactly lastValidated, AD and S", async () => {
    const { name } = await amendmentCase("xrpl", "obsolete");
    cold();
    mock = mockUpstream("xrpl");
    const puts: Array<string | null> = [];
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.push((response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });
    const path = `/xrpl/amendments/${name}`;
    const { response, html } = await page(path);

    // The three calls of §2.1 and nothing else: no A (AD carries its envelope), the node is not called, and every call found its file.
    expect(keysOf(mock.requests).sort()).toEqual([LAST_VALIDATED, amendmentCall(name!), SUMMARY].sort());
    expect(mock.requests.every((request) => request.kind === "data-api" && request.net === "xrpl" && request.source === "fixture")).toBe(true);

    // What each is kept for: lastValidated the home page's 2 s, S 10 s, AD the class `minute`'s 60 s, and the page a day.
    await vi.waitFor(() => expect(puts.length).toBeGreaterThanOrEqual(4), { timeout: 10_000 });
    const counted = (value: string) => puts.filter((control) => control === value).length;
    expect([HOME_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS, CACHE_CLASSES.minute.edgeTtl]).toEqual([2, 10, 60]);
    expect(counted(`public, max-age=${HOME_CALL_TTL_SECONDS}`)).toBe(1);
    expect(counted(`public, max-age=${VALIDATORS_CALL_TTL_SECONDS}`)).toBe(1);
    expect(counted(`public, max-age=${CACHE_CLASSES.minute.edgeTtl}`)).toBe(1);
    expect(counted("public, max-age=86400")).toBe(1);

    // The class of the page: minute, 60 s fresh; the browser is told to revalidate.
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "minute", ttl: CACHE_CLASSES.minute.edgeTtl });
    // The browser never gets the API's URL, nor the node's.
    expect(html).not.toContain("example.invalid");
    expect(html).not.toContain("s1.ripple.com");

    // The route's own request of a client-side navigation: React Router adds `_routes`, which is not a query string of the page's.
    const dataPath = `/xrpl/amendments/${name}.data?_routes=routes%2Fnet.amendments.%24name`;
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
});

// ---- The size of the answer (6.3) ----------------------------------------------------------------------------------------------------------

describe("the page of a full 30 days", () => {
  it("keeps the full 30-day page under 150,000 B gzipped", async () => {
    // XRPL's majority amendment: a round every flag ledger for 30 days.
    expect(xrplMajority.rounds.length).toBeGreaterThan(2_500);
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/amendments/MPTokensV1");

    // Every round is in the document (the chart's data, which the browser draws from), so the figure is the document's whole.
    expect(html.split("flag ledger #").length - 1).toBeGreaterThanOrEqual(xrplMajority.rounds.length);
    expect(html.length).toBeGreaterThan(150_000);
    expect(await gzipped(html)).toBeLessThan(150_000);
  });
});

// ---- The stored page (2.4) -----------------------------------------------------------------------------------------------------------------

describe("the stored page", () => {
  it("holds no age or countdown in the stored HTML", async () => {
    // A majority: a pill, a grid row and a history item that count down to its activation, and voters last seen minutes ago.
    mock = mockUpstream("xrpl");
    const path = "/xrpl/amendments/MPTokensV1";
    await page(path);
    const copy = await stored(path);
    const html = await copy!.text();
    const text = textOf(html);

    expect(html).not.toMatch(/ ago</);
    expect(html).not.toContain("in ~");
    expect(html).not.toMatch(/in \d+ (days?|min|h)\b/);
    expect(text).not.toMatch(/\d+ (s|min|h|d) ago/);
    expect(text).not.toContain("at the next flag ledger");
    // What is there instead: absolute times, and the day and time the activation is expected.
    expect(html).toContain(`>${formatUtc(xrplMajority.unl_votes[0]!.last_seen!)}</time>`);
    expect(text).toContain("Activating, expected Oct 21");
    expect(text).toContain("on or soon after Oct 21, 2026, 17:08 UTC, if it holds");
    expect(text).toContain("Oct 21, 2026, 17:08 UTC, if the majority holds");
  });

  it("has the note in the votes' place for an enabled amendment: what D1 lists of its validators is no vote", async () => {
    // D1 lists AMM's validators, each "no" or without a recent vote: the page would read "0 yes · 33 no" if it drew them.
    expect(xrplAmm.status).toBe("enabled");
    expect(xrplAmm.unl_votes.length).toBeGreaterThan(0);
    expect(xrplAmm.unl_votes.some((vote) => vote.vote === "yes")).toBe(false);
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/amendments/AMM");

    expect(response.status).toBe(200);
    expect(elementText(html, "amendment__novotes")).toBe("An enabled amendment is no longer voted on.");
    expect(html).not.toContain('aria-label="Votes of the UNL validators"');
    expect(html).not.toContain("amendment__count");
    expect(text).not.toContain("Other validators, not on the UNL");
  });
});

// ---- A last_validated that is not a number --------------------------------------------------------------------------------------------------
// Last, because the answer cannot have a key of its own: `last_validated` is one key for every page of a network, a malformed 200 is kept like any
// other for 2 s, and the tests above kept good ones (and a test after this one would be given this one). So the block waits for what is kept to
// expire, and each of its tests is on another network, so that neither finds the other's (network-page.spec.ts does the same). Without a ledger index
// and a close time there is no anchor to build the page on, and that is the data API failing, not a page with no ledger: a 503 that is not stored.

describe("a last_validated that the anchor cannot be worked out from", () => {
  beforeAll(() => sleep(2_100));

  it.each([
    ["xahau", "Hooks", "a close time that is not a time", { close_time: "yesterday" }, xahauLastValidated],
    ["xrpl", "DID", "a ledger index that is not a number", { ledger_index: "latest" }, xrplLastValidated],
  ] as const)("the amendment answers 503, and not a page with no ledger, on %s (%s) when last_validated has %s", async (net, name, _what, broken, recorded) => {
    mock = mockUpstream(net, { [LAST_VALIDATED]: { ...recorded, ...broken } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/${net}/amendments/${name}`;
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([200]);
    // The amendment itself was there: it is the anchor that is missing.
    expect(statusesOf(mock, amendmentCall(name))).toEqual([200]);
    expect(errors.mock.calls.some(([line]) => String(line).includes("the amendment page has no anchor"))).toBe(true);
  });
});
