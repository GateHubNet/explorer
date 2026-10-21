// How the client build is cut into files (`pnpm check:bundle` counts each file a page loads, gzipped on its own: README, "The client bundle
// check"). Left to itself, Rolldown makes one chunk for each set of entries that load a module, so the code every page loads came in about nine
// files (React's, the router's, `format.ts` with `bignumber.js`, the header, the error screen, the search box, …), and each file costs its own
// gzip context and the `import` and `export` lines that join it to the others. One group, `shell`, takes that code in instead, in one file:
//
//   - the static closure of the client entry and the root route: the packages (`node_modules`), the bundler's virtual modules (`\0` ids) and
//     the repository's own modules (the root route, the layout's header and footer, the error screen, `format.ts`, …);
//   - and what the routes of all the pages of the budget (`PAGES` in bundle-budget.ts) reach statically beyond that closure, the route modules
//     excepted (`DataTable` and what it imports, which every one of those pages draws).
//
// Every page loads the closure anyway (React Router's bootstrap imports the root route, and then the entry), and every page of the budget the
// rest, so none of them loads anything more for it; a page outside the budget (the search page, the not-found page, …) loads the second part
// too. The file costs cache reuse: it holds the packages and the app's shell together, so a deploy that changes any of the app's modules in it
// changes the whole file. Until ruling R18 the packages were a `vendor` file of their own, which changed only with a dependency, and the second
// part was left to Rolldown: R17 kept both as levers for a page over the budget, and at the merge of E4 the account page's analytics view was
// over it (README, "The client bundle check": "One shell file").
//
// The entry's own module (`entry.client`, which calls `hydrateRoot`) is not in the shell: it stays the entry's chunk, which no other file
// imports, so that hydration starts when the bootstrap imports the entry, after the route modules are in, and not while they are being
// imported (were it in a chunk the routes import, it would run then). What only some pages load is left to Rolldown's own splitting.
//
// The plugin checks what it has made, in every client build (a deploy's too): the client entry, the root route and the route of each page of
// the budget are in the module graph (`shellModules`); the shell's modules are in one chunk, named `shell`; and the entry's chunk holds the
// entry module alone, which no other chunk holds or imports (`checkShellBundle`). Each throws, and the build fails. `pnpm check:bundle` reads
// the same in the route manifest of `build/client` (`shellManifestProblems`).

import type { Plugin, Rolldown } from "vite";

import { PAGES } from "./bundle-budget.ts";
import { closureOf, fileOf, normalize } from "./module-graph.ts";

/** What the plugin needs of the module graph: every module, and each one's static imports and whether it is an entry. */
export interface ModuleGraph {
  ids: Iterable<string>;
  info(id: string): { importedIds: readonly string[]; isEntry: boolean } | null;
}

export interface ShellModules {
  /** The client entry module (`entry.client`), which is not in the shell. */
  entry: string;
  /** What the shell chunk holds: the closure, the client entry module excepted, and `gated`. */
  shell: Set<string>;
  /** Of `shell`, what the routes of all the pages of the budget reach beyond the closure. */
  gated: Set<string>;
}

/** The routes of the pages the budget is kept for: what all of them load is in the shell. */
export const GATED_ROUTES: readonly string[] = PAGES.map((page) => page.route);

/** React Router's client entry: the app's own `app/entry.client.tsx`, or the default one of `@react-router/dev`. */
const CLIENT_ENTRY = /[\\/]entry\.client\.[cm]?[jt]sx?$/;

/**
 * The query of a route's module in React Router's client build. A route's split chunks (`?route-chunk=clientLoader`) are entries of the build
 * too, of the same file: what a page loads first is the module, which the route manifest names (`module` and its `imports`).
 */
const CLIENT_ROUTE = "?__react-router-build-client-route";

/** The module of the route `route` (`routes/net._index`, `root`) as React Router's client build names it: `app/<route>.tsx` with the build's query. */
function isRouteModule(id: string, appDirectory: string, route: string): boolean {
  const path = fileOf(id);
  const stem = `${appDirectory}/${route}.`;
  return path.startsWith(stem) && /^[cm]?[jt]sx?$/.test(path.slice(stem.length));
}

