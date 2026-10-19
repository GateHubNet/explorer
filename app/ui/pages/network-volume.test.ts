import { describe, expect, it } from "vitest";

import type { AmmPart, ExchangesView, PaymentsView, SeriesView } from "../../server/network-view";
import { ammWording, volumeChart } from "./network-volume";

// What the volume card says of the AMM (spec 1.3, "Volume per day | week"): the wording of each of its four states, and the chart the card
// draws from the payments, the DEX trades and the AMM swaps, which come from three calls and may not share an axis.

const DAYS = ["2026-10-15", "2026-10-16", "2026-10-17"];

const series = (buckets: string[], values: (string | null)[], pending = 0, token = "series"): SeriesView => ({
  buckets,
  unit: "day",
  values,
  pending,
  forming: true,
  token,
});

function paymentsOk(own: SeriesView): { state: "ok" } & PaymentsView {
  return {
    state: "ok",
    series: own,
    figure: { value: "30 XRP", delta: null, sub: null },
    byCurrency: { items: [], format: { kind: "amount", unit: "XRP" }, token: "by-currency" },
    currencies: "",
  };
}
const exchanges = (own: SeriesView): { state: "ok" } & ExchangesView => ({ state: "ok", series: own, total: "18", pendingWords: null });
const amm = (own: SeriesView, total = "1200000000"): AmmPart => ({ state: "ok", series: own, total });

const PAYMENTS = series(DAYS, ["10", "20", null], 1, "p1");
const EXCHANGES = series(DAYS, ["5", "6", null], 1, "x1");

describe("ammWording", () => {
  it("ok: the DEX line includes AMM swaps, the tile names the AMM total (compact), and the note says the lines are not parts of one total", () => {
    expect(ammWording(amm(PAYMENTS, "1200000000"))).toEqual({
      dexLabel: "DEX trades, tracked markets, AMM swaps included",
      dexShort: "DEX trades",
      dexSub: "AMM swaps 1.2B, all pools",
      note: "DEX trades count the markets the data API tracks; AMM swaps count every pool, so the lines are not parts of one total.",
      source: "/v2/network/payment_volume · exchange_volume · amm_volume",
      ammLine: true,
      ammProblem: false,
    });
  });

  it("ok: the total is compacted like every figure (a small one keeps its digits)", () => {
    expect(ammWording(amm(PAYMENTS, "845.5")).dexSub).toBe("AMM swaps 845.5, all pools");
    expect(ammWording(amm(PAYMENTS, "45500000")).dexSub).toBe("AMM swaps 45.5M, all pools");
  });

  it("failed: the same labels and note, no AMM line, and the problem to report", () => {
    expect(ammWording({ state: "failed", reason: "data API GET /v2/network/amm_volume answered 503" })).toEqual({
      dexLabel: "DEX trades, tracked markets, AMM swaps included",
      dexShort: "DEX trades",
      dexSub: "tracked markets, AMM swaps included",
      note: "DEX trades count the markets the data API tracks; AMM swaps count every pool, so the lines are not parts of one total.",
      source: "/v2/network/payment_volume · exchange_volume · amm_volume",
      ammLine: false,
      ammProblem: true,
    });
  });

  it("off (AMM_DATA is off): the explorer does not know whether the DEX line includes swaps, so it says neither; no AMM source", () => {
    const off = ammWording({ state: "off" });
    expect(off).toEqual({
      dexLabel: "DEX trades, tracked markets",
      dexShort: "DEX trades",
      dexSub: "tracked markets",
      note: "DEX trades count the trades of the markets the data API tracks.",
      source: "/v2/network/payment_volume · exchange_volume",
      ammLine: false,
      ammProblem: false,
    });
    expect(off.source).not.toContain("amm_volume");
  });

  it("none (Xahau): order book only, and the note says there is no AMM", () => {
    const none = ammWording({ state: "none" });
    expect(none).toEqual({
      dexLabel: "DEX trades, tracked markets",
      dexShort: "DEX trades",
      dexSub: "order book only, no AMM on Xahau",
      note: "Xahau has no AMM; DEX trades are order-book trades of the markets the data API tracks.",
      source: "/v2/network/payment_volume · exchange_volume",
      ammLine: false,
      ammProblem: false,
    });
    expect(none.source).not.toContain("amm_volume");
  });
});

