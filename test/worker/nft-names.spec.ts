import { describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { Nft, NftEvent, NftOffer } from "../../app/server/api-types";
import { ammPoolAccount } from "../support/amm-samples";
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
  viewedAmong,
  watchNamesLog,
  withoutNames,
} from "../support/names";
import { nftCase } from "../support/nft-cases";
import { expectDegraded, forgetStored, keysOf } from "../support/nft-pages";
import { coverageSample, nftAnswerSample, nftEventSample, nftEventsPageSample, nftOfferSample, nftOffersPageSample, nftSample } from "../support/nft-samples";
import { anchors, pageClient, textOf } from "../support/pages";
import type { Overrides } from "../support/upstream";

// The names of the accounts on an NFT's page, `/{net}/nft/{ID}` (display names spec 1 and 5), on the real Worker: one names call after the calls the page awaits (the node's
// too, for an NFT the index lacks or has without an owner), for the owner, the issuer, the minter and the account it went to, the account that burned it, the open offers'
// accounts and destinations and the history's accounts, sorted; each drawn by what the fixtures say of it; no call for an address the page holds but does not draw as an account
// (an amount's issuer, a broker's fee issuer); a failed call leaves the short addresses and the page unstored, with one log line; and a page behind a marker, named the same way.
//
// A file of its own, as the names of the other pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): a test
// that says what a page draws takes an NFT made up for it (its id is new, the index's answers are its own, and the names the data API gives are after the accounts' last four
// characters, so that every account of the page is named); the fixtures' NFTs have a view for each test; a test that says a page is not stored starts from a cache that holds none
// of it (`forgetStored`); and `namesSpec` takes the subrequest entries away and moves `Date` past the longest keep after each test, so that none needs another to have run, or not.

const { get, page, storedAs } = pageClient("198.51.124");
const { upstream } = namesSpec({ advance: 3_700_000 });

const ROUTE = "routes/net.nft.$id";
const FEATURED = await nftCase("xrpl", "featured");
const BURNED = await nftCase("xrpl", "burned");
const UNOWNED = await nftCase("xrpl", "unowned");
const NETWORK = await nftCase("xrpl", "network");
const URI_FEATURED = await nftCase("xahau", "featured");
const MARKER = "WzEwNzg3ODc3NSwxMzAsMF0";

/** The calls of an NFT's page, by the keys the mock names them. */
const callsOf = (id: string) => ({
  NFT: `GET /v2/nfts/${id}`,
  OFFERS: `GET /v2/nfts/${id}/offers?limit=50`,
  HISTORY: `GET /v2/nfts/${id}/history?descending=true&event=mint,burn,modify,sale,transfer&limit=20`,
});

/** The id of an NFT that no fixture has and no other test of this file uses: the index's answers for it are the test's. */
let made = 0;
const fresh = (): string => `${FEATURED.id.slice(0, 62)}${(0xa0 + ++made).toString(16).toUpperCase()}`;

/** The index's answers for an NFT made up for a test: the NFT (the sample, of the featured collection, with the keys `nft` overrides), its open offers and its events. */
function indexAnswers(id: string, { nft = {}, offers = [], events = [] }: { nft?: Partial<Nft>; offers?: NftOffer[]; events?: NftEvent[] } = {}): Overrides {
  const key = callsOf(id);
  return {
    [key.NFT]: nftAnswerSample({ nft: nftSample({ nft_id: id, issuer: FEATURED.issuer, taxon: 0, ...nft }), coverage: coverageSample({ complete: true }) }),
    [key.OFFERS]: nftOffersPageSample({ offers, count: offers.length }),
    [key.HISTORY]: nftEventsPageSample({ events, count: events.length }),
  };
}

