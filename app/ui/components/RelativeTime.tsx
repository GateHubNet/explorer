import { useSyncExternalStore } from "react";

import { formatUtc, relativeTime } from "../../domain/format";

// One timer for every RelativeTime on the page, running while at least one is mounted and the tab is visible.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    if (!document.hidden) for (const notify of listeners) notify();
  }, 1000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The clock in whole seconds, so that the snapshot is stable between two reads in the same second. */
const clockSeconds = () => Math.floor(Date.now() / 1000);
/** The server and the first render in the browser know no clock: the page they print must not depend on one. */
const noClock = () => null;

/**
 * How long ago something was (`3 s ago`), ticking in the browser. The server prints `fallback` instead (an absolute time, or
 * nothing), because an HTML page is stored and served to everybody for seconds or for a year, and an age in it would be
 * wrong from the moment it is stored. `lead` goes before the age only, so that nothing dangles when there is none. The
 * absolute time is on hover and in `dateTime`.
 *
 * `at` is unix seconds.
 */
export function RelativeTime({
  at,
  fallback,
  lead,
  className,
}: {
  at: number;
  fallback?: string;
  lead?: string;
  className?: string;
}) {
  const now = useSyncExternalStore(subscribe, clockSeconds, noClock);
  if (!Number.isFinite(at)) return null;
  return (
    <time dateTime={new Date(at * 1000).toISOString()} title={formatUtc(at)} className={className}>
      {now === null ? fallback : `${lead ?? ""}${relativeTime(at * 1000, now * 1000)}`}
    </time>
  );
}
