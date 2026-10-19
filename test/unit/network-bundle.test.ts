import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The network page is drawn in the browser too (a client-side navigation to it, and every beat of an open tab, render it there), so the files
// it is made of must be light. `app/server`, `describe/` and `parse/` (and the libraries behind them) work in the Worker alone and reach the
// browser as data: the page's parts as the view builder made them. A type import is erased and costs nothing; a value import of the server's
// code is the bug. (The route, `app/routes/net.network.tsx`, imports the server for its loader; React Router drops the loader and what only it
// uses from the browser's build, and `pnpm check:bundle` is what holds the result to its budget and to the names that must not be in it.)

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/**
 * The module specifiers a source loads as values: `import x from`, `import "x"`, `export … from "x"` and `import("x")`. What `import type`
 * and `import { type A }` bring is erased by the compiler, and so is `export type … from`.
 */
function valueImports(source: string): string[] {
  const found: string[] = [];
  const keep = (clause: string, from: string) => {
    if (/^type\s/.test(clause)) return;
    const named = /^\{([^}]*)\}$/.exec(clause.trim());
    if (named && named[1]!.split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "))) return;
    found.push(from);
  };
  for (const [, clause, from] of source.matchAll(/^import\s+([^;]*?)\s+from\s+["']([^"']+)["']/gms)) keep(clause!, from!);
  for (const [, clause, from] of source.matchAll(/^export\s+((?:type\s+)?\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+["']([^"']+)["']/gms)) keep(clause!, from!);
  for (const [, from] of source.matchAll(/^import\s+["']([^"']+)["']/gm)) found.push(from!);
  for (const [, from] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(from!);
  return found;
}

const SERVER_ONLY = (from: string) => /(^|\/)server(\/|$)/.test(from) || /(^|\/)describe(\/|$)/.test(from) || /(^|\/)parse(\/|$)/.test(from);

describe("the files of the network page that run in the browser", () => {
  it.each([
    "ui/pages/NetworkPage.tsx",
    "ui/pages/network-volume.ts",
    "domain/network-params.ts",
    "domain/window.ts",
    "domain/fnv.ts",
    "ui/live-page.ts",
    "ui/use-hold.ts",
    "ui/use-refetching.ts",
  ])("%s imports nothing of the server, describe or parse as a value", (file) => {
    expect(valueImports(read(file)).filter(SERVER_ONLY)).toEqual([]);
  });

  it("is checked by a scanner that sees a value import, a re-export and a dynamic import, and not a type", () => {
    const source = [
      `import { networkPage } from "../../server/network-view";`,
      `import type { NetworkPageData } from "../../server/network-view";`,
      `import { type A, type B } from "../../server/anchor";`,
      `import { describe } from "../../domain/describe";`,
      `export { parseTx } from "../domain/parse/tx";`,
      `export type { Part } from "../../server/network-view";`,
      `const lazy = () => import("../../server/meta");`,
      `import "../../server/side-effect";`,
    ].join("\n");
    expect(valueImports(source).filter(SERVER_ONLY)).toEqual([
      "../../server/network-view",
      "../../domain/describe",
      "../domain/parse/tx",
      "../../server/side-effect",
      "../../server/meta",
    ]);
  });

  it("does not take a file named after the words for a file of the server", () => {
    expect(["../server-like", "./describe-this", "../parser"].filter(SERVER_ONLY)).toEqual([]);
  });
});
