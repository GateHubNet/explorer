// The AMM pools of the recorded XRPL ledgers as the data API serves them: each pool's states, its liquidity events and its votes and bids, worked out from
// the transactions' metadata, and each pool's current state folded from its states. E5's pool fixtures (scripts/amm-fixtures.ts) are made of them;
// test/fixtures/PROVENANCE.md ("AMM answers") names the commit. The swaps are not here: they are E3's swap rows (`derivedExchanges`, scripts/derived-trades.ts).
//
// The rules are the data API's, ported (data-api-new at feat/amm-data c3e2302, read with `git show`, never imported):
//
//   packages/shared/test/amm-oracle.ts     what the parser stores for one transaction (spec section 2 of the AMM data design, ruling R-A6): the pools a
//                                          transaction touched (an AccountRoot with `AMMID`, an AMM node, or a reserve line by its `lsfAMMNode` rule), each
//                                          pool's two assets in the stored order, its state after the transaction (a value only where a node held it), its
//                                          liquidity event (create, deposit, withdraw, clawback, delete; amounts signed from the pool's side) and its vote
//                                          or bid. `ammRows` below is its port, function for function; the swap part is E3's.
//   apps/api/src/amm/amm-paging.ts         `carryForward`: a state's value is the newest one of its own row and the rows before it
//   apps/api/src/amm/amm-objects.ts        the objects as served (`toPoolObject`, `toPoolStateObject`, `toLiquidityObject`, `toGovernanceObject`): key orders,
//                                          the grouped auction slot, the native currency without an issuer key, `valueText` for `value_native`
//   packages/shared/src/aggregate/amm-pools.job.ts   the pool from its states: the newest value of each column, `deleted` and `last_ledger` of the newest
//                                          state, `created_*` of the pool's first create event, `value_native` 2 × the native reserve (a Float64), none once deleted
//
// Where this differs from the data API: an issued amount is written with `toFixed()`, as derived-trades.ts writes the swaps, where the parser writes
// `toString()` (the exponent form below 1e-6 and from 1e21; no amount of the recordings is in that range, so the texts are the same); and a pool without the
// native currency has no `value_native`: the API values it at the asset's daily native rate, and the recordings give no such rate (spec section 9).

import BigNumber from "bignumber.js";

import { canonicalPair, sameAsset, type Asset } from "../app/domain/asset";
import type { IssuedAmount } from "../app/domain/parse/types";
import type { AmmAuctionSlot, AmmBid, AmmGovernanceRow, AmmLiquidityEvent, AmmPool, AmmVote } from "../app/server/api-types";
import { NATIVE } from "./derived-trades";
import { inLedgerOrder, isoTime, unixOf, type RawLedger, type RawTx } from "./http-fixtures";
import { isNative } from "./market-aggregates";

/** A pool's state after one transaction (`GET /v2/amm/pools/{pool}/history`): the reference's PoolState, every value carried forward. */
export interface AmmState {
  amm_account: string;
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  tx_type: string;
  executed_time: string;
  base_currency: string;
  base_issuer?: string;
  counter_currency: string;
  counter_issuer?: string;
  reserve_base?: string;
  reserve_counter?: string;
  lp_supply?: string;
  lp_currency?: string;
  trading_fee?: number;
  auction_slot?: AmmAuctionSlot;
  deleted: boolean;
}

/** What the recordings say of the AMM: every pool (sorted by account), and its states, liquidity events and votes and bids, oldest first. */
export interface DerivedAmm {
  pools: AmmPool[];
  states: AmmState[];
  liquidity: AmmLiquidityEvent[];
  governance: AmmGovernanceRow[];
}

// ---- One transaction (the oracle's port) ------------------------------------------------------------------------------

/** `lsfAMMNode`, and the reserve flags of the two sides of a trust line (`lsfLowReserve`, `lsfHighReserve`). */
const FLAG_AMM_NODE = 0x01000000;
const FLAG_LOW_RESERVE = 0x00010000;
const FLAG_HIGH_RESERVE = 0x00020000;

