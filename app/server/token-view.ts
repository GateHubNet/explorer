// What the token pages show, worked out in the Worker from D6's answers (E11 spec 2 to 4): the list at `/{net}/tokens` (`tokensPage`) and one token's page at `/{net}/token/{token}`
// (`tokenPage` and its parts). No I/O, no clock, no `Intl`: each figure is D6's own text or made with BigNumber, so no float and no exponent reaches a label. The page draws what it is given and
// never fetches: every label and every href is text in the data.
//
// The list is one call (spec 2.3). A search of more than `TOKEN_SEARCH_MAX` characters is no call: `answer` is `null`, and the page is the form with its message, no list and no pager. An answer
// from before D6's first generation has no `totals`, no `total` and no ledger (`TokensResponse`): the tiles read dashes, and there is no note, no pager and no "Show all".
//
// The token page is #1 with up to six cards that stand or fail on their own (spec 3.5): the holders, the transfers, the pools and the issuer's settings, the last of which is read from the node
// when D6 has none. What the issuer controls (the toml's fields, its URLs, its domain) is text: it is shown without its bidi controls, and only an `https:` URL becomes a link (`linkOf`),
// never an image or an `src`.
//
// It value-imports `app/domain/token-params.ts` (the hrefs, `tokenLink`), which checks an issuer's checksum with `ripple-address-codec`: only the Worker, the scripts and the tests import this
// file; the page gets the data it returns, and its types.

import BigNumber from "bignumber.js";

import { ammListHref } from "../domain/amm-params";
import { apiAssetText, assetText, type Asset } from "../domain/asset";
import { compactNumber, decodesCurrency, formatAmount, formatChange, formatCurrency, formatPrice, formatUtcDay, shortAddress } from "../domain/format";
import { isLinkable, marketHref, naturalOrientation } from "../domain/market-pair";
import { shownIssuer, withoutBidiControls, type NamesPart, type NameView } from "../domain/names";
import { trailPaging, type Paging } from "../domain/paging";
import { poolLink } from "../domain/pool-link";
import { kindTabs, TOKEN_SEARCH_MAX, tokenHoldersHref, tokenHref, tokenLink, tokensHref, type TokenKind, type TokenPageParams, type TokensParams } from "../domain/token-params";
import type { MeterData } from "../ui/charts/types";
import type { SegmentLink } from "../ui/components/SegmentedLinks";
import type { NetworkInfo } from "../ui/networks";
import { httpsLink } from "./account-name-view";
import { accountFlags, type Loaded } from "./account-view";
import { componentsByPool, displayPair, poolVolume } from "./amm-view";
import type { AmmPool, AmmVolumeRow, IssuedTokenRow, IssuedTokensTotals, IssuerSettings, Page, TokenAnswer, TokenDetail, TokenHoldersResponse, TokenMarket, TokensResponse, TokenTransfersResponse } from "./api-types";
import { coverageNote, type CoverageNoteText } from "./coverage";
import { BN, feePercent } from "./exact";
import { networkInfoOf, type PublicNetwork } from "./network-route";
import type { NetworkId } from "./networks";
import type { AccountInfo } from "./node-rpc";
import { tomlFileOf } from "./toml-words";
import { unixOf } from "./validator-facts";

/** What the builders read of the network: its names and facts (`networkInfoOf`), whether it has an AMM (the words of the volume), and the switches (`tokenLink`). */
export type TokensNet = Pick<PublicNetwork, "id" | "kind" | "name" | "label" | "longName" | "dexName" | "native" | "software" | "hasAmm" | "features">;

/** What stands in a tile or a cell that has no value. */
const DASH = "—";

/** A whole number with its thousands grouped. */
const counted = (n: number): string => formatAmount(String(n));

/**
 * Only a code of 40 hex digits is long: the title of the code and the words only a screen reader reads give it in full, as the page cuts it (a hex that does not decode is shown as
 * its first digits). A code of 3 characters has neither.
 */
