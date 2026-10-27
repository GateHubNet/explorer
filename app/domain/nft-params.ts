// The NFT pages' views and the links to them (E8 spec 1.2), and the words of their labels. Pure and safe for the browser: the loaders, the view builders and the NFT pages import
// this file, so it imports nothing of the Worker, of `asset.ts` (the issuer checksums of `ripple-address-codec`), of `nft-id.ts` (which belongs to the Worker) or of the describe and
// parse trees. Types are imported, and erased. The pages that show an NFT or a collection but are no NFT page import `nftLink` and `collectionLink` from nft-link.ts alone.
//
// One URL per view (E2 1.2, as amm-params.ts): `parseNftsParams`, `parseNftSalesParams`, `parseCollectionParams` and `parseNftParams` give the view a query names, and `nftsHref`,
// `nftSalesHref`, `collectionHref` and `nftHref` write its canonical URL. A loader hands `{ path, search }` of that to E3's `redirectToCanonical`, which compares them with the
// request's `url.pathname` and `queryOf(request.url)` (that leaves out React Router's `_routes`) and answers a 302 when they differ. The canonical form drops defaults, unknown values,
// repeats and unknown parameters, and orders the rest as in the table of the spec. Every value is written with `queryValue`, so the query is what a URL parser leaves as it is once it
// is serialized: a redirect to it ends.

import type { NetworkId } from "../server/networks";
import type { CollectionKey, NftPeriod, NftSort } from "../server/api-types";
import { shortAddress, formatAmount } from "./format";
import { collectionPath, nftPath } from "./nft-link";
import { parseTrail } from "./paging";
import { queryValue, trailPairs, withQuery } from "./query-of";

// A page's path and the decision where an NFT link goes live in nft-link.ts, which the pages with an NFT or a collection link that are no NFT page load alone. `CollectionKey`,
// `NftPeriod` and `NftSort` are declared in api-types.ts, so that the data API client imports nothing of the domain, and re-exported here for the pages.
export { collectionPath, nftPath } from "./nft-link";
export type { CollectionKey, NftPeriod, NftSort };

/** The list's periods, in the order of their selector (24 h, 7 days, 30 days); the first is the default. They are the periods of D3's live `nft_volume`. */
export const NFT_PERIODS = ["day", "7day", "30day"] as const satisfies readonly NftPeriod[];
/** What the list's collections are sorted by, in the order of the column headers; the first is the default. */
export const NFT_SORTS = ["volume", "supply", "holders"] as const satisfies readonly NftSort[];
/** The collection chart's measures, in the order of their switch (Volume, Sales, Average price, Lowest price); the first is the default. */
export const NFT_MEASURES = ["volume", "sales", "avg", "low"] as const;
export type NftMeasure = (typeof NFT_MEASURES)[number];
/** The collection page's tabs, in the order of their selector; the first is the default. */
export const COLLECTION_TABS = ["sales", "nfts", "holders"] as const;
export type CollectionTab = (typeof COLLECTION_TABS)[number];

const DEFAULT_PERIOD: NftPeriod = "day";
const DEFAULT_SORT: NftSort = "volume";
const DEFAULT_MEASURE: NftMeasure = "volume";
const DEFAULT_TAB: CollectionTab = "sales";

/**
 * The list's query. `issuer` is the text as given, trimmed (the loader checks that it is a classic address); `order` is descending unless it is `asc`. `period` is the default's behind
 * a marker: that page of older collections has no tiles or chart. `marker` is how a page was reached and `back` the markers of the pages before it, nearest first.
 */
export interface NftsQuery {
  period: NftPeriod;
  issuer?: string;
  sort: NftSort;
  order: "asc" | "desc";
  marker?: string;
  back: readonly string[];
}

/** The older sales' query: the page is the marker's, and the trail behind it. */
export interface NftSalesQuery {
  marker?: string;
  back: readonly string[];
}

/**
 * A collection's query. `measure` is the default's behind a marker (that page has no chart). `owner` and `burned` are the NFTs tab's filters: they are the view's only with
 * `tab=nfts`, and `owner` is the text as given, trimmed (the loader checks it).
 */
export interface CollectionQuery {
  measure: NftMeasure;
  tab: CollectionTab;
  owner?: string;
  burned: boolean;
  marker?: string;
  back: readonly string[];
}

/** An NFT's query: whether the history shows offer events, and its trail. */
export interface NftQuery {
  offers: boolean;
  marker?: string;
  back: readonly string[];
}

function isPeriod(value: string | null): value is NftPeriod {
  return value !== null && (NFT_PERIODS as readonly string[]).includes(value);
}

function isSort(value: string | null): value is NftSort {
  return value !== null && (NFT_SORTS as readonly string[]).includes(value);
}

