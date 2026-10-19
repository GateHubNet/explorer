import type { LastValidated } from "./api-types";

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
