// The tags of a transaction (spec 9), with the helpers of meta.ts. The transaction route is the one page that imports this module (meta.ts
// says why); the link-preview image's data (card-data.ts, in the Worker alone) reads the same words.

import type { MetaDescriptor } from "react-router";

import type { FlowAmount, FlowStep } from "../domain/describe";
import { formatAmount, formatCurrency, shortAddress, shortHash } from "../domain/format";
import type { NetworkBrief } from "../ui/networks";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";
import type { TransactionPageData } from "./transaction-view";

/** What the description of a transaction reads: the page's own data, which the image route also has. */
export type TxFacts = Pick<TransactionPageData, "hash" | "ledgerIndex" | "title" | "ok" | "summary" | "flow">;

function amountText(amount: FlowAmount): string {
  return `${formatAmount(amount.value)} ${formatCurrency(amount.currency)}`;
}

/** Who sent what to whom, from the flow: the sender, the destination and what the destination got. */
export function movement(flow: readonly FlowStep[] | null): { from: string; to: string; amount: FlowAmount } | undefined {
  const sender = flow?.[0];
  const destination = flow?.at(-1);
  if (sender?.role !== "sender" || destination?.role !== "destination" || destination.amount === undefined) return undefined;
  return { from: sender.account, to: destination.account, amount: destination.amount };
}

/**
 * `Payment of 1,250.00 USD from rJF2Xa…FQvg to rNYbL8…UKq5 · XRPL ledger 107,695,660`. That is what a transaction that moved something from
 * one account to another says; any other (a failure, which moved nothing; an offer; a swap, which is a payment to oneself) says the
 * sentence of its page, which has more to say, and then where it is.
 */
export function transactionDescription(tx: TxFacts, network: NetworkBrief): string {
  const where = `${network.name} ledger ${formatAmount(String(tx.ledgerIndex))}`;
  const moved = tx.ok ? movement(tx.flow) : undefined;
  if (moved && moved.from !== moved.to) {
    return `${tx.title} of ${amountText(moved.amount)} from ${shortAddress(moved.from)} to ${shortAddress(moved.to)} · ${where}`;
  }
  return `${tx.summary.replace(/\.$/, "")} · ${where}`;
}

/** The tags of `/{net}/tx/{hash}`. */
export function transactionMeta(tx: TxFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = `${tx.title} ${shortHash(tx.hash)} · ${suffixOf(network)}`;
  return sharing({
    title,
    description: transactionDescription(tx, network),
    url: absolute(origin, `/${network.id}/tx/${tx.hash}`),
    image: { url: imageUrl(origin, network.id, "tx", tx.hash), alt: `${tx.title} ${shortHash(tx.hash)} on ${network.name}` },
  });
}
