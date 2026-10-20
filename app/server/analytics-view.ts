// What the Analytics tab of the account page shows (spec 2.2, 3.1 and 3.3 to 3.11), worked out in the Worker from the data API's answers: the
// frame (the period, its buckets and the note that says what they are) and the cards that read one call each. Every builder is pure: no I/O, no
// clock, no `Intl`. Every sum, difference and quotient goes through bignumber.js and is handed on as a string, so no float reaches a string of the
// page, and the page draws only the strings these builders give it: the orientation of a pair and the choice of the API's field behind each of its
// cells are made here.
//
// A card's rows are aligned to the frame's buckets by the day their `date` starts with; a row outside the frame (an index that is behind makes the
// API's now a day after `T`) is ignored.
//
// It value-imports `app/domain/market-pair.ts` (issuer checksums, `ripple-address-codec`), so only the Worker, the scripts and the tests import this
// file: the page imports its types and nothing else.

import BigNumber from "bignumber.js";

import { analyticsPhrases, type AnalyticsPeriod, type AnalyticsPhrases, type AnalyticsWindow } from "../domain/analytics-params";
import { apiAssetText, type Asset } from "../domain/asset";
import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount, formatChange, formatCurrency, formatValue, shortAddress } from "../domain/format";
import { marketHref, naturalOrientation } from "../domain/market-pair";
import type { Native } from "../domain/parse/types";
import { groupCounts, typeGroups, typeGroupsNote } from "../domain/type-groups";
import { niceScale } from "../ui/charts/geometry";
import { bucketLabel } from "../ui/charts/labels";
import type { SmallMultiplesData, TimeAxis, TimeSeriesData } from "../ui/charts/types";
import type {
  AccountTxStatsRow,
  AccountValueRow,
  AnalyticsBalanceChanges,
  AnalyticsBalances,
  AnalyticsCounterparties,
  AnalyticsExchanges,
  BalanceChangeTotal,
  Page,
} from "./api-types";
import { divided, percentText } from "./exact";
import type { Network, NetworkId } from "./networks";

/** A card of the tab: what its call gave, or that it failed or came too late (spec 2.8). Each stands on its own. */
export type CardState<T> = ({ state: "ok" } & T) | { state: "failed" } | { state: "late" };

/** What a `StatTile` shows (spec 3.3). */
export interface AnalyticsTile {
  /** "16,787.15 XRP"; "—" when there is nothing to show or the account was deleted. */
  figure: string;
  /** "3 failed, fee still paid", "Deleted accounts hold nothing". */
  sub: string | null;
  /** E2's delta of the tile: the signed text ("+4.2%"), which way it points, and the words that name what it is over ("over the last 30 days"). */
  delta: { text: string; direction: "up" | "down" | "flat"; words: string } | null;
  /** The route the tile is made from, with the view's interval: "/v2/accounts/{a}/stats/value?interval=day". */
  source: string;
}

/** The window of the view and the words about it, which every card reads (spec 2.2). */
export interface AnalyticsFrame {
  period: AnalyticsPeriod;
  axis: TimeAxis;
  /** S: the first bucket, the `start` of every call. */
  start: string;
  phrase: AnalyticsPhrases;
  /** The whole period note. */
  note: string;
  deleted: boolean;
}

export interface ValueCard {
  tile: AnalyticsTile;
  chart: TimeSeriesData;
  notes: string[];
  source: string;
}
export interface SentCard {
  tile: AnalyticsTile;
  chart: TimeSeriesData;
  notes: string[];
  source: string;
}

/** The words about the DEX that two cards share: the hint of the "DEX trades" row, and the first sentence of the pairs' note (spec 3.10). */
export interface DexWording {
  hint: string;
  /** The first sentence of the pairs' note, or `null` when there is none. */
  lead: string | null;
}

/** A row of "Where balance changes come from" (spec 3.8), every figure as text. */
export interface SourceRow {
  id: "fees" | "dex" | "in" | "out" | "through" | "escrow" | "channels" | "other";
  name: string;
  hint: string;
  in: string;
  out: string;
  /** Signed, in a text colour. */
  net: string;
  changes: string;
  /** The row's in and out as raw decimals, for the bars, which share one scale (`ChangesCard.sources.max`); `null` for a row with no change. */
  bar: { in: string; out: string } | null;
}

