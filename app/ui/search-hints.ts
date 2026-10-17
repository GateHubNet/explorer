// What the search box offers as you type, from what `classify` says the input is (spec 6). Pure. The links go straight to
// the page when the input says where it belongs (a ledger index, an address) and through `/{net}/search` when only the
// server can say (a hash may be a transaction or a ledger; a CTID may be on the other network).

import { formatAmount } from "../domain/format";
import type { SearchKind } from "../domain/search";
import type { NetworkId } from "../server/networks";

export interface Hint {
  /** What it is, as a label: `Ledger`, `Account`. */
  kind: string;
  /** The thing itself: `#107,695,660`, an address, a hash. */
  detail: string;
  href: string;
}

export function hintsFor(found: SearchKind, net: NetworkId): Hint[] {
  switch (found.kind) {
    case "ledger-index":
      return [{ kind: "Ledger", detail: `#${formatAmount(String(found.index))}`, href: `/${net}/ledger/${found.index}` }];
    case "hash":
      return [{ kind: "Transaction or ledger", detail: found.hash, href: `/${net}/search?q=${found.hash}` }];
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
