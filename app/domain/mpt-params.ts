// The MPT pages' views and the links to the lists (E14 spec 1.2): the MPT page takes no parameter, the holders' and the transfers' page take a trail. Pure and safe for the browser (the pages draw the
// hrefs here), but for the one file it imports at run time, `paging.ts`, for `parseTrail` (which reaches only `server/marker.ts`'s `isMarker`: the leaf the NFT and token pages allow).
//
// One URL per view (E2 1.2, as token-params.ts): `parseMptParams` and `parseMptListParams` give the view a query names and its canonical query, which a loader hands, with the path, to
// `redirectToCanonical` (it takes the query with or without its `?`, and the empty text for none); `mptHoldersHref` and `mptTransfersHref` write the URL of a page. The canonical form drops
// every unknown parameter, repeat and trail without a marker, and writes `marker` then `back` with `queryValue`, so that it is what a URL parser leaves as it is: a redirect to it ends.

import type { NetworkId } from "../server/networks";
import { mptPath } from "./mpt";
import { parseTrail } from "./paging";
import { trailPairs, withQuery } from "./query-of";

/** A holders' or transfers' page's trail: the marker the page was reached with, as it was given, and the markers of the pages before it, nearest first. */
export interface MptListParams {
  marker?: string;
  back: string[];
}

/**
 * The view of the MPT page a query names: it takes no parameter, so every query has the canonical query `""` (the loader redirects `?x=1` to the page without it). `search` is the request's query,
 * with or without its `?`; nothing of it is read.
 */
export function parseMptParams(_search: string): { canonical: string } {
  return { canonical: "" };
}

/**
 * The view of a list page a query names, and its canonical query (no `?`; the empty text for the first page). Only the first value of `marker` is read, and it is returned as it was given,
 * whatever it is, an empty one included: the loader checks `isMarker` on it and answers a 404 before it compares the query or redirects (a `?marker=` is a page of no use, as E8's and E11's).
 * `back` is the trail `parseTrail` accepts, and only behind a marker.
 */
export function parseMptListParams(search: string): MptListParams & { canonical: string } {
  const query = new URLSearchParams(search);
  const marker = query.get("marker") ?? undefined;
  const back = marker === undefined ? [] : parseTrail(query.get("back"));
  return { ...(marker === undefined ? {} : { marker }), back, canonical: trailPairs(marker, back).join("&") };
}

/** The href of a list page: the path, then the query of its trail (the first page has none). */
function listHref(path: string, p: { marker?: string; back?: readonly string[] }): string {
  return withQuery(path, trailPairs(p.marker, p.back).join("&"));
}

/** The link to an issuance's holders: `/xrpl/mpt/0000012A…/holders`, then `?marker=M3&back=M2.M1` behind a marker. */
export function mptHoldersHref(net: NetworkId, id: string, p: { marker?: string; back?: readonly string[] } = {}): string {
  return listHref(mptPath(net, id, "holders"), p);
}

/** The link to an issuance's transfers: `/xrpl/mpt/0000012A…/transfers`, then `?marker=M3&back=M2.M1` behind a marker. */
export function mptTransfersHref(net: NetworkId, id: string, p: { marker?: string; back?: readonly string[] } = {}): string {
  return listHref(mptPath(net, id, "transfers"), p);
}
