import { cellOf, lastOf } from "./cells";
import { linePath, num, xOf } from "./geometry";

/** The box in px (spec 2.11). */
const WIDTH = 100;
const HEIGHT = 28;
/** The end dot is 8 px (radius 4) and its ring 2 px more: the line and the dot stay this far from the box's edges, so that nothing is cut. */
const DOT = 4;
const RING = 6;

/**
 * An inline trend with no axes (spec 2.11), for a row or a tile: a line of 1.5 px in `--faint` and an end dot of 8 px in `--accent` with a
 * ring, in a box of 100 × 28 px. The values run from the lowest to the highest of them, bottom to top, and are spread evenly along it; this
 * is a shape, so there is no zero and no scale. A value that is `null` (or not a number) is a gap, where the line breaks, and the dot is on
 * the last value there is. A level line is drawn in the middle.
 *
 * It is one image named by `label` ("7-day price, from 2.38 to 2.44, +2.5%"): the view builder writes it, since the numbers are its. It has
 * no hover and no cursor, because the row or the tile it sits in carries the values.
 */
export function Sparkline({ values, label }: { values: readonly (string | null)[]; label: string }) {
  const cells = values.map(cellOf);
  const last = lastOf(cells);
  const numbers = cells.flatMap((cell) => (cell ? [cell.value] : []));
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const fractions = cells.map((cell) => (cell === null ? null : high > low ? (cell.value - low) / (high - low) : 0.5));

  const area = { width: WIDTH - 2 * RING, height: HEIGHT - 2 * RING };
  // The end dot: on the last value there is.
  const end = last < 0 ? null : { x: num(xOf(last, cells.length, "points") * area.width), y: num(area.height * (1 - fractions[last]!)) };

  return (
    <svg className="spark" role="img" aria-label={label} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} focusable="false">
      {end && (
        <g transform={`translate(${RING} ${RING})`}>
          <path className="spark__line" d={linePath(fractions, { ...area, placement: "points" })} />
          <circle className="spark__ring" cx={end.x} cy={end.y} r={RING} />
          <circle className="spark__dot" cx={end.x} cy={end.y} r={DOT} />
        </g>
      )}
    </svg>
  );
}
