import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The image renderer (workers-og: Satori, resvg-wasm and yoga-wasm, about 1.5 MB of WebAssembly) belongs to the one route that draws images,
// and to the Worker. It must never reach the browser, and it must not weigh on the Worker's other routes: it is loaded by the route
// that needs it, on its first request. These tests read the sources; that the client build holds none of it is `pnpm check:bundle`'s
// (scripts/bundle-budget.ts: `FORBIDDEN`, and no `.wasm`, `.ttf` or `.bin` in `assets/`), so that no test reads `build/`.

const root = new URL("../../", import.meta.url);

/** The source files of the app and the Worker entry (not the tests), with their paths from the root. */
function sources(dir = "app"): string[] {
  return readdirSync(new URL(`${dir}/`, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "fonts" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const RENDERER = /workers-og|satori|resvg|yoga-wasm/;

describe("the image renderer", () => {
  it("is named by app/og/render.ts and by nothing else of the app or the Worker", () => {
    const naming = [...sources(), "workers/app.ts"].filter((file) => RENDERER.test(read(file)));
    expect(naming).toEqual(["app/og/render.ts"]);
  });

  it("is imported when it is needed, not when the Worker starts", () => {
    const source = read("app/og/render.ts");
    expect(source).toMatch(/\bimport\(\s*["']workers-og["']\s*\)/);
    expect(source).not.toMatch(/^import\s[^;]*from\s+["']workers-og["']/m);
  });

  it("is reached from the image route and from nothing the pages load", () => {
    const importers = [...sources(), "workers/app.ts"].filter((file) => /from\s+["'][^"']*\/og\/(render|fonts|card)["']/.test(read(file)));
    expect(importers.sort()).toEqual(["app/routes/og.$net.$kind.$id[.png].tsx"]);
  });

  it("is not reachable from the tags of the pages, which the browser runs too (a page's `meta` is part of its route module)", () => {
    // meta.ts and each page's builder beside it (meta-<page>.ts).
    const files = sources("app/server").filter((file) => /^app\/server\/meta(-[a-z-]+)?\.ts$/.test(file));
    expect(files).toEqual(expect.arrayContaining(["app/server/meta.ts", "app/server/meta-transaction.ts"]));
    for (const file of files) {
      const imports = [...read(file).matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)].map((match) => match[1]!);
      expect(imports.filter((from) => /\/og\/(?!types["']?$)|card-data|workers-og|\/edge-cache|\/env|\/clients|\/data-api|\/node-rpc/.test(from)), file).toEqual([]);
    }
  });
});
