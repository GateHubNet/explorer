import { describe, expect, it } from "vitest";

import { mptIssuerOf } from "../../app/domain/mpt-id";
import { collectAddresses } from "../../app/server/names-collect";
import holders50 from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/holders@limit=50.json";
import transfers20 from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/transfers@descending=true&limit=20.json";
import holders10 from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/holders@limit=10.json";
import transfers8 from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80/transfers@descending=true&limit=8.json";
import htfIssuance from "../fixtures/http/xrpl/data-api/mpt/03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80.json";
import tabList from "../fixtures/http/xrpl/data-api/tokens@kind=mpt&limit=20.json";
import tabSecond from "../fixtures/http/xrpl/data-api/tokens@kind=mpt&limit=20&marker=WyJtcHQiLDUsInJMbnc4YmlEa1FSWDZ3akw3ZUwxRDNpTnlSMWY1WmdxSkQiLCIwNTY1MzNGQkQxMzQzOTBEQjAzRjhEMkI1MEE2MjJDOUM5MDYzNjk3OTIwRDIwNjIiXQ.json";
import tabHtf from "../fixtures/http/xrpl/data-api/tokens@kind=mpt&limit=20&q=HTF.json";
import { MPT_FIXTURE_IDS } from "../support/mpt-case-rules";
import {
  answerNamesAfterTheirEnd,
  dataUrlOf,
  expectAccountsDrawn,
  expectAddressesOnly,
  expectLinkedAccountsNamed,
  failingNames,
  inCalls,
  linkedAccounts,
  namesCalls,
  namesPartOf,
  namesSpec,
  namesStatuses,
  sorted,
  watchNamesLog,
  withoutNames,
} from "../support/names";
import { expectDegraded, forgetStored } from "../support/nft-pages";
import { pageClient } from "../support/pages";

// The names of the addresses of an MPT issuance's page, `/{net}/mpt/{ID}` (display names spec 1 and 5; E14 spec 2.4 and 3.2), on the real Worker: one names call after the three calls of the page,
// for the issuer, the holders and the transfers' parties (at most 27), sorted; every account asked for is linked and every account linked is asked for; a failed or a late call leaves the short
// addresses and the page unstored, with one log line; a page read from the network is named like the others. The fixtures name no MPT address (ruling C4: the cap on the names batch would cut the
// token issuers), so a test that wants names gives `answerNamesAfterTheirEnd()`; the one exception is `nodeOnly`, whose issuer is the active account, which the fixtures do name.
//
// A file of its own, as the names of the other pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): a test that says a
// page is not stored starts from a cache that holds none of it (`forgetStored`), and `namesSpec` takes the subrequest entries away and moves `Date` past the longest keep after each test.

const { page, get } = pageClient("198.51.132");
const { upstream } = namesSpec({ advance: 301_000 });

const { htf: HTF, escrow, lockedAll, nodeOnly: NODE_ONLY } = MPT_FIXTURE_IDS;
const P = (id: string) => `/xrpl/mpt/${id}`;

/** The button to the issuer's account has the words of a button, not an address: the page's links are checked without it (the issuer is linked in its header all the same). */
const withoutButton = (html: string) => html.replace(/<a [^>]*>Issuer account<\/a>/, "");

/** What the loader asks the names of: the issuer, the 10 holders and the 8 transfers' parties, once each. */
const EXPECTED = collectAddresses(
  htfIssuance.issuance.issuer,
  holders10.holders.map((holder) => holder.holder),
  transfers8.transfers.map((transfer) => [transfer.source, transfer.destination]),
);

