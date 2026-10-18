import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider, useLoaderData, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_REFRESH_MS, useLiveRefresh } from "./use-live-refresh";

// The open home page asks the explorer's own Worker for its data again every few seconds (`useRevalidator().revalidate()`: the `.data` URL of
// the route, never the data API). These tests use a real data router with a loader that counts, and fake timers.

/** What `document.visibilityState` says; happy-dom has a fixed answer, and a tab's real one changes. */
let visibility: DocumentVisibilityState = "visible";
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  // Only the interval: React and the router run on promises and the scheduler, which stay real.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // The property is the test's own on the document object; the prototype's getter is what the document had.
  Reflect.deleteProperty(document, "visibilityState");
});

/** Lets `ms` of fake time pass, with the promises that come of it (a loader's answer) settled and rendered. */
const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function Page() {
  useLiveRefresh();
  const loaded = useLoaderData() as number;
  return <p>loaded {loaded}</p>;
}

/** A page at `/` whose loader counts its runs. `gate` makes a run wait for the test to let it finish. */
function mount(options: { gate?: () => Promise<void>; others?: boolean } = {}) {
  const runs = { count: 0 };
  const router = createMemoryRouter(
    [
      {
        path: "/",
        // The server's data is already there when the page is hydrated: the first run is not a revalidation.
        loader: async () => {
          runs.count += 1;
          await options.gate?.();
          return runs.count;
        },
        Component: Page,
        HydrateFallback: () => null,
      },
      {
        path: "/other",
        loader: async () => {
          await options.gate?.();
          return null;
        },
        Component: () => <p>other page</p>,
      },
    ],
    { initialEntries: ["/"], hydrationData: { loaderData: { "0": 0 } } },
  );
  const view = render(<RouterProvider router={router} />);
  return { runs, router, ...view };
}

describe("useLiveRefresh", () => {
  it("revalidates the route's data every 4 s while the tab is visible", async () => {
    expect(LIVE_REFRESH_MS).toBe(4000);
    const { runs } = mount();
    await pass(3999);
    expect(runs.count).toBe(0);
    await pass(1);
    expect(runs.count).toBe(1);
    expect(screen.getByText("loaded 1")).toBeTruthy();
    await pass(3999);
    expect(runs.count).toBe(1);
    await pass(1);
    expect(runs.count).toBe(2);
    await pass(8000);
    expect(runs.count).toBe(4);
  });

  it("does nothing while the tab is hidden, and revalidates at once when it becomes visible again", async () => {
    const { runs } = mount();
    await pass(4000);
    expect(runs.count).toBe(1);

    act(() => setVisibility("hidden"));
    await pass(60_000);
    expect(runs.count).toBe(1);
    // The timer itself is stopped, not only ignored: a hidden tab costs nothing.
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => setVisibility("visible"));
    expect(runs.count).toBe(2);
    // And the beat goes on from there, 4 s after it.
    await pass(3999);
    expect(runs.count).toBe(2);
    await pass(1);
    expect(runs.count).toBe(3);
  });

  it("starts hidden when the page is opened in a background tab, and begins when the tab is shown", async () => {
    visibility = "hidden";
    const { runs } = mount();
    await pass(30_000);
    expect(runs.count).toBe(0);
    await act(async () => setVisibility("visible"));
    expect(runs.count).toBe(1);
  });

  it("does not start another revalidation while one is still running", async () => {
    let release!: () => void;
    let gate = new Promise<void>((resolve) => (release = resolve));
    const { runs } = mount({ gate: () => gate });
    await pass(4000);
    expect(runs.count).toBe(1);
    // The loader has not answered: three beats go by without a second request.
    await pass(12_000);
    expect(runs.count).toBe(1);

    release();
    await pass(0);
    expect(screen.getByText("loaded 1")).toBeTruthy();
    gate = Promise.resolve();
    await pass(4000);
    expect(runs.count).toBe(2);
  });

  it("does not revalidate on becoming visible while a revalidation is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runs } = mount({ gate: () => gate });
    await pass(4000);
    expect(runs.count).toBe(1);
    act(() => setVisibility("hidden"));
    await act(async () => setVisibility("visible"));
    expect(runs.count).toBe(1);
    release();
    await pass(0);
  });

  it("does not start a second revalidation in the instant before the page has drawn that the first one runs", async () => {
    // React Router restarts a revalidation that is asked for again while it runs (it aborts the loads under way), and what the page knows of
    // a running one (`revalidator.state`) is a render behind: two events of the tab becoming visible in one breath are one request.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runs } = mount({ gate: () => gate });
    act(() => {
      setVisibility("hidden");
      setVisibility("visible");
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(runs.count).toBe(1);
    release();
    await pass(0);
    // And it is free again once the first one has ended.
    await act(async () => setVisibility("hidden"));
    await act(async () => setVisibility("visible"));
    expect(runs.count).toBe(2);
  });

  it("skips a beat while a navigation is in progress", async () => {
    let release!: () => void;
    let slow = false;
    const gate = () => (slow ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve());
    function Home() {
      useLiveRefresh();
      const navigate = useNavigate();
      return <button onClick={() => void navigate("/other")}>go</button>;
    }
    let runs = 0;
    const router = createMemoryRouter(
      [
        {
          path: "/",
          loader: async () => {
            runs += 1;
            return null;
          },
          Component: Home,
        },
        { path: "/other", loader: gate, Component: () => <p>other page</p> },
      ],
      { initialEntries: ["/"], hydrationData: { loaderData: { "0": null } } },
    );
    render(<RouterProvider router={router} />);

    slow = true;
    await act(async () => void router.navigate("/other"));
    expect(router.state.navigation.state).toBe("loading");
    await pass(12_000);
    expect(runs).toBe(0);

    release();
    await pass(0);
    expect(screen.getByText("other page")).toBeTruthy();
  });

  it("stops when the visitor leaves the page: no timer, no listener, no more requests", async () => {
    const { runs, router, unmount } = mount();
    await pass(4000);
    expect(runs.count).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await pass(20_000);
    act(() => setVisibility("hidden"));
    await act(async () => setVisibility("visible"));
    expect(runs.count).toBe(1);
    router.dispose();
  });

  it("stops when the route is left in the router, too", async () => {
    const { runs, router } = mount();
    await pass(4000);
    await act(async () => void router.navigate("/other"));
    expect(screen.getByText("other page")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    await pass(20_000);
    expect(runs.count).toBe(1);
  });

  it("prints nothing and starts nothing on the server, and the first client render is the server's", () => {
    const router = createMemoryRouter([{ path: "/", loader: () => 7, Component: Page }], {
      initialEntries: ["/"],
      hydrationData: { loaderData: { "0": 7 } },
    });
    const html = renderToString(<RouterProvider router={router} />);
    expect(html.replace(/<!-- -->/g, "")).toContain("loaded 7");
    // Effects do not run on the server: no timer, no listener.
    expect(vi.getTimerCount()).toBe(0);

    const { container } = render(<RouterProvider router={router} />);
    expect(container.textContent).toBe("loaded 7");
  });
});
