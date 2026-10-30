// The escrow page's data (ledger object pages spec 4.2 and the Escrow board): built from the data API's answer for the escrow (D5) or, for one the index does not have, from the node's entry.
// Pure: the loader gives it the answer, the server state and the names, and the page draws what it returns. The parts every object page has are `ledger-object-view.ts`'s; this file has the
// escrow's own: the pill and the states, the summary, the status lines, the window bar, the marks of the timeline, the words of its events and the rows of its Details card.
//
// Page data holds strings and unix seconds, never ages: a time is written out where the sentence needs it (`formatDateTime`, an absolute time in UTC), and otherwise it is a number for the
// page to write with `formatUtc` and to put `RelativeTime` or `Countdown` beside. So the status lines say "FinishAfter passed on Oct 26, 2026, 16:49 UTC", never "3 days ago", and leave
// out the board's "That is in 5 days": the page has the instants (`windowBar.bounds`) if it wants a countdown beside them.

import BigNumber from "bignumber.js";

import { accountsIn, type Segment } from "../domain/describe";
import { seq } from "../domain/describe/helpers";
import { tokenOf } from "../domain/fnv";
import { formatUtcDay, shortAddress } from "../domain/format";
import type { NamesPart } from "../domain/names";
import type { Native } from "../domain/parse/types";
import { formatDate } from "../domain/time-words";
import type { PillTone } from "../ui/components/Pill";
import type { StateItem } from "../ui/components/StatesStrip";
import type { TimelineItem } from "../ui/components/Timeline";
import type { Slot, WindowBarData, WindowBarSegment } from "../ui/charts/types";
import type { EscrowObject, EscrowStatus, ObjectEvent, ObjectRef } from "./api-types";
import {
  amountSegment,
  amountText,
  commonAccounts,
  commonOf,
  detailAccounts,
  displayAmount,
  fromNodeEntry,
  issuerOf,
  none,
  optionalUnix,
  tagValue,
  text,
  theAmount,
  when,
  type DetailRow,
  type DisplayAmount,
  type EventWords,
  type ObjectPageCommon,
  type ObjectSource,
  type ReserveView,
} from "./ledger-object-view";
import type { Network } from "./networks";
import type { ServerState } from "./node-rpc";
import { unixOf } from "./validator-facts";

// ---- The data ---------------------------------------------------------------------------------------------------------------------------------

/** What the meta tags say (spec 11), with no name in it (C14: a title or a description is shared out of context, so it has short addresses). `amount` is empty when D5 could not read it. */
export interface EscrowMeta {
  id: string;
  amount: string;
  owner: string;
  destination: string;
  /** The status in lower case, as a description has it: "pending", "can be cancelled". */
  status: string;
  /** Whether the page was reached with a marker (older events), which the meta tags make `noindex`. */
  marker: boolean;
}

export interface EscrowPageData extends ObjectPageCommon {
  kind: "escrow";
  /** "{owner} locked {amount} for {destination} on {day}." */
  summary: Segment[];
  /** The status in a headline and the sentences under it. */
  statusLines: Segment[][];
  windowBar: WindowBarData;
  /** `null` when D5 could not read the amount: the row draws a dash. */
  amount: DisplayAmount | null;
  details: DetailRow[];
  meta: EscrowMeta;
}

// ---- Words ---------------------------------------------------------------------------------------------------------------------------------------

const PILLS: Record<EscrowStatus, { tone: PillTone; text: string }> = {
  pending: { tone: "info", text: "Pending" },
  can_be_finished: { tone: "ok", text: "Can be finished" },
  can_be_cancelled: { tone: "warn", text: "Can be cancelled" },
  finished: { tone: "ok", text: "Finished" },
  cancelled: { tone: "neutral", text: "Cancelled" },
  removed: { tone: "off", text: "Removed" },
};

/** The states of the strip in the board's order; `removed` is none of them. */
const STATE_IDS = ["pending", "can_be_finished", "can_be_cancelled", "finished", "cancelled"] as const;

