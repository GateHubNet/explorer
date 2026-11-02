// What makes a token of the fixtures (scripts/token-fixtures.ts) one of the cases the token pages draw: a predicate per case over the fixture files' data, never a table of tokens, so a
// change of the generator's seeds moves nothing here. Pure, no file reading and nothing but types from api-types.ts, for Node, the Workers runtime and the end-to-end suite alike:
// test/support/token-cases.ts finds the cases in the fixture files with these rules for the worker specs, test/unit/token-fixtures.test.ts checks with the same rules that the generator
// writes every case, and the end-to-end suite reads the files with `fs` and hands them to the same `tokenSourcesOf`. "First" is the first by file name of those the rule takes.
//
//   rlusd            a listed token whose code is RLUSD, clawback allowed, with markets against the native currency and against an issued one
//   usd              a token whose currency is the 3 characters USD, with a transfer fee of 0.2%, not listed
//   lions            a token whose code is LIONS, with no domain and no `issuer_settings` (the node's `account_info` serves them)
//   few-holders      a token with fewer than 10 holders that has a page
//   lp               the XRP/RLUSD pool's LP token, from the pools: its `lp_currency` and its account as the issuer (D6 knows no such token, and the page redirects to the pool)
//   evr              a listed token whose code is EVR, with a price (asked of Xahau)
//   xahau-unlisted   a token that is not listed (asked of Xahau)

import type { AmmPool, TokenAnswer, TokenDetail, TokenHoldersResponse, TokensResponse, TokenTransfersResponse } from "../../app/server/api-types";

export const TOKEN_CASES = ["rlusd", "usd", "lions", "few-holders", "lp", "evr", "xahau-unlisted"] as const;
export type TokenCase = (typeof TOKEN_CASES)[number];

/** The network each case is of. */
export const TOKEN_CASE_NET: Readonly<Record<TokenCase, "xrpl" | "xahau">> = {
  rlusd: "xrpl",
  usd: "xrpl",
  lions: "xrpl",
  "few-holders": "xrpl",
  lp: "xrpl",
  evr: "xahau",
  "xahau-unlisted": "xahau",
};

/** What a case is: the token as the ledger holds it, and its canonical URL segment. */
export interface TokenCaseResult {
  currency: string;
  issuer: string;
  path: string;
}

/** A first page of a list that goes on: the token's URL segment and the marker of its second page. */
export interface TokenMarkerResult {
  token: string;
  marker: string;
}

/** The fixture files' data the rules read, of one network. */
export interface TokenSources {
  /** `data-api/tokens/<CUR>.<issuer>.json`, by file name. */
  details: readonly TokenDetail[];
  /** `…/holders@limit=50.json`, by the token's `<CUR>.<issuer>`, by file name. */
  holders: ReadonlyMap<string, TokenHoldersResponse>;
  /** `…/transfers@descending=true&limit=20.json`, by the token's `<CUR>.<issuer>`, by file name. */
  transfers: ReadonlyMap<string, TokenTransfersResponse>;
  /** `data-api/tokens@kind=issued&limit=20&min_holders=10.json`: the list's first page. */
  list?: TokensResponse;
  /** The pools of `data-api/amm/pools@asset=…&limit=20.json`: the live pools of a filter. */
  pools: readonly AmmPool[];
}

const DETAIL = /^tokens\/([^/]+)\.json$/;
const HOLDERS = /^tokens\/([^/]+)\/holders@limit=50\.json$/;
const TRANSFERS = /^tokens\/([^/]+)\/transfers@descending=true&limit=20\.json$/;
const LIST = /^tokens@kind=issued&limit=20&min_holders=10\.json$/;
const POOLS = /^amm\/pools@asset=[^&]+&limit=20\.json$/;

/** Whether a reader must hand `tokenSourcesOf` this file (a path below `<net>/data-api/`). */
export const isTokenSource = (path: string): boolean => [DETAIL, HOLDERS, TRANSFERS, LIST, POOLS].some((pattern) => pattern.test(path));

