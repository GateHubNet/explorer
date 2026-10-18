// The networks the explorer shows and where each one is reached. The only place that knows a network's
// URLs: adding a network is one entry in NETWORKS (and its two variables in `Env` and wrangler.jsonc).

import type { Env } from "./env";

export type NetworkId = "xrpl" | "xahau";

export interface Network {
  id: NetworkId;
  /** For display. */
  name: "XRPL" | "Xahau";
  /** The currency that has no issuer. */
  native: "XRP" | "XAH";
  /** The network id in a CTID. */
  ctidNetworkId: 0 | 21337;
  /** Base URL of the GateHub Data API deployment for this network, as configured (no `/v2`). */
  dataApiUrl: string;
  /** The network's rippled or xahaud JSON-RPC endpoint, as configured. */
  nodeUrl: string;
  /** The network the switch leads to. */
  other: NetworkId;
}

type NetworkEntry = Omit<Network, "dataApiUrl" | "nodeUrl"> & {
  /** The `Env` variables that hold this network's URLs. */
  dataApiUrlVar: "XRPL_DATA_API_URL" | "XAHAU_DATA_API_URL";
  nodeUrlVar: "XRPL_NODE_URL" | "XAHAU_NODE_URL";
};

const NETWORKS: Record<NetworkId, NetworkEntry> = {
  xrpl: {
    id: "xrpl",
    name: "XRPL",
    native: "XRP",
    ctidNetworkId: 0,
    other: "xahau",
    dataApiUrlVar: "XRPL_DATA_API_URL",
    nodeUrlVar: "XRPL_NODE_URL",
  },
  xahau: {
    id: "xahau",
    name: "Xahau",
    native: "XAH",
    ctidNetworkId: 21337,
    other: "xrpl",
    dataApiUrlVar: "XAHAU_DATA_API_URL",
    nodeUrlVar: "XAHAU_NODE_URL",
  },
};

/** Whether a first path segment names a network. Exact and case-sensitive: `/XRPL/...` is a 404. */
export function isNetworkId(s: string): s is NetworkId {
  return Object.hasOwn(NETWORKS, s);
}

/** The network a CTID's network id belongs to, or `undefined` for any other (a testnet, a sidechain): never a guess. */
export function networkIdOfCtid(networkId: number): NetworkId | undefined {
  return (Object.keys(NETWORKS) as NetworkId[]).find((id) => NETWORKS[id].ctidNetworkId === networkId);
}

/** The network `id` with the URLs this deployment is configured with. */
export function networkOf(id: NetworkId, env: Env): Network {
  const { dataApiUrlVar, nodeUrlVar, ...entry } = NETWORKS[id];
  return { ...entry, dataApiUrl: env[dataApiUrlVar], nodeUrl: env[nodeUrlVar] };
}
