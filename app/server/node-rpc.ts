// The client of a network's own node (rippled for the XRP Ledger, xahaud for Xahau) over JSON-RPC. The explorer
// asks the node for what the data API does not hold: an account's live state, the reserves, the order book of a
// pair, an AMM pool's state, and (spec 10) a transaction or ledger the API has not indexed yet. Only loaders use it.
// Worker-only code.
//
// Every call is limited to 3 s (answer included). The node's failures arrive as `result.status: "error"`
// with HTTP 200; they become `UpstreamError`s, `actNotFound`, `txnNotFound` and `lgrNotFound` as `not_found`. A call may
// give a list of its own that replaces that one: `amm_info` reads `actNotFound` and `actMalformed` as `not_found` and nothing
// else (a node with no validated ledger yet is an outage, not "no such pool"), and `book_offers` none (a book has no "not found").
//
// Times: the node counts seconds from 2000-01-01 (the Ripple epoch). This client converts every such time it
// returns (`date` of a transaction, `close_time` and `parent_close_time` of a ledger, `close_time` of the
// server state's ledgers) to unix seconds at this boundary, so that nothing outside it sees the Ripple epoch.
// Requests are API version 1, the node's default: the shapes below are rippled's v1 shapes.

import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";

import { sameAsset, type Asset } from "../domain/asset";
import { dropsToNative } from "../domain/format";
import type { TxJson, TxMeta } from "../domain/parse/types";
import type { CacheClass, SubrequestCache } from "./cache-class";
import type { Network } from "./networks";
import { clip, NODE_TIMEOUT_MS, retryAfterOf, UpstreamError, withDeadline } from "./upstream";

export { UpstreamError } from "./upstream";
export type { UpstreamErrorKind } from "./upstream";

/** Seconds from the unix epoch to the Ripple epoch, 2000-01-01 00:00:00 UTC. */
export const RIPPLE_EPOCH_OFFSET = 946_684_800;

// ---- What the client returns ---------------------------------------------------------------------------------------

/**
 * A transaction in a validated ledger, in the shape of the data API's `TxObject` except for `date`, which is
 * unix seconds here (the ledger's close time) where the API has an ISO string.
 */
export interface NodeTx {
  hash: string;
  ledger_index: number;
  ledger_hash?: string;
  /** Unix seconds. */
  date: number;
  tx: TxJson;
  meta: TxMeta;
}

/** A validated ledger. */
export interface NodeLedger {
  ledger_hash: string;
  ledger_index: number;
  parent_hash: string;
  /** Drops, exact. */
  total_coins: string;
  /** Unix seconds. */
  close_time: number;
  /** Unix seconds. */
  parent_close_time: number;
  close_time_resolution: number;
  close_flags: number;
  account_hash: string;
  transaction_hash: string;
  /** With `transactions` or `expand`: the hashes, or (with `expand`) the transactions in full, dated by the ledger. */
  transactions?: string[] | NodeTx[];
}

/** The fields of an account's `AccountRoot` ledger entry that the explorer shows. Optional ones are left out when unset. */
export interface AccountRoot {
  LedgerEntryType: "AccountRoot";
  Account: string;
  /** Drops. */
  Balance: string;
  Flags: number;
  OwnerCount: number;
  Sequence: number;
  PreviousTxnID: string;
  PreviousTxnLgrSeq: number;
  /** Hex of the ASCII domain. */
  Domain?: string;
  RegularKey?: string;
  EmailHash?: string;
  MessageKey?: string;
  TickSize?: number;
  TransferRate?: number;
  AccountTxnID?: string;
  TicketCount?: number;
  NFTokenMinter?: string;
  MintedNFTokens?: number;
  BurnedNFTokens?: number;
  FirstNFTokenSequence?: number;
  /** Xahau. */
  AccountIndex?: number;
  index?: string;
}

/** `account_info` on the newest validated ledger. */
export interface AccountInfo {
  account_data: AccountRoot;
  ledger_index: number;
  validated: boolean;
}

/** A ledger entry owned by an account (an escrow, check, payment channel, NFT page, ticket, ...). */
export interface LedgerObject {
  LedgerEntryType: string;
  /** The entry's key in the ledger. */
  index?: string;
  [field: string]: unknown;
}

/** `account_objects` on the newest validated ledger: a page of the account's entries. */
export interface AccountObjects {
  account: string;
  account_objects: LedgerObject[];
  ledger_index: number;
  validated: boolean;
  limit?: number;
  /** Pass back as `marker` for the next page; absent on the last page. */
  marker?: string;
}

