import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { shortAddress } from "../../domain/format";
import type { BookLevel, LivePairData, OlderPairData, PairHead, PairPageData, PriceChange, TradeRowView } from "../../server/pair-view";
import type { CandleData } from "../charts/types";
import type { LiveControls } from "../use-live-controls";
import { MarketPairPage } from "./MarketPairPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const XRPL = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" } as const;
const XAHAU = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" } as const;
type Net = typeof XRPL | typeof XAHAU;

const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const EUR_ISSUER = "rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w";
const EVR_ISSUER = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
const POOL = "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am";
const TAKER = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const SECOND = "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh";
const hash = (digit: string) => `76018A${digit.repeat(54)}D8AB`;

const PAIR = `/xrpl/markets/XRP/USD.${ISSUER}`;
const INVERTED = `/xrpl/markets/USD.${ISSUER}/XRP`;
const BOOK_BODY =
  "The network node did not answer, so the order book is missing. Trades and prices on this page are from the explorer’s index and are not affected.";
const POOL_BODY =
  "The network node did not answer, so the pool’s reserves and fee are missing. Trades and prices on this page are from the explorer’s index and are not affected.";

// ---- Page data, as the view builder makes it (`pairPage`, `olderPage`) ------------------------------------------------------------------------

const link = (label: string, href: string, current = false) => ({ label, href, current });

function head(over: Partial<PairHead> = {}): PairHead {
  return {
    title: "XRP/USD",
    heading: "XRP / USD",
    base: "XRP",
    counter: "USD",
    issuers: [{ code: "USD", address: ISSUER, href: `/xrpl/account/${ISSUER}` }],
    natives: ["XRP"],
    issued: ["USD rhub8V…F3wq"],
    issuedBy: "USD issued by rhub8V…F3wq",
    invert: { label: "Show USD/XRP", href: INVERTED },
    firstPage: PAIR,
    ...over,
  };
}

/** Five hours, the last one the running one. */
const BUCKETS = ["2026-10-17T13:00:00Z", "2026-10-17T14:00:00Z", "2026-10-17T15:00:00Z", "2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"];
function candleData(token = "candles-1", close = "2.4395"): CandleData {
  return {
    axis: { unit: "hour", buckets: BUCKETS },
    candles: [
      { o: "2.40", h: "2.46", l: "2.38", c: "2.44", v: "1200000", n: "310" },
      { o: "2.44", h: "2.45", l: "2.39", c: "2.41", v: "900000", n: "250" },
      null,
      { o: "2.41", h: "2.43", l: "2.41", c: "2.42", v: "500000", n: "12" },
      { o: "2.42", h: "2.48", l: "2.40", c: close, v: "1600000", n: "694" },
    ],
    format: { kind: "price", unit: "USD" },
    volume: { kind: "amount", unit: "XRP" },
    forming: true,
    token,
  };
}

const level = (price: string, size: string, total: string, depth: string): BookLevel => ({ price, size, total, depth });
/** Best first, as the view builder gives them. */
const ASKS = [level("2.44", "1.2K", "1.2K", "0.24"), level("2.45", "800", "2K", "0.4"), level("2.46", "3K", "5K", "1")];
const BIDS = [level("2.39", "1K", "1K", "0.2"), level("2.38", "2.5K", "3.5K", "0.7")];

function trade(over: Partial<TradeRowView> & Pick<TradeRowView, "key" | "txHref">): TradeRowView {
  return {
    time: "2026-10-17 15:42:51",
    txHidden: ", transaction 76018A…D8AB",
    side: "Buy",
    dot: "up",
    price: "2.4395",
    base: "1,000",
    counter: "2,439.5",
    taker: TAKER,
    via: "AMM",
    ...over,
  };
}

const TRADES: TradeRowView[] = [
  trade({ key: "107721455:3:0", txHref: `/xrpl/tx/${hash("1")}` }),
  trade({
    key: "107721454:1:2",
    txHref: `/xrpl/tx/${hash("2")}`,
    time: "2026-10-17 15:42:40",
    side: "Sell",
    dot: "down",
    price: "2.4391",
    base: "250.5",
    counter: "611.0",
    taker: SECOND,
    via: "Book",
  }),
  trade({ key: "107721450:0:1", txHref: `/xrpl/tx/${hash("3")}`, time: "2026-10-17 15:41:02", side: "—", dot: null, via: "Book" }),
];

const STATS = [
  { label: "24 h high", value: "2.4612" },
  { label: "24 h low", value: "2.3807" },
  { label: "VWAP 24 h", value: "2.4255" },
  { label: "Volume XRP", value: "6.1M" },
  { label: "Volume USD", value: "14.8M" },
  { label: "Trades 24 h", value: "8,412" },
];

/** The summary's change, which the 24 h figures carry. */
const CHANGE: PriceChange = { text: "+1.84%", dir: "up" };

const BOOK_SOURCE = "live from the node · book_offers · ledger #";
const TRADERS_SOURCE = "/v2/active_accounts/{base}/{counter}";
const TRADERS_NOTE = "2 of 1,204 accounts that traded XRP/USD in the last 24 hours, by XRP volume. A trade counts for its buyer and its seller.";

function page(over: Partial<LivePairData> = {}): LivePairData {
  return {
    mode: "live",
    head: head(),
    anchor: { lastValidated: 107721456, closeTime: 1792256472 },
    build: "test",
    indexable: true,
    view: [],
    ammParts: true,
    filters: {
      trades: [link("All", PAIR, true), link("Order book", `${PAIR}?trades=book`), link("AMM", `${PAIR}?trades=amm`)],
      interval: [
        link("15 m", `${PAIR}?interval=15m`),
        link("1 h", PAIR, true),
        link("4 h", `${PAIR}?interval=4h`),
        link("1 d", `${PAIR}?interval=1d`),
        link("1 w", `${PAIR}?interval=1w`),
      ],
    },
    price: { text: "2.4395", unit: "USD per XRP", note: null, token: "price-1" },
    stats: { state: "ok", items: STATS, note: null, change: CHANGE, token: "stats-1" },
    candles: { state: "ok", data: candleData(), source: "/v2/exchanges/{base}/{counter}?interval=1hour", empty: null },
    trades: { rows: TRADES, paging: { newerHref: null, olderHref: `${PAIR}?marker=M1` }, source: "/v2/exchanges/{base}/{counter}?descending=true", empty: "No trades yet." },
    book: { state: "ok", source: BOOK_SOURCE, ledger: "107,721,455", asks: ASKS, bids: BIDS, spread: "0.05", token: "book-1" },
    pool: {
      state: "ok",
      title: "XRP/USD AMM pool",
      source: "live from the node · amm_info · ledger #",
      ledger: "107,721,456",
      reserves: "1.8M XRP · 4.39M USD",
      price: "2.4393 USD",
      fee: "0.300%",
      link: { href: `/xrpl/account/${POOL}`, label: "Pool account →" },
      token: "pool-1",
    },
    share: { state: "ok", text: "34%" },
    traders: {
      state: "ok",
      data: {
        items: [
          { id: TAKER, label: shortAddress(TAKER), href: `/xrpl/account/${TAKER}`, value: "6100000", count: "312" },
          { id: SECOND, label: shortAddress(SECOND), href: `/xrpl/account/${SECOND}`, value: "2000000", count: "41" },
        ],
        format: { kind: "amount", unit: "XRP" },
        token: "traders-1",
      },
      note: TRADERS_NOTE,
      source: TRADERS_SOURCE,
    },
    ...over,
  };
}

