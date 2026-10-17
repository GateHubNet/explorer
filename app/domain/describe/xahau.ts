// The Xahau-native types: ClaimReward, SetHook, Invoke, URITokenMint, URITokenBurn, URITokenBuy,
// URITokenCreateSellOffer, URITokenCancelSellOffer, Remit and Import.

import { shortHash } from "../format";
import {
  account,
  amountOf,
  amountSegment,
  byteSize,
  closingDetails,
  decodeHex,
  detail,
  fieldDetail,
  flagNames,
  listOf,
  parseAmount,
  plural,
  seq,
  type FlagTable,
  type Part,
} from "./helpers";
import type { Detail, HandlerMap, Input, Summary } from "./types";

/** "2 parameters" for the `HookParameters` of a transaction that has them. */
function hookParameters(tx: Input["tx"]): Detail[] {
  if (!Array.isArray(tx.HookParameters)) return [];
  return [detail("Hook parameters", plural(tx.HookParameters.length, "parameter"))];
}

// --- ClaimReward ---------------------------------------------------------------------------------------------------

const TF_OPT_OUT = 0x00000001;

const CLAIM_REWARD_FLAGS: FlagTable = [[TF_OPT_OUT, "tfOptOut"]];

function describeClaimReward({ tx, verb }: Input): Summary {
  // The one transaction both claims the rewards and, with tfOptOut, turns them off.
  const optOut = typeof tx.Flags === "number" && (tx.Flags & TF_OPT_OUT) !== 0;
  return {
    title: "Reward claim",
    predicate: seq(
      optOut ? `${verb("opted", "opt")} out of balance rewards` : `${verb("claimed", "claim")} balance rewards`,
    ),
    details: [
      ...(tx.Issuer !== undefined ? [detail("Issuer", account(tx.Issuer))] : []),
      ...closingDetails(tx, CLAIM_REWARD_FLAGS),
    ],
  };
}

// --- SetHook -------------------------------------------------------------------------------------------------------

type HookEntry = { Hook?: Record<string, unknown> };

const HOOK_FLAGS: FlagTable = [
  [0x00000001, "hsfOVERRIDE"],
  [0x00000002, "hsfNSDELETE"],
  [0x00000004, "hsfCOLLECT"],
];

/** An empty `CreateCode` (with `hsfOVERRIDE`) is how SetHook removes the hook in a slot. */
const removes = (hook: Record<string, unknown>): boolean => hook.CreateCode === "";

function describeSetHook({ tx, verb }: Input): Summary {
  const entries = (Array.isArray(tx.Hooks) ? tx.Hooks : []) as HookEntry[];
  // A slot the transaction leaves alone is an empty `Hook`; the others set a hook in their slot or remove it.
  const slots = entries.flatMap((entry, slot) => {
    const hook = entry?.Hook;
    return hook && Object.keys(hook).length > 0 ? [{ hook, slot }] : [];
  });
  const removed = slots.filter(({ hook }) => removes(hook)).length;
  const set = slots.length - removed;

  const details = slots.map(({ hook, slot }) => {
    if (removes(hook)) return detail(`Hook ${slot + 1}`, "removes the hook");
    const facts: string[] = [];
    if (typeof hook.CreateCode === "string") facts.push(`installs ${byteSize(hook.CreateCode) ?? "code"} of code`);
    if (typeof hook.HookHash === "string") facts.push(`uses hook ${shortHash(hook.HookHash)}`);
    if (typeof hook.HookNamespace === "string") facts.push(`namespace ${shortHash(hook.HookNamespace)}`);
    facts.push(...flagNames(hook.Flags, HOOK_FLAGS));
    return detail(`Hook ${slot + 1}`, facts.length > 0 ? facts.join(", ") : JSON.stringify(hook));
  });

  const setting = set > 0 ? `${verb("set", "set")} ${plural(set, "hook")}` : "";
  const removing = removed > 0 ? `${verb("removed", "remove")} ${plural(removed, "hook")}` : "";
  return {
    title: "Hooks",
    predicate: seq(
      setting && removing ? `${setting} and ${removing}` : setting || removing || `${verb("set", "set")} no hooks`,
    ),
    details: [...details, ...closingDetails(tx, [])],
  };
}

// --- Invoke --------------------------------------------------------------------------------------------------------

function describeInvoke({ tx, verb }: Input): Summary {
  const blob = byteSize(tx.Blob);
  return {
    title: "Invoke",
    // With no destination an Invoke runs the sender's own hooks.
    predicate: seq(
      `${verb("invoked", "invoke")} `,
      typeof tx.Destination === "string" ? account(tx.Destination) : "its own hooks",
    ),
    details: [
      ...(tx.Destination !== undefined ? [detail("Destination", account(tx.Destination))] : []),
      ...(blob === undefined ? [] : [detail("Blob", blob)]),
      ...hookParameters(tx),
      ...fieldDetail(tx, "InvoiceID", "Invoice ID"),
      ...closingDetails(tx, []),
    ],
  };
}

// --- URITokens -----------------------------------------------------------------------------------------------------

const URI_TOKEN_MINT_FLAGS: FlagTable = [[0x00000001, "tfBurnable"]];

