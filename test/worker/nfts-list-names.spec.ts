import { describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { NftSale } from "../../app/server/api-types";
import { collectAddresses } from "../../app/server/names-collect";
import xahauSales from "../fixtures/http/xahau/data-api/nft_sales@descending=true&limit=10.json";
import xrplCollections from "../fixtures/http/xrpl/data-api/nft_collections@limit=20&sort=volume.json";
import xrplMoreSales from "../fixtures/http/xrpl/data-api/nft_sales@descending=true&limit=20.json";
import xrplSales from "../fixtures/http/xrpl/data-api/nft_sales@descending=true&limit=10.json";
import { ammPoolAccount } from "../support/amm-samples";
import {
  dataUrlOf,
  expectAccountsDrawn,
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
import { collectionsMarker, salesMarker } from "../support/nft-cases";
import { expectDegraded, forgetStored, keysOf, unavailable } from "../support/nft-pages";
import { nftSaleSample, nftSalesPageSample } from "../support/nft-samples";
import { anchors, pageClient, textOf } from "../support/pages";

// The names of the accounts on the NFT list, `/{net}/nfts`, and on the older sales, `/{net}/nfts/sales` (display names spec 1 and 5), on the real Worker: one names call after the calls
// the page awaits, for the sellers and buyers of the sales the table draws, sorted; each drawn by what the fixtures say of it; no call for an address the page holds but does not draw
// (a price's issuer, the collections table's issuers: its labels link to collections); a failed call leaves the short addresses and the page unstored, with one log line; and the pages
// behind a marker: the list's is the collections table alone and names nothing, the sales page's is named like its first page.
//
// A file of its own, as the names of the other pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): each test
// has a view of its own, and `namesSpec` takes the subrequest entries away and moves `Date` past the longest keep after each test, so that none needs another to have run, or not.
// The pages do not poll, so no call asks for the failure hold.

const { get, page, storedAs } = pageClient("198.51.122");
const { upstream } = namesSpec({ advance: 3_700_000 });

const LIST = "routes/net.nfts._index";
const SALES = "routes/net.nfts.sales";
/** The sales call of the list's recent sales, and of a page of the older sales (the first). */
const RECENT = "GET /v2/nft_sales?descending=true&limit=10";
const OLDER = "GET /v2/nft_sales?descending=true&limit=20";

/** The sellers and buyers of the sales of an answer, once each, in the order the table draws them. */
const partiesOf = (answer: { sales: unknown[] }) => collectAddresses((answer.sales as unknown as NftSale[]).flatMap((sale) => [sale.seller, sale.buyer]));

describe("the NFT list's names call", () => {
  it("is one, after the calls of the page, for the sellers and buyers of the recent sales sorted, and the table draws each by what the fixtures say", async () => {
    const mock = upstream("xrpl");
    const { html } = await page("/xrpl/nfts");

    const parties = partiesOf(xrplSales);
    expect(parties.length).toBeGreaterThan(5);
    expect(namesCalls(mock)).toEqual(inCalls(parties));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The five calls of the page and the names call: nothing else.
    expect(withoutNames(mock.requests)).toHaveLength(5);

    // Every account the page links is asked for, and every account asked for is linked: the page draws what it names, and names what it draws.
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    // The fixtures name some of the accounts and not others: a name for the first, the short address for the second.
    const { named, plain } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("is the same on Xahau", async () => {
    const mock = upstream("xahau");
    const { html } = await page("/xahau/nfts");

    expect(namesCalls(mock)).toEqual(inCalls(partiesOf(xahauSales)));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    const { named, plain } = await expectAccountsDrawn(html, "xahau");
    expect(named.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("carries the names the call gave in the page's data, for the browser: the accounts the fixtures give something to show", async () => {
    const mock = upstream("xrpl");
    const body = await (await get(dataUrlOf("/xrpl/nfts.data?period=7day", LIST))).text();
    const part = namesPartOf(body, LIST);

    expect(part.state).toBe("ok");
    const asked = namesCalls(mock).flat();
    expect(asked.length).toBeGreaterThan(5);
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", asked)));
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("asks for no address that the page holds and does not draw as an account: not a price's issuer, not the issuers of the collections table", async () => {
    const [seller, buyer, issuer] = [ammPoolAccount(701), ammPoolAccount(702), ammPoolAccount(703)];
    const sale = nftSaleSample({ amount: "420", currency: "USD", amount_issuer: issuer, converted_amount: "96", seller, buyer });
    const mock = upstream("xrpl", { [RECENT]: nftSalesPageSample({ sales: [sale], count: 1 }) });
    const { html } = await page("/xrpl/nfts?sort=supply");

    const asked = namesCalls(mock).flat();
    expect(asked).toEqual(sorted([seller, buyer]));
    expect(asked).not.toContain(issuer);
    // The collections table lists issuers (a link to each collection), which the page does not name: none of its twenty rows is asked for.
    const collections = xrplCollections.collections.map((collection) => collection.issuer);
    expect(collections.length).toBeGreaterThan(5);
    for (const collection of collections) expect(asked, collection).not.toContain(collection);
    expect(linkedAccounts(html, "xrpl")).toEqual([seller, buyer]);
    // The table does link them to their collections.
    expect(anchors(html).filter((a) => a.attrs.includes(`href="/xrpl/nfts/${collections[0]}/`)).length).toBeGreaterThan(0);
  });

  it("makes no call when the recent sales failed: a card that failed has no account to name", async () => {
    watchNamesLog();
    const mock = upstream("xrpl", { [RECENT]: unavailable() });
    const response = await get("/xrpl/nfts?sort=holders");
    expect(textOf(await response.text())).toContain("Couldn’t load the recent sales.");
    expect(namesCalls(mock)).toEqual([]);
  });
});

describe("when the names call fails", () => {
  it("shows the short addresses, serves the page and does not store it, and logs it once", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = "/xrpl/nfts?sort=holders&order=asc";
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    // Every party of a sale is its short address, as before names; the page holds no name.
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs));
    expect(links.map((a) => a.text).length).toBeGreaterThan(5);
    for (const link of links) expect(link.text, link.attrs).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$/);
    for (const party of partiesOf(xrplSales)) expect(links.some((a) => a.text === shortAddress(party))).toBe(true);
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get(dataUrlOf("/xrpl/nfts.data?period=30day", LIST))).text();
    expect(namesPartOf(body, LIST)).toEqual({ state: "failed", map: {} });
  });
});

describe("a page of the list behind a marker", () => {
  it("is the collections table alone: it draws no account and makes no names call, and is stored as the marker pages are", async () => {
    const marker = await collectionsMarker("xrpl");
    const mock = upstream("xrpl");
    const path = `/xrpl/nfts?marker=${marker}`;
    const { html } = await page(path);

    expect(namesCalls(mock)).toEqual([]);
    expect(linkedAccounts(html, "xrpl")).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    const body = await (await get(dataUrlOf(`/xrpl/nfts.data?marker=${marker}`, LIST))).text();
    expect(namesPartOf(body, LIST)).toEqual({ state: "ok", map: {} });
  });
});

describe("the older sales page", () => {
  it("makes one names call, after the sales, for the sellers and buyers of its rows sorted, and draws each by what the fixtures say", async () => {
    const mock = upstream("xrpl");
    const { html } = await page("/xrpl/nfts/sales");

    const parties = partiesOf(xrplMoreSales);
    expect(namesCalls(mock)).toEqual(inCalls(parties));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(keysOf(mock.requests)).toEqual([OLDER]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named, plain } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("asks for no address that the page holds and does not draw as an account: not a price's issuer", async () => {
    const [seller, buyer, issuer] = [ammPoolAccount(711), ammPoolAccount(712), ammPoolAccount(713)];
    const sale = nftSaleSample({ amount: "420", currency: "USD", amount_issuer: issuer, converted_amount: "96", seller, buyer });
    const mock = upstream("xrpl", { [OLDER]: nftSalesPageSample({ sales: [sale], count: 1 }) });
    const { html } = await page("/xrpl/nfts/sales");

    expect(namesCalls(mock)).toEqual([sorted([seller, buyer])]);
    expect(linkedAccounts(html, "xrpl")).toEqual([seller, buyer]);
    // The price is written with its issuer in a title.
    expect(html).toContain(`USD issued by ${issuer}`);
  });

  it("is named on a page behind a marker too, awaited, and stored as the marker pages are", async () => {
    const marker = await salesMarker("xrpl");
    const mock = upstream("xrpl");
    const path = `/xrpl/nfts/sales?marker=${marker}`;
    const { html } = await page(path);

    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    const linked = linkedAccounts(html, "xrpl");
    expect(linked.length).toBeGreaterThan(5);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });

  it("is Xahau's the same way", async () => {
    const mock = upstream("xahau");
    const { html } = await page("/xahau/nfts/sales");
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    expect(namesCalls(mock).flat().length).toBeGreaterThan(5);
  });

  it("is served with the short addresses and not stored when the names call fails, on the first page and behind a marker", async () => {
    const logged = watchNamesLog();
    upstream("xrpl", failingNames());
    const first = "/xrpl/nfts/sales";
    const path = `/xrpl/nfts/sales?marker=${await salesMarker("xrpl")}`;
    // The first page has one URL, and the other tests store it: this one starts from none.
    await forgetStored(first);
    await forgetStored(path);
    const response = await get(first);
    const html = await response.text();
    await expectDegraded(first, response);
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs));
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) expect(link.text, link.attrs).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$/);
    expect(logged()).toBe(1);

    const behind = await get(path);
    expect((await behind.text()).length).toBeGreaterThan(0);
    await expectDegraded(path, behind);
    expect(logged()).toBe(2);

    const body = await (await get(dataUrlOf("/xrpl/nfts/sales.data", SALES))).text();
    expect(namesPartOf(body, SALES)).toEqual({ state: "failed", map: {} });
  });
});
