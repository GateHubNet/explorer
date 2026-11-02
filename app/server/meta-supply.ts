// The tags of the supply page (spec 9), with the helpers of meta.ts. Only the supply route imports this module (meta.ts says why). Like meta.ts, it runs in the browser too: it value-imports
// nothing of the view builder or of the loader's modules (test/unit/supply-bundle.test.ts, meta-bundle.test.ts).

import type { MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../ui/brand";
import { absolute, sharing, type MetaContext } from "./meta";
import type { SupplyPageData } from "./supply-view";

/**
 * The tags of `/{net}/supply` (spec 9): `Supply · XRPL · explorer`, a description of the snapshot the view builder wrote (`XRP supply at ledger #107,720,688: 99.99B total, 14.69M burned,
 * 35.21B escrowed, 64.77B circulating.`), a canonical URL on the origin of the request, Open Graph and a card. The page has one view and is indexable. It has no image of its own (no
 * `/og/{net}/supply`), and the site has no default one, so the card is the plain `summary` (ruling C14).
 */
export function supplyMeta(page: Pick<SupplyPageData, "description">, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  return sharing({
    title: ["Supply", network.name, PRODUCT_NAME].join(" · "),
    description: page.description,
    url: absolute(origin, `/${network.id}/supply`),
  });
}
