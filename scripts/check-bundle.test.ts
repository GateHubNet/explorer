import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { BUDGET_BYTES, checkBundle, FORBIDDEN, formatReport, headersRules, PAGES } from "./bundle-budget";

// A fake client build: the files `react-router build` writes to build/client, with a manifest whose routes are the pages' and
// whose chunks are bytes of no pattern (they do not compress, so a chunk's gzipped size is known to within a few bytes).

/** The route manifest of the fake build: every page loads it. */
const MANIFEST = "manifest-abc123.js";

const IMMUTABLE_HEADERS = "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n";

interface FakeChunk {
  /** The file name below assets/. */
  name: string;
  /** Raw bytes, random unless `text` is given. */
  size?: number;
  text?: string;
}

interface FakeRoute {
  id: string;
  parentId?: string;
  module: string;
  imports?: string[];
}

/** Bytes that do not compress, the same every time (a generator of a seed): the gzipped size of a chunk is then known to within a few bytes, and repeatable. */
function incompressible(size: number, seed: number): Buffer {
  const bytes = Buffer.alloc(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The gzipped size of the file as the check measures it. */
const gz = (content: Buffer | string) => gzipSync(content, { level: 9 }).length;

function fakeBuild(options: {
  chunks: FakeChunk[];
  routes: FakeRoute[];
  entry?: { module: string; imports?: string[] };
  headers?: string | null;
  extra?: Record<string, string | Buffer>;
  manifest?: boolean;
  /** The two chunks every page loads (scripts/shell-chunks.ts): the root route imports `vendor` and `shell`, the entry `vendor`. */
  shell?: boolean;
}): { dir: string; sizes: Map<string, number> } {
  if (options.shell) {
    const { routes, entry } = options;
    options = {
      ...options,
      chunks: [...options.chunks, { name: "vendor-abc123.js", size: 900 }, { name: "shell-abc123.js", size: 800 }],
      routes: routes.map((route) => (route.id === "root" ? { ...route, imports: [...(route.imports ?? []), "vendor-abc123.js", "shell-abc123.js"] } : route)),
      entry: { module: entry?.module ?? "entry.js", imports: [...(entry?.imports ?? []), "vendor-abc123.js"] },
    };
  }
  const dir = mkdtempSync(join(tmpdir(), "t15b-check-bundle-"));
  dirs.push(dir);
  mkdirSync(join(dir, "assets"));
  const sizes = new Map<string, number>();
  for (const chunk of options.chunks) {
    const content = chunk.text ?? incompressible(chunk.size ?? 100, [...chunk.name].reduce((hash, char) => hash * 31 + char.charCodeAt(0), 7));
    writeFileSync(join(dir, "assets", chunk.name), content);
    sizes.set(chunk.name, gz(content));
  }
  if (options.manifest !== false) {
    const manifest = {
      entry: { module: `/assets/${options.entry?.module ?? "entry.js"}`, imports: (options.entry?.imports ?? []).map((n) => `/assets/${n}`), css: [] },
      routes: Object.fromEntries(
        options.routes.map((route) => [
          route.id,
          { id: route.id, parentId: route.parentId, module: `/assets/${route.module}`, imports: (route.imports ?? []).map((n) => `/assets/${n}`), css: [] },
        ]),
      ),
      url: "/assets/manifest-abc123.js",
      version: "abc123",
    };
    const text = `window.__reactRouterManifest=${JSON.stringify(manifest)};`;
    writeFileSync(join(dir, "assets", MANIFEST), text);
    sizes.set(MANIFEST, gz(text));
  }
  if (options.headers !== null) writeFileSync(join(dir, "_headers"), options.headers ?? IMMUTABLE_HEADERS);
  for (const [path, content] of Object.entries(options.extra ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return { dir, sizes };
}

const ROUTES: FakeRoute[] = [
  { id: "root", module: "root.js", imports: ["shared.js"] },
  { id: "routes/net", parentId: "root", module: "net.js", imports: ["shared.js", "shell.js"] },
  { id: "routes/net._index", parentId: "routes/net", module: "home.js", imports: ["shared.js", "table.js"] },
  { id: "routes/net.ledger.$id", parentId: "routes/net", module: "ledger.js", imports: ["shared.js", "table.js"] },
  { id: "routes/net.tx.$id", parentId: "routes/net", module: "tx.js", imports: ["shared.js"] },
  { id: "routes/net.account.$address", parentId: "routes/net", module: "account.js", imports: ["shared.js", "table.js", "qr-picture.js"] },
  { id: "routes/net.network", parentId: "routes/net", module: "network.js", imports: ["shared.js", "charts.js"] },
  // No heavier than home's: the 150,000 B pin test sizes the home page to the limit and needs it to be the heaviest page of the build.
  { id: "routes/net.markets", parentId: "routes/net", module: "markets.js", imports: ["shared.js", "table.js"] },
  { id: "routes/net.validators", parentId: "routes/net", module: "validators.js", imports: ["shared.js", "table.js"] },
  { id: "routes/net.validators.$key", parentId: "routes/net", module: "validator.js", imports: ["shared.js", "table.js"] },
  // Not one of the pages: its chunk is loaded only when somebody goes there.
  { id: "routes/net.search", parentId: "routes/net", module: "search.js", imports: ["shared.js", "search-page.js"] },
];
const CHUNKS: FakeChunk[] = [
  { name: "entry.js", size: 3000 },
  { name: "root.js", size: 2000 },
  { name: "net.js", size: 1500 },
  { name: "shared.js", size: 10_000 },
  { name: "shell.js", size: 4000 },
  { name: "table.js", size: 2500 },
  { name: "home.js", size: 1000 },
  { name: "ledger.js", size: 1100 },
  { name: "tx.js", size: 1200 },
  { name: "account.js", size: 1300 },
  { name: "network.js", size: 1400 },
  { name: "markets.js", size: 1500 },
  { name: "validators.js", size: 1600 },
  { name: "validator.js", size: 1700 },
  { name: "charts.js", size: 6000 },
  { name: "qr-picture.js", size: 700 },
  { name: "search.js", size: 500 },
  { name: "search-page.js", size: 50_000 },
];

describe("the pages", () => {
  it("are home, ledger, transaction, account, network, markets, validators and validator, by their routes", () => {
    expect(PAGES).toEqual([
      { name: "home", route: "routes/net._index" },
      { name: "ledger", route: "routes/net.ledger.$id" },
      { name: "transaction", route: "routes/net.tx.$id" },
      { name: "account", route: "routes/net.account.$address" },
      { name: "network", route: "routes/net.network" },
      { name: "markets", route: "routes/net.markets" },
      { name: "validators", route: "routes/net.validators" },
      { name: "validator", route: "routes/net.validators.$key" },
    ]);
  });

  it("have a budget of 150 KB", () => {
    expect(BUDGET_BYTES).toBe(150_000);
  });
});

describe("checkBundle: what a page loads", () => {
  it("adds up, gzipped, the entry, the root, the layout and the route with every chunk they import, each chunk once", () => {
    const { dir, sizes } = fakeBuild({ chunks: CHUNKS, routes: ROUTES, entry: { module: "entry.js", imports: ["shared.js"] } });
    const report = checkBundle(dir);
    expect(report.problems).toEqual([]);

    const sum = (names: string[]) => names.reduce((total, name) => total + sizes.get(name)!, 0);
    // The route manifest is one of the files every page loads, and counts like the others.
    const common = ["entry.js", "root.js", "net.js", "shared.js", "shell.js", MANIFEST];
    const byPage = Object.fromEntries(report.pages.map((page) => [page.name, page]));
    expect(Object.keys(byPage)).toEqual(["home", "ledger", "transaction", "account", "network", "markets", "validators", "validator"]);
    expect(byPage.home!.bytes).toBe(sum([...common, "table.js", "home.js"]));
    expect(byPage.ledger!.bytes).toBe(sum([...common, "table.js", "ledger.js"]));
    expect(byPage.transaction!.bytes).toBe(sum([...common, "tx.js"]));
    expect(byPage.account!.bytes).toBe(sum([...common, "table.js", "qr-picture.js", "account.js"]));
    expect(byPage.network!.bytes).toBe(sum([...common, "charts.js", "network.js"]));
    expect(byPage.markets!.bytes).toBe(sum([...common, "table.js", "markets.js"]));
    expect(byPage.validators!.bytes).toBe(sum([...common, "table.js", "validators.js"]));
    expect(byPage.validator!.bytes).toBe(sum([...common, "table.js", "validator.js"]));
    // The chunk of a route that is not a page, and the ones only it imports, are in none of the pages.
    expect(report.pages.flatMap((page) => page.files)).not.toContain("search-page.js");
    expect(byPage.home!.files).toEqual(expect.arrayContaining([...common, "table.js", "home.js"]));
    expect(byPage.home!.files).toHaveLength(8);
  });

  it("counts the route manifest in the figure of every page, once, and says how much it is", () => {
    const { dir, sizes } = fakeBuild({ chunks: CHUNKS, routes: ROUTES });
    const report = checkBundle(dir);
    expect(report.manifestBytes).toBe(sizes.get(MANIFEST));
    expect(report.manifestBytes).toBeGreaterThan(0);
    for (const page of report.pages) expect(page.files.filter((file) => file === MANIFEST), page.name).toHaveLength(1);
    // Without it a page is lighter by what it weighs.
    const without = report.pages.map((page) => page.bytes - report.manifestBytes);
    expect(without.every((bytes) => bytes > 0)).toBe(true);
    const table = formatReport(report);
    expect(table).toContain(MANIFEST);
    expect(table).toMatch(new RegExp(`${report.manifestBytes.toLocaleString("en-US")} bytes`));
  });

  it("holds a page to the budget with the manifest in it: a page that is under it without the manifest, and over it with it, fails", () => {
    const over = homeAt(BUDGET_BYTES + 1);
    const home = over.pages.find((page) => page.name === "home")!;
    expect(home.bytes).toBe(BUDGET_BYTES + 1);
    // Its other files alone are under the budget: it is over it by the manifest.
    expect(home.bytes - over.manifestBytes).toBeLessThan(BUDGET_BYTES);
    expect(over.problems.filter((problem) => problem.includes("the home page"))).toHaveLength(1);
  });

  it("passes a page under the budget and says so in a table", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES });
    const report = checkBundle(dir);
    const table = formatReport(report);
    expect(report.problems).toEqual([]);
    expect(table).toMatch(/home\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
    expect(table).toMatch(/account\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
    expect(table).toMatch(/network\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
    expect(table).toMatch(/markets\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
    expect(table).toMatch(/validators\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
    expect(table).toMatch(/validator\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
    expect(table).toContain("150.0 KB");
    expect(table.split("\n").filter((line) => /^\s*(home|ledger|transaction|account|network|markets|validators|validator)\s/.test(line))).toHaveLength(8);
  });

  it("fails a page over 150 KB gzipped, and only that page", () => {
    const heavy = CHUNKS.map((chunk) => (chunk.name === "ledger.js" ? { ...chunk, size: 151_000 } : chunk));
    const { dir } = fakeBuild({ chunks: heavy, routes: ROUTES });
    const report = checkBundle(dir);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/ledger/);
    expect(report.problems[0]).toMatch(/150/);
    const table = formatReport(report);
    expect(table).toMatch(/ledger\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+OVER/);
    expect(table).toMatch(/home\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
  });

  it("counts the gzipped size and not the raw one: 200 KB that compress to a few bytes are fine", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS.map((chunk) => (chunk.name === "tx.js" ? { name: "tx.js", text: "a".repeat(200_000) } : chunk)), routes: ROUTES });
    expect(checkBundle(dir).problems).toEqual([]);
  });

  /**
   * A build whose home page loads exactly `target` bytes, gzipped: the chunk every page shares carries most of it, and the home page's
   * own chunk is adjusted a byte at a time until the sum is right. (The other pages are smaller by the size of the chunk they lack.)
   */
  function homeAt(target: number) {
    let shared = 120_000;
    let home = 5000;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const chunks = CHUNKS.map((chunk) => (chunk.name === "shared.js" ? { ...chunk, size: shared } : chunk.name === "home.js" ? { ...chunk, size: home } : chunk));
      const { dir } = fakeBuild({ chunks, routes: ROUTES });
      const report = checkBundle(dir);
      const bytes = report.pages.find((page) => page.name === "home")!.bytes;
      if (bytes === target) return report;
      const delta = target - bytes;
      if (Math.abs(delta) > 3000) shared += delta - Math.sign(delta) * 1000;
      else home += delta;
    }
    throw new Error(`no build whose home page loads ${target} bytes`);
  }

  it("holds a page to 150,000 bytes gzipped: that many passes, one more fails", () => {
    const atLimit = homeAt(BUDGET_BYTES);
    expect(atLimit.pages.find((page) => page.name === "home")!.bytes).toBe(150_000);
    expect(atLimit.problems.filter((problem) => problem.includes("the home page"))).toEqual([]);
    expect(formatReport(atLimit)).toMatch(/home\s+\d+\s+150,000\s+150\.0 KB\s+ok/);

    const over = homeAt(BUDGET_BYTES + 1);
    expect(over.pages.find((page) => page.name === "home")!.bytes).toBe(150_001);
    expect(over.problems.filter((problem) => problem.includes("the home page"))).toHaveLength(1);
    expect(formatReport(over)).toMatch(/home\s+\d+\s+150,001\s+150\.0 KB\s+OVER/);
    // The other pages are under it in both.
    expect(atLimit.problems.filter((problem) => !problem.includes("the home page"))).toEqual([]);
  });

  it("counts a chunk the entry imports in every page", () => {
    // The entry's own imports are loaded by every page.
    const { dir } = fakeBuild({
      chunks: [...CHUNKS, { name: "react-dom.js", size: 140_000 }],
      routes: ROUTES,
      entry: { module: "entry.js", imports: ["react-dom.js"] },
    });
    const report = checkBundle(dir);
    expect(report.pages.every((page) => page.files.includes("react-dom.js"))).toBe(true);
    expect(report.problems).toHaveLength(8);
  });
});

describe("checkBundle: what must not be in the build", () => {
  it.each(FORBIDDEN.map((forbidden) => [forbidden.label, forbidden.sample] as const))("fails on %s in any file of build/client", (label, sample) => {
    const { dir } = fakeBuild({
      chunks: [...CHUNKS, { name: "leak.js", text: `var x=1;${sample};var y=2;` }],
      routes: ROUTES,
    });
    const report = checkBundle(dir);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain(label);
    expect(report.problems[0]).toContain("assets/leak.js");
  });

  it("looks in a file no page loads, in a stylesheet and in a subdirectory too", () => {
    const { dir } = fakeBuild({
      chunks: CHUNKS,
      routes: ROUTES,
      extra: { "assets/styles.css": "/* satori */", "deep/er/page.html": "<p>AffectedNodes</p>" },
    });
    const problems = checkBundle(dir).problems;
    expect(problems.some((problem) => problem.includes("assets/styles.css") && problem.includes("satori"))).toBe(true);
    expect(problems.some((problem) => problem.includes("deep/er/page.html") && problem.includes("AffectedNodes"))).toBe(true);
  });

  it("does not read fonts and images as text", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES, extra: { "assets/Geist.woff2": Buffer.from("satori resvg AffectedNodes"), "favicon.ico": Buffer.from("workers-og") } });
    expect(checkBundle(dir).problems).toEqual([]);
  });

  it("names each forbidden thing once per file, however often it appears", () => {
    const { dir } = fakeBuild({ chunks: [...CHUNKS, { name: "leak.js", text: "satori satori satori" }], routes: ROUTES });
    expect(checkBundle(dir).problems).toHaveLength(1);
  });

  it("forbids the renderer, the transaction parser's vocabulary, the binary codec and the QR encoder's tables", () => {
    expect(FORBIDDEN.map((forbidden) => forbidden.label).sort()).toEqual(
      ["AffectedNodes", "FinalFields", "QR encoder tables", "TransactionType", "resvg", "ripple-binary", "satori", "workers-og"].sort(),
    );
  });

  it("has a QR needle that finds the tables in the encoder's own source, spaced or minified", () => {
    const qr = FORBIDDEN.find((forbidden) => forbidden.label === "QR encoder tables")!;
    const source = readFileSync(new URL("../app/server/qr.ts", import.meta.url), "utf8");
    expect(qr.pattern.test(source)).toBe(true);
    expect(qr.pattern.test("const a=[-1,10,16,26,18,24,16,18,22,22],b=[-1,1,1,1,2,2,4,4,4,5];")).toBe(true);
    expect(qr.pattern.test("const a=[-1,10,16,26,18,24,16,18,22,23]")).toBe(false);
  });
});

