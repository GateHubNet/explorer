import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { cx } from "../cx";
import { createTipSlot, Cursor, TipSlotContext, type CursorProps, type TipSlot } from "./Cursor";
import { END_LABEL_GUTTER_PX, MIN_SLOT_PX, fractionOf, percent, tooltipSide, xLabelPicks, xOf, type Placement, type ValueScale } from "./geometry";
import { bucketLabel, tickLabel } from "./labels";
import type { TimeAxis, ValueKind } from "./types";

// Defined beside the cursor, which is what needs it: Plot imports Cursor, and Cursor importing Plot back would be a cycle.
export { useHydrated } from "./Cursor";

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
  /**
   * `"ends"` has one set, the first and the last bucket, at any width: a small multiple has no room for more. `"none"` has no labels and no
   * room for them under the plot: the upper pane of two that share an axis, whose labels are under the lower one.
   */
  xLabels?: "spread" | "ends" | "none";
  placement: Placement;
  /** Columns: the plot is at least `MIN_SLOT_PX` for each bucket, and scrolls sideways in a region a keyboard can reach. */
  slots?: boolean;
  /** Said in the middle of the plot, in `--muted`, when every bucket is `null`. The plot has no cursor then: there is nothing to read. */
  empty?: string | null;
  /** The gutter on the right for a line's end labels. A container under 480 px leaves it out. */
  endLabels?: ReactNode;
  /** Where the y labels go: "right" for the candles. */
  yAxis?: "left" | "right";
  /** The gutter of the y labels is at least this many characters wide: two plots that are one chart (the candles and their volume) have the same, so that their buckets line up. */
  yChars?: number;
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
 * `usePlotMark`, and the ring itself on `box`: the class `is-changed` that `charts.css` animates, which the token's change puts on (React
 * does, through the `changed` this returns), and each change after the first runs again. The class stays after the first change, and a CSS
 * animation that has finished cannot be started again from script (it is no longer there to ask for), so a later change does it with the
 * class: off, a reflow so that the browser sees it off, and on. The first change starts the ring by itself, with the class. For the plot,
 * and for a form that has none (the share bars): `box` is where the class goes.
 */
export function usePlotRing(token: string, box: RefObject<HTMLElement | null>): boolean {
  const changed = usePlotMark(token);
  const marked = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (marked.current && el) {
      el.classList.remove("is-changed");
      void el.offsetWidth;
      el.classList.add("is-changed");
    }
    marked.current = changed;
  }, [token]);
  return changed;
}

