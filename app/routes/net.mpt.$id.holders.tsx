import { mptPath, shortMptId } from "../domain/mpt";
import { parseMptListParams } from "../domain/mpt-params";
import { queryOf } from "../domain/query-of";
import { MARKER_PAGE_CLASS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { asOutage, byDeadline, CARD_DEADLINE_MS, outcome, partOf, TooLate } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { mptHoldersMeta } from "../server/meta-mpt-holders";
import { checkMptRequest, loadMptSource } from "../server/mpt-route";
import { MPT_HOLDERS_PAGE, mptHoldersPage, noMptPage } from "../server/mpt-view";
import { collectAddresses, loadNames } from "../server/names-load";
import { requireNetwork } from "../server/network-route";
import { redirectToCanonical } from "../server/pair-route";
import { isNotFound, UpstreamError } from "../server/upstream";
import { NamesProvider } from "../ui/names";
import { MptHoldersPage } from "../ui/pages/MptHoldersPage";
import { NoMptPage } from "../ui/pages/NoMptPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.mpt.$id.holders";

// The loader names a cache class (`minute`, behind a marker `MARKER_PAGE_CLASS`, `short` with a TTL of 60 s when the issuance is read from the network), answers its 404s with class `short`,
// redirects another case of the ID and a made-up query (`immutable` for the path alone, `short` with the query), and a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Tokens item as the section the page is in (`aria-current="true"`).
export const handle = { navSection: "tokens" } satisfies NetworkRouteHandle;

/** The seconds a page whose head is read from the network is kept (spec 3.2 step 3). */
const FROM_NETWORK_TTL = 60;

/**
 * `/{net}/mpt/{ID}/holders` (spec 3.4): all the holders of one MPT issuance, the largest balance first, 50 to a page. Its class is `minute`; behind a marker `MARKER_PAGE_CLASS` with `noindex, follow` and no
 * canonical URL.
 *
 * - **Validation first** (spec 1.3: `checkMptRequest`, the issuance page's own, so that the three routes agree). `MPT` off is the not-found page of the MPT pages; on a network without MPT an ID of 48 hex
 *   digits is `NoMptPage` (404, `short`); text that is no ID a 404 that repeats it; a lower or mixed case ID and a query that is not the view's canonical one (`parseMptListParams`: `marker`, then `back`, and only behind a
 *   marker) one 302 (`redirectToCanonical`). A `marker` that fails `isMarker`, an empty one included, is a 404 of class `short` before the redirect. No call is made before these.
 * - **Two calls, together** (spec 3.4): the issuance (`loadMptSource`: the index's, else the node's entry, for the head alone) and the holders of the page (`limit=50`, the marker), each raced with the card
 *   deadline and settled. The issuance decides the page: neither the index nor the node having it is the 404 "We couldn't find this MPT", and any other failure a 503. The holders call is the list's
 *   card: a failure of it, a missed deadline included, is told in its place (`SectionError`), logged, and the request is degraded (served, not stored); a 404 of it (the index has no rows) says "Not in the
 *   index yet.". Behind a marker, the API refusing the marker (a 400), a page with nothing behind it and an issuance the index does not hold are 404s of class `short`.
 * - **One names call** (display names spec 1 and 5), after them: the issuer and the holders of the page. A names call that fails or is late never fails the page. No call polls.
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

  const id = asked.toUpperCase();
  const behind = "that page of the holders of this MPT";
  const search = queryOf(request.url);
  const view = parseMptListParams(search);
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (view.marker !== undefined && !isMarker(view.marker)) notFound({ notFound: behind });
  const tidied = redirectToCanonical({ path: url.pathname, search: search === "" ? "" : `?${search}` }, { path: mptPath(net.id, id, "holders"), search: view.canonical });
  if (tidied !== null) return tidied;

  const { api, node } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const race = <T,>(work: Promise<T>) => outcome(byDeadline(work, deadline));
  const what = `MPT ${shortMptId(id)}`;

  // Each is settled, so that none is left running or unhandled behind the answer, whatever the page turns out to be.
  const [source, holders] = await Promise.all([race(loadMptSource(api, node, id)), race(api.mptHolders(id, { limit: MPT_HOLDERS_PAGE, marker: view.marker }))]);

  if (source.status === "rejected") {
    logProblem(`${what} could not be loaded`, source.reason, request);
    return upstreamOutage(asOutage(source.reason), what);
  }
  if (source.value === null) return notFound({ notFound: "this MPT" });

  if (view.marker !== undefined) {
    // The API refuses a marker that is not one of its own (a 400): the page does not exist. A marker past the last holder has nothing behind it either, and neither has one of an issuance the index lacks.
    if (holders.status === "rejected" && holders.reason instanceof UpstreamError && (holders.reason.kind === "bad_request" || isNotFound(holders.reason))) notFound({ notFound: behind });
    if (holders.status === "fulfilled" && holders.value.holders.length === 0) notFound({ notFound: behind });
  }

  const issuer = source.value.origin === "index" ? source.value.answer.issuance.issuer : source.value.node.Issuer;
  const { part: names } = await loadNames(api, collectAddresses(issuer, holders.status === "fulfilled" ? holders.value.holders.map((holder) => holder.holder) : []), {
    context,
    request,
    features: net.features,
  });

  const page = mptHoldersPage({ net, source: source.value, page: partOf(holders), view, names });

  // The settled result holds the reason, which the page does not: a failed list is logged, and the request is degraded.
  if (page.holders.state === "failed") {
    const reason = holders.status === "rejected" ? holders.reason : undefined;
    logProblem(`the holders of ${what} ${reason instanceof TooLate ? "took too long" : "could not be loaded"}`, reason, request);
    markDegraded(context, "mpt holders: holders");
  }
  if (view.marker !== undefined) return cached(page, MARKER_PAGE_CLASS);
  return page.origin === "node" ? cached(page, "short", { ttl: FROM_NETWORK_TTL }) : cached(page, "minute");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return mptHoldersMeta(loaderData, ctx);
}

export default function MptHolders({ loaderData }: Route.ComponentProps) {
  if (loaderData.kind === "no-mpt") return <NoMptPage data={loaderData} />;
  return (
    <NamesProvider names={loaderData.names.map}>
      <MptHoldersPage data={loaderData} />
    </NamesProvider>
  );
}
