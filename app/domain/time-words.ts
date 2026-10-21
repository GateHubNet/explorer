// The words for a moment and for a list, for the pages that draw them (the countdown, the validators and amendments pages): a date, a date and
// minute, the time left until a moment, a list as a sentence. Pure: the browser and the Worker both import this file.
//
// They live apart from format.ts because format.ts is in the closure of the root route's static imports, so the build puts it in the shell
// chunk every page loads, and keeps there whatever of it any page imports: the first page to draw a countdown would have put these in the
// shell for all of them. Here they are in the chunk of the pages that use them. Dates are written from a fixed month table (no `Intl`, no
// locale), so the text is the same in every browser and on the server.

import { formatUtcDay, utcMoment } from "./format";

/**
 * The UTC date of a moment as `Oct 9, 2026`. Takes what `formatUtc` takes (an ISO date or date and time, read as UTC; a number is Unix
 * seconds) and returns what is not a moment as it came.
 */
export function formatDate(at: string | number): string {
  const date = utcMoment(at);
  return date ? formatUtcDay(date.toISOString().slice(0, 10), true) : String(at);
}

/** The UTC date and minute of a moment as `Oct 9, 2026, 09:34 UTC`; takes and returns what `formatDate` does. */
export function formatDateTime(at: string | number): string {
  const date = utcMoment(at);
  if (!date) return String(at);
  const iso = date.toISOString();
  return `${formatUtcDay(iso.slice(0, 10), true)}, ${iso.slice(11, 16)} UTC`;
}

/**
 * How long until the moment `atMs`, seen at `nowMs`: `under a minute`, `11 min` (rounded up), `5 h` (rounded down) or `4 days` (to the
 * nearest day, half up). `null` when the moment is now or has gone, so that the caller says its own past text. With `approx` the number
 * has a `~` before it: the moment is an estimate.
 */
export function untilText(atMs: number, nowMs: number, opts: { approx?: boolean } = {}): string | null {
  const seconds = (atMs - nowMs) / 1000;
  if (!(seconds > 0)) return null;
  if (seconds < 60) return "under a minute";
  const tilde = opts.approx ? "~" : "";
  if (seconds < 3600) return `${tilde}${Math.ceil(seconds / 60)} min`;
  if (seconds < 48 * 3600) return `${tilde}${Math.floor(seconds / 3600)} h`;
  return `${tilde}${Math.round(seconds / 86_400)} days`;
}

/** A list as a sentence does it: `a`, `a and b`, `a, b and c` (no comma before the `and`). */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}
