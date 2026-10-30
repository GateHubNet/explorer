// What the pages of an escrow, a check and a payment channel have in common (ledger object pages spec 4.1 and 4.5), as pure data for the page to draw: the node's entry in the shape of the
// data API's object, the title line, the removed banner, the as-of note, the owner reserve, the timeline, the paging, and `commonOf`, which gathers them for a type's view builder
// (`escrow-view.ts`, `check-view.ts`, `payment-channel-view.ts`) beside the parts that are the type's own.
//
// The page data holds strings and unix seconds, never ages: a time is a number the page writes with `formatUtc` and puts `RelativeTime` or `Countdown` beside (global constraints), so the
// stored page is the same at any age. Every sentence is a `Segment[]`, which a builder gives to `accountsIn` for the names its page needs (E9, "Display names").
//
// Worker and tests only: it decodes an MPT issuance ID with `ripple-address-codec`, which no browser file may import.

import BigNumber from "bignumber.js";
import { encodeAccountID } from "ripple-address-codec";

import { accountsIn, type Segment } from "../domain/describe";
import { dropsToNative, formatAmount, formatCurrency } from "../domain/format";
import type { NamesPart } from "../domain/names";
import { OBJECT_KINDS, type ObjectKind } from "../domain/object-link";
import { channelStatus, checkStatus, escrowStatus } from "../domain/object-status";
import type { Native } from "../domain/parse/types";
import { trailPaging, type Paging } from "../domain/paging";
import { trailPairs, withQuery } from "../domain/query-of";
import { formatDateTime } from "../domain/time-words";
import type { PillTone } from "../ui/components/Pill";
import type { StateItem } from "../ui/components/StatesStrip";
import type { TimelineItem } from "../ui/components/Timeline";
import type { CheckObject, EscrowObject, ObjectAmount, ObjectAnswer, ObjectEvent, ObjectHistoryPage, ObjectRef, PaymentChannelObject } from "./api-types";
import { coverageNote, type CoverageNoteText } from "./coverage";
import type { Network, NetworkId } from "./networks";
import { RIPPLE_EPOCH_OFFSET, type LedgerObject, type ServerState } from "./node-rpc";
import { UpstreamError } from "./upstream";
import { unixOf } from "./validator-facts";

// ---- Where an object is read from ----------------------------------------------------------------------------------------------------------------

/**
 * What a page is made of: the data API's answer for the object (`origin: "index"`), with the history page the request's `?marker=` asked for when it has one, or the node's entry
 * (`origin: "node"`, for an object the index does not have): the entry as `ledger_entry` gave it, the ledger it was read at, and the request's time in unix seconds, the time its status is
 * worked out at.
 */
export type ObjectSource =
  | { origin: "index"; answer: ObjectAnswer; history?: ObjectHistoryPage }
  | { origin: "node"; entry: LedgerObject; ledgerIndex: number; now: number };

/** A payment channel read from the node has no `funds` or `claims`: they count the events of a history the node does not have. */
export type NodeChannelObject = Omit<PaymentChannelObject, "funds" | "claims">;

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const textOf = (value: unknown): string | undefined => (isText(value) ? value : undefined);
const wholeOf = (value: unknown): number | undefined => (isWhole(value) ? value : undefined);

/** A field the entry cannot be an object without. The node's entry is checked for its type alone (node-rpc.ts), so a missing one is an answer that is not what it should be. */
function required(entry: LedgerObject, field: string): string {
  const value = entry[field];
  if (!isText(value)) throw new UpstreamError("server", `the node's ${entry.LedgerEntryType} entry has no ${field}`, { status: 200 });
  return value;
}

