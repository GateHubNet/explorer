import { describe, expect, it } from "vitest";

import { PAGES } from "./bundle-budget";
import {
  checkShellBundle,
  GATED_ROUTES,
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
/** A route's module as React Router's client build names it, and one of its split chunks, which is an entry of the same file too. */
const route = (name: string) => `${APP}/routes/${name}.tsx?__react-router-build-client-route`;
const HOME = route("net._index");
const HOME_LOADER = `${APP}/routes/net._index.tsx?route-chunk=clientLoader`;
const NETWORK = route("net.network");
const SEARCH = route("net.search");
/** The pages of the budget in this graph (the app's are `PAGES` of bundle-budget.ts). */
const PAGE_ROUTES = ["routes/net._index", "routes/net.network"];

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
    // The two pages of the budget: each draws a table, which imports a module of the app and a package that the root does not.
    [HOME]: [`${APP}/routes/net._index.tsx`],
    [`${APP}/routes/net._index.tsx`]: [`${APP}/ui/components/DataTable.tsx`, `${APP}/ui/pages/Home.tsx`, `${APP}/routes/net.tsx`],
    [HOME_LOADER]: [`${APP}/domain/format.ts`],
    [NETWORK]: [`${APP}/routes/net.network.tsx`],
    // A route module that imports another route's module (both reach it, and it stays its route's).
    [`${APP}/routes/net.network.tsx`]: [`${APP}/ui/charts/Plot.tsx`, `${APP}/ui/components/DataTable.tsx`, `${APP}/domain/format.ts`, `${APP}/routes/net.tsx`],
    [`${APP}/routes/net.tsx`]: [],
    [`${APP}/ui/components/DataTable.tsx`]: [`${APP}/ui/motion.ts`, `${NM}/clsx/index.js`, `${NM}/react/index.js`],
    [`${APP}/ui/motion.ts`]: [],
    [`${NM}/clsx/index.js`]: [],
    [`${APP}/ui/pages/Home.tsx`]: [`${NM}/react/index.js`],
    [`${APP}/ui/charts/Plot.tsx`]: [`${NM}/react/index.js`],
    // A route that is not a page of the budget: it loads the table too, and that does not make the table any less the pages'.
    [SEARCH]: [`${APP}/ui/pages/Search.tsx`],
    [`${APP}/ui/pages/Search.tsx`]: [],
    // What the search box imports with import(): in the graph, and in no module's importedIds.
    [`${APP}/domain/search.ts`]: [],
  },
  [ENTRY, ROOT, HOME, HOME_LOADER, NETWORK, SEARCH],
);

/** The closure of the entry and the root route, the entry module excepted. */
const CLOSURE = [
  "\0vite/preload-helper.js",
  `${NM}/bignumber.js/bignumber.mjs`,
  `${NM}/react-dom/client.js`,
  `${NM}/react-router/dom.js`,
  `${NM}/react/index.js`,
  `${APP}/domain/format.ts`,
  ROOT,
  `${APP}/root.tsx`,
  `${APP}/ui/components/Shell.tsx`,
  "/repo/lib/words.ts",
];
/** What both pages of the budget load beyond it. */
const GATED = [`${APP}/ui/components/DataTable.tsx`, `${APP}/ui/motion.ts`, `${NM}/clsx/index.js`];

