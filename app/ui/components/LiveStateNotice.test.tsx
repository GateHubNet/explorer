import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
