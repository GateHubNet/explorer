import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { Meter } from "./Meter";
import type { MeterData } from "./types";

afterEach(cleanup);

// One ratio, with an optional threshold (spec 2.11): a track and a fill, 12 px high (6 px when small), a tick of 2 px that reaches 5 px past
// the track with its label under it. It is one image, named by the label the view builder wrote; the row or card it sits in has the numbers.

const DATA: MeterData = {
  value: "84",
  max: "100",
  threshold: { value: "80", label: "80% needed" },
  label: "84% of the UNL votes yes; 80% needed",
};

const fill = (container: HTMLElement) => container.querySelector<HTMLElement>(".meter__fill")!;
const tick = (container: HTMLElement) => container.querySelector<HTMLElement>(".meter__tick");
const tickLabel = (container: HTMLElement) => container.querySelector<HTMLElement>(".meter__label");

describe("Meter as the Worker prints it and the browser takes it over", () => {
  it("is one image named by its label, with a fill 84% of the track wide", async () => {
    const { container, errors } = await serverThenHydrated(<Meter data={DATA} />);
    const images = container.querySelectorAll('[role="img"]');
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute("aria-label")).toBe("84% of the UNL votes yes; 80% needed");
    expect(container.querySelector(".meter__track")).not.toBeNull();
    expect(fill(container).style.width).toBe("84%");
    expect(errors).toEqual([]);
  });

  it("puts the tick of the threshold at 80% of the track, and its label under it, saying '80% needed'", async () => {
    const { container, errors } = await serverThenHydrated(<Meter data={DATA} />);
    expect(tick(container)!.style.left).toBe("80%");
    expect(tickLabel(container)!.textContent).toBe("80% needed");
    expect(tickLabel(container)!.style.left).toBe("80%");
    // The tick is in the track, and the label under the track.
    expect(tick(container)!.closest(".meter__track")).not.toBeNull();
    expect(tickLabel(container)!.closest(".meter__track")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("is 12 px high, and 6 px when small", async () => {
    const regular = await serverThenHydrated(<Meter data={DATA} />);
    expect(regular.container.querySelector(".meter")!.classList.contains("meter--small")).toBe(false);
    const small = await serverThenHydrated(<Meter data={DATA} small />);
    expect(small.container.querySelector(".meter")!.classList.contains("meter--small")).toBe(true);
    expect(small.errors).toEqual([]);
  });

  it("has no tick and no label without a threshold, and says it so for the sizing", async () => {
    const { container } = await serverThenHydrated(<Meter data={{ value: "3", max: "10", label: "30% of the pool" }} />);
    expect(fill(container).style.width).toBe("30%");
    expect(tick(container)).toBeNull();
    expect(tickLabel(container)).toBeNull();
    expect(container.querySelector(".meter")!.classList.contains("meter--threshold")).toBe(false);
    const withThreshold = await serverThenHydrated(<Meter data={DATA} />);
    expect(withThreshold.container.querySelector(".meter")!.classList.contains("meter--threshold")).toBe(true);
  });

  it("scales by the maximum it is given, and trims the percent like the other forms", async () => {
    const { container } = await serverThenHydrated(<Meter data={{ value: "1", max: "3", threshold: { value: "2", label: "2 of 3" }, label: "1 of 3" }} />);
    expect(fill(container).style.width).toBe("33.33%");
    expect(tick(container)!.style.left).toBe("66.67%");
  });

  it("keeps the label under the tick inside the track's ends: it opens to the right near the start, to the left near the end", async () => {
    const early = await serverThenHydrated(<Meter data={{ ...DATA, threshold: { value: "10", label: "10% needed" } }} />);
    expect(tickLabel(early.container)!.getAttribute("data-side")).toBe("right");
    const late = await serverThenHydrated(<Meter data={DATA} />);
    expect(tickLabel(late.container)!.getAttribute("data-side")).toBe("left");
    const middle = await serverThenHydrated(<Meter data={{ ...DATA, threshold: { value: "50", label: "half" } }} />);
    expect(tickLabel(middle.container)!.getAttribute("data-side")).toBe("center");
  });

  it("holds a value past the maximum at the end of the track and one below 0 at its start, and draws nothing from a maximum of 0", async () => {
    const over = await serverThenHydrated(<Meter data={{ value: "120", max: "100", label: "over" }} />);
    expect(fill(over.container).style.width).toBe("100%");
    const under = await serverThenHydrated(<Meter data={{ value: "-5", max: "100", label: "under" }} />);
    expect(fill(under.container).style.width).toBe("0%");
    const none = await serverThenHydrated(<Meter data={{ value: "5", max: "0", threshold: { value: "1", label: "one" }, label: "none" }} />);
    expect(fill(none.container).style.width).toBe("0%");
    expect(none.html).not.toContain("NaN");
    const unreadable = await serverThenHydrated(<Meter data={{ value: "n/a", max: "100", label: "unreadable" }} />);
    expect(fill(unreadable.container).style.width).toBe("0%");
    expect(unreadable.html).not.toContain("NaN");
  });

  it("has nothing to focus or hover: the card around it says the numbers", async () => {
    const { container } = await serverThenHydrated(<Meter data={DATA} />);
    expect(container.querySelector('[role="slider"], [tabindex], button, a')).toBeNull();
  });
});
