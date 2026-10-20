// The percent rules of the bars and the markets pages: a share as a whole percent. Pure: the browser and the Worker both import this file.
//
// These are apart from format.ts on purpose. format.ts is in the closure of the root route's static imports, so the build puts it in the
// shell chunk every page loads, and whatever of it any one page imports is then on every page. A page that draws a share (a ShareBar, a
// markets figure) imports this file and pays for it alone. So format.ts must not import or re-export this file: any edge from there pulls
// these functions back into the shell.

import BigNumber from "bignumber.js";

import { DECIMAL } from "./format";

const EM_DASH = "—";

/**
 * `part` as a whole percent of `whole`, half up, exactly (`58%`), and `<1%` below one half of a percent. A share of nothing
 * (a `whole` that is not above 0) or of what is not a number is a dash.
 */
export function sharePercent(part: string, whole: string): string {
  if (!DECIMAL.test(part) || !DECIMAL.test(whole)) return EM_DASH;
  const share = new BigNumber(part);
  const total = new BigNumber(whole);
  if (share.lt(0) || !total.gt(0)) return EM_DASH;
  // floor(100 × part ÷ whole + ½), without a division that rounds: (200 × part + whole) ÷ (2 × whole), whole part.
  const percent = share.times(200).plus(total).idiv(total.times(2));
  return percent.isZero() ? "<1%" : `${percent.toFixed()}%`;
}

/**
 * The one percent rule of the markets pages: `sharePercent`, except that a `part` of exactly 0 is `0%` (a share of nothing is still a dash).
 * So `<1%` always means more than 0 and less than one half of a percent.
 */
export function wholePercent(part: string, whole: string): string {
  if (DECIMAL.test(part) && DECIMAL.test(whole) && new BigNumber(part).isZero() && new BigNumber(whole).gt(0)) return "0%";
  return sharePercent(part, whole);
}
