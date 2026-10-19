import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

import type { Cursor, CursorProps } from "./Cursor";
import { useHydrated } from "./cursor-slot-state";

/** What the visitor did to the layer before the cursor was there to see it. */
interface Pending {
  pointer?: { x: number; y: number; type: string };
  focus?: boolean;
}

/**
 * The layer a plot has until its cursor is needed (spec 2.1). The cursor (`Cursor.tsx`: the pointer, the tooltip and the keys) is more of the
 * page's first JavaScript than the page can spare, and nothing needs it before a pointer or the keyboard reaches a plot. So a plot draws this
 * instead, which is the cursor's own layer as it is before anything is done to it: the same transparent `role="slider"` over the plot, named as the
 * cursor names it, on the newest bucket, which it says in words. It is not in the Worker's HTML, as the cursor's is not (`useHydrated`).
 *
 * The first `pointerenter` or `focusin` loads the cursor with `import()`, which renders in the layer's place with every prop this was given,
 * unchanged (`CursorProps` is the contract, and a prop a later kit adds to it goes through). What the visitor did meanwhile is done again to the new
 * layer: a focus focuses it, so the first focus already shows the newest bucket, and a pointer selects the bucket under it, where it is now. A mouse
 * that has left, a focus that has gone and a touch the browser took for a scroll are not replayed. A key pressed before the cursor is there is lost;
 * it comes a few milliseconds after the focus, from a file the page's own origin serves.
 *
 * The state is `React.lazy`'s without its Suspense, which would put a boundary in the page's hydration. A failed load leaves this layer as it is and
 * the next pointer or focus asks again.
 */
export function CursorSlot(props: CursorProps) {
  const hydrated = useHydrated();
  const [loaded, setLoaded] = useState<typeof Cursor | null>(null);
  const pending = useRef<Pending>({});
  const asked = useRef(false);

  const load = () => {
    if (asked.current) return;
    asked.current = true;
    import("./Cursor").then(
      // A component is a function, which a state setter would call.
      (module) => setLoaded(() => module.Cursor),
      () => void (asked.current = false),
    );
  };

  // The cursor is in the plot now, in the place of this layer: hand it what was done.
  useLayoutEffect(() => {
    if (!loaded) return;
    const layer = props.plot.current?.querySelector<HTMLElement>(".plot__cursor");
    if (!layer) return;
    const { focus, pointer } = pending.current;
    pending.current = {};
    if (focus) layer.focus();
    // The pointer after the focus, so that where it is wins when the keyboard and the pointer both reached the plot.
    if (pointer) {
      const touch = pointer.type === "touch";
      layer.dispatchEvent(new PointerEvent(touch ? "pointerdown" : "pointermove", { bubbles: true, clientX: pointer.x, clientY: pointer.y, pointerType: pointer.type }));
    }
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
    />
  );
}
