// The MPT amounts of a page, collected and resolved (E14 spec 2.4 and 5.1, Task 7): a page that shows an MPT amount outside an MPT answer collects the issuance IDs it draws (`mptAmountsOf`),
// the loader asks the data API once (`loadMptLookup`, mpt-load.ts) and `resolveMpt` fills each amount's scaled `value` and its `ticker`. Pure, Worker-only: the page receives the filled data and
// never an issuance; an MPT amount that is not filled is drawn in units, which is why `resolveMpt` says whether any was left (`unresolved`) and the transaction page is then not kept for a year.
//
// The second half of the file is the MPT page's own view (E14 spec 3, Task 9): `mptPage` and the pieces the holders' and the transfers' pages share. The last part is the MPT tab of the token list
// (E14 spec 4, Task 12): `mptTokensTab`, which `tokensPage` (token-view.ts) calls for `kind=mpt`.

import BigNumber from "bignumber.js";

import { decodeHex } from "../domain/describe/helpers";
import { compactNumber, formatAmount } from "../domain/format";
import {
  ASSET_CLASS_WORDS,
  MAX_SCALE,
  MPT_FLAG_PILLS,
  MPT_FLAG_WORDS,
  MPT_FLAGS_LEGEND,
  MPT_KIND_WORDS,
  mptPath,
  percentText,
  safeLink,
  scaleUnits,
  shortMptId,
  superscript,
  transferFeeText,
} from "../domain/mpt";
import { isMptIssuanceId, mptIssuerOf } from "../domain/mpt-id";
import { mptLink } from "../domain/mpt-link";
import { mptHoldersHref, mptTransfersHref } from "../domain/mpt-params";
import { trailPaging, type Paging } from "../domain/paging";
import { shownIssuer, withoutBidiControls, type NamesPart } from "../domain/names";
import type { MeterData } from "../ui/charts/types";
import { findNetwork, type NetworkBrief, type NetworkInfo } from "../ui/networks";
import type { Loaded } from "./account-view";
import type { MptFlags, MptHoldersPage, MptIssuanceAnswer, MptSummary, MptTokenRow, MptTokensPage, MptTransfersPage, NodeMptIssuance } from "./api-types";
import { coverageNote, type CoverageNoteText } from "./coverage";
import { MPT_LOOKUP_MAX } from "./data-api";
import { networkInfoOf } from "./network-route";
import type { NetworkId } from "./networks";
import type { TokensNet, TokensPageData } from "./token-view";
import { unixOf } from "./validator-facts";

export { MPT_LOOKUP_MAX };

/** What the lookup answered, by issuance ID in capitals: the summary of an issuance the index knows, the ID alone for one it has no state for. */
export type MptLookupMap = ReadonlyMap<string, MptSummary | { mpt_issuance_id: string }>;

/**
 * What a page's lookup came to: `off` (no call was made: `MPT` is off, the network has none, or the page shows no MPT amount), `ok` with the answers, or `failed` (the call was made and did not
 * answer; the loader has logged it and marked the page degraded).
 */
export type MptLookupResult = { state: "off" } | { state: "ok"; map: MptLookupMap } | { state: "failed" };

type Plain = Record<string, unknown>;

/** A plain object of page data (a segment, a flow amount, a row), not an array and not an instance of a class. */
function isPlain(value: unknown): value is Plain {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** An MPT amount's carrier: the issuance ID, in capitals, and which of the four shapes carries it. */
type Carrier = { id: string; form: "segment" | "flat" | "nested" | "change" };

/**
 * The issuance an object carries, if it is one of the four carriers of an MPT amount or reference (`undefined` for any other object, and for an ID that is not 48 hex digits: the lookup takes no
 * other, and one stray ID would fail it whole):
 * - a segment `{ t: "mpt", id }` (a sentence, a detail);
 * - an object whose `mpt` is an ID string: an MPT `FlowAmount` `{ mpt, issuer, units }`, a payment row's amount, a Tokens-card holding, a touched object `{ mpt }`;
 * - an object whose `mpt` is `{ id, units }`: E10's `DisplayAmount` of an escrow;
 * - a balance change `{ mpt: true, currency }`, whose `currency` is the ID.
 */
function carrierOf(o: Plain): Carrier | undefined {
  if (o.t === "mpt" && isMptIssuanceId(o.id)) return { id: o.id.toUpperCase(), form: "segment" };
  const { mpt } = o;
  if (isMptIssuanceId(mpt)) return { id: mpt.toUpperCase(), form: "flat" };
  if (mpt === true && isMptIssuanceId(o.currency)) return { id: o.currency.toUpperCase(), form: "change" };
  if (isPlain(mpt) && isMptIssuanceId(mpt.id)) return { id: mpt.id.toUpperCase(), form: "nested" };
  return undefined;
}

/**
 * The issuance IDs of the MPT amounts and references in some page data (arrays and plain objects, walked to any depth; a string is never read, so the raw JSON of a transaction holds none): upper
 * case, sorted, each once, the first `MPT_LOOKUP_MAX` of them. The lookup takes 1 to 100, so a page that shows more keeps the rest in units.
 */
export function mptAmountsOf(...parts: unknown[]): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const inner of value) visit(inner);
      return;
    }
    if (!isPlain(value)) return;
    const carrier = carrierOf(value);
    if (carrier !== undefined) found.add(carrier.id);
    for (const inner of Object.values(value)) visit(inner);
  };
  for (const part of parts) visit(part);
  return [...found].sort().slice(0, MPT_LOOKUP_MAX);
}

/** What the lookup knows of an issuance: its summary when it has a scale, else nothing (an ID answered bare, an ID not asked, or no answer). */
function summaryOf(lookup: MptLookupResult, id: string): MptSummary | undefined {
  if (lookup.state !== "ok") return undefined;
  const entry = lookup.map.get(id);
  return entry !== undefined && "asset_scale" in entry ? entry : undefined;
}

/** The longest ticker D9 stores, in code points (`MPT_TICKER_MAX`, mpt-state.job.ts:483 at the pin). Nothing on the explorer's path checks a length (mpt-shape.ts takes any text), so a page cuts it again. */
export const MPT_TICKER_MAX = 16;

/**
 * The ticker a page draws: the issuer's text without its bidi controls, cut to `MPT_TICKER_MAX` code points as D9 cuts it (`cutText` does not split a character outside the BMP), and none when nothing
 * visible is left. D9 leaves out an empty ticker but keeps a blank one, which would draw an amount like "25,000.00 " with a link nobody can see.
 */
