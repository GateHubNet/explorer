// The networks as the browser's chrome lists them. The facts about a network (native currency, CTID id, URLs) live in
// app/server/networks.ts; what the layout needs to draw a switch is the id and the name.

import type { PublicNetwork } from "../server/network-route";
import type { NetworkId } from "../server/networks";
import type { NetworkKind } from "./environment";

/** The part of a network the chrome (header, switch, search box, 404 page) needs. */
export type NetworkBrief = Pick<PublicNetwork, "id" | "name">;

/** What a page needs of its network besides the chrome: the native currency, for fees and supply, and the software, for the file a validator's domain publishes. */
export type NetworkInfo = Pick<PublicNetwork, "id" | "name" | "native" | "software">;

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
export const NETWORK_CHOICES = [
  { id: "xrpl", name: "XRPL" },
  { id: "xahau", name: "Xahau" },
] as const satisfies readonly NetworkBrief[];

/** The network of a page that belongs to none (an unknown path, an unknown network). */
export const DEFAULT_NETWORK: NetworkBrief = NETWORK_CHOICES[0];

/** The network named by a `:net` segment, if it names one. */
export function findNetwork(segment: string | undefined): NetworkBrief | undefined {
  return NETWORK_CHOICES.find((choice) => choice.id === segment);
}
