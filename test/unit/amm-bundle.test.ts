import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The AMM pages are drawn in the browser too (a client-side navigation renders them there), and they never fetch: the view builders
// (`app/server/amm-view.ts`, which value-imports `app/domain/asset.ts` and `market-pair.ts`, and with them the issuer checksums of
// `ripple-address-codec`) put every href, label and figure in the page data. So the files the browser runs for these pages import none of the
// Worker's code as a value (AMM plan, "Browser bundle"): nothing of `app/server`, of the describe and parse trees, of `domain/asset.ts` or of
// `ripple-*`. `amm-params.ts` is among them: every page that shows a pool link loads it. So are the two tags' builders, `meta-amm-list.ts` and
// `meta-amm-pool.ts`: a page's `meta` is part of its route module. A type import is erased and costs nothing; a value import is the bug. (The
// routes import the server for their loaders; React Router drops a loader and what only it uses from the browser's build, and
// `pnpm check:bundle` holds the result to the budget.)

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** A specifier of what belongs to the Worker alone: app/server, the describe and parse trees, `domain/asset.ts` and the `ripple-*` packages. */
const SERVER_ONLY = [/\/server\//, /\/describe(\/|$)/, /\/parse(\/|$)/, /\/asset$/, /ripple-/];
const serverOnly = (from: string) => SERVER_ONLY.some((pattern) => pattern.test(from));

/** The files of the pages and the links to them. */
const PAGE_FILES = ["ui/pages/AmmListPage.tsx", "ui/pages/AmmPoolPage.tsx", "ui/pages/NoAmmPage.tsx", "domain/amm-params.ts"];

/** The tags' builders, which the browser runs as the routes' `meta`. They are files of app/server that import nothing of it but `./meta`. */
const META_FILES = ["server/meta-amm-list.ts", "server/meta-amm-pool.ts"];

/**
 * What a file the browser loads may reach of the Worker's own files: the marker alphabet (`server/marker.ts`, an import-free leaf, which E3's
 * `parseTrail` reads markers with), and for a tags' builder its own module and `meta.ts`, which every page's tags are made with.
 */
const LEAVES = ["server/marker.ts"];

/** The files of a closure that are the Worker's code: app/server (the allowed leaves aside), the describe and parse trees, asset.ts and market-pair.ts. */
const workerFiles = (closure: string[], allowed: string[]) =>
  closure.filter(
    (path) =>
      (/^server\//.test(path) && !allowed.includes(path)) ||
      /^domain\/(describe|parse)\//.test(path) ||
      path === "domain/asset.ts" ||
      path === "domain/market-pair.ts",
  );

describe("the files of the AMM pages that run in the browser", () => {
  it.each(PAGE_FILES)("%s imports nothing of the server, describe, parse, domain/asset or ripple-* as a value", (file) => {
    expect(valueImports(read(file)).filter(serverOnly)).toEqual([]);
  });

  it.each(PAGE_FILES)("%s loads none of those through the files it imports either: of app/server it reaches only the marker alphabet, a leaf", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).toContain(file);
    expect(workerFiles(closure, LEAVES)).toEqual([]);
    // No file it reaches loads a ripple-* package either.
    expect(closure.flatMap((path) => valueImports(read(path))).filter((from) => /ripple-/.test(from))).toEqual([]);
    expect(valueImports(read("server/marker.ts"))).toEqual([]);
  });

  it.each(META_FILES)("%s, which the browser runs as `meta`, imports nothing of ripple-*, describe, parse or domain/asset, and of app/server only ./meta", (file) => {
    const imports = valueImports(read(file));
    expect(imports.filter((from) => /ripple-|\/describe(\/|$)|\/parse(\/|$)|\/asset$/.test(from))).toEqual([]);
    expect(imports.filter((from) => from.startsWith("./") || /^\.\.\/server(\/|$)/.test(from))).toEqual(["./meta"]);
    const closure = staticClosure(appDir, file);
    expect(workerFiles(closure, [...LEAVES, file, "server/meta.ts"])).toEqual([]);
    expect(closure.flatMap((path) => valueImports(read(path))).filter((from) => /ripple-/.test(from))).toEqual([]);
  });

  it("walks the files the pool page draws with: the kit's charts, the table and the pager", () => {
    expect(staticClosure(appDir, "ui/pages/AmmPoolPage.tsx")).toEqual(
      expect.arrayContaining(["ui/charts/LineChart.tsx", "ui/charts/ColumnChart.tsx", "ui/charts/SmallMultiples.tsx", "ui/components/DataTable.tsx", "ui/components/Pager.tsx"]),
    );
    // And it sees the Worker's code where a file does load it: the view builder reaches asset.ts and the server.
    const builder = staticClosure(appDir, "server/amm-view.ts");
    expect(workerFiles(builder, LEAVES)).toEqual(expect.arrayContaining(["domain/asset.ts", "domain/market-pair.ts", "server/amm-view.ts", "server/exact.ts"]));
  });

  it("is checked by filters that see each of those, and not a file named like one", () => {
    const source = [
      `import { ammPoolPage } from "../../server/amm-view";`,
      `import type { AmmPoolPageData } from "../../server/amm-view";`,
      `import { describeTx } from "../../domain/describe";`,
      `import { parseTx } from "../domain/parse/index";`,
      `import { parseAssetText } from "../../domain/asset";`,
      `import { parseAssetText as read } from "./asset";`,
      `import { isValidClassicAddress } from "ripple-address-codec";`,
      `import { formatPrice } from "../../domain/format";`,
      `import { ammPoolHref } from "../../domain/amm-params";`,
      `import { type Asset } from "../../domain/asset";`,
    ].join("\n");
    expect(valueImports(source).filter(serverOnly)).toEqual([
      "../../server/amm-view",
      "../../domain/describe",
      "../domain/parse/index",
      "../../domain/asset",
      "./asset",
      "ripple-address-codec",
    ]);
    expect(["../../domain/assets", "../domain/asset-like", "../server-like", "../../domain/parser", "../../domain/describes"].filter(serverOnly)).toEqual([]);
  });
});
