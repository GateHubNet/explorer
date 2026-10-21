// The amendments list's view and the links to the amendments pages (spec 1.4). Pure and safe for the browser (no imports): the loader,
// the view builder and the pages import this file.
//
// One URL per view: `parseAmendmentsParams` gives the view a query names, and the loader answers a 302 to `amendmentsHref` of it when
// the request's query is not exactly that. The canonical form drops the default (all statuses), empty and unknown values, repeats and
// unknown parameters.

/**
 * D1's words for an amendment's status, one vocabulary from the API to the URL. The chips say "Activating", "Voting", "Activated",
 * "Obsolete" and "Unknown".
 */
export const AMENDMENT_STATUSES = ["majority", "voting", "enabled", "obsolete", "unknown"] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

/** The word for a status: `Activated`, `Activating`, `Voting`, `Obsolete`, `Unknown` (a status this file does not know, from a newer D1, is `Unknown`). */
export function statusWord(status: string): string {
  switch (status) {
    case "enabled":
      return "Activated";
    case "majority":
      return "Activating";
    case "voting":
      return "Voting";
    case "obsolete":
      return "Obsolete";
    default:
      return "Unknown";
  }
}

/** The list's view: one status, or all of them (`status` absent). */
export interface AmendmentsParams {
  status?: AmendmentStatus;
}

function isStatus(value: string | null): value is AmendmentStatus {
  return value !== null && (AMENDMENT_STATUSES as readonly string[]).includes(value);
}

/** The view a query names (with or without its `?`). Only the first `status` is read, in any case; anything but one status is dropped. */
export function parseAmendmentsParams(search: string): AmendmentsParams {
  const status = new URLSearchParams(search).get("status")?.toLowerCase() ?? null;
  return isStatus(status) ? { status } : {};
}

/** The canonical URL of a view of the list: the default view has no query. */
export function amendmentsHref(net: string, params: AmendmentsParams): string {
  return `/${net}/amendments${params.status !== undefined ? `?status=${params.status}` : ""}`;
}

/** The URL of an amendment's page: `nameOrId` is `amendmentSegment(row)`, the name as D1 writes it, else the ID. */
export function amendmentHref(net: string, nameOrId: string): string {
  return `/${net}/amendments/${encodeURIComponent(nameOrId)}`;
}
