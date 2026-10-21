// Where a link to an AMM pool leads (AMM spec 5.3): the one decision every inbound pool link makes, and the pool page's path. It is apart from
// amm-params.ts (which re-exports both) so that the pages that show a pool link but are no AMM page (a transaction's sentence and flow, an account's
// LP tokens and its own pool line) load only this and `accountHref`, and not the AMM pages' query writers and readers (`queryValue`, `parseTrail`,
// the marker alphabet). The build puts a module that several routes import in a chunk those routes share, so a smaller module here is fewer bytes and
// fewer files on each of those pages. Pure and safe for the browser; types are imported, and erased.

import type { Features } from "../ui/features";
import { accountHref } from "./account-tabs";

/** A pool's path: `/xrpl/amm/rhWTXC…`. The pool is the address a loader has validated, so nothing of it is escaped in practice. */
export function ammPoolPath(net: string, pool: string): string {
  return `/${net}/amm/${encodeURIComponent(pool)}`;
}

/**
 * The one place that decides where a pool link goes: the pool page when `features.ammPages` (its path, which is `ammPoolHref` with no query), else
 * the account page.
 */
export function poolLink(net: string, pool: string, features: Features): string {
  return features.ammPages ? ammPoolPath(net, pool) : accountHref(net, pool, {});
}
