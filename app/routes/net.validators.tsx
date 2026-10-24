import { useEffect } from "react";
import { redirect } from "react-router";

import { queryOf } from "../domain/query-of";
import { canonicalValidatorsParams, parseValidatorsParams, validatorsHref, type ValidatorsParams } from "../domain/validators-params";
import { anchorOrThrow, type Anchor } from "../server/anchor";
import { HOME_CALL_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { asOutage, byDeadline, CARD_DEADLINE_MS, partOf } from "../server/deadline";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext } from "../server/meta";
import { validatorsMeta } from "../server/meta-validators";
import { requireNetwork } from "../server/network-route";
import { validatorsPage, type ValidatorsPageData } from "../server/validators-view";
import { createLiveOnScreen, keepLoaded } from "../ui/live-page";
import { isNetworkId } from "../ui/networks";
import { ValidatorsPage } from "../ui/pages/ValidatorsPage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useLiveControls } from "../ui/use-live-controls";
import { VALIDATORS_REFRESH_MS } from "../ui/use-live-refresh";

import type { Route } from "./+types/net.validators";

// The loader names a cache class (`live`), answers a 404 of class `short` while `VALIDATORS` is off, and tidies a query string with a redirect
// of class `short`; a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Network item as the section of the page (`aria-current="true"`: the page is inside the section, it is not its index).
export const handle = { navSection: "network" } satisfies NetworkRouteHandle;

/** What this route's loader answers: the view builder's page, the ledger it was built from and the Worker's build, for an open page to order its answers and to tell a deploy. */
type ValidatorsLoaderData = ValidatorsPageData & { anchor: Anchor; build: string };

/** The parts of the page that a beat may keep when its answer has them failed and the page shows them loaded (`keepLoaded`, spec 2.3): S, L and A. */
const VALIDATORS_PARTS = ["summary", "list", "amendments"] as const;

/** The validators one call asks for: D1's maximum, so that one cached call per network serves every view and the filters are applied in the Worker (spec 3.2). */
const LIST_LIMIT = 1000;

/** The scope of a view for the live page (`OnScreen`): the network and the canonical query, so that a refresh of one view never stands in for another. */
const scopeOf = (net: string, params: ValidatorsParams): string => validatorsHref(net, params).slice(1);