/** Tile 3 (Fees paid), the money in and out, and where the balance changes come from: the three read call 3. */
export interface ChangesCard {
  tile: AnalyticsTile;
  money: {
    chart: TimeSeriesData;
    /** "+45.2K", "−38.1K" and "+7,100": the sums over the buckets, compact and signed; `null` when no bucket has a row that counts. */
    summary: { received: string; sent: string; net: string } | null;
    notes: string[];
    source: string;
  };
  sources: {
    title: string;
    rows: SourceRow[];
    /** The largest in or out of any row, a raw decimal: the one scale of the bars. */
    max: string;
    empty: string | null;
    note: string;
    source: string;
  };
}

/** Tile 4 (Counterparties) and the table of the largest, every cell as text. */
export interface CounterpartiesCard {
  tile: AnalyticsTile;
  rows: { account: string; sent: string; received: string; payments: string }[];
  note: string | null;
  empty: string | null;
  source: string;
}

export interface BalancesCard {
  chart: SmallMultiplesData | null;
  notes: string[];
  empty: string | null;
  source: string;
}

/** A pair of the DEX table in its natural orientation, with Bought and Sold already read from the API's field that is of the displayed base. */
export interface PairRow {
  /** The stored pair as the API writes it: a row's own key. */
  id: string;
  /** "XRP/USD". */
  label: string;
  /** "USD rhub8V…F3wq": each issued side's code and short issuer, base first. */
  issued: string[];
  /** The pair page in that orientation; `null` while the markets are off. */
  href: string | null;
  volume: string;
  trades: string;
  bought: string;
  sold: string;
}

export interface PairsCard {
  rows: PairRow[];
  notes: string[];
  empty: string | null;
  source: string;
}

/** What the tab hands the page (spec 1.5): the period, and one promise for the frame and for each card. None of them rejects. */
export interface AnalyticsData {
  period: AnalyticsPeriod;
  frame: Promise<CardState<AnalyticsFrame>>;
  value: Promise<CardState<ValueCard>>;
  sent: Promise<CardState<SentCard>>;
  changes: Promise<CardState<ChangesCard>>;
  counterparties: Promise<CardState<CounterpartiesCard>>;
  balances: Promise<CardState<BalancesCard>>;
  pairs: Promise<CardState<PairsCard>>;
}

const DASH = "—";
const ZERO = new BigNumber(0);

// ---- What every builder shares -----------------------------------------------------------------------------------------------------

/** A decimal string of the API as a number; one that is not a finite number is a card that cannot be built, never a "NaN" in the page. */
function numberOf(value: string, field: string): BigNumber {
  const number = new BigNumber(value);
  if (!number.isFinite()) throw new Error(`${field} is not a number: ${value}`);
  return number;
}

/** What a chart draws: its data without the token. */
type Drawn<T extends { token: string }> = Omit<T, "token">;

/** The data of a chart with its token, which is the hash of everything the chart draws, extras and words included. */
const tokened = <T extends object>(data: T): T & { token: string } => ({ ...data, token: tokenOf(data) });

/** The rows by the day their `date` starts with, laid on the frame's buckets: the row of each bucket, or `null` where it has none. */
function aligned<R extends { date: string }>(buckets: readonly string[], rows: readonly R[]): (R | null)[] {
  const byDay = new Map<string, R>();
  for (const row of rows) byDay.set(row.date.slice(0, 10), row);
  return buckets.map((bucket) => byDay.get(bucket) ?? null);
}

// ---- The frame ---------------------------------------------------------------------------------------------------------------------

/** A bucket's date, with its year or without: "Oct 20, 2025", "Oct 20" (a month is "Oct 2026" either way). */
const dateOf = (bucket: string, unit: TimeAxis["unit"], withYear: boolean): string => bucketLabel(bucket, unit, withYear ? "table" : "axis");

