import { describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { ActiveAccounts, PairExchange } from "../../app/server/api-types";
import lionsAccounts from "../fixtures/http/xrpl/data-api/active_accounts/XRP/4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json";
import rlusdAccounts from "../fixtures/http/xrpl/data-api/active_accounts/XRP/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json";
import lionsTrades from "../fixtures/http/xrpl/data-api/exchanges/XRP/4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS@descending=true&limit=20.json";
import rlusdTrades from "../fixtures/http/xrpl/data-api/exchanges/XRP/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De@descending=true&limit=20.json";
import {
  expectAccountsDrawn,
  failingNames,
  inCalls,
  linkedAccounts,
  MARK_WORDS,
  namesCalls,
  namesPartOf,
  namesSpec,
  namesStatuses,
  shownName,
  viewOf,
  watchNamesLog,
} from "../support/names";
import { expectDegraded, isStored } from "../support/nft-pages";
import { anchors, pageClient, textOf } from "../support/pages";

// The names of the accounts on the market pair page, `/{net}/markets/{base}/{counter}` (display names spec 1 and 5), on the real Worker against the recorded trades and traders:
// one names call after the market is told to exist, for the issuers of the head, the takers of the trades and the accounts of the traders list the page draws, sorted; the issuers and the
// takers (links) and the traders (bars) drawn by their names; no call for an address the page does not draw; a failed call leaves the addresses, holds the failure and does not store the
// page; and a page behind a marker.
//
// A file of its own, as the live pages' names are (market-pair-live-names.spec.ts says why): market-pair.spec.ts renders XRP/RLUSD in many tests, and which of them sees the names call would
// be the order the tests ran in. Here `namesSpec` takes the subrequest entries away, so that every render reaches the mock whatever an earlier test kept, each test has a page of its own
// (a stored page answers a second request), and `Date` alone is faked and moved past the failure hold after each test, so that no test reads what another held.

const { get, page, storedAs } = pageClient("198.51.118");
const { upstream } = namesSpec({ advance: 31_000 });

const ROUTE = "routes/net.markets.$base.$counter";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
/** XRP/RLUSD's pool: the other side of every swap, and the top of its traders list. */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const RLUSD_PAIR = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;
const LIONS_PAIR = `/xrpl/markets/XRP/LIONS.${LIONS_ISSUER}`;
const LIONS_INVERTED = `/xrpl/markets/LIONS.${LIONS_ISSUER}/XRP`;

const trades = (file: unknown) => (file as { exchanges: PairExchange[] }).exchanges;
const traders = (file: unknown) => (file as ActiveAccounts).accounts.map((account) => account.account);
const unique = (addresses: readonly string[]) => [...new Set(addresses)];

/** The traders the page draws: the first 5 of the list, the pool's account left out where the node named it. */
const shownTraders = (file: unknown, pool: string | null) => traders(file).filter((account) => account !== pool).slice(0, 5);

/** The table of the trades, as HTML: from its card to the card of the traders. */
const tradesRegion = (html: string) => html.slice(html.indexOf('aria-label="Recent trades"'), html.indexOf("Most active traders, 24 h"));
/** The links of the traders' bars. */
const bars = (html: string) => anchors(html).filter((a) => a.attrs.includes('class="barlist__link"'));
/** The link to the issuer in the head: "LIONS issued by" and then this link, the name and its mark, and the whole address. */
const issuerLink = (html: string, issuer: string) => anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${issuer}"`) && a.text.includes(issuer))!;

describe("the names call of the live page", () => {
  it("is one, after the market is told to exist, for the issuer of the head, the takers of the trades and the top traders sorted, and draws them by their names", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(RLUSD_PAIR);

    const takers = unique(trades(rlusdTrades).map((trade) => trade.taker));
    const top = shownTraders(rlusdAccounts, POOL);
    expect(takers.length).toBeGreaterThan(5);
    expect(namesCalls(mock)).toEqual(inCalls(unique([RLUSD_ISSUER, ...takers, ...top])));
    expect(namesStatuses(mock)).toEqual([200]);
    // After every other call of the render.
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // Every account the page links is asked for, and every account asked for is linked.
    expect([...namesCalls(mock).flat()].sort()).toEqual([...linkedAccounts(html, "xrpl")].sort());

    // The takers: each link of the table is drawn by what the fixtures say of it, a name with its title or the short address; there are both kinds.
    const drawn = await expectAccountsDrawn(tradesRegion(html), "xrpl");
    expect(drawn.named.length, "a taker the fixtures name").toBeGreaterThan(0);
    expect(drawn.plain.length).toBeGreaterThan(0);
    expect([...drawn.named, ...drawn.plain].sort()).toEqual([...takers].sort());

    // The head's issuer is unnamed in the fixtures, so it is the whole address: the same link, drawn as the fixtures say.
    expect(await viewOf("xrpl", RLUSD_ISSUER)).toBeNull();
    expect(issuerLink(html, RLUSD_ISSUER).text).toBe(RLUSD_ISSUER);

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
    expect(top.some((account) => links.some((link) => link.text.includes(MARK_WORDS.domain)))).toBe(true);
  });

  it("asks for no address the page does not draw: the pool, the traders past the top 5, a trade's buyer and seller who are not its taker", async () => {
    const mock = upstream("xrpl");
    // The same page in the other orientation is another URL, so another page of the edge cache (this file has no other test of it), asking for the same addresses.
    await page(`/xrpl/markets/RLUSD.${RLUSD_ISSUER}/XRP`);
    const asked = namesCalls(mock).flat();

    const takers = unique(trades(rlusdTrades).map((trade) => trade.taker));
    const drawn = unique([RLUSD_ISSUER, ...takers, ...shownTraders(rlusdAccounts, POOL)]);
    const others = unique([
      POOL,
      ...traders(rlusdAccounts),
      ...trades(rlusdTrades).flatMap((trade) => [trade.buyer, trade.seller, trade.provider]),
    ]).filter((address) => !drawn.includes(address));
    // The fixtures hold addresses the page does not draw: the pool, the traders past the top 5 (one of them labelled), buyers and sellers.
    expect(others).toContain(POOL);
    expect(others.length).toBeGreaterThan(4);
    for (const address of others) expect(asked, address).not.toContain(address);
    expect([...asked].sort()).toEqual([...drawn].sort());
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    upstream("xrpl");
    const body = await (await get(`/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}.data?interval=4h&_routes=routes%2Fnet.markets.%24base.%24counter`)).text();
    const part = namesPartOf(body, ROUTE);
    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("draws the head's issuer by its name when the fixtures name it, and keeps the title and the description short", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(LIONS_INVERTED);

    expect((await viewOf("xrpl", LIONS_ISSUER))?.name, "the fixtures name the LIONS issuer").toBeDefined();
    expect(namesCalls(mock).flat()).toContain(LIONS_ISSUER);
    // "LIONS issued by", then the issuer's one link: its name, the mark of how it is known, and the whole address.
    const link = issuerLink(html, LIONS_ISSUER);
    expect(link.text.startsWith(await shownName("xrpl", LIONS_ISSUER, { full: true }))).toBe(true);
    expect(link.text).not.toBe(LIONS_ISSUER);
    expect(textOf(html)).toContain(`LIONS issued by ${link.text}`);
    // The title and the description keep the short issuer (the pair's page is shared out of context: display names spec 7).
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toContain(`LIONS ${shortAddress(LIONS_ISSUER)}`);
    expect(/<meta name="description" content="([^"]*)"/.exec(html)?.[1]).toContain(`LIONS issued by ${shortAddress(LIONS_ISSUER)}`);
  });
});