describe("shellModules", () => {
  const { shell, gated } = shellModules(APP_GRAPH, APP, PAGE_ROUTES);

  it("takes the static closure of the client entry and the root route, packages, \\0 ids and the repository's own modules alike, and what every page of the budget loads beyond it", () => {
    expect([...shell].sort()).toEqual([...CLOSURE, ...GATED].sort());
    expect([...gated].sort()).toEqual([...GATED].sort());
  });

  it("names the client entry module", () => {
    expect(shellModules(APP_GRAPH, APP, PAGE_ROUTES).entry).toBe(ENTRY);
  });

  it("leaves out the entry module itself, so that hydration starts when React Router's bootstrap imports the entry, after the routes", () => {
    expect(shell.has(ENTRY)).toBe(false);
  });

  it("leaves out what only some pages of the budget import, what a page outside the budget imports, the route modules, and what is imported with import()", () => {
    for (const id of [`${APP}/ui/charts/Plot.tsx`, `${APP}/ui/pages/Home.tsx`, `${APP}/ui/pages/Search.tsx`, `${APP}/domain/search.ts`]) expect(shell.has(id), id).toBe(false);
    // Both pages reach the layout's module, and it stays its route's chunk; so do the routes' own modules and their split chunks.
    for (const id of [`${APP}/routes/net.tsx`, HOME, `${APP}/routes/net._index.tsx`, HOME_LOADER, NETWORK, `${APP}/routes/net.network.tsx`, SEARCH]) expect(shell.has(id), id).toBe(false);
  });

  it("takes a route's module, not its split chunk (`?route-chunk=`), which is an entry of the same file", () => {
    // The home page's split chunk imports format.ts alone, which is the closure's: taken for the route, it would leave nothing for the shell.
    const home = shellModules(APP_GRAPH, APP, ["routes/net._index"]);
    expect([...home.gated].sort()).toEqual([...GATED, `${APP}/ui/pages/Home.tsx`].sort());
  });

  it("is the closure alone with no page of the budget, and what one page loads with one", () => {
    expect([...shellModules(APP_GRAPH, APP, []).shell].sort()).toEqual([...CLOSURE].sort());
    expect([...shellModules(APP_GRAPH, APP, ["routes/net.network"]).gated].sort()).toEqual([...GATED, `${APP}/ui/charts/Plot.tsx`].sort());
  });

  it("is kept for the pages of the budget, PAGES of bundle-budget.ts, by default", () => {
    expect(GATED_ROUTES).toEqual(PAGES.map((page) => page.route));
    expect(GATED_ROUTES).toContain("routes/net.markets.$base.$counter");
    // This graph has two of the seven: the others are missing, and the build fails.
    expect(() => shellModules(APP_GRAPH, APP)).toThrow(/expected one module of the route routes\/net\.ledger\.\$id \(a page of PAGES in scripts\/bundle-budget\.ts\) among the entries, found 0/);
  });

  it("fails when the route of a page of the budget is not in the graph, or is twice, rather than leave what the pages load in files of its own", () => {
    expect(() => shellModules(APP_GRAPH, APP, [...PAGE_ROUTES, "routes/net.markets"])).toThrow(/expected one module of the route routes\/net\.markets .*found 0/);
    // A module named like the route that is not an input of the build (the plain module the route's imports) is not it.
    const plain = graphOf({ [ENTRY]: [], [ROOT]: [], [`${APP}/routes/net.markets.tsx`]: [] }, [ENTRY, ROOT]);
    expect(() => shellModules(plain, APP, ["routes/net.markets"])).toThrow(/routes\/net\.markets .*found 0/);
    // The pair page's route is not the markets page's, though its file name starts with it.
    const pair = graphOf({ [ENTRY]: [], [ROOT]: [], [route("net.markets.$base.$counter")]: [] }, [ENTRY, ROOT, route("net.markets.$base.$counter")]);
    expect(() => shellModules(pair, APP, ["routes/net.markets"])).toThrow(/routes\/net\.markets .*found 0/);
    expect(shellModules(pair, APP, ["routes/net.markets.$base.$counter"]).gated.size).toBe(0);
  });

  it("fails when the graph has no client entry or no root route, rather than leave the shell in nine files", () => {
    expect(() => shellModules(graphOf({ [ROOT]: [] }, [ROOT]), APP, [])).toThrow(/one client entry/);
    expect(() => shellModules(graphOf({ [ENTRY]: [] }, [ENTRY]), APP, [])).toThrow(/one root route/);
    // A module named like the root route that is not an input of the build (the plain `root.tsx` the route module imports) is not it.
    expect(() => shellModules(graphOf({ [ENTRY]: [], [`${APP}/root.tsx`]: [] }, [ENTRY]), APP, [])).toThrow(/one root route/);
  });

  it("reads Windows paths and a trailing slash on the app directory", () => {
    const win = graphOf(
      {
        "C:\\repo\\node_modules\\x\\entry.client.tsx": ["C:\\repo\\app\\a.ts"],
        "C:\\repo\\app\\root.tsx?q": ["C:\\repo\\app\\a.ts"],
        "C:\\repo\\app\\a.ts": [],
        "C:\\repo\\app\\routes\\net._index.tsx?__react-router-build-client-route": ["C:\\repo\\app\\b.ts"],
        "C:\\repo\\app\\b.ts": [],
      },
      ["C:\\repo\\node_modules\\x\\entry.client.tsx", "C:\\repo\\app\\root.tsx?q", "C:\\repo\\app\\routes\\net._index.tsx?__react-router-build-client-route"],
    );
    expect([...shellModules(win, "C:\\repo\\app\\", ["routes/net._index"]).shell].sort()).toEqual(["C:\\repo\\app\\a.ts", "C:\\repo\\app\\b.ts", "C:\\repo\\app\\root.tsx?q"]);
  });
});

