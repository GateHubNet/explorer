// The account types: TrustSet, AccountSet, AccountDelete, SetRegularKey, SignerListSet and TicketCreate.

import BigNumber from "bignumber.js";
import { formatAmount, formatCurrency } from "../format";
import type { Native } from "../parse/types";
import {
  account,
  amountOf,
  amountSegment,
  closingDetails,
  decodeHex,
  detail,
  fieldDetail,
  genericDetails,
  parseAmount,
  plural,
  seq,
  text,
  wholeNumber,
  type FlagTable,
} from "./helpers";
import type { Detail, FlowStep, HandlerMap, Input, Summary } from "./types";

// --- TrustSet ------------------------------------------------------------------------------------------------------

const TRUST_SET_FLAGS: FlagTable = [
  [0x00010000, "tfSetfAuth"],
  [0x00020000, "tfSetNoRipple"],
  [0x00040000, "tfClearNoRipple"],
  [0x00100000, "tfSetFreeze"],
  [0x00200000, "tfClearFreeze"],
  [0x00400000, "tfSetDeepFreeze"],
  [0x00800000, "tfClearDeepFreeze"],
];

function describeTrustSet({ tx, native, verb }: Input): Summary {
  const limit = parseAmount(tx.LimitAmount, native);
  // This text is final, so the currency and the limit are formatted here.
  const predicate =
    limit?.issuer === undefined
      ? seq(`${verb("set", "set")} a trust line`)
      : seq(
          `${verb("set", "set")} a trust line to `,
          account(limit.issuer),
          ` for ${formatCurrency(limit.currency)}, limit ${formatAmount(limit.value)}`,
        );

  const details: Detail[] = [
    ...(limit?.issuer !== undefined
      ? [
          detail("Issuer", account(limit.issuer)),
          detail("Currency", formatCurrency(limit.currency)),
          detail("Limit", amountOf(limit)),
        ]
      : []),
    ...fieldDetail(tx, "QualityIn", "Quality in"),
    ...fieldDetail(tx, "QualityOut", "Quality out"),
    ...closingDetails(tx, TRUST_SET_FLAGS),
  ];
  return { title: "Trust line", predicate, details };
}

// --- AccountSet ----------------------------------------------------------------------------------------------------

const ACCOUNT_SET_FLAGS: FlagTable = [
  [0x00010000, "tfRequireDestTag"],
  [0x00020000, "tfOptionalDestTag"],
  [0x00040000, "tfRequireAuth"],
  [0x00080000, "tfOptionalAuth"],
  [0x00100000, "tfDisallowXRP"],
  [0x00200000, "tfAllowXRP"],
];

/** `SetFlag` and `ClearFlag` values both networks share. */
const COMMON_ACCOUNT_FLAGS: Record<number, string> = {
  1: "asfRequireDest",
  2: "asfRequireAuth",
  3: "asfDisallowXRP",
  4: "asfDisableMaster",
  5: "asfAccountTxnID",
  6: "asfNoFreeze",
  7: "asfGlobalFreeze",
  8: "asfDefaultRipple",
  9: "asfDepositAuth",
  12: "asfDisallowIncomingNFTokenOffer",
  13: "asfDisallowIncomingCheck",
  14: "asfDisallowIncomingPayChan",
  15: "asfDisallowIncomingTrustline",
};

/** The values the two networks use differently (11 is Xahau's alone, 10 and 16 are XRPL's). */
const ACCOUNT_FLAGS_BY_NETWORK: Record<Native, Record<number, string>> = {
  XRP: { 10: "asfAuthorizedNFTokenMinter", 16: "asfAllowTrustLineClawback" },
  XAH: { 11: "asfTshCollect" },
};

function accountFlag(value: unknown, native: Native): string {
  const n = wholeNumber(value);
  if (n === undefined) return String(value);
  return ACCOUNT_FLAGS_BY_NETWORK[native][n] ?? COMMON_ACCOUNT_FLAGS[n] ?? `flag ${n}`;
}

/** The fields AccountSet lists on their own; the rest of its fields are listed as they are. */
const ACCOUNT_SET_OWN_FIELDS: ReadonlySet<string> = new Set([
  "Domain",
  "SetFlag",
  "ClearFlag",
  "EmailHash",
  "MessageKey",
  "TransferRate",
  "TickSize",
  "NFTokenMinter",
  // Not settings of the account: closingDetails lists these, and memos and signers belong to the transaction.
  "SourceTag",
  "TicketSequence",
  "Memos",
  "Signers",
]);

/** A transfer rate is a billionths multiplier; 0 and 1,000,000,000 both mean no fee. */
function transferRate(raw: unknown): string {
  const rate = wholeNumber(raw);
  if (rate === undefined) return String(raw);
  if (rate === 0 || rate === 1_000_000_000) return "no fee";
  return `${new BigNumber(rate).minus(1_000_000_000).shiftedBy(-7).toFixed()}%`;
}

