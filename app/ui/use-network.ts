import { useRouteLoaderData } from "react-router";

import type { PublicNetwork } from "../server/network-route";
import { environmentOf, type Environment } from "./environment";
import { NO_FEATURES, type Features } from "./features";

/** The loader data of the `/:net` layout (app/routes/net.tsx). */
export type NetworkLoaderData = { network: PublicNetwork };

/** The id of the layout route, as React Router names it: the path of its file without the extension. */
export const NETWORK_ROUTE_ID = "routes/net";

/** The id of the root route (app/root.tsx), as React Router names it. */
export const ROOT_ROUTE_ID = "root";

/**
 * The environment of this deployment, from the root's loader data (app/root.tsx): for components outside the `/:net` layout's data (the root's
 * error page, the not-found route, the network switch). "development" where that data is missing (a test without the root, a component rendered
 * on its own), and this never throws.
 */
export function useEnvironment(): Environment {
  try {
    return environmentOf(useRouteLoaderData<{ environment?: unknown }>(ROOT_ROUTE_ID)?.environment);
  } catch {
    // Not under a data router at all: `useRouteLoaderData` throws there.
    return "development";
  }
}

/**
 * The network of the page: its id, name, native currency, CTID network id and the other network. For components under
 * the `/:net` layout. Nothing of the data API or node URLs is in it (that stays in the Worker).
 */
export function useNetwork(): PublicNetwork {
  const data = useRouteLoaderData<NetworkLoaderData>(NETWORK_ROUTE_ID);
  if (!data) throw new Error("useNetwork() needs the /:net layout (app/routes/net.tsx) above it");
  return data.network;
}

/**
 * The switches (app/ui/features.ts) of this deployment, for components that are not drawn from page data (the header, a sentence's link).
 * They come with the network, in the `/:net` layout's data. Where that data is missing (an unknown network's error page, a test without
 * the layout, a component rendered on its own) every switch is off, and this never throws.
 */
export function useFeatures(): Features {
  try {
    return useRouteLoaderData<NetworkLoaderData>(NETWORK_ROUTE_ID)?.network?.features ?? NO_FEATURES;
  } catch {
    // Not under a data router at all: `useRouteLoaderData` throws there.
    return NO_FEATURES;
  }
}
