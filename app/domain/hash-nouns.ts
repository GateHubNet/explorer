// What a 64-hexadecimal search can be, as the nouns the words around the search use ("transaction, ledger or NFT"). One list for the places that say it: the search's 404 and its
// 503, the page that helps when nothing was typed, the box's hint of a hash and its "Nothing … looks like that". Pure and safe for the browser: the search box is on every page, so this
// file imports nothing but a type. The order is the order the search asks (`findHash`, app/server/resolve.ts): E10 adds the ledger objects after the NFT and its switch to `HashNounOptions`
// (the same name `HashQuestions` gives it), and a shape of another length (E14's 48-hex MPT id) is no noun of this list: it is a question of its own, with its own words.

import type { NetworkId } from "../server/networks";

/** What the search asks of a hash, by switch: the names are the questions' (`HashQuestions`, app/server/resolve.ts). */
export interface HashNounOptions {
  /** `NFTS`: while off no NFT question is asked, so a hash is never said to be one. */
  nfts: boolean;
}

/** What a 64-hexadecimal search can find on `net`, in the order it asks: `["transaction", "ledger"]`, with `NFTS` on `["transaction", "ledger", "NFT"]` (Xahau's "URIToken"). */
export function hashNouns(net: NetworkId, options: HashNounOptions): string[] {
  return ["transaction", "ledger", ...(options.nfts ? [net === "xahau" ? "URIToken" : "NFT"] : [])];
}

/** The nouns as a list of a sentence: "transaction", "transaction or ledger", "transaction, ledger or NFT". */
export function joinNouns(nouns: readonly string[]): string {
  if (nouns.length === 0) return "";
  const last = nouns[nouns.length - 1]!;
  return nouns.length === 1 ? last : `${nouns.slice(0, -1).join(", ")} or ${last}`;
}

/** What a hash can be on `net`, as the words use it: "transaction or ledger" while `NFTS` is off, "transaction, ledger or NFT" ("… or URIToken") while it is on. */
export function hashWhat(net: NetworkId, options: HashNounOptions): string {
  return joinNouns(hashNouns(net, options));
}
