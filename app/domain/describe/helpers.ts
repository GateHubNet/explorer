// The small pieces the handlers of `describe/` are built from: segments, amounts, flags, details. Pure.

import BigNumber from "bignumber.js";
import { dropsToNative, formatUtc } from "../format";
import type { AmmHop, Native, TxJson } from "../parse/types";
import type { Detail, FlowAmount, Handler, HandlerMap, Segment } from "./types";

// --- Segments ------------------------------------------------------------------------------------------------------

export const text = (v: string): Segment => ({ t: "text", v });

/** A link to an account. What is not an address (a field the transaction left out) reads as an unknown account. */
export function account(v: unknown): Segment {
  return typeof v === "string" && v !== "" ? { t: "account", v } : text("an unknown account");
}

/** A swap's pool, named by the pair of currencies it swapped, `<in>/<out>`, as raw codes. */
export const poolPair = (hop: AmmHop): string => `${hop.in.currency}/${hop.out.currency}`;

export const pool = (hop: AmmHop): Segment => ({ t: "pool", v: hop.pool, pair: poolPair(hop) });

/** Strings, segments and lists of them, in the order they read. */
export type Part = string | Segment | readonly Part[];

/** Joins parts into segments: a string is text, and text that follows text is merged into one segment. */
export function seq(...parts: readonly Part[]): Segment[] {
  const out: Segment[] = [];
  const push = (part: Part): void => {
    if (typeof part === "string") {
      if (part === "") return;
      push(text(part));
    } else if ("t" in part) {
      const last = out.at(-1);
      if (part.t === "text" && last?.t === "text") out[out.length - 1] = text(last.v + part.v);
      else out.push(part);
    } else {
      for (const inner of part) push(inner);
    }
  };
  parts.forEach(push);
  return out;
}

export const detail = (label: string, ...value: Part[]): Detail => ({ label, value: seq(value) });

// --- Amounts -------------------------------------------------------------------------------------------------------

const DROPS = /^\d+$/;

/**
 * An amount of a transaction field as whole units: drops of the native currency (a string) become the native
 * currency, an issued amount keeps its value as given. Anything else (an MPT amount, a missing field, the node's
 * "unavailable") is not an amount here.
 */
export function parseAmount(raw: unknown, native: Native): FlowAmount | undefined {
  if (typeof raw === "string") return DROPS.test(raw) ? { value: dropsToNative(raw), currency: native } : undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { currency, issuer, value } = raw as Record<string, unknown>;
  if (typeof currency !== "string" || typeof value !== "string") return undefined;
  return typeof issuer === "string" ? { value, currency, issuer } : { value, currency };
}

export const amountOf = (amount: FlowAmount): Segment => ({ t: "amount", ...amount });

/** An amount field as an amount segment; a value that is not an amount is shown as it is. */
export function amountSegment(raw: unknown, native: Native): Segment {
  const amount = parseAmount(raw, native);
  if (amount) return amountOf(amount);
  return text(typeof raw === "string" ? raw : (JSON.stringify(raw) ?? "an unknown amount"));
}

export function sameAmount(a: FlowAmount, b: FlowAmount): boolean {
  return a.currency === b.currency && (a.issuer ?? "") === (b.issuer ?? "") && new BigNumber(a.value).isEqualTo(b.value);
}

// --- Flags ---------------------------------------------------------------------------------------------------------

/** A transaction type's flags: the bit and its name. */
export type FlagTable = ReadonlyArray<readonly [mask: number, name: string]>;

/** `tfFullyCanonicalSig` is set on nearly every transaction and says nothing, so it is never listed. */
const FULLY_CANONICAL_SIG = 0x80000000;
/** Flags of every transaction type. */
const UNIVERSAL_FLAGS: FlagTable = [[0x40000000, "tfInnerBatchTxn"]];

/** The names of the flags a transaction sets; a bit the table does not know is shown as hex. */
export function flagNames(flags: unknown, table: FlagTable): string[] {
  if (typeof flags !== "number" || !Number.isInteger(flags)) return [];
  const names: string[] = [];
  let known = FULLY_CANONICAL_SIG;
  for (const [mask, name] of [...table, ...UNIVERSAL_FLAGS]) {
    known |= mask;
    if ((flags & mask) !== 0) names.push(name);
  }
  const unknown = (flags & ~known) >>> 0;
  if (unknown !== 0) names.push(`0x${unknown.toString(16).toUpperCase()}`);
  return names;
}

