import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { ActiveAccounts, PairExchange } from "../../app/server/api-types";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import lionsAccounts from "../fixtures/http/xrpl/data-api/active_accounts/XRP/4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json";
import rlusdAccounts from "../fixtures/http/xrpl/data-api/active_accounts/XRP/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json";
import lionsTrades from "../fixtures/http/xrpl/data-api/exchanges/XRP/4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS@descending=true&limit=20.json";
import rlusdTrades from "../fixtures/http/xrpl/data-api/exchanges/XRP/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De@descending=true&limit=20.json";
import { decodeLoaderData } from "../support/loader-data";
import { expectAccountsDrawn, inCalls, namesCalls, namesStatuses, shownName, viewOf, watchNamesLog } from "../support/names";
import { anchors, pageClient, textOf } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// The names of the accounts on the market pair page, `/{net}/markets/{base}/{counter}` (display names spec 1 and 5), on the real Worker against the recorded trades and traders:
// one names call after the market is told to exist, for the takers of the trades and the accounts of the traders list the page draws, sorted; the takers (links) and the traders (bars) drawn
// by their names; no call for an address the page does not draw; a failed call leaves the addresses, holds the failure and does not store the page; and a page behind a marker.
//
// A file of its own, as the live pages' names are (market-pair-live-names.spec.ts says why): market-pair.spec.ts renders XRP/RLUSD in many tests, and which of them sees the names call would
// be the order the tests ran in. Here `cold` takes the subrequest entries away, so that every render reaches the mock whatever an earlier test kept, each test has a page of its own
// (a stored page answers a second request), and `Date` alone is faked and moved past the failure hold after each test, so that no test reads what another held.

const { get, storedAs } = pageClient("198.51.118");

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

const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
/** XRP/RLUSD's pool: the other side of every swap, and the top of its traders list. */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const RLUSD_PAIR = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;
const LIONS_PAIR = `/xrpl/markets/XRP/LIONS.${LIONS_ISSUER}`;
const LIONS_INVERTED = `/xrpl/markets/LIONS.${LIONS_ISSUER}/XRP`;
const unavailable = () => dataApiError(503, "unavailable");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

const trades = (file: unknown) => (file as { exchanges: PairExchange[] }).exchanges;
const traders = (file: unknown) => (file as ActiveAccounts).accounts.map((account) => account.account);
const unique = (addresses: readonly string[]) => [...new Set(addresses)];

/** The traders the page draws: the first 5 of the list, the pool's account left out where the node named it. */
const shownTraders = (file: unknown, pool: string | null) => traders(file).filter((account) => account !== pool).slice(0, 5);

async function render(path: string) {
  const response = await get(path);
  return { response, html: await response.text() };
}

/** The table of the trades, as HTML: from its card to the card of the traders. */
const tradesRegion = (html: string) => html.slice(html.indexOf('aria-label="Recent trades"'), html.indexOf("Most active traders, 24 h"));
/** The links of the traders' bars. */
const bars = (html: string) => anchors(html).filter((a) => a.attrs.includes('class="barlist__link"'));

/** The words a mark adds to a name, which the link reads after it. */
const MARK_WORDS = { verified: "verified name", account: "named by GateHub", domain: "not verified" } as const;

/** The names part of the pair route's data, in the body of a `.data` response. */
const namesPartOf = (body: string) =>
  (decodeLoaderData(body) as { "routes/net.markets.$base.$counter": { data: { names: { state: string; map: Record<string, unknown> } } } })["routes/net.markets.$base.$counter"].data.names;

describe("the names call of the live page", () => {
  it("is one, after the market is told to exist, for the takers of the trades and the top traders sorted, and draws them by their names", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html } = await render(RLUSD_PAIR);

    expect(response.status).toBe(200);
    const takers = unique(trades(rlusdTrades).map((trade) => trade.taker));
    const top = shownTraders(rlusdAccounts, POOL);
    expect(takers.length).toBeGreaterThan(5);
    expect(namesCalls(mock)).toEqual(inCalls(unique([...takers, ...top])));
    expect(namesStatuses(mock)).toEqual([200]);
    // After every other call of the render.
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");

    // The takers: each link of the table is drawn by what the fixtures say of it, a name with its title or the short address; there are both kinds.
    const drawn = await expectAccountsDrawn(tradesRegion(html), "xrpl");
    expect(drawn.named.length, "a taker the fixtures name").toBeGreaterThan(0);
    expect(drawn.plain.length).toBeGreaterThan(0);
    expect([...drawn.named, ...drawn.plain].sort()).toEqual([...takers].sort());

    // The traders: a bar for each of the top 5 (the pool left out), by its name and mark, its short address under it when it has a name.
    const links = bars(html);
    expect(links).toHaveLength(top.length);
    for (const [at, account] of top.entries()) {
      const view = await viewOf("xrpl", account);
      expect(links[at]!.attrs).toContain(`href="/xrpl/account/${account}"`);
      expect(links[at]!.text.startsWith(await shownName("xrpl", account)), account).toBe(true);
      if (view?.name) {
        expect(links[at]!.text).toContain(MARK_WORDS[view.name.kind]);
        expect(textOf(html)).toContain(`${shortAddress(account)}`);
      }
    }
    expect(top.some((account) => links.some((link) => link.text.includes("not verified")))).toBe(true);
  });

  it("asks for no address the page does not draw: the pool, the issuer, the traders past the top 5, a trade's buyer and seller who are not its taker", async () => {
    cold();
    mock = mockUpstream("xrpl");
    // The same page in the other orientation is another URL, so another page of the edge cache (this file has no other test of it), asking for the same addresses.
    await render(`/xrpl/markets/RLUSD.${RLUSD_ISSUER}/XRP`);
    const asked = namesCalls(mock).flat();

    const takers = unique(trades(rlusdTrades).map((trade) => trade.taker));
    const drawn = unique([...takers, ...shownTraders(rlusdAccounts, POOL)]);
    const others = unique([
      POOL,
      RLUSD_ISSUER,
      ...traders(rlusdAccounts),
      ...trades(rlusdTrades).flatMap((trade) => [trade.buyer, trade.seller, trade.provider]),
    ]).filter((address) => !drawn.includes(address));
    // The fixtures hold addresses the page does not draw: the pool, the traders past the top 5 (one of them labelled), buyers and sellers.
    expect(others).toEqual(expect.arrayContaining([POOL, RLUSD_ISSUER]));
    expect(others.length).toBeGreaterThan(4);
    for (const address of others) expect(asked, address).not.toContain(address);
    expect([...asked].sort()).toEqual([...drawn].sort());
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const body = await (await get(`/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}.data?interval=4h&_routes=routes%2Fnet.markets.%24base.%24counter`)).text();
    const part = namesPartOf(body);
    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("keeps the head's issuer as the whole address and the tags short, whatever the fixtures say of the issuer", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html } = await render(LIONS_INVERTED);
    expect(response.status).toBe(200);

    expect((await viewOf("xrpl", LIONS_ISSUER))?.name, "the fixtures name the LIONS issuer").toBeDefined();
    expect(textOf(html)).toContain(`LIONS issued by ${LIONS_ISSUER}`);
    expect(namesCalls(mock).flat()).not.toContain(LIONS_ISSUER);
    // The title and the description keep the short issuer (the pair's page is shared out of context: display names spec 7).
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toContain(`LIONS ${shortAddress(LIONS_ISSUER)}`);
    expect(/<meta name="description" content="([^"]*)"/.exec(html)?.[1]).toContain(`LIONS issued by ${shortAddress(LIONS_ISSUER)}`);
  });
});

