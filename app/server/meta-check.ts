// The tags of a check's page (ledger object pages spec 11), with the helpers of meta.ts. Only the check's route imports this module (meta.ts says why). Like meta.ts, it runs in the browser
// too: it value-imports nothing of app/server but ./meta (test/unit/meta-bundle.test.ts); the facts it reads (`CheckPageData.meta`) were written by the view builder (`check-view.ts`), whose
// types alone it imports.

import type { MetaDescriptor } from "react-router";

import { shortHash } from "../domain/format";
import type { CheckMeta } from "./check-view";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";

/**
 * The tags of `/{net}/checks/{ID}` (spec 11), from the facts the view builder wrote.
 *
 * - The title is the check's short ID: "Check 60FCB1…1A42 · XRPL · explorer".
 * - The description is what it allows, from whom and to whom, its status and the network: "Check for up to 1,000 XRP from rJF2Xa…fQvg to rNYbL8…UKq5 · open · XRPL". The accounts are short
 *   addresses (C14: a description is shared out of context; only an account's own page says its name), and there is no age. A SendMax D5 could not read is left out with its "for up to".
 * - The page is indexable: the canonical URL is `/{net}/checks/{ID}` on the origin of the request, with the Open Graph tags and a summary card, and no image (decision 9). A page of older
 *   events (a marker) is `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function checkMeta(facts: CheckMeta, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = `Check ${shortHash(facts.id)} · ${suffixOf(network)}`;
  const description = `Check ${facts.amount === "" ? "" : `for up to ${facts.amount} `}from ${facts.owner} to ${facts.destination} · ${facts.status} · ${network.name}`;
  if (facts.marker) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  return sharing({ title, description, url: absolute(origin, `/${network.id}/checks/${facts.id}`) });
}
