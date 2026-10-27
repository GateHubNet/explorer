// What the NFT list pages show, worked out in the Worker from the data API's answers (E8 spec 2.1 to 2.3): the list at `/{net}/nfts` (`nftsListPage`; `nftsMarkerPage` for a page
// behind a marker, which is the collections table alone), the older sales at `/{net}/nfts/sales` (`nftSalesPage`), and the rows of a sale (`saleRows`), which a collection's Sales
// tab draws too. No I/O, no clock, no `Intl`: each number of a page is the API's own text or made with BigNumber, so no float and no exponent reaches a label.
//
// The cards of the list stand or fail on their own (spec 2.2). A call that was rejected (a `TooLate` included) leaves its card `null` and puts its words in `failures`, which are the
// `what` of the card's `SectionError` ("Couldn’t load {what}."); the loader holds the settled results, so it logs the reasons and marks the request degraded. The live volume feeds two
// cards (the tiles and the top collections) and so tells two failures. The chart is drawn over `anchoredWindow(anchorOrThrow(last), "30d")`, the window the loader asks the daily
// volume for.
//
// It value-imports `network-view.ts` (the windows) and the glyph characters of `app/ui/components/NftGlyph.tsx`, so only the Worker, the scripts and the tests import this file: the
// pages get the data it returns, and its types.

import { compactNumber, formatAmount, formatCurrency, shortAddress } from "../domain/format";
import {
  collectionHref,
  collectionLabel,
  nftsHref,
  nftSalesHref,
  nftWords,
  NFT_PERIODS,
  NFT_SORTS,
  type CollectionKey,
  type NftPeriod,
  type NftSalesQuery,
  type NftsQuery,
  type NftSort,
} from "../domain/nft-params";
import { trailPaging, type Paging } from "../domain/paging";
import { formatDate } from "../domain/time-words";
import { pendingCount, pendingNote, type PeriodWindow } from "../domain/window";
import type { BarListData, TimeSeriesData } from "../ui/charts/types";
import { collectionGlyph, nftGlyph } from "../ui/components/NftGlyph";
import type { SegmentLink } from "../ui/components/SegmentedLinks";
import { anchorOrThrow } from "./anchor";
import type { LastValidated, NftCollection, NftCollectionsPage, NftSale, NftSalesPage, NftVolume, NftVolumeComponent, NftVolumeRow } from "./api-types";
import { coverageNote, type CoverageNoteText } from "./coverage";
import { BN, decimalOf, divided } from "./exact";
import { anchoredWindow, byDay, tokened } from "./network-view";
import type { Network } from "./networks";
import { convertedOf, counted, DASH, plain, queryPairsOf, salesCount, sharePercentTenth } from "./nft-format";
import { unixOf } from "./validator-facts";

const ZERO = new BN(0);

/** What the builders read of the network: its id (the words and the links), its native currency, and its name in a sentence (`longName`: "the XRP Ledger", "XRPL Testnet"). */
export type NftsNet = Pick<Network, "id" | "native" | "longName">;

// ---- The rows -----------------------------------------------------------------------------------------------------------------------------------

/**
 * A sale, a row of the recent sales and of a collection's Sales tab: every field is a string ready to show, but `time` (unix seconds: the page writes the UTC time and the age) and
 * `nft.serial` (the page writes "#4,127", or the short id when there is none, on Xahau).
 */
export interface NftSaleRow {
  /** `tx_hash:event_index`: the row's own key. */
  key: string;
  time: number;
  /** The transaction the time links to. */
  txHash: string;
  /** `glyph` is the box's two characters in the case they have (the stylesheet draws capitals). */
  nft: { id: string; serial?: number; glyph: string };
  collection: { label: string; href: string };
  /** What the buyer paid, as `Amount` draws it, in the price's own currency. */
  price: { value: string; currency: string; issuer?: string };
  /** `≈ 96 XRP` under a price in a token, when the data API converts it at the day's rate. */
  converted?: string;
  seller: string;
  buyer: string;
  mode: "direct" | "brokered";
  /** The royalty estimate with its currency (`62.5 XRP`), `null` for the dash: Xahau has none, and an XRPL sale has none when the API has no estimate. */
  royalty: string | null;
}

