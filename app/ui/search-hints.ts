// What the search box offers as you type, from what `classify` says the input is (spec 6). Pure. The links go straight to
// the page when the input says where it belongs (a ledger index, an address) and through `/{net}/search` when only the
// server can say (a hash may be a transaction or a ledger; a CTID may be on the other network).

import { formatAmount } from "../domain/format";
import { hashWhat } from "../domain/hash-nouns";
import type { SearchKind } from "../domain/search";
import type { NetworkId } from "../server/networks";

export interface Hint {
  /** What it is, as a label: `Ledger`, `Account`. */
  kind: string;
  /** The thing itself: `#107,695,660`, an address, a hash. */
  detail: string;
  href: string;
}

const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * What the box says of an input. With `nfts` (the `NFTS` switch, which `SearchBox` reads with `useFeatures()`) a 64-digit hash can be an NFT too: "Transaction, ledger or NFT" ("… or
 * URIToken" on Xahau). The nouns are `hashWhat` (app/domain/hash-nouns.ts, the list every word of the search uses), whose token's word is `nftWords(net).token`
 * (app/domain/nft-params.ts), written there because the box is on every page and that file is the NFT pages' (a test holds the two together).
 */
export function hintsFor(found: SearchKind, net: NetworkId, opts: { nfts?: boolean } = {}): Hint[] {
  switch (found.kind) {
    case "ledger-index":
      return [{ kind: "Ledger", detail: `#${formatAmount(String(found.index))}`, href: `/${net}/ledger/${found.index}` }];
    case "hash":
      return [{ kind: capitalized(hashWhat(net, { nfts: opts.nfts === true })), detail: found.hash, href: `/${net}/search?q=${found.hash}` }];
    case "ctid":
      return [{ kind: "Transaction", detail: `CTID ${found.ctid}`, href: `/${net}/search?q=${found.ctid}` }];
    case "account": {
      const tagged = found.tag !== undefined;
      return [
        {
          kind: "Account",
          detail: tagged ? `${found.address} · tag ${found.tag}` : found.address,
          href: `/${net}/account/${found.address}${tagged ? `?tag=${found.tag}` : ""}`,
        },
      ];
    }
    case "none":
      return [];
  }
}
