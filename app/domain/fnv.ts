// FNV-1a, the 32-bit hash behind the `token` of a chart's data (spec 2.9) and the seed of the fixture generators.
// Pure: the browser, the Worker and Node import this file, and all three give the same hash for the same text.

const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

const encoder = new TextEncoder();

/** The 32-bit FNV-1a hash of the UTF-8 bytes of `text`, as an unsigned integer (`fnv1a32("")` is 2166136261). */
export function fnv1a32(text: string): number {
  let hash = OFFSET_BASIS;
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, PRIME);
  }
  return hash >>> 0;
}

/**
 * The token of a value: `fnv1a32` of its JSON text, as 8 lower-case hex digits. The same data gives the same token only if its
 * keys come in the same order, so a builder writes its objects the same way each time. A value JSON cannot write
 * (`undefined`, a function) is the token of the empty text.
 */
export function tokenOf(value: unknown): string {
  return fnv1a32(JSON.stringify(value) ?? "").toString(16).padStart(8, "0");
}
