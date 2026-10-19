// The geometry of the chart kit (spec sections 2.2, 2.4 and 2.7): value scales with nice ticks, where a bucket sits along the x axis,
// stacks, the path data of lines, areas and steps, and which end labels and x labels fit. Pure functions of numbers: no DOM, no
// clock, no `Intl`, so the Worker and the browser draw the same marks. The kit parses the view builder's decimal strings with
// `Number()` for this and for nothing else; every text a chart shows is made from the strings (labels.ts).

export type Placement = "points" | "bands";

export interface ValueScale {
  /** The bottom of the scale: 0 unless a value is below it, or the line takes a domain. */
  min: number;
  /** The top: the last tick, at or above the largest value. */
  max: number;
  step: number;
  /** `min`, then each step up to `max`. */
  ticks: readonly number[];
}

/** A column slot is at least this wide; a plot with more buckets than its width holds at this density scrolls (spec 2.7). */
export const MIN_SLOT_PX = 5;
/** The plot's height in px: 160 under a 480 px container (spec 2.7). */
export const PLOT_HEIGHT = { wide: 200, narrow: 160 } as const;
/** The plot of a small multiple is this high at any width, in px (charts.css: `.plot__frame--panel`). */
export const PANEL_HEIGHT = 110;
/** The room right of a line chart for its end labels, on wide plots (spec 2.7). */
export const END_LABEL_GUTTER_PX = 112;

/** The width of the box the paths are drawn in: `<svg viewBox="0 0 1000 H" preserveAspectRatio="none">`. */
const BOX_WIDTH = 1000;
/** The nice steps are these times a power of ten. */
const STEP_MANTISSAS = [1, 2, 2.5, 5] as const;
/** Slack for the floating point error of a division that should come out whole. */
const EPSILON = 1e-9;

/** A number without the noise of floating point arithmetic (`0.30000000000000004` is `0.3`), and no negative zero. */
const clean = (value: number): number => Number(value.toPrecision(12));

/** The nice step that is at least `atLeast` and accepted by `accept`: the smallest of {1, 2, 2.5, 5} × 10ⁿ, or `undefined` past `limit`. */
function niceStep(atLeast: number, limit: number, accept: (step: number) => boolean): number | undefined {
  for (let exponent = Math.floor(Math.log10(atLeast)) - 1; ; exponent += 1) {
    for (const mantissa of STEP_MANTISSAS) {
      const step = Number(`${mantissa}e${exponent}`);
      if (step > limit) return undefined;
      if (step >= atLeast * (1 - EPSILON) && accept(step)) return step;
    }
  }
}

/** The largest whole step of the set that is below `span`, or `undefined` for a span of 1 or less. */
function wholeStepBelow(span: number): number | undefined {
  const largestFirst = [...STEP_MANTISSAS].reverse();
  for (let exponent = Math.ceil(Math.log10(span)); exponent >= 0; exponent -= 1) {
    for (const mantissa of largestFirst) {
      const step = Number(`${mantissa}e${exponent}`);
      if (isWhole(step) && step < span * (1 - EPSILON)) return step;
    }
  }
  return undefined;
}

/** How many `step`s it takes to cover `distance`. */
const stepsIn = (distance: number, step: number): number => Math.ceil(distance / step - EPSILON);

const isWhole = (step: number): boolean => Number.isInteger(step);

function scaleOf(min: number, step: number, steps: number): ValueScale {
  const ticks = Array.from({ length: steps + 1 }, (_, k) => clean(min + k * step));
  return { min: ticks[0]!, max: ticks.at(-1)!, step: clean(step), ticks };
}

/**
 * The scale of a chart's values: 0 at the bottom (a column, a bar and an area always start there) unless a value is below it, and a
 * top tick at or above the largest value. The step is the smallest of {1, 2, 2.5, 5} × 10ⁿ that gives 4 or 5 ticks (`ticks: 5`, the
 * default: at least a quarter of the span) or 3 or 4 (`ticks: 3`: at least half of it).
 *
 * - `integer`: only whole steps, and never less than 0 to 4 (a count of 2 is not stretched over 0 to 2). With `ticks: 3` the step is
 *   below the span, so that a count of 5 is 0, 2, 4, 6 and not 0, 5, which is two ticks and nothing between them.
 * - `from`, `to`: the domain of a line. The scale starts at `from`. It ends at `to` when a step divides `from` to `to` evenly, else at the
 *   first tick above it; a value above `to` is still on the scale.
 * - `symmetric`: the positive side, mirrored about 0, for the columns that go up and down.
 * - No value (or only 0): 0 to 4 with `integer`, else 0 to 1.
 */
