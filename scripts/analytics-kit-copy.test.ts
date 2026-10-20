import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { valueImports } from "../test/support/value-imports";
import { analyticsKitCopy, checkKitCopyBundle, isKitModule, KIT_COPY, kitCopyId, kitCopyOf, type KitGraph } from "./analytics-kit-copy";
import type { BundleFile } from "./shell-chunks";

const APP = "/repo/app";
const NM = "/repo/node_modules/.pnpm/x/node_modules";
const REACT = `${NM}/react/index.js`;
const ui = (file: string) => `${APP}/ui/${file}`;
const VIEW = ui("pages/AccountAnalytics.tsx");
const PAGE = ui("pages/AccountPage.tsx");
const NETWORK = ui("pages/NetworkPage.tsx");
const DATA_TABLE = ui("components/DataTable.tsx");
const ICONS = ui("components/icons.tsx");
const FORMAT = `${APP}/domain/format.ts`;
const CONTEXTS = "const TipSlotContext = createContext(null);\nconst HoverContext = createContext(null);";

interface FakeModule {
  importedIds?: string[];
  dynamicallyImportedIds?: string[];
  code?: string;
}

/** A module graph from `id: module`, as `this.getModuleInfo` reads it at the end of the build. */
function graphOf(modules: Record<string, FakeModule>): KitGraph {
  return {
    ids: Object.keys(modules),
    info: (id) => (id in modules ? { importedIds: modules[id]!.importedIds ?? [], dynamicallyImportedIds: modules[id]!.dynamicallyImportedIds ?? [], code: modules[id]!.code ?? "" } : null),
  };
}

/** The kit's modules that the view and the network page draw with: as they are (`""`), or the view's copies (`KIT_COPY`), each importing its own kind. */
function kitOf(q: "" | typeof KIT_COPY): Record<string, FakeModule> {
  return {
    [ui(`charts/LineChart.tsx${q}`)]: { importedIds: [ui(`charts/Plot.tsx${q}`), ui(`charts/geometry.ts${q}`), REACT] },
    [ui(`charts/Plot.tsx${q}`)]: { importedIds: [ui(`charts/Cursor.tsx${q}`), ui(`charts/geometry.ts${q}`), REACT] },
    [ui(`charts/Cursor.tsx${q}`)]: { importedIds: [ui(`use-hydrated.ts${q}`), REACT], code: CONTEXTS },
    [ui(`charts/geometry.ts${q}`)]: {},
    [ui(`charts/ChartTable.tsx${q}`)]: { importedIds: [DATA_TABLE] },
    [ui(`use-hydrated.ts${q}`)]: { importedIds: [REACT] },
    [ui(`components/StatTile.tsx${q}`)]: { importedIds: [ICONS] },
  };
}

const COPIES = Object.keys(kitOf(KIT_COPY));
const ORIGINALS = Object.keys(kitOf(""));

/** The graph as the plugin makes it: the account page imports the view with import(); the view and the network page draw with the kit. */
const MODULES: Record<string, FakeModule> = {
  [PAGE]: { importedIds: [DATA_TABLE, REACT], dynamicallyImportedIds: [VIEW] },
  [VIEW]: { importedIds: [ui(`charts/LineChart.tsx${KIT_COPY}`), ui(`charts/ChartTable.tsx${KIT_COPY}`), ui(`components/StatTile.tsx${KIT_COPY}`), DATA_TABLE, REACT] },
  [NETWORK]: { importedIds: [ui("charts/LineChart.tsx"), ui("charts/ChartTable.tsx"), ui("components/StatTile.tsx"), REACT] },
  [DATA_TABLE]: { importedIds: [FORMAT, REACT] },
  [ICONS]: {},
  [FORMAT]: {},
  [REACT]: {},
  ...kitOf(""),
  ...kitOf(KIT_COPY),
};

/** MODULES with some modules replaced (`null` takes one out). */
const changed = (change: Record<string, FakeModule | null>) =>
  graphOf(Object.fromEntries(Object.entries({ ...MODULES, ...change }).filter((entry): entry is [string, FakeModule] => entry[1] !== null)));

