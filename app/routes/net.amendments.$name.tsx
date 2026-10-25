import { useEffect } from "react";
import { redirect } from "react-router";

import { amendmentHref } from "../domain/amendments-params";
import { amendmentSegment, parseAmendmentRef } from "../domain/amendment-ref";
import { shortHash } from "../domain/format";
import { queryOf } from "../domain/query-of";
import { amendmentPage, type AmendmentPageData } from "../server/amendment-view";
import { anchorOrThrow, type Anchor } from "../server/anchor";
import { HOME_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { byDeadline, CARD_DEADLINE_MS, partOf } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { upstreamFailure, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext } from "../server/meta";
import { amendmentMeta } from "../server/meta-amendment";
import { networkInfoOf, requireNetwork } from "../server/network-route";
import { networkOf, type Network } from "../server/networks";
import { UpstreamError } from "../server/upstream";
import { createLiveOnScreen, keepLoaded } from "../ui/live-page";
import { isNetworkId } from "../ui/networks";
import { AmendmentPage } from "../ui/pages/AmendmentPage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useLiveControls } from "../ui/use-live-controls";
import { AMENDMENTS_REFRESH_MS } from "../ui/use-live-refresh";

import type { Route } from "./+types/net.amendments.$name";

// The loader names a cache class (`minute`), answers a 404 of class `short` while `VALIDATORS` is off and for a segment that names no amendment, and redirects a query
// string (class `short`) and another spelling of the amendment (class `slow`); a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Network item as the section of the page (`aria-current="true"`: the page is inside the section, it is not its index).
export const handle = { navSection: "network" } satisfies NetworkRouteHandle;

/** What this route's loader answers: the view builder's page, the ledger it was built from and the Worker's build, for an open page to order its answers and to tell a deploy. */
type AmendmentLoaderData = AmendmentPageData & { anchor: Anchor; build: string };

/** The parts of the page that a beat may keep when its answer has them failed and the page shows them loaded (`keepLoaded`, spec 2.3): S. */
const AMENDMENT_PARTS = ["summary"] as const;

/** The scope of an amendment's live page (`OnScreen`): the network and the canonical segment, which is the URL's on a page that is drawn (any other is a redirect). */
const scopeOf = (net: string, segment: string): string => `${net}/amendments/${segment}`;

/**
 * `/{net}/amendments/{name}` (validators spec 1.3, 1.4, 2.2 and 6): one amendment, from the data API's D1 routes alone. The class is `minute` (60 s + 30 s): its tallies and
 * rounds change once per flag ledger, the countdowns tick in the browser, and an open tab asks again every minute (see `Amendment`).
 *
 * - **`VALIDATORS` off** is the not-found page, a 404 of class `short`, before the segment or the query is read and before any call (spec 10).
 * - **The segment** (spec 1.3): what is neither a name nor a 64-digit ID is a 404 of class `short` ("amendment {first 40 characters}") with no call.
 * - **No parameter** (spec 1.4): any query string is a 302 to the bare path (the name as typed, or the ID in upper case), class `short`, with no call. The query is the request's
 *   own text (`queryOf`: React Router's `_routes` dropped), so a `.data` request of the page answers its data.
 * - **Three calls, side by side and all awaited**: `lastValidated` (the anchor, the home page's key), AD (the amendment, by the name as typed or the upper-cased ID) and S (the
 *   summary), each asking for the failure hold (the page polls). S is a card, raced against `CARD_DEADLINE_MS` from the loader's start ("took too long"); `lastValidated` and AD
 *   are the page and are not raced. A is never called: AD carries the list's envelope (the rules, the round, G3). Nothing is thrown until everything has settled.
 * - **AD decides the page** (spec 1.3, 6.6): its 404 `amendment not found` is the not-found page (class `short`) with the offer of the other network, where many names exist
 *   alone; any other failure (a 400 for a ref that passed the parser, a 5xx, a timeout, an API without D1's `Cannot GET`) is a 503 that is not stored. A URL that is not the
 *   canonical one of the row AD answers (a case variant, the ID of a named amendment, an ID in lower case) is a 302 to it, class `slow` (the mapping is D1's data).
 *   A `lastValidated` whose ledger index or close time is not a number (`anchorOrThrow`) is a 503 too, whatever AD answered: no anchor can be worked out from it.
 * - **S failing is told in its place** (spec 6.6): the page leaves out the publishers and the number of other validators seen; the failure is logged and the request is
 *   degraded, so that the page is served and not stored.
 *
 * The data carries the ledger it was built from (`anchor`) and the Worker's `BUILD_ID`.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  if (!net.features.validators) throw cached({ notFound: "the amendments" }, "short", { status: 404 });

  const raw = params.name ?? "";
  const ref = parseAmendmentRef(raw);
  if (ref === null) throw cached({ notFound: `amendment ${echoOf(raw)}` }, "short", { status: 404 });
  const asked = "id" in ref ? ref.id : ref.name;
  if (queryOf(request.url) !== "") return redirect(amendmentHref(net.id, asked), { status: 302, headers: cacheClassHeaders("short") });

  const { api } = clientsFor(context, net);
  const [last, amendment, summary] = await Promise.allSettled([
    api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS, holdFailure: true }),
    api.amendment(asked, { holdFailure: true }),
    byDeadline(api.validatorsSummary({ ttl: VALIDATORS_CALL_TTL_SECONDS, holdFailure: true }), started + CARD_DEADLINE_MS),
  ]);

  // Thrown only now that every call has settled.
  if (last.status === "rejected") return upstreamOutage(last.reason, "the network");
  let anchor: Anchor;
  try {
    anchor = anchorOrThrow(last.value);
  } catch (error) {
    // A 200 whose ledger or close time is not a number, which the page cannot be anchored on: the API failing.
    logProblem("the amendment page has no anchor", error, request);
    return upstreamOutage(error, "the amendment");
  }
  if (amendment.status === "rejected") return amendmentFailure(context, amendment.reason, net, ref, raw);
  const canonical = amendmentSegment(amendment.value);
  if (canonical !== raw) return redirect(amendmentHref(net.id, canonical), { status: 302, headers: cacheClassHeaders("slow") });

  // The network the page is given is what the browser may have: the facts the page draws, and not the data API's URL or the node's.
  const page = amendmentPage({ network: networkInfoOf(net), amendment: amendment.value, summary: partOf(summary) });
  if (summary.status === "rejected") {
    logProblem("the amendment page's summary could not be loaded", summary.reason, request);
    markDegraded(context, "amendment: summary");
  }
  return cached({ ...page, anchor, build: getEnv(context).BUILD_ID } satisfies AmendmentLoaderData, "minute");
}

/** AD's failure (spec 1.3, 6.6): its own not-found is the page's, with the offer of the other network; anything else is the API failing. */
function amendmentFailure(context: Route.LoaderArgs["context"], error: unknown, net: Network, ref: { id: string } | { name: string }, raw: string): never {
  if (error instanceof UpstreamError && error.kind === "not_found") {
    const other = networkOf(net.other, getEnv(context));
    const what = "id" in ref ? shortHash(ref.id) : ref.name;
    return upstreamFailure(error, `amendment ${what}`, { href: `/${net.other}/amendments/${raw}`, label: `Look for it on ${other.name}` });
  }
  return upstreamOutage(error, "the amendment");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return amendmentMeta(loaderData, ctx);
}

/**
 * What the amendment page on screen shows, and what happens when its refresh does not work (the home page's `onScreen`, `live-page.ts`): the page keeps what it shows, counts
 * the failures, refuses an answer that is behind the ledger it is at or of another build, and keeps S's part when a beat's answer has it failed and the page shows it loaded
 * (`keepLoaded`, spec 2.3).
 */
const onScreen = createLiveOnScreen<AmendmentLoaderData>({
  order: (data) => data.anchor.lastValidated,
  merge: (next, shown) => keepLoaded(next, shown, AMENDMENT_PARTS),
});

/**
 * In the browser only, and only after the first render (README, "Live updates"): runs the loader through the explorer's own `.data` URL and hands the page what it already
 * shows when that fails. The scope is the network and the segment of the URL, so that a refresh of one amendment never stands in for another.
 */
export function clientLoader({ params, serverLoader }: Route.ClientLoaderArgs) {
  const net = params.net ?? "";
  // A network that does not exist is the layout's 404: no page of it to keep.
  if (!isNetworkId(net)) return serverLoader();
  return onScreen.reload(scopeOf(net, params.name ?? ""), serverLoader);
}

export default function Amendment({ loaderData }: Route.ComponentProps) {
  const live = useLiveControls(onScreen, { everyMs: AMENDMENTS_REFRESH_MS });
  const scope = scopeOf(loaderData.network.id, loaderData.canonical);
  useEffect(() => onScreen.show(scope, loaderData), [scope, loaderData]);
  // Keyed by the scope: another amendment or network is a navigation and a first render, not a flag ledger closing. A row that is new enters and a figure that changed
  // ticks in after the page is mounted, so another amendment must mount the page again.
  return <AmendmentPage key={scope} data={loaderData} live={live} />;
}
