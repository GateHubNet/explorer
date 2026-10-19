import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cx } from "../cx";
import { bucketAt, tooltipSide, xOf, type Placement } from "./geometry";
import type { Slot } from "./types";

const noSubscription = () => () => {};

/**
 * False in the Worker's HTML and during hydration, true from the render after: a thing that only a script can do is left out of both, so
 * that they match (the same rule as `LiveToggle`). `Plot.tsx` exports it for the forms; it lives here because the cursor is what needs it.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

/** `51.72%`: at most 2 decimals, and no trailing zeros. */
const percent = (fraction: number): string => `${Math.round(fraction * 10000) / 100}%`;

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
  const layer = useRef<HTMLDivElement>(null);
  // Where this cursor's own input put it, and whether that shows. Hidden, it stays where it was, so the slider has a value to say.
  const [at, setAt] = useState(count - 1);
  const [open, setOpen] = useState(false);
  // A touch put it there: it stays until a touch lands elsewhere, since a finger that lifts is not a pointer that leaves.
  const [pinned, setPinned] = useState(false);

  const last = count - 1;
  const index = Math.min(at, last);
  // In a group the bucket is the group's, whichever plot it came from; the tooltip is only for the plot that is being used.
  const shown = group ? group.active : open ? index : null;
  const bucket = shown !== null && shown >= 0 && shown <= last ? shown : null;
  const tipped = open && bucket === index;

  const select = (i: number) => {
    setAt(i);
    setOpen(true);
    setGroup?.(i);
  };
  // A cursor that is not showing owns nothing in the group, and leaves what another plot is showing alone.
  const hide = () => {
    setPinned(false);
    if (!open) return;
    setOpen(false);
    setGroup?.(null);
  };

  const bucketAtPointer = (event: PointerEvent): number | null => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || !(box.width > 0)) return null;
    return bucketAt((event.clientX - box.left) / box.width, count, placement);
  };
  const selectAtPointer = (event: PointerEvent) => {
    const i = bucketAtPointer(event);
    if (i !== null) select(i);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // The browser's own shortcuts (Alt+Left is Back) are not the cursor's.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = index - 1;
        break;
      case "ArrowRight":
        next = index + 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Escape":
        hide();
        return;
      default:
        return;
    }
    event.preventDefault();
    select(Math.min(last, Math.max(0, next)));
  };

  // A touch outside the plot hides what a touch kept. In the capture phase, so that it runs before the touched plot's own handler: a
  // plot of the same group that is touched next sets the bucket after this one has cleared it.
  useEffect(() => {
    if (!pinned) return;
    const away = (event: Event) => {
      if (event.target instanceof Node && layer.current?.contains(event.target)) return;
      setPinned(false);
      setOpen(false);
      setGroup?.(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [pinned, setGroup]);

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
        if (event.pointerType === "touch") setPinned(true);
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
      {bucket !== null && tipped && tooltip && (
        <div className={cx("plot__tip", tooltipSide(xOf(bucket, count, placement)))} style={{ left }} aria-hidden="true">
          {tooltip(bucket)}
        </div>
      )}
    </div>
  );
}
