import type { AffectedNode, AffectedNodeBody, TouchedObject, TxMeta } from "./types";

type Change = TouchedObject["change"];

/** One entry of `meta.AffectedNodes`, flattened. */
export type Node = {
  change: Change;
  /** The ledger entry type. */
  type: string;
  /** The entry's key in the ledger. */
  index: string;
  /** `NewFields` of a created node, else `FinalFields`: the entry after the transaction (as it was, if deleted). */
  fields: Record<string, unknown>;
  /** `PreviousFields`: the fields the transaction changed, as they were before it. */
  previous: Record<string, unknown>;
};

function flatten(affected: AffectedNode): Node {
  const [change, body]: [Change, AffectedNodeBody] =
    "CreatedNode" in affected
      ? ["created", affected.CreatedNode]
      : "ModifiedNode" in affected
        ? ["modified", affected.ModifiedNode]
        : ["deleted", affected.DeletedNode];
  return {
    change,
    type: body.LedgerEntryType,
    index: body.LedgerIndex,
    fields: (change === "created" ? body.NewFields : body.FinalFields) ?? {},
    previous: body.PreviousFields ?? {},
  };
}

/** The nodes of a transaction's metadata, in the order the metadata has them. */
export function nodesOf(meta: TxMeta): Node[] {
  return (meta.AffectedNodes ?? []).map(flatten);
}

/**
 * The ledger entries a transaction created, modified or deleted, in the order of the metadata. `account` is the
 * entry's `Account`, or, for entries that have only an owner (directories, NFT offers, URITokens), its `Owner`;
 * entries with neither (trust lines, which have two parties) leave it out.
 */
export function objectsTouched(meta: TxMeta): TouchedObject[] {
  return nodesOf(meta).map(({ change, type, index, fields }) => {
    const touched: TouchedObject = { change, type, index };
    const account = fields.Account ?? fields.Owner;
    if (typeof account === "string") touched.account = account;
    return touched;
  });
}

/** Whether a node is the `AccountRoot` of an AMM pool: only those carry `AMMID`. */
export function isPoolAccountRoot(node: Node): boolean {
  return node.type === "AccountRoot" && "AMMID" in node.fields;
}

/**
 * The accounts a transaction created: its created `AccountRoot` nodes, in the order of the metadata, except an
 * AMM's pseudo-account (the one an `AMMCreate` makes, which has `AMMID`): nobody opened it, and the data API
 * does not count it as a created account either.
 */
export function accountsCreated(meta: TxMeta): string[] {
  const accounts: string[] = [];
  for (const node of nodesOf(meta)) {
    if (node.change !== "created" || node.type !== "AccountRoot" || isPoolAccountRoot(node)) continue;
    if (typeof node.fields.Account === "string") accounts.push(node.fields.Account);
  }
  return accounts;
}
