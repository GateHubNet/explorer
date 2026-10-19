import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { areaPath, fractionOf, linePath, niceScale, percent, xOf } from "./geometry";
import { LineChart } from "./LineChart";
import type { Series, TimeAxis, TimeSeriesData } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Lines (spec 2.2, 2.6, 2.8, 2.9 and 2.11): one stretched SVG for the lines and the area, HTML boxes in percent for the dots, the end labels
// and the references, so that the Worker prints the finished chart. The cursor, with the crosshair, the dots, the tooltip and the slider's
// words, comes with the script.

const TITLE = "Volume per day, in XRP";

/** 30 days, Sep 17 to Oct 16, 2026: bucket 15 is Oct 2, bucket 28 is Oct 15 and bucket 29 is Oct 16. */
const day = (i: number) => new Date(Date.UTC(2026, 8, 17 + i)).toISOString().slice(0, 10);
const AXIS: TimeAxis = { unit: "day", buckets: Array.from({ length: 30 }, (_, i) => day(i)) };

/** The paths' box: `viewBox="0 0 1000 200"`, stretched to the plot. */
const BOX_HEIGHT = 200;

const PAYMENTS = AXIS.buckets.map((_, i) => String(31_000_000 + i * 500_000));
const DEX = AXIS.buckets.map((_, i) => (i === 29 ? "12100000" : String(10_000_000 + i * 50_000)));
const AMM = AXIS.buckets.map((_, i) => (i === 29 ? "3100000" : String(2_000_000 + i * 20_000)));

const payments: Series = { id: "payments", label: "Payments", short: "payments", slot: 1, values: PAYMENTS };
const dex: Series = { id: "dex", label: "DEX trades, tracked markets", short: "DEX", slot: 2, values: DEX };
const amm: Series = { id: "amm", label: "AMM swaps", slot: 3, values: AMM };

/** Three series of XRP volume: the payments reach 45.5M on the last day, so the scale is 0 to 60M by 20M. */
function volume(extra: Partial<TimeSeriesData> = {}): TimeSeriesData {
  return { axis: AXIS, series: [payments, dex, amm], format: { kind: "amount", unit: "XRP" }, token: "v1", ...extra };
}

const numbers = (series: readonly Series[]) => series.flatMap((s) => s.values.map((v) => (v === null ? null : Number(v))));
const SCALE = niceScale(numbers([payments, dex, amm]));
const fractions = (values: readonly (string | null)[], scale = SCALE) => values.map((v) => (v === null ? null : fractionOf(Number(v), scale)));
const pathOf = (values: readonly (string | null)[], curve?: "step", scale = SCALE) =>
  linePath(fractions(values, scale), { height: BOX_HEIGHT, placement: "points", curve });

const lineBySlot = (container: HTMLElement, slot: number | string) => container.querySelector<SVGPathElement>(`path.line[data-slot="${slot}"]`);
const slider = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="slider"]')!;
const tip = (container: HTMLElement) => container.querySelector<HTMLElement>(".plot__tip");
const texts = (nodes: ArrayLike<Element>) => Array.from(nodes, (node) => node.textContent);
/** What the tooltip says: its date, then one text for each row and each note. */
const lines = (container: HTMLElement) => Array.from(tip(container)!.querySelectorAll(".plot__tip-date, .plot__tip-row, .plot__tip-note"), (line) => line.textContent);
const endDots = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".plot__marks .plot__dot"));
const cursorDots = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".plot__cursor .plot__dot"));
const endLabels = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".plot__end .plot__end-label"));
const yLabels = (container: HTMLElement) => texts(container.querySelector(".plot__y")!.children);

/** Puts the cursor on bucket `i` with the keyboard: a focus selects the newest, Home goes to the first. */
function goTo(container: HTMLElement, i: number) {
  fireEvent.focus(slider(container));
  if (i === 29) return;
  fireEvent.keyDown(slider(container), { key: "Home" });
  for (let k = 0; k < i; k += 1) fireEvent.keyDown(slider(container), { key: "ArrowRight" });
}

