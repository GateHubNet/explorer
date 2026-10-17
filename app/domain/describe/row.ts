// What a table row shows of a transaction (the ledger page's list, the home page's): pure, no I/O.

import type { Native, TxJson, TxMeta } from "../parse/types";
import { parseAmount } from "./helpers";
import type { Description, FlowAmount, Segment } from "./types";

/**
 * The sentence of `describe()` as a table row's "What happened" cell. The sender is left out (the Account column has
 * it), so is the reason of a failure (the Result column has its code), and so is the full stop; the first letter is a
 * capital: "Sent 5 XRP to rNYbL8…", "Tried to send 5 XRP to rNYbL8…".
 */
export function rowSentence(description: Pick<Description, "ok" | "sentence">): Segment[] {
  const segments = [...description.sentence];
  if (segments[0]?.t === "account") segments.shift();
  // A failure's sentence ends with one more text segment after the full stop: why (see `Description.sentence`).
  if (!description.ok) segments.pop();

  const last = segments.at(-1);
  if (last?.t === "text" && last.v.endsWith(".")) {
    const trimmed = last.v.slice(0, -1);
    if (trimmed === "") segments.pop();
    else segments[segments.length - 1] = { t: "text", v: trimmed };
  }

  const first = segments[0];
  if (first?.t === "text") {
    const text = first.v.replace(/^\s+/, "");
    segments[0] = { t: "text", v: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  return segments;
}

/**
 * The one amount that says the most about a transaction, for a list's Amount column: what a payment delivered (what it was
 * for, when it failed or the node did not say), what an offer sells, or the `Amount` of any other type that has one.
 * `undefined` for a type with no amount, and for one that is not an amount of a currency (an MPT).
 */
export function headlineAmount(tx: TxJson, meta: TxMeta, native: Native): FlowAmount | undefined {
  switch (tx.TransactionType) {
    case "Payment":
      return parseAmount(meta.delivered_amount, native) ?? parseAmount(tx.DeliverMax ?? tx.Amount, native);
    case "OfferCreate":
      return parseAmount(tx.TakerGets, native);
    default:
      return parseAmount(tx.Amount, native);
  }
}
