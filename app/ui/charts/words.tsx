import type { ReactNode } from "react";

import { bucketLabel, gapText } from "./labels";
import type { TimeAxis } from "./types";

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