export function niceScale(
  values: readonly (number | null)[],
  opts: { integer?: boolean; from?: number; to?: number; ticks?: 3 | 5; symmetric?: boolean } = {},
): ValueScale {
  const { integer = false, from, to, ticks: tickCount = 5, symmetric = false } = opts;
  const numbers = values.filter((v): v is number => v !== null && Number.isFinite(v));

  if (symmetric) {
    const half = niceScale([Math.max(0, ...numbers.map(Math.abs))], { integer, ticks: tickCount });
    const ticks = [...half.ticks.slice(1).reverse().map((t) => -t), ...half.ticks];
    return { min: -half.max, max: half.max, step: half.step, ticks };
  }

  const low = from ?? Math.min(0, ...numbers);
  const high = Math.max(...numbers, to ?? -Infinity, from ?? 0);
  const span = high - low;
  const share = tickCount === 3 ? 2 : 4;
  // One step over all of the span is 2 ticks. A count takes a whole step under it instead: there may be none (a span of 1).
  const under = integer && tickCount === 3 ? span * (1 - EPSILON) : Infinity;

  // The scale of nothing to draw, and the least a count is spread over: a count of 2 is 0 to 4, not 0 to 2.
  const smallest = (): ValueScale => {
    if (integer) return scaleOf(low, tickCount === 3 ? 2 : 1, tickCount === 3 ? 2 : 4);
    return scaleOf(low, tickCount === 3 ? 0.5 : 0.25, tickCount === 3 ? 2 : 4);
  };
  if (!(span > 0 && Number.isFinite(span))) return smallest();

  // A line that ends at `to`: the largest value is `to` itself, so the step has to divide the domain.
  if (to !== undefined && high === to && (from !== undefined || low === 0)) {
    const step = niceStep(span / share, span, (s) => (!integer || isWhole(s)) && s < under && Math.abs(span / s - Math.round(span / s)) < EPSILON);
    if (step !== undefined) return scaleOf(low, step, Math.round(span / step));
  }

  // Counts take the next whole step when none in the usual range is whole: 10 is 0, 5, 10 (not eleven ticks), 9 is 0, 5, 10.
  const found = niceStep(span / share, Infinity, integer ? isWhole : () => true)!;
  const step = found < under ? found : (wholeStepBelow(span) ?? found);
  const min = from ?? clean(Math.floor(low / step) * step);
  const scale = scaleOf(min, step, stepsIn(high - min, step));
  return integer && scale.min === 0 && scale.max < 4 ? smallest() : scale;
}

/** Where `value` is on `scale`: 0 at `scale.min`, 1 at `scale.max`. */
export function fractionOf(value: number, scale: ValueScale): number {
  const range = scale.max - scale.min;
  return range > 0 ? (value - scale.min) / range : 0;
}

/** A fraction of a plot as a percent for its `style`: `51.72%`, rounded to `decimals` (2) and with no trailing zeros. A segment that is an exact share has 3. */
export const percent = (fraction: number, decimals = 2): string => `${Math.round(fraction * 10 ** (decimals + 2)) / 10 ** decimals}%`;

/** The fraction of the plot's width that bucket `i` of `n` is at: points on i/(n−1) (the middle for a lone one), bands at their centres. */
export function xOf(i: number, n: number, placement: Placement): number {
  if (placement === "points") return n > 1 ? i / (n - 1) : 0.5;
  return (i + 0.5) / Math.max(n, 1);
}

/** The bucket nearest `fraction` of the plot's width, from 0 to n−1: the inverse of `xOf`. */
export function bucketAt(fraction: number, n: number, placement: Placement): number {
  if (!(n > 0) || Number.isNaN(fraction)) return 0;
  const nearest = placement === "points" ? Math.round(fraction * (n - 1)) : Math.floor(fraction * n);
  return Math.min(n - 1, Math.max(0, nearest));
}

