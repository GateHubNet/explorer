import { redirect } from "react-router";

import { classify } from "../domain/search";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { upstreamFailure } from "../server/loader-errors";
import { requireNetwork } from "../server/network-route";
import { networkIdOfCtid, type NetworkId } from "../server/networks";
import { findHash, resolveCtid } from "../server/resolve";
import {
  choicePage,
  ctidNotFoundPage,
  hashNotFoundPage,
  helpPage,
  otherNetworkPage,
  shownQuery,
  type NetworkName,
  type SearchPageData,
} from "../server/search-view";
import { PRODUCT_NAME } from "../ui/brand";
import { findNetwork } from "../ui/networks";
import { SearchPage } from "../ui/pages/SearchPage";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.search";

// The loader names a cache class and throws 404s of class `short`.
export const headers = forwardCacheClass;

/** A redirect to what the search found. Class `short`, like the search pages themselves: a hash may be indexed any second. */
function found(to: string) {
  return redirect(to, { status: 302, headers: cacheClassHeaders("short") });
}

/** A network as a page names it (`findNetwork` knows the two; the fallback is the id). */
function nameOf(id: NetworkId): NetworkName {
  return { id, name: findNetwork(id)?.name ?? id };
}

/**
 * `/{net}/search?q=...` (spec 6): says what the input is (`classify`) and either redirects to the page that shows it or
 * answers with a page of its own. Every answer is class `short`; the pages are `noindex, follow`.
 *
 * - A ledger index (plain, or grouped as the explorer shows it), an address and an X-address (with `?tag=`): a redirect,
 *   without asking anyone.
 * - A hash: the data API is asked for the transaction and the ledger, and when it has neither, the node (spec 10). One found:
 *   a redirect to it. Both: a page with both links. Neither: a 404 that offers the same search on the other network.
 * - A CTID: of this network, the transaction at its place in the ledger (a redirect, or a 404 if there is none); of the
 *   other network, a page that offers it there; of neither, a 404.
 * - Anything else: the help text, as a 200.
 * - An upstream failure that leaves the question open is a 503 (`upstreamFailure`), never a "not found" that would be stored.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const network = requireNetwork(context, params);
  const typed = new URL(request.url).searchParams.get("q") ?? "";
  const query = shownQuery(typed);
  const input = classify(typed);
  const other = nameOf(network.other);

  switch (input.kind) {
    case "ledger-index":
      return found(`/${network.id}/ledger/${input.index}`);

    case "account":
      return found(`/${network.id}/account/${input.address}${input.tag === undefined ? "" : `?tag=${input.tag}`}`);

    case "hash": {
      const { api, node } = clientsFor(context, network);
      let matches;
      try {
        matches = await findHash(api, node, input.hash);
      } catch (err) {
        return upstreamFailure(err, `transaction or ledger ${input.hash}`);
      }
      if (matches.tx && matches.ledger) {
        return cached(choicePage(input.hash, { tx: matches.tx, ledger: matches.ledger }), "short");
      }
      if (matches.tx) return found(`/${network.id}/tx/${input.hash}`);
      if (matches.ledger) return found(`/${network.id}/ledger/${input.hash}`);
      return cached(hashNotFoundPage(query, input.hash, other), "short", { status: 404 });
    }

    case "ctid": {
      const { api } = clientsFor(context, network);
      let resolved;
      try {
        resolved = await resolveCtid(api, network, input.ctid);
      } catch (err) {
        return upstreamFailure(err, `transaction ${input.ctid}`);
      }
      if (resolved === null) {
        const covered = networkIdOfCtid(input.networkId) !== undefined;
        return cached(ctidNotFoundPage(query, input.ctid, input.networkId, covered), "short", { status: 404 });
      }
      if ("hash" in resolved) return found(`/${network.id}/tx/${resolved.hash}`);
      return cached(otherNetworkPage(query, input.ctid, nameOf(resolved.otherNetwork)), "short");
    }

    case "none":
      return cached(helpPage(query), "short");
  }
}

/** The part of the title that says which of the pages this is. */
function titleOf(data: SearchPageData): string {
  switch (data.kind) {
    case "choice":
      return "Transaction or ledger";
    case "help":
      return "Search";
    case "other-network":
      return `CTID on ${data.other.name}`;
    case "not-found":
      return "Not found";
  }
}

/** Search pages are for visitors: out of the index, but their links are followed (spec 9). */
export function meta({ loaderData, params }: Route.MetaArgs) {
  const robots = { name: "robots", content: "noindex, follow" };
  const network = findNetwork(params.net);
  if (!loaderData || !network) return [robots];
  return [{ title: `${titleOf(loaderData)} · ${network.name} · ${PRODUCT_NAME}` }, robots];
}

export default function Search({ loaderData }: Route.ComponentProps) {
  return <SearchPage network={useNetwork()} data={loaderData} />;
}
