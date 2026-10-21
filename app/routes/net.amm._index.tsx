import { ammListPath, ammListQuery, parseAmmListParams, type AmmListQuery } from "../domain/amm-params";
import { assetText, parseAssetText } from "../domain/asset";
import { queryOf } from "../domain/query-of";
import { utcDayOf, windowOf } from "../domain/window";
import { ammListPage, noAmmPage, type AmmListInput } from "../server/amm-view";
import { anchorOrThrow } from "../server/anchor";
import { HOME_CALL_TTL_SECONDS, PERIOD_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { byDeadline, CARD_DEADLINE_MS, outcome } from "../server/deadline";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { ammListMeta } from "../server/meta-amm-list";
import { requireNetwork } from "../server/network-route";
import { redirectToCanonical } from "../server/pair-route";
import { UpstreamError } from "../server/upstream";
import { AmmListPage } from "../ui/pages/AmmListPage";
import { NoAmmPage } from "../ui/pages/NoAmmPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.amm._index";

// The loader names a cache class (`live`; `short` for an asset that does not parse; `slow` for Xahau's page), answers its 404s with class `short`,
// and tidies a path or a query with a redirect (`immutable` for the path alone, `short` with the query).
export const headers = forwardCacheClass;

// The header marks its AMM item as the page of the section (`aria-current="page"`).
export const handle = { navSection: "amm" } satisfies NetworkRouteHandle;

/** The pools of a page of the list (spec 2.2). */
const POOLS_PAGE = 20;

/** The rows the 30-day call asks for: the network page's (its `SERIES_LIMIT`), so that the call is that page's 30-day view, under its key (spec 4). */
const SERIES_LIMIT = 1000;

/** What the not-found page says of a page of the list that is not there: a marker that is none, one the API refuses, or one with nothing behind it. */
const MORE_NOT_FOUND = "that page of the AMM pools";

/**
 * The failure of an API without the AMM routes: its framework's `Cannot GET` 404, which E2's missing-route rule (data-api.ts, `throwUnlessOk`) makes
 * the one 404 of kind `server` (every other 404 is `not_found`).
 */
const isMissingRoute = (reason: unknown): boolean => reason instanceof UpstreamError && reason.kind === "server" && reason.status === 404;

/**
 * `/{net}/amm` (AMM spec 2): the pools of the network's AMM, the most valuable first, with the swap volume of the last 24 hours and of the last 30 days.
 *
 * - **Validation first** (spec 1.2, 1.3, 2.3). `AMM_PAGES` off is the not-found page, a 404 of class `short`, for every view. A network without AMM
 *   (Xahau) is the explanation (`NoAmmPage`), class `slow`, and any query or other spelling of its path is a 302 to the bare path. Then a `marker`
 *   that is none is a 404 of class `short`, before the redirect, which would otherwise lead to a URL that holds it. A path or a query that is not
 *   the canonical one is a 302 to the one URL (`redirectToCanonical`: class `immutable` for the path alone, `short` with the query): the asset read
 *   with E3's `parseAssetText` and written back with `assetText`; one that does not parse keeps the text it was given and `deleted`, and has no
 *   page behind a marker. The path is React Router's `url` (the `.data` of the route's own request taken off) and the query the request's own text
 *   (`queryOf`: `_routes` dropped, nothing decoded), so the `.data` request of a canonical view answers its data. No call is made before these.
 * - **Four calls, side by side, all awaited** (spec 2.2, 2.3): #1 `last_validated` (kept 2 s, the home page's key), #2 the page of pools (none for
 *   an asset that does not parse), #3 the live set of the last 24 hours, and #4 the 30 days up to #1's day (kept 300 s, the network page's call and
 *   key), which waits for #1. Each call, and the chain of #1 and #4, has failed when it has not answered `CARD_DEADLINE_MS` after the loader began
 *   ("took too long"). Nothing is deferred and nothing polls, so no call asks for the failure hold.
 * - **A page behind a marker that is not there** (spec 1.3): the API refusing the marker (a 400), or nothing behind it, is a 404 of class `short`.
 *   On the first page there is no marker to refuse: a 400 there is the API failing, and the Pools card's failure, never a stored 404.
 * - **A card that failed is told in its place** (`ammListPage`), and logged; the request is then degraded, served and not stored. The live set of an
 *   API without the route is logged as what it is: the data API serves no AMM volume.
 * - **The class is `live`** (spec 2.3, 4), for the first page and a page behind a marker alike: a render reads only entries kept 60 s and 300 s.
 *   A page of an asset that does not parse is `short`: a typo is a page nobody asks for again.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  if (!net.features.ammPages) throw cached({ notFound: "the AMM pages" }, "short", { status: 404 });

  const search = queryOf(request.url);
  const asked = { path: url.pathname, search: search === "" ? "" : `?${search}` };
  // A network without AMM has one page, whatever the query asks for, and makes no call.
  if (!net.hasAmm) return redirectToCanonical(asked, { path: ammListPath(net.id), search: "" }) ?? cached(noAmmPage(net), "slow");

  const query = parseAmmListParams(new URLSearchParams(search));
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (query.marker !== undefined && !isMarker(query.marker)) throw cached({ notFound: MORE_NOT_FOUND }, "short", { status: 404 });
  const asset = query.asset === undefined ? null : parseAssetText(query.asset, net);
  const typo = query.asset !== undefined && asset === null ? query.asset : null;
  const view: AmmListQuery =
    typo !== null
      ? { asset: typo, deleted: query.deleted, back: [] }
      : { ...(asset === null ? {} : { asset: assetText(asset) }), deleted: query.deleted, ...(query.marker === undefined ? {} : { marker: query.marker }), back: query.back };
  const tidied = redirectToCanonical(asked, { path: ammListPath(net.id), search: ammListQuery(view) });
  if (tidied) return tidied;

  const { api } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  // #1 is the anchor of the chart: #4 asks for the 30 days up to its UTC day, and fails with it.
  const lastCall = api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS });
  const monthCall = lastCall.then((last) => {
    const window = windowOf(utcDayOf(anchorOrThrow(last).closeTime), "30d");
    return api.ammVolume({ interval: window.unit, start: window.start, end: window.end, limit: SERIES_LIMIT }, { ttl: PERIOD_CALL_TTL_SECONDS });
  });
  const poolsCall =
    typo !== null
      ? null
      : outcome(byDeadline(api.ammPools({ limit: POOLS_PAGE, asset: asset ?? undefined, includeDeleted: view.deleted, marker: view.marker }), deadline));

  const [[last, live, month], pools] = await Promise.all([
    Promise.allSettled([byDeadline(lastCall, deadline), byDeadline(api.ammVolume({ live: "day" }), deadline), byDeadline(monthCall, deadline)]),
    poolsCall,
  ]);

  if (view.marker !== undefined && pools !== null) {
    // The API refuses a marker that is not one of its own (a 400), and a marker past the last pool has nothing behind it: that page does not exist.
    const refused = pools.status === "rejected" && pools.reason instanceof UpstreamError && pools.reason.kind === "bad_request";
    const empty = pools.status === "fulfilled" && Array.isArray(pools.value?.pools) && pools.value.pools.length === 0;
    if (refused || empty) throw cached({ notFound: MORE_NOT_FOUND }, "short", { status: 404 });
  }

  const input: AmmListInput = {
    net,
    asset: typo !== null ? { error: typo } : asset === null ? null : { asset, text: assetText(asset) },
    deleted: view.deleted,
    ...(view.marker === undefined ? {} : { marker: view.marker }),
    back: view.back,
    last,
    pools,
    live,
    // Not asked when #1 failed: the chain failed with it.
    history: last.status === "rejected" ? null : month,
  };
  const { page, problems } = ammListPage(input);
  // The problems are in the page's order, the totals first: when #3 failed, the first is its, and an API without the route is said for what it is.
  const noVolume = live.status === "rejected" && isMissingRoute(live.reason);
  problems.forEach((problem, at) => {
    logProblem(at === 0 && noVolume ? "the data API serves no AMM volume" : "the AMM pools page could not load a card", problem, request);
  });
  if (problems.length > 0) markDegraded(context, `amm list: ${problems.join("; ")}`);

  return cached(page, typo !== null ? "short" : "live");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return ammListMeta(loaderData.kind === "none" ? { none: true } : loaderData.meta, ctx);
}

export default function AmmList({ loaderData }: Route.ComponentProps) {
  return loaderData.kind === "none" ? <NoAmmPage data={loaderData} /> : <AmmListPage data={loaderData} />;
}
