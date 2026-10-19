import { existsSync, readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { decodeNodePublic, isValidClassicAddress } from "ripple-address-codec";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { windowOf, type WindowPeriod } from "../../app/domain/window";
import { checkFeeBucketPage, checkFeeStatsPage, checkStatsPage, checkValidations, checkVolumePage } from "../../app/server/aggregate-shape";
import type { LastValidated } from "../../app/server/api-types";
import { generate, HTTP, isSynthetic } from "../../scripts/http-fixtures";
import { networkFixtures } from "../../scripts/network-fixtures";
import { mulberry32, seedOf } from "../../scripts/synthetic";
import { startFixtureServer, type FixtureServer } from "../support/fixture-server";
import { dataApiFile, type NetworkName } from "../support/upstream-core";

// The answers the network page asks for that the recorded ledgers cannot give (spec 4, "Fixtures"): scripts/network-fixtures.ts writes them
// with `pnpm fixtures:sync`, and these tests read the files. What is asked is worked out here from the spec's table of calls (1.4) and the
// windows (`windowOf`), not from the generator, so a file named one way and asked for another fails.

const NETS: NetworkName[] = ["xrpl", "xahau"];
const PERIODS: WindowPeriod[] = ["7d", "30d", "90d", "1y"];
const T = "2026-10-17";
const USD_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const METRICS = "accounts_created,ledger_count,transaction_count";
const DISPLAYS = { xrpl: ["native", "usd"], xahau: ["native"] } as const;

const json = (path: string): any => JSON.parse(readFileSync(new URL(path, HTTP), "utf8"));
const lastOf = (net: NetworkName): LastValidated => json(`${net}/data-api/last_validated.json`);

/** The two newest recorded ledgers, as the generator is given them: index and hash, with the close time of the fees list. */
function newestOf(net: NetworkName): Array<{ index: number; hash: string; date: string }> {
  const hashes = json(`${net}/ledger-hashes.json`) as Record<string, number>;
  const byIndex = new Map(Object.entries(hashes).map(([hash, index]) => [index, hash]));
  return json(`${net}/data-api/network/fees@descending=true&limit=8.json`).rows.slice(0, 2).map((row: { ledger_index: number; date: string }) => ({
    index: row.ledger_index,
    hash: byIndex.get(row.ledger_index)!,
    date: row.date,
  }));
}

// ---- What the page asks for ------------------------------------------------------------------------------------------

type Kind = "type" | "metric" | "fees" | "feeStats" | "validations" | "payment" | "exchange" | "amm";
interface Call {
  kind: Kind;
  /** The path as the client sends it, and its query as `URLSearchParams` writes it (the order of `data-api.ts`). */
  path: string;
  search: string;
}

const searchOf = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** The calls of one view, #6 to #11 of spec 1.4: `u` is the period's unit, W₀ its first bucket, P₀ the first of the window the deltas compare with. */
function periodCalls(net: NetworkName, period: WindowPeriod, display: "native" | "usd"): Call[] {
  const w = windowOf(T, period);
  const shown: Record<string, string> = display === "usd" ? { exchange_currency: "USD", exchange_issuer: USD_ISSUER } : {};
  const calls: Call[] = [
    { kind: "type", path: "/v2/stats/type", search: searchOf({ interval: w.unit, start: w.start, end: T, limit: "1000" }) },
    { kind: "metric", path: "/v2/stats/metric", search: searchOf({ interval: w.unit, start: w.previous.start, end: T, limit: "1000", metrics: METRICS }) },
    { kind: "fees", path: "/v2/network/fees", search: searchOf({ interval: "day", start: w.start, end: T, limit: "1000" }) },
    { kind: "payment", path: "/v2/network/payment_volume", search: searchOf({ interval: w.unit, start: w.previous.start, end: T, limit: "1000", ...shown }) },
    { kind: "exchange", path: "/v2/network/exchange_volume", search: searchOf({ interval: w.unit, start: w.start, end: T, limit: "1000", ...shown }) },
  ];
  if (net === "xrpl") {
    calls.push({ kind: "amm", path: "/v2/network/amm_volume", search: searchOf({ interval: w.unit, start: w.start, end: T, limit: "1000", ...shown }) });
  }
  return calls;
}

/** Every call the page makes of the fixtures, for every period and display currency of a network. */
function callsOf(net: NetworkName): Call[] {
  const calls: Call[] = [
    { kind: "feeStats", path: "/v2/network/fee_stats", search: searchOf({ descending: "true", limit: "1", start: T }) },
    ...newestOf(net).map(({ hash }): Call => ({ kind: "validations", path: `/v2/ledgers/${hash}/validations`, search: searchOf({ limit: "1000" }) })),
  ];
  for (const period of PERIODS) for (const display of DISPLAYS[net]) calls.push(...periodCalls(net, period, display));
  return calls;
}

const fileOf = (net: NetworkName, call: Call) => dataApiFile(net, call.path, call.search)!;

const CHECKS: Record<Kind, (body: unknown) => unknown> = {
  type: checkStatsPage,
  metric: checkStatsPage,
  fees: checkFeeBucketPage,
  feeStats: checkFeeStatsPage,
  validations: checkValidations,
  payment: (body) => checkVolumePage("payment", body),
  exchange: (body) => checkVolumePage("exchange", body),
  amm: (body) => checkVolumePage("amm", body),
};

/** The answer a view's call gets, read from the file the call's request names. */
function answerOf(net: NetworkName, period: WindowPeriod, kind: Kind, display: "native" | "usd" = "native"): any {
  const call = periodCalls(net, period, display).find((c) => c.kind === kind)!;
  return json(fileOf(net, call));
}

// ---- The request finds the file --------------------------------------------------------------------------------------

describe.each(NETS)("the requests of the network page on %s", (net) => {
  const calls = callsOf(net);
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer(0);
  });
  afterAll(async () => {
    await server.close();
  });

  it("is a set of files that the generator writes, no more and no fewer", () => {
    const written = networkFixtures(net, lastOf(net), newestOf(net)).map((file) => dataApiFile(net, file.path, file.query));
    expect(new Set(written).size, "no file is written twice").toBe(written.length);
    expect(new Set(written)).toEqual(new Set(calls.map((call) => fileOf(net, call))));
  });

  it("finds a file on disk for every request, named as the fixture server names it", () => {
    for (const call of calls) expect(existsSync(new URL(fileOf(net, call), HTTP)), `${call.path}?${call.search}`).toBe(true);
  });

  it("is answered by the fixture server with a 200, and an answer that passes the check the client runs", async () => {
    for (const call of calls) {
      const response = await fetch(`${server.url}/${net}${call.path}?${call.search}`, { headers: { "X-API-Key": "k" } });
      expect(response.status, `${call.path}?${call.search}`).toBe(200);
      const body: unknown = await response.json();
      expect(() => CHECKS[call.kind](body), `${call.kind} ${call.search}`).not.toThrow();
    }
  });

  it("finds a file at the names the spec and the brief give", () => {
    const names = [
      "data-api/stats/type@end=2026-10-17&interval=day&limit=1000&start=2026-09-18.json",
      "data-api/stats/type@end=2026-10-17&interval=week&limit=1000&start=2025-10-20.json",
      `data-api/stats/metric@end=2026-10-17&interval=day&limit=1000&metrics=${METRICS}&start=2026-08-18.json`,
      `data-api/stats/metric@end=2026-10-17&interval=week&limit=1000&metrics=${METRICS}&start=2024-10-14.json`,
      "data-api/network/fees@end=2026-10-17&interval=day&limit=1000&start=2025-10-20.json",
      "data-api/network/payment_volume@end=2026-10-17&interval=day&limit=1000&start=2026-08-18.json",
      "data-api/network/exchange_volume@end=2026-10-17&interval=week&limit=1000&start=2025-10-20.json",
      "data-api/network/fee_stats@descending=true&limit=1&start=2026-10-17.json",
      ...newestOf(net).map(({ hash }) => `data-api/ledgers/${hash}/validations@limit=1000.json`),
    ];
    for (const name of names) expect(existsSync(new URL(`${net}/${name}`, HTTP)), name).toBe(true);
  });
});

