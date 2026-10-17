// What a route under `/:net` can tell the layout about itself, through React Router's `handle` export:
//
//     export const handle = { heroSearch: true } satisfies NetworkRouteHandle;
//
// `heroSearch`: the page has a search box of its own (the home page's hero), so the header leaves its own out. The two
// would otherwise both answer the `/` key.

import type { UIMatch } from "react-router";

export interface NetworkRouteHandle {
  heroSearch?: boolean;
}

export function wantsHeroSearch(matches: readonly UIMatch[]): boolean {
  return matches.some((match) => (match.handle as NetworkRouteHandle | undefined)?.heroSearch === true);
}
