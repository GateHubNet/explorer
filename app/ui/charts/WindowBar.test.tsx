import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import type { WindowBarData } from "./types";
import { WindowBar } from "./WindowBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The window bar of an escrow (ledger object pages spec 4.2): its windows on one bar, as wide as their spans, the bounds as ticks with their labels, a mark
// for the moment the page shows, and a button for each window with its range in its label and the kit's tooltip. The builder's numbers place everything, and
// every text on it is the builder's.

const DAY = 86_400;
const T0 = 1_792_000_000;
/** Unix seconds as text, `days` after the escrow's creation. */
const at = (days: number): string => String(T0 + days * DAY);

const RANGES = {
  pending: "24 Oct 2026, 09:30 UTC to 3 Nov 2026, 09:30 UTC",
  finishable: "3 Nov 2026, 09:30 UTC to 3 Dec 2026, 09:30 UTC",
  cancellable: "From 3 Dec 2026, 09:30 UTC, with no end",
};

/** An escrow with the three windows: created at 0, finishable from day 10, cancellable from day 40, and the page as of day 25. */
const DATA: WindowBarData = {
  segments: [
    { id: "pending", label: "Pending", slot: 1, from: at(0), to: at(10), range: RANGES.pending, length: "10 days" },
    { id: "finishable", label: "Can be finished", slot: "up", from: at(10), to: at(40), range: RANGES.finishable, length: "30 days" },
    { id: "cancellable", label: "Can be cancelled", slot: 2, from: at(40), to: null, range: RANGES.cancellable, length: "Until someone cancels it" },
  ],
  bounds: [
    { id: "created", label: "Created 24 Oct 09:30", at: at(0) },
    { id: "finish_after", label: "FinishAfter 3 Nov 09:30", at: at(10) },
    { id: "cancel_after", label: "CancelAfter 3 Dec 09:30", at: at(40) },
  ],
  mark: { label: "Now · 18 Nov 09:30", at: at(25) },
  token: "w1",
};

/** The same escrow after it was finished on day 30: two windows, closed, and nothing after the mark. */
const CLOSED: WindowBarData = {
  segments: [
    { id: "pending", label: "Pending", slot: 1, from: at(0), to: at(10), range: RANGES.pending, length: "10 days" },
    { id: "finishable", label: "Can be finished", slot: "up", from: at(10), to: at(40), range: RANGES.finishable, length: "30 days" },
  ],
  bounds: [
    { id: "created", label: "Created 24 Oct 09:30", at: at(0) },
    { id: "finish_after", label: "FinishAfter 3 Nov 09:30", at: at(10) },
    { id: "cancel_after", label: "CancelAfter 3 Dec 09:30", at: at(40) },
  ],
  mark: { label: "Finished · 3 Dec 09:30", at: at(40) },
  token: "w2",
};

const bar = (extra: Partial<WindowBarData> = {}): WindowBarData => ({ ...DATA, ...extra });

const segs = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLButtonElement>(".wbar__seg"));
const parts = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".wbar__part"));
const ticks = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".wbar__tick"));
const tip = (container: HTMLElement) => container.querySelector<HTMLElement>(".plot__tip");
const lines = (el: HTMLElement) => Array.from(el.children, (line) => line.textContent);
/** The share of the bar a part is, in percent: its `flex` is `{share} 1 {share}%`, a grow and a basis that say the same. */
const shareOf = (part: HTMLElement): number => {
  expect(part.style.flexGrow, part.outerHTML).toBe(part.style.flexBasis.replace("%", ""));
  expect(part.style.flexShrink).toBe("1");
  return Number(part.style.flexGrow);
};
/** The part of the bar that an element is in, and the `left` it has there. */
const placeOf = (container: HTMLElement, el: HTMLElement) => ({ part: parts(container).indexOf(el.closest<HTMLElement>(".wbar__part")!), left: el.style.left });

