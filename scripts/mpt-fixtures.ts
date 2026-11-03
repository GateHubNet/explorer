// The data API's and the node's answers for the MPT pages (E14): D9's routes (data-api `feat/explorer-data-2` at PIN c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30: its spec's section 7, `docs/api-reference.md`
// "MPT") for the issuances below, the MPT list of the token tab, the lookup, the nine recorded transactions and the node's `ledger_entry` of an issuance the index lacks. http-fixtures.ts calls
// `mptFixtures` and `mptNodeFixtures` from `generate()`, so `pnpm fixtures:sync` writes the files; test/fixtures/PROVENANCE.md ("MPT answers") says what they are made of, and
// test/unit/mpt-fixtures.test.ts checks them with mpt-shape.ts, the client's own checks. XRPL only: Xahau has no MPT, and its routes are not called.
//
// Recorded (`ledgers/xrpl-mpt/`, D9's 27 ledgers, read through `readLedgerSet`: newer than the day the other answers are dated to, so not among `SETS`; C2): the nine transactions of `MPT_RECORDED`
// are served as every recorded transaction is (`transactions/<HASH>.json`, its binary form, the node's `tx`), and the hashes of their nine ledgers (747) as `ledgers/<index>@transactions=true.json`,
// which the transaction page reads for its neighbours. `head` and every file made from the newest ledgers stay those of the other sets. The two recorded creates are the issuances `htf` and `shortKeys`,
// with D9's decoding of their metadata (a port of `decodeMptMetadata`) and what they were created with; the other four issuances of the recorded transactions are known to the lookup, with
// the facts of the nodes in their metadata (the issuance's node where the transaction touched it) and made-up counts of holders.
//
// Made up (seeded `mulberry32(seedOf("xrpl", "mpt", <name>))`, issuers the classic addresses of seeded AccountIDs, so that no fixture names them: the names' sources leave these files out, C4): `noMetadata`,
// `rawMetadata`, `nonConforming`, `destroyed`, `lockedAll` and `escrow`, each with its list of holders (`holders@limit=10`) and its transfers (`transfers@descending=true&limit=8`); `htf` has its 63 holders
// over two pages and 28 transfers over three; `nodeOnly` has only the node's entry (and is the issuance the active account `OBJECTS_ACCOUNT` owns, by hand in its `account_objects`), `nowhere` nothing.
// Every answer follows D9's key orders (`builtFixtureText`), and the rows of its lists are a line each (`MPT_ROW_LISTS`).
//
//   data-api/mpt/<ID>.json                                      the issuance, for the eight that have an answer
//   data-api/mpt/<ID>/holders@limit=10.json                     the first page of each (`htf`: `@limit=50.json` and `@limit=50&marker=<M>.json` too, which are its two pages)
//   data-api/mpt/<ID>/transfers@descending=true&limit=8.json    the newest transfers of each (`htf`: `&limit=20` and `&limit=20&marker=<M>` too: three pages)
//   data-api/mpt_lookup.json                                    `{ "<ID>": summary }`: what the mock's `GET /v2/mpt?ids=` composes its answers from (C5); an ID not in it is answered bare
//   data-api/tokens@kind=mpt&limit=20[&marker=<M>].json         the MPT tab: 25 issuances over two pages
//   data-api/tokens@kind=mpt&limit=20&q=HTF.json, …&q=zzz.json  a search with one match (`escrow`'s HTF, whose coverage is not complete) and one with none
//   data-api/transactions/<HASH>[@binary=true].json, data-api/ledgers/<index>@transactions=true.json, node/tx/<HASH>.json   the recorded transactions and their ledgers
//   node/ledger_entry/mpt_issuance_<ID>.json                    `nodeOnly`'s `MPTokenIssuance`, from the recorded create's fields with another sequence and the active account as its issuer

import { createHash } from "node:crypto";

import { decodeAccountID, encodeAccountID } from "ripple-address-codec";

import { mptIdOf, mptIssuerOf } from "../app/domain/mpt-id";
import type { MptFlags, MptHolder, MptIssuance, MptMetadata, MptSummary, MptTokenRow, MptTransfer, MptTransferKind } from "../app/server/api-types";
import { XRPL_ACCOUNT } from "../test/e2e/fixtures";
import { MPT_FIXTURE_IDS, MPT_RECORDED } from "../test/support/mpt-case-rules";
import { dataApiFile, nodeFile, type NetworkName } from "../test/support/upstream-core";
import {
  binaryTx,
  dataApiLastValidated,
  dataApiLedger,
  dataApiTx,
  encodeMarker,
  inLedgerOrder,
  isoTime,
  nodeTxResult,
  readLedgers,
  readLedgerSet,
  unixOf,
  type RawLedger,
  type RawTx,
} from "./http-fixtures";
import { mulberry32, seedOf } from "./synthetic";

export { MPT_FEE_PAYMENT_ISSUANCE, MPT_FIXTURE_IDS, MPT_LOCKED_HOLDING, MPT_MINT_ISSUANCE, MPT_RECORDED } from "../test/support/mpt-case-rules";

/** The recorded set: D9's 27 ledgers of XRPL mainnet, not among `SETS` of http-fixtures.ts (C2). */
export const MPT_SET = "xrpl-mpt";

/** The lists whose rows are one line each: the holders, the transfers, the tab's issuances and the lookup's. */
export const MPT_ROW_LISTS: readonly string[] = ["holders", "transfers", "tokens"];

/** The active hand-written XRPL account (test/e2e/fixtures.ts's `XRPL_ACCOUNT`): the issuer of `nodeOnly`, whose `MPTokenIssuance` it owns. */
export const MPT_ACCOUNT = XRPL_ACCOUNT;

/** Where D9's index starts for MPT: the ledger `MPTokensV1` was enabled in (99226369), from which every answer but `escrow`'s says it is complete. */
export const MPT_COVERAGE_FROM = 99_226_369;

/** The page sizes of the pages: the card's first page, the holders page's and the transfers page's. */
export const MPT_PAGES = { holders: [10, 50], transfers: [8, 20] } as const;

