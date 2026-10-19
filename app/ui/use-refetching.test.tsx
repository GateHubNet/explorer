import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { useRefetching } from "./use-refetching";

afterEach(cleanup);

// A loader the test holds open, so that a navigation stays `loading` until it lets go.
function gate() {
  let release!: () => void;
  const open = new Promise<null>((resolve) => (release = () => resolve(null)));
  return { open, release };
}

async function mount() {
  let held: Promise<null> | null = null;
  const loader = () => held;
  function Probe() {
    return <p>{String(useRefetching())}</p>;
  }
  const router = createMemoryRouter(
    [
      { path: "/xrpl/network", element: <Probe />, loader },
      { path: "/xrpl/ledger/:index", element: <Probe />, loader },
    ],
    { initialEntries: ["/xrpl/network"] },
  );
  render(<RouterProvider router={router} />);
  // The first load of the route is asynchronous: nothing is drawn until it is done.
  await screen.findByText("false");
  return {
    router,
    hold: () => {
      const g = gate();
      held = g.open;
      return g.release;
    },
    refetching: () => screen.getByText(/^(true|false)$/).textContent,
  };
}

describe("useRefetching", () => {
  it("is false at rest", async () => {
    expect((await mount()).refetching()).toBe("false");
  });

  it("is true while a navigation to the same pathname (another view of the page) is loading, and false once it has", async () => {
    const page = await mount();
    const release = page.hold();
    await act(async () => void page.router.navigate("/xrpl/network?period=1y"));
    expect(page.router.state.navigation.state).toBe("loading");
    expect(page.refetching()).toBe("true");
    await act(async () => release());
    expect(page.refetching()).toBe("false");
    expect(page.router.state.location.search).toBe("?period=1y");
  });

  it("is false while a navigation to another page is loading: that is a new page, not the same one refetched", async () => {
    const page = await mount();
    const release = page.hold();
    await act(async () => void page.router.navigate("/xrpl/ledger/107695660"));
    expect(page.router.state.navigation.state).toBe("loading");
    expect(page.refetching()).toBe("false");
    await act(async () => release());
  });

  it("is false during a revalidation, which is the live page's beat and not a choice of the visitor", async () => {
    const page = await mount();
    const release = page.hold();
    await act(async () => void page.router.revalidate());
    expect(page.router.state.revalidation).toBe("loading");
    expect(page.refetching()).toBe("false");
    await act(async () => release());
  });
});
