// The words of the chart kit (spec sections 2.4 and 2.5): tick text, value text, UTC bucket labels and the summary of a plot for
// assistive technology. Every text is made from the exact decimal strings the view builder hands over, with the formatters of
// app/domain/format.ts (the kit does not import bignumber.js itself), and with a fixed month table: no `Intl`, no locale, no clock,
// so the Worker and the browser write the same text.

import { compactNumber, formatAmount, formatPrice, formatUtcDay, formatValue } from "../../domain/format";
import type { TimeAxis, TimeSeriesData, ValueFormat, ValueKind } from "./types";

const DASH = "—";

/**
 * A tick of a value axis: `0`, `500K`, `1M`, `2.5M`, `1.2B`; in full with separators under 10,000; `99.5%`. The card names the unit. A price
 * is never compact: it is `formatPrice` (`2.375`, `12,345,678`), whose 8 significant digits write every tick a price scale can have.
 */
export function tickLabel(value: number, kind: ValueKind): string {
  if (kind === "price") return formatPrice(String(value));
  const text = compactNumber(String(value));
  if (kind === "percent") return `${text}%`;
  if (kind === "seconds") return `${text} s`;
  return text;
}

/** `45.5M XRP`: the unit after the number, when there is one. */
const withUnit = (text: string, unit: string | undefined): string => (unit ? `${text} ${unit}` : text);

/**
 * A value for a tooltip, an end label or a slider's `aria-valuetext`. A count is `compactNumber` when `style` is compact and in full
 * (`1,284,331`) when it is full, with no noun. An amount, a value (an estimate in the native currency) and drops are always `compactNumber`
 * and the unit (`45.5M XRP`, `45.2K XRP`, `113 drops`). A price is `formatPrice` and the unit in either style, never compact (`0.4099 USD`,
 * `12,345.679 USD`). A percent and seconds are exact (`99.31%`, `3.4 s`).
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
    case "value":
      return withUnit(compactNumber(value), format.unit);
    case "price":
      return withUnit(formatPrice(value), format.unit);
  }
}

/**
 * The figure of a line's end label (spec 2.11: "**45.5M** payments"): `compactNumber` with no unit, since the card's title names it and the
 * label has 112 px, a count compact too. A percent and seconds keep their sign (`99.31%`, `3.4 s`): it is part of the figure. A price is
 * `formatPrice`, not compact.
 */
export function endLabelValue(value: string, format: ValueFormat): string {
  if (format.kind === "price") return formatPrice(value);
  return format.kind === "percent" || format.kind === "seconds" ? valueText(value, format, "compact") : compactNumber(value);
}

/**
 * A cell of the table view: the exact value (with a `%` or an `s`, no unit: the column heading names it), and a dash for none. A price is
 * `formatPrice`: the data API's 8 significant digits, without the trailing zeros. A value is `formatValue`: 2 decimals from 1, 6 below it.
 */
export function cellText(value: string | null, format: ValueFormat): string {
  if (value === null) return DASH;
  if (format.kind === "price") return formatPrice(value);
  if (format.kind === "value") return formatValue(value);
  if (format.kind === "percent") return `${formatAmount(value)}%`;
  if (format.kind === "seconds") return `${formatAmount(value)} s`;
  return formatAmount(value);
}

/** `2026-10-17T17:01:10Z`: the day, and the hour and minute. */
const MOMENT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** Where a bucket's date is written: the axis, a tooltip, a table cell, or the readout above a chart (`Candles`). */
export type BucketPlace = "axis" | "tooltip" | "table" | "readout";

function bucketText(bucket: string, unit: TimeAxis["unit"], where: BucketPlace): string {
  switch (unit) {
    case "day":
      return formatUtcDay(bucket, where !== "axis");
    case "week":
      if (where === "tooltip" || where === "readout") return `Week of ${formatUtcDay(bucket, true)}`;
      return formatUtcDay(bucket, where === "table");
    case "month":
      // `Oct 2026` wherever it is written: the month's day is not part of it.
      return formatUtcDay(bucket, true).replace(/ \d+,/, "");
    case "hour":
    case "minute":
    case "flag": {
      const moment = MOMENT.exec(bucket);
      if (!moment) return bucket;
      const [, day = "", time = ""] = moment;
      if (where === "axis") return unit === "flag" ? formatUtcDay(day) : time;
      // The readout names the zone, since it stands alone above the chart: "Oct 17, 2026, 17:00 UTC".
      return `${formatUtcDay(day, true)}, ${time}${where === "readout" ? " UTC" : ""}`;
    }
  }
}

