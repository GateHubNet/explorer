// OfferCreate and OfferCancel.

import { amountSegment, closingDetails, detail, fieldDetail, rippleTime, seq, type FlagTable } from "./helpers";
import type { Detail, HandlerMap, Input, Summary } from "./types";

const TF_SELL = 0x00080000;

const OFFER_CREATE_FLAGS: FlagTable = [
  [0x00010000, "tfPassive"],
  [0x00020000, "tfImmediateOrCancel"],
  [0x00040000, "tfFillOrKill"],
  [0x00080000, "tfSell"],
  [0x00100000, "tfHybrid"],
];

function describeOfferCreate({ tx, native, verb }: Input): Summary {
  const gets = amountSegment(tx.TakerGets, native);
  const pays = amountSegment(tx.TakerPays, native);
  const sell = typeof tx.Flags === "number" && (tx.Flags & TF_SELL) !== 0;

  // The offer gives TakerGets and wants TakerPays either way; tfSell makes the sold amount the exact one, and without
  // it the bought amount is.
  const predicate = sell
    ? seq(`${verb("offered", "offer")} to sell `, gets, " for ", pays)
    : seq(`${verb("offered", "offer")} to buy `, pays, " for ", gets);

  const details: Detail[] = [
    detail("Sells", gets),
    detail("Buys", pays),
    ...fieldDetail(tx, "OfferSequence", "Replaces offer"),
    ...(tx.Expiration !== undefined ? [detail("Expires", rippleTime(tx.Expiration))] : []),
    ...fieldDetail(tx, "DomainID", "Domain ID"),
    ...closingDetails(tx, OFFER_CREATE_FLAGS),
  ];
  return { title: "Offer", predicate, details };
}

function describeOfferCancel({ tx, verb }: Input): Summary {
  const offer = typeof tx.OfferSequence === "number" ? `offer ${tx.OfferSequence}` : "an offer";
  return {
    title: "Offer cancellation",
    predicate: seq(`${verb("cancelled", "cancel")} ${offer}`),
    details: closingDetails(tx, []),
  };
}

export const offerHandlers: HandlerMap = {
  OfferCreate: describeOfferCreate,
  OfferCancel: describeOfferCancel,
};
