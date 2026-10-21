import { env } from "cloudflare:workers";
import { decodeNodePublic } from "ripple-address-codec";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { statusWord } from "../../app/domain/amendments-params";
import { formatAmount, formatUtc, shortHash } from "../../app/domain/format";
import { CACHE_CLASSES, HOME_CALL_TTL_SECONDS, VALIDATIONS_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS } from "../../app/server/cache-class";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import type { NetworkId } from "../../app/server/networks";
import xahauLastValidated from "../fixtures/http/xahau/data-api/last_validated.json";
import xrplLastValidated from "../fixtures/http/xrpl/data-api/last_validated.json";
import xrplList from "../fixtures/http/xrpl/data-api/network/validators@limit=1000&scope=all.json";
import { anchors, hrefs, pageClient, tableRows, textOf } from "../support/pages";
import { cold, SUBREQUESTS } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { AMENDMENTS, LAST_VALIDATED, SUMMARY, validationsCall, validatorCall } from "../support/validators-calls";
import { fixtureValidator, fixtureValidatorKeys, validationsMarker, validatorCase } from "../support/validators-cases";

// One validator, `/{net}/validators/{key}` (validators spec 1.2, 1.4, 4.3 to 4.5), on the real Worker against the generated D1 answers
// (test/fixtures/http/{net}/data-api/network/validators…): what a failed call does to it, the calls it makes and for how long each is kept, the
// redirects that make one URL of a validator, the pages of older validations, and the stored HTML.
//
// A Worker keeps what it is answered in the Cache API for the rest of the file (an error never): D for 10 s and VV for 2 s of the real clock, S for
// 10 s and A for 60 s. So every test takes a validator of its own (`fresh`), and the ones that fail a call come first. S and A are one key for each
// network: test 2 fails S again after test 1 did. The page asks for the failure hold on every call (E2 1.7): a failure is remembered for 5 s of `Date`,
// per Worker instance, so `Date` alone is faked and moved 31 s on after each test, past the longest hold (as network-hold.spec.ts does): no test meets
// an earlier one's hold, which is how test 2 comes to ask the mock for S, and test 4 for S's answer. The test of a card past its deadline waits the
// 4.5 s of the real timer (`Date` is frozen).

const { get, page, stored, storedAs } = pageClient("198.51.112");

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

// ---- Validators for the tests -----------------------------------------------------------------------------------------------------------

/** XRPL's validator on one list only: with S its membership names the other list as "not listed", without S it cannot. */
const ONE_LIST = xrplList.validators.find((row) => row.unl_lists.length === 1)!;

const kept = new Map<NetworkId, Set<string>>();

/** The validators some test needs for what it is, which no other test may warm: the pages of older validations, and the cases below. */
async function reserved(net: NetworkId): Promise<Set<string>> {
  const known = kept.get(net);
  if (known !== undefined) return known;
  const keys = new Set([(await validationsMarker(net)).key]);
  if (net === "xrpl") {
    for (const which of ["verified-unl", "signing-key"] as const) keys.add((await validatorCase(net, which)).key);
    keys.add(ONE_LIST.validation_public_key);
  }
  kept.set(net, keys);
  return keys;
}

const taken = new Set<string>();

/** A validator of `net` that has a file and that no test of this file has asked for yet. */
async function fresh(net: NetworkId): Promise<string> {
  const skip = await reserved(net);
  const key = (await fixtureValidatorKeys(net)).find((candidate) => !taken.has(candidate) && !skip.has(candidate));
  if (key === undefined) throw new Error(`no ${net} validator left for a test`);
  taken.add(key);
  return key;
}

// ---- Reading the answers ----------------------------------------------------------------------------------------------------------------

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

/** The page at `path`: its response, HTML and visible text. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

/** A degraded page: served, never kept by the browser or the edge. */
async function expectDegraded(path: string, response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await isStored(path)).toBe(false);
}

const unavailable = () => dataApiError(503, "unavailable");
const keysOf = (requests: UpstreamMock["requests"]) => requests.map((request) => request.key);
const urlOf = (request: RequestInfo | URL) => (request instanceof Request ? request.url : String(request));

