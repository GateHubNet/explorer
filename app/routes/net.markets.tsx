import { marketsHref, parseMarketsParams, PERIODS, TRADES_API } from "../domain/market-params";
import { queryOf } from "../domain/network-params";
import { clientsFor } from "../server/clients";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { upstreamOutage } from "../server/loader-errors";
import { marketsPage } from "../server/markets-view";
import { metaContext } from "../server/meta";
import { marketsMeta } from "../server/meta-markets";
import { requireNetwork } from "../server/network-route";
import { redirectToCanonical } from "../server/pair-route";
import { MarketsPage } from "../ui/pages/MarketsPage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.markets";

// The loader names a cache class (`minute`), answers a 404 of class `short` while `MARKETS` is off, and tidies a path or a query string with a
// redirect (`immutable` for the path alone, `short` with the query); a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Markets item as the page of the section (`aria-current="page"`).
export const handle = { navSection: "markets" } satisfies NetworkRouteHandle;

/** The markets one call asks for: the page's weight is bounded by it (spec 2.3), and the footnote says when more pairs qualify. */
const MARKETS_LIMIT = 1000;

/**
 * `/{net}/markets` (markets spec 2): the trade statistics of every pair of the network's DEX over a period, from the data API's one markets call.
 *
 * - **Validation first** (spec 2.4). `MARKETS` off is the not-found page, a 404 of class `short`, for every view and before the query is read.
 *   A path that is not the route's own (`/xrpl/markets/`, `/xrpl/Markets`) is a 302 to it, as the pair route's (class `immutable`, or
 *   `short` when the query is tidied too). A query that is not exactly the canonical form of the view it names (`period`, `quote`, `trades`:
 *   defaults, unknown values, repeats and other parameters dropped; the Trades filter only where `AMM_DATA` is on and the network has pools)
 *   is a 302 to the canonical URL, class `short`. The query is the request's own text (`queryOf`: React Router's `_routes` dropped, nothing decoded), so a `.data` request of a
 *   canonical view answers its data and not a redirect. No call is made before these.
 * - **One call** (#1, spec 2.3): `/v2/network/markets` for the period, at most `MARKETS_LIMIT` pairs, with `amm` for a Trades filter. Without it
 *   there is no page: any failure is a 503 (`upstreamOutage`: a "Cannot GET" of an API without the route is one), not stored. The page does not
 *   poll, so the call does not ask for the failure hold.
 * - **The class is `minute`** (spec 2.5): the data API rewrites its sets every minute at most, and the page has no live refresh and no
 *   `clientLoader`.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const net = requireNetwork(context, params);
  if (!net.features.markets) throw cached({ notFound: "the markets pages" }, "short", { status: 404 });

  const search = queryOf(request.url);
  const { params: view, canonical } = parseMarketsParams(new URLSearchParams(search), {
    native: net.native,
    tradesAllowed: net.hasAmm && net.features.ammData,
  });
  // The path as React Router has it (`.data` taken off), against the route's one path: `/xrpl/markets/` and `/xrpl/Markets` are the same
  // page, and a redirect (class `immutable` when only the path changed) leaves the edge one copy of it and the header's exact match true.
  const tidied = redirectToCanonical({ path: url.pathname, search: search === "" ? "" : `?${search}` }, { path: marketsHref(net.id), search: canonical });
  if (tidied) return tidied;

  const { api } = clientsFor(context, net);
  const answer = await api
    .networkMarkets({ period: PERIODS[view.period].api, limit: MARKETS_LIMIT, amm: view.trades === null ? undefined : TRADES_API[view.trades] })
    .catch((err: unknown) => upstreamOutage(err, "the markets"));

  return cached(marketsPage({ network: net, params: view, answer }), "minute");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return marketsMeta(loaderData, ctx);
}

export default function Markets({ loaderData }: Route.ComponentProps) {
  const network = useNetwork();
  return <MarketsPage network={network} data={loaderData} />;
}
