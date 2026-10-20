import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { candleLegend, Candles } from "./Candles";
import { ChartCard } from "./ChartCard";
import { ChartTable } from "./ChartTable";
import { fractionOf, niceScale, percent } from "./geometry";
import { Legend } from "./Legend";
import type { CandleData, TimeAxis } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Candles over a volume pane (spec 2.3 and 2.11): a wick of 1 px from the low to the high and a body from the open to the close, `--up` when
// the day closed higher or where it opened and `--down` when it closed lower, in a price pane whose axis is on the right; under it a pane of
// volume columns in `--series-other` with an axis of its own. One `HoverGroup` spans the two panes, an O/H/L/C/V readout above them follows
// it, and the slider says what the readout says.

const TITLE = "Price, XRP/USD";

/** Five days, Oct 12 to Oct 16, 2026: bucket 4 is the newest. */
const AXIS: TimeAxis = { unit: "day", buckets: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"] };

const CANDLES: CandleData["candles"] = [
  { o: "2.40", h: "2.46", l: "2.38", c: "2.44", v: "1200000", n: "310" }, // up
  { o: "2.44", h: "2.45", l: "2.39", c: "2.41", v: "900000", n: "250" }, // down
  null, // nothing was traded
  { o: "2.41", h: "2.43", l: "2.41", c: "2.41", v: "500000", n: "1" }, // closed where it opened
  { o: "2.41", h: "2.48", l: "2.40", c: "2.47", v: "1500000", n: "402" }, // up
];

function candles(extra: Partial<CandleData> = {}): CandleData {
  return { axis: AXIS, candles: CANDLES, format: { kind: "price", unit: "USD" }, volume: { kind: "amount", unit: "XRP" }, token: "c1", ...extra };
}

/** The prices' scale, 2.38 to 2.48: steps of 0.02 would be six ticks and so would 0.025 (2.375 to 2.5), so 0.05. */
const PRICES = [2.35, 2.4, 2.45, 2.5];
const PRICE_SCALE = { min: 2.35, max: 2.5, step: 0.05, ticks: PRICES };
/** The volumes' scale: 1.5M at most, 3 ticks. */
const VOLUME_SCALE = niceScale([1_200_000, 900_000, 500_000, 1_500_000], { ticks: 3 });

const frames = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".plot__frame"));
const price = (container: HTMLElement) => frames(container)[0]!;
const volume = (container: HTMLElement) => frames(container)[1]!;
const texts = (nodes: ArrayLike<Element>) => Array.from(nodes, (node) => node.textContent);
const sliders = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]'));
const readout = (container: HTMLElement) => texts(container.querySelector(".candles__readout")!.children);
const tips = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".plot__tip"));
const lines = (tip: HTMLElement) => Array.from(tip.querySelectorAll(".plot__tip-date, .plot__tip-row, .plot__tip-note"), (line) => line.textContent);
const slot = (pane: HTMLElement, i: number) => pane.querySelector<HTMLElement>(`.col[data-bucket="${i}"]`)!;

