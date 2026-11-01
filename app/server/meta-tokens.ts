// The tags of the token list (E11 spec 7.1), with the helpers of meta.ts. Only the list's route imports this module (meta.ts says why; the token page's tags are `meta-token.ts`, the
// holders' their own). Like meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/token-bundle.test.ts), and nothing of
// `app/domain/token-params.ts`, which checks an issuer's checksum: the canonical path is written here, as `tokensHref` writes it (meta.test.ts pins both). The facts it reads
// (`TokensMetaFacts`) were written by the view builder, whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { TokensMetaFacts } from "./token-view";

/** What the tags of a page that is not for a search engine are: its title, its description and `noindex, follow` (E2's rule for non-default views). */
const noindex = (title: string, description: string): MetaDescriptor[] => [
  { title },
  { name: "description", content: description },
  { name: "robots", content: "noindex, follow" },
];

/** The title's lead: "Tokens", "All tokens", "More tokens" behind a marker, and "matching “q”" for a search (a search names the page before all does). */
function leadOf({ q, all, more }: TokensMetaFacts): string {
  const lead = more ? "More tokens" : q === undefined && all ? "All tokens" : "Tokens";
  return q === undefined ? lead : `${lead} matching “${q}”`;
}

/**
 * The tags of `/{net}/tokens` (spec 7.1), from the facts the view builder wrote (`TokensPageData.meta`). The title is "Tokens · XRPL · explorer"; the description has no figure (the page
 * is stored for a minute, and its numbers move) and names the network as a sentence does (`longName`: "the XRP Ledger", "Xahau", "XRPL Testnet").
 *
 * The default view is indexable, with a canonical URL on the origin of the request and no image (a list that changes every minute would have its picture out of date at once). Every
 * other view is `noindex, follow`, with no canonical URL and no Open Graph or card tags: a search ("Tokens matching “USD”"), all the tokens ("All tokens"), a page behind a marker
 * ("More tokens"), and a search that was too long to ask, which is "Tokens" and does not repeat what was typed.
 */
export function tokensMeta(facts: TokensMetaFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = `${leadOf(facts)} · ${suffixOf(network)}`;
  const description = `Issued tokens on ${network.longName}, ranked by holders: supply, price, 24-hour volume and whether each issuer's toml lists it.`;
  if (facts.q !== undefined || facts.all || facts.more || facts.error) return noindex(title, description);
  return sharing({ title, description, url: absolute(origin, `/${network.id}/tokens`) });
}
