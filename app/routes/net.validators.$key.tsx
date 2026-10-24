import { useEffect } from "react";
import { redirect } from "react-router";

import { shortHash } from "../domain/format";
import { parseTrail } from "../domain/paging";
import { queryOf } from "../domain/query-of";
import { parseValidatorKey } from "../domain/validator-key";
import { validatorHref } from "../domain/validators-params";
import { anchorOrThrow, type Anchor } from "../server/anchor";
import { HOME_CALL_TTL_SECONDS, VALIDATIONS_CALL_TTL_SECONDS, VALIDATIONS_MARKER_TTL_SECONDS, VALIDATORS_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { byDeadline, CARD_DEADLINE_MS, partOf } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { upstreamFailure, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { validatorMeta } from "../server/meta-validator";
import { requireNetwork } from "../server/network-route";
import { networkOf, type Network } from "../server/networks";
import { UpstreamError } from "../server/upstream";
import { validatorHistoryPage, validatorPage, type ValidatorLiveData } from "../server/validator-view";
import { createLiveOnScreen, keepLoaded } from "../ui/live-page";
import { findNetwork } from "../ui/networks";
import { ValidatorHistoryPage, ValidatorPage } from "../ui/pages/ValidatorPage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useLiveControls } from "../ui/use-live-controls";

import type { Route } from "./+types/net.validators.$key";

// The loader names a cache class (`live-home`; a page of older validations `slow`), answers a 404 of class `short` while `VALIDATORS` is off and for a
// key that is none, and redirects another spelling of a key to the master key's URL; a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Network item as the section of the page (`aria-current="true"`: the page is inside the section, it is not its index).
export const handle = { navSection: "network" } satisfies NetworkRouteHandle;

/** What this route's loader answers for the live view: the view builder's page, the ledger it was built from and the Worker's build. */
type ValidatorLoaderData = ValidatorLiveData & { anchor: Anchor; build: string };

/** The parts of the page that a beat may keep when its answer has them failed and the page shows them loaded (`keepLoaded`, spec 2.3): VV, S and A. */
const VALIDATOR_PARTS = ["recent", "summary", "amendments"] as const;

/** The validations a page shows: the foundation's list size (spec 4.1). */
const VALIDATIONS_LIMIT = 20;

/** What the not-found page and a 404 of a page of older validations say (spec 4.5). */
const NO_SUCH_PAGE = "that page of the validator's validations";

/** The scope of a validator's live page (`OnScreen`): the network and the key of the URL. */
const scopeOf = (net: string, key: string): string => `${net}/validators/${key}`;

/** The network the page is given: what the browser may have, the facts the page draws, and not the data API's URL or the node's. */
const publicOf = ({ id, name, native, software }: Network) => ({ id, name, native, software });

/**
 * `/{net}/validators/{key}` (validators spec 1.2, 1.4, 4.3 to 4.5): one validator, from the data API's D1 routes alone. The class is `live-home` (1 s + 2 s), the
 * home page's: its recent validations follow the chain, and an open tab asks again every ledger (see `Validator`). A page of older validations (`?marker=`) is
 * history, class `slow` for 300 s, and does not refresh.
 *
 * - **`VALIDATORS` off** is the not-found page, a 404 of class `short`, before anything is read and before any call (spec 10).
 * - **The key** (spec 1.2): what is no node public key is a 404 of class `short` with no call; 66 hex digits are a 302 to the base58 key, with the request's
 *   own query, class `immutable` (a pure conversion), with no call.
 * - **One URL per view** (spec 1.4): `marker` must be a marker, else the page does not exist (a 404 of class `short`); `back` is the trail of newer markers,
 *   dropped without a marker; anything else is dropped. A query that is not exactly the canonical one is a 302 to it, class `short`, with no call.
 * - **Five calls, side by side and all awaited**: `lastValidated` (the anchor, the home page's key), D (the validator), VV (its newest validations), S (the
 *   summary) and A (the amendments), each asking for the failure hold (the page polls). VV, S and A are cards, raced against `CARD_DEADLINE_MS` from the
 *   loader's start ("took too long"); `lastValidated` and D are the page and are not raced. Nothing is thrown until everything has settled.
 * - **D decides the page** (spec 1.2, 4.4): its 404 `Validator not found` is the not-found page (class `short`) with the offer of the other network; any other
 *   failure (a 400 for a key that passed the parser, a 5xx, a timeout, an API without D1's `Cannot GET`) is a 503 that is not stored. A key that is not the
 *   master key D answers with (a signing key) is a 302 to the master's URL, `marker` and `back` kept, class `slow` (the mapping is D1's data). A `lastValidated` whose
 *   ledger index or close time is not a number (`anchorOrThrow`) is a 503 too, whatever D answered: no anchor can be worked out from it.
 * - **A part that failed is told in its place** (spec 4.4): the view builder gives VV, S and A each their own `failed` state, the failure is logged and the
 *   request is degraded, so that the page is served and not stored.
 * - **A page of older validations** (spec 4.5) asks for D and VV with the marker only, and no hold (it does not poll). A marker VV refuses (a 400) or a page
 *   with no rows (the 7 days have passed it) is a 404 of class `short`; any other failure of VV is a 503.
 *
 * The live data carries the ledger it was built from (`anchor`) and the Worker's `BUILD_ID`.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  if (!net.features.validators) throw cached({ notFound: "the validators" }, "short", { status: 404 });

  const raw = params.key ?? "";
  const parsed = parseValidatorKey(raw);
  if (parsed === null) throw cached({ notFound: `validator ${echoOf(raw)}` }, "short", { status: 404 });
  const search = queryOf(request.url);
  const { key } = parsed;
  if (parsed.from === "hex") {
    return redirect(`${validatorHref(net.id, key)}${search === "" ? "" : `?${search}`}`, { status: 302, headers: cacheClassHeaders("immutable") });
  }

  const query = new URL(request.url).searchParams;
  const marker = query.get("marker");
  if (marker !== null && !isMarker(marker)) throw cached({ notFound: NO_SUCH_PAGE }, "short", { status: 404 });
  const page = marker === null ? null : { marker, back: parseTrail(query.get("back")) };
  const canonical = validatorHref(net.id, key, page ?? {});
  if (canonical !== `/${net.id}/validators/${raw}${search === "" ? "" : `?${search}`}`) {
    return redirect(canonical, { status: 302, headers: cacheClassHeaders("short") });
  }

  return page === null ? livePage(context, request, net, key, started) : historyPage(context, net, key, page);
}

/** D's failure (spec 1.2, 4.4): its own not-found is the page's, with the offer of the other network; anything else is the API failing. */
function validatorFailure(context: Route.LoaderArgs["context"], error: unknown, net: Network, key: string): never {
  if (error instanceof UpstreamError && error.kind === "not_found") {
    const other = networkOf(net.other, getEnv(context));
    return upstreamFailure(error, `validator ${shortHash(key)}`, { href: `/${net.other}/validators/${key}`, label: `Look for it on ${other.name}` });
  }
  return upstreamOutage(error, "the validator");
}

/** The 302 to the master key's URL when the URL named another key of it (a signing key), `marker` and `back` kept (spec 1.2). */
function toMaster(net: Network, asked: string, master: string, page: { marker?: string; back?: readonly string[] }) {
  return master === asked ? null : redirect(validatorHref(net.id, master, page), { status: 302, headers: cacheClassHeaders("slow") });
}

/** The live view (spec 4.1, 4.3, 4.4): five calls side by side, and the page with its failed parts in their places. */
async function livePage(context: Route.LoaderArgs["context"], request: Request, net: Network, key: string, started: number) {
  const { api } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const kept = { ttl: VALIDATORS_CALL_TTL_SECONDS, holdFailure: true };
  const [last, validator, recent, summary, amendments] = await Promise.allSettled([
    api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS, holdFailure: true }),
    api.validator(key, kept),
    byDeadline(api.validatorValidations(key, { limit: VALIDATIONS_LIMIT }, { ttl: VALIDATIONS_CALL_TTL_SECONDS, holdFailure: true }), deadline),
    byDeadline(api.validatorsSummary(kept), deadline),
    // One call per network serves the amendments list, this page and the validators list's filter: no `status`, the builders filter.
    byDeadline(api.amendments({ holdFailure: true }), deadline),
  ]);

  // Thrown only now that every call has settled.
  if (last.status === "rejected") return upstreamOutage(last.reason, "the network");
  let anchor: Anchor;
  try {
    anchor = anchorOrThrow(last.value);
  } catch (error) {
    // A 200 whose ledger or close time is not a number, which the page cannot be anchored on: the API failing.
    logProblem("the validator page has no anchor", error, request);
    return upstreamOutage(error, "the validator");
  }
  if (validator.status === "rejected") return validatorFailure(context, validator.reason, net, key);
  const master = toMaster(net, key, validator.value.validation_public_key, {});
  if (master !== null) return master;

  const page = validatorPage({
    network: publicOf(net),
    validator: validator.value,
    recent: partOf(recent),
    summary: partOf(summary),
    amendments: partOf(amendments),
    anchor,
  });

  const failures = (
    [
      ["recent", recent],
      ["summary", summary],
      ["amendments", amendments],
    ] as const
  ).flatMap(([part, result]) => (result.status === "rejected" ? [{ part, error: result.reason }] : []));
  for (const { part, error } of failures) logProblem(`the validator page's ${part} could not be loaded`, error, request);
  if (failures.length > 0) markDegraded(context, `validator: ${failures.map(({ part }) => part).join(", ")}`);

  return cached({ ...page, anchor, build: getEnv(context).BUILD_ID } satisfies ValidatorLoaderData, "live-home");
}