// ---- Small things -------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const HEX = "0123456789ABCDEF";
const hexOf = (next: () => number, digits: number): string => Array.from({ length: digits }, () => HEX[Math.floor(next() * 16)]!).join("");
const accountOf = (next: () => number): string => encodeAccountID(Uint8Array.from({ length: 20 }, () => Math.floor(next() * 256)));
const drawIn = (next: () => number, low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
const stream = (...parts: string[]): (() => number) => mulberry32(seedOf("xrpl", "mpt", ...parts));

const sha512Half = (bytes: Buffer): string => createHash("sha512").update(bytes).digest("hex").slice(0, 64).toUpperCase();
/** The key of an `MPTokenIssuance` entry: SHA-512Half of `0x007E` and the 24-byte ID (rippled's `keylet::mptIssuance`; checked against a recorded node). */
export const issuanceKey = (id: string): string => sha512Half(Buffer.from(`007E${id}`, "hex"));
/** The key of an `MPToken` entry: SHA-512Half of `0x0074`, the issuance's key and the holder's AccountID (`keylet::mptoken`; checked against a recorded node). */
export const mptokenKey = (id: string, holder: string): string => sha512Half(Buffer.concat([Buffer.from(`0074${issuanceKey(id)}`, "hex"), Buffer.from(decodeAccountID(holder))]));

const hexOfText = (text: string): string => Buffer.from(text, "utf8").toString("hex").toUpperCase();

// ---- D9's metadata: a port of `decodeMptMetadata` and `mptMetadataHexConforms` (packages/shared/src/util/mpt-metadata.ts at the PIN) ---------------------------------

const METADATA_MAX_BYTES = 1024;
const METADATA_TEXT_MAX = 1024;
const TICKER_MAX = 16;
const NAME_MAX = 128;
const TICKER = /^[A-Z0-9]{1,6}$/;
const ASSET_CLASSES: readonly string[] = ["rwa", "memes", "wrapped", "gaming", "defi", "other"];
const ASSET_SUBCLASSES: readonly string[] = ["stablecoin", "commodity", "real_estate", "private_credit", "equity", "treasury", "other"];
const URI_CATEGORIES: readonly string[] = ["website", "social", "docs", "other"];
const TEXT_KEYS: readonly (readonly [string, string])[] = [["ticker", "t"], ["name", "n"], ["desc", "d"], ["icon", "i"], ["asset_class", "ac"], ["asset_subclass", "as"], ["issuer_name", "in"]];
const METADATA_KEYS = ["ticker", "name", "desc", "icon", "asset_class", "asset_subclass", "issuer_name", "uris", "additional_info"] as const;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const cutText = (text: string, max: number): string => (text.length <= max ? text : Array.from(text).slice(0, max).join(""));
const textOf = (value: unknown): string | undefined => (typeof value === "string" ? cutText(value, METADATA_TEXT_MAX) : undefined);
const read = (object: Json, long: string, short: string): unknown => (object[long] !== undefined ? object[long] : object[short]);

function uriOf(uri: unknown, category: unknown, title: unknown): { uri: string; category?: string; title?: string } | undefined {
  const text = textOf(uri);
  if (text === undefined) return undefined;
  const item: { uri: string; category?: string; title?: string } = { uri: text };
  const categoryText = textOf(category);
  if (categoryText !== undefined) item.category = categoryText;
  const titleText = textOf(title);
  if (titleText !== undefined) item.title = titleText;
  return item;
}

function urisOf(object: Json): { uri: string; category?: string; title?: string }[] | undefined {
  const written = read(object, "uris", "us");
  const draft = written === undefined;
  const items = draft ? object.urls : written;
  if (!Array.isArray(items)) return undefined;
  const uris = items
    .filter(isObject)
    .map((item) => (draft ? uriOf(item.url, item.type, item.title) : uriOf(read(item, "uri", "u"), read(item, "category", "c"), read(item, "title", "t"))))
    .filter((item): item is { uri: string; category?: string; title?: string } => item !== undefined);
  return uris.length > 0 ? uris : undefined;
}

const additionalInfoOf = (value: unknown): Json | string | undefined => (isObject(value) ? value : textOf(value));

/** The JSON object in the hex; `undefined` when it is not at most 1024 bytes of UTF-8 holding one. */
function objectOfHex(hex: string): Json | undefined {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex) || hex.length > METADATA_MAX_BYTES * 2) return undefined;
  let object: unknown;
  try {
    object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(hex, "hex")));
  } catch {
    return undefined;
  }
  return isObject(object) ? object : undefined;
}

function fieldsOf(object: Json): MptMetadata {
  const fields: Record<string, unknown> = {
    ticker: textOf(read(object, "ticker", "t")),
    name: textOf(read(object, "name", "n")),
    desc: textOf(read(object, "desc", "d")),
    icon: textOf(read(object, "icon", "i")),
    asset_class: textOf(read(object, "asset_class", "ac")),
    asset_subclass: textOf(read(object, "asset_subclass", "as")),
    issuer_name: textOf(read(object, "issuer_name", "in")),
    uris: urisOf(object),
    additional_info: additionalInfoOf(read(object, "additional_info", "ai")),
  };
  for (const key of METADATA_KEYS) if (fields[key] === undefined) delete fields[key];
  return fields as MptMetadata;
}

/** What D9 makes of an issuance's `MPTokenMetadata`: the decoded object (the long names, in D9's order), or `undefined` when the hex is not at most 1024 bytes of UTF-8 holding a JSON object. */
export function decodeMptMetadata(hex: string): MptMetadata | undefined {
  const object = objectOfHex(hex);
  return object === undefined ? undefined : fieldsOf(object);
}

const present = (text: string | undefined): boolean => text !== undefined && text !== "";

function conforms(m: MptMetadata): boolean {
  if (m.ticker === undefined || !TICKER.test(m.ticker)) return false;
  if (!present(m.name) || !present(m.icon) || !present(m.issuer_name)) return false;
  if (m.asset_class === undefined || !ASSET_CLASSES.includes(m.asset_class)) return false;
  if (m.asset_subclass === undefined ? m.asset_class === "rwa" : !ASSET_SUBCLASSES.includes(m.asset_subclass)) return false;
  return (m.uris ?? []).every((item) => present(item.uri) && present(item.title) && item.category !== undefined && URI_CATEGORIES.includes(item.category));
}

function keepsAll(object: Json): boolean {
  const dropped = (value: unknown, kept: unknown): boolean => value !== undefined && kept === undefined;
  if (TEXT_KEYS.some(([long, short]) => dropped(read(object, long, short), textOf(read(object, long, short))))) return false;
  const info = read(object, "additional_info", "ai");
  if (dropped(info, additionalInfoOf(info))) return false;
  const uris = read(object, "uris", "us");
  const items = uris === undefined ? object.urls : uris;
  return items === undefined || (Array.isArray(items) && items.length === (urisOf(object)?.length ?? 0));
}

/** Whether every rule of XLS-89 holds of what the issuer wrote (D9's `mptMetadataHexConforms`): `false` for hex that does not decode. */
export function metadataConforms(hex: string): boolean {
  const object = objectOfHex(hex);
  return object !== undefined && keepsAll(object) && conforms(fieldsOf(object));
}

// ---- The issuances ------------------------------------------------------------------------------------------------------------------

/** The flag bits of an issuance's `Flags` (the ledger's `lsfMPT…`), as D9 names them. */
const FLAG_BITS = { locked: 0x1, can_lock: 0x2, require_auth: 0x4, can_escrow: 0x8, can_trade: 0x10, can_transfer: 0x20, can_clawback: 0x40 } as const;

/** The seven named flags of a `Flags` value, in D9's order. */
export function flagsOf(bits: number): MptFlags {
  return {
    locked: (bits & FLAG_BITS.locked) !== 0,
    can_lock: (bits & FLAG_BITS.can_lock) !== 0,
    require_auth: (bits & FLAG_BITS.require_auth) !== 0,
    can_escrow: (bits & FLAG_BITS.can_escrow) !== 0,
    can_trade: (bits & FLAG_BITS.can_trade) !== 0,
    can_transfer: (bits & FLAG_BITS.can_transfer) !== 0,
    can_clawback: (bits & FLAG_BITS.can_clawback) !== 0,
  };
}