/** A Ripple-epoch time as unix seconds, and as the API writes it (`YYYY-MM-DDTHH:mm:ssZ`). */
const unixOfRipple = (ripple: unknown): number | undefined => (isWhole(ripple) ? ripple + RIPPLE_EPOCH_OFFSET : undefined);
const isoOfUnix = (unix: number): string => new Date(unix * 1000).toISOString().replace(".000Z", "Z");
const isoOfRipple = (ripple: unknown): string | undefined => {
  const unix = unixOfRipple(ripple);
  return unix === undefined ? undefined : isoOfUnix(unix);
};

/** An MPT amount as D5 writes it: the issuance ID (upper case) in `currency` and again last, the issuer the ID encodes (a 4-byte sequence, then the 20-byte issuer), the raw units. */
function mptAmount(issuanceId: string, value: string): ObjectAmount {
  const id = issuanceId.toUpperCase();
  const issuer = Uint8Array.from({ length: 20 }, (_, i) => parseInt(id.slice(8 + 2 * i, 10 + 2 * i), 16));
  return { currency: id, issuer: encodeAccountID(issuer), value, mpt_issuance_id: id };
}

/**
 * A ledger amount as D5's amount object: drops of the native currency as whole units, an issued token as it is, an MPT with its issuer read from its ID. `undefined` for what it cannot
 * read, as D5 leaves such a field out.
 */
function amountOf(raw: unknown, native: Native): ObjectAmount | undefined {
  if (typeof raw === "string") return /^\d+$/.test(raw) ? { currency: native, value: dropsToNative(raw) } : undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { value, currency, issuer, mpt_issuance_id: mpt } = raw as Record<string, unknown>;
  if (!isText(value)) return undefined;
  if (isText(mpt)) return /^[0-9a-fA-F]{48}$/.test(mpt) ? mptAmount(mpt, value) : undefined;
  return isText(currency) && isText(issuer) ? { currency, issuer, value } : undefined;
}

/** What is left of `amount` after `part`, exact and in plain decimal text (D5's `remaining`), or none when either is missing or not a number. */
function remainder(amount: ObjectAmount | undefined, part: ObjectAmount | undefined): ObjectAmount | undefined {
  if (amount === undefined || part === undefined) return undefined;
  const left = new BigNumber(amount.value).minus(part.value);
  return left.isNaN() ? undefined : { ...amount, value: left.toFixed() };
}

/** The keys of `object` that have a value, in their order: D5 leaves out a field it cannot read, and so does this. */
function compact<T extends object>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}

/**
 * The node's entry of an escrow, a check or a payment channel as D5's object (spec 4.5): its native amounts in whole units instead of drops, its times as ISO text instead of Ripple-epoch
 * seconds, and its status worked out by `object-status.ts` at `now` (unix seconds). It has no `created`, `removed`, `fulfillment` or `delivered` (the ledger holds none of them), and a channel has no `opened_with`,
 * `funds` or `claims`. A field the entry lacks or has in a shape unknown here is left out. `entry.index` is the entry's key, which the node writes into every entry it returns. An entry
 * without its `index`, `Account` or `Destination` is an answer that is not what it should be: an `UpstreamError` of kind `server`.
 */
