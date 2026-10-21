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
 * The clock in whole seconds, ticking once a second while the tab is visible: the one timer of the page, shared by every `RelativeTime`
 * and `Countdown` mounted, and running only while one is. `null` on the server and at hydration, so that what is printed there does not
 * depend on the clock.
 */
export function useClockSeconds(): number | null {
  return useSyncExternalStore(subscribe, clockSeconds, noClock);
}

/** The age of `at` at `now` (both unix seconds): `relativeTime`'s, or `< 1 min ago` while it is under `coarse` seconds. */
function age(at: number, now: number, coarse: number | undefined): string {
  return coarse !== undefined && now - at < coarse ? `< ${coarse / 60} min ago` : relativeTime(at * 1000, now * 1000);
}

/**
 * How long ago something was (`3 s ago`), ticking in the browser. The server prints `fallback` instead (an absolute time, or
 * nothing), because an HTML page is stored and served to everybody for seconds or for a year, and an age in it would be
 * wrong from the moment it is stored. `lead` goes before the age only, so that nothing dangles when there is none. The
 * absolute time is on hover and in `dateTime`.
 *
 * With `coarse` (seconds, a multiple of 60) an age under it reads `< 1 min ago` (`coarse={60}`) or `< 5 min ago` (`coarse={300}`): for
 * data that can be older than the age it would show.
 *
 * `at` is unix seconds.
 */
export function RelativeTime({
  at,
  fallback,
  lead,
  coarse,
  className,
}: {
  at: number;
  fallback?: string;
  lead?: string;
  coarse?: number;
  className?: string;
}) {
  const now = useClockSeconds();
  if (!Number.isFinite(at)) return null;
  return (
    <time dateTime={new Date(at * 1000).toISOString()} title={formatUtc(at)} className={className}>
      {now === null ? fallback : `${lead ?? ""}${age(at, now, coarse)}`}
    </time>
  );
}