/** The mode flags of AMMDeposit and AMMWithdraw (the data design's `amm_liquidity.mode`). */
const MODES: Record<string, Record<string, number>> = {
  AMMDeposit: {
    lp_token: 0x00010000,
    single_asset: 0x00080000,
    two_asset: 0x00100000,
    one_asset_lp_token: 0x00200000,
    limit_lp_token: 0x00400000,
    two_asset_if_empty: 0x00800000,
  },
  AMMWithdraw: {
    lp_token: 0x00010000,
    withdraw_all: 0x00020000,
    one_asset_withdraw_all: 0x00040000,
    single_asset: 0x00080000,
    two_asset: 0x00100000,
    one_asset_lp_token: 0x00200000,
    limit_lp_token: 0x00400000,
  },
};

const EVENTS: Record<string, AmmLiquidityEvent["event"]> = {
  AMMCreate: "create",
  AMMDeposit: "deposit",
  AMMWithdraw: "withdraw",
  AMMClawback: "clawback",
  AMMDelete: "delete",
};

type Fields = Record<string, unknown>;

/** One entry of `AffectedNodes`: `now` is NewFields or FinalFields (none for an entry that has neither), `was` PreviousFields (empty if none). */
interface Entry {
  index: number;
  op: string;
  type: string;
  now: Fields | undefined;
  was: Fields;
}

/** A pool's change of one asset and its holding after the transaction, in whole units; no `after` when no node holds it. */
interface Holding {
  change: BigNumber;
  after?: BigNumber;
  native: boolean;
}

/** A state as the parser stores it: the transaction's values only, the slot as its four columns. */
interface StoredState {
  amm_account: string;
  base: Asset;
  counter: Asset;
  reserve_base?: string;
  reserve_counter?: string;
  lp_supply?: string;
  lp_currency?: string;
  trading_fee?: number;
  auction_holder?: string;
  auction_price?: string;
  auction_discounted_fee?: number;
  /** Ripple seconds. */
  auction_expiration?: number;
  deleted: boolean;
}

interface StoredLiquidity {
  amm_account: string;
  account: string;
  initiator: string;
  event: AmmLiquidityEvent["event"];
  mode?: string;
  base_amount: string;
  counter_amount: string;
  lp_tokens: string;
}

interface StoredGovernance {
  amm_account: string;
  kind: "vote" | "bid";
  account: string;
  fee_voted?: number;
  trading_fee_after?: number;
  bid_min?: string;
  bid_max?: string;
  price_paid?: string;
  slot_holder?: string;
  slot_discounted_fee?: number;
  /** Ripple seconds. */
  slot_expiration?: number;
  auth_accounts: string[];
}

interface Rows {
  states: StoredState[];
  liquidity: StoredLiquidity[];
  governance: StoredGovernance[];
}

const issued = (value: unknown): IssuedAmount => value as IssuedAmount;
const flagsOf = (fields: Fields): number => Number(fields.Flags ?? 0);

/** Whole native units from drops, and an issued amount, as plain decimals. */
const text = (holding: { native: boolean }, value: BigNumber): string => (holding.native ? value.shiftedBy(-6).toFixed() : value.toFixed());