describe("the files of one network and the other", () => {
  const files = (net: NetworkName, directory: string, prefix: string) =>
    readdirSync(new URL(`${net}/data-api/${directory}/`, HTTP)).filter((name) => name.startsWith(prefix));

  it("hold amm_volume on XRPL, for the four periods in both currencies, and none on Xahau", () => {
    expect(files("xrpl", "network", "amm_volume@")).toHaveLength(8);
    expect(files("xahau", "network", "amm_volume@")).toEqual([]);
  });

  it("hold the display currency's volumes on XRPL only: eight files of each kind, against four on Xahau", () => {
    for (const kind of ["payment_volume@", "exchange_volume@"]) {
      expect(files("xrpl", "network", kind)).toHaveLength(8);
      expect(files("xahau", "network", kind)).toHaveLength(4);
    }
    expect(files("xahau", "network", "").filter((name) => name.includes("exchange_currency"))).toEqual([]);
  });
});

// ---- Stats -----------------------------------------------------------------------------------------------------------

describe.each(NETS)("the stats of %s", (net) => {
  const sum = (row: Record<string, number | string>) => Object.entries(row).reduce((total, [name, value]) => (name === "date" ? total : total + (value as number)), 0);

  it.each(PERIODS)("leave out zero counts and sort the names of a bucket, for %s", (period) => {
    const rows = answerOf(net, period, "type").stats as Array<Record<string, number | string>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const names = Object.keys(row);
      expect(names).toEqual([...names].sort());
      expect(Object.entries(row).filter(([name]) => name !== "date").every(([, count]) => Number.isInteger(count) && (count as number) > 0)).toBe(true);
    }
  });

  it("leave a type out of the days it has none: the rare ones are missing from some buckets and present in others", () => {
    const rows = answerOf(net, "90d", "type").stats as Array<Record<string, number | string>>;
    const names = new Set(rows.flatMap((row) => Object.keys(row)));
    expect([...names].filter((name) => rows.some((row) => row[name] === undefined)).length).toBeGreaterThan(0);
  });

  it.each(PERIODS)("have transaction_count equal to the sum of the type columns of the same bucket, for %s", (period) => {
    const types = answerOf(net, period, "type").stats as Array<Record<string, number | string>>;
    const metrics = new Map((answerOf(net, period, "metric").stats as Array<Record<string, number | string>>).map((row) => [row.date as string, row]));
    for (const row of types) {
      const metric = metrics.get(row.date as string);
      expect(metric, `a metric row for ${row.date}`).toBeDefined();
      expect(metric!.transaction_count).toBe(sum(row));
    }
  });

  it.each(PERIODS)("start the metrics at P₀ and the types at W₀, and end both on the running bucket, for %s", (period) => {
    const w = windowOf(T, period);
    const first = (rows: Array<{ date: string }>) => rows[0]!.date.slice(0, 10);
    const last = (rows: Array<{ date: string }>) => rows.at(-1)!.date.slice(0, 10);
    const types = answerOf(net, period, "type").stats;
    const metrics = answerOf(net, period, "metric").stats;
    expect([first(types), last(types)]).toEqual([w.start, w.buckets.at(-1)]);
    expect([first(metrics), last(metrics)]).toEqual([w.previous.start, w.buckets.at(-1)]);
    expect(types).toHaveLength(w.buckets.length);
    expect(types[0].date).toBe(`${w.start}T00:00:00Z`);
  });

  it("count 22,150 ledgers a day on XRPL and 21,600 on Xahau, between 21,000 and 23,000 on every full day", () => {
    const rows = (answerOf(net, "90d", "metric").stats as Array<Record<string, number | string>>).filter((row) => !String(row.date).startsWith(T));
    expect(rows).toHaveLength(180);
    for (const row of rows) {
      expect(row.ledger_count as number).toBeGreaterThanOrEqual(21_000);
      expect(row.ledger_count as number).toBeLessThanOrEqual(23_000);
    }
    const mean = rows.reduce((total, row) => total + (row.ledger_count as number), 0) / rows.length;
    expect(Math.abs(mean - (net === "xrpl" ? 22_150 : 21_600))).toBeLessThan(150);
  });

  it("have the running day pro rata to the close time of the newest ledger", () => {
    const running = (answerOf(net, "7d", "metric").stats as Array<Record<string, number | string>>).at(-1)!;
    const closed = new Date(lastOf(net).close_time);
    const fraction = (closed.getUTCHours() * 3600 + closed.getUTCMinutes() * 60 + closed.getUTCSeconds()) / 86_400;
    expect(running.date).toBe(`${T}T00:00:00Z`);
    expect(Math.abs((running.ledger_count as number) - (net === "xrpl" ? 22_150 : 21_600) * fraction)).toBeLessThan(300);
  });

  it("have the weeks add up their days, the running week included", () => {
    const days = answerOf(net, "90d", "metric").stats as Array<Record<string, number | string>>;
    const weeks = answerOf(net, "1y", "metric").stats as Array<Record<string, number | string>>;
    const week = weeks.at(-1)!;
    expect(week.date).toBe("2026-10-12T00:00:00Z");
    const own = days.filter((day) => String(day.date) >= "2026-10-12" && String(day.date) < "2026-10-19");
    expect(own).toHaveLength(6);
    for (const name of ["accounts_created", "ledger_count", "transaction_count"]) {
      expect(week[name]).toBe(own.reduce((total, day) => total + (day[name] as number), 0));
    }
  });
});

