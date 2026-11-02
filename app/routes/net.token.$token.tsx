import { formatCurrency } from "../domain/format";
import { queryOf } from "../domain/query-of";
import { MARKER_PAGE_CLASS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { asOutage, byDeadline, CARD_DEADLINE_MS, outcome, partOf, TooLate } from "../server/deadline";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext } from "../server/meta";
import { tokenMeta } from "../server/meta-token";
import { collectAddresses, loadNames } from "../server/names-load";
import { requireNetwork } from "../server/network-route";
import type { Network } from "../server/networks";
import { checkTokenRoute, throwTokenNotFound } from "../server/token-route";
import { tokenPage, type TokenPart } from "../server/token-view";
import { isNotFound, UpstreamError } from "../server/upstream";
import { NamesProvider } from "../ui/names";
import { TokenPage } from "../ui/pages/TokenPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.token.$token";

// The loader names a cache class (`live`; `MARKER_PAGE_CLASS` behind a marker), answers its 404s with class `short`, redirects another spelling of the token, an LP token and a made-up query
// (`immutable` for the path alone, `short` with the query, `slow` for an LP token), and a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Tokens item as the section the page is in (`aria-current="true"`).
export const handle = { navSection: "tokens" } satisfies NetworkRouteHandle;

/** The holders of the top-holders card, and the transfers of a page (spec 3.2 #2, #3). */
const HOLDERS_SHOWN = 10;
const TRANSFERS_PAGE = 20;

/** The words of what failed, for the log. */
const WORDS: Record<TokenPart, string> = {
  holders: "the top holders",
  transfers: "the transfers",
  pools: "the AMM pools",
  ammVolume: "the 24-hour AMM volume",
  accountInfo: "the issuer's settings",
};

/** What the log says of a part: a call that missed its deadline "took too long", any other "could not be loaded". */
const failedWords = (part: TokenPart, reason: unknown) => `the token's ${WORDS[part]} ${reason instanceof TooLate ? "took too long" : "could not be loaded"}`;

/**
 * `/{net}/token/{token}` (token spec 3): one issued token of the network, by its currency and issuer. Its class is `live` (its transfers are the newest payments); behind a marker
 * `MARKER_PAGE_CLASS` (older transfers are history).
 *
 * - **Validation first** (spec 1.2, 1.3: `checkTokenRoute`). `TOKENS` off is the not-found page, a 404 of class `short`, for every view. A `{token}` that is no asset with an issuer is a 404 that
 *   repeats what was asked (`echoOf`), with the native currency's own note; an LP token is a 302 to its pool (class `slow`); another spelling of the token, and a query that is not the
 *   view's canonical one, a 302 to it (`redirectToCanonical`: `immutable` when only the path differs, `short` with the query), the path being React Router's `url` (the `.data` of the
 *   route's own request taken off) and the query the request's own text (`queryOf`). A `marker` that is none is a 404 of class `short`, before any redirect. No call is made before these.
 * - **A first page** (spec 3.2, 3.3): #1 the token, #2 its top holders, #3 its transfers and, where the network has an AMM, #4 the pools holding it and #5 the live AMM volume start together,
 *   each raced with the card deadline and settled. #1 decides the page: a `token not found` is the 404 of `throwTokenNotFound`, and any other failure a 503 (a missed deadline as an outage:
 *   `asOutage`). Then #7, the node's `account_info` of the issuer, only when the answer has no `issuer_settings`, raced with the same deadline (a node that is slow shows the settings card's
 *   message and degrades the page), then #6, one names call, for the issuer, the holders, the transfers' parties and the markets' counter issuers.
 * - **Cards.** The holders, the transfers, the pools and the issuer's settings are cards: a failed one is told in its place (`SectionError`), logged under its name, and the request is
 *   degraded (served, not stored). The live volume failing keeps the pools and says so in a note. Nothing is deferred and nothing polls, so no call asks for the failure hold.
 * - **Behind a marker** (spec 3.3): #1 and #3 with the marker, awaited whole, and #6 for the transfers' parties; the page is the header and the transfers, `MARKER_PAGE_CLASS`. A 400 of
 *   the API for the marker, and nothing behind it, are 404s of class `short`, and any other failure of the two calls, a "Cannot GET" of a data API without D6 included, a 503.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  const search = queryOf(request.url);
  const checked = checkTokenRoute(net, { path: url.pathname, search: search === "" ? "" : `?${search}` }, url.pathname.split("/")[3] ?? "", "token");
  if (checked instanceof Response) return checked;
  const { asset, params: view } = checked;
  return view.marker === undefined ? firstPage(context, request, started, net, asset) : olderTransfers(context, request, net, asset, view);
}

type Asset = { currency: string; issuer: string };

/** The first page (spec 3.2, 3.3): #1 to #5 together, #7 where #1 has no settings, #6 after, and the page from what came. */
async function firstPage(context: Route.LoaderArgs["context"], request: Request, started: number, net: Network, asset: Asset) {
  const { api, node } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const race = <T,>(work: Promise<T>) => outcome(byDeadline(work, deadline));

  // Each is settled, so that none is left running or unhandled behind the answer, whatever the page turns out to be.
  const [token, holders, transfers, pools, volume] = await Promise.all([
    race(api.token(asset)),
    race(api.tokenHolders(asset, { limit: HOLDERS_SHOWN })),
    race(api.tokenTransfers(asset, { limit: TRANSFERS_PAGE })),
    net.hasAmm ? race(api.ammPools({ limit: 20, asset })) : null,
    net.hasAmm ? race(api.ammVolume({ live: "day" })) : null,
  ]);

  if (token.status === "rejected") {
    if (isNotFound(token.reason)) return throwTokenNotFound(api, net, asset, request);
    logProblem(`the token ${formatCurrency(asset.currency)} could not be loaded`, token.reason, request);
    return upstreamOutage(asOutage(token.reason), `token ${formatCurrency(asset.currency)}`);
  }
  const answer = token.value;

  const info = answer.token.issuer_settings === undefined ? await race(node.accountInfo(asset.issuer)) : null;

  const addresses = collectAddresses(
    answer.token.issuer,
    answer.token.markets.map((market) => market.counter_issuer),
    holders.status === "fulfilled" ? holders.value.holders.map((holder) => holder.holder) : [],
    transfers.status === "fulfilled" ? transfers.value.transfers.map((transfer) => [transfer.source, transfer.destination]) : [],
  );
  const { part: names } = await loadNames(api, addresses, { context, request, features: net.features });

  const { page, problems } = tokenPage({
    net,
    asset,
    answer,
    mode: "first",
    params: { back: [] },
    holders: partOf(holders),
    transfers: partOf(transfers),
    pools: pools === null ? null : partOf(pools),
    ammVolume: volume === null ? null : partOf(volume),
    accountInfo: info === null ? null : partOf(info),
    names,
  });

  // The settled results hold the reasons, which the page does not: each failed card is logged under its name, and the request is degraded.
  const results: Record<TokenPart, PromiseSettledResult<unknown> | null> = { holders, transfers, pools, ammVolume: volume, accountInfo: info };
  for (const { part } of problems) {
    const result = results[part];
    logProblem(failedWords(part, result?.status === "rejected" ? result.reason : undefined), result?.status === "rejected" ? result.reason : undefined, request);
  }
  if (problems.length > 0) markDegraded(context, `token: ${problems.map(({ part }) => part).join(", ")}`);
  return cached(page, "live");
}

