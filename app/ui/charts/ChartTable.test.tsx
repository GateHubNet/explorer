import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ChartTable } from "./ChartTable";
import type { BarListData, CandleData, ShareData, SmallMultiplesData, TimeSeriesData } from "./types";

const days = ["2026-10-15", "2026-10-16", "2026-10-17"];

const stacked = (extra: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
  axis: { unit: "day", buckets: days },
  series: [
    { id: "payment", label: "Payment", slot: 1, values: ["1180220", "1204331", "810004"] },
    { id: "offer", label: "OfferCreate", slot: 2, values: ["520004", "431", "2"] },
  ],
  totals: ["1700224", "1204762", "810006"],
  format: { kind: "count" },
  token: "t",
  ...extra,
});

/** The text of every cell of every row, header row first. */
function grid(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll('[role="row"]')).map((row) =>
    Array.from(row.querySelectorAll('[role="columnheader"], [role="cell"]')).map((cell) => cell.textContent ?? ""),
  );
}

const headers = (container: HTMLElement) => grid(container)[0];
const body = (container: HTMLElement) => grid(container).slice(1);

describe("ChartTable of a time series", () => {
  it("lists the newest day first, one column per series and a total", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Transactions by type" data={stacked()} />);
    expect(headers(container)).toEqual(["Day (UTC)", "Payment", "OfferCreate", "Total"]);
    expect(body(container)).toEqual([
      ["Oct 17, 2026", "810,004", "2", "810,006"],
      ["Oct 16, 2026", "1,204,331", "431", "1,204,762"],
      ["Oct 15, 2026", "1,180,220", "520,004", "1,700,224"],
    ]);
    expect(errors).toEqual([]);
  });

  it("is a table named for the chart, in a compact region capped at 300 px", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Transactions by type" data={stacked()} />);
    const region = within(container).getByRole("region", { name: "Transactions by type, scrollable table" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect((region as HTMLElement).style.maxHeight).toBe("300px");
    expect(within(region).getByRole("table", { name: "Transactions by type" })).toBeTruthy();
    const rows = Array.from(region.querySelectorAll('[role="row"]'));
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.classList.contains("table--compact"))).toBe(true);
    expect(errors).toEqual([]);
  });

  it("gives the running day its words: so far", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Transactions by type" data={stacked({ forming: true })} />);
    expect(body(container).map((row) => row[0])).toEqual(["Oct 17, 2026, so far", "Oct 16, 2026", "Oct 15, 2026"]);
    expect(errors).toEqual([]);
  });

  it("writes a missing value as a dash that says no data to a screen reader", async () => {
    const data = stacked({
      series: [
        { id: "payment", label: "Payment", slot: 1, values: ["1180220", null, "810004"] },
        { id: "offer", label: "OfferCreate", slot: 2, values: ["520004", "431", "2"] },
      ],
      totals: ["1700224", null, "810006"],
    });
    const { container, errors } = await serverThenHydrated(<ChartTable title="Transactions by type" data={data} />);
    const row = Array.from(container.querySelectorAll('[role="row"]'))[2]!;
    const cells = Array.from(row.querySelectorAll('[role="cell"]'));
    expect(cells.map((cell) => cell.textContent)).toEqual(["Oct 16, 2026", "—no data", "431", "—no data"]);
    const gap = cells[1]!;
    expect(gap.querySelector("[aria-hidden=true]")!.textContent).toBe("—");
    expect(gap.querySelector(".sr")!.textContent).toBe("no data");
    expect(errors).toEqual([]);
  });

  it("heads a week axis Week of (UTC)", async () => {
    const data = stacked({ axis: { unit: "week", buckets: ["2026-09-28", "2026-10-05", "2026-10-12"] } });
    const { container, errors } = await serverThenHydrated(<ChartTable title="Transactions by type" data={data} />);
    expect(headers(container)![0]).toBe("Week of (UTC)");
    expect(body(container)[0]![0]).toBe("Oct 12, 2026");
    expect(errors).toEqual([]);
  });

  it("heads an hour axis Hour (UTC) and writes the hour in the cells", async () => {
    const data: TimeSeriesData = {
      axis: { unit: "hour", buckets: ["2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"] },
      series: [{ id: "fee", label: "Average fee", slot: 1, values: ["12", "13.5"] }],
      format: { kind: "drops", unit: "drops" },
      token: "t",
    };
    const { container, errors } = await serverThenHydrated(<ChartTable title="Average fee" data={data} />);
    expect(headers(container)).toEqual(["Hour (UTC)", "Average fee"]);
    expect(body(container)).toEqual([
      ["Oct 17, 2026, 17:00", "13.5"],
      ["Oct 17, 2026, 16:00", "12"],
    ]);
    expect(errors).toEqual([]);
  });

  it("has no total column unless totals are given", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Volume" data={stacked({ totals: undefined })} />);
    expect(headers(container)).toEqual(["Day (UTC)", "Payment", "OfferCreate"]);
    expect(errors).toEqual([]);
  });

  it("names the totals column as asked", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Money in and out" totalLabel="Net" data={stacked()} />);
    expect(headers(container)).toEqual(["Day (UTC)", "Payment", "OfferCreate", "Net"]);
    expect(errors).toEqual([]);
  });

  it("writes percents and seconds with their sign, and amounts exactly, with the unit left to the title", async () => {
    const data: TimeSeriesData = {
      axis: { unit: "day", buckets: ["2026-10-16", "2026-10-17"] },
      series: [{ id: "agree", label: "Agreement", slot: 1, values: ["99.31", "100"] }],
      format: { kind: "percent" },
      token: "t",
    };
    const percent = await serverThenHydrated(<ChartTable title="Agreement" data={data} />);
    expect(body(percent.container)).toEqual([["Oct 17, 2026", "100%"], ["Oct 16, 2026", "99.31%"]]);

    const amounts: TimeSeriesData = { ...data, series: [{ id: "v", label: "Payments", slot: 1, values: ["45512331.123456", "0"] }], format: { kind: "amount", unit: "XRP" } };
    const exact = await serverThenHydrated(<ChartTable title="Volume per day, in XRP" data={amounts} />);
    expect(body(exact.container)).toEqual([["Oct 17, 2026", "0"], ["Oct 16, 2026", "45,512,331.123456"]]);
    expect(percent.errors).toEqual([]);
    expect(exact.errors).toEqual([]);
  });

  it("says No data when every value is missing, and when there are no days", async () => {
    const empty = stacked({
      series: [
        { id: "payment", label: "Payment", slot: 1, values: [null, null, null] },
        { id: "offer", label: "OfferCreate", slot: 2, values: [null, null, null] },
      ],
      totals: [null, null, null],
    });
    const nothing = await serverThenHydrated(<ChartTable title="Transactions by type" data={empty} />);
    expect(nothing.container.querySelector(".table__empty")!.textContent).toBe("No data");
    expect(body(nothing.container)).toEqual([]);

    const noDays = await serverThenHydrated(<ChartTable title="Transactions by type" data={stacked({ axis: { unit: "day", buckets: [] }, series: [], totals: [] })} />);
    expect(noDays.container.querySelector(".table__empty")!.textContent).toBe("No data");
    expect(nothing.errors).toEqual([]);
    expect(noDays.errors).toEqual([]);
  });

  it("keeps a zero: it is a value", async () => {
    const data = stacked({ series: [{ id: "payment", label: "Payment", slot: 1, values: ["0", "0", "0"] }], totals: undefined });
    const { container } = await serverThenHydrated(<ChartTable title="Transactions by type" data={data} />);
    expect(body(container).map((row) => row[1])).toEqual(["0", "0", "0"]);
    expect(container.querySelector(".table__empty")).toBeNull();
  });
});

