// What the token pages show, worked out in the Worker from D6's answers (E11 spec 2 to 4): the list at `/{net}/tokens` (`tokensPage`). No I/O, no clock, no `Intl`: each figure is D6's own
// text or made with BigNumber, so no float and no exponent reaches a label. The page draws what it is given and never fetches: every label and every href is text in the data.
//
// The list is one call (spec 2.3). A search of more than `TOKEN_SEARCH_MAX` characters is no call: `answer` is `null`, and the page is the form with its message, no list and no pager. An answer
// from before D6's first generation has no `totals`, no `total` and no ledger (`TokensResponse`): the tiles read dashes, and there is no note, no pager and no "Show all".
//
// It value-imports `app/domain/token-params.ts` (the hrefs, `tokenLink`), which checks an issuer's checksum with `ripple-address-codec`: only the Worker, the scripts and the tests import this
// file; the page gets the data it returns, and its types.

import { compactNumber, formatAmount, formatCurrency, formatPrice } from "../domain/format";
import { withoutBidiControls, type NamesPart } from "../domain/names";
import { trailPaging, type Paging } from "../domain/paging";
import { kindTabs, TOKEN_SEARCH_MAX, tokenLink, tokensHref, type TokenKind, type TokensParams } from "../domain/token-params";
import type { SegmentLink } from "../ui/components/SegmentedLinks";
import type { NetworkInfo } from "../ui/networks";
import type { IssuedTokenRow, IssuedTokensTotals, TokensResponse } from "./api-types";
import { coverageNote, type CoverageNoteText } from "./coverage";
import { networkInfoOf, type PublicNetwork } from "./network-route";

/** What the builders read of the network: its names and facts (`networkInfoOf`), whether it has an AMM (the words of the volume), and the switches (`tokenLink`). */
export type TokensNet = Pick<PublicNetwork, "id" | "kind" | "name" | "label" | "longName" | "dexName" | "native" | "software" | "hasAmm" | "features">;

/** What stands in a tile or a cell that has no value. */
const DASH = "—";

/** A whole number with its thousands grouped. */
const counted = (n: number): string => formatAmount(String(n));

/** The words of the pager: the list is ordered by holders, not by time. */
const PAGER_LABELS = { newer: "Previous", older: "More tokens" } as const;

/** The tokens with fewer holders than this are left out of the list unless it is asked for all of them (D6's `min_holders`, spec 2.3): the loader asks with it, the page says it. */
export const MIN_HOLDERS = 10;

// ---- The list -----------------------------------------------------------------------------------------------------------------------------------

/** A row of the table: every field is a string ready to show but `listed` and `href`, which is `null` for a code its own path would not read back as itself (text, no link). */
export interface IssuedRowView {
  /** `currency.issuer`: the row's own key. */
  key: string;
  /** The place in the whole ranking, whatever the page, with its thousands grouped. */
  rank: string;
  /** The display code (`formatCurrency`). */
  code: string;
  /** A 40-digit code in full: the title of the code, and what the hidden words say. */
  codeTitle?: string;
  codeHidden?: string;
  /** The toml's name, without bidi controls. */
  name?: string;
  href: string | null;
  issuer: string;
  holders: string;
  supply: string;
  price: string;
  volume: string;
  listed: boolean;
}

/** What the tags of the list read of the view (`meta-tokens.ts`): the search, if it was one that could be asked; all; a page behind a marker; a search that was too long. */
export interface TokensMetaFacts {
  q?: string;
  all: boolean;
  more: boolean;
  error: boolean;
}

export interface TokensInput {
  net: TokensNet;
  params: TokensParams;
  /** E14's seam: whether the MPT tab is a link (`mptAvailableOf`). */
  mptAvailable: boolean;
  /** D6's list; `null` when the search was too long and the list was not asked. */
  answer: TokensResponse | null;
  names: NamesPart;
}