/** What an issuance is, before any answer is made of it. */
interface Facts {
  id: string;
  issuer: string;
  sequence: number;
  scale: number;
  /** Absent when the issuance sets no maximum. */
  maximum?: string;
  /** In 1/100,000. */
  fee: number;
  flags: number;
  /** The issuer's `MPTokenMetadata`, hex (upper case). */
  metadataHex?: string;
  destroyed: boolean;
  /** The creation, when the coverage holds it. */
  created?: { ledger: number; time: string; hash: string };
}

/** An issuance with the lists of its answers: the holders (the largest balance first) and the transfers (newest first). */
interface World extends Facts {
  key: string;
  holders: MptHolder[];
  transfers: MptTransfer[];
  /** False for the one whose coverage is not complete (D9 says so for an index that does not reach back to the amendment). */
  complete: boolean;
}

/** The ticker and the name of an issuance's metadata, cut as D9's columns are. */
function columnsOf(hex: string | undefined): { ticker?: string; name?: string } {
  const decoded = hex === undefined ? undefined : decodeMptMetadata(hex);
  return {
    ...(decoded?.ticker !== undefined && { ticker: cutText(decoded.ticker, TICKER_MAX) }),
    ...(decoded?.name !== undefined && { name: cutText(decoded.name, NAME_MAX) }),
  };
}

const sumOf = (values: readonly string[]): bigint => values.reduce((sum, value) => sum + BigInt(value), 0n);

/** D9's summary of an issuance (`?ids=`), with the figures its holders and balances add up to. */
function summaryOf(facts: Facts, figures: { outstanding: string; holders: number }): MptSummary {
  const { ticker, name } = columnsOf(facts.metadataHex);
  return {
    mpt_issuance_id: facts.id,
    issuer: facts.issuer,
    ...(ticker !== undefined && { ticker }),
    ...(name !== undefined && { name }),
    asset_scale: facts.scale,
    ...(facts.maximum !== undefined && { maximum_amount: facts.maximum }),
    outstanding_amount: figures.outstanding,
    holders: figures.holders,
    transfer_fee: facts.fee,
    flags: flagsOf(facts.flags),
    destroyed: facts.destroyed,
  };
}

/** The summary of an issuance with its holders listed: the outstanding amount is what they hold, in escrow or not. */
function summaryOfWorld(world: World): MptSummary {
  return summaryOf(world, { outstanding: String(sumOf(world.holders.flatMap((holder) => [holder.amount, holder.escrowed_amount]))), holders: world.holders.length });
}

/** D9's issuance (`GET /v2/mpt/{id}`), the keys in its order. `lastLedger` is the newest ledger the fixtures record. */
function issuanceOf(world: World, lastLedger: number): MptIssuance {
  const { ticker, name } = columnsOf(world.metadataHex);
  const escrowed = sumOf(world.holders.map((holder) => holder.escrowed_amount));
  const lockedHolders = world.holders.filter((holder) => holder.locked && BigInt(holder.amount) > 0n);
  // `locked_amount` counts what cannot move: everything when the issuance is locked, else the holders locked on their own.
  const locked = (world.flags & FLAG_BITS.locked) !== 0 ? sumOf(world.holders.map((holder) => holder.amount)) : sumOf(lockedHolders.map((holder) => holder.amount));
  const decoded = world.metadataHex === undefined ? undefined : decodeMptMetadata(world.metadataHex);
  return {
    mpt_issuance_id: world.id,
    issuer: world.issuer,
    sequence: world.sequence,
    ...(ticker !== undefined && { ticker }),
    ...(name !== undefined && { name }),
    asset_scale: world.scale,
    ...(world.maximum !== undefined && { maximum_amount: world.maximum }),
    outstanding_amount: String(sumOf(world.holders.flatMap((holder) => [holder.amount, holder.escrowed_amount]))),
    escrowed_amount: String(escrowed),
    locked_amount: String(locked),
    locked_holders: lockedHolders.length,
    holders: world.holders.length,
    transfer_fee: world.fee,
    flags: flagsOf(world.flags),
    ...(decoded !== undefined && { metadata: decoded }),
    ...(world.metadataHex !== undefined && { metadata_hex: world.metadataHex, metadata_conforms: metadataConforms(world.metadataHex) }),
    ...(world.created !== undefined && { created_ledger: world.created.ledger, created_time: world.created.time, created_tx_hash: world.created.hash }),
    last_ledger: lastLedger,
    destroyed: world.destroyed,
  };
}

// ---- The recordings -----------------------------------------------------------------------------------------------------------------

interface Recorded {
  raw: RawLedger;
  tx: RawTx;
}

let recordedCache: { ledgers: RawLedger[]; byHash: Map<string, Recorded> } | undefined;

/** D9's 27 ledgers, and every transaction of them by hash. Read once. */
function recordings(): { ledgers: RawLedger[]; byHash: Map<string, Recorded> } {
  if (recordedCache === undefined) {
    const ledgers = readLedgerSet(MPT_SET);
    const byHash = new Map<string, Recorded>();
    for (const raw of ledgers) for (const tx of raw.ledger.transactions) byHash.set(tx.hash, { raw, tx });
    recordedCache = { ledgers, byHash };
  }
  return recordedCache;
}

/** One of the nine recorded transactions. */
function recordedTx(name: keyof typeof MPT_RECORDED): Recorded {
  const found = recordings().byHash.get(MPT_RECORDED[name].hash);
  if (found === undefined) throw new Error(`${MPT_SET} has no transaction ${MPT_RECORDED[name].hash} (${name})`);
  return found;
}

interface NodeFields {
  [field: string]: unknown;
}

/** The fields of the node of an affected node of a given type (the created node's `NewFields`, the modified one's `FinalFields`), the first of the type. */
function affected(tx: RawTx, type: string): NodeFields | undefined {
  for (const node of tx.metaData.AffectedNodes as Array<Record<string, { LedgerEntryType: string; NewFields?: NodeFields; FinalFields?: NodeFields }>>) {
    const [wrapped] = Object.values(node);
    if (wrapped!.LedgerEntryType === type) return wrapped!.NewFields ?? wrapped!.FinalFields;
  }
  return undefined;
}

/** The facts of an issuance from the fields its node holds (a field at its default is not there). */
function factsOfNode(id: string, fields: NodeFields): Facts {
  const flags = fields.Flags;
  return {
    id,
    issuer: String(fields.Issuer),
    sequence: Number(fields.Sequence),
    scale: typeof fields.AssetScale === "number" ? fields.AssetScale : 0,
    ...(typeof fields.MaximumAmount === "string" && { maximum: fields.MaximumAmount }),
    fee: typeof fields.TransferFee === "number" ? fields.TransferFee : 0,
    flags: typeof flags === "number" ? flags : 0,
    ...(typeof fields.MPTokenMetadata === "string" && { metadataHex: fields.MPTokenMetadata.toUpperCase() }),
    destroyed: false,
  };
}

