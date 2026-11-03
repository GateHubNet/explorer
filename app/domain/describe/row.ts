// What a table row shows of a transaction (the ledger page's list, the home page's): pure, no I/O.

import type { Native, TxJson, TxMeta } from "../parse/types";
import { account, deliveredMptAmount, mptFlowAmount, mptIssuerOf, parseAmount, parseMptAmount, seq } from "./helpers";
import type { Description, FlowAmount, Segment } from "./types";

/**
 * The sentence of `describe()` as a table row's "What happened" cell. The sender is left out (the Account column has
 * it), so is the reason of a failure (the Result column has its code), and so is the full stop; the first letter is a
 * capital: "Sent 5 XRP to rNYbL8…", "Tried to send 5 XRP to rNYbL8…". A transaction a delegate sent ends
 * " · sent by {delegate}", or " · sent by this account as its delegate" on the page of `viewer` when that is the delegate.
 */
export function rowSentence(description: Pick<Description, "ok" | "sentence" | "delegate">, viewer?: string): Segment[] {
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

  const { delegate } = description;
  if (delegate === undefined) return segments;
  return delegate === viewer ? seq(segments, " · sent by this account as its delegate") : seq(segments, " · sent by ", account(delegate));
}

/**
 * The one amount that says the most about a transaction, for a list's Amount column: what a payment delivered (what it was
 * for, when it failed or the node did not say), what an offer sells, or the `Amount` of any other type that has one.
 * An MPT's amount is `{ mpt, issuer, units }` (the units of its issuance, not scaled; an object with a malformed ID is no amount); a clawback's issued token has the sender as its issuer.
 * `undefined` for a type with no amount.
 */
export function headlineAmount(tx: TxJson, meta: TxMeta, native: Native): FlowAmount | undefined {
  switch (tx.TransactionType) {
    case "Payment": {
      const intended = tx.DeliverMax ?? tx.Amount;
      const intendedMpt = parseMptAmount(intended);
      const delivered = intendedMpt && deliveredMptAmount(meta, intendedMpt.id);
      return (
        parseAmount(meta.delivered_amount, native) ??
        (delivered && { mpt: delivered.id, issuer: mptIssuerOf(delivered.id), units: delivered.units }) ??
        parseAmount(intended, native) ??
        mptFlowAmount(intended)
      );
    }
    case "OfferCreate":
      return parseAmount(tx.TakerGets, native);
    case "Clawback": {
      // An issued token's `Amount.issuer` names the holder; the amount is the sender's own token (`describe` shows it so).
      const issued = parseAmount(tx.Amount, native);
      return issued?.issuer === undefined ? (issued ?? mptFlowAmount(tx.Amount)) : { ...issued, issuer: tx.Account };
    }
    default:
      return parseAmount(tx.Amount, native) ?? mptFlowAmount(tx.Amount);
  }
}
