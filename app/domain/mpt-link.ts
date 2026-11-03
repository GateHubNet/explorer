// Where a link to an MPT issuance leads (E14): the one decision every inbound MPT link makes, and the page's path. Pure and safe for the browser, so that the pages that show an MPT but are no
// MPT page (a transaction's sentence and flow, an account's Tokens card and objects, an escrow's amount) load only this. A leaf: types are imported, and erased, and it imports nothing at run time
// (mpt-link.test.ts pins it), so it adds no file to `Sentence`'s closure. The path is written here and not by `mptPath` (mpt.ts, which the MPT pages load), for that reason.

import type { Features } from "../ui/features";
import type { NetworkId } from "../server/networks";

/**
 * The one place an inbound MPT link is decided: the issuance's page while `MPT` is on, else null (plain text). The ID is written in upper case, the canonical form of the page's URL (a
 * lower-case ID would be a redirect), whatever case it was given in; the caller has checked that it is 48 hex digits (an amount's `mpt_issuance_id` is). Whether the network has MPT is not asked
 * here: an MPT amount exists only where it does, and on Xahau the page answers its own 404.
 */
export function mptLink(net: NetworkId, id: string, features: Features): string | null {
  return features.mpt ? `/${net}/mpt/${id.toUpperCase()}` : null;
}
