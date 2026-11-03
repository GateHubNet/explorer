import BigNumber from "bignumber.js";
import { parseBalanceChanges, parseFinalBalances } from "ripple-lib-transactionparser";
import { isMptIssuanceId, mptIssuerOf } from "../mpt-id";
import { mptIdOfNode, nodesOf, type Node } from "./objects";
import type { BalanceChange, Native, TxJson, TxMeta } from "./types";

type LibraryChange = { counterparty: string; currency: string; value: string };

/** The library prints values the way bignumber.js does, in exponent form for the very small and the very large. */
const plain = (value: string): string => new BigNumber(value).toFixed();

const keyOf = (account: string, { counterparty, currency }: LibraryChange): string =>
  `${account}\u0000${counterparty}\u0000${currency}`;

/**
 * What each account's balances did in a transaction, one entry per account and asset, from
 * `ripple-lib-transactionparser`: an `AccountRoot` gives the native currency, a `RippleState` (trust line) an
 * issued one, from the point of view of each of its two sides. The library calls the native currency `XRP`
 * and gives it an empty counterparty; it is relabelled `native`, so Xahau shows `XAH`.
 *
 * The change of an account's native balance is the whole change of its `AccountRoot`, so the fee payer's includes
 * the fee (the fee is shown on a line of its own elsewhere): the sender's, or on a transaction a delegate sent (its
 * `Delegate` field) the delegate's. The sender's entries come first; the rest are in the order
 * of the metadata. Values are exact decimal strings in whole units, never in exponent notation. `after` is the
 * balance after the transaction.
 *
 * For an issued currency `issuer` is the other side of the trust line (see `BalanceChange`). The library knows no MPT:
 * an `MPToken` node and an `MPTokenIssuance` node give the entries of `mptChanges`, after the others.
 */
export function balanceChanges(tx: TxJson, meta: TxMeta, native: Native): BalanceChange[] {
  const finals = new Map<string, string>();
  for (const [account, balances] of Object.entries(parseFinalBalances(meta))) {
    for (const balance of balances) finals.set(keyOf(account, balance), plain(balance.value));
  }

  const changes: BalanceChange[] = [];
  for (const [account, balances] of Object.entries(parseBalanceChanges(meta))) {
    for (const balance of balances) {
      const change: BalanceChange =
        balance.counterparty === ""
          ? { account, currency: native, value: plain(balance.value) }
          : { account, currency: balance.currency, issuer: balance.counterparty, value: plain(balance.value) };
      const after = finals.get(keyOf(account, balance));
      if (after !== undefined) change.after = after;
      changes.push(change);
    }
  }

  changes.push(...mptChanges(tx, meta));

  // Array.prototype.sort is stable: only the sender's entries move, to the front.
  return changes.sort((a, b) => Number(b.account === tx.Account) - Number(a.account === tx.Account));
}

/** An MPT's units: an integer in digits (the ledger writes its 64-bit amounts in base ten). */
const UNITS = /^\d+$/;

/** The issuance an amount field is of, in capitals: `mpt_issuance_id` of an MPT amount, `undefined` for anything else. */
const issuanceOf = (amount: unknown): string | undefined => {
  const id = typeof amount === "object" && amount !== null ? (amount as Record<string, unknown>).mpt_issuance_id : undefined;
  return isMptIssuanceId(id) ? id.toUpperCase() : undefined;
};

/** A holder of an issuance, as one key. */
const holdingKey = (holder: string, id: string): string => `${holder}\u0000${id}`;

/**
 * The holdings (a holder and an issuance) a succeeded transaction credits with an MPT, for a node whose metadata lists no "before" (an added field is never listed, so a first credit is a node
 * with `PreviousFields` present and empty): a Payment's `Destination` and the issuance of its `Amount`, the destination of the escrow an EscrowFinish deleted and the owner of the escrow an
 * EscrowCancel deleted, each with the issuance of that escrow's `Amount` (D9 section 4.1's dated note: a holder's other tokens are not credited by it).
 */
