import { redirect } from "react-router";

import { decodeCtid } from "../domain/ctid";
import { formatAmount, shortHash } from "../domain/format";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { upstreamFailure, upstreamOutage } from "../server/loader-errors";
import { requireNetwork } from "../server/network-route";
import { networkIdOfCtid, type Network, type NetworkId } from "../server/networks";
import { resolveCtid } from "../server/resolve";
import { ctidNotFoundPage, otherNetworkPage, shownQuery, type NetworkName, type SearchPageData } from "../server/search-view";
import {
  binaryOf,
  neighboursOf,
  transactionNotFoundPage,
  transactionPage,
  txFromIndex,
  txFromNode,
  type TransactionPageData,
} from "../server/transaction-view";
import { UpstreamError } from "../server/upstream";
import { PRODUCT_NAME } from "../ui/brand";
import { findNetwork } from "../ui/networks";
import { SearchPage } from "../ui/pages/SearchPage";
import { TransactionPage } from "../ui/pages/TransactionPage";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.tx.$id";

// The loader names a cache class and throws 404s of class `short`.
export const headers = forwardCacheClass;

const HASH_64 = /^[0-9A-Fa-f]{64}$/;

/** How long the edge keeps a page shown from the node: long enough to spare the node, short enough for the index to take over. */
const FROM_NODE_TTL = 60;

/** A redirect that never changes (a hash in canonical form, the hash a CTID names), with the class of the page it leads to. */
function permanent(to: string) {
  return redirect(to, { status: 302, headers: cacheClassHeaders("immutable") });
}

/** A network as a page names it. */
function nameOf(id: NetworkId): NetworkName {
  return { id, name: findNetwork(id)?.name ?? id };
}

/**
 * `/{net}/tx/{hash|ctid}` (spec 2, 3, 10): a transaction, with its place in its ledger and the hashes of the ones around it.
 *
 * - A hash in canonical form (upper case) is the page. Another case is a 302 to it, and anything that is neither a 64-digit hash
 *   nor a CTID is a 404 of class `short`: neither asks anyone. Both redirects are class `immutable`.
 * - A CTID of this network is a 302 to the hash it names (`resolveCtid`); one of the other network is the page that offers it
 *   there (what the search shows); a CTID that names nothing, or of a network that is not covered, is a 404.
 * - The page asks the data API for the transaction, for its binary form (`binary=true`) and then for the hashes of its ledger,
 *   and is class `immutable`. All of it is loaded here, never streamed: a page stored for a year must be whole. The binary
 *   form is the one part that may fail without the page: then the Binary tab says so, and the page is stored `short`. The
 *   ledger's list must not fail: a missing neighbour would be stored for a year, so that is a 503 (even its "not found": the
 *   API returned the transaction in that ledger).
 * - The data API says "not found": the node is asked, and a transaction it has in a validated ledger is shown with a note, as
 *   `short` for 60 s, without neighbours or binary form (they appear once it is indexed). If it has none either, a 404 that
 *   offers the same search on the other network. Any other failure of the data API is a 503 and the node is not asked.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const network = requireNetwork(context, params);
  const id = params.id ?? "";

  if (HASH_64.test(id)) {
    const hash = id.toUpperCase();
    if (id !== hash) return permanent(`/${network.id}/tx/${hash}`);
    return transactionAnswer(context, network, hash);
  }

  const ctid = decodeCtid(id);
  if (ctid) return ctidAnswer(context, network, id, ctid.networkId);

  throw cached({ notFound: `transaction ${JSON.stringify(id.slice(0, 80))}` }, "short", { status: 404 });
}

async function ctidAnswer(context: Route.LoaderArgs["context"], network: Network, ctid: string, ctidNetworkId: number) {
  const { api } = clientsFor(context, network);
  let resolved;
  try {
    resolved = await resolveCtid(api, network, ctid);
  } catch (err) {
    return upstreamFailure(err, `transaction ${ctid}`);
  }

  if (resolved === null) {
    const covered = networkIdOfCtid(ctidNetworkId) !== undefined;
    return cached(ctidNotFoundPage(shownQuery(ctid), ctid, ctidNetworkId, covered), "short", { status: 404 });
  }
  if ("hash" in resolved) return permanent(`/${network.id}/tx/${resolved.hash}`);
  return cached(otherNetworkPage(shownQuery(ctid), ctid, nameOf(resolved.otherNetwork)), "short");
}

async function transactionAnswer(context: Route.LoaderArgs["context"], network: Network, hash: string) {
  const what = `transaction ${shortHash(hash)}`;
  const { api, node } = clientsFor(context, network);

  // Side by side, and both awaited: nothing is left running behind the answer.
  const [found, binary] = await Promise.allSettled([api.transaction(hash), api.transactionBinary(hash)]);

  if (found.status === "fulfilled") {
    let source;
    try {
      source = txFromIndex(found.value, hash);
    } catch (err) {
      return upstreamFailure(err, what);
    }

    const ledger = await api
      .ledger(String(source.ledgerIndex), { transactions: true })
      .catch((err: unknown) => upstreamOutage(err, `the ledger of ${what}`));
    let neighbours;
    try {
      neighbours = neighboursOf(ledger.transactions, hash, source.meta.TransactionIndex);
    } catch (err) {
      return upstreamFailure(err, what);
    }

    const form = binary.status === "fulfilled" ? binaryOf(binary.value) : ({ state: "failed" } as const);
    const page = transactionPage(source, { network, neighbours, binary: form });
    // Whole: for a year. Without its binary form (which a retry may find) only for the short class's 30 s.
    return cached(page, form.state === "ready" ? "immutable" : "short");
  }

  // Not indexed (yet): the network itself may have it (spec 10). Any other failure is a 503, and the node is not asked in its place.
  if (!(found.reason instanceof UpstreamError && found.reason.kind === "not_found")) return upstreamFailure(found.reason, what);

  let fromNode;
  try {
    fromNode = await node.tx(hash);
  } catch (err) {
    if (err instanceof UpstreamError && err.kind === "not_found") {
      return cached(transactionNotFoundPage(hash, nameOf(network.other)), "short", { status: 404 });
    }
    return upstreamFailure(err, what);
  }

  let source;
  try {
    source = txFromNode(fromNode, hash);
  } catch (err) {
    return upstreamFailure(err, what);
  }
  const page = transactionPage(source, { network, neighbours: null, binary: { state: "pending" } });
  return cached(page, "short", { ttl: FROM_NODE_TTL });
}

export function meta({ loaderData, params }: Route.MetaArgs) {
  const network = findNetwork(params.net);
  if (!loaderData || !network) return [];
  const suffix = `${network.name} · ${PRODUCT_NAME}`;

  switch (loaderData.kind) {
    case "transaction": {
      const data: TransactionPageData = loaderData;
      return [
        { title: `${data.title} ${shortHash(data.hash)} · ${suffix}` },
        { name: "description", content: `${data.summary} Transaction ${data.position.index} of ledger ${formatAmount(String(data.ledgerIndex))} on ${network.name}.` },
      ];
    }
    case "other-network":
      return [{ title: `CTID on ${loaderData.other.name} · ${suffix}` }, { name: "robots", content: "noindex, follow" }];
    default:
      return [{ title: `Transaction not found · ${suffix}` }, { name: "robots", content: "noindex" }];
  }
}

export default function Transaction({ loaderData }: Route.ComponentProps) {
  const network = useNetwork();
  const data: TransactionPageData | SearchPageData = loaderData;
  return data.kind === "transaction" ? <TransactionPage network={network} data={data} /> : <SearchPage network={network} data={data} />;
}
