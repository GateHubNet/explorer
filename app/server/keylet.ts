// The ID of an escrow from its owner and the sequence of its creation: a keylet, the key the ledger keeps the entry under (rippled's `Indexes.cpp`, `keylet::escrow`). The owner-and-sequence
// address of an escrow (`/xrpl/escrows/{owner}/{sequence}`) is worked out into the ID with it, in the Worker, before any call. Worker only: it decodes an address (`ripple-address-codec`)
// and hashes with Web Crypto, which no page needs, so no file of the browser imports it.
//
// scripts/object-fixtures.ts keeps a synchronous copy for the fixture generator (its whole chain is synchronous and Web Crypto is not); test/unit/object-fixtures.test.ts pins the two equal over
// every escrow of the recordings, and this file's test holds this one to the ID the ledger gave each of them.

import { decodeAccountID } from "ripple-address-codec";

/** The ledger namespace of an escrow, `u` (0x75), as the two bytes a keylet starts with. */
const ESCROW_SPACE = 0x0075;

const SEQUENCE_LIMIT = 0x1_0000_0000;

/**
 * The ID of the escrow `owner` created with `sequence`: SHA-512Half (the first 32 bytes of SHA-512) of `0x0075`, the 20 bytes of the owner's AccountID and the sequence as four big-endian
 * bytes, in upper-case hexadecimal. The sequence is the `Sequence` of the `EscrowCreate` (its `TicketSequence` when a ticket paid for it). Throws a `RangeError` for a sequence that is no
 * unsigned 32-bit integer (written into four bytes it would wrap into another escrow's), and whatever `decodeAccountID` throws for what is no address.
 */
export async function escrowKeylet(owner: string, sequence: number): Promise<string> {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence >= SEQUENCE_LIMIT) throw new RangeError(`an escrow's sequence is an unsigned 32-bit integer, not ${sequence}`);
  const preimage = new Uint8Array(2 + 20 + 4);
  const view = new DataView(preimage.buffer);
  view.setUint16(0, ESCROW_SPACE);
  preimage.set(decodeAccountID(owner), 2);
  view.setUint32(22, sequence);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", preimage));
  return Array.from(digest.subarray(0, 32), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}
