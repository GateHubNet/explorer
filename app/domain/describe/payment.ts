// Payment: direct, cross-currency (with the AMM pools it went through) and partial.

import BigNumber from "bignumber.js";
import { dropsToNative } from "../format";
import {
  amountOf,
  amountSegment,
  account,
  closingDetails,
  detail,
  fieldDetail,
  parseAmount,
  plural,
  pool,
  poolPair,
  sameAmount,
  seq,
  type FlagTable,
  type Part,
} from "./helpers";
import type { Detail, FlowAmount, FlowStep, HandlerMap, Input, Summary } from "./types";

const TF_PARTIAL_PAYMENT = 0x00020000;

const PAYMENT_FLAGS: FlagTable = [
  [0x00010000, "tfNoRippleDirect"],
  [0x00020000, "tfPartialPayment"],
  [0x00040000, "tfLimitQuality"],
];

/**
 * What the sender spent of the `SendMax` currency: the fall of its balance of it. The sender's native change
 * includes the fee, which is taken out. Undefined when the balances show no fall, so a sentence never claims a
 * number the metadata does not give.
 */
function spentOf(input: Input, max: FlowAmount): FlowAmount | undefined {
  const { tx, native } = input;
  let net = new BigNumber(0);
  for (const change of input.changes()) {
    if (change.account === tx.Account && change.currency === max.currency) net = net.plus(change.value);
  }
  if (max.currency === native) net = net.plus(dropsToNative(tx.Fee));

  const spent = net.negated();
  if (!spent.isGreaterThan(0)) return undefined;
  return max.issuer === undefined
    ? { value: spent.toFixed(), currency: max.currency }
    : { value: spent.toFixed(), currency: max.currency, issuer: max.issuer };
}

/** " through the {pool} AMM pool", or "through the {a} and {b} AMM pools" for a payment through several. */
function throughPools(input: Input): Part {
  const hops = input.hops();
  if (hops.length === 0) return "";
  const names = hops.map((hop, i) => [i === 0 ? "" : i === hops.length - 1 ? " and " : ", ", pool(hop)]);
  return [" through the ", names, hops.length === 1 ? " AMM pool" : " AMM pools"];
}

function step(role: FlowStep["role"], who: unknown, label: string, amount?: FlowAmount): FlowStep {
  const flow: FlowStep = { role, account: typeof who === "string" ? who : "", label };
  if (amount) flow.amount = amount;
  return flow;
}

function describePayment(input: Input): Summary {
  const { tx, meta, native, ok, verb } = input;
  // API v2 and recent nodes may answer with DeliverMax alone.
  const rawAmount = tx.Amount ?? tx.DeliverMax;
  const intended = parseAmount(rawAmount, native);
  const sendMax = parseAmount(tx.SendMax, native);
  const partialFlag = typeof tx.Flags === "number" && (tx.Flags & TF_PARTIAL_PAYMENT) !== 0;
  const crossCurrency = sendMax !== undefined && intended !== undefined && sendMax.currency !== intended.currency;

  // Without tfPartialPayment a payment delivers its whole Amount or fails, so that is what arrived when the metadata
  // does not say; with it, nothing is known without the metadata.
  const delivered = ok ? (parseAmount(meta.delivered_amount, native) ?? (partialFlag ? undefined : intended)) : undefined;
  const fellShort =
    delivered !== undefined &&
    intended !== undefined &&
    delivered.currency === intended.currency &&
    new BigNumber(delivered.value).isLessThan(intended.value);

  const spent = ok && sendMax ? spentOf(input, sendMax) : undefined;
  const hops = input.hops();

  const amount = amountSegment(rawAmount, native);
  const maxSegment = amountSegment(tx.SendMax, native);
  const to = [" to ", account(tx.Destination)];

  let predicate: Part;
  if (ok && delivered && fellShort) {
    predicate = [`${verb("paid", "pay")} `, amountOf(delivered), " of up to ", amount, to];
  } else if (partialFlag && (!ok || !delivered)) {
    // A failed partial payment delivered nothing, and a succeeded one may not say what it delivered.
    predicate = [`${verb("paid", "pay")} up to `, amount, to, crossCurrency ? [", spending up to ", maxSegment] : ""];
  } else if (crossCurrency) {
    const spending = ok ? (spent ? [", spending ", amountOf(spent)] : "") : [", spending up to ", maxSegment];
    predicate = [`${verb("paid", "pay")} `, delivered ? amountOf(delivered) : amount, to, spending];
  } else {
    predicate = [`${verb("sent", "send")} `, delivered ? amountOf(delivered) : amount, to];
  }

  const flow: FlowStep[] = [
    step("sender", tx.Account, "Sender", spent ?? (sendMax ? undefined : delivered)),
    ...hops.map((hop) => step("pool", hop.pool, `${poolPair(hop)} AMM pool`, hop.out)),
    step("destination", tx.Destination, "Destination", delivered),
  ];

  const details: Detail[] = [
    detail("Amount", amount),
    ...(delivered && intended && !sameAmount(delivered, intended) ? [detail("Delivered", amountOf(delivered))] : []),
    ...(tx.SendMax !== undefined ? [detail("Send max", maxSegment)] : []),
    ...(spent ? [detail("Spent", amountOf(spent))] : []),
    ...(tx.DeliverMin !== undefined ? [detail("Deliver min", amountSegment(tx.DeliverMin, native))] : []),
    ...fieldDetail(tx, "DestinationTag", "Destination tag"),
    ...fieldDetail(tx, "InvoiceID", "Invoice ID"),
    ...(Array.isArray(tx.Paths) ? [detail("Paths", plural(tx.Paths.length, "path"))] : []),
    ...closingDetails(tx, PAYMENT_FLAGS),
  ];

  return {
    title: "Payment",
    predicate: seq(predicate, ok ? throughPools(input) : ""),
    ...(typeof tx.Destination === "string" ? { flow } : {}),
    details,
  };
}

export const paymentHandlers: HandlerMap = { Payment: describePayment };
