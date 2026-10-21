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
// The pool page's day rows, the pairs' AMM-only candles and the live AMM volume are synthetic (the recordings hold a few days of the pools, not months), from
// E2's seeded generator (scripts/synthetic.ts), at T, the UTC day of the newest recorded ledger (2026-10-17). Each featured pool but VOX/XRP has one daily
// series, drawn from `mulberry32(seedOf(<POOL>, "history"))` backwards from its derived state (see "The synthetic series" below), of which these are views by
// the API's rules (docs/api-reference.md "AMM", `/history?interval=day`; packages/shared/src/aggregate/amm-daily.job.ts for a day's figures; E3's
// market-aggregates.ts for the candles), each window E2's `windowOf(T, period)`, scoped as P2 of E5 says (XRP/RLUSD every period; USDC/RLUSD and XRP/USD the
// 90 days; DVR/XRP the 30 days; SNK/XRP every period, all but the year empty):
//
//   amm/pools/<POOL>/history@end=T&interval=day&limit=1000&start=<W₀>.json      the rows whose day is from W₀ to T, oldest first
//   amm/pools/<POOL>/history@descending=true&end=<W₀ − 1>&interval=day&limit=1.json   the carry-in: the newest row on or before the day before W₀, with
//                                             the marker of its day (unix seconds) when older rows exist; else an empty list
//   amm/pools/<POOL>/history@end=<T − 1>&interval=day&limit=1&start=<T − 1>.json      the last whole day
//   exchanges/<B>/<C>@amm=only&end=T&interval=<1day|7day>&limit=400&start=<W₀>.json   the series' swaps as candles, the pair in its stored order
//   network/amm_volume@live=day.json          the rolling day to T's minute: a component for each live pool with the native currency but VOX/XRP (no swaps), drawn
//                                             from `mulberry32(seedOf("xrpl", "amm_volume", "live"))` (apps/api/src/network/volume-object.ts for the row)
//
// A list's rows are one line each (`fixtureText`'s `rowLists`), as in the other generated files: a pool, a swap, an event, a day, a candle, a volume component.

import BigNumber from "bignumber.js";

import { apiAssetText, sameAsset, type Asset } from "../app/domain/asset";
import { bucketStarts, utcDayOf, windowOf } from "../app/domain/window";
import type { AmmGovernanceRow, AmmLiquidityEvent, AmmPool, AmmPoolDay, AmmSwap, AmmVolumeComponent, AmmVolumeRow, Page } from "../app/server/api-types";
import { dataApiFile } from "../test/support/upstream-core";
import { deriveAmm, storedValue, valueText, type DerivedAmm } from "./amm-derive";
import { derivedExchanges, NATIVE } from "./derived-trades";
import { fixtureText, isoTime, readLedgers, txMarker, unixOf, type RawLedger } from "./http-fixtures";
import { Api, candlesOf, exactOf, listPages, Wide, type Fill } from "./market-aggregates";
import { mulberry32, seedOf } from "./synthetic";

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
/** The lists whose rows are one line each: pools, swaps and candles, events, votes and bids, days, and the live volume's components. */
const ROW_LISTS = ["pools", "exchanges", "liquidity", "governance", "days", "components"] as const;

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

/** A request's query, its parameters in the order given and each value encoded; `undefined` ones left out. */
const queryOf = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    .join("&");

/** Every file of the AMM pool routes, and the synthetic day rows, candles and live volume: path below test/fixtures/http/ and text. */
export function ammFixtures(): Map<string, string> {
  const files = new Map<string, string>();
  const put = (path: string, query: string, value: unknown) => {
    const file = dataApiFile("xrpl", path, query);
    if (file === undefined) throw new Error(`no fixture file for ${path}?${query}`);
    if (files.has(file)) throw new Error(`${file} is written twice`);
    files.set(file, fixtureText(value, ROW_LISTS));
  };

  const ledgers = readLedgers("xrpl");
  const derived = deriveAmm(ledgers);
  const { pools, liquidity, governance } = derived;
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

  // The synthetic part: the featured pools' day rows and candles, and the live volume.
  for (const { path, query, value } of syntheticAnswers(derived, headOf(ledgers))) put(path, query, value);
  return files;
}

