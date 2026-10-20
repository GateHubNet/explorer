import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { analyticsWindow, type AnalyticsPeriod, type AnalyticsWindow } from "../domain/analytics-params";
import { tokenOf } from "../domain/fnv";
import { marketHref } from "../domain/market-pair";
import { typeGroups, typeGroupsNote } from "../domain/type-groups";
import type { SmallMultiplesData, TimeSeriesData } from "../ui/charts/types";
import { featuresOf } from "../ui/features";
import type {
  AccountTxStatsRow,
  AccountValueRow,
  AnalyticsBalanceChanges,
  AnalyticsBalanceLine,
  AnalyticsBalanceRow,
  AnalyticsBalances,
  AnalyticsCounterparties,
  AnalyticsCounterparty,
  AnalyticsExchanges,
  AnalyticsPair,
  BalanceChangeBucket,
  BalanceChangeTotal,
  Page,
} from "./api-types";
import {
  analyticsFrame,
  balancesCard,
  changesCard,
  counterpartiesCard,
  dexWording,
  pairsCard,
  sentCard,
  valueCard,
  type AnalyticsData,
  type AnalyticsFrame,
  type AnalyticsTile,
  type DexWording,
} from "./analytics-view";

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

// ---- The wording of the DEX -------------------------------------------------------------------------------------------------------------

describe("dexWording", () => {
  const xrpl = (ammData: "on" | "off") => ({ hasAmm: true, features: featuresOf({ AMM_DATA: ammData }) });
  const xahau = (ammData: "on" | "off") => ({ hasAmm: false, features: featuresOf({ AMM_DATA: ammData }) });

  it("says order book and AMM, and that swaps against pools are included, on XRPL with the AMM data on", () => {
    expect(dexWording(xrpl("on"))).toEqual({ hint: "order book and AMM", lead: "Includes swaps against AMM pools." });
  });

  it("is neutral, with no AMM sentence, on XRPL with the AMM data off", () => {
    expect(dexWording(xrpl("off"))).toEqual({ hint: "on the DEX", lead: null });
  });

  it("says Xahau has no AMM, whichever way the switch is", () => {
    const wording = { hint: "order book", lead: "Order-book trades only; Xahau has no AMM." };
    expect(dexWording(xahau("on"))).toEqual(wording);
    expect(dexWording(xahau("off"))).toEqual(wording);
  });
});

// ---- Money in and out, and where balance changes come from -------------------------------------------------------------------------------

const changeTotal = (change_type: string | undefined, count: number, in_value: string, out_value: string, net_value: string): BalanceChangeTotal => ({
  ...(change_type === undefined ? {} : { change_type }),
  count,
  in_value,
  out_value,
  net_value,
});
const changeRow = (day: string, change_type: string | undefined, in_value: string, out_value: string, count = 1): BalanceChangeBucket => ({
  date: at(day),
  ...(change_type === undefined ? {} : { change_type }),
  count,
  in_value,
  out_value,
});
const changesAnswer = (rows: BalanceChangeBucket[], totals: BalanceChangeTotal[] = [], interval: "day" | "week" | "month" = "day"): AnalyticsBalanceChanges => ({
  result: "success",
  start: at("2026-09-18"),
  end: at("2026-10-18"),
  interval,
  totals,
  count: rows.length,
  rows,
});

/** The totals of the brief's 30 days. */
const TOTALS: BalanceChangeTotal[] = [
  changeTotal("transaction_cost", 63, "0", "0.000756", "-0.000756"),
  changeTotal("payment_destination", 14, "9840", "0", "9840"),
  changeTotal("escrow_create", 1, "0", "500", "-500"),
  changeTotal("escrow_finish", 1, "500", "0", "500"),
  changeTotal("paychannel_fund", 1, "0", "20", "-20"),
  changeTotal(undefined, 2, "120", "300", "-180"),
  changeTotal("future_type", 1, "1", "0", "1"),
];

const XRPL_DEX: DexWording = { hint: "order book and AMM", lead: "Includes swaps against AMM pools." };
const MONEY_NOTE =
  "Payments, DEX trades, escrow, channels and other transactions that changed this account's balances, valued in XRP at each day's rate. " +
  "Fees, and amounts that only passed through, are left out.";

