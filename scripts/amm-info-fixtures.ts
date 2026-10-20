// The node's answers to `amm_info`, derived from the recorded ledgers: for each pool of AMM_INFO_POOLS, the state its newest recorded transaction left,
// served at the newest recorded ledger. The markets pages read the pool of a pair (by pair, `ammInfoByPair`) and E5's pool pages a pool (by account,
// `ammInfo`), so there are two files (test/support/upstream-core.ts: `node/amm_info/<POOL>.json` and `node/amm_info/<asset>_<asset2>.json`). Called by
// `generate()` in http-fixtures.ts; test/fixtures/PROVENANCE.md ("Derived trades and pool states") says what it is made from.
//
// The shape is rippled's (API v1) as the reader in app/server/node-rpc.ts takes it, see its comment on what the nodes answered:
//
//   amount, amount2     the pool's holding of its two assets: drops text for the native currency (the AccountRoot's `Balance`), else an amount object
//                       with the pool's side of the reserve line it holds with the issuer (the line's balance is the low account's, negated for the high).
//                       Asked by account the order is the pool's own (its AMM node's `Asset`, then `Asset2`); asked by pair, `amount` is the asset asked as
//                       `asset`. The two are the same answer when the pair is asked in the pool's own order, as XRP/RLUSD is, and `amount` and `amount2` are
//                       exchanged when it is not (VOX/XRP, whose natural orientation is the reverse of the pool's own XRP, VOX)
//   lp_token            the AMM node's `LPTokenBalance`, issued by the pool
//   trading_fee, vote_slots, auction_slot   the AMM node's `TradingFee`, `VoteSlots` and `AuctionSlot`, in the node's names; a field at its default
//                       (a vote's fee, a slot's discounted fee) is 0, an empty `auth_accounts` is left out, `expiration` is the node's ISO 8601 text
//   ledger_index, ledger_hash, validated   beside `amm` in the `result`, of the ledger the answer is at
//
// `asset_frozen` and `asset2_frozen` are left out: the node says them only when it knows, and a freeze is the issuer's flag or the line's, which the
// recorded transactions of a pool do not show.

import { sameAsset, type Asset } from "../app/domain/asset";
import { isPoolAccountRoot, nodesOf, type Node } from "../app/domain/parse/objects";
import type { IssuedAmount, TxMeta } from "../app/domain/parse/types";
import { nodeFile } from "../test/support/upstream-core";
import { NATIVE } from "./derived-trades";
import { fixtureText, inLedgerOrder, isoTime, readLedgers, unixOf, type RawLedger } from "./http-fixtures";

/** A pool and its two assets in the natural orientation (`naturalOrientation`, app/domain/market-pair.ts): the base, then the counter. */
export interface AmmInfoPool {
  pool: string;
  asset: Asset;
  asset2: Asset;
}

