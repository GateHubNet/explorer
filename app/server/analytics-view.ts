// What the Analytics tab of the account page shows (spec 2.2, 3.1, 3.3 to 3.5 and 3.11), worked out in the Worker from the data API's answers: the
// frame (the period, its buckets and the note that says what they are) and the cards that read one call each. Every builder is pure: no I/O, no
// clock, no `Intl`. Every sum, difference and quotient goes through bignumber.js and is handed on as a string, so no float reaches a string of the
// page, and the page draws only the strings these builders give it.
//
// A card's rows are aligned to the frame's buckets by the day their `date` starts with; a row outside the frame (an index that is behind makes the
// API's now a day after `T`) is ignored.

import BigNumber from "bignumber.js";

import { analyticsPhrases, type AnalyticsPeriod, type AnalyticsPhrases, type AnalyticsWindow } from "../domain/analytics-params";
import { tokenOf } from "../domain/fnv";
import { formatAmount, formatChange, formatValue } from "../domain/format";
import type { Native } from "../domain/parse/types";
import { groupCounts, typeGroups, typeGroupsNote } from "../domain/type-groups";
import { niceScale } from "../ui/charts/geometry";
import { bucketLabel } from "../ui/charts/labels";
import type { TimeAxis, TimeSeriesData } from "../ui/charts/types";
import type { AccountTxStatsRow, AccountValueRow, Page } from "./api-types";
import type { NetworkId } from "./networks";

/** A card of the tab: what its call gave, or that it failed or came too late (spec 2.8). Each stands on its own. */
export type CardState<T> = ({ state: "ok" } & T) | { state: "failed" } | { state: "late" };

/** What a `StatTile` shows (spec 3.3). */
export interface AnalyticsTile {
  /** "16,787.15 XRP"; "—" when there is nothing to show or the account was deleted. */
  figure: string;
  /** "3 failed, fee still paid", "Deleted accounts hold nothing". */
  sub: string | null;
  /** E2's delta of the tile: the signed text ("+4.2%"), which way it points, and the words that name what it is over ("over the last 30 days"). */
  delta: { text: string; direction: "up" | "down" | "flat"; words: string } | null;
  /** The route the tile is made from, with the view's interval: "/v2/accounts/{a}/stats/value?interval=day". */
  source: string;
}

/** The window of the view and the words about it, which every card reads (spec 2.2). */
export interface AnalyticsFrame {
  period: AnalyticsPeriod;
  axis: TimeAxis;
  /** S: the first bucket, the `start` of every call. */
  start: string;
  phrase: AnalyticsPhrases;
  /** The whole period note. */
  note: string;
  deleted: boolean;
}

export interface ValueCard {
  tile: AnalyticsTile;
  chart: TimeSeriesData;
  notes: string[];
  source: string;
}
export interface SentCard {
  tile: AnalyticsTile;
  chart: TimeSeriesData;
  notes: string[];
  source: string;
}

const DASH = "—";
const MINUS = "−";
const ZERO = new BigNumber(0);

// ---- What every builder shares -----------------------------------------------------------------------------------------------------

/** A decimal string of the API as a number; one that is not a finite number is a card that cannot be built, never a "NaN" in the page. */
function numberOf(value: string, field: string): BigNumber {
  const number = new BigNumber(value);
  if (!number.isFinite()) throw new Error(`${field} is not a number: ${value}`);
  return number;
}

/** The chart's data with its token, which is the hash of everything the chart draws, extras and words included. */
function tokened(data: Omit<TimeSeriesData, "token">): TimeSeriesData {
  return { ...data, token: tokenOf(data) };
}

/** The rows by the day their `date` starts with, laid on the frame's buckets: the row of each bucket, or `null` where it has none. */
function aligned<R extends { date: string }>(buckets: readonly string[], rows: readonly R[]): (R | null)[] {
  const byDay = new Map<string, R>();
  for (const row of rows) byDay.set(row.date.slice(0, 10), row);
  return buckets.map((bucket) => byDay.get(bucket) ?? null);
}

/** `n ÷ d` (d above 0) to `places` decimals, half away from zero, exactly: BigNumber's own division rounds at 20 places before we round. */
function divided(n: BigNumber, d: BigNumber, places: number): BigNumber {
  const rounded = n.abs().shiftedBy(places).times(2).plus(d).idiv(d.times(2)).shiftedBy(-places);
  return n.isNegative() && !rounded.isZero() ? rounded.negated() : rounded;
}

// ---- The frame ---------------------------------------------------------------------------------------------------------------------

/** A bucket's date, with its year or without: "Oct 20, 2025", "Oct 20" (a month is "Oct 2026" either way). */
const dateOf = (bucket: string, unit: TimeAxis["unit"], withYear: boolean): string => bucketLabel(bucket, unit, withYear ? "table" : "axis");