const BOX = { left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/** The page as the Worker prints it and the browser takes it over, with every plot 1000 px wide. */
async function mounted(ui: ReactElement) {
  const result = await serverThenHydrated(ui);
  for (const plot of result.container.querySelectorAll<HTMLElement>(".plot")) vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(BOX);
  return result;
}

const mouse = (clientX: number) => ({ clientX, pointerType: "mouse" });

describe("Candles as the Worker prints it and the browser takes it over", () => {
  it("draws a candle for each bucket that has one, 4 of the 5, and leaves the slot of the one that is null empty, with no slider in the HTML", async () => {
    const { html, container, errors } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    expect(html).not.toContain('role="slider"');
    expect(html.match(/class="candle"/g)).toHaveLength(4);
    expect(price(container).querySelectorAll(".candle")).toHaveLength(4);
    expect(price(container).querySelectorAll(".col")).toHaveLength(5);
    expect(slot(price(container), 2).children).toHaveLength(0);
    expect(slot(price(container), 2).querySelector(".candle")).toBeNull();
    expect(Array.from(price(container).querySelectorAll(".col"), (col) => col.querySelector(".candle") !== null)).toEqual([true, true, false, true, true]);
    expect(errors).toEqual([]);
  });

  it("draws the wick from the low to the high and the body from the open to the close, in percent of the price scale, the body at least 1 px (CSS)", async () => {
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    const at = (v: number) => fractionOf(v, PRICE_SCALE);
    const marks = (i: number) => {
      const candle = slot(price(container), i).querySelector(".candle")!;
      const wick = candle.querySelector<HTMLElement>(".candle__wick")!;
      const body = candle.querySelector<HTMLElement>(".candle__body")!;
      return { wick: [wick.style.bottom, wick.style.height], body: [body.style.bottom, body.style.height] };
    };
    // 2.38 to 2.46, 2.40 to 2.44.
    expect(marks(0)).toEqual({ wick: [percent(at(2.38)), percent(at(2.46) - at(2.38))], body: [percent(at(2.4)), percent(at(2.44) - at(2.4))] });
    expect(marks(0)).toEqual({ wick: ["20%", "53.33%"], body: ["33.33%", "26.67%"] });
    // A down candle's body runs from the close up to the open.
    expect(marks(1).body).toEqual([percent(at(2.41)), percent(at(2.44) - at(2.41))]);
    // Closed where it opened: the body has no height in the style, and the stylesheet's minimum makes it a line.
    expect(marks(3).body[1]).toBe("0%");
    expect(marks(3).wick).toEqual([percent(at(2.41)), percent(at(2.43) - at(2.41))]);
    expect(errors).toEqual([]);
  });

  it("colours a candle by the way it closed: up when higher, down when lower, and up when it closed where it opened", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    const colours = Array.from(price(container).querySelectorAll(".candle"), (candle) => candle.getAttribute("data-slot"));
    expect(colours).toEqual(["up", "down", "up", "up"]);
    // The wick and the body wear the candle's colour, which the slot's rule (`--mark`) gives them.
    for (const candle of price(container).querySelectorAll(".candle")) {
      expect(candle.querySelector(".candle__wick")).not.toBeNull();
      expect(candle.querySelector(".candle__body")).not.toBeNull();
      expect(candle.querySelector("[data-slot]")).toBeNull();
    }
  });

  it("says closed higher for a close above the open by the least digit, and lower by the least digit", async () => {
    const data = candles({
      candles: [
        { o: "1.000001", h: "1.000002", l: "1", c: "1.000002", v: "1", n: "1" },
        { o: "1.000002", h: "1.000002", l: "1", c: "1.000001", v: "1", n: "1" },
      ],
      axis: { unit: "day", buckets: ["2026-10-15", "2026-10-16"] },
    });
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={data} />);
    expect(Array.from(container.querySelectorAll(".candle"), (candle) => candle.getAttribute("data-slot"))).toEqual(["up", "down"]);
  });

  it("puts the price axis on the right, fitted to the prices and not from 0, and does not label the pane's x axis", async () => {
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    const gutter = price(container).querySelector<HTMLElement>(".plot__y")!;
    expect(gutter.classList.contains("plot__y--right")).toBe(true);
    expect(texts(gutter.children)).toEqual(["2.35", "2.4", "2.45", "2.5"]);
    // It comes after the region that holds the plot, and is at the plot's own height.
    expect(gutter.previousElementSibling!.classList.contains("plot__scroll")).toBe(true);
    expect(Array.from(gutter.children, (label) => (label as HTMLElement).style.bottom)).toEqual(["0%", "33.33%", "66.67%", "100%"]);
    expect(Array.from(price(container).querySelectorAll<HTMLElement>(".plot__grid"), (line) => line.style.bottom)).toEqual(["0%", "33.33%", "66.67%", "100%"]);
    // The price is not from 0, so no line is the base.
    expect(price(container).querySelector(".plot__grid.is-base")).toBeNull();
    // The price pane is the chart's height, and has no labels of its own under it.
    expect(price(container).className).toBe("plot__frame plot__frame--bare");
    expect(price(container).querySelector(".plot__x")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("gives the two gutters the width of the wider labels, so that the plots are as wide as each other and a bucket is at one x in both", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    const widths = Array.from(container.querySelectorAll<HTMLElement>(".plot__y"), (gutter) => gutter.style.getPropertyValue("--chars"));
    // "2.35" has 4 characters and "2M" has 2.
    expect(widths).toEqual(["4", "4"]);
    // And a volume axis of longer labels widens the price gutter.
    const heavy = candles({ candles: CANDLES.map((candle) => (candle ? { ...candle, v: "1500000000" } : null)) });
    cleanup();
    const wide = await serverThenHydrated(<Candles title={TITLE} data={heavy} />);
    const labels = texts(volume(wide.container).querySelector(".plot__y")!.children);
    expect(labels).toEqual(["0", "1B", "2B"]);
    expect(Array.from(wide.container.querySelectorAll<HTMLElement>(".plot__y"), (gutter) => gutter.style.getPropertyValue("--chars"))).toEqual(["4", "4"]);
  });

  it("lays the slots out in the plot's own row class, which no page's columns share", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    expect(container.querySelectorAll(".plot__cols")).toHaveLength(2);
    expect(container.querySelector(".cols")).toBeNull();
  });

  it("draws the volume in a pane of its own under the candles: columns in series-other from 0, an axis on the right and the x labels", async () => {
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    expect(frames(container)).toHaveLength(2);
    expect(volume(container).className).toBe("plot__frame plot__frame--pane");
    // Five slots, one of them empty: nothing was traded, which is not a volume of 0.
    expect(volume(container).querySelectorAll(".col")).toHaveLength(5);
    const bars = Array.from(volume(container).querySelectorAll<HTMLElement>(".col__bar"));
    expect(bars).toHaveLength(4);
    expect(slot(volume(container), 2).children).toHaveLength(0);
    for (const bar of bars) {
      expect(bar.getAttribute("data-slot")).toBe("other");
      expect(bar.classList.contains("col__bar--volume")).toBe(true);
    }
    expect(bars.map((bar) => bar.style.height)).toEqual([1_200_000, 900_000, 500_000, 1_500_000].map((v) => percent(fractionOf(v, VOLUME_SCALE))));
    expect(VOLUME_SCALE.ticks).toEqual([0, 1_000_000, 2_000_000]);
    // Its own axis, on the right, from 0 (the 0 line is the base), and under it the x labels of both panes.
    const gutter = volume(container).querySelector<HTMLElement>(".plot__y")!;
    expect(gutter.classList.contains("plot__y--right")).toBe(true);
    expect(texts(gutter.children)).toEqual(["0", "1M", "2M"]);
    expect(volume(container).querySelectorAll(".plot__grid.is-base")).toHaveLength(1);
    expect(texts(volume(container).querySelector(".plot__x--wide")!.children)).toEqual(["Oct 12", "Oct 13", "Oct 14", "Oct 15", "Oct 16"]);
    expect(volume(container).querySelectorAll(".plot__x")).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("scrolls sideways in two regions of the same width, one for each pane, named for the pane", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    const regions = Array.from(container.querySelectorAll<HTMLElement>('[role="region"]'));
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual(["Price, XRP/USD, scrollable chart", "Price, XRP/USD, volume, scrollable chart"]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".plot"), (plot) => plot.style.minWidth)).toEqual(["25px", "25px"]);
  });

  it("names the two images for a screen reader, each with its own summary", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    expect(Array.from(container.querySelectorAll('[role="img"]'), (img) => img.getAttribute("aria-label"))).toEqual([
      "Price, XRP/USD, closing price, Oct 12 to Oct 16, 2026. Highest Oct 16, 2.47 USD; latest Oct 16, 2.47 USD. Choose Table for every value.",
      "Price, XRP/USD, volume, Oct 12 to Oct 16, 2026. Highest Oct 16, 1.5M XRP; latest Oct 16, 1.5M XRP. Choose Table for every value.",
    ]);
  });
});