/** A row of the collections table; `issuer` is the short address the cell links to the collection with, `href`. */
export interface CollectionRow {
  /** The collection's key in a path (`issuer/taxon`, `issuer`): the row's own key. */
  key: string;
  glyph: string;
  issuer: string;
  href: string;
  /** `taxon 1`, or `every URIToken of this issuer`. */
  under: string;
  supply: string;
  holders: string;
  /** `10,000 / 0`. */
  mintedBurned: string;
  sales: string;
  /** `18.4M XRP`. */
  volume: string;
  /** The day of the last mint, `—` for a collection whose mints are before the index starts. */
  lastMint: string;
}

/** A tile of the totals: the figure (`null` for the dash, while the card failed) and the words under it (empty when it has none). */
export interface NftTile {
  figure: string | null;
  note: string;
}

/** The link of a sort header: the sort, where the link leads (the flipped order for the current sort), and what the header says of itself. */
export interface NftSortLink {
  sort: NftSort;
  href: string;
  ariaSort: "ascending" | "descending" | "none";
}

export interface NftsPageData {
  /** `NFTs`, `URITokens`; `More NFT collections` behind a marker. */
  heading: string;
  /** Empty behind a marker. */
  intro: string;
  /** 24 h, 7 days, 30 days; none behind a marker. */
  periods: SegmentLink[];
  /** The live row's figures; dashes (`null`) while it failed or behind a marker. */
  tiles: { volume: NftTile; sales: NftTile; traded: NftTile; average: NftTile };
  /** The 30 days and the words about the days not computed yet; `null` while the chart failed or behind a marker. */
  chart: { data: TimeSeriesData; pending: string | null } | null;
  /**
   * The five largest collections of the period. `"none"`: the period had no sale. `"unrated"`: it had sales (the tile counts them) but none with a price in the native currency, so no
   * collection has a volume to rank. `null` while the card failed or behind a marker.
   */
  top: BarListData | "none" | "unrated" | null;
  /** The recent sales, newest first; `null` while the card failed or behind a marker. */
  sales: NftSaleRow[] | null;
  /** The older sales' page, for the sales' marker; `null` without one. */
  olderSalesHref: string | null;
  /** The table; `null` while it failed, or when no list was asked for (an issuer that is no address). */
  collections: CollectionRow[] | null;
  /** The three sort headers, in the order of `NFT_SORTS`. */
  sortLinks: NftSortLink[];
  paging: Paging;
  /**
   * What the "Collections of an issuer" field holds (the text as typed), the message under it, and the other fields of the GET form: the canonical view's `period`, `sort` and `order`
   * as [name, value] pairs, defaults dropped, in the canonical order (none for the default view), so that submitting the form keeps the view. The canonical order has the issuer between
   * `period` and `sort`, so a form that puts these fields before the issuer is settled by the loader's 302.
   */
  issuerForm: { value: string; hidden: Array<[name: string, value: string]>; error?: string };
  /** The coverage note under each card whose coverage is incomplete (spec 8). */
  notes: { chart: CoverageNoteText | null; top: CoverageNoteText | null; sales: CoverageNoteText | null; collections: CoverageNoteText | null };
  /** The `what` of the `SectionError` of each card that failed: "the totals", "the sales volume", "the top collections", "the recent sales", "the collections". */
  failures: { totals?: string; chart?: string; top?: string; sales?: string; collections?: string };
  /** A page behind a marker: the collections table alone. */
  marker: boolean;
}

export interface NftSalesPageData {
  /** `NFT sales`, `URIToken sales`. */
  heading: string;
  rows: NftSaleRow[];
  paging: Paging;
  note: CoverageNoteText | null;
}

/** The input of `nftsListPage`: the outcomes of the loader's calls (spec 2.2). */
export interface NftsListInput {
  net: NftsNet;
  query: NftsQuery;
  /** The message under the issuer field when `query.issuer` is no classic address: `collections` is then `null`. */
  issuerError?: string;
  /** #1 */
  last: PromiseSettledResult<LastValidated>;
  /** #2, the live volume of the period. */
  live: PromiseSettledResult<NftVolume>;
  /** #3, the daily volume of the 30 days; `null`: not asked (#1 failed). */
  daily: PromiseSettledResult<NftVolume> | null;
  /** #4 */
  sales: PromiseSettledResult<NftSalesPage>;
  /** #5; `null`: not asked (an issuer that is no address). */
  collections: PromiseSettledResult<NftCollectionsPage> | null;
}

// ---- Words --------------------------------------------------------------------------------------------------------------------------------------