function describeAccountSet({ tx, native, verb }: Input): Summary {
  const removable = (field: string, label: string, show: (raw: unknown) => string): Detail[] =>
    tx[field] === undefined ? [] : [detail(label, tx[field] === "" ? "removed" : show(tx[field]))];

  const details: Detail[] = [
    ...removable("Domain", "Domain", (raw) => decodeHex(raw) ?? String(raw)),
    ...(tx.SetFlag !== undefined ? [detail("Set flag", accountFlag(tx.SetFlag, native))] : []),
    ...(tx.ClearFlag !== undefined ? [detail("Clear flag", accountFlag(tx.ClearFlag, native))] : []),
    ...removable("EmailHash", "Email hash", String),
    ...removable("MessageKey", "Message key", String),
    ...(tx.TransferRate !== undefined ? [detail("Transfer rate", transferRate(tx.TransferRate))] : []),
    ...(tx.TickSize !== undefined ? [detail("Tick size", tx.TickSize === 0 ? "removed" : String(tx.TickSize))] : []),
    ...(tx.NFTokenMinter !== undefined
      ? [detail("NFToken minter", tx.NFTokenMinter === "" ? text("removed") : account(tx.NFTokenMinter))]
      : []),
    ...genericDetails(tx, native, ACCOUNT_SET_OWN_FIELDS),
    ...closingDetails(tx, ACCOUNT_SET_FLAGS),
  ];
  return { title: "Account settings", predicate: seq(`${verb("updated", "update")} account settings`), details };
}

// --- AccountDelete -------------------------------------------------------------------------------------------------

function describeAccountDelete({ tx, meta, native, ok, verb }: Input): Summary {
  const delivered = ok ? parseAmount(meta.delivered_amount, native) : undefined;
  const flow: FlowStep[] = [
    { role: "sender", account: tx.Account, label: "Sender", ...(delivered ? { amount: delivered } : {}) },
    ...(typeof tx.Destination === "string"
      ? [{ role: "destination" as const, account: tx.Destination, label: "Destination", ...(delivered ? { amount: delivered } : {}) }]
      : []),
  ];
  return {
    title: "Account deletion",
    predicate: seq(
      `${verb("deleted", "delete")} the account and ${verb("sent", "send")} the rest to `,
      account(tx.Destination),
    ),
    flow,
    details: [
      ...fieldDetail(tx, "DestinationTag", "Destination tag"),
      ...(delivered ? [detail("Delivered", amountOf(delivered))] : []),
      ...closingDetails(tx, []),
    ],
  };
}

// --- SetRegularKey -------------------------------------------------------------------------------------------------

function describeSetRegularKey({ tx, verb }: Input): Summary {
  const key = tx.RegularKey;
  return {
    title: "Regular key",
    predicate:
      typeof key === "string" && key !== ""
        ? seq(`${verb("set", "set")} its regular key to `, account(key))
        : seq(`${verb("removed", "remove")} its regular key`),
    details: closingDetails(tx, []),
  };
}

// --- SignerListSet -------------------------------------------------------------------------------------------------

type SignerEntry = { SignerEntry?: { Account?: unknown; SignerWeight?: unknown } };

function describeSignerListSet({ tx, verb }: Input): Summary {
  const entries = (Array.isArray(tx.SignerEntries) ? tx.SignerEntries : []) as SignerEntry[];
  const quorum = wholeNumber(tx.SignerQuorum);
  // A quorum of 0 deletes the list.
  const removes = quorum === 0 && entries.length === 0;

  const signers = entries.map(({ SignerEntry: entry }, i) =>
    detail(`Signer ${i + 1}`, account(entry?.Account), `, weight ${String(entry?.SignerWeight ?? "unknown")}`),
  );
  return {
    title: "Signer list",
    predicate: removes
      ? seq(`${verb("removed", "remove")} its signer list`)
      : seq(
          `${verb("set", "set")} a signer list of ${plural(entries.length, "signer")}`,
          quorum === undefined ? "" : `, quorum ${quorum}`,
        ),
    details: [...(quorum === undefined ? [] : [detail("Quorum", String(quorum))]), ...signers, ...closingDetails(tx, [])],
  };
}

// --- TicketCreate --------------------------------------------------------------------------------------------------

function describeTicketCreate({ tx, verb }: Input): Summary {
  const count = wholeNumber(tx.TicketCount);
  return {
    title: "Tickets",
    predicate: seq(`${verb("created", "create")} ${count === undefined ? "tickets" : plural(count, "ticket")}`),
    details: closingDetails(tx, []),
  };
}

export const accountHandlers: HandlerMap = {
  TrustSet: describeTrustSet,
  AccountSet: describeAccountSet,
  AccountDelete: describeAccountDelete,
  SetRegularKey: describeSetRegularKey,
  SignerListSet: describeSignerListSet,
  TicketCreate: describeTicketCreate,
};
