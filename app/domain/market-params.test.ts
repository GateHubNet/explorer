import { describe, expect, it } from "vitest";

import {
  CANDLE_COUNT,
  candleWindow,
  dayWindowStart,
  INTERVALS,
  marketsHref,
  parseMarketsParams,
  parsePairParams,
  pairQuery,
  PERIODS,
  QUOTES,
  TRADES_API,
  type Interval,
  type ParamsContext,
} from "./market-params";
import { utcDayOf, windowOf } from "./window";

const XRPL: ParamsContext = { native: "XRP", tradesAllowed: true };
const XRPL_NO_TRADES: ParamsContext = { native: "XRP", tradesAllowed: false };
const XAHAU: ParamsContext = { native: "XAH", tradesAllowed: false };

const marketsOf = (query: string, ctx: ParamsContext = XRPL) => parseMarketsParams(new URLSearchParams(query), ctx);
const pairOf = (query: string, ctx: ParamsContext = XRPL) => parsePairParams(new URLSearchParams(query), ctx);

describe("the tables", () => {
  it("has the words and the API values of each period", () => {
    expect(PERIODS).toEqual({
      "24h": { label: "24 h", words: "24 hours", api: "day" },
      "7d": { label: "7 days", words: "7 days", api: "7day" },
      "30d": { label: "30 days", words: "30 days", api: "30day" },
    });
  });

  it("has the quotes of each network", () => {
    expect(QUOTES).toEqual({ XRP: ["xrp", "usd", "eur", "btc"], XAH: ["xah", "usd"] });
  });

  it("sends book as exclude and amm as only", () => {
    expect(TRADES_API).toEqual({ book: "exclude", amm: "only" });
  });

  it("has the label, API value, axis unit, span and cost class of each candle interval", () => {
    expect(INTERVALS).toEqual({
      "15m": { label: "15 m", api: "15minute", unit: "minute", span: "15 hours", long: false },
      "1h": { label: "1 h", api: "1hour", unit: "hour", span: "60 hours", long: false },
      "4h": { label: "4 h", api: "4hour", unit: "hour", span: "10 days", long: true },
      "1d": { label: "1 d", api: "1day", unit: "day", span: "60 days", long: true },
      "1w": { label: "1 w", api: "7day", unit: "week", span: "60 weeks", long: true },
    });
    expect(CANDLE_COUNT).toBe(60);
  });
});

describe("parseMarketsParams: the canonical query of a view", () => {
  it.each([
    ["", XRPL, ""],
    ["period=24h", XRPL, ""],
    ["quote=usd&period=7d", XRPL, "?period=7d&quote=usd"],
    ["quote=USD", XRPL, "?quote=usd"],
    ["quote=Eur", XRPL, "?quote=eur"],
    ["trades=AMM", XRPL, "?trades=amm"],
    ["period=7D", XRPL, ""],
    ["period=7d&period=30d", XRPL, "?period=7d"],
    ["period=2y", XRPL, ""],
    ["x=1", XRPL, ""],
    ["quote=eur", XAHAU, ""],
    ["quote=xah&period=30d", XAHAU, "?period=30d&quote=xah"],
    ["quote=xrp", XAHAU, ""],
    ["quote=xah", XRPL, ""],
    ["trades=amm", XRPL_NO_TRADES, ""],
    ["trades=amm", XAHAU, ""],
    ["trades=book", XRPL_NO_TRADES, ""],
    ["trades=both", XRPL, ""],
    ["period=30d&quote=btc&trades=book", XRPL, "?period=30d&quote=btc&trades=book"],
    ["trades=book&quote=btc&period=30d", XRPL, "?period=30d&quote=btc&trades=book"],
    ["period=%37d", XRPL, "?period=7d"],
    ["quote=%55SD", XRPL, "?quote=usd"],
    ["period=constructor&quote=toString&trades=__proto__", XRPL, ""],
  ] as const)("reads %j (%j) as %j", (query, ctx, canonical) => {
    expect(marketsOf(query, ctx).canonical).toBe(canonical);
  });

  it("reads the first value of a parameter, even when it is unknown and a later one is not", () => {
    expect(marketsOf("period=2y&period=7d").canonical).toBe("");
    expect(marketsOf("quote=gbp&quote=usd").canonical).toBe("");
  });

  it("gives the params the query names, the defaults for the rest", () => {
    expect(marketsOf("").params).toEqual({ period: "24h", quote: null, trades: null });
    expect(marketsOf("quote=USD&period=7d&trades=Book").params).toEqual({ period: "7d", quote: "usd", trades: "book" });
    expect(marketsOf("quote=eur", XAHAU).params).toEqual({ period: "24h", quote: null, trades: null });
  });

  it("has params whose own link is the canonical query", () => {
    for (const query of ["", "period=7d", "quote=USD&trades=amm&period=30d&x=1", "period=%37d&quote=btc"]) {
      const { params, canonical } = marketsOf(query);
      expect(marketsHref("xrpl", params)).toBe(`/xrpl/markets${canonical}`);
    }
  });
});

