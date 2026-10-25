// The words for the lists a default UNL is made of (sandbox spec 7.6). Most are publishers: a site whose list the data API fetches, named by its id (`vl.ripple.com`). Xahau
// Testnet's is the node's own fixed `[validators]` list, which the data API serves as the publisher `local`, with no site, no key and no expiration; its id means nothing to a
// visitor, so every place that shows a publisher says "Fixed list" or "the fixed list" for it. Pure: the Worker and the browser both import this file (the pages draw these words in the browser, and the tags of a validator's
// page are made there too; neither may import validator-facts.ts, which reads `ripple-address-codec`); validator-facts.ts re-exports them for the Worker's view builders.

import { joinAnd } from "./time-words";

/** The id of the fixed list among the data API's publishers. */
export const LOCAL_PUBLISHER = "local";

/** What a publisher is called on a page: "Fixed list" for the fixed list, its id otherwise. */
export function publisherLabel(id: string): string {
  return id === LOCAL_PUBLISHER ? "Fixed list" : id;
}

/** The ids of the publishers that publish a list, and whether the fixed list is among `ids`. */
function split(ids: readonly string[]): { published: string[]; fixed: boolean } {
  const published = ids.filter((id) => id !== LOCAL_PUBLISHER);
  return { published, fixed: published.length < ids.length };
}

/** The lists as names in a sentence: the publishers' ids, then `the fixed list` (always last, whatever its place in `ids`). */
function names(ids: readonly string[]): string[] {
  const { published, fixed } = split(ids);
  return fixed ? [...published, "the fixed list"] : published;
}

/**
 * Who lists, as a phrase that completes "of those …" and "on the default UNL (…)": nothing for no list, `on the fixed list` for the fixed list alone, `listed by A and B` for
 * publishers, `listed by A and on the fixed list` for both (the fixed list always last, whatever its place in `ids`).
 */
export function listedByText(ids: readonly string[]): string {
  const { published, fixed } = split(ids);
  if (published.length === 0) return fixed ? "on the fixed list" : "";
  return `listed by ${joinAnd(fixed ? [...published, "on the fixed list"] : published)}`;
}

/** Which lists a tally is on, at the end of a sentence: `on A and B`, `on the fixed list`, `on A and the fixed list`; nothing for no list. */
export function onListsText(ids: readonly string[]): string {
  const named = names(ids);
  return named.length === 0 ? "" : `on ${joinAnd(named)}`;
}

/** The words of the UNL tag, for a screen reader and for the mouse: `Listed by A and B`, `Listed by the fixed list`, `Listed by A and the fixed list`; nothing for no list. */
export function unlTagWords(ids: readonly string[]): string {
  const named = names(ids);
  return named.length === 0 ? "" : `Listed by ${joinAnd(named)}`;
}
