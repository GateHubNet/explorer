import { shareOf } from "./cells";
import { percent } from "./geometry";

export type InlineBarProps =
  /** The depth of an order book: `value` over `max` of the row's width, in the wash of bids (`up`) or of asks (`down`). */
  | { value: string; max: string; tone: "up" | "down" }
  /** Where a balance changed: `out` to the left of the centre line and `in` to the right, on the one scale `max` for every row. */
  | { diverging: true; out: string; in: string; max: string };

/**
 * A bar behind or inside a table row (spec 2.11), always `aria-hidden`: the row's cells carry the values.
 *
 * The depth form is a wash (`--up-wash`, `--down-wash`) behind the row's text, grown from the row's end, as wide as `value` over `max`, with a
 * 3 px radius at its open end. The row it sits in must be `position: relative`, and the bar be its first child: the cells after it are put above
 * it by the stylesheet, so that the text keeps its contrast on the wash.
 *
 * The diverging form is 14 px high: `--down` to the left of a centre line of 1 px in `--axis` and `--up` to the right. The largest `max` of all
 * the rows reaches the end of its half, so `out` 2 and `in` 1 of a `max` of 4 are 25% and 12.5% of the width.
 */
export function InlineBar(props: InlineBarProps) {
  if ("diverging" in props) {
    const out = shareOf(props.out, props.max) / 2;
    const into = shareOf(props.in, props.max) / 2;
    return (
      <span className="inline-bar inline-bar--diverging" aria-hidden="true">
        {out > 0 && <span className="inline-bar__out" style={{ width: percent(out) }} />}
        {into > 0 && <span className="inline-bar__in" style={{ width: percent(into) }} />}
      </span>
    );
  }
  return <span className={`inline-bar inline-bar--${props.tone}`} style={{ width: percent(shareOf(props.value, props.max)) }} aria-hidden="true" />;
}