describe("marketsHref", () => {
  it("is the page alone for the default view", () => {
    expect(marketsHref("xrpl")).toBe("/xrpl/markets");
    expect(marketsHref("xrpl", {})).toBe("/xrpl/markets");
    expect(marketsHref("xahau", { period: "24h", quote: null, trades: null })).toBe("/xahau/markets");
  });

  it("writes what is not the default, period then quote then trades", () => {
    expect(marketsHref("xrpl", { period: "7d" })).toBe("/xrpl/markets?period=7d");
    expect(marketsHref("xrpl", { trades: "amm", quote: "btc", period: "30d" })).toBe("/xrpl/markets?period=30d&quote=btc&trades=amm");
    expect(marketsHref("xahau", { quote: "xah" })).toBe("/xahau/markets?quote=xah");
  });
});

describe("parsePairParams: the canonical query of a view", () => {
  it.each([
    ["", XRPL, ""],
    ["interval=1h", XRPL, ""],
    ["trades=amm&interval=4h", XRPL, "?interval=4h&trades=amm"],
    ["interval=4h&marker=M3&back=M2.M1", XRPL, "?marker=M3&back=M2.M1"],
    ["back=M2", XRPL, ""],
    ["interval=15m", XRPL, "?interval=15m"],
    ["interval=1w", XRPL, "?interval=1w"],
    ["interval=1W", XRPL, ""],
    ["interval=1H", XRPL, ""],
    ["interval=2h", XRPL, ""],
    ["interval=constructor", XRPL, ""],
    ["interval=1d&interval=4h", XRPL, "?interval=1d"],
    ["interval=zzz&interval=4h", XRPL, ""],
    ["x=1", XRPL, ""],
    ["trades=AMM", XRPL, "?trades=amm"],
    ["trades=amm", XRPL_NO_TRADES, ""],
    ["trades=amm&interval=1d", XAHAU, "?interval=1d"],
    ["trades=amm&marker=M3", XRPL, "?trades=amm&marker=M3"],
    ["marker=M3", XRPL, "?marker=M3"],
    ["marker=M3&back=M2", XRPL, "?marker=M3&back=M2"],
    ["back=M2.M1&marker=M3&trades=book&interval=1d", XRPL, "?trades=book&marker=M3&back=M2.M1"],
    // a trail that is not one is no trail
    ["marker=M3&back=M2.", XRPL, "?marker=M3"],
    ["marker=M3&back=M2.!!", XRPL, "?marker=M3"],
    ["marker=M3&back=", XRPL, "?marker=M3"],
    ["marker=M3&back=M11.M10.M9.M8.M7.M6.M5.M4.M3.M2.M1", XRPL, "?marker=M3"],
    ["marker=M3&back=M10.M9.M8.M7.M6.M5.M4.M3.M2.M1", XRPL, "?marker=M3&back=M10.M9.M8.M7.M6.M5.M4.M3.M2.M1"],
    // the first of a repeat
    ["marker=M3&marker=M4&back=M2&back=M1", XRPL, "?marker=M3&back=M2"],
  ] as const)("reads %j (%j) as %j", (query, ctx, canonical) => {
    expect(pairOf(query, ctx).canonical).toBe(canonical);
  });

  it("gives the params the query names, the defaults for the rest", () => {
    expect(pairOf("").params).toEqual({ interval: "1h", trades: null, back: [] });
    expect(pairOf("interval=4h&trades=AMM").params).toEqual({ interval: "4h", trades: "amm", back: [] });
    expect(pairOf("trades=amm", XAHAU).params).toEqual({ interval: "1h", trades: null, back: [] });
  });

  it("has no interval behind a marker, and gives the marker and the trail", () => {
    expect(pairOf("interval=4h&marker=M3&back=M2.M1").params).toEqual({
      interval: "1h",
      trades: null,
      marker: "M3",
      back: ["M2", "M1"],
    });
  });

  it("has no trail without a marker", () => {
    const { params } = pairOf("back=M2.M1");
    expect(params.back).toEqual([]);
    expect("marker" in params).toBe(false);
  });

  it("gives the raw marker as given: the route checks isMarker", () => {
    expect(pairOf("marker=not%20a%20marker!").params.marker).toBe("not a marker!");
    expect(pairOf("marker=not%20a%20marker!").canonical).toBe("?marker=not%20a%20marker!");
    expect(pairOf("marker=").params.marker).toBe("");
    expect(pairOf("marker=").canonical).toBe("?marker=");
  });

  it("has params whose own query is the canonical one", () => {
    for (const query of [
      "",
      "interval=4h&trades=amm",
      "interval=4h&marker=M3&back=M2.M1",
      "marker=M3&trades=book",
      "back=M2.M1",
      "marker=M3&back=bad!",
      "interval=1w&x=1",
    ]) {
      const { params, canonical } = pairOf(query);
      expect(pairQuery(params)).toBe(canonical);
    }
  });
});

