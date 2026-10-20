import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

import { valueImports } from "../support/value-imports";

// A page's `meta` is part of its route module, so the browser loads the tags' builders with the page. A module that every route imports is
// in a chunk that every page loads (the bundler makes one chunk for each set of pages that load a module), so `app/server/meta.ts`, which
// every route imports for `metaContext`, holds only what every page's tags are made with: the context, the absolute URLs and `sharing`. Each
// page's builder is in a module of its own, `app/server/meta-<page>.ts`, which that page's route alone imports, so that a page loads its own
// builder and not the others' (in one module, the six builders and what they import were 1.1 to 1.6 KB gzipped of every page's figure, and
// each new page's builder added to all of them). A new page's builder goes in a new `meta-<page>.ts`. (`pnpm check:bundle` counts the result.)

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

/** The source files below `dir` (not the tests), with their paths from the root. */
function sources(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** The files a source value-imports, as paths from the root without the extension (relative specifiers only). */
function importedFiles(file: string): string[] {
  return valueImports(read(file))
    .filter((from) => from.startsWith("."))
    .map((from) => posix.join(posix.dirname(file), from).replace(/\.(ts|tsx)$/, ""));
}

const BUILDER = /^export\s+(?:function\s+\w+Meta\s*\(|const\s+\w+Meta\s*=)/m;
const builders = sources("app/server").filter((file) => /^app\/server\/meta-[a-z-]+\.ts$/.test(file));
const appFiles = sources("app");

describe("the tags' builders", () => {
  it("are there to be checked", () => {
    expect(builders).toEqual(expect.arrayContaining(["app/server/meta-home.ts", "app/server/meta-network.ts", "app/server/meta-markets.ts", "app/server/meta-transaction.ts"]));
  });

  it("are not in meta.ts, which every route imports", () => {
    expect(read("app/server/meta.ts")).not.toMatch(BUILDER);
  });

  it.each(builders)("%s builds the tags of a page", (file) => {
    expect(read(file)).toMatch(BUILDER);
  });

  it.each(builders)("%s is imported by one route, and by nothing else the browser runs", (file) => {
    const module = file.replace(/\.ts$/, "");
    const importers = appFiles.filter((source) => importedFiles(source).includes(module));
    // The Worker's own modules may read a page's facts (card-data.ts, for the link-preview image); the browser runs app/routes, app/ui, app/domain.
    const browser = importers.filter((source) => !source.startsWith("app/server/") && !source.startsWith("app/og/"));
    expect(browser.filter((source) => source.startsWith("app/routes/"))).toHaveLength(1);
    expect(browser.filter((source) => !source.startsWith("app/routes/"))).toEqual([]);
  });

  it.each(builders)("%s imports no other page's builder", (file) => {
    expect(importedFiles(file).filter((imported) => /^app\/server\/meta-/.test(imported))).toEqual([]);
  });
});

describe("the checks of this test", () => {
  it("see a builder however it is declared, and not the helpers", () => {
    expect("export function pairMeta(page: PairPageData, ctx: MetaContext) {").toMatch(BUILDER);
    expect("export const pairMeta = (page: PairPageData) => [];").toMatch(BUILDER);
    expect("export function metaContext(net: string) {").not.toMatch(BUILDER);
    expect("export function sharing(share: Share) {").not.toMatch(BUILDER);
    expect("// homeMeta(heading, ctx) is in meta-home.ts").not.toMatch(BUILDER);
  });
});
