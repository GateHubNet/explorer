// The one lookup of a page's MPT issuances (E14 spec 2.4, Task 7): `loadMptLookup` asks the data API for the summaries of the IDs a loader collected (`mptAmountsOf`), once, and never fails the page. A
// call that fails or is late is logged, marks the request degraded (served, not stored) and leaves the amounts in units (`resolveMpt`). Worker-only, as `loadNames` is: every loader that shows an MPT
// amount outside an MPT answer calls it, and none of the pages that poll (home, ledger) does.

import type { Features } from "../ui/features";
import type { DataApi } from "./data-api";
import { byDeadline } from "./deadline";
import { markDegraded } from "./env";
import { logProblem } from "./logging";
import { MPT_LOOKUP_MAX, type MptLookupResult } from "./mpt-view";
import type { Network } from "./networks";

/** The words of the mark and of the log line when the lookup failed or was late. */
const COULD_NOT_LOAD = "MPT amounts could not be loaded";

export interface MptLookupContext {
  /** The load context (`markDegraded` reads it). */
  context: unknown;
  /** The request, for the log line. */
  request?: Request;
  features: Pick<Features, "mpt">;
  net: Pick<Network, "hasMpt">;
  /** How long the call may take from now: a streamed section passes what is left of its own deadline (as `NamesContext.deadlineMs`). Without it the client's own timeout is the limit. */
  deadlineMs?: number;
}

/**
 * The summaries of `ids` (as `mptAmountsOf` gives them: upper case, sorted, each once, at most 100). `{ state: "off" }` and no call while `MPT` is off, on a network without MPT (Xahau), or with
 * no ID to look up. Else one `mptLookup` call (class `slow`), raced against `deadlineMs` when there is one: the answers by ID, or `{ state: "failed" }` after a log line and `markDegraded`.
 * Never rejects.
 */
export async function loadMptLookup(api: Pick<DataApi, "mptLookup">, ids: readonly string[], ctx: MptLookupContext): Promise<MptLookupResult> {
  if (!ctx.features.mpt || !ctx.net.hasMpt || ids.length === 0) return { state: "off" };
  try {
    const call = api.mptLookup(ids.slice(0, MPT_LOOKUP_MAX));
    const answer = await (ctx.deadlineMs === undefined ? call : byDeadline(call, Date.now() + ctx.deadlineMs));
    return { state: "ok", map: new Map(answer.issuances.map((entry) => [entry.mpt_issuance_id.toUpperCase(), entry])) };
  } catch (err) {
    logProblem(COULD_NOT_LOAD, err, ctx.request);
    markDegraded(ctx.context, COULD_NOT_LOAD);
    return { state: "failed" };
  }
}