/** A ledger as `server_state` reports it. */
export interface ServerStateLedger {
  /** Drops. */
  base_fee: number;
  /** Unix seconds. */
  close_time: number;
  hash: string;
  /** Drops: the reserve every account must hold. */
  reserve_base: number;
  /** Drops: the reserve added for each object an account owns. */
  reserve_inc: number;
  seq: number;
}

/** The `state` of `server_state`. */
export interface ServerState {
  build_version: string;
  complete_ledgers: string;
  server_state: string;
  /** Absent on a node that has not validated a ledger yet. */
  validated_ledger?: ServerStateLedger;
  closed_ledger?: ServerStateLedger;
}

/** The most offers one `book_offers` call asks for: 60 is the default of both rippled and Clio, inside the limits of both. */
export const BOOK_OFFERS_LIMIT = 60;

/** An amount as the explorer reads it: native amounts converted from drops to whole units at this boundary. */
export interface NodeAmount {
  /** The native code (`XRP`, `XAH`) with no issuer, or the currency as the ledger holds it (3 characters, or 40 hex digits in upper case). */
  currency: string;
  issuer?: string;
  /** A plain decimal: whole units, never in exponent form. */
  value: string;
}

/** An offer of a book, trimmed to what the explorer reads. Funded amounts are there only when the node gave them (a partly or wholly unfunded offer). */
export interface BookOffer {
  account: string;
  sequence: number;
  /** What the offer's owner gives (the node's `TakerGets`). */
  gets: NodeAmount;
  /** What the owner wants (the node's `TakerPays`). */
  pays: NodeAmount;
  getsFunded?: NodeAmount;
  paysFunded?: NodeAmount;
}

/** `book_offers` on the newest validated ledger: the best `BOOK_OFFERS_LIMIT` offers, in the node's order (best price first). */
export interface Book {
  ledgerIndex: number;
  offers: BookOffer[];
}

/** rippled's v1 `amm_info` result, as the explorer reads it. Field names are the node's; amounts are `NodeAmount`s, times unix seconds. */
export interface AmmInfo {
  /** The pool account. */
  account: string;
  /** Native in whole units. */
  amount: NodeAmount;
  amount2: NodeAmount;
  asset_frozen?: boolean;
  asset2_frozen?: boolean;
  /** Currency (40 hex digits), issuer = the pool, value = the LP supply. */
  lp_token: NodeAmount;
  /** Units of 1/100000 (300 is 0.300%). */
  trading_fee: number;
  /** `[]` when the node leaves it out. */
  vote_slots: { account: string; trading_fee: number; vote_weight: number }[];
  auction_slot?: {
    /** Absent: an open slot. */
    account?: string;
    /** Addresses; `[]` when the node leaves it out. */
    auth_accounts: string[];
    discounted_fee: number;
    /** Unix seconds (the node writes an ISO 8601 time). */
    expiration: number;
    price: NodeAmount;
    /** 0 to 20. */
    time_interval: number;
  };
  /** The validated ledger it was read at. */
  ledger_index: number;
}

/**
 * What a caller may ask of a call to the order book or a pool. `ttl`: keep the answer this many seconds instead of the class's, under a cache
 * entry of its own (the key says `[kept N s]`). `holdFailure`: the cache's failure hold (`SubrequestOptions`); a page that polls asks for it on
 * every call it makes.
 */
export interface NodeCallOptions {
  ttl?: number;
  holdFailure?: boolean;
}

export interface NodeRpc {
  /** A transaction by hash. Only a transaction in a validated ledger is returned; any other is `not_found`. */
  tx(hash: string): Promise<NodeTx>;
  /**
   * A validated ledger by index or by hash (any other ledger is `not_found`). `transactions` adds their hashes;
   * `expand` adds them in full.
   */
  ledger(id: string, opts?: { transactions?: boolean; expand?: boolean }): Promise<NodeLedger>;
  /** An account's root on the newest validated ledger. `not_found` for an address that has no account. */
  accountInfo(address: string): Promise<AccountInfo>;
  /** A page of the entries an account owns, on the newest validated ledger. */
  accountObjects(address: string, opts?: { limit?: number; marker?: string }): Promise<AccountObjects>;
  /** The node's state: the reserves in force (`validated_ledger.reserve_base` and `reserve_inc`) among it. */
  serverState(): Promise<ServerState>;
  /**
   * The best offers of the book where `gets` is what the offers' owners give and `pays` what they want (`taker_gets`, `taker_pays`), on the
   * newest validated ledger. An empty book is an answer, and a book is never `not_found`: whatever the node says of a ledger it cannot read
   * is an outage (`server`). Every offer is of the two assets asked for, and neither of its full amounts is zero. Class `live`. A native asset is the network's own (`{ currency: "XRP" }` on the
   * XRP Ledger, `XAH` on Xahau); any other without an issuer is `bad_request` without a call.
   */
  bookOffers(gets: Asset, pays: Asset, opts?: NodeCallOptions): Promise<Book>;
  /**
   * An AMM pool by its account, on the newest validated ledger. `not_found` for an account that is no pool (`actNotFound`, `actMalformed`) and for
   * nothing else: a node with no validated ledger yet is `server`. Class `live`.
   */
  ammInfo(pool: string, opts?: NodeCallOptions): Promise<AmmInfo>;
  /** An AMM pool by its two assets, on the newest validated ledger; `amount` and `amount2` come in the order asked. `not_found` for a pair with no pool. Class `live`. */
  ammInfoByPair(asset: Asset, asset2: Asset, opts?: NodeCallOptions): Promise<AmmInfo>;
}

