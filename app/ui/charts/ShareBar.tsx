import { memo, useRef, type PointerEvent } from "react";

import { formatAmount } from "../../domain/format";
import { sharePercent } from "../../domain/percent";
import { cx } from "../cx";
import { useHydrated } from "../use-hydrated";
import { cellOf } from "./cells";
import { useCursorState } from "./Cursor";
import { percent, tooltipSide } from "./geometry";
import { tickLabel } from "./labels";
import type { LegendItem } from "./Legend";
import { usePlotRing } from "./Plot";
import type { ShareData } from "./types";

export interface ShareBarProps {
  /** The chart's name: the slider's and the summary's. */
  title: string;
  data: ShareData;
  /** What a row's total counts, printed after it in the label column: `{ one: "validator", other: "validators" }` gives "35 validators" and "1 validator". Without it, the total is the number alone. */
  unit?: { one: string; other: string };
}

type Row = ShareData["rows"][number];
type Segment = Row["segments"][number];

/** A segment shows its label under itself when its share of the row is at least this many percent (spec 2.11). */
const LABEL_SHARE = 18;
/** The ticks of the % axis. */
const TICKS = [0, 25, 50, 75, 100];

/** A segment that is drawn: a value above 0 in a row that has a total. `index` is its place in reading order, over every row. */
interface Part {
  index: number;
  row: Row;
  segment: Segment;
  /** Its share of the row, from 0 to 1, and where it starts. */
  start: number;
  width: number;
  /** Its label is under it: its share is at least `LABEL_SHARE`. Compared by the numbers, as geometry does, and with no division. */
  labelled: boolean;
}

/**
 * The segments of each row, in order, each with its place in the row: a value of 0 (or one that is not a number) is not drawn, and a row with
 * no total above 0 draws none. The parts have an `index` in reading order (row, then segment), which is how the cursor steps.
 */
function partsOf(data: ShareData): { row: Row; parts: Part[] }[] {
  let index = 0;
  return data.rows.map((row) => {
    const total = cellOf(row.total)?.value ?? 0;
    const parts: Part[] = [];
    let start = 0;
    for (const segment of total > 0 ? row.segments : []) {
      const value = cellOf(segment.value)?.value ?? 0;
      if (!(value > 0)) continue;
      parts.push({ index: index++, row, segment, start, width: value / total, labelled: value * 100 >= LABEL_SHARE * total });
      start += value / total;
    }
    return { row, parts };
  });
}

/** What is said of a segment, for the slider: "UNL: 3.4.1, 12 of 35 (34%)". */
const said = ({ row, segment }: Part): string =>
  `${row.label}: ${segment.label}, ${formatAmount(segment.value)} of ${formatAmount(row.total)} (${sharePercent(segment.value, row.total)})`;

/**
 * The legend of the share bars (spec 2.11): a swatch for each segment id, in the order they are first met in the rows, in the slot of the
 * first row that has it, for the page to give to `Legend`.
 */
export function shareLegend(data: ShareData): LegendItem[] {
  const items = new Map<string, LegendItem>();
  for (const row of data.rows) {
    for (const { id, label, slot } of row.segments) if (!items.has(id)) items.set(id, { id, label, key: "swatch", slot });
  }
  return [...items.values()];
}

/**
 * 100% stacked horizontal rows (spec 2.2, 2.3 and 2.11): a row of 28 px with its label and total in a column of its own, and its segments in
 * order, each as wide as its share of the row's total (HTML boxes in percent, so that the Worker prints the finished chart). A segment of
 * 18% or more has its name and share under it. A % axis is under the rows. A value of 0 draws nothing, and nothing to draw says "No data".
 *
 * The cursor (after hydration) steps through the segments in reading order, a row and then the next: the arrow keys, Home and End, or the
 * pointer over a segment. It dims the other segments, shows a tooltip under the row it is on, and its slider says "UNL: 3.4.1, 12 of 35
 * (34%)". A touch keeps what it selected until a touch lands elsewhere. The keys, what is selected and shown, and the touch's pin are the
 * plot cursor's (`useCursorState` in Cursor.tsx), so that they do not differ between forms; only the pointer is this form's own, since a
 * plot's cursor finds a bucket by its x and these segments are as wide as their values.
 *
 * Memoised on `title`, the data's `token` and the `unit` (spec 2.9): a beat that brings the same token renders nothing, and a new one rings the rows.
 */