describe("Candles' readout", () => {
  it("shows the latest candle to begin with: its time, O H L C, the volume and the trades, in the HTML the Worker prints", async () => {
    const { html, container, errors } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    expect(readout(container)).toEqual(["Oct 16, 2026", "O 2.41 USD", "H 2.48 USD", "L 2.4 USD", "C 2.47 USD", "Volume 1.5M XRP", "402 trades"]);
    // The readout is in the HTML as text (React separates adjacent text nodes with a comment).
    expect(html.replace(/<!-- -->/g, "")).toContain("<b>402</b> trades");
    // It stands above the price pane.
    const box = container.querySelector(".candles__readout")!;
    expect(box.compareDocumentPosition(price(container)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(errors).toEqual([]);
  });

  it("shows the newest candle that there is when the newest buckets are null, and a lone trade is 1 trade", async () => {
    const trailing = candles({ candles: [CANDLES[3]!, CANDLES[4]!, null, null, null] });
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={trailing} />);
    expect(readout(container)[0]).toBe("Oct 13, 2026");
    expect(readout(container).at(-1)).toBe("402 trades");
    cleanup();
    const lone = candles({ candles: [null, null, null, CANDLES[3]!, null] });
    const second = await serverThenHydrated(<Candles title={TITLE} data={lone} />);
    expect(readout(second.container)).toEqual(["Oct 15, 2026", "O 2.41 USD", "H 2.43 USD", "L 2.41 USD", "C 2.41 USD", "Volume 500K XRP", "1 trade"]);
  });

  it("follows the pointer in either pane, over both, and goes back to the latest when it leaves", async () => {
    const { container, errors } = await mounted(<Candles title={TITLE} data={candles()} />);
    const [onPrice, onVolume] = sliders(container);
    fireEvent.pointerMove(onPrice!, mouse(100));
    expect(readout(container)).toEqual(["Oct 12, 2026", "O 2.4 USD", "H 2.46 USD", "L 2.38 USD", "C 2.44 USD", "Volume 1.2M XRP", "310 trades"]);
    // Five slots of 200 px: the pointer at 500 is in the third, which has no candle.
    fireEvent.pointerMove(onVolume!, mouse(500));
    expect(readout(container)).toEqual(["Oct 14, 2026", "No data"]);
    fireEvent.pointerMove(onVolume!, mouse(700));
    expect(readout(container)).toEqual(["Oct 15, 2026", "O 2.41 USD", "H 2.43 USD", "L 2.41 USD", "C 2.41 USD", "Volume 500K XRP", "1 trade"]);
    fireEvent.pointerLeave(onVolume!, mouse(700));
    expect(readout(container)[0]).toBe("Oct 16, 2026");
    expect(errors).toEqual([]);
  });

  it("moves with the keyboard, and the slider says the same figures in words: ArrowLeft goes to the candle before", async () => {
    const { container, errors } = await mounted(<Candles title={TITLE} data={candles()} />);
    const slider = sliders(container)[0]!;
    // Before anyone has used it the slider is on the newest bucket.
    expect(slider.getAttribute("aria-valuenow")).toBe("4");
    expect(slider.getAttribute("aria-valuetext")).toBe("Oct 16, 2026: open 2.41 USD, high 2.48 USD, low 2.4 USD, close 2.47 USD; volume 1.5M XRP; 402 trades");
    fireEvent.focus(slider);
    expect(readout(container)[0]).toBe("Oct 16, 2026");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider.getAttribute("aria-valuenow")).toBe("3");
    expect(readout(container)).toEqual(["Oct 15, 2026", "O 2.41 USD", "H 2.43 USD", "L 2.41 USD", "C 2.41 USD", "Volume 500K XRP", "1 trade"]);
    expect(slider.getAttribute("aria-valuetext")).toBe("Oct 15, 2026: open 2.41 USD, high 2.43 USD, low 2.41 USD, close 2.41 USD; volume 500K XRP; 1 trade");
    // A bucket with no candle is said so, in both.
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Oct 14, 2026: no data");
    expect(readout(container)).toEqual(["Oct 14, 2026", "No data"]);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(readout(container)[0]).toBe("Oct 12, 2026");
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(readout(container)[0]).toBe("Oct 16, 2026");
    expect(errors).toEqual([]);
  });

  it("says the figures of the slider with the same text as the readout: the same values, the letters spelled out", async () => {
    const { container } = await mounted(<Candles title={TITLE} data={candles()} />);
    const slider = sliders(container)[0]!;
    for (const i of [0, 1, 3, 4]) {
      fireEvent.keyDown(slider, { key: "Home" });
      fireEvent.focus(slider);
      for (let step = 0; step < i; step += 1) fireEvent.keyDown(slider, { key: "ArrowRight" });
      const words = readout(container).slice(1).map((part) => part!.replace(/^[OHLC] /, "").replace(/^Volume /, ""));
      const text = slider.getAttribute("aria-valuetext")!;
      for (const word of words) expect(text, `bucket ${i}: ${word}`).toContain(word);
      fireEvent.keyDown(slider, { key: "Escape" });
    }
  });

  it("is a time with the hour and its zone for an hourly axis: the readout names UTC, the slider does not", async () => {
    const hours: TimeAxis = { unit: "hour", buckets: ["2026-10-16T14:00:00Z", "2026-10-16T15:00:00Z"] };
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles({ axis: hours, candles: [CANDLES[0]!, CANDLES[1]!] })} />);
    expect(readout(container)[0]).toBe("Oct 16, 2026, 15:00 UTC");
    expect(sliders(container)[0]!.getAttribute("aria-valuetext")).toMatch(/^Oct 16, 2026, 15:00: open /);
  });
});

