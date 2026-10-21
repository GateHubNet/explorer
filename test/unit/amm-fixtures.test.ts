import { readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

// http-fixtures.ts first: the generators it joins (amm-fixtures.ts among them) and derived-trades.ts import it in turn.
import {
  fixtureText,
  generate,
  HTTP,
  isAmmGenerated,
  isMarketGenerated,
  isoTime,
  isSynthetic,
  LEDGERS,
  readLedgers,
  txMarker,
  unixOf,
  type RawLedger,
} from "../../scripts/http-fixtures";
import { derivedExchanges } from "../../scripts/derived-trades";
import { AMM_INFO_POOLS, ammInfoResult } from "../../scripts/amm-info-fixtures";
import { deriveAmm, type AmmState } from "../../scripts/amm-derive";
import { ammFixtures, ammSeries, ammSynthetic, FEATURED_POOLS } from "../../scripts/amm-fixtures";
import { apiAssetText, sameAsset, type Asset } from "../../app/domain/asset";
import { formatCurrency } from "../../app/domain/format";
import { naturalOrientation } from "../../app/domain/market-pair";
import { nodesOf } from "../../app/domain/parse/objects";
import type { TxMeta } from "../../app/domain/parse/types";
import { windowOf } from "../../app/domain/window";
import { checkCandles } from "../../app/server/aggregate-shape";
import { checkDaysPage, checkGovernancePage, checkLiquidityPage, checkLiveVolume, checkPool, checkPoolsPage, checkSwapsPage } from "../../app/server/amm-shape";
import type { AmmGovernanceRow, AmmLiquidityEvent, AmmPool, AmmPoolDay, AmmSwap, AmmVolumeRow, Candle, Page, PairExchange } from "../../app/server/api-types";
import { dataApiFile } from "../support/upstream-core";

// What the derived AMM fixtures promise the tests that use them: the data API's answers of the pool routes that scripts/amm-fixtures.ts writes
// (`pnpm fixtures:sync`), worked out by scripts/amm-derive.ts from the recorded XRPL ledgers, and the featured pools' `amm_info` that
// scripts/amm-info-fixtures.ts writes. The rules are the data API's at data-api-new feat/amm-data c3e2302 (test/fixtures/PROVENANCE.md, "AMM
// answers"): its docs/api-reference.md and apps/api/src/amm/amm-objects.ts, written out again here apart from the generator. Over the 16
// `xrpl-amm` ledgers alone the derivation must find what the reference's own e2e suites say those ledgers hold.

const NATIVE = "XRP";
const XRP: Asset = { currency: NATIVE };
const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const SNK: Asset = { currency: "SNK", issuer: "rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm" };
const PAGE = 20;

/** The keys of the objects, in the reference's order (amm-objects.ts, docs/api-reference.md "AMM"). */
const POOL_KEYS = [
  "amm_account", "base_currency", "base_issuer", "counter_currency", "counter_issuer", "reserve_base", "reserve_counter", "lp_supply", "lp_currency",
  "trading_fee", "auction_slot", "value_native", "created_ledger", "created_by", "last_ledger", "deleted",
];
const SLOT_KEYS = ["holder", "price", "discounted_fee", "expiration"];
/** The values a state carries forward (`POOL_FIELDS`), the slot's by its four keys. */
const VALUE_KEYS = ["reserve_base", "reserve_counter", "lp_supply", "lp_currency", "trading_fee", "holder", "price", "discounted_fee", "expiration"] as const;
const STATE_KEYS = [
  "amm_account", "ledger_index", "tx_index", "tx_hash", "tx_type", "executed_time", "base_currency", "base_issuer", "counter_currency", "counter_issuer",
  "reserve_base", "reserve_counter", "lp_supply", "lp_currency", "trading_fee", "auction_slot", "deleted",
];
const LIQUIDITY_KEYS = ["amm_account", "ledger_index", "tx_index", "tx_hash", "executed_time", "account", "initiator", "event", "mode", "base_amount", "counter_amount", "lp_tokens"];
const VOTE_KEYS = ["amm_account", "ledger_index", "tx_index", "tx_hash", "executed_time", "type", "account", "fee_voted", "trading_fee_after"];
const BID_KEYS = ["amm_account", "ledger_index", "tx_index", "tx_hash", "executed_time", "type", "account", "bid_min", "bid_max", "price_paid", "auction_slot"];
const BID_SLOT_KEYS = ["holder", "discounted_fee", "expiration", "auth_accounts"];
/** The keys of an exchange row (the exchanges' reference, scripts/derived-trades.ts), `amm_account` last. */
const SWAP_KEYS = [
  "base_amount", "counter_amount", "node_index", "rate", "tx_index", "autobridged_currency", "autobridged_issuer", "buyer", "executed_time", "ledger_index",
  "offer_sequence", "provider", "seller", "taker", "tx_hash", "tx_type", "base_currency", "base_issuer", "counter_currency", "counter_issuer", "amm_account",
];

const ordered = (object: object, order: readonly string[]): string[] => order.filter((key) => key in object);

const read = (path: string): string => readFileSync(new URL(path, HTTP), "utf8");
const json = (path: string): unknown => JSON.parse(read(path));
const file = (path: string, query = ""): string => {
  const found = dataApiFile("xrpl", path, query);
  if (found === undefined) throw new Error(`no file for ${path}?${query}`);
  return found;
};

/** The ledgers of `ledgers/xrpl-amm/` alone: the set the reference's e2e suites seed. */
function ammSet(all: readonly RawLedger[]): RawLedger[] {
  const indexes = new Set(readdirSync(new URL("xrpl-amm/", LEDGERS)).filter((name) => name.endsWith(".json.gz")).map((name) => Number(name.slice(0, -".json.gz".length))));
  return all.filter((raw) => indexes.has(Number(raw.ledger.ledger_index)));
}

const xrpl = readLedgers("xrpl");
const derived = deriveAmm(xrpl);
/** The recorded transactions by hash, and their nodes (E3's `nodesOf`): what the tests read the recordings with, apart from the generator's walk. */
const recordedTxs = new Map(xrpl.flatMap((raw) => raw.ledger.transactions.map((tx) => [tx.hash, tx] as const)));
const nodesOfTx = (hash: string) => nodesOf(recordedTxs.get(hash)!.metaData as unknown as TxMeta);
const ammNodeOf = (hash: string, pool: string) => nodesOfTx(hash).find((node) => node.type === "AMM" && node.fields.Account === pool);
/** Seconds from the unix epoch to the Ripple epoch, and a Ripple-epoch time as the API writes it (`YYYY-MM-DDTHH:mm:ssZ`), written out here. */
const RIPPLE_EPOCH = 946_684_800;
const rippleIso = (seconds: number): string => new Date((seconds + RIPPLE_EPOCH) * 1000).toISOString().replace(/\.000Z$/, "Z");
type NodeSlot = { Account?: string; Price?: { value: string }; DiscountedFee?: number; Expiration?: number; AuthAccounts?: Array<{ AuthAccount: { Account: string } }> };
type LpBalance = { currency: string; value: string } | undefined;
const swaps = derivedExchanges(xrpl).filter((row): row is AmmSwap => row.amm_account !== undefined);
/**
 * The generators' output, drawn once for the whole file: every generated file (`generate()`), and the AMM pages' (`ammFixtures()`). That a second run writes
 * the same text is scripts/http-fixtures.test.ts's case of two runs.
 */
const generated = generate();
const ammFiles = ammFixtures();
const poolOf = (account: string): AmmPool => {
  const pool = derived.pools.find((p) => p.amm_account === account);
  if (pool === undefined) throw new Error(`${account}: not a derived pool`);
  return pool;
};
const baseOf = (o: { base_currency: string; base_issuer?: string }): Asset => (o.base_issuer === undefined ? { currency: o.base_currency } : { currency: o.base_currency, issuer: o.base_issuer });
const counterOf = (o: { counter_currency: string; counter_issuer?: string }): Asset =>
  o.counter_issuer === undefined ? { currency: o.counter_currency } : { currency: o.counter_currency, issuer: o.counter_issuer };
const isNative = (asset: Asset): boolean => asset.currency === NATIVE && asset.issuer === undefined;
/** The pool's native reserve, or undefined for a pool without the native currency or without a known reserve. */
function nativeReserve(pool: AmmPool): string | undefined {
  if (isNative(baseOf(pool))) return pool.reserve_base;
  if (isNative(counterOf(pool))) return pool.reserve_counter;
  return undefined;
}
/** The value the API stores for a pool (a Float64, `amm-pools.job.ts`): 2 × the native reserve; none for a deleted pool or one without it. */
const storedValue = (pool: AmmPool): number | null => {
  const reserve = nativeReserve(pool);
  return pool.deleted || reserve === undefined ? null : new BigNumber(reserve).times(2).toNumber();
};
const marker = (values: unknown[]): string => Buffer.from(JSON.stringify(values)).toString("base64url");
const decoded = (text: string): unknown => JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
/** The list's order: `value_native` descending (the exact 2 × reserve), the pools without one last, then `amm_account` ascending. */
function listOrder(a: AmmPool, b: AmmPool): number {
  const valueOf = (pool: AmmPool) => (nativeReserve(pool) !== undefined && !pool.deleted ? new BigNumber(nativeReserve(pool)!) : undefined);
  const [x, y] = [valueOf(a), valueOf(b)];
  if (x !== undefined && y !== undefined && !x.eq(y)) return y.comparedTo(x)!;
  if (x === undefined && y !== undefined) return 1;
  if (x !== undefined && y === undefined) return -1;
  return a.amm_account < b.amm_account ? -1 : a.amm_account > b.amm_account ? 1 : 0;
}
/** The pages of a list, from its first file through the marker of each. */
function chain<K extends string, T>(first: string, next: (marker: string) => string, key: K): Array<Page<K, T>> {
  const pages: Array<Page<K, T>> = [];
  let at: string | undefined = first;
  while (at !== undefined) {
    const page = json(at) as Page<K, T>;
    pages.push(page);
    at = page.marker === undefined ? undefined : next(page.marker);
    if (pages.length > 50) throw new Error(`${first}: more than 50 pages`);
  }
  return pages;
}
const newestFirst = (a: { ledger_index: number; tx_index: number; node_index?: number }, b: { ledger_index: number; tx_index: number; node_index?: number }): number =>
  b.ledger_index - a.ledger_index || b.tx_index - a.tx_index || (b.node_index ?? 0) - (a.node_index ?? 0);
/** A plain decimal, never the exponent form: unsigned for a holding, a supply, a price, a bid and what it paid; signed only for a liquidity event's amounts. */
const UNSIGNED = /^\d+(\.\d+)?$/;
const SIGNED = /^-?\d+(\.\d+)?$/;
const isWhole = (value: unknown): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** A value with its objects' keys sorted, as `fixtureText` writes them. */
const sortedKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortedKeys)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sortedKeys(item)]))
      : value;

