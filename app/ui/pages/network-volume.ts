// What the volume card of the network page says and draws (spec 1.3, "Volume per day | week"). Pure: the page imports it, the tests import it.
// The card's lines come from three calls that each stand or fail on their own, and its wording follows what is known of the AMM.

import { tokenOf } from "../../domain/fnv";
import { compactNumber } from "../../domain/format";
import type { AmmPart, NetworkPageData, SeriesView } from "../../server/network-view";
import type { Series, TimeSeriesData } from "../charts/types";

/** What the page says of the AMM in the DEX tile, the legend, the note and the source line, and whether the AMM has a line or a problem. */
export interface AmmWording {
  /** The DEX line's name in the legend and the table. */
  dexLabel: string;
  /** The same in the end label: "45.5M DEX trades". */
  dexShort: string;
  /** The DEX tile's note. */
  dexSub: string;
  /** The volume card's note. */
  note: string;
  /** The volume card's source line: paths, never a host. */
  source: string;
  /** The AMM part loaded, so the card draws its line. */
  ammLine: boolean;
  /** The AMM part failed, so the card says so, with a Retry. */
  ammProblem: boolean;
}

const SOURCE = "/v2/network/payment_volume · exchange_volume";
const SOURCE_AMM = `${SOURCE} · amm_volume`;
/** With `AMM_DATA` on the API counts swaps as exchanges, so the DEX line includes them whether or not the AMM call answered. */
const INCLUDED = "DEX trades, tracked markets, AMM swaps included";
const NOT_ONE_TOTAL = "DEX trades count the markets the data API tracks; AMM swaps count every pool, so the lines are not parts of one total.";

/** The DEX line's name in the legend and the table, and in the end label, for each state of the AMM part. No network is named in them. */
function dexLine(amm: AmmPart): Pick<AmmWording, "dexLabel" | "dexShort"> {
  const includesSwaps = amm.state === "ok" || amm.state === "failed";
  return { dexLabel: includesSwaps ? INCLUDED : "DEX trades, tracked markets", dexShort: "DEX trades" };
}

/**
 * The words of the volume card for each state of the AMM part (spec 1.3). `ok` and `failed` are the switch on, where the DEX line includes
 * the swaps of the tracked markets: `failed` keeps the `ok` labels and note (the spec gives it none of its own) and has no line, only the
 * problem. `off` is the switch off, where the explorer does not know whether the DEX line includes swaps and says neither. `none` is a network
 * without AMM (Xahau) and names it, `networkName`: "Xahau", "Xahau Testnet".
 */
export function ammWording(amm: AmmPart, networkName: string): AmmWording {
  switch (amm.state) {
    case "ok":
      return {
        ...dexLine(amm),
        dexSub: `AMM swaps ${compactNumber(amm.total)}, all pools`,
        note: NOT_ONE_TOTAL,
        source: SOURCE_AMM,
        ammLine: true,
        ammProblem: false,
      };
    case "failed":
      return {
        ...dexLine(amm),
        dexSub: "tracked markets, AMM swaps included",
        note: NOT_ONE_TOTAL,
        source: SOURCE_AMM,
        ammLine: false,
        ammProblem: true,
      };
    case "off":
      return {
        ...dexLine(amm),
        dexSub: "tracked markets",
        note: "DEX trades count the trades of the markets the data API tracks.",
        source: SOURCE,
        ammLine: false,
        ammProblem: false,
      };
    case "none":
      return {
        ...dexLine(amm),
        dexSub: `order book only, no AMM on ${networkName}`,
        note: `${networkName} has no AMM; DEX trades are order-book trades of the markets the data API tracks.`,
        source: SOURCE,
        ammLine: false,
        ammProblem: false,
      };
  }
}

/** A part's series on the buckets of the chart's axis, by date: a bucket the part does not have is `null`, a bucket it has beyond the axis is left out. */
function alignedTo(buckets: readonly string[], own: SeriesView): (string | null)[] {
  const byDate = new Map(own.buckets.map((bucket, i) => [bucket, own.values[i] ?? null] as const));
  return buckets.map((bucket) => byDate.get(bucket) ?? null);
}

/**
 * The lines of the volume card: Payments (slot 1), the DEX line (slot 2) and, when the AMM part loaded, AMM swaps, all pools (slot 3), in
 * `currency`. `null` when the payments or the exchanges failed: there is no chart without them. The axis is the payments' own; the other
 * parts are aligned to it by date, because a part kept from before midnight (`keepLoaded`) may have another axis. `pending` is the largest
 * of the parts drawn, and the token is that of what is drawn: the parts' tokens, the words of the lines, and the currency.
 */
export function volumeChart(
  payments: NetworkPageData["payments"],
  exchanges: NetworkPageData["exchanges"],
  amm: AmmPart,
  currency: string,
): TimeSeriesData | null {
  if (payments.state !== "ok" || exchanges.state !== "ok") return null;
  const dex = dexLine(amm);
  const axis = payments.series;
  const buckets = axis.buckets;

  const series: Series[] = [
    { id: "payments", label: "Payments", short: "payments", slot: 1, values: alignedTo(buckets, payments.series) },
    { id: "dex", label: dex.dexLabel, short: dex.dexShort, slot: 2, values: alignedTo(buckets, exchanges.series) },
  ];
  const parts = [payments.series, exchanges.series];
  if (amm.state === "ok") {
    series.push({ id: "amm", label: "AMM swaps, all pools", short: "AMM swaps", slot: 3, values: alignedTo(buckets, amm.series) });
    parts.push(amm.series);
  }

  const data: Omit<TimeSeriesData, "token"> = {
    axis: { unit: axis.unit, buckets },
    series,
    format: { kind: "amount", unit: currency },
    forming: axis.forming,
    pending: Math.max(...parts.map((part) => part.pending)),
  };
  return { ...data, token: tokenOf({ parts: parts.map((part) => part.token), lines: series.map((s) => [s.id, s.label, s.short]), currency }) };
}