/** The pools of one successful transaction and what the parser stores for each: its state, its liquidity event, its vote or bid (`ammOracle`, less the swap). */
function ammRows(tx: RawTx): Rows {
  const rows: Rows = { states: [], liquidity: [], governance: [] };
  const meta = tx.metaData;
  if (meta.TransactionResult !== "tesSUCCESS") return rows;

  const entries: Entry[] = ((meta.AffectedNodes ?? []) as Array<Record<string, Fields>>).map((wrapper, index) => {
    const op = Object.keys(wrapper)[0]!;
    const body = wrapper[op]!;
    return { index, op, type: body.LedgerEntryType as string, now: (body.NewFields ?? body.FinalFields) as Fields | undefined, was: (body.PreviousFields ?? {}) as Fields };
  });

  // The pools named by an AccountRoot that has an AMMID, or by an AMM node.
  const named = new Set<string>();
  for (const e of entries) {
    if (!e.now) continue;
    if (e.type === "AccountRoot" && e.now.AMMID !== undefined) named.add(e.now.Account as string);
    if (e.type === "AMM") named.add(e.now.Account as string);
  }

  // R-A6: the pool of an lsfAMMNode trust line is the side holding the reserve bit; with no bit (or both), the one side already named above.
  const lineOwner = new Map<Entry, string>();
  for (const e of entries) {
    if (e.type !== "RippleState" || !e.now) continue;
    const flags = flagsOf(e.now);
    if ((flags & FLAG_AMM_NODE) === 0) continue;
    const low = issued(e.now.LowLimit).issuer;
    const high = issued(e.now.HighLimit).issuer;
    const lowBit = (flags & FLAG_LOW_RESERVE) !== 0;
    const highBit = (flags & FLAG_HIGH_RESERVE) !== 0;
    let owner: string | undefined;
    if (lowBit !== highBit) owner = lowBit ? low : high;
    else {
      const candidates = [low, high].filter((account) => named.has(account));
      if (candidates.length === 1) owner = candidates[0];
    }
    if (owner !== undefined) lineOwner.set(e, owner);
  }

  // Every pool with the entries that belong to it, in the order of its first entry.
  const pools = new Map<string, { root?: Entry; amm?: Entry; lines: Entry[]; first: number }>();
  const poolOf = (account: string, index: number) => {
    let pool = pools.get(account);
    if (!pool) pools.set(account, (pool = { lines: [], first: index }));
    pool.first = Math.min(pool.first, index);
    return pool;
  };
  for (const e of entries) {
    if (!e.now) continue;
    if (e.type === "AccountRoot" && e.now.AMMID !== undefined) poolOf(e.now.Account as string, e.index).root ??= e;
    if (e.type === "AMM") poolOf(e.now.Account as string, e.index).amm ??= e;
    const owner = lineOwner.get(e);
    if (owner !== undefined) poolOf(owner, e.index).lines.push(e);
  }
  const ordered = [...pools.entries()].sort((a, b) => a[1].first - b[1].first);

  for (const [account, { root, amm, lines }] of ordered) {
    const ownSign = (line: Entry) => (issued(line.now!.LowLimit).issuer === account ? 1 : -1);
    const lineAsset = (line: Entry): Asset => ({
      currency: (line.now!.Balance as IssuedAmount | undefined)?.currency ?? issued(line.now!.LowLimit).currency,
      issuer: issued(line.now!.LowLimit).issuer === account ? issued(line.now!.HighLimit).issuer : issued(line.now!.LowLimit).issuer,
    });

    // The pool's two assets: the AMM node's, else those of its reserve lines and, with a balance, the native currency.
    const assets: Array<Asset | null> = [];
    if (amm) {
      for (const field of [amm.now!.Asset, amm.now!.Asset2] as Array<{ currency?: string; issuer?: unknown; mpt_issuance_id?: unknown } | undefined>) {
        if (field === undefined || (field.issuer === undefined && field.mpt_issuance_id === undefined)) assets.push({ currency: NATIVE });
        else if (typeof field.issuer === "string") assets.push({ currency: field.currency!, issuer: field.issuer });
        else assets.push(null);
      }
    } else {
      for (const line of lines) {
        const asset = lineAsset(line);
        if (!assets.some((other) => other && sameAsset(asset, other))) assets.push(asset);
      }
      const nonZero = (value: unknown) => value !== undefined && !new BigNumber(value as string).isZero();
      if (root && (nonZero(root.now!.Balance) || nonZero(root.was.Balance))) assets.push({ currency: NATIVE });
    }
    if (assets.length !== 2 || assets.includes(null) || sameAsset(assets[0]!, assets[1]!)) continue;
    const [base, counter] = canonicalPair(assets[0]!, assets[1]!);

    const holding = (asset: Asset): Holding => {
      if (asset.issuer === undefined) {
        if (!root) return { change: new BigNumber(0), native: true };
        const after = new BigNumber((root.now!.Balance as string | undefined) ?? 0);
        const before = root.op === "CreatedNode" ? new BigNumber(0) : new BigNumber((root.was.Balance as string | undefined) ?? after);
        return { change: after.minus(before), after, native: true };
      }
      const line = lines.find((l) => sameAsset(lineAsset(l), asset));
      if (!line) return { change: new BigNumber(0), native: false };
      const sign = ownSign(line);
      const balance = (fields: Fields) => (fields.Balance as IssuedAmount | undefined)?.value;
      const after = new BigNumber(balance(line.now!) ?? 0).times(sign);
      const before = line.op === "CreatedNode" ? new BigNumber(0) : new BigNumber(balance(line.was) ?? balance(line.now!) ?? 0).times(sign);
      return { change: after.minus(before), after, native: false };
    };
    const b = holding(base);
    const c = holding(counter);

    // The state.
    const deleted = amm?.op === "DeletedNode" || root?.op === "DeletedNode";
    const state: StoredState = { amm_account: account, base, counter, deleted };
    if (b.after) state.reserve_base = text(b, b.after);
    if (c.after) state.reserve_counter = text(c, c.after);
    if (amm) {
      const f = amm.now!;
      const lpBalance = f.LPTokenBalance as IssuedAmount | undefined;
      if (deleted) state.lp_supply = "0";
      else if (lpBalance) state.lp_supply = new BigNumber(lpBalance.value).toFixed();
      if (lpBalance) state.lp_currency = lpBalance.currency;
      state.trading_fee = (f.TradingFee as number | undefined) ?? 0;
      const slot = f.AuctionSlot as { Account?: string; Price?: IssuedAmount; DiscountedFee?: number; Expiration?: number } | undefined;
      if (slot) {
        if (slot.Account !== undefined) state.auction_holder = slot.Account;
        if (slot.Price !== undefined) state.auction_price = new BigNumber(slot.Price.value).toFixed();
        state.auction_discounted_fee = slot.DiscountedFee ?? 0;
        if (slot.Expiration !== undefined) state.auction_expiration = slot.Expiration;
      }
    }
    rows.states.push(state);

    // The LP-token change on the AMM node.
    const lpChange = (): BigNumber => {
      const now = new BigNumber((amm!.now!.LPTokenBalance as IssuedAmount | undefined)?.value ?? 0);
      const was = amm!.was.LPTokenBalance ? new BigNumber((amm!.was.LPTokenBalance as IssuedAmount).value) : now;
      if (amm!.op === "CreatedNode") return now;
      if (amm!.op === "DeletedNode") return was.negated();
      return now.minus(was);
    };

    // A liquidity event.
    const event = EVENTS[tx.TransactionType];
    if (event && amm) {
      const row: StoredLiquidity = {
        amm_account: account,
        account: tx.TransactionType === "AMMClawback" ? (tx.Holder as string) : tx.Account,
        initiator: tx.Account,
        event,
        base_amount: text(b, b.change),
        counter_amount: text(c, c.change),
        lp_tokens: lpChange().toFixed(),
      };
      const modes = MODES[tx.TransactionType];
      if (modes) {
        const set = Object.keys(modes).filter((name) => (Number(tx.Flags ?? 0) & modes[name]!) !== 0);
        if (set.length === 1) row.mode = set[0];
      }
      rows.liquidity.push(row);
    }

    // A vote or a bid.
    if ((tx.TransactionType === "AMMVote" || tx.TransactionType === "AMMBid") && amm) {
      const f = amm.now!;
      const row: StoredGovernance = { amm_account: account, kind: tx.TransactionType === "AMMVote" ? "vote" : "bid", account: tx.Account, auth_accounts: [] };
      if (tx.TransactionType === "AMMVote") {
        if (tx.TradingFee !== undefined) row.fee_voted = tx.TradingFee as number;
        row.trading_fee_after = (f.TradingFee as number | undefined) ?? 0;
      } else {
        if (tx.BidMin !== undefined) row.bid_min = new BigNumber(issued(tx.BidMin).value).toFixed();
        if (tx.BidMax !== undefined) row.bid_max = new BigNumber(issued(tx.BidMax).value).toFixed();
        row.price_paid = lpChange().negated().toFixed();
        const slot = f.AuctionSlot as { Account?: string; DiscountedFee?: number; Expiration?: number; AuthAccounts?: Array<{ AuthAccount: { Account: string } }> } | undefined;
        if (slot) {
          if (slot.Account !== undefined) row.slot_holder = slot.Account;
          row.slot_discounted_fee = slot.DiscountedFee ?? 0;
          if (slot.Expiration !== undefined) row.slot_expiration = slot.Expiration;
          row.auth_accounts = (slot.AuthAccounts ?? []).map((entry) => entry.AuthAccount.Account);
        }
      }
      rows.governance.push(row);
    }
  }
  return rows;
}

