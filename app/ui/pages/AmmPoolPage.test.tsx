import { readFileSync } from "node:fs";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AMM_ACCOUNT,
  AMM_HOLDER,
  AMM_ISSUER,
  AMM_LP_CURRENCY,
  AMM_MARKER,
  AMM_OTHER,
  AMM_POOL,
  AMM_TX_HASH,
  ammBidSample,
  ammDaySample,
  ammLiquiditySample,
  ammPoolSample,
  ammSwapSample,
  ammVoteSample,
} from "../../../test/support/amm-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { valueImports } from "../../../test/support/value-imports";
import { ammPoolHref, type AmmPoolQuery } from "../../domain/amm-params";
import type { Asset } from "../../domain/asset";
import { shortAddress, shortHash } from "../../domain/format";
import { marketHref } from "../../domain/market-pair";
import { ammHistoryPage, ammPoolPage, type AmmHistoryPageData, type AmmPoolInput, type AmmPoolPageData } from "../../server/amm-view";
import type {
  AmmGovernanceRow,
  AmmLiquidityEvent,
  AmmPool,
  AmmPoolDay,
  AmmSwap,
  AmmVolumeComponent,
  AmmVolumeRow,
  Candle,
  LastValidated,
  Page,
} from "../../server/api-types";
import type { AmmInfo } from "../../server/node-rpc";
import { UpstreamError } from "../../server/upstream";
import { NO_FEATURES } from "../features";
import { AmmPoolPage } from "./AmmPoolPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---- The world of the tests: XRP / RLUSD, stored RLUSD / XRP; T is Oct 17, 2026, the period 90 days --------------------------------------------------

const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD = "524C555344000000000000000000000000000000";
const rlusd: Asset = { currency: RLUSD, issuer: RL };
const xrp: Asset = { currency: "XRP" };
const POOL_PAGE = `/xrpl/amm/${AMM_POOL}`;
/** Oct 18, 2026, 09:00 UTC: the end of the held slot. */
const EXPIRATION = Date.parse("2026-10-18T09:00:00Z") / 1000;

const NET = (markets = true): AmmPoolInput["net"] => ({ id: "xrpl", name: "XRPL", native: "XRP", features: { ...NO_FEATURES, ammPages: true, markets } });
const QUERY: AmmPoolQuery = { period: "90d", tab: "swaps", back: [] };

const fulfilled = <T,>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });
const serverError = () => new UpstreamError("server", "data API answered 503", { status: 503 });
const notFound = (message: string) => new UpstreamError("not_found", message, { status: 404 });

const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
  parent_hash: "5FA71FCC25A865DA7569108807E031AFB3E1CD03A8CE078BC1AA534C8E546BE8",
  close_time: "2026-10-17T17:01:12Z",
};

/** The index's XRP / RLUSD, stored RLUSD / XRP. */
const indexPool = (over: Partial<AmmPool> = {}): AmmPool =>
  ammPoolSample({
    base_currency: RLUSD,
    base_issuer: RL,
    counter_currency: "XRP",
    reserve_base: "2400000",
    reserve_counter: "1800000",
    lp_supply: "1790000000",
    trading_fee: 205,
    value_native: "3612345.5",
    last_ledger: 107717584,
    ...over,
  });

const voteSlot = (account: string, trading_fee: number, vote_weight: number) => ({ account, trading_fee, vote_weight });

/** The node's XRP / RLUSD: a fee of 0.300% from three votes, a slot held in its interval 12 until Oct 18, 2026, 09:00 UTC, no authorized account. */
function poolInfo(over: Partial<AmmInfo> = {}): AmmInfo {
  return {
    account: AMM_POOL,
    amount: { currency: "XRP", value: "1847691.034536" },
    amount2: { currency: RLUSD, issuer: RL, value: "2417282.053464318" },
    lp_token: { currency: AMM_LP_CURRENCY, issuer: AMM_POOL, value: "1791055986.845366" },
    trading_fee: 300,
    vote_slots: [voteSlot(AMM_HOLDER, 300, 50000), voteSlot(AMM_ACCOUNT, 250, 30000), voteSlot(AMM_OTHER, 400, 20000)],
    auction_slot: {
      account: AMM_HOLDER,
      auth_accounts: [],
      discounted_fee: 22,
      expiration: EXPIRATION,
      price: { currency: AMM_LP_CURRENCY, issuer: AMM_POOL, value: "100" },
      time_interval: 12,
    },
    ledger_index: 107721455,
    ...over,
  };
}

/** A day of the pool as the API stores it, RLUSD / XRP. */
const poolDay = (date: string, over: Partial<AmmPoolDay> = {}): AmmPoolDay =>
  ammDaySample({
    date: `${date}T00:00:00Z`,
    base_currency: RLUSD,
    base_issuer: RL,
    counter_currency: "XRP",
    swap_count: 3,
    fees_base_est: "1.5",
    fees_counter_est: "2.5",
    reserve_base: "2400000",
    reserve_counter: "1850000",
    trading_fee: 205,
    value_native: "3700000",
    ...over,
  });

/** A candle of the pair in the pool's stored order, RLUSD / XRP. */
const poolCandle = (start: string): Candle => ({
  base_volume: "1300",
  buy_volume: 650,
  close: "1.3",
  close_time: `${start}T21:00:00Z`,
  count: 4,
  counter_volume: "1000",
  high: "1.3",
  low: "1.3",
  open: "1.3",
  open_time: `${start}T01:00:00Z`,
  start: `${start}T00:00:00Z`,
  vwap: "1.3",
  base_currency: RLUSD,
  base_issuer: RL,
  counter_currency: "XRP",
});