// ---- Reading the node's answers ------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function malformed(what: string, detail: string): UpstreamError {
  return new UpstreamError("server", `${what} answered something unexpected: ${detail}`, { status: 200 });
}

function objectField(what: string, from: Json, key: string): Json {
  const value = from[key];
  if (!isObject(value)) throw malformed(what, `no "${key}" object`);
  return value;
}
function textField(what: string, from: Json, key: string): string {
  const value = from[key];
  if (typeof value !== "string") throw malformed(what, `no "${key}" text`);
  return value;
}
/**
 * An account that a page links (`accountHref`, which does not escape): a classic address with a valid checksum, as the data API's side refuses any other
 * account "because it goes into a link" (amm-shape.ts). `whose` names the part it is in.
 */
function accountField(what: string, from: Json, key: string, whose: string): string {
  const value = from[key];
  if (typeof value !== "string" || !isValidClassicAddress(value)) throw malformed(what, `${whose} "${key}" is not a classic address`);
  return value;
}
function numberField(what: string, from: Json, key: string): number {
  const value = from[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw malformed(what, `no "${key}" number`);
  return value;
}
/** A time of the node, which counts from the Ripple epoch, as unix seconds. */
function timeField(what: string, from: Json, key: string): number {
  return numberField(what, from, key) + RIPPLE_EPOCH_OFFSET;
}

/** `validated` must be `true`: the explorer shows validated history only. */
function requireValidated(what: string, result: Json): void {
  if (result.validated !== true) {
    throw new UpstreamError("not_found", `${what}: not in a validated ledger`, { status: 200 });
  }
}

/** Error codes of a request the node finds malformed (the last six are `book_offers`' and `amm_info`'s: an asset or an issuer it cannot read). */
const MALFORMED_REQUEST = [
  "invalidParams",
  "actMalformed",
  "malformedAddress",
  "malformedRequest",
  "lgrIdxMalformed",
  "lgrIdxsInvalid",
  "srcCurMalformed",
  "srcIsrMalformed",
  "dstAmtMalformed",
  "dstIsrMalformed",
  "badMarket",
  "issueMalformed",
];

/** The codes the calls about an account, a transaction or a ledger read as `not_found`. */
const LEGACY_NOT_FOUND: readonly string[] = ["actNotFound", "txnNotFound", "lgrNotFound"];

/**
 * The codes `amm_info` answers with when there is no such pool: `actNotFound` (the account is not a pool, or the pair has none) and
 * `actMalformed` (an address that holds no account, such as a deleted pool's). Both are `not_found` for it, where `actMalformed` is a
 * `bad_request` for a call about an account: the Worker has checked the address or the pair, so both mean "no such pool". They are its
 * whole list: `lgrNotFound` (the node has no validated ledger yet) is an outage for it, not an answer a page stores as "no pool".
 */
const AMM_NOT_FOUND: readonly string[] = ["actNotFound", "actMalformed"];

/** `book_offers` has no "not found": an empty book is an answer, and a node that cannot read the ledger is an outage. */
const BOOK_NOT_FOUND: readonly string[] = [];

/**
 * The `result` of a failed call as an UpstreamError. `notFound`: the codes this call reads as `not_found`; the list of a call replaces
 * `LEGACY_NOT_FOUND`, which a call that gives none keeps.
 */
function errorOf(what: string, result: Json, notFound: readonly string[] = LEGACY_NOT_FOUND): UpstreamError {
  const code = typeof result.error === "string" ? result.error : "unknown";
  const message = typeof result.error_message === "string" && result.error_message ? ` (${clip(result.error_message)})` : "";
  const text = `${what} failed with ${code}${message}`;

  if (notFound.includes(code)) {
    return new UpstreamError("not_found", text, { status: 200 });
  }
  if (MALFORMED_REQUEST.includes(code)) return new UpstreamError("bad_request", text, { status: 200 });
  if (code === "slowDown") return new UpstreamError("rate_limited", text, { status: 200 });
  return new UpstreamError("server", text, { status: 200 });
}

/** A transaction as the `tx` command and a ledger's expanded list both give it, once the pieces are taken out. */
function nodeTx(what: string, whole: Json, meta: unknown, ledgerIndex: number, date: number): NodeTx {
  if (!isObject(meta)) throw malformed(what, "a transaction without metadata");
  const tx = whole as TxJson;
  return { hash: textField(what, whole, "hash"), ledger_index: ledgerIndex, date, tx, meta: meta as TxMeta };
}

function toTx(what: string, result: Json): NodeTx {
  requireValidated(what, result);
  // The wrapper the node puts around the transaction's own fields.
  const { meta, validated, status, date, inLedger, ledger_index, ledger_hash, ctid, close_time_iso, ...tx } = result;
  const found = nodeTx(what, tx, meta, numberField(what, result, "ledger_index"), timeField(what, result, "date"));
  return typeof ledger_hash === "string" ? { ...found, ledger_hash } : found;
}

function toLedger(what: string, result: Json): NodeLedger {
  requireValidated(what, result);
  const header = objectField(what, result, "ledger");

  const index = Number(textField(what, header, "ledger_index"));
  if (!Number.isSafeInteger(index)) throw malformed(what, "a ledger_index that is not a number");
  const closeTime = timeField(what, header, "close_time");

  const ledger: NodeLedger = {
    ledger_hash: textField(what, header, "ledger_hash"),
    ledger_index: index,
    parent_hash: textField(what, header, "parent_hash"),
    total_coins: textField(what, header, "total_coins"),
    close_time: closeTime,
    parent_close_time: timeField(what, header, "parent_close_time"),
    close_time_resolution: numberField(what, header, "close_time_resolution"),
    close_flags: numberField(what, header, "close_flags"),
    account_hash: textField(what, header, "account_hash"),
    transaction_hash: textField(what, header, "transaction_hash"),
  };

  const transactions = header.transactions;
  if (Array.isArray(transactions)) {
    ledger.transactions = transactions.map((entry: unknown) => {
      if (typeof entry === "string") return entry;
      if (!isObject(entry)) throw malformed(what, "a transaction that is neither a hash nor an object");
      // A ledger's transactions carry their metadata as `metaData`; they have no date of their own.
      const { metaData, meta, ...tx } = entry;
      return nodeTx(what, tx, metaData ?? meta, index, closeTime);
    }) as string[] | NodeTx[];
  }
  return ledger;
}

function toAccountInfo(what: string, result: Json): AccountInfo {
  return {
    account_data: objectField(what, result, "account_data") as unknown as AccountRoot,
    ledger_index: numberField(what, result, "ledger_index"),
    validated: result.validated === true,
  };
}

function toAccountObjects(what: string, result: Json): AccountObjects {
  const objects = result.account_objects;
  if (!Array.isArray(objects)) throw malformed(what, 'no "account_objects" list');
  const page: AccountObjects = {
    account: textField(what, result, "account"),
    account_objects: objects as LedgerObject[],
    ledger_index: numberField(what, result, "ledger_index"),
    validated: result.validated === true,
  };
  if (typeof result.limit === "number") page.limit = result.limit;
  if (typeof result.marker === "string") page.marker = result.marker;
  return page;
}

function toServerState(what: string, result: Json): ServerState {
  const state = objectField(what, result, "state");
  const converted: Json = { ...state };
  for (const key of ["validated_ledger", "closed_ledger"] as const) {
    if (state[key] === undefined) continue;
    const ledger = objectField(what, state, key);
    numberField(what, ledger, "reserve_base");
    numberField(what, ledger, "reserve_inc");
    converted[key] = { ...ledger, close_time: timeField(what, ledger, "close_time") };
  }
  return converted as unknown as ServerState;
}

// ---- Order books and AMM pools -------------------------------------------------------------------------------------
//
// What the nodes answered when these readers were written (2026-10-20, read-only POSTs to https://s1.ripple.com:51234/, a Clio server,
// and to https://xahau.network/):
//
//   amm_info, pair XRP / LIONS (4C494F4E53…+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS): NOT an error. The pair has a pool on the live XRP Ledger
//                      (r4XHjVJhBZ3Aoe9KVsDKnVesFMrmpMgjqn), so "LIONS/XRP has no pool" is a fact of the test fixtures, not of the network.
//   amm_info, amm_account rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh (an ordinary account): `actNotFound` ("Account not found.", error_code 19).
//   amm_info, amm_account rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz (the deleted XRP/SNK pool): `actMalformed` ("Account malformed.", error_code 35).
//   amm_info, amm_account rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3, and its pair XRP / RLUSD: a success. The pool is `result.amm`; `validated: true`,
//                      `ledger_index` (a number) and `ledger_hash` sit beside it in `result`, not inside. `amm.amount` of XRP is drops text
//                      ("1854660697034"), the other amount an issued object. Asked by pool, `amount` is the pool's first asset (XRP); asked by
//                      pair, `amount` is the asset asked as `asset` (asked as RLUSD / XRP, `amount` is the RLUSD). `auction_slot.expiration` is
//                      text, "2026-03-02T17:05:00+0000" (ISO 8601 with an offset and no colon), where the ledger entry has a Ripple-epoch number.
//                      `auction_slot.auth_accounts` is a list of `{ account }` objects, left out when empty; `auction_slot.account` is left out
//                      for an open slot. `asset_frozen` and `asset2_frozen` are in `amm`, and only when true or false is known (here
//                      `asset2_frozen: false`).
//   book_offers, XRP / RLUSD, ledger_index "validated": `{ ledger_hash, ledger_index (a number), offers, status }`, with NO `validated` (xrplcluster.com's
//                      rippled and xahau.network's xahaud say `validated: true`; s1 and s2.ripple.com, which are Clio, do not, and this client is
//                      configured with s1). Each offer is its ledger entry with `Account`, `Sequence`, `TakerGets` and `TakerPays` (drops text
//                      for the native side), `owner_funds`, `quality`; `taker_gets_funded` and `taker_pays_funded` only on an offer the owner cannot
//                      wholly fund (`"0"` for a side that is funded nothing).
//   book_offers on xahau.network with taker_gets { currency: "XAH" }: accepted, `validated: true`, the native side drops text. With
//                      { currency: "XRP" } it answers `dstIsrMalformed`, so the native asset of Xahau is written XAH.
//
// An issued amount's value is text in the node's own form, which for a very large or small value has an exponent ("5876901213283910e-4");
// the readers write every value as a plain decimal. Native amounts are drops text and become whole units.

/** Drops: a whole number. */
const DROPS = /^\d+$/;
/** A non-negative decimal as the node writes an issued amount, with the exponent of a very large or small one ("1000000000000000e-4"). */
const AMOUNT_VALUE = /^\d+(?:\.\d+)?(?:[eE]([+-]?\d{1,3}))?$/;
/**
 * What rippled can write as an issued amount: a mantissa of 16 digits and an exponent from -96 to 80, so zero or a value from 1e-81 to
 * 9999999999999999e80. The longest plain decimal it writes is under 45 characters (the exponent form is used outside -25 to -5).
 */
const SMALLEST_VALUE = new BigNumber("1e-81");
const LARGEST_VALUE = new BigNumber("9999999999999999e80");
const MIN_EXPONENT = -96;
const MAX_EXPONENT = 80;
const MAX_VALUE_TEXT = 64;

/**
 * An amount of the node: drops text (native, `native` its code) or an object `{ currency, issuer, value }` (issued), as a `NodeAmount`.
 * `native` is null where only an issued amount can be (an LP token).
 */
function readAmount(what: string, name: string, raw: unknown, native: string | null): NodeAmount {
  if (typeof raw === "string") {
    if (native === null || !DROPS.test(raw)) throw malformed(what, `"${name}" is not an amount`);
    return { currency: native, value: dropsToNative(raw) };
  }
  if (!isObject(raw)) throw malformed(what, `"${name}" is not an amount`);
  const { currency, issuer, value } = raw;
  if (typeof currency !== "string" || currency === "" || typeof issuer !== "string" || issuer === "") {
    throw malformed(what, `"${name}" is an amount without a currency or an issuer`);
  }
  const match = typeof value === "string" && value.length <= MAX_VALUE_TEXT ? AMOUNT_VALUE.exec(value) : null;
  if (match === null) throw malformed(what, `"${name}" has a value that is not a number`);
  const exponent = match[1] === undefined ? 0 : Number(match[1]);
  const number = new BigNumber(value as string);
  if (exponent < MIN_EXPONENT || exponent > MAX_EXPONENT || (!number.isZero() && (number.lt(SMALLEST_VALUE) || number.gt(LARGEST_VALUE)))) {
    throw malformed(what, `"${name}" has a value outside the range of an amount`);
  }
  return { currency, issuer, value: number.toFixed() };
}

function integerField(what: string, from: Json, key: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = from[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw malformed(what, `"${key}" is not a whole number from ${min} to ${max}`);
  }
  return value;
}

/** An amount of the asset it must be of: the book asked for it, so an offer of another asset is not of this book. */
function readAmountOf(what: string, name: string, raw: unknown, native: string, asset: Asset): NodeAmount {
  const amount = readAmount(what, name, raw, native);
  if (!sameAsset(amount, asset)) throw malformed(what, `"${name}" is not of the asset the book was asked for`);
  return amount;
}

function toOffer(what: string, native: string, asked: BookAsked, entry: unknown): BookOffer {
  if (!isObject(entry)) throw malformed(what, "an offer that is not an object");
  const [getsAsset, paysAsset] = asked;
  const offer: BookOffer = {
    account: textField(what, entry, "Account"),
    sequence: integerField(what, entry, "Sequence", 0),
    gets: readAmountOf(what, "TakerGets", entry.TakerGets, native, getsAsset),
    pays: readAmountOf(what, "TakerPays", entry.TakerPays, native, paysAsset),
  };
  // The price is the ratio of the full amounts, which a page divides: neither is zero. (A funded amount is, for an offer nothing funds.)
  if (new BigNumber(offer.gets.value).isZero() || new BigNumber(offer.pays.value).isZero()) {
    throw malformed(what, "an offer of nothing");
  }
  if (entry.taker_gets_funded !== undefined) {
    offer.getsFunded = readAmountOf(what, "taker_gets_funded", entry.taker_gets_funded, native, getsAsset);
  }
  if (entry.taker_pays_funded !== undefined) {
    offer.paysFunded = readAmountOf(what, "taker_pays_funded", entry.taker_pays_funded, native, paysAsset);
  }
  return offer;
}

/** The assets a book was asked for: what the offers' owners give, then what they want. */
type BookAsked = readonly [gets: Asset, pays: Asset];

/**
 * The offers are trimmed here, before the cache keeps them. `validated` may be absent (Clio's `book_offers` for `ledger_index: "validated"`
 * has none, and it serves validated data only) but never anything else than `true`: the explorer shows validated books only. A book has no
 * "not found": an empty one is an answer, and a bad offer (one of other assets than asked for, one of nothing, or more offers than asked
 * for) fails the whole book, which is never shown in half.
 */
function toBook(what: string, native: string, asked: BookAsked, result: Json): Book {
  if (result.validated !== undefined && result.validated !== true) throw malformed(what, "the book is not from a validated ledger");
  const offers = result.offers;
  if (!Array.isArray(offers)) throw malformed(what, 'no "offers" list');
  if (offers.length > BOOK_OFFERS_LIMIT) throw malformed(what, `${offers.length} offers where ${BOOK_OFFERS_LIMIT} were asked for`);
  return {
    ledgerIndex: integerField(what, result, "ledger_index", 0),
    offers: offers.map((entry: unknown) => toOffer(what, native, asked, entry)),
  };
}

const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * An ISO 8601 time with its offset (the node writes `2026-03-02T17:05:00+0000`; `Z`, `+00:00` and a fraction of a second are read too) as unix
 * seconds, the fraction dropped; `undefined` for anything else, a day or an hour that does not exist included.
 */
function isoSeconds(text: string): number | undefined {
  const match = ISO_TIME.exec(text);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return undefined;

  // `Date.UTC` reads the years 0 to 99 as 1900 to 1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;

  let offset = 0;
  const zone = match[7]!;
  if (zone !== "Z") {
    const hours = Number(zone.slice(1, 3));
    const minutes = zone.length > 3 ? Number(zone.slice(-2)) : 0;
    if (hours > 23 || minutes > 59) return undefined;
    offset = (zone.startsWith("-") ? -1 : 1) * (hours * 3600 + minutes * 60);
  }
  return date.getTime() / 1000 - offset;
}

/** The most votes and the most authorised accounts a pool has (XLS-30, rippled's AMMCore.h: `VOTE_MAX_SLOTS` and `AUCTION_SLOT_MAX_AUTH_ACCOUNTS`). */
const MAX_VOTE_SLOTS = 8;
const MAX_AUTH_ACCOUNTS = 4;

/** What a reader of `amm_info` is told was asked, to check the answer is for it. */
type AmmAsked = { pool: string } | { assets: readonly [Asset, Asset] };

function toAuctionSlot(what: string, slot: Json): NonNullable<AmmInfo["auction_slot"]> {
  // The holder, when the slot has one: the pool page links it.
  const account = slot.account === undefined ? undefined : accountField(what, slot, "account", "the auction slot's");

  const accounts = slot.auth_accounts;
  if (accounts !== undefined && !Array.isArray(accounts)) throw malformed(what, 'the auction slot\'s "auth_accounts" is not a list');
  if (accounts !== undefined && accounts.length > MAX_AUTH_ACCOUNTS) {
    throw malformed(what, `${accounts.length} authorised accounts where a slot has at most ${MAX_AUTH_ACCOUNTS}`);
  }
  const expiration = isoSeconds(textField(what, slot, "expiration"));
  if (expiration === undefined) throw malformed(what, 'the auction slot\'s "expiration" is not an ISO 8601 time');

  return {
    ...(account !== undefined && { account }),
    auth_accounts: ((accounts ?? []) as unknown[]).map((entry) => {
      if (!isObject(entry)) throw malformed(what, "an authorised account that is not an object");
      return accountField(what, entry, "account", "an authorised account's");
    }),
    discounted_fee: integerField(what, slot, "discounted_fee", 0, 1000),
    expiration,
    price: readAmount(what, "price", slot.price, null),
    time_interval: integerField(what, slot, "time_interval", 0, 20),
  };
}

/**
 * One reader for both forms of `amm_info`. Beyond the shape: `validated` must be `true` (a `server` error, not `requireValidated`'s
 * `not_found`, which a page would read as "no pool"), the fees and the time interval must be in their ranges, and the pool must be the one
 * asked for: by account, `account` is it; by pair, the assets of `amount` and `amount2` are the two asked for, in either order.
 */
function toAmmInfo(what: string, native: string, asked: AmmAsked, result: Json): AmmInfo {
  if (result.validated !== true) throw malformed(what, "the answer does not say validated: true");
  const amm = objectField(what, result, "amm");

  const account = textField(what, amm, "account");
  const amount = readAmount(what, "amount", amm.amount, native);
  const amount2 = readAmount(what, "amount2", amm.amount2, native);
  if ("pool" in asked) {
    if (account !== asked.pool) throw malformed(what, `"account" is ${clip(account)}, not the pool asked for`);
  } else {
    const [first, second] = asked.assets;
    const asAsked = sameAsset(amount, first) && sameAsset(amount2, second);
    const reversed = sameAsset(amount, second) && sameAsset(amount2, first);
    if (!asAsked && !reversed) throw malformed(what, "the pool's assets are not the pair asked for");
  }

  for (const key of ["asset_frozen", "asset2_frozen"] as const) {
    if (amm[key] !== undefined && typeof amm[key] !== "boolean") throw malformed(what, `"${key}" is neither true nor false`);
  }

  const voteSlots = amm.vote_slots;
  if (voteSlots !== undefined && !Array.isArray(voteSlots)) throw malformed(what, '"vote_slots" is not a list');
  if (voteSlots !== undefined && voteSlots.length > MAX_VOTE_SLOTS) {
    throw malformed(what, `${voteSlots.length} vote slots where a pool has at most ${MAX_VOTE_SLOTS}`);
  }
  // The pool's LP token is issued by the pool: the reserves' share of it is what a pool page works out.
  const lpToken = readAmount(what, "lp_token", amm.lp_token, null);
  if (lpToken.issuer !== account) throw malformed(what, `"lp_token" is issued by ${clip(lpToken.issuer ?? "")}, not by the pool`);
  const slot = amm.auction_slot;
  if (slot !== undefined && !isObject(slot)) throw malformed(what, '"auction_slot" is not an object');

  return {
    account,
    amount,
    amount2,
    ...(amm.asset_frozen !== undefined && { asset_frozen: amm.asset_frozen as boolean }),
    ...(amm.asset2_frozen !== undefined && { asset2_frozen: amm.asset2_frozen as boolean }),
    lp_token: lpToken,
    trading_fee: integerField(what, amm, "trading_fee", 0, 1000),
    vote_slots: ((voteSlots ?? []) as unknown[]).map((entry) => {
      if (!isObject(entry)) throw malformed(what, "a vote slot that is not an object");
      return {
        account: accountField(what, entry, "account", "a vote slot's"),
        trading_fee: integerField(what, entry, "trading_fee", 0, 1000),
        vote_weight: integerField(what, entry, "vote_weight", 0),
      };
    }),
    ...(slot !== undefined && { auction_slot: toAuctionSlot(what, slot as Json) }),
    ledger_index: integerField(what, result, "ledger_index", 0),
  };
}

/** The node's selector for a ledger given as an index or a hash. */
function ledgerSelector(id: string): { ledger_hash: string } | { ledger_index: number } {
  if (/^[0-9A-Fa-f]{64}$/.test(id)) return { ledger_hash: id };
  if (/^\d+$/.test(id) && Number.isSafeInteger(Number(id))) return { ledger_index: Number(id) };
  throw new UpstreamError("bad_request", `${JSON.stringify(id)} is neither a ledger index nor a ledger hash`);
}

// ---- The client ---------------------------------------------------------------------------------------------------

export function createNodeRpc(net: Network, cache: SubrequestCache): NodeRpc {
  /** Posts one command and returns the node's `result` of a success; a failure throws. `notFound`: the codes this command reads as `not_found`. */
  function post(method: string, body: string, notFound?: readonly string[]): Promise<Json> {
    const what = `node ${method}`;
    return withDeadline(NODE_TIMEOUT_MS, what, async (signal) => {
      const response = await fetch(net.nodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        signal,
      });

      if (!response.ok) {
        void response.body?.cancel();
        throw new UpstreamError(response.status === 429 ? "rate_limited" : "server", `${what} answered ${response.status}`, {
          status: response.status,
          retryAfter: retryAfterOf(response.headers),
        });
      }

      let answer: unknown;
      try {
        answer = await response.json();
      } catch (cause) {
        throw new UpstreamError("server", `${what} answered something that is not JSON`, { status: response.status, cause });
      }
      const result = isObject(answer) ? answer.result : undefined;
      if (!isObject(result)) throw malformed(what, 'no "result"');
      if (result.status === "error") throw errorOf(what, result, notFound);
      return result;
    });
  }

  /**
   * One cached command; what `read` makes of its `result` is what is returned and cached. `ttlOverride` keeps the answer that long under the
   * command's own key. `options.ttl` is a TTL a caller asks for: it has a cache entry of its own (the key says `[kept N s]`), so that an answer
   * kept longer for another caller is not what this one reads. `options.holdFailure` is the cache's failure hold; it is not part of the key.
   */
  async function call<T>(
    method: string,
    params: Json,
    cls: CacheClass,
    read: (what: string, result: Json) => T,
    ttlOverride?: number,
    options: NodeCallOptions & { notFound?: readonly string[] } = {},
  ): Promise<T> {
    const body = JSON.stringify({ method, params: [params] });
    const key = `POST ${net.nodeUrl} ${body}`;
    return cache.json(
      options.ttl === undefined ? key : `${key} [kept ${options.ttl} s]`,
      cls,
      async () => read(`node ${method}`, await post(method, body, options.notFound)),
      options.ttl ?? ttlOverride,
      options.holdFailure ? { holdFailure: true } : undefined,
    );
  }

  /** An asset as the node wants it: the network's native currency alone, else the currency as the ledger holds it and its issuer. */
  function assetParam(asset: Asset): { currency: string; issuer?: string } {
    if (asset.issuer) return { currency: asset.currency, issuer: asset.issuer };
    if (asset.currency !== net.native) {
      throw new UpstreamError("bad_request", `${JSON.stringify(asset.currency)} is not an asset without an issuer on ${net.name}`);
    }
    return { currency: net.native };
  }

  const readBook = (asked: BookAsked) => (what: string, result: Json) => toBook(what, net.native, asked, result);
  const readAmm = (asked: AmmAsked) => (what: string, result: Json) => toAmmInfo(what, net.native, asked, result);

  return {
    // A node answers about the ledgers it is validating, so what it says may still change (a transaction is not
    // found, then is): 5 s, like the rest of what is live, and never "immutable".
    tx: (hash) => call("tx", { transaction: hash }, "live", toTx),
    ledger: async (id, opts) =>
      call(
        "ledger",
        {
          ...ledgerSelector(id),
          ...((opts?.transactions || opts?.expand) && { transactions: true }),
          ...(opts?.expand && { expand: true }),
        },
        "live",
        toLedger,
      ),
    accountInfo: (address) => call("account_info", { account: address, ledger_index: "validated" }, "live", toAccountInfo),
    accountObjects: (address, opts) =>
      call(
        "account_objects",
        { account: address, ledger_index: "validated", limit: opts?.limit, marker: opts?.marker },
        "live",
        toAccountObjects,
      ),
    // The reserves change by a vote, rarely: 5 minutes.
    serverState: () => call("server_state", {}, "slow", toServerState, 300),
    // The book and the pool move with every ledger: class `live`, and the page that polls them asks for `ttl` and `holdFailure`. These are
    // `async` so that a refused asset is a failed promise, like the other calls' refusals.
    bookOffers: async (gets, pays, opts) =>
      call(
        "book_offers",
        { taker_gets: assetParam(gets), taker_pays: assetParam(pays), ledger_index: "validated", limit: BOOK_OFFERS_LIMIT },
        "live",
        readBook([gets, pays]),
        undefined,
        { ...opts, notFound: BOOK_NOT_FOUND },
      ),
    ammInfo: async (pool, opts) =>
      call(
        "amm_info",
        { amm_account: pool, ledger_index: "validated" },
        "live",
        readAmm({ pool }),
        undefined,
        { ...opts, notFound: AMM_NOT_FOUND },
      ),
    ammInfoByPair: async (asset, asset2, opts) =>
      call(
        "amm_info",
        { asset: assetParam(asset), asset2: assetParam(asset2), ledger_index: "validated" },
        "live",
        readAmm({ assets: [asset, asset2] }),
        undefined,
        { ...opts, notFound: AMM_NOT_FOUND },
      ),
  };
}