describe("shellGroups", () => {
  it("is one group, shell, over the set the plugin fills at the end of the build: the packages, the app's shell and what every page of the budget loads", () => {
    let modules = { entry: "", shell: new Set<string>(), gated: new Set<string>() };
    const groups = shellGroups(() => modules);
    expect(groups).toHaveLength(1);
    const [shell] = groups;
    expect(shell!.name).toBe("shell");
    const test = (id: string) => (shell!.test as (id: string) => boolean)(id);
    expect(test(`${NM}/react/index.js`)).toBe(false);
    modules = shellModules(APP_GRAPH, APP, PAGE_ROUTES);
    expect(test(`${NM}/react/index.js`)).toBe(true);
    expect(test(`${APP}/ui/components/Shell.tsx`)).toBe(true);
    expect(test(`${APP}/ui/components/DataTable.tsx`)).toBe(true);
    expect(test(`${APP}/ui/charts/Plot.tsx`)).toBe(false);
  });
});

describe("shellChunks", () => {
  const plugin = shellChunks({ appDirectory: APP, routes: PAGE_ROUTES });
  const configEnvironment = plugin.configEnvironment as (name: string) => { build?: { rolldownOptions?: { output?: { codeSplitting?: { groups?: unknown[] } } } } } | undefined;

  it("is for the build of the client only", () => {
    expect(plugin.apply).toBe("build");
    const applies = plugin.applyToEnvironment as (environment: { name: string }) => boolean;
    expect(applies({ name: "client" })).toBe(true);
    expect(applies({ name: "ssr" })).toBe(false);
    expect(configEnvironment("ssr")).toBeUndefined();
    expect(configEnvironment("client")?.build?.rolldownOptions?.output?.codeSplitting?.groups).toHaveLength(1);
  });

  // The hooks as the bundler calls them, with the little of their context that the plugin reads.
  type Hook = (this: unknown, ...args: unknown[]) => void;
  const buildEnd = plugin.buildEnd as Hook;
  const generateBundle = plugin.generateBundle as Hook;
  const client = { environment: { name: "client" }, getModuleIds: () => APP_GRAPH.ids, getModuleInfo: (id: string) => APP_GRAPH.info(id) };

  it("checks the bundle it has made, in the client build: a good one passes, a bad one fails the build", () => {
    const fresh = shellChunks({ appDirectory: APP, routes: PAGE_ROUTES });
    expect(() => (fresh.generateBundle as Hook).call(client, {}, bundleOf())).toThrow(/before the module graph was read/);
    buildEnd.call(client);
    expect(() => generateBundle.call(client, {}, bundleOf())).not.toThrow();
    expect(() => generateBundle.call(client, {}, bundleOf({ shell: null }))).toThrow(/the shell modules in one chunk, found them in 0/);
    expect(() => generateBundle.call(client, {}, bundleOf({ entry: { moduleIds: [] }, shell: { moduleIds: [...SHELL_IDS, ENTRY] } }))).toThrow(/must hold the entry module/);
    // The Worker's build is not looked at (the plugin is not applied to it; were it called, it would say nothing).
    expect(() => generateBundle.call({ environment: { name: "ssr" } }, {}, {})).not.toThrow();
  });

  it("fails the build when a page of the budget has no route in the module graph: the default is PAGES", () => {
    expect(() => (shellChunks({ appDirectory: APP }).buildEnd as Hook).call(client)).toThrow(/expected one module of the route routes\/net\.ledger\.\$id/);
  });
});

/** The set the plugin computes for APP_GRAPH: what the fake bundles below are cut by. */
const MODULES = shellModules(APP_GRAPH, APP, PAGE_ROUTES);
const SHELL_IDS = [...MODULES.shell];
const PACKAGES = SHELL_IDS.filter((id) => id.startsWith(NM) || id.startsWith("\0"));

type FakeChunk = Partial<Extract<BundleFile, { type: "chunk" }>>;

/**
 * A bundle as the plugin makes it, as the real build has it: the entry's chunk holds the entry module alone, imports `shell` and is imported by
 * nobody, the root route's chunk is a facade (its module is in `shell`), and a page's chunk imports `shell`. `change` replaces fields of a chunk
 * (`null` takes it out); `extra` adds chunks.
 */
