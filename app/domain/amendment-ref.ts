// The amendments a page can be addressed by (spec 1.3): a name or a 64-digit ID. Pure and safe for the browser (no imports): the loaders
// parse the path segment with it and the pages write their links with `amendmentSegment`.

/** Every name of rippled's and xahaud's feature lists has this form (`fix1201`, `NonFungibleTokensV1_1`, `fix240819`). */
export const AMENDMENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** An amendment's ID: 64 hex digits, any case. */
const AMENDMENT_ID = /^[0-9A-F]{64}$/i;

/** What a path segment (or a query value) names: an ID in upper case, or a name in the case it was typed. */
export type AmendmentRef = { id: string } | { name: string };

/**
 * The amendment a text names, or `null`. Hex is tested first: an ID that starts with a letter also matches the name pattern.
 * D1 takes a name exactly, else case-insensitively when that is unique; which of them it is, is for the data to say.
 */
export function parseAmendmentRef(raw: string): AmendmentRef | null {
  if (AMENDMENT_ID.test(raw)) return { id: raw.toUpperCase() };
  return AMENDMENT_NAME.test(raw) ? { name: raw } : null;
}

/** The path segment of an amendment's canonical URL: its name as D1 writes it, else its ID (which D1 writes in upper case). */
export function amendmentSegment(row: { id: string; name?: string }): string {
  return row.name ?? row.id;
}