export interface TokensPageData {
  kind: "tokens";
  network: NetworkInfo;
  tokenKind: TokenKind;
  tabs: SegmentLink[];
  intro: string;
  /** The data API path the list is made from. */
  source: string;
  tiles: Array<{ label: string; value: string; sub: string }>;
  search: { action: string; q: string; error: string | null; label: string; placeholder: string; hidden: Array<{ name: string; value: string }> };
  showAll: { href: string; label: string } | null;
  /** The issued tokens' table; `null` when the search was too long. */
  issued: { rows: IssuedRowView[]; empty: string | null; note: { text: string; more?: { text: string; href: string } } | null; footnote: string } | null;
  coverage: CoverageNoteText | null;
  pager: Paging & { labels: typeof PAGER_LABELS };
  names: NamesPart;
  meta: TokensMetaFacts;
}

/** The three tiles of the totals (spec 2.1). A total D6 does not have is a dash; the first tile's sub says what the rest of the tokens are, and has no words without the totals. */
function tilesOf(net: TokensNet, totals: IssuedTokensTotals | undefined): TokensPageData["tiles"] {
  const hidden = totals === undefined ? "" : `${counted(totals.tokens - totals.tokens_with_10_holders)} more have fewer than ${MIN_HOLDERS} holders`;
  return [
    { label: `Tokens with ${MIN_HOLDERS}+ holders`, value: totals === undefined ? DASH : counted(totals.tokens_with_10_holders), sub: hidden },
    { label: "Holders", value: totals?.holders === undefined ? DASH : counted(totals.holders), sub: "accounts holding at least one issued token" },
    {
      label: "Volume, 24 h",
      value: totals?.native_volume === undefined ? DASH : `${compactNumber(totals.native_volume)} ${net.native}`,
      sub: `${net.hasAmm ? "DEX and AMM" : "DEX"} trades of every pair`,
    },
  ];
}

/** A row of the table. The code's link is `tokenLink`'s: the token's page, or none for a code the page's path cannot name. */
function rowOf(net: TokensNet, row: IssuedTokenRow): IssuedRowView {
  const asset = { currency: row.currency, issuer: row.issuer };
  const name = row.name === undefined ? "" : withoutBidiControls(row.name);
  // Only a code of 40 hex digits is long: the title and the hidden words give it in full, as the table cuts it (a hex that does not decode is shown as its first digits).
  const hex = row.currency.length === 40;
  return {
    key: `${row.currency}.${row.issuer}`,
    rank: counted(row.rank),
    code: formatCurrency(row.currency),
    ...(hex ? { codeTitle: row.currency, codeHidden: `currency code ${row.currency}` } : {}),
    ...(name === "" ? {} : { name }),
    href: tokenLink(net.id, asset, net.features),
    issuer: row.issuer,
    holders: counted(row.holders),
    supply: compactNumber(row.supply),
    price: row.price === undefined ? DASH : formatPrice(row.price),
    volume: row.native_volume === undefined ? DASH : compactNumber(row.native_volume),
    listed: row.listed,
  };
}

/**
 * The note under the table: where the page stands in the list ("Showing 21–40 of 1,284 tokens with 10 or more holders"), or the matches of a search ("12 matches"), with the way to the matches
 * among the tokens with fewer holders when there are some. `null` without a total, and for an empty page that is not a search (the table says it is empty).
 */
function noteOf(net: TokensNet, params: TokensParams, answer: TokensResponse): NonNullable<TokensPageData["issued"]>["note"] {
  const { total, total_below: below, tokens } = answer;
  if (total === undefined) return null;
  if (params.q !== undefined) {
    const text = `${counted(total)} ${total === 1 ? "match" : "matches"}`;
    if (params.all || below === undefined || below === 0) return { text };
    return { text, more: { text: `${counted(below)} more among tokens with fewer than ${MIN_HOLDERS} holders`, href: tokensHref(net.id, { q: params.q, all: true }) } };
  }
  const first = tokens[0];
  const last = tokens.at(-1);
  if (first === undefined || last === undefined) return null;
  return { text: `Showing ${counted(first.rank)}–${counted(last.rank)} of ${counted(total)} tokens${params.all ? "" : ` with ${MIN_HOLDERS} or more holders`}` };
}

