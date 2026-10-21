// What the network page shows, worked out in the Worker from the data API's answers (spec 1.6): one builder for each call, and `networkPage`,
// which turns each call into a part of the page that stands or fails on its own. No I/O, no clock, no `Intl`: the numbers of the API become
// text with `String(n)` and every sum, share and rounding goes through bignumber.js, so no float reaches a string of the page.

import BigNumber from "bignumber.js";

import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount, formatCurrency, formatUtcDay, shortAddress } from "../domain/format";
import { displaysOf, type Display, type NetworkParams } from "../domain/network-params";
import { sharePercent } from "../domain/percent";
import { groupCounts, typeGroups, typeGroupsNote } from "../domain/type-groups";
import { validatorHref } from "../domain/validators-params";
import { bucketStarts, pendingCount, utcDayOf, windowOf, type PeriodWindow } from "../domain/window";
import type { BarListData, Delta, Series, TimeSeriesData } from "../ui/charts/types";
import { anchorOf, type Anchor } from "./anchor";
import type {
  AmmVolumeComponent,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeRow,
  FeeStatsRow,
  LastValidated,
  LedgerValidations,
  Page,
  PaymentVolumeComponent,
  StatsRow,
  VolumeRow,
} from "./api-types";
import { TooLate } from "./deadline";
import { latestLedgerIndex } from "./home-view";
import type { Network } from "./networks";

/** A part of the page: what its call gave, or why it did not. Each stands on its own. */
export type Part<T> = ({ state: "ok" } & T) | { state: "failed"; reason: string };

export interface SeriesView {
  /** W, the window's bucket starts, oldest first (`YYYY-MM-DD`). */
  buckets: string[];
  unit: "day" | "week";
  /** One per bucket: an exact decimal, or `null` where there is no row. */
  values: (string | null)[];
  /** How many of the newest buckets have no row because the route has not computed them yet (0 to 2). */
  pending: number;
  /** The newest bucket is the running one. */
  forming: boolean;
  token: string;
}
/** What a `StatTile` shows. */
export interface Figure {
  value: string;
  delta: Delta | null;
  sub: string | null;
}
export interface StripChip {
  index: number;
  txCount: number;
  /** Unix seconds. */
  closeTime: number;
}
export interface OpenLedgerView {
  /** Drops. */
  fee: string;
  minimum: string;
  queue: string;
  openSize: string;
  expected: string;
  /** `HH:MM:SS`, UTC. */
  asOf: string;
}
export interface ValidatorsView {
  ledger: { index: number; hash: string };
  count: string;
  /** The five first seen; `href` is the validator's page while the `VALIDATORS` switch is on, else `null` (the key is text). */
  first: { key: string; short: string; delay: string; href: string | null }[];
  href: string | null;
}
export interface MetricsView {
  transactions: Figure;
  interval: Figure;
  perLedger: Figure;
  accountsCreated: Figure;
}
export interface PaymentsView {
  series: SeriesView;
  figure: Figure;
  byCurrency: BarListData;
  currencies: string;
}
export interface ExchangesView {
  series: SeriesView;
  /** The window's total, an exact decimal in the page's currency. */
  total: string;
  /** "to Oct 16; Oct 17 not computed yet", while the newest buckets are pending. */
  pendingWords: string | null;
}
export type AmmPart =
  | ({ state: "ok" } & { series: SeriesView; total: string })
  | { state: "failed"; reason: string }
  | { state: "off" }
  | { state: "none" };

export interface NetworkPageData {
  anchor: Anchor;
  view: NetworkParams;
  displays: readonly Display[];
  /** "XRP" | "XAH" | "USD" */
  currency: string;
  window: { unit: "day" | "week"; note: string };
  strip: StripChip[];
  openLedger: Part<OpenLedgerView>;
  validators: Part<ValidatorsView>;
  types: Part<{ chart: TimeSeriesData; note: string }>;
  metrics: Part<MetricsView>;
  fees: Part<{ chart: TimeSeriesData }>;
  payments: Part<PaymentsView>;
  exchanges: Part<ExchangesView>;
  amm: AmmPart;
}