describe("checkBundle: a build that is not what it should be", () => {
  it("fails without a manifest", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES, manifest: false });
    expect(checkBundle(dir).problems.join("\n")).toMatch(/manifest/);
  });

  it("fails when the manifest names a file that is not there", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS.filter((chunk) => chunk.name !== "table.js"), routes: ROUTES });
    const problems = checkBundle(dir).problems;
    expect(problems.join("\n")).toMatch(/table\.js/);
    expect(problems.join("\n")).toMatch(/missing/i);
  });

  it("fails when a page's route is not in the manifest", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES.filter((route) => route.id !== "routes/net.tx.$id") });
    expect(checkBundle(dir).problems.join("\n")).toMatch(/transaction.*routes\/net\.tx\.\$id/s);
  });

  it("fails when the build has no _headers, or one without the rule for the hashed assets", () => {
    const missing = fakeBuild({ chunks: CHUNKS, routes: ROUTES, headers: null }).dir;
    expect(checkBundle(missing).problems.join("\n")).toMatch(/_headers/);
    const wrong = fakeBuild({ chunks: CHUNKS, routes: ROUTES, headers: "/assets/*\n  Cache-Control: max-age=60\n" }).dir;
    expect(checkBundle(wrong).problems.join("\n")).toMatch(/_headers.*for a year/s);
    const other = fakeBuild({ chunks: CHUNKS, routes: ROUTES, headers: "/other/*\n  Cache-Control: public, max-age=31536000, immutable\n" }).dir;
    expect(checkBundle(other).problems.join("\n")).toMatch(/_headers/);
  });

  it("fails on a directory that is not a build", () => {
    expect(checkBundle(join(tmpdir(), "t15b-no-such-build")).problems.join("\n")).toMatch(/not a client build/);
  });
});

