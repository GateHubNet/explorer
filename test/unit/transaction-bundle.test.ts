import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The transaction page is drawn in the browser too (a client-side navigation renders it there), so what it imports must be
// light: `describe/` and `parse/` (and the libraries behind them) work in the Worker, in the view builder, and reach the browser
// only as the text of the raw tabs. A type import is erased and costs nothing; a value import of the server's code is the bug.

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

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

// The MPT amounts of a sentence, a flow and a balance change are drawn by components that nearly every page loads: `Sentence` (the transaction, ledger, account and escrow pages, the home page's rows),
// `Flow`, `MptAmount` and `MptLink`. The scaling is the Worker's (`resolveMpt`: the page receives `value` and `ticker`), and the link is `mpt-link.ts`, an import-free leaf. `domain/mpt.ts` is the MPT
// pages' own (words, `scaleUnits`, `percentText`, `safeLink`) and carries bignumber.js, so a file that reaches it from one of these puts it on every page (preflight P41, review of Tasks 7 and 8, M6).
describe("the components that draw an MPT amount or reference in every page", () => {
  const COMPONENTS = ["ui/components/Sentence.tsx", "ui/components/MptAmount.tsx", "ui/components/MptLink.tsx", "ui/components/Flow.tsx"];

  it.each(COMPONENTS)("%s loads neither domain/mpt.ts nor domain/mpt-params.ts, which carry bignumber.js", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).toContain(file);
    expect(closure).not.toContain("domain/mpt.ts");
    expect(closure).not.toContain("domain/mpt-params.ts");
  });

  it("sees the link, a leaf that imports nothing at run time, where a component loads it", () => {
    for (const file of ["ui/components/Sentence.tsx", "ui/components/MptLink.tsx", "ui/components/Flow.tsx"]) expect(staticClosure(appDir, file), file).toContain("domain/mpt-link.ts");
    expect(valueImports(read("domain/mpt-link.ts"))).toEqual([]);
  });
});
