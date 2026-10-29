import { describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { AccountAnalyticsPageData } from "../../app/server/account-view";
import { loadAccountPage } from "../support/account-loader";
import {
  failingNames,
  isNamesRequest,
  isTomlRequest,
  issuerTextOf,
  namesCalls,
  namesSpec,
  sorted,
  tomlCalls,
  viewedAmong,
  viewOf,
  watchNamesLog,
} from "../support/names";
import { expectDegraded, forgetStored } from "../support/nft-pages";
import { pageClient, textOf } from "../support/pages";

// The names of the account's Analytics view, `/{net}/account/{address}?tab=analytics` (display names spec 1 and 5; ruling C13), on the real Worker: the header's names
// call (the address and its parent: the view has no holdings) and the toml call of the node's domain, as on the other tabs; then one names call for each card that draws
// accounts (the counterparties, the balances' issuers, the pairs' issuers), inside the card's deadline, and none for the others. The issuer texts are drawn by name where
// the fixtures give a plain one. A names call that fails leaves its card drawn with addresses.
//
// A file of its own, as the names of the other pages are: every lookup of a subrequest entry misses (`namesSpec`'s `cold`), and a test that renders the view starts from a
// cache that holds none of it (`forgetStored`: the view has one URL), so that none needs another to have run, or not.

const { get } = pageClient("198.51.127");
const { upstream } = namesSpec({ advance: 3_700_000 });

const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const PARENT = "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ";
const PATH = `/xrpl/account/${ACTIVE}?tab=analytics`;

// The accounts of the recorded answers of the 30 days' cards (test/fixtures/http/xrpl/data-api/accounts/{ACTIVE}/analytics).
const COUNTERPARTIES = ["rq5QXrArpavMCfE5dRuR3uG55iV1rG8mj", "rEhcqzSi5e1E1GJJ1xfY1cmrRaoePZWkzt"];
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const USD_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";

/**
 * The pairs call of the 30 days, answered with the recorded USD/XRP pair alone, so that the pairs' card asks for its issuer alone and its names call is not the balances'
 * (the recorded pairs have the balances' two issuers, and two calls of the same addresses at once would be one).
 */
const PAIRS = `GET /v2/accounts/${ACTIVE}/analytics/exchanges?limit=6&start=2026-09-18`;
const usdPairOnly = {
  result: "success",
  start: "2026-09-18T00:00:00Z",
  end: "2026-10-18T00:00:00Z",
  total: 1,
  count: 1,
  pairs: [
    {
      base_currency: "USD",
      base_issuer: USD_ISSUER,
      base_volume: "17.846376",
      bought: "7.762317",
      bought_counter: "3.256519",
      count: 10,
      counter_currency: "XRP",
      counter_volume: "7.459324",
      native_volume: "7.459324",
      sold: "10.084059",
      sold_counter: "4.202805",
    },
  ],
};

describe("the analytics view", () => {
  it("asks the header's names (the address and its parent), the node domain's toml, and one names call for each card that draws accounts, and draws the issuers by name", async () => {
    const mock = upstream("xrpl", { [PAIRS]: usdPairOnly });
    await forgetStored(PATH);
    const response = await get(PATH);
    const text = textOf(await response.text());

    expect(response.status).toBe(200);
    expect(namesCalls(mock).sort()).toEqual([sorted([ACTIVE, PARENT]), sorted(COUNTERPARTIES), sorted([LIONS_ISSUER, USD_ISSUER]), [USD_ISSUER]].sort());
    expect(tomlCalls(mock)).toEqual(["northpeak.example"]);
    const toml = mock.requests.findIndex(isTomlRequest);
    const headerCall = mock.requests.findIndex((r) => isNamesRequest(r) && new URL(r.url).searchParams.get("addresses")!.includes(PARENT));
    expect(toml).toBeGreaterThanOrEqual(0);
    expect(toml).toBeLessThan(headerCall);

    // The balances' sublabels and the pairs' issuers are issuer texts: a plain name where the fixtures give one, else the short address.
    const lions = await issuerTextOf("xrpl", LIONS_ISSUER);
    const usd = await issuerTextOf("xrpl", USD_ISSUER);
    expect([lions, usd]).not.toContain(shortAddress(USD_ISSUER));
    expect(text).toContain(`LIONS ${lions}`);
    expect(text).toContain(`USD ${usd}`);
    expect(text).not.toContain(shortAddress(LIONS_ISSUER));
    expect(text).not.toContain("Couldn’t load");
  });

  it("hands the page the header's name with what the toml says, as the other tabs do, the header's names and each card's own", async () => {
    upstream("xrpl");
    const { data, marks } = await loadAccountPage<AccountAnalyticsPageData>(PATH);
    const [counterparties, balances, pairs] = await Promise.all([data.analytics.counterparties, data.analytics.balances, data.analytics.pairs]);

    const view = (await viewOf("xrpl", ACTIVE))!;
    expect(data.header.name?.title).toEqual({ text: view.name!.text, kind: "verified" });
    expect(data.header.name?.domainLine).toMatchObject({ text: "northpeak.example", state: "verified" });
    expect(data.header.name?.howWeKnow?.checked).toBeDefined();
    expect(Object.keys(data.names.map).sort()).toEqual(await viewedAmong("xrpl", sorted([ACTIVE, PARENT])));

    if (counterparties.state !== "ok" || balances.state !== "ok" || pairs.state !== "ok") throw new Error("a card is not there");
    expect(counterparties.names.state).toBe("ok");
    expect(Object.keys(counterparties.names.map).sort()).toEqual(await viewedAmong("xrpl", sorted(COUNTERPARTIES)));
    expect(Object.keys(balances.names.map).sort()).toEqual(await viewedAmong("xrpl", sorted([LIONS_ISSUER, USD_ISSUER])));
    expect(Object.keys(pairs.names.map).sort()).toEqual(await viewedAmong("xrpl", sorted([LIONS_ISSUER, USD_ISSUER])));
    expect(marks).toEqual([]);
  });

  it("draws every card with addresses when the names calls fail, and is served and not stored, a log line for each call", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", { ...failingNames(), [PAIRS]: usdPairOnly });
    await forgetStored(PATH);
    const response = await get(PATH);
    const text = textOf(await response.text());

    await expectDegraded(PATH, response);
    expect(namesCalls(mock)).toHaveLength(4);
    expect(text).toContain(`LIONS ${shortAddress(LIONS_ISSUER)}`);
    expect(text).toContain(`USD ${shortAddress(USD_ISSUER)}`);
    expect(text).not.toContain("Couldn’t load");
    expect(text).not.toContain("Still working");
    expect(logged()).toBe(4);
  });

  it("makes no names or toml call with NAMES off", async () => {
    const mock = upstream("xrpl");
    const { data } = await loadAccountPage<AccountAnalyticsPageData>(PATH, { NAMES: "off" });
    const cards = await Promise.all([data.analytics.counterparties, data.analytics.balances, data.analytics.pairs]);

    expect(mock.requests.filter((request) => isNamesRequest(request) || isTomlRequest(request))).toEqual([]);
    expect(data.header.name).toBeNull();
    for (const card of cards) expect(card).toMatchObject({ state: "ok", names: { state: "off", map: {} } });
  });
});