describe("ChartTable of small multiples", () => {
  const panels: SmallMultiplesData = {
    axis: { unit: "day", buckets: ["2026-10-16", "2026-10-17"] },
    panels: [
      { id: "xrp", label: "XRP", values: ["1000", "1200.5"], format: { kind: "amount", unit: "XRP" } },
      { id: "rlusd", label: "RLUSD", sublabel: "rMxCKb…m5De", values: ["12", null], format: { kind: "amount", unit: "RLUSD" } },
    ],
    token: "t",
  };

  it("has the bucket and one column per panel, headed by its label and sublabel", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Balance history" data={panels} />);
    expect(headers(container)).toEqual(["Day (UTC)", "XRP", "RLUSD rMxCKb…m5De"]);
    expect(body(container)).toEqual([
      ["Oct 17, 2026", "1,200.5", "—no data"],
      ["Oct 16, 2026", "1,000", "12"],
    ]);
    expect(errors).toEqual([]);
  });

  it("marks the sublabel apart from the label for sighted readers", async () => {
    const { container } = await serverThenHydrated(<ChartTable title="Balance history" data={panels} />);
    const head = Array.from(container.querySelectorAll('[role="columnheader"]'))[2]!;
    expect(head.querySelector(".chart__sub")!.textContent).toBe("rMxCKb…m5De");
  });

  it("says the newest day is so far when it is forming", async () => {
    const { container } = await serverThenHydrated(<ChartTable title="Balance history" data={{ ...panels, forming: true }} />);
    expect(body(container)[0]![0]).toBe("Oct 17, 2026, so far");
  });

  it("is capped and compact like the others", async () => {
    const { container } = await serverThenHydrated(<ChartTable title="Balance history" data={panels} />);
    expect((container.querySelector(".table-scroll") as HTMLElement).style.maxHeight).toBe("300px");
    expect(container.querySelectorAll(".table--compact")).toHaveLength(3);
  });
});

