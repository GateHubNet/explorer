// The check page's data (ledger object pages spec 4.3 and the Check board): built from the data API's answer for the check (D5) or, for one the index does not have, from the node's entry.
// Pure: the loader gives it the answer, the server state and the names, and the page draws what it returns. The parts every object page has are `ledger-object-view.ts`'s; this file has the
// check's own: the pill and the states, the summary, the status lines, the banner of an expired check, the three boxes of the flow, the marks of the timeline, the words of its events and
// the rows of its Details card.
//
// Page data holds strings and unix seconds, never ages (the escrow view's note): a time is written out where a sentence needs it (`when`, an absolute time in UTC), and otherwise it is a number
// for the page to write with `formatUtc` and to put `RelativeTime` or `Countdown` beside. So the status lines leave out the board's "That is in 5 days".

import BigNumber from "bignumber.js";

import { accountsIn, type Segment } from "../domain/describe";
import { formatCurrency, shortAddress } from "../domain/format";
import type { NamesPart } from "../domain/names";
import type { Native } from "../domain/parse/types";
import { formatDate } from "../domain/time-words";
import type { CheckFlowData } from "../ui/components/CheckFlow";
import type { PillTone } from "../ui/components/Pill";
import type { StateItem } from "../ui/components/StatesStrip";
import type { TimelineItem } from "../ui/components/Timeline";
import type { CheckObject, CheckStatus, ObjectEvent, ObjectRef } from "./api-types";
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
  rawValue,
  sentence,
  tagValue,
  text,
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

/**
 * What the meta tags say (spec 11), with no name in it (C14: a title or a description is shared out of context, so it has short addresses). The fields are the escrow's: `owner` is the check's
 * source, and `amount` is its `SendMax` as text, empty when D5 could not read it.
 */
export interface CheckMeta {
  id: string;
  amount: string;
  owner: string;
  destination: string;
  /** The status in lower case, as a description has it: "open", "expired". */
  status: string;
  /** Whether the page was reached with a marker (older events), which the meta tags make `noindex`. */
  marker: boolean;
}

export interface CheckPageData extends ObjectPageCommon {
  kind: "check";
  /** "{source} wrote a check for up to {SendMax} to {destination} on {day}." */
  summary: Segment[];
  /** The status in a headline and the sentences under it. */
  statusLines: Segment[][];
  /** The words under "Expired, but still in the ledger" (the page writes the heading), for a check that expired and was not cancelled yet; `null` for any other. */
  expiredBanner: Segment[] | null;
  flow: CheckFlowData;
  details: DetailRow[];
  meta: CheckMeta;
}

// ---- Words ---------------------------------------------------------------------------------------------------------------------------------------

const PILLS: Record<CheckStatus, { tone: PillTone; text: string }> = {
  open: { tone: "info", text: "Open" },
  expired: { tone: "warn", text: "Expired" },
  cashed: { tone: "ok", text: "Cashed" },
  cancelled: { tone: "neutral", text: "Cancelled" },
  removed: { tone: "off", text: "Removed" },
};

/** The states of the strip in the board's order; `removed` is none of them. */
const STATE_IDS = ["open", "cashed", "cancelled", "expired"] as const;

/** The states of the strip, each with the board's one line of what it means; the check's own marked, none for a `removed` one. */
function statesOf(status: CheckStatus): StateItem[] {
  const meaning: Record<(typeof STATE_IDS)[number], string> = {
    open: "The destination can cash it.",
    cashed: "Paid to the destination, then removed.",
    cancelled: "Cancelled before it was cashed, then removed.",
    expired: "Can no longer be cashed; stays until someone cancels it.",
  };
  return STATE_IDS.map((id) => ({ id, label: PILLS[id].text, meaning: meaning[id], current: id === status }));
}

// ---- What the page is made from -----------------------------------------------------------------------------------------------------------------------

/** The check in the terms the builders below use: times in unix seconds, the amounts ready to draw. */
interface Facts {
  check: CheckObject;
  status: CheckStatus;
  /** `null` when D5 could not read it. */
  sendMax: DisplayAmount | null;
  delivered: DisplayAmount | null;
  /** The creation, when the index has it. */
  created?: number;
  expiration?: number;
  /** The removing transaction: when, and what it was. */
  removed?: { at: number; ref: ObjectRef };
  /** Whether it was the source that cancelled it, when the newest events say who did: anyone can once it has expired, and the destination at any time. */
  cancelledBySource: boolean;
}

