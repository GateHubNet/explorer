import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData, useParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeLoaderData } from "../server/home-view";
import * as home from "../routes/net._index";
import * as net from "../routes/net";

// The real route modules, not stand-ins: `net.tsx` and `net._index.tsx` as React Router's own build would load them. What these tests pin is
// the wiring that no other test can see because it lives between files: the layout that must not revalidate, the home route's `clientLoader`
// that keeps the page, the page's shared `onScreen`, the hook that polls and the controls (pause, hold, status). Deleting `shouldRevalidate`
// from net.tsx or `clientLoader` from net._index.tsx fails here (and in the browser, test/e2e/live-home.spec.ts).

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
