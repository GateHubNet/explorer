// How a pair is shown and linked (spec 1.5 and 1.3): the natural orientation, and the canonical link to a market. Pure; for the Worker, the
// scripts and the tests only. It value-imports asset.ts, which checks issuer checksums with `ripple-address-codec`, so a page never imports
// it: the pages get every href and label as a string in their data. The markets table, the pair page, the DEX table of E4 and the pool
// cards of E5 all order a pair with `naturalOrientation`; `canonicalPair` (asset.ts) is for talking to the data API only.

import { assetText, parseAssetText, sameAsset, type Asset, type NativeCode } from "./asset";
import { formatCurrency } from "./format";
import { pairQuery, type PairParams } from "./market-params";

/**
 * The currencies a price is quoted in, best first (rank 1 to 14): the fiat currencies, then the stablecoins, then BTC and ETH. The native
 * asset ranks 15, below them all; anything else (LP tokens included) is unranked, and below that.
 */
export const QUOTE_RANK: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "KRW",
  "RLUSD",
  "USDC",
  "USDT",
  "BTC",
  "ETH",
];

const NATIVE_RANK = QUOTE_RANK.length + 1;
const UNRANKED = Number.POSITIVE_INFINITY;

/**
 * The rank of an asset: its display code's place in `QUOTE_RANK` (so the hex of `RLUSD` ranks as `RLUSD`, and `usdc`, a text code of other
 * bytes, does not rank as `USDC`), 15 for the network's native asset, and none for anything else. An issued `XAH` on XRPL has an issuer, so
 * it is not the native asset.
 */
function rankOf(asset: Asset, native: NativeCode): number {
  if (!asset.issuer) return asset.currency === native ? NATIVE_RANK : UNRANKED;
  const at = QUOTE_RANK.indexOf(formatCurrency(asset.currency));
  return at < 0 ? UNRANKED : at + 1;
}

/** Whether `a` sorts before `b` on the lower-cased display code, then the lower-cased issuer (none is the empty text), then the held currency. */
function sortsBefore(a: Asset, b: Asset): boolean {
  const codes: [string, string] = [formatCurrency(a.currency).toLowerCase(), formatCurrency(b.currency).toLowerCase()];
  if (codes[0] !== codes[1]) return codes[0] < codes[1];
  const issuers: [string, string] = [(a.issuer ?? "").toLowerCase(), (b.issuer ?? "").toLowerCase()];
  if (issuers[0] !== issuers[1]) return issuers[0] < issuers[1];
  return a.currency < b.currency;
}

/**
 * The orientation a pair is displayed in. The counter (the currency the price is in) is the side that ranks better in `QUOTE_RANK`; on
 * a tie (the same code with two issuers, two unranked codes) the side that sorts first (`sortsBefore`) is the base. `inverted` says
 * whether the order asked for (`a` the base, `b` the counter) is the reverse of that. It needs no knowledge of the API's stored order.
 */
export function naturalOrientation(a: Asset, b: Asset, native: NativeCode): { base: Asset; counter: Asset; inverted: boolean } {
  const rankA = rankOf(a, native);
  const rankB = rankOf(b, native);
  // The worse rank is the base. The same rank is a tie, which a pair of one asset ends in `a`'s favour.
  const aIsBase = rankA === rankB ? !sortsBefore(b, a) : rankA > rankB;
  return aIsBase ? { base: a, counter: b, inverted: false } : { base: b, counter: a, inverted: true };
}

/** Whether the data API can be asked for the pair: each side must read back from its URL form as the same asset (`usd` reads back as `USD`). */
export function isLinkable(sides: readonly Asset[], native: NativeCode): boolean {
  return sides.every((side) => {
    const read = parseAssetText(assetText(side), { native });
    return read !== null && sameAsset(read, side);
  });
}

/** A segment of a pair's path: the URL form of an asset, escaped for a path. The market pair's path and the AMM pair form's are made of it. */
export function segmentOf(asset: Asset): string {
  return encodeURIComponent(assetText(asset));
}

/**
 * The link to the pair page: `/xrpl/markets/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`, then the query of `params`. A link is
 * in the orientation it is given: `naturalOrientation` is the caller's to ask for.
 */
export function marketHref(net: string, base: Asset, counter: Asset, params: Partial<PairParams> = {}): string {
  return `/${net}/markets/${segmentOf(base)}/${segmentOf(counter)}${pairQuery(params)}`;
}