const daysPage = (days: AmmPoolDay[]): Page<"days", AmmPoolDay> => ({ result: "success", count: days.length, days });
const candlesPage = (exchanges: Candle[]): Page<"exchanges", Candle> => ({ result: "success", count: exchanges.length, exchanges });

const component = (): AmmVolumeComponent => ({ amm_account: AMM_POOL, base: rlusd, counter: xrp, count: 61, amount: "708895.8293", rate: "1.3059729", converted_amount: "542810.5" });
const liveOf = (components: AmmVolumeComponent[]): Page<"rows", AmmVolumeRow> => ({
  result: "success",
  count: 1,
  rows: [{ components, count: 1284, exchange: { currency: "XRP" }, total: "893025.375", exchange_rate: "1.0000000", start_time: "2026-10-16T17:01:00Z", end_time: "2026-10-17T17:01:00Z" }],
});

/** The pool's creation, Mar 22, 2024, by AMM_ACCOUNT. */
const createEvent = (): AmmLiquidityEvent => {
  const { mode: _mode, ...event } = ammLiquiditySample({ event: "create", executed_time: "2024-03-22T10:15:20Z", ledger_index: 86_800_123, tx_index: 5 });
  return event;
};

/** A swap of the pool in its stored pair, RLUSD / XRP: the pool paid out 1,250 RLUSD for 512.4 XRP. */
const rlusdSwap = (over: Partial<AmmSwap> = {}): AmmSwap => ammSwapSample({ base_currency: RLUSD, base_issuer: RL, base_amount: "1250", counter_amount: "512.4", ...over });
const swapsPage = (exchanges: AmmSwap[] = [rlusdSwap()], marker: string | null = AMM_MARKER): Page<"exchanges", AmmSwap> => ({
  result: "success",
  count: exchanges.length,
  ...(marker === null ? {} : { marker }),
  exchanges,
});

/** A first page of XRP / RLUSD at 90 days, everything answering. */
function poolInput(over: Partial<AmmPoolInput> = {}): AmmPoolInput {
  return {
    net: NET(),
    pool: AMM_POOL,
    query: QUERY,
    mode: "indexed",
    index: indexPool(),
    node: fulfilled(poolInfo()),
    last: fulfilled(LAST),
    days: fulfilled(daysPage([poolDay("2026-08-01"), poolDay("2026-10-16")])),
    carryIn: fulfilled(daysPage([poolDay("2026-07-01")])),
    lastDay: fulfilled(daysPage([poolDay("2026-10-16", { fees_counter_est: "12.5", fees_base_est: "30.1" })])),
    candles: fulfilled(candlesPage([poolCandle("2026-10-16")])),
    activity: fulfilled(swapsPage()),
    created: fulfilled({ result: "success", count: 1, liquidity: [createEvent()] }),
    live: fulfilled(liveOf([component()])),
    ...over,
  };
}

/** The page data, as the loader hands it to the page: the view builder's output of the input. */
const build = (over: Partial<AmmPoolInput> = {}): AmmPoolPageData => ammPoolPage(poolInput(over)).page;

/** A page of the swaps behind a marker. */
const history = (over: Partial<Parameters<typeof ammHistoryPage>[0]> = {}): AmmHistoryPageData =>
  ammHistoryPage({ net: NET(), pool: AMM_POOL, query: { ...QUERY, marker: "M1", back: [] }, index: indexPool(), activity: swapsPage(), ...over });

/** The page in a data router at its own URL, drawn in the browser. `loader` counts the revalidations a Retry asks for. */
function mount(data: AmmPoolPageData | AmmHistoryPageData, at = POOL_PAGE) {
  const loader = vi.fn(() => null);
  const router = createMemoryRouter([{ id: "pool", path: "*", element: <AmmPoolPage data={data} />, loader }], {
    initialEntries: [at],
    hydrationData: { loaderData: { pool: null } },
  });
  return { router, loader, ...render(<RouterProvider router={router} />) };
}

const routed = (ui: ReactElement, at = POOL_PAGE) => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [at] })} />;

