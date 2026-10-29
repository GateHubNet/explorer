import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { MarketRow } from "../../app/server/api-types";
import { collectAddresses } from "../../app/server/names-collect";
import xahauDay from "../fixtures/http/xahau/data-api/network/markets@limit=1000&period=day.json";
import xrplDay from "../fixtures/http/xrpl/data-api/network/markets@limit=1000&period=day.json";
import xrplWeek from "../fixtures/http/xrpl/data-api/network/markets@limit=1000&period=7day.json";
import { decodeLoaderData } from "../support/loader-data";
import { answerNamesAfterTheirEnd, inCalls, issuerTextAfterItsEnd, issuerTextOf, namesCalls, namesStatuses, watchNamesLog } from "../support/names";
import { pageClient, pairRows } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// The names of the issuers on the markets page, `/{net}/markets` (display names spec 1 and 5), on the real Worker: one names call after the markets call, for the issuers of the rows the
// page lists, sorted; the issuers written by their names; no call for a row the Quote filter leaves out; a failed call leaves the short addresses and the page unstored.
//
// A file of its own, and each test a view of its own (the page of a view is stored, and so is the answer of a names call for a minute): markets-page.spec.ts renders the default view in
// several tests, and which of them sees the names call would be the order the tests ran in. Here no test needs another to have run, or not. `cold` takes the subrequest entries away, so
// that every render reaches the mock whatever an earlier one kept.

const { get, stored } = pageClient("198.51.117");

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

const unavailable = () => dataApiError(503, "unavailable");

/** The page at `path`: its status, headers and HTML. */
async function render(path: string) {
  const response = await get(path);
  return { response, html: await response.text() };
}

/** The pairs of an answer as the data API wrote them. */
const ROWS = (answer: { markets: unknown[] }) => answer.markets as unknown as MarketRow[];
const issuersOfRows = (rows: readonly MarketRow[]) => collectAddresses(rows.flatMap((row) => [row.base_issuer, row.counter_issuer]));

/** The "Pair" cell of each row of the table: the pair, then its issuers' words. */
const pairCells = (html: string) => pairRows(html).slice(1).map((row) => row[1]!);

/** The names part of the markets route's data, in the body of a `.data` response. */
const namesPartOf = (body: string) =>
  (decodeLoaderData(body) as { "routes/net.markets": { data: { names: { state: string; map: Record<string, unknown> } } } })["routes/net.markets"].data.names;

describe("the names call of the page", () => {
  it("is one, after the markets call, for the issuers of the rows sorted, and the page writes each issuer by its name", async () => {
    cold();
    // The fixtures name none of the issuers of these pairs, so the data API names them all, after their last four characters (the issuers' words are the names').
    mock = mockUpstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { response, html } = await render("/xrpl/markets");

    expect(response.status).toBe(200);
    const rows = ROWS(xrplDay);
    const issuers = issuersOfRows(rows);
    expect(namesCalls(mock)).toEqual(inCalls(issuers));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");

    // Each row's issuers are written by their names, and the short address is nowhere beside them.
    const cells = pairCells(html);
    expect(cells).toHaveLength(rows.length);
    for (const [at, row] of rows.entries()) {
      for (const issuer of [row.base_issuer, row.counter_issuer]) {
        if (issuer === undefined) continue;
        expect(cells[at], `the row ${at}`).toContain(issuerTextAfterItsEnd(issuer));
        expect(cells[at], `the row ${at}`).not.toContain(shortAddress(issuer));
      }
    }
  });

  it("writes each issuer as the fixtures say when the data API answers what they hold: the short address of an unnamed one", async () => {
    cold();
    mock = mockUpstream("xahau");
    const { response, html } = await render("/xahau/markets");
    expect(response.status).toBe(200);

    const rows = ROWS(xahauDay);
    expect(namesCalls(mock)).toEqual(inCalls(issuersOfRows(rows)));
    const cells = pairCells(html);
    for (const [at, row] of rows.entries()) {
      for (const issuer of [row.base_issuer, row.counter_issuer]) if (issuer !== undefined) expect(cells[at]).toContain(await issuerTextOf("xahau", issuer));
    }
  });

  it("is for the issuers of the rows the Quote filter lists alone: not the issuers of a pair with no USD", async () => {
    cold();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { response, html } = await render("/xrpl/markets?quote=usd");
    expect(response.status).toBe(200);

    const rows = ROWS(xrplDay);
    const isUsd = (currency: string, issuer?: string) => issuer !== undefined && currency === "USD";
    const listed = rows.filter((row) => isUsd(row.base_currency, row.base_issuer) || isUsd(row.counter_currency, row.counter_issuer));
    const left = rows.filter((row) => !listed.includes(row));
    const wanted = issuersOfRows(listed);
    const unlisted = issuersOfRows(left).filter((issuer) => !wanted.includes(issuer));
    expect(listed.length).toBeGreaterThan(0);
    expect(unlisted.length, "the fixtures have issuers of pairs with no USD").toBeGreaterThan(0);

    const asked = namesCalls(mock).flat();
    expect([...asked].sort()).toEqual([...wanted].sort());
    for (const issuer of unlisted) expect(asked, issuer).not.toContain(issuer);
    expect(pairCells(html)).toHaveLength(listed.length);
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    cold();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const body = await (await get("/xrpl/markets.data?period=7d&_routes=routes%2Fnet.markets")).text();
    const part = namesPartOf(body);
    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });
});

describe("when the names call fails", () => {
  it("shows the short addresses, serves the page and does not store it", async () => {
    cold();
    const logged = watchNamesLog();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    const path = "/xrpl/markets?period=7d";
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await stored(path)).toBeUndefined();
    // (Every chunk of the call failed.)
    const calls = namesCalls(mock);
    expect(calls.length).toBeGreaterThan(0);
    expect(namesStatuses(mock)).toEqual(calls.map(() => 503));
    // The issuers of the first rows are their short addresses, as before names.
    const rows = ROWS(xrplWeek).slice(0, 20);
    const cells = pairCells(html);
    for (const [at, row] of rows.entries()) {
      for (const issuer of [row.base_issuer, row.counter_issuer]) if (issuer !== undefined) expect(cells[at]).toContain(shortAddress(issuer));
    }
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    cold();
    watchNamesLog();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    const body = await (await get("/xrpl/markets.data?period=7d&quote=eur&_routes=routes%2Fnet.markets")).text();
    expect(namesPartOf(body)).toEqual({ state: "failed", map: {} });
  });
});
