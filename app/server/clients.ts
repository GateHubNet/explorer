// The two upstream clients of a request, for loaders: the GateHub Data API of a network and the network's own node,
// both reading and writing the request's subrequest cache. Worker-only code.

import { createDataApi, type DataApi } from "./data-api";
import { getEnv, getSubrequestCache } from "./env";
import type { Network } from "./networks";
import { createNodeRpc, type NodeRpc } from "./node-rpc";

/**
 * `const { api, node } = clientsFor(context, net)`, with `net` from `requireNetwork(context, params)`. Loaders that
 * run side by side for one request share the cache, so a ledger header that the layout and a page both read is
 * fetched once.
 */
export function clientsFor(context: unknown, net: Network): { api: DataApi; node: NodeRpc } {
  const cache = getSubrequestCache(context);
  return { api: createDataApi(net, getEnv(context), cache), node: createNodeRpc(net, cache) };
}
