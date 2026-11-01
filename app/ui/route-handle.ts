// What a route under `/:net` can tell the layout about itself, through React Router's `handle` export:
//
//     export const handle = { heroSearch: true } satisfies NetworkRouteHandle;
//     export const handle = { navSection: "network", navPage: "supply" } satisfies NetworkRouteHandle;
//
// `heroSearch`: the page has a search box of its own (the home page's hero), so the header leaves its own out. The two
// would otherwise both answer the `/` key.
//
// `navSection`: the section of the header the page belongs to. The header marks that section's item as the current one
// (`navSectionOf`). It is the only thing that does: no path prefix, no prop.
//
// `navPage`: the item of a header menu the page belongs to (the Network menu's Overview, Validators, Amendments or Supply), the deepest match that names one
// (`navPageOf`). A menu item is current on a page that names it, "page" on its own path and "true" on a page under it. Like the section, it is a route's word, not the path's.

import type { UIMatch } from "react-router";

/** The sections of the header. Each sub-project that adds a header item with a page of its own widens it. */
export type NavSection = "network" | "markets" | "amm" | "nfts" | "tokens";

/** The pages of the Network menu: its items, as a route names them. */
export type NavPage = "overview" | "validators" | "amendments" | "supply";

export interface NetworkRouteHandle {
  heroSearch?: boolean;
  navSection?: NavSection;
  navPage?: NavPage;
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

/** The `navPage` of the deepest match that names one, or `undefined` where none does. */
export function navPageOf(matches: readonly UIMatch[]): NavPage | undefined {
  for (let i = matches.length - 1; i >= 0; i--) {
    const page = (matches[i]!.handle as NetworkRouteHandle | undefined)?.navPage;
    if (page) return page;
  }
  return undefined;
}
