// The tags of a token's holders' page (E11 spec 7.1), with the helpers of meta.ts. Only the holders' route imports this module (meta.ts says why; the token page's tags are `meta-token.ts`, the
// list's `meta-tokens.ts`). Like meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/token-bundle.test.ts), and nothing of
// `app/domain/token-params.ts`, which checks an issuer's checksum. The facts it reads (`TokenHoldersMetaFacts`) were written by the view builder (`tokenHoldersPage`, token-view.ts), whose types
// alone it imports.

import type { MetaDescriptor } from "react-router";

import { shortAddress } from "../domain/format";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { TokenHoldersMetaFacts } from "./token-view";

/**
 * The tags of `/{net}/token/{token}/holders` (spec 7.1), from the facts the view builder wrote (`TokenHoldersPageData.meta`). The title is "Holders of {CODE} · XRPL · explorer"; the description has
 * no figure (the page is stored for a minute, and its numbers move) and names the issuer as the token's page does, by its short address.
 *
 * The first page is indexable, with a canonical URL on the origin of the request (`TokenHoldersMetaFacts.href`), Open Graph tags and a summary card, and no image: a ranking that is rebuilt
 * every minute would have its picture out of date at once, and the token's page has the image. A page behind a marker is `noindex, follow`, with the same title and no canonical URL or sharing tags.
 */
export function tokenHoldersMeta(facts: TokenHoldersMetaFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = `Holders of ${facts.code} · ${suffixOf(network)}`;
  const description = `Every account that holds ${facts.code}, issued by ${shortAddress(facts.issuer)} on ${network.name}, the largest balance first, with each holder's limit and status.`;
  if (facts.more) {
    return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  }
  return sharing({ title, description, url: absolute(origin, facts.href) });
}
