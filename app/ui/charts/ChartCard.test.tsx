import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ChartCard } from "./ChartCard";
import { ColumnChart } from "./ColumnChart";
import { LineChart } from "./LineChart";
import type { TimeSeriesData } from "./types";

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

  it("says its message instead of 'Couldn't load …' when it has one, in the same place, with the same Retry", async () => {
    const onRetry = vi.fn();
    const message = "Still working on the account value. Retry in a few seconds.";
    const { container, errors } = await serverThenHydrated(card({ state: "failed", message, onRetry }));
    const alert = within(container).getByRole("alert");
    expect(alert.textContent).toBe(`${message}Retry`);
    expect(container.textContent).not.toContain("Couldn’t load");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.querySelector(".chart__view")).toBeNull();
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

describe("ChartCard loading", () => {
  const loading = (props: Partial<Props> = {}) =>
    card({ id: "value", title: "Account value, in XRP", source: "/v2/accounts/{a}/stats/value?interval=day", state: "loading", ...props });

  it("shows the title and the source, and 'Loading…' hidden from assistive technology where the views would be", async () => {
    const { container, errors } = await serverThenHydrated(loading());
    const section = container.querySelector("section.card.chart")!;
    expect(section.querySelector("h2")!.textContent).toBe("Account value, in XRP");
    expect(section.getAttribute("aria-labelledby")).toBe("value-title");
    expect(section.querySelector(".chart__source")!.textContent).toBe("/v2/accounts/{a}/stats/value?interval=day");
    const body = within(container).getByText("Loading…");
    expect(body.getAttribute("aria-hidden")).toBe("true");
    expect(body.parentElement).toBe(section);
    expect(body.previousElementSibling!.className).toBe("chart__head");
    expect(errors).toEqual([]);
  });

  it("is busy, and has neither a toggle nor a view, a table, a legend, a summary or notes", async () => {
    const { container, errors } = await serverThenHydrated(loading({ summary: <p className="summary-stub">Received</p> }));
    expect(container.querySelector("section")!.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.querySelector("input[type=radio]")).toBeNull();
    for (const part of [".chart__view", ".chart__table", ".chart__notes", ".chart__summary", ".legend-stub", ".plot-stub", ".table-stub", ".summary-stub"]) {
      expect(container.querySelector(part), part).toBeNull();
    }
    expect(within(container).queryByRole("alert")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("is a card of the other states again once its data is there: the toggle, and no busy mark", () => {
    const { container, rerender } = render(loading());
    expect(container.querySelector("input[type=radio]")).toBeNull();
    rerender(loading({ state: "ok" }));
    expect(container.querySelector("input[type=radio]")).not.toBeNull();
    expect(container.querySelector("section")!.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelector(".chart__loading")).toBeNull();
    expect(container.querySelector(".plot-stub")).not.toBeNull();
  });

  it("leaves the busy mark off a card that is ok, given or not, and off a failed one", async () => {
    for (const props of [{}, { state: "ok" as const }, { state: "failed" as const }]) {
      const { container, errors } = await serverThenHydrated(card(props));
      expect(container.querySelector("section")!.hasAttribute("aria-busy"), JSON.stringify(props)).toBe(false);
      expect(container.querySelector(".chart__loading"), JSON.stringify(props)).toBeNull();
      expect(errors).toEqual([]);
    }
  });

  it("is the card of state ok when no state is given", async () => {
    const { container, errors } = await serverThenHydrated(card());
    expect(container.querySelector("input[type=radio]")).not.toBeNull();
    expect(container.querySelector(".plot-stub")).not.toBeNull();
    expect(errors).toEqual([]);
  });
});

describe("ChartCard summary", () => {
  it("is drawn after the legend and before the chart view, in document order", async () => {
    const { container, errors } = await serverThenHydrated(card({ summary: <p>Received</p> }));
    const section = container.querySelector("section")!;
    expect(Array.from(section.children).map((child) => child.className)).toEqual([
      "chart__head",
      "legend-stub",
      "chart__summary",
      "chart__view",
      "chart__table",
      "chart__notes",
    ]);
    const [legend, summary, view] = [".legend-stub", ".chart__summary", ".chart__view"].map((selector) => section.querySelector(selector)!);
    expect(legend!.compareDocumentPosition(summary!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary!.compareDocumentPosition(view!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary!.querySelector("p")!.textContent).toBe("Received");
    expect(errors).toEqual([]);
  });

  it("is after the head when there is no legend, and not drawn at all when there is no summary", async () => {
    const { container, errors } = await serverThenHydrated(card({ legend: undefined, summary: <p>Received</p> }));
    expect(Array.from(container.querySelector("section")!.children).map((child) => child.className).slice(0, 3)).toEqual(["chart__head", "chart__summary", "chart__view"]);
    const none = await serverThenHydrated(card());
    expect(none.container.querySelector(".chart__summary")).toBeNull();
    expect(errors).toEqual([]);
    expect(none.errors).toEqual([]);
  });

  it("stays in the page when the visitor chooses the table, which hides the chart view only", async () => {
    const { container } = await serverThenHydrated(card({ summary: <p>Received</p> }));
    expect(container.querySelector(".chart__summary")!.closest(".chart__view")).toBeNull();
    expect(container.querySelector(".chart__summary")!.closest(".chart__table")).toBeNull();
  });

  it("is left out of a failed card, with the views", async () => {
    const { container, errors } = await serverThenHydrated(card({ state: "failed", summary: <p>Received</p> }));
    expect(container.querySelector(".chart__summary")).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe("the empty text of a card's chart", () => {
  const TITLE = "Transactions sent, per day";
  const DAYS = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10));
  const nothing = DAYS.map(() => null);
  const empty = (extra: Partial<TimeSeriesData> = {}): TimeSeriesData => ({
    axis: { unit: "day", buckets: DAYS },
    series: [
      { id: "Payment", label: "Payment", slot: 1, values: nothing },
      { id: "OfferCreate", label: "OfferCreate", slot: 2, values: nothing },
    ],
    totals: nothing,
    format: { kind: "count", unit: "transactions" },
    token: "t1",
    ...extra,
  });
  const WORDS = "No transactions sent in these 30 days";
  const inCard = (chart: ReactNode) => (
    <ChartCard id="sent" title={TITLE} source="/v2/accounts/{a}/stats/transactions?interval=day" what="transactions sent">
      {chart}
    </ChartCard>
  );

  it("is what a stacked ColumnChart with no value says in the middle of the plot, and the summary says it to a screen reader", async () => {
    const { container, errors } = await serverThenHydrated(inCard(<ColumnChart layout="stacked" title={TITLE} data={empty({ emptyText: WORDS })} />));
    expect(container.querySelector(".plot__empty")!.textContent).toBe(WORDS);
    expect(container.querySelector(".plot__marks")!.getAttribute("aria-label")).toBe(`${TITLE}: ${WORDS}.`);
    expect(errors).toEqual([]);
  });

  it("is the kit's own words without it: 'No data for these 30 days'", async () => {
    const { container, errors } = await serverThenHydrated(inCard(<ColumnChart layout="stacked" title={TITLE} data={empty()} />));
    expect(container.querySelector(".plot__empty")!.textContent).toBe("No data for these 30 days");
    expect(container.querySelector(".plot__marks")!.getAttribute("aria-label")).toBe(`${TITLE}: No data for these 30 days.`);
    expect(errors).toEqual([]);
  });

  it("is said in a diverging and a single ColumnChart, and in a LineChart, as well", async () => {
    for (const element of [
      <ColumnChart key="d" layout="diverging" title={TITLE} data={empty({ emptyText: WORDS })} />,
      <ColumnChart key="s" layout="single" title={TITLE} data={empty({ emptyText: WORDS, series: [empty().series[0]!] })} />,
      <LineChart key="l" title={TITLE} data={empty({ emptyText: WORDS })} />,
      <LineChart key="a" title={TITLE} area data={empty({ emptyText: WORDS, series: [empty().series[0]!] })} />,
    ]) {
      const { container, errors } = await serverThenHydrated(inCard(element));
      expect(container.querySelector(".plot__empty")!.textContent, String(element.key)).toBe(WORDS);
      expect(container.querySelector(".plot__marks")!.getAttribute("aria-label"), String(element.key)).toBe(`${TITLE}: ${WORDS}.`);
      expect(errors).toEqual([]);
    }
  });

  it("is not said when a bucket has a value: the plot is drawn, and the text is not in the page", async () => {
    const some = empty({ emptyText: WORDS });
    some.series[0]!.values = DAYS.map((_, i) => (i === 3 ? "4" : null));
    some.totals = DAYS.map((_, i) => (i === 3 ? "4" : null));
    const { container, errors } = await serverThenHydrated(inCard(<ColumnChart layout="stacked" title={TITLE} data={some} />));
    expect(container.querySelector(".plot__empty")).toBeNull();
    expect(container.textContent).not.toContain(WORDS);
    expect(errors).toEqual([]);
  });
});
