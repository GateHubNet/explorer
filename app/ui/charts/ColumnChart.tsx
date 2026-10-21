import { memo, type CSSProperties, type ReactNode } from "react";

import { cellOf, type Cell } from "./cells";
import { fractionOf, niceScale, percent, stackOf } from "./geometry";
import { emptyText, plotSummary, sliderLabel, valueText } from "./labels";
import { Plot } from "./Plot";
import type { Slot, TimeSeriesData, ValueFormat } from "./types";
import { bucketWords, DASH, extraWords } from "./words";

export interface ColumnChartProps {
  /** One series; the series bottom up; or the first series up and the second down from the zero line. */
  layout: "single" | "stacked" | "diverging";
  /** The chart's name: the region's ("{title}, scrollable chart"), the slider's and the summary's. */
  title: string;
  data: TimeSeriesData;
}

/** A segment is its exact share, so a stack of three thirds shows all three: `66.667%`, at most 3 decimals. */
const pct = (fraction: number): string => percent(fraction, 3);

/** A total with what it counts, when `valueText` leaves that out: `15 transactions`. An amount already has its unit (`45.5M XRP`). */
function quantity(text: string, format: ValueFormat): string {
  const value = valueText(text, format, "full");
  return format.kind === "count" && format.unit ? `${value} ${format.unit}` : value;
}

/**
 * Columns (spec 2.2 and 2.11), in three layouts. `single` draws the first series in `--series-1`. `stacked` draws the series bottom up in
 * their slots, each segment its exact share of the stack, and the stack as high as its total (the sum of the segments, in percent of the
 * scale). `diverging` draws the first series up in `--up` and the second down in `--down` from the zero line of a scale that is the same on
 * both sides; the second is a magnitude, drawn down, and `totals` is the net, which the kit shows and does not compute.
 *
 * The marks are HTML boxes positioned in percent, so the Worker prints the finished chart and CSS lays it out (charts.css): a slot for
 * each bucket (`.col`, which the cursor marks), and in it the bar and, for an annotation, the symbol that rests on it. A bucket with no value
 * has its slot and no bar. The plot scrolls sideways beyond 5 px a bucket (`slots`); the cursor adds the tooltip and the slider, which says
 * the bucket in full.
 *
 * Memoised on `layout`, `title` and the data's `token` (spec 2.9): a beat that brings the same token renders nothing.
 */
