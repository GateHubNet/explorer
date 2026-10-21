import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../../test/support/value-imports";
import { NO_FEATURES } from "../ui/features";
import { accountHref } from "./account-tabs";
import { ammPoolPath, poolLink } from "./pool-link";

const P = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

// amm-params.test.ts has poolLink's cases through the re-export (and that it is this file's function); these are the module's own.
describe("poolLink and ammPoolPath", () => {
  it("leads to the pool's path while AMM_PAGES is on, and to its account page while it is off", () => {
    expect(ammPoolPath("xrpl", P)).toBe(`/xrpl/amm/${P}`);
    expect(poolLink("xrpl", P, { ...NO_FEATURES, ammPages: true })).toBe(ammPoolPath("xrpl", P));
    expect(poolLink("xahau", P, { ...NO_FEATURES, ammPages: true })).toBe(`/xahau/amm/${P}`);
    expect(poolLink("xrpl", P, NO_FEATURES)).toBe(accountHref("xrpl", P, {}));
  });
});

describe("the browser bundle", () => {
  // pool-link.ts is what every page with a pool link loads: the transaction page's sentence and flow, the account page's LP tokens and pool line, and
  // the lists whose sentences name a pool. It loads accountHref and its own code, and nothing of the AMM pages' query writers and readers.
  const appDir = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

  it("imports only account-tabs.ts at run time, which imports nothing", () => {
    expect(valueImports(read("domain/pool-link.ts"))).toEqual(["./account-tabs"]);
    expect(staticClosure(appDir, "domain/pool-link.ts")).toEqual(["domain/account-tabs.ts", "domain/pool-link.ts"]);
    expect(valueImports(read("domain/account-tabs.ts"))).toEqual([]);
  });

  it.each([
    ["ui/components/Sentence.tsx", "../../domain/pool-link"],
    ["ui/components/Flow.tsx", "../../domain/pool-link"],
    ["ui/pages/AccountPage.tsx", "../../domain/pool-link"],
    ["server/pair-view.ts", "../domain/pool-link"],
  ])("%s takes poolLink from pool-link.ts, not amm-params.ts", (file, specifier) => {
    const imports = valueImports(read(file));
    expect(imports).toContain(specifier);
    expect(imports.filter((from) => /amm-params$/.test(from))).toEqual([]);
  });

  it.each(["ui/components/Sentence.tsx", "ui/components/Flow.tsx", "ui/pages/AccountPage.tsx"])(
    "%s, which the browser runs, loads pool-link.ts and not amm-params.ts, through any file",
    (file) => {
      const closure = staticClosure(appDir, file);
      expect(closure).toContain("domain/pool-link.ts");
      expect(closure).not.toContain("domain/amm-params.ts");
    },
  );
});
