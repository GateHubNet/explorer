import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useRef, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { Cursor, type CursorProps } from "./Cursor";
import { createTipSlot, TipSlotContext } from "./cursor-slot-state";
import { HoverGroup, steppedKey, useHoverGroup } from "./cursor-state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The hover and keyboard layer over a plot (spec 2.6): a slider that is not in the Worker's HTML, which the browser adds once it has
// taken the page over. It puts `data-active` on the plot and `is-active` on the marks of the bucket, shows a crosshair, dots and one
// tooltip, and shares the bucket with the other plots of a `HoverGroup`. The plot here is a stub 1000 px wide, drawn by no layout: its
// box is mocked, which is all the cursor asks of it.

/** 30 buckets, as a day-by-day plot of a month has. */
const COUNT = 30;

type Props = Partial<Omit<CursorProps, "plot">>;

function StubPlot({ id = "plot", ...props }: Props & { id?: string }) {
  const plot = useRef<HTMLDivElement>(null);
  return (
    <div className="plot" data-testid={id} ref={plot}>
      {Array.from({ length: COUNT }, (_, i) => (
        <span key={i} className="mark" data-bucket={i} />
      ))}
      <Cursor
        plot={plot}
        count={COUNT}
        placement="points"
        label="Transactions, day by day"
        valueText={(i) => `Day ${i}`}
        tooltip={(i) => (
          <>
            <span>{`Oct ${i}`}</span>
            <b>{`${i} transactions`}</b>
          </>
        )}
        {...props}
      />
    </div>
  );
}

