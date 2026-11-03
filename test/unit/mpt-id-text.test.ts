import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The test of an issuance ID's text, 48 hex digits, is `isMptIssuanceId` (app/domain/mpt-id.ts) in the Worker's code, `parse/` and `describe/`. The same pattern written out in a file of its own is a
// second rule that can drift (an ID in either case here, in capitals there), as `ledger-object-view.ts` and `data-api.ts` had it (review of Tasks 7 and 8, M3 and M8(a)). The files that write it are
// these, each for its reason; any other takes the function.

const appDir = new URL("../../app/", import.meta.url);

describe("the 48-hex test of an MPT issuance ID", () => {
  it("is written out only in the leaf, the browser's own copy and the shapes of the API's answers, which hold capitals", () => {
    const writers = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && /\[0-9[A-Za-z-]*\]\{48\}/.test(readFileSync(new URL(file, appDir), "utf8")))
      .sort();
    expect(writers).toEqual([
      // The leaf itself.
      "domain/mpt-id.ts",
      // The browser's copy: `mpt.ts` cannot import the leaf (it value-imports ripple-address-codec), and says so.
      "domain/mpt.ts",
      // The API's own shapes: its IDs are upper case, and a check refuses anything else.
      "server/mpt-shape.ts",
      "server/object-shape.ts",
    ]);
  });
});