describe("pairQuery", () => {
  it("is empty for the default view and for no params", () => {
    expect(pairQuery({})).toBe("");
    expect(pairQuery({ interval: "1h", trades: null, back: [] })).toBe("");
    expect(pairQuery({ trades: null })).toBe("");
  });

  it("writes interval, trades, marker and back, in that order", () => {
    expect(pairQuery({ interval: "4h" })).toBe("?interval=4h");
    expect(pairQuery({ trades: "amm", interval: "1w" })).toBe("?interval=1w&trades=amm");
    expect(pairQuery({ trades: "book" })).toBe("?trades=book");
  });

  it("drops the interval behind a marker, and keeps the trades", () => {
    expect(pairQuery({ interval: "4h", marker: "M3" })).toBe("?marker=M3");
    expect(pairQuery({ interval: "4h", trades: "amm", marker: "M3", back: ["M2", "M1"] })).toBe("?trades=amm&marker=M3&back=M2.M1");
  });

  it("writes the trail only behind a marker, and only when there is one", () => {
    expect(pairQuery({ back: ["M2"] })).toBe("");
    expect(pairQuery({ marker: "M3", back: [] })).toBe("?marker=M3");
    expect(pairQuery({ marker: "M3" })).toBe("?marker=M3");
  });

  it("reads an absent marker as the first page (as trailPaging writes it)", () => {
    expect(pairQuery({ back: [] })).toBe("");
    expect(pairQuery({ marker: undefined, back: [] })).toBe("");
  });

  it("escapes a marker and the pieces of a trail", () => {
    expect(pairQuery({ marker: "a b&c=d" })).toBe("?marker=a%20b%26c%3Dd");
    expect(pairQuery({ marker: "M3", back: ["A+B=", "C/D"] })).toBe("?marker=M3&back=A%2BB%3D.C%2FD");
  });

  it("does not change the trail it is given", () => {
    const back = ["M2", "M1"];
    pairQuery({ marker: "M3", back });
    expect(back).toEqual(["M2", "M1"]);
  });
});