describe("the names call of the page", () => {
  it("is one, after the page's calls, for those addresses sorted, and the page draws each by the name it was given", async () => {
    await forgetStored(P(HTF));
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(P(HTF));

    expect(EXPECTED.length).toBeGreaterThan(10);
    expect(EXPECTED.length).toBeLessThanOrEqual(27);
    expect(namesCalls(mock)).toEqual(inCalls(EXPECTED));
    expect(namesStatuses(mock)).toEqual([200]);
    // The three calls of the page, and the names call after them.
    expect(withoutNames(mock.requests)).toHaveLength(3);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // Every account the page links is asked for, and every account asked for is linked.
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expectLinkedAccountsNamed(mock, withoutButton(html), "xrpl");
  });

  it("names a page read from the network the same way: its issuer is the active account, which the fixtures name", async () => {
    await forgetStored(P(NODE_ONLY));
    const mock = upstream("xrpl");
    const { html } = await page(P(NODE_ONLY));

    expect(namesCalls(mock)).toEqual(inCalls(collectAddresses("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh")));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named } = await expectAccountsDrawn(withoutButton(html), "xrpl");
    expect(named).toEqual(["rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh"]);
  });

  it("asks for exactly the accounts the page links, on an issuance of its own with fewer rows", async () => {
    await forgetStored(P(lockedAll));
    const mock = upstream("xrpl");
    const { html } = await page(P(lockedAll));

    const asked = namesCalls(mock).flat();
    expect(asked).toContain(linkedAccounts(html, "xrpl")[0]);
    expect([...asked].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expect(asked.length).toBeLessThanOrEqual(27);
  });
});

describe("when the names call fails or is late", () => {
  it("shows the short addresses, serves the page and does not store it, and logs it once, when it fails", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = P(escrow);
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(expectAddressesOnly(withoutButton(html), "xrpl")).toBeGreaterThan(3);
    expect(html).not.toContain("acct__name");
    expect(logged()).toBe(1);
  });

  it("does the same when the call never answers", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { "GET /v2/account_names": () => new Promise<Response>(() => {}) });
    const path = P(HTF);
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesCalls(mock)).toEqual(inCalls(EXPECTED));
    expect(html).not.toContain("acct__name");
    expect(expectAddressesOnly(withoutButton(html), "xrpl")).toBeGreaterThan(3);
    expect(logged()).toBe(1);
  });
});

// ---- The holders' and the transfers' pages ---------------------------------------------------------------------------------------------------------------------------------------

const H = (id: string) => `${P(id)}/holders`;
const T = (id: string) => `${P(id)}/transfers`;