export function tickerText(raw: string | undefined): string | undefined {
  return cutText(raw, MPT_TICKER_MAX);
}

/** `fields` that are defined, merged into a copy of `target`: a ticker the issuance has none of, and a value above the largest scale, are left out. */
const filled = (target: Plain, fields: Plain): Plain => ({ ...target, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) });

/**
 * Fills the MPT amounts of some page data from a lookup, in a copy (the data is not changed):
 * - an amount with `units` (a segment, a flow amount, a holding, a payment row, E10's `{ id, units }`) gets `value`, the units scaled by the issuance's `asset_scale` (left out above 19, where the
 *   page shows the units), and the issuance's `ticker`;
 * - a balance change gets `scaled` (its `value` scaled), `scaledAfter` (its `after` scaled) and `ticker`;
 * - a carrier with no units (a reference segment, a touched object) gets its `ticker`.
 *
 * `unresolved` says whether any MPT amount or reference was left in units: the lookup failed, or an ID in the data got no scale from it (answered bare, or not asked: past the first 100). A lookup
 * that is `off` leaves everything as it was and is never unresolved.
 */
export function resolveMpt<T>(view: T, lookup: MptLookupResult): { view: T; unresolved: boolean } {
  if (lookup.state === "off") return { view, unresolved: false };
  let unresolved = lookup.state === "failed";

  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!isPlain(value)) return value;
    const copy: Plain = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, resolve(inner)]));
    const carrier = carrierOf(value);
    if (carrier === undefined) return copy;

    const summary = summaryOf(lookup, carrier.id);
    if (summary === undefined) {
      unresolved = true;
      return copy;
    }
    const { asset_scale: scale } = summary;
    const ticker = tickerText(summary.ticker);
    switch (carrier.form) {
      case "change":
        return filled(copy, {
          scaled: typeof value.value === "string" ? (scaleUnits(value.value, scale) ?? undefined) : undefined,
          scaledAfter: typeof value.after === "string" ? (scaleUnits(value.after, scale) ?? undefined) : undefined,
          ticker,
        });
      case "nested": {
        const inner = copy.mpt as Plain;
        return { ...copy, mpt: typeof inner.units === "string" ? filled(inner, { value: scaleUnits(inner.units, scale) ?? undefined, ticker }) : filled(inner, { ticker }) };
      }
      default:
        return filled(copy, { value: typeof value.units === "string" ? (scaleUnits(value.units, scale) ?? undefined) : undefined, ticker });
    }
  };

  const resolved = resolve(view) as T;
  return { view: resolved, unresolved };
}

// ---- The MPT page (E14 spec 3, Task 9) ----------------------------------------------------------------------------------------------------------------------------------------------------
//
// `mptPage` builds what `MptPage` draws from an issuance (the index's answer, or the node's entry when the index has none), the first rows of its holders and of its transfers, and the names the loader
// asked for. Pure, no I/O, no clock: every label, line and href is text in the data, and an amount is scaled only by `scaleUnits` (BigNumber), so no float reaches a label. What the issuer wrote
// (ticker, name, metadata) is text, shown as React text; the only thing of it that reaches an attribute is the `href` of a link `safeLink` accepted, and the category of a link when it is one of
// XLS-89's own four words. `mptHead`, `mptHolderRows`, `mptTransferRows` and `mptFacts` are exported for the holders' and the transfers' page (Task 11) and the link-preview card (Task 14).

/** What the page reads of the network: its names (`networkInfoOf`), nothing of its URLs. */
export type MptNet = NetworkInfo;

/** Where an issuance was read from: the index (`GET /v2/mpt/{id}`), or, when the index has no answer, the node's `ledger_entry` at the ledger it was validated in. */
export type MptSource = { origin: "index"; answer: MptIssuanceAnswer } | { origin: "node"; node: NodeMptIssuance; ledgerIndex: number; id: string };

/** The longest name D9 stores, in code points (`MPT_NAME_MAX` at the pin). */
const MPT_NAME_MAX = 128;

/**
 * The one rule for the issuer's ticker and name, on every page: `raw` without its bidi controls (`withoutBidiControls`, as E9's names and E11's toml names are read: they would turn the words around the
 * text, in a sentence, a `<title>` or a description), then cut to `max` code points as D9 cuts it (the controls do not use up the length), and none when nothing visible is left. The raw hex of the
 * metadata keeps the bytes.
 */
function cutText(raw: string | undefined, max: number): string | undefined {
  if (raw === undefined) return undefined;
  const plain = withoutBidiControls(raw);
  const cut = plain.length <= max ? plain : Array.from(plain).slice(0, max).join("");
  return cut.trim() === "" ? undefined : cut;
}

const DASH = "—";
/** A whole number with its thousands grouped. */
const counted = (n: number): string => formatAmount(String(n));
/** `units` as the page writes them: scaled with exactly the scale's decimals and grouped, or, for a scale the pages do not apply (`null`), the units as the ledger holds them, grouped. */
const unitsText = (units: string, scale: number | null): string => formatAmount(scale === null ? units : (scaleUnits(units, scale) ?? units));

/** What the head of an MPT page, and of its holders' and transfers' pages, says of the issuance. */
export interface MptHead {
  /** The last piece of the breadcrumb: the ticker, else "MPT". */
  crumb: string;
  /** The token circle: the ticker's first letter, else "?". */
  letter: string;
  /** The `<h1>`: the name, else the ticker, else "MPT 0000012A…3F09". */
  heading: string;
  ticker?: string;
  /** The name the issuance's metadata gives it (cut to 128 code points, as D9 cuts it). */
  name?: string;
  /** The name or the ticker came from the issuance's metadata (the index decoded it): "· name and ticker from the issuance's metadata". */
  fromMetadata: boolean;
  issuer: string;
  /** The issuance ID, in capitals. */
  id: string;
  /** The ticker, else "units": what the lines write where the board writes HTF, when they name the token. */
  tickerOrUnits: string;
  /** The word an amount is written with (a tile's line, a column header, the description, the card): `tickerOrUnits`, and "units" above scale 19, where the amounts are the ledger's integers and not the token's. */
  amountWord: string;
  /** The asset scale the amounts are scaled by; `null` above 19, where the pages show the units as they are. */
  scale: number | null;
}

/** The ID of the issuance a source is of, in capitals. */
const idOf = (source: MptSource): string => (source.origin === "index" ? source.answer.issuance.mpt_issuance_id : source.id).toUpperCase();

