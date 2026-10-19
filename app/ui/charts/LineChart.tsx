import { memo, type ReactNode } from "react";

import { cellOf, lastOf, type Cell } from "./cells";
import { PANEL_HEIGHT, PLOT_HEIGHT, areaPath, fractionOf, keptEndLabels, linePath, niceScale, percent, xOf } from "./geometry";
import { emptyText, endLabelValue, plotSummary, sliderLabel, valueText } from "./labels";
import { Plot } from "./Plot";
import type { TimeSeriesData } from "./types";
import { bucketWords, DASH } from "./words";

export interface LineChartProps {
  /** The chart's name: the slider's and the summary's. */
  title: string;
  data: TimeSeriesData;
  /** A wash under the line, down to the baseline, for one series: the first. An area starts at 0 whatever the domain says. */
  area?: boolean;
  /** `"step"` is step-after: level to the next bucket, then up or down to its value. */
  curve?: "linear" | "step";
}

export interface LinePlotProps extends LineChartProps {
  /** A small multiple's panel: 110 px, 3 ticks, x labels at the two ends, no end label (its header says the value) and no series name. */
  panel?: boolean;
}

/**
 * The plot of lines (spec 2.2, 2.6 and 2.11), which `LineChart` and the panels of `SmallMultiples` draw. The lines and the area are one
 * `<svg viewBox="0 0 1000 H" preserveAspectRatio="none">` stretched to the plot, 2 px at any width (`vector-effect`, charts.css). The first
 * series is drawn last, on top, as the board does. The end dots, the end labels and the references are HTML boxes in percent of the plot,
 * so that the Worker prints the finished chart and CSS lays it out. The cursor adds a crosshair, a dot for each series, the tooltip and the
 * slider, which says the bucket in full.
 *
 * An end dot is on the last value of each series, the end label ("**45.5M** payments") beside it in the gutter, for 4 series or fewer: a later
 * label is left out when it would sit within 16 px of one that is drawn, at the 160 px height. The scale starts at 0 unless the data's
 * `domain` says another start (not for an area), takes its `max` when a step divides the domain, and holds the references, so that a
 * threshold above the values is still on it. A value outside the domain is not clipped, and the builder's domain has to hold its values.
 * A bucket with no value in any series is a gap, and a value between two gaps is a dot (`linePath`).
 */
