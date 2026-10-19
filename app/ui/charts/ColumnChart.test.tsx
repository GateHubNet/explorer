import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ChartTable } from "./ChartTable";
import { ColumnChart } from "./ColumnChart";
import type { TimeAxis, TimeSeriesData } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Columns in their three layouts (spec 2.2, 2.6, 2.8, 2.9 and 2.11): HTML boxes in percent of the plot, so the Worker prints the finished
// chart. A stack is its exact total in percent of the scale and each segment its exact share of the stack; a diverging column goes up and
// down from the zero line of a symmetric scale. The cursor, with the tooltip and the slider's words, comes with the script.

const TITLE = "Transactions by type, per day";

/** 30 days, Sep 18 to Oct 17, 2026: bucket 3 is Sep 21, bucket 15 is Oct 3 and bucket 29 is Oct 17. */
const day = (i: number) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10);
const AXIS: TimeAxis = { unit: "day", buckets: Array.from({ length: 30 }, (_, i) => day(i)) };

type Pair = [string | null, string | null];

/** What the view builder hands over: two series, and the exact total of each bucket. A bucket is `["2", "1"]` unless `cells` says another. */
function stacked(cells: Record<number, Pair> = {}, extra: Partial<TimeSeriesData> = {}): TimeSeriesData {
  const pairs = AXIS.buckets.map((_, i): Pair => cells[i] ?? ["2", "1"]);
  const total = ([a, b]: Pair) => (a === null && b === null ? null : String(Number(a ?? 0) + Number(b ?? 0)));
  return {
    axis: AXIS,
    series: [
      { id: "Payment", label: "Payment", slot: 1, values: pairs.map(([a]) => a) },
      { id: "OfferCreate", label: "OfferCreate", slot: 2, values: pairs.map(([, b]) => b) },
    ],
    totals: pairs.map(total),
    format: { kind: "count", unit: "transactions" },
    forming: true,
    token: "t1",
    ...extra,
  };
}

/** Bucket 12 totals 18, so the top tick is 20; bucket 29 is `["10", "5"]`, which is 15 of 20. */
const STACKED = stacked({ 12: ["12", "6"], 29: ["10", "5"] });

/** Money in and out: both are magnitudes, and `totals` is the net. */
function diverging(cells: Record<number, Pair> = {}, extra: Partial<TimeSeriesData> = {}): TimeSeriesData {
  const data = stacked({ 0: ["4", "3"], ...cells });
  const [received, sent] = [data.series[0]!.values, data.series[1]!.values];
  return {
    ...data,
    series: [
      { id: "in", label: "Received", slot: "up", values: received },
      { id: "out", label: "Sent", slot: "down", values: sent },
    ],
    totals: received.map((value, i) => (value === null || sent[i] === null ? null : String(Number(value) - Number(sent[i])))),
    ...extra,
  };
}

/** One series of counts: 3 everywhere and 15 on the last day. */
function single(extra: Partial<TimeSeriesData> = {}): TimeSeriesData {
  return {
    axis: AXIS,
    series: [{ id: "swaps", label: "Swaps", slot: 3, values: AXIS.buckets.map((_, i) => (i === 29 ? "15" : i === 12 ? "20" : "3")) }],
    format: { kind: "count", unit: "transactions" },
    forming: true,
    token: "s1",
    ...extra,
  };
}

const bar = (container: HTMLElement, bucket: number) => container.querySelector<HTMLElement>(`.col[data-bucket="${bucket}"] > .col__bar`);
const segs = (container: HTMLElement, bucket: number) =>
  Array.from(container.querySelectorAll<HTMLElement>(`.col[data-bucket="${bucket}"] .col__seg`));
const slider = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="slider"]')!;
const tip = (container: HTMLElement) => container.querySelector<HTMLElement>(".plot__tip");
const texts = (nodes: ArrayLike<Element>) => Array.from(nodes, (node) => node.textContent);
/** What the tooltip says: its date, then one text for each row, the total line and each note. */
const lines = (container: HTMLElement) =>
  Array.from(tip(container)!.querySelectorAll(".plot__tip-date, .plot__tip-row, .plot__tip-total, .plot__tip-note"), (line) => line.textContent);