/** The same pair while `AMM_DATA` is off: no Trades filter, no Via, no share. */
const NO_AMM = (over: Partial<LivePairData> = {}) =>
  page({
    ammParts: false,
    filters: { ...page().filters, trades: null },
    trades: { ...page().trades, rows: TRADES.map((row) => ({ ...row, via: null })) },
    share: { state: "off" },
    ...over,
  });

/** EVR/XAH on Xahau: no AMM at all. */
const XAHAU_PAGE = (over: Partial<LivePairData> = {}) =>
  NO_AMM({
    head: head({
      title: "EVR/XAH",
      heading: "EVR / XAH",
      base: "EVR",
      counter: "XAH",
      issuers: [{ code: "EVR", address: EVR_ISSUER, href: `/xahau/account/${EVR_ISSUER}` }],
      natives: ["XAH"],
      issued: ["EVR rEvern…XXr8"],
      issuedBy: "EVR issued by rEvern…XXr8",
      invert: { label: "Show XAH/EVR", href: `/xahau/markets/XAH/EVR.${EVR_ISSUER}` },
      firstPage: `/xahau/markets/EVR.${EVR_ISSUER}/XAH`,
    }),
    pool: { state: "missing" },
    ...over,
  });

function older(over: Partial<OlderPairData> = {}): OlderPairData {
  return {
    mode: "older",
    head: head(),
    build: "test",
    view: ["older trades"],
    ammParts: true,
    note: { text: "Older trades of XRP/USD. The price, chart and order book are on the market's page.", link: "the market's page", href: PAIR },
    trades: {
      rows: TRADES,
      paging: { newerHref: PAIR, olderHref: `${PAIR}?marker=M2&back=M1` },
      source: "/v2/exchanges/{base}/{counter}?descending=true",
      empty: "No trades yet.",
    },
    ...over,
  };
}

/** The loaded 24 h figures with another change of the summary (which they carry). */
const withChange = (change: PriceChange | null): LivePairData["stats"] => ({ state: "ok", items: STATS, note: null, change, token: `stats:${change?.text}` });

/** Every card failed, each with what the view builder gives a failed card (`pairPage`). */
const FAILED_STATS = { state: "failed", labels: STATS.map((s) => s.label) } as const satisfies LivePairData["stats"];
const FAILED_CANDLES = { state: "failed", source: "/v2/exchanges/{base}/{counter}?interval=1hour" } as const satisfies LivePairData["candles"];
const FAILED_BOOK = { state: "failed", source: "live from the node · book_offers" } as const satisfies LivePairData["book"];
const FAILED_POOL = { state: "failed", title: "XRP/USD AMM pool", source: "live from the node · amm_info" } as const satisfies LivePairData["pool"];
const FAILED_TRADERS = { state: "failed", source: TRADERS_SOURCE } as const satisfies LivePairData["traders"];
const FAILED_SHARE = { state: "failed" } as const;
const ALL_FAILED = { stats: FAILED_STATS, candles: FAILED_CANDLES, book: FAILED_BOOK, pool: FAILED_POOL, share: FAILED_SHARE, traders: FAILED_TRADERS };

// ---- Rendering --------------------------------------------------------------------------------------------------------------------------

const controls = (over: Partial<LiveControls> = {}): LiveControls => ({
  paused: false,
  held: false,
  notice: "",
  failures: 0,
  onTogglePause: vi.fn(),
  onHold: vi.fn(),
  ...over,
});

/**
 * The page in a data router, drawn at once: its route's data is given (`hydrationData`), as the document gives it in the browser. The
 * `loader` is what a Retry runs again.
 */
function mount(data: PairPageData, props: { live?: LiveControls; network?: Net; loader?: () => Promise<null> | null } = {}) {
  const network = props.network ?? XRPL;
  const router = createMemoryRouter(
    [{ path: "*", element: <MarketPairPage network={network} data={data} live={props.live} />, loader: props.loader ?? (() => null) }],
    { initialEntries: [PAIR], hydrationData: { loaderData: { "0": null } } },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

const routed = (ui: ReactElement) => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [PAIR] })} />;

const region = (name: string | RegExp) => screen.getByRole("region", { name });
const card = (title: string | RegExp) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;
const summary = () => region("Pair summary");
const tradesTable = () => screen.getByRole("table", { name: "Recent trades" });
const bookTable = () => screen.getByRole("table", { name: "Order book" });
/** The row groups of the book: the header row, the asks, the middle row and the bids. */
const bookGroups = () => within(bookTable()).getAllByRole("rowgroup");
/** The rows of a row group of the book, each as the texts of its cells. */
const groupRows = (group: HTMLElement) => within(group).getAllByRole("row").map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
const stat = (label: string) => {
  const term = within(summary()).getByText(label);
  return term.closest(".pair__stat")!.querySelector("dd")!.textContent;
};

// ---- The page ---------------------------------------------------------------------------------------------------------------------------

describe("MarketPairPage, the breadcrumb and the live row", () => {
  it("has the breadcrumb 'XRPL / Markets / XRP/USD', to the network and to the markets, the pair the current page", () => {
    mount(page());
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["XRPL/", "Markets/", "XRP/USD"]);
    expect(within(crumbs).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["XRPL", "/xrpl"],
      ["Markets", "/xrpl/markets"],
    ]);
    expect(within(crumbs).getByText("XRP/USD").getAttribute("aria-current")).toBe("page");
  });

  it("puts E2's live row beside the breadcrumb: the dot and 'Live · updates every ledger'", () => {
    const { container } = mount(page());
    const row = container.querySelector(".hero__status-row")!;
    expect(row.querySelector(".hero__status")!.textContent).toBe("Live · updates every ledger");
    expect(row.querySelector(".hero__dot")!.getAttribute("aria-hidden")).toBe("true");
    expect(row.parentElement).toBe(screen.getByRole("navigation", { name: "Breadcrumb" }).parentElement);
  });

  it("has the status, the pause button and its handler with the route's controls", async () => {
    const live = controls({ failures: 2 });
    mount(page(), { live });
    expect(screen.getByRole("status").textContent).toBe("Live updates paused, retrying…");
    fireEvent.click(await screen.findByRole("button", { name: "Pause live updates" }));
    expect(live.onTogglePause).toHaveBeenCalledTimes(1);
  });

  it("has no status, no button and no note without them", () => {
    const { container } = mount(page());
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /live updates/ })).toBeNull();
    expect(container.querySelector(".hero__held")).toBeNull();
  });

  it("has no aria-live anywhere and exactly one role=status, the live status, even with every card failed", async () => {
    const failing = page(ALL_FAILED);
    for (const data of [page(), failing]) {
      const { container, unmount } = mount(data, { live: controls() });
      await screen.findByRole("button", { name: "Pause live updates" });
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(container.querySelector('[role="status"]')!.classList.contains("hero__live")).toBe(true);
      expect(container.querySelector("[aria-live]")).toBeNull();
      unmount();
    }
  });
});

