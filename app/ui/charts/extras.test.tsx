import { fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ChartTable } from "./ChartTable";
import { ColumnChart } from "./ColumnChart";
import { LineChart } from "./LineChart";
import { legendOf } from "./Legend";
import type { TimeAxis, TimeSeriesData, TimeSeriesExtra } from "./types";

// `TimeSeriesData.extras` (E4's growth of the kit, spec section 3.2): per-bucket figures that the tooltip, the slider and the table say and
// no mark draws. The contract holds on every form that takes `TimeSeriesData` and on every axis unit, so this file runs each of them the
// way the browser meets them: printed by the Worker, then hydrated.

const TITLE = "Transactions";
const BOX = { left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/** Two buckets of each unit, oldest first, with the words the tooltip and the slider give the newest. */
const UNITS: Record<TimeAxis["unit"], { buckets: string[]; newest: string; heading: string; oldest: string }> = {
  day: { buckets: ["2026-10-15", "2026-10-16"], newest: "Oct 16, 2026", oldest: "Oct 15, 2026", heading: "Day (UTC)" },
  week: { buckets: ["2026-10-05", "2026-10-12"], newest: "Week of Oct 12, 2026", oldest: "Oct 5, 2026", heading: "Week of (UTC)" },
  month: { buckets: ["2026-09-01", "2026-10-01"], newest: "Oct 2026", oldest: "Sep 2026", heading: "Month (UTC)" },
  hour: { buckets: ["2026-10-16T16:00:00Z", "2026-10-16T17:00:00Z"], newest: "Oct 16, 2026, 17:00", oldest: "Oct 16, 2026, 16:00", heading: "Hour (UTC)" },
  minute: { buckets: ["2026-10-16T17:00:00Z", "2026-10-16T17:15:00Z"], newest: "Oct 16, 2026, 17:15", oldest: "Oct 16, 2026, 17:00", heading: "Time (UTC)" },
  flag: { buckets: ["2026-10-15T17:01:10Z", "2026-10-16T17:01:10Z"], newest: "Oct 16, 2026, 17:01 UTC", oldest: "Oct 15, 2026, 17:01 UTC", heading: "Flag ledger (UTC)" },
};
const unitNames = Object.keys(UNITS) as TimeAxis["unit"][];

interface Form {
  name: string;
  /** How many series the data has, and whether it has totals (which the table gives a column). */
  series: number;
  totals: boolean;
  diverging?: boolean;
  chart: (data: TimeSeriesData) => ReactElement;
  data?: Partial<TimeSeriesData>;
}

const FORMS: Form[] = [
  { name: "ColumnChart single", series: 1, totals: false, chart: (data) => <ColumnChart layout="single" title={TITLE} data={data} /> },
  { name: "ColumnChart stacked", series: 2, totals: true, chart: (data) => <ColumnChart layout="stacked" title={TITLE} data={data} /> },
  { name: "ColumnChart diverging", series: 2, totals: true, diverging: true, chart: (data) => <ColumnChart layout="diverging" title={TITLE} data={data} /> },
  { name: "LineChart", series: 2, totals: false, chart: (data) => <LineChart title={TITLE} data={data} /> },
  { name: "LineChart area", series: 1, totals: false, chart: (data) => <LineChart title={TITLE} data={data} area /> },
  { name: "LineChart with a domain", series: 1, totals: false, data: { domain: { min: "0", max: "20" } }, chart: (data) => <LineChart title={TITLE} data={data} /> },
  { name: "LineChart step", series: 1, totals: false, chart: (data) => <LineChart title={TITLE} data={data} curve="step" /> },
];

const SERIES = [
  { id: "payment", label: "Payment", slot: 1 as const, values: ["8", "10"] },
  { id: "offer", label: "OfferCreate", slot: 2 as const, values: ["3", "2"] },
];

/** What a view builder hands over for `form` on an axis of `unit`: 12 (or a net of 8) in the newest bucket, the extras as given. */
function dataOf(form: Form, unit: TimeAxis["unit"], extras?: TimeSeriesExtra[]): TimeSeriesData {
  const series = SERIES.slice(0, form.series);
  return {
    axis: { unit, buckets: UNITS[unit].buckets },
    series: form.diverging ? [{ ...series[0]!, slot: "up" }, { ...series[1]!, slot: "down" }] : series,
    totals: form.totals ? (form.diverging ? ["5", "8"] : ["11", "12"]) : undefined,
    format: { kind: "count", unit: "transactions" },
    token: "t",
    ...form.data,
    ...(extras ? { extras } : {}),
  };
}

const slider = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="slider"]')!;
const tip = (container: HTMLElement) => container.querySelector<HTMLElement>(".plot__tip")!;
/** The pointer on bucket `i` of 2: the left or the right end of the plot, which both placements read as the first or the last bucket. */
function pointAt(container: HTMLElement, i: 0 | 1) {
  vi.spyOn(container.querySelector<HTMLElement>(".plot")!, "getBoundingClientRect").mockReturnValue(BOX);
  fireEvent.pointerMove(slider(container), { clientX: i === 0 ? 100 : 900, pointerType: "mouse" });
}

