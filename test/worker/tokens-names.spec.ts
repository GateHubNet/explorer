import { describe, expect, it } from "vitest";

import { collectAddresses } from "../../app/server/names-collect";
import xahauList from "../fixtures/http/xahau/data-api/tokens@kind=issued&limit=20&min_holders=10.json";
import xrplList from "../fixtures/http/xrpl/data-api/tokens@kind=issued&limit=20&min_holders=10.json";
import rlusdHolders from "../fixtures/http/xrpl/data-api/tokens/524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De/holders@limit=10.json";
import rlusdHolders50 from "../fixtures/http/xrpl/data-api/tokens/524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De/holders@limit=50.json";
import rlusdTransfers from "../fixtures/http/xrpl/data-api/tokens/524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De/transfers@descending=true&limit=20.json";
import rlusd from "../fixtures/http/xrpl/data-api/tokens/524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json";
import {
  dataUrlOf,
  expectAccountsDrawn,
  expectAddressesOnly,
  failingNames,
  inCalls,
  linkedAccounts,
  namesCalls,
  namesPartOf,
  namesSpec,
  namesStatuses,
  sorted,
  viewedAmong,
  watchNamesLog,
  withoutNames,
} from "../support/names";
import { expectDegraded, forgetStored } from "../support/nft-pages";
import { pageClient } from "../support/pages";
import { holdersMarker, tokenCase, tokensMarker, transfersMarker } from "../support/token-cases";

// The names of the issuers on the token list, `/{net}/tokens` (display names spec 1 and 5; token pages spec 2.4), and of the addresses of a token's page, `/{net}/token/{token}` (spec 3.2 #6), on
// the real Worker: one names call after the list call, for the issuers of the rows, sorted; one after the calls of the token page, for the issuer, the holders, the transfers' parties and the markets'
// counter issuers; each drawn by what the fixtures say of it; every account asked for is linked and every account linked is asked for; none when no row is drawn; a failed or a late
// call leaves the short addresses and the page unstored, with one log line; a page behind a marker is named like the first page.
//
// A file of its own, as the names of the other pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): a test that
// says a page is not stored starts from a cache that holds none of it (`forgetStored`), and `namesSpec` takes the subrequest entries away and moves `Date` past the longest keep after
// each test, so that none needs another to have run, or not. The page does not poll, so no call asks for the failure hold.

const { get, page } = pageClient("198.18.96");
const { upstream } = namesSpec({ advance: 301_000 });

const ROUTE = "routes/net.tokens";

/** The second page of XRPL's list: the answer to the marker of the first (`xrplList.marker`). */
const secondPages = import.meta.glob<{ tokens: Array<{ issuer: string }> }>("../fixtures/http/xrpl/data-api/tokens@kind=issued&limit=20&marker=*&min_holders=10.json", { import: "default", eager: true });
const xrplMore = Object.entries(secondPages).find(([path]) => path.includes(`marker=${xrplList.marker}&`))![1];

/** The issuers of the rows of an answer, once each in the order met: what the loader asks the names of. */
const issuersOf = (answer: { tokens: Array<{ issuer: string }> }) => collectAddresses(answer.tokens.map((token) => token.issuer));

