import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { OnScreen } from "./on-screen";
import { useLiveRefresh } from "./use-live-refresh";

/** What the home page is given to show and to tell about the live updates (`HomePage`'s `live`). */
export interface LiveControls {
  /** The visitor paused the updates. */
  paused: boolean;
  /** How many refreshes in a row did not work. */
  failures: number;
  /** The pause button was pressed. */
  onTogglePause(): void;
  /** The visitor is on a table (the pointer over it, focus in it) or has left it: rows must not move under a click. */
  onHold(held: boolean): void;
}

/** Where a tab remembers that its visitor paused the updates (`sessionStorage`: per tab; it may throw where storage is blocked). */
const PAUSED_KEY = "explorer:live-paused";

function readPaused(): boolean {
  try {
    return window.sessionStorage.getItem(PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writePaused(paused: boolean): void {
  try {
    if (paused) window.sessionStorage.setItem(PAUSED_KEY, "1");
    else window.sessionStorage.removeItem(PAUSED_KEY);
  } catch {
    // The choice holds for this page and is not remembered.
  }
}

/**
 * The home page's live updates as the route wires them: the polling (`useLiveRefresh`) with what the page knows that it must obey, and the
 * `LiveControls` the page shows. The failures are the page's `OnScreen` store's. Whether it is paused is the visitor's, read from the tab's
 * storage after the first render (so that the server's HTML and the hydration do not depend on it, and a paused tab does not ask before it
 * has been read: the first beat is 4 s after the page is up).
 */
export function useHomeLive(store: Pick<OnScreen<unknown>, "failures" | "subscribe">): LiveControls {
  const failures = useSyncExternalStore(store.subscribe, store.failures, () => 0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);

  useEffect(() => setPaused(readPaused()), []);
  useLiveRefresh({ failures, paused, holding });

  return useMemo(
    () => ({
      paused,
      failures,
      onTogglePause: () => {
        setPaused(!paused);
        writePaused(!paused);
      },
      onHold: setHolding,
    }),
    [paused, failures],
  );
}
