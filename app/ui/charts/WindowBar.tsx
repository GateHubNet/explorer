import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

import { cx } from "../cx";
import { cellOf } from "./cells";
import { percent, tooltipSide } from "./geometry";
import { Legend } from "./Legend";
import { usePlotRing } from "./ring";
import type { WindowBarData, WindowBarSegment } from "./types";

type Segment = WindowBarSegment;

/** The name of the bar for a screen reader: the Escrow board's. */
const GROUP_LABEL = "When the escrow can be finished or cancelled";
/** An open-ended window runs on past the last point of the bar for this share of the span before it (the board's 22%): "from CancelAfter, with no end" has a length to draw. */
const OPEN_END = 0.22;

/** A moment as seconds, or `null` for an open end (and for text that is no moment). */
const secondsOf = (text: string | null): number | null => cellOf(text)?.value ?? null;

/**
 * The span the bar draws, in unix seconds: from the earliest of the bounds, the windows' ends and the mark to the latest of them, and past it by the
 * room an open end needs. It is the builder's numbers and nothing else: a page as of a moment before the first bound starts the bar there, and one as of
 * a moment past the last ends it there. A bar of a single moment has a span of 1 s, so that nothing divides by 0.
 */
function spanOf(data: WindowBarData): { start: number; end: number } {
  const moments = [data.mark.at, ...data.bounds.map((bound) => bound.at), ...data.segments.flatMap((segment) => [segment.from, segment.to])]
    .map(secondsOf)
    .filter((moment): moment is number => moment !== null);
  if (moments.length === 0) return { start: 0, end: 1 };
  const [start, last] = [Math.min(...moments), Math.max(...moments)];
  const open = data.segments.some((segment) => secondsOf(segment.to) === null);
  const room = open ? (last > start ? (last - start) * OPEN_END : 1) : 0;
  return { start, end: last + room > start ? last + room : start + 1 };
}

/**
 * One box of the bar's row: a window, or the stretch between two that has none. They follow each other and cover the bar, so that a flex row can lay them out
 * (below), and a moment is in exactly one of them.
 */
interface Part {
  /** `null` for a stretch no window covers (a page as of a moment before the first one). */
  segment: Segment | null;
  from: number;
  to: number;
}

/**
 * The windows in the order of their starts, cut where one runs into the next, with a part for each stretch between them. An open end is the bar's. A window with
 * no span (its start at its end, or its end before its start) is a part of 0 share, which CSS gives its target's width: a stub with a button, since the bar draws what it
 * is given. The builder leaves an empty window out (no Pending for an unknown creation that the page is as of FinishAfter, no Can be finished between two equal
 * bounds), as it does a window the escrow does not have.
 */
function partsOf(segments: readonly Segment[], start: number, end: number): Part[] {
  const clamp = (moment: number) => Math.min(end, Math.max(start, moment));
  const windows = segments
    .map((segment) => {
      const from = clamp(secondsOf(segment.from) ?? start);
      return { segment, from, to: Math.max(from, clamp(secondsOf(segment.to) ?? end)) };
    })
    .sort((a, b) => a.from - b.from);
  const parts: Part[] = [];
  let reached = start;
  for (const window of windows) {
    if (window.from > reached) parts.push({ segment: null, from: reached, to: window.from });
    const from = Math.max(window.from, reached);
    parts.push({ segment: window.segment, from, to: Math.max(from, window.to) });
    reached = Math.max(reached, window.to);
  }
  if (reached < end) parts.push({ segment: null, from: reached, to: end });
  return parts;
}

/** The part a moment is in (the later one, at the line between two; the last at the bar's end) and how far along it, from 0 to 1. */
function anchorOf(parts: readonly Part[], moment: number): { part: number; along: number } {
  const found = parts.findIndex(({ from, to }) => moment >= from && moment < to);
  const part = found < 0 ? parts.length - 1 : found;
  const { from, to } = parts[part]!;
  return { part, along: to > from ? Math.min(1, Math.max(0, (moment - from) / (to - from))) : moment >= to ? 1 : 0 };
}

/**
 * The tooltip is up to 340 px wide, not the kit's 260, so it opens to the right under 30% of the bar and to the left over 70% (`tooltipSide`'s edge; the kit's is
 * 22%). Centred between, on a bar of 480 px, the least that has this rule, it sticks out past an end by about 14 to 26 px (a tooltip of 312 to 340 px at 30% or 70%
 * of 480), which the card's padding takes. Under 480 px of bar CSS centres it on the bar.
 */
const TIP_EDGE = 0.3;

/** A character of the bounds' labels (11 px Geist, figures and letters: 5.2 to 5.5 measured) and of the mark's (11.5 px, 600), in px. */
const CHAR_PX = { tick: 5.6, mark: 6.2 } as const;
/** Two labels in a row keep this much between them, and a label may stick out past an end of the bar by this much (the card's padding holds it). */
const LABEL_GAP_PX = 8;
const SLACK_PX = 14;
/** The widths of the bar the labels are worked out for: the narrowest it is at 480 px of card and over (charts.css has the query), and a phone's. */
const WIDTH_PX = { wide: 480, narrow: 280 } as const;
/** How far left a label is moved from its time, as a share of its own width: its start is at the time, its middle, or its end. */
const SHIFT = ["0%", "-50%", "-100%"] as const;

