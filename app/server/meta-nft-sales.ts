// The tags of the older NFT sales (NFT spec 10), with the helpers of meta.ts. Only the sales' route imports this module (meta.ts says why). Like meta.ts, it runs in the browser too:
// it value-imports nothing of app/server but ./meta (test/unit/nft-bundle.test.ts); the page data it reads were written by the view builder (`nfts-view.ts`), whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { nftWords } from "../domain/nft-params";
import { suffixOf, type MetaContext } from "./meta";
import type { NftSalesPageData } from "./nfts-view";

/** The tags of `/{net}/nfts/sales` (spec 10): the older sales are `noindex, follow`, whichever page of them it is, with no canonical URL and nothing to share. */
export function nftSalesMeta(data: NftSalesPageData, ctx: MetaContext): MetaDescriptor[] {
  const { network } = ctx;
  return [
    { title: `${data.heading} · ${suffixOf(network)}` },
    { name: "description", content: `The latest ${nftWords(network.id).token} sales on ${network.longName}, newest first.` },
    { name: "robots", content: "noindex, follow" },
  ];
}
