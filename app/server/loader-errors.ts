// What a loader does with a failed call to the data API or the node (spec 10). Worker-only code, for loaders.

import { data } from "react-router";

import { cached } from "./edge-cache";
import { UpstreamError } from "./upstream";

/** Seconds a visitor is told to wait when the upstream did not say. */
const DEFAULT_RETRY_AFTER = 30;

/** A link the not-found page offers besides the way home: "the same search on the other network". `href` is a path of this site. */
export interface NotFoundOffer {
  href: string;
  label: string;
}

/**
 * What a 404 a loader throws carries, which the error boundaries show as the not-found page (`RouteErrorScreen`): `notFound`, what was asked for as a phrase
 * that follows "We couldn't find ..."; `suggestion`, the one link the page offers besides the way home; and `note`, a sentence of plain text (at most 300
 * characters) that the page shows after "We couldn't find ..." to say why (`"Xahau has no AMM, so this pool exists only on the XRP Ledger."`).
 */
export interface NotFoundData {
  notFound: string;
  suggestion?: NotFoundOffer;
  note?: string;
}

/** Throws the 404 of class `short` whose data is `found` (`NotFoundData`). A route that calls this needs `export const headers = forwardCacheClass`. */
export function notFound(found: NotFoundData): never {
  throw cached(found, "short", { status: 404 });
}

/**
 * Throws the response a page answers a failed upstream call with. `what` names what was asked for, as a phrase that
 * follows "We couldn't find ..." (`"ledger 107695660"`, `"transaction 67F91E…7C31"`).
 *
 * - `not_found` and `bad_request` (the API refused the id as malformed): a 404 of class `short`, with `{ notFound: what }`
 *   as its data (and the `offer`, if the caller has one: `{ notFound: what, suggestion: offer }`), which the error boundaries show as
 *   the not-found page. A route that calls this needs `export const headers = forwardCacheClass`, or the class is lost.
 * - `rate_limited`, `server`, `timeout`, `network`: a 503 with `Retry-After` (the upstream's, else 30 s). The Worker entry
 *   answers a 5xx with the stored copy of the page, however old, if there is one, and with its busy page otherwise.
 * - Anything else is a bug and is thrown again as it is, for the error boundary and Sentry.
 */
export function upstreamFailure(err: unknown, what: string, offer?: NotFoundOffer): never {
  if (err instanceof UpstreamError) {
    if (err.kind === "not_found" || err.kind === "bad_request") {
      notFound(offer ? { notFound: what, suggestion: offer } : { notFound: what });
    }
    const wait = err.retryAfter !== undefined && Number.isInteger(err.retryAfter) && err.retryAfter > 0 ? err.retryAfter : DEFAULT_RETRY_AFTER;
    throw data({ unavailable: what }, { status: 503, headers: { "Retry-After": String(wait) } });
  }
  throw err;
}

/**
 * `upstreamFailure` for a call the page cannot be built without but that is not what the visitor asked for: the newest ledger,
 * the lists of the home page. The API not having those is its fault and not a missing page, so a `not_found` or a
 * `bad_request` is an outage too (a 503, not a 404 that would be stored as the page for 30 s). Everything else is treated as
 * `upstreamFailure` treats it.
 */
export function upstreamOutage(err: unknown, what: string): never {
  if (err instanceof UpstreamError && (err.kind === "not_found" || err.kind === "bad_request")) {
    return upstreamFailure(new UpstreamError("server", err.message, { status: err.status, cause: err }), what);
  }
  return upstreamFailure(err, what);
}