const BOX = { left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/** The page as the Worker prints it and the browser takes it over, with every plot in it 1000 px wide. */
async function mounted(ui: ReactElement) {
  const result = await serverThenHydrated(ui);
  for (const plot of result.container.querySelectorAll<HTMLElement>(".plot")) vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(BOX);
  return {
    ...result,
    slider: (id = "plot") => within(result.container).getByTestId(id).querySelector<HTMLElement>('[role="slider"]')!,
    tip: (id = "plot") => within(result.container).getByTestId(id).querySelector<HTMLElement>(".plot__tip"),
    plot: (id = "plot") => within(result.container).getByTestId(id),
  };
}

const mouse = (x: number) => ({ clientX: x, pointerType: "mouse" });
const finger = (x: number) => ({ clientX: x, pointerType: "touch" });

describe("Cursor as the Worker prints it and the browser takes it over", () => {
  it("is not in the Worker's HTML, and is a slider over the plot once the page is hydrated", async () => {
    const { html, slider, errors } = await mounted(<StubPlot />);
    expect(html).not.toContain('role="slider"');
    expect(html).not.toContain("plot__cursor");
    const layer = slider();
    expect(layer.getAttribute("role")).toBe("slider");
    expect(layer.getAttribute("tabindex")).toBe("0");
    expect(layer.getAttribute("aria-valuemin")).toBe("0");
    expect(layer.getAttribute("aria-valuemax")).toBe("29");
    expect(layer.getAttribute("aria-label")).toBe("Transactions, day by day");
    expect(layer.classList.contains("plot__cursor")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("shows nothing but the layer until the visitor does something: no tooltip, no crosshair, no dots, no active mark", async () => {
    const { container, tip, plot, errors } = await mounted(<StubPlot crosshair dots={() => [{ y: 0.5, slot: 1 }]} />);
    expect(tip()).toBeNull();
    expect(container.querySelector(".plot__crosshair")).toBeNull();
    expect(container.querySelector(".plot__dot")).toBeNull();
    expect(plot().hasAttribute("data-active")).toBe(false);
    expect(container.querySelector(".is-active")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("renders nothing for a plot with no buckets", async () => {
    const { container } = await mounted(<StubPlot count={0} />);
    expect(container.querySelector('[role="slider"]')).toBeNull();
  });

  it("has a range of one value for a plot with one bucket", async () => {
    const { slider } = await mounted(<StubPlot count={1} />);
    expect(slider().getAttribute("aria-valuemax")).toBe("0");
    expect(slider().getAttribute("aria-valuenow")).toBe("0");
  });
});

describe("Cursor, from the keyboard", () => {
  it("selects the newest bucket on focus, says it in words, and shows its tooltip", async () => {
    const { slider, tip, plot, errors } = await mounted(<StubPlot />);
    fireEvent.focus(slider());
    expect(slider().getAttribute("aria-valuenow")).toBe("29");
    expect(slider().getAttribute("aria-valuetext")).toBe("Day 29");
    expect(tip()!.textContent).toBe("Oct 29" + "29 transactions");
    expect(plot().getAttribute("data-active")).toBe("29");
    expect(errors).toEqual([]);
  });

  it("moves one bucket with the arrow keys, to the ends with Home and End, and stops at the ends", async () => {
    const { slider } = await mounted(<StubPlot />);
    const now = () => slider().getAttribute("aria-valuenow");
    fireEvent.focus(slider());
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(now()).toBe("28");
    expect(slider().getAttribute("aria-valuetext")).toBe("Day 28");
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(now()).toBe("29");
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(now()).toBe("29");
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(now()).toBe("0");
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(now()).toBe("0");
    fireEvent.keyDown(slider(), { key: "End" });
    expect(now()).toBe("29");
  });

  it("keeps the arrow keys, Home and End from scrolling the page, and lets every other key be", async () => {
    const { slider } = await mounted(<StubPlot />);
    fireEvent.focus(slider());
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) expect(fireEvent.keyDown(slider(), { key }), key).toBe(false);
    for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Tab", "a", "Escape"]) expect(fireEvent.keyDown(slider(), { key }), key).toBe(true);
    // The browser's own keys (Alt+Left is Back) are not the cursor's.
    expect(fireEvent.keyDown(slider(), { key: "ArrowLeft", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(slider(), { key: "Home", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(slider(), { key: "End", metaKey: true })).toBe(true);
  });

  it("puts the active mark where the bucket is, and takes it away from the one before", async () => {
    const { container, plot, slider } = await mounted(<StubPlot />);
    fireEvent.focus(slider());
    expect(plot().getAttribute("data-active")).toBe("29");
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(plot().getAttribute("data-active")).toBe("28");
    expect(Array.from(container.querySelectorAll(".is-active"), (mark) => mark.getAttribute("data-bucket"))).toEqual(["28"]);
  });

  it("hides the tooltip on Escape, and shows it again from where it was with the next arrow", async () => {
    const { slider, tip, plot } = await mounted(<StubPlot />);
    fireEvent.focus(slider());
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    fireEvent.keyDown(slider(), { key: "Escape" });
    expect(tip()).toBeNull();
    expect(plot().hasAttribute("data-active")).toBe(false);
    // The slider still has a value to say.
    expect(slider().getAttribute("aria-valuenow")).toBe("28");
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(tip()!.textContent).toContain("Oct 27");
  });

  it("hides on blur, and selects the newest bucket again on the next focus", async () => {
    const { slider, tip, plot } = await mounted(<StubPlot />);
    fireEvent.focus(slider());
    fireEvent.keyDown(slider(), { key: "Home" });
    fireEvent.blur(slider());
    expect(tip()).toBeNull();
    expect(plot().hasAttribute("data-active")).toBe(false);
    fireEvent.focus(slider());
    expect(slider().getAttribute("aria-valuenow")).toBe("29");
    expect(tip()).not.toBeNull();
  });
});

describe("steppedKey: the keys of every cursor (spec 2.6), which Cursor and ShareBar both read", () => {
  const press = (key: string, index: number, last: number, modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) =>
    steppedKey({ key, altKey: false, ctrlKey: false, metaKey: false, ...modifiers }, index, last);

  it("moves one step with the arrow keys, to the ends with Home and End", () => {
    expect(press("ArrowLeft", 5, 9)).toBe(4);
    expect(press("ArrowRight", 5, 9)).toBe(6);
    expect(press("Home", 5, 9)).toBe(0);
    expect(press("End", 5, 9)).toBe(9);
  });

  it("stops at the ends: no step before the first or past the last", () => {
    expect(press("ArrowLeft", 0, 9)).toBe(0);
    expect(press("ArrowRight", 9, 9)).toBe(9);
    // One bucket: every key lands on it.
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) expect(press(key, 0, 0), key).toBe(0);
  });

  it("says to hide for Escape", () => {
    expect(press("Escape", 5, 9)).toBe("hide");
  });

  it("is not the cursor's for any other key, or for the browser's own shortcuts (Alt+Left is Back)", () => {
    for (const key of ["a", "Enter", "Tab", "ArrowUp", "ArrowDown", " ", "PageDown"]) expect(press(key, 5, 9), key).toBeNull();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"]) expect(press(key, 5, 9, { [modifier]: true }), `${modifier} ${key}`).toBeNull();
    }
  });
});

describe("Cursor, with a pointer", () => {
  it("selects the nearest bucket from the x fraction, and shows a tooltip centred on it in the middle of the plot", async () => {
    const { slider, tip, plot, errors } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(500));
    const bubble = tip()!;
    expect(bubble.textContent).toBe("Oct 15" + "15 transactions");
    expect(bubble.getAttribute("aria-hidden")).toBe("true");
    expect(bubble.classList.contains("center")).toBe(true);
    expect(bubble.style.left).toBe("51.72%");
    expect(slider().getAttribute("aria-valuenow")).toBe("15");
    expect(slider().getAttribute("aria-valuetext")).toBe("Day 15");
    expect(plot().getAttribute("data-active")).toBe("15");
    expect(errors).toEqual([]);
  });

  it("marks the bucket's marks, and only those", async () => {
    const { container, slider } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(500));
    expect(Array.from(container.querySelectorAll(".mark.is-active"), (mark) => mark.getAttribute("data-bucket"))).toEqual(["15"]);
    fireEvent.pointerMove(slider(), mouse(100));
    expect(Array.from(container.querySelectorAll(".mark.is-active"), (mark) => mark.getAttribute("data-bucket"))).toEqual(["3"]);
  });

  it("opens the tooltip to the right near the start, to the left near the end", async () => {
    const { slider, tip } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(100));
    expect(tip()!.classList.contains("right")).toBe(true);
    expect(tip()!.classList.contains("center")).toBe(false);
    fireEvent.pointerMove(slider(), mouse(900));
    expect(tip()!.classList.contains("left")).toBe(true);
    expect(tip()!.classList.contains("right")).toBe(false);
    fireEvent.pointerMove(slider(), mouse(500));
    expect(tip()!.classList.contains("center")).toBe(true);
  });

  it("takes the bucket of a band at the band's middle, with the same x", async () => {
    const { slider, tip } = await mounted(<StubPlot placement="bands" crosshair />);
    fireEvent.pointerMove(slider(), mouse(500));
    // Band 15 of 30 is the one at 500/1000 and its middle is at (15 + ½) / 30.
    expect(slider().getAttribute("aria-valuenow")).toBe("15");
    expect(tip()!.style.left).toBe("51.67%");
  });

  it("holds the bucket to the plot when the pointer is past its edge", async () => {
    const { slider } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(-40));
    expect(slider().getAttribute("aria-valuenow")).toBe("0");
    fireEvent.pointerMove(slider(), mouse(1400));
    expect(slider().getAttribute("aria-valuenow")).toBe("29");
  });

  it("measures the plot at the time of the move, so it follows a plot that scrolled", async () => {
    const { plot, slider } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(500));
    expect(slider().getAttribute("aria-valuenow")).toBe("15");
    vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({ ...BOX, left: -500, right: 500 });
    fireEvent.pointerMove(slider(), mouse(500));
    expect(slider().getAttribute("aria-valuenow")).toBe("29");
  });

  it("selects nothing when the plot has no width", async () => {
    const { plot, slider, tip } = await mounted(<StubPlot />);
    vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({ ...BOX, width: 0, right: 0 });
    fireEvent.pointerMove(slider(), mouse(0));
    expect(tip()).toBeNull();
  });

  it("hides when a mouse leaves", async () => {
    const { container, slider, tip, plot } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(500));
    fireEvent.pointerLeave(slider(), mouse(500));
    expect(tip()).toBeNull();
    expect(plot().hasAttribute("data-active")).toBe(false);
    expect(container.querySelector(".is-active")).toBeNull();
  });

  it("draws a crosshair and the dots at the bucket, when it is asked to, and nowhere before", async () => {
    const dots = vi.fn((i: number) => [
      { y: 0.25, slot: 1 as const },
      { y: i / 30, slot: "up" as const },
    ]);
    const { container, slider } = await mounted(<StubPlot crosshair dots={dots} />);
    expect(dots).not.toHaveBeenCalled();
    fireEvent.pointerMove(slider(), mouse(500));
    const cross = container.querySelector<HTMLElement>(".plot__crosshair")!;
    expect(cross.style.left).toBe("51.72%");
    const found = Array.from(container.querySelectorAll<HTMLElement>(".plot__dot"));
    expect(found.map((dot) => [dot.dataset.slot, dot.style.left, dot.style.bottom])).toEqual([
      ["1", "51.72%", "25%"],
      ["up", "51.72%", "50%"],
    ]);
    expect(dots).toHaveBeenLastCalledWith(15);
  });

  it("draws no crosshair, and no dots, unless it is asked to", async () => {
    const { container, slider } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(500));
    expect(container.querySelector(".plot__crosshair")).toBeNull();
    expect(container.querySelector(".plot__dot")).toBeNull();
  });

  it("draws the crosshair and the dots without a tooltip, for a plot that has none", async () => {
    const { container, slider, tip } = await mounted(<StubPlot tooltip={undefined} crosshair />);
    fireEvent.pointerMove(slider(), mouse(500));
    expect(tip()).toBeNull();
    expect(container.querySelector(".plot__crosshair")).not.toBeNull();
  });

  it("leaves the bucket alone when focus follows a click, which is a pointer's and not the keyboard's", async () => {
    const { slider } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(500));
    fireEvent.pointerDown(slider(), mouse(500));
    fireEvent.focus(slider());
    fireEvent.pointerUp(slider(), mouse(500));
    expect(slider().getAttribute("aria-valuenow")).toBe("15");
  });

  it("steps from where the pointer left it, with the arrow keys", async () => {
    const { slider } = await mounted(<StubPlot />);
    fireEvent.pointerMove(slider(), mouse(500));
    fireEvent.pointerLeave(slider(), mouse(500));
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(slider().getAttribute("aria-valuenow")).toBe("16");
  });
});