/**
 * The frame of a plotted chart (spec 2.2, 2.5, 2.7 and 2.9), which every form draws its marks in: the gridlines and the y labels, the x
 * labels, the box a screen reader meets as one image, the empty text, the cursor, and the gutters for the y axis and the end labels. The
 * forms bring the marks and the text; this has nothing of a form.
 *
 * Everything is positioned in percent of the plot, so the Worker prints the finished chart and CSS lays it out (charts.css). Both sets of
 * x labels are in the HTML, since the Worker cannot know the width: the card's width picks one (`xLabels="ends"` is the one set that needs
 * no picking). The y gutter is `Nch + 8px` wide for the longest label, so nothing is measured. With `slots` the plot scrolls sideways in
 * a region of its own, with the x labels, and the y labels stay where they are.
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
  xLabels = "spread",
  placement,
  slots = false,
  empty,
  endLabels,
  yAxis = "left",
  yChars = 0,
  height = "chart",
  cursor,
  children,
}: PlotProps) {
  const plot = useRef<HTMLDivElement>(null);
  const changed = usePlotRing(token, plot);

  // Where the cursor's tooltip is drawn: beside the region that scrolls, which would clip it, and not in it.
  const [tips] = useState(createTipSlot);
  const frame = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);

  const labels = scale.ticks.map((tick) => tickLabel(tick, kind));
  const chars = Math.max(1, yChars, ...labels.map((label) => label.length));
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

  const labelsOf = (width: "wide" | "narrow" | "ends") => (
    <div className={`plot__x plot__x--${width}`} aria-hidden="true">
      {xLabelPicks(count, width).map((i) => (
        <span key={i} style={{ left: percent(xOf(i, count, placement)) }}>
          {bucketLabel(axis.buckets[i]!, axis.unit, "axis")}
        </span>
      ))}
    </div>
  );

  return (
    <div ref={frame} className={cx("plot__frame", height !== "chart" && `plot__frame--${height}`, xLabels === "none" && "plot__frame--bare")}>
      {yAxis === "left" && gutter}
      <div
        ref={region}
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
          {cursor && !empty && (
            <TipSlotContext value={tips}>
              <Cursor plot={plot} {...cursor} />
            </TipSlotContext>
          )}
          {xLabels === "none" ? null : xLabels === "ends" ? (
            labelsOf("ends")
          ) : (
            <>
              {labelsOf("wide")}
              {labelsOf("narrow")}
            </>
          )}
        </div>
      </div>
      {yAxis === "right" && gutter}
      {cursor && !empty && <PlotTip slot={tips} frame={frame} region={region} plot={plot} count={cursor.count} placement={cursor.placement} />}
      {endLabels ? (
        <div className="plot__end" style={{ width: END_LABEL_GUTTER_PX }} aria-hidden="true">
          {endLabels}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The cursor's tooltip, drawn in the frame and not in the plot: the region of a plot that scrolls clips what is in it, and a tooltip must
 * not be cut at its edge or at the bottom of a short plot. It is placed from the boxes of the page (`getBoundingClientRect`) when it is
 * shown, and again when the region scrolls under one that a touch kept: its anchor is the bucket's x in the frame, the class gives the
 * side (spec 2.6: right under 22%, left over 78%, else centred, of the part of the plot in view) and a shift keeps it inside the region's box.
 *
 * Only this is rendered when the tooltip changes (the cursor hands it over through the slot), so a pointer move does not render the marks.
 */
function PlotTip({
  slot,
  frame,
  region,
  plot,
  count,
  placement,
}: {
  slot: TipSlot;
  frame: RefObject<HTMLDivElement | null>;
  region: RefObject<HTMLDivElement | null>;
  plot: RefObject<HTMLDivElement | null>;
  count: number;
  placement: Placement;
}) {
  const tip = useSyncExternalStore(slot.subscribe, slot.get, () => null);
  const bubble = useRef<HTMLDivElement>(null);
  const bucket = tip?.bucket ?? null;

  const place = () => {
    const el = bubble.current;
    const inFrame = frame.current?.getBoundingClientRect();
    const view = region.current?.getBoundingClientRect();
    const whole = plot.current?.getBoundingClientRect();
    if (!el || bucket === null || !inFrame || !view || !whole) return;
    // The part of the plot in view: all of it, for a plot that does not scroll.
    const from = Math.max(whole.left, view.left);
    const to = Math.min(whole.right, view.right);
    const x = whole.left + xOf(bucket, count, placement) * whole.width;
    const side = tooltipSide(to > from ? Math.min(1, Math.max(0, (x - from) / (to - from))) : xOf(bucket, count, placement));
    const width = el.offsetWidth;
    const natural = side === "right" ? x + 8 : side === "left" ? x - 8 - width : x - width / 2;
    // Inside the box in view, and at its left edge when the tooltip is wider than that.
    const inside = Math.max(from, Math.min(natural, to - width));
    el.classList.remove("right", "left", "center");
    el.classList.add(side);
    el.style.left = `${x - inFrame.left}px`;
    el.style.marginLeft = `${inside - natural}px`;
  };

  // After every render: the content may be another width.
  useLayoutEffect(place);
  // The region scrolling moves the bucket from under a tooltip that a touch has kept.
  useEffect(() => {
    const scroller = region.current;
    if (!scroller || bucket === null) return;
    scroller.addEventListener("scroll", place, { passive: true });
    return () => scroller.removeEventListener("scroll", place);
  }, [bucket, count, placement]);

  return tip && (
    <div ref={bubble} className="plot__tip" aria-hidden="true">
      {tip.node}
    </div>
  );
}