const BOX = { left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

describe("LineChart as the Worker prints it and the browser takes it over", () => {
  it("draws a path for each of 3 series in one stretched SVG, whose `d` is linePath of the series' fractions, and no slider", async () => {
    const { html, container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    expect(html).not.toContain('role="slider"');
    expect(html.match(/<path class="line"/g)).toHaveLength(3);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 200");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(lineBySlot(container, 1)!.getAttribute("d")).toBe(pathOf(PAYMENTS));
    expect(lineBySlot(container, 2)!.getAttribute("d")).toBe(pathOf(DEX));
    expect(lineBySlot(container, 3)!.getAttribute("d")).toBe(pathOf(AMM));
    // 45.5M of 60M on the last day: 24.17% of the way down the box, at its right edge.
    expect(lineBySlot(container, 1)!.getAttribute("d")).toMatch(/L1000,48\.33$/);
    expect(errors).toEqual([]);
  });

  it("scales from 0 to the nice tick over the largest value, and plots points: the first on the left edge, the last on the right", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    expect(yLabels(container)).toEqual(["0", "20M", "40M", "60M"]);
    expect(lineBySlot(container, 1)!.getAttribute("d")).toMatch(/^M0,/);
    // The labels of an axis of points: 0 and 100% are on buckets.
    expect(Array.from(container.querySelectorAll<HTMLElement>(".plot__x--wide > *"), (label) => label.style.left).at(-1)).toBe("100%");
    expect(container.querySelector('[role="region"]')).toBeNull();
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe(
      "Volume per day, in XRP, Sep 17 to Oct 16, 2026. Highest Payments Oct 16, 45.5M XRP; latest Payments Oct 16, 45.5M XRP. Choose Table for every value.",
    );
    expect(errors).toEqual([]);
  });

  it("draws the first series last, so that it is on top, and gives each line its slot's colour", async () => {
    const { container } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    expect(Array.from(container.querySelectorAll("path.line"), (path) => path.getAttribute("data-slot"))).toEqual(["3", "2", "1"]);
  });

  it("is one image of marks that a screen reader does not enter: the svg, the dots and the labels are hidden inside it", async () => {
    const { container } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    const image = container.querySelector('[role="img"]')!;
    expect(image.querySelector("svg")).not.toBeNull();
    expect(image.querySelector("svg")!.closest('[aria-hidden="true"]')).not.toBeNull();
    for (const dot of endDots(container)) expect(dot.closest('[aria-hidden="true"]')).not.toBeNull();
    for (const label of endLabels(container)) expect(label.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("breaks a line at a null: a second M, and the gap has no point", async () => {
    const gap = PAYMENTS.map((v, i) => (i === 10 ? null : v));
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: [{ ...payments, values: gap }, dex, amm] })} />);
    const d = lineBySlot(container, 1)!.getAttribute("d")!;
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toBe(pathOf(gap));
    // Bucket 9 ends the first run and bucket 11, at 11/29 of the width, starts the second.
    expect(d).toContain("M379.31,");
    expect(lineBySlot(container, 2)!.getAttribute("d")!.match(/M/g)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("draws a value that has a null on each side as a zero-length segment, which a round cap makes a dot: `M x,y` alone would draw nothing", async () => {
    const lone = PAYMENTS.map((v, i) => (i === 12 ? v : null));
    const series = [{ ...payments, values: lone }, dex, amm];
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series })} />);
    const d = lineBySlot(container, 1)!.getAttribute("d")!;
    // The scale is the one of these series: 37M at most, and not the payments' 45.5M.
    expect(d).toBe(pathOf(lone, undefined, niceScale(numbers(series))));
    expect(d).toMatch(/^M413\.79,(\d+(\.\d+)?)L413\.79,\1$/);
    expect(errors).toEqual([]);
  });

  it("draws a value at 0 on the baseline, and the other series are unaffected", async () => {
    const zero = AXIS.buckets.map((_, i) => (i === 29 ? "0" : "5000000"));
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: [{ ...payments, values: zero }, dex, amm] })} />);
    expect(lineBySlot(container, 1)!.getAttribute("d")).toMatch(/L1000,200$/);
    expect(endDots(container)[0]!.style.bottom).toBe("0%");
    expect(errors).toEqual([]);
  });

  it("leaves a series that has no value at all undrawn: no path, no dot, no label", async () => {
    const none = AXIS.buckets.map(() => null);
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: [payments, { ...dex, values: none }, amm] })} />);
    expect(container.querySelectorAll("path.line")).toHaveLength(2);
    expect(lineBySlot(container, 2)).toBeNull();
    expect(endDots(container)).toHaveLength(2);
    expect(texts(endLabels(container))).toEqual(["45.5M payments", "3.1M AMM swaps"]);
    expect(errors).toEqual([]);
  });

  it("draws the series it is given, in the slots it is given, up to 5, and no more is asked", async () => {
    const five = ([1, 2, 3, 4, 5] as const).map((slot): Series => ({ id: `s${slot}`, label: `Series ${slot}`, slot, values: PAYMENTS.map((v) => String((Number(v) * (6 - slot)) / 5)) }));
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: five })} />);
    expect(Array.from(container.querySelectorAll("path.line"), (path) => path.getAttribute("data-slot"))).toEqual(["5", "4", "3", "2", "1"]);
    expect(errors).toEqual([]);
  });
});

