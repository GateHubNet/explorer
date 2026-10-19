import { describe, expect, it } from "vitest";

import { bucketLabel, cellText, emptyText, gapText, plotSummary, tableHeading, tickLabel, valueText } from "./labels";
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
});

describe("valueText", () => {
  it("writes a count in full for a tooltip and compact for an end label, with no noun", () => {
    expect(valueText("1284331", { kind: "count" }, "full")).toBe("1,284,331");
    expect(valueText("1284331", { kind: "count" }, "compact")).toBe("1.28M");
    expect(valueText("12", { kind: "count" }, "compact")).toBe("12");
  });

  it("writes an amount, drops or a price compact with the unit, in either style", () => {
    expect(valueText("45500000", { kind: "amount", unit: "XRP" }, "compact")).toBe("45.5M XRP");
    expect(valueText("45500000", { kind: "amount", unit: "XRP" }, "full")).toBe("45.5M XRP");
    expect(valueText("113", { kind: "drops", unit: "drops" }, "compact")).toBe("113 drops");
    expect(valueText("113", { kind: "drops", unit: "drops" }, "full")).toBe("113 drops");
    expect(valueText("0.52341", { kind: "price", unit: "USD" }, "full")).toBe("0.523 USD");
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

describe("cellText", () => {
  it("is the exact value, with a % or an s, and no unit", () => {
    expect(cellText("1284331", { kind: "count" })).toBe("1,284,331");
    expect(cellText("45500000.25", { kind: "amount", unit: "XRP" })).toBe("45,500,000.25");
    expect(cellText("99.31", { kind: "percent" })).toBe("99.31%");
    expect(cellText("3.4", { kind: "seconds" })).toBe("3.4 s");
    expect(cellText("0", { kind: "count" })).toBe("0");
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

  it("writes a flag ledger by its day on the axis and its day and time elsewhere", () => {
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "axis")).toBe("Oct 16");
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "tooltip")).toBe("Oct 16, 2026, 17:01");
    expect(bucketLabel("2026-10-16T17:01:10Z", "flag", "table")).toBe("Oct 16, 2026, 17:01");
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
  });
});

describe("tableHeading", () => {
  it("names the first column by the unit of the axis", () => {
    expect(tableHeading("day")).toBe("Day (UTC)");
    expect(tableHeading("week")).toBe("Week of (UTC)");
    expect(tableHeading("hour")).toBe("Hour (UTC)");
    expect(tableHeading("flag")).toBe("Flag ledger (UTC)");
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
    expect(gapText({ unit: "flag", buckets: ["2026-10-16T17:01:10Z"] }, 0, 0)).toBe("No data for Oct 16, 2026, 17:01");
  });
});

describe("emptyText", () => {
  it("says how much time has no data", () => {
    expect(emptyText(thirtyDays)).toBe("No data for these 30 days");
    expect(emptyText({ unit: "week", buckets: days("2025-10-20", 52) })).toBe("No data for these 52 weeks");
    expect(emptyText({ unit: "hour", buckets: ["a", "b"] })).toBe("No data for these 2 hours");
    expect(emptyText({ unit: "flag", buckets: ["a", "b", "c"] })).toBe("No data for these 3 flag ledgers");
  });

  it("is singular for one bucket", () => {
    expect(emptyText({ unit: "day", buckets: ["2026-10-17"] })).toBe("No data for this day");
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

  it("reads the first series when there are no totals", () => {
    const data = stack(totals);
    delete data.totals;
    data.series = [{ id: "volume", label: "Volume", slot: 1, values: totals }];
    data.format = { kind: "amount", unit: "XRP" };
    expect(plotSummary("Volume", data)).toBe(
      "Volume, Sep 17 to Oct 16, 2026. Highest Oct 3, 2.31M XRP; latest Oct 16, 2.1M XRP. Choose Table for every value.",
    );
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
});
