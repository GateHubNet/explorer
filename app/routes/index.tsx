import { redirect } from "react-router";

import { readNetworkCookie } from "../server/network-route";

import type { Route } from "./+types/index";

/**
 * `/` has no page: it sends the visitor to the network they used last (the `net` cookie, written by the browser), or XRPL.
 * The answer depends on the cookie, so it is never stored (the Worker entry skips the cache for `/`), and says so.
 */
export function loader({ request }: Route.LoaderArgs) {
  const net = readNetworkCookie(request.headers.get("Cookie")) ?? "xrpl";
  return redirect(`/${net}`, { status: 302, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
}
