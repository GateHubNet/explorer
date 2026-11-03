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

/** The files of the pages the token pages are made of: the list's page and its tables (the issued tokens' and, E14's, the MPT tab's), the token's page, the holders' page, and the parts they share. */
const PAGE_FILES = [
  "ui/pages/TokensPage.tsx",
  "ui/pages/IssuedTable.tsx",
  "ui/pages/MptTable.tsx",
  "ui/pages/TokenPage.tsx",
  "ui/pages/token-parts.tsx",
  "ui/pages/holder-columns.tsx",
  "ui/pages/TokenHoldersPage.tsx",
];

/** The tags' builders, which the browser runs as the routes' `meta`. They are files of app/server that import nothing of it but `./meta`. */
const META_FILES = ["server/meta-tokens.ts", "server/meta-token.ts", "server/meta-token-holders.ts"];

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

  it("walks the files the list draws with: the kit's table, pager, kind tabs, coverage note, account link, coin and pill, and both tables", () => {
    expect(staticClosure(appDir, "ui/pages/TokensPage.tsx")).toEqual(
      expect.arrayContaining([
        "ui/pages/IssuedTable.tsx",
        "ui/pages/MptTable.tsx",
        "ui/components/Pill.tsx",
        "ui/pages/token-parts.tsx",
        "ui/components/DataTable.tsx",
        "ui/components/Pager.tsx",
        "ui/components/SegmentedLinks.tsx",
        "ui/components/CoverageNote.tsx",
        "ui/components/AccountLink.tsx",
        "ui/components/PairCoins.tsx",
      ]),
    );
    // The MPT tab's table draws the words the view builder wrote (its pills carry their labels and titles): the list does not carry the MPT words or BigNumber's scaling for it (E14 spec 4).
    const list = staticClosure(appDir, "ui/pages/TokensPage.tsx");
    for (const file of ["domain/mpt.ts", "domain/mpt-params.ts", "domain/mpt-link.ts", "domain/mpt-id.ts", "server/mpt-view.ts"]) expect(list, file).not.toContain(file);
    // And it sees the Worker's code where a file does load it: the view builder reaches the token links, the asset module and the server.
    const builder = staticClosure(appDir, "server/token-view.ts");
    expect(workerFiles(builder, LEAVES)).toEqual(expect.arrayContaining(["domain/asset.ts", "domain/token-params.ts", "server/token-view.ts", "server/coverage.ts", "server/mpt-view.ts"]));
  });

  it("walks the files the token page draws with: the kit's tables, tiles, meter, links to another site and copy button, and nothing of the plot", () => {
    const closure = staticClosure(appDir, "ui/pages/TokenPage.tsx");
    expect(closure).toEqual(
      expect.arrayContaining([
        "ui/pages/token-parts.tsx",
        "ui/charts/Meter.tsx",
        "ui/components/DataTable.tsx",
        "ui/components/DetailList.tsx",
        "ui/components/StatTile.tsx",
        "ui/components/Pager.tsx",
        "ui/components/CoverageNote.tsx",
        "ui/components/AccountLink.tsx",
        "ui/components/ExternalLink.tsx",
        "ui/components/CopyTextButton.tsx",
        "ui/components/SectionError.tsx",
        "ui/components/Pill.tsx",
        "ui/components/WhenCell.tsx",
        "ui/components/HashLink.tsx",
      ]),
    );
    // The tags of the token page and the list read the facts of the view builder as types only: the closure of each is `./meta` and what it imports.
    expect(staticClosure(appDir, "server/meta-token.ts")).toEqual(expect.not.arrayContaining(["server/token-view.ts"]));
  });

  it("walks the files the holders' page draws with: the kit's table, pager, coverage note, account link and meter, and the table's columns it shares with the token page", () => {
    const closure = staticClosure(appDir, "ui/pages/TokenHoldersPage.tsx");
    expect(closure).toEqual(
      expect.arrayContaining([
        "ui/pages/holder-columns.tsx",
        "ui/charts/Meter.tsx",
        "ui/components/DataTable.tsx",
        "ui/components/Pager.tsx",
        "ui/components/CoverageNote.tsx",
        "ui/components/AccountLink.tsx",
        "ui/components/SectionError.tsx",
      ]),
    );
    // It draws no card of the token page: not its markets, its toml or its settings, and not the list's table or the small parts only those draw.
    expect(closure).not.toContain("ui/pages/TokenPage.tsx");
    expect(closure).not.toContain("ui/pages/token-parts.tsx");
    expect(closure).not.toContain("ui/pages/IssuedTable.tsx");
    expect(staticClosure(appDir, "ui/pages/TokenPage.tsx")).toContain("ui/pages/holder-columns.tsx");
    // The list draws neither the meter nor a holder: it does not carry the columns.
    expect(staticClosure(appDir, "ui/pages/TokensPage.tsx")).not.toContain("ui/pages/holder-columns.tsx");
    expect(staticClosure(appDir, "server/meta-token-holders.ts")).toEqual(expect.not.arrayContaining(["server/token-view.ts"]));
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
