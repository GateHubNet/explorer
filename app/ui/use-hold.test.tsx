import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { holdsFocus, useHolds } from "./use-hold";

// What every live page does with the visitor's pointer and focus (README, "Live updates"): a mouse or pen over a part with links, or
// keyboard focus in it, holds the page, so that nothing moves under a click. `HomePage.test.tsx` runs it through the real tables.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Two parts that hold, by name, the way a page marks the parts that have links. */
function Parts({ onHold }: { onHold?: (held: boolean) => void }) {
  const holds = useHolds(onHold);
  return (
    <>
      <div data-testid="one" {...holds("one")}>
        <a href="#one">one's link</a>
      </div>
      <div data-testid="two" {...holds("two")}>
        <button type="button">two's button</button>
      </div>
    </>
  );
}

const calls = (onHold: ReturnType<typeof vi.fn>) => onHold.mock.calls.map(([held]) => held);

describe("useHolds", () => {
  it("holds while a mouse or a pen is over a part, and lets go when it leaves; a finger is not a pointer that stays", () => {
    const onHold = vi.fn();
    render(<Parts onHold={onHold} />);
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "mouse" });
    fireEvent.pointerLeave(screen.getByTestId("one"), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "pen" });
    fireEvent.pointerLeave(screen.getByTestId("one"), { pointerType: "pen" });
    expect(calls(onHold)).toEqual([true, false, true, false]);

    onHold.mockClear();
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "touch" });
    expect(onHold).not.toHaveBeenCalled();
  });

  it("holds while focus is on a link or a button in a part, and lets go when focus leaves the part, not when it moves inside it", () => {
    const onHold = vi.fn();
    render(<Parts onHold={onHold} />);
    act(() => screen.getByRole("link").focus());
    expect(calls(onHold).at(-1)).toBe(true);
    act(() => screen.getByRole("button").focus());
    expect(calls(onHold).at(-1)).toBe(true);
    act(() => screen.getByRole("button").blur());
    expect(calls(onHold).at(-1)).toBe(false);
  });

  it("keeps one hold for each name and each way, and holds while any is there", () => {
    const onHold = vi.fn();
    render(<Parts onHold={onHold} />);
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByTestId("two"), { pointerType: "mouse" });
    // Leaving one part leaves the other holding.
    fireEvent.pointerLeave(screen.getByTestId("one"), { pointerType: "mouse" });
    expect(calls(onHold)).toEqual([true, true, true]);
    // The same part held two ways: the pointer leaving leaves the focus holding.
    act(() => screen.getByRole("button").focus());
    fireEvent.pointerLeave(screen.getByTestId("two"), { pointerType: "mouse" });
    expect(calls(onHold).at(-1)).toBe(true);
    act(() => screen.getByRole("button").blur());
    expect(calls(onHold).at(-1)).toBe(false);
  });

  it("counts a hold of a name once, however many times the way says it", () => {
    const onHold = vi.fn();
    render(<Parts onHold={onHold} />);
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "mouse" });
    fireEvent.pointerLeave(screen.getByTestId("one"), { pointerType: "mouse" });
    expect(calls(onHold).at(-1)).toBe(false);
  });

  it("lets go when the page unmounts, even when nothing was held, and has nothing to say after that", () => {
    const onHold = vi.fn();
    const { unmount } = render(<Parts onHold={onHold} />);
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "mouse" });
    unmount();
    expect(calls(onHold)).toEqual([true, false]);

    const quiet = vi.fn();
    render(<Parts onHold={quiet} />).unmount();
    expect(calls(quiet)).toEqual([false]);
  });

  it("tells the latest onHold, the one the page was last drawn with, and nobody when there is none", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = render(<Parts onHold={first} />);
    rerender(<Parts onHold={second} />);
    fireEvent.pointerEnter(screen.getByTestId("one"), { pointerType: "mouse" });
    expect(first).not.toHaveBeenCalled();
    expect(calls(second)).toEqual([true]);

    rerender(<Parts />);
    expect(() => fireEvent.pointerLeave(screen.getByTestId("one"), { pointerType: "mouse" })).not.toThrow();
    expect(() => unmount()).not.toThrow();
  });

  it("returns the same function for every render, so that a page can depend on it", () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useHolds(vi.fn()));
      return null;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    expect(seen[1]).toBe(seen[0]);
  });
});

describe("holdsFocus", () => {
  it("is true for a link or a button, or for something inside one", () => {
    const link = document.createElement("a");
    link.href = "#x";
    const inside = document.createElement("span");
    link.appendChild(inside);
    const button = document.createElement("button");
    document.body.appendChild(link);
    document.body.appendChild(button);
    expect(holdsFocus(link)).toBe(true);
    expect(holdsFocus(inside)).toBe(true);
    expect(holdsFocus(button)).toBe(true);
    link.remove();
    button.remove();
  });

  it("is true for what shows a focus ring and false for what does not: a click on a spot of a table is not keyboard focus", () => {
    const region = document.createElement("div");
    const matches = vi.spyOn(HTMLElement.prototype, "matches");
    matches.mockImplementation(() => true);
    expect(holdsFocus(region)).toBe(true);
    matches.mockImplementation(() => false);
    expect(holdsFocus(region)).toBe(false);
  });

  it("is false for what is not an element, and for a browser that does not know the selector", () => {
    expect(holdsFocus(window)).toBe(false);
    vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(() => {
      throw new SyntaxError(":focus-visible");
    });
    expect(holdsFocus(document.createElement("div"))).toBe(false);
  });
});
