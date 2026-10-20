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

/**
 * The names a source exports, in every form: `export function|const|let|var|class|interface|type|enum X` (with `default`, `async`,
 * `declare`, `abstract`, a generic or a type after the name), `export default`, `export { a, b as c }` lists with or without `from`, and
 * `export * as ns from`. `export * from` gives `*`: its names are not known from here, so no allow-list holds it.
 */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  const declaration = /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;
  for (const [, name] of source.matchAll(declaration)) names.push(name!);
  if (/^export\s+default\b/m.test(source)) names.push("default");
  for (const [, list] of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of list!.split(",").map((item) => item.trim().replace(/^type\s+/, "")).filter(Boolean)) names.push(part.split(/\s+as\s+/).at(-1)!);
  }
  for (const [, alias] of source.matchAll(/^export\s+\*(?:\s+as\s+([A-Za-z_$][\w$]*))?\s+from\b/gm)) names.push(alias ?? "*");
  return names;
}

/** A page's builder: an exported `<page>Meta` (`homeMeta`, `pairMeta`), however it is exported. */
const isBuilder = (name: string) => /^[a-z][\w$]*Meta$/.test(name);
const buildsTags = (source: string) => exportedNames(source).some(isBuilder);

/**
 * What meta.ts may export: what every page's tags are made with. A name that is not here is a builder that belongs in a `meta-<page>.ts`, or
 * a helper that one page alone uses and that belongs beside its builder.
 */
const META_EXPORTS = ["MetaContext", "metaContext", "ImageKind", "absolute", "imageUrl", "Share", "sharing", "suffixOf"];

/** Every module a source names: value and type imports, re-exports, side-effect and dynamic imports. */
function namedModules(source: string): string[] {
  return [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']|^import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gms)].map(
    (match) => (match[1] ?? match[2] ?? match[3])!,
  );
}

const PAGE_META_MODULE = /(^|\/)meta-[a-z-]+(\.ts)?$/;
/**
 * A builder whose route is added by a later commit of the same series (the validators list: its page and tags come first, its route after). While it is
 * listed, no route may import it yet; the commit that adds the route takes the line out, and this test says so if it forgets.
 */
const ROUTE_TO_COME: readonly string[] = ["app/server/meta-validators.ts"];
const builders = sources("app/server").filter((file) => /^app\/server\/meta-[a-z-]+\.ts$/.test(file));
const appFiles = sources("app");

describe("the tags' builders", () => {
  it("are there to be checked", () => {
    expect(builders).toEqual(expect.arrayContaining(["app/server/meta-home.ts", "app/server/meta-network.ts", "app/server/meta-markets.ts", "app/server/meta-transaction.ts"]));
  });

  it("are not in meta.ts, which every route imports: it exports only what every page's tags are made with", () => {
    const names = exportedNames(read("app/server/meta.ts"));
    expect(names.filter((name) => !META_EXPORTS.includes(name))).toEqual([]);
    // The list is read from the file, and the file has all of it: a list that names what is gone would hide nothing, but it would be stale.
    expect([...names].sort()).toEqual([...META_EXPORTS].sort());
  });

  it("meta.ts imports and re-exports no page's builder module", () => {
    expect(namedModules(read("app/server/meta.ts")).filter((from) => PAGE_META_MODULE.test(from))).toEqual([]);
  });

  it.each(builders)("%s builds the tags of a page", (file) => {
    expect(buildsTags(read(file))).toBe(true);
  });

  it.each(builders)("%s is imported by one route, and by nothing else the browser runs", (file) => {
    const module = file.replace(/\.ts$/, "");
    const importers = appFiles.filter((source) => importedFiles(source).includes(module));
    // The Worker's own modules may read a page's facts (card-data.ts, for the link-preview image); the browser runs app/routes, app/ui, app/domain.
    const browser = importers.filter((source) => !source.startsWith("app/server/") && !source.startsWith("app/og/"));
    expect(browser.filter((source) => source.startsWith("app/routes/"))).toHaveLength(ROUTE_TO_COME.includes(file) ? 0 : 1);
    expect(browser.filter((source) => !source.startsWith("app/routes/"))).toEqual([]);
  });

  it.each(builders)("%s value-imports nothing of app/server but ./meta (types are free): no other builder, no view builder", (file) => {
    const fromServer = valueImports(read(file)).filter((from) => from.startsWith("./") || /^\.\.\/server(\/|$)/.test(from));
    expect(fromServer.filter((from) => from !== "./meta" && from !== "./meta.ts")).toEqual([]);
  });
});

