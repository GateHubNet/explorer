// What the answers of D5's routes must look like for the ledger-object pages (E10) to use them: an escrow, a check and a payment channel with their newest events, the pages of
// their history, an account's delegations, and the lookup of an ID (data-api-new `feat/explorer-data-2` at 0c2e58c, docs/api-reference.md "Ledger objects"; the types are in
// api-types.ts, "Ledger objects"). Like `nft-shape.ts`, the data API client runs the checks inside the load its subrequest cache runs, as `get()`'s `finish`: a 200 that is not
// what the reference promises is an `UpstreamError` of kind `server` (status 200 marks it as an answer of the upstream), is never stored, and the page fails with it. A check takes
// the whole body (the lookup's: the part under `ledger_object`, which the client unwraps) and the path that was asked for, whose message it names and from which it reads the ID
// that was asked for; it returns the body, typed, as it is. Worker-only code, no I/O.
//
// What is checked (a key the API leaves out when it has no value is checked when it is there, and `null` is never served; extra keys are not refused, the API may add one):
//   - every answer but the lookup has `result: "success"`, a `coverage` that is one (`checkCoverage`), a `ledger_index` that is a whole number and a `close_time` that is a time;
//   - an object ID, a delegation ID and a transaction hash are 64 hexadecimal digits in upper case: they go into paths and links. The ID of the object (the lookup's `object_id`
//     too) is the one the request asked for; an answer for another object is not the answer to that request, and a page would show it as the one asked for;
//   - a delegations page is of the account and the direction the path asks for: each delegation's `account` is that account (`given`, the default), or its `authorize` (`held`);
//   - an account (an owner, a destination, an issuer, an event's sender and delegate, a delegation's two accounts) is a classic address with its checksum, because it goes into a
//     link; an X-address holds a tag and is not one;
//   - a time (`finish_after`, `cancel_after`, `expiration`, an event's `time`, a reference's `time`, `close_time`) is `YYYY-MM-DDTHH:mm:ssZ`; counts, ledger indexes, a sequence, a tag,
//     `settle_delay` and `transfer_rate` are whole numbers;
//   - an amount is an object with a `currency`, an `issuer` that is an account when it has one and, for an MPT, a `mpt_issuance_id` of 48 upper-case hexadecimal digits that is also
//     its `currency`. Its `value` is text, in the form D5 writes it (E10 decision on the amounts, the reference's "Amounts"): a native or an MPT value, and `remaining`,
//     `amount_change` and `balance_change` in every currency, are plain decimals (`isDecimalText`: D5 converts drops, writes the raw integer units, and computes with `toFixed()`);
//     the `amount`, `balance`, `send_max`, `delivered` and `opened_with` of an issued token (an `issuer`, no `mpt_issuance_id`) are the ledger's own text, which writes large and tiny
//     values in exponent form (`isNumberText`), on the objects and on the events;
//   - a status is one of the object's (`OBJECT_STATUSES`), an event one of its object's (`OBJECT_EVENTS`); a permission's `kind` is one of three; the lookup's `object_type` is
//     one of four;
//   - D5 drops a field it cannot read from an object or an event (`compact`), so an escrow's `amount`, a check's `send_max`, a channel's `amount`, `balance`, `remaining`,
//     `settle_delay` and `public_key`, and a channel event's `amount` and `balance` may be missing, and are checked when they are there.

import { fields, isAccount, isBoolean, isDecimalText, isIsoTime, isName, isNumberText, isWhole, listOf, optionalFields, rowsOf } from "./aggregate-shape";
import type {
  CheckAnswer,
  DelegationsPage,
  EscrowAnswer,
  LedgerObjectRef,
  ObjectAnswer,
  ObjectApiKind,
  ObjectHistoryPage,
  PaymentChannelAnswer,
} from "./api-types";
import { checkCoverage } from "./coverage";
import { isMarker } from "./marker";
import { isObject, malformed } from "./tx-shape";

type Row = Record<string, unknown>;

