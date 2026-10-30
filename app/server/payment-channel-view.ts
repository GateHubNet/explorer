// The payment channel page's data (ledger object pages spec 4.4 and the PayChannel board): built from the data API's answer for the channel (D5) or, for one the index does not have, from the
// node's entry. Pure: the loader gives it the answer, the server state and the names, and the page draws what it returns. The parts every object page has are `ledger-object-view.ts`'s; this
// file has the channel's own: the pill and the states, the summary, the status lines, the deposit bar, the claims paragraph, the marks of the timeline, the words of its events and the rows of
// its Details card.
//
// Page data holds strings and unix seconds, never ages (the escrow view's note): a time is written out where a sentence needs it (`when`, an absolute time in UTC), and otherwise it is a number
// for the page to write with `formatUtc` and to put `RelativeTime` or `Countdown` beside. So the status lines leave out the board's "in 12 hours".
//
// A channel read from the node has no `opened_with`, `funds` or `claims` (they count the events of a history the node does not have), and neither has one whose creation the index does not
// hold the history of: the hints that are made of them are left out, because a count of part of the history would read as the whole.

import BigNumber from "bignumber.js";

import { accountsIn, type Segment } from "../domain/describe";
import { tokenOf } from "../domain/fnv";
import { formatAmount, shortAddress } from "../domain/format";
import type { NamesPart } from "../domain/names";
import type { Native } from "../domain/parse/types";
import { wholePercent } from "../domain/percent";
import { formatDate } from "../domain/time-words";
import type { ShareData, Slot } from "../ui/charts/types";
import type { PillTone } from "../ui/components/Pill";
import type { StateItem } from "../ui/components/StatesStrip";
import type { TimelineItem } from "../ui/components/Timeline";
import type { ChannelStatus, ObjectAmount, ObjectEvent, ObjectRef } from "./api-types";
import {
  amountSegment,
  amountText,
  commonAccounts,
  commonOf,
  detailAccounts,
  displayAmount,
  fromNodeEntry,
  none,
  optionalUnix,
  rawValue,
  sentence,
  tagValue,
  text,
  theAmount,
  when,
  type DetailRow,
  type DisplayAmount,
  type EventWords,
  type NodeChannelObject,
  type ObjectPageCommon,
  type ObjectSource,
  type ReserveView,
} from "./ledger-object-view";
import type { Network } from "./networks";
import type { ServerState } from "./node-rpc";
import { unixOf } from "./validator-facts";

// ---- The data ---------------------------------------------------------------------------------------------------------------------------------

/**
 * What the meta tags say (spec 11), with no name in it (C14: a title or a description is shared out of context, so it has short addresses). The fields are the escrow's: `owner` is the
 * channel's source, and `amount` is what was deposited in all, as text, empty when D5 could not read it.
 */
export interface PaymentChannelMeta {
  id: string;
  amount: string;
  owner: string;
  destination: string;
  /** The status in lower case, as a description has it: "open", "closing". */
  status: string;
  /** Whether the page was reached with a marker (older events), which the meta tags make `noindex`. */
  marker: boolean;
}

/** One of the two parts of the deposit, with what the bar leaves to the page: the amount in the deposit's currency and "{n}% of the deposit" to put under it. */
export interface DepositShare {
  id: "paid" | "left";
  /** "Paid out", and "Left" (or "Returned to the source" once the channel is gone). */
  name: string;
  amount: DisplayAmount;
  share: string;
}

export interface PaymentChannelPageData extends ObjectPageCommon {
  kind: "payment-channel";
  /** "{source} opened a payment channel to {destination} on {day}, with {amount} deposited in all." */
  summary: Segment[];
  /** The status in a headline and the sentences under it. */
  statusLines: Segment[][];
  /** What was deposited in all; `null` when D5 could not read it. */
  amount: DisplayAmount | null;
  /** One row, Deposit, of its two parts. No row when the amount or the balance is missing or does not add up: the bar then says "No data", and the page may leave the section out. */
  deposit: ShareData;
  /** The two parts of `deposit` with their amounts and "{n}% of the deposit"; empty exactly when `deposit` has no row. */
  shares: DepositShare[];
  /** The board's paragraph on claims. */
  claimsNote: Segment[];
  details: DetailRow[];
  meta: PaymentChannelMeta;
}

// ---- Words ---------------------------------------------------------------------------------------------------------------------------------------