/** The head of an issuance's pages. From the node there is no name or ticker (the metadata is hex there), so the heading is the ID's start and end. */
export function mptHead(source: MptSource): MptHead {
  const id = idOf(source);
  if (source.origin === "node") {
    return { crumb: "MPT", letter: "?", heading: `MPT ${shortMptId(id)}`, fromMetadata: false, issuer: source.node.Issuer, id, tickerOrUnits: "units", amountWord: "units", scale: scaleOf(source.node.AssetScale ?? 0) };
  }
  const { issuance } = source.answer;
  const ticker = tickerText(issuance.ticker ?? issuance.metadata?.ticker);
  const name = cutText(issuance.name ?? issuance.metadata?.name, MPT_NAME_MAX);
  const scale = scaleOf(issuance.asset_scale);
  return {
    crumb: ticker ?? "MPT",
    letter: ticker === undefined ? "?" : (Array.from(ticker)[0] ?? "?"),
    heading: name ?? ticker ?? `MPT ${shortMptId(id)}`,
    ...(ticker === undefined ? {} : { ticker }),
    ...(name === undefined ? {} : { name }),
    fromMetadata: ticker !== undefined || name !== undefined,
    issuer: issuance.issuer,
    id,
    tickerOrUnits: ticker ?? "units",
    amountWord: scale === null ? "units" : (ticker ?? "units"),
    scale,
  };
}

/** The scale the pages apply: 0 to 19, else `null`. */
const scaleOf = (scale: number): number | null => (scale <= MAX_SCALE ? scale : null);

// ---- What the figures are -----------------------------------------------------------------------------------------------------------------------------------------------------------

/** The bits of an `MPTokenIssuance` entry's `Flags`: `lsfMPTLocked` and the abilities set at creation (rippled's `lsfMPTCan…`). */
const NODE_FLAG_BITS: Readonly<Record<keyof MptFlags, number>> = {
  locked: 0x01,
  can_lock: 0x02,
  require_auth: 0x04,
  can_escrow: 0x08,
  can_trade: 0x10,
  can_transfer: 0x20,
  can_clawback: 0x40,
};

/** An entry's `Flags` as the index names them. */
export function nodeFlags(flags: number): MptFlags {
  const has = (key: keyof MptFlags) => (flags & NODE_FLAG_BITS[key]) !== 0;
  return { locked: has("locked"), can_lock: has("can_lock"), require_auth: has("require_auth"), can_escrow: has("can_escrow"), can_trade: has("can_trade"), can_transfer: has("can_transfer"), can_clawback: has("can_clawback") };
}

/** What the tiles and the lines read, the same from either source. `null` is what the source does not say. */
interface Figures {
  scale: number;
  outstanding: string;
  max: string | null;
  /** What the issuer has locked of the holders' balances. */
  locked: string | null;
  lockedHolders: number | null;
  /** What is in escrow. */
  escrowed: string;
  holders: number | null;
  fee: number;
  flags: MptFlags;
}

/** The figures of a source. The node leaves a field at its default out (FINDINGS (4)): an amount, the scale and the fee read 0. */
function figuresOf(source: MptSource): Figures {
  if (source.origin === "index") {
    const i = source.answer.issuance;
    return {
      scale: i.asset_scale,
      outstanding: i.outstanding_amount,
      max: i.maximum_amount ?? null,
      locked: i.locked_amount,
      lockedHolders: i.locked_holders,
      escrowed: i.escrowed_amount,
      holders: i.holders,
      fee: i.transfer_fee,
      flags: i.flags,
    };
  }
  const n = source.node;
  return {
    scale: n.AssetScale ?? 0,
    outstanding: n.OutstandingAmount ?? "0",
    max: n.MaximumAmount ?? null,
    locked: null,
    lockedHolders: null,
    escrowed: n.LockedAmount ?? "0",
    holders: null,
    fee: n.TransferFee ?? 0,
    flags: nodeFlags(n.Flags),
  };
}

/** A figure of the board: its label, its value and the line under it. */
export interface MptTile {
  label: string;
  value: string;
  line: string;
}

const isPositive = (units: string): boolean => new BigNumber(units).gt(0);

/** The six figures in the board's order, with the lines of spec 3.1. `T` is the ticker, else "units", where a line names the token; `U` is the word of an amount, "units" too above scale 19. */
function tilesOf(f: Figures, head: MptHead, from: MptSource["origin"]): MptTile[] {
  const T = head.tickerOrUnits;
  const U = head.amountWord;
  const text = (units: string) => unitsText(units, head.scale);
  const fromNode = from === "node";

  // Outstanding: of the max amount when there is one.
  const percent = f.max === null ? DASH : percentText(f.outstanding, f.max, 1);
  const outstandingLine = percent === DASH ? `${U} held by holders; no max amount is set` : `${U} held by holders, ${percent} of the max amount`;

  // Locked: what the issuer has locked, then what is in escrow.
  let locked: { value: string; line: string };
  if (f.flags.locked) locked = { value: text(fromNode ? f.outstanding : (f.locked ?? f.outstanding)), line: "Every balance is locked" };
  else if (fromNode) {
    // The issuance entry does not say which holders are locked: only the issuer's own switches can be told.
    locked = f.flags.can_lock ? { value: DASH, line: "not in the index yet" } : { value: "0", line: `The issuer cannot lock ${T}` };
  } else if (f.lockedHolders !== null && f.lockedHolders > 0) {
    locked = { value: text(f.locked ?? "0"), line: `${U} in ${counted(f.lockedHolders)} holder ${f.lockedHolders === 1 ? "balance" : "balances"} the issuer has locked` };
  } else {
    locked = { value: text(f.locked ?? "0"), line: f.flags.can_lock ? "Nothing is locked" : `The issuer cannot lock ${T}` };
  }
  if (isPositive(f.escrowed)) locked.line += `; ${text(f.escrowed)} ${U} in escrow`;

  const scaleLine =
    head.scale === null
      ? "Amounts are shown as the ledger's integer units."
      : head.scale === 0
        ? `Amounts are whole numbers: 1 ${T} is 1 on the ledger.`
        : `Amounts are integers scaled by 10${superscript(-head.scale)}: 1 ${T} is ${formatAmount(new BigNumber(10).pow(head.scale).toFixed())} on the ledger.`;

  return [
    { label: "Outstanding", value: text(f.outstanding), line: outstandingLine },
    { label: "Max amount", value: f.max === null ? "Not set" : text(f.max), line: f.max === null ? "Up to the ledger's limit" : `${U}, fixed when the issuance was created` },
    { label: "Locked", ...locked },
    fromNode || f.holders === null
      ? { label: "Holders", value: DASH, line: "not in the index yet" }
      : { label: "Holders", value: counted(f.holders), line: `accounts holding ${T}` },
    { label: "Transfer fee", value: transferFeeText(f.fee), line: f.fee === 0 ? `holders pay no fee to send ${T}` : `charged when holders send ${T} to each other` },
    { label: "Asset scale", value: String(f.scale), line: scaleLine },
  ];
}