describe("LineChart's end dots and end labels", () => {
  it("puts an 8 px end dot on the last value of each series, in its slot, at the right edge", async () => {
    const { html, container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    expect(html.match(/class="plot__dot"/g)).toHaveLength(3);
    const dots = endDots(container);
    expect(dots.map((dot) => dot.getAttribute("data-slot"))).toEqual(["1", "2", "3"]);
    expect(dots.map((dot) => dot.style.left)).toEqual(["100%", "100%", "100%"]);
    // 45.5M, 12.1M and 3.1M of 60M.
    expect(dots.map((dot) => dot.style.bottom)).toEqual(["75.83%", "20.17%", "5.17%"]);
    expect(dots.map((dot) => dot.style.bottom)).toEqual([payments, dex, amm].map((s) => percent(fractionOf(Number(s.values.at(-1)), SCALE))));
    expect(errors).toEqual([]);
  });

  it("puts the end dot on the last value that there is, when the newest buckets are null", async () => {
    const pending = PAYMENTS.map((v, i) => (i >= 28 ? null : v));
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: [{ ...payments, values: pending }, dex, amm], pending: 2 })} />);
    const dot = endDots(container)[0]!;
    expect(dot.style.left).toBe(percent(xOf(27, 30, "points")));
    expect(dot.style.left).toBe("93.1%");
    expect(dot.style.bottom).toBe(percent(fractionOf(Number(PAYMENTS[27]), SCALE)));
    // Its label is level with it, in the gutter.
    expect(endLabels(container)[0]!.style.top).toBe(percent(1 - fractionOf(Number(PAYMENTS[27]), SCALE)));
    expect(errors).toEqual([]);
  });

  it("writes an end label for each series: the compact figure strong, then the short name, else the label, at the height of the dot", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    const labels = endLabels(container);
    expect(texts(labels)).toEqual(["45.5M payments", "12.1M DEX", "3.1M AMM swaps"]);
    expect(labels.map((label) => label.querySelector("b")!.textContent)).toEqual(["45.5M", "12.1M", "3.1M"]);
    expect(labels.map((label) => label.style.top)).toEqual(["24.17%", "79.83%", "94.83%"]);
    // In the gutter on the right of the plot, which the plot's frame draws and leaves out under 480 px.
    expect(labels.every((label) => label.parentElement!.classList.contains("plot__end"))).toBe(true);
    expect(container.querySelector<HTMLElement>(".plot__end")!.style.width).toBe("112px");
    expect(errors).toEqual([]);
  });

  it("leaves out a later label that would sit within 16 px of one that is drawn, at the 160 px height, and still draws its dot", async () => {
    // Scale 0 to 400 by 100 (a first value of 400), 200 and 225 on the last day: 80 px and 70 px from the top of 160.
    const near: TimeSeriesData = volume({
      series: [
        { ...payments, values: AXIS.buckets.map((_, i) => (i === 0 ? "400" : i === 29 ? "200" : "100")) },
        { ...dex, values: AXIS.buckets.map((_, i) => (i === 29 ? "225" : "100")) },
      ],
      format: { kind: "amount", unit: "XRP" },
    });
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={near} />);
    expect(yLabels(container)).toEqual(["0", "100", "200", "300", "400"]);
    expect(texts(endLabels(container))).toEqual(["200 payments"]);
    expect(endDots(container)).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("keeps a label that is 16 px from the one before, and leaves out one that is nearer", async () => {
    // 200 and 210 of 0 to 400: 80 px and 73.6 px from the top: too near. 200 and 240: 80 and 64: kept.
    const make = (second: string) =>
      volume({
        series: [
          { ...payments, values: AXIS.buckets.map((_, i) => (i === 0 ? "400" : i === 29 ? "200" : "100")) },
          { ...dex, values: AXIS.buckets.map((_, i) => (i === 29 ? second : "100")) },
        ],
      });
    const near = await serverThenHydrated(<LineChart title={TITLE} data={make("210")} />);
    expect(endLabels(near.container)).toHaveLength(1);
    cleanup();
    const apart = await serverThenHydrated(<LineChart title={TITLE} data={make("240")} />);
    expect(endLabels(apart.container)).toHaveLength(2);
  });

  it("has no end labels for 5 series, whose dots and lines it still draws: the legend and the tooltip name them", async () => {
    const five = ([1, 2, 3, 4, 5] as const).map((slot): Series => ({ id: `s${slot}`, label: `Series ${slot}`, slot, values: PAYMENTS.map((v) => String((Number(v) * (6 - slot)) / 5)) }));
    const four = five.slice(0, 4);
    const withFour = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: four })} />);
    expect(endLabels(withFour.container)).toHaveLength(4);
    cleanup();
    const withFive = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: five })} />);
    expect(withFive.container.querySelector(".plot__end")).toBeNull();
    expect(endDots(withFive.container)).toHaveLength(5);
  });

  it("writes the figure of a percent with its sign, and of a count compact", async () => {
    const percentData = volume({ series: [{ ...payments, values: AXIS.buckets.map(() => "99.31") }], format: { kind: "percent" } });
    const first = await serverThenHydrated(<LineChart title="Agreement" data={percentData} />);
    expect(texts(endLabels(first.container))).toEqual(["99.31% payments"]);
    cleanup();
    const countData = volume({ series: [{ ...payments, values: AXIS.buckets.map(() => "1284331") }], format: { kind: "count", unit: "transactions" } });
    const second = await serverThenHydrated(<LineChart title="Transactions" data={countData} />);
    expect(texts(endLabels(second.container))).toEqual(["1.28M payments"]);
  });
});

