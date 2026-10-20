import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { shortHash } from "../../app/domain/format";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import xahauSummary from "../fixtures/http/xahau/data-api/network/validators/summary.json";
import xrplList from "../fixtures/http/xrpl/data-api/network/validators@limit=1000&scope=all.json";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { AMENDMENTS, LAST_VALIDATED, LIST, SUMMARY } from "../support/validators-calls";

// The validators list, `/{net}/validators`, when a call fails (validators spec 3.3), on the real Worker against the generated D1 answers
// (test/fixtures/http/{net}/data-api/network/validators…): which failures are a page that is not there (a 503), and which are a card of it that
// says so. The calls it makes, the redirects and the page itself are validators-page.spec.ts, a file of its own: this one fails calls, and a Worker
// keeps what it is answered in the Cache API for the rest of the file (an error never), so the tests that fail a call come first and each of them
// overrides a key that no test before it stored (S and L and A are one key for each network, kept 10 s and 60 s of the real clock).
//
// The page asks for the failure hold on every call (E2 1.7): a failure is remembered for 5 s of `Date`, per Worker instance, so a test that fails a
// key an earlier test of the file failed first meets that hold, not its override. `Date` alone is faked and moved 31 s on after each test, past the
// longest hold (as network-hold.spec.ts does), so no test meets an earlier one's. That is also what the second and fourth tests rely on: "the hold is
// over" is how they come to ask the mock again. The first and the third check the hold itself with a second render a second after the first. The last
// two wait for the 4.5 s deadline of a card (real timers: `Date` is frozen, so the whole 4.5 s is waited).

const { get } = pageClient("198.51.110");

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

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** How many errors the page shows (each `SectionError` is an alert). */
const alerts = (html: string) => (html.match(/role="alert"/g) ?? []).length;

/** Whether the filter form has the field `label` ("Listed by" is also a word of the rows' UNL tags: only a label is a field). */
const hasField = (html: string, label: string) => new RegExp(`<label[^>]*>${label}</label>`).test(html);

const unavailable = () => dataApiError(503, "unavailable");

/** A degraded page: served, never kept by the browser or the edge. */
async function expectDegraded(path: string, response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await isStored(path)).toBe(false);
}

/** The label of each stat tile of the overview, with its figure. */
function tiles(html: string): Array<{ label: string | undefined; value: string | undefined; sub: string | undefined }> {
  return [...html.matchAll(/<div class="stat stat--figure">([\s\S]*?)<\/div>/g)].map((match) => ({
    label: elementText(match[1]!, "stat__label"),
    value: elementText(match[1]!, "stat__value"),
    sub: elementText(match[1]!, "stat__sub"),
  }));
}