// ---- Fees ------------------------------------------------------------------------------------------------------------

describe.each(NETS)("the daily fees of %s", (net) => {
  it.each(PERIODS)("hold a row for each day of the window, the running day included, for %s", (period) => {
    const w = windowOf(T, period);
    const rows = answerOf(net, period, "fees").rows as Array<{ date: string }>;
    const days = period === "1y" ? 363 : w.buckets.length;
    expect(rows).toHaveLength(days);
    expect(rows[0]!.date).toBe(`${w.start}T00:00:00Z`);
    expect(rows.at(-1)!.date).toBe(`${T}T00:00:00Z`);
  });

  it("are a day's avg as total over tx_count to a drop, with the transactions of the stats", () => {
    const rows = answerOf(net, "90d", "fees").rows as Array<{ avg: number; max: number; min: number; total: number; tx_count: number; date: string }>;
    const metrics = new Map((answerOf(net, "90d", "metric").stats as Array<Record<string, number | string>>).map((row) => [row.date as string, row.transaction_count]));
    for (const row of rows) {
      expect(row.tx_count).toBe(metrics.get(row.date));
      expect(Math.abs(row.avg - row.total / row.tx_count)).toBeLessThanOrEqual(0.5e-6 + 1e-12);
      expect(row.max).toBeGreaterThanOrEqual(row.avg);
      expect(row.min).toBeLessThanOrEqual(row.avg);
    }
  });
});