/** The pools whose `amm_info` is a fixture. E3: XRP/RLUSD. E5 appends its featured pools. */
export const AMM_INFO_POOLS: AmmInfoPool[] = [
  {
    pool: "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3",
    // XRP written out, not `NATIVE`: http-fixtures.ts imports this module for `generate()`, and derived-trades.ts imports http-fixtures.ts, so when
    // derived-trades.ts is the first of them to be loaded this list is made before `NATIVE` is (undefined in Vitest, a ReferenceError in Node).
    asset: { currency: "XRP" },
    asset2: { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" },
  },
];

/** The seconds of an auction slot, and of one of its 20 time intervals (rippled's AMMCore.h: `TOTAL_TIME_SLOT_SECS`, `AUCTION_SLOT_INTERVAL_DURATION`). */
const SLOT_SECONDS = 24 * 60 * 60;
const INTERVAL_SECONDS = SLOT_SECONDS / 20;
const EXPIRED = 20;

/**
 * The interval of the slot the ledger closing at `close` is in (`ammAuctionTimeSlot`): the slot began a day before its `expiration`, and its 20 intervals
 * are counted from there. Before the slot began or from its expiration on, it is 20. Both times count from 2000.
 */
function timeInterval(close: number, expiration: number): number {
  const start = expiration - SLOT_SECONDS;
  if (start < 0 || close < start || close - start >= SLOT_SECONDS) return EXPIRED;
  return Math.floor((close - start) / INTERVAL_SECONDS);
}

/** A time as the node writes the `expiration` of a slot: ISO 8601 with an offset and no colon (`2026-03-02T17:05:00+0000`). */
const nodeTime = (rippleTime: number): string => isoTime(unixOf(rippleTime)).replace(/Z$/, "+0000");

/** An asset of an AMM node: a created node leaves out a field at its default, so a missing asset is the native currency. */
function issueAsset(issue: { currency: string; issuer?: string } | undefined): Asset {
  return issue === undefined || issue.issuer === undefined ? { currency: NATIVE } : { currency: issue.currency, issuer: issue.issuer };
}

/** The same decimal text with its sign changed, as the ledger writes it (`0` has none). */
function negated(value: string): string {
  if (value === "0") return value;
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

/** What a pool's nodes were left as by the newest transaction that wrote each. */
interface Newest {
  amm?: Node;
  root?: Node;
  /** The pool's trust lines, by the other side's currency and issuer. */
  lines: Map<string, { node: Node; poolIsLow: boolean }>;
}

const lineKey = (currency: string, issuer: string): string => `${currency}+${issuer}`;

/** The nodes of the successful transactions of the ledgers, in ledger order, that belong to the pool; a later one replaces an earlier. */
function newestNodes(ledgers: readonly RawLedger[], pool: string): Newest {
  const newest: Newest = { lines: new Map() };
  const inOrder = [...ledgers].sort((a, b) => Number(a.ledger.ledger_index) - Number(b.ledger.ledger_index));
  for (const raw of inOrder) {
    for (const tx of inLedgerOrder(raw)) {
      const meta = tx.metaData as unknown as TxMeta;
      if (meta.TransactionResult !== "tesSUCCESS") continue;
      for (const node of nodesOf(meta)) {
        if (node.type === "AMM" && node.fields.Account === pool) newest.amm = node;
        else if (isPoolAccountRoot(node) && node.fields.Account === pool) newest.root = node;
        else if (node.type === "RippleState") {
          const low = node.fields.LowLimit as IssuedAmount | undefined;
          const high = node.fields.HighLimit as IssuedAmount | undefined;
          const balance = node.fields.Balance as IssuedAmount | undefined;
          if (!low || !high || !balance || (low.issuer !== pool && high.issuer !== pool)) continue;
          const poolIsLow = low.issuer === pool;
          newest.lines.set(lineKey(balance.currency, poolIsLow ? high.issuer : low.issuer), { node, poolIsLow });
        }
      }
    }
  }
  return newest;
}

/** The pool's holding of an asset as `amm_info` gives it: drops text for the native currency, else an amount object. */
function holding(newest: Newest, pool: string, asset: Asset): string | IssuedAmount {
  if (asset.issuer === undefined) {
    const balance = newest.root?.fields.Balance;
    if (typeof balance !== "string") throw new Error(`${pool}: the recordings show no Balance of its account`);
    return balance;
  }
  const line = newest.lines.get(lineKey(asset.currency, asset.issuer));
  const value = (line?.node.fields.Balance as IssuedAmount | undefined)?.value;
  if (line === undefined || value === undefined) throw new Error(`${pool}: the recordings show no trust line with ${asset.issuer} for ${asset.currency}`);
  const own = line.poolIsLow ? value : negated(value);
  if (own.startsWith("-")) throw new Error(`${pool}: its ${asset.currency} line says it owes the issuer`);
  return { currency: asset.currency, issuer: asset.issuer, value: own };
}

type NodeSlot = {
  Account?: string;
  AuthAccounts?: Array<{ AuthAccount: { Account: string } }>;
  DiscountedFee?: number;
  Expiration?: number;
  Price?: IssuedAmount;
};

/** The auction slot as `amm_info` gives it, worked out for a ledger that closed at `close` (Ripple epoch seconds). */
function auctionSlot(pool: string, slot: NodeSlot, close: number): Record<string, unknown> {
  if (slot.Expiration === undefined || slot.Price === undefined) throw new Error(`${pool}: its auction slot has no expiration or no price`);
  const accounts = (slot.AuthAccounts ?? []).map((entry) => ({ account: entry.AuthAccount.Account }));
  return {
    ...(slot.Account !== undefined && { account: slot.Account }),
    ...(accounts.length > 0 && { auth_accounts: accounts }),
    discounted_fee: slot.DiscountedFee ?? 0,
    expiration: nodeTime(slot.Expiration),
    price: slot.Price,
    time_interval: timeInterval(close, slot.Expiration),
  };
}

/**
 * The `result` of `amm_info` for the pool: the state its newest recorded transaction left, served at the newest recorded ledger. `byPair`: asked by the
 * pair `asset`, `asset2` (the order of `amount` and `amount2` is then theirs) and not by the pool's account (the pool's own order).
 */
function ammInfo(ledgers: readonly RawLedger[], { pool, asset, asset2 }: AmmInfoPool, byPair: boolean): Record<string, unknown> {
  const served = ledgers.reduce<RawLedger | undefined>((a, b) => (a === undefined || Number(b.ledger.ledger_index) > Number(a.ledger.ledger_index) ? b : a), undefined);
  if (served === undefined) throw new Error(`${pool}: no ledger to serve it at`);

  const newest = newestNodes(ledgers, pool);
  const { amm } = newest;
  if (amm === undefined) throw new Error(`${pool}: the recordings show no pool of that account`);
  if (amm.change === "deleted" || newest.root?.change === "deleted") throw new Error(`${pool}: the recordings end with the pool deleted`);

  // The pool's own order is its AMM node's `Asset`, then `Asset2`; the pair given must be those two assets, in either order.
  const own: [Asset, Asset] = [issueAsset(amm.fields.Asset as Asset), issueAsset(amm.fields.Asset2 as Asset)];
  const asGiven = sameAsset(own[0], asset) && sameAsset(own[1], asset2);
  const reversed = sameAsset(own[0], asset2) && sameAsset(own[1], asset);
  if (!asGiven && !reversed) throw new Error(`${pool}: its assets are ${own.map((a) => a.currency).join("/")}, not ${asset.currency}/${asset2.currency}`);
  const [first, second] = byPair && reversed ? [own[1], own[0]] : own;

  const lpToken = amm.fields.LPTokenBalance as IssuedAmount | undefined;
  if (lpToken === undefined) throw new Error(`${pool}: its AMM node has no LPTokenBalance`);
  const slot = amm.fields.AuctionSlot as NodeSlot | undefined;
  const votes = (amm.fields.VoteSlots ?? []) as Array<{ VoteEntry: { Account: string; TradingFee?: number; VoteWeight: number } }>;

  return {
    amm: {
      account: pool,
      amount: holding(newest, pool, first),
      amount2: holding(newest, pool, second),
      ...(slot !== undefined && { auction_slot: auctionSlot(pool, slot, served.ledger.close_time) }),
      lp_token: lpToken,
      trading_fee: (amm.fields.TradingFee as number | undefined) ?? 0,
      vote_slots: votes.map(({ VoteEntry }) => ({ account: VoteEntry.Account, trading_fee: VoteEntry.TradingFee ?? 0, vote_weight: VoteEntry.VoteWeight })),
    },
    ledger_hash: served.ledger_hash,
    ledger_index: Number(served.ledger.ledger_index),
    status: "success",
    validated: true,
  };
}

/** The node's `result` of amm_info for the pool, asked by its account: the state its newest recorded transaction left, served at the newest recorded ledger. */
export function ammInfoResult(ledgers: readonly RawLedger[], pool: AmmInfoPool): Record<string, unknown> {
  return ammInfo(ledgers, pool, false);
}

/** The same asked by the pair `pool.asset`, `pool.asset2`: `amount` is `asset`'s. The same answer as `ammInfoResult` where the pool's own order is that order. */
export function ammInfoResultByPair(ledgers: readonly RawLedger[], pool: AmmInfoPool): Record<string, unknown> {
  return ammInfo(ledgers, pool, true);
}

/** An asset as the client sends it to the node (`assetParam`): the native currency alone, else the currency as the ledger holds it and its issuer. */
const requestAsset = (asset: Asset): { currency: string; issuer?: string } => (asset.issuer === undefined ? { currency: asset.currency } : { currency: asset.currency, issuer: asset.issuer });

function fileOf(params: Record<string, unknown>): string {
  const path = nodeFile("xrpl", "amm_info", params);
  if (path === undefined) throw new Error(`no fixture file for amm_info ${JSON.stringify(params)}`);
  return path;
}

/**
 * Both files of every pool of AMM_INFO_POOLS: node/amm_info/<POOL>.json and node/amm_info/<asset>_<asset2>.json. The same answer where the natural
 * orientation is the pool's own order (XRP/RLUSD), else the pair's with `amount` and `amount2` in the order asked.
 */
export function ammInfoFixtures(): Map<string, string> {
  const ledgers = readLedgers("xrpl");
  const files = new Map<string, string>();
  for (const pool of AMM_INFO_POOLS) {
    files.set(fileOf({ amm_account: pool.pool }), fixtureText({ result: ammInfoResult(ledgers, pool) }));
    files.set(fileOf({ asset: requestAsset(pool.asset), asset2: requestAsset(pool.asset2) }), fixtureText({ result: ammInfoResultByPair(ledgers, pool) }));
  }
  return files;
}