describe("MarketPairPage, the pair summary", () => {
  it("is a section named 'Pair summary' with the pair as the page's one h1", () => {
    mount(page());
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["XRP / USD"]);
    expect(within(summary()).getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("links to the other way round as the data gives it, keeping the view's parameters", () => {
    mount(page({ head: head({ invert: { label: "Show USD/XRP", href: `${INVERTED}?interval=4h&trades=amm` } }) }));
    const invert = within(summary()).getByRole("link", { name: "Show USD/XRP" });
    expect(invert.getAttribute("href")).toBe(`${INVERTED}?interval=4h&trades=amm`);
  });

  it("says who issues each side, the full address in mono linking to its account, and which side is native", () => {
    mount(page());
    const line = summary().querySelector(".pair__issuers")!;
    expect(line.textContent).toBe(`USD issued by ${ISSUER} · XRP is native`);
    const address = within(line as HTMLElement).getByRole("link", { name: ISSUER });
    expect(address.getAttribute("href")).toBe(`/xrpl/account/${ISSUER}`);
    expect(address.classList.contains("mono")).toBe(true);
  });

  it("names two issuers when both sides are issued, and an undecodable code in full", () => {
    const hex = "0123456789ABCDEF0123456789ABCDEF01234567";
    mount(
      page({
        head: head({
          issuers: [
            { code: "EUR", address: EUR_ISSUER, href: `/xrpl/account/${EUR_ISSUER}` },
            { code: hex, address: ISSUER, href: `/xrpl/account/${ISSUER}` },
          ],
          natives: [],
        }),
      }),
    );
    expect(summary().querySelector(".pair__issuers")!.textContent).toBe(`EUR issued by ${EUR_ISSUER} · ${hex} issued by ${ISSUER}`);
    expect(within(summary()).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      INVERTED,
      `/xrpl/account/${EUR_ISSUER}`,
      `/xrpl/account/${ISSUER}`,
    ]);
  });

  it("shows the last price with its unit, the change after a triangle, and '24 h'", () => {
    mount(page());
    const price = summary().querySelector(".pair__price")!;
    expect(price.querySelector(".pair__figure")!.textContent).toBe("2.4395");
    expect(price.querySelector(".pair__unit")!.textContent).toBe("USD per XRP");
    const change = summary().querySelector(".pair__change")!;
    expect(change.querySelector(".pair__delta")!.textContent).toBe("+1.84%");
    expect(change.querySelector(".pair__delta svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(change.querySelector(".faint")!.textContent).toBe("24 h");
  });

  it("points the triangle down for a fall and draws none for no change", () => {
    mount(page({ stats: withChange({ text: "−1.84%", dir: "down" }) }));
    expect(summary().querySelector(".pair__delta")!.textContent).toBe("−1.84%");
    expect(summary().querySelectorAll(".pair__delta svg")).toHaveLength(1);
    cleanup();
    mount(page({ stats: withChange({ text: "0.00%", dir: "flat" }) }));
    expect(summary().querySelector(".pair__delta svg")).toBeNull();
  });

  it("says the price's note: no trade yet, or the day of an old last trade", () => {
    mount(page({ price: { text: "—", unit: "USD per XRP", note: "No trades yet", token: "p" }, stats: withChange(null) }));
    expect(summary().querySelector(".pair__figure")!.textContent).toBe("—");
    expect(summary().querySelector(".pair__note")!.textContent).toBe("No trades yet");
    expect(summary().querySelector(".pair__delta")!.textContent).toBe("—");
    cleanup();
    mount(page({ price: { ...page().price, note: "last trade 2026-10-03" } }));
    expect(summary().querySelector(".pair__note")!.textContent).toBe("last trade 2026-10-03");
  });

  it("has the six 24 h figures, labels and values in the board's order", () => {
    mount(page());
    const stats = summary().querySelector(".pair__stats")!;
    expect(Array.from(stats.querySelectorAll("dt"), (dt) => dt.textContent)).toEqual(STATS.map((s) => s.label));
    expect(Array.from(stats.querySelectorAll("dd"), (dd) => dd.textContent)).toEqual(STATS.map((s) => s.value));
    expect(Array.from(stats.querySelectorAll("dd")).every((dd) => dd.classList.contains("mono"))).toBe(true);
    expect(within(summary()).queryByRole("alert")).toBeNull();
  });

  it("says when the 24 hours had no trade", () => {
    mount(page({ stats: { state: "ok", items: STATS, note: "No trades in the last 24 hours.", change: null, token: "s" } }));
    expect(within(summary()).getByText("No trades in the last 24 hours.")).toBeTruthy();
  });

  it("reads '—' in the six figures and the change when the 24 h figures failed, with one error and a Retry that asks the route again", async () => {
    const loader = vi.fn(() => null);
    mount(page({ stats: FAILED_STATS }), { loader });
    expect(["24 h high", "24 h low", "VWAP 24 h", "Volume XRP", "Volume USD", "Trades 24 h"].map(stat)).toEqual(Array(6).fill("—"));
    const alerts = within(summary()).getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.querySelector(".notice__body")!.textContent).toBe("Couldn’t load the 24 h figures.");
    expect(summary().querySelector(".pair__delta")!.textContent).toBe("—");
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alerts[0]!).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });
});

describe("MarketPairPage, the Trades filter", () => {
  it("has the Trades filter as segmented links, the view's own aria-current, and its note", () => {
    mount(page());
    const group = screen.getByRole("group", { name: "Trades" });
    expect(within(group).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["All", PAIR, "true"],
      ["Order book", `${PAIR}?trades=book`, null],
      ["AMM", `${PAIR}?trades=amm`, null],
    ]);
    expect(group.closest(".seglinks")).not.toBeNull();
    expect(screen.getByText("Applies to the chart, the 24 h figures and the trade list.")).toBeTruthy();
  });

  it("is not there while the AMM parts are off, nor on Xahau", () => {
    mount(NO_AMM());
    expect(screen.queryByRole("group", { name: "Trades" })).toBeNull();
    expect(screen.queryByText(/Applies to the chart/)).toBeNull();
    cleanup();
    mount(XAHAU_PAGE(), { network: XAHAU });
    expect(screen.queryByRole("group", { name: "Trades" })).toBeNull();
  });
});