/** The period's own sentence (spec 2.2): what the buckets are, and from where. */
function periodSentence(window: AnalyticsWindow): string {
  const { period, unit, buckets, origin } = window;
  const first = buckets[0]!;
  const last = buckets[buckets.length - 1]!;

  if (period === "all") {
    const month = bucketLabel(first, "month", "axis");
    if (origin === "activation") return `Since ${month}, the month it was activated, per month (UTC).`;
    if (origin === "oldest") return `Since ${month}, the month of its oldest transaction in the index, per month (UTC).`;
    return "This month (UTC): the index has no transaction of this account yet.";
  }

  // The start shows its year only when it differs from the end's.
  const start = dateOf(first, unit, first.slice(0, 4) !== last.slice(0, 4));
  if (unit === "week") {
    return `The ${buckets.length} weeks from ${start} to the week of ${dateOf(last, unit, true)} (UTC, weeks from Monday), per week.`;
  }
  return `The ${buckets.length} days from ${start} to ${dateOf(last, unit, true)} (UTC), per day.`;
}

/**
 * The frame of the view for a window: its buckets and unit, the words that name its period, and the period note, which says in order what the
 * buckets are, that the last one is running, that the account was deleted (its history is All's), and that All is young (spec 2.2).
 */
export function analyticsFrame(window: AnalyticsWindow, opts: { deleted: boolean }): AnalyticsFrame {
  const { period, unit, buckets, start } = window;
  const note = [
    periodSentence(window),
    `The last ${unit} is counted up to now.`,
    ...(opts.deleted ? ["This account was deleted; All covers its whole history."] : []),
    ...(period === "all" && buckets.length < 3 ? ["It is younger than three months; 30 days and 90 days show it per day."] : []),
  ].join(" ");
  return {
    period,
    axis: { unit, buckets },
    start,
    phrase: analyticsPhrases(period, bucketLabel(start, "month", "axis")),
    note,
    deleted: opts.deleted,
  };
}

// ---- The account value -------------------------------------------------------------------------------------------------------------

/**
 * The change of the last value over the base, the first row of the window (spec 3.3): `(last ÷ base − 1) × 100` to 1 decimal, half up, with its sign
 * and the words that name the base. `null` when there is no row, when the base is 0, and when the last bucket is the base itself (one row, so
 * nothing to compare it with).
 */
function valueDelta(frame: AnalyticsFrame, values: readonly (BigNumber | null)[]): AnalyticsTile["delta"] {
  const { axis, phrase, period } = frame;
  const baseAt = values.findIndex((value) => value !== null);
  const last = values[values.length - 1];
  if (baseAt < 0 || baseAt === values.length - 1 || !last) return null;
  const base = values[baseAt]!;
  if (!base.gt(0)) return null;

  const { text, sign } = percentText(divided(last.minus(base).times(100), base, 1));
  const direction = sign === 0 ? "flat" : sign < 0 ? "down" : "up";
  const words =
    baseAt > 0 ? `since ${bucketLabel(axis.buckets[baseAt]!, axis.unit, "axis")}` : period === "all" ? phrase.title : `over the ${phrase.title}`;
  return { text, direction, words };
}

/**
 * The nice floor of the axis of a line that stays far above 0 (spec 3.4): ⌊min ÷ step⌋ × step, where the step is the nice step of a third of the
 * range, that is the smallest of {1, 2, 2.5, 5} × 10ⁿ at or above it. `niceScale` gives the smallest such step at or above a quarter of the
 * largest value it is given, so it is given 4⁄3 of the range, and the step it answers is read back as the decimal it is. `null` when the floor is
 * not above 0 (the axis then starts at 0, as every area does) or when the values are all equal.
 */
function valueFloor(values: readonly (BigNumber | null)[]): BigNumber | null {
  const present = values.filter((value): value is BigNumber => value !== null);
  if (present.length === 0) return null;
  const min = BigNumber.minimum(...present);
  const range = BigNumber.maximum(...present).minus(min);
  if (!range.gt(0) || !min.gt(0)) return null;

  const step = new BigNumber(String(niceScale([range.times(4).div(3).toNumber()]).step));
  const floor = min.idiv(step).times(step);
  return floor.gt(0) ? floor : null;
}

