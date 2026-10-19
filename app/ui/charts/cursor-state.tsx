import { createContext, useContext, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

// What every cursor shares (spec 2.6): the keys, the state of a cursor, and the group of plots that share a bucket. The cursor (Cursor.tsx), the
// share bars and the groups of plots (small multiples, candles over volume) import it; a plot does not, so that a page with plots alone loads none
// of it until the cursor does (cursor-slot-state.tsx has what a plot needs).

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

/**
 * The keys of a cursor (spec 2.6), for every form that has one: the bucket (or segment) a key moves to from `index`, among `last + 1`, as
 * the arrow keys, Home and End say it and stopping at the ends; `"hide"` for Escape; `null` for a key that is not the cursor's, and for the
 * browser's own shortcuts (Alt+Left is Back). Pure: the caller prevents the default and selects, or hides.
 */
export function steppedKey(event: KeyPress, index: number, last: number): number | "hide" | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case "ArrowLeft":
      return Math.min(last, Math.max(0, index - 1));
    case "ArrowRight":
      return Math.min(last, Math.max(0, index + 1));
    case "Home":
      return 0;
    case "End":
      return Math.max(0, last);
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
 * group and leaves what another plot is showing alone.
 */
export function useCursorState({
  initial,
  last,
  inside,
  setGroup,
}: {
  initial: number;
  last: number;
  inside: RefObject<Element | null>;
  setGroup?: (i: number | null) => void;
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
    const next = steppedKey(event, index, last);
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