describe("the kit that the analytics view copies", () => {
  it("is app/ui/charts/* but types.ts, with app/ui/use-hydrated.ts and app/ui/components/StatTile.tsx, as they are and as copies", () => {
    for (const id of [ui("charts/Plot.tsx"), ui("charts/geometry.ts"), ui("charts/Cursor.tsx"), ui("use-hydrated.ts"), ui("components/StatTile.tsx"), ...COPIES]) {
      expect(isKitModule(id, APP), id).toBe(true);
    }
    for (const id of [
      ui("charts/types.ts"),
      ui("charts/Plot.test.tsx"),
      ui("charts/deeper/Thing.tsx"),
      ui("charts.css"),
      DATA_TABLE,
      VIEW,
      REACT,
      "/elsewhere/app/ui/charts/Plot.tsx",
      `${NM}/x/app/ui/charts/Plot.tsx`,
    ]) {
      expect(isKitModule(id, APP), id).toBe(false);
    }
  });

  it("reads an app directory with a trailing slash", () => {
    expect(isKitModule(ui("charts/Plot.tsx"), `${APP}/`)).toBe(true);
  });
});

describe("kitCopyId: what an import resolves to", () => {
  it("is the copy of a module of the kit, for the view and for a copy", () => {
    expect(kitCopyId(ui("charts/LineChart.tsx"), VIEW, APP)).toBe(ui(`charts/LineChart.tsx${KIT_COPY}`));
    expect(kitCopyId(ui("use-hydrated.ts"), ui(`charts/Cursor.tsx${KIT_COPY}`), APP)).toBe(ui(`use-hydrated.ts${KIT_COPY}`));
  });

  it("is the module itself for what is not the kit, for an importer that is neither, and for a module with a query of its own", () => {
    expect(kitCopyId(DATA_TABLE, VIEW, APP)).toBe(DATA_TABLE);
    expect(kitCopyId(REACT, ui(`charts/Plot.tsx${KIT_COPY}`), APP)).toBe(REACT);
    expect(kitCopyId(ui("charts/LineChart.tsx"), NETWORK, APP)).toBe(ui("charts/LineChart.tsx"));
    expect(kitCopyId(ui("charts/Cursor.tsx"), ui("charts/Plot.tsx"), APP)).toBe(ui("charts/Cursor.tsx"));
    // DataTable is not the kit, so what it imports is never copied: the view would load that module itself (kitCopyOf says so).
    expect(kitCopyId(ui("use-hydrated.ts"), DATA_TABLE, APP)).toBe(ui("use-hydrated.ts"));
    expect(kitCopyId(`${ui("charts/Plot.tsx")}?raw`, VIEW, APP)).toBe(`${ui("charts/Plot.tsx")}?raw`);
    expect(kitCopyId(ui(`charts/Plot.tsx${KIT_COPY}`), VIEW, APP)).toBe(ui(`charts/Plot.tsx${KIT_COPY}`));
  });
});

