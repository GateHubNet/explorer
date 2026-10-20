import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { analyticsWindow, type AnalyticsPeriod, type AnalyticsWindow } from "../domain/analytics-params";
import { tokenOf } from "../domain/fnv";
import { typeGroups, typeGroupsNote } from "../domain/type-groups";
import type { TimeSeriesData } from "../ui/charts/types";
import type { AccountTxStatsRow, AccountValueRow, Page } from "./api-types";
import { analyticsFrame, sentCard, valueCard, type AnalyticsFrame, type AnalyticsTile } from "./analytics-view";

// ---- The world of the tests: T is 2026-10-17, the day of the newest ledger's close time ------------------------------------------------

const T = "2026-10-17";
const MINUS = "−";

const page = <K extends string, R>(key: K, rows: R[]) => ({ result: "success", count: rows.length, [key]: rows }) as Page<K, R>;
const at = (day: string) => `${day}T00:00:00Z`;
const valueRow = (day: string, value: string): AccountValueRow => ({ date: at(day), account_value: value, balance_change_count: 1 });
const sentRow = (day: string, type: Record<string, number>, result: Record<string, number> = {}): AccountTxStatsRow => {
  const count = Object.values(type).reduce((sum, n) => sum + n, 0);
  return { date: at(day), transaction_count: count, type, result: Object.keys(result).length > 0 ? result : { tesSUCCESS: count } };
};

const frameOf = (period: AnalyticsPeriod, options: { T?: string; deleted?: boolean; first?: Parameters<typeof analyticsWindow>[2] } = {}): AnalyticsFrame =>
  analyticsFrame(analyticsWindow(period, options.T ?? T, options.first), { deleted: options.deleted ?? false });

/** The value rows of the newest `values.length` buckets of the frame, oldest first. */
const valuesOver = (frame: AnalyticsFrame, values: string[]) => {
  const buckets = frame.axis.buckets.slice(frame.axis.buckets.length - values.length);
  return page("rows", buckets.map((bucket, i) => valueRow(bucket, values[i]!)));
};

