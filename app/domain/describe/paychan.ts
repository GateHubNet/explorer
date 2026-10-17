// PaymentChannelCreate, PaymentChannelFund and PaymentChannelClaim.

import BigNumber from "bignumber.js";
import { dropsToNative, shortHash } from "../format";
import { nodesOf } from "../parse/objects";
import {
  account,
  amountOf,
  amountSegment,
  closingDetails,
  detail,
  fieldDetail,
  parseAmount,
  plural,
  rippleTime,
  seq,
  wholeNumber,
  type FlagTable,
} from "./helpers";
import type { Detail, FlowAmount, HandlerMap, Input, Summary } from "./types";

/** "channel 3F9A21…B7C4", the channel being named by its ID, or just "a channel". */
function channelOf(tx: Input["tx"]): string {
  return typeof tx.Channel === "string" ? `channel ${shortHash(tx.Channel)}` : "a channel";
}

// --- PaymentChannelCreate ------------------------------------------------------------------------------------------

function describeCreate({ tx, native, verb }: Input): Summary {
  const amount = amountSegment(tx.Amount, native);
  const delay = wholeNumber(tx.SettleDelay);
  return {
    title: "Payment channel",
    predicate: seq(`${verb("opened", "open")} a payment channel to `, account(tx.Destination), " with ", amount),
    details: [
      detail("Amount", amount),
      detail("Destination", account(tx.Destination)),
      ...fieldDetail(tx, "DestinationTag", "Destination tag"),
      ...(delay === undefined ? [] : [detail("Settle delay", plural(delay, "second"))]),
      ...fieldDetail(tx, "PublicKey", "Public key"),
      ...(tx.CancelAfter !== undefined ? [detail("Cancel after", rippleTime(tx.CancelAfter))] : []),
      ...closingDetails(tx, []),
    ],
  };
}

// --- PaymentChannelFund --------------------------------------------------------------------------------------------

function describeFund({ tx, native, verb }: Input): Summary {
  const amount = amountSegment(tx.Amount, native);
  return {
    title: "Payment channel funding",
    predicate: seq(`${verb("added", "add")} `, amount, ` to ${channelOf(tx)}`),
    details: [
      ...fieldDetail(tx, "Channel", "Channel"),
      detail("Amount", amount),
      ...(tx.Expiration !== undefined ? [detail("Expires", rippleTime(tx.Expiration))] : []),
      ...closingDetails(tx, []),
    ],
  };
}

// --- PaymentChannelClaim -------------------------------------------------------------------------------------------

const TF_RENEW = 0x00010000;
const TF_CLOSE = 0x00020000;

const CHANNEL_CLAIM_FLAGS: FlagTable = [
  [TF_RENEW, "tfRenew"],
  [TF_CLOSE, "tfClose"],
];

/**
 * What this claim paid out: the rise of the channel's `Balance`, which the claim sets to the total paid out so far.
 * Undefined when the metadata does not show the channel; zero (a claim of nothing new) is returned as zero.
 */
function paidOut({ tx, meta, native }: Input): FlowAmount | undefined {
  if (typeof tx.Channel !== "string") return undefined;
  const channel = tx.Channel.toUpperCase();
  const node = nodesOf(meta).find((n) => n.type === "PayChannel" && n.index.toUpperCase() === channel);
  const after = node?.fields.Balance;
  if (typeof after !== "string") return undefined;
  // A claim that changed nothing leaves `Balance` out of the previous fields.
  const before = typeof node?.previous.Balance === "string" ? node.previous.Balance : after;
  const drops = new BigNumber(after).minus(before);
  return { value: dropsToNative(drops.toFixed()), currency: native };
}

function describeClaim(input: Input): Summary {
  const { tx, native, ok, verb } = input;
  const flags = typeof tx.Flags === "number" ? tx.Flags : 0;
  const close = (flags & TF_CLOSE) !== 0;
  const renew = (flags & TF_RENEW) !== 0;

  // `Balance` is the total the claim asks the channel to have paid out, not this claim's share of it, so a claim that
  // succeeded is read from the channel's balances; when the metadata does not show them the total is what there is.
  const paid = ok ? (paidOut(input) ?? parseAmount(tx.Balance, native)) : parseAmount(tx.Balance, native);
  const claimed = paid !== undefined && new BigNumber(paid.value).isGreaterThan(0) ? paid : undefined;

  const channel = channelOf(tx);
  const predicate = claimed
    ? seq(
        `${verb("claimed", "claim")} `,
        amountOf(claimed),
        ` from ${channel}`,
        close ? ` and ${verb("closed", "close")} it` : "",
      )
    : close
      ? seq(`${verb("closed", "close")} ${channel}`)
      : renew
        ? seq(`${verb("renewed", "renew")} ${channel}`)
        : seq(`${verb("updated", "update")} ${channel}`);

  const details: Detail[] = [
    ...fieldDetail(tx, "Channel", "Channel"),
    ...(tx.Balance !== undefined ? [detail("Total claimed", amountSegment(tx.Balance, native))] : []),
    ...(tx.Amount !== undefined ? [detail("Authorised amount", amountSegment(tx.Amount, native))] : []),
    ...fieldDetail(tx, "PublicKey", "Public key"),
    ...closingDetails(tx, CHANNEL_CLAIM_FLAGS),
  ];
  return { title: "Payment channel claim", predicate, details };
}

export const paychanHandlers: HandlerMap = {
  PaymentChannelCreate: describeCreate,
  PaymentChannelFund: describeFund,
  PaymentChannelClaim: describeClaim,
};
