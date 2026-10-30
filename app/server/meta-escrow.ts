// The tags of an escrow's page (ledger object pages spec 11), with the helpers of meta.ts. Only the escrow's route imports this module (meta.ts says why). Like meta.ts, it runs in the browser
// too: it value-imports nothing of app/server but ./meta (test/unit/meta-bundle.test.ts); the facts it reads (`EscrowPageData.meta`) were written by the view builder (`escrow-view.ts`), whose
// types alone it imports.

import type { MetaDescriptor } from "react-router";

import { shortHash } from "../domain/format";
import type { EscrowMeta } from "./escrow-view";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";

/**
 * The tags of `/{net}/escrows/{ID}` (spec 11), from the facts the view builder wrote.
 *
 * - The title is the escrow's short ID: "Escrow 5B9C0E…D21F · XRPL · explorer".
 * - The description is what it holds, from whom and to whom, its status and the network: "Escrow of 1,000 XRP from rJF2Xa…fQvg to rNYbL8…UKq5 · pending · XRPL". The accounts are short
 *   addresses (C14: a description is shared out of context; only an account's own page says its name), and there is no age. An amount D5 could not read is left out with its "of".
 * - The page is indexable: the canonical URL is `/{net}/escrows/{ID}` on the origin of the request, with the Open Graph tags and a summary card, and no image (decision 9). A page of older
 *   events (a marker) is `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function escrowMeta(facts: EscrowMeta, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = `Escrow ${shortHash(facts.id)} · ${suffixOf(network)}`;
  const description = `Escrow ${facts.amount === "" ? "" : `of ${facts.amount} `}from ${facts.owner} to ${facts.destination} · ${facts.status} · ${network.name}`;
  if (facts.marker) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  return sharing({ title, description, url: absolute(origin, `/${network.id}/escrows/${facts.id}`) });
}
