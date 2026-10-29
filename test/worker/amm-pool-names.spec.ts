import { describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import poolInfoOfRlusd from "../fixtures/http/xrpl/node/amm_info/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3.json";
import usdcPool from "../fixtures/http/xrpl/node/amm_info/rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb.json";
import usdPool from "../fixtures/http/xrpl/node/amm_info/rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am.json";
import { AMM_POOL as POOL, ammPoolAccount } from "../support/amm-samples";
import { decodeLoaderData } from "../support/loader-data";
import {
  failingNames,
  inCalls,
  issuerTextOf,
  linkedAccounts,
  MARK_WORDS,
  namesCalls,
  namesSpec,
  namesStatuses,
  shownName,
  viewOf,
  watchNamesLog,
  withoutNames,
} from "../support/names";
import { expectDegraded } from "../support/nft-pages";
import { anchors, pageClient, tableRows, textOf } from "../support/pages";

// The names of the accounts on an AMM pool's page, `/{net}/amm/{pool}` (display names spec 1 and 5), on the real Worker against the generated AMM answers and the recorded `amm_info`: one
// names call after the ten calls and the mode, for the accounts the page draws, sorted (the pool and its issuers, the creator, the slot's holder and authorized accounts, the voters, the
// rows' accounts); the pool, the issuers and the voters written by their names; no call for an address the page does not draw; a failed call leaves the addresses and the page unstored;
// and a page behind a marker.
//
// A file of its own, as the names of the live pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): each test a
// view of its own, and `namesSpec` takes the subrequest entries away, so that no test needs another to have run, or not. The page does not poll, so no call asks for the failure hold.

const { get, page, storedAs } = pageClient("198.51.121");
const { upstream } = namesSpec({ advance: 301_000 });

/** XRP/USD, the 90 days: its issuer (the node's) is named in the fixtures. */
const USD_POOL = "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am";
/** USDC/RLUSD, the 90 days. */
const USDC_POOL = "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb";
const tabKey = (pool: string, tab: "swaps" | "liquidity" | "governance", marker?: string) =>
  `GET /v2/amm/pools/${pool}/${tab}?descending=true&limit=20${marker === undefined ? "" : `&marker=${marker}`}`;

/** A swap of the XRP/RLUSD pool, as the data API writes one. */
const swap = (over: object) => ({
  base_amount: "100",
  base_currency: "524C555344000000000000000000000000000000",
  base_issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
  counter_amount: "50",
  counter_currency: "XRP",
  executed_time: "2026-10-17T12:00:00Z",
  ledger_index: 107_700_000,
  node_index: 1,
  offer_sequence: 1,
  provider: POOL,
  rate: "2",
  tx_hash: "AB".repeat(32),
  tx_index: 1,
  tx_type: "Payment",
  amm_account: POOL,
  ...over,
});

type Ref = { address: string };
interface PoolData {
  header: { account: Ref; created: { by: Ref } | null; issuers: { issuer: Ref }[] };
  slot: { held: { holder: Ref; authorized: Ref[] | null } | null } | null;
  votes: { data: { items: { id: string }[] } | null } | null;
  activity: { list: { state: string; rows?: { taker?: Ref; provider?: Ref; by?: Ref | null; account?: Ref }[] } };
  names: { state: string; map: Record<string, unknown> };
}

/** The page's data, as the browser gets it (the route's `.data` URL). */
async function dataOf(path: string): Promise<PoolData> {
  const [p, q] = path.split("?");
  const body = await (await get(`${p}.data?${q === undefined ? "" : `${q}&`}_routes=routes%2Fnet.amm.%24pool`)).text();
  return (decodeLoaderData(body) as Record<string, { data: PoolData }>)["routes/net.amm.$pool"]!.data;
}

/** The accounts the page draws, read from its data: the pool and its issuers, the creator, the slot's holder and authorized accounts, the voters and the rows' accounts. */
function drawnOf(data: PoolData): string[] {
  const list = data.activity.list;
  const rows = list.state === "ok" ? (list.rows ?? []) : [];
  const accounts = [
    data.header.account.address,
    data.header.created?.by.address,
    data.slot?.held?.holder.address,
    ...(data.slot?.held?.authorized ?? []).map((account) => account.address),
    ...(data.votes?.data?.items ?? []).map((item) => item.id),
    ...rows.flatMap((row) => [row.taker?.address, row.provider?.address, row.by?.address, row.account?.address]),
    ...data.header.issuers.map((line) => line.issuer.address),
  ];
  return [...new Set(accounts.filter((address): address is string => address !== undefined))];
}

describe("the names call of the first page", () => {
  it("is one, after the ten, for the accounts the page draws sorted, and carries the names in the page's data", async () => {
    const mock = upstream("xrpl");
    const data = await dataOf(`/xrpl/amm/${POOL}`);

    // The pool and its issuer, the slot's holder with its authorized accounts, the eight voters and the takers of the swaps.
    const drawn = drawnOf(data);
    expect(drawn.length).toBeGreaterThan(10);
    expect(namesCalls(mock)).toEqual(inCalls(drawn));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    expect(withoutNames(mock.requests)).toHaveLength(10);
    expect(data.names.state).toBe("ok");
    // The pool is named by GateHub in the fixtures, and so are voters: the page's names hold their views.
    expect(Object.keys(data.names.map)).toContain(POOL);
    expect(Object.keys(data.names.map).length).toBeGreaterThan(3);
  });

  it("draws the pool account and the issuer by their names with the whole address after them, and each voter by its name and mark, its short address and what it votes for under it", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/amm/${POOL}`);

    // Every account the page links is asked for, and every account asked for is linked: the page draws what it names, and names what it draws.
    const asked = namesCalls(mock).flat();
    const linked = linkedAccounts(html, "xrpl");
    expect(linked.length).toBeGreaterThan(10);
    expect([...asked].sort()).toEqual([...linked].sort());

    // The pool card: each account link reads its name, then the whole address (`full`).
    expect((await viewOf("xrpl", POOL))?.name, "the fixtures name the pool").toBeDefined();
    const poolLink = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${POOL}"`) && a.text.includes(POOL))!;
    expect(poolLink.text.startsWith(await shownName("xrpl", POOL))).toBe(true);
    expect(poolLink.text).toContain(POOL);
    const issuer = poolInfoOfRlusd.result.amm.amount2.issuer;
    const issuerLink = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${issuer}"`) && a.text.includes(issuer))!;
    expect(issuerLink.text.startsWith(await shownName("xrpl", issuer, { full: true }))).toBe(true);
    expect(textOf(html)).toContain(`RLUSD issued by ${issuerLink.text}`);

    // The votes: the bars of the node's vote slots, the heaviest first.
    const votes = [...poolInfoOfRlusd.result.amm.vote_slots].sort((a, b) => b.vote_weight - a.vote_weight || (a.account < b.account ? -1 : 1));
    const bars = anchors(html).filter((a) => a.attrs.includes('class="barlist__link"'));
    expect(bars).toHaveLength(votes.length);
    let named = 0;
    for (const [at, vote] of votes.entries()) {
      const view = await viewOf("xrpl", vote.account);
      expect(bars[at]!.attrs, vote.account).toContain(`href="/xrpl/account/${vote.account}"`);
      expect(bars[at]!.text.startsWith(await shownName("xrpl", vote.account)), vote.account).toBe(true);
      if (view?.name) {
        named += 1;
        expect(bars[at]!.text).toContain(MARK_WORDS[view.name.kind]);
        expect(bars[at]!.text).not.toContain(shortAddress(vote.account));
        // The short address is under the name, before what the voter votes for.
        expect(html).toContain(`${shortAddress(vote.account)} · votes for`);
      }
    }
    expect(named).toBeGreaterThan(0);
    // The fixtures leave some voters unnamed: those are their short address, and "votes for" alone under it.
    expect(named).toBeLessThan(votes.length);
  });

  it("writes the issuer under the currency of the reserves chart and in the pool card by its name when it is verified or GateHub's", async () => {
    upstream("xrpl");
    const issuer = usdPool.result.amm.amount2.issuer;
    const text = await issuerTextOf("xrpl", issuer);
    expect(text, "the fixtures name the issuer").not.toBe(shortAddress(issuer));
    const { html } = await page(`/xrpl/amm/${USD_POOL}`);

    const subs = [...html.matchAll(/<span class="chart__sub">([^<]*)<\/span>/g)].map((match) => match[1]);
    expect(subs).toContain(text);
    expect(subs).not.toContain(shortAddress(issuer));
    // The pool card says "USD issued by", the name and its mark, and the whole address, in one link to the account.
    const link = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${issuer}"`) && a.text.includes(issuer))!;
    expect(link.text.startsWith(text)).toBe(true);
    expect(link.text).toContain(MARK_WORDS.verified);
    expect(textOf(html)).toContain(`USD issued by ${link.text}`);
    // The tags keep the short forms: the title and the description are no place for a name.
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).not.toContain(text);
    expect(/<meta name="description" content="([^"]*)"/.exec(html)?.[1]).not.toContain(text);
  });
});

