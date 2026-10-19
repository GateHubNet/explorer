import { useEffect } from "react";

import { HOME_CALL_TTL_SECONDS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv } from "../server/env";
import { homePage, latestLedgerIndex, type HomeLoaderData } from "../server/home-view";
import { upstreamOutage } from "../server/loader-errors";
import { homeMeta, metaContext } from "../server/meta";
import { requireNetwork } from "../server/network-route";
import { createHomeOnScreen } from "../ui/home-live";
import { HOME_TITLES, HomePage } from "../ui/pages/HomePage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useHomeLive } from "../ui/use-home-live";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net._index";

// The loader names a cache class (`live-home`), and a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The hero has a search box of its own; the header leaves its box out.
export const handle = { heroSearch: true } satisfies NetworkRouteHandle;

/** The newest ledgers shown. */
const LIST_SIZE = 8;

const WHAT = "the latest ledgers";

/** The value of a settled call, or the response of its failure. */
function valueOf<T>(result: PromiseSettledResult<T>): T {
  return result.status === "fulfilled" ? result.value : upstreamOutage(result.reason, WHAT);
}

/**
 * `/{net}`: the newest validated ledger (its total supply), the newest ledgers with their transaction counts and fees, and the
 * newest transactions, all from the data API (spec 3). The class is `live-home`: 1 s at the edge, then 2 s of stale copy
 * while one render refreshes it (it follows the chain, and the open page asks again every 4 s: see `Home`). The home page always
 * exists, so a "not found" from the API is an outage here.
 *
 * The three lists are asked for side by side and all awaited, even when one has failed: what did arrive is cached for the
 * visitor's next try, and no request is left running behind a page that has already been answered. They are asked for at
 * `HOME_CALL_TTL_SECONDS` (2 s), a little longer than the page's 1 s at the edge, so that a refresh finds them warm. The ledger whose header
 * is read is `latestLedgerIndex`'s, so that the tiles and the hero say one ledger even when `last_validated` is ahead of the fees list.
 * The page polls (an open tab asks again every 4 s), so all four calls ask for the failure hold: a failure of the data API is remembered for
 * 5 s (a 429: its `Retry-After`) and thrown again without a call, instead of being asked again by every beat of every tab (spec 1.7).
 * The data carries the Worker's `BUILD_ID`, for an open page to tell a deploy (`home-live.ts`).
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const network = requireNetwork(context, params);
  const { api } = clientsFor(context, network);
  // The page polls, so every call of it holds its failure (spec 1.7): a failing upstream is not asked again by every beat of every open tab.
  const fresh = { ttl: HOME_CALL_TTL_SECONDS, holdFailure: true };

  const [last, fees, transactions] = await Promise.allSettled([
    api.lastValidated(fresh),
    api.fees({ descending: true, limit: LIST_SIZE }, fresh),
    api.transactions({ descending: true, limit: LIST_SIZE }, fresh),
  ]).then((results) => [valueOf(results[0]), valueOf(results[1]), valueOf(results[2])] as const);

  const ledger = await api
    .ledger(String(latestLedgerIndex(last, fees.rows)), { holdFailure: true })
    .catch((err: unknown) => upstreamOutage(err, WHAT));
  const page = homePage({ network, ledger, fees: fees.rows, transactions: transactions.transactions });
  return cached({ ...page, build: getEnv(context).BUILD_ID } satisfies HomeLoaderData, "live-home");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return homeMeta(HOME_TITLES[ctx.network.id], ctx);
}

/**
 * What the home page on screen shows, and what happens when its refresh does not work: React Router would answer a revalidation that fails
 * (a 503 once) by dropping the page's data and showing the error boundary in its place, so the page keeps what it shows instead, counts the
 * failures (the polling slows down, the hero says so after two), gives up on a refresh that takes more than 10 s, and refuses an answer that
 * is older than the ledger it shows or of another build than it is (a deploy: it reloads, once). See `app/ui/home-live.ts` and `on-screen.ts`.
 */
const onScreen = createHomeOnScreen();

/**
 * In the browser only, and only after the first render (the document and the first hydration use the server's data as it came): runs the
 * loader above, through the explorer's own `.data` URL, and hands the page what it already shows when that fails. A navigation to the home
 * page, which has nothing on screen to keep, gets the error screen as before. (A route with a `clientLoader` has its own request: the
 * server's loader is fetched when this one asks for it, `_routes=routes/net._index`, and the `/:net` layout does not come along: `net.tsx`.)
 */
export function clientLoader({ params, serverLoader }: Route.ClientLoaderArgs) {
  return onScreen.reload(params.net, serverLoader);
}

export default function Home({ loaderData, params }: Route.ComponentProps) {
  const network = useNetwork();
  const live = useHomeLive(onScreen);
  useEffect(() => onScreen.show(params.net, loaderData), [params.net, loaderData]);
  // Keyed by the network: switching to the other network's home is a navigation, and is not animated as a ledger closing.
  return <HomePage key={network.id} network={network} data={loaderData} live={live} />;
}