describe("Candles' shared cursor", () => {
  it("marks the hovered bucket in both panes, whichever one the pointer is in, so that the others are dimmed in both", async () => {
    const { container, errors } = await mounted(<Candles title={TITLE} data={candles()} />);
    const plots = Array.from(container.querySelectorAll<HTMLElement>(".plot"));
    expect(plots.map((plot) => plot.getAttribute("data-active"))).toEqual([null, null]);
    fireEvent.pointerMove(sliders(container)[1]!, mouse(100));
    expect(plots.map((plot) => plot.getAttribute("data-active"))).toEqual(["0", "0"]);
    expect(slot(price(container), 0).classList.contains("is-active")).toBe(true);
    expect(slot(volume(container), 0).classList.contains("is-active")).toBe(true);
    expect(slot(price(container), 1).classList.contains("is-active")).toBe(false);
    expect(slot(volume(container), 1).classList.contains("is-active")).toBe(false);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(900));
    expect(plots.map((plot) => plot.getAttribute("data-active"))).toEqual(["4", "4"]);
    expect(slot(volume(container), 4).classList.contains("is-active")).toBe(true);
    expect(slot(volume(container), 0).classList.contains("is-active")).toBe(false);
    fireEvent.pointerLeave(sliders(container)[0]!, mouse(900));
    expect(plots.map((plot) => plot.getAttribute("data-active"))).toEqual([null, null]);
    expect(errors).toEqual([]);
  });

  it("has no crosshair: a candle is a column, and the hovered one stands out against the dimmed rest", async () => {
    const { container } = await mounted(<Candles title={TITLE} data={candles()} />);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(100));
    expect(container.querySelector(".plot__crosshair")).toBeNull();
    expect(container.querySelector(".plot__cursor .plot__dot")).toBeNull();
  });

  it("shows the tooltip in the pane under the pointer only: the date, O H L C, the volume and the trades; the volume pane has its own", async () => {
    const { container, errors } = await mounted(<Candles title={TITLE} data={candles()} />);
    expect(tips(container)).toHaveLength(0);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(100));
    expect(tips(container)).toHaveLength(1);
    expect(price(container).contains(tips(container)[0]!)).toBe(true);
    expect(lines(tips(container)[0]!)).toEqual(["Oct 12, 2026", "2.4 USD open", "2.46 USD high", "2.38 USD low", "2.44 USD close", "1.2M XRP volume", "310 trades"]);
    expect(tips(container)[0]!.getAttribute("aria-hidden")).toBe("true");
    fireEvent.pointerMove(sliders(container)[1]!, mouse(900));
    expect(tips(container)).toHaveLength(1);
    expect(volume(container).contains(tips(container)[0]!)).toBe(true);
    expect(lines(tips(container)[0]!)).toEqual(["Oct 16, 2026", "1.5M XRP volume", "402 trades"]);
    fireEvent.pointerLeave(sliders(container)[1]!, mouse(900));
    expect(tips(container)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("says 'No data for Oct 14' in the tooltip of a bucket without a candle", async () => {
    const { container } = await mounted(<Candles title={TITLE} data={candles()} />);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(500));
    expect(lines(tips(container)[0]!)).toEqual(["No data for Oct 14"]);
  });

  it("names the two sliders, the second for the volume, and gives each what it shows", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    expect(sliders(container).map((slider) => slider.getAttribute("aria-label"))).toEqual(["Price, XRP/USD, day by day", "Price, XRP/USD, volume, day by day"]);
    expect(sliders(container).map((slider) => slider.getAttribute("aria-valuemax"))).toEqual(["4", "4"]);
    expect(sliders(container)[1]!.getAttribute("aria-valuetext")).toBe("Oct 16, 2026: volume 1.5M XRP; 402 trades");
  });

  it("keeps the two panes at the same place when one of them scrolls sideways, as the dense plot of a phone does", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    const [first, second] = Array.from(container.querySelectorAll<HTMLElement>(".plot__scroll"));
    first!.scrollLeft = 120;
    fireEvent.scroll(first!);
    expect(second!.scrollLeft).toBe(120);
    second!.scrollLeft = 30;
    fireEvent.scroll(second!);
    expect(first!.scrollLeft).toBe(30);
  });

  it("stops following the other pane once it is gone", () => {
    const { container, unmount } = render(<Candles title={TITLE} data={candles()} />);
    const [first, second] = Array.from(container.querySelectorAll<HTMLElement>(".plot__scroll"));
    unmount();
    first!.scrollLeft = 80;
    fireEvent.scroll(first!);
    expect(second!.scrollLeft).toBe(0);
  });
});

