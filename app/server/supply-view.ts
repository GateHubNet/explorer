// What the supply page shows, worked out in the Worker from the data API's answers (spec 4): the two cards of days (burned, and on Xahau minted), the snapshot, the bar and the tiles in
// `supplyPage`. No I/O, no clock, no `Intl`: the numbers of the API become text with `String(n)` and every sum, average and rounding goes through bignumber.js, so no float reaches
// a string of the page.

import BigNumber from "bignumber.js";

import { compactNumber, DECIMAL, formatAmount, formatUtcDay } from "../domain/format";
import { finePercent } from "../domain/percent";
import { utcDayOf, windowOf, type PeriodWindow } from "../domain/window";
import type { ShareData, TimeSeriesData } from "../ui/charts/types";
import { anchorOrThrow } from "./anchor";
import type { Coverage, FeeBucketRow, LastValidated, MintedPage, MintedPart, NetworkSupply, Page } from "./api-types";
import { coverageNote } from "./coverage";
import { divided } from "./exact";
import { byDay, reasonOf, tokened, type Part } from "./network-view";
import type { Network, NetworkId } from "./networks";

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

/** What the cards read of the network. */
type CardNetwork = Pick<Network, "native">;

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
  net: CardNetwork,
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
  net: CardNetwork,
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

// ---- The figures of the snapshot ------------------------------------------------------------------------------------------------------

/** The snapshot is stale when the newest ledger closed more than this many seconds after it (D7 writes one every hour: three missed ones). */
export const SUPPLY_STALE_SECONDS = 10_800;

const DASH = "—";
const SUFFIXES = ["", "K", "M", "B", "T"] as const;

/**
 * A figure in few characters for a tile's aside, a bar's caption and the description: from 1,000, two decimals and K, M, B or T, half up, the zeros kept (`99.99B`, `595.00M`, `268.97K`,
 * `2.32K`); below it, two decimals (`14.69`). It rolls to the next letter where the rounding reaches 1000 (`999,995` is `1.00M`, not `1000.00K`). What is not a number is returned as it
 * came. Unlike `compactNumber` (three significant digits: 100B for the total supply of XRP) it keeps the cents of a figure that is always read with them.
 */
export function compactFigure(value: string): string {
  if (!DECIMAL.test(value)) return value;
  const number = new BigNumber(value);
  const abs = number.abs();
  let rank = abs.lt(1e3) ? 0 : abs.lt(1e6) ? 1 : abs.lt(1e9) ? 2 : abs.lt(1e12) ? 3 : 4;
  let digits = abs.shiftedBy(-3 * rank).decimalPlaces(2, BigNumber.ROUND_HALF_UP);
  if (digits.gte(1000) && rank < SUFFIXES.length - 1) {
    rank += 1;
    digits = abs.shiftedBy(-3 * rank).decimalPlaces(2, BigNumber.ROUND_HALF_UP);
  }
  return `${number.isNegative() && !digits.isZero() ? "−" : ""}${digits.toFixed(2)}${SUFFIXES[rank]}`;
}

/** `part` as a percent of `whole` to one decimal, half up, exactly (`35.2%`, `97.0%`): the bar's captions. A dash for a `whole` not above 0, a `part` below 0 or what is not a number. */
export function captionPercent(part: string, whole: string): string {
  if (!DECIMAL.test(part) || !DECIMAL.test(whole)) return DASH;
  const share = new BigNumber(part);
  const total = new BigNumber(whole);
  if (share.lt(0) || !total.gt(0)) return DASH;
  return `${divided(share.times(100), total, 1).toFixed(1)}%`;
}

// ---- The page ---------------------------------------------------------------------------------------------------------------------------

export type TileId = "total" | "minted" | "burned" | "escrowed" | "circulating" | "amm" | "reserves";

/** One tile of the figures: the exact amount in two parts (`whole` and `fraction`, with its point, so that the page mutes the fraction), or `null` for both where it is not known. */
export interface SupplyTile {
  id: TileId;
  label: string;
  whole: string | null;
  fraction: string | null;
  currency: string;
  /** `≈ 99.99B`, at the right of the label. */
  aside: string | null;
  /** `= total supply − escrowed`. */
  formula: string | null;
  definition: string;
  /** A line under the definition: how many escrows, or why there is no figure. */
  sub: string | null;
  coverage: Note | null;
}

export interface SupplyPageData {
  network: { id: NetworkId; name: string; native: "XRP" | "XAH" };
  snapshot: { ledgerIndex: number; ledgerHref: string; closeTime: string; stale: { hours: number } | null };
  intro: string;
  bar: {
    title: string;
    text: string;
    data: ShareData;
    /** XRPL: the line over the bar that says its sliver of burned XRP. */
    burned: RichText | null;
    /** The bracket under the circulating segment: where it starts (a fraction of the bar) and what it says. */
    part: { start: number; text: RichText } | null;
    coverage: Note | null;
  };
  tiles: SupplyTile[];
  burnedCard: BurnedCard;
  /** `null` where the snapshot has no `minted`. */
  mintedCard: MintedCard | null;
  /** For the meta tags. */
  description: string;
}

