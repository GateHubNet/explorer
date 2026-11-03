import { mptIssuerOf } from "../domain/mpt-id";
import { queryOf } from "../domain/query-of";
import { mptAvailableOf, parseTokensParams, TOKEN_SEARCH_MAX, tokensHref, tokensQuery } from "../domain/token-params";
import { clientsFor } from "../server/clients";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { upstreamOutage } from "../server/loader-errors";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { tokensMeta } from "../server/meta-tokens";
import { collectAddresses, loadNames } from "../server/names-load";
import { requireNetwork } from "../server/network-route";
import { redirectToCanonical } from "../server/pair-route";
import { MIN_HOLDERS, tokensPage } from "../server/token-view";
import { UpstreamError } from "../server/upstream";
import { NamesProvider } from "../ui/names";
import { TokensPage } from "../ui/pages/TokensPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.tokens";

// The loader names a cache class (`minute` for every view, the MPT tab's included; `short` for the search that was too long), answers its 404s with class `short`, and tidies a path or a query with a redirect
// (`immutable` for the path alone, `short` with the query). A 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Tokens item as the page of the section (`aria-current="page"` on the list, whatever its query).
export const handle = { navSection: "tokens" } satisfies NetworkRouteHandle;

/** The tokens of a page of the list (spec 2.3). */
const TOKENS_PAGE = 20;

/** What the not-found page says of a page of the list that is not there: a marker that is none, one the API refuses, or one with nothing behind it. */
const MORE_NOT_FOUND = "that page of the tokens";

/**
 * `/{net}/tokens` (token spec 2): the issued tokens of the network, the most held first, with the totals of the kind, a search and the tokens with fewer than 10 holders on request; and, where
 * `MPT` is on and the network has MPT (`mptAvailableOf`), the MPT tab (`?kind=mpt`, E14 spec 4): the same page over D9's list of issuances.
 *
 * - **Validation first** (spec 1.2, 1.3). `TOKENS` off is the not-found page, a 404 of class `short`, for every view. Then a `marker` that is none is a 404 of class `short`, before the
 *   redirect, which would otherwise lead to a URL that holds it. A path or a query that is not the canonical one is a 302 to the one URL (`redirectToCanonical`: class `immutable` for
 *   the path alone, `short` with the query): `kind=mpt` is dropped where it is no view (`mptAvailableOf`: `MPT` off, or Xahau), and `all` beside it, as are unknown parameters, empty values,
 *   repeats and a trail without a marker. The path is React Router's `url` (the `.data` of the route's own request taken off) and the query the request's own text (`queryOf`: `_routes` dropped, nothing
 *   decoded), so the `.data` request of a canonical view answers its data. No call is made before these.
 * - **A search of more than 64 characters** (code points, as D6 counts them) is the page with the field's message and no call, class `short`.
 * - **One call, awaited** (spec 2.3): #1 the page of tokens, with `min_holders=10` unless the view is `all`, the search and the marker; for the MPT tab `kind=mpt` with the search and the marker
 *   (D9's list, checked by `checkMptTokens`). The API refusing a marker (a 400), or nothing behind a marker, is a 404 of class `short`. Any other failure, a 400 on the first page and a "Cannot GET" (a data API without D6 behind a switch that is on) included, is a 503
 *   (`upstreamOutage`): the page is this call, so there is no card to fail in its place.
 * - **One names call** (display names spec 1 and 5), after #1: the issuers of the rows (the MPT tab's too), which the table draws as `AccountLink`s. A names call that fails or is late never fails the page:
 *   the issuers are short addresses and the request is degraded (served, not stored). The page does not poll, so the call does not ask for the failure hold.
 * - **The class is `minute`** (spec 6) for every view, a page behind a marker included: the ranking changes with the aggregator's minute.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const net = requireNetwork(context, params);
  if (!net.features.tokens) throw cached({ notFound: "the token pages" }, "short", { status: 404 });

  const mptAvailable = mptAvailableOf(net, net.features);
  const search = queryOf(request.url);
  const view = parseTokensParams(new URLSearchParams(search), { mptAvailable });
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (view.marker !== undefined && !isMarker(view.marker)) throw cached({ notFound: MORE_NOT_FOUND }, "short", { status: 404 });
  const tidied = redirectToCanonical({ path: url.pathname, search: search === "" ? "" : `?${search}` }, { path: tokensHref(net.id), search: tokensQuery(view) });
  if (tidied) return tidied;

  const { api } = clientsFor(context, net);
  const ctx = { context, request, features: net.features };

  if ([...(view.q ?? "")].length > TOKEN_SEARCH_MAX) {
    // No call is made for it, nor for names: the part is the one of a page with no address on it.
    const { part: names } = await loadNames(api, [], ctx);
    return cached(tokensPage({ net, params: view, mptAvailable, answer: null, names }), "short");
  }

  const failed = (err: unknown): never => {
    // The API refuses a marker that is not one of its own (a 400): that page does not exist. On the first page there is no marker to refuse, and a 400 is the API failing.
    if (view.marker !== undefined && err instanceof UpstreamError && err.kind === "bad_request") throw cached({ notFound: MORE_NOT_FOUND }, "short", { status: 404 });
    return upstreamOutage(err, "the token list");
  };
  const answer =
    view.kind === "mpt"
      ? await api.tokens({ kind: "mpt", limit: TOKENS_PAGE, q: view.q, marker: view.marker }).catch(failed)
      : await api.tokens({ kind: "issued", limit: TOKENS_PAGE, minHolders: view.all ? undefined : MIN_HOLDERS, q: view.q, marker: view.marker }).catch(failed);
  // A marker past the last token has nothing behind it: that page does not exist either.
  if (view.marker !== undefined && answer.tokens.length === 0) throw cached({ notFound: MORE_NOT_FOUND }, "short", { status: 404 });

  // The tab draws the issuer its issuance ID holds, not D9's `issuer` field (`mptTokensTab`), so those are the addresses to name.
  const issuers = answer.tokens.map((token) => ("mpt_issuance_id" in token ? mptIssuerOf(token.mpt_issuance_id) : token.issuer));
  const { part: names } = await loadNames(api, collectAddresses(issuers), ctx);
  return cached(tokensPage({ net, params: view, mptAvailable, answer, names }), "minute");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return tokensMeta(loaderData.meta, ctx);
}

export default function Tokens({ loaderData }: Route.ComponentProps) {
  return (
    <NamesProvider names={loaderData.names.map}>
      <TokensPage data={loaderData} />
    </NamesProvider>
  );
}
