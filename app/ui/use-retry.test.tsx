import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRetry } from "./use-retry";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A Retry as the pages draw one: disabled and "Retrying…" while its own revalidation runs. */
function RetryButton() {
  const { retry, retrying } = useRetry();
  return (
    <button type="button" onClick={retry} disabled={retrying}>
      {retrying ? "Retrying…" : "Retry"}
    </button>
  );
}

/** The button, and a switch that takes it off the page and puts it back (a section that loaded, a page keyed anew by a beat). */
function Section() {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown(!shown)}>
        {shown ? "Hide" : "Show"}
      </button>
      {shown && <RetryButton />}
    </>
  );
}

/** The section as the one route of a data router whose loader waits while `hold()` has set it, until `release()`. */
function mount() {
  let release: () => void = () => {};
  let held: Promise<null> | null = null;
  const loader = vi.fn(() => held);
  const router = createMemoryRouter([{ path: "*", element: <Section />, loader }], {
    initialEntries: ["/xrpl/markets/XRP/USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"],
    hydrationData: { loaderData: { "0": null } },
  });
  const view = render(<RouterProvider router={router} />);
  const hold = () => (held = new Promise<null>((resolve) => (release = () => resolve(null))));
  return { router, loader, hold, release: () => release(), ...view };
}

const retryButton = () => screen.getByRole("button", { name: /^Retry/ }) as HTMLButtonElement;

describe("useRetry, when what pressed it goes away while it runs", () => {
  it("settles without a word when the button has left the page, and a button that comes back meanwhile is not pressed", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = mount();
    page.hold();
    fireEvent.click(retryButton());
    expect((await screen.findByRole("button", { name: "Retrying…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(page.loader).toHaveBeenCalledTimes(1);

    // The button leaves while its revalidation runs, and a new one comes while it still runs: that one was not pressed, so it is a Retry
    // that works (the revalidation running is not its own).
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(page.router.state.revalidation).toBe("loading");
    expect(retryButton().textContent).toBe("Retry");
    expect(retryButton().disabled).toBe(false);

    // The revalidation the first one started ends: nothing is said of the button that left, and the new one is as it was.
    await act(async () => page.release());
    await waitFor(() => expect(page.router.state.revalidation).toBe("idle"));
    expect(errors).not.toHaveBeenCalled();
    expect(retryButton().textContent).toBe("Retry");
  });

  it("settles without a word when the whole page has gone (the router unmounted) before its revalidation ended", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = mount();
    page.hold();
    fireEvent.click(retryButton());
    await screen.findByRole("button", { name: "Retrying…" });

    page.unmount();
    await act(async () => page.release());
    await waitFor(() => expect(page.router.state.revalidation).toBe("idle"));
    expect(errors).not.toHaveBeenCalled();
  });
});
