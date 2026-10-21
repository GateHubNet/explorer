import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { cold } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";
import { pageClient } from "../support/pages";

// The failure hold on the real Worker (spec 1.7, 6.8): a polled page's failing upstream call is held in memory for 5 s (a 429, for its
// Retry-After), so that the open tabs' next beats do not all reach the upstream; a thing that is not there is never held. `statusesOf` is
// what tells the held call from the one that went out: a held call does not reach the mock.
//
// A file of its own, because the hold is per Worker instance (here: per isolate), and a key held by one test must not be the next test's.
// `Date` is the one clock the hold reads, so it alone is faked (the Cache API and the streams need the real timers), and it is moved 31 s on
// after each test, past the longest hold: no test meets an earlier one's. The Cache API keeps what a test's calls answered for 2 s of the
// real clock, whatever `Date` says, so a test that fails one call makes the other two fail as well (`down`): an answer one of them kept would
// stand in for the next test's failure. The network page's cases are at the end: each fails a call of a view of its own (the calls over a
// period are kept 300 s, and every view of a network shares `last_validated`, so the views are told apart by their period).

const { get } = pageClient("198.51.103");

let mock: UpstreamMock | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  vi.setSystemTime(Date.now() + 31_000);
});

afterAll(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

const LAST_VALIDATED = "GET /v2/last_validated";
const FEES = "GET /v2/network/fees?descending=true&limit=8";
const TRANSACTIONS = "GET /v2/transactions?descending=true&limit=8";

/** The XRPL home page's three lists all failing, `how` saying how the one under test fails: nothing of the page is kept for the next test. */
function down(how: Overrides): Overrides {
  const unavailable = () => dataApiError(503, "unavailable");
  return { [LAST_VALIDATED]: unavailable(), [FEES]: unavailable(), [TRANSACTIONS]: unavailable(), ...how };
}

describe("the home page's calls", () => {
  it("holds a failing last_validated: two renders a second apart both answer 503 and make one call; 6 s on, the next calls again", async () => {
    mock = mockUpstream("xrpl", down({}));

    const first = await get("/xrpl?hold=last-1");
    advance(1_000);
    const second = await get("/xrpl?hold=last-2");

    expect([first.status, second.status]).toEqual([503, 503]);
    expect(first.headers.get("Retry-After")).toBeTruthy();
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);

    advance(5_000);
    const third = await get("/xrpl?hold=last-3");
    expect(third.status).toBe(503);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503, 503]);
  });

  it("holds a rate-limited fees list for its Retry-After, 12 s, not for 5", async () => {
    mock = mockUpstream("xrpl", down({ [FEES]: dataApiError(429, "Rate limit exceeded", { "Retry-After": "12" }) }));

    expect((await get("/xrpl?hold=fees-1")).status).toBe(503);
    advance(11_000);
    expect((await get("/xrpl?hold=fees-2")).status).toBe(503);
    expect(statusesOf(mock, FEES)).toEqual([429]);

    advance(2_000);
    expect((await get("/xrpl?hold=fees-3")).status).toBe(503);
    expect(statusesOf(mock, FEES)).toEqual([429, 429]);
  });

  it("holds a failing transactions list", async () => {
    mock = mockUpstream("xrpl", down({ [TRANSACTIONS]: dataApiError(500, "unable to retrieve transactions") }));

    expect((await get("/xrpl?hold=txs-1")).status).toBe(503);
    advance(1_000);
    expect((await get("/xrpl?hold=txs-2")).status).toBe(503);
    expect(statusesOf(mock, TRANSACTIONS)).toEqual([500]);

    advance(5_000);
    expect((await get("/xrpl?hold=txs-3")).status).toBe(503);
    expect(statusesOf(mock, TRANSACTIONS)).toEqual([500, 500]);
  });

  it("holds the failing ledger it reads the header of", async () => {
    // Xahau, and the first test to read this ledger: a ledger that was read is kept for a year, and the API is not asked again.
    const ledger = "GET /v2/ledgers/26596843";
    mock = mockUpstream("xahau", { [ledger]: dataApiError(503, "unavailable") });

    expect((await get("/xahau?hold=ledger-1")).status).toBe(503);
    advance(1_000);
    expect((await get("/xahau?hold=ledger-2")).status).toBe(503);
    expect(statusesOf(mock, ledger)).toEqual([503]);

    advance(5_000);
    expect((await get("/xahau?hold=ledger-3")).status).toBe(503);
    expect(statusesOf(mock, ledger)).toEqual([503, 503]);
  });

  it("never holds a ledger the API says is not there: every render asks again", async () => {
    const ledger = "GET /v2/ledgers/26596843";
    mock = mockUpstream("xahau", { [ledger]: null });

    expect((await get("/xahau?hold=gone-1")).status).toBe(503);
    expect((await get("/xahau?hold=gone-2")).status).toBe(503);

    expect(statusesOf(mock, ledger)).toEqual([404, 404]);
  });
});

