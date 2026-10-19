import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cx } from "../cx";
import { Cursor, type CursorProps } from "./Cursor";
import { END_LABEL_GUTTER_PX, MIN_SLOT_PX, fractionOf, xLabelPicks, xOf, type Placement, type ValueScale } from "./geometry";
import { bucketLabel, tickLabel } from "./labels";
import type { TimeAxis, ValueKind } from "./types";

// Defined beside the cursor, which is what needs it: Plot imports Cursor, and Cursor importing Plot back would be a cycle.
export { useHydrated } from "./Cursor";

/** `51.72%`: at most 2 decimals, and no trailing zeros (the same as the cursor's). */
const percent = (fraction: number): string => `${Math.round(fraction * 10000) / 100}%`;

export interface PlotProps {
  /** The scroll region's name: "{title}, scrollable chart". */
  title: string;
  /** The `aria-label` of the box that holds the marks, which a screen reader meets as one image (`plotSummary`). */
  summary: string;
  /** What the data says, as text: the ring runs when it changes after the first render, and not before. */
  token: string;
  /** The gridlines (1 px `--grid`, the 0 line `--axis`) and the labels of the y axis, in a gutter outside the scroll region. */
  scale: ValueScale;
  kind: ValueKind;
  /** The x labels: both sets (`xLabelPicks` wide and narrow) are rendered, and the card's width picks one. */
  axis: TimeAxis;
  placement: Placement;
  /** Columns: the plot is at least `MIN_SLOT_PX` for each bucket, and scrolls sideways in a region a keyboard can reach. */
  slots?: boolean;
  /** Said in the middle of the plot, in `--muted`, when every bucket is `null`. The plot has no cursor then: there is nothing to read. */
  empty?: string | null;
  /** The gutter on the right for a line's end labels. A container under 480 px leaves it out. */
  endLabels?: ReactNode;
  /** Where the y labels go: "right" for the candles. */
  yAxis?: "left" | "right";
  /** "chart" is 200 px, 160 under a 480 px container; "pane" (the volume pane) and "panel" (a small multiple) have their own. */
  height?: "chart" | "pane" | "panel";
  /** The hover and keyboard layer, added once the page is hydrated. The plot gives it its own box. */
  cursor?: Omit<CursorProps, "plot">;
  /** The marks. Each bucket's marks carry `data-bucket={i}`, which is how the cursor marks the active ones. */
  children: ReactNode;
}

/**
 * False until the token changes after the first render, then true: the figure mark of `LiveValue` (components.css), for a chart that a
 * beat of the page has redrawn. The server's render and the hydration have the first token, so they never have it.
 */
export function usePlotMark(token: string): boolean {
  const [seen, setSeen] = useState(token);
  const [changed, setChanged] = useState(false);
  // Adjusting state while rendering is React's way to answer a prop that changed, with no frame drawn in between.
  if (seen !== token) {
    setSeen(token);
    setChanged(true);
  }
  return changed;
}

/**
 * The frame of a plotted chart (spec 2.2, 2.5, 2.7 and 2.9), which every form draws its marks in: the gridlines and the y labels, the x
 * labels, the box a screen reader meets as one image, the empty text, the cursor, and the gutters for the y axis and the end labels. The
 * forms bring the marks and the text; this has nothing of a form.
 *
 * Everything is positioned in percent of the plot, so the Worker prints the finished chart and CSS lays it out (charts.css). Both sets of
 * x labels are in the HTML, since the Worker cannot know the width: the card's width picks one. The y gutter is `Nch + 8px` wide for the
 * longest label, so nothing is measured. With `slots` the plot scrolls sideways in a region of its own, with the x labels, and the y
 * labels stay where they are.
 *
 * The marks are in an image box, `aria-hidden` inside it. The cursor is beside that box and never in it: it is the one thing in the plot
 * that a screen reader should find.
 */
export function Plot({
  title,
  summary,
  token,
  scale,
  kind,
  axis,
  placement,
  slots = false,
  empty,
  endLabels,
  yAxis = "left",
  height = "chart",
  cursor,
  children,
}: PlotProps) {
  const plot = useRef<HTMLDivElement>(null);
  const changed = usePlotMark(token);

  // The class stays after the first change and so cannot start the ring again: each later change does it by hand, in the effect that runs
  // for a new token (with that render's `changed`). The first change starts the ring by itself, with the class.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) {
      for (const animation of plot.current?.getAnimations?.() ?? []) {
        animation.cancel();
        animation.play();
      }
    }
    marked.current = changed;
  }, [token]);

  const labels = scale.ticks.map((tick) => tickLabel(tick, kind));
  const chars = Math.max(1, ...labels.map((label) => label.length));
  const count = axis.buckets.length;

  const gutter = (
    <div className={cx("plot__y", yAxis === "right" && "plot__y--right")} style={{ "--chars": chars } as CSSProperties} aria-hidden="true">
      {scale.ticks.map((tick, k) => (
        <span key={tick} style={{ bottom: percent(fractionOf(tick, scale)) }}>
          {labels[k]}
        </span>
      ))}
    </div>
  );

  const xLabels = (width: "wide" | "narrow") => (
    <div className={`plot__x plot__x--${width}`} aria-hidden="true">
      {xLabelPicks(count, width).map((i) => (
        <span key={i} style={{ left: percent(xOf(i, count, placement)) }}>
          {bucketLabel(axis.buckets[i]!, axis.unit, "axis")}
        </span>
      ))}
    </div>
  );

  return (
    <div className={cx("plot__frame", height !== "chart" && `plot__frame--${height}`)}>
      {yAxis === "left" && gutter}
      <div
        className={cx("plot__scroll", slots && "plot__scroll--slots")}
        role={slots ? "region" : undefined}
        tabIndex={slots ? 0 : undefined}
        aria-label={slots ? `${title}, scrollable chart` : undefined}
      >
        <div
          ref={plot}
          className={cx("plot", changed && "is-changed")}
          style={slots ? { minWidth: count * MIN_SLOT_PX } : undefined}
        >
          {scale.ticks.map((tick) => (
            <span key={tick} className={cx("plot__grid", tick === 0 && "is-base")} style={{ bottom: percent(fractionOf(tick, scale)) }} />
          ))}
          <div className="plot__marks" role="img" aria-label={summary}>
            <div className="plot__marks-in" aria-hidden="true">
              {children}
            </div>
          </div>
          {empty && (
            // The summary already says it for a screen reader.
            <p className="plot__empty" aria-hidden="true">
              {empty}
            </p>
          )}
          {cursor && !empty && <Cursor plot={plot} {...cursor} />}
          {xLabels("wide")}
          {xLabels("narrow")}
        </div>
      </div>
      {yAxis === "right" && gutter}
      {endLabels ? (
        <div className="plot__end" style={{ width: END_LABEL_GUTTER_PX }} aria-hidden="true">
          {endLabels}
        </div>
      ) : null}
    </div>
  );
}
