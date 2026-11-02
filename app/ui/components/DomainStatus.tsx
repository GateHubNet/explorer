// The mark of what a domain's check found, a file of its own for the reason `ExternalLink.tsx` is: the account page's activation line draws it, and StatusMarks.tsx would bring the
// validators' marks with it. StatusMarks.tsx exports it still.

import type { DomainStatusKind } from "../../server/validator-facts";
import { AlertCircleIcon, CheckCircleIcon, ClockIcon } from "./status-icons";

/**
 * What the check of a domain found: "verified" in a list (the validator page spells it out, `page`: "Domain verified"), "not verified", "not checked yet". A status this
 * build does not know (a newer data API) reads "not verified", as the note under the name does. `title` is for the mouse and says why: on the account page's activation
 * line it is the sentence of what the domain's toml said (a title is not a name, so the words stay what a screen reader reads).
 */
export function DomainStatus({ status, page, title }: { status: DomainStatusKind; page?: boolean; title?: string }) {
  switch (status) {
    case "verified":
      return (
        <span className="st st--ok" title={title}>
          <CheckCircleIcon />
          {page ? "Domain verified" : "verified"}
        </span>
      );
    case "pending":
      return (
        <span className="st st--quiet" title={title}>
          <ClockIcon />
          not checked yet
        </span>
      );
    default:
      return (
        <span className="st st--quiet" title={title}>
          <AlertCircleIcon />
          not verified
        </span>
      );
  }
}
