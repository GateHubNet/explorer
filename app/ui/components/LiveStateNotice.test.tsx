import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveStateNotice } from "./LiveStateNotice";

afterEach(cleanup);

/** `ui` as the one route of a data router (a Retry revalidates the route's own data), whose loader is `loader`. */
function routed(ui: ReactElement, loader: () => unknown = () => null) {
  const router = createMemoryRouter([{ path: "*", element: ui, loader }], { initialEntries: ["/xrpl/account/rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg"] });
  return render(<RouterProvider router={router} />);
}

describe("LiveStateNotice", () => {
  it("is a warning with the default title, the body it is given and an icon", async () => {
    routed(<LiveStateNotice>The network node did not answer.</LiveStateNotice>);
    const title = await screen.findByText("Live state unavailable");
    expect(title.tagName).toBe("STRONG");
    expect(title.className).toBe("notice__title");
    const notice = title.closest(".notice")!;
    expect(notice.className).toBe("notice notice--warning");
    expect(notice.querySelector(".notice__icon svg")).not.toBeNull();
    expect(notice.querySelector(".notice__body")?.textContent).toBe("Live state unavailable" + "The network node did not answer.");
  });

  it("is no live region unless it is told to be one", async () => {
    routed(<LiveStateNotice>The node did not answer.</LiveStateNotice>);
    const notice = (await screen.findByText("Live state unavailable")).closest(".notice")!;
    expect(notice.hasAttribute("role")).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is a status when it is told to be", async () => {
    routed(<LiveStateNotice role="status">The node did not answer.</LiveStateNotice>);
    const status = await screen.findByRole("status");
    expect(status.className).toBe("notice notice--warning");
    expect(status.textContent).toContain("Live state unavailable");
  });

  it("says what it is given in another title", async () => {
    routed(<LiveStateNotice title="Order book unavailable">The node did not answer.</LiveStateNotice>);
    expect(await screen.findByText("Order book unavailable")).toBeTruthy();
    expect(screen.queryByText("Live state unavailable")).toBeNull();
    expect(screen.getByText(/The node did not answer\./)).toBeTruthy();
  });

  it("has a Retry that loads the route's data again, and says it is retrying while that runs", async () => {
    let release: () => void = () => {};
    let calls = 0;
    const loader = vi.fn(() => {
      calls += 1;
      return calls === 1 ? null : new Promise<null>((resolve) => (release = () => resolve(null)));
    });
    routed(<LiveStateNotice>The node did not answer.</LiveStateNotice>, loader);
    const button = await screen.findByRole("button", { name: "Retry" });
    expect(button.className).toBe("btn");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    const retrying = await screen.findByRole("button", { name: "Retrying…" });
    expect((retrying as HTMLButtonElement).disabled).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2);

    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(false);
  });

  describe("on a live page, which revalidates on every beat", () => {
    /** The notice in a data router whose loader waits while `held` is set: a beat (`router.revalidate()`) or a Retry runs it. */
    function live() {
      let release: () => void = () => {};
      let held: Promise<null> | null = null;
      const loader = vi.fn(() => held);
      const router = createMemoryRouter([{ path: "*", element: <LiveStateNotice>The node did not answer.</LiveStateNotice>, loader }], {
        initialEntries: ["/xrpl/markets/XRP/USD"],
        hydrationData: { loaderData: { "0": null } },
      });
      render(<RouterProvider router={router} />);
      const hold = () => (held = new Promise<null>((resolve) => (release = () => resolve(null))));
      return { router, loader, hold, release: () => release() };
    }
    const button = () => screen.getByRole("button", { name: /^Retry/ }) as HTMLButtonElement;

    it("keeps its Retry enabled, and focused, through a revalidation it did not start", async () => {
      const page = live();
      act(() => button().focus());
      expect(document.activeElement).toBe(button());

      page.hold();
      await act(async () => void page.router.revalidate());
      expect(page.router.state.revalidation).toBe("loading");
      expect(button().textContent).toBe("Retry");
      expect(button().disabled).toBe(false);
      expect(document.activeElement).toBe(button());

      await act(async () => page.release());
      expect(page.router.state.revalidation).toBe("idle");
      expect(document.activeElement).toBe(button());
    });

    it("says it is retrying for a press of its own, until that revalidation is over, and not for the beats after it", async () => {
      const page = live();
      page.hold();
      fireEvent.click(button());
      const retrying = await screen.findByRole("button", { name: "Retrying…" });
      expect((retrying as HTMLButtonElement).disabled).toBe(true);
      await act(async () => page.release());
      await waitFor(() => expect(button().textContent).toBe("Retry"));
      expect(button().disabled).toBe(false);

      // A beat after it is not the press's.
      page.hold();
      await act(async () => void page.router.revalidate());
      expect(page.router.state.revalidation).toBe("loading");
      expect(button().textContent).toBe("Retry");
      expect(button().disabled).toBe(false);
      await act(async () => page.release());
    });

    it("says it is retrying when pressed during a beat, until the revalidation is over", async () => {
      const page = live();
      page.hold();
      await act(async () => void page.router.revalidate());
      expect(button().disabled).toBe(false);
      fireEvent.click(button());
      expect((await screen.findByRole("button", { name: "Retrying…" }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => page.release());
      await waitFor(() => expect(button().textContent).toBe("Retry"));
    });
  });
});