/**
 * The account value (spec 3.3 and 3.4): tile 1 and the line. Each bucket is its row's value, and a bucket without a row (the buckets before the
 * account had a balance) is `null`. The extra "Change" is the change from the bucket before, in percent, as text.
 */
export function valueCard(frame: AnalyticsFrame, page: Page<"rows", AccountValueRow>, native: Native): ValueCard {
  const { axis, phrase } = frame;
  const source = `/v2/accounts/{a}/stats/value?interval=${axis.unit}`;
  const values = aligned(axis.buckets, page.rows).map((row) => (row ? numberOf(row.account_value, "account_value") : null));

  const change = values.map((value, i) => {
    const before = i > 0 ? values[i - 1]! : null;
    if (!value || !before || !before.gt(0)) return null;
    return `${formatChange(divided(value.minus(before).times(100), before, 2).toFixed())}%`;
  });

  const floor = valueFloor(values);
  const chart = tokened<Drawn<TimeSeriesData>>({
    axis,
    series: [{ id: "value", label: "Account value", slot: 1, values: values.map((value) => value?.toFixed() ?? null) }],
    format: { kind: "value", unit: native },
    ...(floor ? { domain: { min: floor.toFixed() } } : {}),
    extras: [{ id: "change", label: "Change", values: change }],
    emptyText: `No balance in ${phrase.empty}`,
    forming: true,
  });

  const firstAt = values.findIndex((value) => value !== null);
  const notes = [
    `${native} plus every token held, valued at the end of each ${axis.unit}.`,
    ...(floor ? [`The axis starts at ${formatValue(floor.toFixed())} ${native}.`] : []),
    ...(firstAt > 0 ? [`No value before ${bucketLabel(axis.buckets[firstAt]!, axis.unit, "axis")}: the account had no balance until then.`] : []),
  ];

  const last = values[values.length - 1];
  const tile: AnalyticsTile = frame.deleted
    ? { figure: DASH, sub: "Deleted accounts hold nothing", delta: null, source }
    : { figure: last ? `${formatValue(last.toFixed())} ${native}` : DASH, sub: null, delta: valueDelta(frame, values), source };
  return { tile, chart, notes, source };
}

// ---- The transactions sent ---------------------------------------------------------------------------------------------------------

/** What a row counts as failed: every result code but `tesSUCCESS` (a failed transaction still paid its fee). */
function failedIn(row: AccountTxStatsRow): BigNumber {
  return Object.entries(row.result).reduce((sum, [code, count]) => (code === "tesSUCCESS" ? sum : sum.plus(count)), ZERO);
}

/**
 * The transactions the account sent (spec 3.3 and 3.5): tile 2 and the stacked columns, one series for each type group of the network. A bucket
 * without a row is 0 once the answer has a row in the frame, and every bucket is `null` when it has none. The extra "Failed" is the bucket's failed
 * count as grouped text; a bucket with one has the annotation "×", which the legend explains.
 */
export function sentCard(frame: AnalyticsFrame, page: Page<"rows", AccountTxStatsRow>, network: NetworkId): SentCard {
  const { axis, phrase } = frame;
  const source = `/v2/accounts/{a}/stats/transactions?interval=${axis.unit}`;
  const rows = aligned(axis.buckets, page.rows);
  const any = rows.some((row) => row !== null);

  // The counts of each bucket by group (all 0 for a bucket without a row), or `null` in every bucket when the frame has no row at all.
  const counts = rows.map((row) => (any ? groupCounts(network, row?.type ?? {}) : null));
  const totals = counts.map((count) => (count ? Object.values(count).reduce((sum, n) => sum.plus(n), ZERO) : null));
  const failed = rows.map((row) => (row ? failedIn(row) : ZERO));

  const chart = tokened<Drawn<TimeSeriesData>>({
    axis,
    series: typeGroups(network).map((group) => ({
      id: group.id,
      label: group.label,
      slot: group.slot,
      values: counts.map((count) => count?.[group.id] ?? null),
    })),
    format: { kind: "count" },
    totals: totals.map((total) => total?.toFixed() ?? null),
    annotations: failed.flatMap((count, bucket) => (count.gt(0) ? [{ bucket, symbol: "×", label: "has a failed transaction" }] : [])),
    extras: [{ id: "failed", label: "Failed", values: failed.map((count) => (any ? formatAmount(count.toFixed()) : null)) }],
    emptyText: `No transactions sent in ${phrase.empty}`,
    forming: true,
  });

  const sent = totals.reduce<BigNumber>((sum, total) => (total ? sum.plus(total) : sum), ZERO);
  const failedTotal = failed.reduce((sum, count) => sum.plus(count), ZERO);
  const tile: AnalyticsTile = {
    figure: formatAmount(sent.toFixed()),
    sub: failedTotal.gt(0) ? `${formatAmount(failedTotal.toFixed())} failed, fee still paid` : "none failed",
    delta: null,
    source,
  };
  return {
    tile,
    chart,
    notes: ["Transactions this account sent; a failed one still paid its fee.", typeGroupsNote(network)],
    source,
  };
}