/**
 * What the network route's loader returns: the page, and the `BUILD_ID` of the Worker that made it. An open page compares it with the build
 * it was loaded with and reloads after a deploy (`app/ui/live-page.ts`).
 */
export interface NetworkLoaderData extends NetworkPageData {
  build: string;
}

export interface NetworkInput {
  net: Pick<Network, "id" | "native" | "hasAmm" | "features">;
  view: NetworkParams;
  /** #1 */
  last: LastValidated;
  /** #2, newest first. */
  feesList: readonly FeeRow[];
  /** #5 */
  feeStats: PromiseSettledResult<Page<"rows", FeeStatsRow>>;
  /** #6 */
  types: PromiseSettledResult<Page<"stats", StatsRow>>;
  /** #7, from `P₀` (the deltas need P). */
  metrics: PromiseSettledResult<Page<"stats", StatsRow>>;
  /** #8 */
  feeDays: PromiseSettledResult<Page<"rows", FeeBucketRow>>;
  /** #9, from `P₀`. */
  payments: PromiseSettledResult<Page<"rows", VolumeRow<PaymentVolumeComponent>>>;
  /** #10 */
  exchanges: PromiseSettledResult<Page<"rows", VolumeRow<ExchangeVolumeComponent>>>;
  /** #11, or why there is no call (spec 1.6, "AMM"). */
  amm: PromiseSettledResult<Page<"rows", VolumeRow<AmmVolumeComponent>>> | "off" | "none";
  /** #3 and #4: the ledger the validations are of, and the answer. */
  validators: PromiseSettledResult<{ ledger: { index: number; hash: string }; answer: LedgerValidations }>;
}

/** The validations the loader asks for (#4): when the answer has a next page, the count is "at least" this many. */
export const VALIDATIONS_LIMIT = 1000;

/** The newest ledgers the strip shows. */
const STRIP_LENGTH = 6;
/** The validators listed under "First seen". */
const FIRST_SEEN = 5;

const DASH = "—";
const ELLIPSIS = "…";
const MINUS = "−";
const ZERO = new BigNumber(0);
const ONE = new BigNumber(1);
const SECONDS_IN = { day: 86_400, week: 604_800 } as const;

// ---- What every builder shares -------------------------------------------------------------------------------------------------------

/** What the builders read of the page: the network, the view, the anchor, its window, and where a failed part reports itself. */
export interface ViewContext {
  net: NetworkInput["net"];
  view: NetworkParams;
  anchor: Anchor;
  /** W, F and P for `T`, the UTC day of the anchor's close time (spec 1.5). */
  window: PeriodWindow;
  currency: Network["native"] | "USD";
  /** Every part that failed, in the order the builders ran: the loader logs them. */
  failures: { part: string; error: unknown }[];
}

export function contextOf(input: Pick<NetworkInput, "net" | "view" | "last">): ViewContext {
  const anchor = anchorOf(input.last);
  return {
    net: input.net,
    view: input.view,
    anchor,
    window: windowOf(utcDayOf(anchor.closeTime), input.view.period),
    currency: input.view.display === "usd" ? "USD" : input.net.native,
    failures: [],
  };
}

/**
 * What a failed part says of itself. The page data is served to browsers and the page never shows it, so it is two fixed words and not the error's
 * message, which holds the upstream's path and query, the API's own text or the runtime's: a call that was too late "took too long" (spec 1.6),
 * anything else, a builder that throws included, "could not be loaded". The error itself stays in the context's failures, which the loader logs.
 */
const reasonOf = (error: unknown): string => (error instanceof TooLate ? "took too long" : "could not be loaded");

/**
 * A part from a call's outcome. A rejection fails the part (see `reasonOf`), and so does an answer the builder cannot use: one broken part does
 * not make a 500 of the page. Each failure is reported to the context with its error.
 */
