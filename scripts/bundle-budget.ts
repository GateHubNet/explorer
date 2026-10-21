// The check of the client build, run after `pnpm build` (it is the last step of `pnpm verify`) by the command `tsx scripts/check-bundle.ts
// [dir]`, the directory being `build/client` unless one is given. This module only holds the check, so that the tests can import it; the
// command is check-bundle.ts, which always runs it. (The command used to decide whether it was being run by comparing this module's URL
// with `process.argv[1]`; through a link they differ, and it then printed nothing and exited 0.) The check fails when
//
//   - the JavaScript a page loads first, gzipped, is over 150 KB on the home, ledger, transaction, account, network, markets or market pair
//     page (the route manifest is in it: see below);
//   - the analytics view of the account page loads more than 150 KB of JavaScript, gzipped, in all (spec 5, gate 2): the account route's first
//     load, the chunk of the view that its `import()` names (`ANALYTICS_VIEW`), and the files that chunk imports statically, followed from file
//     to file (each file once); or that `import()` or a file it reaches is not in the build;
//   - a file of the build holds something that belongs to the Worker alone: the image renderer, the transaction parser's vocabulary,
//     the binary codec or the QR encoder (they would weigh on every visitor, and the pages are drawn from data that is ready);
//   - `assets/` holds WebAssembly or a font that is not the pages' own WOFF2 (`.wasm`, `.ttf`, `.bin`: the image renderer's);
//   - the build has no `_headers` rule that keeps the hashed assets in `assets/` for a year.
//
// What a page loads first is what the browser fetches before the page works: the entry, the root route, the `/:net` layout, the
// page's route and every chunk those import statically (the `imports` of the build's manifest, which are the whole closure), and the
// manifest itself (`assets/manifest-*.js`, `window.__reactRouterManifest`), which every page loads and which lists every route of the app: it
// grows with each route, so it is in each page's figure. Chunks that are loaded when needed (`import()`: the search box's classifier) are
// not in it. Each file counts once, at its `gzip -9` size.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, sep } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * 150 KB of 1000 bytes, for each page and for the analytics view. The pages stand between 134.0 and 147.7 KB (network and the market pair page
 * the heaviest) and the view at 150.7 KB, the route manifest (about 1.2 KB) included.
 */
export const BUDGET_BYTES = 150_000;

/** The pages the budget is kept for, by their route in the manifest. */
export const PAGES = [
  { name: "home", route: "routes/net._index" },
  { name: "ledger", route: "routes/net.ledger.$id" },
  { name: "transaction", route: "routes/net.tx.$id" },
  { name: "account", route: "routes/net.account.$address" },
  { name: "network", route: "routes/net.network" },
  { name: "markets", route: "routes/net.markets" },
  { name: "market-pair", route: "routes/net.markets.$base.$counter" },
] as const;

/**
 * The analytics view (spec 5, gate 2): the account page with its Analytics tab, whose view (`app/ui/pages/AccountAnalytics.tsx`) is a chunk the
 * account route loads with `import()`. The check finds the chunk from the files themselves: `chunk` is the `import()` in the account route's
 * first-load files (the build writes it with backticks, ``import(`./AccountAnalytics-….js`)``; quotes are taken too), and the chunk's relative
 * static imports (`from"./x.js"`, `import"./x.js"`) are followed in each file they reach. A visitor who opens the tab downloads no more than the
 * budget before the view works.
 */