/** Puts the cursor on bucket `i` with the keyboard: a focus selects the newest, Home goes to the first. */
function goTo(container: HTMLElement, i: number) {
  fireEvent.focus(slider(container));
  if (i === 29) return;
  fireEvent.keyDown(slider(container), { key: "Home" });
  for (let k = 0; k < i; k += 1) fireEvent.keyDown(slider(container), { key: "ArrowRight" });
}

const BOX = { left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

describe("ColumnChart as the Worker prints it and the browser takes it over", () => {
  it("draws a column for each bucket in the HTML, a stack as high as its total in percent of the scale, and no slider", async () => {
    const { html, container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    expect(html).not.toContain('role="slider"');
    expect(html.match(/class="col"/g)).toHaveLength(30);
    expect(html).toContain("col__bar");
    const cols = container.querySelectorAll(".col");
    expect(cols).toHaveLength(30);
    expect(Array.from(cols, (col) => col.getAttribute("data-bucket"))).toEqual(Array.from({ length: 30 }, (_, i) => String(i)));
    // 3 of 20, 18 of 20 and 15 of 20.
    expect(Array.from(cols, (_, i) => bar(container, i)!.style.height)).toEqual(
      Array.from({ length: 30 }, (_, i) => (i === 12 ? "90%" : i === 29 ? "75%" : "15%")),
    );
    expect(errors).toEqual([]);
  });

  it("scales from 0 to the nice tick over the largest total, and draws the plot as columns: bands, in a region that scrolls", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    expect(texts(container.querySelector(".plot__y")!.children)).toEqual(["0", "5", "10", "15", "20"]);
    expect(container.querySelector('[role="region"]')!.getAttribute("aria-label")).toBe("Transactions by type, per day, scrollable chart");
    // A band's label is at the middle of its band: the newest of 30 is at 98.33%.
    expect(Array.from(container.querySelectorAll<HTMLElement>(".plot__x--wide > *"), (label) => label.style.left).at(-1)).toBe("98.33%");
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe(
      "Transactions by type, per day, Sep 18 to Oct 17, 2026. Highest Sep 30, 18; latest Oct 17, so far, 15. Choose Table for every value.",
    );
    expect(errors).toEqual([]);
  });

  it("lays the columns out in the plot's own row class, which no page's columns share", async () => {
    // `.cols`, a page's columns, was the kit's row too, and over the kit's rule it made every column 0 px high on a real page (charts.css has
    // the rule of the plot's own, and test/unit/charts-css.test.ts that the pages' sheet does not share a class with it).
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    expect(container.querySelectorAll(".plot__cols > .col")).toHaveLength(30);
    expect(container.querySelector(".cols")).toBeNull();
  });

  it("is one image of marks that a screen reader does not enter: the columns are hidden inside it", async () => {
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    for (const col of container.querySelectorAll(".col")) expect(col.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="img"] .col')).toHaveLength(30);
  });
});

describe("ColumnChart, stacked", () => {
  it("stacks bucket 29's 10 and 5 as 66.667% and 33.333% of a stack that is 75% of the plot, the first series at the bottom", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    expect(bar(container, 29)!.style.height).toBe("75%");
    const parts = segs(container, 29);
    expect(parts.map((part) => part.style.height)).toEqual(["66.667%", "33.333%"]);
    // Bottom up in the DOM: the stack is drawn from its end, so the first child is the lowest.
    expect(parts.map((part) => part.getAttribute("data-slot"))).toEqual(["1", "2"]);
    expect(parts.every((part) => part.parentElement === bar(container, 29))).toBe(true);
    expect(errors).toEqual([]);
  });

  it("colours each segment by its series' slot", async () => {
    const data = stacked({}, {
      series: [
        { id: "a", label: "A", slot: 4, values: AXIS.buckets.map(() => "1") },
        { id: "b", label: "B", slot: "other", values: AXIS.buckets.map(() => "1") },
        { id: "c", label: "C", slot: 2, values: AXIS.buckets.map(() => "1") },
      ],
      totals: AXIS.buckets.map(() => "3"),
    });
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    expect(segs(container, 0).map((part) => part.getAttribute("data-slot"))).toEqual(["4", "other", "2"]);
    expect(segs(container, 0).map((part) => part.style.height)).toEqual(["33.333%", "33.333%", "33.333%"]);
  });

  it("draws no segment for a series with nothing in the bucket, so that the highest drawn is the last child, the one with no inset", async () => {
    const data = stacked({ 5: ["7", "0"], 6: ["0", "4"], 7: [null, "4"], 8: ["0", "0"] });
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    expect(segs(container, 5).map((part) => [part.getAttribute("data-slot"), part.style.height])).toEqual([["1", "100%"]]);
    expect(segs(container, 6).map((part) => [part.getAttribute("data-slot"), part.style.height])).toEqual([["2", "100%"]]);
    expect(segs(container, 7).map((part) => part.getAttribute("data-slot"))).toEqual(["2"]);
    // A bucket whose series are all 0 is a stack of height 0.
    expect(bar(container, 8)!.style.height).toBe("0%");
    expect(segs(container, 8)).toEqual([]);
  });

  it("puts an annotation's symbol above its column, in the note of that bucket only", async () => {
    const data = stacked({ 12: ["12", "6"] }, { annotations: [{ bucket: 3, symbol: "×", label: "has a failed transaction" }] });
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    const notes = container.querySelectorAll(".col__note");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe("×");
    expect(notes[0]!.closest(".col")!.getAttribute("data-bucket")).toBe("3");
    // At the top of its stack: 3 of 20 (the bar is 15% of the plot), and the note rests on it.
    expect(bar(container, 3)!.style.height).toBe("15%");
    expect((notes[0] as HTMLElement).style.getPropertyValue("--top")).toBe("15%");
    expect(errors).toEqual([]);
  });

  it("puts two symbols of one bucket side by side, ignores a bucket that is not on the axis, and rests the note of a bucket with no bar at the base", async () => {
    const data = stacked({ 4: [null, null] }, {
      annotations: [
        { bucket: 3, symbol: "×", label: "has a failed transaction" },
        { bucket: 3, symbol: "!", label: "is a spike" },
        { bucket: 4, symbol: "×", label: "has a failed transaction" },
        { bucket: 30, symbol: "×", label: "has a failed transaction" },
        { bucket: -1, symbol: "×", label: "has a failed transaction" },
      ],
    });
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    expect(texts(container.querySelectorAll(".col__note"))).toEqual(["×!", "×"]);
    expect(container.querySelector<HTMLElement>('.col[data-bucket="4"] .col__note')!.style.getPropertyValue("--top")).toBe("0%");
  });
});

