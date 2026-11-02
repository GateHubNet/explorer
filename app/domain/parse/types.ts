// The shapes of a transaction and its metadata as rippled (and xahaud) send them in API v1, and of what
// `parse/` makes of them. Types only: nothing here runs.

/** An issued-currency amount. */
export type IssuedAmount = { currency: string; issuer: string; value: string };

/** An amount of a Multi-Purpose Token: the issuance's ID (48 hex digits) and an integer number of its units, as a string. The scale is the issuance's, not the amount's. */
export type MptAmount = { mpt_issuance_id: string; value: string };

/** Drops of the native currency as a string, an issued-currency amount or an MPT amount. */
export type Amount = string | IssuedAmount | MptAmount;

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
  /** What a payment delivered, as the ledger's own metadata field (stored when it is less than `Amount`; an MPT payment's, after fixMPTDeliveredAmount). */
  DeliveredAmount?: Amount;
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
 * opposite of what the holder's moved. A native `value` is the whole change of the balance, so the fee payer's
 * includes the transaction fee: the sender's, or the delegate's on a transaction a delegate sent.
 *
 * With `mpt` the entry is an MPT's: `currency` is the issuance's ID, and `value` and `after` are integer units, not scaled. A holder's entry has the
 * ID's issuer as its `issuer`; the issuer's own has none and no `after` (it is the change of the issuance's outstanding amount, negated).
 */
export type BalanceChange = Asset & {
  account: string;
  value: string;
  /** The balance after the transaction. */
  after?: string;
  /** An MPT's entry: `currency` is the issuance ID, `value` and `after` units. */
  mpt?: true;
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
  /** Its `Account` (or, for entries that have only an owner, its `Owner`; an `MPTokenIssuance`'s `Issuer`), when it has one. */
  account?: string;
  /** An `MPToken` or an `MPTokenIssuance`: the ID of the issuance, in capitals. */
  mpt?: string;
  /** Its issuance's ticker, which the Worker's lookup fills in (`resolveMpt`) after `objectsTouched` has made the entry. */
  ticker?: string;
};
