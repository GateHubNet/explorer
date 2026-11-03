import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The account page is drawn in the browser too (a client-side navigation renders it there), so what it imports must be light. `describe/`
// and `parse/` (and the libraries behind them), the QR encoder and the view builder work in the Worker only and reach the browser as data:
// the finished picture of the QR code, the rows of the lists. A type import is erased and costs nothing; a value import of the server's
// code is the bug.

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

const SERVER_ONLY = (from: string) => /\/server\//.test(from) || /\/describe(\/|$)/.test(from) || /\/parse(\/|$)/.test(from) || /ripple-/.test(from) || /\/qr$/.test(from);

describe("the files of the account page that run in the browser", () => {
  it.each([
    "ui/pages/AccountPage.tsx",
    "ui/pages/AccountListPanels.tsx",
    "ui/components/AccountNameBlock.tsx",
    "ui/components/Identicon.tsx",
    "ui/components/QrButton.tsx",
    "domain/identicon.ts",
    "domain/account-tabs.ts",
  ])("%s imports nothing of the server, describe, parse or the QR encoder as a value", (file) => {
    expect(valueImports(read(file)).filter(SERVER_ONLY)).toEqual([]);
  });

  it("is checked by a scanner that sees a value import", () => {
    expect(valueImports(`import { encodeQr } from "../../server/qr";\nimport type { X } from "../../server/y";\nimport { type A, type B } from "../z";`)).toEqual(["../../server/qr"]);
    expect(valueImports(`import { describe } from "../../domain/describe";`).filter(SERVER_ONLY)).toEqual(["../../domain/describe"]);
  });
});

// The list panels of the account page (a tab's list: its tables, the objects list, the pager, the list's own names; `AccountListPanels.tsx`) are a
// chunk of their own, which AccountPage.tsx loads with `lazy(() => import(…))`. The analytics view never draws them, and the first page of a tab draws
// them inside the list's streamed `<Await>` already: so the account route's first load, which the analytics view's total counts first, holds none of
// them (README, "The client bundle check": "Lazy list panels"). `pnpm check:bundle` holds the bytes to the budgets.
const LIST_PANELS = (from: string) => /(^|\/)AccountListPanels$/.test(from);
/** A source without its `import()` expressions: what is left are the imports that load with the file. */
const withoutDynamic = (source: string) => source.replace(/\bimport\(\s*["'][^"']+["']\s*\)/g, "");

describe("the account page's list panels", () => {
  it("are loaded by AccountPage.tsx through import() only: the account route's static import graph does not hold them", () => {
    const source = read("ui/pages/AccountPage.tsx");
    expect(source).toMatch(/\bimport\(\s*"\.\/AccountListPanels"\s*\)/);
    expect(valueImports(withoutDynamic(source)).filter(LIST_PANELS)).toEqual([]);
    expect(staticClosure(appDir, "routes/net.account.$address.tsx")).not.toContain("ui/pages/AccountListPanels.tsx");
  });

  it("are loaded by no other file of the app, statically or not: the analytics view does not reach them", () => {
    const importers: string[] = [];
    for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      if (valueImports(read(file)).some(LIST_PANELS)) importers.push(file);
    }
    expect(importers).toEqual(["ui/pages/AccountPage.tsx"]);
    expect(staticClosure(appDir, "ui/pages/AccountAnalytics.tsx")).not.toContain("ui/pages/AccountListPanels.tsx");
  });

  it("import nothing of AccountPage.tsx: what the two share is the leaf account-list-words.tsx, so the page stays in the account route's chunk", () => {
    expect(staticClosure(appDir, "ui/pages/AccountListPanels.tsx")).not.toContain("ui/pages/AccountPage.tsx");
    expect(valueImports(read("ui/pages/AccountListPanels.tsx"))).toContain("./account-list-words");
    expect(valueImports(read("ui/pages/AccountPage.tsx"))).toContain("./account-list-words");
  });
});

// The Tokens card is in the route's chunk, which the analytics view loads, and the analytics view has the least room of any page (160,000 B). A holding's link is decided in the Worker, as a trust line's
// code is (`tokensOf`: `href`), so the card draws a plain `Link` and loads neither `MptLink` (the underlined link of running words) nor `mpt-link`. The list panels (a chunk of their own) and the
// sentences do, through `Sentence`: not the account route's first load (review of Tasks 7 and 8, M3 and M4).
describe("the account page's Tokens card", () => {
  it("loads neither MptLink nor mpt-link: the Worker gives each MPT row its href", () => {
    const closure = staticClosure(appDir, "ui/pages/AccountPage.tsx");
    expect(closure).not.toContain("ui/components/MptLink.tsx");
    expect(closure).not.toContain("domain/mpt-link.ts");
    expect(staticClosure(appDir, "ui/pages/AccountAnalytics.tsx")).not.toContain("ui/components/MptLink.tsx");
  });
});

describe("the QR encoder", () => {
  it("is imported by the account route and by nothing that is drawn in the browser", () => {
    const importers: string[] = [];
    for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      if (valueImports(read(file)).some((from) => /(^|\/)qr$/.test(from))) importers.push(file);
    }
    expect(importers).toEqual(["routes/net.account.$address.tsx"]);
  });
});
