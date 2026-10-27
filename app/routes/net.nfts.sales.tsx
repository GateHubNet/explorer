import { nftSalesHref, nftWords, parseNftSalesParams } from "../domain/nft-params";
import { queryOf } from "../domain/query-of";
import { MARKER_PAGE_CLASS } from "../server/cache-class";
import { clientsFor } from "../server/clients";
import { cached, forwardCacheClass } from "../server/edge-cache";
import { upstreamOutage } from "../server/loader-errors";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { nftSalesMeta } from "../server/meta-nft-sales";
import { requireNetwork } from "../server/network-route";
import { nftSalesPage } from "../server/nfts-view";
import { redirectToCanonical } from "../server/pair-route";
import { UpstreamError } from "../server/upstream";
import { NftSalesPage } from "../ui/pages/NftSalesPage";
import type { NetworkRouteHandle } from "../ui/route-handle";

import type { Route } from "./+types/net.nfts.sales";

// The loader names a cache class (`minute`, or `MARKER_PAGE_CLASS` behind a marker), answers its 404s with class `short`, and tidies a path or a query with a redirect
// (`immutable` for the path alone, `short` with the query). A 503 it throws is not stored but replaced by the stored copy.
export const headers = forwardCacheClass;

// The header marks its NFTs item as the page of the section (`aria-current="page"`).
export const handle = { navSection: "nfts" } satisfies NetworkRouteHandle;

/** The sales of a page (spec 2.3). */
const SALES_PAGE = 20;

/**
 * `/{net}/nfts/sales` (NFT spec 2.3): the sales of the network's NFTs (URITokens on Xahau), newest first, a page at a time.
 *
 * - **Validation first** (spec 1.2, 1.3). `NFTS` off is the not-found page, a 404 of class `short`, before the query is read. A `marker` that is none is a 404 of class `short`,
 *   before the redirect; a query that is not the canonical one (`marker` and its trail `back` alone, the trail only behind a marker) is a 302 to it, class `short`, and a path that
 *   is not the route's own (`/xrpl/NFTs/sales`) one of class `immutable`. No call is made before these.
 * - **One call**, awaited whole: the page of sales. The API refusing a marker (a 400), or nothing behind it, is a 404 of class `short`; any other failure, a "Cannot GET" of a data
 *   API without D3 included, a 503 (`upstreamOutage`), which is not stored. On the first page there is no marker to refuse: a 400 there is the API failing.
 * - **The class is `minute`** (spec 9) for the first page, `MARKER_PAGE_CLASS` for a page behind a marker.
 */
export async function loader({ request, url, params, context }: Route.LoaderArgs) {
  const net = requireNetwork(context, params);
  const words = nftWords(net.id);
  if (!net.features.nfts) throw cached({ notFound: `the ${words.token} pages` }, "short", { status: 404 });

  const moreNotFound = `that page of the ${words.token} sales`;
  const search = queryOf(request.url);
  const query = parseNftSalesParams(new URLSearchParams(search));
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (query.marker !== undefined && !isMarker(query.marker)) throw cached({ notFound: moreNotFound }, "short", { status: 404 });
  const canonical = nftSalesHref(net.id, query);
  const at = canonical.indexOf("?");
  const tidied = redirectToCanonical(
    { path: url.pathname, search: search === "" ? "" : `?${search}` },
    { path: at < 0 ? canonical : canonical.slice(0, at), search: at < 0 ? "" : canonical.slice(at) },
  );
  if (tidied) return tidied;

  const { api } = clientsFor(context, net);
  const page = await api.nftSales({ descending: true, limit: SALES_PAGE, marker: query.marker }).catch((err: unknown) => {
    // The API refuses a marker that is not one of its own (a 400): that page does not exist. On the first page it is the API failing.
    if (query.marker !== undefined && err instanceof UpstreamError && err.kind === "bad_request") throw cached({ notFound: moreNotFound }, "short", { status: 404 });
    return upstreamOutage(err, `the ${words.token} sales`);
  });
  // A marker past the last sale has nothing behind it.
  if (query.marker !== undefined && page.sales.length === 0) throw cached({ notFound: moreNotFound }, "short", { status: 404 });

  return cached(nftSalesPage(net, query, page), query.marker === undefined ? "minute" : MARKER_PAGE_CLASS);
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return nftSalesMeta(loaderData, ctx);
}

export default function NftSales({ loaderData }: Route.ComponentProps) {
  return <NftSalesPage data={loaderData} />;
}