describe("the names call of the list", () => {
  it("is one, after the list call, for the issuers of the rows sorted, and the table draws each by what the fixtures say", async () => {
    const mock = upstream("xrpl");
    const { html } = await page("/xrpl/tokens");

    const issuers = issuersOf(xrplList);
    expect(issuers.length).toBeGreaterThan(5);
    expect(namesCalls(mock)).toEqual(inCalls(issuers));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The list call and the names call: nothing else.
    expect(withoutNames(mock.requests)).toHaveLength(1);

    // Every account the page links is asked for, and every account asked for is linked: the page draws what it names, and names what it draws.
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    // The fixtures name some of the issuers: a name for those, the short address for the others.
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });

  it("is the same on Xahau", async () => {
    const mock = upstream("xahau");
    const { html } = await page("/xahau/tokens");

    expect(namesCalls(mock)).toEqual(inCalls(issuersOf(xahauList)));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    const { named } = await expectAccountsDrawn(html, "xahau");
    expect(named.length).toBeGreaterThan(0);
  });

  it("carries the names the call gave in the page's data, for the browser: the issuers the fixtures give something to show", async () => {
    const mock = upstream("xrpl");
    const body = await (await get(dataUrlOf("/xrpl/tokens.data?q=USD", ROUTE))).text();
    const part = namesPartOf(body, ROUTE);

    expect(part.state).toBe("ok");
    const asked = namesCalls(mock).flat();
    expect(asked.length).toBeGreaterThan(2);
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", asked)));
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("makes no call for a page with no row to draw", async () => {
    const empty = { result: "success", coverage: { complete: true, from_ledger_index: 32570 }, kind: "issued", total: 0, total_below: 0, count: 0, tokens: [] };
    const mock = upstream("xrpl", { "GET /v2/tokens?kind=issued&limit=20&min_holders=10&q=zzzz": empty });
    const body = await (await get(dataUrlOf("/xrpl/tokens.data?q=zzzz", ROUTE))).text();

    expect(namesCalls(mock)).toEqual([]);
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "ok", map: {} });
  });

  it("names a page behind a marker like the first page, from its own rows", async () => {
    const marker = await tokensMarker("xrpl");
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/tokens?marker=${marker}`);

    expect(namesCalls(mock)).toEqual(inCalls(issuersOf(xrplMore)));
    expect(namesStatuses(mock)).toEqual([200]);
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });
});

describe("when the names call fails or is late", () => {
  it("shows the short addresses, serves the page and does not store it, and logs it once, when it fails", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = "/xrpl/tokens?all=1";
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(5);
    expect(html).not.toContain("acct__name");
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get(dataUrlOf("/xrpl/tokens.data?all=1", ROUTE))).text();
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "failed", map: {} });
  });

  it("shows the short addresses, serves the page and does not store it, and logs it once, when it is late", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { "GET /v2/account_names": () => new Promise<Response>(() => {}) });
    const path = "/xrpl/tokens?q=USD&all=1";
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    // One call, for the issuers of the rows, which never answered.
    expect(namesCalls(mock)).toEqual(inCalls(linkedAccounts(html, "xrpl")));
    expect(html).not.toContain("acct__name");
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(1);
    expect(logged()).toBe(1);
  });
});

// ---- The token page ------------------------------------------------------------------------------------------------------------------------------------------------------

/** The button to the issuer's account has the words of a button, not an address: the page's links are checked without it (the issuer is linked in its header and in the toml card all the same). */
const withoutButton = (html: string) => html.replace(/<a [^>]*>Issuer account<\/a>/, "");

describe("the names call of the token page", () => {
  /** What the loader asks the names of: the issuer, the counter issuers of the markets, the top holders and the parties of the transfers. */
  const expectedFor = collectAddresses(
    rlusd.token.issuer,
    rlusd.token.markets.map((market) => (market as { counter_issuer?: string }).counter_issuer),
    rlusdHolders.holders.map((holder) => holder.holder),
    rlusdTransfers.transfers.map((transfer) => [transfer.source, transfer.destination]),
  );

  it("is one, after the token's calls, for those addresses sorted, and the page draws each by what the fixtures say", async () => {
    const rlusdCase = await tokenCase("xrpl", "rlusd");
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/token/${rlusdCase.path}`);

    expect(expectedFor.length).toBeGreaterThan(20);
    expect(namesCalls(mock)).toEqual(inCalls(expectedFor));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The five calls of the page's data and the names call: nothing else.
    expect(withoutNames(mock.requests)).toHaveLength(5);

    // Every account the page links is asked for, and every account asked for is linked: the page draws what it names, and names what it draws.
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named } = await expectAccountsDrawn(withoutButton(html), "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    const rlusdCase = await tokenCase("xrpl", "rlusd");
    const mock = upstream("xrpl");
    const route = "routes/net.token.$token";
    const body = await (await get(dataUrlOf(`/xrpl/token/${rlusdCase.path}.data`, route))).text();
    const part = namesPartOf(body, route);

    expect(part.state).toBe("ok");
    const asked = namesCalls(mock).flat();
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", asked)));
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("makes the same call for Xahau, whose token has no pools", async () => {
    const evr = await tokenCase("xahau", "evr");
    const mock = upstream("xahau");
    const { html } = await page(`/xahau/token/${evr.path}`);

    expect(namesStatuses(mock)).toEqual([200]);
    expect(withoutNames(mock.requests)).toHaveLength(3);
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    const { named } = await expectAccountsDrawn(withoutButton(html), "xahau");
    expect(named.length).toBeGreaterThan(0);
  });

  it("names a page of older transfers from the issuer and its own transfers' parties", async () => {
    const older = await transfersMarker("xrpl");
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/token/${older.token}?marker=${older.marker}`);

    expect(namesStatuses(mock)).toEqual([200]);
    expect(withoutNames(mock.requests)).toHaveLength(2);
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    // The issuer is among them, and no holder is: the page does not draw them.
    expect(namesCalls(mock).flat()).toContain(rlusd.token.issuer);
    const { named } = await expectAccountsDrawn(withoutButton(html), "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });
});

describe("when the names call of the token page fails or is late", () => {
  it("shows the short addresses, serves the page and does not store it, and logs it once, when it fails", async () => {
    const usd = await tokenCase("xrpl", "usd");
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `/xrpl/token/${usd.path}`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(expectAddressesOnly(withoutButton(html), "xrpl")).toBeGreaterThan(5);
    expect(html).not.toContain("acct__name");
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    const usd = await tokenCase("xrpl", "usd");
    watchNamesLog();
    upstream("xrpl", failingNames());
    const route = "routes/net.token.$token";
    const body = await (await get(dataUrlOf(`/xrpl/token/${usd.path}.data`, route))).text();
    expect(namesPartOf(body, route)).toEqual({ state: "failed", map: {} });
  });

  it("shows the short addresses, serves the page and does not store it, and logs it once, when it is late", async () => {
    const few = await tokenCase("xrpl", "few-holders");
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { "GET /v2/account_names": () => new Promise<Response>(() => {}) });
    const path = `/xrpl/token/${few.path}`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    // One call, for the accounts of the page, which never answered.
    expect(namesCalls(mock)).toEqual(inCalls(linkedAccounts(html, "xrpl")));
    expect(html).not.toContain("acct__name");
    expect(expectAddressesOnly(withoutButton(html), "xrpl")).toBeGreaterThan(1);
    expect(logged()).toBe(1);
  });
});

// ---- The holders page ----------------------------------------------------------------------------------------------------------------------------------------------------

describe("the names call of the holders page", () => {
  /** What the loader asks the names of: the issuer and the 50 holders of the page. */
  const expectedFor = collectAddresses(
    rlusd.token.issuer,
    rlusdHolders50.holders.map((holder) => holder.holder),
  );

  it("is one, after the token call and the holders call, for the issuer and the 50 holders sorted, and the page draws each by what the fixtures say", async () => {
    const rlusdCase = await tokenCase("xrpl", "rlusd");
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/token/${rlusdCase.path}/holders`);

    expect(expectedFor).toHaveLength(51);
    expect(namesCalls(mock)).toEqual(inCalls(expectedFor));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The two calls of the page's data and the names call: nothing else.
    expect(withoutNames(mock.requests)).toHaveLength(2);

    // Every account the page links is asked for, and every account asked for is linked: the page draws what it names, and names what it draws.
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    const rlusdCase = await tokenCase("xrpl", "rlusd");
    const mock = upstream("xrpl");
    const route = "routes/net.token.$token.holders";
    const body = await (await get(dataUrlOf(`/xrpl/token/${rlusdCase.path}/holders.data`, route))).text();
    const part = namesPartOf(body, route);

    expect(part.state).toBe("ok");
    const asked = namesCalls(mock).flat();
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", asked)));
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("is the same on Xahau", async () => {
    const evr = await tokenCase("xahau", "evr");
    const mock = upstream("xahau");
    const { html } = await page(`/xahau/token/${evr.path}/holders`);

    expect(namesStatuses(mock)).toEqual([200]);
    expect(withoutNames(mock.requests)).toHaveLength(2);
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    const { named } = await expectAccountsDrawn(html, "xahau");
    expect(named.length).toBeGreaterThan(0);
  });

  it("names a page behind a marker like the first page, from its own holders", async () => {
    const more = await holdersMarker("xrpl");
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/token/${more.token}/holders?marker=${more.marker}`);

    expect(namesStatuses(mock)).toEqual([200]);
    expect(withoutNames(mock.requests)).toHaveLength(2);
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });

  it("asks the names of the issuer alone when the holders call failed: it is all the page draws", async () => {
    const few = await tokenCase("xrpl", "few-holders");
    const mock = upstream("xrpl", { [`GET /v2/tokens/${few.currency}.${few.issuer}/holders?limit=50`]: () => new Response("down", { status: 503 }) });
    const path = `/xrpl/token/${few.path}/holders`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesCalls(mock)).toEqual(inCalls([few.issuer]));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
  });
});

describe("when the names call of the holders page fails or is late", () => {
  it("shows the short addresses, serves the page and does not store it, and logs it once, when it fails", async () => {
    const usd = await tokenCase("xrpl", "usd");
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `/xrpl/token/${usd.path}/holders`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(5);
    expect(html).not.toContain("acct__name");
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    const usd = await tokenCase("xrpl", "usd");
    watchNamesLog();
    upstream("xrpl", failingNames());
    const route = "routes/net.token.$token.holders";
    const body = await (await get(dataUrlOf(`/xrpl/token/${usd.path}/holders.data`, route))).text();
    expect(namesPartOf(body, route)).toEqual({ state: "failed", map: {} });
  });

  it("shows the short addresses, serves the page and does not store it, and logs it once, when it is late", async () => {
    const few = await tokenCase("xrpl", "few-holders");
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { "GET /v2/account_names": () => new Promise<Response>(() => {}) });
    const path = `/xrpl/token/${few.path}/holders`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    // One call, for the accounts of the page, which never answered.
    expect(namesCalls(mock)).toEqual(inCalls(linkedAccounts(html, "xrpl")));
    expect(html).not.toContain("acct__name");
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(1);
    expect(logged()).toBe(1);
  });
});
