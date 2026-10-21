import { describe, expect, it } from "vitest";

import { formatDateTime } from "../../domain/time-words";
import { axisLabels, bucketLabel, cellText, emptyText, endLabelValue, gapText, plotSummary, sliderLabel, tableHeading, tickLabel, valueText } from "./labels";
import type { TimeAxis, TimeSeriesData } from "./types";

/** `count` days from `first` (UTC `YYYY-MM-DD`), oldest first. */
function days(first: string, count: number): string[] {
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

const thirtyDays: TimeAxis = { unit: "day", buckets: days("2026-09-18", 30) };

describe("tickLabel", () => {
  it("writes counts with K, M, B, at most 3 significant digits, and in full under 10,000", () => {
    expect(tickLabel(2500000, "count")).toBe("2.5M");
    expect(tickLabel(500000, "count")).toBe("500K");
    expect(tickLabel(1000000, "count")).toBe("1M");
    expect(tickLabel(1200000000, "count")).toBe("1.2B");
    expect(tickLabel(7500, "count")).toBe("7,500");
    expect(tickLabel(0, "count")).toBe("0");
  });

  it("writes a percent with its sign", () => {
    expect(tickLabel(99.5, "percent")).toBe("99.5%");
    expect(tickLabel(0, "percent")).toBe("0%");
    expect(tickLabel(100, "percent")).toBe("100%");
  });

  it("writes seconds with their unit and the other kinds without one (the card names the unit)", () => {
    expect(tickLabel(2.5, "seconds")).toBe("2.5 s");
    expect(tickLabel(45500000, "amount")).toBe("45.5M");
    expect(tickLabel(113, "drops")).toBe("113");
    expect(tickLabel(0.25, "price")).toBe("0.25");
  });

  it("writes a negative tick with U+2212 and a small one in full", () => {
    expect(tickLabel(-600, "count")).toBe("−600");
    expect(tickLabel(-12900, "amount")).toBe("−12.9K");
    expect(tickLabel(0.0001, "price")).toBe("0.0001");
    expect(tickLabel(1e-7, "price")).toBe("0.0000001");
  });

  it("writes a price with formatPrice, never compact: no K, M or B, 8 significant digits, grouped, no exponent", () => {
    expect(tickLabel(2.375, "price")).toBe("2.375");
    expect(tickLabel(1234.5, "price")).toBe("1,234.5");
    expect(tickLabel(12345678, "price")).toBe("12,345,678");
    expect(tickLabel(2500000, "price")).toBe("2,500,000");
    expect(tickLabel(1e-10, "price")).toBe("0.0000000001");
    expect(tickLabel(0, "price")).toBe("0");
    expect(tickLabel(-0.25, "price")).toBe("\u22120.25");
    // The other kinds are compact, as before.
    expect(tickLabel(2500000, "amount")).toBe("2.5M");
  });

  it("writes the kind value as an amount: compact, with no unit (the card names it)", () => {
    expect(tickLabel(45200, "value")).toBe("45.2K");
    expect(tickLabel(-12900, "value")).toBe("\u221212.9K");
    expect(tickLabel(0, "value")).toBe("0");
  });
});

describe("valueText", () => {
  it("writes a count in full for a tooltip and compact for an end label, with no noun", () => {
    expect(valueText("1284331", { kind: "count" }, "full")).toBe("1,284,331");
    expect(valueText("1284331", { kind: "count" }, "compact")).toBe("1.28M");
    expect(valueText("12", { kind: "count" }, "compact")).toBe("12");
  });

  it("writes an amount or drops compact with the unit, in either style", () => {
    expect(valueText("45500000", { kind: "amount", unit: "XRP" }, "compact")).toBe("45.5M XRP");
    expect(valueText("45500000", { kind: "amount", unit: "XRP" }, "full")).toBe("45.5M XRP");
    expect(valueText("113", { kind: "drops", unit: "drops" }, "compact")).toBe("113 drops");
    expect(valueText("113", { kind: "drops", unit: "drops" }, "full")).toBe("113 drops");
  });

  it("writes the kind value as an amount does: compact with the unit, in either style", () => {
    expect(valueText("45200", { kind: "value", unit: "XRP" }, "full")).toBe("45.2K XRP");
    expect(valueText("45200", { kind: "value", unit: "XRP" }, "compact")).toBe("45.2K XRP");
    expect(valueText("16787.149", { kind: "value", unit: "XRP" }, "full")).toBe("16.8K XRP");
    expect(valueText("-3.5", { kind: "value", unit: "XRP" }, "full")).toBe("\u22123.5 XRP");
    expect(valueText("45200", { kind: "value" }, "full")).toBe("45.2K");
  });

  it("writes a price with formatPrice and the unit, in either style, and never compact (a change from the first reading of the kind)", () => {
    for (const style of ["compact", "full"] as const) {
      expect(valueText("0.52341", { kind: "price", unit: "USD" }, style)).toBe("0.52341 USD");
      expect(valueText("0.40990000", { kind: "price", unit: "USD" }, style)).toBe("0.4099 USD");
      expect(valueText("12345.678912", { kind: "price", unit: "USD" }, style)).toBe("12,345.679 USD");
      expect(valueText("12100000", { kind: "price", unit: "USD" }, style)).toBe("12,100,000 USD");
      expect(valueText("1e-10", { kind: "price", unit: "USD" }, style)).toBe("0.0000000001 USD");
      expect(valueText("2.43934999", { kind: "price" }, style)).toBe("2.43935");
    }
  });

  it("names the drops when the format does not", () => {
    expect(valueText("113", { kind: "drops" }, "compact")).toBe("113 drops");
  });

  it("leaves the unit off when there is none", () => {
    expect(valueText("1250", { kind: "amount" }, "compact")).toBe("1,250");
  });

  it("writes a percent and seconds exactly, in either style", () => {
    expect(valueText("99.31", { kind: "percent" }, "full")).toBe("99.31%");
    expect(valueText("99.31", { kind: "percent" }, "compact")).toBe("99.31%");
    expect(valueText("3.4", { kind: "seconds" }, "full")).toBe("3.4 s");
  });
});

describe("endLabelValue", () => {
  it("writes the figure with no unit, since the card names it and the label has 112 px: `45.5M` for `45.5M XRP`", () => {
    expect(endLabelValue("45500000", { kind: "amount", unit: "XRP" })).toBe("45.5M");
    expect(endLabelValue("12100000", { kind: "price", unit: "USD" })).toBe("12,100,000");
    expect(endLabelValue("1284331", { kind: "count", unit: "transactions" })).toBe("1.28M");
    expect(endLabelValue("1284", { kind: "count" })).toBe("1,284");
    expect(endLabelValue("113", { kind: "drops", unit: "drops" })).toBe("113");
    expect(endLabelValue("0.5", { kind: "amount", unit: "XRP" })).toBe("0.5");
  });

  it("keeps the sign of a percent and of seconds, which are not a unit to leave out", () => {
    expect(endLabelValue("99.31", { kind: "percent" })).toBe("99.31%");
    expect(endLabelValue("3.4", { kind: "seconds" })).toBe("3.4 s");
  });

  it("writes a price with formatPrice, with no unit and not compact", () => {
    expect(endLabelValue("0.40990000", { kind: "price", unit: "USD" })).toBe("0.4099");
    expect(endLabelValue("2.43934999", { kind: "price" })).toBe("2.43935");
  });
});

describe("cellText", () => {
  it("is the exact value, with a % or an s, and no unit", () => {
    expect(cellText("1284331", { kind: "count" })).toBe("1,284,331");
    expect(cellText("45500000.25", { kind: "amount", unit: "XRP" })).toBe("45,500,000.25");
    expect(cellText("99.31", { kind: "percent" })).toBe("99.31%");
    expect(cellText("3.4", { kind: "seconds" })).toBe("3.4 s");
    expect(cellText("0", { kind: "count" })).toBe("0");
  });

  it("writes the kind value with formatValue: 2 decimals from 1, 6 below it, grouped, no unit", () => {
    expect(cellText("16787.149", { kind: "value", unit: "XRP" })).toBe("16,787.15");
    expect(cellText("0.1234567", { kind: "value" })).toBe("0.123457");
    expect(cellText("2.50", { kind: "value" })).toBe("2.5");
    expect(cellText("-1234.5", { kind: "value" })).toBe("\u22121,234.5");
    expect(cellText("0", { kind: "value" })).toBe("0");
    expect(cellText("0.0000001", { kind: "value" })).toBe("<0.000001");
    expect(cellText(null, { kind: "value" })).toBe("\u2014");
  });

  it("writes a price with formatPrice: 8 significant digits, trailing zeros dropped, never an exponent", () => {
    expect(cellText("0.40990000", { kind: "price", unit: "USD" })).toBe("0.4099");
    expect(cellText("2.40", { kind: "price" })).toBe("2.4");
    expect(cellText("12345.678912", { kind: "price" })).toBe("12,345.679");
    expect(cellText("1e-10", { kind: "price" })).toBe("0.0000000001");
  });

  it("is a dash for a missing value", () => {
    expect(cellText(null, { kind: "count" })).toBe("—");
    expect(cellText(null, { kind: "percent" })).toBe("—");
  });
});

describe("bucketLabel", () => {
  it("writes a day as Oct 16 on the axis and Oct 16, 2026 in the tooltip and the table", () => {
    expect(bucketLabel("2026-10-16", "day", "axis")).toBe("Oct 16");
    expect(bucketLabel("2026-10-16", "day", "tooltip")).toBe("Oct 16, 2026");
    expect(bucketLabel("2026-10-16", "day", "table")).toBe("Oct 16, 2026");
  });

  it("writes a week by its Monday: Oct 12, Week of Oct 12, 2026 in the tooltip, Oct 12, 2026 in the table", () => {
    expect(bucketLabel("2026-10-12", "week", "axis")).toBe("Oct 12");
    expect(bucketLabel("2026-10-12", "week", "tooltip")).toBe("Week of Oct 12, 2026");
    expect(bucketLabel("2026-10-12", "week", "table")).toBe("Oct 12, 2026");
  });

  it("writes an hour as 17:00 on the axis and with its day elsewhere", () => {
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "axis")).toBe("17:00");
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "tooltip")).toBe("Oct 17, 2026, 17:00");
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "table")).toBe("Oct 17, 2026, 17:00");
  });

  it("writes a quarter hour as 17:15 on the axis and with its day elsewhere", () => {
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "axis")).toBe("17:15");
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "tooltip")).toBe("Oct 17, 2026, 17:15");
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "table")).toBe("Oct 17, 2026, 17:15");
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "tooltip", true)).toBe("Oct 17, 2026, 17:15, so far");
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "axis", true)).toBe("17:15");
    expect(bucketLabel("soon", "minute", "axis")).toBe("soon");
  });

  it("writes a flag ledger by its day on the axis and its day, time and zone elsewhere", () => {
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "axis")).toBe("Oct 16");
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "tooltip")).toBe("Oct 16, 2026, 17:01 UTC");
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "table")).toBe("Oct 16, 2026, 17:01 UTC");
    expect(bucketLabel("2026-10-16T09:34:00Z", "flag", "tooltip")).toBe("Oct 16, 2026, 09:34 UTC");
  });

  it("writes a flag ledger's tooltip, table and readout dates as formatDateTime does (the zone is part of the date, as the axis is days)", () => {
    for (const bucket of ["2026-10-16T09:34:00Z", "2026-10-16T17:01:10Z", "2026-01-02T00:00:00Z", "2026-12-31T23:59:59Z"]) {
      for (const where of ["tooltip", "table", "readout"] as const) expect(bucketLabel(bucket, "flag", where)).toBe(formatDateTime(bucket));
    }
  });

  it("puts the so-far note after a running flag ledger's zone, and keeps the zone off the other time axes' tooltips and tables", () => {
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "tooltip", true)).toBe("Oct 16, 2026, 17:01 UTC, so far");
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "tooltip")).toBe("Oct 17, 2026, 17:00");
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "table")).toBe("Oct 17, 2026, 17:15");
  });

  it("writes a month as Oct 2026 on the axis, in the tooltip and in the table", () => {
    for (const where of ["axis", "tooltip", "table"] as const) expect(bucketLabel("2026-10-01", "month", where)).toBe("Oct 2026");
    expect(bucketLabel("2025-07-01", "month", "axis")).toBe("Jul 2025");
    expect(bucketLabel("2026-01-01", "month", "tooltip")).toBe("Jan 2026");
    expect(bucketLabel("2026-12-01", "month", "table")).toBe("Dec 2026");
  });

  it("adds so far to a running month in the tooltip and the table, never on the axis", () => {
    expect(bucketLabel("2026-10-01", "month", "tooltip", true)).toBe("Oct 2026, so far");
    expect(bucketLabel("2026-10-01", "month", "table", true)).toBe("Oct 2026, so far");
    expect(bucketLabel("2026-10-01", "month", "axis", true)).toBe("Oct 2026");
  });

  it("adds so far in the tooltip and the table, never on the axis", () => {
    expect(bucketLabel("2026-10-17", "day", "tooltip", true)).toBe("Oct 17, 2026, so far");
    expect(bucketLabel("2026-10-17", "day", "table", true)).toBe("Oct 17, 2026, so far");
    expect(bucketLabel("2026-10-17", "day", "axis", true)).toBe("Oct 17");
    expect(bucketLabel("2026-10-12", "week", "tooltip", true)).toBe("Week of Oct 12, 2026, so far");
    expect(bucketLabel("2026-10-12", "week", "table", true)).toBe("Oct 12, 2026, so far");
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "tooltip", true)).toBe("Oct 17, 2026, 17:00, so far");
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "axis", true)).toBe("17:00");
  });

  it("says nothing more when the bucket is not forming", () => {
    expect(bucketLabel("2026-10-17", "day", "tooltip", false)).toBe("Oct 17, 2026");
  });

  it("returns what is not a bucket as it came", () => {
    expect(bucketLabel("soon", "day", "tooltip")).toBe("soon");
    expect(bucketLabel("soon", "hour", "axis")).toBe("soon");
    expect(bucketLabel("soon", "month", "axis")).toBe("soon");
    expect(bucketLabel("soon", "month", "tooltip")).toBe("soon");
  });
});

