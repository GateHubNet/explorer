// What the AMM pages show, worked out in the Worker from the data API's answers (spec 2.4 and 3.4). This file holds the list's builder, `ammListPage`, and the two
// pieces every AMM builder shares: the pair as it is displayed (`displayPair`) and a fee as a percent (`feePercent`). The pool page's builders join it in a later task.
// No I/O, no clock, no `Intl`: each number of the page is text that BigNumber wrote in plain decimal (`compactNumber`, `toFixed()`), so no float and no exponent
// reaches a string of the page, whatever form the data API wrote an amount in.
//
// It value-imports `app/domain/market-pair.ts` (issuer checksums, `ripple-address-codec`), so only the Worker, the scripts and the tests import this file: the pages
// get the data it returns, and its types.

import BigNumber from "bignumber.js";

import { accountHref } from "../domain/account-tabs";
import { ammListHref, ammPoolHref } from "../domain/amm-params";
import type { Asset, NativeCode } from "../domain/asset";
import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount, formatCurrency, shortAddress } from "../domain/format";
import { naturalOrientation } from "../domain/market-pair";
import { marketsHref } from "../domain/market-params";
import { trailPaging, type Paging } from "../domain/paging";
import { pendingNote, utcDayOf, windowOf } from "../domain/window";
import type { TimeSeriesData } from "../ui/charts/types";
import { isNative } from "./account-view";
import { anchorOrThrow } from "./anchor";
import type { AmmPool, AmmVolumeComponent, AmmVolumeRow, LastValidated, Page } from "./api-types";
import { issuersOf } from "./markets-view";
import { byDay, volumeOf } from "./network-view";
import type { Network } from "./networks";
import { clock, ledgerLink, unixOf } from "./validator-facts";

const DASH = "—";
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

/** A fee in units of 1/100000 as a percent with three decimals (`300` is `0.300%`, the ledger's largest, `1000`, `1.000%`). */
export function feePercent(units: number): string {
  return `${new BigNumber(units).shiftedBy(-3).toFixed(3)}%`;
}

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
