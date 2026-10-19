// What the forms of the chart kit make of a value they draw: the view builder's decimal string and its number, which is for the geometry
// and nothing else (every text a chart shows is made from the string, labels.ts).

/** A value the kit can draw: the view builder's decimal string and its number. A missing or unreadable value is `null` (`cellOf`). */
export interface Cell {
  text: string;
  value: number;
}

export function cellOf(text: string | null | undefined): Cell | null {
  if (text === null || text === undefined || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? { text, value } : null;
}

/** The index of the last bucket that has a value, or -1. */
export function lastOf(cells: readonly (Cell | null)[]): number {
  for (let i = cells.length - 1; i >= 0; i -= 1) if (cells[i]) return i;
  return -1;
}

/**
 * `size` over `max`, from 0 to 1, for a bar that is a share of a whole (the meter's fill, an inline bar): a size past the ends is held at
 * them, and what is not a number, or a `max` that is not above 0, is 0.
 */
export function shareOf(size: string, max: string): number {
  const [s, m] = [cellOf(size), cellOf(max)];
  if (!s || !m || !(m.value > 0)) return 0;
  return Math.min(1, Math.max(0, s.value / m.value));
}