function isMeasure(value: string | null): value is NftMeasure {
  return value !== null && (NFT_MEASURES as readonly string[]).includes(value);
}

function isTab(value: string | null): value is CollectionTab {
  return value !== null && (COLLECTION_TABS as readonly string[]).includes(value);
}

/** The text of a parameter that holds an address as given, trimmed: none when it is absent or empty. The loader checks that it is an address. */
function addressText(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
}

/** The trail of a query: the raw `marker` as it was given (the loader checks `isMarker` on it and answers a 404, before it compares the query), and `back` behind a marker only. */
function trailOf(search: URLSearchParams): { marker?: string; back: string[] } {
  const marker = search.get("marker") ?? undefined;
  return { ...(marker === undefined ? {} : { marker }), back: marker === undefined ? [] : parseTrail(search.get("back")) };
}

/**
 * The view of the list a query names. Only the first value of a parameter is read; `period`, `sort` and `order` are exact (case counts), and anything else is the default's.
 * `issuer` is the text as it was given, trimmed, and an empty one is none. Behind a marker the period is the default's, and `back` is the trail `parseTrail` accepts.
 */
export function parseNftsParams(search: URLSearchParams): NftsQuery {
  const period = search.get("period");
  const sort = search.get("sort");
  const issuer = addressText(search.get("issuer"));
  const trail = trailOf(search);
  return {
    period: trail.marker === undefined && isPeriod(period) ? period : DEFAULT_PERIOD,
    ...(issuer === undefined ? {} : { issuer }),
    sort: isSort(sort) ? sort : DEFAULT_SORT,
    order: search.get("order") === "asc" ? "asc" : "desc",
    ...trail,
  };
}

/** The view of the older sales a query names: the marker as it was given, and the trail behind it. */
export function parseNftSalesParams(search: URLSearchParams): NftSalesQuery {
  return trailOf(search);
}

/**
 * The view of a collection a query names. Only the first value of a parameter is read; `measure` and `tab` are exact, and anything else is the default's. `owner` and `burned` are read
 * only with `tab=nfts`; `burned` is true only for `1`. Behind a marker the measure is the default's.
 */
export function parseCollectionParams(search: URLSearchParams): CollectionQuery {
  const measure = search.get("measure");
  const tabText = search.get("tab");
  const tab = isTab(tabText) ? tabText : DEFAULT_TAB;
  const owner = tab === "nfts" ? addressText(search.get("owner")) : undefined;
  const trail = trailOf(search);
  return {
    measure: trail.marker === undefined && isMeasure(measure) ? measure : DEFAULT_MEASURE,
    tab,
    ...(owner === undefined ? {} : { owner }),
    burned: tab === "nfts" && search.get("burned") === "1",
    ...trail,
  };
}

/** The view of an NFT's page a query names: `offers` is true only for `1`. */
export function parseNftParams(search: URLSearchParams): NftQuery {
  return { offers: search.get("offers") === "1", ...trailOf(search) };
}

/**
 * The link to the list: `/xrpl/nfts`, `/xrpl/nfts?period=7day&sort=supply&order=asc`. Its query is `period` (not the default, and not behind a marker, where there are no tiles),
 * `issuer` (when it is not empty, trimmed), `sort` (not the default), `order=asc`, `marker` and `back`, in that order. An absent `marker` is the first page, which is how
 * `trailPaging` asks for it. A caller checks `isMarker` before it builds a link to a marker, and a loader before it redirects to one.
 */
export function nftsHref(net: string, q: Partial<NftsQuery> = {}): string {
  const pairs: string[] = [];
  if (q.marker === undefined && q.period !== undefined && q.period !== DEFAULT_PERIOD) pairs.push(`period=${q.period}`);
  const issuer = addressText(q.issuer);
  if (issuer !== undefined) pairs.push(`issuer=${queryValue(issuer)}`);
  if (q.sort !== undefined && q.sort !== DEFAULT_SORT) pairs.push(`sort=${q.sort}`);
  if (q.order === "asc") pairs.push("order=asc");
  pairs.push(...trailPairs(q.marker, q.back));
  return withQuery(`/${net}/nfts`, pairs.join("&"));
}

/** The link to the older sales: `/xrpl/nfts/sales`, `/xrpl/nfts/sales?marker=M3&back=M2.M1`. */
export function nftSalesHref(net: string, q: Partial<NftSalesQuery> = {}): string {
  return withQuery(`/${net}/nfts/sales`, trailPairs(q.marker, q.back).join("&"));
}