/** A page of older validations (spec 4.5): D and VV with the marker, awaited whole; history, stored for 300 s. */
async function historyPage(context: Route.LoaderArgs["context"], net: Network, key: string, page: { marker: string; back: string[] }) {
  const { api } = clientsFor(context, net);
  const [validator, recent] = await Promise.allSettled([
    api.validator(key, { ttl: VALIDATORS_CALL_TTL_SECONDS }),
    api.validatorValidations(key, { limit: VALIDATIONS_LIMIT, marker: page.marker }),
  ]);

  if (validator.status === "rejected") return validatorFailure(context, validator.reason, net, key);
  const master = toMaster(net, key, validator.value.validation_public_key, page);
  if (master !== null) return master;

  if (recent.status === "rejected") {
    // D1 refuses a marker that is not one of its own (`invalid marker`): the page does not exist.
    if (recent.reason instanceof UpstreamError && recent.reason.kind === "bad_request") throw cached({ notFound: NO_SUCH_PAGE }, "short", { status: 404 });
    return upstreamOutage(recent.reason, "the validator's validations");
  }
  // The 7 days the data API keeps have passed the marker.
  if (recent.value.validations.length === 0) throw cached({ notFound: NO_SUCH_PAGE }, "short", { status: 404 });

  const data = validatorHistoryPage({ network: publicOf(net), validator: validator.value, recent: recent.value, marker: page.marker, back: page.back });
  // The class and its TTL are those of the call under it: old rows change only when a ledger they name is indexed.
  return cached(data, "slow", { ttl: VALIDATIONS_MARKER_TTL_SECONDS });
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return validatorMeta(loaderData, ctx);
}

