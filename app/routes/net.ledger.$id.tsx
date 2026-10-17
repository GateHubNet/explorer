import { redirect } from "react-router";

import { formatAmount, formatUtc, shortHash } from "../domain/format";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { ledgerPage, sourceFromIndex, sourceFromNode, type LedgerSource } from "../server/ledger-view";
import { upstreamFailure, upstreamOutage } from "../server/loader-errors";
import { requireNetwork } from "../server/network-route";
import { UpstreamError } from "../server/upstream";
import { PRODUCT_NAME } from "../ui/brand";
import { findNetwork } from "../ui/networks";
import { LedgerPage } from "../ui/pages/LedgerPage";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.ledger.$id";

// The loader names a cache class and throws 404s of class `short`.
export const headers = forwardCacheClass;

/** A ledger index: 1 to 10 digits, as the search box reads one (spec 6). */
const LEDGER_INDEX = /^\d{1,10}$/;
const LEDGER_HASH = /^[0-9A-Fa-f]{64}$/;

/** How long the edge keeps a page shown from the node: long enough to spare the node, short enough for the index to take over. */
const FROM_NODE_TTL = 60;

/**
 * `/{net}/ledger/{index|hash}` (spec 2, 3, 10): the ledger and its transactions from the data API, and the newest validated ledger
 * (for the next button, and to tell the ledger that is still the newest from the ones that never change).
 *
 * - Class `immutable`: a validated ledger is final. `live` while it is the newest, so the page for it is replaced within seconds.
 * - A hash in lower case, or an index with leading zeros, is redirected to the one URL a ledger has.
 * - The data API answers "not found": the node is asked, and a ledger it has validated is shown with a note, as `short` for
 *   60 s. If it has none either, 404. Any other failure of the data API is a 503 (the node is not asked in its place).
 * - Everything is loaded here, never streamed: an `immutable` page is stored for a year, and a section that failed to
 *   stream would be stored with it.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const network = requireNetwork(context, params);
  const id = params.id ?? "";

  if (LEDGER_HASH.test(id)) {
    const canonical = id.toUpperCase();
    if (id !== canonical) return canonicalRedirect(`/${network.id}/ledger/${canonical}`);
  } else if (LEDGER_INDEX.test(id)) {
    const canonical = String(Number(id));
    if (id !== canonical) return canonicalRedirect(`/${network.id}/ledger/${canonical}`);
  } else {
    throw cached({ notFound: `ledger ${JSON.stringify(id.slice(0, 80))}` }, "short", { status: 404 });
  }

  const what = `ledger ${LEDGER_HASH.test(id) ? shortHash(id) : id}`;
  const { api, node } = clientsFor(context, network);
  const [found, newest] = await Promise.allSettled([api.ledger(id, { expand: true }), api.lastValidated()]);

  if (newest.status === "rejected") upstreamOutage(newest.reason, "the newest ledger");

  let source: LedgerSource;
  if (found.status === "fulfilled") {
    source = sourceFromIndex(found.value);
  } else if (found.reason instanceof UpstreamError && found.reason.kind === "not_found") {
    // Not indexed (yet): the network itself may have it (spec 10). No luck there either is a 404.
    try {
      source = sourceFromNode(await node.ledger(id, { expand: true }));
    } catch (err) {
      return upstreamFailure(err, what);
    }
  } else {
    return upstreamFailure(found.reason, what);
  }

  const last = Number(newest.value.ledger_index);
  const hasNext = Number.isSafeInteger(last) && source.index < last;
  const page = ledgerPage(source, { native: network.native, hasNext });

  if (source.origin === "node") return cached(page, "short", { ttl: FROM_NODE_TTL });
  return cached(page, hasNext ? "immutable" : "live");
}

/** A redirect to the one URL of an object. It never changes, and carries the class of the page it leads to. */
function canonicalRedirect(to: string) {
  return redirect(to, { status: 302, headers: cacheClassHeaders("immutable") });
}

export function meta({ loaderData, params }: Route.MetaArgs) {
  const network = findNetwork(params.net);
  if (!loaderData || !network) return [];
  const { header, txCount } = loaderData;
  const index = formatAmount(String(header.index));
  const transactions = `${formatAmount(String(txCount))} ${txCount === 1 ? "transaction" : "transactions"}`;
  return [
    { title: `Ledger #${index} · ${network.name} · ${PRODUCT_NAME}` },
    {
      name: "description",
      content: `Ledger ${index} on ${network.name} closed ${formatUtc(header.closeTime)} with ${transactions}.`,
    },
  ];
}

export default function Ledger({ loaderData }: Route.ComponentProps) {
  return <LedgerPage network={useNetwork()} data={loaderData} />;
}
