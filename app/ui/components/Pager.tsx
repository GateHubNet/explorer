import { Link } from "react-router";

import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

/** What the two directions say when a page gives no words of its own. */
const DEFAULT_LABELS = { newer: "Newer", older: "Older" } as const;

/**
 * Newer and Older buttons for a list that runs newest first and pages by marker. A direction with no page is shown disabled,
 * so the pair does not jump around.
 *
 * `labels` are the words of the two directions, for a list that is not ordered by time (the AMM pools: "Previous" and "More pools");
 * the `nav` is "Pagination" either way. `preventScrollReset` makes a click a client-side navigation that keeps the window where it is
 * (both links), for a list whose page does not start at the list. Left out, the pager is what it was: "Newer" / "Older", and a
 * navigation that goes to the top.
 */
export function Pager({
  newerHref,
  olderHref,
  labels = DEFAULT_LABELS,
  preventScrollReset = false,
}: {
  newerHref?: string | null;
  olderHref?: string | null;
  labels?: { newer: string; older: string };
  preventScrollReset?: boolean;
}) {
  return (
    <nav className="pager" aria-label="Pagination">
      {newerHref ? (
        <Link className="btn" to={newerHref} preventScrollReset={preventScrollReset}>
          <ChevronLeftIcon />
          {labels.newer}
        </Link>
      ) : (
        <span className="btn is-disabled" aria-disabled="true">
          <ChevronLeftIcon />
          {labels.newer}
        </span>
      )}
      {olderHref ? (
        <Link className="btn" to={olderHref} preventScrollReset={preventScrollReset}>
          {labels.older}
          <ChevronRightIcon />
        </Link>
      ) : (
        <span className="btn is-disabled" aria-disabled="true">
          {labels.older}
          <ChevronRightIcon />
        </span>
      )}
    </nav>
  );
}