/** The period's own sentence (spec 2.2): what the buckets are, and from where. */
function periodSentence(window: AnalyticsWindow): string {
  const { period, unit, buckets, origin } = window;
  const first = buckets[0]!;
  const last = buckets[buckets.length - 1]!;

  if (period === "all") {
    const month = bucketLabel(first, "month", "axis");
    if (origin === "activation") return `Since ${month}, the month it was activated, per month (UTC).`;
    if (origin === "oldest") return `Since ${month}, the month of its oldest transaction in the index, per month (UTC).`;
    return "This month (UTC): the index has no transaction of this account yet.";
  }

  // The start shows its year only when it differs from the end's.
  const start = dateOf(first, unit, first.slice(0, 4) !== last.slice(0, 4));
  if (unit === "week") {
    return `The ${buckets.length} weeks from ${start} to the week of ${dateOf(last, unit, true)} (UTC, weeks from Monday), per week.`;
  }
  return `The ${buckets.length} days from ${start} to ${dateOf(last, unit, true)} (UTC), per day.`;
}

/**
 * The frame of the view for a window: its buckets and unit, the words that name its period, and the period note, which says in order what the
 * buckets are, that the last one is running, that the account was deleted (its history is All's), and that All is young (spec 2.2).
 */
export function analyticsFrame(window: AnalyticsWindow, opts: { deleted: boolean }): AnalyticsFrame {
  const { period, unit, buckets, start } = window;
  const note = [
    periodSentence(window),
    `The last ${unit} is counted up to now.`,
    ...(opts.deleted ? ["This account was deleted; All covers its whole history."] : []),
    ...(period === "all" && buckets.length < 3 ? ["It is younger than three months; 30 days and 90 days show it per day."] : []),
  ].join(" ");
  return {
    period,
    axis: { unit, buckets },
    start,
    phrase: analyticsPhrases(period, bucketLabel(start, "month", "axis")),
    note,
    deleted: opts.deleted,
  };
}

// ---- The account value -------------------------------------------------------------------------------------------------------------

/**
 * The change of the last value over the base, the first row of the window (spec 3.3): `(last ÷ base − 1) × 100` to 1 decimal, half up, with its sign
 * and the words that name the base. `null` when there is no row, when the base is 0, and when the last bucket is the base itself (one row, so
 * nothing to compare it with).
 */
function valueDelta(frame: AnalyticsFrame, values: readonly (BigNumber | null)[]): AnalyticsTile["delta"] {
  const { axis, phrase, period } = frame;
  const baseAt = values.findIndex((value) => value !== null);
  const last = values[values.length - 1];
  if (baseAt < 0 || baseAt === values.length - 1 || !last) return null;
  const base = values[baseAt]!;
  if (!base.gt(0)) return null;

  const percent = divided(last.minus(base).times(100), base, 1);
  const direction = percent.isZero() ? "flat" : percent.isNegative() ? "down" : "up";
  const sign = direction === "up" ? "+" : direction === "down" ? MINUS : "";
  const words =
    baseAt > 0 ? `since ${bucketLabel(axis.buckets[baseAt]!, axis.unit, "axis")}` : period === "all" ? phrase.title : `over the ${phrase.title}`;
  return { text: `${sign}${formatAmount(percent.abs().toFixed(1))}%`, direction, words };
}

/**
 * The nice floor of the axis of a line that stays far above 0 (spec 3.4): ⌊min ÷ step⌋ × step, where the step is the nice step of a third of the
 * range, that is the smallest of {1, 2, 2.5, 5} × 10ⁿ at or above it. `niceScale` gives the smallest such step at or above a quarter of the
 * largest value it is given, so it is given 4⁄3 of the range, and the step it answers is read back as the decimal it is. `null` when the floor is
 * not above 0 (the axis then starts at 0, as every area does) or when the values are all equal.
 */
function valueFloor(values: readonly (BigNumber | null)[]): BigNumber | null {
  const present = values.filter((value): value is BigNumber => value !== null);
  if (present.length === 0) return null;
  const min = BigNumber.minimum(...present);
  const range = BigNumber.maximum(...present).minus(min);
  if (!range.gt(0) || !min.gt(0)) return null;

  const step = new BigNumber(String(niceScale([range.times(4).div(3).toNumber()]).step));
  const floor = min.idiv(step).times(step);
  return floor.gt(0) ? floor : null;
}

/**
 * The account value (spec 3.3 and 3.4): tile 1 and the line. Each bucket is its row's value, and a bucket without a row (the buckets before the
 * account had a balance) is `null`. The extra "Change" is the change from the bucket before, in percent, as text.
 */
