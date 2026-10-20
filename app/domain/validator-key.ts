// The keys a validator page is addressed by (spec 1.2). Loaders and server code only: it value-imports `ripple-address-codec`, which no
// browser file may (a bundle test checks it). The links to a validator are in validators-params.ts, which does not need the codec.

import { decodeNodePublic, encodeNodePublic } from "ripple-address-codec";

/** The first bytes of a node public key: secp256k1 (compressed, `02` or `03`) or Ed25519 (`ED`). */
const KEY_PREFIXES = new Set([0x02, 0x03, 0xed]);

/** 66 hex digits, any case, that start with one of those bytes. */
const HEX_KEY = /^(02|03|ED)[0-9A-F]{64}$/i;

/** Base58, accepted by `decodeNodePublic` (version 0x1C, checksum, 33 bytes), first byte 0x02, 0x03 or 0xED. */
export function isNodePublicKey(s: string): boolean {
  try {
    const bytes = decodeNodePublic(s);
    return bytes.length === 33 && KEY_PREFIXES.has(bytes[0]);
  } catch {
    return false;
  }
}

/**
 * The key a `/validators/{key}` path segment names, or `null` for anything that is not one (a 404 with no call). A base58 key is
 * returned as it is. 66 hex digits are converted to the base58 key they spell (`from: "hex"`: the loader answers a redirect, as it
 * does from an X-address to a classic address). The string alone cannot tell a master key from a signing key: the loader asks D.
 */
export function parseValidatorKey(raw: string): { key: string; from?: "hex" } | null {
  if (HEX_KEY.test(raw)) {
    // No Buffer: app/ has no Node types, and the Worker has no use for it.
    const bytes = Uint8Array.from(raw.match(/../g)!, (pair) => parseInt(pair, 16));
    return { key: encodeNodePublic(bytes), from: "hex" };
  }
  return isNodePublicKey(raw) ? { key: raw } : null;
}