/** A page of the transfers behind a marker (spec 3.3): #1 and #3, awaited whole, the names of the transfers' parties, and the header and the transfers. */
async function olderTransfers(context: Route.LoaderArgs["context"], request: Request, net: Network, asset: Asset, view: { marker?: string; back: readonly string[] }) {
  const { api } = clientsFor(context, net);
  const olderNotFound = `that page of the transfers of ${formatCurrency(asset.currency)}`;
  const [token, transfers] = await Promise.allSettled([api.token(asset), api.tokenTransfers(asset, { limit: TRANSFERS_PAGE, marker: view.marker })]);
  if (token.status === "rejected") {
    if (isNotFound(token.reason)) return throwTokenNotFound(api, net, asset, request);
    logProblem(`the token ${formatCurrency(asset.currency)} could not be loaded`, token.reason, request);
    return upstreamOutage(token.reason, `token ${formatCurrency(asset.currency)}`);
  }
  if (transfers.status === "rejected") {
    // The API refuses a marker that is not one of its own (a 400): the page does not exist.
    if (transfers.reason instanceof UpstreamError && transfers.reason.kind === "bad_request") notFound({ notFound: olderNotFound });
    logProblem(`the token's older transfers could not be loaded`, transfers.reason, request);
    return upstreamOutage(transfers.reason, "the token's older transfers");
  }
  // A marker past the last transfer has nothing behind it.
  if (transfers.value.transfers.length === 0) notFound({ notFound: olderNotFound });

  const addresses = collectAddresses(token.value.token.issuer, transfers.value.transfers.map((transfer) => [transfer.source, transfer.destination]));
  const { part: names } = await loadNames(api, addresses, { context, request, features: net.features });
  const { page } = tokenPage({
    net,
    asset,
    answer: token.value,
    mode: "older",
    params: view,
    holders: null,
    transfers: { state: "ok", value: transfers.value },
    pools: null,
    ammVolume: null,
    accountInfo: null,
    names,
  });
  return cached(page, MARKER_PAGE_CLASS);
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return tokenMeta(loaderData.meta, ctx);
}

export default function Token({ loaderData }: Route.ComponentProps) {
  return (
    <NamesProvider names={loaderData.names.map}>
      <TokenPage data={loaderData} />
    </NamesProvider>
  );
}
