// D5's ledger-object history over recorded ledgers, as its index would hold it and its routes would answer it: a port of data-api-new `feat/explorer-data-2` at PIN
// 0c2e58c3995cb3fdc240c3bf89dea9c4ab1e8adb (read with `git show`, never checked out or imported; test/fixtures/PROVENANCE.md, "Ledger object answers", names each file):
//
//   - the rows (D5 §2.1, §2.2): `packages/shared/src/parsers/object-changes.parser.ts` (`ObjectChangesParser`, `eventOf`) and the columns `build-rows.ts` adds to each change (the
//     transaction's place, type, result, sender and `Delegate`): `derivedObjectRows`;
//   - the answers (D5 §5): `apps/api/src/ledger-objects/object-views.ts` (the objects and events, their key orders and the keys left out), `object-status.ts` (the status at the
//     answer's close time), `ledger-objects.service.ts` (which rows a detail and a history page read, the creation, a channel's counts) and `object-answers.ts` (the bodies, the
//     coverage of an object: `itemCoverage` of `feature-coverage.service.ts`), `common/pagination.ts` (`paginate`, the marker): `derivedAnswer`, `derivedHistory`, `derivedLookup`.
//
// The objects are written key by key in the reference's order (docs/api-reference.md at PIN, "Ledger objects"); `fixtureText` sorts the keys of a file, so the tests check the order
// on the values before serialization. Like the other generators, this module reads nothing of http-fixtures.ts while it loads.

import BigNumber from "bignumber.js";
import { encodeAccountID } from "ripple-address-codec";

import type {
  CheckObject,
  Coverage,
  EscrowObject,
  LedgerObjectRef,
  ObjectAmount,
  ObjectAnswer,
  ObjectApiKind,
  ObjectEvent,
  ObjectHistoryPage,
  ObjectRef,
  PaymentChannelObject,
} from "../app/server/api-types";
import { encodeMarker, inLedgerOrder, isoTime, unixOf, type RawLedger, type RawTx } from "./http-fixtures";

/** The ledger entry types whose history the index keeps (D5 §1.1). */
export const TRACKED_TYPES = ["Escrow", "Check", "PayChannel", "Delegate"] as const;
export type TrackedType = (typeof TRACKED_TYPES)[number];

/** Not stored: the top-level fields `fields` and `previous` leave out (the thread of the node and the pages of the directories that list it). */
export const OBJECT_FIELD_EXCLUSIONS: readonly string[] = ["PreviousTxnID", "PreviousTxnLgrSeq", "OwnerNode", "DestinationNode", "IssuerNode"];

/** `PaymentChannelClaim`'s `tfRenew` and `tfClose`. */
const TF_RENEW = 0x00010000;
const TF_CLOSE = 0x00020000;

/** The sender of a pseudo-transaction whose `Account` is empty (Xahau's `UNLReport`): the zero account, as D5 stores it (`senderAccount`). */
const ACCOUNT_ZERO = "rrrrrrrrrrrrrrrrrrrrrhoLvTp";

/** How many events the detail of an object embeds (`DETAIL_EVENTS`). */
export const DETAIL_EVENTS = 50;

/** A row of D5's `object_changes`, as its service reads it (`ObjectRead`): `close_time` in unix seconds, the three JSON columns parsed. */
export interface DerivedObjectRow {
  object_type: TrackedType;
  object_id: string;
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  close_time: number;
  tx_type: string;
  result: string;
  sender: string;
  delegate: string;
  action: "created" | "modified" | "deleted";
  event: string;
  owner: string;
  counterparty: string;
  fields: Record<string, unknown>;
  previous: Record<string, unknown>;
  event_fields: Record<string, unknown>;
}

type Json = Record<string, unknown>;
type Action = DerivedObjectRow["action"];