/** The unix seconds of a UTC time. */
const unix = (time: string) => Date.parse(time) / 1000;
const INTERVAL_IDS = Object.keys(INTERVALS) as Interval[];
/** The recorded XRPL close time: 2026-10-17T17:01:12Z. */
const RECORDED = 1792256472;
/** The seconds of a bucket. */
const SIZE: Record<Interval, number> = { "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };

describe("candleWindow: the 60 buckets that end with the one that holds T", () => {
  it("uses the recorded close time, 2026-10-17T17:01:12Z", () => {
    expect(new Date(RECORDED * 1000).toISOString()).toBe("2026-10-17T17:01:12.000Z");
  });

  it.each([
    ["15m", "2026-10-17T02:15:00Z", "2026-10-17T17:00:00Z"],
    ["1h", "2026-10-15T06:00:00Z", "2026-10-17T17:00:00Z"],
    ["4h", "2026-10-07T20:00:00Z", "2026-10-17T16:00:00Z"],
    ["1d", "2026-08-19T00:00:00Z", "2026-10-17T00:00:00Z"],
    ["1w", "2025-08-25T00:00:00Z", "2026-10-12T00:00:00Z"],
  ] as const)("is %s from %s to %s for the recorded close time", (interval, start, last) => {
    const window = candleWindow(RECORDED, interval);
    expect(window.buckets).toHaveLength(CANDLE_COUNT);
    expect(window.start).toBe(start);
    expect(window.buckets[0]).toBe(start);
    expect(window.buckets.at(-1)).toBe(last);
  });

  it("has buckets in the form YYYY-MM-DDTHH:mm:ssZ, oldest first, one bucket apart", () => {
    for (const interval of INTERVAL_IDS) {
      const { buckets } = candleWindow(RECORDED, interval);
      buckets.forEach((bucket) => expect(bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
      for (let at = 1; at < buckets.length; at++) {
        expect(unix(buckets[at]!) - unix(buckets[at - 1]!)).toBe(SIZE[interval]);
      }
    }
  });

  it("ends with the bucket starting at T when T is on a bucket boundary", () => {
    const boundary = unix("2026-10-17T17:00:00Z");
    expect(candleWindow(boundary, "15m").buckets.at(-1)).toBe("2026-10-17T17:00:00Z");
    expect(candleWindow(boundary, "1h").buckets.at(-1)).toBe("2026-10-17T17:00:00Z");
    expect(candleWindow(boundary, "1h").start).toBe("2026-10-15T06:00:00Z");
    expect(candleWindow(unix("2026-10-17T16:00:00Z"), "4h").buckets.at(-1)).toBe("2026-10-17T16:00:00Z");
    expect(candleWindow(unix("2026-10-17T00:00:00Z"), "1d").buckets.at(-1)).toBe("2026-10-17T00:00:00Z");
    expect(candleWindow(unix("2026-10-12T00:00:00Z"), "1w").buckets.at(-1)).toBe("2026-10-12T00:00:00Z");
  });

  it("ends with the bucket before when T is one second short of the next boundary", () => {
    expect(candleWindow(unix("2026-10-17T17:14:59Z"), "15m").buckets.at(-1)).toBe("2026-10-17T17:00:00Z");
    expect(candleWindow(unix("2026-10-17T17:15:00Z"), "15m").buckets.at(-1)).toBe("2026-10-17T17:15:00Z");
    expect(candleWindow(unix("2026-10-17T17:15:00Z"), "15m").start).toBe("2026-10-17T02:30:00Z");
    expect(candleWindow(unix("2026-10-17T17:59:59Z"), "1h").buckets.at(-1)).toBe("2026-10-17T17:00:00Z");
    expect(candleWindow(unix("2026-10-17T23:59:59Z"), "1d").buckets.at(-1)).toBe("2026-10-17T00:00:00Z");
  });

  it("has the 4 h buckets at 00, 04, 08, 12, 16 and 20 UTC", () => {
    const lastOf = (time: string) => candleWindow(unix(time), "4h").buckets.at(-1);
    expect(lastOf("2026-10-17T00:00:00Z")).toBe("2026-10-17T00:00:00Z");
    expect(lastOf("2026-10-17T03:59:59Z")).toBe("2026-10-17T00:00:00Z");
    expect(lastOf("2026-10-17T04:00:00Z")).toBe("2026-10-17T04:00:00Z");
    expect(lastOf("2026-10-17T11:59:59Z")).toBe("2026-10-17T08:00:00Z");
    expect(lastOf("2026-10-17T12:00:00Z")).toBe("2026-10-17T12:00:00Z");
    expect(lastOf("2026-10-17T19:59:59Z")).toBe("2026-10-17T16:00:00Z");
    expect(lastOf("2026-10-17T20:00:00Z")).toBe("2026-10-17T20:00:00Z");
    expect(lastOf("2026-10-17T23:59:59Z")).toBe("2026-10-17T20:00:00Z");
    expect(candleWindow(unix("2026-10-17T00:00:00Z"), "4h").start).toBe("2026-10-07T04:00:00Z");
    expect(candleWindow(unix("2026-10-17T23:59:59Z"), "4h").start).toBe("2026-10-08T00:00:00Z");
  });

  it("ends the 1 w window with the Monday on or before T: a Sunday and a Monday", () => {
    const sunday = candleWindow(unix("2026-10-18T23:59:59Z"), "1w");
    const monday = candleWindow(unix("2026-10-12T00:00:00Z"), "1w");
    expect(sunday.buckets.at(-1)).toBe("2026-10-12T00:00:00Z");
    expect(monday.buckets.at(-1)).toBe("2026-10-12T00:00:00Z");
    expect(sunday.start).toBe("2025-08-25T00:00:00Z");
    expect(monday).toEqual(sunday);
    // the second after the Sunday starts the next week
    const next = candleWindow(unix("2026-10-19T00:00:00Z"), "1w");
    expect(next.buckets.at(-1)).toBe("2026-10-19T00:00:00Z");
    expect(next.start).toBe("2025-09-01T00:00:00Z");
    // the second before the Monday is still the week before
    expect(candleWindow(unix("2026-10-11T23:59:59Z"), "1w").buckets.at(-1)).toBe("2026-10-05T00:00:00Z");
  });

  it("has a Monday for the last bucket of a 1 w window on every day of the week", () => {
    for (let day = 0; day < 14; day++) {
      const closeTime = unix("2026-10-05T12:34:56Z") + day * 86400;
      const { buckets } = candleWindow(closeTime, "1w");
      const last = new Date(buckets.at(-1)!);
      expect(last.getUTCDay()).toBe(1);
      expect(last.getTime() / 1000).toBeLessThanOrEqual(closeTime);
      expect(closeTime - last.getTime() / 1000).toBeLessThan(604800);
    }
  });

  it("agrees with the network page's windows on the days and the Mondays", () => {
    for (let day = 0; day < 21; day++) {
      const closeTime = unix("2026-10-05T00:00:00Z") + day * 86400 + 12345;
      const today = utcDayOf(closeTime);
      const days = candleWindow(closeTime, "1d").buckets.map((bucket) => bucket.slice(0, 10));
      expect(days.slice(-30)).toEqual(windowOf(today, "30d").buckets);
      const weeks = candleWindow(closeTime, "1w").buckets.map((bucket) => bucket.slice(0, 10));
      expect(weeks.slice(-52)).toEqual(windowOf(today, "1y").buckets);
    }
  });

  it("counts days across a year end and a leap day", () => {
    expect(candleWindow(unix("2026-01-02T03:04:05Z"), "1d").start).toBe("2025-11-04T00:00:00Z");
    expect(candleWindow(unix("2024-03-01T00:00:00Z"), "1d").start).toBe("2024-01-02T00:00:00Z");
    expect(candleWindow(unix("2024-03-01T00:00:00Z"), "1d").buckets).toContain("2024-02-29T00:00:00Z");
    expect(candleWindow(unix("2026-01-01T00:00:00Z"), "1w").start).toBe("2024-11-11T00:00:00Z");
    expect(candleWindow(unix("2026-01-01T00:00:00Z"), "1w").buckets.at(-1)).toBe("2025-12-29T00:00:00Z");
  });

  it("changes once per bucket, not once per ledger", () => {
    // A Monday midnight is a boundary of every interval.
    const boundary = unix("2026-10-12T00:00:00Z");
    for (const interval of INTERVAL_IDS) {
      const size = SIZE[interval];
      const key = candleWindow(boundary, interval).start;
      expect(candleWindow(boundary + 4, interval).start).toBe(key);
      expect(candleWindow(boundary + size - 1, interval).start).toBe(key);
      expect(candleWindow(boundary + size, interval).start).not.toBe(key);
      expect(candleWindow(boundary - 1, interval).start).not.toBe(key);
    }
  });

  it("is the same for a close time with a fraction", () => {
    expect(candleWindow(RECORDED + 0.75, "1h")).toEqual(candleWindow(RECORDED, "1h"));
  });

  it("refuses a close time that is no time", () => {
    expect(() => candleWindow(Number.NaN, "1h")).toThrow(RangeError);
    expect(() => candleWindow(Number.POSITIVE_INFINITY, "1d")).toThrow(RangeError);
    expect(() => dayWindowStart(Number.NaN)).toThrow(RangeError);
  });
});

describe("dayWindowStart: T1, the start of T's minute minus 24 hours", () => {
  it("is 2026-10-16T17:01:00Z for the recorded close time", () => {
    expect(dayWindowStart(RECORDED)).toBe("2026-10-16T17:01:00Z");
  });

  it("drops the seconds, whatever they are", () => {
    expect(dayWindowStart(unix("2026-10-17T17:01:00Z"))).toBe("2026-10-16T17:01:00Z");
    expect(dayWindowStart(unix("2026-10-17T17:01:59Z"))).toBe("2026-10-16T17:01:00Z");
    expect(dayWindowStart(unix("2026-10-17T17:02:00Z"))).toBe("2026-10-16T17:02:00Z");
  });

  it("crosses a month, a year and a leap day", () => {
    expect(dayWindowStart(unix("2026-11-01T00:00:30Z"))).toBe("2026-10-31T00:00:00Z");
    expect(dayWindowStart(unix("2026-01-01T00:00:00Z"))).toBe("2025-12-31T00:00:00Z");
    expect(dayWindowStart(unix("2024-03-01T08:15:00Z"))).toBe("2024-02-29T08:15:00Z");
  });
});