function settle<V, X extends object>(ctx: ViewContext, part: string, result: PromiseSettledResult<V>, build: (value: V) => X): Part<X> {
  const failed = (error: unknown): Part<X> => {
    ctx.failures.push({ part, error });
    return { state: "failed", reason: reasonOf(error) };
  };
  if (result.status === "rejected") return failed(result.reason);
  try {
    return { state: "ok", ...build(result.value) };
  } catch (error) {
    return failed(error);
  }
}

const num = (value: number | string): BigNumber => new BigNumber(String(value));
const tokened = <T extends object>(data: T): T & { token: string } => ({ ...data, token: tokenOf(data) });

/** The rows by the day their time starts with: `2026-10-17T00:00:00Z` is `2026-10-17`. */
function byDay<R>(rows: readonly R[], timeOf: (row: R) => string): Map<string, R> {
  const byTime = new Map<string, R>();
  for (const row of rows) byTime.set(timeOf(row).slice(0, 10), row);
  return byTime;
}

/** `n ÷ d` (d above 0) to `places` decimals, half away from zero, exactly: BigNumber's own division rounds at 20 places before we round. */
function divided(n: BigNumber, d: BigNumber, places: number): BigNumber {
  const rounded = n.abs().shiftedBy(places).times(2).plus(d).idiv(d.times(2)).shiftedBy(-places);
  return n.isNegative() && !rounded.isZero() ? rounded.negated() : rounded;
}

/** The newest buckets of the window without a value, counted by the rule of spec 1.6 ("Pending"). */
function pendingOf(w: PeriodWindow, values: readonly (string | null)[]): number {
  return pendingCount(w.buckets, new Set(w.buckets.filter((_, i) => values[i] !== null)));
}

function seriesOf(w: PeriodWindow, values: (string | null)[]): SeriesView {
  return tokened({ buckets: w.buckets, unit: w.unit, values, pending: pendingOf(w, values), forming: true });
}

/** "Oct 16 and Oct 17", "the week of Oct 12", "the weeks of Oct 5 and Oct 12". */
function bucketWords(unit: "day" | "week", buckets: readonly string[]): string {
  const days = buckets.map((bucket) => formatUtcDay(bucket));
  const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : (days[0] ?? "");
  return unit === "week" ? `the ${days.length > 1 ? "weeks" : "week"} of ${list}` : list;
}

/**
 * What a tile that sums a window says of the newest buckets that are pending: "to Oct 16; Oct 17 not computed yet". The tile never claims a
 * bucket it does not count, so it names the newest one that has a value.
 */
function pendingWords(w: PeriodWindow, values: readonly (string | null)[], pending: number): string | null {
  if (pending === 0) return null;
  const counted = w.buckets.filter((_, i) => values[i] !== null).at(-1);
  const behind = bucketWords(w.unit, w.buckets.slice(-pending));
  return `${counted ? `to ${bucketWords(w.unit, [counted])}; ` : ""}${behind} not computed yet`;
}

/** F and P (spec 1.5) as bucket lists. */
function comparison(w: PeriodWindow): { full: string[]; previous: string[] } {
  return {
    full: bucketStarts(w.full.start, w.full.end, w.unit),
    previous: bucketStarts(w.previous.start, w.previous.end, w.unit),
  };
}

/** The sum of `read` over the buckets, or `null` when one of them has no row: a delta needs every bucket. */
function totalOver<R>(rows: ReadonlyMap<string, R>, buckets: readonly string[], read: (row: R) => BigNumber): BigNumber | null {
  let sum = ZERO;
  for (const bucket of buckets) {
    const row = rows.get(bucket);
    if (!row) return null;
    sum = sum.plus(read(row));
  }
  return sum;
}

