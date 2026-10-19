// Where a bucket sits along the x axis of a plot, and the little else that the cursor needs of the geometry (spec 2.2 and 2.6): pure functions of
// numbers, as geometry.ts is, which re-exports them. They are a module of their own so that the cursor, which is loaded when it is needed
// (CursorSlot.tsx), imports these and not the whole of geometry.ts, which would have to be loaded with it.

export type Placement = "points" | "bands";

/** A fraction of a plot as a percent for its `style`: `51.72%`, rounded to `decimals` (2) and with no trailing zeros. A segment that is an exact share has 3. */
export const percent = (fraction: number, decimals = 2): string => `${Math.round(fraction * 10 ** (decimals + 2)) / 10 ** decimals}%`;

/** The fraction of the plot's width that bucket `i` of `n` is at: points on i/(n−1) (the middle for a lone one), bands at their centres. */
export function xOf(i: number, n: number, placement: Placement): number {
  if (placement === "points") return n > 1 ? i / (n - 1) : 0.5;
  return (i + 0.5) / Math.max(n, 1);
}

/** The bucket nearest `fraction` of the plot's width, from 0 to n−1: the inverse of `xOf`. */
export function bucketAt(fraction: number, n: number, placement: Placement): number {
  if (!(n > 0) || Number.isNaN(fraction)) return 0;
  const nearest = placement === "points" ? Math.round(fraction * (n - 1)) : Math.floor(fraction * n);
  return Math.min(n - 1, Math.max(0, nearest));
}

/** Which side of the cursor the tooltip opens on: right under 22% of the plot's width, left over 78%, else centred. */
export function tooltipSide(fraction: number): "right" | "left" | "center" {
  if (fraction < 0.22) return "right";
  return fraction > 0.78 ? "left" : "center";
}
