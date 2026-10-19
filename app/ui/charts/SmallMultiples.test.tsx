import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ChartCard } from "./ChartCard";
import { ChartTable } from "./ChartTable";
import { fractionOf, linePath, niceScale, percent, xOf } from "./geometry";
import { SmallMultiples } from "./SmallMultiples";
import type { SmallMultiplesData, TimeAxis } from "./types";

// These tests are about what the cursor does, not about when it arrives: a plot's layer is the cursor itself here. That hides the layer a plot has until
// a pointer or the keyboard reaches it, and how the other plots of a group get their cursor from the first one's: CursorSlot.test.tsx has both, with
// the real slot (a bare plot, a pointer, a focus and keys while it loads, small multiples and candles).
vi.mock("./CursorSlot", async () => ({ CursorSlot: (await vi.importActual<typeof import("./Cursor")>("./Cursor")).Cursor }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Small multiples (spec 2.3 and 2.11, program ruling R11): a grid of one-series panels from `SmallMultiplesData`. Every panel is a line in
// slot 1 with a scale of its own, 3 ticks, and its label, sublabel and a readout in its header; the x labels are at the two ends; one
// `HoverGroup` gives the panels one bucket, each draws its crosshair and its dot, and the panel with the pointer has the tooltip.

const TITLE = "Balance history, per currency";

/** 30 days, Sep 17 to Oct 16, 2026: bucket 15 is Oct 2 and bucket 29 is Oct 16. */
const day = (i: number) => new Date(Date.UTC(2026, 8, 17 + i)).toISOString().slice(0, 10);
const AXIS: TimeAxis = { unit: "day", buckets: Array.from({ length: 30 }, (_, i) => day(i)) };

/** 10M to 11.45M, and 12.1M on the last day: the scale is 0 to 20M by 10M. */
const XRP = AXIS.buckets.map((_, i) => (i === 29 ? "12100000" : String(10_000_000 + i * 50_000)));
/** 500 to 1,200, and no value on the last day: the scale is 0 to 2,000 by 1,000. */
const RLUSD = AXIS.buckets.map((_, i) => (i === 29 ? null : String(500 + i * 25)));

function panels(extra: Partial<SmallMultiplesData> = {}): SmallMultiplesData {
  return {
    axis: AXIS,
    panels: [
      { id: "xrp", label: "XRP", values: XRP, format: { kind: "amount", unit: "XRP" } },
      { id: "rlusd", label: "RLUSD", sublabel: "rMxCKb…m5De", values: RLUSD, format: { kind: "amount", unit: "RLUSD" } },
    ],
    token: "b1",
    ...extra,
  };
}

const panelEls = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".panel"));
const texts = (nodes: ArrayLike<Element>) => Array.from(nodes, (node) => node.textContent);
const yLabels = (panel: HTMLElement) => texts(panel.querySelector(".plot__y")!.children);
const readouts = (container: HTMLElement) => texts(container.querySelectorAll(".panel__value"));
const sliders = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]'));
const tips = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".plot__tip"));
/** What a tooltip says: its date, then one text for each row and each note. */
const lines = (tip: HTMLElement) => Array.from(tip.querySelectorAll(".plot__tip-date, .plot__tip-row, .plot__tip-note"), (line) => line.textContent);

