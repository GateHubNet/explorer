// The tags of the market pair page (markets spec 4.5), with the helpers of meta.ts. Only the pair route imports this module (meta.ts says why).
// Like meta.ts, it runs in the browser too: it imports nothing of `ripple-*`, `domain/asset` or `domain/market-pair` as a value
// (test/unit/markets-bundle.test.ts); the pair's words, its issuers and its first page were written by the view builder (`pairHead`).

import type { MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../ui/brand";
import type { NetworkBrief } from "../ui/networks";
import { absolute, sharing, type MetaContext } from "./meta";
import type { PairPageData } from "./pair-view";

/** The DEX of each network, as the pair page's description names it (the markets page's words, meta-markets.ts). */
const DEX_NAMES = { xrpl: "the XRP Ledger DEX", xahau: "the Xahau DEX" } as const satisfies Record<NetworkBrief["id"], string>;

/**
 * The tags of `/{net}/markets/{base}/{counter}` (markets spec 4.5). The title is the pair, each issued side's code and short issuer, and the
 * network's market ("XRP/USD · USD rhub8V…F3wq · XRPL market · explorer"); a view that is not the default adds its words (`view`, which the view
 * builder wrote: "4 h candles", "order-book trades", "AMM swaps", "older trades") before the product's name, as the markets page does. The
 * description names the pair and its issuers and no number of the data: the page is stored for a second.
 *
 * Indexable only when the view builder says so (`indexable`: the natural orientation, the default view, a trade) and never behind a marker: then
 * a canonical URL (the pair's first page, which the indexable view is) on the origin of the request, Open Graph and a summary card, and no image
 * (a card with a price would be wrong within a ledger). Every other view is `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function pairMeta(
  page: Pick<PairPageData, "head" | "view" | "mode"> & { indexable: boolean },
  ctx: MetaContext,
): MetaDescriptor[] {
  const { network, origin } = ctx;
  const { head } = page;
  const title = [head.title, ...head.issued, `${network.name} market`, ...page.view, PRODUCT_NAME].join(" · ");
  const description = `Price, candles, recent trades, order book and most active traders of ${head.title} on ${DEX_NAMES[network.id]}. ${head.issuedBy}.`;

  if (page.mode !== "live" || !page.indexable) {
    return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  }
  return sharing({ title, description, url: absolute(origin, head.firstPage) });
}