const OBJECT_ID = "an ID (64 upper-case hexadecimal digits)";
const HASH = "a hash (64 upper-case hexadecimal digits)";
const ACCOUNT = "an account";
const WHOLE = "a whole number";
const DECIMAL = "a decimal as text";
const NUMBER = "a number as text";
const TIME = "a time";
const HEX = "hex text";

const HEX64 = /^[0-9A-F]{64}$/;
const HEX64_ANY_CASE = /^[0-9A-Fa-f]{64}$/;
const HEX_BYTES = /^(?:[0-9A-Fa-f]{2})+$/;
const MPT_ISSUANCE_ID = /^[0-9A-F]{48}$/;

const isHash = (value: unknown): value is string => typeof value === "string" && HEX64.test(value);
/** The `InvoiceID` of a check: a hash as the transaction wrote it, in either case (it is never a path). */
const isInvoiceId = (value: unknown): value is string => typeof value === "string" && HEX64_ANY_CASE.test(value);
/** A crypto-condition, a fulfillment, a public key: hex of whole bytes, and not empty (a key that is not there is left out). */
const isHex = (value: unknown): value is string => typeof value === "string" && HEX_BYTES.test(value);
const isMptIssuanceId = (value: unknown): value is string => typeof value === "string" && MPT_ISSUANCE_ID.test(value);
/** A word out of a fixed set. */
const oneOf =
  (words: readonly string[]) =>
  (value: unknown): boolean =>
    typeof value === "string" && words.includes(value);

/** The statuses of each object, from D5's table (the reference's "Status"). */
export const OBJECT_STATUSES: Readonly<Record<ObjectApiKind, readonly string[]>> = {
  escrow: ["pending", "can_be_finished", "can_be_cancelled", "finished", "cancelled", "removed"],
  check: ["open", "expired", "cashed", "cancelled", "removed"],
  payment_channel: ["open", "closing", "closed", "removed"],
};

/** The events of each object's history (the reference's text on an event of each); `update` is a change by a transaction no one expects. */
export const OBJECT_EVENTS: Readonly<Record<ObjectApiKind, readonly string[]>> = {
  escrow: ["create", "finish", "cancel", "removed", "update"],
  check: ["create", "cash", "cancel", "removed", "update"],
  payment_channel: ["create", "fund", "claim", "close_request", "renew", "close", "removed", "update"],
};

/** The route of each object under `/v2`, the key its answer keeps it under, the key of its ID, and what it is called in a message. */
const KINDS = {
  escrow: { route: "escrows", key: "escrow", id: "escrow_id", noun: "an escrow" },
  check: { route: "checks", key: "check", id: "check_id", noun: "a check" },
  payment_channel: { route: "payment_channels", key: "payment_channel", id: "channel_id", noun: "a payment channel" },
} as const satisfies Record<ObjectApiKind, { route: string; key: string; id: string; noun: string }>;

const PERMISSION_KINDS = ["transaction", "granular", "unknown"];
/** The entry types of an object that `GET /v2/ledger_objects/{object_id}` can say an ID is: the one list of them, which the search reads the node's entries by too (resolve.ts). */
export const OBJECT_TYPES = ["Escrow", "Check", "PayChannel", "Delegate"] as const satisfies readonly LedgerObjectRef["object_type"][];

/** The object under `where`, or a failure. */
function objectAt(what: string, where: string, value: unknown): Row {
  if (!isObject(value)) throw malformed(what, `${where} is not an object`);
  return value;
}

/** The list under `where`, each row an object. */
function listAt(what: string, where: string, value: unknown): Row[] {
  if (!Array.isArray(value)) throw malformed(what, `${where} is not a list`);
  for (const [index, row] of (value as unknown[]).entries()) objectAt(what, `${where}[${index}]`, row);
  return value as Row[];
}

/** What an answer but the lookup starts with: `result`, a coverage, and the ledger it is as of. Returned, so that a check reads its keys from it. */
function answerOf(what: string, body: unknown): Row {
  if (!isObject(body)) throw malformed(what, "the answer is not an object");
  if (body.result !== "success") throw malformed(what, 'result is not "success"');
  checkCoverage(body, `${what} answered something unexpected`);
  fields(what, "answer", body, ["ledger_index"], isWhole, WHOLE);
  fields(what, "answer", body, ["close_time"], isIsoTime, TIME);
  return body;
}

