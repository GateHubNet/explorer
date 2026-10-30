// The token pages' views and the links to them (E11 spec 1.2 and 1.4): the list's query, the trail of a token's page and of its holders', the `{token}` segment of a
// path, and the one decision where a token's code leads. Pure, but it checks an issuer's checksum with `asset.ts` (`ripple-address-codec`), so it belongs to the Worker, the
// scripts and the tests: a browser file imports nothing of it, and the token pages draw the hrefs their view builders wrote, as the AMM pages do.
//
// One URL per view (E2 1.2, as amm-params.ts): `parseTokensParams` and `parseTokenPageParams` give the view a query names, and `tokensHref`, `tokenHref` and `tokenHoldersHref`
// write its canonical URL. A loader hands `{ path, search }` of those (`tokensHref(net)` and `tokensQuery(params)`, `tokenHref(net, asset)` and `tokenPageQuery(params)`) to E3's
// `redirectToCanonical`, which compares them with the request's `url.pathname` and `queryOf(request.url)` and answers a 302 when they differ. A query is written with its `?`
// (or is the empty text), the form `redirectToCanonical` takes and `parsePairParams`' `canonical` has. The canonical form drops defaults, unknown values, repeats and unknown
// parameters, and orders the rest as in the table of the spec. Every value is written with `queryValue`, so the query is what a URL parser leaves as it is once it is
// serialized: a redirect to it ends.
//
// A token is read from its path by `parseTokenPath`, with `parseAssetText`, and handed to the data API as the currency D6 itself gives back (`ledgerCurrencyOf` of D6's
// `currency-code.ts`, at its pin): a standard 3-character code as 3 upper-case characters, whatever way it was spelled (`usd`, the ledger's hex of `USD`), and every other
// currency as 40 upper-case hex digits, a text code hex-encoded (`RLUSD` is `524C…`). `checkToken` compares the answer's `currency` with it strictly. The one spelling in which
// `asset.ts` and D6 differ is a code with a pipe in it, and `parseTokenPath` leaves it unread (`holdsPipeCode`).

import type { SegmentLink } from "../ui/components/SegmentedLinks";
import type { Features } from "../ui/features";
import { assetText, parseAssetText, sameAsset, type Asset, type NativeCode } from "./asset";
import { parseTrail } from "./paging";
import { poolLink } from "./pool-link";
import { queryValue, trailPairs } from "./query-of";

