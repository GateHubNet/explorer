// The ID of an escrow from its owner and the sequence of its creation: a keylet, the key the ledger keeps the entry under (rippled's `Indexes.cpp`, `keylet::escrow`). The owner-and-sequence
// address of an escrow (`/xrpl/escrows/{owner}/{sequence}`) is worked out into the ID with it, in the Worker, before any call. Worker only: it decodes an address (`ripple-address-codec`)
// and hashes with Web Crypto, which no page needs, so no file of the browser imports it.
//
// The layout of the preimage is written once, here, as `escrowPreimage`, and is synchronous: the hash is the only thing that differs. This file hashes it with Web Crypto (asynchronous); the fixture
// generator (scripts/object-fixtures.ts), whose chain is synchronous, hashes the same bytes with Node's `createHash`. This file's test holds the Worker's keylet to the ID the ledger gave every
// recorded escrow, and the generator's own tests hold its keylets to the same recordings.

import { decodeAccountID } from "ripple-address-codec";

/** The ledger namespace of an escrow, `u` (0x75), as the two bytes a keylet starts with. */
const ESCROW_SPACE = 0x0075;

const SEQUENCE_LIMIT = 0x1_0000_0000;

/**
 * What an escrow's ID is the hash of: `0x0075`, the 20 bytes of the owner's AccountID and the sequence as four big-endian bytes. Throws a `RangeError` for a sequence that is no unsigned 32-bit
 * integer (written into four bytes it would wrap into another escrow's), and whatever `decodeAccountID` throws for what is no address.
 */
export function escrowPreimage(owner: string, sequence: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence >= SEQUENCE_LIMIT) throw new RangeError(`an escrow's sequence is an unsigned 32-bit integer, not ${sequence}`);
  const preimage = new Uint8Array(2 + 20 + 4);
  const view = new DataView(preimage.buffer);
  view.setUint16(0, ESCROW_SPACE);
  preimage.set(decodeAccountID(owner), 2);
  view.setUint32(22, sequence);
  return preimage;
}

/**
 * The ID of the escrow `owner` created with `sequence`: SHA-512Half (the first 32 bytes of SHA-512) of its `escrowPreimage`, in upper-case hexadecimal. The sequence is the `Sequence` of the
 * `EscrowCreate` (its `TicketSequence` when a ticket paid for it). Throws what `escrowPreimage` throws.
 */
export async function escrowKeylet(owner: string, sequence: number): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", escrowPreimage(owner, sequence)));
  return Array.from(digest.subarray(0, 32), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}