/** The facts of a recorded `MPTokenIssuanceCreate`, with its creation. The ID is the node's, not the transaction's `Sequence` (a ticket makes that 0). */
function createdIssuance(name: "issuance_create" | "issuance_create_short_keys"): Facts {
  const { raw, tx } = recordedTx(name);
  const fields = affected(tx, "MPTokenIssuance");
  if (fields === undefined) throw new Error(`${name} has no created MPTokenIssuance`);
  const id = mptIdOf(Number(fields.Sequence), String(fields.Issuer));
  return { ...factsOfNode(id, fields), created: { ledger: Number(raw.ledger.ledger_index), time: isoTime(unixOf(raw.ledger.close_time)), hash: tx.hash } };
}

// ---- The made-up issuances ----------------------------------------------------------------------------------------------------------

/** The seeded issuer and sequence of a made-up issuance: `mptIdOf(sequence, issuer)` is its ID. */
export function madeUpIdentity(key: keyof typeof MPT_FIXTURE_IDS): { issuer: string; sequence: number } {
  const next = stream("identity", key);
  return { issuer: key === "nodeOnly" ? MPT_ACCOUNT : accountOf(next), sequence: drawIn(next, 90_000_000, 107_600_000) };
}

/** Metadata the issuer wrote, as the text the ledger holds, for the issuances that have some. */
const METADATA_TEXTS: Readonly<Record<"noMetadata" | "rawMetadata" | "nonConforming" | "destroyed" | "lockedAll" | "escrow", string | undefined>> = {
  noMetadata: undefined,
  // A URL as text (a recorded issuance's, `issuance_create_raw_metadata`, is one too): it does not decode.
  rawMetadata: "https://rawmeta.example/mpt/raw-token-metadata.json",
  // Decodes, and conforms to nothing: a ticker in lower case, an asset class that is none, no icon that is https; the longest texts an issuer can write in 1,024 bytes (a 128-character name with no
  // space to break at, a 200-character description, a 100-character title) and links that are not all links (`javascript:`, `http:`, a bare host and path), which the page must not trust.
  nonConforming: JSON.stringify({
    ticker: "mixd",
    name: `Nx${"w".repeat(126)}`,
    desc: `${"A description that runs on and on, as an issuer is free to write it, without ever coming to its point. ".repeat(2)}End.`.slice(0, 200),
    icon: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/icon.png",
    asset_class: "fancy",
    issuer_name: "Mixed Texts Ltd",
    uris: [
      { uri: "https://mixed.example/docs", category: "docs", title: `Title ${"t".repeat(94)}` },
      { uri: "javascript:alert(1)", category: "website", title: "Not a link" },
      { uri: "mixed.example/about", category: "other", title: "About" },
      { uri: "http://mixed.example/plain", category: "website", title: "Plain http" },
    ],
    additional_info: { fund_size: "unknown", notes: ["alpha", "beta"] },
  }),
  destroyed: JSON.stringify({ ticker: "OLDG", name: "Old Gilt Note", icon: "https://oldgilt.example/icon.png", asset_class: "defi", issuer_name: "Old Gilt Ltd" }),
  lockedAll: JSON.stringify({ ticker: "LKD", name: "Locked Notes", icon: "https://lockednotes.example/icon.png", asset_class: "other", issuer_name: "Locked Notes Ltd", uris: [{ uri: "https://lockednotes.example", category: "website", title: "Home" }] }),
  // The board's example (D9's spec, section 7): HTF, "Harborline Treasury Fund".
  escrow: JSON.stringify({
    ticker: "HTF",
    name: "Harborline Treasury Fund",
    desc: "A tokenized treasury fund.",
    icon: "https://harborline.example/htf/icon.png",
    asset_class: "rwa",
    asset_subclass: "treasury",
    issuer_name: "Harborline Capital",
    uris: [{ uri: "https://harborline.example/htf", category: "website", title: "Fund page" }],
  }),
};

/** What each made-up issuance is: its scale, maximum, fee, flags and state. Its holders and transfers follow in `worldOf`. */
const MADE_UP: Readonly<Record<keyof typeof METADATA_TEXTS, { scale: number; maximum?: string; fee: number; flags: number; destroyed?: true }>> = {
  noMetadata: { scale: 0, fee: 0, flags: FLAG_BITS.can_trade | FLAG_BITS.can_transfer },
  rawMetadata: { scale: 3, maximum: "90000000000", fee: 250, flags: FLAG_BITS.can_lock | FLAG_BITS.can_trade | FLAG_BITS.can_transfer },
  nonConforming: { scale: 6, maximum: "5000000000000", fee: 0, flags: FLAG_BITS.can_lock | FLAG_BITS.require_auth | FLAG_BITS.can_transfer },
  destroyed: { scale: 2, fee: 0, flags: FLAG_BITS.can_transfer, destroyed: true },
  lockedAll: { scale: 2, maximum: "400000000", fee: 0, flags: FLAG_BITS.locked | FLAG_BITS.can_lock | FLAG_BITS.can_transfer },
  escrow: { scale: 2, maximum: "5000000000", fee: 100, flags: FLAG_BITS.can_lock | FLAG_BITS.require_auth | FLAG_BITS.can_escrow | FLAG_BITS.can_trade | FLAG_BITS.can_transfer | FLAG_BITS.can_clawback },
};

/** The facts of a made-up issuance. */
function madeUpFacts(key: keyof typeof METADATA_TEXTS): Facts {
  const { issuer, sequence } = madeUpIdentity(key);
  const kind = MADE_UP[key];
  const text = METADATA_TEXTS[key];
  if (text !== undefined && Buffer.byteLength(text) > METADATA_MAX_BYTES) throw new Error(`the metadata of ${key} is ${Buffer.byteLength(text)} bytes: the ledger holds at most ${METADATA_MAX_BYTES}`);
  return {
    id: mptIdOf(sequence, issuer),
    issuer,
    sequence,
    scale: kind.scale,
    ...(kind.maximum !== undefined && { maximum: kind.maximum }),
    fee: kind.fee,
    flags: kind.flags,
    ...(text !== undefined && { metadataHex: hexOfText(text) }),
    destroyed: kind.destroyed === true,
  };
}

// ---- Holders and transfers ----------------------------------------------------------------------------------------------------------

/**
 * `count` holders with a total balance (amount and escrow together) each, the largest first and ties by address (D9's order), from a seeded stream, the balances adding up to about `total`: each is about 93% of
 * the one before, with a seeded wobble, so that the top ten hold most of it and the last hold little. Whole numbers and multiplications of them by doubles only, the same on every Node.
 */