describe("MarketPairPage, the price chart", () => {
  it("is a chart card 'Price' with its source, the candles and their volume, the legend, and a Chart/Table toggle", () => {
    const { container } = mount(page());
    const price = card("Price");
    expect(price.querySelector(".chart__source")!.textContent).toBe("/v2/exchanges/{base}/{counter}?interval=1hour");
    expect(price.querySelectorAll(".plot")).toHaveLength(2);
    expect(price.querySelectorAll(".candle")).toHaveLength(4);
    expect(within(price).getByRole("group", { name: "Price: view" })).toBeTruthy();
    expect(within(within(price).getByRole("list", { name: "Legend" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Closed higher",
      "Closed lower",
      "Volume (XRP)",
    ]);
    // The table view has the candles too.
    expect(price.querySelector(".chart__table [role='table']")).not.toBeNull();
    expect(container.querySelector(".candles__readout")).not.toBeNull();
  });

  it("has the candle interval as segmented links in one group named by its hidden label, nothing nested", () => {
    mount(page());
    const price = card("Price");
    const group = within(price).getByRole("group", { name: "Candle interval" });
    expect(within(group).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("aria-current")])).toEqual([
      ["15 m", null],
      ["1 h", "true"],
      ["4 h", null],
      ["1 d", null],
      ["1 w", null],
    ]);
    expect(within(price).getByText("Candle interval").className).toBe("seglinks__label sr");
    expect(group.parentElement!.closest('[role="group"]')).toBeNull();
    expect(price.querySelectorAll('[role="group"]')).toHaveLength(1);
  });

  it("says the data's empty words when no candle is drawn", () => {
    const none = { ...candleData(), candles: BUCKETS.map(() => null) };
    mount(page({ candles: { state: "ok", data: none, source: "/v2/exchanges/{base}/{counter}?interval=1hour", empty: "No trades in these 60 hours" } }));
    expect(card("Price").querySelector(".plot__empty")!.textContent).toBe("No trades in these 60 hours");
  });

  it("says it could not load the price chart in place of the views, the toggle and the interval control", async () => {
    const loader = vi.fn(() => null);
    mount(page({ candles: FAILED_CANDLES }), { loader });
    const price = card("Price");
    const alert = within(price).getByRole("alert");
    expect(alert.querySelector(".notice__body")!.textContent).toBe("Couldn’t load the price chart.");
    // The source is the data's, the failed part's own.
    expect(price.querySelector(".chart__source")!.textContent).toBe("/v2/exchanges/{base}/{counter}?interval=1hour");
    expect(price.querySelector(".plot, .chart__toggle, .legend")).toBeNull();
    expect(within(price).queryByRole("group", { name: "Candle interval" })).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBeGreaterThan(0));
  });
});