// ---- The objects as served --------------------------------------------------------------------------------------------

/** Where a row is: its transaction, and the ledger's close as unix seconds. */
interface Place {
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  tx_type: string;
  close: number;
}

/** A Ripple-epoch time as the API serves it. */
const timeOf = (rippleSeconds: number): string => isoTime(unixOf(rippleSeconds));

/** The pair's keys: the native currency has no issuer key. */
function pairKeys(base: Asset, counter: Asset): Pick<AmmState, "base_currency" | "base_issuer" | "counter_currency" | "counter_issuer"> {
  return {
    base_currency: base.currency,
    ...(base.issuer !== undefined && { base_issuer: base.issuer }),
    counter_currency: counter.currency,
    ...(counter.issuer !== undefined && { counter_issuer: counter.issuer }),
  };
}

/** The columns carried forward (`POOL_FIELDS` of amm-pools.job.ts): a state's value is the newest of its own row and the rows before it. */
const CARRIED = [
  "reserve_base",
  "reserve_counter",
  "lp_supply",
  "lp_currency",
  "trading_fee",
  "auction_holder",
  "auction_price",
  "auction_discounted_fee",
  "auction_expiration",
] as const satisfies readonly (keyof StoredState)[];
type Carried = Pick<StoredState, (typeof CARRIED)[number]>;