function bundleOf(change: Partial<Record<"entry" | "shell" | "root" | "page", FakeChunk | null>> = {}, extra: FakeChunk[] = []) {
  const base = {
    entry: { name: "entry.client", fileName: "assets/entry.client-a.js", moduleIds: [ENTRY], facadeModuleId: ENTRY, imports: ["assets/shell-c.js"] },
    shell: { name: "shell", fileName: "assets/shell-c.js", moduleIds: SHELL_IDS, facadeModuleId: null, imports: [] },
    root: { name: "root", fileName: "assets/root-d.js", moduleIds: [], facadeModuleId: ROOT, imports: ["assets/shell-c.js"] },
    page: {
      name: "net.network",
      fileName: "assets/net.network-e.js",
      moduleIds: [NETWORK, `${APP}/routes/net.network.tsx`, `${APP}/ui/charts/Plot.tsx`],
      facadeModuleId: NETWORK,
      imports: ["assets/shell-c.js"],
    },
  };
  const bundle: Record<string, BundleFile> = { "assets/styles-f.css": { type: "asset", fileName: "assets/styles-f.css" } };
  const chunks = [...Object.entries(base).map(([key, chunk]) => (change[key as keyof typeof base] === null ? null : { ...chunk, ...change[key as keyof typeof base] })), ...extra];
  for (const chunk of chunks) {
    if (chunk === null) continue;
    const file = { type: "chunk" as const, name: "x", fileName: "assets/x.js", moduleIds: [], facadeModuleId: null, imports: [], ...chunk };
    bundle[file.fileName] = file;
  }
  return bundle;
}

