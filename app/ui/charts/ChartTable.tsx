import type { ReactNode } from "react";

import { formatAmount } from "../../domain/format";
import { DataTable, type Column } from "../components/DataTable";
import { bucketLabel, cellText, tableHeading } from "./labels";
import type { BarListData, CandleData, ShareData, SmallMultiplesData, TimeSeriesData, ValueFormat } from "./types";

/** The table view is this tall at most, in px, and scrolls beyond that (spec 2.5). */
const MAX_HEIGHT = 300;
/** A compact row has 12 px of padding on each side and 12 px between its columns (components.css). */
const PADDING = 12;
const GAP = 12;
/** The least width of a column, in px: the date of a running bucket, a name, a figure, a count. */
const DATE = 150;
const NAME = 160;
const FIGURE = 120;
const COUNT = 88;

interface Col<Row> {
  id: string;
  header: ReactNode;
  /** The least width of its track, in px. */
  min: number;
  /** A label starts at the start; a figure ends at the end. */
  figure?: boolean;
  /** Takes a share of the width the table has beyond its least. */
  grow?: boolean;
  cell: (row: Row, index: number) => ReactNode;
}

/** A `DataTable` of the kit's look: compact, 300 px high at most, wide enough for every column at its least, "No data" when it has no rows. */
function Grid<Row>({ title, cols, rows, rowKey }: { title: string; cols: readonly Col<Row>[]; rows: readonly Row[]; rowKey: (row: Row, index: number) => string }) {
  const columns: Column<Row>[] = cols.map((col) => ({
    id: col.id,
    header: col.header,
    width: col.grow ? `minmax(${col.min}px, 1fr)` : `${col.min}px`,
    align: col.figure ? "end" : "start",
    cell: col.cell,
  }));
  const minWidth = cols.reduce((sum, col) => sum + col.min, 0) + (cols.length - 1) * GAP + 2 * PADDING;
  return <DataTable label={title} columns={columns} rows={rows} rowKey={rowKey} minWidth={minWidth} empty="No data" compact maxHeight={MAX_HEIGHT} />;
}

/** A figure; a missing one is a dash that screen readers hear as "no data". */
function figure(text: string | null, format?: ValueFormat): ReactNode {
  if (text === null || text === undefined) {
    return (
      <>
        <span aria-hidden="true">{cellText(null, { kind: "count" })}</span>
        <span className="sr">no data</span>
      </>
    );
  }
  return format ? cellText(text, format) : formatAmount(text);
}

/** A label, and the sublabel (a short issuer) after it. */
function named(label: string, sublabel: string | undefined): ReactNode {
  return sublabel ? (
    <>
      {label} <span className="chart__sub">{sublabel}</span>
    </>
  ) : (
    label
  );
}

/** The indices of `count` buckets, the newest first. */
const newestFirst = (count: number): number[] => Array.from({ length: count }, (_, k) => count - 1 - k);

const hasValue = (values: readonly (string | null | undefined)[] | undefined) => (values ?? []).some((value) => value !== null && value !== undefined);

/** The first column of a table over time: the bucket's date in UTC, with ", so far" on the running one. */
function bucketCol(axis: SmallMultiplesData["axis"], forming: boolean | undefined): Col<number> {
  const last = axis.buckets.length - 1;
  return {
    id: "bucket",
    header: tableHeading(axis.unit),
    min: DATE,
    cell: (i) => bucketLabel(axis.buckets[i] ?? "", axis.unit, "table", forming === true && i === last),
  };
}

function timeSeries(title: string, data: TimeSeriesData, totalLabel: string) {
  const { axis, format } = data;
  const cols: Col<number>[] = [
    bucketCol(axis, data.forming),
    ...data.series.map((series): Col<number> => ({
      id: series.id,
      header: series.label,
      min: format.kind === "count" ? COUNT : FIGURE,
      figure: true,
      grow: true,
      cell: (i) => figure(series.values[i] ?? null, format),
    })),
  ];
  const totals = data.totals;
  if (totals) {
    cols.push({
      id: "total",
      header: totalLabel,
      min: format.kind === "count" ? COUNT : FIGURE,
      figure: true,
      grow: true,
      cell: (i) => <span className="chart__total">{figure(totals[i] ?? null, format)}</span>,
    });
  }
  const empty = !data.series.some((series) => hasValue(series.values)) && !hasValue(totals);
  return <Grid title={title} cols={cols} rows={empty ? [] : newestFirst(axis.buckets.length)} rowKey={(i) => axis.buckets[i] ?? String(i)} />;
}