const PILLS: Record<ChannelStatus, { tone: PillTone; text: string }> = {
  open: { tone: "info", text: "Open" },
  closing: { tone: "warn", text: "Closing" },
  closed: { tone: "neutral", text: "Closed" },
  removed: { tone: "off", text: "Removed" },
};

/** The states of the strip in the board's order; `removed` is none of them. */
const STATE_IDS = ["open", "closing", "closed"] as const;

/**
 * The states of the strip, each with the board's one line of what it means; the channel's own marked, none for a `removed` one. A channel can be closing for two reasons (decision 12):
 * its Expiration is set (the board's "Close requested…"), or only its CancelAfter has passed, which nobody asked for, and then the strip says what is true of that.
 */
function statesOf(status: ChannelStatus, expiration: number | undefined): StateItem[] {
  const meaning: Record<(typeof STATE_IDS)[number], string> = {
    open: "Claims can be redeemed; no close requested.",
    closing: status === "closing" && expiration === undefined ? "CancelAfter has passed; any transaction on the channel now closes it." : "Close requested; it closes after the settle delay.",
    closed: "What was left went back to the source; removed.",
  };
  return STATE_IDS.map((id) => ({ id, label: PILLS[id].text, meaning: meaning[id], current: id === status }));
}

/** The board's paragraph on claims. */
const claimsNoteOf = (): Segment[] => [
  text(
    "Payments in a channel are claims: the source signs them off the ledger, each for a larger running total, and the destination redeems the latest one on the ledger, so many payments settle in a few transactions.",
  ),
];

const plural = (n: number, one: string, many: string): string => `${formatAmount(String(n))} ${n === 1 ? one : many}`;

/** A settle delay in the largest unit that holds it exactly: "14 days", "12 hours", "90 minutes", "45 seconds". */
function settleWords(seconds: number): string {
  if (seconds >= 86_400 && seconds % 86_400 === 0) return plural(seconds / 86_400, "day", "days");
  if (seconds >= 3600 && seconds % 3600 === 0) return plural(seconds / 3600, "hour", "hours");
  if (seconds >= 60 && seconds % 60 === 0) return plural(seconds / 60, "minute", "minutes");
  return plural(seconds, "second", "seconds");
}

/** The Settle delay row's words and its seconds (the board's "1 day · 86,400 s"); the seconds alone when that is all it has to say. */
const settleText = (seconds: number): string => (seconds < 60 || seconds % 60 !== 0 ? settleWords(seconds) : `${settleWords(seconds)} · ${formatAmount(String(seconds))} s`);

// ---- What the page is made from -----------------------------------------------------------------------------------------------------------------------

/** The channel in the terms the builders below use: times in unix seconds, the amounts ready to draw. */
interface Facts {
  /** `funds` and `claims` are the index's counts: a node-read channel has neither. */
  channel: NodeChannelObject & { funds?: number; claims?: number };
  status: ChannelStatus;
  /** What was deposited in all, what was paid out, what is left: `null` when D5 could not read it. */
  amount: DisplayAmount | null;
  balance: DisplayAmount | null;
  remaining: DisplayAmount | null;
  /** The creation, when the index has it. */
  created?: number;
  expiration?: number;
  cancelAfter?: number;
  settleDelay?: number;
  /** The ledger's close time of the answer, or the request's time for the node's: what "now" is on this page. */
  asOf: number;
  /** The removing transaction: when, and what it was. */
  removed?: { at: number; ref: ObjectRef };
  /** Whether the index holds the whole of the history that `opened_with`, `funds` and `claims` count. */
  whole: boolean;
  /** From when any transaction on the channel closes it: the earlier of Expiration and CancelAfter, and which of them it is. */
  closeAt?: { at: number; field: "Expiration" | "CancelAfter" };
  /** Whether the transaction that closed the channel was the destination redeeming its last claim. */
  closedByClaim: boolean;
}

const show = (amount: ObjectAmount | undefined): DisplayAmount | null => (amount === undefined ? null : displayAmount(amount));

/** What is left of `whole` after `part` (D5's `remaining`, worked out for an event, which does not carry it), in `whole`'s currency; `null` when either is missing or not a number. */
function minus(whole: ObjectAmount | undefined, part: ObjectAmount | undefined): DisplayAmount | null {
  if (whole === undefined || part === undefined) return null;
  const rest = new BigNumber(whole.value).minus(part.value);
  return rest.isNaN() ? null : displayAmount({ ...whole, value: rest.toFixed() });
}

