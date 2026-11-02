// The small pieces the handlers of `describe/` are built from: segments, amounts, flags, details. Pure.

import BigNumber from "bignumber.js";
import { dropsToNative, formatAmount, formatCurrency, formatUtc, shortHash } from "../format";
import { isMptIssuanceId, mptIdOf, mptIssuerOf } from "../mpt-id";
import { kindOfType, ledgerId, type ObjectKind, type ObjectRefParts } from "../object-link";
import { nodesOf } from "../parse/objects";
import type { AmmHop, Asset, Native, TxJson, TxMeta } from "../parse/types";
import type { CurrencyAmount, Detail, Handler, HandlerMap, MptFlowAmount, Segment } from "./types";

// The two functions of an MPT issuance ID live in a leaf (`../mpt-id.ts`), so that `parse/objects.ts` (which this file imports, and the Node type-check project lists) can use them without a cycle, and are exported from here, as the spec names them.
export { mptIdOf, mptIssuerOf };

// --- Segments ------------------------------------------------------------------------------------------------------

export const text = (v: string): Segment => ({ t: "text", v });

/** A link to an account. What is not an address (a field the transaction left out) reads as an unknown account. */
export function account(v: unknown): Segment {
  return typeof v === "string" && v !== "" ? { t: "account", v } : text("an unknown account");
}

/**
 * The accounts some segments draw as account links (`Sentence`'s `AccountLink`), in order: what a loader names of a sentence, a row or a detail (display names spec 1 and 5).
 * Not an amount's issuer, which `Amount` writes in a title, nor a pool's account, which is a link to the pool.
 */
export const accountsIn = (segments: readonly Segment[]): string[] => segments.flatMap((segment) => (segment.t === "account" ? [segment.v] : []));

/**
 * A pool's name, from the currencies of its two assets: `<code>/<code>`, each as `formatCurrency` shows it, so an LP
 * token or a code that is not text reads well. The one place a pool pair is named.
 */
export const pairName = (a: Asset, b: Asset): string =>
  `${formatCurrency(a.currency)}/${formatCurrency(b.currency)}`;

/** A swap's pool, named by the pair of currencies it swapped: `<in>/<out>`. */
export const poolPair = (hop: AmmHop): string => pairName(hop.in, hop.out);

export const pool = (hop: AmmHop): Segment => ({ t: "pool", v: hop.pool, pair: poolPair(hop) });

/** A link to an NFT, or on Xahau a URIToken, by its id. No serial: describe does not decode the id. */
export const nftSegment = (v: string): Segment => ({ t: "nft", v });

/** An escrow, a check or a payment channel, in the words `v`, which link to its page by `ref` while LEDGER_OBJECTS is on (ledger object pages spec 7). */
export const objectSegment = (kind: ObjectKind, ref: ObjectRefParts, v: string): Segment => ({ t: "object", kind, ref, v });

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
 * currency, an issued amount keeps its value as given. Anything else (an MPT amount, which `parseMptAmount` and
 * `mptFlowAmount` read, a missing field, the node's "unavailable") is not an amount here.
 */
export function parseAmount(raw: unknown, native: Native): CurrencyAmount | undefined {
  if (typeof raw === "string") return DROPS.test(raw) ? { value: dropsToNative(raw), currency: native } : undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { currency, issuer, value } = raw as Record<string, unknown>;
  if (typeof currency !== "string" || typeof value !== "string") return undefined;
  return typeof issuer === "string" ? { value, currency, issuer } : { value, currency };
}

export const amountOf = (amount: CurrencyAmount): Segment => ({ t: "amount", ...amount });

/**
 * An MPT's amount of a transaction field, `{ mpt_issuance_id, value }`: the ID in capitals and the units, when the ID is 48 hex digits and the value an integer in digits (what the ledger writes for
 * a 64-bit amount). `undefined` for anything else, so an object that only looks like one (a 40-digit ID, a value with a fraction) is shown as the unknown field it is.
 */
export function parseMptAmount(raw: unknown): { id: string; units: string } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { mpt_issuance_id: id, value } = raw as Record<string, unknown>;
  return isMptIssuanceId(id) && typeof value === "string" && DROPS.test(value) ? { id: id.toUpperCase(), units: value } : undefined;
}