describe.each(NETS)("the fee snapshot of %s", (net) => {
  it("is one row, two seconds before the close of the newest ledger", () => {
    const answer = json(`${net}/data-api/network/fee_stats@descending=true&limit=1&start=${T}.json`);
    expect(answer.rows).toHaveLength(1);
    const closed = Date.parse(lastOf(net).close_time);
    expect(Date.parse(answer.rows[0].date)).toBe(closed - 2000);
  });

  it("holds the open ledger fee, the queue and the open ledger's size the page shows (XRPL: 10 drops, queue 0, 84 of 96)", () => {
    const row = json(`${net}/data-api/network/fee_stats@descending=true&limit=1&start=${T}.json`).rows[0];
    expect(row.pct_max_queue_size).toBe(0);
    expect(row.current_queue_size).toBe(0);
    if (net === "xrpl") {
      expect(row).toMatchObject({ open_ledger_fee: 0.00001, minimum_fee: 0.00001, current_queue_size: 0, current_ledger_size: 84, expected_ledger_size: 96 });
    }
  });
});

// ---- Volumes ---------------------------------------------------------------------------------------------------------

type Component = { amount: string; converted_amount: string; rate: string; count: number; currency?: string; issuer?: string; base?: any; counter?: any; amm_account?: string };
type VolumeRow = { components: Component[]; count: number; exchange: { currency: string; issuer?: string }; exchange_rate: string; start_time: string; end_time: string; total: string };

