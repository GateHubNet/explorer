import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { useRef, useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import type { CursorProps } from "./Cursor";
import { niceScale } from "./geometry";
import type { TimeAxis } from "./types";

// The layer a plot has until its cursor is needed (spec 2.1): the same transparent slider, which the first pointer or focus that reaches it
// replaces with `Cursor`, loaded with `import()`. `./Cursor` is replaced here by a module that counts how often it was loaded, can be held
// back or fail, and records the props `Cursor` was given; what it renders is the real cursor. Each test has the modules afresh (`setup`), so that
// the first import in it is the first.

const gate = {
  loads: 0,
  /** Every set of props the cursor was rendered with. */
  given: [] as unknown[],
  /** Held back while there is one: the module is not there until `release()`. */
  held: undefined as Promise<void> | undefined,
  release: undefined as (() => void) | undefined,
  /** The next import fails, once. */
  failing: false,
};

/** From now on the module is not there until `gate.release()`. */
function holdBack(): void {
  gate.held = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.doUnmock("./Cursor");
});

/** 30 buckets, as a day-by-day plot of a month has. */
const COUNT = 30;
const BOX = { left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

type Props = Partial<Omit<CursorProps, "plot">> & Record<string, unknown>;

/**
 * The modules afresh, with `./Cursor` standing in as above, and `CursorSlot` imported after it (React is the node_modules one, the same copy
 * the test's renderer uses). `holdBack()` and `gate.failing` are set after this and before the first pointer.
 */
async function setup() {
  vi.resetModules();
  gate.loads = 0;
  gate.given = [];
  gate.held = undefined;
  gate.release = undefined;
  gate.failing = false;
  vi.doMock("./Cursor", async () => {
    if (gate.failing) {
      gate.failing = false;
      throw new Error("Failed to fetch dynamically imported module");
    }
    await gate.held;
    gate.loads += 1;
    const actual = await vi.importActual<typeof import("./Cursor")>("./Cursor");
    return {
      ...actual,
      Cursor: (props: CursorProps) => {
        gate.given.push(props);
        return actual.Cursor(props);
      },
    };
  });
  const { CursorSlot } = await import("./CursorSlot");
  const { Plot } = await import("./Plot");

  function StubPlot({ id = "plot", ...props }: Props & { id?: string }) {
    const plot = useRef<HTMLDivElement>(null);
    return (
      <div className="plot" data-testid={id} ref={plot}>
        {Array.from({ length: COUNT }, (_, i) => (
          <span key={i} className="mark" data-bucket={i} />
        ))}
        <CursorSlot
          plot={plot}
          count={COUNT}
          placement="points"
          label="Transactions, day by day"
          valueText={(i) => `Day ${i}`}
          tooltip={(i) => <b>{`${i} transactions`}</b>}
          {...props}
        />
      </div>
    );
  }

  /** The page as the Worker prints it and the browser takes it over, with every plot in it 1000 px wide. */
  async function mounted(ui: ReactElement) {
    const result = await serverThenHydrated(ui);
    for (const plot of result.container.querySelectorAll<HTMLElement>(".plot")) vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(BOX);
    const find = (id: string) => within(result.container).getByTestId(id);
    return {
      ...result,
      slider: (id = "plot") => find(id).querySelector<HTMLElement>('[role="slider"]')!,
      tip: (id = "plot") => find(id).querySelector<HTMLElement>(".plot__tip"),
      plot: (id = "plot") => find(id),
    };
  }

  return { StubPlot, mounted, Plot };
}

const mouse = (x: number) => ({ clientX: x, pointerType: "mouse" });
const finger = (x: number) => ({ clientX: x, pointerType: "touch" });

/** What happens between the pointer reaching the plot and the cursor being there: the module comes (or does not), and React draws it. */
const arrived = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 25))));