function factsOf(source: ObjectSource, native: Native): Facts {
  let check: CheckObject;
  if (source.origin === "index") {
    if (!("check" in source.answer)) throw new Error("checkPage was given the answer for an object that is not a check");
    check = source.answer.check;
  } else {
    check = fromNodeEntry("check", source.entry, native, source.now);
  }
  // The newest events are in the answer whatever page of the history was asked for; the CheckCancel that removed the check is the newest of all.
  const canceller = source.origin === "index" ? source.answer.history.find((event) => event.event === "cancel")?.account : undefined;
  return {
    check,
    status: check.status,
    sendMax: check.send_max === undefined ? null : displayAmount(check.send_max),
    delivered: check.delivered === undefined ? null : displayAmount(check.delivered),
    created: optionalUnix(check.created?.time),
    expiration: optionalUnix(check.expiration),
    ...(check.removed !== undefined && { removed: { at: unixOf(check.removed.time), ref: check.removed } }),
    cancelledBySource: canceller !== undefined && canceller === check.account,
  };
}

/** What the check's money is called where a sentence says where it comes from: the currency, or "the funds" (an MPT, or an amount D5 could not read), with the verb that agrees. */
function fundsOf(sendMax: DisplayAmount | null): { noun: string; verb: string } {
  return sendMax === null || "mpt" in sendMax ? { noun: "the funds", verb: "come" } : { noun: `the ${formatCurrency(sendMax.currency)}`, verb: "comes" };
}

// ---- The summary, the status lines and the banners ---------------------------------------------------------------------------------------------------------

function summaryOf(f: Facts): Segment[] {
  const { check, sendMax, created } = f;
  return sentence(
    { t: "account", v: check.account },
    " wrote a check ",
    sendMax === null ? "" : sentence("for up to ", amountSegment(sendMax), " "),
    "to ",
    { t: "account", v: check.destination },
    created === undefined ? "." : ` on ${formatDate(created)}.`,
  );
}

/** The sentences of the status: the headline and what it means (the board's, with its ages left out). */
function statusLinesOf(f: Facts): Segment[][] {
  const { check, sendMax, delivered, expiration, removed } = f;
  switch (f.status) {
    case "open": {
      const { noun, verb } = fundsOf(sendMax);
      return [
        sentence("The destination can cash ", sendMax === null ? "the check" : sentence("up to ", amountSegment(sendMax)), expiration === undefined ? ", with no expiration" : ` until ${when(expiration)}`),
        sentence("Nothing is set aside: ", noun, ` ${verb} from the source’s balance when the check is cashed, so the source must still hold it then. The source can cancel the check at any time.`),
      ];
    }
    case "expired":
      return [
        sentence("Expired: it can no longer be cashed"),
        sentence(expiration === undefined ? "" : `Its expiration passed on ${when(expiration)}. `, "Nothing was paid, and nothing will be."),
      ];
    case "cashed": {
      // "for 2,180.4 NPUSD of the 2,500 NPUSD it allowed", or "all it allowed" when it was cashed for the whole of it
      const allowed =
        delivered === null || sendMax === null
          ? ""
          : new BigNumber(rawValue(delivered)).lt(rawValue(sendMax))
            ? sentence(" of the ", amountSegment(sendMax), " it allowed")
            : ", all it allowed";
      return [
        delivered === null ? sentence("Cashed: funds delivered to the destination") : sentence("Cashed: ", amountSegment(delivered), " delivered to the destination"),
        sentence("Cashed", removed === undefined ? "" : ` on ${when(removed.at)}`, delivered === null ? "" : sentence(", for ", amountSegment(delivered)), allowed, "."),
      ];
    }
    case "cancelled":
      return [
        sentence("Cancelled before it was cashed"),
        sentence(f.cancelledBySource ? "The source cancelled it" : "It was cancelled", removed === undefined ? "" : ` on ${when(removed.at)}`, ". Nothing was paid."),
      ];
    case "removed":
      return [sentence(`Removed from the ledger by ${check.removed?.tx_type ?? "a transaction"}`)];
  }
}

/** The sentence of the removed banner, which the timeline's `removed` event repeats; `null` for a check that is in the ledger. */
function bannerSentenceOf(f: Facts): Segment[] | null {
  const { removed, delivered } = f;
  if (removed === undefined) return null;
  if (f.status === "cashed") return sentence("Cashed on ", when(removed.at), "; ", delivered === null ? text("the funds") : amountSegment(delivered), " went to the destination.");
  if (f.status === "cancelled") return sentence(f.cancelledBySource ? "Cancelled by the source on " : "Cancelled on ", when(removed.at), "; nothing was paid.");
  return sentence("Removed on ", when(removed.at), ".");
}

/**
 * The words under the heading "Expired, but still in the ledger" (spec 4.3): an expired check stays until someone cancels it, and holds the owner reserve until then. Without a reserve (the
 * `server_state` call failed) it says that part of the source's balance stays reserved.
 */
function expiredBannerOf(reserve: ReserveView | null): Segment[] {
  return sentence(
    "An expired check is not removed on its own. It stays until someone sends a CheckCancel, which anyone can do now; until then it ",
    reserve === null ? "keeps part of the source’s balance reserved." : sentence("holds ", amountSegment({ value: reserve.amount, currency: reserve.currency }), " of the source’s reserve."),
  );
}