/**
 * The states of the strip, each with the board's one line of what it means; the escrow's own marked, none for a `removed` one. An escrow with no FinishAfter (its condition alone holds it) has
 * no time to pass before it can be finished, so its line names none.
 */
function statesOf(status: EscrowStatus, conditional: boolean, timed: boolean): StateItem[] {
  const fulfilled = conditional ? " with the fulfillment" : "";
  const meaning: Record<(typeof STATE_IDS)[number], string> = {
    pending: "Locked: FinishAfter has not passed yet.",
    can_be_finished: timed ? `FinishAfter has passed: anyone${fulfilled} can finish it.` : `Anyone${fulfilled} can finish it.`,
    can_be_cancelled: "CancelAfter has passed: anyone can cancel it.",
    finished: "Paid to the destination, then removed.",
    cancelled: "Returned to the owner, then removed.",
  };
  return STATE_IDS.map((id) => ({ id, label: PILLS[id].text, meaning: meaning[id], current: id === status }));
}

// ---- What the page is made from -----------------------------------------------------------------------------------------------------------------------

/** The escrow in the terms the builders below use: times in unix seconds, the amount ready to draw. */
interface Facts {
  escrow: EscrowObject;
  status: EscrowStatus;
  amount: DisplayAmount | null;
  /** The creation, when the index has it. */
  created?: number;
  finishAfter?: number;
  cancelAfter?: number;
  /** The ledger's close time of the answer, or the request's time for the node's: what "now" is on this page. */
  asOf: number;
  /** The removing transaction: when, and what it was. */
  removed?: { at: number; ref: ObjectRef };
  /** Whether a fulfillment finishes it: it has a condition. */
  conditional: boolean;
}

function factsOf(source: ObjectSource, native: Native): Facts {
  let escrow: EscrowObject;
  let asOf: number;
  if (source.origin === "index") {
    if (!("escrow" in source.answer)) throw new Error("escrowPage was given the answer for an object that is not an escrow");
    escrow = source.answer.escrow;
    asOf = unixOf(source.answer.close_time);
  } else {
    escrow = fromNodeEntry("escrow", source.entry, native, source.now);
    asOf = source.now;
  }
  return {
    escrow,
    status: escrow.status,
    amount: escrow.amount === undefined ? null : displayAmount(escrow.amount),
    created: optionalUnix(escrow.created?.time),
    finishAfter: optionalUnix(escrow.finish_after),
    cancelAfter: optionalUnix(escrow.cancel_after),
    asOf,
    ...(escrow.removed !== undefined && { removed: { at: unixOf(escrow.removed.time), ref: escrow.removed } }),
    conditional: escrow.condition !== undefined,
  };
}

// ---- The summary, the status lines and the banner --------------------------------------------------------------------------------------------------------

function summaryOf(f: Facts): Segment[] {
  const { escrow, amount, created } = f;
  return seq(
    { t: "account", v: escrow.account },
    " locked ",
    amount === null ? "funds" : amountSegment(amount),
    " for ",
    { t: "account", v: escrow.destination },
    created === undefined ? "." : ` on ${formatDate(created)}.`,
  );
}

