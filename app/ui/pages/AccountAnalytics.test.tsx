import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, createStaticHandler, createStaticRouter, RouterProvider, StaticRouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { analyticsWindow, type AnalyticsPeriod } from "../../domain/analytics-params";
import { shortAddress } from "../../domain/format";
import {
  analyticsFrame,
  balancesCard,
  changesCard,
  counterpartiesCard,
  dexWording,
  pairsCard,
  sentCard,
  valueCard,
  type AnalyticsData,
  type AnalyticsFrame,
  type BalancesCard,
  type CardState,
  type ChangesCard,
  type CounterpartiesCard,
  type DexWording,
  type PairsCard,
  type SentCard,
  type ValueCard,
} from "../../server/analytics-view";
import type { AccountTxStatsRow, AccountValueRow, AnalyticsBalanceChanges, Page } from "../../server/api-types";
import { featuresOf } from "../features";
import AccountAnalytics from "./AccountAnalytics";

// The Retry of every part is the route's revalidation (`useRetry`): the hook React Router gives it is replaced by a spy.
const revalidator = vi.hoisted(() => ({ revalidate: vi.fn(() => Promise.resolve()), state: "idle" as const }));
vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), useRevalidator: () => revalidator }));

afterEach(() => {
  cleanup();
  revalidator.revalidate.mockClear();
  vi.restoreAllMocks();
});

// ---- The world of the tests: the page data as the view builders make it, for an index whose newest day is Oct 17, 2026 --------------

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH" } as const;
type Net = typeof XRPL | typeof XAHAU;

const T = "2026-10-17";
const ADDRESS = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";
const CAROL = "rYogZ7oXMbYEWXrCQXHDKwe8mLqLDoaWm";
const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";

const XRPL_AMM = dexWording({ hasAmm: true, features: featuresOf({ AMM_DATA: "on" }) });
const XRPL_NO_AMM = dexWording({ hasAmm: true, features: featuresOf({}) });
const XAHAU_DEX = dexWording({ hasAmm: false, features: featuresOf({ AMM_DATA: "on" }) });

const at = (day: string) => `${day}T00:00:00Z`;
const page = <R,>(rows: R[]): Page<"rows", R> => ({ result: "success", count: rows.length, rows });

function frameOf(period: AnalyticsPeriod, deleted = false): AnalyticsFrame {
  const first = period === "all" ? { day: "2025-07-15", from: "activation" as const } : undefined;
  return analyticsFrame(analyticsWindow(period, T, first), { deleted });
}

/** The answers' own window, which the builders do not read. */
const span = (frame: AnalyticsFrame) => ({ result: "success" as const, start: at(frame.start), end: at("2026-10-18") });
const interval = (frame: AnalyticsFrame) => frame.axis.unit as AnalyticsBalanceChanges["interval"];
const newest = (frame: AnalyticsFrame, back = 0) => frame.axis.buckets[frame.axis.buckets.length - 1 - back]!;

/** A value in every bucket, from 16,110 up to 16,787.15 in the running one: "+4.2%". */
function valueOf(frame: AnalyticsFrame, native: Net["native"] = "XRP", empty = false): ValueCard {
  const { buckets } = frame.axis;
  const rows = buckets.map((bucket, i): AccountValueRow => ({
    date: at(bucket),
    account_value: i === buckets.length - 1 ? "16787.15" : String(16110 + i),
    balance_change_count: 1,
  }));
  return valueCard(frame, page(empty ? [] : rows), native);
}

/** 9 transactions sent: 5 two buckets back, and 4 in the running bucket, one of which failed. */
function sentOf(frame: AnalyticsFrame, net: Net["id"] = "xrpl", empty = false): SentCard {
  const rows: AccountTxStatsRow[] = [
    { date: at(newest(frame, 2)), transaction_count: 5, type: { Payment: 3, OfferCreate: 2 }, result: { tesSUCCESS: 5 } },
    { date: at(newest(frame)), transaction_count: 4, type: { Payment: 4 }, result: { tesSUCCESS: 3, tecPATH_DRY: 1 } },
  ];
  return sentCard(frame, page(empty ? [] : rows), net);
}

/** 45,200 received, 38,100 sent and a fee of 0.015408, with DEX trades. */
function changesOf(frame: AnalyticsFrame, dex: DexWording = XRPL_AMM, native: Net["native"] = "XRP", empty = false): ChangesCard {
  const answer: AnalyticsBalanceChanges = {
    ...span(frame),
    interval: interval(frame),
    totals: empty
      ? []
      : [
          { change_type: "transaction_cost", count: 12, in_value: "0", out_value: "0.015408", net_value: "-0.015408" },
          { change_type: "exchange", count: 4, in_value: "1200", out_value: "1100", net_value: "100" },
          { change_type: "payment_destination", count: 3, in_value: "45200", out_value: "0", net_value: "45200" },
          { change_type: "payment_source", count: 2, in_value: "0", out_value: "38100", net_value: "-38100" },
        ],
    count: empty ? 0 : 2,
    rows: empty
      ? []
      : [
          { date: at(newest(frame, 2)), change_type: "payment_source", count: 2, in_value: "0", out_value: "38100" },
          { date: at(newest(frame)), change_type: "payment_destination", count: 3, in_value: "45200", out_value: "0" },
        ],
  };
  return changesCard(frame, answer, native, dex);
}

