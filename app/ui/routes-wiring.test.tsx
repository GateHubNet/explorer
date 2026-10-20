import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData, useParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { networkHref, parseNetworkParams, queryOf, type NetworkParams } from "../domain/network-params";
import { forwardCacheClass } from "../server/edge-cache";
import type { HomeLoaderData } from "../server/home-view";
import type { AmmPart, NetworkLoaderData, SeriesView } from "../server/network-view";
import type { LivePairData, OlderPairData, PairPageData } from "../server/pair-view";
import type { BarListData, CandleData, TimeSeriesData } from "./charts/types";
import * as home from "../routes/net._index";
import * as net from "../routes/net";
import * as pair from "../routes/net.markets.$base.$counter";
import * as network from "../routes/net.network";

// The real route modules, not stand-ins: `net.tsx` and `net._index.tsx` as React Router's own build would load them. What these tests pin is
// the wiring that no other test can see because it lives between files: the layout that must not revalidate, the home route's `clientLoader`
// that keeps the page, the page's shared `onScreen`, the hook that polls and the controls (pause, hold, status). Deleting `shouldRevalidate`
// from net.tsx or `clientLoader` from net._index.tsx fails here (and in the browser, test/e2e/live-home.spec.ts). The network page's route,
// `net.network.tsx`, is wired the same way and is run the same way after them: its scope per view, its merge (`keepLoaded`) and the page keyed
// by its scope. The market pair page's, `net.markets.$base.$counter.tsx`, is last: the same wiring, and no live hook behind a marker.

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP", ctidNetworkId: 0, other: "xahau" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH", ctidNetworkId: 21337, other: "xrpl" } as const;

const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";

/** The home page's data at ledger `index`, made by build `build`. */
const dataAt = (index: number, build = "abc1234"): HomeLoaderData => ({
  build,
  latest: { index, hash: "AB".repeat(32), closeTime: 1792256472 + index, supply: "99985312446.118204" },
  txCount: 84,
  average: { transactions: 78, ledgers: 2 },
  fees: { total: "0.001284", average: "0.000015", max: "0.00012" },
  ledgers: [
    { index, txCount: 84, closeTime: 1792256472 + index },
    { index: index - 1, txCount: 1200, closeTime: 1792256468 + index },
  ],
  transactions: [
    { type: "Payment", hash: String(index).padStart(64, "0"), account: ALICE, amount: null, ok: true, code: "tesSUCCESS", date: 1792256472 + index },
  ],
  examples: [{ kind: "Ledger", label: String(index), title: String(index), href: `/xrpl/ledger/${index}` }],
});

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
  sessionStorage.clear();
});

const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** React Router passes a route's component its data and params as props (framework mode); a data router does not. */
function HomeRoute() {
  return createElement(home.default, { loaderData: useLoaderData() as HomeLoaderData, params: useParams() as { net: string }, actionData: undefined, matches: [] } as never);
}

/**
 * The two real routes in a data router: the layout as `net.tsx` has it (its loader data, its `shouldRevalidate`), the page with its `loader`
 * being the real `clientLoader` over a `serverLoader` the test gives. Starts on the data the server rendered, as a hydrated page does.
 */
function mountHome(serverLoader: () => Promise<HomeLoaderData>, first = dataAt(100), network: typeof XRPL | typeof XAHAU = XRPL) {
  const layoutRuns = { count: 0 };
  const router = createMemoryRouter(
    [
      {
        id: "routes/net",
        path: "/:net",
        loader: ({ params }) => ({ network: params.net === "xahau" ? XAHAU : XRPL, origin: "https://explorer.test", run: ++layoutRuns.count }),
        shouldRevalidate: net.shouldRevalidate,
        Component: Outlet,
        children: [
          {
            id: "routes/net._index",
            index: true,
            loader: (args) => home.clientLoader({ params: args.params, request: args.request, serverLoader } as never),
            Component: HomeRoute,
          },
        ],
      },
    ],
    {
      initialEntries: [`/${network.id}`],
      hydrationData: { loaderData: { "routes/net": { network, origin: "https://explorer.test", run: 0 }, "routes/net._index": first } },
    },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, layoutRuns, ...view };
}

const ledgerTile = () => screen.getByText("Latest validated ledger").closest(".stat")!.querySelector(".stat__value")!.textContent;

describe("net.tsx", () => {
  const args = (over: Partial<ShouldRevalidateFunctionArgs>) =>
    ({ currentParams: { net: "xrpl" }, nextParams: { net: "xrpl" }, defaultShouldRevalidate: true, ...over }) as ShouldRevalidateFunctionArgs;

  it("does not revalidate while its parameters stay, which is what a revalidation of the home page is", () => {
    expect(net.shouldRevalidate).toBeTypeOf("function");
    expect(net.shouldRevalidate!(args({}))).toBe(false);
  });

  it("revalidates when the network changes, and never when React Router already said no", () => {
    expect(net.shouldRevalidate!(args({ nextParams: { net: "xahau" } }))).toBe(true);
    expect(net.shouldRevalidate!(args({ nextParams: { net: "xahau" }, defaultShouldRevalidate: false }))).toBe(false);
  });
});

