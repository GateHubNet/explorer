// The check of the client build, run after `pnpm build` (it is the last step of `pnpm verify`): `tsx scripts/check-bundle.ts [dir]`,
// the directory being `build/client` unless one is given. It fails (exit 1) when
//
//   - the JavaScript a page loads first, gzipped, is over 150 KB on the home, ledger, transaction or account page;
//   - a file of the build holds something that belongs to the Worker alone: the image renderer, the transaction parser's vocabulary,
//     the binary codec or the QR encoder (they would weigh on every visitor, and the pages are drawn from data that is ready);
//   - the build has no `_headers` rule that keeps the hashed assets in `assets/` for a year.
//
// What a page loads first is what the browser fetches before the page works: the entry, the root route, the `/:net` layout, the
// page's route and every chunk those import statically (the `imports` of the build's manifest, which are the whole closure).
// Chunks that are loaded when needed (`import()`) are not in it. Each file counts once, at its `gzip -9` size.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/** 150 KB of 1000 bytes. The pages stand at about 130 KB. */
export const BUDGET_BYTES = 150_000;

/** The pages the budget is kept for, by their route in the manifest. */
export const PAGES = [
  { name: "home", route: "routes/net._index" },
  { name: "ledger", route: "routes/net.ledger.$id" },
  { name: "transaction", route: "routes/net.tx.$id" },
  { name: "account", route: "routes/net.account.$address" },
] as const;

export interface Forbidden {
  label: string;
  /** What is looked for in every text file of the build. */
  pattern: RegExp;
  /** A text that `pattern` finds, for the tests. */
  sample: string;
}

/**
 * Names that must not appear anywhere in `build/client`. The first four are what the Worker alone uses to read a transaction and to
 * draw an image; the QR encoder is found by its tables, because the names of a minified bundle are gone and its numbers are not.
 */
export const FORBIDDEN: readonly Forbidden[] = [
  { label: "workers-og", pattern: /workers-og/, sample: 'import("workers-og")' },
  { label: "satori", pattern: /satori/, sample: "satori" },
  { label: "resvg", pattern: /resvg/, sample: "resvg" },
  { label: "AffectedNodes", pattern: /AffectedNodes/, sample: "t.AffectedNodes" },
  { label: "TransactionType", pattern: /TransactionType/, sample: "t.TransactionType" },
  { label: "FinalFields", pattern: /FinalFields/, sample: "n.FinalFields" },
  { label: "ripple-binary", pattern: /ripple-binary/, sample: "ripple-binary-codec" },
  // `ECC_CODEWORDS_PER_BLOCK` in app/server/qr.ts: the number of error correction codewords of each version (index 0 unused).
  { label: "QR encoder tables", pattern: /-1,\s*10,\s*16,\s*26,\s*18,\s*24,\s*16,\s*18,\s*22,\s*22/, sample: "[-1,10,16,26,18,24,16,18,22,22]" },
];

/** What is not text and is not read: a font or an image cannot hold a name by accident worth failing a build for. */
const BINARY = /\.(woff2?|ttf|otf|ico|png|jpe?g|gif|webp|avif|wasm)$/i;

export interface PageReport {
  name: string;
  route: string;
  /** The files it loads first, as names below `assets/`. */
  files: string[];
  /** Their `gzip -9` sizes added up. */
  bytes: number;
}

export interface BundleReport {
  pages: PageReport[];
  problems: string[];
}

interface ManifestRoute {
  id: string;
  parentId?: string;
  module: string;
  imports?: string[];
}

interface Manifest {
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

function readManifest(dir: string, problems: string[]): Manifest | undefined {
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
    return JSON.parse(text.slice(start, end + 1)) as Manifest;
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

/** Looks at the client build in `dir` (`build/client`) and says how heavy each page is and what is wrong. */
export function checkBundle(dir: string): BundleReport {
  const problems: string[] = [];
  const pages: PageReport[] = [];
  const manifest = readManifest(dir, problems);

  if (manifest) {
    for (const page of PAGES) {
      const chain = chainOf(manifest, page.route);
      if (chain.length === 0 || chain.at(-1)!.id !== page.route) {
        problems.push(`the ${page.name} page: no route ${page.route} in the manifest`);
        continue;
      }
      const urls = [manifest.entry.module, ...(manifest.entry.imports ?? [])];
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
  }

  let all: string[] = [];
  try {
    all = filesBelow(dir);
  } catch {
    if (manifest) problems.push(`cannot list ${dir}`);
  }
  for (const file of all) {
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

  return { pages, problems };
}

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;

/** The table printed after the check, and the problems below it. */
export function formatReport(report: BundleReport): string {
  const lines = [`Initial JavaScript per page, gzip -9, each file once (budget ${kb(BUDGET_BYTES)})`, "", "page          files        bytes         gzip  status"];
  for (const page of report.pages) {
    lines.push(
      `${page.name.padEnd(12)}${String(page.files.length).padStart(7)}${page.bytes.toLocaleString("en-US").padStart(13)}${kb(page.bytes).padStart(13)}  ${page.bytes > BUDGET_BYTES ? "OVER" : "ok"}`,
    );
  }
  if (report.problems.length > 0) {
    lines.push("", "Problems:", ...report.problems.map((problem) => `  - ${problem}`));
  }
  return lines.join("\n");
}

function main(argv: string[]): number {
  const dir = argv[0] ?? fileURLToPath(new URL("../build/client", import.meta.url));
  const report = checkBundle(dir);
  console.log(formatReport(report));
  if (report.problems.length > 0) return 1;
  console.log(`\nbundle check passed: ${relative(process.cwd(), dir) || basename(dir)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
