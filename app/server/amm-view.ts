// What the AMM pages show, worked out in the Worker from the data API's answers (spec 2.4, 3.4 and 3.5). This file holds the list's builder, `ammListPage`, the
// two pieces every AMM builder shares (the pair as it is displayed, `displayPair`, and a fee as a percent, `feePercent`), the pool's figures (the price of a ratio of
// two amounts, the cost of the next bid, the auction slot's interval, the fee votes and the rows of the three activity tabs) and the pool's charts (the sparse day rows
// filled into the window's buckets, `daySeries`, and the five chart cards, `poolCharts`). The pool page's own builder joins them in a later task.
// No I/O, no clock, no `Intl`: each number of the page is text that BigNumber wrote in plain decimal (`compactNumber`, `toFixed()`), so no float and no exponent
// reaches a string of the page, whatever form the data API wrote an amount in.
//
// It value-imports `app/domain/market-pair.ts` (issuer checksums, `ripple-address-codec`), so only the Worker, the scripts and the tests import this file: the pages
// get the data it returns, and its types.

import BigNumber from "bignumber.js";

import { accountHref } from "../domain/account-tabs";
import { ammListHref, ammPoolHref } from "../domain/amm-params";
import { sameAsset, type Asset, type NativeCode } from "../domain/asset";
import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount, formatCurrency, formatPrice, shortAddress } from "../domain/format";
import { naturalOrientation } from "../domain/market-pair";
import { marketsHref } from "../domain/market-params";
import { trailPaging, type Paging } from "../domain/paging";
import { sharePercent } from "../domain/percent";
import { bucketStarts, pendingNote, utcDayOf, windowOf, type PeriodWindow } from "../domain/window";
import type { BarListData, SmallMultiplesData, TimeSeriesData } from "../ui/charts/types";
import { isNative } from "./account-view";
import { anchorOrThrow } from "./anchor";
import type {
  AmmBid,
  AmmGovernanceRow,
  AmmLiquidityEvent,
  AmmPool,
  AmmPoolDay,
  AmmSwap,
  AmmVolumeComponent,
  AmmVolumeRow,
  Candle,
  LastValidated,
  Page,
} from "./api-types";
import { BN, decimalOf, feePercent, ratioOf, valueFloor } from "./exact";
import { issuersOf } from "./markets-view";
import { byDay, volumeOf } from "./network-view";
import type { Network } from "./networks";
import type { AmmInfo } from "./node-rpc";
import { clock, ledgerLink, unixOf } from "./validator-facts";

const DASH = "—";
const MINUS = "−";
const SEPARATOR = " · ";

/** A day the data API has no row for may not be computed yet (spec 3.1, D2b): the one sentence the cards that read the pool's day rows say of it. */
export const NOT_COMPUTED_NOTE = "A day without rows may not be computed yet.";

// ---- The words every AMM builder shares --------------------------------------------------------------------------------------------------------

/**
 * A pool's pair as it is displayed. `first` is the base of E3's natural orientation and `second` its counter; `flipped` says that `first` is the stored counter
 * (the pool is stored the other way round: XRP/RLUSD is stored RLUSD/XRP). `text` is the heading's form (`XRP / RLUSD`), `slug` the form of a breadcrumb, a title and
 * a 404 (`XRP/RLUSD`); both write each currency with `formatCurrency`, so a code with no text shows as the first 8 hex digits.
 */
export interface DisplayPair {
  first: Asset;
  second: Asset;
  flipped: boolean;
  text: string;
  slug: string;
}

/**
 * The display pair of a pool stored as `storedBase` / `storedCounter` (spec 3.4): E3's `naturalOrientation`, which needs no knowledge of the stored order, so a
 * pair of `amm_volume` (whose native currency is the counter) is displayed the same way.
 */
export function displayPair(storedBase: Asset, storedCounter: Asset, native: NativeCode): DisplayPair {
  const { base, counter, inverted } = naturalOrientation(storedBase, storedCounter, native);
  const codes = [formatCurrency(base.currency), formatCurrency(counter.currency)];
  return { first: base, second: counter, flipped: inverted, text: codes.join(" / "), slug: codes.join("/") };
}

/**
 * A fee in units of 1/100000 (the ledger's, the node's and the data API's) as a percent with three decimals: `205` is `0.205%`, `1000` (the largest) is `1.000%`. It is
 * written once, in exact.ts, where the pair page's pool card gets it too, and is re-exported here for the AMM builders.
 */
export { feePercent };

// ---- The data of the list ---------------------------------------------------------------------------------------------------------------------

/** What Task 12's tags say of a list (`ammListMeta`): the asset's display code, whether the deleted pools are included, a page behind a marker, an asset that does not parse. */
export interface AmmListFacts {
  assetLabel?: string;
  deleted: boolean;
  more: boolean;
  error: boolean;
}

/** One tile of the totals; `href` is the pool a tile names, `null` for the others. */
export interface AmmTile {
  label: string;
  value: string;
  sub: string;
  href: string | null;
}

/** A row of the pools table: every field is a string ready to show. */
export interface AmmRowView {
  /** The pool's account: the row's own key. */
  key: string;
  /** `XRP / RLUSD`, the display pair. */
  pair: string;
  /** The display codes of the two sides (the coins, which are decorative). */
  coins: [string, string];
  /** The pool's page. */
  href: string;
  /** `rhWTXC…tcS3 · RLUSD rMxCKb…m5De`: the short account, then each issued side's code and short issuer. */
  detail: string;
  /** The "Deleted" tag. */
  deleted: boolean;
  value: string;
  /** In display order, each with its currency; a reserve the index does not know is `—`. */
  reserves: [string, string];
  fee: string;
  volume: string;
  /** The holder of the auction slot and the page of its account, or `Open` (or `—`) with no link. */
  slot: { text: string; href: string | null };
  /** `#86,800,123` and the ledger, or `—` with no link. */
  created: { text: string; href: string | null };
}

export type Failed = { state: "failed"; what: string };
/** The words over the three tiles, in their order: a failed totals card keeps them, so the page draws three dashes under the same labels. */
export type TileLabels = readonly [string, string, string];

