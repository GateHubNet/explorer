// The XRPL NFT types: NFTokenMint, NFTokenBurn, NFTokenCreateOffer, NFTokenCancelOffer and NFTokenAcceptOffer.

import {
  account,
  amountSegment,
  closingDetails,
  decodeHex,
  detail,
  feePercent,
  fieldDetail,
  plural,
  rippleTime,
  seq,
  wholeNumber,
  type FlagTable,
} from "./helpers";
import type { Detail, HandlerMap, Input, Summary } from "./types";

// --- NFTokenMint ---------------------------------------------------------------------------------------------------

const NFT_MINT_FLAGS: FlagTable = [
  [0x00000001, "tfBurnable"],
  [0x00000002, "tfOnlyXRP"],
  [0x00000004, "tfTrustLine"],
  [0x00000008, "tfTransferable"],
  [0x00000010, "tfMutable"],
];

function describeMint({ tx, native, verb }: Input): Summary {
  const taxon = wholeNumber(tx.NFTokenTaxon);
  // A fee of 0 is no fee: it is left out of the sentence and the details.
  const fee = wholeNumber(tx.TransferFee) ? feePercent(tx.TransferFee) : undefined;

  const details: Detail[] = [
    ...(taxon === undefined ? [] : [detail("Taxon", String(taxon))]),
    ...(fee === undefined ? [] : [detail("Transfer fee", fee)]),
    ...(typeof tx.URI === "string" ? [detail("URI", decodeHex(tx.URI) ?? tx.URI)] : []),
    ...(tx.Issuer !== undefined ? [detail("Issuer", account(tx.Issuer))] : []),
    // A mint can create a sell offer for the new NFT in the same transaction.
    ...(tx.Amount !== undefined ? [detail("Sell offer price", amountSegment(tx.Amount, native))] : []),
    ...(tx.Destination !== undefined ? [detail("Sell offer to", account(tx.Destination))] : []),
    ...(tx.Expiration !== undefined ? [detail("Sell offer expires", rippleTime(tx.Expiration))] : []),
    ...closingDetails(tx, NFT_MINT_FLAGS),
  ];
  return {
    title: "NFT mint",
    predicate: seq(
      `${verb("minted", "mint")} an NFT`,
      taxon === undefined ? "" : `, taxon ${taxon}`,
      fee === undefined ? "" : `, transfer fee ${fee}`,
    ),
    details,
  };
}

// --- NFTokenBurn ---------------------------------------------------------------------------------------------------

function describeBurn({ tx, verb }: Input): Summary {
  return {
    title: "NFT burn",
    // The issuer can burn a burnable NFT that someone else holds.
    predicate: seq(`${verb("burned", "burn")} an NFT`, tx.Owner === undefined ? "" : [" owned by ", account(tx.Owner)]),
    details: [
      ...fieldDetail(tx, "NFTokenID", "NFT"),
      ...(tx.Owner !== undefined ? [detail("Owner", account(tx.Owner))] : []),
      ...closingDetails(tx, []),
    ],
  };
}

// --- NFTokenCreateOffer --------------------------------------------------------------------------------------------

const TF_SELL_NFTOKEN = 0x00000001;

const NFT_OFFER_FLAGS: FlagTable = [[TF_SELL_NFTOKEN, "tfSellNFToken"]];

function describeCreateOffer({ tx, native, verb }: Input): Summary {
  const sell = typeof tx.Flags === "number" && (tx.Flags & TF_SELL_NFTOKEN) !== 0;
  const price = amountSegment(tx.Amount, native);

  // A sell offer names the buyer it is for, if any; a buy offer names the owner it asks to sell.
  const predicate = sell
    ? seq(
        `${verb("offered", "offer")} an NFT for sale`,
        tx.Destination === undefined ? "" : [" to ", account(tx.Destination)],
        " for ",
        price,
      )
    : seq(
        `${verb("offered", "offer")} to buy an NFT`,
        tx.Owner === undefined ? "" : [" from ", account(tx.Owner)],
        " for ",
        price,
      );

  const details: Detail[] = [
    ...fieldDetail(tx, "NFTokenID", "NFT"),
    detail("Amount", price),
    ...(tx.Owner !== undefined ? [detail("Owner", account(tx.Owner))] : []),
    ...(tx.Destination !== undefined ? [detail("Destination", account(tx.Destination))] : []),
    ...(tx.Expiration !== undefined ? [detail("Expires", rippleTime(tx.Expiration))] : []),
    ...closingDetails(tx, NFT_OFFER_FLAGS),
  ];
  return { title: "NFT offer", predicate, details };
}

// --- NFTokenCancelOffer --------------------------------------------------------------------------------------------

function describeCancelOffer({ tx, verb }: Input): Summary {
  const offers = Array.isArray(tx.NFTokenOffers) ? tx.NFTokenOffers : [];
  return {
    title: "NFT offer cancellation",
    predicate: seq(
      `${verb("cancelled", "cancel")} ${offers.length === 0 ? "NFT offers" : plural(offers.length, "NFT offer")}`,
    ),
    details: [...offers.map((id, i) => detail(`Offer ${i + 1}`, String(id))), ...closingDetails(tx, [])],
  };
}

// --- NFTokenAcceptOffer --------------------------------------------------------------------------------------------

function describeAcceptOffer({ tx, native, verb }: Input): Summary {
  const sell = typeof tx.NFTokenSellOffer === "string";
  const buy = typeof tx.NFTokenBuyOffer === "string";

  let predicate: string;
  if (sell && buy) predicate = `${verb("brokered", "broker")} the sale of an NFT`;
  else if (sell) predicate = `${verb("accepted", "accept")} a sell offer for an NFT`;
  else if (buy) predicate = `${verb("accepted", "accept")} a buy offer for an NFT`;
  else predicate = `${verb("accepted", "accept")} an NFT offer`;

  return {
    title: "NFT sale",
    predicate: seq(predicate),
    details: [
      ...fieldDetail(tx, "NFTokenSellOffer", "Sell offer"),
      ...fieldDetail(tx, "NFTokenBuyOffer", "Buy offer"),
      ...(tx.NFTokenBrokerFee !== undefined ? [detail("Broker fee", amountSegment(tx.NFTokenBrokerFee, native))] : []),
      ...closingDetails(tx, []),
    ],
  };
}

export const nftHandlers: HandlerMap = {
  NFTokenMint: describeMint,
  NFTokenBurn: describeBurn,
  NFTokenCreateOffer: describeCreateOffer,
  NFTokenCancelOffer: describeCancelOffer,
  NFTokenAcceptOffer: describeAcceptOffer,
};
