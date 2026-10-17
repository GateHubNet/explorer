// CTIDs (XLS-37): a short identifier for a transaction that does not depend on its hash, made of where
// the transaction sits. Pure: the browser and the Worker both import this file.
//
// Sixteen hex digits, 64 bits: the nibble `C` (binary 1100), the ledger index in 28 bits, the
// transaction's index in the ledger in 16 bits and the network id in 16 bits.

const MAX_LEDGER_INDEX = 0xfffffff;
const MAX_16_BITS = 0xffff;

/** The `C` and fifteen hex digits, in either case. */
const CTID = /^C[0-9A-F]{15}$/i;

export type DecodedCtid = { ledgerIndex: number; txIndex: number; networkId: number };

function assertField(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer from 0 to ${max}, got ${value}`);
  }
}

/** The CTID of a transaction, in upper case. Throws a RangeError for a field that does not fit its bits. */
export function encodeCtid(ledgerIndex: number, txIndex: number, networkId: number): string {
  assertField("ledgerIndex", ledgerIndex, MAX_LEDGER_INDEX);
  assertField("txIndex", txIndex, MAX_16_BITS);
  assertField("networkId", networkId, MAX_16_BITS);

  return (
    "C" +
    ledgerIndex.toString(16).toUpperCase().padStart(7, "0") +
    txIndex.toString(16).toUpperCase().padStart(4, "0") +
    networkId.toString(16).toUpperCase().padStart(4, "0")
  );
}

/** The fields of a CTID, in either case, or `null` for anything that is not one. */
export function decodeCtid(s: string): DecodedCtid | null {
  if (!CTID.test(s)) return null;

  return {
    ledgerIndex: Number.parseInt(s.slice(1, 8), 16),
    txIndex: Number.parseInt(s.slice(8, 12), 16),
    networkId: Number.parseInt(s.slice(12, 16), 16),
  };
}
