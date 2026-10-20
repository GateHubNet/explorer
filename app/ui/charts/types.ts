// The data shapes of the chart kit (spec section 2.3). Type-only: view builders import these types and hand the kit exact decimal
// strings; the kit parses them with `Number()` for geometry and nothing else. Every text a chart shows is made from the strings.

export type Slot = 1 | 2 | 3 | 4 | 5 | "other" | "up" | "down" | "neutral";
export type ValueKind = "count" | "amount" | "drops" | "percent" | "seconds" | "price" | "value";   // "value": an estimate in the native currency
export interface ValueFormat { kind: ValueKind; unit?: string }             // unit: "XRP", "USD", "drops"
export interface TimeAxis {
  unit: "day" | "week" | "month" | "hour" | "minute" | "flag";       // "month": YYYY-MM-01; "minute": 15-minute buckets ("17:15"); "flag": one point per flag ledger, evenly spaced
  buckets: string[];                                                 // UTC: YYYY-MM-DD, or YYYY-MM-DDTHH:mm:ssZ; oldest first
}
export interface Series { id: string; label: string; short?: string; slot: Slot; values: (string | null)[] }  // null: no value
/** A per-bucket figure that is shown in the tooltip, the slider and the table, and never drawn. */
export interface TimeSeriesExtra {
  id: string;
  label: string;
  values: (string | null)[];                                         // one per bucket of the axis; null is "no data"
  format?: ValueFormat;
  tooltip?: "value-label" | "value";                                 // the tooltip row's form; default "value-label"
}
export interface TimeSeriesData {
  axis: TimeAxis;
  series: Series[];                                                  // in their fixed order; stacks bottom up
  format: ValueFormat;
  totals?: (string | null)[];                                        // stacks: exact totals per bucket
  domain?: { min?: string; max?: string };                           // lines only; the card's note must state a non-zero start
  references?: { value: string; label: string }[];
  annotations?: { bucket: number; symbol: string; label: string }[];
  forming?: boolean;                                                 // true: the newest bucket is the running one ("so far")
  pending?: number;                                                  // how many of the newest buckets are not computed yet (0 to 2)
  extras?: TimeSeriesExtra[];                                        // never part of the scales, the legend or the summary; the token must cover them
  token: string;
}
export interface SmallMultiplesData {
  axis: TimeAxis;                                                    // shared by every panel
  panels: {
    id: string;
    label: string;                                                   // the panel's heading: "XRP", "RLUSD"
    sublabel?: string;                                               // under it: the short issuer, "rMxCK…5De"
    values: (string | null)[];                                       // one per bucket of the axis
    format: ValueFormat;                                             // the panel's own unit
  }[];                                                               // in their fixed order, at most 6
  forming?: boolean;
  pending?: number;
  token: string;
}
export interface BarListData {
  items: {
    id: string;
    label: string;
    sublabel?: string;
    value: string;
    /** The whole text at the tip ("58%", "<1%"), the view builder's. Optional where the tip is the count (`tip="count"`). */
    share?: string;
    count?: string;                                                  // the table's column; the tip's "312 trades" when `tip="count"`
    /** The path the label is a link to (`/xrpl/account/r…`), the view builder's. The bar is not a target. */
    href?: string;
  }[];
  format: ValueFormat;
  token: string;
}
export interface ShareData { rows: { id: string; label: string; total: string; segments: { id: string; label: string; slot: Slot; value: string }[] }[]; token: string }
export interface MeterData { value: string; max: string; threshold?: { value: string; label: string }; label: string }
export interface CandleData {
  axis: TimeAxis;
  candles: ({ o: string; h: string; l: string; c: string; v: string; n: string } | null)[];
  format: ValueFormat;
  volume: ValueFormat;
  forming?: boolean;                                                 // true: the newest bucket is the running one ("so far")
  token: string;
}

/** A `StatTile`'s delta: the signed text ("+12.4%") and which way the triangle points (1 up, -1 down, 0 flat). */
export interface Delta { text: string; sign: 1 | -1 | 0 }
