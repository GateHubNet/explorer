// What a collection's page shows, worked out in the Worker from the data API's answers (E8 spec 3.1): `nftCollectionPage` for `/{net}/nfts/{issuer}[/{taxon}]`,
// `collectionMarkerPage` for a page of the tab's list behind a marker, `collectionDaySeries` for the chart of the 30 days, and `collectionNotFound` for the words of the 404. No I/O, no
// clock, no `Intl`: each number of a page is the API's own text or made with BigNumber, so no float and no exponent reaches a label.
//
// The calls stand or fail on their own (spec 3.2). The collection is the page's own (`collection not found` is the loader's 404, anything else its 503), so the builder is given its
// answer whole. The daily figures (#2 and #3: the newest ledger, and the stats of the 30 days to it) feed the chart and the two 30-day stats together, and a failure of either leaves
// their cards `null` and puts `the daily figures` in `failures.daily`; the tab's list (#4) is a card of its own, `failures.tab`. The words of a failure are the `what` of the
// card's `SectionError` ("Couldn’t load {what}."): the loader holds the settled results, so it logs the reasons and marks the request degraded.
//
// It value-imports `network-view.ts` (the windows), `nfts-view.ts` (the rows of a sale), `nft-id.ts` (the flags' words; Worker-only) and the glyph characters of
// `app/ui/components/NftGlyph.tsx`, so only the Worker, the scripts and the tests import this file: the pages get the data it returns, and its types.

import type BigNumber from "bignumber.js";

import { compactNumber, formatAmount } from "../domain/format";
import { NFT_FLAG_LABELS } from "../domain/nft-id";
import { collectionHref, collectionLabel, COLLECTION_TABS, nftsHref, nftWords, NFT_MEASURES, type CollectionKey, type CollectionQuery, type CollectionTab, type NftMeasure } from "../domain/nft-params";
import { trailPaging, type Paging } from "../domain/paging";
import { formatDate } from "../domain/time-words";
import type { PeriodWindow } from "../domain/window";
import type { TimeSeriesData, ValueFormat } from "../ui/charts/types";
import { collectionGlyph, nftGlyph } from "../ui/components/NftGlyph";
import type { SegmentLink } from "../ui/components/SegmentedLinks";
import type { TabItem } from "../ui/components/Tabs";
import { anchorOrThrow } from "./anchor";
import type { LastValidated, Nft, NftCollectionAnswer, NftCollectionDay, NftCollectionDays, NftHolder, NftHoldersPage, NftPoint, NftSalesPage, NftsPage } from "./api-types";
import { coverageNote, type CoverageNoteText } from "./coverage";
import { BN, decimalOf, divided } from "./exact";
import { anchoredWindow, byDay, tokened } from "./network-view";
import type { Network } from "./networks";
import { counted, DASH, plain, salesCount, sharePercentTenth } from "./nft-format";
import { saleRows, type NftSaleRow } from "./nfts-view";

/** What the builders read of the network: its id (the words and the links), its name (a breadcrumb, a 404), its native currency, and its name in a sentence (`longName`). */
export type CollectionNet = Pick<Network, "id" | "name" | "native" | "longName">;

// ---- The rows -----------------------------------------------------------------------------------------------------------------------------------

/**
 * An NFT of the NFTs tab: every field is a string ready to show, but `nft.serial` (the page writes "#4,127", or the short id when there is none, on Xahau). `owner` is `null` for a
 * burned NFT (`burned`: the page tags it "burned") and for one whose owner the index does not name (the page writes a dash). `lastSale` is the price as `Amount` draws it, in the
 * price's own currency: a collection's NFTs have no converted amount (the page draws no "≈"). `flags` are the tags (`transferable`, `burnable`, `only XRP`, `mutable`, and `5% fee`),
 * `minted` the day of the mint or a dash when the mint is not in the index.
 */
