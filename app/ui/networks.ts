// The networks as the browser's chrome lists them. The facts about a network (native currency, CTID id, URLs) live in
// app/server/networks.ts; what the chrome needs to draw a switch, a header or an error page is the id and the names, which depend on the
// kind of network the environment shows (app/ui/environment.ts) and so are a table by kind.

import type { PublicNetwork } from "../server/network-route";
import type { NetworkId } from "../server/networks";
import type { NetworkKind } from "./environment";

/** The part of a network the chrome (header, switch, search box, 404 page) needs: its id, its kind and its names (`NETWORK_NAMES`). */
export type NetworkBrief = { id: NetworkId; kind: NetworkKind; name: string; label: string; longName: string; dexName: string };

/** What a page needs of its network besides the chrome: the native currency, for fees and supply, and the software, for the file a validator's domain publishes. */
export type NetworkInfo = NetworkBrief & Pick<PublicNetwork, "native" | "software">;

/**
 * What each network is called, by the kind of network the environment shows (sandbox spec 5): `name` (breadcrumbs, titles, the search box), `label` (where
 * the word "mainnet" or "Testnet" belongs to the name), `longName` (a sentence: "Explore the XRP Ledger") and `dexName` ("Trades on the XRP Ledger DEX"). Pure, so
 * the browser has it; app/server/networks.ts adds these to its facts.
 */
export const NETWORK_NAMES: Record<NetworkKind, Record<NetworkId, { name: string; label: string; longName: string; dexName: string }>> = {
  mainnet: {
    xrpl: { name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX" },
    xahau: { name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX" },
  },
  testnet: {
    xrpl: { name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX" },
    xahau: { name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX" },
  },
};

/** In the order the switch shows them. */
const NETWORK_IDS = ["xrpl", "xahau"] as const satisfies readonly NetworkId[];

const CHOICES: Record<NetworkKind, readonly NetworkBrief[]> = {
  mainnet: NETWORK_IDS.map((id) => ({ id, kind: "mainnet", ...NETWORK_NAMES.mainnet[id] })),
  testnet: NETWORK_IDS.map((id) => ({ id, kind: "testnet", ...NETWORK_NAMES.testnet[id] })),
};

/** The two networks of a kind, in the switch's order (xrpl, xahau). */
export function networkChoices(kind: NetworkKind): readonly NetworkBrief[] {
  return CHOICES[kind];
}

/** The network of a page that belongs to none (an unknown path, an unknown network): the first of the switch. */
export const DEFAULT_NETWORK_ID: NetworkId = "xrpl";

/** The network named by a `:net` segment, if it names one: exact and case-sensitive, as the paths are (`isNetworkId`). A `NetworkId` always names one. */
export function findNetwork(segment: NetworkId, kind: NetworkKind): NetworkBrief;
export function findNetwork(segment: string | undefined, kind: NetworkKind): NetworkBrief | undefined;
export function findNetwork(segment: string | undefined, kind: NetworkKind): NetworkBrief | undefined {
  return CHOICES[kind].find((choice) => choice.id === segment);
}
