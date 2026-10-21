// The tags of the AMM pools list (AMM spec 5.1), with the helpers of meta.ts. Only the list's route imports this module (meta.ts says why). Like
// meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/meta-bundle.test.ts); the facts it reads
// (`AmmListFacts`) were written by the view builder, whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { ammListPath } from "../domain/amm-params";
import type { AmmListFacts } from "./amm-view";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";

/** The list's description (spec 5.1). It has no number: the page is stored for seconds. Only the XRP Ledger has the list (Xahau has no AMM). */
const DESCRIPTION = "Automated market maker pools on the XRP Ledger: the value, reserves, trading fee and swap volume of every pool.";

/** What the tags of a page that is not for a search engine are: its title, its description and `noindex, follow` (E2's rule for non-default views). */
const noindex = (title: string, description: string): MetaDescriptor[] => [
  { title },
  { name: "description", content: description },
  { name: "robots", content: "noindex, follow" },
];

/**
 * The tags of `/{net}/amm` (spec 5.1), from the facts the view builder wrote (`AmmListPageData.meta`), or `{ none: true }` for the page of a network
 * without AMM (Xahau's explanation, `NoAmmPage`).
 *
 * The first page with no filter is indexable, with a canonical URL on the origin of the request and no image (a list that changes every minute would
 * have its picture out of date at once). Every other view is `noindex, follow`, with no canonical URL and no Open Graph or card tags: one asset ("AMM
 * pools with RLUSD"), the deleted pools ("(deleted included)", after the asset), a page behind a marker ("More AMM pools"), and an asset that does not
 * parse, whose page shows no pools and so says neither the asset nor the deleted ones ("AMM pools"). Xahau's page is `noindex, follow` too: it says
 * that there is nothing to list.
 */
export function ammListMeta(facts: AmmListFacts | { none: true }, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const suffix = suffixOf(network);
  if ("none" in facts) {
    return noindex(`AMM pools · ${suffix}`, `${network.name} has no AMM: the AMM amendment is not part of ${network.name}, so there are no pools to show.`);
  }

  const { assetLabel, deleted, more, error } = facts;
  if (error) return noindex(`AMM pools · ${suffix}`, DESCRIPTION);
  const lead = [more ? "More AMM pools" : "AMM pools", ...(assetLabel === undefined ? [] : [`with ${assetLabel}`]), ...(deleted ? ["(deleted included)"] : [])].join(" ");
  const title = `${lead} · ${suffix}`;
  if (more || deleted || assetLabel !== undefined) return noindex(title, DESCRIPTION);
  return sharing({ title, description: DESCRIPTION, url: absolute(origin, ammListPath(network.id)) });
}