describe("axisLabels", () => {
  /** Flag ledgers every 6 hours from Oct 15, 2026, 00:30 UTC: four a day. */
  const flags = (count: number): TimeAxis => ({
    unit: "flag",
    buckets: Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 15, 6 * i, 30)).toISOString().replace(".000Z", "Z")),
  });

  it("labels each picked bucket of an axis, oldest first", () => {
    const axis: TimeAxis = { unit: "day", buckets: ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"] };
    expect(axisLabels(axis, [0, 2, 3])).toEqual([
      { i: 0, text: "Oct 15" },
      { i: 2, text: "Oct 17" },
      { i: 3, text: "Oct 18" },
    ]);
  });

  it("names each UTC day of a flag axis once, at the first of the picks that fall on it", () => {
    // Twelve flag ledgers over three days, every second one picked: two picks a day.
    expect(axisLabels(flags(12), [1, 3, 5, 7, 9, 11])).toEqual([
      { i: 1, text: "Oct 15" },
      { i: 5, text: "Oct 16" },
      { i: 9, text: "Oct 17" },
    ]);
    // Picks a day or more apart are all kept.
    expect(axisLabels(flags(12), [0, 4, 8]).map((label) => label.text)).toEqual(["Oct 15", "Oct 16", "Oct 17"]);
  });

  it("tells the days apart by the date, not by the label's words: Oct 15 of two years is two days", () => {
    const axis: TimeAxis = { unit: "flag", buckets: ["2025-10-15T10:00:00Z", "2025-10-15T22:00:00Z", "2026-10-15T10:00:00Z"] };
    expect(axisLabels(axis, [0, 1, 2])).toEqual([
      { i: 0, text: "Oct 15" },
      { i: 2, text: "Oct 15" },
    ]);
  });

  it("leaves the other units as they are, a time of day that repeats on an hour axis too", () => {
    const hours: TimeAxis = { unit: "hour", buckets: ["2026-10-16T17:00:00Z", "2026-10-17T17:00:00Z"] };
    expect(axisLabels(hours, [0, 1])).toEqual([
      { i: 0, text: "17:00" },
      { i: 1, text: "17:00" },
    ]);
  });
});