// ---- The flow --------------------------------------------------------------------------------------------------------------------------------------

/** The three boxes of the flow (spec 4.3): the source, the check and the destination, each with the board's line for the check's status. */
function flowOf(f: Facts): CheckFlowData {
  const { check, sendMax, delivered, expiration, removed } = f;
  const day = (unix: number | undefined): string => (unix === undefined ? "" : ` ${formatDate(unix)}`);
  const upTo = sendMax === null ? null : `up to ${amountText(sendMax)}`;

  const [title, source, destination] = ((): [string, string, string] => {
    switch (f.status) {
      case "open":
        return [expiration === undefined ? "Check" : `Check · expires${day(expiration)}`, "Pays when the check is cashed", upTo === null ? "Can cash the check" : `Can cash ${upTo}`];
      case "expired":
        return [`Check · expired${day(expiration)}`, "Has paid nothing", "Can no longer cash it"];
      case "cashed":
        return [
          `Check · cashed${day(removed?.at)}`,
          delivered === null ? "Paid the funds" : `−${amountText(delivered)}`,
          delivered === null ? "Received the funds" : `+${amountText(delivered)}`,
        ];
      case "cancelled":
        return [`Check · cancelled${day(removed?.at)}`, "Paid nothing", "Received nothing"];
      case "removed":
        return [`Check · removed${day(removed?.at)}`, "Paid nothing", "Received nothing"];
    }
  })();

  const issuer = issuerOf(sendMax);
  return {
    source: { account: check.account, line: source },
    check: { title, line: upTo ?? "—", ...(issuer !== undefined && { issuer }) },
    destination: { account: check.destination, ...(check.destination_tag !== undefined && { tag: check.destination_tag }), line: destination },
  };
}

// ---- The timeline ----------------------------------------------------------------------------------------------------------------------------------

/** What an event of a check did, in the board's words: the create, the cash and the cancel (the removed and the update are every kind's). */
function eventWordsOf(f: Facts): (event: ObjectEvent) => EventWords {
  return (event) => {
    switch (event.event) {
      case "create": {
        const sendMax = event.send_max === undefined ? f.sendMax : displayAmount(event.send_max);
        const expiration = optionalUnix(event.expiration);
        return {
          title: "Created",
          what: sentence("Wrote a check", sendMax === null ? "" : sentence(" for up to ", amountSegment(sendMax)), expiration === undefined ? "" : `, expiring ${when(expiration)}`, "."),
        };
      }
      case "cash": {
        const delivered = event.delivered === undefined ? f.delivered : displayAmount(event.delivered);
        return { title: "Cashed", what: sentence("Delivered ", delivered === null ? text("the funds") : amountSegment(delivered), " to the destination and removed the check.") };
      }
      case "cancel":
        return { title: "Cancelled", what: sentence("Removed the check. Nothing was paid.") };
      default:
        return { title: `Changed by ${event.tx_type}`, what: [] };
    }
  };
}

/**
 * The marks and what can still happen, as the board has them for each status (spec 4.3): an open check can still be cashed (until its expiration) and cancelled (by the source at any time, by
 * anyone after the expiration); an expired one has the expiration that passed and the CheckCancel that anyone can send now. A cashed or cancelled check has nothing to come, and one another
 * transaction removed neither. A `next` has its `at` only while its time is ahead of the page (the page counts down to it).
 */
function marksOf(f: Facts): TimelineItem[] {
  const { sendMax, expiration } = f;
  switch (f.status) {
    case "open":
      return [
        {
          kind: "next",
          type: "CheckCash",
          title: "Not cashed yet",
          ...(expiration !== undefined && { at: expiration, whenText: `Until ${when(expiration)}` }),
          what: sentence("The destination can cash it", sendMax === null ? "" : sentence(" for up to ", amountSegment(sendMax)), "."),
        },
        {
          kind: "next",
          type: "CheckCancel",
          title: "Not cancelled",
          whenText: expiration === undefined ? "The source: any time" : `The source: any time · anyone: after ${when(expiration)}`,
          what: [text("Cancelling removes the check; nothing is paid.")],
        },
      ];
    case "expired":
      return [
        ...(expiration === undefined ? [] : [{ kind: "mark" as const, type: "Expiration", title: "Passed", at: expiration, whenText: when(expiration), what: [text("From here it can no longer be cashed.")] }]),
        {
          kind: "next",
          type: "CheckCancel",
          title: "Not cancelled yet",
          ...(expiration !== undefined && { whenText: `Since ${when(expiration)}` }),
          what: [text("Anyone can send it now to remove the check and release the source’s reserve.")],
        },
      ];
    default:
      return [];
  }
}