// ---- The synthetic series ----------------------------------------------------------------------------------------------
//
// One daily series per featured pool but VOX/XRP (P3: only its vote is recorded), drawn backwards from the pool's derived state, so that the closing state of
// its last day is the pool's own (T for a live pool, the deletion day for SNK/XRP). From 2025-10-01, or the recorded creation day when that is later, to T, or
// the deletion day when that is earlier; a day is active or quiet (no row) by a draw, and the creation, the deletion, T and every day of a recorded liquidity
// event are active. An active day draws its swaps once, and they make both its row and its candle:
//
//   - every swap of the day is at the pool's closing price (counter per base, 8 significant digits), of the reserves the day closes with, or for the day a
//     withdrawal empties the pool, of those just before it; its amounts are the pool's own changes (what went in, what went out), the native leg above the
//     0.0005 the aggregates leave out, so every swap is in its candle;
//   - the row (amm-daily.job.ts): `swap_count`, `volume_*` what went into the pool by side, `fees_*_est` each side's volume × `trading_fee` / 100000, exact
//     (the fee does not change, and no taker holds the slot), but on XRP/RLUSD's 2026-10-10, whose swaps had no known fee, where neither estimate is served
//     (Ruling R-A26: the spec's one day without an estimate); the day's recorded liquidity events of the pool (Task 4's: a creation counts as a deposit), which
//     no synthetic day has; and the closing state: the reserves, `lp_supply`, `trading_fee`, and `value_native` 2 × the native reserve (`valueText`), none for
//     an issued-only pool or on the day of the deletion;
//   - the candle (market-aggregates.ts `candlesOf`, E3's port of the reference's rules): both legs of every swap, the base the takers bought being what went
//     out of the pool.
//
// The day before is then the closing state less the day's swaps and liquidity: the reserves walk back from the derived state. A draw steers the walk: each day
// the base reserve of the day before is pulled towards a triangle wave below the derived one (`swing` of it at the trough, every `period` days), so the price
// swings and the reserves stay positive. DVR/XRP's recordings end with its creation, so its derived state is the creation's: each of its swaps has its way back
// on the same day (`roundTrips`), and the walk lands on nothing before the creation.

/** Where a series starts at the latest: the year's carry-in (2025-10-19) needs days before the year's window. */
const HISTORY_FROM = "2025-10-01";
/** The day whose swaps had no known fee, and so no estimate on either side. */
const UNKNOWN_FEE = { name: "XRP/RLUSD", day: "2026-10-10" } as const;
/** The aggregates leave out a swap whose native leg is this or less; every synthetic swap is above it. */
const DUST = new BigNumber("0.0005");
const DAY_SECONDS = 86_400;
/** What the pages ask for: a window's day rows, a carry-in, a last day, a window's candles. */
const DAYS_LIMIT = 1000;
const CANDLES_LIMIT = 400;

type SeriesName = Exclude<keyof typeof FEATURED_POOLS, "VOX/XRP">;
type Period = "30d" | "90d" | "1y";

/** How a featured pool's series is drawn, and which of its files are written. */
interface SeriesShape {
  /** The windows whose day rows and candles are written (P2), and the windows whose carry-in is (DVR/XRP: all three, each empty). */
  windows: readonly Period[];
  carryIns: readonly Period[];
  /** The share of days with activity, and an active day's swaps (DVR/XRP: its round trips), at least and at most. */
  active: number;
  swaps: readonly [number, number];
  /** The base that changes hands on an active day, as a share of the base reserve: at least and at most. */
  turnover: readonly [number, number];
  /** How far below the derived base reserve the walk's wave goes (a share of it), and its length in days. */
  swing: number;
  period: number;
  /** The decimals of a swap's base and counter amounts (the native currency's are its drops). */
  decimals: readonly [number, number];
  /** Every swap has its way back on the same day: the reserves never move. */
  roundTrips?: boolean;
}

