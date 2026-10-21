import { readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

// http-fixtures.ts first: the generators it joins (amm-fixtures.ts among them) and derived-trades.ts import it in turn.
import { fixtureText, generate, HTTP, isAmmGenerated, isMarketGenerated, isSynthetic, LEDGERS, readLedgers, txMarker, type RawLedger } from "../../scripts/http-fixtures";
import { derivedExchanges } from "../../scripts/derived-trades";
import { AMM_INFO_POOLS, ammInfoResult } from "../../scripts/amm-info-fixtures";
import { deriveAmm, type AmmState } from "../../scripts/amm-derive";
import { ammFixtures, FEATURED_POOLS } from "../../scripts/amm-fixtures";
import { apiAssetText, sameAsset, type Asset } from "../../app/domain/asset";
import { formatCurrency } from "../../app/domain/format";
import { naturalOrientation } from "../../app/domain/market-pair";
import { nodesOf } from "../../app/domain/parse/objects";
import type { TxMeta } from "../../app/domain/parse/types";
import { checkGovernancePage, checkLiquidityPage, checkPool, checkPoolsPage, checkSwapsPage } from "../../app/server/amm-shape";
import type { AmmGovernanceRow, AmmLiquidityEvent, AmmPool, AmmSwap, Page, PairExchange } from "../../app/server/api-types";
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
  const files = ammFixtures();
  const live = derived.pools.filter((pool) => !pool.deleted).sort(listOrder);

  it("are named by isAmmGenerated, which is true of no other generated file, and are on disk", () => {
    expect([...generate().keys()].filter(isAmmGenerated).sort()).toEqual([...files.keys()].sort());
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
    const generated = [...generate().keys()];
    const theirs = generated.filter((path) => /\/exchanges\/.*@amm=only&/.test(path));
    expect(theirs).toContain(`xrpl/data-api/exchanges/XRP/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De@amm=only&interval=1day&limit=61&start=2026-08-19T00:00:00Z.json`);
    for (const path of theirs) expect([isAmmGenerated(path), isMarketGenerated(path)], path).toEqual([false, true]);
    const volumes = generated.filter((path) => path.startsWith("xrpl/data-api/network/amm_volume@"));
    expect(volumes).toContain("xrpl/data-api/network/amm_volume@end=2026-10-17&interval=day&limit=1000&start=2026-09-18.json");
    expect(volumes).toHaveLength(8);
    for (const path of volumes) expect([isAmmGenerated(path), isSynthetic(path)], path).toEqual([false, true]);
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

  it("write a list's rows one to a line, keys sorted, as fixtureText does", () => {
    for (const [path, text] of files) {
      const body = JSON.parse(text) as Record<string, unknown>;
      const list = ["pools", "exchanges", "liquidity", "governance"].find((key) => Array.isArray(body[key]));
      if (list === undefined) {
        expect(text, path).toBe(fixtureText(body));
        continue;
      }
      const lines = text.split("\n").map((line) => line.trim().replace(/,$/, ""));
      for (const row of body[list] as unknown[]) expect(lines, path).toContain(JSON.stringify(sortedKeys(row)));
    }
  });

  it("write no swap, event or governance row that is not the derived one", () => {
    for (const [path, text] of files) {
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
      expect(generate().has(`xrpl/node/amm_info/${entry.pool}.json`)).toBe(true);
    }
    expect(generate().has(`xrpl/node/amm_info/${FEATURED_POOLS["VOX/XRP"]}.json`)).toBe(false);
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
});