const PERIOD_LABELS: Record<NftPeriod, string> = { day: "24 h", "7day": "7 days", "30day": "30 days" };

const TOTALS_WHAT = "the totals";
const CHART_WHAT = "the sales volume";
const TOP_WHAT = "the top collections";
const SALES_WHAT = "the recent sales";
const COLLECTIONS_WHAT = "the collections";

const COLLECTIONS_COVERAGE_WORDS = "collections";
/** The tiles' words that are the same on both networks. */
const AVERAGE_NOTE = "volume ÷ sales";
const TOP_COUNT = 5;

/** What a collection of the data API is called in a path and a label: an issuer and, on XRPL, a taxon. */
const keyOf = (source: { issuer: string; taxon?: number }): CollectionKey => (source.taxon === undefined ? { issuer: source.issuer } : { issuer: source.issuer, taxon: source.taxon });

/** The key of a collection in a list: its path after `/nfts/`. */
const pathKeyOf = (key: CollectionKey): string => (key.taxon === undefined ? key.issuer : `${key.issuer}/${plain(key.taxon)}`);

// ---- A sale -------------------------------------------------------------------------------------------------------------------------------------

/**
 * The royalty of a sale (`royalty_est` is in the price's currency, and left out when no royalty applies): in the native currency when the price is shown converted
 * (`royalty_est × converted_amount ÷ amount`, to 6 decimals, half up: the native currency's own precision), else in the price's currency. URITokens carry no transfer fee, so Xahau
 * has none.
 */
function royaltyOf(net: NftsNet, sale: NftSale): string | null {
  if (net.id === "xahau") return null;
  const estimate = decimalOf(sale.royalty_est);
  if (estimate === null) return null;
  const converted = convertedOf(net.native, sale);
  const paid = decimalOf(sale.amount);
  if (converted !== null && paid !== null && paid.gt(0)) {
    return `${formatAmount(divided(estimate.times(converted), paid, 6).toFixed())} ${net.native}`;
  }
  return `${formatAmount(estimate.toFixed())} ${formatCurrency(sale.currency)}`;
}

/** The rows of the recent sales (spec 2.1), in the order the API gave them (newest first). A collection's Sales tab uses them too. */
export function saleRows(net: NftsNet, sales: readonly NftSale[]): NftSaleRow[] {
  return sales.map((sale) => {
    const key = keyOf(sale);
    const converted = convertedOf(net.native, sale);
    return {
      key: `${sale.tx_hash}:${plain(sale.event_index)}`,
      time: unixOf(sale.executed_time),
      txHash: sale.tx_hash,
      nft: { id: sale.nft_id, ...(sale.serial === undefined ? {} : { serial: sale.serial }), glyph: nftGlyph(sale.nft_id, sale.serial) },
      collection: { label: collectionLabel(key), href: collectionHref(net.id, key) },
      price: { value: sale.amount, currency: sale.currency, ...(sale.amount_issuer === undefined ? {} : { issuer: sale.amount_issuer }) },
      ...(converted === null ? {} : { converted: `≈ ${formatAmount(converted)} ${net.native}` }),
      seller: sale.seller,
      buyer: sale.buyer,
      mode: sale.mode,
      royalty: royaltyOf(net, sale),
    };
  });
}

// ---- The totals and the top collections ---------------------------------------------------------------------------------------------------------

/** The tiles' words under their figures: what the volume is of, what the sales are, and what the average is. */
function tileNotes(net: NftsNet): { volume: string; sales: string; average: string } {
  return {
    volume: `sales in ${net.native} and in tokens with a daily ${net.native} rate`,
    sales: net.id === "xahau" ? "URITokenBuy" : "direct and brokered",
    average: AVERAGE_NOTE,
  };
}

/** Dashes under the tiles' own words, for a live volume that could not be loaded; and the traded tile has no "of N collections" to say. */
function failedTiles(net: NftsNet): NftsPageData["tiles"] {
  const notes = tileNotes(net);
  return {
    volume: { figure: null, note: notes.volume },
    sales: { figure: null, note: notes.sales },
    traded: { figure: null, note: "" },
    average: { figure: null, note: notes.average },
  };
}

/** No tile: a page behind a marker has none. */
function noTiles(): NftsPageData["tiles"] {
  return { volume: { figure: null, note: "" }, sales: { figure: null, note: "" }, traded: { figure: null, note: "" }, average: { figure: null, note: "" } };
}

