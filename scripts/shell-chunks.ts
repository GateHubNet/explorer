// How the client build is cut into files (`pnpm check:bundle` counts each file a page loads, gzipped on its own: README, "The client bundle
// check"). Left to itself, Rolldown makes one chunk for each set of entries that load a module, so the code every page loads came in about nine
// files (React's, the router's, `format.ts` with `bignumber.js`, the header, the error screen, the search box, …), and each file costs its own
// gzip context and the `import` and `export` lines that join it to the others. Two groups take that code in instead:
//
//   - `vendor`: the packages (`node_modules`) and the bundler's virtual modules (`\0` ids) of the closure of the static imports of the client
//     entry and the root route. It changes with a dependency, or when the app uses more or less of one, so the file is kept apart from the
//     app's code, and a deploy that does neither leaves it cached;
//   - `shell`: the rest of that closure, the repository's own modules (the root route, the layout's header and footer, the error screen,
//     `format.ts`, …).
//
// Every page loads both anyway (React Router's bootstrap imports the root route, and then the entry), so no page loads anything more for it.
// The entry's own module (`entry.client`, which calls `hydrateRoot`) is in neither: it stays the entry's chunk, which no other file imports, so
// that hydration starts when the bootstrap imports the entry, after the route modules are in, and not while they are being imported (were it
// in a chunk the routes import, it would run then). What only some pages load is left to Rolldown's own splitting.
//
// The plugin checks what it has made, in every client build (a deploy's too): one chunk named `vendor` and one named `shell`, both with
// modules in them, and the entry's chunk holding the entry module alone and imported by no chunk (`checkShellBundle`; it throws, and the build
// fails). `pnpm check:bundle` reads the same in the route manifest of `build/client` (`shellManifestProblems`).

import type { Plugin, Rolldown } from "vite";

/** What the plugin needs of the module graph: every module, and each one's static imports and whether it is an entry. */
export interface ModuleGraph {
  ids: Iterable<string>;
  info(id: string): { importedIds: readonly string[]; isEntry: boolean } | null;
}

export interface ShellModules {
  /** The client entry module (`entry.client`), which is in neither set. */
  entry: string;
  /** The packages and virtual modules of the closure, the client entry module excepted. */
  vendor: Set<string>;
  /** The rest of the closure: the repository's own modules. */
  shell: Set<string>;
}

/** React Router's client entry: the app's own `app/entry.client.tsx`, or the default one of `@react-router/dev`. */
const CLIENT_ENTRY = /[\\/]entry\.client\.[cm]?[jt]sx?$/;

const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

/** A module of a package (below a `node_modules` directory) or a virtual module of the bundler (`\0…`): what goes in `vendor`. */
export function isVendorModule(id: string): boolean {
  return id.startsWith("\0") || /(^|[\\/])node_modules[\\/]/.test(id);
}

/** The root route's module as React Router's client build names it: `app/root.tsx` with the build's query. */
function isRootRoute(id: string, appDirectory: string): boolean {
  const path = normalize(id).split("?")[0]!;
  return path.startsWith(`${appDirectory}/`) && /^root\.[cm]?[jt]sx?$/.test(path.slice(appDirectory.length + 1));
}

/**
 * The modules every page loads: the static closure of the client entry and of the root route (dynamic imports are not followed: they are
 * loaded when needed). The entry module itself is left out (see above). Throws when the graph has no client entry or no root route, so that a
 * change of React Router's names fails the build instead of putting the code every page loads back into nine files.
 */
export function shellModules(graph: ModuleGraph, appDirectory: string): ShellModules {
  const app = normalize(appDirectory);
  const ids = [...graph.ids];
  const entries = ids.filter((id) => graph.info(id)?.isEntry && CLIENT_ENTRY.test(normalize(id).split("?")[0]!));
  const roots = ids.filter((id) => graph.info(id)?.isEntry && isRootRoute(id, app));
  if (entries.length !== 1) throw new Error(`shell chunks: expected one client entry (entry.client) among the entries, found ${entries.length}`);
  if (roots.length !== 1) throw new Error(`shell chunks: expected one root route (${app}/root.tsx) among the entries, found ${roots.length}`);

  const seen = new Set<string>();
  const stack = [entries[0]!, roots[0]!];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(graph.info(id)?.importedIds ?? []));
  }
  seen.delete(entries[0]!);

  const vendor = new Set<string>();
  const shell = new Set<string>();
  for (const id of seen) (isVendorModule(id) ? vendor : shell).add(id);
  return { entry: entries[0]!, vendor, shell };
}