/** What the loader settled, besides the snapshot: the newest ledger (A), the fees of the 90 days (F), and where the network mints the minted days (M). */
export interface SupplyCards {
  anchor: PromiseSettledResult<LastValidated>;
  fees: PromiseSettledResult<Page<"rows", FeeBucketRow>>;
  minted?: PromiseSettledResult<MintedPage>;
}

/** What `supplyPage` reads of the network. */
type SupplyNetwork = Pick<Network, "id" | "name" | "native" | "hasAmm">;

/** The total supply XRP was created with: the whole of the bar on the XRP Ledger, whose burned segment is what the total lost. */
const CAP = "100000000000";

/** `new BigNumber(v).toFormat(6)` in two: `99,985,312,374` and `.716318`. */
function figureOf(value: string): { whole: string; fraction: string } {
  const text = new BigNumber(value).toFormat(6);
  const point = text.indexOf(".");
  return { whole: text.slice(0, point), fraction: text.slice(point) };
}

const noteOf = (part: { coverage?: Coverage } | undefined, words: string): Note | null => (part?.coverage ? coverageNote(part.coverage, words) : null);
const plural = (count: number, one: string, other: string): string => `${formatAmount(String(count))} ${count === 1 ? one : other}`;

/** Text with its neighbouring strings made one: what the pieces joined by " · " read as. */
function joinText(lead: string, pieces: readonly RichText[]): RichText {
  const out: (string | { b: string })[] = [lead];
  const add = (item: string | { b: string }) => {
    const last = out[out.length - 1];
    if (typeof item === "string" && typeof last === "string") out[out.length - 1] = last + item;
    else out.push(item);
  };
  pieces.forEach((piece, i) => {
    if (i > 0) add(" · ");
    piece.forEach(add);
  });
  return out;
}

/** The hours the newest ledger closed after the snapshot, when that is more than `SUPPLY_STALE_SECONDS`; `null` without a readable anchor. */
function staleOf(anchor: PromiseSettledResult<LastValidated>, supply: NetworkSupply): { hours: number } | null {
  if (anchor.status !== "fulfilled") return null;
  let closed: number;
  try {
    closed = anchorOrThrow(anchor.value).closeTime;
  } catch {
    // The cards say it: an anchor that is no time fails them, and there is nothing to compare.
    return null;
  }
  const behind = closed - Math.floor(Date.parse(supply.close_time) / 1000);
  return behind > SUPPLY_STALE_SECONDS ? { hours: Math.floor(behind / 3600) } : null;
}

/**
 * The supply page (spec 4, 5.1 to 5.3): the snapshot `supply` and the cards of days, as the page draws them. `cap` (the network's total supply was 100 billion XRP: the XRP Ledger and its
 * testnet) decides the bar and the first tiles; the rest comes from the answer, so a part it leaves out is left out of the page (`amm`, `minted`) or says so (`reserves`). Every figure is
 * exact text. `failures` are the cards that failed, for the loader to log.
 */