/**
 * A bucket's date, in UTC. On the axis: `Oct 16` (a day or a week's Monday, `Oct 12`), `Oct 2026` (a month, everywhere), `17:00` (an hour)
 * or `17:15` (a quarter hour), the day of a flag ledger. In a tooltip or a table: `Oct 16, 2026`; a week is `Week of Oct 12, 2026` in a
 * tooltip and `Oct 12, 2026` in a table; an hour, a quarter hour or a flag ledger is `Oct 17, 2026, 17:00`. The running bucket (`forming`)
 * adds `, so far` in a tooltip and a table, never on the axis. The readout (the line above the candles) is the tooltip's date with `UTC` after a time of day, and the running bucket
 * adds ` · so far`: `Oct 17, 2026, 17:00 UTC · so far`, `Week of Oct 12, 2026`.
 */
export function bucketLabel(bucket: string, unit: TimeAxis["unit"], where: BucketPlace, forming = false): string {
  const text = bucketText(bucket, unit, where);
  if (!forming || where === "axis") return text;
  return where === "readout" ? `${text} \u00b7 so far` : `${text}, so far`;
}

const HEADINGS = {
  day: "Day (UTC)",
  week: "Week of (UTC)",
  month: "Month (UTC)",
  hour: "Hour (UTC)",
  minute: "Time (UTC)",
  flag: "Flag ledger (UTC)",
} as const;

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
    case "month":
      return `No data for ${bucketLabel(bucket, axis.unit, "axis")}`;
    case "week":
      return `No data for the week of ${bucketLabel(bucket, "week", "axis")}`;
    case "hour":
    case "minute":
    case "flag":
      return `No data for ${bucketLabel(bucket, axis.unit, "tooltip")}`;
  }
}

const NOUNS = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  hour: ["hour", "hours"],
  minute: ["quarter hour", "quarter hours"],
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

/**
 * A bucket in a summary: `Oct 3`, with the year when asked; a month is `Oct 2026` always; an hour, a quarter hour or a flag ledger has its
 * time after the day.
 */
function summaryDate(bucket: string, unit: TimeAxis["unit"], withYear: boolean): string {
  if (unit === "month") return bucketLabel(bucket, unit, "axis");
  const moment = MOMENT.exec(bucket);
  if (unit === "hour" || unit === "minute" || unit === "flag") {
    return moment ? `${formatUtcDay(moment[1]!, withYear)}, ${moment[2]}` : bucket;
  }
  return formatUtcDay(bucket, withYear);
}

/**
 * The text of a plot for a screen reader (the `aria-label` of its `role="img"`): "Transactions by type per day, Sep 17 to Oct 16,
 * 2026. Highest Oct 3, 2.31M; latest Oct 16, 2.1M. Choose Table for every value." It reads the totals when there are some, else the
 * first series, with compact values. With more than one series and no totals the figures are the first series' alone, so it is named:
 * "Highest Payments Oct 3, 45.5M XRP; latest Payments Oct 17, so far, 12.1M XRP" (the other lines are in the table). The year is on the
 * last date only, and on both when the years differ. The highest is the earliest of equal highs, the latest the newest bucket with a
 * value; a bucket that is the running one (`forming`, the newest of the axis) adds ", so far" to its date, as the tooltip does. With no
 * value at all it is "{title}: {emptyText}.".
 */
export function plotSummary(title: string, data: TimeSeriesData): string {
  const { axis, format } = data;
  const values = data.totals ?? data.series[0]?.values ?? [];
  // The figures of a chart of several lines with no totals belong to its first line: say which.
  const named = data.totals === undefined && data.series.length > 1 ? `${data.series[0]!.label} ` : "";

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
  const running = (i: number) => (data.forming === true && i === axis.buckets.length - 1 ? ", so far" : "");
  const at = (i: number) => `${named}${summaryDate(axis.buckets[i]!, axis.unit, false)}${running(i)}, ${valueText(values[i]!, format, "compact")}`;
  return (
    `${title}, ${summaryDate(first, axis.unit, !sameYear)} to ${summaryDate(last, axis.unit, true)}. ` +
    `Highest ${at(highest)}; latest ${at(latest)}. Choose Table for every value.`
  );
}
