import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENTER_MS } from "../motion";
import { DataTable } from "./DataTable";
import { LiveValue } from "./LiveValue";

// What moves when the home page's data changes in the browser (README, "Live updates"): rows that are new enter at the top, the ones that
// were there slide into their new places (FLIP: measure before and after, play the difference), a value that changed ticks in. Nothing of it
// on the first render (the server's, or the hydration), and nothing that moves under `prefers-reduced-motion: reduce`.

const ROW = 46;

/** happy-dom has no layout: every row sits at its place in its parent, a row high each, and the table itself at the top. */
function mockLayout() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const siblings = this.parentElement ? Array.from(this.parentElement.children) : [];
    const top = this.getAttribute("role") === "table" ? 0 : siblings.indexOf(this) * ROW;
    return { top, bottom: top + ROW, left: 0, right: 0, width: 0, height: ROW, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

/** The animation frames the component asks for, played by the test. */
let frames: FrameRequestCallback[] = [];
const playFrames = () =>
  act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });

function reduceMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  reduceMotion(false);
  mockLayout();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Item = { id: string };
const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }));

function Table({ ids, live = true }: { ids: string[]; live?: boolean }) {
  return (
    <DataTable
      label="Things"
      columns={[{ id: "id", header: "Id", width: "1fr", cell: (row: Item) => row.id }]}
      rows={items(...ids)}
      rowKey={(row) => row.id}
      live={live}
    />
  );
}

