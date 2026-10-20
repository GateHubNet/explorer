import { describe, expect, it } from "vitest";

import {
  ANALYTICS_PERIODS,
  ANALYTICS_PERIOD_LABELS,
  DEFAULT_ANALYTICS_PERIOD,
  analyticsHref,
  analyticsPhrases,
  analyticsWindow,
  parseAnalyticsQuery,
} from "./analytics-params";

const ADDRESS = "rEnYxSHcSeQiNJzPyEXRWnBuvpdmzHyeEh";

describe("the periods", () => {
  it("are 30 days (the default), 90 days, 1 year and All, with their labels", () => {
    expect(ANALYTICS_PERIODS).toEqual(["30d", "90d", "1y", "all"]);
    expect(DEFAULT_ANALYTICS_PERIOD).toBe("30d");
    expect(ANALYTICS_PERIOD_LABELS).toEqual({ "30d": "30 days", "90d": "90 days", "1y": "1 year", all: "All" });
  });
});

describe("parseAnalyticsQuery", () => {
  it("is the default period for the bare tab", () => {
    expect(parseAnalyticsQuery("tab=analytics")).toEqual({ period: "30d" });
  });

  it("is the period of a canonical query", () => {
    expect(parseAnalyticsQuery("tab=analytics&period=90d")).toEqual({ period: "90d" });
    expect(parseAnalyticsQuery("tab=analytics&period=1y")).toEqual({ period: "1y" });
    expect(parseAnalyticsQuery("tab=analytics&period=all")).toEqual({ period: "all" });
  });

  it("reads a query with or without its ?, and a URLSearchParams as the text it serializes to", () => {
    expect(parseAnalyticsQuery("?tab=analytics&period=1y")).toEqual({ period: "1y" });
    expect(parseAnalyticsQuery(new URLSearchParams("tab=analytics&period=1y"))).toEqual({ period: "1y" });
    expect(parseAnalyticsQuery(new URLSearchParams("tab=analytics"))).toEqual({ period: "30d" });
    expect(parseAnalyticsQuery(new URLSearchParams("period=1y&tab=analytics"))).toEqual({ canonical: "tab=analytics&period=1y" });
  });

  it("redirects what names the default period to the query without it", () => {
    expect(parseAnalyticsQuery("tab=analytics&period=30d")).toEqual({ canonical: "tab=analytics" });
  });

  it("redirects an unknown period, or one in another case, to the default's query", () => {
    expect(parseAnalyticsQuery("tab=analytics&period=2y")).toEqual({ canonical: "tab=analytics" });
    expect(parseAnalyticsQuery("tab=analytics&period=90D")).toEqual({ canonical: "tab=analytics" });
    expect(parseAnalyticsQuery("tab=analytics&period=")).toEqual({ canonical: "tab=analytics" });
    expect(parseAnalyticsQuery("tab=analytics&period=7d")).toEqual({ canonical: "tab=analytics" });
  });

  it("reads the first value of a repeated parameter", () => {
    expect(parseAnalyticsQuery("tab=analytics&period=90d&period=1y")).toEqual({ canonical: "tab=analytics&period=90d" });
    expect(parseAnalyticsQuery("tab=analytics&period=2y&period=90d")).toEqual({ canonical: "tab=analytics" });
    expect(parseAnalyticsQuery("tab=analytics&tab=analytics")).toEqual({ canonical: "tab=analytics" });
  });

  it("puts tab first", () => {
    expect(parseAnalyticsQuery("period=90d&tab=analytics")).toEqual({ canonical: "tab=analytics&period=90d" });
  });

  it("drops every other parameter", () => {
    for (const extra of ["marker=WzEw", "back=a.b", "tag=5", "in=usd", "x=1"]) {
      expect(parseAnalyticsQuery(`tab=analytics&${extra}`)).toEqual({ canonical: "tab=analytics" });
      expect(parseAnalyticsQuery(`tab=analytics&period=1y&${extra}`)).toEqual({ canonical: "tab=analytics&period=1y" });
      expect(parseAnalyticsQuery(`${extra}&tab=analytics`)).toEqual({ canonical: "tab=analytics" });
    }
  });

  it("has one URL per view: an escaped spelling of a canonical query is redirected to it, and its canonical query ends the redirect", () => {
    const escaped = parseAnalyticsQuery("tab=%61nalytics");
    expect(escaped).toEqual({ canonical: "tab=analytics" });
    expect(parseAnalyticsQuery("tab=analytics&period=%39%30d")).toEqual({ canonical: "tab=analytics&period=90d" });
    for (const query of ["tab=analytics&period=90d&x=1", "period=1y&tab=analytics", "tab=analytics&period=30d", "tab=analytics&period=nope"]) {
      const answer = parseAnalyticsQuery(query);
      if (!("canonical" in answer)) throw new Error(`${query} should be redirected`);
      expect(parseAnalyticsQuery(answer.canonical)).toEqual({ period: expect.any(String) });
    }
  });

  it("is a redirect for a query that does not name the tab", () => {
    expect(parseAnalyticsQuery("")).toEqual({ canonical: "tab=analytics" });
    expect(parseAnalyticsQuery("period=1y")).toEqual({ canonical: "tab=analytics&period=1y" });
  });
});