// --- Details -------------------------------------------------------------------------------------------------------

/** A detail for a number or a string field, left out when the transaction does not have it. */
export function fieldDetail(tx: TxJson, field: string, label: string): Detail[] {
  const value = tx[field];
  return typeof value === "number" || typeof value === "string" ? [detail(label, String(value))] : [];
}

/** What nearly every type has at the end of its details: the source tag, the ticket it used, its flags. */
export function closingDetails(tx: TxJson, flags: FlagTable): Detail[] {
  const names = flagNames(tx.Flags, flags);
  return [
    ...fieldDetail(tx, "SourceTag", "Source tag"),
    ...fieldDetail(tx, "TicketSequence", "Ticket sequence"),
    ...(names.length > 0 ? [detail("Flags", names.join(", "))] : []),
  ];
}

/** Fields every transaction has, which a table of "its fields" leaves out. */
export const COMMON_FIELDS: ReadonlySet<string> = new Set([
  "Account",
  "Fee",
  "Sequence",
  "SigningPubKey",
  "TxnSignature",
  "Flags",
  "LastLedgerSequence",
  "hash",
  // The type is in the sentence, and every Xahau transaction carries the network id.
  "TransactionType",
  "NetworkID",
]);

/** Fields that hold an amount, which a string of digits in them is drops of. */
const AMOUNT_FIELDS: ReadonlySet<string> = new Set([
  "Amount",
  "Amount2",
  "SendMax",
  "DeliverMin",
  "DeliverMax",
  "TakerGets",
  "TakerPays",
  "LimitAmount",
  "Balance",
  "NFTokenBrokerFee",
  "EPrice",
]);

const ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** A field of a transaction as segments: an amount, an account, or text (JSON for what has a structure). */
export function fieldValue(name: string, value: unknown, native: Native): Segment[] {
  if (typeof value === "string") {
    if (AMOUNT_FIELDS.has(name) && DROPS.test(value)) return [amountSegment(value, native)];
    if (ADDRESS.test(value)) return [account(value)];
    return [text(value === "" ? "(empty)" : value)];
  }
  if (typeof value === "number" || typeof value === "boolean") return [text(String(value))];
  const amount = parseAmount(value, native);
  if (amount) return [amountOf(amount)];
  return [text(JSON.stringify(value) ?? "")];
}

/** One detail per top-level field, in the transaction's order, labelled with the field's own name. */
export function genericDetails(tx: TxJson, native: Native, skip: ReadonlySet<string> = new Set()): Detail[] {
  return Object.entries(tx)
    .filter(([name]) => !COMMON_FIELDS.has(name) && !skip.has(name))
    .map(([name, value]) => ({ label: name, value: fieldValue(name, value, native) }));
}

// --- Values --------------------------------------------------------------------------------------------------------

/** Hex as UTF-8 text, when it is text: valid UTF-8 with no control characters. */
export function decodeHex(hex: unknown): string | undefined {
  if (typeof hex !== "string" || hex === "" || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return undefined;
  const bytes = Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u0000-\u001f\u007f]/.test(decoded) ? undefined : decoded;
  } catch {
    return undefined;
  }
}

/** Seconds from the Unix epoch to the Ripple epoch (2000-01-01), which the ledger's times count from. */
const RIPPLE_EPOCH = 946684800;

/** A time field of a transaction (`Expiration`, `FinishAfter`, ...), which is in Ripple-epoch seconds, as UTC text. */
export function rippleTime(raw: unknown): Segment {
  return text(typeof raw === "number" && Number.isFinite(raw) ? formatUtc(raw + RIPPLE_EPOCH) : String(raw));
}

/** `1 ticket`, `20 tickets`. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A word with its indefinite article: `a Payment`, `an Invoke`. */
export const withArticle = (word: string): string => `${/^[AEIO]/.test(word) ? "an" : "a"} ${word}`;

/** An integer field (a count, a sequence), or undefined. */
export function wholeNumber(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) ? raw : undefined;
}

// --- Registry ------------------------------------------------------------------------------------------------------

/** Merges the handler maps of the modules of `describe/`; two handlers for one transaction type is a mistake. */
export function mergeHandlers(...maps: readonly HandlerMap[]): HandlerMap {
  const merged: Record<string, Handler> = {};
  for (const map of maps) {
    for (const [type, handler] of Object.entries(map)) {
      if (Object.hasOwn(merged, type)) throw new Error(`describe: two handlers for ${type}`);
      merged[type] = handler;
    }
  }
  return merged;
}