const KINDS = ["payment", "exchange", "amm"] as const;
const viewsOf = (net: NetworkName) => PERIODS.flatMap((period) => DISPLAYS[net].map((display) => ({ period, display })));

describe.each(NETS)("the volumes of %s", (net) => {
  const kinds = KINDS.filter((kind) => kind !== "amm" || net === "xrpl");
  const rowsOf = (period: WindowPeriod, kind: Kind, display: "native" | "usd") => answerOf(net, period, kind, display).rows as VolumeRow[];

  it.each(viewsOf(net).flatMap(({ period, display }) => kinds.map((kind) => ({ period, display, kind }))))(
    "sort the components by converted amount, largest first, and give each a rate of amount over converted_amount to 8 significant digits ($kind $period $display)",
    ({ period, display, kind }) => {
      const rows = rowsOf(period, kind, display);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.components.length).toBeGreaterThan(0);
        const converted = row.components.map((c) => new BigNumber(c.converted_amount));
        expect(converted).toEqual([...converted].sort((a, b) => b.comparedTo(a) ?? 0));
        for (const c of row.components) {
          const expected = new BigNumber(c.amount).dividedBy(c.converted_amount).toPrecision(8);
          expect(c.rate, `${c.currency ?? c.base?.currency} ${row.start_time}`).toBe(expected);
        }
        expect(new BigNumber(row.total).toFixed()).toBe(converted.reduce((total, value) => total.plus(value), new BigNumber(0)).toFixed());
      }
    },
  );

  it.each(PERIODS)("end the days on 2026-10-16 and the weeks on the running one, which has the days so far, for %s", (period) => {
    for (const kind of kinds) {
      const rows = rowsOf(period, kind, "native");
      const last = rows.at(-1)!;
      if (period === "1y") {
        expect([last.start_time, last.end_time]).toEqual(["2026-10-12T00:00:00Z", "2026-10-19T00:00:00Z"]);
      } else {
        expect([last.start_time, last.end_time]).toEqual(["2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"]);
      }
    }
  });

  it("start the payments at P₀ and the trades at W₀", () => {
    for (const period of PERIODS) {
      const w = windowOf(T, period);
      expect(rowsOf(period, "payment", "native")[0]!.start_time).toBe(`${w.previous.start}T00:00:00Z`);
      expect(rowsOf(period, "exchange", "native")[0]!.start_time).toBe(`${w.start}T00:00:00Z`);
    }
  });

  it("add up the days of a week: the running week is the five days so far of the 90-day file", () => {
    for (const kind of kinds) {
      const week = rowsOf("1y", kind, "native").at(-1)!;
      const days = rowsOf("90d", kind, "native").filter((row) => row.start_time >= "2026-10-12" && row.start_time < "2026-10-19");
      expect(days).toHaveLength(5);
      expect(new BigNumber(week.total).toFixed()).toBe(days.reduce((total, day) => total.plus(day.total), new BigNumber(0)).toFixed());
      expect(week.count).toBe(days.reduce((total, day) => total + day.count, 0));
    }
  });

  it("name the native currency and the markets config's currencies", () => {
    const names = (row: VolumeRow) => row.components.map((c) => `${c.currency}${c.issuer ? `.${c.issuer}` : ""}`).sort();
    const expected =
      net === "xrpl"
        ? [
            "524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
            "BTC.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
            "EUR.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq",
            "USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq",
            "USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
            "XRP",
          ]
        : [
            "4555525100000000000000000000000000000000.rDk1xiArDMjDqnrR2yWypwQAKg4mKnQYvs",
            "EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8",
            "RVN.rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb",
            "XAH",
          ];
    for (const row of rowsOf("30d", "payment", "native")) expect(names(row)).toEqual(expected);
  });

  it("name the markets of the config as trades against the native currency", () => {
    const native = net === "xrpl" ? "XRP" : "XAH";
    for (const row of rowsOf("30d", "exchange", "native")) {
      expect(row.components.every((c) => c.counter.currency === native && c.counter.issuer === undefined)).toBe(true);
      expect(row.components).toHaveLength(net === "xrpl" ? 5 : 1);
    }
  });
});

