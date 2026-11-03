// What the search box was given. Pure: the header's live hints and the server's search route both use it.
//
// It says what the input looks like, not whether the thing exists, and not which network it belongs to:
// a CTID carries a network id, but an account or a hash can be on either network.

import { isValidClassicAddress, isValidXAddress, xAddressToClassicAddress } from "ripple-address-codec";

import { decodeCtid } from "./ctid";
import { isMptIssuanceId } from "./mpt-id";

export type SearchKind =
  | { kind: "ledger-index"; index: number }
  | { kind: "hash"; hash: string }
  | { kind: "mpt"; id: string }
  | { kind: "ctid"; ctid: string; ledgerIndex: number; txIndex: number; networkId: number }
  | { kind: "account"; address: string; tag?: number }
  | { kind: "none" };

const MAX_LEDGER_INDEX = 4294967295;

/**
 * An issuance ID (E14 spec 8): exactly 48 hex digits, no `0x`. The one test of it is `isMptIssuanceId` (mpt-id.ts: test/unit/mpt-id-text.test.ts holds the pattern to its few files); a plain boolean here,
 * since its type predicate would narrow the rest of `classify`'s string to `never` where it is false.
 */
const isMptId = (text: string): boolean => isMptIssuanceId(text);
/** 64 hex digits, with or without the `0x` some tools put in front. */
const HASH = /^(?:0x)?([0-9a-f]{64})$/i;
const DIGITS = /^\d{1,10}$/;
/**
 * A ledger index grouped by thousands, the way the explorer shows one (`107,695,660`) and visitors copy it: one to three digits,
 * then groups of exactly three, all separated by the same comma or the same single space.
 */
const GROUPED = /^\d{1,3}([, ])\d{3}(?:\1\d{3})*$/;

/**
 * Tells what a search input is. The input is trimmed; hashes, issuance IDs and CTIDs come back in upper case, an
 * address as it was typed (its case is part of it).
 *
 * The order matters: 48 decimal digits are an MPT issuance ID and 64 a hash, not a ledger index. The ID goes first of the hex rules
 * (it is the only shape of 48 digits, and takes no `0x`). A CTID starts with `C` and an address with `r`, `X` or `T`, so neither
 * can be taken for the other. That the thing exists, or that the network has MPT, is for the route to say: this is the shape.
 */
export function classify(input: string): SearchKind {
  const s = input.trim();

  if (isMptId(s)) return { kind: "mpt", id: s.toUpperCase() };

  const hash = HASH.exec(s);
  if (hash) return { kind: "hash", hash: hash[1]!.toUpperCase() };

  const ctid = decodeCtid(s);
  if (ctid) return { kind: "ctid", ctid: s.toUpperCase(), ...ctid };

  if (DIGITS.test(s) || GROUPED.test(s)) {
    const index = Number(s.replace(/[, ]/g, ""));
    return index >= 1 && index <= MAX_LEDGER_INDEX ? { kind: "ledger-index", index } : { kind: "none" };
  }

  if (isValidClassicAddress(s)) return { kind: "account", address: s };

  if (isValidXAddress(s)) {
    const { classicAddress, tag } = xAddressToClassicAddress(s);
    // `tag` is `false`, not absent, when the X-address carries none.
    return tag === false
      ? { kind: "account", address: classicAddress }
      : { kind: "account", address: classicAddress, tag };
  }

  return { kind: "none" };
}