const SERIES: Record<SeriesName, SeriesShape> = {
  "XRP/RLUSD": { windows: ["30d", "90d", "1y"], carryIns: ["30d", "90d", "1y"], active: 0.88, swaps: [12, 40], turnover: [0.02, 0.08], swing: 0.12, period: 150, decimals: [6, 6] },
  "USDC/RLUSD": { windows: ["90d"], carryIns: ["90d"], active: 0.55, swaps: [1, 8], turnover: [0.01, 0.05], swing: 0.03, period: 90, decimals: [6, 6] },
  "XRP/USD": { windows: ["90d"], carryIns: ["90d"], active: 0.7, swaps: [1, 12], turnover: [0.02, 0.1], swing: 0.1, period: 120, decimals: [6, 6] },
  "DVR/XRP": { windows: ["30d"], carryIns: ["30d", "90d", "1y"], active: 0.8, swaps: [1, 3], turnover: [0.002, 0.04], swing: 0, period: 1, decimals: [2, 6], roundTrips: true },
  "SNK/XRP": { windows: ["30d", "90d", "1y"], carryIns: ["30d", "90d", "1y"], active: 0.5, swaps: [1, 3], turnover: [0.03, 0.12], swing: 0.15, period: 60, decimals: [12, 6] },
};

/** A featured pool's synthetic history: its day rows (`PoolDay`) and the swaps they count (E3's `Fill`, the candles' input), oldest first. */
export interface PoolSeries {
  name: SeriesName;
  pool: AmmPool;
  days: AmmPoolDay[];
  fills: Fill[];
}

/** A synthetic answer before serialization: the request (path and query) and its body. */
export interface SyntheticAnswer {
  path: string;
  query: string;
  value: unknown;
}

/** The close time of the newest recorded ledger, unix seconds: T is its UTC day. */
const headOf = (ledgers: readonly RawLedger[]): number => unixOf(ledgers.at(-1)!.ledger.close_time);
const isNativeAsset = (asset: Asset): boolean => asset.issuer === undefined && asset.currency === NATIVE;
const secondsOf = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000;
const dayBefore = (day: string): string => utcDayOf(secondsOf(day) - DAY_SECONDS);
/** An amount as the API writes a sum: BigNumber's `toString()`. */
const sumText = (value: BigNumber): string => new Api(value).toString();
/** A rate or a price as the API writes it: 8 significant digits. */
const precision8 = (value: BigNumber.Value): string => new Api(value).toPrecision(8);
/** A marker of a page of days (amm-pools.service.ts `days`): the base64url JSON of the start of its last day, in unix seconds. */
const dayMarker = (row: AmmPoolDay): string => Buffer.from(JSON.stringify([Date.parse(row.date) / 1000])).toString("base64url");

/** The featured pools' series (the tests read them beside the files). */
export function ammSeries(ledgers: readonly RawLedger[]): PoolSeries[] {
  return seriesOfPools(deriveAmm(ledgers), headOf(ledgers));
}

/** The synthetic answers before serialization (the tests check their key orders). */
export function ammSynthetic(ledgers: readonly RawLedger[]): SyntheticAnswer[] {
  return syntheticAnswers(deriveAmm(ledgers), headOf(ledgers));
}

function seriesOfPools(derived: DerivedAmm, head: number): PoolSeries[] {
  return (Object.keys(SERIES) as SeriesName[]).map((name) => {
    const pool = derived.pools.find((p) => p.amm_account === FEATURED_POOLS[name]);
    if (pool === undefined) throw new Error(`${name}: a featured pool that the recordings do not have`);
    const own = <T extends { amm_account: string }>(rows: readonly T[]): T[] => rows.filter((row) => row.amm_account === pool.amm_account);
    return drawSeries(name, pool, own(derived.liquidity), own(derived.states).at(-1)!.executed_time, head, SERIES[name]);
  });
}

/** A pool's reserves and LP supply at one point. */
interface Holding {
  base: BigNumber;
  counter: BigNumber;
  lp: BigNumber;
}

/** One swap of a day: its base and counter legs, the side that went into the pool, and its time. */
interface Swap {
  base: BigNumber;
  counter: BigNumber;
  into: "base" | "counter";
  time: number;
}

/** A triangle wave of `period` days, `age` the days before the series' last day: 0 on that day and every `period` days before it, −1 half way. */
const wave = (age: number, period: number): number => -1 + Math.abs(((age % period) / period) * 2 - 1);