/** A quantity over F or P: a sum (`den` 1) or a rate (a count over the ledgers). */
interface Ratio {
  num: BigNumber;
  den: BigNumber;
}
const ratioOf = (num: BigNumber | null, den: BigNumber | null): Ratio | null => (num && den ? { num, den } : null);

/**
 * The change of F against P, `(F − P) / P`, to 1 decimal in percent, half up, with a sign (U+2212 for a drop), and the words that name the
 * window. `null` unless F and P are whole (every bucket had a row) and P is above 0 (spec 1.6, "Deltas"). A rate is compared as a rate:
 * `(fNum/fDen − pNum/pDen) / (pNum/pDen)` is one fraction, so nothing is divided twice.
 */
function changeOf(w: PeriodWindow, f: Ratio | null, p: Ratio | null): Delta | null {
  if (!f || !p || !p.num.gt(0) || !p.den.gt(0) || !f.den.gt(0)) return null;
  const change = f.num.times(p.den).minus(p.num.times(f.den));
  const percent = divided(change.times(100), p.num.times(f.den), 1);
  const sign = percent.isZero() ? 0 : percent.isNegative() ? -1 : 1;
  const buckets = bucketStarts(w.full.start, w.full.end, w.unit).length;
  const signed = `${sign === 1 ? "+" : sign === -1 ? MINUS : ""}${formatAmount(percent.abs().toFixed(1))}%`;
  return {
    text: `${signed}, ${buckets} full ${w.unit}s to ${formatUtcDay(w.full.end)} vs the ${buckets} before`,
    sign,
  };
}

// ---- The strip and the open ledger ---------------------------------------------------------------------------------------------------

/** An ISO 8601 time of the data API as unix seconds. */
const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** The newest 6 ledgers up to `latest` (the home rule, `latestLedgerIndex`) from the fees list, newest first. */
export function stripOf(feesList: readonly FeeRow[], latest: number): StripChip[] {
  return feesList
    .filter((row) => row.ledger_index <= latest)
    .slice(0, STRIP_LENGTH)
    .map((row) => ({ index: row.ledger_index, txCount: row.tx_count, closeTime: seconds(row.date) }));
}

/** Whole drops, half up, from a fee in whole units of the native currency (a JSON number). */
const dropsOf = (fee: number): string => num(fee).shiftedBy(6).toFixed(0, BigNumber.ROUND_HALF_UP);
const wholeOf = (count: number): string => num(count).toFixed(0, BigNumber.ROUND_HALF_UP);

export function openLedgerOf(ctx: ViewContext, result: NetworkInput["feeStats"]): Part<OpenLedgerView> {
  return settle(ctx, "openLedger", result, (answer) => {
    const row = answer.rows[0];
    if (!row) throw new Error("the data API has no fee snapshot");
    return {
      fee: dropsOf(row.open_ledger_fee),
      minimum: dropsOf(row.minimum_fee),
      queue: wholeOf(row.current_queue_size),
      openSize: wholeOf(row.current_ledger_size),
      expected: wholeOf(row.expected_ledger_size),
      asOf: new Date(Date.parse(row.date)).toISOString().slice(11, 19),
    };
  });
}

// ---- Transactions by type, and the tiles ---------------------------------------------------------------------------------------------

/** The counts of a stats row: every name but its date. */
function typeCounts(row: StatsRow): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(row)) if (name !== "date" && typeof value === "number") counts[name] = value;
  return counts;
}

export function typesOf(ctx: ViewContext, result: NetworkInput["types"]): Part<{ chart: TimeSeriesData; note: string }> {
  return settle(ctx, "types", result, (answer) => {
    const { net, window: w } = ctx;
    const rows = byDay(answer.stats, (row) => row.date);
    const perBucket = w.buckets.map((bucket) => {
      const row = rows.get(bucket);
      return row ? groupCounts(net.id, typeCounts(row)) : null;
    });
    const series: Series[] = typeGroups(net.id).map((group) => ({
      id: group.id,
      label: group.label,
      slot: group.slot,
      values: perBucket.map((counts) => counts?.[group.id] ?? null),
    }));
    const totals = perBucket.map((counts) => (counts ? Object.values(counts).reduce((sum, count) => sum.plus(count), ZERO).toFixed() : null));
    const data: Omit<TimeSeriesData, "token"> = {
      axis: { unit: w.unit, buckets: w.buckets },
      series,
      format: { kind: "count", unit: "transactions" },
      totals,
      forming: true,
      pending: pendingOf(w, totals),
    };
    return { chart: tokened(data), note: typeGroupsNote(net.id) };
  });
}

