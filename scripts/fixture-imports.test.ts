import { describe, expect, it } from "vitest";

// derived-trades.ts first, on purpose: it imports http-fixtures.ts, whose `generate()` joins the generators that import derived-trades.ts in turn
// (amm-info-fixtures.ts, market-fixtures.ts, and amm-fixtures.ts by way of amm-derive.ts). nft-fixtures.ts and nft-derive.ts, object-fixtures.ts and object-derive.ts, and token-fixtures.ts (which
// amm-fixtures.ts reads the featured tokens from) do not
// import derived-trades.ts, but they import http-fixtures.ts as the others do (http-fixtures.ts imports nft-fixtures.ts, object-fixtures.ts and token-fixtures.ts back), and read nothing of it while
// they load either. Loaded in this order, a module of that cycle that read
// derived-trades.ts while it was being made got nothing (Vitest) or a ReferenceError (Node): their lists are made at load time of nothing but their own
// constants, and this file keeps it so.
import { derivedExchanges, NATIVE } from "./derived-trades";
import { AMM_INFO_POOLS, ammInfoFixtures } from "./amm-info-fixtures";
import { ammFixtures, FEATURED_POOLS } from "./amm-fixtures";
import { compare, generate, readLedgers } from "./http-fixtures";
import { marketFixtures } from "./market-fixtures";
import { NFT_ACCOUNTS, NFT_CASE_TXS, NFT_SETS, nftFixtures } from "./nft-fixtures";
import { OBJECT_ROW_LISTS, OBJECT_SETS, OBJECTS_ACCOUNT, objectFixtures, SYNTHETIC_DELEGATE } from "./object-fixtures";
import { FEATURED_XRPL_TOKENS, TOKEN_ROW_LISTS } from "./token-fixtures";

describe("the fixture generators, loaded from derived-trades.ts", () => {
  it("have their constants whole: the XRP/RLUSD pool is the native currency and RLUSD", () => {
    expect(NATIVE).toBe("XRP");
    expect(AMM_INFO_POOLS[0]).toEqual({
      pool: "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3",
      asset: { currency: NATIVE },
      asset2: { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" },
    });
    // E5's pools too: every asset has its currency (none was read from another module of the cycle), and the featured pools are whole.
    for (const { asset, asset2 } of AMM_INFO_POOLS) expect([typeof asset.currency, typeof asset2.currency]).toEqual(["string", "string"]);
    expect(Object.values(FEATURED_POOLS).every((pool) => typeof pool === "string")).toBe(true);
  });

  // E8's NFT generator: its constants are whole too (none was read from another module of the cycle).
  it("have the NFT generator's constants whole: the recorded sets, the three accounts of each network and the cases the featured and unowned NFTs are made from", () => {
    expect(NFT_SETS).toEqual({ xrpl: "xrpl-nft", xahau: "xahau-nft" });
    for (const accounts of Object.values(NFT_ACCOUNTS)) expect(Object.values(accounts).every((account) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account))).toBe(true);
    expect(NFT_CASE_TXS.xrpl).toEqual({ featured: "brokered_sale_royalty", unowned: "sell_offer_create" });
    expect(NFT_CASE_TXS.xahau).toEqual({ featured: "uritoken_buy_above_ask", unowned: "uritoken_sell_offer_create" });
  });

  // E10's ledger-object generator: its constants are whole too.
  it("have the object generator's constants whole: the recorded sets, the active account, D5's synthetic delegate and the lists a row to a line", () => {
    expect(OBJECT_SETS).toEqual({ xrpl: "xrpl-objects", xahau: "xahau-objects" });
    expect(OBJECTS_ACCOUNT).toBe("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    expect(SYNTHETIC_DELEGATE).toBe("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
    expect(OBJECT_ROW_LISTS).toEqual(["history", "delegations"]);
  });

  // E11's token generator: its constants are whole too, and amm-fixtures.ts reads the featured tokens of it.
  it("have the token generator's constants whole: the featured XRPL tokens, whose pools files the AMM generator writes, and the lists a row to a line", () => {
    expect(FEATURED_XRPL_TOKENS.map(({ currency }) => currency)).toEqual(["524C555344000000000000000000000000000000", "USD", "4C494F4E53000000000000000000000000000000", "TIN"]);
    expect(FEATURED_XRPL_TOKENS.every(({ issuer }) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(issuer))).toBe(true);
    expect(TOKEN_ROW_LISTS).toEqual(["tokens", "holders", "transfers"]);
    for (const { currency, issuer } of FEATURED_XRPL_TOKENS) expect(ammFixtures().has(`xrpl/data-api/amm/pools@asset=${currency}+${issuer}&limit=20.json`), currency).toBe(true);
  });

  // A whole generation and three of its generators again: about 1.5 s on a developer's machine, and close to 5 s on a CI runner.
  it("generate the files `pnpm fixtures:sync` wrote, which loads them from http-fixtures.ts", () => {
    expect(derivedExchanges(readLedgers("xrpl")).length).toBeGreaterThan(0);
    const generated = generate();
    const objects = [...objectFixtures("xrpl"), ...objectFixtures("xahau")];
    for (const [path, text] of [...marketFixtures(), ...ammInfoFixtures(), ...ammFixtures(), ...nftFixtures(), ...objects]) expect(generated.get(path), path).toBe(text);
    expect(compare(generated)).toEqual({ missing: [], changed: [], stale: [] });
  }, 15_000);
});
