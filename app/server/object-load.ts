// The loader of the ledger object pages (ledger object pages spec 1.2, 3 and 9): an escrow, a check or a payment channel by its ID, from the data API's index (D5) or, for one the index has no
// row of, from the node; the routes of the three pages call it with their kind. Worker only: it reaches the data API and the node, and the view builders, which no browser file may import.

import { redirect } from "react-router";

import { shortHash } from "../domain/format";
import { NO_NAMES } from "../domain/names";
import { kindOfType, OBJECT_KINDS, type ObjectKind } from "../domain/object-link";
import { parseTrail } from "../domain/paging";
import { queryOf, withQuery } from "../domain/query-of";
import type { ObjectAnswer, ObjectHistoryPage } from "./api-types";
import { MARKER_PAGE_CLASS } from "./cache-class";
import { checkPage, drawnAccounts as checkAccounts, type CheckPageData } from "./check-view";
import { clientsFor } from "./clients";
import type { DataApi, ObjectHistoryQuery } from "./data-api";
import { echoOf } from "./echo";
import { cacheClassHeaders, cached } from "./edge-cache";
import { getEnv, markDegraded } from "./env";
import { drawnAccounts as escrowAccounts, escrowPage, type EscrowPageData } from "./escrow-view";
import type { ObjectSource } from "./ledger-object-view";
import { notFound, upstreamOutage } from "./loader-errors";
import { logProblem } from "./logging";
import { isMarker } from "./marker";
import { loadMptLookup } from "./mpt-load";
import { mptAmountsOf, resolveMpt, type MptLookupResult } from "./mpt-view";
import { collectAddresses, loadNames, NAMES_DEADLINE_MS } from "./names-load";
import { requireNetwork } from "./network-route";
import { networkOf, type Network } from "./networks";
import type { NodeRpc, ServerState } from "./node-rpc";
import { drawnAccounts as channelAccounts, paymentChannelPage, type PaymentChannelPageData } from "./payment-channel-view";
import { searchOnOther } from "./search-view";
import { isNotFound, UpstreamError } from "./upstream";

/** The events of a page of an object's history behind a marker (decision 8): 50, as many as the answer holds of the first page. */
export const OBJECT_HISTORY_PAGE = 50;

const HEX_64 = /^[0-9A-Fa-f]{64}$/;

/** The page data of each kind. */
interface ObjectPages {
  escrow: EscrowPageData;
  check: CheckPageData;
  "payment-channel": PaymentChannelPageData;
}

/** What a view builder is given besides the source: the three kinds' builders take the same. */
type BuildOptions = Parameters<typeof escrowPage>[1];

/** What the loader needs of a kind: its two calls, its view builder and the accounts its page draws (the view's `drawnAccounts`). */
interface KindOf<K extends ObjectKind> {
  answer: (api: DataApi, id: string) => Promise<ObjectAnswer>;
  history: (api: DataApi, id: string, q: ObjectHistoryQuery) => Promise<ObjectHistoryPage>;
  build: (source: ObjectSource, o: BuildOptions) => ObjectPages[K];
  drawn: (page: ObjectPages[K]) => string[];
}

const KINDS: { [K in ObjectKind]: KindOf<K> } = {
  escrow: { answer: (api, id) => api.escrow(id), history: (api, id, q) => api.escrowHistory(id, q), build: escrowPage, drawn: escrowAccounts },
  check: { answer: (api, id) => api.check(id), history: (api, id, q) => api.checkHistory(id, q), build: checkPage, drawn: checkAccounts },
  "payment-channel": {
    answer: (api, id) => api.paymentChannel(id),
    history: (api, id, q) => api.paymentChannelHistory(id, q),
    build: paymentChannelPage,
    drawn: channelAccounts,
  },
};

