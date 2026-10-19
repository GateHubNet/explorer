import { afterEach, describe, expect, it, vi } from "vitest";

import { USD_ISSUER } from "../../app/domain/network-params";
import { CACHE_CLASSES, HOME_CALL_TTL_SECONDS, PERIOD_CALL_TTL_SECONDS } from "../../app/server/cache-class";
import xahauFees from "../fixtures/http/xahau/data-api/network/fees@descending=true&limit=8.json";
import xahauSecondLedger from "../fixtures/http/xahau/data-api/ledgers/26541060.json";
import { elementText, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The calls the network page makes (spec 1.4) on the real Worker, against the recorded `last_validated` of each network (the index day is
// 2026-10-17): which paths with which query strings for each view, and for how long each is kept. This is also the proof that every call the real
// loader makes finds its fixture: a call without a file is the API's "Cannot GET" 404, which is an outage, so a default view of either
// network, any period and either display that asked for a file that is not there would be a degraded page here, and the request below would
// be answered `absent`.
//
// A file of its own, because what these tests count is *not yet in the cache*: the Worker keeps what the data API said, and a test that
// renders a view finds an earlier one's answers in the Cache API (`last_validated`, the fees list and `fee_stats` for 2 s, the validations for
// 5 s, the calls over a period for 300 s). A spec file's Cache API is its own. The tests run in the order they are written in, and say what they
// leave behind.

const { get, page } = pageClient("198.51.105");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- The calls, as the spec writes them (1.4, 1.5) ---------------------------------------------------------------------------------------

const XRPL_HASH = "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092";
const XAHAU_HASH = "EFA9CD5F98635E5E505EF63AECEF1576D324AF95BED7D3C3897B2BB20203E0B5";

const LAST_VALIDATED = "GET /v2/last_validated";
const FEES_LIST = "GET /v2/network/fees?descending=true&limit=8";
const FEE_STATS = "GET /v2/network/fee_stats?descending=true&limit=1&start=2026-10-17";
const validations = (hash: string) => `GET /v2/ledgers/${hash}/validations?limit=1000`;

type Period = "7d" | "30d" | "90d" | "1y";
/** `start` is W₀ and `previous` P₀, for the index day 2026-10-17 (spec 1.5). */
const WINDOWS = {
  "7d": { unit: "day", start: "2026-10-11", previous: "2026-10-03" },
  "30d": { unit: "day", start: "2026-09-18", previous: "2026-08-18" },
  "90d": { unit: "day", start: "2026-07-20", previous: "2026-04-20" },
  "1y": { unit: "week", start: "2025-10-20", previous: "2024-10-14" },
} as const satisfies Record<Period, { unit: "day" | "week"; start: string; previous: string }>;

const USD = `&exchange_currency=USD&exchange_issuer=${USD_ISSUER}`;

/** The calls over a period (#6 to #10) for a view; the volumes carry the display currency in `usd`. The query strings are in the order of the mock's keys. */
function periodCalls(period: Period, { usd = false, amm = true }: { usd?: boolean; amm?: boolean } = {}): { shared: string[]; own: string[] } {
  const { unit, start, previous } = WINDOWS[period];
  const currency = usd ? USD : "";
  const volume = (route: string, from: string) => `GET /v2/network/${route}?end=2026-10-17${currency}&interval=${unit}&limit=1000&start=${from}`;
  return {
    // What the native and the USD view of a period both ask for (the USD view finds the native one's answers, kept 300 s).
    shared: [
      `GET /v2/stats/type?end=2026-10-17&interval=${unit}&limit=1000&start=${start}`,
      `GET /v2/stats/metric?end=2026-10-17&interval=${unit}&limit=1000&metrics=accounts_created,ledger_count,transaction_count&start=${previous}`,
      `GET /v2/network/fees?end=2026-10-17&interval=day&limit=1000&start=${start}`,
    ],
    own: [volume("payment_volume", previous), volume("exchange_volume", start), ...(amm ? [volume("amm_volume", start)] : [])],
  };
}

const keysOf = (requests: UpstreamMock["requests"]) => requests.map((request) => request.key);
/** The calls over a period among some requests: the ones whose query has an `interval`. */
const overPeriods = (keys: string[]) => keys.filter((key) => key.includes("interval="));

// ---- XRPL ------------------------------------------------------------------------------------------------------------------------------

describe("the first render of /xrpl/network", () => {
  it("makes exactly the calls of #1, #2, #4, #5 and #6 to #11, with the recorded query strings, and no #3", async () => {
    mock = mockUpstream("xrpl");
    const puts: Array<string | null> = [];
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.push((response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });

    const { html } = await page("/xrpl/network");

    const { shared, own } = periodCalls("30d");
    const expected = [LAST_VALIDATED, FEES_LIST, validations(XRPL_HASH), FEE_STATS, ...shared, ...own];
    // No ledger by index (#3): `last_validated` is the newest ledger of the fees list, so its hash is the one to ask the validations of.
    expect(keysOf(mock.requests).sort()).toEqual([...expected].sort());
    expect(keysOf(mock.requests).some((key) => /^GET \/v2\/ledgers\/\d+$/.test(key))).toBe(false);
    // The node is not called: the open ledger comes from the data API's snapshots (`fee_stats`).
    expect(mock.requests.every((request) => request.kind === "data-api" && request.net === "xrpl")).toBe(true);
    // Every one of them found its file: the page has all its cards.
    expect(mock.requests.map((request) => request.source)).toEqual(Array(expected.length).fill("fixture"));
    const text = textOf(html);
    for (const failure of ["Couldn’t load", "couldn’t be loaded"]) expect(text).not.toContain(failure);

    // What each is kept for, in the Cache API: #1, #2 and #5 for HOME_CALL_TTL_SECONDS, #4 for its class (5 s), #6 to #11 for 300 s, the page for a day.
    await vi.waitFor(() => expect(puts.length).toBeGreaterThanOrEqual(expected.length + 1), { timeout: 10_000 });
    const counted = (value: string) => puts.filter((control) => control === value).length;
    expect([HOME_CALL_TTL_SECONDS, PERIOD_CALL_TTL_SECONDS, CACHE_CLASSES.live.edgeTtl]).toEqual([2, 300, 5]);
    expect(counted(`public, max-age=${HOME_CALL_TTL_SECONDS}`)).toBe(3);
    expect(counted(`public, max-age=${CACHE_CLASSES.live.edgeTtl}`)).toBe(1);
    expect(counted(`public, max-age=${PERIOD_CALL_TTL_SECONDS}`)).toBe(6);
    expect(counted("public, max-age=86400")).toBe(1);
  });

  it("is followed by a home page that finds #1 and #2 where the network page kept them, and asks for neither", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl");

    const asked = keysOf(mock.requests);
    expect(textOf(html)).toContain("Explore the XRP Ledger");
    // The home page was rendered, from its own lists...
    expect(asked).toContain("GET /v2/transactions?descending=true&limit=8");
    // ...and not from the keys that are the same call (`[kept 2 s]`): the network page's entries.
    expect(asked).not.toContain(LAST_VALIDATED);
    expect(asked).not.toContain(FEES_LIST);
  });
});

describe("the other views of /xrpl/network", () => {
  // The views are rendered in this order, after the default (30 days, XRP). A render asks the data API for the calls over a period that no
  // view before it asked for, because those are kept 300 s: a native view has all of #6 to #11 to itself, and a USD view only the volumes
  // (#9 to #11), as it shares the stats and the daily fees with the native view of the same period. #1, #2, #4 and #5 are kept for seconds,
  // so whether a render finds them is a matter of time and is not asserted.
  const VIEWS = [
    { path: "/xrpl/network?period=7d", period: "7d", usd: false },
    { path: "/xrpl/network?period=90d", period: "90d", usd: false },
    { path: "/xrpl/network?period=1y", period: "1y", usd: false },
    { path: "/xrpl/network?in=usd", period: "30d", usd: true },
    { path: "/xrpl/network?period=7d&in=usd", period: "7d", usd: true },
    { path: "/xrpl/network?period=90d&in=usd", period: "90d", usd: true },
    { path: "/xrpl/network?period=1y&in=usd", period: "1y", usd: true },
  ] as const;

  it.each(VIEWS)("asks for the calls of $path that no view before asked for", async ({ path, period, usd }) => {
    mock = mockUpstream("xrpl");
    const { html } = await page(path);

    const { shared, own } = periodCalls(period, { usd });
    expect(overPeriods(keysOf(mock.requests)).sort()).toEqual((usd ? own : [...shared, ...own]).sort());
    // The display currency is asked for in the volumes of a USD view and in nothing else.
    const withCurrency = keysOf(mock.requests).filter((key) => key.includes("exchange_currency="));
    expect(withCurrency.sort()).toEqual(usd ? [...own].sort() : []);
    // Each found its file.
    expect(mock.requests.filter((request) => request.source !== "fixture")).toEqual([]);
    expect(textOf(html)).not.toContain("Couldn’t load");
    expect(textOf(html)).not.toContain("couldn’t be loaded");
  });
});

// ---- Xahau -----------------------------------------------------------------------------------------------------------------------------

describe("/xahau/network", () => {
  it("makes the same calls without #11 and without a display currency", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/network");

    const { shared, own } = periodCalls("30d", { amm: false });
    const expected = [LAST_VALIDATED, FEES_LIST, validations(XAHAU_HASH), FEE_STATS, ...shared, ...own];
    expect(keysOf(mock.requests).sort()).toEqual([...expected].sort());
    expect(keysOf(mock.requests).some((key) => key.includes("amm_volume") || key.includes("exchange_currency"))).toBe(false);
    expect(mock.requests.every((request) => request.kind === "data-api" && request.net === "xahau")).toBe(true);
    expect(mock.requests.filter((request) => request.source !== "fixture")).toEqual([]);
    expect(textOf(html)).not.toContain("Couldn’t load");
    expect(textOf(html)).toContain("order book only, no AMM on Xahau");
  });

  it.each(["90d", "1y"] as const)("asks for the calls of ?period=%s that the default view did not, each answered by a file", async (period) => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/network?period=${period}`);

    const { shared, own } = periodCalls(period, { amm: false });
    expect(overPeriods(keysOf(mock.requests)).sort()).toEqual([...shared, ...own].sort());
    expect(mock.requests.filter((request) => request.source !== "fixture")).toEqual([]);
    expect(textOf(html)).not.toContain("Couldn’t load");
  });

  it("asks the ledger the validations are of when the fees list is behind last_validated: #3, then #4 of that ledger's hash", async () => {
    // The fees list without its newest row: its newest is now the ledger before, so that is the ledger the page shows and counts the validators of.
    const [, second, ...rest] = xahauFees.rows;
    const behind = { ...xahauFees, rows: [second, ...rest] };
    expect(second!.ledger_index).toBe(26541060);
    // `last_validated` and the fees list were kept for 2 s by the render above: this one must find the override, so it waits them out.
    await sleep(2_100);
    mock = mockUpstream("xahau", { "GET /v2/network/fees?descending=true&limit=8": behind });

    const { html } = await page("/xahau/network?period=7d");

    const asked = keysOf(mock.requests);
    const ledger = asked.indexOf("GET /v2/ledgers/26541060");
    const counted = asked.indexOf(validations(xahauSecondLedger.ledger.ledger_hash));
    expect(ledger).toBeGreaterThanOrEqual(0);
    expect(counted).toBeGreaterThan(ledger);
    // The newest ledger's own hash (`last_validated`'s) is not the one asked about.
    expect(asked).not.toContain(validations(XAHAU_HASH));
    expect(asked.filter((key) => key.startsWith("GET /v2/ledgers/"))).toHaveLength(2);
    expect(mock.unusedOverrides()).toEqual([]);
    // Everything else found its file, the 7 days of Xahau among it.
    expect(mock.requests.filter((request) => request.source !== "fixture").map((request) => request.key)).toEqual([FEES_LIST]);

    // The page says which ledger it counted.
    expect(elementText(html, "network__signed")).toMatch(/validators signed ledger #26,541,060$/);
    expect(textOf(html)).not.toContain("Couldn’t load");
  });
});