/** The ID the request asked for, in upper case (the routes take any case, the answers have upper): the segment of `path` after the route's own. */
function askedId(what: string, route: string, path: string): string {
  const id = new RegExp(`^/v2/${route}/([^/?#]+)`).exec(path)?.[1];
  if (id === undefined) throw malformed(what, `the request names no ID under /v2/${route}, to compare the answer's with`);
  return id.toUpperCase();
}

/** The account and the direction a delegations request asked for: `/v2/accounts/{address}/delegations?direction=…` (missing or empty is `given`, D5's default). */
function askedDelegations(what: string, path: string): { address: string; direction: "given" | "held" } {
  const match = /^\/v2\/accounts\/([^/?#]+)\/delegations(?:\?([^#]*))?$/.exec(path);
  if (match === null) throw malformed(what, "the request names no account under /v2/accounts/{address}/delegations, to compare the answer's with");
  const direction = new URLSearchParams(match[2] ?? "").get("direction") || "given";
  if (direction !== "given" && direction !== "held") throw malformed(what, `the request's direction is ${JSON.stringify(direction)}, neither given nor held`);
  return { address: match[1]!, direction };
}

/**
 * Throws unless `value` is an amount whose `value` is text of the form `text` says: `ledger`, the ledger's own (so an issued token's may be in exponent form), or `plain`, a decimal
 * that D5 computed or converted. A native amount and an MPT's are plain decimals whichever, and an issued token is one with an `issuer` and no `mpt_issuance_id`.
 */
function checkAmount(what: string, where: string, value: unknown, text: "ledger" | "plain"): void {
  const amount = objectAt(what, where, value);
  fields(what, where, amount, ["currency"], isName, "a currency");
  optionalFields(what, where, amount, ["issuer"], isAccount, ACCOUNT);
  optionalFields(what, where, amount, ["mpt_issuance_id"], isMptIssuanceId, "an MPT issuance ID (48 upper-case hexadecimal digits)");
  if (amount.mpt_issuance_id !== undefined && amount.currency !== amount.mpt_issuance_id) {
    throw malformed(what, `${where}.currency is not the mpt_issuance_id of the amount`);
  }
  const issuedToken = amount.issuer !== undefined && amount.mpt_issuance_id === undefined;
  if (text === "ledger" && issuedToken) fields(what, where, amount, ["value"], isNumberText, NUMBER);
  else fields(what, where, amount, ["value"], isDecimalText, DECIMAL);
}

/** The place of a fact in the ledger history: `created`, `updated`, and (with `type`) `removed`, which also says what kind of transaction deleted the object. */
function checkRef(what: string, where: string, value: unknown, type = false): void {
  const ref = objectAt(what, where, value);
  fields(what, where, ref, ["ledger_index"], isWhole, WHOLE);
  fields(what, where, ref, ["time"], isIsoTime, TIME);
  fields(what, where, ref, ["tx_hash"], isHash, HASH);
  if (type) fields(what, where, ref, ["tx_type"], isName, "a transaction type");
}

/** One event of the history of an object of `kind`: the transaction, then the facts of that type (the reference's "Keys of the extras of …"). */
function checkEvent(what: string, where: string, kind: ObjectApiKind, row: Row): void {
  fields(what, where, row, ["event"], oneOf(OBJECT_EVENTS[kind]), `an event of ${KINDS[kind].noun}`);
  fields(what, where, row, ["ledger_index"], isWhole, WHOLE);
  fields(what, where, row, ["time"], isIsoTime, TIME);
  fields(what, where, row, ["tx_hash"], isHash, HASH);
  fields(what, where, row, ["tx_type", "result"], isName, "text that is not empty");
  fields(what, where, row, ["account"], isAccount, ACCOUNT);
  optionalFields(what, where, row, ["delegate"], isAccount, ACCOUNT);

  if (kind === "escrow") {
    if (row.amount !== undefined) checkAmount(what, `${where}.amount`, row.amount, "ledger");
    optionalFields(what, where, row, ["fulfillment"], isHex, HEX);
  } else if (kind === "check") {
    for (const name of ["send_max", "delivered"]) if (row[name] !== undefined) checkAmount(what, `${where}.${name}`, row[name], "ledger");
    optionalFields(what, where, row, ["expiration"], isIsoTime, TIME);
  } else {
    // An event of a channel carries the channel's `amount` and `balance` after it (D5 leaves one out that it cannot read); the changes are there only when nonzero, and are computed.
    for (const name of ["amount", "balance"]) if (row[name] !== undefined) checkAmount(what, `${where}.${name}`, row[name], "ledger");
    for (const name of ["amount_change", "balance_change"]) if (row[name] !== undefined) checkAmount(what, `${where}.${name}`, row[name], "plain");
    optionalFields(what, where, row, ["expiration"], isIsoTime, TIME);
    optionalFields(what, where, row, ["settle_delay"], isWhole, WHOLE);
  }
}

/** What the three objects start with, and end with: their ID (the one asked for), the two accounts, the sequence and tags, the status, where they were created and removed. */
function checkObjectHead(what: string, where: string, kind: ObjectApiKind, object: Row, asked: string): void {
  const idKey = KINDS[kind].id;
  fields(what, where, object, [idKey], isHash, OBJECT_ID);
  if (object[idKey] !== asked) throw malformed(what, `${where}.${idKey} is not the object asked for`);
  fields(what, where, object, ["account", "destination"], isAccount, ACCOUNT);
  optionalFields(what, where, object, ["sequence", "destination_tag", "source_tag"], isWhole, WHOLE);
  fields(what, where, object, ["status"], oneOf(OBJECT_STATUSES[kind]), `a status of ${KINDS[kind].noun}`);
  if (object.created !== undefined) checkRef(what, `${where}.created`, object.created);
  if (object.removed !== undefined) checkRef(what, `${where}.removed`, object.removed, true);
}

/** The keys of each object beside its head. */
function checkObjectBody(what: string, where: string, kind: ObjectApiKind, object: Row): void {
  if (kind === "escrow") {
    if (object.amount !== undefined) checkAmount(what, `${where}.amount`, object.amount, "ledger");
    optionalFields(what, where, object, ["finish_after", "cancel_after"], isIsoTime, TIME);
    optionalFields(what, where, object, ["condition", "fulfillment"], isHex, HEX);
    optionalFields(what, where, object, ["transfer_rate"], isWhole, WHOLE);
  } else if (kind === "check") {
    if (object.send_max !== undefined) checkAmount(what, `${where}.send_max`, object.send_max, "ledger");
    if (object.delivered !== undefined) checkAmount(what, `${where}.delivered`, object.delivered, "ledger");
    optionalFields(what, where, object, ["expiration"], isIsoTime, TIME);
    optionalFields(what, where, object, ["invoice_id"], isInvoiceId, "64 hexadecimal digits");
  } else {
    for (const name of ["amount", "balance", "opened_with"]) if (object[name] !== undefined) checkAmount(what, `${where}.${name}`, object[name], "ledger");
    if (object.remaining !== undefined) checkAmount(what, `${where}.remaining`, object.remaining, "plain");
    fields(what, where, object, ["funds", "claims"], isWhole, WHOLE);
    optionalFields(what, where, object, ["settle_delay"], isWhole, WHOLE);
    optionalFields(what, where, object, ["public_key"], isHex, HEX);
    optionalFields(what, where, object, ["expiration", "cancel_after"], isIsoTime, TIME);
  }
}

/** The events of an answer, under `history`, each checked as an event of `kind`. */
function checkEvents(what: string, kind: ObjectApiKind, rows: Row[]): void {
  for (const [index, row] of rows.entries()) checkEvent(what, `history[${index}]`, kind, row);
}

export function checkObjectAnswer(kind: "escrow", body: unknown, path: string): EscrowAnswer;
export function checkObjectAnswer(kind: "check", body: unknown, path: string): CheckAnswer;
export function checkObjectAnswer(kind: "payment_channel", body: unknown, path: string): PaymentChannelAnswer;
export function checkObjectAnswer(kind: ObjectApiKind, body: unknown, path: string): ObjectAnswer;
/**
 * `GET /v2/escrows/{escrow_id}`, `/v2/checks/{check_id}` and `/v2/payment_channels/{channel_id}`: the object, under `escrow`, `check` or `payment_channel`, which must be the one the
 * path asks for, and its newest events under `history`, with the `history_marker` of the page behind them when there are more.
 */
export function checkObjectAnswer(kind: ObjectApiKind, body: unknown, path: string): ObjectAnswer {
  const what = `data API GET ${path}`;
  const { route, key } = KINDS[kind];
  const head = answerOf(what, body);
  const object = objectAt(what, key, head[key]);
  checkObjectHead(what, key, kind, object, askedId(what, route, path));
  checkObjectBody(what, key, kind, object);
  checkEvents(what, kind, rowsOf(what, head, "history"));
  if (head.history_marker !== undefined && !isMarker(head.history_marker)) throw malformed(what, "history_marker is not a marker");
  return body as ObjectAnswer;
}

/** `GET /v2/escrows/{escrow_id}/history` and its two siblings: a page of the events of one object, under `history`, with a `count` and, when there is a next page, a `marker`. */
export function checkObjectHistory(kind: ObjectApiKind, body: unknown, path: string): ObjectHistoryPage {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  checkEvents(what, kind, listOf(what, body, "history"));
  return body as ObjectHistoryPage;
}

/**
 * `GET /v2/accounts/{address}/delegations`: the delegations, under `delegations`, each of the account and the direction the path asks for: with `given` (the default) the account
 * is its `account`, with `held` its `authorize`. A page of another account's, or of the other direction, is not the answer to that request.
 */
export function checkDelegations(body: unknown, path: string): DelegationsPage {
  const what = `data API GET ${path}`;
  const { address, direction } = askedDelegations(what, path);
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "delegations").entries()) {
    const where = `delegations[${index}]`;
    fields(what, where, row, ["delegation_id"], isHash, OBJECT_ID);
    fields(what, where, row, ["account", "authorize"], isAccount, ACCOUNT);
    const whose = direction === "given" ? "account" : "authorize";
    if (row[whose] !== address) throw malformed(what, `${where}.${whose} is not the account asked for`);
    for (const [at, permission] of listAt(what, `${where}.permissions`, row.permissions).entries()) {
      const here = `${where}.permissions[${at}]`;
      fields(what, here, permission, ["permission"], isName, "a permission");
      fields(what, here, permission, ["kind"], oneOf(PERMISSION_KINDS), "transaction, granular or unknown");
      optionalFields(what, here, permission, ["transaction_type"], isName, "a transaction type");
    }
    checkRef(what, `${where}.updated`, row.updated);
    if (row.created !== undefined) checkRef(what, `${where}.created`, row.created);
  }
  return body as DelegationsPage;
}

/** `GET /v2/ledger_objects/{object_id}`: `body` is the part under `ledger_object` (the client unwraps it), which must be of the ID the path asks for. */
export function checkLedgerObject(body: unknown, path: string): LedgerObjectRef {
  const what = `data API GET ${path}`;
  const found = objectAt(what, "ledger_object", body);
  fields(what, "ledger_object", found, ["object_id"], isHash, OBJECT_ID);
  if (found.object_id !== askedId(what, "ledger_objects", path)) throw malformed(what, "ledger_object.object_id is not the object asked for");
  fields(what, "ledger_object", found, ["object_type"], oneOf(OBJECT_TYPES), "Escrow, Check, PayChannel or Delegate");
  fields(what, "ledger_object", found, ["account"], isAccount, ACCOUNT);
  fields(what, "ledger_object", found, ["deleted"], isBoolean, "a boolean");
  fields(what, "ledger_object", found, ["ledger_index"], isWhole, WHOLE);
  return body as LedgerObjectRef;
}