describe("kitCopyOf: the module graph at the end of the client build", () => {
  it("passes the graph the plugin makes, and names the view and the copies it reaches", () => {
    const kit = kitCopyOf(graphOf(MODULES), APP);
    expect(kit.view).toBe(VIEW);
    expect([...kit.copies].sort()).toEqual([...COPIES].sort());
  });

  it.each([
    [
      "the view was renamed (the analytics entry cannot be found)",
      changed({ [VIEW]: null, [ui("pages/AccountStats.tsx")]: MODULES[VIEW]!, [PAGE]: { ...MODULES[PAGE], dynamicallyImportedIds: [ui("pages/AccountStats.tsx")] } }),
      /expected the analytics view \/repo\/app\/ui\/pages\/AccountAnalytics\.tsx in the client build once, found it 0 times/,
    ],
    [
      "the kit's directory was renamed (the kit it copies cannot be found)",
      changed({
        [VIEW]: { importedIds: [ui("chart-kit/LineChart.tsx"), ui(`components/StatTile.tsx${KIT_COPY}`), REACT] },
        [ui("chart-kit/LineChart.tsx")]: { importedIds: [REACT] },
      }),
      /the analytics view loads no copy of the chart kit \(\/repo\/app\/ui\/charts\/\)/,
    ],
    [
      "StatTile.tsx was renamed",
      changed({
        [ui("components/StatTile.tsx")]: null,
        [ui(`components/StatTile.tsx${KIT_COPY}`)]: null,
        [ui("components/Stat.tsx")]: { importedIds: [ICONS] },
        [VIEW]: { importedIds: [ui(`charts/LineChart.tsx${KIT_COPY}`), ui("components/Stat.tsx"), REACT] },
        [NETWORK]: { importedIds: [ui("charts/LineChart.tsx"), ui("components/Stat.tsx"), REACT] },
      }),
      /\/repo\/app\/ui\/components\/StatTile\.tsx, a module of the kit, is not in the client build/,
    ],
    [
      "use-hydrated.ts was renamed",
      changed({
        [ui("use-hydrated.ts")]: null,
        [ui(`use-hydrated.ts${KIT_COPY}`)]: null,
        [ui("hydrated.ts")]: {},
        [ui("charts/Cursor.tsx")]: { importedIds: [ui("hydrated.ts")], code: CONTEXTS },
        [ui(`charts/Cursor.tsx${KIT_COPY}`)]: { importedIds: [ui("hydrated.ts")], code: CONTEXTS },
      }),
      /\/repo\/app\/ui\/use-hydrated\.ts, a module of the kit, is not in the client build/,
    ],
    [
      "the view imports a module of the kit itself (the copy was not made)",
      changed({ [VIEW]: { importedIds: [ui("charts/LineChart.tsx"), ui(`components/StatTile.tsx${KIT_COPY}`), ui(`charts/ChartTable.tsx${KIT_COPY}`)] } }),
      /the analytics view loads \/repo\/app\/ui\/charts\/LineChart\.tsx itself, imported by \/repo\/app\/ui\/pages\/AccountAnalytics\.tsx, and not its own copy/,
    ],
    [
      "a module outside the kit that the view loads imports the kit (the view would load that module twice)",
      changed({ [DATA_TABLE]: { importedIds: [FORMAT, ui("use-hydrated.ts")] } }),
      /the analytics view loads \/repo\/app\/ui\/use-hydrated\.ts itself, imported by \/repo\/app\/ui\/components\/DataTable\.tsx, and not its own copy/,
    ],
    [
      "the page the view is drawn in loads the kit too",
      changed({ [PAGE]: { importedIds: [DATA_TABLE, ui("components/StatTile.tsx")], dynamicallyImportedIds: [VIEW] } }),
      /the page that imports the analytics view, \/repo\/app\/ui\/pages\/AccountPage\.tsx, loads \/repo\/app\/ui\/components\/StatTile\.tsx/,
    ],
    [
      "a module outside the kit imports the kit's React contexts (it could provide one around the view or read one inside it)",
      changed({ [NETWORK]: { importedIds: [ui("charts/LineChart.tsx"), ui("charts/Cursor.tsx")] } }),
      /\/repo\/app\/ui\/pages\/NetworkPage\.tsx imports \/repo\/app\/ui\/charts\/Cursor\.tsx, which creates a React context of the kit/,
    ],
    [
      "a module of the kit that is not a copy imports a copy (the copies would be shared)",
      changed({ [ui("charts/LineChart.tsx")]: { importedIds: [ui(`charts/Plot.tsx${KIT_COPY}`), ui("charts/geometry.ts")] } }),
      /\/repo\/app\/ui\/charts\/LineChart\.tsx imports the analytics view's copy \/repo\/app\/ui\/charts\/Plot\.tsx\?analytics-kit/,
    ],
  ])("throws when %s", (_case, graph, message) => {
    expect(() => kitCopyOf(graph, APP)).toThrow(message);
  });

  it("finds the kit's contexts by what a module of the kit does: a new createContext elsewhere in the kit is held to the same rule", () => {
    const graph = changed({
      [ui("charts/Legend.tsx")]: { code: "export const LegendContext = React.createContext(null);" },
      [NETWORK]: { importedIds: [ui("charts/LineChart.tsx"), ui("charts/Legend.tsx")] },
    });
    expect(() => kitCopyOf(graph, APP)).toThrow(/NetworkPage\.tsx imports \/repo\/app\/ui\/charts\/Legend\.tsx, which creates a React context of the kit/);
    // A module outside the kit with a context of its own is not the kit's.
    expect(() => kitCopyOf(changed({ [DATA_TABLE]: { importedIds: [FORMAT], code: CONTEXTS }, [NETWORK]: { importedIds: [DATA_TABLE] } }), APP)).not.toThrow();
  });
});

type FakeChunk = Partial<Extract<BundleFile, { type: "chunk" }>>;

const ANALYTICS_IDS = [VIEW, ...COPIES];

