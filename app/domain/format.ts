// Formatting of values for display. Pure: the browser and the Worker both import this file.
//
// Amounts are exact decimal strings, handled as text or with bignumber.js, never as JavaScript
// numbers, and are never written in exponent notation.
//
// This file is in the closure of the root route's static imports, so the build puts it in the shell chunk every page loads, and whatever of
// it a page imports is in that chunk for every page. The words only some pages use (dates, countdowns, a list as a sentence) are in
// time-words.ts, so that a page that draws one pays for it alone. The percent rules (`sharePercent`, `wholePercent`) are in percent.ts for the same
// reason, and this file must not import or re-export it: any edge from here pulls them back into the shell.

import BigNumber from "bignumber.js";

const MINUS = "\u2212";
const ELLIPSIS = "\u2026";

/** Every decimal notation a number can come in: `12`, `-1.50`, `.5`, `5.`, `1e-15`, `-1.5E+21`. */
export const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
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

const COMPACT_SUFFIXES = ["K", "M", "B", "T"] as const;

/** A plain decimal (`1234.57`, no exponent, no sign) with its integer part grouped. */
function groupDecimal(plain: string): string {
  const [integer = "0", fraction] = plain.split(".");
  return fraction ? `${groupThousands(integer)}.${fraction}` : groupThousands(integer);
}

/** The size of a number without its sign, in few characters: see `compactNumber`. */
function compactMagnitude(abs: BigNumber): string {
  if (abs.isZero()) return "0";
  if (abs.lt(1)) return abs.precision(3, BigNumber.ROUND_HALF_UP).toFixed();
  if (abs.lt(10_000)) return groupDecimal(abs.decimalPlaces(2, BigNumber.ROUND_HALF_UP).toFixed());

  let rank = abs.lt(1e6) ? 0 : abs.lt(1e9) ? 1 : abs.lt(1e12) ? 2 : 3; // K, M, B, T
  let digits = abs.shiftedBy(-3 * (rank + 1)).precision(3, BigNumber.ROUND_HALF_UP);
  if (digits.gte(1000) && rank < COMPACT_SUFFIXES.length - 1) {
    // 999,950 is 1000K at 3 significant digits: it is 1M.
    rank += 1;
    digits = abs.shiftedBy(-3 * (rank + 1)).precision(3, BigNumber.ROUND_HALF_UP);
  }
  return `${groupDecimal(digits.toFixed())}${COMPACT_SUFFIXES[rank]}`;
}

/**
 * A number in few characters, half up, for the labels of a chart: from 10,000, 3 significant digits and a K, M, B or T
 * (`12.9K`, `4.2M`, `1.24B`; it rolls to the next letter at 1000); from 1 to 9,999.99, grouped with at most 2 decimals;
 * under 1, 3 significant digits. Trailing zeros are dropped, U+2212 is the sign of a negative, and exponent notation is
 * read, never written. A value that is not a number is returned as it came.
 */
export function compactNumber(value: string): string {
  if (!DECIMAL.test(value)) return value;
  const number = new BigNumber(value);
  const abs = number.abs();
  return `${number.isNegative() && !abs.isZero() ? MINUS : ""}${compactMagnitude(abs)}`;
}

/**
 * A price for display (the data API writes one with 8 significant digits, in exponent notation from 1e8 and below 1e-6): 8 significant
 * digits, half up on the digits themselves, trailing zeros dropped, the integer part grouped (`12,345.679`, `0.4099`, `0.0000000001`).
 * It is never compacted (no K, M or B: a price is read to the digit) and never written with an exponent; U+2212 is the sign of a negative.
 * A value that is not a number is returned as it came.
 */
export function formatPrice(value: string): string {
  if (!DECIMAL.test(value)) return value;
  // `toFixed()` with no argument is plain notation, and BigNumber keeps no trailing zeros, so `0.40990000` is `0.4099` from here.
  return formatAmount(new BigNumber(value).precision(8, BigNumber.ROUND_HALF_UP).toFixed());
}

/**
 * A percent change as text, without the `%` (the caller adds it): rounded half up to 2 decimals, `+` before a positive value, U+2212
 * before a negative one, the integer part grouped, and `0.00` for zero and for what rounds to zero (`-0.004`), which has no sign. Exponent
 * notation is read, never written. A value that is not a number is returned as it came.
 */
export function formatChange(value: string): string {
  if (!DECIMAL.test(value)) return value;
  const change = new BigNumber(value).decimalPlaces(2, BigNumber.ROUND_HALF_UP);
  if (change.isZero()) return "0.00";
  return `${change.isNegative() ? MINUS : "+"}${formatAmount(change.abs().toFixed(2))}`;
}

