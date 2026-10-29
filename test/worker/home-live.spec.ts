import { encodeAccountID } from "ripple-address-codec";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CACHE_CLASSES, HOME_CALL_TTL_SECONDS } from "../../app/server/cache-class";
import xahauLastValidated from "../fixtures/http/xahau/data-api/last_validated.json";
import xrplTransactions from "../fixtures/http/xrpl/data-api/transactions@descending=true&limit=8.json";
import { namesCalls, namesStatuses, viewedAmong } from "../support/names";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";
import { decodeLoaderData, pageClient, textOf } from "../support/pages";

// The home page that follows the chain, on the real Worker (README, "Live updates"): what it asks the data API for and for how long, what the
// open page's own `.data` URL is stored as, the build it says, and what happens when many visitors ask at the same moment.
//
// A file of its own, because what these tests need is *not yet in the cache*: the Worker keeps what the data API said for 2 s, and a test
// that overrides an answer (a `last_validated` that is ahead, a gate that holds the first request) must be the first to ask for it. A spec
// file's Cache API is its own. Each network is asked for its home page by one test that matters for this: the first test on Xahau holds the
// data API's first answer, and the one on XRPL overrides `last_validated`.

const { get, stored, storedAs } = pageClient("198.51.102");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
});

/** What the Worker puts in the Cache API for the next `ms`: the `Cache-Control` of each entry, in order. */
function watchPuts(): Array<string | null> {
  const seen: Array<string | null> = [];
  const put = caches.default.put.bind(caches.default);
  vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
    seen.push((response as Response).headers.get("Cache-Control"));
    return put(request, response);
  });
  return seen;
}

