// The AMM types: AMMCreate, AMMDeposit, AMMWithdraw, AMMVote, AMMBid and AMMDelete.

import BigNumber from "bignumber.js";
import { dropsToNative, formatAmount } from "../format";
import { nodesOf } from "../parse/objects";
import type { Asset, TxMeta } from "../parse/types";
import {
  account,
  amountOf,
  amountSegment,
  closingDetails,
  detail,
  feePercent,
  listOf,
  lpTokens,
  pairName,
  parseAmount,
  seq,
  text,
  type FlagTable,
  type Part,
} from "./helpers";
import type { Detail, FlowAmount, HandlerMap, Input, Segment, Summary } from "./types";

// --- The pool ------------------------------------------------------------------------------------------------------

/** An asset of a transaction's `Asset` or `Asset2` field: the native currency has no issuer. */
function assetOf(raw: unknown): Asset | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { currency, issuer } = raw as Record<string, unknown>;
  if (typeof currency !== "string") return undefined;
  return typeof issuer === "string" ? { currency, issuer } : { currency };
}

/** The name of the pool of two assets, `unknown` when the transaction does not name them. */
function nameOf(a: Asset | undefined, b: Asset | undefined): string {
  return a && b ? pairName(a, b) : "unknown";
}

/** The pool of a transaction that has `Asset` and `Asset2`. */
const pairOfAssets = (tx: Input["tx"]): readonly Asset[] => [assetOf(tx.Asset), assetOf(tx.Asset2)].filter((a) => !!a);

/** The account of the pool, from the `AMM` entry the metadata shows; a failed transaction shows none. */
function poolAccount(meta: TxMeta): string | undefined {
  for (const node of nodesOf(meta)) {
    if (node.type === "AMM" && typeof node.fields.Account === "string") return node.fields.Account;
  }
  return undefined;
}

/** The pool in a sentence: its pair as a link to its account, or just the pair when the account is not known. */
function poolSegment(meta: TxMeta, name: string): Segment {
  const pool = poolAccount(meta);
  return pool === undefined ? text(name) : { t: "pool", v: pool, pair: name };
}

/** The pool a transaction with `Asset` and `Asset2` is about. */
function poolOf({ tx, meta }: Input): Segment {
  return poolSegment(meta, nameOf(assetOf(tx.Asset), assetOf(tx.Asset2)));
}

// --- Amounts -------------------------------------------------------------------------------------------------------

const sameAsset = (a: Asset, b: Asset): boolean => a.currency === b.currency && (a.issuer ?? "") === (b.issuer ?? "");

/**
 * What the sender's balances of the pool's assets moved by, in the direction of the transaction: what a deposit put
 * in, what a withdrawal took out, in the order of the pair. The fee is taken out of the native change, and an asset
 * that did not move is left out. The LP tokens are not an asset of the pool, so they are not among them.
 */
function movedAmounts({ tx, native, changes }: Input, direction: "in" | "out"): FlowAmount[] {
  const mine = changes().filter((change) => change.account === tx.Account);
  const amounts: FlowAmount[] = [];
  for (const asset of pairOfAssets(tx)) {
    let net = new BigNumber(0);
    for (const change of mine) {
      if (sameAsset(change, asset)) net = net.plus(change.value);
    }
    if (asset.currency === native && asset.issuer === undefined) net = net.plus(dropsToNative(tx.Fee));

    const moved = direction === "in" ? net.negated() : net;
    if (!moved.isGreaterThan(0)) continue;
    const value = moved.toFixed();
    amounts.push(
      asset.issuer === undefined
        ? { value, currency: asset.currency }
        : { value, currency: asset.currency, issuer: asset.issuer },
    );
  }
  return amounts;
}

/** The amounts a deposit or a withdrawal names, the most it allows. */
function namedAmounts({ tx, native }: Input): FlowAmount[] {
  return [tx.Amount, tx.Amount2].map((raw) => parseAmount(raw, native)).filter((amount) => !!amount);
}

