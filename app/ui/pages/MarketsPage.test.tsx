import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import type { MarketRowView, MarketsPageData } from "../../server/markets-view";
import { count, DataTable, FIRST_ROWS } from "../components/DataTable";
import { FIRST_ROWS as LEDGER_FIRST_ROWS } from "./LedgerPage";
import { MarketsPage } from "./MarketsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH" } as const;
type Net = typeof XRPL | typeof XAHAU;

// ---- Page data, as the view builder makes it ---------------------------------------------------------------------------------------------

const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";

function row(over: Partial<MarketRowView> & Pick<MarketRowView, "key" | "pair">): MarketRowView {
  return {
    href: `/xrpl/markets/${over.key}`,
    issuers: "",
    last: "1",
    change: { text: "+1.00%", dir: "up" },
    range: "1 – 2",
    volume: "1K",
    trades: "10",
    amm: { text: "34%", meter: { value: "0.34", max: "1", label: "AMM share 34%" } },
    spark: { closes: ["1", "2", null, "3"], label: `7-day price of ${over.pair}`, token: `t:${over.key}` },
    search: over.pair.toLowerCase(),
    ranks: { last: 0, change: 0, volume: 0, trades: 0 },
    ...over,
  };
}

/**
 * Four rows in the API's order (by volume, largest first; a pair without a native volume last), whose ranks are not the order of their texts:
 * a page that compared the texts would sort them otherwise. Last price by rank: B, C, A (D has none). Change: A, D, C (B has none). Trades: D,
 * B, C, A.
 */
const FOUR: MarketRowView[] = [
  row({
    key: "A",
    pair: "AAA / XRP",
    issuers: `AAA ${"rAAAAA…AAAA"}`,
    last: "9",
    change: { text: "+5.00%", dir: "up" },
    volume: "10K",
    trades: "3",
    amm: { text: "34%", meter: { value: "0.34", max: "1", label: "AMM share 34%" } },
    search: "aaa/xrp aaa xrp raaaaa",
    ranks: { last: 0, change: 2, volume: 2, trades: 0 },
  }),
  row({
    key: "B",
    pair: "BBB / XRP",
    last: "10",
    change: { text: "−1.00%", dir: "down" },
    volume: "9K",
    trades: "12",
    amm: { text: "<1%", meter: { value: "0.004", max: "1", label: "AMM share <1%" } },
    search: "bbb/xrp bbb xrp",
    ranks: { last: 2, change: null, volume: 1, trades: 2 },
  }),
  row({
    key: "D",
    pair: "DDD / XRP",
    last: "2",
    change: { text: "+0.10%", dir: "up" },
    volume: "8K",
    trades: "20",
    amm: { text: "—", meter: null },
    search: "ddd/xrp ddd xrp",
    ranks: { last: null, change: 1, volume: 0, trades: 3 },
  }),
  row({
    key: "C",
    pair: "CCC / XRP",
    href: null,
    last: "100",
    change: { text: "0.00%", dir: "flat" },
    volume: "—",
    trades: "7",
    amm: { text: "no pool", meter: null },
    search: "ccc/xrp ccc xrp",
    ranks: { last: 1, change: 0, volume: null, trades: 1 },
  }),
];

/** 214 rows; every 18th is a USD pair (12 of them), the others match nothing of "usd". */
const MANY: MarketRowView[] = Array.from({ length: 214 }, (_, at) => {
  const usd = at % 18 === 0;
  const pair = usd ? "XRP / USD" : `T${at} / XRP`;
  return row({
    key: `K${at}`,
    pair,
    issuers: usd ? `USD rhub8V…zF3wq` : `T${at} rT${at}…`,
    search: usd ? `xrp/usd xrp usd ${ISSUER.toLowerCase()}` : `t${at}/xrp t${at} xrp rt${at}`,
    ranks: { last: at, change: at, volume: 213 - at, trades: at },
  });
});

const link = (label: string, href: string, current = false) => ({ label, href, current });

