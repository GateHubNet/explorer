// The pure helpers of the MPT pages (E14 spec 3.3, decision 3, 8 and 9): what an issuance ID looks like, the amounts scaled by the asset scale, the transfer fee and the shares as text, the link
// an issuer wrote, and the words of the flags, the asset classes and the kinds of transfer. Browser-safe, as the MPT pages and their components import it: it holds no codec (`mpt-id.ts` is
// the Worker's: `mptIdOf` and `mptIssuerOf` value-import `ripple-address-codec`), nothing of `app/server` at run time (the types it names are erased) and no JavaScript number in an amount.
// An amount is the ledger's integer units as text; `scaleUnits` (BigNumber) is the only place one is scaled.

import BigNumber from "bignumber.js";

import type { MptTransferKind } from "../server/api-types";
import type { NetworkId } from "../server/networks";

const MPT_ID = /^[0-9A-Fa-f]{48}$/;

/** Whether `text` is an issuance ID: exactly 48 hex digits, in either case, with no `0x`. */
export function isMptId(text: string): boolean {
  return MPT_ID.test(text);
}

/** An ID as a label: its first 8 digits, an ellipsis and its last 4, in upper case (`0000012A…3F09`). */
export function shortMptId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-4)}`.toUpperCase();
}

/**
 * The path of an issuance's page, or of its holders' or its transfers', with the ID in upper case, the one form of the URL (a loader answers another case with a 302). The ID is one a loader
 * has checked with `isMptId`, so nothing of it is escaped.
 */
export function mptPath(net: NetworkId, id: string, page?: "holders" | "transfers"): string {
  return `/${net}/mpt/${id.toUpperCase()}${page === undefined ? "" : `/${page}`}`;
}

/** The largest asset scale the pages scale by: 19 digits are what an amount (a signed 64-bit value) can have, and a scale above it only ever has a leading "0." to write. */
export const MAX_SCALE = 19;

const INTEGER_TEXT = /^-?\d+$/;

/**
 * `units` (the ledger's integer units as text) scaled by `scale`: `BigNumber(units).shiftedBy(-scale)` written with exactly `scale` decimals, so that `124000000` at scale 2 is `1240000.00`
 * and `1` at scale 15 is `0.000000000000001`. Exact, whatever the size, and never an exponent. `null` for a scale above `MAX_SCALE` (the page shows the units as they are, with "units"), and
 * for what is no scale (a whole number from 0) or no integer: nothing but an integer is ever scaled. The result goes to `formatAmount` (or `compactNumber` on the tab).
 */
export function scaleUnits(units: string, scale: number): string | null {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE || !INTEGER_TEXT.test(units)) return null;
  return new BigNumber(units).shiftedBy(-scale).toFixed(scale);
}

/**
 * A transfer fee as a percent: `TransferFee` is in units of a thousandth of a percent (1 is 0.001%, 50000 is 50%). 0 is "None"; the rest has two decimals, and a third when it needs one
 * (`0.10%`, `1.234%`, `0.001%`).
 */
export function transferFeeText(fee: number): string {
  if (fee === 0) return "None";
  const thousandths = new BigNumber(fee).shiftedBy(-3).toFixed(3);
  return `${thousandths.endsWith("0") ? thousandths.slice(0, -1) : thousandths}%`;
}

const DASH = "—";
const UNITS = /^\d+$/;

/**
 * `part` as a percent of `whole` (both the ledger's integer units as text), to `decimals` places, half up and exact (integers only: no division that rounds): `36.4%` and `33.62%`. A share
 * above 0 and below the step (one unit of the last place) is `<0.1%` or `<0.01%`, so that a label never says 0 of what is held. Nothing to share (a `whole` of 0, an outstanding amount of
 * nothing, or a `part` or `whole` that is no integer) is a dash.
 */
export function percentText(part: string, whole: string, decimals: 1 | 2): string {
  if (!UNITS.test(part) || !UNITS.test(whole)) return DASH;
  const share = new BigNumber(part);
  const total = new BigNumber(whole);
  if (!total.gt(0)) return DASH;
  const step = `0.${"0".repeat(decimals - 1)}1%`;
  // 100 × part ÷ whole is below the step exactly when 100 × part × 10^decimals < whole.
  if (share.gt(0) && share.times(100).shiftedBy(decimals).lt(total)) return `<${step}`;
  // floor(100 × part × 10^decimals ÷ whole + ½), without a division that rounds: (200 × part × 10^decimals + whole) ÷ (2 × whole), whole part.
  const scaled = share.times(200).shiftedBy(decimals).plus(total).idiv(total.times(2));
  return `${scaled.shiftedBy(-decimals).toFixed(decimals)}%`;
}

const CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/;
const HOST_AND_PATH = /^([^/?#:@\\]+)(?:[/?#].*)?$/;
const DOMAIN = /^(?:[a-z0-9_-]+\.)+[a-z0-9-]+\.?$/;

/**
 * What the issuer wrote as a link, as a link a page may draw: `https://…` as it is, `host/path` (no scheme, a host with a dot) as `https://host/path`; anything else is `null`. The text is
 * the issuer's and unchecked, so nothing is let through that the URL parser would read as another place than the text says: no other scheme (`javascript:`, `data:`, `ipfs:`; `http:` is
 * refused too), a scheme only in lower case, no space or control character, no credentials, no port in the shorthand, and a host that is a domain with a dot (`localhost` is none).
 */