/** A count of a stats row; a name that is missing from a row is 0 (the API leaves a zero count out). */
const countOf = (row: StatsRow, name: string): BigNumber => {
  const value = row[name];
  return typeof value === "number" ? num(value) : ZERO;
};

export function metricsOf(ctx: ViewContext, result: NetworkInput["metrics"]): Part<MetricsView> {
  return settle(ctx, "metrics", result, (answer) => {
    const { window: w, anchor } = ctx;
    const rows = byDay(answer.stats, (row) => row.date);
    const running = w.buckets[w.buckets.length - 1];

    // Totals over W, the running bucket included. The interval is the seconds the present buckets cover over their ledgers: a full bucket
    // is as long as it is, the running one runs from its start to the anchor's close time.
    let [transactions, ledgers, accounts, covered] = [ZERO, ZERO, ZERO, ZERO];
    for (const bucket of w.buckets) {
      const row = rows.get(bucket);
      if (!row) continue;
      transactions = transactions.plus(countOf(row, "transaction_count"));
      ledgers = ledgers.plus(countOf(row, "ledger_count"));
      accounts = accounts.plus(countOf(row, "accounts_created"));
      const length = bucket === running ? Math.max(0, anchor.closeTime - Date.parse(`${bucket}T00:00:00Z`) / 1000) : SECONDS_IN[w.unit];
      covered = covered.plus(length);
    }

    const { full, previous } = comparison(w);
    const sumOf = (name: string, buckets: readonly string[]) => ratioOf(totalOver(rows, buckets, (row) => countOf(row, name)), ONE);
    const rateOf = (buckets: readonly string[]) =>
      ratioOf(
        totalOver(rows, buckets, (row) => countOf(row, "transaction_count")),
        totalOver(rows, buckets, (row) => countOf(row, "ledger_count")),
      );
    const delta = (f: Ratio | null, p: Ratio | null) => changeOf(w, f, p);

    return {
      transactions: { value: compactNumber(transactions.toFixed()), delta: delta(sumOf("transaction_count", full), sumOf("transaction_count", previous)), sub: null },
      interval: {
        value: ledgers.gt(0) ? `${divided(covered, ledgers, 2).toFixed(2)} s` : DASH,
        delta: null,
        sub: "average time between ledgers",
      },
      perLedger: { value: ledgers.gt(0) ? divided(transactions, ledgers, 1).toFixed(1) : DASH, delta: delta(rateOf(full), rateOf(previous)), sub: null },
      accountsCreated: {
        value: compactNumber(accounts.toFixed()),
        delta: delta(sumOf("accounts_created", full), sumOf("accounts_created", previous)),
        sub: null,
      },
    };
  });
}

// ---- The fee chart -------------------------------------------------------------------------------------------------------------------

