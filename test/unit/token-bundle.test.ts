import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The token pages are drawn in the browser too (a client-side navigation renders them there), and they never fetch: the view builder (`app/server/token-view.ts`, which value-imports
// `app/domain/token-params.ts`, and with it `asset.ts` and the issuer checksums of `ripple-address-codec`) puts every href, label and figure in the page data. So the files the browser runs
// for these pages import none of the Worker's code as a value: nothing of `app/server`, of `domain/asset.ts`, `domain/token-params.ts`, `domain/market-pair.ts`, the describe and parse trees or
// `ripple-*`. The tags' builders (`meta-tokens.ts`) are among them: a page's `meta` is part of its route module. A type import is erased and costs nothing; a value import is the bug. (The routes
// import the server for their loaders; React Router drops a loader and what only it uses from the browser's build, and `pnpm check:bundle` holds the result to the budget.)
//
// Nor do the pages load what they do not draw: no chart of the kit but the meter (token pages spec 8: "No chart is loaded"), whose leaves are its cells and its geometry, and not the plot and its
// cursor, the ledger object frame or a transaction's sentence, each of which would be 3 or 4 KB of JavaScript on a page that does not use it.

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** A specifier of what belongs to the Worker alone: app/server, the describe and parse trees, the asset, token and market-pair modules of the domain, and the `ripple-*` packages. */
const SERVER_ONLY = [/\/server\//, /\/describe(\/|$)/, /\/parse(\/|$)/, /\/asset$/, /\/token-params$/, /\/market-pair$/, /ripple-/];
const serverOnly = (from: string) => SERVER_ONLY.some((pattern) => pattern.test(from));

/** The files of the pages the list is made of: the page, its table and the parts the token pages share. */
const PAGE_FILES = ["ui/pages/TokensPage.tsx", "ui/pages/IssuedTable.tsx", "ui/pages/token-parts.tsx"];

/** The tags' builders, which the browser runs as the routes' `meta`. They are files of app/server that import nothing of it but `./meta`. */
const META_FILES = ["server/meta-tokens.ts"];

/** What a file the browser loads may reach of the Worker's own files: the marker alphabet (`server/marker.ts`, an import-free leaf, which `parseTrail` reads markers with). */
const LEAVES = ["server/marker.ts"];

/** The files of a closure that are the Worker's code: app/server (the allowed leaves aside), the describe and parse trees, and the asset, token and market-pair modules of the domain. */
const workerFiles = (closure: string[], allowed: string[]) =>
  closure.filter(
    (path) =>
      (/^server\//.test(path) && !allowed.includes(path)) ||
      /^domain\/(describe|parse)\//.test(path) ||
      path === "domain/asset.ts" ||
      path === "domain/token-params.ts" ||
      path === "domain/market-pair.ts",
  );

describe("the files of the token pages that run in the browser", () => {
  it.each(PAGE_FILES)("%s imports nothing of the server, describe, parse, domain/asset, token-params, market-pair or ripple-* as a value", (file) => {
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

  it.each(META_FILES)("%s, which the browser runs as `meta`, imports nothing of ripple-*, describe, parse, domain/asset or token-params, and of app/server only ./meta", (file) => {
    const imports = valueImports(read(file));
    expect(imports.filter(serverOnly).filter((from) => from !== "./meta")).toEqual([]);
    expect(imports.filter((from) => from.startsWith("./") || /^\.\.\/server(\/|$)/.test(from))).toEqual(["./meta"]);
    const closure = staticClosure(appDir, file);
    expect(workerFiles(closure, [...LEAVES, file, "server/meta.ts"])).toEqual([]);
    expect(closure.flatMap((path) => valueImports(read(path))).filter((from) => /ripple-/.test(from))).toEqual([]);
  });

  it.each(PAGE_FILES)("%s loads no plot, no cursor, no ledger object frame and no sentence, and of the chart kit at most the meter's leaves", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).not.toContain("ui/charts/Plot.tsx");
    expect(closure).not.toContain("ui/charts/Cursor.tsx");
    expect(closure).not.toContain("ui/pages/LedgerObjectFrame.tsx");
    expect(closure).not.toContain("ui/components/Sentence.tsx");
    expect(closure.filter((path) => path.startsWith("ui/charts/") && !/\/(Meter|cells|geometry)\.tsx?$/.test(path))).toEqual([]);
  });

  it("walks the files the list draws with: the kit's table, pager, kind tabs, coverage note, account link and coin", () => {
    expect(staticClosure(appDir, "ui/pages/TokensPage.tsx")).toEqual(
      expect.arrayContaining([
        "ui/pages/IssuedTable.tsx",
        "ui/pages/token-parts.tsx",
        "ui/components/DataTable.tsx",
        "ui/components/Pager.tsx",
        "ui/components/SegmentedLinks.tsx",
        "ui/components/CoverageNote.tsx",
        "ui/components/AccountLink.tsx",
        "ui/components/PairCoins.tsx",
      ]),
    );
    // And it sees the Worker's code where a file does load it: the view builder reaches the token links, the asset module and the server.
    const builder = staticClosure(appDir, "server/token-view.ts");
    expect(workerFiles(builder, LEAVES)).toEqual(expect.arrayContaining(["domain/asset.ts", "domain/token-params.ts", "server/token-view.ts", "server/coverage.ts"]));
  });

  it("is checked by filters that see each of those, and not a file named like one", () => {
    const source = [
      `import { tokensPage } from "../../server/token-view";`,
      `import type { TokensPageData } from "../../server/token-view";`,
      `import { describeTx } from "../../domain/describe";`,
      `import { parseTx } from "../domain/parse/index";`,
      `import { parseAssetText } from "../../domain/asset";`,
      `import { tokenHref } from "../../domain/token-params";`,
      `import { marketHref } from "../../domain/market-pair";`,
      `import { isValidClassicAddress } from "ripple-address-codec";`,
      `import { formatPrice } from "../../domain/format";`,
      `import { type Asset } from "../../domain/asset";`,
    ].join("\n");
    expect(valueImports(source).filter(serverOnly)).toEqual([
      "../../server/token-view",
      "../../domain/describe",
      "../domain/parse/index",
      "../../domain/asset",
      "../../domain/token-params",
      "../../domain/market-pair",
      "ripple-address-codec",
    ]);
    expect(["../../domain/token-parts", "../domain/token-params-words", "../server-like", "../../domain/assets", "./token-paramsx"].filter(serverOnly)).toEqual([]);
  });
});