/** A file of app/ui, by its path from this one. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = () => read("../pages.css").replace(/\/\*[\s\S]*?\*\//g, "");
const ruleOf = (selector: string): string | undefined => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css())?.[1];
};

const region = (name: string) => screen.getByRole("region", { name });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");
const CHART_TITLES = ["Pool value, in XRP", "Swap volume per day, in XRP", "Pool price, RLUSD per XRP", "Trading fee", "Reserves"];

// ---- The head ------------------------------------------------------------------------------------------------------------------------------------

describe("AmmPoolPage: the breadcrumb and the pool card", () => {
  it("has the breadcrumb XRPL / AMM pools / XRP/RLUSD, the last item the page", () => {
    mount(build());
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["XRPL", "/xrpl"],
      ["AMM pools", "/xrpl/amm"],
    ]);
    const last = within(nav).getByText("XRP/RLUSD");
    expect(last.getAttribute("aria-current")).toBe("page");
    expect(last.tagName).not.toBe("A");
    expect(nav.textContent).toBe("XRPL/AMM pools/XRP/RLUSD");
  });

  it("is a section named Pool with the coins hidden, the h1 in the natural orientation and the market link", () => {
    const { container } = mount(build());
    const card = region("Pool");
    expect(within(card).getByRole("heading", { level: 1 }).textContent).toBe("XRP / RLUSD pool");
    const coins = container.querySelector(".amm-pool__coins")!;
    expect(coins.getAttribute("aria-hidden")).toBe("true");
    expect([...coins.children].map((coin) => coin.textContent)).toEqual(["XRP", "RLU"]);
    expect(within(card).getByRole("link", { name: "Market →" }).getAttribute("href")).toBe(marketHref("xrpl", xrp, rlusd));
  });

  it("shows Market → in the header's soon style, not as a link, while the markets pages are off", () => {
    mount(build({ net: NET(false) }));
    const card = region("Pool");
    expect(within(card).queryByRole("link", { name: /Market/ })).toBeNull();
    const soon = within(card).getByText("Market →").closest(".nav-item")!;
    expect(soon.classList.contains("is-soon")).toBe(true);
    expect(soon.getAttribute("aria-disabled")).toBe("true");
    expect(soon.querySelector(".soon")!.textContent).toBe("soon");
  });

  it("links the pool account, in full, to its account page, with a 44 px copy button that copies it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    mount(build());
    const card = region("Pool");
    const link = within(card).getByRole("link", { name: AMM_POOL });
    expect(link.getAttribute("href")).toBe(`/xrpl/account/${AMM_POOL}`);
    expect(link.closest(".amm-pool__fact")!.textContent).toBe(`Pool account ${AMM_POOL}`);
    const copy = within(card).getByRole("button", { name: "Copy pool account" });
    expect(copy.classList.contains("copy")).toBe(true);
    await act(async () => void fireEvent.click(copy));
    expect(writeText).toHaveBeenCalledWith(AMM_POOL);
    // The house target size (spec 3.1's deviation from the board's 30 px), for the page's copy buttons.
    const rule = ruleOf(".amm-pool .copy");
    expect(rule).toMatch(/min-width:\s*44px/);
    expect(rule).toMatch(/min-height:\s*44px/);
  });

  it("says who issues each issued side, the issuer in full as a link, and when and by whom the pool was created", () => {
    mount(build());
    const card = region("Pool");
    const issuer = within(card).getByRole("link", { name: RL });
    expect(issuer.getAttribute("href")).toBe(`/xrpl/account/${RL}`);
    expect(issuer.closest(".amm-pool__fact")!.textContent).toBe(`RLUSD issued by ${RL}`);
    const created = within(card).getByRole("link", { name: "2024-03-22" });
    expect(created.getAttribute("href")).toBe(`/xrpl/tx/${AMM_TX_HASH}`);
    const fact = created.closest(".amm-pool__fact")!;
    expect(fact.textContent).toBe(`Created 2024-03-22 by ${shortAddress(AMM_ACCOUNT)}`);
    expect(within(fact as HTMLElement).getByRole("link", { name: shortAddress(AMM_ACCOUNT) }).getAttribute("href")).toBe(`/xrpl/account/${AMM_ACCOUNT}`);
  });

  it("leaves the Created line out when the index has no creation event", () => {
    mount(build({ created: rejected(serverError()) }));
    expect(within(region("Pool")).queryByText(/Created/)).toBeNull();
  });

  it("shows the LP token short, with a copy button for the whole code", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    mount(build());
    const card = region("Pool");
    const short = within(card).getByText(shortHash(AMM_LP_CURRENCY));
    expect(short.closest(".amm-pool__fact")!.textContent).toBe(`LP token ${shortHash(AMM_LP_CURRENCY)}`);
    expect(short.getAttribute("title")).toBe(AMM_LP_CURRENCY);
    await act(async () => void fireEvent.click(within(card).getByRole("button", { name: "Copy LP token" })));
    expect(writeText).toHaveBeenCalledWith(AMM_LP_CURRENCY);
  });
});

// ---- The modes ---------------------------------------------------------------------------------------------------------------------------------------

describe("AmmPoolPage: the notices of the modes (spec 3.3)", () => {
  const notices = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".notice")].filter((notice) => !notice.classList.contains("notice--error"));

  it("has none for a pool the index and the node both have", () => {
    const { container } = mount(build());
    expect(notices(container)).toEqual([]);
  });

  it("says the node did not answer with E3's LiveStateNotice, its title and Retry and no role; the state from the index, the votes failed", async () => {
    const { container, loader } = mount(build({ mode: "node-down", node: rejected(serverError()) }));
    const [notice] = notices(container);
    expect(notice!.querySelector(".notice__title")!.textContent).toBe("Live state unavailable; shown from the index");
    expect(notice!.textContent).toContain("The network node did not answer, so the reserves, LP tokens, fee and auction slot are from the explorer’s index");
    expect(notice!.hasAttribute("role")).toBe(false);
    expect(notice!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(region("Pool state")).getByText(/From the index, ledger/).textContent).toBe("From the index, ledger #107,717,584");
    expect(within(region("Fee votes")).getByRole("alert").textContent).toContain("Couldn’t load the fee votes.");
    // The page has no live region of its own: the kit's (the copy buttons' status, the votes' alert) are the only ones.
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    await act(async () => void fireEvent.click(within(notice!).getByRole("button", { name: "Retry" })));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("says the network no longer has the pool, with the state from the index and no slot or votes", () => {
    const { container } = mount(build({ mode: "gone", node: rejected(notFound("node amm_info: actNotFound")) }));
    const [notice] = notices(container);
    expect(notice!.textContent).toBe("The network no longer has this pool; the index may not have seen its deletion yet.");
    expect(notice!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(region("Pool state")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Auction slot" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Fee votes" })).toBeNull();
  });

  it("is a deleted pool's page: the banner with its last ledger linked, the charts and the activity, and no state, slot or votes", () => {
    const { container } = mount(build({ mode: "deleted", index: indexPool({ deleted: true }) }));
    const [notice] = notices(container);
    expect(notice!.textContent).toBe("This pool was deleted. The last ledger that touched it is #107,717,584");
    expect(within(notice!).getByRole("link", { name: "#107,717,584" }).getAttribute("href")).toBe("/xrpl/ledger/107717584");
    expect(notice!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("region", { name: "Pool state" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Auction slot" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Fee votes" })).toBeNull();
    for (const title of CHART_TITLES) expect(region(title)).toBeTruthy();
    expect(region("Pool activity")).toBeTruthy();
  });

  it("says a pool not in the index yet is shown from the network", () => {
    const { container } = mount(build({ mode: "network", index: null }));
    const [notice] = notices(container);
    expect(notice!.classList.contains("notice--info")).toBe(true);
    expect(notice!.textContent).toBe("Not in the index yet, shown from the network. Its history appears once the index has it.");
    expect(within(region("Pool state")).getByText(/Live from the network/)).toBeTruthy();
  });

  it("says an asset is frozen by its issuer, with its icon", () => {
    const { container } = mount(build({ node: fulfilled(poolInfo({ asset2_frozen: true })) }));
    const [notice] = notices(container);
    expect(notice!.textContent).toBe("RLUSD in this pool is frozen by its issuer");
    expect(notice!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

// ---- The state, the period and the charts -------------------------------------------------------------------------------------------------------------

describe("AmmPoolPage: the pool state", () => {
  it("is a section named Pool state with the seven stats, each its label, value and words, the reserves in display order", () => {
    mount(build());
    const card = region("Pool state");
    const tiles = [...card.querySelectorAll(".stat")];
    expect(tiles.map((tile) => tile.querySelector(".stat__label")!.textContent)).toEqual([
      "Value",
      "Reserves",
      "Pool price",
      "Trading fee",
      "LP tokens",
      "Swap volume, 24 h",
      "Fees earned, Oct 16",
    ]);
    expect(tiles[0]!.querySelector(".stat__value")!.textContent).toBe("3.7M XRP");
    expect(tiles[0]!.classList.contains("stat--figure")).toBe(true);
    expect([...tiles[1]!.querySelectorAll(".amm-pool__reserves > span")].map((line) => line.textContent)).toEqual(["1,847,691.034536 XRP", "2,417,282.053464318 RLUSD"]);
    expect(tiles[3]!.textContent).toBe("Trading fee0.300%set by 3 votes");
    expect(tiles[6]!.querySelector(".stat__value")!.textContent).toBe("12.5 XRP + 30.1 RLUSD");
  });

  it("lets a long exact figure wrap after a thousands separator, not inside a group of digits", () => {
    mount(build());
    const [, reserves, , , lp] = [...region("Pool state").querySelectorAll(".stat")];
    const second = reserves!.querySelectorAll(".amm-pool__reserves > span")[1]!;
    expect(second.textContent).toBe("2,417,282.053464318 RLUSD");
    expect(second.querySelectorAll("wbr")).toHaveLength(2);
    expect([...second.querySelectorAll("wbr")].map((wbr) => wbr.previousSibling?.textContent?.at(-1))).toEqual([",", ","]);
    expect(lp!.querySelector(".stat__value")!.textContent).toBe("1,791,055,986.845366");
    expect(lp!.querySelectorAll(".stat__value wbr")).toHaveLength(3);
  });

  it("says where the state is from, the ledger a link", () => {
    mount(build());
    const caption = within(region("Pool state")).getByText(/Live from the network at ledger/);
    expect(caption.textContent).toBe("Live from the network at ledger #107,721,455");
    expect(within(caption).getByRole("link", { name: "#107,721,455" }).getAttribute("href")).toBe("/xrpl/ledger/107721455");
  });

  it("lays the stats out in the board's grid", () => {
    expect(ruleOf(".amm-pool__stats")).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(170px,\s*1fr\)\)/);
  });
});

describe("AmmPoolPage: the period", () => {
  it("is E2's segmented links, the current one aria-current=true, with the day rows' source line and the window's note", () => {
    mount(build());
    const group = screen.getByRole("group", { name: "Period" });
    expect(within(group).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["30 days", ammPoolHref("xrpl", AMM_POOL, { period: "30d" }), null],
      ["90 days", ammPoolHref("xrpl", AMM_POOL, {}), "true"],
      ["1 year", ammPoolHref("xrpl", AMM_POOL, { period: "1y" }), null],
    ]);
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(filters.contains(group)).toBe(true);
    expect(within(filters).getByText(`/v2/amm/pools/${shortAddress(AMM_POOL)}/history?interval=day`)).toBeTruthy();
    expect(screen.getByText(/^Charts cover the 90 days from Jul 20 to Oct 17, 2026/)).toBeTruthy();
  });

  it("navigates to another period keeping the window where it is", async () => {
    const { router } = mount(build());
    await act(async () => void fireEvent.click(screen.getByRole("link", { name: "1 year" })));
    expect(router.state.location.search).toBe("?period=1y");
    expect(router.state.preventScrollReset).toBe(true);
  });
});

describe("AmmPoolPage: the charts", () => {
  it("draws the five cards in the board's pairs, Reserves the width of the page", () => {
    const { container } = mount(build());
    for (const title of CHART_TITLES) {
      const card = region(title);
      // Each with its Chart/Table toggle, its chart and its table.
      expect(within(card).getAllByRole("radio")).toHaveLength(2);
    }
    const pairs = [...container.querySelectorAll(".amm-pool__pair")].slice(0, 2);
    expect(pairs.map((pair) => [...pair.querySelectorAll(".chart__title")].map((title) => title.textContent))).toEqual([
      ["Pool value, in XRP", "Swap volume per day, in XRP"],
      ["Pool price, RLUSD per XRP", "Trading fee"],
    ]);
    expect(region("Reserves").closest(".amm-pool__pair")).toBeNull();
    // Each card's notes are the view builder's, the note of the days not computed yet among them.
    expect(within(region("Pool value, in XRP")).getByText("A day without rows may not be computed yet.")).toBeTruthy();
  });

  it("folds the pairs at 420 px", () => {
    expect(ruleOf(".amm-pool__half")).toMatch(/flex:\s*1 1 420px/);
    expect(ruleOf(".amm-pool__pair")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("gives each card its own SectionError: without the day rows, value, price, fee and reserves fail and the volume stands", () => {
    mount(build({ days: rejected(serverError()) }));
    expect(within(region("Pool value, in XRP")).getByRole("alert").textContent).toContain("Couldn’t load the pool value.");
    expect(within(region("Pool price, RLUSD per XRP")).getByRole("alert").textContent).toContain("Couldn’t load the pool price.");
    expect(within(region("Trading fee")).getByRole("alert").textContent).toContain("Couldn’t load the trading fee.");
    expect(within(region("Reserves")).getByRole("alert").textContent).toContain("Couldn’t load the reserves.");
    // A failed card keeps its title and the day rows' source line.
    expect(within(region("Reserves")).getByText(`/v2/amm/pools/${shortAddress(AMM_POOL)}/history?interval=day`)).toBeTruthy();
    const volume = region("Swap volume per day, in XRP");
    expect(within(volume).queryByRole("alert")).toBeNull();
    expect(within(volume).getByText("The fee estimates couldn't be loaded.")).toBeTruthy();
  });

  it("fails the volume card alone without the candles", () => {
    mount(build({ candles: rejected(serverError()) }));
    expect(within(region("Swap volume per day, in XRP")).getByRole("alert").textContent).toContain("Couldn’t load the swap volume.");
    expect(within(region("Pool value, in XRP")).queryByRole("alert")).toBeNull();
  });

  it("says 'Couldn't load the charts.' once for all five when the newest ledger could not be read, with one Retry", async () => {
    const { loader } = mount(build({ last: rejected(serverError()), days: null, carryIn: null, lastDay: null, candles: null }));
    const alerts = screen.getAllByRole("alert").filter((alert) => /charts/.test(alert.textContent ?? ""));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain("Couldn’t load the charts.");
    for (const title of CHART_TITLES) expect(screen.queryByRole("region", { name: title })).toBeNull();
    // The period links stay; the window's note does not, as there is no window.
    expect(screen.getByRole("group", { name: "Period" })).toBeTruthy();
    expect(screen.queryByText(/^Charts cover/)).toBeNull();
    await act(async () => void fireEvent.click(within(alerts[0]!).getByRole("button", { name: "Retry" })));
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

// ---- The slot and the votes ------------------------------------------------------------------------------------------------------------------------

describe("AmmPoolPage: the auction slot", () => {
  it("says until when the slot is held, in UTC, with E6's Countdown, whose server text is empty", () => {
    const html = renderToString(routed(<AmmPoolPage data={build()} />));
    const printed = document.createElement("div");
    printed.innerHTML = html;
    const head = printed.querySelector(".amm-pool__aside")!;
    expect(head.textContent).toBe("until Oct 18, 2026, 09:00 UTC");
    const time = head.querySelector("time")!;
    expect(time.textContent).toBe("");
    expect(time.getAttribute("dateTime")).toBe("2026-10-18T09:00:00.000Z");
  });

  it("counts down in the browser, and says expired once the time has passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date((EXPIRATION - 9 * 3600) * 1000));
    mount(build());
    expect(within(region("Auction slot")).getByText(/^until/).textContent).toBe("until Oct 18, 2026, 09:00 UTC · in 9 h");
    cleanup();
    vi.setSystemTime(new Date((EXPIRATION + 60) * 1000));
    mount(build());
    expect(within(region("Auction slot")).getByText(/^until/).textContent).toBe("until Oct 18, 2026, 09:00 UTC · expired");
  });

  it("names the holder, the fee, the price and the authorized accounts, draws the Meter and says its interval and the cost of a bid", () => {
    const data = build();
    mount(data);
    const card = region("Auction slot");
    const fields = [...card.querySelectorAll(".amm-pool__field")].map((field) => [field.querySelector("dt")!.textContent, field.querySelector("dd")!.textContent]);
    expect(fields).toEqual([
      ["Holder", shortAddress(AMM_HOLDER)],
      ["Their trading fee", "0.022%"],
      ["Price paid", "100 LP tokens"],
      ["Authorized accounts", "none"],
    ]);
    expect(within(card).getByRole("link", { name: shortAddress(AMM_HOLDER) }).getAttribute("href")).toBe(`/xrpl/account/${AMM_HOLDER}`);
    expect(within(card).getByRole("img", { name: "Interval 13 of 20 of the 24-hour slot" })).toBeTruthy();
    const text = card.querySelector(".amm-pool__slot-text")!.textContent!;
    expect(text).toMatch(/^Interval 13 of 20 of the 24-hour slot\. A new bid now costs at least [\d,.]+ LP tokens\.$/);
    expect(text).toBe(data.slot!.text);
  });

  it("links each authorized account", () => {
    const info = poolInfo();
    mount(build({ node: fulfilled({ ...info, auction_slot: { ...info.auction_slot!, auth_accounts: [AMM_ACCOUNT, AMM_OTHER] } }) }));
    const card = region("Auction slot");
    const accounts = [...card.querySelectorAll(".amm-pool__field")][3]!;
    expect(accounts.querySelector("dd")!.textContent).toBe(`${shortAddress(AMM_ACCOUNT)}, ${shortAddress(AMM_OTHER)}`);
    expect(within(accounts as HTMLElement).getAllByRole("link")).toHaveLength(2);
  });

  it("says the slot is open, a status with its icon, with the cost of a bid, and no holder, time or meter", () => {
    mount(build({ node: fulfilled(poolInfo({ auction_slot: undefined })) }));
    const card = region("Auction slot");
    const text = card.querySelector(".amm-pool__slot-text")!;
    expect(text.textContent).toMatch(/^The slot is open\. A new bid now costs at least [\d,.]+ LP tokens\.$/);
    expect(text.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(card.querySelector(".amm-pool__field")).toBeNull();
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.querySelector("time")).toBeNull();
  });

  it("reads the index's slot while the node is down: the holder, fee, price and time, without the interval or the authorized accounts", () => {
    mount(build({ mode: "node-down", node: rejected(serverError()) }));
    const card = region("Auction slot");
    expect([...card.querySelectorAll(".amm-pool__field dt")].map((label) => label.textContent)).toEqual(["Holder", "Their trading fee", "Price paid"]);
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.querySelector(".amm-pool__slot-text")).toBeNull();
  });
});

describe("AmmPoolPage: the fee votes", () => {
  it("is a BarList of the vote slots, each account a link, the fee it votes for and its share of the LP tokens", () => {
    mount(build());
    const card = region("Fee votes");
    expect(within(card).getByText("weighted by LP tokens held")).toBeTruthy();
    const items = within(card).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      `${shortAddress(AMM_HOLDER)}votes for 0.300%50% of LP tokens`,
      `${shortAddress(AMM_ACCOUNT)}votes for 0.250%30% of LP tokens`,
      `${shortAddress(AMM_OTHER)}votes for 0.400%20% of LP tokens`,
    ]);
    expect(within(card).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([AMM_HOLDER, AMM_ACCOUNT, AMM_OTHER].map((a) => `/xrpl/account/${a}`));
    for (const bar of card.querySelectorAll(".barlist__bar")) expect(bar.getAttribute("aria-hidden")).toBe("true");
  });

  it("says the weighted result, the figure in strong", () => {
    mount(build());
    const result = region("Fee votes").querySelector(".amm-pool__result")!;
    expect(result.textContent).toBe("Weighted result 0.300%, the pool's trading fee.");
    expect(result.querySelector("strong")!.textContent).toBe("0.300%");
  });

  it("says a pool without a vote slot has no fee votes, with no list", () => {
    mount(build({ node: fulfilled(poolInfo({ vote_slots: [] })) }));
    const card = region("Fee votes");
    expect(within(card).queryByRole("list")).toBeNull();
    expect(card.querySelector(".amm-pool__result")!.textContent).toBe("No fee votes.");
  });
});

// ---- The activity ------------------------------------------------------------------------------------------------------------------------------------

describe("AmmPoolPage: the pool's activity", () => {
  it("is a section named Pool activity with its tabs as links, the current one aria-current=page, and the tab's source line", () => {
    mount(build());
    const card = region("Pool activity");
    const nav = within(card).getByRole("navigation", { name: "Pool activity" });
    expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["Swaps", POOL_PAGE, "page"],
      ["Liquidity", `${POOL_PAGE}?tab=liquidity`, null],
      ["Votes and bids", `${POOL_PAGE}?tab=governance`, null],
    ]);
    expect(within(card).getByText("/v2/amm/pools/{pool}/swaps")).toBeTruthy();
  });

  it("navigates to another tab keeping the window where it is", async () => {
    const { router } = mount(build());
    await act(async () => void fireEvent.click(screen.getByRole("link", { name: "Liquidity" })));
    expect(router.state.location.search).toBe("?tab=liquidity");
    expect(router.state.preventScrollReset).toBe(true);
  });

  it("draws the swaps with spec 3.1's columns, the time in the account tables' two-line cell", () => {
    mount(build());
    const table = within(region("Pool activity")).getByRole("table", { name: "Swaps" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Time (UTC)",
      "Direction",
      "Into the pool",
      "Out of the pool",
      "Price (RLUSD per XRP)",
      "Taker",
    ]);
    const [row] = rowsOf(table);
    const cells = cellsOf(row!);
    expect(cells.map((cell) => cell.textContent)).toEqual(["2026-10-1712:00:03", "XRP → RLUSD", "+512.4 XRP", "−1,250 RLUSD", "2.4395004", shortAddress(AMM_ACCOUNT)]);
    const when = within(cells[0]!).getByRole("link");
    expect(when.getAttribute("href")).toBe(`/xrpl/tx/${AMM_TX_HASH}`);
    expect(when.getAttribute("aria-label")).toBe(`2026-10-17, transaction ${shortHash(AMM_TX_HASH)}`);
    expect(cells[0]!.querySelector(".when")).not.toBeNull();
    expect(within(cells[5]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${AMM_ACCOUNT}`);
    // DataTable's scroll region, which a keyboard can reach.
    expect(table.closest('[role="region"][tabindex="0"]')!.getAttribute("aria-label")).toBe("Swaps, scrollable table");
  });

  it("says under the swaps how to read the signs and the amounts, and pages with Newer and Older keeping the window where it is", async () => {
    const { router } = mount(build());
    const card = region("Pool activity");
    expect(within(card).getByText("Newest first. Signs are from the pool's side: + went in, − came out.")).toBeTruthy();
    expect(within(card).getByText("Amounts are the pool's own changes; on the asset it pays out they include the issuer's transfer fee.")).toBeTruthy();
    const pager = within(card).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getAllByRole("link").map((link) => link.textContent)).toEqual(["Older"]);
    expect(pager.textContent).toBe("NewerOlder");
    await act(async () => void fireEvent.click(within(pager).getByRole("link", { name: "Older" })));
    expect(router.state.location.search).toBe(`?marker=${AMM_MARKER}`);
    expect(router.state.preventScrollReset).toBe(true);
  });

  it("names the issuers of a pool of one code on both sides in the direction cell, which reads USD → USD", () => {
    const usdUsd = ammPoolSample({ base_currency: "USD", base_issuer: AMM_ISSUER, counter_currency: "USD", counter_issuer: RL });
    const swap = ammSwapSample({ base_currency: "USD", base_issuer: AMM_ISSUER, counter_currency: "USD", counter_issuer: RL, base_amount: "10", counter_amount: "9.9", seller: AMM_POOL });
    mount(build({ mode: "gone", index: usdUsd, node: rejected(notFound("node amm_info: actNotFound")), activity: fulfilled(swapsPage([swap])) }));
    const table = within(region("Pool activity")).getByRole("table", { name: "Swaps" });
    const direction = cellsOf(rowsOf(table)[0]!)[1]!;
    const title = `USD of ${shortAddress(RL)} → USD of ${shortAddress(AMM_ISSUER)}`;
    // The eye reads the codes, with the issuers on hover; a screen reader hears the issuers.
    expect(direction.querySelector("[title]")!.getAttribute("title")).toBe(title);
    expect(direction.querySelector('[aria-hidden="true"]')!.textContent).toBe("USD → USD");
    expect(direction.querySelector(".sr")!.textContent).toBe(title);
  });

  it("draws the liquidity events: the event as a tag, the mode as served, the amounts signed in the display pair, a clawback's sender", () => {
    const deposit = ammLiquiditySample({ base_amount: "10", counter_amount: "20", lp_tokens: "14.1421356" });
    const withdraw = ammLiquiditySample({ event: "withdraw", mode: "lp_token", tx_index: 13, base_amount: "-5", counter_amount: "0", lp_tokens: "-7" });
    const clawback = ammLiquiditySample({ event: "clawback", mode: undefined, tx_index: 14, initiator: AMM_ISSUER, base_amount: "-1", counter_amount: "-2", lp_tokens: "-1.5" });
    const page: Page<"liquidity", AmmLiquidityEvent> = { result: "success", count: 3, liquidity: [deposit, withdraw, clawback] };
    mount(build({ query: { ...QUERY, tab: "liquidity" }, activity: fulfilled(page) }), `${POOL_PAGE}?tab=liquidity`);
    const card = region("Pool activity");
    expect(within(card).getByText("/v2/amm/pools/{pool}/liquidity")).toBeTruthy();
    const table = within(card).getByRole("table", { name: "Liquidity events" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Time (UTC)", "Event", "Mode", "XRP", "RLUSD", "LP tokens", "Provider"]);
    const [first, second, third] = rowsOf(table).map(cellsOf);
    expect(first!.slice(1).map((cell) => cell.textContent)).toEqual(["Deposit", "two_asset", "+20", "+10", "+14.1421356", shortAddress(AMM_ACCOUNT)]);
    expect(first![1]!.querySelector(".tag")).not.toBeNull();
    // A plus in the success colour, a minus, a plain 0.
    expect(first![3]!.querySelector(".amt--pos")).not.toBeNull();
    expect(second!.slice(3, 6).map((cell) => [cell.textContent, cell.querySelector(".amt--pos") !== null])).toEqual([
      ["0", false],
      ["−5", false],
      ["−7", false],
    ]);
    expect(third![2]!.textContent).toBe("");
    expect(third![6]!.textContent).toBe(`${shortAddress(AMM_ACCOUNT)} by ${shortAddress(AMM_ISSUER)}`);
    expect(within(third![6]!).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([`/xrpl/account/${AMM_ACCOUNT}`, `/xrpl/account/${AMM_ISSUER}`]);
    // The signs' note, and not the swaps'.
    expect(within(card).getByText("Newest first. Signs are from the pool's side: + went in, − came out.")).toBeTruthy();
    expect(within(card).queryByText(/transfer fee/)).toBeNull();
  });

  it("draws the votes and bids: the kind as a tag, the account, what happened and the fee after", () => {
    const page: Page<"governance", AmmGovernanceRow> = { result: "success", count: 2, governance: [ammVoteSample(), ammBidSample()] };
    mount(build({ query: { ...QUERY, tab: "governance" }, activity: fulfilled(page) }), `${POOL_PAGE}?tab=governance`);
    const table = within(region("Pool activity")).getByRole("table", { name: "Votes and bids" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Time (UTC)", "Kind", "Account", "What happened", "Fee after"]);
    const [vote, bid] = rowsOf(table).map(cellsOf);
    expect(vote!.slice(1).map((cell) => cell.textContent)).toEqual(["Vote", shortAddress(AMM_ACCOUNT), "Voted for 0.300%", "0.450%"]);
    expect(bid!.slice(1).map((cell) => cell.textContent)).toEqual([
      "Bid",
      shortAddress(AMM_ACCOUNT),
      "Won the auction slot for 2.5 LP tokens; fee 0.050% for the holder and 1 authorized account",
      "—",
    ]);
  });

  it("keeps the tabs as links and says what it could not load when the tab's list failed", () => {
    mount(build({ activity: rejected(serverError()) }));
    const card = region("Pool activity");
    expect(within(within(card).getByRole("navigation", { name: "Pool activity" })).getAllByRole("link")).toHaveLength(3);
    expect(within(card).getByRole("alert").textContent).toContain("Couldn’t load the swaps.");
    expect(within(card).queryByRole("table")).toBeNull();
    expect(within(card).queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("says when a tab has nothing to show", () => {
    mount(build({ activity: fulfilled(swapsPage([], null)) }));
    expect(within(region("Pool activity")).getByText("No swaps to show.")).toBeTruthy();
  });

  it("has 44 px pager buttons, under the page root the list shares", () => {
    const { container } = mount(build());
    expect(container.querySelector(".amm.amm-pool .pager")).not.toBeNull();
    expect(ruleOf(".amm .pager .btn")).toMatch(/min-height:\s*44px/);
  });
});

// ---- The page behind a marker, and the whole page ----------------------------------------------------------------------------------------------------

describe("AmmPoolPage behind a marker", () => {
  it("has the breadcrumb, the pool card without its Created and LP token lines, the activity and Back to the pool, and nothing else", () => {
    mount(history(), `${POOL_PAGE}?marker=M1`);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("XRPL/AMM pools/XRP/RLUSD");
    const card = region("Pool");
    expect(within(card).getByRole("heading", { level: 1 }).textContent).toBe("XRP / RLUSD pool");
    expect(within(card).queryByText(/Created/)).toBeNull();
    expect(within(card).queryByText(/LP token/)).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the pool" }).getAttribute("href")).toBe(POOL_PAGE);
    expect(within(region("Pool activity")).getByRole("table", { name: "Swaps" })).toBeTruthy();
    for (const name of ["Pool state", "Auction slot", "Fee votes", ...CHART_TITLES]) expect(screen.queryByRole("region", { name })).toBeNull();
    expect(screen.queryByRole("group", { name: "Period" })).toBeNull();
    expect(document.querySelector(".notice")).toBeNull();
  });
});

describe("AmmPoolPage as the Worker prints it and the browser takes it over", () => {
  it.each([
    ["the first page", () => build()],
    ["a pool whose node is down", () => build({ mode: "node-down", node: rejected(serverError()) })],
    ["a deleted pool", () => build({ mode: "deleted", index: indexPool({ deleted: true }) })],
    ["a page behind a marker", () => history()],
  ] as const)("is the same on the server as in the browser: %s", async (_name, data) => {
    const { html, errors } = await serverThenHydrated(routed(<AmmPoolPage data={data()} />));
    expect(html).toContain("XRP / RLUSD pool");
    expect(errors).toEqual([]);
  });
});

describe("the files of the pool page that run in the browser", () => {
  // A client-side navigation draws the page in the browser: it gets strings from the view builder and never fetches. A type import is erased and costs
  // nothing; a value import is the bug.
  const FORBIDDEN = [/\/server\//, /\/describe(\/|$)/, /\/parse(\/|$)/, /\/asset$/, /ripple-/];

  it.each(["./AmmPoolPage.tsx", "../components/WhenCell.tsx", "../components/Tabs.tsx", "../charts/BarList.tsx"])(
    "%s imports nothing of the server, describe, parse, asset or ripple-* as a value",
    (file) => {
      expect(valueImports(read(file)).filter((from) => FORBIDDEN.some((pattern) => pattern.test(from)))).toEqual([]);
    },
  );

  it("keeps the account page's time cell free of the chart kit, use-hydrated and StatTile (R18, P36)", () => {
    const KIT = [/\/charts\//, /use-hydrated/, /StatTile/];
    expect(valueImports(read("../components/WhenCell.tsx")).filter((from) => KIT.some((pattern) => pattern.test(from)))).toEqual([]);
    // The account page imports the cell, and the kit only through its lazy analytics view.
    const account = valueImports(read("./AccountPage.tsx"));
    expect(account).toContain("../components/WhenCell");
    expect(account.filter((from) => KIT.some((pattern) => pattern.test(from)))).toEqual([]);
  });
});
