import { isValidClassicAddress } from "ripple-address-codec";

import { nftsHref, nftWords, parseNftsParams } from "../domain/nft-params";
import { queryOf } from "../domain/query-of";
import { HOME_CALL_TTL_SECONDS, MARKER_PAGE_CLASS, PERIOD_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { anchorOrThrow } from "../server/anchor";
import { byDeadline, CARD_DEADLINE_MS, outcome, TooLate } from "../server/deadline";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { nftsMeta } from "../server/meta-nfts";
import { anchoredWindow, seriesQuery } from "../server/network-view";
import { requireNetwork } from "../server/network-route";
import { nftsListPage, nftsMarkerPage } from "../server/nfts-view";
import { redirectToHref } from "../server/pair-route";
import { UpstreamError } from "../server/upstream";
import { NftsPage } from "../ui/pages/NftsPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.nfts._index";

// The loader names a cache class (`minute`; `short` for a form error; `MARKER_PAGE_CLASS` behind a marker), answers its 404s with class `short`, and tidies a path or a query with a
// redirect (`immutable` for the path alone, `short` with the query). A 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its NFTs item as the page of the section (`aria-current="page"`).
export const handle = { navSection: "nfts" } satisfies NetworkRouteHandle;

/** The collections of a page of the list, and the sales of its recent sales (spec 2.2). */
const COLLECTIONS_PAGE = 20;
const RECENT_SALES = 10;

/** What the form says of an issuer that is no classic address (spec 1.3). */
const ISSUER_ERROR = "Write a classic address (r…).";

/**
 * `/{net}/nfts` (NFT spec 2): the sales of the network's NFTs (URITokens on Xahau) in a period, the 30 days of volume, the largest collections, the newest sales and the
 * collections by volume, supply or holders.
 *
 * - **Validation first** (spec 1.2, 1.3). `NFTS` off is the not-found page, a 404 of class `short`, for every view. Then a `marker` that is none is a 404 of class `short`, before
 *   the redirect, which would otherwise lead to a URL that holds it; so is a marker with an issuer that is no classic address (a page behind a marker is the collections table
 *   of a list that was asked for, and there is no such list to show a form error in front of). A path or a query that is not the canonical one is a 302 to the one URL
 *   (`redirectToHref`: class `immutable` for the path alone, `short` with the query). The path is React Router's `url` (the `.data` of the route's own request taken off)
 *   and the query the request's own text (`queryOf`: `_routes` dropped, nothing decoded), so the `.data` request of a canonical view answers its data. No call is made before
 *   these. An issuer on a first page that is no classic address is the form's error under the field, a 200 of class `short` with no call for the collections.
 * - **Five calls, side by side, all awaited** (spec 2.2): #1 `last_validated` (kept 2 s, the home page's key), #2 the live volume of the period, #3 the 30 days up to #1's day
 *   (kept 300 s), which waits for #1 and works the window out from it (`anchoredWindow`), #4 the newest sales and #5 the first page of the collections. Each call, and the chain
 *   of #1 and #3, has failed when it has not answered `CARD_DEADLINE_MS` after the loader began ("took too long"). Nothing is deferred and nothing polls, so no call asks for the
 *   failure hold.
 * - **A card that failed is told in its place** (`nftsListPage`), and logged under its name; the request is then degraded, served and not stored. A "Cannot GET" (a data API
 *   without D3 behind a switch that is on) is kind `server`: a failed card, never a stored 404. A `last_validated` with no number in it fails the chart and is logged as the
 *   chart's failure: it is #3's, which gives up before it asks.
 * - **A page behind a marker** (spec 1.3, 2.2) makes call #5 alone, awaited whole: the API refusing the marker (a 400), or nothing behind it, is a 404 of class `short`, and any
 *   other failure a 503 (`upstreamOutage`). It is `MARKER_PAGE_CLASS`.
 * - **The class is `minute`** (spec 9) for the first page: the aggregator's sets change at its minute. A page whose issuer is no address is `short`.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  const words = nftWords(net.id);
  if (!net.features.nfts) throw cached({ notFound: `the ${words.token} pages` }, "short", { status: 404 });

  /** What the not-found page says of a page of the list that is not there. */
  const moreNotFound = `that page of the ${words.token} collections`;
  const search = queryOf(request.url);
  const query = parseNftsParams(new URLSearchParams(search));
  const issuerIsAddress = query.issuer === undefined || isValidClassicAddress(query.issuer);
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (query.marker !== undefined && (!isMarker(query.marker) || !issuerIsAddress)) throw cached({ notFound: moreNotFound }, "short", { status: 404 });
  const tidied = redirectToHref({ path: url.pathname, search }, nftsHref(net.id, query));
  if (tidied) return tidied;

  const { api } = clientsFor(context, net);
  const collectionsQuery = { limit: COLLECTIONS_PAGE, sort: query.sort, descending: query.order === "desc", issuer: query.issuer };

  if (query.marker !== undefined) {
    // The API refuses a marker that is not one of its own (a 400), and a marker past the last collection has nothing behind it: that page does not exist.
    const page = await api.nftCollections({ ...collectionsQuery, marker: query.marker }).catch((err: unknown) => {
      if (err instanceof UpstreamError && err.kind === "bad_request") throw cached({ notFound: moreNotFound }, "short", { status: 404 });
      return upstreamOutage(err, `the ${words.token} collections`);
    });
    if (page.collections.length === 0) throw cached({ notFound: moreNotFound }, "short", { status: 404 });
    return cached(nftsMarkerPage(net, query, page), MARKER_PAGE_CLASS);
  }

  const deadline = started + CARD_DEADLINE_MS;
  // #1 is the anchor of the chart: #3 asks for the 30 days up to its UTC day (E2's window), with a TTL of its own. A last_validated that gives no anchor throws here, and #3 is
  // rejected with it, which the card is told as and the problems below log.
  const lastCall = api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS });
  const dailyCall = lastCall.then((last) => api.nftVolume(seriesQuery(anchoredWindow(anchorOrThrow(last), "30d")), { ttl: PERIOD_CALL_TTL_SECONDS }));
  const collectionsCall = issuerIsAddress ? outcome(byDeadline(api.nftCollections(collectionsQuery), deadline)) : null;

  const [[last, live, daily, sales], collections] = await Promise.all([
    Promise.allSettled([
      byDeadline(lastCall, deadline),
      byDeadline(api.nftVolume({ live: query.period }), deadline),
      byDeadline(dailyCall, deadline),
      byDeadline(api.nftSales({ descending: true, limit: RECENT_SALES }), deadline),
    ]),
    collectionsCall,
  ]);

  const input = {
    net,
    query,
    ...(issuerIsAddress ? {} : { issuerError: ISSUER_ERROR }),
    last,
    live,
    // Not asked when #1 failed: the chain failed with it.
    daily: last.status === "rejected" ? null : daily,
    sales,
    collections,
  };

  // The settled results hold the reasons, which the page does not: each is logged under its card's name, and the request is degraded.
  const problems = [
    ["newest ledger", last],
    ["totals", live],
    ["sales volume", input.daily],
    ["recent sales", sales],
    ["collections", collections],
  ] as const;
  const failed = problems.flatMap(([part, result]) => (result?.status === "rejected" ? [{ part, reason: result.reason as unknown }] : []));
  for (const { part, reason } of failed) logProblem(`the NFT list's ${part} ${reason instanceof TooLate ? "took too long" : "could not be loaded"}`, reason, request);
  if (failed.length > 0) markDegraded(context, `nft list: ${failed.map(({ part }) => part).join(", ")}`);

  return cached(nftsListPage(input), issuerIsAddress ? "minute" : "short");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return nftsMeta(loaderData, ctx);
}

export default function Nfts({ loaderData }: Route.ComponentProps) {
  return <NftsPage data={loaderData} />;
}