describe("no address is asked that the page does not draw", () => {
  it("not a swap's buyer or seller", async () => {
    const [taker, buyer, seller] = [ammPoolAccount(911), ammPoolAccount(912), ammPoolAccount(913)];
    const mock = upstream("xrpl", { [tabKey(POOL, "swaps")]: { count: 1, exchanges: [swap({ taker, buyer, seller })], result: "success" } });
    const data = await dataOf(`/xrpl/amm/${POOL}?period=30d`);
    const asked = namesCalls(mock).flat();

    expect(asked).toContain(taker);
    expect(asked).not.toContain(buyer);
    expect(asked).not.toContain(seller);
    expect([...asked].sort()).toEqual([...drawnOf(data)].sort());
  });

  it("not a deposit's initiator, but a clawback's, which the table draws after 'by'", async () => {
    const [provider, initiator, other] = [ammPoolAccount(901), ammPoolAccount(902), ammPoolAccount(903)];
    const event = (over: object) => ({
      account: provider,
      amm_account: POOL,
      base_amount: "10",
      counter_amount: "20",
      event: "deposit",
      executed_time: "2026-10-17T12:00:00Z",
      initiator,
      ledger_index: 107_700_000,
      lp_tokens: "14.1",
      mode: "two_asset",
      tx_hash: "CD".repeat(32),
      tx_index: 2,
      ...over,
    });
    const first = upstream("xrpl", { [tabKey(POOL, "liquidity")]: { count: 1, liquidity: [event({})], result: "success" } });
    await page(`/xrpl/amm/${POOL}?tab=liquidity`);
    const deposit = namesCalls(first).flat();
    expect(deposit).toContain(provider);
    expect(deposit).not.toContain(initiator);

    // A clawback of another account by the initiator: both are drawn. (Another view of the pool: the first was stored.)
    const second = upstream("xrpl", { [tabKey(POOL, "liquidity")]: { count: 1, liquidity: [event({ event: "clawback", account: other, tx_index: 3 })], result: "success" } });
    await page(`/xrpl/amm/${POOL}?period=30d&tab=liquidity`);
    expect(namesCalls(second).flat()).toEqual(expect.arrayContaining([other, initiator]));
  });

  it("not a bid's holder or the authorized accounts it left, but the account that bid", async () => {
    const [bidder, holder, authorized] = [ammPoolAccount(921), ammPoolAccount(922), ammPoolAccount(923)];
    const bid = {
      account: bidder,
      amm_account: POOL,
      auction_slot: { auth_accounts: [authorized], discounted_fee: 20, expiration: "2026-10-18T12:00:00Z", holder },
      bid_max: "5",
      bid_min: "1",
      executed_time: "2026-10-17T12:00:00Z",
      ledger_index: 107_700_000,
      price_paid: "2.5",
      tx_hash: "EF".repeat(32),
      tx_index: 3,
      type: "bid",
    };
    const mock = upstream("xrpl", { [tabKey(POOL, "governance")]: { count: 1, governance: [bid], result: "success" } });
    await page(`/xrpl/amm/${POOL}?tab=governance`);
    const asked = namesCalls(mock).flat();
    expect(asked).toContain(bidder);
    expect(asked).not.toContain(holder);
    expect(asked).not.toContain(authorized);
  });
});

