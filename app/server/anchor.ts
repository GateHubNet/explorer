import type { LastValidated } from "./api-types";
import { UpstreamError } from "./upstream";

/** Where a live page stands on the chain: what it was built from. */
export interface Anchor {
  /** The ledger index of `/v2/last_validated`. */
  lastValidated: number;
  /** Its close time, unix seconds. */
  closeTime: number;
}
/** `ledger_index` as a number; `close_time` (ISO) as unix seconds. */
export function anchorOf(last: LastValidated): Anchor {
  return { lastValidated: Number(last.ledger_index), closeTime: Math.floor(Date.parse(last.close_time) / 1000) };
}

/**
 * `anchorOf(last)`, or the data API failing: a 200 whose ledger index or close time is not a number, from which no window can be worked out
 * (`utcDayOf` and `candleWindow` throw on it). An `UpstreamError` of kind `server`, which a live page answers with a 503 (`upstreamOutage`).
 */
export function anchorOrThrow(last: LastValidated): Anchor {
  const anchor = anchorOf(last);
  if (!Number.isFinite(anchor.lastValidated) || !Number.isFinite(anchor.closeTime)) {
    throw new UpstreamError("server", "data API GET /v2/last_validated answered a ledger_index or close_time that is not a number", { status: 200 });
  }
  return anchor;
}