export function safeLink(text: string): string | null {
  if (text === "" || CONTROL.test(text)) return null;
  const full = text.startsWith("https://");
  if (!full && HOST_AND_PATH.exec(text) === null) return null;
  const candidate = full ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || !DOMAIN.test(url.hostname)) return null;
  return candidate;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** A whole number written in superscript, for a power of ten (`-2` is `⁻²`: "Amounts are integers scaled by 10⁻²"). */
export function superscript(n: number): string {
  return Array.from(String(n), (character) => SUPERSCRIPT[character] ?? character).join("");
}

/**
 * The words of an asset class (XLS-89's `asset_class`). The class is the issuer's text: a lookup of one that is none of these (`constructor`, `__proto__`) finds nothing, so the object has no
 * prototype; the page shows the text as written then.
 */
export const ASSET_CLASS_WORDS: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    rwa: "rwa (real-world asset)",
    memes: "memes",
    wrapped: "wrapped (a token of another chain)",
    gaming: "gaming",
    defi: "defi (decentralised finance)",
    other: "other",
  }),
);

/** The flags of an issuance a page lists (`locked` is not one: it is a notice). */
export type MptFlagKey = "can_lock" | "require_auth" | "can_escrow" | "can_trade" | "can_transfer" | "can_clawback";

/** The Flags card's six rows in the board's order: the label, and the line under "Yes" and under "No". `{T}` stands for the ticker, else "units". */
export const MPT_FLAG_WORDS: ReadonlyArray<{ key: MptFlagKey; label: string; yes: string; no: string }> = [
  {
    key: "can_lock",
    label: "Can lock",
    yes: "The issuer can lock one holder's balance, or all of {T}, so it cannot move.",
    no: "The issuer cannot lock {T}.",
  },
  {
    key: "require_auth",
    label: "Require auth",
    yes: "An account needs the issuer's approval before it can hold {T}.",
    no: "Any account can hold {T} without the issuer's approval.",
  },
  { key: "can_escrow", label: "Can escrow", yes: "{T} can be held in escrows.", no: "{T} cannot be held in escrows." },
  {
    key: "can_trade",
    label: "Can trade",
    yes: "The issuer allows {T} on the DEX. MPT trading isn't enabled on XRPL yet.",
    no: "The issuer does not allow {T} on the DEX.",
  },
  {
    key: "can_transfer",
    label: "Can transfer",
    yes: "Holders can send {T} to each other, not only back to the issuer.",
    no: "Holders can send {T} only back to the issuer.",
  },
  { key: "can_clawback", label: "Can clawback", yes: "The issuer can take {T} back from a holder.", no: "The issuer cannot take {T} back." },
];

/** The pills of the token list's Flags column, in the list's order, each with its title. */
export const MPT_FLAG_PILLS: ReadonlyArray<{ key: MptFlagKey; label: string; title: string }> = [
  { key: "can_transfer", label: "Transfer", title: "Holders can send it to each other" },
  { key: "can_trade", label: "Trade", title: "The issuer allows it on the DEX. MPT trading isn't enabled on XRPL yet." },
  { key: "can_lock", label: "Lock", title: "The issuer can lock balances" },
  { key: "can_clawback", label: "Clawback", title: "The issuer can take it back" },
  { key: "can_escrow", label: "Escrow", title: "It can be held in escrows" },
  { key: "require_auth", label: "Auth", title: "Holders need the issuer's approval" },
];

/** The legend under the list: what each pill says. */
export const MPT_FLAGS_LEGEND =
  "Flags: Transfer, holders can send it to each other · Trade, the issuer allows it on the DEX (MPT trading isn't enabled on XRPL yet) · Lock, the issuer can lock balances · Clawback, the issuer can take it back · Escrow, it can be held in escrows · Auth, holders need the issuer's approval.";

/** The words of a transfer's kind (decision 9). */
export const MPT_KIND_WORDS: Readonly<Record<MptTransferKind, string>> = {
  payment: "Transfer",
  clawback: "Clawback",
  lock: "Lock",
  unlock: "Unlock",
  escrow_create: "Escrow",
  escrow_finish: "Escrow finished",
  escrow_cancel: "Escrow cancelled",
};
