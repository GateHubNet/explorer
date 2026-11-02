// The tags of an NFT's page (NFT spec 10), with the helpers of meta.ts. Only the NFT's route imports this module (meta.ts says why). Like meta.ts, it runs in the browser too: it
// value-imports nothing of app/server but ./meta (test/unit/nft-bundle.test.ts); the facts it reads (`NftPageData.facts`) were written by the view builder (`nft-view.ts`), whose types
// alone it imports, and the link-preview image's card is made of the same facts (`nftCard`, in card-data.ts).

import type { MetaDescriptor } from "react-router";

import { shortAddress } from "../domain/format";
import { nftHref } from "../domain/nft-params";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";
import type { NftPageData } from "./nft-view";

/**
 * The tags of `/{net}/nft/{ID}` (spec 10), from the page data the view builder wrote.
 *
 * - The title is the page's own, "NFT #4,127 of rLULtF…mB3R · taxon 1 · XRPL · explorer" ("URIToken A1F04C77… of rEvRt8…Lk2P · Xahau · explorer" on Xahau), with "(burned)" after the name; behind a
 *   marker it is the older history: "Older history of NFT #4,127 · …".
 * - The description is what the NFT's owner and last sale say, joined by `·`, and the network's name last: "Owned by rHciXf…JrHC · last sold for 1,250 XRP · XRPL". A burned NFT says "Burned"
 *   in place of its owner, one with no price says how often it was sold ("never sold"), and a fact the page does not have (an owner the index lacks) is left out.
 * - An NFT of the index is indexable: the canonical URL is `/{net}/nft/{ID}` on the origin of the request, for the view with offer events too, with the link-preview image
 *   (`/og/{net}/nft/{ID}.png`) and a large card. One shown from the network is a stand-in until the index has it: `noindex`, no canonical URL and nothing to share. A page behind a marker
 *   is `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function nftMeta(data: NftPageData, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const { facts } = data;
  const title = `${data.title} · ${suffixOf(network)}`;

  if (data.marker) {
    const description = `Older history of ${facts.name} of ${facts.collection} on ${network.name}.`;
    return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  }

  const said = [facts.burned ? "Burned" : facts.owner === undefined ? null : `Owned by ${shortAddress(facts.owner)}`, facts.lastSale === undefined ? (facts.sold ?? null) : `last sold for ${facts.lastSale}`];
  const description = [...said.filter((part) => part !== null), network.name].join(" · ");
  if (data.noindex) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex" }];

  const id = data.header.id;
  return sharing({
    title,
    description,
    url: absolute(origin, nftHref(network.id, id)),
    image: { url: imageUrl(origin, network.id, "nft", id), alt: `${facts.name} of ${facts.collection} on ${network.name}` },
  });
}