// ---- The wording of the DEX ---------------------------------------------------------------------------------------------------------

/**
 * The hint of the "DEX trades" row and the first sentence of the pairs' note (spec 3.10). XRPL says AMM only while `AMM_DATA` is on, because the
 * index may hold some swaps and not others until its data is complete; Xahau has no AMM, whatever the switch. No call is made for it.
 */
export function dexWording(network: Pick<Network, "hasAmm" | "features">): DexWording {
  if (!network.hasAmm) return { hint: "order book", lead: "Order-book trades only; Xahau has no AMM." };
  return network.features.ammData
    ? { hint: "order book and AMM", lead: "Includes swaps against AMM pools." }
    : { hint: "on the DEX", lead: null };
}

// ---- Balance changes: money in and out, where they come from, and the fee ----------------------------------------------------------

/** The change types the money chart leaves out (spec 3.7): the fee, and what only passed through. A row without a type counts. */
const NOT_MONEY: ReadonlySet<string | undefined> = new Set(["transaction_cost", "intermediary"]);

/** A value as compact text with its sign (`+45.2K`, `−38.1K`); 0 has none. */
const signedCompact = (value: BigNumber): string => `${value.gt(0) ? "+" : ""}${compactNumber(value.toFixed())}`;

/** What a day's counted rows came to. */
interface DaySums {
  date: string;
  received: BigNumber;
  sent: BigNumber;
}

/**
 * The money in and out (spec 3.7): per bucket, Σ `in_value` and Σ `out_value` of the rows of every change type but the fee and the pass-through,
 * the unclassified ones included. A bucket without such a row is 0 once any bucket of the frame has one, and every bucket is `null` when none has.
 */
function moneyOf(frame: AnalyticsFrame, answer: AnalyticsBalanceChanges, native: Native, source: string): ChangesCard["money"] {
  const { axis, phrase } = frame;

  const days = new Map<string, DaySums>();
  for (const row of answer.rows) {
    if (NOT_MONEY.has(row.change_type)) continue;
    const date = row.date.slice(0, 10);
    const day = days.get(date) ?? { date, received: ZERO, sent: ZERO };
    day.received = day.received.plus(numberOf(row.in_value, "in_value"));
    day.sent = day.sent.plus(numberOf(row.out_value, "out_value"));
    days.set(date, day);
  }
  const buckets = aligned(axis.buckets, [...days.values()]);
  const any = buckets.some((day) => day !== null);
  const textOf = (text: (day: DaySums) => string): (string | null)[] => buckets.map((day) => (day ? text(day) : any ? "0" : null));

  const chart = tokened<Drawn<TimeSeriesData>>({
    axis,
    series: [
      { id: "received", label: "Received", slot: "up", values: textOf((day) => day.received.toFixed()) },
      { id: "sent", label: "Sent", slot: "down", values: textOf((day) => day.sent.toFixed()) },
    ],
    format: { kind: "value", unit: native },
    extras: [{ id: "net", label: "Net", values: textOf((day) => formatValue(day.received.minus(day.sent).toFixed(), { signed: true })) }],
    emptyText: `No money in or out in ${phrase.empty}`,
    forming: true,
  });

  const received = buckets.reduce((sum, day) => (day ? sum.plus(day.received) : sum), ZERO);
  const sent = buckets.reduce((sum, day) => (day ? sum.plus(day.sent) : sum), ZERO);
  const summary = any
    ? { received: signedCompact(received), sent: signedCompact(sent.negated()), net: signedCompact(received.minus(sent)) }
    : null;

  const notes = [
    `Payments, DEX trades, escrow, channels and other transactions that changed this account's balances, valued in ${native} at each day's rate. ` +
      "Fees, and amounts that only passed through, are left out.",
  ];
  return { chart, summary, notes, source };
}

