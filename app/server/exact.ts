// The exact arithmetic that the view builders share (spec 3.1: "Exact quotients, half up"): the percents, the price of a ratio of two amounts, a fee as a
// percent. No builder has a copy of any of it that could drift. Pure: bignumber.js and `formatAmount`, no I/O, no clock, no `Intl`.

import BigNumber from "bignumber.js";

import { formatAmount } from "../domain/format";

const MINUS = "−";

/** Eighty decimal places, half up: the arithmetic of every view builder that divides. */
export const BN = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

/** `n ÷ d` (d above 0) to `places` decimals, half away from zero, exactly: BigNumber's own division rounds at 20 places before we round. */
export function divided(n: BigNumber, d: BigNumber, places: number): BigNumber {
  const rounded = n.abs().shiftedBy(places).times(2).plus(d).idiv(d.times(2)).shiftedBy(-places);
  return n.isNegative() && !rounded.isZero() ? rounded.negated() : rounded;
}

/**
 * A percent already rounded to 1 decimal (`divided(…, 1)`) as a tile's delta text, with its sign: `+4.2%`, `−0.1%` (U+2212 for a drop), and `0.0%`
 * with sign 0 for zero. The integer part is grouped (`+333,233.3%`).
 */
export function percentText(percent: BigNumber): { text: string; sign: 1 | -1 | 0 } {
  const sign = percent.isZero() ? 0 : percent.isNegative() ? -1 : 1;
  return { text: `${sign === 1 ? "+" : sign === -1 ? MINUS : ""}${formatAmount(percent.abs().toFixed(1))}%`, sign };
}

/**
 * `numerator ÷ denominator` (the denominator not 0) to 8 significant digits, half up. The division is made on the two amounts scaled into [1, 10), so that its
 * 80 places are 80 significant digits whatever the size of the amounts: 1e-81 ÷ 9.999999999999999e95 is 1e-177, which 80 places alone would have made 0.
 */
export function ratioOf(numerator: BigNumber, denominator: BigNumber): BigNumber {
  // Made again as a `BN`, so that the arithmetic is at 80 places half up whatever the caller's own `BigNumber` is set to.
  const [top, bottom] = [new BN(numerator), new BN(denominator)];
  const [above, below] = [top.e ?? 0, bottom.e ?? 0];
  return top.shiftedBy(-above).div(bottom.shiftedBy(-below)).shiftedBy(above - below).precision(8, BigNumber.ROUND_HALF_UP);
}

/** A fee in units of 1/100000 (the ledger's, the node's and the data API's) as a percent with three decimals: `205` is `0.205%`, `1000` (the largest) is `1.000%`. */
export function feePercent(units: number): string {
  return `${new BigNumber(units).shiftedBy(-3).toFixed(3)}%`;
}
