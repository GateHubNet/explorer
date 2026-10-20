import { useEffect } from "react";
import { redirect } from "react-router";

import { networkHref, networkScope, parseNetworkParams, queryOf, USD_ISSUER } from "../domain/network-params";
import { utcDayOf, windowOf } from "../domain/window";
import { anchorOrThrow, type Anchor } from "../server/anchor";
import { HOME_CALL_TTL_SECONDS, PERIOD_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { byDeadline, CARD_DEADLINE_MS, outcome } from "../server/deadline";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { latestLedgerIndex } from "../server/home-view";
import { upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext } from "../server/meta";
import { networkMeta } from "../server/meta-network";
import { networkPage, VALIDATIONS_LIMIT, type NetworkInput, type NetworkLoaderData } from "../server/network-view";
import { requireNetwork } from "../server/network-route";
import { UpstreamError } from "../server/upstream";
import { createLiveOnScreen, keepLoaded } from "../ui/live-page";
import { findNetwork } from "../ui/networks";
import { NetworkPage } from "../ui/pages/NetworkPage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useLiveControls } from "../ui/use-live-controls";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.network";

// The loader names a cache class (`live-home`) and tidies a query string with a redirect of class `short`; a 503 it throws is not stored but
// replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Network item as the page of the section (`aria-current="page"`).
export const handle = { navSection: "network" } satisfies NetworkRouteHandle;

/** The parts of the page that a beat may keep when its answer has them failed and the page shows them loaded (`keepLoaded`, spec 1.9), one for each call or chain. */
const NETWORK_PARTS = ["openLedger", "validators", "types", "metrics", "fees", "payments", "exchanges", "amm"] as const;

/** The rows a series call asks for: the API's page maximum, far above the most buckets of a window (365 days for the daily fees of a year). */
const SERIES_LIMIT = 1000;

/**
 * `/{net}/network` (spec 1): the dashboard of a network, from the data API alone. The class is `live-home`, as the home page's: it follows the
 * chain and an open tab asks again every 4 s (see `Network`).
 *
 * - **One URL per view.** A query string that is not exactly the canonical form of the view it names (`period`, then `in`; defaults, unknown
 *   values, repeats and other parameters dropped) is a 302 to the canonical URL, class `short`, before any call: a made-up query string would
 *   otherwise be a page of its own, and a set of upstream calls.
 * - **#1 is the anchor.** `last_validated` gives the ledger, its close time and so the index day `T`, from which the window of the view follows
 *   (`windowOf`) and with it what every other call asks for. Without it there is no page (a 503), and a close time that is not a time is
 *   the same: the window cannot be worked out from it.
 * - **The rest is asked for side by side and all awaited**, even when a call has failed: what did arrive is kept for the next visitor, and no
 *   request is left running behind a page that has been answered. The fees list (#2) is the strip, and without it there is no page (a 503,
 *   once everything has settled). Every other call is a card, and so is the chain that reads the validations of the newest ledger (#2, then #3
 *   when `last_validated` is ahead of the list, then #4). A card, or the chain, that has not answered `CARD_DEADLINE_MS` after the loader began
 *   has failed ("took too long"): one slow call cannot hold the page.
 * - **A card that failed is told in its place**, with a Retry (`networkPage` builds each part, standing or failing on its own). The request
 *   is then degraded: the page is served and not stored, so the next visitor asks again. Each failure is logged.
 * - **Every call asks for the failure hold** (spec 1.7): the page polls, so a failing upstream is remembered for 5 s (a 429: for its
 *   `Retry-After`) and not asked again by every beat of every open tab. #1 and #2 are the home page's keys, so a failure is held for both pages.
 *
 * The data carries the Worker's `BUILD_ID`, for an open page to tell a deploy (`live-page.ts`).
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);

  const search = queryOf(request.url);
  const { params: view, canonical } = parseNetworkParams(search, net.id);
  if (search !== canonical) return redirect(networkHref(net.id, view), { status: 302, headers: cacheClassHeaders("short") });

  const { api } = clientsFor(context, net);
  // The calls that follow the chain are kept as long as the home page's are (and are its entries, #1 and #2); the ones over a period for theirs.
  const live = { ttl: HOME_CALL_TTL_SECONDS, holdFailure: true };
  const period = { ttl: PERIOD_CALL_TTL_SECONDS, holdFailure: true };
  const hold = { holdFailure: true };

  const last = await api.lastValidated(live).catch((err: unknown) => upstreamOutage(err, "the network"));
  let anchor: Anchor;
  try {
    anchor = anchorOrThrow(last);
  } catch (error) {
    // A 200 whose ledger or close time is not a number, which the window cannot be worked out from (`utcDayOf` would throw): the API failing.
    logProblem("the network page has no anchor", error, request);
    return upstreamOutage(error, "the network");
  }
  const w = windowOf(utcDayOf(anchor.closeTime), view.period);
  const usd = view.display === "usd" ? { exchangeCurrency: "USD", exchangeIssuer: USD_ISSUER } : {};
  const series = { interval: w.unit, start: w.start, end: w.end, limit: SERIES_LIMIT };
  const volume = { ...series, ...usd };
  const deadline = started + CARD_DEADLINE_MS;

  // #2 is the strip and the first link of the chain: asked for once, read twice.
  const feesList = api.fees({ descending: true, limit: 8 }, live);
  // The validators of the newest ledger the page shows (the home rule): its hash is `last_validated`'s, or #3's when the list is behind.
  const validators = byDeadline(
    feesList.then(async (list) => {
      const latest = latestLedgerIndex(last, list.rows);
      const hash = latest === anchor.lastValidated ? last.ledger_hash : (await api.ledger(String(latest), hold)).ledger_hash;
      return { ledger: { index: latest, hash }, answer: await api.ledgerValidations(hash, { limit: VALIDATIONS_LIMIT }, hold) };
    }),
    deadline,
  );
  // The AMM line is asked for only while its switch is on and the network has pools. The other two states are answers, not failures.
  const ammCall: Promise<NetworkInput["amm"]> | NetworkInput["amm"] = !net.hasAmm
    ? "none"
    : !net.features.ammData
      ? "off"
      : outcome(byDeadline(api.ammVolume(volume, period), deadline));

  const [fees, feeStats, types, metrics, feeDays, payments, exchanges, validations] = await Promise.allSettled([
    feesList,
    byDeadline(api.feeStats({ descending: true, limit: 1, start: w.end }, live), deadline),
    byDeadline(api.stats("type", series, period), deadline),
    // The deltas compare with the window before, so this one and the payments start at `P₀`.
    byDeadline(
      api.stats("metric", { ...series, start: w.previous.start, metrics: ["accounts_created", "ledger_count", "transaction_count"] }, period),
      deadline,
    ),
    byDeadline(api.fees({ interval: "day", start: w.start, end: w.end, limit: SERIES_LIMIT }, period), deadline),
    byDeadline(api.paymentVolume({ ...volume, start: w.previous.start }, period), deadline),
    byDeadline(api.exchangeVolume(volume, period), deadline),
    validators,
  ]);
  const amm = await ammCall;

  // Without the list there is no strip, and no page; thrown only now that every call has settled.
  if (fees.status === "rejected") return upstreamOutage(fees.reason, "the network");
  if (!Array.isArray(fees.value.rows)) {
    return upstreamOutage(new UpstreamError("server", "data API GET /v2/network/fees answered without rows", { status: 200 }), "the network");
  }

  const { page, failures } = networkPage({
    net,
    view,
    last,
    feesList: fees.value.rows,
    feeStats,
    types,
    metrics,
    feeDays,
    payments,
    exchanges,
    amm,
    validators: validations,
  });
  for (const { part, error } of failures) logProblem(`the network page's ${part} could not be loaded`, error, request);
  if (failures.length > 0) markDegraded(context, `network: ${failures.map(({ part }) => part).join(", ")}`);

  return cached({ ...page, build: getEnv(context).BUILD_ID } satisfies NetworkLoaderData, "live-home");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return networkMeta(loaderData.view, ctx);
}

/**
 * What the network page on screen shows, and what happens when its refresh does not work (the home page's `onScreen`, `live-page.ts`): the
 * page keeps what it shows, counts the failures, refuses an answer that is behind the ledger it is at or of another build, and keeps each part
 * it shows loaded when an answer has that part failed (`keepLoaded`, spec 1.9).
 */
const onScreen = createLiveOnScreen<NetworkLoaderData>({
  order: (data) => data.anchor.lastValidated,
  merge: (next, shown) => keepLoaded(next, shown, NETWORK_PARTS),
});

/**
 * In the browser only, and only after the first render (README, "Live updates"): runs the loader through the explorer's own `.data` URL and
 * hands the page what it already shows when that fails. The scope is the network and the canonical search of the view, so that a refresh of one
 * view never stands in for another: a navigation to a view that is not on screen has nothing to keep and gets the error screen as before.
 */
export function clientLoader({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  const network = findNetwork(params.net);
  // A network that does not exist is the layout's 404: no page of it to keep, and no view to name.
  if (!network) return serverLoader();
  return onScreen.reload(networkScope(network.id, parseNetworkParams(queryOf(request.url), network.id).params), serverLoader);
}

export default function Network({ loaderData }: Route.ComponentProps) {
  const network = useNetwork();
  const live = useLiveControls(onScreen);
  const scope = networkScope(network.id, loaderData.view);
  useEffect(() => onScreen.show(scope, loaderData), [scope, loaderData]);
  // Keyed by the scope: another period, currency or network is a navigation and a first render, not a ledger closing. The kit rings a chart
  // whose token changes after it is mounted, so the page must be mounted again.
  return <NetworkPage key={scope} network={network} data={loaderData} live={live} />;
}
