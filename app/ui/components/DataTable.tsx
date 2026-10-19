import { useRef, type CSSProperties, type ReactNode } from "react";

import { cx } from "../cx";
import { useLiveRows } from "../use-live-rows";

export interface Column<Row> {
  id: string;
  header: ReactNode;
  /** The column's track in the grid: `120px`, `minmax(120px, 1.4fr)`. */
  width: string;
  /** Numbers and amounts go to the end. */
  align?: "start" | "end";
  /** Cut a long value with an ellipsis instead of wrapping it. */
  ellipsis?: boolean;
  cell: (row: Row, index: number) => ReactNode;
}

/**
 * A table of the mock's look (46 px rows, a faint header row, a hover row), built as ARIA `table`/`row`/`cell` over a CSS
 * grid so columns can be given tracks. It scrolls sideways inside its card on a phone: `minWidth` is the width below which
 * it does. Put it in `<Card flush>`.
 *
 * What scrolls is a region a keyboard can reach (`tabindex="0"`), because a table whose rows hold no link or button has nothing to
 * focus and could not be scrolled from the keyboard (axe: scrollable-region-focusable). Its ring is drawn inside it (components.css):
 * the card around it clips an outside one. It is named for the table but not like it, "{label}, scrollable table": the card the table
 * sits in is a region named by its title, often the same words, and two landmarks of one name cannot be told apart (axe: landmark-unique).
 *
 * `compact` makes the rows 34 px (the chart kit's table view), with 12 px gaps and padding, so a `minWidth` counts those. `maxHeight` (px) caps the
 * region's height: it scrolls up and down inside it, with the header row kept in view (components.css).
 *
 * `live` makes the rows follow their data in the browser (the home page's): after the first render a row whose key is new enters (the class
 * `is-entering`, which the stylesheet animates) and the rows that were there slide into their new places (`useLiveRows`). Off, the table is
 * exactly what it was: no key on the rows, no class, no style. Keys must be stable and unique, which `rowKey` is for.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  minWidth,
  empty,
  live = false,
  compact = false,
  maxHeight,
}: {
  /** What the table is, for screen readers. */
  label: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  minWidth?: number;
  /** Shown instead of rows when there are none. */
  empty?: ReactNode;
  /** Rows enter and move with animation when `rows` change after the first render. */
  live?: boolean;
  /** Rows of 34 px instead of 46 px. */
  compact?: boolean;
  /** The tallest the region gets, in px; it scrolls on y beyond that. */
  maxHeight?: number;
}) {
  const table = useRef<HTMLDivElement>(null);
  const keys = rows.map((row, index) => rowKey(row, index));
  const entering = useLiveRows(table, keys, live);
  const style = { "--cols": columns.map((column) => column.width).join(" "), minWidth } as CSSProperties;
  const rowClass = cx("table__row", compact && "table--compact");
  const cellClass = (column: Column<Row>) =>
    cx("table__cell", column.align === "end" && "is-end", column.ellipsis && "is-ellipsis");

  return (
    <div
      className={cx("table-scroll", maxHeight !== undefined && "table-scroll--capped")}
      style={maxHeight === undefined ? undefined : { maxHeight }}
      role="region"
      aria-label={`${label}, scrollable table`}
      tabIndex={0}
    >
      <div ref={table} role="table" aria-label={label} style={style}>
        <div role="row" className={cx(rowClass, "table__head")}>
          {columns.map((column) => (
            <span key={column.id} role="columnheader" className={cellClass(column)}>
              {column.header}
            </span>
          ))}
        </div>
        {rows.map((row, index) => (
          <div
            key={keys[index]}
            role="row"
            className={cx(rowClass, entering.has(keys[index]!) && "is-entering")}
            data-key={live ? keys[index] : undefined}
          >
            {columns.map((column) => (
              <span key={column.id} role="cell" className={cellClass(column)}>
                {column.cell(row, index)}
              </span>
            ))}
          </div>
        ))}
      </div>
      {rows.length === 0 && empty && <div className="table__empty">{empty}</div>}
    </div>
  );
}
