import { forwardCacheClass } from "../server/edge-cache";
import { metaContext } from "../server/meta";
import { escrowMeta } from "../server/meta-escrow";
import { loadObjectPage } from "../server/object-load";
import { NamesProvider } from "../ui/names";
import { EscrowPage } from "../ui/pages/EscrowPage";

import type { Route } from "./+types/net.escrows.$id";

// The loader names a cache class (`live` for an escrow in the ledger, from the index or the node; `slow` for one that was removed; `MARKER_PAGE_CLASS` behind a marker), answers its 404s with
// class `short`, and redirects an ID in lower case to the upper-case URL (`immutable`) and the ID of a check or a channel to its page (`short`). A 503 and a degraded page are not stored.
export const headers = forwardCacheClass;

/** `/{net}/escrows/{ID}` (ledger object pages spec 1.2, 4.2): an escrow by its ID, from the index or the node. The loader is the three object pages' (`loadObjectPage`). */
export function loader({ request, params, context }: Route.LoaderArgs) {
  return loadObjectPage("escrow", { request, params, context });
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return escrowMeta(loaderData.meta, ctx);
}

export default function Escrow({ loaderData }: Route.ComponentProps) {
  return (
    <NamesProvider names={loaderData.names.map}>
      <EscrowPage data={loaderData} />
    </NamesProvider>
  );
}
