import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import type { AnalyticsPeriod } from "../../domain/analytics-params";
import type { AnalyticsFrame, CardState } from "../../server/analytics-view";
import { AnalyticsFilters } from "./AnalyticsFilters";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH" } as const;
const NOTE = "The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now.";

const FRAME: AnalyticsFrame = {
  period: "30d",
  axis: { unit: "day", buckets: ["2026-10-16", "2026-10-17"] },
  start: "2026-09-18",
  phrase: { title: "last 30 days", empty: "these 30 days", meta: null },
  note: NOTE,
  deleted: false,
};

/** A promise that never settles: the frame of a stream that has not come yet. */
const pending = () => new Promise<CardState<AnalyticsFrame>>(() => {});

function routed(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl/account/A?tab=analytics"] });
  return { router, element: <RouterProvider router={router} /> };
}

function filters(over: { period?: AnalyticsPeriod; frame?: Promise<CardState<AnalyticsFrame>>; network?: typeof XRPL | typeof XAHAU } = {}) {
  const analytics = { period: over.period ?? "30d", frame: over.frame ?? Promise.resolve<CardState<AnalyticsFrame>>({ state: "ok", ...FRAME }) };
  return routed(<AnalyticsFilters network={over.network ?? XRPL} address="A" analytics={analytics} />);
}

/**
 * Prints `ui` until two prints agree: `Await` tracks a promise the first time it is drawn and draws what it settled to from the next render on.
 * The last print is the HTML the Worker's stream ends with once the frame has settled.
 */
async function settle(ui: ReactElement): Promise<void> {
  let before: string | null = null;
  for (let round = 0; round < 10; round += 1) {
    const html = renderToString(ui);
    if (html === before) return;
    before = html;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("the HTML did not settle");
}

describe("AnalyticsFilters", () => {
  it("is a group named Analytics filters: the period links, then the values note, then the period note", async () => {
    render(filters().element);
    const group = screen.getByRole("group", { name: "Analytics filters" });
    expect(group.className).toBe("analytics-filters");
    expect(await within(group).findByText(NOTE)).toBeTruthy();
    expect(Array.from(group.children).map((child) => child.className)).toEqual(["seglinks", "analytics-filters__values", "analytics-filters__note"]);
  });

  it("has the period's segmented links after the label Period: one for each period, each with rel=nofollow, the current one marked", () => {
    render(filters().element);
    const period = screen.getByRole("group", { name: "Period" });
    expect(period.closest(".analytics-filters")).not.toBeNull();
    const links = within(period).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("rel"), link.getAttribute("aria-current")])).toEqual([
      ["30 days", "/xrpl/account/A?tab=analytics", "nofollow", "true"],
      ["90 days", "/xrpl/account/A?tab=analytics&period=90d", "nofollow", null],
      ["1 year", "/xrpl/account/A?tab=analytics&period=1y", "nofollow", null],
      ["All", "/xrpl/account/A?tab=analytics&period=all", "nofollow", null],
    ]);
  });

  it("marks the period of the view as the current one, on the network of the page", () => {
    render(filters({ period: "1y", network: XAHAU }).element);
    const links = within(screen.getByRole("group", { name: "Period" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/xahau/account/A?tab=analytics",
      "/xahau/account/A?tab=analytics&period=90d",
      "/xahau/account/A?tab=analytics&period=1y",
      "/xahau/account/A?tab=analytics&period=all",
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, null, "true", null]);
  });

  it("says what the values are in, in the network's native currency", () => {
    const { unmount } = render(filters().element);
    expect(screen.getByText("Values in XRP: tokens at each day's DEX rate, and 0 without one").className).toBe("analytics-filters__values");
    unmount();
    render(filters({ network: XAHAU }).element);
    expect(screen.getByText("Values in XAH: tokens at each day's DEX rate, and 0 without one")).toBeTruthy();
  });

  it("has one status, which says the view is loading until the frame settles, and then the period note, in the same element", async () => {
    let settle!: (frame: CardState<AnalyticsFrame>) => void;
    const frame = new Promise<CardState<AnalyticsFrame>>((resolve) => (settle = resolve));
    render(filters({ frame }).element);
    const status = screen.getByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status.textContent).toBe("Loading analytics…");
    expect(status.className).toBe("analytics-filters__note");

    await act(async () => settle({ state: "ok", ...FRAME }));
    expect(screen.getAllByRole("status")).toEqual([status]);
    expect(status.textContent).toBe(NOTE);
  });

  it("leaves the status empty for a frame that failed or came too late: the view's own error says so", async () => {
    for (const state of ["failed", "late"] as const) {
      const { unmount } = render(filters({ frame: Promise.resolve({ state }) }).element);
      await act(async () => {});
      const status = screen.getByRole("status");
      expect(status.textContent).toBe("");
      unmount();
    }
  });

  it("says it is loading while the frame has not come", () => {
    render(filters({ frame: pending() }).element);
    expect(screen.getByRole("status").textContent).toBe("Loading analytics…");
  });

  it("goes to another period in the browser without sending the window back to the top", async () => {
    const { router, element } = filters();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(element);
    await act(async () => void fireEvent.click(screen.getByRole("link", { name: "90 days" })));
    expect(router.state.location.pathname + router.state.location.search).toBe("/xrpl/account/A?tab=analytics&period=90d");
    expect(router.state.preventScrollReset).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("is the same on the server as in the browser, with the period note in the server's HTML once the frame has settled", async () => {
    const { element } = filters();
    await settle(element);
    const { html, container, errors } = await serverThenHydrated(element);
    expect(html).toContain(NOTE);
    expect(html).toContain('rel="nofollow"');
    expect(html).not.toContain("Loading analytics…");
    expect(within(container).getByRole("status").textContent).toBe(NOTE);
    expect(errors).toEqual([]);
  });

  it("prints 'Loading analytics…' in the status while the frame has not come", () => {
    // The stream's placeholder in the server's HTML, which the browser keeps until the frame streams in.
    const { element } = filters({ frame: pending() });
    const html = renderToString(element);
    expect(html).toMatch(/role="status"[^>]*>.*Loading analytics…/s);
  });
});
