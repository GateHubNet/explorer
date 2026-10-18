import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The account page is drawn in the browser too (a client-side navigation renders it there), so what it imports must be light. `describe/`
// and `parse/` (and the libraries behind them), the QR encoder and the view builder work in the Worker only and reach the browser as data:
// the finished picture of the QR code, the rows of the lists. A type import is erased and costs nothing; a value import of the server's
// code is the bug.

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** The module specifiers a source imports as values (`import type` and `import { type X }`-only lines are erased by the compiler). */
function valueImports(source: string): string[] {
  const found: string[] = [];
  for (const [, clause, from] of source.matchAll(/^import\s+([^;]*?)\s+from\s+["']([^"']+)["']/gms)) {
    if (/^type\s/.test(clause!)) continue;
    const named = /^\{([^}]*)\}$/.exec(clause!.trim());
    if (named && named[1]!.split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "))) continue;
    found.push(from!);
  }
  return found;
}

const SERVER_ONLY = (from: string) => /\/server\//.test(from) || /\/describe(\/|$)/.test(from) || /\/parse(\/|$)/.test(from) || /ripple-/.test(from) || /\/qr$/.test(from);

describe("the files of the account page that run in the browser", () => {
  it.each([
    "ui/pages/AccountPage.tsx",
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