describe("when the names call fails", () => {
  it("shows the addresses, serves the page, does not store it, and holds the failure for the same accounts: another view within 5 s does not make the call again", async () => {
    cold();
    const logged = watchNamesLog();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    const first = await render(LIONS_PAIR);

    expect(first.response.status).toBe(200);
    expect(first.response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(LIONS_PAIR)).toBe(false);
    expect(namesStatuses(mock)).toEqual([503]);
    // The taker and the trader the fixtures name are their short addresses.
    const named = unique([...trades(lionsTrades).map((trade) => trade.taker), ...shownTraders(lionsAccounts, null)]);
    for (const account of named) expect(textOf(first.html)).toContain(shortAddress(account));
    expect(bars(first.html).every((link) => /^r[1-9A-HJ-NP-Za-km-z]{5}…/.test(link.text))).toBe(true);
    expect(first.html).not.toContain("verified name");

    // Another view of the same accounts, a second later: the held failure answers, and the data API is not asked.
    vi.setSystemTime(Date.now() + 1_000);
    const second = await render(`${LIONS_PAIR}?interval=15m`);
    expect(second.response.status).toBe(200);
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await isStored(`${LIONS_PAIR}?interval=15m`)).toBe(false);

    // Past the hold the call is made again.
    vi.setSystemTime(Date.now() + 5_000);
    await render(`${LIONS_PAIR}?interval=4h`);
    expect(namesCalls(mock)).toHaveLength(2);
    // Each render that was given a failure, held or not, logged it.
    expect(logged()).toBe(3);
  });

  it("marks the data of that page failed, with no names", async () => {
    cold();
    watchNamesLog();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    const body = await (await get(`${LIONS_PAIR}.data?interval=1d&_routes=routes%2Fnet.markets.%24base.%24counter`)).text();
    expect(namesPartOf(body)).toEqual({ state: "failed", map: {} });
  });
});

describe("a page behind a marker", () => {
  const marker = "WzEwNzY3MTU5MSwxNCwxXQ";

  it("makes one names call for the takers of its rows, awaited, and is stored as MARKER_PAGE_CLASS with the names", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const path = `${RLUSD_PAIR}?marker=${marker}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    // The links of the table are its takers (the head's issuer is a link to an account too, which the page does not name); the page has no traders card here.
    const table = html.slice(html.indexOf('aria-label="Recent trades"'));
    const takers = unique([...table.matchAll(/href="\/xrpl\/account\/(r[1-9A-HJ-NP-Za-km-z]{24,34})"/g)].map((match) => match[1]!));
    expect(takers.length).toBeGreaterThan(0);
    expect(namesCalls(mock)).toEqual(inCalls(takers));
    expect(namesCalls(mock).flat()).not.toContain(RLUSD_ISSUER);
    expect(namesStatuses(mock)).toEqual([200]);
    const drawn = await expectAccountsDrawn(table, "xrpl");
    expect([...drawn.named, ...drawn.plain].sort()).toEqual([...takers].sort());
  });

  it("is served with the addresses and not stored when the names call fails", async () => {
    cold();
    const logged = watchNamesLog();
    const path = `${LIONS_PAIR}?marker=${marker}`;
    // LIONS has no page behind this marker in the fixtures, so the data API is given one: the first trade of the recorded page.
    mock = mockUpstream("xrpl", {
      "GET /v2/account_names": unavailable(),
      [`GET /v2/exchanges/XRP/${encodeURIComponent(`4C494F4E53000000000000000000000000000000+${LIONS_ISSUER}`)}?descending=true&limit=20&marker=${marker}`]: {
        count: 1,
        exchanges: trades(lionsTrades).slice(0, 1),
        result: "success",
      },
    });
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(textOf(html)).toContain(shortAddress(trades(lionsTrades)[0]!.taker));
    expect(logged()).toBe(1);
  });
});
