import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { headersRules } from "../../scripts/check-bundle";

// `public/_headers` is read by Cloudflare's static assets (and by the Cloudflare Vite plugin's local runtime, `wrangler dev` on the
// build included): the files of `build/client/assets/` are named by a hash of their content, so a browser may keep them for good.
// Without the rule Workers serves them with `max-age=0, must-revalidate`. The HTML is not a static asset (the Worker draws it and
// the edge cache classes of app/server/cache-class.ts set its headers), so this file names no other path. That the build carries the
// file is checked after the build, by scripts/check-bundle.ts.

const root = new URL("../../", import.meta.url);

describe("public/_headers", () => {
  it("exists", () => {
    expect(existsSync(new URL("public/_headers", root))).toBe(true);
  });

  it("keeps the hashed client assets for a year, immutable, and names no other path", () => {
    const rules = headersRules(readFileSync(new URL("public/_headers", root), "utf8"));
    expect(rules).toEqual([{ path: "/assets/*", headers: { "cache-control": "public, max-age=31536000, immutable" } }]);
  });
});
