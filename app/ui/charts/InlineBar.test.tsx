import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { InlineBar } from "./InlineBar";

afterEach(cleanup);

// A bar behind or inside a table row (spec 2.11). The depth form is a wash behind the row's text (an order book's bids and asks), as wide as
// the size over the largest and grown from the row's end. The diverging form is out to the left and in to the right of a centre line, on one
// scale for every row. Both are pictures: the row's cells carry the values, so both are `aria-hidden`.

const bar = (container: HTMLElement) => container.querySelector<HTMLElement>(".inline-bar")!;

describe("InlineBar, the depth form", () => {
  it("is as wide as its value over the largest, aria-hidden, in the wash of asks", async () => {
    const { container, errors } = await serverThenHydrated(<InlineBar value="40" max="100" tone="down" />);
    expect(container.querySelectorAll(".inline-bar")).toHaveLength(1);
    expect(bar(container).style.width).toBe("40%");
    expect(bar(container).getAttribute("aria-hidden")).toBe("true");
    // The wash is the stylesheet's, by tone: --down-wash for asks.
    expect(bar(container).classList.contains("inline-bar--down")).toBe(true);
    expect(bar(container).classList.contains("inline-bar--up")).toBe(false);
    expect(bar(container).classList.contains("inline-bar--diverging")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("is in the wash of bids for the tone 'up'", async () => {
    const { container } = await serverThenHydrated(<InlineBar value="25" max="50" tone="up" />);
    expect(bar(container).style.width).toBe("50%");
    expect(bar(container).classList.contains("inline-bar--up")).toBe(true);
    expect(bar(container).classList.contains("inline-bar--down")).toBe(false);
  });

  it("is the whole row at the largest, and holds a value past it there", async () => {
    expect(bar((await serverThenHydrated(<InlineBar value="100" max="100" tone="up" />)).container).style.width).toBe("100%");
    expect(bar((await serverThenHydrated(<InlineBar value="120" max="100" tone="up" />)).container).style.width).toBe("100%");
  });

  it("trims the percent to 2 decimals", async () => {
    const { container } = await serverThenHydrated(<InlineBar value="1" max="3" tone="up" />);
    expect(bar(container).style.width).toBe("33.33%");
  });

  it("is 0 wide for no size, a negative one, a maximum of 0 and what is not a number, and never NaN", async () => {
    for (const [value, max] of [["0", "100"], ["-5", "100"], ["5", "0"], ["n/a", "100"], ["5", ""]]) {
      const { html, container } = await serverThenHydrated(<InlineBar value={value!} max={max!} tone="up" />);
      expect(bar(container).style.width, `${value} of ${max}`).toBe("0%");
      expect(html).not.toContain("NaN");
    }
  });
});

describe("InlineBar, the diverging form", () => {
  it("draws out to the left and in to the right on one scale: the maximum is half of the width, so out 2, in 1 of 4 are 25% and 12.5%", async () => {
    const { container, errors } = await serverThenHydrated(<InlineBar diverging out="2" in="1" max="4" />);
    expect(container.querySelectorAll(".inline-bar")).toHaveLength(1);
    expect(bar(container).classList.contains("inline-bar--diverging")).toBe(true);
    expect(bar(container).getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector<HTMLElement>(".inline-bar__out")!.style.width).toBe("25%");
    expect(container.querySelector<HTMLElement>(".inline-bar__in")!.style.width).toBe("12.5%");
    expect(errors).toEqual([]);
  });

  it("reaches the centre line's side at the largest: half of the width, each way", async () => {
    const { container } = await serverThenHydrated(<InlineBar diverging out="4" in="4" max="4" />);
    expect(container.querySelector<HTMLElement>(".inline-bar__out")!.style.width).toBe("50%");
    expect(container.querySelector<HTMLElement>(".inline-bar__in")!.style.width).toBe("50%");
  });

  it("is the same scale in every row: the same max gives the same width", async () => {
    const a = await serverThenHydrated(<InlineBar diverging out="1" in="0" max="8" />);
    const b = await serverThenHydrated(<InlineBar diverging out="1" in="3" max="8" />);
    expect(a.container.querySelector<HTMLElement>(".inline-bar__out")!.style.width).toBe(b.container.querySelector<HTMLElement>(".inline-bar__out")!.style.width);
    expect(b.container.querySelector<HTMLElement>(".inline-bar__in")!.style.width).toBe("18.75%");
  });

  it("draws only the side that has a size, and nothing for a side that is 0, negative or unreadable", async () => {
    const out = await serverThenHydrated(<InlineBar diverging out="2" in="0" max="4" />);
    expect(out.container.querySelector(".inline-bar__out")).not.toBeNull();
    expect(out.container.querySelector(".inline-bar__in")).toBeNull();
    const none = await serverThenHydrated(<InlineBar diverging out="n/a" in="-1" max="4" />);
    expect(none.container.querySelector(".inline-bar__out")).toBeNull();
    expect(none.container.querySelector(".inline-bar__in")).toBeNull();
    expect(none.html).not.toContain("NaN");
  });

  it("holds a size past the maximum at its side's end, and draws nothing from a maximum of 0", async () => {
    const over = await serverThenHydrated(<InlineBar diverging out="9" in="1" max="4" />);
    expect(over.container.querySelector<HTMLElement>(".inline-bar__out")!.style.width).toBe("50%");
    const none = await serverThenHydrated(<InlineBar diverging out="2" in="1" max="0" />);
    expect(none.container.querySelector(".inline-bar__out")).toBeNull();
    expect(none.container.querySelector(".inline-bar__in")).toBeNull();
    expect(none.html).not.toContain("NaN");
  });
});