describe("headersRules", () => {
  it("reads a _headers file: a path on a line, its headers indented below it", () => {
    expect(headersRules("# a comment\n/assets/*\n  Cache-Control: public, max-age=1\n  X-A: b: c\n\n/other\n  X-B: 1\n")).toEqual([
      { path: "/assets/*", headers: { "cache-control": "public, max-age=1", "x-a": "b: c" } },
      { path: "/other", headers: { "x-b": "1" } },
    ]);
  });
});

describe("the command", () => {
  const script = fileURLToPath(new URL("./check-bundle.ts", import.meta.url));
  const run = (dir: string) => spawnSync("pnpm", ["exec", "tsx", script, dir], { encoding: "utf8", cwd: dirname(script) });

  it("prints the table and exits 0 for a build within the budget", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES, shell: true });
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/home\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
  }, 30_000);

  it("exits 1 for a build without the vendor and shell chunks (a build from before scripts/shell-chunks.ts), and says so", () => {
    const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/home\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
    expect(result.stdout).toContain("the root route imports 0 vendor-*.js chunks, not one");
    expect(result.stdout).toContain("the root route imports 0 shell-*.js chunks, not one");
  }, 30_000);

  it("exits 1 for a build that is not there, or has no manifest, and says so", () => {
    const missing = run(join(tmpdir(), "t15b-no-such-build"));
    expect(missing.status).toBe(1);
    expect(missing.stdout).toMatch(/not a client build \(no assets\/ directory\): run pnpm build first/);
    const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES, manifest: false, shell: true });
    const noManifest = run(dir);
    expect(noManifest.status).toBe(1);
    expect(noManifest.stdout).toMatch(/expected one manifest-\*\.js in .*, found 0/);
  }, 30_000);

  it("prints what is wrong and exits 1 for a build over it", () => {
    const chunks = [...CHUNKS.map((chunk) => (chunk.name === "tx.js" ? { ...chunk, size: 160_000 } : chunk)), { name: "leak.js", text: "resvg" }];
    const { dir } = fakeBuild({ chunks, routes: ROUTES });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/transaction/);
    expect(result.stdout + result.stderr).toMatch(/resvg/);
  }, 30_000);

  // The gate once decided whether it was being run by comparing the URL of the module (a real path) with `process.argv[1]` (the path as
  // typed): through a link they differ, and it then printed nothing and exited 0 for any build. A gate that cannot tell it is the command
  // must fail, not pass.
  describe("reached through a link", () => {
    /** A link to the script, or to the directory that holds it, in a directory made here; `build` is where no client build is. */
    function linked(kind: "file" | "directory") {
      const dir = mkdtempSync(join(tmpdir(), "t15b-check-bundle-link-"));
      dirs.push(dir);
      if (kind === "file") {
        symlinkSync(script, join(dir, "check-bundle.ts"));
        return { entry: join(dir, "check-bundle.ts"), missing: join(dir, "no-build") };
      }
      symlinkSync(dirname(script), join(dir, "linked-scripts"));
      return { entry: join(dir, "linked-scripts", "check-bundle.ts"), missing: join(dir, "no-build") };
    }
    const runLinked = (entry: string, ...args: string[]) => spawnSync("pnpm", ["exec", "tsx", entry, ...args], { encoding: "utf8", cwd: dirname(script) });

    it.each(["file", "directory"] as const)("fails, and says why, for a build that is not there (a link to the %s)", (kind) => {
      const { entry, missing } = linked(kind);
      const result = runLinked(entry, missing);
      expect(result.stdout + result.stderr).toMatch(/not a client build/);
      expect(result.status).toBe(1);
    }, 30_000);

    it.each(["file", "directory"] as const)("still passes a build that is within the budget (a link to the %s)", (kind) => {
      const { entry } = linked(kind);
      const { dir } = fakeBuild({ chunks: CHUNKS, routes: ROUTES, shell: true });
      const result = runLinked(entry, dir);
      expect(result.stdout).toMatch(/home\s+\d+\s+[\d,]+\s+[\d.]+ KB\s+ok/);
      expect(result.status).toBe(0);
    }, 30_000);
  });
});
