import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { SegmentedLinks, type SegmentLink } from "./SegmentedLinks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PERIOD: SegmentLink[] = [
  { label: "7 days", href: "/xrpl/network?period=7d", current: false },
  { label: "30 days", href: "/xrpl/network", current: true },
  { label: "90 days", href: "/xrpl/network?period=90d", current: false },
  { label: "1 year", href: "/xrpl/network?period=1y", current: false },
];

function routed(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl/network"] });
  return { router, element: <RouterProvider router={router} /> };
}

describe("SegmentedLinks", () => {
  it("shows its label, and the label names the group of links", () => {
    render(routed(<SegmentedLinks label="Period" links={PERIOD} />).element);
    expect(screen.getByText("Period").className).toBe("seglinks__label");
    const group = screen.getByRole("group", { name: "Period" });
    expect(group.className).toBe("netswitch");
    expect(group.closest(".seglinks")).not.toBeNull();
    // The name is the visible label itself, by reference: not a copy that could drift from it.
    expect(group.getAttribute("aria-labelledby")).toBe(screen.getByText("Period").id);
    expect(within(group).getAllByRole("link")).toHaveLength(4);
  });

  it("gives two groups on one page names of their own", () => {
    render(
      routed(
        <>
          <SegmentedLinks label="Period" links={PERIOD} />
          <SegmentedLinks label="Amounts in" links={[{ label: "XRP", href: "/xrpl/network", current: true }, { label: "USD", href: "/xrpl/network?in=usd", current: false }]} />
        </>,
      ).element,
    );
    expect(within(screen.getByRole("group", { name: "Period" })).getAllByRole("link")).toHaveLength(4);
    expect(within(screen.getByRole("group", { name: "Amounts in" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["XRP", "USD"]);
  });

  it("has a link for each segment, in order, to its href, each a segment of the network switch's look", () => {
    render(routed(<SegmentedLinks label="Period" links={PERIOD} />).element);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["7 days", "/xrpl/network?period=7d"],
      ["30 days", "/xrpl/network"],
      ["90 days", "/xrpl/network?period=90d"],
      ["1 year", "/xrpl/network?period=1y"],
    ]);
    expect(links.every((link) => link.classList.contains("netswitch__item"))).toBe(true);
  });

  it("marks the current segment with aria-current=true and no other has the attribute", () => {
    render(routed(<SegmentedLinks label="Period" links={PERIOD} />).element);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, "true", null, null]);
    expect(links.map((link) => link.hasAttribute("aria-current"))).toEqual([false, true, false, false]);
  });

  it("navigates without sending the window back to the top", async () => {
    const { router, element } = routed(<SegmentedLinks label="Period" links={PERIOD} />);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(element);
    await act(async () => void fireEvent.click(screen.getByRole("link", { name: "1 year" })));
    expect(router.state.location.pathname + router.state.location.search).toBe("/xrpl/network?period=1y");
    // The link says it, and the router keeps the position (`preventScrollReset` is the navigation's state).
    expect(router.state.preventScrollReset).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("gives a link the rel it is given, and none to a link without one", () => {
    const links: SegmentLink[] = [
      { label: "30 days", href: "/xrpl/account/A?tab=analytics", current: true, rel: "nofollow" },
      { label: "90 days", href: "/xrpl/account/A?tab=analytics&period=90d", current: false, rel: "nofollow" },
      { label: "1 year", href: "/xrpl/account/A?tab=analytics&period=1y", current: false },
    ];
    render(routed(<SegmentedLinks label="Period" links={links} />).element);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("rel"))).toEqual(["nofollow", "nofollow", null]);
  });

  it("keeps its label for screen readers only with hideLabel: the group is named by it as before, and there is no other group", () => {
    const { container } = render(routed(<SegmentedLinks label="Candle interval" hideLabel links={PERIOD} />).element);
    const label = screen.getByText("Candle interval");
    // Out of sight (base.css `.sr`) but in the page, so the name the group has by reference is still its own words.
    expect(label.className).toBe("seglinks__label sr");
    const group = screen.getByRole("group", { name: "Candle interval" });
    expect(group.getAttribute("aria-labelledby")).toBe(label.id);
    expect(group.className).toBe("netswitch");
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(within(group).getAllByRole("link")).toHaveLength(4);
  });

  it("shows its label without hideLabel, and with hideLabel={false}", () => {
    render(routed(<SegmentedLinks label="Period" hideLabel={false} links={PERIOD} />).element);
    expect(screen.getByText("Period").className).toBe("seglinks__label");
  });

  it("is the same on the server as in the browser", async () => {
    const { html, container, errors } = await serverThenHydrated(routed(<SegmentedLinks label="Period" links={PERIOD} />).element);
    expect(html).toContain('class="seglinks__label"');
    expect(html).toMatch(/aria-current="true"/);
    expect(within(container).getByRole("group", { name: "Period" })).toBeTruthy();
    expect(errors).toEqual([]);
  });
});
