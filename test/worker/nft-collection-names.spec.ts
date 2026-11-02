import { describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { NftHolder, NftSale } from "../../app/server/api-types";
import { collectAddresses } from "../../app/server/names-collect";
import xrplHolders from "../fixtures/http/xrpl/data-api/nft_collections/rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy/0/holders@limit=20.json";
import xrplSales from "../fixtures/http/xrpl/data-api/nft_collections/rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy/0/sales@descending=true&limit=20.json";
import xrplNfts from "../fixtures/http/xrpl/data-api/nft_collections/rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy/0/nfts@limit=20.json";
import xahauSales from "../fixtures/http/xahau/data-api/nft_collections/rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb/sales@descending=true&limit=20.json";
import { ammPoolAccount } from "../support/amm-samples";
import {
  dataUrlOf,
  expectAccountsDrawn,
  failingNames,
  inCalls,
  linkedAccounts,
  linksTo,
  MARK_WORDS,
  namesCalls,
  namesPartOf,
  namesSpec,
  namesStatuses,
  shownName,
  sorted,
  viewedAmong,
  viewOf,
  watchNamesLog,
  withoutNames,
} from "../support/names";
import { collectionCase, salesMarker } from "../support/nft-cases";
import { expectDegraded, forgetStored, keysOf } from "../support/nft-pages";
import { nftSample, nftsPageSample } from "../support/nft-samples";
import { anchors, pageClient, textOf } from "../support/pages";

// The names of the accounts on a collection's page, `/{net}/nfts/{issuer}[/{taxon}]` (display names spec 1 and 5), on the real Worker: one names call after the calls the page awaits,
// for the header's issuer and the rows of the tab (a sale's seller and buyer, an NFT's owner, a holder), sorted; each drawn by what the fixtures say of it; no call for an address the
// page holds but does not draw (a burned NFT's owner, the price's issuer); a failed call leaves the short addresses and the page unstored, with one log line; and a page behind a
// marker, named the same way, awaited.
//
// A file of its own, as the names of the other pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): each test
// has a view of its own where it can (`measure` and `tab` tell the views apart), a test that says a page is not stored starts from a cache that holds none of it (`forgetStored`),
// and `namesSpec` takes the subrequest entries away and moves `Date` past the longest keep after each test, so that none needs another to have run, or not.

const { get, page, storedAs } = pageClient("198.51.123");
const { upstream } = namesSpec({ advance: 3_700_000 });

const ROUTE = "routes/net.nfts.$issuer.$taxon";

const FEATURED = await collectionCase("xrpl", "featured");
/** The XRPL collection whose issuer the fixtures name (GateHub's name). */
const OTHER = await collectionCase("xrpl", "other");
const URI_FEATURED = await collectionCase("xahau", "featured");
const KEY = `${FEATURED.issuer}/${FEATURED.taxon}`;
const PATH = `/xrpl/nfts/${KEY}`;
const OTHER_PATH = `/xrpl/nfts/${OTHER.issuer}/${OTHER.taxon}`;
const URI_PATH = `/xahau/nfts/${URI_FEATURED.issuer}`;
const OWNER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

/** The calls of the first page, by the keys the mock names them (its query sorted by name). */
const SALES_CALL = `GET /v2/nft_collections/${KEY}/sales?descending=true&limit=20`;
const NFTS_CALL = `GET /v2/nft_collections/${KEY}/nfts?limit=20`;

const parties = (sales: unknown[]) => collectAddresses((sales as NftSale[]).flatMap((sale) => [sale.seller, sale.buyer]));
const ownersOf = (nfts: Array<{ owner?: string; burned: boolean }>) => collectAddresses(nfts.flatMap((nft) => (nft.burned ? [] : [nft.owner])));

describe("the Sales tab's names call", () => {
  it("is one, after the page's calls, for the header's issuer and the sellers and buyers of the rows sorted, and the page draws each by what the fixtures say", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(PATH);

    const drawn = collectAddresses([FEATURED.issuer, ...parties(xrplSales.sales)]);
    expect(namesCalls(mock)).toEqual(inCalls(drawn));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The collection, the newest ledger, the 30 days and the tab's rows: nothing else.
    expect(withoutNames(mock.requests)).toHaveLength(4);

    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named, plain } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
    expect(plain).toContain(FEATURED.issuer);
  });

  it("draws the issuer of the header by its name and mark, with the whole address after them, when the fixtures name it", async () => {
    upstream("xrpl");
    const { html } = await page(OTHER_PATH);

    const view = await viewOf("xrpl", OTHER.issuer);
    expect(view?.name, "the fixtures name the issuer").toBeDefined();
    const link = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${OTHER.issuer}"`) && a.text.includes(OTHER.issuer))!;
    expect(link.text.startsWith(await shownName("xrpl", OTHER.issuer))).toBe(true);
    expect(link.text).toContain(OTHER.issuer);
    expect(link.text).toContain(MARK_WORDS[view!.name!.kind]);
    expect(link.text).not.toContain(shortAddress(OTHER.issuer));
    // The title and the description keep the short issuer (display names spec 7).
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toContain(shortAddress(OTHER.issuer));
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).not.toContain(view!.name!.text);
  });

  it("is Xahau's the same way, the issuer named too", async () => {
    const mock = upstream("xahau");
    const { html } = await page(URI_PATH);

    expect(namesCalls(mock)).toEqual(inCalls(collectAddresses([URI_FEATURED.issuer, ...parties(xahauSales.sales)])));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    const { named } = await expectAccountsDrawn(html, "xahau");
    expect(named).toContain(URI_FEATURED.issuer);
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    const mock = upstream("xrpl");
    const body = await (await get(dataUrlOf(`${PATH}.data?measure=sales`, ROUTE))).text();
    const part = namesPartOf(body, ROUTE);

    expect(part.state).toBe("ok");
    const asked = namesCalls(mock).flat();
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", asked)));
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("asks for no address that the page holds and does not draw as an account: not the price's issuer", async () => {
    const [seller, buyer, issuer] = [ammPoolAccount(721), ammPoolAccount(722), ammPoolAccount(723)];
    const sale = { ...xrplSales.sales[0]!, seller, buyer, amount: "420", currency: "USD", amount_issuer: issuer, converted_amount: "96" };
    const mock = upstream("xrpl", { [SALES_CALL]: { ...xrplSales, sales: [sale], count: 1 } });
    const { html } = await page(`${PATH}?measure=avg`);

    const asked = namesCalls(mock).flat();
    expect(asked).toEqual(sorted([FEATURED.issuer, seller, buyer]));
    expect(asked).not.toContain(issuer);
    expect(linkedAccounts(html, "xrpl").sort()).toEqual(sorted([FEATURED.issuer, seller, buyer]));
  });
});

