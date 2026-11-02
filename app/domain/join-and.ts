// A list as a sentence says it. Pure and apart from time-words.ts (which re-exports it for the files that import it from there): names.ts needs it for the
// labels' words, and a file that imported it from time-words would put the dates and the countdown's words in the chunk of every page that draws an
// account (E9, the bundle check: they came as a file of their own, 353 bytes gzipped, on each of those pages).

/** A list as a sentence does it: `a`, `a and b`, `a, b and c` (no comma before the `and`). */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}