export interface AmmListPageData {
  kind: "list";
  net: Network["id"];
  native: NativeCode;
  meta: AmmListFacts;
  /** The form: the asset as it is written in a URL (or what was typed, when it does not parse), whether the deleted pools are included, and the message under the field. */
  filter: { value: string; deleted: boolean; error?: string };
  totals: { state: "ok"; tiles: [AmmTile, AmmTile, AmmTile]; note: string } | (Failed & { labels: TileLabels });
  chart: { state: "ok"; title: string; source: string; data: TimeSeriesData; note: string | null } | Failed;
  pools:
    | {
        state: "ok";
        source: string;
        rows: AmmRowView[];
        /** What an empty page says, `null` for a page with rows. */
        empty: string | null;
        paging: Paging;
        /** The words under the table when the 24-hour volume could not be loaded, else `null`. */
        note: string | null;
        footnote: string;
      }
    | Failed
    | { state: "skipped" };
}

/** What Xahau's page shows: the explanation, and the link to Xahau's markets while that page is on. */
export interface NoAmmPageData {
  kind: "none";
  marketsHref: string | null;
}

/** The input of `ammListPage`: the outcomes of the loader's calls (spec 2.2). */
export interface AmmListInput {
  net: Pick<Network, "id" | "native" | "features">;
  /** The asset filter: the asset and its URL form; what was typed, cut to 200 characters, when it does not parse; `null` for none. */
  asset: { asset: Asset; text: string } | { error: string } | null;
  deleted: boolean;
  marker?: string;
  back: readonly string[];
  /** #1 */
  last: PromiseSettledResult<LastValidated>;
  /** #2; `null`: not asked (an asset error). */
  pools: PromiseSettledResult<Page<"pools", AmmPool>> | null;
  /** #3 */
  live: PromiseSettledResult<Page<"rows", AmmVolumeRow>>;
  /** #4; `null`: not asked (#1 failed). */
  history: PromiseSettledResult<Page<"rows", AmmVolumeRow>> | null;
}

// ---- The list ---------------------------------------------------------------------------------------------------------------------------------

const TOTALS_WHAT = "the 24-hour volume";
const CHART_WHAT = "the swap volume";
const POOLS_WHAT = "the pools";
const TILE_LABELS: TileLabels = ["Swap volume, 24 h", "Pools with swaps, 24 h", "Busiest pool, 24 h"];
/** The pools card's note while the live set is missing, and the Volume column is `—`: what a `SectionError` says of the totals, in the same words. */
const NO_VOLUME_NOTE = `Couldn’t load ${TOTALS_WHAT}`;
const POOLS_SOURCE = "/v2/amm/pools · ordered by value";
const CHART_SOURCE = "/v2/network/amm_volume?interval=day";
/** An error message cut to what the field of the form repeats of what was typed. */
const ASKED_LENGTH = 200;

/** A JSON number as plain text: BigNumber writes the digits, `String(n)` would write an exponent from 1e21. */
const plain = (n: number): string => new BigNumber(n).toFixed();
/** A count with its thousands grouped. */
const counted = (n: number): string => formatAmount(plain(n));

/** An asset of the data API's flat pair (`base_currency`, `base_issuer?`): the native currency has no issuer. */
const assetOf = (currency: string, issuer: string | undefined): Asset => (issuer === undefined ? { currency } : { currency, issuer });

/** Why a call failed, as a problem says it: the reason's message (a `TooLate` is `took too long`). The problems are logged, never part of the page. */
const reasonText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

/** The words of a swap count: `1,284 swaps`. */
const swapsWords = (count: number): string => `${counted(count)} ${count === 1 ? "swap" : "swaps"}`;

/** The three tiles of the totals (spec 2.1) from the live row. */
function tilesOf(net: AmmListInput["net"], row: AmmVolumeRow): [AmmTile, AmmTile, AmmTile] {
  const { native } = net;
  const busiest = row.components[0];
  return [
    { label: TILE_LABELS[0], value: `${compactNumber(row.total)} ${native}`, sub: swapsWords(row.count), href: null },
    { label: TILE_LABELS[1], value: counted(row.components.length), sub: `that could be priced in ${native}`, href: null },
    busiest
      ? {
          label: TILE_LABELS[2],
          value: displayPair(busiest.base, busiest.counter, native).text,
          sub: `${compactNumber(busiest.converted_amount)} ${native} of swaps`,
          href: ammPoolHref(net.id, busiest.amm_account),
        }
      : { label: TILE_LABELS[2], value: DASH, sub: "no swaps in the last 24 hours", href: null },
  ];
}

/**
 * The auction slot cell: the holder, or `Open` (spec 2.1). A slot is open when it has no holder, or its expiration is not after `now`, the data's own (the live
 * set's `end_time`, else the close time of the newest ledger), so that a stored page does not depend on when it was drawn. Without a `now` a held slot cannot be told
 * from an expired one: `—`.
 */
function slotOf(net: AmmListInput["net"], pool: AmmPool, now: number | null): AmmRowView["slot"] {
  const open = { text: "Open", href: null };
  const holder = pool.auction_slot?.holder;
  if (holder === undefined) return open;
  const held = { text: shortAddress(holder), href: accountHref(net.id, holder, {}) };
  const expires = pool.auction_slot?.expiration === undefined ? Number.NaN : Date.parse(pool.auction_slot.expiration);
  // The ledger sets an expiration with every holder; one that is missing leaves nothing to compare, and the slot as the index has it.
  if (Number.isNaN(expires)) return held;
  if (now === null) return { text: DASH, href: null };
  return expires > now ? held : open;
}

/**
 * A row of the pools table from a pool, the components of the live set by account (`null` when it failed: there is no volume to say) and the data's own time
 * (spec 2.1).
 */
function rowOf(net: AmmListInput["net"], pool: AmmPool, components: ReadonlyMap<string, AmmVolumeComponent> | null, now: number | null): AmmRowView {
  const { native } = net;
  const stored = [assetOf(pool.base_currency, pool.base_issuer), assetOf(pool.counter_currency, pool.counter_issuer)] as const;
  const shown = displayPair(stored[0], stored[1], native);
  // The reserves follow the display order: the first side is the stored counter when the pool is stored the other way round.
  const reserves = shown.flipped ? [pool.reserve_counter, pool.reserve_base] : [pool.reserve_base, pool.reserve_counter];
  const sides = [shown.first, shown.second] as const;
  const reserveText = (at: 0 | 1): string => {
    const reserve = reserves[at];
    return reserve === undefined ? DASH : `${compactNumber(reserve)} ${formatCurrency(sides[at].currency)}`;
  };

  let volume = DASH;
  if (components !== null) {
    const component = components.get(pool.amm_account);
    // A pool that holds the native currency always converts, so a pool with no component had no swaps; one that does not may have had swaps that could not be priced.
    volume = component ? compactNumber(component.converted_amount) : stored.some((asset) => isNative(asset, native)) ? "0" : DASH;
  }

  return {
    key: pool.amm_account,
    pair: shown.text,
    coins: [formatCurrency(shown.first.currency), formatCurrency(shown.second.currency)],
    href: ammPoolHref(net.id, pool.amm_account),
    detail: [shortAddress(pool.amm_account), issuersOf(shown.first, shown.second)].filter((part) => part !== "").join(SEPARATOR),
    deleted: pool.deleted,
    value: pool.deleted || pool.value_native === undefined ? DASH : compactNumber(pool.value_native),
    reserves: [reserveText(0), reserveText(1)],
    fee: pool.trading_fee === undefined ? DASH : feePercent(pool.trading_fee),
    volume,
    slot: slotOf(net, pool, now),
    created: pool.created_ledger === undefined ? { text: DASH, href: null } : ledgerLink(net.id, pool.created_ledger),
  };
}