describe("Cursor, with a finger", () => {
  it("selects at the touch, and keeps the tooltip after the finger is up until a touch lands elsewhere", async () => {
    const { slider, tip, plot } = await mounted(<StubPlot />);
    fireEvent.pointerDown(slider(), finger(500));
    expect(tip()!.textContent).toContain("Oct 15");
    expect(plot().getAttribute("data-active")).toBe("15");
    // A finger that lifts is also a pointer that leaves; the compatibility mouse events follow, and focus with them.
    fireEvent.pointerUp(slider(), finger(500));
    fireEvent.pointerLeave(slider(), finger(500));
    fireEvent.focus(slider());
    expect(tip()!.textContent).toContain("Oct 15");
    expect(slider().getAttribute("aria-valuenow")).toBe("15");

    fireEvent.pointerDown(document.body, finger(500));
    expect(tip()).toBeNull();
    expect(plot().hasAttribute("data-active")).toBe(false);
  });

  it("follows a drag along the plot", async () => {
    const { slider, tip } = await mounted(<StubPlot />);
    fireEvent.pointerDown(slider(), finger(100));
    expect(tip()!.textContent).toContain("Oct 3");
    fireEvent.pointerMove(slider(), finger(900));
    expect(tip()!.textContent).toContain("Oct 26");
    expect(tip()!.classList.contains("left")).toBe(true);
  });

  it("moves the bucket, and does not hide, for a second touch inside the plot", async () => {
    const { slider, tip } = await mounted(<StubPlot />);
    fireEvent.pointerDown(slider(), finger(500));
    fireEvent.pointerUp(slider(), finger(500));
    fireEvent.pointerDown(slider(), finger(100));
    expect(tip()!.textContent).toContain("Oct 3");
  });

  it("stops listening for a touch elsewhere once it has hidden, and when the page goes", async () => {
    const listening = () => {
      const added = vi.spyOn(document, "addEventListener");
      const removed = vi.spyOn(document, "removeEventListener");
      return { added: () => added.mock.calls.filter(([type]) => type === "pointerdown").length, removed: () => removed.mock.calls.filter(([type]) => type === "pointerdown").length };
    };

    const hidden = render(<StubPlot />);
    vi.spyOn(hidden.container.querySelector(".plot")!, "getBoundingClientRect").mockReturnValue(BOX);
    const first = listening();
    fireEvent.pointerDown(hidden.container.querySelector('[role="slider"]')!, finger(500));
    expect(first.added()).toBe(1);
    fireEvent.pointerDown(document.body, finger(500));
    expect(first.removed()).toBe(1);
    expect(hidden.container.querySelector(".plot__tip")).toBeNull();
    hidden.unmount();
    vi.restoreAllMocks();

    const gone = render(<StubPlot />);
    vi.spyOn(gone.container.querySelector(".plot")!, "getBoundingClientRect").mockReturnValue(BOX);
    const second = listening();
    fireEvent.pointerDown(gone.container.querySelector('[role="slider"]')!, finger(500));
    expect(second.added()).toBe(1);
    gone.unmount();
    expect(second.removed()).toBe(1);
  });
});