/** The kinds of token the list can show, in the order of the kind tabs; the first is the default. `mpt` is E14's (`mptAvailableOf`). */
export const TOKEN_KINDS = ["issued", "mpt"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

const DEFAULT_KIND: TokenKind = "issued";

/** The longest search the list takes, as D6's `q`: the loader answers a longer one with the field's message and no call (`parseTokensParams` keeps it as it is). */
export const TOKEN_SEARCH_MAX = 64;

/** An AMM's LP token's currency, as D6's (`isLpCurrency`): 40 upper-case hex digits that start with 03. It is no token of D6's; its page is the pool's. */
export const LP_CURRENCY = /^03[0-9A-F]{38}$/;

/**
 * The list's view. `q` is the search, trimmed (the loader checks its length); `all` adds the tokens with fewer than 10 holders. `marker` is how a page was reached and `back`
 * the markers of the pages before it, nearest first.
 */
export interface TokensParams {
  kind: TokenKind;
  q?: string;
  all: boolean;
  marker?: string;
  back: readonly string[];
}

/** The trail of a token's page (its transfers) and of its holders' page. */
export interface TokenPageParams {
  marker?: string;
  back: readonly string[];
}

function isKind(value: string | null): value is TokenKind {
  return value !== null && (TOKEN_KINDS as readonly string[]).includes(value);
}

/** The trail of a query: the raw `marker` as it was given (the loader checks `isMarker` on it and answers a 404, before it compares the query), and `back` behind a marker only. */
function trailOf(search: URLSearchParams): TokenPageParams {
  const marker = search.get("marker") ?? undefined;
  return { ...(marker === undefined ? {} : { marker }), back: marker === undefined ? [] : parseTrail(search.get("back")) };
}

/** The pairs as a query with its `?`, or the empty text when there are none. */
function searchOf(pairs: readonly string[]): string {
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

/**
 * The view of the list a query names. Only the first value of a parameter is read; `kind` is exact (case counts) and is `mpt` only while `mptAvailable` (E14 makes it a view),
 * else issued; `q` is trimmed, and an empty one is none (a longer one than `TOKEN_SEARCH_MAX` is kept: the loader checks it); `all` is true only for `1`; `back` is the trail
 * `parseTrail` accepts, and only behind a marker, which is returned as it was given. Unknown parameters are dropped.
 */
export function parseTokensParams(search: URLSearchParams, o: { mptAvailable: boolean }): TokensParams {
  const kind = search.get("kind");
  const q = search.get("q")?.trim();
  return {
    kind: isKind(kind) && (kind !== "mpt" || o.mptAvailable) ? kind : DEFAULT_KIND,
    ...(q === undefined || q === "" ? {} : { q }),
    all: search.get("all") === "1",
    ...trailOf(search),
  };
}

/**
 * The canonical query of a view of the list, with its `?` (the empty text when it has none): `kind` (not the default), `q` (trimmed, when not empty), `all=1`, `marker` and
 * `back`, in that order. An absent `marker` is the first page, which is how `trailPaging` asks for it. A caller checks `isMarker` before it builds a link to a marker.
 */
export function tokensQuery(p: TokensParams): string {
  const pairs: string[] = [];
  if (p.kind !== DEFAULT_KIND) pairs.push(`kind=${p.kind}`);
  const q = p.q?.trim();
  if (q !== undefined && q !== "") pairs.push(`q=${queryValue(q)}`);
  if (p.all) pairs.push("all=1");
  pairs.push(...trailPairs(p.marker, p.back));
  return searchOf(pairs);
}

/** The link to the list: `/xrpl/tokens`, `/xrpl/tokens?q=USD&all=1`; the path, then the query of `tokensQuery`. */
export function tokensHref(net: string, p: Partial<TokensParams> = {}): string {
  return `/${net}/tokens${tokensQuery({ kind: p.kind ?? DEFAULT_KIND, q: p.q, all: p.all ?? false, marker: p.marker, back: p.back ?? [] })}`;
}

/** The view of a token's page, or of its holders', a query names: the marker as it was given, and the trail behind it. */
export function parseTokenPageParams(search: URLSearchParams): TokenPageParams {
  return trailOf(search);
}

/** The canonical query of a token's page or of its holders', with its `?` (the empty text on the first page): `marker`, then `back` behind it. */
export function tokenPageQuery(p: TokenPageParams): string {
  return searchOf(trailPairs(p.marker, p.back));
}

/** What a path's `{token}` segment names: a token of the network, an AMM's LP token (the issuer is its pool's account), the native currency, or nothing the explorer shows. */
export type TokenPath =
  | { kind: "token"; asset: { currency: string; issuer: string }; canonical: string }
  | { kind: "lp"; issuer: string }
  | { kind: "native" }
  | { kind: "none" };

/** 3 characters of D6's set for a standard code, a pipe among them (`asset.ts`'s set has no pipe: the API splits on it, and D6, which splits at the last separator, does not mind). */
const PIPE_CODE = /^(?=.*\|)[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3}$/;
/** The ledger's standard form of a 3-character code, in upper case: the code's 3 bytes are bytes 12 to 14, the rest zero. */
const STANDARD_FORM = /^0{24}([0-9A-F]{6})0{10}$/;

/**
 * Whether `currency` (40 upper-case hex digits) is the ledger's standard form of a code with a pipe in it. D6 reads that hex as the 3 characters and answers `A|B`, where
 * `asset.ts` keeps the hex, so `checkToken` would find the answer's currency not the one asked for. `parseTokenPath` leaves it unread, as `asset.ts` leaves the 3-character form.
 */
function holdsPipeCode(currency: string): boolean {
  const bytes = STANDARD_FORM.exec(currency)?.[1];
  if (bytes === undefined) return false;
  return PIPE_CODE.test(String.fromCharCode(...[0, 2, 4].map((at) => Number.parseInt(bytes.slice(at, at + 2), 16))));
}

/**
 * What the `{token}` segment `decoded` (a path segment, percent-decoded) names on `network`: `parseAssetText`'s reading (so `+`, `|` and a space are the separator, a code is
 * in any case, 40 hex digits are decoded) with its issuer's checksum checked. `token` has the asset as the data API has it (see the head of this file) and `canonical`, the
 * segment `tokenHref` writes (`assetText`: a loader redirects when the segment is another spelling); `lp` an LP token's currency and its pool's account; `native` the network's
 * own code alone. Anything else is `none`: an X-address, a bad checksum, a code alone, the native code with an issuer, a currency D6 would not read, an empty text.
 */
export function parseTokenPath(network: { native: NativeCode }, decoded: string): TokenPath {
  const asset = parseAssetText(decoded, network);
  if (asset === null) return { kind: "none" };
  if (asset.issuer === undefined) return { kind: "native" };
  if (LP_CURRENCY.test(asset.currency)) return { kind: "lp", issuer: asset.issuer };
  if (holdsPipeCode(asset.currency)) return { kind: "none" };
  return { kind: "token", asset: { currency: asset.currency, issuer: asset.issuer }, canonical: assetText(asset) };
}

/** A token's path: `/xrpl/token/RLUSD.rMxCK…`; the segment is `assetText`, escaped for a path (a text code can hold `#`, `/` or `?`). */
function tokenPath(net: string, asset: { currency: string; issuer: string }): string {
  return `/${net}/token/${encodeURIComponent(assetText(asset))}`;
}

/** The link to a token's page: its path, then the query of `tokenPageQuery` (the transfers' trail). The asset is one `parseTokenPath` has read. */
export function tokenHref(net: string, asset: { currency: string; issuer: string }, p: TokenPageParams = { back: [] }): string {
  return `${tokenPath(net, asset)}${tokenPageQuery(p)}`;
}

/** The link to a token's holders' page: `/xrpl/token/RLUSD.rMxCK…/holders`, then the query of `tokenPageQuery`. */
export function tokenHoldersHref(net: string, asset: { currency: string; issuer: string }, p: TokenPageParams = { back: [] }): string {
  return `${tokenPath(net, asset)}/holders${tokenPageQuery(p)}`;
}

/**
 * What `tokenLink` reads of the switches. `tokens` is the TOKENS switch's field, which joins `Features` with the switch itself (ui/features.ts); until it does it is an optional
 * field here, which a `Features` that has it satisfies.
 */
type TokenLinkFeatures = Features & { readonly tokens?: boolean };

/** The network's native code, from its id: Xahau's is XAH, any other's XRP (as `kindTabs` tells Xahau by its id). */
function nativeOf(net: string): NativeCode {
  return net === "xahau" ? "XAH" : "XRP";
}

/**
 * The one place that decides where a token's code leads: an AMM's LP token's pool (`poolLink`, with TOKENS on or off); else the token's page while `features.tokens`; else null,
 * and the code stays text. A link is made only for an asset its own path reads back as itself, so it never leads to a 404 or to another token: the native currency (no
 * issuer), an issuer that is no classic address, a currency not in the ledger's own form (`usd` would be `USD`) and a code `parseTokenPath` leaves unread are text.
 */
export function tokenLink(net: string, asset: Asset, features: TokenLinkFeatures): string | null {
  if (!asset.issuer) return null;
  const lp = LP_CURRENCY.test(asset.currency);
  if (!lp && features.tokens !== true) return null;
  const path = parseTokenPath({ native: nativeOf(net) }, assetText(asset));
  if (path.kind === "lp") return lp ? poolLink(net, path.issuer, features) : null;
  if (path.kind !== "token" || !sameAsset(path.asset, asset)) return null;
  return tokenHref(net, path.asset);
}

/** E14's seam: false here; E14 makes it `features.mpt && net.hasMpt`. */
export function mptAvailableOf(net: { id: string }, features: Features): boolean {
  return false;
}

/**
 * The kind tabs: "Issued tokens", a link, current for issued; and "MPT", a link when it is available and else a disabled segment, on Xahau with the note that its ledger has no
 * MPT, elsewhere with the tag "soon". A tab leads to the other kind's first page, with no filter.
 */
export function kindTabs(net: { id: string }, kind: TokenKind, mptAvailable: boolean): SegmentLink[] {
  const mpt = { label: "MPT", href: tokensHref(net.id, { kind: "mpt" }) };
  return [
    { label: "Issued tokens", href: tokensHref(net.id), current: kind === "issued" },
    mptAvailable
      ? { ...mpt, current: kind === "mpt" }
      : { ...mpt, current: false, disabled: net.id === "xahau" ? { note: "MPT isn't enabled on Xahau." } : { tag: "soon" } },
  ];
}