/** What a set of totals came to: the sums of their in, out and net values, and of their change counts. */
interface Sums {
  in: BigNumber;
  out: BigNumber;
  net: BigNumber;
  count: BigNumber;
}

function summed(totals: readonly BalanceChangeTotal[]): Sums {
  return totals.reduce<Sums>(
    (sum, total) => ({
      in: sum.in.plus(numberOf(total.in_value, "in_value")),
      out: sum.out.plus(numberOf(total.out_value, "out_value")),
      net: sum.net.plus(numberOf(total.net_value, "net_value")),
      count: sum.count.plus(numberOf(String(total.count), "count")),
    }),
    { in: ZERO, out: ZERO, net: ZERO, count: ZERO },
  );
}

/** The rows of "Where balance changes come from" that name change types (spec 3.8), in their order; Other takes what none of them names. */
function sourceGroups(dex: DexWording): { id: Exclude<SourceRow["id"], "other">; name: string; hint: string; types: readonly string[] }[] {
  return [
    { id: "fees", name: "Fees", hint: "transaction cost, burned", types: ["transaction_cost"] },
    { id: "dex", name: "DEX trades", hint: dex.hint, types: ["exchange"] },
    { id: "in", name: "Payments in", hint: "received", types: ["payment_destination"] },
    { id: "out", name: "Payments out", hint: "sent", types: ["payment_source"] },
    { id: "through", name: "Passed through", hint: "as an intermediary", types: ["intermediary"] },
    { id: "escrow", name: "Escrow", hint: "locked, finished or cancelled", types: ["escrow_create", "escrow_finish", "escrow_cancel"] },
    { id: "channels", name: "Payment channels", hint: "funded or claimed", types: ["paychannel_fund", "paychannel_payout"] },
  ];
}

/**
 * Where the balance changes of the period come from (spec 3.8): the call's `totals` by what caused them. The seven named rows always show, with 0s
 * and no bar when they have no change, so that two periods read the same way; Other is the total without a type and any type not named, and shows
 * only with a change.
 */
function sourcesOf(
  frame: AnalyticsFrame,
  answer: AnalyticsBalanceChanges,
  dex: DexWording,
): Pick<ChangesCard["sources"], "rows" | "max" | "empty"> & { fees: Sums } {
  const groups = sourceGroups(dex);
  const named = new Set(groups.flatMap((group) => group.types));
  const entries: { id: SourceRow["id"]; name: string; hint: string; sums: Sums }[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    hint: group.hint,
    sums: summed(answer.totals.filter((total) => total.change_type !== undefined && group.types.includes(total.change_type))),
  }));
  const fees = entries[0]!.sums;

  const other = summed(answer.totals.filter((total) => total.change_type === undefined || !named.has(total.change_type)));
  if (other.count.gt(0)) entries.push({ id: "other", name: "Other", hint: "changes of other transaction types", sums: other });

  const rows = entries.map(({ id, name, hint, sums }): SourceRow => ({
    id,
    name,
    hint,
    in: formatValue(sums.in.toFixed()),
    out: formatValue(sums.out.toFixed()),
    net: formatValue(sums.net.toFixed(), { signed: true }),
    changes: formatAmount(sums.count.toFixed()),
    bar: sums.count.gt(0) ? { in: sums.in.toFixed(), out: sums.out.toFixed() } : null,
  }));
  const max = BigNumber.maximum(ZERO, ...entries.flatMap(({ sums }) => [sums.in, sums.out])).toFixed();
  return { rows, fees, max, empty: answer.totals.length === 0 ? `No balance changes in ${frame.phrase.empty}.` : null };
}

