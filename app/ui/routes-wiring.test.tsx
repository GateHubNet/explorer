import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData, useParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amendmentsHref, type AmendmentStatus } from "../domain/amendments-params";
import { networkHref, parseNetworkParams, queryOf, type NetworkParams } from "../domain/network-params";
import { validatorsHref, type ValidatorsParams } from "../domain/validators-params";
import {
  amendmentsSample,
  SAMPLE_KEYS,
  SAMPLE_SIGNING_KEYS,
  summarySample,
  validationsSample,
  validatorDetailSample,
  validatorRowSample,
} from "../../test/support/d1-samples";
import type { Loaded } from "../server/account-view";
import { amendmentsPage, type AmendmentsPageData } from "../server/amendments-view";
import { forwardCacheClass } from "../server/edge-cache";
import type { HomeLoaderData } from "../server/home-view";
import type { AmmPart, NetworkLoaderData, SeriesView } from "../server/network-view";
import { validatorHistoryPage, validatorPage, type ValidatorHistoryData, type ValidatorLiveData } from "../server/validator-view";
import { validatorsPage, type ValidatorsPageData } from "../server/validators-view";
import type { BarListData, TimeSeriesData } from "./charts/types";
import * as home from "../routes/net._index";
import * as amendments from "../routes/net.amendments";
import * as net from "../routes/net";
import * as network from "../routes/net.network";
import * as validators from "../routes/net.validators";
import * as validator from "../routes/net.validators.$key";

// The real route modules, not stand-ins: `net.tsx` and `net._index.tsx` as React Router's own build would load them. What these tests pin is
// the wiring that no other test can see because it lives between files: the layout that must not revalidate, the home route's `clientLoader`
// that keeps the page, the page's shared `onScreen`, the hook that polls and the controls (pause, hold, status). Deleting `shouldRevalidate`
// from net.tsx or `clientLoader` from net._index.tsx fails here (and in the browser, test/e2e/live-home.spec.ts). The network page's route,
// `net.network.tsx`, is wired the same way and is run the same way after it: its scope per view, its merge (`keepLoaded`) and the page keyed by
// its scope. The validators list's route, `net.validators.tsx`, comes next, with its own beat (10 s) and its three parts, and the validator page's,
// `net.validators.$key.tsx`: live every ledger, and a page of older validations that never polls. The amendments list's, `net.amendments.tsx`, is last: one part,
// a beat of a minute, and no merge.

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


// ---- The validators list's route --------------------------------------------------------------------------------------------------------

type ValidatorsData = ValidatorsPageData & { anchor: { lastValidated: number; closeTime: number }; build: string };

const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED = { state: "failed" } as const;

/**
 * The list's data at ledger `index` for `params`, every part loaded, made by build `build`. The quorum is `index - 72` ("28 of 35" at ledger
 * 100): the figure that says which answer is on screen. The one validator it lists is `northpeak.example`.
 */
