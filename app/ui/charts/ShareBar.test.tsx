import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ChartCard } from "./ChartCard";
import { ChartTable } from "./ChartTable";
import { percent } from "./geometry";
import { Legend } from "./Legend";
import { ShareBar, shareLegend } from "./ShareBar";
import type { ShareData } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// 100% stacked horizontal rows (spec 2.3 and 2.11): a row is 28 px high with a label column; its segments are in their order, each as wide as
// its share of the row's total, with 2 px gaps and a 4 px radius at the row's ends; a segment of 18% or more has its label under it; a %
// axis is under the rows; and the cursor steps through the segments in reading order, row by row.

const TITLE = "Validator software versions";

const DATA: ShareData = {
  rows: [
    {
      id: "unl",
      label: "UNL",
      total: "35",
      segments: [
        { id: "3.4.1", label: "3.4.1", slot: 1, value: "12" },
        { id: "3.3.0", label: "3.3.0", slot: 2, value: "10" },
        { id: "3.2.2", label: "3.2.2", slot: 3, value: "8" },
        { id: "3.1.0", label: "3.1.0", slot: 4, value: "5" },
      ],
    },
    {
      id: "all",
      label: "All",
      total: "120",
      segments: [
        { id: "3.4.1", label: "3.4.1", slot: 1, value: "41" },
        { id: "3.3.0", label: "3.3.0", slot: 2, value: "30" },
        { id: "3.2.2", label: "3.2.2", slot: 3, value: "25" },
        { id: "3.1.0", label: "3.1.0", slot: 4, value: "14" },
        { id: "other", label: "Other", slot: "other", value: "10" },
      ],
    },
  ],
  token: "s1",
};

function shares(extra: Partial<ShareData> = {}): ShareData {
  return { ...DATA, ...extra };
}

const rowEls = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".share__row:not(.share__row--axis)"));
const segs = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>(".share__seg"));
const labelsOf = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>(".share__label"));
const texts = (nodes: ArrayLike<Element>) => Array.from(nodes, (node) => node.textContent);
const slider = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="slider"]')!;
const tip = (container: HTMLElement) => container.querySelector<HTMLElement>(".plot__tip");
const lines = (el: HTMLElement) => Array.from(el.querySelectorAll(".plot__tip-date, .plot__tip-row"), (line) => line.textContent);
const active = (container: HTMLElement) => Array.from(container.querySelectorAll(".share__seg.is-active"), (seg) => seg.getAttribute("data-bucket"));

