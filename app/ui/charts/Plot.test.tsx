import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { END_LABEL_GUTTER_PX, niceScale } from "./geometry";
import { Plot, useHydrated, usePlotMark, type PlotProps } from "./Plot";
import { tickLabel } from "./labels";
import type { TimeAxis } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The frame every plotted form shares (spec 2.2, 2.5, 2.7 and 2.9): gridlines and the y labels, the x labels in both sets, the side-scroll
// region for dense columns, the empty text, the end-label gutter, the box a screen reader meets as one image, and the ring after a change.
// The marks are stubs here: a form brings its own.

/** 30 days, Sep 18 to Oct 17, 2026. */
const AXIS: TimeAxis = {
  unit: "day",
  buckets: Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10)),
};

const SUMMARY = "Transactions per day, Sep 18 to Oct 17, 2026. Highest Oct 3, 18; latest Oct 17, 12. Choose Table for every value.";
const SCALE = niceScale([18], { integer: true });

const base: Omit<PlotProps, "children"> = {
  title: "Transactions",
  summary: SUMMARY,
  token: "t1",
  scale: SCALE,
  kind: "count",
  axis: AXIS,
  placement: "points",
};

const plot = (extra: Partial<PlotProps> = {}) => (
  <Plot {...base} {...extra}>
    {[0, 14, 29].map((i) => (
      <span key={i} className="stub-mark" data-bucket={i} />
    ))}
  </Plot>
);

const texts = (nodes: ArrayLike<Element>) => Array.from(nodes, (node) => node.textContent);

