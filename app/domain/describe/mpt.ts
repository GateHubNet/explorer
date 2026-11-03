// MPTokenIssuanceCreate, MPTokenIssuanceDestroy, MPTokenIssuanceSet, MPTokenAuthorize and Clawback (E14 spec 5.3). The payment of an MPT is in payment.ts.
//
// Each sentence goes through `verb`, so a failure reads "tried to ...". `{mpt}` is a reference segment (`mptSegment` without units: the ticker, else "MPT 0000012A...", once the page has
// looked the issuance up), `{amount}` an MPT amount segment (its units, scaled once the page has looked the issuance up).

import { formatAmount } from "../format";
import { isMptId, scaleUnits, transferFeeText } from "../mpt";
import { mptIdOfNode, nodesOf } from "../parse/objects";
import {
  account,
  amountOf,
  byteSize,
  closingDetails,
  detail,
  fieldDetail,
  genericDetails,
  mptFlowAmount,
  mptSegment,
  parseAmount,
  seq,
  wholeNumber,
  type FlagTable,
  type Part,
} from "./helpers";
import type { Detail, FlowAmount, FlowStep, HandlerMap, Input, Segment, Summary } from "./types";

const TF_MPT_LOCK = 0x00000001;
const TF_MPT_UNLOCK = 0x00000002;
const TF_MPT_UNAUTHORIZE = 0x00000001;

const CREATE_FLAGS: FlagTable = [
  [0x00000002, "tfMPTCanLock"],
  [0x00000004, "tfMPTRequireAuth"],
  [0x00000008, "tfMPTCanEscrow"],
  [0x00000010, "tfMPTCanTrade"],
  [0x00000020, "tfMPTCanTransfer"],
  [0x00000040, "tfMPTCanClawback"],
];
const SET_FLAGS: FlagTable = [
  [TF_MPT_LOCK, "tfMPTLock"],
  [TF_MPT_UNLOCK, "tfMPTUnlock"],
];
const AUTHORIZE_FLAGS: FlagTable = [[TF_MPT_UNAUTHORIZE, "tfMPTUnauthorize"]];

const hasFlag = (flags: unknown, mask: number): boolean => typeof flags === "number" && Number.isInteger(flags) && (flags & mask) !== 0;

/** The issuance a transaction names (`MPTokenIssuanceID`) as a reference segment, or `undefined` when the field is not an ID. */
function namedIssuance(tx: Input["tx"]): Segment | undefined {
  const id = tx.MPTokenIssuanceID;
  return typeof id === "string" && isMptId(id) ? mptSegment(id) : undefined;
}

/** "the MPT {mpt}" of a sentence; "an MPT" when there is no ID to name. */
function theMpt(reference: Segment | undefined): Part {
  return reference === undefined ? "an MPT" : ["the MPT ", reference];
}

/** The "Issuance ID" detail: a reference to the issuance the transaction names, or the field as it is when what it holds is no ID. */
function issuanceDetails(tx: Input["tx"], reference: Segment | undefined): Detail[] {
  return [...(reference === undefined ? fieldDetail(tx, "MPTokenIssuanceID", "Issuance ID") : [detail("Issuance ID", reference)])];
}

const holderDetail = (tx: Input["tx"]): Detail[] => (typeof tx.Holder === "string" && tx.Holder !== "" ? [detail("Holder", account(tx.Holder))] : []);

// --- MPTokenIssuanceCreate -----------------------------------------------------------------------------------------

/** The most an issuance can ever hold, scaled by the transaction's own `AssetScale` ("Not set" when the transaction sets none); above scale 19 it is the units themselves. */
function maxAmountText(raw: unknown, scale: number): string {
  if (raw === undefined) return "Not set";
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return String(raw);
  const scaled = scaleUnits(raw, scale);
  return scaled === null ? `${formatAmount(raw)} units` : formatAmount(scaled);
}

function describeCreate({ tx, meta, ok, verb }: Input): Summary {
  // The data API's JSON has no `meta.mpt_issuance_id`: the issuance the transaction created is the created node, which a failed create has none of.
  const created = ok ? nodesOf(meta).find((node) => node.change === "created" && node.type === "MPTokenIssuance") : undefined;
  const id = created === undefined ? undefined : mptIdOfNode(created);
  const scale = wholeNumber(tx.AssetScale) ?? 0;
  const fee = wholeNumber(tx.TransferFee);

  const details: Detail[] = [
    ...(id === undefined ? [] : [detail("Issuance ID", mptSegment(id))]),
    detail("Asset scale", tx.AssetScale === undefined ? "0" : String(tx.AssetScale)),
    detail("Max amount", maxAmountText(tx.MaximumAmount, scale)),
    detail("Transfer fee", tx.TransferFee === undefined ? "None" : fee === undefined ? String(tx.TransferFee) : transferFeeText(fee)),
    ...closingDetails(tx, CREATE_FLAGS),
    ...(tx.MPTokenMetadata === undefined ? [] : [detail("Metadata", byteSize(tx.MPTokenMetadata) ?? String(tx.MPTokenMetadata))]),
  ];
  return {
    title: "MPT issuance",
    predicate: seq(`${verb("created", "create")} `, id === undefined ? "an MPT" : ["the MPT ", mptSegment(id)]),
    details,
  };
}

