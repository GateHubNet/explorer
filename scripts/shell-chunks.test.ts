import { describe, expect, it } from "vitest";

import {
  checkShellBundle,
  isVendorModule,
  shellChunks,
  shellGroups,
  shellManifestProblems,
  shellModules,
  type BundleFile,
  type ModuleGraph,
  type ShellManifest,
} from "./shell-chunks";

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
    // A module of the repository outside app/ (as `scripts/` or `test/support/` would be): the app's, not a package.
    [`${APP}/ui/components/Shell.tsx`]: [`${APP}/domain/format.ts`, "/repo/lib/words.ts"],
    ["/repo/lib/words.ts"]: [],
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

  it("takes the static closure of the client entry and the root route: node_modules and \\0 ids in vendor, the rest (app/ or not) in shell", () => {
    expect([...vendor].sort()).toEqual(["\0vite/preload-helper.js", `${NM}/bignumber.js/bignumber.mjs`, `${NM}/react-dom/client.js`, `${NM}/react-router/dom.js`, `${NM}/react/index.js`]);
    expect([...shell].sort()).toEqual([`${APP}/domain/format.ts`, ROOT, `${APP}/root.tsx`, `${APP}/ui/components/Shell.tsx`, "/repo/lib/words.ts"].sort());
  });

  it("names the client entry module", () => {
    expect(shellModules(APP_GRAPH, APP).entry).toBe(ENTRY);
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
});

