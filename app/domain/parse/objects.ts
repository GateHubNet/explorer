import { isMptIssuanceId, mptIdOf } from "../mpt-id";
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
 * The issuance an `MPToken` or an `MPTokenIssuance` node is about, as its ID in capitals: an `MPToken` holds it (`MPTokenIssuanceID`), an `MPTokenIssuance` is made of it (`mptIdOf` of its
 * `Sequence` and `Issuer`). `undefined` for any other node, and for one whose fields make no ID: a ledger's text is not trusted to be well formed.
 */
export function mptIdOfNode({ type, fields }: Pick<Node, "type" | "fields">): string | undefined {
  if (type === "MPToken") return isMptIssuanceId(fields.MPTokenIssuanceID) ? fields.MPTokenIssuanceID.toUpperCase() : undefined;
  if (type !== "MPTokenIssuance" || typeof fields.Sequence !== "number" || typeof fields.Issuer !== "string") return undefined;
  try {
    return mptIdOf(fields.Sequence, fields.Issuer);
  } catch {
    return undefined;
  }
}

/**
 * The ledger entries a transaction created, modified or deleted, in the order of the metadata. `account` is the
 * entry's `Account`, or, for entries that have only an owner (directories, NFT offers, URITokens), its `Owner`, or an
 * issuance's `Issuer`; entries with none (trust lines, which have two parties) leave it out. An `MPToken` or an
 * `MPTokenIssuance` carries the ID of its issuance as `mpt`.
 */
export function objectsTouched(meta: TxMeta): TouchedObject[] {
  return nodesOf(meta).map((node) => {
    const { change, type, index, fields } = node;
    const touched: TouchedObject = { change, type, index };
    const account = fields.Account ?? fields.Owner ?? (type === "MPTokenIssuance" ? fields.Issuer : undefined);
    if (typeof account === "string") touched.account = account;
    const mpt = mptIdOfNode(node);
    if (mpt !== undefined) touched.mpt = mpt;
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
