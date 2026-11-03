// The tags of an MPT's holders' page (E14 spec 9), with the helpers of meta.ts. Only the holders' route imports this module (meta.ts says why; the issuance's tags are `meta-mpt.ts`, the transfers'
// `meta-mpt-transfers.ts`). Like meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/mpt-bundle.test.ts), and nothing of `app/domain/mpt.ts`. The facts it
// reads (`MptListMetaFacts`) were written by the view builder (`mptHoldersPage`, mpt-view.ts), whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { shortAddress } from "../domain/format";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { MptHoldersPageData, NoMptPageData } from "./mpt-view";

/**
 * The tags of `/{net}/mpt/{ID}/holders` (spec 9), from the facts the view builder wrote (`MptHoldersPageData.meta`), or of the page that says MPT is not on Xahau (`NoMptPageData`). The title is "Holders of HTF · XRPL · explorer"; the description has no figure (the page
 * is kept for a minute, and its numbers move) and names the issuer by its short address.
 *
 * The first page is indexable, with a canonical URL on the origin of the request (`MptListMetaFacts.href`), Open Graph tags and a summary card, and no image: a ranking that is rebuilt every minute would
 * have its picture out of date at once, and the issuance's page has the image. A page behind a marker is `noindex, follow`, with the same title and no canonical URL or sharing tags.
 */
export function mptHoldersMeta(data: Pick<MptHoldersPageData, "kind" | "meta"> | NoMptPageData, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  // The page that says MPT is not on Xahau (spec 3.6), a 404 of its own: its title and `noindex`. (Each of the three MPT routes names it in its own builder: a builder is imported by one route alone,
  // test/unit/meta-bundle.test.ts, so that no page loads another's.)
  if (data.kind === "no-mpt") return [{ title: `MPT isn't enabled on ${data.network.name} · ${suffixOf(ctx.network)}` }, { name: "robots", content: "noindex" }];
  const facts = data.meta;
  const title = `Holders of ${facts.code} · ${suffixOf(network)}`;
  const description = `Every account that holds ${facts.code}, an MPT issued by ${shortAddress(facts.issuer)} on ${network.name}, the largest balance first, with each holder's share and whether its balance is locked.`;
  if (facts.more) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  return sharing({ title, description, url: absolute(origin, facts.href) });
}
