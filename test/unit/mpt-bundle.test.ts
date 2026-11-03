import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The MPT pages are drawn in the browser too (a client-side navigation renders them there), and they never fetch: the view builder (`app/server/mpt-view.ts`, which value-imports `domain/mpt.ts`,
// `domain/mpt-params.ts`, `domain/describe/helpers.ts` and with them bignumber.js and `ripple-address-codec`) puts every href, label and figure in the page data. So the files the browser runs
// for these pages import none of the Worker's code as a value: nothing of `app/server` (the marker alphabet, an import-free leaf, aside), of the describe and parse trees, of
// `domain/mpt-id.ts` (the codec) or of `ripple-*`. The tags' builders (`meta-mpt.ts`) are among them: a page's `meta` is part of its route module. A type import is erased and costs nothing; a value
// import is the bug. (The routes import the server for their loaders; React Router drops a loader and what only it uses from the browser's build, and `pnpm check:bundle` holds the result to the
// budget.)
//
// Nor do the pages load what they do not draw: no chart of the kit but the meter (the holders' share, decorative), whose leaves are its cells and its geometry, and not the plot and its cursor,
// the ledger object frame or a transaction's sentence, each of which would be 3 or 4 KB of JavaScript on a page that does not use it. And not `domain/mpt.ts` (the words, `scaleUnits` and
// `percentText`, with bignumber.js): the Worker scales every amount and writes every sentence, so the page draws text. A page that needs it later does so on purpose, by editing this test.

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** A specifier of what belongs to the Worker alone: app/server, the describe and parse trees, the codec's `domain/mpt-id.ts`, and the `ripple-*` packages. */
const SERVER_ONLY = [/\/server\//, /\/describe(\/|$)/, /\/parse(\/|$)/, /\/mpt-id$/, /ripple-/];
const serverOnly = (from: string) => SERVER_ONLY.some((pattern) => pattern.test(from));

/** The files of the MPT pages: the page, the page for a network without MPT, the tables they share, and the flags card. */
const PAGE_FILES = ["ui/pages/MptPage.tsx", "ui/pages/NoMptPage.tsx", "ui/pages/mpt-columns.tsx", "ui/components/MptFlags.tsx"];

/** The tags' builders, which the browser runs as the routes' `meta`. They are files of app/server that import nothing of it but `./meta`. */
const META_FILES = ["server/meta-mpt.ts"];

/** What a file the browser loads may reach of the Worker's own files: the marker alphabet (`server/marker.ts`, an import-free leaf, which `parseTrail` reads markers with). */
const LEAVES = ["server/marker.ts"];

/** The files of a closure that are the Worker's code: app/server (the allowed leaves aside), the describe and parse trees, and the codec's `mpt-id.ts`. */
const workerFiles = (closure: string[], allowed: string[]) =>
  closure.filter((path) => (/^server\//.test(path) && !allowed.includes(path)) || /^domain\/(describe|parse)\//.test(path) || path === "domain/mpt-id.ts");

describe("the files of the MPT pages that run in the browser", () => {
  it.each(PAGE_FILES)("%s imports nothing of the server, describe, parse, domain/mpt-id or ripple-* as a value", (file) => {
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

  it.each(META_FILES)("%s, which the browser runs as `meta`, imports nothing of ripple-*, describe, parse or domain/mpt, and of app/server only ./meta", (file) => {
    const imports = valueImports(read(file));
    expect(imports.filter(serverOnly).filter((from) => from !== "./meta")).toEqual([]);
    expect(imports.filter((from) => /\/domain\/mpt(-params)?$/.test(from))).toEqual([]);
    expect(imports.filter((from) => from.startsWith("./") || /^\.\.\/server(\/|$)/.test(from))).toEqual(["./meta"]);
    const closure = staticClosure(appDir, file);
    expect(workerFiles(closure, [...LEAVES, file, "server/meta.ts"])).toEqual([]);
    expect(closure).not.toContain("domain/mpt.ts");
    expect(closure.flatMap((path) => valueImports(read(path))).filter((from) => /ripple-/.test(from))).toEqual([]);
  });

  it.each(PAGE_FILES)("%s loads no plot, no cursor, no ledger object frame, no sentence and no bignumber.js words, and of the chart kit at most the meter's leaves", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).not.toContain("ui/charts/Plot.tsx");
    expect(closure).not.toContain("ui/charts/Cursor.tsx");
    expect(closure).not.toContain("ui/pages/LedgerObjectFrame.tsx");
    expect(closure).not.toContain("ui/components/Sentence.tsx");
    expect(closure).not.toContain("domain/mpt.ts");
    expect(closure).not.toContain("domain/mpt-params.ts");
    expect(closure.filter((path) => path.startsWith("ui/charts/") && !/\/(Meter|cells|geometry)\.tsx?$/.test(path))).toEqual([]);
  });

  it("walks the files the MPT page draws with: the kit's tables, tiles, meter, detail list, copy button and notices, the flags card and the shared columns", () => {
    expect(staticClosure(appDir, "ui/pages/MptPage.tsx")).toEqual(
      expect.arrayContaining([
        "ui/pages/mpt-columns.tsx",
        "ui/components/MptFlags.tsx",
        "ui/charts/Meter.tsx",
        "ui/components/DataTable.tsx",
        "ui/components/DetailList.tsx",
        "ui/components/StatTile.tsx",
        "ui/components/CoverageNote.tsx",
        "ui/components/AccountLink.tsx",
        "ui/components/CopyTextButton.tsx",
        "ui/components/SectionError.tsx",
        "ui/components/Notice.tsx",
        "ui/components/Pill.tsx",
        "ui/components/WhenCell.tsx",
        "ui/components/HashLink.tsx",
        "ui/components/PairCoins.tsx",
      ]),
    );
    // The page for a network without MPT draws none of that.
    const none = staticClosure(appDir, "ui/pages/NoMptPage.tsx");
    expect(none).not.toContain("ui/pages/mpt-columns.tsx");
    expect(none).not.toContain("ui/charts/Meter.tsx");
    expect(none).not.toContain("ui/components/DataTable.tsx");
    // The tags read the facts of the view builder as types only: the closure of the tags is `./meta` and what it imports.
    expect(staticClosure(appDir, "server/meta-mpt.ts")).toEqual(expect.not.arrayContaining(["server/mpt-view.ts"]));
  });

  it("sees the Worker's code where a file does load it: the view builder reaches the words, the codec's leaf and the server", () => {
    const builder = staticClosure(appDir, "server/mpt-view.ts");
    expect(builder).toEqual(expect.arrayContaining(["domain/mpt.ts", "domain/mpt-id.ts", "server/mpt-view.ts", "server/coverage.ts"]));
    expect(workerFiles(builder, LEAVES)).toEqual(expect.arrayContaining(["domain/mpt-id.ts", "server/mpt-view.ts", "server/coverage.ts"]));
  });

  it("is checked by filters that see each of those, and not a file named like one", () => {
    const source = [
      `import { mptPage } from "../../server/mpt-view";`,
      `import type { MptPageData } from "../../server/mpt-view";`,
      `import { describeTx } from "../../domain/describe";`,
      `import { parseTx } from "../domain/parse/index";`,
      `import { mptIssuerOf } from "../../domain/mpt-id";`,
      `import { isValidClassicAddress } from "ripple-address-codec";`,
      `import { formatAmount } from "../../domain/format";`,
      `import { type MptHead } from "../../server/mpt-view";`,
    ].join("\n");
    expect(valueImports(source).filter(serverOnly)).toEqual(["../../server/mpt-view", "../../domain/describe", "../domain/parse/index", "../../domain/mpt-id", "ripple-address-codec"]);
    expect(["../../domain/mpt-ids", "../domain/mpt-idx", "../server-like", "../../domain/parser", "./mpt-columns"].filter(serverOnly)).toEqual([]);
  });
});