describe("MarketPairPage, the recent trades", () => {
  it("is a card 'Recent trades' with its source and a live table of the board's columns, 720 px at its least", () => {
    mount(page());
    const trades = card("Recent trades");
    expect(trades.querySelector(".chart__source")!.textContent).toBe("/v2/exchanges/{base}/{counter}?descending=true");
    expect(within(tradesTable()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Time (UTC)",
      "Side",
      "Price",
      "XRP",
      "USD",
      "Taker",
      "Via",
    ]);
    expect(tradesTable().style.minWidth).toBe("720px");
    // `live`: each row carries its key for the rows that enter and move.
    expect(within(tradesTable()).getAllByRole("row").slice(1).map((row) => row.getAttribute("data-key"))).toEqual(TRADES.map((t) => t.key));
  });

  it("has a row for each trade, with the side in text and the Via as a tag", () => {
    mount(page());
    const rows = within(tradesTable()).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["2026-10-17 15:42:51, transaction 76018A…D8AB", "Buy", "2.4395", "1,000", "2,439.5", shortAddress(TAKER), "AMM"],
      ["2026-10-17 15:42:40, transaction 76018A…D8AB", "Sell", "2.4391", "250.5", "611.0", shortAddress(SECOND), "Book"],
      ["2026-10-17 15:41:02, transaction 76018A…D8AB", "—", "2.4395", "1,000", "2,439.5", shortAddress(TAKER), "Book"],
    ]);
    const tags = rows.map((row) => row.querySelector(".tag"));
    expect(tags.map((tag) => tag?.textContent)).toEqual(["AMM", "Book", "Book"]);
  });

  it("links the time to the transaction, the name starting with the visible time and the rest hidden", () => {
    mount(page());
    // The hidden part is a box of its own (`.sr` is absolutely positioned), so the name computation may put a space before it.
    const time = within(tradesTable()).getAllByRole("link", { name: /^2026-10-17 15:42:51 ?, transaction 76018A…D8AB$/ })[0]!;
    expect(time.getAttribute("href")).toBe(`/xrpl/tx/${hash("1")}`);
    expect(time.classList.contains("mono")).toBe(true);
    expect(time.querySelector(".sr")!.textContent).toBe(", transaction 76018A…D8AB");
    expect(time.firstChild!.textContent).toBe("2026-10-17 15:42:51");
  });

  it("marks the side with a 6 px dot that is a picture, up for Buy and down for Sell, and none for a dash", () => {
    mount(page());
    const rows = within(tradesTable()).getAllByRole("row").slice(1);
    const dots = rows.map((row) => row.querySelector(".pair__dot"));
    expect(dots.map((dot) => dot?.getAttribute("data-dir") ?? null)).toEqual(["up", "down", null]);
    expect(dots.slice(0, 2).every((dot) => dot!.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("links the taker to the account page in the short form", () => {
    mount(page());
    const taker = within(tradesTable()).getAllByRole("link", { name: shortAddress(SECOND) })[0]!;
    expect(taker.getAttribute("href")).toBe(`/xrpl/account/${SECOND}`);
  });

  it("pages with Newer and Older as the data gives them", () => {
    mount(page());
    const pager = within(card("Recent trades")).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).queryByRole("link", { name: /Newer/ })).toBeNull();
    expect(within(pager).getByRole("link", { name: /Older/ }).getAttribute("href")).toBe(`${PAIR}?marker=M1`);
  });

  it("has no Via column while the AMM parts are off", () => {
    mount(NO_AMM());
    expect(within(tradesTable()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Time (UTC)", "Side", "Price", "XRP", "USD", "Taker"]);
    expect(tradesTable().querySelector(".tag")).toBeNull();
  });

  it("says so when the list has no trade, in the view data's words", () => {
    mount(page({ trades: { ...page().trades, rows: [], paging: { newerHref: null, olderHref: null } } }));
    expect(within(card("Recent trades")).getByText("No trades yet.")).toBeTruthy();
    cleanup();
    mount(page({ trades: { ...page().trades, rows: [], paging: { newerHref: null, olderHref: null }, empty: "No AMM swaps yet." } }));
    expect(within(card("Recent trades")).getByText("No AMM swaps yet.")).toBeTruthy();
    expect(within(card("Recent trades")).queryByText("No trades yet.")).toBeNull();
  });
});

describe("MarketPairPage, the order book", () => {
  it("is a card 'Order book' whose source names the node's call and the ledger", () => {
    mount(page());
    const book = card("Order book");
    expect(book.querySelector(".chart__source")!.textContent).toBe("live from the node · book_offers · ledger #107,721,455");
  });

  it("is one ARIA table 'Order book' over rows of a grid: the asks best last, the middle row, the bids best first", () => {
    mount(page());
    expect(bookTable().tagName).toBe("DIV");
    expect(card("Order book").querySelector("table, tr, td, th")).toBeNull();
    const [head, asks, middle, bids] = bookGroups();
    expect(bookGroups()).toHaveLength(4);
    expect(within(head!).getAllByRole("row")).toHaveLength(1);
    expect(groupRows(asks!)).toEqual([
      ["Ask", "2.46", "3K", "5K"],
      ["Ask", "2.45", "800", "2K"],
      ["Ask", "2.44", "1.2K", "1.2K"],
    ]);
    expect(groupRows(middle!)).toEqual([["Last price", "2.4395", "spread 0.05"]]);
    expect(within(middle!).getAllByRole("cell")[2]!.getAttribute("aria-colspan")).toBe("2");
    expect(groupRows(bids!)).toEqual([
      ["Bid", "2.39", "1K", "1K"],
      ["Bid", "2.38", "2.5K", "3.5K"],
    ]);
  });

  it("has the columns Price, the base and Total, and a Side column that only a screen reader reads", () => {
    mount(page());
    const headers = within(bookTable()).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Side", "Price", "XRP", "Total"]);
    expect(headers[0]!.querySelector(".sr")!.textContent).toBe("Side");
    const [, asks, middle, bids] = bookGroups();
    const sides = [asks!, middle!, bids!].flatMap((group) => within(group).getAllByRole("row").map((row) => within(row).getAllByRole("cell")[0]!));
    expect(sides.map((cell) => cell.textContent)).toEqual(["Ask", "Ask", "Ask", "Last price", "Bid", "Bid"]);
    expect(sides.every((cell) => cell.querySelector(".sr")?.textContent === cell.textContent)).toBe(true);
  });

  it("draws one depth bar per level, as the row's first child: the asks' in the down wash and the bids' in the up wash, as wide as the depth", () => {
    mount(page());
    const [head, asks, middle, bids] = bookGroups();
    const bars = (group: HTMLElement) =>
      within(group)
        .getAllByRole("row")
        .map((row) => {
          const found = row.querySelectorAll(".inline-bar");
          expect(found).toHaveLength(1);
          // InlineBar's contract: the bar is the row's first child, and the row is the box it is placed in.
          expect(row.firstElementChild).toBe(found[0]);
          return [found[0]!.className, (found[0] as HTMLElement).style.width, found[0]!.getAttribute("aria-hidden")];
        });
    expect(bars(asks!)).toEqual([
      ["inline-bar inline-bar--down", "100%", "true"],
      ["inline-bar inline-bar--down", "40%", "true"],
      ["inline-bar inline-bar--down", "24%", "true"],
    ]);
    expect(head!.querySelector(".inline-bar")).toBeNull();
    expect(middle!.querySelector(".inline-bar")).toBeNull();
    expect(bars(bids!)).toEqual([
      ["inline-bar inline-bar--up", "20%", "true"],
      ["inline-bar inline-bar--up", "70%", "true"],
    ]);
  });

  it("says 'No asks' or 'No bids' for a side with no offer, and the spread's dash", () => {
    mount(page({ book: { state: "ok", source: BOOK_SOURCE, ledger: "107,721,455", asks: [], bids: BIDS, spread: "—", token: "b" } }));
    const [, asks, middle] = bookGroups();
    expect(groupRows(asks!)).toEqual([["No asks"]]);
    expect(within(asks!).getByRole("cell").getAttribute("aria-colspan")).toBe("4");
    expect(asks!.querySelector(".inline-bar")).toBeNull();
    expect(groupRows(middle!)).toEqual([["Last price", "2.4395", "spread —"]]);
    cleanup();
    mount(page({ book: { state: "ok", source: BOOK_SOURCE, ledger: "107,721,455", asks: ASKS, bids: [], spread: "—", token: "b" } }));
    expect(groupRows(bookGroups()[3]!)).toEqual([["No bids"]]);
  });

  it("has the board's notes, the second on XRPL only", () => {
    mount(page());
    const notes = Array.from(card("Order book").querySelectorAll(".pair__notes p"), (p) => p.textContent);
    expect(notes).toEqual(["Asks on top, bids below; the bar is the size on the book up to that price.", "AMM pool liquidity is not in this book; see the pool."]);
    cleanup();
    mount(XAHAU_PAGE(), { network: XAHAU });
    expect(Array.from(card("Order book").querySelectorAll(".pair__notes p"), (p) => p.textContent)).toEqual([
      "Asks on top, bids below; the bar is the size on the book up to that price.",
    ]);
  });

  it("says 'Live state unavailable' when the book could not be read, with no role, and a Retry that asks the route again", async () => {
    const loader = vi.fn(() => null);
    mount(page({ book: FAILED_BOOK }), { loader });
    const book = card("Order book");
    expect(within(book).queryByRole("table")).toBeNull();
    const notice = book.querySelector(".notice")!;
    expect(notice.className).toBe("notice notice--warning");
    expect(notice.hasAttribute("role")).toBe(false);
    expect(notice.querySelector(".notice__title")!.textContent).toBe("Live state unavailable");
    expect(notice.querySelector(".notice__body")!.textContent).toBe(`Live state unavailable${BOOK_BODY}`);
    expect(book.querySelector(".chart__source")!.textContent).toBe("live from the node · book_offers");
    expect(book.querySelector(".pair__notes")).toBeNull();
    const calls = loader.mock.calls.length;
    fireEvent.click(within(book).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });
});

describe("MarketPairPage, the pool card", () => {
  it("is a section with the pool's title and source, its figures, and one link, the data's", () => {
    mount(page());
    const pool = region("XRP/USD AMM pool");
    expect(pool.tagName).toBe("SECTION");
    expect(pool.querySelector(".chart__source")!.textContent).toBe("live from the node · amm_info · ledger #107,721,456");
    const figures = Array.from(pool.querySelectorAll(".pair__figures > div"), (row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]);
    expect(figures).toEqual([
      ["Reserves", "1.8M XRP · 4.39M USD"],
      ["Pool price", "2.4393 USD"],
      ["Trading fee", "0.300%"],
      ["Share of pair volume, 24 h", "34%"],
    ]);
    const links = within(pool).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Pool account →", `/xrpl/account/${POOL}`]]);
  });

  it("takes the link as the data gives it: 'Pool page →' while the pool pages are on", () => {
    const ok = page().pool as Extract<LivePairData["pool"], { state: "ok" }>;
    mount(page({ pool: { ...ok, link: { href: `/xrpl/amm/${POOL}`, label: "Pool page →" } } }));
    expect(within(region("XRP/USD AMM pool")).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Pool page →", `/xrpl/amm/${POOL}`],
    ]);
  });

  it("shows the pool's price as the data writes it, its unit and a dash included", () => {
    const ok = page().pool as Extract<LivePairData["pool"], { state: "ok" }>;
    const price = () =>
      Array.from(region("XRP/USD AMM pool").querySelectorAll(".pair__figures > div"))
        .find((r) => r.querySelector("dt")!.textContent === "Pool price")!
        .querySelector("dd")!.textContent;
    for (const text of ["—", "0.40995368 XRP"]) {
      mount(page({ pool: { ...ok, price: text } }));
      expect(price()).toBe(text);
      cleanup();
    }
  });

  it("reads '—' and 'Couldn’t load' for a share that failed, and has no share line while the AMM parts are off", () => {
    mount(page({ share: FAILED_SHARE }));
    const share = Array.from(region("XRP/USD AMM pool").querySelectorAll(".pair__figures > div")).at(-1)!;
    expect(share.querySelector("dt")!.textContent).toBe("Share of pair volume, 24 h");
    expect(share.querySelector(".pair__figure-value")!.textContent).toBe("—");
    expect(share.querySelector(".pair__figure-sub")!.textContent).toBe("Couldn’t load");
    cleanup();
    mount(NO_AMM());
    expect(within(region("XRP/USD AMM pool")).queryByText("Share of pair volume, 24 h")).toBeNull();
  });

  it("is not there when the node has no pool for the pair", () => {
    mount(page({ pool: { state: "missing" } }));
    expect(screen.queryByRole("region", { name: /AMM pool/ })).toBeNull();
    expect(screen.queryByText("XRP/USD AMM pool")).toBeNull();
    expect(screen.queryByText("Pool account →")).toBeNull();
  });

  it("says 'Live state unavailable' when the pool could not be read, with no role, and a Retry", async () => {
    const loader = vi.fn(() => null);
    mount(page({ pool: FAILED_POOL }), { loader });
    const pool = region("XRP/USD AMM pool");
    const notice = pool.querySelector(".notice")!;
    expect(notice.hasAttribute("role")).toBe(false);
    expect(notice.querySelector(".notice__body")!.textContent).toBe(`Live state unavailable${POOL_BODY}`);
    expect(pool.querySelector(".chart__source")!.textContent).toBe("live from the node · amm_info");
    expect(pool.querySelector(".pair__figures")).toBeNull();
    expect(within(pool).queryByRole("link")).toBeNull();
    const calls = loader.mock.calls.length;
    fireEvent.click(within(pool).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });
});

describe("MarketPairPage, the data's own words", () => {
  it("labels the failed 24 h figures, titles the failed pool and writes every source line as the data gives them", () => {
    const labels = ["24 h high", "24 h low", "VWAP 24 h", "Volume LP token", "Volume RLUSD", "Trades 24 h"];
    mount(
      page({
        stats: { state: "failed", labels },
        candles: { state: "failed", source: "/v2/exchanges/{base}/{counter}?interval=7day&amm=only" },
        book: { state: "failed", source: "the book's source" },
        pool: { state: "failed", title: "LP token/RLUSD AMM pool", source: "the pool's source" },
        traders: { state: "failed", source: "the traders' source" },
      }),
    );
    expect(Array.from(summary().querySelectorAll(".pair__stat dt"), (dt) => dt.textContent)).toEqual(labels);
    expect(card("Price").querySelector(".chart__source")!.textContent).toBe("/v2/exchanges/{base}/{counter}?interval=7day&amm=only");
    expect(card("Order book").querySelector(".chart__source")!.textContent).toBe("the book's source");
    expect(region("LP token/RLUSD AMM pool").querySelector(".chart__source")!.textContent).toBe("the pool's source");
    expect(card("Most active traders, 24 h").querySelector(".chart__source")!.textContent).toBe("the traders' source");
  });

  it("puts the ledger after the loaded book's and pool's source lines, as a figure of its own", () => {
    const ok = page().pool as Extract<LivePairData["pool"], { state: "ok" }>;
    const book = page().book as Extract<LivePairData["book"], { state: "ok" }>;
    mount(page({ book: { ...book, source: "book up to #" }, pool: { ...ok, source: "pool up to #" } }));
    const source = (element: Element) => element.querySelector(".chart__source")!;
    expect(source(card("Order book")).textContent).toBe("book up to #107,721,455");
    expect(source(card("Order book")).querySelector(".live__value")!.textContent).toBe("107,721,455");
    expect(source(region("XRP/USD AMM pool")).textContent).toBe("pool up to #107,721,456");
    expect(source(region("XRP/USD AMM pool")).querySelector(".live__value")!.textContent).toBe("107,721,456");
  });
});

describe("MarketPairPage, the most active traders", () => {
  it("is a card with its source, the top accounts as links with their volume and trades, then the note", () => {
    mount(page());
    const traders = card("Most active traders, 24 h");
    expect(traders.querySelector(".chart__source")!.textContent).toBe("/v2/active_accounts/{base}/{counter}");
    const items = within(traders).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".barlist__tip")!.textContent)).toEqual(["6.1M XRP · 312 trades", "2M XRP · 41 trades"]);
    expect(within(traders).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      [shortAddress(TAKER), `/xrpl/account/${TAKER}`],
      [shortAddress(SECOND), `/xrpl/account/${SECOND}`],
    ]);
    expect(traders.querySelector(".pair__note")!.textContent).toBe(TRADERS_NOTE);
  });

  it("says it could not load the most active traders, with a Retry", async () => {
    const loader = vi.fn(() => null);
    mount(page({ traders: FAILED_TRADERS }), { loader });
    const traders = card("Most active traders, 24 h");
    const alert = within(traders).getByRole("alert");
    expect(alert.querySelector(".notice__body")!.textContent).toBe("Couldn’t load the most active traders.");
    expect(traders.querySelector(".barlist, .pair__note")).toBeNull();
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });
});