function smallMultiples(title: string, data: SmallMultiplesData) {
  const cols: Col<number>[] = [
    bucketCol(data.axis, data.forming),
    ...data.panels.map((panel): Col<number> => ({
      id: panel.id,
      header: named(panel.label, panel.sublabel),
      min: FIGURE,
      figure: true,
      grow: true,
      cell: (i) => figure(panel.values[i] ?? null, panel.format),
    })),
  ];
  const empty = !data.panels.some((panel) => hasValue(panel.values));
  return <Grid title={title} cols={cols} rows={empty ? [] : newestFirst(data.axis.buckets.length)} rowKey={(i) => data.axis.buckets[i] ?? String(i)} />;
}

function barList(title: string, data: BarListData) {
  const { items, format } = data;
  const cols: Col<BarListData["items"][number]>[] = [
    { id: "name", header: "Name", min: NAME, grow: true, cell: (item) => named(item.label, item.sublabel) },
    { id: "value", header: "Value", min: FIGURE, figure: true, grow: true, cell: (item) => figure(item.value, format) },
  ];
  // A list whose tip is the count (`tip="count"`) has no share: a column of dashes would say nothing.
  if (items.some((item) => item.share !== undefined)) {
    cols.push({ id: "share", header: "Share", min: COUNT, figure: true, grow: true, cell: (item) => item.share ?? figure(null) });
  }
  if (items.some((item) => item.count !== undefined)) {
    cols.push({ id: "count", header: "Count", min: COUNT, figure: true, grow: true, cell: (item) => figure(item.count ?? null) });
  }
  return <Grid title={title} cols={cols} rows={items} rowKey={(item) => item.id} />;
}

function shares(title: string, data: ShareData, totalLabel: string) {
  type Row = ShareData["rows"][number];
  // One column for each segment, in the order they are first met in the rows.
  const segments = new Map<string, string>();
  for (const row of data.rows) for (const segment of row.segments) if (!segments.has(segment.id)) segments.set(segment.id, segment.label);
  const cols: Col<Row>[] = [
    { id: "name", header: "Name", min: NAME, grow: true, cell: (row) => row.label },
    { id: "total", header: totalLabel, min: COUNT, figure: true, grow: true, cell: (row) => <span className="chart__total">{figure(row.total)}</span> },
    ...[...segments].map(([id, label]): Col<Row> => ({
      id: `segment-${id}`,
      header: label,
      min: COUNT,
      figure: true,
      grow: true,
      cell: (row) => figure(row.segments.find((segment) => segment.id === id)?.value ?? null),
    })),
  ];
  return <Grid title={title} cols={cols} rows={data.rows} rowKey={(row) => row.id} />;
}

function candles(title: string, data: CandleData) {
  const { axis, format, volume } = data;
  type Candle = NonNullable<CandleData["candles"][number]>;
  const price = (id: string, header: string, pick: (candle: Candle) => string): Col<number> => ({
    id,
    header,
    min: FIGURE,
    figure: true,
    grow: true,
    cell: (i) => {
      const candle = data.candles[i];
      return figure(candle ? pick(candle) : null, format);
    },
  });
  const cols: Col<number>[] = [
    bucketCol(axis, data.forming),
    price("open", "Open", (candle) => candle.o),
    price("high", "High", (candle) => candle.h),
    price("low", "Low", (candle) => candle.l),
    price("close", "Close", (candle) => candle.c),
    { id: "volume", header: "Volume", min: FIGURE, figure: true, grow: true, cell: (i) => figure(data.candles[i]?.v ?? null, volume) },
    { id: "trades", header: "Trades", min: COUNT, figure: true, grow: true, cell: (i) => figure(data.candles[i]?.n ?? null) },
  ];
  const empty = !data.candles.some((candle) => candle);
  return <Grid title={title} cols={cols} rows={empty ? [] : newestFirst(axis.buckets.length)} rowKey={(i) => axis.buckets[i] ?? String(i)} />;
}

/**
 * The table view of every chart form (spec 2.5): a compact `DataTable`, 300 px high at most, named `title`, with the exact values as the
 * view builder made them. A form over time lists the newest bucket first, its date in UTC ("Oct 17, 2026, so far" while it runs, which the
 * candles' `forming` says too), one column for each series or panel and, for stacks, `totalLabel` after them. A bar list has its name, value,
 * share (when any item has one) and count; shares have the row, its total and a column for each segment; candles have open, high, low, close
 * (`formatPrice` text), volume and trades. A value that is missing is a dash that
 * screen readers hear as "no data"; with no value at all there are no rows and the table says "No data". The unit is not in a cell: the
 * title and the headings name it.
 */
export function ChartTable({ title, data, totalLabel = "Total" }: { title: string; data: TimeSeriesData | SmallMultiplesData | BarListData | ShareData | CandleData; totalLabel?: string }) {
  if ("series" in data) return timeSeries(title, data, totalLabel);
  if ("panels" in data) return smallMultiples(title, data);
  if ("items" in data) return barList(title, data);
  if ("rows" in data) return shares(title, data, totalLabel);
  return candles(title, data);
}
