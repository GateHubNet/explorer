// The naming of a page's addresses (E9, display names spec 3.2): `loadNames` asks the data API's names batch for the addresses a loader collected, in sorted calls of
// 100 that run side by side, and answers the part of the page data that goes to the browser (`NamesPart`) and the entries the Worker keeps (the account header reads the
// labels' descriptions and the domain from them). A call that fails or is late never fails the page: the page shows addresses, is marked degraded (served, not stored),
// and the answers that did arrive are used. Worker-only: every loader that shows accounts calls it.

import { nameViewOf, NAMES_OFF, NO_NAMES, type NamesPart, type NameView } from "../domain/names";
import type { Features } from "../ui/features";
import type { AccountNameEntry } from "./api-types";
import type { DataApi } from "./data-api";
import { byDeadline } from "./deadline";
import { markDegraded } from "./env";
import { logProblem } from "./logging";

export { collectAddresses } from "./names-collect";
export type { NamesPart } from "../domain/names";

/** What the calls of one `loadNames` may take, from its start; a streamed section passes what is left of its own deadline (`NamesContext.deadlineMs`). */
export const NAMES_DEADLINE_MS = 1_500;
/** How many addresses of a page are named: the first ones collected. A page that shows more is the exception, and its other addresses are shown as they are. */
export const NAMES_MAX_ADDRESSES = 400;
/** How many addresses one call to the data API names (D4 answers 400 for more, and for none). */
export const NAMES_BATCH_LIMIT = 100;

/** The words of the mark and of the log line when a call of the batch failed or was late. */
const COULD_NOT_LOAD = "names could not be loaded";

export interface NamesResult {
  /** What goes to the browser: the view of each address that has something to show, and whether names could be had. */
  part: NamesPart;
  /** Worker only: every entry that arrived, by address (the account header reads the labels' descriptions and the domain from it). */
  entries: ReadonlyMap<string, AccountNameEntry>;
}

export interface NamesContext {
  /** The load context (`markDegraded` reads it). */
  context: unknown;
  /** The request, for the log line. */
  request?: Request;
  features: Pick<Features, "names">;
  /** A polled page (home, market pair, validator) asks for it on every call (spec 1.7). */
  holdFailure?: boolean;
  /** How long the calls may take from the start of `loadNames`; `NAMES_DEADLINE_MS` when left out. */
  deadlineMs?: number;
}

/**
 * The names of `addresses` (each once, as `collectAddresses` gives them). With `features.names` off: `NAMES_OFF` and no call. No address: `NO_NAMES` and no call (the data API
 * answers 400 to an empty list). Else the first `NAMES_MAX_ADDRESSES`, sorted (so that the same page asks the same keys, and the subrequest cache answers it), in calls of
 * `NAMES_BATCH_LIMIT` made side by side, each raced against one deadline: the start + `ctx.deadlineMs`. A call that fails or is late makes the part `failed`, and the Worker
 * marks the page degraded and logs it once for the whole call of `loadNames`, whatever the number of calls that failed; the answers of the others are used. Never rejects.
 */
export async function loadNames(api: Pick<DataApi, "accountNames">, addresses: readonly string[], ctx: NamesContext): Promise<NamesResult> {
  if (!ctx.features.names) return { part: NAMES_OFF, entries: new Map() };
  if (addresses.length === 0) return { part: NO_NAMES, entries: new Map() };

  const sorted = addresses.slice(0, NAMES_MAX_ADDRESSES).sort();
  const at = Date.now() + (ctx.deadlineMs ?? NAMES_DEADLINE_MS);
  // `ask` is async, so that a call that throws at once is a failure of its chunk like one that rejects.
  const ask = async (chunk: string[]) => (await api.accountNames(chunk, { holdFailure: ctx.holdFailure })).account_names;
  const chunks: string[][] = [];
  for (let from = 0; from < sorted.length; from += NAMES_BATCH_LIMIT) chunks.push(sorted.slice(from, from + NAMES_BATCH_LIMIT));
  const settled = await Promise.allSettled(chunks.map((chunk) => byDeadline(ask(chunk), at)));

  const entries = new Map<string, AccountNameEntry>();
  const map: Record<string, NameView> = {};
  const failures: unknown[] = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      failures.push(result.reason);
      continue;
    }
    for (const entry of result.value) {
      entries.set(entry.address, entry);
      const view = nameViewOf(entry);
      if (view) map[entry.address] = view;
    }
  }

  if (failures.length > 0) {
    markDegraded(ctx.context, COULD_NOT_LOAD);
    logProblem(COULD_NOT_LOAD, failures[0], ctx.request);
  }
  return { part: { state: failures.length > 0 ? "failed" : "ok", map }, entries };
}
