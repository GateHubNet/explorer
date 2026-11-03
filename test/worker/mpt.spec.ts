import { describe, expect, it, vi } from "vitest";

import holdersFirst from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/holders@limit=10.json";
import holdersFirst50 from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/holders@limit=50.json";
import transfersFirst20 from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/transfers@descending=true&limit=20.json";
import transfersFirst from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/transfers@descending=true&limit=8.json";
import { MPT_FIXTURE_IDS } from "../support/mpt-case-rules";
import { namesCalls, namesSpec } from "../support/names";
import { alerts, expectDegraded, forgetStored, isNoindex, isStored, keysOf, linksTo, tiles, unavailable } from "../support/nft-pages";
import { anchors, elementText, gridRows, pageClient, tableRows, textOf } from "../support/pages";
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

// ---- The holders' and the transfers' pages (Task 11) -------------------------------------------------------------------------------------------------------------------------------------

const HTF_DIR = "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80";
/** The second page of each list: the answer to the marker of the first (the fixtures' `marker`). */
const holdersSecond = import.meta.glob<{ holders: unknown[]; marker?: string }>("../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/holders@limit=50&marker=*.json", { import: "default", eager: true });
const transfersSecond = import.meta.glob<{ transfers: unknown[]; marker?: string }>(
  "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/transfers@descending=true&limit=20&marker=*.json",
  { import: "default", eager: true },
);
void HTF_DIR;
const MARKER_PAGE = { cls: "slow", ttl: 3_600 };

const HOLDERS_FIRST = holdersFirst50.marker!;
const TRANSFERS_FIRST = transfersFirst20.marker!;

const HOLDERS50 = (id: string, marker?: string) => `GET /v2/mpt/${id}/holders?limit=50${marker === undefined ? "" : `&marker=${marker}`}`;
const TRANSFERS20 = (id: string, marker?: string) => `GET /v2/mpt/${id}/transfers?descending=true&limit=20${marker === undefined ? "" : `&marker=${marker}`}`;
const H = (id: string) => `${P(id)}/holders`;
const T = (id: string) => `${P(id)}/transfers`;