export function fromNodeEntry(kind: "escrow", entry: LedgerObject, native: Native, now: number): EscrowObject;
export function fromNodeEntry(kind: "check", entry: LedgerObject, native: Native, now: number): CheckObject;
export function fromNodeEntry(kind: "payment-channel", entry: LedgerObject, native: Native, now: number): NodeChannelObject;
export function fromNodeEntry(kind: ObjectKind, entry: LedgerObject, native: Native, now: number): EscrowObject | CheckObject | NodeChannelObject;
export function fromNodeEntry(kind: ObjectKind, entry: LedgerObject, native: Native, now: number): EscrowObject | CheckObject | NodeChannelObject {
  const [id, account, destination] = [required(entry, "index"), required(entry, "Account"), required(entry, "Destination")];
  const [sequence, destinationTag, sourceTag] = [wholeOf(entry.Sequence), wholeOf(entry.DestinationTag), wholeOf(entry.SourceTag)];

  if (kind === "escrow") {
    return compact<EscrowObject>({
      escrow_id: id,
      account,
      sequence,
      destination,
      amount: amountOf(entry.Amount, native),
      finish_after: isoOfRipple(entry.FinishAfter),
      cancel_after: isoOfRipple(entry.CancelAfter),
      condition: textOf(entry.Condition),
      destination_tag: destinationTag,
      source_tag: sourceTag,
      transfer_rate: wholeOf(entry.TransferRate),
      status: escrowStatus({ finishAfter: unixOfRipple(entry.FinishAfter), cancelAfter: unixOfRipple(entry.CancelAfter) }, now),
    });
  }
  if (kind === "check") {
    return compact<CheckObject>({
      check_id: id,
      account,
      sequence,
      destination,
      send_max: amountOf(entry.SendMax, native),
      expiration: isoOfRipple(entry.Expiration),
      invoice_id: textOf(entry.InvoiceID),
      destination_tag: destinationTag,
      source_tag: sourceTag,
      status: checkStatus({ expiration: unixOfRipple(entry.Expiration) }, now),
    });
  }
  const amount = amountOf(entry.Amount, native);
  // A channel node that has never paid out has no Balance (the ledger omits a zero): the channel's currency at nothing.
  const balance = entry.Balance !== undefined ? amountOf(entry.Balance, native) : amount && { ...amount, value: "0" };
  return compact<NodeChannelObject>({
    channel_id: id,
    account,
    sequence,
    destination,
    amount,
    balance,
    remaining: remainder(amount, balance),
    settle_delay: wholeOf(entry.SettleDelay),
    public_key: textOf(entry.PublicKey),
    expiration: isoOfRipple(entry.Expiration),
    cancel_after: isoOfRipple(entry.CancelAfter),
    destination_tag: destinationTag,
    source_tag: sourceTag,
    status: channelStatus({ expiration: unixOfRipple(entry.Expiration), cancelAfter: unixOfRipple(entry.CancelAfter) }, now),
  });
}

/** The object of an answer of the index, whatever its kind. */
export function answerObject(answer: ObjectAnswer): EscrowObject | CheckObject | PaymentChannelObject {
  return "escrow" in answer ? answer.escrow : "check" in answer ? answer.check : answer.payment_channel;
}

// ---- Amounts -------------------------------------------------------------------------------------------------------------------------------------

/**
 * An amount as a page draws it. An MPT is `mpt`: its issuance ID and its raw integer units, for `MptAmount` (raw, no scale: E14 adds it). Anything else keeps its issuer, which a page draws
 * as an `AccountLink` where the amount stands in a detail, and `Amount` writes in a title where it stands in a sentence.
 */
export type DisplayAmount = { value: string; currency: string; issuer?: string } | { mpt: { id: string; units: string } };

export function displayAmount(a: ObjectAmount): DisplayAmount {
  if (a.mpt_issuance_id !== undefined) return { mpt: { id: a.mpt_issuance_id, units: a.value } };
  return a.issuer === undefined ? { value: a.value, currency: a.currency } : { value: a.value, currency: a.currency, issuer: a.issuer };
}

/** What `MptAmount` draws, as words for a sentence: "2,500,000 units of MPT 0000012A…". */
const mptWords = ({ id, units }: { id: string; units: string }): string => `${formatAmount(units)} units of MPT ${id.slice(0, 8)}…`;

/**
 * An amount in a sentence: an `amount` segment, which `Amount` draws with its issuer in a title only (so a sentence's issuer is not a name to collect), or words for an MPT, which a
 * segment cannot hold.
 */
export function amountSegment(a: DisplayAmount): Segment {
  return "mpt" in a ? { t: "text", v: mptWords(a.mpt) } : { t: "amount", ...a };
}