function validatorsAt(index: number, over: Partial<ValidatorsData> = {}, build = "abc1234", params: ValidatorsParams = { scope: "unl" }): ValidatorsData {
  return {
    ...validatorsPage({
      network: { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" },
      params,
      summary: ok(summarySample({ quorum: { value: index - 72, unl_size: 35, negative_unl: 1, node: index - 72 } })),
      list: ok({ result: "success", count: 1, validators: [validatorRowSample()] }),
      amendments: ok(amendmentsSample()),
    }),
    anchor: { lastValidated: index, closeTime: 1792256472 + index },
    build,
    ...over,
  };
}

describe("net.validators.tsx", () => {
  /** The figure of the Quorum tile: which answer the page shows. */
  const quorum = () => screen.getByText("Quorum").closest(".stat")!.querySelector(".stat__value")!.textContent;
  const REQUEST = (path: string) => new Request(`https://explorer.test${path}`);

  /** The data a `.data` request for `url` is answered with. */
  type Answer = (url: URL) => Promise<ValidatorsData>;

  function ValidatorsRoute() {
    return createElement(validators.default, { loaderData: useLoaderData() as ValidatorsData, params: useParams() as { net: string }, actionData: undefined, matches: [] } as never);
  }

  /** The layout as `net.tsx` has it and the list as `net.validators.tsx` has it, in a data router, on the data the server rendered. */
  function mountValidators(answer: Answer, first = validatorsAt(100), path = "/xrpl/validators") {
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
              id: "routes/net.validators",
              path: "validators",
              loader: (args) =>
                validators.clientLoader({ params: args.params, request: args.request, serverLoader: () => answer(new URL(args.request.url)) } as never),
              Component: ValidatorsRoute,
            },
          ],
        },
      ],
      {
        initialEntries: [path],
        hydrationData: { loaderData: { "routes/net": { network: XRPL, origin: "https://explorer.test", run: 0 }, "routes/net.validators": first } },
      },
    );
    const view = render(<RouterProvider router={router} />);
    return { router, layoutRuns, ...view };
  }

  it("has a clientLoader, a handle that names the header's section, and the headers that forward the class", () => {
    expect(validators.clientLoader).toBeTypeOf("function");
    expect(validators.default).toBeTypeOf("function");
    expect(validators.headers).toBe(forwardCacheClass);
    expect(validators.handle).toEqual({ navSection: "network" });
  });

  it("asks the server's loader again every 10 s, not every 4, shows what it answers, and does not ask for the layout again", async () => {
    let at = 100;
    const answer = vi.fn<Answer>(async () => validatorsAt(++at));
    const { layoutRuns } = mountValidators(answer);
    expect(quorum()).toBe("28 of 35");
    expect(screen.getByText("Live · updates every 10 s")).toBeTruthy();
    await pass(9999);
    expect(answer).not.toHaveBeenCalled();
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(quorum()).toBe("29 of 35");
    await pass(10_000);
    expect(quorum()).toBe("30 of 35");
    expect(layoutRuns.count).toBe(0);
  });

  describe("its clientLoader", () => {
    const rejecting = (error: unknown) => () => Promise.reject(error);
    const reload = (path: string, serverLoader: () => Promise<ValidatorsData>) =>
      validators.clientLoader({ params: { net: "xrpl" }, request: REQUEST(path), serverLoader } as never);

    it("reloads through the scope of the view on screen: the network and the canonical search, `xrpl/validators?scope=all` for the All scope", async () => {
      mountValidators(async () => validatorsAt(101), validatorsAt(100, {}, "abc1234", { scope: "all" }), "/xrpl/validators?scope=all");
      // The page of that scope is on screen, so the data it shows is what a failed load hands back...
      expect(await reload("/xrpl/validators?scope=all", rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      // ...whatever the text of the query is, when it names the same view...
      expect(await reload("/xrpl/validators?x=1&scope=ALL&scope=unl", rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      // ...and for no other view of the page: the UNL, a search, the other network.
      await expect(reload("/xrpl/validators", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload("/xrpl/validators?scope=all&q=north", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload("/xrpl/validators?scope=all&publisher=vl.ripple.com", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(
        validators.clientLoader({ params: { net: "xahau" }, request: REQUEST("/xahau/validators?scope=all"), serverLoader: rejecting(new Error("503")) } as never),
      ).rejects.toThrow("503");
    });

    it("compares nothing with another view's page: a view that is behind in the chain is not 'older'", async () => {
      mountValidators(async () => validatorsAt(101), validatorsAt(107_000_000), "/xrpl/validators");
      const other = validatorsAt(99, {}, "abc1234", { scope: "all" });
      expect(await reload("/xrpl/validators?scope=all", async () => other)).toBe(other);
    });

    it("lets a redirect through, and leaves a network that does not exist to the layout's 404", async () => {
      mountValidators(async () => validatorsAt(101));
      const redirect = new Response(null, { status: 302, headers: { Location: "/xrpl/validators" } });
      await expect(reload("/xrpl/validators?x=1", rejecting(redirect))).rejects.toBe(redirect);
      const notFound = new Response(null, { status: 404 });
      await expect(validators.clientLoader({ params: { net: "bitcoin" }, request: REQUEST("/bitcoin/validators?scope=all"), serverLoader: rejecting(notFound) } as never)).rejects.toBe(notFound);
    });

    it("has nothing to hand back once the page has left: the error screen is for the navigation that comes next", async () => {
      const { unmount } = mountValidators(async () => validatorsAt(101));
      unmount();
      await expect(reload("/xrpl/validators", rejecting(new Error("503")))).rejects.toThrow("503");
    });
  });

  it("keeps the page when a refresh is answered 503, slows down, and says so after two failures", async () => {
    let failing = true;
    const answer = vi.fn<Answer>(async () => {
      if (failing) throw new Response("unavailable", { status: 503 });
      return validatorsAt(101);
    });
    mountValidators(answer);
    await pass(10_000); // the first failure: the next try is in 20 s
    expect(answer).toHaveBeenCalledTimes(1);
    expect(quorum()).toBe("28 of 35");
    expect(screen.getByRole("status").textContent).toBe("");
    await pass(20_000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(quorum()).toBe("28 of 35");
    expect(screen.getByRole("status").textContent).toBe("Live updates paused, retrying…");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Validators");

    failing = false;
    await pass(40_000);
    expect(quorum()).toBe("29 of 35");
    expect(screen.getByRole("status").textContent).toBe("Live updates reconnected");
  });

  it("keeps the list when a beat has L failed while the page shows it loaded, and takes the rest of the answer", async () => {
    mountValidators(async () => validatorsAt(101, { list: FAILED }));
    expect(screen.getByRole("table", { name: "Validators" })).toBeTruthy();
    await pass(10_000);
    // The answer was taken (its quorum is on screen), and its failed list was not: the table is still there, with no error in its place.
    expect(quorum()).toBe("29 of 35");
    expect(screen.getByRole("table", { name: "Validators" })).toBeTruthy();
    expect(screen.getByText("northpeak.example")).toBeTruthy();
    expect(screen.queryByText("Couldn’t load the validators.")).toBeNull();
  });

  it("keeps the overview and the amendments' filter the same way, each part on its own", async () => {
    mountValidators(async () => validatorsAt(101, { summary: FAILED, amendments: FAILED }));
    expect(screen.getByLabelText("Votes yes for")).toBeTruthy();
    await pass(10_000);
    // S and A failed in the answer: the figures and the select shown are kept, and the list (which loaded) is the answer's.
    expect(quorum()).toBe("28 of 35");
    expect(screen.getByLabelText("Votes yes for")).toBeTruthy();
    expect(screen.queryByText("Couldn’t load the network overview.")).toBeNull();
    expect(screen.queryByText("Couldn’t load the software versions.")).toBeNull();
  });

  it("shows the error of a part that was never loaded, takes it once it loads, and keeps a part that other parts' failures do not touch", async () => {
    let at = 100;
    const answers = [validatorsAt(101, { list: FAILED }), validatorsAt(102)];
    mountValidators(async () => answers[at++ - 100]!, validatorsAt(100, { list: FAILED }));
    // The page opens with its list failed: nothing loaded to keep, so the card says so, with a Retry.
    expect(screen.getByText("Couldn’t load the validators.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Validators" })).toBeNull();
    await pass(10_000);
    expect(quorum()).toBe("29 of 35");
    expect(screen.getByText("Couldn’t load the validators.")).toBeTruthy();
    // The next beat has the list: it is taken.
    await pass(10_000);
    expect(quorum()).toBe("30 of 35");
    expect(screen.queryByText("Couldn’t load the validators.")).toBeNull();
    expect(screen.getByRole("table", { name: "Validators" })).toBeTruthy();
  });

  it("refuses an answer with a lower last validated ledger than the page's, and counts it as a failure", async () => {
    const answer = vi.fn<Answer>(async () => validatorsAt(90));
    mountValidators(answer, validatorsAt(100));
    await pass(10_000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(quorum()).toBe("28 of 35");
    // A failure slows the next beat down to 20 s.
    await pass(19_999);
    expect(answer).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(quorum()).toBe("28 of 35");
  });

  it("reloads the document, once, when the answer is of another build, and keeps the page until it does", async () => {
    const reloadDocument = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const answer = vi.fn<Answer>(async () => validatorsAt(101, {}, "def5678"));
    mountValidators(answer, validatorsAt(100, {}, "abc1234"));
    await pass(10_000);
    expect(reloadDocument).toHaveBeenCalledTimes(1);
    expect(quorum()).toBe("28 of 35");
    await pass(20_000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(reloadDocument).toHaveBeenCalledTimes(1);
  });

  it("draws the page of another view as a new page, keyed by its scope: a first render, which nothing on it animates", async () => {
    const answer = vi.fn<Answer>(async (url) => validatorsAt(101, {}, "abc1234", url.search.includes("scope=all") ? { scope: "all" } : { scope: "unl" }));
    const { router, container } = mountValidators(answer, validatorsAt(100));
    const before = container.querySelector(".validators")!;
    expect(before).toBeTruthy();

    await act(async () => void router.navigate(validatorsHref("xrpl", { scope: "all" })));
    await pass(0);
    expect(answer).toHaveBeenCalledTimes(1);
    const after = container.querySelector(".validators")!;
    expect(after).toBeTruthy();
    // Not the same element with other data: the page was mounted again, so its rows and figures did not 'change' on the way.
    expect(after).not.toBe(before);
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(quorum()).toBe("29 of 35");
    // The beat that follows asks for the view on screen, and only that.
    answer.mockClear();
    await pass(10_000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(new URL(answer.mock.calls[0]![0].href).search).toBe("?scope=all");
  });

  describe("pausing", () => {
    it("is the tab's choice, shared with the home page: a pause there holds here", async () => {
      sessionStorage.setItem("explorer:live-paused", "1");
      const answer = vi.fn<Answer>(async () => validatorsAt(101));
      mountValidators(answer);
      expect(screen.getByRole("button", { name: "Resume live updates" })).toBeTruthy();
      await pass(60_000);
      expect(answer).not.toHaveBeenCalled();
    });
  });
});

// ---- The validator page's route ---------------------------------------------------------------------------------------------------------

type ValidatorData = ValidatorLiveData & { anchor: { lastValidated: number; closeTime: number }; build: string };

const VALIDATOR_KEY: string = SAMPLE_KEYS[0];

/**
 * The validator page's data at ledger `index`, every part loaded, made by build `build`: its newest validation is of ledger `index - 1`, the figure that says which
 * answer is on screen.
 */
function validatorAt(index: number, over: Partial<ValidatorData> = {}, build = "abc1234"): ValidatorData {
  const page = validationsSample();
  const [first, ...rest] = page.validations;
  return {
    ...validatorPage({
      network: { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" },
      validator: validatorDetailSample(),
      recent: ok({ ...page, validations: [{ ...first!, ledger_index: index - 1 }, ...rest] }),
      summary: ok(summarySample()),
      amendments: ok(amendmentsSample()),
      anchor: { lastValidated: index, closeTime: 1792252452 + index },
    }),
    anchor: { lastValidated: index, closeTime: 1792252452 + index },
    build,
    ...over,
  };
}

/** A page of the validator's older validations, behind the sample's marker. */
const validatorHistory = (): ValidatorHistoryData =>
  validatorHistoryPage({
    network: { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" },
    validator: validatorDetailSample(),
    recent: validationsSample(),
    marker: "M1",
    back: [],
  });

describe("net.validators.$key.tsx", () => {
  /** The first ledger of the recent validations: which answer the page shows. */
  const newestRow = () => within(screen.getByRole("table", { name: "Recent validations" })).getAllByRole("link")[0]!.textContent;
  /** The status line of the live row (the copy buttons have theirs too). */
  const liveStatus = () => document.querySelector(".hero__status [role='status']")!.textContent;
  const REQUEST = (path: string) => new Request(`https://explorer.test${path}`);

  /** The data a `.data` request for `url` is answered with. */
  type Answer = (url: URL) => Promise<ValidatorData | ValidatorHistoryData>;

  function ValidatorRoute() {
    return createElement(validator.default, { loaderData: useLoaderData() as ValidatorData, params: useParams() as { net: string; key: string }, actionData: undefined, matches: [] } as never);
  }

  /** The layout as `net.tsx` has it and the validator as `net.validators.$key.tsx` has it, in a data router, on the data the server rendered. */
  function mountValidator(answer: Answer, first: ValidatorData | ValidatorHistoryData = validatorAt(100), path = `/xrpl/validators/${VALIDATOR_KEY}`) {
    const router = createMemoryRouter(
      [
        {
          id: "routes/net",
          path: "/:net",
          loader: ({ params }) => ({ network: params.net === "xahau" ? XAHAU : XRPL, origin: "https://explorer.test" }),
          shouldRevalidate: net.shouldRevalidate,
          Component: Outlet,
          children: [
            {
              id: "routes/net.validators.$key",
              path: "validators/:key",
              loader: (args) =>
                validator.clientLoader({ params: args.params, request: args.request, serverLoader: () => answer(new URL(args.request.url)) } as never),
              Component: ValidatorRoute,
            },
          ],
        },
      ],
      {
        initialEntries: [path],
        hydrationData: { loaderData: { "routes/net": { network: XRPL, origin: "https://explorer.test" }, "routes/net.validators.$key": first } },
      },
    );
    return { router, ...render(<RouterProvider router={router} />) };
  }

  it("has a clientLoader, a handle that names the header's section, and the headers that forward the class", () => {
    expect(validator.clientLoader).toBeTypeOf("function");
    expect(validator.default).toBeTypeOf("function");
    expect(validator.headers).toBe(forwardCacheClass);
    expect(validator.handle).toEqual({ navSection: "network" });
  });

  it("asks the server's loader again every ledger (4 s), and shows what it answers", async () => {
    let at = 100;
    const answer = vi.fn<Answer>(async () => validatorAt(++at));
    mountValidator(answer);
    expect(newestRow()).toBe("#99");
    expect(screen.getByText("Live · updates every ledger")).toBeTruthy();
    await pass(3999);
    expect(answer).not.toHaveBeenCalled();
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(newestRow()).toBe("#100");
    await pass(4000);
    expect(newestRow()).toBe("#101");
  });

  it("keeps the recent validations when a beat has them failed while the page shows them loaded, and takes the rest of the answer", async () => {
    const answer = vi.fn<Answer>(async () => validatorAt(101, { recent: { state: "failed" }, summary: { state: "failed" } }));
    mountValidator(answer);
    await pass(4000);
    expect(answer).toHaveBeenCalledTimes(1);
    // The table is the one on screen (no error in its place), and the summary's part too: the fee votes are still compared with the fees now.
    expect(newestRow()).toBe("#99");
    expect(screen.queryByText("Couldn’t load the recent validations.")).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    expect(screen.getAllByText("Same").length).toBe(3);
  });

  it("refuses an answer with a lower last validated ledger than the page's, and keeps the page when a refresh fails", async () => {
    let failing = true;
    const answer = vi.fn<Answer>(async () => {
      if (failing) throw new Response("unavailable", { status: 503 });
      return validatorAt(90);
    });
    mountValidator(answer);
    await pass(4000); // a failure: the next try is in 8 s
    expect(newestRow()).toBe("#99");
    await pass(8000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(liveStatus()).toBe("Live updates paused, retrying…");
    failing = false;
    await pass(16_000);
    // Answered, but behind the page: not drawn.
    expect(answer).toHaveBeenCalledTimes(3);
    expect(newestRow()).toBe("#99");
  });

  describe("its clientLoader", () => {
    const rejecting = (error: unknown) => () => Promise.reject(error);
    const reload = (path: string, serverLoader: () => Promise<ValidatorData | ValidatorHistoryData>, key = VALIDATOR_KEY) =>
      validator.clientLoader({ params: { net: "xrpl", key }, request: REQUEST(path), serverLoader } as never);

    it("hands back what the page of that validator shows when a load fails, and nothing for another validator or network", async () => {
      mountValidator(async () => validatorAt(101));
      expect(await reload(`/xrpl/validators/${VALIDATOR_KEY}`, rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      await expect(reload(`/xrpl/validators/${SAMPLE_KEYS[1]}`, rejecting(new Error("503")), SAMPLE_KEYS[1])).rejects.toThrow("503");
      await expect(
        validator.clientLoader({ params: { net: "xahau", key: VALIDATOR_KEY }, request: REQUEST(`/xahau/validators/${VALIDATOR_KEY}`), serverLoader: rejecting(new Error("503")) } as never),
      ).rejects.toThrow("503");
    });

    it("goes straight to the server's loader for a page of older validations, even with the live page of that validator on screen", async () => {
      mountValidator(async () => validatorAt(101));
      // Nothing is handed back and nothing compared: a marker page is history.
      await expect(reload(`/xrpl/validators/${VALIDATOR_KEY}?marker=M1`, rejecting(new Error("503")))).rejects.toThrow("503");
      const older = validatorHistory();
      expect(await reload(`/xrpl/validators/${VALIDATOR_KEY}?marker=M1`, async () => older)).toBe(older);
    });

    it("lets a redirect through (a signing key, a hex key)", async () => {
      mountValidator(async () => validatorAt(101));
      const redirect = new Response(null, { status: 302, headers: { Location: `/xrpl/validators/${VALIDATOR_KEY}` } });
      await expect(reload(`/xrpl/validators/${SAMPLE_SIGNING_KEYS[0]}`, rejecting(redirect), SAMPLE_SIGNING_KEYS[0])).rejects.toBe(redirect);
    });
  });

  describe("the page of older validations", () => {
    it("never polls, has no live row, and keeps no page for the live view", async () => {
      const answer = vi.fn<Answer>(async () => validatorAt(101));
      const { container } = mountValidator(answer, validatorHistory(), `/xrpl/validators/${VALIDATOR_KEY}?marker=M1`);
      expect(screen.getByRole("table", { name: "Recent validations" })).toBeTruthy();
      expect(container.querySelector(".hero__status-row")).toBeNull();
      await pass(60_000);
      expect(answer).not.toHaveBeenCalled();
      // `onScreen` was never told of it: a failed live load of the same validator has no page to fall back on.
      await expect(
        validator.clientLoader({ params: { net: "xrpl", key: VALIDATOR_KEY }, request: REQUEST(`/xrpl/validators/${VALIDATOR_KEY}`), serverLoader: () => Promise.reject(new Error("503")) } as never),
      ).rejects.toThrow("503");
    });
  });
});

// ---- The amendments list's route --------------------------------------------------------------------------------------------------------

type AmendmentsData = AmendmentsPageData & { anchor: { lastValidated: number; closeTime: number }; build: string };

/**
 * The amendments list's data at ledger `index` for the view `status`, made by build `build`. The next flag ledger is `107,748,000 + index` ("#107,748,100" at ledger 100):
 * the figure that says which answer is on screen.
 */
function amendmentsAt(index: number, status?: AmendmentStatus, build = "abc1234"): AmendmentsData {
  return {
    ...amendmentsPage({
      network: { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" },
      amendments: amendmentsSample({ next_flag_ledger: { ledger_index: 107_748_000 + index, voting_ledger: 107_747_999 + index, expected: "2026-10-19T16:05:28Z" } }),
      ...(status !== undefined && { status }),
    }),
    anchor: { lastValidated: index, closeTime: 1792256472 + index },
    build,
  };
}

describe("net.amendments.tsx", () => {
  /** The flag ledger of the rules paragraph: which answer the page shows. */
  const flagLedger = () => /Next flag ledger (#[\d,]+)/.exec(screen.getByText(/^Validators vote in the ledger before every flag ledger/).textContent ?? "")?.[1];
  const REQUEST = (path: string) => new Request(`https://explorer.test${path}`);

  /** The data a `.data` request for `url` is answered with. */
  type Answer = (url: URL) => Promise<AmendmentsData>;

  function AmendmentsRoute() {
    return createElement(amendments.default, { loaderData: useLoaderData() as AmendmentsData, params: useParams() as { net: string }, actionData: undefined, matches: [] } as never);
  }

  /** The layout as `net.tsx` has it and the list as `net.amendments.tsx` has it, in a data router, on the data the server rendered. */
  function mountAmendments(answer: Answer, first = amendmentsAt(100), path = "/xrpl/amendments") {
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
              id: "routes/net.amendments",
              path: "amendments",
              loader: (args) =>
                amendments.clientLoader({ params: args.params, request: args.request, serverLoader: () => answer(new URL(args.request.url)) } as never),
              Component: AmendmentsRoute,
            },
          ],
        },
      ],
      {
        initialEntries: [path],
        hydrationData: { loaderData: { "routes/net": { network: XRPL, origin: "https://explorer.test", run: 0 }, "routes/net.amendments": first } },
      },
    );
    const view = render(<RouterProvider router={router} />);
    return { router, layoutRuns, ...view };
  }

  it("has a clientLoader, a handle that names the header's section, and the headers that forward the class", () => {
    expect(amendments.clientLoader).toBeTypeOf("function");
    expect(amendments.default).toBeTypeOf("function");
    expect(amendments.headers).toBe(forwardCacheClass);
    expect(amendments.handle).toEqual({ navSection: "network" });
  });

  it("asks the server's loader again every minute, not every 4 or 10 s, shows what it answers, and does not ask for the layout again", async () => {
    let at = 100;
    const answer = vi.fn<Answer>(async () => amendmentsAt(++at));
    const { layoutRuns } = mountAmendments(answer);
    expect(flagLedger()).toBe("#107,748,100");
    expect(screen.getByText("Live · updates every minute")).toBeTruthy();
    await pass(59_999);
    expect(answer).not.toHaveBeenCalled();
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(flagLedger()).toBe("#107,748,101");
    await pass(60_000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(flagLedger()).toBe("#107,748,102");
    expect(layoutRuns.count).toBe(0);
  });

  describe("its clientLoader", () => {
    const rejecting = (error: unknown) => () => Promise.reject(error);
    const reload = (path: string, serverLoader: () => Promise<AmendmentsData>) =>
      amendments.clientLoader({ params: { net: "xrpl" }, request: REQUEST(path), serverLoader } as never);

    it("reloads through the scope of the view on screen: the network and the canonical status, `xrpl/amendments?status=voting` for the Voting chip", async () => {
      mountAmendments(async () => amendmentsAt(101), amendmentsAt(100, "voting"), "/xrpl/amendments?status=voting");
      // The page of that view is on screen, so the data it shows is what a failed load hands back...
      expect(await reload("/xrpl/amendments?status=voting", rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      // ...whatever the text of the query is, when it names the same view...
      expect(await reload("/xrpl/amendments?x=1&status=VOTING&status=enabled", rejecting(new Error("503")))).toMatchObject({ anchor: { lastValidated: 100 } });
      // ...and for no other view of the page: all of them, another status, the other network.
      await expect(reload("/xrpl/amendments", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(reload("/xrpl/amendments?status=enabled", rejecting(new Error("503")))).rejects.toThrow("503");
      await expect(
        amendments.clientLoader({ params: { net: "xahau" }, request: REQUEST("/xahau/amendments?status=voting"), serverLoader: rejecting(new Error("503")) } as never),
      ).rejects.toThrow("503");
    });

    it("compares nothing with another view's page: a view that is behind in the chain is not 'older'", async () => {
      mountAmendments(async () => amendmentsAt(101), amendmentsAt(107_000_000), "/xrpl/amendments");
      const other = amendmentsAt(99, "voting");
      expect(await reload("/xrpl/amendments?status=voting", async () => other)).toBe(other);
    });

    it("lets a redirect through, and leaves a network that does not exist to the layout's 404", async () => {
      mountAmendments(async () => amendmentsAt(101));
      const redirect = new Response(null, { status: 302, headers: { Location: "/xrpl/amendments" } });
      await expect(reload("/xrpl/amendments?x=1", rejecting(redirect))).rejects.toBe(redirect);
      const notFound = new Response(null, { status: 404 });
      await expect(amendments.clientLoader({ params: { net: "bitcoin" }, request: REQUEST("/bitcoin/amendments?status=voting"), serverLoader: rejecting(notFound) } as never)).rejects.toBe(notFound);
    });

    it("has nothing to hand back once the page has left: the error screen is for the navigation that comes next", async () => {
      const { unmount } = mountAmendments(async () => amendmentsAt(101));
      unmount();
      await expect(reload("/xrpl/amendments", rejecting(new Error("503")))).rejects.toThrow("503");
    });
  });

  it("keeps the page when a refresh is answered 503, slows down (a minute, two, four), and says so after two failures", async () => {
    let failing = true;
    const answer = vi.fn<Answer>(async () => {
      if (failing) throw new Response("unavailable", { status: 503 });
      return amendmentsAt(101);
    });
    mountAmendments(answer);
    await pass(60_000); // the first failure: the next try is in 2 minutes
    expect(answer).toHaveBeenCalledTimes(1);
    expect(flagLedger()).toBe("#107,748,100");
    expect(document.querySelector(".hero__status [role='status']")!.textContent).toBe("");
    await pass(119_999);
    expect(answer).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(2); // the second failure: the next try is in 4 minutes, the most
    expect(flagLedger()).toBe("#107,748,100");
    expect(document.querySelector(".hero__status [role='status']")!.textContent).toBe("Live updates paused, retrying…");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Amendments");

    failing = false;
    await pass(240_000);
    expect(answer).toHaveBeenCalledTimes(3);
    expect(flagLedger()).toBe("#107,748,101");
    expect(document.querySelector(".hero__status [role='status']")!.textContent).toBe("Live updates reconnected");
  });

  it("refuses an answer with a lower last validated ledger than the page's, and counts it as a failure", async () => {
    const answer = vi.fn<Answer>(async () => amendmentsAt(90));
    mountAmendments(answer, amendmentsAt(100));
    await pass(60_000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(flagLedger()).toBe("#107,748,100");
    // A failure slows the next beat down to 2 minutes.
    await pass(119_999);
    expect(answer).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(flagLedger()).toBe("#107,748,100");
  });

  it("shows an answer as it is: the page is one part, and there is nothing to keep from the page on screen", async () => {
    const empty: AmendmentsData = { ...amendmentsAt(101), rows: [], footer: ["0 amendments", "the tick on each bar marks 80%"] };
    mountAmendments(async () => empty);
    expect(within(screen.getByRole("table", { name: "Amendments" })).getAllByRole("row")).toHaveLength(6);
    await pass(60_000);
    expect(within(screen.getByRole("table", { name: "Amendments" })).getAllByRole("row")).toHaveLength(1);
  });

  it("reloads the document, once, when the answer is of another build, and keeps the page until it does", async () => {
    const reloadDocument = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const answer = vi.fn<Answer>(async () => amendmentsAt(101, undefined, "def5678"));
    mountAmendments(answer, amendmentsAt(100, undefined, "abc1234"));
    await pass(60_000);
    expect(reloadDocument).toHaveBeenCalledTimes(1);
    expect(flagLedger()).toBe("#107,748,100");
    await pass(120_000);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(reloadDocument).toHaveBeenCalledTimes(1);
  });

  it("draws the page of another view as a new page, keyed by its scope: a first render, which nothing on it animates", async () => {
    const answer = vi.fn<Answer>(async (url) => amendmentsAt(101, url.search.includes("status=voting") ? "voting" : undefined));
    const { router, container } = mountAmendments(answer, amendmentsAt(100));
    const before = container.querySelector(".amendments")!;
    expect(before).toBeTruthy();

    await act(async () => void router.navigate(amendmentsHref("xrpl", { status: "voting" })));
    await pass(0);
    expect(answer).toHaveBeenCalledTimes(1);
    const after = container.querySelector(".amendments")!;
    expect(after).toBeTruthy();
    // Not the same element with other data: the page was mounted again, so its rows did not 'enter' on the way.
    expect(after).not.toBe(before);
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(within(screen.getByRole("table", { name: "Amendments" })).getAllByRole("row")).toHaveLength(2);
    // The beat that follows asks for the view on screen, and only that.
    answer.mockClear();
    await pass(60_000);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(new URL(answer.mock.calls[0]![0].href).search).toBe("?status=voting");
  });

  describe("pausing", () => {
    it("is the tab's choice, shared with the home page: a pause there holds here", async () => {
      sessionStorage.setItem("explorer:live-paused", "1");
      const answer = vi.fn<Answer>(async () => amendmentsAt(101));
      mountAmendments(answer);
      expect(screen.getByRole("button", { name: "Resume live updates" })).toBeTruthy();
      await pass(300_000);
      expect(answer).not.toHaveBeenCalled();
    });
  });
});
