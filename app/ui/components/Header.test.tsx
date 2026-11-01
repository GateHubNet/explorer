import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { allSwitches } from "../../../test/support/switches";
import { LAYOUT_XAHAU, LAYOUT_XRPL, renderUnderNetwork, underNetworkRouter } from "../../../test/support/under-network";
import { featuresOf, NO_FEATURES, type Features } from "../features";
import type { NetworkRouteHandle } from "../route-handle";
import { Header } from "./Header";

// The Network menu of the header (supply spec 2): a disclosure of four links where the Network link was. The whole navigation is in components.test.tsx ("Header and Shell"); this file
// is the menu.

afterEach(cleanup);

const ALL_ON = featuresOf(allSwitches("on"));
const withOff = (...names: Array<"validators" | "supply">): Features => ({ ...ALL_ON, ...Object.fromEntries(names.map((name) => [name, false])) });

/** The page of each path the way its route names it (the `handle` of the routes under app/routes). */
const HANDLES: Record<string, NetworkRouteHandle> = {
  "/xrpl/network": { navSection: "network", navPage: "overview" },
  "/xrpl/validators": { navSection: "network", navPage: "validators" },
  "/xrpl/validators/nHBidG3pZK11zQD6kpNDoAhDxH6WLGui6ZxSbUx7LSqLHsgzMPec": { navSection: "network", navPage: "validators" },
  "/xrpl/amendments": { navSection: "network", navPage: "amendments" },
  "/xrpl/amendments/AMM": { navSection: "network", navPage: "amendments" },
  "/xrpl/supply": { navSection: "network", navPage: "supply" },
};
const handleOf = (path: string) => HANDLES[path.split("?")[0]!]!;

async function menuAt(path = "/xrpl", { features = ALL_ON, handle, network = LAYOUT_XRPL }: { features?: Features; handle?: NetworkRouteHandle; network?: typeof LAYOUT_XRPL } = {}) {
  renderUnderNetwork(<Header net={network} />, features, { path, handle, network });
  const nav = within(await screen.findByRole("navigation", { name: "Main" }));
  const details = document.querySelector<HTMLDetailsElement>('details[data-menu="network"]')!;
  return { nav, details, summary: details.querySelector("summary")!, panel: within(details) };
}

/** The label of each top-level item of the navigation, in order: the summary's text, a link's text, or a "soon" item's label without its tag. */
function labelsOf() {
  const items = [...document.querySelectorAll('nav[aria-label="Main"] > ul > li')];
  return items.map((item) => (item.querySelector("summary.nav-item") ?? item.querySelector(".nav-item.is-soon > span:first-child") ?? item.querySelector("a.nav-item"))!.textContent);
}