function describeURITokenMint({ tx, native, verb }: Input): Summary {
  return {
    title: "URIToken mint",
    predicate: seq(`${verb("minted", "mint")} a URIToken`),
    details: [
      ...(typeof tx.URI === "string" ? [detail("URI", decodeHex(tx.URI) ?? tx.URI)] : []),
      ...fieldDetail(tx, "Digest", "Digest"),
      ...(tx.Destination !== undefined ? [detail("Destination", account(tx.Destination))] : []),
      ...(tx.Amount !== undefined ? [detail("Amount", amountSegment(tx.Amount, native))] : []),
      ...closingDetails(tx, URI_TOKEN_MINT_FLAGS),
    ],
  };
}

function describeURITokenBurn({ tx, verb }: Input): Summary {
  return {
    title: "URIToken burn",
    predicate: seq(`${verb("burned", "burn")} a URIToken`),
    details: [...fieldDetail(tx, "URITokenID", "URIToken ID"), ...closingDetails(tx, [])],
  };
}

function describeURITokenBuy({ tx, native, verb }: Input): Summary {
  return {
    title: "URIToken purchase",
    predicate: seq(
      `${verb("bought", "buy")} a URIToken`,
      tx.Amount === undefined ? "" : [" for ", amountSegment(tx.Amount, native)],
    ),
    details: [
      ...fieldDetail(tx, "URITokenID", "URIToken ID"),
      ...(tx.Amount !== undefined ? [detail("Amount", amountSegment(tx.Amount, native))] : []),
      ...hookParameters(tx),
      ...closingDetails(tx, []),
    ],
  };
}

function describeURITokenCreateSellOffer({ tx, native, verb }: Input): Summary {
  return {
    title: "URIToken sell offer",
    predicate: seq(
      `${verb("offered", "offer")} a URIToken for sale`,
      tx.Destination === undefined ? "" : [" to ", account(tx.Destination)],
      tx.Amount === undefined ? "" : [" for ", amountSegment(tx.Amount, native)],
    ),
    details: [
      ...fieldDetail(tx, "URITokenID", "URIToken ID"),
      ...(tx.Amount !== undefined ? [detail("Amount", amountSegment(tx.Amount, native))] : []),
      ...(tx.Destination !== undefined ? [detail("Destination", account(tx.Destination))] : []),
      ...closingDetails(tx, []),
    ],
  };
}

function describeURITokenCancelSellOffer({ tx, verb }: Input): Summary {
  return {
    title: "URIToken sell offer cancellation",
    predicate: seq(`${verb("cancelled", "cancel")} the sale of a URIToken`),
    details: [...fieldDetail(tx, "URITokenID", "URIToken ID"), ...closingDetails(tx, [])],
  };
}

// --- Remit ---------------------------------------------------------------------------------------------------------

function describeRemit({ tx, native, verb }: Input): Summary {
  // `Amounts` is a list of `{ AmountEntry: { Amount } }`.
  const amounts = (Array.isArray(tx.Amounts) ? tx.Amounts : []).flatMap((entry) => {
    const amount = parseAmount((entry as { AmountEntry?: { Amount?: unknown } })?.AmountEntry?.Amount, native);
    return amount ? [amount] : [];
  });
  const tokens = (Array.isArray(tx.URITokenIDs) ? tx.URITokenIDs : []).map(String);
  const mints = tx.MintURIToken !== undefined;

  // What was remitted, in the order amounts, URITokens, a URIToken minted on the way.
  const items: Part[] = [
    ...amounts.map(amountOf),
    ...(tokens.length > 0 ? [plural(tokens.length, "URIToken")] : []),
    ...(mints ? ["a new URIToken"] : []),
  ];

  const mint = tx.MintURIToken as { URI?: unknown } | undefined;
  const details: Detail[] = [
    detail("Destination", account(tx.Destination)),
    ...fieldDetail(tx, "DestinationTag", "Destination tag"),
    ...amounts.map((amount, i) => detail(`Amount ${i + 1}`, amountOf(amount))),
    ...tokens.map((id, i) => detail(`URIToken ${i + 1}`, id)),
    ...(typeof mint?.URI === "string" ? [detail("Minted URI", decodeHex(mint.URI) ?? mint.URI)] : []),
    ...(tx.Inform !== undefined ? [detail("Inform", account(tx.Inform))] : []),
    ...closingDetails(tx, []),
  ];
  return {
    title: "Remit",
    predicate: seq(
      verb("remitted", "remit"),
      items.length > 0 ? [" ", listOf(items)] : "",
      " to ",
      account(tx.Destination),
    ),
    details,
  };
}

// --- Import --------------------------------------------------------------------------------------------------------

function describeImport({ tx, verb }: Input): Summary {
  const blob = byteSize(tx.Blob);
  return {
    title: "Import",
    predicate: seq(`${verb("imported", "import")} a transaction from another network`),
    details: [
      ...(tx.Issuer !== undefined ? [detail("Issuer", account(tx.Issuer))] : []),
      ...(blob === undefined ? [] : [detail("Blob", blob)]),
      ...closingDetails(tx, []),
    ],
  };
}

export const xahauHandlers: HandlerMap = {
  ClaimReward: describeClaimReward,
  SetHook: describeSetHook,
  Invoke: describeInvoke,
  URITokenMint: describeURITokenMint,
  URITokenBurn: describeURITokenBurn,
  URITokenBuy: describeURITokenBuy,
  URITokenCreateSellOffer: describeURITokenCreateSellOffer,
  URITokenCancelSellOffer: describeURITokenCancelSellOffer,
  Remit: describeRemit,
  Import: describeImport,
};
