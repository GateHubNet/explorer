// What the bundle tests share: the module specifiers a source loads as values (`valueImports`), and the files a source loads with it, followed from
// file to file (`staticClosure`). A page's files are drawn in the browser too (a client-side navigation renders it there), so each `*-bundle.test.ts`
// lists the files a page is made of and fails one that value-imports what belongs to the Worker alone. A type import is erased by the compiler and
// costs nothing; a value import is the bug. Plain text and the files of the tree: no runtime but Node's file reads, so the `unit` project (Node) runs
// it. It reads files only with `readFileSync` of a URL, which `tsconfig.cloudflare.json` declares too (test/support/node-modules.d.ts).

import { readFileSync } from "node:fs";

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

/**
 * The files of the tree at `root` (a directory's URL, ending in `/`: `new URL("../../app/", import.meta.url)`) that `file`, a path below it
 * (`ui/pages/MarketsPage.tsx`), loads with it: the closure of its static, relative value imports, followed from file to file (each once), as paths
 * below `root`, sorted, `file` among them. What is not followed: an `import()` (loaded when needed), a package (no file of the tree) and a stylesheet
 * (no module). A relative import names the file itself, or the file with `.ts` or `.tsx`, or a directory's `index.ts` or `index.tsx`; one that names no
 * file of the tree throws, so that a walk never ends early without saying so.
 */
export function staticClosure(root: URL, file: string): string[] {
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");

  /** The file below `root` that `specifier`, a relative import of `from`, names. */
  function resolve(from: string, specifier: string): string {
    const href = new URL(specifier, new URL(from, root)).href;
    if (!href.startsWith(root.href)) throw new Error(`${from} imports ${specifier}, which is outside ${root.href}`);
    const target = href.slice(root.href.length);
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
      if (!/\.tsx?$/.test(candidate)) continue;
      try {
        read(candidate);
        return candidate;
      } catch {
        // Not a file of the tree: the next form.
      }
    }
    throw new Error(`${from} imports ${specifier}, which is no file of ${root.href}`);
  }

  const seen = new Set<string>();
  const stack = [file];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const source = read(current).replace(/\bimport\(\s*["'][^"']+["']\s*\)/g, "");
    for (const from of valueImports(source).filter((specifier) => specifier.startsWith(".") && !specifier.endsWith(".css"))) stack.push(resolve(current, from));
  }
  return [...seen].sort();
}