export function LinePlot({ title, data, area = false, curve = "linear", panel = false }: LinePlotProps) {
  const { axis, format, forming = false, pending = 0 } = data;
  const count = axis.buckets.length;

  // An area is one series: the first.
  const series = area ? data.series.slice(0, 1) : data.series;
  const cells = series.map((s) => axis.buckets.map((_, i) => cellOf(s.values[i])));
  const at = (k: number, i: number): Cell | null => cells[k]?.[i] ?? null;
  const has = (i: number): boolean => cells.some((column) => column[i] !== null);
  const drawn = axis.buckets.some((_, i) => has(i));

  // With nothing to draw the plot has the empty scale of its domain, and none of its references.
  const references = drawn
    ? (data.references ?? []).flatMap(({ value, label }) => {
        const cell = cellOf(value);
        return cell ? [{ label, value: cell.value }] : [];
      })
    : [];
  const scale = niceScale([...cells.flat().map((cell) => cell?.value ?? null), ...references.map((reference) => reference.value)], {
    integer: format.kind === "count",
    from: area ? undefined : cellOf(data.domain?.min)?.value,
    to: cellOf(data.domain?.max)?.value,
    ticks: panel ? 3 : 5,
  });

  const box = { height: panel ? PANEL_HEIGHT : PLOT_HEIGHT.wide, placement: "points", curve } as const;
  const lines = series.map((s, k) => {
    const fractions = cells[k]!.map((cell) => (cell ? fractionOf(cell.value, scale) : null));
    const i = lastOf(cells[k]!);
    return {
      series: s,
      d: linePath(fractions, box),
      wash: area ? areaPath(fractions, box) : "",
      end: i < 0 ? null : { i, f: fractions[i]!, cell: cells[k]![i]! },
    };
  });

  // The end labels, for 4 series or fewer, and the ones that fit: the gap is that of the 160 px plot, in px from the top.
  const kept = keptEndLabels(lines.map(({ end }) => (end ? PLOT_HEIGHT.narrow * (1 - end.f) : null)));
  const endLabels =
    drawn && !panel && series.length <= 4
      ? lines.map(({ series: s, end }, k) =>
          end && kept[k] ? (
            <span key={s.id} className="plot__end-label" style={{ top: percent(1 - end.f) }}>
              <b>{endLabelValue(end.cell.text, format)}</b> {s.short ?? s.label}
            </span>
          ) : null,
        )
      : undefined;

  // The words: the running bucket is "so far" in a tooltip and to the slider, never on the axis.
  const { date, gapReadOut, gapTip } = bucketWords(axis, forming, pending);
  const full = (cell: Cell): string => valueText(cell.text, format, "full");

  /** The slider's text for bucket `i`: the date, then each series with its value; or why there is none. A panel is named by its slider. */
  const readOut = (i: number): string => {
    if (!has(i)) return gapReadOut(i);
    const named = series.flatMap((s, k) => {
      const cell = at(k, i);
      return cell ? [panel ? full(cell) : `${s.label} ${full(cell)}`] : [];
    });
    return `${date(i)}: ${named.join("; ")}`;
  };

  /** The tooltip's content for bucket `i` (spec 2.6): the date, and a row for each series: its key, the value strong and the name muted. */
  const tooltip = (i: number): ReactNode => {
    if (!has(i)) return gapTip(i);
    return (
      <>
        <span className="plot__tip-date">{date(i)}</span>
        {series.map((s, k) => {
          const cell = at(k, i);
          return (
            <span key={s.id} className="plot__tip-row">
              <span className="plot__tip-key" data-slot={s.slot} />
              <b>{cell ? full(cell) : DASH}</b>
              {!panel && (
                <>
                  {" "}
                  <span className="plot__tip-name">{s.label}</span>
                </>
              )}
            </span>
          );
        })}
      </>
    );
  };

  const dots = (i: number) =>
    series.flatMap((s, k) => {
      const cell = at(k, i);
      return cell ? [{ y: fractionOf(cell.value, scale), slot: s.slot }] : [];
    });

  return (
    <Plot
      title={title}
      summary={plotSummary(title, data)}
      token={data.token}
      scale={scale}
      kind={format.kind}
      axis={axis}
      xLabels={panel ? "ends" : "spread"}
      placement="points"
      height={panel ? "panel" : "chart"}
      empty={drawn ? null : emptyText(axis)}
      endLabels={endLabels}
      cursor={{ count, placement: "points", label: sliderLabel(title, axis.unit), valueText: readOut, tooltip, crosshair: true, dots }}
    >
      <svg className="lines" viewBox={`0 0 1000 ${box.height}`} preserveAspectRatio="none">
        {lines.map(({ series: s, wash }) => (wash ? <path key={s.id} className="area" data-slot={s.slot} d={wash} /> : null))}
        {[...lines].reverse().map(({ series: s, d }) => (d ? <path key={s.id} className="line" data-slot={s.slot} d={d} /> : null))}
      </svg>
      {references.map(({ label, value }, n) => (
        <div key={n} className="ref" style={{ bottom: percent(fractionOf(value, scale)) }}>
          <span className="ref__label">{label}</span>
        </div>
      ))}
      {lines.map(({ series: s, end }) =>
        end ? (
          <span key={s.id} className="plot__dot" data-slot={s.slot} style={{ left: percent(xOf(end.i, count, "points")), bottom: percent(end.f) }} />
        ) : null,
      )}
    </Plot>
  );
}

/**
 * 1 to 3 lines, or an area with its line (spec 2.11): see `LinePlot`. Memoised on `title`, `area`, `curve` and the data's `token` (spec
 * 2.9): a beat that brings the same token renders nothing.
 */
export const LineChart = memo(
  function LineChart({ title, data, area, curve }: LineChartProps) {
    return <LinePlot title={title} data={data} area={area} curve={curve} />;
  },
  (before, after) =>
    before.title === after.title && before.area === after.area && before.curve === after.curve && before.data.token === after.data.token,
);