// ---- The network page --------------------------------------------------------------------------------------------------------------------

const TYPES_7D = "GET /v2/stats/type?end=2026-10-17&interval=day&limit=1000&start=2026-10-11";
const TYPES_90D = "GET /v2/stats/type?end=2026-10-17&interval=day&limit=1000&start=2026-07-20";

/** The page at `path`, its body read to the end: the status, and the render is over. */
async function statusOf(path: string, headers: Record<string, string> = {}): Promise<number> {
  const response = await get(path, headers);
  await response.text();
  return response.status;
}

describe("the network page's calls", () => {
  it("holds a failing stats/type: two renders a second apart make one call, and the one 5.001 s after the failure calls again", async () => {
    mock = mockUpstream("xrpl", { [TYPES_7D]: dataApiError(503, "unavailable") });
    const path = "/xrpl/network?period=7d";

    // A card that failed is a page that is served and not stored, so each render is a render.
    expect(await statusOf(path)).toBe(200);
    advance(1_000);
    expect(await statusOf(path)).toBe(200);
    expect(statusesOf(mock, TYPES_7D)).toEqual([503]);

    // Held until 5 s after the failure, not a moment longer.
    advance(3_999);
    expect(await statusOf(path)).toBe(200);
    expect(statusesOf(mock, TYPES_7D)).toEqual([503]);
    advance(2);
    expect(await statusOf(path)).toBe(200);
    expect(statusesOf(mock, TYPES_7D)).toEqual([503, 503]);
  });

  it("holds a rate-limited call for its Retry-After, 12 s, not for 5", async () => {
    mock = mockUpstream("xrpl", { [TYPES_90D]: dataApiError(429, "Rate limit exceeded", { "Retry-After": "12" }) });
    const path = "/xrpl/network?period=90d";

    expect(await statusOf(path)).toBe(200);
    advance(11_000);
    expect(await statusOf(path)).toBe(200);
    expect(statusesOf(mock, TYPES_90D)).toEqual([429]);

    advance(2_000);
    expect(await statusOf(path)).toBe(200);
    expect(statusesOf(mock, TYPES_90D)).toEqual([429, 429]);
  });

  it("shares a held last_validated with the home page, which is one key: a /xahau render that failed holds it for /xahau/network", async () => {
    mock = mockUpstream("xahau", { [LAST_VALIDATED]: dataApiError(503, "unavailable") });
    // `last_validated` of Xahau was kept 2 s by the tests above: this one must reach the mock.
    cold();

    expect(await statusOf("/xahau?hold=shared-1")).toBe(503);
    advance(1_000);
    const network = await get("/xahau/network");
    await network.text();

    expect(network.status).toBe(503);
    expect(Number(network.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503]);

    // Once the hold is over the page asks again.
    advance(5_000);
    expect(await statusOf("/xahau/network")).toBe(503);
    expect(statusesOf(mock, LAST_VALIDATED)).toEqual([503, 503]);
  });
});
