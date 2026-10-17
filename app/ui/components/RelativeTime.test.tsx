import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelativeTime } from "./RelativeTime";

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