/** One bucket of a stacked column: the span of each series from the bottom up, in value units. A `null` has no height. */
export function stackOf(values: readonly (number | null)[]): { from: number; to: number }[] {
  let top = 0;
  return values.map((value) => {
    const from = top;
    if (value !== null && Number.isFinite(value)) top += value;
    return { from, to: top };
  });
}

type Point = readonly [x: number, y: number];
export interface PathOptions {
  /** The height of the box the path is drawn in, which is 1000 wide. */
  height: number;
  placement: Placement;
  /** `"step"` is step-after: level to the next bucket, then up or down to its value. */
  curve?: "linear" | "step";
}

/** The points of each run of buckets without a `null`, in the box: `y = height × (1 − f)`. */
function runsOf(fractions: readonly (number | null)[], { height, placement }: PathOptions): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] | undefined;
  for (const [i, f] of fractions.entries()) {
    if (f === null || !Number.isFinite(f)) {
      run = undefined;
    } else {
      if (!run) runs.push((run = []));
      run.push([xOf(i, fractions.length, placement) * BOX_WIDTH, height * (1 - f)]);
    }
  }
  return runs;
}

function outline(run: Point[], curve: PathOptions["curve"]): Point[] {
  if (curve !== "step") return run;
  return run.flatMap((point, i) => (i === 0 ? [point] : [[point[0], run[i - 1]![1]] as const, point]));
}

/** At most 2 decimals, trailing zeros trimmed (`333.33`, `100`). */
const num = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * `M x,y L x,y …` with no spaces, leaving out a point that is where the one before it is. A lone point is `M x,y L x,y`, a segment of no
 * length: with round caps that is a dot, where `M x,y` alone draws nothing.
 */
function commands(points: Point[]): string {
  let text = "";
  let previous = "";
  for (const point of points) {
    const here = `${num(point[0])},${num(point[1])}`;
    if (here === previous) continue;
    text += `${previous ? "L" : "M"}${here}`;
    previous = here;
  }
  return previous && !text.includes("L") ? `${text}L${previous}` : text;
}

/**
 * The path of a line in a `1000 × height` box. `fractions` are 0 to 1 (`fractionOf`); a `null` breaks the line, and the next point starts
 * with `M`. A value between two `null`s is a zero-length segment, which a round cap draws as a dot.
 */
export function linePath(fractions: readonly (number | null)[], opts: PathOptions): string {
  return runsOf(fractions, opts).map((run) => commands(outline(run, opts.curve))).join("");
}

/** The path of the area under a line: closed to the baseline, one sub-path for each run of buckets without a `null`. */
export function areaPath(fractions: readonly (number | null)[], opts: PathOptions): string {
  return runsOf(fractions, opts)
    .map((run) => {
      const edge = outline(run, opts.curve);
      const [first, last] = [edge[0]!, edge.at(-1)!];
      return `${commands([...edge, [last[0], opts.height], [first[0], opts.height]])}Z`;
    })
    .join("");
}

/**
 * Which end labels of a line chart are drawn. `ys` are the labels' px from the top of the plot at 160 px, in the series' order, `null`
 * for a series with no value to label. A later label is left out when it would sit within `minGap` px of one that is drawn.
 */
export function keptEndLabels(ys: readonly (number | null)[], minGap = 16): boolean[] {
  const drawn: number[] = [];
  return ys.map((y) => {
    if (y === null || !Number.isFinite(y) || drawn.some((other) => Math.abs(y - other) < minGap)) return false;
    drawn.push(y);
    return true;
  });
}

/**
 * Which buckets of an axis of `n` get an x label: every k-th counting back from the newest, k = ⌈n/6⌉ wide and ⌈n/3⌉ narrow; the two
 * ends only for `"ends"`, which is a small multiple's. Oldest first.
 */
export function xLabelPicks(n: number, width: "wide" | "narrow" | "ends"): number[] {
  if (!(n > 0)) return [];
  if (width === "ends") return n > 1 ? [0, n - 1] : [0];
  const every = Math.ceil(n / (width === "wide" ? 6 : 3));
  const picks: number[] = [];
  for (let i = n - 1; i >= 0; i -= every) picks.unshift(i);
  return picks;
}

/** Which side of the cursor the tooltip opens on: right under 22% of the plot's width, left over 78%, else centred. */
export function tooltipSide(fraction: number): "right" | "left" | "center" {
  if (fraction < 0.22) return "right";
  return fraction > 0.78 ? "left" : "center";
}
