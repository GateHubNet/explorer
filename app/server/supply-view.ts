// What the supply page shows, worked out in the Worker from the data API's answers (spec 4): the two cards of days (burned, and on Xahau minted) in this part, the snapshot, the bar and the
// tiles in `supplyPage`. No I/O, no clock, no `Intl`: the numbers of the API become text with `String(n)` and every sum, average and rounding goes through bignumber.js, so no float reaches
// a string of the page.

import BigNumber from "bignumber.js";

import { compactNumber, formatAmount, formatUtcDay } from "../domain/format";
import { utcDayOf, windowOf, type PeriodWindow } from "../domain/window";
import type { TimeSeriesData } from "../ui/charts/types";
import { anchorOrThrow } from "./anchor";
import type { FeeBucketRow, LastValidated, MintedPage, MintedPart, Page } from "./api-types";
import { coverageNote } from "./coverage";
import { divided } from "./exact";
import { byDay, reasonOf, tokened, type Part } from "./network-view";
import type { Network } from "./networks";

/** Words with some of them bold: a string is plain text and `{ b }` is drawn in `<b>`. */
export type RichText = readonly (string | { b: string })[];
/** What a page says of an incomplete coverage (`CoverageNote` draws it). */
export type Note = NonNullable<ReturnType<typeof coverageNote>>;
/** A part of the page that failed, for the loader to log: its name and the error. */
export interface Failure {
  part: string;
  error: unknown;
}
/** A chart of days with the words that sum it up, and the exact sum of its window (today included). */
export interface SupplyChart {
  data: TimeSeriesData;
  summary: RichText;
  total: string;
}
export type BurnedCard = Part<SupplyChart>;
export type MintedCard = Part<SupplyChart & { since: string; notes: readonly string[]; coverage: Note | null }>;

/** What the builders read of the network. */
type SupplyNetwork = Pick<Network, "native">;

const ZERO = new BigNumber(0);

/**
 * A card from its calls' outcomes: whatever `build` throws (a rejected call, an anchor that is no time, an answer it cannot use) fails the card and is reported with the card's name, and one
 * broken card does not make a 500 of the page (the way `settle` of the network page does it).
 */
function cardOf<X extends object>(failures: Failure[], part: string, build: () => X): Part<X> {
  try {
    return { state: "ok", ...build() };
  } catch (error) {
    failures.push({ part, error });
    return { state: "failed", reason: reasonOf(error) };
  }
}

