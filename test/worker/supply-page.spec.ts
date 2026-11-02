import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loader } from "../../app/routes/net.supply";
import { createLoadContext, type Env } from "../../app/server/env";
import { supplySample } from "../support/d7-samples";
import { namesCalls } from "../support/names";
import { alerts, expectDegraded, isStored, keysOf, tiles, unavailable } from "../support/nft-pages";
import { anchors, pageClient, textOf } from "../support/pages";
import { cold, keptFor, storedEntries } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The supply page, `/{net}/supply` (supply spec 1, 3 and 5), on the real Worker against the generated supply answers of the data API (test/fixtures/http/*/data-api/network/supply.json and
// the minted days of Xahau): what a failed call does to it, the 302 of a query string, the class each answer is stored under, the calls of each network and how long each is kept, and a
// snapshot without reserves. The off-case of `SUPPLY` is supply-off.spec.ts (the `worker-off` project), the testnets' names supply-sandbox.spec.ts, and the cases that change what the data
// API answers and read a result, the stale warning and a failed card's Retry, are the end-to-end suite's (supply-live.spec.ts: the page has one URL per network, so a case that needs a
// stored copy to be absent cannot share it with the other specs there).
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock, subrequests included (`last_validated` 2 s, the snapshot, the fees and the minted days 300 s),
// and an error or a degraded page is never stored. The page has one URL per network, so every test takes the subrequest entries away (`cold`, test/support/subrequest-miss.ts): each call of a
// render reaches the mock, so an override is always the answer and a list of calls does not depend on the order of the tests. The page does not poll, so no call asks for the failure
// hold; `Date` alone is faked all the same and moved 301 s on after each test, past the longest keep (the edge cache's freshness reads `Date`), so that no test reads the copy an earlier
// one stored. The afterEach below fails a test whose override no request used.

const { get, storedAs } = pageClient("198.18.113");

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

// ---- The calls, by the keys the mock names them (its query sorted by name) ------------------------------------------------------------------------------------------------------------

/** S, the snapshot. */
const SUPPLY = "GET /v2/network/supply";
/** A, the newest ledger. */
const LAST_VALIDATED = "GET /v2/last_validated";
/** F, the fees of the 90 days up to the recorded ledger's day (Oct 17, 2026): the network page's call. */
const FEES = "GET /v2/network/fees?end=2026-10-17&interval=day&limit=1000&start=2026-07-20";
/** M, Xahau's minted days of the same window. */
const MINTED = "GET /v2/network/supply/minted?end=2026-10-17&interval=day&limit=1000&start=2026-07-20";

/** The subrequest keys of S, A and F as the client writes them (data-api.ts: the URL, then the TTL the caller asked for). */
const API_BASE = "https://xrpl.data.example.invalid";
const SUPPLY_ENTRY = `GET ${API_BASE}/v2/network/supply [kept 300 s]`;
const LAST_VALIDATED_ENTRY = `GET ${API_BASE}/v2/last_validated [kept 2 s]`;
/** The network page's 90-day key: `FeeBucketQuery`'s order (interval, start, end, limit). */
const FEES_ENTRY = `GET ${API_BASE}/v2/network/fees?interval=day&start=2026-07-20&end=2026-10-17&limit=1000 [kept 300 s]`;

const SLOW = { cls: "slow", ttl: 300 };
const SHORT = { cls: "short", ttl: 30 };

/** The page at `path`: its status, headers and HTML. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

// ---- Failures first, as the key of each is stored only when the call answered ---------------------------------------------------------------------------------------------------------

describe("S, the snapshot, decides the page (spec 3.2)", () => {
  it("S answering 404 supply not computed yet is a 503 with Retry-After, not stored", async () => {
    cold();
    mock = mockUpstream("xrpl", { [SUPPLY]: dataApiError(404, "supply not computed yet") });
    const { response, text } = await render("/xrpl/supply");

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(text).not.toContain("supply not computed yet");
    expect(await isStored("/xrpl/supply")).toBe(false);
  });

  it("S answering Cannot GET is a 503, not stored", async () => {
    cold();
    // The framework's 404 of a data API that has no D7 behind a switch that is on: an outage and never a page.
    mock = mockUpstream("xrpl", { [SUPPLY]: dataApiError(404, "Cannot GET /v2/network/supply") });
    const { response, text } = await render("/xrpl/supply");

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(text).not.toContain("Cannot GET");
    expect(await isStored("/xrpl/supply")).toBe(false);
  });

  it("S answering a malformed amount is a 503, not stored", async () => {
    cold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [SUPPLY]: { ...supplySample("xrpl"), total: "99,985,312,374.716318" } });
    const { response } = await render("/xrpl/supply");

    expect(response.status).toBe(503);
    expect(await isStored("/xrpl/supply")).toBe(false);
  });
});

describe("a card's call failing (spec 3.2)", () => {
  it("F failing gives a degraded 200, not stored, with the burned card failed", async () => {
    cold();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [FEES]: unavailable() });
    const { response, html, text } = await render("/xrpl/supply");

    await expectDegraded("/xrpl/supply", response);
    expect(alerts(html)).toBe(1);
    expect(text).toContain("Couldn’t load XRP burned per day.");
    // The rest of the page stands: the bar and the six tiles.
    expect(text).toContain("Where the 100 billion XRP are");
    expect(tiles(html)).toHaveLength(6);
    expect(logged).toHaveBeenCalled();
  });

  it("A failing fails both cards, drops the stale check, and the page is a degraded 200", async () => {
    cold();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // Xahau has both cards. F and M wait for A, so neither is asked.
    mock = mockUpstream("xahau", { [LAST_VALIDATED]: unavailable() });
    const { response, html, text } = await render("/xahau/supply");

    await expectDegraded("/xahau/supply", response);
    expect(alerts(html)).toBe(2);
    expect(text).toContain("Couldn’t load XAH burned per day.");
    expect(text).toContain("Couldn’t load XAH minted per day.");
    expect(text).not.toContain("older than the newest ledger");
    expect(keysOf(mock.requests).sort()).toEqual([LAST_VALIDATED, SUPPLY].sort());
    // The Minted tile cannot be worked out without the days: a dash, and why.
    const minted = tiles(html).find((tile) => tile.label === "Minted, last 90 days");
    expect(minted?.value).toBe("—");
    expect(text).toContain("Couldn't load the minted days.");
    expect(logged).toHaveBeenCalled();
  });
});

// A call that never answers (spec 3.2). The cards race `CARD_DEADLINE_MS` (4.5 s from the loader's start) with `byDeadline`; the data API client would give up on a call at 5 s, so a page that
// answers at 4.5 s has raced it, and one that answers at 5 s has not. S does not race: its answer is the client's own limit. After `byDeadline` is taken off a call, or put on S, one of these fails.
describe("a call that has not answered (spec 3.2)", () => {
  const never = () => new Promise<Response>(() => {});

  // One whole render before the first clock starts, so that a test run by itself (`-t`) is not timed over the page's modules loading: the first render of a file takes about half a second more.
  beforeAll(async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const warm = mockUpstream("xrpl", { [LAST_VALIDATED]: unavailable() });
    try {
      await render("/xrpl/supply");
    } finally {
      warm.restore();
      quiet.mockRestore();
    }
  });

  /** The parts the loader logged as having taken too long, in order: the log line names the card (`the supply page's burned could not be loaded`) and says why. */
  const tookTooLong = (logged: { mock: { calls: unknown[][] } }) =>
    logged.mock.calls
      .map(([line]) => JSON.parse(String(line)) as { what: string; error: string })
      .filter((entry) => entry.error === "took too long")
      .map((entry) => entry.what);

  it("F never answering: the page is a degraded 200 at 4.5 s with the burned card failed, logged as taking too long", async () => {
    cold();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [FEES]: never });
    const started = performance.now();
    const { response, html, text } = await render("/xrpl/supply");
    const took = performance.now() - started;

    await expectDegraded("/xrpl/supply", response);
    // The card's deadline; the data API client would have given up at 5 s, and its failure would be logged as "did not answer within 5000 ms", not as "took too long".
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(statusesOf(mock, FEES)).toEqual([0]);
    expect(alerts(html)).toBe(1);
    expect(text).toContain("Couldn’t load XRP burned per day.");
    // The snapshot's own parts stand.
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Total supply", "Burned", "Escrowed", "Circulating supply", "In AMM pools", "Account reserves"]);
    expect(tiles(html).map((tile) => tile.value)).not.toContain("—");
    expect(tookTooLong(logged)).toEqual(["the supply page's burned could not be loaded"]);
  }, 15_000);

  it("M never answering, on Xahau: the page is a degraded 200 at 4.5 s with the minted card failed and the Minted tile a dash, logged as taking too long", async () => {
    cold();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xahau", { [MINTED]: never });
    const started = performance.now();
    const { response, html, text } = await render("/xahau/supply");
    const took = performance.now() - started;

    await expectDegraded("/xahau/supply", response);
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(statusesOf(mock, MINTED)).toEqual([0]);
    // The burned card has its days; the minted card is the one that failed.
    expect(alerts(html)).toBe(1);
    expect(text).toContain("Couldn’t load XAH minted per day.");
    expect(text).not.toContain("Couldn’t load XAH burned per day.");
    expect(text).toContain("XAH burned per day");
    expect(tiles(html).find((tile) => tile.label === "Minted, last 90 days")?.value).toBe("—");
    expect(tiles(html).find((tile) => tile.label === "Total supply")?.value).not.toBe("—");
    expect(tookTooLong(logged)).toEqual(["the supply page's minted could not be loaded"]);
  }, 15_000);

  it("A never answering, on Xahau: the page is a degraded 200 at 4.5 s with both cards failed, the snapshot's tiles drawn and no stale check; F and M are not asked", async () => {
    cold();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xahau", { [LAST_VALIDATED]: never });
    const started = performance.now();
    const { response, html, text } = await render("/xahau/supply");
    const took = performance.now() - started;

    await expectDegraded("/xahau/supply", response);
    expect(took).toBeGreaterThanOrEqual(4_400);
    expect(took).toBeLessThan(5_000);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([0]);
    // F and M wait for A, and are given up on with it: neither is asked.
    expect(keysOf(mock.requests).sort()).toEqual([LAST_VALIDATED, SUPPLY].sort());
    expect(alerts(html)).toBe(2);
    expect(text).toContain("Couldn’t load XAH burned per day.");
    expect(text).toContain("Couldn’t load XAH minted per day.");
    expect(text).not.toContain("older than the newest ledger");
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Total supply", "Minted, last 90 days", "Burned", "Escrowed", "Circulating supply", "Account reserves"]);
    expect(tiles(html).find((tile) => tile.label === "Total supply")?.value).not.toBe("—");
    expect(tiles(html).find((tile) => tile.label === "Minted, last 90 days")?.value).toBe("—");
    expect(tookTooLong(logged).sort()).toEqual(["the supply page's burned could not be loaded", "the supply page's minted could not be loaded"]);
  }, 15_000);

  it("S never answering does not race: the answer is the outage, at the data API client's own limit and not at 4.5 s", async () => {
    cold();
    mock = mockUpstream("xrpl", { [SUPPLY]: never });
    const started = performance.now();
    const { response, text } = await render("/xrpl/supply");
    const took = performance.now() - started;

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(text).not.toContain("took too long");
    // The client's own 5 s (`DATA_API_TIMEOUT_MS`, and it does not retry): a lower bound only. A page that raced S would have answered at 4.5 s.
    expect(took).toBeGreaterThanOrEqual(4_900);
    expect(statusesOf(mock, SUPPLY)).toEqual([0]);
    expect(await isStored("/xrpl/supply")).toBe(false);
  }, 15_000);
});

