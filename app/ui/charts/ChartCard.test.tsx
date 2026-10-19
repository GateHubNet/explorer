import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ChartCard } from "./ChartCard";

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof ChartCard>[0];

const card = (props: Partial<Props> = {}) => (
  <ChartCard
    id="types"
    title="Transactions by type"
    source="/v2/stats/type?interval=day"
    what="transactions by type"
    legend={<ul className="legend-stub"><li>Payment</li></ul>}
    table={<p className="table-stub">every value</p>}
    notes={["Times are UTC.", <>The newest day is <b>not complete</b> yet.</>]}
    {...props}
  >
    <div className="plot-stub">the plot</div>
  </ChartCard>
);

describe("ChartCard as the Worker prints it and the browser takes it over", () => {
  it("is a card section named by its h2, with the source line beside it", async () => {
    const { html, container, errors } = await serverThenHydrated(card());
    expect(html).toContain('<section class="card chart"');
    const section = container.querySelector("section")!;
    const title = section.querySelector("h2")!;
    expect(title.textContent).toBe("Transactions by type");
    expect(title.id).toBe("types-title");
    expect(section.getAttribute("aria-labelledby")).toBe(title.id);
    expect(section.querySelector(".chart__head .chart__source")!.textContent).toBe("/v2/stats/type?interval=day");
    expect(within(container).getByRole("region", { name: "Transactions by type" })).toBe(section);
    expect(errors).toEqual([]);
  });

  it("puts the head, the legend, the chart view, the table view and the notes in that order", async () => {
    const { container, errors } = await serverThenHydrated(card());
    const section = container.querySelector("section")!;
    expect(Array.from(section.children).map((child) => child.className)).toEqual([
      "chart__head",
      "legend-stub",
      "chart__view",
      "chart__table",
      "chart__notes",
    ]);
    expect(errors).toEqual([]);
  });

  it("has two uncontrolled radios, named for the card, with Chart checked", async () => {
    const { html, container, errors } = await serverThenHydrated(card());
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    expect(radios.map((radio) => [radio.name, radio.value, radio.checked])).toEqual([
      ["types-view", "chart", true],
      ["types-view", "table", false],
    ]);
    // Checked in the HTML itself: the choice does not wait for script.
    expect(html).toMatch(/<input[^>]*value="chart"[^>]*checked=""|<input[^>]*checked=""[^>]*value="chart"/);
    expect(html).not.toMatch(/<input[^>]*value="table"[^>]*checked/);
    expect(errors).toEqual([]);
  });

  it("is a fieldset of segments, whose legend names the choice and whose labels are the radios' names", async () => {
    const { container, errors } = await serverThenHydrated(card());
    const fieldset = container.querySelector("fieldset")!;
    expect(fieldset.className).toBe("segs chart__toggle");
    expect(fieldset.closest(".chart__head")).not.toBeNull();
    const legend = fieldset.querySelector("legend")!;
    expect(legend.textContent).toBe("Transactions by type: view");
    expect(legend.className).toBe("sr");
    expect(within(container).getByRole("radio", { name: "Chart" })).toBe(fieldset.querySelector("input[value=chart]"));
    expect(within(container).getByRole("radio", { name: "Table" })).toBe(fieldset.querySelector("input[value=table]"));
    expect(within(container).getByRole("group", { name: "Transactions by type: view" })).toBe(fieldset);
    expect(errors).toEqual([]);
  });

  it("prints both views, the chart in .chart__view and the table in .chart__table", async () => {
    const { container, errors } = await serverThenHydrated(card());
    expect(container.querySelector(".chart__view .plot-stub")!.textContent).toBe("the plot");
    expect(container.querySelector(".chart__table .table-stub")!.textContent).toBe("every value");
    expect(errors).toEqual([]);
  });

  it("prints each note as a paragraph in .chart__notes, and nothing when there are none", async () => {
    const { container, errors } = await serverThenHydrated(card());
    const notes = Array.from(container.querySelectorAll(".chart__notes > p"));
    expect(notes.map((note) => note.textContent)).toEqual(["Times are UTC.", "The newest day is not complete yet."]);
    expect(notes[1]!.querySelector("b")!.textContent).toBe("not complete");
    expect(errors).toEqual([]);

    const none = await serverThenHydrated(card({ notes: undefined }));
    expect(none.container.querySelector(".chart__notes")).toBeNull();
    expect(none.errors).toEqual([]);
  });

  it("takes a class of the page", async () => {
    const { container, errors } = await serverThenHydrated(card({ className: "chart--wide" }));
    expect(container.querySelector("section")!.className).toBe("card chart chart--wide");
    expect(errors).toEqual([]);
  });

  it("leaves the legend out when there is none", async () => {
    const { container, errors } = await serverThenHydrated(card({ legend: undefined }));
    expect(Array.from(container.querySelector("section")!.children).map((child) => child.className)).toEqual([
      "chart__head",
      "chart__view",
      "chart__table",
      "chart__notes",
    ]);
    expect(errors).toEqual([]);
  });

  it("keeps the choice of the visitor when it is rendered again with other children", () => {
    const { container, rerender } = render(card());
    const table = container.querySelector<HTMLInputElement>("input[value=table]")!;
    fireEvent.click(table);
    expect(table.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input[value=chart]")!.checked).toBe(false);

    rerender(
      card({ table: <p className="table-stub">new values</p> }),
    );
    expect(container.querySelector(".table-stub")!.textContent).toBe("new values");
    expect(container.querySelector<HTMLInputElement>("input[value=table]")).toBe(table);
    expect(table.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input[value=chart]")!.checked).toBe(false);
  });
});

describe("ChartCard failed", () => {
  it("shows the section error with a Retry in place of the toggle and both views, under the title", async () => {
    const onRetry = vi.fn();
    const { container, errors } = await serverThenHydrated(card({ state: "failed", onRetry }));
    expect(container.textContent).toContain("Couldn’t load transactions by type.");
    expect(within(container).getByRole("alert")).toBeTruthy();
    fireEvent.click(within(container).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(container.querySelector("input[type=radio]")).toBeNull();
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.querySelector(".chart__view")).toBeNull();
    expect(container.querySelector(".chart__table")).toBeNull();
    expect(container.querySelector(".plot-stub")).toBeNull();
    expect(container.querySelector(".legend-stub")).toBeNull();
    expect(container.querySelector(".chart__notes")).toBeNull();

    const section = container.querySelector("section.card.chart")!;
    expect(section.getAttribute("aria-labelledby")).toBe("types-title");
    expect(section.querySelector("h2")!.id).toBe("types-title");
    expect(section.querySelector(".chart__source")!.textContent).toBe("/v2/stats/type?interval=day");
    expect(errors).toEqual([]);
  });

  it("disables Retry while it retries", () => {
    render(card({ state: "failed", onRetry: () => {}, retrying: true }));
    expect(screen.getByRole("button", { name: /Retry/ }).hasAttribute("disabled")).toBe(true);
  });

  it("is the card of state ok when no state is given", async () => {
    const { container, errors } = await serverThenHydrated(card({ state: "ok" }));
    expect(container.querySelector("input[type=radio]")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(errors).toEqual([]);
  });
});
