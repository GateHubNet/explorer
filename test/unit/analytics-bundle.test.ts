import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { valueImports } from "../support/value-imports";

// The account's Analytics tab in the browser (spec 5). The view (`AccountAnalytics.tsx`, with the chart kit) is a chunk of its own: the account
// page reaches it only through `import()`, so that the other tabs load none of it and the analytics view's first load is the account route's
// plus that chunk. What loads with the account route for every tab (the filter row, the tab's link and the `lazy()` wrapper) stays small. Both
// are drawn in the browser too, so neither imports the server's code as a value: the view builders put every figure, word and link in the page
// data. A type import is erased and costs nothing; a value import is the bug. (`pnpm check:bundle` holds the bytes to the budget.)

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

const SERVER = (from: string) => /(^|\/)server(\/|$)/.test(from);
const ANALYTICS_VIEW = (from: string) => /(^|\/)AccountAnalytics$/.test(from);
/** A source without its `import()` expressions: what is left are the imports that load with the file. */
const withoutDynamic = (source: string) => source.replace(/\bimport\(\s*["'][^"']+["']\s*\)/g, "");

describe("the files of the analytics view that run in the browser", () => {
  it.each(["ui/pages/AccountAnalytics.tsx", "ui/pages/AnalyticsFilters.tsx", "domain/analytics-params.ts"])("%s imports nothing of app/server as a value", (file) => {
    expect(valueImports(read(file)).filter(SERVER)).toEqual([]);
  });
});

describe("the analytics view's chunk", () => {
  it("is loaded by AccountPage.tsx through import() only, never with a static import", () => {
    const source = read("ui/pages/AccountPage.tsx");
    expect(valueImports(source).filter(ANALYTICS_VIEW)).not.toEqual([]);
    expect(valueImports(withoutDynamic(source)).filter(ANALYTICS_VIEW)).toEqual([]);
    expect(source).toMatch(/\bimport\(\s*"\.\/AccountAnalytics"\s*\)/);
  });

  it("is loaded by no other file of the app, statically or not", () => {
    const importers: string[] = [];
    for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      if (valueImports(read(file)).some(ANALYTICS_VIEW)) importers.push(file);
    }
    expect(importers).toEqual(["ui/pages/AccountPage.tsx"]);
  });

  it("is checked by filters that tell a static import from an import(), and a type import from either", () => {
    const source = [
      `import AccountAnalytics from "./AccountAnalytics";`,
      `import type { AnalyticsData } from "../../server/analytics-view";`,
      `import { analyticsCard } from "../../server/analytics-view";`,
      `const View = lazy(() => import("./AccountAnalytics"));`,
    ].join("\n");
    expect(valueImports(source).filter((from) => SERVER(from) || ANALYTICS_VIEW(from))).toEqual(["./AccountAnalytics", "../../server/analytics-view", "./AccountAnalytics"]);
    expect(valueImports(withoutDynamic(source)).filter(ANALYTICS_VIEW)).toEqual(["./AccountAnalytics"]);
    expect(valueImports(withoutDynamic(`const View = lazy(() => import("./AccountAnalytics"));\nimport type { X } from "./AccountAnalytics";`)).filter(ANALYTICS_VIEW)).toEqual([]);
    expect(["./AccountAnalytics.test", "./AccountAnalyticsCard", "../server-like"].filter((from) => SERVER(from) || ANALYTICS_VIEW(from))).toEqual([]);
  });
});
