// The tags of an amendment's page (validators spec 8), with the helpers of meta.ts. Only the amendment route imports this module (meta.ts says why). Like meta.ts, it runs
// in the browser too: it value-imports nothing of `ripple-*`, of the view builder or of the loader's modules (test/unit/meta-bundle.test.ts); it reads the title and the
// description the view builder wrote.

import type { MetaDescriptor } from "react-router";

import { shortHash } from "../domain/format";
import type { AmendmentPageData } from "./amendment-view";
import { absolute, imageUrl, sharing, type MetaContext } from "./meta";

/**
 * The tags of `/{net}/amendments/{name}` (validators spec 8). The page has one URL (any query string is a redirect), so it is always indexable: a canonical URL on the origin
 * of the request, Open Graph and the amendment's link-preview image (`/og/{net}/amendment/{canonical}.png`). The title and the description are the builder's: the sentence of
 * the status, then D1's description. They hold no age and no countdown: the page is stored for a minute.
 */
export function amendmentMeta(page: Pick<AmendmentPageData, "canonical" | "identity" | "meta">, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  // A nameless amendment's canonical segment is its ID.
  const name = page.canonical === page.identity.id ? shortHash(page.identity.id) : page.identity.heading;
  return sharing({
    title: page.meta.title,
    description: page.meta.description,
    url: absolute(origin, `/${network.id}/amendments/${page.canonical}`),
    image: { url: imageUrl(origin, network.id, "amendment", page.canonical), alt: `Amendment ${name} on ${network.name}` },
  });
}