/** The value of a call that was fulfilled, else its error thrown. */
function settledValue<V>(result: PromiseSettledResult<V>): V {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/** The 90 days to the UTC day of the anchor's close time, today last: what both cards are over (the network page's `90d`, so that the fees call is the same). */
function windowOfAnchor(anchor: PromiseSettledResult<LastValidated>): PeriodWindow {
  return windowOf(utcDayOf(anchorOrThrow(settledValue(anchor)).closeTime), "90d");
}

/** The days of the window that have a value, summed. The newest bucket is today so far; the average and the highest are over the full days before it. */
function sumsOf(w: PeriodWindow, values: readonly (BigNumber | null)[]) {
  let total = ZERO;
  let full = ZERO;
  let fullDays = 0;
  let highest: { day: string; value: BigNumber } | null = null;
  for (const [i, value] of values.entries()) {
    if (value === null) continue;
    total = total.plus(value);
    if (i === w.buckets.length - 1) continue;
    full = full.plus(value);
    fullDays += 1;
    // The earliest day wins a tie.
    if (highest === null || value.gt(highest.value)) highest = { day: w.buckets[i]!, value };
  }
  return { total, average: fullDays > 0 ? divided(full, new BigNumber(fullDays), 6) : null, highest };
}

const exact = (value: BigNumber | null): string | null => (value === null ? null : value.toFixed());

/**
 * The burned card (spec 5.4): the fees of each of the 90 days as one series, with the words that sum them up. A fee row's `total` is a JSON number, and becomes the exact text of its digits. A
 * rejected `anchor` or `fees`, or an anchor that is no time, fails the card, with a `Failure` named `burned`.
 */
export function burnedCardOf(
  net: SupplyNetwork,
  anchor: PromiseSettledResult<LastValidated>,
  fees: PromiseSettledResult<Page<"rows", FeeBucketRow>>,
  failures: Failure[],
): BurnedCard {
  return cardOf(failures, "burned", () => {
    const w = windowOfAnchor(anchor);
    const rows = byDay(settledValue(fees).rows, (row) => row.date);
    const amounts = w.buckets.map((bucket) => {
      const row = rows.get(bucket);
      return row ? new BigNumber(String(row.total)) : null;
    });
    const { total, average, highest } = sumsOf(w, amounts);
    const native = net.native;
    const data: Omit<TimeSeriesData, "token"> = {
      axis: { unit: "day", buckets: w.buckets },
      series: [{ id: "burned", label: "Burned", heading: `Burned, ${native}`, slot: 1, values: amounts.map(exact) }],
      format: { kind: "amount", unit: native },
      forming: true,
    };
    const summary: RichText = [
      "Last 90 days: ",
      { b: `${compactNumber(total.toFixed())} ${native}` },
      average === null || highest === null
        ? " burned as fees."
        : ` burned as fees, ${compactNumber(average.toFixed())} ${native} a day on average. Highest: ${compactNumber(highest.value.toFixed())} ${native} on ${formatUtcDay(highest.day)}.`,
    ];
    return { data: tokened(data), summary, total: total.toFixed() };
  });
}

/** What Rewards, Import and GenesisMint put on the stack, in its order and slots (the board's). */
const SOURCES = [
  { id: "rewards", label: "Rewards", slot: 1 },
  { id: "import", label: "Import", slot: 3 },
  { id: "genesis_mint", label: "GenesisMint", slot: 5 },
] as const;

/**
 * The minted card (spec 5.5, Xahau): the native currency created on each of the 90 days by source, stacked, with the words that sum them up, the snapshot's own sentence of what the index holds,
 * the note on the three sources and the coverage of the days. A day before the first row of the page (outside the coverage of the mints) has no value. A rejected `anchor` or `page`, or an anchor
 * that is no time, fails the card, with a `Failure` named `minted`.
 */
export function mintedCardOf(
  net: SupplyNetwork,
  minted: MintedPart,
  anchor: PromiseSettledResult<LastValidated>,
  page: PromiseSettledResult<MintedPage>,
  failures: Failure[],
): MintedCard {
  return cardOf(failures, "minted", () => {
    const w = windowOfAnchor(anchor);
    const answer = settledValue(page);
    const rows = byDay(answer.rows, (row) => row.date);
    const days = w.buckets.map((bucket) => rows.get(bucket) ?? null);
    const amounts = days.map((row) => (row ? new BigNumber(row.amount) : null));
    const { total, average } = sumsOf(w, amounts);
    const sourceTotals = SOURCES.map(({ id }) => days.reduce((sum, row) => (row ? sum.plus(row[id]) : sum), ZERO));
    const native = net.native;
    const data: Omit<TimeSeriesData, "token"> = {
      axis: { unit: "day", buckets: w.buckets },
      series: SOURCES.map(({ id, label, slot }) => ({ id, label, slot, values: days.map((row) => row?.[id] ?? null) })),
      format: { kind: "amount", unit: native },
      totals: days.map((row) => row?.amount ?? null),
      forming: true,
    };
    const [rewards, imported, genesis] = sourceTotals.map((sum) => compactNumber(sum.toFixed())) as [string, string, string];
    const summary: RichText = [
      "Last 90 days: ",
      { b: `${compactNumber(total.toFixed())} ${native}` },
      ` minted (Rewards ${rewards}, Import ${imported}, GenesisMint ${genesis})${average === null ? "." : `, ${compactNumber(average.toFixed())} a day on average.`}`,
    ];
    const from = minted.coverage?.from_ledger_index;
    const since =
      `${from === undefined ? "In the index" : `Since ledger #${formatAmount(String(from))}`}: ${formatAmount(minted.amount)} ${native} minted: ` +
      `${formatAmount(minted.rewards)} as rewards, ${formatAmount(minted.import)} by Import, ${formatAmount(minted.genesis_mint)} by GenesisMint.`;
    return {
      data: tokened(data),
      summary,
      total: total.toFixed(),
      since,
      notes: [`Rewards are paid to accounts that claim them. Import mints ${native} for XRP burned on XRPL. GenesisMint is minted by governance.`],
      coverage: coverageNote(answer.coverage, "mints"),
    };
  });
}