describe("when the names call fails", () => {
  it("shows the addresses, serves the page, does not store it, and holds the failure for the same accounts: another view within 5 s does not make the call again", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const response = await get(LIONS_PAIR);
    const html = await response.text();

    await expectDegraded(LIONS_PAIR, response);
    expect(namesStatuses(mock)).toEqual([503]);
    // The issuer, the taker and the trader the fixtures name are their addresses, short or whole.
    const named = unique([...trades(lionsTrades).map((trade) => trade.taker), ...shownTraders(lionsAccounts, null)]);
    for (const account of named) expect(textOf(html)).toContain(shortAddress(account));
    expect(issuerLink(html, LIONS_ISSUER).text).toBe(LIONS_ISSUER);
    expect(bars(html).every((link) => /^r[1-9A-HJ-NP-Za-km-z]{5}…/.test(link.text))).toBe(true);
    expect(html).not.toContain("verified name");

    // Another view of the same accounts, a second later: the held failure answers, and the data API is not asked.
    vi.setSystemTime(Date.now() + 1_000);
    const second = await get(`${LIONS_PAIR}?interval=15m`);
    await second.text();
    expect(second.status).toBe(200);
    expect(namesCalls(mock)).toHaveLength(1);
    expect(await isStored(`${LIONS_PAIR}?interval=15m`)).toBe(false);

    // Past the hold the call is made again.
    vi.setSystemTime(Date.now() + 5_000);
    await page(`${LIONS_PAIR}?interval=4h`);
    expect(namesCalls(mock)).toHaveLength(2);
    // Each render that was given a failure, held or not, logged it.
    expect(logged()).toBe(3);
  });

  it("marks the data of that page failed, with no names", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get(`${LIONS_PAIR}.data?interval=1d&_routes=routes%2Fnet.markets.%24base.%24counter`)).text();
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "failed", map: {} });
  });
});

