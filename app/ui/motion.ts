// What the live updates of the home page share (README, "Live updates"). Browser-side; nothing here runs on the server.

/** How long the rows that were there take to slide into their new places (FLIP), in ms. A new row's own entrance is in components.css. */
export const FLIP_MS = 420;

/** The curve of that slide: quick out of the start, soft at the end. */
export const FLIP_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";

/**
 * Whether the visitor asked for less motion. Read when an update arrives and never while rendering, so the server's markup and the first
 * client render do not depend on it. components.css and base.css do the rest: under this setting no animation or transition runs at all
 * but the quiet highlight, and the script moves nothing.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