describe("ChartTable of a bar list", () => {
  const list: BarListData = {
    items: [
      { id: "xrp", label: "XRP", value: "1240000000.5", share: "58%", count: "812004" },
      { id: "usd", label: "USD", sublabel: "rhub8VR…aXq", value: "880000.25", share: "<1%" },
    ],
    format: { kind: "amount", unit: "XRP" },
    token: "t",
  };

  it("has the name, the exact value, the share and the count, in the order given", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Payment volume by currency" data={list} />);
    expect(headers(container)).toEqual(["Name", "Value", "Share", "Count"]);
    expect(body(container)).toEqual([
      ["XRP", "1,240,000,000.5", "58%", "812,004"],
      ["USD rhub8VR…aXq", "880,000.25", "<1%", "—no data"],
    ]);
    expect(errors).toEqual([]);
  });

  it("has no count column when no item has a count", async () => {
    const data: BarListData = { ...list, items: list.items.map(({ count: _count, ...item }) => item) };
    const { container } = await serverThenHydrated(<ChartTable title="Payment volume by currency" data={data} />);
    expect(headers(container)).toEqual(["Name", "Value", "Share"]);
  });

  it("says No data for no items", async () => {
    const { container } = await serverThenHydrated(<ChartTable title="Payment volume by currency" data={{ ...list, items: [] }} />);
    expect(container.querySelector(".table__empty")!.textContent).toBe("No data");
  });

  // A list whose tip is the count (`tip="count"`) has no share to write.
  it("has no share column when no item has a share, and the count is there", async () => {
    const data: BarListData = {
      items: [
        { id: "a", label: "rJF2Xa…fQvg", value: "6100000", count: "312", href: "/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg" },
        { id: "b", label: "rN7n7o…2Rh", value: "950000.5", count: "1" },
      ],
      format: { kind: "amount", unit: "XRP" },
      token: "t",
    };
    const { container, errors } = await serverThenHydrated(<ChartTable title="Most active traders" data={data} />);
    expect(headers(container)).toEqual(["Name", "Value", "Count"]);
    expect(body(container)).toEqual([
      ["rJF2Xa…fQvg", "6,100,000", "312"],
      ["rN7n7o…2Rh", "950,000.5", "1"],
    ]);
    expect(errors).toEqual([]);
  });

  it("keeps the share column when some item has a share, and a dash that says no data for the one that has none", async () => {
    const data: BarListData = { ...list, items: [list.items[0]!, { id: "eur", label: "EUR", value: "5", count: "2" }] };
    const { container } = await serverThenHydrated(<ChartTable title="Payment volume by currency" data={data} />);
    expect(headers(container)).toEqual(["Name", "Value", "Share", "Count"]);
    expect(body(container)).toEqual([
      ["XRP", "1,240,000,000.5", "58%", "812,004"],
      ["EUR", "5", "—no data", "2"],
    ]);
  });
});