describe("deriveAmm over the 16 xrpl-amm ledgers alone", () => {
  // apps/api/test/amm-pools.e2e-spec.ts and amm-events.e2e-spec.ts at c3e2302: "148 state rows of 102 pools, one of them deleted", "138 swaps,
  // 8 liquidity events, a vote and a bid" (8 events of 6 pools, 3 of them XRP/RLUSD's, of the kinds create, deposit and withdraw).
  const amm = ammSet(xrpl);
  const found = deriveAmm(amm);

  it("is the 16 recorded ledgers", () => {
    expect(amm).toHaveLength(16);
  });

  it("finds what the data API's oracle finds there: 102 pools, one deleted (SNK/XRP), 148 states", () => {
    expect(found.pools).toHaveLength(102);
    expect(found.pools.filter((pool) => pool.deleted).map((pool) => pool.amm_account)).toEqual([FEATURED_POOLS["SNK/XRP"]]);
    expect(found.states).toHaveLength(148);
    expect(new Set(found.states.map((state) => state.amm_account)).size).toBe(102);
  });

  it("finds 8 liquidity events of 6 pools, a vote and a bid, and derivedExchanges 138 swaps", () => {
    expect(found.liquidity).toHaveLength(8);
    expect(new Set(found.liquidity.map((event) => event.amm_account)).size).toBe(6);
    expect(found.liquidity.filter((event) => event.amm_account === FEATURED_POOLS["XRP/RLUSD"])).toHaveLength(3);
    expect(new Set(found.liquidity.map((event) => event.event))).toEqual(new Set(["create", "deposit", "withdraw"]));
    expect(found.liquidity.some((event) => event.mode === undefined)).toBe(true);
    expect(found.governance.map((row) => row.type).sort()).toEqual(["bid", "vote"]);
    expect(derivedExchanges(amm).filter((row) => row.amm_account !== undefined)).toHaveLength(138);
  });
});

describe("the featured pools", () => {
  const names = Object.keys(FEATURED_POOLS) as Array<keyof typeof FEATURED_POOLS>;

  it("are the six real pools of the recordings the spec names", () => {
    expect(FEATURED_POOLS).toEqual({
      "XRP/RLUSD": "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3",
      "USDC/RLUSD": "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb",
      "VOX/XRP": "rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef",
      "XRP/USD": "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am",
      "DVR/XRP": "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG",
      "SNK/XRP": "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz",
    });
  });

  it("are each a derived pool whose pair, in the natural orientation, reads as its name", () => {
    // VOX/XRP's token is `VOX🗽` (its code holds the UTF-8 of the emoji, which `formatCurrency` does not decode): its name is the text's ASCII part.
    const codeName = (currency: string): string => (/^[0-9A-F]{40}$/.test(currency) ? Buffer.from(currency, "hex").toString("utf8").replace(/\0+$/, "") : currency);
    expect(codeName(baseOf(poolOf(FEATURED_POOLS["VOX/XRP"])).currency)).toBe("VOX\u{1F5FD}");
    for (const name of names) {
      const pool = poolOf(FEATURED_POOLS[name]);
      const { base, counter } = naturalOrientation(baseOf(pool), counterOf(pool), NATIVE);
      const [first, second] = name.split("/") as [string, string];
      expect([codeName(base.currency).startsWith(first), codeName(counter.currency) === second], name).toEqual([true, true]);
      if (name !== "VOX/XRP") expect(`${formatCurrency(base.currency)}/${formatCurrency(counter.currency)}`, name).toBe(name);
    }
    expect(counterOf(poolOf(FEATURED_POOLS["XRP/USD"])).issuer ?? baseOf(poolOf(FEATURED_POOLS["XRP/USD"])).issuer).toBe("rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B");
    expect(baseOf(poolOf(FEATURED_POOLS["DVR/XRP"])).issuer).toBe("rpvRJUcmqQqyCHCmYRPW9FXFAGQEcibVz9");
  });

  it("XRP/RLUSD has swaps, deposits and withdrawals", () => {
    const pool = FEATURED_POOLS["XRP/RLUSD"];
    expect(swaps.filter((row) => row.amm_account === pool).length).toBeGreaterThan(0);
    const events = new Set(derived.liquidity.filter((event) => event.amm_account === pool).map((event) => event.event));
    expect(events.has("deposit") && events.has("withdraw")).toBe(true);
  });

  it("USDC/RLUSD has neither side native and no value_native", () => {
    const pool = poolOf(FEATURED_POOLS["USDC/RLUSD"]);
    expect(isNative(baseOf(pool)) || isNative(counterOf(pool))).toBe(false);
    expect(pool).not.toHaveProperty("value_native");
    expect(pool.reserve_base).toBeDefined();
    expect(pool.reserve_counter).toBeDefined();
  });

  it("VOX/XRP has the vote of ledger 107644916, and no reserve or value (only its AMM node is recorded)", () => {
    const pool = FEATURED_POOLS["VOX/XRP"];
    const votes = derived.governance.filter((row) => row.amm_account === pool);
    expect(votes.map((row) => [row.type, row.ledger_index])).toEqual([["vote", 107644916]]);
    expect(poolOf(pool)).not.toHaveProperty("reserve_base");
    expect(poolOf(pool)).not.toHaveProperty("value_native");
  });

  it("XRP/USD has the bid of ledger 106084525", () => {
    const pool = FEATURED_POOLS["XRP/USD"];
    expect(derived.governance.filter((row) => row.amm_account === pool).map((row) => [row.type, row.ledger_index])).toEqual([["bid", 106084525]]);
  });

  it("serve each vote and bid as its transaction and the pool's AMM node say: the fee voted and the fee after, the LP tokens burned, the slot won", () => {
    for (const row of derived.governance) {
      const tx = recordedTxs.get(row.tx_hash)!;
      const amm = ammNodeOf(row.tx_hash, row.amm_account)!;
      expect(amm, row.tx_hash).toBeDefined();
      expect(row.account).toBe(tx.Account);
      if (row.type === "vote") {
        expect(tx.TransactionType).toBe("AMMVote");
        // The fee the voter asked for is the AMMVote's `TradingFee`; the fee after it the AMM node's final one.
        expect(row.fee_voted).toBe(tx.TradingFee);
        expect(row.trading_fee_after).toBe((amm.fields.TradingFee as number | undefined) ?? 0);
        continue;
      }
      expect(tx.TransactionType).toBe("AMMBid");
      // The price paid is the LP tokens the bid burned: the AMM node's LPTokenBalance before less after, positive.
      const burned = new BigNumber((amm.previous.LPTokenBalance as LpBalance)!.value).minus((amm.fields.LPTokenBalance as LpBalance)!.value);
      expect(burned.gt(0), row.tx_hash).toBe(true);
      expect(row.price_paid).toBe(burned.toFixed());
      for (const [key, field] of [["bid_min", "BidMin"], ["bid_max", "BidMax"]] as const) {
        const asked = tx[field] as { value: string } | undefined;
        expect(row[key], key).toBe(asked === undefined ? undefined : new BigNumber(asked.value).toFixed());
      }
      // The slot after the bid: the AMM node's AuctionSlot, its expiration a Ripple-epoch time.
      const slot = amm.fields.AuctionSlot as NodeSlot;
      expect(row.auction_slot).toEqual({
        ...(slot.Account !== undefined && { holder: slot.Account }),
        discounted_fee: slot.DiscountedFee ?? 0,
        ...(slot.Expiration !== undefined && { expiration: rippleIso(slot.Expiration) }),
        auth_accounts: (slot.AuthAccounts ?? []).map((entry) => entry.AuthAccount.Account),
      });
    }
    const vote = derived.governance.find((row) => row.amm_account === FEATURED_POOLS["VOX/XRP"])!;
    const bid = derived.governance.find((row) => row.amm_account === FEATURED_POOLS["XRP/USD"])!;
    expect([vote.type, bid.type]).toEqual(["vote", "bid"]);
    expect(bid.type === "bid" && bid.auction_slot?.holder).toBe(bid.account);
  });

  it("DVR/XRP was created in ledger 107612573, by the sender of its AMMCreate", () => {
    const pool = poolOf(FEATURED_POOLS["DVR/XRP"]);
    expect(pool.created_ledger).toBe(107612573);
    const create = derived.liquidity.find((event) => event.amm_account === pool.amm_account && event.event === "create");
    expect(create).toMatchObject({ ledger_index: 107612573, account: pool.created_by });
    expect(isValidClassicAddress(pool.created_by!)).toBe(true);
  });

  it("SNK/XRP is deleted, with no value_native, its last ledger 100132150", () => {
    const pool = poolOf(FEATURED_POOLS["SNK/XRP"]);
    expect(pool).toMatchObject({ deleted: true, last_ledger: 100132150, lp_supply: "0" });
    expect(pool).not.toHaveProperty("value_native");
    expect(baseOf(pool)).toEqual(SNK);
  });

  it("are the only pools with a creation in the recordings, but for DVR/XRP's, none: created_* only from a create event", () => {
    for (const pool of derived.pools) {
      const create = derived.liquidity.find((event) => event.amm_account === pool.amm_account && event.event === "create");
      if (create === undefined) {
        expect(pool, pool.amm_account).not.toHaveProperty("created_ledger");
        expect(pool, pool.amm_account).not.toHaveProperty("created_by");
      } else {
        expect(pool, pool.amm_account).toMatchObject({ created_ledger: create.ledger_index, created_by: create.account });
      }
    }
  });
});

