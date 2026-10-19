import { useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";

import type { Cursor, CursorProps } from "./Cursor";
import { useHydrated } from "./cursor-slot-state";

/** What the visitor did to the layer before the cursor was there to see it. */
interface Pending {
  pointer?: { x: number; y: number; type: string };
  focus?: boolean;
  /** The keys of the cursor that were pressed, in order. */
  keys: string[];
}

// The cursor, once any plot of the page has loaded it. It is the module's and not a plot's: a plot in a `HoverGroup` (the panels of small
// multiples, the price and volume panes of candles) shows the group's bucket with a crosshair, dots and the others dimmed, which only a cursor
// does, so every plot on the page takes it the moment the first one has it, in the same commit, and the group works with no replay.
let cursor: typeof Cursor | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const loadedCursor = () => cursor;

/** The keys the cursor takes (`steppedKey`, cursor-state.tsx): the arrows, Home and End move it, Escape hides it. The browser's own shortcuts are not its. */
const KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End", "Escape"]);
const takes = (event: KeyboardEvent) => !event.altKey && !event.ctrlKey && !event.metaKey && KEYS.has(event.key);

/**
 * The layer a plot has until its cursor is needed (spec 2.1). The cursor (`Cursor.tsx`: the pointer, the tooltip and the keys) is more of the
 * page's first JavaScript than the page can spare, and nothing needs it before a pointer or the keyboard reaches a plot. So a plot draws this
 * instead, which is the cursor's own layer as it is before anything is done to it: the same transparent `role="slider"` over the plot, named as the
 * cursor names it, on the newest bucket, which it says in words. It is not in the Worker's HTML, as the cursor's is not (`useHydrated`).
 *
 * The first `pointerenter` or `focusin` loads the cursor with `import()`, which renders in the layer's place with every prop this was given,
 * unchanged (`CursorProps` is the contract, and a prop a later kit adds to it goes through), and in the place of every other plot's layer too. What
 * the visitor did meanwhile is done again to the new layer, in the order they did it: a focus focuses it, so the first focus already shows the newest
 * bucket; a pointer selects the bucket under it, where it is now; and each key of the cursor's (an arrow, Home, End, Escape) is pressed again, one
 * after a render of the one before. A mouse that has left, a focus that has gone and a touch the browser took for a scroll are not replayed.
 *
 * The state is `React.lazy`'s without its Suspense, which would put a boundary in the page's hydration. A failed load leaves this layer as it is and
 * the next pointer or focus asks again.
 */
export function CursorSlot(props: CursorProps) {
  const hydrated = useHydrated();
  const loaded = useSyncExternalStore(subscribe, loadedCursor, () => null);
  const pending = useRef<Pending>({ keys: [] });
  const asked = useRef(false);

  const load = () => {
    if (asked.current) return;
    asked.current = true;
    import("./Cursor").then(
      (module) => {
        cursor = module.Cursor;
        for (const listener of listeners) listener();
      },
      () => void (asked.current = false),
    );
  };

  // The cursor is in the plot now, in the place of this layer: hand it what was done.
  useLayoutEffect(() => {
    if (!loaded) return;
    const layer = props.plot.current?.querySelector<HTMLElement>(".plot__cursor");
    if (!layer) return;
    const { focus, pointer, keys } = pending.current;
    pending.current = { keys: [] };
    if (focus) layer.focus();
    // The pointer after the focus, so that where it is wins when the keyboard and the pointer both reached the plot.
    if (pointer) {
      const touch = pointer.type === "touch";
      layer.dispatchEvent(new PointerEvent(touch ? "pointerdown" : "pointermove", { bubbles: true, clientX: pointer.x, clientY: pointer.y, pointerType: pointer.type }));
    }
    // The keys last, each after a render of the one before: a key is read against the bucket the cursor is on, which the one before has moved.
    const press = (rest: string[]) => {
      const [key, ...later] = rest;
      if (key === undefined || !layer.isConnected) return;
      layer.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      if (later.length > 0) setTimeout(() => press(later));
    };
    press(keys);
  }, [loaded]);

  if (!hydrated || props.count <= 0) return null;
  if (loaded) {
    const LoadedCursor = loaded;
    return <LoadedCursor {...props} />;
  }

  const last = props.count - 1;
  const at = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY, type: event.pointerType });
  return (
    <div
      className="plot__cursor"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={last}
      aria-valuetext={props.valueText(last)}
      onPointerEnter={(event) => {
        pending.current.pointer = at(event);
        load();
      }}
      onPointerMove={(event) => {
        if (pending.current.pointer) pending.current.pointer = at(event);
      }}
      // A touch lifts as it leaves, and it is the tap that is replayed; a mouse that has left shows nothing.
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") delete pending.current.pointer;
      }}
      onPointerCancel={() => void delete pending.current.pointer}
      onFocus={() => {
        pending.current.focus = true;
        load();
      }}
      onBlur={() => void delete pending.current.focus}
      // Kept from scrolling the region while the cursor loads, as the cursor keeps them, and pressed again when it is there.
      onKeyDown={(event) => {
        if (!takes(event)) return;
        if (event.key !== "Escape") event.preventDefault();
        pending.current.keys.push(event.key);
        load();
      }}
    />
  );
}
