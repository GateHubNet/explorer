import { memo, useRef, type CSSProperties } from "react";

import { cx } from "../cx";
import { cellOf } from "./cells";
import { percent } from "./geometry";
import { valueText } from "./labels";
import { usePlotRing } from "./Plot";
import type { BarListData } from "./types";

export interface BarListProps {
  data: BarListData;
  /** 12 px bars and closer rows, for a list in a card among other things (spec 2.11), where 18 px is a lot. */
  dense?: boolean;
}

/** The label column is at least this many characters of the label's own mono font (7 is 56 px at 13 px, the board's) and at most 45% of the list. */
const LABEL_MIN = 7;
/** A sublabel is set in 11 px under a label of 13 px: its characters are this much of one of the label's. */
const SUB_SCALE = 11 / 13;

/**
 * Labelled horizontal bars (spec 2.3 and 2.11), an ordered list with a row for each item, in the order given: its label, with the sublabel (a
 * short issuer) under it, then a bar as long as the item's value over the largest of the list, and at the tip of the bar the value (strong)
 * and the share in text: "**1.24B XRP** · 58%". The share is the view builder's whole text ("58%", "<1%"). The bar is a picture
 * (`aria-hidden`); the words are the list. A bar is drawn for a value above 0 only, and the exact amounts and counts are the table view's
 * (`count` is only in the table).
 *
 * Nothing is measured: the label's column is the characters of the longest label (or sublabel) and the room after the longest bar the
 * characters of the longest tip, in CSS units (`--label`, `--tip`; charts.css), so the Worker prints the finished list. The longest bar is the
 * whole width the tip leaves.
 *
 * Memoised on `dense` and the data's `token` (spec 2.9): a beat that brings the same token renders nothing, and a new one rings the list.
 */
export const BarList = memo(
  function BarList({ data, dense = false }: BarListProps) {
    const { items, format } = data;
    const root = useRef<HTMLOListElement>(null);
    const ring = usePlotRing(data.token, root);

    const sizes = items.map((item) => cellOf(item.value)?.value ?? 0);
    const largest = Math.max(0, ...sizes);
    const tips = items.map((item) => ({ value: valueText(item.value, format, "compact"), share: item.share }));

    const labelChars = Math.max(LABEL_MIN, ...items.map((item) => Math.max(item.label.length, Math.ceil((item.sublabel?.length ?? 0) * SUB_SCALE))));
    // " · " between the value and the share; one more column for the bold value.
    const tipChars = Math.max(0, ...tips.map((tip) => tip.value.length + 3 + tip.share.length)) + 1;
    const style = { "--label": `min(${labelChars}ch, 45%)`, "--tip": `calc(${tipChars}ch + 10px)` } as CSSProperties;

    return (
      <ol ref={root} className={cx("barlist", dense && "barlist--dense", ring && "is-changed")} style={style}>
        {items.map((item, i) => (
          <li key={item.id} className="barlist__item">
            <span className="barlist__name">
              <span className="barlist__label">{item.label}</span>
              {item.sublabel && <span className="barlist__sub">{item.sublabel}</span>}
            </span>
            <span className="barlist__lane">
              {sizes[i]! > 0 && <span className="barlist__bar" style={{ width: percent(sizes[i]! / largest) }} aria-hidden="true" />}
              <span className="barlist__tip">
                <b>{tips[i]!.value}</b> · {tips[i]!.share}
              </span>
            </span>
          </li>
        ))}
      </ol>
    );
  },
  (before, after) => before.dense === after.dense && before.data.token === after.data.token,
);
