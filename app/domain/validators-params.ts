// The validators list's view and the links to the validators pages (spec 1.4). Pure and safe for the browser: the loader, the view builder
// and the pages import this file, so it imports no codec and nothing of the server. Its only value import is amendment-ref.ts.
//
// One URL per view: `parseValidatorsParams` gives the view a query names (the part that needs no data), and the loader answers a 302 to
// `validatorsHref` of it when the request's query is not exactly that. The parts that need data (a publisher id as S spells it, an
// amendment as A names it) are `canonicalValidatorsParams`, once S and A have answered. The canonical form drops the default, empty and
// unknown values, repeats (the first is read) and unknown parameters, and orders the rest as `scope`, `publisher`, `amendment`, `q`.

import { amendmentSegment, parseAmendmentRef } from "./amendment-ref";
import type { AmendmentStatus } from "./amendments-params";

/** The UNL's validators, or every validator the data API has seen. */
export type ValidatorScope = "unl" | "all";

/** The list's view. `publisher` is a publisher id of S; `amendment` is the name as A writes it, or the upper-case ID of one with no name. */
export interface ValidatorsParams {
  scope: ValidatorScope;
  publisher?: string;
  amendment?: string;
  q?: string;
}

/** The longest search text: D1's limit, in characters (code points). */
export const SEARCH_MAX = 100;

/**
 * The statuses of the amendments that "Votes yes for" lists: the ones being voted on, and `unknown`, which validators vote for and A does not name. A status a newer D1
 * sends is none of them: this build cannot say the amendment is being voted on, so it is not offered, and a `?amendment=` that names it is dropped.
 */
const VOTED_ON: readonly string[] = ["majority", "voting", "unknown"] satisfies readonly AmendmentStatus[];

/** The first `count` characters of a text: code points, so that a surrogate pair is never cut in two. */
function firstCharacters(text: string, count: number): string {
  if (text.length <= count) return text; // at most `count` UTF-16 units: at most `count` characters
  let end = 0;
  let seen = 0;
  for (const character of text) {
    if (seen === count) break;
    end += character.length;
    seen += 1;
  }
  return text.slice(0, end);
}

/** The pure rules, for what a query holds and for what a caller gives `validatorsHref`: nothing else in this file decides what a value is. */
function tidy(raw: { scope?: string | null; publisher?: string | null; amendment?: string | null; q?: string | null }): ValidatorsParams {
  const params: ValidatorsParams = { scope: raw.scope?.toLowerCase() === "all" ? "all" : "unl" };
  if (raw.publisher) params.publisher = raw.publisher;
  if (raw.amendment) {
    const ref = parseAmendmentRef(raw.amendment);
    if (ref !== null) params.amendment = "id" in ref ? ref.id : ref.name;
  }
  // Trimmed, cut, and trimmed again: a cut that ends after a space would otherwise be a text that does not survive a second pass.
  const q = raw.q === undefined || raw.q === null ? "" : firstCharacters(raw.q.trim(), SEARCH_MAX).trimEnd();
  if (q !== "") params.q = q;
  return params;
}

/**
 * The view a query names (with or without its `?`), as far as it can be known without data: `scope` in any case, `q` trimmed and cut,
 * `amendment` as a name or an upper-case ID, and the rest dropped. Only the first value of a parameter is read.
 */
export function parseValidatorsParams(search: string): ValidatorsParams {
  const query = new URLSearchParams(search);
  return tidy({ scope: query.get("scope"), publisher: query.get("publisher"), amendment: query.get("amendment"), q: query.get("q") });
}

/** The canonical URL of a view (the pure rules applied to `params`). The default view has no query. A space is written `+`. */
export function validatorsHref(net: string, params: ValidatorsParams): string {
  const { scope, publisher, amendment, q } = tidy(params);
  const query = new URLSearchParams();
  if (scope === "all") query.set("scope", scope);
  if (publisher !== undefined) query.set("publisher", publisher);
  if (amendment !== undefined) query.set("amendment", amendment);
  if (q !== undefined) query.set("q", q);
  const text = query.toString();
  return `/${net}/validators${text !== "" ? `?${text}` : ""}`;
}

/**
 * The view once S and A have answered. `publisher` becomes S's spelling of the id it names (exactly, else without regard to case),
 * and is dropped if S has no such id. `amendment` must name a row of status `majority`, `voting` or `unknown`: an ID exactly, a name
 * exactly else without regard to case when that is unique; it becomes `amendmentSegment(row)`, and is dropped otherwise. A list that
 * is `null` (the call failed) keeps its parameter as given, and the page applies it as given.
 */
export function canonicalValidatorsParams(
  params: ValidatorsParams,
  known: {
    publishers: readonly string[] | null;
    amendments: readonly { id: string; name?: string; status: string }[] | null;
  },
): ValidatorsParams {
  const { scope, publisher, amendment, q } = tidy(params);
  const result: ValidatorsParams = { scope };
  if (publisher !== undefined) {
    const spelling = known.publishers === null ? publisher : publisherOf(publisher, known.publishers);
    if (spelling !== undefined) result.publisher = spelling;
  }
  if (amendment !== undefined) {
    const segment = known.amendments === null ? amendment : segmentOf(amendment, known.amendments);
    if (segment !== undefined) result.amendment = segment;
  }
  if (q !== undefined) result.q = q;
  return result;
}

/** S's spelling of the publisher id a text names: the id exactly, else the one that differs only in case (the first, if several do). */
function publisherOf(publisher: string, ids: readonly string[]): string | undefined {
  const lower = publisher.toLowerCase();
  return ids.find((id) => id === publisher) ?? ids.find((id) => id.toLowerCase() === lower);
}

/**
 * The path segment of the amendment that `amendment` (an upper-case ID or a name, after the pure rules) names among the rows of a status
 * "Votes yes for" lists: the ID exactly, the name exactly, else the one name that matches without regard to case.
 */
function segmentOf(amendment: string, rows: readonly { id: string; name?: string; status: string }[]): string | undefined {
  const candidates = rows.filter((row) => VOTED_ON.includes(row.status));
  const lower = amendment.toLowerCase();
  const alike = candidates.filter((row) => row.name?.toLowerCase() === lower);
  const row =
    candidates.find((candidate) => candidate.id === amendment) ??
    candidates.find((candidate) => candidate.name === amendment) ??
    (alike.length === 1 ? alike[0] : undefined);
  return row === undefined ? undefined : amendmentSegment(row);
}

/**
 * The URL of a validator's page, or of a page of its older validations. As on the account page, `marker` is how the page was reached
 * and `back` the markers of the pages newer than it, nearest first, joined by dots (the format of paging.ts' `parseTrail`); `back`
 * means nothing without a `marker` and is dropped.
 */
export function validatorHref(net: string, key: string, page: { marker?: string; back?: readonly string[] } = {}): string {
  const query: string[] = [];
  if (page.marker) query.push(`marker=${encodeURIComponent(page.marker)}`);
  if (page.marker && page.back && page.back.length > 0) query.push(`back=${page.back.map(encodeURIComponent).join(".")}`);
  return `/${net}/validators/${encodeURIComponent(key)}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}
