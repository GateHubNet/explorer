import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";

import { loader as nftLoader } from "../../app/routes/net.nft.$id";
import type { Nft, NftEvent, NftOffer } from "../../app/server/api-types";
import { createLoadContext, type Env } from "../../app/server/env";
import { nftCase } from "../support/nft-cases";
import { alerts, expectDegraded, isNoindex, isStored, keysOf, linksTo, unavailable } from "../support/nft-pages";
import { nftAnswerSample, nftEventsPageSample, nftOfferSample, nftOffersPageSample, nftSample } from "../support/nft-samples";
import { elementText, hrefs, pageClient, tableRows, textOf } from "../support/pages";
import { cold, keptFor, storedEntries } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, nodeError, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";

// An NFT's page, `/{net}/nft/{ID}` (NFT spec 1.3, 4 and 9; Review Focus 2 and 5), on the real Worker against the generated NFT answers of the data API and the node
// (test/fixtures/http/*/data-api/nfts/…, */node/nft_info|nft_sell_offers|nft_buy_offers|ledger_entry/…): what an index that failed or a node that failed does to the page (a 503 that is
// never stored, never a stored 404), a node that is not Clio, a card that failed, each mode of spec 4.1 with its calls and its class, the history's two views, a page behind a marker, the
// URI of an NFT, Xahau's words, and the redirects and 404s of the URL's own parts. The off-case of `NFTS` is nfts-off.spec.ts (the `worker-off` project).
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included, and an error or a degraded page is never stored. So a test that looks
// at what is stored, or at the clock, reads an NFT of its own: the fixtures' NFTs for the modes (each view of each read by one test), and for the failures, the cards and the URI an
// NFT made up for the test (`make`: its id is new, and the index's answers are the test's, as overrides of the calls). Every test takes the subrequest entries away (`cold`,
// test/support/subrequest-miss.ts): each call of a render reaches the mock, so an override is always the answer and a list of calls does not depend on the order of the tests. The pages
// do not poll, so no call asks for the failure hold; `Date` alone is faked all the same and moved 301 s on after each test, past the longest keep (the edge cache's freshness reads
// `Date`), so that no test reads what an earlier one left. The afterEach below fails a test whose override no request used.

const { get, stored, storedAs } = pageClient("198.18.63");

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

// ---- The NFTs of the fixtures and the calls, by the keys the mock names them (its query sorted by name) -------------------------------------------------------------------

const FEATURED = await nftCase("xrpl", "featured");
const BURNED = await nftCase("xrpl", "burned");
const UNOWNED = await nftCase("xrpl", "unowned");
const NETWORK = await nftCase("xrpl", "network");
const NETWORK_BURNED = await nftCase("xrpl", "network-burned");
const MISSING = await nftCase("xrpl", "missing");
const URI_FEATURED = await nftCase("xahau", "featured");
const URI_BURNED = await nftCase("xahau", "burned");
const URI_UNOWNED = await nftCase("xahau", "unowned");
const URI_NETWORK = await nftCase("xahau", "network");
const URI_MISSING = await nftCase("xahau", "missing");

/** The id of an NFT that no fixture has and no earlier test has used: the index says "nft not found", and so does the node, unless a test says otherwise. */
let made = 0;
const fresh = (): string => `${FEATURED.id.slice(0, 62)}${(++made).toString(16).toUpperCase().padStart(2, "0")}`;

/** The requests of a page, as the mock names them (`seen`: the most specific key of each), and the keys an override of the node's answer is named by (`on`). */
const calls = (id: string) => ({
  NFT: `GET /v2/nfts/${id}`,
  OFFERS: `GET /v2/nfts/${id}/offers?limit=50`,
  /** The history of the default view, without the offer events. */
  HISTORY: `GET /v2/nfts/${id}/history?descending=true&event=mint,burn,modify,sale,transfer&limit=20`,
  /** The history with the offer events (`?offers=1`). */
  HISTORY_ALL: `GET /v2/nfts/${id}/history?descending=true&limit=20`,
  INFO: `node nft_info ledger_index=validated&nft_id=${id}`,
  SELL: `node nft_sell_offers ledger_index=validated&limit=50&nft_id=${id}`,
  BUY: `node nft_buy_offers ledger_index=validated&limit=50&nft_id=${id}`,
  ENTRY: `node ledger_entry index=${id}&ledger_index=validated`,
});
const on = (id: string) => ({ INFO: `node nft_info ${id}`, SELL: `node nft_sell_offers ${id}`, BUY: `node nft_buy_offers ${id}`, ENTRY: `node ledger_entry ${id}` });

/**
 * The index's answers for an NFT made up for a test: the NFT (the sample's, held by its owner, with the keys `nft` overrides), its offers and its events (none), and what `extra`
 * replaces. `all` is the view with the offer events (`?offers=1`), whose history is another call.
 */
function make(id: string, nft: Partial<Nft> = {}, extra: { offers?: NftOffer[]; events?: NftEvent[]; all?: boolean } & Overrides = {}): Overrides {
  const key = calls(id);
  const { offers = [], events = [], all = false, ...overrides } = extra;
  return {
    [key.NFT]: nftAnswerSample({ nft: nftSample({ nft_id: id, issuer: FEATURED.issuer, taxon: 0, ...nft }) }),
    [key.OFFERS]: nftOffersPageSample({ offers, count: offers.length }),
    [all ? key.HISTORY_ALL : key.HISTORY]: nftEventsPageSample({ events, count: events.length }),
    ...overrides,
  };
}
/** An NFT of the index that has no owner and was never sold: the one whose owner is the node's to tell. */
const UNOWNED_NFT: Partial<Nft> = { owner: undefined, owner_since: undefined, sale_count: 0, last_sale: undefined };