/** A bundle as the plugin makes it: the view's chunk holds the view and every copy, and imports chunks without the kit; `change` replaces fields of a chunk (`null` takes it out). */
function bundleOf(change: Partial<Record<"analytics" | "account" | "network" | "table" | "vendor", FakeChunk | null>> = {}, extra: FakeChunk[] = []) {
  const base = {
    analytics: { name: "AccountAnalytics", fileName: "assets/AccountAnalytics-a.js", moduleIds: ANALYTICS_IDS, facadeModuleId: VIEW, imports: ["assets/DataTable-b.js", "assets/vendor-c.js"] },
    account: { name: "net.account._address", fileName: "assets/net.account._address-d.js", moduleIds: [PAGE], facadeModuleId: `${APP}/routes/net.account.$address.tsx?__react-router-build-client-route`, imports: ["assets/DataTable-b.js", "assets/vendor-c.js"] },
    network: { name: "net.network", fileName: "assets/net.network-e.js", moduleIds: [NETWORK, ...ORIGINALS], facadeModuleId: `${APP}/routes/net.network.tsx?__react-router-build-client-route`, imports: ["assets/DataTable-b.js", "assets/vendor-c.js"] },
    table: { name: "DataTable", fileName: "assets/DataTable-b.js", moduleIds: [DATA_TABLE, FORMAT, ICONS], facadeModuleId: null, imports: ["assets/vendor-c.js"] },
    vendor: { name: "vendor", fileName: "assets/vendor-c.js", moduleIds: [REACT], facadeModuleId: null, imports: [] },
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

describe("checkKitCopyBundle: the bundle", () => {
  const kit = kitCopyOf(graphOf(MODULES), APP);
  const network = ORIGINALS.filter((id) => !id.includes("LineChart"));

  it("passes the bundle the plugin makes: the view and its copies in its chunk, which imports no chunk that holds the kit", () => {
    expect(() => checkKitCopyBundle(bundleOf(), kit, APP)).not.toThrow();
  });

  it.each([
    ["no chunk of the view (it is in its importer's chunk)", bundleOf({ analytics: null, account: { moduleIds: [PAGE, ...ANALYTICS_IDS] } }), /expected one chunk of the analytics view .*AccountAnalytics\.tsx\), found 0/],
    [
      "a copy in another chunk too",
      bundleOf({ analytics: { moduleIds: ANALYTICS_IDS.filter((id) => !id.includes("geometry")) } }, [{ name: "geometry", fileName: "assets/geometry-g.js", moduleIds: [ui(`charts/geometry.ts${KIT_COPY}`)] }]),
      /the copies of the kit must be in the analytics chunk assets\/AccountAnalytics-a\.js alone; assets\/geometry-g\.js holds \/repo\/app\/ui\/charts\/geometry\.ts\?analytics-kit/,
    ],
    [
      "a module of the kit itself in the analytics chunk",
      bundleOf({ analytics: { moduleIds: [...ANALYTICS_IDS, ui("charts/Plot.tsx")] }, network: { moduleIds: [NETWORK, ...ORIGINALS.filter((id) => !id.includes("Plot"))] } }),
      /the analytics chunk assets\/AccountAnalytics-a\.js holds \/repo\/app\/ui\/charts\/Plot\.tsx, not its copy/,
    ],
    [
      "an import of the chunk the network page shares the kit in",
      bundleOf(
        { analytics: { imports: ["assets/DataTable-b.js", "assets/vendor-c.js", "assets/LineChart-h.js"] }, network: { moduleIds: [NETWORK, ...network], imports: ["assets/LineChart-h.js"] } },
        [{ name: "LineChart", fileName: "assets/LineChart-h.js", moduleIds: [ui("charts/LineChart.tsx")], imports: ["assets/vendor-c.js"] }],
      ),
      /the analytics chunk assets\/AccountAnalytics-a\.js imports assets\/LineChart-h\.js, which holds \/repo\/app\/ui\/charts\/LineChart\.tsx/,
    ],
    [
      "such an import through another chunk",
      bundleOf({ table: { imports: ["assets/vendor-c.js", "assets/LineChart-h.js"] }, network: { moduleIds: [NETWORK, ...network] } }, [
        { name: "LineChart", fileName: "assets/LineChart-h.js", moduleIds: [ui("charts/LineChart.tsx")] },
      ]),
      /imports assets\/LineChart-h\.js, which holds \/repo\/app\/ui\/charts\/LineChart\.tsx/,
    ],
  ] as const)("throws on %s", (_case, bundle, message) => {
    expect(() => checkKitCopyBundle(bundle, kit, APP)).toThrow(message);
  });
});

describe("analyticsKitCopy: the plugin", () => {
  const plugin = analyticsKitCopy({ appDirectory: APP });

  it("is for the build of the client only, and resolves before the other plugins", () => {
    expect(plugin.name).toBe("x-explorer:analytics-kit-copy");
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("pre");
    const applies = plugin.applyToEnvironment as (environment: { name: string }) => boolean;
    expect(applies({ name: "client" })).toBe(true);
    expect(applies({ name: "ssr" })).toBe(false);
  });

  type Resolved = { id: string; external?: boolean } | null;
  const resolveId = plugin.resolveId as (this: unknown, source: string, importer: string | undefined, options: object) => Promise<Resolved>;
  /** The hook's context: `this.resolve` answers what the other resolvers would (a path below the importer's directory), and remembers what it was asked. */
  function context(answers: Record<string, Resolved>) {
    const asked: [string, string | undefined, object][] = [];
    return {
      asked,
      environment: { name: "client" },
      resolve: async (source: string, importer: string | undefined, options: object) => {
        asked.push([source, importer, options]);
        return answers[source] ?? null;
      },
    };
  }

  it("resolves what the view and its copies import of the kit to the copies, and the rest as the other resolvers do", async () => {
    const ctx = context({ "../charts/LineChart": { id: ui("charts/LineChart.tsx") }, "./Plot": { id: ui("charts/Plot.tsx") }, react: { id: REACT }, "x-cdn": { id: "x-cdn", external: true } });
    expect(await resolveId.call(ctx, "../charts/LineChart", VIEW, { isEntry: false })).toEqual({ id: ui(`charts/LineChart.tsx${KIT_COPY}`) });
    expect(await resolveId.call(ctx, "./Plot", ui(`charts/LineChart.tsx${KIT_COPY}`), {})).toEqual({ id: ui(`charts/Plot.tsx${KIT_COPY}`) });
    expect(await resolveId.call(ctx, "react", ui(`charts/Plot.tsx${KIT_COPY}`), {})).toEqual({ id: REACT });
    expect(await resolveId.call(ctx, "x-cdn", VIEW, {})).toEqual({ id: "x-cdn", external: true });
    expect(await resolveId.call(ctx, "missing", VIEW, {})).toBeNull();
    // The other resolvers are asked from the file itself, without the query, and without this plugin.
    expect(ctx.asked[0]).toEqual(["../charts/LineChart", VIEW, { isEntry: false, skipSelf: true }]);
    expect(ctx.asked[1]![1]).toBe(ui("charts/LineChart.tsx"));
  });

  it("leaves every other importer to the other resolvers", async () => {
    const ctx = context({ "./Plot": { id: ui("charts/Plot.tsx") } });
    expect(await resolveId.call(ctx, "./Plot", ui("charts/LineChart.tsx"), {})).toBeNull();
    expect(await resolveId.call(ctx, "../charts/LineChart", NETWORK, {})).toBeNull();
    expect(await resolveId.call(ctx, "/app/entry.client.tsx", undefined, {})).toBeNull();
    expect(ctx.asked).toEqual([]);
  });

  // The hooks as the bundler calls them, with the little of their context that the plugin reads.
  type Hook = (this: unknown, ...args: unknown[]) => void;
  const client = (graph: KitGraph) => ({ environment: { name: "client" }, getModuleIds: () => graph.ids, getModuleInfo: (id: string) => graph.info(id) });

  it("checks the graph at the end of the build and the bundle it has made, in the client build: a good one passes, a bad one fails the build", () => {
    const fresh = analyticsKitCopy({ appDirectory: APP });
    expect(() => (fresh.generateBundle as Hook).call(client(graphOf(MODULES)), {}, bundleOf())).toThrow(/before the module graph was read/);
    expect(() => (fresh.buildEnd as Hook).call(client(changed({ [VIEW]: null })))).toThrow(/found it 0 times/);
    (fresh.buildEnd as Hook).call(client(graphOf(MODULES)));
    expect(() => (fresh.generateBundle as Hook).call(client(graphOf(MODULES)), {}, bundleOf())).not.toThrow();
    expect(() => (fresh.generateBundle as Hook).call(client(graphOf(MODULES)), {}, bundleOf({ analytics: null }))).toThrow(/found 0/);
    // A build that failed is not looked at, and the Worker's build is not either (the plugin is not applied to it; were it called, it would say nothing).
    expect(() => (fresh.buildEnd as Hook).call(client(changed({ [VIEW]: null })), new Error("syntax"))).not.toThrow();
    expect(() => (fresh.buildEnd as Hook).call({ environment: { name: "ssr" } })).not.toThrow();
    expect(() => (fresh.generateBundle as Hook).call({ environment: { name: "ssr" } }, {}, {})).not.toThrow();
  });
});

// ---- The app's own modules ---------------------------------------------------------------------------------------------------------

const appDirectory = fileURLToPath(new URL("../app", import.meta.url));
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/**
 * The app's module graph as the client build reads it with the plugin, made from the sources: each module's static and dynamic relative
 * value imports, resolved to files as the build does (a package is a module of no file; stylesheets and assets are left out), and to the view's copies
 * where the plugin resolves them so (`kitCopyId`). It has every module of the app, and the copies the view reaches.
 */
function sourceGraph(): KitGraph {
  const modules = new Map<string, Required<FakeModule>>();
  const resolve = (from: string, importer: string) => {
    if (!from.startsWith(".")) return from;
    const base = posix.join(dirname(importer.split("?")[0]!), from);
    const file = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((path) => /\.tsx?$/.test(path) && existsSync(path));
    // A file that is not code (the image renderer's fonts, `.bin`) is a module of its own that imports nothing.
    if (file === undefined && existsSync(base) && !/\.[cm]?[jt]sx?$/.test(base)) return base;
    if (file === undefined) throw new Error(`${importer} imports ${from}, which is no file of the app`);
    return kitCopyId(file, importer, appDirectory);
  };
  const visit = (id: string) => {
    if (modules.has(id) || !/\.tsx?$/.test(id.split("?")[0]!)) return;
    const code = readFileSync(id.split("?")[0]!, "utf8");
    // A stylesheet, and an asset imported for its URL (`styles.css?url`, the fonts), are no modules of code.
    const relative = (froms: string[]) => froms.filter((from) => !from.endsWith(".css") && !from.includes("?")).map((from) => resolve(from, id));
    const module = {
      importedIds: relative(valueImports(code.replace(DYNAMIC, ""))),
      dynamicallyImportedIds: relative([...code.matchAll(DYNAMIC)].map((match) => match[1]!)),
      code,
    };
    modules.set(id, module);
    for (const next of [...module.importedIds, ...module.dynamicallyImportedIds]) visit(next);
  };
  for (const file of readdirSync(appDirectory, { recursive: true, encoding: "utf8" })) {
    if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith(".d.ts")) visit(join(appDirectory, file));
  }
  return { ids: [...modules.keys()], info: (id) => modules.get(id) ?? null };
}