/**
 * What an MPT payment delivered, from the metadata: the API's `delivered_amount` else the ledger's own `DeliveredAmount`, whichever reads as an MPT amount (the node's "unavailable" and a missing
 * field read as none). `undefined` when neither does, and when a delivered amount is of another issuance than `id`, the payment's `Amount`: metadata that contradicts the transaction is not shown
 * (D9's `mptPaymentIssuance` refuses such a payment the same way). The one reading the sentence (`payment.ts`) and the headline amount of a list row (`row.ts`) share.
 */
export function deliveredMptAmount(meta: TxMeta, id: string): { id: string; units: string } | undefined {
  const read = [meta.delivered_amount, meta.DeliveredAmount].flatMap((raw) => parseMptAmount(raw) ?? []);
  return read.length > 0 && read.every((delivered) => delivered.id === id.toUpperCase()) ? read[0] : undefined;
}

/** A segment for an MPT: an amount with `units`, a reference to the issuance without. The issuer is decoded from the ID, which must be 48 hex digits (`parseMptAmount` and the nodes `mptIdOfNode` reads give such IDs). */
export function mptSegment(id: string, units?: string): Segment {
  const upper = id.toUpperCase();
  return units === undefined ? { t: "mpt", id: upper, issuer: mptIssuerOf(upper) } : { t: "mpt", id: upper, issuer: mptIssuerOf(upper), units };
}

/** An MPT amount field as a flow step's amount; `undefined` for anything `parseMptAmount` does not read. */
export function mptFlowAmount(raw: unknown): MptFlowAmount | undefined {
  const amount = parseMptAmount(raw);
  return amount === undefined ? undefined : { mpt: amount.id, issuer: mptIssuerOf(amount.id), units: amount.units };
}

/** What `MptAmount` draws, as words for a sentence: "2,500,000 units of MPT 0000012A…" (raw units, no scale: E14 replaces them). */
export const mptWords = ({ id, units }: { id: string; units: string }): string => `${formatAmount(units)} units of MPT ${id.slice(0, 8)}…`;

/** An MPT amount field as its segment, `undefined` for anything else. */
function mptField(raw: unknown): Segment | undefined {
  const amount = parseMptAmount(raw);
  return amount === undefined ? undefined : mptSegment(amount.id, amount.units);
}

/** An amount field as an amount segment, an MPT's as an MPT segment; a value that is neither is shown as it is. */
export function amountSegment(raw: unknown, native: Native): Segment {
  const amount = parseAmount(raw, native);
  if (amount) return amountOf(amount);
  return mptField(raw) ?? text(typeof raw === "string" ? raw : (JSON.stringify(raw) ?? "an unknown amount"));
}

export function sameAmount(a: CurrencyAmount, b: CurrencyAmount): boolean {
  return a.currency === b.currency && (a.issuer ?? "") === (b.issuer ?? "") && new BigNumber(a.value).isEqualTo(b.value);
}

// --- Flags ---------------------------------------------------------------------------------------------------------

/** A transaction type's flags: the bit and its name. */
export type FlagTable = ReadonlyArray<readonly [mask: number, name: string]>;

/** `tfFullyCanonicalSig` is set on nearly every transaction and says nothing, so it is never listed. */
const FULLY_CANONICAL_SIG = 0x80000000;
/** `tfInnerBatchTxn`: the transaction is one of a `Batch`, which paid its fee. */
const INNER_BATCH = 0x40000000;
/** Flags of every transaction type. */
const UNIVERSAL_FLAGS: FlagTable = [[INNER_BATCH, "tfInnerBatchTxn"]];

/** Whether a transaction is one of a `Batch` (`tfInnerBatchTxn`): it was sent within the Batch, which paid its fee. */
export function isInnerBatch(tx: TxJson): boolean {
  return typeof tx.Flags === "number" && Number.isInteger(tx.Flags) && (tx.Flags & INNER_BATCH) !== 0;
}

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

/** A detail for a field that holds an NFT's or URIToken's id, as a link to it, left out when the transaction does not have it. */
export function nftFieldDetail(tx: TxJson, field: string, label: string): Detail[] {
  const id = tx[field];
  return typeof id === "string" && id !== "" ? [detail(label, nftSegment(id))] : [];
}

