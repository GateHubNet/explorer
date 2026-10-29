import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import xahauLastValidated from "../fixtures/http/xahau/data-api/last_validated.json";
import { decodeLoaderData } from "../support/loader-data";
import { namesCalls, namesStatuses, viewedAmong, watchNamesLog, withoutNames } from "../support/names";
import { pageClient } from "../support/pages";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// The names of the market pair page that follows the chain, on the real Worker (display names spec 3.4): the beat of the open page asks the route's `.data` URL, and a beat whose names
// call failed answers the names part `failed` (the page in the browser keeps the names it shows: the route's merge, app/ui/pages/pair-beat.test.ts and app/ui/routes-wiring.test.tsx),
// asks for the failure hold, and is not stored. A herd of visitors makes the call once, for the render they share.
//
// A file of its own, as home-live-names.spec.ts is (what these tests need is *not yet in the cache*, and a spec file's Cache API is its own), each test a pair of its own so that the
// answer of a names call that worked, which the Worker keeps a minute, and a failure, which it holds 5 s, are no other test's. Only `Date` is faked (the failure hold reads nothing else),
// and it is moved past the longest hold after each test.

const { get, stored, storedAs } = pageClient("198.51.119");

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
  vi.setSystemTime(Date.now() + 31_000);
  expect(unused ?? []).toEqual([]);
});

afterAll(() => {
  vi.useRealTimers();
});

const ROUTE = "routes/net.markets.$base.$counter";
const ROUTES = "_routes=routes%2Fnet.markets.%24base.%24counter";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const EVR_ISSUER = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
const unavailable = { "GET /v2/account_names": dataApiError(503, "unavailable") };

/** The route's `.data` URL of a view, as the open page asks for it (`view` is the query: each view is a page of its own in the edge cache). */
const beat = (pair: string, view: string) => `${pair}.data?${view}&${ROUTES}`;

const namesPartOf = (body: string) => (decodeLoaderData(body) as Record<string, { data: { names: { state: string; map: Record<string, unknown> } } }>)[ROUTE]!.data.names;

describe("a beat whose names call fails", () => {
  const LIONS = `/xrpl/markets/LIONS.${LIONS_ISSUER}/XRP`;
  const RLUSD = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;

  it("answers the names part failed, with the rest of the page whole, and does not store the answer", async () => {
    const logged = watchNamesLog();
    mock = mockUpstream("xrpl", unavailable);
    const path = beat(LIONS, "interval=15m");
    const response = await get(path);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(namesPartOf(body)).toEqual({ state: "failed", map: {} });
    // The rest of the answer is the beat's: the anchor and the pair are there.
    expect(body).toContain("107721455");
    expect(body).toContain("LIONS/XRP");
    // Degraded: served and not stored, so that the next beat asks again.
    expect(await stored(path)).toBeUndefined();
    expect(namesStatuses(mock)).toEqual([503]);
    expect(logged()).toBe(1);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("asks for the failure hold: the next beat for the same accounts does not make the call again until the hold is over, then the names arrive, and that answer is stored", async () => {
    // The first beat fails the call (this test's own failure) ...
    watchNamesLog();
    mock = mockUpstream("xrpl", unavailable);
    const first = await get(beat(RLUSD, "interval=15m"));
    expect(namesPartOf(await first.text()).state).toBe("failed");
    expect(namesStatuses(mock)).toEqual([503]);

    // ... the second, a second later (another view, so another page of the edge cache, with the same accounts): the held failure answers, and the data API is not asked.
    vi.setSystemTime(Date.now() + 1_000);
    const second = await get(beat(RLUSD, "interval=4h"));
    expect(namesPartOf(await second.text()).state).toBe("failed");
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await stored(beat(RLUSD, "interval=4h"))).toBeUndefined();
    mock.restore();

    // Past the hold, with the data API answering: the part is ok, with the names of the accounts the fixtures give something to show, and the answer is stored.
    vi.setSystemTime(Date.now() + 31_000);
    mock = mockUpstream("xrpl");
    const third = await get(beat(RLUSD, "interval=1d"));
    const part = namesPartOf(await third.text());
    expect(part.state).toBe("ok");
    expect(namesCalls(mock)).toHaveLength(1);
    expect(Object.keys(part.map).sort()).toEqual((await viewedAmong("xrpl", namesCalls(mock)[0]!)).sort());
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
    expect(await storedAs(beat(RLUSD, "interval=1d"))).toEqual({ cls: "live-home", ttl: 1 });
  });
});

describe("many visitors at the same moment", () => {
  it("make the names call once, for the render they share", async () => {
    const path = `/xahau/markets/EVR.${EVR_ISSUER}/XAH`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The anchor is held: the render waits for it, and so do the visitors that come while it does.
    mock = mockUpstream("xahau", {
      "GET /v2/last_validated": async () => {
        await gate;
        return new Response(JSON.stringify(xahauLastValidated), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const visitors = Array.from({ length: 6 }, () => get(path));

    await vi.waitFor(() => expect(mock!.requests.filter((request) => request.key === "GET /v2/last_validated")).toHaveLength(1), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    const responses = await Promise.all(visitors);
    await Promise.all(responses.map((response) => response.text()));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(namesCalls(mock)).toHaveLength(1);
    expect(namesStatuses(mock)).toEqual([200]);
    // The other calls are the render's, each once (Xahau has no pool).
    const calls = withoutNames(mock.requests).map((request) => request.key);
    expect(new Set(calls).size).toBe(calls.length);
  });
});