describe("changesCard: money in and out", () => {
  const frame = frameOf("30d");
  const OCT_16 = frame.axis.buckets.indexOf("2026-10-16");
  const oct16 = [
    changeRow("2026-10-16", "payment_destination", "45100", "0"),
    changeRow("2026-10-16", "exchange", "100", "38100"),
    changeRow("2026-10-16", "transaction_cost", "0", "0.000144"),
    changeRow("2026-10-16", "intermediary", "500", "500"),
    changeRow("2026-10-16", undefined, "0", "0"),
  ];

  it("is received and sent, drawn up and down, of the rows that count: not the fee and not what passed through", () => {
    const { chart } = changesCard(frame, changesAnswer(oct16), "XRP", XRPL_DEX).money;
    expect(chart.series.map((series) => [series.id, series.label, series.slot])).toEqual([
      ["received", "Received", "up"],
      ["sent", "Sent", "down"],
    ]);
    expect(chart.series[0]!.values[OCT_16]).toBe("45200");
    expect(chart.series[1]!.values[OCT_16]).toBe("38100");
    expect(chart.axis).toEqual(frame.axis);
    expect(chart.format).toEqual({ kind: "value", unit: "XRP" });
    expect(chart.forming).toBe(true);
    expect(chart.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is 0 in the other buckets once any bucket has a row that counts", () => {
    const { chart } = changesCard(frame, changesAnswer(oct16), "XRP", XRPL_DEX).money;
    for (let i = 0; i < 30; i += 1) {
      if (i === OCT_16) continue;
      expect(chart.series[0]!.values[i]).toBe("0");
      expect(chart.series[1]!.values[i]).toBe("0");
      expect(chart.extras![0]!.values[i]).toBe("0");
    }
  });

  it("gives each bucket its net, received less sent, as signed text in the extras", () => {
    const rows = [
      ...oct16,
      changeRow("2026-10-15", "payment_source", "0", "1234.5"),
      changeRow("2026-10-14", "payment_destination", "0.1", "0"),
      changeRow("2026-10-14", "exchange", "0.2", "0"),
    ];
    const { chart } = changesCard(frame, changesAnswer(rows), "XRP", XRPL_DEX).money;
    expect(chart.extras).toHaveLength(1);
    expect(chart.extras![0]).toMatchObject({ id: "net", label: "Net" });
    expect(chart.extras![0]!.format).toBeUndefined();
    const at = (day: string) => frame.axis.buckets.indexOf(day);
    expect(chart.extras![0]!.values[at("2026-10-16")]).toBe("+7,100");
    expect(chart.extras![0]!.values[at("2026-10-15")]).toBe(`${MINUS}1,234.5`);
    expect(chart.extras![0]!.values[at("2026-10-14")]).toBe("+0.3");
    expect(chart.extras![0]!.values[at("2026-10-13")]).toBe("0");
  });

  it("sums the buckets in the summary, compact and signed, and the net is the difference", () => {
    const { summary } = changesCard(frame, changesAnswer(oct16), "XRP", XRPL_DEX).money;
    expect(summary).toEqual({ received: "+45.2K", sent: `${MINUS}38.1K`, net: "+7,100" });
    const fall = [changeRow("2026-10-16", "payment_source", "0", "12000"), changeRow("2026-10-15", "payment_destination", "2000", "0")];
    expect(changesCard(frame, changesAnswer(fall), "XRP", XRPL_DEX).money.summary).toEqual({ received: "+2,000", sent: `${MINUS}12K`, net: `${MINUS}10K` });
  });

  it("writes a sum of 0 with no sign", () => {
    const { summary } = changesCard(frame, changesAnswer([changeRow("2026-10-16", undefined, "0", "0")]), "XRP", XRPL_DEX).money;
    expect(summary).toEqual({ received: "0", sent: "0", net: "0" });
  });

  it("counts a row without a change type, and any type but the fee and the pass-through", () => {
    const rows = [
      changeRow("2026-10-16", undefined, "7", "3"),
      changeRow("2026-10-16", "escrow_finish", "5", "0"),
      changeRow("2026-10-16", "paychannel_payout", "0", "2"),
      changeRow("2026-10-16", "future_type", "1", "1"),
    ];
    const { chart } = changesCard(frame, changesAnswer(rows), "XRP", XRPL_DEX).money;
    expect(chart.series[0]!.values[OCT_16]).toBe("13");
    expect(chart.series[1]!.values[OCT_16]).toBe("6");
  });

  it("has no value, its own words and no summary when no row counts", () => {
    const fees = [changeRow("2026-10-16", "transaction_cost", "0", "0.000144"), changeRow("2026-10-16", "intermediary", "500", "500")];
    for (const rows of [[], fees]) {
      const money = changesCard(frame, changesAnswer(rows), "XRP", XRPL_DEX).money;
      for (const series of money.chart.series) expect(series.values).toEqual(Array(30).fill(null));
      expect(money.chart.extras![0]!.values).toEqual(Array(30).fill(null));
      expect(money.chart.emptyText).toBe("No money in or out in these 30 days");
      expect(money.summary).toBeNull();
    }
    expect(changesCard(frameOf("all"), changesAnswer([]), "XRP", XRPL_DEX).money.chart.emptyText).toBe("No money in or out in its whole history");
  });

  it("ignores a row outside the frame, so a frame whose only counted row is outside has none", () => {
    const outside = [changeRow("2026-10-18", "payment_destination", "99", "0"), changeRow("2026-09-17", "payment_destination", "99", "0")];
    expect(changesCard(frame, changesAnswer(outside), "XRP", XRPL_DEX).money.summary).toBeNull();
    const card = changesCard(frame, changesAnswer([...outside, ...oct16]), "XRP", XRPL_DEX);
    expect(card).toEqual(changesCard(frame, changesAnswer(oct16), "XRP", XRPL_DEX));
    expect(card.money.summary!.received).toBe("+45.2K");
  });

  it("says what the money is, in the network's own currency", () => {
    expect(changesCard(frame, changesAnswer(oct16), "XRP", XRPL_DEX).money.notes).toEqual([MONEY_NOTE]);
    const xahau = changesCard(frame, changesAnswer(oct16), "XAH", dexWording({ hasAmm: false, features: featuresOf({}) })).money;
    expect(xahau.notes).toEqual([MONEY_NOTE.replace("valued in XRP", "valued in XAH")]);
    expect(xahau.chart.format).toEqual({ kind: "value", unit: "XAH" });
  });

  it("puts a week's rows on the week and names the interval in its source", () => {
    const weeks = frameOf("1y");
    const card = changesCard(weeks, changesAnswer([changeRow("2026-10-12", "payment_destination", "3", "0")], [], "week"), "XRP", XRPL_DEX);
    expect(card.money.source).toBe("/v2/accounts/{a}/analytics/balance_changes?interval=week");
    expect(card.money.chart.axis.unit).toBe("week");
    expect(card.money.chart.series[0]!.values.at(-1)).toBe("3");
    expect(card.money.chart.series[0]!.values.at(-2)).toBe("0");
    expect(card.tile.source).toBe("/v2/accounts/{a}/analytics/balance_changes?interval=week");
    expect(changesCard(frame, changesAnswer([]), "XRP", XRPL_DEX).money.source).toBe("/v2/accounts/{a}/analytics/balance_changes?interval=day");
  });
});

describe("changesCard: where balance changes come from", () => {
  const frame = frameOf("30d");
  const card = changesCard(frame, changesAnswer([], TOTALS), "XRP", XRPL_DEX);
  const { sources } = card;
  const row = (id: string) => sources.rows.find((candidate) => candidate.id === id)!;

  it("has the rows in their order, with the hints of the table", () => {
    expect(sources.rows.map((r) => [r.id, r.name, r.hint])).toEqual([
      ["fees", "Fees", "transaction cost, burned"],
      ["dex", "DEX trades", "order book and AMM"],
      ["in", "Payments in", "received"],
      ["out", "Payments out", "sent"],
      ["through", "Passed through", "as an intermediary"],
      ["escrow", "Escrow", "locked, finished or cancelled"],
      ["channels", "Payment channels", "funded or claimed"],
      ["other", "Other", "changes of other transaction types"],
    ]);
  });

  it("takes the DEX hint from the wording, whichever it is", () => {
    const neutral = changesCard(frame, changesAnswer([], TOTALS), "XRP", { hint: "on the DEX", lead: null });
    expect(neutral.sources.rows[1]!.hint).toBe("on the DEX");
    const xahau = changesCard(frame, changesAnswer([], TOTALS), "XAH", { hint: "order book", lead: "Order-book trades only; Xahau has no AMM." });
    expect(xahau.sources.rows[1]!.hint).toBe("order book");
  });

  it("gives a row its in, out, signed net and count, from the totals", () => {
    expect(row("fees")).toMatchObject({ in: "0", out: "0.000756", net: `${MINUS}0.000756`, changes: "63", bar: { in: "0", out: "0.000756" } });
    expect(row("in")).toMatchObject({ in: "9,840", out: "0", net: "+9,840", changes: "14", bar: { in: "9840", out: "0" } });
  });

  it("shows a row with no change as 0s and no bar, and keeps the rows that always show", () => {
    for (const id of ["dex", "out", "through"]) {
      expect(row(id)).toMatchObject({ in: "0", out: "0", net: "0", changes: "0", bar: null });
    }
    expect(sources.rows).toHaveLength(8);
  });

  it("adds escrow's three types and the channels' two", () => {
    expect(row("escrow")).toMatchObject({ in: "500", out: "500", net: "0", changes: "2", bar: { in: "500", out: "500" } });
    expect(row("channels")).toMatchObject({ in: "0", out: "20", net: `${MINUS}20`, changes: "1", bar: { in: "0", out: "20" } });
    const more = changesCard(
      frame,
      changesAnswer([], [
        ...TOTALS,
        changeTotal("escrow_cancel", 3, "250.5", "0", "250.5"),
        changeTotal("paychannel_payout", 2, "10", "0", "10"),
      ]),
      "XRP",
      XRPL_DEX,
    ).sources;
    expect(more.rows.find((r) => r.id === "escrow")).toMatchObject({ in: "750.5", out: "500", net: "+250.5", changes: "5" });
    expect(more.rows.find((r) => r.id === "channels")).toMatchObject({ in: "10", out: "20", net: `${MINUS}10`, changes: "3" });
  });

  it("puts the unclassified total and every type it does not name in Other", () => {
    expect(row("other")).toMatchObject({ in: "121", out: "300", net: `${MINUS}179`, changes: "3", bar: { in: "121", out: "300" } });
  });

  it("has no Other row without them", () => {
    const named = TOTALS.filter((total) => total.change_type !== undefined && total.change_type !== "future_type");
    const rows = changesCard(frame, changesAnswer([], named), "XRP", XRPL_DEX).sources.rows;
    expect(rows.map((r) => r.id)).toEqual(["fees", "dex", "in", "out", "through", "escrow", "channels"]);
    // An unknown type alone is enough for the row.
    const future = changesCard(frame, changesAnswer([], [changeTotal("future_type", 1, "1", "0", "1")]), "XRP", XRPL_DEX).sources.rows;
    expect(future.at(-1)).toMatchObject({ id: "other", in: "1", out: "0", net: "+1", changes: "1" });
  });

  it("scales every bar by the largest in or out of any row", () => {
    expect(sources.max).toBe("9840");
    const small = changesCard(frame, changesAnswer([], [changeTotal("transaction_cost", 2, "0", "0.000288", "-0.000288")]), "XRP", XRPL_DEX).sources;
    expect(small.max).toBe("0.000288");
    expect(changesCard(frame, changesAnswer([], [changeTotal("exchange", 1, "300", "700", "-400")]), "XRP", XRPL_DEX).sources.max).toBe("700");
  });

  it("says a period with no balance change has none, and writes its rows as 0s", () => {
    const empty = changesCard(frame, changesAnswer([]), "XRP", XRPL_DEX).sources;
    expect(empty.empty).toBe("No balance changes in these 30 days.");
    expect(empty.max).toBe("0");
    expect(empty.rows.map((r) => r.changes)).toEqual(Array(7).fill("0"));
    expect(empty.rows.every((r) => r.bar === null)).toBe(true);
    expect(sources.empty).toBeNull();
    expect(changesCard(frameOf("all"), changesAnswer([]), "XRP", XRPL_DEX).sources.empty).toBe("No balance changes in its whole history.");
  });

  it("is titled with the period, and says what it counts and where it comes from", () => {
    expect(sources.title).toBe("Where balance changes come from, last 30 days");
    expect(changesCard(frameOf("1y"), changesAnswer([], TOTALS, "week"), "XRP", XRPL_DEX).sources.title).toBe("Where balance changes come from, last 52 weeks");
    expect(sources.note).toBe(
      "Every balance change of the period, grouped by what caused it. " +
        "Passed through: payments that rippled through this account's trust lines on their way to someone else.",
    );
    expect(sources.source).toBe("/v2/accounts/{a}/analytics/balance_changes");
  });

  it("sums a thousand changes with a grouped count", () => {
    const rows = changesCard(frame, changesAnswer([], [changeTotal("payment_source", 12345, "0", "1234567.891", "-1234567.891")]), "XRP", XRPL_DEX).sources.rows;
    expect(rows.find((r) => r.id === "out")).toMatchObject({ out: "1,234,567.89", net: `${MINUS}1,234,567.89`, changes: "12,345", bar: { in: "0", out: "1234567.891" } });
  });
});

describe("changesCard: tile 3, Fees paid", () => {
  const frame = frameOf("30d");

  it("is the fee row's out value with the native code, over its drops", () => {
    expect(changesCard(frame, changesAnswer([], TOTALS), "XRP", XRPL_DEX).tile).toEqual({
      figure: "0.000756 XRP",
      sub: "756 drops, burned",
      delta: null,
      source: "/v2/accounts/{a}/analytics/balance_changes?interval=day",
    });
  });

  it("groups the drops and the amount", () => {
    const totals = [changeTotal("transaction_cost", 1540, "0", "0.015408", "-0.015408")];
    expect(changesCard(frame, changesAnswer([], totals), "XRP", XRPL_DEX).tile).toMatchObject({ figure: "0.015408 XRP", sub: "15,408 drops, burned" });
    const big = [changeTotal("transaction_cost", 1540, "0", "1234567.123456", "-1234567.123456")];
    expect(changesCard(frame, changesAnswer([], big), "XRP", XRPL_DEX).tile).toMatchObject({ figure: "1,234,567.123456 XRP", sub: "1,234,567,123,456 drops, burned" });
  });

  it("is 0 without a fee row, in the native code of the network", () => {
    const tile = changesCard(frame, changesAnswer([], [changeTotal("exchange", 1, "1", "0", "1")]), "XRP", XRPL_DEX).tile;
    expect(tile).toMatchObject({ figure: "0 XRP", sub: "0 drops, burned" });
    expect(changesCard(frame, changesAnswer([]), "XAH", XRPL_DEX).tile).toMatchObject({ figure: "0 XAH", sub: "0 drops, burned" });
  });

  it("reads the interval of the view in its source", () => {
    expect(changesCard(frameOf("all", { first: { day: "2025-07-15", from: "activation" } }), changesAnswer([]), "XRP", XRPL_DEX).tile.source).toBe(
      "/v2/accounts/{a}/analytics/balance_changes?interval=month",
    );
  });

  it("refuses a value that is not a finite number", () => {
    expect(() => changesCard(frame, changesAnswer([], [changeTotal("exchange", 1, "NaN", "0", "0")]), "XRP", XRPL_DEX)).toThrow(/in_value/);
    expect(() => changesCard(frame, changesAnswer([changeRow(T, "exchange", "1", "Infinity")]), "XRP", XRPL_DEX)).toThrow(/out_value/);
  });
});

// ---- The counterparties ------------------------------------------------------------------------------------------------------------

const ADDRESS_A = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const ADDRESS_B = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const counterparty = (account: string, sent: string, received: string, paymentsSent: number, paymentsReceived: number): AnalyticsCounterparty => ({
  account,
  sent_value: sent,
  received_value: received,
  total_value: new BigNumber(sent).plus(received).toFixed(),
  payments_sent: paymentsSent,
  payments_received: paymentsReceived,
  first: "2026-09-20T10:00:00Z",
  last: "2026-10-16T10:00:00Z",
});
const counterpartiesAnswer = (total: number, rows: AnalyticsCounterparty[], count = rows.length): AnalyticsCounterparties => ({
  result: "success",
  start: at("2026-09-18"),
  end: at("2026-10-18"),
  sort: "value",
  total,
  count,
  counterparties: rows,
});

describe("counterpartiesCard", () => {
  const frame = frameOf("30d");

  it("is a row for each counterparty, with its sent and received values and its payments both ways", () => {
    const card = counterpartiesCard(frame, counterpartiesAnswer(14, [counterparty(ADDRESS_A, "1234.567", "0.5", 9, 3), counterparty(ADDRESS_B, "0", "88000", 0, 2)], 6));
    expect(card.rows).toEqual([
      { account: ADDRESS_A, sent: "1,234.57", received: "0.5", payments: "12" },
      { account: ADDRESS_B, sent: "—", received: "88,000", payments: "2" },
    ]);
  });

  it("is a dash for a side of 0 only, and writes a small one in digits", () => {
    const rows = counterpartiesCard(frame, counterpartiesAnswer(1, [counterparty(ADDRESS_A, "0.0000001", "0", 1, 0)])).rows;
    expect(rows[0]).toMatchObject({ sent: "<0.000001", received: "—" });
  });

  it("groups the payments", () => {
    const rows = counterpartiesCard(frame, counterpartiesAnswer(1, [counterparty(ADDRESS_A, "5", "5", 1200, 345)])).rows;
    expect(rows[0]!.payments).toBe("1,545");
  });

  it("says how many of how many counterparties it shows, largest first", () => {
    const some = counterpartiesCard(frame, counterpartiesAnswer(14, [counterparty(ADDRESS_A, "1", "1", 1, 1)], 6));
    expect(some.note).toBe("The 6 largest of 14 counterparties, by value sent plus received.");
    const all = counterpartiesCard(frame, counterpartiesAnswer(4, [counterparty(ADDRESS_A, "1", "1", 1, 1)], 4));
    expect(all.note).toBe("All 4 counterparties, largest first.");
    expect(counterpartiesCard(frame, counterpartiesAnswer(1234, [], 6)).note).toBe("The 6 largest of 1,234 counterparties, by value sent plus received.");
  });

  it("says no payments were made or received, and has no note, when there is no counterparty", () => {
    const card = counterpartiesCard(frame, counterpartiesAnswer(0, []));
    expect(card.empty).toBe("No payments in these 30 days.");
    expect(card.note).toBeNull();
    expect(card.rows).toEqual([]);
    expect(card.tile.figure).toBe("0");
    expect(counterpartiesCard(frameOf("all"), counterpartiesAnswer(0, [])).empty).toBe("No payments in its whole history.");
    expect(counterpartiesCard(frame, counterpartiesAnswer(4, [counterparty(ADDRESS_A, "1", "1", 1, 1)], 4)).empty).toBeNull();
  });

  it("is tile 4: the number of counterparties, grouped, and the call it comes from", () => {
    const card = counterpartiesCard(frame, counterpartiesAnswer(14, [counterparty(ADDRESS_A, "1", "1", 1, 1)], 6));
    expect(card.tile).toEqual({ figure: "14", sub: "accounts it paid or was paid by", delta: null, source: "/v2/accounts/{a}/analytics/counterparties" });
    expect(card.source).toBe("/v2/accounts/{a}/analytics/counterparties");
    expect(counterpartiesCard(frame, counterpartiesAnswer(12345, [], 6)).tile.figure).toBe("12,345");
  });

  it("refuses a value that is not a finite number", () => {
    expect(() => counterpartiesCard(frame, counterpartiesAnswer(1, [counterparty(ADDRESS_A, "NaN", "1", 1, 1)]))).toThrow(/sent_value/);
  });
});

// ---- The balances ---------------------------------------------------------------------------------------------------------------------

const LP_CODE = "03ABCDEF0123456789ABCDEF0123456789ABCDEF";
const LP_ISSUER = "rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y";
const balanceLine = (currency: string, balance: string, counterparty?: string): AnalyticsBalanceLine => ({ currency, ...(counterparty ? { counterparty } : {}), balance });
const balanceRow = (day: string, currency: string, balance: string, counterparty?: string): AnalyticsBalanceRow => ({
  date: at(day),
  currency,
  ...(counterparty ? { counterparty } : {}),
  balance,
});
const balancesAnswer = (lines: AnalyticsBalanceLine[], rows: AnalyticsBalanceRow[], total = lines.length, interval: "day" | "week" | "month" = "day"): AnalyticsBalances => ({
  result: "success",
  start: at("2026-09-18"),
  end: at("2026-10-18"),
  interval,
  lines_total: total,
  lines,
  count: rows.length,
  rows,
});

describe("balancesCard", () => {
  const frame = frameOf("30d");
  const lines = [balanceLine("XRP", "12480.256114"), balanceLine("USD", "3120.5", ADDRESS_B), balanceLine(LP_CODE, "-5", LP_ISSUER)];
  /** XRP from Sep 18, USD from Oct 10, the LP token from Oct 15, each with a row in every bucket from its first. */
  const rows = (): AnalyticsBalanceRow[] =>
    frame.axis.buckets.flatMap((day, i) => [
      balanceRow(day, "XRP", `${12000 + i}.256114`),
      ...(day >= "2026-10-10" ? [balanceRow(day, "USD", "3120.5", ADDRESS_B)] : []),
      ...(day >= "2026-10-15" ? [balanceRow(day, LP_CODE, "-5", LP_ISSUER)] : []),
    ]);
  const card = balancesCard(frame, balancesAnswer(lines, rows(), 7));

  it("is a panel for each line, in the order of the lines, labelled by its currency", () => {
    const chart = card.chart!;
    expect(chart.panels.map((panel) => [panel.id, panel.label])).toEqual([
      ["XRP", "XRP"],
      [`USD.${ADDRESS_B}`, "USD"],
      [`${LP_CODE}.${LP_ISSUER}`, "LP token"],
    ]);
  });

  it("gives an issued line its short issuer as the sublabel, and the native line none", () => {
    const [xrp, usd, lp] = card.chart!.panels;
    expect(xrp).not.toHaveProperty("sublabel");
    expect(usd!.sublabel).toBe("rhub8V…F3wq");
    expect(lp!.sublabel).toBe("rKiCet…432Y");
  });

  it("draws each in its own unit, so that the table's cells are exact", () => {
    expect(card.chart!.panels.map((panel) => panel.format)).toEqual([
      { kind: "amount", unit: "XRP" },
      { kind: "amount", unit: "USD" },
      { kind: "amount", unit: "LP token" },
    ]);
  });

  it("has the balance of each bucket, and null before the line's first row", () => {
    const [xrp, usd, lp] = card.chart!.panels;
    expect(xrp!.values).toHaveLength(30);
    expect(xrp!.values[0]).toBe("12000.256114");
    expect(xrp!.values[29]).toBe("12029.256114");
    const first = (panel: typeof xrp) => panel!.values.findIndex((value) => value !== null);
    expect(first(usd)).toBe(frame.axis.buckets.indexOf("2026-10-10"));
    expect(usd!.values.slice(0, 22).every((value) => value === null)).toBe(true);
    expect(usd!.values.slice(22)).toEqual(Array(8).fill("3120.5"));
    expect(first(lp)).toBe(frame.axis.buckets.indexOf("2026-10-15"));
    expect(lp!.values.slice(27)).toEqual(["-5", "-5", "-5"]);
    expect(lp!.values.slice(0, 27).every((value) => value === null)).toBe(true);
  });

  it("shares the frame's axis, is forming, and has a token", () => {
    const chart = card.chart!;
    expect(chart.axis).toEqual(frame.axis);
    expect(chart.forming).toBe(true);
    expect(chart.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("tells how the panels are scaled, how many of the balances they are, and what a negative one means", () => {
    expect(card.notes).toEqual([
      "Each currency on its own scale, from zero; hover or focus one to read all of them on the same day.",
      "The 3 largest of 7 balances: XRP first, then by value now.",
      "A balance below zero is what the account owes on that line.",
    ]);
  });

  it("leaves out the note of the count when every balance is shown, and the note of a negative one when none is", () => {
    const shown = balancesCard(frame, balancesAnswer(lines.slice(0, 2), rows().filter((row) => row.currency !== LP_CODE), 2));
    expect(shown.notes).toEqual(["Each currency on its own scale, from zero; hover or focus one to read all of them on the same day."]);
  });

  it("says a line that was below zero earlier in the period is one that is owed", () => {
    const owed = [balanceRow("2026-10-01", "USD", "-40", ADDRESS_B), balanceRow("2026-10-17", "USD", "60", ADDRESS_B)];
    const shown = balancesCard(frame, balancesAnswer([balanceLine("USD", "60", ADDRESS_B)], owed));
    expect(shown.notes).toContain("A balance below zero is what the account owes on that line.");
  });

  it("names the native code of the network in the note of the count", () => {
    const xahau = balancesCard(frame, balancesAnswer([balanceLine("XAH", "5")], [balanceRow(T, "XAH", "5")], 7));
    expect(xahau.notes[1]).toBe("The 1 largest of 7 balances: XAH first, then by value now.");
  });

  it("keeps the lines of one currency and two issuers apart", () => {
    const other = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
    const two = balancesCard(
      frame,
      balancesAnswer([balanceLine("USD", "1", ADDRESS_B), balanceLine("USD", "2", other)], [balanceRow(T, "USD", "1", ADDRESS_B), balanceRow(T, "USD", "2", other)]),
    );
    expect(two.chart!.panels.map((panel) => [panel.label, panel.sublabel, panel.values.at(-1)])).toEqual([
      ["USD", "rhub8V…F3wq", "1"],
      ["USD", "rvYAfW…s59B", "2"],
    ]);
  });

  it("ignores a row of the day after T", () => {
    const noisy = balancesAnswer([balanceLine("XRP", "5")], [balanceRow("2026-10-17", "XRP", "5"), balanceRow("2026-10-18", "XRP", "999")]);
    expect(balancesCard(frame, noisy).chart!.panels[0]!.values.at(-1)).toBe("5");
    expect(balancesCard(frame, noisy).chart!.panels[0]!.values).toHaveLength(30);
  });

  it("says there are no balances, with no chart and no notes, when there is no line", () => {
    const empty = balancesCard(frame, balancesAnswer([], []));
    expect(empty).toEqual({ chart: null, notes: [], empty: "No balances in these 30 days", source: "/v2/accounts/{a}/analytics/balances?interval=day" });
    expect(balancesCard(frameOf("all"), balancesAnswer([], [], 0, "month")).empty).toBe("No balances in its whole history");
    expect(card.empty).toBeNull();
  });

  it("reads the interval of the frame in its source", () => {
    expect(card.source).toBe("/v2/accounts/{a}/analytics/balances?interval=day");
    const weeks = frameOf("1y");
    const week = balancesCard(weeks, balancesAnswer([balanceLine("XRP", "5")], [balanceRow("2026-10-12", "XRP", "5")], 1, "week"));
    expect(week.source).toBe("/v2/accounts/{a}/analytics/balances?interval=week");
    expect(week.chart!.panels[0]!.values.at(-1)).toBe("5");
    expect(week.chart!.axis.unit).toBe("week");
  });

  it("writes a balance in plain digits whatever notation the API's come in", () => {
    const small = balancesCard(frame, balancesAnswer([balanceLine("XRP", "1e-7")], [balanceRow(T, "XRP", "1e-7")]));
    expect(small.chart!.panels[0]!.values.at(-1)).toBe("0.0000001");
    expect(() => balancesCard(frame, balancesAnswer([balanceLine("XRP", "5")], [balanceRow(T, "XRP", "NaN")]))).toThrow(/balance/);
  });
});

// ---- The DEX pairs ---------------------------------------------------------------------------------------------------------------------

const LIONS = `4C494F4E53${"0".repeat(30)}`;
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const pairOf = (pair: Partial<AnalyticsPair> & Pick<AnalyticsPair, "base_currency" | "counter_currency">): AnalyticsPair => ({
  count: 12,
  base_volume: "0",
  counter_volume: "0",
  bought: "0",
  sold: "0",
  bought_counter: "0",
  sold_counter: "0",
  ...pair,
});
const exchangesAnswer = (pairs: AnalyticsPair[], total = pairs.length, count = pairs.length): AnalyticsExchanges => ({
  result: "success",
  start: at("2026-09-18"),
  end: at("2026-10-18"),
  total,
  count,
  pairs,
});

describe("pairsCard", () => {
  const frame = frameOf("30d");
  const ctx = { net: "xrpl" as const, native: "XRP" as const, markets: true, dex: XRPL_DEX };
  /** D2 stores this pair as USD/XRP; its natural order is XRP/USD. */
  const usdXrp = pairOf({
    base_currency: "USD",
    base_issuer: ADDRESS_B,
    counter_currency: "XRP",
    count: 17,
    bought: "1500",
    sold: "2000",
    bought_counter: "3610",
    sold_counter: "4810",
    native_volume: "8420",
  });
  const lionsXrp = pairOf({ base_currency: LIONS, base_issuer: LIONS_ISSUER, counter_currency: "XRP", count: 3, bought: "100", sold: "0", native_volume: "250.5" });

  it("shows a pair in its natural orientation, with its issued sides and its link in that orientation", () => {
    const [row] = pairsCard(frame, exchangesAnswer([usdXrp]), ctx).rows;
    expect(row!.label).toBe("XRP/USD");
    expect(row!.issued).toEqual(["USD rhub8V…F3wq"]);
    expect(row!.href).toBe(marketHref("xrpl", { currency: "XRP" }, { currency: "USD", issuer: ADDRESS_B }));
    expect(row!.id).toBe(`USD+${ADDRESS_B}/XRP`);
  });

  it("reads Bought and Sold of the displayed base from the counter sums when the order is inverted", () => {
    const [row] = pairsCard(frame, exchangesAnswer([usdXrp]), ctx).rows;
    expect(row).toMatchObject({ volume: "8,420", trades: "17", bought: "4,810 XRP", sold: "3,610 XRP" });
  });

  it("keeps D2's order when it is the natural one, and reads its own sums, with a dash for 0", () => {
    const [row] = pairsCard(frame, exchangesAnswer([lionsXrp]), ctx).rows;
    expect(row).toMatchObject({ label: "LIONS/XRP", issued: ["LIONS rGHtf1…AuzS"], bought: "100 LIONS", sold: "—", volume: "250.5", trades: "3" });
    expect(row!.href).toBe(marketHref("xrpl", { currency: LIONS, issuer: LIONS_ISSUER }, { currency: "XRP" }));
  });

  it("has a dash for a side the account did not trade, in either orientation", () => {
    const none = pairOf({ base_currency: "USD", base_issuer: ADDRESS_B, counter_currency: "XRP", bought: "5", sold: "5", bought_counter: "0", sold_counter: "7", native_volume: "1" });
    const [row] = pairsCard(frame, exchangesAnswer([none]), ctx).rows;
    expect(row).toMatchObject({ bought: "7 XRP", sold: "—" });
  });

  it("writes every digit of an amount", () => {
    const exact = pairOf({ base_currency: LIONS, base_issuer: LIONS_ISSUER, counter_currency: "XRP", bought: "1234567.123456789", native_volume: "1234567.891" });
    const [row] = pairsCard(frame, exchangesAnswer([exact]), ctx).rows;
    expect(row).toMatchObject({ bought: "1,234,567.123456789 LIONS", volume: "1,234,567.89" });
  });

  it("has no link while the markets are off, and a dash for a volume the API left out", () => {
    const { native_volume: _volume, ...noVolume } = usdXrp;
    const [row] = pairsCard(frame, exchangesAnswer([noVolume]), { ...ctx, markets: false }).rows;
    expect(row!.href).toBeNull();
    expect(row!.volume).toBe("—");
    expect(row!.label).toBe("XRP/USD");
  });

  it("keeps the order of the answer, which is by volume", () => {
    const rows = pairsCard(frame, exchangesAnswer([usdXrp, lionsXrp]), ctx).rows;
    expect(rows.map((row) => row.label)).toEqual(["XRP/USD", "LIONS/XRP"]);
  });

  it("shows two issued sides, base first, and none for the native one", () => {
    const eurUsd = pairOf({ base_currency: "EUR", base_issuer: LIONS_ISSUER, counter_currency: "USD", counter_issuer: ADDRESS_B, native_volume: "9" });
    const [row] = pairsCard(frame, exchangesAnswer([eurUsd]), ctx).rows;
    // The fiat that ranks better in QUOTE_RANK is the counter: USD, then EUR.
    expect(row!.label).toBe("EUR/USD");
    expect(row!.issued).toEqual(["EUR rGHtf1…AuzS", "USD rhub8V…F3wq"]);
  });

  it("reads Xahau's native code", () => {
    const xah = pairOf({ base_currency: "USD", base_issuer: ADDRESS_B, counter_currency: "XAH", bought: "1", sold: "2", bought_counter: "30", sold_counter: "40", native_volume: "70" });
    const [row] = pairsCard(frame, exchangesAnswer([xah]), { net: "xahau", native: "XAH", markets: true, dex: dexWording({ hasAmm: false, features: featuresOf({}) }) }).rows;
    expect(row).toMatchObject({ label: "XAH/USD", bought: "40 XAH", sold: "30 XAH" });
    expect(row!.href).toBe(marketHref("xahau", { currency: "XAH" }, { currency: "USD", issuer: ADDRESS_B }));
  });

  it("notes what the DEX includes, what the cells are of, and how many pairs are shown", () => {
    expect(pairsCard(frame, exchangesAnswer([usdXrp], 9, 6), ctx).notes).toEqual([
      "Includes swaps against AMM pools.",
      "Bought and sold are of each pair's base as shown.",
      "The 6 largest of 9 pairs, by volume in XRP.",
    ]);
  });

  it("leaves out the AMM sentence while its data is off, and the count when every pair is shown", () => {
    const neutral = pairsCard(frame, exchangesAnswer([usdXrp], 1, 1), { ...ctx, dex: { hint: "on the DEX", lead: null } });
    expect(neutral.notes).toEqual(["Bought and sold are of each pair's base as shown."]);
  });

  it("says on Xahau that the pairs are the order book's", () => {
    const wording = dexWording({ hasAmm: false, features: featuresOf({ AMM_DATA: "on" }) });
    const xahau = pairsCard(frame, exchangesAnswer([usdXrp], 8, 6), { net: "xahau", native: "XAH", markets: true, dex: wording });
    expect(xahau.notes).toEqual([
      "Order-book trades only; Xahau has no AMM.",
      "Bought and sold are of each pair's base as shown.",
      "The 6 largest of 8 pairs, by volume in XAH.",
    ]);
  });

  it("says there are no trades, with no notes, when there is no pair", () => {
    const empty = pairsCard(frame, exchangesAnswer([]), ctx);
    expect(empty).toEqual({ rows: [], notes: [], empty: "No DEX trades in these 30 days.", source: "/v2/accounts/{a}/analytics/exchanges" });
    expect(pairsCard(frameOf("all"), exchangesAnswer([]), ctx).empty).toBe("No DEX trades in its whole history.");
    expect(pairsCard(frame, exchangesAnswer([usdXrp]), ctx).empty).toBeNull();
  });

  it("names the call it comes from", () => {
    expect(pairsCard(frame, exchangesAnswer([usdXrp]), ctx).source).toBe("/v2/accounts/{a}/analytics/exchanges");
  });

  it("refuses an amount that is not a finite number", () => {
    // Only the fields a cell reads are read: `bought` for a pair in the displayed order, `sold_counter` for one that is inverted.
    const shown = pairOf({ base_currency: LIONS, base_issuer: LIONS_ISSUER, counter_currency: "XRP", bought: "NaN" });
    expect(() => pairsCard(frame, exchangesAnswer([shown]), ctx)).toThrow(/bought/);
    const inverted = pairOf({ base_currency: "USD", base_issuer: ADDRESS_B, counter_currency: "XRP", sold_counter: "Infinity" });
    expect(() => pairsCard(frame, exchangesAnswer([inverted]), ctx)).toThrow(/sold_counter/);
    expect(() => pairsCard(frame, exchangesAnswer([pairOf({ ...shown, bought: "1", native_volume: "NaN" })]), ctx)).toThrow(/native_volume/);
  });
});

// ---- Tokens and exact text of the later builders ------------------------------------------------------------------------------------

describe("the token of the money chart and the balance panels", () => {
  const frame = frameOf("30d");
  const rows = () => [changeRow("2026-10-16", "payment_destination", "45100", "0"), changeRow("2026-10-16", "exchange", "100", "38100")];

  it("is the token of what is drawn, and the same for the same data", () => {
    const { chart } = changesCard(frame, changesAnswer(rows()), "XRP", XRPL_DEX).money;
    expect(chart.token).toBe(tokenOf(drawn(chart)));
    expect(changesCard(frame, changesAnswer(rows()), "XRP", XRPL_DEX).money.chart.token).toBe(chart.token);
  });

  it("changes with one value, one extra and the words of an empty plot", () => {
    const base = changesCard(frame, changesAnswer(rows()), "XRP", XRPL_DEX).money.chart;
    const bigger = [changeRow("2026-10-16", "payment_destination", "45101", "0"), changeRow("2026-10-16", "exchange", "100", "38100")];
    const more = changesCard(frame, changesAnswer(bigger), "XRP", XRPL_DEX).money.chart;
    expect(more.token).not.toBe(base.token);
    const empty30 = changesCard(frame, changesAnswer([]), "XRP", XRPL_DEX).money.chart;
    const empty90 = changesCard(frameOf("90d"), changesAnswer([]), "XRP", XRPL_DEX).money.chart;
    expect(empty30.emptyText).not.toBe(empty90.emptyText);
    expect(empty30.token).not.toBe(empty90.token);
  });

  it("covers the extras: a net that differs with the same series", () => {
    const base = changesCard(frame, changesAnswer(rows()), "XRP", XRPL_DEX).money.chart;
    const tampered = { ...base, extras: [{ ...base.extras![0]!, values: base.extras![0]!.values.map((value) => (value === "+7,100" ? "+7,101" : value)) }] };
    expect(tokenOf(drawn(tampered))).not.toBe(base.token);
  });

  it("is the token of the panels, the same for the same data, and changed by one balance", () => {
    const line = [balanceLine("XRP", "5")];
    const card = balancesCard(frame, balancesAnswer(line, [balanceRow(T, "XRP", "5")]));
    const chart = card.chart as SmallMultiplesData;
    const { token: _token, ...rest } = chart;
    expect(chart.token).toBe(tokenOf(rest));
    expect(balancesCard(frame, balancesAnswer(line, [balanceRow(T, "XRP", "5")])).chart!.token).toBe(chart.token);
    expect(balancesCard(frame, balancesAnswer(line, [balanceRow(T, "XRP", "5.000001")])).chart!.token).not.toBe(chart.token);
  });
});

describe("the text of the later builders", () => {
  const frame = frameOf("30d");

  it("has no float in a value, an extra, a summary, a tile or a cell: sums that floats get wrong are exact", () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a float, and 1.1 × 3 is 3.3000000000000003.
    const rows = [
      changeRow("2026-10-16", "payment_destination", "0.1", "0"),
      changeRow("2026-10-16", "exchange", "0.2", "0.1"),
      changeRow("2026-10-15", "payment_source", "0.7", "1.1"),
      changeRow("2026-10-15", undefined, "0.1", "2.2"),
    ];
    const totals = [changeTotal("transaction_cost", 3, "0", "0.3", "-0.3"), changeTotal("exchange", 3, "0.1", "0.2", "-0.1"), changeTotal(undefined, 1, "0.2", "0", "0.2")];
    const card = changesCard(frame, changesAnswer(rows, totals), "XRP", XRPL_DEX);
    for (const series of card.money.chart.series) for (const text of series.values) if (text !== null) expect(text).toMatch(DECIMAL);
    expect(card.money.chart.series[0]!.values.at(-2)).toBe("0.3");
    expect(card.money.chart.series[1]!.values.at(-2)).toBe("0.1");
    expect(card.money.chart.extras![0]!.values.at(-2)).toBe("+0.2");
    expect(card.money.summary).toEqual({ received: "+1.1", sent: `${MINUS}3.4`, net: `${MINUS}2.3` });
    for (const sourceRow of card.sources.rows) {
      for (const text of [sourceRow.in, sourceRow.out, sourceRow.net, sourceRow.changes]) expect(text).not.toMatch(/NaN|Infinity|e[+-]?\d|\d\.\d{9,}/);
      if (sourceRow.bar) for (const text of [sourceRow.bar.in, sourceRow.bar.out]) expect(text).toMatch(DECIMAL);
    }
    expect(card.sources.max).toMatch(DECIMAL);
    expect(card.tile.figure).toBe("0.3 XRP");
    expect(card.tile.sub).toBe("300,000 drops, burned");
  });

  it("is what a decimal string is, whatever notation the API's digits come in", () => {
    const rows = [changeRow(T, "payment_destination", "1e-7", "5E+2")];
    const card = changesCard(frame, changesAnswer(rows, [changeTotal("payment_source", 1, "1e-7", "5E+2", "-499.9999999")]), "XRP", XRPL_DEX);
    expect(card.money.chart.series[0]!.values.at(-1)).toBe("0.0000001");
    expect(card.money.chart.series[1]!.values.at(-1)).toBe("500");
    expect(card.sources.rows.find((r) => r.id === "out")!.bar).toEqual({ in: "0.0000001", out: "500" });
  });

  it("hands the page strings only: every field of a card but its chart is text, a list of text, a boolean or null", () => {
    const isPlain = (value: unknown): boolean =>
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (Array.isArray(value) ? value.every(isPlain) : typeof value === "object" && Object.values(value as object).every(isPlain));
    const changes = changesCard(frame, changesAnswer([changeRow("2026-10-16", "exchange", "1", "2")], TOTALS), "XRP", XRPL_DEX);
    const balances = balancesCard(frame, balancesAnswer([balanceLine("XRP", "5")], [balanceRow(T, "XRP", "5")]));
    const pairs = pairsCard(frame, exchangesAnswer([pairOf({ base_currency: "USD", base_issuer: ADDRESS_B, counter_currency: "XRP", count: 2, native_volume: "5" })]), {
      net: "xrpl",
      native: "XRP",
      markets: true,
      dex: XRPL_DEX,
    });
    expect(isPlain({ tile: changes.tile, summary: changes.money.summary, notes: changes.money.notes, source: changes.money.source, sources: changes.sources })).toBe(true);
    expect(isPlain(counterpartiesCard(frame, counterpartiesAnswer(1, [counterparty(ADDRESS_A, "1", "2", 3, 4)])))).toBe(true);
    expect(isPlain({ notes: balances.notes, empty: balances.empty, source: balances.source })).toBe(true);
    expect(isPlain(pairs)).toBe(true);
  });
});

describe("AnalyticsData", () => {
  it("is the period and one promise for the frame and for each card, each settling to its state", async () => {
    const frame = frameOf("30d");
    const failed = Promise.resolve({ state: "failed" as const });
    const data: AnalyticsData = {
      period: "30d",
      frame: Promise.resolve({ state: "ok", ...frame }),
      value: Promise.resolve({ state: "ok", ...valueCard(frame, thirtyDays("1", "2"), "XRP") }),
      sent: Promise.resolve({ state: "late" }),
      changes: Promise.resolve({ state: "ok", ...changesCard(frame, changesAnswer([]), "XRP", XRPL_DEX) }),
      counterparties: failed,
      balances: Promise.resolve({ state: "ok", ...balancesCard(frame, balancesAnswer([], [])) }),
      pairs: Promise.resolve({ state: "ok", ...pairsCard(frame, exchangesAnswer([]), { net: "xrpl", native: "XRP", markets: true, dex: XRPL_DEX }) }),
    };
    expect((await data.frame).state).toBe("ok");
    expect((await data.sent).state).toBe("late");
    expect((await data.counterparties).state).toBe("failed");
    const changes = await data.changes;
    expect(changes.state === "ok" && changes.tile.figure).toBe("0 XRP");
  });
});
