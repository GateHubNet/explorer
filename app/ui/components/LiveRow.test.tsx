import { fireEvent, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { LiveRow, type LiveRowControls } from "./LiveRow";

const routed = (ui: ReactElement) => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl/network"] })} />;

const controls = (over: Partial<LiveRowControls> = {}): LiveRowControls => ({
  paused: false,
  held: false,
  notice: "",
  failures: 0,
  onTogglePause: vi.fn(),
  ...over,
});
const LABEL = "Live · updates every ledger";

describe("LiveRow", () => {
  it("is the home hero's row: the status line with its dot and its words, in a row 44 px high from the start", async () => {
    const { html, container, errors } = await serverThenHydrated(routed(<LiveRow label={LABEL} />));
    // The server's HTML has it, so the cached page does.
    expect(html).toContain('class="hero__status-row"');
    const row = container.querySelector("div.hero__status-row")!;
    const status = row.querySelector("p.hero__status")!;
    expect(status.textContent).toBe(LABEL);
    const dot = status.querySelector("span.hero__dot")!;
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(dot.classList.contains("is-paused")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("holds no heading and no breadcrumb: the page puts its own beside it", async () => {
    const { container } = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls()} />));
    expect(container.querySelector("h1, h2, nav, .crumbs")).toBeNull();
  });

  it("has no status and no button when the page is drawn without its route (no controls)", async () => {
    const { container, errors } = await serverThenHydrated(routed(<LiveRow label={LABEL} />));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(within(container).queryByRole("button")).toBeNull();
    expect(container.querySelector(".hero__held")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("has exactly one role=status with the controls, set up empty in the server's HTML", async () => {
    const { html, container, errors } = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls()} />));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(html).toMatch(/<span[^>]*role="status"[^>]*><\/span>/);
    // Inside the line, after the words, as on the home page.
    expect(container.querySelector('.hero__status [role="status"]')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("puts the toggle in after hydration only, and a press calls onTogglePause", async () => {
    const live = controls();
    const { html, container, errors } = await serverThenHydrated(routed(<LiveRow label={LABEL} live={live} />));
    expect(html).not.toContain("Pause live updates");
    const button = within(container).getByRole("button", { name: "Pause live updates" });
    expect(button.closest(".hero__status-row")).toBe(container.querySelector(".hero__status-row"));
    fireEvent.click(button);
    expect(live.onTogglePause).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("offers to resume while paused", async () => {
    const { container } = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls({ paused: true })} />));
    expect(within(container).getByRole("button", { name: "Resume live updates" }).classList.contains("is-paused")).toBe(true);
  });

  it("says why it waits while held: the note it is given, or the table's words", async () => {
    const given = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls({ held: true })} heldNote="Paused while you look at the ledgers" />));
    expect(given.container.querySelector(".hero__held")!.textContent).toBe("Paused while you look at the ledgers");
    const standard = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls({ held: true })} />));
    expect(standard.container.querySelector(".hero__held")!.textContent).toBe("Paused while you look at the table");
    const not = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls()} heldNote="Paused while you look at the ledgers" />));
    expect(not.container.querySelector(".hero__held")).toBeNull();
  });

  it("goes quiet (is-paused) for a pause, for a hold and for two failures in a row, and not for one failure", async () => {
    const dotWith = async (live: LiveRowControls | undefined) => {
      const { container } = await serverThenHydrated(routed(<LiveRow label={LABEL} live={live} />));
      return container.querySelector(".hero__dot")!.classList.contains("is-paused");
    };
    expect(await dotWith(controls())).toBe(false);
    expect(await dotWith(controls({ paused: true }))).toBe(true);
    expect(await dotWith(controls({ held: true }))).toBe(true);
    expect(await dotWith(controls({ failures: 1 }))).toBe(false);
    expect(await dotWith(controls({ failures: 2 }))).toBe(true);
    expect(await dotWith(undefined)).toBe(false);
  });

  it("says what the visitor has just done, and that the updates are retrying, in the one status", async () => {
    const said = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls({ notice: "Live updates paused", paused: true })} />));
    expect(within(said.container).getByRole("status").textContent).toBe("Live updates paused");
    const stuck = await serverThenHydrated(routed(<LiveRow label={LABEL} live={controls({ failures: 2 })} />));
    expect(within(stuck.container).getByRole("status").textContent).toBe("Live updates paused, retrying…");
  });
});
