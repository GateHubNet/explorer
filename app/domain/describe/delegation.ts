// DelegateSet (XLS-75): an account lets another, its delegate, send some kinds of transaction on its behalf, or takes every permission back with an empty list. Each permission is a
// `permission` segment, which the page draws as a chip (ledger object pages spec 6.2).

import { permissionChip, permissionCount } from "../permissions";
import { account, closingDetails, detail, listOf, seq, type Part } from "./helpers";
import type { HandlerMap, Input, Segment, Summary } from "./types";

/** An entry of the list that is not a permission this explorer can read: a chip of its own, so that it is counted and the list is not taken for an empty one. */
const UNREADABLE: Segment = { t: "permission", name: "Unreadable permission", kind: "unknown", words: "Unreadable permission" };

/**
 * The permissions of a `DelegateSet` (`Permissions[].Permission.PermissionValue`: a transaction type's or a granular permission's name, or a number), each as `permissionChip` says it.
 * An entry without a value it can read is `UNREADABLE`; only a list with no entry is empty (a field that is not a list is one entry).
 */
function permissionsOf(raw: unknown): Segment[] {
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((entry: unknown): Segment => {
    const permission = typeof entry === "object" && entry !== null ? (entry as { Permission?: unknown }).Permission : undefined;
    const value = typeof permission === "object" && permission !== null ? (permission as { PermissionValue?: unknown }).PermissionValue : undefined;
    if (typeof value !== "string" && typeof value !== "number") return { ...UNREADABLE };
    const { name, kind, words } = permissionChip(value);
    return { t: "permission", name, kind, words };
  });
}

/**
 * "{account} let {authorize} send Payment, TrustlineAuthorize and TrustlineFreeze on its behalf", with the note that the list replaces the one before; with an empty list "{account}
 * removed every permission it had given {authorize}". A failure reads "tried to let …" / "tried to remove …", and has no note: nothing was replaced.
 */
function describeDelegateSet({ tx, ok, verb }: Input): Summary {
  const permissions = permissionsOf(tx.Permissions);
  const authorize = account(tx.Authorize);
  const chips: Part[] = permissions.flatMap((chip, i) => (i === 0 ? [chip] : [" ", chip]));
  const summary: Summary = {
    title: "Delegation",
    predicate:
      permissions.length > 0
        ? seq(`${verb("let", "let")} `, authorize, " send ", listOf(permissions), " on its behalf")
        : seq(`${verb("removed", "remove")} every permission it had given `, authorize),
    details: [
      detail("Delegate", authorize),
      detail("Permissions", chips, permissions.length > 0 ? " · " : "", permissionCount(permissions.length)),
      ...closingDetails(tx, []),
    ],
  };
  if (ok && permissions.length > 0) {
    summary.note = seq("This replaces any permissions ", account(tx.Account), " had given ", authorize, " before; it does not add to them.");
  }
  return summary;
}

export const delegationHandlers: HandlerMap = {
  DelegateSet: describeDelegateSet,
};