describe("Candles' time axes, and the bucket that is still running", () => {
  const HOURS: TimeAxis = { unit: "hour", buckets: ["2026-10-17T15:00:00Z", "2026-10-17T16:00:00Z", "2026-10-17T17:00:00Z"] };
  const hourly = (extra: Partial<CandleData> = {}) => candles({ axis: HOURS, candles: [CANDLES[0]!, CANDLES[1]!, CANDLES[4]!], ...extra });
  const QUARTERS: TimeAxis = {
    unit: "minute",
    buckets: ["2026-10-17T16:15:00Z", "2026-10-17T16:30:00Z", "2026-10-17T16:45:00Z", "2026-10-17T17:00:00Z"],
  };
  const quarterly = (extra: Partial<CandleData> = {}) => candles({ axis: QUARTERS, candles: [CANDLES[0]!, CANDLES[1]!, null, CANDLES[4]!], ...extra });
  const WEEKS: TimeAxis = { unit: "week", buckets: ["2026-09-28", "2026-10-05", "2026-10-12"] };
  const weekly = (extra: Partial<CandleData> = {}) => candles({ axis: WEEKS, candles: [CANDLES[0]!, CANDLES[1]!, CANDLES[4]!], ...extra });
  const grid = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="row"]'), (row) => Array.from(row.querySelectorAll('[role="columnheader"], [role="cell"]'), (cell) => cell.textContent ?? ""));

  it("reads 'Oct 17, 2026, 17:00 UTC · so far' in the readout for the forming hour, in the HTML the Worker prints", async () => {
    const { html, container, errors } = await serverThenHydrated(<Candles title={TITLE} data={hourly({ forming: true })} />);
    expect(readout(container)[0]).toBe("Oct 17, 2026, 17:00 UTC \u00b7 so far");
    expect(html).toContain("Oct 17, 2026, 17:00 UTC \u00b7 so far");
    expect(errors).toEqual([]);
  });

  it("reads the bucket without 'so far' when it is not forming, or when the pointer is on an older bucket", async () => {
    const quiet = await serverThenHydrated(<Candles title={TITLE} data={hourly()} />);
    expect(readout(quiet.container)[0]).toBe("Oct 17, 2026, 17:00 UTC");
    cleanup();
    const { container } = await mounted(<Candles title={TITLE} data={hourly({ forming: true })} />);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(100));
    expect(readout(container)[0]).toBe("Oct 17, 2026, 15:00 UTC");
    fireEvent.pointerMove(sliders(container)[0]!, mouse(500));
    expect(readout(container)[0]).toBe("Oct 17, 2026, 16:00 UTC");
    fireEvent.pointerLeave(sliders(container)[0]!, mouse(500));
    expect(readout(container)[0]).toBe("Oct 17, 2026, 17:00 UTC \u00b7 so far");
  });

  it("puts ', so far' in the tooltip and the slider text of the newest bucket in both panes, and in no other", async () => {
    const { container, errors } = await mounted(<Candles title={TITLE} data={hourly({ forming: true })} />);
    const [onPrice, onVolume] = sliders(container);
    expect(onPrice!.getAttribute("aria-valuetext")).toMatch(/^Oct 17, 2026, 17:00, so far: open /);
    expect(onVolume!.getAttribute("aria-valuetext")).toMatch(/^Oct 17, 2026, 17:00, so far: volume /);
    fireEvent.pointerMove(onPrice!, mouse(900));
    expect(lines(tips(container)[0]!)[0]).toBe("Oct 17, 2026, 17:00, so far");
    fireEvent.pointerMove(onVolume!, mouse(900));
    expect(lines(tips(container)[0]!)[0]).toBe("Oct 17, 2026, 17:00, so far");
    // An older bucket is a closed one.
    fireEvent.pointerMove(onPrice!, mouse(100));
    expect(lines(tips(container)[0]!)[0]).toBe("Oct 17, 2026, 15:00");
    fireEvent.keyDown(onPrice!, { key: "Home" });
    expect(onPrice!.getAttribute("aria-valuetext")).toMatch(/^Oct 17, 2026, 15:00: open /);
    expect(errors).toEqual([]);
  });

  it("puts nothing of it on the axis, and nothing at all when forming is not asked for", async () => {
    const forming = await serverThenHydrated(<Candles title={TITLE} data={hourly({ forming: true })} />);
    expect(texts(volume(forming.container).querySelector(".plot__x--wide")!.children)).toEqual(["15:00", "16:00", "17:00"]);
    cleanup();
    const { container } = await mounted(<Candles title={TITLE} data={hourly()} />);
    expect(sliders(container)[0]!.getAttribute("aria-valuetext")).toMatch(/^Oct 17, 2026, 17:00: open /);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(900));
    expect(lines(tips(container)[0]!)[0]).toBe("Oct 17, 2026, 17:00");
    expect(container.innerHTML).not.toContain("so far");
  });

  it("says so far in the summary of each pane, after the date of the newest bucket", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={hourly({ forming: true })} />);
    expect(Array.from(container.querySelectorAll('[role="img"]'), (img) => img.getAttribute("aria-label"))).toEqual([
      "Price, XRP/USD, closing price, Oct 17, 15:00 to Oct 17, 2026, 17:00. Highest Oct 17, 17:00, so far, 2.47 USD; latest Oct 17, 17:00, so far, 2.47 USD. Choose Table for every value.",
      "Price, XRP/USD, volume, Oct 17, 15:00 to Oct 17, 2026, 17:00. Highest Oct 17, 17:00, so far, 1.5M XRP; latest Oct 17, 17:00, so far, 1.5M XRP. Choose Table for every value.",
    ]);
  });

  it("says so far in the table's cell of the newest bucket only", async () => {
    const data = hourly({ forming: true });
    const { container, errors } = await serverThenHydrated(
      <ChartCard id="price" title="Price" source="/v2/exchanges/XRP/USD" what="the price" table={<ChartTable title="Price" data={data} />}>
        <Candles title="Price" data={data} />
      </ChartCard>,
    );
    expect(grid(container).map((row) => row[0])).toEqual(["Hour (UTC)", "Oct 17, 2026, 17:00, so far", "Oct 17, 2026, 16:00", "Oct 17, 2026, 15:00"]);
    expect(errors).toEqual([]);
  });

  it("reads 'Week of Oct 12, 2026' for a week, with ' · so far' when it is the running one", async () => {
    const closed = await serverThenHydrated(<Candles title={TITLE} data={weekly()} />);
    expect(readout(closed.container)[0]).toBe("Week of Oct 12, 2026");
    cleanup();
    const running = await serverThenHydrated(<Candles title={TITLE} data={weekly({ forming: true })} />);
    expect(readout(running.container)[0]).toBe("Week of Oct 12, 2026 \u00b7 so far");
    expect(sliders(running.container)[0]!.getAttribute("aria-valuetext")).toMatch(/^Week of Oct 12, 2026, so far: open /);
  });

  it("reads a forming day as 'Oct 16, 2026 · so far' in the readout, and a closed day as before", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles({ forming: true })} />);
    expect(readout(container)[0]).toBe("Oct 16, 2026 \u00b7 so far");
    cleanup();
    const closed = await serverThenHydrated(<Candles title={TITLE} data={candles()} />);
    expect(readout(closed.container)[0]).toBe("Oct 16, 2026");
  });

  it("marks a forming bucket that has no candle yet, in the readout beside 'No data'", async () => {
    const data = hourly({ forming: true, candles: [CANDLES[0]!, CANDLES[1]!, null] });
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={data} />);
    // The readout is on the newest candle there is, the one at 16:00.
    expect(readout(container)[0]).toBe("Oct 17, 2026, 16:00 UTC");
    cleanup();
    const mountedData = await mounted(<Candles title={TITLE} data={data} />);
    fireEvent.pointerMove(sliders(mountedData.container)[0]!, mouse(900));
    expect(readout(mountedData.container)).toEqual(["Oct 17, 2026, 17:00 UTC \u00b7 so far", "No data"]);
    expect(sliders(mountedData.container)[0]!.getAttribute("aria-valuetext")).toBe("Oct 17, 2026, 17:00, so far: no data");
  });

  it("draws a 15-minute axis: labels like '17:15', a readout with the zone, and a slider that goes quarter hour by quarter hour", async () => {
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={quarterly({ forming: true })} />);
    expect(texts(volume(container).querySelector(".plot__x--wide")!.children)).toEqual(["16:15", "16:30", "16:45", "17:00"]);
    expect(readout(container)[0]).toBe("Oct 17, 2026, 17:00 UTC \u00b7 so far");
    expect(sliders(container).map((slider) => slider.getAttribute("aria-label"))).toEqual([
      "Price, XRP/USD, quarter hour by quarter hour",
      "Price, XRP/USD, volume, quarter hour by quarter hour",
    ]);
    expect(errors).toEqual([]);
  });

  it("says a quarter hour's tooltip with its day and time, and 'No data for' the one with no candle", async () => {
    const { container } = await mounted(<Candles title={TITLE} data={quarterly()} />);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(100));
    expect(lines(tips(container)[0]!)[0]).toBe("Oct 17, 2026, 16:15");
    fireEvent.pointerMove(sliders(container)[0]!, mouse(600));
    expect(lines(tips(container)[0]!)).toEqual(["No data for Oct 17, 2026, 16:45"]);
  });

  it("heads the first column of the table 'Time (UTC)' for a 15-minute axis", async () => {
    const data = quarterly({ forming: true });
    const { container } = await serverThenHydrated(
      <ChartCard id="price" title="Price" source="/v2/exchanges/XRP/USD" what="the price" table={<ChartTable title="Price" data={data} />}>
        <Candles title="Price" data={data} />
      </ChartCard>,
    );
    expect(grid(container).map((row) => row[0])).toEqual([
      "Time (UTC)",
      "Oct 17, 2026, 17:00, so far",
      "Oct 17, 2026, 16:45",
      "Oct 17, 2026, 16:30",
      "Oct 17, 2026, 16:15",
    ]);
  });
});

