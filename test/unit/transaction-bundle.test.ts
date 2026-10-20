import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { valueImports } from "../support/value-imports";

// The transaction page is drawn in the browser too (a client-side navigation renders it there), so what it imports must be
// light: `describe/` and `parse/` (and the libraries behind them) work in the Worker, in the view builder, and reach the browser
// only as the text of the raw tabs. A type import is erased and costs nothing; a value import of the server's code is the bug.

const read = (path: string) => readFileSync(new URL(`../../app/${path}`, import.meta.url), "utf8");

describe("the files of the transaction page that run in the browser", () => {
  it.each(["ui/pages/TransactionPage.tsx", "ui/components/Flow.tsx", "ui/components/RawTabs.tsx", "ui/components/CopyTextButton.tsx"])(
    "%s imports nothing of the server, describe or parse as a value",
    (file) => {
      const imports = valueImports(read(file));
      expect(imports.filter((from) => /\/server\//.test(from) || /\/describe(\/|$)/.test(from) || /\/parse(\/|$)/.test(from) || /ripple-/.test(from))).toEqual([]);
    },
  );

  it("is checked by a scanner that sees a value import", () => {
    expect(valueImports(`import { describe } from "../../domain/describe";\nimport type { X } from "../../server/y";\nimport { type A, type B } from "../z";`)).toEqual([
      "../../domain/describe",
    ]);
  });
});
