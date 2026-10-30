import { describe, expect, it } from "vitest";

import {
  answerNamesAfterTheirEnd,
  dataUrlOf,
  expectAccountsDrawn,
  expectLinkedAccountsNamed,
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
import { objectCase } from "../support/object-cases";
import { anchors, pageClient } from "../support/pages";

// The names of the accounts on an escrow's page, `/{net}/escrows/{ID}` (display names spec 1 and 5; ledger object pages spec 2.3), on the real Worker: one names call after the calls the page
// awaits (the node's too, for an escrow the index lacks), for the accounts the page draws as links (`drawnAccounts`: the owner, which the breadcrumb links too, the destination, the issuer of a
// token in the Amount row, and the timeline's senders and what their events did), sorted; each drawn by what the fixtures say of it; no call for an address the page holds but does not link
// (an MPT's issuer, which `MptAmount` does not draw); a failed or a late call leaves the addresses and the page unstored, with one log line.
//
// A file of its own, as the names of the other pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): each test reads
// an escrow, or a view of one, that no other test of the file reads; a test that says a page is not stored starts from a cache that holds none of it (`forgetStored`); and `namesSpec` takes
// the subrequest entries away and moves `Date` past the longest keep after each test, so that none needs another to have run, or not.

const { get, page } = pageClient("198.51.128");
const { upstream } = namesSpec({ advance: 3_700_000 });

const ROUTE = "routes/net.escrows.$id";
const FINISHED = await objectCase("xrpl", "escrow-finished");
const CANCELLABLE = await objectCase("xrpl", "escrow-cancellable");
const TOKEN = await objectCase("xrpl", "escrow-token");
const MPT = await objectCase("xrpl", "escrow-mpt");
const NODE_ONLY = await objectCase("xrpl", "escrow-node-only");
const XAHAU = await objectCase("xahau", "xahau-escrow");
/** The issuer of the MPT escrow's issuance, which its ID encodes (the fixture's amount names it). */
const MPT_ISSUER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

/** The short address as an account link draws it, or the whole one (the Details rows). */
const ADDRESS_TEXT = /^(r[1-9A-HJ-NP-Za-km-z]{24,34}|r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4})$/;

describe("the names call of an escrow of the index", () => {
  it("is one, after the page's calls, for the accounts the page links, sorted, and the page draws each by what the fixtures say", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/escrows/${FINISHED.id}`);

    // The owner (a domain's name in the fixtures), the destination, the token's issuer and the account that finished it.
    const linked = linkedAccounts(html, "xrpl");
    expect(linked).toHaveLength(4);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The escrow and the server state.
    expect(withoutNames(mock.requests)).toHaveLength(2);
    const { named, plain } = await expectAccountsDrawn(html, "xrpl");
    expect(named).toEqual([FINISHED.owner]);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("draws the owner's crumb by its name, as the account page's", async () => {
    upstream("xrpl");
    const { html } = await page(`/xrpl/escrows/${CANCELLABLE.id}`);

    // The owner has a verified name in the fixtures: the crumb is a link to it with the name and its mark, and never its short address.
    const crumbs = /<nav aria-label="Breadcrumb">[\s\S]*?<\/nav>/.exec(html)![0];
    const owner = anchors(crumbs).find((a) => a.attrs.includes(`href="/xrpl/account/${CANCELLABLE.owner}"`));
    expect(owner?.attrs).toContain('class="acct"');
    expect(crumbs).toContain('class="acct__name"');
    expect(owner?.text).not.toContain("…");
    await expectAccountsDrawn(crumbs, "xrpl");
  });

  it("asks exactly what the page links, each named, the token's issuer in its Amount row too", async () => {
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(`/xrpl/escrows/${TOKEN.id}`);

    const asked = namesCalls(mock).flat();
    expect(asked).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("does not ask for an MPT's issuer, which the page does not draw", async () => {
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(`/xrpl/escrows/${MPT.id}`);

    const asked = namesCalls(mock).flat();
    expect(asked).not.toContain(MPT_ISSUER);
    expect(asked).toEqual(sorted(linkedAccounts(html, "xrpl")));
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    const mock = upstream("xrpl");
    const body = await (await get(dataUrlOf(`/xrpl/escrows/${FINISHED.id}.data`, ROUTE))).text();
    const part = namesPartOf(body, ROUTE);

    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", namesCalls(mock).flat())));
    expect(Object.keys(part.map)).toHaveLength(1);
  });

  it("is Xahau's the same way", async () => {
    const mock = upstream("xahau");
    const { html } = await page(`/xahau/escrows/${XAHAU.id}`);

    expect(namesCalls(mock)).toEqual(inCalls(linkedAccounts(html, "xahau")));
    await expectAccountsDrawn(html, "xahau");
  });
});

describe("the names call of an escrow only the node has", () => {
  it("is after the node's entry, for the accounts the page links", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/escrows/${NODE_ONLY.id}`);

    const urls = mock.requests.map((request) => request.url);
    expect(urls.findIndex((url) => url.includes("/v2/account_names"))).toBe(urls.length - 1);
    expect(mock.requests.slice(0, -1).some((request) => request.key.startsWith("node ledger_entry"))).toBe(true);
    expect(namesCalls(mock)).toEqual(inCalls(linkedAccounts(html, "xrpl")));
    await expectAccountsDrawn(html, "xrpl");
  });
});

describe("when the names call fails or is late", () => {
  it("shows the addresses, serves the page and does not store it, and logs it once, when it fails", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `/xrpl/escrows/${FINISHED.id}?case=names-failed`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs));
    expect(links.length).toBeGreaterThan(3);
    for (const link of links) expect(link.text, link.attrs).toMatch(ADDRESS_TEXT);
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get(dataUrlOf(`/xrpl/escrows/${FINISHED.id}.data?case=names-failed`, ROUTE))).text();
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "failed", map: {} });
  });

  it("shows the addresses, serves the page and does not store it, and logs it once, when it is late", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { "GET /v2/account_names": () => new Promise<Response>(() => {}) });
    const path = `/xrpl/escrows/${CANCELLABLE.id}?case=names-late`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    // One call, for the owner, the destination and the account that made it, which never answered.
    expect(namesCalls(mock)).toEqual(inCalls(linkedAccounts(html, "xrpl")));
    expect(html).not.toContain("acct__name");
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs));
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) expect(link.text, link.attrs).toMatch(ADDRESS_TEXT);
    expect(logged()).toBe(1);
  });
});