// ---- The Details card ----------------------------------------------------------------------------------------------------------------------------

function detailsOf(f: Facts, reserve: ReserveView | null): DetailRow[] {
  const { check, sendMax, delivered, expiration } = f;
  const { noun } = fundsOf(sendMax);
  return [
    { label: "Check ID", field: "ledger object ID", value: { kind: "code", text: check.check_id, copy: "check ID" } },
    { label: "Source", value: { kind: "account", address: check.account } },
    { label: "Destination", value: { kind: "account", address: check.destination } },
    {
      label: "Can be cashed for",
      field: "SendMax",
      value: { kind: "amount", amount: sendMax },
      hint: `The most the destination can cash. Nothing is set aside: the source must hold ${noun} when the check is cashed.`,
    },
    ...(f.status === "cashed" || delivered !== null
      ? [{ label: "Delivered", value: { kind: "amount" as const, amount: delivered }, hint: "What the CheckCash delivered to the destination." }]
      : []),
    {
      label: "Expires",
      field: "Expiration",
      value: expiration === undefined ? none() : { kind: "time", at: expiration },
      ...(expiration !== undefined && {
        hint: f.status === "expired" ? "Passed: the check can no longer be cashed, and anyone can cancel it." : "After this time the check can no longer be cashed.",
      }),
    },
    check.invoice_id === undefined
      ? { label: "Invoice ID", field: "InvoiceID", value: none() }
      : {
          label: "Invoice ID",
          field: "InvoiceID",
          value: { kind: "code", text: check.invoice_id, copy: "invoice ID" },
          hint: "Set by the source, for example the hash of an invoice, so the destination can match the payment.",
        },
    { label: "Destination tag", value: tagValue(check.destination_tag) },
    { label: "Source tag", value: tagValue(check.source_tag) },
    ...(reserve === null ? [] : [{ label: "Owner reserve", value: { kind: "amount" as const, amount: { value: reserve.amount, currency: reserve.currency } }, hint: reserve.hint }]),
  ];
}

// ---- The page ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The check page's data from the index's answer (`origin: "index"`, with the history page a `?marker=` asked for) or from the node's entry (`origin: "node"`: no history, its status worked
 * out at the request's time). `o.names` is the loader's (`NO_NAMES` while it works out `drawnAccounts`), `o.serverState` is `null` when the call failed (no Owner reserve row).
 */
export function checkPage(
  source: ObjectSource,
  o: { net: Network; serverState: ServerState | null; names: NamesPart; marker?: string; back: readonly string[] },
): CheckPageData {
  const f = factsOf(source, o.net.native);
  const { check, sendMax } = f;
  const pill = PILLS[f.status];
  const common = commonOf(
    source,
    { net: o.net, kind: "check", serverState: o.serverState, names: o.names, marker: o.marker, back: o.back },
    { pill, states: statesOf(f.status), marks: marksOf(f), bannerSentence: bannerSentenceOf(f), say: eventWordsOf(f) },
  );
  return {
    ...common,
    kind: "check",
    summary: summaryOf(f),
    statusLines: statusLinesOf(f),
    expiredBanner: f.status === "expired" ? expiredBannerOf(common.reserve) : null,
    flow: flowOf(f),
    details: detailsOf(f, common.reserve),
    meta: {
      id: check.check_id,
      amount: sendMax === null ? "" : amountText(sendMax),
      owner: shortAddress(check.account),
      destination: shortAddress(check.destination),
      status: pill.text.toLowerCase(),
      marker: o.marker !== undefined,
    },
  };
}

// ---- The accounts the page draws ---------------------------------------------------------------------------------------------------------------------

/**
 * The accounts the page draws as an `AccountLink` (E9, "Display names"), each once, in the order the page draws them: the accounts of the removed banner's sentence, those of the expired
 * banner, the summary and the status lines (`accountsIn`: an account segment), the three boxes of the flow (the source, the issuer of a token in the check's box, the destination), the
 * accounts of the Details card (the source, the destination, the issuer of a token in its amount rows), and for each item of the timeline the accounts of what it did, the account that sent
 * the transaction and the delegate. Never an amount's issuer in a sentence, which `Amount` writes in a title, nor an MPT's, nor the short addresses of the meta tags. The common parts (the
 * banner, the timeline) are `commonAccounts`'s, with the check's own parts between them. The loader passes this to `collectAddresses`, then `loadNames`.
 */
export function drawnAccounts(page: CheckPageData): string[] {
  const { source, check, destination } = page.flow;
  const flow = [source.account, ...(check.issuer === undefined ? [] : [check.issuer]), destination.account];
  return commonAccounts(page, [...accountsIn(page.expiredBanner ?? []), ...accountsIn(page.summary), ...page.statusLines.flatMap(accountsIn), ...flow, ...detailAccounts(page.details)]);
}
