// The tags of an MPT's transfers' page (E14 spec 9), with the helpers of meta.ts. Only the transfers' route imports this module (meta.ts says why; the issuance's tags are `meta-mpt.ts`, the holders'
// `meta-mpt-holders.ts`). Like meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/mpt-bundle.test.ts), and nothing of `app/domain/mpt.ts`. The facts it
// reads (`MptListMetaFacts`) were written by the view builder (`mptTransfersPage`, mpt-view.ts), whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { shortAddress } from "../domain/format";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { MptTransfersPageData, NoMptPageData } from "./mpt-view";

/**
 * The tags of `/{net}/mpt/{ID}/transfers` (spec 9), from the facts the view builder wrote (`MptTransfersPageData.meta`), or of the page that says MPT is not on Xahau (`NoMptPageData`). The title is "Transfers of HTF · XRPL · explorer"; the description has no figure and
 * names the issuer by its short address.
 *
 * The first page is indexable, with a canonical URL on the origin of the request, Open Graph tags and a summary card, and no image. A page of older transfers behind a marker is `noindex, follow`, with the
 * same title and no canonical URL or sharing tags. A page whose head is from the network (`MptListMetaFacts.noindex`: the index has no rows to list yet) is `noindex`, as the issuance's own page is, with the
 * same title and description and no canonical URL or sharing tags.
 */
export function mptTransfersMeta(data: Pick<MptTransfersPageData, "kind" | "meta"> | NoMptPageData, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  // The page that says MPT is not on Xahau (spec 3.6), a 404 of its own: its title and `noindex`. (Each of the three MPT routes names it in its own builder: a builder is imported by one route alone,
  // test/unit/meta-bundle.test.ts, so that no page loads another's.)
  if (data.kind === "no-mpt") return [{ title: `MPT isn't enabled on ${data.network.name} · ${suffixOf(ctx.network)}` }, { name: "robots", content: "noindex" }];
  const facts = data.meta;
  const title = `Transfers of ${facts.code} · ${suffixOf(network)}`;
  const description = `The transfers of ${facts.code}, an MPT issued by ${shortAddress(facts.issuer)} on ${network.name}, newest first: payments, clawbacks, locks and unlocks, and escrows.`;
  // A list whose head the index does not have yet (read from the network) is `noindex`, as the issuance's own page is: title, description and `noindex`, with no canonical URL or sharing tags.
  if (facts.noindex) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex" }];
  if (facts.more) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  return sharing({ title, description, url: absolute(origin, facts.href) });
}