describe("ShareBar as the Worker prints it and the browser takes it over", () => {
  it("draws a row for each of the data's rows, with its label and its total in a column of their own, and no slider in the HTML", async () => {
    const { html, container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    expect(html).not.toContain('role="slider"');
    const rows = rowEls(container);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => texts(row.querySelectorAll(".share__name > *")))).toEqual([["UNL", "35"], ["All", "120"]]);
    expect(rows.map((row) => segs(row).length)).toEqual([4, 5]);
    expect(errors).toEqual([]);
  });

  it("draws the segments in their order, in the colours of their slots, each as wide as its share of the row's total", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const [unl, all] = rowEls(container);
    expect(segs(unl!).map((seg) => seg.style.width)).toEqual([12, 10, 8, 5].map((v) => percent(v / 35, 3)));
    expect(segs(unl!).map((seg) => seg.style.width)).toEqual(["34.286%", "28.571%", "22.857%", "14.286%"]);
    expect(segs(all!).map((seg) => seg.style.width)).toEqual(["34.167%", "25%", "20.833%", "11.667%", "8.333%"]);
    expect(segs(unl!).map((seg) => seg.getAttribute("data-slot"))).toEqual(["1", "2", "3", "4"]);
    expect(segs(all!).map((seg) => seg.getAttribute("data-slot"))).toEqual(["1", "2", "3", "4", "other"]);
    expect(errors).toEqual([]);
  });

  it("puts the label of a segment of 34% under it and none under one of 14%: the name and the share, at the segment's own place and width", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const [unl, all] = rowEls(container);
    // UNL: 34%, 29%, 23% have one; 14% does not.
    expect(texts(labelsOf(unl!))).toEqual(["3.4.1 34%", "3.3.0 29%", "3.2.2 23%"]);
    expect(labelsOf(unl!).map((label) => [label.style.left, label.style.width])).toEqual([
      ["0%", "34.286%"],
      ["34.286%", "28.571%"],
      ["62.857%", "22.857%"],
    ]);
    // All: 34%, 25%, 21%; not 12% or 8%.
    expect(texts(labelsOf(all!))).toEqual(["3.4.1 34%", "3.3.0 25%", "3.2.2 21%"]);
    // The name is strong, and the labels are decoration: the slider and the table carry the words.
    expect(labelsOf(unl!)[0]!.querySelector("b")!.textContent).toBe("3.4.1");
    expect(labelsOf(unl!)[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("labels a segment at 18% and not under it, by the exact share and not by the rounded text", async () => {
    const row = (value: string) => ({
      rows: [
        {
          id: "r",
          label: "R",
          total: "50",
          segments: [
            { id: "a", label: "A", slot: 1 as const, value },
            { id: "b", label: "B", slot: 2 as const, value: String(50 - Number(value)) },
          ],
        },
      ],
      token: "x",
    });
    // 9 of 50 is exactly 18%; 8.9 of 50 is 17.8%, which `sharePercent` would write as 18%.
    const at = await serverThenHydrated(<ShareBar title={TITLE} data={row("9")} />);
    expect(texts(labelsOf(rowEls(at.container)[0]!))).toEqual(["A 18%", "B 82%"]);
    cleanup();
    const under = await serverThenHydrated(<ShareBar title={TITLE} data={row("8.9")} />);
    expect(texts(labelsOf(rowEls(under.container)[0]!))).toEqual(["B 82%"]);
  });

  it("gives the row 28 px of bar, and says the % axis under the rows: 0 to 100% in quarters, the ends inside the plot", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const axis = container.querySelector<HTMLElement>(".share__axis")!;
    expect(texts(axis.children)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(Array.from(axis.children, (tick) => (tick as HTMLElement).style.left)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(axis.getAttribute("aria-hidden")).toBe("true");
    // It is after the last row, and in the column of the bars, not of the labels.
    const last = rowEls(container).at(-1)!;
    expect(last.compareDocumentPosition(axis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(axis.closest(".share__row--axis")!.firstElementChild!.textContent).toBe("");
    expect(errors).toEqual([]);
  });

  it("names the image for a screen reader with the largest segment of each row, and hides the marks", async () => {
    const { container } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const image = container.querySelector('[role="img"]')!;
    expect(image.getAttribute("aria-label")).toBe("Validator software versions. UNL: largest 3.4.1, 34%. All: largest 3.4.1, 34%. Choose Table for every value.");
    for (const seg of container.querySelectorAll(".share__seg")) expect(seg.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
  });
});

describe("ShareBar's cursor", () => {
  it("says the first segment to the slider: the row, the segment, its value of the total, and its share", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const control = slider(container);
    expect(control.getAttribute("aria-valuetext")).toBe("UNL: 3.4.1, 12 of 35 (34%)");
    expect(control.getAttribute("aria-valuemin")).toBe("0");
    expect(control.getAttribute("aria-valuemax")).toBe("8");
    expect(control.getAttribute("aria-valuenow")).toBe("0");
    expect(control.getAttribute("aria-label")).toBe("Validator software versions, segment by segment");
    expect(control.getAttribute("tabindex")).toBe("0");
    expect(errors).toEqual([]);
  });

  it("steps through the segments in reading order, a row and then the next, with the arrow keys, Home and End", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const control = slider(container);
    const text = () => control.getAttribute("aria-valuetext");
    fireEvent.focus(control);
    expect(text()).toBe("UNL: 3.4.1, 12 of 35 (34%)");
    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(text()).toBe("UNL: 3.3.0, 10 of 35 (29%)");
    fireEvent.keyDown(control, { key: "ArrowRight" });
    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(text()).toBe("UNL: 3.1.0, 5 of 35 (14%)");
    // From the last segment of a row to the first of the next.
    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(text()).toBe("All: 3.4.1, 41 of 120 (34%)");
    expect(control.getAttribute("aria-valuenow")).toBe("4");
    fireEvent.keyDown(control, { key: "ArrowLeft" });
    expect(text()).toBe("UNL: 3.1.0, 5 of 35 (14%)");
    fireEvent.keyDown(control, { key: "End" });
    expect(text()).toBe("All: Other, 10 of 120 (8%)");
    // It stops at the ends.
    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(control.getAttribute("aria-valuenow")).toBe("8");
    fireEvent.keyDown(control, { key: "Home" });
    fireEvent.keyDown(control, { key: "ArrowLeft" });
    expect(control.getAttribute("aria-valuenow")).toBe("0");
    expect(errors).toEqual([]);
  });

  it("leaves the browser's own shortcuts alone, and keys that are not the cursor's", async () => {
    const { container } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const control = slider(container);
    fireEvent.keyDown(control, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(control, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(control, { key: "a" });
    expect(control.getAttribute("aria-valuenow")).toBe("0");
  });

  it("marks the segment it is on and dims the others, in both rows, and shows the tooltip under that segment's row; Escape and blur hide it", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const control = slider(container);
    expect(container.querySelector(".share")!.hasAttribute("data-active")).toBe(false);
    expect(tip(container)).toBeNull();
    fireEvent.focus(control);
    expect(active(container)).toEqual(["0"]);
    expect(container.querySelector(".share")!.getAttribute("data-active")).toBe("0");
    expect(rowEls(container)[0]!.contains(tip(container))).toBe(true);
    expect(lines(tip(container)!)).toEqual(["UNL", "3.4.1", "12 of 35 (34%)"]);
    expect(tip(container)!.getAttribute("aria-hidden")).toBe("true");
    expect(tip(container)!.querySelector(".plot__tip-key")!.getAttribute("data-slot")).toBe("1");
    fireEvent.keyDown(control, { key: "End" });
    expect(active(container)).toEqual(["8"]);
    expect(rowEls(container)[1]!.contains(tip(container))).toBe(true);
    expect(lines(tip(container)!)).toEqual(["All", "Other", "10 of 120 (8%)"]);
    expect(tip(container)!.querySelector(".plot__tip-key")!.getAttribute("data-slot")).toBe("other");
    fireEvent.keyDown(control, { key: "Escape" });
    expect(active(container)).toEqual([]);
    expect(tip(container)).toBeNull();
    expect(control.getAttribute("aria-valuenow")).toBe("8");
    fireEvent.keyDown(control, { key: "Home" });
    expect(active(container)).toEqual(["0"]);
    fireEvent.blur(control);
    expect(tip(container)).toBeNull();
    expect(errors).toEqual([]);
  });

  it("opens the tooltip on the side that keeps it in the plot: right near the start, left near the end, centred between", async () => {
    const { container } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const control = slider(container);
    const side = () => ["right", "left", "center"].find((name) => tip(container)!.classList.contains(name));
    fireEvent.focus(control);
    expect(side()).toBe("right");
    expect(tip(container)!.style.left).toBe(percent(12 / 35 / 2, 3));
    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(side()).toBe("center");
    fireEvent.keyDown(control, { key: "End" });
    expect(side()).toBe("left");
  });

  it("follows the pointer over a segment, in either row, and leaves with it", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const [unl, all] = rowEls(container);
    fireEvent.pointerMove(segs(unl!)[2]!, { pointerType: "mouse" });
    expect(active(container)).toEqual(["2"]);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("UNL: 3.2.2, 8 of 35 (23%)");
    expect(lines(tip(container)!)).toEqual(["UNL", "3.2.2", "8 of 35 (23%)"]);
    fireEvent.pointerMove(segs(all!)[1]!, { pointerType: "mouse" });
    expect(active(container)).toEqual(["5"]);
    expect(rowEls(container)[1]!.contains(tip(container))).toBe(true);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("All: 3.3.0, 30 of 120 (25%)");
    // Off the segments, over the row's label column or a label: nothing is hovered.
    fireEvent.pointerMove(all!.querySelector(".share__name")!, { pointerType: "mouse" });
    expect(active(container)).toEqual([]);
    expect(tip(container)).toBeNull();
    fireEvent.pointerMove(segs(unl!)[0]!, { pointerType: "mouse" });
    expect(active(container)).toEqual(["0"]);
    fireEvent.pointerLeave(container.querySelector(".share__rows")!, { pointerType: "mouse" });
    expect(active(container)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("keeps what a touch selected until a touch lands elsewhere, since a finger that lifts is not a pointer that leaves", async () => {
    const { container } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    const [unl] = rowEls(container);
    fireEvent.pointerDown(segs(unl!)[1]!, { pointerType: "touch" });
    expect(active(container)).toEqual(["1"]);
    fireEvent.pointerLeave(container.querySelector(".share__rows")!, { pointerType: "touch" });
    expect(active(container)).toEqual(["1"]);
    expect(tip(container)).not.toBeNull();
    // Another segment is selected by the next touch, and the one touched stays.
    fireEvent.pointerDown(segs(unl!)[3]!, { pointerType: "touch" });
    expect(active(container)).toEqual(["3"]);
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(active(container)).toEqual([]);
    expect(tip(container)).toBeNull();
  });
});

describe("shareLegend", () => {
  it("has one item for each segment id, in the order they are first met, a swatch in the slot of its first row", () => {
    expect(shareLegend(DATA)).toEqual([
      { id: "3.4.1", label: "3.4.1", key: "swatch", slot: 1 },
      { id: "3.3.0", label: "3.3.0", key: "swatch", slot: 2 },
      { id: "3.2.2", label: "3.2.2", key: "swatch", slot: 3 },
      { id: "3.1.0", label: "3.1.0", key: "swatch", slot: 4 },
      { id: "other", label: "Other", key: "swatch", slot: "other" },
    ]);
  });

  it("has an item for a segment that only a later row has, and none for a row with no segments", () => {
    const later = shares({ rows: [{ id: "a", label: "A", total: "5", segments: [{ id: "x", label: "X", slot: 1, value: "5" }] }, { id: "b", label: "B", total: "0", segments: [{ id: "y", label: "Y", slot: 2, value: "0" }] }] });
    expect(shareLegend(later).map((item) => item.id)).toEqual(["x", "y"]);
    expect(shareLegend(shares({ rows: [] }))).toEqual([]);
  });

  it("is drawn by Legend as swatches in the colours of the slots", () => {
    const { container } = render(<Legend items={shareLegend(DATA)} />);
    expect(texts(container.querySelectorAll(".legend__item"))).toEqual(["3.4.1", "3.3.0", "3.2.2", "3.1.0", "Other"]);
    expect(Array.from(container.querySelectorAll(".legend__swatch"), (swatch) => swatch.getAttribute("data-slot"))).toEqual(["1", "2", "3", "4", "other"]);
  });
});

describe("ShareBar's states (spec 2.8)", () => {
  it("says 'No data' when there are no rows, with no cursor", async () => {
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares({ rows: [] })} />);
    expect(container.querySelector(".share__empty")!.textContent).toBe("No data");
    expect(container.querySelector('[role="slider"]')).toBeNull();
    expect(container.querySelector(".share__seg")).toBeNull();
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Validator software versions: No data.");
    expect(errors).toEqual([]);
  });

  it("says 'No data' when no row has anything to draw: a total of 0, or only segments of 0", async () => {
    const empty = shares({ rows: [{ id: "a", label: "A", total: "0", segments: [{ id: "x", label: "X", slot: 1, value: "0" }] }] });
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={empty} />);
    expect(container.querySelector(".share__empty")!.textContent).toBe("No data");
    expect(container.querySelector('[role="slider"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it("draws no segment for a value of 0 or one that is not a number, and steps over it", async () => {
    const mixed = shares({
      rows: [
        {
          id: "a",
          label: "A",
          total: "10",
          segments: [
            { id: "x", label: "X", slot: 1, value: "10" },
            { id: "y", label: "Y", slot: 2, value: "0" },
            { id: "z", label: "Z", slot: 3, value: "" },
          ],
        },
        { id: "b", label: "B", total: "4", segments: [{ id: "x", label: "X", slot: 1, value: "4" }] },
      ],
    });
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={mixed} />);
    expect(rowEls(container).map((row) => segs(row).length)).toEqual([1, 1]);
    expect(slider(container).getAttribute("aria-valuemax")).toBe("1");
    fireEvent.keyDown(slider(container), { key: "ArrowRight" });
    expect(slider(container).getAttribute("aria-valuetext")).toBe("B: X, 4 of 4 (100%)");
    expect(errors).toEqual([]);
  });

  it("keeps a row that has no total or nothing to draw as its label and an empty bar, and draws the others", async () => {
    const some = shares({
      rows: [
        { id: "a", label: "A", total: "10", segments: [{ id: "x", label: "X", slot: 1, value: "10" }] },
        { id: "b", label: "B", total: "0", segments: [{ id: "x", label: "X", slot: 1, value: "0" }] },
      ],
    });
    const { container } = await serverThenHydrated(<ShareBar title={TITLE} data={some} />);
    expect(rowEls(container).map((row) => segs(row).length)).toEqual([1, 0]);
    expect(texts(rowEls(container)[1]!.querySelectorAll(".share__name > *"))).toEqual(["B", "0"]);
    expect(rowEls(container)[1]!.querySelector(".share__bar")).not.toBeNull();
  });

  it("writes a share under half a percent as <1% and draws it as a sliver, which is the least width the stylesheet keeps", async () => {
    const sliver = shares({ rows: [{ id: "a", label: "A", total: "1000", segments: [{ id: "x", label: "X", slot: 1, value: "999" }, { id: "y", label: "Y", slot: 2, value: "1" }] }] });
    const { container } = await serverThenHydrated(<ShareBar title={TITLE} data={sliver} />);
    fireEvent.keyDown(slider(container), { key: "End" });
    expect(slider(container).getAttribute("aria-valuetext")).toBe("A: Y, 1 of 1,000 (<1%)");
    expect(segs(rowEls(container)[0]!)[1]!.style.width).toBe("0.1%");
    expect(texts(labelsOf(rowEls(container)[0]!))).toEqual(["X 100%"]);
  });

  it("writes the values in full, with separators, as the table does", async () => {
    const big = shares({ rows: [{ id: "a", label: "A", total: "1284331", segments: [{ id: "x", label: "X", slot: 1, value: "1000000" }, { id: "y", label: "Y", slot: 2, value: "284331" }] }] });
    const { container } = await serverThenHydrated(<ShareBar title={TITLE} data={big} />);
    expect(slider(container).getAttribute("aria-valuetext")).toBe("A: X, 1,000,000 of 1,284,331 (78%)");
    expect(texts(rowEls(container)[0]!.querySelectorAll(".share__name > *"))).toEqual(["A", "1,284,331"]);
  });

  it("draws one row and one segment: the whole bar", async () => {
    const one = shares({ rows: [{ id: "a", label: "A", total: "7", segments: [{ id: "x", label: "X", slot: 1, value: "7" }] }] });
    const { container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={one} />);
    expect(segs(rowEls(container)[0]!)[0]!.style.width).toBe("100%");
    expect(texts(labelsOf(rowEls(container)[0]!))).toEqual(["X 100%"]);
    expect(slider(container).getAttribute("aria-valuemax")).toBe("0");
    expect(errors).toEqual([]);
  });
});

describe("ShareBar in its card: the table view of the same data", () => {
  const card = (data: ShareData) => (
    <ChartCard id="versions" title={TITLE} source="/v2/network/validators" what="the versions" legend={<Legend items={shareLegend(data)} />} table={<ChartTable title={TITLE} data={data} />}>
      <ShareBar title={TITLE} data={data} />
    </ChartCard>
  );
  const grid = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="row"]'), (row) => Array.from(row.querySelectorAll('[role="columnheader"], [role="cell"]'), (cell) => cell.textContent ?? ""));

  it("has a column for each segment id, after the name and the total, with the same values", async () => {
    const { container, errors } = await serverThenHydrated(card(DATA));
    const rows = grid(container);
    expect(rows[0]).toEqual(["Name", "Total", "3.4.1", "3.3.0", "3.2.2", "3.1.0", "Other"]);
    expect(rows[1]).toEqual(["UNL", "35", "12", "10", "8", "5", "—no data"]);
    expect(rows[2]).toEqual(["All", "120", "41", "30", "25", "14", "10"]);
    expect(rows).toHaveLength(3);
    // Both views are in the page, and so is the legend: five swatches.
    expect(container.querySelectorAll(".share .share__row:not(.share__row--axis)")).toHaveLength(2);
    expect(container.querySelectorAll(".legend__item")).toHaveLength(5);
    expect(errors).toEqual([]);
  });
});

describe("ShareBar, memoised on the token (spec 2.9)", () => {
  const other = shares({ rows: [{ id: "unl", label: "UNL", total: "20", segments: [{ id: "3.4.1", label: "3.4.1", slot: 1, value: "20" }] }] });

  it("is not rendered again for the same token: the DOM stays, though the numbers it was handed are others", () => {
    const { container, rerender } = render(<ShareBar title={TITLE} data={shares()} />);
    const first = container.querySelector(".share__seg");
    expect(container.querySelectorAll(".share__seg")).toHaveLength(9);

    rerender(<ShareBar title={TITLE} data={{ ...other, token: "s1" }} />);
    expect(container.querySelector(".share__seg")).toBe(first);
    expect(container.querySelectorAll(".share__seg")).toHaveLength(9);
    expect(container.querySelector(".share.is-changed")).toBeNull();

    rerender(<ShareBar title={TITLE} data={{ ...shares() }} />);
    expect(container.querySelector(".share.is-changed")).toBeNull();
  });

  it("is drawn again for a new token, and rings once", () => {
    const { container, rerender } = render(<ShareBar title={TITLE} data={shares()} />);
    expect(container.querySelector(".share.is-changed")).toBeNull();
    rerender(<ShareBar title={TITLE} data={{ ...other, token: "s2" }} />);
    expect(container.querySelectorAll(".share.is-changed")).toHaveLength(1);
    expect(container.querySelectorAll(".share__seg")).toHaveLength(1);
  });

  it("does not ring on the server's render or on hydration", async () => {
    const { html, container, errors } = await serverThenHydrated(<ShareBar title={TITLE} data={shares()} />);
    expect(html).not.toContain("is-changed");
    expect(container.querySelector(".share.is-changed")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("is drawn again for another title, which is part of what it is memoised on", () => {
    const { container, rerender } = render(<ShareBar title={TITLE} data={shares()} />);
    rerender(<ShareBar title="Amendment votes" data={shares()} />);
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toMatch(/^Amendment votes\./);
  });

  it("keeps the cursor in range when new data has fewer segments than the one it was on", async () => {
    const { container, rerender } = render(<ShareBar title={TITLE} data={shares()} />);
    fireEvent.keyDown(slider(container), { key: "End" });
    expect(slider(container).getAttribute("aria-valuenow")).toBe("8");
    rerender(<ShareBar title={TITLE} data={{ ...other, token: "s3" }} />);
    expect(slider(container).getAttribute("aria-valuenow")).toBe("0");
    expect(slider(container).getAttribute("aria-valuetext")).toBe("UNL: 3.4.1, 20 of 20 (100%)");
  });
});