export function supplyPage(net: SupplyNetwork, supply: NetworkSupply, cards: SupplyCards): { page: SupplyPageData; failures: Failure[] } {
  const failures: Failure[] = [];
  const { native } = net;
  const cap = net.id === "xrpl";
  const burnedCard = burnedCardOf(net, cards.anchor, cards.fees, failures);
  const mintedCard = supply.minted
    ? mintedCardOf(net, supply.minted, cards.anchor, cards.minted ?? { status: "rejected", reason: new Error("the minted days were not asked for") }, failures)
    : null;

  // The bar: the burned XRP, the escrowed and the circulating on the XRP Ledger, the last two of the total on the others.
  const rowTotal = cap ? CAP : supply.total;
  const segment = (id: string, label: string, slot: 1 | 2 | 3, value: string) => ({
    id,
    label,
    slot,
    value,
    caption: `${compactFigure(value)} ${native} · ${captionPercent(value, rowTotal)}`,
    share: `${finePercent(value, rowTotal)} ${cap ? `of the 100 billion ${native}` : "of the total supply"}`,
  });
  const burned = supply.burned.amount;
  const segments = [
    ...(cap ? [segment("burned", "Burned", 2, burned)] : []),
    segment("escrowed", "Escrowed", 3, supply.escrowed.amount),
    segment("circulating", "Circulating supply", 1, supply.circulating.amount),
  ];
  const before = new BigNumber(cap ? burned : 0).plus(supply.escrowed.amount);
  const pieces: RichText[] = [];
  if (supply.amm) {
    pieces.push([{ b: `${compactFigure(supply.amm.amount)} ${native}` }, ` in AMM pools (${finePercent(supply.amm.amount, supply.circulating.amount)} of circulating)`]);
  }
  if (supply.reserves) {
    pieces.push([{ b: `${compactFigure(supply.reserves.amount)} ${native}` }, ` held as account reserves (${finePercent(supply.reserves.amount, supply.circulating.amount)} of circulating)`]);
  }
  if (!net.hasAmm) pieces.push([`no AMM on ${net.name}`]);

  // The tiles, in the order of the boards.
  const tile = (id: TileId, label: string, value: string | null, rest: Partial<Pick<SupplyTile, "formula" | "sub" | "coverage">> & { definition: string }): SupplyTile => {
    const figure = value === null ? null : figureOf(value);
    return {
      id,
      label,
      whole: figure?.whole ?? null,
      fraction: figure?.fraction ?? null,
      currency: native,
      aside: value === null ? null : `≈ ${compactFigure(value)}`,
      formula: rest.formula ?? null,
      definition: rest.definition,
      sub: rest.sub ?? null,
      coverage: rest.coverage ?? null,
    };
  };
  const tiles: SupplyTile[] = [
    tile("total", "Total supply", supply.total, {
      formula: cap ? `= ${formatAmount(CAP)} − burned` : null,
      definition: cap ? `All the ${native} that exists: 100 billion ${native} less what has been burned.` : `All the ${native} that exists. No 100 billion cap: ${net.name}'s supply grows by minting.`,
    }),
  ];
  if (supply.minted && mintedCard) {
    tiles.push(
      tile("minted", "Minted, last 90 days", mintedCard.state === "ok" ? mintedCard.total : null, {
        definition: `New ${native} from rewards, Import and GenesisMint.`,
        sub: mintedCard.state === "ok" ? null : "Couldn't load the minted days.",
        coverage: noteOf(supply.minted, "mints"),
      }),
    );
  }
  tiles.push(
    tile("burned", "Burned", burned, { definition: `${native} destroyed as transaction fees, since the first ledger.`, coverage: noteOf(supply.burned, "fees") }),
    tile("escrowed", "Escrowed", supply.escrowed.amount, {
      definition: `${native} held in escrows.`,
      sub: `in ${plural(supply.escrowed.escrows, "escrow", "escrows")}`,
      coverage: noteOf(supply.escrowed, "escrows"),
    }),
    tile("circulating", "Circulating supply", supply.circulating.amount, {
      formula: "= total supply − escrowed",
      definition: "The total supply less what is escrowed.",
      coverage: noteOf(supply.circulating, "escrows"),
    }),
  );
  if (supply.amm) {
    tiles.push(
      tile("amm", "In AMM pools", supply.amm.amount, {
        definition: `${native} held by ${plural(supply.amm.pools, "AMM pool", "AMM pools")}. Part of the circulating supply.`,
        coverage: noteOf(supply.amm, "pool changes"),
      }),
    );
  }
  const reserves = supply.reserves;
  tiles.push(
    tile("reserves", "Account reserves", reserves?.amount ?? null, {
      formula: reserves ? `= ${formatAmount(String(reserves.accounts))} × ${formatAmount(reserves.base)} + ${formatAmount(String(reserves.owner_count))} × ${formatAmount(reserves.increment)}` : null,
      definition: reserves
        ? `${native} accounts must keep: ${formatAmount(reserves.base)} ${native} each, and ${formatAmount(reserves.increment)} ${native} for every object they own. Part of the circulating supply.`
        : `${native} that accounts must keep as reserves. Part of the circulating supply.`,
      sub: reserves ? null : "Not known at this ledger.",
      coverage: noteOf(reserves, "account changes"),
    }),
  );

  const description =
    `${native} supply at ledger #${formatAmount(String(supply.ledger_index))}: ${compactFigure(supply.total)} total, ` +
    `${supply.minted ? `${compactFigure(supply.minted.amount)} minted, ` : ""}${compactFigure(burned)} burned, ${compactFigure(supply.escrowed.amount)} escrowed, ${compactFigure(supply.circulating.amount)} circulating.`;

  const page: SupplyPageData = {
    network: { id: net.id, name: net.name, native },
    snapshot: {
      ledgerIndex: supply.ledger_index,
      ledgerHref: `/${net.id}/ledger/${supply.ledger_index}`,
      closeTime: supply.close_time,
      stale: staleOf(cards.anchor, supply),
    },
    intro: cap
      ? `How much ${native} exists, how much is burned and escrowed, and how much circulates.`
      : `How much ${native} exists, how much is minted, burned and escrowed, and how much circulates.`,
    bar: {
      title: cap ? `Where the 100 billion ${native} are` : `Where the ${native} are`,
      text: cap
        ? `${formatAmount(CAP)} ${native} were created in the first ledger and no more can be made. Every transaction burns a little as its fee, so the total supply only shrinks.`
        : `${net.name} has no 100 billion cap: its supply grows by minting, through rewards, Import and GenesisMint, and shrinks a little as fees are burned. The bar is the total supply.`,
      data: tokened({ rows: [{ id: "supply", label: "Supply", total: rowTotal, segments }], unit: native }),
      burned: cap ? [{ b: `Burned ${compactFigure(burned)} ${native}` }, ` · ${finePercent(burned, rowTotal)} of the 100 billion, a sliver at this scale`] : null,
      part: pieces.length > 0 ? { start: new BigNumber(rowTotal).gt(0) ? before.div(rowTotal).toNumber() : 0, text: joinText("Part of circulating: ", pieces) } : null,
      coverage: noteOf(supply.escrowed, "escrows"),
    },
    tiles,
    burnedCard,
    mintedCard,
    description,
  };
  return { page, failures };
}