export interface CollectionNftRow {
  /** The NFT's id: the row's own key. */
  key: string;
  nft: { id: string; serial?: number; glyph: string };
  owner: string | null;
  burned: boolean;
  sales: string;
  lastSale: { value: string; currency: string; issuer?: string } | null;
  flags: string[];
  minted: string;
}

/** An account of the Holders tab: `held` the NFTs it holds, `share` the part of the collection's supply that is, to one decimal (`43.9%`, `<0.1%`, a dash with no supply). */
export interface HolderRow {
  /** The holder's address: the row's own key. */
  key: string;
  owner: string;
  held: string;
  share: string;
}

/** A breadcrumb: the last one, the page itself, has no link. */
export interface CollectionCrumb {
  label: string;
  href?: string;
}

/** A stat of the six: the figure (`null` for the dash, while the daily figures failed or behind a marker) and the words under it (empty when it has none). */
export interface CollectionStat {
  figure: string | null;
  note: string;
}

/** The day of a mint and the transaction it links to. */
export interface CollectionMint {
  day: string;
  href: string;
}

export interface NftCollectionPageData {
  breadcrumb: CollectionCrumb[];
  /** `glyph` is the box's two characters in the case they have (the stylesheet draws capitals); `taxon` is left out on Xahau, and the dates when the collection has none (or behind a marker). */
  header: { glyph: string; heading: string; tag: string; issuer: string; taxon?: number; firstMint?: CollectionMint; lastMint?: CollectionMint };
  /** Behind a marker: every figure `null` and every note empty. */
  stats: { supply: CollectionStat; holders: CollectionStat; sales: CollectionStat; volume: CollectionStat; average30: CollectionStat; lowest30: CollectionStat };
  /** The 30 days of the measure and the card's title; `null` while the daily figures failed, or behind a marker. */
  chart: { data: TimeSeriesData; title: string } | null;
  /** The four measures, in the order of `NFT_MEASURES`; none behind a marker. */
  measures: SegmentLink[];
  /** Sales, the NFTs (URITokens) and Holders, as links; none behind a marker. */
  tabs: TabItem[];
  tab: CollectionTab;
  /** The tab's rows: `NftSaleRow`s (Sales), `CollectionNftRow`s (the NFTs) or `HolderRow`s (Holders); `null` while the list failed, or when none was asked for (an owner that is no address). */
  rows: NftSaleRow[] | CollectionNftRow[] | HolderRow[] | null;
  /**
   * The NFTs tab's GET form: what the "Held by an account" field holds (the text as typed), whether "Include burned" is checked, the message under the field, and the other fields of
   * the form (the view's `measure` and `tab`, in the canonical order, so that submitting the form keeps the view). `null` on the other tabs, and behind a marker.
   */
  form: { owner: string; burned: boolean; hidden: Array<[name: string, value: string]>; error?: string } | null;
  paging: Paging;
  /** The coverage note under the chart, and under the tab's list (spec 8). */
  notes: { chart: CoverageNoteText | null; tab: CoverageNoteText | null };
  /** The `what` of the `SectionError` of each card that failed: "the daily figures", and the tab's "the sales", "the NFTs" ("the URITokens"), "the holders". */
  failures: { daily?: string; tab?: string };
  /** What the tab says when its list has no row (`null` when it has rows, or no list): the owner filter's "No NFT of this collection is held by {owner}." among them. */
  empty: string | null;
  /** The heading of the page: the header's, and behind a marker "Older sales of rLULtF…mB3R · taxon 1". */
  title: string;
  /** A page behind a marker: the breadcrumb, the header without its dates, `back` and the tab's rows. */
  marker: boolean;
  /** "Back to the collection", to the tab's first page with its filter; `null` unless behind a marker. */
  back: { label: string; href: string } | null;
}

/** The tab's list as the loader reads it: the page of the call the tab asks (`nftCollectionSales`, `nftCollectionNfts` or `nftCollectionHolders`). */
export type CollectionList = NftSalesPage | NftsPage | NftHoldersPage;

