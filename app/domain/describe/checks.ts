// CheckCreate, CheckCash and CheckCancel.

import { account, amountSegment, closingDetails, detail, fieldDetail, rippleTime, seq } from "./helpers";
import type { Detail, HandlerMap, Input, Summary } from "./types";

function describeCheckCreate({ tx, native, verb }: Input): Summary {
  const max = amountSegment(tx.SendMax, native);
  const details: Detail[] = [
    detail("Destination", account(tx.Destination)),
    ...fieldDetail(tx, "DestinationTag", "Destination tag"),
    detail("Send max", max),
    ...(tx.Expiration !== undefined ? [detail("Expires", rippleTime(tx.Expiration))] : []),
    ...fieldDetail(tx, "InvoiceID", "Invoice ID"),
    ...closingDetails(tx, []),
  ];
  return {
    title: "Check",
    predicate: seq(`${verb("wrote", "write")} a check to `, account(tx.Destination), " for up to ", max),
    details,
  };
}

function describeCheckCash({ tx, native, verb }: Input): Summary {
  // A check is cashed for an exact amount, or for at least a minimum (an issued currency only) with the most it allows.
  const worth =
    tx.Amount !== undefined
      ? [" for ", amountSegment(tx.Amount, native)]
      : tx.DeliverMin !== undefined
        ? [" for at least ", amountSegment(tx.DeliverMin, native)]
        : "";
  const details: Detail[] = [
    ...fieldDetail(tx, "CheckID", "Check ID"),
    ...(tx.Amount !== undefined ? [detail("Amount", amountSegment(tx.Amount, native))] : []),
    ...(tx.DeliverMin !== undefined ? [detail("Deliver min", amountSegment(tx.DeliverMin, native))] : []),
    ...closingDetails(tx, []),
  ];
  return { title: "Check cashing", predicate: seq(`${verb("cashed", "cash")} a check`, worth), details };
}

function describeCheckCancel({ tx, verb }: Input): Summary {
  return {
    title: "Check cancellation",
    predicate: seq(`${verb("cancelled", "cancel")} a check`),
    details: [...fieldDetail(tx, "CheckID", "Check ID"), ...closingDetails(tx, [])],
  };
}

export const checkHandlers: HandlerMap = {
  CheckCreate: describeCheckCreate,
  CheckCash: describeCheckCash,
  CheckCancel: describeCheckCancel,
};
