// The NFTs of the fixtures (scripts/nft-fixtures.ts, `pnpm fixtures:sync`) that the worker specs need: an NFT of each case the NFT pages draw, an account that holds some, a collection
// of each case (`collectionCase`) and the markers of the second page of the collections list and of the sales. Each
// case is found in the files' data by its rule in nft-case-rules.ts (the rules the fixtures test checks the generator with), never from a table of ids, so a change of the
// generator's seeds moves nothing here. Read from the fixture files themselves (Vite bundles them, as validators-cases.ts and ledger-hashes.ts do), not through the client under
// test.

import type { NftAnswer, NftCollection, NftCollectionAnswer, NftCollectionsPage, NftEventsPage, NftSalesPage, NftsPage } from "../../app/server/api-types";
import type { NetworkId } from "../../app/server/networks";
import { resolveCollectionCase, resolveHolder, resolveNftCase, type CollectionCase, type CollectionCaseResult, type NftCase, type NftCaseResult, type NftSources, type NodeNft } from "./nft-case-rules";

export { COLLECTION_CASES, NFT_CASES, type CollectionCase, type NftCase, type NftCaseResult } from "./nft-case-rules";

const ROOT = "../fixtures/http/";
type Loaders = Record<string, () => Promise<string>>;
const details = import.meta.glob("../fixtures/http/*/data-api/nfts/*.json", { query: "?raw", import: "default" }) as Loaders;
/** Every history file of every NFT: the first page of the whole history is read, the pages behind a marker are only looked at by name. */
const histories = import.meta.glob("../fixtures/http/*/data-api/nfts/*/history@*.json", { query: "?raw", import: "default" }) as Loaders;
const accounts = import.meta.glob("../fixtures/http/*/data-api/accounts/*/nfts@limit=20.json", { query: "?raw", import: "default" }) as Loaders;
const nodeInfos = import.meta.glob("../fixtures/http/*/node/nft_info/*.json", { query: "?raw", import: "default" }) as Loaders;
const nodeEntries = import.meta.glob("../fixtures/http/*/node/ledger_entry/*.json", { query: "?raw", import: "default" }) as Loaders;
/** The collections that have a page of their own: `nft_collections/<issuer>.json` (Xahau) and `nft_collections/<issuer>/<taxon>.json` (XRPL); the lists below them are named by `@`. */
const collectionDetails = import.meta.glob(["../fixtures/http/*/data-api/nft_collections/*.json", "../fixtures/http/*/data-api/nft_collections/*/*.json"], { query: "?raw", import: "default" }) as Loaders;
/** The first page of the collections list (the default sort) and of the sales of the network (the older sales' page): their markers lead to the second page. */
const collectionsLists = import.meta.glob("../fixtures/http/*/data-api/nft_collections@limit=20&sort=volume.json", { query: "?raw", import: "default" }) as Loaders;
const salesLists = import.meta.glob("../fixtures/http/*/data-api/nft_sales@descending=true&limit=20.json", { query: "?raw", import: "default" }) as Loaders;

const read = async <T>(loaders: Loaders, path: string): Promise<T> => JSON.parse(await loaders[path]!()) as T;

/** The files of `loaders` that are the network's and match `pattern` (its first group is the key), with the key. */
function filesOf(loaders: Loaders, net: NetworkId, pattern: RegExp): Array<{ path: string; key: string }> {
  return Object.keys(loaders).flatMap((path) => {
    const match = pattern.exec(path.slice(`${ROOT}${net}/`.length));
    return path.startsWith(`${ROOT}${net}/`) && match !== null ? [{ path, key: match[1]! }] : [];
  });
}

const cache = new Map<NetworkId, Promise<NftSources>>();