/** An amount as plain text, for a title or a description: "1,000 XRP", "250 units of MPT 0000012A…". */
export function amountText(a: DisplayAmount): string {
  return "mpt" in a ? mptWords(a.mpt) : `${formatAmount(a.value)} ${formatCurrency(a.currency)}`;
}

// ---- Words ------------------------------------------------------------------------------------------------------------------------------------

/** A piece of a sentence that is just text. */
export const text = (v: string): Segment => ({ t: "text", v });

/** What a sentence is made of: words, a segment, or a list of segments (an amount's phrase). */
export type Part = string | Segment | readonly Segment[];

/** A sentence from strings, segments and lists of segments, with the text next to text made one segment and no empty text (a part left out is `""`). */
export function sentence(...parts: Part[]): Segment[] {
  const segments: Segment[] = [];
  for (const part of parts) {
    for (const segment of typeof part === "string" ? [text(part)] : "t" in part ? [part] : part) {
      if (segment.t === "text" && segment.v === "") continue;
      const last = segments.at(-1);
      if (segment.t === "text" && last?.t === "text") segments[segments.length - 1] = text(last.v + segment.v);
      else segments.push(segment);
    }
  }
  return segments;
}

/** The object's amount as a noun phrase: "the 1,000 XRP", or "the funds" where D5 could not read it. */
export const theAmount = (amount: DisplayAmount | null): Segment[] => (amount === null ? [text("the funds")] : [text("the "), amountSegment(amount)]);

/** A moment (unix seconds) written into a sentence: an absolute time in UTC, "Oct 29, 2026, 03:50 UTC". */
export const when = (unix: number): string => formatDateTime(unix);

// ---- The rows of the Details card ------------------------------------------------------------------------------------------------------------------

/**
 * What a row of the Details card shows. The page draws each by its `kind`: `code` mono text with a copy button named `copy`; `account` an `AccountLink` with the whole address beside the
 * name; `amount` an `Amount`, or `MptAmount` for the `mpt` form, or "—" for `null` (an amount D5 could not read), and the issuer of a token as an `AccountLink`; `time` the moment written
 * out with `formatUtc` and its age beside it (`RelativeTime` for a past one, `Countdown` for a future one); `number` a mono number; `text` plain words, `faint` where it says that
 * there is none.
 */
export type DetailValue =
  | { kind: "code"; text: string; copy: string }
  | { kind: "account"; address: string }
  | { kind: "amount"; amount: DisplayAmount | null }
  | { kind: "time"; at: number }
  | { kind: "number"; text: string }
  | { kind: "text"; text: string; faint?: boolean };

/** A row of the Details card: its label, the ledger's name for the field under it (the board's small mono line) when it has one, its value and the hint under it. */
export interface DetailRow {
  label: string;
  field?: string;
  value: DetailValue;
  hint?: string;
}

/** The value of a row that has nothing to say (a field the object lacks: "None"; one D5 could not read: "—"), built fresh for each row (a shared object would be one value in many places of the page data). */
export const none = (words = "None"): DetailValue => ({ kind: "text", text: words, faint: true });

/** A destination tag or a source tag: the number, or "None". */
export const tagValue = (tag: number | undefined): DetailValue => (tag === undefined ? none() : { kind: "number", text: String(tag) });

/** The issuer of a token amount, which a row draws as an `AccountLink` (and a sentence's `Amount` writes in a title); none for a native amount, an MPT or an amount D5 could not read. */
export const issuerOf = (amount: DisplayAmount | null): string | undefined => (amount !== null && "issuer" in amount ? amount.issuer : undefined);

/**
 * The accounts the rows of the Details card draw as an `AccountLink`, in the order of the rows: an `account` row's address, and the issuer of a token in an `amount` row. (Not a `code`
 * row's text: it is copied, not linked.) A page gives these to `commonAccounts` among its own accounts.
 */
