import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cx } from "../cx";
import { useHydrated } from "../use-hydrated";
import { bucketAt, percent, tooltipSide, xOf, type Placement } from "./geometry";
import type { Slot } from "./types";

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
  /** A plot of many buckets: Page Up moves this many towards the newest and Page Down towards the oldest, stopping at the ends. Without it the page keys are the browser's. */
  pageStep?: number;
}

/** What a cursor has to show as its tooltip: the bucket, and the content `tooltip(bucket)` gave. */
export interface Tip {
  bucket: number;
  node: ReactNode;
}

/**
 * A place outside the cursor to draw its tooltip in. A plot whose region scrolls clips whatever is inside it, the tooltip with it, so the
 * plot (Plot.tsx) draws the tooltip beside the region and the cursor hands it over here. A cursor with none draws it in the plot, as the
 * mock does.
 */
export interface TipSlot {
  show(tip: Tip | null): void;
  get(): Tip | null;
  subscribe(listener: () => void): () => void;
}

export function createTipSlot(): TipSlot {
  let tip: Tip | null = null;
  const listeners = new Set<() => void>();
  return {
    show(next) {
      if (next === null && tip === null) return;
      tip = next;
      for (const listener of listeners) listener();
    },
    get: () => tip,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const TipSlotContext = createContext<TipSlot | null>(null);

interface Group {
  active: number | null;
  set(i: number | null): void;
}

const HoverContext = createContext<Group | null>(null);

/**
 * The plots in it share the bucket the visitor is on: small multiples, and candles over volume. Each draws its own crosshair and dots, and
 * the one with the pointer or focus shows the tooltip.
 */
export function HoverGroup({ children }: { children: ReactNode }) {
  const [active, set] = useState<number | null>(null);
  const group = useMemo(() => ({ active, set }), [active]);
  return <HoverContext value={group}>{children}</HoverContext>;
}

/** The group a plot is in: the bucket it is on, and how to move it. `null` for a plot of its own. */
export function useHoverGroup(): Group | null {
  return useContext(HoverContext);
}

/** What `steppedKey` reads of a key press: React's `KeyboardEvent` has it, and so has a plain object. */
interface KeyPress {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** The buckets a page key moves, from a cursor's `pageStep`: its whole part when that is 1 or more, else 0 (no page keys). */
const pageOf = (pageStep: number | undefined): number => (pageStep !== undefined && pageStep >= 1 ? Math.floor(pageStep) : 0);

/**
 * The keys of a cursor (spec 2.6), for every form that has one: the bucket (or segment) a key moves to from `index`, among `last + 1`, as
 * the arrow keys, Home and End say it and stopping at the ends; with a `pageStep` (a whole number of buckets, 1 or more) Page Up moves that many
 * towards the newest (the last) and Page Down towards the oldest, and stops at the ends too; `"hide"` for Escape; `null` for a key that is not
 * the cursor's, and for the browser's own shortcuts (Alt+Left is Back). Pure: the caller prevents the default and selects, or hides.
 */
export function steppedKey(event: KeyPress, index: number, last: number, pageStep?: number): number | "hide" | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const page = pageOf(pageStep);
  switch (event.key) {
    case "ArrowLeft":
      return Math.min(last, Math.max(0, index - 1));
    case "ArrowRight":
      return Math.min(last, Math.max(0, index + 1));
    case "Home":
      return 0;
    case "End":
      return Math.max(0, last);
    case "PageUp":
      return page > 0 ? Math.min(last, Math.max(0, index + page)) : null;
    case "PageDown":
      return page > 0 ? Math.min(last, Math.max(0, index - page)) : null;
    case "Escape":
      return "hide";
    default:
      return null;
  }
}

/**
 * What every cursor keeps (spec 2.6), so that the forms do not each keep it: where its own input put it (`index`, among `last + 1`) and
 * whether that shows (`open`); hidden, it stays where it was, so that a slider has a value to say. `select` puts it somewhere and shows
 * it, `hide` stops showing it, and `onKeyDown` is `steppedKey` acted on. `pin` is for a touch: it keeps what was selected until a touch
 * lands outside `inside` (a finger that lifts is not a pointer that leaves), which is caught in the capture phase so that it runs before
 * the touched cursor's own handler: a plot of the same group that is touched next sets the bucket after this one has cleared it.
 *
 * `setGroup` is the group's (`useHoverGroup().set`): a selection is told to it, and a cursor that is not showing owns nothing in the
 * group and leaves what another plot is showing alone. `pageStep` is the cursor's (`steppedKey`).
 */
export function useCursorState({
  initial,
  last,
  inside,
  setGroup,
  pageStep,
}: {
  initial: number;
  last: number;
  inside: RefObject<Element | null>;
  setGroup?: (i: number | null) => void;
  pageStep?: number;
}) {
  const [at, setAt] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const index = Math.min(at, Math.max(last, 0));

  const select = (i: number) => {
    setAt(i);
    setOpen(true);
    setGroup?.(i);
  };
  const hide = () => {
    setPinned(false);
    if (!open) return;
    setOpen(false);
    setGroup?.(null);
  };

  useEffect(() => {
    if (!pinned) return;
    const away = (event: Event) => {
      if (event.target instanceof Node && inside.current?.contains(event.target)) return;
      setPinned(false);
      setOpen(false);
      setGroup?.(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [pinned, setGroup]);

  const onKeyDown = (event: KeyboardEvent) => {
    const next = steppedKey(event, index, last, pageStep);
    if (next === null) return;
    if (next === "hide") {
      hide();
      return;
    }
    event.preventDefault();
    select(next);
  };

  return { index, open, select, hide, pin: () => setPinned(true), onKeyDown };
}

/**
 * The hover and keyboard layer over a plot (spec 2.6): a transparent `role="slider"` as big as the plot, which is not in the Worker's HTML
 * and comes with the script (`useHydrated`). A pointer selects the nearest bucket; a touch selects and keeps the tooltip until a touch
 * lands elsewhere; focus selects the newest bucket, and the arrow keys, Home and End move it (and Page Up and Page Down, by `pageStep`, when the
 * plot has one: the slider names them in `aria-keyshortcuts`); blur and Escape hide it. The slider says the
 * bucket in words (`aria-valuetext`), so that the tooltip, which is `aria-hidden`, need not be read.
 *
 * What it marks in the plot it marks in the DOM (`data-active`, `is-active`), so that a pointer move renders this layer and not the marks.
 */
export function Cursor(props: CursorProps) {
  const hydrated = useHydrated();
  return hydrated && props.count > 0 ? <CursorLayer {...props} /> : null;
}

function CursorLayer({ plot, count, placement, label, valueText, tooltip, crosshair, dots, onChange, pageStep }: CursorProps) {
  const group = useHoverGroup();
  const setGroup = group?.set;
  const slot = useContext(TipSlotContext);
  const layer = useRef<HTMLDivElement>(null);

  // Where this cursor's own input put it, whether that shows, the keys, and what a touch keeps: the protocol of every cursor.
  const last = count - 1;
  const { index, open, select, hide, pin, onKeyDown } = useCursorState({ initial: last, last, inside: layer, setGroup, pageStep });
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
      aria-keyshortcuts={pageOf(pageStep) > 0 ? "PageUp PageDown" : undefined}
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