const BOX = { left: 0, top: 0, right: 1000, bottom: 110, width: 1000, height: 110, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/** The page as the Worker prints it and the browser takes it over, with every plot 1000 px wide. */
async function mounted(ui: ReactElement) {
  const result = await serverThenHydrated(ui);
  for (const plot of result.container.querySelectorAll<HTMLElement>(".plot")) vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(BOX);
  return result;
}

const mouse = (clientX: number) => ({ clientX, pointerType: "mouse" });

describe("SmallMultiples as the Worker prints it and the browser takes it over", () => {
  it("draws a panel for each of the data's panels in a grid, each with its heading, a plot of its own and no slider in the HTML", async () => {
    const { html, container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    expect(html).not.toContain('role="slider"');
    expect(container.querySelectorAll(".multiples")).toHaveLength(1);
    const items = panelEls(container);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.parentElement!.classList.contains("multiples"))).toBe(true);
    expect(items.map((item) => item.querySelector(".panel__name")!.firstChild!.textContent!.trim())).toEqual(["XRP", "RLUSD"]);
    expect(items.every((item) => item.querySelectorAll(".plot").length === 1)).toBe(true);
    expect(errors).toEqual([]);
  });

  it("puts the label in the header with its sublabel after it, which is marked apart from the label", async () => {
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    const [xrp, rlusd] = panelEls(container);
    expect(xrp!.querySelector(".panel__name")!.textContent!.trim()).toBe("XRP");
    expect(xrp!.querySelector(".panel__name .chart__sub")).toBeNull();
    expect(rlusd!.querySelector(".panel__name")!.textContent).toBe("RLUSD rMxCKb…m5De");
    expect(rlusd!.querySelector(".panel__name .chart__sub")!.textContent).toBe("rMxCKb…m5De");
    // The label is a heading, one level under the card's title.
    expect(rlusd!.querySelector(".panel__name")!.tagName).toBe("H3");
    expect(rlusd!.querySelector(".panel__head")!.contains(rlusd!.querySelector(".panel__value"))).toBe(true);
  });

  it("gives every panel a scale of its own with 3 ticks, from 0: XRP in tens of millions, RLUSD in thousands", async () => {
    const { container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    const [xrp, rlusd] = panelEls(container);
    expect(yLabels(xrp!)).toEqual(["0", "10M", "20M"]);
    expect(yLabels(rlusd!)).toEqual(["0", "1,000", "2,000"]);
    expect(xrp!.querySelectorAll(".plot__grid")).toHaveLength(3);
    expect(rlusd!.querySelectorAll(".plot__grid")).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it("draws each panel's line against its own scale, in a box that is 110 high, in slot 1, with an end dot", async () => {
    const { container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    const [xrp, rlusd] = panelEls(container);
    const scales = [niceScale(XRP.map(Number), { ticks: 3 }), niceScale(RLUSD.map((v) => (v === null ? null : Number(v))), { ticks: 3 })];
    expect(scales.map((scale) => scale.ticks)).toEqual([[0, 10_000_000, 20_000_000], [0, 1000, 2000]]);
    for (const [k, item] of [xrp!, rlusd!].entries()) {
      const values = k === 0 ? XRP : RLUSD;
      const path = item.querySelector("path.line")!;
      expect(path.getAttribute("data-slot"), String(k)).toBe("1");
      expect(path.getAttribute("d"), String(k)).toBe(
        linePath(values.map((v) => (v === null ? null : fractionOf(Number(v), scales[k]!))), { height: 110, placement: "points" }),
      );
      expect(item.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 1000 110");
      expect(item.querySelector("svg")!.getAttribute("preserveAspectRatio")).toBe("none");
      expect(item.querySelector(".plot__frame")!.classList.contains("plot__frame--panel")).toBe(true);
    }
    // The end dots: XRP at its last day, RLUSD at the last day that has a value.
    expect(xrp!.querySelector<HTMLElement>(".plot__marks .plot__dot")!.style.left).toBe("100%");
    expect(rlusd!.querySelector<HTMLElement>(".plot__marks .plot__dot")!.style.left).toBe(percent(xOf(28, 30, "points")));
    for (const dot of container.querySelectorAll(".plot__marks .plot__dot")) expect(dot.getAttribute("data-slot")).toBe("1");
    expect(errors).toEqual([]);
  });

  it("draws every panel in slot 1, and none with end labels: the header says the value", async () => {
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    expect(Array.from(container.querySelectorAll("[data-slot]"), (el) => el.getAttribute("data-slot"))).toEqual(["1", "1", "1", "1"]);
    expect(container.querySelector(".plot__end")).toBeNull();
    expect(container.querySelector(".ref")).toBeNull();
    expect(container.querySelector("path.area")).toBeNull();
  });

  it("reaches below 0 for a value that is below it: a tick at or below −50, and the 0 line as the base", async () => {
    const owing = AXIS.buckets.map((_, i) => (i === 3 ? "-50" : i === 29 ? "120" : "20"));
    const data = panels({ panels: [{ id: "usd", label: "USD", sublabel: "rhub8V…KRpz", values: owing, format: { kind: "amount", unit: "USD" } }] });
    const { container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={data} />);
    const labels = yLabels(panelEls(container)[0]!);
    const ticks = labels.map((label) => Number(label!.replace("−", "-")));
    expect(Math.min(...ticks)).toBeLessThanOrEqual(-50);
    expect(ticks).toContain(0);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(120);
    expect([3, 4]).toContain(ticks.length);
    // −100, 0, 100, 200: the 0 line is a third of the way up, and is the one drawn as the base.
    expect(labels).toEqual(["−100", "0", "100", "200"]);
    const base = container.querySelector<HTMLElement>(".plot__grid.is-base")!;
    expect(base.style.bottom).toBe("33.33%");
    expect(container.querySelectorAll(".plot__grid.is-base")).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("labels the x axis at its two ends only, in one set that is shown at any width", async () => {
    const { html, container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    expect(html).not.toContain("plot__x--wide");
    expect(html).not.toContain("plot__x--narrow");
    for (const item of panelEls(container)) {
      expect(item.querySelectorAll(".plot__x")).toHaveLength(1);
      expect(texts(item.querySelector(".plot__x--ends")!.children)).toEqual(["Sep 17", "Oct 16"]);
    }
    expect(errors).toEqual([]);
  });

  it("draws at most 6 panels, in the order given", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, label: `Asset ${i}`, values: XRP, format: { kind: "amount", unit: "XRP" } as const }));
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels({ panels: many })} />);
    expect(panelEls(container)).toHaveLength(6);
    expect(texts(container.querySelectorAll(".panel__name"))).toEqual(["Asset 0", "Asset 1", "Asset 2", "Asset 3", "Asset 4", "Asset 5"]);
  });

  it("names each panel's image and slider for the chart and the panel, so that the panels can be told apart", async () => {
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    expect(Array.from(container.querySelectorAll('[role="img"]'), (img) => img.getAttribute("aria-label"))).toEqual([
      "Balance history, per currency, XRP, Sep 17 to Oct 16, 2026. Highest Oct 16, 12.1M XRP; latest Oct 16, 12.1M XRP. Choose Table for every value.",
      "Balance history, per currency, RLUSD, Sep 17 to Oct 16, 2026. Highest Oct 15, 1,200 RLUSD; latest Oct 15, 1,200 RLUSD. Choose Table for every value.",
    ]);
    expect(sliders(container).map((control) => control.getAttribute("aria-label"))).toEqual([
      "Balance history, per currency, XRP, day by day",
      "Balance history, per currency, RLUSD, day by day",
    ]);
  });
});

describe("SmallMultiples' readout", () => {
  it("is the newest value of a panel to begin with, and the newest one that there is when the last buckets are null", async () => {
    const { html, container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    expect(readouts(container)).toEqual(["12.1M XRP", "1,200 RLUSD"]);
    // It is in the HTML the Worker prints: it is not something the script adds.
    expect(html).toContain("12.1M XRP");
    expect(html).toContain("1,200 RLUSD");
  });

  it("follows the pointer in any panel: both panels read the bucket under it, and go back to the newest when it leaves", async () => {
    const { container, errors } = await mounted(<SmallMultiples title={TITLE} data={panels()} />);
    const [onXrp, onRlusd] = sliders(container);
    // Bucket 15 of 30 is at the middle: XRP 10M + 15 × 50K = 10.75M, which is 3 significant digits as 10.8M, and RLUSD 500 + 15 × 25.
    fireEvent.pointerMove(onRlusd!, mouse(500));
    expect(readouts(container)).toEqual(["10.8M XRP", "875 RLUSD"]);
    fireEvent.pointerMove(onXrp!, mouse(0));
    expect(readouts(container)).toEqual(["10M XRP", "500 RLUSD"]);
    fireEvent.pointerLeave(onXrp!, mouse(0));
    expect(readouts(container)).toEqual(["12.1M XRP", "1,200 RLUSD"]);
    expect(errors).toEqual([]);
  });

  it("is a dash for a panel that has no value in the hovered bucket, and not another bucket's value", async () => {
    const { container } = await mounted(<SmallMultiples title={TITLE} data={panels()} />);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(1000));
    expect(readouts(container)).toEqual(["12.1M XRP", "—"]);
  });

  it("follows the keyboard too: a focus is the newest bucket, Home the first, and the others follow", async () => {
    const { container } = await mounted(<SmallMultiples title={TITLE} data={panels()} />);
    fireEvent.focus(sliders(container)[1]!);
    expect(readouts(container)).toEqual(["12.1M XRP", "—"]);
    fireEvent.keyDown(sliders(container)[1]!, { key: "Home" });
    expect(readouts(container)).toEqual(["10M XRP", "500 RLUSD"]);
    fireEvent.keyDown(sliders(container)[1]!, { key: "Escape" });
    expect(readouts(container)).toEqual(["12.1M XRP", "1,200 RLUSD"]);
  });

  it("writes a count in compact style, and a percent exact, in the panel's own unit", async () => {
    const data = panels({
      panels: [
        { id: "a", label: "Transactions", values: AXIS.buckets.map(() => "1284331"), format: { kind: "count", unit: "transactions" } },
        { id: "b", label: "Agreement", values: AXIS.buckets.map(() => "99.31"), format: { kind: "percent" } },
      ],
    });
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={data} />);
    expect(readouts(container)).toEqual(["1.28M", "99.31%"]);
  });

  it("is a dash for a panel with no value at all", async () => {
    const none = panels({ panels: [{ id: "a", label: "XRP", values: AXIS.buckets.map(() => null), format: { kind: "amount", unit: "XRP" } }] });
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={none} />);
    expect(readouts(container)).toEqual(["—"]);
  });
});