describe("the app's own modules, as the plugin copies them", () => {
  const graph = sourceGraph();

  it("pass the check of the build: the view loads the kit only as its copy, the account page none of it, and only the kit uses its contexts", () => {
    const kit = kitCopyOf(graph, appDirectory);
    const copied = [...kit.copies].map((id) => id.slice(appDirectory.length + 1)).sort();
    expect(copied).toEqual(expect.arrayContaining(["ui/charts/ChartCard.tsx?analytics-kit", "ui/charts/Cursor.tsx?analytics-kit", "ui/charts/Plot.tsx?analytics-kit", "ui/components/StatTile.tsx?analytics-kit", "ui/use-hydrated.ts?analytics-kit"]));
    expect(copied.every((id) => id.endsWith(KIT_COPY))).toBe(true);
  });

  it("have two React contexts in the kit, Cursor.tsx's TipSlotContext and HoverContext, and every module that uses them is the kit's", () => {
    const kitFiles = [...graph.ids].filter((id) => !id.includes("?") && isKitModule(id, appDirectory));
    const withContexts = kitFiles.filter((id) => /\bcreateContext\b/.test(graph.info(id)!.code ?? ""));
    expect(withContexts.map((id) => id.slice(appDirectory.length + 1))).toEqual(["ui/charts/Cursor.tsx"]);
    expect([...graph.info(withContexts[0]!)!.code!.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*createContext\b/g)].map((match) => match[1])).toEqual(["TipSlotContext", "HoverContext"]);
    const users = [...graph.ids].filter((id) => !id.includes("?") && graph.info(id)!.importedIds.includes(withContexts[0]!));
    expect(users.length).toBeGreaterThan(0);
    expect(users.filter((id) => !isKitModule(id, appDirectory))).toEqual([]);
  });

  it("keep no state of their own in the kit: no module of it has a top-level let or var, so two copies hold nothing two ways", () => {
    const kitFiles = [...graph.ids].filter((id) => !id.includes("?") && isKitModule(id, appDirectory));
    expect(kitFiles.length).toBeGreaterThan(10);
    expect(kitFiles.filter((id) => /^(?:export\s+)?(?:let|var)\s/m.test(graph.info(id)!.code ?? ""))).toEqual([]);
  });
});
