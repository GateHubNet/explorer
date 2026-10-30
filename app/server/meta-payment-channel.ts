// The tags of a payment channel's page (ledger object pages spec 11), with the helpers of meta.ts. Only the channel's route imports this module (meta.ts says why). Like meta.ts, it runs in the
// browser too: it value-imports nothing of app/server but ./meta (test/unit/meta-bundle.test.ts); the facts it reads (`PaymentChannelPageData.meta`) were written by the view builder
// (`payment-channel-view.ts`), whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { shortHash } from "../domain/format";
import { absolute, sharing, suffixOf, type MetaContext } from "./meta";
import type { PaymentChannelMeta } from "./payment-channel-view";

/**
 * The tags of `/{net}/payment-channels/{ID}` (spec 11), from the facts the view builder wrote.
 *
 * - The title is the channel's short ID: "Payment channel E22CCE…69EA · XRPL · explorer".
 * - The description is what was deposited in it, from whom and to whom, its status and the network: "Payment channel of 1 XRP from rQQQrU…3ZrM to rLggTE…KrtR · open · XRPL". The accounts are
 *   short addresses (C14: a description is shared out of context; only an account's own page says its name), and there is no age. A deposit D5 could not read is left out with its "of".
 * - The page is indexable: the canonical URL is `/{net}/payment-channels/{ID}` on the origin of the request, with the Open Graph tags and a summary card, and no image (decision 9). A page
 *   of older events (a marker) is `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function paymentChannelMeta(facts: PaymentChannelMeta, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = `Payment channel ${shortHash(facts.id)} · ${suffixOf(network)}`;
  const description = `Payment channel ${facts.amount === "" ? "" : `of ${facts.amount} `}from ${facts.owner} to ${facts.destination} · ${facts.status} · ${network.name}`;
  if (facts.marker) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  return sharing({ title, description, url: absolute(origin, `/${network.id}/payment-channels/${facts.id}`) });
}
