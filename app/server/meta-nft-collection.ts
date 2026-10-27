// The tags of a collection's page (NFT spec 10), with the helpers of meta.ts. Only the collection's route imports this module (meta.ts says why). Like meta.ts, it runs in the browser
// too: it value-imports nothing of app/server but ./meta (test/unit/nft-bundle.test.ts); the page data it reads were written by the view builder (`nft-collection-view.ts`), whose types
// alone it imports.

import type { MetaDescriptor } from "react-router";

import { collectionHref, nftWords } from "../domain/nft-params";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { NftCollectionPageData } from "./nft-collection-view";

/**
 * The tags of `/{net}/nfts/{issuer}[/{taxon}]` (spec 10), from the page data the view builder wrote. The title is the page's own, "Collection rLULtF…mB3R · taxon 1 · XRPL · explorer"
 * ("URITokens of rEvRt8…Lk2P · Xahau · explorer" on Xahau, as the heading is), and behind a marker the tab's older rows: "Older sales of rLULtF…mB3R · taxon 1 · …". The description names
 * the collection and the network and has no figure: the page is stored for a minute, and its numbers move.
 *
 * A first page at the default measure (Volume), with no filter, is indexable: the canonical URL is on the origin of the request and names the collection and its tab, unless it is
 * the first one, with Open Graph and a summary card and no image (a collection has none). Every other view, another measure, a filter on the NFTs tab (an owner, "Include burned", an
 * owner that is no address included: the form says so) or a page behind a marker, is `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function nftCollectionMeta(data: NftCollectionPageData, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const words = nftWords(network.id);
  const { issuer, taxon } = data.header;
  const label = data.breadcrumb.at(-1)?.label ?? issuer;
  const title = `${data.title} · ${suffixOf(network)}`;
  const description = `${words.token} collection ${label} on ${network.longName}: its sales, ${words.tokens} and holders.`;
  // The measure is the default's (the first of the switch, Volume) when no other link is the current one.
  const otherMeasure = data.measures.some((link, at) => link.current && at > 0);
  const filtered = data.form !== null && (data.form.owner !== "" || data.form.burned);
  if (data.marker || otherMeasure || filtered) {
    return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  }
  return sharing({ title, description, url: absolute(origin, collectionHref(network.id, { issuer, ...(taxon === undefined ? {} : { taxon }) }, { tab: data.tab })) });
}
