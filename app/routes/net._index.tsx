import { clientsFor } from "../server/clients";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { homePage } from "../server/home-view";
import { upstreamOutage } from "../server/loader-errors";
import { homeMeta, metaContext } from "../server/meta";
import { requireNetwork } from "../server/network-route";
import { HOME_TITLES, HomePage } from "../ui/pages/HomePage";
import type { NetworkRouteHandle } from "../ui/route-handle";
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
 * newest transactions, all from the data API (spec 3). The class is `live-home`: 3 s at the edge, then 30 s of stale copy
 * while one render refreshes it. The home page always exists, so a "not found" from the API is an outage here.
 *
 * The three lists are asked for side by side and all awaited, even when one has failed: what did arrive is cached for the
 * visitor's next try, and no request is left running behind a page that has already been answered.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const network = requireNetwork(context, params);
  const { api } = clientsFor(context, network);

  const [last, fees, transactions] = await Promise.allSettled([
    api.lastValidated(),
    api.fees({ descending: true, limit: LIST_SIZE }),
    api.transactions({ descending: true, limit: LIST_SIZE }),
  ]).then((results) => [valueOf(results[0]), valueOf(results[1]), valueOf(results[2])] as const);

  const ledger = await api.ledger(last.ledger_index).catch((err: unknown) => upstreamOutage(err, WHAT));
  return cached(homePage({ network, last, ledger, fees: fees.rows, transactions: transactions.transactions }), "live-home");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return homeMeta(HOME_TITLES[ctx.network.id], ctx);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return <HomePage network={useNetwork()} data={loaderData} />;
}