describe("the AMM volume of XRPL", () => {
  it("has three pools, valid accounts, and the native pools against XRP", () => {
    const rows = answerOf("xrpl", "30d", "amm").rows as VolumeRow[];
    for (const row of rows) {
      expect(row.components).toHaveLength(3);
      for (const c of row.components) expect(isValidClassicAddress(c.amm_account!), c.amm_account).toBe(true);
      expect(row.components.filter((c) => c.counter.currency === "XRP" && c.counter.issuer === undefined)).toHaveLength(2);
    }
    expect(new Set(rows.flatMap((row) => row.components.map((c) => c.amm_account))).size).toBe(3);
  });
});

describe("the volumes in USD", () => {
  const native = (kind: Kind) => answerOf("xrpl", "30d", kind, "native").rows as VolumeRow[];
  const usd = (kind: Kind) => answerOf("xrpl", "30d", kind, "usd").rows as VolumeRow[];

  it.each(KINDS)("are the native rows at the day's rate: the same buckets and amounts, converted_amount times the rate (%s)", (kind) => {
    const [rows, shown] = [native(kind), usd(kind)];
    expect(shown.map((row) => row.start_time)).toEqual(rows.map((row) => row.start_time));
    rows.forEach((row, at) => {
      const other = shown[at]!;
      expect(other.exchange).toEqual({ currency: "USD", issuer: USD_ISSUER });
      expect(row.exchange).toEqual({ currency: "XRP" });
      expect(row.exchange_rate).toBe("1.0000000");
      const rate = new BigNumber(other.exchange_rate);
      expect(rate.isGreaterThan(0.5) && rate.isLessThan(8)).toBe(true);
      expect(other.count).toBe(row.count);
      const key = (c: Component) => c.amm_account ?? (c.currency === undefined ? JSON.stringify(c.base) : `${c.currency}.${c.issuer}`);
      for (const c of row.components) {
        const same = other.components.find((o) => key(o) === key(c))!;
        expect(same.amount).toBe(c.amount);
        expect(same.count).toBe(c.count);
        const converted = new BigNumber(c.converted_amount).times(rate);
        // The rate is kept to 8 digits in the row; a component's amount is converted with the unrounded one.
        expect(new BigNumber(same.converted_amount).minus(converted).abs().isLessThanOrEqualTo(converted.times(1e-7).plus(1e-5)), `${key(c)} ${row.start_time}`).toBe(true);
      }
    });
  });

  it("move from day to day: the rate is seeded, not constant", () => {
    const rates = new Set(usd("payment").map((row) => row.exchange_rate));
    expect(rates.size).toBeGreaterThan(20);
  });
});

// ---- Validations -----------------------------------------------------------------------------------------------------

