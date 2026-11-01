import { formatCurrency } from "../domain/format";
import { queryOf } from "../domain/query-of";
import { clientsFor } from "../server/clients";
import { asOutage, byDeadline, CARD_DEADLINE_MS, outcome, partOf, TooLate } from "../server/deadline";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext } from "../server/meta";
import { tokenHoldersMeta } from "../server/meta-token-holders";
import { collectAddresses, loadNames } from "../server/names-load";
import { requireNetwork } from "../server/network-route";
import { checkTokenRoute, throwTokenNotFound } from "../server/token-route";
import { tokenHoldersPage } from "../server/token-view";
import { isNotFound, UpstreamError } from "../server/upstream";
import { NamesProvider } from "../ui/names";
import { TokenHoldersPage } from "../ui/pages/TokenHoldersPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.token.$token.holders";

// The loader names a cache class (`minute`, behind a marker too), answers its 404s with class `short`, redirects another spelling of the token, an LP token and a made-up query (`immutable` for
// the path alone, `short` with the query, `slow` for an LP token), and a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Tokens item as the section the page is in (`aria-current="true"`).
export const handle = { navSection: "tokens" } satisfies NetworkRouteHandle;

/** The holders of a page (spec 4). */
const HOLDERS_PAGE = 50;

/**
 * `/{net}/token/{token}/holders` (token spec 4): all the holders of one issued token of the network, the largest balance first, 50 to a page. Its class is `minute` (a ranking rebuilt every
 * minute, not history), behind a marker too.
 *
 * - **Validation first** (spec 1.2, 1.3: `checkTokenRoute`, the token page's own). `TOKENS` off is the not-found page, a 404 of class `short`. A `{token}` that is no asset with an issuer is a 404 that
 *   repeats what was asked, with the native currency's own note; an LP token is a 302 to its pool (class `slow`); another spelling of the token, and a query that is not the view's canonical one, a 302
 *   to it (`redirectToCanonical`: `immutable` when only the path differs, `short` with the query). A `marker` that is none is a 404 of class `short`, before any redirect. No call is made before these.
 * - **Two calls, together** (spec 4): #1 the token and the holders of the page (`limit=50`, the marker), each raced with the card deadline and settled. #1 decides the page: a `token not found` is the
 *   404 of `throwTokenNotFound` (the token page's, so that the two agree), and any other failure a 503 (a missed deadline as an outage: `asOutage`). The holders call is the list's card: a failure
 *   of it, a missed deadline included, is told in its place (`SectionError`), logged, and the request is degraded (served, not stored). Behind a marker, the API refusing the marker (a 400) and a
 *   page with nothing behind it are 404s of class `short`.
 * - **One names call** (display names spec 1 and 5), after them: the issuer and the holders of the page. A names call that fails or is late never fails the page: the addresses are short and the
 *   request is degraded. The page does not poll, so no call asks for the failure hold.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  const search = queryOf(request.url);
  const checked = checkTokenRoute(net, { path: url.pathname, search: search === "" ? "" : `?${search}` }, url.pathname.split("/")[3] ?? "", "holders");
  if (checked instanceof Response) return checked;
  const { asset, params: view } = checked;

  const { api } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const race = <T,>(work: Promise<T>) => outcome(byDeadline(work, deadline));
  const code = formatCurrency(asset.currency);

  // Each is settled, so that none is left running or unhandled behind the answer, whatever the page turns out to be.
  const [token, holders] = await Promise.all([race(api.token(asset)), race(api.tokenHolders(asset, { limit: HOLDERS_PAGE, marker: view.marker }))]);

  if (token.status === "rejected") {
    if (isNotFound(token.reason)) return throwTokenNotFound(api, net, asset, request);
    logProblem(`the token ${code} could not be loaded`, token.reason, request);
    return upstreamOutage(asOutage(token.reason), `token ${code}`);
  }

  if (view.marker !== undefined) {
    const behind = `that page of the holders of ${code}`;
    // The API refuses a marker that is not one of its own (a 400): the page does not exist. A marker past the last holder has nothing behind it either.
    if (holders.status === "rejected" && holders.reason instanceof UpstreamError && holders.reason.kind === "bad_request") notFound({ notFound: behind });
    if (holders.status === "fulfilled" && holders.value.holders.length === 0) notFound({ notFound: behind });
  }

  const { part: names } = await loadNames(
    api,
    collectAddresses(token.value.token.issuer, holders.status === "fulfilled" ? holders.value.holders.map((holder) => holder.holder) : []),
    { context, request, features: net.features },
  );

  const { page, problems } = tokenHoldersPage({ net, asset, answer: token.value, holders: partOf(holders), params: view, names });

  // The settled result holds the reason, which the page does not: a failed list is logged, and the request is degraded.
  if (problems.length > 0) {
    const reason = holders.status === "rejected" ? holders.reason : undefined;
    logProblem(`the holders of ${code} ${reason instanceof TooLate ? "took too long" : "could not be loaded"}`, reason, request);
    markDegraded(context, "token holders: holders");
  }
  return cached(page, "minute");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return tokenHoldersMeta(loaderData.meta, ctx);
}

export default function TokenHolders({ loaderData }: Route.ComponentProps) {
  return (
    <NamesProvider names={loaderData.names.map}>
      <TokenHoldersPage data={loaderData} />
    </NamesProvider>
  );
}
