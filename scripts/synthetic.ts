// Seeded randomness for the generators of synthetic fixtures (spec 4, "Fixtures"; the generators of E2 to E6 share it). A generator draws from
// one stream per network and endpoint, `mulberry32(seedOf(net, endpoint))`, in an order that depends on nothing but the dates it writes, so
// `pnpm fixtures:sync` writes the same bytes on every machine and a change to a file shows as a change to the generator.
//
// Only integer arithmetic and the four operations of IEEE doubles are used here, and a generator keeps to them (no Math.sin, Math.exp or
// `**` with a fraction: an engine may round those differently), so the numbers are the same on every Node.

import { fnv1a32 } from "../app/domain/fnv";

/** mulberry32: a generator of 32 bits of state. Every call gives a number in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed named by its parts (the network, the endpoint): the FNV-1a hash of them joined by a space. */
export function seedOf(...parts: string[]): number {
  return fnv1a32(parts.join(" "));
}
