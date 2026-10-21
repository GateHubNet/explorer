// The AMM pages' views and the links to them (spec 1.2). Pure and safe for the browser: the loaders, the view builders and the pages import
// this file, and so does every page that shows a pool link (`poolLink`), so it imports nothing of the Worker, of `asset.ts` (the issuer
// checksums of `ripple-address-codec`) or of the describe and parse trees. Types are imported, and erased.
//
// One URL per view (E2 1.2): `parseAmmListParams` and `parseAmmPoolParams` give the view a query names, and `ammListHref` and
// `ammPoolHref` write its canonical URL. A loader compares the request's path and raw query (`queryOf(request.url)`, which leaves out
// React Router's `_routes`) with the path and query of that href, and answers a 302 to it when they differ. The canonical form drops
// defaults, unknown values, repeats and unknown parameters, and orders the rest as in the table of the spec. Every value is written with
// `queryValue`, so the href is what a URL parser leaves as it is once it is serialized: a redirect to it ends.

import type { Features } from "../ui/features";
import { parseTrail } from "./paging";
import { queryValue } from "./query-of";
import type { WindowPeriod } from "./window";

/** The pool page's tabs, in the order of their selector; the first is the default. */
export const AMM_TABS = ["swaps", "liquidity", "governance"] as const;
export type AmmTab = (typeof AMM_TABS)[number];

/** The pool page's periods, in the order of their selector. */
export const AMM_PERIODS = ["30d", "90d", "1y"] as const satisfies readonly WindowPeriod[];
export type AmmPeriod = (typeof AMM_PERIODS)[number];

const DEFAULT_PERIOD: AmmPeriod = "90d";
const DEFAULT_TAB: AmmTab = "swaps";

/**
 * A list URL's query. `asset` is the text as given (a space where a raw `+` was); the loader reads it with E3's `parseAssetText` and
 * writes it back with `assetText`. `marker` is how a page was reached and `back` the markers of the pages before it, nearest first.
 */
export interface AmmListQuery {
  asset?: string;
  deleted: boolean;
  marker?: string;
  back: readonly string[];
}

/** A pool URL's query. `period` is the default's behind a marker: that page of older rows has no charts. */
export interface AmmPoolQuery {
  period: AmmPeriod;
  tab: AmmTab;
  marker?: string;
  back: readonly string[];
}

function isPeriod(value: string | null): value is AmmPeriod {
  return value !== null && (AMM_PERIODS as readonly string[]).includes(value);
}

function isTab(value: string | null): value is AmmTab {
  return value !== null && (AMM_TABS as readonly string[]).includes(value);
}

/**
 * The view of the list a query names. Only the first value of a parameter is read. `asset` is the text as it was given, and an empty one
 * is no asset; `deleted` is true only for `1`; `back` is the trail `parseTrail` accepts, and only behind a marker. The raw `marker` is
 * returned as it was given, whatever it is: the loader checks `isMarker` on it, and answers a 404, before it compares the query.
 */
export function parseAmmListParams(search: URLSearchParams): AmmListQuery {
  const asset = search.get("asset");
  const marker = search.get("marker") ?? undefined;
  return {
    ...(asset === null || asset === "" ? {} : { asset }),
    deleted: search.get("deleted") === "1",
    ...(marker === undefined ? {} : { marker }),
    back: marker === undefined ? [] : parseTrail(search.get("back")),
  };
}

/**
 * The view of a pool page a query names. Only the first value of a parameter is read; `period` and `tab` are exact (case counts), and
 * anything else is the default's. Behind a marker the period is the default's and the trail is what `parseTrail` accepts; without a
 * marker there is no trail. The raw `marker` is returned as it was given, as the list's.
 */
export function parseAmmPoolParams(search: URLSearchParams): AmmPoolQuery {
  const period = search.get("period");
  const tab = search.get("tab");
  const marker = search.get("marker") ?? undefined;
  return {
    period: marker === undefined && isPeriod(period) ? period : DEFAULT_PERIOD,
    tab: isTab(tab) ? tab : DEFAULT_TAB,
    ...(marker === undefined ? {} : { marker }),
    back: marker === undefined ? [] : parseTrail(search.get("back")),
  };
}

/** The pairs of a page trail: `marker`, then `back` (only behind a marker, and only a trail that is not empty), its markers joined by `.`. */
function trailPairs(marker: string | undefined, back: readonly string[] | undefined): string[] {
  if (marker === undefined) return [];
  const pairs = [`marker=${queryValue(marker)}`];
  if (back !== undefined && back.length > 0) pairs.push(`back=${back.map(queryValue).join(".")}`);
  return pairs;
}

/** `?…`, or the empty text for a query that has no pairs. */
function queryOfPairs(pairs: readonly string[]): string {
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

/**
 * The link to the list: `/xrpl/amm`, `/xrpl/amm?asset=RLUSD.rMx…&deleted=1`, then `marker` and `back`, in that order. An empty or absent
 * `asset` and a `deleted` that is not true are left out. `asset` is written as it is given: a caller gives the text `assetText` made.
 * A caller checks `isMarker` before it builds a link to a marker, and a loader before it redirects to one.
 */
export function ammListHref(net: string, q: Partial<AmmListQuery> = {}): string {
  const pairs: string[] = [];
  if (q.asset !== undefined && q.asset !== "") pairs.push(`asset=${queryValue(q.asset)}`);
  if (q.deleted === true) pairs.push("deleted=1");
  pairs.push(...trailPairs(q.marker, q.back));
  return `/${net}/amm${queryOfPairs(pairs)}`;
}

/**
 * The link to a pool's page: `/xrpl/amm/rhWTXC…`, then `period` (not the default, and not behind a marker, where there are no charts),
 * `tab` (not the first), `marker` and `back`, in that order. An absent `marker` is the first page, which is how `trailPaging` asks for it.
 */
export function ammPoolHref(net: string, pool: string, q: Partial<AmmPoolQuery> = {}): string {
  const pairs: string[] = [];
  if (q.marker === undefined && q.period !== undefined && q.period !== DEFAULT_PERIOD) pairs.push(`period=${q.period}`);
  if (q.tab !== undefined && q.tab !== DEFAULT_TAB) pairs.push(`tab=${q.tab}`);
  pairs.push(...trailPairs(q.marker, q.back));
  return `/${net}/amm/${encodeURIComponent(pool)}${queryOfPairs(pairs)}`;
}

/** The one place that decides where a pool link goes: the pool page when `features.ammPages`, else the account page. */
export function poolLink(net: string, pool: string, features: Features): string {
  return features.ammPages ? ammPoolHref(net, pool) : `/${net}/account/${encodeURIComponent(pool)}`;
}
