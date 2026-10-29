import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import poolInfoOfRlusd from "../fixtures/http/xrpl/node/amm_info/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3.json";
import usdPool from "../fixtures/http/xrpl/node/amm_info/rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am.json";
import { AMM_POOL as POOL, ammPoolAccount } from "../support/amm-samples";
import { decodeLoaderData } from "../support/loader-data";
import { inCalls, issuerTextOf, namesCalls, namesStatuses, shownName, viewOf, watchNamesLog, withoutNames } from "../support/names";
import { anchors, pageClient, tableRows } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// The names of the accounts on an AMM pool's page, `/{net}/amm/{pool}` (display names spec 1 and 5), on the real Worker against the generated AMM answers and the recorded `amm_info`: one
// names call after the ten calls and the mode, for the accounts the page draws, sorted (the pool, the creator, the slot's holder and authorized accounts, the voters, the rows' accounts, and
// the issuers the reserves chart and a swap's title name); the pool, the voters and the issuers written by their names; no call for an address the page does not draw; a failed call
// leaves the addresses and the page unstored; and a page behind a marker.
//
// A file of its own, as the names of the live pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute): each test a
// view of its own, and `cold` takes the subrequest entries away, so that no test needs another to have run, or not. The page does not poll, so no call asks for the failure hold.

const { get, stored, storedAs } = pageClient("198.51.121");

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
  vi.setSystemTime(Date.now() + 301_000);
  expect(unused ?? []).toEqual([]);
});

afterAll(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unavailable = () => dataApiError(503, "unavailable");

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

async function render(path: string) {
  const response = await get(path);
  return { response, html: await response.text() };
}

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

/** The accounts the page draws, read from its data: the pool, the creator, the slot's holder and authorized accounts, the voters, the rows' accounts and the issuers the page names. */
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
    cold();
    mock = mockUpstream("xrpl");
    const data = await dataOf(`/xrpl/amm/${POOL}`);

    // The pool, the slot's holder with its authorized accounts, the eight voters, the takers of the swaps, and the issuer the reserves chart names.
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

  it("draws the pool account by its name with the whole address after it, and each voter by its name and mark, its short address and what it votes for under it", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const { response, html } = await render(`/xrpl/amm/${POOL}`);
    expect(response.status).toBe(200);

    // The pool card: the account link reads its name, then the whole address (`full`).
    expect((await viewOf("xrpl", POOL))?.name, "the fixtures name the pool").toBeDefined();
    const poolLink = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${POOL}"`) && a.text.includes(POOL))!;
    expect(poolLink.text.startsWith(await shownName("xrpl", POOL))).toBe(true);
    expect(poolLink.text).toContain(POOL);

    // The votes: the bars of the node's vote slots, the heaviest first.
    const votes = [...poolInfoOfRlusd.result.amm.vote_slots].sort((a, b) => b.vote_weight - a.vote_weight || (a.account < b.account ? -1 : 1));
    const bars = anchors(html).filter((a) => a.attrs.includes('class="barlist__link"'));
    expect(bars).toHaveLength(votes.length);
    const words = { verified: "verified name", account: "named by GateHub", domain: "not verified" } as const;
    let named = 0;
    for (const [at, vote] of votes.entries()) {
      const view = await viewOf("xrpl", vote.account);
      expect(bars[at]!.attrs, vote.account).toContain(`href="/xrpl/account/${vote.account}"`);
      expect(bars[at]!.text.startsWith(await shownName("xrpl", vote.account)), vote.account).toBe(true);
      if (view?.name) {
        named += 1;
        expect(bars[at]!.text).toContain(words[view.name.kind]);
        expect(bars[at]!.text).not.toContain(shortAddress(vote.account));
        // The short address is under the name, before what the voter votes for.
        expect(html).toContain(`${shortAddress(vote.account)} · votes for`);
      }
    }
    expect(named).toBeGreaterThan(0);
    // The fixtures leave some voters unnamed: those are their short address, and "votes for" alone under it.
    expect(named).toBeLessThan(votes.length);
  });

  it("writes the issuer under the currency of the reserves chart by its name when it is verified or GateHub's, and not in the pool card, which draws the whole address", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const issuer = usdPool.result.amm.amount2.issuer;
    const text = await issuerTextOf("xrpl", issuer);
    expect(text, "the fixtures name the issuer").not.toBe(shortAddress(issuer));
    const { response, html } = await render(`/xrpl/amm/${USD_POOL}`);
    expect(response.status).toBe(200);

    const subs = [...html.matchAll(/<span class="chart__sub">([^<]*)<\/span>/g)].map((match) => match[1]);
    expect(subs).toContain(text);
    expect(subs).not.toContain(shortAddress(issuer));
    // The pool card says "USD issued by" and the whole address, as a link to the account.
    expect(html).toContain(`>${issuer}</a>`);
    // The tags keep the short forms: the title and the description are no place for a name.
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).not.toContain(text);
    expect(/<meta name="description" content="([^"]*)"/.exec(html)?.[1]).not.toContain(text);
  });
});

