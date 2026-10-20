import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { networkHref, type NetworkParams } from "../../domain/network-params";
import type { AmmPart, NetworkPageData, SeriesView } from "../../server/network-view";
import type { BarListData, TimeSeriesData } from "../charts/types";
import type { LiveControls } from "../use-live-controls";
import { NETWORK_TITLES, NetworkPage } from "./NetworkPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH", software: "xahaud" } as const;
const HASH = "2F7C1D5A9B3E4F60A8D2C71B5E9F3A4D6C8B0E1F2A3B4C5D6E7F8A9B0C1D2E3F";
const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";

// ---- A page of data: XRPL, the last 7 days, every part loaded --------------------------------------------------------------------------

const BUCKETS = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const AXIS = { unit: "day", buckets: BUCKETS } as const;

const seriesView = (values: (string | null)[], over: Partial<SeriesView> = {}): SeriesView => ({
  buckets: BUCKETS,
  unit: "day",
  values,
  pending: 0,
  forming: true,
  token: `series:${values.join(",")}`,
  ...over,
});
const PAYMENT_VALUES = ["40000000", "41000000", "39000000", "45000000", "44000000", "46000000", null];
const DEX_VALUES = ["8000000", "9000000", "7000000", "9500000", "9100000", "9900000", null];
const AMM_VALUES = ["1000000", "1100000", "900000", "1200000", "1100000", "1300000", null];

const typesChart = (token = "types"): TimeSeriesData => ({
  axis: AXIS,
  series: [
    { id: "payment", label: "Payment", slot: 1, values: ["1000", "1200", "1100", "1500", "1400", "1600", "700"] },
    { id: "offer", label: "OfferCreate", slot: 2, values: ["800", "900", "850", "950", "900", "1000", "400"] },
    { id: "other", label: "Other", slot: "other", values: ["100", "100", "100", "100", "100", "100", "50"] },
  ],
  format: { kind: "count", unit: "transactions" },
  totals: ["1900", "2200", "2050", "2550", "2400", "2700", "1150"],
  forming: true,
  pending: 0,
  token,
});
const feesChart: TimeSeriesData = {
  axis: AXIS,
  series: [{ id: "fee", label: "Average fee", slot: 1, values: ["12", "13", "12", "40", "14", "12", "11"] }],
  format: { kind: "drops", unit: "drops" },
  forming: true,
  pending: 0,
  token: "fees",
};
const byCurrency: BarListData = {
  items: [
    { id: "XRP", label: "XRP", value: "230000000", share: "58%", count: "12000" },
    { id: `USD.${ISSUER}`, label: "USD", sublabel: "rhub8V…zF3wq", value: "100000000", share: "25%", count: "3000" },
  ],
  format: { kind: "amount", unit: "XRP" },
  token: "by-currency",
};

const AMM_OK: AmmPart = { state: "ok", series: seriesView(AMM_VALUES, { pending: 1 }), total: "1200000000" };

function page(over: Partial<NetworkPageData> = {}): NetworkPageData {
  return {
    anchor: { lastValidated: 107695660, closeTime: 1792256472 },
    view: { period: "7d", display: "native" },
    displays: ["native", "usd"],
    currency: "XRP",
    window: { unit: "day", note: "Totals and charts cover the 7 days from Oct 11 to Oct 17, 2026 (UTC), today so far" },
    strip: [0, 1, 2, 3, 4, 5].map((n) => ({ index: 107695660 - n, txCount: 84 - n, closeTime: 1792256472 - 4 * n })),
    openLedger: { state: "ok", fee: "10", minimum: "10", queue: "0", openSize: "84", expected: "96", asOf: "17:01:10" },
    validators: {
      state: "ok",
      ledger: { index: 107695660, hash: HASH },
      count: "35",
      first: [
        { key: "nHUFE9prPXPrHcG3SkwP1UzAQbSphqyQkQK9ATXLZsfkezhhda3p", short: "nHUFE9prPX…a3p", delay: "+0 ms" },
        { key: "nHBidG3pZK11zQD6kpNDoAhDxH6WLGui6ZxSbUx7LSqLHsgzMPec", short: "nHBidG3pZK…Pec", delay: "+12 ms" },
        { key: "nHUon2tpyJEHHYGmxqeGu37cvPYHzrMtUNQFVdCgGNvEkjmCpTqK", short: "nHUon2tpyJ…TqK", delay: "+40 ms" },
        { key: "nHUpcmNsxAw47yt2ADDoNoQrzLyTJPgnAvbdHnSvoBsMbd6CXnqF", short: "nHUpcmNsxA…nqF", delay: "+55 ms" },
        { key: "nHU95JxeaHJoSdpE7R49Mxp4611Yk5yL9SGEc12UDJLr4oEUN4NT", short: "nHU95JxeaH…4NT", delay: "+81 ms" },
      ],
      href: "/xrpl/validators?scope=all",
    },
    types: { state: "ok", chart: typesChart(), note: "AMM adds up its transaction types; Other is every other type." },
    metrics: {
      state: "ok",
      transactions: { value: "14.9K", delta: { text: "+3.2%, 7 full days to Oct 16 vs the 7 before", sign: 1 }, sub: null },
      interval: { value: "3.91 s", delta: null, sub: "average time between ledgers" },
      perLedger: { value: "84.2", delta: { text: "−1.1%, 7 full days to Oct 16 vs the 7 before", sign: -1 }, sub: null },
      accountsCreated: { value: "1.2K", delta: { text: "0.0%, 7 full days to Oct 16 vs the 7 before", sign: 0 }, sub: null },
    },
    fees: { state: "ok", chart: feesChart },
    payments: {
      state: "ok",
      series: seriesView(PAYMENT_VALUES, { pending: 1 }),
      figure: { value: "255M XRP", delta: { text: "+5.0%, 7 full days to Oct 16 vs the 7 before", sign: 1 }, sub: "to Oct 16; Oct 17 not computed yet" },
      byCurrency,
      currencies: "Payments in the currencies the data API tracks: XRP, USD.",
    },
    exchanges: { state: "ok", series: seriesView(DEX_VALUES, { pending: 1 }), total: "53500000", pendingWords: "to Oct 16; Oct 17 not computed yet" },
    amm: AMM_OK,
    ...over,
  };
}