/**
 * The link to a collection's page: the path of `collectionPath` (`/xrpl/nfts/{issuer}/{taxon}`, `/xahau/nfts/{issuer}`), then `measure` (not the default, and not behind a marker, where
 * there is no chart), `tab` (not the first), `owner` and `burned=1` (with the NFTs tab only), `marker` and `back`, in that order.
 */
export function collectionHref(net: string, key: CollectionKey, q: Partial<CollectionQuery> = {}): string {
  const pairs: string[] = [];
  if (q.marker === undefined && q.measure !== undefined && q.measure !== DEFAULT_MEASURE) pairs.push(`measure=${q.measure}`);
  if (q.tab !== undefined && q.tab !== DEFAULT_TAB) pairs.push(`tab=${q.tab}`);
  if (q.tab === "nfts") {
    const owner = addressText(q.owner);
    if (owner !== undefined) pairs.push(`owner=${queryValue(owner)}`);
    if (q.burned === true) pairs.push("burned=1");
  }
  pairs.push(...trailPairs(q.marker, q.back));
  return withQuery(collectionPath(net, key), pairs.join("&"));
}

/** The link to an NFT's page: the path of `nftPath`, then `offers=1` (offer events in the history), `marker` and `back`. */
export function nftHref(net: string, id: string, q: Partial<NftQuery> = {}): string {
  const pairs: string[] = [];
  if (q.offers === true) pairs.push("offers=1");
  pairs.push(...trailPairs(q.marker, q.back));
  return withQuery(nftPath(net, id), pairs.join("&"));
}

const MAX_TAXON = 4_294_967_295;

/**
 * The taxon segment of `/{net}/nfts/{issuer}/{taxon}`: a decimal UInt32 (ten digits at most, as D3's `taxonParam`, whose 400 `invalid taxon` it never reaches), its number and its plain
 * form (`01` is 1, written `1`: the loader redirects a segment that is not its plain form), or `null` when it is none (`-1`, `1.0`, `x`, `4294967296`).
 */
export function parseTaxon(raw: string): { taxon: number; plain: string } | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const taxon = Number(raw);
  return taxon <= MAX_TAXON ? { taxon, plain: String(taxon) } : null;
}

const ELLIPSIS = "…";

/**
 * What a seller → buyer is written with in the history's Accounts cell: a text segment that is exactly this is the arrow between two accounts. The view builder (`nft-view.ts`, in the
 * Worker) writes it and the NFT page (in the browser) draws it, as an arrow that is a picture and, for a screen reader, the word "to".
 */
export const ARROW = " → ";

/** An NFT id shortened to its first 8 and last 4 characters: `00081388…101F` (an id that is no longer than that is returned as it is). */
export function shortNftId(id: string): string {
  // Thirteen characters or fewer: the shortened form would be no shorter.
  if (id.length <= 13) return id;
  return `${id.slice(0, 8)}${ELLIPSIS}${id.slice(-4)}`;
}

/**
 * A collection in a breadcrumb, a title, a label or a 404: the issuer shortened and, on XRPL, where the key has a taxon, the taxon (`rLULtF…mB3R · taxon 1`, with the digits of a large
 * taxon grouped as every number of a page is); on Xahau the issuer alone (`rEvRt8…Lk2P`). A taxon of 0 is a taxon.
 */
export function collectionLabel(key: CollectionKey): string {
  const issuer = shortAddress(key.issuer);
  return key.taxon === undefined ? issuer : `${issuer} · taxon ${formatAmount(String(key.taxon))}`;
}

/** The words a network's NFT pages use for what it calls its non-fungible tokens (NFTs on XRPL, URITokens on Xahau; the testnets take their mainnet's). */
export interface NftWords {
  /** One token: `NFT`, `URIToken`. */
  token: string;
  /** Tokens: `NFTs`, `URITokens`. */
  tokens: string;
  /** The tag of a token's kind: `NFToken`, `URIToken`. */
  kindTag: string;
  /** The tag of a collection: `NFToken collection`, `URIToken collection`. */
  collectionTag: string;
  /** The heading of the list page. */
  listHeading: string;
  /** The heading of the older sales page. */
  salesHeading: string;
}

const WORDS = {
  xrpl: { token: "NFT", tokens: "NFTs", kindTag: "NFToken", collectionTag: "NFToken collection", listHeading: "NFTs", salesHeading: "NFT sales" },
  xahau: { token: "URIToken", tokens: "URITokens", kindTag: "URIToken", collectionTag: "URIToken collection", listHeading: "URITokens", salesHeading: "URIToken sales" },
} as const satisfies Record<NetworkId, NftWords>;

/** The words of a network's NFT pages, by its id (a network's name is the layout's, `network.name`: the words here are the tokens'). */
export function nftWords(net: NetworkId): NftWords {
  return WORDS[net];
}
