// The data API's answers of the AMM pool routes (E5, data-api-new feat/amm-data c3e2302) for the recorded XRPL ledgers: every pool, the list and its
// filters, and the featured pools' pair forms, swaps, liquidity and governance. http-fixtures.ts calls `ammFixtures` from `generate()`, so `pnpm fixtures:sync`
// writes the files; test/fixtures/PROVENANCE.md ("AMM answers") says what they are made of and follow, and test/unit/amm-fixtures.test.ts checks them.
//
// All of them are derived: the pools, their liquidity events and their votes and bids by scripts/amm-derive.ts, the swaps by E3's scripts/derived-trades.ts
// (`derivedExchanges`: the exchange rows with `amm_account`), over the three XRPL sets. The featured pools' `amm_info` is E3's amm-info-fixtures.ts
// (`AMM_INFO_POOLS`). The shapes are the reference's (docs/api-reference.md "AMM", apps/api/src/amm/amm-objects.ts):
//
//   amm/pools/<POOL>.json                     `{ result, pool }`, for every pool of the recordings, a deleted one too
//   amm/pools/<A>/<B>.json                    the pair form of each featured pool, in both orders, each side its `apiAssetText`
//   amm/pools@limit=20[&marker=<M>].json      the live pools, by `value_native` descending (the stored Float64; the pools without one last), then account; the
//                                             marker of a page is `encodePoolsMarker`: the base64url JSON of `[value | null, amm_account]` of its last pool
//   amm/pools@asset=…[&include_deleted=true]&limit=20.json   the first page of three filters: XRP, RLUSD, and SNK with the deleted pools
//   amm/pools/<POOL>/swaps|liquidity|governance@descending=true&limit=20[&marker=<M>].json   each featured pool's rows, newest first: split into two pages
//                                             when it has two or more (the newer half, rounded up, and the marker of its last row, then the rest), so the
//                                             pages' pager has something to do with the few rows the recordings hold; an event's marker is
//                                             `[ledger_index, tx_index]`, a swap's `[ledger_index, tx_index, node_index]` (the exchanges')
//   amm/pools/<POOL>/liquidity@event=create&limit=1.json     its create event, or an empty list
//
// A list's rows are one line each (`fixtureText`'s `rowLists`), as in the other generated files.

import { apiAssetText, sameAsset, type Asset } from "../app/domain/asset";
import type { AmmGovernanceRow, AmmLiquidityEvent, AmmPool, AmmSwap, Page } from "../app/server/api-types";
import { dataApiFile } from "../test/support/upstream-core";
import { deriveAmm, storedValue } from "./amm-derive";
import { derivedExchanges } from "./derived-trades";
import { fixtureText, readLedgers, txMarker } from "./http-fixtures";
import { listPages } from "./market-aggregates";

/** The pools the AMM pages' fixtures and tests are about, real pools of the recordings named in E3's natural orientation (spec section 9). */
export const FEATURED_POOLS = {
  /** Swaps, deposits and withdrawals. */
  "XRP/RLUSD": "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3",
  /** Issued currencies only: no native side, no `value_native`. */
  "USDC/RLUSD": "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb",
  /** A vote, and nothing else: only its AMM node is recorded (no `amm_info`, P3). */
  "VOX/XRP": "rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef",
  /** A bid. Bitstamp's USD. */
  "XRP/USD": "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am",
  /** A creation. */
  "DVR/XRP": "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG",
  /** Deleted by a withdrawal that emptied it. */
  "SNK/XRP": "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz",
} as const satisfies Record<"XRP/RLUSD" | "USDC/RLUSD" | "VOX/XRP" | "XRP/USD" | "DVR/XRP" | "SNK/XRP", string>;

/** What the pages ask for: 20 rows of a list, 20 pools of a page of the pools. */
const LIMIT = 20;
/** The lists whose rows are one line each. */
const ROW_LISTS = ["pools", "exchanges", "liquidity", "governance"] as const;

const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const SNK: Asset = { currency: "SNK", issuer: "rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm" };

const baseOf = (pool: AmmPool): Asset => (pool.base_issuer === undefined ? { currency: pool.base_currency } : { currency: pool.base_currency, issuer: pool.base_issuer });
const counterOf = (pool: AmmPool): Asset =>
  pool.counter_issuer === undefined ? { currency: pool.counter_currency } : { currency: pool.counter_currency, issuer: pool.counter_issuer };
const hasAsset = (asset: Asset) => (pool: AmmPool): boolean => sameAsset(baseOf(pool), asset) || sameAsset(counterOf(pool), asset);
const byAccount = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order of the list (`poolsKeyset`): `value_native` descending, the pools without one last, then `amm_account` ascending. */
function listOrder(a: AmmPool, b: AmmPool): number {
  const [x, y] = [storedValue(a), storedValue(b)];
  if (x !== y) {
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  }
  return byAccount(a.amm_account, b.amm_account);
}

/** The marker of a page of pools that ends with `last`: `encodePoolsMarker(value_native, amm_account)`, the value the stored Float64. */
const poolsMarker = (last: AmmPool): string => Buffer.from(JSON.stringify([storedValue(last), last.amm_account])).toString("base64url");

/** The pages of the pools in list order, `LIMIT` to a page: the marker each is reached by (none for the first), and the page. */
function poolPages(pools: readonly AmmPool[]): Array<{ marker?: string; page: Page<"pools", AmmPool> }> {
  const pages: Array<{ marker?: string; page: Page<"pools", AmmPool> }> = [];
  let marker: string | undefined;
  for (let at = 0; at === 0 || at < pools.length; at += LIMIT) {
    const shown = pools.slice(at, at + LIMIT);
    const next = at + LIMIT < pools.length ? poolsMarker(shown.at(-1)!) : undefined;
    pages.push({ ...(marker !== undefined && { marker }), page: { result: "success", count: shown.length, ...(next !== undefined && { marker: next }), pools: shown } });
    marker = next;
  }
  return pages;
}

