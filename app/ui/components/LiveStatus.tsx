import { useEffect, useState, useSyncExternalStore } from "react";

import { cx } from "../cx";

/** After this many failed refreshes in a row the page says that its updates are paused. */
export const PAUSED_AFTER_FAILURES = 2;

/** How long the page says that its updates are back, in ms. */
const RECONNECTED_MS = 4000;

/**
 * The hero's quiet line about the live updates, in visible text (`role="status"`: a screen reader hears it, politely). It is always in the
 * page, empty, so that a change to it is announced, and it changes only on the transitions that matter: after two failures in a row
 * "Live updates paused, retrying…", when they work again "Live updates reconnected" for a few seconds, and what the visitor has just done with
 * the pause button (`notice`: "Live updates paused", "Live updates resumed", which they asked for, so once for each press is right). A third
 * failure, a tenth, or a beat that works while all was well do not touch it, so that nothing is announced every 4 s. While the visitor has
 * paused the updates nothing is being retried and it does not say so (the failures stay counted for when they resume).
 */
export function LiveStatus({ failures, paused = false, notice = "" }: { failures: number; paused?: boolean; notice?: string }) {
  const stuck = failures >= PAUSED_AFTER_FAILURES;
  const [wasStuck, setWasStuck] = useState(false);
  const [back, setBack] = useState(false);
  // Adjusting state while rendering is React's way to answer a prop that changed, with no frame drawn in between.
  if (stuck !== wasStuck) {
    setWasStuck(stuck);
    setBack(wasStuck && !stuck);
  }
  useEffect(() => {
    if (!back) return;
    const timer = setTimeout(() => setBack(false), RECONNECTED_MS);
    return () => clearTimeout(timer);
  }, [back]);

  const retrying = stuck && !paused;
  return (
    <span role="status" className="hero__live">
      {retrying ? "Live updates paused, retrying…" : notice || (back ? "Live updates reconnected" : "")}
    </span>
  );
}

const noSubscription = () => () => {};

/**
 * The button that pauses and resumes the live updates (WCAG 2.2.2: moving content that starts by itself and lasts more than five seconds
 * must be pausable). A real button, 44 px by the stylesheet. Its label says what it will do, "Pause live updates" / "Resume live updates",
 * and so it is **not** also `aria-pressed`: a name that changes with the state and a pressed state together would be read "Resume live
 * updates, pressed". The look of a paused one hangs on the class `is-paused`. It is only in the page once the script runs: without it there
 * is nothing to pause, and a button that does nothing is worse than none; the server's HTML and the first render in the browser leave it
 * out, so they match.
 */
export function LiveToggle({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!hydrated) return null;
  return (
    <button type="button" className={cx("live-toggle", paused && "is-paused")} onClick={onToggle}>
      {paused ? "Resume live updates" : "Pause live updates"}
    </button>
  );
}
