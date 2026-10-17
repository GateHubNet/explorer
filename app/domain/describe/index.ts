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
import { ammHandlers } from "./amm";
import { checkHandlers } from "./checks";
import { escrowHandlers } from "./escrow";
import { account, genericDetails, mergeHandlers, seq, text, withArticle } from "./helpers";
import { nftHandlers } from "./nft";
import { offerHandlers } from "./offers";
import { paychanHandlers } from "./paychan";
import { paymentHandlers } from "./payment";
import type { Description, Input, Summary } from "./types";
import { xahauHandlers } from "./xahau";

export { headlineAmount, rowSentence } from "./row";
export type { Description, Detail, FlowAmount, FlowStep, Handler, HandlerMap, Input, Segment, Summary } from "./types";

const HANDLERS = mergeHandlers(
  paymentHandlers,
  offerHandlers,
  accountHandlers,
  escrowHandlers,
  paychanHandlers,
  checkHandlers,
  nftHandlers,
  ammHandlers,
  xahauHandlers,
);

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
 * What a transaction did, in words. `result` is its result code with the text of `resultText`, and `ok` whether it
 * succeeded; a failed transaction reads "{account} tried to …", then says why in the text of its result, and has no
 * flow, as nothing moved.
 */
export function describe(tx: TxJson, meta: TxMeta, ctx: { native: Native }): Description {
  const result = { code: meta.TransactionResult, ...resultText(meta.TransactionResult) };
  const ok = result.ok;
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

  const sentence = seq(account(tx.Account), ok ? " " : " tried to ", summary.predicate, ".");
  // A failure says why, in a segment of its own so that the sentence stays what it was.
  if (!ok) sentence.push(text(` ${result.text}`));

  const description: Description = {
    title: summary.title,
    ok,
    result,
    sentence,
    details: summary.details ?? [],
  };
  if (ok && summary.flow) description.flow = summary.flow;
  return description;
}