function factsOf(source: ObjectSource, native: Native): Facts {
  let channel: Facts["channel"];
  let asOf: number;
  let whole: boolean;
  if (source.origin === "index") {
    if (!("payment_channel" in source.answer)) throw new Error("paymentChannelPage was given the answer for an object that is not a payment channel");
    channel = source.answer.payment_channel;
    asOf = unixOf(source.answer.close_time);
    whole = source.answer.coverage.complete;
  } else {
    channel = fromNodeEntry("payment-channel", source.entry, native, source.now);
    asOf = source.now;
    whole = false;
  }
  const [expiration, cancelAfter] = [optionalUnix(channel.expiration), optionalUnix(channel.cancel_after)];
  const closeAt =
    expiration !== undefined && (cancelAfter === undefined || expiration <= cancelAfter)
      ? { at: expiration, field: "Expiration" as const }
      : cancelAfter === undefined
        ? undefined
        : { at: cancelAfter, field: "CancelAfter" as const };
  // The newest events are in the answer whatever page of the history was asked for; the one that closed the channel is the newest of all.
  const close = source.origin === "index" ? source.answer.history.find((event) => event.event === "close") : undefined;
  return {
    channel,
    status: channel.status,
    amount: show(channel.amount),
    balance: show(channel.balance),
    remaining: show(channel.remaining),
    created: optionalUnix(channel.created?.time),
    ...(expiration !== undefined && { expiration }),
    ...(cancelAfter !== undefined && { cancelAfter }),
    ...(channel.settle_delay !== undefined && { settleDelay: channel.settle_delay }),
    asOf,
    ...(channel.removed !== undefined && { removed: { at: unixOf(channel.removed.time), ref: channel.removed } }),
    whole,
    ...(closeAt !== undefined && { closeAt }),
    closedByClaim: close !== undefined && close.account === channel.destination && close.balance_change !== undefined,
  };
}

// ---- The summary, the status lines and the banner --------------------------------------------------------------------------------------------------------

function summaryOf(f: Facts): Segment[] {
  const { channel, amount, created } = f;
  return sentence(
    { t: "account", v: channel.account },
    " opened a payment channel to ",
    { t: "account", v: channel.destination },
    created === undefined ? "" : ` on ${formatDate(created)}`,
    amount === null ? "." : sentence(", with ", amountSegment(amount), " deposited in all."),
  );
}

/** What the destination has been paid, for the open channel's second line: nothing, or the running total of the claims. */
function redeemedOf(balance: DisplayAmount | null): Segment[] {
  if (balance === null) return [];
  return new BigNumber(rawValue(balance)).isZero() ? sentence("No claim has been redeemed yet. ") : sentence("The destination has redeemed claims for ", amountSegment(balance), " so far. ");
}

/** The sentences of the status: the headline and what it means (the board's, with its ages left out). */
function statusLinesOf(f: Facts): Segment[][] {
  const { amount, balance, remaining, closeAt, removed, channel, cancelAfter } = f;
  switch (f.status) {
    case "open":
      return [
        remaining === null || amount === null ? sentence("Open: claims can be redeemed") : sentence("Open: ", amountSegment(remaining), " of ", amountSegment(amount), " left to pay out"),
        sentence(redeemedOf(balance), "No close has been requested", cancelAfter === undefined ? ", and no end time is set." : `; the channel closes by ${when(cancelAfter)} at the latest.`),
      ];
    case "closing": {
      if (closeAt === undefined) return [sentence("Closing")];
      // Past the earlier of Expiration and CancelAfter the next transaction on the channel closes it, whoever sends it.
      if (f.asOf >= closeAt.at) {
        return [
          sentence("Closing: any transaction on the channel now closes it"),
          sentence(`${closeAt.field} passed on ${when(closeAt.at)}. When it closes, `, theAmount(remaining), " left go back to the source."),
        ];
      }
      return [
        sentence("Closing: claims can still be redeemed until ", when(closeAt.at)),
        sentence("The source asked to close the channel. From ", when(closeAt.at), ", any transaction on the channel closes it, and ", theAmount(remaining), " left go back to the source."),
      ];
    }
    case "closed":
      return [
        balance !== null && remaining !== null ? sentence("Closed: ", amountSegment(balance), " paid out, ", amountSegment(remaining), " returned to the source") : sentence("Closed"),
        sentence(
          "Closed",
          removed === undefined ? "" : ` on ${when(removed.at)}`,
          f.closedByClaim ? ", when the destination redeemed its last claim and closed the channel." : `, by a ${removed?.ref.tx_type ?? "transaction"}.`,
        ),
      ];
    case "removed":
      return [sentence(`Removed from the ledger by ${channel.removed?.tx_type ?? "a transaction"}`)];
  }
}