describe("no address is asked that the page does not draw", () => {
  it("not a swap's buyer or seller", async () => {
    cold();
    const [taker, buyer, seller] = [ammPoolAccount(911), ammPoolAccount(912), ammPoolAccount(913)];
    mock = mockUpstream("xrpl", { [tabKey(POOL, "swaps")]: { count: 1, exchanges: [swap({ taker, buyer, seller })], result: "success" } });
    const data = await dataOf(`/xrpl/amm/${POOL}?period=30d`);
    const asked = namesCalls(mock).flat();

    expect(asked).toContain(taker);
    expect(asked).not.toContain(buyer);
    expect(asked).not.toContain(seller);
    expect([...asked].sort()).toEqual([...drawnOf(data)].sort());
  });

  it("not a deposit's initiator, but a clawback's, which the table draws after 'by'", async () => {
    cold();
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
    mock = mockUpstream("xrpl", { [tabKey(POOL, "liquidity")]: { count: 1, liquidity: [event({})], result: "success" } });
    await render(`/xrpl/amm/${POOL}?tab=liquidity`);
    const deposit = namesCalls(mock).flat();
    expect(deposit).toContain(provider);
    expect(deposit).not.toContain(initiator);

    // A clawback of another account by the initiator: both are drawn. (Another view of the pool: the first was stored.)
    mock.restore();
    mock = mockUpstream("xrpl", { [tabKey(POOL, "liquidity")]: { count: 1, liquidity: [event({ event: "clawback", account: other, tx_index: 3 })], result: "success" } });
    await render(`/xrpl/amm/${POOL}?period=30d&tab=liquidity`);
    expect(namesCalls(mock).flat()).toEqual(expect.arrayContaining([other, initiator]));
  });

  it("not a bid's holder or the authorized accounts it left, but the account that bid", async () => {
    cold();
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
    mock = mockUpstream("xrpl", { [tabKey(POOL, "governance")]: { count: 1, governance: [bid], result: "success" } });
    await render(`/xrpl/amm/${POOL}?tab=governance`);
    const asked = namesCalls(mock).flat();
    expect(asked).toContain(bidder);
    expect(asked).not.toContain(holder);
    expect(asked).not.toContain(authorized);
  });
});

describe("when the names call fails", () => {
  it("serves the page with the addresses, does not store it and marks the data failed", async () => {
    cold();
    const logged = watchNamesLog();
    mock = mockUpstream("xrpl", { "GET /v2/account_names": unavailable() });
    const path = `/xrpl/amm/${USDC_POOL}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
    expect(namesStatuses(mock)).toEqual([503]);
    // The pool account is its address, whole, and no vote bar is a name.
    const poolLink = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${USDC_POOL}"`) && a.text.includes(USDC_POOL))!;
    expect(poolLink.text).toBe(USDC_POOL);
    for (const bar of anchors(html).filter((a) => a.attrs.includes('class="barlist__link"'))) expect(bar.text).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…/);
    expect(html).not.toContain('role="alert"');

    const data = await dataOf(path);
    expect(data.names).toEqual({ state: "failed", map: {} });
    // Logged once for each of the two renders.
    expect(logged()).toBe(2);
  });
});

describe("a page behind a marker", () => {
  it("makes one names call for the pool and the takers of the rows, awaited, and is stored as MARKER_PAGE_CLASS", async () => {
    cold();
    mock = mockUpstream("xrpl");
    const marker = "WzEwNzY5OTY1NiwxNCwzXQ";
    const path = `/xrpl/amm/${POOL}?marker=${marker}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual({ cls: "slow", ttl: 3600 });
    expect(tableRows(html, "Swaps").length).toBeGreaterThan(1);
    // The pool and the takers of the rows (the links of the table); no vote, slot or chart is drawn, and the pool card's issuer link is the whole address, so none is asked for.
    const table = html.slice(html.indexOf('aria-label="Swaps"'));
    const takers = [...table.matchAll(/href="\/xrpl\/account\/(r[1-9A-HJ-NP-Za-km-z]{24,34})"/g)].map((match) => match[1]!);
    expect(takers.length).toBeGreaterThan(0);
    expect(namesCalls(mock)).toEqual(inCalls([...new Set([POOL, ...takers])]));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
  });

  it("is served with the addresses and not stored when the names call fails", async () => {
    cold();
    const logged = watchNamesLog();
    const marker = "EEEE";
    const taker = ammPoolAccount(931);
    mock = mockUpstream("xrpl", {
      [tabKey(POOL, "swaps", marker)]: { count: 1, exchanges: [swap({ taker, buyer: taker, seller: POOL })], result: "success" },
      "GET /v2/account_names": unavailable(),
    });
    const path = `/xrpl/amm/${POOL}?marker=${marker}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await stored(path)).toBeUndefined();
    expect(namesStatuses(mock)).toEqual([503]);
    // The taker is its short address, as before names.
    expect(tableRows(html, "Swaps")[1]!.join(" ")).toContain(shortAddress(taker));
    expect(logged()).toBe(1);
  });
});
