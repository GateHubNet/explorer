// What the routes under `/:net` share on the server: the network of the URL, the part of it that may go to the
// browser, and the cookie the root redirect reads. Worker-only code, for loaders.

import { cached } from "./edge-cache";
import { getEnv } from "./env";
import { isNetworkId, networkOf, type Network, type NetworkId } from "./networks";

/** The facts about a network the browser may have: no data API URL, no node URL. */
export type PublicNetwork = Omit<Network, "dataApiUrl" | "nodeUrl">;

export function publicNetwork(net: Network): PublicNetwork {
  const { dataApiUrl: _dataApiUrl, nodeUrl: _nodeUrl, ...shown } = net;
  return shown;
}

/**
 * The network named by the `:net` segment of the route, with this deployment's URLs. Any other segment is a 404 of
 * class `short`, thrown: a route that calls this needs `export const headers = forwardCacheClass`.
 */
export function requireNetwork(context: unknown, params: { net?: string }): Network {
  const segment = params.net ?? "";
  if (!isNetworkId(segment)) throw cached({ notFound: `network ${JSON.stringify(segment)}` }, "short", { status: 404 });
  return networkOf(segment, getEnv(context));
}

/** The network a `Cookie` request header names in `net=...`, if it names one. */
export function readNetworkCookie(header: string | null): NetworkId | undefined {
  const value = header === null ? undefined : /(?:^|;\s*)net=([^;]*)/.exec(header)?.[1];
  return value !== undefined && isNetworkId(value) ? value : undefined;
}