/** The sentence of the removed banner, which the timeline's `removed` event repeats; `null` for a channel that is in the ledger. */
function bannerSentenceOf(f: Facts): Segment[] | null {
  const { removed, balance, remaining } = f;
  if (removed === undefined) return null;
  if (f.status === "closed") {
    return balance !== null && remaining !== null
      ? sentence("Closed on ", when(removed.at), "; ", amountSegment(balance), " was paid out and ", amountSegment(remaining), " went back to the source.")
      : sentence("Closed on ", when(removed.at), ".");
  }
  return sentence("Removed on ", when(removed.at), ".");
}

// ---- The deposit -----------------------------------------------------------------------------------------------------------------------------------

/** The bar with nothing to draw: the kit says "No data" for it. */
const noDeposit = (): { deposit: ShareData; shares: DepositShare[] } => ({ deposit: { rows: [], token: tokenOf({ rows: [] }) }, shares: [] });

/**
 * The deposit as one row of two parts (spec 4.4): Paid out (the balance) and Left (what the deposit has over it), or Returned to the source once the channel is gone, each with its share of
 * the deposit. The exact values come from the ledger's, as plain decimals (the kit parses them for the geometry). Colours are slots that reach 3:1 on the card in light: the accent for what
 * was paid out and grey for what is left. Without a readable amount or balance, or when they do not add up (a balance over the deposit), there is no row and no part.
 */
function depositOf(f: Facts): { deposit: ShareData; shares: DepositShare[] } {
  const { amount, balance } = f.channel;
  if (amount === undefined || balance === undefined) return noDeposit();
  const [total, paid] = [new BigNumber(amount.value), new BigNumber(balance.value)];
  const left = total.minus(paid);
  if (!total.gt(0) || paid.isNaN() || paid.lt(0) || left.lt(0)) return noDeposit();

  // Returned to the source is said of a closed channel alone: where the remainder of one that another transaction removed went is not known.
  const ended = f.status === "closed";
  const parts: { id: "paid" | "left"; name: string; slot: Slot; value: BigNumber }[] = [
    { id: "paid", name: "Paid out", slot: 1, value: paid },
    { id: "left", name: ended ? "Returned to the source" : "Left", slot: "neutral", value: left },
  ];
  const rows: ShareData["rows"] = [
    { id: "deposit", label: "Deposit", total: total.toFixed(), segments: parts.map(({ id, name, slot, value }) => ({ id, label: name, slot, value: value.toFixed() })) },
  ];
  return {
    deposit: { rows, token: tokenOf({ rows }) },
    shares: parts.map(({ id, name, value }) => ({
      id,
      name,
      amount: displayAmount({ ...amount, value: value.toFixed() }),
      share: `${wholePercent(value.toFixed(), total.toFixed())} of the deposit`,
    })),
  };
}

// ---- The timeline ----------------------------------------------------------------------------------------------------------------------------------

/**
 * What an event of a channel did, in the board's words: the opening, a funding, a claim, a close request, a renewal and the closing (the removed and the update are every kind's). An event's
 * `amount` and `balance` are those of the channel after it, so a missing one is not the channel's now: only the closing, which is the last state, falls back to it.
 */
function eventWordsOf(f: Facts): (event: ObjectEvent) => EventWords {
  return (event) => {
    const [amount, balance, change, paidMore] = [show(event.amount), show(event.balance), show(event.amount_change), show(event.balance_change)];
    switch (event.event) {
      case "create": {
        const settle = event.settle_delay ?? f.settleDelay;
        return {
          title: "Opened",
          what: sentence("Opened the channel with ", amount === null ? "funds" : amountSegment(amount), settle === undefined ? "" : ` and a settle delay of ${settleWords(settle)}`, "."),
        };
      }
      case "fund":
        return {
          title: "Funded",
          what: sentence(
            change === null ? "Added funds" : sentence("Added ", amountSegment(change)),
            amount === null ? "." : sentence("; ", amountSegment(amount), " deposited in all."),
          ),
        };
      case "claim":
        return {
          title: "Claim redeemed",
          what:
            paidMore === null
              ? sentence("Redeemed a claim", balance === null ? "." : sentence("; ", amountSegment(balance), " in all so far."))
              : balance !== null && new BigNumber(rawValue(paidMore)).eq(rawValue(balance))
                ? sentence("Paid out ", amountSegment(paidMore), " with the first claim.")
                : sentence("Paid out ", amountSegment(paidMore), " more", balance === null ? "." : sentence("; ", amountSegment(balance), " in all so far.")),
        };
      case "close_request": {
        const expiration = optionalUnix(event.expiration);
        return { title: "Close requested", what: sentence("Asked to close the channel", expiration === undefined ? "." : `, which set its expiration to ${when(expiration)}.`) };
      }
      case "renew":
        return { title: "Renewed", what: sentence("Cleared the channel’s expiration: the close request no longer applies.") };
      case "close": {
        const [paid, left] = [balance ?? f.balance, minus(event.amount, event.balance) ?? f.remaining];
        const redeemed =
          paidMore === null
            ? sentence("Closed the channel")
            : paid === null
              ? sentence("Redeemed the last claim and closed the channel")
              : sentence("Redeemed the last claim, ", amountSegment(paid), " paid out in all, and closed the channel");
        return { title: "Closed", what: sentence(redeemed, left === null ? "." : sentence("; ", amountSegment(left), " went back to the source.")) };
      }
      default:
        return { title: `Changed by ${event.tx_type}`, what: [] };
    }
  };
}

