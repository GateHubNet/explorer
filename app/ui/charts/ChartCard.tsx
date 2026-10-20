import type { ReactNode } from "react";

import { cx } from "../cx";
import { SectionError } from "../components/SectionError";

/** For a failed card whose page gave no handler: the section error always has its button, and this does nothing. */
const NOTHING = () => {};

/**
 * The card of a chart (spec 2.5): the title and the source line, a Chart/Table toggle, the legend, the chart view and the table view, and
 * the notes, in that order. `id` names the card: the title is `{id}-title` and the toggle's radios are `{id}-view`.
 *
 * The toggle works with no script. It is a fieldset of two native radios, Chart checked in the HTML, and `charts.css` shows the table
 * and hides the chart when the Table radio is checked (`:has()`); where that is missing both views show and the toggle is not drawn. The
 * radios are uncontrolled, so a render that brings new data (a beat of the live page) leaves the visitor's choice alone. Both views are
 * in the HTML, so the cached page has the table as well as the plot.
 *
 * `state="failed"` is the card whose data could not be loaded: the title and the source stay, and a `SectionError` with a Retry stands
 * in place of the toggle, the legend, both views and the notes. `what` finishes "Couldn't load …".
 *
 * `state="loading"` is the card of a stream, before its data: the title and the source stay, and "Loading…" fills the height the plot will
 * have, hidden from assistive technology (the card is `aria-busy`, and the page's one status says it is loading). There is no toggle, and
 * no legend, view or notes. `summary` is the line of figures between the legend and the plot, and stays when the table is chosen.
 */
export function ChartCard({
  id,
  title,
  source,
  what,
  state = "ok",
  onRetry,
  retrying,
  legend,
  summary,
  table,
  notes,
  className,
  children,
}: {
  id: string;
  title: string;
  /** The data API path the chart is made from, in the mono line under the title. */
  source: string;
  /** What to call the chart in the words of a failure: "transactions by type". */
  what: string;
  state?: "ok" | "failed" | "loading";
  onRetry?: () => void;
  retrying?: boolean;
  /** The `Legend`, for a chart with two or more series. */
  legend?: ReactNode;
  /** A line of figures between the legend and the plot ("Received +45.2K · sent −38.1K"), the view builder's. */
  summary?: ReactNode;
  /** The table view: a `ChartTable`. */
  table?: ReactNode;
  /** One paragraph each, in the faint note style. */
  notes?: readonly ReactNode[];
  className?: string;
  children?: ReactNode;
}) {
  const titleId = `${id}-title`;
  const toggle = state === "ok" && (
    <fieldset className="segs chart__toggle">
      <legend className="sr">{title}: view</legend>
      <label>
        <input type="radio" name={`${id}-view`} value="chart" defaultChecked />
        Chart
      </label>
      <label>
        <input type="radio" name={`${id}-view`} value="table" />
        Table
      </label>
    </fieldset>
  );

  return (
    <section className={cx("card", "chart", className)} aria-labelledby={titleId} aria-busy={state === "loading" || undefined}>
      <div className="chart__head">
        <div className="chart__titles">
          <h2 id={titleId} className="chart__title">
            {title}
          </h2>
          <span className="chart__source">{source}</span>
        </div>
        {toggle}
      </div>
      {state === "failed" ? (
        <SectionError what={what} onRetry={onRetry ?? NOTHING} retrying={retrying} />
      ) : state === "loading" ? (
        <div className="chart__loading" aria-hidden="true">
          Loading…
        </div>
      ) : (
        <>
          {legend}
          {summary && <div className="chart__summary">{summary}</div>}
          <div className="chart__view">{children}</div>
          <div className="chart__table">{table}</div>
          {notes && notes.length > 0 && (
            <div className="chart__notes">
              {notes.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