/**
 * The four tiles from the live row (spec 2.1); without a row (D3 answers none until its set is written) they are the empty state: nothing sold. `collectionsTotal` is how many
 * collections the network has, for "of N collections"; `null` leaves the words out. The average is the volume over the sales that have a price in the native currency (the sum of the
 * components' counts: the row's own `count` includes the sales with no rate), whole units, half up; a dash without one.
 */
function tilesOf(net: NftsNet, row: NftVolumeRow | undefined, collectionsTotal: number | null): NftsPageData["tiles"] {
  const notes = tileNotes(net);
  const components = row?.components ?? [];
  const total = row?.total ?? "0";
  const rated = components.reduce((sum, component) => sum.plus(component.count), ZERO);
  const average = rated.gt(0) ? divided(new BN(total), rated, 0) : null;
  return {
    volume: { figure: `${compactNumber(total)} ${net.native}`, note: notes.volume },
    sales: { figure: counted(row?.count ?? 0), note: notes.sales },
    traded: { figure: counted(components.length), note: collectionsTotal === null ? "" : `of ${counted(collectionsTotal)} ${collectionsTotal === 1 ? "collection" : "collections"}` },
    average: { figure: average === null ? DASH : `${formatAmount(average.toFixed())} ${net.native}`, note: notes.average },
  };
}

/**
 * The five largest components of the live row as bars (spec 2.1): the share is the part of the row's total, to one decimal. `"none"` when there was no sale (no row, or a `count` of 0);
 * `"unrated"` when there were sales but the row lists no collection (the row's `count` has every sale of the window, the components only those with a price in the native currency).
 */
function topOf(net: NftsNet, row: NftVolumeRow | undefined): BarListData | "none" | "unrated" {
  if (row === undefined || row.count === 0) return "none";
  if (row.components.length === 0) return "unrated";
  // The API sorts the components largest first; the list is the five largest whatever it sent (a stable sort keeps the API's order among equals).
  const largest: NftVolumeComponent[] = [...row.components].sort((a, b) => new BN(b.converted_amount).comparedTo(a.converted_amount) ?? 0).slice(0, TOP_COUNT);
  return tokened({
    items: largest.map((component) => {
      const key = keyOf(component);
      return {
        id: pathKeyOf(key),
        label: collectionLabel(key),
        sublabel: salesCount(component.count),
        value: new BN(component.converted_amount).toFixed(),
        share: sharePercentTenth(component.converted_amount, row.total),
        count: plain(component.count),
        href: collectionHref(net.id, key),
      };
    }),
    format: { kind: "amount" as const, unit: net.native },
  });
}

// ---- The chart ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The daily volume over the 30 days of `window` (spec 2.1): one bucket for each UTC day, the value the row's `total` and the extra "Sales" its `count`, the running day `forming`. A day
 * with no row is not computed yet (`null`) while it is one of the newest two buckets that `pendingCount` says may be (the API computes a day an hour after it has closed), and a quiet
 * day (0) before them.
 */
function chartOf(net: NftsNet, window: PeriodWindow, volume: NftVolume): { data: TimeSeriesData; pending: string | null } {
  const rows = byDay(volume.rows, (row) => row.start_time);
  const pending = pendingCount(window.buckets, new Set(window.buckets.filter((bucket) => rows.has(bucket))));
  const firstPending = window.buckets.length - pending;
  const valuesOf = (read: (row: NftVolumeRow) => string): (string | null)[] =>
    window.buckets.map((bucket, index) => {
      const row = rows.get(bucket);
      if (row !== undefined) return read(row);
      return index >= firstPending ? null : "0";
    });
  const data = tokened({
    axis: { unit: window.unit, buckets: window.buckets },
    series: [{ id: "volume", label: "Sales volume", slot: 1 as const, values: valuesOf((row) => new BN(row.total).toFixed()) }],
    format: { kind: "amount" as const, unit: net.native },
    forming: true,
    pending,
    extras: [{ id: "sales", label: "Sales", values: valuesOf((row) => plain(row.count)), format: { kind: "count" as const } }],
  });
  return { data, pending: pendingNote(window.buckets, pending, window.unit) };
}

// ---- The collections ----------------------------------------------------------------------------------------------------------------------------