function drawSeries(name: SeriesName, pool: AmmPool, events: readonly AmmLiquidityEvent[], lastStateTime: string, head: number, shape: SeriesShape): PoolSeries {
  const T = utcDayOf(head);
  const created = events.find((event) => event.event === "create");
  const first = created !== undefined && created.executed_time.slice(0, 10) > HISTORY_FROM ? created.executed_time.slice(0, 10) : HISTORY_FROM;
  const last = pool.deleted ? lastStateTime.slice(0, 10) : T;
  if (pool.reserve_base === undefined || pool.reserve_counter === undefined || pool.lp_supply === undefined || pool.trading_fee === undefined) {
    throw new Error(`${name}: a featured pool without reserves, LP supply and fee cannot close a day`);
  }
  const [base, counter] = [baseOf(pool), counterOf(pool)];
  const fee = pool.trading_fee;
  const next = mulberry32(seedOf(pool.amm_account, "history"));
  const draw = ([low, high]: readonly [number, number]): number => low + next() * (high - low);
  const eventsOn = (day: string) => events.filter((event) => event.executed_time.slice(0, 10) === day);

  const days: AmmPoolDay[] = [];
  const fills: Fill[] = [];
  let close: Holding = { base: new BigNumber(pool.reserve_base), counter: new BigNumber(pool.reserve_counter), lp: new BigNumber(pool.lp_supply) };
  let anchor: BigNumber | undefined;
  const calendar = bucketStarts(first, last, "day").reverse();
  calendar.forEach((day, age) => {
    const own = eventsOn(day);
    const forced = day === last || (created !== undefined && day === first) || own.length > 0 || (name === UNKNOWN_FEE.name && day === UNKNOWN_FEE.day);
    if (next() >= shape.active && !forced) return;

    // The day's recorded liquidity, from the pool's side (+ into it): a creation and a deposit count as deposits, a withdrawal and a clawback as withdrawals.
    const liquidity = { base: new BigNumber(0), counter: new BigNumber(0), lp: new BigNumber(0) };
    const flows = { inBase: new BigNumber(0), inCounter: new BigNumber(0), outBase: new BigNumber(0), outCounter: new BigNumber(0) };
    for (const event of own) {
      const [b, c] = [new BigNumber(event.base_amount), new BigNumber(event.counter_amount)];
      liquidity.base = liquidity.base.plus(b);
      liquidity.counter = liquidity.counter.plus(c);
      liquidity.lp = liquidity.lp.plus(event.lp_tokens);
      if (b.gt(0)) flows.inBase = flows.inBase.plus(b);
      else flows.outBase = flows.outBase.minus(b);
      if (c.gt(0)) flows.inCounter = flows.inCounter.plus(c);
      else flows.outCounter = flows.outCounter.minus(c);
    }

    // The swaps end at the closing reserves, or, on the day a withdrawal emptied the pool, at those just before it.
    const at = close.base.gt(0) && close.counter.gt(0) ? close : { base: close.base.minus(liquidity.base), counter: close.counter.minus(liquidity.counter) };
    anchor ??= at.base;
    const price = new BigNumber(precision8(new Wide(at.counter).dividedBy(at.base)));
    const dayStart = secondsOf(day);
    const from = created !== undefined && day === first ? Date.parse(created.executed_time) / 1000 + 1 : dayStart;
    const to = day === T ? head + 1 : pool.deleted && day === last ? Date.parse(lastStateTime) / 1000 : dayStart + DAY_SECONDS;
    const native = isNativeAsset(counter) ? "counter" : isNativeAsset(base) ? "base" : undefined;
    const swaps = drawSwaps(shape, native, at, price, anchor, age, next, draw, name === UNKNOWN_FEE.name && day === UNKNOWN_FEE.day);
    const times = swaps.map(() => from + Math.floor(next() * (to - from))).sort((a, b) => a - b);
    // The order of the day's swaps: a shuffle of the drawn ones over the sorted times.
    for (let i = swaps.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [swaps[i], swaps[j]] = [swaps[j]!, swaps[i]!];
    }
    swaps.forEach((swap, i) => (swap.time = times[i]!));

    const into = (side: "base" | "counter") => swaps.filter((swap) => swap.into === side).reduce((total, swap) => total.plus(swap[side]), new BigNumber(0));
    const outOf = (side: "base" | "counter") => swaps.filter((swap) => swap.into !== side).reduce((total, swap) => total.plus(swap[side]), new BigNumber(0));
    const [volumeBase, volumeCounter] = [into("base"), into("counter")];
    const known = !(name === UNKNOWN_FEE.name && day === UNKNOWN_FEE.day);
    const estimate = (volume: BigNumber) => sumText(volume.times(fee).shiftedBy(-5));
    const nativeReserve = native === undefined ? undefined : close[native];
    const value = nativeReserve === undefined || (pool.deleted && day === last) ? undefined : valueText(nativeReserve.times(2).toNumber());
    days.push({
      amm_account: pool.amm_account,
      date: `${day}T00:00:00Z`,
      base_currency: pool.base_currency,
      ...(pool.base_issuer !== undefined && { base_issuer: pool.base_issuer }),
      counter_currency: pool.counter_currency,
      ...(pool.counter_issuer !== undefined && { counter_issuer: pool.counter_issuer }),
      swap_count: swaps.length,
      volume_base: sumText(volumeBase),
      volume_counter: sumText(volumeCounter),
      ...(known && { fees_base_est: estimate(volumeBase), fees_counter_est: estimate(volumeCounter) }),
      deposit_count: own.filter((event) => event.event === "create" || event.event === "deposit").length,
      withdraw_count: own.filter((event) => event.event === "withdraw" || event.event === "clawback").length,
      liquidity_in_base: sumText(flows.inBase),
      liquidity_in_counter: sumText(flows.inCounter),
      liquidity_out_base: sumText(flows.outBase),
      liquidity_out_counter: sumText(flows.outCounter),
      reserve_base: close.base.toFixed(),
      reserve_counter: close.counter.toFixed(),
      lp_supply: close.lp.toFixed(),
      trading_fee: fee,
      ...(value !== undefined && { value_native: value }),
    });
    swaps.forEach((swap, i) => {
      const rate = precision8(new Wide(swap.counter).dividedBy(swap.base));
      const nativeLeg = native === undefined ? undefined : swap[native];
      fills.push({
        key: [swap.time, i, 0],
        time: swap.time,
        rate,
        value: Number(rate),
        base: exactOf(swap.base.toFixed()),
        counter: exactOf(swap.counter.toFixed()),
        amm: true,
        kept: nativeLeg === undefined || nativeLeg.gt(DUST),
        // The taker bought the base when the base went out of the pool.
        bought: swap.into === "counter",
        exact: true,
      });
    });

    // The state the day began in: the closing one less the day's swaps and liquidity.
    const begun: Holding = {
      base: close.base.minus(liquidity.base).minus(volumeBase).plus(outOf("base")),
      counter: close.counter.minus(liquidity.counter).minus(volumeCounter).plus(outOf("counter")),
      lp: close.lp.minus(liquidity.lp),
    };
    const nothing = begun.base.isZero() && begun.counter.isZero() && begun.lp.isZero();
    if (created !== undefined && day === first ? !nothing : !(begun.base.gt(0) && begun.counter.gt(0) && begun.lp.gt(0))) {
      throw new Error(`${name} ${day}: the day began with ${begun.base.toFixed()} and ${begun.counter.toFixed()} (LP ${begun.lp.toFixed()})`);
    }
    close = begun;
  });
  return { name, pool, days: days.reverse(), fills: fills.sort((a, b) => a.time - b.time || a.key[1] - b.key[1]) };
}