/** The smallest value `formatValue` writes in digits: one drop of the native currency. */
const ONE_DROP = new BigNumber("0.000001");

/**
 * An estimate in the native currency, for a tile or a table cell: half up to 2 decimals from 1, to 6 decimals below 1, trailing zeros
 * dropped, the integer part grouped, U+2212 before a negative value, `+` before a positive one with `signed`, `0` for zero (no sign), and
 * `<0.000001` for what is not zero and below a drop (the sign goes before it). Exponent notation is read, never written. A value that is
 * not a number is returned as it came.
 */
export function formatValue(value: string, opts: { signed?: boolean } = {}): string {
  if (!DECIMAL.test(value)) return value;
  const number = new BigNumber(value);
  if (number.isZero()) return "0";

  const abs = number.abs();
  const plus = opts.signed === true && number.isPositive() ? "+" : "";
  if (abs.lt(ONE_DROP)) return `${number.isNegative() ? MINUS : plus}<0.000001`;

  // Half up on the digits (a tie goes away from zero, as in `formatChange`), and `toFixed()` with no argument is plain notation with no trailing zeros.
  const rounded = number.decimalPlaces(abs.gte(1) ? 2 : 6, BigNumber.ROUND_HALF_UP);
  return `${plus}${formatAmount(rounded.toFixed())}`;
}

const HEX_CURRENCY = /^[0-9A-Fa-f]{40}$/;

/**
 * The text of a currency code for display, or `null` for a 40-hex code that has none (it decodes to no printable text and is no LP token).
 * What is not a 40-hex code is its own text.
 */
function decodedCurrency(code: string): string | null {
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

  return null;
}

/**
 * A currency code for display. A 3-character code is shown as it is. A 40-hex code is shown as ASCII
 * when it decodes to printable text, as "LP token" when it starts with `03` (an AMM pool's share
 * token), and otherwise as its first 8 hex digits and an ellipsis.
 */
export function formatCurrency(code: string): string {
  return decodedCurrency(code) ?? `${code.toUpperCase().slice(0, 8)}${ELLIPSIS}`;
}

/**
 * Whether `formatCurrency` shows the code itself (or its text), not the first 8 digits of a 40-hex code that does not decode. A page that
 * shortens such a code elsewhere writes it out in full where it names the currency.
 */
export function decodesCurrency(code: string): boolean {
  return decodedCurrency(code) !== null;
}

function isPrintable(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

/** An ISO date and time with no zone designator, which JavaScript would read as local time. */
const ISO_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ISO_START = /^\d{4}-\d{2}-\d{2}/;

/**
 * The moment `at` names, or `undefined` when it names none. A string is an ISO 8601 date and time (read as UTC when it has no zone), or
 * a date alone (UTC midnight). A number is Unix seconds, whatever its size: a Ripple-epoch time (seconds since 2000-01-01) must be
 * converted before it gets here, as the size of a number cannot tell the two epochs apart.
 */
export function utcMoment(at: string | number): Date | undefined {
  let date: Date;
  if (typeof at === "number") {
    date = new Date(at * 1000);
  } else if (ISO_START.test(at)) {
    date = new Date(ISO_WITHOUT_ZONE.test(at) ? `${at.replace(" ", "T")}Z` : at);
  } else {
    return undefined;
  }

  const year = date.getUTCFullYear(); // NaN for an invalid date
  return year >= 0 && year <= 9999 ? date : undefined;
}

/**
 * A moment as `2026-10-17 15:42:51 UTC`. A string is an ISO 8601 date and time (read as UTC when it
 * has no zone). A number is Unix seconds, whatever its size: a Ripple-epoch time (seconds since
 * 2000-01-01) must be converted before it gets here, as the size of a number cannot tell the two
 * epochs apart. What is not a moment is returned as it came.
 */
export function formatUtc(at: string | number): string {
  const date = utcMoment(at);
  return date ? `${date.toISOString().slice(0, 19).replace("T", " ")} UTC` : String(at);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const UTC_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A UTC day (`YYYY-MM-DD`) as `Oct 17`, or as `Oct 17, 2026` with the year. The month names are a fixed table, so the text is the same
 * in every browser and on the server (no `Intl`, no locale). What is not a day is returned as it came.
 */
export function formatUtcDay(day: string, withYear = false): string {
  const parts = UTC_DAY.exec(day);
  const month = parts ? MONTHS[Number(parts[2]) - 1] : undefined;
  if (!parts || !month) return day;
  return `${month} ${Number(parts[3])}${withYear ? `, ${parts[1]}` : ""}`;
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