describe("checkShellBundle", () => {
  it("passes a bundle cut as the group says: one shell chunk, an entry chunk of the entry alone that no chunk imports", () => {
    expect(() => checkShellBundle(bundleOf(), MODULES)).not.toThrow();
  });

  it.each([
    ["no chunk of the shell modules", bundleOf({ shell: null }), /expected the shell modules in one chunk, found them in 0$/],
    ["an empty shell chunk", bundleOf({ shell: { moduleIds: [] } }), /expected the shell modules in one chunk, found them in 0$/],
    [
      "the packages in a vendor chunk of their own (the layout before R18)",
      bundleOf({ shell: { moduleIds: SHELL_IDS.filter((id) => !PACKAGES.includes(id)) } }, [{ name: "vendor", fileName: "assets/vendor-b.js", moduleIds: PACKAGES }]),
      /shell modules in one chunk, found them in 2 \(assets\/shell-c\.js, assets\/vendor-b\.js\)/,
    ],
    [
      "a module every page of the budget loads in a chunk of its own",
      bundleOf({ shell: { moduleIds: SHELL_IDS.filter((id) => !GATED.includes(id)) } }, [{ name: "DataTable", fileName: "assets/DataTable-g.js", moduleIds: GATED }]),
      /shell modules in one chunk, found them in 2 \(assets\/shell-c\.js, assets\/DataTable-g\.js\)/,
    ],
    [
      "a package of the shell in a chunk of its own",
      bundleOf({ shell: { moduleIds: SHELL_IDS.filter((id) => !id.endsWith("/react/index.js")) } }, [{ name: "react", fileName: "assets/react-x.js", moduleIds: [`${NM}/react/index.js`] }]),
      /shell modules in one chunk, found them in 2 \(assets\/shell-c\.js, assets\/react-x\.js\)/,
    ],
    [
      "a shell module in a page's chunk",
      bundleOf({ page: { moduleIds: [NETWORK, `${APP}/ui/charts/Plot.tsx`, `${APP}/domain/format.ts`] } }),
      /shell modules in one chunk, found them in 2 \(assets\/shell-c\.js, assets\/net\.network-e\.js\)/,
    ],
    ["the shell modules in a chunk of another name", bundleOf({ shell: { name: "vendor" } }), /holds the shell modules, assets\/shell-c\.js, is named vendor, not shell/],
    ["no chunk of the client entry", bundleOf({ entry: null }), /one chunk of the client entry .*found 0/],
    // The facade case: the entry's chunk only re-exports, and the entry module is in the shell chunk, which the root route imports.
    [
      "an entry chunk that is a facade, the entry module in shell",
      bundleOf({ entry: { moduleIds: [] }, shell: { moduleIds: [...SHELL_IDS, ENTRY] } }),
      /entry's chunk assets\/entry\.client-a\.js must hold the entry module and nothing else; it holds no module/,
    ],
    [
      "an entry chunk without the entry module",
      bundleOf({ entry: { moduleIds: [`${NM}/@react-router/dev/dist/other.js`] } }),
      /must hold the entry module and nothing else; it holds .*\/@react-router\/dev\/dist\/other\.js$/,
    ],
    [
      "an entry chunk that holds another module",
      bundleOf({ entry: { moduleIds: [ENTRY, `${NM}/@react-router/dev/dist/other.js`] } }),
      /must hold the entry module and nothing else; it holds .*entry\.client\.tsx, .*other\.js$/,
    ],
    ["the entry module in shell too", bundleOf({ shell: { moduleIds: [...SHELL_IDS, ENTRY] } }), /assets\/shell-c\.js hold the client entry module too/],
    [
      "an entry chunk that the root route imports",
      bundleOf({ root: { imports: ["assets/shell-c.js", "assets/entry.client-a.js"] } }),
      /assets\/root-d\.js import the client entry's chunk/,
    ],
    ["an entry chunk that a page's chunk imports", bundleOf({ page: { imports: ["assets/entry.client-a.js"] } }), /assets\/net\.network-e\.js import the client entry's chunk/],
  ] as const)("throws on %s", (_case, bundle, message) => {
    expect(() => checkShellBundle(bundle, MODULES)).toThrow(message);
  });

  it("passes a build where a page's own module makes another chunk named shell or vendor (Rolldown names a chunk after its module's file)", () => {
    const bundle = bundleOf({}, [
      { name: "shell", fileName: "assets/shell-p.js", moduleIds: [`${APP}/ui/pages/shell.tsx`], imports: ["assets/shell-c.js"] },
      { name: "vendor", fileName: "assets/vendor-q.js", moduleIds: [`${NM}/qr-only-one-page/vendor.js`] },
    ]);
    bundle["assets/shell-z.css"] = { type: "asset", fileName: "assets/shell-z.css" };
    expect(Object.values(bundle).filter((file) => file.type === "chunk" && file.name === "shell")).toHaveLength(2);
    expect(() => checkShellBundle(bundle, MODULES)).not.toThrow();
  });
});

describe("shellManifestProblems", () => {
  const manifest = (rootImports: string[], entryImports: string[]): ShellManifest => ({
    entry: { imports: entryImports },
    routes: { root: { imports: rootImports }, "routes/net": { imports: ["/assets/shell-Ab_1.js"] } },
  });
  const GOOD = manifest(["/assets/rolldown-runtime-x.js", "/assets/shell-BZb_3W.js"], ["/assets/rolldown-runtime-x.js", "/assets/shell-BZb_3W.js"]);
  const WHERE = "the shell chunk of scripts/shell-chunks.ts is not in this build";

  it("is empty when the root route imports one shell chunk and no vendor chunk, and the entry imports that shell chunk", () => {
    expect(shellManifestProblems(GOOD)).toEqual([]);
  });

  it("names each thing that is wrong: no shell chunk, two, a vendor chunk beside it, the entry's import of it", () => {
    // A build from before the shell chunk: nine chunks of other names.
    const before = manifest(["/assets/react-a.js", "/assets/format-b.js", "/assets/Shell-c.js"], ["/assets/react-a.js"]);
    expect(shellManifestProblems(before)).toEqual([`the root route imports 0 shell-*.js chunks, not one: ${WHERE}`]);
    // A build of the layout before R18: the packages in a vendor chunk, which the entry imports.
    expect(shellManifestProblems(manifest(["/assets/vendor-a.js", "/assets/shell-c.js"], ["/assets/vendor-a.js"]))).toEqual([
      `the root route imports /assets/vendor-a.js: the packages belong in the shell chunk, and ${WHERE}`,
      `the entry does not import /assets/shell-c.js: ${WHERE}`,
    ]);
    expect(shellManifestProblems(manifest(["/assets/shell-a.js", "/assets/shell-b.js"], ["/assets/shell-a.js"]))).toEqual([expect.stringMatching(/2 shell-\*\.js chunks/)]);
    expect(shellManifestProblems(manifest(["/assets/shell-c.js"], ["/assets/shell-other.js"]))).toEqual([expect.stringMatching(/the entry does not import \/assets\/shell-c\.js/)]);
    expect(shellManifestProblems({ entry: {}, routes: {} })).toEqual([expect.stringMatching(/0 shell-\*\.js chunks/)]);
  });

  it("reads a file name by its dots: a name with another character where the dot is, or another extension, is not one", () => {
    expect(shellManifestProblems(manifest(["/assets/shell-cXjs"], ["/assets/shell-cXjs"]))).toEqual([expect.stringMatching(/0 shell-/)]);
    expect(shellManifestProblems(manifest(["/assets/shell-c.css"], []))).toEqual([expect.stringMatching(/0 shell-/)]);
    expect(shellManifestProblems(manifest(["/assets/vendor-aXjs", "/assets/shell-c.js"], ["/assets/shell-c.js"]))).toEqual([]);
  });
});
