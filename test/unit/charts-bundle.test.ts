import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The chart kit is drawn in the browser too (a client-side navigation renders a page there), and it has to fit in what the network page
// loads (spec 2.1: about 7 KB gzip). So it imports no charting package, no code of the server, and from the app only what is light:
// `react`, its own files, `app/domain/format.ts` (bignumber.js is in the bundle already), `app/ui/cx.ts` and the components. It has no
// barrel file, so a page loads only the modules it imports. A type import is erased and costs nothing; a value import is the bug.

const appDir = new URL("../../app/", import.meta.url);
const chartsDir = new URL("ui/charts/", appDir);

/**
 * The module specifiers a source loads as values: `import x from`, `import "x"`, `export … from "x"` and `import("x")`. What
 * `import type` and `import { type A }` bring is erased by the compiler, and so is `export type … from`.
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
  // A re-export names a module too; only `export { … } from` and `export * from` do (an `export const` has no `from`).
  for (const [, clause, from] of source.matchAll(/^export\s+((?:type\s+)?\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+["']([^"']+)["']/gms)) keep(clause!, from!);
  for (const [, from] of source.matchAll(/^import\s+["']([^"']+)["']/gm)) found.push(from!);
  for (const [, from] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(from!);
  return found;
}

const kitFiles = readdirSync(chartsDir).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

const ALLOWED = (from: string) =>
  from === "react" || from.startsWith("./") || from === "../../domain/format" || from === "../cx" || from.startsWith("../components/");

describe("the files of the chart kit", () => {
  it("are there to be checked", () => {
    expect(kitFiles).toEqual(expect.arrayContaining(["types.ts", "geometry.ts", "labels.ts", "ChartCard.tsx", "Legend.tsx", "ChartTable.tsx"]));
  });

  it.each(kitFiles)("%s imports as values only react, its own files, domain/format, cx and the components", (file) => {
    const imports = valueImports(readFileSync(new URL(file, chartsDir), "utf8"));
    expect(imports.filter((from) => !ALLOWED(from))).toEqual([]);
  });

  it.each(kitFiles)("%s imports nothing of the server as a value", (file) => {
    expect(valueImports(readFileSync(new URL(file, chartsDir), "utf8")).filter((from) => /(^|\/)server(\/|$)/.test(from))).toEqual([]);
  });

  it("have no barrel: a page loads the modules it imports and no others", () => {
    expect(existsSync(new URL("index.ts", chartsDir))).toBe(false);
    expect(existsSync(new URL("index.tsx", chartsDir))).toBe(false);
  });
});

// The cursor (Cursor.tsx: the pointer, the tooltip and the keys) is loaded when a pointer or the keyboard first reaches a plot (spec 2.1), so it is in
// a chunk of its own and not in the page's first JavaScript. What it shares with the files that load with the page is in cursor-state.tsx.
describe("the cursor is loaded when it is needed", () => {
  const namesCursor = (from: string) => from === "./Cursor";

  it("is imported as a value by no file of the kit but CursorSlot, and by that one with import() alone", () => {
    const naming = kitFiles.filter((file) => file !== "Cursor.tsx" && valueImports(readFileSync(new URL(file, chartsDir), "utf8")).some(namesCursor));
    expect(naming).toEqual(["CursorSlot.tsx"]);
    const slot = readFileSync(new URL("CursorSlot.tsx", chartsDir), "utf8");
    expect(slot).toMatch(/\bimport\(\s*["']\.\/Cursor["']\s*\)/);
    // Not `import … from "./Cursor"` or `export … from "./Cursor"`, which would take it into the page's first JavaScript: a type is erased.
    expect(slot.match(/^(?:import|export)\s+(?!type\b)[^;]*?\s+from\s+["']\.\/Cursor["']/gms) ?? []).toEqual([]);
  });

  it("keeps what a plot needs of its cursor, and what the cursors share, in two files that import react alone and so never the cursor", () => {
    for (const file of ["cursor-slot-state.tsx", "cursor-state.tsx"]) expect(valueImports(readFileSync(new URL(file, chartsDir), "utf8")), file).toEqual(["react"]);
  });

  it("has the cursor's geometry in a file of its own, which geometry re-exports, so that the cursor does not load the rest of geometry", () => {
    expect(valueImports(readFileSync(new URL("placement.ts", chartsDir), "utf8"))).toEqual([]);
    const cursor = valueImports(readFileSync(new URL("Cursor.tsx", chartsDir), "utf8"));
    expect(cursor).toContain("./placement");
    expect(cursor).not.toContain("./geometry");
  });

  it("has a layer to stand in for it, which the plot draws", () => {
    expect(kitFiles).toEqual(expect.arrayContaining(["Cursor.tsx", "CursorSlot.tsx", "cursor-slot-state.tsx", "cursor-state.tsx", "placement.ts"]));
    const plot = readFileSync(new URL("Plot.tsx", chartsDir), "utf8");
    expect(valueImports(plot)).toContain("./CursorSlot");
    expect(valueImports(plot)).not.toContain("./Cursor");
  });
});

describe("the dependencies", () => {
  it("hold no charting library", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as Record<string, Record<string, string> | undefined>;
    const names = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) => Object.keys(manifest[field] ?? {}));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => /chart|d3|recharts|visx|uplot/.test(name))).toEqual([]);
  });
});

describe("the scanner of this test", () => {
  it("sees a value import, a re-export, a side-effect import and a dynamic import, and not the erased ones", () => {
    const source = [
      `import { encode } from "../../server/qr";`,
      `import type { X } from "../../server/y";`,
      `import { type A, type B } from "../z";`,
      `import BigNumber from "bignumber.js";`,
      `import "./charts.css";`,
      `export { thing } from "d3-scale";`,
      `export type { Slot } from "./types";`,
      `export * from "../../server/all";`,
      `const Cursor = () => import("./Cursor");`,
      `import {`,
      `  type C,`,
      `  d,`,
      `} from "../multi";`,
    ].join("\n");
    expect(valueImports(source)).toEqual(["../../server/qr", "bignumber.js", "../multi", "d3-scale", "../../server/all", "./charts.css", "./Cursor"]);
    expect(valueImports(source).filter((from) => !ALLOWED(from))).toEqual(["../../server/qr", "bignumber.js", "../multi", "d3-scale", "../../server/all"]);
    expect(valueImports(`export const x = 1;\nexport function f() {}\nconst from = "y";`)).toEqual([]);
  });

  it("allows what the kit may import", () => {
    for (const from of ["react", "./types", "./labels", "../../domain/format", "../cx", "../components/DataTable", "../components/SectionError"]) expect(ALLOWED(from), from).toBe(true);
    for (const from of ["react-dom", "react-router", "../../domain/describe", "../../server/clients", "~/ui/cx", "../use-network", "../../domain/format.ts2"]) expect(ALLOWED(from), from).toBe(false);
  });
});