const XAHAU_PAGE = (over: Partial<NetworkPageData> = {}) =>
  page({ displays: ["native"], currency: "XAH", amm: { state: "none" }, validators: { ...(page().validators as object), href: null } as NetworkPageData["validators"], ...over });

const failed = (reason = "data API GET /v2/x answered 503") => ({ state: "failed", reason }) as const;

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
 * The page in a data router, drawn at once: its route's data is given (`hydrationData`), as the document gives it in the browser, so no first
 * load has to be waited for. The `loader` is what a Retry or a beat runs again.
 */
function mount(data: NetworkPageData, props: { live?: LiveControls; network?: typeof XRPL | typeof XAHAU; loader?: () => null } = {}) {
  const network = props.network ?? XRPL;
  const router = createMemoryRouter([{ path: "*", element: <NetworkPage network={network} data={data} live={props.live} />, loader: props.loader ?? (() => null) }], {
    initialEntries: [`/${network.id}/network`],
    hydrationData: { loaderData: { "0": null } },
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

const region = (name: string) => screen.getByRole("region", { name });
const card = (title: string | RegExp) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;

/** What a tile of the totals says: its label, figure, delta and note. */
function tile(label: string) {
  const element = within(region("Totals")).getByText(label).closest(".stat") as HTMLElement;
  const text = (selector: string) => element.querySelector(selector)?.textContent ?? null;
  return { element, value: text(".stat__value"), delta: text(".stat__delta"), sub: text(".stat__sub") };
}

// ---- The page ---------------------------------------------------------------------------------------------------------------------------

describe("NetworkPage, the heading row", () => {
  it("has the network's title as the one h1, in front of the live row", () => {
    mount(page());
    expect(NETWORK_TITLES).toEqual({ xrpl: "XRPL network", xahau: "Xahau network" });
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings.map((h) => h.textContent)).toEqual(["XRPL network"]);
    cleanup();
    mount(XAHAU_PAGE(), { network: XAHAU });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Xahau network");
  });

  it("is a live row: the dot and 'Live · updates every ledger', beside the heading", () => {
    const { container } = mount(page());
    const row = container.querySelector(".hero__status-row")!;
    expect(row.querySelector(".hero__status")!.textContent).toBe("Live · updates every ledger");
    expect(row.closest(".network__head")).toBe(screen.getByRole("heading", { level: 1 }).closest(".network__head"));
  });

  it("says 'Paused while you look at the ledgers' while held, and the dot goes quiet", async () => {
    const { container } = mount(page(), { live: controls({ held: true }) });
    expect(container.querySelector(".hero__held")!.textContent).toBe("Paused while you look at the ledgers");
    expect(container.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(true);
    expect(await screen.findByRole("button", { name: "Pause live updates" })).toBeTruthy();
  });

  it("has a pause button that calls the page's handler", async () => {
    const live = controls();
    mount(page(), { live });
    fireEvent.click(await screen.findByRole("button", { name: "Pause live updates" }));
    expect(live.onTogglePause).toHaveBeenCalledTimes(1);
  });

  it("has no status, no button and no note without the route's controls", () => {
    const { container } = mount(page());
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /live updates/ })).toBeNull();
    expect(container.querySelector(".hero__held")).toBeNull();
  });

  it("has no aria-live and exactly one role=status: the live status", async () => {
    const { container } = mount(page(), { live: controls({ failures: 2 }) });
    await screen.findByRole("button", { name: "Pause live updates" });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Live updates paused, retrying…");
  });
});

describe("NetworkPage, the latest ledgers", () => {
  it("is a section named 'Latest ledgers' with a chip for each ledger, newest first, each a link to its ledger", () => {
    mount(page());
    const strip = region("Latest ledgers");
    const links = within(strip).getAllByRole("link");
    expect(links).toHaveLength(6);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      [0, 1, 2, 3, 4, 5].map((n) => `/xrpl/ledger/${107695660 - n}`),
    );
    expect(within(strip).getAllByRole("listitem").every((li) => li.classList.contains("chip"))).toBe(true);
    expect(strip.querySelector("ol.chips")).not.toBeNull();
  });

  it("shows the ledger in mono over its transactions and how long ago it closed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1792256475 * 1000);
    mount(page());
    const [first] = within(region("Latest ledgers")).getAllByRole("link");
    expect(first!.querySelector(".mono")!.textContent).toBe("#107,695,660");
    expect(first!.textContent).toBe("#107,695,66084 txs · 3 s ago");
    expect(first!.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-17T17:01:12.000Z");
    // The key of the chip is the ledger, for the live rows.
    expect(first!.closest("li")!.getAttribute("data-key")).toBe("107695660");
  });

  it("prints the time of close and no age on the server, because the page is stored", () => {
    const router = createMemoryRouter([{ path: "*", element: <NetworkPage network={XRPL} data={page()} /> }], { initialEntries: ["/xrpl/network"] });
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).not.toMatch(/\d+ (s|min|h|d) ago/);
    expect(html).toContain("84 txs · <time");
    // The time of day (its zone is the title's) where the browser puts the age.
    expect(html).toContain(">17:01:12</time>");
  });

  it("leaves the chip's text to --fg and --muted: no faint, no link colour", () => {
    mount(page());
    const chip = within(region("Latest ledgers")).getAllByRole("link")[0]!;
    expect(chip.className).toBe("chip__link");
    expect(chip.querySelector(".chip__index")).not.toBeNull();
    expect(chip.querySelector(".chip__meta")).not.toBeNull();
    expect(chip.querySelector(".faint, .age")).toBeNull();
  });

  it("shows the open ledger: the fee in drops, the queue, the ledger's size against what is expected, when, and the source", () => {
    mount(page());
    const open = region("Latest ledgers").querySelector(".network__open")!;
    const lines = Array.from(open.querySelectorAll("p")).map((p) => p.textContent);
    expect(lines).toEqual([
      "Open ledger fee 10 drops",
      "Queue 0 · 84 of 96 expected in the open ledger",
      "as of 17:01:10 UTC",
      "/v2/network/fee_stats",
    ]);
    expect(open.querySelector("b")!.textContent).toBe("10 drops");
  });

  it("groups thousands in the open ledger's figures", () => {
    mount(page({ openLedger: { state: "ok", fee: "12500", minimum: "10", queue: "1250", openSize: "2100", expected: "96", asOf: "17:01:10" } }));
    expect(region("Latest ledgers").querySelector(".network__open")!.textContent).toContain("Open ledger fee 12,500 drops");
    expect(region("Latest ledgers").querySelector(".network__open")!.textContent).toContain("Queue 1,250 · 2,100 of 96 expected");
  });

  it("says the open ledger could not be loaded, with a Retry that asks the route's data again; the chips stay", async () => {
    const loader = vi.fn(() => null);
    mount(page({ openLedger: failed() }), { loader });
    const alert = within(region("Latest ledgers")).getByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load the open ledger.");
    expect(within(region("Latest ledgers")).getAllByRole("link")).toHaveLength(6);
    expect(region("Latest ledgers").querySelector(".network__open b")).toBeNull();
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });
});

