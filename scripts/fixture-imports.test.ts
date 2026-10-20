import { describe, expect, it } from "vitest";

// derived-trades.ts first, on purpose: it imports http-fixtures.ts, whose `generate()` joins the generators that import derived-trades.ts in turn
// (amm-info-fixtures.ts, market-fixtures.ts). Loaded in this order, a module of that cycle that read derived-trades.ts while it was being made got
// nothing (Vitest) or a ReferenceError (Node): their lists are made at load time of nothing but their own constants, and this file keeps it so.
import { derivedExchanges, NATIVE } from "./derived-trades";
import { AMM_INFO_POOLS, ammInfoFixtures } from "./amm-info-fixtures";
import { compare, generate, readLedgers } from "./http-fixtures";
import { marketFixtures } from "./market-fixtures";

describe("the fixture generators, loaded from derived-trades.ts", () => {
  it("have their constants whole: the XRP/RLUSD pool is the native currency and RLUSD", () => {
    expect(NATIVE).toBe("XRP");
    expect(AMM_INFO_POOLS[0]).toEqual({
      pool: "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3",
      asset: { currency: NATIVE },
      asset2: { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" },
    });
  });

  it("generate the files `pnpm fixtures:sync` wrote, which loads them from http-fixtures.ts", () => {
    expect(derivedExchanges(readLedgers("xrpl")).length).toBeGreaterThan(0);
    const generated = generate();
    for (const [path, text] of [...marketFixtures(), ...ammInfoFixtures()]) expect(generated.get(path), path).toBe(text);
    expect(compare(generated)).toEqual({ missing: [], changed: [], stale: [] });
  });
});