describe("MarketPairPage, the Retry of its section errors", () => {
  it("says Retrying… on each section error while a press's own revalidation runs, and not for a beat it did not start", async () => {
    let release: () => void = () => {};
    let held: Promise<null> | null = null;
    const loader = vi.fn(() => held);
    const { router } = mount(page({ stats: FAILED_STATS, candles: FAILED_CANDLES, traders: FAILED_TRADERS }), { loader });
    const hold = () => (held = new Promise<null>((resolve) => (release = () => resolve(null))));
    const errorButtons = () => screen.getAllByRole("alert").map((alert) => within(alert).getByRole("button") as HTMLButtonElement);
    expect(errorButtons()).toHaveLength(3);

    // A beat (the live page's revalidation) leaves every Retry as it was: enabled, and named Retry.
    hold();
    await act(async () => void router.revalidate());
    expect(router.state.revalidation).toBe("loading");
    expect(errorButtons().map((button) => [button.textContent, button.disabled])).toEqual(Array(3).fill(["Retry", false]));
    await act(async () => release());
    await waitFor(() => expect(router.state.revalidation).toBe("idle"));

    // A press: the page's data is asked for again, and the three say so until it has come (they ask for the same data).
    hold();
    fireEvent.click(errorButtons()[1]!);
    await waitFor(() => expect(errorButtons().map((button) => [button.textContent, button.disabled])).toEqual(Array(3).fill(["Retrying…", true])));
    await act(async () => release());
    await waitFor(() => expect(errorButtons().map((button) => [button.textContent, button.disabled])).toEqual(Array(3).fill(["Retry", false])));
  });
});