describe("bucketLabel for a readout", () => {
  it("writes a time of day with its day and UTC: Oct 17, 2026, 17:00 UTC", () => {
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "readout")).toBe("Oct 17, 2026, 17:00 UTC");
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "readout")).toBe("Oct 17, 2026, 17:15 UTC");
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "readout")).toBe("Oct 16, 2026, 17:01 UTC");
  });

  it("writes a day as Oct 16, 2026 and a week as Week of Oct 12, 2026, which are in UTC already", () => {
    expect(bucketLabel("2026-10-16", "day", "readout")).toBe("Oct 16, 2026");
    expect(bucketLabel("2026-10-12", "week", "readout")).toBe("Week of Oct 12, 2026");
  });

  it("marks the running bucket with a middle dot and so far, not the tooltip's comma", () => {
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "readout", true)).toBe("Oct 17, 2026, 17:00 UTC \u00b7 so far");
    expect(bucketLabel("2026-10-17T17:15:00Z", "minute", "readout", true)).toBe("Oct 17, 2026, 17:15 UTC \u00b7 so far");
    expect(bucketLabel("2026-10-16", "day", "readout", true)).toBe("Oct 16, 2026 \u00b7 so far");
    expect(bucketLabel("2026-10-12", "week", "readout", true)).toBe("Week of Oct 12, 2026 \u00b7 so far");
    expect(bucketLabel("2026-10-17T17:00:00Z", "hour", "tooltip", true)).toBe("Oct 17, 2026, 17:00, so far");
  });

  it("returns what is not a bucket as it came, with no UTC added to it", () => {
    expect(bucketLabel("soon", "hour", "readout")).toBe("soon");
    expect(bucketLabel("soon", "minute", "readout")).toBe("soon");
    expect(bucketLabel("soon", "day", "readout")).toBe("soon");
  });
});

