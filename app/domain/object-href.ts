// Where a link to an escrow's, a check's or a payment channel's page leads (E10): `objectHref` alone, the one decision every inbound link makes, so that `Sentence`, which is on every page
// that draws a sentence, loads only this and not the rest of the kinds' facts (object-link.ts, which re-exports it, as permissions.ts does the leaf permission-chip.ts). Pure: its imports
// are types, which the compiler erases; it imports nothing at run time.

import type { Features } from "../ui/features";
import type { NetworkId } from "../server/networks";

/** The three objects that have a page, as the path and the pages name them. (`ObjectApiKind` is the data API's name for the same three, with `payment_channel`.) */
export type ObjectKind = "escrow" | "check" | "payment-channel";

/** How a link names an object: by its ID (64 upper-case hexadecimal digits a loader has validated), or an escrow by its owner and the sequence of its creation. */
export type ObjectRefParts = { id: string } | { owner: string; sequence: number };

/** The segment of each kind's path: `/xrpl/escrows/{ID}`. */
export const OBJECT_SEGMENTS = { escrow: "escrows", check: "checks", "payment-channel": "payment-channels" } as const satisfies Record<ObjectKind, string>;

/**
 * An object's path: `/xrpl/escrows/{ID}`, `/xrpl/checks/{ID}`, `/xrpl/payment-channels/{ID}`, or `/xrpl/escrows/{owner}/{sequence}` for an escrow named by its owner and sequence;
 * null while LEDGER_OBJECTS is off (plain text), and for the owner and sequence of a check or a channel, which have no such path. The ID and the owner are what a loader has
 * validated, so nothing of them is escaped in practice.
 */
export function objectHref(net: NetworkId, kind: ObjectKind, ref: ObjectRefParts, features: Features): string | null {
  if (!features.ledgerObjects) return null;
  const segment = OBJECT_SEGMENTS[kind];
  if ("id" in ref) return `/${net}/${segment}/${ref.id}`;
  return kind === "escrow" ? `/${net}/${segment}/${ref.owner}/${ref.sequence}` : null;
}