/** A detail for a field that holds the ID of an escrow, a check or a channel (`CheckID`, `Channel`): the ID, in capitals, linking to its page; a value that is no ID is shown as it is. */
export function objectFieldDetail(tx: TxJson, field: string, label: string, kind: ObjectKind): Detail[] {
  const id = ledgerId(tx[field]);
  return id === undefined ? fieldDetail(tx, field, label) : [detail(label, objectSegment(kind, { id }, id))];
}

/**
 * The detail of the escrow, check or channel a transaction created ("Escrow", "Check", "Channel"): the ID of the node its metadata created, shortened, linking to its page. None when it
 * created none (one that failed).
 */
export function createdDetail(meta: TxMeta, type: "Escrow" | "Check" | "PayChannel", label: string): Detail[] {
  const id = ledgerId(nodesOf(meta).find((node) => node.change === "created" && node.type === type)?.index);
  return id === undefined ? [] : [detail(label, objectSegment(kindOfType(type)!, { id }, shortHash(id)))];
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

/** Fields every transaction has, which a table of "its fields" leaves out. (`Delegate` is any type's too: the page says who sent the transaction in a row of its own.) */
export const COMMON_FIELDS: ReadonlySet<string> = new Set([
  "Account",
  "Delegate",
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

/** A field of a transaction as segments: an amount, an account, a reference to an MPT issuance (`MPTokenIssuanceID`), or text (JSON for what has a structure). */
export function fieldValue(name: string, value: unknown, native: Native): Segment[] {
  if (typeof value === "string") {
    if (AMOUNT_FIELDS.has(name) && DROPS.test(value)) return [amountSegment(value, native)];
    if (name === "MPTokenIssuanceID" && isMptIssuanceId(value)) return [mptSegment(value)];
    if (ADDRESS.test(value)) return [account(value)];
    return [text(value === "" ? "(empty)" : value)];
  }
  if (typeof value === "number" || typeof value === "boolean") return [text(String(value))];
  const amount = parseAmount(value, native);
  if (amount) return [amountOf(amount)];
  return [mptField(value) ?? text(JSON.stringify(value) ?? "")];
}

/** One detail per top-level field, in the transaction's order, labelled with the field's own name. */
export function genericDetails(tx: TxJson, native: Native, skip: ReadonlySet<string> = new Set()): Detail[] {
  return Object.entries(tx)
    .filter(([name]) => !COMMON_FIELDS.has(name) && !skip.has(name))
    .map(([name, value]) => ({ label: name, value: fieldValue(name, value, native) }));
}

// --- Values --------------------------------------------------------------------------------------------------------

/** The account that signed a transaction and paid its fee on behalf of its `Account` (its `Delegate` field, XLS-75), if it has one. */
export function delegateOf(tx: TxJson): string | undefined {
  return typeof tx.Delegate === "string" && tx.Delegate !== "" ? tx.Delegate : undefined;
}

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

/** `a`, `a and b`, `a, b and c`: parts of a sentence in a list. */
export function listOf(items: readonly Part[]): Part[] {
  return items.map((item, i) => [i === 0 ? "" : i === items.length - 1 ? " and " : ", ", item]);
}

/** A fee in hundred-thousandths (an NFT's `TransferFee`, an AMM's `TradingFee`) as a percentage: 5000 is `5%`. */
export function feePercent(raw: unknown): string | undefined {
  const fee = wholeNumber(raw);
  return fee === undefined ? undefined : `${new BigNumber(fee).shiftedBy(-3).toFixed()}%`;
}

/** An amount of LP tokens (`{ currency, issuer, value }`) as `1,500.5 LP tokens`: its currency code says nothing. */
export function lpTokens(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { value } = raw as Record<string, unknown>;
  return typeof value === "string" ? `${formatAmount(value)} LP tokens` : undefined;
}

/** The size of a field of hex, `16 bytes`; undefined for anything that is not hex. */
export function byteSize(hex: unknown): string | undefined {
  return typeof hex === "string" && hex.length % 2 === 0 && /^[0-9a-f]*$/i.test(hex)
    ? plural(hex.length / 2, "byte")
    : undefined;
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
