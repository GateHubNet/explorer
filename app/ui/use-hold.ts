import { useCallback, useEffect, useRef, type FocusEvent, type PointerEvent } from "react";

/**
 * Whether focus on `target` holds the updates while it is in a table: a link or a button in it (it is about to be pressed, and a row that moved
 * would take it away), or anything that shows a focus ring, which is how a keyboard has focus (`:focus-visible`: the table's scroll region
 * has tabindex 0 so that a keyboard can scroll it). A click on a spot of the table that is not a link also focuses the scroll region, but that
 * is not keyboard focus and must not hold the page after the pointer has left.
 */
export function holdsFocus(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("a[href], button") !== null) return true;
  try {
    return target.matches(":focus-visible");
  } catch {
    // A browser that does not know the selector says nothing of keyboard focus: no hold, which is the safe side (the page goes on).
    return false;
  }
}

/** The handlers that make an element hold the page while the visitor is on it. */
export interface HoldHandlers {
  onPointerEnter(e: PointerEvent): void;
  onPointerLeave(): void;
  onFocus(e: FocusEvent<HTMLElement>): void;
  onBlur(e: FocusEvent<HTMLElement>): void;
}

/**
 * The holds of a live page: a part of it that has links (a table, a strip of chips) holds the updates while a mouse or a pen is over it or
 * keyboard focus is in it, so that nothing moves under a click. `holds(name)` gives the handlers to spread on the part called `name`.
 * There is a hold for each name and each way (pointer, focus), and `onHold(true)` is called while any is held, `onHold(false)` when none is.
 * A hold must not outlive the page that made it (the page may be remounted for the other network, and the hook that polls is not), so
 * `onHold(false)` is called when the page unmounts, whatever was held. Without an `onHold` there is nobody to tell.
 */
export function useHolds(onHold?: (held: boolean) => void): (name: string) => HoldHandlers {
  const holds = useRef(new Set<string>());
  // The latest `onHold`, for the handlers and for the unmount, which outlive the render that made them.
  const current = useRef(onHold);
  useEffect(() => {
    current.current = onHold;
  });
  useEffect(
    () => () => {
      holds.current.clear();
      current.current?.(false);
    },
    [],
  );

  return useCallback((name) => {
    const hold = (id: string, on: boolean) => {
      if (on) holds.current.add(id);
      else holds.current.delete(id);
      current.current?.(holds.current.size > 0);
    };
    return {
      // A finger is not a pointer that stays over a part: only a mouse or a pen holds.
      onPointerEnter: (event) => {
        if (event.pointerType !== "touch") hold(`${name}:pointer`, true);
      },
      onPointerLeave: () => hold(`${name}:pointer`, false),
      // What focus does is decided each time it moves, so that a mouse that focuses the scroll region after a link had focus lets go of it.
      onFocus: (event) => hold(`${name}:focus`, holdsFocus(event.target)),
      // Focus moving inside the part is not leaving it.
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hold(`${name}:focus`, false);
      },
    };
  }, []);
}