export function detailAccounts(rows: readonly DetailRow[]): string[] {
  return rows.flatMap(({ value }): string[] => {
    if (value.kind === "account") return [value.address];
    const issuer = value.kind === "amount" ? issuerOf(value.amount) : undefined;
    return issuer === undefined ? [] : [issuer];
  });
}

// ---- The words of a kind of object ----------------------------------------------------------------------------------------------------------------

/** What a sentence calls an object of each kind, and who holds its reserve (the boards': an escrow has an owner, a check and a channel a source). */
const WORDS: Record<ObjectKind, { noun: string; holder: "owner" | "source" }> = {
  escrow: { noun: "escrow", holder: "owner" },
  check: { noun: "check", holder: "source" },
  "payment-channel": { noun: "channel", holder: "source" },
};

const kindOf = (kind: ObjectKind) => OBJECT_KINDS.find((each) => each.kind === kind)!;

/** A ledger number with thousands separators, for a sentence: "107,972,102". */
const ledgerText = (index: number): string => formatAmount(String(index));

// ---- The title line, the removed banner, the as-of note and the owner reserve ------------------------------------------------------------------------

/**
 * The line beside the title: an object the index has the creation of (`created`: the page writes the time, with its age), one it does not (`before`: "Created before ledger #N", N being where the
 * index's history of the object starts), or one read from the node (`changed`: "Last changed in ledger #N", with the transaction that did it, which for an escrow or a check is its creation).
 */
export type TitleLine = { kind: "created"; at: number } | { kind: "before"; ledger: number } | { kind: "changed"; ledger: number; tx: string | null };

/** The banner of an object that was removed: where, by what, and the type's sentence (the page adds "This page shows it from history: its last state before it was removed."). */
export interface RemovedBanner {
  ledger: number;
  txType: string;
  hash: string;
  sentence: Segment[];
}

/**
 * The banner of an object `removed` by a transaction, with the sentence of its type. D5 always names the type of the removing transaction; one it did not would read "by transaction
 * {hash}". The words of the banner are the same for the three kinds (the sentence is the type's own), so the kind the builders pass is not read.
 */
export function removedBannerOf(_kind: ObjectKind, removed: ObjectRef, sentence: Segment[]): RemovedBanner {
  return { ledger: removed.ledger_index, txType: removed.tx_type ?? "transaction", hash: removed.tx_hash, sentence };
}

/** The owner reserve and what to say of it. */
export interface ReserveView {
  amount: string;
  currency: string;
  hint: string;
}

/**
 * The network's owner reserve (`reserve_inc` of `server_state`, drops) in the native currency, with the words that say what happens to it: held while the object exists, or released once it
 * is removed. `null` when `server_state` failed or has no validated ledger: the page then has no "Owner reserve" row.
 */
export function reserveOf(state: ServerState | null, native: Native, kind: ObjectKind, removed: boolean): ReserveView | null {
  const drops = state?.validated_ledger?.reserve_inc;
  if (drops === undefined) return null;
  const { noun, holder } = WORDS[kind];
  const hint = removed
    ? `Released to the ${holder} when the ${noun} was removed.`
    : kind === "escrow"
      ? "Held from the owner’s balance while the escrow exists; released when it is finished or cancelled."
      : `Held from the source’s balance while the ${noun} exists.`;
  return { amount: dropsToNative(String(drops)), currency: native, hint };
}

/**
 * The note under Details, which says how fresh it is: what the index serves is "As of ledger #N, {time}.", what the node gave "Read live from the network at ledger #N.", and an object that was
 * removed "From history: the escrow’s last state, before ledger #N removed it."
 */
export function asOfNoteOf(source: ObjectSource, kind: ObjectKind): string {
  if (source.origin === "node") return `Read live from the network at ledger #${ledgerText(source.ledgerIndex)}.`;
  const removed = answerObject(source.answer).removed;
  if (removed !== undefined) return `From history: the ${WORDS[kind].noun}’s last state, before ledger #${ledgerText(removed.ledger_index)} removed it.`;
  return `As of ledger #${ledgerText(source.answer.ledger_index)}, ${formatDateTime(source.answer.close_time)}.`;
}