describe("Plot's frame, as the Worker prints it and the browser takes it over", () => {
  it("puts the marks in an image box that carries the summary, and hides the marks themselves", async () => {
    const { container, errors } = await serverThenHydrated(plot());
    const images = container.querySelectorAll('[role="img"]');
    expect(images).toHaveLength(1);
    const image = images[0]!;
    expect(image.tagName).toBe("DIV");
    expect(image.getAttribute("aria-label")).toBe(SUMMARY);
    const marks = image.querySelectorAll("[data-bucket]");
    expect(marks).toHaveLength(3);
    for (const mark of marks) expect(mark.closest('[aria-hidden="true"]'), `bucket ${mark.getAttribute("data-bucket")}`).not.toBeNull();
    expect(image.closest(".plot")).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("draws one gridline for each tick, the 0 line as the base, at the tick's height", async () => {
    const { container, errors } = await serverThenHydrated(plot());
    expect(SCALE.ticks).toEqual([0, 5, 10, 15, 20]);
    const lines = Array.from(container.querySelectorAll<HTMLElement>(".plot > .plot__grid"));
    expect(lines.map((line) => line.style.bottom)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(lines.map((line) => line.classList.contains("is-base"))).toEqual([true, false, false, false, false]);
    expect(errors).toEqual([]);
  });

  it("has no base line when the scale does not start at 0", async () => {
    const { container } = await serverThenHydrated(plot({ scale: niceScale([52, 58], { from: 50, to: 60 }) }));
    expect(container.querySelectorAll(".plot__grid").length).toBeGreaterThan(1);
    expect(container.querySelector(".plot__grid.is-base")).toBeNull();
  });

  it("writes the y labels with tickLabel in a gutter of its own, outside the plot, hidden from assistive technology", async () => {
    const { container, errors } = await serverThenHydrated(plot());
    const gutter = container.querySelector<HTMLElement>(".plot__y")!;
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    expect(gutter.closest(".plot")).toBeNull();
    expect(texts(gutter.children)).toEqual(SCALE.ticks.map((tick) => tickLabel(tick, "count")));
    expect(texts(gutter.children)).toEqual(["0", "5", "10", "15", "20"]);
    expect(Array.from(gutter.children, (label) => (label as HTMLElement).style.bottom)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(errors).toEqual([]);
  });

  it("sizes the gutter from the longest label, in characters, with nothing measured", async () => {
    const wide = await serverThenHydrated(plot({ scale: niceScale([10_000_000]), kind: "count" }));
    const labels = texts(wide.container.querySelector(".plot__y")!.children);
    expect(labels).toContain("2.5M");
    expect(wide.container.querySelector<HTMLElement>(".plot__y")!.style.getPropertyValue("--chars")).toBe(String(Math.max(...labels.map((l) => l!.length))));
    expect(wide.container.querySelector<HTMLElement>(".plot__y")!.style.getPropertyValue("--chars")).toBe("4");
  });

  it("uses the unit sign of the kind in the labels", async () => {
    const { container } = await serverThenHydrated(plot({ scale: niceScale([99.5], { from: 98, to: 100 }), kind: "percent" }));
    for (const label of texts(container.querySelector(".plot__y")!.children)) expect(label).toMatch(/%$/);
  });

  it("renders both sets of x labels, six for a wide plot and three for a narrow one, none of which says so far", async () => {
    const { html, container, errors } = await serverThenHydrated(plot());
    expect(html).toContain("plot__x--wide");
    expect(html).toContain("plot__x--narrow");
    const wide = container.querySelector(".plot__x--wide")!;
    const narrow = container.querySelector(".plot__x--narrow")!;
    expect(texts(wide.children)).toEqual(["Sep 22", "Sep 27", "Oct 2", "Oct 7", "Oct 12", "Oct 17"]);
    expect(texts(narrow.children)).toEqual(["Sep 27", "Oct 7", "Oct 17"]);
    expect(wide.children).toHaveLength(6);
    expect(narrow.children).toHaveLength(3);
    for (const label of [...wide.children, ...narrow.children]) expect(label.textContent).not.toMatch(/so far/i);
    for (const set of [wide, narrow]) {
      expect(set.classList.contains("plot__x")).toBe(true);
      expect(set.getAttribute("aria-hidden")).toBe("true");
    }
    expect(errors).toEqual([]);
  });

  it("puts a point's label on the point and a band's on the middle of the band", async () => {
    const points = await serverThenHydrated(plot());
    const left = (set: string) => Array.from(points.container.querySelectorAll<HTMLElement>(`.${set} > *`), (label) => label.style.left);
    expect(left("plot__x--wide")[5]).toBe("100%");
    expect(left("plot__x--wide")[0]).toBe("13.79%");
    cleanup();

    const bands = await serverThenHydrated(plot({ placement: "bands" }));
    const wide = Array.from(bands.container.querySelectorAll<HTMLElement>(".plot__x--wide > *"), (label) => label.style.left);
    expect(wide[5]).toBe("98.33%");
    expect(wide[0]).toBe("15%");
  });

  it("labels an axis of hours with the time", async () => {
    const hours: TimeAxis = { unit: "hour", buckets: Array.from({ length: 6 }, (_, i) => `2026-10-17T${String(12 + i).padStart(2, "0")}:00:00Z`) };
    const { container } = await serverThenHydrated(plot({ axis: hours }));
    expect(texts(container.querySelector(".plot__x--wide")!.children)).toEqual(["12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);
  });

  it("is not a scroll region by default: the plot has no width of its own", async () => {
    const { container, errors } = await serverThenHydrated(plot());
    expect(container.querySelector('[role="region"]')).toBeNull();
    expect(container.querySelector(".plot__scroll")!.hasAttribute("tabindex")).toBe(false);
    expect(container.querySelector<HTMLElement>(".plot")!.style.minWidth).toBe("");
    expect(errors).toEqual([]);
  });

  it("gives slots a plot as wide as its buckets at 5 px each, inside a region a keyboard can scroll", async () => {
    const { html, container, errors } = await serverThenHydrated(plot({ slots: true }));
    const region = container.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("aria-label")).toBe("Transactions, scrollable chart");
    expect(region.classList.contains("plot__scroll")).toBe(true);
    const inner = region.querySelector<HTMLElement>(".plot")!;
    expect(inner.style.minWidth).toBe("150px");
    expect(html).toContain("min-width:150px");
    // The y labels stay where they are when the plot scrolls.
    expect(region.querySelector(".plot__y")).toBeNull();
    expect(region.querySelector(".plot__x--wide")).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("sizes that plot for the buckets of the axis", async () => {
    const days90: TimeAxis = { unit: "day", buckets: Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 6, 20 + i)).toISOString().slice(0, 10)) };
    const { container } = await serverThenHydrated(plot({ slots: true, axis: days90 }));
    expect(container.querySelector<HTMLElement>(".plot")!.style.minWidth).toBe("450px");
  });

  it("shows the empty text, centred, when it is given", async () => {
    const { container, errors } = await serverThenHydrated(plot({ empty: "No data for these 30 days" }));
    const text = container.querySelector(".plot__empty")!;
    expect(text.textContent).toBe("No data for these 30 days");
    expect(text.closest(".plot")).not.toBeNull();
    // The grid and the labels stay: the empty plot is an axis with nothing on it.
    expect(container.querySelectorAll(".plot__grid")).toHaveLength(5);
    expect(errors).toEqual([]);
  });

  it("shows no empty text when there is none to show", async () => {
    for (const empty of [undefined, null, ""]) {
      const { container } = await serverThenHydrated(plot({ empty }));
      expect(container.querySelector(".plot__empty"), String(empty)).toBeNull();
      cleanup();
    }
  });

  it("puts the y labels on the right of the plot for yAxis right, and on the left otherwise", async () => {
    const right = await serverThenHydrated(plot({ yAxis: "right" }));
    const scroll = right.container.querySelector(".plot__scroll")!;
    expect(scroll.nextElementSibling?.classList.contains("plot__y")).toBe(true);
    expect(scroll.previousElementSibling).toBeNull();
    expect(right.errors).toEqual([]);
    cleanup();

    const left = await serverThenHydrated(plot());
    const scrollLeft = left.container.querySelector(".plot__scroll")!;
    expect(scrollLeft.previousElementSibling?.classList.contains("plot__y")).toBe(true);
    expect(scrollLeft.nextElementSibling).toBeNull();
  });

  it("gives the end labels a gutter of their own after the plot, hidden from assistive technology", async () => {
    const { container, errors } = await serverThenHydrated(plot({ endLabels: <span className="end-stub">45.5M payments</span> }));
    const end = container.querySelector<HTMLElement>(".plot__end")!;
    expect(end.getAttribute("aria-hidden")).toBe("true");
    expect(end.textContent).toBe("45.5M payments");
    expect(end.style.width).toBe(`${END_LABEL_GUTTER_PX}px`);
    expect(end.previousElementSibling?.classList.contains("plot__scroll")).toBe(true);
    expect(end.closest(".plot")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("has no end gutter without end labels", async () => {
    const { container } = await serverThenHydrated(plot());
    expect(container.querySelector(".plot__end")).toBeNull();
  });

  it("wears the height class of its kind on the frame, so that the gutters have it too: the chart has none", async () => {
    const frame = (result: { container: HTMLElement }) => result.container.querySelector(".plot__frame")!.className;
    expect(frame(await serverThenHydrated(plot()))).toBe("plot__frame");
    cleanup();
    expect(frame(await serverThenHydrated(plot({ height: "pane" })))).toBe("plot__frame plot__frame--pane");
    cleanup();
    expect(frame(await serverThenHydrated(plot({ height: "panel" })))).toBe("plot__frame plot__frame--panel");
  });
});

describe("Plot's cursor", () => {
  const cursor = { count: 30, placement: "points" as const, label: "Transactions, day by day", valueText: (i: number) => `bucket ${i}` };

  it("is not in the Worker's HTML, and is in the browser's page once it has taken over", async () => {
    const { html, container, errors } = await serverThenHydrated(plot({ cursor }));
    expect(html).not.toContain('role="slider"');
    const slider = container.querySelector('[role="slider"]')!;
    expect(slider).not.toBeNull();
    expect(slider.getAttribute("aria-label")).toBe("Transactions, day by day");
    // Over the plot, beside the image box and not in it, and on the plot's own box.
    expect(slider.parentElement).toBe(container.querySelector(".plot"));
    expect(slider.closest('[role="img"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it("has no cursor without one being asked for", async () => {
    const { container } = await serverThenHydrated(plot());
    expect(container.querySelector('[role="slider"]')).toBeNull();
  });

  it("has none over an empty plot: there is nothing to read", async () => {
    const { container } = await serverThenHydrated(plot({ cursor, empty: "No data for these 30 days" }));
    expect(container.querySelector('[role="slider"]')).toBeNull();
  });
});

describe("Plot's tooltip, drawn outside the region that scrolls", () => {
  const box = (left: number, width: number) =>
    ({ left, right: left + width, top: 0, bottom: 200, width, height: 200, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  const mouse = (x: number) => ({ clientX: x, pointerType: "mouse" });
  const finger = (x: number) => ({ clientX: x, pointerType: "touch" });
  const TIP_WIDTH = 260;

  const cursor = {
    count: 30,
    placement: "points" as const,
    label: "Transactions, day by day",
    valueText: (i: number) => `bucket ${i}`,
    tooltip: (i: number) => <b>{`bucket ${i}`}</b>,
  };

  /** A plot of `slots` in a region `view` px wide that is scrolled to show the part of a 450 px plot that starts `scrolled` px in. */
  async function scrolled({ scrolled: offset = 120, view = 280, extra = {} }: { scrolled?: number; view?: number; extra?: Partial<PlotProps> } = {}) {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("plot__tip") ? TIP_WIDTH : 0;
    });
    const result = await serverThenHydrated(plot({ slots: true, cursor, ...extra }));
    const find = (selector: string) => result.container.querySelector<HTMLElement>(selector)!;
    // The frame starts at 0, the region 10 px in (the y labels), and the plot is the width of 90 buckets at 5 px, `offset` px of it scrolled out.
    vi.spyOn(find(".plot__frame"), "getBoundingClientRect").mockReturnValue(box(0, 10 + view));
    vi.spyOn(find(".plot__scroll"), "getBoundingClientRect").mockReturnValue(box(10, view));
    const plotBox = vi.spyOn(find(".plot"), "getBoundingClientRect").mockReturnValue(box(10 - offset, 450));
    const tip = () => result.container.querySelector<HTMLElement>(".plot__tip");
    /** The tooltip's left and right edges: where the class puts it from `left`, and the shift that keeps it in view. */
    const edges = () => {
      const bubble = tip()!;
      const anchor = parseFloat(bubble.style.left);
      const natural = bubble.classList.contains("right") ? anchor + 8 : bubble.classList.contains("left") ? anchor - 8 - TIP_WIDTH : anchor - TIP_WIDTH / 2;
      const start = natural + parseFloat(bubble.style.marginLeft);
      return [start, start + TIP_WIDTH];
    };
    return { ...result, find, tip, edges, plotBox, slider: () => find('[role="slider"]'), at: (i: number) => 10 - offset + (i / 29) * 450 };
  }

  it("is in the frame, beside the region and not in it, so that the region cannot clip it, and is hidden from assistive technology", async () => {
    const { slider, tip, find, errors } = await scrolled();
    expect(tip()).toBeNull();
    fireEvent.pointerMove(slider(), mouse(100));
    const bubble = tip()!;
    expect(bubble.textContent).toBe("bucket 14");
    expect(bubble.getAttribute("aria-hidden")).toBe("true");
    expect(bubble.parentElement).toBe(find(".plot__frame"));
    expect(bubble.closest(".plot__scroll")).toBeNull();
    // Not a second one inside the cursor.
    expect(find(".plot__cursor").querySelector(".plot__tip")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("leaves with the pointer, and when the plot has no tooltip there is none", async () => {
    const { slider, tip } = await scrolled();
    fireEvent.pointerMove(slider(), mouse(100));
    fireEvent.pointerLeave(slider(), mouse(100));
    expect(tip()).toBeNull();

    cleanup();
    const without = await scrolled({ extra: { cursor: { ...cursor, tooltip: undefined } } });
    fireEvent.pointerMove(without.slider(), mouse(100));
    expect(without.tip()).toBeNull();
  });

  it("takes its side from the part of the plot in view: a bucket at the left edge of the region opens to the right, though it is 28% in", async () => {
    const { slider, tip, at, edges } = await scrolled();
    // Bucket 8 is 8/29 = 27.6% along the whole plot, which has it centred, and 15 px in from the region's edge.
    fireEvent.pointerMove(slider(), mouse(12));
    expect(slider().getAttribute("aria-valuenow")).toBe("8");
    expect(at(8)).toBeCloseTo(14.14, 1);
    expect(tip()!.classList.contains("right")).toBe(true);
    expect(tip()!.classList.contains("center")).toBe(false);
    const [start, end] = edges();
    expect(start).toBeGreaterThanOrEqual(10);
    expect(end).toBeLessThanOrEqual(290);
  });

  it("keeps a centred tooltip inside the region when the bucket is close to its edge", async () => {
    const { slider, tip, edges, at } = await scrolled();
    fireEvent.pointerMove(slider(), mouse(100));
    // Bucket 14 is at 107 px: a tooltip of 260 px centred on it would start 23 px left of the region.
    expect(slider().getAttribute("aria-valuenow")).toBe("14");
    expect(at(14)).toBeCloseTo(107.24, 1);
    expect(tip()!.classList.contains("center")).toBe(true);
    const [start, end] = edges();
    expect(start).toBeCloseTo(10, 5);
    expect(end).toBeLessThanOrEqual(290);
    expect(parseFloat(tip()!.style.left)).toBeCloseTo(107.24, 1);
  });

  it("keeps a tooltip that opens to the left inside the region too", async () => {
    const { slider, tip, edges } = await scrolled();
    fireEvent.pointerMove(slider(), mouse(232));
    // Bucket 22 is 79% of the way across what is in view: it opens to the left, and 260 px of room for it is not there.
    expect(slider().getAttribute("aria-valuenow")).toBe("22");
    expect(tip()!.classList.contains("left")).toBe(true);
    const [start, end] = edges();
    expect(start).toBeGreaterThanOrEqual(10);
    expect(end).toBeLessThanOrEqual(290);
  });

  it("does not move a tooltip that fits: no shift", async () => {
    const { slider, tip } = await scrolled({ scrolled: 0, view: 450 });
    fireEvent.pointerMove(slider(), mouse(10 + 225));
    expect(parseFloat(tip()!.style.marginLeft)).toBeCloseTo(0, 5);
    expect(tip()!.classList.contains("center")).toBe(true);
  });

  it("is placed by the plot's own box for a plot that does not scroll", async () => {
    const result = await serverThenHydrated(plot({ cursor }));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("plot__tip") ? TIP_WIDTH : 0;
    });
    const find = (selector: string) => result.container.querySelector<HTMLElement>(selector)!;
    vi.spyOn(find(".plot__frame"), "getBoundingClientRect").mockReturnValue(box(0, 330));
    vi.spyOn(find(".plot__scroll"), "getBoundingClientRect").mockReturnValue(box(30, 300));
    vi.spyOn(find(".plot"), "getBoundingClientRect").mockReturnValue(box(30, 300));
    // 25% along a plot of 300 px: the side is a right one by the 22% rule only above that, so it is centred, and 260 px do not fit.
    fireEvent.pointerMove(find('[role="slider"]'), mouse(30 + 75));
    const bubble = find(".plot__tip");
    const anchor = parseFloat(bubble.style.left);
    const start = anchor - TIP_WIDTH / 2 + parseFloat(bubble.style.marginLeft);
    expect(bubble.classList.contains("center")).toBe(true);
    expect(start).toBeGreaterThanOrEqual(30);
    expect(start + TIP_WIDTH).toBeLessThanOrEqual(330);
  });

  it("follows the bucket when the region scrolls under a tooltip that a touch kept", async () => {
    const { slider, tip, find, plotBox } = await scrolled();
    fireEvent.pointerDown(slider(), finger(100));
    fireEvent.pointerUp(slider(), finger(100));
    const before = tip()!.style.left;
    plotBox.mockReturnValue(box(10 - 60, 450));
    fireEvent.scroll(find(".plot__scroll"));
    expect(tip()!.style.left).not.toBe(before);
    expect(parseFloat(tip()!.style.left)).toBeCloseTo(10 - 60 + (14 / 29) * 450, 1);
    // And it stops listening when the tooltip is gone.
    fireEvent.pointerDown(document.body, finger(0));
    expect(tip()).toBeNull();
  });
});

describe("Plot's ring after a change (spec 2.9)", () => {
  it("is not there on the server's render, on hydration, or after a render with the same token", async () => {
    const { html, container, errors } = await serverThenHydrated(plot());
    expect(html).not.toContain("is-changed");
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    expect(errors).toEqual([]);

    const { container: client, rerender } = render(plot());
    expect(client.querySelector(".plot.is-changed")).toBeNull();
    rerender(plot());
    rerender(plot({ summary: "A new summary, the same token." }));
    expect(client.querySelector(".plot.is-changed")).toBeNull();
  });

  it("is on the plot, once, when the token changes after the first render", () => {
    const { container, rerender } = render(plot({ token: "a" }));
    rerender(plot({ token: "b" }));
    expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(1);
    // It stays a plot like any other: the ring is the class's animation, which runs once.
    expect(container.querySelectorAll(".plot")).toHaveLength(1);
  });

  it("does not remake the marks: the plot is redrawn in place", () => {
    const { container, rerender } = render(plot({ token: "a" }));
    const first = container.querySelector(".stub-mark")!;
    const frame = container.querySelector(".plot")!;
    rerender(plot({ token: "b" }));
    expect(container.querySelector(".stub-mark")).toBe(first);
    expect(container.querySelector(".plot")).toBe(frame);
  });

  it("is run again for each change that follows, by taking the class off, letting the browser see it off, and putting it back", () => {
    // The class stays after the first change, and a finished animation cannot be restarted through `getAnimations()` (it is no longer
    // there to ask for), so the restart is the class itself: off, a reflow, on.
    const seen: boolean[] = [];
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("plot")) seen.push(this.classList.contains("is-changed"));
      return 0;
    });
    const { container, rerender } = render(plot({ token: "a" }));
    rerender(plot({ token: "b" }));
    // The first change starts the animation by itself, with the class.
    expect(seen).toEqual([]);
    rerender(plot({ token: "b", summary: "another summary" }));
    expect(seen).toEqual([]);
    rerender(plot({ token: "c" }));
    expect(seen).toEqual([false]);
    expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(1);
    rerender(plot({ token: "d" }));
    expect(seen).toEqual([false, false]);
    expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(1);
  });

  it("has the class on again when the effect is done, as React left it: the next render does not disturb it", () => {
    const { container, rerender } = render(plot({ token: "a" }));
    rerender(plot({ token: "b" }));
    rerender(plot({ token: "c" }));
    expect(container.querySelector(".plot")!.className).toBe("plot is-changed");
    rerender(plot({ token: "c", summary: "another summary" }));
    expect(container.querySelector(".plot")!.className).toBe("plot is-changed");
  });
});

describe("usePlotMark and useHydrated", () => {
  function Mark({ token }: { token: string }) {
    return <output>{String(usePlotMark(token))}</output>;
  }

  it("usePlotMark is false until the token changes after mount, then true", () => {
    const { container, rerender } = render(<Mark token="a" />);
    expect(container.textContent).toBe("false");
    rerender(<Mark token="a" />);
    expect(container.textContent).toBe("false");
    rerender(<Mark token="b" />);
    expect(container.textContent).toBe("true");
    rerender(<Mark token="b" />);
    expect(container.textContent).toBe("true");
  });

  function Hydrated() {
    return <output>{String(useHydrated())}</output>;
  }

  it("useHydrated is false in the Worker's HTML and during hydration, and true after", async () => {
    expect(renderToString(<Hydrated />)).toContain("false");
    const { html, container, errors } = await serverThenHydrated(<Hydrated />);
    expect(html).toContain("false");
    expect(container.textContent).toBe("true");
    expect(errors).toEqual([]);
  });
});
