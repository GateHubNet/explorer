import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { BarList } from "./BarList";
import type { BarListData } from "./types";

afterEach(cleanup);

// Labelled horizontal bars (spec 2.3 and 2.11): an ordered list, one row for each item in the order given, a bar as long as the item's value
// over the largest, and at the bar's tip its value and share in text ("1.24B XRP · 58%"). The bar is a picture (`aria-hidden`); the words
// are the list. The exact amounts and counts are in the table view (ChartTable).

const DATA: BarListData = {
  items: [
    { id: "xrp", label: "XRP", value: "1240000000", share: "58%", count: "812034" },
    { id: "usd", label: "USD", sublabel: "rMxCK…5De", value: "620000000", share: "29%", count: "41230" },
    { id: "eur", label: "EUR", sublabel: "rhub8…hKz", value: "12400000", share: "<1%" },
  ],
  format: { kind: "amount", unit: "XRP" },
  token: "b1",
};

function barlist(extra: Partial<BarListData> = {}): BarListData {
  return { ...DATA, ...extra };
}

const items = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>("ol > li"));
const bars = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".barlist__bar"));
const tips = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".barlist__tip"));

describe("BarList as the Worker prints it and the browser takes it over", () => {
  it("is an ordered list with a row for each item, in the order given, each with its label and the sublabel under it", async () => {
    const { container, errors } = await serverThenHydrated(<BarList data={DATA} />);
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(items(container)).toHaveLength(3);
    expect(items(container).map((li) => li.querySelector(".barlist__label")!.textContent)).toEqual(["XRP", "USD", "EUR"]);
    expect(items(container).map((li) => li.querySelector(".barlist__sub")?.textContent ?? null)).toEqual([null, "rMxCK…5De", "rhub8…hKz"]);
    expect(errors).toEqual([]);
  });

  it("draws each bar as wide as its value over the largest: the first is the whole track, the second half of it", async () => {
    const { container, errors } = await serverThenHydrated(<BarList data={DATA} />);
    expect(bars(container).map((bar) => bar.style.width)).toEqual(["100%", "50%", "1%"]);
    expect(errors).toEqual([]);
  });

  it("measures against the largest wherever it is in the list", async () => {
    const { container } = await serverThenHydrated(<BarList data={barlist({ items: [DATA.items[2]!, DATA.items[1]!, DATA.items[0]!] })} />);
    expect(bars(container).map((bar) => bar.style.width)).toEqual(["1%", "50%", "100%"]);
  });

  it("writes the value strong and the share after it at the tip of the bar: '1.24B XRP · 58%'", async () => {
    const { container } = await serverThenHydrated(<BarList data={DATA} />);
    expect(tips(container).map((tip) => tip.textContent)).toEqual(["1.24B XRP · 58%", "620M XRP · 29%", "12.4M XRP · <1%"]);
    expect(tips(container)[0]!.querySelector("b")!.textContent).toBe("1.24B XRP");
  });

  it("writes the share as it was given, whole, however it reads", async () => {
    const { container } = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A", value: "5", share: "99.5%" }] })} />);
    expect(tips(container)[0]!.textContent).toBe("5 XRP · 99.5%");
  });

  it("follows the format: a count has no unit of its own, drops have theirs", async () => {
    const counts = await serverThenHydrated(<BarList data={barlist({ format: { kind: "count" } })} />);
    expect(tips(counts.container).map((tip) => tip.textContent)).toEqual(["1.24B · 58%", "620M · 29%", "12.4M · <1%"]);
    const drops = await serverThenHydrated(<BarList data={barlist({ format: { kind: "drops" } })} />);
    expect(tips(drops.container)[0]!.textContent).toBe("1.24B drops · 58%");
  });

  it("hides the bars from assistive technology and leaves the words: the tip is not inside anything hidden", async () => {
    const { container } = await serverThenHydrated(<BarList data={DATA} />);
    for (const bar of bars(container)) expect(bar.getAttribute("aria-hidden")).toBe("true");
    for (const tip of tips(container)) expect(tip.closest('[aria-hidden="true"]')).toBeNull();
    // What a screen reader hears of a row: the label, the sublabel, the value and the share.
    expect(items(container)[1]!.textContent).toBe("USDrMxCK…5De620M XRP · 29%");
  });

  it("is 18 px thick, and 12 px when dense (the sizes are the stylesheet's, the class says which)", async () => {
    const regular = await serverThenHydrated(<BarList data={DATA} />);
    expect(regular.container.querySelector("ol")!.classList.contains("barlist--dense")).toBe(false);
    const dense = await serverThenHydrated(<BarList data={DATA} dense />);
    expect(dense.container.querySelector("ol")!.classList.contains("barlist--dense")).toBe(true);
    expect(dense.errors).toEqual([]);
  });

  it("makes room for the label and for the longest tip in the CSS, and measures nothing", async () => {
    const { container } = await serverThenHydrated(<BarList data={DATA} />);
    const list = container.querySelector<HTMLElement>("ol")!;
    // 'rMxCK…5De' is 9 characters at 11 px beside the 13 px label: 8 columns of the label's; and the column is 7 at the least.
    expect(list.style.getPropertyValue("--label")).toBe("min(8ch, 45%)");
    // '1.24B XRP · 58%' is 15 characters, and the longest; one more for the bold.
    expect(list.style.getPropertyValue("--tip")).toBe("calc(16ch + 10px)");
  });

  it("gives a column of at least 7 characters to the label, and caps it so that a long name wraps and does not crush the bars", async () => {
    const short = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A", value: "1", share: "1%" }] })} />);
    expect(short.container.querySelector<HTMLElement>("ol")!.style.getPropertyValue("--label")).toBe("min(7ch, 45%)");
    const long = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A pool of a long name", value: "1", share: "1%" }] })} />);
    expect(long.container.querySelector<HTMLElement>("ol")!.style.getPropertyValue("--label")).toBe("min(21ch, 45%)");
  });
});