describe("a call the list cannot be built without", () => {
  it("xrpl: S, L and A all answering Cannot GET is a 503 that is not stored (an API without D1)", async () => {
    // `null` is the fixture server's answer to a path the API has no route for: the framework's "Cannot GET" 404, which is an outage.
    mock = mockUpstream("xrpl", { [SUMMARY]: null, [LIST]: null, [AMENDMENTS]: null });
    const path = "/xrpl/validators";
    const { response, html } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    for (const key of [SUMMARY, LIST, AMENDMENTS]) expect(statusesOf(mock, key), key).toEqual([404]);
    expect(html).not.toContain("Cannot GET");

    // Every call asks for the failure hold (the page polls): a second render a second later is a 503 that made no request at all.
    advance(1_000);
    expect((await render(path)).response.status).toBe(503);
    for (const key of [SUMMARY, LIST, AMENDMENTS]) expect(statusesOf(mock, key), key).toEqual([404]);
  });

  it("xrpl: S Cannot GET and A 503 leave the list, without tiles, versions, Listed by or Votes yes for, and apply ?amendment= as given", async () => {
    // The hold of test 1 is over (`Date` is 31 s on): S and A ask the mock again, and L (which test 1 failed too, but answers here) finds its file.
    mock = mockUpstream("xrpl", { [SUMMARY]: null, [AMENDMENTS]: unavailable() });
    const path = "/xrpl/validators?amendment=XChainBridge";
    const { response, html, text } = await render(path);

    // `?amendment=` is not checked against A, which failed: kept as given, no redirect, and the page is not stored (the next render checks again).
    await expectDegraded(path, response);
    expect(statusesOf(mock, SUMMARY)).toEqual([404]);
    expect(statusesOf(mock, AMENDMENTS)).toEqual([503]);
    expect(statusesOf(mock, LIST)).toEqual([200]);

    // The six tiles are dashes, with one error under them, and the versions card is the second error.
    expect(tiles(html)).toHaveLength(6);
    for (const tile of tiles(html)) expect([tile.value, tile.sub], tile.label).toEqual(["—", "Couldn’t load"]);
    expect(text).toContain("Couldn’t load the network overview.");
    expect(alerts(html)).toBe(2);
    expect(text).not.toContain("Software versions");
    expect(text).not.toContain("28 of 35");

    // The intro does not name the publishers (they are S's); "Listed by" and "Votes yes for" are gone, the amendment rides in a hidden field.
    expect(text).toContain("trusts out of the box. All adds every other validator");
    expect(text).not.toContain("published by");
    expect(hasField(html, "Listed by")).toBe(false);
    expect(hasField(html, "Votes yes for")).toBe(false);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="amendment"[^>]*value="XChainBridge"|<input[^>]*name="amendment"[^>]*type="hidden"[^>]*value="XChainBridge"/);

    // The list is L's rows on the UNL that vote yes for XChainBridge, matched by name as given; the counts are L's.
    const voting = xrplList.validators.filter((row) => row.unl && row.amendment_votes?.yes.some((yes) => yes.name === "XChainBridge"));
    expect(voting.length).toBeGreaterThan(0);
    expect(tableRows(html, "Validators")).toHaveLength(voting.length + 1);
    const chips = anchors(html).map((a) => a.text);
    expect(chips).toContain(`UNL ${xrplList.validators.filter((row) => row.unl).length}`);
    expect(chips).toContain(`All ${xrplList.validators.length}`);
    // Without S the fee votes are not compared, and the footer says so.
    expect(text).toContain("Fee votes are not compared with the current fees: they could not be loaded");
    expect(text).toContain(`${voting.length} matches`);
  });

  it("xahau: lastValidated failing is a 503 that is not stored, once S and A have answered", async () => {
    // L is failed as well: Xahau's L must not be kept by this test, or the next one would find it and its own override would go unused.
    mock = mockUpstream("xahau", { [LAST_VALIDATED]: unavailable(), [LIST]: unavailable() });
    const path = "/xahau/validators";
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
    // The loader waited for the others (none runs on behind an answered request): S and A answered, and L failed.
    expect(statusesOf(mock, SUMMARY)).toEqual([200]);
    expect(statusesOf(mock, AMENDMENTS)).toEqual([200]);
    expect(statusesOf(mock, LIST)).toEqual([503]);

    // `lastValidated` is held as well: a second render a second later makes no request for it, nor for L.
    advance(1_000);
    expect((await render(path)).response.status).toBe(503);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);
    expect(statusesOf(mock, LIST)).toEqual([503]);
  });

  it("xahau: L failing keeps the filters and the chips without counts, and the overview", async () => {
    // The hold of test 3 is over, and S and A are in the Cache API (a few seconds old): only L asks the mock.
    mock = mockUpstream("xahau", { [LIST]: unavailable() });
    const path = "/xahau/validators?amendment=URIToken&q=example";
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, LIST)).toEqual([503]);

    // The card says so in place of the table, with a Retry; it is the page's only error.
    expect(text).toContain("Couldn’t load the validators.");
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(alerts(html)).toBe(1);
    expect(tableRows(html, "Validators")).toEqual([]);

    // The filters stay: the search text, "Votes yes for" with the amendment of the address, and the scope links with no counts.
    expect(html).toMatch(/<input[^>]*name="q"[^>]*value="example"/);
    expect(hasField(html, "Votes yes for")).toBe(true);
    expect(html).toMatch(/<option value="URIToken" selected(="")?>/);
    expect(hasField(html, "Listed by")).toBe(false);
    const chips = anchors(html).map((a) => a.text);
    expect(chips).toContain("UNL");
    expect(chips).toContain("All");
    expect(chips.filter((chip) => /^(UNL|All) \d/.test(chip))).toEqual([]);

    // The overview is S's, from the Cache API, and is there; the Negative UNL names a validator L could have named, by its short key.
    expect(tiles(html).map((tile) => tile.label)).toEqual([
      "Validators seen, last 24 h",
      "On the default UNL",
      "Quorum",
      "Negative UNL",
      "Base / owner reserve",
      "Next flag ledger",
    ]);
    expect(tiles(html).find((tile) => tile.label === "On the default UNL")!.value).toMatch(/^\d+ \/ \d+$/);
    const discounted = xahauSummary.negative_unl[0]!.validation_public_key;
    const negative = tiles(html).find((tile) => tile.label === "Negative UNL")!;
    expect(negative.sub).toContain(shortHash(discounted));
    expect(negative.sub).not.toContain("embermill.example");
  });

  it("xahau: L past the 4.5 s deadline is that card, 'took too long', and the rest of the page is there", async () => {
    // L never answers. `Date` is faked and frozen here, so the deadline (`at - Date.now()`) is the full 4.5 s of the real timer.
    mock = mockUpstream("xahau", { [LIST]: () => new Promise<Response>(() => {}) });
    const path = "/xahau/validators";
    const started = performance.now();
    const { response, text } = await render(path);

    expect(performance.now() - started).toBeLessThan(5_000);
    await expectDegraded(path, response);
    expect(text).toContain("Couldn’t load the validators.");
    expect(text).toContain("Quorum");
  }, 15_000);

  it("xrpl: S, L and A all past the deadline is a 503 too, not a crash: a card that took too long is an outage when no card is left", async () => {
    // What the Cache API kept for XRPL's S, L and A in the tests above must not stand in for the calls that never answer.
    const match = caches.default.match.bind(caches.default);
    vi.spyOn(caches.default, "match").mockImplementation((request, options) =>
      (request instanceof Request ? request.url : String(request)).startsWith("https://subrequest-cache.invalid/") ? Promise.resolve(undefined) : match(request, options),
    );
    const never = () => new Promise<Response>(() => {});
    mock = mockUpstream("xrpl", { [SUMMARY]: never, [LIST]: never, [AMENDMENTS]: never });
    const path = "/xrpl/validators?scope=all";
    const started = performance.now();
    const { response } = await render(path);

    expect(performance.now() - started).toBeLessThan(5_000);
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await isStored(path)).toBe(false);
  }, 15_000);
});