/**
 * Call 3 (spec 3.3, 3.7 and 3.8): tile 3, the fees paid (the `transaction_cost` total's out value, and its drops); the money in and out per
 * bucket; and the totals by cause.
 */
export function changesCard(frame: AnalyticsFrame, answer: AnalyticsBalanceChanges, native: Native, dex: DexWording): ChangesCard {
  const route = "/v2/accounts/{a}/analytics/balance_changes";
  const source = `${route}?interval=${frame.axis.unit}`;
  const { rows, fees, max, empty } = sourcesOf(frame, answer, dex);

  const drops = fees.out.shiftedBy(6).integerValue(BigNumber.ROUND_HALF_UP);
  const tile: AnalyticsTile = {
    figure: `${formatAmount(fees.out.toFixed())} ${native}`,
    sub: `${formatAmount(drops.toFixed())} drops, burned`,
    delta: null,
    source,
  };
  return {
    tile,
    money: moneyOf(frame, answer, native, source),
    sources: {
      title: `Where balance changes come from, ${frame.phrase.title}`,
      rows,
      max,
      empty,
      note:
        "Every balance change of the period, grouped by what caused it. " +
        "Passed through: payments that rippled through this account's trust lines on their way to someone else.",
      source: route,
    },
  };
}

// ---- The counterparties ------------------------------------------------------------------------------------------------------------

/** A value of the API as a table cell: grouped digits, and a dash for exactly 0. */
function valueOrDash(value: string, field: string): string {
  const number = numberOf(value, field);
  return number.isZero() ? DASH : formatValue(number.toFixed());
}

/** Tile 4 and the top counterparties (spec 3.3 and 3.9): by value sent plus received, as the API ranks them. */
export function counterpartiesCard(frame: AnalyticsFrame, answer: AnalyticsCounterparties): CounterpartiesCard {
  const source = "/v2/accounts/{a}/analytics/counterparties";
  const { total, count } = answer;
  const rows = answer.counterparties.map((counterparty) => ({
    account: counterparty.account,
    sent: valueOrDash(counterparty.sent_value, "sent_value"),
    received: valueOrDash(counterparty.received_value, "received_value"),
    payments: formatAmount(
      numberOf(String(counterparty.payments_sent), "payments_sent").plus(numberOf(String(counterparty.payments_received), "payments_received")).toFixed(),
    ),
  }));

  const note =
    total === 0
      ? null
      : total > count
        ? `The ${formatAmount(String(count))} largest of ${formatAmount(String(total))} counterparties, by value sent plus received.`
        : `All ${formatAmount(String(total))} counterparties, largest first.`;
  return {
    tile: { figure: formatAmount(String(total)), sub: "accounts it paid or was paid by", delta: null, source },
    rows,
    note,
    empty: total === 0 ? `No payments in ${frame.phrase.empty}.` : null,
    source,
  };
}

// ---- The balances ------------------------------------------------------------------------------------------------------------------

/**
 * The balance history (spec 3.6): a panel for each line in the API's order (the native line first, then by value), its balance in each bucket and
 * `null` before its first row. Every panel starts from zero on its own scale, so no panel is magnified differently from the others.
 */