/** The input of `nftCollectionPage`: the outcomes of the loader's calls (spec 3.2). */
export interface NftCollectionPageInput {
  net: CollectionNet;
  key: CollectionKey;
  query: CollectionQuery;
  /** The message under the owner field when `query.owner` is no classic address: `list` is then `null`. */
  ownerError?: string;
  /** #1, whole: a `collection not found` is the loader's 404 and anything else its 503. */
  collection: NftCollectionAnswer;
  /** #2 */
  last: PromiseSettledResult<LastValidated>;
  /** #3; `null`: not asked (#2 failed). */
  stats: PromiseSettledResult<NftCollectionDays> | null;
  /** #4; `null`: not asked (an owner that is no address). */
  list: PromiseSettledResult<CollectionList> | null;
}

/**
 * The input of `collectionMarkerPage`: #1 and #4 only, awaited. A bad owner behind a marker has no form to tell it in, so the loader decides it (a 404, as it does a bad issuer behind a
 * marker of the list) before any call.
 */
export interface CollectionMarkerInput {
  net: CollectionNet;
  key: CollectionKey;
  query: CollectionQuery;
  collection: NftCollectionAnswer;
  list: PromiseSettledResult<CollectionList>;
}

// ---- Words --------------------------------------------------------------------------------------------------------------------------------------

const DAILY_WHAT = "the daily figures";
const LOWEST_NOTE = "a sale, not an open offer";
const NO_SALE_NOTE = "no sale in 30 days";
const BACK_LABEL = "Back to the collection";

const MEASURE_LABELS: Record<NftMeasure, string> = { volume: "Volume", sales: "Sales", avg: "Average price", low: "Lowest price" };

/** The card's title for each measure (spec 3.1): the unit is the network's native currency, and a count has none. */
const CHART_TITLES: Record<NftMeasure, (native: string) => string> = {
  volume: (native) => `Sales volume per day, in ${native}, last 30 days`,
  sales: () => "Sales per day, last 30 days",
  avg: (native) => `Average sale price per day, in ${native}, last 30 days`,
  low: (native) => `Lowest sale price per day, in ${native}, last 30 days`,
};

/** The tab's labels, its failure's words, its coverage note's words and what an empty list says, in each network's words. */
function tabWords(net: CollectionNet, tab: CollectionTab): { label: string; what: string; coverage: string; older: string; empty: string } {
  const words = nftWords(net.id);
  switch (tab) {
    case "sales":
      return { label: "Sales", what: "the sales", coverage: words.salesHeading, older: "sales", empty: "No sale of this collection is in the index." };
    case "nfts":
      return { label: words.tokens, what: `the ${words.tokens}`, coverage: words.tokens, older: words.tokens, empty: `No ${words.token} of this collection is in the index.` };
    case "holders":
      return { label: "Holders", what: "the holders", coverage: "holders", older: "holders", empty: "No collection holder is in the index." };
  }
}

// ---- The chart ----------------------------------------------------------------------------------------------------------------------------------

type Figure = "volume" | "sales" | "avg" | "low" | "mints";

/** The five figures of a day, in the order of the extras: how each is read of a row of the stats, the value of a day without a row, and how it is formatted (`null` for a price: no sale, no price). */
const FIGURES: Record<Figure, { label: string; read: (row: NftCollectionDay) => string | null; quiet: string | null; format: (native: string) => ValueFormat }> = {
  sales: { label: "Sales", read: (row) => plain(row.sales_count), quiet: "0", format: () => ({ kind: "count" }) },
  volume: { label: "Volume", read: (row) => new BN(row.volume_native).toFixed(), quiet: "0", format: (native) => ({ kind: "amount", unit: native }) },
  avg: { label: "Average", read: (row) => (row.avg_price_native === undefined ? null : new BN(row.avg_price_native).toFixed()), quiet: null, format: (native) => ({ kind: "price", unit: native }) },
  low: { label: "Lowest", read: (row) => (row.min_price_native === undefined ? null : new BN(row.min_price_native).toFixed()), quiet: null, format: (native) => ({ kind: "price", unit: native }) },
  mints: { label: "Minted", read: (row) => plain(row.mints), quiet: "0", format: () => ({ kind: "count" }) },
};
const EXTRAS: readonly Figure[] = ["sales", "volume", "avg", "low", "mints"];

