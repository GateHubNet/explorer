import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The image renderer (workers-og: Satori, resvg-wasm and yoga-wasm, about 1.5 MB of WebAssembly) belongs to the one route that draws images,
// and to the Worker. It must never reach the browser, and it must not weigh on the Worker's other routes: it is loaded by the route
// that needs it, on its first request.

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
    const imports = [...read("app/server/meta.ts").matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)].map((match) => match[1]!);
    expect(imports.filter((from) => /\/og\/(?!types["']?$)|card-data|workers-og|\/edge-cache|\/env|\/clients|\/data-api|\/node-rpc/.test(from))).toEqual([]);
  });
});

// Where there is a build (`pnpm build`), what it wrote for the browser is looked at too.
describe.skipIf(!existsSync(new URL("build/client/assets/", root)))("the client build", () => {
  it("holds none of the renderer", () => {
    const assets = readdirSync(new URL("build/client/assets/", root)).filter((file) => file.endsWith(".js"));
    expect(assets.length).toBeGreaterThan(0);
    for (const file of assets) {
      const code = read(`build/client/assets/${file}`);
      expect(code, file).not.toMatch(/workers-og|satori|resvg|yoga-wasm|Geist-Regular\.bin/i);
    }
  });

  it("has no WebAssembly and no font that is not the pages' own WOFF2", () => {
    const files = readdirSync(new URL("build/client/assets/", root));
    expect(files.filter((file) => /\.(wasm|ttf|bin)$/.test(file))).toEqual([]);
  });
});
