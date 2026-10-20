import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { shellChunks, shellGroups, shellModules, type ModuleGraph } from "./shell-chunks";

const APP = "/repo/app";
const NM = "/repo/node_modules/.pnpm/x/node_modules";
const ENTRY = `${NM}/@react-router/dev/dist/config/defaults/entry.client.tsx`;
const ROOT = `${APP}/root.tsx?__react-router-build-client-route`;

/** A module graph from `id: [static imports]`; `entries` are the build's inputs. (An `import()` is not in `importedIds`.) */
function graphOf(modules: Record<string, string[]>, entries: string[]): ModuleGraph {
  return {
    ids: Object.keys(modules),
    info: (id) => (id in modules ? { importedIds: modules[id]!, isEntry: entries.includes(id) } : null),
  };
}

const APP_GRAPH = graphOf(
  {
    [ENTRY]: [`${NM}/react-dom/client.js`, `${NM}/react-router/dom.js`],
    [`${NM}/react-dom/client.js`]: [`${NM}/react/index.js`],
    [`${NM}/react-router/dom.js`]: [`${NM}/react/index.js`],
    [`${NM}/react/index.js`]: [],
    [ROOT]: [`${APP}/root.tsx`],
    [`${APP}/root.tsx`]: [`${APP}/ui/components/Shell.tsx`, `${NM}/react/index.js`, "\0vite/preload-helper.js"],
    [`${APP}/ui/components/Shell.tsx`]: [`${APP}/domain/format.ts`],
    [`${APP}/domain/format.ts`]: [`${NM}/bignumber.js/bignumber.mjs`],
    [`${NM}/bignumber.js/bignumber.mjs`]: [],
    "\0vite/preload-helper.js": [],
    [`${APP}/routes/net.network.tsx?__react-router-build-client-route`]: [`${APP}/ui/charts/Plot.tsx`, `${APP}/domain/format.ts`],
    [`${APP}/ui/charts/Plot.tsx`]: [`${NM}/react/index.js`],
    // What the search box imports with import(): in the graph, and in no module's importedIds.
    [`${APP}/domain/search.ts`]: [],
  },
  [ENTRY, ROOT, `${APP}/routes/net.network.tsx?__react-router-build-client-route`],
);

describe("shellModules", () => {
  const { vendor, shell } = shellModules(APP_GRAPH, APP);

  it("takes the static closure of the client entry and the root route: the packages in vendor, the app's modules in shell", () => {
    expect([...vendor].sort()).toEqual(["\0vite/preload-helper.js", `${NM}/bignumber.js/bignumber.mjs`, `${NM}/react-dom/client.js`, `${NM}/react-router/dom.js`, `${NM}/react/index.js`]);
    expect([...shell].sort()).toEqual([`${APP}/domain/format.ts`, ROOT, `${APP}/root.tsx`, `${APP}/ui/components/Shell.tsx`].sort());
  });

  it("leaves out the entry module itself, so that hydration starts when React Router's bootstrap imports the entry, after the routes", () => {
    expect(vendor.has(ENTRY)).toBe(false);
    expect(shell.has(ENTRY)).toBe(false);
  });

  it("leaves out what only a page imports, and what is imported with import()", () => {
    expect(shell.has(`${APP}/ui/charts/Plot.tsx`)).toBe(false);
    expect(shell.has(`${APP}/routes/net.network.tsx?__react-router-build-client-route`)).toBe(false);
    expect(shell.has(`${APP}/domain/search.ts`)).toBe(false);
  });

  it("reads Windows paths and a trailing slash on the app directory", () => {
    const win = graphOf({ "C:\\repo\\node_modules\\x\\entry.client.tsx": ["C:\\repo\\app\\a.ts"], "C:\\repo\\app\\root.tsx?q": ["C:\\repo\\app\\a.ts"], "C:\\repo\\app\\a.ts": [] }, [
      "C:\\repo\\node_modules\\x\\entry.client.tsx",
      "C:\\repo\\app\\root.tsx?q",
    ]);
    expect([...shellModules(win, "C:\\repo\\app\\").shell].sort()).toEqual(["C:\\repo\\app\\a.ts", "C:\\repo\\app\\root.tsx?q"]);
  });

  it("fails when the graph has no client entry or no root route, rather than leave the shell in nine files", () => {
    expect(() => shellModules(graphOf({ [ROOT]: [] }, [ROOT]), APP)).toThrow(/one client entry/);
    expect(() => shellModules(graphOf({ [ENTRY]: [] }, [ENTRY]), APP)).toThrow(/one root route/);
    // A module named like the root route that is not an input of the build (the plain `root.tsx` the route module imports) is not it.
    expect(() => shellModules(graphOf({ [ENTRY]: [], [`${APP}/root.tsx`]: [] }, [ENTRY]), APP)).toThrow(/one root route/);
  });
});