/**
 * The amounts of a deposit or a withdrawal as a sentence: what moved, from the metadata, for one that succeeded; what
 * the transaction names for one that did not (or whose metadata shows nothing); and just "liquidity" if neither says.
 */
function amountsPart(input: Input, direction: "in" | "out"): Part {
  const moved = input.ok ? movedAmounts(input, direction) : [];
  const amounts = moved.length > 0 ? moved : namedAmounts(input);
  return amounts.length > 0 ? listOf(amounts.map(amountOf)) : "liquidity";
}

// --- AMMCreate -----------------------------------------------------------------------------------------------------

function describeCreate(input: Input): Summary {
  const { tx, meta, native, verb } = input;
  const first = parseAmount(tx.Amount, native);
  const second = parseAmount(tx.Amount2, native);
  const fee = feePercent(tx.TradingFee);

  return {
    title: "AMM pool creation",
    predicate: seq(
      `${verb("created", "create")} the `,
      poolSegment(meta, nameOf(first, second)),
      " AMM pool with ",
      amountSegment(tx.Amount, native),
      " and ",
      amountSegment(tx.Amount2, native),
    ),
    details: [
      detail("Amount", amountSegment(tx.Amount, native)),
      detail("Amount 2", amountSegment(tx.Amount2, native)),
      ...(fee === undefined ? [] : [detail("Trading fee", fee)]),
      ...closingDetails(tx, []),
    ],
  };
}

// --- AMMDeposit and AMMWithdraw ------------------------------------------------------------------------------------

const AMM_DEPOSIT_FLAGS: FlagTable = [
  [0x00010000, "tfLPToken"],
  [0x00080000, "tfSingleAsset"],
  [0x00100000, "tfTwoAsset"],
  [0x00200000, "tfOneAssetLPToken"],
  [0x00400000, "tfLimitLPToken"],
  [0x00800000, "tfTwoAssetIfEmpty"],
];

const AMM_WITHDRAW_FLAGS: FlagTable = [
  [0x00010000, "tfLPToken"],
  [0x00020000, "tfWithdrawAll"],
  [0x00040000, "tfOneAssetWithdrawAll"],
  [0x00080000, "tfSingleAsset"],
  [0x00100000, "tfTwoAsset"],
  [0x00200000, "tfOneAssetLPToken"],
  [0x00400000, "tfLimitLPToken"],
];

/** The fields a deposit and a withdrawal share, as the transaction names them. */
function liquidityDetails(input: Input, lpField: string, lpLabel: string, flags: FlagTable): Detail[] {
  const { tx, native } = input;
  const lp = lpTokens(tx[lpField]);
  const fee = feePercent(tx.TradingFee);
  return [
    ...(tx.Amount !== undefined ? [detail("Amount", amountSegment(tx.Amount, native))] : []),
    ...(tx.Amount2 !== undefined ? [detail("Amount 2", amountSegment(tx.Amount2, native))] : []),
    ...(lp === undefined ? [] : [detail(lpLabel, lp)]),
    ...(tx.EPrice !== undefined ? [detail("Effective price", amountSegment(tx.EPrice, native))] : []),
    ...(fee === undefined ? [] : [detail("Trading fee", fee)]),
    ...closingDetails(tx, flags),
  ];
}

function describeDeposit(input: Input): Summary {
  return {
    title: "AMM deposit",
    predicate: seq(`${input.verb("added", "add")} `, amountsPart(input, "in"), " to the ", poolOf(input), " pool"),
    details: liquidityDetails(input, "LPTokenOut", "LP tokens out", AMM_DEPOSIT_FLAGS),
  };
}

function describeWithdraw(input: Input): Summary {
  return {
    title: "AMM withdrawal",
    predicate: seq(
      `${input.verb("withdrew", "withdraw")} `,
      amountsPart(input, "out"),
      " from the ",
      poolOf(input),
      " pool",
    ),
    details: liquidityDetails(input, "LPTokenIn", "LP tokens in", AMM_WITHDRAW_FLAGS),
  };
}

