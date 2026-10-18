// The little picture beside an address on the account page: a 5 x 5 pattern, mirrored left to right, drawn from the address
// alone, so the same address always has the same picture and nobody has to be told which is which. It is a recognisable mark, not a
// check of anything: two addresses may share one. Pure: the Worker and the browser both draw it.

/**
 * The 25 cells (row by row, `true` for filled) of an address's picture. Three columns are drawn from a small generator seeded with
 * the address, and mirrored into the other two.
 */
export function identiconCells(address: string): boolean[] {
  let seed = 0;
  for (let i = 0; i < address.length; i += 1) seed = (seed * 31 + address.charCodeAt(i)) >>> 0;

  const cells: boolean[] = [];
  for (let row = 0; row < 5; row += 1) {
    const half: boolean[] = [];
    for (let column = 0; column < 3; column += 1) {
      // The multiplier is kept in 32 bits by Math.imul: an ordinary product would leave the range where doubles are exact.
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      half.push((seed >>> 16) % 2 === 0);
    }
    cells.push(half[0]!, half[1]!, half[2]!, half[1]!, half[0]!);
  }
  return cells;
}

/** The cells as the `d` of an SVG path in a `viewBox` of `0 0 5 5`: a unit square for each one that is on. */
export function identiconPath(cells: readonly boolean[]): string {
  return cells
    .map((on, index) => (on ? `M${index % 5} ${Math.floor(index / 5)}h1v1h-1z` : ""))
    .join("");
}