/** `carryForward` of amm-paging.ts: the rows (oldest first) with each value that is not known taken from the state before. */
function carryForward<T extends Carried>(rows: readonly T[]): T[] {
  let state: Carried = {};
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...state };
    for (const column of CARRIED) if (row[column] !== undefined) next[column] = row[column];
    state = next as Carried;
    return { ...row, ...state };
  });
}

/** The auction slot, grouped, or nothing when no part of it is known (`slotOf`). */
function slotKeys(v: Carried): { auction_slot?: AmmAuctionSlot } {
  const slot: AmmAuctionSlot = {
    ...(v.auction_holder !== undefined && { holder: v.auction_holder }),
    ...(v.auction_price !== undefined && { price: v.auction_price }),
    ...(v.auction_discounted_fee !== undefined && { discounted_fee: v.auction_discounted_fee }),
    ...(v.auction_expiration !== undefined && { expiration: timeOf(v.auction_expiration) }),
  };
  return Object.keys(slot).length > 0 ? { auction_slot: slot } : {};
}

/** The values a state or a pool shares, in the reference's order. */
function valueKeys(v: Carried): Pick<AmmState, "reserve_base" | "reserve_counter" | "lp_supply" | "lp_currency" | "trading_fee" | "auction_slot"> {
  return {
    ...(v.reserve_base !== undefined && { reserve_base: v.reserve_base }),
    ...(v.reserve_counter !== undefined && { reserve_counter: v.reserve_counter }),
    ...(v.lp_supply !== undefined && { lp_supply: v.lp_supply }),
    ...(v.lp_currency !== undefined && { lp_currency: v.lp_currency }),
    ...(v.trading_fee !== undefined && { trading_fee: v.trading_fee }),
    ...slotKeys(v),
  };
}