export const ANALYTICS_VIEW = {
  name: "account analytics",
  from: "routes/net.account.$address",
  chunk: /import\(\s*["'`]\.\/(AccountAnalytics-[\w-]+\.js)["'`]\s*\)/,
} as const;

/** A relative static import of a file of the build: `from"./x.js"`, and `import"./x.js"` (an `import(…)` is loaded when needed, and is not one). */
const STATIC_IMPORT = /\b(?:from|import)\s*["'](\.\.?\/[^"']+)["']/g;

export interface Forbidden {
  label: string;
  /** What is looked for in every text file of the build. */
  pattern: RegExp;
  /** A text that `pattern` finds, for the tests. */
  sample: string;
}

/**
 * Names that must not appear anywhere in `build/client`. The image renderer (workers-og: Satori, resvg-wasm, yoga-wasm and the font it
 * draws with) and the transaction parser's vocabulary are what the Worker alone uses to draw an image and to read a transaction; the QR
 * encoder is found by its tables, because the names of a minified bundle are gone and its numbers are not.
 */
export const FORBIDDEN: readonly Forbidden[] = [
  { label: "workers-og", pattern: /workers-og/, sample: 'import("workers-og")' },
  { label: "satori", pattern: /satori/, sample: "satori" },
  { label: "resvg", pattern: /resvg/, sample: "resvg" },
  { label: "yoga-wasm", pattern: /yoga-wasm/, sample: 'import("yoga-wasm-web")' },
  { label: "Geist-Regular.bin", pattern: /Geist-Regular\.bin/, sample: '"./Geist-Regular.bin"' },
  { label: "AffectedNodes", pattern: /AffectedNodes/, sample: "t.AffectedNodes" },
  { label: "TransactionType", pattern: /TransactionType/, sample: "t.TransactionType" },
  { label: "FinalFields", pattern: /FinalFields/, sample: "n.FinalFields" },
  { label: "ripple-binary", pattern: /ripple-binary/, sample: "ripple-binary-codec" },
  // `ECC_CODEWORDS_PER_BLOCK` in app/server/qr.ts: the number of error correction codewords of each version (index 0 unused).
  { label: "QR encoder tables", pattern: /-1,\s*10,\s*16,\s*26,\s*18,\s*24,\s*16,\s*18,\s*22,\s*22/, sample: "[-1,10,16,26,18,24,16,18,22,22]" },
];

/** What is not text and is not read: a font or an image cannot hold a name by accident worth failing a build for. */
const BINARY = /\.(woff2?|ttf|otf|ico|png|jpe?g|gif|webp|avif|wasm)$/i;

/** What `assets/` never holds: WebAssembly, and a font that is not the pages' WOFF2 (the image renderer's TTF, or its font as `.bin`). */
const WORKER_FILE = /^assets\/[^/]+\.(wasm|ttf|bin)$/i;

export interface PageReport {
  name: string;
  route: string;
  /** The files it loads first, as names below `assets/`. */
  files: string[];
  /** Their `gzip -9` sizes added up. */
  bytes: number;
}

/** A view loaded beyond a page's first load: the page's files, the view's chunk and what that imports. */
export interface ViewReport extends PageReport {
  /** The view's chunk, below `assets/`. */
  chunk: string;
}

export interface BundleReport {
  pages: PageReport[];
  /** The analytics view (`ANALYTICS_VIEW`), when its chunk was found. */
  views: ViewReport[];
  /** The `gzip -9` size of the route manifest, which is in the figure of every page; 0 when there is none. */
  manifestBytes: number;
  /** The manifest's file name below `assets/`, when there is one. */
  manifestFile?: string;
  problems: string[];
}

interface ManifestRoute {
  id: string;
  parentId?: string;
  module: string;
  imports?: string[];
}

export interface Manifest {
  entry: { module: string; imports?: string[] };
  routes: Record<string, ManifestRoute>;
}

/** The rules of a `_headers` file: a path on a line of its own, then the indented `Name: value` lines that belong to it. */
export function headersRules(text: string): Array<{ path: string; headers: Record<string, string> }> {
  const rules: Array<{ path: string; headers: Record<string, string> }> = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      const [name, ...value] = line.trim().split(":");
      const rule = rules.at(-1);
      if (rule) rule.headers[name!.trim().toLowerCase()] = value.join(":").trim();
    } else {
      rules.push({ path: line.trim(), headers: {} });
    }
  }
  return rules;
}

const gzipSize = (path: string) => gzipSync(readFileSync(path), { level: 9 }).length;

/** Every file below `dir`, as paths with `/`, in a stable order. */
function filesBelow(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .map((entry) => entry.split(sep).join("/"))
    .sort();
}