describe.each([
  ["xrpl", 35],
  ["xahau", 25],
] as const)("the validations on %s", (net, count) => {
  const newest = newestOf(net);

  it.each([0, 1])("hold %i: %d validators, in order of key, each key a node public key", (at) => {
    const ledger = newest[at]!;
    const answer = json(`${net}/data-api/ledgers/${ledger.hash}/validations@limit=1000.json`);
    expect(answer).toMatchObject({ result: "success", ledger_hash: ledger.hash, count });
    expect(answer.marker).toBeUndefined();
    const keys = answer.validations.map((v: { validation_public_key: string }) => v.validation_public_key) as string[];
    expect(keys).toHaveLength(count);
    expect(new Set(keys).size).toBe(count);
    expect(keys).toEqual([...keys].sort());
    for (const key of keys) {
      expect(decodeNodePublic(key)).toHaveLength(33);
      expect(key).toMatch(/^n/);
    }
  });

  it.each([0, 1])("have first_datetime within 400 ms after the ledger's close time, and a last_datetime that is not before it (ledger %i)", (at) => {
    const ledger = newest[at]!;
    const closed = Date.parse(ledger.date);
    for (const v of json(`${net}/data-api/ledgers/${ledger.hash}/validations@limit=1000.json`).validations) {
      const first = Date.parse(v.first_datetime);
      expect(first).toBeGreaterThanOrEqual(closed);
      expect(first).toBeLessThanOrEqual(closed + 400);
      expect(Date.parse(v.last_datetime)).toBeGreaterThanOrEqual(first);
      expect(v.first_datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(v).toMatchObject({ ledger_hash: ledger.hash, ledger_index: String(ledger.index) });
      expect(typeof v.count).toBe("number");
      expect(Object.keys(v)).toEqual([...Object.keys(v)].sort());
    }
  });

  it("are the same validators for the two ledgers", () => {
    const keysOf = (hash: string) => json(`${net}/data-api/ledgers/${hash}/validations@limit=1000.json`).validations.map((v: { validation_public_key: string }) => v.validation_public_key);
    expect(keysOf(newest[0]!.hash)).toEqual(keysOf(newest[1]!.hash));
  });

  it("spread the first sightings, so that the page's five earliest differ", () => {
    const times = json(`${net}/data-api/ledgers/${newest[0]!.hash}/validations@limit=1000.json`).validations.map((v: { first_datetime: string }) => Date.parse(v.first_datetime));
    expect(new Set(times).size).toBeGreaterThan(10);
  });
});

// ---- The generator ---------------------------------------------------------------------------------------------------

describe("networkFixtures", () => {
  it.each(NETS)("gives the same files in the same order on a second run (%s)", (net) => {
    const first = networkFixtures(net, lastOf(net), newestOf(net));
    const second = networkFixtures(net, lastOf(net), newestOf(net));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.length).toBe(net === "xrpl" ? 2 + 1 + 4 + 4 + 4 + 8 + 8 + 8 : 2 + 1 + 4 + 4 + 4 + 4 + 4);
  });

  it("gives another network other numbers: the seeds name the network", () => {
    const xrpl = networkFixtures("xrpl", lastOf("xrpl"), newestOf("xrpl"));
    const xahau = networkFixtures("xahau", lastOf("xahau"), newestOf("xahau"));
    const first = (files: typeof xrpl) => JSON.stringify(files.find((file) => file.path === "/v2/stats/metric")!.value);
    expect(first(xrpl)).not.toBe(first(xahau));
  });

  it("needs no close time for a ledger beyond the newest: it is estimated from the distance to it", () => {
    const [newest, before] = newestOf("xrpl");
    const files = networkFixtures("xrpl", lastOf("xrpl"), [newest!, { index: before!.index, hash: before!.hash }]);
    const answer = files.find((file) => file.path === `/v2/ledgers/${before!.hash}/validations`)!.value as { validations: Array<{ first_datetime: string }> };
    const closed = Date.parse(lastOf("xrpl").close_time) - (newest!.index - before!.index) * 3900;
    expect(Math.abs(Date.parse(answer.validations[0]!.first_datetime) - closed)).toBeLessThan(2000);
  });

  it("ends the volumes two days back in the first hour after midnight, when the day before is not final yet, and has no row for a week with no final day", () => {
    const monday: LastValidated = { ...lastOf("xrpl"), close_time: "2026-10-19T00:30:00Z" };
    const files = networkFixtures("xrpl", monday, newestOf("xrpl"));
    const volume = files.find((file) => file.path === "/v2/network/payment_volume" && file.query.includes("interval=day") && file.query.includes("start=2026-10-05") && !file.query.includes("exchange"))!;
    expect((volume.value as { rows: VolumeRow[] }).rows.at(-1)!.start_time).toBe("2026-10-17T00:00:00Z");
    const weeks = files.find((file) => file.path === "/v2/network/payment_volume" && file.query.includes("interval=week") && !file.query.includes("exchange"))!;
    // T is Monday 2026-10-19: the running week has no final day, and the one before it ends on the 17th.
    expect((weeks.value as { rows: VolumeRow[] }).rows.at(-1)!.start_time).toBe("2026-10-12T00:00:00Z");
    const stats = files.find((file) => file.path === "/v2/stats/type" && file.query.includes("interval=week"))!;
    expect((stats.value as { stats: Array<{ date: string }> }).stats.at(-1)!.date).toBe("2026-10-19T00:00:00Z");
  });
});