// ---- The timeline ----------------------------------------------------------------------------------------------------------------------------------

/** What an event is titled and what it did. */
export interface EventWords {
  title: string;
  what: Segment[];
}

/**
 * The timeline of an object: its transactions, oldest first (D5 serves newest first; `commonOf` reverses each page once), then what `after` has: its `mark`s (a time that passed) are placed by
 * time among the transactions, so that FinishAfter comes before the EscrowFinish that came after it, and its `next` items (what can still happen) come last. A transaction has the type tag of
 * its `tx_type`, its time, who sent it (`by`) and, when it was sent for them, the delegate (`delegate`: always with a `by`), its hash and ledger.
 *
 * Two events read the same for every kind (C25): a `removed` one is titled "Removed" and says `removed`, the sentence of the removed banner, and an `update` (a change by a transaction no one
 * expects) is "Changed by {tx_type}" with no sentence. The words of the others are the type's own: `say`.
 */
export function timelineOf(
  events: readonly ObjectEvent[],
  after: readonly TimelineItem[],
  words: { removed: Segment[]; say: (event: ObjectEvent) => EventWords },
): TimelineItem[] {
  const items = events.map((event): TimelineItem => {
    const { title, what } =
      event.event === "update"
        ? { title: `Changed by ${event.tx_type}`, what: [] }
        : event.event === "removed"
          ? { title: "Removed", what: words.removed }
          : words.say(event);
    return {
      kind: "tx",
      type: event.tx_type,
      title,
      at: unixOf(event.time),
      what,
      by: event.account,
      ...(event.delegate !== undefined && { delegate: event.delegate }),
      hash: event.tx_hash,
      ledger: event.ledger_index,
    };
  });

  const marks = after.filter((item) => item.kind === "mark").sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  const timeline: TimelineItem[] = [];
  let next = 0;
  for (const item of items) {
    while (next < marks.length && marks[next]!.at !== undefined && marks[next]!.at! < item.at!) timeline.push(marks[next++]!);
    timeline.push(item);
  }
  return [...timeline, ...marks.slice(next), ...after.filter((item) => item.kind !== "mark")];
}

// ---- The common part of a page ---------------------------------------------------------------------------------------------------------------------

/** What every object page has (spec 4.1): the head, the banner, the states strip, the timeline with its paging, the notes and the names. */
export interface ObjectPageCommon {
  net: NetworkId;
  kind: ObjectKind;
  id: string;
  origin: "index" | "node";
  /** Whether the object was removed from the ledger, which is what `banner` says. */
  removed: boolean;
  pill: { tone: PillTone; text: string };
  titleLine: TitleLine;
  banner: RemovedBanner | null;
  states: StateItem[];
  timeline: TimelineItem[];
  /** Newer and Older links of the history, in D5's direction (Older is the history page's `marker`); `null` for an object read from the node, which has none. */
  paging: Paging | null;
  asOf: string;
  /** The note under the history (E8's, drawn by `CoverageNote`): `null` when the index holds the whole of the object's history. */
  coverage: CoverageNoteText | null;
  /** The owner reserve, or `null` when `server_state` failed (the page drops the row and is marked degraded by its loader). */
  reserve: ReserveView | null;
  /** The names of the accounts the page draws (the view's `drawnAccounts`), which the loader adds. */
  names: NamesPart;
}

/**
 * Gathers the common part. `typeParts` is what the type decides: the status pill, the states strip, the marks and what can still happen (`marks`: the timeline's `after`), the sentence of
 * the removed banner (`null` for an object that is in the ledger) and the words of its events (`say`, `timelineOf`'s). `o.marker` is the marker the request was reached with and `o.back` the
 * trail behind it; the history is the page `source.history` when there is one (older events: no marks then, they belong after the newest event) and the answer's own otherwise.
 */