const ACTIONS: Readonly<Record<string, Action>> = { CreatedNode: "created", ModifiedNode: "modified", DeletedNode: "deleted" };

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isTracked = (type: unknown): type is TrackedType => (TRACKED_TYPES as readonly unknown[]).includes(type);
const hasFlag = (flags: unknown, flag: number): boolean => typeof flags === "number" && (flags & flag) !== 0;
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** A copy of `value` with its keys sorted at every level, as D5 stores a JSON column (`stableStringify`) and reads it back. */
function sortedCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedCopy);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedCopy(value[key])]));
  return value;
}

/** `fields` without the top-level keys of `OBJECT_FIELD_EXCLUSIONS` (D5's `stored`). */
function stored(fields: Json | undefined): Json {
  const kept: Json = {};
  for (const [key, value] of Object.entries(fields ?? {})) if (!OBJECT_FIELD_EXCLUSIONS.includes(key)) kept[key] = value;
  return sortedCopy(kept) as Json;
}

/** The sequence an object created by `tx` is known by: its `Sequence`, else its `TicketSequence`; neither (a Hook-emitted Xahau transaction) gives none. */
function sequenceOf(tx: Json): number | undefined {
  if (positiveInteger(tx.Sequence)) return tx.Sequence;
  if (positiveInteger(tx.TicketSequence)) return tx.TicketSequence;
  return undefined;
}

/** What a cash delivered: the stored `DeliveredAmount`, else the served `delivered_amount`, else the transaction's `Amount` (never `DeliverMin`). */
const deliveredOf = (tx: Json, meta: Json): unknown => meta.DeliveredAmount ?? meta.delivered_amount ?? tx.Amount;

/** The event of a node and the facts it takes from the transaction (D5 §2.2): the first row of the table that matches, else `update`. */
function eventOf(type: TrackedType, action: Action, tx: Json, meta: Json, fields: Json, previous: Json | undefined): { event: string; facts: Json } {
  const by = tx.TransactionType;
  const sequence = sequenceOf(tx);
  const create = { event: "create", facts: sequence === undefined ? {} : { sequence } };
  const plain = (event: string) => ({ event, facts: {} });
  switch (type) {
    case "Escrow":
      if (action === "created" && by === "EscrowCreate") return create;
      if (action === "deleted") {
        if (by === "EscrowFinish") return { event: "finish", facts: typeof tx.Fulfillment === "string" ? { fulfillment: tx.Fulfillment } : {} };
        return plain(by === "EscrowCancel" ? "cancel" : "removed");
      }
      break;
    case "Check":
      if (action === "created" && by === "CheckCreate") return create;
      if (action === "deleted") {
        if (by === "CheckCash") {
          const delivered = deliveredOf(tx, meta);
          return { event: "cash", facts: delivered === undefined ? {} : { delivered } };
        }
        return plain(by === "CheckCancel" ? "cancel" : "removed");
      }
      break;
    case "PayChannel":
      if (action === "created" && by === "PaymentChannelCreate") return create;
      if (action === "deleted") return plain(by === "PaymentChannelClaim" || by === "PaymentChannelFund" ? "close" : "removed");
      if (action === "modified" && by === "PaymentChannelFund") return plain("fund");
      if (action === "modified" && by === "PaymentChannelClaim") {
        if (hasFlag(tx.Flags, TF_CLOSE) && "Expiration" in fields) return plain("close_request");
        if (hasFlag(tx.Flags, TF_RENEW) && previous && "Expiration" in previous && !("Expiration" in fields)) return plain("renew");
        return plain("claim");
      }
      break;
    case "Delegate":
      if (by === "DelegateSet" && action !== "deleted") return plain("set");
      if (action === "deleted") return plain(by === "DelegateSet" ? "delete" : "removed");
      break;
  }
  return plain("update");
}

/**
 * The rows of one transaction: a row for every created, modified or deleted node of a tracked type in its metadata, in that order, whatever its result. A modified node without
 * `PreviousFields` was only threaded: no row. The object is read from the node and nothing else (a Xahau `EscrowFinish` with `EscrowID` names the escrow's destination as `Owner`).
 */
