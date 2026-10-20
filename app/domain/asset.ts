// The explorer's one asset form: how an asset is written in a URL, how it is sent to the data API, and how it is held. Pure.
//
// It checks an issuer's checksum with `ripple-address-codec`, so a page's browser file never imports it: the Worker and the tests do.
// Markets use it for their URLs, and the AMM pages' routes and `?asset=` filter use it as it is.
//
// An asset is held as the ledger holds it: the native code alone, or a currency (3 characters, or 40 hex digits in upper case) and its
// issuer. The URL form is more readable: a text code (`RLUSD`) is written as its text, and the ledger's standard form of a 3-character
// code as the 3 characters. The canonical case rule: a standard 3-character code is upper case wherever it is written (the data API
// upper-cases a currency code, so `usd` and `USD` are one currency there). A text code is its bytes, so `rlusd` is not `RLUSD`.

import { isValidClassicAddress } from "ripple-address-codec";

export type NativeCode = "XRP" | "XAH";

/** The native code alone, or a currency as the ledger holds it (3 characters, or 40 hex digits in upper case) and its issuer. */
export interface Asset {
  currency: string;
  issuer?: string;
}

/** `.` is the separator of the URL form; the others are what a pasted or typed text, or a raw `+` in a query string, brings. */
const SEPARATOR = /[.+ |]/;
/** A separator the URL form cannot hold inside a text code (a space is outside the range of a text code anyway). */
const IN_TEXT_CODE_SEPARATOR = /[.+|]/;

/** A standard code: 3 characters from the ledger's set, less `|` (the API splits on it). */
const STANDARD_CODE = /^[A-Za-z0-9?!@#$%^&*<>(){}[\]]{3}$/;
/** A text code: 4 to 20 printable ASCII characters. */
const TEXT_CODE = /^[\x21-\x7e]{4,20}$/;
const HEX_CODE = /^[0-9A-Fa-f]{40}$/;
const ZERO_HEX = /^0{40}$/;
/** The ledger's form of a 3-character code: bytes 0 to 11 and 15 to 19 zero, bytes 12 to 14 the code. */
const STANDARD_HEX = /^0{24}([0-9A-Fa-f]{6})0{10}$/;

/** Upper-case for ASCII letters only. */
function upperAscii(text: string): string {
  return text.replace(/[a-z]+/g, (letters) => letters.toUpperCase());
}

function bytesOf(hex: string): number[] {
  const bytes: number[] = [];
  for (let at = 0; at < hex.length; at += 2) bytes.push(Number.parseInt(hex.slice(at, at + 2), 16));
  return bytes;
}

/** The 3 characters of the ledger's standard form of a currency (40 hex digits), or null when it is not one. */
function standardCodeOfHex(hex: string): string | null {
  const middle = STANDARD_HEX.exec(hex)?.[1];
  if (middle === undefined) return null;
  const code = String.fromCharCode(...bytesOf(middle));
  return STANDARD_CODE.test(code) ? code : null;
}

/** The text of a currency (40 hex digits) whose bytes, trailing zeros stripped, are 4 to 20 printable characters the URL form can hold. */
function textOfHex(hex: string): string | null {
  const bytes = bytesOf(hex);
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
  const text = String.fromCharCode(...bytes);
  return TEXT_CODE.test(text) && !IN_TEXT_CODE_SEPARATOR.test(text) ? text : null;
}

/** The 40 hex digits of a text code: its bytes, left-aligned and zero-padded, in upper case. */
function hexOfText(text: string): string {
  let hex = "";
  for (let at = 0; at < text.length; at++) hex += text.charCodeAt(at).toString(16).padStart(2, "0");
  return hex.toUpperCase().padEnd(40, "0");
}

/** The currency a code in a URL names, or null when it is none, or is the network's native code (which has no issuer). */
function currencyOfCode(code: string, native: NativeCode): string | null {
  if (STANDARD_CODE.test(code)) {
    const standard = upperAscii(code);
    return standard === native ? null : standard;
  }
  if (HEX_CODE.test(code)) {
    const hex = code.toUpperCase();
    if (ZERO_HEX.test(hex)) return null;
    const standard = standardCodeOfHex(hex);
    if (standard === null) return hex;
    const upper = upperAscii(standard);
    return upper === native ? null : upper;
  }
  if (TEXT_CODE.test(code)) return hexOfText(code);
  return null;
}

/**
 * The asset a text names on `network`, or null. Reads `.`, `+`, a space (a raw `+` in a query string) and `|` as the separator.
 * It does not decode percent-escapes: a caller decodes a path segment first. A text is canonical exactly when `assetText` of its asset
 * gives it back; a caller that finds otherwise redirects to that form.
 */
export function parseAssetText(text: string, network: { native: NativeCode }): Asset | null {
  const parts = text.split(SEPARATOR);
  if (parts.length > 2) return null;
  const [code = "", issuer] = parts;
  // The native code stands alone, in any case; any other code needs an issuer.
  if (issuer === undefined) return upperAscii(code) === network.native ? { currency: network.native } : null;
  if (!isValidClassicAddress(issuer)) return null;
  const currency = currencyOfCode(code, network.native);
  return currency === null ? null : { currency, issuer };
}

/** The code of a currency in the URL form. */
function codeText(currency: string): string {
  if (STANDARD_CODE.test(currency)) return upperAscii(currency);
  if (!HEX_CODE.test(currency)) return currency;
  const hex = currency.toUpperCase();
  const standard = standardCodeOfHex(hex);
  return standard === null ? (textOfHex(hex) ?? hex) : upperAscii(standard);
}

/**
 * The URL form: the native code alone; `CUR.issuer` with a 3-character code in upper case (the canonical case rule), a text code as
 * its text, and any other code as upper-case hex.
 */
export function assetText(asset: Asset): string {
  return asset.issuer ? `${codeText(asset.currency)}.${asset.issuer}` : asset.currency;
}

/** The API's form: the native code, or `CUR+issuer`, with a text code as its 40 hex digits. */
export function apiAssetText(asset: Asset): string {
  return asset.issuer ? `${asset.currency}+${asset.issuer}` : asset.currency;
}

/**
 * The key the data API orders a pair by: its `canonicalPairKey` (data-api-new `packages/shared/src/parsers/exchanges.parser.ts`), the
 * lower-cased currency followed by the lower-cased issuer with nothing between. A missing issuer, or the empty one a stored row carries
 * for the native currency, is the text `undefined`: the native currency's key is `xrpundefined`, not `xrp`.
 */
function orderKey(asset: Asset): string {
  return (asset.currency + (asset.issuer || "undefined")).toLowerCase();
}

/** The pair in the API's stored order (see `orderKey`). For talking to the API only. */
export function canonicalPair(a: Asset, b: Asset): [Asset, Asset] {
  return orderKey(b) < orderKey(a) ? [b, a] : [a, b];
}

/** An equal currency and issuer; an absent issuer is the same as an empty one. */
export function sameAsset(a: Asset, b: Asset): boolean {
  return a.currency === b.currency && (a.issuer ?? "") === (b.issuer ?? "");
}
