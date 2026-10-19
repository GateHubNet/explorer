import { useContext, useEffect, useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from "react";

import { cx } from "../cx";
import { setTipView, TipSlotContext, useHydrated, type TipViewProps } from "./cursor-slot-state";
import { useCursorState, useHoverGroup } from "./cursor-state";
import { bucketAt, percent, tooltipSide, xOf, type Placement } from "./placement";
import type { Slot } from "./types";

// The hover and keyboard layer itself, with the tooltip's code (`PlotTip`). It is loaded with `import()` when the first pointer or focus reaches a
// plot (`CursorSlot.tsx`, spec 2.1), so nothing that is in a page's first JavaScript imports this file: what it shares with the files that are is in
// `cursor-slot-state.tsx` (what a plot needs of it) and `cursor-state.tsx` (what the cursors share), and the geometry it needs is `placement.ts`.

export interface CursorProps {
  /** The plot's box, which the cursor measures, and marks: it gets `data-active="{i}"`, and its `[data-bucket="{i}"]` marks get `is-active`. */
  plot: RefObject<HTMLElement | null>;
  count: number;
  placement: Placement;
  /** The slider's name: "{title}, day by day". */
  label: string;
  /** What the slider says of bucket `i` (`aria-valuetext`). */
  valueText: (i: number) => string;
  /** The tooltip's content for bucket `i`: React text nodes only. The tooltip is `aria-hidden`, since the slider carries the text. */
  tooltip?: (i: number) => ReactNode;
  /** A 1 px line over the bucket. */
  crosshair?: boolean;
  /** A dot for each series at the bucket: `y` is a fraction of the plot's height from the bottom. */
  dots?: (i: number) => readonly { y: number; slot: Slot }[];
  /** Told the bucket this plot shows, or `null`: for the readouts (a panel's header, the candle readout) that follow the cursor. */
  onChange?: (i: number | null) => void;
}

/**
 * The hover and keyboard layer over a plot (spec 2.6): a transparent `role="slider"` as big as the plot, which is not in the Worker's HTML
 * and comes with the script (`useHydrated`). A pointer selects the nearest bucket; a touch selects and keeps the tooltip until a touch
 * lands elsewhere; focus selects the newest bucket, and the arrow keys, Home and End move it; blur and Escape hide it. The slider says the
 * bucket in words (`aria-valuetext`), so that the tooltip, which is `aria-hidden`, need not be read.
 *
 * What it marks in the plot it marks in the DOM (`data-active`, `is-active`), so that a pointer move renders this layer and not the marks.
 */
export function Cursor(props: CursorProps) {
  const hydrated = useHydrated();
  return hydrated && props.count > 0 ? <CursorLayer {...props} /> : null;
}

function CursorLayer({ plot, count, placement, label, valueText, tooltip, crosshair, dots, onChange }: CursorProps) {
  const group = useHoverGroup();
  const setGroup = group?.set;
  const slot = useContext(TipSlotContext);
  const layer = useRef<HTMLDivElement>(null);

  // Where this cursor's own input put it, whether that shows, the keys, and what a touch keeps: the protocol of every cursor.
  const last = count - 1;
  const { index, open, select, hide, pin, onKeyDown } = useCursorState({ initial: last, last, inside: layer, setGroup });
  // In a group the bucket is the group's, whichever plot it came from; the tooltip is only for the plot that is being used.
  const shown = group ? group.active : open ? index : null;
  const bucket = shown !== null && shown >= 0 && shown <= last ? shown : null;
  const tipped = open && bucket === index;

  const bucketAtPointer = (event: PointerEvent): number | null => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || !(box.width > 0)) return null;
    return bucketAt((event.clientX - box.left) / box.width, count, placement);
  };
  const selectAtPointer = (event: PointerEvent) => {
    const i = bucketAtPointer(event);
    if (i !== null) select(i);
  };

  // The mark in the plot. Every render, since a beat may have made new marks for the bucket.
  useLayoutEffect(() => {
    const box = plot.current;
    if (!box || bucket === null) return;
    box.setAttribute("data-active", String(bucket));
    const marks = Array.from(box.querySelectorAll(`[data-bucket="${bucket}"]`));
    for (const mark of marks) mark.classList.add("is-active");
    return () => {
      box.removeAttribute("data-active");
      for (const mark of marks) mark.classList.remove("is-active");
    };
  });

  // The tooltip, where the plot has a place for it: told every render (it may have new content), and taken back when the cursor goes.
  const tip = tipped && bucket !== null && tooltip ? { bucket, node: tooltip(bucket) } : null;
  useLayoutEffect(() => {
    slot?.show(tip);
  });
  useLayoutEffect(() => () => slot?.show(null), [slot]);

  // The readouts: told when the bucket changes, with the callback it has now.
  const current = useRef(onChange);
  const told = useRef<number | null>(null);
  useEffect(() => {
    current.current = onChange;
  });
  useEffect(() => {
    if (told.current === bucket) return;
    told.current = bucket;
    current.current?.(bucket);
  }, [bucket]);

  const left = bucket === null ? undefined : percent(xOf(bucket, count, placement));

  return (
    <div
      ref={layer}
      className="plot__cursor"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index}
      aria-valuetext={valueText(index)}
      onPointerDown={(event) => {
        selectAtPointer(event);
        if (event.pointerType === "touch") pin();
      }}
      onPointerMove={selectAtPointer}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") hide();
      }}
      // A click focuses it after the pointer has chosen a bucket, and a tap focuses it after the finger is up: both leave the choice alone.
      onFocus={() => {
        if (!open) select(last);
      }}
      onBlur={hide}
      onKeyDown={onKeyDown}
    >
      {bucket !== null && crosshair && <span className="plot__crosshair" style={{ left }} />}
      {bucket !== null &&
        dots?.(bucket).map((dot, k) => <span key={k} className="plot__dot" data-slot={dot.slot} style={{ left, bottom: percent(dot.y) }} />)}
      {!slot && tip && (
        <div className={cx("plot__tip", tooltipSide(xOf(tip.bucket, count, placement)))} style={{ left }} aria-hidden="true">
          {tip.node}
        </div>
      )}
    </div>
  );
}

