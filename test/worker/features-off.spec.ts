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
    expect(cacheGeneration(env)).toBe("test-build:" + [...FEATURE_VARS].sort().map((name) => `${name}=off`).join(","));
    expect(cacheGeneration(env)).toMatch(/^test-build:[A-Z_]+=off(,[A-Z_]+=off)*$/);
    // The names, spelt out: MARKETS sorts between AMM_DATA and VALIDATORS.
    expect(cacheGeneration(env)).toBe("test-build:AMM_DATA=off,MARKETS=off,VALIDATORS=off");
  });
});