/** The sentences of the status: the headline and what it means (the board's, with its ages left out). */
function statusLinesOf(f: Facts): Segment[][] {
  const { amount, finishAfter: fa, cancelAfter: ca, removed, escrow } = f;
  const who = f.conditional ? "anyone with the fulfillment" : "anyone";
  switch (f.status) {
    case "pending":
      return [
        seq("Can be finished by ", who, fa === undefined ? "" : ` after ${when(fa)}`),
        seq("Until then ", theAmount(amount), " stay locked.", ca === undefined ? "" : ` From ${when(ca)} it can no longer be finished, only cancelled.`),
      ];
    case "can_be_finished":
      return [
        seq("Can be finished by ", who, ca === undefined ? ", with no end" : ` until ${when(ca)}`),
        seq(
          fa === undefined ? "" : `FinishAfter passed on ${when(fa)}. `,
          "An EscrowFinish sends ",
          theAmount(amount),
          " to the destination.",
          ca === undefined ? "" : ` From ${when(ca)} it can only be cancelled.`,
        ),
      ];
    case "can_be_cancelled":
      return [
        seq("Can be cancelled: CancelAfter has passed"),
        seq(ca === undefined ? "" : `CancelAfter passed on ${when(ca)}, so it can no longer be finished. `, "Anyone can send an EscrowCancel to return ", theAmount(amount), " to the owner."),
      ];
    case "finished":
      return [
        amount === null ? seq("Finished: funds delivered to the destination") : seq("Finished: ", amountSegment(amount), " delivered to the destination"),
        seq("Finished", removed === undefined ? "" : ` on ${when(removed.at)}`, ", by an EscrowFinish", f.conditional ? " that carried the fulfillment" : "", "."),
      ];
    case "cancelled":
      return [
        amount === null ? seq("Cancelled: funds returned to the owner") : seq("Cancelled: ", amountSegment(amount), " returned to the owner"),
        seq("Cancelled", removed === undefined ? "" : ` on ${when(removed.at)}`, ", after CancelAfter had passed. It was never finished."),
      ];
    case "removed":
      return [seq(`Removed from the ledger by ${escrow.removed?.tx_type ?? "a transaction"}`)];
  }
}

/** The sentence of the removed banner, which the timeline's `removed` event repeats; `null` for an escrow that is in the ledger. */
function bannerSentenceOf(f: Facts): Segment[] | null {
  const { removed, amount } = f;
  if (removed === undefined) return null;
  if (f.status === "finished") return seq("Finished on ", when(removed.at), "; ", theAmount(amount), " went to the destination.");
  if (f.status === "cancelled") return seq("Cancelled on ", when(removed.at), "; ", theAmount(amount), " went back to the owner.");
  return seq("Removed on ", when(removed.at), ".");
}

// ---- The timeline ----------------------------------------------------------------------------------------------------------------------------------

/** What an event of an escrow did, in the board's words: the create, the finish and the cancel (the removed and the update are every kind's). */
function eventWordsOf(f: Facts): (event: ObjectEvent) => EventWords | undefined {
  return (event) => {
    const amount = event.amount === undefined ? f.amount : displayAmount(event.amount);
    switch (event.event) {
      case "create":
        return { title: "Created", what: seq("Locked ", amount === null ? "funds" : amountSegment(amount), f.conditional ? " behind a condition" : "", " for the destination.") };
      case "finish": {
        const carried = event.fulfillment !== undefined || f.conditional;
        return { title: "Finished", what: seq("Sent ", amount === null ? text("the funds") : amountSegment(amount), " to the destination", carried ? " with the fulfillment" : "", ", and removed the escrow.") };
      }
      case "cancel":
        return { title: "Cancelled", what: seq("Returned ", amount === null ? text("the funds") : amountSegment(amount), " to the owner and removed the escrow.") };
    }
  };
}

/** A time that passed. */
const passed = (type: "FinishAfter" | "CancelAfter", at: number, said: string): TimelineItem => ({ kind: "mark", type, title: "Passed", at, whenText: when(at), what: [text(said)] });

/**
 * The marks and what can still happen, as the board has them for each status (spec 4.2): a time that passed (FinishAfter, CancelAfter), and the EscrowFinish and EscrowCancel that can
 * still come. A `next` has its `at` only while its time is ahead of the page (the page counts down to it); one that has come reads "Since {time}". An escrow that was removed has the marks
 * that passed before it and nothing to come; one another transaction removed, none.
 */
