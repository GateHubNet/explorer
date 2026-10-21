import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { Countdown } from "./Countdown";
import { RelativeTime } from "./RelativeTime";

// 2026-10-19 15:53:52 UTC, unix seconds
const AT = Date.UTC(2026, 9, 19, 15, 53, 52) / 1000;

/** What `document.hidden` says; happy-dom has a fixed answer, and a tab's real one changes. */
let hidden = false;

/** Moves the clock to `seconds` (unix) and lets the shared timer fire once (the timer's second is part of the move). */
function clockAt(seconds: number) {
  act(() => {
    vi.setSystemTime(new Date((seconds - 1) * 1000));
    vi.advanceTimersByTime(1000);
  });
}

beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date((AT - 11 * 60) * 1000));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // The property is the test's own on the document object; the prototype's getter is what the document had.
  Reflect.deleteProperty(document, "hidden");
});

describe("Countdown", () => {
  it("prints the fallback on the server, and nothing that counts", () => {
    const html = renderToString(<Countdown at={AT} fallback="expected 15:53 UTC" past="due now" approx lead=", " />);
    expect(html).toContain("expected 15:53 UTC");
    expect(html).not.toContain("in ");
    expect(html).not.toContain("due now");
    expect(html).toMatch(/datetime="2026-10-19T15:53:52\.000Z"/i);
    expect(html).toContain('title="Oct 19, 2026, 15:53 UTC"');
  });

  it("hydrates the server's HTML without a mismatch", async () => {
    const { html, container, errors } = await serverThenHydrated(
      <Countdown at={AT} fallback="expected 15:53 UTC" past="due now" approx className="when" />,
    );
    expect(html).toContain("expected 15:53 UTC");
    expect(container.textContent).toBe("in ~11 min");
    expect(container.querySelector("time.when")).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("counts down in the browser", () => {
    render(<Countdown at={AT} fallback="expected 15:53 UTC" past="due now" approx />);
    expect(screen.getByText("in ~11 min")).toBeTruthy();
    clockAt(AT - 10 * 60);
    expect(screen.getByText("in ~10 min")).toBeTruthy();
  });

  it("writes a set moment without the ~", () => {
    vi.setSystemTime(new Date((AT - 4 * 86_400) * 1000));
    render(<Countdown at={AT} fallback="expected Oct 19, 2026" past="due now" />);
    expect(screen.getByText("in 4 days")).toBeTruthy();
  });

  it("says past once the moment has gone", () => {
    render(<Countdown at={AT} fallback="expected 15:53 UTC" past="due now" approx />);
    clockAt(AT);
    expect(screen.getByText("due now")).toBeTruthy();
    clockAt(AT + 1);
    expect(screen.getByText("due now")).toBeTruthy();
  });

  it("keeps an empty fallback on the server and puts lead before the browser's text only", () => {
    // Nothing is inside the element: the attributes have commas of their own (the title), the text has none.
    const html = renderToString(<Countdown at={AT} fallback="" past="due now" lead=", " />);
    expect(html.replace(/<[^>]*>/g, "")).toBe("");
    vi.setSystemTime(new Date((AT - 9 * 3600) * 1000));
    const { container, rerender } = render(<Countdown at={AT} fallback="" past="due now" lead=", " />);
    expect(container.textContent).toBe(", in 9 h");
    rerender(<Countdown at={AT - 10 * 3600} fallback="" past="expired" lead=", " />);
    expect(container.textContent).toBe(", expired");
  });

  it("does not tick while the tab is hidden", () => {
    render(<Countdown at={AT} fallback="expected 15:53 UTC" past="due now" approx />);
    expect(screen.getByText("in ~11 min")).toBeTruthy();
    hidden = true;
    clockAt(AT - 5 * 60);
    clockAt(AT - 4 * 60);
    expect(screen.getByText("in ~11 min")).toBeTruthy();
    hidden = false;
    clockAt(AT - 3 * 60);
    expect(screen.getByText("in ~3 min")).toBeTruthy();
  });

  it("shares RelativeTime's one timer", () => {
    const { unmount } = render(
      <>
        <RelativeTime at={AT} />
        <Countdown at={AT} fallback="" past="due now" />
        <Countdown at={AT + 60} fallback="" past="due now" />
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs the timer for a Countdown alone, and stops it when that leaves", () => {
    const { unmount } = render(<Countdown at={AT} fallback="" past="due now" />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("draws nothing for an at that is not a number", () => {
    expect(renderToString(<Countdown at={Number.NaN} fallback="expected" past="due now" />)).toBe("");
    const { container } = render(<Countdown at={Number.POSITIVE_INFINITY} fallback="expected" past="due now" />);
    expect(container.innerHTML).toBe("");
  });
});
