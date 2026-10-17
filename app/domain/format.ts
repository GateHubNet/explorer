// Formatting of values for display. Pure: the browser and the Worker both import this file.
//
// Amounts are exact decimal strings, handled as text or with bignumber.js, never as JavaScript
// numbers, and are never written in exponent notation.

import BigNumber from "bignumber.js";

const MINUS = "\u2212";
const ELLIPSIS = "\u2026";

/** Every decimal notation a number can come in: `12`, `-1.50`, `.5`, `5.`, `1e-15`, `-1.5E+21`. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Plain notation with no exponent and nothing to normalise but the sign: kept digit for digit. */
const PLAIN_DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

function groupThousands(integer: string): string {
  return integer.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * An amount as a thousands-separated decimal, with U+2212 for a negative sign and every digit of the
 * fraction kept (`'1250.00'` stays `'1,250.00'`). Exponent notation is written out in full. A value
 * that is not a number is returned as it came.
 *
 * Takes the plain decimal strings the data API sends and `dropsToNative` returns, not its own output.
 */
export function formatAmount(value: string): string {
  if (!DECIMAL.test(value)) return value;

  let negative: boolean;
  let integer: string;
  let fraction: string;
  const plain = PLAIN_DECIMAL.exec(value);
  if (plain) {
    negative = plain[1] === "-";
    integer = plain[2]!;
    fraction = plain[3] ?? "";
  } else {
    const number = new BigNumber(value);
    negative = number.isNegative();
    [integer = "0", fraction = ""] = number.abs().toFixed().split(".");
  }

  const isZero = /^0*$/.test(integer + fraction);
  const sign = negative && !isZero ? MINUS : "";
  return `${sign}${groupThousands(integer)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Drops as the native currency (1 XRP or XAH is 1,000,000 drops), exactly. The result is a plain
 * decimal string with an ASCII minus, for further arithmetic or for `formatAmount`; it is not
 * thousands-separated. A value that is not a number is returned as it came.
 */
export function dropsToNative(drops: string): string {
  if (!DECIMAL.test(drops)) return drops;
  const native = new BigNumber(drops).shiftedBy(-6);
  return native.isZero() ? "0" : native.toFixed();
}

const HEX_CURRENCY = /^[0-9A-Fa-f]{40}$/;

/**
 * A currency code for display. A 3-character code is shown as it is. A 40-hex code is shown as ASCII
 * when it decodes to printable text, as "LP token" when it starts with `03` (an AMM pool's share
 * token), and otherwise as its first 8 hex digits and an ellipsis.
 */
export function formatCurrency(code: string): string {
  if (!HEX_CURRENCY.test(code)) return code;
  const hex = code.toUpperCase();
  if (hex.startsWith("03")) return "LP token";

  const bytes = hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
  // The standard form of a 3-letter code in 160 bits: 12 zero bytes, the 3 letters, 5 zero bytes.
  const standard = bytes.slice(12, 15);
  if (
    bytes.slice(0, 12).every((b) => b === 0) &&
    bytes.slice(15).every((b) => b === 0) &&
    standard.every(isPrintable)
  ) {
    return String.fromCharCode(...standard);
  }

  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  const text = bytes.slice(0, end);
  if (text.length > 0 && text.every(isPrintable)) return String.fromCharCode(...text);

  return `${hex.slice(0, 8)}${ELLIPSIS}`;
}

function isPrintable(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

/** An ISO date and time with no zone designator, which JavaScript would read as local time. */
const ISO_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ISO_START = /^\d{4}-\d{2}-\d{2}/;

/**
 * A moment as `2026-10-17 15:42:51 UTC`. A string is an ISO 8601 date and time (read as UTC when it
 * has no zone). A number is Unix seconds, whatever its size: a Ripple-epoch time (seconds since
 * 2000-01-01) must be converted before it gets here, as the size of a number cannot tell the two
 * epochs apart. What is not a moment is returned as it came.
 */
export function formatUtc(at: string | number): string {
  let date: Date;
  if (typeof at === "number") {
    date = new Date(at * 1000);
  } else if (ISO_START.test(at)) {
    date = new Date(ISO_WITHOUT_ZONE.test(at) ? `${at.replace(" ", "T")}Z` : at);
  } else {
    return at;
  }

  const year = date.getUTCFullYear(); // NaN for an invalid date
  if (!(year >= 0 && year <= 9999)) return String(at);
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** How long before `nowMs` the moment `atMs` was: `3 s ago`, `4 min ago`, `2 h ago`, `5 d ago`. */
export function relativeTime(atMs: number, nowMs: number): string {
  // A clock a little ahead of the moment's source makes a negative difference: show it as now.
  const seconds = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function shorten(text: string): string {
  // Eleven characters or fewer: the shortened form would be no shorter.
  if (text.length <= 11) return text;
  return `${text.slice(0, 6)}${ELLIPSIS}${text.slice(-4)}`;
}

/** The first 6 and the last 4 characters of a hash. */
export function shortHash(h: string): string {
  return shorten(h);
}

/** The first 6 and the last 4 characters of an address. */
export function shortAddress(a: string): string {
  return shorten(a);
}