export const ColumnChart = memo(
  function ColumnChart({ layout, title, data }: ColumnChartProps) {
    const { axis, format, totals, annotations, forming = false, pending = 0 } = data;
    const count = axis.buckets.length;
    const last = count - 1;

    // The series each layout draws, and the slot of each: a single chart is in the first, a diverging one is up and down.
    const series = layout === "single" ? data.series.slice(0, 1) : layout === "diverging" ? data.series.slice(0, 2) : data.series;
    const slots: Slot[] = layout === "single" ? [1] : layout === "diverging" ? ["up", "down"] : series.map((s) => s.slot);

    const cells = series.map((s) => axis.buckets.map((_, i) => cellOf(s.values[i])));
    const at = (k: number, i: number): Cell | null => cells[k]?.[i] ?? null;
    const has = (i: number): boolean => cells.some((column) => column[i] !== null);
    // What a column is drawn with. A column starts at 0 and goes up (a negative value is no part of a count or a volume), and a diverging
    // pair are both magnitudes.
    const size = (k: number, i: number): number | null => {
      const cell = at(k, i);
      if (!cell) return null;
      return layout === "diverging" ? Math.abs(cell.value) : Math.max(0, cell.value);
    };
    const stacks = axis.buckets.map((_, i) => stackOf(series.map((_, k) => size(k, i))));
    /** The stack of a bucket is as high as its last segment ends. */
    const total = (i: number): number => stacks[i]?.at(-1)?.to ?? 0;

    // Counts have whole ticks. A diverging scale has the same ticks above and below the zero line, and fewer of them: 3 on each side.
    const integer = format.kind === "count";
    const scale =
      layout === "diverging"
        ? niceScale(series.flatMap((_, k) => axis.buckets.map((_, i) => size(k, i))), { integer, symmetric: true, ticks: 3 })
        : niceScale(axis.buckets.map((_, i) => (has(i) ? total(i) : null)), { integer });
    const zero = fractionOf(0, scale);

    /** Where the top of what is drawn in bucket `i` is, as a fraction of the plot's height: an annotation rests on it. */
    const topOf = (i: number): number => {
      if (layout === "diverging") {
        const up = size(0, i);
        return up === null ? zero : fractionOf(up, scale);
      }
      return has(i) ? fractionOf(total(i), scale) : 0;
    };

    const bars = (i: number): ReactNode => {
      if (!has(i)) return null;
      if (layout === "diverging") {
        const up = size(0, i);
        const down = size(1, i);
        const floor = down === null ? zero : fractionOf(-down, scale);
        return (
          <>
            {up !== null && <span className="col__bar" data-slot="up" style={{ bottom: pct(zero), height: pct(fractionOf(up, scale) - zero) }} />}
            {down !== null && <span className="col__bar col__bar--down" data-slot="down" style={{ bottom: pct(floor), height: pct(zero - floor) }} />}
          </>
        );
      }
      const sum = total(i);
      const height = pct(fractionOf(sum, scale));
      if (layout === "single") return <span className="col__bar" data-slot={1} style={{ height }} />;
      // A series with nothing in the bucket has no segment, so the last child is the highest one drawn: the one with no inset.
      return (
        <span className="col__bar" style={{ height }}>
          {stacks[i]!.map(({ from, to }, k) => to > from && <span key={k} className="col__seg" data-slot={slots[k]} style={{ height: pct((to - from) / sum) }} />)}
        </span>
      );
    };

    const noted = new Map<number, NonNullable<TimeSeriesData["annotations"]>>();
    for (const note of annotations ?? []) {
      if (Number.isInteger(note.bucket) && note.bucket >= 0 && note.bucket <= last) noted.set(note.bucket, [...(noted.get(note.bucket) ?? []), note]);
    }

    // The words. The running bucket is "so far" in a tooltip and to the slider, never on the axis (Plot's labels are the axis').
    const { date: dateOf, gapReadOut, gapTip } = bucketWords(axis, forming, pending);
    const full = (cell: Cell): string => valueText(cell.text, format, "full");
    const extras = extraWords(data.extras);

    /** The slider's text for bucket `i`: the date, then the total, then each series with its value, the extras; or why there is none. */
    const readOut = (i: number): string => {
      if (!has(i)) return gapReadOut(i);
      const sum = cellOf(totals?.[i]);
      const named = series.flatMap((s, k) => {
        const cell = at(k, i);
        return cell ? [`${s.label} ${full(cell)}`] : [];
      });
      let parts: string[];
      if (layout === "single") parts = [quantity(at(0, i)?.text ?? "", format)];
      else if (layout === "stacked") parts = [...(sum ? [quantity(sum.text, format)] : []), ...named];
      else parts = [...named, ...(sum ? [`Net ${full(sum)}`] : [])];
      return `${dateOf(i)}: ${[...parts, ...extras.read(i), ...(noted.get(i) ?? []).map((note) => note.label)].join("; ")}`;
    };

    /** The tooltip's content for bucket `i` (spec 2.6): the date, a row for each series, the total (or the net), the extras, the annotations. */
    const tooltip = (i: number): ReactNode => {
      if (!has(i)) return gapTip(i);
      const sum = cellOf(totals?.[i]);
      return (
        <>
          <span className="plot__tip-date">{dateOf(i)}</span>
          {series.map((s, k) => {
            const cell = at(k, i);
            return (
              <span key={s.id} className="plot__tip-row">
                <span className="plot__tip-key" data-slot={slots[k]} />
                <b>{cell ? full(cell) : DASH}</b> <span className="plot__tip-name">{s.label}</span>
              </span>
            );
          })}
          {layout === "stacked" && sum && (
            <span className="plot__tip-total">
              <b>{full(sum)}</b> <span className="plot__tip-name">total</span>
            </span>
          )}
          {layout === "diverging" && sum && (
            <span className="plot__tip-total">
              <span className="plot__tip-name">Net</span> <b>{full(sum)}</b>
            </span>
          )}
          {extras.rows(i)}
          {(noted.get(i) ?? []).map((note, n) => (
            <span key={n} className="plot__tip-note">
              <span className="plot__tip-symbol">{note.symbol}</span> {note.label}
            </span>
          ))}
        </>
      );
    };

    return (
      <Plot
        title={title}
        summary={plotSummary(title, data)}
        token={data.token}
        scale={scale}
        kind={format.kind}
        axis={axis}
        placement="bands"
        slots
        empty={axis.buckets.some((_, i) => has(i)) ? null : (data.emptyText ?? emptyText(axis))}
        cursor={{ count, placement: "bands", label: sliderLabel(title, axis.unit), valueText: readOut, tooltip }}
      >
        <div className="plot__cols">
          {axis.buckets.map((_, i) => (
            <div key={i} className="col" data-bucket={i}>
              {bars(i)}
              {noted.has(i) && (
                <span className="col__note" style={{ "--top": pct(topOf(i)) } as CSSProperties}>
                  {noted.get(i)!.map((note) => note.symbol).join("")}
                </span>
              )}
            </div>
          ))}
        </div>
      </Plot>
    );
  },
  (before, after) => before.layout === after.layout && before.title === after.title && before.data.token === after.data.token,
);
