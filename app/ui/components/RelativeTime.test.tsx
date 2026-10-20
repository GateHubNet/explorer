import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { RelativeTime, useClockSeconds } from "./RelativeTime";

// 2026-10-17 17:01:12 UTC
const AT = 1792256472;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date((AT + 3) * 1000));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Moves the clock to `seconds` (unix) and lets the shared timer fire once (the timer's second is part of the move). */
function clockAt(seconds: number) {
  act(() => {
    vi.setSystemTime(new Date((seconds - 1) * 1000));
    vi.advanceTimersByTime(1000);
  });
}

describe("RelativeTime", () => {
  it("prints the fallback on the server, so that a stored page does not carry an age", () => {
    const html = renderToString(<RelativeTime at={AT} fallback="at 17:01:12 UTC" lead="closed " />);
    expect(html).toContain("at 17:01:12 UTC");
    expect(html).not.toMatch(/ago/);
    expect(html).toMatch(/datetime="2026-10-17T17:01:12\.000Z"/i);
    expect(html).toContain('title="2026-10-17 17:01:12 UTC"');
  });

  it("prints nothing but the element when there is no fallback", () => {
    expect(renderToString(<RelativeTime at={AT} lead=" · " />)).not.toContain("·");
  });

  it("shows how long ago once it is in the browser, and keeps counting", () => {
    render(<RelativeTime at={AT} fallback="at 17:01:12 UTC" lead="closed " />);
    expect(screen.getByText("closed 3 s ago")).toBeTruthy();
    act(() => {
      vi.setSystemTime(new Date((AT + 61) * 1000));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("closed 1 min ago")).toBeTruthy();
  });

  it("says '< 1 min ago' under coarse={60}, then the age", () => {
    render(<RelativeTime at={AT} fallback="at 17:01:12 UTC" lead="seen " coarse={60} />);
    expect(screen.getByText("seen < 1 min ago")).toBeTruthy();
    clockAt(AT + 59);
    expect(screen.getByText("seen < 1 min ago")).toBeTruthy();
    clockAt(AT + 60);
    expect(screen.getByText("seen 1 min ago")).toBeTruthy();
  });

  it("says '< 5 min ago' under coarse={300}, then the age", () => {
    render(<RelativeTime at={AT} coarse={300} />);
    expect(screen.getByText("< 5 min ago")).toBeTruthy();
    clockAt(AT + 299);
    expect(screen.getByText("< 5 min ago")).toBeTruthy();
    clockAt(AT + 300);
    expect(screen.getByText("5 min ago")).toBeTruthy();
  });

  it("shows a moment a little ahead of the clock as under the coarse age too", () => {
    vi.setSystemTime(new Date((AT - 4) * 1000));
    render(<RelativeTime at={AT} coarse={60} />);
    expect(screen.getByText("< 1 min ago")).toBeTruthy();
  });

  it("prints only the fallback on the server with coarse", () => {
    const html = renderToString(<RelativeTime at={AT} fallback="at 17:01:12 UTC" lead="seen " coarse={60} />);
    expect(html).toContain("at 17:01:12 UTC");
    expect(html).not.toMatch(/ago|min|seen/);
    expect(html).toContain('title="2026-10-17 17:01:12 UTC"');
  });

  it("keeps its own age under a coarse one that is not asked for", () => {
    render(<RelativeTime at={AT} lead="closed " />);
    expect(screen.getByText("closed 3 s ago")).toBeTruthy();
  });

  it("stops its timer when the last one leaves", () => {
    const { unmount } = render(<RelativeTime at={AT} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one timer between all of them", () => {
    render(
      <>
        <RelativeTime at={AT} />
        <RelativeTime at={AT - 5} />
        <RelativeTime at={AT - 10} />
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it("draws nothing for a time that is not one", () => {
    const { container } = render(<RelativeTime at={Number.NaN} fallback="x" />);
    expect(container.textContent).toBe("");
  });
});

function Clock() {
  const now = useClockSeconds();
  return <output>{now === null ? "no clock" : String(now)}</output>;
}

describe("useClockSeconds", () => {
  it("is null in the server's HTML and at hydration, then the whole seconds of the clock", async () => {
    const { html, container, errors } = await serverThenHydrated(<Clock />);
    expect(html).toContain("no clock");
    expect(container.textContent).toBe(String(AT + 3));
    expect(errors).toEqual([]);
  });

  it("ticks every second", async () => {
    const { container } = await serverThenHydrated(<Clock />);
    clockAt(AT + 7);
    expect(container.textContent).toBe(String(AT + 7));
  });
});