describe("a page behind a marker", () => {
  const marker = "WzEwNzY3MTU5MSwxNCwxXQ";
  /** LIONS has no page behind a marker in the fixtures, so the data API is given one: the first trade of the recorded page. */
  const lionsOlder = (m: string) => ({
    [`GET /v2/exchanges/XRP/${encodeURIComponent(`4C494F4E53000000000000000000000000000000+${LIONS_ISSUER}`)}?descending=true&limit=20&marker=${m}`]: {
      count: 1,
      exchanges: trades(lionsTrades).slice(0, 1),
      result: "success",
    },
  });

  it("makes one names call for the issuer of the head and the takers of its rows, awaited, and is stored as MARKER_PAGE_CLASS with the names", async () => {
    const mock = upstream("xrpl");
    const path = `${RLUSD_PAIR}?marker=${marker}`;
    const { html } = await page(path);

    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    // The links of the page are the head's issuer and the takers of the table (the page has no traders card here): every one is asked for, and nothing else.
    const linked = linkedAccounts(html, "xrpl");
    const takers = linkedAccounts(html.slice(html.indexOf('aria-label="Recent trades"')), "xrpl");
    expect(takers.length).toBeGreaterThan(0);
    expect(linked).toEqual(expect.arrayContaining([RLUSD_ISSUER, ...takers]));
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(namesStatuses(mock)).toEqual([200]);
    const drawn = await expectAccountsDrawn(html, "xrpl");
    expect([...drawn.named, ...drawn.plain].sort()).toEqual([...linked].sort());
  });

  it("is served with the addresses and not stored when the names call fails", async () => {
    const logged = watchNamesLog();
    const path = `${LIONS_PAIR}?marker=${marker}`;
    const mock = upstream("xrpl", { ...failingNames(), ...lionsOlder(marker) });
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(textOf(html)).toContain(shortAddress(trades(lionsTrades)[0]!.taker));
    expect(issuerLink(html, LIONS_ISSUER).text).toBe(LIONS_ISSUER);
    expect(logged()).toBe(1);
  });

  it("holds a failed names call for 5 s, as the live page does: two renders within the hold make one call, and the next past it makes another", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { ...failingNames(), ...lionsOlder("HHHH") });
    const path = `${LIONS_PAIR}?marker=HHHH`;

    expect((await get(path)).status).toBe(200);
    expect(namesCalls(mock)).toHaveLength(1);
    // A degraded page is not stored, so the same URL is rendered again a second later: the held failure answers, and the data API is not asked.
    vi.setSystemTime(Date.now() + 1_000);
    const second = await get(path);
    await second.text();
    expect(second.status).toBe(200);
    expect(namesCalls(mock)).toHaveLength(1);
    expect(namesStatuses(mock)).toEqual([503]);

    vi.setSystemTime(Date.now() + 5_000);
    await (await get(path)).text();
    expect(namesCalls(mock)).toHaveLength(2);
    expect(logged()).toBe(3);
  });
});