/**
 * The modules of the shell: the static closure of the client entry and of the root route (dynamic imports are not followed: they are loaded
 * when needed), and what the routes of `routes` (the pages of the budget) all reach statically beyond it, the route modules excepted. The
 * entry module itself is left out (see above). Throws when the graph has no client entry, no root route, or not the route of one of `routes`,
 * so that a change of React Router's names, or a page of the budget renamed, fails the build instead of putting the code every page loads
 * back into files of its own.
 */
export function shellModules(graph: ModuleGraph, appDirectory: string, routes: readonly string[] = GATED_ROUTES): ShellModules {
  const app = normalize(appDirectory);
  const ids = [...graph.ids];
  const entries = ids.filter((id) => graph.info(id)?.isEntry && CLIENT_ENTRY.test(fileOf(id)));
  const roots = ids.filter((id) => graph.info(id)?.isEntry && isRouteModule(id, app, "root"));
  if (entries.length !== 1) throw new Error(`shell chunks: expected one client entry (entry.client) among the entries, found ${entries.length}`);
  if (roots.length !== 1) throw new Error(`shell chunks: expected one root route (${app}/root.tsx) among the entries, found ${roots.length}`);
  const entry = entries[0]!;
  const pages = routes.map((route) => {
    const found = ids.filter((id) => graph.info(id)?.isEntry && id.endsWith(CLIENT_ROUTE) && isRouteModule(id, app, route));
    if (found.length !== 1) {
      throw new Error(`shell chunks: expected one module of the route ${route} (a page of PAGES in scripts/bundle-budget.ts) among the entries, found ${found.length}`);
    }
    return found[0]!;
  });

  const shell = new Set([...closureOf(graph, entry).keys(), ...closureOf(graph, roots[0]!).keys()]);
  shell.delete(entry);

  // What every page of the budget loads beyond the closure: in the shell, it is one file fewer on each of those pages. A route module stays
  // its route's chunk (`app/routes/`: React Router imports it by its URL).
  const gated = new Set<string>();
  const closures = pages.map((page) => closureOf(graph, page));
  for (const id of closures[0]?.keys() ?? []) {
    if (shell.has(id) || id === entry || graph.info(id)?.isEntry || fileOf(id).startsWith(`${app}/routes/`)) continue;
    if (closures.every((closure) => closure.has(id))) gated.add(id);
  }
  for (const id of gated) shell.add(id);
  return { entry, shell, gated };
}

/** The group, over the set that `buildEnd` fills: the group is read when the chunks are made, after the module graph is complete. */
export function shellGroups(modules: () => ShellModules): Rolldown.CodeSplittingGroup[] {
  return [{ name: "shell", test: (id) => modules().shell.has(id), priority: 1 }];
}

/** What `checkShellBundle` reads of a file of the bundle (Rolldown's `OutputChunk` and `OutputAsset` have these). */
export type BundleFile =
  | { type: "chunk"; name: string; fileName: string; moduleIds: readonly string[]; facadeModuleId: string | null; imports: readonly string[] }
  | { type: "asset"; fileName: string };

/**
 * Throws unless the bundle is cut as the group says. The chunk is known by what it holds, not by its name (Rolldown names an automatic chunk
 * after its module's file, so a page's own `shell.tsx` makes another chunk of that name): every module of `modules.shell` that the bundle has
 * (the packages, the app's shell and the modules every page of the budget loads) is in one chunk, named `shell`. The client entry has one chunk
 * (its facade), which holds the entry module and nothing else, and no other chunk holds the entry module or imports that chunk statically (see
 * above: were the entry in a chunk the routes import, hydration would start while they are being imported).
 */
