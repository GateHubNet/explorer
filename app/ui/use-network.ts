import { useRouteLoaderData } from "react-router";

import type { PublicNetwork } from "../server/network-route";

/** The loader data of the `/:net` layout (app/routes/net.tsx). */
export type NetworkLoaderData = { network: PublicNetwork };

/** The id of the layout route, as React Router names it: the path of its file without the extension. */
export const NETWORK_ROUTE_ID = "routes/net";

/**
 * The network of the page: its id, name, native currency, CTID network id and the other network. For components under
 * the `/:net` layout. Nothing of the data API or node URLs is in it (that stays in the Worker).
 */
export function useNetwork(): PublicNetwork {
  const data = useRouteLoaderData<NetworkLoaderData>(NETWORK_ROUTE_ID);
  if (!data) throw new Error("useNetwork() needs the /:net layout (app/routes/net.tsx) above it");
  return data.network;
}
