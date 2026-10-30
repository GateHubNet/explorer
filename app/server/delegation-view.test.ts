import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DELEGATE, DELEGATION_ID, DELEGATOR, delegationsSample } from "../../test/support/object-samples";
import type { Delegation, DelegationsPage } from "./api-types";
import { delegationLists } from "./delegation-view";

// The rows of the Delegation tab (ledger object pages spec 6.1), from the recorded delegations of the active XRPL account (three given, two held: the board's) and from pages the
// recordings do not hold (an unknown permission, a marker, a coverage that starts late).

const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const fixture = (direction: "given" | "held"): DelegationsPage =>
  JSON.parse(readFileSync(new URL(`../../test/fixtures/http/xrpl/data-api/accounts/${ACTIVE}/delegations@direction=${direction}&limit=200.json`, import.meta.url), "utf8")) as DelegationsPage;

/** A delegation `DELEGATOR` gave `DELEGATE` with these permissions, over the sample's. */
const delegation = (over: Partial<Delegation> = {}): Delegation => ({ ...delegationsSample().delegations[0]!, ...over });

const unix = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +iso.slice(11, 13), +iso.slice(14, 16), +iso.slice(17, 19)) / 1000;

describe("delegationLists", () => {
  it("rows: chips, 3 of 10, the granting transaction and its time", () => {
    const { given, held } = delegationLists(fixture("given"), fixture("held"));

    expect(given.rows).toHaveLength(3);
    expect(held.rows).toHaveLength(2);
    // A given row is the delegate (the account that may send), in the API's order: the one changed last first.
    expect(given.rows.map((row) => row.account)).toEqual(["rGCMDQCMGueT8HTcKL3j7cA9aJ7qfX92GW", "rneMZ5XxbdDi9oaNFNsR6ZQPEyugUjn4VY", "r43VwKWSW5mAVAxJpSk4UNUkRwx7HVt3Yn"]);
    const [first, second, third] = given.rows;
    expect(first!.permissions.map((chip) => [chip.name, chip.kind])).toEqual([
      ["Payment", "transaction"],
      ["TrustlineAuthorize", "granular"],
      ["TrustlineFreeze", "granular"],
    ]);
    // The chip is `permissionChip`'s whole: the words and the tooltip too.
    expect(first!.permissions[1]).toEqual({
      name: "TrustlineAuthorize",
      kind: "granular",
      words: "Only authorizing trust lines, within TrustSet",
      title: "Narrower right. Only authorizing trust lines, within TrustSet",
    });
    expect(first!.permissions[0]!.title).toBe("Transaction type. Any Payment transaction");
    expect([first!.count, second!.count, third!.count]).toEqual(["3 of 10", "8 of 10", "3 of 10"]);
    // Granted in: the transaction that last set the delegation, its ledger, and its time as unix seconds (never an age).
    expect(first).toMatchObject({
      key: "041F102BEEE0B4DC4578BDC0F32FCB08BE1F85DBF6A1ECD44522D8F2643F0522",
      tx: "3E76B7DF382BBD6B33DC0874F69F796C3360FCDBED6FE43FB8C5A39269A33FD4",
      ledger: 107652633,
      time: unix("2026-10-14T16:03:22Z"),
    });

    // A held row is the account that gave the permissions, on whose behalf this one may send.
    expect(held.rows.map((row) => row.account)).toEqual(["rwzUz9i822B3MGRnogyQkJFu3zWc6HYek1", "r4CxvmYahDYfTjxCo5YNu6YsLUo6eTFzbX"]);
    expect(held.rows.map((row) => row.count)).toEqual(["1 of 10", "3 of 10"]);
    expect(held.rows[0]!.permissions.map((chip) => chip.name)).toEqual(["Payment"]);
    expect(held.rows[1]!.permissions.map((chip) => chip.name)).toEqual(["TrustSet", "OfferCreate", "OfferCancel"]);
  });

  it("counts the permissions of a delegation that has the most there can be, and keeps their order", () => {
    const names = ["Payment", "TrustSet", "OfferCreate", "OfferCancel", "AccountSet", "EscrowCreate", "EscrowFinish", "CheckCreate", "CheckCash", "CheckCancel"];
    const permissions = names.map((permission) => ({ permission, kind: "transaction" as const }));
    const { given } = delegationLists(delegationsSample({ delegations: [delegation({ permissions })] }), delegationsSample({ delegations: [] }));
    expect(given.rows[0]!.count).toBe("10 of 10");
    expect(given.rows[0]!.permissions.map((chip) => chip.name)).toEqual(names);
  });

  it("keys a row by its delegation, and draws the delegate of a given row and the delegator of a held one", () => {
    const { given, held } = delegationLists(delegationsSample(), delegationsSample());
    expect(given.rows.map((row) => [row.key, row.account])).toEqual([[DELEGATION_ID, DELEGATE]]);
    expect(held.rows.map((row) => [row.key, row.account])).toEqual([[DELEGATION_ID, DELEGATOR]]);
  });

  it("shows an unknown permission as Permission 70001", () => {
    const unknown = delegation({ permissions: [{ permission: "70001", kind: "unknown" }, { permission: "Payment", kind: "transaction" }] });
    const { given } = delegationLists(delegationsSample({ delegations: [unknown] }), delegationsSample({ delegations: [] }));
    expect(given.rows[0]!.permissions[0]).toMatchObject({ name: "Permission 70001", kind: "unknown" });
    expect(given.rows[0]!.permissions[1]).toMatchObject({ name: "Payment", kind: "transaction" });
    // A granular permission this explorer has no words for is unknown too, not worded by guess.
    const odd = delegation({ permissions: [{ permission: "MadeUpRight", kind: "granular", transaction_type: "Payment" }] });
    expect(delegationLists(delegationsSample({ delegations: [odd] }), delegationsSample()).given.rows[0]!.permissions[0]).toMatchObject({ name: "Permission MadeUpRight", kind: "unknown" });
  });

  it("says more when the API gave a marker, and carries the coverage note when not complete", () => {
    const whole = delegationLists(delegationsSample(), delegationsSample());
    expect(whole.given).toMatchObject({ more: false, coverage: null });
    expect(whole.held).toMatchObject({ more: false, coverage: null });

    const more = delegationLists(delegationsSample({ marker: "WzEwNzk0NTQzOCw5OF0" }), delegationsSample());
    expect(more.given.more).toBe(true);
    // Each list says its own: the other page had no marker.
    expect(more.held.more).toBe(false);

    const late = delegationLists(
      delegationsSample({ coverage: { complete: false, from_ledger_index: 102145584 } }),
      delegationsSample({ coverage: { complete: false } }),
    );
    expect(late.given.coverage).toEqual({ before: "Covers ledger ", ledger: 102145584, after: " onwards: earlier delegations are not in the index yet." });
    expect(late.held.coverage).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
  });

  it("is an empty list for a page with no delegations, whose coverage still shows", () => {
    const empty = delegationsSample({ count: 0, delegations: [], coverage: { complete: false, from_ledger_index: 102145584 } });
    const { given, held } = delegationLists(empty, delegationsSample({ count: 0, delegations: [] }));
    expect(given.rows).toEqual([]);
    expect(given.coverage).not.toBeNull();
    expect(held).toEqual({ rows: [], more: false, coverage: null });
  });
});
