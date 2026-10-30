// Where a link to an escrow, a check, a payment channel or a delegation leads (E10): the one decision every inbound link makes, and the pages' paths. Pure and safe for the browser, so that
// the pages that show such an object but are no object page (a transaction's sentence, an account's Objects and Delegation tabs, the search) load only this. Types are imported, and
// erased: it imports nothing at run time.

import type { Features } from "../ui/features";
import type { NetworkId } from "../server/networks";
import type { ObjectApiKind } from "../server/api-types";

/** The three objects that have a page, as the path and the pages name them. (`ObjectApiKind` is the data API's name for the same three, with `payment_channel`.) */
export type ObjectKind = "escrow" | "check" | "payment-channel";

/**
 * Each kind of object: the ledger entry type it is (`type`), its name in a path (`kind`) and the segment the path has for it, the data API's name (`api`) and what a sentence
 * calls it (`words`).
 */
export const OBJECT_KINDS: ReadonlyArray<{
  type: "Escrow" | "Check" | "PayChannel";
  kind: ObjectKind;
  segment: "escrows" | "checks" | "payment-channels";
  api: ObjectApiKind;
  words: "escrow" | "check" | "payment channel";
}> = [
  { type: "Escrow", kind: "escrow", segment: "escrows", api: "escrow", words: "escrow" },
  { type: "Check", kind: "check", segment: "checks", api: "check", words: "check" },
  { type: "PayChannel", kind: "payment-channel", segment: "payment-channels", api: "payment_channel", words: "payment channel" },
];

/** The kind of a ledger entry type, or none for any other (a `Delegate` is no object page: its place is the Delegation tab). */
export function kindOfType(type: string): ObjectKind | undefined {
  return OBJECT_KINDS.find((each) => each.type === type)?.kind;
}

/** How a link names an object: by its ID (64 upper-case hexadecimal digits a loader has validated), or an escrow by its owner and the sequence of its creation. */
export type ObjectRefParts = { id: string } | { owner: string; sequence: number };

/**
 * An object's path: `/xrpl/escrows/{ID}`, `/xrpl/checks/{ID}`, `/xrpl/payment-channels/{ID}`, or `/xrpl/escrows/{owner}/{sequence}` for an escrow named by its owner and sequence;
 * null while LEDGER_OBJECTS is off (plain text), and for the owner and sequence of a check or a channel, which have no such path. The ID and the owner are what a loader has
 * validated, so nothing of them is escaped in practice.
 */
export function objectHref(net: NetworkId, kind: ObjectKind, ref: ObjectRefParts, features: Features): string | null {
  if (!features.ledgerObjects) return null;
  const segment = OBJECT_KINDS.find((each) => each.kind === kind)!.segment;
  if ("id" in ref) return `/${net}/${segment}/${ref.id}`;
  return kind === "escrow" ? `/${net}/${segment}/${ref.owner}/${ref.sequence}` : null;
}

/** The Delegation tab of a delegator's account: `/xrpl/account/{delegator}?tab=delegation`; null while DELEGATION is off (plain text). */
export function delegationHref(net: NetworkId, delegator: string, features: Features): string | null {
  return features.delegation ? `/${net}/account/${delegator}?tab=delegation` : null;
}
