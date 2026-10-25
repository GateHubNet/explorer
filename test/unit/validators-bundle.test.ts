import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { valueImports } from "../support/value-imports";

// The validators and amendments pages are drawn in the browser too (a client-side navigation renders them there), so what they import must be
// light. The parsers of a validator's key and of an amendment's name are loader-only: `validator-key.ts` reads `ripple-address-codec`, which the
// routes' loaders use and no page needs, and a page gets the keys it links to as text from the view builders. A type import is erased and costs
// nothing; a value import of `app/server` or of a `ripple-` package is the bug. (`pnpm check:bundle` counts the result.)

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** A module of the Worker alone (`app/server`, however it is reached), or a package of the codec family. */
const SERVER_ONLY = (from: string) => /(^|\/)server(\/|$)/.test(from) || /ripple-/.test(from);

describe("the files of the validators pages that run in the browser", () => {
  it.each([
    "ui/pages/ValidatorsPage.tsx",
    "ui/pages/ValidatorPage.tsx",
    "ui/pages/AmendmentsPage.tsx",
    "ui/pages/AmendmentPage.tsx",
    "ui/components/StatusMarks.tsx",
    "ui/components/status-icons.tsx",
    "ui/components/Countdown.tsx",
    "domain/validators-params.ts",
    "domain/amendments-params.ts",
    "domain/amendment-ref.ts",
    "domain/time-words.ts",
    "domain/percent.ts",
    "domain/publishers.ts",
    "domain/query-of.ts",
    // A page's tags are made in the browser too (a client-side navigation): its builder imports ./meta, which SERVER_ONLY lets through, and nothing else of app/server.
    "server/meta-validator.ts",
    "server/meta-amendments.ts",
    "server/meta-amendment.ts",
  ])("%s imports nothing of app/server and no ripple- package as a value", (file) => {
    expect(valueImports(read(file)).filter(SERVER_ONLY)).toEqual([]);
  });

  it("is checked by a scanner that sees a value import and not a type import", () => {
    expect(valueImports(`import { validatorFacts } from "../../server/validator-facts";\nimport type { X } from "../../server/y";\nimport { type A, type B } from "../z";`)).toEqual([
      "../../server/validator-facts",
    ]);
    expect(valueImports(`import { decodeNodePublic } from "ripple-address-codec";`).filter(SERVER_ONLY)).toEqual(["ripple-address-codec"]);
    expect(["../server", "../../server/meta", "./meta", "../domain/server-words", "ripple-address-codec", "../ripple"].filter(SERVER_ONLY)).toEqual([
      "../server",
      "../../server/meta",
      "ripple-address-codec",
    ]);
  });
});

describe("the validator key parser", () => {
  it("is imported as a value by the routes and by app/server, and by nothing the browser draws", () => {
    const importers: string[] = [];
    for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      if (valueImports(read(file)).some((from) => /(^|\/)validator-key$/.test(from))) importers.push(file);
    }
    expect(importers.filter((file) => !file.startsWith("routes/") && !file.startsWith("server/"))).toEqual([]);
  });
});