describe("ColumnChart, single", () => {
  it("draws one bar for each bucket in --series-1 whatever the slot the series was given, with no segments", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="single" title="Swaps, per day" data={single()} />);
    // 20 is the largest: 0 to 20 by 5.
    expect(texts(container.querySelector(".plot__y")!.children)).toEqual(["0", "5", "10", "15", "20"]);
    expect(bar(container, 0)!.style.height).toBe("15%");
    expect(bar(container, 12)!.style.height).toBe("100%");
    expect(bar(container, 29)!.style.height).toBe("75%");
    expect(Array.from(container.querySelectorAll(".col__bar"), (b) => b.getAttribute("data-slot"))).toEqual(Array(30).fill("1"));
    expect(container.querySelector(".col__seg")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("uses the first series only, and the stack's total is not asked for", async () => {
    const data = single({ series: [...single().series, { id: "x", label: "X", slot: 2, values: AXIS.buckets.map(() => "100") }], totals: AXIS.buckets.map(() => "999") });
    const { container } = await serverThenHydrated(<ColumnChart layout="single" title="Swaps, per day" data={data} />);
    expect(texts(container.querySelector(".plot__y")!.children)).toEqual(["0", "5", "10", "15", "20"]);
    goTo(container, 29);
    expect(lines(container)).toEqual(["Oct 17, 2026, so far", "15 Swaps"]);
  });
});

describe("ColumnChart, diverging", () => {
  it("draws the first series up in --up and the second down in --down from the zero line, on a scale that is the same on both sides", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="diverging" title="Money in and out, per day" data={diverging()} />);
    // 4 is the largest magnitude: the ticks are mirrored about 0 and the top one is at or above 4.
    expect(texts(container.querySelector(".plot__y")!.children)).toEqual(["−4", "−2", "0", "2", "4"]);
    expect(container.querySelectorAll<HTMLElement>(".plot__grid")[0]!.style.bottom).toBe("0%");
    const zero = container.querySelector<HTMLElement>(".plot__grid.is-base")!;
    expect(zero.style.bottom).toBe("50%");

    const up = container.querySelector<HTMLElement>('.col[data-bucket="0"] .col__bar[data-slot="up"]')!;
    const down = container.querySelector<HTMLElement>('.col[data-bucket="0"] .col__bar.col__bar--down[data-slot="down"]')!;
    // 4 above the zero line and 3 below it, of 8 in all: the up bar stands on the middle, the down bar hangs from it.
    expect([up.style.bottom, up.style.height]).toEqual(["50%", "50%"]);
    expect([down.style.bottom, down.style.height]).toEqual(["12.5%", "37.5%"]);
    expect(up.classList.contains("col__bar--down")).toBe(false);
    // The others: 2 up and 1 down.
    const small = container.querySelector<HTMLElement>('.col[data-bucket="9"] .col__bar[data-slot="down"]')!;
    expect([small.style.bottom, small.style.height]).toEqual(["37.5%", "12.5%"]);
    expect(container.querySelectorAll(".col__bar")).toHaveLength(60);
    expect(container.querySelector(".col__seg")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("draws only the side that has a value, and a zero as a bar of height 0", async () => {
    const data = diverging({ 5: ["6", null], 6: [null, "5"], 7: ["0", "0"] });
    const { container } = await serverThenHydrated(<ColumnChart layout="diverging" title="Money in and out, per day" data={data} />);
    const sides = (i: number) => Array.from(container.querySelectorAll<HTMLElement>(`.col[data-bucket="${i}"] .col__bar`), (b) => `${b.getAttribute("data-slot")} ${b.style.height}`);
    // The largest is 6, so the scale is −10 to 10 (by 5): 6 is 30% of the plot's height, 5 is 25%.
    expect(sides(5)).toEqual(["up 30%"]);
    expect(sides(6)).toEqual(["down 25%"]);
    expect(sides(7)).toEqual(["up 0%", "down 0%"]);
  });

  it("lists Received, Sent and, from totals, the net in the tooltip", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="diverging" title="Money in and out, per day" data={diverging()} />);
    goTo(container, 0);
    expect(lines(container)).toEqual(["Sep 18, 2026", "4 Received", "3 Sent", "Net 1"]);
    expect(Array.from(tip(container)!.querySelectorAll(".plot__tip-key"), (key) => key.getAttribute("data-slot"))).toEqual(["up", "down"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Sep 18, 2026: Received 4; Sent 3; Net 1");
    expect(errors).toEqual([]);
  });

  it("says no net when totals are not given: the kit does no arithmetic", async () => {
    const { container } = await serverThenHydrated(<ColumnChart layout="diverging" title="Money in and out, per day" data={diverging({}, { totals: undefined })} />);
    goTo(container, 0);
    expect(lines(container)).toEqual(["Sep 18, 2026", "4 Received", "3 Sent"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Sep 18, 2026: Received 4; Sent 3");
  });
});

describe("ColumnChart's cursor", () => {
  it("names its slider for the chart and the step, and says the newest bucket in full, with its total, its series and 'so far'", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    const control = slider(container);
    expect(control.getAttribute("aria-label")).toBe("Transactions by type, per day, day by day");
    expect(control.getAttribute("aria-valuemax")).toBe("29");
    expect(control.getAttribute("aria-valuenow")).toBe("29");
    expect(control.getAttribute("aria-valuetext")).toBe("Oct 17, 2026, so far: 15 transactions; Payment 10; OfferCreate 5");
    expect(control.closest('[role="img"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it("writes a count in full, an amount compact with its unit once, and a day that has closed without 'so far'", async () => {
    const counts = stacked({ 28: ["1204331", "80000"] }, { forming: false });
    const first = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={counts} />);
    goTo(first.container, 28);
    expect(slider(first.container).getAttribute("aria-valuetext")).toBe("Oct 16, 2026: 1,284,331 transactions; Payment 1,204,331; OfferCreate 80,000");
    cleanup();

    const money: TimeSeriesData = single({
      series: [{ id: "v", label: "Swap volume", slot: 1, values: AXIS.buckets.map(() => "45500000") }],
      format: { kind: "amount", unit: "XRP" },
    });
    const second = await serverThenHydrated(<ColumnChart layout="single" title="Swap volume, per day" data={money} />);
    expect(slider(second.container).getAttribute("aria-valuetext")).toBe("Oct 17, 2026, so far: 45.5M XRP");
    goTo(second.container, 29);
    expect(lines(second.container)).toEqual(["Oct 17, 2026, so far", "45.5M XRP Swap volume"]);
  });

  it("is on the bucket under a pointer: the plot says which, and that column is the active mark", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    const plot = container.querySelector<HTMLElement>(".plot")!;
    vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(BOX);
    expect(plot.hasAttribute("data-active")).toBe(false);
    fireEvent.pointerMove(slider(container), { clientX: 500, pointerType: "mouse" });
    expect(plot.getAttribute("data-active")).toBe("15");
    expect(Array.from(container.querySelectorAll(".col.is-active"), (col) => col.getAttribute("data-bucket"))).toEqual(["15"]);
    fireEvent.pointerLeave(slider(container), { clientX: 500, pointerType: "mouse" });
    expect(plot.hasAttribute("data-active")).toBe(false);
    expect(container.querySelector(".col.is-active")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("draws no crosshair and no dots: the column is the hover state", async () => {
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    goTo(container, 29);
    expect(container.querySelector(".plot__crosshair")).toBeNull();
    expect(container.querySelector(".plot__dot")).toBeNull();
  });

  it("shows a tooltip with the date, a row for each series, with its key, the value and the name, and the total", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    expect(tip(container)).toBeNull();
    goTo(container, 29);
    expect(lines(container)).toEqual(["Oct 17, 2026, so far", "10 Payment", "5 OfferCreate", "15 total"]);
    const bubble = tip(container)!;
    expect(bubble.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(bubble.querySelectorAll(".plot__tip-key"), (key) => key.getAttribute("data-slot"))).toEqual(["1", "2"]);
    expect(Array.from(bubble.querySelectorAll(".plot__tip-row b"), (value) => value.textContent)).toEqual(["10", "5"]);
    expect(bubble.querySelector(".plot__tip-total b")!.textContent).toBe("15");
    expect(errors).toEqual([]);
  });

  it("has no total line when the data has no total for the bucket, and a dash for a series with no value in a bucket that has others", async () => {
    const data = stacked({ 29: ["10", null] }, { totals: AXIS.buckets.map((_, i) => (i === 29 ? null : "3")) });
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    goTo(container, 29);
    expect(lines(container)).toEqual(["Oct 17, 2026, so far", "10 Payment", "— OfferCreate"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 17, 2026, so far: Payment 10");
    // The stack is the one segment.
    expect(segs(container, 29).map((part) => part.style.height)).toEqual(["100%"]);
  });

  it("tells of an annotation in the tooltip and to the slider, since the symbol is a picture", async () => {
    const data = stacked({}, { annotations: [{ bucket: 3, symbol: "×", label: "has a failed transaction" }] });
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    goTo(container, 3);
    expect(lines(container)).toEqual(["Sep 21, 2026", "2 Payment", "1 OfferCreate", "3 total", "× has a failed transaction"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Sep 21, 2026: 3 transactions; Payment 2; OfferCreate 1; has a failed transaction");
    goTo(container, 4);
    expect(lines(container)).not.toContain("× has a failed transaction");
  });

  it("has no cursor over an empty plot: there is nothing to read", async () => {
    const empty = stacked(Object.fromEntries(AXIS.buckets.map((_, i) => [i, [null, null] as Pair])));
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={empty} />);
    expect(container.querySelector('[role="slider"]')).toBeNull();
  });
});

describe("ColumnChart's states (spec 2.8)", () => {
  const CELLS: Record<number, Pair> = { 12: ["12", "6"], 29: ["10", "5"] };
  const withGap = (i: number, extra: Partial<TimeSeriesData> = {}) => stacked({ ...CELLS, [i]: [null, null] }, extra);

  it("leaves a null bucket's slot empty, and says 'No data for Oct 3' in the tooltip and to the slider", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={withGap(15)} />);
    // The slot is there, so that the cursor and the other marks line up; it has no bar.
    expect(container.querySelectorAll(".col")).toHaveLength(30);
    expect(bar(container, 15)).toBeNull();
    expect(container.querySelectorAll(".col__bar")).toHaveLength(29);
    goTo(container, 15);
    expect(lines(container)).toEqual(["No data for Oct 3"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 3, 2026: no data");
    expect(errors).toEqual([]);
  });

  it("says 'Not computed yet' for the newest bucket when it is pending", async () => {
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={withGap(29, { pending: 1 })} />);
    expect(bar(container, 29)).toBeNull();
    fireEvent.focus(slider(container));
    expect(lines(container)).toEqual(["Oct 17, 2026, so far", "Not computed yet"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 17, 2026, so far: not computed yet");
    // The bucket before it has its numbers.
    goTo(container, 28);
    expect(lines(container)).toEqual(["Oct 16, 2026", "2 Payment", "1 OfferCreate", "3 total"]);
    expect(errors).toEqual([]);
  });

  it("says 'No data' for a bucket that is not among the newest pending ones, whether or not some are pending", async () => {
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={withGap(28, { pending: 1 })} />);
    goTo(container, 28);
    expect(lines(container)).toEqual(["No data for Oct 16"]);
  });

  it("draws a zero as a bar of height 0, which the table says is 0", async () => {
    const data = stacked({ 10: ["0", "0"] });
    const { container, errors } = await serverThenHydrated(
      <>
        <ColumnChart layout="stacked" title={TITLE} data={data} />
        <ChartTable title={TITLE} data={data} />
      </>,
    );
    expect(bar(container, 10)!.style.height).toBe("0%");
    expect(segs(container, 10)).toEqual([]);
    goTo(container, 10);
    expect(lines(container)).toEqual(["Sep 28, 2026", "0 Payment", "0 OfferCreate", "0 total"]);
    const row = Array.from(container.querySelectorAll('[role="row"]'), (r) => Array.from(r.querySelectorAll('[role="cell"]'), (cell) => cell.textContent)).find(
      (cells) => cells[0] === "Sep 28, 2026",
    );
    expect(row).toEqual(["Sep 28, 2026", "0", "0", "0"]);
    expect(errors).toEqual([]);
  });

  it("says 'No data for these 30 days' in the middle of an axis from 0 to 4 when every bucket is null", async () => {
    const empty = stacked(Object.fromEntries(AXIS.buckets.map((_, i) => [i, [null, null] as Pair])));
    const none = single({ series: [{ ...single().series[0]!, values: AXIS.buckets.map(() => null) }] });
    for (const [layout, data] of [["single", none], ["stacked", empty], ["diverging", empty]] as const) {
      const { container, errors } = await serverThenHydrated(<ColumnChart layout={layout} title={TITLE} data={data} />);
      expect(container.querySelector(".plot__empty")!.textContent, layout).toBe("No data for these 30 days");
      expect(container.querySelector(".col__bar"), layout).toBeNull();
      const labels = texts(container.querySelector(".plot__y")!.children);
      // Counts have whole ticks; the two sides of a diverging scale are the same.
      expect(labels, layout).toEqual(layout === "diverging" ? ["−4", "−2", "0", "2", "4"] : ["0", "1", "2", "3", "4"]);
      expect(container.querySelectorAll(".plot__grid"), layout).toHaveLength(labels.length);
      expect(errors, layout).toEqual([]);
      cleanup();
    }
  });

  it("says 'No data' for an axis of no buckets", async () => {
    const data = stacked({}, { axis: { unit: "day", buckets: [] }, series: [{ id: "a", label: "A", slot: 1, values: [] }], totals: [] });
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    expect(container.querySelector(".plot__empty")!.textContent).toBe("No data");
    expect(container.querySelector('[role="slider"]')).toBeNull();
  });

  it("never says 'so far' on the axis, only in the tooltip and to the slider", async () => {
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    for (const label of container.querySelectorAll(".plot__x span")) expect(label.textContent).not.toMatch(/so far/);
    expect(container.querySelector(".plot__x")!.textContent).toContain("Oct 17");
    expect(slider(container).getAttribute("aria-valuetext")).toMatch(/so far/);
  });

  it("does not say 'so far' of a bucket that is not the running one", async () => {
    const { container } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    goTo(container, 28);
    expect(lines(container)[0]).toBe("Oct 16, 2026");
  });
});

describe("ColumnChart's density (spec 2.7)", () => {
  it("makes a plot of 90 buckets 450 px wide at least, in a region that a keyboard can scroll", async () => {
    const buckets = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 6, 20 + i)).toISOString().slice(0, 10));
    const data: TimeSeriesData = {
      axis: { unit: "day", buckets },
      series: [{ id: "p", label: "Payment", slot: 1, values: buckets.map(() => "2") }, { id: "o", label: "OfferCreate", slot: 2, values: buckets.map(() => "1") }],
      totals: buckets.map(() => "3"),
      format: { kind: "count", unit: "transactions" },
      token: "d90",
    };
    const { html, container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    expect(container.querySelectorAll(".col")).toHaveLength(90);
    expect(container.querySelector<HTMLElement>(".plot")!.style.minWidth).toBe("450px");
    expect(html).toContain("min-width:450px");
    const region = container.querySelector('[role="region"]')!;
    expect(region.getAttribute("aria-label")).toBe("Transactions by type, per day, scrollable chart");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.contains(container.querySelector(".plot"))).toBe(true);
    expect(errors).toEqual([]);
  });
});

describe("ColumnChart, memoised on the token (spec 2.9)", () => {
  const other = stacked({ 12: ["2", "1"], 29: ["1", "1"] });

  it("is not rendered again for the same token: the DOM stays, though the numbers it was handed are others", () => {
    const { container, rerender } = render(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    const first = container.querySelector(".col");
    expect(bar(container, 29)!.style.height).toBe("75%");

    rerender(<ColumnChart layout="stacked" title={TITLE} data={{ ...other, token: "t1" }} />);
    expect(container.querySelector(".col")).toBe(first);
    // Not rendered again, which a changed number would show.
    expect(bar(container, 29)!.style.height).toBe("75%");
    expect(container.querySelector(".plot.is-changed")).toBeNull();

    rerender(<ColumnChart layout="stacked" title={TITLE} data={{ ...STACKED }} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
  });

  it("is drawn again for a new token, and rings once", () => {
    const { container, rerender } = render(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    rerender(<ColumnChart layout="stacked" title={TITLE} data={{ ...other, token: "t2" }} />);
    expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(1);
    // 2 of a scale that now tops at 4.
    expect(bar(container, 29)!.style.height).toBe("50%");
    expect(texts(container.querySelector(".plot__y")!.children)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("is drawn again for another title or layout, which are part of what it is memoised on", () => {
    const { container, rerender } = render(<ColumnChart layout="stacked" title={TITLE} data={STACKED} />);
    rerender(<ColumnChart layout="stacked" title="Other title" data={STACKED} />);
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("Other title");
    expect(container.querySelector(".plot__y")).not.toBeNull();
    rerender(<ColumnChart layout="single" title="Other title" data={STACKED} />);
    expect(container.querySelector(".col__seg")).toBeNull();
    expect(container.querySelector(".col__bar")!.getAttribute("data-slot")).toBe("1");
  });
});
