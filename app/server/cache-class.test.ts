import { describe, expect, it } from "vitest";

import { CACHE_CLASSES, FAILURE_HOLD_KEYS, FAILURE_HOLD_MAX_SECONDS, FAILURE_HOLD_SECONDS, PERIOD_CALL_TTL_SECONDS, type CacheClass } from "./cache-class";

describe("CACHE_CLASSES", () => {
  it("holds the five classes, with the TTLs and Cache-Control values of the design (spec 4)", () => {
    expect(CACHE_CLASSES).toEqual({
      immutable: {
        edgeTtl: 31536000,
        swr: 0,
        browser: { html: "max-age=60", image: "max-age=31536000, immutable" },
      },
      // 1 s fresh and 2 s of stale copy, at the owner's request: the page follows the chain, which closes a ledger every 3-4 s, so a
      // reload must not show a copy much older than one ledger (spec 4 had 3 s + 30 s).
      "live-home": {
        edgeTtl: 1,
        swr: 2,
        browser: { html: "max-age=0, must-revalidate", image: "max-age=0, must-revalidate" },
      },
      live: {
        edgeTtl: 5,
        swr: 30,
        browser: { html: "max-age=0, must-revalidate", image: "max-age=0, must-revalidate" },
      },
      slow: { edgeTtl: 3600, swr: 0, browser: { html: "max-age=300", image: "max-age=300" } },
      short: { edgeTtl: 30, swr: 0, browser: { html: "max-age=0", image: "max-age=0" } },
    } satisfies Record<CacheClass, unknown>);
  });
});

describe("the failure hold", () => {
  it("is 5 s, at most 30 s for a Retry-After, and at most 256 keys (spec 1.7)", () => {
    expect(FAILURE_HOLD_SECONDS).toBe(5);
    expect(FAILURE_HOLD_MAX_SECONDS).toBe(30);
    expect(FAILURE_HOLD_KEYS).toBe(256);
  });
});

describe("PERIOD_CALL_TTL_SECONDS", () => {
  it("is 300 s (spec 1.4): the network page's calls over a period are kept that long, in a class that would keep them an hour", () => {
    expect(PERIOD_CALL_TTL_SECONDS).toBe(300);
    expect(PERIOD_CALL_TTL_SECONDS).toBeLessThan(CACHE_CLASSES.slow.edgeTtl);
  });
});
