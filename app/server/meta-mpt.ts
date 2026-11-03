// The tags of an MPT's page (E14 spec 9), with the helpers of meta.ts. Only the MPT page's route imports this module (meta.ts says why; the holders' and the transfers' tags are
// `meta-mpt-holders.ts` and `meta-mpt-transfers.ts`). Like meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/mpt-bundle.test.ts), and nothing of
// `app/domain/mpt.ts`, which carries bignumber.js. The facts it reads (`MptFacts`) were written by the view builder (`mptFacts`, mpt-view.ts), whose types alone it imports; the link-preview
// image's card is made of the same facts (Task 14).

import type { MetaDescriptor } from "react-router";

import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { MptFacts, NoMptPageData } from "./mpt-view";

/**
 * The tags of `/{net}/mpt/{ID}` (spec 9), from the facts the view builder wrote (`MptPageData.facts`).
 *
 * - The title is "{ticker} · {name} · MPT · XRPL · explorer", and without a ticker or a name "MPT 0000012A…3F09 · XRPL · explorer" (the facts hold the title up to its end, which is the network's).
 * - The description is "MPT issued by {the issuer's display name, else its short address}: 18,204,511.20 HTF outstanding, 3,412 holders · XRPL". It holds figures: the page is kept for a minute, and the
 *   description of a page that is stored is that of its time.
 * - An issuance the index has is indexable: the canonical URL is the page's path on the origin of the request, with Open Graph tags and a summary card (the link-preview image is Task 14's).
 *   One read from the network (`facts.noindex`) is not: title, description and `noindex`, with no canonical URL or sharing tags, since the index will have a page of its own for it.
 */
export function mptMeta(facts: MptFacts, ctx: MetaContext): MetaDescriptor[] {
  const title = `${facts.title} · ${suffixOf(ctx.network)}`;
  if (facts.noindex) return [{ title }, { name: "description", content: facts.description }, { name: "robots", content: "noindex" }];
  return sharing({ title, description: facts.description, url: absolute(ctx.origin, facts.href) });
}

/** The tags of the page that says MPT is not on Xahau (spec 3.6): its title and `noindex`. */
export function noMptMeta(data: Pick<NoMptPageData, "network">, ctx: MetaContext): MetaDescriptor[] {
  return [{ title: `MPT isn't enabled on ${data.network.name} · ${suffixOf(ctx.network)}` }, { name: "robots", content: "noindex" }];
}