export const ShareBar = memo(
  function ShareBar({ title, data, unit }: ShareBarProps) {
    const lines = partsOf(data);
    const parts = lines.flatMap((line) => line.parts);
    const last = parts.length - 1;

    const root = useRef<HTMLDivElement>(null);
    const rows = useRef<HTMLDivElement>(null);
    const ring = usePlotRing(data.token, root);
    const hydrated = useHydrated();

    // Where this cursor's own input put it, whether that shows, the keys, and what a touch keeps: the protocol of every cursor (Cursor.tsx).
    const { index, open, select, hide, pin, onKeyDown } = useCursorState({ initial: 0, last, inside: rows });
    const current = open ? parts[index] : undefined;

    /** The segment under the pointer: the one that has `data-bucket` at or above the target. */
    const partAt = (event: PointerEvent): number | null => {
      const mark = event.target instanceof Element ? event.target.closest("[data-bucket]") : null;
      const i = mark ? Number(mark.getAttribute("data-bucket")) : NaN;
      return Number.isInteger(i) && i >= 0 && i <= last ? i : null;
    };

    const drawn = last >= 0;
    const largest = (items: Part[]) => items.reduce((top, part) => (Number(part.segment.value) > Number(top.segment.value) ? part : top));
    const summary = drawn
      ? `${title}. ${lines
          .map(({ row, parts: own }) => (own.length > 0 ? `${row.label}: largest ${largest(own).segment.label}, ${sharePercent(largest(own).segment.value, row.total)}.` : `${row.label}: no data.`))
          .join(" ")} Choose Table for every value.`
      : `${title}: No data.`;

    return (
      <div ref={root} className={cx("share", ring && "is-changed")} data-active={current ? current.index : undefined}>
        <div
          ref={rows}
          className="share__rows"
          role="img"
          aria-label={summary}
          onPointerMove={(event) => {
            const i = partAt(event);
            if (i !== null) select(i);
            else if (event.pointerType !== "touch") hide();
          }}
          onPointerDown={(event) => {
            const i = partAt(event);
            if (i === null) return;
            select(i);
            if (event.pointerType === "touch") pin();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") hide();
          }}
        >
          {drawn ? (
            <div className="share__rows-in" aria-hidden="true">
              {lines.map(({ row, parts: own }) => (
                <div key={row.id} className="share__row">
                  <span className="share__name">
                    <b>{row.label}</b>
                    <span>{unit === undefined ? formatAmount(row.total) : `${formatAmount(row.total)} ${row.total === "1" ? unit.one : unit.other}`}</span>
                  </span>
                  <div className="share__track">
                    <div className="share__bar">
                      {own.map((part) => (
                        <span
                          key={part.index}
                          className={cx("share__seg", current === part && "is-active")}
                          data-slot={part.segment.slot}
                          data-bucket={part.index}
                          style={{ width: percent(part.width, 3) }}
                        />
                      ))}
                    </div>
                    <div className="share__labels">
                      {own.map(
                        (part) =>
                          part.labelled && (
                            <span key={part.index} className="share__label" style={{ left: percent(part.start, 3), width: percent(part.width, 3) }}>
                              <b>{part.segment.label}</b> {sharePercent(part.segment.value, row.total)}
                            </span>
                          ),
                      )}
                    </div>
                    {current && own.includes(current) && (
                      <div className={cx("plot__tip", "share__tip", tooltipSide(current.start + current.width / 2))} style={{ left: percent(current.start + current.width / 2, 3) }} aria-hidden="true">
                        <span className="plot__tip-date">{row.label}</span>
                        <span className="plot__tip-row">
                          <span className="plot__tip-key" data-slot={current.segment.slot} />
                          <b>{current.segment.label}</b>
                        </span>
                        <span className="plot__tip-row">
                          <b>{formatAmount(current.segment.value)}</b>{" "}
                          <span className="plot__tip-name">
                            of {formatAmount(row.total)} ({sharePercent(current.segment.value, row.total)})
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="share__row share__row--axis">
                <span />
                <div className="share__axis" aria-hidden="true">
                  {TICKS.map((tick) => (
                    <span key={tick} style={{ left: `${tick}%` }}>
                      {tickLabel(tick, "percent")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            // The summary already says it for a screen reader.
            <p className="share__empty" aria-hidden="true">
              No data
            </p>
          )}
        </div>
        {hydrated && drawn && (
          <div
            className="share__cursor"
            role="slider"
            tabIndex={0}
            aria-label={`${title}, segment by segment`}
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={index}
            aria-valuetext={said(parts[index]!)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (!open) select(index);
            }}
            onBlur={hide}
          />
        )}
      </div>
    );
  },
  (before, after) =>
    before.title === after.title &&
    before.data.token === after.data.token &&
    before.unit?.one === after.unit?.one &&
    before.unit?.other === after.unit?.other,
);
