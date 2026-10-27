import { nodesOf } from "./objects";
import type { TxMeta } from "./types";

/** The `NFTokenID`s of a page's `NFTokens` array, in upper case; an entry that has none is left out. */
function pageIds(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) return [];
  const ids: string[] = [];
  for (const entry of tokens) {
    const id = (entry as { NFToken?: { NFTokenID?: unknown } } | null | undefined)?.NFToken?.NFTokenID;
    if (typeof id === "string") ids.push(id.toUpperCase());
  }
  return ids;
}

/**
 * The ids added over the union of the transaction's `NFTokenPage` diffs (D3's rule, §2.1): an `NFTokenMint`'s NFT. The ids of
 * all the pages are compared, never page by page, as pages split and merge: an id is minted when a page holds it afterwards
 * and none held it before. A page held, before, its `PreviousFields.NFTokens` when it has them, else its `NFTokens` (a page whose
 * tokens did not change, such as the neighbour of a split that only changed a link, held what it holds); a created page held
 * nothing, and a deleted one holds nothing afterwards. In the order the pages come in the metadata.
 */
export function mintedNftIds(meta: TxMeta): string[] {
  const before = new Set<string>();
  const after = new Set<string>();
  for (const node of nodesOf(meta)) {
    if (node.type !== "NFTokenPage") continue;
    if (node.change !== "deleted") for (const id of pageIds(node.fields.NFTokens)) after.add(id);
    if (node.change !== "created") for (const id of pageIds(node.previous.NFTokens ?? node.fields.NFTokens)) before.add(id);
  }
  return [...after].filter((id) => !before.has(id));
}

/**
 * The NFT of the offer an `NFTokenAcceptOffer` accepted or, when it failed, of the expired offer it deleted (a `tecEXPIRED` accept
 * deletes the expired offer): the `NFTokenID` of the deleted `NFTokenOffer`. A brokered sale deletes two offers, which are for the same
 * NFT. `undefined` when no offer was deleted, or the deleted offers are for more than one NFT.
 */
export function acceptedNftId(meta: TxMeta): string | undefined {
  const ids = new Set<string>();
  for (const node of nodesOf(meta)) {
    if (node.change !== "deleted" || node.type !== "NFTokenOffer") continue;
    const id = node.fields.NFTokenID;
    if (typeof id === "string") ids.add(id.toUpperCase());
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}

/** The index of a created `URIToken` (its id, as the entry's key): a `URITokenMint`'s, or a `Remit`'s `MintURIToken`'s. */
export function createdUriTokenIds(meta: TxMeta): string[] {
  return nodesOf(meta)
    .filter((node) => node.change === "created" && node.type === "URIToken")
    .map((node) => node.index.toUpperCase());
}