/** An event list's pages, newest first: two when it has two rows or more (the newer half, rounded up, with the marker of its last row; then the rest), else one. */
function eventPages<K extends string, T extends { ledger_index: number; tx_index: number }>(key: K, rows: readonly T[]): Array<{ marker?: string; page: Page<K, T> }> {
  const newest = [...rows].sort((a, b) => b.ledger_index - a.ledger_index || b.tx_index - a.tx_index);
  const page = (shown: T[], next?: string) => ({ result: "success", count: shown.length, ...(next !== undefined && { marker: next }), [key]: shown }) as Page<K, T>;
  if (newest.length < 2) return [{ page: page(newest) }];
  const half = Math.ceil(newest.length / 2);
  const last = newest[half - 1]!;
  const marker = txMarker(last.ledger_index, last.tx_index);
  return [{ page: page(newest.slice(0, half), marker) }, { marker, page: page(newest.slice(half)) }];
}

/** A swap list's pages, split as `eventPages`, with the exchanges' pages and markers (`listPages`: `[ledger_index, tx_index, node_index]`). */
function swapPages(rows: readonly AmmSwap[]): Array<{ marker?: string; page: Page<"exchanges", AmmSwap> }> {
  const half = rows.length < 2 ? Math.max(rows.length, 1) : Math.ceil(rows.length / 2);
  return listPages(rows, half) as Array<{ marker?: string; page: Page<"exchanges", AmmSwap> }>;
}

/** Every file of the AMM pool routes: path below test/fixtures/http/ and text. */
export function ammFixtures(): Map<string, string> {
  const files = new Map<string, string>();
  const put = (path: string, query: string, value: unknown) => {
    const file = dataApiFile("xrpl", path, query);
    if (file === undefined) throw new Error(`no fixture file for ${path}?${query}`);
    if (files.has(file)) throw new Error(`${file} is written twice`);
    files.set(file, fixtureText(value, ROW_LISTS));
  };
  const queryOf = (params: Record<string, string | number | undefined>): string =>
    Object.entries(params)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
      .join("&");

  const ledgers = readLedgers("xrpl");
  const { pools, liquidity, governance } = deriveAmm(ledgers);
  const swaps = derivedExchanges(ledgers).filter((row): row is AmmSwap => row.amm_account !== undefined);
  const inOrder = [...pools].sort(listOrder);
  const live = inOrder.filter((pool) => !pool.deleted);

  // Every pool, and the list of the live ones with each page its marker names.
  for (const pool of pools) put(`/v2/amm/pools/${pool.amm_account}`, "", { result: "success", pool });
  for (const { marker, page } of poolPages(live)) put("/v2/amm/pools", queryOf({ limit: LIMIT, marker }), page);

  // The first page of each filter the tests ask for.
  const filters: Array<{ asset: Asset; includeDeleted: boolean }> = [
    { asset: { currency: "XRP" }, includeDeleted: false },
    { asset: RLUSD, includeDeleted: false },
    { asset: SNK, includeDeleted: true },
  ];
  for (const { asset, includeDeleted } of filters) {
    const shown = (includeDeleted ? inOrder : live).filter(hasAsset(asset));
    put("/v2/amm/pools", queryOf({ asset: apiAssetText(asset), include_deleted: includeDeleted ? "true" : undefined, limit: LIMIT }), poolPages(shown)[0]!.page);
  }

  // The featured pools: the pair form, and the tabs' lists.
  for (const account of Object.values(FEATURED_POOLS)) {
    const pool = pools.find((p) => p.amm_account === account);
    if (pool === undefined) throw new Error(`${account}: a featured pool that the recordings do not have`);
    // The pair form serves the live pool of the pair first, else the one with the highest `last_ledger`, then the lowest account.
    const ofPair = pools
      .filter((p) => sameAsset(baseOf(p), baseOf(pool)) && sameAsset(counterOf(p), counterOf(pool)))
      .sort((a, b) => Number(a.deleted) - Number(b.deleted) || b.last_ledger - a.last_ledger || byAccount(a.amm_account, b.amm_account));
    if (ofPair[0] !== pool) throw new Error(`${account}: the pair form of its pair serves ${ofPair[0]!.amm_account}`);
    for (const [a, b] of [[baseOf(pool), counterOf(pool)], [counterOf(pool), baseOf(pool)]] as const) {
      put(`/v2/amm/pools/${encodeURIComponent(apiAssetText(a))}/${encodeURIComponent(apiAssetText(b))}`, "", { result: "success", pool });
    }

    const own = <T extends { amm_account: string }>(rows: readonly T[]): T[] => rows.filter((row) => row.amm_account === account);
    const tab = (name: string, pages: Array<{ marker?: string; page: unknown }>) => {
      for (const { marker, page } of pages) put(`/v2/amm/pools/${account}/${name}`, queryOf({ descending: "true", limit: LIMIT, marker }), page);
    };
    tab("swaps", swapPages(own(swaps)));
    tab("liquidity", eventPages<"liquidity", AmmLiquidityEvent>("liquidity", own(liquidity)));
    tab("governance", eventPages<"governance", AmmGovernanceRow>("governance", own(governance)));
    const create = own(liquidity).filter((event) => event.event === "create").slice(0, 1);
    put(`/v2/amm/pools/${account}/liquidity`, queryOf({ event: "create", limit: 1 }), { result: "success", count: create.length, liquidity: create });
  }
  return files;
}
