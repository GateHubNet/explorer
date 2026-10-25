import { isValidClassicAddress } from "ripple-address-codec";

import { accountHref } from "../domain/account-tabs";
import { ammPoolPath, ammPoolQuery, parseAmmPoolParams, type AmmPoolQuery } from "../domain/amm-params";
import type { Asset } from "../domain/asset";
import { shortAddress } from "../domain/format";
import { queryOf } from "../domain/query-of";
import { utcDayOf } from "../domain/window";
import { anchorOrThrow } from "../server/anchor";
import { ammHistoryPage, ammPoolPage, MODE_CLASS, poolModeOf, poolQueries, storedPair, TAB_LIST, type AmmActivityPage, type PoolQueries } from "../server/amm-view";
import type { LastValidated } from "../server/api-types";
import { HOME_CALL_TTL_SECONDS, MARKER_PAGE_CLASS, PERIOD_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import type { DataApi } from "../server/data-api";
import { asOutage, byDeadline, CARD_DEADLINE_MS } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { ammPoolMeta } from "../server/meta-amm-pool";
import { requireNetwork } from "../server/network-route";
import { anchoredWindow } from "../server/network-view";
import { networkOf, type Network } from "../server/networks";
import { redirectToCanonical } from "../server/pair-route";
import { isMissingRoute, isNotFound, UpstreamError } from "../server/upstream";
import { AmmPoolPage } from "../ui/pages/AmmPoolPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.amm.$pool";

// The loader names a cache class (by the pool's mode: `live`, `slow` for a deleted pool, `short` kept 60 s for one shown from the network;
// `MARKER_PAGE_CLASS` behind a marker), answers its 404s with class `short`, and tidies a path or a query with a redirect (`immutable` for the
// path alone, `short` with the query); a degraded answer and a 503 are not stored.
export const headers = forwardCacheClass;

// The header marks its AMM item as the section the page is in (`aria-current="true"`).
export const handle = { navSection: "amm" } satisfies NetworkRouteHandle;

/** The rows of a page of the tab (spec 3.2, #7). */
const ROWS_PAGE = 20;

/** What the not-found page says of a page of older rows that is not there: a marker that is none, one the API refuses, or one with nothing behind it. */
const OLDER_NOT_FOUND = "that page of the AMM pool";

/**
 * Logs a failure that leaves no page (a 503): an API without the AMM routes (its "Cannot GET", `isMissingRoute`) as what it is, anything else in the words of
 * the part that failed.
 */
function logOutage(what: string, reason: unknown, request: Request): void {
  logProblem(isMissingRoute(reason) ? "the data API serves no AMM pools" : what, reason, request);
}

/** #7: the page of the tab of the query, newest first, behind the query's marker when it has one. */
function activityOf(api: DataApi, pool: string, query: AmmPoolQuery): Promise<AmmActivityPage> {
  const q = { descending: true, limit: ROWS_PAGE, marker: query.marker };
  switch (query.tab) {
    case "swaps":
      return api.ammSwaps(pool, q);
    case "liquidity":
      return api.ammLiquidity(pool, q);
    case "governance":
      return api.ammGovernance(pool, q);
  }
}

/**
 * `/{net}/amm/{pool}` (AMM spec 3): one pool of the network's AMM, by its account. Its class is the pool's mode's (`MODE_CLASS`): `live` for a pool the index
 * serves, `slow` for a deleted one, `short` kept the aggregator's minute (60 s) for one shown from the network.
 *
 * - **Validation first** (spec 1.3). `AMM_PAGES` off is the not-found page, for every view. A pool that is not a classic address with a valid checksum (an
 *   X-address included: a pool takes no tag) is a 404 that repeats what was asked (`echoOf`). On a network without AMM (Xahau) a valid address is a 404
 *   with a note that says why and the way to the pool on the XRP Ledger. Then a `marker` that is none is a 404, before the redirect, which would otherwise
 *   lead to a URL that holds it; and a path or a query that is not the canonical one is a 302 to the one URL (`redirectToCanonical` with `ammPoolPath` and
 *   `ammPoolQuery`). The path is React Router's `url` (the `.data` of the route's own request taken off) and the query the request's own text (`queryOf`:
 *   `_routes` dropped, nothing decoded), so the `.data` request of a canonical view answers its data. No call is made before these.
 * - **Behind a marker** (spec 3.3, step 2): #1 and #7, awaited whole, and stored as `MARKER_PAGE_CLASS`. The index's `pool not found`, the API refusing the
 *   marker (a 400) or nothing behind it is a 404; any other failure a 503. A list whose rows do not build is a failed card, logged, and the request degraded.
 * - **A first page** (spec 3.3, step 3): every call side by side, each call and chain raced to `CARD_DEADLINE_MS` from the start of the loader ("took too
 *   long"), all awaited (`Promise.allSettled`). Then the mode, from #1 and #2 (`poolModeOf`): neither has the pool, a 404 that offers the account page; the
 *   index failed, or it has no such pool and the node failed, a 503 (the reason of the call that decides it, a missed deadline as an outage: `asOutage`).
 *   Otherwise the page (`ammPoolPage`): each card that failed is told in its place and logged, and the request is degraded, served and not stored. A missing
 *   creation event leaves out the Created line and is logged; the page is whole without it, and is stored.
 * - Nothing is deferred and nothing polls, so no call asks for the failure hold.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  if (!net.features.ammPages) notFound({ notFound: "the AMM pages" });

  const pool = params.pool;
  if (!isValidClassicAddress(pool)) notFound({ notFound: `AMM pool ${echoOf(pool)}` });
  // A network without AMM has no pool, so no call is made; the visitor is shown the way to the network that has them.
  if (!net.hasAmm) {
    const other = networkOf(net.other, getEnv(context));
    notFound({
      notFound: `AMM pool ${shortAddress(pool)}`,
      suggestion: { href: ammPoolPath(other.id, pool), label: `Open it on ${other.name}` },
      note: `${net.name} has no AMM, so this pool exists only on ${other.longName}.`,
    });
  }

  const search = queryOf(request.url);
  const query = parseAmmPoolParams(new URLSearchParams(search));
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (query.marker !== undefined && !isMarker(query.marker)) notFound({ notFound: OLDER_NOT_FOUND });
  const tidied = redirectToCanonical(
    { path: url.pathname, search: search === "" ? "" : `?${search}` },
    { path: ammPoolPath(net.id, pool), search: ammPoolQuery(query) },
  );
  if (tidied) return tidied;

  return query.marker === undefined ? firstPage(context, request, started, net, pool, query) : olderRows(context, request, net, pool, query);
}

/** A page of older rows (spec 3.3, step 2): #1 and #7, awaited whole. */
async function olderRows(context: Route.LoaderArgs["context"], request: Request, net: Network, pool: string, query: AmmPoolQuery) {
  const { api } = clientsFor(context, net);
  const [index, activity] = await Promise.allSettled([api.ammPool(pool), activityOf(api, pool, query)]);
  if (index.status === "rejected") {
    if (isNotFound(index.reason)) notFound({ notFound: `AMM pool ${shortAddress(pool)}` });
    logOutage("the AMM pool page behind a marker could not load the pool", index.reason, request);
    return upstreamOutage(index.reason, "the AMM pool's older rows");
  }
  if (activity.status === "rejected") {
    // The API refuses a marker that is not one of its own (a 400): the page does not exist.
    if (activity.reason instanceof UpstreamError && activity.reason.kind === "bad_request") notFound({ notFound: OLDER_NOT_FOUND });
    logOutage(`the AMM pool page behind a marker could not load its page of ${query.tab}`, activity.reason, request);
    return upstreamOutage(activity.reason, "the AMM pool's older rows");
  }
  // The tab's list (amm-view's `TAB_LIST`): a page behind a marker has nothing in it when it is past the last row.
  const rows = (activity.value as Partial<Record<string, unknown>>)[TAB_LIST[query.tab]];
  if (Array.isArray(rows) && rows.length === 0) notFound({ notFound: OLDER_NOT_FOUND });

  // A list whose rows do not build is a card that says so: logged, and the request degraded, so it is served and never stored as the page behind the marker.
  const { page, problems } = ammHistoryPage({ net, pool, query, index: index.value, activity: activity.value });
  for (const problem of problems) logProblem("the AMM pool page behind a marker could not load a card", problem, request);
  if (problems.length > 0) markDegraded(context, `amm pool behind a marker: ${problems.join("; ")}`);
  return cached(page, MARKER_PAGE_CLASS);
}

/** The first page (spec 3.2, 3.3): the ten calls, the mode, and the page from what came. */
async function firstPage(context: Route.LoaderArgs["context"], request: Request, started: number, net: Network, pool: string, query: AmmPoolQuery) {
  const { api, node } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const race = <T,>(work: Promise<T>) => byDeadline(work, deadline);

  // #1 and #2 decide the mode; #2 runs beside #1, so the page waits for the slower of the two, not their sum.
  const indexCall = api.ammPool(pool);
  const nodeCall = node.ammInfo(pool);
  // #3 is the window's anchor: #4, #5 and #10 ask for its days, and fail with it (the home page's key, kept 2 s).
  const lastCall = api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS });
  const queries = lastCall.then((last: LastValidated): PoolQueries => {
    const anchor = anchorOrThrow(last);
    return poolQueries(anchoredWindow(anchor, query.period), utcDayOf(anchor.closeTime));
  });
  // The pair, in the order the API stores it, for #6: the index's, else (the index has no such pool yet) the node's two assets.
  const pairCall = indexCall.then(
    (index): [Asset, Asset] => storedPair({ index }),
    async (reason: unknown): Promise<[Asset, Asset]> => {
      if (!isNotFound(reason)) throw reason;
      return storedPair({ node: await nodeCall });
    },
  );

  const [index, info, last, days, carryIn, lastDay, candles, activity, created, live] = await Promise.allSettled([
    race(indexCall),
    race(nodeCall),
    race(lastCall),
    race(queries.then((q) => api.ammPoolDays(pool, q.days))),
    race(queries.then((q) => api.ammPoolDays(pool, q.carryIn))),
    race(queries.then((q) => api.ammPoolDays(pool, q.lastDay))),
    race(
      Promise.all([queries, pairCall]).then(([q, [base, counter]]) => api.pairCandles(base, counter, q.candles, { cls: "slow", ttl: PERIOD_CALL_TTL_SECONDS })),
    ),
    race(activityOf(api, pool, query)),
    race(api.ammLiquidity(pool, { event: "create", limit: 1 })),
    race(api.ammVolume({ live: "day" })),
  ]);

  const mode = poolModeOf(index, info);
  if (mode === "none") {
    notFound({ notFound: `AMM pool ${shortAddress(pool)}`, suggestion: { href: accountHref(net.id, pool, {}), label: "Open it as an account" } });
  }
  if (mode === "unavailable") {
    // The call that decides it: the index's failure, or the node's when the index has no such pool (its `Retry-After`).
    const reason = index.status === "rejected" && !isNotFound(index.reason) ? index.reason : info.status === "rejected" ? info.reason : undefined;
    logOutage("the AMM pool page cannot tell the pool's mode", reason, request);
    return upstreamOutage(asOutage(reason), "the AMM pool");
  }

  // Not asked when #3 failed: the chains failed with it.
  const anchored = last.status === "fulfilled";
  const { page, problems, logged } = ammPoolPage({
    net,
    pool,
    query,
    mode,
    index: index.status === "fulfilled" ? index.value : null,
    node: info,
    last,
    days: anchored ? days : null,
    carryIn: anchored ? carryIn : null,
    lastDay: anchored ? lastDay : null,
    candles: anchored ? candles : null,
    activity,
    created,
    live,
  });
  for (const problem of problems) logProblem("the AMM pool page could not load a card", problem, request);
  for (const line of logged) logProblem("the AMM pool page left a line out", line, request);
  if (problems.length > 0) markDegraded(context, `amm pool: ${problems.join("; ")}`);

  const { cls, ttl } = MODE_CLASS[mode];
  return cached(page, cls, ttl === undefined ? {} : { ttl });
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return ammPoolMeta(loaderData.meta, ctx);
}

export default function AmmPool({ loaderData }: Route.ComponentProps) {
  return <AmmPoolPage data={loaderData} />;
}
