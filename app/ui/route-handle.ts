// What a route under `/:net` can tell the layout about itself, through React Router's `handle` export:
//
//     export const handle = { heroSearch: true } satisfies NetworkRouteHandle;
//     export const handle = { navSection: "network" } satisfies NetworkRouteHandle;
//
// `heroSearch`: the page has a search box of its own (the home page's hero), so the header leaves its own out. The two
// would otherwise both answer the `/` key.
//
// `navSection`: the section of the header the page belongs to. The header marks that section's item as the current one
// (`navSectionOf`). It is the only thing that does: no path prefix, no prop.

import type { UIMatch } from "react-router";

/** The sections of the header. Each sub-project that adds a header item with a page of its own widens it. */
export type NavSection = "network";

export interface NetworkRouteHandle {
  heroSearch?: boolean;
  navSection?: NavSection;
}

export function wantsHeroSearch(matches: readonly UIMatch[]): boolean {
  return matches.some((match) => (match.handle as NetworkRouteHandle | undefined)?.heroSearch === true);
}

/** The `navSection` of the deepest match that names one, or `undefined` where none does. */
export function navSectionOf(matches: readonly UIMatch[]): NavSection | undefined {
  for (let i = matches.length - 1; i >= 0; i--) {
    const section = (matches[i]!.handle as NetworkRouteHandle | undefined)?.navSection;
    if (section) return section;
  }
  return undefined;
}