/** The two groups, over sets that `buildEnd` fills: the groups are read when the chunks are made, after the module graph is complete. */
export function shellGroups(modules: () => ShellModules): Rolldown.CodeSplittingGroup[] {
  return [
    // First: the shell's modules import the packages, and a group takes in what its modules import unless a group before it has.
    { name: "vendor", test: (id) => modules().vendor.has(id), priority: 2 },
    { name: "shell", test: (id) => modules().shell.has(id), priority: 1 },
  ];
}

/** What `checkShellBundle` reads of a file of the bundle (Rolldown's `OutputChunk` and `OutputAsset` have these). */
export type BundleFile =
  | { type: "chunk"; name: string; fileName: string; moduleIds: readonly string[]; facadeModuleId: string | null; imports: readonly string[] }
  | { type: "asset"; fileName: string };

/**
 * Throws unless the bundle is cut as the groups say: exactly one chunk named `vendor` and one named `shell`, each with modules in it, and one
 * chunk of the client entry (`entry`, its facade), which holds no module but the entry and which no chunk imports statically (see above: were
 * it imported, hydration would start while the route modules are being imported).
 */
export function checkShellBundle(bundle: Readonly<Record<string, BundleFile>>, entry: string): void {
  const chunks = Object.values(bundle).flatMap((file) => (file.type === "chunk" ? [file] : []));
  for (const name of ["vendor", "shell"]) {
    const named = chunks.filter((chunk) => chunk.name === name);
    if (named.length !== 1) throw new Error(`shell chunks: expected one chunk named ${name}, found ${named.length}`);
    if (named[0]!.moduleIds.length === 0) throw new Error(`shell chunks: the ${name} chunk (${named[0]!.fileName}) has no module`);
  }
  const entryChunks = chunks.filter((chunk) => chunk.facadeModuleId === entry);
  if (entryChunks.length !== 1) throw new Error(`shell chunks: expected one chunk of the client entry (${entry}), found ${entryChunks.length}`);
  const entryChunk = entryChunks[0]!;
  const others = entryChunk.moduleIds.filter((id) => id !== entry);
  if (others.length > 0) {
    throw new Error(`shell chunks: the client entry's chunk ${entryChunk.fileName} holds other modules too (${others.join(", ")}), which the route modules may import`);
  }
  const importers = chunks.filter((chunk) => chunk.imports.includes(entryChunk.fileName)).map((chunk) => chunk.fileName);
  if (importers.length > 0) {
    throw new Error(`shell chunks: ${importers.join(", ")} import the client entry's chunk ${entryChunk.fileName}: hydration would start while they are imported`);
  }
}

/** The file names of the two chunks, as the route manifest has them (`/assets/vendor-<hash>.js`). */
const VENDOR_FILE = /(^|\/)vendor-[\w-]+\.js$/;
const SHELL_FILE = /(^|\/)shell-[\w-]+\.js$/;

/** What `shellManifestProblems` reads of React Router's route manifest (`assets/manifest-*.js`). */
export interface ShellManifest {
  entry: { imports?: readonly string[] };
  routes: Readonly<Record<string, { imports?: readonly string[] } | undefined>>;
}

/**
 * What is wrong with the two chunks in a build's route manifest (`pnpm check:bundle`): the root route imports one `vendor` and one `shell`
 * chunk, and the entry imports that `vendor` chunk. Empty when all is well.
 */
export function shellManifestProblems(manifest: ShellManifest): string[] {
  const problems: string[] = [];
  const rootImports = manifest.routes["root"]?.imports ?? [];
  const vendor = rootImports.filter((url) => VENDOR_FILE.test(url));
  const shell = rootImports.filter((url) => SHELL_FILE.test(url));
  const where = "the shell chunks of scripts/shell-chunks.ts are not in this build";
  if (vendor.length !== 1) problems.push(`the root route imports ${vendor.length} vendor-*.js chunks, not one: ${where}`);
  if (shell.length !== 1) problems.push(`the root route imports ${shell.length} shell-*.js chunks, not one: ${where}`);
  if (vendor.length === 1 && !(manifest.entry.imports ?? []).includes(vendor[0]!)) problems.push(`the entry does not import ${vendor[0]}: ${where}`);
  return problems;
}

/** The plugin, for the client build only (the Worker's build and the dev server are left as they are). */
export function shellChunks({ appDirectory }: { appDirectory: string }): Plugin {
  let modules: ShellModules | undefined;
  const sets = () => modules ?? { entry: "", vendor: new Set<string>(), shell: new Set<string>() };
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
      modules = shellModules({ ids: this.getModuleIds(), info: (id) => this.getModuleInfo(id) }, appDirectory);
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      if (!modules) throw new Error("shell chunks: the bundle was made before the module graph was read (buildEnd)");
      checkShellBundle(bundle, modules.entry);
    },
  };
}