/** The Flags card: the intro of decision 3 and the six rows of `MPT_FLAG_WORDS`, each Yes or No with its line, the ticker (else "units") in place of `{T}`. */
function flagsOf(flags: MptFlags, T: string): { intro: string; rows: { label: string; yes: boolean; line: string }[] } {
  return {
    intro: "What the issuer allows, as the issuance says now.",
    // A function as the replacement: the ticker is the issuer's text, and `$&` in a string would mean something there.
    rows: MPT_FLAG_WORDS.map((words) => ({ label: words.label, yes: flags[words.key], line: (flags[words.key] ? words.yes : words.no).replaceAll("{T}", () => T) })),
  };
}

/** A notice above the figures: its sentence, the ledger it names (the page links its `#N`), and its tone: `info` for an issuance read from the network, `warning` for the issuance's own state. */
export interface MptNotice {
  text: string;
  ledger?: number;
  tone: "info" | "warning";
}

function noticesOf(source: MptSource, f: Figures, T: string): MptNotice[] {
  const notices: MptNotice[] = [];
  if (source.origin === "node") notices.push({ text: "Not in the index yet, shown from the network", tone: "info" });
  if (source.origin === "index" && source.answer.issuance.destroyed) {
    const ledger = source.answer.issuance.last_ledger;
    notices.push({ text: `This issuance was destroyed in ledger #${formatAmount(String(ledger))}.`, ledger, tone: "warning" });
  }
  if (f.flags.locked) notices.push({ text: `The issuer has locked every ${T} balance.`, tone: "warning" });
  return notices;
}

// ---- The metadata ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A row of the decoded metadata: the key as XLS-89 writes it, the text, and, for a link `safeLink` accepted, its `href` and the category of the link when it is one of XLS-89's four words. */
export interface MptMetadataRow {
  key: string;
  text: string;
  href?: string;
  title?: string;
  /** The text is code (indented JSON): drawn in a `.code` block. */
  code?: boolean;
}

export type MptMetadataView =
  | { state: "decoded"; rows: MptMetadataRow[]; conforms: boolean; hex: string; bytes: number }
  | { state: "none" }
  | { state: "raw"; text: string | null; hex: string; bytes: number; fromNode: boolean };

/** How many characters of `additional_info` as JSON a page shows. */
export const ADDITIONAL_INFO_MAX = 2000;

/** XLS-89's categories of a link: the only words of a link's category that become a `title`, so that nothing the issuer wrote reaches an attribute but a safe `href`. */
const URI_CATEGORIES: ReadonlySet<string> = new Set(["website", "social", "docs", "other"]);

/** The rows of XLS-89's text fields, in its order. */
const TEXT_KEYS = ["ticker", "name", "desc", "icon", "asset_class", "asset_subclass", "issuer_name"] as const;

const bytesOf = (hex: string): number => Math.floor(hex.length / 2);

/** `value` without its bidi controls (the one rule for issuer text, see `cutText`), cut to `max` code points. */
const cut = (value: string, max: number): string => {
  const plain = withoutBidiControls(value);
  return plain.length <= max ? plain : Array.from(plain).slice(0, max).join("");
};

/** The row of `additional_info`: an object (or a list) as indented JSON in a code block, cut; a string as text; a number or a boolean as text. */
function additionalInfoRow(value: unknown): MptMetadataRow | null {
  if (typeof value === "string") return { key: "additional_info", text: cut(value, ADDITIONAL_INFO_MAX) };
  if (typeof value === "number" || typeof value === "boolean") return { key: "additional_info", text: String(value) };
  if (typeof value !== "object" || value === null) return null;
  return { key: "additional_info", text: cut(JSON.stringify(value, null, 2), ADDITIONAL_INFO_MAX), code: true };
}

/** Hex as the UTF-8 text it holds, without its bidi controls; `null` when it is not text. The hex itself, beside it, keeps the bytes. */
const decodedText = (hex: string): string | null => {
  const text = decodeHex(hex);
  return text === undefined ? null : withoutBidiControls(text);
};

