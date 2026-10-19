import { describe, expect, it } from "vitest";

import {
  areaPath,
  bucketAt,
  END_LABEL_GUTTER_PX,
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