function holdersOf(next: () => number, count: number, total: number, opts: { escrowed?: Record<number, string>; locked?: readonly number[]; locksAll?: boolean; unauthorized?: readonly number[] } = {}): MptHolder[] {
  const weights: Array<{ holder: string; weight: bigint }> = [];
  let level = 1_000_000_000;
  for (let at = 0; at < count; at += 1) {
    weights.push({ holder: accountOf(next), weight: BigInt(Math.max(1, Math.floor(level * (0.6 + next() * 0.8)))) });
    level = level * 0.93;
  }
  const weighed = weights.reduce((sum, { weight }) => sum + weight, 0n);
  const balances = weights.map(({ holder, weight }) => {
    const share = (weight * BigInt(total)) / weighed;
    return { holder, balance: share > 0n ? share : 1n };
  });
  balances.sort((a, b) => (a.balance === b.balance ? (a.holder < b.holder ? -1 : 1) : a.balance > b.balance ? -1 : 1));
  return balances.map(({ holder, balance }, at) => {
    const escrowed = BigInt(opts.escrowed?.[at] ?? 0);
    if (escrowed > balance) throw new Error(`holder ${at} holds ${balance}, less than the ${escrowed} it has in escrow`);
    return {
      holder,
      amount: String(balance - escrowed),
      escrowed_amount: String(escrowed),
      locked: opts.locksAll === true || (opts.locked ?? []).includes(at),
      authorized: !(opts.unauthorized ?? []).includes(at),
    };
  });
}

/** How many ledgers a second takes, near enough: the model that puts a transfer's ledger and its time in step. */
const SECONDS_PER_LEDGER = 4;

/** The newest ledger of the fixtures and its time: the transfers go back from it, and every answer is as of it. */
function headOfFixtures(): { index: number; unix: number; time: string; hash: string; closeTime: string } {
  const head = readLedgers("xrpl").at(-1)!;
  return { index: Number(head.ledger.ledger_index), unix: unixOf(head.ledger.close_time), time: isoTime(unixOf(head.ledger.close_time)), hash: head.ledger_hash, closeTime: dataApiLastValidated(head).close_time };
}

/** What a transfer is meant to be, before it has a ledger, a hash and a time. */
interface Plan {
  kind: MptTransferKind;
  /** Who moves it and where: `issuer` for the issuer, a number for the party at that place (the holder at that place of the holders list), `none` for no destination. */
  from: "issuer" | number;
  to: "issuer" | number | "none";
  /** Units, or `outstanding` for a lock or an unlock of every balance. */
  amount: number | "outstanding";
  /** How many ledgers before the one that follows it in the list (the next-newest), at least 1. */
  after: number;
}

const TYPE_OF: Readonly<Record<MptTransferKind, string>> = {
  payment: "Payment",
  clawback: "Clawback",
  lock: "MPTokenIssuanceSet",
  unlock: "MPTokenIssuanceSet",
  escrow_create: "EscrowCreate",
  escrow_finish: "EscrowFinish",
  escrow_cancel: "EscrowCancel",
};

/**
 * The transfers of a plan, newest first: each `after` ledgers before the one above it, the first that many before the head. A payment between two holders pays the transfer fee on top (D9's `fee`,
 * only above 0); a mint and a redemption pay none. `fee` is the issuance's, in 1/100,000.
 */
function transfersOf(next: () => number, plan: readonly Plan[], who: { issuer: string; parties: readonly string[]; outstanding: bigint }, fee: number, head: { index: number; unix: number }): MptTransfer[] {
  let ledger = head.index;
  const used = new Set<string>();
  return plan.map((step) => {
    ledger -= step.after;
    const party = (place: "issuer" | number): string => (place === "issuer" ? who.issuer : who.parties[place]!);
    const amount = step.amount === "outstanding" ? who.outstanding : BigInt(step.amount);
    let tx_index = drawIn(next, 0, 120);
    while (used.has(`${ledger}.${tx_index}`)) tx_index += 1;
    used.add(`${ledger}.${tx_index}`);
    const between = step.from !== "issuer" && step.to !== "issuer" && step.to !== "none";
    const feeUnits = (step.kind === "payment" || step.kind === "escrow_finish") && between && fee > 0 ? (amount * BigInt(fee)) / 100_000n : 0n;
    return {
      ledger_index: ledger,
      tx_index,
      tx_hash: hexOf(next, 64),
      executed_time: isoTime(head.unix - (head.index - ledger) * SECONDS_PER_LEDGER),
      tx_type: TYPE_OF[step.kind],
      kind: step.kind,
      source: party(step.from),
      ...(step.to !== "none" && { destination: party(step.to) }),
      amount: String(amount),
      ...(feeUnits > 0n && { fee: String(feeUnits) }),
    };
  });
}

/** A short plan of the plain kinds: payments between the holders at these places, newest first, a day-ish apart. */
const payments = (places: ReadonlyArray<[from: "issuer" | number, to: "issuer" | number, amount: number]>, after = 12_000): Plan[] =>
  places.map(([from, to, amount]) => ({ kind: "payment", from, to, amount, after }));

/** htf's 28 transfers, newest first: every kind, and a lock and an unlock of every balance. The first five are within a day of the head (`transfers_24h` of the tab counts the payments among them). */
const HTF_PLAN: readonly Plan[] = [
  { kind: "payment", from: 1, to: 4, amount: 350_000, after: 900 },
  { kind: "payment", from: 0, to: 7, amount: 1_200_000, after: 2_400 },
  { kind: "payment", from: "issuer", to: 2, amount: 5_000_000, after: 3_100 },
  { kind: "escrow_create", from: 3, to: 9, amount: 800_000, after: 4_000 },
  { kind: "payment", from: 5, to: 1, amount: 75_000, after: 5_500 },
  { kind: "lock", from: "issuer", to: 2, amount: 9_000_000, after: 14_000 },
  { kind: "payment", from: 6, to: "issuer", amount: 2_000_000, after: 9_000 },
  { kind: "unlock", from: "issuer", to: 11, amount: 420_000, after: 21_000 },
  { kind: "payment", from: 8, to: 3, amount: 150_000, after: 18_000 },
  { kind: "escrow_finish", from: 4, to: 12, amount: 600_000, after: 30_000 },
  { kind: "clawback", from: 13, to: "issuer", amount: 90_000, after: 26_000 },
  { kind: "payment", from: 2, to: 14, amount: 2_800_000, after: 12_000 },
  { kind: "payment", from: 10, to: 0, amount: 40_000, after: 34_000 },
  { kind: "lock", from: "issuer", to: "none", amount: "outstanding", after: 40_000 },
  { kind: "unlock", from: "issuer", to: "none", amount: "outstanding", after: 15_000 },
  { kind: "payment", from: 15, to: 6, amount: 500_000, after: 22_000 },
  { kind: "escrow_cancel", from: 7, to: "none", amount: 250_000, after: 48_000 },
  ...payments(
    [
      ["issuer", 0, 40_000_000],
      [3, 8, 600_000],
      [9, 1, 120_000],
      [0, "issuer", 3_000_000],
      ["issuer", 5, 7_500_000],
      [11, 2, 45_000],
      [4, 13, 330_000],
      ["issuer", 9, 2_200_000],
      [14, 10, 18_000],
      [1, 15, 950_000],
      ["issuer", 3, 1_100_000],
    ],
    36_000,
  ),
];

// ---- The worlds of the eight answered issuances -------------------------------------------------------------------------------------