/** What the issuer wrote, as the card draws it. From the index it is the decoded metadata (long keys, lenient); from the node it is hex, and its text when that reads as UTF-8 text. */
function metadataOf(source: MptSource): MptMetadataView {
  if (source.origin === "node") {
    const hex = source.node.MPTokenMetadata;
    return hex === undefined || hex === "" ? { state: "none" } : { state: "raw", text: decodedText(hex), hex, bytes: bytesOf(hex), fromNode: true };
  }
  const { metadata, metadata_hex: hex = "", metadata_conforms: conforms } = source.answer.issuance;
  if (metadata === undefined) return hex === "" ? { state: "none" } : { state: "raw", text: decodedText(hex), hex, bytes: bytesOf(hex), fromNode: false };

  const rows: MptMetadataRow[] = [];
  for (const key of TEXT_KEYS) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    // The text is read without its bidi controls; the link is made of what the issuer wrote, which `safeLink` checks.
    const text = withoutBidiControls(value);
    if (key === "asset_class") rows.push({ key, text: ASSET_CLASS_WORDS[text] ?? text });
    else if (key === "icon") {
      const href = safeLink(value);
      rows.push(href === null ? { key, text } : { key, text, href });
    } else rows.push({ key, text });
  }
  for (const entry of metadata.uris ?? []) {
    const href = safeLink(entry.uri);
    // "{title} · {host/path}": the link as the issuer wrote it, without its scheme and without bidi controls, which would turn the host that the link shows.
    const where = withoutBidiControls(href === null ? entry.uri : entry.uri.replace(/^https:\/\//, ""));
    const title = entry.title === undefined ? "" : withoutBidiControls(entry.title);
    const text = title === "" ? where : `${title} · ${where}`;
    const category = entry.category?.toLowerCase();
    rows.push({ key: "uris", text, ...(href === null ? {} : { href }), ...(href !== null && category !== undefined && URI_CATEGORIES.has(category) ? { title: category } : {}) });
  }
  const info = metadata.additional_info === undefined ? null : additionalInfoRow(metadata.additional_info);
  if (info !== null) rows.push(info);
  return { state: "decoded", rows, conforms: conforms !== false, hex, bytes: bytesOf(hex) };
}

// ---- The holders and the transfers --------------------------------------------------------------------------------------------------------------------------------------------------

/** A card of the page that stands or fails on its own: `missing` is the index having no rows for the issuance ("Not in the index yet."), `failed` a call that did not answer. */
export type MptCard<T> = ({ state: "ok" } & T) | { state: "missing" } | { state: "failed" };

/** A holder's row: the balance (`amount` and `escrowed_amount` together) scaled, what of it is in escrow, its share of the outstanding amount with the meter beside it, and whether the issuer locked it. */
export interface MptHolderRow {
  /** The place in the ranking; `null` where it is not known (a page behind a marker: the API gives no rank). */
  rank: number | null;
  holder: string;
  /** The ledger's integer units of the balance, escrow included. */
  units: string;
  balance: string;
  /** "incl. 12.00 in escrow", when some of the balance is. */
  escrow: string | null;
  /** The share of the outstanding amount, to two decimals: `33.62%`. */
  share: string;
  /** The share against the first row's balance, for the meter (decorative: the share is written beside it). */
  meter: MeterData;
  locked: boolean;
}

/** What a list of holders reads of the issuance. */
export interface MptListContext {
  head: MptHead;
  /** The outstanding amount, in units. */
  outstanding: string;
}

/**
 * The rows of a page of holders, the largest balance first as D9 gives them. `rankFrom` is the rank of the first row (1 on the first page), or `null` where it is not known. A balance is `amount` and
 * `escrowed_amount` together (BigNumber); the share is of the outstanding amount, from the exact integers.
 */
export function mptHolderRows(page: MptHoldersPage, { head, outstanding }: MptListContext, rankFrom: number | null): MptHolderRow[] {
  const units = page.holders.map((row) => new BigNumber(row.amount).plus(row.escrowed_amount).toFixed());
  const first = units[0] === undefined || units[0] === "0" ? "1" : units[0];
  return page.holders.map((row, at): MptHolderRow => {
    const share = percentText(units[at]!, outstanding, 2);
    const escrowed = isPositive(row.escrowed_amount) ? unitsText(row.escrowed_amount, head.scale) : null;
    return {
      rank: rankFrom === null ? null : rankFrom + at,
      holder: row.holder,
      units: units[at]!,
      balance: unitsText(units[at]!, head.scale),
      escrow: escrowed === null ? null : `incl. ${escrowed} in escrow`,
      share,
      meter: { value: units[at]!, max: first, label: `${share} of the outstanding ${head.tickerOrUnits}` },
      locked: row.locked,
    };
  });
}

/** "The top 3 hold 61.25% of the outstanding HTF.": the rows' balances summed over the outstanding amount, from two rows; none for fewer, or when there is nothing to share. */
export function topLineOf(rows: readonly MptHolderRow[], { head, outstanding }: MptListContext): string | null {
  if (rows.length < 2) return null;
  const sum = rows.reduce((total, row) => total.plus(row.units), new BigNumber(0)).toFixed();
  const percent = percentText(sum, outstanding, 2);
  return percent === DASH ? null : `The top ${rows.length} hold ${percent} of the outstanding ${head.tickerOrUnits}.`;
}

/** What a holders table says when it has no row: "Nobody holds HTF.", and "yet in the index" while the index does not hold the whole history. */
export function noHoldersLine(T: string, complete: boolean): string {
  return complete ? `Nobody holds ${T}.` : `Nobody holds ${T} yet in the index.`;
}

/** The note a holders table has under it while the index is incomplete, after the coverage note. */
export const HOLDERS_NOT_LISTED = "A holder whose balance has not changed since is not listed yet.";

/** A transfer's row: when, what kind, between whom, how much, and the transaction. */
export interface MptTransferRow {
  /** Unix seconds, for the time cell. */
  time: number;
  /** Transfer, Clawback, Lock, Unlock, Escrow, Escrow finished or Escrow cancelled. */
  kind: string;
  from: string | null;
  to: string | null;
  /** A lock or an unlock with no destination is of every holder: the cell says "every holder". */
  everyHolder: boolean;
  amount: string;
  /** A lock's amount is the balance locked, not a movement: muted. */
  muted: boolean;
  hash: string;
}

/** The rows of a page of transfers, newest first as D9 gives them. */
export function mptTransferRows(page: MptTransfersPage, head: MptHead): MptTransferRow[] {
  return page.transfers.map((row) => ({
    time: unixOf(row.executed_time),
    kind: MPT_KIND_WORDS[row.kind],
    from: row.source ?? null,
    to: row.destination ?? null,
    everyHolder: (row.kind === "lock" || row.kind === "unlock") && row.destination === undefined,
    amount: unitsText(row.amount, head.scale),
    muted: row.kind === "lock",
    hash: row.tx_hash,
  }));
}

/** The footnote of a transfers table: the board's, with the issuer by its name when it has one. */
export function transfersFootnote(head: MptHead, names: NamesPart): string {
  const T = head.tickerOrUnits;
  return `Newest first. A transfer from ${shownIssuer(head.issuer, names.map)} issues new ${T}. A clawback takes ${T} back. A lock stops a balance from moving; its amount is the balance locked.`;
}

export type MptHoldersCard = MptCard<{
  rows: MptHolderRow[];
  /** The outstanding amount scaled, as the tile writes it. */
  outstanding: string;
  topLine: string | null;
  /** How many accounts hold the token (the issuance's own figure); `null` from the node. */
  total: number | null;
  allHref: string;
  allLabel: string;
  empty: string | null;
  coverage: CoverageNoteText | null;
  /** Said after the coverage note, while there is one. */
  notes: string[];
}>;

export type MptTransfersCard = MptCard<{
  rows: MptTransferRow[];
  footnote: string;
  olderHref: string | null;
  empty: string | null;
  note: CoverageNoteText | null;
}>;

function holdersCard(net: MptNet, loaded: Loaded<MptHoldersPage>, f: Figures, head: MptHead): MptHoldersCard {
  if (loaded.state !== "ok") return { state: loaded.state };
  const context = { head, outstanding: f.outstanding };
  const rows = mptHolderRows(loaded.value, context, 1);
  const coverage = coverageNote(loaded.value.coverage, "holders");
  return {
    state: "ok",
    rows,
    outstanding: unitsText(f.outstanding, head.scale),
    topLine: topLineOf(rows, context),
    total: f.holders,
    allHref: mptHoldersHref(net.id, head.id),
    allLabel: f.holders === null ? "All holders →" : `All ${counted(f.holders)} ${f.holders === 1 ? "holder" : "holders"} →`,
    empty: rows.length === 0 ? noHoldersLine(head.tickerOrUnits, loaded.value.coverage.complete) : null,
    coverage,
    notes: coverage === null ? [] : [HOLDERS_NOT_LISTED],
  };
}

function transfersCard(net: MptNet, loaded: Loaded<MptTransfersPage>, head: MptHead, names: NamesPart): MptTransfersCard {
  if (loaded.state !== "ok") return { state: loaded.state };
  const rows = mptTransferRows(loaded.value, head);
  return {
    state: "ok",
    rows,
    footnote: transfersFootnote(head, names),
    olderHref: loaded.value.marker === undefined ? null : mptTransfersHref(net.id, head.id, { marker: loaded.value.marker }),
    empty: rows.length === 0 ? `No transfers of ${head.tickerOrUnits} in the index.` : null,
    note: coverageNote(loaded.value.coverage, "transfers"),
  };
}

// ---- The tags and the card ------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What the tags (`meta-mpt.ts`) and the link-preview card (`mptCard`, Task 14) read of the page. */
export interface MptFacts {
  /** The canonical path of the page, written here because the tags' module is a browser file and may not import `domain/mpt.ts` (bignumber.js): `/xrpl/mpt/0000012A…`. */
  href: string;
  /** The issuance ID in capitals: the last piece of that path, and of the link-preview image's (`/og/{net}/mpt/{ID}.png`, which the tags' module writes with `imageUrl`). */
  id: string;
  /** The title before its end ("· XRPL · explorer"): "XAU · Tokenized Gold (XAU) · MPT", and without a ticker or a name "MPT 0000012A…3F09". */
  title: string;
  /** "MPT issued by Harborline: 18,204,511.20 HTF outstanding, 3,412 holders · XRPL". */
  description: string;
  /** From the network the page is not for an index to keep. */
  noindex: boolean;
  /** What the link-preview image says: the ticker and the name as every page reads them (`tickerText`, `cutText`: without bidi controls, a ticker or a name of nothing else is none). */
  card: {
    /** The ticker, else the ID's start and end. */
    headline: string;
    name?: string;
    /** The issuer by its name when it has one, else its short address. */
    issuer: string;
    /** "18.2M HTF", compact. */
    outstanding: string;
    holders?: number;
    /** Unix seconds, when the index knows when the issuance was created. */
    created?: number;
  };
}

/** The facts of an issuance's tags and card. */
export function mptFacts(net: Pick<NetworkInfo, "id" | "name">, source: MptSource, names: NamesPart): MptFacts {
  const head = mptHead(source);
  const f = figuresOf(source);
  const U = head.amountWord;
  const named = head.name;
  const parts = [head.ticker, named].filter((part): part is string => part !== undefined);
  const issuer = shownIssuer(head.issuer, names.map);
  const outstanding = unitsText(f.outstanding, head.scale);
  const holders = f.holders === null ? "" : `, ${f.holders === 1 ? "1 holder" : `${counted(f.holders)} holders`}`;
  const scaled = head.scale === null ? null : scaleUnits(f.outstanding, head.scale);
  const created = source.origin === "index" && source.answer.issuance.created_time !== undefined ? unixOf(source.answer.issuance.created_time) : undefined;
  return {
    href: mptPath(net.id, head.id),
    id: head.id,
    title: parts.length === 0 ? `MPT ${shortMptId(head.id)}` : `${parts.join(" · ")} · MPT`,
    description: `MPT issued by ${issuer}: ${outstanding} ${U} outstanding${holders} · ${net.name}`,
    noindex: source.origin === "node",
    card: {
      headline: head.ticker ?? shortMptId(head.id),
      ...(named === undefined ? {} : { name: named }),
      issuer,
      outstanding: `${compactNumber(scaled ?? f.outstanding)} ${U}`,
      ...(f.holders === null ? {} : { holders: f.holders }),
      ...(created === undefined ? {} : { created }),
    },
  };
}

// ---- The page ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface MptPageData {
  kind: "mpt";
  network: NetworkInfo;
  origin: MptSource["origin"];
  head: MptHead;
  /** The caption of the cards: where the issuance was read from. */
  source: string;
  notices: MptNotice[];
  tiles: MptTile[];
  flags: { intro: string; rows: { label: string; yes: boolean; line: string }[] };
  metadata: MptMetadataView;
  holders: MptHoldersCard;
  transfers: MptTransfersCard;
  facts: MptFacts;
  names: NamesPart;
}