/**
 * The subrequest-cache lookups made from now until the test ends, hits and misses alike. `mock.requests` holds only what reached `fetch`: a call that the
 * Cache API answered from an earlier test never shows there, and a lookup does.
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

// ---- A call that fails (4.4) ------------------------------------------------------------------------------------------------------------

describe("a call that fails", () => {
  it("xrpl: lastValidated failing is a 503 that is not stored", async () => {
    const key = await fresh("xrpl");
    mock = mockUpstream("xrpl", { [LAST_VALIDATED]: unavailable(), [SUMMARY]: null });
    const path = `/xrpl/validators/${key}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(html).not.toContain("Cannot GET");
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
    // Thrown once everything had settled: D and VV answered, and S said Cannot GET.
    expect(statusesOf(mock, validatorCall(key))).toEqual([200]);
    expect(statusesOf(mock, validationsCall(key))).toEqual([200]);
    expect(statusesOf(mock, SUMMARY)).toEqual([404]);
  });

  it("xrpl: S Cannot GET degrades fee Now and UNL membership", async () => {
    // `Date` is 31 s on: the hold of S that test 1 made is over, and S asks the mock again.
    const key = ONE_LIST.validation_public_key;
    taken.add(key);
    mock = mockUpstream("xrpl", { [SUMMARY]: null });
    const path = `/xrpl/validators/${key}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, SUMMARY)).toEqual([404]);
    // The fee votes are not compared with the fees now, and the note says so.
    expect(tableRows(html, "Fee votes").slice(1).map((row) => row.slice(2))).toEqual([
      ["—", "—"],
      ["—", "—"],
      ["—", "—"],
    ]);
    expect(text).toContain("Fee votes are not compared with the current fees: they could not be loaded.");
    // UNL membership is D's lists alone: the one list that names it, and nothing of the publisher that does not.
    expect(text).toContain(`UNL membership ${ONE_LIST.unl_lists[0]} listed`);
    expect(text).not.toContain("not listed");
  });

  it("xahau: A failing leaves D's status words and 'on flag ledgers'", async () => {
    const key = await fresh("xahau");
    const detail = await fixtureValidator("xahau", key);
    mock = mockUpstream("xahau", { [AMENDMENTS]: unavailable() });
    const path = `/xahau/validators/${key}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, AMENDMENTS)).toEqual([503]);
    // The rows are D's, in D's order, each with D's word: no share of yes and no activation, which are A's.
    const votes = tableRows(html, "Amendment votes").slice(1);
    expect(votes.length).toBeGreaterThan(0);
    expect(votes.map((row) => row[1])).toEqual(detail.amendment_votes.votes.map((vote) => statusWord(vote.status)));
    expect(text).toContain("Fee votes are counted on flag ledgers.");
    expect(text).not.toContain("every 256 ledgers");
  });

  it("xrpl: a failing VV is held: two renders within 5 s make one request", async () => {
    // `Date` is 31 s past test 2's failure of S: S answers again.
    const key = await fresh("xrpl");
    const detail = await fixtureValidator("xrpl", key);
    mock = mockUpstream("xrpl", { [validationsCall(key)]: unavailable() });
    const path = `/xrpl/validators/${key}`;
    const first = await render(path);

    await expectDegraded(path, first.response);
    expect(first.text).toContain("Couldn’t load the recent validations.");
    expect(first.html).toMatch(/<button[^>]*>Retry<\/button>/);
    // Last seen is D's, then: its time (the age comes in the browser, no finer than a minute) and its newest ledger.
    expect(first.html).toContain(`${formatUtc(detail.last_seen!)}</time>`);
    expect(first.text).toContain(`last validation, ledger #${formatAmount(String(detail.current_index))}`);
    // The rest of the page is there: S's fees compared, A's statuses.
    expect(first.text).not.toContain("could not be loaded");

    advance(1_000);
    const second = await render(path);
    await expectDegraded(path, second.response);
    expect(second.text).toContain("Couldn’t load the recent validations.");
    expect(statusesOf(mock, validationsCall(key))).toEqual([503]);
  });

  it("xrpl: VV past 4.5 s fails its card with took too long", async () => {
    const key = await fresh("xrpl");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // An answer, and a good one, after 4,600 ms: a page that waited for it would show its (empty) table, not the card's error.
    const body = JSON.stringify({ result: "success", validation_public_key: key, count: 0, validations: [] });
    const late = () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(body, { headers: { "Content-Type": "application/json" } })), 4_600));
    mock = mockUpstream("xrpl", { [validationsCall(key)]: late });
    const path = `/xrpl/validators/${key}`;
    const started = performance.now();
    const { response, text } = await render(path);

    expect(performance.now() - started).toBeLessThan(5_000);
    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the recent validations.");
    expect(text).not.toContain("No validation in the last 7 days.");
    expect(text).toContain("Fee votes");
    expect(logged.mock.calls.some(([line]) => String(line).includes("took too long"))).toBe(true);
    // The late answer comes after the page, which did not wait for it; it is let in before the mock goes.
    await sleep(600);
  }, 15_000);

  it("a key D does not know is a 404 short with the offer of the other network", async () => {
    // A validator of Xahau, which XRPL's D has never heard of: its own not-found message, "Validator not found".
    const key = await fresh("xahau");
    mock = mockUpstream("xrpl");
    const path = `/xrpl/validators/${key}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(`We couldn’t find validator ${shortHash(key)} on XRPL.`);
    const offer = anchors(html).find((anchor) => anchor.text === "Look for it on Xahau");
    expect(offer?.attrs).toContain(`href="/xahau/validators/${key}"`);
    expect(statusesOf(mock, validatorCall(key))).toEqual([404]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it.each([
    ["Cannot GET", (key: string) => dataApiError(404, `Cannot GET /v2/network/validators/${key}`)],
    ["a 400", () => dataApiError(400, "invalid validator public key")],
  ])("D answering %s is a 503", async (_name, answer) => {
    const key = await fresh("xrpl");
    mock = mockUpstream("xrpl", { [validatorCall(key)]: answer(key) });
    const path = `/xrpl/validators/${key}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(html).not.toContain("We couldn’t find");
  });
});

// ---- The calls, as the spec writes them (2.1) -------------------------------------------------------------------------------------------

describe("the first render of a validator", () => {
  it("is live-home, page and .data, with exactly lastValidated, D, VV, S and A", async () => {
    const key = await fresh("xrpl");
    mock = mockUpstream("xrpl");
    // What the Cache API kept of the tests above (XRPL's S, A and lastValidated) must not answer here: every call of this render reaches the mock.
    cold();
    const puts: Array<string | null> = [];
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.push((response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });
    const path = `/xrpl/validators/${key}`;
    const { response, html } = await page(path);

    // The five calls of §2.1 and nothing else: the node is not called, and every call found its file.
    expect(keysOf(mock.requests).sort()).toEqual([LAST_VALIDATED, validatorCall(key), validationsCall(key), SUMMARY, AMENDMENTS].sort());
    expect(mock.requests.every((request) => request.kind === "data-api" && request.net === "xrpl" && request.source === "fixture")).toBe(true);

    // What each is kept for: lastValidated (the home page's key) and VV 2 s, D and S 10 s, A the class `minute`'s 60 s, and the page a day.
    await vi.waitFor(() => expect(puts.length).toBeGreaterThanOrEqual(6), { timeout: 10_000 });
    const counted = (value: string) => puts.filter((control) => control === value).length;
    expect([HOME_CALL_TTL_SECONDS, VALIDATIONS_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS, CACHE_CLASSES.minute.edgeTtl]).toEqual([2, 2, 10, 60]);
    expect(counted("public, max-age=2")).toBe(2);
    expect(counted(`public, max-age=${VALIDATORS_CALL_TTL_SECONDS}`)).toBe(2);
    expect(counted(`public, max-age=${CACHE_CLASSES.minute.edgeTtl}`)).toBe(1);
    expect(counted("public, max-age=86400")).toBe(1);

    // The class of the page: live-home, 1 s fresh; the browser is told to revalidate.
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "live-home", ttl: 1 });
    // The browser never gets the API's URL, nor the node's.
    expect(html).not.toContain("example.invalid");
    expect(html).not.toContain("s1.ripple.com");

    // The route's own request of a client-side navigation: React Router adds `_routes`, which is no part of the view.
    const dataPath = `/xrpl/validators/${key}.data?_routes=routes%2Fnet.validators.%24key`;
    const data = await get(dataPath);
    const body = await data.text();
    expect(data.status).toBe(200);
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("anchor");
    expect(body).toContain("test-build");
    expect(body).not.toContain("example.invalid");
    expect(await storedAs(dataPath)).toEqual({ cls: "live-home", ttl: 1 });
  });
});

// ---- One URL per validator (1.2, 1.4) ---------------------------------------------------------------------------------------------------

describe("the URL of a validator", () => {
  it("redirects 66 hex to base58, immutable, keeping the query, with no call", async () => {
    const key = await fresh("xrpl");
    const hex = Array.from(decodeNodePublic(key), (byte) => byte.toString(16).padStart(2, "0")).join("");
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    for (const spelling of [hex, hex.toUpperCase()]) {
      const path = `/xrpl/validators/${spelling}?marker=M1&back=M2`;
      const response = await get(path);
      await response.text();
      expect(response.status, spelling).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/validators/${key}?marker=M1&back=M2`);
      expect(response.headers.get("Cache-Control")).toBe("max-age=60");
      expect(await storedAs(path)).toEqual({ cls: "immutable", ttl: CACHE_CLASSES.immutable.edgeTtl });
    }
    expect(mock.requests).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("redirects a signing key to its master, slow, keeping marker and back", async () => {
    const { key: master, signing } = await validatorCase("xrpl", "signing-key");
    mock = mockUpstream("xrpl");
    for (const query of ["?marker=M1&back=M2", ""]) {
      const path = `/xrpl/validators/${signing}${query}`;
      const response = await get(path);
      await response.text();
      expect(response.status, query).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/validators/${master}${query}`);
      expect(response.headers.get("Cache-Control")).toBe("max-age=300");
      expect(await storedAs(path)).toEqual({ cls: "slow", ttl: CACHE_CLASSES.slow.edgeTtl });
    }
    // D was asked for the signing key and answered with its master (kept 10 s: once).
    expect(statusesOf(mock, validatorCall(signing!))).toEqual([200]);
  });

  it.each(["summary", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", "nHUkp7"])("%s is a 404 short with no call", async (segment) => {
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    const path = `/xrpl/validators/${segment}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(`We couldn’t find validator ${JSON.stringify(segment)} on XRPL.`);
    expect(mock.requests).toEqual([]);
    expect(lookups).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it.each([
    ["?x=1", ""],
    ["?back=M1", ""],
  ])("tidies %s with no call", async (query, to) => {
    const key = await fresh("xrpl");
    mock = mockUpstream("xrpl");
    const lookups = subrequestLookups();
    const path = `/xrpl/validators/${key}${query}`;
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/validators/${key}${to}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(mock.requests).toEqual([]);
    expect(lookups).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});

// ---- The older validations (4.5) --------------------------------------------------------------------------------------------------------

describe("a page of older validations", () => {
  it("serves a marker page: slow 300 s, noindex, no canonical, only D and VV", async () => {
    const { key, marker } = await validationsMarker("xrpl");
    mock = mockUpstream("xrpl");
    const path = `/xrpl/validators/${key}?marker=${marker}`;
    const { response, html } = await page(path);

    expect(keysOf(mock.requests).sort()).toEqual([validatorCall(key), validationsCall(key, marker)].sort());
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 300 });
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"\/?>/);
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:');
    // History: the validations and their Newer link back to the first page, and nothing live.
    expect(tableRows(html, "Recent validations").length).toBeGreaterThan(1);
    expect(hrefs(html)).toContain(`/xrpl/validators/${key}`);
    expect(textOf(html)).not.toContain("Live · updates every ledger");
    expect(textOf(html)).not.toContain("Fee votes");
  });

  it.each(["?marker=!!", "VV 400", "an empty page"])("%s is a 404 short", async (which) => {
    const key = await fresh("xrpl");
    const marker = "AAAAAAAA";
    const overrides =
      which === "VV 400"
        ? { [validationsCall(key, marker)]: dataApiError(400, "invalid marker") }
        : which === "an empty page"
          ? { [validationsCall(key, marker)]: { result: "success", validation_public_key: key, count: 0, validations: [] } }
          : {};
    mock = mockUpstream("xrpl", overrides);
    const path = `/xrpl/validators/${key}?marker=${which === "?marker=!!" ? "!!" : marker}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find that page of the validator's validations on XRPL.");
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
    // A marker that is no marker is refused before any call.
    if (which === "?marker=!!") expect(mock.requests).toEqual([]);
  });
});

// ---- The stored page (2.4) --------------------------------------------------------------------------------------------------------------

describe("the stored page", () => {
  it("holds no age in the stored HTML", async () => {
    // Domain verified, on both lists, voting for an amendment that has a majority: an activation to count down to.
    const { key } = await validatorCase("xrpl", "verified-unl");
    taken.add(key);
    mock = mockUpstream("xrpl");
    const path = `/xrpl/validators/${key}`;
    await page(path);
    const copy = await stored(path);
    const html = await copy!.text();

    expect(html).not.toMatch(/ ago</);
    expect(html).not.toContain("in ~");
    expect(html).not.toMatch(/in \d+ (days?|min|h)\b/);
    expect(textOf(html)).not.toMatch(/\d+ (s|min|h|d) ago/);
    // What is there instead: absolute times, and the day an activation is expected.
    expect(html).toMatch(/<time[^>]*>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC<\/time>/);
    expect(textOf(html)).toMatch(/Activating, expected [A-Z][a-z]{2} \d{1,2}/);
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
    ["xahau", "a close time that is not a time", { close_time: "yesterday" }, xahauLastValidated],
    ["xrpl", "a ledger index that is not a number", { ledger_index: "latest" }, xrplLastValidated],
  ] as const)("the validator answers 503, and not a page with no ledger, on %s when last_validated has %s", async (net, _what, broken, recorded) => {
    const key = await fresh(net);
    mock = mockUpstream(net, { [LAST_VALIDATED]: { ...recorded, ...broken } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/${net}/validators/${key}`;
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([200]);
    // The validator itself was there: it is the anchor that is missing.
    expect(statusesOf(mock, validatorCall(key))).toEqual([200]);
    expect(errors.mock.calls.some(([line]) => String(line).includes("the validator page has no anchor"))).toBe(true);
  });
});