describe("MarketPairPage, the board's order", () => {
  it("has the summary, the filters, the price, the trades, then the book, the pool and the traders beside them", () => {
    mount(page());
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "XRP / USD",
      "Price",
      "Recent trades",
      "Order book",
      "XRP/USD AMM pool",
      "Most active traders, 24 h",
    ]);
    // The trades and the cards beside them wrap: the trades card, and a column of the others.
    const main = card("Recent trades");
    const side = card("Order book").parentElement!;
    expect(main.classList.contains("pair__main")).toBe(true);
    expect(side.className).toBe("pair__side");
    expect(main.parentElement).toBe(side.parentElement);
    expect(main.parentElement!.className).toBe("pair__body");
    expect(Array.from(side.children, (child) => child.querySelector("h2")!.textContent)).toEqual(["Order book", "XRP/USD AMM pool", "Most active traders, 24 h"]);
  });
});

// ---- Beats ------------------------------------------------------------------------------------------------------------------------------

describe("MarketPairPage, what a beat moves", () => {
  let update!: (next: PairPageData) => void;
  function Host({ first }: { first: PairPageData }) {
    const [current, setCurrent] = useState(first);
    update = (next) => act(() => setCurrent(next));
    return <MarketPairPage network={XRPL} data={current} />;
  }
  const mountHost = (first: PairPageData = page()) =>
    render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <Host first={first} /> }], { initialEntries: [PAIR] })} />);
  const changed = (container: HTMLElement) => Array.from(container.querySelectorAll(".is-changed"), (element) => element.textContent);

  it("animates nothing on the first render, on the server or in the browser", () => {
    const { container } = mountHost();
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(renderToString(routed(<MarketPairPage network={XRPL} data={page()} />))).not.toMatch(/is-entering|is-changed/);
  });

  it("ticks in the price, and the book's middle row with it", () => {
    const { container } = mountHost();
    update(page({ price: { ...page().price, text: "2.4401", token: "price-2" } }));
    expect(changed(container)).toEqual(["2.4401", "2.4401"]);
    expect(summary().querySelector(".pair__figure .is-changed")).not.toBeNull();
  });

  it("ticks in the change, and only the 24 h figure that moved", () => {
    const { container } = mountHost();
    const items = STATS.map((s) => (s.label === "Trades 24 h" ? { ...s, value: "8,413" } : s));
    update(page({ stats: { state: "ok", items, note: null, change: { text: "+1.90%", dir: "up" }, token: "stats-2" } }));
    expect(changed(container).sort()).toEqual(["+1.90%", "8,413"]);
  });

  it("ticks in the spread and the book's ledger, and redraws the levels in place", () => {
    const { container } = mountHost();
    const levels = [level("2.43", "1K", "1K", "0.2"), ...ASKS.slice(1)];
    update(page({ book: { state: "ok", source: BOOK_SOURCE, ledger: "107,721,456", asks: levels, bids: BIDS, spread: "0.04", token: "book-2" } }));
    expect(changed(container).sort()).toEqual(["0.04", "107,721,456"]);
    expect(groupRows(bookGroups()[1]!).at(-1)).toEqual(["Ask", "2.43", "1K", "1K"]);
  });

  it("ticks in the pool's ledger, and not its figures", () => {
    const { container } = mountHost();
    const ok = page().pool as Extract<LivePairData["pool"], { state: "ok" }>;
    update(page({ pool: { ...ok, ledger: "107,721,460", reserves: "1.9M XRP · 4.4M USD", token: "pool-2" } }));
    expect(changed(container)).toEqual(["107,721,460"]);
    expect(region("XRP/USD AMM pool").querySelector(".chart__source")!.textContent).toBe("live from the node · amm_info · ledger #107,721,460");
  });

  it("redraws the candles of a new token with no ring (mark={false})", () => {
    const { container } = mountHost();
    update(page({ candles: { state: "ok", data: candleData("candles-2", "2.47"), source: "/v2/exchanges/{base}/{counter}?interval=1hour", empty: null } }));
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    expect(card("Price").querySelector(".candles__readout")!.textContent).toContain("C 2.47 USD");
  });

  it("ticks in a 24 h figure that comes back after failing, and the change that comes back with them", () => {
    const { container } = mountHost(page({ stats: FAILED_STATS }));
    update(page());
    expect(changed(container)).toEqual([CHANGE.text, ...STATS.map((s) => s.value)]);
    expect(within(summary()).queryByRole("alert")).toBeNull();
  });
});

describe("MarketPairPage, refetching", () => {
  it("dims its charts while another view is loading, and not while it only follows the chain", async () => {
    let release!: () => void;
    let held: Promise<null> | null = null;
    const router = createMemoryRouter([{ path: "*", element: <MarketPairPage network={XRPL} data={page()} />, loader: () => held }], {
      initialEntries: [PAIR],
      hydrationData: { loaderData: { "0": null } },
    });
    const { container } = render(<RouterProvider router={router} />);
    const dimmed = () => container.querySelector(".pair")!.classList.contains("is-refetching");
    expect(dimmed()).toBe(false);

    // A beat is a revalidation: the page follows the chain and is not dimmed.
    held = new Promise<null>((resolve) => (release = () => resolve(null)));
    await act(async () => void router.revalidate());
    expect(router.state.revalidation).toBe("loading");
    expect(dimmed()).toBe(false);
    await act(async () => release());

    // Another interval of the same pair is another view of this page: dimmed until it comes.
    held = new Promise<null>((resolve) => (release = () => resolve(null)));
    await act(async () => void router.navigate(`${PAIR}?interval=4h`));
    expect(dimmed()).toBe(true);
    await act(async () => release());
    expect(dimmed()).toBe(false);
  });
});

// ---- The hold ---------------------------------------------------------------------------------------------------------------------------