/** What `mptPage` is made of: the network, the issuance, the first rows of its holders and of its transfers (each stands or fails on its own), and the names the loader asked for. */
export interface MptPageInput {
  net: MptNet;
  source: MptSource;
  holders: Loaded<MptHoldersPage>;
  transfers: Loaded<MptTransfersPage>;
  names: NamesPart;
}

/** The page data of `/{net}/mpt/{ID}` (spec 3.1, 3.3) from the issuance and its first rows. */
export function mptPage({ net, source, holders, transfers, names }: MptPageInput): MptPageData {
  const head = mptHead(source);
  const f = figuresOf(source);
  return {
    kind: "mpt",
    network: networkInfoOf(net),
    origin: source.origin,
    head,
    source: source.origin === "index" ? `/v2/mpt/${head.id}` : `ledger_entry · mpt_issuance · ledger #${formatAmount(String(source.ledgerIndex))}`,
    notices: noticesOf(source, f, head.tickerOrUnits),
    tiles: tilesOf(f, head, source.origin),
    flags: flagsOf(f.flags, head.tickerOrUnits),
    metadata: metadataOf(source),
    holders: holdersCard(net, holders, f, head),
    transfers: transfersCard(net, transfers, head, names),
    facts: mptFacts(net, source, names),
    names,
  };
}

// ---- The holders' and the transfers' pages (E14 spec 3.4, Task 11) ----------------------------------------------------------------------------------------------------------------------

/** The rows of a page of holders and of a page of transfers (spec 1.2: 50 holders, 20 transfers). */
export const MPT_HOLDERS_PAGE = 50;
export const MPT_TRANSFERS_PAGE = 20;

/** What the tags of a list page read of it: the code the title names, the issuer, where the first page is (written here because the tags' module is a browser file), whether this page is behind a marker, and whether its head is from the network. */
export interface MptListMetaFacts {
  /** The ticker, else the heading ("Old Gilt Note", "MPT 0000012A…3F09"): what "Holders of …" and "Transfers of …" name. */
  code: string;
  issuer: string;
  href: string;
  more: boolean;
  /** The head is the network's, not the index's (the issuance's own page is `noindex` then, and a list the index has no rows for is not for an index to keep either). */
  noindex: boolean;
}