export function valueCard(frame: AnalyticsFrame, page: Page<"rows", AccountValueRow>, native: Native): ValueCard {
  const { axis, phrase } = frame;
  const source = `/v2/accounts/{a}/stats/value?interval=${axis.unit}`;
  const values = aligned(axis.buckets, page.rows).map((row) => (row ? numberOf(row.account_value, "account_value") : null));

  const change = values.map((value, i) => {
    const before = i > 0 ? values[i - 1]! : null;
    if (!value || !before || !before.gt(0)) return null;
    return `${formatChange(divided(value.minus(before).times(100), before, 2).toFixed())}%`;
  });

  const floor = valueFloor(values);
  const chart = tokened({
    axis,
    series: [{ id: "value", label: "Account value", slot: 1, values: values.map((value) => value?.toFixed() ?? null) }],
    format: { kind: "value", unit: native },
    ...(floor ? { domain: { min: floor.toFixed() } } : {}),
    extras: [{ id: "change", label: "Change", values: change }],
    emptyText: `No balance in ${phrase.empty}`,
    forming: true,
  });

  const firstAt = values.findIndex((value) => value !== null);
  const notes = [
    `${native} plus every token held, valued at the end of each ${axis.unit}.`,
    ...(floor ? [`The axis starts at ${formatValue(floor.toFixed())} ${native}.`] : []),
    ...(firstAt > 0 ? [`No value before ${bucketLabel(axis.buckets[firstAt]!, axis.unit, "axis")}: the account had no balance until then.`] : []),
  ];

  const last = values[values.length - 1];
  const tile: AnalyticsTile = frame.deleted
    ? { figure: DASH, sub: "Deleted accounts hold nothing", delta: null, source }
    : { figure: last ? `${formatValue(last.toFixed())} ${native}` : DASH, sub: null, delta: valueDelta(frame, values), source };
  return { tile, chart, notes, source };
}

// ---- The transactions sent ---------------------------------------------------------------------------------------------------------

/** What a row counts as failed: every result code but `tesSUCCESS` (a failed transaction still paid its fee). */
function failedIn(row: AccountTxStatsRow): BigNumber {
  return Object.entries(row.result).reduce((sum, [code, count]) => (code === "tesSUCCESS" ? sum : sum.plus(count)), ZERO);
}

/**
 * The transactions the account sent (spec 3.3 and 3.5): tile 2 and the stacked columns, one series for each type group of the network. A bucket
 * without a row is 0 once the answer has a row in the frame, and every bucket is `null` when it has none. The extra "Failed" is the bucket's failed
 * count as grouped text; a bucket with one has the annotation "×", which the legend explains.
 */
export function sentCard(frame: AnalyticsFrame, page: Page<"rows", AccountTxStatsRow>, network: NetworkId): SentCard {
  const { axis, phrase } = frame;
  const source = `/v2/accounts/{a}/stats/transactions?interval=${axis.unit}`;
  const rows = aligned(axis.buckets, page.rows);
  const any = rows.some((row) => row !== null);

  // The counts of each bucket by group (all 0 for a bucket without a row), or `null` in every bucket when the frame has no row at all.
  const counts = rows.map((row) => (any ? groupCounts(network, row?.type ?? {}) : null));
  const totals = counts.map((count) => (count ? Object.values(count).reduce((sum, n) => sum.plus(n), ZERO) : null));
  const failed = rows.map((row) => (row ? failedIn(row) : ZERO));

  const chart = tokened({
    axis,
    series: typeGroups(network).map((group) => ({
      id: group.id,
      label: group.label,
      slot: group.slot,
      values: counts.map((count) => count?.[group.id] ?? null),
    })),
    format: { kind: "count" },
    totals: totals.map((total) => total?.toFixed() ?? null),
    annotations: failed.flatMap((count, bucket) => (count.gt(0) ? [{ bucket, symbol: "×", label: "has a failed transaction" }] : [])),
    extras: [{ id: "failed", label: "Failed", values: failed.map((count) => (any ? formatAmount(count.toFixed()) : null)) }],
    emptyText: `No transactions sent in ${phrase.empty}`,
    forming: true,
  });

  const sent = totals.reduce<BigNumber>((sum, total) => (total ? sum.plus(total) : sum), ZERO);
  const failedTotal = failed.reduce((sum, count) => sum.plus(count), ZERO);
  const tile: AnalyticsTile = {
    figure: formatAmount(sent.toFixed()),
    sub: failedTotal.gt(0) ? `${formatAmount(failedTotal.toFixed())} failed, fee still paid` : "none failed",
    delta: null,
    source,
  };
  return {
    tile,
    chart,
    notes: ["Transactions this account sent; a failed one still paid its fee.", typeGroupsNote(network)],
    source,
  };
}