const API_BASE = "https://xrpl.data.example.invalid";

const LIVE = { cls: "live", ttl: 5 };
const SLOW = { cls: "slow", ttl: 3600 };
const SHORT = { cls: "short", ttl: 30 };
const FROM_NETWORK = { cls: "short", ttl: 60 };
const MARKER_PAGE = { cls: "slow", ttl: 3600 };
const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };

/** The title of the page: the first `<title>`. */
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
/** The rows of a table of the page. */
const rowsOf = (html: string, label: string) => tableRows(html, label);
/** The text of the Owner, Burned or Last sale fact of the header card (its `<dt>`'s `<dd>`), `undefined` when the page has no such fact. */
const factOf = (html: string, label: string) => {
  const found = new RegExp(`<dt>${label}</dt><dd>([\\s\\S]*?)</dd>`).exec(html)?.[1];
  return found === undefined ? undefined : textOf(found);
};
/** The log lines of a spied `console.error` that mention `part`. */
const loggedAbout = (errors: MockInstance<typeof console.error>, part: string) => errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes(part));
const noindexMeta = /<meta name="robots" content="noindex"\/?>/;

/** The framework's "Cannot GET" 404 of a data API without D3 (the client reads it as an outage, never as an NFT that is not there). */
const cannotGet = (key: string) => dataApiError(404, `Cannot GET ${key.replace(/^GET /, "").split("?")[0]}`);

// ---- Failures first --------------------------------------------------------------------------------------------------------------------------------------------------------