/**
 * The 30 days of a collection's stats for one measure (spec 3.1): one bucket for each day of `window`, the value the measure's figure of the day's row (`volume_native`, `sales_count`,
 * `avg_price_native`, `min_price_native`), the running day `forming`. A day without a row had no activity (the stats are worked out at the query, so no day is "not computed yet"): 0
 * sales and 0 volume, and no average and no lowest price (`null`). So has a day whose sales had no price in the native currency, as the API leaves the two prices out of it. The other
 * four figures are extras (Sales, Volume, Average, Lowest and Minted: the tooltip, the slider and the table's columns), the measure's own, which the series draws, left out of them. A
 * day outside the window has no bucket. `native` is the unit of the amounts.
 */
export function collectionDaySeries(days: readonly NftCollectionDay[], window: PeriodWindow, measure: NftMeasure, native: string): TimeSeriesData {
  const rows = byDay(days, (row) => row.date);
  const valuesOf = (figure: Figure): (string | null)[] =>
    window.buckets.map((bucket) => {
      const row = rows.get(bucket);
      return row === undefined ? FIGURES[figure].quiet : FIGURES[figure].read(row);
    });
  return tokened({
    axis: { unit: window.unit, buckets: window.buckets },
    series: [{ id: measure, label: FIGURES[measure].label, slot: 1 as const, values: valuesOf(measure) }],
    format: FIGURES[measure].format(native),
    forming: true,
    extras: EXTRAS.filter((figure) => figure !== measure).map((figure) => ({ id: figure, label: FIGURES[figure].label, values: valuesOf(figure), format: FIGURES[figure].format(native) })),
  });
}

// ---- The 30-day figures -------------------------------------------------------------------------------------------------------------------------

/**
 * How many of a day's sales had a price in the native currency: `volume_native ÷ avg_price_native`, rounded to a whole number. The data API's average is the volume over those sales
 * (its `sales_count` counts every sale, so it cannot be the divisor, spec rule 10), at most 6 decimals, which the division can make a little more or less than the whole number it is;
 * it is at least 1 and at most the day's sales. `null` for a day with no average, or an average of 0 (nothing to divide by).
 */
function ratedSalesOf(day: NftCollectionDay): BigNumber | null {
  const average = decimalOf(day.avg_price_native);
  if (average === null || !average.gt(0)) return null;
  const most = new BN(day.sales_count);
  if (most.lt(1)) return null;
  const rated = divided(new BN(day.volume_native), average, 0);
  return rated.lt(1) ? new BN(1) : rated.gt(most) ? most : rated;
}

/**
 * Average sale and lowest sale of the 30 days of `window` from the days of the stats (spec 3.1): the average is the sum of the volume over the sum of the rated sales of the days that
 * have an average, in whole units, half up, with the number of those sales in its note; the lowest is the lowest `min_price_native`. A dash for what has no sale to be made of, with
 * its reason in the note.
 */
function thirtyDays(net: CollectionNet, window: PeriodWindow, days: readonly NftCollectionDay[]): { average30: CollectionStat; lowest30: CollectionStat } {
  const rows = byDay(days, (row) => row.date);
  let volume = new BN(0);
  let rated = new BN(0);
  let sales = 0;
  let lowest: BigNumber | null = null;
  for (const bucket of window.buckets) {
    const row = rows.get(bucket);
    if (row === undefined) continue;
    sales += row.sales_count;
    const count = ratedSalesOf(row);
    if (count !== null) {
      volume = volume.plus(row.volume_native);
      rated = rated.plus(count);
    }
    const min = decimalOf(row.min_price_native);
    if (min !== null && (lowest === null || min.lt(lowest))) lowest = min;
  }
  const average = rated.gt(0) ? divided(volume, rated, 0) : null;
  return {
    average30: {
      figure: average === null ? DASH : `${formatAmount(average.toFixed())} ${net.native}`,
      note: average !== null ? salesCount(rated.toNumber()) : sales === 0 ? NO_SALE_NOTE : `${salesCount(sales)}, none with a daily ${net.native} rate`,
    },
    lowest30: { figure: lowest === null ? DASH : `${formatAmount(lowest.toFixed())} ${net.native}`, note: LOWEST_NOTE },
  };
}