/** What the two list pages have alike: the head (the first line links back to the issuance's page), the heading and the line under it, the way back, and the tags' facts. */
export interface MptListPageBase {
  network: NetworkInfo;
  origin: MptSource["origin"];
  head: MptHead;
  /** The `<h1>`: "Holders of HTF" or "Transfers of HTF". */
  title: string;
  /** The line under it: how many accounts hold how much, or what is outstanding. */
  summary: string;
  /** The way back to the issuance's page. */
  back: { href: string; label: string };
  /** The caption of the list's card: the call it is made from. */
  source: string;
  notices: MptNotice[];
  names: NamesPart;
  meta: MptListMetaFacts;
}

/** The pager of a list, the coverage note and what it says under it. */
export interface MptHoldersListBody {
  rows: MptHolderRow[];
  /** Whether the rows have a rank: the first page does, a page behind a marker does not (the API gives none, and the trail does not tell the place). */
  ranked: boolean;
  empty: string | null;
  coverage: CoverageNoteText | null;
  notes: string[];
  pager: Paging;
}

export interface MptHoldersPageData extends MptListPageBase {
  kind: "mpt-holders";
  holders: MptCard<MptHoldersListBody>;
}

export interface MptTransfersListBody {
  rows: MptTransferRow[];
  empty: string | null;
  footnote: string;
  note: CoverageNoteText | null;
  pager: Paging;
}

export interface MptTransfersPageData extends MptListPageBase {
  kind: "mpt-transfers";
  transfers: MptCard<MptTransfersListBody>;
}

/** The trail a list page was reached with (`parseMptListParams`): the marker it has and the markers of the pages before it. */
export type MptListView = { marker?: string; back: readonly string[] };

/** The head, the heading and the tags' facts the two list pages share. */
function listBase(net: MptNet, source: MptSource, names: NamesPart, view: MptListView, kind: "holders" | "transfers"): MptListPageBase {
  const head = mptHead(source);
  const f = figuresOf(source);
  const U = head.amountWord;
  const code = head.ticker ?? head.heading;
  const outstanding = unitsText(f.outstanding, head.scale);
  const summary =
    f.holders === null ? `${outstanding} ${U} outstanding` : `${counted(f.holders)} ${f.holders === 1 ? "account holds" : "accounts hold"} ${outstanding} ${U}`;
  return {
    network: networkInfoOf(net),
    origin: source.origin,
    head,
    title: `${kind === "holders" ? "Holders" : "Transfers"} of ${code}`,
    summary,
    back: { href: mptPath(net.id, head.id), label: `Back to ${code}` },
    source: `/v2/mpt/${head.id}/${kind}`,
    notices: source.origin === "node" ? [{ text: "Not in the index yet, shown from the network", tone: "info" }] : [],
    names,
    meta: { code, issuer: head.issuer, href: kind === "holders" ? mptHoldersHref(net.id, head.id) : mptTransfersHref(net.id, head.id), more: view.marker !== undefined, noindex: source.origin === "node" },
  };
}

/** What `mptHoldersPage` is made of: the network, the issuance (for the head and the scale), the page of holders, the trail it was reached with, and the names. */
export interface MptHoldersPageInput {
  net: MptNet;
  source: MptSource;
  page: Loaded<MptHoldersPage>;
  view: MptListView;
  names: NamesPart;
}

/**
 * The page data of `/{net}/mpt/{ID}/holders` (spec 3.4): the head, 50 holders with their shares of the outstanding amount, Newer and Older by the trail, and the coverage note. The list stands
 * or fails on its own: a page the index has no rows for (a 404) is `missing` and one that failed is `failed`, and the head stands in both. The ranks are the place in the whole ranking only on
 * the first page; behind a marker there are none.
 */
export function mptHoldersPage({ net, source, page, view, names }: MptHoldersPageInput): MptHoldersPageData {
  const base = listBase(net, source, names, view, "holders");
  if (page.state !== "ok") return { kind: "mpt-holders", ...base, holders: { state: page.state } };
  const f = figuresOf(source);
  const rows = mptHolderRows(page.value, { head: base.head, outstanding: f.outstanding }, view.marker === undefined ? 1 : null);
  const coverage = coverageNote(page.value.coverage, "holders");
  return {
    kind: "mpt-holders",
    ...base,
    holders: {
      state: "ok",
      rows,
      ranked: view.marker === undefined,
      empty: rows.length === 0 ? noHoldersLine(base.head.tickerOrUnits, page.value.coverage.complete) : null,
      coverage,
      notes: coverage === null ? [] : [HOLDERS_NOT_LISTED],
      pager: trailPaging({ marker: view.marker, back: view.back, next: page.value.marker }, (to) => mptHoldersHref(net.id, base.head.id, to)),
    },
  };
}

export interface MptTransfersPageInput {
  net: MptNet;
  source: MptSource;
  page: Loaded<MptTransfersPage>;
  view: MptListView;
  names: NamesPart;
}

/** The page data of `/{net}/mpt/{ID}/transfers` (spec 3.4): the head, 20 transfers newest first with the footnote of the MPT page's card, Newer and Older by the trail, and the coverage note. */
export function mptTransfersPage({ net, source, page, view, names }: MptTransfersPageInput): MptTransfersPageData {
  const base = listBase(net, source, names, view, "transfers");
  if (page.state !== "ok") return { kind: "mpt-transfers", ...base, transfers: { state: page.state } };
  const rows = mptTransferRows(page.value, base.head);
  return {
    kind: "mpt-transfers",
    ...base,
    transfers: {
      state: "ok",
      rows,
      empty: rows.length === 0 ? `No transfers of ${base.head.tickerOrUnits} in the index.` : null,
      footnote: transfersFootnote(base.head, names),
      note: coverageNote(page.value.coverage, "transfers"),
      pager: trailPaging({ marker: view.marker, back: view.back, next: page.value.marker }, (to) => mptTransfersHref(net.id, base.head.id, to)),
    },
  };
}

// ---- Xahau ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What `NoMptPage` draws (spec 3.6): the page that says MPT is not on the network, with the ID asked for and the other network, where it may be. */
export interface NoMptPageData {
  kind: "no-mpt";
  network: NetworkBrief;
  /** The other network of the environment's kind: XRPL (XRPL Testnet in the sandbox). */
  other: NetworkBrief;
  /** The issuance ID asked for, in capitals. */
  id: string;
}