/** The 2 largest of 14 counterparties, or none. */
function counterpartiesOf(frame: AnalyticsFrame, total = 14): CounterpartiesCard {
  const first = at("2026-10-01");
  return counterpartiesCard(frame, {
    ...span(frame),
    sort: "value",
    total,
    count: total === 0 ? 0 : 2,
    counterparties:
      total === 0
        ? []
        : [
            { account: CAROL, sent_value: "0", received_value: "45200", total_value: "45200", payments_sent: 0, payments_received: 3, first, last: at(T) },
            { account: BOB, sent_value: "38100", received_value: "0", total_value: "38100", payments_sent: 2, payments_received: 0, first, last: at(T) },
          ],
  });
}

/** XRP and a USD line in every bucket: the 2 largest of 7 balances. */
function balancesOf(frame: AnalyticsFrame, empty = false): BalancesCard {
  const { buckets } = frame.axis;
  return balancesCard(frame, {
    ...span(frame),
    interval: interval(frame),
    lines_total: empty ? 0 : 7,
    lines: empty ? [] : [{ currency: "XRP", balance: "16787.15" }, { currency: "USD", counterparty: ISSUER, balance: "120.5" }],
    count: empty ? 0 : buckets.length * 2,
    rows: empty
      ? []
      : buckets.flatMap((bucket, i) => [
          { date: at(bucket), currency: "XRP", balance: String(16110 + i) },
          { date: at(bucket), currency: "USD", counterparty: ISSUER, balance: "120.5" },
        ]),
  });
}

/** USD/XRP as the API stores it, shown as XRP/USD: the largest of 9 pairs. */
function pairsOf(frame: AnalyticsFrame, opts: { markets?: boolean; dex?: DexWording; net?: Net; empty?: boolean } = {}): PairsCard {
  const net = opts.net ?? XRPL;
  return pairsCard(
    frame,
    {
      ...span(frame),
      total: opts.empty ? 0 : 9,
      count: opts.empty ? 0 : 1,
      pairs: opts.empty
        ? []
        : [
            {
              base_currency: "USD",
              base_issuer: ISSUER,
              counter_currency: net.native,
              count: 4,
              base_volume: "100",
              counter_volume: "250",
              bought: "60",
              sold: "40",
              bought_counter: "150",
              sold_counter: "100",
              native_volume: "250",
            },
          ],
    },
    { net: net.id, native: net.native, markets: opts.markets ?? true, dex: opts.dex ?? XRPL_AMM },
  );
}

/** A part as the page data gives it: settled to a state, or never (`"pending"`, a stream that has not come yet). */
type Given<T> = CardState<T> | "pending";
const promised = <T,>(given: Given<T>): Promise<CardState<T>> => (given === "pending" ? new Promise(() => {}) : Promise.resolve(given));
const ok = <T extends object>(card: T): CardState<T> => ({ state: "ok", ...card });

interface Parts {
  frame: Given<AnalyticsFrame>;
  value: Given<ValueCard>;
  sent: Given<SentCard>;
  changes: Given<ChangesCard>;
  counterparties: Given<CounterpartiesCard>;
  balances: Given<BalancesCard>;
  pairs: Given<PairsCard>;
}

/** Every card in one state. */
const everyCard = (given: "pending" | { state: "failed" } | { state: "late" }) => ({
  value: given,
  sent: given,
  changes: given,
  counterparties: given,
  balances: given,
  pairs: given,
});

function analytics(period: AnalyticsPeriod = "30d", over: Partial<Parts> = {}): AnalyticsData {
  const frame = frameOf(period);
  return {
    period,
    frame: promised(over.frame ?? ok(frame)),
    value: promised(over.value ?? ok(valueOf(frame))),
    sent: promised(over.sent ?? ok(sentOf(frame))),
    changes: promised(over.changes ?? ok(changesOf(frame))),
    counterparties: promised(over.counterparties ?? ok(counterpartiesOf(frame))),
    balances: promised(over.balances ?? ok(balancesOf(frame))),
    pairs: promised(over.pairs ?? ok(pairsOf(frame))),
  };
}

// ---- Drawing it --------------------------------------------------------------------------------------------------------------------

const routed = (ui: ReactElement) => (
  <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [`/xrpl/account/${ADDRESS}?tab=analytics`] })} />
);

/**
 * Prints `ui` until two prints agree: `Await` tracks a promise the first time it is drawn, and draws what it settled to from the next render
 * on. The last print is the HTML the Worker's stream ends with once every promise that settles has settled; a render after it draws the same.
 */
