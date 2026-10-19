import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { ENTER_MS, FLIP_EASING, FLIP_MS, prefersReducedMotion } from "./motion";

const NONE: ReadonlySet<string> = new Set();

/** Where a row is, from the top left of its container. */
interface Place {
  left: number;
  top: number;
}

/**
 * Where each keyed child of `table` is, from the top left of the table, with nothing in flight: a child still sliding is measured where it will
 * stop. (The rows of a table only ever move on y; the chips of the network page move on x.)
 */
function measure(table: HTMLElement): { rows: Map<string, HTMLElement>; places: Map<string, Place> } {
  const rows = new Map<string, HTMLElement>();
  for (const child of Array.from(table.children)) {
    if (child instanceof HTMLElement && child.dataset.key !== undefined) rows.set(child.dataset.key, child);
  }
  // Everything is written before anything is read: one layout, not one per row.
  for (const row of rows.values()) {
    row.style.transition = "";
    row.style.transform = "";
  }
  const base = table.getBoundingClientRect();
  const places = new Map<string, Place>();
  for (const [key, row] of rows) {
    const box = row.getBoundingClientRect();
    places.set(key, { left: box.left - base.left, top: box.top - base.top });
  }
  return { rows, places };
}

/**
 * The FLIP step: a row that was somewhere else is put back there without a transition (First, Last, Invert), and on the next frame
 * released, so that it slides to where it now is (Play). It counts as moved when it is 1 px or more away on either axis.
 */
function slide(rows: Map<string, HTMLElement>, before: ReadonlyMap<string, Place>, after: ReadonlyMap<string, Place>, table: HTMLElement): void {
  const moved: HTMLElement[] = [];
  for (const [key, row] of rows) {
    const was = before.get(key);
    const now = after.get(key);
    if (was === undefined || now === undefined) continue;
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    row.style.transition = "none";
    row.style.transform = `translate(${dx}px, ${dy}px)`;
    moved.push(row);
  }
  if (moved.length === 0) return;
  // The inverted state must be laid out before it is left, or the browser would start from the end.
  void table.offsetHeight;
  requestAnimationFrame(() => {
    for (const row of moved) {
      const done = (event: TransitionEvent) => {
        if (event.propertyName !== "transform") return;
        row.removeEventListener("transitionend", done);
        // Taken off when it is over, so that the row's own hover or anything else is not left with a transition.
        row.style.transition = "";
      };
      row.addEventListener("transitionend", done);
      row.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASING}`;
      row.style.transform = "";
    }
  });
}

/**
 * Makes the keyed rows of a table (or the chips of a strip) live: after the first render, the keys that were not in the list before are the
 * rows that are `entering` (a class the stylesheet animates), and the rows that were there and are somewhere else now slide into place, on
 * either axis. `table` is the element whose children are the rows; a row says its key in `data-key`. Returns the entering keys, to be put on
 * the rows while rendering.
 *
 * A row stays `entering` for `ENTER_MS` from the commit that brought it, through any number of renders in between (the page renders again
 * with each beat, and a class that was a matter of one render would cut the animation short); then the script takes the class off the row
 * itself, and the next render has it without. Nothing happens on the first render (the server's, the hydration), while `enabled` is false,
 * or, for the sliding, when the visitor asked for less motion. Positions are kept from the end of each commit, measured from the top left
 * of the table so that scrolling the page is not a move. The row that falls off the list is simply gone.
 */
export function useLiveRows(table: RefObject<HTMLElement | null>, keys: readonly string[], enabled: boolean): ReadonlySet<string> {
  const last = useRef<{ keys: ReadonlySet<string>; places: ReadonlyMap<string, Place> } | null>(null);
  /** The rows that came in less than `ENTER_MS` ago, with the timer that ends it. */
  const entered = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const before = last.current;
  const entering = enabled && before ? new Set(keys.filter((key) => !before.keys.has(key) || entered.current.has(key))) : NONE;

  useLayoutEffect(() => {
    const element = table.current;
    if (!enabled || !element) {
      last.current = null;
      for (const timer of entered.current.values()) clearTimeout(timer);
      entered.current.clear();
      return;
    }
    const { rows, places } = measure(element);
    const previous = last.current;
    if (previous) {
      if (!prefersReducedMotion()) slide(rows, previous.places, places, element);
      for (const key of keys) {
        if (previous.keys.has(key) || entered.current.has(key)) continue;
        entered.current.set(
          key,
          setTimeout(() => {
            entered.current.delete(key);
            for (const row of Array.from(element.children)) {
              if (row instanceof HTMLElement && row.dataset.key === key) row.classList.remove("is-entering");
            }
          }, ENTER_MS),
        );
      }
    }
    last.current = { keys: new Set(keys), places };
  });

  // No timer outlives the table.
  useEffect(
    () => () => {
      for (const timer of entered.current.values()) clearTimeout(timer);
      entered.current.clear();
    },
    [],
  );

  return entering;
}