/** The text of every cell of every row, header row first. */
function grid(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll('[role="row"]')).map((row) =>
    Array.from(row.querySelectorAll('[role="columnheader"], [role="cell"]')).map((cell) => cell.textContent ?? ""),
  );
}

const FAILED: TimeSeriesExtra = { id: "failed", label: "Failed", values: ["0", "1"] };

describe.each(FORMS)("extras on $name", (form) => {
  it.each(unitNames)("show in the tooltip, to the slider and in the table, on a %s axis", async (unit) => {
    const data = dataOf(form, unit, [FAILED]);
    const { container, errors } = await serverThenHydrated(form.chart(data));
    pointAt(container, 1);

    // The tooltip: after everything else, the value strong, the label muted and lowered, and no key.
    const row = tip(container).lastElementChild!;
    expect(row.className).toBe("plot__tip-row");
    expect(row.querySelector("b")!.textContent).toBe("1");
    expect(row.querySelector(".plot__tip-name")!.textContent).toBe("failed");
    expect(row.textContent).toBe("1 failed");
    expect(row.querySelector(".plot__tip-key")).toBeNull();
    expect(Array.from(tip(container).querySelectorAll(".plot__tip-key"))).toHaveLength(form.series);

    // The slider says it after the series, as it says a series.
    const text = slider(container).getAttribute("aria-valuetext")!;
    expect(text.startsWith(`${UNITS[unit].newest}: `)).toBe(true);
    expect(text.endsWith("; Failed 1")).toBe(true);

    // The table: a column after the series (and the total), newest first.
    const table = await serverThenHydrated(<ChartTable title={TITLE} data={data} />);
    const [head, ...rows] = grid(table.container);
    expect(head).toEqual([UNITS[unit].heading, ...data.series.map((s) => s.label), ...(form.totals ? ["Total"] : []), "Failed"]);
    expect(rows.map((r) => r.at(-1))).toEqual(["1", "0"]);
    expect(rows.map((r) => r[0])).toEqual([UNITS[unit].newest.replace("Week of ", ""), UNITS[unit].oldest]);

    expect(errors).toEqual([]);
    expect(table.errors).toEqual([]);
  });

  it("say a missing value as a dash in the tooltip and the table and as no data to the slider", async () => {
    const data = dataOf(form, "day", [{ id: "failed", label: "Failed", values: ["0", null] }]);
    const { container, errors } = await serverThenHydrated(form.chart(data));
    pointAt(container, 1);
    expect(tip(container).lastElementChild!.textContent).toBe("— failed");
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Failed no data")).toBe(true);

    const table = await serverThenHydrated(<ChartTable title={TITLE} data={data} />);
    const [newest, oldest] = grid(table.container).slice(1);
    expect(newest!.at(-1)).toBe("—no data");
    expect(oldest!.at(-1)).toBe("0");
    expect(errors).toEqual([]);
  });

  it("are not part of the scales, the legend or the plot summary", async () => {
    const plain = dataOf(form, "day");
    const loud = dataOf(form, "day", [{ id: "big", label: "Big", values: ["999999999", "888888888"], format: { kind: "count" } }]);
    const without = await serverThenHydrated(form.chart(plain));
    const given = await serverThenHydrated(form.chart(loud));
    const ticks = (container: HTMLElement) => Array.from(container.querySelectorAll(".plot__y > *"), (tick) => tick.textContent);
    expect(ticks(given.container)).toEqual(ticks(without.container));
    expect(ticks(given.container).length).toBeGreaterThan(1);
    expect(legendOf(loud, "swatch")).toEqual(legendOf(plain, "swatch"));
    const summary = (container: HTMLElement) => container.querySelector('[role="img"]')!.getAttribute("aria-label");
    expect(summary(given.container)).toBe(summary(without.container));
    expect(summary(given.container)!.length).toBeGreaterThan(0);
    // Nor are they drawn: the marks are the same.
    expect(given.container.querySelector(".plot__marks-in")!.innerHTML).toBe(without.container.querySelector(".plot__marks-in")!.innerHTML);
    expect(without.errors).toEqual([]);
    expect(given.errors).toEqual([]);
  });
});