describe("Cursor, told what the visitor does", () => {
  it("calls onChange with the bucket, once for each change, and with null when it hides", async () => {
    const onChange = vi.fn();
    const { slider } = await mounted(<StubPlot onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(slider(), mouse(500));
    fireEvent.pointerMove(slider(), mouse(505));
    fireEvent.pointerMove(slider(), mouse(100));
    fireEvent.pointerLeave(slider(), mouse(100));
    expect(onChange.mock.calls).toEqual([[15], [3], [null]]);
  });

  it("calls the onChange it has now, not the one it had", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(<StubPlot onChange={first} />);
    vi.spyOn(container.querySelector(".plot")!, "getBoundingClientRect").mockReturnValue(BOX);
    rerender(<StubPlot onChange={second} />);
    fireEvent.pointerMove(container.querySelector('[role="slider"]')!, mouse(500));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(15);
  });
});

describe("Cursor, given a place for its tooltip", () => {
  it("hands the tooltip to the place and draws none of its own, and takes it back when it hides", async () => {
    const slot = createTipSlot();
    const { slider, tip, plot } = await mounted(
      <TipSlotContext value={slot}>
        <StubPlot />
      </TipSlotContext>,
    );
    expect(slot.get()).toBeNull();
    fireEvent.pointerMove(slider(), mouse(500));
    expect(tip()).toBeNull();
    expect(slot.get()?.bucket).toBe(15);
    expect(render(<div>{slot.get()?.node}</div>).container.textContent).toBe("Oct 15" + "15 transactions");
    // The rest of what the cursor does is the same.
    expect(plot().getAttribute("data-active")).toBe("15");
    fireEvent.pointerMove(slider(), mouse(100));
    expect(slot.get()?.bucket).toBe(3);
    fireEvent.pointerLeave(slider(), mouse(100));
    expect(slot.get()).toBeNull();
  });

  it("gives the place nothing for a plot that has no tooltip, or is only showing the bucket of another plot of its group", async () => {
    const slots = { price: createTipSlot(), volume: createTipSlot() };
    const { slider } = await mounted(
      <HoverGroup>
        <TipSlotContext value={slots.price}>
          <StubPlot id="price" />
        </TipSlotContext>
        <TipSlotContext value={slots.volume}>
          <StubPlot id="volume" tooltip={undefined} />
        </TipSlotContext>
      </HoverGroup>,
    );
    fireEvent.pointerMove(slider("price"), mouse(500));
    expect(slots.price.get()?.bucket).toBe(15);
    expect(slots.volume.get()).toBeNull();
    fireEvent.pointerMove(slider("volume"), mouse(100));
    expect(slots.price.get()).toBeNull();
    expect(slots.volume.get()).toBeNull();
  });

  it("gives the place back when the plot goes", () => {
    const slot = createTipSlot();
    const { container, unmount } = render(
      <TipSlotContext value={slot}>
        <StubPlot />
      </TipSlotContext>,
    );
    vi.spyOn(container.querySelector(".plot")!, "getBoundingClientRect").mockReturnValue(BOX);
    fireEvent.pointerMove(container.querySelector('[role="slider"]')!, mouse(500));
    expect(slot.get()).not.toBeNull();
    unmount();
    expect(slot.get()).toBeNull();
  });
});