// --- MPTokenIssuanceDestroy ----------------------------------------------------------------------------------------

function describeDestroy({ tx, verb }: Input): Summary {
  const mpt = namedIssuance(tx);
  return {
    title: "MPT issuance",
    predicate: seq(`${verb("destroyed", "destroy")} `, theMpt(mpt)),
    details: [...issuanceDetails(tx, mpt), ...closingDetails(tx, [])],
  };
}

// --- MPTokenIssuanceSet --------------------------------------------------------------------------------------------

/** The fields the Set lists on its own; the rest are listed as they are (a DynamicMPT change: its metadata, its fee, its mutable flags). */
const SET_OWN_FIELDS: ReadonlySet<string> = new Set(["MPTokenIssuanceID", "Holder", "SourceTag", "TicketSequence", "Memos", "Signers"]);

function describeSet({ tx, native, verb }: Input): Summary {
  const mpt = namedIssuance(tx);
  const holder = typeof tx.Holder === "string" && tx.Holder !== "" ? tx.Holder : undefined;
  const details = [...issuanceDetails(tx, mpt), ...holderDetail(tx), ...genericDetails(tx, native, SET_OWN_FIELDS), ...closingDetails(tx, SET_FLAGS)];

  // One holder's balance, or every balance. A Set with neither flag changes something else about the issuance (DynamicMPT).
  const of = (past: string, infinitive: string): Part =>
    holder === undefined
      ? [`${verb(past, infinitive)} every balance of `, mpt ?? "an MPT"]
      : [`${verb(past, infinitive)} `, account(holder), "'s balance of ", mpt ?? "an MPT"];
  if (hasFlag(tx.Flags, TF_MPT_LOCK)) return { title: "MPT lock", predicate: seq(of("locked", "lock")), details };
  if (hasFlag(tx.Flags, TF_MPT_UNLOCK)) return { title: "MPT lock", predicate: seq(of("unlocked", "unlock")), details };
  return { title: "MPT issuance", predicate: seq(`${verb("changed", "change")} `, theMpt(mpt)), details };
}

// --- MPTokenAuthorize ----------------------------------------------------------------------------------------------

function describeAuthorize({ tx, verb }: Input): Summary {
  const mpt = namedIssuance(tx);
  const unauthorize = hasFlag(tx.Flags, TF_MPT_UNAUTHORIZE);
  const holder = typeof tx.Holder === "string" && tx.Holder !== "" ? tx.Holder : undefined;

  let predicate: Part;
  if (holder === undefined) {
    predicate = unauthorize ? [`${verb("stopped holding", "stop holding")} `, mpt ?? "an MPT"] : [`${verb("opted in to hold", "opt in to hold")} `, mpt ?? "an MPT"];
  } else {
    predicate = unauthorize
      ? [`${verb("took back", "take back")} `, account(holder), "'s authorization to hold ", mpt ?? "an MPT"]
      : [`${verb("authorized", "authorize")} `, account(holder), " to hold ", mpt ?? "an MPT"];
  }
  return {
    title: "MPT authorization",
    predicate: seq(predicate),
    details: [...issuanceDetails(tx, mpt), ...holderDetail(tx), ...closingDetails(tx, AUTHORIZE_FLAGS)],
  };
}

// --- Clawback ------------------------------------------------------------------------------------------------------

/**
 * An MPT's clawback names the holder in `Holder`. An issued token's clawback has no `Holder`: `Amount.issuer` is the holder, and the amount is shown as the sender's own, with the sender as
 * its issuer (the sender is the one who issued it).
 */
function describeClawback({ tx, native, verb }: Input): Summary {
  const mptAmount = mptFlowAmount(tx.Amount);
  const issued = mptAmount === undefined ? parseAmount(tx.Amount, native) : undefined;
  const holder = mptAmount !== undefined ? tx.Holder : issued?.issuer;

  const shown = mptAmount !== undefined ? mptSegment(mptAmount.mpt, mptAmount.units) : issued !== undefined ? amountOf({ ...issued, issuer: tx.Account }) : undefined;
  const flowAmount: FlowAmount | undefined = mptAmount ?? (issued === undefined ? undefined : { ...issued, issuer: tx.Account });

  const flow: FlowStep[] | undefined =
    typeof holder === "string" && holder !== "" && flowAmount !== undefined
      ? [
          { role: "sender", account: holder, label: "Holder", amount: flowAmount },
          { role: "destination", account: tx.Account, label: "Issuer", amount: flowAmount },
        ]
      : undefined;

  const amount: Part = shown ?? "an amount";
  return {
    title: "Clawback",
    predicate: seq(`${verb("clawed back", "claw back")} `, amount, " from ", account(holder)),
    ...(flow ? { flow } : {}),
    details: [...(shown ? [detail("Amount", shown)] : []), ...(typeof holder === "string" && holder !== "" ? [detail("Holder", account(holder))] : []), ...closingDetails(tx, [])],
  };
}

export const mptHandlers: HandlerMap = {
  MPTokenIssuanceCreate: describeCreate,
  MPTokenIssuanceDestroy: describeDestroy,
  MPTokenIssuanceSet: describeSet,
  MPTokenAuthorize: describeAuthorize,
  Clawback: describeClawback,
};
