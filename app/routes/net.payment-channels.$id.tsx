import { forwardCacheClass } from "../server/edge-cache";
import { metaContext } from "../server/meta";
import { paymentChannelMeta } from "../server/meta-payment-channel";
import { loadObjectPage } from "../server/object-load";
import { NamesProvider } from "../ui/names";
import { PaymentChannelPage } from "../ui/pages/PaymentChannelPage";

import type { Route } from "./+types/net.payment-channels.$id";

// The loader names a cache class (`live` for a channel in the ledger, from the index or the node; `slow` for one that was removed; `MARKER_PAGE_CLASS` behind a marker), answers its 404s with
// class `short`, and redirects an ID in lower case to the upper-case URL (`immutable`) and the ID of an escrow or a check to its page (`short`). A 503 and a degraded page are not stored.
export const headers = forwardCacheClass;

/** `/{net}/payment-channels/{ID}` (ledger object pages spec 1.2, 4.4): a payment channel by its ID, from the index or the node. The loader is the three object pages' (`loadObjectPage`). */
export function loader({ request, params, context }: Route.LoaderArgs) {
  return loadObjectPage("payment-channel", { request, params, context });
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];
  return paymentChannelMeta(loaderData.meta, ctx);
}

export default function PaymentChannel({ loaderData }: Route.ComponentProps) {
  return (
    <NamesProvider names={loaderData.names.map}>
      <PaymentChannelPage data={loaderData} />
    </NamesProvider>
  );
}