function hexOf(currency: string): { codeTitle?: string; codeHidden?: string } {
  return currency.length === 40 ? { codeTitle: currency, codeHidden: `currency code ${currency}` } : {};
}

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
  return {
    key: `${row.currency}.${row.issuer}`,
    rank: counted(row.rank),
    code: formatCurrency(row.currency),
    ...hexOf(row.currency),
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

// ---- One token (spec 3) -------------------------------------------------------------------------------------------------------------------------

/** The text of an issuer's field as a page shows it: without the bidi controls that would turn the words around it. An empty field, or one of controls alone, is none. */
const textOf = (value: string | undefined): string | undefined => (value === undefined ? undefined : withoutBidiControls(value) || undefined);

/**
 * What an issuer-controlled URL (`toml_url`, the toml's `icon` and `attestation`) may be as a link: its `https:` form as the URL parser reads it (`httpsLink`), with no user name or
 * password in it (a link whose text names one host and leads to another). Anything else, `javascript:`, `data:`, `http:`, a relative link, text that is no URL at all, is `null`: the page
 * shows it as text, never as an `href`, and no field of a token is ever an image's `src`.
 */
export function linkOf(url: string | undefined): string | null {
  const href = httpsLink(url);
  if (href === undefined) return null;
  const { username, password } = new URL(href);
  return username === "" && password === "" ? href : null;
}

/** A link's words: the URL without its scheme (`northpeak.example/attestations/2026-09.pdf`), cut to a length a line can hold. */
function linkWords(href: string): string {
  const words = href.replace(/^https:\/\//, "");
  return [...words].length > 90 ? `${[...words].slice(0, 89).join("")}…` : words;
}

/** `data.toml.name` as a heading: the toml's name without its bidi controls, if it has one. */
const nameOf = (t: TokenDetail): string | undefined => textOf(t.toml?.name);

/** The path D6 is asked for a token's routes on: `/v2/tokens/{currency}.{issuer}`, the currency as the ledger holds it. */
const tokenSource = (t: Pick<TokenDetail, "currency" | "issuer">): string => `/v2/tokens/${t.currency}.${t.issuer}`;

/** The parts of the page whose call can fail without the page (spec 3.5); the loader words them for its log. */
export type TokenPart = "holders" | "transfers" | "pools" | "ammVolume" | "accountInfo";

export interface TokenInput {
  net: TokensNet;
  asset: { currency: string; issuer: string };
  answer: TokenAnswer;
  /** `first`: the whole page. `older`: a page of transfers behind a marker, which is the header and the transfers only. */
  mode: "first" | "older";
  params: TokenPageParams;
  /** Null in the older mode. */
  holders: Loaded<TokenHoldersResponse> | null;
  transfers: Loaded<TokenTransfersResponse>;
  /** Null without an AMM (`hasAmm` false) and in the older mode. */
  pools: Loaded<Page<"pools", AmmPool>> | null;
  ammVolume: Loaded<Page<"rows", AmmVolumeRow>> | null;
  /** Asked only when the answer has no `issuer_settings` (spec 3.2 #7). */
  accountInfo: Loaded<AccountInfo> | null;
  names: NamesPart;
}

/**
 * What the tags of a token's page, and the link-preview image's card, read of it: the name, the code, the issuer, the two figures of the image's note, the domain that lists it, and where
 * the page is. The title and the description keep the short issuer (display names spec 7). `href` is the canonical path (`tokenHref`) and `segment` its last piece (`/og/{net}/token/{segment}.png`),
 * written here because the tags' module is a browser file and may not import `token-params.ts`.
 */
export interface TokenMetaFacts {
  /** The display code. */
  code: string;
  /** The toml's name, without bidi controls. */
  name?: string;
  issuer: string;
  /** The holders, with their thousands grouped. */
  holders: string;
  /** The supply in few characters (`compactNumber`). */
  supply: string;
  /** The domain whose toml lists the token; absent for a token that is not listed. */
  listedBy?: string;
  href: string;
  segment: string;
  /** A page of transfers behind a marker. */
  more: boolean;
}

/** The facts of a token's tags and image (`TokenMetaFacts`) from #1's token. */
export function tokenFacts(net: Pick<TokensNet, "id">, t: TokenDetail, more: boolean): TokenMetaFacts {
  const href = tokenHref(net.id, t);
  const name = nameOf(t);
  const domain = textOf(t.domain);
  return {
    code: formatCurrency(t.currency),
    ...(name === undefined ? {} : { name }),
    issuer: t.issuer,
    holders: counted(t.holders),
    supply: compactNumber(t.supply),
    ...(t.listed && domain !== undefined ? { listedBy: domain } : {}),
    href,
    segment: href.slice(href.lastIndexOf("/") + 1),
    more,
  };
}

/** The header card (spec 3.1). */
export interface TokenHeadView {
  /** The display code, in its coin and its tag. */
  code: string;
  /** A 40-digit code in full: the title of the tag, and what the hidden words say (`hexOf`); `hex` is what the copy button holds. */
  codeTitle?: string;
  codeHidden?: string;
  hex?: string;
  /** The `<h1>`: the toml's name, else the display code. */
  title: string;
  issuer: string;
  issuerHref: string;
  /** The button to the toml file (`xrp-ledger.toml`, `xahau.toml`): only when the token has a `toml_url` that is an `https:` link. */
  toml: { label: string; href: string } | null;
  source: string;
}

function headOf(net: TokensNet, t: TokenDetail, code: string): TokenHeadView {
  const href = linkOf(t.toml_url);
  return {
    code,
    ...hexOf(t.currency),
    ...(t.currency.length === 40 ? { hex: t.currency } : {}),
    title: nameOf(t) ?? code,
    issuer: t.issuer,
    issuerHref: `/${net.id}/account/${t.issuer}`,
    toml: href === null ? null : { label: tomlFileOf(net.software), href },
    source: tokenSource(t),
  };
}

// ---- The figures --------------------------------------------------------------------------------------------------------------------------------

/** The price's sub-line (spec 3.4): the change of the day with its sign, the day of the last trade, or the words of no price (`text` is empty for a price with neither). */
export type PriceSub = { kind: "change"; sign: 1 | -1 | 0; text: string } | { kind: "last"; text: string } | { kind: "none"; text: string };

/**
 * The price tile (spec 3.1 and 3.4): "{price} {native}" with a sub-line chosen by whether the answer has a `price_change`, as the spec says (D6 gives a change only from the day set; a
 * `price_time` of 2020 can come with one), else the UTC day of `price_time` ("last trade Oct 3"). A token with no price (it did not trade against the native currency in 30 days, or D6's was
 * unreadable and `checkToken` dropped it) is a dash and the words of that: `price_change` and `price_time` can remain after a dropped price, and are not read.
 */
export function priceView(t: TokenDetail, native: string): { value: string; sub: PriceSub } {
  if (t.price === undefined) return { value: DASH, sub: { kind: "none", text: `No trade against ${native} in 30 days` } };
  const value = `${formatPrice(t.price)} ${native}`;
  if (t.price_change !== undefined) {
    const change = formatChange(t.price_change);
    const sign = change === "0.00" ? 0 : change.startsWith("−") ? -1 : 1;
    return { value, sub: { kind: "change", sign, text: `${change}% in 24 h` } };
  }
  if (t.price_time !== undefined) return { value, sub: { kind: "last", text: `last trade ${formatUtcDay(t.price_time.slice(0, 10))}` } };
  return { value, sub: { kind: "none", text: "" } };
}

export interface TokenFigure {
  label: string;
  value: string;
  sub: string;
  /** The price's change, drawn as a tile's delta (the triangle is a picture; the text says the sign). */
  delta?: { text: string; sign: 1 | -1 | 0 };
}

/** The five tiles (spec 3.1), each figure exact: BigNumber for `trust_lines − holders`, D6's text for the rest. */
function figuresOf(net: TokensNet, t: TokenDetail, code: string): TokenFigure[] {
  const price = priceView(t, net.native);
  const zero = new BigNumber(t.trust_lines).minus(t.holders);
  const trades = t.trades;
  return [
    { label: "Supply", value: formatAmount(t.supply), sub: `${code}, the sum of all holders' balances` },
    { label: "Holders", value: counted(t.holders), sub: "accounts with a positive balance" },
    { label: "Trust lines", value: counted(t.trust_lines), sub: `${formatAmount(zero.toFixed())} of them with a zero balance` },
    {
      label: "Price",
      value: price.value,
      sub: price.sub.kind === "change" ? "" : price.sub.text,
      ...(price.sub.kind === "change" ? { delta: { text: price.sub.text, sign: price.sub.sign } } : {}),
    },
    {
      label: "Volume, 24 h",
      value: t.native_volume === undefined ? DASH : `${compactNumber(t.native_volume)} ${net.native}`,
      sub: trades === undefined ? "" : `${counted(trades)} ${trades === 1 ? "trade" : "trades"} on the ${net.hasAmm ? "DEX and AMM" : "DEX"}`,
    },
  ];
}

// ---- The toml card ------------------------------------------------------------------------------------------------------------------------------

/** A value of the toml card's list: text, a link (an `https:` URL), the issuer's account (an `AccountLink`), or the code in hex with its sentence. */
export type TomlValueView =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "account"; address: string }
  | { kind: "hex"; hex: string; note: string };

export interface TomlRowView {
  label: string;
  value: TomlValueView;
}

/** The three states of the card (spec 3.1): the token listed in its issuer's toml, a domain whose toml does not list it, or no domain at all. */
export type TomlCardView =
  | {
      state: "listed";
      title: string;
      /** "The `[[CURRENCIES]]` entry for {CODE} in {where}.": `where` is `{domain}/.well-known/{file}`, a link when the answer's `toml_url` is an `https:` URL. */
      entry: { code: string; where: { text: string; href: string | null } };
      /** The toml also lists the issuer, which makes its name verified: E9's view of the issuer is a verified name of this domain. */
      verified: boolean;
      rows: TomlRowView[];
    }
  | { state: "unlisted"; title: string; text: string }
  | { state: "no-domain"; title: string; text: string };

/** What the board says of a code that is not three letters. */
const HEX_NOTE = "Codes other than three letters are stored on the ledger as 40 hex characters.";

/** The fields of a toml entry that are URLs the issuer chose: each a link when it is an `https:` URL, else text. */
const URL_FIELDS = new Set(["icon", "attestation"]);
/** The fields of a token's toml entry, in D6's order (`TOKEN_TOML_KEYS`). */
const TOML_FIELDS = ["name", "desc", "icon", "symbol", "display_decimals", "asset_class", "asset_subclass", "attestation"] as const;

function tomlRows(t: TokenDetail, code: string): TomlRowView[] {
  const rows: TomlRowView[] = [
    { label: "code", value: { kind: "text", text: code } },
    { label: "issuer", value: { kind: "account", address: t.issuer } },
  ];
  for (const field of TOML_FIELDS) {
    const raw = t.toml?.[field];
    const text = typeof raw === "number" ? String(raw) : textOf(raw);
    if (text === undefined) continue;
    const href = URL_FIELDS.has(field) ? linkOf(text.trim()) : null;
    rows.push({ label: field, value: href === null ? { kind: "text", text } : { kind: "link", text: linkWords(href), href } });
  }
  if (t.currency.length === 40) rows.push({ label: "Currency code in hex", value: { kind: "hex", hex: t.currency, note: HEX_NOTE } });
  return rows;
}

/**
 * The toml card (spec 3.1). Listed: "From {domain}'s toml", the entry's rows in D6's order (`code`, `issuer`, then the fields it has: `icon` and `attestation` links when they are `https:` URLs,
 * everything else text, none an image) and, for a 40-digit code, its hex. `issuerName` is E9's view of the issuer: a verified name of this very domain adds the sentence that the toml also
 * lists the issuer. A domain whose toml has no entry, and a token with no domain, each say so.
 */
export function tomlCard(t: TokenDetail, net: Pick<TokensNet, "software">, issuerName: NameView | undefined): TomlCardView {
  const code = formatCurrency(t.currency);
  const domain = textOf(t.domain);
  if (domain === undefined) return { state: "no-domain", title: "The issuer's toml", text: `The issuer's account names no domain, so no toml describes ${code}.` };
  const title = `From ${domain}'s toml`;
  if (!t.listed) return { state: "unlisted", title, text: `${domain}'s toml has no [[CURRENCIES]] entry for ${code} by this issuer.` };
  const file = tomlFileOf(net.software);
  const verified = issuerName?.name?.kind === "verified" && issuerName.domain?.toLowerCase() === t.domain?.toLowerCase();
  return {
    state: "listed",
    title,
    entry: { code, where: { text: `${domain}/.well-known/${file}`, href: linkOf(t.toml_url) } },
    verified,
    rows: tomlRows(t, code),
  };
}

// ---- The issuer's settings ----------------------------------------------------------------------------------------------------------------------

export interface SettingRowView {
  id: "transfer-fee" | "global-freeze" | "no-freeze" | "clawback" | "require-auth" | "default-ripple";
  name: string;
  /** The word of the pill: "None", "0.2%", "On", "Off", "Set", "Not set", "Allowed", "Not allowed". */
  value: string;
  /** Whether the setting is in effect (a fee, a freeze, the right to claw back, ...): the row's icon is a check, else a minus. The word is in `value`. */
  on: boolean;
  sentence: string;
}

/** The six settings, whichever way they were read. `fee` is a percent, exact. */
interface Settings {
  fee: string;
  globalFreeze: boolean;
  noFreeze: boolean;
  clawback: boolean;
  requireAuth: boolean;
  defaultRipple: boolean;
}

/** An account's `TransferRate` as the fee it charges in percent, by D6's formula `(rate − 1e9) / 1e7`, exact: `1002000000` is `0.2`, none (or a rate below 1.0, which the ledger does not allow) is `0`. */
function transferFeeOf(rate: number | undefined): string {
  return rate === undefined || rate <= 1_000_000_000 ? "0" : new BN(rate).minus(1_000_000_000).shiftedBy(-7).toFixed();
}

/** Where the settings were read: D6's `issuer_settings`, or the node's account (its `Flags` and `TransferRate`, and the network whose flag table reads them). */
export type SettingsSource = { settings: IssuerSettings } | { flags: number; transferRate?: number; net: NetworkId };

function settingsOf(source: SettingsSource): Settings {
  if ("settings" in source) {
    const s = source.settings;
    return {
      fee: new BN(s.transfer_fee).toFixed(),
      globalFreeze: s.global_freeze,
      noFreeze: s.no_freeze,
      clawback: s.allow_trust_line_clawback,
      requireAuth: s.require_auth,
      defaultRipple: s.default_ripple,
    };
  }
  const ids = new Set(accountFlags(source.flags, source.net).map((flag) => flag.id));
  return {
    fee: transferFeeOf(source.transferRate),
    globalFreeze: ids.has("globalFreeze"),
    noFreeze: ids.has("noFreeze"),
    clawback: ids.has("allowClawback"),
    requireAuth: ids.has("requireAuth"),
    defaultRipple: ids.has("defaultRipple"),
  };
}

/**
 * The six rows of the issuer's settings card (spec 3.1, in the board's order), each with its pill word and its sentence about `code`. From D6's `issuer_settings` (`settings`), or from the
 * node's `account_info` of the issuer: the flags by the account page's table of the network (Xahau's clawback is 0x1000, the XRP Ledger's 0x80000000) and the `TransferRate` by D6's
 * formula (`fromNode`). `null` when there is neither.
 */
export function settingsRows(source: SettingsSource | null, code: string): { rows: SettingRowView[]; fromNode: boolean } | null {
  if (source === null) return null;
  const s = settingsOf(source);
  const free = new BN(s.fee).isZero();
  const row = (id: SettingRowView["id"], name: string, on: boolean, [yes, no]: readonly [string, string], [onSentence, offSentence]: readonly [string, string]): SettingRowView => ({
    id,
    name,
    value: on ? yes : no,
    on,
    sentence: on ? onSentence : offSentence,
  });
  return {
    fromNode: !("settings" in source),
    rows: [
      {
        id: "transfer-fee",
        name: "Transfer fee",
        value: free ? "None" : `${s.fee}%`,
        on: !free,
        sentence: free ? `Holders send ${code} to each other at no extra cost.` : `Sending ${code} from one holder to another costs ${s.fee}% on top of the amount.`,
      },
      row("global-freeze", "Global freeze", s.globalFreeze, ["On", "Off"], [`The issuer has frozen all of ${code}: holders can only send it back to the issuer.`, `${code} moves freely. The issuer has not frozen it for everyone.`]),
      row("no-freeze", "No freeze", s.noFreeze, ["Set", "Not set"], [`The issuer has given up the right to freeze: it can never freeze a holder's trust line, or all of ${code}.`, `The issuer has kept the right to freeze: it can still freeze one holder's trust line, or all of ${code}.`]),
      row("clawback", "Clawback", s.clawback, ["Allowed", "Not allowed"], [`The issuer can take ${code} back from a holder's trust line.`, `The issuer cannot take ${code} back from a holder.`]),
      row("require-auth", "Require auth", s.requireAuth, ["On", "Off"], [`The issuer must approve a trust line before its holder can hold ${code}.`, `Anyone can open a trust line and hold ${code}, without the issuer's approval.`]),
      row("default-ripple", "Default ripple", s.defaultRipple, ["On", "Off"], [`Holders can pay each other in ${code} through the issuer's account.`, `Holders cannot pay each other in ${code} through the issuer's account unless a trust line allows it.`]),
    ],
  };
}

/** The settings card: its rows (with where they were read from), or why there are none. `retry` is true when the node's call failed (a Retry asks again), false for an account the node does not have. */
export type SettingsCardView =
  | { state: "ok"; rows: SettingRowView[]; fromNode: boolean }
  | { state: "unread"; message: string; retry: boolean };

const SETTINGS_UNREAD = "The issuer's settings couldn't be read.";

function settingsCard(t: TokenDetail, net: TokensNet, code: string, info: Loaded<AccountInfo> | null): SettingsCardView {
  if (t.issuer_settings !== undefined) return { state: "ok", ...settingsRows({ settings: t.issuer_settings }, code)! };
  if (info?.state === "ok") {
    const { Flags, TransferRate } = info.value.account_data;
    return { state: "ok", ...settingsRows({ flags: Flags, ...(TransferRate === undefined ? {} : { transferRate: TransferRate }), net: net.id }, code)! };
  }
  return { state: "unread", message: SETTINGS_UNREAD, retry: info?.state === "failed" };
}

// ---- The markets --------------------------------------------------------------------------------------------------------------------------------

export interface MarketRowView {
  key: string;
  /** "{CODE} / {COUNTER}", always in this order: the natural orientation is for the href only. */
  pair: string;
  /** The counter's issuer, drawn as an `AccountLink`; absent for the native currency. */
  issuer?: string;
  /** The pair page, while the markets pages are on and the data API can be asked for the pair; else none. */
  href: string | null;
  last: string;
  volume: string;
  trades: string;
}

/** The pairs of the last 24 hours in D6's order (the biggest by native volume first): the last price in the counter currency per token, the volume in the native currency and the trades. */
export function marketRows(t: TokenDetail, net: TokensNet): MarketRowView[] {
  const code = formatCurrency(t.currency);
  const token: Asset = { currency: t.currency, issuer: t.issuer };
  return t.markets.map((market: TokenMarket) => {
    const counter: Asset = market.counter_issuer === undefined ? { currency: market.counter_currency } : { currency: market.counter_currency, issuer: market.counter_issuer };
    const counterCode = formatCurrency(market.counter_currency);
    const { base, counter: quote } = naturalOrientation(token, counter, net.native);
    return {
      key: `${market.counter_currency}.${market.counter_issuer ?? ""}`,
      pair: `${code} / ${counterCode}`,
      ...(market.counter_issuer === undefined ? {} : { issuer: market.counter_issuer }),
      href: net.features.markets && isLinkable([base, quote], net.native) ? marketHref(net.id, base, quote) : null,
      last: market.last === undefined ? DASH : `${formatPrice(market.last)} ${counterCode}`,
      volume: market.native_volume === undefined ? DASH : compactNumber(market.native_volume),
      trades: counted(market.count),
    };
  });
}

// ---- The pools ----------------------------------------------------------------------------------------------------------------------------------

export interface PoolRowView {
  key: string;
  /** The pair in E3's natural orientation, `XRP / RLUSD`. */
  pair: string;
  coins: [string, string];
  href: string;
  value: string;
  fee: string;
  volume: string;
}

/** The pools the card shows (the answer is ordered by value). */
const POOLS_SHOWN = 5;

/**
 * The pools card's rows (spec 3.1): the first five of the answer, each with its pair in the natural orientation, its pool's page (`poolLink`), its value in the native currency, its fee
 * (`300` is `0.300%`) and its 24 h volume joined from the live AMM volume by `amm_account` (`poolVolume`: "0" for a native pool with none, "—" otherwise or when `live` failed). `more` is
 * the list of all the pools with the token while the AMM pages are on and there are more than five; `volumeFailed` says the volume could not be had (the card says so).
 */
export function poolRows(
  pools: Page<"pools", AmmPool>,
  live: Loaded<Page<"rows", AmmVolumeRow>>,
  asset: { currency: string; issuer: string },
  net: TokensNet,
): { rows: PoolRowView[]; more: string | null; volumeFailed: boolean } {
  const row = live.state === "ok" ? live.value.rows?.[0] : undefined;
  const components = componentsByPool(row ?? null);
  const rows = pools.pools.slice(0, POOLS_SHOWN).map((pool): PoolRowView => {
    const shown = displayPair(
      pool.base_issuer === undefined ? { currency: pool.base_currency } : { currency: pool.base_currency, issuer: pool.base_issuer },
      pool.counter_issuer === undefined ? { currency: pool.counter_currency } : { currency: pool.counter_currency, issuer: pool.counter_issuer },
      net.native,
    );
    return {
      key: pool.amm_account,
      pair: shown.text,
      coins: [formatCurrency(shown.first.currency), formatCurrency(shown.second.currency)],
      href: poolLink(net.id, pool.amm_account, net.features),
      value: pool.value_native === undefined ? DASH : compactNumber(pool.value_native),
      fee: pool.trading_fee === undefined ? DASH : feePercent(pool.trading_fee),
      volume: poolVolume(components, pool, net.native),
    };
  });
  const many = pools.pools.length > POOLS_SHOWN || pools.marker !== undefined;
  return {
    rows,
    more: many && net.features.ammPages ? ammListHref(net.id, { asset: assetText(asset) }) : null,
    volumeFailed: components === null,
  };
}

// ---- The holders --------------------------------------------------------------------------------------------------------------------------------

export interface HolderRowView {
  key: string;
  rank: string;
  holder: string;
  /** In the token's code, exact. */
  balance: string;
  /** The share of the supply as a percent to 2 decimals: `11.73%`. */
  share: string;
  /** The share against the first row's, for the meter (decorative: the share is written beside it). */
  meter: MeterData;
  /** The holder's limit, exact. */
  limit: string;
  frozen: boolean;
  /** The issuer approved the line, and it requires approval: false when it does not (a line is authorized or not only where the issuer asks), and when that is not known. */
  authorized: boolean;
}

/** A share (6 decimals, `"0.117300"`) as a percent with 2 decimals, half up: `11.73%`. */
const percentOf = (share: BigNumber): string => `${share.times(100).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toFixed(2)}%`;

/**
 * The rows of a holders list (spec 3.1, 4), the largest balance first as D6 gives them. `share × 100` to 2 decimals; the meter against the first row's share; the "Frozen" mark and the limit;
 * `authorized` only where the issuer requires authorisation (`requireAuth` true: `null` is not known, and never shows "Authorized"). `top10` is the sentence about the first ten rows: "The top
 * 10 hold 39.15% of the supply." (their shares summed exactly), with fewer rows "The top 4 hold …", and none for no rows.
 */
export function holderRows(h: TokenHoldersResponse, code: string, { requireAuth }: { requireAuth: boolean | null }): { rows: HolderRowView[]; top10: string } {
  const first = h.holders[0]?.share ?? "0";
  const rows = h.holders.map(
    (row): HolderRowView => ({
      key: row.holder,
      rank: counted(row.rank),
      holder: row.holder,
      balance: formatAmount(row.balance),
      share: percentOf(new BN(row.share)),
      meter: { value: row.share, max: first, label: `${percentOf(new BN(row.share))} of the supply of ${code}` },
      limit: formatAmount(row.limit),
      frozen: row.frozen,
      authorized: requireAuth === true && row.authorized,
    }),
  );
  const top = h.holders.slice(0, 10);
  const sum = top.reduce((total, row) => total.plus(row.share), new BN(0));
  const who = top.length === 1 ? "The top holder holds" : `The top ${top.length} hold`;
  return { rows, top10: top.length === 0 ? "" : `${who} ${percentOf(sum)} of the supply.` };
}

// ---- The transfers ------------------------------------------------------------------------------------------------------------------------------

export interface TransferRowView {
  key: string;
  /** Unix seconds, for the time cell. */
  time: number;
  from: string;
  to: string;
  amount: string;
  /** "Issued" for a payment from the issuer (new tokens), "Redeemed" for one to it. */
  tag: "Issued" | "Redeemed" | null;
  hash: string;
}

/** The payments that delivered the token, newest first as D6 gives them: the time, the parties, the amount delivered and a tag for the issuer's side. */
export function transferRows(t: TokenTransfersResponse, issuer: string): TransferRowView[] {
  return t.transfers.map((row) => ({
    key: row.hash,
    time: unixOf(row.executed_time),
    from: row.source,
    to: row.destination,
    amount: formatAmount(row.amount),
    tag: row.source === issuer ? "Issued" : row.destination === issuer ? "Redeemed" : null,
    hash: row.hash,
  }));
}

// ---- The cards and the page ---------------------------------------------------------------------------------------------------------------------

/** A card that stands or fails: `what` is the phrase after "Couldn't load" ("the top holders"). */
export type CardView<T> = ({ state: "ok" } & T) | { state: "failed"; what: string };

export type MarketsCardView = { source: string; rows: MarketRowView[]; empty: string | null; footnote: string };
export type PoolsCardView = CardView<{ rows: PoolRowView[]; empty: string | null; more: { href: string; label: string } | null; note: string | null; footnote: string }> & { source: string };
export type HoldersCardView = CardView<{ rows: HolderRowView[]; empty: string | null; top10: string; all: { href: string; label: string } | null }> & { source: string };
export type TransfersCardView = CardView<{ rows: TransferRowView[]; empty: string | null; footnote: string; coverage: CoverageNoteText | null; pager: Paging }> & { title: string; source: string };

export interface TokenPageData {
  kind: "token";
  network: NetworkInfo;
  /** A page of transfers behind a marker: the header and the transfers only, with a way back. */
  older: boolean;
  head: TokenHeadView;
  /** The tiles, and (under them) the note of what the index does not hold of the trust lines; none behind a marker. */
  figures: TokenFigure[] | null;
  coverage: CoverageNoteText | null;
  toml: TomlCardView | null;
  settings: (SettingsCardView & { source: string; intro: string }) | null;
  markets: MarketsCardView | null;
  pools: PoolsCardView | null;
  /** Xahau's note in the pools' place. */
  ammNote: string | null;
  holders: HoldersCardView | null;
  transfers: TransfersCardView;
  back: { href: string; label: string } | null;
  names: NamesPart;
  meta: TokenMetaFacts;
}

const failed = (what: string): { state: "failed"; what: string } => ({ state: "failed", what });

function holdersCard(input: TokenInput, t: TokenDetail, code: string, problems: TokenPart[]): HoldersCardView | null {
  const { net, asset, holders } = input;
  if (holders === null) return null;
  const source = `${tokenSource(t)}/holders`;
  if (holders.state !== "ok") {
    problems.push("holders");
    return { source, ...failed("the top holders") };
  }
  const { rows, top10 } = holderRows(holders.value, code, { requireAuth: t.issuer_settings?.require_auth ?? null });
  return {
    source,
    state: "ok",
    rows,
    empty: rows.length === 0 ? `No account holds ${code}.` : null,
    top10,
    all: rows.length === 0 ? null : { href: tokenHoldersHref(net.id, asset), label: `All ${counted(t.holders)} holders →` },
  };
}

function poolsCard(input: TokenInput, t: TokenDetail, code: string, problems: TokenPart[]): PoolsCardView | null {
  const { net, asset, pools, ammVolume } = input;
  if (pools === null) return null;
  const source = `/v2/amm/pools?asset=${apiAssetText(asset)}`;
  const volume = ammVolume ?? ({ state: "failed" } as const);
  if (ammVolume !== null && ammVolume.state !== "ok") problems.push("ammVolume");
  if (pools.state !== "ok") {
    problems.push("pools");
    return { source, ...failed("the AMM pools") };
  }
  const { rows, more, volumeFailed } = poolRows(pools.value, volume, asset, net);
  return {
    source,
    state: "ok",
    rows,
    empty: rows.length === 0 ? `No AMM pool holds ${code}.` : null,
    more: more === null ? null : { href: more, label: `All pools with ${code} →` },
    note: volumeFailed ? "Couldn't load the 24-hour volume" : null,
    footnote: `Value and volume in ${net.native}.`,
  };
}

function transfersCard(input: TokenInput, t: TokenDetail, code: string, problems: TokenPart[]): TransfersCardView {
  const { net, asset, params, transfers, names, mode } = input;
  const title = mode === "older" ? "Older transfers" : "Recent transfers";
  const source = `${tokenSource(t)}/transfers`;
  if (transfers.state !== "ok") {
    problems.push("transfers");
    return { title, source, ...failed("the transfers") };
  }
  const answer = transfers.value;
  const rows = transferRows(answer, t.issuer);
  const issuer = shownIssuer(t.issuer, names.map);
  return {
    title,
    source,
    state: "ok",
    rows,
    empty: rows.length === 0 ? `No payment has delivered ${code} yet.` : null,
    footnote: `Newest first. A transfer from ${issuer} issues new ${code}; one to it redeems ${code}.`,
    coverage: coverageNote(answer.coverage, "transfers"),
    pager: trailPaging({ marker: params.marker, back: params.back, next: answer.marker }, (to) => tokenHref(net.id, asset, to)),
  };
}

/**
 * The page data of `/{net}/token/{token}` (spec 3.1 to 3.5) from #1 and the outcomes of the other calls, and the parts that failed (`problems`, in the page's order, for the loader to log
 * and to mark the request degraded with). The header and the figures are #1, which the loader has settled; each other card stands or fails on its own, a part that is not `ok` being its card's
 * `SectionError`. Behind a marker (`mode` "older") it is the header and the transfers only, with a link back to the first page; the cards that are not asked for are `null`.
 */
export function tokenPage(input: TokenInput): { page: TokenPageData; problems: Array<{ part: TokenPart }> } {
  const { net, asset, answer, names } = input;
  const t = answer.token;
  const older = input.mode === "older";
  const code = formatCurrency(t.currency);
  const parts: TokenPart[] = [];

  // The cards, top to bottom: the failed ones are noted in the page's order.
  const settings = older ? null : settingsCard(t, net, code, input.accountInfo);
  if (!older && t.issuer_settings === undefined && input.accountInfo?.state === "failed") parts.push("accountInfo");
  const pools = older || !net.hasAmm ? null : poolsCard(input, t, code, parts);
  const holders = older ? null : holdersCard(input, t, code, parts);
  const transfers = transfersCard(input, t, code, parts);
  // The order of the page: settings, pools, holders, transfers.
  const order: TokenPart[] = ["accountInfo", "pools", "ammVolume", "holders", "transfers"];
  const problems = order.filter((part) => parts.includes(part)).map((part) => ({ part }));

  const markets = marketRows(t, net);
  const dex = net.hasAmm ? "DEX and AMM" : "DEX";
  const page: TokenPageData = {
    kind: "token",
    network: networkInfoOf(net),
    older,
    head: headOf(net, t, code),
    figures: older ? null : figuresOf(net, t, code),
    coverage: older ? null : coverageNote(answer.coverage, "trust lines"),
    toml: older ? null : tomlCard(t, net, names.map[t.issuer]),
    settings:
      settings === null
        ? null
        : {
            ...settings,
            source: settings.state === "ok" && settings.fromNode ? "the network" : tokenSource(t),
            intro: `Set on the issuer's account. They apply to every holder of ${code}.`,
          },
    markets: older
      ? null
      : {
          source: `${tokenSource(t)} · last 24 h`,
          rows: markets,
          empty: markets.length === 0 ? `${code} had no trades in the last 24 hours.` : null,
          footnote: `Prices are the counter currency per ${code}. ${dex} trades of the last 24 hours.`,
        },
    pools,
    ammNote: older || net.hasAmm ? null : `${net.name} has no AMM, so ${code} trades only on the order book here.`,
    holders,
    transfers,
    back: older ? { href: tokenHref(net.id, asset), label: `Back to ${code}` } : null,
    names,
    meta: tokenFacts(net, t, older),
  };
  return { page, problems };
}
