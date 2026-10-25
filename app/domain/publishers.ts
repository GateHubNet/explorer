// The words for the lists a default UNL is made of (sandbox spec 7.6). Most are publishers: a site whose list the data API fetches, named by its id (`vl.ripple.com`). Xahau
// Testnet's is the node's own fixed `[validators]` list, which the data API serves as the publisher `local`, with no site, no key and no expiration; its id means nothing to a
// visitor, so every place that shows a publisher says "Fixed list" or "the fixed list" for it. Pure: the Worker and the browser both import this file (the tags of a validator's
// page are made in the browser too, which may not import validator-facts.ts: it reads `ripple-address-codec`); validator-facts.ts re-exports these for the Worker's pages.

import { joinAnd } from "./time-words";

/** The id of the fixed list among the data API's publishers. */
export const LOCAL_PUBLISHER = "local";

/** What a publisher is called on a page: "Fixed list" for the fixed list, its id otherwise. */
export function publisherLabel(id: string): string {
  return id === LOCAL_PUBLISHER ? "Fixed list" : id;
}

/**
 * Who lists, as a phrase that completes "of those …" and "on the default UNL (…)": nothing for no list, `on the fixed list` for the fixed list alone, `listed by A and B` for
 * publishers, `listed by A and on the fixed list` for both (the fixed list always last, whatever its place in `ids`).
 */
export function listedByText(ids: readonly string[]): string {
  const published = ids.filter((id) => id !== LOCAL_PUBLISHER);
  const fixed = published.length < ids.length;
  if (published.length === 0) return fixed ? "on the fixed list" : "";
  return `listed by ${joinAnd(fixed ? [...published, "on the fixed list"] : published)}`;
}