describe("the tooltip of an extra", () => {
  const chart = (extras: TimeSeriesExtra[], over: Partial<TimeSeriesData> = {}) => (
    <ColumnChart layout="stacked" title={TITLE} data={{ ...dataOf(FORMS[1]!, "day", extras), ...over }} />
  );

  it("is the value strong and the label muted by default and with tooltip value-label: the same row", async () => {
    for (const tooltip of [undefined, "value-label" as const]) {
      const { container, errors } = await serverThenHydrated(chart([{ ...FAILED, ...(tooltip ? { tooltip } : {}) }]));
      pointAt(container, 1);
      const row = tip(container).lastElementChild!;
      expect(row.innerHTML).toBe('<b>1</b> <span class="plot__tip-name">failed</span>');
      expect(errors).toEqual([]);
    }
  });

  it("lowers the first letter of a capital followed by a lower-case letter, and no other", async () => {
    const extras = [
      { id: "a", label: "Failed", values: ["0", "1"] },
      { id: "b", label: "RLUSD fees", values: ["0", "2"] },
      { id: "c", label: "Fees, est., XRP", values: ["0", "3"] },
      { id: "d", label: "XRP", values: ["0", "4"] },
      { id: "e", label: "net", values: ["0", "5"] },
      { id: "f", label: "A", values: ["0", "6"] },
    ];
    const { container, errors } = await serverThenHydrated(chart(extras));
    pointAt(container, 1);
    const rows = Array.from(tip(container).querySelectorAll(".plot__tip-row")).slice(2);
    expect(rows.map((row) => row.textContent)).toEqual(["1 failed", "2 RLUSD fees", "3 fees, est., XRP", "4 XRP", "5 net", "6 A"]);
    expect(errors).toEqual([]);
  });

  it("is the value text alone with tooltip value, and the slider still says the label", async () => {
    const ledgers: TimeSeriesExtra = { id: "ledgers", label: "Ledgers", values: ["1 missed of 22,100 validated ledgers", "4 missed of 22,096 validated ledgers"], tooltip: "value" };
    const { container, errors } = await serverThenHydrated(chart([ledgers]));
    pointAt(container, 1);
    const row = tip(container).lastElementChild!;
    expect(row.textContent).toBe("4 missed of 22,096 validated ledgers");
    expect(row.querySelector(".plot__tip-name")).toBeNull();
    expect(row.querySelector(".plot__tip-key")).toBeNull();
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Ledgers 4 missed of 22,096 validated ledgers")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("is a dash alone with tooltip value and no value", async () => {
    const { container, errors } = await serverThenHydrated(chart([{ id: "ledgers", label: "Ledgers", values: ["x", null], tooltip: "value" }]));
    pointAt(container, 1);
    expect(tip(container).lastElementChild!.textContent).toBe("—");
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Ledgers no data")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("lists the extras in their order, after the series and the total of a stack", async () => {
    const { container, errors } = await serverThenHydrated(chart([FAILED, { id: "net", label: "Net", values: ["+1", "+8"] }]));
    pointAt(container, 1);
    const children = Array.from(tip(container).children, (child) => child.textContent);
    expect(children).toEqual(["Oct 16, 2026", "10 Payment", "2 OfferCreate", "12 total", "1 failed", "+8 net"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 16, 2026: 12 transactions; Payment 10; OfferCreate 2; Failed 1; Net +8");
    expect(errors).toEqual([]);
  });

  it("comes after the net of a diverging chart too", async () => {
    const data: TimeSeriesData = { ...dataOf(FORMS[2]!, "day", [FAILED]), format: { kind: "amount", unit: "XRP" } };
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="diverging" title={TITLE} data={data} />);
    pointAt(container, 1);
    expect(Array.from(tip(container).children, (child) => child.textContent)).toEqual(["Oct 16, 2026", "10 XRP Payment", "2 XRP OfferCreate", "Net 8 XRP", "1 failed"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 16, 2026: Payment 10 XRP; OfferCreate 2 XRP; Net 8 XRP; Failed 1");
    expect(errors).toEqual([]);
  });

  it("comes before the annotations, which stay last", async () => {
    const { container, errors } = await serverThenHydrated(chart([FAILED], { annotations: [{ bucket: 1, symbol: "×", label: "has a failed transaction" }] }));
    pointAt(container, 1);
    expect(Array.from(tip(container).children, (child) => child.textContent).slice(-2)).toEqual(["1 failed", "× has a failed transaction"]);
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Failed 1; has a failed transaction")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("is not said for a bucket with no value in any series: the gap's own words stand alone", async () => {
    const data = { ...dataOf(FORMS[1]!, "day", [FAILED]), series: SERIES.map((s) => ({ ...s, values: [s.values[0]!, null] })), totals: ["11", null] };
    const { container, errors } = await serverThenHydrated(<ColumnChart layout="stacked" title={TITLE} data={data} />);
    pointAt(container, 1);
    expect(Array.from(tip(container).children, (child) => child.textContent)).toEqual(["No data for Oct 16"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("Oct 16, 2026: no data");
    expect(errors).toEqual([]);
  });
});

describe("the values of an extra", () => {
  const chart = (extras: TimeSeriesExtra[]) => <LineChart title={TITLE} data={dataOf(FORMS[3]!, "day", extras)} />;

  it("are the text as given without a format, in the tooltip, the slider and the table", async () => {
    const data = dataOf(FORMS[3]!, "day", [{ id: "raw", label: "Raw", values: ["0", "1284331"] }]);
    const { container, errors } = await serverThenHydrated(<LineChart title={TITLE} data={data} />);
    pointAt(container, 1);
    expect(tip(container).lastElementChild!.textContent).toBe("1284331 raw");
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Raw 1284331")).toBe(true);
    const table = await serverThenHydrated(<ChartTable title={TITLE} data={data} />);
    expect(grid(table.container)[1]!.at(-1)).toBe("1284331");
    expect(errors).toEqual([]);
  });

  it("go through the kind count: in full in the tooltip and the slider, and in the table", async () => {
    const swaps: TimeSeriesExtra = { id: "swaps", label: "Swaps", values: ["7", "1284331"], format: { kind: "count" } };
    const { container, errors } = await serverThenHydrated(chart([swaps]));
    pointAt(container, 1);
    expect(tip(container).lastElementChild!.textContent).toBe("1,284,331 swaps");
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Swaps 1,284,331")).toBe(true);
    const table = await serverThenHydrated(<ChartTable title={TITLE} data={dataOf(FORMS[3]!, "day", [swaps])} />);
    expect(grid(table.container)[1]!.at(-1)).toBe("1,284,331");
    expect(errors).toEqual([]);
  });

  it("go through the kind amount: the kit's compact text with the unit in the tooltip and the slider, the full text in the table", async () => {
    const volume: TimeSeriesExtra = { id: "usd", label: "Volume", values: ["1", "1234.5678"], format: { kind: "amount", unit: "USD" } };
    const { container, errors } = await serverThenHydrated(chart([volume]));
    pointAt(container, 1);
    expect(tip(container).lastElementChild!.textContent).toBe("1,234.57 USD volume");
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Volume 1,234.57 USD")).toBe(true);
    const table = await serverThenHydrated(<ChartTable title={TITLE} data={dataOf(FORMS[3]!, "day", [volume])} />);
    expect(grid(table.container)[1]!.at(-1)).toBe("1,234.5678");
    expect(errors).toEqual([]);
  });

  it("go through the kind value: compact with the unit in the tooltip, formatValue in the table", async () => {
    const worth: TimeSeriesExtra = { id: "worth", label: "Worth", values: ["1", "16787.149"], format: { kind: "value", unit: "XRP" } };
    const { container, errors } = await serverThenHydrated(chart([worth]));
    pointAt(container, 1);
    expect(tip(container).lastElementChild!.textContent).toBe("16.8K XRP worth");
    expect(slider(container).getAttribute("aria-valuetext")!.endsWith("; Worth 16.8K XRP")).toBe(true);
    const table = await serverThenHydrated(<ChartTable title={TITLE} data={dataOf(FORMS[3]!, "day", [worth])} />);
    expect(grid(table.container)[1]!.at(-1)).toBe("16,787.15");
    expect(errors).toEqual([]);
  });
});
