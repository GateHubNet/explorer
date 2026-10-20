import { describe, expect, it } from "vitest";

import { naturalOrientation } from "../app/domain/market-pair";
import { withTx } from "../test/support/ledger-edits";
import { nodeFile } from "../test/support/upstream-core";
import { AMM_INFO_POOLS, ammInfoFixtures, ammInfoResult, ammInfoResultByPair, type AmmInfoPool } from "./amm-info-fixtures";
import { fixtureText, readLedgers, type RawLedger } from "./http-fixtures";

// The pool is the XRP/RLUSD pool of the recordings (test/fixtures/ledgers/xrpl-amm/manifest.json). What `amm_info` says of it is what its newest recorded
// transactions left: the Balance of its AccountRoot and the RLUSD line after the Payment 8014250A… (ledger 107713744), the AMM node after the AMMWithdraw
// 2D6FF646… (ledger 107711512), served at the newest recorded ledger, 107721455. The figures below are read off those nodes by hand.
const ledgers = readLedgers("xrpl");

const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const RLUSD = "524C555344000000000000000000000000000000";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LP_TOKEN = "03B245BE580EC4F4386A751C084489EC4B514A2F";
const LIONS = "4C494F4E53000000000000000000000000000000";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";

const [xrpRlusd] = AMM_INFO_POOLS as [AmmInfoPool];

type Amm = {
  account: string;
  amount: unknown;
  amount2: unknown;
  auction_slot: { account?: string; auth_accounts?: unknown[]; discounted_fee: number; expiration: string; price: unknown; time_interval: number };
  lp_token: { currency: string; issuer: string; value: string };
  trading_fee: number;
  vote_slots: Array<{ account: string; trading_fee: number; vote_weight: number }>;
};
type Result = { amm: Amm; ledger_hash: string; ledger_index: number; status: string; validated: boolean };

const resultOf = (from: readonly RawLedger[] = ledgers, pool: AmmInfoPool = xrpRlusd) => ammInfoResult(from, pool) as unknown as Result;

/** A copy of the recorded ledgers where the newest one closed at `closeTime` (Ripple epoch seconds). */
function closingAt(closeTime: number): RawLedger[] {
  const copy = structuredClone(ledgers);
  const newest = copy.reduce((a, b) => (Number(b.ledger.ledger_index) > Number(a.ledger.ledger_index) ? b : a));
  newest.ledger.close_time = closeTime;
  return copy;
}

describe("the pools", () => {
  it("are listed with their assets in the natural orientation: XRP/RLUSD, pool rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3", () => {
    expect(AMM_INFO_POOLS).toEqual([{ pool: POOL, asset: { currency: "XRP" }, asset2: { currency: RLUSD, issuer: RLUSD_ISSUER } }]);
    for (const { asset, asset2 } of AMM_INFO_POOLS) {
      expect(naturalOrientation(asset, asset2, "XRP")).toEqual({ base: asset, counter: asset2, inverted: false });
    }
  });
});