describe("the index failing (Review Focus 2)", () => {
  it("an index 5xx is a 503 not stored, with Retry-After, and the node is not asked in its place", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { [key.NFT]: unavailable() });
    const path = `/xrpl/nft/${id}`;
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, key.NFT)).toEqual([503]);
    // A failed index never asks the node: it would be shown as an NFT the index lacks, or as a 404.
    expect(mock.requests.filter((request) => request.kind === "node")).toEqual([]);
    expect(await isStored(path)).toBe(false);
    expect(loggedAbout(errors, "the NFT could not be loaded")).toHaveLength(1);
    // The calls that began with it have settled: nothing is left running or unhandled behind the answer.
    expect(statusesOf(mock, key.OFFERS)).toHaveLength(1);
    expect(statusesOf(mock, key.HISTORY)).toHaveLength(1);
  });

  it.each([
    ["a 429", () => dataApiError(429, "slow down", { "Retry-After": "7" })],
    ["a malformed 200", () => new Response("<html>not json</html>", { status: 200, headers: { "Content-Type": "text/html" } })],
    ["an API without D3 (Cannot GET)", null],
  ])("%s on the NFT is a 503 not stored, never a 404", async (_what, failure) => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id).NFT;
    mock = mockUpstream("xrpl", { [key]: failure === null ? cannotGet(key) : failure });
    const path = `/xrpl/nft/${id}`;
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(mock.requests.filter((request) => request.kind === "node")).toEqual([]);
    expect(await isStored(path)).toBe(false);
  });

  it("is a 503 not stored 4.5 s after the loader began when the index has not answered", async () => {
    cold();
    const id = fresh();
    mock = mockUpstream("xrpl", { [calls(id).NFT]: () => new Promise<Response>(() => {}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/nft/${id}`;
    const started = performance.now();
    const { response } = await render(path);
    const took = performance.now() - started;

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    // The card's deadline; the data API client would have given up at 5 s. Nothing asked the node in its place.
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(mock.requests.filter((request) => request.kind === "node")).toEqual([]);
    expect(await isStored(path)).toBe(false);
    expect(loggedAbout(errors, "the NFT took too long")).toHaveLength(1);
  }, 15_000);
});

describe("an NFT the index lacks, against a node that fails or is not Clio (Review Focus 2)", () => {
  it("not found in the index and a node 503 is a 503 not stored, never a stored 404", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { [on(id).INFO]: unavailable() });
    const path = `/xrpl/nft/${id}`;
    const { response } = await render(path);

    expect(statusesOf(mock, key.NFT)).toEqual([404]);
    expect(statusesOf(mock, key.INFO)).toEqual([503]);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(await isStored(path)).toBe(false);
    expect(loggedAbout(errors, "the NFT could not be loaded")).toHaveLength(1);
  });

  it.each([
    ["a node that answers with an error that is not 'not found'", nodeError("internal")],
    ["a node that is not synced", nodeError("noNetwork")],
    ["a node that is limiting us", nodeError("slowDown")],
    ["a node that gave nothing readable", () => new Response("not json", { status: 200 })],
    ["a node that failed at the gateway", () => new Response("bad gateway", { status: 502 })],
  ])("not found in the index and %s is a 503 not stored", async (_what, answer) => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    mock = mockUpstream("xrpl", { [on(id).INFO]: answer });
    const path = `/xrpl/nft/${id}`;
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
  });

  it("a node that answers unknownCmd makes an NFT the index lacks a 404, logged once per Worker instance, whatever the next ask is", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = [fresh(), fresh(), fresh()];
    mock = mockUpstream("xrpl", {
      [on(ids[0]!).INFO]: nodeError("unknownCmd"),
      [on(ids[1]!).INFO]: nodeError("unknownCmd"),
      [on(ids[2]!).INFO]: nodeError("notImpl"),
    });
    for (const id of ids) {
      const path = `/xrpl/nft/${id}`;
      const { response, text } = await render(path);
      expect(response.status, id).toBe(404);
      expect(text).toContain(`We couldn’t find NFT ${id.slice(0, 8)}…${id.slice(-4)} on XRPL.`);
      expect(await storedAs(path)).toEqual(SHORT);
      // The node was asked for each, and said it does not know the command.
      expect(statusesOf(mock, calls(id).INFO)).toEqual([200]);
    }
    // The real reader says so once, not three times (a node that is not Clio would fill the log).
    expect(loggedAbout(errors, "the node has no nft_info command")).toHaveLength(1);
    expect(loggedAbout(errors, "the node has no nft_info command")[0]).toContain("unknownCmd");
  });
});

describe("an NFT whose owner the index does not have (Review Focus 2)", () => {
  it("is served degraded, owner not in the index yet, when the node failed; and never stored", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { ...make(id, UNOWNED_NFT), [on(id).INFO]: unavailable() });
    const path = `/xrpl/nft/${id}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key.INFO)).toEqual([503]);
    expect(factOf(html, "Owner")).toBe("Not in the index yet");
    expect(text).not.toContain("read from the network");
    expect(alerts(html)).toBe(0);
    expect(loggedAbout(errors, "the NFT's owner from the network could not be loaded")).toHaveLength(1);
  });

  it("is degraded when the node has not answered in time (its own client gives up at 3 s), and says it could not be loaded", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    mock = mockUpstream("xrpl", { ...make(id, UNOWNED_NFT), [on(id).INFO]: () => new Promise<Response>(() => {}) });
    const path = `/xrpl/nft/${id}`;
    const started = performance.now();
    const { response, html } = await render(path);

    await expectDegraded(path, response);
    // The node client's own timeout (3 s) comes before the card's deadline.
    expect(performance.now() - started).toBeGreaterThanOrEqual(2_900);
    expect(factOf(html, "Owner")).toBe("Not in the index yet");
    expect(loggedAbout(errors, "the NFT's owner from the network could not be loaded")).toHaveLength(1);
  }, 15_000);

  it.each([
    ["the node does not have the NFT (objectNotFound)", nodeError("objectNotFound")],
    ["the node is not Clio (unknownCmd is not found too)", nodeError("unknownCmd")],
  ])("is served stored live, owner not in the index yet, when %s: not found is no failure", async (_what, answer) => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    mock = mockUpstream("xrpl", { ...make(id, UNOWNED_NFT), [on(id).INFO]: answer });
    const path = `/xrpl/nft/${id}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(factOf(html, "Owner")).toBe("Not in the index yet");
    expect(await storedAs(path)).toEqual(LIVE);
    expect(alerts(html)).toBe(0);
    expect(loggedAbout(errors, "owner from the network")).toEqual([]);
  });
});

describe("a card that failed", () => {
  it("offers or history failing is told in place, logged under its name and degraded, and the rest of the page stands", async () => {
    cold();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { ...make(id), [key.OFFERS]: unavailable(), [key.HISTORY]: unavailable() });
    const path = `/xrpl/nft/${id}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key.OFFERS)).toEqual([503]);
    expect(statusesOf(mock, key.HISTORY)).toEqual([503]);
    expect(text).toContain("Couldn’t load the open offers.");
    expect(text).toContain("Couldn’t load the history.");
    expect(alerts(html)).toBe(2);
    // The NFT itself is drawn: the heading, the owner, the details; the link that changes the history's view is still there.
    expect(elementText(html, "nft-page__title")).toMatch(/^NFT #[\d,]+$/);
    expect(factOf(html, "Owner")).toContain("rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx");
    expect(rowsOf(html, "Open offers")).toEqual([]);
    expect(rowsOf(html, "History")).toEqual([]);
    expect(linksTo(html, "Show offer events")).toEqual([`${path}?offers=1`]);
    expect(loggedAbout(errors, "the NFT's open offers could not be loaded")).toHaveLength(1);
    expect(loggedAbout(errors, "the NFT's history could not be loaded")).toHaveLength(1);
  });

  it("an API without D3's history (Cannot GET) is a failed card, never a stored 404", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { ...make(id, { owner: undefined, owner_since: undefined, burned: true }), [key.HISTORY]: cannotGet(key.HISTORY) });
    const path = `/xrpl/nft/${id}`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key.HISTORY)).toEqual([404]);
    expect(text).toContain("Couldn’t load the history.");
    expect(alerts(html)).toBe(1);
    expect(html).not.toContain("Cannot GET");
  });

  it("does not degrade a burned NFT for an offers call it does not use: it has none", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { ...make(id, { owner: undefined, owner_since: undefined, burned: true }), [key.OFFERS]: unavailable() });
    const path = `/xrpl/nft/${id}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(text).toContain("No open offers.");
    expect(statusesOf(mock, key.OFFERS)).toEqual([503]);
  });

  it("gives up on the history 4.5 s after the loader began, says it took too long, and answers 200 all the same, not stored", async () => {
    cold();
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { ...make(id), [key.HISTORY]: () => new Promise<Response>(() => {}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/nft/${id}`;
    const started = performance.now();
    const { response, text } = await render(path);
    const took = performance.now() - started;

    await expectDegraded(path, response);
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(text).toContain("Couldn’t load the history.");
    expect(loggedAbout(errors, "the NFT's history took too long")).toHaveLength(1);
  }, 15_000);
});