async function settle(ui: ReactElement): Promise<string> {
  let before: string | null = null;
  for (let round = 0; round < 10; round += 1) {
    const html = renderToString(ui);
    if (html === before) return html;
    before = html;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("the HTML did not settle");
}

/** The view drawn in the browser with its promises settled (or never settling). */
async function show(data: AnalyticsData, network: Net = XRPL) {
  const ui = routed(<AccountAnalytics network={network} analytics={data} />);
  await settle(ui);
  return render(ui);
}

const card = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;
const summary = () => document.querySelector<HTMLElement>('section[aria-label="Summary"]')!;
const tiles = () => Array.from(summary().querySelectorAll<HTMLElement>(".stat"));
const tile = (label: string) => tiles().find((element) => element.querySelector(".stat__label")!.textContent === label)!;
const text = (element: Element | null) => element?.textContent ?? null;
/** What a tile shows: its label, figure, delta, sub and source, as text (`null` for a part it does not have). */
const tileText = (element: HTMLElement) =>
  [".stat__label", ".stat__value", ".stat__delta", ".stat__sub", ".stat__source"].map((selector) => text(element.querySelector(selector)));

const TITLES = [
  "Account value, in XRP",
  "Transactions sent per day, by type",
  "Balance history, per currency",
  "Money in and out per day, in XRP",
  "Where balance changes come from, last 30 days",
  "Top counterparties, by value",
  "DEX trading, per pair",
];

// ---- The view --------------------------------------------------------------------------------------------------------------------------

describe("the analytics view, in the board's order", () => {
  it("opens with the four tiles of the summary, each with its figure, its words and the route it is made from", async () => {
    await show(analytics());
    expect(summary().className).toBe("stat-grid");
    expect(tiles().map(tileText)).toEqual([
      ["Account value now", "16,787.15 XRP", "+4.2% over the last 30 days", null, "/v2/accounts/{a}/stats/value?interval=day"],
      ["Transactions sent", "9", null, "1 failed, fee still paid", "/v2/accounts/{a}/stats/transactions?interval=day"],
      ["Fees paid", "0.015408 XRP", null, "15,408 drops, burned", "/v2/accounts/{a}/analytics/balance_changes?interval=day"],
      ["Counterparties", "14", null, "accounts it paid or was paid by", "/v2/accounts/{a}/analytics/counterparties"],
    ]);
    expect(tiles().every((element) => element.classList.contains("stat--figure"))).toBe(true);
    // The delta's triangle points up for a rise.
    expect(tile("Account value now").querySelector(".stat__delta svg")).not.toBeNull();
  });

  it("then the cards: value and sent side by side, balances, money, where changes come from, then counterparties and DEX side by side", async () => {
    const { container } = await show(analytics());
    expect(Array.from(container.querySelectorAll("h2")).map((h2) => h2.textContent)).toEqual(TITLES);

    const root = container.querySelector(".analytics")!;
    expect(Array.from(root.children).map((child) => child.className)).toEqual([
      "stat-grid",
      "analytics__row",
      "card chart",
      "card chart",
      "card card--flush",
      "analytics__row",
    ]);
    const [charts, tables] = Array.from(root.querySelectorAll(":scope > .analytics__row"));
    expect(Array.from(charts!.children).map((child) => [child.querySelector("h2")!.textContent, child.classList.contains("analytics__half")])).toEqual([
      [TITLES[0], true],
      [TITLES[1], true],
    ]);
    expect(Array.from(tables!.children).map((child) => [child.querySelector("h2")!.textContent, child.classList.contains("analytics__table-half")])).toEqual([
      [TITLES[5], true],
      [TITLES[6], true],
    ]);
  });

  it("names the chart cards by their ids, so that each has a toggle of its own", async () => {
    const { container } = await show(analytics());
    for (const [id, title] of [
      ["analytics-value", TITLES[0]],
      ["analytics-sent", TITLES[1]],
      ["analytics-balances", TITLES[2]],
      ["analytics-money", TITLES[3]],
    ] as const) {
      expect(container.querySelector(`#${id}-title`)!.textContent).toBe(title);
      expect(container.querySelectorAll(`input[name="${id}-view"]`)).toHaveLength(2);
    }
  });

  it("draws the account value as a line with its notes, and the sent transactions as stacked columns with their legend", async () => {
    await show(analytics());
    const value = card(TITLES[0]!);
    expect(value.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/stats/value?interval=day");
    expect(value.querySelector("path.line")).not.toBeNull();
    expect(value.querySelector(".legend")).toBeNull();
    // The builder's notes, in its order: what the value is, and where the axis starts (it does not start at 0).
    expect(Array.from(value.querySelectorAll(".chart__notes p")).map((p) => p.textContent)).toEqual(valueOf(frameOf("30d")).notes);
    expect(value.querySelector(".chart__notes p")!.textContent).toBe("XRP plus every token held, valued at the end of each day.");
    expect(value.querySelectorAll(".chart__notes p")[1]!.textContent).toMatch(/^The axis starts at [\d,]+ XRP\.$/);

    const sent = card(TITLES[1]!);
    expect(sent.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/stats/transactions?interval=day");
    expect(sent.querySelectorAll(".col__seg").length).toBeGreaterThan(0);
    const legend = within(sent).getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Payment")).toBeTruthy();
    expect(legend.textContent).toContain("× has a failed transaction");
  });

  it("puts the money summary between the legend and the plot, with the legend's words for up and down", async () => {
    await show(analytics());
    const money = card(TITLES[3]!);
    expect(Array.from(money.children).map((child) => child.className)).toEqual([
      "chart__head",
      "legend",
      "chart__summary",
      "chart__view",
      "chart__table",
      "chart__notes",
    ]);
    expect(money.querySelector(".chart__summary")!.textContent).toBe("Received +45.2K · sent −38.1K · net +7,100 XRP");
    expect(Array.from(money.querySelectorAll(".chart__summary b")).map((b) => b.textContent)).toEqual(["+45.2K", "−38.1K", "+7,100"]);
    expect(Array.from(money.querySelectorAll(".legend__item")).map((item) => item.textContent)).toEqual(["Received, drawn up", "Sent, drawn down"]);
    expect(money.querySelector(".col__bar--down")).not.toBeNull();
    expect(money.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/analytics/balance_changes?interval=day");
  });

  it("draws a panel for each balance, with the balances' notes", async () => {
    await show(analytics());
    const balances = card(TITLES[2]!);
    expect(Array.from(balances.querySelectorAll(".panel__name")).map((name) => name.textContent)).toEqual(["XRP", "USD rhub8V…F3wq"]);
    expect(balances.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/analytics/balances?interval=day");
    expect(Array.from(balances.querySelectorAll(".chart__notes p")).map((p) => p.textContent)).toEqual([
      "Each currency on its own scale, from zero; hover or focus one to read all of them on the same day.",
      "The 2 largest of 7 balances: XRP first, then by value now.",
    ]);
  });

  it("lists where the balance changes come from in a table of 900 px at least, with a bar of out and in for each row that has a change", async () => {
    await show(analytics());
    const sources = card(TITLES[4]!);
    expect(sources.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/analytics/balance_changes");
    expect(Array.from(sources.querySelectorAll(".legend__item")).map((item) => item.textContent)).toEqual(["Out, to the left", "In, to the right"]);

    const table = within(sources).getByRole("table", { name: TITLES[4] });
    expect(table.style.minWidth).toBe("900px");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Change type",
      "Out · In",
      "In, XRP",
      "Out, XRP",
      "Net, XRP",
      "Changes",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["Feestransaction cost, burned", "", "0", "0.015408", "−0.015408", "12"],
      ["DEX tradesorder book and AMM", "", "1,200", "1,100", "+100", "4"],
      ["Payments inreceived", "", "45,200", "0", "+45,200", "3"],
      ["Payments outsent", "", "0", "38,100", "−38,100", "2"],
      ["Passed throughas an intermediary", "", "0", "0", "0", "0"],
      ["Escrowlocked, finished or cancelled", "", "0", "0", "0", "0"],
      ["Payment channelsfunded or claimed", "", "0", "0", "0", "0"],
    ]);
    // A row with changes has its bar, on the one scale of every row; a row with none has no bar.
    expect(rows.map((row) => row.querySelector(".inline-bar--diverging") !== null)).toEqual([true, true, true, true, false, false, false]);
    expect((rows[2]!.querySelector(".inline-bar__in") as HTMLElement).style.width).toBe("50%");
    expect(rows[1]!.querySelector(".analytics__hint")!.textContent).toBe("order book and AMM");
    expect(sources.querySelector(".analytics__notes")!.textContent).toBe(
      "Every balance change of the period, grouped by what caused it. Passed through: payments that rippled through this account's trust lines on their way to someone else.",
    );
  });

  it("lists the top counterparties in a table of 480 px at least, each a link to its account, with the note under it", async () => {
    await show(analytics());
    const counterparties = card(TITLES[5]!);
    expect(counterparties.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/analytics/counterparties");
    const table = within(counterparties).getByRole("table", { name: TITLES[5] });
    expect(table.style.minWidth).toBe("480px");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Counterparty", "Sent, XRP", "Received, XRP", "Payments"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      [shortAddress(CAROL), "—", "45,200", "3"],
      [shortAddress(BOB), "38,100", "—", "2"],
    ]);
    expect(within(rows[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${CAROL}`);
    expect(counterparties.querySelector(".analytics__notes")!.textContent).toBe("The 2 largest of 14 counterparties, by value sent plus received.");
  });

  it("lists the DEX pairs in a table of 520 px at least, in the natural orientation, with their notes", async () => {
    await show(analytics());
    const pairs = card(TITLES[6]!);
    expect(pairs.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/analytics/exchanges");
    const table = within(pairs).getByRole("table", { name: TITLES[6] });
    expect(table.style.minWidth).toBe("520px");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Pair", "Volume, XRP", "Trades", "Bought", "Sold"]);
    const [row] = within(table).getAllByRole("row").slice(1);
    expect(within(row!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["XRP/USDUSD rhub8V…F3wq", "250", "4", "100 XRP", "150 XRP"]);
    expect(Array.from(pairs.querySelectorAll(".analytics__notes p")).map((p) => p.textContent)).toEqual([
      "Includes swaps against AMM pools.",
      "Bought and sold are of each pair's base as shown.",
      "The 1 largest of 9 pairs, by volume in XRP.",
    ]);
  });

  it("marks the running day in the account value's table: its newest row is 'Oct 17, 2026, so far'", async () => {
    await show(analytics());
    const table = within(card(TITLES[0]!)).getByRole("table", { name: TITLES[0] });
    const [, newestRow] = within(table).getAllByRole("row");
    expect(within(newestRow!).getAllByRole("cell")[0]!.textContent).toBe("Oct 17, 2026, so far");
  });
});

describe("the units of the view, which are the frame's", () => {
  it("are weeks for 1 year: the titles, the sources and the table say so", async () => {
    await show(analytics("1y"));
    expect(screen.getByRole("heading", { level: 2, name: "Transactions sent per week, by type" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Money in and out per week, in XRP" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Where balance changes come from, last 52 weeks" })).toBeTruthy();
    expect(tiles().map((element) => element.querySelector(".stat__source")!.textContent)).toEqual([
      "/v2/accounts/{a}/stats/value?interval=week",
      "/v2/accounts/{a}/stats/transactions?interval=week",
      "/v2/accounts/{a}/analytics/balance_changes?interval=week",
      "/v2/accounts/{a}/analytics/counterparties",
    ]);
    expect(within(card("Account value, in XRP")).getAllByRole("columnheader")[0]!.textContent).toBe("Week of (UTC)");
  });

  it("are months for All, with month labels", async () => {
    await show(analytics("all"));
    expect(screen.getByRole("heading", { level: 2, name: "Transactions sent per month, by type" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Money in and out per month, in XRP" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Where balance changes come from, since Jul 2025" })).toBeTruthy();
    const value = card("Account value, in XRP");
    expect(within(value).getAllByRole("columnheader")[0]!.textContent).toBe("Month (UTC)");
    const [, newestRow] = within(within(value).getByRole("table", { name: "Account value, in XRP" })).getAllByRole("row");
    expect(within(newestRow!).getAllByRole("cell")[0]!.textContent).toBe("Oct 2026, so far");
    expect(value.querySelector(".chart__view")!.textContent).toContain("Jul 2025");
    expect(tile("Account value now").querySelector(".stat__delta")!.textContent).toMatch(/ since Jul 2025$/);
  });

  it("are the network's native currency on Xahau", async () => {
    const frame = frameOf("30d");
    await show(
      analytics("30d", {
        value: ok(valueOf(frame, "XAH")),
        sent: ok(sentOf(frame, "xahau")),
        changes: ok(changesOf(frame, XAHAU_DEX, "XAH")),
        pairs: ok(pairsOf(frame, { net: XAHAU, dex: XAHAU_DEX })),
      }),
      XAHAU,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Account value, in XAH" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Money in and out per day, in XAH" })).toBeTruthy();
    expect(within(card("Top counterparties, by value")).getAllByRole("columnheader")[1]!.textContent).toBe("Sent, XAH");
    expect(within(card("DEX trading, per pair")).getAllByRole("columnheader")[1]!.textContent).toBe("Volume, XAH");
  });
});

// ---- States --------------------------------------------------------------------------------------------------------------------------

describe("a card before its data", () => {
  it("has busy tiles with their sources, loading charts with their titles and sources, and table frames of 8, 6 and 6 rows", async () => {
    const { container } = await show(analytics("30d", everyCard("pending")));
    expect(tiles().map((element) => [element.getAttribute("aria-busy"), text(element.querySelector(".stat__value")), text(element.querySelector(".stat__source"))])).toEqual([
      ["true", "", "/v2/accounts/{a}/stats/value?interval=day"],
      ["true", "", "/v2/accounts/{a}/stats/transactions?interval=day"],
      ["true", "", "/v2/accounts/{a}/analytics/balance_changes?interval=day"],
      ["true", "", "/v2/accounts/{a}/analytics/counterparties"],
    ]);
    expect(Array.from(container.querySelectorAll("h2")).map((h2) => h2.textContent)).toEqual(TITLES);

    for (const title of TITLES.slice(0, 4)) {
      const chart = card(title);
      expect(chart.getAttribute("aria-busy")).toBe("true");
      expect(chart.querySelector(".chart__loading")!.getAttribute("aria-hidden")).toBe("true");
      expect(chart.querySelector(".chart__loading")!.textContent).toBe("Loading…");
      expect(chart.querySelector("fieldset")).toBeNull();
    }
    const frames = TITLES.slice(4).map((title) => card(title).querySelector<HTMLElement>(".analytics__table-loading")!);
    expect(frames.map((frame) => [frame.style.getPropertyValue("--rows"), frame.getAttribute("aria-hidden"), frame.textContent])).toEqual([
      ["8", "true", "Loading…"],
      ["6", "true", "Loading…"],
      ["6", "true", "Loading…"],
    ]);
    expect(TITLES.slice(4).map((title) => card(title).querySelector(".chart__source")!.textContent)).toEqual([
      "/v2/accounts/{a}/analytics/balance_changes",
      "/v2/accounts/{a}/analytics/counterparties",
      "/v2/accounts/{a}/analytics/exchanges",
    ]);
    expect(screen.queryByRole("table")).toBeNull();
    // The page's one status (the filter row's) says it is loading; the placeholders are not live regions, and nothing here is an error.
    expect(container.querySelectorAll('[role="status"], [aria-live], [role="alert"]')).toHaveLength(0);
  });

  it("takes the source line of a part that has not come from the frame, which names the routes as the cards do", async () => {
    const frame = frameOf("30d");
    const sources: AnalyticsFrame["sources"] = { value: "frame:value", sent: "frame:sent", changes: "frame:changes", sources: "frame:sources", counterparties: "frame:counterparties", balances: "frame:balances", pairs: "frame:pairs" };
    await show(analytics("30d", { frame: ok({ ...frame, sources }), ...everyCard("pending") }));
    expect(tiles().map((element) => text(element.querySelector(".stat__source")))).toEqual(["frame:value", "frame:sent", "frame:changes", "frame:counterparties"]);
    expect(TITLES.map((title) => card(title).querySelector(".chart__source")!.textContent)).toEqual([
      "frame:value",
      "frame:sent",
      "frame:balances",
      "frame:changes",
      "frame:sources",
      "frame:counterparties",
      "frame:pairs",
    ]);
  });

  it("is drawn with the same sources whether it has come or not", async () => {
    const { unmount } = await show(analytics("1y", everyCard("pending")));
    const sources = () => Array.from(document.querySelectorAll(".chart__source, .stat__source")).map((element) => element.textContent);
    const before = sources();
    unmount();
    await show(analytics("1y"));
    expect(sources()).toEqual(before);
  });
});

describe("a card whose call failed", () => {
  it("has its tiles read '—' over 'Couldn't load', and each card the section error of its own words in place of its views and toggle", async () => {
    const { container } = await show(analytics("30d", everyCard({ state: "failed" })));
    expect(tiles().map((element) => [text(element.querySelector(".stat__value")), text(element.querySelector(".stat__sub")), element.hasAttribute("aria-busy")])).toEqual([
      ["—", "Couldn’t load", false],
      ["—", "Couldn’t load", false],
      ["—", "Couldn’t load", false],
      ["—", "Couldn’t load", false],
    ]);
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Couldn’t load the account value.Retry",
      "Couldn’t load the transactions sent.Retry",
      "Couldn’t load the balance history.Retry",
      "Couldn’t load the balance changes.Retry",
      "Couldn’t load the balance changes.Retry",
      "Couldn’t load the counterparties.Retry",
      "Couldn’t load the DEX trading.Retry",
    ]);
    expect(Array.from(container.querySelectorAll("h2")).map((h2) => h2.textContent)).toEqual(TITLES);
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.querySelector(".chart__view")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("costs only its own card and tile: the others are drawn", async () => {
    await show(analytics("30d", { counterparties: { state: "failed" } }));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual(["Couldn’t load the counterparties.Retry"]);
    expect(text(tile("Counterparties").querySelector(".stat__value"))).toBe("—");
    expect(text(tile("Fees paid").querySelector(".stat__value"))).toBe("0.015408 XRP");
    expect(within(card(TITLES[6]!)).getByRole("table")).toBeTruthy();
  });

  it("fetches the page's data again on Retry", async () => {
    await show(analytics("30d", { counterparties: { state: "failed" } }));
    fireEvent.click(within(card(TITLES[5]!)).getByRole("button", { name: "Retry" }));
    expect(revalidator.revalidate).toHaveBeenCalledTimes(1);
  });
});

describe("a card whose call came too late", () => {
  it("has its tiles read '—' over 'Still working on it', and each card says it is still working on it, with a Retry", async () => {
    const { container } = await show(analytics("30d", everyCard({ state: "late" })));
    expect(tiles().map((element) => [text(element.querySelector(".stat__value")), text(element.querySelector(".stat__sub"))])).toEqual([
      ["—", "Still working on it"],
      ["—", "Still working on it"],
      ["—", "Still working on it"],
      ["—", "Still working on it"],
    ]);
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Still working on the account value. Retry in a few seconds.Retry",
      "Still working on the transactions sent. Retry in a few seconds.Retry",
      "Still working on the balance history. Retry in a few seconds.Retry",
      "Still working on the balance changes. Retry in a few seconds.Retry",
      "Still working on the balance changes. Retry in a few seconds.Retry",
      "Still working on the counterparties. Retry in a few seconds.Retry",
      "Still working on the DEX trading. Retry in a few seconds.Retry",
    ]);
    expect(container.querySelector("fieldset")).toBeNull();
    fireEvent.click(within(card(TITLES[0]!)).getByRole("button", { name: "Retry" }));
    expect(revalidator.revalidate).toHaveBeenCalledTimes(1);
  });
});

describe("a card with nothing in the period", () => {
  it("has the figures for nothing in its tiles, the empty words in its charts, and its empty sentence in place of its table", async () => {
    const frame = frameOf("30d");
    const { container } = await show(
      analytics("30d", {
        value: ok(valueOf(frame, "XRP", true)),
        sent: ok(sentOf(frame, "xrpl", true)),
        changes: ok(changesOf(frame, XRPL_AMM, "XRP", true)),
        counterparties: ok(counterpartiesOf(frame, 0)),
        balances: ok(balancesOf(frame, true)),
        pairs: ok(pairsOf(frame, { empty: true })),
      }),
    );
    expect(tiles().map((element) => [text(element.querySelector(".stat__value")), text(element.querySelector(".stat__delta")), text(element.querySelector(".stat__sub"))])).toEqual([
      ["—", null, null],
      ["0", null, "none failed"],
      ["0 XRP", null, "0 drops, burned"],
      ["0", null, "accounts it paid or was paid by"],
    ]);
    expect(card(TITLES[0]!).textContent).toContain("No balance in these 30 days");
    expect(card(TITLES[1]!).textContent).toContain("No transactions sent in these 30 days");
    expect(card(TITLES[2]!).querySelector(".analytics__empty")!.textContent).toBe("No balances in these 30 days");
    expect(card(TITLES[3]!).textContent).toContain("No money in or out in these 30 days");
    expect(card(TITLES[3]!).querySelector(".chart__summary")).toBeNull();
    expect(TITLES.slice(4).map((title) => [card(title).querySelector(".analytics__empty")?.textContent, within(card(title)).queryByRole("table")])).toEqual([
      ["No balance changes in these 30 days.", null],
      ["No payments in these 30 days.", null],
      ["No DEX trades in these 30 days.", null],
    ]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("the frame", () => {
  it("that failed is one error for the whole view, with a Retry, and no tiles or cards: the cards are not read", async () => {
    const { container } = await show(analytics("30d", { frame: { state: "failed" }, ...everyCard({ state: "failed" }) }));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual(["Couldn’t load the analytics.Retry"]);
    expect(container.querySelector('section[aria-label="Summary"]')).toBeNull();
    expect(container.querySelector("h2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(revalidator.revalidate).toHaveBeenCalledTimes(1);
  });

  it("that came too late says the view is still being worked on, with a Retry", async () => {
    const { container } = await show(analytics("30d", { frame: { state: "late" } }));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual(["Still working on the analytics. Retry in a few seconds.Retry"]);
    expect(container.querySelector('section[aria-label="Summary"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(revalidator.revalidate).toHaveBeenCalledTimes(1);
  });

  it("that has not come is a placeholder hidden from assistive technology, and nothing else", async () => {
    const { container } = await show(analytics("30d", { frame: "pending" }));
    const waiting = container.querySelector(".analytics__waiting")!;
    expect(waiting.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".analytics")!.children).toHaveLength(1);
    expect(container.querySelector('[role="alert"], [role="status"]')).toBeNull();
  });
});

describe("a deleted account", () => {
  it("has its first tile read '—' over 'Deleted accounts hold nothing', with no delta", async () => {
    const frame = frameOf("30d", true);
    await show(analytics("30d", { frame: ok(frame), value: ok(valueOf(frame)) }));
    expect(tileText(tile("Account value now"))).toEqual([
      "Account value now",
      "—",
      null,
      "Deleted accounts hold nothing",
      "/v2/accounts/{a}/stats/value?interval=day",
    ]);
  });
});

describe("the DEX pairs", () => {
  it("are links to their pair pages while the markets are on, and plain text when the data gives no link", async () => {
    const frame = frameOf("30d");
    const { unmount } = await show(analytics("30d", { pairs: ok(pairsOf(frame, { markets: true })) }));
    const link = within(card(TITLES[6]!)).getByRole("link", { name: "XRP/USD" });
    expect(link.getAttribute("href")).toBe(`/xrpl/markets/XRP/USD.${ISSUER}`);
    unmount();

    await show(analytics("30d", { pairs: ok(pairsOf(frame, { markets: false })) }));
    const pairs = card(TITLES[6]!);
    expect(within(pairs).queryByRole("link")).toBeNull();
    expect(within(pairs).getByText("XRP/USD")).toBeTruthy();
  });

  it("say what the index holds of the DEX in the data's words: AMM on, AMM off, and Xahau", async () => {
    const frame = frameOf("30d");
    const cases: [DexWording, Net, string, string][] = [
      [XRPL_AMM, XRPL, "order book and AMM", "Includes swaps against AMM pools."],
      [XRPL_NO_AMM, XRPL, "on the DEX", "Bought and sold are of each pair's base as shown."],
      [XAHAU_DEX, XAHAU, "order book", "Order-book trades only; Xahau has no AMM."],
    ];
    for (const [dex, net, hint, lead] of cases) {
      const { unmount } = await show(
        analytics("30d", { changes: ok(changesOf(frame, dex, net.native)), pairs: ok(pairsOf(frame, { dex, net })) }),
        net,
      );
      const dexRow = within(card(TITLES[4]!)).getAllByRole("row")[2]!;
      expect(dexRow.querySelector(".analytics__hint")!.textContent).toBe(hint);
      expect(card(TITLES[6]!).querySelector(".analytics__notes p")!.textContent).toBe(lead);
      unmount();
    }
  });
});

// ---- The server and the browser ------------------------------------------------------------------------------------------------------

describe("the server's HTML", () => {
  it("holds every mark and table, and the browser takes it over with no mismatch", async () => {
    const element = <AccountAnalytics network={XRPL} analytics={analytics()} />;
    const handler = createStaticHandler([{ path: "*", element }]);
    const context = await handler.query(new Request(`http://explorer.test/xrpl/account/${ADDRESS}?tab=analytics`));
    if (context instanceof Response) throw new Error("expected a render");
    const server = <StaticRouterProvider router={createStaticRouter(handler.dataRoutes, context)} context={context} hydrate={false} />;
    const html = await settle(server);

    // The tiles, the line, the columns, the panels, the bars and every table are in the HTML: the first paint needs no script.
    expect(html).toContain("16,787.15 XRP");
    expect(html).toContain('class="line"');
    expect(html).toContain('class="col__seg"');
    expect(html).toContain('class="col__bar col__bar--down"');
    expect(html).toContain('class="panel"');
    expect(html).toContain('class="inline-bar__in"');
    expect(html.match(/role="table"/g)).toHaveLength(7);
    expect(html).not.toContain("Loading…");

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(" ")));
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, routed(element), { onRecoverableError: (error) => void errors.push(String(error)) });
    });
    expect(errors).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('section[aria-label="Summary"]')).not.toBeNull();
    container.remove();
  });

  it("hydrates every state of the parts with no mismatch", async () => {
    const cases: [AnalyticsData, Net][] = [
      [analytics("30d", everyCard({ state: "failed" })), XRPL],
      [analytics("1y", everyCard({ state: "late" })), XRPL],
      [analytics("30d", { frame: { state: "failed" } }), XRPL],
      [analytics("30d", { frame: { state: "late" } }), XRPL],
      [analytics("all"), XRPL],
      [analytics("90d", { pairs: ok(pairsOf(frameOf("90d"), { dex: XRPL_NO_AMM, markets: false })) }), XRPL],
    ];
    for (const [data, network] of cases) {
      const ui = routed(<AccountAnalytics network={network} analytics={data} />);
      const html = await settle(ui);
      const errors: string[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(" ")));
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.appendChild(container);
      let root!: Root;
      await act(async () => {
        root = hydrateRoot(container, ui, { onRecoverableError: (error) => void errors.push(String(error)) });
      });
      expect(errors).toEqual([]);
      spy.mockRestore();
      act(() => root.unmount());
      container.remove();
    }
  });
});

describe("another period", () => {
  it("remounts the view: a chart shown as a table is a chart again, where new data of the same period leaves the choice alone", async () => {
    const first = analytics("30d");
    const again = analytics("30d");
    const other = analytics("90d");
    for (const data of [first, again, other]) await settle(routed(<AccountAnalytics network={XRPL} analytics={data} />));

    let setData!: (data: AnalyticsData) => void;
    function Harness() {
      const [data, set] = useState(first);
      setData = set;
      return <AccountAnalytics network={XRPL} analytics={data} />;
    }
    const { container } = render(routed(<Harness />));
    const radio = (value: "chart" | "table") => container.querySelector<HTMLInputElement>(`input[name="analytics-value-view"][value="${value}"]`)!;
    fireEvent.click(radio("table"));
    expect(radio("table").checked).toBe(true);

    act(() => setData(again));
    expect(radio("table").checked).toBe(true);

    act(() => setData(other));
    expect(radio("chart").checked).toBe(true);
    expect(radio("table").checked).toBe(false);
    expect(screen.getByRole("heading", { level: 2, name: "Where balance changes come from, last 90 days" })).toBeTruthy();
  });
});