function page(over: Partial<MarketsPageData> = {}): MarketsPageData {
  return {
    intro: "Trades on the XRP Ledger DEX: order-book crossings and swaps against AMM pools.",
    filters: {
      period: [link("24 h", "/xrpl/markets", true), link("7 days", "/xrpl/markets?period=7d"), link("30 days", "/xrpl/markets?period=30d")],
      quote: [link("All", "/xrpl/markets", true), link("XRP", "/xrpl/markets?quote=xrp"), link("USD", "/xrpl/markets?quote=usd")],
      trades: [link("All", "/xrpl/markets", true), link("Order book", "/xrpl/markets?trades=book"), link("AMM", "/xrpl/markets?trades=amm")],
    },
    note: "Figures cover Oct 16, 17:00 to Oct 17, 17:01 UTC: the 24 hours from the start of an hour, recomputed every minute.",
    tiles: [
      { label: "DEX volume", value: "991K XRP", sub: "last 24 hours, pairs listed" },
      { label: "Trades", value: "880", sub: "last 24 hours, pairs listed" },
      { label: "Pairs shown", value: "4", sub: "of 157 with trades" },
      { label: "AMM share of volume", value: "12%", sub: "swaps against AMM pools" },
    ],
    source: "/v2/network/markets?period=day",
    rows: FOUR,
    empty: null,
    footnote: {
      left: "Pairs with at least 10 trades in the period. Volume in XRP: the XRP side of pairs against XRP, other pairs at the period's rate.",
      right: "Prices are counter per base.",
    },
    ammColumn: true,
    view: [],
    periodWords: "last 24 hours",
    indexable: true,
    ...over,
  };
}

const XAHAU_PAGE = (over: Partial<MarketsPageData> = {}) =>
  page({
    intro: "Trades on the Xahau DEX. Xahau has no AMM, so every trade is an order-book crossing.",
    filters: { period: page().filters.period, quote: [link("All", "/xahau/markets", true), link("XAH", "/xahau/markets?quote=xah")], trades: null },
    tiles: [
      { label: "DEX volume", value: "301K XAH", sub: "last 24 hours, pairs listed" },
      { label: "Trades", value: "267", sub: "last 24 hours, pairs listed" },
      { label: "Pairs shown", value: "4", sub: "of 37 with trades" },
      { label: "AMM share of volume", value: "—", sub: "Xahau has no AMM" },
    ],
    rows: FOUR.map((r) => ({ ...r, amm: null })),
    ammColumn: false,
    ...over,
  });

// ---- Rendering --------------------------------------------------------------------------------------------------------------------------

const routed = (ui: ReactElement, net: Net = XRPL) => (
  <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [`/${net.id}/markets`] })} />
);

/** The page drawn in the browser at once (a client render: the hydrated flag is already true). */
function mount(data: MarketsPageData, network: Net = XRPL) {
  return render(routed(<MarketsPage network={network} data={data} />, network));
}

/** The page as the Worker prints it. */
const serverHtml = (data: MarketsPageData, network: Net = XRPL) => renderToString(routed(<MarketsPage network={network} data={data} />, network));

const table = () => screen.getByRole("table", { name: "Pairs" });
/** The data rows of the table, each as the texts of its cells. */
const bodyRows = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell").map((cell) => cell.textContent));
/** The pair of each data row, in the order shown. */
const pairsShown = () => bodyRows().map((cells) => cells[1]);
/** The text of a header cell without the arrow of the sorted column. */
const plain = (cell: HTMLElement) => (cell.textContent ?? "").replace(/[↑↓]/g, "");
const headers = () => within(table()).getAllByRole("columnheader").map(plain);
const header = (name: string) => within(table()).getAllByRole("columnheader").find((cell) => plain(cell) === name)!;
const countLine = () => screen.getByRole("status");
const filterField = () => screen.getByRole("searchbox", { name: "Filter pairs" });
const type = (text: string) => fireEvent.change(filterField(), { target: { value: text } });

// ---- The page ---------------------------------------------------------------------------------------------------------------------------