describe("the Network menu", () => {
  it("lists Ledgers, Transactions, Tokens, Network, Markets, AMM, NFTs, Network a disclosure of four items", async () => {
    const { nav, details, summary, panel } = await menuAt();
    expect(labelsOf()).toEqual(["Ledgers", "Transactions", "Tokens", "Network", "Markets", "AMM", "NFTs"]);

    // The Network item is the `<details>` of the spec's markup, closed, with a summary that names it and a panel of four links.
    expect(nav.queryByRole("link", { name: "Network" })).toBeNull();
    expect(details.tagName).toBe("DETAILS");
    expect(details.className).toBe("menu");
    expect(details.open).toBe(false);
    expect(details.closest("li")!.parentElement!.closest("nav")!.getAttribute("aria-label")).toBe("Main");
    expect(summary.className).toContain("nav-item");
    expect(summary.className).toContain("menu__summary");
    expect(summary.textContent).toBe("Network");
    const chevron = summary.querySelector("svg")!;
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
    expect(chevron.getAttribute("width")).toBe("12");

    const panelList = details.querySelector("ul.menu__panel")!;
    expect(summary.nextElementSibling).toBe(panelList);
    const links = panel.getAllByRole("link", { hidden: true });
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Overview", "/xrpl/network"],
      ["Validators", "/xrpl/validators"],
      ["Amendments", "/xrpl/amendments"],
      ["Supply", "/xrpl/supply"],
    ]);
    for (const link of links) {
      expect(link.className).toBe("menu__item");
      expect(link.hasAttribute("aria-current")).toBe(false);
    }
    // The other items are as they were: links, no menu.
    expect(nav.getByRole("link", { name: "Tokens" }).getAttribute("href")).toBe("/xrpl/tokens");
    expect(nav.getByRole("link", { name: "NFTs" }).getAttribute("href")).toBe("/xrpl/nfts");
  });

  it("leads to the pages of the network the header is on", async () => {
    const { panel } = await menuAt("/xahau", { network: LAYOUT_XAHAU });
    expect(panel.getAllByRole("link", { hidden: true }).map((link) => link.getAttribute("href"))).toEqual(["/xahau/network", "/xahau/validators", "/xahau/amendments", "/xahau/supply"]);
  });

  it("is in the server's HTML, closed, with its four links: it works before the page is live", () => {
    const router = underNetworkRouter(<Header net={LAYOUT_XRPL} />, ALL_ON, { path: "/xrpl", hydrated: true });
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain('<details class="menu" data-menu="network"><summary class="nav-item menu__summary">Network<svg');
    expect(html).not.toMatch(/<details[^>]* open/);
    for (const href of ["/xrpl/network", "/xrpl/validators", "/xrpl/amendments", "/xrpl/supply"]) expect(html).toContain(`<a class="menu__item" href="${href}" data-discover="true">`);
  });

  it("opens with the summary and keeps the links in the page (not in a role=menu)", async () => {
    const { details, summary } = await menuAt();
    expect(details.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it.each([
    ["VALIDATORS", ["Validators", "Amendments"]],
    ["SUPPLY", ["Supply"]],
  ] as const)("with %s off, %s read soon and are no links", async (name, soon) => {
    const features = featuresOf({ ...allSwitches("on"), [name]: "off" });
    const { details, panel } = await menuAt("/xrpl", { features });
    const items = [...details.querySelectorAll(".menu__item")];
    expect(items.map((item) => item.firstChild!.textContent!.trim())).toEqual(["Overview", "Validators", "Amendments", "Supply"]);
    for (const item of items) {
      const label = item.firstChild!.textContent!.trim();
      if (soon.includes(label as never)) {
        expect(item.tagName, label).toBe("SPAN");
        expect(item.className, label).toBe("menu__item is-soon");
        expect(item.getAttribute("aria-disabled"), label).toBe("true");
        expect(item.querySelector(".soon")!.textContent, label).toBe("soon");
        expect(item.hasAttribute("href"), label).toBe(false);
        expect(panel.queryByRole("link", { name: new RegExp(`^${label}`), hidden: true }), label).toBeNull();
      } else {
        expect(item.tagName, label).toBe("A");
        expect(item.hasAttribute("aria-disabled"), label).toBe(false);
        expect(item.textContent, label).not.toContain("soon");
      }
    }
  });

  it("never reads Overview as soon, whatever the switches are", async () => {
    const { details, panel } = await menuAt("/xrpl", { features: NO_FEATURES });
    expect(panel.getByRole("link", { name: "Overview", hidden: true }).getAttribute("href")).toBe("/xrpl/network");
    expect(details.querySelectorAll(".menu__item.is-soon")).toHaveLength(3);
    expect(details.querySelector("summary")!.textContent).toBe("Network");
  });

  it.each([
    ["/xrpl/network", "Overview", "page"],
    ["/xrpl/validators?scope=all", "Validators", "page"],
    ["/xrpl/validators/nHBidG3pZK11zQD6kpNDoAhDxH6WLGui6ZxSbUx7LSqLHsgzMPec", "Validators", "true"],
    ["/xrpl/amendments", "Amendments", "page"],
    ["/xrpl/amendments/AMM", "Amendments", "true"],
    ["/xrpl/supply", "Supply", "page"],
  ] as const)("on %s, %s is aria-current=%s and the summary is current", async (path, label, value) => {
    const { details, summary } = await menuAt(path, { handle: handleOf(path) });
    for (const item of details.querySelectorAll<HTMLElement>(".menu__item")) {
      const mine = item.firstChild!.textContent!.trim() === label;
      expect(item.getAttribute("aria-current"), item.textContent!).toBe(mine ? value : null);
    }
    expect(summary.getAttribute("aria-current")).toBe("true");
    expect(summary.classList.contains("is-current")).toBe(true);
  });

  it("marks no item by the path alone: a route has to name its page", async () => {
    const { details, summary } = await menuAt("/xrpl/supply", { handle: { navSection: "network" } });
    expect(details.querySelectorAll("[aria-current]")).toHaveLength(1);
    expect(summary.getAttribute("aria-current")).toBe("true");
  });

  it("on a page of another section nothing in the menu is current", async () => {
    for (const [path, handle] of [
      ["/xrpl/markets", { navSection: "markets" }],
      ["/xrpl/nfts", { navSection: "nfts" }],
      ["/xrpl/ledger/1", undefined],
      ["/xrpl/supply", undefined],
    ] as const) {
      const { details, summary } = await menuAt(path, { handle });
      expect(details.querySelectorAll("[aria-current]"), path).toHaveLength(0);
      expect(summary.hasAttribute("aria-current"), path).toBe(false);
      expect(summary.classList.contains("is-current"), path).toBe(false);
      expect(details.querySelector(".is-current"), path).toBeNull();
      cleanup();
    }
  });

  it("marks the summary on the pages of the section whose item is soon, and no item", async () => {
    const { details, summary } = await menuAt("/xrpl/supply", { features: withOff("supply"), handle: handleOf("/xrpl/supply") });
    expect(summary.getAttribute("aria-current")).toBe("true");
    expect(details.querySelectorAll(".menu__item[aria-current]")).toHaveLength(0);
    expect(details.querySelector(".menu__item.is-soon")!.textContent).toBe("Supply soon");
  });
});