describe("the holders page", () => {
  it("is 200 of class minute with two calls and one names call, 50 holders ranked from 1, canonical and indexable, with Older to the marker of its call", async () => {
    const path = H(HTF);
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(callsOf(mock)).toEqual([HOLDERS50(HTF), ISSUANCE(HTF)].sort());
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(elementText(html, "token-page__title")).toBe("Holders of XAU");
    expect(html).toContain("<title>Holders of XAU · XRPL · explorer</title>");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${path}"/>`);
    expect(isNoindex(html)).toBe(false);
    const rows = gridRows(html, "Holders");
    expect(rows[0]).toEqual(["#", "Holder", "Balance (XAU)", "Share of outstanding", "Balance state"]);
    expect(rows).toHaveLength(51);
    expect(rows[1]!.slice(0, 2)).toEqual(["1", expect.stringMatching(/^r9XZ2L/)]);
    expect(rows[50]![0]).toBe("50");
    expect(linksTo(html, "Older")).toEqual([`${path}?marker=${HOLDERS_FIRST}`]);
    expect(linksTo(html, "Back to XAU")).toEqual([P(HTF)]);
    expect(html.indexOf("mpt__headline")).toBeGreaterThan(-1);
  });

  it("is the page behind the first one's marker: 13 holders with no rank, class slow, noindex and follow, no canonical URL, Newer back to the first page", async () => {
    const [[, second]] = Object.entries(holdersSecond);
    const path = `${H(HTF)}?marker=${HOLDERS_FIRST}`;
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(callsOf(mock)).toEqual([HOLDERS50(HTF, HOLDERS_FIRST), ISSUANCE(HTF)].sort());
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
    expect(isNoindex(html)).toBe(true);
    expect(html).toContain("<title>Holders of XAU · XRPL · explorer</title>");
    const rows = gridRows(html, "Holders");
    expect(rows[0]).toEqual(["Holder", "Balance (XAU)", "Share of outstanding", "Balance state"]);
    expect(rows).toHaveLength(second.holders.length + 1);
    expect(second.holders).toHaveLength(13);
    expect(linksTo(html, "Newer")).toEqual([H(HTF)]);
    // The last page of the list: nothing is older.
    expect(second.marker).toBeUndefined();
    expect(linksTo(html, "Older")).toEqual([]);
  });

  it("answers a marker that is none with a 404 of class short and no call: text, and an empty one", async () => {
    for (const marker of ["***", "", "a b"]) {
      const mock = upstream("xrpl");
      const path = `${H(HTF)}?marker=${marker}`;
      const response = await get(path);
      await response.text();
      expect(response.status, JSON.stringify(marker)).toBe(404);
      expect(mock.requests, JSON.stringify(marker)).toEqual([]);
    }
  });

  it("answers a marker the API refuses (a 400) with a 404 of class short, and a marker with nothing behind it too", async () => {
    const refused = "QUFBQQ";
    let mock = upstream("xrpl", { [HOLDERS50(HTF, refused)]: dataApiError(400, "invalid marker") });
    let response = await get(`${H(HTF)}?marker=${refused}`);
    let html = await response.text();
    expect(response.status).toBe(404);
    expect(textOf(html)).toContain("We couldn’t find that page of the holders of this MPT on XRPL.");
    expect(await storedAs(`${H(HTF)}?marker=${refused}`)).toEqual(SHORT);
    expect(callsOf(mock)).toContain(HOLDERS50(HTF, refused));

    const past = "QkJCQg";
    mock = upstream("xrpl", { [HOLDERS50(HTF, past)]: { result: "success", coverage: { complete: true, from_ledger_index: 1 }, count: 0, holders: [] } });
    response = await get(`${H(HTF)}?marker=${past}`);
    html = await response.text();
    expect(response.status).toBe(404);
    expect(callsOf(mock)).toContain(HOLDERS50(HTF, past));
  });

  it("redirects a lower case ID, a made-up query and a trail with no marker to the canonical URL: one 302, immutable for the path alone", async () => {
    const mock = upstream("xrpl");
    const lower = await get(H(HTF.toLowerCase()));
    expect(lower.status).toBe(302);
    expect(lower.headers.get("Location")).toBe(H(HTF));
    expect(await storedAs(H(HTF.toLowerCase()))).toEqual(IMMUTABLE);
    for (const query of ["?x=1", "?back=M1"]) {
      const response = await get(`${H(HTF)}${query}`);
      expect(response.status, query).toBe(302);
      expect(response.headers.get("Location"), query).toBe(H(HTF));
    }
    const both = await get(`${H(HTF.toLowerCase())}?marker=${HOLDERS_FIRST}&x=1`);
    expect(both.status).toBe(302);
    expect(both.headers.get("Location")).toBe(`${H(HTF)}?marker=${HOLDERS_FIRST}`);
    expect(mock.requests).toEqual([]);
  });

  it("reads the node for the head alone when the index has no answer: 200, short for 60 s, the notice and 'Not in the index yet.'", async () => {
    const path = H(NODE_ONLY);
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(callsOf(mock)).toEqual([HOLDERS50(NODE_ONLY), ISSUANCE(NODE_ONLY), NODE(NODE_ONLY)].sort());
    expect(textOf(html)).toContain("Not in the index yet, shown from the network");
    expect(html.match(/Not in the index yet\./g)).toHaveLength(1);
    // The head is the network's: the page is not for an index to keep, as the issuance's own page is not (the whole-branch review's M2), with no canonical URL.
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain('rel="canonical"');
    expect(await storedAs(path)).toEqual(FROM_NETWORK);
  });

  it("is a 404 for an issuance neither the index nor the node has, and a 503 when the issuance call fails", async () => {
    const mock = upstream("xrpl");
    const missing = await get(H(NOWHERE));
    await missing.text();
    expect(missing.status).toBe(404);
    expect(callsOf(mock)).toContain(NODE(NOWHERE));
    expect(await storedAs(H(NOWHERE))).toEqual(SHORT);

    vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { [ISSUANCE(noMetadata)]: unavailable() });
    const down = await get(H(noMetadata));
    await down.text();
    expect(down.status).toBe(503);
    expect(await isStored(H(noMetadata))).toBe(false);
  });

  it("serves the head with the list's error and Retry, unstored, when the holders call fails", async () => {
    const path = H(lockedAll);
    vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { [HOLDERS50(lockedAll)]: unavailable() });
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(alerts(html)).toBe(1);
    expect(textOf(html)).toContain("Couldn’t load the holders.");
    expect(elementText(html, "token-page__title")).toBe("Holders of LKD");
  });

  it("is the page that says MPT is not on Xahau, a 404 of class short with no request, in any case", async () => {
    for (const id of [HTF, HTF.toLowerCase()]) {
      const mock = upstream("xahau");
      const response = await get(`/xahau/mpt/${id}/holders`);
      const html = await response.text();
      expect(response.status, id).toBe(404);
      expect(textOf(html)).toContain("MPT isn't enabled on Xahau");
      expect(mock.requests, id).toEqual([]);
    }
  });
});