// ---- The URL's own parts: redirects and 404s, before any call -------------------------------------------------------------------------------------------------------------

describe("the URL (spec 1.2, 1.3)", () => {
  it("redirects a lower-case id to the upper-case URL, immutable, with no call", async () => {
    mock = mockUpstream("xrpl");
    const from = `/xrpl/nft/${FEATURED.id.toLowerCase()}`;
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/nft/${FEATURED.id}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(IMMUTABLE);
  });

  it("redirects a mixed-case id too, and keeps the canonical query: only the path differs, so immutable", async () => {
    mock = mockUpstream("xahau");
    const mixed = `${URI_FEATURED.id.slice(0, 30).toLowerCase()}${URI_FEATURED.id.slice(30)}`;
    const from = `/xahau/nft/${mixed}?offers=1`;
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xahau/nft/${URI_FEATURED.id}?offers=1`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(IMMUTABLE);
  });

  it.each([
    [(id: string) => `/xrpl/nft/${id}?x=1`, (id: string) => `/xrpl/nft/${id}`],
    [(id: string) => `/xrpl/nft/${id}?offers=0`, (id: string) => `/xrpl/nft/${id}`],
    [(id: string) => `/xrpl/nft/${id}?offers=1&offers=0`, (id: string) => `/xrpl/nft/${id}?offers=1`],
    [(id: string) => `/xrpl/nft/${id}?marker=AAAA&offers=1&back=BBBB&x=1`, (id: string) => `/xrpl/nft/${id}?offers=1&marker=AAAA&back=BBBB`],
    [(id: string) => `/xrpl/nft/${id}?back=BBBB`, (id: string) => `/xrpl/nft/${id}`],
    // The id in lower case and a query to tidy: one redirect to the one URL, class short (a made-up query string is not kept a year).
    [(id: string) => `/xrpl/nft/${id.toLowerCase()}?x=1&offers=1`, (id: string) => `/xrpl/nft/${id}?offers=1`],
  ])("redirects %s to the view's one URL, short, with no call", async (written, canonical) => {
    mock = mockUpstream("xrpl");
    const from = written(FEATURED.id);
    const response = await get(from);
    await response.text();

    expect(response.status, from).toBe(302);
    expect(response.headers.get("Location")).toBe(canonical(FEATURED.id));
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(SHORT);
  });

  it.each([
    ["not 64 hex digits", "ABC123"],
    ["63 digits", "A".repeat(63)],
    ["65 digits", "A".repeat(65)],
    ["a non-hex letter", `${"A".repeat(63)}G`],
    ["a CTID", "C0000001000A0000"],
    ["a sign", `-${"A".repeat(63)}`],
  ])("is a 404 of class short, and no call, for an id that is %s", async (_what, id) => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/nft/${id}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toMatch(/We couldn’t find NFT ".*" on XRPL\./);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("says URIToken on Xahau for an id that is none", async () => {
    mock = mockUpstream("xahau");
    const { response, text } = await render("/xahau/nft/nope");
    expect(response.status).toBe(404);
    expect(text).toContain('We couldn’t find URIToken "nope" on Xahau.');
    expect(mock.requests).toEqual([]);
  });

  it("is a 404 of class short, before any call and before any redirect, for a marker that is not one", async () => {
    mock = mockUpstream("xrpl");
    for (const path of [`/xrpl/nft/${FEATURED.id}?marker=%25`, `/xrpl/nft/${FEATURED.id}?back=AAAA&marker=%25&x=1`, `/xrpl/nft/${FEATURED.id.toLowerCase()}?marker=%25`]) {
      const { response, text } = await render(path);
      expect(response.status, path).toBe(404);
      expect(text, path).toContain("that page of NFT 00190BB8…E96F");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("answers its .data URL with the page's data and not a redirect: React Router's _routes is no part of the view", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(FEATURED.id);
    const { response } = await render(`/xrpl/nft/${FEATURED.id}.data?_routes=routes%2Fnet.nft.%24id`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/x-script");
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY].sort());
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/nft/${FEATURED.id}.data?_routes=routes%2Fnet.nft.%24id&offers=0`;
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain(`/xrpl/nft/${FEATURED.id}`);
    expect(mock.requests).toEqual([]);
    // The Cache API keeps no 202; the loader's own answer to that request names the class.
    expect(await stored(path)).toBeUndefined();
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const own = (await nftLoader({
      request: new Request(`https://explorer.test${path}`),
      url: new URL(`https://explorer.test${path.replace(".data", "")}`),
      params: { net: "xrpl", id: FEATURED.id },
      context: createLoadContext(env as unknown as Env, ctx),
    } as never)) as Response;
    expect(own.status).toBe(302);
    expect(own.headers.get("Location")).toBe(`/xrpl/nft/${FEATURED.id}`);
    expect(own.headers.get("X-Cache-Class")).toBe("short");
  });
});

// ---- An indexed NFT ---------------------------------------------------------------------------------------------------------------------------------------------------

