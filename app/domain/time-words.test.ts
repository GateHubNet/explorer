import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, joinAnd, untilText } from "./time-words";

describe("untilText", () => {
  const NOW = Date.UTC(2026, 9, 19, 15, 42, 0);

  it("is null at and after the moment", () => {
    expect(untilText(NOW, NOW)).toBeNull();
    expect(untilText(NOW - 1, NOW)).toBeNull();
  });

  it.each([
    [59, "under a minute"],
    [60, "1 min"],
    [59 * 60 + 1, "60 min"],
    [3600, "1 h"],
    [47 * 3600 + 59 * 60, "47 h"],
    [48 * 3600, "2 days"],
    [3.5 * 86400, "4 days"],
  ])("with %i s left is %s", (seconds, text) => {
    expect(untilText(NOW + seconds * 1000, NOW)).toBe(text);
  });

  it("rounds a minute up, an hour down and a day to the nearest", () => {
    expect(untilText(NOW + 1, NOW)).toBe("under a minute");
    expect(untilText(NOW + 59_999, NOW)).toBe("under a minute");
    expect(untilText(NOW + 60_001, NOW)).toBe("2 min");
    expect(untilText(NOW + 3_599_000, NOW)).toBe("60 min");
    expect(untilText(NOW + 3_600_000 + 3_599_000, NOW)).toBe("1 h");
    expect(untilText(NOW + 48 * 3_600_000 - 1, NOW)).toBe("47 h");
    expect(untilText(NOW + 2.49 * 86_400_000, NOW)).toBe("2 days");
    expect(untilText(NOW + 400 * 86_400_000, NOW)).toBe("400 days");
  });

  it("puts ~ before the number only", () => {
    expect(untilText(NOW + 11 * 60_000, NOW, { approx: true })).toBe("~11 min");
    expect(untilText(NOW + 4 * 86_400_000, NOW, { approx: true })).toBe("~4 days");
    expect(untilText(NOW + 5 * 3_600_000, NOW, { approx: true })).toBe("~5 h");
    expect(untilText(NOW + 30_000, NOW, { approx: true })).toBe("under a minute");
    expect(untilText(NOW, NOW, { approx: true })).toBeNull();
  });
});

describe("formatDate and formatDateTime", () => {
  it("write UTC dates with the fixed month table", () => {
    expect(formatDate("2026-10-09T09:34:30Z")).toBe("Oct 9, 2026");
    expect(formatDate("2026-09-20")).toBe("Sep 20, 2026");
    expect(formatDateTime("2026-10-09T09:34:30Z")).toBe("Oct 9, 2026, 09:34 UTC");
    expect(formatDateTime("2026-07-21T08:00:12.004Z")).toBe("Jul 21, 2026, 08:00 UTC");
    expect(formatDateTime(1792256472)).toBe("Oct 17, 2026, 17:01 UTC"); // unix seconds
    expect(formatDate(1792256472)).toBe("Oct 17, 2026");
    expect(formatDate("soon")).toBe("soon");
  });

  it("read a string with no zone as UTC and a zone as the UTC moment it names", () => {
    expect(formatDateTime("2026-10-09T09:34:30")).toBe("Oct 9, 2026, 09:34 UTC");
    expect(formatDateTime("2026-10-09T01:34:30+02:00")).toBe("Oct 8, 2026, 23:34 UTC");
    expect(formatDate("2026-10-09T01:34:30+02:00")).toBe("Oct 8, 2026");
  });

  it("take the day from UTC at the turn of the day, not from a local clock", () => {
    expect(formatDateTime("2026-12-31T23:59:59Z")).toBe("Dec 31, 2026, 23:59 UTC");
    expect(formatDateTime("2027-01-01T00:00:00Z")).toBe("Jan 1, 2027, 00:00 UTC");
  });

  it("return what is not a moment as it came", () => {
    expect(formatDateTime("soon")).toBe("soon");
    expect(formatDate("2026-13-45")).toBe("2026-13-45");
    expect(formatDateTime("2026-13-45T25:00:00Z")).toBe("2026-13-45T25:00:00Z");
    expect(formatDate(Number.NaN)).toBe("NaN");
    expect(formatDateTime(Number.NaN)).toBe("NaN");
    expect(formatDateTime("")).toBe("");
  });
});

describe("joinAnd", () => {
  it("joins a list the way a sentence does", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
    expect(joinAnd(["vl.ripple.com", "unl.xrplf.org"])).toBe("vl.ripple.com and unl.xrplf.org");
    expect(joinAnd(["a", "b", "c", "d"])).toBe("a, b, c and d");
  });
});
