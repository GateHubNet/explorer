import { useEffect } from "react";
import { useLocation } from "react-router";

import type { Asset } from "../domain/asset";
import { naturalOrientation } from "../domain/market-pair";
import { candleWindow, CANDLE_COUNT, dayWindowStart, INTERVALS, parsePairParams, TRADES_API, type PairParams } from "../domain/market-params";
import { queryOf } from "../domain/network-params";
import type { Loaded } from "../server/account-view";
import { anchorOrThrow, type Anchor } from "../server/anchor";
import type { Page, PairExchange } from "../server/api-types";
import { HOME_CALL_TTL_SECONDS, MARKER_PAGE_CLASS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { byDeadline, CARD_DEADLINE_MS, outcome, TooLate } from "../server/deadline";
import { echoOf } from "../server/echo";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { pairMeta } from "../server/meta-pair";
import { requireNetwork } from "../server/network-route";
import type { Network } from "../server/networks";
import { existenceOf, olderPage, pairHead, pairPage, type LivePairData, type OlderPairData, type PairPageData } from "../server/pair-view";
import { parsePairPath, redirectToCanonical } from "../server/pair-route";
import { UpstreamError } from "../server/upstream";
import { createLiveOnScreen, keepLoaded } from "../ui/live-page";
import type { NetworkInfo } from "../ui/networks";
import { MarketPairPage } from "../ui/pages/MarketPairPage";
import type { NetworkRouteHandle } from "../ui/route-handle";
import { useLiveControls } from "../ui/use-live-controls";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.markets.$base.$counter";

// The loader names a cache class (`live-home`, or `MARKER_PAGE_CLASS` behind a marker), answers its 404s with class `short`, and tidies a path
// or a query with a redirect (`immutable` for the path alone, `short` with the query); a 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its Markets item as the section the page is in (`aria-current="true"`).
export const handle = { navSection: "markets" } satisfies NetworkRouteHandle;

/**
 * The parts of the page's data that a beat may keep when its answer has them failed and the page shows them loaded (`keepLoaded`, spec 3.10),
 * each one call or chain: the 24 h figures (#3), the candles (#4), the traders (#5), the order book (#6 and #7, one part: half a book is never
 * shown), the pool (#8) and its share (#9). The trades and the price are #2's, without which there is no answer to keep anything from.
 */
export const PAIR_PARTS = ["stats", "candles", "traders", "book", "pool", "share"] as const;

/** The trades of a page of the list (spec 3.6). */
const TRADES_PAGE = 20;

/** What the not-found page says of a page of older trades that is not there (a marker that is none, or one the API refuses or has nothing behind). */
const OLDER_NOT_FOUND = "that page of the market’s trades";

/** Why a part whose calls answered failed all the same (`pairPage`): what its log line says in place of an upstream's error. */
const UNREAD_PARTS: Record<string, string> = {
  pool: "the pool's assets are not the pair's",
  share: "no figure to work the share out from",
};

/** The page's pair and its view, once the URL is the one canonical URL of the view. */
interface PairView {
  net: Network;
  base: Asset;
  counter: Asset;
  view: PairParams;
}

/** The data API's `amm` parameter of the page's Trades filter, sent only when there is one (never `include`). */
const ammOf = (view: PairParams) => (view.trades === null ? undefined : TRADES_API[view.trades]);

/**
 * `/{net}/markets/{base}/{counter}` (markets spec 3): a market of the network's DEX, the pair in the URL's orientation (both orientations are
 * pages; the natural one is indexable). Its class is `live-home`, as the home and network pages': it follows the chain and an open tab asks
 * again every 4 s.
 *
 * - **Validation first** (spec 1.3, 1.4, 1.6). `MARKETS` off is the not-found page, for every view, before the path is read. A path that is no
 *   pair is a 404 of class `short` that says what was asked; a `marker` that is none is a 404 too, before any redirect. A path or a query that
 *   is not the canonical one is a 302 to the one URL (`redirectToCanonical`). The path is React Router's `url` (the `.data` of the route's own
 *   request taken off, the escapes kept) and the query the request's own text (`queryOf`: `_routes` dropped, nothing decoded), so the `.data`
 *   request of a canonical view answers its data. No call is made before these.
 * - **Behind a marker** (spec 3.11): one call, the page of trades, awaited whole and stored as `MARKER_PAGE_CLASS`. The API refusing the marker,
 *   or nothing behind it, is a 404.
 * - **Otherwise every call is made side by side and all are awaited** (spec 3.3, 3.7): #2, #5, #6, #7, #8; the anchor chain, #1 then #3 and
 *   #4; the AMM chain, #1 then #9. Without #1 or #2 there is no page (a 503, thrown once everything has settled), and an anchor that is not a
 *   number is the API failing too. Each card call and chain has failed when it has not answered `CARD_DEADLINE_MS` after the loader began
 *   ("took too long"): one slow call cannot hold the page. The node's own limit is 3 s.
 * - **Whether the market exists** (spec 1.4): no trade and an empty book is a 404 (with a Trades filter, once #10 says the pair has no trade at
 *   all), and no trade with a book that could not be read is a 503: the page cannot tell an empty market from a failed node.
 * - **A card that failed is told in its place** (`pairPage`), and logged; the request is then degraded, served and not stored. An absent pool
 *   and the AMM parts the switch leaves out are answers.
 * - **Every call asks for the failure hold** (spec 1.7): the page polls, so a failing upstream is remembered for 5 s and not asked again by
 *   every beat of every open tab. #1 is the home page's key, so a failure is held for both pages.
 *
 * The data carries the Worker's `BUILD_ID`, for an open page to tell a deploy (`live-page.ts`).
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const started = Date.now();
  const net = requireNetwork(context, params);
  if (!net.features.markets) throw cached({ notFound: "the markets pages" }, "short", { status: 404 });

  const path = parsePairPath(net, url.pathname);
  if (path.kind === "not-a-pair") throw cached({ notFound: `a market for ${echoOf(path.asked)}` }, "short", { status: 404 });

  const search = queryOf(request.url);
  const { params: view, canonical } = parsePairParams(new URLSearchParams(search), {
    native: net.native,
    tradesAllowed: net.hasAmm && net.features.ammData,
  });
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (view.marker !== undefined && !isMarker(view.marker)) throw cached({ notFound: OLDER_NOT_FOUND }, "short", { status: 404 });
  const tidied = redirectToCanonical(
    { path: url.pathname, search: search === "" ? "" : `?${search}` },
    { path: path.canonicalPath, search: canonical },
  );
  if (tidied) return tidied;

  const pair: PairView = { net, base: path.base, counter: path.counter, view };
  return view.marker === undefined ? livePage(context, request, started, pair) : olderTrades(context, pair);
}

/** The page behind a marker (spec 3.11): the one call, awaited whole. */
async function olderTrades(context: Route.LoaderArgs["context"], { net, base, counter, view }: PairView) {
  const { api } = clientsFor(context, net);
  let trades: Page<"exchanges", PairExchange>;
  try {
    trades = await api.pairExchanges(
      base,
      counter,
      { descending: true, limit: TRADES_PAGE, marker: view.marker, amm: ammOf(view) },
      { holdFailure: true },
    );
  } catch (err) {
    // The API refuses a marker that is not one of its own (a 400): the page does not exist.
    if (err instanceof UpstreamError && err.kind === "bad_request") throw cached({ notFound: OLDER_NOT_FOUND }, "short", { status: 404 });
    return upstreamOutage(err, "the market's older trades");
  }
  if (trades.exchanges.length === 0) throw cached({ notFound: OLDER_NOT_FOUND }, "short", { status: 404 });

  const page = olderPage({ network: net, base, counter, params: view, trades });
  return cached({ ...page, build: getEnv(context).BUILD_ID } satisfies OlderPairData, MARKER_PAGE_CLASS);
}

/** The live page (spec 3.7): every call side by side, then the existence of the market, then the page from what came. */
async function livePage(context: Route.LoaderArgs["context"], request: Request, started: number, { net, base, counter, view }: PairView) {
  const { api, node } = clientsFor(context, net);
  // #1, #2 and the two sides of the book follow the chain as the home page's lists do: kept 2 s, under keys of their own (#1 is the home page's).
  const kept = { ttl: HOME_CALL_TTL_SECONDS, holdFailure: true };
  const hold = { holdFailure: true };
  const deadline = started + CARD_DEADLINE_MS;
  const amm = ammOf(view);
  const interval = INTERVALS[view.interval];

  // #1 is the anchor: the chains wait for it, and fail with it.
  const lastCall = api.lastValidated(kept);
  const anchored = lastCall.then(anchorOrThrow);
  const tradesCall = api.pairExchanges(base, counter, { descending: true, limit: TRADES_PAGE, amm }, kept);
  // The pool is asked for in the natural orientation, so that both orientations of a pair share its answer, as they share the two sides of the
  // book (the asks of one are the bids of the other).
  const natural = naturalOrientation(base, counter, net.native);
  const poolCall = net.hasAmm ? outcome(byDeadline(node.ammInfoByPair(natural.base, natural.counter, hold), deadline)) : null;
  // #9: the 24 h figures of the other trades (the swaps; the order book's under the AMM filter), from which the pool card works out the AMM's
  // share of the pair's volume (spec 3.7).
  const shareCall =
    net.hasAmm && net.features.ammData
      ? outcome(
          byDeadline(
            anchored.then((anchor) =>
              api.pairReduce(base, counter, { start: dayWindowStart(anchor.closeTime), amm: view.trades === "amm" ? "exclude" : "only" }, hold),
            ),
            deadline,
          ),
        )
      : null;

  const [[last, trades, stats, candles, traders, asks, bids], pool, share] = await Promise.all([
    Promise.allSettled([
      lastCall,
      tradesCall,
      byDeadline(
        anchored.then((anchor) => api.pairReduce(base, counter, { start: dayWindowStart(anchor.closeTime), amm }, hold)),
        deadline,
      ),
      byDeadline(
        anchored.then((anchor) =>
          api.pairCandles(
            base,
            counter,
            { interval: interval.api, start: candleWindow(anchor.closeTime, view.interval).start, limit: CANDLE_COUNT + 1, amm },
            { cls: interval.long ? "minute" : "live", holdFailure: true },
          ),
        ),
        deadline,
      ),
      byDeadline(api.activeAccounts(base, counter, hold), deadline),
      byDeadline(node.bookOffers(base, counter, kept), deadline),
      byDeadline(node.bookOffers(counter, base, kept), deadline),
    ]),
    poolCall,
    shareCall,
  ]);

  // Without the anchor or the trades there is no page; thrown only now that every call has settled.
  if (last.status === "rejected") return upstreamOutage(last.reason, "the market");
  let anchor: Anchor;
  try {
    anchor = anchorOrThrow(last.value);
  } catch (error) {
    logProblem("the market pair page has no anchor", error, request);
    return upstreamOutage(error, "the market");
  }
  if (trades.status === "rejected") return upstreamOutage(trades.reason, "the market");

  /** The errors of the calls of each part, for the log. */
  const errors = new Map<string, unknown[]>();
  /** A call's outcome as a `Loaded`: a "not found" of an upstream is `missing`, any other failure (a deadline included) `failed`. */
  function settle<T>(part: string, result: PromiseSettledResult<T>): Loaded<T> {
    if (result.status === "fulfilled") return { state: "ok", value: result.value };
    errors.set(part, [...(errors.get(part) ?? []), result.reason]);
    return result.reason instanceof UpstreamError && result.reason.kind === "not_found" ? { state: "missing" } : { state: "failed" };
  }

  // Whether the market exists: a trade, or an offer; with a filter and nothing of either, whether the pair has any trade at all (#10).
  const book = { asks: settle("book", asks), bids: settle("book", bids) };
  const filtered = view.trades !== null;
  let unfiltered: Loaded<Page<"exchanges", PairExchange>> | undefined;
  let probeError: unknown;
  let existence = existenceOf(trades.value.exchanges, book, filtered);
  if (existence === "ask-unfiltered") {
    const probe = await outcome(api.pairExchanges(base, counter, { descending: true, limit: 1 }, hold));
    if (probe.status === "rejected") probeError = probe.reason;
    unfiltered = probe.status === "fulfilled" ? { state: "ok", value: probe.value } : { state: "failed" };
    existence = existenceOf(trades.value.exchanges, book, filtered, unfiltered);
  }
  if (existence === "absent") {
    const head = pairHead(net, base, counter, view);
    throw cached({ notFound: `a market for ${head.title} (${head.issuedBy})` }, "short", { status: 404 });
  }
  if (existence === "outage") {
    const cause = probeError ?? errors.get("book")?.[0];
    logProblem("the market pair page cannot tell whether the market exists", cause, request);
    const outage = cause instanceof UpstreamError ? cause : new UpstreamError("server", "the market cannot be told apart from one that does not exist", { cause });
    return upstreamOutage(outage, "the market");
  }

  const { page, problems } = pairPage({
    network: net,
    base,
    counter,
    params: view,
    closeTime: anchor.closeTime,
    trades: trades.value,
    hasTrade: trades.value.exchanges.length > 0 || (unfiltered?.state === "ok" && unfiltered.value.exchanges.length > 0),
    stats: settle("stats", stats),
    candles: settle("candles", candles),
    traders: settle("traders", traders),
    asks: book.asks,
    bids: book.bids,
    pool: pool === null ? null : settle("pool", pool),
    share: share === null ? null : settle("share", share),
  });
  for (const part of problems) {
    // A part whose calls answered failed in the view builder: a pool of other assets than the pair's (`poolSides`), or a share whose 24 h
    // figures failed (logged as the stats') or are no number.
    const found = errors.get(part) ?? [new Error(UNREAD_PARTS[part] ?? `the ${part} could not be read`)];
    for (const error of found) {
      logProblem(`the market pair page's ${part} ${error instanceof TooLate ? "took too long" : "could not be loaded"}`, error, request);
    }
  }
  if (problems.length > 0) markDegraded(context, problems.join("; "));

  return cached({ ...page, anchor, build: getEnv(context).BUILD_ID } satisfies LivePairData, "live-home");
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  const { head, view, mode } = loaderData;
  return pairMeta({ head, view, mode, indexable: loaderData.mode === "live" && loaderData.indexable }, ctx);
}

/**
 * What the pair page on screen shows, and what happens when its refresh does not work (the home page's `onScreen`, `live-page.ts`): the page
 * keeps what it shows, counts the failures, refuses an answer that is behind the ledger it is at or of another build, and keeps each part it
 * shows loaded when an answer has that part failed (`keepLoaded` over `PAIR_PARTS`). A page behind a marker never shows itself here.
 */
const onScreen = createLiveOnScreen<PairPageData>({
  order: (data) => (data.mode === "live" ? data.anchor.lastValidated : 0),
  merge: (next, shown) => (next.mode === "live" && shown.mode === "live" ? keepLoaded(next, shown, PAIR_PARTS) : next),
});

/**
 * The scope of a view of a pair (spec 3.10): the network, the pair as the URL has it, and the query, so that a refresh of another view (another
 * interval, filter or orientation, a page behind a marker) never stands in for it. A page is drawn only at its canonical URL (any other is
 * redirected before a call), so the query of a page on screen is the canonical one. `query` is `queryOf`'s: no `?`, no `_routes`.
 */
function pairScope(params: { net?: string; base?: string; counter?: string }, query: string): string {
  return `${params.net}/markets/${params.base}/${params.counter}${query === "" ? "" : `?${query}`}`;
}

/**
 * In the browser only, and only after the first render (README, "Live updates"): runs the loader through the explorer's own `.data` URL and
 * hands the page what it already shows when that fails. A navigation to a view that is not on screen has nothing to keep and gets the error
 * screen as before.
 */
export function clientLoader({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  return onScreen.reload(pairScope(params, queryOf(request.url)), serverLoader);
}

/**
 * The live page and its updates: the polling and the controls (`useLiveControls`), the page on screen told to `onScreen`, and the page keyed by
 * its scope (another view is a navigation and a first render, not a ledger closing: the kit rings a chart whose token changes after it is
 * mounted, so the page must be mounted again). A child of its own, so that the route calls the same hooks for both modes.
 */
function LivePair({ network, data, scope }: { network: NetworkInfo; data: LivePairData; scope: string }) {
  const live = useLiveControls(onScreen);
  useEffect(() => onScreen.show(scope, data), [scope, data]);
  return <MarketPairPage key={scope} network={network} data={data} live={live} />;
}

export default function MarketPair({ loaderData, params }: Route.ComponentProps) {
  const network = useNetwork();
  const { search } = useLocation();
  // Behind a marker the page is old history: no live hook, no refresh (spec 3.11).
  return loaderData.mode === "live" ? (
    <LivePair network={network} data={loaderData} scope={pairScope(params, queryOf(search))} />
  ) : (
    <MarketPairPage network={network} data={loaderData} />
  );
}
