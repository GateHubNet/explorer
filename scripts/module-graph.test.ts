import { describe, expect, it } from "vitest";

import { closureOf, fileOf, normalize, type StaticImports } from "./module-graph";

/** A module graph from `id: [static imports]`. */
const graphOf = (modules: Record<string, string[]>): StaticImports => ({ info: (id) => (id in modules ? { importedIds: modules[id]! } : null) });

describe("normalize and fileOf", () => {
  it("read a Windows path and a trailing slash as Rolldown spells a path, and a module's file without its query", () => {
    expect(normalize("C:\\repo\\app\\")).toBe("C:/repo/app");
    expect(normalize("/repo/app//")).toBe("/repo/app");
    expect(fileOf("C:\\repo\\app\\ui\\charts\\Plot.tsx?analytics-kit")).toBe("C:/repo/app/ui/charts/Plot.tsx");
    expect(fileOf("/repo/app/routes/net._index.tsx?__react-router-build-client-route")).toBe("/repo/app/routes/net._index.tsx");
    expect(fileOf("\0vite/preload-helper.js")).toBe("\0vite/preload-helper.js");
  });
});

describe("closureOf", () => {
  const graph = graphOf({
    view: ["a", "b"],
    a: ["c"],
    b: ["c", "d"],
    c: ["a"],
    d: [],
    // Reached only by import(), which is not in importedIds.
    later: [],
  });

  it("is the start and every module it reaches through static imports, each once, with the module it was first found imported by", () => {
    const closure = closureOf(graph, "view");
    expect([...closure.keys()].sort()).toEqual(["a", "b", "c", "d", "view"]);
    expect(closure.get("view")).toBe("");
    expect(closure.get("a")).toBe("view");
    expect(closure.get("d")).toBe("b");
    // c is imported by a and by b: it is named once, by whichever the walk found it through first.
    expect(["a", "b"]).toContain(closure.get("c"));
    expect(closure.has("later")).toBe(false);
  });

  it("is the start alone for a module the graph does not have or that imports nothing", () => {
    expect([...closureOf(graph, "missing").keys()]).toEqual(["missing"]);
    expect([...closureOf(graph, "d").keys()]).toEqual(["d"]);
  });
});