describe("analyticsHref", () => {
  it("has no period for the default's link", () => {
    expect(analyticsHref("xrpl", ADDRESS, "30d")).toBe(`/xrpl/account/${ADDRESS}?tab=analytics`);
  });

  it("names the other periods", () => {
    expect(analyticsHref("xrpl", ADDRESS, "90d")).toBe(`/xrpl/account/${ADDRESS}?tab=analytics&period=90d`);
    expect(analyticsHref("xrpl", ADDRESS, "1y")).toBe(`/xrpl/account/${ADDRESS}?tab=analytics&period=1y`);
    expect(analyticsHref("xahau", ADDRESS, "all")).toBe(`/xahau/account/${ADDRESS}?tab=analytics&period=all`);
  });

  it("is a canonical query, in every period", () => {
    for (const period of ANALYTICS_PERIODS) {
      const query = analyticsHref("xrpl", ADDRESS, period).split("?")[1]!;
      expect(parseAnalyticsQuery(query)).toEqual({ period });
    }
  });
});

describe("analyticsPhrases", () => {
  it("names the 30 days, and leaves the default out of the title", () => {
    expect(analyticsPhrases("30d", "Jul 2025")).toEqual({ title: "last 30 days", empty: "these 30 days", meta: null });
  });

  it("names the 90 days", () => {
    expect(analyticsPhrases("90d", "Jul 2025")).toEqual({ title: "last 90 days", empty: "these 90 days", meta: "last 90 days" });
  });

  it("names the year as 52 weeks", () => {
    expect(analyticsPhrases("1y", "Jul 2025")).toEqual({ title: "last 52 weeks", empty: "these 52 weeks", meta: "last 52 weeks" });
  });

  it("names All by its first month in the cards and by no month in the title", () => {
    expect(analyticsPhrases("all", "Jul 2025")).toEqual({ title: "since Jul 2025", empty: "its whole history", meta: "all time" });
    expect(analyticsPhrases("all", "Oct 2026").title).toBe("since Oct 2026");
  });

  it("does not read the first month for the other periods", () => {
    expect(analyticsPhrases("90d", "").title).toBe("last 90 days");
    expect(analyticsPhrases("1y", "Jul 2025").title).toBe(analyticsPhrases("1y", "Jan 2020").title);
  });
});

