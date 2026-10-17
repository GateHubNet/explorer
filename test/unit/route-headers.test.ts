import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// React Router builds the headers of a document from the `headers` exports of the matched routes, and a route
// without one gets its parent's. So a route whose loader names a cache class (`cached(...)`, or a helper that throws
// it) and has no `headers = forwardCacheClass` silently loses the class, and the 404 it throws is not stored, or is
// stored under the parent's class. This test fails the build for such a route.

/** What a route module imports that makes its loader name a cache class: `cached` itself, and helpers that throw it. */
const NAMES_A_CLASS = ["cached", "upstreamFailure", "requireNetwork"];

function importedNames(source: string): string[] {
  const names: string[] = [];
  for (const [, list] of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']+["']/g)) {
    for (const item of list!.split(",")) {
      const name = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function exportsHeaders(source: string): boolean {
  return (
    /export\s+(?:const|let|var|function)\s+headers\b/.test(source) ||
    /export\s*\{[^}]*\bas\s+headers\b[^}]*\}/.test(source) ||
    /export\s*\{[^}]*\bheaders\b[^}]*\}/.test(source)
  );
}

/** The problem with a route module's source, if it has one. */
export function problemWith(source: string): string | undefined {
  const used = NAMES_A_CLASS.filter((name) => importedNames(source).includes(name));
  if (used.length > 0 && !exportsHeaders(source)) {
    return `imports ${used.join(", ")} but does not export \`headers\` (export const headers = forwardCacheClass)`;
  }
  return undefined;
}

const appDir = new URL("../../app/", import.meta.url);

function routeFiles(): string[] {
  const routes = readdirSync(new URL("routes/", appDir), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => `routes/${file}`);
  return ["root.tsx", ...routes];
}

describe("the scanner", () => {
  it("flags a route that names a class without exporting headers", () => {
    expect(problemWith(`import { cached } from "../server/edge-cache";\nexport function loader() { return cached(1, "live"); }`)).toMatch(/cached/);
    expect(problemWith(`import { upstreamFailure } from "../server/loader-errors";\nexport function loader() {}`)).toMatch(/upstreamFailure/);
    expect(problemWith(`import {\n  forwardCacheClass,\n  cached as classed,\n} from "../server/edge-cache";`)).toMatch(/cached/);
  });

  it("accepts the forms an export of headers can take", () => {
    const loader = `import { cached } from "../server/edge-cache";\n`;
    expect(problemWith(`${loader}export const headers = forwardCacheClass;`)).toBeUndefined();
    expect(problemWith(`${loader}export function headers(args) { return args.parentHeaders; }`)).toBeUndefined();
    expect(problemWith(`${loader}export { forwardCacheClass as headers };`)).toBeUndefined();
  });

  it("leaves a route that names no class alone", () => {
    expect(problemWith(`import { redirect } from "react-router";\nexport function loader() { return redirect("/xrpl"); }`)).toBeUndefined();
  });
});

describe("app/routes and app/root.tsx", () => {
  it.each(routeFiles())("%s exports headers when its loader names a cache class", (file) => {
    const source = readFileSync(new URL(file, appDir), "utf8");
    expect(problemWith(source)).toBeUndefined();
  });

  it("gives the root route its headers export, whatever it imports (its boundary shows a thrown 404)", () => {
    expect(exportsHeaders(readFileSync(new URL("root.tsx", appDir), "utf8"))).toBe(true);
  });
});