export function commonOf(
  source: ObjectSource,
  o: { net: Network; kind: ObjectKind; serverState: ServerState | null; names: NamesPart; marker?: string; back: readonly string[] },
  typeParts: {
    pill: { tone: PillTone; text: string };
    states: StateItem[];
    marks: TimelineItem[];
    bannerSentence: Segment[] | null;
    say: (event: ObjectEvent) => EventWords;
  },
): ObjectPageCommon {
  const { net, kind } = o;
  const { pill, states, marks, bannerSentence, say } = typeParts;

  if (source.origin === "node") {
    const [ledger, tx] = [source.entry.PreviousTxnLgrSeq, source.entry.PreviousTxnID];
    if (!isWhole(ledger)) throw new UpstreamError("server", `the node's ${source.entry.LedgerEntryType} entry has no PreviousTxnLgrSeq`, { status: 200 });
    return {
      net: net.id,
      kind,
      id: required(source.entry, "index"),
      origin: "node",
      removed: false,
      pill,
      titleLine: { kind: "changed", ledger, tx: textOf(tx) ?? null },
      banner: null,
      states,
      timeline: timelineOf([], marks, { removed: [], say }),
      paging: null,
      asOf: asOfNoteOf(source, kind),
      coverage: coverageNote({ complete: false }, `events of this ${kindOf(kind).words}`),
      reserve: reserveOf(o.serverState, net.native, kind, false),
      names: o.names,
    };
  }

  const { answer, history } = source;
  const object = answerObject(answer);
  const id = "escrow_id" in object ? object.escrow_id : "check_id" in object ? object.check_id : object.channel_id;
  const removed = object.removed;
  const page = history ?? answer;
  // D5 serves the events newest first, the embedded ones and every page of the history; the timeline reads oldest first, so each page is turned round here and nowhere else.
  const events = [...page.history].reverse();
  const path = `/${net.id}/${kindOf(kind).segment}/${id}`;
  return {
    net: net.id,
    kind,
    id,
    origin: "index",
    removed: removed !== undefined,
    pill,
    titleLine: object.created !== undefined ? { kind: "created", at: unixOf(object.created.time) } : { kind: "before", ledger: answer.coverage.from_ledger_index ?? answer.ledger_index },
    banner: removed !== undefined && bannerSentence !== null ? removedBannerOf(kind, removed, bannerSentence) : null,
    states,
    timeline: timelineOf(events, history === undefined ? marks : [], { removed: bannerSentence ?? [], say }),
    paging: trailPaging({ marker: o.marker, back: o.back, next: history === undefined ? answer.history_marker : history.marker }, (to) =>
      withQuery(path, trailPairs(to.marker, to.back).join("&")),
    ),
    asOf: asOfNoteOf(source, kind),
    coverage: coverageNote(answer.coverage, `events of this ${kindOf(kind).words}`),
    reserve: reserveOf(o.serverState, net.native, kind, removed !== undefined),
    names: o.names,
  };
}

/**
 * The accounts the common part of a page draws as an `AccountLink` (E9, "Display names"), each once, in the order the page draws them: the accounts of the removed banner's sentence, then
 * `own`, the accounts of the type's own parts (its summary, status lines and rows), which stand between the banner and the history, then for each timeline item the accounts of what it did, the
 * account that sent the transaction and the delegate (`Timeline` draws what the item did first). Never an amount's issuer in a sentence, which `Amount` writes in a title, nor the names the page carries.
 */
export function commonAccounts(page: ObjectPageCommon, own: readonly string[] = []): string[] {
  const drawn = [
    ...(page.banner === null ? [] : accountsIn(page.banner.sentence)),
    ...own,
    ...page.timeline.flatMap((item) => [...accountsIn(item.what), item.by, item.delegate]),
  ];
  return [...new Set(drawn.filter((address): address is string => address !== undefined))];
}