describe("isSynthetic", () => {
  // The size budget of test/unit/http-fixtures.test.ts counts these files apart from the recorded and hand-written ones.
  it("is true of the files networkFixtures writes and of no other generated file", () => {
    const written = NETS.flatMap((net) => networkFixtures(net, lastOf(net), newestOf(net)).map((file) => dataApiFile(net, file.path, file.query)!));
    expect([...generate().keys()].filter(isSynthetic).sort()).toEqual([...written].sort());
  });
});

describe("the text of the synthetic files", () => {
  // Spec 4: one line per row, sorted keys, as a transaction is one line in the recorded files.
  const synthetic = [...generate()].filter(([path]) => isSynthetic(path));
  /** The lists the data API keeps its rows under in these answers. */
  const isRows = (name: string, value: unknown) => ["stats", "rows", "validations"].includes(name) && Array.isArray(value);

  it("has one line for each row, and the lines of the envelope around them", () => {
    expect(synthetic).toHaveLength(62);
    for (const [path, text] of synthetic) {
      const body = JSON.parse(text) as Record<string, unknown>;
      const names = Object.keys(body).filter((name) => isRows(name, body[name]));
      expect(names, path).toHaveLength(1);
      const rows = body[names[0]!] as unknown[];
      expect(rows.length, path).toBeGreaterThan(0);
      // `{`, the other keys, `"rows": [`, the rows, `]`, `}`, and the final newline.
      const lines = text.split("\n");
      expect(lines, path).toHaveLength(rows.length + Object.keys(body).length + 3 + 1);
      expect(lines.at(-1)).toBe("");
    }
  });

  it("writes each row as the compact JSON of itself with its keys sorted, components and all", () => {
    for (const [path, text] of synthetic) {
      const body = JSON.parse(text) as Record<string, unknown>;
      const rows = Object.entries(body).find(([name, value]) => isRows(name, value))![1] as Array<Record<string, unknown>>;
      const lines = text.split("\n");
      const first = lines.findIndex((line) => /^ {2}"(stats|rows|validations)": \[$/.test(line)) + 1;
      rows.forEach((row, at) => {
        const line = lines[first + at]!;
        expect(line, path).toBe(`    ${JSON.stringify(row)}${at < rows.length - 1 ? "," : ""}`);
        const keys = Object.keys(row);
        expect(keys, path).toEqual([...keys].sort());
      });
    }
  });
});

describe("synthetic.ts", () => {
  it("is mulberry32: the first numbers of seed 1 are the algorithm's", () => {
    const next = mulberry32(1);
    expect([next(), next(), next()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it("gives numbers in [0, 1) and the same numbers for the same seed", () => {
    const [a, b, c] = [mulberry32(42), mulberry32(42), mulberry32(43)];
    const drawn = Array.from({ length: 1000 }, () => a());
    expect(drawn.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(Array.from({ length: 1000 }, () => b())).toEqual(drawn);
    expect(Array.from({ length: 1000 }, () => c())).not.toEqual(drawn);
  });

  it("makes a seed of its parts: the FNV-1a hash of them joined by a space", () => {
    expect(seedOf("xrpl", "stats/type")).toBe(seedOf("xrpl stats/type"));
    expect(seedOf("xrpl", "stats/type")).not.toBe(seedOf("xahau", "stats/type"));
    expect(seedOf("")).toBe(2166136261);
    expect(seedOf("xrpl", "a")).toBe(seedOf("xrpl a"));
  });
});
