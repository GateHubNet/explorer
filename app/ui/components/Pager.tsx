import { Link } from "react-router";

import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

/**
 * Newer and Older buttons for a list that runs newest first and pages by marker. A direction with no page is shown disabled,
 * so the pair does not jump around.
 */
export function Pager({ newerHref, olderHref }: { newerHref?: string | null; olderHref?: string | null }) {
  return (
    <nav className="pager" aria-label="Pagination">
      {newerHref ? (
        <Link className="btn" to={newerHref}>
          <ChevronLeftIcon />
          Newer
        </Link>
      ) : (
        <span className="btn is-disabled" aria-disabled="true">
          <ChevronLeftIcon />
          Newer
        </span>
      )}
      {olderHref ? (
        <Link className="btn" to={olderHref}>
          Older
          <ChevronRightIcon />
        </Link>
      ) : (
        <span className="btn is-disabled" aria-disabled="true">
          Older
          <ChevronRightIcon />
        </span>
      )}
    </nav>
  );
}
