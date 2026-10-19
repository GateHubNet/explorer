// The words of the chart kit (spec sections 2.4 and 2.5): tick text, value text, UTC bucket labels and the summary of a plot for
// assistive technology. Every text is made from the exact decimal strings the view builder hands over, with the formatters of
// app/domain/format.ts (the kit does not import bignumber.js itself), and with a fixed month table: no `Intl`, no locale, no clock,
// so the Worker and the browser write the same text.

import { compactNumber, formatAmount, formatUtcDay } from "../../domain/format";
import type { TimeAxis, TimeSeriesData, ValueFormat, ValueKind } from "./types";

const DASH = "—";

/** A tick of a value axis: `0`, `500K`, `1M`, `2.5M`, `1.2B`; in full with separators under 10,000; `99.5%`. The card names the unit. */
export function tickLabel(value: number, kind: ValueKind): string {
  const text = compactNumber(String(value));
  if (kind === "percent") return `${text}%`;
  if (kind === "seconds") return `${text} s`;
  return text;
}

/** `45.5M XRP`: the unit after the number, when there is one. */
const withUnit = (text: string, unit: string | undefined): string => (unit ? `${text} ${unit}` : text);

/**
 * A value for a tooltip, an end label or a slider's `aria-valuetext`. A count is `compactNumber` when `style` is compact and in full
 * (`1,284,331`) when it is full, with no noun. An amount, drops and a price are always `compactNumber` and the unit (`45.5M XRP`,
 * `113 drops`). A percent and seconds are exact (`99.31%`, `3.4 s`).
 */
export function valueText(value: string, format: ValueFormat, style: "compact" | "full"): string {
  switch (format.kind) {
    case "count":
      return style === "full" ? formatAmount(value) : compactNumber(value);
    case "percent":
      return `${formatAmount(value)}%`;
    case "seconds":
      return `${formatAmount(value)} s`;
    case "drops":
      return withUnit(compactNumber(value), format.unit ?? "drops");
    case "amount":
    case "price":
      return withUnit(compactNumber(value), format.unit);
  }
}

/** A cell of the table view: the exact value (with a `%` or an `s`, no unit: the column heading names it), and a dash for none. */
export function cellText(value: string | null, format: ValueFormat): string {
  if (value === null) return DASH;
  if (format.kind === "percent") return `${formatAmount(value)}%`;
  if (format.kind === "seconds") return `${formatAmount(value)} s`;
  return formatAmount(value);
}

/** `2026-10-17T17:01:10Z`: the day, and the hour and minute. */
const MOMENT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

function bucketText(bucket: string, unit: TimeAxis["unit"], where: "axis" | "tooltip" | "table"): string {
  switch (unit) {
    case "day":
      return formatUtcDay(bucket, where !== "axis");
    case "week":
      if (where === "tooltip") return `Week of ${formatUtcDay(bucket, true)}`;
      return formatUtcDay(bucket, where === "table");
    case "hour":
    case "flag": {
      const moment = MOMENT.exec(bucket);
      if (!moment) return bucket;
      const [, day = "", time = ""] = moment;
      if (where === "axis") return unit === "hour" ? time : formatUtcDay(day);
      return `${formatUtcDay(day, true)}, ${time}`;
    }
  }
}

/**
 * A bucket's date, in UTC. On the axis: `Oct 16` (a day or a week's Monday, `Oct 12`), `17:00` (an hour), the day of a flag ledger.
 * In a tooltip or a table: `Oct 16, 2026`; a week is `Week of Oct 12, 2026` in a tooltip and `Oct 12, 2026` in a table; an hour or a
 * flag ledger is `Oct 17, 2026, 17:00`. The running bucket (`forming`) adds `, so far` in a tooltip and a table, never on the axis.
 */
export function bucketLabel(bucket: string, unit: TimeAxis["unit"], where: "axis" | "tooltip" | "table", forming = false): string {
  const text = bucketText(bucket, unit, where);
  return forming && where !== "axis" ? `${text}, so far` : text;
}