/**
 * `/{net}/{escrows|checks|payment-channels}/{ID}` (spec 1.2): the page of the object of `kind` with that ID.
 *
 * - **Before any call**: the network; the not-found page while `LEDGER_OBJECTS` is off ("the escrow pages"); a 404 for an ID that is not 64 hex digits (`0x…` too), which repeats what was
 *   asked; a 302 of class `immutable` to the upper-case URL, its query kept, for an ID with a lower-case letter; a 404 for a `marker` that is none ("that page of the escrow"). Each 404 is of
 *   class `short`.
 * - **The index** (§3 step 1): the object's call, the history call when there is a marker (`OBJECT_HISTORY_PAGE` events, newest first, behind it) and `server_state` (the owner reserve), side by
 *   side. Any failure of the object's call but its `not_found` is a 503 (`upstreamOutage`), and the node is not asked in its place. Behind a marker: the object the index does not have, the API
 *   refusing the marker (a 400) and a page with no event are 404s; any other failure of the history call a 503.
 * - **The node** (§3 step 2), on the index's `not_found` alone: `ledgerEntry(id)`. An entry of the kind is the page from the node (its status at the request's time, no history); an escrow, a
 *   check or a channel of another kind a 302 of class `short` to its page; any other entry, or none, the 404 that offers the same search on the other network ("Search on Xahau"); a failure a 503.
 *   An entry the view cannot read (one without its account, say) is a 503 too.
 * - `server_state` failing is the page without its Owner reserve row, served and not stored (degraded).
 * - **Names** (§2.3): one call after the calls the page awaits, for the accounts it draws (the view's `drawnAccounts`); a names call that fails or is late leaves the addresses and degrades the page.
 * - **MPT amounts** (E14, behind `MPT`): an escrow's page asks the data API once for the issuances of its amounts (`mptAmountsOf`, `loadMptLookup`), beside the names call, and shows them scaled (`resolveMpt`);
 *   a failed lookup leaves units and degrades the page. A check's and a channel's stay in units.
 * - **Class** (§9): `MARKER_PAGE_CLASS` behind a marker, `slow` for an object that was removed, else `live` (the node's page too).
 */