describe("an NFT of the index (mode indexed)", () => {
  it("xrpl: the calls of spec §4.3 with their classes, stored live", async () => {
    cold();
    const kept = storedEntries();
    mock = mockUpstream("xrpl");
    const key = calls(FEATURED.id);
    const path = `/xrpl/nft/${FEATURED.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual(LIVE);
    // #1, #3 and #4 side by side; the node is not asked for an NFT that has an owner.
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY].sort());
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    expect(await keptFor(kept, `GET ${API_BASE}/v2/nfts/${FEATURED.id}`)).toBe("public, max-age=5");
    expect(await keptFor(kept, `GET ${API_BASE}/v2/nfts/${FEATURED.id}/offers?limit=50`)).toBe("public, max-age=5");

    // The head: the title and the canonical URL with its sharing tags.
    expect(titleOf(html)).toBe("NFT #107,604,335 of rLxc1b…rwMy · taxon 0 · XRPL · explorer");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${path}"/>`);
    expect(html).toContain(`<meta property="og:image" content="https://explorer.test/og/xrpl/nft/${FEATURED.id}.png"/>`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(isNoindex(html)).toBe(false);
    expect(html).not.toMatch(/<meta name="robots"/);
    // The header card.
    expect(text).toContain("XRPL / NFTs / rLxc1b…rwMy · taxon 0 / #107,604,335");
    expect(elementText(html, "nft-page__title")).toBe("NFT #107,604,335");
    expect(text).toContain("NFToken");
    expect(text).toContain("No preview");
    expect(text).toContain("Serial 107,604,335 of the collection");
    expect(text).toContain(FEATURED.id);
    expect(html).toContain('aria-label="Copy NFT id"');
    expect(factOf(html, "Owner")).toContain("rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk");
    expect(factOf(html, "Owner")).toContain("since Oct 24, 2026, 21:30 UTC");
    expect(factOf(html, "Last sale")).toContain("150 XRP");
    expect(factOf(html, "Last sale")).toContain("sold once");
    // The details, the id's card, the open offers and the history.
    expect(text).toContain(`/v2/nfts/${FEATURED.id}`);
    expect(text).toContain("The id, decoded");
    expect(rowsOf(html, "Open offers")[0]).toEqual(["Side", "Amount", "By", "Only for", "Expires", "Created"]);
    expect(rowsOf(html, "Open offers")).toHaveLength(3);
    expect(rowsOf(html, "History")[0]).toEqual(["Time", "Event", "Accounts", "Amount", "Transaction"]);
    // The default view hides the offer events: the one sale, its accounts two links with an arrow that is a picture and a hidden "to".
    const history = rowsOf(html, "History");
    expect(history).toHaveLength(2);
    expect(history[1]![1]).toBe("sale");
    expect(html).toMatch(/<span aria-hidden="true" class="faint">→<\/span><span class="sr">to<\/span>/);
    expect(history[1]![2]).not.toContain("→ to →");
    expect(linksTo(html, "Show offer events")).toEqual([`${path}?offers=1`]);
    expect(alerts(html)).toBe(0);
    // Each collection and account link of the page leads to a page of the explorer.
    expect(hrefs(html)).toContain(`/xrpl/nfts/${FEATURED.issuer}/0`);
  });

  it("?offers=1 asks the history without the event filter, and its toggle hides them; the first page has an Older link", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(FEATURED.id);
    const path = `/xrpl/nft/${FEATURED.id}?offers=1`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY_ALL].sort());
    expect(await storedAs(path)).toEqual(LIVE);
    const history = rowsOf(html, "History").slice(1);
    // The page's twenty events, the offers removed by one sale as one row.
    expect(history.length).toBeGreaterThanOrEqual(10);
    expect(history.map((row) => row[2])).toContain("2 offers removed by the sale");
    expect(linksTo(html, "Hide offer events")).toEqual([`/xrpl/nft/${FEATURED.id}`]);
    // The canonical URL is the NFT's, for either view.
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test/xrpl/nft/${FEATURED.id}"/>`);
    expect(linksTo(html, "Older")).toEqual([`${path}&marker=WzEwNzg3ODc3NSwxMzAsMF0`]);
    expect(linksTo(html, "Newer")).toEqual([]);
    const events = new Set(history.map((row) => row[1]));
    expect(events).toContain("offer create");
    expect(events).toContain("sale");
  });

  it("compares an offer's expiration with the loader's own clock: the one that expires before it is tagged expired", async () => {
    cold();
    const real = Date.now();
    const id = fresh();
    const offers = [
      nftOfferSample({ offer_id: "A".repeat(64), expiration: "2026-10-24T21:42:50Z" }),
      nftOfferSample({ offer_id: "B".repeat(64), expiration: "2027-11-29T04:52:11Z", amount: "119.52" }),
      nftOfferSample({ offer_id: "C".repeat(64), is_sell_offer: true, destination: undefined, expiration: undefined, amount: "300" }),
    ];
    try {
      vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
      mock = mockUpstream("xrpl", make(id, {}, { offers }));
      const { html } = await render(`/xrpl/nft/${id}`);
      expect(rowsOf(html, "Open offers").slice(1).map((row) => row[4])).toEqual(["Oct 24, 2026 expired", "Nov 29, 2027", "never"]);
      expect(mock.unusedOverrides()).toEqual([]);
      mock.restore();

      // The clock is what decides it: an hour before the first expiry, none has (the other view of the NFT, so that this is no copy of the first).
      vi.setSystemTime(new Date("2026-10-24T20:42:50Z"));
      mock = mockUpstream("xrpl", make(id, {}, { offers, all: true }));
      const earlier = await render(`/xrpl/nft/${id}?offers=1`);
      expect(rowsOf(earlier.html, "Open offers").slice(1).map((row) => row[4])).toEqual(["Oct 24, 2026", "Nov 29, 2027", "never"]);
    } finally {
      vi.setSystemTime(real + 301_000);
    }
  });

  it("draws the URI as text, never a link, whatever it holds", async () => {
    cold();
    const hexOf = (value: string) => Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    for (const uri of ["javascript:alert(1)", "https://example.com/1.json", "ipfs://bafybeiexample/1.json", '<img src=x onerror="alert(1)">']) {
      const id = fresh();
      mock = mockUpstream("xrpl", make(id, { uri: hexOf(uri) }));
      const { response, html, text } = await render(`/xrpl/nft/${id}`);
      expect(response.status, uri).toBe(200);
      expect(text, uri).toContain(uri);
      expect(text).toContain("Decoded from hex. Not fetched.");
      // Escaped, and never an attribute: no link of the page goes anywhere but the explorer, and nothing of it is an image or a script.
      expect(hrefs(html).filter((href) => !href.startsWith("/") && !href.startsWith("#")), uri).toEqual([]);
      expect(html).not.toContain("<img");
      // (An element with a handler would start with a `<`; the URI's own `<` is `&lt;` in the page and `\u003c` in its data.)
      expect(html).not.toMatch(/<[^>]*\bon(error|click|load)=/i);
      expect(mock.requests.filter((request) => request.url.includes("example.com") || request.url.includes("ipfs"))).toEqual([]);
      mock.restore();
    }
    mock = undefined;
  });
});

