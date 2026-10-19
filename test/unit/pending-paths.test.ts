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
});
