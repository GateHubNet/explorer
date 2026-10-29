import { describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { MarketRow } from "../../app/server/api-types";
import type { MarketsPageData } from "../../app/server/markets-view";
import { collectAddresses } from "../../app/server/names-collect";
import xahauDay from "../fixtures/http/xahau/data-api/network/markets@limit=1000&period=day.json";
import xrplDay from "../fixtures/http/xrpl/data-api/network/markets@limit=1000&period=day.json";
import xrplWeek from "../fixtures/http/xrpl/data-api/network/markets@limit=1000&period=7day.json";
import {
  answerNamesAfterTheirEnd,
  failingNames,
  inCalls,
  issuerTextAfterItsEnd,
  issuerTextOf,
  namesCalls,
  namesSpec,
  namesStatuses,
  watchNamesLog,
} from "../support/names";
import { decodeLoaderData } from "../support/loader-data";
import { expectDegraded } from "../support/nft-pages";
import { pageClient, pairRows } from "../support/pages";

// The names of the issuers on the markets page, `/{net}/markets` (display names spec 1 and 5), on the real Worker: one names call after the markets call, for the issuers of the rows the
// page lists, sorted; the issuers written by their names; no call for a row the Quote filter leaves out; a failed call leaves the short addresses and the page unstored.
//
// A file of its own, and each test a view of its own (the page of a view is stored, and so is the answer of a names call for a minute): markets-page.spec.ts renders the default view in
// several tests, and which of them sees the names call would be the order the tests ran in. Here no test needs another to have run, or not: `namesSpec` takes the subrequest entries
// away, so that every render reaches the mock whatever an earlier one kept.

const { get, page } = pageClient("198.51.117");
const { upstream } = namesSpec({ advance: 301_000 });

const ROUTE = "routes/net.markets";

/** The pairs of an answer as the data API wrote them. */
const ROWS = (answer: { markets: unknown[] }) => answer.markets as unknown as MarketRow[];
const issuersOfRows = (rows: readonly MarketRow[]) => collectAddresses(rows.flatMap((row) => [row.base_issuer, row.counter_issuer]));

/** The markets route's data in the body of its `.data` response. */
const routeData = (body: string) => (decodeLoaderData(body) as Record<string, { data: MarketsPageData }>)[ROUTE]!.data;

/** The "Pair" cell of each row of the table: the pair, then its issuers' words. */
const pairCells = (html: string) => pairRows(html).slice(1).map((row) => row[1]!);

describe("the names call of the page", () => {
  it("is one, after the markets call, for the issuers of the rows sorted, and the page writes each issuer by its name", async () => {
    // The fixtures name none of the issuers of these pairs, so the data API names them all, after their last four characters (the issuers' words are the names').
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page("/xrpl/markets");

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
    const mock = upstream("xahau");
    const { html } = await page("/xahau/markets");

    const rows = ROWS(xahauDay);
    expect(namesCalls(mock)).toEqual(inCalls(issuersOfRows(rows)));
    const cells = pairCells(html);
    let named = 0;
    for (const [at, row] of rows.entries()) {
      for (const issuer of [row.base_issuer, row.counter_issuer]) {
        if (issuer === undefined) continue;
        const text = await issuerTextOf("xahau", issuer);
        expect(cells[at]).toContain(text);
        if (text !== shortAddress(issuer)) {
          named += 1;
          expect(cells[at]).not.toContain(shortAddress(issuer));
        }
      }
    }
    // The fixtures name some of these issuers, so that the test sees a name and a short address.
    expect(named).toBeGreaterThan(0);
  });

  it("is for the issuers of the rows the Quote filter lists alone: not the issuers of a pair with no USD", async () => {
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page("/xrpl/markets?quote=usd");

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

  // Decision 12: a labelled account has a warning mark wherever it is shown, an issuer's text too. Every issuer of the view is labelled scam here, and given no name: each keeps its
  // short address, in mono, with the label's icon and words after it. A view no other test asks for.
  it("marks a labelled issuer with the label's icon and words after its short address, in mono", async () => {
    upstream("xrpl", {
      "GET /v2/account_names": (request: Request) => {
        const asked = (new URL(request.url).searchParams.get("addresses") ?? "").split(",");
        const entries = asked.map((address) => ({ address, labels: { scam: { description: "Fictional." } } }));
        return Response.json({ result: "success", count: entries.length, account_names: entries });
      },
    });
    const { html } = await page("/xrpl/markets?period=30d");
    const cells = pairCells(html);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) if (/r\w{5}…\w{4}/.test(cell)) expect(cell).toMatch(/r\w{5}…\w{4} labelled scam by GateHub/);
    expect(cells.filter((cell) => cell.includes("labelled scam by GateHub")).length).toBeGreaterThan(0);
    expect(html).toMatch(/<span class="mono">r\w{5}…\w{4}<\/span> <span class="labelmark">/);
  });

  // The page draws no account by its name (no `NamesProvider`): its rows carry the issuers' words and marks, and the names map stays in the Worker.
  it("sends the browser no names map: the rows carry the issuers' words, a name said to be one", async () => {
    upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const body = await (await get("/xrpl/markets.data?period=7d&_routes=routes%2Fnet.markets")).text();
    const data = routeData(body);
    expect(data).not.toHaveProperty("names");
    const parts = data.rows.flatMap((row) => row.issuers);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(part).toMatchObject({ issuer: expect.stringMatching(/^Fixture /), name: true, labels: [] });
  });
});

describe("when the names call fails", () => {
  it("shows the short addresses, serves the page and does not store it", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = "/xrpl/markets?period=7d";
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
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

  it("sends rows whose issuers are their short addresses, with no name and no mark", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get("/xrpl/markets.data?period=7d&quote=eur&_routes=routes%2Fnet.markets")).text();
    const parts = routeData(body).rows.flatMap((row) => row.issuers);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(part.issuer).toMatch(/^r\w{5}…\w{4}$/);
      expect(part).not.toHaveProperty("name");
      expect(part.labels).toEqual([]);
    }
  });
});