/** The eight issuances with an answer, `htf` first, with their holders and transfers. */
function worlds(head: { index: number; unix: number }): World[] {
  const made = (key: keyof typeof METADATA_TEXTS): Facts => madeUpFacts(key);
  const out: World[] = [];
  // `parties` are the accounts a plan's places name: the holders, but for an issuance that has none left (the destroyed one's holders are zero balances, which are not listed).
  const add = (key: string, facts: Facts, holders: MptHolder[], plan: readonly Plan[], opts: { complete?: boolean; parties?: readonly string[] } = {}): void => {
    const outstanding = sumOf(holders.flatMap((holder) => [holder.amount, holder.escrowed_amount]));
    const parties = opts.parties ?? holders.map((holder) => holder.holder);
    out.push({ ...facts, key, holders, transfers: transfersOf(stream("transfers", key), plan, { issuer: facts.issuer, parties, outstanding }, facts.fee, head), complete: opts.complete ?? true });
  };

  // htf: 63 holders, the third locked on its own, the fifth with 1,250,000 in escrow.
  const htf = createdIssuance("issuance_create");
  add("htf", htf, holdersOf(stream("holders", "htf"), 63, 612_345_000_000, { escrowed: { 4: "1250000" }, locked: [2] }), HTF_PLAN);

  const shortKeys = createdIssuance("issuance_create_short_keys");
  add(
    "shortKeys",
    shortKeys,
    holdersOf(stream("holders", "shortKeys"), 7, 65_000_000_000, {}),
    payments([["issuer", 0, 5_000_000_000], [0, 1, 90_000_000], [1, 3, 4_000_000], [0, 2, 30_000_000], [2, "issuer", 100_000], [4, 5, 200_000]], 2_000),
  );

  add("noMetadata", made("noMetadata"), holdersOf(stream("holders", "noMetadata"), 4, 150_000, {}), payments([["issuer", 0, 100_000], [0, 1, 20_000], [1, 2, 5_000], [3, "issuer", 700], [2, 0, 1_500]], 3_000));

  add("rawMetadata", made("rawMetadata"), holdersOf(stream("holders", "rawMetadata"), 5, 12_000_000, {}), payments([["issuer", 1, 4_000_000], [1, 0, 300_000], [2, 4, 50_000], [0, 3, 12_000]], 5_000));

  add(
    "nonConforming",
    made("nonConforming"),
    holdersOf(stream("holders", "nonConforming"), 6, 9_000_000_000, {}),
    payments([["issuer", 0, 3_000_000_000], [0, 4, 200_000_000], [2, 1, 40_000_000], [5, 3, 1_000_000], [1, "issuer", 8_000_000]], 6_000),
  );

  // destroyed: no holder with a balance is left (what was minted was redeemed, and the issuance destroyed), so its list of holders is empty; its transfers name two holders that are gone.
  const gone = stream("holders", "destroyed");
  add("destroyed", made("destroyed"), [], [{ kind: "payment", from: 0, to: "issuer", amount: 4_000, after: 9_000 }, { kind: "payment", from: "issuer", to: 0, amount: 4_000, after: 7_000 }], { parties: [accountOf(gone), accountOf(gone)] });

  // lockedAll: the issuer locked every balance.
  add(
    "lockedAll",
    made("lockedAll"),
    holdersOf(stream("holders", "lockedAll"), 5, 240_000_000, { locksAll: true }),
    [{ kind: "lock", from: "issuer", to: "none", amount: "outstanding", after: 5_000 }, ...payments([["issuer", 0, 60_000_000], [0, 1, 20_000_000], [2, 3, 400_000]], 4_000)],
  );

  // escrow: HTF, with two holders that have amounts in escrow, and every kind of escrow transfer. Its answers say the coverage is not complete.
  add(
    "escrow",
    made("escrow"),
    holdersOf(stream("holders", "escrow"), 8, 1_820_451_120, { escrowed: { 0: "84411120", 2: "12000000" } }),
    [
      { kind: "escrow_finish", from: 0, to: 4, amount: 5_000_000, after: 1_500 },
      { kind: "escrow_create", from: 2, to: 6, amount: 12_000_000, after: 6_000 },
      { kind: "escrow_cancel", from: 0, to: "none", amount: 3_000_000, after: 9_000 },
      { kind: "escrow_create", from: 0, to: 3, amount: 84_411_120, after: 20_000 },
      ...payments([["issuer", 0, 900_000_000], [0, 1, 1_500_000], [1, "issuer", 40_000]], 15_000),
    ],
    { complete: false },
  );

  return out;
}

// ---- The other issuances: the four of the recorded transactions, and the tab's fillers ----------------------------------------------

/** A line of the tab or the lookup that has no page of its own: its facts and the numbers a summary says. */
interface Known {
  facts: Facts;
  outstanding: string;
  holders: number;
}

/** The issuances the recorded transactions touch besides the two creates, with what the nodes in their metadata say (the lock of a holder shows none, so its issuance is made up around its ID). */
function recordedOthers(): Known[] {
  const nodeOf = (name: keyof typeof MPT_RECORDED, id: string): Facts => {
    const fields = affected(recordedTx(name).tx, "MPTokenIssuance");
    if (fields === undefined) throw new Error(`${name} has no MPTokenIssuance node`);
    return factsOfNode(id, fields);
  };
  const mintId = String(((recordedTx("payment_mint").tx.Amount as Json).mpt_issuance_id as string) ?? "");
  const feeId = String(((recordedTx("payment_transfer_fee").tx.Amount as Json).mpt_issuance_id as string) ?? "");
  const escrowId = String(((recordedTx("escrow_create").tx.Amount as Json).mpt_issuance_id as string) ?? "");
  const lockId = String(recordedTx("issuance_set_lock_holder").tx.MPTokenIssuanceID ?? "");
  const known = (facts: Facts, outstanding: string, holders: number): Known => ({ facts, outstanding, holders });
  const lock: Facts = { id: lockId, issuer: mptIssuerOf(lockId), sequence: parseInt(lockId.slice(0, 8), 16), scale: 0, fee: 0, flags: FLAG_BITS.can_lock | FLAG_BITS.require_auth | FLAG_BITS.can_transfer | FLAG_BITS.can_clawback, destroyed: false };
  const mint = nodeOf("payment_mint", mintId);
  const fees = nodeOf("payment_transfer_fee", feeId);
  const escrow = nodeOf("escrow_create", escrowId);
  return [
    known(mint, String(affectedAmount(recordedTx("payment_mint").tx, "OutstandingAmount") ?? "1"), 1),
    known(fees, String(affectedAmount(recordedTx("payment_transfer_fee").tx, "OutstandingAmount") ?? "0"), 41),
    known(lock, "86000000", 6),
    known(escrow, String(affectedAmount(recordedTx("escrow_create").tx, "OutstandingAmount") ?? "0"), 5),
  ];
}

/** An amount field of the issuance node of a transaction (`OutstandingAmount` of its final fields). */
function affectedAmount(tx: RawTx, field: string): string | undefined {
  const value = affected(tx, "MPTokenIssuance")?.[field];
  return typeof value === "string" ? value : undefined;
}