describe("analyticsWindow", () => {
  it("is the 30 days up to and including T, per day", () => {
    const w = analyticsWindow("30d", "2026-10-17");
    expect(w.period).toBe("30d");
    expect(w.unit).toBe("day");
    expect(w.buckets).toHaveLength(30);
    expect(w.buckets[0]).toBe("2026-09-18");
    expect(w.buckets.at(-1)).toBe("2026-10-17");
    expect(w.start).toBe("2026-09-18");
    expect(w.T).toBe("2026-10-17");
    expect(w.origin).toBeNull();
  });

  it("is the 90 days up to and including T, per day", () => {
    const w = analyticsWindow("90d", "2026-10-17");
    expect(w.unit).toBe("day");
    expect(w.buckets).toHaveLength(90);
    expect(w.start).toBe("2026-07-20");
    expect(w.buckets[0]).toBe("2026-07-20");
    expect(w.buckets.at(-1)).toBe("2026-10-17");
    expect(w.origin).toBeNull();
  });

  it("is 52 weeks from Monday for 1 year, the last one this week", () => {
    const w = analyticsWindow("1y", "2026-10-17"); // a Saturday
    expect(w.unit).toBe("week");
    expect(w.buckets).toHaveLength(52);
    expect(w.start).toBe("2025-10-20");
    expect(w.buckets[0]).toBe("2025-10-20");
    expect(w.buckets.at(-1)).toBe("2026-10-12");
    expect(w.T).toBe("2026-10-17");
    expect(w.origin).toBeNull();
    // Weeks from Monday: every bucket is a Monday, 7 days apart.
    for (const [index, bucket] of w.buckets.entries()) {
      expect(new Date(`${bucket}T00:00:00Z`).getUTCDay()).toBe(1);
      if (index > 0) expect((Date.parse(bucket) - Date.parse(w.buckets[index - 1]!)) / 86_400_000).toBe(7);
    }
  });

  it("has the same weeks for a Sunday, a Monday and a Saturday of one week", () => {
    const saturday = analyticsWindow("1y", "2026-10-17");
    expect(analyticsWindow("1y", "2026-10-18").buckets).toEqual(saturday.buckets); // a Sunday
    expect(analyticsWindow("1y", "2026-10-12").buckets).toEqual(saturday.buckets); // a Monday
  });

  it("starts the new week at midnight on a Monday", () => {
    const w = analyticsWindow("1y", "2026-10-19"); // just after 00:00 UTC on a Monday
    expect(w.buckets).toHaveLength(52);
    expect(w.start).toBe("2025-10-27");
    expect(w.buckets.at(-1)).toBe("2026-10-19");
  });

  it("is the months from the activation's to T's, per month", () => {
    const w = analyticsWindow("all", "2026-10-17", { day: "2025-07-15", from: "activation" });
    expect(w.period).toBe("all");
    expect(w.unit).toBe("month");
    expect(w.buckets).toHaveLength(16);
    expect(w.buckets[0]).toBe("2025-07-01");
    expect(w.buckets.at(-1)).toBe("2026-10-01");
    expect(w.start).toBe("2025-07-01");
    expect(w.T).toBe("2026-10-17");
    expect(w.origin).toBe("activation");
  });

  it("lists every month once, over a year's end", () => {
    const { buckets } = analyticsWindow("all", "2026-02-03", { day: "2025-11-30", from: "activation" });
    expect(buckets).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("starts at the month of the oldest transaction when it has no activation", () => {
    const w = analyticsWindow("all", "2026-10-17", { day: "2026-09-03", from: "oldest" });
    expect(w.buckets).toEqual(["2026-09-01", "2026-10-01"]);
    expect(w.start).toBe("2026-09-01");
    expect(w.origin).toBe("oldest");
  });

  it("is T's month alone with neither", () => {
    for (const first of [null, undefined]) {
      const w = analyticsWindow("all", "2026-10-17", first);
      expect(w.buckets).toEqual(["2026-10-01"]);
      expect(w.start).toBe("2026-10-01");
      expect(w.origin).toBe("none");
    }
  });

  it("is one month when the account was activated in T's month", () => {
    const w = analyticsWindow("all", "2026-10-17", { day: "2026-10-02", from: "activation" });
    expect(w.buckets).toEqual(["2026-10-01"]);
    expect(w.origin).toBe("activation");
  });

  it("is never after T's month, and is then the month of T from no record", () => {
    const w = analyticsWindow("all", "2026-10-17", { day: "2026-11-02", from: "activation" });
    expect(w.buckets).toEqual(["2026-10-01"]);
    expect(w.start).toBe("2026-10-01");
    expect(w.origin).toBe("none");
    expect(analyticsWindow("all", "2026-10-17", { day: "2027-01-01", from: "oldest" }).buckets).toEqual(["2026-10-01"]);
  });

  it("is 166 months from January 2013", () => {
    const w = analyticsWindow("all", "2026-10-17", { day: "2013-01-02", from: "activation" });
    expect(w.buckets).toHaveLength(166);
    expect(w.buckets[0]).toBe("2013-01-01");
    expect(w.buckets.at(-1)).toBe("2026-10-01");
    expect(new Set(w.buckets).size).toBe(166);
    // Each month is the first of the next calendar month after its predecessor.
    expect(w.buckets.every((bucket) => /^\d{4}-\d{2}-01$/.test(bucket))).toBe(true);
    expect([...w.buckets].sort()).toEqual(w.buckets);
  });

  it("ignores the first month for the other periods", () => {
    const first = { day: "2013-01-02", from: "activation" } as const;
    expect(analyticsWindow("30d", "2026-10-17", first)).toEqual(analyticsWindow("30d", "2026-10-17"));
    expect(analyticsWindow("1y", "2026-10-17", first)).toEqual(analyticsWindow("1y", "2026-10-17"));
  });
});
