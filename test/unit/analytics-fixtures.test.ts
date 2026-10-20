import { existsSync, readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { ANALYTICS_PERIODS, analyticsWindow, type AnalyticsPeriod, type AnalyticsUnit, type AnalyticsWindow } from "../../app/domain/analytics-params";
import { naturalOrientation } from "../../app/domain/market-pair";
import { checkAccountStats, checkAnalyticsBalances, checkAnalyticsExchanges, checkBalanceChanges, checkCounterparties } from "../../app/server/analytics-shape";
import { ANALYTICS_REFERENCE_COMMIT, analyticsFixtures } from "../../scripts/analytics-fixtures";
import { generate, HTTP, isAnalyticsGenerated, isHandWritten } from "../../scripts/http-fixtures";
import { dataApiFile, type NetworkName } from "../support/upstream-core";

// The Analytics tab's answers (E4 spec 7.5): synthetic, from scripts/analytics-fixtures.ts, written by `pnpm fixtures:sync`. What is asked is worked
// out here from the spec's table of calls (2.3) and the windows (`analyticsWindow`), not from the generator, and the files are read from the disk.
// The anchors (the balances the header shows, the day of the deletion) are read from the hand-written account fixtures, never written here.

const NETS: NetworkName[] = ["xrpl", "xahau"];
const NATIVE = { xrpl: "XRP", xahau: "XAH" } as const;
const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
/** The accounts of README.md, "Upstream fixtures". */
const ACTIVE: Record<NetworkName, string> = { xrpl: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", xahau: "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto" };
const DELETED: Record<NetworkName, string> = { xrpl: "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC", xahau: "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD" };
const accountsOf = (net: NetworkName) => [ACTIVE[net], DELETED[net], NEVER_FUNDED];

/** D2's order of the change types (api-reference.md, `balance_changes`); the changes without one come after them. */
const CHANGE_TYPES = [
  "transaction_cost",
  "payment_destination",
  "payment_source",
  "exchange",
  "intermediary",
  "escrow_create",
  "escrow_finish",
  "escrow_cancel",
  "paychannel_fund",
  "paychannel_payout",
];
const typeRank = (type: string | undefined) => (type === undefined ? CHANGE_TYPES.length + 1 : CHANGE_TYPES.indexOf(type) < 0 ? CHANGE_TYPES.length : CHANGE_TYPES.indexOf(type));

/** The keys of the answers that hold an amount or a value. */
const DECIMAL_KEYS = new Set([
  "account_value",
  "balance",
  "in_value",
  "out_value",
  "net_value",
  "sent_value",
  "received_value",
  "total_value",
  "base_volume",
  "counter_volume",
  "bought",
  "sold",
  "bought_counter",
  "sold_counter",
  "native_volume",
]);

const json = (path: string): any => JSON.parse(readFileSync(new URL(path, HTTP), "utf8"));
const exists = (path: string) => existsSync(new URL(path, HTTP));
const big = (text: string) => new BigNumber(text);

/** T: the UTC day of the recorded last_validated. */
const T = (net: NetworkName): string => json(`${net}/data-api/last_validated.json`).close_time.slice(0, 10);

/** The day All starts from: the account's activation, when the data API has its creation (the header's call A). */
function firstOf(net: NetworkName, account: string): { day: string; from: "activation" } | null {
  const path = `${net}/data-api/accounts/${account}.json`;
  return exists(path) ? { day: json(path).account_data.inception.slice(0, 10), from: "activation" } : null;
}

const windowFor = (net: NetworkName, account: string, period: AnalyticsPeriod): AnalyticsWindow => analyticsWindow(period, T(net), firstOf(net, account));

type Kind = "value" | "transactions" | "balance_changes" | "counterparties" | "balances" | "exchanges";
const KINDS: Kind[] = ["value", "transactions", "balance_changes", "counterparties", "balances", "exchanges"];

/** Calls 1 to 6 of spec 2.3 for a view: the path, and the query as `data-api.ts` writes it. */
function callOf(account: string, w: AnalyticsWindow, kind: Kind): { path: string; search: string } {
  const [u, S] = [w.unit, w.start];
  switch (kind) {
    case "value":
    case "transactions":
      return { path: `/v2/accounts/${account}/stats/${kind}`, search: `interval=${u}&limit=1000&start=${S}` };
    case "balance_changes":
      return { path: `/v2/accounts/${account}/analytics/balance_changes`, search: `interval=${u}&start=${S}` };
    case "counterparties":
      return { path: `/v2/accounts/${account}/analytics/counterparties`, search: `limit=6&start=${S}` };
    case "balances":
      return { path: `/v2/accounts/${account}/analytics/balances`, search: `interval=${u}&limit=4&start=${S}` };
    case "exchanges":
      return { path: `/v2/accounts/${account}/analytics/exchanges`, search: `limit=6&start=${S}` };
  }
}

const fileOf = (net: NetworkName, account: string, period: AnalyticsPeriod, kind: Kind) => {
  const { path, search } = callOf(account, windowFor(net, account, period), kind);
  return dataApiFile(net, path, search)!;
};
const answerOf = (net: NetworkName, account: string, period: AnalyticsPeriod, kind: Kind): any => json(fileOf(net, account, period, kind));

// ---- Days and buckets --------------------------------------------------------------------------------------------------

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const dayOf = (date: string) => date.slice(0, 10);

/** The start of the bucket of `unit` that holds `day`. */
function bucketOf(day: string, unit: AnalyticsUnit): string {
  if (unit === "day") return day;
  if (unit === "month") return `${day.slice(0, 7)}-01`;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** The start of the bucket after the one that starts at `bucket`. */
function nextBucket(bucket: string, unit: AnalyticsUnit): string {
  if (unit === "day") return addDays(bucket, 1);
  if (unit === "week") return addDays(bucket, 7);
  const [y, m] = bucket.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** The days of a bucket up to `last`. */
function daysOf(bucket: string, unit: AnalyticsUnit, last: string): string[] {
  const days: string[] = [];
  for (let day = bucket; day < nextBucket(bucket, unit) && day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new BigNumber(0)).toFixed();

/** The line of a balance row or line: its currency and its counterparty (none for the native one). */
const lineKey = (line: { currency: string; counterparty?: string }) => `${line.currency}.${line.counterparty ?? ""}`;

/** Every string under a key of DECIMAL_KEYS, with where it is. */
function decimalsOf(value: unknown, where = ""): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap((item, at) => decimalsOf(item, `${where}[${at}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => (DECIMAL_KEYS.has(key) ? [[`${where}.${key}`, item] as [string, unknown]] : decimalsOf(item, `${where}.${key}`)));
}

// ---- The files -----------------------------------------------------------------------------------------------------------

describe.each(NETS)("the analytics fixtures of %s", (net) => {
  it("are the six calls of each period for the active, the deleted and the never-funded account, as the generator writes them", () => {
    const asked = accountsOf(net).flatMap((account) => ANALYTICS_PERIODS.flatMap((period) => KINDS.map((kind) => fileOf(net, account, period, kind))));
    expect(asked).toHaveLength(72);
    expect(new Set(asked).size, "no two calls share a file").toBe(72);
    for (const file of asked) expect(exists(file), file).toBe(true);

    const written = analyticsFixtures(net, T(net)).map(({ path, query }) => dataApiFile(net, path, query));
    expect(new Set(written)).toEqual(new Set(asked));
    expect(written).toHaveLength(72);
  });

  it("are named as the brief names them: the window's first day, All from the month of the inception (or T's month)", () => {
    const starts = (account: string) => ANALYTICS_PERIODS.map((period) => windowFor(net, account, period).start);
    const all = { xrpl: ["2025-07-01", "2024-08-01"], xahau: ["2026-08-01", "2026-07-01"] }[net];
    expect(starts(ACTIVE[net])).toEqual(["2026-09-18", "2026-07-20", "2025-10-20", all[0]]);
    expect(starts(DELETED[net])).toEqual(["2026-09-18", "2026-07-20", "2025-10-20", all[1]]);
    expect(starts(NEVER_FUNDED)).toEqual(["2026-09-18", "2026-07-20", "2025-10-20", "2026-10-01"]);
    if (net === "xrpl") {
      expect(fileOf(net, ACTIVE.xrpl, "30d", "value")).toBe("xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/stats/value@interval=day&limit=1000&start=2026-09-18.json");
      expect(fileOf(net, ACTIVE.xrpl, "all", "exchanges")).toBe("xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/analytics/exchanges@limit=6&start=2025-07-01.json");
    }
  });

  it("pass the checks the client runs on each answer, with the interval asked for", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const { unit } = windowFor(net, account, period);
        const what = `${account} ${period}`;
        expect(() => checkAccountStats(answerOf(net, account, period, "value"), "value", unit, what), `${what} value`).not.toThrow();
        expect(() => checkAccountStats(answerOf(net, account, period, "transactions"), "transactions", unit, what), `${what} transactions`).not.toThrow();
        expect(() => checkBalanceChanges(answerOf(net, account, period, "balance_changes"), unit, what), `${what} balance_changes`).not.toThrow();
        expect(() => checkAnalyticsBalances(answerOf(net, account, period, "balances"), unit, what), `${what} balances`).not.toThrow();
        expect(() => checkCounterparties(answerOf(net, account, period, "counterparties"), what), `${what} counterparties`).not.toThrow();
        expect(() => checkAnalyticsExchanges(answerOf(net, account, period, "exchanges"), what), `${what} exchanges`).not.toThrow();
      }
    }
  });

  it("write every amount and value as a plain decimal, as bignumber.js writes it: no exponent, no trailing zero", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        for (const kind of KINDS) {
          for (const [where, text] of decimalsOf(answerOf(net, account, period, kind))) {
            expect(text, `${account} ${period} ${kind}${where}`).toMatch(/^-?\d+(\.\d+)?$/);
            expect(big(text as string).toFixed(), `${account} ${period} ${kind}${where}`).toBe(text);
          }
        }
      }
    }
  });

  it("give the analytics routes the window widened to whole buckets, the end exclusive; counterparties and exchanges by day", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const w = windowFor(net, account, period);
        const [S, last] = [w.start, w.buckets.at(-1)!];
        for (const kind of ["balance_changes", "balances"] as const) {
          expect(answerOf(net, account, period, kind), `${account} ${period} ${kind}`).toMatchObject({ start: `${S}T00:00:00Z`, end: `${nextBucket(last, w.unit)}T00:00:00Z`, interval: w.unit });
        }
        for (const kind of ["counterparties", "exchanges"] as const) {
          expect(answerOf(net, account, period, kind), `${account} ${period} ${kind}`).toMatchObject({ start: `${S}T00:00:00Z`, end: `${addDays(T(net), 1)}T00:00:00Z` });
        }
        for (const kind of ["value", "transactions"] as const) expect(answerOf(net, account, period, kind)).not.toHaveProperty("marker");
      }
    }
  });
});

// ---- The rules of the reference (spec 7.5) --------------------------------------------------------------------------------

describe.each(NETS)("the rules the answers of %s follow", (net) => {
  const funded = [ACTIVE[net], DELETED[net]];

  it("count every row: count is the number of rows, and only buckets of the window are served", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const w = windowFor(net, account, period);
        for (const kind of ["value", "transactions", "balance_changes", "balances"] as const) {
          const answer = answerOf(net, account, period, kind);
          expect(answer.count, `${account} ${period} ${kind}`).toBe(answer.rows.length);
          for (const row of answer.rows) expect(w.buckets, `${account} ${period} ${kind}`).toContain(dayOf(row.date));
        }
        const counterparties = answerOf(net, account, period, "counterparties");
        expect(counterparties.count).toBe(counterparties.counterparties.length);
        const exchanges = answerOf(net, account, period, "exchanges");
        expect(exchanges.count).toBe(exchanges.pairs.length);
      }
    }
  });

  it("give stats/value a row for every bucket from the first one in which the account had a balance", () => {
    for (const account of funded) {
      const inception = firstOf(net, account)!.day;
      for (const period of ANALYTICS_PERIODS) {
        const w = windowFor(net, account, period);
        const rows = answerOf(net, account, period, "value").rows;
        const from = bucketOf(inception, w.unit);
        expect(rows.map((row: any) => dayOf(row.date)), `${account} ${period}`).toEqual(w.buckets.filter((bucket) => bucket >= from));
      }
    }
  });

  it("make the result counts of stats/transactions add up to its type counts, and those to transaction_count; buckets without one have no row", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        for (const row of answerOf(net, account, period, "transactions").rows) {
          const add = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);
          expect(add(row.result), `${account} ${period} ${row.date}`).toBe(row.transaction_count);
          expect(add(row.type), `${account} ${period} ${row.date}`).toBe(row.transaction_count);
          expect(row.transaction_count).toBeGreaterThan(0);
        }
      }
    }
  });

  it("charge a fee for every transaction sent: each bucket's transaction_cost count is that bucket's transaction_count", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const sent = new Map(answerOf(net, account, period, "transactions").rows.map((row: any) => [row.date, row.transaction_count]));
        const fees = answerOf(net, account, period, "balance_changes").rows.filter((row: any) => row.change_type === "transaction_cost");
        expect(new Map(fees.map((row: any) => [row.date, row.count])), `${account} ${period}`).toEqual(sent);
        for (const fee of fees) expect(fee.in_value).toBe("0");
      }
    }
  });

  it("make the totals of balance_changes the sums of their rows, in D2's order of the types, with net_value = in_value − out_value", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const { totals, rows } = answerOf(net, account, period, "balance_changes");
        const what = `${account} ${period}`;
        expect(totals.map((total: any) => typeRank(total.change_type)), what).toEqual([...totals.map((total: any) => typeRank(total.change_type))].sort((a, b) => a - b));
        expect(new Set(totals.map((total: any) => total.change_type)).size, what).toBe(totals.length);
        expect(new Set(totals.map((total: any) => total.change_type)), what).toEqual(new Set(rows.map((row: any) => row.change_type)));
        for (const total of totals) {
          const ofType = rows.filter((row: any) => row.change_type === total.change_type);
          expect(total.count, `${what} ${total.change_type}`).toBe(ofType.reduce((n: number, row: any) => n + row.count, 0));
          expect(total.in_value, `${what} ${total.change_type}`).toBe(sum(ofType.map((row: any) => row.in_value)));
          expect(total.out_value, `${what} ${total.change_type}`).toBe(sum(ofType.map((row: any) => row.out_value)));
          expect(total.net_value, `${what} ${total.change_type}`).toBe(big(total.in_value).minus(total.out_value).toFixed());
        }
        // By date, then by type, one row for each bucket and type that has a change.
        const order = rows.map((row: any) => `${row.date} ${String(typeRank(row.change_type)).padStart(2, "0")}`);
        expect(order, what).toEqual([...order].sort());
        expect(new Set(order).size, what).toBe(order.length);
        for (const row of rows) expect(row.count, what).toBeGreaterThan(0);
      }
    }
  });

  it("rank the native line first, serve at most 4 of lines_total, and give the rows by date, then in the order of the lines", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const { lines, lines_total, rows } = answerOf(net, account, period, "balances");
        const what = `${account} ${period}`;
        expect(lines.length, what).toBeLessThanOrEqual(4);
        expect(lines_total, what).toBeGreaterThanOrEqual(lines.length);
        if (account === NEVER_FUNDED) continue;
        expect(lines[0], what).toEqual({ currency: NATIVE[net], balance: expect.any(String) });
        for (const line of lines.slice(1)) expect(line.counterparty, what).toEqual(expect.any(String));
        const order = lines.map(lineKey);
        const ranked = rows.map((row: any) => `${row.date} ${order.indexOf(lineKey(row))}`);
        expect(rows.every((row: any) => order.includes(lineKey(row))), what).toBe(true);
        expect(ranked, what).toEqual([...ranked].sort());
        // A line's balance in `lines` is its balance at the end of the window: its last row's.
        for (const line of lines) expect(rows.filter((row: any) => lineKey(row) === lineKey(line)).at(-1)?.balance, `${what} ${lineKey(line)}`).toBe(line.balance);
        // A line has a row for every bucket from its first one on.
        for (const line of lines) {
          const dates = rows.filter((row: any) => lineKey(row) === lineKey(line)).map((row: any) => dayOf(row.date));
          const w = windowFor(net, account, period);
          expect(dates, `${what} ${lineKey(line)}`).toEqual(w.buckets.slice(w.buckets.indexOf(dates[0])));
        }
      }
    }
  });

  it("sort the counterparties by total_value, then by account, with total at least count and the values adding up", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const { total, count, counterparties } = answerOf(net, account, period, "counterparties");
        const what = `${account} ${period}`;
        expect(total, what).toBeGreaterThanOrEqual(count);
        expect(count, what).toBeLessThanOrEqual(6);
        for (const [at, party] of counterparties.entries()) {
          expect(party.total_value, what).toBe(big(party.sent_value).plus(party.received_value).toFixed());
          expect(party.payments_sent + party.payments_received, what).toBeGreaterThan(0);
          expect(party.first <= party.last, what).toBe(true);
          expect(party.account, what).not.toBe(account);
          const next = counterparties[at + 1];
          if (next) {
            const order = big(party.total_value).comparedTo(next.total_value)!;
            expect(order > 0 || (order === 0 && party.account < next.account), `${what} ${party.account}`).toBe(true);
          }
        }
      }
    }
  });

  it("sort the pairs by native_volume, the pairs without one last, and keep each pair's sides adding up", () => {
    for (const account of accountsOf(net)) {
      for (const period of ANALYTICS_PERIODS) {
        const { total, count, pairs } = answerOf(net, account, period, "exchanges");
        const what = `${account} ${period}`;
        expect(total, what).toBeGreaterThanOrEqual(count);
        expect(count, what).toBeLessThanOrEqual(6);
        for (const [at, pair] of pairs.entries()) {
          expect(pair.base_volume, what).toBe(big(pair.bought).plus(pair.sold).toFixed());
          expect(pair.counter_volume, what).toBe(big(pair.bought_counter).plus(pair.sold_counter).toFixed());
          const next = pairs[at + 1];
          if (next && next.native_volume !== undefined) expect(pair.native_volume !== undefined && big(pair.native_volume).gte(next.native_volume), what).toBe(true);
          // The native side of a pair is its native volume.
          if (pair.base_currency === NATIVE[net] && pair.base_issuer === undefined) expect(pair.native_volume, what).toBe(pair.base_volume);
          if (pair.counter_currency === NATIVE[net] && pair.counter_issuer === undefined) expect(pair.native_volume, what).toBe(pair.counter_volume);
        }
      }
    }
  });
});

// ---- One history, cut to each window -----------------------------------------------------------------------------------

describe.each(NETS)("the four periods of %s", (net) => {
  const funded = [ACTIVE[net], DELETED[net]];

  it("agree day by day: a 30-day file's rows are the 90-day file's rows of the same days", () => {
    for (const account of funded) {
      const S = windowFor(net, account, "30d").start;
      for (const kind of ["value", "transactions", "balance_changes", "balances"] as const) {
        const wide = answerOf(net, account, "90d", kind).rows.filter((row: any) => dayOf(row.date) >= S);
        expect(answerOf(net, account, "30d", kind).rows, `${account} ${kind}`).toEqual(wide);
      }
    }
  });

  it("make a week or a month of what its days hold, wherever the 90-day file has all of its days", () => {
    const T_ = T(net);
    for (const account of funded) {
      const days90 = windowFor(net, account, "90d");
      const daily = (kind: Kind) => answerOf(net, account, "90d", kind).rows as any[];
      for (const period of ["1y", "all"] as const) {
        const w = windowFor(net, account, period);
        for (const bucket of w.buckets) {
          const days = daysOf(bucket, w.unit, T_);
          if (days[0]! < days90.start) continue;
          const what = `${account} ${period} ${bucket}`;
          const onDays = (rows: any[]) => rows.filter((row) => days.includes(dayOf(row.date)));
          const at = (rows: any[]) => rows.filter((row) => dayOf(row.date) === bucket);

          // Counts and values add up.
          const sent = onDays(daily("transactions")).reduce((n, row) => n + row.transaction_count, 0);
          expect(at(answerOf(net, account, period, "transactions").rows)[0]?.transaction_count ?? 0, what).toBe(sent);
          for (const type of [...CHANGE_TYPES, undefined]) {
            const ofType = (rows: any[]) => rows.filter((row) => row.change_type === type);
            const dayRows = ofType(onDays(daily("balance_changes")));
            const bucketRow = ofType(at(answerOf(net, account, period, "balance_changes").rows))[0];
            expect(bucketRow?.count ?? 0, `${what} ${type}`).toBe(dayRows.reduce((n, row) => n + row.count, 0));
            if (bucketRow) {
              expect(bucketRow.in_value, `${what} ${type}`).toBe(sum(dayRows.map((row) => row.in_value)));
              expect(bucketRow.out_value, `${what} ${type}`).toBe(sum(dayRows.map((row) => row.out_value)));
            }
          }
          // A level is the one of the bucket's last day.
          const lastDay = days.at(-1)!;
          const value = at(answerOf(net, account, period, "value").rows)[0];
          const valueThen = daily("value").find((row) => dayOf(row.date) === lastDay);
          expect(value?.account_value, what).toBe(valueThen?.account_value);
          // (A bucket before the account's first day has no row, and neither have its days.)
          expect(value?.balance_change_count ?? 0, what).toBe(onDays(daily("value")).reduce((n, row) => n + row.balance_change_count, 0));
          for (const row of at(answerOf(net, account, period, "balances").rows)) {
            const then = daily("balances").find((day) => dayOf(day.date) === lastDay && lineKey(day) === lineKey(row));
            expect(row.balance, `${what} ${lineKey(row)}`).toBe(then?.balance);
          }
        }
      }
    }
  });
});

// ---- Anchored to the header's fixtures -----------------------------------------------------------------------------------

describe.each(NETS)("the anchors of %s, read from the hand-written account fixtures", (net) => {
  const nativeRows = (rows: any[]) => rows.filter((row) => row.currency === NATIVE[net] && row.counterparty === undefined);

  it("end the active account's native line at account_info's balance, and each token line at the balances fixture's", () => {
    const account = ACTIVE[net];
    const drops = json(`${net}/node/account_info/${account}.json`).result.account_data.Balance as string;
    const native = big(drops).shiftedBy(-6).toFixed();
    expect(native).toBe({ xrpl: "10.001625", xahau: "9351.039221" }[net]);
    const tokens = (json(`${net}/data-api/accounts/${account}/balances.json`).balances as any[]).filter((line) => line.counterparty !== undefined);
    expect(tokens.map((line) => line.value)).toContain({ xrpl: "48329.908117603", xahau: "28437367.3675102" }[net]);

    for (const period of ANALYTICS_PERIODS) {
      const { lines, rows } = answerOf(net, account, period, "balances");
      expect(nativeRows(rows).at(-1).balance, period).toBe(native);
      expect(lines[0].balance, period).toBe(native);
      for (const token of tokens) {
        const line = lines.find((l: any) => l.currency === token.currency && l.counterparty === token.counterparty);
        expect(line?.balance, `${period} ${token.currency}`).toBe(token.value);
        expect(rows.filter((row: any) => lineKey(row) === lineKey(token)).at(-1).balance, `${period} ${token.currency}`).toBe(token.value);
      }
      // The value of the account now: its native balance and its tokens, at the rate of the day.
      const value = answerOf(net, account, period, "value").rows.at(-1).account_value;
      expect(big(value).gt(native), period).toBe(true);
    }
  });

  it("zero the deleted account's native line from the bucket of its deletion on, and not before; its value too", () => {
    const account = DELETED[net];
    // The deletion: XRPL's recorded AccountDelete, Xahau's newest recorded transaction (README, "Upstream fixtures").
    const newest = json(`${net}/data-api/accounts/${account}/transactions@descending=true&limit=20.json`).transactions[0];
    const deleted = dayOf(newest.date);
    expect(deleted).toBe("2026-10-15");
    if (net === "xrpl") expect(newest.tx.TransactionType).toBe("AccountDelete");

    for (const period of ANALYTICS_PERIODS) {
      const w = windowFor(net, account, period);
      const from = bucketOf(deleted, w.unit);
      const { lines, rows } = answerOf(net, account, period, "balances");
      expect(lines, period).toEqual([{ currency: NATIVE[net], balance: "0" }]);
      const native = nativeRows(rows);
      const inception = bucketOf(firstOf(net, account)!.day, w.unit);
      expect(native.map((row: any) => dayOf(row.date)), period).toEqual(w.buckets.filter((bucket) => bucket >= inception));
      for (const row of native) {
        if (dayOf(row.date) >= from) expect(row.balance, `${period} ${row.date}`).toBe("0");
        else expect(big(row.balance).gt(0), `${period} ${row.date}`).toBe(true);
      }
      for (const row of answerOf(net, account, period, "value").rows) {
        if (dayOf(row.date) >= from) expect(row.account_value, `${period} ${row.date}`).toBe("0");
        else expect(big(row.account_value).gt(0), `${period} ${row.date}`).toBe(true);
      }
      // Nothing happens after the deletion.
      for (const kind of ["transactions", "balance_changes"] as const) {
        for (const row of answerOf(net, account, period, kind).rows) expect(dayOf(row.date) <= from, `${period} ${kind} ${row.date}`).toBe(true);
      }
      for (const party of answerOf(net, account, period, "counterparties").counterparties) expect(dayOf(party.last) <= deleted, period).toBe(true);
    }
  });

  it("give the never-funded address the empty answers of an unknown address, for every period", () => {
    for (const period of ANALYTICS_PERIODS) {
      const w = windowFor(net, NEVER_FUNDED, period);
      expect(answerOf(net, NEVER_FUNDED, period, "value"), period).toEqual({ result: "success", count: 0, rows: [] });
      expect(answerOf(net, NEVER_FUNDED, period, "transactions"), period).toEqual({ result: "success", count: 0, rows: [] });
      const window = { result: "success", start: `${w.start}T00:00:00Z` };
      expect(answerOf(net, NEVER_FUNDED, period, "balances"), period).toMatchObject({ ...window, interval: w.unit, lines_total: 0, lines: [], count: 0, rows: [] });
      expect(answerOf(net, NEVER_FUNDED, period, "balance_changes"), period).toMatchObject({ ...window, interval: w.unit, totals: [], count: 0, rows: [] });
      expect(answerOf(net, NEVER_FUNDED, period, "counterparties"), period).toMatchObject({ ...window, sort: "value", total: 0, count: 0, counterparties: [] });
      expect(answerOf(net, NEVER_FUNDED, period, "exchanges"), period).toMatchObject({ ...window, total: 0, count: 0, pairs: [] });
    }
  });
});

// ---- What the view and its tests need ----------------------------------------------------------------------------------

describe("what the view needs of the fixtures", () => {
  it("has a failed transaction in at least one of the XRPL active account's 30 daily buckets", () => {
    const rows = answerOf("xrpl", ACTIVE.xrpl, "30d", "transactions").rows as Array<{ result: Record<string, number> }>;
    expect(rows.some((row) => Object.keys(row.result).some((code) => code !== "tesSUCCESS"))).toBe(true);
  });

  it("has, on each network, a pair of the 30 days that natural orientation inverts: XRPL's USD.rhub8…/XRP, Xahau's USD.r…/XAH", () => {
    const inverted = (net: NetworkName) =>
      (answerOf(net, ACTIVE[net], "30d", "exchanges").pairs as any[]).filter(
        (pair) =>
          pair.base_currency === "USD" &&
          pair.counter_currency === NATIVE[net] &&
          pair.counter_issuer === undefined &&
          naturalOrientation({ currency: pair.base_currency, issuer: pair.base_issuer }, { currency: pair.counter_currency }, NATIVE[net]).inverted,
      );
    expect(inverted("xrpl").map((pair) => pair.base_issuer)).toEqual(["rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"]);
    expect(inverted("xahau")).toHaveLength(1);
    expect(inverted("xahau")[0].base_issuer).toMatch(/^r/);
  });

  it("has counterparties and DEX trades for both active accounts in the default view, and balance changes of several kinds", () => {
    for (const net of NETS) {
      expect(answerOf(net, ACTIVE[net], "30d", "counterparties").total).toBeGreaterThan(0);
      expect(answerOf(net, ACTIVE[net], "30d", "exchanges").total).toBeGreaterThan(0);
      expect(answerOf(net, ACTIVE[net], "30d", "balance_changes").totals.length).toBeGreaterThan(2);
    }
  });
});

describe("the generator's files among the others", () => {
  it("are what isAnalyticsGenerated names, and none is written by hand", () => {
    const written = NETS.flatMap((net) => analyticsFixtures(net, T(net)).map(({ path, query }) => dataApiFile(net, path, query)!));
    expect([...generate().keys()].filter(isAnalyticsGenerated).sort()).toEqual([...written].sort());
    expect(written.filter(isHandWritten)).toEqual([]);
    // The account files beside them stay the hand's.
    expect(isHandWritten(`xrpl/data-api/accounts/${ACTIVE.xrpl}/balances.json`)).toBe(true);
    expect(isHandWritten(`xrpl/data-api/accounts/${ACTIVE.xrpl}.json`)).toBe(true);
    expect(isHandWritten(`xahau/data-api/accounts/${NEVER_FUNDED}/transactions@limit=1.json`)).toBe(true);
    // Every stats/ or analytics/ file of an account on the disk is one of them.
    const onDisk = NETS.flatMap((net) =>
      readdirSync(new URL(`${net}/data-api/accounts/`, HTTP), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${entry.parentPath.slice(HTTP.pathname.length)}/${entry.name}`.replace(/^\//, ""))
        .filter((path) => /\/(stats|analytics)\//.test(path)),
    );
    expect(onDisk.sort()).toEqual([...written].sort());
  });

  it("follow the reference commit that PROVENANCE.md names, and README.md lists them as synthetic", () => {
    expect(ANALYTICS_REFERENCE_COMMIT).toBe("7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e");
    const provenance = readFileSync(new URL("../fixtures/PROVENANCE.md", import.meta.url), "utf8");
    expect(provenance).toContain(ANALYTICS_REFERENCE_COMMIT);
    expect(provenance).toContain("scripts/analytics-fixtures.ts");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toMatch(/\| `data-api\/accounts\/<address>\/stats\/[^|]*\|[^|]*\| generator \(synthetic\) \|/);
    expect(readme).toMatch(/\| `data-api\/accounts\/<address>\/analytics\/[^|]*\|[^|]*\| generator \(synthetic\) \|/);
  });
});
