import { mptPath, shortMptId } from "../domain/mpt";
import { parseMptParams } from "../domain/mpt-params";
import { queryOf } from "../domain/query-of";
import { clientsFor } from "../server/clients";
import { asOutage, byDeadline, CARD_DEADLINE_MS, outcome, partOf, TooLate } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext } from "../server/meta";
import { mptMeta, noMptMeta } from "../server/meta-mpt";
import { checkMptRequest, loadMptSource } from "../server/mpt-route";
import { mptPage, noMptPage } from "../server/mpt-view";
import { collectAddresses, loadNames } from "../server/names-load";
import { requireNetwork } from "../server/network-route";
import { redirectToCanonical } from "../server/pair-route";
import { NamesProvider } from "../ui/names";
import { MptPage } from "../ui/pages/MptPage";
import { NoMptPage } from "../ui/pages/NoMptPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.mpt.$id";

// The loader names a cache class (`minute` for an issuance the index has, `short` with a TTL of 60 s for one read from the network), answers its 404s with class `short`, redirects another case of
// the ID and a made-up query (`immutable` for the path alone, `short` with the query), and a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Tokens item as the section the page is in (`aria-current="true"`).
export const handle = { navSection: "tokens" } satisfies NetworkRouteHandle;

/** The rows of the top-holders card and of the recent-transfers card (spec 3.1). */
const HOLDERS_SHOWN = 10;
const TRANSFERS_SHOWN = 8;

/** The seconds a page read from the network is kept (spec 3.2 step 3, 6): the index will have it within a tick or two. */
const FROM_NETWORK_TTL = 60;

/** What the log says of a card that failed: a call that missed its deadline "took too long", any other "could not be loaded". */
const failedWords = (what: string, reason: unknown) => `the MPT's ${what} ${reason instanceof TooLate ? "took too long" : "could not be loaded"}`;

/**
 * `/{net}/mpt/{ID}` (spec 3): one MPT issuance of the network, by its issuance ID. Its class is `minute` (what the data API's aggregate says changes at its tick); read from the network `short` with a
 * TTL of 60 s.
 *
 * - **Validation first** (spec 1.3: `checkMptRequest`). `MPT` off is the not-found page of the MPT pages, a 404 of class `short`. On a network without MPT (Xahau, Xahau Testnet) an ID of 48 hex
 *   digits is `NoMptPage`, a 404 of class `short`; text that is not 48 hex digits is a 404 that repeats what was asked. A lower or mixed case ID, and a made-up query, are one 302 to the canonical URL
 *   (`redirectToCanonical`: `immutable` when only the path differs, `short` with the query). No call is made before these.
 * - **Three calls, together** (spec 3.2 step 1): the issuance (`loadMptSource`: the index, and the node's `ledger_entry` when the index says not found), the top holders and the recent transfers,
 *   each raced with the card deadline and settled. The issuance decides the page: neither the index nor the node having it is the 404 "We couldn't find this MPT", and any other failure of either (a
 *   deadline missed included: `asOutage`) a 503. The holders and the transfers are cards: one that failed is told in its place (`SectionError`), logged and the request degraded (served, not
 *   stored); one the index has no rows for (a 404) says "Not in the index yet.".
 * - **One names call** (display names spec 1 and 5), after them: the issuer, the holders and the parties of the transfers, at most 27 addresses. A names call that fails or is late never fails the
 *   page: the addresses are short and the request is degraded. The page does not poll, so no call asks for the failure hold.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  const asked = params.id ?? "";
  const checked = checkMptRequest(net, asked, net.features);
  switch (checked.kind) {
    case "off":
      return notFound({ notFound: "the MPT pages" });
    case "bad":
      return notFound({ notFound: `MPT ${echoOf(asked)}` });
    case "no-mpt":
      return cached(noMptPage(net, checked.id), "short", { status: 404 });
    default:
      break;
  }

  // An ID in capitals, whether it was asked for so or the redirect below puts it so (`checked` is `ok` or `case`: 48 hex digits).
  const id = asked.toUpperCase();
  const search = queryOf(request.url);
  const tidied = redirectToCanonical({ path: url.pathname, search: search === "" ? "" : `?${search}` }, { path: mptPath(net.id, id), search: parseMptParams(search).canonical });
  if (tidied !== null) return tidied;

  const { api, node } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const race = <T,>(work: Promise<T>) => outcome(byDeadline(work, deadline));
  const what = `MPT ${shortMptId(id)}`;

  // Each is settled, so that none is left running or unhandled behind the answer, whatever the page turns out to be.
  const [source, holders, transfers] = await Promise.all([
    race(loadMptSource(api, node, id)),
    race(api.mptHolders(id, { limit: HOLDERS_SHOWN })),
    race(api.mptTransfers(id, { descending: true, limit: TRANSFERS_SHOWN })),
  ]);

  if (source.status === "rejected") {
    logProblem(`${what} could not be loaded`, source.reason, request);
    return upstreamOutage(asOutage(source.reason), what);
  }
  if (source.value === null) return notFound({ notFound: "this MPT" });

  const issuer = source.value.origin === "index" ? source.value.answer.issuance.issuer : source.value.node.Issuer;
  const { part: names } = await loadNames(
    api,
    collectAddresses(
      issuer,
      holders.status === "fulfilled" ? holders.value.holders.map((holder) => holder.holder) : [],
      transfers.status === "fulfilled" ? transfers.value.transfers.map((transfer) => [transfer.source, transfer.destination]) : [],
    ),
    { context, request, features: net.features },
  );

  const page = mptPage({ net, source: source.value, holders: partOf(holders), transfers: partOf(transfers), names });

  // The settled results hold the reasons, which the page does not: each failed card is logged under its name, and the request is degraded.
  const failed = [
    ...(page.holders.state === "failed" ? [{ what: "top holders", result: holders }] : []),
    ...(page.transfers.state === "failed" ? [{ what: "recent transfers", result: transfers }] : []),
  ];
  for (const { what: card, result } of failed) {
    const reason = result.status === "rejected" ? result.reason : undefined;
    logProblem(failedWords(card, reason), reason, request);
  }
  if (failed.length > 0) markDegraded(context, `mpt: ${failed.map(({ what: card }) => card).join(", ")}`);

  return page.origin === "node" ? cached(page, "short", { ttl: FROM_NETWORK_TTL }) : cached(page, "minute");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return loaderData.kind === "no-mpt" ? noMptMeta(loaderData, ctx) : mptMeta(loaderData.facts, ctx);
}

export default function Mpt({ loaderData }: Route.ComponentProps) {
  if (loaderData.kind === "no-mpt") return <NoMptPage data={loaderData} />;
  return (
    <NamesProvider names={loaderData.names.map}>
      <MptPage data={loaderData} />
    </NamesProvider>
  );
}
