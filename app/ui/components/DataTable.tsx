import type { CSSProperties, ReactNode } from "react";

import { cx } from "../cx";

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
 * What scrolls is a region a keyboard can reach (`tabindex="0"`) and that is named like the table, because a table whose rows hold
 * no link or button has nothing to focus and could not be scrolled from the keyboard (axe: scrollable-region-focusable). Its ring
 * is drawn inside it (components.css): the card around it clips an outside one.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  minWidth,
  empty,
}: {
  /** What the table is, for screen readers. */
  label: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  minWidth?: number;
  /** Shown instead of rows when there are none. */
  empty?: ReactNode;
}) {
  const style = { "--cols": columns.map((column) => column.width).join(" "), minWidth } as CSSProperties;
  const cellClass = (column: Column<Row>) =>
    cx("table__cell", column.align === "end" && "is-end", column.ellipsis && "is-ellipsis");

  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <div role="table" aria-label={label} style={style}>
        <div role="row" className="table__row table__head">
          {columns.map((column) => (
            <span key={column.id} role="columnheader" className={cellClass(column)}>
              {column.header}
            </span>
          ))}
        </div>
        {rows.map((row, index) => (
          <div key={rowKey(row, index)} role="row" className="table__row">
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