const rowOf = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-key="${id}"]`)!;
const entering = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".is-entering")].map((row) => row.dataset.key);

describe("DataTable, live", () => {
  it("animates nothing on the first render, on the server or in the browser", () => {
    expect(renderToString(<Table ids={["a", "b", "c"]} />)).not.toContain("is-entering");
    const { container } = render(<Table ids={["a", "b", "c"]} />);
    expect(entering(container)).toEqual([]);
    for (const id of ["a", "b", "c"]) {
      expect(rowOf(container, id).style.transform).toBe("");
      expect(rowOf(container, id).style.transition).toBe("");
    }
    expect(frames).toHaveLength(0);
  });

  it("marks a new row as entering, and slides the rows that were there into their new places", () => {
    const { container, rerender } = render(<Table ids={["a", "b", "c"]} />);
    const a = rowOf(container, "a");

    rerender(<Table ids={["d", "a", "b", "c"]} />);
    expect(entering(container)).toEqual(["d"]);
    // The new row is not moved by script: its own animation brings it in.
    expect(rowOf(container, "d").style.transform).toBe("");
    // The rows that were there are put back where they were (one row up), without a transition...
    for (const id of ["a", "b", "c"]) {
      expect(rowOf(container, id).style.transform, id).toBe(`translateY(-${ROW}px)`);
      expect(rowOf(container, id).style.transition, id).toBe("none");
    }
    // ...and the same elements: React moved them, it did not make new ones.
    expect(rowOf(container, "a")).toBe(a);

    // On the next frame they are released: the transition carries them down to where they now are.
    playFrames();
    for (const id of ["a", "b", "c"]) {
      expect(rowOf(container, id).style.transform, id).toBe("");
      expect(rowOf(container, id).style.transition, id).toMatch(/^transform \d+ms /);
    }
    // The transition is taken off the row when it is over, so that nothing else the row does is slowed by it.
    // (A hover's background transition ending is not it.)
    act(() => void rowOf(container, "a").dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "background-color" })));
    expect(rowOf(container, "a").style.transition).not.toBe("");
    act(() => void rowOf(container, "a").dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "transform" })));
    expect(rowOf(container, "a").style.transition).toBe("");
  });

  it("lets the row that falls off the bottom go, and moves the rest", () => {
    const { container, rerender } = render(<Table ids={["a", "b", "c"]} />);
    rerender(<Table ids={["d", "a", "b"]} />);
    expect(container.querySelector('[data-key="c"]')).toBeNull();
    expect(entering(container)).toEqual(["d"]);
    expect(rowOf(container, "a").style.transform).toBe(`translateY(-${ROW}px)`);
  });

  it("does not move a row that did not move, and animates nothing when only the objects are new", () => {
    const { container, rerender } = render(<Table ids={["a", "b", "c"]} />);
    rerender(<Table ids={["a", "b", "c"]} />);
    expect(entering(container)).toEqual([]);
    for (const id of ["a", "b", "c"]) expect(rowOf(container, id).style.transform).toBe("");
    expect(frames).toHaveLength(0);

    // A new row at the bottom moves nobody.
    rerender(<Table ids={["a", "b", "c", "d"]} />);
    expect(entering(container)).toEqual(["d"]);
    for (const id of ["a", "b", "c"]) expect(rowOf(container, id).style.transform).toBe("");
  });

  it("slides a row that moved up as well as the ones that moved down", () => {
    const { container, rerender } = render(<Table ids={["a", "b", "c"]} />);
    rerender(<Table ids={["c", "a", "b"]} />);
    expect(entering(container)).toEqual([]);
    expect(rowOf(container, "c").style.transform).toBe(`translateY(${2 * ROW}px)`);
    expect(rowOf(container, "a").style.transform).toBe(`translateY(-${ROW}px)`);
  });

  it("enters every row of a list that is all new, as the transactions of a new ledger are", () => {
    const { container, rerender } = render(<Table ids={["a", "b"]} />);
    rerender(<Table ids={["x", "y"]} />);
    expect(entering(container)).toEqual(["x", "y"]);
    expect(frames).toHaveLength(0);
  });

  it("moves nothing under prefers-reduced-motion: a new row is marked (a quiet highlight in the stylesheet), no row is transformed", () => {
    reduceMotion(true);
    const { container, rerender } = render(<Table ids={["a", "b", "c"]} />);
    rerender(<Table ids={["d", "a", "b", "c"]} />);
    expect(entering(container)).toEqual(["d"]);
    for (const id of ["a", "b", "c", "d"]) {
      expect(rowOf(container, id).style.transform, id).toBe("");
      expect(rowOf(container, id).style.transition, id).toBe("");
    }
    expect(frames).toHaveLength(0);
  });

  it("is off unless asked for: another page's table has no keys on its rows, no classes and no styles", () => {
    const { container, rerender } = render(<Table ids={["a", "b", "c"]} live={false} />);
    rerender(<Table ids={["d", "a", "b", "c"]} live={false} />);
    expect(container.querySelector("[data-key]")).toBeNull();
    expect(container.querySelector(".is-entering")).toBeNull();
    expect(container.querySelector('[style*="transform"]')).toBeNull();
    expect(frames).toHaveLength(0);
  });

  it("starts from the rows that are there when it is switched on, and forgets them when it is switched off", () => {
    const { container, rerender } = render(<Table ids={["a"]} live={false} />);
    rerender(<Table ids={["b", "a"]} live />);
    // The first live render is a first render: nothing entering.
    expect(entering(container)).toEqual([]);
    rerender(<Table ids={["c", "b", "a"]} live />);
    expect(entering(container)).toEqual(["c"]);
  });
});

describe("DataTable, live: how long a new row stays entering", () => {
  // The next beat renders the page again, with the same data or the next ledger, while the row that came in is still fading its highlight
  // out (1.2 s). A class that went with the render would cut the animation: it stays until the animation is over.
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("keeps the class through a render inside the animation, adds the next row's, and takes each away when its own animation is over", () => {
    const { container, rerender } = render(<Table ids={["a", "b"]} />);
    rerender(<Table ids={["c", "a", "b"]} />);
    expect(entering(container)).toEqual(["c"]);

    act(() => void vi.advanceTimersByTime(500));
    rerender(<Table ids={["c", "a", "b"]} />);
    expect(entering(container)).toEqual(["c"]);

    rerender(<Table ids={["d", "c", "a"]} />);
    expect(entering(container)).toEqual(["d", "c"]);

    // 1.3 s after c came in, not after d.
    act(() => void vi.advanceTimersByTime(801));
    expect(entering(container)).toEqual(["d"]);
    act(() => void vi.advanceTimersByTime(500));
    expect(entering(container)).toEqual([]);
    // And a later render does not bring it back.
    rerender(<Table ids={["d", "c", "a"]} />);
    expect(entering(container)).toEqual([]);
  });

  it("is as long as the longest animation of the stylesheet (read there), and holds no timer when the table goes", () => {
    const { container, rerender, unmount } = render(<Table ids={["a"]} />);
    rerender(<Table ids={["b", "a"]} />);
    act(() => void vi.advanceTimersByTime(ENTER_MS - 1));
    expect(entering(container)).toEqual(["b"]);
    act(() => void vi.advanceTimersByTime(1));
    expect(entering(container)).toEqual([]);

    rerender(<Table ids={["c", "b", "a"]} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing to a row that has left the list before its animation was over", () => {
    const { container, rerender } = render(<Table ids={["a", "b"]} />);
    rerender(<Table ids={["c", "a"]} />);
    rerender(<Table ids={["d", "c"]} />);
    expect(container.querySelector('[data-key="a"]')).toBeNull();
    act(() => void vi.advanceTimersByTime(ENTER_MS));
    expect(entering(container)).toEqual([]);
  });
});

describe("LiveValue", () => {
  const changed = (container: HTMLElement) => container.querySelectorAll(".is-changed");

  it("animates nothing on the first render", () => {
    expect(renderToString(<LiveValue token="1">one</LiveValue>)).not.toContain("is-changed");
    const { container } = render(<LiveValue token="1">one</LiveValue>);
    expect(container.textContent).toBe("one");
    expect(changed(container)).toHaveLength(0);
  });

  it("does not animate while the token stays, whatever its children say (a clock ticking inside it is not a change)", () => {
    const { container, rerender } = render(<LiveValue token="1">3 s ago</LiveValue>);
    rerender(<LiveValue token="1">4 s ago</LiveValue>);
    expect(container.textContent).toBe("4 s ago");
    expect(changed(container)).toHaveLength(0);
  });

  it("brings in a new value in a new element, marked as changed, and takes the old one away", () => {
    const { container, rerender } = render(<LiveValue token="1">one</LiveValue>);
    const before = container.querySelector(".live__value")!;
    rerender(<LiveValue token="2">two</LiveValue>);
    const after = container.querySelector(".live__value")!;
    expect(container.textContent).toBe("two");
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
    expect(after.classList.contains("is-changed")).toBe(true);
    expect(changed(container)).toHaveLength(1);
  });

  it("keeps the element, and so the animation that is running, when it renders again with the same token", () => {
    const { container, rerender } = render(<LiveValue token="1">one</LiveValue>);
    rerender(<LiveValue token="2">two</LiveValue>);
    const element = container.querySelector(".live__value");
    rerender(<LiveValue token="2">two again</LiveValue>);
    expect(container.querySelector(".live__value")).toBe(element);
    expect(container.querySelector(".live__value")!.classList.contains("is-changed")).toBe(true);
    // The next change is a new element again: the animation starts over.
    rerender(<LiveValue token="3">three</LiveValue>);
    expect(container.querySelector(".live__value")).not.toBe(element);
    expect(changed(container)).toHaveLength(1);
  });

  it("is the same for every token and says nothing to a screen reader: no live region", () => {
    const { container, rerender } = render(<LiveValue token="1">one</LiveValue>);
    rerender(<LiveValue token="2">two</LiveValue>);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });
});