describe("an NFT burned (mode burned)", () => {
  it("is stored slow: the burned tag, who burned it, no open offers, its history; the node is not asked", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(BURNED.id);
    const path = `/xrpl/nft/${BURNED.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY].sort());
    expect(titleOf(html)).toBe("NFT #102,436,236 (burned) of ravC5c…abec · taxon 0 · XRPL · explorer");
    expect(html).toMatch(/<span class="tag">burned<\/span>/);
    expect(factOf(html, "Burned")).toContain("Oct 25, 2026");
    expect(factOf(html, "Burned")).toContain("ravC5cZreMZuKEWSrpra5nkWnfzPmrabec");
    expect(factOf(html, "Owner")).toBeUndefined();
    expect(text).toContain("No open offers.");
    expect(rowsOf(html, "History").slice(1).map((row) => row[1])).toEqual(["burn"]);
    // A burned NFT is still an NFT of the index: indexable.
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${path}"/>`);
  });
});

describe("an NFT the index has without an owner (mode indexed, owner from the network)", () => {
  it("asks the node after the index and says where the owner was read from; live", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(UNOWNED.id);
    const path = `/xrpl/nft/${UNOWNED.id}?offers=1`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(LIVE);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY_ALL, key.INFO].sort());
    // The node is asked after #1 answered, not beside it.
    const order = mock.requests.map((request) => request.key);
    expect(order.indexOf(key.INFO)).toBeGreaterThan(order.indexOf(key.NFT));
    expect(factOf(html, "Owner")).toContain("rHhvUexKKSJZG9vuZKX2kNendG2TXoavG9");
    expect(text).toContain("read from the network at ledger #107,853,043");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test/xrpl/nft/${UNOWNED.id}"/>`);
    // Its offers are the index's: a bid and an ask.
    expect(rowsOf(html, "Open offers").slice(1).map((row) => row[0])).toEqual(["buy", "sell"]);
    expect(alerts(html)).toBe(0);
  });
});

// ---- An NFT shown from the network ---------------------------------------------------------------------------------------------------------------------------------------

describe("an NFT only the node has (mode network)", () => {
  it("shows it from the node, sell offers first, no history, noindex; short, kept 60 s", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(NETWORK.id);
    const path = `/xrpl/nft/${NETWORK.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(FROM_NETWORK);
    // The index has none of it, so its three calls say so; then the node's: the NFT, and after it both sides of its offers.
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY, key.INFO, key.SELL, key.BUY].sort());
    expect(statusesOf(mock, key.NFT)).toEqual([404]);
    const order = mock.requests.map((request) => request.key);
    expect(order.indexOf(key.INFO)).toBeGreaterThan(order.indexOf(key.NFT));
    expect(order.indexOf(key.SELL)).toBeGreaterThan(order.indexOf(key.INFO));
    expect(order.indexOf(key.BUY)).toBeGreaterThan(order.indexOf(key.INFO));

    expect(text).toContain("Not in the index yet, shown from the network. Its history appears once the index has it.");
    expect(html).toMatch(noindexMeta);
    expect(html).not.toMatch(/<link rel="canonical"/);
    expect(html).not.toMatch(/og:image/);
    expect(titleOf(html)).toBe("NFT #98,894,589 of raNypR…RV92 · taxon 123,589,321 · XRPL · explorer");
    expect(factOf(html, "Owner")).toContain("r4Xgqy68ykjLEJAkFQ7EaFs8VEdSiWkSeX");
    expect(factOf(html, "Owner")).toContain("read from the network at ledger #107,886,163");
    expect(factOf(html, "Last sale")).toBeUndefined();
    // The offers are the node's: the sell offer first, then the buy offers; no ledger to link.
    const offers = rowsOf(html, "Open offers").slice(1);
    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers[0]![0]).toBe("sell");
    expect(offers[0]![1]).toBe("60 XRP");
    expect(offers.slice(1).every((row) => row[0] === "buy")).toBe(true);
    expect(offers.every((row) => row[5] === "—")).toBe(true);
    // No history and no link that changes its view.
    expect(text).not.toContain("Show offer events");
    expect(rowsOf(html, "History")).toEqual([]);
    expect(alerts(html)).toBe(0);
  });

  it("tells the offers that the node could not give, and degrades: the NFT itself stands", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const key = calls(NETWORK.id);
    mock = mockUpstream("xrpl", { [on(NETWORK.id).BUY]: nodeError("internal") });
    const path = `/xrpl/nft/${NETWORK.id}?offers=1`;
    const { response, html, text } = await render(path);

    await expectDegraded(path, response);
    expect(statusesOf(mock, key.BUY)).toEqual([200]);
    expect(text).toContain("Couldn’t load the open offers.");
    expect(alerts(html)).toBe(1);
    expect(elementText(html, "nft-page__title")).toBe("NFT #98,894,589");
  });

  it("says that there are more offers than the first 50 when either side had a marker", async () => {
    cold();
    mock = mockUpstream("xrpl", { [on(NETWORK.id).SELL]: { nft_id: NETWORK.id, offers: [], marker: "NEXT", validated: true } });
    const { response, text } = await render(`/xrpl/nft/${NETWORK.id}?offers=1`);
    expect(response.status).toBe(200);
    expect(text).toContain("Showing the first 50.");
  });

  it("from the network, burned: the burned tag, no offers asked for, noindex; short, kept 60 s", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(NETWORK_BURNED.id);
    const path = `/xrpl/nft/${NETWORK_BURNED.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(FROM_NETWORK);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY, key.INFO].sort());
    expect(titleOf(html)).toBe("NFT #106,292,755 (burned) of rGxWAW…16Xu · taxon 500 · XRPL · explorer");
    expect(html).toMatch(noindexMeta);
    expect(text).toContain("Not in the index yet, shown from the network.");
    expect(factOf(html, "Owner")).toContain("Burned");
    expect(text).toContain("No open offers.");
  });
});