describe("net._index.tsx", () => {
  it("has a clientLoader, and the page it loads is the page with the hook that polls it", () => {
    expect(home.clientLoader).toBeTypeOf("function");
    expect(home.default).toBeTypeOf("function");
    expect(home.headers).toBeTypeOf("function");
  });

  it("asks the server's loader again every 4 s, shows what it answers, and does not ask for the layout again", async () => {
    let at = 100;
    const serverLoader = vi.fn(async () => dataAt(++at));
    const { layoutRuns } = mountHome(serverLoader);
    expect(ledgerTile()).toBe("#100");
    await pass(3999);
    expect(serverLoader).not.toHaveBeenCalled();
    await pass(1);
    expect(serverLoader).toHaveBeenCalledTimes(1);
    expect(ledgerTile()).toBe("#101");
    await pass(4000);
    expect(ledgerTile()).toBe("#102");
    expect(layoutRuns.count).toBe(0);
  });

  it("keeps the page when the server's loader fails, slows down, says so after two failures, and says when it works again", async () => {
    let failing = true;
    let at = 100;
    const serverLoader = vi.fn(async () => {
      if (failing) throw new Error("503");
      return dataAt(++at);
    });
    mountHome(serverLoader);

    await pass(4000); // the first failure: the next try is in 8 s
    expect(serverLoader).toHaveBeenCalledTimes(1);
    expect(ledgerTile()).toBe("#100");
    expect(screen.getByRole("status").textContent).toBe("");
    await pass(7999);
    expect(serverLoader).toHaveBeenCalledTimes(1);
    await pass(1); // the second: the next in 16 s
    expect(serverLoader).toHaveBeenCalledTimes(2);
    expect(ledgerTile()).toBe("#100");
    expect(screen.getByRole("status").textContent).toBe("Live updates paused, retrying…");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Explore the XRP Ledger");

    failing = false;
    await pass(15_999);
    expect(serverLoader).toHaveBeenCalledTimes(2);
    await pass(1);
    expect(serverLoader).toHaveBeenCalledTimes(3);
    expect(ledgerTile()).toBe("#101");
    expect(screen.getByRole("status").textContent).toBe("Live updates reconnected");
    // Back to 4 s.
    await pass(4000);
    expect(serverLoader).toHaveBeenCalledTimes(4);
  });

  it("gives a refresh that hangs up after 10 s, keeps the page, and goes on with the next beat", async () => {
    let calls = 0;
    const serverLoader = vi.fn(() => (++calls === 1 ? new Promise<HomeLoaderData>(() => {}) : Promise.resolve(dataAt(200))));
    mountHome(serverLoader);
    await pass(4000);
    expect(serverLoader).toHaveBeenCalledTimes(1);
    await pass(9999);
    expect(serverLoader).toHaveBeenCalledTimes(1);
    expect(ledgerTile()).toBe("#100");
    // Given up at 10 s (that is a failure: the next beat is 8 s later).
    await pass(1);
    await pass(7999);
    expect(serverLoader).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(serverLoader).toHaveBeenCalledTimes(2);
    expect(ledgerTile()).toBe("#200");
  });

  it("keeps the page when the answer is older than the ledger it shows", async () => {
    const serverLoader = vi.fn(async () => dataAt(90));
    mountHome(serverLoader, dataAt(100));
    await pass(4000);
    expect(serverLoader).toHaveBeenCalledTimes(1);
    expect(ledgerTile()).toBe("#100");
  });

  it("reloads the document, once, when the answer is of another build, and keeps the page until it does", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const serverLoader = vi.fn(async () => dataAt(101, "def5678"));
    mountHome(serverLoader, dataAt(100, "abc1234"));
    await pass(4000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(ledgerTile()).toBe("#100");
    await pass(8000);
    expect(serverLoader).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe("its clientLoader, with the page on screen", () => {
    it("hands back what the page shows when the server's loader fails, and lets a redirect through", async () => {
      const serverLoader = vi.fn(async () => dataAt(101));
      mountHome(serverLoader, dataAt(100));
      const shown = dataAt(100);
      const failing = (error: unknown) => home.clientLoader({ params: { net: "xrpl" }, serverLoader: () => Promise.reject(error) } as never);

      expect(await failing(new Error("503"))).toMatchObject({ latest: { index: shown.latest.index } });
      const redirect = new Response(null, { status: 302, headers: { Location: "/xahau" } });
      await expect(failing(redirect)).rejects.toBe(redirect);
    });

    it("compares nothing with another network's page: switching to Xahau is a navigation, whose ledger is not 'older', and a failure there is the error screen", async () => {
      mountHome(vi.fn(async () => dataAt(101)), dataAt(107_000_000), XRPL);
      const xahau = dataAt(26_000_000);
      expect(await home.clientLoader({ params: { net: "xahau" }, serverLoader: async () => xahau } as never)).toBe(xahau);
      await expect(home.clientLoader({ params: { net: "xahau" }, serverLoader: () => Promise.reject(new Error("503")) } as never)).rejects.toThrow("503");
    });

    it("has nothing to hand back once the page has left: the error screen is for the navigation that comes next", async () => {
      const { unmount } = mountHome(vi.fn(async () => dataAt(101)));
      unmount();
      await expect(home.clientLoader({ params: { net: "xrpl" }, serverLoader: () => Promise.reject(new Error("503")) } as never)).rejects.toThrow("503");
    });
  });

  describe("pausing", () => {
    const status = () => screen.getByRole("status").textContent;

    it("stops the polling with the button, says so once, remembers the choice in the tab, and asks at once when it is resumed", async () => {
      const serverLoader = vi.fn(async () => dataAt(101));
      mountHome(serverLoader);
      expect(status()).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Pause live updates" }));
      const resume = screen.getByRole("button", { name: "Resume live updates" });
      // The label says what the button will do; it is not also a pressed toggle.
      expect(resume.hasAttribute("aria-pressed")).toBe(false);
      expect(resume.classList.contains("is-paused")).toBe(true);
      // What the visitor did is said once, by the element that is a status, and then it is quiet again.
      expect(status()).toBe("Live updates paused");
      expect(sessionStorage.getItem("explorer:live-paused")).toBe("1");
      await pass(60_000);
      expect(serverLoader).not.toHaveBeenCalled();
      expect(status()).toBe("");

      fireEvent.click(screen.getByRole("button", { name: "Resume live updates" }));
      expect(status()).toBe("Live updates resumed");
      await pass(0);
      expect(serverLoader).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("explorer:live-paused")).toBeNull();
      await pass(4000);
      expect(status()).not.toBe("Live updates resumed");
    });

    it("starts paused in a tab that was paused, without announcing it, and works where storage does not", async () => {
      sessionStorage.setItem("explorer:live-paused", "1");
      const serverLoader = vi.fn(async () => dataAt(101));
      mountHome(serverLoader);
      expect(screen.getByRole("button", { name: "Resume live updates" })).toBeTruthy();
      expect(status()).toBe("");
      await pass(30_000);
      expect(serverLoader).not.toHaveBeenCalled();

      cleanup();
      const blocked = () => {
        throw new Error("blocked");
      };
      vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
      const again = vi.fn(async () => dataAt(101));
      mountHome(again);
      fireEvent.click(screen.getByRole("button", { name: "Pause live updates" }));
      expect(screen.getByRole("button", { name: "Resume live updates" })).toBeTruthy();
      await pass(30_000);
      expect(again).not.toHaveBeenCalled();
    });
  });

  describe("holding", () => {
    const table = () => screen.getByRole("region", { name: "Latest transactions, scrollable table" });
    const HELD = "Paused while you look at the table";

    it("does not ask while a mouse is over a table or a link in one has focus, says so, and goes on with its beat when the mouse leaves", async () => {
      const serverLoader = vi.fn(async () => dataAt(101));
      mountHome(serverLoader);
      expect(screen.queryByText(HELD)).toBeNull();
      fireEvent.pointerEnter(table(), { pointerType: "mouse" });
      expect(screen.getByText(HELD)).toBeTruthy();
      await pass(20_000);
      expect(serverLoader).not.toHaveBeenCalled();
      fireEvent.pointerLeave(table(), { pointerType: "mouse" });
      expect(screen.queryByText(HELD)).toBeNull();
      await pass(4000);
      expect(serverLoader).toHaveBeenCalledTimes(1);

      const link = within(table()).getAllByRole("link")[0]!;
      act(() => link.focus());
      expect(screen.getByText(HELD)).toBeTruthy();
      await pass(20_000);
      expect(serverLoader).toHaveBeenCalledTimes(1);
      act(() => link.blur());
      await pass(4000);
      expect(serverLoader).toHaveBeenCalledTimes(2);
    });

    it("is not stuck by a click that focused the scroll region: that is not keyboard focus, so the page goes on when the mouse has left", async () => {
      const serverLoader = vi.fn(async () => dataAt(101));
      mountHome(serverLoader);
      const matches = HTMLElement.prototype.matches;
      vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, selector: string) {
        return selector === ":focus-visible" ? false : matches.call(this, selector);
      });
      fireEvent.pointerEnter(table(), { pointerType: "mouse" });
      act(() => table().focus());
      fireEvent.pointerLeave(table(), { pointerType: "mouse" });
      // The scroll region still has focus (the visitor clicked in it), and nothing holds the page.
      expect(document.activeElement).toBe(table());
      expect(screen.queryByText(HELD)).toBeNull();
      await pass(4000);
      expect(serverLoader).toHaveBeenCalledTimes(1);
    });

    it("is held by the keyboard's focus on the scroll region, which is how a keyboard scrolls the table", async () => {
      const serverLoader = vi.fn(async () => dataAt(101));
      mountHome(serverLoader);
      act(() => table().focus());
      expect(screen.getByText(HELD)).toBeTruthy();
      await pass(20_000);
      expect(serverLoader).not.toHaveBeenCalled();
    });

    it("is let go when the page is replaced by the other network's: the hold of the one that left does not stay on the one that came", async () => {
      const serverLoader = vi.fn(async () => dataAt(26_000_000));
      const { router } = mountHome(serverLoader);
      fireEvent.pointerEnter(table(), { pointerType: "mouse" });
      expect(screen.getByText(HELD)).toBeTruthy();

      await act(async () => void router.navigate("/xahau"));
      await pass(0);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Explore Xahau");
      expect(screen.queryByText(HELD)).toBeNull();
      serverLoader.mockClear();
      await pass(4000);
      expect(serverLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe("a deploy while the visitor types", () => {
    const search = () => document.querySelector<HTMLInputElement>('input[name="q"]')!;

    it("does not reload the document while the search box has focus or holds text, and does when it is empty and blurred", async () => {
      const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
      mountHome(vi.fn(async () => dataAt(101, "def5678")), dataAt(100, "abc1234"));
      act(() => search().focus());
      fireEvent.input(search(), { target: { value: "rJF2Xan" } });
      await pass(40_000);
      expect(reload).not.toHaveBeenCalled();

      // Blurred but not empty: still not.
      act(() => search().blur());
      await pass(10_000);
      expect(reload).not.toHaveBeenCalled();

      fireEvent.input(search(), { target: { value: "" } });
      await pass(0);
      expect(reload).toHaveBeenCalledTimes(1);
      await pass(60_000);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});


// ---- The network page's route ---------------------------------------------------------------------------------------------------------

const NETWORK_BUCKETS = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const NETWORK_AXIS = { unit: "day", buckets: NETWORK_BUCKETS } as const;
const VOLUME = (values: (string | null)[]): SeriesView => ({ buckets: NETWORK_BUCKETS, unit: "day", values, pending: 1, forming: true, token: `series:${values.join(",")}` });
const NETWORK_TYPES: TimeSeriesData = {
  axis: NETWORK_AXIS,
  series: [
    { id: "payment", label: "Payment", slot: 1, values: ["1000", "1200", "1100", "1500", "1400", "1600", "700"] },
    { id: "other", label: "Other", slot: "other", values: ["100", "100", "100", "100", "100", "100", "50"] },
  ],
  format: { kind: "count", unit: "transactions" },
  totals: ["1100", "1300", "1200", "1600", "1500", "1700", "750"],
  forming: true,
  pending: 0,
  token: "types",
};
const NETWORK_FEES: TimeSeriesData = {
  axis: NETWORK_AXIS,
  series: [{ id: "fee", label: "Average fee", slot: 1, values: ["12", "13", "12", "40", "14", "12", "11"] }],
  format: { kind: "drops", unit: "drops" },
  forming: true,
  pending: 0,
  token: "fees",
};
const NETWORK_CURRENCIES: BarListData = {
  items: [{ id: "XRP", label: "XRP", value: "230000000", share: "100%", count: "12000" }],
  format: { kind: "amount", unit: "XRP" },
  token: "by-currency",
};
const AMM_SHOWN: AmmPart = { state: "ok", series: VOLUME(["1000000", "1100000", "900000", "1200000", "1100000", "1300000", null]), total: "1200000000" };
const AMM_UNAVAILABLE = { state: "failed", reason: "could not be loaded" } as const;

/** The network page's data at ledger `index` for `view`, every part loaded, made by build `build`. */
function networkAt(index: number, over: Partial<NetworkLoaderData> = {}, build = "abc1234"): NetworkLoaderData {
  const view: NetworkParams = over.view ?? { period: "30d", display: "native" };
  return {
    build,
    anchor: { lastValidated: index, closeTime: 1792256472 + index },
    view,
    displays: ["native", "usd"],
    currency: "XRP",
    window: { unit: "day", note: "Totals and charts cover the 7 days from Oct 11 to Oct 17, 2026 (UTC), today so far" },
    strip: [0, 1, 2].map((n) => ({ index: index - n, txCount: 84 - n, closeTime: 1792256472 + index - 4 * n })),
    openLedger: { state: "ok", fee: "10", minimum: "10", queue: "0", openSize: "84", expected: "96", asOf: "17:01:10" },
    validators: {
      state: "ok",
      ledger: { index, hash: "AB".repeat(32) },
      count: "35",
      first: [{ key: "nHUFE9prPXPrHcG3SkwP1UzAQbSphqyQkQK9ATXLZsfkezhhda3p", short: "nHUFE9prPX…a3p", delay: "+0 ms" }],
      href: null,
    },
    types: { state: "ok", chart: NETWORK_TYPES, note: "Other is every other type." },
    metrics: {
      state: "ok",
      transactions: { value: "14.9K", delta: null, sub: null },
      interval: { value: "3.91 s", delta: null, sub: "average time between ledgers" },
      perLedger: { value: "84.2", delta: null, sub: null },
      accountsCreated: { value: "1.2K", delta: null, sub: null },
    },
    fees: { state: "ok", chart: NETWORK_FEES },
    payments: {
      state: "ok",
      series: VOLUME(["40000000", "41000000", "39000000", "45000000", "44000000", "46000000", null]),
      figure: { value: "255M XRP", delta: null, sub: "to Oct 16; Oct 17 not computed yet" },
      byCurrency: NETWORK_CURRENCIES,
      currencies: "Payments in the currencies the data API tracks: XRP.",
    },
    exchanges: { state: "ok", series: VOLUME(["8000000", "9000000", "7000000", "9500000", "9100000", "9900000", null]), total: "53500000", pendingWords: null },
    amm: AMM_SHOWN,
    ...over,
  };
}

describe("net.network.tsx", () => {
  /** The newest chip of the strip: the ledger the page is at. */
  const newestChip = () => document.querySelector(".network__chips .chip__index")?.textContent;
  /** The lines the volume card draws, by its legend. */
  const volumeLegend = () =>
    Array.from(screen.getByRole("heading", { level: 2, name: /^Volume per/ }).closest("section")!.querySelectorAll(".legend__item")).map((item) => item.textContent);
  const REQUEST = (path: string) => new Request(`https://explorer.test${path}`);

  /** The data a `.data` request for `url` is answered with. */
  type Answer = (url: URL) => Promise<NetworkLoaderData>;

  function NetworkRoute() {
    return createElement(network.default, { loaderData: useLoaderData() as NetworkLoaderData, params: useParams() as { net: string }, actionData: undefined, matches: [] } as never);
  }

  /** The layout as `net.tsx` has it and the network page as `net.network.tsx` has it, in a data router, on the data the server rendered. */
  function mountNetwork(answer: Answer, first = networkAt(100), path = "/xrpl/network") {
    const layoutRuns = { count: 0 };
    const router = createMemoryRouter(
      [
        {
          id: "routes/net",
          path: "/:net",
          loader: ({ params }) => ({ network: params.net === "xahau" ? XAHAU : XRPL, origin: "https://explorer.test", run: ++layoutRuns.count }),
          shouldRevalidate: net.shouldRevalidate,
          Component: Outlet,
          children: [
            {
              id: "routes/net.network",
              path: "network",
              loader: (args) =>
                network.clientLoader({ params: args.params, request: args.request, serverLoader: () => answer(new URL(args.request.url)) } as never),
              Component: NetworkRoute,
            },
          ],
        },
      ],
      {
        initialEntries: [path],
        hydrationData: { loaderData: { "routes/net": { network: XRPL, origin: "https://explorer.test", run: 0 }, "routes/net.network": first } },
      },
    );
    const view = render(<RouterProvider router={router} />);
    return { router, layoutRuns, ...view };
  }

  it("has a clientLoader, a handle that names the header's section, and the headers that forward the class", () => {
    expect(network.clientLoader).toBeTypeOf("function");
    expect(network.default).toBeTypeOf("function");
    expect(network.headers).toBe(forwardCacheClass);
    expect(network.handle).toEqual({ navSection: "network" });
  });

  it("asks the server's loader again every 4 s, shows what it answers, and does not ask for the layout again", async () => {
    let at = 100;
    const answer = vi.fn<Answer>(async () => networkAt(++at));
    const { layoutRuns } = mountNetwork(answer);
    expect(newestChip()).toBe("#100");
    await pass(3999);
    expect(answer).not.toHaveBeenCalled();
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(newestChip()).toBe("#101");
    await pass(4000);
    expect(newestChip()).toBe("#102");
    expect(layoutRuns.count).toBe(0);
  });

  describe("its clientLoader", () => {
    const rejecting = (error: unknown) => () => Promise.reject(error);
    const reload = (path: string, serverLoader: () => Promise<NetworkLoaderData>) =>
      network.clientLoader({ params: { net: "xrpl" }, request: REQUEST(path), serverLoader } as never);

    it("reloads through the scope of the view on screen: the network and the canonical search, `xrpl?period=1y` for the year", async () => {
      mountNetwork(async () => networkAt(101), networkAt(100, { view: { period: "1y", display: "native" } }), "/xrpl/network?period=1y");
      // The page of that scope is on screen, so the data it shows is what a failed load hands back...
      expect(await reload("/xrpl/network?period=1y", rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      // ...whatever the text of the query is, when it names the same view...
      expect(await reload("/xrpl/network?x=1&period=1y&period=7d", rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      // ...and for no other view of the page: another period, the other currency, the other network.
      await expect(reload("/xrpl/network", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload("/xrpl/network?period=7d", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload("/xrpl/network?period=1y&in=usd", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(
        network.clientLoader({ params: { net: "xahau" }, request: REQUEST("/xahau/network?period=1y"), serverLoader: rejecting(new Error("503")) } as never),
      ).rejects.toThrow("503");
    });

    it("compares nothing with another view's page: a view that is behind in the chain is not 'older'", async () => {
      mountNetwork(async () => networkAt(101), networkAt(107_000_000), "/xrpl/network");
      const other = networkAt(99, { view: { period: "7d", display: "native" } });
      expect(await reload("/xrpl/network?period=7d", async () => other)).toBe(other);
    });

    it("lets a redirect through, and leaves a network that does not exist to the layout's 404", async () => {
      mountNetwork(async () => networkAt(101));
      const redirect = new Response(null, { status: 302, headers: { Location: "/xrpl/network" } });
      await expect(reload("/xrpl/network?x=1", rejecting(redirect))).rejects.toBe(redirect);
      // `in=usd` names no display of a network that is none: nothing to look up, and nothing to throw but the server's answer.
      const notFound = new Response(null, { status: 404 });
      await expect(network.clientLoader({ params: { net: "bitcoin" }, request: REQUEST("/bitcoin/network?in=usd"), serverLoader: rejecting(notFound) } as never)).rejects.toBe(notFound);
    });

    it("has nothing to hand back once the page has left: the error screen is for the navigation that comes next", async () => {
      const { unmount } = mountNetwork(async () => networkAt(101));
      unmount();
      await expect(reload("/xrpl/network", rejecting(new Error("503")))).rejects.toThrow("503");
    });
  });

  it("keeps the page when a refresh is answered 503, slows down, and says so after two failures", async () => {
    let failing = true;
    const answer = vi.fn<Answer>(async () => {
      if (failing) throw new Response("unavailable", { status: 503 });
      return networkAt(101);
    });
    mountNetwork(answer);
    await pass(4000); // the first failure: the next try is in 8 s
    expect(answer).toHaveBeenCalledTimes(1);
    expect(newestChip()).toBe("#100");
    expect(screen.getByRole("status").textContent).toBe("");
    await pass(8000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(newestChip()).toBe("#100");
    expect(screen.getByRole("status").textContent).toBe("Live updates paused, retrying…");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("XRPL network");

    failing = false;
    await pass(16_000);
    expect(newestChip()).toBe("#101");
    expect(screen.getByRole("status").textContent).toBe("Live updates reconnected");
  });

  it("keeps the AMM line when an answer has the AMM part failed while the page shows it loaded, and takes the rest of the answer", async () => {
    mountNetwork(async () => networkAt(101, { amm: AMM_UNAVAILABLE }));
    expect(volumeLegend()).toContain("AMM swaps, all pools");
    await pass(4000);
    // The answer was taken (the strip moved on), and its failed AMM part was not: no error in the card, the line is still there.
    expect(newestChip()).toBe("#101");
    expect(screen.queryByText("AMM swaps couldn’t be loaded.")).toBeNull();
    expect(volumeLegend()).toContain("AMM swaps, all pools");
  });

  it("shows the error of a part that was never loaded, and keeps a part that other parts' failures do not touch", async () => {
    // The page opens with its AMM part failed: there is nothing loaded to keep, so the card says so, with a Retry.
    mountNetwork(async () => networkAt(101, { amm: AMM_UNAVAILABLE }), networkAt(100, { amm: AMM_UNAVAILABLE }));
    expect(screen.getByText("AMM swaps couldn’t be loaded.")).toBeTruthy();
    expect(volumeLegend()).not.toContain("AMM swaps, all pools");
    await pass(4000);
    expect(newestChip()).toBe("#101");
    expect(screen.getByText("AMM swaps couldn’t be loaded.")).toBeTruthy();
    expect(volumeLegend()).not.toContain("AMM swaps, all pools");
  });

  it("refuses an answer with a lower last validated ledger than the page's, and counts it as a failure", async () => {
    const answer = vi.fn<Answer>(async () => networkAt(90));
    mountNetwork(answer, networkAt(100));
    await pass(4000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(newestChip()).toBe("#100");
    // A failure slows the next beat down to 8 s.
    await pass(7999);
    expect(answer).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(newestChip()).toBe("#100");
  });

  it("reloads the document, once, when the answer is of another build, and keeps the page until it does", async () => {
    const reloadDocument = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const answer = vi.fn<Answer>(async () => networkAt(101, {}, "def5678"));
    mountNetwork(answer, networkAt(100, {}, "abc1234"));
    await pass(4000);
    expect(reloadDocument).toHaveBeenCalledTimes(1);
    expect(newestChip()).toBe("#100");
    await pass(8000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(reloadDocument).toHaveBeenCalledTimes(1);
  });

  it("draws the page of another view as a new page, keyed by its scope: a first render, which nothing on it animates", async () => {
    const answer = vi.fn<Answer>(async (url) => {
      const { params } = parseNetworkParams(queryOf(url.href), "xrpl");
      return networkAt(101, { view: params });
    });
    const { router, container } = mountNetwork(answer, networkAt(100, { view: { period: "30d", display: "native" } }));
    const before = container.querySelector(".network")!;
    expect(before).toBeTruthy();

    await act(async () => void router.navigate(networkHref("xrpl", { period: "1y" })));
    await pass(0);
    expect(answer).toHaveBeenCalledTimes(1);
    const after = container.querySelector(".network")!;
    expect(after).toBeTruthy();
    // Not the same element with other data: the page was mounted again, so its charts and figures did not 'change' on the way.
    expect(after).not.toBe(before);
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(newestChip()).toBe("#101");
    // The beat that follows asks for the view on screen, and only that.
    answer.mockClear();
    await pass(4000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(new URL(answer.mock.calls[0]![0].href).search).toBe("?period=1y");
  });

  describe("pausing", () => {
    it("is the tab's choice, shared with the home page: a pause there holds here", async () => {
      sessionStorage.setItem("explorer:live-paused", "1");
      const answer = vi.fn<Answer>(async () => networkAt(101));
      mountNetwork(answer);
      expect(screen.getByRole("button", { name: "Resume live updates" })).toBeTruthy();
      await pass(30_000);
      expect(answer).not.toHaveBeenCalled();
    });
  });
});

// ---- The market pair page's route ------------------------------------------------------------------------------------------------------

const USD_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const TRADER = "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh";
/** XRP/USD in its natural orientation, as the data API writes the view and the page links it. */
const PAIR_PATH = `/xrpl/markets/XRP/USD.${USD_ISSUER}`;
const PAIR_BUCKETS = ["2026-10-17T13:00:00Z", "2026-10-17T14:00:00Z", "2026-10-17T15:00:00Z", "2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"];

const PAIR_CANDLES: CandleData = {
  axis: { unit: "hour", buckets: PAIR_BUCKETS },
  candles: [
    { o: "2.40", h: "2.46", l: "2.38", c: "2.44", v: "1200000", n: "310" },
    null,
    { o: "2.44", h: "2.45", l: "2.39", c: "2.41", v: "900000", n: "250" },
    { o: "2.41", h: "2.43", l: "2.41", c: "2.42", v: "500000", n: "12" },
    { o: "2.42", h: "2.48", l: "2.40", c: "2.4395", v: "1600000", n: "694" },
  ],
  format: { kind: "price", unit: "USD" },
  volume: { kind: "amount", unit: "XRP" },
  forming: true,
  token: "candles",
};

const PAIR_HEAD: LivePairData["head"] = {
  title: "XRP/USD",
  heading: "XRP / USD",
  base: "XRP",
  counter: "USD",
  issuers: [{ code: "USD", address: USD_ISSUER, href: `/xrpl/account/${USD_ISSUER}` }],
  natives: ["XRP"],
  issued: ["USD rhub8V…F3wq"],
  issuedBy: "USD issued by rhub8V…F3wq",
  invert: { label: "Show USD/XRP", href: `/xrpl/markets/USD.${USD_ISSUER}/XRP` },
  firstPage: PAIR_PATH,
};

const PAIR_TRADES: LivePairData["trades"] = {
  rows: [
    {
      key: "107721455:3:0",
      time: "2026-10-17 15:42:51",
      txHref: `/xrpl/tx/${"A".repeat(64)}`,
      txHidden: ", transaction AAAAAA…AAAA",
      side: "Buy",
      dot: "up",
      price: "2.4395",
      base: "1,000",
      counter: "2,439.5",
      taker: TRADER,
      via: "Book",
    },
  ],
  paging: { newerHref: null, olderHref: `${PAIR_PATH}?marker=M1` },
  source: "/v2/exchanges/{base}/{counter}?descending=true",
  empty: "No trades yet.",
};

/** The pair's parts as a beat that failed them gives them (`pairPage`): each part's failed form. */
const PAIR_FAILED = {
  stats: { state: "failed", labels: ["24 h high", "24 h low", "VWAP 24 h", "Volume XRP", "Volume USD", "Trades 24 h"] },
  candles: { state: "failed", source: "/v2/exchanges/{base}/{counter}?interval=1hour" },
  traders: { state: "failed", source: "/v2/active_accounts/{base}/{counter}" },
  book: { state: "failed", source: "live from the node · book_offers" },
  pool: { state: "failed", title: "XRP/USD AMM pool", source: "live from the node · amm_info" },
  share: { state: "failed" },
} as const satisfies Pick<LivePairData, "stats" | "candles" | "traders" | "book" | "pool" | "share">;

/** The live pair page's data at ledger `index` (its last price is `2.{index}`, its book of that ledger), every part loaded, made by build `build`. */
function pairAt(index: number, over: Partial<LivePairData> = {}, build = "abc1234"): LivePairData {
  const level = (price: string, depth: string) => ({ price, size: "1K", total: "1K", depth });
  return {
    mode: "live",
    head: PAIR_HEAD,
    anchor: { lastValidated: index, closeTime: 1792256472 + index },
    build,
    indexable: true,
    view: [],
    ammParts: true,
    filters: {
      trades: [
        { label: "All", href: PAIR_PATH, current: true },
        { label: "Order book", href: `${PAIR_PATH}?trades=book`, current: false },
        { label: "AMM", href: `${PAIR_PATH}?trades=amm`, current: false },
      ],
      interval: [
        { label: "1 h", href: PAIR_PATH, current: true },
        { label: "4 h", href: `${PAIR_PATH}?interval=4h`, current: false },
      ],
    },
    price: { text: `2.${index}`, unit: "USD per XRP", note: null, token: `price-${index}` },
    stats: {
      state: "ok",
      items: PAIR_FAILED.stats.labels.map((label, at) => ({ label, value: `${at + 1}.5` })),
      note: null,
      change: { text: "+1.84%", dir: "up" },
      token: "stats",
    },
    candles: { state: "ok", data: PAIR_CANDLES, source: "/v2/exchanges/{base}/{counter}?interval=1hour", empty: null },
    trades: PAIR_TRADES,
    book: {
      state: "ok",
      source: "live from the node · book_offers · ledger #",
      ledger: String(index),
      asks: [level("2.44", "0.5")],
      bids: [level("2.39", "1")],
      spread: "0.05",
      token: "book",
    },
    pool: {
      state: "ok",
      title: "XRP/USD AMM pool",
      source: "live from the node · amm_info · ledger #",
      ledger: String(index),
      reserves: "1.8M XRP · 4.39M USD",
      price: "2.4393 USD",
      fee: "0.300%",
      link: { href: `/xrpl/account/${TRADER}`, label: "Pool account →" },
      token: "pool",
    },
    share: { state: "ok", text: "34%" },
    traders: {
      state: "ok",
      data: { items: [{ id: TRADER, label: "rLHzPs…rBJh", href: `/xrpl/account/${TRADER}`, value: "6100000", count: "312" }], format: { kind: "amount", unit: "XRP" }, token: "traders" },
      note: "1 of 1 account that traded XRP/USD in the last 24 hours, by XRP volume. A trade counts for its buyer and its seller.",
      source: "/v2/active_accounts/{base}/{counter}",
    },
    ...over,
  };
}

/** The pair's page behind a marker: old trades only. */
const olderPair = (build = "abc1234"): OlderPairData => ({
  mode: "older",
  head: PAIR_HEAD,
  build,
  view: ["older trades"],
  ammParts: true,
  note: { text: "Older trades of XRP/USD. The price, chart and order book are on the market's page.", link: "the market's page", href: PAIR_PATH },
  trades: { ...PAIR_TRADES, paging: { newerHref: PAIR_PATH, olderHref: `${PAIR_PATH}?marker=M2&back=M1` } },
});

describe("net.markets.$base.$counter.tsx", () => {
  /** The last price the page shows: the ledger it is at, in these tests. */
  const lastPrice = () => document.querySelector(".pair__figure")?.textContent;
  const REQUEST = (path: string) => new Request(`https://explorer.test${path}`);

  /** The data a `.data` request for `url` is answered with. */
  type Answer = (url: URL) => Promise<PairPageData>;

  function PairRoute() {
    return createElement(pair.default, { loaderData: useLoaderData() as PairPageData, params: useParams() as { net: string; base: string; counter: string }, actionData: undefined, matches: [] } as never);
  }

  /** The layout as `net.tsx` has it and the pair page as its route has it, in a data router, on the data the server rendered. */
  function mountPair(answer: Answer, first: PairPageData = pairAt(100), path = PAIR_PATH) {
    const layoutRuns = { count: 0 };
    const router = createMemoryRouter(
      [
        {
          id: "routes/net",
          path: "/:net",
          loader: ({ params }) => ({ network: params.net === "xahau" ? XAHAU : XRPL, origin: "https://explorer.test", run: ++layoutRuns.count }),
          shouldRevalidate: net.shouldRevalidate,
          Component: Outlet,
          children: [
            {
              id: "routes/net.markets.$base.$counter",
              path: "markets/:base/:counter",
              loader: (args) =>
                pair.clientLoader({ params: args.params, request: args.request, serverLoader: () => answer(new URL(args.request.url)) } as never),
              Component: PairRoute,
            },
          ],
        },
      ],
      {
        initialEntries: [path],
        hydrationData: { loaderData: { "routes/net": { network: XRPL, origin: "https://explorer.test", run: 0 }, "routes/net.markets.$base.$counter": first } },
      },
    );
    const view = render(<RouterProvider router={router} />);
    return { router, layoutRuns, ...view };
  }

  it("has a clientLoader, a handle that names the header's section, the headers that forward the class, and the parts a beat may keep", () => {
    expect(pair.clientLoader).toBeTypeOf("function");
    expect(pair.default).toBeTypeOf("function");
    expect(pair.headers).toBe(forwardCacheClass);
    expect(pair.handle).toEqual({ navSection: "markets" });
    expect(pair.PAIR_PARTS).toEqual(["stats", "candles", "traders", "book", "pool", "share"]);
  });

  it("asks the server's loader again every 4 s, shows what it answers, and does not ask for the layout again", async () => {
    let at = 100;
    const answer = vi.fn<Answer>(async () => pairAt(++at));
    const { layoutRuns } = mountPair(answer);
    expect(lastPrice()).toBe("2.100");
    await pass(3999);
    expect(answer).not.toHaveBeenCalled();
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(lastPrice()).toBe("2.101");
    await pass(4000);
    expect(lastPrice()).toBe("2.102");
    expect(layoutRuns.count).toBe(0);
  });

  describe("its clientLoader", () => {
    const rejecting = (error: unknown) => () => Promise.reject(error);
    const reload = (path: string, serverLoader: () => Promise<PairPageData>) => {
      const [, netId, , base, counter] = new URL(`https://explorer.test${path}`).pathname.split("/");
      return pair.clientLoader({ params: { net: netId, base: decodeURIComponent(base!), counter: decodeURIComponent(counter!) }, request: REQUEST(path), serverLoader } as never);
    };

    it("reloads through the scope of the view on screen: the network, the pair as the URL has it and the search, `?interval=4h` for that view", async () => {
      const view = `${PAIR_PATH}?interval=4h`;
      mountPair(async () => pairAt(101), pairAt(100, { view: ["4 h candles"] }), view);
      // The page of that scope is on screen, so the data it shows is what a failed load hands back...
      expect(await reload(view, rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      // ...and for no other view of the pair: another interval, a filter, the other orientation, a page behind a marker, the other network.
      await expect(reload(PAIR_PATH, rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload(`${PAIR_PATH}?interval=4h&trades=amm`, rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload(`/xrpl/markets/USD.${USD_ISSUER}/XRP?interval=4h`, rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload(`${PAIR_PATH}?marker=M1`, rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload(`/xahau/markets/XRP/USD.${USD_ISSUER}?interval=4h`, rejecting(new Error("503")))).rejects.toThrow("503");
    });

    it("lets a redirect through, and hands nothing back once the page has left", async () => {
      const { unmount } = mountPair(async () => pairAt(101));
      const redirect = new Response(null, { status: 302, headers: { Location: PAIR_PATH } });
      await expect(reload(PAIR_PATH, rejecting(redirect))).rejects.toBe(redirect);
      unmount();
      await expect(reload(PAIR_PATH, rejecting(new Error("503")))).rejects.toThrow("503");
    });
  });

  it("keeps the page when a refresh is answered 503, slows down, and says so after two failures", async () => {
    let failing = true;
    const answer = vi.fn<Answer>(async () => {
      if (failing) throw new Response("unavailable", { status: 503 });
      return pairAt(101);
    });
    mountPair(answer);
    await pass(4000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(lastPrice()).toBe("2.100");
    expect(screen.getByRole("status").textContent).toBe("");
    await pass(8000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(lastPrice()).toBe("2.100");
    expect(screen.getByRole("status").textContent).toBe("Live updates paused, retrying…");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("XRP / USD");

    failing = false;
    await pass(16_000);
    expect(lastPrice()).toBe("2.101");
    expect(screen.getByRole("status").textContent).toBe("Live updates reconnected");
  });

  it("keeps each part it shows loaded through a beat that failed it, the book and the pool with the ledger they were read at, and takes the rest", async () => {
    mountPair(async () => pairAt(101, PAIR_FAILED));
    const book = () => screen.getByRole("table", { name: "Order book" });
    expect(book()).toBeTruthy();
    await pass(4000);
    // The answer was taken (the price moved on), and none of its failed parts was.
    expect(lastPrice()).toBe("2.101");
    expect(screen.queryByText("Live state unavailable")).toBeNull();
    expect(screen.queryByText(/Couldn’t load/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(book()).toBeTruthy();
    // The kept book and pool say the ledger they were read at, the page's previous one.
    const card = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
    expect(card("Order book").textContent).toContain("ledger #100");
    expect(card("XRP/USD AMM pool").textContent).toContain("ledger #100");
    expect(card("XRP/USD AMM pool").textContent).toContain("34%");
    expect(card("Most active traders, 24 h").querySelector("a")).toBeTruthy();
    expect(document.querySelectorAll(".candle").length).toBeGreaterThan(0);
    expect(screen.getByText("24 h high").closest("div")!.textContent).toContain("1.5");
  });

  it("keeps the summary's change with the 24 h figures through a beat that failed them: no dash beside figures that look loaded", async () => {
    mountPair(async () => pairAt(101, { stats: PAIR_FAILED.stats }));
    const delta = () => document.querySelector(".pair__delta")!.textContent;
    expect(delta()).toBe("+1.84%");
    await pass(4000);
    // The answer was taken (the price moved on); its 24 h figures failed, and the change is the kept figures' own.
    expect(lastPrice()).toBe("2.101");
    expect(screen.queryByText(/Couldn’t load the 24 h figures/)).toBeNull();
    expect(screen.getByText("24 h high").closest("div")!.textContent).toContain("1.5");
    expect(delta()).toBe("+1.84%");
  });

  it("shows the error of a part that was never loaded, beat after beat", async () => {
    mountPair(async () => pairAt(101, { book: PAIR_FAILED.book, traders: PAIR_FAILED.traders }), pairAt(100, { book: PAIR_FAILED.book, traders: PAIR_FAILED.traders }));
    expect(screen.getByText("Live state unavailable")).toBeTruthy();
    expect(screen.getByText(/Couldn’t load the most active traders/)).toBeTruthy();
    await pass(4000);
    expect(lastPrice()).toBe("2.101");
    expect(screen.getByText("Live state unavailable")).toBeTruthy();
    expect(screen.getByText(/Couldn’t load the most active traders/)).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Order book" })).toBeNull();
  });

  it("draws the page of another view as a new page, keyed by its scope, and the beat that follows asks for that view", async () => {
    const answer = vi.fn<Answer>(async () => pairAt(101, { view: ["4 h candles"] }));
    const { router, container } = mountPair(answer);
    const before = container.querySelector(".pair")!;
    expect(before).toBeTruthy();

    await act(async () => void router.navigate(`${PAIR_PATH}?interval=4h`));
    await pass(0);
    expect(answer).toHaveBeenCalledTimes(1);
    const after = container.querySelector(".pair")!;
    expect(after).not.toBe(before);
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(lastPrice()).toBe("2.101");
    answer.mockClear();
    await pass(4000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0]![0].search).toBe("?interval=4h");
  });

  it("has no live hook behind a marker: no live row, no status, and no beat, also after a navigation from the live page", async () => {
    const answer = vi.fn<Answer>(async (url) => (url.searchParams.has("marker") ? olderPair() : pairAt(101)));
    mountPair(answer, olderPair(), `${PAIR_PATH}?marker=M1`);
    expect(screen.getByText(/Older trades of XRP\/USD/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause live updates" })).toBeNull();
    await pass(20_000);
    expect(answer).not.toHaveBeenCalled();

    // From the live page to the one behind a marker and back: the route's hooks are the same in both (the live ones are the child's).
    cleanup();
    answer.mockClear();
    const { router } = mountPair(answer);
    expect(screen.getByRole("status")).toBeTruthy();
    await act(async () => void router.navigate(`${PAIR_PATH}?marker=M1`));
    await pass(0);
    expect(screen.getByText(/Older trades of XRP\/USD/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    answer.mockClear();
    await pass(20_000);
    expect(answer).not.toHaveBeenCalled();
    await act(async () => void router.navigate(PAIR_PATH));
    await pass(0);
    expect(lastPrice()).toBe("2.101");
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
