// The tags of a ledger (spec 9), with the helpers of meta.ts. The ledger route is the one page that imports this module (meta.ts says why);
// the link-preview image's data (card-data.ts, in the Worker alone) reads its facts.

import type { MetaDescriptor } from "react-router";

import { formatAmount, formatUtc } from "../domain/format";
import type { LedgerPageData } from "./ledger-view";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";

/** What the tags of a ledger read. */
export interface LedgerFacts {
  header: Pick<LedgerPageData["header"], "index" | "hash" | "closeTime">;
  txCount: number;
  succeeded: number;
}

/**
 * The tags of `/{net}/ledger/{index|hash}`. A ledger has one canonical URL, the index's, and one image, whichever of the two the page
 * was reached by.
 */
export function ledgerMeta(ledger: LedgerFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const index = formatAmount(String(ledger.header.index));
  const transactions = `${formatAmount(String(ledger.txCount))} ${ledger.txCount === 1 ? "transaction" : "transactions"}`;
  return sharing({
    title: `Ledger #${index} · ${suffixOf(network)}`,
    description: `Ledger ${index} on ${network.name} closed ${formatUtc(ledger.header.closeTime)} with ${transactions}.`,
    url: absolute(origin, `/${network.id}/ledger/${ledger.header.index}`),
    image: { url: imageUrl(origin, network.id, "ledger", String(ledger.header.index)), alt: `Ledger #${index} on ${network.name}` },
  });
}
