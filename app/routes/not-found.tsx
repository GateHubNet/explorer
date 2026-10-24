import { cached, forwardCacheClass } from "../server/edge-cache";
import { isNetworkId } from "../server/networks";
import { PRODUCT_NAME } from "../ui/brand";
import { Shell } from "../ui/components/Shell";
import { networkKindOf } from "../ui/environment";
import { DEFAULT_NETWORK_ID, findNetwork } from "../ui/networks";
import { NotFoundPage } from "../ui/pages/NotFoundPage";
import { useEnvironment } from "../ui/use-network";

import type { Route } from "./+types/not-found";

export const headers = forwardCacheClass;

const MAX_SHOWN = 200;

/** A path no route matches: a 404 of class short. Under a real network (`/xahau/nothing`) the page keeps that network. */
export function loader({ request }: Route.LoaderArgs) {
  const { pathname } = new URL(request.url);
  const first = pathname.split("/")[1] ?? "";
  const path = pathname.length > MAX_SHOWN ? `${pathname.slice(0, MAX_SHOWN)}…` : pathname;
  return cached({ path, net: isNetworkId(first) ? first : DEFAULT_NETWORK_ID }, "short", { status: 404 });
}

export function meta() {
  return [{ title: `Page not found · ${PRODUCT_NAME}` }, { name: "robots", content: "noindex" }];
}

export default function NotFound({ loaderData }: Route.ComponentProps) {
  // The names are the environment's: this route has no `/:net` data either.
  const net = findNetwork(loaderData.net, networkKindOf(useEnvironment()));
  return (
    <Shell net={net}>
      <NotFoundPage net={net} title="Page not found" message={`There is no page at ${loaderData.path}.`} />
    </Shell>
  );
}
