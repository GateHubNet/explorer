// The networks as the browser's chrome lists them. The facts about a network (native currency, CTID id, URLs) live in
// app/server/networks.ts; what the layout needs to draw a switch is the id and the name.

import type { PublicNetwork } from "../server/network-route";

/** The part of a network the chrome (header, switch, search box, 404 page) needs. */
export type NetworkBrief = Pick<PublicNetwork, "id" | "name">;

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
