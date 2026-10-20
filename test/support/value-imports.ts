// What the bundle tests of test/unit/ share: the module specifiers a source loads as values. A page's files are drawn in the browser too (a
// client-side navigation renders it there), so each `*-bundle.test.ts` lists the files a page is made of and fails one that value-imports what
// belongs to the Worker alone. A type import is erased by the compiler and costs nothing; a value import is the bug. Plain text in, plain text
// out: no runtime, so the `unit` project (Node) runs it.

/**
 * The module specifiers a source loads as values: `import x from`, `import "x"`, `export … from "x"` and `import("x")`. What `import type`
 * and `import { type A }` bring is erased by the compiler, and so is `export type … from`.
 */
export function valueImports(source: string): string[] {
  const found: string[] = [];
  const keep = (clause: string, from: string) => {
    if (/^type\s/.test(clause)) return;
    const named = /^\{([^}]*)\}$/.exec(clause.trim());
    if (named && named[1]!.split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "))) return;
    found.push(from);
  };
  for (const [, clause, from] of source.matchAll(/^import\s+([^;]*?)\s+from\s+["']([^"']+)["']/gms)) keep(clause!, from!);
  // A re-export names a module too; only `export { … } from` and `export * from` do (an `export const` has no `from`).
  for (const [, clause, from] of source.matchAll(/^export\s+((?:type\s+)?\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+["']([^"']+)["']/gms)) keep(clause!, from!);
  for (const [, from] of source.matchAll(/^import\s+["']([^"']+)["']/gm)) found.push(from!);
  for (const [, from] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(from!);
  return found;
}