/** What an empty table says: no token matches the search; the tokens that are shown have none with 10 holders; or the index has none (before D6's first generation, say). */
function emptyOf(params: TokensParams, q: string | undefined, answer: TokensResponse): string {
  if (q !== undefined) return `No issued tokens match “${q}”.`;
  return !params.all && (answer.total_below ?? 0) > 0 ? `No issued tokens have ${MIN_HOLDERS} or more holders.` : "No issued tokens in the index yet.";
}

/** The link under the filters: the tokens with fewer holders, counted, or the way back from them. Without an answer to count by, the way back is all there is. */
function showAllOf(net: TokensNet, params: TokensParams, answer: TokensResponse | null): TokensPageData["showAll"] {
  if (params.all) return { href: tokensHref(net.id, { q: params.q }), label: `Hide tokens with fewer than ${MIN_HOLDERS} holders` };
  const hidden = answer?.total_below ?? 0;
  return hidden > 0 ? { href: tokensHref(net.id, { q: params.q, all: true }), label: `Show all (${counted(hidden)} hidden)` } : null;
}

/**
 * The page data of `/{net}/tokens` (spec 2.1): the head, the kind tabs, the three tiles, the search form and its link, and the table with its note, footnote, coverage and pager. `answer` is
 * D6's first call; `null` is the search of more than 64 characters, which is no call (spec 1.3). The links keep the search and `all`; a page behind a marker keeps the trail.
 */
export function tokensPage({ net, params, mptAvailable, answer, names }: TokensInput): TokensPageData {
  const tooLong = answer === null;
  // What the page repeats of the search in words and in the tags: without the controls that would turn the words around it, and not at all when it was too long to ask.
  const q = answer === null ? undefined : withoutBidiControls(params.q ?? "") || undefined;
  return {
    kind: "tokens",
    network: networkInfoOf(net),
    tokenKind: params.kind,
    tabs: kindTabs(net, params.kind, mptAvailable),
    intro: `Tokens on ${net.name}, ranked by holders. Names come from each issuer's toml.`,
    source: `/v2/tokens?kind=issued${params.all ? "" : `&min_holders=${MIN_HOLDERS}`}`,
    tiles: tilesOf(net, answer?.totals),
    search: {
      action: tokensHref(net.id),
      q: params.q ?? "",
      error: tooLong ? `Search for at most ${TOKEN_SEARCH_MAX} characters` : null,
      label: "Code, name or issuer",
      placeholder: "RLUSD, Ripple or rMxCK…",
      hidden: params.all ? [{ name: "all", value: "1" }] : [],
    },
    showAll: showAllOf(net, params, answer),
    issued:
      answer === null
        ? null
        : {
            rows: answer.tokens.map((row) => rowOf(net, row)),
            empty: answer.tokens.length === 0 ? emptyOf(params, q, answer) : null,
            note: noteOf(net, params, answer),
            footnote: `Holders: accounts with a positive balance. Supply: the sum of their balances. Price: the last trade against ${net.native}.`,
          },
    coverage: answer === null ? null : coverageNote(answer.coverage, "trust lines"),
    pager: {
      ...(answer === null
        ? { newerHref: null, olderHref: null }
        : trailPaging({ marker: params.marker, back: params.back, next: answer.marker }, (to) => tokensHref(net.id, { q: params.q, all: params.all, ...to }))),
      labels: PAGER_LABELS,
    },
    names,
    meta: { ...(q === undefined ? {} : { q }), all: params.all, more: params.marker !== undefined, error: tooLong },
  };
}
