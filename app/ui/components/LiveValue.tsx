import { useState, type ReactNode } from "react";

import { cx } from "../cx";

/**
 * A figure of the home page that ticks in when it changes: the new value comes up from below with a short highlight (components.css,
 * `.live__value.is-changed`). `token` is what the figure says, as text: the animation runs when it changes and not before, so a clock
 * ticking inside `children` is not a change, and neither is a render with the same ledger. The first render (the server's, the
 * hydration) never animates.
 *
 * The value sits in an element keyed by its token, so a change is a new element and its animation starts from the top; a render that
 * keeps the token keeps the element, and the animation that is running. No live region: a screen reader is not told every few seconds.
 */
export function LiveValue({ token, children }: { token: string; children: ReactNode }) {
  const [seen, setSeen] = useState(token);
  const [changed, setChanged] = useState(false);
  // Adjusting state while rendering is React's way to answer a prop that changed, with no frame drawn in between.
  if (seen !== token) {
    setSeen(token);
    setChanged(true);
  }
  return (
    <span className="live">
      <span key={token} className={cx("live__value", changed && "is-changed")}>
        {children}
      </span>
    </span>
  );
}
