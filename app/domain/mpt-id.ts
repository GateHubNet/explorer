// What an MPT issuance ID is made of (E14): 48 hex digits, the issuance's `Sequence` as 4 big-endian bytes and then the issuer's 20-byte AccountID (rippled's `makeMptID`). Worker-only: it
// value-imports `ripple-address-codec`, so a page never imports it; the loaders, `parse/` and `describe/`, the fixture scripts and the tests do, and a page receives the words they make.
// A leaf, with nothing of `app/` in it, so that `parse/objects.ts` (in the Node type-check project, tsconfig.node.json) and `describe/helpers.ts` (which imports `parse/objects.ts`) can both
// use it without a cycle; `describe/helpers.ts` exports both functions, which is where the spec names them.

import { decodeAccountID, encodeAccountID } from "ripple-address-codec";

const MPT_ID = /^[0-9A-Fa-f]{48}$/;
const UINT32_MAX = 4_294_967_295;

/** Whether `value` is an issuance ID's text: 48 hex digits, in either case. The one test of it in `parse/` and `describe/`; the browser's `mpt.ts` keeps its own, as it cannot import this file. */
export const isMptIssuanceId = (value: unknown): value is string => typeof value === "string" && MPT_ID.test(value);

/**
 * The ID of the issuance an account made with a `Sequence` (the ticket's, when it used one: the node of the issuance holds the right one): 48 upper-case hex digits. A `RangeError` unless
 * `sequence` is a whole number up to 4294967295; `issuer` must be a classic address (the codec throws for another).
 */
export function mptIdOf(sequence: number, issuer: string): string {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > UINT32_MAX) throw new RangeError("an MPT issuance's sequence is a whole number up to 4294967295");
  const issuerHex = Array.from(decodeAccountID(issuer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${sequence.toString(16).padStart(8, "0")}${issuerHex}`.toUpperCase();
}

/** The classic address of the issuer an ID holds (bytes 4 to 23), whatever the case of the ID. A `RangeError` unless `id` is 48 hex digits. */
export function mptIssuerOf(id: string): string {
  if (!isMptIssuanceId(id)) throw new RangeError("an MPT issuance ID is 48 hex digits");
  return encodeAccountID(Uint8Array.from({ length: 20 }, (_, at) => parseInt(id.slice(8 + 2 * at, 10 + 2 * at), 16)));
}