describe("NetworkPage, the strip's hold", () => {
  const strip = () => region("Latest ledgers").querySelector("ol.chips") as HTMLElement;
  const holds = (live: LiveControls) => (live.onHold as ReturnType<typeof vi.fn>).mock.calls.map(([held]) => held);

  it("holds while a mouse is over the strip, and lets go when it leaves", () => {
    const live = controls();
    mount(page(), { live });
    fireEvent.pointerEnter(strip(), { pointerType: "mouse" });
    fireEvent.pointerLeave(strip(), { pointerType: "mouse" });
    expect(holds(live)).toEqual([true, false]);
  });

  it("is not for a finger", () => {
    const live = controls();
    mount(page(), { live });
    fireEvent.pointerEnter(strip(), { pointerType: "touch" });
    expect(holds(live)).toEqual([]);
  });

  it("holds while keyboard focus is on a chip, and lets go when it leaves", () => {
    const live = controls();
    mount(page(), { live });
    act(() => within(strip()).getAllByRole("link")[1]!.focus());
    expect(holds(live).at(-1)).toBe(true);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(holds(live).at(-1)).toBe(false);
  });

  it("lets go when the page goes away, whatever was held", () => {
    const live = controls();
    const { unmount } = mount(page(), { live });
    fireEvent.pointerEnter(strip(), { pointerType: "mouse" });
    expect(holds(live).at(-1)).toBe(true);
    unmount();
    expect(holds(live).at(-1)).toBe(false);
  });

  it("tells nobody when there is nobody to tell", () => {
    mount(page());
    expect(() => fireEvent.pointerEnter(strip(), { pointerType: "mouse" })).not.toThrow();
  });
});