describe("the transfers page", () => {
  it("is 200 of class minute with two calls and one names call, 20 transfers newest first, canonical and indexable, with Older to the marker of its call", async () => {
    const path = T(HTF);
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(callsOf(mock)).toEqual([ISSUANCE(HTF), TRANSFERS20(HTF)].sort());
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await storedAs(path)).toEqual(MINUTE);
    expect(elementText(html, "token-page__title")).toBe("Transfers of XAU");
    expect(html).toContain("<title>Transfers of XAU · XRPL · explorer</title>");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${path}"/>`);
    expect(isNoindex(html)).toBe(false);
    const rows = tableRows(html, "Transfers");
    expect(rows[0]).toEqual(["Time (UTC)", "Kind", "From", "To", "Amount (XAU)", "Transaction"]);
    expect(rows).toHaveLength(21);
    expect(textOf(html)).toContain("Newest first. A transfer from");
    expect(linksTo(html, "Older")).toEqual([`${path}?marker=${TRANSFERS_FIRST}`]);
    expect(linksTo(html, "Back to XAU")).toEqual([P(HTF)]);
  });

  it("is the page behind the first one's marker: 8 transfers, class slow, noindex and follow, no canonical URL, Newer back to the first page", async () => {
    const [[, second]] = Object.entries(transfersSecond);
    const path = `${T(HTF)}?marker=${TRANSFERS_FIRST}`;
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(callsOf(mock)).toEqual([ISSUANCE(HTF), TRANSFERS20(HTF, TRANSFERS_FIRST)].sort());
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
    expect(isNoindex(html)).toBe(true);
    expect(tableRows(html, "Transfers")).toHaveLength(second.transfers.length + 1);
    expect(second.transfers).toHaveLength(8);
    expect(linksTo(html, "Newer")).toEqual([T(HTF)]);
  });

  it("answers a marker that is none, one the API refuses and one with nothing behind it with a 404 of class short", async () => {
    let mock = upstream("xrpl");
    for (const marker of ["***", ""]) {
      const response = await get(`${T(HTF)}?marker=${marker}`);
      await response.text();
      expect(response.status, JSON.stringify(marker)).toBe(404);
      expect(mock.requests, JSON.stringify(marker)).toEqual([]);
    }
    const refused = "QUFBQQ";
    mock = upstream("xrpl", { [TRANSFERS20(HTF, refused)]: dataApiError(400, "invalid marker") });
    let response = await get(`${T(HTF)}?marker=${refused}`);
    await response.text();
    expect(response.status).toBe(404);
    const past = "QkJCQg";
    mock = upstream("xrpl", { [TRANSFERS20(HTF, past)]: { result: "success", coverage: { complete: true, from_ledger_index: 1 }, count: 0, transfers: [] } });
    response = await get(`${T(HTF)}?marker=${past}`);
    await response.text();
    expect(response.status).toBe(404);
    expect(callsOf(mock)).toContain(TRANSFERS20(HTF, past));
  });

  it("redirects a lower case ID and a made-up query to the canonical URL, and reads the node for the head alone when the index has no answer", async () => {
    const mock = upstream("xrpl");
    const lower = await get(T(HTF.toLowerCase()));
    expect(lower.status).toBe(302);
    expect(lower.headers.get("Location")).toBe(T(HTF));
    const query = await get(`${T(HTF)}?x=1`);
    expect(query.status).toBe(302);
    expect(mock.requests).toEqual([]);

    const path = T(NODE_ONLY);
    await forgetStored(path);
    const node = upstream("xrpl");
    const { html } = await page(path);
    expect(callsOf(node)).toEqual([ISSUANCE(NODE_ONLY), NODE(NODE_ONLY), TRANSFERS20(NODE_ONLY)].sort());
    expect(textOf(html)).toContain("Not in the index yet, shown from the network");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain('rel="canonical"');
    expect(await storedAs(path)).toEqual(FROM_NETWORK);
  });

  it("serves the head with the list's error and Retry, unstored, when the transfers call fails, and is the Xahau page on Xahau", async () => {
    const path = T(lockedAll);
    vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { [TRANSFERS20(lockedAll)]: unavailable() });
    const response = await get(path);
    const html = await response.text();
    await expectDegraded(path, response);
    expect(textOf(html)).toContain("Couldn’t load the transfers.");

    const mock = upstream("xahau");
    const xahau = await get(`/xahau/mpt/${HTF}/transfers`);
    const body = await xahau.text();
    expect(xahau.status).toBe(404);
    expect(textOf(body)).toContain("MPT isn't enabled on Xahau");
    expect(mock.requests).toEqual([]);
  });
});
