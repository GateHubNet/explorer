import { describe, expect, it, vi } from "vitest";

import holdersFirst from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/holders@limit=10.json";
import transfersFirst from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/transfers@descending=true&limit=8.json";
import { MPT_FIXTURE_IDS } from "../support/mpt-case-rules";
import { namesCalls, namesSpec } from "../support/names";
import { alerts, expectDegraded, forgetStored, isNoindex, isStored, keysOf, linksTo, tiles, unavailable } from "../support/nft-pages";
import { anchors, elementText, pageClient, textOf } from "../support/pages";
import { dataApiError, nodeError } from "../support/upstream";

// One MPT issuance's page, `/{net}/mpt/{ID}` (E14 spec 1.3, 3.2 and 6, Task 10), on the real Worker against the generated MPT answers of the data API and the node
// (test/fixtures/http/*/data-api/mpt/…, node/ledger_entry/mpt_issuance_…): what a failed call does to it, the node's fallback, the 404s, the three calls of a page, the class each answer is stored
// under and the redirects that make one URL of an issuance. The off-case of `MPT` is mpt-off.spec.ts (the `worker-off` project), the names of the page mpt-names.spec.ts, the sandbox's words
// mpt-sandbox.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included, and an error or a degraded page is never stored. So the tests that fail a
// call come first, each on an issuance that no later test reads, and every test takes the subrequest entries away (`cold`, in `namesSpec`): each call of a render reaches the mock, so an
// override is always the answer and a list of calls does not depend on the order of the tests. The page does not poll, so no call asks for the failure hold; `Date` alone is faked all the same
// and moved 301 s on after each test, past the longest keep. The afterEach of `namesSpec` fails a test whose override no request used.

const { get, page, storedAs } = pageClient("198.51.131");
const { upstream } = namesSpec({ advance: 301_000 });

const { htf: HTF, noMetadata, rawMetadata, nonConforming, destroyed, nodeOnly: NODE_ONLY, nowhere: NOWHERE, lockedAll, escrow, shortKeys } = MPT_FIXTURE_IDS;
const MINUTE = { cls: "minute", ttl: 60 };
const SHORT = { cls: "short", ttl: 30 };
const FROM_NETWORK = { cls: "short", ttl: 60 };
const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };

const P = (id: string) => `/xrpl/mpt/${id}`;
/** The keys the mock names the calls of an issuance's page by. */
const ISSUANCE = (id: string) => `GET /v2/mpt/${id}`;
const HOLDERS = (id: string) => `GET /v2/mpt/${id}/holders?limit=10`;
const TRANSFERS = (id: string) => `GET /v2/mpt/${id}/transfers?descending=true&limit=8`;
const NODE = (id: string) => `node ledger_entry ledger_index=validated&mpt_issuance=${id}`;
/** The calls of an MPT page, but for the names call. */
const callsOf = (mock: { requests: Parameters<typeof keysOf>[0] }) => keysOf(mock.requests).sort();
const cannotGet = (id: string) => dataApiError(404, `Cannot GET /v2/mpt/${id}`);

describe("when the issuance call fails", () => {
  const failures: Array<[string, string, () => Response | object]> = [
    ["a 503", noMetadata, unavailable],
    ["a 429", rawMetadata, () => dataApiError(429, "slow down", { "Retry-After": "7" })],
    ["a body of the wrong shape", nonConforming, () => ({ result: "success", coverage: { complete: true, from_ledger_index: 1 }, issuance: { mpt_issuance_id: "nope" } })],
    ["a 'Cannot GET' of a data API without D9", destroyed, () => cannotGet(destroyed)],
  ];

  it.each(failures)("answers %s with a 503 that is not stored, and asks the node nothing", async (_what, id, answer) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = upstream("xrpl", { [ISSUANCE(id)]: answer() as Response });
    const response = await get(P(id));
    await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(P(id))).toBe(false);
    expect(callsOf(mock).some((key) => key.startsWith("node "))).toBe(false);
    expect(logged.mock.calls.some(([line]) => String(line).includes("could not be loaded"))).toBe(true);
  });
});

