import { redirect } from "react-router";

import { decodeCtid } from "../domain/ctid";
import { shortHash } from "../domain/format";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { upstreamFailure, upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { metaContext, transactionMeta } from "../server/meta";
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
  type BinaryRaw,
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
 *   and is class `immutable`. All of it is loaded here, never streamed: a page stored for a year must be whole. What the
 *   client returns is whole: it checks each answer inside the load its cache runs, so a 200 with the wrong content is a failure
 *   and is never stored. The binary form is the one part that may fail without the page: then the Binary tab says so (and a log
 *   line why), and the page is stored `short`. The API's JSON in place of the hex, for a type its codec cannot serialize, is a
 *   lasting answer: the page is `immutable` and the tab says there is no binary form. The ledger's list must not fail: a
 *   missing neighbour would be stored for a year, so that is a 503 (even its "not found": the API returned the transaction in
 *   that ledger).
 * - The data API says "not found": the node is asked, and a transaction it has in a validated ledger is shown with a note, as
 *   `short` for 60 s, without neighbours or binary form (they appear once it is indexed). If it has none either, a 404 that
 *   offers the same search on the other network. Any other failure of the data API is a 503 and the node is not asked; a 400
 *   (the hash is well formed) too, as it is the API's fault.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const network = requireNetwork(context, params);
  const id = params.id ?? "";

  if (HASH_64.test(id)) {
    const hash = id.toUpperCase();
    if (id !== hash) return permanent(`/${network.id}/tx/${hash}`);
    return transactionAnswer(context, network, hash, request);
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

async function transactionAnswer(context: Route.LoaderArgs["context"], network: Network, hash: string, request: Request) {
  const what = `transaction ${shortHash(hash)}`;
  const { api, node } = clientsFor(context, network);

  // Side by side, and both awaited: nothing is left running behind the answer.
  const [found, binary] = await Promise.allSettled([api.transaction(hash), api.transactionBinary(hash)]);

  if (found.status === "fulfilled") {
    // The client has checked the transaction and the list (inside the load its cache runs), so what is read here is whole.
    const source = txFromIndex(found.value);

    const ledger = await api
      .ledger(String(source.ledgerIndex), { transactions: true })
      .catch((err: unknown) => upstreamOutage(err, `the ledger of ${what}`));
    let neighbours;
    try {
      neighbours = neighboursOf(ledger.transactions, hash, source.meta.TransactionIndex);
    } catch (err) {
      return upstreamFailure(err, what);
    }

    let form: BinaryRaw;
    if (binary.status === "fulfilled") {
      form = binaryOf(binary.value);
    } else {
      // The page does without it (its Binary tab says it could not be loaded), and says why here: asking again can help.
      logProblem("the binary form of a transaction was not taken", binary.reason, request);
      form = { state: "failed" };
    }
    const page = transactionPage(source, { network, neighbours, binary: form });
    // Whole (also with the JSON the API serves for a type it cannot serialize, which is a lasting answer): for a year. Without its
    // binary form, which asking again may find, only for the short class's 30 s.
    return cached(page, form.state === "failed" ? "short" : "immutable");
  }

  // Not indexed (yet): the network itself may have it (spec 10). Any other failure is a 503, and the node is not asked in its place.
  // That includes a 400: the hash is 64 hex digits, a name the API must take, so a refusal is its fault and not a missing transaction.
  if (!(found.reason instanceof UpstreamError && found.reason.kind === "not_found")) return upstreamOutage(found.reason, what);

  let fromNode;
  try {
    fromNode = await node.tx(hash);
  } catch (err) {
    if (err instanceof UpstreamError && err.kind === "not_found") {
      return cached(transactionNotFoundPage(hash, nameOf(network.other)), "short", { status: 404 });
    }
    return upstreamOutage(err, what);
  }

  let source;
  try {
    source = txFromNode(fromNode, hash);
  } catch (err) {
    return upstreamOutage(err, what);
  }
  const page = transactionPage(source, { network, neighbours: null, binary: { state: "pending" } });
  return cached(page, "short", { ttl: FROM_NODE_TTL });
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  const suffix = `${ctx.network.name} · ${PRODUCT_NAME}`;

  switch (loaderData.kind) {
    case "transaction":
      return transactionMeta(loaderData, ctx);
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