// ---- The tab's rows -----------------------------------------------------------------------------------------------------------------------------

/**
 * The tags of an NFT's flags, in the order of the network's `NFT_FLAG_LABELS`, then its transfer fee as a percent (`5% fee` for 5000 of 1/100000, exactly): a URIToken has the
 * burnable flag alone, and no fee.
 */
function flagsOf(net: CollectionNet, nft: Nft): string[] {
  const tags = NFT_FLAG_LABELS[net.id].filter(({ mask }) => (nft.flags & mask) !== 0).map(({ tag }) => tag);
  if (net.id === "xrpl" && nft.transfer_fee !== undefined && nft.transfer_fee > 0) tags.push(`${new BN(nft.transfer_fee).shiftedBy(-3).toFixed()}% fee`);
  return tags;
}

function nftRow(net: CollectionNet, nft: Nft): CollectionNftRow {
  const sale = nft.last_sale;
  return {
    key: nft.nft_id,
    nft: { id: nft.nft_id, ...(nft.serial === undefined ? {} : { serial: nft.serial }), glyph: nftGlyph(nft.nft_id, nft.serial) },
    owner: nft.owner ?? null,
    burned: nft.burned,
    sales: counted(nft.sale_count),
    lastSale: sale === undefined ? null : { value: sale.amount, currency: sale.currency, ...(sale.amount_issuer === undefined ? {} : { issuer: sale.amount_issuer }) },
    flags: flagsOf(net, nft),
    minted: nft.minted === undefined ? DASH : formatDate(nft.minted.executed_time),
  };
}

function holderRow(holder: NftHolder, supply: number): HolderRow {
  return { key: holder.owner, owner: holder.owner, held: counted(holder.held), share: sharePercentTenth(plain(holder.held), plain(supply)) };
}

/** What the tab's page holds, by the tab: the loader's call for the tab gave it (`nftCollectionSales`, `nftCollectionNfts` or `nftCollectionHolders`). */
function tabRows(net: CollectionNet, tab: CollectionTab, list: CollectionList, supply: number): NftCollectionPageData["rows"] {
  switch (tab) {
    case "sales":
      return saleRows(net, (list as NftSalesPage).sales);
    case "nfts":
      return (list as NftsPage).nfts.map((nft) => nftRow(net, nft));
    case "holders":
      return (list as NftHoldersPage).holders.map((holder) => holderRow(holder, supply));
  }
}

// ---- The links ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The view of the tab that a link keeps: the tab and, on the NFTs tab, its filters. An owner that is no address is no filter (the loader asked no list for it), so the links leave it.
 */
function tabView(query: CollectionQuery, ownerError: string | undefined): Partial<CollectionQuery> {
  return { tab: query.tab, ...(query.owner === undefined || ownerError !== undefined ? {} : { owner: query.owner }), burned: query.burned };
}

/** The fields of the NFTs tab's form besides the owner and "Include burned": the view's `measure` and `tab`, as the canonical link writes them, read back from that link. */
function hiddenOf(net: CollectionNet, key: CollectionKey, query: CollectionQuery): Array<[name: string, value: string]> {
  const href = collectionHref(net.id, key, { measure: query.measure, tab: "nfts" });
  const at = href.indexOf("?");
  return at < 0 ? [] : Array.from(new URLSearchParams(href.slice(at + 1)), ([name, value]): [string, string] => [name, value]);
}

// ---- The pages ----------------------------------------------------------------------------------------------------------------------------------

const noStat = (): CollectionStat => ({ figure: null, note: "" });