describe("when the index has no answer for the issuance", () => {
  it("reads the node's entry: 200, short for 60 s, the notice, the cards that say they are not in the index yet, noindex", async () => {
    const path = P(NODE_ONLY);
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(callsOf(mock)).toEqual([HOLDERS(NODE_ONLY), ISSUANCE(NODE_ONLY), NODE(NODE_ONLY), TRANSFERS(NODE_ONLY)].sort());
    expect(textOf(html)).toContain("Not in the index yet, shown from the network");
    expect(html.match(/Not in the index yet\./g)).toHaveLength(2);
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain('rel="canonical"');
    expect(await storedAs(path)).toEqual(FROM_NETWORK);
    // The figures from the entry: holders and locked are the index's to say.
    expect(tiles(html).map((tile) => [tile.label, tile.value])).toEqual([
      ["Outstanding", "1,250.0000"],
      ["Max amount", "100,000,000.0000"],
      ["Locked", "—"],
      ["Holders", "—"],
      ["Transfer fee", "0.192%"],
      ["Asset scale", "4"],
    ]);
  });

  it("shows the metadata as the node wrote it: its text and its hex, with the words that say it was read from the network", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(P(NODE_ONLY));
    expect(mock.requests.length).toBeGreaterThan(0);
    expect(textOf(html)).toContain("Read from the network as written; the index decodes it once it holds this issuance.");
    expect(html).toContain("Raw metadata, as hex (");
  });

  it("is a 503 when the node fails after the index's not found", async () => {
    // The edge answers a 503 with the stored copy of the page, if there is one: the test before this one stored it.
    await forgetStored(P(NODE_ONLY));
    vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { [NODE(NODE_ONLY)]: nodeError("noNetwork") });
    const response = await get(P(NODE_ONLY));
    await response.text();
    expect(response.status).toBe(503);
    expect(await isStored(P(NODE_ONLY))).toBe(false);
  });

  it("is a 404 of class short, with the search box, when the node has no such entry either", async () => {
    const path = P(NOWHERE);
    const mock = upstream("xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(textOf(html)).toContain("We couldn’t find this MPT on XRPL.");
    expect(html).toContain('role="search"');
    expect(await storedAs(path)).toEqual(SHORT);
    expect(callsOf(mock)).toContain(NODE(NOWHERE));
  });
});

describe("when a card's call fails", () => {
  it("serves the page with that card's error and Retry, unstored, and the other card whole", async () => {
    const path = P(escrow);
    vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { [HOLDERS(escrow)]: unavailable() });
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(alerts(html)).toBe(1);
    expect(textOf(html)).toContain("Couldn’t load the top holders.");
    expect(textOf(html)).not.toContain("Couldn’t load the recent transfers.");
    expect(html).toContain('aria-label="Recent transfers"');
  });

  it("does the same for the transfers", async () => {
    const path = P(lockedAll);
    vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { [TRANSFERS(lockedAll)]: unavailable() });
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(alerts(html)).toBe(1);
    expect(textOf(html)).toContain("Couldn’t load the recent transfers.");
  });
});