describe("BarList's edges", () => {
  it("draws no bar for a value of 0 or one that is not a number, and its tip is there", async () => {
    const odd = barlist({
      items: [
        { id: "a", label: "A", value: "10", share: "100%" },
        { id: "b", label: "B", value: "0", share: "0%" },
        { id: "c", label: "C", value: "n/a", share: "—" },
      ],
    });
    const { html, container, errors } = await serverThenHydrated(<BarList data={odd} />);
    expect(bars(container).map((bar) => bar.style.width)).toEqual(["100%"]);
    expect(items(container)).toHaveLength(3);
    expect(tips(container)).toHaveLength(3);
    expect(html).not.toContain("NaN");
    expect(errors).toEqual([]);
  });

  it("draws no bar at all when no value is above 0", async () => {
    const { html, container } = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A", value: "0", share: "0%" }] })} />);
    expect(bars(container)).toHaveLength(0);
    expect(html).not.toContain("NaN");
  });

  it("is an empty list for no items", async () => {
    const { container, errors } = await serverThenHydrated(<BarList data={barlist({ items: [] })} />);
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(items(container)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("has nothing to hover or focus: every bar is labelled, and the table view has the exact numbers", async () => {
    const { container } = await serverThenHydrated(<BarList data={DATA} />);
    expect(container.querySelector('[role="slider"], [tabindex], button, a')).toBeNull();
  });
});

describe("BarList, memoised on the token (spec 2.9)", () => {
  const other = barlist({ items: [{ id: "xrp", label: "XRP", value: "5", share: "100%" }] });

  it("is not rendered again for the same token: the DOM stays, though the numbers it was handed are others", () => {
    const { container, rerender } = render(<BarList data={DATA} />);
    const first = container.querySelector("li");
    expect(items(container)).toHaveLength(3);

    rerender(<BarList data={{ ...other, token: "b1" }} />);
    expect(container.querySelector("li")).toBe(first);
    expect(items(container)).toHaveLength(3);
    expect(container.querySelector(".barlist.is-changed")).toBeNull();

    rerender(<BarList data={barlist()} />);
    expect(container.querySelector("li")).toBe(first);
    expect(container.querySelector(".barlist.is-changed")).toBeNull();
  });

  it("is drawn again for a new token, and rings once", () => {
    const { container, rerender } = render(<BarList data={DATA} />);
    expect(container.querySelector(".barlist.is-changed")).toBeNull();
    rerender(<BarList data={{ ...other, token: "b2" }} />);
    expect(container.querySelectorAll(".barlist.is-changed")).toHaveLength(1);
    expect(items(container)).toHaveLength(1);
    expect(tips(container)[0]!.textContent).toBe("5 XRP · 100%");
  });

  it("does not ring on the server's render or on hydration", async () => {
    const { html, container, errors } = await serverThenHydrated(<BarList data={DATA} />);
    expect(html).not.toContain("is-changed");
    expect(container.querySelector(".barlist.is-changed")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("is drawn again when it goes dense, which is part of what it is memoised on", () => {
    const { container, rerender } = render(<BarList data={DATA} />);
    rerender(<BarList data={DATA} dense />);
    expect(container.querySelector("ol")!.classList.contains("barlist--dense")).toBe(true);
  });
});