/**
 * The swaps of an active day, at `price`, ending at the reserves `at`. Their net steers the walk: the base reserve of the day before is pulled to the wave
 * below `anchor` (the base the series ends with), with a little noise, at most 3% of it a day. `bothWays`: at least a swap into each side.
 */
function drawSwaps(
  shape: SeriesShape,
  native: "base" | "counter" | undefined,
  at: { base: BigNumber; counter: BigNumber },
  price: BigNumber,
  anchor: BigNumber,
  age: number,
  next: () => number,
  draw: (range: readonly [number, number]) => number,
  bothWays: boolean,
): Swap[] {
  const [baseDecimals, counterDecimals] = shape.decimals;
  const unit = new BigNumber(1).shiftedBy(-baseDecimals);
  // The least base amount of a swap: one unit, and a native leg a fifth above the dust the aggregates leave out.
  const floor = DUST.times(1.2);
  const least =
    native === "counter" ? BigNumber.max(unit, floor.dividedBy(price).decimalPlaces(baseDecimals, BigNumber.ROUND_UP)) : native === "base" ? BigNumber.max(unit, floor) : unit;
  const leg = (amount: BigNumber, into: "base" | "counter"): Swap => {
    const baseAmount = BigNumber.max(amount.decimalPlaces(baseDecimals, BigNumber.ROUND_DOWN), least);
    return { base: baseAmount, counter: baseAmount.times(price).decimalPlaces(counterDecimals, BigNumber.ROUND_HALF_UP), into, time: 0 };
  };
  const split = (total: BigNumber, count: number): BigNumber[] => {
    const weights = Array.from({ length: count }, () => 0.5 + next());
    const whole = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => total.times(weight).dividedBy(whole));
  };
  let count = Math.floor(draw([shape.swaps[0], shape.swaps[1] + 1]));
  const volume = at.base.times(draw(shape.turnover));

  if (shape.roundTrips) {
    return split(volume, count).flatMap((amount) => {
      const there = leg(amount, "base");
      return [there, { ...there, into: "counter" as const }];
    });
  }

  const target = anchor.times(1 + shape.swing * wave(age + 1, shape.period)).times(1 + 0.006 * (2 * next() - 1));
  const cap = at.base.times(0.03);
  const delta = BigNumber.min(BigNumber.max(at.base.minus(target), cap.negated()), cap);
  const gross = BigNumber.max(volume, delta.abs().times(1.3));
  if (bothWays) count = Math.max(count, 2);
  if (count === 1) return [leg(BigNumber.max(delta.abs(), gross.dividedBy(2)), delta.gte(0) ? "base" : "counter")];
  const [intoBase, outOfBase] = [gross.plus(delta).dividedBy(2), gross.minus(delta).dividedBy(2)];
  const ins = Math.min(Math.max(Math.round((count * intoBase.toNumber()) / gross.toNumber()), 1), count - 1);
  return [...split(intoBase, ins).map((amount) => leg(amount, "base")), ...split(outOfBase, count - ins).map((amount) => leg(amount, "counter"))];
}