describe("the reference's rules, on the objects before serialization", () => {
  it("has the reference's key order in every pool, state, event and swap, the slots' included", () => {
    for (const pool of derived.pools) {
      expect(Object.keys(pool), pool.amm_account).toEqual(ordered(pool, POOL_KEYS));
      if (pool.auction_slot) expect(Object.keys(pool.auction_slot)).toEqual(ordered(pool.auction_slot, SLOT_KEYS));
    }
    for (const state of derived.states) {
      expect(Object.keys(state)).toEqual(ordered(state, STATE_KEYS));
      if (state.auction_slot) expect(Object.keys(state.auction_slot)).toEqual(ordered(state.auction_slot, SLOT_KEYS));
    }
    for (const event of derived.liquidity) expect(Object.keys(event)).toEqual(ordered(event, LIQUIDITY_KEYS));
    for (const row of derived.governance) {
      expect(Object.keys(row)).toEqual(ordered(row, row.type === "vote" ? VOTE_KEYS : BID_KEYS));
      if (row.type === "bid" && row.auction_slot) expect(Object.keys(row.auction_slot)).toEqual(ordered(row.auction_slot, BID_SLOT_KEYS));
    }
    for (const row of swaps) expect(Object.keys(row)).toEqual(ordered(row, SWAP_KEYS));
    expect(swaps.length).toBeGreaterThan(0);
  });

  it("writes amounts as plain decimal strings, and fees, counts and ledgers as whole numbers, deleted a boolean, no key undefined", () => {
    const amounts = (o: object, keys: string[], pattern = UNSIGNED) => {
      for (const key of keys) {
        const value = (o as Record<string, unknown>)[key];
        if (value !== undefined) expect(value, key).toMatch(pattern);
      }
    };
    const wholes = (o: object, keys: string[]) => {
      for (const key of keys) {
        const value = (o as Record<string, unknown>)[key];
        if (value !== undefined) expect(isWhole(value), `${key} ${String(value)}`).toBe(true);
      }
    };
    for (const o of [...derived.pools, ...derived.states]) {
      amounts(o, ["reserve_base", "reserve_counter", "lp_supply"]);
      if (o.auction_slot?.price !== undefined) expect(o.auction_slot.price).toMatch(UNSIGNED);
      wholes(o, ["trading_fee", "ledger_index", "tx_index", "created_ledger", "last_ledger"]);
      if (o.auction_slot?.discounted_fee !== undefined) expect(isWhole(o.auction_slot.discounted_fee)).toBe(true);
      expect(typeof o.deleted).toBe("boolean");
      expect(Object.values(o).every((value) => value !== undefined && value !== null)).toBe(true);
    }
    for (const event of derived.liquidity) {
      amounts(event, ["base_amount", "counter_amount", "lp_tokens"], SIGNED);
      wholes(event, ["ledger_index", "tx_index"]);
    }
    for (const row of derived.governance) {
      amounts(row, ["bid_min", "bid_max", "price_paid"]);
      wholes(row, ["ledger_index", "tx_index", "fee_voted", "trading_fee_after"]);
    }
    for (const row of swaps) amounts(row, ["base_amount", "counter_amount"]);
  });

  it("writes value_native as 2 × the native reserve, a plain decimal of at most 8 significant digits; none without a native reserve or once deleted", () => {
    let valued = 0;
    for (const pool of derived.pools) {
      const reserve = nativeReserve(pool);
      if (pool.deleted || reserve === undefined) {
        expect(pool, pool.amm_account).not.toHaveProperty("value_native");
        continue;
      }
      valued++;
      expect(pool.value_native).toMatch(/^\d+(\.\d+)?$/);
      expect(pool.value_native!.replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length).toBeLessThanOrEqual(8);
      // amm-objects.ts `valueText`: the stored Float64 to 8 significant digits, written out without its trailing zeros.
      expect(pool.value_native).toBe(new BigNumber(new BigNumber(storedValue(pool)!).toPrecision(8)).toFixed());
      expect(pool.value_native).toBe(new BigNumber(reserve).times(2).precision(8).toFixed());
    }
    expect(valued).toBeGreaterThanOrEqual(20);
  });

  it("stores every pair in the API's order, of the two assets the recordings show the pool holds, the same in all its states and swaps", () => {
    // The order key of the Ripple Data API, written out here: the lower-cased currency and issuer, the native currency's issuer the text `undefined`.
    const orderKey = (asset: Asset): string => `${asset.currency}${asset.issuer ?? "undefined"}`.toLowerCase();
    const key = (asset: Asset): string => `${asset.currency}+${asset.issuer ?? ""}`;
    // A pool's assets, from the recordings: the two its AMM node names; for a pool no recorded AMM node names, those of its reserve lines (`lsfAMMNode`, the
    // pool on one side) and the native currency when its account holds a balance.
    const named = new Map<string, Set<string>>();
    const held = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, pool: string, asset: Asset) => map.set(pool, (map.get(pool) ?? new Set()).add(key(asset)));
    for (const raw of xrpl) {
      for (const tx of raw.ledger.transactions) {
        if (tx.metaData.TransactionResult !== "tesSUCCESS") continue;
        for (const node of nodesOfTx(tx.hash)) {
          if (node.type === "AMM") {
            for (const field of [node.fields.Asset, node.fields.Asset2]) {
              const { currency, issuer } = (field ?? { currency: NATIVE }) as { currency: string; issuer?: string };
              add(named, node.fields.Account as string, issuer === undefined ? { currency } : { currency, issuer });
            }
          } else if (node.type === "AccountRoot" && "AMMID" in node.fields && !new BigNumber((node.fields.Balance as string | undefined) ?? 0).isZero()) {
            add(held, node.fields.Account as string, { currency: NATIVE });
          } else if (node.type === "RippleState" && (Number(node.fields.Flags ?? 0) & 0x01000000) !== 0) {
            const [low, high] = [node.fields.LowLimit, node.fields.HighLimit] as Array<{ issuer: string; currency: string }>;
            add(held, low!.issuer, { currency: low!.currency, issuer: high!.issuer });
            add(held, high!.issuer, { currency: low!.currency, issuer: low!.issuer });
          }
        }
      }
    }
    for (const account of Object.values(FEATURED_POOLS)) expect(named.has(account), account).toBe(true);
    let byNode = 0;
    for (const pool of derived.pools) {
      expect(orderKey(baseOf(pool)) < orderKey(counterOf(pool)), pool.amm_account).toBe(true);
      const pair = new Set([key(baseOf(pool)), key(counterOf(pool))]);
      if (named.has(pool.amm_account)) byNode++;
      expect(pair, pool.amm_account).toEqual(named.get(pool.amm_account) ?? held.get(pool.amm_account));
      for (const state of derived.states.filter((s) => s.amm_account === pool.amm_account)) {
        expect([baseOf(state), counterOf(state)]).toEqual([baseOf(pool), counterOf(pool)]);
      }
    }
    expect(byNode).toBeGreaterThanOrEqual(6);
    for (const row of swaps) {
      const pool = poolOf(row.amm_account);
      expect([baseOf(row), counterOf(row)], row.tx_hash).toEqual([baseOf(pool), counterOf(pool)]);
    }
  });

  it("signs a liquidity event from the pool's side: a deposit's amounts in, a withdrawal's out, LP tokens minted positive, as its own nodes moved", () => {
    for (const event of derived.liquidity) {
      const [base, counter, lp] = [event.base_amount, event.counter_amount, event.lp_tokens].map((value) => new BigNumber(value));
      if (event.event === "create" || event.event === "deposit") {
        expect(base!.gte(0) && counter!.gte(0) && (base!.gt(0) || counter!.gt(0)), event.tx_hash).toBe(true);
        expect(lp!.gt(0), event.tx_hash).toBe(true);
      } else {
        expect(base!.lte(0) && counter!.lte(0) && (base!.lt(0) || counter!.lt(0)), event.tx_hash).toBe(true);
        expect(lp!.lt(0), event.tx_hash).toBe(true);
      }
      // The pool's holding of each side after the transaction less the one before it, read from the transaction's own nodes (E3's `nodesOf`, not the
      // generator's walk), is the event's amount: + into the pool.
      const pool = poolOf(event.amm_account);
      const nodes = nodesOfTx(event.tx_hash);
      const moved = (asset: Asset): BigNumber => {
        if (asset.issuer === undefined) {
          const root = nodes.find((node) => node.type === "AccountRoot" && node.fields.Account === pool.amm_account);
          // A side no node of the transaction holds did not move (a single-asset deposit or withdrawal).
          if (root === undefined) return new BigNumber(0);
          const after = new BigNumber(root.fields.Balance as string);
          const before = root.change === "created" ? new BigNumber(0) : new BigNumber((root.previous.Balance as string | undefined) ?? (root.fields.Balance as string));
          return after.minus(before).shiftedBy(-6);
        }
        const line = nodes.find((node) => {
          if (node.type !== "RippleState") return false;
          const [low, high] = [node.fields.LowLimit, node.fields.HighLimit] as Array<{ issuer: string; currency: string }>;
          return low!.currency === asset.currency && [low!.issuer, high!.issuer].sort().join() === [pool.amm_account, asset.issuer].sort().join();
        });
        if (line === undefined) return new BigNumber(0);
        const sign = (line.fields.LowLimit as { issuer: string }).issuer === pool.amm_account ? 1 : -1;
        const value = (fields: Record<string, unknown>) => (fields.Balance as { value: string } | undefined)?.value;
        const after = new BigNumber(value(line.fields) ?? 0).times(sign);
        const before = line.change === "created" ? new BigNumber(0) : new BigNumber(value(line.previous) ?? value(line.fields) ?? 0).times(sign);
        return after.minus(before);
      };
      expect([moved(baseOf(pool)).eq(base!), moved(counterOf(pool)).eq(counter!)], event.tx_hash).toEqual([true, true]);
      const amm = nodes.find((node) => node.type === "AMM" && node.fields.Account === pool.amm_account)!;
      const supply = (fields: Record<string, unknown>) => (fields.LPTokenBalance as { value: string } | undefined)?.value;
      const minted =
        amm.change === "created"
          ? new BigNumber(supply(amm.fields)!)
          : amm.change === "deleted"
            ? new BigNumber(supply(amm.previous) ?? supply(amm.fields)!).negated()
            : new BigNumber(supply(amm.fields)!).minus(supply(amm.previous) ?? supply(amm.fields)!);
      expect(minted.eq(lp!), event.tx_hash).toBe(true);
    }
  });

  it("takes each value of a state from its own transaction's nodes, else from the newest earlier state, and folds the last state into the pool", () => {
    type Values = Partial<Record<(typeof VALUE_KEYS)[number], string | number>>;
    /** What one transaction's nodes say of the pool, read here apart from the generator: its holdings, LP supply and currency, fee and slot. */
    const valuesOf = (hash: string, pool: AmmPool): Values => {
      const nodes = nodesOfTx(hash);
      const values: Values = {};
      const holding = (asset: Asset): string | undefined => {
        if (asset.issuer === undefined) {
          const root = nodes.find((node) => node.type === "AccountRoot" && node.fields.Account === pool.amm_account);
          return root === undefined ? undefined : new BigNumber((root.fields.Balance as string | undefined) ?? 0).shiftedBy(-6).toFixed();
        }
        const line = nodes.find((node) => {
          if (node.type !== "RippleState") return false;
          const [low, high] = [node.fields.LowLimit, node.fields.HighLimit] as Array<{ issuer: string; currency: string }>;
          return low!.currency === asset.currency && [low!.issuer, high!.issuer].sort().join() === [pool.amm_account, asset.issuer].sort().join();
        });
        if (line === undefined) return undefined;
        const sign = (line.fields.LowLimit as { issuer: string }).issuer === pool.amm_account ? 1 : -1;
        return new BigNumber((line.fields.Balance as { value: string } | undefined)?.value ?? 0).times(sign).toFixed();
      };
      const [base, counter] = [holding(baseOf(pool)), holding(counterOf(pool))];
      if (base !== undefined) values.reserve_base = base;
      if (counter !== undefined) values.reserve_counter = counter;
      const amm = nodes.find((node) => node.type === "AMM" && node.fields.Account === pool.amm_account);
      if (amm !== undefined) {
        const lp = amm.fields.LPTokenBalance as LpBalance;
        if (amm.change === "deleted") values.lp_supply = "0";
        else if (lp !== undefined) values.lp_supply = new BigNumber(lp.value).toFixed();
        if (lp !== undefined) values.lp_currency = lp.currency;
        values.trading_fee = (amm.fields.TradingFee as number | undefined) ?? 0;
        const slot = amm.fields.AuctionSlot as NodeSlot | undefined;
        if (slot !== undefined) {
          if (slot.Account !== undefined) values.holder = slot.Account;
          if (slot.Price !== undefined) values.price = new BigNumber(slot.Price.value).toFixed();
          values.discounted_fee = slot.DiscountedFee ?? 0;
          if (slot.Expiration !== undefined) values.expiration = rippleIso(slot.Expiration);
        }
      }
      return values;
    };
    const served = (state: AmmState): Values => ({
      reserve_base: state.reserve_base,
      reserve_counter: state.reserve_counter,
      lp_supply: state.lp_supply,
      lp_currency: state.lp_currency,
      trading_fee: state.trading_fee,
      holder: state.auction_slot?.holder,
      price: state.auction_slot?.price,
      discounted_fee: state.auction_slot?.discounted_fee,
      expiration: state.auction_slot?.expiration,
    });
    let fromOwn = 0;
    let carried = 0;
    for (const pool of derived.pools) {
      const own = derived.states.filter((s) => s.amm_account === pool.amm_account);
      expect(own.map((s) => [s.ledger_index, s.tx_index])).toEqual([...own].sort((a, b) => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index).map((s) => [s.ledger_index, s.tx_index]));
      let before: Values = {};
      for (const state of own) {
        const now = served(state);
        const read = valuesOf(state.tx_hash, pool);
        for (const key of VALUE_KEYS) {
          const where = `${pool.amm_account} ${state.tx_hash} ${key}`;
          if (read[key] !== undefined) {
            fromOwn++;
            expect(now[key], where).toBe(read[key]);
          } else {
            // Not in the transaction's nodes: the newest earlier state's value, or none before the first state that had one.
            if (before[key] !== undefined) carried++;
            expect(now[key], where).toBe(before[key]);
          }
        }
        before = now;
      }
      const last = own.at(-1)!;
      const { amm_account, base_currency, base_issuer, counter_currency, counter_issuer, reserve_base, reserve_counter, lp_supply, lp_currency, trading_fee, auction_slot, deleted } = last;
      const folded = { amm_account, base_currency, base_issuer, counter_currency, counter_issuer, reserve_base, reserve_counter, lp_supply, lp_currency, trading_fee, auction_slot, deleted };
      expect(pool).toMatchObject(JSON.parse(JSON.stringify(folded)));
      expect(pool.last_ledger).toBe(last.ledger_index);
    }
    // Both branches are exercised: values a transaction's nodes carry, and values carried from an earlier state.
    expect(fromOwn).toBeGreaterThan(100);
    expect(carried).toBeGreaterThan(5);
  });
});

