// The views of the network page and their URLs (spec 1.2): the two parameters, their canonical query, and the links and scopes made from
// them. Pure: the loader, the page and the links import this file, the browser included, so nothing here reaches the server at run time.

import type { NetworkId } from "../server/networks";
import type { WindowPeriod } from "./window";

/** What amounts are shown in: the network's native currency, or USD issued by GateHub (XRPL only). */
export type Display = "native" | "usd";
export interface NetworkParams {
  period: WindowPeriod;
  display: Display;
}

export const DEFAULT_NETWORK_PARAMS: NetworkParams = { period: "30d", display: "native" };

/** The period selector, in order: `id` is the `period` parameter. */
export const PERIODS: readonly { id: WindowPeriod; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "1 year" },
];

/** The issuer of the USD that `in=usd` converts to: one of the markets the data API tracks against XRP. */
export const USD_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";

const DISPLAYS = { xrpl: ["native", "usd"], xahau: ["native"] } as const satisfies Record<NetworkId, readonly Display[]>;

/** The currencies a network's amounts can be shown in, the native one first. The Xahau markets have no USD (spec 3). */
export function displaysOf(net: NetworkId): readonly Display[] {
  return DISPLAYS[net];
}

/**
 * The raw query of a URL, without the `?`, and without the pairs React Router adds to a data request (`_routes=…`). Left as it came
 * otherwise, so that a query that is not canonical (`period=1y&`, `period=%37d`) stays different from `parseNetworkParams`' answer.
 */
export function queryOf(url: string): string {
  const start = url.indexOf("?");
  if (start < 0) return "";
  const hash = url.indexOf("#", start);
  const query = url.slice(start + 1, hash < 0 ? undefined : hash);
  return query
    .split("&")
    .filter((pair) => pair.split("=", 1)[0] !== "_routes")
    .join("&");
}

/** The query of a view: what is not the default, `period` then `in`. `in` is `usd` where the network has it. */
function canonicalOf(net: NetworkId, params: Partial<NetworkParams>): string {
  const pairs: string[] = [];
  if (params.period !== undefined && params.period !== DEFAULT_NETWORK_PARAMS.period && PERIODS.some(({ id }) => id === params.period)) {
    pairs.push(`period=${params.period}`);
  }
  if (params.display === "usd" && displaysOf(net).includes("usd")) pairs.push("in=usd");
  return pairs.join("&");
}

/**
 * The view a query names, and its canonical query. Only the first value of `period` and of `in` is read; a value that is not one of the
 * table's (case counts), a default, a repeat and any other parameter are dropped. The loader answers a 302 to the canonical URL when
 * `queryOf(request.url)` is not exactly `canonical`.
 */
export function parseNetworkParams(query: string, net: NetworkId): { params: NetworkParams; canonical: string } {
  const search = new URLSearchParams(query);
  const period = PERIODS.find(({ id }) => id === search.get("period"))?.id ?? DEFAULT_NETWORK_PARAMS.period;
  const display: Display = search.get("in") === "usd" && displaysOf(net).includes("usd") ? "usd" : "native";
  const params: NetworkParams = { period, display };
  return { params, canonical: canonicalOf(net, params) };
}

/** The link to a view: `/xrpl/network`, `/xrpl/network?period=1y&in=usd`. A parameter that is left out is the default's. */
export function networkHref(net: NetworkId, params: Partial<NetworkParams>): string {
  const canonical = canonicalOf(net, params);
  return `/${net}/network${canonical ? `?${canonical}` : ""}`;
}

/** The scope of a view for the live page (`OnScreen`): the network and the canonical query, so that a refresh of another view never stands in for it. */
export function networkScope(net: NetworkId, params: NetworkParams): string {
  const canonical = canonicalOf(net, params);
  return canonical ? `${net}?${canonical}` : net;
}