/** The header, the breadcrumb and the collection's own four stats are the same for a page and for a page behind a marker, which has no dates and no stats. */
function headOf(net: CollectionNet, key: CollectionKey): Pick<NftCollectionPageData, "breadcrumb"> & { header: NftCollectionPageData["header"]; label: string } {
  const words = nftWords(net.id);
  const label = collectionLabel(key);
  return {
    label,
    breadcrumb: [{ label: net.name, href: `/${net.id}` }, { label: words.tokens, href: nftsHref(net.id) }, { label }],
    header: {
      glyph: collectionGlyph(key.issuer),
      heading: net.id === "xahau" ? `${words.tokens} of ${label}` : `Collection ${label}`,
      tag: words.collectionTag,
      issuer: key.issuer,
      ...(key.taxon === undefined ? {} : { taxon: key.taxon }),
    },
  };
}

const mintOf = (net: CollectionNet, point: NftPoint): CollectionMint => ({ day: formatDate(point.executed_time), href: `/${net.id}/tx/${point.tx_hash}` });

/** What the tab's list gave: its rows, its note, the Older marker and what it says when it is empty; or its failure. */
function tabOf(
  net: CollectionNet,
  query: CollectionQuery,
  supply: number,
  list: PromiseSettledResult<CollectionList> | null,
): { rows: NftCollectionPageData["rows"]; note: CoverageNoteText | null; next: string | undefined; empty: string | null; failure?: string } {
  const words = tabWords(net, query.tab);
  if (list === null) return { rows: null, note: null, next: undefined, empty: null };
  if (list.status === "rejected") return { rows: null, note: null, next: undefined, empty: null, failure: words.what };
  const rows = tabRows(net, query.tab, list.value, supply);
  const filtered = query.tab === "nfts" && query.owner !== undefined;
  const empty = rows !== null && rows.length === 0 ? (filtered ? `No ${nftWords(net.id).token} of this collection is held by ${query.owner}.` : words.empty) : null;
  return { rows, note: coverageNote(list.value.coverage, words.coverage), next: list.value.marker, empty };
}

/**
 * A collection's page (spec 3.1 and 3.2) from the outcomes of the loader's calls. A card whose call was rejected, or whose answer it cannot be made of, is `null` and has its words in
 * `failures`; the page stands on the others.
 */