describe("Candles' prices are formatPrice text, never compact", () => {
  const PRICES: CandleData["candles"] = [
    { o: "12345.67890000", h: "12400.00000000", l: "12300.00000000", c: "12350.50000000", v: "2500000", n: "7" },
    { o: "12350.50000000", h: "12390", l: "12310.25", c: "12320", v: "900000", n: "3" },
  ];
  const AXIS2: TimeAxis = { unit: "day", buckets: ["2026-10-15", "2026-10-16"] };
  const priced = (rows: CandleData["candles"] = PRICES) => candles({ axis: AXIS2, candles: rows });

  it("writes the axis, the readout, the tooltip, the slider and the table with it: 12,345.679, not 12.3K", async () => {
    const data = priced();
    const { container, errors } = await mounted(
      <ChartCard id="price" title="Price" source="/v2/exchanges/XRP/USD" what="the price" table={<ChartTable title="Price" data={data} />}>
        <Candles title="Price" data={data} />
      </ChartCard>,
    );
    expect(texts(price(container).querySelector(".plot__y")!.children)).toEqual(["12,300", "12,325", "12,350", "12,375", "12,400"]);
    fireEvent.pointerMove(sliders(container)[0]!, mouse(100));
    expect(readout(container).slice(0, 5)).toEqual(["Oct 15, 2026", "O 12,345.679 USD", "H 12,400 USD", "L 12,300 USD", "C 12,350.5 USD"]);
    expect(lines(tips(container)[0]!).slice(1, 5)).toEqual(["12,345.679 USD open", "12,400 USD high", "12,300 USD low", "12,350.5 USD close"]);
    expect(sliders(container)[0]!.getAttribute("aria-valuetext")).toContain("open 12,345.679 USD, high 12,400 USD, low 12,300 USD, close 12,350.5 USD");
    const rows = Array.from(container.querySelectorAll('[role="row"]'), (row) => Array.from(row.querySelectorAll('[role="cell"]'), (cell) => cell.textContent ?? ""));
    expect(rows[2]!.slice(0, 5)).toEqual(["Oct 15, 2026", "12,345.679", "12,400", "12,300", "12,350.5"]);
    expect(container.innerHTML).not.toMatch(/12\.3K|12\.4K/);
    expect(errors).toEqual([]);
  });

  it("shows '0.40990000' as 0.4099, never 0.41, and keeps what is small whole", async () => {
    const rows: CandleData["candles"] = [{ o: "0.40990000", h: "0.42500000", l: "0.40000000", c: "0.41500000", v: "100", n: "2" }, null];
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={priced(rows)} />);
    expect(readout(container).slice(0, 5)).toEqual(["Oct 15, 2026", "O 0.4099 USD", "H 0.425 USD", "L 0.4 USD", "C 0.415 USD"]);
    expect(container.innerHTML).not.toContain("0.41 USD");
  });

  it("fills the pane with a stable pair, whose labels can tell 0.99975 from 1: an axis of 0.9995 to 1.0005, not 0.99 to 1.01", async () => {
    const rows: CandleData["candles"] = [
      { o: "1.00000000", h: "1.00050000", l: "0.99950000", c: "1.00020000", v: "1000", n: "9" },
      { o: "1.00020000", h: "1.00030000", l: "0.99980000", c: "0.99990000", v: "500", n: "4" },
    ];
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={priced(rows)} />);
    expect(texts(price(container).querySelector(".plot__y")!.children)).toEqual(["0.9995", "0.99975", "1", "1.00025", "1.0005"]);
    // The first candle's wick runs the whole pane.
    const wick = slot(price(container), 0).querySelector<HTMLElement>(".candle__wick")!;
    expect([wick.style.bottom, wick.style.height]).toEqual(["0%", "100%"]);
    expect(errors).toEqual([]);
  });

  it("reads a price the data API wrote in exponent notation, and writes none", async () => {
    const rows: CandleData["candles"] = [{ o: "1.2345678e+8", h: "1.2345679e+8", l: "1.2345677e+8", c: "1.2345678e+8", v: "1", n: "1" }, null];
    const { html, container } = await serverThenHydrated(<Candles title={TITLE} data={priced(rows)} />);
    expect(readout(container).slice(1, 5)).toEqual(["O 123,456,780 USD", "H 123,456,790 USD", "L 123,456,770 USD", "C 123,456,780 USD"]);
    expect(html).not.toMatch(/\de[+-]?\d/);
  });
});

