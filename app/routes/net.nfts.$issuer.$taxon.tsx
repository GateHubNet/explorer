import { redirect } from "react-router";
import { isValidClassicAddress } from "ripple-address-codec";

import { collectionHref, collectionLabel, nftsHref, nftWords, parseCollectionParams, parseTaxon, type CollectionKey, type CollectionQuery } from "../domain/nft-params";
import { queryOf } from "../domain/query-of";
import { anchorOrThrow } from "../server/anchor";
import { HOME_CALL_TTL_SECONDS, MARKER_PAGE_CLASS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import type { DataApi } from "../server/data-api";
import { asOutage, byDeadline, CARD_DEADLINE_MS, outcome, TooLate } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { nftCollectionMeta } from "../server/meta-nft-collection";
import { collectionMarkerPage, collectionNotFound, nftCollectionPage, type CollectionList } from "../server/nft-collection-view";
import { requireNetwork } from "../server/network-route";
import { anchoredWindow } from "../server/network-view";
import type { Network } from "../server/networks";
import { redirectToHref } from "../server/pair-route";
import { isNotFound, UpstreamError } from "../server/upstream";
import { NftCollectionPage } from "../ui/pages/NftCollectionPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.nfts.$issuer.$taxon";

// The loader names a cache class (`minute`; `short` for a form error; `MARKER_PAGE_CLASS` behind a marker), answers its 404s with class `short`, and tidies a path or a query with a
// redirect (`immutable` for the path alone, `short` with the query). A 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its NFTs item as the page of the section (`aria-current="page"`).
export const handle = { navSection: "nfts" } satisfies NetworkRouteHandle;

/** The rows of a page of the tab (spec 3.2, #4). */
const LIST_PAGE = 20;

/** What the form says of an owner that is no classic address (spec 1.3). */
const OWNER_ERROR = "Write a classic address (r…).";

/** The phrase of the 404 of a collection the data API does not have: `collectionNotFound`'s sentence is "We couldn't find {this} on {network}", which the not-found page writes round it. */
function missing(net: Network, key: CollectionKey): string {
  const sentence = collectionNotFound(net, key);
  return sentence.slice("We couldn't find ".length, sentence.length - ` on ${net.name}`.length);
}

/** #4: the page of the tab of the query, behind the query's marker when it has one. */
function listOf(api: DataApi, key: CollectionKey, query: CollectionQuery): Promise<CollectionList> {
  switch (query.tab) {
    case "sales":
      return api.nftCollectionSales(key, { descending: true, limit: LIST_PAGE, marker: query.marker });
    case "nfts":
      return api.nftCollectionNfts(key, { limit: LIST_PAGE, owner: query.owner, includeBurned: query.burned, marker: query.marker });
    case "holders":
      return api.nftCollectionHolders(key, { limit: LIST_PAGE, marker: query.marker });
  }
}

/** How many rows the page of a tab's list holds. */
const rowsIn = (list: CollectionList): number => ("sales" in list ? list.sales.length : "nfts" in list ? list.nfts.length : list.holders.length);

/** The words of what failed, for the log: the collection itself (`part` empty) or a part of its page; a call that missed its deadline "took too long", any other "could not be loaded". */
const failedWords = (part: string, reason: unknown) => `the NFT collection${part === "" ? "" : `'s ${part}`} ${reason instanceof TooLate ? "took too long" : "could not be loaded"}`;

/**
 * `/{net}/nfts/{issuer}[/{taxon}]` (NFT spec 3): one collection of the network, an issuer and, on XRPL, a taxon; on Xahau everything one issuer minted. Its class is `minute`.
 *
 * - **Validation first** (spec 1.2, 1.3). `NFTS` off is the not-found page, a 404 of class `short`, for every view. An issuer that is no classic address with a good checksum, and a
 *   taxon that is no decimal UInt32 (`parseTaxon`), are a 404 that repeats what was asked (`echoOf`). Then a `marker` that is none is a 404 of class `short`, before any redirect, which
 *   would otherwise lead to a URL that holds it; so is a marker with an owner that is no classic address (a page behind a marker is the tab's list of a view that was asked for, and
 *   there is no form to show the error in). The other network's form of the key is a 302 of class `short`: XRPL's `/{issuer}` (no taxon) to the issuer's collections, Xahau's
 *   `/{issuer}/{taxon}` to `/{issuer}`. A path or a query that is not the canonical one is a 302 to the one URL (`redirectToHref`: class `immutable` for the path alone, so a taxon
 *   with leading zeros goes to its plain number, `short` with the query). The path is React Router's `url` (the `.data` of the route's own request taken off) and the query the
 *   request's own text (`queryOf`: `_routes` dropped, nothing decoded), so the `.data` request of a canonical view answers its data. No call is made before these. An owner that is
 *   no address on a first page is the form's error under the field, a 200 of class `short` with no call for the NFTs.
 * - **Behind a marker** (spec 3.2): #1 and #4, awaited whole, class `MARKER_PAGE_CLASS`. `collection not found` is a 404 that names the collection (`collectionNotFound`), the API
 *   refusing the marker (a 400) or nothing behind it is a 404 of class `short`, and any other failure, a "Cannot GET" of a data API without D3 included, a 503 (`upstreamOutage`).
 * - **A first page** (spec 3.2): #1 the collection, #2 `last_validated` (kept 2 s, the home page's key) and #4 the tab's list side by side, #3 the stats of the 30 days to #2's day (kept
 *   300 s) after #2, which works the window out from it (`anchoredWindow`). Each call, and the chain of #2 and #3, has failed when it has not answered `CARD_DEADLINE_MS` after the
 *   loader began ("took too long"). #1 is the page's own: `collection not found` is the 404 above, any other failure a 503. The others are cards: a failed one is told in its place and
 *   logged under its name, and the request is degraded, served and not stored. A `last_validated` with no number in it fails the chart and the 30-day stats and is logged as their
 *   failure: it is #3's, which gives up before it asks. Nothing is deferred and nothing polls, so no call asks for the failure hold.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  const words = nftWords(net.id);
  if (!net.features.nfts) notFound({ notFound: `the ${words.token} pages` });

  const { issuer } = params;
  const askedTaxon = params.taxon;
  const taxon = askedTaxon === undefined ? undefined : parseTaxon(askedTaxon);
  if (!isValidClassicAddress(issuer) || taxon === null) notFound({ notFound: `${words.token} collection ${echoOf(askedTaxon === undefined ? issuer : `${issuer}/${askedTaxon}`)}` });
  // The key of the network: a taxon is XRPL's alone.
  const key: CollectionKey = net.id === "xrpl" && taxon !== undefined ? { issuer, taxon: taxon.taxon } : { issuer };
  const olderNotFound = `that page of ${words.token} collection ${collectionLabel(key)}`;

  const search = queryOf(request.url);
  const query = parseCollectionParams(new URLSearchParams(search));
  const ownerIsAddress = query.owner === undefined || isValidClassicAddress(query.owner);
  // A marker is checked before the redirects, which would otherwise lead to a URL that holds it.
  if (query.marker !== undefined && (!isMarker(query.marker) || !ownerIsAddress)) notFound({ notFound: olderNotFound });
  // The other network's form of the key: XRPL's collections are an issuer and a taxon, so an issuer alone is the list of its collections; Xahau's are an issuer.
  if (net.id === "xrpl" && taxon === undefined) return redirect(nftsHref(net.id, { issuer }), { status: 302, headers: cacheClassHeaders("short") });
  if (net.id === "xahau" && taxon !== undefined) return redirect(collectionHref(net.id, key, query), { status: 302, headers: cacheClassHeaders("short") });
  const tidied = redirectToHref({ path: url.pathname, search }, collectionHref(net.id, key, query));
  if (tidied) return tidied;

  return query.marker === undefined
    ? firstPage(context, request, started, net, key, query, ownerIsAddress ? undefined : OWNER_ERROR)
    : markerPage(context, request, net, key, query, olderNotFound);
}

/** What a failed #1 is: the 404 that names the collection for one the API does not have, else a 503. */
function collectionFailure(net: Network, key: CollectionKey, reason: unknown, request: Request): never {
  const outage = asOutage(reason);
  if (isNotFound(outage)) notFound({ notFound: missing(net, key) });
  logProblem(failedWords("", reason), reason, request);
  return upstreamOutage(outage, `the ${nftWords(net.id).token} collection`);
}

/** A page of the tab's list behind a marker (spec 3.2): #1 and #4, awaited whole. */
async function markerPage(context: Route.LoaderArgs["context"], request: Request, net: Network, key: CollectionKey, query: CollectionQuery, olderNotFound: string) {
  const { api } = clientsFor(context, net);
  const [collection, list] = await Promise.allSettled([api.nftCollection(key), listOf(api, key, query)]);
  if (collection.status === "rejected") return collectionFailure(net, key, collection.reason, request);
  if (list.status === "rejected") {
    // The API refuses a marker that is not one of its own (a 400): the page does not exist.
    if (list.reason instanceof UpstreamError && list.reason.kind === "bad_request") notFound({ notFound: olderNotFound });
    logProblem(`the NFT collection page behind a marker could not load its page of ${query.tab}`, list.reason, request);
    return upstreamOutage(list.reason, `the ${nftWords(net.id).token} collection's older rows`);
  }
  // A marker past the last row has nothing behind it.
  if (rowsIn(list.value) === 0) notFound({ notFound: olderNotFound });
  return cached(collectionMarkerPage({ net, key, query, collection: collection.value, list }), MARKER_PAGE_CLASS);
}

/** The first page (spec 3.2): the four calls, and the page from what came. */
async function firstPage(context: Route.LoaderArgs["context"], request: Request, started: number, net: Network, key: CollectionKey, query: CollectionQuery, ownerError: string | undefined) {
  const { api } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  // #2 is the anchor of the chart: #3 asks for the 30 days up to its UTC day (E2's window), with a TTL of its own. A last_validated that gives no anchor throws here, and #3 is
  // rejected with it, which the card is told as and the problems below log.
  const lastCall = api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS });
  const statsCall = lastCall.then((last) => {
    const window = anchoredWindow(anchorOrThrow(last), "30d");
    return api.nftCollectionStats(key, { start: window.start, end: window.end });
  });
  const listCall = ownerError === undefined ? outcome(byDeadline(listOf(api, key, query), deadline)) : null;

  const [[collection, last, stats], list] = await Promise.all([
    Promise.allSettled([byDeadline(api.nftCollection(key), deadline), byDeadline(lastCall, deadline), byDeadline(statsCall, deadline)]),
    listCall,
  ]);
  if (collection.status === "rejected") return collectionFailure(net, key, collection.reason, request);

  const input = {
    net,
    key,
    query,
    ...(ownerError === undefined ? {} : { ownerError }),
    collection: collection.value,
    last,
    // Not asked when #2 failed: the chain failed with it.
    stats: last.status === "rejected" ? null : stats,
    list,
  };

  // The settled results hold the reasons, which the page does not: each is logged under its card's name, and the request is degraded.
  const problems = [
    ["newest ledger", last],
    ["daily figures", input.stats],
    [query.tab === "nfts" ? nftWords(net.id).tokens : query.tab, list],
  ] as const;
  const failed = problems.flatMap(([part, result]) => (result?.status === "rejected" ? [{ part, reason: result.reason as unknown }] : []));
  for (const { part, reason } of failed) logProblem(failedWords(part, reason), reason, request);
  if (failed.length > 0) markDegraded(context, `nft collection: ${failed.map(({ part }) => part).join(", ")}`);

  return cached(nftCollectionPage(input), ownerError === undefined ? "minute" : "short");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return nftCollectionMeta(loaderData, ctx);
}

export default function NftCollection({ loaderData }: Route.ComponentProps) {
  return <NftCollectionPage data={loaderData} />;
}