describe("NetworkPage, the filters", () => {
  const filters = () => screen.getByRole("group", { name: "Filters" });

  it("has a Period group of links to the views, the current one marked, and the period's note after it", () => {
    mount(page());
    const period = within(filters()).getByRole("group", { name: "Period" });
    const links = within(period).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["7 days", "30 days", "90 days", "1 year"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      (["7d", "30d", "90d", "1y"] as const).map((period) => networkHref("xrpl", { period, display: "native" })),
    );
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["true", null, null, null]);
    expect(filters().textContent).toContain("Totals and charts cover the 7 days from Oct 11 to Oct 17, 2026 (UTC), today so far");
  });

  it("marks the period of the view as current, and keeps the display in every link", () => {
    const view: NetworkParams = { period: "1y", display: "usd" };
    mount(page({ view, currency: "USD" }));
    const period = within(screen.getByRole("group", { name: "Period" })).getAllByRole("link");
    expect(period.map((link) => link.getAttribute("href"))).toEqual([
      "/xrpl/network?period=7d&in=usd",
      "/xrpl/network?in=usd",
      "/xrpl/network?period=90d&in=usd",
      "/xrpl/network?period=1y&in=usd",
    ]);
    expect(period.map((link) => link.getAttribute("aria-current"))).toEqual([null, null, null, "true"]);
  });

  it("has an 'Amounts in' group with the native currency and USD on XRPL, keeping the period", () => {
    mount(page({ view: { period: "90d", display: "native" } }));
    const amounts = within(filters()).getByRole("group", { name: "Amounts in" });
    const links = within(amounts).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["XRP", "USD"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/xrpl/network?period=90d", "/xrpl/network?period=90d&in=usd"]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["true", null]);
  });

  it("marks USD as current in a USD view", () => {
    mount(page({ view: { period: "30d", display: "usd" }, currency: "USD" }));
    const links = within(screen.getByRole("group", { name: "Amounts in" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, "true"]);
  });

  it("has no 'Amounts in' on Xahau, which has one currency", () => {
    mount(XAHAU_PAGE(), { network: XAHAU });
    expect(screen.queryByRole("group", { name: "Amounts in" })).toBeNull();
    expect(screen.queryByText("Amounts in")).toBeNull();
    const links = within(screen.getByRole("group", { name: "Period" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/xahau/network?period=7d", "/xahau/network", "/xahau/network?period=90d", "/xahau/network?period=1y"]);
  });
});

describe("NetworkPage, the totals", () => {
  it("has six tiles in the order of the board, each with its figure", () => {
    mount(page());
    const labels = Array.from(region("Totals").querySelectorAll(".stat__label")).map((label) => label.textContent);
    expect(labels).toEqual(["Transactions", "Ledger interval", "Transactions per ledger", "Accounts created", "Payment volume", "DEX volume"]);
    expect(region("Totals").querySelectorAll(".stat--figure")).toHaveLength(6);
    expect(region("Totals").classList.contains("stat-grid--narrow")).toBe(true);
  });

  it("shows the figures, deltas and notes the view builder made", () => {
    mount(page());
    expect(tile("Transactions")).toMatchObject({ value: "14.9K", delta: "+3.2%, 7 full days to Oct 16 vs the 7 before", sub: null });
    expect(tile("Ledger interval")).toMatchObject({ value: "3.91 s", delta: null, sub: "average time between ledgers" });
    expect(tile("Transactions per ledger")).toMatchObject({ value: "84.2", delta: "−1.1%, 7 full days to Oct 16 vs the 7 before" });
    expect(tile("Accounts created")).toMatchObject({ value: "1.2K", delta: "0.0%, 7 full days to Oct 16 vs the 7 before" });
    expect(tile("Payment volume")).toMatchObject({ value: "255M XRP", delta: "+5.0%, 7 full days to Oct 16 vs the 7 before", sub: "to Oct 16; Oct 17 not computed yet" });
  });

  it("shows the DEX volume compacted, in the page's currency, with the AMM state and the pending buckets in its note", () => {
    mount(page());
    expect(tile("DEX volume")).toMatchObject({ value: "53.5M XRP", delta: null, sub: "AMM swaps 1.2B, all pools; to Oct 16; Oct 17 not computed yet" });
    cleanup();
    mount(page({ exchanges: { state: "ok", series: seriesView(DEX_VALUES), total: "53500000", pendingWords: null }, currency: "USD", view: { period: "7d", display: "usd" } }));
    expect(tile("DEX volume")).toMatchObject({ value: "53.5M USD", sub: "AMM swaps 1.2B, all pools" });
  });

  it("has no error under the tiles while every part loaded", () => {
    mount(page());
    expect(screen.queryByText(/some totals/)).toBeNull();
  });

  it("shows '—' and 'Couldn’t load' in the four tiles of the metrics when they failed, and one error under the tiles", async () => {
    const loader = vi.fn(() => null);
    mount(page({ metrics: failed() }), { loader });
    for (const label of ["Transactions", "Ledger interval", "Transactions per ledger", "Accounts created"]) {
      expect(tile(label), label).toMatchObject({ value: "—", delta: null, sub: "Couldn’t load" });
    }
    expect(tile("Payment volume").value).toBe("255M XRP");
    expect(tile("DEX volume").value).toBe("53.5M XRP");
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual(["Couldn’t load some totals.Retry"]);
    // Under the tiles.
    expect(region("Totals").nextElementSibling).toBe(alerts[0]);
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alerts[0]!).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });

  it("shows '—' in the payment tile when the payments failed, and the DEX tile when the exchanges failed; one error either way", () => {
    mount(page({ payments: failed() }));
    expect(tile("Payment volume")).toMatchObject({ value: "—", sub: "Couldn’t load" });
    expect(tile("DEX volume").value).toBe("53.5M XRP");
    expect(screen.getAllByText("Couldn’t load some totals.")).toHaveLength(1);
    cleanup();
    mount(page({ exchanges: failed() }));
    expect(tile("DEX volume")).toMatchObject({ value: "—", sub: "Couldn’t load" });
    expect(tile("Payment volume").value).toBe("255M XRP");
    expect(screen.getAllByText("Couldn’t load some totals.")).toHaveLength(1);
  });

  it("says it once when several parts failed", () => {
    mount(page({ metrics: failed(), payments: failed(), exchanges: failed() }));
    expect(screen.getAllByText("Couldn’t load some totals.")).toHaveLength(1);
    expect(Array.from(region("Totals").querySelectorAll(".stat__value")).map((v) => v.textContent)).toEqual(["—", "—", "—", "—", "—", "—"]);
  });
});

describe("NetworkPage, the AMM wordings", () => {
  const legend = (card: HTMLElement) => Array.from(card.querySelectorAll(".legend__item")).map((item) => item.textContent);

  it("ok: the DEX line includes AMM swaps, there is an AMM line, and the note says they are not parts of one total", () => {
    mount(page());
    expect(tile("DEX volume").sub).toContain("AMM swaps 1.2B, all pools");
    const volume = card(/^Volume per day, in XRP$/);
    expect(legend(volume)).toEqual(["Payments", "DEX trades, tracked markets, AMM swaps included", "AMM swaps, all pools"]);
    expect(volume.textContent).toContain("DEX trades count the markets the data API tracks; AMM swaps count every pool, so the lines are not parts of one total.");
    expect(volume.querySelector(".chart__source")!.textContent).toBe("/v2/network/payment_volume · exchange_volume · amm_volume");
    expect(within(volume).queryByRole("alert")).toBeNull();
  });

  it("failed: Payments and DEX are drawn, and the card says AMM swaps could not be loaded, with a Retry", async () => {
    const loader = vi.fn(() => null);
    mount(page({ amm: failed() }), { loader });
    expect(tile("DEX volume").sub).toBe("tracked markets, AMM swaps included; to Oct 16; Oct 17 not computed yet");
    const volume = card(/^Volume per day, in XRP$/);
    expect(legend(volume)).toEqual(["Payments", "DEX trades, tracked markets, AMM swaps included"]);
    const alert = within(volume).getByRole("alert");
    expect(alert.textContent).toBe("AMM swaps couldn’t be loaded.Retry");
    expect(volume.querySelector(".plot")).not.toBeNull();
    expect(volume.textContent).toContain("so the lines are not parts of one total.");
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
    // Only the volume card has it.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("off: no AMM, and the wording does not say the DEX line includes swaps", () => {
    mount(page({ amm: { state: "off" } }));
    expect(tile("DEX volume").sub).toBe("tracked markets; to Oct 16; Oct 17 not computed yet");
    const volume = card(/^Volume per day, in XRP$/);
    expect(legend(volume)).toEqual(["Payments", "DEX trades, tracked markets"]);
    expect(volume.textContent).toContain("DEX trades count the trades of the markets the data API tracks.");
    expect(volume.textContent).not.toContain("AMM");
    expect(volume.querySelector(".chart__source")!.textContent).toBe("/v2/network/payment_volume · exchange_volume");
    expect(within(volume).queryByRole("alert")).toBeNull();
  });

  it("none (Xahau): order book only", () => {
    mount(XAHAU_PAGE(), { network: XAHAU });
    expect(tile("DEX volume").sub).toBe("order book only, no AMM on Xahau; to Oct 16; Oct 17 not computed yet");
    const volume = card(/^Volume per day, in XAH$/);
    expect(legend(volume)).toEqual(["Payments", "DEX trades, tracked markets"]);
    expect(volume.textContent).toContain("Xahau has no AMM; DEX trades are order-book trades of the markets the data API tracks.");
    expect(within(volume).queryByRole("alert")).toBeNull();
  });
});

describe("NetworkPage, the chart cards", () => {
  it("has the cards of the board in order, each named by an h2 with its source line", () => {
    mount(page());
    const cards = Array.from(document.querySelectorAll("section[aria-labelledby]")).map((section) => [
      section.querySelector("h2")?.textContent,
      section.querySelector(".chart__source")?.textContent ?? null,
    ]);
    expect(cards).toEqual([
      ["Transactions by type, per day", "/v2/stats/type?interval=day"],
      ["Average fee per transaction, in drops", "/v2/network/fees?interval=day"],
      ["Volume per day, in XRP", "/v2/network/payment_volume · exchange_volume · amm_volume"],
      ["Payment volume by currency, last 7 days", "/v2/network/payment_volume · components"],
      ["Validators", "/v2/ledgers/{hash}/validations"],
    ]);
  });

  it("says weeks for the year view", () => {
    mount(page({ window: { unit: "week", note: "…" }, view: { period: "1y", display: "native" } }));
    expect(screen.getByRole("heading", { level: 2, name: "Transactions by type, per week" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Volume per week, in XRP" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Payment volume by currency, last 52 weeks" })).toBeTruthy();
    expect(card("Transactions by type, per week").querySelector(".chart__source")!.textContent).toBe("/v2/stats/type?interval=week");
    // The fee chart is always by day.
    expect(card("Average fee per transaction, in drops").querySelector(".chart__source")!.textContent).toBe("/v2/network/fees?interval=day");
  });

  it.each([
    ["7d", "last 7 days"],
    ["30d", "last 30 days"],
    ["90d", "last 90 days"],
    ["1y", "last 52 weeks"],
  ] as const)("names the period of the payments by currency for %s", (period, words) => {
    mount(page({ view: { period, display: "native" } }));
    expect(screen.getByRole("heading", { level: 2, name: `Payment volume by currency, ${words}` })).toBeTruthy();
  });

  it("names the page's currency in the volume title, USD in a USD view", () => {
    mount(page({ view: { period: "7d", display: "usd" }, currency: "USD" }));
    expect(screen.getByRole("heading", { level: 2, name: "Volume per day, in USD" })).toBeTruthy();
  });

  it("draws the types as stacked columns with a swatch legend and the note of the groups", () => {
    mount(page());
    const types = card("Transactions by type, per day");
    expect(Array.from(types.querySelectorAll(".legend__item")).map((item) => item.textContent)).toEqual(["Payment", "OfferCreate", "Other"]);
    expect(types.querySelectorAll(".legend__swatch")).toHaveLength(3);
    expect(types.querySelectorAll(".col__seg").length).toBeGreaterThan(0);
    expect(types.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("Transactions by type per day");
    expect(types.textContent).toContain("AMM adds up its transaction types; Other is every other type.");
    // The table view is in the page too.
    expect(within(types).getByRole("radio", { name: "Table" })).toBeTruthy();
    expect(types.querySelector(".chart__table")!.textContent).toContain("Oct 17, 2026, so far");
  });

  it("draws the fee as one line with an area and no legend, and the note of the drops", () => {
    mount(page());
    const fees = card("Average fee per transaction, in drops");
    expect(fees.querySelector("path.area")).not.toBeNull();
    expect(fees.querySelector("path.line")).not.toBeNull();
    expect(fees.querySelector(".legend")).toBeNull();
    expect(fees.querySelector(".chart__notes")!.textContent).toBe(
      "1 XRP = 1,000,000 drops. Spikes mean the open ledger was busy. The minimum to enter the queue now is 10 drops.",
    );
  });

  it("leaves the minimum fee out of the fee note when the open ledger failed", () => {
    mount(page({ openLedger: failed() }));
    expect(card("Average fee per transaction, in drops").querySelector(".chart__notes")!.textContent).toBe(
      "1 XRP = 1,000,000 drops. Spikes mean the open ledger was busy.",
    );
  });

  it("says Xahau's drop in the fee note", () => {
    mount(XAHAU_PAGE(), { network: XAHAU });
    expect(card("Average fee per transaction, in drops").querySelector(".chart__notes")!.textContent).toContain("1 XAH = 1,000,000 drops.");
  });

  it("draws the volume as lines, a legend of line keys, and end labels with the short names", () => {
    mount(page());
    const volume = card("Volume per day, in XRP");
    expect(volume.querySelectorAll("path.line")).toHaveLength(3);
    expect(volume.querySelectorAll(".legend__line")).toHaveLength(3);
    expect(Array.from(volume.querySelectorAll(".plot__end-label")).map((label) => label.textContent?.replace(/^\S+ /, ""))).toEqual([
      "payments",
      "DEX trades",
      "AMM swaps",
    ]);
  });

  it("notes what the volume routes have not computed yet", () => {
    mount(page());
    expect(card("Volume per day, in XRP").querySelector(".chart__notes")!.textContent).toContain("Oct 17 is not computed yet.");
  });

  // The year is drawn by week: a bucket that is not computed yet is a week, and every card says so.
  it("says a pending week on the weekly axis of the year, in the types, the fee and the volume cards", () => {
    const WEEKS = ["2026-10-05", "2026-10-12"];
    const weekly = { unit: "week", buckets: WEEKS } as const;
    mount(
      page({
        view: { period: "1y", display: "native" },
        window: { unit: "week", note: "Totals and charts cover the 52 weeks from Oct 20, 2025 to Oct 12, 2026 (UTC), this week so far" },
        types: {
          state: "ok",
          chart: { ...typesChart(), axis: weekly, series: [{ id: "payment", label: "Payment", slot: 1, values: ["7000", "700"] }], totals: ["7000", "700"], pending: 1 },
          note: "AMM adds up its transaction types; Other is every other type.",
        },
        fees: { state: "ok", chart: { ...feesChart, axis: weekly, series: [{ id: "fee", label: "Average fee", slot: 1, values: ["12", null] }], pending: 1 } },
        payments: { ...(page().payments as object), series: seriesView(["40000000", null], { buckets: WEEKS, unit: "week", pending: 1 }) } as NetworkPageData["payments"],
        exchanges: { state: "ok", series: seriesView(["8000000", null], { buckets: WEEKS, unit: "week", pending: 1 }), total: "8000000", pendingWords: "to Oct 11; the week of Oct 12 not computed yet" },
      }),
    );
    for (const title of ["Transactions by type, per week", "Average fee per transaction, in drops", "Volume per week, in XRP"]) {
      const notes = card(title).querySelector(".chart__notes")!.textContent!;
      expect(notes, title).toContain("The week of Oct 12 is not computed yet.");
    }
  });

  it("draws the payments by currency as a bar list, with the data's note", () => {
    mount(page());
    const bars = card(/^Payment volume by currency/);
    expect(Array.from(bars.querySelectorAll(".barlist__item")).map((item) => item.querySelector(".barlist__label")!.textContent)).toEqual(["XRP", "USD"]);
    expect(bars.textContent).toContain("Payments in the currencies the data API tracks: XRP, USD.");
    expect(bars.textContent).toContain("58%");
  });
});

describe("NetworkPage, a chart card that could not be loaded", () => {
  it.each([
    ["the types", { types: failed() }, "Transactions by type, per day", "Couldn’t load transactions by type."],
    ["the fees", { fees: failed() }, "Average fee per transaction, in drops", "Couldn’t load the average fee."],
    ["the payments", { payments: failed() }, "Volume per day, in XRP", "Couldn’t load payment and DEX volume."],
    ["the exchanges", { exchanges: failed() }, "Volume per day, in XRP", "Couldn’t load payment and DEX volume."],
    ["the payments", { payments: failed() }, "Payment volume by currency, last 7 days", "Couldn’t load payment volume by currency."],
  ] as const)("shows %s as an error with a Retry in place of the plot and the toggle, and keeps the title and the source", async (_name, over, title, message) => {
    const loader = vi.fn(() => null);
    mount(page(over as Partial<NetworkPageData>), { loader });
    const failedCard = card(title);
    const alert = within(failedCard).getByRole("alert");
    expect(alert.textContent).toBe(`${message}Retry`);
    expect(failedCard.querySelector(".plot, .barlist")).toBeNull();
    expect(within(failedCard).queryByRole("radio")).toBeNull();
    expect(failedCard.querySelector(".chart__source")!.textContent).not.toBe("");
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });

  it("fails only the cards of the part: the exchanges leave the bars, the fees leave the types", () => {
    mount(page({ exchanges: failed() }));
    expect(card(/^Payment volume by currency/).querySelector(".barlist")).not.toBeNull();
    expect(card("Transactions by type, per day").querySelector(".plot")).not.toBeNull();
    expect(card("Average fee per transaction, in drops").querySelector(".plot")).not.toBeNull();
  });

  it("does not print the reason a part failed: that is for the log", () => {
    mount(page({ types: failed("Error: secret internals") }));
    expect(document.body.textContent).not.toContain("secret internals");
  });
});

describe("NetworkPage, the validators", () => {
  it("says how many validators signed which ledger, the number linking to the ledger", () => {
    mount(page());
    const validators = card("Validators");
    expect(validators.querySelector(".network__count")!.textContent).toBe("35");
    expect(validators.querySelector("p")!.textContent).toBe("35 validators signed ledger #107,695,660");
    const link = within(validators).getByRole("link", { name: "#107,695,660" });
    expect(link.getAttribute("href")).toBe("/xrpl/ledger/107695660");
  });

  it("says 'validator' for one, and '1,000+' for a full page", () => {
    mount(page({ validators: { ...(page().validators as object), count: "1" } as NetworkPageData["validators"] }));
    expect(card("Validators").querySelector("p")!.textContent).toBe("1 validator signed ledger #107,695,660");
    cleanup();
    mount(page({ validators: { ...(page().validators as object), count: "1,000+" } as NetworkPageData["validators"] }));
    expect(card("Validators").querySelector("p")!.textContent).toBe("1,000+ validators signed ledger #107,695,660");
  });

  it("lists the five first seen, short keys in mono with their delays, in one list", () => {
    mount(page());
    const validators = card("Validators");
    expect(within(validators).getByText("First seen")).toBeTruthy();
    const rows = Array.from(validators.querySelectorAll(".network__first li")).map((li) => [li.querySelector(".mono")!.textContent, li.textContent]);
    expect(rows).toEqual([
      ["nHUFE9prPX…a3p", "nHUFE9prPX…a3p+0 ms"],
      ["nHBidG3pZK…Pec", "nHBidG3pZK…Pec+12 ms"],
      ["nHUon2tpyJ…TqK", "nHUon2tpyJ…TqK+40 ms"],
      ["nHUpcmNsxA…nqF", "nHUpcmNsxA…nqF+55 ms"],
      ["nHU95JxeaH…4NT", "nHU95JxeaH…4NT+81 ms"],
    ]);
    // One list, the whole of it one figure that ticks in with its ledger.
    expect(validators.querySelectorAll(".network__first ol")).toHaveLength(1);
  });

  it("says what the count counts", () => {
    mount(page());
    expect(card("Validators").textContent).toContain("Counts every validator the data API’s collectors heard, on the UNL or not.");
  });

  it("links 'All validators' to the list when the page is given its address", () => {
    mount(page());
    const link = within(card("Validators")).getByRole("link", { name: "All validators" });
    expect(link.getAttribute("href")).toBe("/xrpl/validators?scope=all");
    expect(card("Validators").querySelector(".is-soon")).toBeNull();
  });

  it("shows 'All validators' as 'soon' in the header's style when there is no address", () => {
    mount(XAHAU_PAGE(), { network: XAHAU });
    const validators = card("Validators");
    expect(within(validators).queryByRole("link", { name: "All validators" })).toBeNull();
    const soon = validators.querySelector("span.nav-item.is-soon")!;
    expect(soon.getAttribute("aria-disabled")).toBe("true");
    expect(soon.textContent).toBe("All validators soon");
    expect(soon.querySelector("span.soon")!.textContent).toBe("soon");
  });

  it("says the validators could not be loaded, with a Retry, in the card that keeps its title and source", async () => {
    const loader = vi.fn(() => null);
    mount(page({ validators: failed() }), { loader });
    const validators = card("Validators");
    const alert = within(validators).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the validators.Retry");
    expect(validators.querySelector(".chart__source")!.textContent).toBe("/v2/ledgers/{hash}/validations");
    expect(within(validators).queryByText("First seen")).toBeNull();
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });
});

describe("NetworkPage, refetching", () => {
  it("dims its charts while another view is loading, and not while it only follows the chain", async () => {
    let release!: () => void;
    let held: Promise<null> | null = null;
    const router = createMemoryRouter([{ path: "*", element: <NetworkPage network={XRPL} data={page()} />, loader: () => held }], {
      initialEntries: ["/xrpl/network"],
      hydrationData: { loaderData: { "0": null } },
    });
    const { container } = render(<RouterProvider router={router} />);
    expect(container.querySelector(".network")!.classList.contains("is-refetching")).toBe(false);

    held = new Promise<null>((resolve) => (release = () => resolve(null)));
    await act(async () => void router.revalidate());
    expect(container.querySelector(".network")!.classList.contains("is-refetching")).toBe(false);
    await act(async () => release());

    held = new Promise<null>((resolve) => (release = () => resolve(null)));
    await act(async () => void router.navigate("/xrpl/network?period=1y"));
    expect(container.querySelector(".network")!.classList.contains("is-refetching")).toBe(true);
    await act(async () => release());
    expect(container.querySelector(".network")!.classList.contains("is-refetching")).toBe(false);
  });
});

// ---- The page follows the chain -------------------------------------------------------------------------------------------------------

describe("NetworkPage, when its data changes", () => {
  const CHIP = 120;
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
    // happy-dom has no layout: the chips of the strip sit side by side, a chip wide each.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const siblings = this.parentElement ? Array.from(this.parentElement.children) : [];
      const left = this.tagName === "LI" && this.classList.contains("chip") ? siblings.indexOf(this) * CHIP : 0;
      return { top: 0, bottom: 40, left, right: left + CHIP, width: CHIP, height: 40, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });

  let update!: (next: NetworkPageData) => void;
  function Host({ first }: { first: NetworkPageData }) {
    const [current, setCurrent] = useState(first);
    update = (next) => act(() => setCurrent(next));
    return <NetworkPage network={XRPL} data={current} />;
  }
  const mountHost = (first = page()) => {
    const router = createMemoryRouter([{ path: "*", element: <Host first={first} /> }], { initialEntries: ["/xrpl/network"] });
    return render(<RouterProvider router={router} />);
  };

  /** The next ledger: a chip in front, the oldest gone; a changed fee and count. */
  const next = (): NetworkPageData => {
    const before = page();
    return page({
      anchor: { lastValidated: 107695661, closeTime: 1792256476 },
      strip: [{ index: 107695661, txCount: 91, closeTime: 1792256476 }, ...before.strip.slice(0, 5)],
    });
  };
  const chips = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>("ol.chips > li"));

  it("animates nothing on the first render, on the server or in the browser", () => {
    const { container } = mountHost();
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(container.querySelector('[style*="transform"], [style*="transition"]')).toBeNull();
    const router = createMemoryRouter([{ path: "*", element: <NetworkPage network={XRPL} data={page()} /> }], { initialEntries: ["/xrpl/network"] });
    expect(renderToString(<RouterProvider router={router} />)).not.toMatch(/is-entering|is-changed/);
  });

  it("brings the new ledger in at the front of the strip and slides the others along", () => {
    const { container } = mountHost();
    update(next());
    const [fresh, ...rest] = chips(container);
    expect(chips(container).map((li) => li.getAttribute("data-key"))).toEqual(["107695661", "107695660", "107695659", "107695658", "107695657", "107695656"]);
    expect(fresh!.classList.contains("is-entering")).toBe(true);
    for (const li of rest) {
      expect(li.classList.contains("is-entering")).toBe(false);
      // Each was a chip further left than it is now.
      expect(li.style.transform).toBe(`translate(-${CHIP}px, 0px)`);
    }
  });

  it("ticks in only the open ledger's figure that changed", () => {
    const { container } = mountHost();
    update(page({ openLedger: { state: "ok", fee: "12", minimum: "10", queue: "0", openSize: "84", expected: "96", asOf: "17:01:10" } }));
    expect(container.querySelector(".network__open .is-changed")!.textContent).toBe("12 drops");
    expect(container.querySelectorAll(".is-changed")).toHaveLength(1);
  });

  it("ticks in only the tile whose figure changed", () => {
    const { container } = mountHost();
    const before = page();
    const metrics = before.metrics.state === "ok" ? before.metrics : null;
    update(page({ metrics: { ...metrics!, transactions: { ...metrics!.transactions, value: "15K" } } }));
    expect(tile("Transactions").element.querySelector(".stat__value .is-changed")!.textContent).toBe("15K");
    expect(container.querySelectorAll(".is-changed")).toHaveLength(1);
    expect(tile("Ledger interval").element.querySelector(".is-changed")).toBeNull();
    expect(tile("Payment volume").element.querySelector(".is-changed")).toBeNull();
  });

  it("ticks in the validator count, its ledger and the five keys when a ledger has been signed", () => {
    const { container } = mountHost();
    const before = page();
    const validators = before.validators.state === "ok" ? before.validators : null;
    update(page({ validators: { ...validators!, ledger: { index: 107695661, hash: "AA".repeat(32) }, count: "34" } }));
    const changed = Array.from(card("Validators").querySelectorAll(".is-changed")).map((element) => element.textContent);
    expect(changed).toContain("34");
    expect(changed).toContain("#107,695,661");
    expect(card("Validators").querySelector(".network__first .is-changed")).not.toBeNull();
    // Nothing outside the card.
    expect(container.querySelectorAll(".is-changed")).toHaveLength(card("Validators").querySelectorAll(".is-changed").length);
  });

  it("animates nothing when the same ledger comes again as new objects, and renders no chart again", () => {
    const { container } = mountHost();
    const plot = container.querySelector(".plot")!;
    update(page());
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(container.querySelector('[style*="transform"]')).toBeNull();
    expect(container.querySelector(".plot")).toBe(plot);
    expect(frames).toHaveLength(0);
  });

  it("rings a chart whose data moved, and no other", () => {
    const { container } = mountHost();
    update(page({ types: { state: "ok", chart: typesChart("types-2"), note: "AMM adds up its transaction types; Other is every other type." } }));
    expect(card("Transactions by type, per day").querySelectorAll(".is-changed").length).toBeGreaterThan(0);
    expect(card("Average fee per transaction, in drops").querySelector(".is-changed")).toBeNull();
    expect(container.querySelector(".network__open .is-changed")).toBeNull();
  });

  it("moves nothing for a visitor who asks for less motion: the chip is marked, no chip is transformed", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener() {}, removeEventListener() {} }));
    const { container } = mountHost();
    update(next());
    expect(container.querySelectorAll("ol.chips > li.is-entering")).toHaveLength(1);
    expect(container.querySelector('[style*="transform"], [style*="transition"]')).toBeNull();
    expect(frames).toHaveLength(0);
  });
});

