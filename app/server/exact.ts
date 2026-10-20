// The exact arithmetic that the view builders' percents share (spec 3.1: "Exact quotients, half up"), so that no builder has a copy of it that
// could drift. Pure: bignumber.js and `formatAmount`, no I/O, no clock, no `Intl`.

import BigNumber from "bignumber.js";

import { formatAmount } from "../domain/format";

const MINUS = "−";

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
