// What the two plugins of the client build that read its module graph share (scripts/shell-chunks.ts and scripts/analytics-kit-copy.ts): how a
// module's id is read as a path, and the walk of its static imports. Pure, with no import, so that the plugins and their tests can use it.

/** A path with `/` for `\` and no trailing `/`: an app directory or a module id, as Rolldown spells it on any system. */
export const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

/** A module's file: its id without the query (`?analytics-kit`, `?__react-router-build-client-route`), with `/`. */
export const fileOf = (id: string) => normalize(id).split("?")[0]!;

/** What the walk reads of the module graph: each module's static imports (Rolldown's `ModuleInfo.importedIds`; an `import()` is not one). */
export interface StaticImports {
  info(id: string): { importedIds: readonly string[] } | null;
}

/**
 * The static closure of `start`: `start` and every module it imports, directly or through another (an `import()` is not followed), each with
 * the module it was first found imported by (`""` for `start`), which a check can name when the module should not be there.
 */
export function closureOf(graph: StaticImports, start: string): Map<string, string> {
  const importerOf = new Map<string, string>([[start, ""]]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const next of graph.info(id)?.importedIds ?? []) {
      if (importerOf.has(next)) continue;
      importerOf.set(next, id);
      stack.push(next);
    }
  }
  return importerOf;
}