describe("MarketPairPage, the hold", () => {
  const calls: boolean[] = [];
  /** A route that keeps `held` as `useLiveControls` does: what the page's holds say, it shows. */
  function Held({ data }: { data: PairPageData }) {
    const [held, setHeld] = useState(false);
    const live = controls({
      held,
      onHold: (on: boolean) => {
        calls.push(on);
        setHeld(on);
      },
    });
    return <MarketPairPage network={XRPL} data={data} live={live} />;
  }
  const mountHeld = () => {
    calls.length = 0;
    return render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <Held data={page()} /> }], { initialEntries: [PAIR] })} />);
  };
  const trades = () => tradesTable().closest(".pair__hold") as HTMLElement;
  const traders = () => card("Most active traders, 24 h").querySelector(".pair__hold") as HTMLElement;
  const note = (container: HTMLElement) => container.querySelector(".hero__held")?.textContent ?? null;

  it("holds while a mouse is over the trades table, says so, and lets go when it leaves", () => {
    const { container } = mountHeld();
    expect(note(container)).toBeNull();
    fireEvent.pointerEnter(trades(), { pointerType: "mouse" });
    expect(calls).toEqual([true]);
    expect(note(container)).toBe("Paused while you look at the trades");
    fireEvent.pointerLeave(trades(), { pointerType: "mouse" });
    expect(calls).toEqual([true, false]);
    expect(note(container)).toBeNull();
  });

  it("holds while a mouse is over the traders list, and says it is the traders", () => {
    const { container } = mountHeld();
    fireEvent.pointerEnter(traders(), { pointerType: "pen" });
    expect(calls).toEqual([true]);
    expect(note(container)).toBe("Paused while you look at the traders");
  });

  it("holds while keyboard focus is on a link in the traders list or the trades table, naming the part", () => {
    const { container } = mountHeld();
    act(() => within(traders()).getAllByRole("link")[0]!.focus());
    expect(calls.at(-1)).toBe(true);
    expect(note(container)).toBe("Paused while you look at the traders");
    act(() => within(trades()).getAllByRole("link")[0]!.focus());
    expect(calls.at(-1)).toBe(true);
    expect(note(container)).toBe("Paused while you look at the trades");
    act(() => (document.activeElement as HTMLElement).blur());
    expect(calls.at(-1)).toBe(false);
    expect(note(container)).toBeNull();
  });

  it("is not for a finger", () => {
    mountHeld();
    fireEvent.pointerEnter(trades(), { pointerType: "touch" });
    fireEvent.pointerEnter(traders(), { pointerType: "touch" });
    expect(calls).toEqual([]);
  });

  it("is not held by the book or the chart, which have no links", () => {
    mountHeld();
    fireEvent.pointerEnter(card("Order book"), { pointerType: "mouse" });
    fireEvent.pointerEnter(card("Price"), { pointerType: "mouse" });
    expect(calls).toEqual([]);
  });

  it("lets go when the page goes away, whatever was held", () => {
    const { unmount } = mountHeld();
    fireEvent.pointerEnter(traders(), { pointerType: "mouse" });
    expect(calls.at(-1)).toBe(true);
    unmount();
    expect(calls.at(-1)).toBe(false);
  });

  it("tells nobody when there is nobody to tell", () => {
    mount(page());
    expect(() => fireEvent.pointerEnter(tradesTable().closest(".pair__hold")!, { pointerType: "mouse" })).not.toThrow();
  });
});

// ---- Behind a marker --------------------------------------------------------------------------------------------------------------------

describe("MarketPairPage behind a marker", () => {
  it("has the breadcrumb, the h1, the issuer line, the note with its link, and the trades with their pager", () => {
    mount(older());
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "XRPL/",
      "Markets/",
      "XRP/USD",
    ]);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["XRP / USD"]);
    expect(document.querySelector(".pair__issuers")!.textContent).toBe(`USD issued by ${ISSUER} · XRP is native`);
    const note = document.querySelector(".pair__older")!;
    expect(note.textContent).toBe("Older trades of XRP/USD. The price, chart and order book are on the market's page.");
    expect(within(note as HTMLElement).getByRole("link", { name: "the market's page" }).getAttribute("href")).toBe(PAIR);
    expect(within(tradesTable()).getAllByRole("row")).toHaveLength(4);
    const pager = within(card("Recent trades")).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: /Newer/ }).getAttribute("href")).toBe(PAIR);
    expect(within(pager).getByRole("link", { name: /Older/ }).getAttribute("href")).toBe(`${PAIR}?marker=M2&back=M1`);
  });

  it("has no live row, no price, chart, book, pool or traders, and no invert link", () => {
    const { container } = mount(older(), { live: controls() });
    expect(container.querySelector(".hero__status-row")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Recent trades"]);
    expect(screen.queryByRole("link", { name: "Show USD/XRP" })).toBeNull();
    expect(container.querySelector(".pair__price, .pair__stats")).toBeNull();
    // The rows of an old page do not follow the chain.
    expect(within(tradesTable()).getAllByRole("row")[1]!.hasAttribute("data-key")).toBe(false);
  });

  it("has the Via column while the AMM parts are on, and none while they are off", () => {
    mount(older());
    expect(within(tradesTable()).getAllByRole("columnheader").map((h) => h.textContent)).toContain("Via");
    cleanup();
    mount(older({ ammParts: false, trades: { ...older().trades, rows: TRADES.map((row) => ({ ...row, via: null })) } }));
    expect(within(tradesTable()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Time (UTC)", "Side", "Price", "XRP", "USD", "Taker"]);
    expect(tradesTable().querySelector(".tag")).toBeNull();
  });

  it("reads the Via column's presence from the data, not from the rows: an empty list of an AMM page still has it", () => {
    mount(older({ trades: { ...older().trades, rows: [] } }));
    expect(within(tradesTable()).getAllByRole("columnheader").map((h) => h.textContent)).toContain("Via");
  });

  it("puts the link after the note's text when its words are not in it", () => {
    mount(older({ note: { text: "Older trades of XRP/USD.", link: "Back to the market", href: PAIR } }));
    const note = document.querySelector(".pair__older")!;
    expect(note.textContent).toBe("Older trades of XRP/USD. Back to the market");
    const link = within(note as HTMLElement).getByRole("link", { name: "Back to the market" });
    expect(link.getAttribute("href")).toBe(PAIR);
    expect(note.lastElementChild).toBe(link);
  });
});

// ---- On the server, then in the browser ---------------------------------------------------------------------------------------------------

describe("MarketPairPage, as the Worker prints it and the browser takes it over", () => {
  it("hydrates what the server printed with no mismatch, live and behind a marker, with every card loaded or failed", async () => {
    const cases: [Net, PairPageData][] = [
      [XRPL, page()],
      [XRPL, page(ALL_FAILED)],
      [XRPL, NO_AMM({ pool: { state: "missing" } })],
      [XAHAU, XAHAU_PAGE()],
      [XRPL, older()],
    ];
    for (const [network, data] of cases) {
      const { html, errors } = await serverThenHydrated(routed(<MarketPairPage network={network} data={data} live={controls()} />));
      expect(errors).toEqual([]);
      expect(html).toContain(data.head.heading);
      expect(html).not.toMatch(/is-entering|is-changed|aria-live/);
    }
  });

  it("prints the candles, the book, the trades and the traders in the server's HTML", () => {
    const html = renderToString(routed(<MarketPairPage network={XRPL} data={page()} />));
    expect(html).toContain('class="candle"');
    expect(html).toContain("inline-bar--down");
    expect(html).toContain("barlist__item");
    expect(html).toContain("2026-10-17 15:42:51");
  });
});