describe("WindowBar, as the Worker prints it and the browser takes it over", () => {
  it("is a group of the board's name, with a button for each window in its order and no tooltip in the HTML", async () => {
    const { html, container, errors } = await serverThenHydrated(<WindowBar data={DATA} />);
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("When the escrow can be finished or cancelled");
    expect(segs(container).map((seg) => seg.getAttribute("aria-label"))).toEqual([
      `Pending: ${RANGES.pending}`,
      `Can be finished: ${RANGES.finishable}`,
      `Can be cancelled: ${RANGES.cancellable}`,
    ]);
    expect(segs(container).every((seg) => seg.tagName === "BUTTON" && seg.getAttribute("type") === "button")).toBe(true);
    expect(segs(container).map((seg) => seg.getAttribute("data-slot"))).toEqual(["1", "up", "2"]);
    expect(html).not.toContain("plot__tip");
    expect(errors).toEqual([]);
  });

  it("names the windows in a legend, in the words of the segments", async () => {
    const { container } = await serverThenHydrated(<WindowBar data={DATA} />);
    expect(Array.from(container.querySelectorAll(".legend__item"), (item) => item.textContent)).toEqual(["Pending", "Can be finished", "Can be cancelled"]);
    expect(Array.from(container.querySelectorAll(".legend__swatch"), (swatch) => swatch.getAttribute("data-slot"))).toEqual(["1", "up", "2"]);
  });
});