export function rowsOfTransaction(raw: RawLedger, tx: RawTx): DerivedObjectRow[] {
  const rows: DerivedObjectRow[] = [];
  const meta = tx.metaData as Json;
  const nodes = Array.isArray(meta.AffectedNodes) ? (meta.AffectedNodes as unknown[]) : [];
  const account = typeof tx.Account === "string" ? tx.Account : undefined;
  if (account === undefined) throw new Error(`ledger ${raw.ledger.ledger_index}: transaction ${tx.hash} has no Account`);
  for (const wrapper of nodes) {
    if (!isObject(wrapper)) continue;
    const op = Object.keys(ACTIONS).find((name) => isObject(wrapper[name]));
    if (op === undefined) continue;
    const action = ACTIONS[op]!;
    const node = wrapper[op] as Json;
    const type = node.LedgerEntryType;
    if (!isTracked(type)) continue;
    if (action === "modified" && !isObject(node.PreviousFields)) continue;
    const fields = action === "created" ? node.NewFields : node.FinalFields;
    if (!isObject(fields) || typeof node.LedgerIndex !== "string") continue;
    const previous = isObject(node.PreviousFields) ? node.PreviousFields : undefined;
    const { event, facts } = eventOf(type, action, tx, meta, fields, previous);
    const counterparty = type === "Delegate" ? fields.Authorize : fields.Destination;
    rows.push({
      object_type: type,
      object_id: node.LedgerIndex.toUpperCase(),
      ledger_index: Number(raw.ledger.ledger_index),
      tx_index: tx.metaData.TransactionIndex,
      tx_hash: tx.hash,
      close_time: unixOf(raw.ledger.close_time),
      tx_type: String(tx.TransactionType),
      result: String(tx.metaData.TransactionResult),
      sender: account === "" ? ACCOUNT_ZERO : account,
      delegate: typeof tx.Delegate === "string" ? tx.Delegate : "",
      action,
      event,
      owner: typeof fields.Account === "string" ? fields.Account : "",
      counterparty: typeof counterparty === "string" ? counterparty : "",
      fields: stored(fields),
      previous: stored(previous),
      event_fields: sortedCopy(facts) as Json,
    });
  }
  return rows;
}

/** Every row the index holds of the ledgers, in ledger order and each ledger's transaction order. */
export function derivedObjectRows(ledgers: readonly RawLedger[]): DerivedObjectRow[] {
  const ordered = [...ledgers].sort((a, b) => Number(a.ledger.ledger_index) - Number(b.ledger.ledger_index));
  return ordered.flatMap((raw) => inLedgerOrder(raw).flatMap((tx) => rowsOfTransaction(raw, tx)));
}

// ---- Status (object-status.ts) -------------------------------------------------------------------------------------------------

/** Every time is unix seconds; `t` is the answer's close time. A deleted object has the status its deleting event gives. */
export function escrowStatus(o: { finishAfter?: number; cancelAfter?: number; removedBy?: string }, t: number): EscrowObject["status"] {
  if (o.removedBy !== undefined) return o.removedBy === "finish" ? "finished" : o.removedBy === "cancel" ? "cancelled" : "removed";
  if (o.cancelAfter !== undefined && t > o.cancelAfter) return "can_be_cancelled";
  if (o.finishAfter !== undefined && t <= o.finishAfter) return "pending";
  return "can_be_finished";
}

export function checkStatus(o: { expiration?: number; removedBy?: string }, t: number): CheckObject["status"] {
  if (o.removedBy !== undefined) return o.removedBy === "cash" ? "cashed" : o.removedBy === "cancel" ? "cancelled" : "removed";
  return o.expiration !== undefined && t >= o.expiration ? "expired" : "open";
}

export function channelStatus(o: { expiration?: number; cancelAfter?: number; removedBy?: string }, t: number): PaymentChannelObject["status"] {
  if (o.removedBy !== undefined) return o.removedBy === "close" ? "closed" : "removed";
  if (o.expiration !== undefined) return "closing";
  return o.cancelAfter !== undefined && t >= o.cancelAfter ? "closing" : "open";
}