/** The 30 days from Sep 18 to Oct 17, from `first` to `last` in steps of 1 where it can (the middle is not read by the tests that use it). */
function thirtyDays(first: string, last: string): Page<"rows", AccountValueRow> {
  const frame = frameOf("30d");
  const middle = frame.axis.buckets.slice(1, -1).map((_, i) => String(16111 + i));
  return valuesOver(frame, [first, ...middle, last]);
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
/** The text a builder writes by itself: a percent change, a grouped count, a dash. */
const FIXED_TEXT = /^(—|[+−]?[\d,]+(\.\d+)?%|[\d,]+)$/;

// ---- The frame ---------------------------------------------------------------------------------------------------------------------

describe("analyticsFrame", () => {
  it("is the period, the axis, the start, the phrases, the note and whether the account was deleted", () => {
    const window = analyticsWindow("30d", T);
    const frame = analyticsFrame(window, { deleted: false });
    expect(frame.period).toBe("30d");
    expect(frame.axis).toEqual({ unit: "day", buckets: window.buckets });
    expect(frame.axis.buckets).toHaveLength(30);
    expect(frame.start).toBe("2026-09-18");
    expect(frame.phrase).toEqual({ title: "last 30 days", empty: "these 30 days", meta: null });
    expect(frame.deleted).toBe(false);
  });

  it("notes the 30 days, with the year once, and says the last day is running", () => {
    expect(frameOf("30d").note).toBe("The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now.");
  });

  it("notes the 90 days with the year at each end when they differ", () => {
    const frame = frameOf("90d", { T: "2027-01-15" });
    expect(frame.axis.buckets[0]).toBe("2026-10-18");
    expect(frame.note).toBe("The 90 days from Oct 18, 2026 to Jan 15, 2027 (UTC), per day. The last day is counted up to now.");
    expect(frameOf("90d").phrase).toEqual({ title: "last 90 days", empty: "these 90 days", meta: "last 90 days" });
    expect(frameOf("30d", { T: "2027-01-15" }).note).toBe("The 30 days from Dec 17, 2026 to Jan 15, 2027 (UTC), per day. The last day is counted up to now.");
  });

  it("notes the 52 weeks from their first day to the week of the running one", () => {
    const frame = frameOf("1y");
    expect(frame.axis.unit).toBe("week");
    expect(frame.axis.buckets).toHaveLength(52);
    expect(frame.start).toBe("2025-10-20");
    expect(frame.note).toBe(
      "The 52 weeks from Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), per week. The last week is counted up to now.",
    );
    expect(frame.phrase).toEqual({ title: "last 52 weeks", empty: "these 52 weeks", meta: "last 52 weeks" });
  });

  it("says the year once when the 52 weeks begin in the year they end in", () => {
    // The Monday of T's week is Dec 28, 2026, and 51 weeks before it is Jan 5 of the same year.
    const frame = frameOf("1y", { T: "2026-12-31" });
    expect(frame.start).toBe("2026-01-05");
    expect(frame.note).toBe("The 52 weeks from Jan 5 to the week of Dec 28, 2026 (UTC, weeks from Monday), per week. The last week is counted up to now.");
  });

  it("notes All from the month of the account's activation", () => {
    const frame = frameOf("all", { first: { day: "2025-07-15", from: "activation" } });
    expect(frame.axis.unit).toBe("month");
    expect(frame.axis.buckets).toHaveLength(16);
    expect(frame.start).toBe("2025-07-01");
    expect(frame.phrase).toEqual({ title: "since Jul 2025", empty: "its whole history", meta: "all time" });
    expect(frame.note).toBe("Since Jul 2025, the month it was activated, per month (UTC). The last month is counted up to now.");
  });

  it("notes All from the month of the oldest transaction, and that a history of two months is young", () => {
    const frame = frameOf("all", { first: { day: "2026-09-03", from: "oldest" } });
    expect(frame.axis.buckets).toEqual(["2026-09-01", "2026-10-01"]);
    expect(frame.note).toBe(
      "Since Sep 2026, the month of its oldest transaction in the index, per month (UTC). The last month is counted up to now. " +
        "It is younger than three months; 30 days and 90 days show it per day.",
    );
  });

  it("notes All with neither record as this month, and young", () => {
    const frame = frameOf("all");
    expect(frame.axis.buckets).toEqual(["2026-10-01"]);
    expect(frame.note).toBe(
      "This month (UTC): the index has no transaction of this account yet. The last month is counted up to now. " +
        "It is younger than three months; 30 days and 90 days show it per day.",
    );
    expect(frame.phrase.title).toBe("since Oct 2026");
  });

  it("calls a history of three months old enough", () => {
    const frame = frameOf("all", { first: { day: "2026-08-01", from: "activation" } });
    expect(frame.axis.buckets).toHaveLength(3);
    expect(frame.note).toBe("Since Aug 2026, the month it was activated, per month (UTC). The last month is counted up to now.");
  });

  it("adds, for a deleted account, that All covers its whole history, before the young sentence", () => {
    expect(frameOf("30d", { deleted: true }).note).toBe(
      "The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now. This account was deleted; All covers its whole history.",
    );
    const young = frameOf("all", { deleted: true, first: { day: "2026-09-03", from: "oldest" } });
    expect(young.deleted).toBe(true);
    expect(young.note).toBe(
      "Since Sep 2026, the month of its oldest transaction in the index, per month (UTC). The last month is counted up to now. " +
        "This account was deleted; All covers its whole history. It is younger than three months; 30 days and 90 days show it per day.",
    );
  });

  it("does not change the window it is given", () => {
    const window: AnalyticsWindow = analyticsWindow("30d", T);
    const copy = structuredClone(window);
    analyticsFrame(window, { deleted: true });
    expect(window).toEqual(copy);
  });
});

// ---- The account value -------------------------------------------------------------------------------------------------------------

describe("valueCard", () => {
  const frame = frameOf("30d");

  it("is the last value, its change over the period and the call it comes from", () => {
    const card = valueCard(frame, thirtyDays("16110", "16787.15"), "XRP");
    expect(card.tile.figure).toBe("16,787.15 XRP");
    expect(card.tile.sub).toBeNull();
    expect(card.tile.delta).toEqual({ text: "+4.2%", direction: "up", words: "over the last 30 days" });
    expect(card.tile.source).toBe("/v2/accounts/{a}/stats/value?interval=day");
    expect(card.source).toBe("/v2/accounts/{a}/stats/value?interval=day");
  });

  it("draws one line over the frame's buckets, forming, in the native currency, with a token", () => {
    const card = valueCard(frame, thirtyDays("16110", "16787.15"), "XRP");
    const { chart } = card;
    expect(chart.axis).toEqual(frame.axis);
    expect(chart.series).toHaveLength(1);
    expect(chart.series[0]).toMatchObject({ id: "value", label: "Account value", slot: 1 });
    expect(chart.series[0]!.values).toHaveLength(30);
    expect(chart.series[0]!.values[0]).toBe("16110");
    expect(chart.series[0]!.values[29]).toBe("16787.15");
    expect(chart.format).toEqual({ kind: "value", unit: "XRP" });
    expect(chart.forming).toBe(true);
    expect(chart.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("reads XAH on Xahau", () => {
    const card = valueCard(frame, thirtyDays("100", "200"), "XAH");
    expect(card.tile.figure).toBe("200 XAH");
    expect(card.chart.format).toEqual({ kind: "value", unit: "XAH" });
    expect(card.notes[0]).toBe("XAH plus every token held, valued at the end of each day.");
  });

  it("names the first note of a day, a week and a month", () => {
    expect(valueCard(frame, thirtyDays("1", "2"), "XRP").notes[0]).toBe("XRP plus every token held, valued at the end of each day.");
    const weeks = frameOf("1y");
    expect(valueCard(weeks, valuesOver(weeks, ["5", "6"]), "XRP").notes[0]).toBe("XRP plus every token held, valued at the end of each week.");
    const months = frameOf("all", { first: { day: "2025-07-15", from: "activation" } });
    expect(valueCard(months, valuesOver(months, ["5", "6"]), "XRP").notes[0]).toBe("XRP plus every token held, valued at the end of each month.");
    expect(valueCard(weeks, valuesOver(weeks, ["5", "6"]), "XRP").tile.source).toBe("/v2/accounts/{a}/stats/value?interval=week");
    expect(valueCard(months, valuesOver(months, ["5", "6"]), "XRP").tile.source).toBe("/v2/accounts/{a}/stats/value?interval=month");
  });

  it("says since the first row when the account had no balance yet in the first bucket, and notes the leading gap", () => {
    // Oct 9 to Oct 17: nine rows, 500 to 3,500 (no domain, so the notes are these two alone).
    const rows = valuesOver(frame, ["500", "875", "1250", "1625", "2000", "2375", "2750", "3125", "3500"]);
    expect(rows.rows[0]!.date).toBe(at("2026-10-09"));
    const card = valueCard(frame, rows, "XRP");
    expect(card.tile.delta).toEqual({ text: "+600.0%", direction: "up", words: "since Oct 9" });
    expect(card.notes).toEqual([
      "XRP plus every token held, valued at the end of each day.",
      "No value before Oct 9: the account had no balance until then.",
    ]);
    const values = card.chart.series[0]!.values;
    expect(values.slice(0, 21).every((value) => value === null)).toBe(true);
    expect(values[21]).toBe("500");
    expect(values[29]).toBe("3500");
  });

  it("says since the first row in the words of its unit, a month here", () => {
    const months = frameOf("all", { first: { day: "2025-07-15", from: "activation" } });
    const young = valueCard(months, valuesOver(months, ["100", "150"]), "XRP");
    expect(young.chart.series[0]!.values.slice(-2)).toEqual(["100", "150"]);
    expect(young.tile.delta).toEqual({ text: "+50.0%", direction: "up", words: "since Sep 2026" });
    expect(young.notes).toContain("No value before Sep 2026: the account had no balance until then.");
    // With a row in every month the base is the first bucket, and the period's own words are used.
    const whole = valueCard(months, valuesOver(months, Array.from({ length: 16 }, (_, i) => String(100 + i))), "XRP");
    expect(whole.tile.delta).toEqual({ text: "+15.0%", direction: "up", words: "since Jul 2025" });
    expect(whole.notes.some((note) => note.startsWith("No value before"))).toBe(false);
  });

  it("names the period in a 90 day and a 52 week delta", () => {
    const ninety = frameOf("90d");
    const up = valuesOver(ninety, Array.from({ length: 90 }, (_, i) => (i === 89 ? "110" : "100")));
    expect(valueCard(ninety, up, "XRP").tile.delta).toEqual({ text: "+10.0%", direction: "up", words: "over the last 90 days" });
    const weeks = frameOf("1y");
    const down = valuesOver(weeks, Array.from({ length: 52 }, (_, i) => (i === 51 ? "90" : "100")));
    expect(valueCard(weeks, down, "XRP").tile.delta).toEqual({ text: `${MINUS}10.0%`, direction: "down", words: "over the last 52 weeks" });
  });

  it("has no delta against a base of 0, and none when there is only one row to compare", () => {
    expect(valueCard(frame, valuesOver(frame, Array.from({ length: 30 }, (_, i) => (i === 0 ? "0" : "5"))), "XRP").tile.delta).toBeNull();
    expect(valueCard(frame, valuesOver(frame, ["42"]), "XRP").tile.delta).toBeNull();
    expect(valueCard(frame, valuesOver(frame, ["42"]), "XRP").tile.figure).toBe("42 XRP");
  });

  it("shows a flat period as 0.0% and a fall with U+2212", () => {
    const flat = valueCard(frame, thirtyDays("100", "100"), "XRP").tile.delta;
    expect(flat).toEqual({ text: "0.0%", direction: "flat", words: "over the last 30 days" });
    const fall = valueCard(frame, thirtyDays("200", "150"), "XRP").tile.delta;
    expect(fall).toEqual({ text: `${MINUS}25.0%`, direction: "down", words: "over the last 30 days" });
  });

  it("rounds the delta half up to one decimal, exactly", () => {
    // +0.05% is a tie: it goes away from zero (up to 0.1, down to −0.1), and 0.049 does not reach it.
    expect(valueCard(frame, thirtyDays("1", "1.0005"), "XRP").tile.delta?.text).toBe("+0.1%");
    expect(valueCard(frame, thirtyDays("1", "1.00049"), "XRP").tile.delta?.text).toBe("0.0%");
    expect(valueCard(frame, thirtyDays("1", "0.9995"), "XRP").tile.delta?.text).toBe(`${MINUS}0.1%`);
    expect(valueCard(frame, thirtyDays("0.1", "0.3"), "XRP").tile.delta?.text).toBe("+200.0%");
    expect(valueCard(frame, thirtyDays("3", "10000"), "XRP").tile.delta?.text).toBe("+333,233.3%");
  });

  it("writes a value below 1 to six decimals and a tiny one as below a drop", () => {
    expect(valueCard(frame, thirtyDays("0.5", "0.123456789"), "XRP").tile.figure).toBe("0.123457 XRP");
    expect(valueCard(frame, thirtyDays("0.5", "0.0000001"), "XRP").tile.figure).toBe("<0.000001 XRP");
    expect(valueCard(frame, thirtyDays("1", "1234567.891"), "XRP").tile.figure).toBe("1,234,567.89 XRP");
  });

  it("sets the axis floor to a nice number when the values are well above 0", () => {
    const card = valueCard(frame, valuesOver(frame, ["12100", "13000", "15100"]), "XRP");
    expect(card.chart.domain).toEqual({ min: "12000" });
    expect(card.notes).toEqual([
      "XRP plus every token held, valued at the end of each day.",
      "The axis starts at 12,000 XRP.",
      "No value before Oct 15: the account had no balance until then.",
    ]);
  });

  it("sets the floor of a value that moves by a little, and writes it with the unit", () => {
    // 16,110 to 16,787.15: a third of the range rounds up to a step of 250, and 16,110 is in the 64th.
    const card = valueCard(frame, thirtyDays("16110", "16787.15"), "XRP");
    expect(card.chart.domain).toEqual({ min: "16000" });
    expect(card.notes).toEqual(["XRP plus every token held, valued at the end of each day.", "The axis starts at 16,000 XRP."]);
  });

  it("sets no floor when the nice one is 0, when the values are all equal, and when there is one value", () => {
    const low = valueCard(frame, valuesOver(frame, ["500", "1000", "3500"]), "XRP");
    expect(low.chart.domain).toBeUndefined();
    expect(low.notes.some((note) => note.startsWith("The axis starts"))).toBe(false);
    const flat = valueCard(frame, valuesOver(frame, Array<string>(30).fill("12000")), "XRP");
    expect(flat.chart.domain).toBeUndefined();
    expect(flat.notes).toEqual(["XRP plus every token held, valued at the end of each day."]);
    expect(valueCard(frame, valuesOver(frame, ["12000"]), "XRP").chart.domain).toBeUndefined();
  });

  it.each([
    // [lowest, range, floor]: a third of the range is rounded up to a step of 1, 2, 2.5 or 5 × 10ⁿ, and the floor is the lowest value's multiple of it.
    ["12390", "30", "12390"], // a third is 10: a step of 10
    ["12390", "33", "12380"], // 11: 20
    ["12390", "63", "12375"], // 21: 25
    ["12390", "78", "12350"], // 26: 50
    ["12390", "150", "12350"], // 50: 50, which is exact
    ["12390", "153", "12300"], // 51: 100
    ["0.83", "0.09", "0.8"], // 0.03: 0.05, and 16 × 0.05 is 0.8 in decimals, not 0.8000000000000002
  ])("rounds a third of the range up to a nice step: from %s over %s the floor is %s", (lowest, range, floor) => {
    const highest = new BigNumber(lowest).plus(range).toFixed();
    const card = valueCard(frame, valuesOver(frame, [lowest, highest]), "XRP");
    expect(card.chart.domain).toEqual({ min: floor });
  });

  it("floors exactly: a value on a step is its own floor, and one a hair under it is the step below", () => {
    expect(valueCard(frame, valuesOver(frame, ["12000", "14000", "15000"]), "XRP").chart.domain).toEqual({ min: "12000" });
    expect(valueCard(frame, valuesOver(frame, ["11999.999999", "14000", "15000"]), "XRP").chart.domain).toEqual({ min: "11000" });
  });

  it("gives each bucket its change from the bucket before, in percent, with the first and a zero base left out", () => {
    const rows = valuesOver(frame, ["16000", "16067.2", "16067.2", "8033.6", "7953.264"]);
    const extras = valueCard(frame, rows, "XRP").chart.extras!;
    expect(extras).toHaveLength(1);
    expect(extras[0]!.id).toBe("change");
    expect(extras[0]!.label).toBe("Change");
    expect(extras[0]!.format).toBeUndefined();
    expect(extras[0]!.values).toHaveLength(30);
    expect(extras[0]!.values.slice(0, 25).every((value) => value === null)).toBe(true);
    expect(extras[0]!.values.slice(25)).toEqual([null, "+0.42%", "0.00%", `${MINUS}50.00%`, `${MINUS}1.00%`]);
  });

  it("leaves the change of the first bucket out, even with a row in it", () => {
    const change = valueCard(frame, thirtyDays("16000", "16067.2"), "XRP").chart.extras![0]!.values;
    expect(change[0]).toBeNull();
    expect(change[1]).toBe("+0.69%");
  });

  it("leaves a change out where the bucket before has no value or a value of 0", () => {
    const rows = page("rows", [valueRow("2026-10-14", "0"), valueRow("2026-10-15", "5"), valueRow("2026-10-17", "10")]);
    const change = valueCard(frame, rows, "XRP").chart.extras![0]!.values;
    // Oct 14 is the first row, Oct 15 follows a 0, Oct 16 has no row and Oct 17 follows a bucket without one.
    expect(change.slice(26)).toEqual([null, null, null, null]);
  });

  it("rounds a change half up to two decimals", () => {
    const change = (a: string, b: string) => valueCard(frame, valuesOver(frame, [a, b]), "XRP").chart.extras![0]!.values.at(-1);
    expect(change("1000", "1000.05")).toBe("+0.01%");
    expect(change("1000", "1000.04")).toBe("0.00%");
    expect(change("0.1", "0.3")).toBe("+200.00%");
    expect(change("3", "10000")).toBe("+333,233.33%");
  });

  it("is a dash and no delta without a row, and says its chart is empty", () => {
    const card = valueCard(frame, page("rows", []), "XRP");
    expect(card.tile).toEqual({ figure: "—", sub: null, delta: null, source: "/v2/accounts/{a}/stats/value?interval=day" });
    expect(card.chart.emptyText).toBe("No balance in these 30 days");
    expect(card.chart.series[0]!.values.every((value) => value === null)).toBe(true);
    expect(card.chart.domain).toBeUndefined();
    expect(card.notes).toEqual(["XRP plus every token held, valued at the end of each day."]);
    expect(card.chart.forming).toBe(true);
    expect(valueCard(frameOf("all"), page("rows", []), "XRP").chart.emptyText).toBe("No balance in its whole history");
  });

  it("is a dash and says so for a deleted account, and still draws its history", () => {
    const deleted = frameOf("30d", { deleted: true });
    const card = valueCard(deleted, thirtyDays("16110", "16787.15"), "XRP");
    expect(card.tile).toEqual({ figure: "—", sub: "Deleted accounts hold nothing", delta: null, source: "/v2/accounts/{a}/stats/value?interval=day" });
    expect(card.chart.series[0]!.values[29]).toBe("16787.15");
  });

  it("ignores a row of the day after T and a row before the start", () => {
    const rows = thirtyDays("16110", "16787.15");
    const noisy = page("rows", [valueRow("2026-09-17", "99999"), ...rows.rows, valueRow("2026-10-18", "99999")]);
    expect(rows.rows[0]!.date).toBe(at("2026-09-18"));
    const card = valueCard(frame, noisy, "XRP");
    expect(card).toEqual(valueCard(frame, rows, "XRP"));
    expect(card.tile.figure).toBe("16,787.15 XRP");
    expect(card.chart.series[0]!.values).toHaveLength(30);
    // Rows outside the frame alone are no rows.
    expect(valueCard(frame, page("rows", [valueRow("2026-10-18", "5")]), "XRP").tile.figure).toBe("—");
  });

  it("finds a row by its day whatever the time the API wrote after it", () => {
    const card = valueCard(frame, page("rows", [{ date: "2026-10-17T00:00:00Z", account_value: "7", balance_change_count: 2 }]), "XRP");
    expect(card.tile.figure).toBe("7 XRP");
  });

  it("refuses a value that is not a finite number, so that no NaN reaches a string", () => {
    expect(() => valueCard(frame, page("rows", [valueRow(T, "not a number")]), "XRP")).toThrow();
    expect(() => valueCard(frame, page("rows", [valueRow(T, "NaN")]), "XRP")).toThrow(/account_value/);
    expect(() => valueCard(frame, page("rows", [valueRow(T, "Infinity")]), "XRP")).toThrow(/account_value/);
  });
});

// ---- The transactions sent -------------------------------------------------------------------------------------------------------------

describe("sentCard", () => {
  const frame = frameOf("30d");
  const OCT_16 = frame.axis.buckets.indexOf("2026-10-16");
  const payment = { Payment: 7, OfferCreate: 4, AMMDeposit: 1 };
  const failedDay = sentRow("2026-10-16", payment, { tesSUCCESS: 11, tecPATH_DRY: 1 });

  it("stacks the type groups of XRPL in their order, a bucket's counts summed by group", () => {
    const card = sentCard(frame, page("rows", [failedDay]), "xrpl");
    const { chart } = card;
    expect(chart.series.map((series) => series.id)).toEqual(typeGroups("xrpl").map((group) => group.id));
    expect(chart.series.map((series) => [series.label, series.slot])).toEqual(typeGroups("xrpl").map((group) => [group.label, group.slot]));
    const at16 = Object.fromEntries(chart.series.map((series) => [series.label, series.values[OCT_16]]));
    expect(at16).toEqual({ Payment: "7", OfferCreate: "4", OfferCancel: "0", TrustSet: "0", AMM: "1", Other: "0" });
    expect(chart.totals![OCT_16]).toBe("12");
    expect(chart.format).toEqual({ kind: "count" });
    expect(chart.forming).toBe(true);
    expect(chart.axis).toEqual(frame.axis);
    expect(chart.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is 0 in the buckets without a row once the answer has a row", () => {
    const { chart } = sentCard(frame, page("rows", [failedDay]), "xrpl");
    for (let i = 0; i < 30; i += 1) {
      if (i === OCT_16) continue;
      expect(chart.totals![i]).toBe("0");
      for (const series of chart.series) expect(series.values[i]).toBe("0");
    }
  });

  it("counts the transactions that failed in the extras, as grouped text, and marks their buckets with the symbol", () => {
    const { chart } = sentCard(frame, page("rows", [failedDay]), "xrpl");
    expect(chart.extras).toHaveLength(1);
    expect(chart.extras![0]).toMatchObject({ id: "failed", label: "Failed" });
    expect(chart.extras![0]!.format).toBeUndefined();
    expect(chart.extras![0]!.values[OCT_16]).toBe("1");
    expect(chart.extras![0]!.values.filter((value) => value !== "0")).toEqual(["1"]);
    expect(chart.annotations).toEqual([{ bucket: OCT_16, symbol: "×", label: "has a failed transaction" }]);
  });

  it("sums every result but tesSUCCESS as failed, groups a thousand, and marks every bucket that has one", () => {
    const rows = page("rows", [
      sentRow("2026-10-10", { Payment: 2000 }, { tesSUCCESS: 700, tecPATH_DRY: 1000, tecUNFUNDED_PAYMENT: 300 }),
      sentRow("2026-10-11", { Payment: 3 }, { tesSUCCESS: 3 }),
      sentRow("2026-10-12", { Payment: 2 }, { tesSUCCESS: 1, tefPAST_SEQ: 1 }),
    ]);
    const { chart, tile } = sentCard(frame, rows, "xrpl");
    const index = (day: string) => frame.axis.buckets.indexOf(day);
    expect(chart.extras![0]!.values[index("2026-10-10")]).toBe("1,300");
    expect(chart.extras![0]!.values[index("2026-10-11")]).toBe("0");
    expect(chart.extras![0]!.values[index("2026-10-12")]).toBe("1");
    expect(chart.annotations!.map((note) => note.bucket)).toEqual([index("2026-10-10"), index("2026-10-12")]);
    expect(chart.series[0]!.values[index("2026-10-10")]).toBe("2000");
    expect(tile.figure).toBe("2,005");
    expect(tile.sub).toBe("1,301 failed, fee still paid");
  });

  it("is the sum of the counts and what failed, in the tile", () => {
    const card = sentCard(frame, page("rows", [failedDay]), "xrpl");
    expect(card.tile).toEqual({ figure: "12", sub: "1 failed, fee still paid", delta: null, source: "/v2/accounts/{a}/stats/transactions?interval=day" });
    expect(card.source).toBe("/v2/accounts/{a}/stats/transactions?interval=day");
    const clean = sentCard(frame, page("rows", [sentRow("2026-10-16", { Payment: 4 })]), "xrpl");
    expect(clean.tile.figure).toBe("4");
    expect(clean.tile.sub).toBe("none failed");
    expect(clean.chart.annotations).toEqual([]);
  });

  it("groups the types of Xahau", () => {
    const row = sentRow("2026-10-16", { Payment: 5, Invoke: 2, ClaimReward: 1, URITokenMint: 3, SetHook: 1, OfferCreate: 2 });
    const { chart, tile } = sentCard(frame, page("rows", [row]), "xahau");
    const at16 = Object.fromEntries(chart.series.map((series) => [series.label, series.values[OCT_16]]));
    expect(at16).toEqual({ Payment: "5", Invoke: "2", ClaimReward: "1", URIToken: "3", SetHook: "1", Other: "2" });
    expect(chart.totals![OCT_16]).toBe("14");
    expect(tile.figure).toBe("14");
  });

  it("is null in every bucket, with its own words and a tile of 0, when the frame has no row", () => {
    const card = sentCard(frame, page("rows", []), "xrpl");
    expect(card.chart.totals!.every((total) => total === null)).toBe(true);
    for (const series of card.chart.series) expect(series.values.every((value) => value === null)).toBe(true);
    expect(card.chart.extras![0]!.values.every((value) => value === null)).toBe(true);
    expect(card.chart.annotations).toEqual([]);
    expect(card.chart.emptyText).toBe("No transactions sent in these 30 days");
    expect(card.tile).toEqual({ figure: "0", sub: "none failed", delta: null, source: "/v2/accounts/{a}/stats/transactions?interval=day" });
    expect(sentCard(frameOf("all"), page("rows", []), "xrpl").chart.emptyText).toBe("No transactions sent in its whole history");
  });

  it("is empty when every row is outside the frame, and ignores those rows when there are others", () => {
    const outside = [sentRow("2026-10-18", { Payment: 9 }, { tesSUCCESS: 8, tecPATH_DRY: 1 }), sentRow("2026-09-17", { Payment: 9 })];
    const empty = sentCard(frame, page("rows", outside), "xrpl");
    expect(empty.chart.totals!.every((total) => total === null)).toBe(true);
    expect(empty.tile.figure).toBe("0");
    const card = sentCard(frame, page("rows", [...outside, failedDay]), "xrpl");
    expect(card).toEqual(sentCard(frame, page("rows", [failedDay]), "xrpl"));
    expect(card.tile.figure).toBe("12");
  });

  it("says what it counts, and what the groups are", () => {
    expect(sentCard(frame, page("rows", []), "xrpl").notes).toEqual(["Transactions this account sent; a failed one still paid its fee.", typeGroupsNote("xrpl")]);
    expect(sentCard(frame, page("rows", []), "xahau").notes).toEqual(["Transactions this account sent; a failed one still paid its fee.", typeGroupsNote("xahau")]);
  });

  it("reads the interval of the frame in its source, and puts a week's rows on the week", () => {
    const weeks = frameOf("1y");
    const card = sentCard(weeks, page("rows", [sentRow("2026-10-12", { Payment: 3 })]), "xrpl");
    expect(card.source).toBe("/v2/accounts/{a}/stats/transactions?interval=week");
    expect(card.chart.axis.unit).toBe("week");
    expect(card.chart.totals!.at(-1)).toBe("3");
    expect(card.chart.totals!.at(-2)).toBe("0");
    const months = frameOf("all", { first: { day: "2025-07-15", from: "activation" } });
    expect(sentCard(months, page("rows", [sentRow("2026-10-01", { Payment: 3 })]), "xrpl").tile.source).toBe("/v2/accounts/{a}/stats/transactions?interval=month");
  });
});

// ---- Tokens and exact text ---------------------------------------------------------------------------------------------------------

/** The data a chart draws: everything of it but its token. */
const drawn = (chart: TimeSeriesData): Omit<TimeSeriesData, "token"> => {
  const { token: _token, ...rest } = chart;
  return rest;
};

describe("the token of a chart", () => {
  const frame = frameOf("30d");
  const rows = () => page("rows", [sentRow("2026-10-16", { Payment: 7, OfferCreate: 4, AMMDeposit: 1 }, { tesSUCCESS: 11, tecPATH_DRY: 1 })]);

  it("is the token of what is drawn, and the same for the same data", () => {
    const sent = sentCard(frame, rows(), "xrpl").chart;
    expect(sent.token).toBe(tokenOf(drawn(sent)));
    expect(sentCard(frame, rows(), "xrpl").chart.token).toBe(sent.token);
    const value = valueCard(frame, thirtyDays("16110", "16787.15"), "XRP").chart;
    expect(value.token).toBe(tokenOf(drawn(value)));
    expect(valueCard(frame, thirtyDays("16110", "16787.15"), "XRP").chart.token).toBe(value.token);
  });

  it("changes with one value", () => {
    const base = valueCard(frame, thirtyDays("16110", "16787.15"), "XRP").chart.token;
    expect(valueCard(frame, thirtyDays("16110", "16787.16"), "XRP").chart.token).not.toBe(base);
    const sent = sentCard(frame, rows(), "xrpl").chart.token;
    expect(sentCard(frame, page("rows", [sentRow("2026-10-16", { Payment: 8, OfferCreate: 4, AMMDeposit: 1 }, { tesSUCCESS: 12, tecPATH_DRY: 1 })]), "xrpl").chart.token).not.toBe(sent);
  });

  it("changes with one extra and nothing else: a failed transaction more, in a bucket whose counts are the same", () => {
    const base = sentCard(frame, rows(), "xrpl").chart;
    const more = sentCard(frame, page("rows", [sentRow("2026-10-16", { Payment: 7, OfferCreate: 4, AMMDeposit: 1 }, { tesSUCCESS: 10, tecPATH_DRY: 2 })]), "xrpl").chart;
    expect(more.series).toEqual(base.series);
    expect(more.totals).toEqual(base.totals);
    expect(more.annotations).toEqual(base.annotations);
    expect(more.extras).not.toEqual(base.extras);
    expect(more.token).not.toBe(base.token);
  });

  it("changes with the words of an empty plot", () => {
    const thirty = sentCard(frame, page("rows", []), "xrpl").chart;
    const ninety = sentCard(frameOf("90d"), page("rows", []), "xrpl").chart;
    expect(thirty.emptyText).not.toBe(ninety.emptyText);
    expect(thirty.token).not.toBe(ninety.token);
  });
});

describe("the text of the builders", () => {
  const frame = frameOf("30d");

  const tileTexts = (tile: AnalyticsTile) => [tile.figure, tile.sub, tile.delta?.text].filter((text): text is string => text !== null && text !== undefined);

  it("has no float in a value, an extra or a tile: every value is a plain decimal or the builder's own fixed text", () => {
    // Values whose float sums and quotients are inexact, and counts that are not.
    const values = Array.from({ length: 30 }, (_, i) => `${(i * 0.1 + 0.1).toFixed(1)}`).map((value, i) => (i % 7 === 0 ? `${value}0000001` : value));
    const value = valueCard(frame, valuesOver(frame, values), "XRP");
    const sent = sentCard(
      frame,
      page("rows", [
        sentRow("2026-10-09", { Payment: 3, Foo: 1 }, { tesSUCCESS: 2, tecPATH_DRY: 2 }),
        sentRow("2026-10-10", { OfferCreate: 7 }),
        sentRow("2026-10-16", { Payment: 7, OfferCreate: 4, AMMDeposit: 1 }, { tesSUCCESS: 11, tecPATH_DRY: 1 }),
      ]),
      "xrpl",
    );
    for (const card of [value, sent]) {
      for (const series of card.chart.series) for (const text of series.values) if (text !== null) expect(text).toMatch(DECIMAL);
      for (const text of card.chart.totals ?? []) if (text !== null) expect(text).toMatch(DECIMAL);
      for (const extra of card.chart.extras ?? []) for (const text of extra.values) if (text !== null) expect(text).toMatch(FIXED_TEXT);
      for (const text of Object.values(card.chart.domain ?? {})) expect(text).toMatch(DECIMAL);
    }
    for (const text of [...tileTexts(value.tile), ...tileTexts(sent.tile)]) {
      expect(text).not.toMatch(/NaN|Infinity|e[+-]?\d|\d\.\d{9,}/);
    }
    expect(value.tile.figure).toMatch(/^[\d,]+(\.\d+)? XRP$/);
    expect(value.tile.delta!.text).toMatch(/^[+−]?[\d,]+\.\d%$/);
    expect(sent.tile.figure).toMatch(/^[\d,]+$/);
  });

  it("is what a decimal string is, whatever notation the API's digits come in", () => {
    // `1e-7` and `5E+2` are decimals to the shape check; the chart still holds plain notation.
    const card = valueCard(frame, valuesOver(frame, ["1e-7", "5E+2"]), "XRP");
    expect(card.chart.series[0]!.values.slice(-2)).toEqual(["0.0000001", "500"]);
    expect(card.tile.figure).toBe("500 XRP");
  });
});
