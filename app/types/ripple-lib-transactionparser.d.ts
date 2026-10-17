// ripple-lib-transactionparser 0.8.2 ships no types. Only what the explorer uses is declared.
declare module "ripple-lib-transactionparser" {
  export interface BalanceChange {
    counterparty: string;
    currency: string;
    value: string;
  }

  /**
   * The balance changes of every account a transaction's metadata touches, by account address. The native
   * currency is labelled `XRP` with an empty `counterparty`, in whole units; for an issued currency the
   * `counterparty` is the other side of the trust line. Values are decimal strings in whatever notation
   * bignumber.js prints them (exponent form for very small or large ones).
   */
  export function parseBalanceChanges(metadata: object): Record<string, BalanceChange[]>;

  /**
   * The balances after the transaction of every account and trust line the metadata holds a balance for, in the
   * same shape as `parseBalanceChanges` (a balance that did not change is included).
   */
  export function parseFinalBalances(metadata: object): Record<string, BalanceChange[]>;
}