/** `toPoolStateObject`: a state whose values are carried forward. */
function stateObject(row: StoredState & Place): AmmState {
  return {
    amm_account: row.amm_account,
    ledger_index: row.ledger_index,
    tx_index: row.tx_index,
    tx_hash: row.tx_hash,
    tx_type: row.tx_type,
    executed_time: isoTime(row.close),
    ...pairKeys(row.base, row.counter),
    ...valueKeys(row),
    deleted: row.deleted,
  };
}

/** `toLiquidityObject`. */
function liquidityObject(row: StoredLiquidity & Place): AmmLiquidityEvent {
  return {
    amm_account: row.amm_account,
    ledger_index: row.ledger_index,
    tx_index: row.tx_index,
    tx_hash: row.tx_hash,
    executed_time: isoTime(row.close),
    account: row.account,
    initiator: row.initiator,
    event: row.event,
    ...(row.mode !== undefined && { mode: row.mode }),
    base_amount: row.base_amount,
    counter_amount: row.counter_amount,
    lp_tokens: row.lp_tokens,
  };
}

/** `toGovernanceObject`: a vote carries nothing of a bid and a bid nothing of a vote; a bid's slot is left out when the row holds none of it. */
function governanceObject(row: StoredGovernance & Place): AmmGovernanceRow {
  const head = { amm_account: row.amm_account, ledger_index: row.ledger_index, tx_index: row.tx_index, tx_hash: row.tx_hash, executed_time: isoTime(row.close) };
  if (row.kind === "vote") {
    const vote: AmmVote = {
      ...head,
      type: "vote",
      account: row.account,
      ...(row.fee_voted !== undefined && { fee_voted: row.fee_voted }),
      ...(row.trading_fee_after !== undefined && { trading_fee_after: row.trading_fee_after }),
    };
    return vote;
  }
  const slot = {
    ...(row.slot_holder !== undefined && { holder: row.slot_holder }),
    ...(row.slot_discounted_fee !== undefined && { discounted_fee: row.slot_discounted_fee }),
    ...(row.slot_expiration !== undefined && { expiration: timeOf(row.slot_expiration) }),
  };
  const known = Object.keys(slot).length > 0 || row.auth_accounts.length > 0;
  const bid: AmmBid = {
    ...head,
    type: "bid",
    account: row.account,
    ...(row.bid_min !== undefined && { bid_min: row.bid_min }),
    ...(row.bid_max !== undefined && { bid_max: row.bid_max }),
    ...(row.price_paid !== undefined && { price_paid: row.price_paid }),
    ...(known && { auction_slot: { ...slot, auth_accounts: [...row.auth_accounts] } }),
  };
  return bid;
}

// ---- The pool ---------------------------------------------------------------------------------------------------------

/**
 * The value the API stores for a pool (`value_native` of `amm_pools`, a Float64): 2 × the native reserve, `null` for a deleted pool, for one without the native
 * currency (see the head of this file) and for one whose native reserve is not known. The list is ordered by it, and its marker holds it (`encodePoolsMarker`).
 */
export function storedValue(pool: AmmPool): number | null {
  if (pool.deleted) return null;
  const base = { currency: pool.base_currency, issuer: pool.base_issuer };
  const counter = { currency: pool.counter_currency, issuer: pool.counter_issuer };
  const reserve = isNative(base, NATIVE) ? pool.reserve_base : isNative(counter, NATIVE) ? pool.reserve_counter : undefined;
  if (reserve === undefined) return null;
  const value = new BigNumber(reserve).times(2).toNumber();
  return Number.isFinite(value) ? value : null;
}