describe("isVendorModule", () => {
  it("is a module below node_modules, or a virtual one of the bundler, and nothing else", () => {
    for (const id of [`${NM}/react/index.js`, "C:\\repo\\node_modules\\react\\index.js", "\0vite/preload-helper.js", "\0virtual:react-router/x", "node_modules/a/b.js"]) {
      expect(isVendorModule(id), id).toBe(true);
    }
    for (const id of [`${APP}/root.tsx`, "/repo/lib/words.ts", "/repo/app/not_node_modules/x.ts", "/repo/app/node_modules.ts", "virtual-looking.ts"]) {
      expect(isVendorModule(id), id).toBe(false);
    }
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
    let modules = { entry: "", vendor: new Set<string>(), shell: new Set<string>() };
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

  // The hooks as the bundler calls them, with the little of their context that the plugin reads.
  type Hook = (this: unknown, ...args: unknown[]) => void;
  const buildEnd = plugin.buildEnd as Hook;
  const generateBundle = plugin.generateBundle as Hook;
  const client = { environment: { name: "client" }, getModuleIds: () => APP_GRAPH.ids, getModuleInfo: (id: string) => APP_GRAPH.info(id) };

  it("checks the bundle it has made, in the client build: a good one passes, a bad one fails the build", () => {
    const fresh = shellChunks({ appDirectory: APP });
    expect(() => (fresh.generateBundle as Hook).call(client, {}, bundleOf())).toThrow(/before the module graph was read/);
    buildEnd.call(client);
    expect(() => generateBundle.call(client, {}, bundleOf())).not.toThrow();
    expect(() => generateBundle.call(client, {}, bundleOf({ shell: null }))).toThrow(/one chunk named shell, found 0/);
    // The Worker's build is not looked at (the plugin is not applied to it; were it called, it would say nothing).
    expect(() => generateBundle.call({ environment: { name: "ssr" } }, {}, {})).not.toThrow();
  });
});

/** A bundle as the plugin makes it (the entry's chunk imported by nobody), with chunks replaced (`null` takes one out). */
function bundleOf(change: Partial<Record<"entry" | "vendor" | "shell" | "root" | "page", Partial<Extract<BundleFile, { type: "chunk" }>> | null>> = {}) {
  const base = {
    entry: { name: "entry.client", fileName: "assets/entry.client-a.js", moduleIds: [ENTRY], facadeModuleId: ENTRY, imports: ["assets/vendor-b.js"] },
    vendor: { name: "vendor", fileName: "assets/vendor-b.js", moduleIds: [`${NM}/react/index.js`], facadeModuleId: null, imports: [] },
    shell: { name: "shell", fileName: "assets/shell-c.js", moduleIds: [`${APP}/root.tsx`], facadeModuleId: null, imports: ["assets/vendor-b.js"] },
    root: { name: "root", fileName: "assets/root-d.js", moduleIds: [ROOT], facadeModuleId: ROOT, imports: ["assets/vendor-b.js", "assets/shell-c.js"] },
    page: { name: "net.network", fileName: "assets/net.network-e.js", moduleIds: [`${APP}/ui/charts/Plot.tsx`], facadeModuleId: null, imports: ["assets/shell-c.js"] },
  };
  const bundle: Record<string, BundleFile> = { "assets/styles-f.css": { type: "asset", fileName: "assets/styles-f.css" } };
  for (const [key, chunk] of Object.entries(base)) {
    const changed = change[key as keyof typeof base];
    if (changed === null) continue;
    const file = { type: "chunk" as const, ...chunk, ...changed };
    bundle[file.fileName] = file;
  }
  return bundle;
}

describe("checkShellBundle", () => {
  it("passes a bundle with one vendor and one shell chunk, and an entry chunk of the entry alone that no chunk imports", () => {
    expect(() => checkShellBundle(bundleOf(), ENTRY)).not.toThrow();
  });

  it.each([
    ["no vendor chunk", bundleOf({ vendor: null }), /one chunk named vendor, found 0/],
    ["no shell chunk", bundleOf({ shell: null }), /one chunk named shell, found 0/],
    ["two vendor chunks", { ...bundleOf(), "assets/vendor-x.js": { type: "chunk", name: "vendor", fileName: "assets/vendor-x.js", moduleIds: ["\0x"], facadeModuleId: null, imports: [] } }, /one chunk named vendor, found 2/],
    ["an empty vendor chunk", bundleOf({ vendor: { moduleIds: [] } }), /vendor chunk \(assets\/vendor-b\.js\) has no module/],
    ["an empty shell chunk", bundleOf({ shell: { moduleIds: [] } }), /shell chunk \(assets\/shell-c\.js\) has no module/],
    ["no chunk of the client entry", bundleOf({ entry: null }), /one chunk of the client entry .*found 0/],
    ["an entry chunk that holds another module", bundleOf({ entry: { moduleIds: [ENTRY, `${NM}/react-dom/client.js`] } }), /holds other modules too \(.*react-dom\/client\.js\)/],
    ["an entry chunk that the root route imports", bundleOf({ root: { imports: ["assets/vendor-b.js", "assets/shell-c.js", "assets/entry.client-a.js"] } }), /assets\/root-d\.js import the client entry's chunk/],
    ["an entry chunk that a page's chunk imports", bundleOf({ page: { imports: ["assets/entry.client-a.js"] } }), /assets\/net\.network-e\.js import the client entry's chunk/],
  ] as const)("throws on %s", (_case, bundle, message) => {
    expect(() => checkShellBundle(bundle, ENTRY)).toThrow(message);
  });

  it("does not take an asset, or a chunk named like vendor, for one", () => {
    const bundle = bundleOf();
    bundle["assets/vendor-z.css"] = { type: "asset", fileName: "assets/vendor-z.css" };
    bundle["assets/vendor-ish-y.js"] = { type: "chunk", name: "vendor-ish", fileName: "assets/vendor-ish-y.js", moduleIds: ["\0y"], facadeModuleId: null, imports: [] };
    expect(() => checkShellBundle(bundle, ENTRY)).not.toThrow();
  });
});

describe("shellManifestProblems", () => {
  const manifest = (rootImports: string[], entryImports: string[]): ShellManifest => ({
    entry: { imports: entryImports },
    routes: { root: { imports: rootImports }, "routes/net": { imports: ["/assets/shell-Ab_1.js"] } },
  });
  const GOOD = manifest(["/assets/rolldown-runtime-x.js", "/assets/vendor-CTQ-j4.js", "/assets/shell-BZb_3W.js"], ["/assets/rolldown-runtime-x.js", "/assets/vendor-CTQ-j4.js"]);

  it("is empty when the root route imports one vendor and one shell chunk and the entry imports that vendor chunk", () => {
    expect(shellManifestProblems(GOOD)).toEqual([]);
  });

  it("names each thing that is missing: the vendor chunk, the shell chunk, the entry's import of vendor", () => {
    // A build from before the shell chunks: nine chunks of other names.
    const before = manifest(["/assets/react-a.js", "/assets/format-b.js", "/assets/Shell-c.js"], ["/assets/react-a.js"]);
    expect(shellManifestProblems(before)).toEqual([
      "the root route imports 0 vendor-*.js chunks, not one: the shell chunks of scripts/shell-chunks.ts are not in this build",
      "the root route imports 0 shell-*.js chunks, not one: the shell chunks of scripts/shell-chunks.ts are not in this build",
    ]);
    expect(shellManifestProblems(manifest(["/assets/vendor-a.js"], ["/assets/vendor-a.js"]))).toEqual([expect.stringMatching(/0 shell-\*\.js chunks/)]);
    expect(shellManifestProblems(manifest(["/assets/vendor-a.js", "/assets/vendor-b.js", "/assets/shell-c.js"], []))).toEqual([expect.stringMatching(/2 vendor-\*\.js chunks/)]);
    expect(shellManifestProblems(manifest(["/assets/vendor-a.js", "/assets/shell-c.js"], ["/assets/vendor-other.js"]))).toEqual([
      expect.stringMatching(/the entry does not import \/assets\/vendor-a\.js/),
    ]);
    expect(shellManifestProblems({ entry: {}, routes: {} })).toHaveLength(2);
  });

  it("reads a file name by its dots: a name with another character where the dot is, or another extension, is not one", () => {
    expect(shellManifestProblems(manifest(["/assets/vendor-aXjs", "/assets/shell-c.js"], ["/assets/vendor-aXjs"]))).toEqual([expect.stringMatching(/0 vendor-/)]);
    expect(shellManifestProblems(manifest(["/assets/vendor-a.css", "/assets/shell-c.js"], []))).toEqual([expect.stringMatching(/0 vendor-/)]);
  });
});
