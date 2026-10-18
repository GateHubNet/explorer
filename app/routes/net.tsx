import { Outlet, useMatches } from "react-router";

import { forwardCacheClass } from "../server/edge-cache";
import { publicNetwork, requireNetwork, type NetworkLayoutData } from "../server/network-route";
import { PRODUCT_NAME } from "../ui/brand";
import { NetworkCookie } from "../ui/components/NetworkCookie";
import { Shell } from "../ui/components/Shell";
import { DEFAULT_NETWORK, findNetwork } from "../ui/networks";
import { errorMeta, RouteErrorScreen } from "../ui/pages/RouteErrorScreen";
import { onlyWhenParamsChange } from "../ui/revalidation";
import { wantsHeroSearch } from "../ui/route-handle";

import type { Route } from "./+types/net";

// A 404 for a network that does not exist is class short; the route needs this to pass it on (see edge-cache.ts).
export const headers = forwardCacheClass;

// The layout's data is the network and the origin: nothing a page's revalidation (the home page's, every 4 s) could change. Left out of it,
// the page's request is for the page alone, and a request that fails cannot take this layout's error boundary with it (revalidation.ts).
export const shouldRevalidate = onlyWhenParamsChange;

/**
 * The layout of `/:net`. Its loader answers for the whole network: an unknown first segment is a 404, a known one gives the
 * child routes `useNetwork()` (the public part of the network; the data API and node URLs stay in the Worker) and, to their `meta`,
 * the origin of the request. It names no cache class: that is the page's.
 */
export function loader({ request, params, context }: Route.LoaderArgs): NetworkLayoutData {
  return { network: publicNetwork(requireNetwork(context, params)), origin: new URL(request.url).origin };
}

export function meta({ error, loaderData, params }: Route.MetaArgs) {
  if (error) return errorMeta(error, findNetwork(params.net) ? undefined : params.net);
  return [{ title: `${loaderData?.network.name ?? ""} · ${PRODUCT_NAME}` }];
}

export default function NetworkLayout({ loaderData }: Route.ComponentProps) {
  const { network } = loaderData;
  // The home page has a bigger search box of its own, and the header's would answer the "/" key too.
  const search = !wantsHeroSearch(useMatches());
  return (
    <Shell net={network} search={search}>
      <NetworkCookie net={network.id} />
      <Outlet />
    </Shell>
  );
}

/**
 * Shown when the layout's loader threw (an unknown network) and when a page under it threw and has no boundary of its own,
 * for example the 404 of a ledger that does not exist. It replaces the layout, so it brings the page frame itself.
 */
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  const network = findNetwork(params.net);
  return (
    <Shell net={network ?? DEFAULT_NETWORK}>
      {network && <NetworkCookie net={network.id} />}
      <RouteErrorScreen
        error={error}
        net={network ?? DEFAULT_NETWORK}
        unknownNetwork={network ? undefined : params.net}
      />
    </Shell>
  );
}