describe("the checks of this test", () => {
  it("see a builder however it is exported (function, async or generic function, const with or without a type, a list, a re-export), and not the helpers", () => {
    const forms: Array<[string, string[]]> = [
      ["export function pairMeta(page: PairPageData, ctx: MetaContext) {", ["pairMeta"]],
      ["export function pairMeta<T extends PairPageData>(page: T, ctx: MetaContext) {", ["pairMeta"]],
      ["export async function pairMeta(page: PairPageData) {", ["pairMeta"]],
      ["export const pairMeta = (page: PairPageData) => [];", ["pairMeta"]],
      ["export const pairMeta: (page: PairPageData, ctx: MetaContext) => MetaDescriptor[] = (page, ctx) => [];", ["pairMeta"]],
      ["export let pairMeta: Builder = build;", ["pairMeta"]],
      ["function build() {}\nexport { build as pairMeta };", ["pairMeta"]],
      ["export { pairMeta };", ["pairMeta"]],
      ['export { pairMeta } from "./meta-pair";', ["pairMeta"]],
      ['export {\n  absolute,\n  pairMeta,\n} from "./meta-pair";', ["absolute", "pairMeta"]],
      ['export { type PairFacts, pairMeta as default } from "./meta-pair";', ["PairFacts", "default"]],
      ['export * as pages from "./meta-pages";', ["pages"]],
      ['export * from "./meta-pair";', ["*"]],
      ["export default function pairMeta() {}", ["pairMeta", "default"]],
    ];
    for (const [source, names] of forms) expect(exportedNames(source), source).toEqual(names);
    for (const source of forms.slice(0, 10).map(([source]) => source)) expect(buildsTags(source), source).toBe(true);
    // What is not a builder's name, and what no allow-list holds.
    expect(buildsTags('export { pairMeta as default } from "./meta-pair";')).toBe(false);
    expect(META_EXPORTS).not.toContain("default");
    expect(META_EXPORTS).not.toContain("*");
    for (const helper of ["export function metaContext(net: string) {", "export function sharing(share: Share) {", "export interface MetaContext {", "export type PairMeta = {};"]) {
      expect(buildsTags(helper), helper).toBe(false);
    }
    expect(exportedNames("// export function homeMeta(heading, ctx) is in meta-home.ts\n * export const x = 1;")).toEqual([]);
  });

  it("see every module meta.ts could name: imports, type imports, re-exports, side-effect and dynamic imports", () => {
    const source = [
      `import { pairMeta } from "./meta-pair";`,
      `import type { PairFacts } from "./meta-pair-types";`,
      `export { homeMeta } from "./meta-home";`,
      `export * from "./meta-ledger";`,
      `import "./meta-side";`,
      `const lazy = () => import("./meta-lazy");`,
      `import {\n  a,\n} from "../ui/brand";`,
    ].join("\n");
    expect(namedModules(source).filter((from) => PAGE_META_MODULE.test(from))).toEqual([
      "./meta-pair",
      "./meta-pair-types",
      "./meta-home",
      "./meta-ledger",
      "./meta-side",
      "./meta-lazy",
    ]);
    expect(["./meta", "../og/types", "./metadata", "./meta.ts"].filter((from) => PAGE_META_MODULE.test(from))).toEqual([]);
  });

  it("allow a builder's value import of ./meta and of what is outside app/server, and see the rest", () => {
    const source = [
      `import { absolute, sharing, type MetaContext } from "./meta";`,
      `import type { PairPageData } from "./pair-view";`,
      `import { formatPrice } from "../domain/format";`,
      `import { pairView } from "./pair-view";`,
      `import { homeMeta } from "./meta-home";`,
    ].join("\n");
    const fromServer = valueImports(source).filter((from) => from.startsWith("./") || /^\.\.\/server(\/|$)/.test(from));
    expect(fromServer.filter((from) => from !== "./meta" && from !== "./meta.ts")).toEqual(["./pair-view", "./meta-home"]);
  });
});