function collectionRow(net: NftsNet, collection: NftCollection): CollectionRow {
  const key = keyOf(collection);
  return {
    key: pathKeyOf(key),
    glyph: collectionGlyph(collection.issuer),
    issuer: shortAddress(collection.issuer),
    href: collectionHref(net.id, key),
    under: key.taxon === undefined ? `every ${nftWords(net.id).token} of this issuer` : `taxon ${counted(key.taxon)}`,
    supply: counted(collection.supply),
    holders: counted(collection.holders),
    mintedBurned: `${counted(collection.minted)} / ${counted(collection.burned)}`,
    sales: counted(collection.sales_count),
    volume: `${compactNumber(collection.volume_native)} ${net.native}`,
    lastMint: collection.last_mint === undefined ? DASH : formatDate(collection.last_mint.executed_time),
  };
}

/** The list's own view in a link: the period, the issuer, the sort and the order, the part of the query that the table and the totals are of (not the page of the table). */
function viewOf(query: NftsQuery): Partial<NftsQuery> {
  return { period: query.period, issuer: query.issuer, sort: query.sort, order: query.order };
}

/**
 * The fields of the issuer form besides the issuer: the view's `period`, `sort` and `order` as the canonical link writes them (defaults dropped, in the canonical order), read back
 * from that link, so that the defaults are `nftsHref`'s own and cannot drift from it.
 */
function hiddenOf(net: NftsNet, query: NftsQuery): Array<[name: string, value: string]> {
  return queryPairsOf(nftsHref(net.id, { period: query.period, sort: query.sort, order: query.order }));
}

/** The sort headers: the current sort's link flips the order, another sort starts largest first; the page the visitor was on is dropped. */
function sortLinksOf(net: NftsNet, query: NftsQuery): NftSortLink[] {
  return NFT_SORTS.map((sort) => {
    const current = sort === query.sort;
    const order = current && query.order === "desc" ? "asc" : "desc";
    return {
      sort,
      href: nftsHref(net.id, { ...viewOf(query), sort, order }),
      ariaSort: current ? (query.order === "asc" ? "ascending" : "descending") : "none",
    };
  });
}

/** The table of a page of collections with its Newer and Older links and its coverage note. */
function collectionsCard(net: NftsNet, query: NftsQuery, page: NftCollectionsPage): { rows: CollectionRow[]; paging: Paging; note: CoverageNoteText | null } {
  return {
    rows: page.collections.map((collection) => collectionRow(net, collection)),
    paging: trailPaging({ marker: query.marker, back: query.back, next: page.marker }, (to) => nftsHref(net.id, { ...viewOf(query), ...to })),
    note: coverageNote(page.coverage, COLLECTIONS_COVERAGE_WORDS),
  };
}

// ---- The pages ----------------------------------------------------------------------------------------------------------------------------------

/** The page's introduction, in the board's words for the network (spec 2.1). */
function introOf(net: NftsNet): string {
  return net.id === "xahau"
    ? `URITokens, the non-fungible tokens of ${net.longName}: sales, collections and their holders. A collection is everything one issuer minted.`
    : `Non-fungible tokens (NFTokens) on ${net.longName}: sales, collections and their holders. A collection is an issuer and a taxon.`;
}

/**
 * The list's first page (spec 2.1 and 2.2) from the outcomes of the loader's calls. A card whose call was rejected, or whose answer it cannot be made of, is `null` and has its words in
 * `failures`; the page stands on the others.
 */
