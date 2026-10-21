import { describe, expect, it } from "vitest";

import {
  areaPath,
  bucketAt,
  END_LABEL_GUTTER_PX,
  fitScale,
  fractionOf,
  keptEndLabels,
  linePath,
  MIN_SLOT_PX,
  niceScale,
  PANEL_HEIGHT,
  percent,
  PLOT_HEIGHT,
  stackOf,
  tooltipSide,
  xLabelPicks,
  xOf,
} from "./geometry";
import { tickLabel } from "./labels";

describe("niceScale", () => {
  const ticks = (...args: Parameters<typeof niceScale>) => niceScale(...args).ticks;

  it("takes the smallest step of 1, 2, 2.5 or 5 times a power of ten that gives 4 or 5 ticks, the top at or above the maximum", () => {
    expect(ticks([2310000], { integer: true })).toEqual([0, 1000000, 2000000, 3000000]);
    expect(ticks([100])).toEqual([0, 25, 50, 75, 100]);
    expect(ticks([40, 100])).toEqual([0, 25, 50, 75, 100]);
    expect(ticks([300])).toEqual([0, 100, 200, 300]);
    expect(ticks([0.3])).toEqual([0, 0.1, 0.2, 0.3]);
    expect(ticks([4800])).toEqual([0, 2000, 4000, 6000]);
  });

  it("gives whole steps for counts", () => {
    expect(ticks([7], { integer: true })).toEqual([0, 2, 4, 6, 8]);
    expect(ticks([3], { integer: true })).toEqual([0, 1, 2, 3, 4]);
    expect(ticks([9], { integer: true })).toEqual([0, 5, 10]);
    expect(ticks([10], { integer: true })).toEqual([0, 5, 10]);
    expect(ticks([20], { integer: true })).toEqual([0, 5, 10, 15, 20]);
  });

  it("goes from 0 to 4 for a count of none, or of too few to share out", () => {
    expect(ticks([2], { integer: true })).toEqual([0, 1, 2, 3, 4]);
    expect(ticks([0, 0], { integer: true })).toEqual([0, 1, 2, 3, 4]);
    expect(ticks([], { integer: true })).toEqual([0, 1, 2, 3, 4]);
    expect(ticks([null, null], { integer: true })).toEqual([0, 1, 2, 3, 4]);
  });

  it("goes from 0 to 1 when everything is 0 and the values need not be whole", () => {
    expect(ticks([null, 0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(ticks([])).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("starts a line at `from` and ends it at or above `to`", () => {
    expect(ticks([99.31, 99.98], { from: 99 })).toEqual([99, 99.25, 99.5, 99.75, 100]);
    expect(ticks([60, 95], { from: 50 })).toEqual([50, 70, 90, 110]);
    const scale = niceScale([99.31, 99.98], { from: 99 });
    expect([scale.min, scale.max, scale.step]).toEqual([99, 100, 0.25]);
  });

  it("ends a line exactly at `to` when a step divides the domain evenly", () => {
    expect(ticks([60, 95], { from: 50, to: 100 })).toEqual([50, 75, 100]);
    expect(ticks([99.31, 99.98], { from: 99, to: 100 })).toEqual([99, 99.25, 99.5, 99.75, 100]);
    expect(ticks([0.2], { to: 1 })).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(ticks([60, 95], { from: 50, to: 100, ticks: 3 })).toEqual([50, 75, 100]);
    // No step of the set divides 0 to 90 in 3 or 4: the top is the first tick at or above `to`.
    expect(ticks([10], { to: 90 }).at(-1)).toBeGreaterThanOrEqual(90);
    // A value above `to` is still on the scale.
    expect(niceScale([130], { to: 100 }).max).toBeGreaterThanOrEqual(130);
  });

  it("takes 3 ticks when asked: a step of at least half the maximum", () => {
    expect(ticks([40, 120], { ticks: 3 })).toEqual([0, 100, 200]);
    expect(ticks([100], { ticks: 3 })).toEqual([0, 50, 100]);
    expect(ticks([0, 0], { ticks: 3 })).toEqual([0, 0.5, 1]);
    expect(ticks([0, 0], { ticks: 3, integer: true })).toEqual([0, 2, 4]);
    expect(ticks([1], { ticks: 3, integer: true })).toEqual([0, 2, 4]);
  });

  it("never gives a count 2 ticks on the 3-tick path: the step is below the span, so that a count of 5 is 0 to 6 by 2", () => {
    expect(ticks([5], { integer: true, ticks: 3 })).toEqual([0, 2, 4, 6]);
    expect(ticks([5], { integer: true, ticks: 3, from: 0, to: 5 })).toEqual([0, 2, 4, 6]);
    // The same count on the 5-tick path and the others on this one were never at fault.
    expect(ticks([5], { integer: true })).toEqual([0, 2, 4, 6]);
    expect(ticks([6], { integer: true, ticks: 3 })).toEqual([0, 5, 10]);
    expect(ticks([25], { integer: true, ticks: 3 })).toEqual([0, 20, 40]);
    expect(ticks([50], { integer: true, ticks: 3 })).toEqual([0, 25, 50]);
    expect(ticks([-5, 3], { integer: true, ticks: 3 })).toEqual([-5, 0, 5]);
    expect(ticks([5], { integer: true, ticks: 3, symmetric: true })).toEqual([-6, -4, -2, 0, 2, 4, 6]);
  });

  it("gives every whole maximum 3 or 4 ticks on the 3-tick path, with a whole step, covering the maximum", () => {
    for (let max = 1; max <= 2000; max += 1) {
      const scale = niceScale([max], { integer: true, ticks: 3 });
      expect([3, 4], `${max}: ${scale.ticks.join(",")}`).toContain(scale.ticks.length);
      expect(Number.isInteger(scale.step), String(max)).toBe(true);
      expect(scale.max, String(max)).toBeGreaterThanOrEqual(max);
    }
  });

  it("reaches below 0 for a negative value, with 0 a tick", () => {
    const scale = niceScale([-50, 120], { ticks: 3 });
    expect(scale.ticks[0]).toBeLessThanOrEqual(-50);
    expect(scale.ticks).toContain(0);
    expect(scale.ticks.at(-1)).toBeGreaterThanOrEqual(120);
    expect([3, 4]).toContain(scale.ticks.length);
    expect([scale.min, scale.max]).toEqual([scale.ticks[0], scale.ticks.at(-1)]);
  });

  it("mirrors the positive side when symmetric", () => {
    const scale = niceScale([-300, 500], { symmetric: true });
    expect(scale.min).toBe(-scale.max);
    expect(scale.ticks).toContain(0);
    expect(scale.max).toBeGreaterThanOrEqual(500);
    expect(scale.ticks).toEqual([-600, -400, -200, 0, 200, 400, 600]);
    expect(niceScale([-700, 20], { symmetric: true }).max).toBeGreaterThanOrEqual(700);
    expect(niceScale([null, 0], { symmetric: true }).ticks).toEqual([-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]);
  });

  it("cleans the ticks of floating point noise", () => {
    expect(ticks([0.3])).toEqual([0, 0.1, 0.2, 0.3]);
    expect(ticks([0.0003])).toEqual([0, 0.0001, 0.0002, 0.0003]);
    expect(ticks([1.1])).toEqual([0, 0.5, 1, 1.5]);
  });

  it("covers every value", () => {
    for (const top of [0.7, 1, 1.2, 3, 6, 11, 99.9, 250, 251, 4999, 12345.6, 7e9]) {
      const scale = niceScale([top]);
      expect(scale.max, String(top)).toBeGreaterThanOrEqual(top);
      expect(scale.ticks.length, String(top)).toBeGreaterThanOrEqual(4);
      expect(scale.ticks.length, String(top)).toBeLessThanOrEqual(5);
    }
  });
});

describe("fitScale", () => {
  const ticks = (values: (number | null)[]) => fitScale(values).ticks;

  it("fits the values and does not start at 0: a price moves by a few percent of itself", () => {
    // 2.38 to 2.48: steps of 0.02 would be 2.38 to 2.48 in six ticks, and 0.025 would label 2.375 as 2.38, so 0.05.
    expect(ticks([2.38, 2.46, 2.39, 2.45, 2.48, 2.4])).toEqual([2.35, 2.4, 2.45, 2.5]);
    expect(ticks([98, 140])).toEqual([80, 100, 120, 140]);
  });

  it("takes the nearest step below the lowest value and above the highest, and at most 5 ticks", () => {
    const scale = fitScale([2.3813, 2.4605]);
    expect(scale.min).toBeLessThanOrEqual(2.3813);
    expect(scale.max).toBeGreaterThanOrEqual(2.4605);
    expect(scale.ticks.length).toBeLessThanOrEqual(5);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(3);
    expect(scale.ticks).toEqual([2.35, 2.4, 2.45, 2.5]);
    // Every tick is a multiple of the step, with no floating point noise.
    for (const tick of scale.ticks) expect(Math.abs(tick / scale.step - Math.round(tick / scale.step))).toBeLessThan(1e-9);
  });

  it("uses the same steps as niceScale (1, 2, 2.5 or 5 times a power of ten) over a wide range", () => {
    expect(ticks([100, 180])).toEqual([100, 120, 140, 160, 180]);
    expect(ticks([0.9, 3.1])).toEqual([0, 1, 2, 3, 4]);
  });

  it("never asks the labels for a digit they do not show: 2 decimals from 1 up, 3 significant digits under it", () => {
    // From 1 up compactNumber keeps 2 decimals, so a step of 0.025 (2.375) would read as another number.
    for (const tick of ticks([2.3813, 2.4605])) expect(Math.abs(tick * 100 - Math.round(tick * 100))).toBeLessThan(1e-9);
    // Under 1 it keeps 3 significant digits: 0.0315 has them, 0.03125 would not.
    expect(ticks([0.03104, 0.0322])).toEqual([0.031, 0.0315, 0.032, 0.0325]);
  });

  it("settles for fewer ticks when the range is finer than the labels can tell apart", () => {
    // 2.431 to 2.4339 is a range of 0.003 at a price of 2.4: the finest step the labels show is 0.01.
    const scale = fitScale([2.431, 2.4339]);
    expect(scale.ticks).toEqual([2.43, 2.44]);
    expect(fitScale([2.43101, 2.43102]).ticks).toEqual([2.43, 2.44]);
  });

  it("is niceScale's for values that do not vary: one value, none, or only nulls", () => {
    expect(fitScale([2.4, 2.4])).toEqual(niceScale([2.4, 2.4]));
    expect(fitScale([5])).toEqual(niceScale([5]));
    expect(fitScale([])).toEqual(niceScale([]));
    expect(fitScale([null, null])).toEqual(niceScale([]));
  });

  it("leaves out a null and a value that is not a number", () => {
    expect(fitScale([null, 2.38, NaN, 2.48, null]).ticks).toEqual([2.35, 2.4, 2.45, 2.5]);
  });
});

describe("fitScale for a price", () => {
  // formatPrice writes 8 significant digits, so a price scale may use every step that 8 digits of the reach can write: the smallest is
  // 10^(floor(log10(reach)) - 7). The other kinds keep the step their compact labels allow (the tests above).
  const price = (values: (number | null)[]) => fitScale(values, "price");
  const text = (tick: number) => tickLabel(tick, "price");
  /** What a tick reads back as: the label with its separators and sign taken off. */
  const readBack = (label: string) => Number(label.replaceAll(",", "").replace("\u2212", "-"));

  it("fills the pane with a stable pair: 1.0000 plus or minus 0.0005 is 0.9995 to 1.0005 in steps of 0.00025", () => {
    const scale = price([0.9995, 1.0005, 1.0001, 0.9998]);
    expect(scale.ticks).toEqual([0.9995, 0.99975, 1, 1.00025, 1.0005]);
    expect(scale.step).toBe(0.00025);
    expect(scale.ticks.map(text)).toEqual(["0.9995", "0.99975", "1", "1.00025", "1.0005"]);
    // Where the compact labels fit it in a twentieth of the pane, 0.99 to 1.01.
    expect(fitScale([0.9995, 1.0005, 1.0001, 0.9998]).ticks).toEqual([0.99, 1, 1.01]);
    expect(fitScale([0.9995, 1.0005, 1.0001, 0.9998], "count").ticks).toEqual([0.99, 1, 1.01]);
  });

  it("uses a step of 0.025 on a price of 2.4 now that its labels are exact: 2.375 is written 2.375", () => {
    expect(price([2.3813, 2.4605]).ticks).toEqual([2.375, 2.4, 2.425, 2.45, 2.475]);
    expect(price([2.3813, 2.4605]).ticks.map(text)).toEqual(["2.375", "2.4", "2.425", "2.45", "2.475"]);
    // And the range of the candles' tests, which has no such step that fits in 5 ticks, keeps 0.05.
    expect(price([2.38, 2.46, 2.39, 2.45, 2.48, 2.4]).ticks).toEqual([2.35, 2.4, 2.45, 2.5]);
  });

  it("goes down to the digit the label shows: 2.431 to 2.4339 is steps of 0.001, where the compact labels settle for 2.43 and 2.44", () => {
    expect(price([2.431, 2.4339]).ticks).toEqual([2.431, 2.432, 2.433, 2.434]);
    expect(fitScale([2.431, 2.4339]).ticks).toEqual([2.43, 2.44]);
    const fine = price([2.43101, 2.43102]);
    expect(fine.ticks).toEqual([2.43101, 2.4310125, 2.431015, 2.4310175, 2.43102]);
    expect(fine.ticks.map(text)).toEqual(["2.43101", "2.4310125", "2.431015", "2.4310175", "2.43102"]);
    expect(fitScale([2.43101, 2.43102]).ticks).toEqual([2.43, 2.44]);
  });

  it("keeps a price near 1e8 to steps of 10, the digits 8 significant digits can tell apart, so that adjacent labels are distinct", () => {
    const tight = price([123456781, 123456789]);
    expect(tight.ticks).toEqual([123456780, 123456790]);
    expect(tight.ticks.map(text)).toEqual(["123,456,780", "123,456,790"]);
    const wide = price([123400000, 123500000]);
    expect(wide.ticks).toEqual([123400000, 123425000, 123450000, 123475000, 123500000]);
    expect(wide.ticks.map(text)).toEqual(["123,400,000", "123,425,000", "123,450,000", "123,475,000", "123,500,000"]);
  });

  it("writes every tick exactly and every adjacent pair differently, on ranges of every size, with at most 5 ticks around the values", () => {
    const ranges: [number, number][] = [
      [0.9995, 1.0005],
      [2.43101, 2.43102],
      [12345.6, 12345.7],
      [12300, 12400],
      [0.00001234, 0.00001236],
      [1.2345e-8, 1.2349e-8],
      [123456781, 123456789],
      [99999999, 100000001],
      [99.9999, 100.0001],
      [9.9999, 10.0001],
      [0.5, 0.5000001],
      [1e8, 1.5e8],
      [-3.2, -3.1],
    ];
    for (const [low, high] of ranges) {
      const scale = price([low, high]);
      const labels = scale.ticks.map(text);
      expect(scale.min, `${low}..${high}`).toBeLessThanOrEqual(low);
      expect(scale.max, `${low}..${high}`).toBeGreaterThanOrEqual(high);
      expect(scale.ticks.length, `${low}..${high}`).toBeGreaterThanOrEqual(2);
      expect(scale.ticks.length, `${low}..${high}`).toBeLessThanOrEqual(5);
      expect(new Set(labels).size, `${low}..${high}: ${labels}`).toBe(labels.length);
      scale.ticks.forEach((tick, k) => expect(readBack(labels[k]!), `${low}..${high}: ${labels[k]}`).toBe(tick));
    }
  });

  it("is the same scale for a price and for every other kind when the compact labels already tell the steps apart", () => {
    expect(price([100, 180]).ticks).toEqual(fitScale([100, 180]).ticks);
    expect(price([98, 140]).ticks).toEqual([80, 100, 120, 140]);
    expect(price([0.9, 3.1]).ticks).toEqual(fitScale([0.9, 3.1]).ticks);
  });

  it("is niceScale's for values that do not vary, and leaves out a null and a value that is not a number", () => {
    expect(price([2.4, 2.4])).toEqual(niceScale([2.4, 2.4]));
    expect(price([])).toEqual(niceScale([]));
    expect(price([null, 2.38, NaN, 2.48, null]).ticks).toEqual([2.35, 2.4, 2.45, 2.5]);
  });
});

describe("percent", () => {
  it("writes a fraction as a percent of at most 2 decimals, with no trailing zeros", () => {
    expect(percent(0.5172)).toBe("51.72%");
    expect(percent(0.51724)).toBe("51.72%");
    expect(percent(0.5)).toBe("50%");
    expect(percent(0)).toBe("0%");
    expect(percent(1)).toBe("100%");
    expect(percent(1 / 3)).toBe("33.33%");
    expect(percent(0.98333)).toBe("98.33%");
  });

  it("takes the decimals to keep: 3 for a segment that is an exact share, so that three thirds show all three", () => {
    expect(percent(2 / 3, 3)).toBe("66.667%");
    expect(percent(1 / 3, 3)).toBe("33.333%");
    expect(percent(0.75, 3)).toBe("75%");
    expect(percent(0.1234, 0)).toBe("12%");
  });

  it("rounds half up and keeps below 0 and above 1, which a mark outside its scale has", () => {
    expect(percent(0.12345)).toBe("12.35%");
    expect(percent(-0.25)).toBe("-25%");
    expect(percent(1.5)).toBe("150%");
  });
});

describe("fractionOf", () => {
  it("is 0 at the bottom of the scale and 1 at the top", () => {
    const scale = niceScale([100]);
    expect(fractionOf(0, scale)).toBe(0);
    expect(fractionOf(100, scale)).toBe(1);
    expect(fractionOf(25, scale)).toBe(0.25);
  });

  it("reaches below 0 on a scale that does", () => {
    const scale = niceScale([-100, 100], { symmetric: true });
    expect(fractionOf(0, scale)).toBe(0.5);
    expect(fractionOf(-100, scale)).toBe(0);
  });

  it("does not divide by nothing", () => {
    expect(fractionOf(5, { min: 5, max: 5, step: 1, ticks: [5] })).toBe(0);
  });
});

describe("xOf", () => {
  it("puts points on i/(n-1), and a lone point in the middle", () => {
    expect(xOf(0, 4, "points")).toBe(0);
    expect(xOf(1, 4, "points")).toBeCloseTo(1 / 3, 12);
    expect(xOf(3, 4, "points")).toBe(1);
    expect(xOf(0, 1, "points")).toBe(0.5);
  });

  it("puts bands at their centres, (i + 1/2)/n", () => {
    expect(xOf(0, 4, "bands") * 1000).toBe(125);
    expect(xOf(3, 4, "bands") * 1000).toBe(875);
    expect(xOf(0, 1, "bands")).toBe(0.5);
  });
});

describe("bucketAt", () => {
  it("finds the nearest bucket", () => {
    expect(bucketAt(0.5, 30, "bands")).toBe(15);
    expect(bucketAt(0, 30, "bands")).toBe(0);
    expect(bucketAt(0.49, 30, "points")).toBe(14);
    expect(bucketAt(0.5, 30, "points")).toBe(15);
  });

  it("clamps to the first and the last bucket", () => {
    expect(bucketAt(1, 30, "points")).toBe(29);
    expect(bucketAt(0.99, 30, "bands")).toBe(29);
    expect(bucketAt(1, 30, "bands")).toBe(29);
    expect(bucketAt(-0.2, 30, "points")).toBe(0);
    expect(bucketAt(1.7, 30, "bands")).toBe(29);
  });

  it("always finds the lone bucket, and never a NaN", () => {
    expect(bucketAt(0.8, 1, "points")).toBe(0);
    expect(bucketAt(0.8, 1, "bands")).toBe(0);
    expect(bucketAt(Number.NaN, 30, "points")).toBe(0);
    expect(bucketAt(0.5, 0, "points")).toBe(0);
  });

  it("is the inverse of xOf", () => {
    for (const placement of ["points", "bands"] as const) {
      for (let i = 0; i < 30; i += 1) expect(bucketAt(xOf(i, 30, placement), 30, placement)).toBe(i);
    }
  });
});

describe("stackOf", () => {
  it("stacks one bucket bottom up, a null taking no height", () => {
    expect(stackOf([3, null, 2])).toEqual([
      { from: 0, to: 3 },
      { from: 3, to: 3 },
      { from: 3, to: 5 },
    ]);
  });

  it("is empty for no series", () => {
    expect(stackOf([])).toEqual([]);
  });
});

describe("linePath", () => {
  it("draws in a 1000-wide box, y = height * (1 - f), a null starting a new run", () => {
    expect(linePath([0, 0.5, null, 1, 0], { height: 200, placement: "points" })).toBe("M0,200L250,100M750,0L1000,200");
  });

  it("trims the numbers to 2 decimals, without trailing zeros", () => {
    expect(linePath([0.123456, 0.5], { height: 160, placement: "points" })).toBe("M0,140.25L1000,80");
  });

  it("steps after: level to the next x, then up or down to its value", () => {
    expect(linePath([1, 0], { height: 100, placement: "points", curve: "step" })).toBe("M0,0L1000,0L1000,100");
    expect(linePath([0, 1, 0.5], { height: 100, placement: "points", curve: "step" })).toBe("M0,100L500,100L500,0L1000,0L1000,50");
  });

  it("starts a step line afresh after a null", () => {
    expect(linePath([1, 0, null, 0.5, 1], { height: 100, placement: "points", curve: "step" })).toBe("M0,0L250,0L250,100M750,50L1000,50L1000,0");
  });

  describe("a step line, compressed", () => {
    const step = { height: 100, placement: "points", curve: "step" } as const;
    const commandsOf = (d: string) => d.match(/[ML]/g)?.length ?? 0;

    it("emits a vertex only where the value changes: a run of one value is one segment", () => {
      expect(linePath([0.5, 0.5, 0.5], step)).toBe("M0,50L1000,50");
      expect(linePath([1, 1, 1, 0.5, 0.5, 0, 0], step)).toBe("M0,0L500,0L500,50L833.33,50L833.33,100L1000,100");
      // A change at the last bucket is its own corner, and the line ends there.
      expect(linePath([0, 0, 1], step)).toBe("M0,100L1000,100L1000,0");
      // A change at the first step: no run before it to shorten.
      expect(linePath([0, 1, 1, 1], step)).toBe("M0,100L333.33,100L333.33,0L1000,0");
    });

    it("makes a path of 2,600 values with 5 changes of 12 commands", () => {
      const fractions = Array.from({ length: 2600 }, (_, i) => [0.2, 0.4, 0.6, 0.4, 0.8, 1].at(i < 400 ? 0 : i < 900 ? 1 : i < 1500 ? 2 : i < 2100 ? 3 : i < 2500 ? 4 : 5)!);
      const d = linePath(fractions, step);
      // M, then a corner and a rise for each change (5 × 2), then the end of the last run.
      expect(commandsOf(d)).toBe(12);
      expect(d.startsWith("M0,80L")).toBe(true);
      expect(d.endsWith("L1000,0")).toBe(true);
      expect(commandsOf(linePath(fractions, { ...step, curve: "linear" }))).toBe(2600);
    });

    it("draws the line it drew: every corner of the uncompressed path is on the compressed one", () => {
      // A staircase with flats of different lengths; the compressed path is read back as a function of x and compared at each bucket.
      const fractions = [0, 0, 0.25, 0.25, 0.25, 0.75, 0.5, 0.5, 1, 1, 1, 1, 0];
      const compressed = linePath(fractions, step)
        .split(/(?=[ML])/)
        .map((c) => c.slice(1).split(",").map(Number) as [number, number]);
      const levelAt = (x: number): number => {
        let level = NaN;
        // The path's numbers are rounded to 2 decimals, so a vertex at x may be written a hair to its right.
        for (const [px, py] of compressed) if (px <= x + 0.01) level = py;
        return level;
      };
      fractions.forEach((f, i) => {
        // Step-after: the line is at this bucket's value from its x up to the next bucket's, so a vertex of the line at x is that level.
        const x = xOf(i, fractions.length, "points") * 1000;
        expect(levelAt(x), `bucket ${i}`).toBeCloseTo(100 * (1 - f), 1);
      });
    });

    it("breaks at a null as it did, and compresses each run on its own", () => {
      expect(linePath([1, 1, null, 0.5, 0.5, 1], step)).toBe("M0,0L200,0M600,50L1000,50L1000,0");
      expect(linePath([1, 1, 1, null, 0.5, 0.5, 0.5], step)).toBe("M0,0L333.33,0M666.67,50L1000,50");
      expect(linePath([null, 0.5, 0.5, null], step)).toBe("M333.33,50L666.67,50");
    });

    it("keeps a lone point as its dot and leaves the linear curve alone", () => {
      expect(linePath([null, 0.5, null], step)).toBe("M500,50L500,50");
      expect(linePath([0.5, 0.5, 0.5], { height: 100, placement: "points" })).toBe("M0,50L500,50L1000,50");
    });
  });

  it("places bands at their centres", () => {
    expect(linePath([0, 1], { height: 100, placement: "bands" })).toBe("M250,100L750,0");
  });

  it("puts a lone point in the middle", () => {
    expect(linePath([0.5], { height: 100, placement: "points" })).toMatch(/^M500,50/);
  });

  it("gives a value that has a null on each side a zero-length segment, which a round cap draws as a dot: `M x,y` alone draws nothing", () => {
    expect(linePath([0.5], { height: 100, placement: "points" })).toBe("M500,50L500,50");
    expect(linePath([0, null, 1, null, 0], { height: 100, placement: "points" })).toBe("M0,100L0,100M500,0L500,0M1000,100L1000,100");
    // Each run that has a line keeps it as it was.
    expect(linePath([0, 1, null, 0.5, null, null, 0], { height: 100, placement: "points" })).toBe("M0,100L166.67,0M500,50L500,50M1000,100L1000,100");
  });

  it("gives a lone point of a step line the same mark, and a run of two the step it always had", () => {
    expect(linePath([null, 0.5, null], { height: 100, placement: "points", curve: "step" })).toBe("M500,50L500,50");
    expect(linePath([null, 1, 0, null], { height: 100, placement: "points", curve: "step" })).toBe("M333.33,0L666.67,0L666.67,100");
  });

  it("is empty when there is nothing to draw", () => {
    expect(linePath([], { height: 100, placement: "points" })).toBe("");
    expect(linePath([null, null], { height: 100, placement: "points" })).toBe("");
  });

  it("draws in a box of the width it is given when there is one (a sparkline's is its own), x = width * the place", () => {
    expect(linePath([0, 0.5, 1], { height: 16, width: 88, placement: "points" })).toBe("M0,16L44,8L88,0");
    expect(linePath([0, null, 1], { height: 16, width: 88, placement: "points" })).toBe("M0,16L0,16M88,0L88,0");
    expect(linePath([0, 1], { height: 16, width: 88, placement: "points", curve: "step" })).toBe("M0,16L88,16L88,0");
  });
});

describe("areaPath", () => {
  it("closes the line to the baseline", () => {
    expect(areaPath([0.5, 0.5], { height: 100, placement: "points" })).toBe("M0,50L1000,50L1000,100L0,100Z");
  });

  it("draws one sub-path for each run without a null", () => {
    expect(areaPath([1, 0.5, null, 0.5, 1], { height: 100, placement: "points" })).toBe(
      "M0,0L250,50L250,100L0,100Z" + "M750,50L1000,0L1000,100L750,100Z",
    );
  });

  it("follows the steps", () => {
    expect(areaPath([1, 0], { height: 100, placement: "points", curve: "step" })).toBe("M0,0L1000,0L1000,100L0,100Z");
  });

  it("follows the compressed steps: a flat run is one edge", () => {
    expect(areaPath([0.5, 0.5, 0.5], { height: 100, placement: "points", curve: "step" })).toBe("M0,50L1000,50L1000,100L0,100Z");
    expect(areaPath([1, 1, 0, 0], { height: 100, placement: "points", curve: "step" })).toBe("M0,0L666.67,0L666.67,100L1000,100L0,100Z");
  });

  it("is empty when there is nothing to fill", () => {
    expect(areaPath([], { height: 100, placement: "points" })).toBe("");
    expect(areaPath([null], { height: 100, placement: "points" })).toBe("");
  });

  it("starts at the first value after a leading null, and not at the left edge", () => {
    expect(areaPath([null, null, 0.5, 1], { height: 100, placement: "points" })).toBe("M666.67,50L1000,0L1000,100L666.67,100Z");
    expect(areaPath([null, 1, 0.5], { height: 100, placement: "points", curve: "step" })).toBe("M500,0L1000,0L1000,50L1000,100L500,100Z");
  });

  it("ends at the last value before a trailing null, and not at the right edge", () => {
    expect(areaPath([1, 0.5, null, null], { height: 100, placement: "points" })).toBe("M0,0L333.33,50L333.33,100L0,100Z");
    expect(areaPath([0.5, 1, null], { height: 100, placement: "points", curve: "step" })).toBe("M0,50L500,50L500,0L500,100L0,100Z");
  });

  it("is a closed sliver of no width for a single point, which fills nothing: the line's own mark is what shows", () => {
    expect(areaPath([null, 0.5, null], { height: 100, placement: "points" })).toBe("M500,50L500,100Z");
    expect(areaPath([0.5], { height: 100, placement: "points" })).toBe("M500,50L500,100Z");
  });

  it("keeps a run of one point between two runs as the sliver it is, and the runs on each side whole", () => {
    expect(areaPath([1, 1, null, 0.5, null, 1, 1], { height: 100, placement: "points" })).toBe(
      "M0,0L166.67,0L166.67,100L0,100Z" + "M500,50L500,100Z" + "M833.33,0L1000,0L1000,100L833.33,100Z",
    );
  });
});

describe("areaPath's width", () => {
  it("is the width of the box it is given, as the line's is", () => {
    expect(areaPath([0, 1], { height: 16, width: 88, placement: "points" })).toBe("M0,16L88,0L88,16L0,16Z");
  });
});

describe("keptEndLabels", () => {
  it("drops a later label that would sit within the gap of one that is kept", () => {
    expect(keptEndLabels([50, 60, 100])).toEqual([true, false, true]);
  });

  it("compares with the labels that are drawn, not with those that were left out", () => {
    expect(keptEndLabels([50, 60, 70])).toEqual([true, false, true]);
  });

  it("keeps a label exactly the gap away, and has a gap of 16 px unless told", () => {
    expect(keptEndLabels([50, 66])).toEqual([true, true]);
    expect(keptEndLabels([50, 65.9])).toEqual([true, false]);
    expect(keptEndLabels([50, 70], 25)).toEqual([true, false]);
  });

  it("works in series order, whichever is higher", () => {
    expect(keptEndLabels([100, 90, 50])).toEqual([true, false, true]);
  });

  it("gives no label to a series that has no value", () => {
    expect(keptEndLabels([null, 10, null, 12])).toEqual([false, true, false, false]);
  });
});

describe("xLabelPicks", () => {
  it("takes every k-th bucket from the newest, k = ceil(n/6) wide and ceil(n/3) narrow, oldest first", () => {
    expect(xLabelPicks(30, "wide")).toEqual([4, 9, 14, 19, 24, 29]);
    expect(xLabelPicks(30, "narrow")).toEqual([9, 19, 29]);
    expect(xLabelPicks(52, "wide")).toEqual([6, 15, 24, 33, 42, 51]);
    expect(xLabelPicks(7, "wide")).toEqual([0, 2, 4, 6]);
  });

  it("spaces the labels of a month axis as those of a day axis of the same length: it counts buckets, not units", () => {
    // 166 months: every 28th (ceil(166/6)), counting from the newest.
    expect(xLabelPicks(166, "wide")).toEqual([25, 53, 81, 109, 137, 165]);
    expect(xLabelPicks(166, "narrow")).toEqual([53, 109, 165]);
  });

  it("labels each bucket of a short axis", () => {
    expect(xLabelPicks(1, "wide")).toEqual([0]);
    expect(xLabelPicks(6, "wide")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(xLabelPicks(3, "narrow")).toEqual([0, 1, 2]);
  });

  it("labels nothing on an empty axis", () => {
    expect(xLabelPicks(0, "wide")).toEqual([]);
    expect(xLabelPicks(0, "ends")).toEqual([]);
  });

  it("labels the two ends only when asked (a small multiple), the one bucket of a lone axis, and at any width the same", () => {
    expect(xLabelPicks(30, "ends")).toEqual([0, 29]);
    expect(xLabelPicks(2, "ends")).toEqual([0, 1]);
    expect(xLabelPicks(1, "ends")).toEqual([0]);
  });
});

describe("tooltipSide", () => {
  it("flips to the right under 22% and to the left over 78%, else centres", () => {
    expect(tooltipSide(0.21)).toBe("right");
    expect(tooltipSide(0.22)).toBe("center");
    expect(tooltipSide(0.78)).toBe("center");
    expect(tooltipSide(0.79)).toBe("left");
    expect(tooltipSide(0)).toBe("right");
    expect(tooltipSide(1)).toBe("left");
  });
});

describe("the constants of the spec", () => {
  it("has the minimum slot, the plot heights and the end-label gutter of section 2.7", () => {
    expect(MIN_SLOT_PX).toBe(5);
    expect(PLOT_HEIGHT).toEqual({ wide: 200, narrow: 160 });
    expect(END_LABEL_GUTTER_PX).toBe(112);
    expect(PANEL_HEIGHT).toBe(110);
  });
});