/** The answers the series make, by the pages' requests, and the live volume. */
function syntheticAnswers(derived: DerivedAmm, head: number): SyntheticAnswer[] {
  const T = utcDayOf(head);
  const lastDay = dayBefore(T);
  const answers: SyntheticAnswer[] = [];
  const days = (rows: AmmPoolDay[], marker?: string): Page<"days", AmmPoolDay> => ({ result: "success", count: rows.length, ...(marker !== undefined && { marker }), days: rows });
  const dayOfRow = (row: AmmPoolDay): string => row.date.slice(0, 10);

  for (const { name, pool, days: rows, fills } of seriesOfPools(derived, head)) {
    const shape = SERIES[name];
    const history = `/v2/amm/pools/${pool.amm_account}/history`;
    const pair = `/v2/exchanges/${encodeURIComponent(apiAssetText(baseOf(pool)))}/${encodeURIComponent(apiAssetText(counterOf(pool)))}`;
    for (const period of shape.windows) {
      const window = windowOf(T, period);
      const shown = rows.filter((row) => dayOfRow(row) >= window.start && dayOfRow(row) <= T);
      if (shown.length > DAYS_LIMIT) throw new Error(`${name} ${period}: more days than a page holds`);
      answers.push({ path: history, query: queryOf({ end: T, interval: "day", limit: DAYS_LIMIT, start: window.start }), value: days(shown) });
      const weeks = window.unit === "week";
      const candles = candlesOf(fills, weeks ? "1w" : "1d", `${window.start}T00:00:00Z`, baseOf(pool), counterOf(pool), CANDLES_LIMIT);
      answers.push({ path: pair, query: queryOf({ amm: "only", end: T, interval: weeks ? "7day" : "1day", limit: CANDLES_LIMIT, start: window.start }), value: candles });
    }
    for (const period of shape.carryIns) {
      const end = dayBefore(windowOf(T, period).start);
      const before = rows.filter((row) => dayOfRow(row) <= end);
      const newest = before.at(-1);
      const value = newest === undefined ? days([]) : days([newest], before.length > 1 ? dayMarker(newest) : undefined);
      answers.push({ path: history, query: queryOf({ descending: "true", end, interval: "day", limit: 1 }), value });
    }
    answers.push({ path: history, query: queryOf({ end: lastDay, interval: "day", limit: 1, start: lastDay }), value: days(rows.filter((row) => dayOfRow(row) === lastDay)) });
  }
  answers.push({ path: "/v2/network/amm_volume", query: queryOf({ live: "day" }), value: liveVolume(derived, head) });
  return answers;
}

// ---- The live volume -----------------------------------------------------------------------------------------------------