describe("LineChart area", () => {
  const fee = (extra: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
    axis: AXIS,
    series: [{ id: "fee", label: "Average fee", short: "avg fee", slot: 1, values: AXIS.buckets.map((_, i) => String(112 + (i % 3))) }],
    format: { kind: "drops", unit: "drops" },
    token: "f1",
    ...extra,
  });
  const FEE_SCALE = niceScale(AXIS.buckets.map((_, i) => 112 + (i % 3)));
  const feeFractions = AXIS.buckets.map((_, i) => fractionOf(112 + (i % 3), FEE_SCALE));

  it("draws the wash as a path of class area, areaPath's d, under the line, in the series' slot", async () => {
    const { html, container, errors } = await serverThenHydrated(<LineChart title="Average fee" data={fee()} area />);
    expect(html.match(/<path class="area"/g)).toHaveLength(1);
    const area = container.querySelector<SVGPathElement>("path.area")!;
    expect(area.getAttribute("d")).toBe(areaPath(feeFractions, { height: BOX_HEIGHT, placement: "points" }));
    expect(area.getAttribute("d")).toMatch(/L1000,200L0,200Z$/);
    expect(area.getAttribute("data-slot")).toBe("1");
    expect(container.querySelector("path.line")!.getAttribute("d")).toBe(linePath(feeFractions, { height: BOX_HEIGHT, placement: "points" }));
    // Drawn first, so that it is under the line.
    expect(Array.from(container.querySelectorAll("svg path"), (path) => path.getAttribute("class"))).toEqual(["area", "line"]);
    expect(errors).toEqual([]);
  });

  it("starts the scale at 0, whatever the values, so that the wash is a true size", async () => {
    const { container } = await serverThenHydrated(<LineChart title="Average fee" data={fee()} area />);
    expect(yLabels(container)[0]).toBe("0");
    expect(yLabels(container).length).toBeGreaterThanOrEqual(4);
  });

  it("ignores a domain minimum, which an area cannot have, and keeps a maximum", async () => {
    const { container } = await serverThenHydrated(<LineChart title="Average fee" data={fee({ domain: { min: "100", max: "200" } })} area />);
    expect(yLabels(container)).toEqual(["0", "50", "100", "150", "200"]);
  });

  it("draws one series only, the first", async () => {
    const two = fee({ series: [...fee().series, { id: "other", label: "Other", slot: 2, values: AXIS.buckets.map(() => "50") }] });
    const { container } = await serverThenHydrated(<LineChart title="Average fee" data={two} area />);
    expect(container.querySelectorAll("path.line")).toHaveLength(1);
    expect(container.querySelectorAll("path.area")).toHaveLength(1);
    expect(endDots(container)).toHaveLength(1);
    expect(texts(endLabels(container))).toEqual(["114 avg fee"]);
    goTo(container, 29);
    expect(lines(container)).toEqual(["Oct 16, 2026", "114 drops Average fee"]);
  });

  it("makes a wash for each run, and none for a lone point", async () => {
    const values = AXIS.buckets.map((_, i) => (i === 5 || i === 6 || i === 20 ? "120" : null));
    const { container } = await serverThenHydrated(<LineChart title="Average fee" data={fee({ series: [{ ...fee().series[0]!, values }] })} area />);
    const area = container.querySelector("path.area")!.getAttribute("d")!;
    expect(area.match(/Z/g)).toHaveLength(2);
    expect(area.match(/M/g)).toHaveLength(2);
    // The lone point is a sliver of no width in the area and a dot in the line.
    expect(container.querySelector("path.line")!.getAttribute("d")).toMatch(/M689\.66,\d+(\.\d+)?L689\.66,\d+(\.\d+)?$/);
  });

  it("has no area unless asked", async () => {
    const { container } = await serverThenHydrated(<LineChart title="Average fee" data={fee()} />);
    expect(container.querySelector("path.area")).toBeNull();
  });
});