describe("many visitors at the same moment", () => {
  it("render the page once: the first renders, the others wait and are given its copy; and what the render stored it stored for the right time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The first call the page makes is held; the others of the same page must not make theirs.
    mock = mockUpstream("xahau", {
      "xahau GET /v2/last_validated": async () => {
        await gate;
        return new Response(JSON.stringify(xahauLastValidated), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const puts = watchPuts();
    const visitors = Array.from({ length: 6 }, () => get("/xahau?case=herd"));

    // The first render has reached the data API; give the others the moment they need to ask the edge for the same page.
    await vi.waitFor(() => expect(mock!.requests.filter((request) => request.key === "GET /v2/last_validated")).toHaveLength(1), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    const responses = await Promise.all(visitors);
    const pages = await Promise.all(responses.map((response) => response.text()));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    // One data API call for the page, not six.
    expect(mock.requests.filter((request) => request.key === "GET /v2/last_validated")).toHaveLength(1);
    // One render (MISS); the others were given its copy (MISS-SHARED) or, if they came after it, the stored page (HIT).
    const labels = responses.map((response) => response.headers.get("X-Cache"));
    expect(labels.filter((label) => label === "MISS")).toHaveLength(1);
    expect(labels.filter((label) => label === "MISS-SHARED").length).toBeGreaterThanOrEqual(1);
    expect(labels.every((label) => label === "MISS" || label === "MISS-SHARED" || label === "HIT")).toBe(true);
    // The same page for everybody, and a whole one.
    expect(new Set(pages).size).toBe(1);
    expect(textOf(pages[0]!)).toContain("Explore Xahau");
    for (const response of responses) {
      expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
      expect(response.headers.has("X-Cache-Class")).toBe(false);
    }

    // What the one render stored: the home page's three calls for HOME_CALL_TTL_SECONDS (2 s), the newest ledger's header for good, and the
    // page itself (kept a day past its freshness, for the entry's stale-if-error).
    await vi.waitFor(() => expect(puts.length).toBeGreaterThanOrEqual(5), { timeout: 10_000 });
    const counted = (value: string) => puts.filter((control) => control === value).length;
    expect(HOME_CALL_TTL_SECONDS).toBe(2);
    expect(counted(`public, max-age=${HOME_CALL_TTL_SECONDS}`)).toBe(3);
    expect(counted(`public, max-age=${CACHE_CLASSES.immutable.edgeTtl}`)).toBe(1);
    expect(counted("public, max-age=86400")).toBe(1);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("the page the open browser asks for", () => {
  it("is the route's own `.data` URL, stored as live-home for 1 s, and says which build answered", async () => {
    mock = mockUpstream("xahau");
    const path = "/xahau.data?case=data&_routes=routes%2Fnet._index";
    const response = await get(path);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/x-script");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "live-home", ttl: 1 });
    // The Worker's BUILD_ID (pinned in vitest.config.ts) is in what the page gets, so that a page of an older build can tell.
    expect(text).toContain("test-build");
    // The newest ledger's data, and nothing of the layout's.
    expect(text).toContain("26596843");
    expect(text).not.toContain('"origin"');
  });
});

describe("when last_validated is ahead of the fees", () => {
  it("shows the newest ledger the fees list has, whole, instead of a tile of dashes for a beat", async () => {
    // last_validated names 107721456; the fees list (computed from the ledger table) has 107721455 as its newest row.
    mock = mockUpstream("xrpl", {
      "GET /v2/last_validated": {
        result: "success",
        ledger_index: "107721456",
        ledger_hash: "AA".repeat(32),
        parent_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
        close_time: "2026-10-17T17:01:16Z",
      },
    });
    const response = await get("/xrpl?case=ahead");
    const html = await response.text();
    const text = textOf(html);
    expect(response.status).toBe(200);

    expect(text).toMatch(/ledger #107,721,455 validated/);
    expect(text).toContain("#107,721,455");
    expect(text).not.toContain("107,721,456");
    // The tiles have their figures: the transactions in it, and its fees.
    expect(text).toMatch(/Transactions per ledger 107 average 78 over the last 8/);
    expect(text).toContain("0.012135 XRP");
    expect(text).not.toContain("not counted yet");
    // The ledger asked for is the one the page shows, and last_validated's own is not asked for.
    const asked = mock.requests.map((request) => request.key);
    expect(asked).toContain("GET /v2/ledgers/107721455");
    expect(asked).not.toContain("GET /v2/ledgers/107721456");
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

// The beat of the open page asks the home route's `.data` URL; a beat whose names call failed answers the names part `failed` (the page in the browser keeps the names it shows: the
// route's merge, app/ui/pages/home-beat.test.ts and app/ui/routes-wiring.test.tsx), asks for the failure hold, and is not stored. Last in the file, because it asks for the XRPL home
// (the "ahead" test above needs its ledger not yet read), and with an address of its own among the newest transactions: the Worker keeps the answer of a names call for a minute,
// and a failure can only be seen for a call nobody has made. Only `Date` is faked (the hold reads nothing else).
describe("a beat whose names call fails", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // The tests above read the newest transactions, which the Worker keeps for `HOME_CALL_TTL_SECONDS`: wait for them to go, so that this describe's own are read.
    await new Promise((resolve) => setTimeout(resolve, HOME_CALL_TTL_SECONDS * 1000 + 100));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  /** The newest transactions of the XRPL fixtures, but for the sender of the first: an address no other test has asked the names of, so that this page's names call is a key of its own. */
  const FRESH = encodeAccountID(Uint8Array.from({ length: 20 }, (_, i) => 0xa0 + i));
  const withFreshSender = (): Record<string, unknown> => {
    const copy = structuredClone(xrplTransactions) as { transactions: Array<{ tx: { Account: string } }> };
    copy.transactions[0]!.tx.Account = FRESH;
    return copy;
  };
  const TRANSACTIONS = "GET /v2/transactions?descending=true&limit=8";

  /** The names part of the home route's data in the body of a `.data` response. */
  const namesPartOf = (body: string) => (decodeLoaderData(body) as { "routes/net._index": { data: { names: { state: string; map: Record<string, unknown> } } } })["routes/net._index"].data.names;
  const beat = (n: number) => `/xrpl.data?beat=${n}&_routes=routes%2Fnet._index`;

  it("answers the names part failed, with the page otherwise whole, and does not store the answer", async () => {
    mock = mockUpstream("xrpl", { [TRANSACTIONS]: withFreshSender(), "GET /v2/account_names": dataApiError(503, "unavailable") });
    const response = await get(beat(1));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(namesPartOf(body)).toEqual({ state: "failed", map: {} });
    // The rest of the answer is the beat's: the newest ledger is there, and so is the fresh sender (an address, as the page draws it).
    expect(body).toContain("107721455");
    expect(body).toContain(FRESH);
    expect(namesCalls(mock).flat()).toContain(FRESH);
    // Degraded: served and not stored, so that the next beat asks again.
    expect(await stored(beat(1))).toBeUndefined();
    expect(namesStatuses(mock)).toEqual([503]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("asks for the failure hold: the next beat does not make the call again until the hold is over, then the names arrive, and that answer is stored", async () => {
    // The second beat, a second later (another URL, so another page of the edge cache): the held failure answers, the data API is not asked.
    mock = mockUpstream("xrpl", { [TRANSACTIONS]: withFreshSender(), "GET /v2/account_names": dataApiError(503, "unavailable") });
    vi.setSystemTime(Date.now() + 1_000);
    const second = await get(beat(2));
    expect(namesPartOf(await second.text()).state).toBe("failed");
    expect(namesCalls(mock)).toEqual([]);
    expect(await stored(beat(2))).toBeUndefined();
    mock.restore();

    // Past the hold, with the data API answering: the part is ok, with the names of the rows the fixtures give something to show, and the answer is stored.
    vi.setSystemTime(Date.now() + 31_000);
    mock = mockUpstream("xrpl", { [TRANSACTIONS]: withFreshSender() });
    const third = await get(beat(3));
    const part = namesPartOf(await third.text());
    expect(part.state).toBe("ok");
    expect(namesCalls(mock)).toHaveLength(1);
    const asked = namesCalls(mock)[0]!;
    expect(asked).toContain(FRESH);
    expect(Object.keys(part.map).sort()).toEqual((await viewedAmong("xrpl", asked)).sort());
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
    expect(await storedAs(beat(3))).toEqual({ cls: "live-home", ttl: 1 });
  });
});