describe("volumeChart", () => {
  it("draws Payments and the DEX line on the payments' axis, in slots 1 and 2, with the short names of the end labels", () => {
    const chart = volumeChart(paymentsOk(PAYMENTS), exchanges(EXCHANGES), { state: "none" }, "XRP")!;
    expect(chart.axis).toEqual({ unit: "day", buckets: DAYS });
    expect(chart.series.map(({ id, label, short, slot }) => ({ id, label, short, slot }))).toEqual([
      { id: "payments", label: "Payments", short: "payments", slot: 1 },
      { id: "dex", label: "DEX trades, tracked markets", short: "DEX trades", slot: 2 },
    ]);
    expect(chart.series.map((s) => s.values)).toEqual([["10", "20", null], ["5", "6", null]]);
    expect(chart.format).toEqual({ kind: "amount", unit: "XRP" });
    expect(chart.forming).toBe(true);
    expect(chart.totals).toBeUndefined();
  });

  it("adds AMM swaps, all pools, in slot 3, when the AMM state is ok, and labels the DEX line as including them", () => {
    const chart = volumeChart(paymentsOk(PAYMENTS), exchanges(EXCHANGES), amm(series(DAYS, ["1", "2", null], 1, "a1")), "USD")!;
    expect(chart.series.map(({ id, label, short, slot }) => ({ id, label, short, slot }))).toEqual([
      { id: "payments", label: "Payments", short: "payments", slot: 1 },
      { id: "dex", label: "DEX trades, tracked markets, AMM swaps included", short: "DEX trades", slot: 2 },
      { id: "amm", label: "AMM swaps, all pools", short: "AMM swaps", slot: 3 },
    ]);
    expect(chart.series[2]!.values).toEqual(["1", "2", null]);
    expect(chart.format).toEqual({ kind: "amount", unit: "USD" });
  });

  it("has no AMM line while the AMM part failed, but keeps the DEX line's wording", () => {
    const chart = volumeChart(paymentsOk(PAYMENTS), exchanges(EXCHANGES), { state: "failed", reason: "x" }, "XRP")!;
    expect(chart.series.map((s) => s.id)).toEqual(["payments", "dex"]);
    expect(chart.series[1]!.label).toBe("DEX trades, tracked markets, AMM swaps included");
  });

  it("has no AMM line when the switch is off", () => {
    expect(volumeChart(paymentsOk(PAYMENTS), exchanges(EXCHANGES), { state: "off" }, "XRP")!.series.map((s) => s.id)).toEqual(["payments", "dex"]);
  });

  it("aligns a part whose axis starts a day earlier to the payments' axis, by date", () => {
    // A part kept from before midnight: its newest bucket is yesterday, and it has a day the payments do not.
    const early = series(["2026-10-14", "2026-10-15", "2026-10-16"], ["1", "5", "6"], 0, "x0");
    const chart = volumeChart(paymentsOk(PAYMENTS), exchanges(early), amm(early, "1"), "XRP")!;
    expect(chart.axis.buckets).toEqual(DAYS);
    expect(chart.series[1]!.values).toEqual(["5", "6", null]);
    expect(chart.series[2]!.values).toEqual(["5", "6", null]);
  });

  it("leaves a bucket the other part does not have as null, not as 0", () => {
    const later = series(["2026-10-16", "2026-10-17"], ["6", "7"]);
    expect(volumeChart(paymentsOk(PAYMENTS), exchanges(later), { state: "none" }, "XRP")!.series[1]!.values).toEqual([null, "6", "7"]);
  });

  it("is null when the payments failed, and when the exchanges failed: a volume chart without them is no chart", () => {
    expect(volumeChart({ state: "failed", reason: "x" }, exchanges(EXCHANGES), { state: "none" }, "XRP")).toBeNull();
    expect(volumeChart(paymentsOk(PAYMENTS), { state: "failed", reason: "x" }, { state: "none" }, "XRP")).toBeNull();
  });

  it("has the largest pending of the parts it draws", () => {
    const none = (n: number) => series(DAYS, ["1", "2", null], n);
    expect(volumeChart(paymentsOk(none(1)), exchanges(none(0)), { state: "none" }, "XRP")!.pending).toBe(1);
    expect(volumeChart(paymentsOk(none(0)), exchanges(none(2)), { state: "none" }, "XRP")!.pending).toBe(2);
    expect(volumeChart(paymentsOk(none(0)), exchanges(none(0)), amm(none(1)), "XRP")!.pending).toBe(1);
    // The AMM part is not drawn while it failed or is off: its pending does not count.
    expect(volumeChart(paymentsOk(none(0)), exchanges(none(0)), { state: "off" }, "XRP")!.pending).toBe(0);
  });

  it("has a token that follows what is drawn: the values, the lines, their words and the currency", () => {
    const token = (p = PAYMENTS, x = EXCHANGES, a: AmmPart = { state: "none" }, currency = "XRP") => volumeChart(paymentsOk(p), exchanges(x), a, currency)!.token;
    const base = token();
    expect(base).toMatch(/^[0-9a-f]{8}$/);
    expect(token()).toBe(base);
    expect(token(series(DAYS, ["10", "20", null], 1, "p2"))).not.toBe(base);
    expect(token(PAYMENTS, series(DAYS, ["5", "6", null], 1, "x2"))).not.toBe(base);
    expect(token(PAYMENTS, EXCHANGES, amm(series(DAYS, ["1", "2", null], 1, "a1")))).not.toBe(base);
    // Same parts, other words for the DEX line (the AMM part failed: the line says AMM swaps are included).
    expect(token(PAYMENTS, EXCHANGES, { state: "failed", reason: "x" })).not.toBe(base);
    expect(token(PAYMENTS, EXCHANGES, { state: "none" }, "USD")).not.toBe(base);
  });
});
