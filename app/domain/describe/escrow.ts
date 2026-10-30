// EscrowCreate, EscrowFinish and EscrowCancel.

import type { ObjectRefParts } from "../object-link";
import { nodesOf } from "../parse/objects";
import {
  account,
  amountSegment,
  closingDetails,
  createdDetail,
  detail,
  fieldDetail,
  ledgerId,
  objectSegment,
  rippleTime,
  seq,
  wholeNumber,
} from "./helpers";
import type { Detail, HandlerMap, Input, Segment, Summary } from "./types";

function describeEscrowCreate({ tx, meta, native, verb }: Input): Summary {
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
    ...createdDetail(meta, "Escrow", "Escrow"),
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

/**
 * The escrow a release or a cancellation is of, in the sentence's words ("escrow 57978925", the sequence of the transaction that created it, or "an escrow" when the transaction does not give
 * it), and who owns it. The escrow node its metadata deleted is the escrow, and its `Account` the owner (on Xahau a transaction may name the escrow by its `EscrowID`, and its `Owner` field
 * is then the escrow's destination: the node says who owns it). Without one (a transaction that failed) the words link to the escrow its `EscrowID` names, else to the one of its `Owner`
 * and `OfferSequence`, and are text when it has neither.
 */
function escrowOf({ tx, meta }: Pick<Input, "tx" | "meta">): { escrow: Segment | string; owner: unknown } {
  const node = nodesOf(meta).find((each) => each.change === "deleted" && each.type === "Escrow");
  const sequence = wholeNumber(tx.OfferSequence);
  const words = sequence === undefined ? "an escrow" : `escrow ${sequence}`;
  const id = ledgerId(node?.index) ?? ledgerId(tx.EscrowID);
  const ref: ObjectRefParts | undefined =
    id !== undefined ? { id } : sequence !== undefined && typeof tx.Owner === "string" && tx.Owner !== "" ? { owner: tx.Owner, sequence } : undefined;
  return { escrow: ref === undefined ? words : objectSegment("escrow", ref, words), owner: typeof node?.fields.Account === "string" ? node.fields.Account : tx.Owner };
}

function escrowDetails(tx: Input["tx"], owner: unknown): Detail[] {
  return [
    detail("Owner", account(owner)),
    ...fieldDetail(tx, "OfferSequence", "Escrow sequence"),
    ...fieldDetail(tx, "Condition", "Condition"),
    ...fieldDetail(tx, "Fulfillment", "Fulfillment"),
    ...closingDetails(tx, []),
  ];
}

function describeEscrowFinish(input: Input): Summary {
  const { escrow, owner } = escrowOf(input);
  return {
    title: "Escrow release",
    predicate: seq(`${input.verb("released", "release")} `, escrow, " of ", account(owner)),
    details: escrowDetails(input.tx, owner),
  };
}

function describeEscrowCancel(input: Input): Summary {
  const { escrow, owner } = escrowOf(input);
  return {
    title: "Escrow cancellation",
    predicate: seq(`${input.verb("cancelled", "cancel")} `, escrow, " of ", account(owner)),
    details: escrowDetails(input.tx, owner),
  };
}

export const escrowHandlers: HandlerMap = {
  EscrowCreate: describeEscrowCreate,
  EscrowFinish: describeEscrowFinish,
  EscrowCancel: describeEscrowCancel,
};