/** The data of `NoMptPage` for a request on a network without MPT. */
export function noMptPage(net: { id: NetworkId; kind: NetworkInfo["kind"]; other: NetworkId }, id: string): NoMptPageData {
  return { kind: "no-mpt", network: findNetwork(net.id, net.kind), other: findNetwork(net.other, net.kind), id };
}

// ---- The MPT tab of the token list (E14 spec 4) -----------------------------------------------------------------------------------------------------------------------------------------------

/**
 * A row of the tab's table. Every field is text ready to show but `href`, which is `mptLink`'s (null while `MPT` is off: text, no link). The ticker and the name are the issuer's, cut as D9 cuts
 * them and without bidi controls (as the issued list's toml name is); they are text, and nothing of them reaches an attribute. The pills carry their titles, so that the table imports nothing of
 * `domain/mpt.ts`.
 */
export interface MptRowView {
  /** The issuance ID, in capitals: the row's own key. */
  key: string;
  /** The place in the whole ranking, whatever the page, with its thousands grouped. */
  rank: string;
  /** The token circle: the ticker's first letter, else "?". */
  letter: string;
  /** Without a ticker the cell is the no-metadata one ("No metadata", `shortId`, the ID in full as its title), whatever the name. */
  ticker?: string;
  name?: string;
  /** The issuance ID in full, and as a label (`0000012A…3F09`). */
  id: string;
  shortId: string;
  href: string | null;
  issuer: string;
  holders: string;
  /** Scaled and compact (`18.2M`); the units as they are, compact, with "units" for an asset scale above 19. */
  outstanding: string;
  /** As the outstanding amount, or null where the issuance sets no maximum ("not set"). */
  max: string | null;
  /** The abilities it has, in the board's order, each with its title; none when it has none. */
  flags: Array<{ label: string; title: string }>;
  transfers: string;
}

/** `units` scaled by `scale` and compact (`compactNumber`), or, for a scale the pages do not apply, the units as they are, compact, with "units". */
function compactUnits(units: string, scale: number): string {
  const scaled = scaleUnits(units, scale);
  return scaled === null ? `${compactNumber(units)} units` : compactNumber(scaled);
}

/**
 * A row of the table: the ticker as every page reads it (`tickerText`: 16 code points, a blank one is none), the name cut to 128 as D9 cuts it, and the issuer the issuance ID holds, as every MPT title
 * has it (`mptIssuerOf`, never D9's `issuer` field): the row and the page it links never disagree about who issued the token.
 */
function tabRowOf(net: TokensNet, row: MptTokenRow): MptRowView {
  const id = row.mpt_issuance_id.toUpperCase();
  const ticker = tickerText(row.ticker);
  const name = cutText(row.name, MPT_NAME_MAX);
  return {
    key: id,
    rank: counted(row.rank),
    letter: ticker === undefined ? "?" : (Array.from(ticker)[0] ?? "?"),
    ...(ticker === undefined ? {} : { ticker }),
    ...(name === undefined ? {} : { name }),
    id,
    shortId: shortMptId(id),
    href: mptLink(net.id, id, net.features),
    issuer: mptIssuerOf(id),
    holders: counted(row.holders),
    outstanding: compactUnits(row.outstanding_amount, row.asset_scale),
    max: row.maximum_amount === undefined ? null : compactUnits(row.maximum_amount, row.asset_scale),
    flags: MPT_FLAG_PILLS.filter(({ key }) => row.flags[key]).map(({ label, title }) => ({ label, title })),
    transfers: counted(row.transfers_24h),
  };
}

/** The three tiles of the totals (spec 4). A total D9 does not have (before its first generation) is a dash; the lines under them are words only. */
function tabTilesOf(net: TokensNet, totals: MptTokensPage["totals"]): TokensPageData["tiles"] {
  return [
    { label: "MPT issuances", value: totals === undefined ? DASH : counted(totals.issuances), sub: `on ${net.name}, with any number of holders` },
    { label: "Holders", value: totals === undefined ? DASH : counted(totals.holders), sub: "accounts holding at least one MPT" },
    { label: "Transfers, 24 h", value: totals === undefined ? DASH : counted(totals.transfers_24h), sub: "MPT payments between accounts" },
  ];
}

/**
 * The note under the table: the matches of a search ("1 match", "12 matches"), or where the page stands in the ranking ("Showing 21–40 of 214 issuances"). `null` without a total (D9 leaves it
 * out before its first generation: no note, no pager), and for an empty page that is no search (the table says it is empty).
 */
function tabNoteOf(answer: MptTokensPage, q: string | undefined): { text: string } | null {
  const { total, tokens } = answer;
  if (total === undefined) return null;
  if (q !== undefined) return { text: `${counted(total)} ${total === 1 ? "match" : "matches"}` };
  const first = tokens[0];
  const last = tokens.at(-1);
  if (first === undefined || last === undefined) return null;
  return { text: `Showing ${counted(first.rank)}–${counted(last.rank)} of ${counted(total)} issuances` };
}

/**
 * What the MPT tab gives `TokensPage` (spec 4), for `kind=mpt`: the intro, the three tiles of the totals, the table's rows with its note, empty text and footnote, the coverage note (E8's, "issuances")
 * and the source line, with the search's label and placeholder. `answer` is D9's list; `null` is a search too long to ask, which has the head, the dashes and the form, and no table. `q` is the
 * search as the page repeats it (without bidi controls; none when it was too long). Pure; the links are written here and the table draws what it is given.
 */
export function mptTokensTab(
  answer: MptTokensPage | null,
  { net, q }: { net: TokensNet; q?: string },
): Pick<TokensPageData, "intro" | "tiles" | "coverage" | "source" | "mpt"> & { search: Pick<TokensPageData["search"], "label" | "placeholder"> } {
  return {
    intro: `Tokens on ${net.name}, ranked by holders. Tickers and names come from each issuance's metadata.`,
    source: "/v2/tokens?kind=mpt",
    tiles: tabTilesOf(net, answer?.totals),
    search: { label: "Ticker, name, issuer or issuance ID", placeholder: "Ticker, name, issuer or issuance ID" },
    coverage: answer === null ? null : coverageNote(answer.coverage, "issuances"),
    mpt:
      answer === null
        ? null
        : {
            rows: answer.tokens.map((row) => tabRowOf(net, row)),
            empty: answer.tokens.length === 0 ? (q === undefined ? "No MPTs in the index yet." : `No MPTs match “${q}”.`) : null,
            note: tabNoteOf(answer, q),
            footnote: MPT_FLAGS_LEGEND,
          },
  };
}