/**
 * `/{net}/validators` (validators spec 2.2 and 3.2): the validators of a network, from the data API's D1 routes alone. The class is `live` (5 s + 30 s): what
 * changes every ledger on it is shown coarsely, the rest changes with D1's 10 s directory, and an open tab asks again every 10 s (see `Validators`).
 *
 * - **`VALIDATORS` off** is the not-found page, a 404 of class `short`, for every view, before the query is read and before any call (spec 10).
 * - **One URL per view** (spec 1.4). The part of the canonical form that needs no data (`scope`, `q`, the order, defaults, empty values, repeats and other
 *   parameters dropped) is checked first, and a query that is not exactly it is a 302 to the canonical URL, class `short`, with no call; the query is the
 *   request's own text (`queryOf`: React Router's `_routes` dropped, nothing decoded), so a `.data` request of a canonical view answers its data. A view
 *   that names a `publisher` or an `amendment` waits for S and A, which spell them, and the one 302 then carries both kinds of change.
 * - **Four calls, side by side and all awaited**: `lastValidated` (the anchor, the home page's key), S (the summary), L (every validator, `scope=all`) and
 *   A (the amendments), each asking for the failure hold (the page polls). S, L and A are cards, and each is raced against `CARD_DEADLINE_MS` from the
 *   loader's start ("took too long"); `lastValidated` is the page and is not raced. Nothing is thrown until everything has settled.
 * - **A part that failed is told in its place** (spec 3.3): the view builder gives S, L and A each their own `failed` state, the failure is logged and the
 *   request is degraded, so that the page is served and not stored. `lastValidated` failing or answering a ledger index or close time that is not a number
 *   (`anchorOrThrow`), or S, L and A all failing (an API without D1 is this case: each answers `Cannot GET`, which is an outage), is a 503 that is not stored.
 *
 * The data carries the ledger it was built from (`anchor`) and the Worker's `BUILD_ID`.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  if (!net.features.validators) throw cached({ notFound: "the validators" }, "short", { status: 404 });

  const search = queryOf(request.url);
  const asked = `/${net.id}/validators${search === "" ? "" : `?${search}`}`;
  const pure = parseValidatorsParams(search);
  if (pure.publisher === undefined && pure.amendment === undefined && validatorsHref(net.id, pure) !== asked) {
    return redirect(validatorsHref(net.id, pure), { status: 302, headers: cacheClassHeaders("short") });
  }

  const { api } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const kept = { ttl: VALIDATORS_CALL_TTL_SECONDS, holdFailure: true };
  const [last, summary, list, amendments] = await Promise.allSettled([
    api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS, holdFailure: true }),
    byDeadline(api.validatorsSummary(kept), deadline),
    byDeadline(api.validators({ scope: "all", limit: LIST_LIMIT }, kept), deadline),
    // One call per network serves the amendments list, the validator page and this list's filter: no `status`, the builders filter.
    byDeadline(api.amendments({ holdFailure: true }), deadline),
  ]);

  // Thrown only now that every call has settled.
  if (last.status === "rejected") return upstreamOutage(last.reason, "the network");
  let anchor: Anchor;
  try {
    anchor = anchorOrThrow(last.value);
  } catch (error) {
    // A 200 whose ledger or close time is not a number, which the page cannot be anchored on: the API failing.
    logProblem("the validators list has no anchor", error, request);
    return upstreamOutage(error, "the validators");
  }
  if (summary.status === "rejected" && list.status === "rejected" && amendments.status === "rejected") {
    return upstreamOutage(asOutage(summary.reason), "the validators");
  }

  const canonical = canonicalValidatorsParams(pure, {
    publishers: summary.status === "fulfilled" ? summary.value.unl.publishers.map((publisher) => publisher.id) : null,
    amendments: amendments.status === "fulfilled" ? amendments.value.amendments : null,
  });
  if (validatorsHref(net.id, canonical) !== asked) return redirect(validatorsHref(net.id, canonical), { status: 302, headers: cacheClassHeaders("short") });

  // The network the page is given is what the browser may have: the facts the page draws, and not the data API's URL or the node's.
  const { id, kind, name, label, longName, dexName, native, software } = net;
  const page = validatorsPage({ network: { id, kind, name, label, longName, dexName, native, software }, params: canonical, summary: partOf(summary), list: partOf(list), amendments: partOf(amendments) });

  const failures = (
    [
      ["summary", summary],
      ["list", list],
      ["amendments", amendments],
    ] as const
  ).flatMap(([part, result]) => (result.status === "rejected" ? [{ part, error: result.reason }] : []));
  for (const { part, error } of failures) logProblem(`the validators list's ${part} could not be loaded`, error, request);
  if (failures.length > 0) markDegraded(context, `validators: ${failures.map(({ part }) => part).join(", ")}`);

  return cached({ ...page, anchor, build: getEnv(context).BUILD_ID } satisfies ValidatorsLoaderData, "live");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return validatorsMeta(loaderData, ctx);
}

/**
 * What the validators list on screen shows, and what happens when its refresh does not work (the home page's `onScreen`, `live-page.ts`): the page keeps
 * what it shows, counts the failures, refuses an answer that is behind the ledger it is at or of another build, and keeps each of its three parts it
 * shows loaded when an answer has that part failed (`keepLoaded`, spec 2.3).
 */
const onScreen = createLiveOnScreen<ValidatorsLoaderData>({
  order: (data) => data.anchor.lastValidated,
  merge: (next, shown) => keepLoaded(next, shown, VALIDATORS_PARTS),
});

/**
 * In the browser only, and only after the first render (README, "Live updates"): runs the loader through the explorer's own `.data` URL and hands the page
 * what it already shows when that fails. The scope is the network and the canonical search of the view, so that a refresh of one view never stands in for
 * another: a navigation to a view that is not on screen has nothing to keep and gets the error screen as before.
 */
export function clientLoader({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  const net = params.net ?? "";
  // A network that does not exist is the layout's 404: no page of it to keep, and no view to name.
  if (!isNetworkId(net)) return serverLoader();
  return onScreen.reload(scopeOf(net, parseValidatorsParams(queryOf(request.url))), serverLoader);
}

export default function Validators({ loaderData }: Route.ComponentProps) {
  const live = useLiveControls(onScreen, { everyMs: VALIDATORS_REFRESH_MS });
  const scope = scopeOf(loaderData.network.id, loaderData.params);
  useEffect(() => onScreen.show(scope, loaderData), [scope, loaderData]);
  // Keyed by the scope: another view or network is a navigation and a first render, not a ledger closing. The kit rings a chart whose token changes after it
  // is mounted, and a row that is new enters, so the page must be mounted again.
  return <ValidatorsPage key={scope} data={loaderData} live={live} />;
}
