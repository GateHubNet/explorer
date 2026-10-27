import { nftHref, nftWords, parseNftParams, shortNftId, type NftQuery } from "../domain/nft-params";
import { queryOf } from "../domain/query-of";
import { MARKER_PAGE_CLASS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { asOutage, byDeadline, CARD_DEADLINE_MS, outcome, TooLate } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { notFound, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { nftMeta } from "../server/meta-nft";
import { networkOf, type Network } from "../server/networks";
import { requireNetwork } from "../server/network-route";
import { readNodeNft, readNodeOffers } from "../server/nft-read";
import { needsNode, nftMarkerPage, nftModeOf, nftNotFound, nftPage, NFT_MODE_CLASS, type NftPageInput } from "../server/nft-view";
import { redirectToHref } from "../server/pair-route";
import { isNotFound, UpstreamError } from "../server/upstream";
import { NftPage } from "../ui/pages/NftPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.nft.$id";

// The loader names a cache class (`live`, `slow` for a burned NFT, `short` kept 60 s for one shown from the network, `MARKER_PAGE_CLASS` behind a marker), answers its 404s with class
// `short`, and tidies a path or a query with a redirect (`immutable` for the path alone: the id in another case). A 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its NFTs item as the page of the section (`aria-current="page"`).
export const handle = { navSection: "nfts" } satisfies NetworkRouteHandle;

const HEX_64 = /^[0-9A-Fa-f]{64}$/;

/** The rows of a page of the history (spec 4.3, #4) and the open offers asked for (#3). */
const HISTORY_PAGE = 20;
const OFFERS_LIMIT = 50;

/** The events the history shows unless the visitor asked for the offer events too (`?offers=1`): the NFT's own life, not what was offered for it. */
const PLAIN_EVENTS = ["mint", "burn", "modify", "sale", "transfer"] as const;

/** The words of what failed, for the log: a call that missed its deadline "took too long", any other "could not be loaded". `part` is empty for the NFT itself. */
const failedWords = (part: string, reason: unknown) => `the NFT${part === "" ? "" : `'s ${part}`} ${reason instanceof TooLate ? "took too long" : "could not be loaded"}`;

/** The phrase of the 404 of an NFT neither the index nor the node has: `nftNotFound`'s sentence is "We couldn't find {this} on {network}", which the not-found page writes round it. */
function missing(sentence: string, net: Network): string {
  return sentence.slice("We couldn't find ".length, sentence.length - ` on ${net.name}`.length);
}

/**
 * `/{net}/nft/{ID}` (NFT spec 4): one NFT (a URIToken on Xahau) of the network, by its id of 64 hex digits. Its class is by mode (spec 9): `live`, `slow` for a burned NFT, `short` kept
 * 60 s for one that only the node has.
 *
 * - **Validation first** (spec 1.2, 1.3). `NFTS` off is the not-found page, a 404 of class `short`, for every view. An id that is not 64 hex digits is a 404 that repeats what was asked
 *   (`echoOf`). Then a `marker` that is none is a 404 of class `short`, before any redirect, which would otherwise lead to a URL that holds it. An id in lower or mixed case is a 302 to the
 *   upper-case URL, and any other query that is not the view's canonical form (`parseNftParams`, `nftHref`) a 302 to it (`redirectToHref`: class `immutable` when only the path differs, `short` with
 *   the query), the path being React Router's `url` (the `.data` of the route's own request taken off) and the query the request's own text (`queryOf`). No call is made before these.
 * - **A first page** (spec 4.3): #1 the NFT, #3 its open offers and #4 its history (without the offer events unless `?offers=1`) start together, each raced with the card deadline. After #1,
 *   #2, the node's NFT, is asked where `needsNode` says so (the index has no such NFT, or has it without an owner and not burned), and `nftModeOf` decides the page. An NFT that is `none` (the
 *   index and the node both say there is none) is a 404 that offers the same search on the other network; `unavailable` (any failure that is not that, of the index, or of the node while the
 *   index has none) a 503, never stored, and a failed index never asks the node in its place. An NFT from the network has its offers from the node, XRPL's `nft_sell_offers` and `nft_buy_offers`
 *   joined (sell first), Xahau's the entry's own, and no history.
 * - **Cards.** The open offers and the history are cards: a failed one is told in its place, logged under its name, and the request is degraded (served, not stored); so is the owner a node
 *   could not tell for an NFT the index has without one, unless the node said it has no such NFT. A burned NFT's offers are not used, so their failure is no one's. Nothing is deferred and
 *   nothing polls, so no call asks for the failure hold.
 * - **Behind a marker** (spec 4.3): #1 and #4, awaited whole, class `MARKER_PAGE_CLASS`. A 400 of the API for the marker, nothing behind it and an NFT the index does not have are 404s of
 *   class `short`, and any other failure, a "Cannot GET" of a data API without D3 included, a 503.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  const words = nftWords(net.id);
  if (!net.features.nfts) notFound({ notFound: `the ${words.token} pages` });

  const asked = params.id ?? "";
  if (!HEX_64.test(asked)) notFound({ notFound: `${words.token} ${echoOf(asked, 80)}` });
  const id = asked.toUpperCase();

  const search = queryOf(request.url);
  const query = parseNftParams(new URLSearchParams(search));
  const olderNotFound = `that page of ${words.token} ${shortNftId(id)}`;
  // A marker is checked before the redirects, which would otherwise lead to a URL that holds it.
  if (query.marker !== undefined && !isMarker(query.marker)) notFound({ notFound: olderNotFound });
  const tidied = redirectToHref({ path: url.pathname, search }, nftHref(net.id, id, query));
  if (tidied) return tidied;

  return query.marker === undefined ? firstPage(context, request, started, net, id, query) : markerPage(context, request, net, id, query, olderNotFound);
}

/** The history's call (#4) of a view: the plain events, or all with `?offers=1`, newest first, behind the view's marker when it has one. */
const historyQuery = (query: NftQuery) => ({ descending: true, limit: HISTORY_PAGE, event: query.offers ? undefined : PLAIN_EVENTS, marker: query.marker });

/** A page of the history behind a marker (spec 4.3): #1 and #4, awaited whole. A marker is the index's, so an NFT it does not have has no such page. */
async function markerPage(context: Route.LoaderArgs["context"], request: Request, net: Network, id: string, query: NftQuery, olderNotFound: string) {
  const { api } = clientsFor(context, net);
  const [index, history] = await Promise.allSettled([api.nft(id), api.nftHistory(id, historyQuery(query))]);
  if (index.status === "rejected") {
    if (isNotFound(index.reason)) notFound({ notFound: olderNotFound });
    logProblem(failedWords("", index.reason), index.reason, request);
    return upstreamOutage(index.reason, `the ${nftWords(net.id).token}`);
  }
  if (history.status === "rejected") {
    // The API refuses a marker that is not one of its own (a 400): the page does not exist.
    if (history.reason instanceof UpstreamError && history.reason.kind === "bad_request") notFound({ notFound: olderNotFound });
    logProblem(failedWords("history behind a marker", history.reason), history.reason, request);
    return upstreamOutage(history.reason, `the ${nftWords(net.id).token}'s older history`);
  }
  // A marker past the last row has nothing behind it.
  if (history.value.events.length === 0) notFound({ notFound: olderNotFound });
  return cached(nftMarkerPage({ net, id, query, index: index.value, history: history.value }), MARKER_PAGE_CLASS);
}

/** The first page (spec 4.3): #1, #3 and #4 together, #2 after #1 where it is needed, and the page of the mode they make. */
async function firstPage(context: Route.LoaderArgs["context"], request: Request, started: number, net: Network, id: string, query: NftQuery) {
  const { api, node } = clientsFor(context, net);
  const deadline = started + CARD_DEADLINE_MS;
  const words = nftWords(net.id);

  // #1, #3 and #4 start together. Each is settled, so that none is left running or unhandled behind the answer, whatever the page turns out to be.
  const indexCall = outcome(byDeadline(api.nft(id), deadline));
  const offersCall = outcome(byDeadline(api.nftOffers(id, { limit: OFFERS_LIMIT }), deadline));
  const historyCall = outcome(byDeadline(api.nftHistory(id, historyQuery(query)), deadline));

  const index = await indexCall;
  // #2: the node is asked only where the index says it is needed, and never in place of an index that failed.
  const fromNode = needsNode(index) ? await outcome(byDeadline(readNodeNft(node, net, id), deadline)) : null;
  const mode = nftModeOf(index, fromNode);
  const [indexOffers, indexHistory] = await Promise.all([offersCall, historyCall]);

  if (mode === "none") {
    const { text, otherHref } = nftNotFound(net, id);
    const other = networkOf(net.other, getEnv(context));
    notFound({ notFound: missing(text, net), suggestion: { href: otherHref, label: `Search on ${other.name}` } });
  }
  if (mode === "unavailable") {
    // Only a failed index is unavailable (nftModeOf). The reason is its own, or the node's when the index said there is no such NFT and the node could not say.
    if (index.status !== "rejected") throw new Error("an NFT that the index has is never unavailable");
    const reason = isNotFound(index.reason) && fromNode?.status === "rejected" ? fromNode.reason : index.reason;
    logProblem(failedWords("", reason), reason, request);
    return upstreamOutage(asOutage(reason), `the ${words.token}`);
  }

  const fromNetwork = mode === "network" || mode === "network-burned";
  const now = Math.floor(started / 1000);
  const entry = fromNode?.status === "fulfilled" ? fromNode.value : undefined;

  // An NFT from the network has its offers from the node (after #2), and no history. A burned one has no offers to ask for.
  let offers: NftPageInput["offers"] = fromNetwork ? null : indexOffers;
  if (mode === "network" && entry !== undefined) offers = await outcome(byDeadline(readNodeOffers(node, id, entry), deadline));
  const history = fromNetwork ? null : indexHistory;

  // The settled results hold the reasons, which the page does not: each failed card is logged under its name, and the request is degraded. A burned NFT has no open offers to ask
  // for, so its offers call is no card. The owner of an NFT the index has without one is a card too, unless the node said it has no such NFT.
  const problems: Array<[part: string, result: PromiseSettledResult<unknown> | null]> = [
    ["open offers", mode === "burned" ? null : offers],
    ["history", history],
    ["owner from the network", mode === "indexed-owner-unknown" && fromNode?.status === "rejected" && !isNotFound(fromNode.reason) ? fromNode : null],
  ];
  const failed = problems.flatMap(([part, result]) => (result?.status === "rejected" ? [{ part, reason: result.reason as unknown }] : []));
  for (const { part, reason } of failed) logProblem(failedWords(part, reason), reason, request);
  if (failed.length > 0) markDegraded(context, `nft: ${failed.map(({ part }) => part).join(", ")}`);

  const { cls, ttl } = NFT_MODE_CLASS[mode];
  return cached(nftPage({ net, id, query, mode, now, ...(index.status === "fulfilled" && !fromNetwork ? { index: index.value } : {}), ...(entry === undefined ? {} : { node: entry }), offers, history }), cls, { ttl });
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return nftMeta(loaderData, ctx);
}

export default function Nft({ loaderData }: Route.ComponentProps) {
  return <NftPage data={loaderData} />;
}