// ---- The objects and events (object-views.ts) -----------------------------------------------------------------------------------

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
/** A Ripple-epoch field as `YYYY-MM-DDTHH:mm:ssZ`, and as unix seconds. */
const isoOf = (ripple: unknown): string | undefined => (num(ripple) === undefined ? undefined : isoTime(unixOf(num(ripple)!)));
const unixFieldOf = (ripple: unknown): number | undefined => (num(ripple) === undefined ? undefined : unixOf(num(ripple)!));

/** The keys of `o` whose value is not `undefined`, in their order (D5's `compact`). */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined)) as T;
}

/** Drops of the native currency as whole units, exact (D5's `dropsToNative`). */
const dropsToNative = (drops: string): string => new BigNumber(drops).dividedBy(1_000_000).toString(10);

/** An MPT amount: the issuance ID (upper case) as the currency and again last, the issuer the ID encodes (`Sequence (4) | Issuer (20)`), the raw units. */
export function mptAmountObject(issuanceId: string, value: string): ObjectAmount {
  const id = issuanceId.toUpperCase();
  return { currency: id, issuer: encodeAccountID(Buffer.from(id.slice(8, 48), "hex")), value, mpt_issuance_id: id };
}

/** A ledger amount as the API's amount object (D5's `objectAmount`); `undefined` for anything it cannot read. */
export function objectAmount(raw: unknown, native: string): ObjectAmount | undefined {
  if (typeof raw === "string") return /^\d+$/.test(raw) ? { currency: native, value: dropsToNative(raw) } : undefined;
  if (!isObject(raw)) return undefined;
  const value = text(raw.value);
  if (value === undefined) return undefined;
  const id = text(raw.mpt_issuance_id);
  if (id !== undefined) return /^[0-9a-fA-F]{48}$/.test(id) ? mptAmountObject(id, value) : undefined;
  const currency = text(raw.currency);
  const issuer = text(raw.issuer);
  return currency !== undefined && issuer !== undefined ? { currency, issuer, value } : undefined;
}

const withValue = (amount: ObjectAmount, value: string): ObjectAmount => ({ ...amount, value });

function difference(a: ObjectAmount | undefined, b: ObjectAmount | undefined): ObjectAmount | undefined {
  if (a === undefined || b === undefined) return undefined;
  const result = new BigNumber(a.value).minus(b.value);
  return result.isNaN() ? undefined : withValue(a, result.toFixed());
}

const isZero = (amount: ObjectAmount | undefined): boolean => amount !== undefined && new BigNumber(amount.value).isZero();

const ref = (row: DerivedObjectRow): ObjectRef => ({ ledger_index: row.ledger_index, time: isoTime(row.close_time), tx_hash: row.tx_hash });
const removedRef = (row: DerivedObjectRow): ObjectRef => ({ ...ref(row), tx_type: row.tx_type });

const removal = (newest: DerivedObjectRow): { removed?: ObjectRef; removedBy?: string } =>
  newest.action === "deleted" ? { removed: removedRef(newest), removedBy: newest.event } : {};

const objectSequence = (newest: DerivedObjectRow, created: DerivedObjectRow | undefined): number | undefined =>
  num(newest.fields.Sequence) ?? num(created?.event_fields.sequence);

function escrowObject(newest: DerivedObjectRow, created: DerivedObjectRow | undefined, t: number, native: string): EscrowObject {
  const f = newest.fields;
  const { removed, removedBy } = removal(newest);
  return compact({
    escrow_id: newest.object_id,
    account: newest.owner,
    sequence: objectSequence(newest, created),
    destination: newest.counterparty,
    amount: objectAmount(f.Amount, native),
    finish_after: isoOf(f.FinishAfter),
    cancel_after: isoOf(f.CancelAfter),
    condition: text(f.Condition),
    fulfillment: removed && text(newest.event_fields.fulfillment),
    destination_tag: num(f.DestinationTag),
    source_tag: num(f.SourceTag),
    transfer_rate: num(f.TransferRate),
    status: escrowStatus({ finishAfter: unixFieldOf(f.FinishAfter), cancelAfter: unixFieldOf(f.CancelAfter), removedBy }, t),
    created: created && ref(created),
    removed,
  });
}

