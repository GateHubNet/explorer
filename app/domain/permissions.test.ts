import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { DelegationPermission } from "../server/api-types";
import { staticClosure, valueImports } from "../../test/support/value-imports";
import { permissionCount as leafCount, permissionTitle as leafTitle } from "./permission-chip";
import { GRANULAR_PERMISSIONS, permissionChip, permissionCount, permissionTitle } from "./permissions";

// The twelve granular permissions of xrpl.org's "Permission Values", as D5's table has them (data-api-new `feat/explorer-data-2` at 0c2e58c, packages/shared/src/parsers/permissions.ts,
// FINDINGS (7) of test/fixtures/xrpl/objects), with the board's words (the ledger-object pages' plan, Task 4).
const TABLE: ReadonlyArray<[value: number, name: string, transactionType: string, words: string]> = [
  [65537, "TrustlineAuthorize", "TrustSet", "Only authorizing trust lines, within TrustSet"],
  [65538, "TrustlineFreeze", "TrustSet", "Only freezing trust lines, within TrustSet"],
  [65539, "TrustlineUnfreeze", "TrustSet", "Only unfreezing trust lines, within TrustSet"],
  [65540, "AccountDomainSet", "AccountSet", "Only setting the domain, within AccountSet"],
  [65541, "AccountEmailHashSet", "AccountSet", "Only setting the email hash, within AccountSet"],
  [65542, "AccountMessageKeySet", "AccountSet", "Only setting the message key, within AccountSet"],
  [65543, "AccountTransferRateSet", "AccountSet", "Only setting the transfer rate, within AccountSet"],
  [65544, "AccountTickSizeSet", "AccountSet", "Only setting the tick size, within AccountSet"],
  [65545, "PaymentMint", "Payment", "Only payments that issue new tokens, within Payment"],
  [65546, "PaymentBurn", "Payment", "Only payments that return tokens to their issuer, within Payment"],
  [65547, "MPTokenIssuanceLock", "MPTokenIssuanceSet", "Only locking MPT balances, within MPTokenIssuanceSet"],
  [65548, "MPTokenIssuanceUnlock", "MPTokenIssuanceSet", "Only unlocking MPT balances, within MPTokenIssuanceSet"],
];

describe("GRANULAR_PERMISSIONS", () => {
  it("lists the twelve, 65537 to 65548, by value", () => {
    expect(GRANULAR_PERMISSIONS.map((p) => p.value)).toEqual(Array.from({ length: 12 }, (_, i) => 65537 + i));
  });

  it("has D5's name and transaction type for each value, and the board's words", () => {
    expect(GRANULAR_PERMISSIONS.map((p) => [p.value, p.name, p.transactionType, p.words])).toEqual(TABLE);
  });

  it("spells the email hash as xrpl.org does", () => {
    expect(GRANULAR_PERMISSIONS.find((p) => p.value === 65541)?.name).toBe("AccountEmailHashSet");
  });
});

describe("permissionChip", () => {
  it.each(TABLE)("says %i, %s, as a narrower right in the board's words", (value, name, _type, words) => {
    const chip = { name, kind: "granular", words, title: `Narrower right. ${words}` };
    expect(permissionChip(name)).toEqual(chip);
    expect(permissionChip(value)).toEqual(chip);
    expect(permissionChip(String(value))).toEqual(chip);
    expect(permissionChip({ permission: name, kind: "granular", transaction_type: _type })).toEqual(chip);
  });

  it("says another name is any transaction of that type", () => {
    const chip = { name: "Payment", kind: "transaction", words: "Any Payment transaction", title: "Transaction type. Any Payment transaction" };
    expect(permissionChip("Payment")).toEqual(chip);
    expect(permissionChip({ permission: "Payment", kind: "transaction" })).toEqual(chip);
    expect(permissionChip("OfferCreate")).toEqual({ name: "OfferCreate", kind: "transaction", words: "Any OfferCreate transaction", title: "Transaction type. Any OfferCreate transaction" });
  });

  it("says another number is a permission this explorer does not know, by its value", () => {
    const words = "A permission this explorer does not know (value 70001)";
    expect(permissionChip(70001)).toEqual({ name: "Permission 70001", kind: "unknown", words, title: words });
    expect(permissionChip(70001).name).toBe("Permission 70001");
    expect(permissionChip("70001")).toEqual({ name: "Permission 70001", kind: "unknown", words, title: words });
    expect(permissionChip({ permission: "70001", kind: "unknown" })).toEqual({ name: "Permission 70001", kind: "unknown", words, title: words });
    // The numbers next to the granular ones are not granular.
    expect([65536, 65549, 0].map((n) => permissionChip(n).kind)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("reads an API permission by its kind: a granular one this explorer lacks is not made a narrower right it cannot word", () => {
    const answered: DelegationPermission = { permission: "PaymentTeleport", kind: "granular", transaction_type: "Payment" };
    const words = "A permission this explorer does not know (value PaymentTeleport)";
    expect(permissionChip(answered)).toEqual({ name: "Permission PaymentTeleport", kind: "unknown", words, title: words });
  });

});

describe("the browser bundle", () => {
  // permissions.ts is drawn in the browser (the account page's Delegation tab): names and words only, no definitions. A sentence's chip needs only the leaf permission-chip.ts (the
  // view, the title, the count), so that Sentence, on every page that draws a sentence, does not carry the table of the granular permissions into its first JavaScript.
  const appDir = new URL("../", import.meta.url);

  it("loads no file but itself and the leaf, which imports nothing at run time", () => {
    expect(valueImports(readFileSync(new URL("domain/permissions.ts", appDir), "utf8"))).toEqual(["./permission-chip", "./permission-chip"]);
    expect(staticClosure(appDir, "domain/permissions.ts")).toEqual(["domain/permission-chip.ts", "domain/permissions.ts"]);
    expect(valueImports(readFileSync(new URL("domain/permission-chip.ts", appDir), "utf8"))).toEqual([]);
  });

  it("Sentence reaches the chip and the leaf, never the table", () => {
    const closure = staticClosure(appDir, "ui/components/Sentence.tsx");
    expect(closure).toEqual(expect.arrayContaining(["domain/permission-chip.ts", "ui/components/PermissionChip.tsx"]));
    expect(closure).not.toContain("domain/permissions.ts");
  });

  it("PermissionChip loads neither at run time: the view it draws is a type", () => {
    const closure = staticClosure(appDir, "ui/components/PermissionChip.tsx");
    expect(closure.filter((path) => path.startsWith("domain/permission"))).toEqual([]);
  });

  it("re-exports what the leaf has, so that a file of the Worker or of the Delegation tab can ask either", () => {
    expect(permissionTitle).toBe(leafTitle);
    expect(permissionCount).toBe(leafCount);
    expect(permissionCount(3)).toBe("3 of 10");
    expect([permissionTitle("transaction", "Any Payment transaction"), permissionTitle("granular", "Only x"), permissionTitle("unknown", "Unknown")]).toEqual([
      "Transaction type. Any Payment transaction",
      "Narrower right. Only x",
      "Unknown",
    ]);
  });
});
