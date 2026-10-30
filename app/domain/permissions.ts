// The permissions of a delegation (XLS-75) in words: the names and the words only, never the transaction definitions (which are the Worker's and large), so that the account page, which
// draws a sentence about a delegation, can load this. Pure: no import at run time.
//
// A permission is a transaction type's name (its right to send any transaction of that type), or one of the 12 granular permissions of xrpl.org's "Permission Values" (read 2026-10-29,
// FINDINGS (7) of D5's test/fixtures/xrpl/objects), which narrow one type to a part of what it can do, or a number this explorer does not know. D5 (data-api-new `feat/explorer-data-2`
// at 0c2e58c, packages/shared/src/parsers/permissions.ts) keeps the same table and tells the three apart (`kind`); an API `DelegationPermission` is read by its `permission` and `kind`.

import type { DelegationPermission } from "../server/api-types";

/** A granular permission: it lets the delegate send only the part of a transaction type that its name says. */
export interface GranularPermission {
  name: string;
  value: number;
  /** The type of transaction the permission narrows. */
  transactionType: string;
  /** What it lets the delegate do, in words. */
  words: string;
}

/**
 * The 12 granular permissions, by value, with the words the delegation tab draws. Note the spelling `AccountEmailHashSet`. The values are consecutive, from 65537
 * (`TrustlineAuthorize`) to 65548 (`MPTokenIssuanceUnlock`).
 */
export const GRANULAR_PERMISSIONS: readonly GranularPermission[] = [
  { name: "TrustlineAuthorize", value: 65537, transactionType: "TrustSet", words: "Only authorizing trust lines, within TrustSet" },
  { name: "TrustlineFreeze", value: 65538, transactionType: "TrustSet", words: "Only freezing trust lines, within TrustSet" },
  { name: "TrustlineUnfreeze", value: 65539, transactionType: "TrustSet", words: "Only unfreezing trust lines, within TrustSet" },
  { name: "AccountDomainSet", value: 65540, transactionType: "AccountSet", words: "Only setting the domain, within AccountSet" },
  { name: "AccountEmailHashSet", value: 65541, transactionType: "AccountSet", words: "Only setting the email hash, within AccountSet" },
  { name: "AccountMessageKeySet", value: 65542, transactionType: "AccountSet", words: "Only setting the message key, within AccountSet" },
  { name: "AccountTransferRateSet", value: 65543, transactionType: "AccountSet", words: "Only setting the transfer rate, within AccountSet" },
  { name: "AccountTickSizeSet", value: 65544, transactionType: "AccountSet", words: "Only setting the tick size, within AccountSet" },
  { name: "PaymentMint", value: 65545, transactionType: "Payment", words: "Only payments that issue new tokens, within Payment" },
  { name: "PaymentBurn", value: 65546, transactionType: "Payment", words: "Only payments that return tokens to their issuer, within Payment" },
  { name: "MPTokenIssuanceLock", value: 65547, transactionType: "MPTokenIssuanceSet", words: "Only locking MPT balances, within MPTokenIssuanceSet" },
  { name: "MPTokenIssuanceUnlock", value: 65548, transactionType: "MPTokenIssuanceSet", words: "Only unlocking MPT balances, within MPTokenIssuanceSet" },
];

/** What a chip of a permission draws: the `name` it is labelled with, its `kind`, the `words` that say what it allows and the `title` (the tooltip: the kind of right, then the words). */
export interface PermissionChipView {
  name: string;
  kind: "transaction" | "granular" | "unknown";
  words: string;
  title: string;
}

/** A permission this explorer does not know, by what it was given as: a number, or a name the data API called granular but this table lacks. */
function unknownPermission(value: string): PermissionChipView {
  const words = `A permission this explorer does not know (value ${value})`;
  return { name: `Permission ${value}`, kind: "unknown", words, title: words };
}

/** One of the 12, by the name or value it is given as. */
function granularView(granular: GranularPermission): PermissionChipView {
  return { name: granular.name, kind: "granular", words: granular.words, title: `Narrower right. ${granular.words}` };
}

/** A transaction type's name: the right to send any transaction of that type. */
function transactionView(name: string): PermissionChipView {
  const words = `Any ${name} transaction`;
  return { name, kind: "transaction", words, title: `Transaction type. ${words}` };
}

/**
 * A permission as a chip says it. A granular name or value (a number, or a string of digits) is its words as a narrower right; any other name is a transaction type; any other number is
 * a permission this explorer does not know (it cannot tell a transaction type's code, which is the Worker's definitions). An API `DelegationPermission` is read by its `permission` and
 * its `kind`: `granular` is looked up by name (one this table lacks is unknown, not worded by guess), `transaction` is the name of a type, and `unknown` is the number.
 */
export function permissionChip(value: string | number | DelegationPermission): PermissionChipView {
  if (typeof value === "object") {
    if (value.kind === "transaction") return transactionView(value.permission);
    const granular = value.kind === "granular" ? GRANULAR_PERMISSIONS.find((each) => each.name === value.permission) : undefined;
    return granular !== undefined ? granularView(granular) : unknownPermission(value.permission);
  }
  const text = String(value);
  const granular = GRANULAR_PERMISSIONS.find((each) => each.name === text || String(each.value) === text);
  if (granular !== undefined) return granularView(granular);
  return typeof value === "number" || /^\d+$/.test(text) ? unknownPermission(text) : transactionView(text);
}
