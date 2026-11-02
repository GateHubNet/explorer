// The status of an escrow, a check and a payment channel (D5 spec 5.2), from the fields the ledger stores and the close time `t` of the answer: the one place the rules are written.
// A page uses them for an object it reads from the node, and the fixture generator (scripts/object-derive.ts) for the answers of the index, so the two cannot part ways. They are D5's
// (data-api-new `feat/explorer-data-2` at 0c2e58c, `apps/api/src/ledger-objects/object-status.ts`), which the index applies to the objects it answers for. Pure and safe for the browser:
// it imports types, which the compiler erases, and nothing at run time.
//
// Every time is unix seconds (a ledger field is Ripple-epoch seconds, and the caller adds the epoch). `t` is the `close_time` the answer carries: rippled tests a transaction against its
// parent ledger's close time, which is `t` for the next ledger, so the comparisons are rippled's: `FinishAfter` blocks a finish while the time is `<=` it, `CancelAfter` allows a cancel
// once the time is `>` it, and an expiration passes when the time is `>=` it (a check) or a channel closes `>=` its `CancelAfter`.
//
// An object that is deleted has the status its deleting event gives, whatever the time: `removedBy` is the `event` of the row that deleted it (`finish`, `cancel`, `cash`, `close` or
// `removed`), and an event it does not know is `removed`.

import type { ChannelStatus, CheckStatus, EscrowStatus } from "../server/api-types";

/**
 * An escrow in the ledger is `can_be_cancelled` once `t` is after `cancelAfter`, else `pending` while `t` is up to `finishAfter`, else `can_be_finished` (a conditional escrow
 * without `finishAfter` can be finished from its creation).
 */
export function escrowStatus(o: { finishAfter?: number; cancelAfter?: number; removedBy?: string }, t: number): EscrowStatus {
  if (o.removedBy !== undefined) {
    if (o.removedBy === "finish") return "finished";
    return o.removedBy === "cancel" ? "cancelled" : "removed";
  }
  if (o.cancelAfter !== undefined && t > o.cancelAfter) return "can_be_cancelled";
  if (o.finishAfter !== undefined && t <= o.finishAfter) return "pending";
  return "can_be_finished";
}

/** A check in the ledger is `expired` from its `expiration`, else `open`. */
export function checkStatus(o: { expiration?: number; removedBy?: string }, t: number): CheckStatus {
  if (o.removedBy !== undefined) {
    if (o.removedBy === "cash") return "cashed";
    return o.removedBy === "cancel" ? "cancelled" : "removed";
  }
  return o.expiration !== undefined && t >= o.expiration ? "expired" : "open";
}

/** A channel in the ledger is `closing` once it has an `expiration` (set whatever the time), or from `cancelAfter`, else `open`. */
export function channelStatus(o: { expiration?: number; cancelAfter?: number; removedBy?: string }, t: number): ChannelStatus {
  if (o.removedBy !== undefined) return o.removedBy === "close" ? "closed" : "removed";
  if (o.expiration !== undefined) return "closing";
  return o.cancelAfter !== undefined && t >= o.cancelAfter ? "closing" : "open";
}