/**
 * The cursor's tooltip, drawn in the frame and not in the plot: the region of a plot that scrolls clips what is in it, and a tooltip must
 * not be cut at its edge or at the bottom of a short plot. It is placed from the boxes of the page (`getBoundingClientRect`) when it is
 * shown, and again when the region scrolls under one that a touch kept: its anchor is the bucket's x in the frame, the class gives the
 * side (spec 2.6: right under 22%, left over 78%, else centred, of the part of the plot in view) and a shift keeps it inside the region's box.
 *
 * Only this is rendered when the tooltip changes (the cursor hands it over through the slot, and the plot's `TipHost` draws it), so a pointer
 * move does not render the marks. It is part of the cursor's file, loaded with it (spec 2.1: "Cursor.tsx and the tooltip"), and the plot has
 * it from the moment the cursor does (`setTipView`, below).
 */
function PlotTip({ tip, frame, region, plot, count, placement }: TipViewProps) {
  const bubble = useRef<HTMLDivElement>(null);
  const bucket = tip.bucket;

  const place = () => {
    const el = bubble.current;
    const inFrame = frame.current?.getBoundingClientRect();
    const view = region.current?.getBoundingClientRect();
    const whole = plot.current?.getBoundingClientRect();
    if (!el || !inFrame || !view || !whole) return;
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
    if (!scroller) return;
    scroller.addEventListener("scroll", place, { passive: true });
    return () => scroller.removeEventListener("scroll", place);
  }, [bucket, count, placement]);

  return (
    <div ref={bubble} className="plot__tip" aria-hidden="true">
      {tip.node}
    </div>
  );
}

setTipView(PlotTip);