interface Placed {
  /** An index of `SHIFT`. */
  shift: 0 | 1 | 2;
  row: number;
}

/**
 * Where each label goes on a bar `width` px wide, with its text set as `CHAR_PX` says: centred on its time, unless that would put it out past an end of the bar
 * (it then starts at the time near the start and ends at it near the end), in the first row where it does not meet a label that is there. Bounds a few hours
 * apart on a bar of a year would otherwise be written over each other. Nothing is measured, so the Worker can print the places: the page's CSS says which set
 * is drawn, by the width of the bar (`--shift`, `--row`, and their `-narrow`). A window narrower than the bar's target (`--target`) is stretched (below), and the
 * times move with it: these places are those of a bar with true widths, which is near enough for where words go.
 */
function placeLabels(labels: readonly { place: number; chars: number }[], charPx: number, width: number): Placed[] {
  const rows: [number, number][][] = [];
  return labels.map(({ place, chars }) => {
    const [x, size] = [place * width, chars * charPx];
    const shift = x < size / 2 - SLACK_PX ? 0 : x > width - size / 2 + SLACK_PX ? 2 : 1;
    const reach: [number, number] = [x - (shift * size) / 2, x - (shift * size) / 2 + size];
    let row = rows.findIndex((taken) => taken.every(([from, to]) => reach[1] + LABEL_GAP_PX <= from || reach[0] >= to + LABEL_GAP_PX));
    if (row < 0) row = rows.push([]) - 1;
    rows[row]!.push(reach);
    return { shift, row };
  });
}

/**
 * The windows of an escrow on one bar (ledger object pages spec 4.2): a segment as wide as its span, in the colour of its slot, with the bounds as
 * labels under their times and a line over the bar at the moment the page shows. The numbers are the builder's (unix seconds as text) and so is every
 * text: the labels, the ranges and lengths of the tooltips, and the mark's words. A window that is open at its start runs from the start of the bar,
 * and one that is open at its end to the end of it, which is `OPEN_END` of the span past the last point so that it has a length to see. A window the
 * escrow does not have is not in the data and is not drawn; a bar without windows draws nothing.
 *
 * The bar is a row of boxes, one for each window and one for each stretch that no window covers, each as wide as its span (`flex` in percent). A window is
 * a button as high as its target and at least as wide (`--target`: 24 px, WCAG 2.5.8, and 44 px, spec 8, on a touch screen or a phone): a window of an hour on a bar of three days would be 10 px, so the browser, which lays the
 * row out, gives it its target's width and the others give way, in proportion, and the times that are in a window (its bounds, the mark) are placed in it, as far
 * along as they are in its span, so that a label is where its window changes whatever the widths come to. A button is named by its label and range, and
 * a keyboard reaches each with Tab. Focus, the pointer and a tap show the kit's tooltip (`plot__tip`: the window's name, its range and its length) over
 * it, and the others are dimmed while it shows (the kit's cursor, as the share bars have it). Escape, from anywhere in the page, puts the tooltip away until the
 * next focus (WCAG 1.4.13), and so does a tap outside the bar. The bounds are picture only: the buttons say the ranges, and the Details list has every time.
 * The mark's label is repeated in a line for a screen reader. There is no table view; nothing in the bar is a number the Details list does not say.
 *
 * Nothing is measured, so the Worker prints the finished bar: where the labels go (`placeLabels`) is worked out for two widths and the bar's own width,
 * which CSS asks, picks one. Memoised on the data's `token` (spec 2.9): a beat that brings the same token renders nothing, and a new one rings the bar (`usePlotRing`, as
 * the share bars and the bar list do).
 */
