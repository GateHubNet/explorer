// What the account page's Delegation tab shows (ledger object pages spec 6.1), worked out in the Worker from the two pages of D5's delegations: the ones the account gave and the ones it
// holds. The page gets rows of strings, numbers and chips (never the API's JSON), so it needs nothing of the API's types. No I/O.

import { DELEGATIONS_WORD } from "../domain/account-tabs";
import { permissionChip, permissionCount, type PermissionChipView } from "../domain/permissions";
import type { Delegation, DelegationsPage } from "./api-types";
import { coverageNote, type CoverageNoteText } from "./coverage";
import { unixOf } from "./validator-facts";

/**
 * A delegation, a row of the list it is in. `account` is the other account: the delegate (`authorize`) in the list of the delegations the account gave, and the account that gave the
 * permissions (`account`) in the list of those it holds. `tx`, `ledger` and `time` are where the delegation was last set (`updated`), the time as unix seconds: the page writes it, and
 * a stored page is the same at any age.
 */
export interface DelegationRow {
  /** The delegation's ID: the row's own key. */
  key: string;
  account: string;
  permissions: PermissionChipView[];
  /** How many of the most there can be: "3 of 10". */
  count: string;
  tx: string;
  ledger: number;
  time: number;
}

/** One list of the tab: its rows in the API's order (the one changed last first), whether the API had more than the page holds, and the note when the index does not hold the whole history. */
export interface DelegationList {
  rows: DelegationRow[];
  more: boolean;
  coverage: CoverageNoteText | null;
}

function rowOf(delegation: Delegation, other: "account" | "authorize"): DelegationRow {
  return {
    key: delegation.delegation_id,
    account: delegation[other],
    permissions: delegation.permissions.map(permissionChip),
    count: permissionCount(delegation.permissions.length),
    tx: delegation.updated.tx_hash,
    ledger: delegation.updated.ledger_index,
    time: unixOf(delegation.updated.time),
  };
}

function listOf(page: DelegationsPage, other: "account" | "authorize"): DelegationList {
  return {
    rows: page.delegations.map((delegation) => rowOf(delegation, other)),
    // The API's marker is its word that there are more than the page holds (no totals).
    more: page.marker !== undefined,
    coverage: coverageNote(page.coverage, DELEGATIONS_WORD),
  };
}

/** The tab's two lists, from the page of the delegations the account gave (`given`: the delegates are the other accounts) and of those it holds (`held`: the accounts that gave them are). */
export function delegationLists(given: DelegationsPage, held: DelegationsPage): { given: DelegationList; held: DelegationList } {
  return { given: listOf(given, "authorize"), held: listOf(held, "account") };
}
