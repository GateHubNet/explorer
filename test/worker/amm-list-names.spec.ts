import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { AmmPool } from "../../app/server/api-types";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import { collectAddresses } from "../../app/server/names-collect";
import firstPageOfPools from "../fixtures/http/xrpl/data-api/amm/pools@limit=20.json";
import { decodeLoaderData } from "../support/loader-data";
import { inCalls, issuerTextOf, namedAmong, namesCalls, namesStatuses, watchNamesLog } from "../support/names";
import { pageClient, tableRows } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// The names of the issuers on the AMM pools list, `/{net}/amm` (display names spec 1 and 5), on the real Worker: one names call after the four, for the issuers of the rows of the table,
// sorted; each issuer verified or named by GateHub written by its name; no call for an address the table does not draw; none for an asset that does not parse; a failed call leaves the
// short addresses and the page unstored.
//
// A file of its own, as the names of the live pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute), each test
// a view of its own, and `cold` takes the subrequest entries away: no test needs another to have run, or not. The page does not poll, so no call asks for the failure hold.

const { get, stored } = pageClient("198.51.120");

// A first render of a page can take longer than the default 5 s when the machine is busy (the suite runs all the worker specs side by side).
vi.setConfig({ testTimeout: 20_000 });

let mock: UpstreamMock | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unavailable = () => dataApiError(503, "unavailable");

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

async function render(path: string) {
  const response = await get(path);
  return { response, html: await response.text() };
}

/** The names part of the list route's data, in the body of a `.data` response. */
const namesPartOf = (body: string) =>
  (decodeLoaderData(body) as { "routes/net.amm._index": { data: { names: { state: string; map: Record<string, unknown> } } } })["routes/net.amm._index"].data.names;

/** The pools of the recorded first page, as the data API wrote them. */
const POOLS_OF_PAGE = firstPageOfPools.pools as unknown as AmmPool[];
/** The issuers the table draws, row by row (the stored base's first), once each in the order met: what the loader asks the names of. */
const ISSUERS = collectAddresses(POOLS_OF_PAGE.flatMap((pool) => [pool.base_issuer, pool.counter_issuer]));
/** What the table does not draw as an account: the pool's own account, the slot's holder, the creator. */
const UNSHOWN = collectAddresses(POOLS_OF_PAGE.flatMap((pool) => [pool.amm_account, pool.auction_slot?.holder, pool.created_by])).filter((address) => !ISSUERS.includes(address));

/** The "Pool" cell of each row of the table: the pair, the short account and the issuers' words. */
const cells = (html: string) => tableRows(html, "Pools").slice(1).map((row) => row[0]!);

describe("the names call of the page", () => {
  it("is one, after the four, for the issuers of the rows sorted, and writes each issuer verified or named by GateHub by its name", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html } = await render("/xrpl/amm");

    expect(response.status).toBe(200);
    expect(namesCalls(mock)).toEqual(inCalls(ISSUERS));
    expect(namesStatuses(mock)).toEqual([200]);
    // After the four calls of the render: it is the last request.
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");

    const pools = cells(html);
    expect(pools).toHaveLength(POOLS_OF_PAGE.length);
    let named = 0;
    for (const [at, pool] of POOLS_OF_PAGE.entries()) {
      for (const issuer of [pool.base_issuer, pool.counter_issuer]) {
        if (issuer === undefined) continue;
        const text = await issuerTextOf("xrpl", issuer);
        expect(pools[at], `the row of ${pool.amm_account}`).toContain(text);
        if (text !== shortAddress(issuer)) {
          named += 1;
          expect(pools[at], `the row of ${pool.amm_account}`).not.toContain(shortAddress(issuer));
        }
      }
      // The pool's own account is the short address always.
      expect(pools[at]).toContain(shortAddress(pool.amm_account));
    }
    // The fixtures name some of these issuers, verified and GateHub's, so that the test sees both texts.
    expect(named).toBeGreaterThan(0);
    expect((await namedAmong("xrpl", ISSUERS)).length).toBeGreaterThan(0);
  });

  it("asks for no address that the table does not draw by name: not the pools, the slots' holders nor the creators; and carries the names in the page's data", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const body = await (await get("/xrpl/amm.data?_routes=routes%2Fnet.amm._index")).text();
    const asked = namesCalls(mock).flat();

    expect(UNSHOWN.length).toBeGreaterThan(0);
    for (const address of UNSHOWN) expect(asked, address).not.toContain(address);
    expect([...asked].sort()).toEqual([...ISSUERS].sort());
    const part = namesPartOf(body);
    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("is none for an asset that does not parse: no pools were asked for, so there is no issuer", async () => {
    cold();
    mock = mockUpstream("xrpl");
    await render("/xrpl/amm?asset=nope");
    expect(namesCalls(mock)).toEqual([]);
  });
});

describe("when the names call fails", () => {
  it("leaves the issuers as short addresses, serves the page and does not store it", async () => {
    cold();
    const logged = watchNamesLog();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    const path = "/xrpl/amm?asset=XRP";
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
    expect(await stored(path)).toBeUndefined();
    expect(namesStatuses(mock)).toEqual([503]);
    const pools = cells(html);
    expect(pools.length).toBeGreaterThan(0);
    // Every issuer the call asked for is its short address in the table, as before names.
    const asked = namesCalls(mock).flat();
    expect(asked.length).toBeGreaterThan(0);
    for (const issuer of asked) expect(pools.some((cell) => cell.includes(shortAddress(issuer))), issuer).toBe(true);
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    cold();
    watchNamesLog();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    const body = await (await get("/xrpl/amm.data?deleted=1&_routes=routes%2Fnet.amm._index")).text();
    expect(namesPartOf(body)).toEqual({ state: "failed", map: {} });
  });
});