/** The route manifest of the build in `dir` (`assets/manifest-*.js`), or `undefined` with what is wrong added to `problems`. */
export function readManifest(dir: string, problems: string[]): { manifest: Manifest; file: string } | undefined {
  let names: string[];
  try {
    names = readdirSync(join(dir, "assets")).filter((name) => /^manifest-.*\.js$/.test(name));
  } catch {
    problems.push(`${dir} is not a client build (no assets/ directory): run pnpm build first`);
    return undefined;
  }
  if (names.length !== 1) {
    problems.push(`expected one manifest-*.js in ${join(dir, "assets")}, found ${names.length}`);
    return undefined;
  }
  const text = readFileSync(join(dir, "assets", names[0]!), "utf8");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    return { manifest: JSON.parse(text.slice(start, end + 1)) as Manifest, file: names[0]! };
  } catch {
    problems.push(`the manifest ${names[0]} is not the JSON after window.__reactRouterManifest=`);
    return undefined;
  }
}

/** The route and its parents up to the root, root first. */
function chainOf(manifest: Manifest, id: string): ManifestRoute[] {
  const chain: ManifestRoute[] = [];
  for (let route: ManifestRoute | undefined = manifest.routes[id]; route; route = route.parentId ? manifest.routes[route.parentId] : undefined) {
    chain.unshift(route);
  }
  return chain;
}

/**
 * The analytics view of `page` (the account page's report): its files and the files of the chunk that one of them imports with `import()`,
 * followed through the relative static imports of each file that is not the page's already (the page's are the whole closure of its
 * routes), each once. `undefined`, with the problem added, when there is no such chunk, or more than one.
 */
function viewOf(dir: string, page: PageReport, problems: string[]): ViewReport | undefined {
  const pattern = new RegExp(ANALYTICS_VIEW.chunk.source, "g");
  const chunks = new Set<string>();
  for (const file of page.files) {
    let text: string;
    try {
      text = readFileSync(join(dir, "assets", file), "utf8");
    } catch {
      continue; // The page's problem says it is missing.
    }
    for (const match of text.matchAll(pattern)) chunks.add(match[1]!);
  }
  if (chunks.size === 0) {
    problems.push("the account route has no import() of AccountAnalytics");
    return undefined;
  }
  if (chunks.size > 1) {
    problems.push(`the account route has an import() of ${chunks.size} AccountAnalytics chunks (${[...chunks].sort().join(", ")}), not one`);
    return undefined;
  }

  const chunk = [...chunks][0]!;
  const files = [...page.files];
  const seen = new Set(files);
  let bytes = page.bytes;
  const stack = [chunk];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    let content: Buffer;
    try {
      content = readFileSync(join(dir, "assets", file));
    } catch {
      problems.push(`the ${ANALYTICS_VIEW.name} view loads assets/${file}, which is missing from the build`);
      continue;
    }
    bytes += gzipSync(content, { level: 9 }).length;
    const imported = [...content.toString("utf8").matchAll(STATIC_IMPORT)].map((match) => posix.normalize(posix.join(posix.dirname(file), match[1]!)));
    // In the order they are written: the first import is the next file of the list.
    stack.push(...imported.reverse());
  }
  if (bytes > BUDGET_BYTES) {
    problems.push(`the ${ANALYTICS_VIEW.name} view loads ${kb(bytes)} of JavaScript, gzipped: over the budget of ${kb(BUDGET_BYTES)}`);
  }
  return { name: ANALYTICS_VIEW.name, route: ANALYTICS_VIEW.from, files, bytes, chunk };
}