describe("ChartTable of shares", () => {
  const shares: ShareData = {
    rows: [
      {
        id: "unl",
        label: "On the UNL",
        total: "35",
        segments: [
          { id: "v3", label: "3.0.0", slot: 1, value: "30" },
          { id: "v2", label: "2.6.1", slot: 2, value: "5" },
        ],
      },
      {
        id: "all",
        label: "All validators",
        total: "120",
        segments: [
          { id: "v3", label: "3.0.0", slot: 1, value: "70" },
          { id: "v2", label: "2.6.1", slot: 2, value: "40" },
          { id: "v1", label: "2.5.0", slot: 3, value: "10" },
        ],
      },
    ],
    token: "t",
  };

  it("has the row, its total, then a column for each segment", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="Software versions" data={shares} />);
    expect(headers(container)).toEqual(["Name", "Total", "3.0.0", "2.6.1", "2.5.0"]);
    expect(body(container)).toEqual([
      ["On the UNL", "35", "30", "5", "—no data"],
      ["All validators", "120", "70", "40", "10"],
    ]);
    expect(errors).toEqual([]);
  });

  it("names the total as asked", async () => {
    const { container } = await serverThenHydrated(<ChartTable title="Software versions" totalLabel="Validators" data={shares} />);
    expect(headers(container)!.slice(0, 2)).toEqual(["Name", "Validators"]);
  });
});

