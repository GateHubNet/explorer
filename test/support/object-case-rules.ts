// What makes an object of the fixtures (scripts/object-fixtures.ts) one of the cases the ledger-object pages and the delegation sentences draw: a predicate per case over the fixture
// files' data, never a table of IDs, so a change of the generator's seeds moves nothing here. Pure, no file reading, for Node and the Workers runtime alike: test/support/object-cases.ts
// finds the cases in the fixture files with these rules for the worker specs, and test/unit/object-fixtures.test.ts checks with the same rules that the generator writes every case.
// "First" is the first by ID (or hash) of those the rule takes.
//
//   escrow-pending        an escrow of the native currency that is `pending`
//   escrow-finishable     an escrow that `can_be_finished`
//   escrow-cancellable    an escrow of the native currency that `can_be_cancelled`, its creation indexed
//   escrow-finished       an escrow `finished`, its creation indexed (a whole history)
//   escrow-cancelled      an escrow `cancelled`, its creation indexed
//   escrow-token          an escrow of an issued token (an `issuer`, no `mpt_issuance_id`), its creation indexed
//   escrow-mpt            an escrow of an MPT
//   escrow-incomplete     an escrow `finished` whose creation is not indexed: `complete: false` and no `created` (C8)
//   escrow-node-only      an `Escrow` entry of the node that the index has no answer for
//   check-open            a check `open` of the native currency, its creation indexed
//   check-expired         a check `expired`
//   check-cashed          a check `cashed`
//   check-cancelled       a check `cancelled`
//   channel-open          a channel `open`, its creation indexed, with one page of history
//   channel-closing       a channel `closing` because it has an `expiration`, its creation indexed
//   channel-closed        a channel `closed`
//   channel-long          a channel with more than one page of history: `markers` are the history's, in order (the answer's `history_marker`, then each page's `marker`)
//   check-node-only       a `Check` entry of the node that the index has no answer for
//   xahau-escrow          an escrow of the native currency still in the ledger (asked of Xahau)
//   xahau-token-channel   a channel of an issued token (asked of Xahau)
//   delegated-payment     a successful `Payment` with a `Delegate` (C9: `id` is the transaction's hash, `owner` its `Account`)
//   delegated-tec         a `Payment` with a `Delegate` that failed with a `tec`
//   delegate-set-empty    a successful `DelegateSet` with no permissions: it deleted the delegation
//   delegate-set-failed   a `DelegateSet` that failed with a `tec`

import type { ObjectAmount, ObjectAnswer, ObjectApiKind, ObjectHistoryPage, TxObject } from "../../app/server/api-types";

export const OBJECT_CASES = [
  "escrow-pending",
  "escrow-finishable",
  "escrow-cancellable",
  "escrow-finished",
  "escrow-cancelled",
  "escrow-token",
  "escrow-mpt",
  "escrow-incomplete",
  "escrow-node-only",
  "check-open",
  "check-expired",
  "check-cashed",
  "check-cancelled",
  "channel-open",
  "channel-closing",
  "channel-closed",
  "channel-long",
  "check-node-only",
  "xahau-escrow",
  "xahau-token-channel",
  "delegated-payment",
  "delegated-tec",
  "delegate-set-empty",
  "delegate-set-failed",
] as const;
export type ObjectCase = (typeof OBJECT_CASES)[number];

/** What a case is: the object's ID (a transaction's hash for the delegation cases), its owner (the transaction's `Account`), its sequence, and the markers of its history's pages. */
export interface ObjectCaseResult {
  id: string;
  owner: string;
  sequence?: number;
  markers?: string[];
}

/** The fixture files' data the rules read. */
export interface ObjectSources {
  /** `data-api/{escrows,checks,payment_channels}/<ID>.json`, by ID. */
  answers: ReadonlyMap<string, { kind: ObjectApiKind; answer: ObjectAnswer }>;
  /** `…/<ID>/history@descending=true&limit=50&marker=<M>.json`, by ID and marker. */
  histories: ReadonlyMap<string, ReadonlyMap<string, ObjectHistoryPage>>;
  /** `node/ledger_entry/<ID>.json`: the node's entry, by ID. */
  nodes: ReadonlyMap<string, Record<string, unknown>>;
  /** `data-api/transactions/<HASH>.json` (not the binary forms): the transaction, by hash. */
  transactions: ReadonlyMap<string, TxObject>;
}

type Shown = { status: string; account: string; sequence?: number; created?: unknown; amount?: ObjectAmount; send_max?: ObjectAmount; expiration?: string };

const objectOf = (answer: ObjectAnswer): Shown =>
  ("escrow" in answer ? answer.escrow : "check" in answer ? answer.check : answer.payment_channel) as unknown as Shown;
const isNative = (amount: ObjectAmount | undefined): boolean => amount !== undefined && amount.issuer === undefined;
const isToken = (amount: ObjectAmount | undefined): boolean => amount?.issuer !== undefined && amount.mpt_issuance_id === undefined;
const IN_LEDGER = ["pending", "can_be_finished", "can_be_cancelled"];

