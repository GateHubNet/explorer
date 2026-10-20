import type { ReactNode } from "react";

import { bucketLabel, gapText, valueText } from "./labels";
import type { TimeAxis, TimeSeriesExtra } from "./types";

/** A value that is missing, in a tooltip. */
export const DASH = "—";

/**
 * What a cursor says of a bucket, for the forms that plot over time (spec 2.6 and 2.8): its date, with "so far" on the running bucket, and
 * what a bucket with no value in any series says: "no data", or "not computed yet" for the newest `pending` buckets.
 */
export function bucketWords(axis: TimeAxis, forming: boolean, pending: number) {
  const count = axis.buckets.length;
  const isPending = (i: number): boolean => pending > 0 && i >= count - pending;
  const date = (i: number): string => bucketLabel(axis.buckets[i] ?? "", axis.unit, "tooltip", forming && i === count - 1);
  return {
    date,
    /** The slider's text for a bucket with no value. */
    gapReadOut: (i: number): string => `${date(i)}: ${isPending(i) ? "not computed yet" : "no data"}`,
    /** The tooltip's content for it: "No data for Oct 3" names its day, "Not computed yet" does not, and has the date above it. */
    gapTip: (i: number): ReactNode => {
      const note = <span className="plot__tip-note">{gapText(axis, i, pending)}</span>;
      return isPending(i) ? (
        <>
          <span className="plot__tip-date">{date(i)}</span>
          {note}
        </>
      ) : (
        note
      );
    },
  };
}

/**
 * What `TimeSeriesData.extras` say of bucket `i`, for the forms that plot over time. `read` is what each adds to the slider after the series
 * ("Failed 1", "Failed no data"), and `rows` the tooltip's rows after the series and the total: with no key, the value strong and the label
 * muted ("**1** failed"; a capital followed by a lower-case letter is lowered, "RLUSD fees" stays), or for `tooltip: "value"` the value alone.
 * A value goes through the extra's `format` as a series' does, else it is the text as given; none is a dash, read "no data".
 */
export function extraWords(extras: readonly TimeSeriesExtra[] | undefined) {
  const text = ({ values, format }: TimeSeriesExtra, i: number): string | null => {
    const value = values[i] ?? null;
    return value !== null && format ? valueText(value, format, "full") : value;
  };
  return {
    read: (i: number): string[] => (extras ?? []).map((extra) => `${extra.label} ${text(extra, i) ?? "no data"}`),
    rows: (i: number): ReactNode[] =>
      (extras ?? []).map((extra) => {
        const value = text(extra, i) ?? DASH;
        return (
          <span key={extra.id} className="plot__tip-row">
            {extra.tooltip === "value" ? (
              value
            ) : (
              <>
                <b>{value}</b> <span className="plot__tip-name">{extra.label.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase())}</span>
              </>
            )}
          </span>
        );
      }),
  };
}
