import type { Slot, TimeSeriesData } from "./types";

export interface LegendItem {
  id: string;
  label: string;
  /** A swatch (areas and columns), a line key (lines), or a symbol that marks a column (an annotation). */
  key: "swatch" | "line" | "symbol";
  /** The colour of a swatch or a line key. */
  slot?: Slot;
  /** What the symbol is, for a symbol key (`×`). */
  symbol?: string;
}

/**
 * The legend of a chart (spec 2.11): a 10 × 10 px swatch for a column or an area, a 14 × 2 px key for a line, or a symbol with its
 * words, in the order given. Nothing for fewer than two swatches or lines and no symbol: one series needs none, its title names it. The
 * colour of a key is its slot's, set by CSS from `data-slot` (charts.css); the words stay in the text colour. The keys are decoration
 * (`aria-hidden`): the words name the series, and the table view is the other way to read them.
 */
export function Legend({ items }: { items: readonly LegendItem[] }) {
  const keys = items.filter((item) => item.key !== "symbol").length;
  if (keys < 2 && !items.some((item) => item.key === "symbol")) return null;

  return (
    <ul className="legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.id} className="legend__item">
          {item.key === "symbol" ? (
            <>
              <span className="legend__symbol">{item.symbol}</span> {item.label}
            </>
          ) : (
            <>
              <span className={item.key === "line" ? "legend__line" : "legend__swatch"} data-slot={item.slot} aria-hidden="true" />
              {item.label}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The legend items of a time series: one for each series in its order, then one for each distinct annotation (symbol and words), however
 * many columns carry it. `key` is how the form draws a series: `swatch` for columns, `line` for lines.
 */
export function legendOf(data: TimeSeriesData, key: "swatch" | "line"): LegendItem[] {
  const items: LegendItem[] = data.series.map((series) => ({ id: series.id, label: series.label, key, slot: series.slot }));
  const seen = new Set<string>();
  for (const { symbol, label } of data.annotations ?? []) {
    const id = `annotation:${symbol}:${label}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label, key: "symbol", symbol });
  }
  return items;
}