describe("when the names call fails", () => {
  it("serves the page with the addresses, does not store it and marks the data failed", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `/xrpl/amm/${USDC_POOL}`;
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    // The pool account and the issuers are their addresses, whole, and no vote bar is a name.
    const poolLink = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${USDC_POOL}"`) && a.text.includes(USDC_POOL))!;
    expect(poolLink.text).toBe(USDC_POOL);
    for (const issuer of [usdcPool.result.amm.amount, usdcPool.result.amm.amount2].flatMap((amount) => (typeof amount === "string" ? [] : [amount.issuer]))) {
      expect(anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${issuer}"`) && a.text.includes(issuer))!.text, issuer).toBe(issuer);
    }
    for (const bar of anchors(html).filter((a) => a.attrs.includes('class="barlist__link"'))) expect(bar.text).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…/);
    expect(html).not.toContain('role="alert"');

    const data = await dataOf(path);
    expect(data.names).toEqual({ state: "failed", map: {} });
    // Logged once for each of the two renders.
    expect(logged()).toBe(2);
  });
});

describe("a page behind a marker", () => {
  it("makes one names call for the pool, its issuers and the takers of the rows, awaited, and is stored as MARKER_PAGE_CLASS", async () => {
    const mock = upstream("xrpl");
    const marker = "WzEwNzY5OTY1NiwxNCwzXQ";
    const path = `/xrpl/amm/${POOL}?marker=${marker}`;
    const { html } = await page(path);

    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    expect(tableRows(html, "Swaps").length).toBeGreaterThan(1);
    // Every account the page links, the pool card's two and the table's takers; no vote, slot or chart is drawn.
    const linked = linkedAccounts(html, "xrpl");
    const issuer = poolInfoOfRlusd.result.amm.amount2.issuer;
    expect(linked).toEqual(expect.arrayContaining([POOL, issuer]));
    expect(linked.length).toBeGreaterThan(2);
    expect(namesCalls(mock)).toEqual(inCalls(linked));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
  });

  it("is served with the addresses and not stored when the names call fails", async () => {
    const logged = watchNamesLog();
    const marker = "EEEE";
    const taker = ammPoolAccount(931);
    const mock = upstream("xrpl", {
      [tabKey(POOL, "swaps", marker)]: { count: 1, exchanges: [swap({ taker, buyer: taker, seller: POOL })], result: "success" },
      ...failingNames(),
    });
    const path = `/xrpl/amm/${POOL}?marker=${marker}`;
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    // The taker is its short address, as before names.
    expect(tableRows(html, "Swaps")[1]!.join(" ")).toContain(shortAddress(taker));
    expect(logged()).toBe(1);
  });
});