/**
 * `GET /v2/network/amm_volume?live=day`: the one row of the rolling day that ends at the aggregator's minute before T's close (`[now − 1 day, now)`), drawn from
 * `mulberry32(seedOf("xrpl", "amm_volume", "live"))`, a pool at a time in account order. A component for each live pool with the native currency but VOX/XRP
 * (the pages' pool without swaps); USDC/RLUSD and the other issued-only pools have none (the fixtures have no rate for their assets). As volume-object.ts
 * makes it: the native currency as the `counter`, `amount` the base volume, `converted_amount` the native volume, `rate` = amount / converted at 8 significant
 * digits, the components by `converted_amount` descending then account, `total` their sum and `count` the swaps. The API sums and divides doubles: the native
 * volumes are whole 64ths of a coin, so their sum is exact, and the rate is checked to be the same either way.
 */
function liveVolume(derived: DerivedAmm, head: number): Page<"rows", AmmVolumeRow> {
  const end = Math.floor(head / 60) * 60;
  const next = mulberry32(seedOf("xrpl", "amm_volume", "live"));
  const pools = derived.pools
    .filter((pool) => !pool.deleted && pool.amm_account !== FEATURED_POOLS["VOX/XRP"] && (isNativeAsset(baseOf(pool)) || isNativeAsset(counterOf(pool))))
    .sort((a, b) => byAccount(a.amm_account, b.amm_account));
  const parts = pools.map((pool) => {
    const [u, v, w] = [next(), next(), next()];
    const nativeFirst = isNativeAsset(baseOf(pool));
    const other = nativeFirst ? counterOf(pool) : baseOf(pool);
    const [nativeReserve, otherReserve] = nativeFirst ? [pool.reserve_base, pool.reserve_counter] : [pool.reserve_counter, pool.reserve_base];
    if (nativeReserve === undefined) throw new Error(`${pool.amm_account}: a live pool with the native currency and no native reserve`);
    const converted = new BigNumber(Math.max(1, Math.floor(new BigNumber(nativeReserve).times(0.02 + 0.3 * u).times(64).toNumber()))).dividedBy(64);
    // The units of the other asset a native coin buys: the pool's price, or a draw for a pool whose other reserve the recordings do not hold.
    const price = otherReserve !== undefined ? new Wide(otherReserve).dividedBy(nativeReserve) : new BigNumber(1 + 999 * w);
    let amount = converted.times(price).times(0.997 + 0.006 * v).precision(10, BigNumber.ROUND_HALF_UP);
    const exactRate = () => precision8(new Wide(amount).dividedBy(converted));
    // volume-object.ts divides the doubles; the rate is the same text either way, or the amount moves by its last digit until it is.
    for (let tries = 0; precision8(amount.toNumber() / converted.toNumber()) !== exactRate(); tries++) {
      if (tries === 20) throw new Error(`${pool.amm_account}: no amount whose rate the doubles agree on`);
      amount = amount.plus(new BigNumber(1).shiftedBy((amount.e ?? 0) - 9));
    }
    const component: AmmVolumeComponent = {
      amm_account: pool.amm_account,
      base: other.issuer === undefined ? { currency: other.currency } : { currency: other.currency, issuer: other.issuer },
      counter: { currency: NATIVE },
      count: Math.max(1, Math.round((3 + 60 * u) * (0.7 + 0.6 * w))),
      amount: sumText(amount),
      rate: exactRate(),
      converted_amount: converted.toFixed(),
    };
    return { component, converted };
  });
  parts.sort((a, b) => b.converted.comparedTo(a.converted)! || byAccount(a.component.amm_account, b.component.amm_account));
  const total = parts.reduce((sum, { converted }) => sum.plus(converted), new BigNumber(0));
  if (String(parts.reduce((sum, { converted }) => sum + converted.toNumber(), 0)) !== total.toFixed()) throw new Error("the live volume's total is not its doubles' sum");
  const row: AmmVolumeRow = {
    components: parts.map(({ component }) => component),
    count: parts.reduce((sum, { component }) => sum + component.count, 0),
    exchange: { currency: NATIVE },
    total: total.toFixed(),
    exchange_rate: precision8(1),
    start_time: isoTime(end - DAY_SECONDS),
    end_time: isoTime(end),
  };
  return { result: "success", count: 1, rows: [row] };
}