describe("a place for a tooltip", () => {
  it("holds what it is given, tells whoever is listening when it changes, and not when it does not", () => {
    const slot = createTipSlot();
    const heard = vi.fn();
    const stop = slot.subscribe(heard);
    slot.show(null);
    expect(heard).not.toHaveBeenCalled();
    slot.show({ bucket: 2, node: "two" });
    expect(slot.get()).toEqual({ bucket: 2, node: "two" });
    slot.show({ bucket: 3, node: "three" });
    slot.show(null);
    expect(heard).toHaveBeenCalledTimes(3);
    expect(slot.get()).toBeNull();
    stop();
    slot.show({ bucket: 4, node: "four" });
    expect(heard).toHaveBeenCalledTimes(3);
  });
});

describe("HoverGroup and useHoverGroup", () => {
  function Probe() {
    const group = useHoverGroup();
    return <output>{group ? `group ${String(group.active)}` : "none"}</output>;
  }

  it("is nothing outside a group, and the active bucket (none yet) inside one", () => {
    expect(renderToString(<Probe />)).toContain("none");
    expect(renderToString(<HoverGroup><Probe /></HoverGroup>)).toContain("group null");
  });

  it("lets plots share the bucket: both mark it, both draw their crosshair, and only the one with the pointer has a tooltip", async () => {
    const { container, slider, tip, plot, errors } = await mounted(
      <HoverGroup>
        <StubPlot id="price" crosshair />
        <StubPlot id="volume" crosshair />
      </HoverGroup>,
    );
    fireEvent.pointerMove(slider("volume"), mouse(500));
    expect(plot("price").getAttribute("data-active")).toBe("15");
    expect(plot("volume").getAttribute("data-active")).toBe("15");
    expect(container.querySelectorAll(".mark.is-active")).toHaveLength(2);
    expect(container.querySelectorAll(".plot__crosshair")).toHaveLength(2);
    expect(tip("volume")).not.toBeNull();
    expect(tip("price")).toBeNull();
    // The other cursor says the bucket too: its slider is where the shared one is.
    expect(errors).toEqual([]);
  });

  it("tells every cursor of the group the bucket, for the readouts in their headers", async () => {
    const price = vi.fn();
    const volume = vi.fn();
    const { slider } = await mounted(
      <HoverGroup>
        <StubPlot id="price" onChange={price} />
        <StubPlot id="volume" onChange={volume} />
      </HoverGroup>,
    );
    fireEvent.pointerMove(slider("price"), mouse(500));
    fireEvent.pointerLeave(slider("price"), mouse(500));
    expect(price.mock.calls).toEqual([[15], [null]]);
    expect(volume.mock.calls).toEqual([[15], [null]]);
  });

  it("moves the tooltip with the pointer from one plot to the other, and leaves none behind", async () => {
    const { slider, tip, plot } = await mounted(
      <HoverGroup>
        <StubPlot id="price" />
        <StubPlot id="volume" />
      </HoverGroup>,
    );
    fireEvent.pointerMove(slider("price"), mouse(500));
    fireEvent.pointerLeave(slider("price"), mouse(500));
    fireEvent.pointerMove(slider("volume"), mouse(100));
    expect(tip("price")).toBeNull();
    expect(tip("volume")!.textContent).toContain("Oct 3");
    expect(plot("price").getAttribute("data-active")).toBe("3");
  });

  it("clears the shared bucket when the plot that set it hides", async () => {
    const { slider, tip, plot } = await mounted(
      <HoverGroup>
        <StubPlot id="price" />
        <StubPlot id="volume" />
      </HoverGroup>,
    );
    fireEvent.focus(slider("price"));
    expect(plot("volume").getAttribute("data-active")).toBe("29");
    fireEvent.keyDown(slider("price"), { key: "Escape" });
    expect(plot("volume").hasAttribute("data-active")).toBe(false);
    expect(tip("price")).toBeNull();
  });

  it("does not let a plot that was never touched clear what another one shows", async () => {
    const { slider, tip, plot } = await mounted(
      <HoverGroup>
        <StubPlot id="price" />
        <StubPlot id="volume" />
      </HoverGroup>,
    );
    fireEvent.pointerMove(slider("volume"), mouse(500));
    fireEvent.keyDown(slider("price"), { key: "Escape" });
    fireEvent.blur(slider("price"));
    fireEvent.pointerLeave(slider("price"), mouse(0));
    expect(plot("volume").getAttribute("data-active")).toBe("15");
    expect(tip("volume")).not.toBeNull();
  });

  it("hides a touch's tooltip when another plot of the group is touched, and shows that one's", async () => {
    const { slider, tip, plot } = await mounted(
      <HoverGroup>
        <StubPlot id="price" />
        <StubPlot id="volume" />
      </HoverGroup>,
    );
    fireEvent.pointerDown(slider("price"), finger(500));
    expect(tip("price")).not.toBeNull();
    fireEvent.pointerDown(slider("volume"), finger(100));
    expect(tip("price")).toBeNull();
    expect(tip("volume")!.textContent).toContain("Oct 3");
    expect(plot("price").getAttribute("data-active")).toBe("3");
  });

  it("keeps the plots outside the group to themselves", async () => {
    const { slider, plot } = await mounted(
      <>
        <HoverGroup>
          <StubPlot id="inside" />
        </HoverGroup>
        <StubPlot id="outside" />
      </>,
    );
    fireEvent.pointerMove(slider("inside"), mouse(500));
    expect(plot("outside").hasAttribute("data-active")).toBe(false);
  });
});