export async function loadObjectPage<K extends ObjectKind>(
  kind: K,
  a: { request: Request; params: { net?: string; id?: string }; context: unknown },
): Promise<Response | ReturnType<typeof cached<ObjectPages[K]>>> {
  const { request, params, context } = a;
  const started = Date.now();
  const net = requireNetwork(context, params);
  const { words, segment } = OBJECT_KINDS.find((each) => each.kind === kind)!;
  if (!net.features.ledgerObjects) notFound({ notFound: `the ${words} pages` });

  const asked = params.id ?? "";
  // 80 code points, as the transaction's and the NFT's pages: an ID of 64 with a character too many is still repeated whole.
  if (!HEX_64.test(asked)) notFound({ notFound: `${words} ${echoOf(asked, 80)}` });
  const id = asked.toUpperCase();
  const search = queryOf(request.url);
  if (asked !== id) return redirect(withQuery(`/${net.id}/${segment}/${id}`, search), { status: 302, headers: cacheClassHeaders("immutable") });

  const query = new URLSearchParams(search);
  const marker = query.get("marker") ?? undefined;
  const olderNotFound = `that page of the ${words}`;
  if (marker !== undefined && !isMarker(marker)) notFound({ notFound: olderNotFound });
  const back = marker === undefined ? [] : parseTrail(query.get("back"));

  const { api, node } = clientsFor(context, net);
  const calls: KindOf<K> = KINDS[kind];
  const [answer, history, state] = await Promise.allSettled([
    calls.answer(api, id),
    marker === undefined ? Promise.resolve(undefined) : calls.history(api, id, { descending: true, limit: OBJECT_HISTORY_PAGE, marker }),
    node.serverState(),
  ]);

  let source: ObjectSource;
  if (answer.status === "fulfilled") {
    if (history.status === "rejected") {
      // The API refuses a marker that is not one of its own (a 400): the page does not exist.
      if (history.reason instanceof UpstreamError && history.reason.kind === "bad_request") notFound({ notFound: olderNotFound });
      logProblem(`the ${words}'s older events could not be loaded`, history.reason, request);
      return upstreamOutage(history.reason, `the ${words}'s older events`);
    }
    const page = history.value;
    // A marker past the last event has nothing behind it.
    if (page !== undefined && page.history.length === 0) notFound({ notFound: olderNotFound });
    source = page === undefined ? { origin: "index", answer: answer.value } : { origin: "index", answer: answer.value, history: page };
  } else {
    if (!isNotFound(answer.reason)) {
      logProblem(`the ${words} could not be loaded`, answer.reason, request);
      return upstreamOutage(answer.reason, `the ${words}`);
    }
    // A marker is the index's: an object it does not have has no page of older events.
    if (marker !== undefined) notFound({ notFound: olderNotFound });
    source = await fromNode(node, net, kind, id, request, Math.floor(started / 1000), context);
  }

  const serverState: ServerState | null = state.status === "fulfilled" ? state.value : null;
  if (state.status === "rejected") logProblem(`the ${words}'s owner reserve could not be loaded`, state.reason, request);

  let draft: ObjectPages[K];
  try {
    draft = calls.build(source, { net, serverState, names: NO_NAMES, back, ...(marker === undefined ? {} : { marker }) });
  } catch (error) {
    // The node's entry without a field the object cannot be without: an answer that is not what it should be.
    if (!(error instanceof UpstreamError)) throw error;
    logProblem(`the ${words} from the network could not be read`, error, request);
    return upstreamOutage(error, `the ${words}`);
  }
  if (draft.reserve === null) markDegraded(context, `${words}: no owner reserve`);

  // The names call, and for an escrow the one MPT lookup of its page (E14, ruling C13), side by side: a check's and a channel's MPT amounts stay in units. A lookup that fails marks the page degraded
  // (served, not stored); none of the page's classes changes for an amount in units.
  const [{ part: names }, lookup] = await Promise.all([
    loadNames(api, collectAddresses(calls.drawn(draft)), { context, request, features: net.features }),
    kind === "escrow" ? loadMptLookup(api, mptAmountsOf(draft), { context, request, features: net.features, net, deadlineMs: NAMES_DEADLINE_MS }) : Promise.resolve<MptLookupResult>({ state: "off" }),
  ]);
  const cls = marker !== undefined ? MARKER_PAGE_CLASS : draft.removed ? "slow" : "live";
  return cached({ ...resolveMpt(draft, lookup).view, names } as ObjectPages[K], cls);
}

/**
 * The node's answer for an object the index does not have (§3 step 2): the page's source for an entry of `kind`, or what the loader answers instead. It throws the redirect to the page of
 * another kind's entry, the 404 of an entry that is none of the three (or of none at all) with the offer of the other network, and the 503 of a node that failed.
 */
async function fromNode(
  node: NodeRpc,
  net: Network,
  kind: ObjectKind,
  id: string,
  request: Request,
  now: number,
  context: unknown,
): Promise<ObjectSource> {
  const { words } = OBJECT_KINDS.find((each) => each.kind === kind)!;
  let entry;
  try {
    entry = await node.ledgerEntry(id);
  } catch (error) {
    if (!isNotFound(error)) {
      logProblem(`the ${words} could not be read from the network`, error, request);
      return upstreamOutage(error, `the ${words}`);
    }
    entry = null;
  }
  const found = entry === null ? undefined : kindOfType(entry.node.LedgerEntryType);
  if (entry !== null && found === kind) return { origin: "node", entry: entry.node, ledgerIndex: entry.ledger_index, now };
  if (found !== undefined) {
    const { segment } = OBJECT_KINDS.find((each) => each.kind === found)!;
    throw redirect(`/${net.id}/${segment}/${id}`, { status: 302, headers: cacheClassHeaders("short") });
  }
  const other = networkOf(net.other, getEnv(context));
  return notFound({ notFound: `${words} ${shortHash(id)}`, suggestion: searchOnOther(id, { id: other.id, name: other.name }) });
}
