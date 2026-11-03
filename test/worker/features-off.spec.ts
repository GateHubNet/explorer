import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { cacheGeneration } from "../../app/server/env";
import { FEATURE_VARS } from "../../app/ui/features";
import { allSwitches } from "../support/switches";

// The `worker-off` project (vitest.config.ts) runs the files named `*-off.spec.ts` with every switch "off", where the `worker` project
// has the top level's values of wrangler.jsonc. A page spec for a switch's off-case goes here, in a file of its own (README, "Switches").

describe("the worker-off project", () => {
  it.each(FEATURE_VARS)("has %s off", (name) => {
    expect(env[name]).toBe(allSwitches("off")[name]);
  });

  it("keys the edge cache with every switch off", () => {
    expect(cacheGeneration(env)).toBe("test-build:development:" + [...FEATURE_VARS].sort().map((name) => `${name}=off`).join(","));
    expect(cacheGeneration(env)).toMatch(/^test-build:development:[A-Z_]+=off(,[A-Z_]+=off)*$/);
    // The names, spelt out: ACCOUNT_ANALYTICS sorts first, AMM_PAGES, DELEGATION and LEDGER_OBJECTS between AMM_DATA and MARKETS (in that order), MPT, NAMES, NFTS, SUPPLY and TOKENS between MARKETS and VALIDATORS (in that order), and VALIDATORS_MAP last, after VALIDATORS.
    expect(cacheGeneration(env)).toBe("test-build:development:ACCOUNT_ANALYTICS=off,AMM_DATA=off,AMM_PAGES=off,DELEGATION=off,LEDGER_OBJECTS=off,MARKETS=off,MPT=off,NAMES=off,NFTS=off,SUPPLY=off,TOKENS=off,VALIDATORS=off,VALIDATORS_MAP=off");
  });

  it("names the environment in the generation", () =>
    expect(cacheGeneration({ ...env, ENVIRONMENT: "sandbox" })).toBe(
      "test-build:sandbox:ACCOUNT_ANALYTICS=off,AMM_DATA=off,AMM_PAGES=off,DELEGATION=off,LEDGER_OBJECTS=off,MARKETS=off,MPT=off,NAMES=off,NFTS=off,SUPPLY=off,TOKENS=off,VALIDATORS=off,VALIDATORS_MAP=off",
    ));
});
