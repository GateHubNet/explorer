// The analytics view's own copy of the chart kit (README, "The client bundle check": the analytics view). The account page loads the view
// (`app/ui/pages/AccountAnalytics.tsx`) with `import()`, and the view draws with the kit, as the network page does. Left to itself, Rolldown
// makes one chunk for each set of entries that load a module, so the kit's modules that both reach (the plot, the cursor, the line and column
// charts, the table, the labels, `use-hydrated`, `StatTile`) left the network route's chunk for files of their own, which both load: every
// such file costs its gzip context and its `import`/`export` lines, on the network page and in the analytics view's total (spec 5, gate 2).
//
// So what the view imports of the kit, and what those import of it in turn, resolves to the same file with the query `?analytics-kit`: another
// module, which only the view's chunk reaches, so Rolldown bundles it into that chunk. The view's first load is then the account page's files
// and that one chunk, and the network route keeps its kit in its own chunk, as before the view. The kit is `app/ui/charts/*` (all but
// `types.ts`, which holds types alone), `app/ui/use-hydrated.ts` and `app/ui/components/StatTile.tsx`. What the copies import from outside the
// kit (`DataTable`, `SectionError`, `format.ts`, React) is the one module every page shares: the account page loads it anyway.
//
// The cost: a visitor who has seen the network page downloads the kit again for the view (about 8.5 KB, gzipped), and one who has seen the view
// downloads it again for the network page. A browser that has run both holds two instances of the kit's modules. That is safe while the kit keeps
// no state of its own at module level and its React contexts (`Cursor.tsx`'s `TipSlotContext` and `HoverContext`) are provided and read inside
// the kit alone: then a copy's providers and consumers are all of that copy, and nothing outside the kit can put one copy's provider around the
// other's consumer.
//
// The plugin checks what it has made, in every client build (a deploy's too), and throws, failing the build, when it is not so: so that a
// renamed file can never quietly bring the shared chunks back.
//
//   - `kitCopyOf`, on the module graph (`buildEnd`): the view is in the build; so are `use-hydrated.ts` and `StatTile.tsx`; every module of the
//     kit that the view loads is its copy, and among them is the chart kit's directory; nothing but the view and the copies imports a copy; the
//     page that imports the view loads none of the kit; a module of the kit creates a React context; and no module outside the kit imports a module of
//     the kit that creates one.
//   - `checkKitCopyBundle`, on the bundle (`generateBundle`): the view has a chunk of its own, the copies are in it and in no other chunk, it
//     holds no module of the kit that is not a copy, and no chunk it imports, directly or through another, holds a module of the kit.
//
// `pnpm check:bundle` reads the files of the build: the analytics view loads no file beyond the account page's but its own chunk
// (`kitCopyProblems`). The Worker's build and the dev server are left as they are: the plugin is for the client build only.

import type { Plugin } from "vite";

import type { BundleReport } from "./bundle-budget.ts";
import type { BundleFile } from "./shell-chunks.ts";

/** The query of a copy: the view's copy of `app/ui/charts/Plot.tsx` is `…/app/ui/charts/Plot.tsx?analytics-kit`. */
export const KIT_COPY = "?analytics-kit";

const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");
/** A module's file: its id without the query, with `/`. */
const fileOf = (id: string) => normalize(id).split("?")[0]!;
const isCopy = (id: string) => id.endsWith(KIT_COPY);

/** The view, the kit's directory and the kit's two files outside it, below the app directory. */
function kitPaths(appDirectory: string) {
  const app = normalize(appDirectory);
  return {
    view: `${app}/ui/pages/AccountAnalytics.tsx`,
    charts: `${app}/ui/charts/`,
    files: [`${app}/ui/use-hydrated.ts`, `${app}/ui/components/StatTile.tsx`],
  };
}

/** A module of the kit, as it is or as the view's copy: a module of `app/ui/charts/` but `types.ts`, `app/ui/use-hydrated.ts` or `app/ui/components/StatTile.tsx`. */
export function isKitModule(id: string, appDirectory: string): boolean {
  const { charts, files } = kitPaths(appDirectory);
  const file = fileOf(id);
  if (files.includes(file)) return true;
  if (!file.startsWith(charts)) return false;
  const name = file.slice(charts.length);
  return /^[^/]+\.tsx?$/.test(name) && name !== "types.ts" && !/\.test\.tsx?$/.test(name);
}

/** The view itself, or one of its copies: the importers whose imports of the kit resolve to copies. */
const copiesFor = (importer: string, appDirectory: string) => isCopy(importer) || (fileOf(importer) === kitPaths(appDirectory).view && !importer.includes("?"));

