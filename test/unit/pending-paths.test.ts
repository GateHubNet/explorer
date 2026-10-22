import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PENDING_PATHS } from "../../app/server/pending-paths";

// A route the client calls that api/openapi.yaml does not have yet lives in PENDING_PATHS, outside the compile-time check of PATHS. Once
// `pnpm api:sync` brings it in, it belongs in PATHS, where the compiler checks it: this fails until it is moved.

/** Throws, naming the entry to move, for each pending path the document has as a path key. */
function checkPending(yaml: string, pending: Record<string, string> = PENDING_PATHS): void {
  const arrived = Object.entries(pending).filter(([, path]) => yaml.includes(`  "${path}":`));
  if (arrived.length > 0) {
    throw new Error(arrived.map(([name]) => `move "${name}" from PENDING_PATHS to PATHS in app/server/data-api.ts`).join("; "));
  }
}

const yaml = readFileSync(new URL("../../api/openapi.yaml", import.meta.url), "utf8");

describe("PENDING_PATHS", () => {
  it("lists only paths that api/openapi.yaml does not have yet", () => {
    expect(() => checkPending(yaml)).not.toThrow();
  });

  it("fails, and says what to move, once the document has a path", () => {
    // PENDING_PATHS is empty for now: a route of a later sub-project stands in for its entries.
    const pending = { ...PENDING_PATHS, laterRoute: "/v2/later/{id}" };
    for (const [name, path] of Object.entries(pending)) {
      const document = `openapi: 3.0.0\npaths:\n  "/v2/last_validated":\n    get: {}\n  "${path}":\n    get: {}\n`;

      expect(() => checkPending(document, pending)).toThrow(`move "${name}" from PENDING_PATHS to PATHS in app/server/data-api.ts`);
    }
  });

  // The routes that waited here, synced with data-api-new `main` 9dbbd8a (D1, D2, the AMM data and D2b), are in PATHS now, where the compiler checks them against
  // openapi.d.ts. The document has each under the name the client calls: D1's path parameters are `key` and `name`, the AMM pools' `pool` and `base`/`counter`.
  it("is empty since data-api-new 9dbbd8a: the document has every route of D1, D2 and the AMM data the client calls", () => {
    expect(PENDING_PATHS).toEqual({});
    for (const path of [
      "/v2/network/amm_volume",
      "/v2/network/markets",
      "/v2/accounts/{address}/analytics/balances",
      "/v2/accounts/{address}/analytics/balance_changes",
      "/v2/accounts/{address}/analytics/counterparties",
      "/v2/accounts/{address}/analytics/exchanges",
      "/v2/network/validators/summary",
      "/v2/network/validators",
      "/v2/network/validators/{key}",
      "/v2/network/validators/{key}/validations",
      "/v2/network/amendments",
      "/v2/network/amendments/{name}",
      "/v2/amm/pools",
      "/v2/amm/pools/{pool}",
      "/v2/amm/pools/{base}/{counter}",
      "/v2/amm/pools/{pool}/history",
      "/v2/amm/pools/{pool}/swaps",
      "/v2/amm/pools/{pool}/liquidity",
      "/v2/amm/pools/{pool}/governance",
    ]) {
      expect(yaml, path).toContain(`  "${path}":`);
    }
  });
});