describe("tableHeading", () => {
  it("names the first column by the unit of the axis", () => {
    expect(tableHeading("day")).toBe("Day (UTC)");
    expect(tableHeading("week")).toBe("Week of (UTC)");
    expect(tableHeading("hour")).toBe("Hour (UTC)");
    expect(tableHeading("flag")).toBe("Flag ledger (UTC)");
    expect(tableHeading("minute")).toBe("Time (UTC)");
    expect(tableHeading("month")).toBe("Month (UTC)");
  });
});

describe("gapText", () => {
  it("says a bucket has no data, by its date", () => {
    expect(gapText(thirtyDays, 15, 1)).toBe("No data for Oct 3");
    expect(gapText(thirtyDays, 15, 0)).toBe("No data for Oct 3");
  });

  it("says the newest buckets are not computed yet", () => {
    expect(gapText(thirtyDays, 29, 1)).toBe("Not computed yet");
    expect(gapText(thirtyDays, 28, 2)).toBe("Not computed yet");
    expect(gapText(thirtyDays, 29, 2)).toBe("Not computed yet");
    expect(gapText(thirtyDays, 28, 1)).toBe("No data for Oct 16");
  });

  it("names a week, and gives an hour or a flag ledger its day", () => {
    expect(gapText({ unit: "week", buckets: ["2026-10-05", "2026-10-12"] }, 0, 0)).toBe("No data for the week of Oct 5");
    expect(gapText({ unit: "hour", buckets: ["2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"] }, 0, 0)).toBe("No data for Oct 17, 2026, 16:00");
    expect(gapText({ unit: "flag", buckets: ["2026-10-16T17:01:10Z"] }, 0, 0)).toBe("No data for Oct 16, 2026, 17:01 UTC");
  });

  it("gives a quarter hour its day and time, as an hour has", () => {
    expect(gapText({ unit: "minute", buckets: ["2026-10-17T17:00:00Z", "2026-10-17T17:15:00Z"] }, 1, 0)).toBe("No data for Oct 17, 2026, 17:15");
    expect(gapText({ unit: "minute", buckets: ["2026-10-17T17:00:00Z", "2026-10-17T17:15:00Z"] }, 1, 1)).toBe("Not computed yet");
  });

  it("names a month by its label", () => {
    const months: TimeAxis = { unit: "month", buckets: ["2026-08-01", "2026-09-01", "2026-10-01"] };
    expect(gapText(months, 1, 0)).toBe("No data for Sep 2026");
    expect(gapText(months, 2, 1)).toBe("Not computed yet");
  });
});

