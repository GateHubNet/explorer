// What `describe/` makes of a transaction, and the shapes its per-type handlers share. Types only: nothing here runs.

import type { AmmHop, BalanceChange, Native, TxJson, TxMeta } from "../parse/types";

/**
 * A piece of a sentence, in a form the page can render: plain text, a link to an account, an amount, or a link to an
 * AMM pool. Text segments are final, ready-to-show text. The other three are structured, and the page formats them
 * (`formatAmount` and `formatCurrency` for an amount, `shortAddress` for an account): an amount carries its value in
 * whole units as an unformatted decimal string (native drops already converted) and its currency code as it is in the
 * JSON (`XRP` or `XAH` for the native currency); a pool's `v` is its account and `pair` its name.
 */
export type Segment =
  | { t: "text"; v: string }
  | { t: "account"; v: string }
  | { t: "amount"; value: string; currency: string; issuer?: string }
  | { t: "pool"; v: string; pair: string };

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

export type Description = {
  /** A short noun phrase for the kind of transaction (`Payment`, `Trust line`), or the raw type if there is no phrase. */
  title: string;
  /** False for every result but `tesSUCCESS`: the sentence then reads "tried to …". */
  ok: boolean;
  /** "{account} sent 5 XRP to {account}.", as segments. Starts with the sender's account segment. */
  sentence: Segment[];
  /** Sender, the pools or offers on the way, destination. Only for a transaction that moved something. */
  flow?: FlowStep[];
  details: Detail[];
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
};

/** Describes one transaction type. A handler never mutates its input and does no I/O. */
export type Handler = (input: Input) => Summary;

/** Handlers by `TransactionType`. Each module of `describe/` exports one; `index.ts` merges them. */
export type HandlerMap = Readonly<Record<string, Handler>>;
