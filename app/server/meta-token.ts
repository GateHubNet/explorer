// The tags of a token's page (E11 spec 7.1), with the helpers of meta.ts. Only the token page's route imports this module (meta.ts says why; the list's tags are `meta-tokens.ts`, the
// holders' their own). Like meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/token-bundle.test.ts), and nothing of
// `app/domain/token-params.ts`, which checks an issuer's checksum. The facts it reads (`TokenMetaFacts`) were written by the view builder (`tokenFacts`, token-view.ts), whose types alone it
// imports; the link-preview image's card is made of the same facts (`tokenCard`, in card-data.ts).

import type { MetaDescriptor } from "react-router";

import { shortAddress } from "../domain/format";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";
import type { TokenMetaFacts } from "./token-view";

/**
 * The tags of `/{net}/token/{token}` (spec 7.1), from the facts the view builder wrote (`TokenPageData.meta`).
 *
 * - The title is "{name} ({CODE}) · XRPL · explorer", and without a toml name "{CODE} by {issuer short} · XRPL · explorer" (the title keeps the short issuer: display names spec 7).
 * - The description is "{CODE}, issued by {issuer short} on XRPL: holders, supply, price, markets, the issuer's settings and recent transfers." It has no figure: the page is stored for
 *   a few seconds and its numbers move.
 * - The first page is indexable: the canonical URL is the token's path on the origin of the request (`TokenMetaFacts.href`), with the link-preview image (`/og/{net}/token/{token}.png`)
 *   and a large card. A page of older transfers behind a marker is "Older transfers of {CODE} · …", `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function tokenMeta(facts: TokenMetaFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const issuer = shortAddress(facts.issuer);
  const suffix = suffixOf(network);

  if (facts.more) {
    return [
      { title: `Older transfers of ${facts.code} · ${suffix}` },
      { name: "description", content: `Older transfers of ${facts.code}, issued by ${issuer} on ${network.name}.` },
      { name: "robots", content: "noindex, follow" },
    ];
  }

  const named = facts.name !== undefined ? `${facts.name} (${facts.code})` : `${facts.code} by ${issuer}`;
  return sharing({
    title: `${named} · ${suffix}`,
    description: `${facts.code}, issued by ${issuer} on ${network.name}: holders, supply, price, markets, the issuer's settings and recent transfers.`,
    url: absolute(origin, facts.href),
    image: { url: imageUrl(origin, network.id, "token", facts.segment), alt: `${facts.name ?? facts.code}, an issued token of ${issuer} on ${network.name}` },
  });
}
