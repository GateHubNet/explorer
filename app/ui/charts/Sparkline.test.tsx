import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { Sparkline } from "./Sparkline";

afterEach(cleanup);

// A trend with no axes (spec 2.11): a line in a box of 100 × 28 px and a dot at its end, read from its label alone. The line and the dot are
// kept 6 px (the dot and its ring) from the box's edges, so that nothing is cut. It has no hover and no cursor: the row or the tile it sits
// in says the values.

const LABEL = "7-day price, from 2.38 to 2.44, +2.5%";
/** The lowest first and the highest last: the line runs from the bottom left to the top right of its 88 × 16 px area. */
const PRICES = ["2.38", "2.40", "2.39", "2.41", "2.43", "2.42", "2.44"];

const line = (container: HTMLElement) => container.querySelector<SVGPathElement>(".spark__line");
const dot = (container: HTMLElement) => container.querySelector<SVGCircleElement>(".spark__dot");
const ring = (container: HTMLElement) => container.querySelector<SVGCircleElement>(".spark__ring");

describe("Sparkline as the Worker prints it and the browser takes it over", () => {
  it("is one image of 100 × 28 px, named by its label, with the line and the end dot in the HTML", async () => {
    const { html, container, errors } = await serverThenHydrated(<Sparkline values={PRICES} label={LABEL} />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    const svg = svgs[0]!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(LABEL);
    expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("viewBox")]).toEqual(["100", "28", "0 0 100 28"]);
    expect(svg.classList.contains("spark")).toBe(true);
    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(line(container)).not.toBeNull();
    expect(dot(container)).not.toBeNull();
    expect(html).not.toContain("NaN");
    expect(errors).toEqual([]);
  });

  it("draws the values from the lowest to the highest over the area, with no axis: x by the place, y from the bottom of the box to its top", async () => {
    const { container } = await serverThenHydrated(<Sparkline values={PRICES} label={LABEL} />);
    // 88 wide, 16 high: the first value is the lowest (the bottom), the last the highest (the top); 2.40 is a third of the way up.
    expect(line(container)!.getAttribute("d")).toBe("M0,16L14.67,10.67L29.33,13.33L44,8L58.67,2.67L73.33,5.33L88,0");
    // The area is 6 px in from the box's edge, which is where the dot and its ring end.
    expect(container.querySelector("g")!.getAttribute("transform")).toBe("translate(6 6)");
  });

  it("puts the end dot of 8 px, with its ring of 2 px, on the last value", async () => {
    const { container } = await serverThenHydrated(<Sparkline values={PRICES} label={LABEL} />);
    expect([dot(container)!.getAttribute("cx"), dot(container)!.getAttribute("cy"), dot(container)!.getAttribute("r")]).toEqual(["88", "0", "4"]);
    expect([ring(container)!.getAttribute("cx"), ring(container)!.getAttribute("cy"), ring(container)!.getAttribute("r")]).toEqual(["88", "0", "6"]);
    // The ring is under the dot.
    const circles = Array.from(container.querySelectorAll("circle"), (circle) => circle.getAttribute("class"));
    expect(circles).toEqual(["spark__ring", "spark__dot"]);
  });

  it("has no slider, no tabstop and nothing to hover after hydration: the row or tile around it says the values", async () => {
    const { container, errors } = await serverThenHydrated(<Sparkline values={PRICES} label={LABEL} />);
    expect(container.querySelector('[role="slider"]')).toBeNull();
    expect(container.querySelector("[tabindex]")).toBeNull();
    expect(container.querySelector("[aria-valuenow]")).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe("Sparkline's gaps and edges", () => {
  it("breaks the line at a null: a new run starts with M", async () => {
    const { container, errors } = await serverThenHydrated(<Sparkline values={["2.38", "2.40", null, "2.39", "2.44"]} label={LABEL} />);
    const d = line(container)!.getAttribute("d")!;
    expect(d).toBe("M0,16L22,10.67M66,13.33L88,0");
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).not.toContain("NaN");
    expect(errors).toEqual([]);
  });

  it("draws a value between two nulls as a dot of the line's own: a segment of no length, which a round cap draws", async () => {
    const { container } = await serverThenHydrated(<Sparkline values={["2.38", null, "2.40", null, "2.44"]} label={LABEL} />);
    expect(line(container)!.getAttribute("d")).toBe("M0,16L0,16M44,10.67L44,10.67M88,0L88,0");
  });

  it("puts the end dot on the last value that there is, and not at the end of the box, when the newest values are null", async () => {
    const { container } = await serverThenHydrated(<Sparkline values={["2.38", "2.44", null, null]} label={LABEL} />);
    // Four places, 0, 29.33, 58.67 and 88: the second is the last value.
    expect(dot(container)!.getAttribute("cx")).toBe("29.33");
    expect(dot(container)!.getAttribute("cy")).toBe("0");
  });

  it("reads a value that is not a number as a gap", async () => {
    const { html, container } = await serverThenHydrated(<Sparkline values={["2.38", "n/a", "", "2.44"]} label={LABEL} />);
    expect(line(container)!.getAttribute("d")).toBe("M0,16L0,16M88,0L88,0");
    expect(html).not.toContain("NaN");
  });

  it("draws a level line in the middle of the box when every value is the same, and a lone value as the dot", async () => {
    const level = await serverThenHydrated(<Sparkline values={["5", "5", "5"]} label="Flat" />);
    expect(line(level.container)!.getAttribute("d")).toBe("M0,8L44,8L88,8");
    expect(dot(level.container)!.getAttribute("cy")).toBe("8");

    const lone = await serverThenHydrated(<Sparkline values={[null, "5", null]} label="One" />);
    expect(line(lone.container)!.getAttribute("d")).toBe("M44,8L44,8");
    expect(dot(lone.container)!.getAttribute("cx")).toBe("44");
  });

  it("is the empty box, named by its label, when there is no value at all: no line, no dot", async () => {
    for (const values of [[], [null, null], ["", "x"]]) {
      const { html, container, errors } = await serverThenHydrated(<Sparkline values={values} label="No data" />);
      expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe("No data");
      expect(container.querySelector("path")).toBeNull();
      expect(container.querySelector("circle")).toBeNull();
      expect(html).not.toContain("NaN");
      expect(errors).toEqual([]);
    }
  });
});