/** The rule of each object case: the kind it is of, and what its answer must be. */
const ANSWER_RULES: Partial<Record<ObjectCase, { kind: ObjectApiKind; holds: (o: Shown, answer: ObjectAnswer) => boolean }>> = {
  "escrow-pending": { kind: "escrow", holds: (o) => o.status === "pending" && isNative(o.amount) },
  "escrow-finishable": { kind: "escrow", holds: (o) => o.status === "can_be_finished" },
  "escrow-cancellable": { kind: "escrow", holds: (o) => o.status === "can_be_cancelled" && isNative(o.amount) && o.created !== undefined },
  "escrow-finished": { kind: "escrow", holds: (o) => o.status === "finished" && o.created !== undefined },
  "escrow-cancelled": { kind: "escrow", holds: (o) => o.status === "cancelled" && o.created !== undefined },
  "escrow-token": { kind: "escrow", holds: (o) => isToken(o.amount) && o.created !== undefined },
  "escrow-mpt": { kind: "escrow", holds: (o) => o.amount?.mpt_issuance_id !== undefined },
  "escrow-incomplete": { kind: "escrow", holds: (o, answer) => o.status === "finished" && o.created === undefined && !answer.coverage.complete },
  "check-open": { kind: "check", holds: (o) => o.status === "open" && isNative(o.send_max) && o.created !== undefined },
  "check-expired": { kind: "check", holds: (o) => o.status === "expired" },
  "check-cashed": { kind: "check", holds: (o) => o.status === "cashed" },
  "check-cancelled": { kind: "check", holds: (o) => o.status === "cancelled" },
  "channel-open": { kind: "payment_channel", holds: (o, answer) => o.status === "open" && o.created !== undefined && answer.history_marker === undefined },
  "channel-closing": { kind: "payment_channel", holds: (o) => o.status === "closing" && o.expiration !== undefined && o.created !== undefined },
  "channel-closed": { kind: "payment_channel", holds: (o) => o.status === "closed" },
  "channel-long": { kind: "payment_channel", holds: (_o, answer) => answer.history_marker !== undefined },
  "xahau-escrow": { kind: "escrow", holds: (o) => IN_LEDGER.includes(o.status) && isNative(o.amount) },
  "xahau-token-channel": { kind: "payment_channel", holds: (o) => isToken(o.amount) },
};

/** The node-only cases: the entry type the node holds and the index has no answer for. */
const NODE_RULES: Partial<Record<ObjectCase, string>> = { "escrow-node-only": "Escrow", "check-node-only": "Check" };

/** The delegation cases: what the transaction is. */
const TX_RULES: Partial<Record<ObjectCase, (tx: TxObject) => boolean>> = {
  "delegated-payment": (tx) => tx.tx.TransactionType === "Payment" && typeof tx.tx.Delegate === "string" && tx.meta.TransactionResult === "tesSUCCESS",
  "delegated-tec": (tx) => tx.tx.TransactionType === "Payment" && typeof tx.tx.Delegate === "string" && tx.meta.TransactionResult.startsWith("tec"),
  "delegate-set-empty": (tx) =>
    tx.tx.TransactionType === "DelegateSet" && Array.isArray(tx.tx.Permissions) && tx.tx.Permissions.length === 0 && tx.meta.TransactionResult === "tesSUCCESS",
  "delegate-set-failed": (tx) => tx.tx.TransactionType === "DelegateSet" && tx.meta.TransactionResult.startsWith("tec"),
};

/** The markers of an object's history pages, in order: the answer's `history_marker`, then each page's `marker` behind it. */
export function historyMarkers(id: string, answer: ObjectAnswer, sources: ObjectSources): string[] {
  const markers: string[] = [];
  const pages = sources.histories.get(id);
  for (let marker = answer.history_marker; marker !== undefined; marker = pages?.get(marker)?.marker) {
    if (markers.includes(marker)) break;
    markers.push(marker);
  }
  return markers;
}

/** The object or transaction of `which`, or `undefined` when the files hold none. */
export function resolveObjectCase(which: ObjectCase, sources: ObjectSources): ObjectCaseResult | undefined {
  const rule = ANSWER_RULES[which];
  if (rule !== undefined) {
    const id = [...sources.answers.keys()].sort().find((each) => {
      const { kind, answer } = sources.answers.get(each)!;
      return kind === rule.kind && rule.holds(objectOf(answer), answer);
    });
    if (id === undefined) return undefined;
    const { answer } = sources.answers.get(id)!;
    const object = objectOf(answer);
    const markers = historyMarkers(id, answer, sources);
    return { id, owner: object.account, ...(object.sequence !== undefined && { sequence: object.sequence }), ...(markers.length > 0 && { markers }) };
  }
  const type = NODE_RULES[which];
  if (type !== undefined) {
    const id = [...sources.nodes.keys()].sort().find((each) => sources.nodes.get(each)!.LedgerEntryType === type && !sources.answers.has(each));
    if (id === undefined) return undefined;
    const node = sources.nodes.get(id)!;
    return { id, owner: String(node.Account), ...(typeof node.Sequence === "number" && { sequence: node.Sequence }) };
  }
  const holds = TX_RULES[which]!;
  const hash = [...sources.transactions.keys()].sort().find((each) => holds(sources.transactions.get(each)!));
  return hash === undefined ? undefined : { id: hash, owner: String(sources.transactions.get(hash)!.tx.Account) };
}