/**
 * The pools list (spec 2.1 and 2.4) from the outcomes of the loader's calls. Each card stands or fails on its own: a call that was rejected (a `TooLate` included)
 * fails its card, and its reason is in `problems`, which the loader logs and marks the request degraded with, one for each failed card. Nothing in the page data is
 * made of a reason: the cards say what could not be loaded, and never why.
 */
export function ammListPage(input: AmmListInput): { page: AmmListPageData; problems: string[] } {
  const { net, asset } = input;
  const { native } = net;
  const problems: string[] = [];
  const failed = (what: string, reason: unknown): Failed => {
    problems.push(`${what}: ${reasonText(reason)}`);
    return { state: "failed", what };
  };

  // #3: the live row, and the tiles that say what it is. A row the tiles cannot be made of is no row: the column and the note must not use it either. An answer
  // is read as far as it goes (`?.`): one without `rows`, or a `null`, is no row, and so is a failed card and not a throw.
  let liveRow: AmmVolumeRow | null = null;
  let liveAsOf = "";
  let totals: AmmListPageData["totals"];
  const failedTotals = (reason: unknown): AmmListPageData["totals"] => ({ ...failed(TOTALS_WHAT, reason), labels: TILE_LABELS });
  if (input.live.status === "rejected") {
    totals = failedTotals(input.live.reason);
  } else if (!Array.isArray(input.live.value?.rows) || input.live.value.rows[0] == null) {
    totals = failedTotals(new Error("the data API answered no row"));
  } else {
    try {
      const row = input.live.value.rows[0];
      liveAsOf = clock(unixOf(row.end_time));
      totals = { state: "ok", tiles: tilesOf(net, row), note: `As of ${liveAsOf} UTC.` };
      liveRow = row;
    } catch (error) {
      totals = failedTotals(error);
    }
  }

  // The data's own "now": the live set's end, else the newest ledger's close time (none when neither is a time).
  const closedAt = input.last.status === "fulfilled" ? Date.parse(input.last.value?.close_time) : Number.NaN;
  const nowAt = liveRow ? Date.parse(liveRow.end_time) : closedAt;
  const now = Number.isNaN(nowAt) ? null : nowAt;

  // #1 and #4: the chart.
  let chart: AmmListPageData["chart"];
  if (input.last.status === "rejected") {
    chart = failed(CHART_WHAT, input.last.reason);
  } else if (input.history === null) {
    chart = failed(CHART_WHAT, new Error("the volume of the days was not asked for"));
  } else if (input.history.status === "rejected") {
    chart = failed(CHART_WHAT, input.history.reason);
  } else {
    try {
      // E2's window and series: the 30 days up to the UTC day of the newest ledger, the running day marked "so far", a day with no row not computed yet.
      const window = windowOf(utcDayOf(anchorOrThrow(input.last.value).closeTime), "30d");
      const rows = byDay(input.history.value.rows, (row) => row.start_time);
      const { series } = volumeOf(window, rows);
      const data: Omit<TimeSeriesData, "token"> = {
        axis: { unit: window.unit, buckets: window.buckets },
        series: [{ id: "amm", label: "AMM swap volume", slot: 1, values: series.values }],
        format: { kind: "amount", unit: native },
        forming: true,
        pending: series.pending,
        extras: [
          {
            id: "swaps",
            label: "Swaps",
            values: window.buckets.map((bucket) => {
              const row = rows.get(bucket);
              return row ? plain(row.count) : null;
            }),
            format: { kind: "count" },
          },
        ],
      };
      chart = {
        state: "ok",
        title: `AMM swap volume per day, in ${native}, last 30 days`,
        source: CHART_SOURCE,
        data: { ...data, token: tokenOf(data) },
        note: pendingNote(window.buckets, series.pending, window.unit),
      };
    } catch (error) {
      chart = failed(CHART_WHAT, error);
    }
  }

  // #2: the table. An asset that does not parse asks for none.
  const filterAsset = asset !== null && "asset" in asset ? asset : null;
  let pools: AmmListPageData["pools"];
  if (input.pools === null) {
    pools = { state: "skipped" };
  } else if (input.pools.status === "rejected") {
    pools = failed(POOLS_WHAT, input.pools.reason);
  } else {
    try {
      const page = input.pools.value;
      const components = liveRow ? new Map(liveRow.components.map((component) => [component.amm_account, component] as const)) : null;
      const rows = page.pools.map((pool) => rowOf(net, pool, components, now));
      const hrefOf = (to: { marker?: string; back: readonly string[] }): string =>
        ammListHref(net.id, { ...(filterAsset ? { asset: filterAsset.text } : {}), deleted: input.deleted, ...to });
      pools = {
        state: "ok",
        source: POOLS_SOURCE,
        rows,
        empty: rows.length > 0 ? null : filterAsset ? `No pools have ${filterAsset.text}.` : "No pools to show.",
        paging: trailPaging({ marker: input.marker, back: input.back, next: page.marker }, hrefOf),
        note: liveRow ? null : NO_VOLUME_NOTE,
        footnote:
          `Value is twice the ${native} reserve, or twice a reserve at its daily ${native} rate.` +
          (liveRow ? ` Volume 24 h is the swap volume of the last 24 hours in ${native}, as of ${liveAsOf} UTC.` : ""),
      };
    } catch (error) {
      pools = failed(POOLS_WHAT, error);
    }
  }

  // The problems are in the page's order, top to bottom: the totals, the chart, the table.
  const page: AmmListPageData = {
    kind: "list",
    net: net.id,
    native,
    meta: {
      ...(filterAsset ? { assetLabel: formatCurrency(filterAsset.asset.currency) } : {}),
      deleted: input.deleted,
      more: input.marker !== undefined,
      error: asset !== null && "error" in asset,
    },
    filter: {
      value: asset === null ? "" : "asset" in asset ? asset.text : [...asset.error].slice(0, ASKED_LENGTH).join(""),
      deleted: input.deleted,
      ...(asset !== null && "error" in asset ? { error: `Write an asset as ${native}, or as a currency and its issuer: RLUSD.rMxCK…` } : {}),
    },
    totals,
    chart,
    pools,
  };
  return { page, problems };
}