describe("emptyText", () => {
  it("says how much time has no data", () => {
    expect(emptyText(thirtyDays)).toBe("No data for these 30 days");
    expect(emptyText({ unit: "week", buckets: days("2025-10-20", 52) })).toBe("No data for these 52 weeks");
    expect(emptyText({ unit: "hour", buckets: ["a", "b"] })).toBe("No data for these 2 hours");
    expect(emptyText({ unit: "flag", buckets: ["a", "b", "c"] })).toBe("No data for these 3 flag ledgers");
    expect(emptyText({ unit: "minute", buckets: ["a", "b", "c"] })).toBe("No data for these 3 quarter hours");
    expect(emptyText({ unit: "month", buckets: ["a", "b", "c"] })).toBe("No data for these 3 months");
  });

  it("is singular for one bucket", () => {
    expect(emptyText({ unit: "day", buckets: ["2026-10-17"] })).toBe("No data for this day");
    expect(emptyText({ unit: "minute", buckets: ["2026-10-17T17:15:00Z"] })).toBe("No data for this quarter hour");
    expect(emptyText({ unit: "month", buckets: ["2026-10-01"] })).toBe("No data for this month");
  });
});

describe("sliderLabel", () => {
  it("names the slider after the chart and the step it moves by", () => {
    expect(sliderLabel("Transactions by type, per day", "day")).toBe("Transactions by type, per day, day by day");
    expect(sliderLabel("Validator agreement", "week")).toBe("Validator agreement, week by week");
    expect(sliderLabel("Ledgers", "hour")).toBe("Ledgers, hour by hour");
    expect(sliderLabel("Votes", "flag")).toBe("Votes, flag ledger by flag ledger");
    expect(sliderLabel("Price", "minute")).toBe("Price, quarter hour by quarter hour");
    expect(sliderLabel("Transactions sent per month", "month")).toBe("Transactions sent per month, month by month");
  });

  it("names the step after the words of one bucket when it is given one: a 4-hour candle on an axis of hours", () => {
    expect(sliderLabel("XRP/RLUSD price", "hour", "4 hours")).toBe("XRP/RLUSD price, 4 hours by 4 hours");
    expect(sliderLabel("XRP/RLUSD price", "hour", undefined)).toBe("XRP/RLUSD price, hour by hour");
  });
});