describe("ChartTable of candles", () => {
  const candles: CandleData = {
    axis: { unit: "day", buckets: ["2026-10-15", "2026-10-16", "2026-10-17"] },
    candles: [
      { o: "0.5", h: "0.6", l: "0.45", c: "0.55", v: "1000000", n: "812" },
      null,
      { o: "0.55", h: "0.58", l: "0.52", c: "0.53", v: "250000.5", n: "90" },
    ],
    format: { kind: "price", unit: "USD" },
    volume: { kind: "amount", unit: "XRP" },
    token: "t",
  };

  it("has the bucket, open, high, low, close, volume and trades, newest first", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="XRP/USD" data={candles} />);
    expect(headers(container)).toEqual(["Day (UTC)", "Open", "High", "Low", "Close", "Volume", "Trades"]);
    expect(body(container)).toEqual([
      ["Oct 17, 2026", "0.55", "0.58", "0.52", "0.53", "250,000.5", "90"],
      ["Oct 16, 2026", "—no data", "—no data", "—no data", "—no data", "—no data", "—no data"],
      ["Oct 15, 2026", "0.5", "0.6", "0.45", "0.55", "1,000,000", "812"],
    ]);
    expect(errors).toEqual([]);
  });

  it("says No data when no candle exists", async () => {
    const { container } = await serverThenHydrated(<ChartTable title="XRP/USD" data={{ ...candles, candles: [null, null, null] }} />);
    expect(container.querySelector(".table__empty")!.textContent).toBe("No data");
  });

  it("says so far in the cell of the newest bucket when the candles are forming, and in no other", async () => {
    const { container, errors } = await serverThenHydrated(<ChartTable title="XRP/USD" data={{ ...candles, forming: true }} />);
    expect(body(container).map((row) => row[0])).toEqual(["Oct 17, 2026, so far", "Oct 16, 2026", "Oct 15, 2026"]);
    expect(errors).toEqual([]);
    const closed = await serverThenHydrated(<ChartTable title="XRP/USD" data={{ ...candles, forming: false }} />);
    expect(body(closed.container).map((row) => row[0])).toEqual(["Oct 17, 2026", "Oct 16, 2026", "Oct 15, 2026"]);
  });

  it("says so far in an hour or a week cell, and heads a 15-minute axis Time (UTC) with the day and time in the cells", async () => {
    const hourly: CandleData = { ...candles, axis: { unit: "hour", buckets: ["2026-10-17T15:00:00Z", "2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"] }, forming: true };
    const hours = await serverThenHydrated(<ChartTable title="XRP/USD" data={hourly} />);
    expect(headers(hours.container)![0]).toBe("Hour (UTC)");
    expect(body(hours.container)[0]![0]).toBe("Oct 17, 2026, 17:00, so far");
    const quarters: CandleData = { ...hourly, axis: { unit: "minute", buckets: ["2026-10-17T16:30:00Z", "2026-10-17T16:45:00Z", "2026-10-17T17:00:00Z"] } };
    const minutes = await serverThenHydrated(<ChartTable title="XRP/USD" data={quarters} />);
    expect(headers(minutes.container)![0]).toBe("Time (UTC)");
    expect(body(minutes.container).map((row) => row[0])).toEqual(["Oct 17, 2026, 17:00, so far", "Oct 17, 2026, 16:45", "Oct 17, 2026, 16:30"]);
    const weekly: CandleData = { ...candles, axis: { unit: "week", buckets: ["2026-09-28", "2026-10-05", "2026-10-12"] }, forming: true };
    const weeks = await serverThenHydrated(<ChartTable title="XRP/USD" data={weekly} />);
    expect(body(weeks.container)[0]![0]).toBe("Oct 12, 2026, so far");
  });

  it("writes the prices with formatPrice (8 significant digits, no trailing zeros, no exponent) and the volume in full", async () => {
    const data: CandleData = {
      ...candles,
      candles: [
        { o: "0.40990000", h: "0.42500000", l: "0.4", c: "1.2345678e+8", v: "1.5e+6", n: "1204" },
        null,
        { o: "2.43934999", h: "12345.678912", l: "1e-10", c: "0.000123456789", v: "250000.5", n: "90" },
      ],
    };
    const { container, errors } = await serverThenHydrated(<ChartTable title="XRP/USD" data={data} />);
    expect(body(container)).toEqual([
      ["Oct 17, 2026", "2.43935", "12,345.679", "0.0000000001", "0.00012345679", "250,000.5", "90"],
      ["Oct 16, 2026", "—no data", "—no data", "—no data", "—no data", "—no data", "—no data"],
      ["Oct 15, 2026", "0.4099", "0.425", "0.4", "123,456,780", "1,500,000", "1,204"],
    ]);
    expect(errors).toEqual([]);
  });
});

describe("ChartTable widths", () => {
  it("scrolls inside its card below a width that holds every column", async () => {
    const { container } = await serverThenHydrated(<ChartTable title="Transactions by type" data={stacked()} />);
    const table = container.querySelector<HTMLElement>('[role="table"]')!;
    const tracks = table.style.getPropertyValue("--cols").split(/\s+(?![^(]*\))/);
    expect(tracks).toHaveLength(4);
    const minimum = (track: string) => Number(/(\d+)px/.exec(track)![1]);
    // The tracks, the 12 px gaps between them and the 12 px of padding on both sides of a compact row.
    expect(Number.parseInt(table.style.minWidth)).toBeGreaterThanOrEqual(tracks.reduce((sum, track) => sum + minimum(track), 0) + 3 * 12 + 24);
  });
});