function marksOf(f: Facts): TimelineItem[] {
  const { finishAfter: fa, cancelAfter: ca, amount } = f;
  const who = f.conditional ? "Anyone with the fulfillment" : "Anyone";
  const passedFinish = (said: string): TimelineItem[] => (fa === undefined ? [] : [passed("FinishAfter", fa, said)]);
  const cancelNext = (title: string, whenText: string | undefined, at: number | undefined, said: Segment[]): TimelineItem => ({
    kind: "next",
    type: "EscrowCancel",
    title,
    ...(at !== undefined && { at }),
    ...(whenText !== undefined && { whenText }),
    what: said,
  });
  switch (f.status) {
    case "pending":
      return [
        { kind: "next", type: "EscrowFinish", title: "Not finished yet", ...(fa !== undefined && { at: fa, whenText: `From ${when(fa)}` }), what: [text(`${who} can send it then.`)] },
        ...(ca === undefined ? [] : [cancelNext("Not cancelled", `From ${when(ca)}`, ca, [text("Anyone can send it then, if it has not been finished.")])]),
      ];
    case "can_be_finished":
      return [
        ...passedFinish("From here it can be finished."),
        { kind: "next", type: "EscrowFinish", title: "Not finished yet", ...(ca !== undefined && { at: ca, whenText: `Until ${when(ca)}` }), what: [text(`${who} can send it now.`)] },
        ...(ca === undefined ? [] : [cancelNext("Not cancelled", `From ${when(ca)}`, ca, [text("Anyone can send it then, if it has not been finished.")])]),
      ];
    case "can_be_cancelled":
      return [
        ...passedFinish("From here it could be finished, but no one did."),
        ...(ca === undefined ? [] : [passed("CancelAfter", ca, "From here it can no longer be finished.")]),
        cancelNext("Not cancelled yet", ca === undefined ? undefined : `Since ${when(ca)}`, undefined, seq("Anyone can send it now; ", theAmount(amount), " go back to the owner.")),
      ];
    case "finished":
      return passedFinish("From here it could be finished.");
    case "cancelled":
      return [...passedFinish("From here it could be finished, but no one did."), ...(ca === undefined ? [] : [passed("CancelAfter", ca, "From here it can no longer be finished.")])];
    case "removed":
      return [];
  }
}

// ---- The window bar --------------------------------------------------------------------------------------------------------------------------------

/** How long a window is, in the board's words: "30 min", "5 hours", "10 days", "13 months". */
function lengthOf(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  if (seconds < 86_400 * 60) {
    const days = Math.round(seconds / 86_400);
    return days === 1 ? "1 day" : `${days} days`;
  }
  return `${Math.round(seconds / 86_400 / 30.44)} months`;
}