function checkObject(newest: DerivedObjectRow, created: DerivedObjectRow | undefined, t: number, native: string): CheckObject {
  const f = newest.fields;
  const { removed, removedBy } = removal(newest);
  return compact({
    check_id: newest.object_id,
    account: newest.owner,
    sequence: objectSequence(newest, created),
    destination: newest.counterparty,
    send_max: objectAmount(f.SendMax, native),
    expiration: isoOf(f.Expiration),
    invoice_id: text(f.InvoiceID),
    destination_tag: num(f.DestinationTag),
    source_tag: num(f.SourceTag),
    delivered: removed && objectAmount(newest.event_fields.delivered, native),
    status: checkStatus({ expiration: unixFieldOf(f.Expiration), removedBy }, t),
    created: created && ref(created),
    removed,
  });
}

/** A channel's `Balance` after the row: the node's, or zero in the channel's currency when it has none (a created node omits a zero). */
function balanceOf(fields: Json, native: string): ObjectAmount | undefined {
  if (fields.Balance !== undefined) return objectAmount(fields.Balance, native);
  const amount = objectAmount(fields.Amount, native);
  return amount && withValue(amount, "0");
}

function paymentChannelObject(
  newest: DerivedObjectRow,
  created: DerivedObjectRow | undefined,
  counts: { funds: number; claims: number },
  t: number,
  native: string,
): PaymentChannelObject {
  const f = newest.fields;
  const { removed, removedBy } = removal(newest);
  const amount = objectAmount(f.Amount, native);
  const balance = balanceOf(f, native);
  return compact({
    channel_id: newest.object_id,
    account: newest.owner,
    sequence: objectSequence(newest, created),
    destination: newest.counterparty,
    amount,
    balance,
    remaining: difference(amount, balance),
    settle_delay: num(f.SettleDelay),
    public_key: text(f.PublicKey),
    expiration: isoOf(f.Expiration),
    cancel_after: isoOf(f.CancelAfter),
    destination_tag: num(f.DestinationTag),
    source_tag: num(f.SourceTag),
    status: channelStatus({ expiration: unixFieldOf(f.Expiration), cancelAfter: unixFieldOf(f.CancelAfter), removedBy }, t),
    opened_with: created && objectAmount(created.fields.Amount, native),
    funds: counts.funds,
    claims: counts.claims,
    created: created && ref(created),
    removed,
  });
}

function escrowExtras(row: DerivedObjectRow, native: string): Partial<ObjectEvent> {
  return {
    amount: row.event === "create" ? objectAmount(row.fields.Amount, native) : undefined,
    fulfillment: row.event === "finish" ? text(row.event_fields.fulfillment) : undefined,
  };
}

function checkExtras(row: DerivedObjectRow, native: string): Partial<ObjectEvent> {
  const create = row.event === "create";
  return {
    send_max: create ? objectAmount(row.fields.SendMax, native) : undefined,
    expiration: create ? isoOf(row.fields.Expiration) : undefined,
    delivered: row.event === "cash" ? objectAmount(row.event_fields.delivered, native) : undefined,
  };
}

function channelExtras(row: DerivedObjectRow, native: string): Partial<ObjectEvent> {
  const { fields: f, previous: p } = row;
  const amount = objectAmount(f.Amount, native);
  const balance = balanceOf(f, native);
  const change = (after: ObjectAmount | undefined, before: unknown): ObjectAmount | undefined => {
    const delta = before === undefined ? undefined : difference(after, objectAmount(before, native));
    return isZero(delta) ? undefined : delta;
  };
  return {
    amount,
    balance,
    amount_change: change(amount, p.Amount),
    balance_change: change(balance, p.Balance),
    expiration: isoOf(f.Expiration),
    settle_delay: row.event === "create" ? num(f.SettleDelay) : undefined,
  };
}

const EXTRAS: Partial<Record<TrackedType, (row: DerivedObjectRow, native: string) => Partial<ObjectEvent>>> = {
  Escrow: escrowExtras,
  Check: checkExtras,
  PayChannel: channelExtras,
};