export function checkShellBundle(bundle: Readonly<Record<string, BundleFile>>, modules: ShellModules): void {
  const chunks = Object.values(bundle).flatMap((file) => (file.type === "chunk" ? [file] : []));
  const holding = chunks.filter((chunk) => chunk.moduleIds.some((id) => modules.shell.has(id)));
  if (holding.length !== 1) {
    throw new Error(`shell chunks: expected the shell modules in one chunk, found them in ${holding.length}${holding.length > 0 ? ` (${holding.map((chunk) => chunk.fileName).join(", ")})` : ""}`);
  }
  const chunk = holding[0]!;
  // A chunk of another name is not the group's.
  if (chunk.name !== "shell") throw new Error(`shell chunks: the chunk that holds the shell modules, ${chunk.fileName}, is named ${chunk.name}, not shell`);

  const { entry } = modules;
  const entryChunks = chunks.filter((chunk) => chunk.facadeModuleId === entry);
  if (entryChunks.length !== 1) throw new Error(`shell chunks: expected one chunk of the client entry (${entry}), found ${entryChunks.length}`);
  const entryChunk = entryChunks[0]!;
  if (entryChunk.moduleIds.length !== 1 || entryChunk.moduleIds[0] !== entry) {
    throw new Error(
      `shell chunks: the client entry's chunk ${entryChunk.fileName} must hold the entry module and nothing else; it holds ${entryChunk.moduleIds.length === 0 ? "no module" : entryChunk.moduleIds.join(", ")}`,
    );
  }
  const elsewhere = chunks.filter((chunk) => chunk !== entryChunk && chunk.moduleIds.includes(entry)).map((chunk) => chunk.fileName);
  if (elsewhere.length > 0) throw new Error(`shell chunks: ${elsewhere.join(", ")} hold the client entry module too: hydration would start while it is imported`);
  const importers = chunks.filter((chunk) => chunk.imports.includes(entryChunk.fileName)).map((chunk) => chunk.fileName);
  if (importers.length > 0) {
    throw new Error(`shell chunks: ${importers.join(", ")} import the client entry's chunk ${entryChunk.fileName}: hydration would start while they are imported`);
  }
}

/** The file name of the chunk, as the route manifest has it (`/assets/shell-<hash>.js`), and of the packages' chunk of the layout before R18. */
const SHELL_FILE = /(^|\/)shell-[\w-]+\.js$/;
const VENDOR_FILE = /(^|\/)vendor-[\w-]+\.js$/;

/** What `shellManifestProblems` reads of React Router's route manifest (`assets/manifest-*.js`). */
export interface ShellManifest {
  entry: { imports?: readonly string[] };
  routes: Readonly<Record<string, { imports?: readonly string[] } | undefined>>;
}

/**
 * What is wrong with the shell chunk in a build's route manifest (`pnpm check:bundle`): the root route imports one `shell` chunk and no
 * `vendor` chunk (the packages are in the shell), and the entry imports that `shell` chunk (the packages it imports are there). Empty when all
 * is well.
 */
export function shellManifestProblems(manifest: ShellManifest): string[] {
  const problems: string[] = [];
  const rootImports = manifest.routes["root"]?.imports ?? [];
  const shell = rootImports.filter((url) => SHELL_FILE.test(url));
  const vendor = rootImports.filter((url) => VENDOR_FILE.test(url));
  const where = "the shell chunk of scripts/shell-chunks.ts is not in this build";
  if (shell.length !== 1) problems.push(`the root route imports ${shell.length} shell-*.js chunks, not one: ${where}`);
  if (vendor.length > 0) problems.push(`the root route imports ${vendor.join(", ")}: the packages belong in the shell chunk, and ${where}`);
  if (shell.length === 1 && !(manifest.entry.imports ?? []).includes(shell[0]!)) problems.push(`the entry does not import ${shell[0]}: ${where}`);
  return problems;
}

/** The plugin, for the client build only (the Worker's build and the dev server are left as they are). `routes`: the pages of the budget. */
export function shellChunks({ appDirectory, routes = GATED_ROUTES }: { appDirectory: string; routes?: readonly string[] }): Plugin {
  let modules: ShellModules | undefined;
  const sets = () => modules ?? { entry: "", shell: new Set<string>(), gated: new Set<string>() };
  return {
    name: "x-explorer:shell-chunks",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    configEnvironment(name) {
      if (name !== "client") return;
      return { build: { rolldownOptions: { output: { codeSplitting: { groups: shellGroups(sets) } } } } };
    },
    buildEnd(error) {
      if (error || this.environment.name !== "client") return;
      modules = shellModules({ ids: this.getModuleIds(), info: (id) => this.getModuleInfo(id) }, appDirectory, routes);
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      if (!modules) throw new Error("shell chunks: the bundle was made before the module graph was read (buildEnd)");
      checkShellBundle(bundle, modules);
    },
  };
}
