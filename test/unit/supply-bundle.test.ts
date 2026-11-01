import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { valueImports } from "../support/value-imports";

// The supply page is drawn in the browser too (a client-side navigation renders it there), so what it imports must be light. The view builder (`server/supply-view.ts`, which reads bignumber.js) is
// the loader's: the page gets every figure as text from it, and the route's `meta` imports the builder of the tags, not the view builder. A type import is erased and costs nothing; a value import
// of `app/server` (but `./meta`, which `meta-supply.ts` builds on and the browser runs) is the bug. (`pnpm check:bundle` counts the result.)

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** A module of the Worker alone (`app/server`, however it is reached), or a package of the codec family. */
const SERVER_ONLY = (from: string) => /(^|\/)server(\/|$)/.test(from) || /ripple-/.test(from);

describe("the files of the supply page that run in the browser", () => {
  it.each([
    "ui/pages/SupplyPage.tsx",
    // A page's tags are made in the browser too (a client-side navigation): its builder imports ./meta, which SERVER_ONLY lets through, and nothing else of app/server.
    "server/meta-supply.ts",
    "domain/percent.ts",
    "domain/time-words.ts",
  ])("%s imports nothing of app/server and no ripple- package as a value", (file) => {
    expect(valueImports(read(file)).filter(SERVER_ONLY)).toEqual([]);
  });

  it("is checked by a scanner that sees a value import and not a type import", () => {
    expect(valueImports(`import { supplyPage } from "../../server/supply-view";\nimport type { SupplyPageData } from "../../server/supply-view";\nimport { type A } from "../z";`)).toEqual([
      "../../server/supply-view",
    ]);
  });
});
