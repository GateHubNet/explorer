import { describe, expect, it, vi } from "vitest";

import { failingNames, namesCalls, namesPartOf, namesSpec, namesStatuses, viewedAmong, watchNamesLog } from "../support/names";
import { pageClient } from "../support/pages";

// The names of the home page that follows the chain, on the real Worker (display names spec 3.4): the beat of the open page asks the route's `.data` URL, and a beat whose names call
// failed answers the names part `failed` (the page in the browser keeps the names it shows: the route's merge, app/ui/pages/home-beat.test.ts and app/ui/routes-wiring.test.tsx), asks
// for the failure hold, and is not stored.
//
// A file of its own (home-live.spec.ts says why such a file is: what these tests need is *not yet in the cache*, and a spec file's Cache API is its own), and each test has a network
// of its own, so that no test needs another to have run, or not: the Worker keeps the answer of a names call that worked a minute, and a failure can only be seen for a call nobody
// has made. Only `Date` is faked (the failure hold reads nothing else), and it is moved past the longest hold after each test.

const { get, stored, storedAs } = pageClient("198.51.116");
// Not cold: the hold is the Worker's own, and each test has a network of its own.
const { upstream } = namesSpec({ advance: 31_000, cold: false });

const ROUTE = "routes/net._index";

const beat = (net: string, id: string) => `/${net}.data?beat=${id}&_routes=routes%2Fnet._index`;

describe("a beat whose names call fails", () => {
  it("answers the names part failed, with the rest of the page whole, and does not store the answer", async () => {
    watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const response = await get(beat("xrpl", "failed"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "failed", map: {} });
    // The rest of the answer is the beat's: the newest ledger is there.
    expect(body).toContain("107721455");
    // Degraded: served and not stored, so that the next beat asks again.
    expect(await stored(beat("xrpl", "failed"))).toBeUndefined();
    expect(namesStatuses(mock)).toEqual([503]);
  });

  it("asks for the failure hold: the next beat does not make the call again until the hold is over, then the names arrive, and that answer is stored", async () => {
    // The first beat fails the call (this test's own failure) ...
    watchNamesLog();
    const failing = upstream("xahau", failingNames());
    const first = await get(beat("xahau", "1"));
    expect(namesPartOf(await first.text(), ROUTE).state).toBe("failed");
    expect(namesStatuses(failing)).toEqual([503]);

    // ... the second, a second later (another URL, so another page of the edge cache): the held failure answers, and the data API is not asked.
    vi.setSystemTime(Date.now() + 1_000);
    const second = await get(beat("xahau", "2"));
    expect(namesPartOf(await second.text(), ROUTE).state).toBe("failed");
    expect(namesCalls(failing)).toHaveLength(1);
    expect(await stored(beat("xahau", "2"))).toBeUndefined();

    // Past the hold, with the data API answering: the part is ok, with the names of the rows the fixtures give something to show, and the answer is stored.
    vi.setSystemTime(Date.now() + 31_000);
    const mock = upstream("xahau");
    const third = await get(beat("xahau", "3"));
    const part = namesPartOf(await third.text(), ROUTE);
    expect(part.state).toBe("ok");
    expect(namesCalls(mock)).toHaveLength(1);
    expect(Object.keys(part.map).sort()).toEqual((await viewedAmong("xahau", namesCalls(mock)[0]!)).sort());
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
    expect(await storedAs(beat("xahau", "3"))).toEqual({ cls: "live-home", ttl: 1 });
  });
});
