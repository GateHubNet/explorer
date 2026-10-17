// EscrowCreate, EscrowFinish and EscrowCancel.

import {
  account,
  amountSegment,
  closingDetails,
  detail,
  fieldDetail,
  rippleTime,
  seq,
  wholeNumber,
} from "./helpers";
import type { Detail, HandlerMap, Input, Summary } from "./types";

function describeEscrowCreate({ tx, native, verb }: Input): Summary {
  const amount = amountSegment(tx.Amount, native);
  const timed = tx.FinishAfter !== undefined;
  const conditional = tx.Condition !== undefined;

  // When the escrow can be released: after a time, until a condition is met, or both.
  const release = timed
    ? [", release after ", rippleTime(tx.FinishAfter), conditional ? " once a condition is met" : ""]
    : conditional
      ? ", until a condition is met"
      : "";

  const details: Detail[] = [
    detail("Amount", amount),
    detail("Destination", account(tx.Destination)),
    ...fieldDetail(tx, "DestinationTag", "Destination tag"),
    ...(timed ? [detail("Release after", rippleTime(tx.FinishAfter))] : []),
    ...(tx.CancelAfter !== undefined ? [detail("Cancel after", rippleTime(tx.CancelAfter))] : []),
    ...fieldDetail(tx, "Condition", "Condition"),
    ...closingDetails(tx, []),
  ];
  return {
    title: "Escrow",
    predicate: seq(`${verb("locked", "lock")} `, amount, " for ", account(tx.Destination), release),
    details,
  };
}

/** "escrow 57978925 of {owner}", the escrow being the sequence number of the transaction that created it. */
function escrowOf(tx: Input["tx"]) {
  const sequence = wholeNumber(tx.OfferSequence);
  return [sequence === undefined ? "an escrow" : `escrow ${sequence}`, " of ", account(tx.Owner)];
}

function escrowDetails(tx: Input["tx"]): Detail[] {
  return [
    detail("Owner", account(tx.Owner)),
    ...fieldDetail(tx, "OfferSequence", "Escrow sequence"),
    ...fieldDetail(tx, "Condition", "Condition"),
    ...fieldDetail(tx, "Fulfillment", "Fulfillment"),
    ...closingDetails(tx, []),
  ];
}

function describeEscrowFinish({ tx, verb }: Input): Summary {
  return {
    title: "Escrow release",
    predicate: seq(`${verb("released", "release")} `, escrowOf(tx)),
    details: escrowDetails(tx),
  };
}

function describeEscrowCancel({ tx, verb }: Input): Summary {
  return {
    title: "Escrow cancellation",
    predicate: seq(`${verb("cancelled", "cancel")} `, escrowOf(tx)),
    details: escrowDetails(tx),
  };
}

export const escrowHandlers: HandlerMap = {
  EscrowCreate: describeEscrowCreate,
  EscrowFinish: describeEscrowFinish,
  EscrowCancel: describeEscrowCancel,
};
