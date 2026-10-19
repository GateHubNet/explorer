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
