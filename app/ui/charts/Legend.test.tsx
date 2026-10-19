import { describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { Legend, legendOf, type LegendItem } from "./Legend";
import type { Series, TimeSeriesData } from "./types";

const series = (id: string, label: string, slot: Series["slot"]): Series => ({ id, label, slot, values: ["1", "2"] });

const data = (extra: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
  axis: { unit: "day", buckets: ["2026-10-16", "2026-10-17"] },
  series: [series("payment", "Payment", 1), series("offer", "OfferCreate", 2), series("other", "Other", "other")],
  format: { kind: "count" },
  token: "t",
  ...extra,
});

const swatches: LegendItem[] = [
  { id: "payment", label: "Payment", key: "swatch", slot: 1 },
  { id: "offer", label: "OfferCreate", key: "swatch", slot: 2 },
];

describe("Legend", () => {
  it("renders nothing for one series: the title names it", async () => {
    const { html, container, errors } = await serverThenHydrated(<Legend items={[swatches[0]!]} />);
    expect(html).toBe("");
    expect(container.innerHTML).toBe("");
    expect(errors).toEqual([]);
  });

  it("renders nothing for no items, and for one line key", async () => {
    const none = await serverThenHydrated(<Legend items={[]} />);
    expect(none.html).toBe("");
    const line = await serverThenHydrated(<Legend items={[{ id: "a", label: "A", key: "line", slot: 1 }]} />);
    expect(line.html).toBe("");
    expect(line.errors).toEqual([]);
  });

  it("renders two series as two swatches, in series order, each in its slot", async () => {
    const { container, errors } = await serverThenHydrated(<Legend items={swatches} />);
    const list = container.querySelector("ul.legend")!;
    expect(list.getAttribute("aria-label")).toBe("Legend");
    const items = Array.from(list.querySelectorAll("li"));
    expect(items.map((item) => item.textContent)).toEqual(["Payment", "OfferCreate"]);
    const marks = Array.from(container.querySelectorAll(".legend__swatch"));
    expect(marks).toHaveLength(2);
    expect(marks.map((mark) => mark.getAttribute("data-slot"))).toEqual(["1", "2"]);
    expect(marks.every((mark) => mark.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(marks.map((mark) => mark.closest("li"))).toEqual(items);
    expect(container.querySelector(".legend__line")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("renders line keys for the lines, in series order", async () => {
    const items = legendOf(data(), "line");
    const { container, errors } = await serverThenHydrated(<Legend items={items} />);
    const keys = Array.from(container.querySelectorAll(".legend__line"));
    expect(keys.map((key) => key.getAttribute("data-slot"))).toEqual(["1", "2", "other"]);
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["Payment", "OfferCreate", "Other"]);
    expect(container.querySelector(".legend__swatch")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("gives the slots up, down and neutral their own marks", async () => {
    const items: LegendItem[] = [
      { id: "in", label: "Received, drawn up", key: "swatch", slot: "up" },
      { id: "out", label: "Sent, drawn down", key: "swatch", slot: "down" },
      { id: "net", label: "Net", key: "swatch", slot: "neutral" },
    ];
    const { container, errors } = await serverThenHydrated(<Legend items={items} />);
    expect(Array.from(container.querySelectorAll(".legend__swatch")).map((mark) => mark.getAttribute("data-slot"))).toEqual(["up", "down", "neutral"]);
    expect(errors).toEqual([]);
  });

  it("renders a symbol entry with its symbol and its words", async () => {
    const items: LegendItem[] = [...swatches, { id: "failed", label: "has a failed transaction", key: "symbol", symbol: "×" }];
    const { container, errors } = await serverThenHydrated(<Legend items={items} />);
    const entries = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
    expect(entries).toEqual(["Payment", "OfferCreate", "× has a failed transaction"]);
    const symbol = container.querySelector(".legend__symbol")!;
    expect(symbol.textContent).toBe("×");
    expect(container.querySelectorAll(".legend__swatch")).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("renders one series together with a symbol entry: the symbol is a key of its own", async () => {
    const items: LegendItem[] = [
      { id: "payment", label: "Payment", key: "swatch", slot: 1 },
      { id: "failed", label: "has a failed transaction", key: "symbol", symbol: "×" },
    ];
    const { container, errors } = await serverThenHydrated(<Legend items={items} />);
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["Payment", "× has a failed transaction"]);
    expect(errors).toEqual([]);
  });

  it("renders a symbol entry alone", async () => {
    const { container, errors } = await serverThenHydrated(<Legend items={[{ id: "x", label: "failed", key: "symbol", symbol: "×" }]} />);
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe("legendOf", () => {
  it("lists the series in their order, with their slots and the key asked for", () => {
    expect(legendOf(data(), "swatch")).toEqual([
      { id: "payment", label: "Payment", key: "swatch", slot: 1 },
      { id: "offer", label: "OfferCreate", key: "swatch", slot: 2 },
      { id: "other", label: "Other", key: "swatch", slot: "other" },
    ]);
    expect(legendOf(data(), "line").map((item) => item.key)).toEqual(["line", "line", "line"]);
  });

  it("adds one symbol entry for annotations of the same symbol and words, after the series", () => {
    const annotations = [
      { bucket: 0, symbol: "×", label: "has a failed transaction" },
      { bucket: 1, symbol: "×", label: "has a failed transaction" },
    ];
    const items = legendOf(data({ annotations }), "swatch");
    expect(items.map((item) => item.key)).toEqual(["swatch", "swatch", "swatch", "symbol"]);
    expect(items.at(-1)).toMatchObject({ key: "symbol", symbol: "×", label: "has a failed transaction" });
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("adds one entry for each distinct annotation, in the order first seen", () => {
    const annotations = [
      { bucket: 0, symbol: "×", label: "has a failed transaction" },
      { bucket: 1, symbol: "!", label: "was a maintenance day" },
      { bucket: 2, symbol: "×", label: "has a failed transaction" },
      { bucket: 3, symbol: "×", label: "had a reorg" },
    ];
    const items = legendOf(data({ annotations }), "line").filter((item) => item.key === "symbol");
    expect(items.map((item) => [item.symbol, item.label])).toEqual([
      ["×", "has a failed transaction"],
      ["!", "was a maintenance day"],
      ["×", "had a reorg"],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });

  it("is the series alone when there are no annotations", () => {
    expect(legendOf(data({ annotations: [] }), "swatch")).toHaveLength(3);
    expect(legendOf(data({ annotations: undefined }), "swatch")).toHaveLength(3);
  });

  it("makes a legend of one series with an annotation that draws both entries", async () => {
    const one = data({ series: [series("payment", "Payment", 1)], annotations: [{ bucket: 1, symbol: "×", label: "has a failed transaction" }] });
    const { container, errors } = await serverThenHydrated(<Legend items={legendOf(one, "swatch")} />);
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["Payment", "× has a failed transaction"]);
    expect(errors).toEqual([]);
  });

  it("makes no legend of one series without annotations", async () => {
    const one = data({ series: [series("payment", "Payment", 1)] });
    const { html } = await serverThenHydrated(<Legend items={legendOf(one, "swatch")} />);
    expect(html).toBe("");
  });
});