describe("the layer a plot has before its cursor is loaded", () => {
  it("is not in the Worker's HTML, and is the cursor's slider once the page is hydrated, with the module not loaded", async () => {
    const { StubPlot, mounted } = await setup();
    const { html, slider, errors } = await mounted(<StubPlot />);
    expect(html).not.toContain('role="slider"');
    expect(html).not.toContain("plot__cursor");
    const layer = slider();
    expect(layer.className).toBe("plot__cursor");
    expect(layer.getAttribute("role")).toBe("slider");
    expect(layer.getAttribute("tabindex")).toBe("0");
    expect(layer.getAttribute("aria-label")).toBe("Transactions, day by day");
    expect(layer.getAttribute("aria-valuemin")).toBe("0");
    expect(layer.getAttribute("aria-valuemax")).toBe("29");
    // On the newest bucket, which it says in words, as the cursor does before anything is done to it.
    expect(layer.getAttribute("aria-valuenow")).toBe("29");
    expect(layer.getAttribute("aria-valuetext")).toBe("Day 29");
    expect(errors).toEqual([]);
    // Nothing of the cursor yet: no tooltip, no marks, and the module has not been asked for.
    expect(gate.loads).toBe(0);
  });

  it("has the same attributes as the cursor's own layer", async () => {
    const { StubPlot, mounted } = await setup();
    const slot = await mounted(<StubPlot />);
    const before = Object.fromEntries(Array.from(slot.slider().attributes, (attribute) => [attribute.name, attribute.value]));
    // Focus puts the cursor on the newest bucket, where the layer is; blur takes the tooltip away and leaves the layer as it was.
    act(() => slot.slider().focus());
    await arrived();
    act(() => slot.slider().blur());
    expect(gate.loads).toBe(1);
    const after = Object.fromEntries(Array.from(slot.slider().attributes, (attribute) => [attribute.name, attribute.value]));
    expect(after).toEqual(before);
  });

  it("renders nothing for a plot with no buckets, as the cursor does", async () => {
    const { StubPlot, mounted } = await setup();
    const { container } = await mounted(<StubPlot count={0} />);
    expect(container.querySelector('[role="slider"]')).toBeNull();
  });

  it("does not load the module for a pointer that moves, presses or leaves without having entered, or for a key", async () => {
    const { StubPlot, mounted } = await setup();
    const { slider } = await mounted(<StubPlot />);
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    fireEvent.pointerLeave(slider(), mouse(10));
    await arrived();
    expect(gate.loads).toBe(0);
  });
});

