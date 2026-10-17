import BigNumber from "bignumber.js";
import { parseBalanceChanges, parseFinalBalances } from "ripple-lib-transactionparser";
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
 * The change of the sender's native balance is the whole change of its `AccountRoot`, so it includes the fee
 * (the fee is shown on a line of its own elsewhere). The sender's entries come first; the rest are in the order
 * of the metadata. Values are exact decimal strings in whole units, never in exponent notation. `after` is the
 * balance after the transaction.
 *
 * For an issued currency `issuer` is the other side of the trust line (see `BalanceChange`).
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

  // Array.prototype.sort is stable: only the sender's entries move, to the front.
  return changes.sort((a, b) => Number(b.account === tx.Account) - Number(a.account === tx.Account));
}