describe("the files", () => {
  const files = ammFiles;
  const live = derived.pools.filter((pool) => !pool.deleted).sort(listOrder);

  it("are named by isAmmGenerated, which is true of no other generated file, and are on disk", () => {
    expect([...generated.keys()].filter(isAmmGenerated).sort()).toEqual([...files.keys()].sort());
    const onDisk = readdirSync(HTTP, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `${entry.parentPath.slice(HTTP.pathname.length)}/${entry.name}`.replace(/^\//, ""))
      .filter(isAmmGenerated);
    expect(onDisk.sort()).toEqual([...files.keys()].sort());
    for (const [path, text] of files) expect(read(path), path).toBe(text);
  });

  it("isAmmGenerated is true of the AMM pages' candles and live volume (Task 5), and of none of E3's candles or E2's volumes", () => {
    const pair = "524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De/XRP";
    const ours = [
      `xrpl/data-api/exchanges/${pair}@amm=only&end=2026-10-17&interval=1day&limit=400&start=2026-09-18.json`,
      `xrpl/data-api/exchanges/${pair}@amm=only&end=2026-10-17&interval=1day&limit=400&start=2026-07-20.json`,
      `xrpl/data-api/exchanges/${pair}@amm=only&end=2026-10-17&interval=7day&limit=400&start=2025-10-20.json`,
      "xrpl/data-api/network/amm_volume@live=day.json",
      "xrpl/data-api/amm/pools@limit=20.json",
    ];
    for (const path of ours) {
      expect(isAmmGenerated(path), path).toBe(true);
      expect([isSynthetic(path), isMarketGenerated(path)], path).toEqual([false, false]);
    }
    // E3's `amm=only` files of the pair page (no `end`) and E2's 30-day `amm_volume` files stay theirs: the real names the generator writes.
    const names = [...generated.keys()];
    const amm = names.filter((path) => /\/exchanges\/.*@amm=only&/.test(path));
    const [mine, theirs] = [amm.filter((path) => /@amm=only&end=/.test(path)), amm.filter((path) => !/@amm=only&end=/.test(path))];
    expect(theirs).toContain(`xrpl/data-api/exchanges/XRP/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De@amm=only&interval=1day&limit=61&start=2026-08-19T00:00:00Z.json`);
    for (const path of theirs) expect([isAmmGenerated(path), isMarketGenerated(path)], path).toEqual([false, true]);
    expect(mine).toEqual(expect.arrayContaining(ours.slice(0, 3)));
    for (const path of mine) expect([isAmmGenerated(path), isMarketGenerated(path)], path).toEqual([true, false]);
    // E2's historical files are the `amm_volume@end=…` ones; the one live set beside them is ours.
    const volumes = names.filter((path) => path.startsWith("xrpl/data-api/network/amm_volume@"));
    const historical = volumes.filter((path) => path.startsWith("xrpl/data-api/network/amm_volume@end="));
    expect(historical).toContain("xrpl/data-api/network/amm_volume@end=2026-10-17&interval=day&limit=1000&start=2026-09-18.json");
    expect(historical).toHaveLength(8);
    for (const path of historical) expect([isAmmGenerated(path), isSynthetic(path)], path).toEqual([false, true]);
    expect(volumes.filter((path) => !historical.includes(path))).toEqual(["xrpl/data-api/network/amm_volume@live=day.json"]);
  });

  it("hold a pool file for every derived pool, `{ result, pool }`, that the client's check takes", () => {
    for (const pool of derived.pools) {
      const body = json(file(`/v2/amm/pools/${pool.amm_account}`)) as { result: string; pool: AmmPool };
      expect(body).toEqual({ result: "success", pool });
      expect(checkPool(body.pool, pool.amm_account)).toEqual(pool);
    }
  });

  it("hold each featured pool by its pair too, in both orders, each side its API text", () => {
    for (const account of Object.values(FEATURED_POOLS)) {
      const pool = poolOf(account);
      for (const [a, b] of [[baseOf(pool), counterOf(pool)], [counterOf(pool), baseOf(pool)]] as const) {
        const path = `/v2/amm/pools/${encodeURIComponent(apiAssetText(a))}/${encodeURIComponent(apiAssetText(b))}`;
        expect(file(path)).toBe(`xrpl/data-api/amm/pools/${apiAssetText(a)}/${apiAssetText(b)}.json`);
        expect(json(file(path)), path).toEqual({ result: "success", pool });
      }
    }
    expect(files.has("xrpl/data-api/amm/pools/XRP/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json")).toBe(true);
  });

  it("list every live pool once, by value then account, 20 to a page chained by the marker of the last pool (value, account)", () => {
    const pages = chain<"pools", AmmPool>(file("/v2/amm/pools", "limit=20"), (m) => file("/v2/amm/pools", `limit=20&marker=${m}`), "pools");
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, i) => {
      expect(() => checkPoolsPage(page)).not.toThrow();
      expect(page.count).toBe(page.pools.length);
      const last = page.pools.at(-1)!;
      if (i < pages.length - 1) {
        expect(page.pools).toHaveLength(PAGE);
        expect(page.marker).toBe(marker([storedValue(last), last.amm_account]));
        const [value, account] = decoded(page.marker!) as [number | null, string];
        expect(account).toBe(last.amm_account);
        expect(value === null ? undefined : new BigNumber(new BigNumber(value).toPrecision(8)).toFixed()).toBe(last.value_native);
      } else {
        expect(page.pools.length).toBeLessThanOrEqual(PAGE);
        expect(page).not.toHaveProperty("marker");
      }
    });
    const listed = pages.flatMap((page) => page.pools);
    expect(listed).toEqual(live);
    expect(listed.some((pool) => pool.value_native === undefined)).toBe(true);
    expect(listed.findIndex((pool) => pool.value_native === undefined)).toBeGreaterThan(0);
  });

  it("list every pool once with include_deleted=true, the deleted ones too, in the same order and with the same markers as the live list", () => {
    const pages = chain<"pools", AmmPool>(
      file("/v2/amm/pools", "include_deleted=true&limit=20"),
      (m) => file("/v2/amm/pools", `include_deleted=true&limit=20&marker=${m}`),
      "pools",
    );
    pages.forEach((page, i) => {
      expect(() => checkPoolsPage(page)).not.toThrow();
      expect(page.count).toBe(page.pools.length);
      const last = page.pools.at(-1)!;
      if (i < pages.length - 1) {
        expect(page.pools).toHaveLength(PAGE);
        expect(page.marker).toBe(marker([storedValue(last), last.amm_account]));
      } else {
        expect(page).not.toHaveProperty("marker");
      }
    });
    const everything = [...derived.pools].sort(listOrder);
    expect(pages.flatMap((page) => page.pools)).toEqual(everything);
    const deleted = everything.filter((pool) => pool.deleted);
    expect(deleted.map((pool) => pool.amm_account)).toEqual([FEATURED_POOLS["SNK/XRP"]]);
    // A deleted pool has no value: it is among the pools without one, so the pages before it are the live list's.
    const at = pages.findIndex((page) => page.pools.some((pool) => pool.deleted));
    expect(at).toBeGreaterThan(0);
    const livePage = (m?: string) => json(file("/v2/amm/pools", m === undefined ? "limit=20" : `limit=20&marker=${m}`)) as Page<"pools", AmmPool>;
    for (let i = 0; i < at; i += 1) expect(pages[i]).toEqual(livePage(i === 0 ? undefined : pages[i - 1]!.marker));
  });

  it("hold the first page of each filter: pools with the asset on either side, deleted ones only when asked", () => {
    const has = (asset: Asset) => (pool: AmmPool) => sameAsset(baseOf(pool), asset) || sameAsset(counterOf(pool), asset);
    const cases: Array<{ query: string; pools: AmmPool[] }> = [
      { query: "asset=XRP&limit=20", pools: live.filter(has(XRP)) },
      { query: `asset=${encodeURIComponent(apiAssetText(RLUSD))}&limit=20`, pools: live.filter(has(RLUSD)) },
      { query: `asset=${encodeURIComponent(apiAssetText(SNK))}&include_deleted=true&limit=20`, pools: [...derived.pools].sort(listOrder).filter(has(SNK)) },
    ];
    for (const { query, pools } of cases) {
      const page = json(file("/v2/amm/pools", query)) as Page<"pools", AmmPool>;
      expect(() => checkPoolsPage(page)).not.toThrow();
      expect(page.pools, query).toEqual(pools.slice(0, PAGE));
      expect(page.count).toBe(page.pools.length);
      if (pools.length > PAGE) expect(page.marker).toBe(marker([storedValue(pools[PAGE - 1]!), pools[PAGE - 1]!.amm_account]));
      else expect(page).not.toHaveProperty("marker");
    }
    expect(files.has("xrpl/data-api/amm/pools@asset=524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De&limit=20.json")).toBe(true);
    expect(files.has("xrpl/data-api/amm/pools@asset=SNK+rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm&include_deleted=true&limit=20.json")).toBe(true);
    const snk = json(file("/v2/amm/pools", cases[2]!.query)) as Page<"pools", AmmPool>;
    expect(snk.pools.some((pool) => pool.amm_account === FEATURED_POOLS["SNK/XRP"] && pool.deleted)).toBe(true);
  });

  /** The event lists of a featured pool: each split in two pages when it has two rows or more (the newer half, rounded up, first), else one. */
  function expectSplit<K extends string, T extends { ledger_index: number; tx_index: number }>(
    pool: string,
    tab: string,
    key: K,
    rows: T[],
    markerOf: (row: T) => string,
    check: (page: unknown) => unknown,
  ): void {
    const path = `/v2/amm/pools/${pool}/${tab}`;
    const pages = chain<K, T>(file(path, "descending=true&limit=20"), (m) => file(path, `descending=true&limit=20&marker=${m}`), key);
    const expected = [...rows].sort(newestFirst);
    expect(pages, `${pool} ${tab}`).toHaveLength(expected.length >= 2 ? 2 : 1);
    if (expected.length >= 2) {
      const half = Math.ceil(expected.length / 2);
      expect(pages[0]![key]).toHaveLength(half);
      expect(pages[0]!.marker).toBe(markerOf(expected[half - 1]!));
      expect(pages[1]).not.toHaveProperty("marker");
    } else {
      expect(pages[0]).not.toHaveProperty("marker");
    }
    for (const page of pages) {
      expect(() => check(page), `${pool} ${tab}`).not.toThrow();
      expect(page.count).toBe(page[key].length);
    }
    expect(pages.flatMap((page) => page[key]), `${pool} ${tab}`).toEqual(expected);
  }

  it("hold each featured pool's swaps, liquidity and governance, every derived row once, newest first, in pages chained by marker", () => {
    let split = 0;
    for (const pool of Object.values(FEATURED_POOLS)) {
      const own = <T extends { amm_account: string }>(rows: T[]) => rows.filter((row) => row.amm_account === pool);
      expectSplit(pool, "swaps", "exchanges", own(swaps), (row) => marker([row.ledger_index, row.tx_index, row.node_index]), checkSwapsPage);
      expectSplit(pool, "liquidity", "liquidity", own(derived.liquidity), (row) => txMarker(row.ledger_index, row.tx_index), (page) => checkLiquidityPage(page));
      expectSplit(pool, "governance", "governance", own(derived.governance), (row) => txMarker(row.ledger_index, row.tx_index), checkGovernancePage);
      split += [own(swaps), own(derived.liquidity), own(derived.governance)].filter((rows) => rows.length >= 2).length;
    }
    expect(split).toBeGreaterThanOrEqual(2);
  });

  it("hold each featured pool's create event, or an empty list where the recordings have none", () => {
    for (const pool of Object.values(FEATURED_POOLS)) {
      const page = json(file(`/v2/amm/pools/${pool}/liquidity`, "event=create&limit=1")) as Page<"liquidity", AmmLiquidityEvent>;
      expect(() => checkLiquidityPage(page, "create")).not.toThrow();
      const create = derived.liquidity.filter((event) => event.amm_account === pool && event.event === "create");
      expect(page).toEqual({ result: "success", count: create.length, liquidity: create.slice(0, 1) });
    }
    expect((json(file(`/v2/amm/pools/${FEATURED_POOLS["DVR/XRP"]}/liquidity`, "event=create&limit=1")) as Page<"liquidity", AmmLiquidityEvent>).count).toBe(1);
  });

  it("write a list's rows one to a line, keys sorted, as fixtureText does: a pool, a swap, an event, a day, a candle, a volume component", () => {
    let rows = 0;
    for (const [path, text] of files) {
      const body = JSON.parse(text) as Record<string, unknown>;
      const lines = text.split("\n").map((line) => line.trim().replace(/,$/, ""));
      // The live volume's one row holds its components, one to a line.
      const live = Array.isArray(body.rows) ? (body.rows as Array<{ components: unknown[] }>).flatMap((row) => row.components) : undefined;
      const list = ["pools", "exchanges", "liquidity", "governance", "days"].find((key) => Array.isArray(body[key]));
      const listed = live ?? (list === undefined ? undefined : (body[list] as unknown[]));
      if (listed === undefined) {
        expect(text, path).toBe(fixtureText(body));
        continue;
      }
      for (const row of listed) expect(lines, path).toContain(JSON.stringify(sortedKeys(row)));
      rows += listed.length;
    }
    expect(rows).toBeGreaterThan(500);
  });

  it("write no swap, event or governance row that is not the derived one", () => {
    // The pool routes' files; the candles below `exchanges/` and the day rows are synthetic (the next block).
    for (const [path, text] of [...files].filter(([path]) => path.startsWith("xrpl/data-api/amm/"))) {
      const body = JSON.parse(text) as { exchanges?: PairExchange[]; liquidity?: AmmLiquidityEvent[]; governance?: AmmGovernanceRow[] };
      for (const row of body.exchanges ?? []) expect(swaps, path).toContainEqual(row);
      for (const row of body.liquidity ?? []) expect(derived.liquidity, path).toContainEqual(row);
      for (const row of body.governance ?? []) expect(derived.governance, path).toContainEqual(row);
    }
  });
});

