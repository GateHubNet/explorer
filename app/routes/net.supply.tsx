import { redirect } from "react-router";

import { queryOf } from "../domain/query-of";
import { utcDayOf, windowOf } from "../domain/window";
import { anchorOrThrow } from "../server/anchor";
import type { LastValidated, MintedPage } from "../server/api-types";
import { HOME_CALL_TTL_SECONDS, PERIOD_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { byDeadline, CARD_DEADLINE_MS } from "../server/deadline";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext } from "../server/meta";
import { supplyMeta } from "../server/meta-supply";
import { SERIES_LIMIT } from "../server/network-view";
import { requireNetwork } from "../server/network-route";
import { supplyPage } from "../server/supply-view";
import { SupplyPage } from "../ui/pages/SupplyPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.supply";

// The loader names a cache class (`slow`, and `short` for the redirect and the 404) and a TTL; a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Network item as the section of the page (`aria-current="true"`: the page is inside the section, it is not its index).
export const handle = { navSection: "network" } satisfies NetworkRouteHandle;

/**
 * `/{net}/supply` (supply spec 1 and 3): one snapshot of the native currency, from the data API's D7 routes and the network page's fees. The class is `slow` for 300 s, the page and its `.data`
 * URL: the snapshot changes hourly, the days once a day, and the page polls nothing.
 *
 * - **`SUPPLY` off** is the not-found page, a 404 of class `short`, before the query is read and before any call (spec 1).
 * - **One URL** (spec 1): any query string is a 302 to `/{net}/supply`, class `short`, with no call.
 * - **Four calls, asked for side by side and all awaited** (spec 3.2). S, the snapshot, is the page. A, the newest ledger (`last_validated`, the home page's key), gives the UTC day `T` of the
 *   window. F, the fees of the 90 days up to `T` (the network page's call, the same key), is the burned card, and waits for A. M, the minted days of the same window, is Xahau's minted card and
 *   tile, and waits for A and S, and is asked only where S has `minted`. A, F and M race `CARD_DEADLINE_MS` from the loader's start ("took too long"); S does not. Nothing is thrown until everything
 *   has settled. No call asks for the failure hold: the page polls nothing. The page names no address, so it makes no names call, and it has no node call.
 * - **S failing is a 503** that is not stored (`upstreamOutage`): a 404 `supply not computed yet`, a "Cannot GET" from an API without D7, a malformed amount and a 5xx are all the API not having the
 *   page. **A, F or M failing** is told in its place (`supplyPage` gives the card a `failed` state), logged, and the request is degraded: a 200 served and not stored.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  if (!net.features.supply) throw cached({ notFound: "the supply page" }, "short", { status: 404 });

  if (queryOf(request.url) !== "") return redirect(`/${net.id}/supply`, { status: 302, headers: cacheClassHeaders("short") });

  const { api } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const kept = { ttl: PERIOD_CALL_TTL_SECONDS };
  /** The 90 days to the UTC day of the newest ledger: what both days' calls ask for (`windowOf` is the network page's, so F is its call). */
  const windowOf90 = (last: LastValidated) => windowOf(utcDayOf(anchorOrThrow(last).closeTime), "90d");

  const supply = api.networkSupply(kept);
  const anchor = byDeadline(api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS }), deadline);
  const fees = byDeadline(
    anchor.then((last) => {
      const w = windowOf90(last);
      return api.fees({ interval: "day", start: w.start, end: w.end, limit: SERIES_LIMIT }, kept);
    }),
    deadline,
  );
  const minted = byDeadline(
    Promise.all([anchor, supply]).then(([last, snapshot]) => {
      if (snapshot.minted === undefined) return undefined;
      const w = windowOf90(last);
      return api.networkMinted({ interval: "day", start: w.start, end: w.end, limit: SERIES_LIMIT }, kept);
    }),
    deadline,
  );

  const [snapshot, last, days, mints] = await Promise.allSettled([supply, anchor, fees, minted]);

  // Thrown only now that every call has settled.
  if (snapshot.status === "rejected") return upstreamOutage(snapshot.reason, "the supply");

  const { page, failures } = supplyPage(net, snapshot.value, {
    anchor: last,
    fees: days,
    // M is asked for, and answers a page, exactly where the snapshot has `minted`: it is read by the builder only there.
    ...(snapshot.value.minted !== undefined && { minted: mints as PromiseSettledResult<MintedPage> }),
  });
  for (const { part, error } of failures) logProblem(`the supply page's ${part} could not be loaded`, error, request);
  if (failures.length > 0) markDegraded(context, `supply: ${failures.map(({ part }) => part).join(", ")}`);

  return cached(page, "slow", { ttl: PERIOD_CALL_TTL_SECONDS });
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return supplyMeta(loaderData, ctx);
}

export default function Supply({ loaderData }: Route.ComponentProps) {
  // Keyed by the network: the kit rings a chart whose token changes after it is mounted, and another network is a navigation and a first render.
  return <SupplyPage key={loaderData.network.id} data={loaderData} />;
}