describe("the names call of the holders' page", () => {
  /** What the loader asks the names of: the issuer and the 50 holders of the page. */
  const expected = collectAddresses(htfIssuance.issuance.issuer, holders50.holders.map((holder) => holder.holder));

  it("is one, after the two calls of the page, for the issuer and the holders sorted, and the page draws each by the name it was given", async () => {
    await forgetStored(H(HTF));
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(H(HTF));

    expect(expected.length).toBeGreaterThan(30);
    expect(namesCalls(mock)).toEqual(inCalls(expected));
    expect(withoutNames(mock.requests)).toHaveLength(2);
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("shows the short addresses, serves the page and does not store it, and logs it once, when the call fails", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    await forgetStored(H(escrow));
    const response = await get(H(escrow));
    const html = await response.text();

    await expectDegraded(H(escrow), response);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(0);
    expect(logged()).toBe(1);
  });
});

describe("the names call of the transfers' page", () => {
  const expected = collectAddresses(htfIssuance.issuance.issuer, transfers20.transfers.map((transfer) => [transfer.source, transfer.destination]));

  it("is one, after the two calls of the page, for the issuer and the parties sorted, and the page draws each by the name it was given", async () => {
    await forgetStored(T(HTF));
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(T(HTF));

    expect(expected.length).toBeGreaterThan(10);
    expect(namesCalls(mock)).toEqual(inCalls(expected));
    expect(withoutNames(mock.requests)).toHaveLength(2);
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("does the same when the call never answers", async () => {
    const logged = watchNamesLog();
    upstream("xrpl", { "GET /v2/account_names": () => new Promise<Response>(() => {}) });
    await forgetStored(T(lockedAll));
    const response = await get(T(lockedAll));
    const html = await response.text();

    await expectDegraded(T(lockedAll), response);
    expect(html).not.toContain("acct__name");
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(0);
    expect(logged()).toBe(1);
  });
});

// ---- The MPT tab of the token list (E14 spec 4; ruling C25) -------------------------------------------------------------------------------------------------------------------------------

describe("the names call of the MPT tab", () => {
  const TAB = "/xrpl/tokens?kind=mpt";
  /** The issuers of the rows of an answer, once each and sorted: what the loader asks the names of. */
  const issuersOf = (answer: { tokens: Array<{ issuer: string }> }) => collectAddresses(answer.tokens.map((token) => token.issuer));

  it("is one, after the list call, for the issuers of the rows sorted, and the table draws each by the name it was given", async () => {
    await forgetStored(TAB);
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(TAB);

    const issuers = issuersOf(tabList);
    expect(issuers.length).toBeGreaterThan(10);
    expect(namesCalls(mock)).toEqual(inCalls(issuers));
    expect(namesStatuses(mock)).toEqual([200]);
    // The list call and the names call: nothing else, the names last.
    expect(withoutNames(mock.requests)).toHaveLength(1);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // Every account the page links is asked for, and every account asked for is linked.
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("names a page behind a marker from its own rows", async () => {
    const path = `${TAB}&marker=${tabList.marker}`;
    await forgetStored(path);
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(path);

    expect(namesCalls(mock)).toEqual(inCalls(issuersOf(tabSecond)));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const body = await (await get(dataUrlOf("/xrpl/tokens.data?kind=mpt&q=HTF", "routes/net.tokens"))).text();
    const part = namesPartOf(body, "routes/net.tokens");

    expect(part.state).toBe("ok");
    expect(Object.keys(part.map)).toEqual(namesCalls(mock).flat());
    expect(Object.keys(part.map)).toHaveLength(1);
  });

  // The whole-branch review's M3: the tab draws the issuer the issuance ID holds, so that is the address whose name is asked for, not D9's `issuer` field of a row that disagrees.
  it("asks the names of the issuer each issuance ID holds, and links that one, where a row's issuer is another", async () => {
    const path = `${TAB}&q=HTF`;
    await forgetStored(path);
    const [first] = tabHtf.tokens;
    const other = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
    const held = mptIssuerOf(first!.mpt_issuance_id);
    expect(other).not.toBe(held);
    const mock = upstream("xrpl", { "GET /v2/tokens?kind=mpt&limit=20&q=HTF": { ...tabHtf, tokens: [{ ...first, issuer: other }] }, "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(path);

    expect(namesCalls(mock)).toEqual(inCalls(collectAddresses(held)));
    expect(linkedAccounts(html, "xrpl")).toContain(held);
    expect(linkedAccounts(html, "xrpl")).not.toContain(other);
  });

  it("makes no call for a page with no row to draw", async () => {
    const mock = upstream("xrpl");
    const body = await (await get(dataUrlOf("/xrpl/tokens.data?kind=mpt&q=zzz", "routes/net.tokens"))).text();

    expect(namesCalls(mock)).toEqual([]);
    expect(namesPartOf(body, "routes/net.tokens")).toEqual({ state: "ok", map: {} });
  });

  it("shows the short addresses, serves the page and does not store it, and logs it once, when the call fails", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    await forgetStored(TAB);
    const response = await get(TAB);
    const html = await response.text();

    await expectDegraded(TAB, response);
    expect(namesStatuses(mock)).toEqual([503]);
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(10);
    expect(html).not.toContain("acct__name");
    expect(logged()).toBe(1);
  });

  it("does the same when the call never answers", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { "GET /v2/account_names": () => new Promise<Response>(() => {}) });
    const path = `${TAB}&q=HTF`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesCalls(mock)).toHaveLength(1);
    expect(html).not.toContain("acct__name");
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(0);
    expect(logged()).toBe(1);
  });
});