/** Looks at the client build in `dir` (`build/client`) and says how heavy each page is and what is wrong. */
export function checkBundle(dir: string): BundleReport {
  const problems: string[] = [];
  const pages: PageReport[] = [];
  const views: ViewReport[] = [];
  const found = readManifest(dir, problems);
  const manifest = found?.manifest;
  let manifestBytes = 0;
  if (found) {
    try {
      manifestBytes = gzipSize(join(dir, "assets", found.file));
    } catch {
      problems.push(`cannot read assets/${found.file}`);
    }
  }

  if (manifest && found) {
    for (const page of PAGES) {
      const chain = chainOf(manifest, page.route);
      if (chain.length === 0 || chain.at(-1)!.id !== page.route) {
        problems.push(`the ${page.name} page: no route ${page.route} in the manifest`);
        continue;
      }
      // The manifest is loaded by every page, after the entry: it names the route modules the entry then fetches.
      const urls = [manifest.entry.module, ...(manifest.entry.imports ?? []), found.file];
      for (const route of chain) urls.push(route.module, ...(route.imports ?? []));
      const files = [...new Set(urls.map((url) => url.replace(/^\/?assets\//, "")))];
      let bytes = 0;
      for (const file of files) {
        try {
          bytes += gzipSize(join(dir, "assets", file));
        } catch {
          problems.push(`the ${page.name} page loads assets/${file}, which is missing from the build`);
        }
      }
      pages.push({ name: page.name, route: page.route, files, bytes });
      if (bytes > BUDGET_BYTES) {
        problems.push(`the ${page.name} page loads ${kb(bytes)} of JavaScript, gzipped: over the budget of ${kb(BUDGET_BYTES)}`);
      }
    }
    // A missing account route is the account page's problem, said above.
    const from = pages.find((page) => page.route === ANALYTICS_VIEW.from);
    const view = from && viewOf(dir, from, problems);
    if (view) views.push(view);
  }

  let all: string[] = [];
  try {
    all = filesBelow(dir);
  } catch {
    if (manifest) problems.push(`cannot list ${dir}`);
  }
  for (const file of all) {
    if (WORKER_FILE.test(file)) problems.push(`${file} is WebAssembly or a font that is not the pages' WOFF2: the image renderer's, which belongs to the Worker alone`);
    if (BINARY.test(file)) continue;
    const text = readFileSync(join(dir, file), "latin1");
    for (const forbidden of FORBIDDEN) {
      if (forbidden.pattern.test(text)) problems.push(`${file} holds ${forbidden.label}, which belongs to the Worker alone`);
    }
  }

  if (all.length > 0) {
    let headers: string | undefined;
    try {
      headers = readFileSync(join(dir, "_headers"), "utf8");
    } catch {
      problems.push("the build has no _headers: public/_headers must be copied beside the assets");
    }
    if (headers !== undefined) {
      const rule = headersRules(headers).find((r) => r.path === "/assets/*");
      if (rule?.headers["cache-control"] !== "public, max-age=31536000, immutable") {
        problems.push("_headers has no rule that keeps /assets/* for a year (Cache-Control: public, max-age=31536000, immutable)");
      }
    }
  }

  return { pages, views, manifestBytes, manifestFile: found?.file, problems };
}

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;

/** The table printed after the check, and the problems below it. */
export function formatReport(report: BundleReport): string {
  const row = (name: string, files: string, bytes: string, gzip: string, status: string) =>
    `${name.padEnd(18)}${files.padStart(7)}${bytes.padStart(13)}${gzip.padStart(13)}  ${status}`;
  const lines = [
    `Initial JavaScript per page, gzip -9, each file once, the route manifest included (budget ${kb(BUDGET_BYTES)})`,
    "",
    row("page", "files", "bytes", "gzip", "status"),
  ];
  // The pages, then the analytics view: the account page's files, its chunk and what that imports.
  for (const page of [...report.pages, ...report.views]) {
    lines.push(row(page.name, String(page.files.length), page.bytes.toLocaleString("en-US"), kb(page.bytes), page.bytes > BUDGET_BYTES ? "OVER" : "ok"));
  }
  if (report.manifestFile !== undefined) {
    lines.push("", `Every figure includes the route manifest, ${report.manifestFile}: ${report.manifestBytes.toLocaleString("en-US")} bytes. It lists every route, so it grows with each.`);
  }
  if (report.problems.length > 0) {
    lines.push("", "Problems:", ...report.problems.map((problem) => `  - ${problem}`));
  }
  return lines.join("\n");
}