/**
 * `valueText` of amm-objects.ts: eight significant digits of the stored value, a plain decimal without trailing zeros. amm-fixtures.ts writes the synthetic day
 * rows' `value_native` with it too.
 */
export const valueText = (value: number): string => new BigNumber(new BigNumber(value).toPrecision(8)).toFixed();

/** `toPoolObject` of the pool's states (oldest first, carried forward) and its first create event, if the recordings have one. */
function poolObject(states: ReadonlyArray<StoredState & Place>, create: (StoredLiquidity & Place) | undefined): AmmPool {
  const last = states.at(-1)!;
  const pool: AmmPool = {
    amm_account: last.amm_account,
    ...pairKeys(last.base, last.counter),
    ...valueKeys(last),
    last_ledger: last.ledger_index,
    deleted: last.deleted,
  };
  const value = storedValue(pool);
  // Rebuilt in the reference's key order, with the keys that come after the slot.
  const { last_ledger, deleted, ...head } = pool;
  return {
    ...head,
    ...(value !== null && { value_native: valueText(value) }),
    ...(create !== undefined && { created_ledger: create.ledger_index, created_by: create.account }),
    last_ledger,
    deleted,
  };
}

const byPlace = (a: Place, b: Place): number => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index;

/** Every AMM pool of the ledgers, with its states, liquidity events and votes and bids, as the data API serves them for these ledgers. */
export function deriveAmm(ledgers: readonly RawLedger[]): DerivedAmm {
  const states: Array<StoredState & Place> = [];
  const liquidity: Array<StoredLiquidity & Place> = [];
  const governance: Array<StoredGovernance & Place> = [];
  const inOrder = [...ledgers].sort((a, b) => Number(a.ledger.ledger_index) - Number(b.ledger.ledger_index));
  for (const raw of inOrder) {
    for (const tx of inLedgerOrder(raw)) {
      const place: Place = {
        ledger_index: Number(raw.ledger.ledger_index),
        tx_index: tx.metaData.TransactionIndex,
        tx_hash: tx.hash,
        tx_type: tx.TransactionType,
        close: unixOf(raw.ledger.close_time),
      };
      const rows = ammRows(tx);
      states.push(...rows.states.map((row) => ({ ...row, ...place })));
      liquidity.push(...rows.liquidity.map((row) => ({ ...row, ...place })));
      governance.push(...rows.governance.map((row) => ({ ...row, ...place })));
    }
  }

  const byPool = new Map<string, Array<StoredState & Place>>();
  for (const state of states) byPool.set(state.amm_account, [...(byPool.get(state.amm_account) ?? []), state]);
  const carried = new Map([...byPool].map(([account, rows]) => [account, carryForward([...rows].sort(byPlace))]));
  const accounts = [...carried.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const account of accounts) {
    const own = carried.get(account)!;
    if (own.some((row) => !sameAsset(row.base, own[0]!.base) || !sameAsset(row.counter, own[0]!.counter))) throw new Error(`${account}: the pool's assets change between its states`);
  }

  // `created_ledger` and `created_by`: the pool's first create event (the lowest ledger, then transaction).
  const created = new Map<string, StoredLiquidity & Place>();
  for (const event of [...liquidity].sort(byPlace)) if (event.event === "create" && !created.has(event.amm_account)) created.set(event.amm_account, event);

  return {
    pools: accounts.map((account) => poolObject(carried.get(account)!, created.get(account))),
    states: accounts.flatMap((account) => carried.get(account)!).sort(byPlace).map(stateObject),
    liquidity: [...liquidity].sort(byPlace).map(liquidityObject),
    governance: [...governance].sort(byPlace).map(governanceObject),
  };
}
