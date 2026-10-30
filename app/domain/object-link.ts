// Where a link to an escrow, a check, a payment channel or a delegation leads (E10): the one decision every inbound link makes, and the pages' paths. Pure and safe for the browser, so that
// the pages that show such an object but are no object page (a transaction's sentence, an account's Objects and Delegation tabs, the search) load only this. Types are imported, and
// erased; its one import at run time is the leaf object-href.ts (`objectHref` and the paths' segments), which it re-exports, and which `Sentence` loads alone.

import type { Features } from "../ui/features";
import type { NetworkId } from "../server/networks";
import type { ObjectApiKind } from "../server/api-types";
import { OBJECT_SEGMENTS, type ObjectKind } from "./object-href";

export { objectHref, type ObjectKind, type ObjectRefParts } from "./object-href";

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
  { type: "Escrow", kind: "escrow", segment: OBJECT_SEGMENTS.escrow, api: "escrow", words: "escrow" },
  { type: "Check", kind: "check", segment: OBJECT_SEGMENTS.check, api: "check", words: "check" },
  { type: "PayChannel", kind: "payment-channel", segment: OBJECT_SEGMENTS["payment-channel"], api: "payment_channel", words: "payment channel" },
];

/** The kind of a ledger entry type, or none for any other (a `Delegate` is no object page: its place is the Delegation tab). */
export function kindOfType(type: string): ObjectKind | undefined {
  return OBJECT_KINDS.find((each) => each.type === type)?.kind;
}

/** The Delegation tab of a delegator's account: `/xrpl/account/{delegator}?tab=delegation`; null while DELEGATION is off (plain text). */
export function delegationHref(net: NetworkId, delegator: string, features: Features): string | null {
  return features.delegation ? `/${net}/account/${delegator}?tab=delegation` : null;
}