/**
 * What an import of `importer` that resolved to `resolved` resolves to with the plugin: the copy of a module of the kit when the importer is the
 * view or a copy, and otherwise `resolved` itself (a module with a query of its own, `?raw` or `?url`, is not copied).
 */
export function kitCopyId(resolved: string, importer: string, appDirectory: string): string {
  if (!copiesFor(importer, appDirectory) || resolved.includes("?") || !isKitModule(resolved, appDirectory)) return resolved;
  return resolved + KIT_COPY;
}

/** What the checks read of the module graph: every module, with its static and dynamic imports and its code (Rolldown's `ModuleInfo`). */
export interface KitGraph {
  ids: Iterable<string>;
  info(id: string): { importedIds: readonly string[]; dynamicallyImportedIds: readonly string[]; code: string | null } | null;
}

export interface KitCopy {
  /** The view's module. */
  view: string;
  /** The copies the view loads. */
  copies: Set<string>;
}

const fail = (message: string): never => {
  throw new Error(`analytics kit copy: ${message}`);
};

/** The static closure of `start`, with the module that first imported each (`""` for `start`). */
function closureOf(graph: KitGraph, start: string): Map<string, string> {
  const importerOf = new Map<string, string>([[start, ""]]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const next of graph.info(id)?.importedIds ?? []) {
      if (importerOf.has(next)) continue;
      importerOf.set(next, id);
      stack.push(next);
    }
  }
  return importerOf;
}

const WHERE = "scripts/analytics-kit-copy.ts names the view and the kit; update it, or the kit's chunks are shared again";

/**
 * The view and its copies, read from the module graph at the end of the client build. Throws unless the copy is as it must be (see above):
 * the view or a file of the kit that cannot be found (renamed or moved) fails the build, as does a module of the kit that the view loads as it
 * is, a page that imports the view and loads the kit too, a kit in which no module creates a React context (its code could not be read), and a
 * module outside the kit that imports one that creates a React context.
 */
export function kitCopyOf(graph: KitGraph, appDirectory: string): KitCopy {
  const { view, charts, files } = kitPaths(appDirectory);
  const ids = [...graph.ids];
  const views = ids.filter((id) => fileOf(id) === view && !id.includes("?"));
  if (views.length !== 1) fail(`expected the analytics view ${view} in the client build once, found it ${views.length} times: was it renamed or moved? ${WHERE}`);
  for (const file of files) {
    if (!ids.some((id) => fileOf(id) === file)) fail(`${file}, a module of the kit, is not in the client build: was it renamed or moved? ${WHERE}`);
  }

  // Every module of the kit that the view loads is its copy: one that is not was imported by a module outside the kit (whose imports are not
  // copied), or the plugin did not run, and the view would load it as the network page does, in a chunk the two share.
  const copies = new Set<string>();
  for (const [id, importer] of closureOf(graph, views[0]!)) {
    if (!isKitModule(id, appDirectory)) continue;
    if (!isCopy(id)) fail(`the analytics view loads ${fileOf(id)} itself, imported by ${importer}, and not its own copy: a module the network page shares with it`);
    copies.add(id);
  }
  if (![...copies].some((id) => fileOf(id).startsWith(charts))) fail(`the analytics view loads no copy of the chart kit (${charts}): was the kit's directory renamed or moved? ${WHERE}`);

  for (const id of ids) {
    if (isCopy(id) || id === views[0]) continue;
    const copy = (graph.info(id)?.importedIds ?? []).find(isCopy);
    if (copy !== undefined) fail(`${id} imports the analytics view's copy ${copy}: the copies are the view's alone`);
  }

  // The page the view is drawn in loads none of the kit: on that page every module of the kit, and so every provider and consumer of its
  // contexts, is the view's copy.
  for (const page of ids.filter((id) => (graph.info(id)?.dynamicallyImportedIds ?? []).includes(views[0]!))) {
    for (const [id] of closureOf(graph, page)) {
      if (isKitModule(id, appDirectory)) fail(`the page that imports the analytics view, ${page}, loads ${fileOf(id)} too: the view's copy would be a second one on the same page`);
    }
  }

  // The kit's React contexts are provided and read inside the kit (a copy's by that copy): no module outside it imports a module of the kit
  // that creates one, so none can put a provider of one copy around a consumer of the other.
  const contexts = new Set(ids.filter((id) => isKitModule(id, appDirectory) && /\bcreateContext\b/.test(graph.info(id)?.code ?? "")).map(fileOf));
  // The kit has contexts (`Cursor.tsx`'s): finding none is code that could not be read (a `ModuleInfo` whose `code` is `null`), and the rule would pass
  // whatever imports what.
  if (contexts.size === 0) fail(`no module of the kit creates a React context (Cursor.tsx's TipSlotContext and HoverContext): could its code not be read, or did the contexts move? ${WHERE}`);
  for (const id of ids) {
    if (isKitModule(id, appDirectory)) continue;
    const used = (graph.info(id)?.importedIds ?? []).find((next) => contexts.has(fileOf(next)));
    if (used !== undefined) fail(`${id} imports ${fileOf(used)}, which creates a React context of the kit: the kit's contexts are provided and read inside the kit, so that each copy keeps its own`);
  }

  return { view: views[0]!, copies };
}

