import { describe, expect, it } from "vitest";

import { bucketStarts, pendingCount, pendingNote, utcDayOf, windowOf } from "./window";

describe("windowOf", () => {
  it("is the 30 days up to and including T, the last one running", () => {
    const w = windowOf("2026-10-17", "30d");
    expect(w.period).toBe("30d");
    expect(w.unit).toBe("day");
    expect(w.buckets).toHaveLength(30);
    expect(w.buckets[0]).toBe("2026-09-18");
    expect(w.buckets[29]).toBe("2026-10-17");
    expect(w.start).toBe("2026-09-18");
    expect(w.end).toBe("2026-10-17");
    expect(w.full).toEqual({ start: "2026-09-17", end: "2026-10-16" });
    expect(w.previous).toEqual({ start: "2026-08-18", end: "2026-09-16" });
    expect(w.note).toBe("the 30 days from Sep 18 to Oct 17, 2026 (UTC), today so far");
  });

  it("lists every day once, in order", () => {
    const { buckets } = windowOf("2026-03-02", "30d");
    // 2026 is not a leap year: February has 28 days.
    expect(buckets.slice(0, 3)).toEqual(["2026-02-01", "2026-02-02", "2026-02-03"]);
    expect(buckets.slice(-3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(new Set(buckets).size).toBe(30);
  });

  it("is the 7 days up to T, with the 7 full days before T and the 7 before those", () => {
    const w = windowOf("2026-10-17", "7d");
    expect(w.unit).toBe("day");
    expect(w.buckets).toHaveLength(7);
    expect(w.buckets[0]).toBe("2026-10-11");
    expect(w.start).toBe("2026-10-11");
    expect(w.full).toEqual({ start: "2026-10-10", end: "2026-10-16" });
    expect(w.previous).toEqual({ start: "2026-10-03", end: "2026-10-09" });
    expect(w.note).toBe("the 7 days from Oct 11 to Oct 17, 2026 (UTC), today so far");
  });

  it("is the 90 days up to T", () => {
    const w = windowOf("2026-10-17", "90d");
    expect(w.buckets).toHaveLength(90);
    expect(w.buckets[0]).toBe("2026-07-20");
    expect(w.buckets[89]).toBe("2026-10-17");
    expect(w.full.start).toBe("2026-07-19");
    expect(w.full.end).toBe("2026-10-16");
    expect(w.previous).toEqual({ start: "2026-04-20", end: "2026-07-18" });
    expect(w.note).toBe("the 90 days from Jul 20 to Oct 17, 2026 (UTC), today so far");
  });

  it("is the 52 weeks up to the week of T for 1y, the API's end being T itself", () => {
    const w = windowOf("2026-10-17", "1y");
    expect(w.period).toBe("1y");
    expect(w.unit).toBe("week");
    expect(w.buckets).toHaveLength(52);
    expect(w.buckets[0]).toBe("2025-10-20");
    expect(w.buckets[51]).toBe("2026-10-12");
    expect(w.start).toBe("2025-10-20");
    expect(w.end).toBe("2026-10-17");
    expect(w.full).toEqual({ start: "2025-10-13", end: "2026-10-11" });
    expect(w.previous).toEqual({ start: "2024-10-14", end: "2025-10-12" });
    expect(w.note).toBe(
      "the 52 weeks from the week of Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), this week so far",
    );
  });

  it("makes every week bucket a Monday, seven days apart", () => {
    const { buckets } = windowOf("2026-10-17", "1y");
    for (const [i, day] of buckets.entries()) {
      expect(new Date(`${day}T00:00:00Z`).getUTCDay()).toBe(1);
      if (i > 0) expect((Date.parse(day) - Date.parse(buckets[i - 1]!)) / 86_400_000).toBe(7);
    }
  });

  it("starts the running week on T when T is a Monday, and keeps full.end the day before", () => {
    const w = windowOf("2026-10-12", "1y");
    expect(w.buckets[51]).toBe("2026-10-12");
    expect(w.end).toBe("2026-10-12");
    expect(w.full.end).toBe("2026-10-11");
  });

  it("puts a Sunday in the week that began the Monday before", () => {
    const w = windowOf("2026-10-18", "1y");
    expect(w.buckets[51]).toBe("2026-10-12");
    expect(w.end).toBe("2026-10-18");
    expect(w.full.end).toBe("2026-10-11");
  });

  it("names the year of both ends when the window crosses a year", () => {
    expect(windowOf("2027-01-05", "30d").note).toBe("the 30 days from Dec 7, 2026 to Jan 5, 2027 (UTC), today so far");
  });

  it("names the year once for a week window inside one year", () => {
    // The week of Mon 2026-12-28 is the 52nd; 51 weeks earlier is Mon 2026-01-05.
    const w = windowOf("2026-12-30", "1y");
    expect(w.buckets[0]).toBe("2026-01-05");
    expect(w.note).toBe(
      "the 52 weeks from the week of Jan 5 to the week of Dec 28, 2026 (UTC, weeks from Monday), this week so far",
    );
  });

  it("does arithmetic in UTC days across a leap day and a year", () => {
    const w = windowOf("2024-03-01", "7d");
    expect(w.buckets).toEqual([
      "2024-02-24",
      "2024-02-25",
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    // T-14 to T-8, over New Year: Jan 2 is 2 days after Dec 31, so Dec 19 is 14 days before it.
    expect(windowOf("2026-01-02", "7d").previous).toEqual({ start: "2025-12-19", end: "2025-12-25" });
  });
});

describe("utcDayOf", () => {
  it("is the UTC day of a time in unix seconds", () => {
    expect(utcDayOf(1792281599)).toBe("2026-10-17");
    expect(utcDayOf(1792281600)).toBe("2026-10-18");
    expect(utcDayOf(0)).toBe("1970-01-01");
  });

  it("reads the recorded close time as the day it was", () => {
    expect(utcDayOf(1792256472)).toBe("2026-10-17");
  });
});

describe("bucketStarts", () => {
  it("lists the weeks from start up to the one that holds end", () => {
    const weeks = bucketStarts("2025-10-13", "2026-10-11", "week");
    expect(weeks).toHaveLength(52);
    expect(weeks[0]).toBe("2025-10-13");
    expect(weeks[51]).toBe("2026-10-05");
  });

  it("includes the week that end is the first day of", () => {
    expect(bucketStarts("2026-10-05", "2026-10-12", "week")).toEqual(["2026-10-05", "2026-10-12"]);
  });

  it("lists days from start to end, both included", () => {
    expect(bucketStarts("2026-10-15", "2026-10-17", "day")).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(bucketStarts("2026-10-17", "2026-10-17", "day")).toEqual(["2026-10-17"]);
  });

  it("is empty when end is before start", () => {
    expect(bucketStarts("2026-10-17", "2026-10-16", "day")).toEqual([]);
    expect(bucketStarts("2026-10-12", "2026-10-11", "week")).toEqual([]);
  });
});

describe("pendingCount", () => {
  const days = ["2026-10-15", "2026-10-16", "2026-10-17"];

  it("counts the newest buckets without a row, back from the last", () => {
    expect(pendingCount(days, new Set(["2026-10-15"]))).toBe(2);
    expect(pendingCount(days, new Set(["2026-10-16"]))).toBe(1);
    expect(pendingCount(days, new Set(days))).toBe(0);
  });

  it("is at most 2", () => {
    expect(pendingCount([...days, "2026-10-18"], new Set())).toBe(2);
  });

  it("stops at the first bucket with a row: a gap further back is not pending", () => {
    expect(pendingCount(days, new Set(["2026-10-17"]))).toBe(0);
    expect(pendingCount(["2026-10-14", ...days], new Set(["2026-10-14", "2026-10-16"]))).toBe(1);
  });

  it("is 0 for no buckets", () => {
    expect(pendingCount([], new Set())).toBe(0);
  });

  it("is at most the number of buckets", () => {
    expect(pendingCount(["2026-10-17"], new Set())).toBe(1);
  });
});

describe("pendingNote", () => {
  const days = ["2026-10-15", "2026-10-16", "2026-10-17"];

  it("names the running day", () => {
    expect(pendingNote(days, 1, "day")).toBe("Oct 17 is not computed yet.");
  });

  it("names the running day and the day before", () => {
    expect(pendingNote(days, 2, "day")).toBe("Oct 16 and Oct 17 are not computed yet.");
  });

  it("names the running week", () => {
    expect(pendingNote(["2026-10-12", "2026-10-19"], 1, "week")).toBe("The week of Oct 19 is not computed yet.");
  });

  it("names two weeks", () => {
    expect(pendingNote(["2026-10-05", "2026-10-12", "2026-10-19"], 2, "week")).toBe(
      "The weeks of Oct 12 and Oct 19 are not computed yet.",
    );
  });

  it("is null when nothing is pending", () => {
    expect(pendingNote(days, 0, "day")).toBeNull();
    expect(pendingNote(days, 0, "week")).toBeNull();
  });
});