describe("LineChart with a domain, steps and references", () => {
  /** 60 to 95 over the 30 buckets: the yes votes of an amendment, in percent. */
  const VOTES = AXIS.buckets.map((_, i) => String(60 + Math.round((i * 35 * 100) / 29) / 100));
  const votes = (extra: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
    axis: AXIS,
    series: [{ id: "yes", label: "Yes votes", slot: 1, values: VOTES }],
    format: { kind: "percent" },
    token: "a1",
    ...extra,
  });
  const THRESHOLD = [{ value: "80", label: "80% threshold" }];

  it("steps after each point, from a domain that starts at 50, with the threshold 80 as a dashed reference at its height", async () => {
    const data = votes({ domain: { min: "50" }, references: THRESHOLD });
    const { container, errors } = await serverThenHydrated(<LineChart title="Yes votes" data={data} curve="step" />);
    // The ticks start at 50; 80 is half way from 50 to the top tick of 110.
    expect(yLabels(container)).toEqual(["50%", "70%", "90%", "110%"]);
    const scale = niceScale(VOTES.map(Number), { from: 50 });
    expect(scale.ticks).toEqual([50, 70, 90, 110]);
    expect(lineBySlot(container, 1)!.getAttribute("d")).toBe(pathOf(VOTES, "step", scale));
    expect(lineBySlot(container, 1)!.getAttribute("d")).toContain("L");
    const refs = container.querySelectorAll<HTMLElement>(".ref");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.style.bottom).toBe(percent(fractionOf(80, scale)));
    expect(refs[0]!.style.bottom).toBe("50%");
    expect(refs[0]!.querySelector(".ref__label")!.textContent).toBe("80% threshold");
    expect(errors).toEqual([]);
  });

  it("draws a step as level to the next bucket and then up: the path has 2 points for each bucket after the first", async () => {
    const data = votes({ domain: { min: "50" } });
    const linear = await serverThenHydrated(<LineChart title="Yes votes" data={data} />);
    const linearPoints = lineBySlot(linear.container, 1)!.getAttribute("d")!.match(/[ML]/g)!.length;
    cleanup();
    const step = await serverThenHydrated(<LineChart title="Yes votes" data={data} curve="step" />);
    expect(linearPoints).toBe(30);
    expect(lineBySlot(step.container, 1)!.getAttribute("d")!.match(/[ML]/g)).toHaveLength(1 + 2 * 29);
  });

  it("ends the scale at the domain's maximum when a step divides it, and the reference follows the scale", async () => {
    const data = votes({ domain: { min: "50", max: "100" }, references: THRESHOLD });
    const { container } = await serverThenHydrated(<LineChart title="Yes votes" data={data} curve="step" />);
    expect(yLabels(container)).toEqual(["50%", "75%", "100%"]);
    expect(container.querySelector<HTMLElement>(".ref")!.style.bottom).toBe("60%");
  });

  it("keeps the reference on the scale when it is above every value", async () => {
    const low = votes({ series: [{ id: "yes", label: "Yes votes", slot: 1, values: VOTES.map(() => "55") }], domain: { min: "50" }, references: THRESHOLD });
    const { container } = await serverThenHydrated(<LineChart title="Yes votes" data={low} curve="step" />);
    const top = Number(yLabels(container).at(-1)!.replace("%", ""));
    expect(top).toBeGreaterThanOrEqual(80);
    const scale = niceScale([55, 80], { from: 50 });
    expect(container.querySelector<HTMLElement>(".ref")!.style.bottom).toBe(percent(fractionOf(80, scale)));
  });

  it("draws a reference for each one given, each with its label, and none when there are none", async () => {
    const two = votes({ domain: { min: "50" }, references: [...THRESHOLD, { value: "90", label: "90% supermajority" }] });
    const { container } = await serverThenHydrated(<LineChart title="Yes votes" data={two} curve="step" />);
    expect(texts(container.querySelectorAll(".ref__label"))).toEqual(["80% threshold", "90% supermajority"]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".ref"), (ref) => ref.style.bottom)).toEqual(["50%", "66.67%"]);
    cleanup();
    const none = await serverThenHydrated(<LineChart title="Yes votes" data={votes({ domain: { min: "50" } })} curve="step" />);
    expect(none.container.querySelector(".ref")).toBeNull();
  });

  it("keeps a reference out of the cursor's way and out of the screen reader's: it is a mark in the image box", async () => {
    const { container } = await serverThenHydrated(<LineChart title="Yes votes" data={votes({ references: THRESHOLD })} curve="step" />);
    expect(container.querySelector(".ref")!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector(".ref")!.closest('[role="img"]')).not.toBeNull();
    expect(container.querySelector('[role="slider"]')!.closest(".ref")).toBeNull();
  });

  it("starts the lines of a chart with no domain at 0, which is the default of a line too", async () => {
    const { container } = await serverThenHydrated(<LineChart title="Yes votes" data={votes()} />);
    expect(yLabels(container)[0]).toBe("0%");
  });
});

