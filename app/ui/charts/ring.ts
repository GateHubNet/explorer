// The ring of a changed figure (spec 2.9), which every form of the chart kit puts on when a beat of the page brings it a new token: a leaf of its own, so that a form that draws no plot
// (ShareBar, BarList, WindowBar) does not load `Plot.tsx` and its cursor for two hooks. Plot.tsx re-exports both, as it always had them.

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * False until the token changes after the first render, then true: the figure mark of `LiveValue` (components.css), for a chart that a
 * beat of the page has redrawn. The server's render and the hydration have the first token, so they never have it.
 */
export function usePlotMark(token: string): boolean {
  const [seen, setSeen] = useState(token);
  const [changed, setChanged] = useState(false);
  // Adjusting state while rendering is React's way to answer a prop that changed, with no frame drawn in between.
  if (seen !== token) {
    setSeen(token);
    setChanged(true);
  }
  return changed;
}

/**
 * `usePlotMark`, and the ring itself on `box`: the class `is-changed` that `charts.css` animates, which the token's change puts on (React
 * does, through the `changed` this returns), and each change after the first runs again. The class stays after the first change, and a CSS
 * animation that has finished cannot be started again from script (it is no longer there to ask for), so a later change does it with the
 * class: off, a reflow so that the browser sees it off, and on. The first change starts the ring by itself, with the class. For the plot,
 * and for a form that has none (the share bars): `box` is where the class goes. With `mark` false there is never a ring, and the class is
 * neither put on nor restarted.
 */
export function usePlotRing(token: string, box: RefObject<HTMLElement | null>, mark = true): boolean {
  const changed = usePlotMark(token) && mark;
  const marked = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (marked.current && el) {
      el.classList.remove("is-changed");
      void el.offsetWidth;
      el.classList.add("is-changed");
    }
    marked.current = changed;
  }, [token]);
  return changed;
}
