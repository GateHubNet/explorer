// What makes an NFT of the fixtures (scripts/nft-fixtures.ts) one of the cases the NFT pages draw: a predicate per case over the fixture files' data, never a table of ids, so a
// change of the generator's seeds moves nothing here. Pure, no file reading, for Node and the Workers runtime alike: test/support/nft-cases.ts finds the cases in the fixture
// files with these rules for the worker specs, and test/unit/nft-fixtures.test.ts checks with the same rules that the generator writes every case, so the two cannot part ways.
//
//   featured         the NFT with a second page of history: the one the history's pager and `marker` are drawn from
//   burned           an NFT burned by its owner, the one with the shortest history (XRPL: the burn alone; Xahau: the burn that removed the token's offer)
//   unowned          an NFT the index holds without an owner (no indexed event names one), that the node knows: the owner is "read from the network"
//   network          an NFT the index lacks and the node has (Clio's `nft_info`, a Xahau `ledger_entry`)
//   network-burned   an NFT the index lacks and the node says is burned (XRPL only: a burned URIToken is no ledger entry)
//   missing          an id of the shape of the collection's ids that neither the index nor the node has

import { decodeAccountID } from "ripple-address-codec";

import type { NftAnswer, NftEventsPage, NftsPage } from "../../app/server/api-types";
import type { NetworkName } from "./upstream-core";

export const NFT_CASES = ["featured", "burned", "unowned", "network", "network-burned", "missing"] as const;
export type NftCase = (typeof NFT_CASES)[number];

/** What a case is: the id, and what the NFT's collection is made of (an XRPL id has a serial and a taxon, a Xahau token only an issuer). */
export interface NftCaseResult {
  id: string;
  serial?: number;
  issuer: string;
  taxon?: number;
}

/** What the node's NFT files hold of an NFT, as far as the cases read it: `nft_info` (Clio, XRPL) or the `URIToken` entry of `ledger_entry` (Xahau). */
export interface NodeNft {
  issuer: string;
  taxon?: number;
  serial?: number;
  burned: boolean;
}

/** The fixture files' data the rules read, by NFT id (upper case) or account. */
export interface NftSources {
  /** `data-api/nfts/<ID>.json`: the index's answer for each NFT. */
  nfts: ReadonlyMap<string, NftAnswer>;
  /** `data-api/nfts/<ID>/history@descending=true&limit=20.json`: the first page of each NFT's whole history. */
  histories: ReadonlyMap<string, NftEventsPage>;
  /** The NFTs that have a page of history behind a marker (`…&marker=<M>.json`). */
  pagedHistories: ReadonlySet<string>;
  /** `node/nft_info/<ID>.json` and `node/ledger_entry/<ID>.json`. */
  node: ReadonlyMap<string, NodeNft>;
  /** `data-api/accounts/<ADDRESS>/nfts@limit=20.json`: what each account holds. */
  holdings: ReadonlyMap<string, NftsPage>;
}

/**
 * An XRPL NFT id from the fields it encodes: `Flags (2) | TransferFee (2) | Issuer (20) | scrambled Taxon (4) | Sequence (4)` bytes, upper-case hex. The taxon is stored
 * `scrambled XOR ((384160001 × serial + 2459) mod 2^32)`, the product taken exactly (`Math.imul`), as rippled and `decodeNftId` (app/domain/nft-id.ts) have it.
 */
export function encodeNftId(fields: { flags: number; transferFee: number; issuer: string; taxon: number; serial: number }): string {
  const scrambled = (fields.taxon ^ (Math.imul(384160001, fields.serial) + 2459)) >>> 0;
  const hex = (value: number, digits: number): string => value.toString(16).toUpperCase().padStart(digits, "0");
  const issuer = Array.from(decodeAccountID(fields.issuer), (byte) => hex(byte, 2)).join("");
  return `${hex(fields.flags, 4)}${hex(fields.transferFee, 4)}${issuer}${hex(scrambled, 8)}${hex(fields.serial, 8)}`;
}

const sizeOf = (page: NftEventsPage | undefined): number => page?.events.length ?? Number.POSITIVE_INFINITY;

/** The NFT of `which`, or `undefined` when the files hold none (Xahau has no `network-burned`: a burned URIToken is no entry). */
export function resolveNftCase(net: NetworkName, which: NftCase, sources: NftSources): NftCaseResult | undefined {
  const { nfts, histories, pagedHistories, node } = sources;
  const ids = [...nfts.keys()].sort();
  const indexed = (id: string): NftCaseResult => {
    const { nft } = nfts.get(id)!;
    return { id, issuer: nft.issuer, ...(nft.serial !== undefined && { serial: nft.serial }), ...(nft.taxon !== undefined && { taxon: nft.taxon }) };
  };
  const ofNode = (id: string): NftCaseResult => {
    const held = node.get(id)!;
    return { id, issuer: held.issuer, ...(held.serial !== undefined && { serial: held.serial }), ...(held.taxon !== undefined && { taxon: held.taxon }) };
  };
  const nodeOnly = [...node.keys()].filter((id) => !nfts.has(id)).sort();

  switch (which) {
    case "featured": {
      const id = ids.find((each) => pagedHistories.has(each));
      return id === undefined ? undefined : indexed(id);
    }
    case "burned": {
      // Burned by the account that held it (the burn names the owner it took it from), the shortest history first, then by id.
      const byOwner = ids.filter((id) => {
        const burn = histories.get(id)?.events.find((event) => event.event === "burn");
        return nfts.get(id)!.nft.burned && burn !== undefined && burn.account === burn.from;
      });
      const id = byOwner.sort((a, b) => sizeOf(histories.get(a)) - sizeOf(histories.get(b)) || (a < b ? -1 : 1))[0];
      return id === undefined ? undefined : indexed(id);
    }
    case "unowned": {
      const id = ids.find((each) => {
        const { nft } = nfts.get(each)!;
        return nft.owner === undefined && !nft.burned && node.has(each);
      });
      return id === undefined ? undefined : indexed(id);
    }
    case "network": {
      const id = nodeOnly.find((each) => !node.get(each)!.burned);
      return id === undefined ? undefined : ofNode(id);
    }
    case "network-burned": {
      const id = nodeOnly.find((each) => node.get(each)!.burned);
      return id === undefined ? undefined : ofNode(id);
    }
    case "missing": {
      // The featured NFT's collection: the next serial of an XRPL id (the id stays well formed), the next last digit of a URIToken's.
      const featured = resolveNftCase(net, "featured", sources);
      if (featured === undefined) return undefined;
      const { nft } = nfts.get(featured.id)!;
      const taken = (id: string): boolean => nfts.has(id) || node.has(id);
      for (let step = 1; step <= 4096; step++) {
        if (nft.kind === "nftoken") {
          const serial = nft.serial! + step;
          const id = encodeNftId({ flags: nft.flags, transferFee: nft.transfer_fee ?? 0, issuer: nft.issuer, taxon: nft.taxon ?? 0, serial });
          if (!taken(id)) return { id, issuer: nft.issuer, serial, taxon: nft.taxon! };
        } else {
          const id = `${featured.id.slice(0, 60)}${(Number.parseInt(featured.id.slice(60), 16) ^ step).toString(16).toUpperCase().padStart(4, "0")}`;
          if (!taken(id)) return { id, issuer: nft.issuer };
        }
      }
      return undefined;
    }
  }
}

/** An account that holds NFTs in the index: the first of the accounts' lists (by address) that has one. */
export function resolveHolder(sources: NftSources): string | undefined {
  return [...sources.holdings.keys()].sort().find((account) => sources.holdings.get(account)!.nfts.length > 0);
}