describe("the names call of an NFT of the index", () => {
  it("is one, after the page's three calls, for the accounts the page draws sorted, and the page draws each by what the fixtures say", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/nft/${FEATURED.id}`);

    const linked = linkedAccounts(html, "xrpl");
    expect(linked.length).toBeGreaterThan(3);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The NFT, its open offers and its history: the owner is the index's, so the node is not asked.
    expect(withoutNames(mock.requests)).toHaveLength(3);
    const { named, plain } = await expectAccountsDrawn(html, "xrpl");
    expect(named.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("carries the names the call gave in the page's data, for the browser", async () => {
    const mock = upstream("xrpl");
    const body = await (await get(dataUrlOf(`/xrpl/nft/${FEATURED.id}.data`, ROUTE))).text();
    const part = namesPartOf(body, ROUTE);

    expect(part.state).toBe("ok");
    const asked = namesCalls(mock).flat();
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", asked)));
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  it("is for the owner, the issuer, the minter and where the mint went, the offers' accounts and destinations and the history's accounts, and for no other address of the page", async () => {
    const [owner, minter, mintedTo, bidder, seller, destination, from, to, broker, offerIssuer, feeIssuer, saleIssuer] = Array.from({ length: 12 }, (_, i) => ammPoolAccount(741 + i));
    const id = fresh();
    const nft = {
      owner,
      minted: { ledger_index: 107_000_000, tx_hash: "AB".repeat(32), executed_time: "2026-03-14T09:00:00Z", by: minter, to: mintedTo },
      last_sale: { amount: "250", currency: "USD", amount_issuer: saleIssuer, ledger_index: 107_000_001, tx_hash: "CD".repeat(32), executed_time: "2026-10-20T17:01:12Z" },
    } satisfies Partial<Nft>;
    const offers = [
      // a buy offer for an account to sell to: the bidder and the destination
      nftOfferSample({ offer_id: "01".repeat(32), is_sell_offer: false, owner: bidder, destination, currency: "USD", amount_issuer: offerIssuer }),
      // a sell offer open to anyone, and a buy offer with no destination: no account in "Only for"
      nftOfferSample({ offer_id: "02".repeat(32), is_sell_offer: true, owner: seller, destination: undefined }),
      nftOfferSample({ offer_id: "03".repeat(32), is_sell_offer: false, owner: bidder, destination: undefined }),
    ];
    const events = [nftEventSample({ event: "sale", from, to, broker, broker_fee: "3", currency: "USD", amount_issuer: feeIssuer, account: ammPoolAccount(760) })];
    const mock = upstream("xrpl", { ...indexAnswers(id, { nft, offers, events }), "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(`/xrpl/nft/${id}`);

    const drawn = [owner, FEATURED.issuer, minter, mintedTo, bidder, destination, seller, from, to, broker];
    expect(namesCalls(mock)).toEqual(inCalls(drawn));
    expect(linkedAccounts(html, "xrpl").sort()).toEqual(sorted(drawn));
    const asked = namesCalls(mock).flat();
    for (const unshown of [offerIssuer, feeIssuer, saleIssuer, ammPoolAccount(760)]) expect(asked, unshown).not.toContain(unshown);
    // The page draws the price's issuers in titles, not as accounts.
    expect(html).toContain(`USD issued by ${feeIssuer}`);
    expect(html).toContain(`USD issued by ${offerIssuer}`);
    // Each account it draws is drawn by its name: the owner (whole address after it), the issuer in the details and in the id's card, the minter, the account the mint went to, ...
    expectLinkedAccountsNamed(mock, html, "xrpl");
    expect(textOf(html)).not.toContain(shortAddress(owner));
  });

  it("is, for a burned NFT, the account that burned it in place of the owner, and none for open offers: a burned NFT has none", async () => {
    const [burner, issuerOfPrice] = [ammPoolAccount(771), ammPoolAccount(772)];
    const id = fresh();
    const nft = { owner: undefined, owner_since: undefined, burned: true, burned_at: { ledger_index: 107_880_000, tx_hash: "EF".repeat(32), executed_time: "2026-10-25T10:00:00Z", by: burner } } satisfies Partial<Nft>;
    const mock = upstream("xrpl", { ...indexAnswers(id, { nft, offers: [nftOfferSample({ owner: issuerOfPrice })] }), "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(`/xrpl/nft/${id}`);

    const asked = namesCalls(mock).flat();
    expect(asked).toEqual(sorted([burner, FEATURED.issuer]));
    expect(asked).not.toContain(issuerOfPrice);
    expect(linkedAccounts(html, "xrpl").sort()).toEqual(asked);
    expectLinkedAccountsNamed(mock, html, "xrpl");
    expect(textOf(html)).toContain("Burned");
  });

  it("names the burner of the fixtures' burned NFT: every account the page links is asked for", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/nft/${BURNED.id}`);

    // (The burner of this one is also the collection's issuer: one account, in the owner line and in the details.)
    const linked = linkedAccounts(html, "xrpl");
    expect(linked.length).toBeGreaterThan(0);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    await expectAccountsDrawn(html, "xrpl");
  });

  it("is Xahau's the same way", async () => {
    const mock = upstream("xahau");
    const { html } = await page(`/xahau/nft/${URI_FEATURED.id}`);

    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    expect(namesCalls(mock).flat().length).toBeGreaterThan(2);
    const { named } = await expectAccountsDrawn(html, "xahau");
    expect(named.length).toBeGreaterThan(0);
  });
});