/** A moment for a tick and the mark, as short as the board's: "Nov 3 09:30". */
function compact(unix: number): string {
  const iso = new Date(unix * 1000).toISOString();
  return `${formatUtcDay(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
}

/**
 * The windows of an escrow on one bar (spec 4.2): Pending from its creation to FinishAfter, Can be finished from FinishAfter to CancelAfter (or open), Can be cancelled from CancelAfter on,
 * with the bounds it has (Created, FinishAfter, CancelAfter) and a mark at `mark.at`: the moment the page shows ("Now"), or the removal ("Finished", "Cancelled", "Removed"). A window the escrow
 * does not have is left out, and so is an empty one (the kit draws what it is given: no span is a stub). A creation nobody knows starts a window at the start of the bar, which is the
 * earlier of FinishAfter and the mark. After a removal the windows that begin after it are left out: nothing was open then. Colours are slots that reach 3:1 on the card in light.
 */
export function windowBarOf(
  escrow: { created?: number; finishAfter?: number; cancelAfter?: number },
  mark: { at: number; word: "Now" | "Finished" | "Cancelled" | "Removed" },
): WindowBarData {
  const { created: c, finishAfter: fa, cancelAfter: ca } = escrow;
  const known = [c, fa, ca, mark.at].filter((moment): moment is number => moment !== undefined);
  const start = Math.min(...known);
  const ended = mark.word !== "Now";

  const range = (from: number | null, to: number | null): string =>
    from !== null && to !== null ? `${when(from)} to ${when(to)}` : from !== null ? `From ${when(from)}, with no end` : to !== null ? `Until ${when(to)}` : "With no start or end";
  const window = (id: WindowBarSegment["id"], label: string, slot: Slot, from: number | null, to: number | null, openLength: string): WindowBarSegment[] => {
    // empty: it ends where it begins (or before), the bar starting at `start` for a window with no known start
    if (to !== null && to <= (from ?? start)) return [];
    // nothing was open after a removal
    if (ended && from !== null && from > mark.at) return [];
    const length = from !== null && to !== null ? lengthOf(to - from) : from === null && to !== null ? "" : openLength;
    return [{ id, label, slot, from: from === null ? null : String(from), to: to === null ? null : String(to), range: range(from, to), length }];
  };

  const segments: WindowBarSegment[] = [
    ...(fa === undefined ? [] : window("pending", "Pending", "other", c ?? null, fa, "")),
    ...window("finishable", "Can be finished", "up", fa ?? c ?? null, ca ?? null, "Until someone finishes it"),
    ...(ca === undefined ? [] : window("cancellable", "Can be cancelled", 2, ca, null, "Until someone cancels it")),
  ];
  const bounds: WindowBarData["bounds"] = [
    ...(c === undefined ? [] : [{ id: "created" as const, label: `Created ${compact(c)}`, at: String(c) }]),
    ...(fa === undefined ? [] : [{ id: "finish_after" as const, label: `FinishAfter ${compact(fa)}`, at: String(fa) }]),
    ...(ca === undefined ? [] : [{ id: "cancel_after" as const, label: `CancelAfter ${compact(ca)}`, at: String(ca) }]),
  ];
  const markData = { label: `${mark.word} · ${compact(mark.at)}`, at: String(mark.at) };
  return { segments, bounds, mark: markData, token: tokenOf({ segments, bounds, mark: markData }) };
}

// ---- The Details card ----------------------------------------------------------------------------------------------------------------------------

/** The transfer rate of no fee: a billionths multiplier of 1. */
const NO_FEE = 1_000_000_000;

/** A transfer rate as the percent it charges: 1,005,000,000 is 0.5%, and 1,000,000,000 (and anything below it) is 0%. */
const transferPercent = (rate: number): string => `${BigNumber.max(0, new BigNumber(rate).minus(NO_FEE)).shiftedBy(-7).toFixed()}%`;

/** The board's words about the condition: what it is, and what has happened to the secret that matches it. */
function conditionHint(f: Facts): string {
  const what = "A PREIMAGE-SHA-256 crypto-condition: only the fulfillment, the secret whose SHA-256 hash it holds, can finish the escrow.";
  switch (f.status) {
    case "finished":
      return `${what} The EscrowFinish revealed it${f.escrow.fulfillment === undefined ? "." : ", below."}`;
    case "cancelled":
      return `${what} It was cancelled, so the fulfillment was never revealed.`;
    case "removed":
      return what;
    default:
      return `${what} The fulfillment shows here once the escrow is finished.`;
  }
}

function detailsOf(f: Facts, reserve: ReserveView | null): DetailRow[] {
  const { escrow, amount, finishAfter: fa, cancelAfter: ca } = f;
  // An escrow of an issued token always has the row: rippled leaves the field out of an entry with no fee, so one without it charges nothing. One of an MPT has it when the answer carries the
  // field. A native one never does: there is no token to charge for, and Xahau's entries hold the default.
  const transferRate = issuerOf(amount) !== undefined || (amount !== null && "mpt" in amount && escrow.transfer_rate !== undefined);
  return [
    { label: "Escrow ID", field: "ledger object ID", value: { kind: "code", text: escrow.escrow_id, copy: "escrow ID" } },
    { label: "Owner", field: "source", value: { kind: "account", address: escrow.account } },
    { label: "Destination", value: { kind: "account", address: escrow.destination } },
    { label: "Amount", value: { kind: "amount", amount } },
    {
      label: "Can be finished after",
      field: "FinishAfter",
      value: fa === undefined ? none() : { kind: "time", at: fa },
      ...(fa !== undefined && { hint: "The earliest time anyone can send an EscrowFinish." }),
    },
    {
      label: "Can be cancelled after",
      field: "CancelAfter",
      value: ca === undefined ? none() : { kind: "time", at: ca },
      ...(ca !== undefined && { hint: "From this time it can no longer be finished, only cancelled." }),
    },
    escrow.condition === undefined
      ? { label: "Condition", value: none("None: time-based only"), hint: "No secret is needed to finish it." }
      : { label: "Condition", value: { kind: "code", text: escrow.condition, copy: "condition" }, hint: conditionHint(f) },
    ...(escrow.fulfillment === undefined
      ? []
      : [
          {
            label: "Fulfillment",
            value: { kind: "code" as const, text: escrow.fulfillment, copy: "fulfillment" },
            hint: "The secret that matches the condition, revealed by the EscrowFinish.",
          },
        ]),
    { label: "Destination tag", value: tagValue(escrow.destination_tag) },
    { label: "Source tag", value: tagValue(escrow.source_tag) },
    ...(transferRate ? [{ label: "Transfer rate", value: { kind: "text" as const, text: transferPercent(escrow.transfer_rate ?? NO_FEE) } }] : []),
    ...(reserve === null ? [] : [{ label: "Owner reserve", value: { kind: "amount" as const, amount: { value: reserve.amount, currency: reserve.currency } }, hint: reserve.hint }]),
  ];
}

// ---- The page ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The escrow page's data from the index's answer (`origin: "index"`, with the history page a `?marker=` asked for) or from the node's entry (`origin: "node"`: no history, its status
 * worked out at the request's time). `o.names` is the loader's (`NO_NAMES` while it works out `drawnAccounts`), `o.serverState` is `null` when the call failed (no Owner reserve row).
 */
export function escrowPage(
  source: ObjectSource,
  o: { net: Network; serverState: ServerState | null; names: NamesPart; marker?: string; back: readonly string[] },
): EscrowPageData {
  const f = factsOf(source, o.net.native);
  const { escrow, amount } = f;
  const pill = PILLS[f.status];
  const common = commonOf(
    source,
    { net: o.net, kind: "escrow", serverState: o.serverState, names: o.names, marker: o.marker, back: o.back },
    { pill, states: statesOf(f.status, f.conditional, f.finishAfter !== undefined), marks: marksOf(f), bannerSentence: bannerSentenceOf(f), say: eventWordsOf(f) },
  );
  const markWord = f.removed === undefined ? "Now" : f.status === "finished" ? "Finished" : f.status === "cancelled" ? "Cancelled" : "Removed";
  return {
    ...common,
    kind: "escrow",
    summary: summaryOf(f),
    statusLines: statusLinesOf(f),
    windowBar: windowBarOf(f, { at: f.removed?.at ?? f.asOf, word: markWord }),
    amount,
    details: detailsOf(f, common.reserve),
    meta: {
      id: escrow.escrow_id,
      amount: amount === null ? "" : amountText(amount),
      owner: shortAddress(escrow.account),
      destination: shortAddress(escrow.destination),
      status: pill.text.toLowerCase(),
      marker: o.marker !== undefined,
    },
  };
}

// ---- The accounts the page draws ---------------------------------------------------------------------------------------------------------------------

/**
 * The accounts the page draws as an `AccountLink` (E9, "Display names"), each once, in the order the page draws them: the accounts of the banner's sentence, the summary and the status lines
 * (`accountsIn`: an account segment), the owner and the destination of the Details card, the issuer of a token in its Amount row (the page draws it as a link there), and for each item of the
 * timeline the account that sent the transaction, the delegate and the accounts of what it did. Never an amount's issuer in a sentence, which `Amount` writes in a title, nor an MPT's, nor
 * the short addresses of the meta tags. The common parts (the banner, the timeline) are `commonAccounts`'s, with the escrow's own parts between them. The loader passes this to
 * `collectAddresses`, then `loadNames`.
 */
export function drawnAccounts(page: EscrowPageData): string[] {
  return commonAccounts(page, [...accountsIn(page.summary), ...page.statusLines.flatMap(accountsIn), ...detailAccounts(page.details)]);
}
