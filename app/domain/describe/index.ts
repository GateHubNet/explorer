// Plain-language summaries of transactions: a sentence as segments the page can render, the flow of the money,
// and the detail fields. Pure: no I/O.
//
// One module per family of transaction types exports a `HandlerMap`; this file merges them. A handler turns a
// transaction into the part of the sentence after the sender (`Summary`); `describe` adds the sender, the "tried
// to" of a failure and the full stop, so every handler reads both ways from one predicate.

import { ammHops, balanceChanges } from "../parse";
import type { Native, TxJson, TxMeta } from "../parse/types";
import { resultText } from "../results";
import { accountHandlers } from "./account";
import { account, genericDetails, mergeHandlers, seq, withArticle } from "./helpers";
import { offerHandlers } from "./offers";
import { paymentHandlers } from "./payment";
import type { Description, Input, Summary } from "./types";

export type { Description, Detail, FlowStep, Handler, HandlerMap, Input, Segment, Summary } from "./types";

const HANDLERS = mergeHandlers(paymentHandlers, offerHandlers, accountHandlers);

/** A type with no handler: "{account} submitted a {Type}." and a table of its fields. */
function describeUnknown({ tx, native, verb }: Input): Summary {
  return {
    title: tx.TransactionType,
    predicate: seq(`${verb("submitted", "submit")} ${withArticle(tx.TransactionType)}`),
    details: genericDetails(tx, native),
  };
}

/** Works a value out on first use. */
function lazily<T>(make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
}

/**
 * What a transaction did, in words. `ok` is whether it succeeded (`resultText` of its result code); a failed
 * transaction reads "{account} tried to …" and has no flow, as nothing moved.
 */
export function describe(tx: TxJson, meta: TxMeta, ctx: { native: Native }): Description {
  const ok = resultText(meta.TransactionResult).ok;
  const input: Input = {
    tx,
    meta,
    native: ctx.native,
    ok,
    verb: (past, infinitive) => (ok ? past : infinitive),
    hops: lazily(() => ammHops(meta, ctx.native)),
    changes: lazily(() => balanceChanges(tx, meta, ctx.native)),
  };

  // Own properties only: a transaction type named `constructor` is not a handler.
  const handler = Object.hasOwn(HANDLERS, tx.TransactionType) ? HANDLERS[tx.TransactionType]! : describeUnknown;
  const summary = handler(input);

  const description: Description = {
    title: summary.title,
    ok,
    sentence: seq(account(tx.Account), ok ? " " : " tried to ", summary.predicate, "."),
    details: summary.details ?? [],
  };
  if (ok && summary.flow) description.flow = summary.flow;
  return description;
}