/**
 * Throws unless the bundle is cut as the copy means it to be: one chunk of the view (its facade), which holds the copies, and no other chunk
 * holds one; it holds no module of the kit that is not a copy; and no chunk it imports, directly or through another, holds a module of the kit
 * (that would be the chunk the network page shares the kit in).
 */
export function checkKitCopyBundle(bundle: Readonly<Record<string, BundleFile>>, kit: KitCopy, appDirectory: string): void {
  const chunks = Object.values(bundle).flatMap((file) => (file.type === "chunk" ? [file] : []));
  const own = chunks.filter((chunk) => chunk.facadeModuleId === kit.view);
  if (own.length !== 1) fail(`expected one chunk of the analytics view (${kit.view}), found ${own.length}`);
  const chunk = own[0]!;

  for (const other of chunks) {
    const copy = other === chunk ? undefined : other.moduleIds.find(isCopy);
    if (copy !== undefined) fail(`the copies of the kit must be in the analytics chunk ${chunk.fileName} alone; ${other.fileName} holds ${copy}`);
  }
  const original = chunk.moduleIds.find((id) => isKitModule(id, appDirectory) && !isCopy(id));
  if (original !== undefined) fail(`the analytics chunk ${chunk.fileName} holds ${original}, not its copy`);

  const byFile = new Map(chunks.map((file) => [file.fileName, file]));
  const seen = new Set<string>();
  const stack = [...chunk.imports];
  while (stack.length > 0) {
    const fileName = stack.pop()!;
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    const imported = byFile.get(fileName);
    if (!imported) continue;
    const kitModule = imported.moduleIds.find((id) => isKitModule(id, appDirectory));
    if (kitModule !== undefined) fail(`the analytics chunk ${chunk.fileName} imports ${fileName}, which holds ${kitModule}: a chunk of the kit that it shares with another route`);
    stack.push(...imported.imports);
  }
}

/**
 * What is wrong in the files of a build (`pnpm check:bundle`, which has no module graph): the analytics view loads no file beyond the account
 * page's files but its own chunk. Another one is a chunk it shares with another route, as the kit was before the view had its copy. Empty
 * when all is well, and when the report has no view or no account page (the bundle check says why).
 */
export function kitCopyProblems(report: Pick<BundleReport, "pages" | "views">): string[] {
  const problems: string[] = [];
  for (const view of report.views) {
    const page = report.pages.find((candidate) => candidate.route === view.route);
    if (!page) continue;
    for (const file of view.files) {
      if (file === view.chunk || page.files.includes(file)) continue;
      problems.push(
        `the analytics view loads assets/${file} beyond the account page's files and its own chunk assets/${view.chunk}: a chunk it shares with another route, which the view's own copy of the kit (scripts/analytics-kit-copy.ts) leaves out`,
      );
    }
  }
  return problems;
}

/** The plugin, for the client build only (the Worker's build and the dev server are left as they are). */
export function analyticsKitCopy({ appDirectory }: { appDirectory: string }): Plugin {
  let kit: KitCopy | undefined;
  return {
    name: "x-explorer:analytics-kit-copy",
    // Before Vite's own resolvers, which it asks for the file (`skipSelf`), and then names the copy.
    enforce: "pre",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    async resolveId(source, importer, options) {
      if (!importer || !copiesFor(importer, appDirectory)) return null;
      const resolved = await this.resolve(source, importer.split("?")[0], { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const id = kitCopyId(resolved.id, importer, appDirectory);
      return id === resolved.id ? resolved : { ...resolved, id };
    },
    buildEnd(error) {
      if (error || this.environment.name !== "client") return;
      kit = kitCopyOf({ ids: this.getModuleIds(), info: (id) => this.getModuleInfo(id) }, appDirectory);
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      if (!kit) fail("the bundle was made before the module graph was read (buildEnd)");
      checkKitCopyBundle(bundle, kit!, appDirectory);
    },
  };
}