export const WindowBar = memo(
  function WindowBar({ data }: { data: WindowBarData }) {
    const [active, setActive] = useState<Segment["id"] | null>(null);
    const root = useRef<HTMLDivElement>(null);
    // The ring of a changed figure, when a beat brings a new token (spec 2.9), as the other forms have it.
    const ring = usePlotRing(data.token, root);

    // While a tooltip shows: a touch that lands outside the bar puts it away (a tap that did not focus the button, Safari's, has no blur to do it), and so does Escape
    // from anywhere in the page (WCAG 1.4.13): a tooltip that the pointer opened has no focus for a key to come from.
    const shown = active !== null;
    useEffect(() => {
      if (!shown) return;
      const away = (event: Event) => {
        if (event.target instanceof Node && root.current?.contains(event.target)) return;
        setActive(null);
      };
      const escape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setActive(null);
      };
      document.addEventListener("pointerdown", away, true);
      document.addEventListener("keydown", escape);
      return () => {
        document.removeEventListener("pointerdown", away, true);
        document.removeEventListener("keydown", escape);
      };
    }, [shown]);

    if (data.segments.length === 0) return null;

    const { start, end } = spanOf(data);
    const parts = partsOf(data.segments, start, end);
    /** Where a moment is on a bar of true widths, from 0 to 1: for the places of the words. */
    const at = (moment: number): number => Math.min(1, Math.max(0, (moment - start) / (end - start)));

    // What is in each part: the mark and the bounds that are in its span, and how far along it.
    const [markAt, ...tickAts] = [data.mark.at, ...data.bounds.map((bound) => bound.at)].map((text) => secondsOf(text) ?? start);
    const mark = { ...anchorOf(parts, markAt!), place: at(markAt!), chars: data.mark.label.length };
    const ticks = data.bounds.map((bound, i) => ({ bound, ...anchorOf(parts, tickAts[i]!), place: at(tickAts[i]!), chars: bound.label.length }));

    const [markWide, markNarrow] = [placeLabels([mark], CHAR_PX.mark, WIDTH_PX.wide)[0]!, placeLabels([mark], CHAR_PX.mark, WIDTH_PX.narrow)[0]!];
    const [wide, narrow] = [placeLabels(ticks, CHAR_PX.tick, WIDTH_PX.wide), placeLabels(ticks, CHAR_PX.tick, WIDTH_PX.narrow)];
    const rows = (all: readonly Placed[]) => Math.max(1, ...all.map(({ row }) => row + 1));
    const current = parts.findIndex(({ segment }) => segment !== null && segment.id === active);
    // The window whose tooltip shows, and where its middle is on a bar of true widths.
    const open = current < 0 ? null : { segment: parts[current]!.segment!, middle: (at(parts[current]!.from) + at(parts[current]!.to)) / 2 };

    return (
      <div ref={root} className={cx("wbar", ring && "is-changed")} role="group" aria-label={GROUP_LABEL} data-active={current < 0 ? undefined : active!}>
        <Legend items={data.segments.map(({ id, label, slot }) => ({ id, label, key: "swatch", slot }))} />
        <div className="wbar__plot">
          <div className="wbar__track">
            {parts.map(({ segment, from, to }, p) => {
              const share = Number(((at(to) - at(from)) * 100).toFixed(3));
              return (
                <div key={segment?.id ?? `gap-${p}`} className={cx("wbar__part", segment && "wbar__part--window")} style={{ flex: `${share} 1 ${share}%` }}>
                  {segment && (
                    <button
                      type="button"
                      className={cx("wbar__seg", current === p && "is-active")}
                      data-slot={segment.slot}
                      aria-label={`${segment.label}: ${segment.range}`}
                      onPointerEnter={(event) => {
                        if (event.pointerType !== "touch") setActive(segment.id);
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType !== "touch") setActive(null);
                      }}
                      onClick={() => setActive(segment.id)}
                      onFocus={() => setActive(segment.id)}
                      onBlur={() => setActive(null)}
                    />
                  )}
                  {mark.part === p && (
                    <>
                      <span className="wbar__mark" style={{ left: percent(mark.along, 3) }} aria-hidden="true" />
                      <span
                        className="wbar__mark-label"
                        style={{ left: percent(mark.along, 3), "--shift": SHIFT[markWide.shift], "--shift-narrow": SHIFT[markNarrow.shift] } as CSSProperties}
                        aria-hidden="true"
                      >
                        {data.mark.label}
                      </span>
                    </>
                  )}
                  {ticks.map(
                    ({ bound, part, along }, i) =>
                      part === p && (
                        <span
                          key={bound.id}
                          className="wbar__tick"
                          style={
                            {
                              left: percent(along, 3),
                              "--shift": SHIFT[wide[i]!.shift],
                              "--row": wide[i]!.row,
                              "--shift-narrow": SHIFT[narrow[i]!.shift],
                              "--row-narrow": narrow[i]!.row,
                            } as CSSProperties
                          }
                          aria-hidden="true"
                        >
                          {bound.label}
                        </span>
                      ),
                  )}
                </div>
              );
            })}
          </div>
          <div className="wbar__ticks" style={{ "--rows": rows(wide), "--rows-narrow": rows(narrow) } as CSSProperties} />
          {open && (
            <div
              className={cx("plot__tip", "wbar__tip", tooltipSide(open.middle, TIP_EDGE))}
              style={{ "--tip-left": percent(open.middle, 3) } as CSSProperties}
              aria-hidden="true"
            >
              <span className="plot__tip-row">
                <span className="plot__tip-key" data-slot={open.segment.slot} />
                <b>{open.segment.label}</b>
              </span>
              <span className="plot__tip-name">{open.segment.range}</span>
              {open.segment.length !== "" && <span className="plot__tip-date">{open.segment.length}</span>}
            </div>
          )}
        </div>
        <span className="sr">{data.mark.label}</span>
      </div>
    );
  },
  (before, after) => before.data.token === after.data.token,
);