/** An event of an object's history from its row: the transaction, then the facts of the object's type. */
export function objectEvent(row: DerivedObjectRow, native: string): ObjectEvent {
  return compact({
    event: row.event,
    ledger_index: row.ledger_index,
    time: isoTime(row.close_time),
    tx_hash: row.tx_hash,
    tx_type: row.tx_type,
    account: row.sender,
    delegate: text(row.delegate),
    result: row.result,
    ...EXTRAS[row.object_type]?.(row, native),
  });
}

// ---- The answers (ledger-objects.service.ts, object-answers.ts) -------------------------------------------------------------------

/** The type of each kind in the rows, and the key its answer keeps the object under. */
export const OBJECT_TYPE_OF: Readonly<Record<ObjectApiKind, "Escrow" | "Check" | "PayChannel">> = { escrow: "Escrow", check: "Check", payment_channel: "PayChannel" };
export const ANSWER_KEY_OF: Readonly<Record<ObjectApiKind, "escrow" | "check" | "payment_channel">> = { escrow: "escrow", check: "check", payment_channel: "payment_channel" };

/** The point an answer is as of: the newest ledger the index holds and its close time, unix seconds. */
export interface AsOf {
  ledger_index: number;
  close_time: number;
}

const byPositionDescending = (a: DerivedObjectRow, b: DerivedObjectRow): number => b.ledger_index - a.ledger_index || b.tx_index - a.tx_index;

