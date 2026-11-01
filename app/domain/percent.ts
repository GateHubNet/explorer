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

/**
 * `part` as a percent of `whole` to the precision a supply needs, half up and exactly, in plain digits (never an exponent): two decimals from 1% (`35.21%`, `3.00%`, `100.00%`), two
 * significant digits under it (`0.015%`, `0.071%`, `0.00000010%`), and a carry keeps the two (`0.9996%` is `1.0%`, `0.0999%` is `0.10%`). A `part` of exactly 0 is `0%`. A `whole` that is
 * not above 0, a `part` below 0 and what is not a number are a dash, as `sharePercent` says them.
 */
export function finePercent(part: string, whole: string): string {
  if (!DECIMAL.test(part) || !DECIMAL.test(whole)) return EM_DASH;
  const share = new BigNumber(part);
  const total = new BigNumber(whole);
  if (share.lt(0) || !total.gt(0)) return EM_DASH;
  if (share.isZero()) return "0%";

  // ×100 to be a percent: `share ÷ total` is under 1% exactly when `100 × share < total`.
  if (share.times(100).gte(total)) {
    // floor(100 × 100 × part ÷ whole + ½), without a division that rounds: (20000 × part + whole) ÷ (2 × whole), whole part. Two decimals of it.
    const hundredths = share.times(20_000).plus(total).idiv(total.times(2));
    return `${hundredths.shiftedBy(-2).toFixed(2)}%`;
  }

  // Under 1%: the decimals that put the first significant digit in the tens, i.e. the least `places` (2 or more) with `100 × part × 10^places ≥ 10 × whole`. The exponents of the two numbers
  // bound where it is (`e` of a number is its power of ten), so the loop runs once or twice.
  let places = Math.max(2, (total.e ?? 0) - (share.e ?? 0) - 1);
  while (share.times(100).shiftedBy(places).lt(total.times(10))) places += 1;
  // floor(100 × part × 10^places ÷ whole + ½), exactly. It has two digits, or is 100 after a carry: then it is 10 with one place less.
  let digits = share.times(200).shiftedBy(places).plus(total).idiv(total.times(2));
  if (digits.gte(100)) {
    digits = digits.shiftedBy(-1);
    places -= 1;
  }
  return `${digits.shiftedBy(-places).toFixed(places)}%`;
}
