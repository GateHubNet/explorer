// The Analytics tab of the account page (spec 1.3, 2.2 and 3.1): its periods, their canonical URLs, the windows of its charts and the
// words that name a period. Pure: no clock, no `Intl`. The loader, the view builders, the fixture generator (Node) and the page (browser)
// import this file, so it imports only `window.ts` (no server module, no React).
//
// One URL per view (E2 1.2): `parseAnalyticsQuery` gives the period a query names or, when the query is not exactly the canonical one,
// the canonical query to answer a 302 with. The canonical query is `tab=analytics`, then `period` when it is not the default.

import { windowOf } from "./window";

export const ANALYTICS_PERIODS = ["30d", "90d", "1y", "all"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = "30d";
/** The axis unit of a period's charts, and the data API's `interval`. */
export type AnalyticsUnit = "day" | "week" | "month";

/** The text of the period selector's links. */
export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  all: "All",
};

function isAnalyticsPeriod(value: string | null): value is AnalyticsPeriod {
  return value !== null && (ANALYTICS_PERIODS as readonly string[]).includes(value);
}

/** The canonical query (without its `?`) of a period: the default's is the bare tab. */
function analyticsQuery(period: AnalyticsPeriod): string {
  return period === DEFAULT_ANALYTICS_PERIOD ? "tab=analytics" : `tab=analytics&period=${period}`;
}

/**
 * The period of a canonical query, or the canonical query (without its `?`) to redirect to. `search` is the request's query, with or
 * without its `?`, or a `URLSearchParams` (read as the text it serializes to). The period is the first value of `period` and is exact (case
 * counts); an unknown or absent one is the default. Everything else is dropped: the other order, repeats, `marker`, `back`, `tag`, `in` and
 * unknown parameters. The query is compared as the text it came in, so an escaped spelling of a canonical query is redirected to it, and
 * the canonical query itself is a fixed point (the redirect ends).
 */
export function parseAnalyticsQuery(search: string | URLSearchParams): { period: AnalyticsPeriod } | { canonical: string } {
  const text = typeof search === "string" ? search.replace(/^\?/, "") : search.toString();
  const requested = new URLSearchParams(text).get("period");
  const period = isAnalyticsPeriod(requested) ? requested : DEFAULT_ANALYTICS_PERIOD;
  const canonical = analyticsQuery(period);
  return text === canonical ? { period } : { canonical };
}

/** The link to a view of the tab: `/xrpl/account/rAbc…?tab=analytics`, and `…?tab=analytics&period=1y`. */
export function analyticsHref(net: string, address: string, period: AnalyticsPeriod): string {
  return `/${net}/account/${address}?${analyticsQuery(period)}`;
}

/**
 * The words that name a period in the page's `<title>`, `null` for the default period's. `meta` runs in the browser too (a client-side
 * navigation), so this table is `analyticsPhrases`' `meta` on its own: the account route's chunk takes it and leaves the rest to the Worker.
 */
export const ANALYTICS_META: Record<AnalyticsPeriod, string | null> = { "30d": null, "90d": "last 90 days", "1y": "last 52 weeks", all: "all time" };

/** `title` goes in card titles and tile 1, `empty` in empty states, `meta` in the page's `<title>` (`null` for the default period's). */
export interface AnalyticsPhrases {
  title: string;
  empty: string;
  meta: string | null;
}

/**
 * The words that name a period. `firstMonth` is the frame's first month as `Jul 2025`; only `all` reads it, and the `<title>` of All does
 * not (`meta` reads only the loader's awaited data, not the streamed frame).
 */
export function analyticsPhrases(period: AnalyticsPeriod, firstMonth: string): AnalyticsPhrases {
  switch (period) {
    case "30d":
      return { title: "last 30 days", empty: "these 30 days", meta: ANALYTICS_META[period] };
    case "90d":
      return { title: "last 90 days", empty: "these 90 days", meta: ANALYTICS_META[period] };
    case "1y":
      return { title: "last 52 weeks", empty: "these 52 weeks", meta: ANALYTICS_META[period] };
    case "all":
      return { title: `since ${firstMonth}`, empty: "its whole history", meta: ANALYTICS_META[period] };
  }
}

export interface AnalyticsWindow {
  period: AnalyticsPeriod;
  unit: AnalyticsUnit;
  /** The bucket starts, `YYYY-MM-DD`, oldest first. The last one is the running bucket. */
  buckets: string[];
  /** S: `buckets[0]`, the API's `start`. */
  start: string;
  /** T: the UTC day of the index's anchor. */
  T: string;
  /** Where All's first month came from; `null` for the other periods. */
  origin: "activation" | "oldest" | "none" | null;
}

/** The first of each month from `first`'s to `last`'s (`YYYY-MM`, `first` not after `last`), oldest first. UTC by construction: no `Date`. */
function monthStarts(first: string, last: string): string[] {
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  const months: string[] = [];
  for (;;) {
    const bucket = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    months.push(`${bucket}-01`);
    if (bucket >= last) return months;
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
  }
}

/**
 * The window of a period for `T`, the UTC day of the anchor's close time (spec 2.2). `30d`, `90d` and `1y` are E2's `windowOf`. `all` is the
 * calendar months from `first`'s to T's: `first` is the day of the account's activation, or of its oldest transaction in the index when
 * it has no creation record (`from` says which), and is left out or `null` when there is neither. Never after T's month: an index that is
 * behind the API can name a first day after T (at a month's end), and the window is then T's month alone, with the origin `none`, as with
 * no record.
 */
export function analyticsWindow(
  period: AnalyticsPeriod,
  T: string,
  first?: { day: string; from: "activation" | "oldest" } | null,
): AnalyticsWindow {
  if (period !== "all") {
    const { unit, buckets, start } = windowOf(T, period);
    return { period, unit, buckets, start, T, origin: null };
  }

  const lastMonth = T.slice(0, 7);
  // `YYYY-MM` strings compare as the months they are.
  const record = first && first.day.slice(0, 7) <= lastMonth ? first : null;
  const buckets = monthStarts(record ? record.day.slice(0, 7) : lastMonth, lastMonth);
  return { period, unit: "month", buckets, start: buckets[0]!, T, origin: record ? record.from : "none" };
}