describe("NetworkPage, as the Worker prints it and the browser takes it over", () => {
  const routed = (ui: ReactElement) => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl/network"] })} />;

  it("hydrates what the server printed with no mismatch, on both networks and in every AMM state", async () => {
    const pages: [typeof XRPL | typeof XAHAU, NetworkPageData][] = [
      [XRPL, page()],
      [XRPL, page({ amm: failed() })],
      [XRPL, page({ amm: { state: "off" } })],
      [XAHAU, XAHAU_PAGE()],
      [XRPL, page({ openLedger: failed(), validators: failed(), types: failed(), fees: failed(), metrics: failed(), payments: failed(), exchanges: failed() })],
    ];
    for (const [network, data] of pages) {
      const { html, errors } = await serverThenHydrated(routed(<NetworkPage network={network} data={data} live={controls()} />));
      expect(errors).toEqual([]);
      expect(html).toContain(NETWORK_TITLES[network.id]);
      expect(html).not.toMatch(/is-entering|is-changed|is-refetching/);
    }
  });

  it("has the columns, the lines and both views of each chart in the server's HTML", () => {
    const router = createMemoryRouter([{ path: "*", element: <NetworkPage network={XRPL} data={page()} /> }], { initialEntries: ["/xrpl/network"] });
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain("col__seg");
    expect(html).toContain('class="line"');
    expect((html.match(/class="chart__table"/g) ?? []).length).toBe(4);
    expect(html).toContain("barlist__item");
  });

  it("keeps its h1 first and the page one column of cards: the section order of the board", () => {
    mount(page());
    const order = Array.from(document.querySelectorAll(".network > *")).map((element) => element.getAttribute("aria-label") ?? element.querySelector("h1, h2")?.textContent ?? element.className);
    // The two pairs of cards are named by the first heading in them.
    expect(order).toEqual([
      "XRPL network",
      "Latest ledgers",
      "Filters",
      "Totals",
      "Transactions by type, per day",
      "Average fee per transaction, in drops",
      "Payment volume by currency, last 7 days",
    ]);
    expect(document.querySelectorAll(".network > .network__pair")).toHaveLength(2);
  });
});