/** Tickers and names of the tab's fillers: made-up, and none of them contains HTF, an issuer prefix or ZZZ. */
const FILLERS: ReadonlyArray<[ticker: string, name: string]> = [
  ["AURA", "Aura Credit Note"],
  ["BRIX", "Brixton Land Share"],
  ["CIVO", "Civo Carbon Credit"],
  ["DUNE", "Dune Grain Receipt"],
  ["ECHO", "Echo Audio Royalty"],
  ["FLUX", "Flux Energy Bond"],
  ["GLEN", "Glen Wool Share"],
  ["HALO", "Halo Coffee Receipt"],
  ["IBIS", "Ibis Reef Credit"],
  ["JADE", "Jade Fleet Note"],
  ["KOVA", "Kova Timber Share"],
  ["LUMA", "Luma Solar Bond"],
  ["MARO", "Maro Cacao Receipt"],
  ["NIVA", "Niva Fishery Share"],
];

/** The tab's fillers: seeded issuers, sequences and sizes, with no page of their own. */
function fillers(): Known[] {
  return FILLERS.map(([ticker, name], at) => {
    const next = stream("filler", ticker);
    const issuer = accountOf(next);
    const sequence = drawIn(next, 80_000_000, 107_000_000);
    const metadataHex = hexOfText(JSON.stringify({ ticker, name, icon: `https://${ticker.toLowerCase()}.example/icon.png`, asset_class: "other", issuer_name: `${name} Ltd` }));
    const facts: Facts = {
      id: mptIdOf(sequence, issuer),
      issuer,
      sequence,
      scale: drawIn(next, 0, 6),
      fee: [0, 0, 100, 250][at % 4]!,
      flags: [FLAG_BITS.can_transfer, FLAG_BITS.can_transfer | FLAG_BITS.can_trade, FLAG_BITS.can_lock | FLAG_BITS.can_transfer, 0][at % 4]!,
      metadataHex,
      destroyed: false,
    };
    return { facts, outstanding: String(drawIn(next, 100_000, 90_000_000_000)), holders: 2 + at * 2 + drawIn(next, 0, 1) };
  });
}

// ---- The answers --------------------------------------------------------------------------------------------------------------------

/** A file of the data API: `path` and `query` give its name (`dataApiFile`), `value` its body. `sorted` writes the recorded layout (keys sorted, a transaction a line), else D9's key orders. */
export interface MptFile {
  path: string;
  query: string;
  value: unknown;
  sorted?: true;
}

/** A file of the node: `method` and `params` give its name (`nodeFile`), `value` the whole answer. */
export interface MptNodeFile {
  method: string;
  params: Record<string, unknown>;
  value: unknown;
  sorted?: true;
}

export interface MptAnswers {
  data: MptFile[];
  node: MptNodeFile[];
}

const coverageOf = (complete: boolean) => ({ from_ledger_index: MPT_COVERAGE_FROM, complete });

/** The pages of a list: `size` rows at a time, each page with the marker of its last row when there are more. */
function pagesOf<T>(rows: readonly T[], size: number, markerOf: (row: T) => string): Array<{ rows: T[]; marker?: string; after?: string }> {
  const pages: Array<{ rows: T[]; marker?: string; after?: string }> = [];
  let after: string | undefined;
  for (let at = 0; at < rows.length || at === 0; at += size) {
    const slice = rows.slice(at, at + size);
    const more = at + size < rows.length;
    pages.push({ rows: slice, ...(more && { marker: markerOf(slice.at(-1)!) }), ...(after !== undefined && { after }) });
    after = more ? markerOf(slice.at(-1)!) : undefined;
  }
  return pages;
}

const holderMarker = (holder: MptHolder): string => encodeMarker([String(BigInt(holder.amount) + BigInt(holder.escrowed_amount)), holder.holder]);
const transferMarker = (transfer: MptTransfer): string => encodeMarker([transfer.ledger_index, transfer.tx_index]);

/** The tab's marker: D9's `["mpt", holders, issuer, id]` of the last row of a page. */
const tokenMarker = (row: MptTokenRow): string => encodeMarker(["mpt", row.holders, row.issuer, row.mpt_issuance_id]);

/** The number of a world's `payment` transfers within the 24 hours before the head: the tab's `transfers_24h`. */
function paymentsInDay(world: World, head: { unix: number }): number {
  return world.transfers.filter((transfer) => transfer.kind === "payment" && Date.parse(transfer.executed_time) / 1000 > head.unix - 86_400).length;
}

let answersCache: MptAnswers | undefined;

