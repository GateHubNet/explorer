import { redirect } from "react-router";

import { ammPoolPath } from "../domain/amm-params";
import { queryOf } from "../domain/query-of";
import { displayPair } from "../server/amm-view";
import { clientsFor } from "../server/clients";
import { echoOf } from "../server/echo";
import { cacheClassHeaders, forwardCacheClass } from "../server/edge-cache";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { requireNetwork } from "../server/network-route";
import { parsePairPath } from "../server/pair-route";
import { isMissingRoute, UpstreamError } from "../server/upstream";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.amm.$base.$counter";

// The loader answers a redirect to the pool (`slow` to a live pool, `short` to a deleted one), and its 404s with class `short`; a 503 is not stored.
export const headers = forwardCacheClass;

// The header marks its AMM item as the section the page is in, on the not-found page this route answers with.
export const handle = { navSection: "amm" } satisfies NetworkRouteHandle;

/**
 * `/{net}/amm/{base}/{counter}` (AMM spec 1.2, 1.3): the pool of a pair, as a redirect to its page, `/{net}/amm/{pool}`. The route has no page of its own.
 *
 * - **Validation first.** `AMM_PAGES` off is the not-found page; so is any pair on a network without AMM (Xahau), before the path is read: no pool exists
 *   there. Then each of the two segments is read with E3's `parseAssetText` (`parsePairPath`, the market pair route's reading of its path); a segment that
 *   is no asset, or the same asset twice, is a 404 that repeats what was asked (`echoOf`). A query is no part of the route: it is a 302 to the bare path.
 *   No call is made before these.
 * - **One call**, `ammPoolByPair`: the live pool of the pair, else the one deleted last, in either order of the assets. Found: a 302 to its page, class
 *   `slow` for a live pool and `short` for a deleted one (a new pool of the pair may come). The index's `pool not found`: a 404 that names the pair in its
 *   natural orientation (`XRP/USD`). Anything else, the "Cannot GET" of an API without the AMM routes included, is a 503.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const net = requireNetwork(context, params);
  if (!net.features.ammPages) notFound({ notFound: "the AMM pages" });
  const asked = `${params.base}/${params.counter}`;
  if (!net.hasAmm) notFound({ notFound: `an AMM pool for ${echoOf(asked)}`, note: `${net.name} has no AMM.` });

  const path = parsePairPath(net, url.pathname);
  if (path.kind === "not-a-pair") notFound({ notFound: `an AMM pool for ${echoOf(path.asked)}` });
  if (queryOf(request.url) !== "") return redirect(url.pathname, { status: 302, headers: cacheClassHeaders("short") });

  const { api } = clientsFor(context, net);
  try {
    const pool = await api.ammPoolByPair(path.base, path.counter);
    return redirect(ammPoolPath(net.id, pool.amm_account), { status: 302, headers: cacheClassHeaders(pool.deleted ? "short" : "slow") });
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "not_found") {
      notFound({ notFound: `an AMM pool for ${displayPair(path.base, path.counter, net.native).slug}` });
    }
    if (isMissingRoute(error)) logProblem("the data API serves no AMM pools", error, request);
    return upstreamOutage(error, "the AMM pool of the pair");
  }
}

/** Never drawn: the loader always redirects or throws. The route has a component so that its 404 is the layout's HTML page. */
export default function AmmPair() {
  return null;
}