describe("the windows' places", () => {
  it("makes each window as wide as its span of the bar, end to end: two windows of 10 and 30 days on a bar of 40 are 25% and 75%", () => {
    const { container } = render(<WindowBar data={CLOSED} />);
    expect(parts(container).map(shareOf)).toEqual([25, 75]);
  });

  it("keeps the widths in proportion to the spans, whatever the bar's end, and the whole bar is covered", () => {
    const { container } = render(<WindowBar data={DATA} />);
    const [pending, finishable, cancellable] = parts(container).map(shareOf);
    expect(finishable).toBeCloseTo(pending! * 3, 2);
    expect(pending! + finishable! + cancellable!).toBeCloseTo(100, 2);
    expect(parts(container)).toHaveLength(3);
  });

  it("runs an open-ended window to the end of the bar, with room to show: the board gives it 22% of the span before it", () => {
    const { container } = render(<WindowBar data={DATA} />);
    // 40 days of span and 8.8 of room: the open window is 8.8 of 48.8 days.
    expect(parts(container).map(shareOf)).toEqual([20.492, 61.475, 18.033]);
    expect(shareOf(parts(container).at(-1)!)).toBeCloseTo((8.8 / 48.8) * 100, 2);
  });

  it("starts the bar at the mark when the page is as of a moment before every bound, and runs an unknown creation from there", () => {
    // No creation is known: the pending window is open at its start, and the page is as of day 2, before FinishAfter at day 10.
    const data = bar({
      segments: [{ ...DATA.segments[0]!, from: null }, DATA.segments[1]!, DATA.segments[2]!],
      bounds: DATA.bounds.slice(1),
      mark: { label: "Now · 26 Oct 09:30", at: at(2) },
    });
    const { container } = render(<WindowBar data={data} />);
    // Day 2 to day 40, and 22% of those 38 days after it: 46.36 days.
    expect(parts(container).map(shareOf)).toEqual([17.256, 64.711, 18.033]);
    expect(placeOf(container, container.querySelector<HTMLElement>(".wbar__mark")!)).toEqual({ part: 0, left: "0%" });
  });

  it("ends the bar at the mark when the page is as of a moment past every bound, and still gives an open window room after it", () => {
    const { container } = render(<WindowBar data={bar({ mark: { label: "Now · 3 Feb", at: at(100) } })} />);
    // Day 0 to day 100, and 22 more: the open window is from day 40 to day 122, and the mark is 60 of its 82 days in.
    expect(parts(container).map(shareOf)).toEqual([8.197, 24.59, 67.213]);
    expect(placeOf(container, container.querySelector<HTMLElement>(".wbar__mark")!)).toEqual({ part: 2, left: "73.171%" });
  });

  it("draws a bar of closed windows only to the last point, with no room after it", () => {
    const { container } = render(<WindowBar data={CLOSED} />);
    expect(parts(container).map(shareOf).reduce((sum, share) => sum + share, 0)).toBe(100);
  });

  it("makes a part of the stretch that no window covers, with no button and no 24 px, where the page is as of a moment before the first window", () => {
    const data = bar({ segments: DATA.segments.slice(1), bounds: DATA.bounds.slice(1), mark: { label: "Now · 26 Oct 09:30", at: at(2) } });
    const { container } = render(<WindowBar data={data} />);
    const all = parts(container);
    expect(all).toHaveLength(3);
    expect(all.map((part) => part.classList.contains("wbar__part--window"))).toEqual([false, true, true]);
    expect(all.map((part) => part.querySelectorAll("button").length)).toEqual([0, 1, 1]);
    expect(shareOf(all[0]!)).toBe(17.256);
    expect(segs(container)).toHaveLength(2);
    expect(placeOf(container, container.querySelector<HTMLElement>(".wbar__mark")!)).toEqual({ part: 0, left: "0%" });
  });

  it("gives every window a part of the window class, which is the 24 px one, and cuts a window that runs into the one before it", () => {
    const { container } = render(<WindowBar data={DATA} />);
    expect(parts(container).every((part) => part.classList.contains("wbar__part--window"))).toBe(true);
    const overlapping = bar({
      segments: [DATA.segments[0]!, { ...DATA.segments[1]!, from: at(5) }, DATA.segments[2]!],
    });
    const cut = render(<WindowBar data={overlapping} />);
    // Pending is day 0 to 10, and finishable starts where it ends, not at day 5: the parts follow each other.
    expect(parts(cut.container).map(shareOf)).toEqual([20.492, 61.475, 18.033]);
  });

  it("leaves out a window the data does not have: no Pending, and no button for it", () => {
    const data = bar({ segments: DATA.segments.slice(1), bounds: DATA.bounds.slice(1) });
    const { container } = render(<WindowBar data={data} />);
    expect(segs(container).map((seg) => seg.getAttribute("aria-label")?.split(":")[0])).toEqual(["Can be finished", "Can be cancelled"]);
    expect(container.querySelector(".legend")!.textContent).not.toContain("Pending");
    // The bar starts at the first of what is left (day 10; the mark is later): the finishable window is the first part.
    expect(parts(container)).toHaveLength(2);
  });

  it("draws one window alone, and no legend for it: its button names it", () => {
    const only = bar({ segments: [DATA.segments[1]!], bounds: [DATA.bounds[1]!] });
    const { container } = render(<WindowBar data={only} />);
    expect(segs(container)).toHaveLength(1);
    expect(container.querySelector(".legend")).toBeNull();
  });

  it("draws nothing for a bar without windows", () => {
    const { container } = render(<WindowBar data={bar({ segments: [] })} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws a bar that is a single moment, whole: nothing divides by a span of 0", () => {
    const moment = bar({
      segments: [{ ...DATA.segments[2]!, from: at(5) }],
      bounds: [{ id: "created", label: "Created", at: at(5) }],
      mark: { label: "Now · 29 Oct 09:30", at: at(5) },
    });
    const { container } = render(<WindowBar data={moment} />);
    expect(parts(container).map(shareOf)).toEqual([100]);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  // An empty window (no span: the bar starts where it ends, two bounds are the same moment, or its end is before its start) is drawn as a stub, 24 px by CSS, with its
  // button: the bar draws what it is given. The builder leaves an empty window out (WindowBar.tsx, `partsOf`), and these are what a builder that does not gets.
  describe("a window with no span", () => {
    const empty = (container: HTMLElement) => parts(container).map((part) => [shareOf(part), part.querySelectorAll("button").length]);

    it.each([
      ["at FinishAfter", 10, [0, 81.967, 18.033]],
      ["past FinishAfter", 20, [0, 81.967, 18.033]],
    ])("keeps the Pending window of an unknown creation as a stub when the page is as of a moment %s", (_name, day, shares) => {
      const data = bar({
        segments: [{ ...DATA.segments[0]!, from: null }, DATA.segments[1]!, DATA.segments[2]!],
        bounds: DATA.bounds.slice(1),
        mark: { label: "Now · 3 Nov 09:30", at: at(day) },
      });
      const { container } = render(<WindowBar data={data} />);
      // The bar starts at FinishAfter, which is where Pending ends.
      expect(parts(container).map(shareOf)).toEqual(shares);
      expect(empty(container).map(([, buttons]) => buttons)).toEqual([1, 1, 1]);
      expect(segs(container)[0]!.getAttribute("aria-label")).toBe(`Pending: ${RANGES.pending}`);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("keeps the Can be finished window of an escrow whose FinishAfter and CancelAfter are the same moment as a stub", () => {
      const data = bar({
        segments: [DATA.segments[0]!, { ...DATA.segments[1]!, to: at(10) }, { ...DATA.segments[2]!, from: at(10) }],
        bounds: [DATA.bounds[0]!, DATA.bounds[1]!, { ...DATA.bounds[2]!, at: at(10) }],
        mark: { label: "Now · 18 Nov 09:30", at: at(25) },
      });
      const { container } = render(<WindowBar data={data} />);
      // Day 0 to 25 and 22% of those after: 30.5 days, Pending a third of them and Can be cancelled the rest.
      expect(empty(container)).toEqual([[32.787, 1], [0, 1], [67.213, 1]]);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("keeps a window that ends before it starts as a stub at its start, with the stretch it leaves open as a part with no button", () => {
      const data = bar({ segments: [DATA.segments[0]!, { ...DATA.segments[1]!, from: at(40), to: at(10) }, DATA.segments[2]!] });
      const { container } = render(<WindowBar data={data} />);
      // Pending, then nothing from day 10 to day 40, then the stub of the inverted window at day 40, then Can be cancelled.
      expect(empty(container)).toEqual([[20.492, 1], [61.475, 0], [0, 1], [18.033, 1]]);
      expect(parts(container).map((part) => part.classList.contains("wbar__part--window"))).toEqual([true, false, true, true]);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });
  });
});

describe("the bounds and the mark", () => {
  it("puts each bound's label in the builder's words in the window that begins at its time, and hides them from a screen reader, since the buttons and the Details list say the times", () => {
    const { container } = render(<WindowBar data={DATA} />);
    expect(ticks(container).map((tick) => tick.textContent)).toEqual(["Created 24 Oct 09:30", "FinishAfter 3 Nov 09:30", "CancelAfter 3 Dec 09:30"]);
    // Where one window ends the next begins, and a time at the line is the later one's: the start of its part.
    expect(ticks(container).map((tick) => placeOf(container, tick))).toEqual([
      { part: 0, left: "0%" },
      { part: 1, left: "0%" },
      { part: 2, left: "0%" },
    ]);
    expect(ticks(container).every((tick) => tick.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("puts a time that is in a window as far along it as it is in its span, and one at the end of the bar at the end of the last", () => {
    const inside = render(<WindowBar data={DATA} />);
    // The mark is day 25 of the finishable window, day 10 to day 40: halfway.
    expect(placeOf(inside.container, inside.container.querySelector<HTMLElement>(".wbar__mark")!)).toEqual({ part: 1, left: "50%" });
    inside.unmount();
    const closed = render(<WindowBar data={CLOSED} />);
    // CancelAfter is the bar's end, which is the end of the last window.
    expect(placeOf(closed.container, ticks(closed.container)[2]!)).toEqual({ part: 1, left: "100%" });
    expect(placeOf(closed.container, closed.container.querySelector<HTMLElement>(".wbar__mark")!)).toEqual({ part: 1, left: "100%" });
  });

  it("centres a label on its tick, and opens it inwards from a tick near an end of the bar, where centred it would stick out", () => {
    const { container } = render(<WindowBar data={CLOSED} />);
    // Created at the start, FinishAfter a quarter in, CancelAfter at the end.
    expect(ticks(container).map((tick) => tick.style.getPropertyValue("--shift"))).toEqual(["0%", "-50%", "-100%"]);
    expect(container.querySelector<HTMLElement>(".wbar__mark-label")!.style.getPropertyValue("--shift")).toBe("-100%");
  });

  it("writes the labels of bounds that would meet in different rows, for a wide bar and for a narrow one, and says how many rows there are", () => {
    // Created and FinishAfter two hours apart on a bar of 3 days: the second label cannot be written where the first is.
    const close = bar({
      segments: [
        { ...DATA.segments[0]!, from: at(0), to: at(0.08) },
        { ...DATA.segments[1]!, from: at(0.08), to: at(3) },
        { ...DATA.segments[2]!, from: at(3) },
      ],
      bounds: [
        { id: "created", label: "Created 24 Oct 09:30", at: at(0) },
        { id: "finish_after", label: "FinishAfter 24 Oct 11:30", at: at(0.08) },
        { id: "cancel_after", label: "CancelAfter 27 Oct 09:30", at: at(3) },
      ],
      mark: { label: "Now · 25 Oct 09:30", at: at(1) },
    });
    const { container } = render(<WindowBar data={close} />);
    expect(ticks(container).map((tick) => tick.style.getPropertyValue("--row"))).toEqual(["0", "1", "0"]);
    // On a bar of 280 px CancelAfter, which ends at the bar's end, would meet Created's text, and the second's: it needs a row of its own.
    expect(ticks(container).map((tick) => tick.style.getPropertyValue("--row-narrow"))).toEqual(["0", "1", "2"]);
    const band = container.querySelector<HTMLElement>(".wbar__ticks")!;
    expect([band.style.getPropertyValue("--rows"), band.style.getPropertyValue("--rows-narrow")]).toEqual(["2", "3"]);
  });

  it("puts three labels at one time in three rows, and bounds far apart in one", () => {
    const same = bar({ bounds: DATA.bounds.map((bound) => ({ ...bound, at: at(10) })) });
    const stacked = render(<WindowBar data={same} />);
    expect(ticks(stacked.container).map((tick) => tick.style.getPropertyValue("--row"))).toEqual(["0", "1", "2"]);
    expect(stacked.container.querySelector<HTMLElement>(".wbar__ticks")!.style.getPropertyValue("--rows")).toBe("3");
    stacked.unmount();

    const apart = render(<WindowBar data={bar({ bounds: [DATA.bounds[0]!, { ...DATA.bounds[2]!, at: at(1000) }] })} />);
    expect(ticks(apart.container).map((tick) => tick.style.getPropertyValue("--row"))).toEqual(["0", "0"]);
    expect(apart.container.querySelector<HTMLElement>(".wbar__ticks")!.style.getPropertyValue("--rows")).toBe("1");
  });

  it("works the shifts out again for a phone's bar: a label that fits centred on a wide bar opens inwards where the bar is narrow", () => {
    // A bound at day 7 of 48.8, a seventh in: 69 px of 480 holds half of its label (67 px, less the 14 the card's padding gives), 40 of 280 does not.
    const data = bar({ bounds: [DATA.bounds[0]!, { id: "finish_after", label: "FinishAfter 31 Oct 09:30", at: at(7) }, DATA.bounds[2]!] });
    const { container } = render(<WindowBar data={data} />);
    const finish = ticks(container)[1]!;
    expect(finish.style.getPropertyValue("--shift")).toBe("-50%");
    expect(finish.style.getPropertyValue("--shift-narrow")).toBe("0%");
  });

  it("draws the mark as a line at its time with its label over it, both picture only, in the same part", () => {
    const { container } = render(<WindowBar data={DATA} />);
    const line = container.querySelector<HTMLElement>(".wbar__mark")!;
    expect(line.getAttribute("aria-hidden")).toBe("true");
    const label = container.querySelector<HTMLElement>(".wbar__mark-label")!;
    expect(label.textContent).toBe("Now · 18 Nov 09:30");
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(placeOf(container, label)).toEqual(placeOf(container, line));
  });

  it("repeats the mark's label in a line for screen readers, and says it once", () => {
    const { container } = render(<WindowBar data={DATA} />);
    const hidden = container.querySelectorAll(".sr");
    expect(Array.from(hidden, (line) => line.textContent)).toEqual(["Now · 18 Nov 09:30"]);
  });

  it("says the removal's mark the same way: Finished · …", () => {
    const { container } = render(<WindowBar data={CLOSED} />);
    expect(container.querySelector(".sr")!.textContent).toBe("Finished · 3 Dec 09:30");
    expect(container.querySelector(".wbar__mark-label")!.textContent).toBe("Finished · 3 Dec 09:30");
  });
});

describe("the tooltip of a window", () => {
  it("shows on focus with the window's name, range and length, and goes on blur", async () => {
    const { container, errors } = await serverThenHydrated(<WindowBar data={DATA} />);
    const [pending, finishable] = segs(container);
    expect(tip(container)).toBeNull();
    fireEvent.focus(finishable!);
    const shown = tip(container)!;
    expect(lines(shown)).toEqual(["Can be finished", RANGES.finishable, "30 days"]);
    expect(shown.getAttribute("aria-hidden")).toBe("true");
    expect(shown.querySelector(".plot__tip-key")!.getAttribute("data-slot")).toBe("up");
    // It is the kit's: the card, in the plot's tooltip class.
    expect(shown.classList.contains("plot__tip")).toBe(true);
    fireEvent.blur(finishable!);
    expect(tip(container)).toBeNull();
    fireEvent.focus(pending!);
    expect(lines(tip(container)!)).toEqual(["Pending", RANGES.pending, "10 days"]);
    expect(errors).toEqual([]);
  });

  it("has no line for a length a window does not have (the builder gives an empty one when the range says it all)", () => {
    const data = bar({ segments: DATA.segments.map((segment) => (segment.id === "pending" ? { ...segment, from: null, range: "Until 3 Nov 2026, 09:30 UTC", length: "" } : segment)) });
    const { container } = render(<WindowBar data={data} />);
    const [pending, finishable] = segs(container);
    fireEvent.focus(pending!);
    const shown = tip(container)!;
    expect(lines(shown)).toEqual(["Pending", "Until 3 Nov 2026, 09:30 UTC"]);
    expect(shown.querySelector(".plot__tip-date")).toBeNull();
    // another window of the same bar keeps its line
    fireEvent.focus(finishable!);
    expect(lines(tip(container)!)).toEqual(["Can be finished", RANGES.finishable, "30 days"]);
  });

  it("shows under the pointer and goes with it", () => {
    const { container } = render(<WindowBar data={DATA} />);
    const [, , cancellable] = segs(container);
    fireEvent.pointerEnter(cancellable!, { pointerType: "mouse" });
    expect(lines(tip(container)!)).toEqual(["Can be cancelled", RANGES.cancellable, "Until someone cancels it"]);
    fireEvent.pointerLeave(cancellable!, { pointerType: "mouse" });
    expect(tip(container)).toBeNull();
  });

  it("shows on a tap, which a touch screen may not focus, and stays until a touch lands outside the bar", () => {
    const { container } = render(
      <div>
        <WindowBar data={DATA} />
        <p id="outside">elsewhere</p>
      </div>,
    );
    const [pending] = segs(container);
    fireEvent.pointerEnter(pending!, { pointerType: "touch" });
    expect(tip(container)).toBeNull();
    fireEvent.click(pending!);
    expect(tip(container)).not.toBeNull();
    // The finger leaving is not the pointer leaving.
    fireEvent.pointerLeave(pending!, { pointerType: "touch" });
    expect(tip(container)).not.toBeNull();
    fireEvent.pointerDown(pending!, { pointerType: "touch" });
    expect(tip(container)).not.toBeNull();
    fireEvent.pointerDown(container.querySelector("#outside")!, { pointerType: "touch" });
    expect(tip(container)).toBeNull();
  });

  it("is dismissed by Escape, as content that shows on focus has to be, and shows again on the next focus", () => {
    const { container } = render(<WindowBar data={DATA} />);
    const [pending] = segs(container);
    fireEvent.focus(pending!);
    expect(tip(container)).not.toBeNull();
    fireEvent.keyDown(pending!, { key: "Escape" });
    expect(tip(container)).toBeNull();
    fireEvent.blur(pending!);
    fireEvent.focus(pending!);
    expect(tip(container)).not.toBeNull();
    // Other keys leave it.
    fireEvent.keyDown(pending!, { key: "a" });
    expect(tip(container)).not.toBeNull();
  });

  it("is dismissed by Escape from anywhere in the page: a tooltip that the pointer opened has no focus to be on, and the listener is there only while it shows", () => {
    const [add, remove] = [vi.spyOn(document, "addEventListener"), vi.spyOn(document, "removeEventListener")];
    const keydowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "keydown").length;
    const { container, unmount } = render(<WindowBar data={DATA} />);
    expect(keydowns(add)).toBe(0);
    const [, finishable] = segs(container);
    fireEvent.pointerEnter(finishable!, { pointerType: "mouse" });
    expect(tip(container)).not.toBeNull();
    expect(keydowns(add)).toBe(1);
    // Another key leaves it, and Escape from the page's body takes it away.
    fireEvent.keyDown(document.body, { key: "a" });
    expect(tip(container)).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(tip(container)).toBeNull();
    expect(keydowns(remove)).toBe(1);
    // It comes back with the pointer, and an unmount while it shows puts the listener away.
    fireEvent.pointerLeave(finishable!, { pointerType: "mouse" });
    fireEvent.pointerEnter(finishable!, { pointerType: "mouse" });
    expect(keydowns(add)).toBe(2);
    unmount();
    expect(keydowns(remove)).toBe(2);
  });

  it("marks the window it is on and the bar, so that the others are dimmed, and nothing when none is", () => {
    const { container } = render(<WindowBar data={DATA} />);
    const root = container.querySelector(".wbar")!;
    expect(root.hasAttribute("data-active")).toBe(false);
    fireEvent.focus(segs(container)[1]!);
    expect(root.getAttribute("data-active")).toBe("finishable");
    expect(Array.from(container.querySelectorAll(".wbar__seg.is-active"), (seg) => seg.getAttribute("data-slot"))).toEqual(["up"]);
    fireEvent.blur(segs(container)[1]!);
    expect(root.hasAttribute("data-active")).toBe(false);
    expect(container.querySelectorAll(".is-active")).toHaveLength(0);
  });

  it("opens on the side that keeps it on the bar: right from the first window, centred from the middle one, left from the last, at the middle of the window", () => {
    const { container } = render(<WindowBar data={DATA} />);
    const side = () => ["right", "left", "center"].find((name) => tip(container)!.classList.contains(name));
    const left = () => tip(container)!.style.getPropertyValue("--tip-left");
    const [pending, finishable, cancellable] = segs(container);
    // The middle of each window on a bar of true widths: day 5, day 25 and day 44.4 (40 to 48.8) of 48.8.
    fireEvent.focus(pending!);
    expect([side(), left()]).toEqual(["right", "10.246%"]);
    fireEvent.focus(finishable!);
    expect([side(), left()]).toEqual(["center", "51.23%"]);
    fireEvent.focus(cancellable!);
    expect([side(), left()]).toEqual(["left", "90.984%"]);
    // It is the bar's, not its window's: CSS says where it opens, and a narrow bar centres it.
    expect(container.querySelector(".wbar__plot")!.contains(tip(container))).toBe(true);
  });

  it("opens right from a window whose middle is at 25% of the bar and left from one at 75%: the tooltip is up to 340 px, which the kit's 22% and 78% (for 260) would let stick out", () => {
    // Windows of day 0 to 18.3, 18.3 to 30 and 30 on, on a bar of 36.6 days (30 and the 22% of room after it): the first one's middle is at 25%.
    const first = bar({
      segments: [
        { ...DATA.segments[0]!, from: at(0), to: at(18.3) },
        { ...DATA.segments[1]!, from: at(18.3), to: at(30) },
        { ...DATA.segments[2]!, from: at(30), to: null },
      ],
      bounds: [DATA.bounds[0]!],
      mark: { label: "Now · 18 Nov 09:30", at: at(25) },
    });
    const one = render(<WindowBar data={first} />);
    const side = (container: HTMLElement) => ["right", "left", "center"].find((name) => container.querySelector(".plot__tip")!.classList.contains(name));
    const [early] = segs(one.container);
    fireEvent.focus(early!);
    expect(one.container.querySelector<HTMLElement>(".plot__tip")!.style.getPropertyValue("--tip-left")).toBe("25%");
    expect(side(one.container)).toBe("right");
    one.unmount();

    // Two closed windows, day 0 to 30 and 30 to 40, on a bar of 40 days: the second one's middle is at 87.5%.
    const second = render(
      <WindowBar
        data={bar({
          segments: [
            { ...DATA.segments[0]!, from: at(0), to: at(30) },
            { ...DATA.segments[1]!, from: at(30), to: at(40) },
          ],
          bounds: [DATA.bounds[0]!],
        })}
      />,
    );
    const [, late] = segs(second.container);
    fireEvent.focus(late!);
    expect(second.container.querySelector<HTMLElement>(".plot__tip")!.style.getPropertyValue("--tip-left")).toBe("87.5%");
    expect(side(second.container)).toBe("left");
  });
});

describe("WindowBar, memoised on the token (spec 2.9)", () => {
  it("draws the same markup for the same data, in the Worker and in the browser", () => {
    expect(renderToString(<WindowBar data={DATA} />)).toBe(renderToString(<WindowBar data={structuredClone(DATA)} />));
  });

  it("is not rendered again for the same token: the DOM stays, though the numbers it was handed are others", () => {
    const { container, rerender } = render(<WindowBar data={DATA} />);
    const first = segs(container)[0];
    rerender(<WindowBar data={{ ...CLOSED, token: "w1" }} />);
    expect(segs(container)[0]).toBe(first);
    expect(segs(container)).toHaveLength(3);
    expect(container.querySelector(".sr")!.textContent).toBe("Now · 18 Nov 09:30");
  });

  it("rings once for a new token, as the other forms do, and not for the same one", () => {
    const { container, rerender } = render(<WindowBar data={DATA} />);
    expect(container.querySelector(".wbar.is-changed")).toBeNull();
    rerender(<WindowBar data={{ ...CLOSED, token: "w1" }} />);
    expect(container.querySelector(".wbar.is-changed")).toBeNull();
    rerender(<WindowBar data={CLOSED} />);
    expect(container.querySelectorAll(".wbar.is-changed")).toHaveLength(1);
    expect(segs(container)).toHaveLength(2);
  });

  it("does not ring on the server's render or on hydration", async () => {
    const { html, container, errors } = await serverThenHydrated(<WindowBar data={DATA} />);
    expect(html).not.toContain("is-changed");
    expect(container.querySelector(".wbar.is-changed")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("is drawn again for a new token", () => {
    const { container, rerender } = render(<WindowBar data={DATA} />);
    rerender(<WindowBar data={CLOSED} />);
    expect(segs(container)).toHaveLength(2);
    expect(container.querySelector(".sr")!.textContent).toBe("Finished · 3 Dec 09:30");
  });
});