/** The rows of one object of a type up to the as-of ledger, newest first, one to a transaction (D5 reads each `(ledger_index, tx_index)` once). */
function rowsOfObject(type: TrackedType | readonly TrackedType[], rows: readonly DerivedObjectRow[], id: string, asOf: AsOf): DerivedObjectRow[] {
  const types: readonly TrackedType[] = typeof type === "string" ? [type] : type;
  const seen = new Set<string>();
  const found: DerivedObjectRow[] = [];
  for (const row of [...rows].sort(byPositionDescending)) {
    if (!types.includes(row.object_type) || row.object_id !== id || row.ledger_index > asOf.ledger_index) continue;
    const key = `${row.ledger_index}:${row.tx_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(row);
  }
  return found;
}

/** The row that created the object: the first `created` row of its prefix, oldest first (`creation`). */
const creationOf = (newestFirst: readonly DerivedObjectRow[]): DerivedObjectRow | undefined => [...newestFirst].reverse().find((row) => row.action === "created");

/** The coverage of one item created in `createdLedger` (`itemCoverage`): the feature's, and complete also when its creation is indexed. */
export function itemCoverage(coverage: Coverage, createdLedger: number | undefined): Coverage {
  const from = coverage.from_ledger_index;
  if (coverage.complete || from === undefined || createdLedger === undefined || createdLedger < from) return coverage;
  return { from_ledger_index: from, complete: true };
}

/** `paginate`: the first `limit` rows, and the marker of the last of them when there are more. */
function paginate(rows: readonly DerivedObjectRow[], limit: number): { rows: DerivedObjectRow[]; marker?: string } {
  if (rows.length <= limit) return { rows: [...rows] };
  const page = rows.slice(0, limit);
  const last = page.at(-1)!;
  return { rows: page, marker: encodeMarker([last.ledger_index, last.tx_index]) };
}

/** The base64url JSON `[ledger_index, tx_index]` of a marker, read back. */
export function markerPosition(marker: string): [number, number] {
  const values = JSON.parse(Buffer.from(marker, "base64url").toString("utf8")) as unknown;
  if (!Array.isArray(values) || values.length !== 2 || !values.every((value) => Number.isSafeInteger(value))) throw new Error(`invalid marker ${marker}`);
  return [values[0] as number, values[1] as number];
}

/** What every answer of an object starts with: `result`, its coverage, and the point it is as of. */
function head(coverage: Coverage, created: DerivedObjectRow | undefined, asOf: AsOf) {
  return { result: "success" as const, coverage: itemCoverage(coverage, created?.ledger_index), ledger_index: asOf.ledger_index, close_time: isoTime(asOf.close_time) };
}

/**
 * `GET /v2/{escrows|checks|payment_channels}/{id}` as D5 answers it from `rows`: the object as of `asOf` (its status at that close time), its newest 50 events newest first and the
 * `history_marker` of the rest. The creation is the one among the newest 51 rows, else (when there are more) the first of the object's; the coverage is the feature's `coverage`,
 * complete when the creation is indexed. Throws for an object with no row up to `asOf` (D5's 404).
 */
export function derivedAnswer(kind: ObjectApiKind, rows: readonly DerivedObjectRow[], id: string, asOf: AsOf, native: "XRP" | "XAH", coverage: Coverage): ObjectAnswer {
  const all = rowsOfObject(OBJECT_TYPE_OF[kind], rows, id, asOf);
  if (all.length === 0) throw new Error(`${kind} ${id}: not found`);
  const page = all.slice(0, DETAIL_EVENTS + 1);
  const created = page.find((row) => row.action === "created") ?? (page.length > DETAIL_EVENTS ? creationOf(all) : undefined);
  const newest = page[0]!;
  const object =
    kind === "escrow"
      ? escrowObject(newest, created, asOf.close_time, native)
      : kind === "check"
        ? checkObject(newest, created, asOf.close_time, native)
        : paymentChannelObject(
            newest,
            created,
            // `funds`: the `fund` events; `claims`: the events whose `previous` holds a `Balance`; each transaction once, over the whole prefix.
            { funds: all.filter((row) => row.event === "fund").length, claims: all.filter((row) => "Balance" in row.previous).length },
            asOf.close_time,
            native,
          );
  const embedded = paginate(page, DETAIL_EVENTS);
  return {
    ...head(coverage, created, asOf),
    [ANSWER_KEY_OF[kind]]: object,
    history: embedded.rows.map((row) => objectEvent(row, native)),
    ...(embedded.marker !== undefined && { history_marker: embedded.marker }),
  } as unknown as ObjectAnswer;
}

/**
 * `GET /v2/{escrows|checks|payment_channels}/{id}/history?descending=true&limit=…[&marker=…]` as D5 answers it from `rows`: the events after the marker, newest first, `limit` of them,
 * the marker of the last when there are more; the coverage of the object (its creation is the page's, else the first of the object's). Throws for an object with no row.
 */
export function derivedHistory(
  kind: ObjectApiKind,
  rows: readonly DerivedObjectRow[],
  id: string,
  asOf: AsOf,
  native: "XRP" | "XAH",
  coverage: Coverage,
  q: { limit: number; marker?: string },
): ObjectHistoryPage {
  const all = rowsOfObject(OBJECT_TYPE_OF[kind], rows, id, asOf);
  if (all.length === 0) throw new Error(`${kind} ${id}: not found`);
  const after = q.marker === undefined ? undefined : markerPosition(q.marker);
  const rest = after === undefined ? all : all.filter((row) => row.ledger_index < after[0] || (row.ledger_index === after[0] && row.tx_index < after[1]));
  const page = paginate(rest.slice(0, q.limit + 1), q.limit);
  const created = page.rows.find((row) => row.action === "created") ?? creationOf(all);
  return {
    ...head(coverage, created, asOf),
    count: page.rows.length,
    ...(page.marker !== undefined && { marker: page.marker }),
    history: page.rows.map((row) => objectEvent(row, native)),
  };
}

/** `GET /v2/ledger_objects/{id}` as D5 answers it (`ledger_object`): the newest row of the ID under any tracked type. Throws for an ID with no row. */
export function derivedLookup(rows: readonly DerivedObjectRow[], id: string, asOf: AsOf): LedgerObjectRef {
  const newest = rowsOfObject(TRACKED_TYPES, rows, id, asOf)[0];
  if (newest === undefined) throw new Error(`ledger object ${id}: not found`);
  return { object_id: newest.object_id, object_type: newest.object_type, account: newest.owner, deleted: newest.action === "deleted", ledger_index: newest.ledger_index };
}