describe("LineChart's cursor", () => {
  it("names its slider for the chart and the step, and says the newest bucket with every series' value in full", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    const control = slider(container);
    expect(control.getAttribute("aria-label")).toBe("Volume per day, in XRP, day by day");
    expect(control.getAttribute("aria-valuemax")).toBe("29");
    expect(control.getAttribute("aria-valuenow")).toBe("29");
    expect(control.getAttribute("aria-valuetext")).toBe(
      "Oct 16, 2026: Payments 45.5M XRP; DEX trades, tracked markets 12.1M XRP; AMM swaps 3.1M XRP",
    );
    expect(control.closest('[role="img"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it("says a series that has a value, and the series that has none is left out of the words", async () => {
    const two = volume({ series: [payments, dex] });
    const { container } = await serverThenHydrated(<LineChart title={TITLE} data={two} />);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 16, 2026: Payments 45.5M XRP; DEX trades, tracked markets 12.1M XRP");
  });

  it("shows a crosshair and a dot for each series at the bucket the cursor is on, at the height of its value", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    expect(container.querySelector(".plot__crosshair")).toBeNull();
    expect(cursorDots(container)).toHaveLength(0);
    goTo(container, 12);
    const crosshair = container.querySelector<HTMLElement>(".plot__crosshair")!;
    expect(crosshair.style.left).toBe(percent(xOf(12, 30, "points")));
    expect(crosshair.style.left).toBe("41.38%");
    const dots = cursorDots(container);
    expect(dots).toHaveLength(3);
    expect(dots.map((dot) => dot.getAttribute("data-slot"))).toEqual(["1", "2", "3"]);
    expect(dots.map((dot) => dot.style.left)).toEqual(["41.38%", "41.38%", "41.38%"]);
    expect(dots.map((dot) => dot.style.bottom)).toEqual([payments, dex, amm].map((s) => percent(fractionOf(Number(s.values[12]), SCALE))));
    // The end dots are still there, apart from the cursor's.
    expect(endDots(container)).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it("is on the bucket under a pointer, and the plot says which", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    const plot = container.querySelector<HTMLElement>(".plot")!;
    vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(BOX);
    fireEvent.pointerMove(slider(container), { clientX: 500, pointerType: "mouse" });
    expect(plot.getAttribute("data-active")).toBe("15");
    expect(container.querySelector<HTMLElement>(".plot__crosshair")!.style.left).toBe(percent(xOf(15, 30, "points")));
    expect(slider(container).getAttribute("aria-valuetext")).toMatch(/^Oct 2, 2026: Payments 38\.5M XRP;/);
    fireEvent.pointerLeave(slider(container), { clientX: 500, pointerType: "mouse" });
    expect(plot.hasAttribute("data-active")).toBe(false);
    expect(container.querySelector(".plot__crosshair")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("shows a tooltip with the date and a row for each series: a key, the value strong, and the name muted", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={volume()} />);
    expect(tip(container)).toBeNull();
    goTo(container, 29);
    expect(lines(container)).toEqual(["Oct 16, 2026", "45.5M XRP Payments", "12.1M XRP DEX trades, tracked markets", "3.1M XRP AMM swaps"]);
    const bubble = tip(container)!;
    expect(bubble.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(bubble.querySelectorAll(".plot__tip-key"), (key) => key.getAttribute("data-slot"))).toEqual(["1", "2", "3"]);
    expect(Array.from(bubble.querySelectorAll(".plot__tip-row b"), (value) => value.textContent)).toEqual(["45.5M XRP", "12.1M XRP", "3.1M XRP"]);
    expect(Array.from(bubble.querySelectorAll(".plot__tip-name"), (name) => name.textContent)).toEqual(["Payments", "DEX trades, tracked markets", "AMM swaps"]);
    expect(errors).toEqual([]);
  });

  it("writes a count in full in the tooltip and to the slider, and an amount compact with its unit once", async () => {
    const counts = volume({ series: [{ ...payments, values: AXIS.buckets.map(() => "1284331") }], format: { kind: "count", unit: "transactions" } });
    const { container } = await serverThenHydrated(<LineChart title="Transactions" data={counts} />);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 16, 2026: Payments 1,284,331");
    goTo(container, 29);
    expect(lines(container)).toEqual(["Oct 16, 2026", "1,284,331 Payments"]);
  });

  it("has a dash for a series with no value in a bucket that has others, no dot for it, and leaves it out of the slider's words", async () => {
    const gap = DEX.map((v, i) => (i === 12 ? null : v));
    const { container } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ series: [payments, { ...dex, values: gap }, amm] })} />);
    goTo(container, 12);
    expect(lines(container)).toEqual(["Sep 29, 2026", "37M XRP Payments", "— DEX trades, tracked markets", "2.24M XRP AMM swaps"]);
    expect(cursorDots(container).map((dot) => dot.getAttribute("data-slot"))).toEqual(["1", "3"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Sep 29, 2026: Payments 37M XRP; AMM swaps 2.24M XRP");
  });

  it("has no cursor over an empty plot: there is nothing to read", async () => {
    const empty = volume({ series: [payments, dex, amm].map((s) => ({ ...s, values: AXIS.buckets.map(() => null) })) });
    const { container } = await serverThenHydrated(<LineChart title={TITLE} data={empty} />);
    expect(container.querySelector('[role="slider"]')).toBeNull();
  });
});