/**
 * What the validator page on screen shows, and what happens when its refresh does not work (the home page's `onScreen`, `live-page.ts`): the page keeps
 * what it shows, counts the failures, refuses an answer that is behind the ledger it is at or of another build, and keeps each of its three parts it shows
 * loaded when an answer has that part failed (`keepLoaded`, spec 2.3).
 */
const onScreen = createLiveOnScreen<ValidatorLoaderData>({
  order: (data) => data.anchor.lastValidated,
  merge: (next, shown) => keepLoaded(next, shown, VALIDATOR_PARTS),
});

/**
 * In the browser only, and only after the first render (README, "Live updates"): runs the loader through the explorer's own `.data` URL and hands the
 * page what it already shows when that fails. The scope is the network and the key of the URL, so that a refresh of one validator never stands in for
 * another. A page of older validations is history: it goes straight to the server's loader, with nothing kept and nothing compared (spec 2.3).
 */
export function clientLoader({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  const network = findNetwork(params.net);
  // A network that does not exist is the layout's 404, and a marker is history: no live page of it to keep.
  if (!network || new URL(request.url).searchParams.has("marker")) return serverLoader();
  // Without a marker the loader answers the live view (or throws: a redirect, a 404, a 503), never the history.
  return onScreen.reload(scopeOf(network.id, params.key ?? ""), serverLoader as () => Promise<ValidatorLoaderData>);
}

/** The live view: the polling and the controls, and the page keyed by its scope. */
function LiveValidator({ data }: { data: ValidatorLoaderData }) {
  const live = useLiveControls(onScreen);
  const scope = scopeOf(data.network.id, data.key);
  useEffect(() => onScreen.show(scope, data), [scope, data]);
  // Keyed by the scope: another validator or network is a navigation and a first render, not a ledger closing. The kit rings a chart whose token changes
  // after it is mounted, and a row that is new enters, so the page must be mounted again.
  return <ValidatorPage key={scope} data={data} live={live} />;
}

export default function Validator({ loaderData }: Route.ComponentProps) {
  // A page of older validations has no live state: no polling, no live row.
  if (loaderData.kind === "history") return <ValidatorHistoryPage data={loaderData} />;
  return <LiveValidator data={loaderData} />;
}