describe("shellGroups", () => {
  it("captures the packages first, then the app's modules, from the sets the plugin fills at the end of the build", () => {
    let modules = { vendor: new Set<string>(), shell: new Set<string>() };
    const [vendor, shell] = shellGroups(() => modules);
    expect(vendor!.name).toBe("vendor");
    expect(shell!.name).toBe("shell");
    expect(vendor!.priority).toBeGreaterThan(shell!.priority!);
    const test = (group: typeof vendor, id: string) => (group!.test as (id: string) => boolean)(id);
    expect(test(vendor, `${NM}/react/index.js`)).toBe(false);
    modules = shellModules(APP_GRAPH, APP);
    expect(test(vendor, `${NM}/react/index.js`)).toBe(true);
    expect(test(shell, `${NM}/react/index.js`)).toBe(false);
    expect(test(shell, `${APP}/ui/components/Shell.tsx`)).toBe(true);
    expect(test(shell, `${APP}/ui/charts/Plot.tsx`)).toBe(false);
  });
});

describe("shellChunks", () => {
  const plugin = shellChunks({ appDirectory: APP });
  const configEnvironment = plugin.configEnvironment as (name: string) => { build?: { rolldownOptions?: { output?: { codeSplitting?: { groups?: unknown[] } } } } } | undefined;

  it("is for the build of the client only", () => {
    expect(plugin.apply).toBe("build");
    const applies = plugin.applyToEnvironment as (environment: { name: string }) => boolean;
    expect(applies({ name: "client" })).toBe(true);
    expect(applies({ name: "ssr" })).toBe(false);
    expect(configEnvironment("ssr")).toBeUndefined();
    expect(configEnvironment("client")?.build?.rolldownOptions?.output?.codeSplitting?.groups).toHaveLength(2);
  });
});

// Where there is a build (`pnpm build`), what it wrote for the browser is looked at too.
const assets = new URL("../build/client/assets/", import.meta.url);
describe.skipIf(!existsSync(assets))("the client build", () => {
  const files = readdirSync(assets).filter((file) => file.endsWith(".js"));
  const read = (file: string) => readFileSync(new URL(file, assets), "utf8");
  const manifestFile = files.find((file) => /^manifest-.*\.js$/.test(file))!;
  const text = read(manifestFile);
  const manifest = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
    entry: { module: string; imports: string[] };
    routes: Record<string, { module: string; imports?: string[] }>;
  };
  const entryFile = manifest.entry.module.replace(/^\/?assets\//, "");

  it("has the vendor and shell chunks: the entry imports the packages, the root route both", () => {
    const vendor = files.filter((file) => /^vendor-.*\.js$/.test(file));
    const shell = files.filter((file) => /^shell-.*\.js$/.test(file));
    expect(vendor).toHaveLength(1);
    expect(shell).toHaveLength(1);
    expect(manifest.entry.imports).toEqual(expect.arrayContaining([`/assets/${vendor[0]}`]));
    expect(manifest.routes.root?.imports).toEqual(expect.arrayContaining([`/assets/${vendor[0]}`, `/assets/${shell[0]}`]));
  });

  it("keeps the entry's chunk out of every other file's static imports: hydration starts when the bootstrap imports it, after the routes", () => {
    expect(files).toContain(entryFile);
    const name = entryFile.replace(/\.js$/, "");
    const importers = files.filter((file) => file !== entryFile && new RegExp(`(?:import|from)\\s*["']\\./${name}\\.js["']`).test(read(file)));
    expect(importers).toEqual([]);
    expect(read(entryFile)).toMatch(/hydrateRoot|\bhydrate\b|startTransition|\(document,/);
  });
});
