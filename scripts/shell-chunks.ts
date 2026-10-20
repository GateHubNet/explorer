// How the client build is cut into files (`pnpm check:bundle` counts each file a page loads, gzipped on its own: README, "The client bundle
// check"). Left to itself, Rolldown makes one chunk for each set of entries that load a module, so the code every page loads came in about nine
// files (React's, the router's, `format.ts` with `bignumber.js`, the header, the error screen, the search box, …), and each file costs its own
// gzip context and the `import` and `export` lines that join it to the others. Two groups take that code in instead:
//
//   - `vendor`: the packages (and the bundler's virtual modules) that the client entry and the root route import, the closure of their static
//     imports. They change when a dependency does, so the file is kept apart from the app's code, and a deploy of the app leaves it cached;
//   - `shell`: the app's own modules of that closure (the root route, the layout's header and footer, the error screen, `format.ts`, …).
//
// Every page loads both anyway (React Router's bootstrap imports the root route, and then the entry), so no page loads anything more for it.
// The entry's own module (`entry.client`, which calls `hydrateRoot`) is in neither: it stays the entry's chunk, which no other file imports, so
// that hydration starts when the bootstrap imports the entry, after the route modules are in, and not while they are being imported (were it
// in a chunk the routes import, it would run then). What only some pages load is left to Rolldown's own splitting.

import type { Plugin, Rolldown } from "vite";

/** What the plugin needs of the module graph: every module, and each one's static imports and whether it is an entry. */
export interface ModuleGraph {
  ids: Iterable<string>;
  info(id: string): { importedIds: readonly string[]; isEntry: boolean } | null;
}

export interface ShellModules {
  /** The packages and virtual modules of the closure, the client entry module excepted. */
  vendor: Set<string>;
  /** The app's modules of the closure. */
  shell: Set<string>;
}

/** React Router's client entry: the app's own `app/entry.client.tsx`, or the default one of `@react-router/dev`. */
const CLIENT_ENTRY = /[\\/]entry\.client\.[cm]?[jt]sx?$/;

const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

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
  for (const id of seen) (normalize(id).startsWith(`${app}/`) ? shell : vendor).add(id);
  return { vendor, shell };
}

/** The two groups, over sets that `buildEnd` fills: the groups are read when the chunks are made, after the module graph is complete. */
export function shellGroups(modules: () => ShellModules): Rolldown.CodeSplittingGroup[] {
  return [
    // First: the shell's modules import the packages, and a group takes in what its modules import unless a group before it has.
    { name: "vendor", test: (id) => modules().vendor.has(id), priority: 2 },
    { name: "shell", test: (id) => modules().shell.has(id), priority: 1 },
  ];
}

/** The plugin, for the client build only (the Worker's build and the dev server are left as they are). */
export function shellChunks({ appDirectory }: { appDirectory: string }): Plugin {
  let modules: ShellModules = { vendor: new Set(), shell: new Set() };
  return {
    name: "x-explorer:shell-chunks",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    configEnvironment(name) {
      if (name !== "client") return;
      return { build: { rolldownOptions: { output: { codeSplitting: { groups: shellGroups(() => modules) } } } } };
    },
    buildEnd(error) {
      if (error || this.environment.name !== "client") return;
      modules = shellModules({ ids: this.getModuleIds(), info: (id) => this.getModuleInfo(id) }, appDirectory);
    },
  };
}