/** Xahau's page: no pools, and a way to its markets while the markets pages are on. */
export function noAmmPage(net: Pick<Network, "id" | "features">): NoAmmPageData {
  return { kind: "none", marketsHref: net.features.markets ? marketsHref(net.id) : null };
}

// ---- The pool's figures -----------------------------------------------------------------------------------------------------------------------

/**
 * `numerator ÷ denominator` to 8 significant digits, half up, as plain decimal text with no trailing zeros and no exponent, whatever the size of the amounts (E3's
 * `ratioOf`, which divides on the amounts scaled into [1, 10) at 80 places). `null` for a zero or a missing divisor, and for what is not a number.
 */
export function exactRatio(numerator: string | undefined, denominator: string | undefined): string | null {
  const [top, bottom] = [decimalOf(numerator), decimalOf(denominator)];
  if (top === null || bottom === null || bottom.isZero()) return null;
  return ratioOf(top, bottom).toFixed();
}

// The auction slot (XLS-30, rippled's AMMBid.cpp and AMMCore.h): a slot lasts 24 hours in 20 intervals; the minimum price of a slot is the pool's LP supply times its
// trading fee, over 100000 and over 25; a bid in the first interval must top the price paid by 5%, and later ones by a premium that falls to nothing by the last.
const AUCTION_INTERVALS = 20;
const TRADING_FEE_SCALE = 100_000;
const MIN_FEE_FRACTION = 25;
const OUTBID_PREMIUM = "1.05";
const PREMIUM_DECAY_POWER = 60;
const BID_SIGNIFICANT_DIGITS = 6;
/** Two hundred decimal places: the divisions of the cost are exact decimals, so nothing is rounded before the last step. */
const BID_ARITHMETIC = BigNumber.clone({ DECIMAL_PLACES: 200, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

/**
 * The cheapest bid that wins the slot now, in LP tokens, rounded UP to 6 significant digits (so that "at least" stays true), as plain decimal text. `min` is the
 * pool's LP supply times its trading fee (units of 1/100000), over 100000 and over 25:
 *
 *   open slot (`null`, or an interval of 20 or more):  min
 *   interval 0:                                        price × 1.05 + min
 *   interval n (1 to 19):                              price × 1.05 × (1 − ((n + 1) / 20)^60) + min
 *
 * `"0"` where nothing is to pay (a fee of 0, an empty pool) and where the cost cannot be worked out (an amount that is no number, or an interval that is not a whole
 * number from 0 to 20): the caller leaves the sentence out, so that a figure that is not known is never stated.
 */
export function nextBidPrice(lpSupply: string, tradingFee: number, slot: { price: string; interval: number } | null): string {
  const supply = decimalOf(lpSupply);
  if (supply === null || !Number.isFinite(tradingFee)) return "0";
  const min = new BID_ARITHMETIC(supply).times(tradingFee).div(TRADING_FEE_SCALE).div(MIN_FEE_FRACTION);

  // The node's `time_interval` is a whole number from 0 to 20; anything else is not an interval of a slot, and the formula has no meaning for it.
  if (slot !== null && !(Number.isInteger(slot.interval) && slot.interval >= 0 && slot.interval <= AUCTION_INTERVALS)) return "0";

  let cost = min;
  if (slot !== null && slot.interval < AUCTION_INTERVALS) {
    const price = decimalOf(slot.price);
    if (price === null) return "0";
    const premium = new BID_ARITHMETIC(price).times(OUTBID_PREMIUM);
    const decay = new BID_ARITHMETIC(slot.interval + 1).div(AUCTION_INTERVALS).pow(PREMIUM_DECAY_POWER);
    cost = (slot.interval === 0 ? premium : premium.times(new BID_ARITHMETIC(1).minus(decay))).plus(min);
  }
  return cost.isFinite() && cost.gt(0) ? cost.precision(BID_SIGNIFICANT_DIGITS, BigNumber.ROUND_UP).toFixed() : "0";
}

/** The interval (0 to 19) a held auction slot is in; `null` for an open one: an interval of 20, no slot, or a slot with no holder. */
export function slotInterval(slot: AmmInfo["auction_slot"]): number | null {
  if (slot === undefined || slot.account === undefined) return null;
  return Number.isInteger(slot.time_interval) && slot.time_interval >= 0 && slot.time_interval < AUCTION_INTERVALS ? slot.time_interval : null;
}

/** The words of an interval: `Interval 14 of 20` for the interval 13 (they count from 1). */
export const intervalText = (interval: number): string => `Interval ${plain(interval + 1)} of ${AUCTION_INTERVALS}`;

/** The unit of a vote's weight (rippled's `VoteWeight`): 1/100000 of the LP tokens, so that the weights of all votes add up to 100000 at most. */
const VOTE_WEIGHT_WHOLE = "100000";
/** A vote's weight in thousandths of a percent of the LP tokens: `21400` is 21.4%. */
const VOTE_WEIGHT_PERCENT_SHIFT = -3;

/**
 * The fee votes as a `BarList` (spec 3.1 and 3.4): one item for each vote slot, the heaviest first and then by account. The item's `value` is the exact percent of the
 * LP tokens the weight is (`21.4`), which only draws the bar; `share` is the whole percent the tip says (`21%`, `<1%` below one half). `net` is for the account's page.
 */
export function voteShares(votes: AmmInfo["vote_slots"], net: string): BarListData {
  const ordered = [...votes].sort((a, b) => b.vote_weight - a.vote_weight || (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
  const items = ordered.map((vote) => ({
    id: vote.account,
    label: shortAddress(vote.account),
    sublabel: `votes for ${feePercent(vote.trading_fee)}`,
    value: new BigNumber(vote.vote_weight).shiftedBy(VOTE_WEIGHT_PERCENT_SHIFT).toFixed(),
    share: sharePercent(plain(vote.vote_weight), VOTE_WEIGHT_WHOLE),
    href: accountHref(net, vote.account, {}),
  }));
  const format: BarListData["format"] = { kind: "percent", unit: "LP tokens" };
  return { items, format, token: tokenOf({ items, format }) };
}

// ---- The rows of the activity tabs ------------------------------------------------------------------------------------------------------------

/** An account in a row: the whole address (the page writes the short form) and the page it links to. */
export interface AccountRef {
  address: string;
  href: string;
}

const accountRef = (net: string, address: string): AccountRef => ({ address, href: accountHref(net, address, {}) });

/** An amount in a column: grouped, every digit kept, with the sign it came with (`+` above 0, U+2212 below), a plain `0`, and a dash for what is no number. */
function signedAmount(value: string | undefined, force?: 1 | -1): string {
  const amount = decimalOf(value);
  if (amount === null) return DASH;
  if (amount.isZero()) return "0";
  const sign = force ?? (amount.isNegative() ? -1 : 1);
  return `${sign === 1 ? "+" : MINUS}${formatAmount(amount.abs().toFixed())}`;
}

/** A swap of the pool, a row of the Swaps tab: every field is a string ready to show, `time` is unix seconds and `hash` the transaction (the time cell links it). */
export interface SwapRow {
  /** `tx_hash:node_index`. */
  key: string;
  time: number;
  hash: string;
  /** What went in, then what came out: `XRP → RLUSD`. */
  direction: string;
  /** `+512.4 XRP`: what the pool received. */
  into: string;
  /** `−1,250 RLUSD`: what the pool paid out. */
  out: string;
  /** The second currency per the first, 8 significant digits (`formatPrice`); `—` for a swap with no amount of the first. */
  price: string;
  taker: AccountRef;
}

/** The two sides a row of the pool's pair names, in the pool's stored order: a swap's, a day's of the pool, a candle's of the pair. */
type StoredSides = Pick<AmmPoolDay, "base_currency" | "base_issuer" | "counter_currency" | "counter_issuer">;

/**
 * Whether the first side of the display pair is the row's counter, from the assets the row names (a row is in the pool's stored pair). A row that names one side only is
 * read from that side: its base being the pair's second, or its counter the pair's first, means flipped; the base being the first, or the counter the second, means
 * not. The pair's own `flipped` is for a row that names neither side, or whose two sides disagree.
 */
function rowIsFlipped(row: StoredSides, pair: DisplayPair): boolean {
  const [base, counter] = [assetOf(row.base_currency, row.base_issuer), assetOf(row.counter_currency, row.counter_issuer)];
  const flipped = sameAsset(base, pair.second) || sameAsset(counter, pair.first);
  const straight = sameAsset(base, pair.first) || sameAsset(counter, pair.second);
  return flipped === straight ? pair.flipped : flipped;
}

/**
 * The rows of the Swaps tab (spec 3.1 and 3.4) in the display pair. The reference: if the base flowed out of the pool, the seller is the pool; otherwise the base
 * went in. The amounts are the pool's own changes, unsigned, so the page puts the signs: `+` on what went in, U+2212 on what came out. The price is the effective
 * one, fee included: the second currency's amount over the first's.
 */
export function swapRows(rows: readonly AmmSwap[], pair: DisplayPair, net: string): SwapRow[] {
  const codes = [formatCurrency(pair.first.currency), formatCurrency(pair.second.currency)] as const;
  return rows.map((row) => {
    const flipped = rowIsFlipped(row, pair);
    const amounts = flipped ? ([row.counter_amount, row.base_amount] as const) : ([row.base_amount, row.counter_amount] as const);
    const baseOut = row.seller === row.amm_account;
    const firstOut = flipped ? !baseOut : baseOut;
    const [inAt, outAt] = firstOut ? ([1, 0] as const) : ([0, 1] as const);
    const withCode = (text: string, at: 0 | 1): string => (text === DASH ? DASH : `${text} ${codes[at]}`);
    const price = exactRatio(amounts[1], amounts[0]);
    return {
      key: `${row.tx_hash}:${plain(row.node_index)}`,
      time: unixOf(row.executed_time),
      hash: row.tx_hash,
      direction: `${codes[inAt]} → ${codes[outAt]}`,
      into: withCode(signedAmount(amounts[inAt], 1), inAt),
      out: withCode(signedAmount(amounts[outAt], -1), outAt),
      price: price === null ? DASH : formatPrice(price),
      taker: accountRef(net, row.taker),
    };
  });
}

/** The tag of a liquidity event. */
export type LiquidityTag = "Create" | "Deposit" | "Withdraw" | "Clawback" | "Delete";
const EVENT_TAGS: Record<AmmLiquidityEvent["event"], LiquidityTag> = { create: "Create", deposit: "Deposit", withdraw: "Withdraw", clawback: "Clawback", delete: "Delete" };

/** An event of the pool's liquidity, a row of the Liquidity tab. The three amounts carry their signs (`+10`, `−10`, a plain `0`); the columns are the display pair's. */
export interface LiquidityRow {
  /** `ledger_index:tx_index`. */
  key: string;
  time: number;
  hash: string;
  event: LiquidityTag;
  /** As served, `""` for an event with none. */
  mode: string;
  /** The first currency's column. */
  first: string;
  /** The second currency's column. */
  second: string;
  lpTokens: string;
  provider: AccountRef;
  /** The sender of a clawback (the issuer: the provider is the holder); `null` for the other events. */
  by: AccountRef | null;
}

/**
 * The rows of the Liquidity tab (spec 3.1 and 3.4). The amounts are signed from the pool's side as served, on the pool's stored base and counter: the pair says which
 * is the first column.
 */
export function liquidityRows(rows: readonly AmmLiquidityEvent[], pair: DisplayPair, net: string): LiquidityRow[] {
  return rows.map((row) => {
    const [first, second] = pair.flipped ? [row.counter_amount, row.base_amount] : [row.base_amount, row.counter_amount];
    return {
      key: `${plain(row.ledger_index)}:${plain(row.tx_index)}`,
      time: unixOf(row.executed_time),
      hash: row.tx_hash,
      event: EVENT_TAGS[row.event],
      mode: row.mode ?? "",
      first: signedAmount(first),
      second: signedAmount(second),
      lpTokens: signedAmount(row.lp_tokens),
      provider: accountRef(net, row.account),
      by: row.event === "clawback" ? accountRef(net, row.initiator) : null,
    };
  });
}

/** A vote or a bid, a row of the Votes and bids tab. */
export interface GovernanceRow {
  /** `ledger_index:tx_index`. */
  key: string;
  time: number;
  hash: string;
  kind: "Vote" | "Bid";
  account: AccountRef;
  /** `Voted for 0.400%`; `Won the auction slot for 1,240 LP tokens; fee 0.030% for the holder and 2 authorized accounts`, the parts the row has. */
  what: string;
  /** A vote's fee after it; `—` for a bid, which carries none. */
  feeAfter: string;
}

/** The sentence of a bid: what it burned, and the fee of the slot after it for the holder and for the accounts it authorized. */
function bidWords(row: AmmBid): string {
  const paid = decimalOf(row.price_paid);
  const slot = row.auction_slot;
  const authorized = Array.isArray(slot?.auth_accounts) ? slot.auth_accounts.length : 0;
  const accounts = authorized === 0 ? null : `${plain(authorized)} authorized ${authorized === 1 ? "account" : "accounts"}`;
  const fee = slot?.discounted_fee === undefined ? null : `fee ${feePercent(slot.discounted_fee)} for the holder`;
  const clause = [fee, accounts].filter((part): part is string => part !== null).join(" and ");
  return `Won the auction slot${paid === null ? "" : ` for ${formatAmount(paid.toFixed())} LP tokens`}${clause === "" ? "" : `; ${clause}`}`;
}

/** The rows of the Votes and bids tab (spec 3.1 and 3.4). */
export function governanceRows(rows: readonly AmmGovernanceRow[], net: string): GovernanceRow[] {
  return rows.map((row) => {
    const common = { key: `${plain(row.ledger_index)}:${plain(row.tx_index)}`, time: unixOf(row.executed_time), hash: row.tx_hash };
    const account = accountRef(net, row.account);
    if (row.type === "vote") {
      return {
        ...common,
        kind: "Vote",
        account,
        what: row.fee_voted === undefined ? "Voted" : `Voted for ${feePercent(row.fee_voted)}`,
        feeAfter: row.trading_fee_after === undefined ? DASH : feePercent(row.trading_fee_after),
      };
    }
    return { ...common, kind: "Bid", account, what: bidWords(row), feeAfter: DASH };
  });
}

// ---- The pool's charts ------------------------------------------------------------------------------------------------------------------------

/** What the five chart cards of a pool are made of (spec 3.2 and 3.5): the window, the pool and its pair, and the outcomes of calls #4, #5 and #6. */
export interface DaySeriesInput {
  window: PeriodWindow;
  pair: DisplayPair;
  native: string;
  /** The pool's account, which the source line of the cards of the day rows names in its short form. */
  pool: string;
  deleted: boolean;
  /** #4, the pool's days in the window, oldest first; `null`: #4 or #5 failed. */
  days: readonly AmmPoolDay[] | null;
  /** #5's row, the pool's last day before the window; `null` when it has none. */
  carryIn: AmmPoolDay | null;
  /** #6, the pair's AMM candles in the pool's stored order; `null`: #6 failed. */
  candles: readonly Candle[] | null;
}

/** One value per bucket of `window.buckets`, as plain decimal text; `null` is a gap: no value, or no pool. The sides are the display pair's. */
export interface DaySeries {
  value: (string | null)[];
  /** The second currency per the first, from the reserves. */
  price: (string | null)[];
  /** The trading fee in percent: `0.205` for 205 units of 1/100000. */
  fee: (string | null)[];
  reserveFirst: (string | null)[];
  reserveSecond: (string | null)[];
  /** The swap volume on the native side (the first side for a pool without the native currency). */
  volume: (string | null)[];
  swaps: (string | null)[];
  feesFirst: (string | null)[];
  feesSecond: (string | null)[];
}

/** The closing state of a day of the pool, in the display pair. */
interface DayState {
  value: string | null;
  price: string | null;
  fee: string | null;
  reserves: readonly [string | null, string | null];
}

const DAY_MS = 86_400_000;

/** A number the API wrote, as plain decimal text; `null` for one it left out or that is no number. */
const plainOf = (text: string | undefined): string | null => decimalOf(text)?.toFixed() ?? null;

/**
 * The UTC day (`YYYY-MM-DD`) that a row or a candle starts, read as a moment as E3's candles are (the API may write `.000Z`); `null` for a time that is no
 * start of a day, which then lands on no bucket.
 */
function startDay(time: string): string | null {
  const at = Date.parse(time);
  return Number.isNaN(at) || at % DAY_MS !== 0 ? null : new Date(at).toISOString().slice(0, 10);
}

/** The state a day's row closes with: a field the row leaves out is `null`, and so is the price when either reserve is 0. */
function stateOf(row: AmmPoolDay, pair: DisplayPair): DayState {
  const [first, second] = rowIsFlipped(row, pair) ? [row.reserve_counter, row.reserve_base] : [row.reserve_base, row.reserve_counter];
  const [a, b] = [decimalOf(first), decimalOf(second)];
  const fee = row.trading_fee;
  return {
    value: plainOf(row.value_native),
    price: a === null || b === null || a.isZero() || b.isZero() ? null : exactRatio(second, first),
    fee: typeof fee === "number" && Number.isFinite(fee) ? new BigNumber(fee).shiftedBy(-3).toFixed() : null,
    reserves: [a?.toFixed() ?? null, b?.toFixed() ?? null],
  };
}

/**
 * A day's fee estimates in the display pair (spec 3.5, rule 4). An estimate is left out when a swap into its side had no known fee: `null`, not known. A row
 * without swaps that leaves one out has had no fee to know: `"0"`.
 */
function feesOf(row: AmmPoolDay, pair: DisplayPair): readonly [string | null, string | null] {
  const [first, second] = rowIsFlipped(row, pair) ? [row.fees_counter_est, row.fees_base_est] : [row.fees_base_est, row.fees_counter_est];
  const known = (estimate: string | undefined): string | null => (estimate === undefined ? (row.swap_count > 0 ? null : "0") : plainOf(estimate));
  return [known(first), known(second)];
}

/** The side of the pair whose volume the chart shows: the native currency's, and the first's for a pool without it (spec 3.5). */
const volumeSide = (pair: DisplayPair, native: string): 0 | 1 => (isNative(pair.second, native) && !isNative(pair.first, native) ? 1 : 0);

/** A candle's volume on a side of the display pair, read from the candle's own assets. */
function candleVolume(candle: Candle, pair: DisplayPair, side: 0 | 1): string | null {
  const volumes = rowIsFlipped(candle, pair) ? [candle.counter_volume, candle.base_volume] : [candle.base_volume, candle.counter_volume];
  return plainOf(volumes[side]);
}

/** The sum of a bucket's days, `null` when any of them is (or when it has none). */
function sumOf(values: readonly (string | null)[]): string | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum.plus(value!), new BN(0)).toFixed();
}

/**
 * The day series and, for each bucket, whether the pool existed in it. The pool's days are a sparse list: a day with no row had no swap, deposit, withdrawal,
 * vote or bid, and a missing row, on any day, is read as a quiet day (spec 3.5, rule 6).
 */
function seriesOf(input: DaySeriesInput): { series: DaySeries; alive: boolean[] } {
  const { window, pair, native, deleted, days, carryIn, candles } = input;
  const T = window.end;
  const { buckets } = window;

  // The days of the window up to T, and the days of each bucket: a week's are its days up to T, so the running week stops at T.
  const calendar = bucketStarts(window.start, T, "day");
  const daysOfBucket: string[][] = buckets.map(() => []);
  let at = 0;
  for (const day of calendar) {
    while (at + 1 < buckets.length && day >= buckets[at + 1]!) at += 1;
    daysOfBucket[at]!.push(day);
  }

  // A row of each day inside the window. A row outside it (the API's `end` is T) is no day of the window.
  const rows = new Map<string, AmmPoolDay>();
  for (const row of days ?? []) {
    const day = startDay(row.date);
    if (day !== null && day >= window.start && day <= T && !rows.has(day)) rows.set(day, row);
  }

  // Rule 1: the pool exists from its first known day, the carry-in's (so from the window's start) or its first row's, and a deleted pool until its last row.
  // Without the day rows its life is not known, and nothing is masked: the flows stand as the candles have them, unmasked.
  const known = [...rows.keys()].sort();
  const from = days === null || carryIn !== null ? window.start : known[0];
  const to = days === null || !deleted ? T : known.at(-1);
  const isAlive = (day: string): boolean => from !== undefined && to !== undefined && day >= from && day <= to;
  const alive = daysOfBucket.map((bucketDays) => bucketDays.some(isAlive));

  // Rule 2: a day with a row takes its state, a quiet day the day before's, and the first days the carry-in's. A bucket takes the state of its last day inside
  // the pool's life: a week the state of its Sunday, of T for the running week, or of the day of the deletion.
  const stateOfDay = new Map<string, DayState>();
  if (days !== null) {
    let state: DayState | null = carryIn === null ? null : stateOf(carryIn, pair);
    for (const day of calendar) {
      const row = rows.get(day);
      if (row !== undefined) state = stateOf(row, pair);
      if (state !== null && isAlive(day)) stateOfDay.set(day, state);
    }
  }
  const states = daysOfBucket.map((bucketDays) => {
    const last = bucketDays.filter(isAlive).at(-1);
    return last === undefined ? null : (stateOfDay.get(last) ?? null);
  });

  // Rule 4: a day with a row takes its estimates, a quiet day inside the pool's life is "0", and a bucket is the sum of its days inside the life.
  const fees = daysOfBucket.map((bucketDays): readonly [string | null, string | null] => {
    const lived = bucketDays.filter(isAlive);
    if (days === null || lived.length === 0) return [null, null];
    const daily = lived.map((day) => {
      const row = rows.get(day);
      return row === undefined ? (["0", "0"] as const) : feesOf(row, pair);
    });
    return [sumOf(daily.map((fee) => fee[0])), sumOf(daily.map((fee) => fee[1]))];
  });

  // Rules 3 and 5: a bucket with a candle takes it, one without (or with a count of 0) is "0", inside the pool's life only: the swaps of an earlier pool of the
  // pair fall before it.
  const byStart = new Map<string, Candle>();
  for (const candle of candles ?? []) {
    const day = startDay(candle.start);
    if (day !== null && !byStart.has(day)) byStart.set(day, candle);
  }
  const side = volumeSide(pair, native);
  const flows = buckets.map((start, i): readonly [string | null, string | null] => {
    if (candles === null || !alive[i]) return [null, null];
    const candle = byStart.get(start);
    return candle !== undefined && candle.count > 0 ? [candleVolume(candle, pair, side), plain(candle.count)] : ["0", "0"];
  });

  return {
    series: {
      value: states.map((state) => state?.value ?? null),
      price: states.map((state) => state?.price ?? null),
      fee: states.map((state) => state?.fee ?? null),
      reserveFirst: states.map((state) => state?.reserves[0] ?? null),
      reserveSecond: states.map((state) => state?.reserves[1] ?? null),
      volume: flows.map((flow) => flow[0]),
      swaps: flows.map((flow) => flow[1]),
      feesFirst: fees.map((fee) => fee[0]),
      feesSecond: fees.map((fee) => fee[1]),
    },
    alive,
  };
}

/**
 * The pool's days filled into the window's buckets (spec 3.5, rules 1 to 6): the states (value, price, fee and reserves) of each bucket's last day, the flows
 * (swap volume and swaps) of the pair's AMM candles, and the fee estimates of the day rows, each `null` where the pool did not exist. Every value is plain decimal
 * text made with BigNumber, whatever form the API wrote it in.
 */
export function daySeries(input: DaySeriesInput): DaySeries {
  return seriesOf(input).series;
}

/** A chart card: its title, source line, chart and notes, or what could not be loaded. */
export type ChartPart<T> = { state: "ok"; title: string; source: string; data: T; notes: string[] } | { state: "failed"; title: string; what: string };

/** The five chart cards of the pool page, in pairs on the page: value and volume, price and fee, then the reserves. */
export interface PoolCharts {
  value: ChartPart<TimeSeriesData>;
  volume: ChartPart<TimeSeriesData>;
  price: ChartPart<TimeSeriesData>;
  fee: ChartPart<TimeSeriesData>;
  reserves: ChartPart<SmallMultiplesData>;
}

const VALUE_NOTE = "A day without activity keeps the value of the day before.";
const FEE_NOTE = "Each vote moves the fee; the Votes and bids tab lists them.";
const RESERVES_NOTE = "Each asset on its own scale.";
const FEES_FAILED_NOTE = "The fee estimates couldn't be loaded.";
/** The titles of the cards where there is no window, and so no period and no pair, to name (#3 failed). */
const BARE_TITLES = { value: "Pool value", volume: "Swap volume", price: "Pool price", fee: "Trading fee", reserves: "Reserves" } as const;

/** A chart's data with E2's token: the hash of all it draws, its extras included. */
const tokened = <T extends object>(data: T): T & { token: string } => ({ ...data, token: tokenOf(data) });

/**
 * The five chart cards of the pool page (spec 3.5 and 3.6), from the day series. Each card stands or fails on its own: without the day rows (#4 or #5) the four
 * cards that read them fail, and the volume is drawn without its fee estimates, from the candles alone; without the candles (#6) the volume card fails; and
 * without a window (`null`: #3 failed) all five do. Every chart marks its running bucket "so far".
 */
export function poolCharts(input: DaySeriesInput | null): PoolCharts {
  if (input === null) {
    const failed = (title: string) => ({ state: "failed" as const, title, what: "the charts" });
    return {
      value: failed(BARE_TITLES.value),
      volume: failed(BARE_TITLES.volume),
      price: failed(BARE_TITLES.price),
      fee: failed(BARE_TITLES.fee),
      reserves: failed(BARE_TITLES.reserves),
    };
  }

  const { window, pair, native, days, candles } = input;
  const { series, alive } = seriesOf(input);
  const codes = [formatCurrency(pair.first.currency), formatCurrency(pair.second.currency)] as const;
  const holdsNative = isNative(pair.first, native) || isNative(pair.second, native);
  const volumeUnit = holdsNative ? native : codes[0];
  const axis = { unit: window.unit, buckets: window.buckets };
  const historySource = `/v2/amm/pools/${shortAddress(input.pool)}/history?interval=day`;
  const titles = {
    value: `Pool value, in ${native}`,
    volume: `Swap volume per ${window.unit}, in ${volumeUnit}`,
    price: `Pool price, ${codes[1]} per ${codes[0]}`,
    fee: BARE_TITLES.fee,
    reserves: BARE_TITLES.reserves,
  };
  const line = (id: string, label: string, values: (string | null)[]): TimeSeriesData["series"] => [{ id, label, slot: 1, values }];

  // The volume: the candles' own figures, which need no note of the days not computed; its fee estimates read the day rows, and do.
  const volume: PoolCharts["volume"] =
    candles === null
      ? { state: "failed", title: titles.volume, what: "the swap volume" }
      : {
          state: "ok",
          title: titles.volume,
          source: `/v2/exchanges/{base}/{counter}?amm=only&interval=${window.unit === "week" ? "7day" : "1day"}`,
          data: tokened<Omit<TimeSeriesData, "token">>({
            axis,
            series: line("volume", "Swap volume", series.volume),
            format: { kind: "amount", unit: volumeUnit },
            forming: true,
            extras: [
              { id: "swaps", label: "Swaps", values: series.swaps, format: { kind: "count" } },
              ...(days === null
                ? []
                : [
                    { id: "fees-first", label: `Fees, est., ${codes[0]}`, values: series.feesFirst, format: { kind: "amount" as const, unit: codes[0] } },
                    { id: "fees-second", label: `Fees, est., ${codes[1]}`, values: series.feesSecond, format: { kind: "amount" as const, unit: codes[1] } },
                  ]),
            ],
          }),
          notes: [
            `Swaps with a ${native} leg of 0.0005 or less are left out, as in every DEX aggregate of the data API.`,
            days === null ? FEES_FAILED_NOTE : NOT_COMPUTED_NOTE,
          ],
        };

  if (days === null) {
    return {
      value: { state: "failed", title: titles.value, what: "the pool value" },
      volume,
      price: { state: "failed", title: titles.price, what: "the pool price" },
      fee: { state: "failed", title: titles.fee, what: "the trading fee" },
      reserves: { state: "failed", title: titles.reserves, what: "the reserves" },
    };
  }

  // A pool of two tokens that is in the window and has no value anywhere: neither asset had a rate in the native currency. A pool not in the window at all has
  // the chart's own "No data", and one that holds the native currency has a value on every day of its life except that of its deletion.
  const valueless = !holdsNative && alive.some(Boolean) && series.value.every((value) => value === null);

  // The price's axis starts at the nice floor of its values (P13), a BigNumber written in plain digits; with no floor above 0 it starts at 0, as a line does.
  const floor = valueFloor(series.price.map((price) => (price === null ? null : new BigNumber(price))));

  const panel = (id: string, asset: Asset, code: string, values: (string | null)[]): SmallMultiplesData["panels"][number] => ({
    id,
    label: code,
    ...(asset.issuer === undefined ? {} : { sublabel: shortAddress(asset.issuer) }),
    values,
    format: { kind: "amount", unit: code },
  });

  return {
    value: {
      state: "ok",
      title: titles.value,
      source: historySource,
      data: tokened<Omit<TimeSeriesData, "token">>({
        axis,
        series: line("value", "Pool value", series.value),
        format: { kind: "value", unit: native },
        forming: true,
      }),
      notes: [valueless ? `No value in ${native}: neither asset of this pool has a ${native} rate.` : VALUE_NOTE, NOT_COMPUTED_NOTE],
    },
    volume,
    price: {
      state: "ok",
      title: titles.price,
      source: historySource,
      data: tokened<Omit<TimeSeriesData, "token">>({
        axis,
        series: line("price", "Pool price", series.price),
        format: { kind: "price", unit: codes[1] },
        ...(floor === null ? {} : { domain: { min: floor.toFixed() } }),
        forming: true,
      }),
      notes: [...(floor === null ? [] : [`The axis starts at ${formatPrice(floor.toFixed())} ${codes[1]}.`]), NOT_COMPUTED_NOTE],
    },
    fee: {
      state: "ok",
      title: titles.fee,
      source: historySource,
      // A line with no domain starts at 0: the fee is drawn from 0, and its axis needs no note.
      data: tokened<Omit<TimeSeriesData, "token">>({ axis, series: line("fee", "Trading fee", series.fee), format: { kind: "percent" }, forming: true }),
      notes: [FEE_NOTE, NOT_COMPUTED_NOTE],
    },
    reserves: {
      state: "ok",
      title: titles.reserves,
      source: historySource,
      data: tokened<Omit<SmallMultiplesData, "token">>({
        axis,
        panels: [panel("first", pair.first, codes[0], series.reserveFirst), panel("second", pair.second, codes[1], series.reserveSecond)],
        forming: true,
      }),
      notes: [RESERVES_NOTE, NOT_COMPUTED_NOTE],
    },
  };
}