describe("a page the index has", () => {
  it("makes the three calls and one names call, is 200 of class minute, and draws the board's cards", async () => {
    const path = P(HTF);
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(callsOf(mock)).toEqual([HOLDERS(HTF), ISSUANCE(HTF), TRANSFERS(HTF)].sort());
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(elementText(html, "token-page__title")).toBe("Tokenized Gold (XAU)");
    expect(tiles(html).map((tile) => [tile.label, tile.value])).toEqual([
      ["Outstanding", "61,234,499.9968"],
      ["Max amount", "100,000,000.0000"],
      ["Locked", "3,806,508.3362"],
      ["Holders", "63"],
      ["Transfer fee", "0.192%"],
      ["Asset scale", "4"],
    ]);
    // The canonical URL and the summary card (the image is Task 14's).
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${path}"/>`);
    expect(html).toContain("<title>XAU · Tokenized Gold (XAU) · MPT · XRPL · explorer</title>");
    expect(isNoindex(html)).toBe(false);
    // The links to the two lists.
    expect(linksTo(html, "All 63 holders →")).toEqual([`${path}/holders`]);
    expect(linksTo(html, "Older →")).toEqual([`${path}/transfers?marker=${transfersFirst.marker}`]);
    expect(holdersFirst.holders).toHaveLength(10);
  });

  it("is a case of every kind of metadata and flag the fixtures hold, each page 200 and one call to each", async () => {
    for (const id of [noMetadata, shortKeys]) {
      const mock = upstream("xrpl");
      const { html } = await page(P(id));
      expect(callsOf(mock)).toEqual([HOLDERS(id), ISSUANCE(id), TRANSFERS(id)].sort());
      expect(anchors(html).length).toBeGreaterThan(5);
    }
  });
});

describe("Xahau", () => {
  it("answers an ID in any case with the page that says MPT is not there: 404 of class short, noindex, no request", async () => {
    for (const id of [HTF, HTF.toLowerCase()]) {
      const path = `/xahau/mpt/${id}`;
      const mock = upstream("xahau");
      const response = await get(path);
      const html = await response.text();

      expect(response.status, id).toBe(404);
      expect(textOf(html)).toContain("MPT isn't enabled on Xahau");
      expect(textOf(html)).toContain("MPTs exist only on XRPL, so there is nothing at this issuance ID on Xahau.");
      expect(textOf(html)).toContain(HTF);
      expect(html).toContain('<meta name="robots" content="noindex"/>');
      expect(linksTo(html, "Open it on XRPL")).toEqual([P(HTF)]);
      expect(linksTo(html, "← Back to tokens")).toEqual(["/xahau/tokens"]);
      expect(await storedAs(path)).toEqual(SHORT);
      expect(mock.requests).toEqual([]);
    }
  });

  it("answers text that is not 48 hex digits with a plain 404 and no request", async () => {
    const mock = upstream("xahau");
    const response = await get("/xahau/mpt/xyz");
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the URL of an issuance", () => {
  it("answers text that is not 48 hex digits with a 404 and no call, and says what was asked", async () => {
    const mock = upstream("xrpl");
    const response = await get("/xrpl/mpt/xyz");
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(textOf(html)).toContain('We couldn’t find MPT "xyz" on XRPL.');
    expect(await storedAs("/xrpl/mpt/xyz")).toEqual(SHORT);
    expect(mock.requests).toEqual([]);
  });

  it("redirects a lower case ID to the upper case one: 302, immutable, no call", async () => {
    const mock = upstream("xrpl");
    const response = await get(P(HTF.toLowerCase()));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(P(HTF));
    expect(mock.requests).toEqual([]);
    expect(await storedAs(P(HTF.toLowerCase()))).toEqual(IMMUTABLE);
  });

  it("redirects a made-up query to the page without it: 302, short", async () => {
    const mock = upstream("xrpl");
    const response = await get(`${P(HTF)}?x=1`);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(P(HTF));
    expect(mock.requests).toEqual([]);
    expect(await storedAs(`${P(HTF)}?x=1`)).toEqual(SHORT);
  });

  it("makes one redirect of a lower case ID with a query", async () => {
    const mock = upstream("xrpl");
    const response = await get(`${P(HTF.toLowerCase())}?x=1`);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(P(HTF));
    expect(mock.requests).toEqual([]);
    // The query is what makes the class: short, not a year.
    expect(await storedAs(`${P(HTF.toLowerCase())}?x=1`)).toEqual(SHORT);
  });
});