export function nftsListPage(input: NftsListInput): NftsPageData {
  const { net, query } = input;
  const words = nftWords(net.id);
  // What the sales' coverage notes say is missing: "NFT sales", "URIToken sales".
  const coverageWords = words.salesHeading;
  const failures: NftsPageData["failures"] = {};

  // The collections first: the tiles' "of N collections" is theirs. Without an issuer filter the page's `total` is the network's number of collections.
  let collections: CollectionRow[] | null = null;
  let paging: Paging = { newerHref: null, olderHref: null };
  let collectionsNote: CoverageNoteText | null = null;
  let collectionsTotal: number | null = null;
  if (input.collections !== null) {
    if (input.collections.status === "rejected") {
      failures.collections = COLLECTIONS_WHAT;
    } else {
      const card = collectionsCard(net, query, input.collections.value);
      ({ rows: collections, paging, note: collectionsNote } = card);
      // With an issuer filter D3's total counts what the filter matches, not the network's collections: the words are left out (ruling C17).
      collectionsTotal = query.issuer === undefined ? input.collections.value.total : null;
    }
  }

  // #2: the totals and the top collections, from the live row (none: nothing sold yet).
  let tiles: NftsPageData["tiles"];
  let top: NftsPageData["top"] = null;
  let topNote: CoverageNoteText | null = null;
  if (input.live.status === "rejected") {
    failures.totals = TOTALS_WHAT;
    failures.top = TOP_WHAT;
    tiles = failedTiles(net);
  } else {
    const row = input.live.value.rows[0];
    tiles = tilesOf(net, row, collectionsTotal);
    top = topOf(net, row);
    topNote = coverageNote(input.live.value.coverage, coverageWords);
  }

  // #1 and #3: the chart over E2's 30 days up to the UTC day of the newest ledger. A newest ledger that has no time to take the window from fails the card, as the failed call does.
  let chart: NftsPageData["chart"] = null;
  let chartNote: CoverageNoteText | null = null;
  if (input.last.status === "fulfilled" && input.daily !== null && input.daily.status === "fulfilled") {
    let window: PeriodWindow | null = null;
    try {
      window = anchoredWindow(anchorOrThrow(input.last.value), "30d");
    } catch {
      // Only the anchor can throw here: `last_validated` is the one answer that no shape check has been over, and its ledger index or close time may be no number. The loader works out
      // the same window before it asks for the days and logs a bad anchor, so there is nothing to log twice; the card is told as failed below.
    }
    if (window !== null) {
      chart = chartOf(net, window, input.daily.value);
      chartNote = coverageNote(input.daily.value.coverage, coverageWords);
    }
  }
  if (chart === null) failures.chart = CHART_WHAT;

  // #4: the recent sales.
  let sales: NftSaleRow[] | null = null;
  let olderSalesHref: string | null = null;
  let salesNote: CoverageNoteText | null = null;
  if (input.sales.status === "rejected") {
    failures.sales = SALES_WHAT;
  } else {
    const page = input.sales.value;
    sales = saleRows(net, page.sales);
    olderSalesHref = page.marker === undefined ? null : nftSalesHref(net.id, { marker: page.marker });
    salesNote = coverageNote(page.coverage, coverageWords);
  }

  return {
    heading: words.listHeading,
    intro: introOf(net),
    periods: NFT_PERIODS.map((period) => ({ label: PERIOD_LABELS[period], href: nftsHref(net.id, { ...viewOf(query), period }), current: period === query.period })),
    tiles,
    chart,
    top,
    sales,
    olderSalesHref,
    collections,
    sortLinks: sortLinksOf(net, query),
    paging,
    issuerForm: { value: query.issuer ?? "", hidden: hiddenOf(net, query), ...(input.issuerError === undefined ? {} : { error: input.issuerError }) },
    notes: { chart: chartNote, top: topNote, sales: salesNote, collections: collectionsNote },
    failures,
    marker: false,
  };
}

/**
 * A page of the list behind a marker (spec 2.2): the collections table alone, titled "More NFT collections", with its form, sort headers, Newer and Older and coverage note. The
 * loader awaits the one call whole, so there is no failure to tell: a failed call is its 503.
 */
export function nftsMarkerPage(net: NftsNet, query: NftsQuery, collections: NftCollectionsPage): NftsPageData {
  const words = nftWords(net.id);
  const card = collectionsCard(net, query, collections);
  return {
    heading: `More ${words.token} collections`,
    intro: "",
    periods: [],
    tiles: noTiles(),
    chart: null,
    top: null,
    sales: null,
    olderSalesHref: null,
    collections: card.rows,
    sortLinks: sortLinksOf(net, query),
    paging: card.paging,
    issuerForm: { value: query.issuer ?? "", hidden: hiddenOf(net, query) },
    notes: { chart: null, top: null, sales: null, collections: card.note },
    failures: {},
    marker: true,
  };
}

/**
 * The older sales (spec 2.3): a page of the network's sales, newest first, with Newer and Older and the coverage note. The loader awaits the one call whole, so a failure is its 503.
 */
export function nftSalesPage(net: NftsNet, query: NftSalesQuery, page: NftSalesPage): NftSalesPageData {
  const words = nftWords(net.id);
  return {
    heading: words.salesHeading,
    rows: saleRows(net, page.sales),
    paging: trailPaging({ marker: query.marker, back: query.back, next: page.marker }, (to) => nftSalesHref(net.id, to)),
    note: coverageNote(page.coverage, words.salesHeading),
  };
}