describe("plotSummary", () => {
  const axis: TimeAxis = { unit: "day", buckets: days("2026-09-17", 30) };
  const stack = (totals: (string | null)[], over: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
    axis,
    series: [
      { id: "payment", label: "Payment", slot: 1, values: totals.map((t) => (t === null ? null : String(Math.round(Number(t) / 2)))) },
      { id: "offer", label: "OfferCreate", slot: 2, values: totals.map((t) => (t === null ? null : String(Number(t) - Math.round(Number(t) / 2)))) },
    ],
    format: { kind: "count" },
    totals,
    token: "t",
    ...over,
  });
  const totals = Array.from({ length: 30 }, (_, i) => String(1500000 + i * 1000));
  totals[16] = "2310000"; // Oct 3
  totals[29] = "2104331"; // Oct 16

  it("reads the highest and the latest total, compact, with the year on the last date only", () => {
    expect(plotSummary("Transactions by type per day", stack(totals))).toBe(
      "Transactions by type per day, Sep 17 to Oct 16, 2026. Highest Oct 3, 2.31M; latest Oct 16, 2.1M. Choose Table for every value.",
    );
  });

  it("gives the year on both dates when the years differ", () => {
    const over = { axis: { unit: "day" as const, buckets: days("2026-12-20", 30) } };
    expect(plotSummary("Volume", stack(totals, over))).toContain("Volume, Dec 20, 2026 to Jan 18, 2027. ");
  });

  it("picks the earliest of equal highs", () => {
    const flat = totals.map(() => "100");
    flat[3] = "200";
    flat[8] = "200";
    expect(plotSummary("Fees", stack(flat))).toContain("Highest Sep 20, 200;");
  });

  describe("with extreme lowest", () => {
    // Agreement per day: it is the lowest day that matters, not the highest.
    const agreement = (values: (string | null)[], over: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
      axis: { unit: "day", buckets: days("2026-10-01", 19) },
      series: [{ id: "agreement", label: "Agreement", slot: 1, values }],
      format: { kind: "percent" },
      token: "t",
      ...over,
    });
    const rates = Array.from({ length: 19 }, () => "99.9");
    rates[2] = "99.31"; // Oct 3
    rates[18] = "99.98"; // Oct 19

    it("names the lowest bucket and the latest", () => {
      expect(plotSummary("Agreement per day", agreement(rates), { extreme: "lowest" })).toBe(
        "Agreement per day, Oct 1 to Oct 19, 2026. Lowest Oct 3, 99.31%; latest Oct 19, 99.98%. Choose Table for every value.",
      );
    });

    it("is still Highest by default and with extreme highest", () => {
      expect(plotSummary("Agreement per day", agreement(rates))).toContain("Highest Oct 19, 99.98%; latest Oct 19, 99.98%.");
      expect(plotSummary("Agreement per day", agreement(rates), { extreme: "highest" })).toBe(plotSummary("Agreement per day", agreement(rates)));
      expect(plotSummary("Agreement per day", agreement(rates), {})).toBe(plotSummary("Agreement per day", agreement(rates)));
    });

    it("picks the earliest of equal lows, and skips a null", () => {
      const equal: (string | null)[] = rates.map((_, i) => (i === 0 ? null : "100"));
      equal[4] = "98";
      equal[9] = "98";
      equal[12] = "99";
      expect(plotSummary("Agreement per day", agreement(equal), { extreme: "lowest" })).toContain("Lowest Oct 5, 98%; latest Oct 19, 100%.");
    });

    it("names the first line when there are several without totals, and says so far of a running lowest", () => {
      const lines = agreement(rates, {
        series: [
          { id: "a", label: "Agreement", slot: 1, values: rates },
          { id: "b", label: "Other", slot: 2, values: rates },
        ],
      });
      expect(plotSummary("Agreement per day", lines, { extreme: "lowest" })).toContain("Lowest Agreement Oct 3, 99.31%; latest Agreement Oct 19, 99.98%.");
      const running = rates.map((value, i) => (i === 18 ? "90" : value));
      expect(plotSummary("Agreement per day", agreement(running, { forming: true }), { extreme: "lowest" })).toContain(
        "Lowest Oct 19, so far, 90%; latest Oct 19, so far, 90%.",
      );
    });

    it("says there is no data the same way", () => {
      expect(plotSummary("Agreement per day", agreement(rates.map(() => null)), { extreme: "lowest" })).toBe("Agreement per day: No data for these 19 days.");
    });
  });

  it("reads the first series when there are no totals", () => {
    const data = stack(totals);
    delete data.totals;
    data.series = [{ id: "volume", label: "Volume", slot: 1, values: totals }];
    data.format = { kind: "amount", unit: "XRP" };
    expect(plotSummary("Volume", data)).toBe(
      "Volume, Sep 17 to Oct 16, 2026. Highest Oct 3, 2.31M XRP; latest Oct 16, 2.1M XRP. Choose Table for every value.",
    );
  });

  // The figures of the first line alone: the three-line volume chart must not give Payments' highs as if they were the volume.
  describe("with several series and no totals", () => {
    const lines = (over: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
      axis,
      series: [
        { id: "payments", label: "Payments", short: "payments", slot: 1, values: totals.map((t) => String(Number(t) * 20)) },
        { id: "dex", label: "DEX trades, tracked markets", slot: 2, values: totals },
        { id: "amm", label: "AMM swaps, all pools", slot: 3, values: totals.map((t) => String(Number(t) / 2)) },
      ],
      format: { kind: "amount", unit: "XRP" },
      token: "t",
      ...over,
    });

    it("names the first series the highest and the latest belong to", () => {
      expect(plotSummary("Volume per day, in XRP", lines())).toBe(
        "Volume per day, in XRP, Sep 17 to Oct 16, 2026. Highest Payments Oct 3, 46.2M XRP; latest Payments Oct 16, 42.1M XRP. Choose Table for every value.",
      );
    });

    it("names it on a week and an hour axis as well", () => {
      const weeks = lines({ axis: { unit: "week", buckets: ["2026-09-28", "2026-10-05", "2026-10-12"] } });
      weeks.series = weeks.series.map((s) => ({ ...s, values: ["5", "9", "7"] }));
      expect(plotSummary("Volume per week", weeks)).toBe(
        "Volume per week, Sep 28 to Oct 12, 2026. Highest Payments Oct 5, 9 XRP; latest Payments Oct 12, 7 XRP. Choose Table for every value.",
      );
    });

    it("does not name a series when it reads the totals", () => {
      expect(plotSummary("Transactions by type per day", stack(totals))).not.toContain("Payment ");
      expect(plotSummary("Volume", lines({ totals }))).toContain("Highest Oct 3, 2.31M XRP; latest Oct 16, 2.1M XRP.");
    });

    it("does not name the only series", () => {
      const only = lines();
      only.series = [only.series[0]!];
      expect(plotSummary("Volume", only)).toContain("Highest Oct 3, 46.2M XRP; latest Oct 16, 42.1M XRP.");
    });
  });

  // The running bucket reads as it does in the tooltip, the slider and the table (spec 6.6): "so far".
  describe("when the newest bucket is the running one", () => {
    it("adds so far to the latest date, before its value", () => {
      expect(plotSummary("Transactions by type per day", stack(totals, { forming: true }))).toBe(
        "Transactions by type per day, Sep 17 to Oct 16, 2026. Highest Oct 3, 2.31M; latest Oct 16, so far, 2.1M. Choose Table for every value.",
      );
    });

    it("says so after the name of a series, and for a highest that is the running bucket too", () => {
      const rising = totals.map((_, i) => String(1_000_000 + i * 1_000_000));
      const data: TimeSeriesData = {
        axis,
        series: [
          { id: "payments", label: "Payments", slot: 1, values: rising },
          { id: "dex", label: "DEX trades", slot: 2, values: rising },
        ],
        format: { kind: "amount", unit: "XRP" },
        forming: true,
        token: "t",
      };
      expect(plotSummary("Volume", data)).toContain("Highest Payments Oct 16, so far, 30M XRP; latest Payments Oct 16, so far, 30M XRP.");
    });

    it("adds it to a week and to an hour", () => {
      const weeks: TimeSeriesData = {
        axis: { unit: "week", buckets: ["2026-09-28", "2026-10-05", "2026-10-12"] },
        series: [{ id: "a", label: "A", slot: 1, values: ["5", "9", "7"] }],
        format: { kind: "count" },
        forming: true,
        token: "t",
      };
      expect(plotSummary("Transactions per week", weeks)).toContain("Highest Oct 5, 9; latest Oct 12, so far, 7.");
      const hours: TimeSeriesData = {
        axis: { unit: "hour", buckets: ["2026-10-17T15:00:00Z", "2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"] },
        series: [{ id: "a", label: "A", slot: 1, values: ["5", "9", "7"] }],
        format: { kind: "count" },
        forming: true,
        token: "t",
      };
      expect(plotSummary("Ledgers per hour", hours)).toContain("Highest Oct 17, 16:00, 9; latest Oct 17, 17:00, so far, 7.");
    });

    it("adds it to a quarter hour, and reads a price with formatPrice, not compact", () => {
      const quarters: TimeSeriesData = {
        axis: { unit: "minute", buckets: ["2026-10-17T16:45:00Z", "2026-10-17T17:00:00Z", "2026-10-17T17:15:00Z"] },
        series: [{ id: "price", label: "Price", slot: 1, values: ["0.40990000", "12345.678912", "0.41234567891"] }],
        format: { kind: "price", unit: "USD" },
        forming: true,
        token: "t",
      };
      expect(plotSummary("Price", quarters)).toBe(
        "Price, Oct 17, 16:45 to Oct 17, 2026, 17:15. Highest Oct 17, 17:00, 12,345.679 USD; latest Oct 17, 17:15, so far, 0.41234568 USD. Choose Table for every value.",
      );
    });

    it("leaves it out when the newest bucket has no value yet (pending): the latest is a closed bucket", () => {
      const pending = totals.map((t, i) => (i >= 28 ? null : t));
      expect(plotSummary("Volume", stack(pending, { forming: true, pending: 2 }))).toContain("latest Oct 14, ");
      expect(plotSummary("Volume", stack(pending, { forming: true, pending: 2 }))).not.toContain("so far");
    });

    it("leaves it out of a chart that is not forming", () => {
      expect(plotSummary("Volume", stack(totals, { forming: false }))).not.toContain("so far");
      expect(plotSummary("Volume", stack(totals))).not.toContain("so far");
    });
  });

  it("reads the newest bucket with a value as the latest, and skips a null for the highest", () => {
    const some = totals.map(() => null as string | null);
    some[5] = "10";
    some[7] = "30";
    some[20] = "20";
    expect(plotSummary("Fees", stack(some))).toContain("Highest Sep 24, 30; latest Oct 7, 20.");
  });

  it("reads a week by its Monday", () => {
    const weeks: TimeSeriesData = {
      axis: { unit: "week", buckets: ["2026-09-28", "2026-10-05", "2026-10-12"] },
      series: [{ id: "a", label: "A", slot: 1, values: ["5", "9", "7"] }],
      format: { kind: "count" },
      token: "t",
    };
    expect(plotSummary("Transactions per week", weeks)).toBe(
      "Transactions per week, Sep 28 to Oct 12, 2026. Highest Oct 5, 9; latest Oct 12, 7. Choose Table for every value.",
    );
  });

  it("reads a month by its name and year on both dates, whatever the years, and says so far of the running one", () => {
    const months: TimeSeriesData = {
      axis: { unit: "month", buckets: ["2026-08-01", "2026-09-01", "2026-10-01"] },
      series: [{ id: "a", label: "A", slot: 1, values: ["5", "9", "7"] }],
      format: { kind: "count" },
      token: "t",
    };
    expect(plotSummary("Transactions sent per month", months)).toBe(
      "Transactions sent per month, Aug 2026 to Oct 2026. Highest Sep 2026, 9; latest Oct 2026, 7. Choose Table for every value.",
    );
    expect(plotSummary("Transactions sent per month", { ...months, forming: true })).toContain("latest Oct 2026, so far, 7.");
    expect(plotSummary("Value", { ...months, axis: { unit: "month", buckets: ["2025-12-01", "2026-01-01"] }, series: [{ id: "a", label: "A", slot: 1, values: ["45200", "46000"] }], format: { kind: "value", unit: "XRP" } })).toBe(
      "Value, Dec 2025 to Jan 2026. Highest Jan 2026, 46K XRP; latest Jan 2026, 46K XRP. Choose Table for every value.",
    );
  });

  it("gives an hour its time", () => {
    const hours: TimeSeriesData = {
      axis: { unit: "hour", buckets: ["2026-10-17T15:00:00Z", "2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"] },
      series: [{ id: "a", label: "A", slot: 1, values: ["5", "9", "7"] }],
      format: { kind: "count" },
      token: "t",
    };
    expect(plotSummary("Ledgers per hour", hours)).toBe(
      "Ledgers per hour, Oct 17, 15:00 to Oct 17, 2026, 17:00. Highest Oct 17, 16:00, 9; latest Oct 17, 17:00, 7. Choose Table for every value.",
    );
  });

  it("says there is no data when every bucket is null", () => {
    expect(plotSummary("Transactions by type per day", stack(totals.map(() => null)))).toBe(
      "Transactions by type per day: No data for these 30 days.",
    );
  });

  it("says there is no data when there is no series and no totals", () => {
    const empty: TimeSeriesData = { axis, series: [], format: { kind: "count" }, token: "t" };
    expect(plotSummary("Fees", empty)).toBe("Fees: No data for these 30 days.");
  });

  it("says the data's own words instead when it has them, and still reads a chart that has a value", () => {
    const words = "No transactions sent in these 30 days";
    expect(plotSummary("Transactions sent, per day", stack(totals.map(() => null), { emptyText: words }))).toBe(`Transactions sent, per day: ${words}.`);
    expect(plotSummary("Transactions sent, per day", stack(totals, { emptyText: words }))).toBe(plotSummary("Transactions sent, per day", stack(totals)));
  });
});
