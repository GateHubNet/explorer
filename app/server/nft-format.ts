// The small words and numbers that the NFT view builders (nfts-view.ts, nft-collection-view.ts, and the builders of the NFT page) write alike: the dash, a JSON number as plain
// text, a count with its thousands grouped, "412 sales", a share as a percent to one decimal, and the fields of a GET form read back from a canonical link. No I/O, no clock, no `Intl`; each number is the API's own text or made with
// BigNumber, so no float and no exponent reaches a label.

import { formatAmount } from "../domain/format";
import { BN, decimalOf, divided } from "./exact";

/** What stands in a cell or a figure that has no value. */
export const DASH = "—";

/** A JSON number as plain text: BigNumber writes the digits, `String(n)` would write an exponent from 1e21. */
export const plain = (n: number): string => new BN(n).toFixed();

/** A count with its thousands grouped. */
export const counted = (n: number): string => formatAmount(plain(n));

/** The words of a sale count: `412 sales`, `1 sale`. */
export const salesCount = (count: number): string => `${counted(count)} ${count === 1 ? "sale" : "sales"}`;

/**
 * `part` as a percent of `whole` to one decimal, half up (`43.9%`, `100.0%`), and `<0.1%` for a share that is more than nothing and rounds to 0.0; a dash for a share of nothing.
 * Exact: BigNumber, never a float.
 */
export function sharePercentTenth(part: string, whole: string): string {
  const [share, total] = [decimalOf(part), decimalOf(whole)];
  if (share === null || total === null || share.isNegative() || !total.gt(0)) return DASH;
  const tenths = divided(share.times(100), total, 1);
  return tenths.isZero() && share.gt(0) ? "<0.1%" : `${tenths.toFixed(1)}%`;
}

/**
 * The query of a link as [name, value] pairs, in the link's order, decoded: how a builder gives a GET form the fields that keep the view (the view's canonical link, defaults
 * dropped, written by `nftsHref` or `collectionHref`, read back, so that the defaults are theirs and cannot drift). None for a link with no query.
 */
export function queryPairsOf(href: string): Array<[name: string, value: string]> {
  const at = href.indexOf("?");
  return at < 0 ? [] : Array.from(new URLSearchParams(href.slice(at + 1)), ([name, value]): [string, string] => [name, value]);
}