describe("the NFTs tab's names call", () => {
  it("is for the owners of the NFTs the table draws, with the header's issuer, and every account asked is linked", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`${PATH}?tab=nfts`);

    const drawn = collectAddresses([FEATURED.issuer, ...ownersOf(xrplNfts.nfts)]);
    expect(namesCalls(mock)).toEqual(inCalls(drawn));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });

  it("asks for the owner of no NFT that the table tags 'burned' or leaves a dash for, nor for the price issuer of a last sale", async () => {
    const [owned, burnedOwner, issuer] = [ammPoolAccount(731), ammPoolAccount(732), ammPoolAccount(733)];
    const of = { issuer: FEATURED.issuer, taxon: FEATURED.taxon };
    const nfts = [
      nftSample({ ...of, nft_id: "AA".repeat(32), owner: owned, last_sale: { amount: "5", currency: "USD", amount_issuer: issuer, ledger_index: 1, tx_hash: "AB".repeat(32), executed_time: "2026-10-24T16:08:12Z" } }),
      nftSample({ ...of, nft_id: "BB".repeat(32), owner: burnedOwner, burned: true }),
      nftSample({ ...of, nft_id: "CC".repeat(32), owner: undefined }),
    ];
    const mock = upstream("xrpl", { [NFTS_CALL]: nftsPageSample({ nfts, count: 3, marker: undefined }) });
    const { html } = await page(`${PATH}?measure=low&tab=nfts`);

    const asked = namesCalls(mock).flat();
    expect(asked).toEqual(sorted([FEATURED.issuer, owned]));
    expect(asked).not.toContain(burnedOwner);
    expect(asked).not.toContain(issuer);
    expect(textOf(html)).toContain("burned");
    expect(linkedAccounts(html, "xrpl").sort()).toEqual(sorted([FEATURED.issuer, owned]));
  });

  it("is for the one owner an owner filter lists, whom its rows link; the text in the filter is no link", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`${PATH}?tab=nfts&owner=${OWNER}`);

    expect(namesCalls(mock)).toEqual(inCalls([FEATURED.issuer, OWNER]));
    expect(linkedAccounts(html, "xrpl").sort()).toEqual(sorted([FEATURED.issuer, OWNER]));
    expect(linksTo(html, "xrpl", OWNER).length).toBeGreaterThan(0);
  });
});

describe("the Holders tab's names call", () => {
  it("is for the holders the table draws, with the header's issuer, and every account asked is linked", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`${PATH}?tab=holders`);

    const holders = collectAddresses((xrplHolders.holders as NftHolder[]).map((holder) => holder.owner));
    expect(namesCalls(mock)).toEqual(inCalls(collectAddresses([FEATURED.issuer, ...holders])));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });
});

describe("when the names call fails", () => {
  it("shows the short addresses and the whole issuer, serves the page and does not store it, and logs it once", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `${PATH}?measure=low`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    // The header's issuer is its whole address, and every party of a sale its short address, as before names.
    const issuer = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${FEATURED.issuer}"`) && a.text.includes(FEATURED.issuer))!;
    expect(issuer.text).toBe(FEATURED.issuer);
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs) && !a.text.includes(FEATURED.issuer));
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) expect(link.text, link.attrs).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$/);
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get(dataUrlOf(`${PATH}.data?measure=avg`, ROUTE))).text();
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "failed", map: {} });
  });
});

describe("a page behind a marker", () => {
  it("makes one names call after the two it awaits, for the header's issuer and the rows, and is stored as the marker pages are", async () => {
    const marker = await salesMarker("xrpl");
    const mock = upstream("xrpl");
    const path = `${PATH}?marker=${marker}`;
    await forgetStored(path);
    const { html } = await page(path);

    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    // The collection and the page of sales: then the names.
    expect(keysOf(mock.requests)).toHaveLength(2);
    const linked = linkedAccounts(html, "xrpl");
    expect(linked).toContain(FEATURED.issuer);
    expect(linked.length).toBeGreaterThan(1);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
  });

  it("is served with the short addresses and not stored when the names call fails", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `${PATH}?marker=${await salesMarker("xrpl")}`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    const issuer = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${FEATURED.issuer}"`) && a.text.includes(FEATURED.issuer))!;
    expect(issuer.text).toBe(FEATURED.issuer);
    expect(logged()).toBe(1);
  });
});
