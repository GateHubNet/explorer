// The networks the explorer shows and where each one is reached: the only place that knows a network's URLs and facts; the names are
// app/ui/networks.ts's. Which two networks a deployment shows depends on its environment (`ENVIRONMENT`: the sandbox shows the testnets,
// development and production the mainnets), so the facts are a table by kind. Adding a network is one entry in each kind of NETWORKS (and its
// two variables in `Env` and wrangler.jsonc).

import type { Display } from "../domain/network-params";
import { environmentOf, networkKindOf, type NetworkKind } from "../ui/environment";
import { featuresOf, type Features } from "../ui/features";
import { isNetworkId, NETWORK_NAMES } from "../ui/networks";
import type { Env } from "./env";

export type NetworkId = "xrpl" | "xahau";

export interface Network {
  id: NetworkId;
  /** Which kind of network this is: the environment decides (the sandbox shows the testnets). */
  kind: NetworkKind;
  /** For display: "XRPL", "XRPL Testnet". The words of each network are app/ui/networks.ts's `NETWORK_NAMES`. */
  name: string;
  /** Where the name is a status or a pill: "XRPL mainnet", "XRPL Testnet". */
  label: string;
  /** In a sentence: "the XRP Ledger", "XRPL Testnet". */
  longName: string;
  /** The network's decentralised exchange, in a sentence: "the XRP Ledger DEX". */
  dexName: string;
  /** The currency that has no issuer. */
  native: "XRP" | "XAH";
  /** The network id in a CTID. */
  ctidNetworkId: 0 | 21337 | 1 | 21338;
  /** Base URL of the GateHub Data API deployment for this network, as configured (no `/v2`). */
  dataApiUrl: string;
  /** The network's rippled or xahaud JSON-RPC endpoint, as configured. */
  nodeUrl: string;
  /** The network the switch leads to. */
  other: NetworkId;
  /** Whether the network's ledger has automated market makers (XRPL and XRPL Testnet do, Xahau and Xahau Testnet do not). */
  hasAmm: boolean;
  /** The server software the network's validators run: it names the file their domains publish (`xrp-ledger.toml` or `xahau.toml`). */
  software: "rippled" | "xahaud";
  /** The currencies the network's amounts can be shown in, the native one first. Only the mainnet XRPL has USD (issued by GateHub). */
  displays: readonly Display[];
  /** The switches of this deployment (`featuresOf(env)`: the same for both networks). */
  features: Features;
}

type NetworkEntry = Pick<Network, "id" | "kind" | "native" | "ctidNetworkId" | "other" | "hasAmm" | "software" | "displays"> & {
  /** The `Env` variables that hold this network's URLs. */
  dataApiUrlVar: "XRPL_DATA_API_URL" | "XAHAU_DATA_API_URL";
  nodeUrlVar: "XRPL_NODE_URL" | "XAHAU_NODE_URL";
};

// `other`, `dataApiUrlVar` and `nodeUrlVar` are the same in both kinds: the URLs are the environment's (wrangler.jsonc), not the kind's.
const NETWORKS: Record<NetworkKind, Record<NetworkId, NetworkEntry>> = {
  mainnet: {
    xrpl: {
      id: "xrpl",
      kind: "mainnet",
      native: "XRP",
      ctidNetworkId: 0,
      other: "xahau",
      hasAmm: true,
      software: "rippled",
      displays: ["native", "usd"],
      dataApiUrlVar: "XRPL_DATA_API_URL",
      nodeUrlVar: "XRPL_NODE_URL",
    },
    xahau: {
      id: "xahau",
      kind: "mainnet",
      native: "XAH",
      ctidNetworkId: 21337,
      other: "xrpl",
      hasAmm: false,
      software: "xahaud",
      displays: ["native"],
      dataApiUrlVar: "XAHAU_DATA_API_URL",
      nodeUrlVar: "XAHAU_NODE_URL",
    },
  },
  testnet: {
    xrpl: {
      id: "xrpl",
      kind: "testnet",
      native: "XRP",
      ctidNetworkId: 1,
      other: "xahau",
      hasAmm: true,
      software: "rippled",
      displays: ["native"],
      dataApiUrlVar: "XRPL_DATA_API_URL",
      nodeUrlVar: "XRPL_NODE_URL",
    },
    xahau: {
      id: "xahau",
      kind: "testnet",
      native: "XAH",
      ctidNetworkId: 21338,
      other: "xrpl",
      hasAmm: false,
      software: "xahaud",
      displays: ["native"],
      dataApiUrlVar: "XAHAU_DATA_API_URL",
      nodeUrlVar: "XAHAU_NODE_URL",
    },
  },
};

// Whether a first path segment names a network is app/ui/networks.ts's `isNetworkId` (the browser asks it too): the Worker's routes import it from here.
export { isNetworkId };

/** The network of that kind whose CTID network id it is, or `undefined` for any other (the other kind's, a sidechain): never a guess. */
export function networkIdOfCtid(networkId: number, kind: NetworkKind): NetworkId | undefined {
  const networks = NETWORKS[kind];
  return (Object.keys(networks) as NetworkId[]).find((id) => networks[id].ctidNetworkId === networkId);
}

/** The network `id` of the kind this environment shows (`ENVIRONMENT`), with its names, the URLs this deployment is configured with and its switches. */
export function networkOf(id: NetworkId, env: Env): Network {
  const kind = networkKindOf(environmentOf(env.ENVIRONMENT));
  const { dataApiUrlVar, nodeUrlVar, ...entry } = NETWORKS[kind][id];
  return { ...entry, ...NETWORK_NAMES[kind][id], dataApiUrl: env[dataApiUrlVar], nodeUrl: env[nodeUrlVar], features: featuresOf(env) };
}