/**
 * What can still happen, as the board has it (spec 4.4): an open channel is not closed, by its CancelAfter at the latest or with no end time set; a closing one is not closed yet, from the
 * earlier of its Expiration and CancelAfter. A `next` has its `at` only while its time is ahead of the page (the page counts down to it); one that has come reads "Since {time}". A channel
 * that was closed, or removed, has nothing to come.
 */
function marksOf(f: Facts): TimelineItem[] {
  const { cancelAfter, closeAt } = f;
  switch (f.status) {
    case "open":
      return [
        {
          kind: "next",
          type: "PaymentChannelClaim",
          title: "Not closed",
          ...(cancelAfter === undefined ? { whenText: "No end time set" } : { at: cancelAfter, whenText: `By ${when(cancelAfter)} at the latest` }),
          what: [text("The destination can close it at any time; the source can ask to, and it then closes after the settle delay.")],
        },
      ];
    case "closing": {
      if (closeAt === undefined) return [];
      const ahead = closeAt.at > f.asOf;
      return [
        {
          kind: "next",
          type: "PaymentChannelClaim",
          title: "Not closed yet",
          ...(ahead && { at: closeAt.at }),
          whenText: `${ahead ? "From" : "Since"} ${when(closeAt.at)}`,
          what: [text(ahead ? "Until then the destination can redeem its last claim; after that, any transaction on the channel closes it." : "Any transaction on the channel closes it now.")],
        },
      ];
    }
    default:
      return [];
  }
}

// ---- The Details card ----------------------------------------------------------------------------------------------------------------------------

/** The hint under Deposited: what the channel was opened with and how many fundings came after ("1,000 XRP when it was opened, 2 fundings added later."), where the index has the whole of its history. */
function depositedHint(f: Facts): string | undefined {
  const { opened_with: opened, funds = 0 } = f.channel;
  if (!f.whole || opened === undefined) return undefined;
  return `${amountText(displayAmount(opened))} when it was opened${funds > 0 ? `, ${plural(funds, "funding", "fundings")} added later` : ""}.`;
}

/** The hint under Paid out: the claims redeemed on the ledger, where the index has the whole of its history. */
function paidOutHint(f: Facts): string | undefined {
  const { claims } = f.channel;
  if (!f.whole || claims === undefined) return undefined;
  return `${f.removed === undefined ? "Claimed so far" : "Claimed in all"}, in ${plural(claims, "claim", "claims")} redeemed on the ledger.`;
}

