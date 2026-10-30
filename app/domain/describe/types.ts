// What `describe/` makes of a transaction, and the shapes its per-type handlers share. Types only: nothing here runs.

import type { ObjectKind, ObjectRefParts } from "../object-link";
import type { AmmHop, BalanceChange, Native, TxJson, TxMeta } from "../parse/types";

/**
 * A piece of a sentence, in a form the page can render: plain text, a link to an account, an amount, a link to an AMM
 * pool, a link to an NFT, a permission of a delegation, or a link to an escrow, a check or a payment channel. Text segments
 * are final, ready-to-show text. The others are structured, and the page formats them (`formatAmount` and `formatCurrency`
 * for an amount, `shortAddress` for an account, `NftLink` for an NFT, `PermissionChip` for a permission): an amount carries
 * its value in whole units as an unformatted decimal string (native drops already converted) and its currency code as it is
 * in the JSON (`XRP` or `XAH` for the native currency); a pool's `v` is its account and `pair` its name; an NFT's `v` is its
 * id (a URIToken's index on Xahau), shown as `#serial` when the segment has one; describe leaves the serial out, and the page
 * shows the id shortened; a permission is what `permissionChip` makes of it (its name, its kind and the words that say what
 * it allows); an object's `v` is its final words ("escrow 57978925", "a check", an ID), which link to its page by `ref` (its
 * ID in capitals, or an escrow's owner and sequence) while LEDGER_OBJECTS is on (`objectHref`), and are text while it is off.
 */
export type Segment =
  | { t: "text"; v: string }
  | { t: "account"; v: string }
  | { t: "amount"; value: string; currency: string; issuer?: string }
  | { t: "pool"; v: string; pair: string }
  | { t: "nft"; v: string; serial?: number }
  | { t: "permission"; name: string; kind: "transaction" | "granular" | "unknown"; words: string }
  | { t: "object"; kind: ObjectKind; ref: ObjectRefParts; v: string };

/** An amount without the segment tag, as a flow step carries it. */
export type FlowAmount = { value: string; currency: string; issuer?: string };

/** One stop of the money's way from the sender to the destination. */
export type FlowStep = {
  role: "sender" | "pool" | "offer" | "destination";
  account: string;
  label: string;
  /** What left the sender, what the pool paid out, what the destination got. */
  amount?: FlowAmount;
};

/** One field of the details table. */
export type Detail = { label: string; value: Segment[] };

/** The result code of a transaction and what it means (`resultText`). */
export type TxResult = { code: string; ok: boolean; text: string };

export type Description = {
  /** A short noun phrase for the kind of transaction (`Payment`, `Trust line`), or the raw type if there is no phrase. */
  title: string;
  /** False for every result but `tesSUCCESS`: the sentence then reads "tried to …". Equal to `result.ok`. */
  ok: boolean;
  /** `meta.TransactionResult` and its plain-language text. */
  result: TxResult;
  /**
   * "{account} sent 5 XRP to {account}.", as segments. Starts with the sender's account segment. A failed transaction's
   * sentence ends with one more text segment after the full stop, a space and the result's text: "{account} tried to
   * pay 5 XRP to {account}. No path had enough liquidity to deliver the amount."
   */
  sentence: Segment[];
  /** Sender, the pools or offers on the way, destination. Only for a transaction that moved something. */
  flow?: FlowStep[];
  details: Detail[];
  /** The account that signed the transaction and paid its fee on behalf of its `Account` (its `Delegate` field), when it has one. */
  delegate?: string;
  /** "{delegate} sent it on behalf of {account}.", as segments: the page puts it after `sentence`, in the same paragraph. Only with `delegate`. */
  sentBy?: Segment[];
  /** A line the page shows under the sentence (`Summary.note`), when the handler has one. */
  note?: Segment[];
};

/** What a handler is given for one transaction. */
export type Input = {
  tx: TxJson;
  meta: TxMeta;
  native: Native;
  /** Whether the transaction succeeded (`resultText(...).ok` of its result code). */
  ok: boolean;
  /**
   * The verb of the sentence in the form its outcome calls for: `past` for a transaction that succeeded, `infinitive`
   * for one that failed, which the sentence puts after "tried to". Write each verb of the sentence through this, so one
   * predicate reads both ways: `` `${input.verb("sent", "send")} ` ``.
   */
  verb(past: string, infinitive: string): string;
  /** `parse/`'s swaps through AMM pools, worked out on first use. */
  hops(): AmmHop[];
  /** `parse/`'s balance changes, worked out on first use. */
  changes(): BalanceChange[];
};

/** What a handler makes of a transaction; `describe` adds the sender, "tried to" and the full stop. */
export type Summary = {
  title: string;
  /** The sentence after the sender's account, without the full stop: the verbs through `Input.verb`. */
  predicate: Segment[];
  /** Left out when nothing moved; `describe` drops it for a transaction that failed. */
  flow?: FlowStep[];
  details?: Detail[];
  /** A line that says more than the sentence, which the page shows under it (`DelegateSet`: what the new list does to the old one). */
  note?: Segment[];
};

/** Describes one transaction type. A handler never mutates its input and does no I/O. */
export type Handler = (input: Input) => Summary;

/** Handlers by `TransactionType`. Each module of `describe/` exports one; `index.ts` merges them. */
export type HandlerMap = Readonly<Record<string, Handler>>;