describe("the featured pools' amm_info (AMM_INFO_POOLS)", () => {
  it("are XRP/RLUSD (E3's) and USDC/RLUSD, XRP/USD and DVR/XRP, each in its natural orientation; VOX/XRP has none (only its vote is recorded)", () => {
    expect(AMM_INFO_POOLS.map((entry) => entry.pool)).toEqual([FEATURED_POOLS["XRP/RLUSD"], FEATURED_POOLS["USDC/RLUSD"], FEATURED_POOLS["XRP/USD"], FEATURED_POOLS["DVR/XRP"]]);
    for (const entry of AMM_INFO_POOLS) {
      const pool = poolOf(entry.pool);
      const { base, counter } = naturalOrientation(baseOf(pool), counterOf(pool), NATIVE);
      expect([entry.asset, entry.asset2], entry.pool).toEqual([base, counter]);
      expect(generated.has(`xrpl/node/amm_info/${entry.pool}.json`)).toBe(true);
    }
    expect(generated.has(`xrpl/node/amm_info/${FEATURED_POOLS["VOX/XRP"]}.json`)).toBe(false);
  });

  it("hold the same reserves, LP supply, fee and auction slot as the derived pool: two derivations of the same nodes agree", () => {
    for (const entry of AMM_INFO_POOLS) {
      const pool = poolOf(entry.pool);
      const { amm } = ammInfoResult(xrpl, entry) as {
        amm: {
          amount: unknown;
          amount2: unknown;
          lp_token: { value: string; currency: string };
          trading_fee: number;
          auction_slot?: { account?: string; discounted_fee: number; expiration: string; price: { value: string } };
        };
      };
      const holding = (asset: Asset): string => {
        for (const amount of [amm.amount, amm.amount2]) {
          if (typeof amount === "string" && asset.issuer === undefined) return new BigNumber(amount).shiftedBy(-6).toFixed();
          if (typeof amount === "object" && amount !== null && sameAsset(amount as Asset, asset)) return (amount as { value: string }).value;
        }
        throw new Error(`${entry.pool}: amm_info holds no ${asset.currency}`);
      };
      expect(new BigNumber(holding(baseOf(pool))).eq(pool.reserve_base!), entry.pool).toBe(true);
      expect(new BigNumber(holding(counterOf(pool))).eq(pool.reserve_counter!), entry.pool).toBe(true);
      expect(new BigNumber(amm.lp_token.value).eq(pool.lp_supply!), entry.pool).toBe(true);
      expect(amm.lp_token.currency).toBe(pool.lp_currency);
      expect(amm.trading_fee).toBe(pool.trading_fee);
      // The auction slot: the holder, the discounted fee, the price and the expiration, as one instant (the node writes `+0000`, the API `Z`).
      const slot = amm.auction_slot;
      expect(slot, entry.pool).toBeDefined();
      expect(slot!.account).toBe(pool.auction_slot!.holder);
      expect(slot!.discounted_fee).toBe(pool.auction_slot!.discounted_fee);
      expect(new BigNumber(slot!.price.value).eq(pool.auction_slot!.price!), entry.pool).toBe(true);
      expect(Date.parse(slot!.expiration.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")), entry.pool).toBe(Date.parse(pool.auction_slot!.expiration!));
    }
  });
});

describe("the synthetic day rows, candles and live volume", () => {
  // The day rows (`history?interval=day`), the pairs' AMM-only candles and the live `amm_volume` set are synthetic: one seeded daily series per featured pool,
  // of which the files are views by the API's rules, and one seeded live set. P2 of E5 scopes them: every period of XRP/RLUSD; the 90 days of USDC/RLUSD and
  // XRP/USD; DVR/XRP's creation in the 30 days; SNK/XRP's deletion in the year; VOX/XRP's 90 days, each empty (P3: it has no series, but the index has its
  // states, so its day rows are empty lists, not `pool not found`; docs/api-reference.md "Empty and 404"). The rules are written out here again, apart from the
  // generator: the windows, the carry-in and its marker, the estimates, the candles (E3's rules) and the live set (docs/api-reference.md, "AMM" and
  // `/v2/network/amm_volume`; apps/api/src/network/volume-object.ts).
  const T = "2026-10-17";
  const LAST_DAY = "2026-10-16";
  const WINDOWS = {
    "30d": { start: "2026-09-18", carry: "2026-09-17", interval: "1day", days: 1 },
    "90d": { start: "2026-07-20", carry: "2026-07-19", interval: "1day", days: 1 },
    "1y": { start: "2025-10-20", carry: "2025-10-19", interval: "7day", days: 7 },
  } as const;
  type Period = keyof typeof WINDOWS;
  type Name = "XRP/RLUSD" | "USDC/RLUSD" | "XRP/USD" | "DVR/XRP" | "SNK/XRP";
  const SCOPE: Record<Name, { windows: Period[]; carryIns: Period[] }> = {
    "XRP/RLUSD": { windows: ["30d", "90d", "1y"], carryIns: ["30d", "90d", "1y"] },
    "USDC/RLUSD": { windows: ["90d"], carryIns: ["90d"] },
    "XRP/USD": { windows: ["90d"], carryIns: ["90d"] },
    "DVR/XRP": { windows: ["30d"], carryIns: ["30d", "90d", "1y"] },
    "SNK/XRP": { windows: ["30d", "90d", "1y"], carryIns: ["30d", "90d", "1y"] },
  };
  const NAMES = Object.keys(SCOPE) as Name[];
  /** The keys of a PoolDay (amm-objects.ts), a candle (docs/api-reference.md, "Candles"), a volume row and an AMM component (volume-object.ts), in order. */
  const DAY_KEYS = [
    "amm_account", "date", "base_currency", "base_issuer", "counter_currency", "counter_issuer", "swap_count", "volume_base", "volume_counter", "fees_base_est",
    "fees_counter_est", "deposit_count", "withdraw_count", "liquidity_in_base", "liquidity_in_counter", "liquidity_out_base", "liquidity_out_counter", "reserve_base",
    "reserve_counter", "lp_supply", "trading_fee", "value_native",
  ];
  const CANDLE_KEYS = [
    "base_volume", "buy_volume", "close", "close_time", "count", "counter_volume", "high", "low", "open", "open_time", "start", "vwap", "base_currency", "base_issuer",
    "counter_currency", "counter_issuer",
  ];
  const ROW_KEYS = ["components", "count", "exchange", "total", "exchange_rate", "start_time", "end_time"];
  const COMPONENT_KEYS = ["amm_account", "base", "counter", "count", "amount", "rate", "converted_amount"];
  /** Room for the API's quotients of exact decimals, and its 8 significant digits of a rate or a price. */
  const Exact = BigNumber.clone({ DECIMAL_PLACES: 60 });
  const precision8 = (value: BigNumber.Value): string => new BigNumber(value).toPrecision(8);
  const sum = (values: readonly BigNumber.Value[]): BigNumber => values.reduce<BigNumber>((total, value) => total.plus(value), new BigNumber(0));

  const files = ammFiles;
  const series = ammSeries(xrpl);
  const seriesOf = (name: Name) => {
    const found = series.find((one) => one.name === name);
    if (found === undefined) throw new Error(`${name}: no series`);
    return found;
  };
  const accountOf = (name: Name): string => FEATURED_POOLS[name];
  const dayOf = (row: { date: string }): string => row.date.slice(0, 10);
  const secondsOf = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000;
  const addDays = (day: string, days: number): string => new Date((secondsOf(day) + days * 86_400) * 1000).toISOString().slice(0, 10);
  const history = (name: Name) => `/v2/amm/pools/${accountOf(name)}/history`;
  const windowFile = (name: Name, period: Period) => file(history(name), `end=${T}&interval=day&limit=1000&start=${WINDOWS[period].start}`);
  const carryFile = (name: Name, period: Period) => file(history(name), `descending=true&end=${WINDOWS[period].carry}&interval=day&limit=1`);
  const lastDayFile = (name: Name) => file(history(name), `end=${LAST_DAY}&interval=day&limit=1&start=${LAST_DAY}`);
  const candleFile = (name: Name, period: Period) => {
    const pool = poolOf(accountOf(name));
    const pair = `/v2/exchanges/${encodeURIComponent(apiAssetText(baseOf(pool)))}/${encodeURIComponent(apiAssetText(counterOf(pool)))}`;
    return file(pair, `amm=only&end=${T}&interval=${WINDOWS[period].interval}&limit=400&start=${WINDOWS[period].start}`);
  };
  const LIVE = file("/v2/network/amm_volume", "live=day");
  const daysPage = (path: string) => json(path) as Page<"days", AmmPoolDay>;
  const candlePage = (path: string) => json(path) as Page<"exchanges", Candle>;
  /** The pool's recorded liquidity events of a day (the derived ones, which the Liquidity tab lists). */
  const eventsOf = (name: Name, day: string) => derived.liquidity.filter((event) => event.amm_account === accountOf(name) && event.executed_time.slice(0, 10) === day);
  const EMPTY = { result: "success", count: 0, days: [] };

  it("are at T, the UTC day of the recorded last_validated, in E2's windows: the 30 and 90 days to T, the 52 weeks from Monday", () => {
    expect(isoTime(unixOf(xrpl.at(-1)!.ledger.close_time))).toBe("2026-10-17T17:01:12Z");
    for (const period of Object.keys(WINDOWS) as Period[]) {
      const w = windowOf(T, period);
      expect([w.start, w.end], period).toEqual([WINDOWS[period].start, T]);
      expect(addDays(w.start, -1)).toBe(WINDOWS[period].carry);
    }
    expect(new Date(`${WINDOWS["1y"].start}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  /** VOX/XRP's four files: its 90 days' rows, carry-in and candles, and its last day. */
  const voxFiles = (): string[] => {
    const account = FEATURED_POOLS["VOX/XRP"];
    const vox = poolOf(account);
    const voxHistory = `/v2/amm/pools/${account}/history`;
    const pair = `/v2/exchanges/${encodeURIComponent(apiAssetText(baseOf(vox)))}/${encodeURIComponent(apiAssetText(counterOf(vox)))}`;
    return [
      file(voxHistory, `end=${T}&interval=day&limit=1000&start=${WINDOWS["90d"].start}`),
      file(voxHistory, `descending=true&end=${WINDOWS["90d"].carry}&interval=day&limit=1`),
      file(voxHistory, `end=${LAST_DAY}&interval=day&limit=1&start=${LAST_DAY}`),
      file(pair, `amm=only&end=${T}&interval=1day&limit=400&start=${WINDOWS["90d"].start}`),
    ];
  };

  it("are the files P2 scopes, and no more: each pool's windows, carry-ins, last day and candles, the live set, and VOX/XRP's 90 days", () => {
    const expected = [
      LIVE,
      ...NAMES.flatMap((name) => [
        ...SCOPE[name].windows.flatMap((period) => [windowFile(name, period), candleFile(name, period)]),
        ...SCOPE[name].carryIns.map((period) => carryFile(name, period)),
        lastDayFile(name),
      ]),
      ...voxFiles(),
    ];
    const synthetic = [...files.keys()].filter((path) => /\/history@/.test(path) || !path.startsWith("xrpl/data-api/amm/"));
    expect(synthetic.sort()).toEqual([...new Set(expected)].sort());
    expect(expected).toHaveLength(new Set(expected).size);
    for (const path of synthetic) expect(isAmmGenerated(path), path).toBe(true);
    expect(series.map((one) => one.name).sort()).toEqual([...NAMES].sort());
  });

  it("answer VOX/XRP's day rows, carry-in and last day with empty lists and no marker, and its pair with no candles", () => {
    const [window, carry, last, candles] = voxFiles();
    for (const path of [window!, carry!, last!]) expect(daysPage(path), path).toEqual(EMPTY);
    expect(candlePage(candles!)).toEqual({ result: "success", count: 0, exchanges: [] });
    expect(series.some((one) => one.pool.amm_account === FEATURED_POOLS["VOX/XRP"])).toBe(false);
  });

  it("hold one series per pool: days from 2025-10-01 or its creation to T or its deletion, oldest first, each once, quiet days without a row", () => {
    for (const name of NAMES) {
      const { pool, days } = seriesOf(name);
      expect(pool).toEqual(poolOf(accountOf(name)));
      const dates = days.map(dayOf);
      expect(dates, name).toEqual([...new Set(dates)].sort());
      expect(dates[0]! >= "2025-10-01" && dates.at(-1)! <= T, name).toBe(true);
      for (const row of days) {
        expect(row.date).toBe(`${dayOf(row)}T00:00:00Z`);
        expect(row.amm_account).toBe(pool.amm_account);
        expect([row.base_currency, row.base_issuer, row.counter_currency, row.counter_issuer]).toEqual([pool.base_currency, pool.base_issuer, pool.counter_currency, pool.counter_issuer]);
      }
    }
    // A pool that has no creation in the recordings has days from before the year's window; the busy pool has quiet days in every window.
    for (const name of ["XRP/RLUSD", "USDC/RLUSD", "XRP/USD", "SNK/XRP"] as const) expect(dayOf(seriesOf(name).days[0]!) < WINDOWS["1y"].carry, name).toBe(true);
    for (const period of ["30d", "90d", "1y"] as const) {
      const span = (secondsOf(T) - secondsOf(WINDOWS[period].start)) / 86_400 + 1;
      expect(daysPage(windowFile("XRP/RLUSD", period)).days.length, period).toBeLessThan(span);
    }
  });

  it("hold in each window the rows whose day is from its start to T, oldest first, within the limit; the 30 days the 90 days' last rows, the 90 days the year's", () => {
    for (const name of NAMES) {
      const { days } = seriesOf(name);
      const pages = new Map<Period, Page<"days", AmmPoolDay>>();
      for (const period of SCOPE[name].windows) {
        const page = daysPage(windowFile(name, period));
        expect(() => checkDaysPage(page)).not.toThrow();
        const rows = days.filter((row) => dayOf(row) >= WINDOWS[period].start && dayOf(row) <= T);
        expect(rows.length).toBeLessThanOrEqual(1000);
        expect(page, `${name} ${period}`).toEqual({ result: "success", count: rows.length, days: rows });
        pages.set(period, page);
      }
      const [month, quarter, year] = [pages.get("30d"), pages.get("90d"), pages.get("1y")];
      if (month && quarter) expect(quarter.days.slice(quarter.days.length - month.days.length), name).toEqual(month.days);
      if (quarter && year) expect(year.days.slice(year.days.length - quarter.days.length), name).toEqual(quarter.days);
    }
    expect(daysPage(windowFile("XRP/RLUSD", "1y")).days.length).toBeGreaterThan(200);
  });

  it("answer each carry-in with the newest row on or before its end, with the marker of that day when older rows exist, else an empty list; the last day its row", () => {
    for (const name of NAMES) {
      const { days } = seriesOf(name);
      for (const period of SCOPE[name].carryIns) {
        const page = daysPage(carryFile(name, period));
        expect(() => checkDaysPage(page)).not.toThrow();
        const before = days.filter((row) => dayOf(row) <= WINDOWS[period].carry);
        const newest = before.at(-1);
        // The marker of a page of days is the start of its last day, in unix seconds (amm-pools.service.ts `days`, `encodeMarker`).
        const expected =
          newest === undefined ? EMPTY : { result: "success", count: 1, ...(before.length > 1 && { marker: marker([secondsOf(dayOf(newest))]) }), days: [newest] };
        expect(page, `${name} ${period}`).toEqual(expected);
      }
      const last = days.filter((row) => dayOf(row) === LAST_DAY);
      expect(daysPage(lastDayFile(name)), name).toEqual({ result: "success", count: last.length, days: last });
    }
    for (const period of ["30d", "90d", "1y"] as const) {
      const page = daysPage(carryFile("XRP/RLUSD", period));
      expect(decoded(page.marker!), period).toEqual([secondsOf(dayOf(page.days[0]!))]);
    }
    expect(daysPage(lastDayFile("XRP/RLUSD")).count).toBe(1);
  });

  it("start DVR/XRP's days on its creation, inside the 30 days and with nothing before; end SNK/XRP's on its deletion, inside the year and before the 30 and 90 days", () => {
    const dvr = seriesOf("DVR/XRP").days;
    const created = derived.liquidity.find((event) => event.amm_account === accountOf("DVR/XRP") && event.event === "create")!;
    expect(created.executed_time.slice(0, 10)).toBe("2026-10-12");
    expect(dvr[0]!.date).toBe("2026-10-12T00:00:00Z");
    expect(daysPage(windowFile("DVR/XRP", "30d")).days[0]).toEqual(dvr[0]);
    for (const period of ["30d", "90d", "1y"] as const) expect(daysPage(carryFile("DVR/XRP", period)), period).toEqual(EMPTY);
    // The creation counts as the day's deposit.
    expect(dvr[0]).toMatchObject({ deposit_count: 1, withdraw_count: 0, liquidity_in_base: created.base_amount, liquidity_in_counter: created.counter_amount });
    expect([dvr[0]!.liquidity_out_base, dvr[0]!.liquidity_out_counter]).toEqual(["0", "0"]);

    const snk = seriesOf("SNK/XRP").days;
    const pool = poolOf(accountOf("SNK/XRP"));
    const deletion = derived.states.filter((state) => state.amm_account === pool.amm_account).at(-1)!;
    expect([deletion.ledger_index, deletion.executed_time.slice(0, 10)]).toEqual([100132150, "2025-11-11"]);
    expect(snk.at(-1)!.date).toBe("2025-11-11T00:00:00Z");
    expect(daysPage(windowFile("SNK/XRP", "1y")).days.at(-1)).toEqual(snk.at(-1));
    for (const period of ["30d", "90d"] as const) expect(daysPage(windowFile("SNK/XRP", period)), period).toEqual(EMPTY);
    for (const period of ["30d", "90d"] as const) expect(daysPage(carryFile("SNK/XRP", period)).days, period).toEqual([snk.at(-1)]);
    // The withdrawal that emptied it is the day's: its amounts went out, and the day closes in the deleted pool's state, without a value.
    const emptied = derived.liquidity.find((event) => event.amm_account === pool.amm_account && event.event === "withdraw")!;
    expect(snk.at(-1)).toMatchObject({
      withdraw_count: 1,
      liquidity_out_base: new BigNumber(emptied.base_amount).negated().toString(),
      liquidity_out_counter: new BigNumber(emptied.counter_amount).negated().toString(),
      reserve_base: pool.reserve_base,
      reserve_counter: pool.reserve_counter,
      lp_supply: pool.lp_supply,
      trading_fee: pool.trading_fee,
    });
    expect(snk.at(-1)).not.toHaveProperty("value_native");
  });

  it("close each live featured pool's day T, the day so far, in its derived pool's state: the reserves, LP supply, fee and value", () => {
    const livePools = NAMES.filter((name) => !poolOf(accountOf(name)).deleted);
    expect(livePools).toEqual(["XRP/RLUSD", "USDC/RLUSD", "XRP/USD", "DVR/XRP"]);
    for (const name of livePools) {
      const pool = poolOf(accountOf(name));
      const last = seriesOf(name).days.at(-1)!;
      expect(last.date, name).toBe(`${T}T00:00:00Z`);
      expect(last.swap_count).toBeGreaterThan(0);
      expect([last.reserve_base, last.reserve_counter, last.lp_supply, last.trading_fee, last.value_native], name).toEqual([
        pool.reserve_base,
        pool.reserve_counter,
        pool.lp_supply,
        pool.trading_fee,
        pool.value_native,
      ]);
      expect(daysPage(windowFile(name, SCOPE[name].windows[0]!)).days.at(-1), name).toEqual(last);
    }
  });

  it("count each day's recorded liquidity events of the pool, a creation as a deposit, and none on the other days", () => {
    for (const name of NAMES) {
      const { days } = seriesOf(name);
      const [first, last] = [dayOf(days[0]!), dayOf(days.at(-1)!)];
      for (const event of derived.liquidity.filter((e) => e.amm_account === accountOf(name))) {
        const day = event.executed_time.slice(0, 10);
        if (day >= first && day <= last) expect(days.map(dayOf), `${name} ${day}`).toContain(day);
      }
      for (const row of days) {
        const events = eventsOf(name, dayOf(row));
        const flow = (side: "base_amount" | "counter_amount", sign: 1 | -1) => sum(events.map((e) => BigNumber.max(new BigNumber(e[side]).times(sign), 0)));
        expect(row.deposit_count, row.date).toBe(events.filter((e) => e.event === "create" || e.event === "deposit").length);
        expect(row.withdraw_count, row.date).toBe(events.filter((e) => e.event === "withdraw" || e.event === "clawback").length);
        expect(new BigNumber(row.liquidity_in_base).eq(flow("base_amount", 1)), row.date).toBe(true);
        expect(new BigNumber(row.liquidity_in_counter).eq(flow("counter_amount", 1)), row.date).toBe(true);
        expect(new BigNumber(row.liquidity_out_base).eq(flow("base_amount", -1)), row.date).toBe(true);
        expect(new BigNumber(row.liquidity_out_counter).eq(flow("counter_amount", -1)), row.date).toBe(true);
        if (events.length === 0) expect([row.liquidity_in_base, row.liquidity_in_counter, row.liquidity_out_base, row.liquidity_out_counter]).toEqual(["0", "0", "0", "0"]);
      }
    }
    const rlusd = seriesOf("XRP/RLUSD").days;
    expect(rlusd.find((row) => dayOf(row) === "2026-10-16")).toMatchObject({ deposit_count: 2, withdraw_count: 0 });
    expect(rlusd.at(-1)).toMatchObject({ deposit_count: 0, withdraw_count: 1 });
  });

  it("estimate each side's fees as its volume × trading_fee / 100000, exactly, on every row but XRP/RLUSD's 2026-10-10, which has swaps both ways and neither", () => {
    let knownZero = 0;
    for (const name of NAMES) {
      for (const row of seriesOf(name).days) {
        expect(row.swap_count, row.date).toBeGreaterThan(0);
        if (name === "XRP/RLUSD" && dayOf(row) === "2026-10-10") {
          // An estimate is left out when a swap into its side had no known fee: both sides had swaps into them.
          expect(row).not.toHaveProperty("fees_base_est");
          expect(row).not.toHaveProperty("fees_counter_est");
          expect(new BigNumber(row.volume_base).gt(0) && new BigNumber(row.volume_counter).gt(0)).toBe(true);
          continue;
        }
        for (const side of ["base", "counter"] as const) {
          const estimate = row[`fees_${side}_est`];
          expect(estimate, `${name} ${row.date} ${side}`).toBeDefined();
          expect(new BigNumber(estimate!).eq(new BigNumber(row[`volume_${side}`]).times(row.trading_fee!).shiftedBy(-5)), `${name} ${row.date} ${side}`).toBe(true);
          if (estimate === "0") knownZero++;
        }
      }
    }
    // A side no swap went into has the known zero, "0", not a missing estimate.
    expect(knownZero).toBeGreaterThan(0);
    expect(daysPage(windowFile("XRP/RLUSD", "30d")).days.filter((row) => !("fees_base_est" in row)).map((row) => row.date)).toEqual(["2026-10-10T00:00:00Z"]);
  });

  it("write value_native as 2 × the closing native reserve, as a pool's (valueText); none for USDC/RLUSD or for the day of the deletion", () => {
    for (const name of NAMES) {
      const { pool, days } = seriesOf(name);
      for (const row of days) {
        const reserve = isNative(counterOf(pool)) ? row.reserve_counter : isNative(baseOf(pool)) ? row.reserve_base : undefined;
        if (reserve === undefined || (pool.deleted && row === days.at(-1))) {
          expect(row, `${name} ${row.date}`).not.toHaveProperty("value_native");
          continue;
        }
        expect(row.value_native, `${name} ${row.date}`).toBe(new BigNumber(new BigNumber(new BigNumber(reserve).times(2).toNumber()).toPrecision(8)).toFixed());
      }
    }
    expect(seriesOf("USDC/RLUSD").days.some((row) => "value_native" in row)).toBe(false);
  });

  it("give each day with swaps its candle in the stored pair, its count the day's swaps: the day's volume went in, the base the takers bought went out", () => {
    for (const name of NAMES) {
      const pool = poolOf(accountOf(name));
      for (const period of SCOPE[name].windows.filter((p) => p !== "1y")) {
        const page = candlePage(candleFile(name, period));
        expect(() => checkCandles(page)).not.toThrow();
        expect(page.count).toBe(page.exchanges.length);
        expect(page).not.toHaveProperty("marker");
        const rows = daysPage(windowFile(name, period)).days.filter((row) => row.swap_count > 0);
        expect(page.exchanges.map((candle) => candle.start), `${name} ${period}`).toEqual(rows.map((row) => row.date));
        page.exchanges.forEach((candle, at) => {
          const row = rows[at]!;
          const where = `${name} ${candle.start}`;
          expect(candle.count, where).toBe(row.swap_count);
          expect([candle.base_currency, candle.base_issuer, candle.counter_currency, candle.counter_issuer]).toEqual([pool.base_currency, pool.base_issuer, pool.counter_currency, pool.counter_issuer]);
          expect(new BigNumber(candle.base_volume).minus(String(candle.buy_volume)).eq(row.volume_base), where).toBe(true);
          expect(new BigNumber(candle.counter_volume).gt(row.volume_counter) || new BigNumber(candle.counter_volume).eq(row.volume_counter), where).toBe(true);
          expect(candle.open_time >= candle.start && candle.open_time <= candle.close_time && candle.close_time < `${addDays(dayOf(row), 1)}T00:00:00Z`, where).toBe(true);
          for (const price of [candle.open, candle.high, candle.low, candle.close, candle.vwap]) expect(precision8(price), where).toBe(price);
          const [low, high] = [Number(candle.low), Number(candle.high)];
          for (const price of [candle.open, candle.close, candle.vwap]) expect(Number(price) >= low && Number(price) <= high, where).toBe(true);
          expect(candle.vwap, where).toBe(precision8(new Exact(candle.counter_volume).dividedBy(candle.base_volume)));
          // The swaps of a day are at the pool's closing price, to the digits of their amounts.
          const closing = new Exact(row.reserve_counter!).dividedBy(row.reserve_base!);
          expect(new Exact(candle.close).dividedBy(closing).minus(1).abs().lt(0.002), where).toBe(true);
        });
      }
    }
  });

  it("add up a week's days in its 7day candle, from Monday: the counts and what went in of the day rows, and the day candles of a week inside the 90 days", () => {
    let compared = 0;
    for (const name of NAMES.filter((n) => SCOPE[n].windows.includes("1y"))) {
      const page = candlePage(candleFile(name, "1y"));
      expect(() => checkCandles(page)).not.toThrow();
      const rows = daysPage(windowFile(name, "1y")).days;
      const daily = SCOPE[name].windows.includes("90d") ? candlePage(candleFile(name, "90d")).exchanges : [];
      const weekOf = (day: string) => addDays(WINDOWS["1y"].start, Math.floor((secondsOf(day) - secondsOf(WINDOWS["1y"].start)) / 604_800) * 7);
      expect(page.exchanges.map((candle) => candle.start), name).toEqual([...new Set(rows.map((row) => weekOf(dayOf(row))))].map((week) => `${week}T00:00:00Z`));
      for (const candle of page.exchanges) {
        const [from, to] = [candle.start, `${addDays(candle.start.slice(0, 10), 7)}T00:00:00Z`];
        expect(new Date(from).getUTCDay(), from).toBe(1);
        const own = rows.filter((row) => row.date >= from && row.date < to);
        expect(candle.count, from).toBe(own.reduce((total, row) => total + row.swap_count, 0));
        expect(new BigNumber(candle.base_volume).minus(String(candle.buy_volume)).eq(sum(own.map((row) => row.volume_base))), from).toBe(true);
        if (from < `${WINDOWS["90d"].start}T00:00:00Z`) continue;
        const days = daily.filter((day) => day.start >= from && day.start < to);
        expect(days.map((day) => day.start), from).toEqual(own.map((row) => row.date));
        const highest = days.reduce((best, day) => (Number(day.high) > Number(best.high) ? day : best));
        const lowest = days.reduce((best, day) => (Number(day.low) < Number(best.low) ? day : best));
        expect(new BigNumber(candle.base_volume).eq(sum(days.map((day) => day.base_volume))), from).toBe(true);
        expect(new BigNumber(candle.counter_volume).eq(sum(days.map((day) => day.counter_volume))), from).toBe(true);
        expect(new BigNumber(String(candle.buy_volume)).eq(sum(days.map((day) => String(day.buy_volume)))), from).toBe(true);
        expect([candle.open, candle.open_time, candle.close, candle.close_time, candle.high, candle.low], from).toEqual([
          days[0]!.open,
          days[0]!.open_time,
          days.at(-1)!.close,
          days.at(-1)!.close_time,
          highest.high,
          lowest.low,
        ]);
        expect(candle.vwap).toBe(precision8(new Exact(candle.counter_volume).dividedBy(candle.base_volume)));
        compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(12);
  });

  it("move the reserves by the swaps of the candles and the liquidity of the rows, and the LP supply by the recorded events: the states walk back from the derived one", () => {
    for (const name of NAMES) {
      const all = seriesOf(name).days;
      for (const period of SCOPE[name].windows) {
        for (const candle of candlePage(candleFile(name, period)).exchanges) {
          const to = `${addDays(candle.start.slice(0, 10), WINDOWS[period].days)}T00:00:00Z`;
          const own = all.filter((row) => row.date >= candle.start && row.date < to);
          const previous = all.filter((row) => row.date < candle.start).at(-1);
          // Only a pool created in its series has nothing before its first day.
          if (previous === undefined) expect([name, own[0]!.date]).toEqual(["DVR/XRP", "2026-10-12T00:00:00Z"]);
          const before = previous ?? { reserve_base: "0", reserve_counter: "0", lp_supply: "0" };
          const last = own.at(-1)!;
          const where = `${name} ${period} ${candle.start}`;
          const into = (side: "base" | "counter") => sum(own.map((row) => row[`volume_${side}`]));
          const liquidity = (side: "base" | "counter") => sum(own.map((row) => new BigNumber(row[`liquidity_in_${side}`]).minus(row[`liquidity_out_${side}`])));
          const outOfBase = new BigNumber(String(candle.buy_volume));
          const outOfCounter = new BigNumber(candle.counter_volume).minus(into("counter"));
          expect(new BigNumber(last.reserve_base!).minus(before.reserve_base!).eq(into("base").minus(outOfBase).plus(liquidity("base"))), where).toBe(true);
          expect(new BigNumber(last.reserve_counter!).minus(before.reserve_counter!).eq(into("counter").minus(outOfCounter).plus(liquidity("counter"))), where).toBe(true);
          const minted = sum(own.flatMap((row) => eventsOf(name, dayOf(row)).map((event) => event.lp_tokens)));
          expect(new BigNumber(last.lp_supply!).minus(before.lp_supply!).eq(minted), where).toBe(true);
        }
      }
      // Every closing state holds both reserves, above 0 but on the day a withdrawal emptied the pool.
      for (const row of all.filter((r) => !(poolOf(accountOf(name)).deleted && r === all.at(-1)))) {
        expect(new BigNumber(row.reserve_base!).gt(0) && new BigNumber(row.reserve_counter!).gt(0), `${name} ${row.date}`).toBe(true);
      }
    }
  });

  it("hold one live row, the rolling day to T's minute: a component for each live pool with the native currency but VOX/XRP, sorted, summed and rated as the API does", () => {
    const page = json(LIVE) as Page<"rows", AmmVolumeRow>;
    expect(() => checkLiveVolume(page)).not.toThrow();
    expect(page.count).toBe(1);
    const row = page.rows[0]!;
    expect([row.start_time, row.end_time]).toEqual(["2026-10-16T17:01:00Z", "2026-10-17T17:01:00Z"]);
    expect([row.exchange, row.exchange_rate]).toEqual([{ currency: NATIVE }, "1.0000000"]);
    const withNative = derived.pools.filter((pool) => !pool.deleted && (isNative(baseOf(pool)) || isNative(counterOf(pool))));
    const accounts = row.components.map((component) => component.amm_account);
    expect([...accounts].sort()).toEqual(withNative.map((pool) => pool.amm_account).filter((account) => account !== FEATURED_POOLS["VOX/XRP"]).sort());
    expect(accounts).toHaveLength(50);
    for (const name of ["XRP/RLUSD", "XRP/USD", "DVR/XRP"] as const) expect(accounts).toContain(FEATURED_POOLS[name]);
    for (const name of ["USDC/RLUSD", "VOX/XRP", "SNK/XRP"] as const) expect(accounts).not.toContain(FEATURED_POOLS[name]);
    row.components.forEach((component, at) => {
      const pool = poolOf(component.amm_account);
      // A pool against the native currency has it as its counter, and the other side as its base.
      expect([component.base, component.counter], component.amm_account).toEqual([isNative(baseOf(pool)) ? counterOf(pool) : baseOf(pool), { currency: NATIVE }]);
      expect(isWhole(component.count) && component.count > 0).toBe(true);
      expect(new BigNumber(component.amount).gt(0) && new BigNumber(component.converted_amount).gt(0)).toBe(true);
      // `rate`: the units of the component's currency one native coin buys, 8 significant digits; the API divides doubles, which agree here.
      expect(component.rate, component.amm_account).toBe(new Exact(component.amount).dividedBy(component.converted_amount).toPrecision(8));
      expect(new BigNumber(Number(component.amount) / Number(component.converted_amount)).toPrecision(8)).toBe(component.rate);
      const next = row.components[at + 1];
      if (next !== undefined) {
        const order = new BigNumber(component.converted_amount).comparedTo(next.converted_amount)!;
        expect(order > 0 || (order === 0 && component.amm_account < next.amm_account), component.amm_account).toBe(true);
      }
    });
    expect(new BigNumber(row.total).eq(sum(row.components.map((component) => component.converted_amount)))).toBe(true);
    // The API sums the converted amounts as doubles (`String(total)`): they are exact here.
    expect(String(row.components.reduce((total, component) => total + Number(component.converted_amount), 0))).toBe(row.total);
    expect(row.count).toBe(row.components.reduce((total, component) => total + component.count, 0));
  });

  it("have the reference's key orders in the objects before serialization, a day's sums as BigNumber's toString (plain, or the exponent form below 1e-6), and are the files", () => {
    // amm-daily.job.ts writes a day's sums with `toString()` of a BigNumber of the default configuration: the exponent form below 1e-6 and from 1e21.
    const ApiNumber = BigNumber.clone({ EXPONENTIAL_AT: [-7, 20] });
    const SUMS = ["volume_base", "volume_counter", "fees_base_est", "fees_counter_est", "liquidity_in_base", "liquidity_in_counter", "liquidity_out_base", "liquidity_out_counter"] as const;
    let sums = 0;
    const answers = ammSynthetic(xrpl);
    expect(answers.length).toBe([...files.keys()].filter((path) => /\/history@/.test(path) || !path.startsWith("xrpl/data-api/amm/")).length);
    for (const { path, query, value } of answers) {
      const body = value as Record<string, unknown>;
      const where = `${path}?${query}`;
      if (Array.isArray(body.days)) {
        expect(Object.keys(body), where).toEqual(ordered(body, ["result", "count", "marker", "days"]));
        for (const row of body.days as AmmPoolDay[]) {
          expect(Object.keys(row), where).toEqual(ordered(row, DAY_KEYS));
          for (const key of ["reserve_base", "reserve_counter", "lp_supply"] as const) expect(row[key], `${where} ${key}`).toMatch(UNSIGNED);
          for (const key of SUMS) {
            const text = row[key];
            if (text === undefined) continue;
            expect(text, `${where} ${row.date} ${key}`).toBe(new ApiNumber(text).toString());
            sums++;
          }
          for (const key of ["swap_count", "deposit_count", "withdraw_count", "trading_fee"] as const) expect(isWhole(row[key]), `${where} ${key}`).toBe(true);
        }
      } else if (Array.isArray(body.exchanges)) {
        expect(Object.keys(body), where).toEqual(ordered(body, ["result", "count", "marker", "exchanges"]));
        for (const candle of body.exchanges as Candle[]) expect(Object.keys(candle), where).toEqual(ordered(candle, CANDLE_KEYS));
      } else {
        expect(Object.keys(body), where).toEqual(["result", "count", "rows"]);
        for (const row of body.rows as AmmVolumeRow[]) {
          expect(Object.keys(row)).toEqual(ROW_KEYS);
          for (const component of row.components) {
            expect(Object.keys(component)).toEqual(COMPONENT_KEYS);
            for (const side of [component.base, component.counter]) expect(Object.keys(side)).toEqual(ordered(side, ["currency", "issuer"]));
          }
        }
      }
      expect(JSON.parse(files.get(file(path, query))!), where).toEqual(value);
    }
    expect(sums).toBeGreaterThan(4000);
    // SNK/XRP's dust: the base estimate of its deletion day is below 1e-6, in the exponent form, as the API writes it.
    const deletion = seriesOf("SNK/XRP").days.at(-1)!;
    expect([deletion.date, deletion.fees_base_est]).toEqual(["2025-11-11T00:00:00Z", "1.250946e-8"]);
    expect(daysPage(carryFile("SNK/XRP", "30d")).days[0]!.fees_base_est).toBe("1.250946e-8");
  });
});

describe("the provenance", () => {
  it("names the generator, the recordings and the reference commit in PROVENANCE.md, and README.md lists the files as derived", () => {
    const provenance = readFileSync(new URL("../fixtures/PROVENANCE.md", import.meta.url), "utf8");
    const section = provenance.split(/^## /m).find((part) => part.startsWith("AMM answers"));
    expect(section, 'PROVENANCE.md has a section "AMM answers"').toBeDefined();
    for (const name of [
      "scripts/amm-derive.ts",
      "scripts/amm-fixtures.ts",
      "ledgers/xrpl-amm/",
      "ledgers/xrpl/",
      "ledgers/xrpl-extra/",
      "c3e23026b3405fc2fd27fc897e724df4dfe106f1",
      "docs/api-reference.md",
      "apps/api/src/amm/amm-objects.ts",
      "apps/api/src/amm/amm-paging.ts",
      "packages/shared/test/amm-oracle.ts",
    ]) {
      expect(section, name).toContain(name);
    }
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toMatch(/\| `data-api\/amm\/pools\/<POOL>\.json`[^|]*\|[^|]*\| generator \(derived\) \|/);
    expect(readme).toMatch(/\| `data-api\/amm\/pools\/<POOL>\/swaps@[^|]*\|[^|]*\| generator \(derived\) \|/);
  });

  it("names the synthetic part's seeds, the reference's day-row, candle and volume rules, and README.md lists those files as synthetic", () => {
    const provenance = readFileSync(new URL("../fixtures/PROVENANCE.md", import.meta.url), "utf8");
    const section = provenance.split(/^## /m).find((part) => part.startsWith("AMM answers"))!;
    for (const name of [
      'mulberry32(seedOf(<POOL>, "history"))',
      'mulberry32(seedOf("xrpl", "amm_volume", "live"))',
      "packages/shared/src/aggregate/amm-daily.job.ts",
      "apps/api/src/network/volume-object.ts",
      "scripts/market-aggregates.ts",
      "history@end=2026-10-17&interval=day&limit=1000&start=",
      "history@descending=true&end=",
      "@amm=only&end=2026-10-17&interval=",
      "network/amm_volume@live=day.json",
    ]) {
      expect(section, name).toContain(name);
    }
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toMatch(/\| `data-api\/amm\/pools\/<POOL>\/history@[^|]*\|[^|]*\| generator \(synthetic\) \|/);
    expect(readme).toMatch(/\| `data-api\/exchanges\/<B>\/<C>@amm=only&end=[^|]*\|[^|]*\| generator \(synthetic\) \|/);
    expect(readme).toMatch(/\| `data-api\/network\/amm_volume@live=day\.json`[^|]*\|[^|]*\| generator \(synthetic\) \|/);
  });
});