/** What the rules read, from a network's files: each a path below `<net>/data-api/` and its text. Files `isTokenSource` does not take are left alone, and the order they come in is no difference. */
export function tokenSourcesOf(files: Iterable<readonly [path: string, text: string]>): TokenSources {
  const details: TokenDetail[] = [];
  const holders = new Map<string, TokenHoldersResponse>();
  const transfers = new Map<string, TokenTransfersResponse>();
  const pools: AmmPool[] = [];
  let list: TokensResponse | undefined;
  for (const [path, text] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    let match: RegExpExecArray | null;
    if (DETAIL.test(path)) details.push((JSON.parse(text) as TokenAnswer).token);
    else if ((match = HOLDERS.exec(path))) holders.set(match[1]!, JSON.parse(text) as TokenHoldersResponse);
    else if ((match = TRANSFERS.exec(path))) transfers.set(match[1]!, JSON.parse(text) as TokenTransfersResponse);
    else if (LIST.test(path)) list = JSON.parse(text) as TokensResponse;
    else if (POOLS.test(path)) pools.push(...(JSON.parse(text) as { pools: AmmPool[] }).pools);
  }
  return { details, holders, transfers, ...(list !== undefined && { list }), pools };
}

/** A character `parseAssetText` reads as the separator: a text code that holds one is written in hex in a URL. */
const SEPARATOR = /[.+| ]/;

/**
 * A token's canonical URL segment, E3's asset form: the code D6 gives it (the 3 characters, or the text of its hex), or the 40 hex digits of a currency with no text or with a text the URL form
 * cannot hold, its issuer after a dot. The form `assetText` of app/domain/asset.ts writes, which the fixtures test holds this to; that module is not for the end-to-end suite's project.
 */
export const tokenPath = (token: { currency: string; code?: string; issuer: string }): string =>
  `${token.code !== undefined && !SEPARATOR.test(token.code) ? token.code : token.currency}.${token.issuer}`;

const RULES: Partial<Record<TokenCase, (token: TokenDetail) => boolean>> = {
  rlusd: (token) =>
    token.code === "RLUSD" &&
    token.listed &&
    token.issuer_settings?.allow_trust_line_clawback === true &&
    token.markets.some((market) => market.counter_issuer === undefined) &&
    token.markets.some((market) => market.counter_issuer !== undefined),
  usd: (token) => token.currency === "USD" && token.issuer_settings?.transfer_fee === "0.2" && !token.listed,
  lions: (token) => token.code === "LIONS" && token.domain === undefined && token.issuer_settings === undefined,
  "few-holders": (token) => token.holders < 10,
  evr: (token) => token.code === "EVR" && token.listed && token.price !== undefined,
  "xahau-unlisted": (token) => !token.listed,
};

const RLUSD_CODE = "524C555344000000000000000000000000000000";

/** The XRP/RLUSD pool: RLUSD on one side and the native currency, which has no issuer, on the other. */
const isNativeRlusd = (pool: AmmPool): boolean =>
  (pool.base_currency === RLUSD_CODE && pool.counter_issuer === undefined) || (pool.counter_currency === RLUSD_CODE && pool.base_issuer === undefined);

/** The token of `which` among a network's files, or `undefined` when they hold none. `net` is the network the files are of: a case of another network is none of theirs. */
export function resolveTokenCase(net: string, which: TokenCase, sources: TokenSources): TokenCaseResult | undefined {
  if (TOKEN_CASE_NET[which] !== net) return undefined;
  if (which === "lp") {
    const pool = sources.pools.find((each) => isNativeRlusd(each) && each.lp_currency !== undefined);
    return pool === undefined ? undefined : { currency: pool.lp_currency!, issuer: pool.amm_account, path: tokenPath({ currency: pool.lp_currency!, issuer: pool.amm_account }) };
  }
  const token = sources.details.find(RULES[which]!);
  return token === undefined ? undefined : { currency: token.currency, issuer: token.issuer, path: tokenPath(token) };
}

/** The first token, by file name, whose first page of `pages` goes on. */
function firstThatGoesOn(sources: TokenSources, pages: ReadonlyMap<string, { marker?: string }>): TokenMarkerResult | undefined {
  for (const token of sources.details) {
    const marker = pages.get(`${token.currency}.${token.issuer}`)?.marker;
    if (marker !== undefined) return { token: tokenPath(token), marker };
  }
  return undefined;
}

/** A token whose holders go on behind `holders@limit=50.json`, and the marker of the second page. */
export const resolveHoldersMarker = (sources: TokenSources): TokenMarkerResult | undefined => firstThatGoesOn(sources, sources.holders);
/** A token whose transfers go on behind `transfers@descending=true&limit=20.json`, and the marker of the second page. */
export const resolveTransfersMarker = (sources: TokenSources): TokenMarkerResult | undefined => firstThatGoesOn(sources, sources.transfers);
