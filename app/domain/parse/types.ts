// The shapes of a transaction and its metadata as rippled (and xahaud) send them in API v1, and of what
// `parse/` makes of them. Types only: nothing here runs.

/** An issued-currency amount. (MPT amounts, `{ mpt_issuance_id, value }`, are not modelled.) */
export type IssuedAmount = { currency: string; issuer: string; value: string };

/** Drops of the native currency as a string, or an issued-currency amount. */
export type Amount = string | IssuedAmount;

/** A transaction's JSON, without its metadata. */
export type TxJson = Record<string, unknown> & {
  TransactionType: string;
  Account: string;
  /** Drops. */
  Fee: string;
  hash?: string;
};

type NodeFields = Record<string, unknown>;

/** The body of an affected node: a ledger entry before and after the transaction. */
export type AffectedNodeBody = {
  LedgerEntryType: string;
  /** The entry's key in the ledger (64 hex). */
  LedgerIndex: string;
  /** Created nodes: the entry's fields (fields at their default are left out). */
  NewFields?: NodeFields;
  /** Modified and deleted nodes: the fields as they are after the transaction (as deleted). */
  FinalFields?: NodeFields;
  /** Modified and deleted nodes: the fields the transaction changed, as they were before it. */
  PreviousFields?: NodeFields;
  PreviousTxnID?: string;
  PreviousTxnLgrSeq?: number;
};

export type AffectedNode =
  | { CreatedNode: AffectedNodeBody }
  | { ModifiedNode: AffectedNodeBody }
  | { DeletedNode: AffectedNodeBody };

/** A transaction's metadata (`metaData` in a ledger's expanded transactions, `meta` in a `tx` result). */
export type TxMeta = {
  TransactionIndex: number;
  TransactionResult: string;
  AffectedNodes: AffectedNode[];
  delivered_amount?: Amount;
};

/** The network's own currency. */
export type Native = "XRP" | "XAH";

/**
 * An asset: a currency and, for an issued one, its issuer. The native currency has no issuer, and its
 * `currency` is the network's (`XRP` or `XAH`).
 */
export type Asset = { currency: string; issuer?: string };

/**
 * What one account's balance of one asset did in a transaction.
 *
 * `value` and `after` are exact decimal strings in whole units (never exponent notation); `value` is signed.
 * For an issued currency the entry is one side of a trust line, so `issuer` is the other side of that line:
 * the issuer in the entry of a holder, and the holder in the entry of the issuer, whose `value` is the
 * opposite of what the holder's moved. A sender's native `value` is the whole change of its balance, so it
 * includes the transaction fee.
 */
export type BalanceChange = Asset & {
  account: string;
  value: string;
  /** The balance after the transaction. */
  after?: string;
};

/**
 * A swap through an AMM pool: what the pool took in and what it paid out. Both values are positive, whole
 * units, and are the pool's own change, so with a transfer fee they differ from what the receiver got.
 */
export type AmmHop = {
  /** The pool's account. */
  pool: string;
  in: Asset & { value: string };
  out: Asset & { value: string };
};

/** A ledger entry a transaction created, modified or deleted. */
export type TouchedObject = {
  change: "created" | "modified" | "deleted";
  /** The ledger entry type: `AccountRoot`, `RippleState`, `Offer`, `AMM`, ... */
  type: string;
  /** The entry's key in the ledger (64 hex). */
  index: string;
  /** Its `Account` (or, for entries that have only an owner, its `Owner`), when it has one. */
  account?: string;
};