function detailsOf(f: Facts, reserve: ReserveView | null): DetailRow[] {
  const { channel, amount, balance, remaining, settleDelay, expiration, cancelAfter } = f;
  const ended = f.status === "closed";
  const [deposited, paidOut] = [depositedHint(f), paidOutHint(f)];
  // Where what is left goes, by state; for a channel another transaction removed that is not known, so it has no hint.
  const leftHint = {
    open: "Can still be paid out by claims.",
    closing: "Goes back to the source when the channel closes, unless the destination claims it first.",
    closed: "Went back to the source when the channel closed.",
    removed: undefined,
  }[f.status];
  return [
    { label: "Channel ID", field: "ledger object ID", value: { kind: "code", text: channel.channel_id, copy: "channel ID" } },
    { label: "Source", value: { kind: "account", address: channel.account } },
    { label: "Destination", value: { kind: "account", address: channel.destination } },
    { label: "Deposited", field: "Amount", value: { kind: "amount", amount }, ...(deposited !== undefined && { hint: deposited }) },
    { label: "Paid out", field: "Balance", value: { kind: "amount", amount: balance }, ...(paidOut !== undefined && { hint: paidOut }) },
    { label: ended ? "Returned to the source" : "Left", value: { kind: "amount", amount: remaining }, ...(leftHint !== undefined && { hint: leftHint }) },
    {
      label: "Settle delay",
      field: "SettleDelay",
      value: settleDelay === undefined ? none("—") : { kind: "text", text: settleText(settleDelay) },
      ...(settleDelay !== undefined && { hint: "After the source asks to close, the destination has this long to redeem its last claim." }),
    },
    channel.public_key === undefined
      ? { label: "Public key", field: "PublicKey", value: none("—") }
      : {
          label: "Public key",
          field: "PublicKey",
          value: { kind: "code", text: channel.public_key, copy: "public key" },
          hint: "Claims must be signed with this key; the ledger checks the signature when a claim is redeemed.",
        },
    ...(expiration === undefined
      ? []
      : [
          {
            label: "Expires",
            field: "Expiration",
            value: { kind: "time" as const, at: expiration },
            hint: "Set when the source asked to close: the time of the request plus the settle delay.",
          },
        ]),
    ...(cancelAfter === undefined
      ? []
      : [
          {
            label: "Closes by",
            field: "CancelAfter",
            value: { kind: "time" as const, at: cancelAfter },
            hint: "Set when the channel was opened: it closes at this time at the latest.",
          },
        ]),
    { label: "Destination tag", value: tagValue(channel.destination_tag) },
    ...(reserve === null ? [] : [{ label: "Owner reserve", value: { kind: "amount" as const, amount: { value: reserve.amount, currency: reserve.currency } }, hint: reserve.hint }]),
  ];
}

// ---- The page ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The payment channel page's data from the index's answer (`origin: "index"`, with the history page a `?marker=` asked for) or from the node's entry (`origin: "node"`: no history, no
 * counts, its status worked out at the request's time). `o.names` is the loader's (`NO_NAMES` while it works out `drawnAccounts`), `o.serverState` is `null` when the call failed (no Owner
 * reserve row).
 */
export function paymentChannelPage(
  source: ObjectSource,
  o: { net: Network; serverState: ServerState | null; names: NamesPart; marker?: string; back: readonly string[] },
): PaymentChannelPageData {
  const f = factsOf(source, o.net.native);
  const { channel, amount } = f;
  const pill = PILLS[f.status];
  const common = commonOf(
    source,
    { net: o.net, kind: "payment-channel", serverState: o.serverState, names: o.names, marker: o.marker, back: o.back },
    { pill, states: statesOf(f.status, f.expiration), marks: marksOf(f), bannerSentence: bannerSentenceOf(f), say: eventWordsOf(f) },
  );
  return {
    ...common,
    kind: "payment-channel",
    summary: summaryOf(f),
    statusLines: statusLinesOf(f),
    amount,
    ...depositOf(f),
    claimsNote: claimsNoteOf(),
    details: detailsOf(f, common.reserve),
    meta: {
      id: channel.channel_id,
      amount: amount === null ? "" : amountText(amount),
      owner: shortAddress(channel.account),
      destination: shortAddress(channel.destination),
      status: pill.text.toLowerCase(),
      marker: o.marker !== undefined,
    },
  };
}

// ---- The accounts the page draws ---------------------------------------------------------------------------------------------------------------------

/**
 * The accounts the page draws as an `AccountLink` (E9, "Display names"), each once, in the order the page draws them: the accounts of the removed banner's sentence, the summary and the
 * status lines (`accountsIn`: an account segment), the claims paragraph, the accounts of the Details card (the source, the destination, the issuer of a token in its amount rows), and for
 * each item of the timeline the accounts of what it did, the account that sent the transaction and the delegate. Never an amount's issuer in a sentence or under the deposit bar, which
 * `Amount` writes in a title, nor an MPT's, nor the short addresses of the meta tags. The common parts (the banner, the timeline) are `commonAccounts`'s, with the channel's own parts between
 * them. The loader passes this to `collectAddresses`, then `loadNames`.
 */
export function drawnAccounts(page: PaymentChannelPageData): string[] {
  return commonAccounts(page, [...accountsIn(page.summary), ...page.statusLines.flatMap(accountsIn), ...accountsIn(page.claimsNote), ...detailAccounts(page.details)]);
}