describe("the first pointer to reach it", () => {
  it("loads the cursor, once, and the cursor is the layer from then on", async () => {
    const { StubPlot, mounted } = await setup();
    const { slider, container, errors } = await mounted(<StubPlot />);
    const slot = slider();
    fireEvent.pointerEnter(slot, mouse(100));
    fireEvent.pointerMove(slot, mouse(120));
    await arrived();
    expect(gate.loads).toBe(1);
    expect(slider()).not.toBe(slot);
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("selects the bucket the pointer is at when the cursor arrives: its entry is replayed", async () => {
    const { StubPlot, mounted } = await setup();
    const { slider, tip, plot } = await mounted(<StubPlot />);
    fireEvent.pointerEnter(slider(), mouse(100));
    await arrived();
    expect(slider().getAttribute("aria-valuenow")).toBe("3");
    expect(tip()!.textContent).toBe("3 transactions");
    expect(plot().getAttribute("data-active")).toBe("3");
  });

  it("selects the bucket the pointer has moved to meanwhile", async () => {
    const { StubPlot, mounted } = await setup();
    holdBack();
    const { slider, tip } = await mounted(<StubPlot />);
    const slot = slider();
    fireEvent.pointerEnter(slot, mouse(100));
    fireEvent.pointerMove(slot, mouse(500));
    gate.release!();
    await arrived();
    expect(slider().getAttribute("aria-valuenow")).toBe("15");
    expect(tip()!.textContent).toBe("15 transactions");
  });

  it("shows nothing for a mouse that has left before the cursor arrived", async () => {
    const { StubPlot, mounted } = await setup();
    holdBack();
    const { slider, tip, plot } = await mounted(<StubPlot />);
    const slot = slider();
    fireEvent.pointerEnter(slot, mouse(100));
    fireEvent.pointerLeave(slot, mouse(100));
    gate.release!();
    await arrived();
    expect(gate.loads).toBe(1);
    expect(slider()).not.toBe(slot);
    expect(tip()).toBeNull();
    expect(plot().hasAttribute("data-active")).toBe(false);
    expect(slider().getAttribute("aria-valuenow")).toBe("29");
  });

  it("keeps a touch that has lifted before the cursor arrived, as the tap it was: it selects and keeps the tooltip", async () => {
    const { StubPlot, mounted } = await setup();
    holdBack();
    const { slider, tip } = await mounted(<StubPlot />);
    const slot = slider();
    fireEvent.pointerEnter(slot, finger(500));
    fireEvent.pointerDown(slot, finger(500));
    fireEvent.pointerUp(slot, finger(500));
    fireEvent.pointerLeave(slot, finger(500));
    gate.release!();
    await arrived();
    expect(slider().getAttribute("aria-valuenow")).toBe("15");
    // Kept: a finger that lifts is not a pointer that leaves.
    expect(tip()!.textContent).toBe("15 transactions");
    fireEvent.pointerLeave(slider(), finger(500));
    expect(tip()).not.toBeNull();
  });

  it("drops a touch that the browser took for a scroll", async () => {
    const { StubPlot, mounted } = await setup();
    holdBack();
    const { slider, tip } = await mounted(<StubPlot />);
    const slot = slider();
    fireEvent.pointerEnter(slot, finger(500));
    fireEvent.pointerCancel(slot, finger(500));
    fireEvent.pointerLeave(slot, finger(500));
    gate.release!();
    await arrived();
    expect(tip()).toBeNull();
  });
});

describe("the first focus to reach it", () => {
  it("loads the cursor and keeps the focus on it, and the newest bucket is the one shown: the focus is replayed", async () => {
    const { StubPlot, mounted } = await setup();
    const { slider, tip, plot, container, errors } = await mounted(<StubPlot />);
    act(() => slider().focus());
    await arrived();
    expect(gate.loads).toBe(1);
    expect(document.activeElement).toBe(slider());
    expect(slider().classList.contains("plot__cursor")).toBe(true);
    expect(slider().getAttribute("aria-valuenow")).toBe("29");
    expect(tip()!.textContent).toBe("29 transactions");
    expect(plot().getAttribute("data-active")).toBe("29");
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("is the cursor's from then on: the keys move it", async () => {
    const { StubPlot, mounted } = await setup();
    const { slider } = await mounted(<StubPlot />);
    act(() => slider().focus());
    await arrived();
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(slider().getAttribute("aria-valuenow")).toBe("28");
    expect(slider().getAttribute("aria-valuetext")).toBe("Day 28");
  });

  it("shows nothing when focus left before the cursor arrived", async () => {
    const { StubPlot, mounted } = await setup();
    holdBack();
    const { slider, tip } = await mounted(<StubPlot />);
    const slot = slider();
    act(() => slot.focus());
    act(() => slot.blur());
    gate.release!();
    await arrived();
    expect(gate.loads).toBe(1);
    expect(tip()).toBeNull();
    expect(document.activeElement).not.toBe(slider());
  });
});

describe("the cursor it renders", () => {
  it("is given every prop of the layer unchanged, the ones a later kit adds too", async () => {
    const { StubPlot, mounted } = await setup();
    const valueText = (i: number) => `Day ${i}`;
    const tooltip = () => <b>tip</b>;
    const dots = () => [{ y: 0.5, slot: 1 as const }];
    const onChange = vi.fn();
    const { slider } = await mounted(<StubPlot valueText={valueText} tooltip={tooltip} dots={dots} onChange={onChange} crosshair pageStep={7} />);
    fireEvent.pointerEnter(slider(), mouse(0));
    await arrived();
    const props = gate.given.at(-1) as Record<string, unknown>;
    expect(props).toMatchObject({ count: COUNT, placement: "points", label: "Transactions, day by day", crosshair: true, pageStep: 7 });
    expect(props.valueText).toBe(valueText);
    expect(props.tooltip).toBe(tooltip);
    expect(props.dots).toBe(dots);
    expect(props.onChange).toBe(onChange);
    expect(props.plot).toHaveProperty("current");
    expect(Object.keys(props).sort()).toEqual(["count", "crosshair", "dots", "label", "onChange", "pageStep", "placement", "plot", "tooltip", "valueText"]);
  });

  it("is given the props the page gives it next, through the renders after it arrived", async () => {
    const { StubPlot, mounted } = await setup();
    let rename!: (label: string) => void;
    function Renamed() {
      const [label, set] = useState("First");
      rename = set;
      return <StubPlot label={label} />;
    }
    const { slider } = await mounted(<Renamed />);
    fireEvent.pointerEnter(slider(), mouse(0));
    await arrived();
    expect(slider().getAttribute("aria-label")).toBe("First");
    act(() => rename("Second"));
    expect(slider().getAttribute("aria-label")).toBe("Second");
  });

  it("loads the module once for every plot, and a second plot's first pointer finds it there", async () => {
    const { StubPlot, mounted } = await setup();
    const { slider } = await mounted(
      <>
        <StubPlot id="a" />
        <StubPlot id="b" />
      </>,
    );
    fireEvent.pointerEnter(slider("a"), mouse(100));
    await arrived();
    fireEvent.pointerEnter(slider("b"), mouse(900));
    await arrived();
    expect(gate.loads).toBe(1);
    expect(slider("a").getAttribute("aria-valuenow")).toBe("3");
    expect(slider("b").getAttribute("aria-valuenow")).toBe("26");
  });
});

describe("in a plot", () => {
  /** 30 days, Sep 18 to Oct 17, 2026. */
  const AXIS: TimeAxis = {
    unit: "day",
    buckets: Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10)),
  };

  it("has its tooltip drawn in the plot's frame, by the code that came with the cursor: the plot has none of its own, and none is drawn before", async () => {
    const { Plot, mounted } = await setup();
    const { container } = await mounted(
      <Plot
        title="Transactions"
        summary="Transactions per day"
        token="t1"
        scale={niceScale([18], { integer: true })}
        kind="count"
        axis={AXIS}
        placement="points"
        slots
        cursor={{ count: 30, placement: "points", label: "Transactions, day by day", valueText: (i) => `Day ${i}`, tooltip: (i) => <b>{`${i} transactions`}</b> }}
      >
        <span data-bucket={0} />
      </Plot>,
    );
    const slider = () => container.querySelector<HTMLElement>('[role="slider"]')!;
    // The frame has no tooltip, and the plot no cursor code to draw one with, until a pointer arrives.
    expect(container.querySelector(".plot__tip")).toBeNull();
    expect(gate.loads).toBe(0);
    fireEvent.pointerEnter(slider(), mouse(100));
    await arrived();
    expect(gate.loads).toBe(1);
    const bubble = container.querySelector<HTMLElement>(".plot__frame > .plot__tip")!;
    expect(bubble.textContent).toBe("3 transactions");
    expect(bubble.getAttribute("aria-hidden")).toBe("true");
    // Beside the region that scrolls, and not in it.
    expect(container.querySelector(".plot__scroll .plot__tip")).toBeNull();
    fireEvent.pointerLeave(slider(), mouse(100));
    expect(container.querySelector(".plot__tip")).toBeNull();
  });
});

describe("when the module cannot be loaded", () => {
  it("leaves the layer as it is, and asks again at the next pointer or focus", async () => {
    const { StubPlot, mounted } = await setup();
    gate.failing = true;
    const { slider, errors } = await mounted(<StubPlot />);
    const slot = slider();
    fireEvent.pointerEnter(slot, mouse(100));
    await arrived();
    // Nothing happened to the layer: it is the one that was there, and it still says what it said.
    expect(slider()).toBe(slot);
    expect(gate.loads).toBe(0);
    expect(slot.getAttribute("aria-valuetext")).toBe("Day 29");

    fireEvent.pointerLeave(slot, mouse(100));
    fireEvent.pointerEnter(slot, mouse(100));
    await arrived();
    expect(gate.loads).toBe(1);
    expect(slider()).not.toBe(slot);
    expect(errors).toEqual([]);
  });
});