export function feesOf(ctx: ViewContext, result: NetworkInput["feeDays"]): Part<{ chart: TimeSeriesData }> {
  return settle(ctx, "fees", result, (answer) => {
    const w = ctx.window;
    const rows = byDay(answer.rows, (row) => row.date);
    let values: (string | null)[];
    if (w.unit === "day") {
      values = w.buckets.map((bucket) => {
        const row = rows.get(bucket);
        return row ? dropsOf(row.avg) : null;
      });
    } else {
      // A week is the total the transactions of its days paid over how many there were: its 7 days, or the days up to `T` for the running week.
      // The weeks follow each other from the first bucket, a Monday, so the days of a week are the 7 after the weeks before it.
      const allDays = bucketStarts(w.start, w.end, "day");
      values = w.buckets.map((_, week) => {
        const own = allDays.slice(week * 7, week * 7 + 7).map((day) => rows.get(day));
        if (own.some((row) => row === undefined)) return null;
        const total = own.reduce((sum, row) => sum.plus(num(row!.total)), ZERO);
        const count = own.reduce((sum, row) => sum.plus(num(row!.tx_count)), ZERO);
        return count.gt(0) ? divided(total.shiftedBy(6), count, 0).toFixed() : "0";
      });
    }
    const data: Omit<TimeSeriesData, "token"> = {
      axis: { unit: w.unit, buckets: w.buckets },
      series: [{ id: "fee", label: "Average fee", slot: 1, values }],
      format: { kind: "drops", unit: "drops" },
      forming: true,
      pending: pendingOf(w, values),
    };
    return { chart: tokened(data) };
  });
}

// ---- The volumes ---------------------------------------------------------------------------------------------------------------------

/** The series of a volume route's rows over W, the window's total (the buckets that have a row) and what a tile says of the pending ones. */
function volumeOf(w: PeriodWindow, rows: ReadonlyMap<string, { total: string }>): { series: SeriesView; total: string; pendingWords: string | null } {
  let total = ZERO;
  const values = w.buckets.map((bucket) => {
    const row = rows.get(bucket);
    if (!row) return null;
    const value = num(row.total);
    total = total.plus(value);
    return value.toFixed();
  });
  const series = seriesOf(w, values);
  return { series, total: total.toFixed(), pendingWords: pendingWords(w, values, series.pending) };
}

/** The window's components summed per currency and issuer, largest first, with their shares of the whole to whole percents. */
function byCurrencyOf(w: PeriodWindow, rows: ReadonlyMap<string, VolumeRow<PaymentVolumeComponent>>, currency: string): BarListData {
  const sums = new Map<string, { currency: string; issuer: string | undefined; value: BigNumber; count: BigNumber }>();
  for (const bucket of w.buckets) {
    for (const component of rows.get(bucket)?.components ?? []) {
      const id = component.issuer ? `${component.currency}.${component.issuer}` : component.currency;
      const sum = sums.get(id) ?? { currency: component.currency, issuer: component.issuer || undefined, value: ZERO, count: ZERO };
      sum.value = sum.value.plus(num(component.converted_amount));
      sum.count = sum.count.plus(num(component.count));
      sums.set(id, sum);
    }
  }
  const sorted = [...sums].sort(([, a], [, b]) => b.value.comparedTo(a.value) ?? 0);
  const whole = sorted.reduce((sum, [, item]) => sum.plus(item.value), ZERO).toFixed();
  const data = {
    items: sorted.map(([id, item]) => ({
      id,
      label: formatCurrency(item.currency),
      ...(item.issuer ? { sublabel: shortAddress(item.issuer) } : {}),
      value: item.value.toFixed(),
      share: sharePercent(item.value.toFixed(), whole),
      count: item.count.toFixed(),
    })),
    format: { kind: "amount" as const, unit: currency },
  };
  return tokened(data);
}

export function paymentsOf(ctx: ViewContext, result: NetworkInput["payments"]): Part<PaymentsView> {
  return settle(ctx, "payments", result, (answer) => {
    const { window: w, currency } = ctx;
    const rows = byDay(answer.rows, (row) => row.start_time);
    const { series, total, pendingWords } = volumeOf(w, rows);
    const { full, previous } = comparison(w);
    const sumOf = (buckets: readonly string[]) => ratioOf(totalOver(rows, buckets, (row) => num(row.total)), ONE);

    const byCurrency = byCurrencyOf(w, rows, currency);
    const names = [...new Set(byCurrency.items.map((item) => item.label))];
    return {
      series,
      figure: { value: `${compactNumber(total)} ${currency}`, delta: changeOf(w, sumOf(full), sumOf(previous)), sub: pendingWords },
      byCurrency,
      currencies: `Payments in the currencies the data API tracks${names.length > 0 ? `: ${names.join(", ")}` : ""}.`,
    };
  });
}