export function nftCollectionPage(input: NftCollectionPageInput): NftCollectionPageData {
  const { net, key, query, ownerError } = input;
  const { collection } = input.collection;
  const words = nftWords(net.id);
  const head = headOf(net, key);
  const failures: NftCollectionPageData["failures"] = {};

  // #2 and #3: the window of the 30 days to the UTC day of the newest ledger, and the days in it. A newest ledger that has no time to take the window from fails the cards, as the
  // failed call does.
  let window: PeriodWindow | null = null;
  if (input.last.status === "fulfilled") {
    try {
      window = anchoredWindow(anchorOrThrow(input.last.value), "30d");
    } catch {
      // Only the anchor can throw here: `last_validated` is the one answer that no shape check has been over, and its ledger index or close time may be no number. The loader works out
      // the same window before it asks for the days and logs a bad anchor, so there is nothing to log twice; the cards are told as failed below.
    }
  }
  let chart: NftCollectionPageData["chart"] = null;
  let chartNote: CoverageNoteText | null = null;
  let thirty: Pick<NftCollectionPageData["stats"], "average30" | "lowest30"> = { average30: noStat(), lowest30: { figure: null, note: LOWEST_NOTE } };
  if (window !== null && input.stats !== null && input.stats.status === "fulfilled") {
    const { days, coverage } = input.stats.value;
    chart = { data: collectionDaySeries(days, window, query.measure, net.native), title: CHART_TITLES[query.measure](net.native) };
    chartNote = coverageNote(coverage, words.salesHeading);
    thirty = thirtyDays(net, window, days);
  } else {
    failures.daily = DAILY_WHAT;
  }

  // #4: the tab's list.
  const tab = tabOf(net, query, collection.supply, input.list);
  if (tab.failure !== undefined) failures.tab = tab.failure;

  const view = tabView(query, ownerError);
  const form: NftCollectionPageData["form"] =
    query.tab === "nfts" ? { owner: query.owner ?? "", burned: query.burned, hidden: hiddenOf(net, key, query), ...(ownerError === undefined ? {} : { error: ownerError }) } : null;

  return {
    breadcrumb: head.breadcrumb,
    header: {
      ...head.header,
      ...(collection.first_mint === undefined ? {} : { firstMint: mintOf(net, collection.first_mint) }),
      ...(collection.last_mint === undefined ? {} : { lastMint: mintOf(net, collection.last_mint) }),
    },
    stats: {
      supply: { figure: counted(collection.supply), note: `${counted(collection.minted)} minted · ${counted(collection.burned)} burned` },
      holders: { figure: counted(collection.holders), note: "accounts holding one or more" },
      sales: { figure: counted(collection.sales_count), note: "all time" },
      volume: { figure: `${compactNumber(collection.volume_native)} ${net.native}`, note: "all time, at daily rates" },
      ...thirty,
    },
    chart,
    measures: NFT_MEASURES.map((measure) => ({ label: MEASURE_LABELS[measure], href: collectionHref(net.id, key, { ...view, measure }), current: measure === query.measure })),
    tabs: tabsOf(net, key, query),
    tab: query.tab,
    rows: tab.rows,
    form,
    paging: trailPaging({ marker: query.marker, back: query.back, next: tab.next }, (to) => collectionHref(net.id, key, { ...view, ...to })),
    notes: { chart: chartNote, tab: tab.note },
    failures,
    empty: tab.empty,
    title: head.header.heading,
    marker: false,
    back: null,
  };
}

/** The three tabs as links: each is the tab's first page, and keeps the measure of the chart (the filters of the NFTs tab are the tab's own). */
function tabsOf(net: CollectionNet, key: CollectionKey, query: CollectionQuery): TabItem[] {
  return COLLECTION_TABS.map((id) => ({ id, label: tabWords(net, id).label, href: collectionHref(net.id, key, { measure: query.measure, tab: id }) }));
}

/**
 * A page of the tab's list behind a marker (spec 3.2): the breadcrumb, the header card without its dates, "Back to the collection" and the tab's rows, titled "Older sales of
 * rLULtF…mB3R · taxon 1". The loader awaits the two calls whole, so there is no failure to tell: a failed list is its 503.
 */
export function collectionMarkerPage(input: CollectionMarkerInput): NftCollectionPageData {
  const { net, key, query } = input;
  const head = headOf(net, key);
  const tab = tabOf(net, query, input.collection.collection.supply, input.list);
  const view = tabView(query, undefined);
  return {
    breadcrumb: head.breadcrumb,
    header: head.header,
    stats: { supply: noStat(), holders: noStat(), sales: noStat(), volume: noStat(), average30: noStat(), lowest30: noStat() },
    chart: null,
    measures: [],
    tabs: [],
    tab: query.tab,
    rows: tab.rows,
    form: null,
    paging: trailPaging({ marker: query.marker, back: query.back, next: tab.next }, (to) => collectionHref(net.id, key, { ...view, ...to })),
    notes: { chart: null, tab: tab.note },
    failures: tab.failure === undefined ? {} : { tab: tab.failure },
    empty: tab.empty,
    title: `Older ${tabWords(net, query.tab).older} of ${head.label}`,
    marker: true,
    back: { label: BACK_LABEL, href: collectionHref(net.id, key, view) },
  };
}

/** The words of the 404 of a collection the data API does not have: "We couldn't find NFT collection rLULtF…mB3R · taxon 1 on XRPL". */
export function collectionNotFound(net: Pick<CollectionNet, "id" | "name">, key: CollectionKey): string {
  return `We couldn't find ${nftWords(net.id).token} collection ${collectionLabel(key)} on ${net.name}`;
}
