// Paging of a list by marker, shared by the lists that have one (the account page's, the pair page's trades). No I/O; used in the
// Worker, by the view builders.
//
// The data API's markers only run towards older rows, so a page can go back to the one before only if its URL remembers it: `marker` is
// how the page was reached, and `back` the markers of the pages before it, nearest first, in `?back=` joined by dots.

import { isMarker } from "../server/marker";

/** The pages before the current one that a URL remembers, so that Newer can go back to the one before. */
export const MAX_TRAIL = 10;

/** The markers of `?back=`: the pages newer than this one, nearest first, joined by dots. Anything that is not that is no trail. */
export function parseTrail(back: string | null): string[] {
  if (back === null || back === "") return [];
  const pieces = back.split(".");
  return pieces.length <= MAX_TRAIL && pieces.every(isMarker) ? pieces : [];
}

export interface Paging {
  newerHref: string | null;
  olderHref: string | null;
}

/**
 * The Newer and Older links of a page of a list. Older is the API's `next` marker. A page reached with no trail (a link someone
 * copied) goes back to the first page. `href` writes the URL of a page from the marker it is reached with and the trail behind it
 * (the first page has neither).
 */
export function trailPaging(
  page: { marker?: string; back: readonly string[]; next?: string },
  href: (to: { marker?: string; back: readonly string[] }) => string,
): Paging {
  const { marker, back, next } = page;
  const newerHref =
    marker === undefined ? null : back.length === 0 ? href({ back: [] }) : href({ marker: back[0], back: back.slice(1) });
  const olderHref =
    next === undefined ? null : href({ marker: next, back: marker === undefined ? [] : [marker, ...back].slice(0, MAX_TRAIL) });
  return { newerHref, olderHref };
}
