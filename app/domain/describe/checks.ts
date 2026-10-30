// CheckCreate, CheckCash and CheckCancel.

import { ledgerId } from "../object-link";
import { account, amountSegment, closingDetails, createdDetail, detail, fieldDetail, objectFieldDetail, objectSegment, rippleTime, seq } from "./helpers";
import type { Detail, HandlerMap, Input, Segment, Summary } from "./types";

/** "a check", linking to the check's page by the `CheckID` of a cashing or a cancellation; text when it has none. */
function checkOf(tx: Input["tx"]): Segment | string {
  const id = ledgerId(tx.CheckID);
  return id === undefined ? "a check" : objectSegment("check", { id }, "a check");
}

function describeCheckCreate({ tx, meta, native, verb }: Input): Summary {
  const max = amountSegment(tx.SendMax, native);
  const details: Detail[] = [
    ...createdDetail(meta, "Check", "Check"),
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
    ...objectFieldDetail(tx, "CheckID", "Check ID", "check"),
    ...(tx.Amount !== undefined ? [detail("Amount", amountSegment(tx.Amount, native))] : []),
    ...(tx.DeliverMin !== undefined ? [detail("Deliver min", amountSegment(tx.DeliverMin, native))] : []),
    ...closingDetails(tx, []),
  ];
  return { title: "Check cashing", predicate: seq(`${verb("cashed", "cash")} `, checkOf(tx), worth), details };
}

function describeCheckCancel({ tx, verb }: Input): Summary {
  return {
    title: "Check cancellation",
    predicate: seq(`${verb("cancelled", "cancel")} `, checkOf(tx)),
    details: [...objectFieldDetail(tx, "CheckID", "Check ID", "check"), ...closingDetails(tx, [])],
  };
}

export const checkHandlers: HandlerMap = {
  CheckCreate: describeCheckCreate,
  CheckCash: describeCheckCash,
  CheckCancel: describeCheckCancel,
};
