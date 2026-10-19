// The groups of transaction types that every chart of transactions by type stacks, the same on every page of a network, so that a colour
// follows its group and never its rank (spec 6.7). Pure: the browser and the Worker import this file.

import BigNumber from "bignumber.js";

import type { NetworkId } from "../server/networks";

export interface TypeGroup {
  id: string;
  label: string;
  slot: 1 | 2 | 3 | 4 | 5 | "other";
  /** The transaction types it adds up: exact names, or every type that starts with `prefix`. */
  types?: readonly string[];
  prefix?: string;
}

const OTHER: TypeGroup = { id: "other", label: "Other", slot: "other" };

const XRPL: readonly TypeGroup[] = [
  { id: "Payment", label: "Payment", slot: 1, types: ["Payment"] },
  { id: "OfferCreate", label: "OfferCreate", slot: 2, types: ["OfferCreate"] },
  { id: "OfferCancel", label: "OfferCancel", slot: 3, types: ["OfferCancel"] },
  { id: "TrustSet", label: "TrustSet", slot: 4, types: ["TrustSet"] },
  { id: "AMM", label: "AMM", slot: 5, prefix: "AMM" },
  OTHER,
];

const XAHAU: readonly TypeGroup[] = [
  { id: "Payment", label: "Payment", slot: 1, types: ["Payment"] },
  { id: "Invoke", label: "Invoke", slot: 2, types: ["Invoke"] },
  { id: "ClaimReward", label: "ClaimReward", slot: 3, types: ["ClaimReward"] },
  { id: "URIToken", label: "URIToken", slot: 4, prefix: "URIToken" },
  { id: "SetHook", label: "SetHook", slot: 5, types: ["SetHook"] },
  OTHER,
];

const NOTES = {
  xrpl: "AMM adds up its transaction types; Other is every other type.",
  xahau: "URIToken adds up its transaction types; Other is every other type.",
} as const satisfies Record<NetworkId, string>;

/** In stack order, Other last. */
export function typeGroups(network: NetworkId): readonly TypeGroup[] {
  return network === "xahau" ? XAHAU : XRPL;
}

/** The group a transaction type adds to: the first that names it or whose prefix it starts with, else Other (the last). */
function groupOf(groups: readonly TypeGroup[], type: string): TypeGroup {
  return (
    groups.find((group) => group.types?.includes(type) || (group.prefix !== undefined && type.startsWith(group.prefix))) ??
    groups[groups.length - 1]!
  );
}

/** A row of type counts summed per group, exact, as strings; a group without a type in the row is "0". */
export function groupCounts(network: NetworkId, counts: Readonly<Record<string, number>>): Record<string, string> {
  const groups = typeGroups(network);
  const sums = new Map(groups.map((group) => [group.id, new BigNumber(0)]));
  for (const [type, count] of Object.entries(counts)) {
    const id = groupOf(groups, type).id;
    sums.set(id, sums.get(id)!.plus(count));
  }
  return Object.fromEntries(groups.map((group) => [group.id, sums.get(group.id)!.toFixed()]));
}

/** The card's note. */
export function typeGroupsNote(network: NetworkId): string {
  return NOTES[network];
}