describe("Candles' mark prop", () => {
  const other = candles({ candles: CANDLES.map((candle) => (candle ? { ...candle, c: "2.3" } : null)) });

  it("sets no mark on either pane for a new token with mark={false}, though it redraws", () => {
    const { container, rerender } = render(<Candles title={TITLE} data={candles()} mark={false} />);
    rerender(<Candles title={TITLE} data={{ ...other, token: "c2" }} mark={false} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    expect(readout(container)).toContain("C 2.3 USD");
    rerender(<Candles title={TITLE} data={{ ...other, token: "c3" }} mark={false} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    expect(container.querySelectorAll(".plot")).toHaveLength(2);
  });

  it("still rings both panes by default, and with mark={true}", () => {
    for (const props of [{}, { mark: true }]) {
      const { container, rerender, unmount } = render(<Candles title={TITLE} data={candles()} {...props} />);
      rerender(<Candles title={TITLE} data={{ ...other, token: "c2" }} {...props} />);
      expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(2);
      unmount();
    }
  });
});

describe("Candles' empty text", () => {
  const none = candles({ candles: CANDLES.map(() => null) });

  it("says the page's words in the price pane when no candle is drawn, and keeps the kit's own without them", async () => {
    const asked = await serverThenHydrated(<Candles title={TITLE} data={none} empty="No trades in these 60 hours" />);
    expect(price(asked.container).querySelector(".plot__empty")!.textContent).toBe("No trades in these 60 hours");
    expect(sliders(asked.container)).toHaveLength(0);
    expect(asked.container.querySelector(".candles__readout")).toBeNull();
    expect(volume(asked.container).querySelector(".plot__empty")).toBeNull();
    expect(asked.errors).toEqual([]);
    cleanup();
    const plain = await serverThenHydrated(<Candles title={TITLE} data={none} />);
    expect(price(plain.container).querySelector(".plot__empty")!.textContent).toBe("No data for these 5 days");
  });

  it("is not said when a candle is drawn", async () => {
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={candles()} empty="No trades in these 60 hours" />);
    expect(container.querySelector(".plot__empty")).toBeNull();
    expect(container.innerHTML).not.toContain("No trades");
  });

  it("is part of what the component is memoised on, with the token and the title", () => {
    const { container, rerender } = render(<Candles title={TITLE} data={none} empty="No trades in these 60 hours" />);
    rerender(<Candles title={TITLE} data={none} empty="No trades in these 10 days" />);
    expect(container.querySelector(".plot__empty")!.textContent).toBe("No trades in these 10 days");
  });
});

describe("candleLegend", () => {
  it("gives the three items the page passes to Legend: closed higher, closed lower, and the volume in its unit", () => {
    expect(candleLegend(candles())).toEqual([
      { id: "up", label: "Closed higher", key: "swatch", slot: "up" },
      { id: "down", label: "Closed lower", key: "swatch", slot: "down" },
      { id: "volume", label: "Volume (XRP)", key: "swatch", slot: "other" },
    ]);
  });

  it("names the volume with no parentheses when its format has no unit", () => {
    expect(candleLegend(candles({ volume: { kind: "count" } })).map((item) => item.label)).toEqual(["Closed higher", "Closed lower", "Volume"]);
  });

  it("is drawn by Legend as three swatches in the colours of up, down and the volume columns", () => {
    const { container } = render(<Legend items={candleLegend(candles())} />);
    expect(texts(container.querySelectorAll(".legend__item"))).toEqual(["Closed higher", "Closed lower", "Volume (XRP)"]);
    expect(Array.from(container.querySelectorAll(".legend__swatch"), (swatch) => swatch.getAttribute("data-slot"))).toEqual(["up", "down", "other"]);
  });
});

describe("Candles' states (spec 2.8)", () => {
  const none = candles({ candles: CANDLES.map(() => null) });

  it("says 'No data for these 5 days' in the price pane when every candle is null, with no cursor, no readout and no candle", async () => {
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={none} />);
    expect(price(container).querySelector(".plot__empty")!.textContent).toBe("No data for these 5 days");
    expect(sliders(container)).toHaveLength(0);
    expect(container.querySelector(".candles__readout")).toBeNull();
    expect(container.querySelector(".candle")).toBeNull();
    expect(container.querySelector(".col__bar")).toBeNull();
    // The axes stay at the empty domain, and the volume pane says nothing of its own.
    expect(texts(volume(container).querySelector(".plot__y")!.children)).toEqual(["0", "0.5", "1"]);
    expect(volume(container).querySelector(".plot__empty")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("says 'No data' for an axis with no buckets", async () => {
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={candles({ axis: { unit: "day", buckets: [] }, candles: [] })} />);
    expect(price(container).querySelector(".plot__empty")!.textContent).toBe("No data");
    expect(errors).toEqual([]);
  });

  it("draws a day on which nothing moved: a flat candle of a single price, on the scale of a single price", async () => {
    const flat = candles({ candles: [{ o: "2.4", h: "2.4", l: "2.4", c: "2.4", v: "10", n: "1" }, null, null, null, null] });
    const { container, errors } = await serverThenHydrated(<Candles title={TITLE} data={flat} />);
    expect(price(container).querySelectorAll(".candle")).toHaveLength(1);
    expect(texts(price(container).querySelector(".plot__y")!.children).length).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  it("leaves out a candle whose prices are not numbers, and keeps its volume out with it", async () => {
    const broken = candles({ candles: [{ ...CANDLES[0]!, h: "" }, ...CANDLES.slice(1)] });
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={broken} />);
    expect(price(container).querySelectorAll(".candle")).toHaveLength(3);
    expect(slot(price(container), 0).children).toHaveLength(0);
  });

  it("draws a candle with no volume, and no column for it", async () => {
    const quiet = candles({ candles: [{ ...CANDLES[0]!, v: "" }, ...CANDLES.slice(1)] });
    const { container } = await serverThenHydrated(<Candles title={TITLE} data={quiet} />);
    expect(price(container).querySelectorAll(".candle")).toHaveLength(4);
    expect(volume(container).querySelectorAll(".col__bar")).toHaveLength(3);
  });
});

describe("Candles in its card: the table view of the same data", () => {
  const card = (data: CandleData) => (
    <ChartCard id="price" title="Price" source="/v2/exchanges/XRP/USD" what="the price" legend={<Legend items={candleLegend(data)} />} table={<ChartTable title="Price" data={data} />}>
      <Candles title="Price" data={data} />
    </ChartCard>
  );
  const grid = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="row"]'), (row) => Array.from(row.querySelectorAll('[role="columnheader"], [role="cell"]'), (cell) => cell.textContent ?? ""));

  it("has Open, High, Low, Close, Volume and Trades, newest first, with the exact figures, and the legend above the panes", async () => {
    const { container, errors } = await serverThenHydrated(card(candles()));
    const rows = grid(container);
    expect(rows[0]).toEqual(["Day (UTC)", "Open", "High", "Low", "Close", "Volume", "Trades"]);
    // The prices are `formatPrice` text: the trailing zero of 2.40 is gone.
    expect(rows[1]).toEqual(["Oct 16, 2026", "2.41", "2.48", "2.4", "2.47", "1,500,000", "402"]);
    expect(rows).toHaveLength(6);
    expect(container.querySelectorAll(".legend__item")).toHaveLength(3);
    expect(container.querySelectorAll(".candles .candle")).toHaveLength(4);
    expect(errors).toEqual([]);
  });
});

describe("Candles, memoised on the token (spec 2.9)", () => {
  const other = candles({ candles: CANDLES.map((candle) => (candle ? { ...candle, c: "2.3" } : null)) });

  it("is not rendered again for the same token: the DOM stays, though the numbers it was handed are others", () => {
    const { container, rerender } = render(<Candles title={TITLE} data={candles()} />);
    const first = container.querySelector(".candle");
    expect(readout(container)[0]).toBe("Oct 16, 2026");
    expect(readout(container)).toContain("C 2.47 USD");

    rerender(<Candles title={TITLE} data={{ ...other, token: "c1" }} />);
    expect(container.querySelector(".candle")).toBe(first);
    expect(readout(container)).toContain("C 2.47 USD");
    expect(container.querySelector(".plot.is-changed")).toBeNull();

    rerender(<Candles title={TITLE} data={{ ...candles() }} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
  });

  it("is drawn again for a new token, and each pane rings once", () => {
    const { container, rerender } = render(<Candles title={TITLE} data={candles()} />);
    expect(container.querySelector(".plot.is-changed")).toBeNull();
    rerender(<Candles title={TITLE} data={{ ...other, token: "c2" }} />);
    expect(container.querySelectorAll(".plot.is-changed")).toHaveLength(2);
    expect(readout(container)).toContain("C 2.3 USD");
  });

  it("is drawn again for another title, which is part of what it is memoised on", () => {
    const { container, rerender } = render(<Candles title={TITLE} data={candles()} />);
    rerender(<Candles title="Price, USD/XRP" data={candles()} />);
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("Price, USD/XRP, closing price");
  });
});
