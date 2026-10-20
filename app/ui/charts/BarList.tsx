import { memo, useRef, type CSSProperties } from "react";

import { formatAmount } from "../../domain/format";
import { RouteLink } from "../components/RouteLink";
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
  /**
   * What follows the value at the tip of a bar: the share text the view builder wrote (`"share"`, the default: "**1.24B XRP** · 58%"), or the
   * item's count and "trades" (`"count"`: "**6.1M XRP** · 312 trades"), which needs no share. In `"count"` the bars are measured against the
   * first item's value (the list is sorted), not against the largest.
   */
  tip?: "share" | "count";
}

/** The label column is at least this many characters of the label's own mono font (7 is 56 px at 13 px, the board's) and at most 45% of the list. */
const LABEL_MIN = 7;
/** A sublabel is set in 11 px under a label of 13 px: its characters are this much of one of the label's. */
const SUB_SCALE = 11 / 13;

/** "312 trades", "1 trade": the count grouped, with its noun. */
const tradesText = (count: string): string => `${formatAmount(count)} ${count === "1" ? "trade" : "trades"}`;

/**
 * Labelled horizontal bars (spec 2.3 and 2.11), an ordered list with a row for each item, in the order given: its label, with the sublabel (a
 * short issuer) under it, then a bar as long as the item's value over the largest of the list, and at the tip of the bar the value (strong)
 * and the share in text: "**1.24B XRP** · 58%". The share is the view builder's whole text ("58%", "<1%"). The bar is a picture
 * (`aria-hidden`); the words are the list. A bar is drawn for a value above 0 only, and the exact amounts and counts are the table view's
 * (`count` is in the table; at the tip only with `tip="count"`).
 *
 * An item with an `href` has its label as a link to it (`RouteLink`, a client-side navigation); the bar and the tip stay text, so a row has
 * one target, and a hit area of 24 px is the stylesheet's.
 *
 * Nothing is measured: the label's column is the characters of the longest label (or sublabel) and the room after the longest bar the
 * characters of the longest tip, in CSS units (`--label`, `--tip`; charts.css), so the Worker prints the finished list. The longest bar is the
 * whole width the tip leaves.
 *
 * Memoised on `dense`, `tip` and the data's `token` (spec 2.9): a beat that brings the same token renders nothing, and a new one rings the list.
 */
export const BarList = memo(
  function BarList({ data, dense = false, tip = "share" }: BarListProps) {
    const { items, format } = data;
    const root = useRef<HTMLOListElement>(null);
    const ring = usePlotRing(data.token, root);

    const sizes = items.map((item) => cellOf(item.value)?.value ?? 0);
    // The bars are measured against the largest, or, for a list of counts, against the first (a sorted list's largest, the traders'), and
    // none is drawn when that is not above 0.
    const whole = tip === "count" ? (sizes[0] ?? 0) : Math.max(0, ...sizes);
    // What follows the value, or nothing: an item without a share (or without a count) has its value alone.
    const tips = items.map((item) => ({
      value: valueText(item.value, format, "compact"),
      after: tip === "count" ? (item.count === undefined ? null : tradesText(item.count)) : (item.share ?? null),
    }));

    const labelChars = Math.max(LABEL_MIN, ...items.map((item) => Math.max(item.label.length, Math.ceil((item.sublabel?.length ?? 0) * SUB_SCALE))));
    // " · " between the value and the share; one more column for the bold value.
    const tipChars = Math.max(0, ...tips.map((text) => text.value.length + (text.after === null ? 0 : 3 + text.after.length))) + 1;
    const style = { "--label": `min(${labelChars}ch, 45%)`, "--tip": `calc(${tipChars}ch + 10px)` } as CSSProperties;

    return (
      <ol ref={root} className={cx("barlist", dense && "barlist--dense", ring && "is-changed")} style={style}>
        {items.map((item, i) => (
          <li key={item.id} className="barlist__item">
            <span className="barlist__name">
              <span className="barlist__label">
                {item.href ? (
                  <RouteLink to={item.href} className="barlist__link">
                    {item.label}
                  </RouteLink>
                ) : (
                  item.label
                )}
              </span>
              {item.sublabel && <span className="barlist__sub">{item.sublabel}</span>}
            </span>
            <span className="barlist__lane">
              {sizes[i]! > 0 && whole > 0 && <span className="barlist__bar" style={{ width: percent(Math.min(1, sizes[i]! / whole)) }} aria-hidden="true" />}
              <span className="barlist__tip">
                <b>{tips[i]!.value}</b>
                {tips[i]!.after !== null && ` · ${tips[i]!.after}`}
              </span>
            </span>
          </li>
        ))}
      </ol>
    );
  },
  (before, after) => before.dense === after.dense && before.tip === after.tip && before.data.token === after.data.token,
);
