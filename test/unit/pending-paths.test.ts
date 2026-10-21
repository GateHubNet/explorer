import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PENDING_PATHS } from "../../app/server/pending-paths";

// A route the client calls that api/openapi.yaml does not have yet lives in PENDING_PATHS, outside the compile-time check of PATHS. Once
// `pnpm api:sync` brings it in, it belongs in PATHS, where the compiler checks it: this fails until it is moved.

/** Throws, naming the entry to move, for each pending path the document has as a path key. */
function checkPending(yaml: string): void {
  const arrived = Object.entries(PENDING_PATHS).filter(([, path]) => yaml.includes(`  "${path}":`));
  if (arrived.length > 0) {
    throw new Error(arrived.map(([name]) => `move "${name}" from PENDING_PATHS to PATHS in app/server/data-api.ts`).join("; "));
  }
}

describe("PENDING_PATHS", () => {
  it("lists only paths that api/openapi.yaml does not have yet", () => {
    const yaml = readFileSync(new URL("../../api/openapi.yaml", import.meta.url), "utf8");

    expect(() => checkPending(yaml)).not.toThrow();
  });

  it("fails, and says what to move, once the document has a path", () => {
    for (const [name, path] of Object.entries(PENDING_PATHS)) {
      const yaml = `openapi: 3.0.0\npaths:\n  "/v2/last_validated":\n    get: {}\n  "${path}":\n    get: {}\n`;

      expect(() => checkPending(yaml)).toThrow(`move "${name}" from PENDING_PATHS to PATHS in app/server/data-api.ts`);
    }
  });

  it("has the AMM volume route, which only the data API's feat/amm-data branch has", () => {
    expect(PENDING_PATHS.ammVolume).toBe("/v2/network/amm_volume");
  });

  it("has the markets route, which only a data API that has merged D2 (`feat/explorer-data`) has", () => {
    expect(PENDING_PATHS.networkMarkets).toBe("/v2/network/markets");
  });

  it("has the six routes of D1 (`feat/explorer-data`, pinned at 7d495ab), with the path parameter names of its openapi.yaml: `key` and `name`", () => {
    expect({
      validatorsSummary: PENDING_PATHS.validatorsSummary,
      validators: PENDING_PATHS.validators,
      validator: PENDING_PATHS.validator,
      validatorValidations: PENDING_PATHS.validatorValidations,
      amendments: PENDING_PATHS.amendments,
      amendment: PENDING_PATHS.amendment,
    }).toEqual({
      validatorsSummary: "/v2/network/validators/summary",
      validators: "/v2/network/validators",
      validator: "/v2/network/validators/{key}",
      validatorValidations: "/v2/network/validators/{key}/validations",
      amendments: "/v2/network/amendments",
      amendment: "/v2/network/amendments/{name}",
    });
  });

  // E5's seven AMM pool routes (`feat/amm-data`, pinned at c3e2302), in the spellings of that branch's OpenAPI document: the pool is `{pool}`, the pair is
  // `{base}/{counter}`. Without them the API answers `Cannot GET`, which the client reads as an outage, never as a missing pool (which answers `pool not found`).
  it("has the seven AMM pool routes of feat/amm-data (pinned at c3e2302), with the path parameter names of its openapi.yaml: `pool`, `base` and `counter`", () => {
    const expected = {
      ammPools: "/v2/amm/pools",
      ammPool: "/v2/amm/pools/{pool}",
      ammPoolByPair: "/v2/amm/pools/{base}/{counter}",
      ammPoolHistory: "/v2/amm/pools/{pool}/history",
      ammPoolSwaps: "/v2/amm/pools/{pool}/swaps",
      ammPoolLiquidity: "/v2/amm/pools/{pool}/liquidity",
      ammPoolGovernance: "/v2/amm/pools/{pool}/governance",
    };
    expect(Object.fromEntries(Object.keys(expected).map((name) => [name, PENDING_PATHS[name as keyof typeof expected]]))).toEqual(expected);
    // Each is a value of PENDING_PATHS, so the two tests above cover it: absent from api/openapi.yaml, and named in the message once it arrives.
  });
});