// --- AMMVote -------------------------------------------------------------------------------------------------------

function describeVote(input: Input): Summary {
  const { tx, verb } = input;
  const fee = feePercent(tx.TradingFee);
  return {
    title: "AMM vote",
    predicate: seq(
      fee === undefined
        ? `${verb("voted", "vote")} on the trading fee in the `
        : `${verb("voted", "vote")} for a ${fee} trading fee in the `,
      poolOf(input),
      " pool",
    ),
    details: [...(fee === undefined ? [] : [detail("Trading fee", fee)]), ...closingDetails(tx, [])],
  };
}

// --- AMMBid --------------------------------------------------------------------------------------------------------

/** The value of an LP-token amount field, or undefined. */
function lpValue(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { value } = raw as Record<string, unknown>;
  return typeof value === "string" ? value : undefined;
}

/** What the pool records as the price of the auction slot, when the slot is the sender's now. */
function slotPrice({ tx, meta }: Input): string | undefined {
  for (const node of nodesOf(meta)) {
    if (node.type !== "AMM") continue;
    const slot = node.fields.AuctionSlot as { Account?: unknown; Price?: unknown } | undefined;
    const price = lpValue(slot?.Price);
    if (slot?.Account === tx.Account && price !== undefined && new BigNumber(price).isGreaterThan(0)) return price;
  }
  return undefined;
}

/**
 * What a bid offered: the price the pool shows for a bid that won the slot; else what the transaction allowed, an
 * exact amount if its bounds are the same, "up to" its maximum, or "at least" its minimum.
 */
function bidAmount(input: Input): string {
  const { tx } = input;
  const price = input.ok ? slotPrice(input) : undefined;
  if (price !== undefined) return ` ${formatAmount(price)} LP tokens`;

  const min = lpValue(tx.BidMin);
  const max = lpValue(tx.BidMax);
  if (min !== undefined && max !== undefined && new BigNumber(min).isEqualTo(max)) {
    return ` ${formatAmount(max)} LP tokens`;
  }
  if (max !== undefined) return ` up to ${formatAmount(max)} LP tokens`;
  if (min !== undefined) return ` at least ${formatAmount(min)} LP tokens`;
  return "";
}

function describeBid(input: Input): Summary {
  const { tx, verb } = input;
  const bounds = (field: string, label: string): Detail[] => {
    const lp = lpTokens(tx[field]);
    return lp === undefined ? [] : [detail(label, lp)];
  };
  const auth = (Array.isArray(tx.AuthAccounts) ? tx.AuthAccounts : []).map(
    (entry) => (entry as { AuthAccount?: { Account?: unknown } }).AuthAccount?.Account,
  );
  return {
    title: "AMM auction bid",
    predicate: seq(`${verb("bid", "bid")}${bidAmount(input)} for the `, poolOf(input), " auction slot"),
    details: [
      ...bounds("BidMin", "Bid min"),
      ...bounds("BidMax", "Bid max"),
      ...(auth.length === 0
        ? []
        : [detail("Auth accounts", auth.map((who, i) => [i === 0 ? "" : ", ", account(who)]))]),
      ...closingDetails(tx, []),
    ],
  };
}

// --- AMMDelete -----------------------------------------------------------------------------------------------------

function describeDelete(input: Input): Summary {
  return {
    title: "AMM pool deletion",
    predicate: seq(`${input.verb("deleted", "delete")} the `, poolOf(input), " pool"),
    details: closingDetails(input.tx, []),
  };
}

export const ammHandlers: HandlerMap = {
  AMMCreate: describeCreate,
  AMMDeposit: describeDeposit,
  AMMWithdraw: describeWithdraw,
  AMMVote: describeVote,
  AMMBid: describeBid,
  AMMDelete: describeDelete,
};
