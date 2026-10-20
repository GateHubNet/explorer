import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
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

/** The page the list is in: a link needs a router, as the pages that use it have. */
const routed = (ui: ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;
const links = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
const link0 = (container: HTMLElement) => links(container)[0]!;

describe("BarList's links (E3's traders, E5's fee votes)", () => {
  const LINKED: BarListData = {
    items: [
      { id: "a", label: "rJF2Xa…fQvg", sublabel: "Binance", value: "6100000", share: "58%", href: "/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg" },
      { id: "b", label: "rN7n7o…2Rh", value: "3050000", share: "29%", href: "/xrpl/account/rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRh" },
      { id: "c", label: "Not linked", value: "61000", share: "<1%" },
    ],
    format: { kind: "amount", unit: "XRP" },
    token: "l1",
  };

  it("makes the label of an item with an href a link to it, and leaves the other labels as text", async () => {
    const { container, errors } = await serverThenHydrated(routed(<BarList data={LINKED} />));
    expect(links(container).map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["rJF2Xa…fQvg", "/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg"],
      ["rN7n7o…2Rh", "/xrpl/account/rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRh"],
    ]);
    const labels = Array.from(container.querySelectorAll(".barlist__label"));
    expect(labels.map((label) => label.querySelector("a") !== null)).toEqual([true, true, false]);
    expect(labels.map((label) => label.textContent)).toEqual(["rJF2Xa…fQvg", "rN7n7o…2Rh", "Not linked"]);
    expect(errors).toEqual([]);
  });

  it("is in the HTML the Worker prints, so that it works without the script", () => {
    const html = renderToString(routed(<BarList data={LINKED} />));
    expect(html).toContain('href="/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg"');
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it("keeps the bar a picture: aria-hidden, no link around it and nothing of it to tab to; the sublabel and the tip are text beside the link", async () => {
    const { container } = await serverThenHydrated(routed(<BarList data={LINKED} />));
    for (const bar of bars(container)) {
      expect(bar.getAttribute("aria-hidden")).toBe("true");
      expect(bar.closest("a")).toBeNull();
      expect(bar.querySelector("a")).toBeNull();
    }
    for (const part of container.querySelectorAll(".barlist__sub, .barlist__tip, .barlist__lane")) expect(part.closest("a")).toBeNull();
    expect(links(container).every((link) => link.querySelector("[aria-hidden]") === null && link.closest('[aria-hidden="true"]') === null)).toBe(true);
    expect(container.querySelectorAll("a, [tabindex], button")).toHaveLength(2);
  });

  it("changes nothing in what a screen reader hears of a row but the label being a link", async () => {
    const { container } = await serverThenHydrated(routed(<BarList data={LINKED} />));
    expect(items(container)[0]!.textContent).toBe("rJF2Xa…fQvg" + "Binance" + "6.1M XRP · 58%");
  });

  it("gives the link a class of its own, for its hit area", async () => {
    const { container } = await serverThenHydrated(routed(<BarList data={LINKED} />));
    expect(links(container).every((link) => link.classList.contains("barlist__link"))).toBe(true);
    expect(link0(container).closest(".barlist__label")).not.toBeNull();
  });

  it("draws no link, and needs no router, when no item has an href", async () => {
    const { container, errors } = await serverThenHydrated(<BarList data={DATA} />);
    expect(links(container)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("redraws a label that gains an href, as a new token does", () => {
    const { container, rerender } = render(routed(<BarList data={{ ...LINKED, items: LINKED.items.map(({ href: _href, ...item }) => item) }} />));
    expect(links(container)).toHaveLength(0);
    rerender(routed(<BarList data={{ ...LINKED, token: "l2" }} />));
    expect(links(container)).toHaveLength(2);
  });
});

describe("BarList with tip=\"count\" (the traders)", () => {
  const TRADERS: BarListData = {
    items: [
      { id: "a", label: "rJF2Xa…fQvg", value: "6100000", count: "312", href: "/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg" },
      { id: "b", label: "rN7n7o…2Rh", value: "3050000", count: "1204" },
      { id: "c", label: "rPEPPE…ZZ", value: "61000", count: "1" },
      { id: "d", label: "rQuiet…00", value: "0", count: "0" },
    ],
    format: { kind: "amount", unit: "XRP" },
    token: "t1",
  };

  it("reads '6.1M XRP · 312 trades' at the tip: the value strong, then the count and 'trades', with no share needed", async () => {
    const { container, errors } = await serverThenHydrated(routed(<BarList data={TRADERS} tip="count" />));
    expect(tips(container).map((tip) => tip.textContent)).toEqual(["6.1M XRP · 312 trades", "3.05M XRP · 1,204 trades", "61K XRP · 1 trade", "0 XRP · 0 trades"]);
    expect(tips(container)[0]!.querySelector("b")!.textContent).toBe("6.1M XRP");
    expect(errors).toEqual([]);
  });

  it("says 'trade' for a count of 1 as text, and 'trades' for any other text: 0, 10, 11, 21, 100, 1.0", async () => {
    // A count is the text of a whole number: it is compared as text, not read as a float, so only "1" is one.
    const counts = ["1", "0", "10", "11", "21", "100", "1204", "1.0"];
    const data = barlist({ items: counts.map((count, i) => ({ id: String(i), label: `L${i}`, value: "5", count })), format: { kind: "count" } });
    const { container } = await serverThenHydrated(<BarList data={data} tip="count" />);
    expect(tips(container).map((tip) => tip.textContent)).toEqual([
      "5 · 1 trade",
      "5 · 0 trades",
      "5 · 10 trades",
      "5 · 11 trades",
      "5 · 21 trades",
      "5 · 100 trades",
      "5 · 1,204 trades",
      "5 · 1.0 trades",
    ]);
  });

  it("ignores a share that is given, which the table view keeps", async () => {
    const data = barlist({ items: DATA.items });
    const { container } = await serverThenHydrated(<BarList data={data} tip="count" />);
    expect(tips(container).map((tip) => tip.textContent)).toEqual(["1.24B XRP · 812,034 trades", "620M XRP · 41,230 trades", "12.4M XRP"]);
  });

  it("draws each bar as wide as its value over the FIRST item's, the list being sorted", async () => {
    const { container } = await serverThenHydrated(routed(<BarList data={TRADERS} tip="count" />));
    expect(bars(container).map((bar) => bar.style.width)).toEqual(["100%", "50%", "1%"]);
    // The share-mode rule measures against the largest wherever it is: the first, not the largest, is the count mode's.
    const unsorted = barlist({ items: [TRADERS.items[1]!, TRADERS.items[0]!], format: TRADERS.format });
    const byFirst = await serverThenHydrated(routed(<BarList data={unsorted} tip="count" />));
    expect(bars(byFirst.container).map((bar) => bar.style.width)).toEqual(["100%", "100%"]);
    const byLargest = await serverThenHydrated(routed(<BarList data={unsorted} />));
    expect(bars(byLargest.container).map((bar) => bar.style.width)).toEqual(["50%", "100%"]);
  });

  it("holds a bar longer than the first's at the end of its lane, and draws none when the first is 0 or not a number", async () => {
    const { container } = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A", value: "2", count: "1" }, { id: "b", label: "B", value: "5", count: "1" }], format: { kind: "count" } })} tip="count" />);
    expect(bars(container).map((bar) => bar.style.width)).toEqual(["100%", "100%"]);
    for (const first of ["0", "n/a", "-3"]) {
      const none = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A", value: first, count: "1" }, { id: "b", label: "B", value: "5", count: "1" }], format: { kind: "count" } })} tip="count" />);
      expect(bars(none.container)).toHaveLength(0);
      expect(none.html).not.toContain("NaN");
      expect(none.html).not.toContain("Infinity");
    }
  });

  it("leaves the count out of the tip of an item that has none", async () => {
    const { container } = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A", value: "6100000" }], format: TRADERS.format })} tip="count" />);
    expect(tips(container)[0]!.textContent).toBe("6.1M XRP");
  });

  it("makes room for the longest tip, 'trades' included", async () => {
    const { container } = await serverThenHydrated(routed(<BarList data={TRADERS} tip="count" />));
    // '3.05M XRP · 1,204 trades' is 24 characters, the longest; one more for the bold.
    expect(container.querySelector<HTMLElement>("ol")!.style.getPropertyValue("--tip")).toBe("calc(25ch + 10px)");
  });

  it("is a list of links to the account pages in the traders' use, the bar still a picture", async () => {
    const { container } = await serverThenHydrated(routed(<BarList data={TRADERS} tip="count" />));
    expect(links(container).map((link) => link.getAttribute("href"))).toEqual(["/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg"]);
    for (const bar of bars(container)) expect(bar.getAttribute("aria-hidden")).toBe("true");
  });

  it("is drawn again when the tip changes, which is part of what it is memoised on", () => {
    const { container, rerender } = render(<BarList data={DATA} />);
    expect(tips(container)[0]!.textContent).toBe("1.24B XRP · 58%");
    rerender(<BarList data={DATA} tip="count" />);
    expect(tips(container)[0]!.textContent).toBe("1.24B XRP · 812,034 trades");
  });
});

describe("BarList without a share, in the default tip", () => {
  it("writes the value alone at the tip, with no dot after it, and does not say undefined", async () => {
    const { html, container } = await serverThenHydrated(<BarList data={barlist({ items: [{ id: "a", label: "A", value: "5" }, { id: "b", label: "B", value: "2", share: "40%" }] })} />);
    expect(tips(container).map((tip) => tip.textContent)).toEqual(["5 XRP", "2 XRP · 40%"]);
    expect(html).not.toContain("undefined");
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