describe("the amm_info result of the XRP/RLUSD pool", () => {
  it("is served at the newest recorded ledger, validated, with the shape the node gives", () => {
    const result = resultOf();
    expect(result.ledger_index).toBe(107721455);
    expect(result.ledger_hash).toBe("68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092");
    expect(result.validated).toBe(true);
    expect(result.status).toBe("success");
    expect(Object.keys(result).sort()).toEqual(["amm", "ledger_hash", "ledger_index", "status", "validated"]);
    expect(Object.keys(result.amm).sort()).toEqual(["account", "amount", "amount2", "auction_slot", "lp_token", "trading_fee", "vote_slots"]);
  });

  it("holds the AccountRoot's Balance after 8014250A… as drops text, and the RLUSD line's balance from the pool's side", () => {
    const { amm } = resultOf();
    expect(amm.account).toBe(POOL);
    // The native amount is drops text, as the node writes it; the issued one an object with the pool's holding (the pool is the line's low account).
    expect(amm.amount).toBe("1847691034536");
    expect(amm.amount2).toEqual({ currency: RLUSD, issuer: RLUSD_ISSUER, value: "2417282.053464318" });
  });

  it("holds the LP token, the fee, the votes and the auction slot of the newest recorded AMM node (the AMMWithdraw 2D6FF646…)", () => {
    const { amm } = resultOf();
    // The LP token is issued by the pool (the reader checks it).
    expect(amm.lp_token).toEqual({ currency: LP_TOKEN, issuer: POOL, value: "1791055986.845366" });
    expect(amm.trading_fee).toBe(205);
    // Eight votes, the most a pool has; the second has no fee in the ledger (the default, 0).
    expect(amm.vote_slots).toEqual([
      { account: "rJ4XeEzorvsQp6un4h9CjtANEsB3Qcc8iA", trading_fee: 300, vote_weight: 2932 },
      { account: "rDu4vMpZU5WcwVME6oorzSov4DMLWXUEDf", trading_fee: 0, vote_weight: 1948 },
      { account: "rHq1hgWYgaiG9ycudXHoMbqGdJi75UTfzt", trading_fee: 200, vote_weight: 3514 },
      { account: "rETg9RYxRAxgNjm33Q4tAWceKKVoMcpM7", trading_fee: 200, vote_weight: 3514 },
      { account: "rnEQs55pWyvEfWXkjMCD2TNzCQ1uS7SBGS", trading_fee: 200, vote_weight: 3514 },
      { account: "rwCdTmuSML5TizAMTAZFKC5ppkdxT5j24k", trading_fee: 200, vote_weight: 3514 },
      { account: "rUaf9PLELm2gtui2pEivv7k9Xbue5c6yJ3", trading_fee: 200, vote_weight: 3514 },
      { account: "r42VCs56CWH9eiS4EKBQB33ThbtPcBwN4", trading_fee: 1000, vote_weight: 271 },
    ]);
    // The slot: its holder, four authorised accounts (the most a slot has) as `{ account }` objects, and the price in LP tokens. The slot expired on
    // 2026-03-02 (Expiration 825786300 counts from 2000), long before the newest ledger, so its time interval is 20; the node writes the time as ISO 8601
    // with an offset and no colon.
    expect(amm.auction_slot).toEqual({
      account: "r4uKh2rHuarMZdAgSBYqqicX7MxPBegttw",
      auth_accounts: [
        { account: "rNy92d5CrBQ1eC5HUokq1LDfcuLPvTfh4X" },
        { account: "rJrFQCQKgUJwG6bnDLyX33ea4DwWcjk6P3" },
        { account: "rGDuzDRHd7MEPHLykPt6Z2CkQuvBcDrdQZ" },
        { account: "rBJpahxkPrMenKYzKBKEFNGsd7KpBTPL5P" },
      ],
      discounted_fee: 20,
      expiration: "2026-03-02T17:05:00+0000",
      price: { currency: LP_TOKEN, issuer: POOL, value: "131482.3939333034" },
      time_interval: 20,
    });
  });

  // Expiration 825786300; the slot runs for 24 hours before it (86 400 s), from 825699900, in 20 intervals of 4 320 s.
  it.each([
    ["the second before the slot began", 825699900 - 1, 20],
    ["the first second of the slot", 825699900, 0],
    ["the last second of the first interval", 825699900 + 4319, 0],
    ["the first second of the second interval", 825699900 + 4320, 1],
    ["halfway", 825699900 + 43200, 10],
    ["the last second of the slot", 825699900 + 86399, 19],
    ["its expiration", 825786300, 20],
    ["a day after it", 825786300 + 86400, 20],
  ])("has the time interval of rippled's rule: %s", (_when, closeTime, interval) => {
    // (close - (Expiration - 86400)) / 4320, whole, and 20 outside the day.
    expect(resultOf(closingAt(closeTime)).amm.auction_slot.time_interval).toBe(interval);
  });

  it("serves the state a transaction that did not succeed does not change: the Payment failed, the earlier nodes stand", () => {
    // Without 8014250A…, the pool's Balance is the AMMWithdraw's (ledger 107711512) and its RLUSD line the AMMDeposit's (ledger 107703707).
    const result = resultOf(
      withTx(ledgers, "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900", (tx) => {
        tx.metaData.TransactionResult = "tecPATH_PARTIAL";
      }),
    );
    expect(result.amm.amount).toBe("1847409442931");
    expect(result.amm.amount2).toEqual({ currency: RLUSD, issuer: RLUSD_ISSUER, value: "2414787.987373346" });
    // The recorded ledgers end where they did.
    expect(result.ledger_index).toBe(107721455);
  });

  it("is a failure for a pool the recordings do not show, for a pair that is not the pool's, and for no ledger at all", () => {
    expect(() => ammInfoResult(ledgers, { ...xrpRlusd, pool: "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz" })).toThrow(/rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz: the recordings end with the pool deleted/);
    expect(() => ammInfoResult(ledgers, { ...xrpRlusd, pool: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" })).toThrow(/no pool of that account/);
    expect(() => ammInfoResult(ledgers, { ...xrpRlusd, asset2: { currency: LIONS, issuer: LIONS_ISSUER } })).toThrow(/XRP\/524C555344000000000000000000000000000000, not XRP\/4C494F4E53/);
    expect(() => ammInfoResult([], xrpRlusd)).toThrow(/no ledger/);
  });

  it("is, asked by the pair the other way round, the same pool with amount and amount2 exchanged; asked by account it is the pool's own order", () => {
    const asked = resultOf();
    const reversed = ammInfoResultByPair(ledgers, { ...xrpRlusd, asset: xrpRlusd.asset2, asset2: xrpRlusd.asset }) as unknown as Result;
    expect(reversed.amm.amount).toEqual(asked.amm.amount2);
    expect(reversed.amm.amount2).toEqual(asked.amm.amount);
    expect({ ...reversed, amm: { ...reversed.amm, amount: 0, amount2: 0 } }).toEqual({ ...asked, amm: { ...asked.amm, amount: 0, amount2: 0 } });
    // The natural orientation of XRP/RLUSD is the pool's own: by pair is by account.
    expect(ammInfoResultByPair(ledgers, xrpRlusd)).toEqual(ammInfoResult(ledgers, xrpRlusd));
    // Asked by account, the order does not depend on how the pair is given.
    expect(ammInfoResult(ledgers, { ...xrpRlusd, asset: xrpRlusd.asset2, asset2: xrpRlusd.asset })).toEqual(ammInfoResult(ledgers, xrpRlusd));
  });
});

// The featured pools E5 adds are in the recordings too, in the shapes this pool is not: its reserve line is the low account's, and its natural orientation
// is its own order. Their figures are the last nodes of each, read off by hand.
describe("the amm_info result of the other recorded pools", () => {
  const USDC = { currency: "5553444300000000000000000000000000000000", issuer: "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE" };
  const RLUSD_ASSET = { currency: RLUSD, issuer: RLUSD_ISSUER };

  it("holds the pool's side of a line where the pool is the high account (XRP/USD, rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am): the line's balance, negated", () => {
    const pool: AmmInfoPool = {
      pool: "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am",
      asset: { currency: "XRP" },
      asset2: { currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" },
    };
    expect(naturalOrientation(pool.asset, pool.asset2, "XRP")).toMatchObject({ inverted: false });
    const { amm } = resultOf(ledgers, pool);
    // The USD line of the issuer (the low account) reads -4794.265265945032 after the last of the Payments of ledger 107506489; the AccountRoot 3316368141.
    expect(amm.amount).toBe("3316368141");
    expect(amm.amount2).toEqual({ currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B", value: "4794.265265945032" });
    expect(amm.lp_token.value).toBe("3340651.434735374");
    expect(amm.trading_fee).toBe(220);
    expect(amm.vote_slots).toHaveLength(4);
    // The AMMBid's slot: a holder and a price, and no authorised accounts, so no `auth_accounts` key; expired on 2026-08-06.
    expect(amm.auction_slot).toMatchObject({ account: "r4S6hRiKREKkmMeqs8dpgyYAotGyck9g3h", discounted_fee: 22, expiration: "2026-08-06T09:15:00+0000", time_interval: 20 });
    expect(amm.auction_slot).not.toHaveProperty("auth_accounts");
  });

  it("is exchanged when the natural orientation is the reverse of the pool's order (DVR/XRP, rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG: created with 500 XRP and 1000000 DVR)", () => {
    const pool: AmmInfoPool = {
      pool: "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG",
      asset: { currency: "DVR", issuer: "rpvRJUcmqQqyCHCmYRPW9FXFAGQEcibVz9" },
      asset2: { currency: "XRP" },
    };
    expect(naturalOrientation(pool.asset, pool.asset2, "XRP")).toMatchObject({ inverted: false });
    const dvr = { currency: "DVR", issuer: "rpvRJUcmqQqyCHCmYRPW9FXFAGQEcibVz9", value: "1000000" };
    // By account, the pool's own order: its created AMM node leaves out the native `Asset`.
    const byAccount = resultOf(ledgers, pool).amm;
    expect([byAccount.amount, byAccount.amount2]).toEqual(["500000000", dvr]);
    // By pair, as asked: DVR first.
    const byPair = (ammInfoResultByPair(ledgers, pool) as unknown as Result).amm;
    expect([byPair.amount, byPair.amount2]).toEqual([dvr, "500000000"]);
    expect(byPair.lp_token).toEqual({ currency: expect.stringMatching(/^03/), issuer: pool.pool, value: "22360679.77499789" });
    expect(byPair.trading_fee).toBe(1000);
    expect(byPair.vote_slots).toHaveLength(1);
    // The slot a pool is created with: the creator holds it at a price of 0.
    expect(byPair.auction_slot).toMatchObject({ account: "rEh4WnsrdmE7V1XeTsWi5dM7FHH8hYuea3", discounted_fee: 100, expiration: "2026-10-13T19:36:40+0000", price: { value: "0" }, time_interval: 20 });
  });

  it("needs no AccountRoot where the pool holds no native currency (USDC/RLUSD, rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb), and is exchanged by pair", () => {
    const pool: AmmInfoPool = { pool: "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb", asset: USDC, asset2: RLUSD_ASSET };
    expect(naturalOrientation(pool.asset, pool.asset2, "XRP")).toMatchObject({ inverted: false });
    const usdc = { ...USDC, value: "26108.29939269826" };
    const rlusd = { ...RLUSD_ASSET, value: "26112.53828344373" };
    // The pool's own order is RLUSD, USDC; the lines are as the AMMWithdraw of ledger 105257303 left them (the pool is the low account of both).
    const byAccount = resultOf(ledgers, pool).amm;
    expect([byAccount.amount, byAccount.amount2]).toEqual([rlusd, usdc]);
    const byPair = (ammInfoResultByPair(ledgers, pool) as unknown as Result).amm;
    expect([byPair.amount, byPair.amount2]).toEqual([usdc, rlusd]);
    expect(byPair.lp_token.value).toBe("26029.03771618391");
    expect(byPair.trading_fee).toBe(144);
  });

  it("cannot be made for a pool whose native balance the recordings never show (VOX/XRP, rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef: only its AMMVote is recorded)", () => {
    const pool: AmmInfoPool = {
      pool: "rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef",
      asset: { currency: "564F58F09F97BD00000000000000000000000000", issuer: "rBnJZMDB9HZ6UxUoeQc7eaAQHA3Y1v6Hk3" },
      asset2: { currency: "XRP" },
    };
    expect(() => ammInfoResult(ledgers, pool)).toThrow(/no Balance of its account/);
  });
});

describe("ammInfoFixtures", () => {
  const files = ammInfoFixtures();

  it("names the file of the pool and the file of the pair, each as the mock finds a request by", () => {
    const pair = "xrpl/node/amm_info/XRP_524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json";
    expect([...files.keys()].sort()).toEqual([`xrpl/node/amm_info/${POOL}.json`, pair].sort());
    // The requests the client makes (`ledger_index: "validated"` is the default and not in the name).
    expect(nodeFile("xrpl", "amm_info", { amm_account: POOL, ledger_index: "validated" })).toBe(`xrpl/node/amm_info/${POOL}.json`);
    expect(
      nodeFile("xrpl", "amm_info", { asset: { currency: "XRP" }, asset2: { currency: RLUSD, issuer: RLUSD_ISSUER }, ledger_index: "validated" }),
    ).toBe(pair);
  });

  it("holds the same answer, in the layout of the other fixtures, under both names", () => {
    const [first, second] = [...files.values()];
    expect(first).toBe(second);
    const text = first!;
    expect(text.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(text) as { result: unknown };
    // The whole JSON-RPC answer of the node, whose `result` is `ammInfoResult`.
    expect(Object.keys(parsed)).toEqual(["result"]);
    expect(parsed.result).toEqual(ammInfoResult(ledgers, xrpRlusd));
    expect(fixtureText(parsed)).toBe(text);
    // Keys sorted, as in every fixture.
    expect(text.indexOf('"amm"')).toBeLessThan(text.indexOf('"ledger_hash"'));
  });

  it("is deterministic", () => {
    expect([...ammInfoFixtures()]).toEqual([...files]);
  });
});
