import { useEffect } from "react";
import { redirect } from "react-router";

import { amendmentsHref, parseAmendmentsParams, type AmendmentStatus } from "../domain/amendments-params";
import { queryOf } from "../domain/query-of";
import { amendmentsPage, type AmendmentsPageData } from "../server/amendments-view";
import { anchorOf, type Anchor } from "../server/anchor";
import { HOME_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv } from "../server/env";
import { upstreamOutage } from "../server/loader-errors";
import { metaContext } from "../server/meta";
import { amendmentsMeta } from "../server/meta-amendments";
import { requireNetwork } from "../server/network-route";
import { createLiveOnScreen } from "../ui/live-page";
import { findNetwork } from "../ui/networks";
import { AmendmentsPage } from "../ui/pages/AmendmentsPage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useLiveControls } from "../ui/use-live-controls";
import { AMENDMENTS_REFRESH_MS } from "../ui/use-live-refresh";

import type { Route } from "./+types/net.amendments";

// The loader names a cache class (`minute`), answers a 404 of class `short` while `VALIDATORS` is off, and tidies a query string with a redirect of class `short`; a 503
// it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Network item as the section of the page (`aria-current="true"`: the page is inside the section, it is not its index).
export const handle = { navSection: "network" } satisfies NetworkRouteHandle;

/** What this route's loader answers: the view builder's page, the ledger it was built from and the Worker's build, for an open page to order its answers and to tell a deploy. */
type AmendmentsLoaderData = AmendmentsPageData & { anchor: Anchor; build: string };

/** The scope of a view for the live page (`OnScreen`): the network and the canonical query, so that a refresh of one view never stands in for another. */
const scopeOf = (net: string, status: AmendmentStatus | undefined): string => amendmentsHref(net, status === undefined ? {} : { status }).slice(1);

/**
 * `/{net}/amendments` (validators spec 2.2 and 5.2): the amendments of a network, from the data API's D1 routes alone. The class is `minute` (60 s + 30 s): the tallies and
 * statuses change once per flag ledger, the countdowns tick in the browser, and an open tab asks again every minute (see `Amendments`).
 *
 * - **`VALIDATORS` off** is the not-found page, a 404 of class `short`, for every view, before the query is read and before any call (spec 10).
 * - **One URL per view** (spec 1.4). The query is read as `parseAmendmentsParams` reads it (the first `status`, in any case; the default, an empty or an unknown value, a repeat
 *   and any other parameter dropped), and a query that is not exactly `amendmentsHref` of it is a 302 to the canonical URL, class `short`, with no call; the query is the
 *   request's own text (`queryOf`: React Router's `_routes` dropped, nothing decoded), so a `.data` request of a canonical view answers its data.
 * - **Two calls, side by side and all awaited**: `lastValidated` (the anchor, the home page's key) and A (the amendments, one cached call per network that serves every view:
 *   the builder filters), each asking for the failure hold (the page polls). Neither is raced: A is the page, and `lastValidated` is its anchor. Nothing is thrown until both
 *   have settled.
 * - **Either failing is a 503** that is not stored (spec 5.3): the page has no card that could fail on its own. An API without D1 is this case: A answers `Cannot GET`, which is
 *   an outage.
 *
 * The data carries the ledger it was built from (`anchor`) and the Worker's `BUILD_ID`.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const net = requireNetwork(context, params);
  if (!net.features.validators) throw cached({ notFound: "the amendments" }, "short", { status: 404 });

  const search = queryOf(request.url);
  const asked = `/${net.id}/amendments${search === "" ? "" : `?${search}`}`;
  const { status } = parseAmendmentsParams(search);
  const canonical = amendmentsHref(net.id, status === undefined ? {} : { status });
  if (canonical !== asked) return redirect(canonical, { status: 302, headers: cacheClassHeaders("short") });

  const { api } = clientsFor(context, net);
  const [last, amendments] = await Promise.allSettled([api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS, holdFailure: true }), api.amendments({ holdFailure: true })]);

  // Thrown only now that both calls have settled.
  if (last.status === "rejected") return upstreamOutage(last.reason, "the network");
  if (amendments.status === "rejected") return upstreamOutage(amendments.reason, "the amendments");

  // The network the page is given is what the browser may have: the facts the page draws, and not the data API's URL or the node's.
  const { id, name, native, software } = net;
  const page = amendmentsPage({ network: { id, name, native, software }, amendments: amendments.value, status });
  return cached({ ...page, anchor: anchorOf(last.value), build: getEnv(context).BUILD_ID } satisfies AmendmentsLoaderData, "minute");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return amendmentsMeta(loaderData, ctx);
}

/**
 * What the amendments list on screen shows, and what happens when its refresh does not work (the home page's `onScreen`, `live-page.ts`): the page keeps what it shows, counts
 * the failures, and refuses an answer that is behind the ledger it is at or of another build. The page is A, one part that cannot fail on its own, so there is nothing to merge.
 */
const onScreen = createLiveOnScreen<AmendmentsLoaderData>({ order: (data) => data.anchor.lastValidated });

/**
 * In the browser only, and only after the first render (README, "Live updates"): runs the loader through the explorer's own `.data` URL and hands the page what it already
 * shows when that fails. The scope is the network and the canonical status of the view, so that a refresh of one view never stands in for another: a navigation to a view that
 * is not on screen has nothing to keep and gets the error screen as before.
 */
export function clientLoader({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  const network = findNetwork(params.net);
  // A network that does not exist is the layout's 404: no page of it to keep, and no view to name.
  if (!network) return serverLoader();
  return onScreen.reload(scopeOf(network.id, parseAmendmentsParams(queryOf(request.url)).status), serverLoader);
}

export default function Amendments({ loaderData }: Route.ComponentProps) {
  const live = useLiveControls(onScreen, { everyMs: AMENDMENTS_REFRESH_MS });
  const scope = scopeOf(loaderData.network.id, loaderData.status);
  useEffect(() => onScreen.show(scope, loaderData), [scope, loaderData]);
  // Keyed by the scope: another view or network is a navigation and a first render, not a flag ledger closing. A row that is new enters and a share that changed ticks in
  // after the page is mounted, so another view must mount the page again.
  return <AmendmentsPage key={scope} data={loaderData} live={live} />;
}
