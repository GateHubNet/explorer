// The tags of the network page (spec 9), with the helpers of meta.ts. Only the network route imports this module (meta.ts says why).

import type { MetaDescriptor } from "react-router";

import { DEFAULT_NETWORK_PARAMS, type NetworkParams } from "../domain/network-params";
import { PRODUCT_NAME } from "../ui/brand";
import { absolute, sharing, type MetaContext } from "./meta";

/** How a period reads in the title of a view of the network page. */
const PERIOD_TITLES = {
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  "1y": "last 52 weeks",
} as const satisfies Record<NetworkParams["period"], string>;

/**
 * The tags of `/{net}/network`. The default view is indexable, with a canonical URL on the origin of the request and no image (a dashboard
 * picture would be out of date within a ledger). Every other view says what it shows in its title and is `noindex, follow`, with no
 * canonical URL and no Open Graph or card tags, as a page of old history is: one URL is the page, the rest are views of it. The description
 * has no numbers: the page is stored for a second.
 */
export function networkMeta(view: NetworkParams, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const isDefault = view.period === DEFAULT_NETWORK_PARAMS.period && view.display === DEFAULT_NETWORK_PARAMS.display;
  const named = [
    `${network.name} network`,
    view.period === DEFAULT_NETWORK_PARAMS.period ? null : PERIOD_TITLES[view.period],
    view.display === "usd" ? "in USD" : null,
    PRODUCT_NAME,
  ].filter((part) => part !== null);
  const title = named.join(" · ");
  const description = `Transactions by type, fees, payment and DEX volume, and the validators of ${network.name}, updated with every ledger.`;

  if (!isDefault) return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  return sharing({ title, description, url: absolute(origin, `/${network.id}/network`) });
}