/** Every file of the MPT fixtures, made once. */
function answers(): MptAnswers {
  if (answersCache !== undefined) return answersCache;
  const head = headOfFixtures();
  const data: MptFile[] = [];
  const node: MptNodeFile[] = [];
  const put = (path: string, query: string, value: unknown): void => void data.push({ path, query, value });

  // ---- The issuances with an answer, and their lists.
  const all = worlds(head);
  for (const world of all) {
    const coverage = coverageOf(world.complete);
    put(`/v2/mpt/${world.id}`, "", { result: "success", coverage, issuance: issuanceOf(world, head.index) });
    // The card asks for the first ten and the first eight. `htf` has the holders page's 50 (63 holders: two pages) and the transfers page's 20 (28: two pages); every page of those is asked for.
    const lists = [
      { route: "holders", rows: world.holders, sizes: world.key === "htf" ? MPT_PAGES.holders : MPT_PAGES.holders.slice(0, 1), query: (size: number) => `limit=${size}`, markerOf: holderMarker },
      { route: "transfers", rows: world.transfers, sizes: world.key === "htf" ? MPT_PAGES.transfers : MPT_PAGES.transfers.slice(0, 1), query: (size: number) => `descending=true&limit=${size}`, markerOf: transferMarker },
    ] as const;
    for (const { route, rows, sizes, query, markerOf } of lists) {
      for (const size of sizes) {
        const pages = pagesOf<MptHolder | MptTransfer>(rows, size, markerOf as (row: MptHolder | MptTransfer) => string);
        // The first (smallest) size is the card: its first page only. The larger one is the list's own page, and each of its pages is a file.
        for (const page of size === sizes[0] ? pages.slice(0, 1) : pages) {
          put(`/v2/mpt/${world.id}/${route}`, page.after === undefined ? query(size) : `${query(size)}&marker=${page.after}`, {
            result: "success",
            coverage,
            count: page.rows.length,
            ...(page.marker !== undefined && { marker: page.marker }),
            [route]: page.rows,
          });
        }
      }
    }
    // The issuance's "Older →" is the marker of the card's last transfer (the 8th), and leads to the transfers' page of 20 behind it: rows 9 to 28. D9's marker is a key (ledger and transaction index), so it
    // serves any size of page; the file lets the e2e follow the link instead of asserting it.
    if (world.key === "htf") {
      const [cardSize, listSize] = MPT_PAGES.transfers;
      const behind = world.transfers.slice(cardSize, cardSize + listSize);
      put(`/v2/mpt/${world.id}/transfers`, `descending=true&limit=${listSize}&marker=${transferMarker(world.transfers[cardSize - 1]!)}`, {
        result: "success",
        coverage,
        count: behind.length,
        ...(cardSize + listSize < world.transfers.length && { marker: transferMarker(behind.at(-1)!) }),
        transfers: behind,
      });
    }
  }

  // ---- What every lookup answers from, and the tab's list.
  const others = [...recordedOthers(), ...fillers()];
  const table = new Map<string, MptSummary>();
  for (const world of all) table.set(world.id, summaryOfWorld(world));
  for (const { facts, outstanding, holders } of others.slice(0, 4)) table.set(facts.id, summaryOf(facts, { outstanding, holders }));
  put(
    "/v2/mpt_lookup",
    "",
    Object.fromEntries([...table].sort(([a], [b]) => (a < b ? -1 : 1))),
  );

  // The tab: the live issuances (the destroyed one is not listed, nor is `nodeOnly`, which the index does not know), most held first, then by issuer, then by ID.
  const rows: Array<{ summary: Omit<MptSummary, "destroyed">; transfers: number }> = [];
  const nextCount = stream("transfers_24h");
  for (const world of all) {
    if (world.destroyed) continue;
    const { destroyed: _destroyed, ...summary } = summaryOfWorld(world);
    rows.push({ summary, transfers: paymentsInDay(world, head) });
  }
  for (const { facts, outstanding, holders } of others) {
    const { destroyed: _destroyed, ...summary } = summaryOf(facts, { outstanding, holders });
    rows.push({ summary, transfers: drawIn(nextCount, 0, 12) });
  }
  const order = (a: { summary: { holders: number; issuer: string; mpt_issuance_id: string } }, b: typeof a): number =>
    b.summary.holders - a.summary.holders || (a.summary.issuer < b.summary.issuer ? -1 : a.summary.issuer > b.summary.issuer ? 1 : a.summary.mpt_issuance_id < b.summary.mpt_issuance_id ? -1 : 1);
  rows.sort(order);
  const tokenRows: MptTokenRow[] = rows.map(({ summary, transfers }, at) => ({ rank: at + 1, ...summary, transfers_24h: transfers }));
  const totals = { issuances: tokenRows.length, holders: Math.floor((tokenRows.reduce((sum, row) => sum + row.holders, 0) * 9) / 10), transfers_24h: tokenRows.reduce((sum, row) => sum + row.transfers_24h, 0) };
  const listOf = (rowsOfList: MptTokenRow[], total: number, complete: boolean, marker?: string) => ({
    result: "success",
    coverage: coverageOf(complete),
    kind: "mpt",
    ledger_index: head.index,
    close_time: head.closeTime,
    totals,
    total,
    count: rowsOfList.length,
    ...(marker !== undefined && { marker }),
    tokens: rowsOfList,
  });
  const tabPages = pagesOf(tokenRows, 20, tokenMarker);
  for (const page of tabPages) put("/v2/tokens", page.after === undefined ? "kind=mpt&limit=20" : `kind=mpt&limit=20&marker=${page.after}`, listOf(page.rows, tokenRows.length, true, page.marker));
  // The search: `escrow` is the one that says HTF (its coverage is the one that is not complete), and `zzz` matches nothing. A search selects its own rows, so the rank is the place among them.
  const match = tokenRows.filter((row) => row.ticker === "HTF" || row.name?.toLowerCase().includes("htf") === true).map((row, at) => ({ ...row, rank: at + 1 }));
  put("/v2/tokens", "kind=mpt&limit=20&q=HTF", listOf(match, match.length, false));
  put("/v2/tokens", "kind=mpt&limit=20&q=zzz", listOf([], 0, true));

  // ---- The nine recorded transactions, as every recorded transaction is served (C2).
  const ledgerOf = new Map<number, RawLedger>();
  for (const name of Object.keys(MPT_RECORDED) as Array<keyof typeof MPT_RECORDED>) {
    const { raw, tx } = recordedTx(name);
    const served = dataApiTx(raw, tx);
    const hash = tx.hash;
    data.push({ path: `/v2/transactions/${hash}`, query: "", value: { result: "success", transaction: served }, sorted: true });
    data.push({ path: `/v2/transactions/${hash}`, query: "binary=true", value: { result: "success", transaction: binaryTx("xrpl", served) }, sorted: true });
    node.push({ method: "tx", params: { transaction: hash }, value: { result: nodeTxResult(raw, tx) }, sorted: true });
    ledgerOf.set(Number(raw.ledger.ledger_index), raw);
  }
  for (const [index, raw] of [...ledgerOf].sort(([a], [b]) => a - b)) {
    data.push({ path: `/v2/ledgers/${index}`, query: "transactions=true", value: { result: "success", ledger: { ...dataApiLedger(raw), transactions: inLedgerOrder(raw).map((tx) => tx.hash) } }, sorted: true });
  }

  // ---- The node's entry of the issuance the index lacks: the recorded create's fields, another sequence and the active account as the issuer.
  const created = recordedTx("issuance_create");
  const { issuer: ownedBy, sequence } = madeUpIdentity("nodeOnly");
  const owned = affected(created.tx, "MPTokenIssuance")!;
  const { Sequence: _sequence, Issuer: _issuer, ...fields } = owned;
  const entry = { ...fields, Issuer: ownedBy, LedgerEntryType: "MPTokenIssuance", OutstandingAmount: "12500000", OwnerNode: "0", PreviousTxnID: created.tx.hash, PreviousTxnLgrSeq: Number(created.raw.ledger.ledger_index), Sequence: sequence };
  const key = issuanceKey(MPT_FIXTURE_IDS.nodeOnly);
  node.push({
    method: "ledger_entry",
    params: { mpt_issuance: MPT_FIXTURE_IDS.nodeOnly, ledger_index: "validated" },
    value: { result: { index: key, ledger_hash: head.hash, ledger_index: head.index, node: { ...entry, index: key }, status: "success", validated: true } },
    sorted: true,
  });

  answersCache = { data, node };
  return answersCache;
}

let pathsCache: ReadonlySet<string> | undefined;

/** The paths (below test/fixtures/http/) of every MPT file: `isMptGenerated` of http-fixtures.ts names the transactions, the ledgers' lists and the node's `tx` among them by this. Worked out once. */
export function mptPaths(): ReadonlySet<string> {
  if (pathsCache === undefined) {
    const { data, node } = answers();
    const files = [...data.map(({ path, query }) => dataApiFile("xrpl", path, query)), ...node.map(({ method, params }) => nodeFile("xrpl", method, params))];
    if (files.some((file) => file === undefined)) throw new Error("an MPT fixture has no file name");
    pathsCache = new Set(files as string[]);
  }
  return pathsCache;
}

/** The MPT pages' files of the data API for a network: XRPL's, none for Xahau, which has no MPT. */
export function mptFixtures(net: NetworkName): MptFile[] {
  return net === "xrpl" ? answers().data : [];
}

/** The MPT pages' files of the node for a network: the recorded transactions' `tx` and `nodeOnly`'s `ledger_entry` on XRPL, none for Xahau. */
export function mptNodeFixtures(net: NetworkName): MptNodeFile[] {
  return net === "xrpl" ? answers().node : [];
}