describe("an id neither the index nor the node has (mode none)", () => {
  it("is a 404 of class short that offers the same search on the other network; the node was asked", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(MISSING.id);
    const path = `/xrpl/nft/${MISSING.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find NFT 00190BB8…E970 on XRPL.");
    expect(linksTo(html, "Search on Xahau")).toEqual([`/xahau/search?q=${MISSING.id}`]);
    expect(await storedAs(path)).toEqual(SHORT);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY, key.INFO].sort());
    expect(statusesOf(mock, key.INFO)).toEqual([200]);
  });

  it("is Xahau's words: URIToken, and the search on XRPL", async () => {
    cold();
    mock = mockUpstream("xahau");
    const key = calls(URI_MISSING.id);
    const path = `/xahau/nft/${URI_MISSING.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain(`We couldn’t find URIToken ${URI_MISSING.id.slice(0, 8)}…${URI_MISSING.id.slice(-4)} on Xahau.`);
    expect(linksTo(html, "Search on XRPL")).toEqual([`/xrpl/search?q=${URI_MISSING.id}`]);
    expect(statusesOf(mock, key.ENTRY)).toEqual([200]);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});

// ---- Xahau --------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("Xahau's URITokens", () => {
  it("xahau: a URIToken from the index: URIToken words, the digest card, live; no node call", async () => {
    cold();
    mock = mockUpstream("xahau");
    const key = calls(URI_FEATURED.id);
    const path = `/xahau/nft/${URI_FEATURED.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(LIVE);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY].sort());
    expect(titleOf(html)).toBe("URIToken 96133366… of rodinG…zKyb · Xahau · explorer");
    expect(text).toContain("Xahau / URITokens / rodinG…zKyb / 96133366…AAE9");
    expect(elementText(html, "nft-page__title")).toBe("URIToken 96133366…");
    expect(text).toContain("Minted by the issuer of");
    expect(html).toContain('aria-label="Copy URIToken id"');
    expect(text).toContain("Digest");
    expect(text).toContain("Royalty");
    expect(text).toContain("None: URITokens carry no transfer fee");
    expect(factOf(html, "Last sale")).toContain("4,200 XAH");
    expect(html).toContain(`<link rel="canonical" href="https://explorer.test${path}"/>`);
    expect(html).toContain(`<meta property="og:image" content="https://explorer.test/og/xahau/nft/${URI_FEATURED.id}.png"/>`);
  });

  it("xahau: a URIToken from ledger_entry: the index has it without an owner, so its entry is asked, and no sell or buy command", async () => {
    cold();
    mock = mockUpstream("xahau");
    const key = calls(URI_UNOWNED.id);
    const path = `/xahau/nft/${URI_UNOWNED.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY, key.ENTRY].sort());
    expect(factOf(html, "Owner")).toContain("read from the network at ledger #26,774,724");
    expect(await storedAs(path)).toEqual(LIVE);
    // The index's offer: the one sell offer of 2,200 XAH.
    expect(rowsOf(html, "Open offers")[1]!.slice(0, 2)).toEqual(["sell", "2,200 XAH"]);
    expect(text).toContain("A URIToken carries at most one sell offer, on the entry itself. Xahau has no buy offers.");
  });

  it("xahau: a URIToken only the node has: from the entry, no sell or buy command", async () => {
    cold();
    mock = mockUpstream("xahau");
    const key = calls(URI_NETWORK.id);
    const path = `/xahau/nft/${URI_NETWORK.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(FROM_NETWORK);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY, key.ENTRY].sort());
    expect(text).toContain("Not in the index yet, shown from the network.");
    expect(html).toMatch(noindexMeta);
    expect(titleOf(html)).toBe("URIToken 06CF2C55… of rodinG…zKyb · Xahau · explorer");
    expect(text).toContain("No open offers.");
    expect(rowsOf(html, "History")).toEqual([]);
  });

  it("xahau: a URIToken from the network with a sell offer on its entry shows that offer, from the entry", async () => {
    cold();
    const id = URI_NETWORK.id;
    const entry = {
      index: id,
      ledger_index: 26774724,
      node: {
        Amount: "2200000000",
        Digest: "DD59F3C96017189AD022F96B39EA33E149D26ACAF71FF81F773382A39C030D28",
        Flags: 0,
        Issuer: URI_NETWORK.issuer,
        LedgerEntryType: "URIToken",
        Owner: "rLEUHuVCd8o9XmKn3nk8oGwYS3QEpUjo3e",
        URI: "6F64696E73657965733A726176656E3A76323A3030346230353234",
        index: id,
      },
      validated: true,
    };
    mock = mockUpstream("xahau", { [on(id).ENTRY]: entry });
    const { response, html } = await render(`/xahau/nft/${id}?offers=1`);
    expect(response.status).toBe(200);
    expect(rowsOf(html, "Open offers")[1]!.slice(0, 4)).toEqual(["sell", "2,200 XAH", expect.stringMatching(/^rLEUHu/), "anyone"]);
  });

  it("xahau: a burned URIToken: the index says so, and the node is not asked", async () => {
    cold();
    mock = mockUpstream("xahau");
    const key = calls(URI_BURNED.id);
    const path = `/xahau/nft/${URI_BURNED.id}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(SLOW);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, key.OFFERS, key.HISTORY].sort());
    expect(factOf(html, "Burned")).toContain("Oct 24, 2026");
  });
});