export function balancesCard(frame: AnalyticsFrame, answer: AnalyticsBalances): BalancesCard {
  const { axis, phrase } = frame;
  const source = `/v2/accounts/{a}/analytics/balances?interval=${axis.unit}`;
  const { lines } = answer;
  if (lines.length === 0) return { chart: null, notes: [], empty: `No balances in ${phrase.empty}`, source };

  const panels = lines.map((line) => {
    const mine = answer.rows.filter((row) => row.currency === line.currency && (row.counterparty ?? "") === (line.counterparty ?? ""));
    const label = formatCurrency(line.currency);
    return {
      id: line.counterparty ? `${line.currency}.${line.counterparty}` : line.currency,
      label,
      ...(line.counterparty ? { sublabel: shortAddress(line.counterparty) } : {}),
      values: aligned(axis.buckets, mine).map((row) => (row ? numberOf(row.balance, "balance").toFixed() : null)),
      format: { kind: "amount" as const, unit: label },
    };
  });
  const chart = tokened<Drawn<SmallMultiplesData>>({ axis, panels, forming: true });

  // The native line is the one without a counterparty; it is first when the account has one.
  const native = lines.find((line) => !line.counterparty);
  const owed =
    lines.some((line) => numberOf(line.balance, "balance").lt(0)) ||
    panels.some((panel) => panel.values.some((value) => value !== null && new BigNumber(value).lt(0)));
  const notes = [
    "Each currency on its own scale, from zero; hover or focus one to read all of them on the same day.",
    ...(answer.lines_total > lines.length
      ? [
          `The ${formatAmount(String(lines.length))} largest of ${formatAmount(String(answer.lines_total))} balances` +
            (native ? `: ${formatCurrency(native.currency)} first, then by value now.` : ", by value now."),
        ]
      : []),
    ...(owed ? ["A balance below zero is what the account owes on that line."] : []),
  ];
  return { chart, notes, empty: null, source };
}

// ---- The DEX pairs -----------------------------------------------------------------------------------------------------------------

/** An asset of the API's fields: the native code alone, or a currency and its issuer. */
const assetOf = (currency: string, issuer: string | undefined): Asset => (issuer ? { currency, issuer } : { currency });

/**
 * DEX trading per pair (spec 3.10): each pair in E3's natural orientation, as every page of the program shows one. The API stores a pair in its own
 * order, so Bought and Sold of the displayed base are read from the field that is of it: `bought` and `sold` when the order is kept, and, when it is
 * inverted (the displayed base is the API's counter), `sold_counter` (what the account received for what it sold) and `bought_counter` (what it paid
 * for what it bought).
 */
export function pairsCard(
  frame: AnalyticsFrame,
  answer: AnalyticsExchanges,
  ctx: { net: NetworkId; native: Native; markets: boolean; dex: DexWording },
): PairsCard {
  const { net, native, markets, dex } = ctx;
  const source = "/v2/accounts/{a}/analytics/exchanges";

  const rows = answer.pairs.map((pair): PairRow => {
    const stored = { base: assetOf(pair.base_currency, pair.base_issuer), counter: assetOf(pair.counter_currency, pair.counter_issuer) };
    const { base, counter, inverted } = naturalOrientation(stored.base, stored.counter, native);
    const code = formatCurrency(base.currency);
    const [bought, sold] = inverted ? [pair.sold_counter, pair.bought_counter] : [pair.bought, pair.sold];
    const amount = (value: string, field: string) => (numberOf(value, field).isZero() ? DASH : `${formatAmount(value)} ${code}`);
    return {
      id: `${apiAssetText(stored.base)}/${apiAssetText(stored.counter)}`,
      label: `${code}/${formatCurrency(counter.currency)}`,
      issued: [base, counter].filter((side) => side.issuer).map((side) => `${formatCurrency(side.currency)} ${shortAddress(side.issuer!)}`),
      href: markets ? marketHref(net, base, counter) : null,
      volume: pair.native_volume === undefined ? DASH : formatValue(numberOf(pair.native_volume, "native_volume").toFixed()),
      trades: formatAmount(String(pair.count)),
      bought: amount(bought, inverted ? "sold_counter" : "bought"),
      sold: amount(sold, inverted ? "bought_counter" : "sold"),
    };
  });

  const { total, count } = answer;
  const notes =
    rows.length === 0
      ? []
      : [
          ...(dex.lead === null ? [] : [dex.lead]),
          "Bought and sold are of each pair's base as shown.",
          ...(total > count ? [`The ${formatAmount(String(count))} largest of ${formatAmount(String(total))} pairs, by volume in ${native}.`] : []),
        ];
  return { rows, notes, empty: rows.length === 0 ? `No DEX trades in ${frame.phrase.empty}.` : null, source };
}
