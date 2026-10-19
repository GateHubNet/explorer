// The windows of the time-series charts: the days or the weeks up to and including the running one (spec 1.5 and 6.6).
// Pure: no clock, no `Intl`. The browser and the fixture generator (Node) import this file. Days are `YYYY-MM-DD` strings and the
// arithmetic goes through `Date.UTC` and `toISOString`, so no local time is ever involved.

import { formatUtcDay } from "./format";

export type WindowPeriod = "7d" | "30d" | "90d" | "1y";
export interface PeriodWindow {
  period: WindowPeriod;
  unit: "day" | "week";
  /** W: the bucket starts, `YYYY-MM-DD`, oldest first. The last one is the running bucket. */
  buckets: string[];
  /** The API's `start` and `end` for W: `buckets[0]` and `T` (`end` is inclusive at its precision). */
  start: string;
  end: string;
  /** F: the N full buckets before the running one; P: the N buckets before F. For deltas. */
  full: { start: string; end: string };
  previous: { start: string; end: string };
  /** The period note's words: "the 30 days from Sep 18 to Oct 17, 2026 (UTC), today so far". */
  note: string;
}

const DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
const WEEKS = 52;

/** The day `days` days after `day` (before it when negative). */
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** The Monday on or before `day`: the first day of its week. */
function mondayOf(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay(); // 0 is Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** "Sep 18 to Oct 17, 2026": the year is said once when both ends are in it, and at each end when they are not. `lead` goes before each day. */
function spanNote(from: string, to: string, lead = ""): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${lead}${formatUtcDay(from, !sameYear)} to ${lead}${formatUtcDay(to, true)}`;
}

/**
 * The window of a period for `T`, the UTC day of the anchor's close time. `full` and `previous` are inclusive day bounds: `start` is their
 * first bucket, and `end` the last day they cover (a Sunday for weeks).
 */
export function windowOf(T: string, period: WindowPeriod): PeriodWindow {
  if (period === "1y") {
    const running = mondayOf(T);
    const first = addDays(running, -7 * (WEEKS - 1));
    const fullStart = addDays(running, -7 * WEEKS);
    return {
      period,
      unit: "week",
      buckets: bucketStarts(first, T, "week"),
      start: first,
      end: T,
      full: { start: fullStart, end: addDays(running, -1) },
      previous: { start: addDays(running, -7 * 2 * WEEKS), end: addDays(fullStart, -1) },
      note: `the ${WEEKS} weeks from ${spanNote(first, running, "the week of ")} (UTC, weeks from Monday), this week so far`,
    };
  }

  const days = DAYS[period];
  const first = addDays(T, -(days - 1));
  const fullStart = addDays(T, -days);
  return {
    period,
    unit: "day",
    buckets: bucketStarts(first, T, "day"),
    start: first,
    end: T,
    full: { start: fullStart, end: addDays(T, -1) },
    previous: { start: addDays(T, -2 * days), end: addDays(fullStart, -1) },
    note: `the ${days} days from ${spanNote(first, T)} (UTC), today so far`,
  };
}

/** The UTC day (`YYYY-MM-DD`) of a time in unix seconds. */
export function utcDayOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * The bucket starts from `start` up to and including the bucket that holds `end`, oldest first. Weeks are 7 days apart from `start`, which
 * is a Monday when it is the start of a week bucket.
 */
export function bucketStarts(start: string, end: string, unit: "day" | "week"): string[] {
  const step = unit === "week" ? 7 : 1;
  const starts: string[] = [];
  // `YYYY-MM-DD` strings compare as the days they are.
  for (let bucket = start; bucket <= end; bucket = addDays(bucket, step)) starts.push(bucket);
  return starts;
}

/**
 * How many of the newest buckets have no row in `present`, counted back from the last and stopping at the first one that has: at most 2. A
 * route that computes a bucket only once it has closed has no row for the running one, and for the one before it in the first hour or two
 * after midnight; a gap further back is a hole in the data, not a bucket still to come.
 */
export function pendingCount(buckets: readonly string[], present: ReadonlySet<string>): number {
  let pending = 0;
  while (pending < 2 && pending < buckets.length && !present.has(buckets[buckets.length - 1 - pending]!)) pending += 1;
  return pending;
}

/**
 * The card's words for `pending` buckets (`pendingCount`) at the end of `buckets`: "Oct 17 is not computed yet.", "Oct 16 and Oct 17 are
 * not computed yet.", "The week of Oct 19 is not computed yet."; `null` when none is pending.
 */
export function pendingNote(buckets: readonly string[], pending: number, unit: "day" | "week"): string | null {
  const days = pending > 0 ? buckets.slice(-pending).map((bucket) => formatUtcDay(bucket)) : [];
  if (days.length === 0) return null;
  const plural = days.length > 1;
  const list = plural ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0]!;
  const subject = unit === "week" ? `The ${plural ? "weeks" : "week"} of ${list}` : list;
  return `${subject} ${plural ? "are" : "is"} not computed yet.`;
}
