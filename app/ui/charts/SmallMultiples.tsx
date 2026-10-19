import { memo } from "react";

import { cellOf, lastOf, type Cell } from "./cells";
import { HoverGroup, useHoverGroup } from "./Cursor";
import { emptyText, valueText } from "./labels";
import { LinePlot } from "./LineChart";
import type { SmallMultiplesData, TimeSeriesData } from "./types";
import { DASH } from "./words";

export interface SmallMultiplesProps {
  /** The chart's name: each panel's image and slider are named after it and the panel. */
  title: string;
  data: SmallMultiplesData;
}

/** The grid holds at most this many panels (spec 2.3). */
const MAX_PANELS = 6;

type Panel = SmallMultiplesData["panels"][number];

/**
 * The readout in a panel's header: the value of the bucket the group is on (the pointer or the keyboard, in any panel), else the newest value
 * that there is, `compactNumber` with the panel's unit. A panel with no value in the hovered bucket says so with a dash: it does not borrow
 * another bucket's. Only this follows the group, so that a pointer move renders the readouts and the cursors and not the marks.
 */
function Readout({ panel, count }: { panel: Panel; count: number }) {
  const active = useHoverGroup()?.active ?? null;
  const cells: (Cell | null)[] = Array.from({ length: count }, (_, i) => cellOf(panel.values[i]));
  const cell = active !== null && active >= 0 && active < count ? cells[active] : cells[lastOf(cells)];
  return <b className="panel__value">{cell ? valueText(cell.text, panel.format, "compact") : DASH}</b>;
}

/**
 * A grid of one-series lines (spec 2.3 and 2.11): a panel for each of `data.panels`, at most 6, each a line in slot 1 on a scale of its own,
 * with 3 ticks from 0 (or from the panel's lowest value when that is below 0), its label and sublabel and a readout in its header, and
 * the x labels at the two ends only. The card says that each panel has its own scale. One `HoverGroup` gives the panels one bucket: every
 * panel draws the crosshair and its dot there and says its value in its header, and the one under the pointer or focus has the tooltip.
 * A panel is drawn as a `LinePlot` of one series, 110 px high.
 *
 * Memoised on `title` and the data's `token` (spec 2.9): a beat that brings the same token renders nothing.
 */
export const SmallMultiples = memo(
  function SmallMultiples({ title, data }: SmallMultiplesProps) {
    const { axis, forming, pending } = data;
    const panels = data.panels.slice(0, MAX_PANELS);
    if (panels.length === 0) {
      return (
        <div className="multiples">
          <p className="multiples__empty">{emptyText(axis)}</p>
        </div>
      );
    }

    return (
      <HoverGroup>
        <div className="multiples">
          {panels.map((panel) => {
            const line: TimeSeriesData = {
              axis,
              series: [{ id: panel.id, label: panel.label, slot: 1, values: panel.values }],
              format: panel.format,
              forming,
              pending,
              token: data.token,
            };
            return (
              <div key={panel.id} className="panel">
                <div className="panel__head">
                  <h3 className="panel__name">
                    {panel.label}
                    {panel.sublabel && (
                      <>
                        {" "}
                        <span className="chart__sub">{panel.sublabel}</span>
                      </>
                    )}
                  </h3>
                  <Readout panel={panel} count={axis.buckets.length} />
                </div>
                <LinePlot title={`${title}, ${panel.label}`} data={line} panel />
              </div>
            );
          })}
        </div>
      </HoverGroup>
    );
  },
  (before, after) => before.title === after.title && before.data.token === after.data.token,
);
