// ripple-lib-transactionparser 0.8.2 ships no types. Only what the explorer uses is declared.
declare module "ripple-lib-transactionparser" {
  export interface BalanceChange {
    counterparty: string;
    currency: string;
    value: string;
  }

  /** The balance changes of every account a transaction's metadata touches, by account address. */
  export function parseBalanceChanges(metadata: object): Record<string, BalanceChange[]>;
}