describe("MarketsPage, the head and the filters", () => {
  it("has 'Markets' as the one h1, and the view builder's intro under it", () => {
    mount(page());
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Markets"]);
    expect(screen.getByText("Trades on the XRP Ledger DEX: order-book crossings and swaps against AMM pools.")).toBeTruthy();
  });

  it("has the Period, Quote and Trades selectors as segmented links in the Filters group, the view's own marked aria-current=true", () => {
    mount(page());
    const filters = screen.getByRole("group", { name: "Filters" });
    for (const [name, labels, hrefs] of [
      ["Period", ["24 h", "7 days", "30 days"], ["/xrpl/markets", "/xrpl/markets?period=7d", "/xrpl/markets?period=30d"]],
      ["Quote", ["All", "XRP", "USD"], ["/xrpl/markets", "/xrpl/markets?quote=xrp", "/xrpl/markets?quote=usd"]],
      ["Trades", ["All", "Order book", "AMM"], ["/xrpl/markets", "/xrpl/markets?trades=book", "/xrpl/markets?trades=amm"]],
    ] as const) {
      const group = within(filters).getByRole("group", { name });
      const links = within(group).getAllByRole("link");
      expect(links.map((a) => a.textContent), name).toEqual(labels);
      expect(links.map((a) => a.getAttribute("href")), name).toEqual(hrefs);
      expect(links.map((a) => a.getAttribute("aria-current")), name).toEqual(["true", null, null]);
      // E2's control: the network switch's segments.
      expect(group.classList.contains("netswitch")).toBe(true);
    }
  });

  it("has no Trades selector where the view builder gives none (Xahau, AMM_DATA off, a window without AMM data)", () => {
    mount(XAHAU_PAGE(), XAHAU);
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(within(filters).queryByRole("group", { name: "Trades" })).toBeNull();
    expect(within(filters).getByRole("group", { name: "Period" })).toBeTruthy();
    expect(within(within(filters).getByRole("group", { name: "Quote" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["All", "XAH"]);
    expect(within(filters).getAllByRole("group")).toHaveLength(2);
  });

  it("says the period note after the filters, and the totals as figure tiles in a section named Totals", () => {
    const { container } = mount(page());
    expect(screen.getByText(/^Figures cover Oct 16, 17:00 to Oct 17, 17:01 UTC/)).toBeTruthy();
    const totals = screen.getByRole("region", { name: "Totals" });
    expect(totals.classList.contains("stat-grid--narrow")).toBe(true);
    const tiles = [...totals.querySelectorAll(".stat")];
    expect(tiles.every((t) => t.classList.contains("stat--figure"))).toBe(true);
    expect(tiles.map((t) => [t.querySelector(".stat__label")!.textContent, t.querySelector(".stat__value")!.textContent, t.querySelector(".stat__sub")!.textContent])).toEqual([
      ["DEX volume", "991K XRP", "last 24 hours, pairs listed"],
      ["Trades", "880", "last 24 hours, pairs listed"],
      ["Pairs shown", "4", "of 157 with trades"],
      ["AMM share of volume", "12%", "swaps against AMM pools"],
    ]);
    // The board's order: the heading, the filters, the note, the totals, the pairs.
    const order = [...container.querySelector(".markets")!.children].map((el) => el.getAttribute("aria-label") ?? el.querySelector("h1, h2")?.textContent ?? el.className);
    expect(order).toEqual(["Markets", "Filters", "markets__note", "Totals", "Pairs"]);
  });
});

describe("MarketsPage, the pairs card", () => {
  it("is a card titled Pairs with the source line, the table, the count line and the footnote", () => {
    mount(page());
    const card = screen.getByRole("heading", { level: 2, name: "Pairs" }).closest("section")!;
    expect(card.classList.contains("card")).toBe(true);
    expect(within(card).getByText("/v2/network/markets?period=day").className).toContain("chart__source");
    expect(within(card).getByRole("table", { name: "Pairs" })).toBeTruthy();
    expect(within(card).getByRole("status").textContent).toBe("4 pairs, by volume, largest first");
    expect(within(card).getByText(/^Pairs with at least 10 trades in the period\./)).toBeTruthy();
    expect(within(card).getByText("Prices are counter per base.")).toBeTruthy();
  });

  it("draws each row: its place, the pair as one link over its issuers, the prices, the change with its triangle, the volume, the trades, the AMM share and the sparkline", () => {
    mount(page());
    expect(headers()).toEqual([
      "#",
      "Pair",
      "Last price",
      "Change",
      "Low – high",
      "Volume (XRP)",
      "Trades",
      "AMM share",
      "7 days",
    ]);
    expect(bodyRows()[0]).toEqual(["1", "AAA / XRPAAA rAAAAA…AAAA", "9", "+5.00%", "1 – 2", "10K", "3", "34%", ""]);

    const [first, , , last] = within(table()).getAllByRole("row").slice(1);
    // One target per row: the pair's link, a block that holds the issuers too.
    const pairLink = within(first!).getByRole("link");
    expect(within(first!).getAllByRole("link")).toHaveLength(1);
    expect(pairLink.getAttribute("href")).toBe("/xrpl/markets/A");
    expect(pairLink.className).toBe("markets__pair");
    expect(pairLink.querySelector(".markets__issuers")!.textContent).toBe("AAA rAAAAA…AAAA");
    // The sparkline: one image, named by the view builder.
    expect(within(first!).getByRole("img", { name: "7-day price of AAA / XRP" })).toBeTruthy();
    // A meter (decorative: the text says the share) and the share.
    const meter = first!.querySelector(".meter")!;
    expect(meter.getAttribute("aria-hidden")).toBe("true");
    expect(meter.classList.contains("meter--small")).toBe(true);
    // A row the data API cannot be asked for (`href: null`) is text.
    expect(within(last!).queryByRole("link")).toBeNull();
    expect(last!.querySelector(".markets__pair")!.tagName).toBe("SPAN");
    expect(last!.querySelector(".meter")).toBeNull();
  });

  it("shows the change with a triangle that is a picture, up or down, and none for 0.00% or a dash", () => {
    mount(page({ rows: [...FOUR, row({ key: "E", pair: "EEE / XRP", change: { text: "—", dir: "flat" }, ranks: { last: 3, change: null, volume: null, trades: 4 } })] }));
    const changes = within(table())
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[3]!);
    expect(changes.map((cell) => cell.textContent)).toEqual(["+5.00%", "−1.00%", "+0.10%", "0.00%", "—"]);
    expect(changes.map((cell) => cell.querySelectorAll("svg").length)).toEqual([1, 1, 1, 0, 0]);
    for (const svg of changes.flatMap((cell) => [...cell.querySelectorAll("svg")])) expect(svg.getAttribute("aria-hidden")).toBe("true");
    // The sign is in the text, and the text is --muted (text never wears a series colour).
    expect(changes.every((cell) => cell.querySelector(".markets__change") !== null)).toBe(true);
  });

  it("has no AMM column with AMM_DATA off: the tile is left out too", () => {
    mount(page({ ammColumn: false, rows: FOUR.map((r) => ({ ...r, amm: null })), tiles: page().tiles!.slice(0, 3) }));
    expect(headers()).not.toContain("AMM share");
    expect(within(table()).getAllByRole("columnheader")).toHaveLength(8);
    expect(document.querySelector(".meter")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Totals" })).queryByText("AMM share of volume")).toBeNull();
  });

  it("has no AMM column on Xahau, and its tile says why", () => {
    mount(XAHAU_PAGE(), XAHAU);
    expect(headers()).toEqual(["#", "Pair", "Last price", "Change", "Low – high", "Volume (XAH)", "Trades", "7 days"]);
    const ammTile = within(screen.getByRole("region", { name: "Totals" })).getByText("AMM share of volume").closest(".stat")!;
    expect(ammTile.querySelector(".stat__value")!.textContent).toBe("—");
    expect(ammTile.querySelector(".stat__sub")!.textContent).toBe("Xahau has no AMM");
  });

  it("says when the API has no set yet, in the table's place, and draws no tiles", () => {
    mount(page({ rows: [], tiles: null, note: null, empty: "No market figures yet for this period. The data API computes them every minute." }));
    expect(screen.getByText("No market figures yet for this period. The data API computes them every minute.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Totals" })).toBeNull();
    expect(within(table()).getAllByRole("row")).toHaveLength(1);
    // The count line is there, with nothing to count.
    expect(countLine().textContent).toBe("");
  });

  it("says when a quote has no pair", () => {
    mount(page({ rows: [], empty: "No XRP pairs with at least 10 trades in the last 24 hours." }));
    expect(screen.getByText("No XRP pairs with at least 10 trades in the last 24 hours.")).toBeTruthy();
    expect(within(table()).getAllByRole("row")).toHaveLength(1);
  });
});

describe("MarketsPage, the rows the HTML holds", () => {
  it("draws the first 100 rows (FIRST_ROWS, the ledger page's), and 'Show all 214' shows the rest without a request", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount(page({ rows: MANY }));
    expect(FIRST_ROWS).toBe(100);
    expect(LEDGER_FIRST_ROWS).toBe(FIRST_ROWS);
    expect(bodyRows()).toHaveLength(100);
    expect(bodyRows()[99]![0]).toBe("100");

    fireEvent.click(screen.getByRole("button", { name: "Show all 214" }));
    expect(bodyRows()).toHaveLength(214);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show first 100" }));
    expect(bodyRows()).toHaveLength(100);
  });

  it("prints the first 100 rows on the server, and no button: a control that would do nothing without the script (spec 2.2)", () => {
    const html = serverHtml(page({ rows: MANY }));
    expect((html.match(/<div role="row"/g) ?? []).length).toBe(101);
    expect(html).not.toContain("Show all");
    expect(html).not.toContain("<button");
  });

  it("has 'Show all 214' after hydration, with no mismatch, and it shows every row without a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { container, errors } = await serverThenHydrated(routed(<MarketsPage network={XRPL} data={page({ rows: MANY })} />));
    expect(errors).toEqual([]);
    const rows = () => within(container).getByRole("table", { name: "Pairs" }).querySelectorAll('[role="row"]:not(.table__head)');
    expect(rows()).toHaveLength(100);

    fireEvent.click(within(container).getByRole("button", { name: "Show all 214" }));
    expect(rows()).toHaveLength(214);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("has no button for a table of 100 rows or fewer", () => {
    mount(page());
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });
});

describe("MarketsPage, the text filter", () => {
  it("is not in the server's HTML: it works only with the script", () => {
    const html = serverHtml(page({ rows: MANY }));
    expect(html).not.toContain("Filter by currency or issuer");
    expect(html).not.toContain('type="search"');
    // Its row is there from the start, so adding the field moves nothing.
    expect(html).toContain('class="markets__search"');
  });

  it("is there after hydration, with no mismatch, labelled 'Filter pairs'", async () => {
    const { container, errors } = await serverThenHydrated(routed(<MarketsPage network={XRPL} data={page({ rows: MANY })} />));
    expect(errors).toEqual([]);
    const field = within(container).getByRole("searchbox", { name: "Filter pairs" });
    expect(field.getAttribute("placeholder")).toBe("Filter by currency or issuer");
    expect(field.closest(".markets__search")).not.toBeNull();
  });

  it("narrows the rows to those whose search text holds what is typed, in any case, and the count line says so", () => {
    mount(page({ rows: MANY }));
    expect(countLine().textContent).toBe("214 pairs, by volume, largest first");

    type("USD");
    expect(bodyRows()).toHaveLength(12);
    expect(pairsShown().every((pair) => pair!.startsWith("XRP / USD"))).toBe(true);
    // The places are those of the rows shown.
    expect(bodyRows().map((cells) => cells[0])).toEqual(Array.from({ length: 12 }, (_, at) => String(at + 1)));
    expect(countLine().textContent).toBe("Showing 12 of 214 pairs, by volume, largest first");

    // It covers every row served, not only the first 100.
    type("t213/");
    expect(pairsShown()).toEqual(["T213 / XRPT213 rT213…"]);

    type("");
    expect(bodyRows()).toHaveLength(100);
    expect(countLine().textContent).toBe("214 pairs, by volume, largest first");
  });

  it("says that no pair matches, with no row, and keeps the tiles of the view", () => {
    mount(page({ rows: MANY }));
    type("zzz");
    expect(within(table()).getAllByRole("row")).toHaveLength(1);
    expect(screen.getByText("No pairs match “zzz”.")).toBeTruthy();
    expect(countLine().textContent).toBe("Showing 0 of 214 pairs, by volume, largest first");
    expect(within(screen.getByRole("region", { name: "Totals" })).getByText("991K XRP")).toBeTruthy();
  });

  it("has one role=status, the count line, always in the page, and no aria-live", () => {
    const html = serverHtml(page());
    expect((html.match(/role="status"/g) ?? []).length).toBe(1);
    expect(html).toContain("4 pairs, by volume, largest first");
    expect(html).not.toContain("aria-live");
  });
});

describe("MarketsPage, sorting", () => {
  const SORTABLE = ["Last price", "Change", "Volume (XRP)", "Trades"];

  it("prints the headers plain on the server, with aria-sort: by volume, largest first", () => {
    const html = serverHtml(page());
    expect(html).not.toContain("<button");
    expect(html).toMatch(/role="columnheader" aria-sort="descending"[^>]*>Volume \(XRP\)<span class="markets__arrow" aria-hidden="true">↓</);
    for (const name of ["Last price", "Change", "Trades"]) expect(html).toMatch(new RegExp(`role="columnheader" aria-sort="none"[^>]*>${name}<`));
    // The other columns are not sortable and say nothing of it.
    expect((html.match(/aria-sort=/g) ?? []).length).toBe(4);
  });

  it("makes the four headers buttons after hydration, each filling its header", async () => {
    const { container, errors } = await serverThenHydrated(routed(<MarketsPage network={XRPL} data={page()} />));
    expect(errors).toEqual([]);
    const buttons = within(container).getAllByRole("button").filter((button) => button.classList.contains("markets__sort"));
    expect(buttons.map((button) => button.textContent!.replace(/[↑↓]/g, ""))).toEqual(SORTABLE);
    for (const button of buttons) expect(button.closest('[role="columnheader"]')).not.toBeNull();
  });

  it("sorts by a column largest first on a press, reverses on a second, from the ranks only; aria-sort and the count line follow", () => {
    mount(page());
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["AAA", "BBB", "DDD", "CCC"]);

    fireEvent.click(screen.getByRole("button", { name: "Last price" }));
    // By rank: B (2), C (1), A (0), and D, which has no price, last. The texts (10, 100, 9, 2) would have put C first.
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["BBB", "CCC", "AAA", "DDD"]);
    expect(header("Last price").getAttribute("aria-sort")).toBe("descending");
    expect(header("Volume (XRP)").getAttribute("aria-sort")).toBe("none");
    expect(countLine().textContent).toBe("4 pairs, by last price, largest first");
    expect(bodyRows().map((cells) => cells[0])).toEqual(["1", "2", "3", "4"]);

    fireEvent.click(screen.getByRole("button", { name: "Last price" }));
    // Reversed, and the row without a price is still last.
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["AAA", "CCC", "BBB", "DDD"]);
    expect(header("Last price").getAttribute("aria-sort")).toBe("ascending");
    expect(countLine().textContent).toBe("4 pairs, by last price, smallest first");

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["AAA", "DDD", "CCC", "BBB"]);
    expect(header("Change").getAttribute("aria-sort")).toBe("descending");
    expect(header("Last price").getAttribute("aria-sort")).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["CCC", "DDD", "AAA", "BBB"]);

    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["DDD", "BBB", "CCC", "AAA"]);
    expect(countLine().textContent).toBe("4 pairs, by trades, largest first");
  });

  it("keeps the API's order among rows of one rank, largest first and smallest first (spec 2.4: a tie keeps the API's order)", () => {
    // Three pairs of 10 trades each (rank 0, shared) and one of 50, in the API's order: by volume, largest first.
    const tied = [
      row({ key: "P", pair: "PPP / XRP", trades: "10", ranks: { last: 0, change: 0, volume: 3, trades: 0 } }),
      row({ key: "Q", pair: "QQQ / XRP", trades: "50", ranks: { last: 1, change: 1, volume: 2, trades: 3 } }),
      row({ key: "R", pair: "RRR / XRP", trades: "10", ranks: { last: 2, change: 0, volume: 1, trades: 0 } }),
      row({ key: "S", pair: "SSS / XRP", trades: "10", ranks: { last: 3, change: 0, volume: 0, trades: 0 } }),
    ];
    mount(page({ rows: tied }));
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["QQQ", "PPP", "RRR", "SSS"]);
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["PPP", "RRR", "SSS", "QQQ"]);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["QQQ", "PPP", "RRR", "SSS"]);
  });

  it("reverses the volume order on a press of Volume, which is the order it starts in, with the pair that has no volume still last", () => {
    mount(page());
    fireEvent.click(screen.getByRole("button", { name: "Volume (XRP)" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["DDD", "BBB", "AAA", "CCC"]);
    expect(header("Volume (XRP)").getAttribute("aria-sort")).toBe("ascending");
    expect(countLine().textContent).toBe("4 pairs, by volume, smallest first");
    fireEvent.click(screen.getByRole("button", { name: "Volume (XRP)" }));
    expect(pairsShown().map((pair) => pair!.slice(0, 3))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
  });

  it("shows the direction with an arrow that is a picture, on the sorted column only", () => {
    mount(page());
    const arrows = () => within(table()).getAllByRole("columnheader").flatMap((cell) => [...cell.querySelectorAll(".markets__arrow")]);
    expect(arrows()).toHaveLength(1);
    expect(arrows()[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(arrows()[0]!.closest('[role="columnheader"]')!.textContent).toBe("Volume (XRP)↓");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(arrows()[0]!.closest('[role="columnheader"]')!.textContent).toBe("Change↓");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(arrows()[0]!.closest('[role="columnheader"]')!.textContent).toBe("Change↑");
  });

  it("sorts and filters together: the filter narrows the sorted rows, and the count line names both", () => {
    mount(page({ rows: MANY }));
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    type("usd");
    // Every 18th row, by trades rank (its index here), largest first.
    expect(bodyRows().map((cells) => cells[1])).toHaveLength(12);
    expect(countLine().textContent).toBe("Showing 12 of 214 pairs, by trades, largest first");
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(countLine().textContent).toBe("Showing 12 of 214 pairs, by trades, smallest first");
  });

  it("sorts every row served, not only the first 100", () => {
    mount(page({ rows: MANY }));
    fireEvent.click(screen.getByRole("button", { name: "Last price" }));
    // The largest rank is the last row of the API's order, which the first 100 do not hold.
    expect(pairsShown()[0]).toBe("T213 / XRPT213 rT213…");
  });
});

describe("DataTable, the props the markets page grows it by", () => {
  it("writes a count as the pages do, its thousands grouped: the one helper the ledger and markets pages share", () => {
    expect([count(0), count(7), count(214), count(1500), count(1_000_000)]).toEqual(["0", "7", "214", "1,500", "1,000,000"]);
  });

  const columns = [
    { id: "a", header: "A", width: "1fr", cell: (r: { k: string }) => r.k },
    { id: "b", header: "B", width: "1fr", cell: (r: { k: string }) => r.k, sort: "descending" as const },
    { id: "c", header: "C", width: "1fr", cell: (r: { k: string }) => r.k, sort: "none" as const },
  ];

  it("puts aria-sort on a column that has a sort, and on no other", () => {
    render(<DataTable label="T" columns={columns} rows={[{ k: "x" }]} rowKey={(r) => r.k} />);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.getAttribute("aria-sort"))).toEqual([null, "descending", "none"]);
  });

  it("puts className on the scroll region, beside its own class, and none without it", () => {
    const { container, rerender } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={(r) => r.k} className="markets__table" />);
    expect(container.querySelector('[role="region"]')!.className).toBe("table-scroll markets__table");
    rerender(<DataTable label="T" columns={columns} rows={[]} rowKey={(r) => r.k} />);
    expect(container.querySelector('[role="region"]')!.className).toBe("table-scroll");
  });
});