function creditedHoldings(tx: TxJson, meta: TxMeta, nodes: readonly Node[]): ReadonlySet<string> {
  const credited = new Set<string>();
  if (meta.TransactionResult !== "tesSUCCESS") return credited;
  if (tx.TransactionType === "Payment") {
    const id = issuanceOf(tx.Amount ?? tx.DeliverMax);
    if (typeof tx.Destination === "string" && id !== undefined) credited.add(holdingKey(tx.Destination, id));
  }
  if (tx.TransactionType === "EscrowFinish" || tx.TransactionType === "EscrowCancel") {
    for (const { change, type, fields } of nodes) {
      const who = tx.TransactionType === "EscrowFinish" ? fields.Destination : fields.Account;
      const id = issuanceOf(fields.Amount);
      if (change === "deleted" && type === "Escrow" && typeof who === "string" && id !== undefined) credited.add(holdingKey(who, id));
    }
  }
  return credited;
}

/** A node's amount field as units; a field the node leaves out is 0 (the ledger leaves out what is at its default), and one that is not units is `undefined`. */
function unitsOf(fields: Record<string, unknown>, name: string): BigNumber | undefined {
  const raw = fields[name];
  if (raw === undefined) return new BigNumber(0);
  return typeof raw === "string" && UNITS.test(raw) ? new BigNumber(raw) : undefined;
}

/**
 * An `MPToken` node's `MPTAmount` before the transaction: 0 for a created node, the listed value when the metadata lists one, else 0 for a holding the transaction credits (`credited`: an added
 * field is not listed) and the final value (`after`) for any other, so that a node that only moved its flags or its `LockedAmount` is no change. `undefined` when the listed value is not units.
 */
function beforeOf({ change, previous }: Node, after: BigNumber | undefined, credited: boolean): BigNumber | undefined {
  if (change === "created") return new BigNumber(0);
  if ("MPTAmount" in previous) return unitsOf(previous, "MPTAmount");
  return credited ? new BigNumber(0) : after;
}

/**
 * The MPT entries of a transaction, in the order of the metadata. An `MPToken` node whose `MPTAmount` changed is its holder's entry: `value` the change, `after` the new amount. An
 * `MPTokenIssuance` node whose `OutstandingAmount` is listed among the `PreviousFields` and changed is the issuer's entry, the change negated (what left the issuer's side), with no `after`.
 *
 * The "before" of `MPTAmount` is `beforeOf`'s (the credit is of a holder and an issuance together, `creditedHoldings`). A field the final fields leave out is 0 (a holder that spent everything, a redemption, a clawback). A node whose ID or amounts
 * are not well formed gives no entry.
 */
function mptChanges(tx: TxJson, meta: TxMeta): BalanceChange[] {
  const nodes = nodesOf(meta);
  const credited = creditedHoldings(tx, meta, nodes);
  const changes: BalanceChange[] = [];
  for (const node of nodes) {
    const { type, fields, previous } = node;
    const id = type === "MPToken" || type === "MPTokenIssuance" ? mptIdOfNode(node) : undefined;
    if (id === undefined) continue;

    if (type === "MPToken") {
      const holder = fields.Account;
      const after = unitsOf(fields, "MPTAmount");
      const before = beforeOf(node, after, typeof holder === "string" && credited.has(holdingKey(holder, id)));
      if (typeof holder !== "string" || holder === "" || after === undefined || before === undefined || after.isEqualTo(before)) continue;
      changes.push({ account: holder, currency: id, issuer: mptIssuerOf(id), value: after.minus(before).toFixed(), after: after.toFixed(), mpt: true });
    } else if ("OutstandingAmount" in previous) {
      const issuer = fields.Issuer;
      const after = unitsOf(fields, "OutstandingAmount");
      const before = unitsOf(previous, "OutstandingAmount");
      if (typeof issuer !== "string" || after === undefined || before === undefined || after.isEqualTo(before)) continue;
      changes.push({ account: issuer, currency: id, value: before.minus(after).toFixed(), mpt: true });
    }
  }
  return changes;
}