describe("the names call of an NFT with the node's answers", () => {
  it("is after the node's, for the owner the node read when the index has none: the owner is drawn by name, with where it was read", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/nft/${UNOWNED.id}`);

    // The node was asked for the owner, and the names call is the last request of the page.
    const urls = mock.requests.map((request) => request.url);
    expect(urls.findIndex((url) => url.includes("/v2/account_names"))).toBe(urls.length - 1);
    expect(mock.requests.slice(0, -1).some((request) => request.kind === "node")).toBe(true);
    const linked = linkedAccounts(html, "xrpl");
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(textOf(html)).toContain("read from the network");
    await expectAccountsDrawn(html, "xrpl");
  });

  it("is for the node's owner, issuer and offers' accounts of an NFT only the node has, with no history", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/nft/${NETWORK.id}`);

    expect(textOf(html)).toContain("Not in the index yet, shown from the network.");
    const linked = linkedAccounts(html, "xrpl");
    expect(linked.length).toBeGreaterThan(1);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    await expectAccountsDrawn(html, "xrpl");
  });
});

describe("when the names call fails", () => {
  it("shows the short addresses, serves the page and does not store it, and logs it once", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `/xrpl/nft/${FEATURED.id}?offers=1`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    // Every account the page links is an address, as before names: the owner whole after "Owner", the rest short.
    expect(expectAddressesOnly(html, "xrpl")).toBeGreaterThan(3);
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get(dataUrlOf(`/xrpl/nft/${FEATURED.id}.data?offers=1`, ROUTE))).text();
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "failed", map: {} });
  });
});

describe("a page behind a marker", () => {
  it("makes one names call after the two it awaits, for the history's accounts alone, and is stored as the marker pages are", async () => {
    const mock = upstream("xrpl");
    const path = `/xrpl/nft/${FEATURED.id}?offers=1&marker=${MARKER}`;
    await forgetStored(path);
    const { html } = await page(path);

    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    // The NFT and the page of the history: then the names. The header card has no owner, the page no details, id's card or offers.
    expect(keysOf(mock.requests)).toHaveLength(2);
    const linked = linkedAccounts(html, "xrpl");
    expect(linked.length).toBeGreaterThan(0);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    await expectAccountsDrawn(html, "xrpl");
  });

  it("is served with the short addresses and not stored when the names call fails", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `/xrpl/nft/${FEATURED.id}?offers=1&marker=${MARKER}`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.text, link.attrs).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$/);
    expect(logged()).toBe(1);
  });
});