const HEADINGS = { day: "Day (UTC)", week: "Week of (UTC)", hour: "Hour (UTC)", flag: "Flag ledger (UTC)" } as const;

/** The heading of the table view's first column. */
export function tableHeading(unit: TimeAxis["unit"]): string {
  return HEADINGS[unit];
}

/** What the tooltip says of bucket `i` that has no value: the newest `pending` buckets are not computed yet; any other has no data. */
export function gapText(axis: TimeAxis, i: number, pending: number): string {
  if (pending > 0 && i >= axis.buckets.length - pending) return "Not computed yet";
  const bucket = axis.buckets[i] ?? "";
  switch (axis.unit) {
    case "day":
      return `No data for ${bucketLabel(bucket, "day", "axis")}`;
    case "week":
      return `No data for the week of ${bucketLabel(bucket, "week", "axis")}`;
    case "hour":
    case "flag":
      return `No data for ${bucketLabel(bucket, axis.unit, "tooltip")}`;
  }
}

const NOUNS = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  hour: ["hour", "hours"],
  flag: ["flag ledger", "flag ledgers"],
} as const;

/** The name of a plot's slider (the `aria-label` of its cursor): the chart and the step it moves by, `Transactions by type, per day, day by day`. */
export function sliderLabel(title: string, unit: TimeAxis["unit"]): string {
  const [one] = NOUNS[unit];
  return `${title}, ${one} by ${one}`;
}

/** What a plot with no value in any bucket says in its middle: `No data for these 30 days`. */
export function emptyText(axis: TimeAxis): string {
  const count = axis.buckets.length;
  if (count === 0) return "No data";
  const [one, many] = NOUNS[axis.unit];
  return count === 1 ? `No data for this ${one}` : `No data for these ${count} ${many}`;
}

/** A bucket in a summary: `Oct 3`, with the year when asked; an hour or a flag ledger has its time after the day. */
function summaryDate(bucket: string, unit: TimeAxis["unit"], withYear: boolean): string {
  const moment = MOMENT.exec(bucket);
  if (unit === "hour" || unit === "flag") {
    return moment ? `${formatUtcDay(moment[1]!, withYear)}, ${moment[2]}` : bucket;
  }
  return formatUtcDay(bucket, withYear);
}

/**
 * The text of a plot for a screen reader (the `aria-label` of its `role="img"`): "Transactions by type per day, Sep 17 to Oct 16,
 * 2026. Highest Oct 3, 2.31M; latest Oct 16, 2.1M. Choose Table for every value." It reads the totals when there are some, else the
 * first series, with compact values. The year is on the last date only, and on both when the years differ. The highest is the earliest
 * of equal highs, the latest the newest bucket with a value. With no value at all it is "{title}: {emptyText}.".
 */
export function plotSummary(title: string, data: TimeSeriesData): string {
  const { axis, format } = data;
  const values = data.totals ?? data.series[0]?.values ?? [];

  let highest = -1;
  let latest = -1;
  for (let i = 0; i < axis.buckets.length; i += 1) {
    const value = values[i];
    if (value === null || value === undefined || !Number.isFinite(Number(value))) continue;
    latest = i;
    if (highest < 0 || Number(value) > Number(values[highest])) highest = i;
  }
  if (highest < 0) return `${title}: ${emptyText(axis)}.`;

  const [first = "", last = ""] = [axis.buckets[0], axis.buckets.at(-1)];
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const at = (i: number) => `${summaryDate(axis.buckets[i]!, axis.unit, false)}, ${valueText(values[i]!, format, "compact")}`;
  return (
    `${title}, ${summaryDate(first, axis.unit, !sameYear)} to ${summaryDate(last, axis.unit, true)}. ` +
    `Highest ${at(highest)}; latest ${at(latest)}. Choose Table for every value.`
  );
}
