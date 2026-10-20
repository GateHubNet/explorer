// The tags of the markets page (markets spec 4.5), with the helpers of meta.ts. Only the markets route imports this module (meta.ts says
// why). Like meta.ts, it runs in the browser too: it imports nothing of `ripple-*`, `domain/asset` or `domain/market-pair` as a value
// (test/unit/markets-bundle.test.ts); the view words it reads were written by the view builder.

import type { MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../ui/brand";
import type { NetworkBrief } from "../ui/networks";
import type { MarketsPageData } from "./markets-view";
import { absolute, sharing, type MetaContext } from "./meta";

/** The DEX of each network, as the markets page's description names it. */
const DEX_NAMES = { xrpl: "the XRP Ledger DEX", xahau: "the Xahau DEX" } as const satisfies Record<NetworkBrief["id"], string>;

/**
 * The tags of `/{net}/markets` (markets spec 4.5). The title adds the words a view that is not the default has (`view`, which the view builder
 * wrote: "last 7 days", "USD", "AMM swaps"). The default view is indexable, with a canonical URL on the origin of the request and no image (a
 * card with a price would be wrong within a ledger); every other view is `noindex, follow`, with no canonical URL and no Open Graph or card
 * tags. The description has no number of the data (the page is stored for a minute); it names the view's period in the builder's words
 * (`periodWords`: "last 24 hours", "last 7 days").
 */
export function marketsMeta(page: Pick<MarketsPageData, "view" | "periodWords" | "indexable">, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = [`${network.name} markets`, ...page.view, PRODUCT_NAME].join(" · ");
  const description = `Every pair traded on ${DEX_NAMES[network.id]} with at least 10 trades in the ${page.periodWords}: last price, change, range, volume and a 7-day trend.`;

  if (!page.indexable) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  return sharing({ title, description, url: absolute(origin, `/${network.id}/markets`) });
}
