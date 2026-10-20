// The tags of the home page (spec 9), with the helpers of meta.ts. Only the home route imports this module (meta.ts says why).

import type { MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../ui/brand";
import { absolute, sharing, type MetaContext } from "./meta";

/**
 * The tags of `/{net}`. `heading` is the page's own title (`Explore the XRP Ledger`). The description does not name the newest ledger:
 * it would change every few seconds and say nothing about the page. There is no image: the card is of a transaction, a ledger or an
 * account, and the home page is none of them.
 */
export function homeMeta(heading: string, ctx: MetaContext): MetaDescriptor[] {
  return sharing({
    title: `${heading} · ${PRODUCT_NAME}`,
    description: `Look up any ledger, transaction or account on ${ctx.network.name} from validated history.`,
    url: absolute(ctx.origin, `/${ctx.network.id}`),
  });
}
