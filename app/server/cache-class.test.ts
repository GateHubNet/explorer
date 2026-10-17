import { describe, expect, it } from "vitest";

import { CACHE_CLASSES, type CacheClass } from "./cache-class";

describe("CACHE_CLASSES", () => {
  it("holds the five classes, with the TTLs and Cache-Control values of the design (spec 4)", () => {
    expect(CACHE_CLASSES).toEqual({
      immutable: {
        edgeTtl: 31536000,
        swr: 0,
        browser: { html: "max-age=60", image: "max-age=31536000, immutable" },
      },
      "live-home": {
        edgeTtl: 3,
        swr: 30,
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