describe("LineChart's states (spec 2.8)", () => {
  const gapped = (i: number, extra: Partial<TimeSeriesData> = {}) =>
    volume({ series: [payments, dex, amm].map((s) => ({ ...s, values: s.values.map((v, k) => (k === i ? null : v)) })), ...extra });

  it("breaks the line at a bucket that is null in every series, and says 'No data for Oct 2' in the tooltip and to the slider", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={gapped(15)} />);
    for (const slot of [1, 2, 3]) expect(lineBySlot(container, slot)!.getAttribute("d")!.match(/M/g), String(slot)).toHaveLength(2);
    goTo(container, 15);
    expect(lines(container)).toEqual(["No data for Oct 2"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 2, 2026: no data");
    expect(cursorDots(container)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("says 'Not computed yet' for the newest bucket when it is pending, with its date, and the others as they were", async () => {
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={gapped(29, { pending: 1 })} />);
    fireEvent.focus(slider(container));
    expect(lines(container)).toEqual(["Oct 16, 2026", "Not computed yet"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 16, 2026: not computed yet");
    goTo(container, 28);
    expect(lines(container)[1]).toBe("45M XRP Payments");
    // The lines end at the last bucket that has a value, and so do their dots.
    expect(endDots(container)[0]!.style.left).toBe(percent(xOf(28, 30, "points")));
    expect(errors).toEqual([]);
  });

  it("says 'No data' for a bucket that is not among the newest pending ones", async () => {
    const { container } = await serverThenHydrated(<LineChart title={TITLE} data={gapped(28, { pending: 1 })} />);
    goTo(container, 28);
    expect(lines(container)).toEqual(["No data for Oct 15"]);
  });

  it("gives the running bucket its words: 'so far' in the tooltip and to the slider, and never on the axis", async () => {
    const { container } = await serverThenHydrated(<LineChart title={TITLE} data={volume({ forming: true })} />);
    expect(slider(container).getAttribute("aria-valuetext")).toMatch(/^Oct 16, 2026, so far: Payments/);
    goTo(container, 29);
    expect(lines(container)[0]).toBe("Oct 16, 2026, so far");
    goTo(container, 28);
    expect(lines(container)[0]).toBe("Oct 15, 2026");
    for (const label of container.querySelectorAll(".plot__x span")) expect(label.textContent).not.toMatch(/so far/);
  });

  it("says 'No data for these 30 days' in the middle of an axis from 0 to 1, with no mark, when every bucket is null", async () => {
    const empty = volume({ series: [payments, dex, amm].map((s) => ({ ...s, values: AXIS.buckets.map(() => null) })), references: [{ value: "80", label: "80% threshold" }] });
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={empty} />);
    expect(container.querySelector(".plot__empty")!.textContent).toBe("No data for these 30 days");
    expect(container.querySelector("path.line")).toBeNull();
    expect(container.querySelector(".plot__dot")).toBeNull();
    expect(container.querySelector(".plot__end")).toBeNull();
    expect(container.querySelector(".ref")).toBeNull();
    expect(yLabels(container)).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
    expect(container.querySelectorAll(".plot__grid")).toHaveLength(5);
    expect(errors).toEqual([]);
  });

  it("says 'No data' for an axis of no buckets", async () => {
    const data = volume({ axis: { unit: "day", buckets: [] }, series: [{ ...payments, values: [] }] });
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={data} />);
    expect(container.querySelector(".plot__empty")!.textContent).toBe("No data");
    expect(container.querySelector('[role="slider"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it("draws a plot of one bucket: the point in the middle, a dot and no line to draw", async () => {
    const data = volume({ axis: { unit: "day", buckets: ["2026-10-16"] }, series: [{ ...payments, values: ["45500000"] }] });
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={data} />);
    expect(lineBySlot(container, 1)!.getAttribute("d")).toMatch(/^M500,(\d+(\.\d+)?)L500,\1$/);
    expect(endDots(container)[0]!.style.left).toBe("50%");
    expect(slider(container).getAttribute("aria-valuemax")).toBe("0");
    expect(errors).toEqual([]);
  });

  it("counts in whole ticks: 3 transactions is 0 to 4, not 0 to 3 by 0.75", async () => {
    const counts = volume({ series: [{ ...payments, values: AXIS.buckets.map(() => "3") }], format: { kind: "count", unit: "transactions" } });
    const { container } = await serverThenHydrated(<LineChart title="Transactions" data={counts} />);
    expect(yLabels(container)).toEqual(["0", "1", "2", "3", "4"]);
  });
});

describe("LineChart, memoised on the token (spec 2.9)", () => {
  // The payments are flat at 10M, which is another line on another scale.
  const other = volume({ series: [{ ...payments, values: PAYMENTS.map(() => "10000000") }, dex, amm] });

  it("is not rendered again for the same token: the DOM stays, though the numbers it was handed are others", () => {
    const { container, rerender } = render(<LineChart title={TITLE} data={volume()} />);
    const first = container.querySelector("path.line");
    const before = first!.getAttribute("d");

    rerender(<LineChart title={TITLE} data={{ ...other, token: "v1" }} />);
    expect(container.querySelector("path.line")).toBe(first);
    expect(container.querySelector("path.line")!.getAttribute("d")).toBe(before);
    expect(container.querySelector(".plot.is-changed")).toBeNull();

    rerender(<LineChart title={TITLE} data={{ ...volume() }} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
  });

  it("is drawn again for a new token, and rings once", () => {
    const { container, rerender } = render(<LineChart title={TITLE} data={volume()} />);
    const before = container.querySelector("path.line[data-slot='1']")!.getAttribute("d");
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    rerender(<LineChart title={TITLE} data={{ ...other, token: "v2" }} />);
    expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(1);
    expect(container.querySelector("path.line[data-slot='1']")!.getAttribute("d")).not.toBe(before);
  });

  it("is drawn again for another title, area or curve, which are part of what it is memoised on", () => {
    const { container, rerender } = render(<LineChart title={TITLE} data={volume()} />);
    rerender(<LineChart title="Other title" data={volume()} />);
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("Other title");
    rerender(<LineChart title="Other title" data={volume()} area />);
    expect(container.querySelector("path.area")).not.toBeNull();
    expect(container.querySelectorAll("path.line")).toHaveLength(1);
    const linear = container.querySelector("path.line")!.getAttribute("d")!;
    rerender(<LineChart title="Other title" data={volume()} area curve="step" />);
    expect(container.querySelector("path.line")!.getAttribute("d")).not.toBe(linear);
    expect(container.querySelector("path.line")!.getAttribute("d")!.match(/[ML]/g)).toHaveLength(1 + 2 * 29);
  });
});