// ---- A page behind a marker ---------------------------------------------------------------------------------------------------------------------------------------------------

describe("a page behind a marker", () => {
  const MARKER = "WzEwNzg3ODc3NSwxMzAsMF0";
  const marked = (id: string) => `GET /v2/nfts/${id}/history?descending=true&limit=20&marker=${MARKER}`;

  it("a marker page calls #1 and #4 only, MARKER_PAGE_CLASS, noindex, follow, with Back to the NFT", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const key = calls(FEATURED.id);
    const path = `/xrpl/nft/${FEATURED.id}?offers=1&marker=${MARKER}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect([...keysOf(mock.requests)].sort()).toEqual([key.NFT, marked(FEATURED.id)].sort());
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
    expect(isNoindex(html)).toBe(true);
    expect(titleOf(html)).toBe("Older history of NFT #107,604,335 · XRPL · explorer");
    expect(elementText(html, "nft-page__title")).toBe("Older history of NFT #107,604,335");
    expect(linksTo(html, "Back to the NFT")).toEqual([`/xrpl/nft/${FEATURED.id}?offers=1`]);
    // The header card without an owner or a last sale; no details, id's card or offers.
    expect(factOf(html, "Owner")).toBeUndefined();
    expect(factOf(html, "Last sale")).toBeUndefined();
    expect(text).not.toContain("The id, decoded");
    expect(rowsOf(html, "Open offers")).toEqual([]);
    expect(rowsOf(html, "History").length).toBeGreaterThan(1);
    expect(linksTo(html, "Newer")).toEqual([`/xrpl/nft/${FEATURED.id}?offers=1`]);
  });

  it("is a 404 of class short when the API refuses the marker (a 400), or nothing is behind it, and a 503 for a failure, never stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = FEATURED.id;
    // A 400: the page does not exist.
    mock = mockUpstream("xrpl", { [marked(id)]: dataApiError(400, "invalid marker") });
    let path = `/xrpl/nft/${id}?offers=1&marker=${MARKER}&back=${MARKER}`;
    let page = await render(path);
    expect(page.response.status).toBe(404);
    expect(page.text).toContain("that page of NFT 00190BB8…E96F");
    expect(await storedAs(path)).toEqual(SHORT);
    mock.restore();

    // Nothing behind it.
    mock = mockUpstream("xrpl", { [marked(id)]: { result: "success", coverage: { complete: true, from_ledger_index: 1 }, count: 0, events: [] } });
    path = `/xrpl/nft/${id}?offers=1&marker=${MARKER}&back=${MARKER}.${MARKER}`;
    page = await render(path);
    expect(page.response.status).toBe(404);
    expect(await storedAs(path)).toEqual(SHORT);
    mock.restore();

    // A failure of the history is a 503, never stored.
    mock = mockUpstream("xrpl", { [marked(id)]: unavailable() });
    path = `/xrpl/nft/${id}?offers=1&marker=${MARKER}&back=${MARKER}.${MARKER}.${MARKER}`;
    page = await render(path);
    expect(page.response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
    mock.restore();

    // So is a failure of the NFT, and "nft not found" is a 404 that the node is not asked about (a marker is the index's).
    mock = mockUpstream("xrpl", { [calls(id).NFT]: unavailable() });
    path = `/xrpl/nft/${id}?offers=1&marker=${MARKER}&back=${MARKER}.${MARKER}.${MARKER}.${MARKER}`;
    page = await render(path);
    expect(page.response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
    mock.restore();

    const absent = fresh();
    mock = mockUpstream("xrpl");
    path = `/xrpl/nft/${absent}?marker=${MARKER}`;
    page = await render(path);
    expect(page.response.status).toBe(404);
    expect(page.text).toContain("that page of NFT");
    expect(mock.requests.filter((request) => request.kind === "node")).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});
