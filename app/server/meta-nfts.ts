// The tags of the NFT list (NFT spec 10), with the helpers of meta.ts. Only the list's route imports this module (meta.ts says why; the older sales' tags are `meta-nft-sales.ts`,
// the later NFT pages' their own). Like meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/nft-bundle.test.ts); the page data it reads
// were written by the view builder (`nfts-view.ts`), whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { nftsHref, nftWords } from "../domain/nft-params";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { NftsPageData } from "./nfts-view";

/** What the tags of a page that is not for a search engine are: its title, its description and `noindex, follow` (E2's rule for non-default views). */
const noindex = (title: string, description: string): MetaDescriptor[] => [
  { title },
  { name: "description", content: description },
  { name: "robots", content: "noindex, follow" },
];

/**
 * The tags of `/{net}/nfts` (spec 10), from the page data the view builder wrote. The title is "NFTs · XRPL · explorer" ("URITokens · Xahau · explorer"), and "More NFT collections
 * · …" behind a marker; the description has no figure (the page is stored for a minute, and its numbers move).
 *
 * The default view is indexable, with a canonical URL on the origin of the request and no image (a list that changes every minute would have its picture out of date at once). It
 * is the view with no marker, no issuer (a text that is no address included) and no period, sort or order of its own: what the builder says in the issuer form, which holds the
 * view's `period`, `sort` and `order` as hidden fields and is empty for the default view, and the issuer as typed. Every other view is `noindex, follow`, with no canonical URL and
 * no Open Graph or card tags.
 */
export function nftsMeta(data: NftsPageData, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const words = nftWords(network.id);
  const title = `${data.marker ? data.heading : words.listHeading} · ${suffixOf(network)}`;
  const description = `${words.tokens} on ${network.longName}: the sales volume, the largest collections and the latest sales.`;
  const isDefault = !data.marker && data.issuerForm.value === "" && data.issuerForm.hidden.length === 0;
  if (!isDefault) return noindex(title, description);
  return sharing({ title, description, url: absolute(origin, nftsHref(network.id)) });
}
