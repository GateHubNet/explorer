import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { valueImports } from "../support/value-imports";

// The chart kit is drawn in the browser too (a client-side navigation renders a page there), and it has to fit in what the network page
// loads (spec 2.1: about 7 KB gzip). So it imports no charting package, no code of the server, and from the app only what is light:
// `react`, its own files, `app/domain/format.ts` (bignumber.js is in the bundle already), `app/ui/cx.ts`, `app/ui/use-hydrated.ts` and the
// components. It has no barrel file, so a page loads only the modules it imports. A type import is erased and costs nothing; a value import
// is the bug.

const appDir = new URL("../../app/", import.meta.url);
const chartsDir = new URL("ui/charts/", appDir);

const kitFiles = readdirSync(chartsDir).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

const ALLOWED = (from: string) =>
  from === "react" ||
  from.startsWith("./") ||
  from === "../../domain/format" ||
  from === "../cx" ||
  from === "../use-hydrated" ||
  from.startsWith("../components/");

describe("the files of the chart kit", () => {
  it("are there to be checked", () => {
    expect(kitFiles).toEqual(expect.arrayContaining(["types.ts", "geometry.ts", "labels.ts", "ChartCard.tsx", "Legend.tsx", "ChartTable.tsx"]));
  });

  it.each(kitFiles)("%s imports as values only react, its own files, domain/format, cx, use-hydrated and the components", (file) => {
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
    for (const from of ["react", "./types", "./labels", "../../domain/format", "../cx", "../use-hydrated", "../components/DataTable", "../components/SectionError"]) {
      expect(ALLOWED(from), from).toBe(true);
    }
    for (const from of ["react-dom", "react-router", "../../domain/describe", "../../server/clients", "~/ui/cx", "../use-network", "../use-hydrated2", "../../domain/format.ts2"]) {
      expect(ALLOWED(from), from).toBe(false);
    }
  });
});
