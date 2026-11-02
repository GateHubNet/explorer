// The addresses a page shows (E9, display names spec 3.1): `collectAddresses` walks the data a loader hands it and keeps every string that is a classic address.
// A leaf of its own, and it imports nothing of the tree (not even a type): `names-load.ts` re-exports it, and the fixture script (Node-typed, in `tsconfig.node.json`)
// imports it from here, because that composite project cannot take the Worker-typed files `names-load.ts` imports (env.ts, edge-cache.ts, deadline.ts).
// Worker, Node and tests only, never the browser: it imports the address codec.

import { isValidClassicAddress } from "ripple-address-codec";

/** The form of a classic address; the checksum is `isValidClassicAddress`'s to check. */
const ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/**
 * Every classic address among the strings of `parts`, once each, in the order first met. A part is walked as plain data: an array (its items in order), an object (its
 * values, in the order of its keys, depth first), or a string; a key is not a string of the data. A string is never parsed (JSON text that holds an address is not
 * walked), and an object met twice, or one that holds itself, is walked once. A loader passes the parts of its page data that it draws (never a raw transaction or
 * metadata), so that only addresses on the screen are named. Pure.
 */
export function collectAddresses(...parts: unknown[]): string[] {
  // A `Set` keeps the order in which its members were added.
  const found = new Set<string>();
  const walked = new Set<object>();

  function walk(value: unknown): void {
    if (typeof value === "string") {
      if (ADDRESS.test(value) && isValidClassicAddress(value)) found.add(value);
      return;
    }
    if (typeof value !== "object" || value === null || walked.has(value)) return;
    walked.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value)) walk(item);
  }

  for (const part of parts) walk(part);
  return [...found];
}