/** What the rules read, from the network's files; read once. */
function sourcesOf(net: NetworkId): Promise<NftSources> {
  let sources = cache.get(net);
  if (sources === undefined) {
    sources = (async (): Promise<NftSources> => {
      const nfts = new Map<string, NftAnswer>(await Promise.all(filesOf(details, net, /^data-api\/nfts\/([0-9A-F]{64})\.json$/).map(async ({ path, key }) => [key, await read<NftAnswer>(details, path)] as const)));
      // The whole history of a burned NFT is read (the rule of `burned` looks at its burn); of the others only the names matter.
      const first = filesOf(histories, net, /^data-api\/nfts\/([0-9A-F]{64})\/history@descending=true&limit=20\.json$/);
      const events = new Map<string, NftEventsPage>(
        await Promise.all(first.filter(({ key }) => nfts.get(key)?.nft.burned === true).map(async ({ path, key }) => [key, await read<NftEventsPage>(histories, path)] as const)),
      );
      const paged = new Set(filesOf(histories, net, /^data-api\/nfts\/([0-9A-F]{64})\/history@descending=true&limit=20&marker=[^/]+\.json$/).map(({ key }) => key));
      const node = new Map<string, NodeNft>();
      for (const { path, key } of filesOf(nodeInfos, net, /^node\/nft_info\/([0-9A-F]{64})\.json$/)) {
        const { result } = await read<{ result: { issuer: string; nft_taxon: number; nft_serial: number; is_burned: boolean } }>(nodeInfos, path);
        node.set(key, { issuer: result.issuer, taxon: result.nft_taxon, serial: result.nft_serial, burned: result.is_burned });
      }
      for (const { path, key } of filesOf(nodeEntries, net, /^node\/ledger_entry\/([0-9A-F]{64})\.json$/)) {
        const { result } = await read<{ result: { node: { Issuer: string } } }>(nodeEntries, path);
        node.set(key, { issuer: result.node.Issuer, burned: false });
      }
      const holdings = new Map<string, NftsPage>(await Promise.all(filesOf(accounts, net, /^data-api\/accounts\/([^/]+)\/nfts@limit=20\.json$/).map(async ({ path, key }) => [key, await read<NftsPage>(accounts, path)] as const)));
      return { nfts, histories: events, pagedHistories: paged, node, holdings };
    })();
    cache.set(net, sources);
  }
  return sources;
}

/**
 * The NFT of `which`: its id, and its serial, issuer and taxon (the issuer alone for a Xahau URIToken). Throws when the network's fixtures hold none (Xahau has no
 * `network-burned`: a burned URIToken is no ledger entry, so the node cannot say it is burned).
 */
export async function nftCase(net: NetworkId, which: NftCase): Promise<NftCaseResult> {
  const found = resolveNftCase(net, which, await sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no ${which} NFT`);
  return found;
}

/** An account that holds NFTs in the index: the network's active account (its files are in "Upstream fixtures"). */
export async function holderCase(net: NetworkId): Promise<string> {
  const found = resolveHolder(await sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no account that holds an NFT`);
  return found;
}

const collectionCache = new Map<NetworkId, Promise<ReadonlyMap<string, NftCollection>>>();

/** The collections with a page of their own, by key (`issuer` on Xahau, `issuer/taxon` on XRPL); read once. */
function collectionsOf(net: NetworkId): Promise<ReadonlyMap<string, NftCollection>> {
  let found = collectionCache.get(net);
  if (found === undefined) {
    found = (async () => {
      const pages = filesOf(collectionDetails, net, /^data-api\/nft_collections\/([^/@]+(?:\/\d+)?)\.json$/);
      return new Map(await Promise.all(pages.map(async ({ path, key }) => [key, (await read<NftCollectionAnswer>(collectionDetails, path)).collection] as const)));
    })();
    collectionCache.set(net, found);
  }
  return found;
}

/**
 * The collection of `which`: the featured NFT's (`featured`), one that has not been sold (`quiet`: no sale in 30 days, nor any), and a third, with sales (`other`). Each has a page of
 * its own in the fixtures: the collection, its stats over the 30 days to T, its sales, NFTs (with an owner filter) and holders. Found in the files by the rules of
 * nft-case-rules.ts. Throws when they hold none.
 */
export async function collectionCase(net: NetworkId, which: CollectionCase): Promise<CollectionCaseResult> {
  const featured = resolveNftCase(net, "featured", await sourcesOf(net));
  const found = resolveCollectionCase(which, featured, await collectionsOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no ${which} collection`);
  return found;
}

/** The marker of a list's first page: the one that leads to its second. Throws when the list has one page only. */
async function markerOf(net: NetworkId, loaders: Loaders, list: string): Promise<string> {
  const [file] = filesOf(loaders, net, /^data-api\/(.*)$/);
  if (file === undefined) throw new Error(`the ${net} fixtures have no ${list}`);
  const { marker } = await read<NftCollectionsPage | NftSalesPage>(loaders, file.path);
  if (marker === undefined) throw new Error(`the ${net} ${list} has no second page`);
  return marker;
}

/** The marker of the collections list's second page (the default sort, descending: `/v2/nft_collections?limit=20&sort=volume`). */
export async function collectionsMarker(net: NetworkId): Promise<string> {
  return markerOf(net, collectionsLists, "list of collections");
}

/**
 * The marker of the second page of the sales of the network (`/v2/nft_sales?descending=true&limit=20`). The featured collection's own sales list has the same first twenty rows
 * (its sales are the newest of the network, PROVENANCE.md "The traded NFTs"), so the same marker leads to the second page of its `/sales` too.
 */
export async function salesMarker(net: NetworkId): Promise<string> {
  return markerOf(net, salesLists, "list of sales");
}
