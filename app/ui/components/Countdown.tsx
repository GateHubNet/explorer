import { formatDateTime, untilText } from "../../domain/format";
import { useClockSeconds } from "./RelativeTime";

export interface CountdownProps {
  /** The moment, unix seconds. A value that is not finite draws nothing. */
  at: number;
  /** The server's text and the first browser render's (the stored HTML): an absolute time ("expected 15:53 UTC"), or "". */
  fallback: string;
  /** The browser's text once `at` has passed ("due now", "expired"). */
  past: string;
  /** "~" before the number: the moment is an estimate. */
  approx?: boolean;
  /** Goes before the browser's text (the countdown or `past`) only, never before `fallback`. */
  lead?: string;
  className?: string;
}

/**
 * The time left until a moment (`in ~11 min`, `in 4 days`), ticking in the browser on `RelativeTime`'s one timer. The server prints
 * `fallback` instead (an absolute time, or nothing), because an HTML page is stored and served for seconds or for a year, and a
 * countdown in it would be wrong from the moment it is stored. The first render in the browser prints it too, so that hydration
 * matches. The absolute time is on hover and in `dateTime`.
 */
export function Countdown({ at, fallback, past, approx, lead, className }: CountdownProps) {
  const now = useClockSeconds();
  if (!Number.isFinite(at)) return null;
  const iso = new Date(at * 1000).toISOString();
  const left = now === null ? null : untilText(at * 1000, now * 1000, { approx });
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className}>
      {now === null ? fallback : `${lead ?? ""}${left === null ? past : `in ${left}`}`}
    </time>
  );
}