export function exchangesOf(ctx: ViewContext, result: NetworkInput["exchanges"]): Part<ExchangesView> {
  return settle(ctx, "exchanges", result, (answer) => {
    const { series, total, pendingWords } = volumeOf(ctx.window, byDay(answer.rows, (row) => row.start_time));
    return { series, total, pendingWords };
  });
}

export function ammOf(ctx: ViewContext, amm: NetworkInput["amm"]): AmmPart {
  if (amm === "off" || amm === "none") return { state: amm };
  return settle(ctx, "amm", amm, (answer) => {
    const { series, total } = volumeOf(ctx.window, byDay(answer.rows, (row) => row.start_time));
    return { series, total };
  });
}

// ---- The validators ------------------------------------------------------------------------------------------------------------------

/** A validator's key in short form: `nHUFE9prPX…a3p`. */
const shortKey = (key: string): string => (key.length <= 14 ? key : `${key.slice(0, 10)}${ELLIPSIS}${key.slice(-3)}`);

export function validatorsOf(ctx: ViewContext, result: NetworkInput["validators"]): Part<ValidatorsView> {
  return settle(ctx, "validators", result, ({ ledger, answer }) => {
    const seen = answer.validations
      .map((validation) => ({ key: validation.validation_public_key, at: Date.parse(validation.first_datetime) }))
      .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
    const earliest = seen[0]?.at ?? 0;
    return {
      ledger: { index: ledger.index, hash: ledger.hash },
      // With a next page there are more than the limit asked for.
      count: answer.marker ? `${formatAmount(String(VALIDATIONS_LIMIT))}+` : formatAmount(String(answer.validations.length)),
      first: seen.slice(0, FIRST_SEEN).map(({ key, at }) => ({
        key,
        short: shortKey(key),
        delay: `+${formatAmount(String(at - earliest))} ms`,
        // The answer names master keys; a signing key there would be redirected to its master by the validator's page (spec 1.2).
        href: ctx.net.features.validators ? validatorHref(ctx.net.id, key) : null,
      })),
      href: ctx.net.features.validators ? `/${ctx.net.id}/validators?scope=all` : null,
    };
  });
}

// ---- The page ------------------------------------------------------------------------------------------------------------------------

/**
 * The page's data from the outcomes of the loader's calls, and the parts that failed (with the error of each) for the loader to log. A part
 * that failed does not change another: every card shows its own error. The AMM states `off` and `none` are answers, not failures.
 */
export function networkPage(input: NetworkInput): { page: NetworkPageData; failures: { part: string; error: unknown }[] } {
  const ctx = contextOf(input);
  const { net, view } = input;
  const usd = ctx.currency === "USD";
  const page: NetworkPageData = {
    anchor: ctx.anchor,
    view,
    displays: displaysOf(net.id),
    currency: ctx.currency,
    window: {
      unit: ctx.window.unit,
      note: `Totals and charts cover ${ctx.window.note}${usd ? ", amounts in USD issued by GateHub at each day's DEX rate" : ""}`,
    },
    strip: stripOf(input.feesList, latestLedgerIndex(input.last, input.feesList)),
    openLedger: openLedgerOf(ctx, input.feeStats),
    validators: validatorsOf(ctx, input.validators),
    types: typesOf(ctx, input.types),
    metrics: metricsOf(ctx, input.metrics),
    fees: feesOf(ctx, input.feeDays),
    payments: paymentsOf(ctx, input.payments),
    exchanges: exchangesOf(ctx, input.exchanges),
    amm: ammOf(ctx, input.amm),
  };
  return { page, failures: ctx.failures };
}