describe("SmallMultiples' shared cursor", () => {
  it("draws a crosshair and a dot at the shared bucket in every panel, at the height of that panel's value", async () => {
    const { container, errors } = await mounted(<SmallMultiples title={TITLE} data={panels()} />);
    expect(container.querySelector(".plot__crosshair")).toBeNull();
    fireEvent.pointerMove(sliders(container)[0]!, mouse(500));
    const [xrp, rlusd] = panelEls(container);
    expect(container.querySelectorAll(".plot__crosshair")).toHaveLength(2);
    for (const item of [xrp!, rlusd!]) expect(item.querySelector<HTMLElement>(".plot__crosshair")!.style.left).toBe(percent(xOf(15, 30, "points")));
    const dot = (item: HTMLElement) => item.querySelector<HTMLElement>(".plot__cursor .plot__dot")!;
    expect(dot(xrp!).style.bottom).toBe(percent(fractionOf(10_750_000, niceScale(XRP.map(Number), { ticks: 3 }))));
    expect(dot(rlusd!).style.bottom).toBe(percent(fractionOf(875, niceScale([1200, 500], { ticks: 3 }))));
    expect(dot(xrp!).getAttribute("data-slot")).toBe("1");
    expect(errors).toEqual([]);
  });

  it("marks the shared bucket on every plot, so that a pointer move renders the cursors and not the marks", async () => {
    const { container } = await mounted(<SmallMultiples title={TITLE} data={panels()} />);
    fireEvent.pointerMove(sliders(container)[1]!, mouse(500));
    expect(Array.from(container.querySelectorAll(".plot"), (plot) => plot.getAttribute("data-active"))).toEqual(["15", "15"]);
  });

  it("shows the tooltip in the panel under the pointer only, with the date and the value, in the panel's own unit", async () => {
    const { container, errors } = await mounted(<SmallMultiples title={TITLE} data={panels()} />);
    expect(tips(container)).toHaveLength(0);
    fireEvent.pointerMove(sliders(container)[1]!, mouse(500));
    expect(tips(container)).toHaveLength(1);
    const [xrp, rlusd] = panelEls(container);
    expect(rlusd!.contains(tips(container)[0]!)).toBe(true);
    expect(xrp!.querySelector(".plot__tip")).toBeNull();
    expect(lines(tips(container)[0]!)).toEqual(["Oct 2, 2026", "875 RLUSD"]);
    expect(tips(container)[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(tips(container)[0]!.querySelector(".plot__tip-key")!.getAttribute("data-slot")).toBe("1");
    // The tooltip moves to the other panel with the pointer, and leaves none behind.
    fireEvent.pointerMove(sliders(container)[0]!, mouse(0));
    expect(tips(container)).toHaveLength(1);
    expect(xrp!.contains(tips(container)[0]!)).toBe(true);
    expect(lines(tips(container)[0]!)).toEqual(["Sep 17, 2026", "10M XRP"]);
    fireEvent.pointerLeave(sliders(container)[0]!, mouse(0));
    expect(tips(container)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("says a bucket in words to the slider of each panel: the date and the value, in full, with the unit once", async () => {
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels()} />);
    expect(sliders(container).map((control) => control.getAttribute("aria-valuetext"))).toEqual(["Oct 16, 2026: 12.1M XRP", "Oct 16, 2026: no data"]);
    expect(sliders(container).map((control) => control.getAttribute("aria-valuemax"))).toEqual(["29", "29"]);
  });
});

describe("SmallMultiples' states (spec 2.8)", () => {
  it("says 'No data for Oct 2' for a bucket that is null in a panel, and a dash in its readout", async () => {
    const gap = XRP.map((v, i) => (i === 15 ? null : v));
    const data = panels({ panels: [{ id: "xrp", label: "XRP", values: gap, format: { kind: "amount", unit: "XRP" } }] });
    const { container, errors } = await mounted(<SmallMultiples title={TITLE} data={data} />);
    expect(container.querySelector("path.line")!.getAttribute("d")!.match(/M/g)).toHaveLength(2);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(500));
    expect(lines(tips(container)[0]!)).toEqual(["No data for Oct 2"]);
    expect(readouts(container)).toEqual(["—"]);
    expect(sliders(container)[0]!.getAttribute("aria-valuetext")).toBe("Oct 2, 2026: no data");
    expect(container.querySelector(".plot__cursor .plot__dot")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("says 'Not computed yet' for the newest bucket when it is pending, and the readout is the newest that is computed", async () => {
    const pending = XRP.map((v, i) => (i === 29 ? null : v));
    const data = panels({ panels: [{ id: "xrp", label: "XRP", values: pending, format: { kind: "amount", unit: "XRP" } }], pending: 1 });
    const { container } = await mounted(<SmallMultiples title={TITLE} data={data} />);
    expect(readouts(container)).toEqual(["11.4M XRP"]);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(1000));
    expect(lines(tips(container)[0]!)).toEqual(["Oct 16, 2026", "Not computed yet"]);
    expect(sliders(container)[0]!.getAttribute("aria-valuetext")).toBe("Oct 16, 2026: not computed yet");
  });

  it("gives the running bucket its words in the tooltip and to the slider: so far", async () => {
    const { container } = await mounted(<SmallMultiples title={TITLE} data={panels({ forming: true })} />);
    expect(sliders(container)[0]!.getAttribute("aria-valuetext")).toBe("Oct 16, 2026, so far: 12.1M XRP");
    fireEvent.pointerMove(sliders(container)[0]!, mouse(1000));
    expect(lines(tips(container)[0]!)[0]).toBe("Oct 16, 2026, so far");
    for (const label of container.querySelectorAll(".plot__x span")) expect(label.textContent).not.toMatch(/so far/);
  });

  it("says 'No data for these 30 days' in a panel with nothing, which has no cursor, and draws the others", async () => {
    const data = panels({
      panels: [
        { id: "xrp", label: "XRP", values: XRP, format: { kind: "amount", unit: "XRP" } },
        { id: "usd", label: "USD", values: AXIS.buckets.map(() => null), format: { kind: "amount", unit: "USD" } },
      ],
    });
    const { container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={data} />);
    const [xrp, usd] = panelEls(container);
    expect(usd!.querySelector(".plot__empty")!.textContent).toBe("No data for these 30 days");
    expect(usd!.querySelector('[role="slider"]')).toBeNull();
    expect(usd!.querySelector("path.line")).toBeNull();
    expect(yLabels(usd!)).toEqual(["0", "0.5", "1"]);
    expect(xrp!.querySelector('[role="slider"]')).not.toBeNull();
    expect(xrp!.querySelector(".plot__empty")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("says 'No data for these 30 days' in place of the grid when there are no panels", async () => {
    const { container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={panels({ panels: [] })} />);
    expect(container.querySelectorAll(".panel")).toHaveLength(0);
    expect(container.querySelector(".multiples__empty")!.textContent).toBe("No data for these 30 days");
    expect(errors).toEqual([]);
  });

  it("draws an axis of one bucket: a dot in the middle of each panel", async () => {
    const data = panels({ axis: { unit: "day", buckets: ["2026-10-16"] }, panels: [{ id: "xrp", label: "XRP", values: ["12100000"], format: { kind: "amount", unit: "XRP" } }] });
    const { container, errors } = await serverThenHydrated(<SmallMultiples title={TITLE} data={data} />);
    expect(container.querySelector("path.line")!.getAttribute("d")).toMatch(/^M500,(\d+(\.\d+)?)L500,\1$/);
    expect(texts(container.querySelector(".plot__x--ends")!.children)).toEqual(["Oct 16"]);
    expect(errors).toEqual([]);
  });

  it("takes whole ticks for a panel of counts: 5 is 0 to 6 by 2, not 0 to 5 in two ticks", async () => {
    const data = panels({ panels: [{ id: "n", label: "Offers", values: AXIS.buckets.map(() => "5"), format: { kind: "count", unit: "offers" } }] });
    const { container } = await serverThenHydrated(<SmallMultiples title={TITLE} data={data} />);
    expect(yLabels(panelEls(container)[0]!)).toEqual(["0", "2", "4", "6"]);
  });
});

describe("SmallMultiples in its card: the table view of the same data", () => {
  const card = (data: SmallMultiplesData) => (
    <ChartCard id="balances" title="Balance history" source="/v2/accounts/{a}/balance_changes" what="the balance history" table={<ChartTable title="Balance history" data={data} />}>
      <SmallMultiples title="Balance history" data={data} />
    </ChartCard>
  );
  const grid = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="row"]'), (row) => Array.from(row.querySelectorAll('[role="columnheader"], [role="cell"]'), (cell) => cell.textContent ?? ""));

  it("has the columns Day (UTC), XRP and RLUSD with its sublabel, the newest day first, with the same values", async () => {
    const { container, errors } = await serverThenHydrated(card(panels()));
    const rows = grid(container);
    expect(rows[0]).toEqual(["Day (UTC)", "XRP", "RLUSD rMxCKb…m5De"]);
    expect(rows[1]).toEqual(["Oct 16, 2026", "12,100,000", "—no data"]);
    expect(rows[2]).toEqual(["Oct 15, 2026", "11,400,000", "1,200"]);
    expect(rows).toHaveLength(31);
    // Both views are in the page: the cached HTML has the table as well as the panels.
    expect(container.querySelectorAll(".multiples .panel")).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("says so far of a forming bucket in its table row, as it does in the tooltip", async () => {
    const { container } = await serverThenHydrated(card(panels({ forming: true })));
    expect(grid(container)[1]![0]).toBe("Oct 16, 2026, so far");
  });
});

describe("SmallMultiples, memoised on the token (spec 2.9)", () => {
  const other = panels({ panels: [{ id: "xrp", label: "XRP", values: XRP.map(() => "5000000"), format: { kind: "amount", unit: "XRP" } }, panels().panels[1]!] });

  it("is not rendered again for the same token: the DOM stays, though the numbers it was handed are others", () => {
    const { container, rerender } = render(<SmallMultiples title={TITLE} data={panels()} />);
    const first = container.querySelector(".panel");
    expect(readouts(container)).toEqual(["12.1M XRP", "1,200 RLUSD"]);

    rerender(<SmallMultiples title={TITLE} data={{ ...other, token: "b1" }} />);
    expect(container.querySelector(".panel")).toBe(first);
    expect(readouts(container)).toEqual(["12.1M XRP", "1,200 RLUSD"]);
    expect(container.querySelector(".plot.is-changed")).toBeNull();

    rerender(<SmallMultiples title={TITLE} data={{ ...panels() }} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
  });

  it("is drawn again for a new token, and each panel rings once", () => {
    const { container, rerender } = render(<SmallMultiples title={TITLE} data={panels()} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    rerender(<SmallMultiples title={TITLE} data={{ ...other, token: "b2" }} />);
    expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(2);
    expect(readouts(container)).toEqual(["5M XRP", "1,200 RLUSD"]);
  });

  it("is drawn again for another title, which is part of what it is memoised on", () => {
    const { container, rerender } = render(<SmallMultiples title={TITLE} data={panels()} />);
    rerender(<SmallMultiples title="Reserves" data={panels()} />);
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("Reserves, XRP");
  });
});