describe("the URL (spec 1)", () => {
  it("sends any query string to /xrpl/supply, short, with no call", async () => {
    mock = mockUpstream("xrpl");
    for (const from of ["/xrpl/supply?x=1", "/xrpl/supply?period=1y&marker=A"]) {
      const response = await get(from);
      await response.text();
      expect(response.status, from).toBe(302);
      expect(response.headers.get("Location"), from).toBe("/xrpl/supply");
      expect(await storedAs(from), from).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("tidies the .data URL the same way: a redirect for React Router to follow, class short, with no call", async () => {
    mock = mockUpstream("xrpl");
    const path = "/xrpl/supply.data?_routes=routes%2Fnet.supply&x=1";
    const tidied = await get(path);
    const body = await tidied.text();
    expect(tidied.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain("/xrpl/supply");
    expect(mock.requests).toEqual([]);
    // The loader's own answer to that request names the class (the Cache API keeps no 202: amm-list.spec.ts says why).
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const own = (await loader({
      request: new Request(`https://explorer.test${path}`),
      url: new URL(`https://explorer.test${path.replace(".data", "")}`),
      params: { net: "xrpl" },
      context: createLoadContext(env as unknown as Env, ctx),
    } as never)) as Response;
    expect(own.status).toBe(302);
    expect(own.headers.get("Location")).toBe("/xrpl/supply");
    expect(own.headers.get("X-Cache-Class")).toBe("short");
  });
});

// ---- The class, the calls and the page --------------------------------------------------------------------------------------------------------------------------------------------

describe("the page", () => {
  it("is slow with a TTL of 300, the page and its .data", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response } = await render("/xrpl/supply");
    expect(response.status).toBe(200);
    expect(await storedAs("/xrpl/supply")).toEqual(SLOW);

    const dataPath = "/xrpl/supply.data?_routes=routes%2Fnet.supply";
    const data = await get(dataPath);
    const body = await data.text();
    expect(data.status).toBe(200);
    expect(data.headers.get("Content-Type")).toContain("text/x-script");
    expect(body).not.toContain("SingleFetchRedirect");
    expect(body).toContain("Where the 100 billion XRP are");
    expect(await storedAs(dataPath)).toEqual(SLOW);
    // The browser never gets the API's answer: the strings are the view builder's, and no host or key is in them.
    expect(body).not.toContain("computed_at");
    expect(body).not.toContain("data.example.invalid");
  });

  it("asks exactly S, A and F on XRPL, F under the network page's 90-day key", async () => {
    cold();
    const kept = storedEntries();
    mock = mockUpstream("xrpl");
    const { response, html, text } = await render("/xrpl/supply");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(keysOf(mock.requests).sort()).toEqual([SUPPLY, LAST_VALIDATED, FEES].sort());
    expect(mock.requests.every((request) => request.status === 200)).toBe(true);
    // S and F are kept 300 s, F under the key the network page's 90 days are (the same entry serves both pages), A 2 s under the home page's.
    expect(await keptFor(kept, SUPPLY_ENTRY)).toBe("public, max-age=300");
    expect(await keptFor(kept, FEES_ENTRY)).toBe("public, max-age=300");
    expect(await keptFor(kept, LAST_VALIDATED_ENTRY)).toBe("public, max-age=2");

    // The page: the snapshot of the recorded ledger, the six tiles, the burned card with its 90 days, and no minted card.
    expect(text).toContain("Snapshot at ledger #107,720,688 · Oct 17, 2026, 16:11 UTC · updated hourly");
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Total supply", "Burned", "Escrowed", "Circulating supply", "In AMM pools", "Account reserves"]);
    expect(alerts(html)).toBe(0);
    expect(text).toContain("XRP burned per day");
    expect(text).not.toContain("minted per day");
    expect(html).toContain('<link rel="canonical" href="https://explorer.test/xrpl/supply"/>');
  });

  it("asks M only where S has minted", async () => {
    cold();
    mock = mockUpstream("xahau");
    const { response, html, text } = await render("/xahau/supply");

    expect(response.status).toBe(200);
    // Xahau's snapshot has `minted`: the four calls, the days under the same window as the fees.
    expect(keysOf(mock.requests).sort()).toEqual([SUPPLY, LAST_VALIDATED, FEES, MINTED].sort());
    expect(tiles(html).map((tile) => tile.label)).toEqual(["Total supply", "Minted, last 90 days", "Burned", "Escrowed", "Circulating supply", "Account reserves"]);
    expect(text).toContain("XAH minted per day, by source");
    expect(text).toContain("Since ledger #1: 49,425,551.616207 XAH minted: 41,203,318.512207 as rewards, 8,102,233.104 by Import, 120,000 by GenesisMint.");
    expect(alerts(html)).toBe(0);
    mock.restore();

    // XRPL's has none, and never asks.
    mock = mockUpstream("xrpl");
    await render("/xrpl/supply");
    expect(keysOf(mock.requests).some((key) => key.includes("supply/minted"))).toBe(false);
  });

  it("makes no names call and no node call", async () => {
    cold();
    mock = mockUpstream("xahau");
    await render("/xahau/supply");
    expect(namesCalls(mock)).toEqual([]);
    // Every request the page made is a data API GET of the four above: no node command (`node account_info …`), and nothing else.
    expect(mock.requests.map((request) => request.key).filter((key) => !key.startsWith("GET /v2/network/") && key !== LAST_VALIDATED)).toEqual([]);
  });

  it("draws a snapshot without reserves: the tile is a dash that says so, the bar's sentence leaves them out, and the page is whole", async () => {
    cold();
    const without = supplySample("xrpl");
    delete without.reserves;
    mock = mockUpstream("xrpl", { [SUPPLY]: without });
    const { response, html, text } = await render("/xrpl/supply");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=300");
    const reserves = tiles(html).find((tile) => tile.label === "Account reserves");
    expect(reserves?.value).toBe("—");
    expect(text).toContain("Not known at this ledger.");
    expect(text).toContain("Part of circulating: 46.22M XRP in AMM pools (0.071% of circulating)");
    expect(text).not.toContain("held as account reserves");
    expect(alerts(html)).toBe(0);
  });

  it("the page without JavaScript has the menu: its summary and four links", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html } = await render("/xrpl/supply");

    expect(response.status).toBe(200);
    // The server's HTML: a closed `<details>` whose summary is the section and whose panel holds the four links, so that it opens by itself, before any script and without one.
    const menu = /<details class="menu" data-menu="network">([\s\S]*?)<\/details>/.exec(html)?.[1];
    expect(menu, "the Network menu").toBeDefined();
    expect(menu).toMatch(/^<summary class="nav-item menu__summary is-current" aria-current="true">Network<svg [^>]*aria-hidden="true"/);
    expect(anchors(menu!).map((a) => [a.text, /href="([^"]*)"/.exec(a.attrs)![1], /aria-current="([^"]*)"/.exec(a.attrs)?.[1]])).toEqual([
      ["Overview", "/xrpl/network", undefined],
      ["Validators", "/xrpl/validators", undefined],
      ["Amendments", "/xrpl/amendments", undefined],
      // The page names its own item: "page" on its own path.
      ["Supply", "/xrpl/supply", "page"],
    ]);
    expect(html).not.toMatch(/<details[^>]* open/);
    // The Network item of the header is no link any more (the breadcrumb's is).
    expect(anchors(html).filter((a) => /nav-item/.test(a.attrs)).map((a) => a.text)).not.toContain("Network");
  });
});
