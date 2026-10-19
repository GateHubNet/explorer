import { memo, useEffect, useRef, type ReactNode } from "react";

import { formatAmount } from "../../domain/format";
import { cellOf, type Cell } from "./cells";
import { HoverGroup, useHoverGroup } from "./Cursor";
import { fitScale, fractionOf, niceScale, percent } from "./geometry";
import { emptyText, plotSummary, sliderLabel, tickLabel, valueText } from "./labels";
import type { LegendItem } from "./Legend";
import { Plot } from "./Plot";
import type { CandleData } from "./types";
import { bucketWords } from "./words";

export interface CandlesProps {
  /** The chart's name: the price pane is named for it, and the volume pane for it and "volume". */
  title: string;
  data: CandleData;
}

/** A candle the kit can draw: its four prices, which are numbers (a candle with one that is not is `null`), and its volume, which may be missing. */
interface Bar {
  o: Cell;
  h: Cell;
  l: Cell;
  c: Cell;
  v: Cell | null;
  n: string;
  /** Closed higher, or where it opened. */
  up: boolean;
}

function barOf(candle: CandleData["candles"][number] | undefined): Bar | null {
  if (!candle) return null;
  const [o, h, l, c] = [cellOf(candle.o), cellOf(candle.h), cellOf(candle.l), cellOf(candle.c)];
  if (!o || !h || !l || !c) return null;
  return { o, h, l, c, v: cellOf(candle.v), n: candle.n, up: c.value >= o.value };
}

/** What is said of a candle: its time, its prices, its volume and its trades, which the readout, the tooltip and the slider each write. */
interface Said {
  date: string;
  prices: { letter: "O" | "H" | "L" | "C"; word: "open" | "high" | "low" | "close"; text: string }[];
  volume: string | null;
  trades: { count: string; noun: "trade" | "trades" };
}

/**
 * The legend of the candles and their volume (spec 2.11): a swatch for a candle that closed higher, one for a candle that closed lower and
 * one for the volume columns, in that order, for the page to give to `Legend`. The volume names its unit: "Volume (XRP)".
 */
export function candleLegend(data: CandleData): LegendItem[] {
  const { unit } = data.volume;
  return [
    { id: "up", label: "Closed higher", key: "swatch", slot: "up" },
    { id: "down", label: "Closed lower", key: "swatch", slot: "down" },
    { id: "volume", label: unit ? `Volume (${unit})` : "Volume", key: "swatch", slot: "other" },
  ];
}

/**
 * The readout above the price pane (spec 2.11): the time, then O H L C, "Volume" and the trades, of the candle the group is on (the pointer
 * or the keyboard, in either pane), else the newest one that there is; a bucket with no candle says so. Only this follows the group, so that
 * a pointer move renders the readout and the cursors and not the marks.
 */
function Readout({ count, latest, said, dateOf }: { count: number; latest: number; said: (i: number) => Said | null; dateOf: (i: number) => string }) {
  const active = useHoverGroup()?.active ?? null;
  const i = active !== null && active >= 0 && active < count ? active : latest;
  const line = said(i);
  if (!line) {
    return (
      <p className="candles__readout">
        <span className="candles__time">{dateOf(i)}</span>
        <span>No data</span>
      </p>
    );
  }
  return (
    <p className="candles__readout">
      <span className="candles__time">{line.date}</span>
      {line.prices.map(({ letter, text }) => (
        <span key={letter}>
          {letter} <b>{text}</b>
        </span>
      ))}
      {line.volume && (
        <span>
          Volume <b>{line.volume}</b>
        </span>
      )}
      <span>
        <b>{line.trades.count}</b> {line.trades.noun}
      </span>
    </p>
  );
}

/**
 * Candlesticks over a pane of volume columns (spec 2.2, 2.3 and 2.11). The price pane is a plot with its axis on the right, fitted to the
 * prices and not from 0 (`fitScale`). Each bucket has a slot, and a candle in it: a wick of 1 px from the low to the high and a body from the
 * open to the close, `--up` when it closed higher or where it opened and `--down` when it closed lower, placed in percent of the scale so
 * that the Worker prints the finished chart. A bucket with no candle has its slot and nothing in it. The volume pane under it is a second
 * plot, 64 px high, with an axis of its own from 0, columns in `--series-other`, and the x labels of both.
 *
 * One `HoverGroup` spans the two: the pointer or the keyboard in either marks the bucket in both (the others dim), the readout above follows
 * it, and each slider says in words what is shown (the price slider says the readout's figures, with the letters spelled out). Each pane has
 * the tooltip for its own. Both panes scroll sideways when they are denser than 5 px a bucket (`slots`), each in a region of its own, and a
 * region follows the other so that the volume stays under its candles.
 *
 * Memoised on `title` and the data's `token` (spec 2.9): a beat that brings the same token renders nothing.
 */
export const Candles = memo(
  function Candles({ title, data }: CandlesProps) {
    const { axis, format, volume } = data;
    const count = axis.buckets.length;
    const bars = axis.buckets.map((_, i) => barOf(data.candles[i]));
    const drawn = bars.some((bar) => bar !== null);
    const latest = bars.reduce((last, bar, i) => (bar ? i : last), -1);

    // The prices fit the candles. The volume is from 0 with 3 ticks, as the pane is 64 px high.
    const prices = fitScale(bars.flatMap((bar) => (bar ? [bar.o.value, bar.h.value, bar.l.value, bar.c.value] : [])));
    const volumes = niceScale(bars.map((bar) => bar?.v?.value ?? null), { integer: volume.kind === "count", ticks: 3 });

    // The gutters of the two panes are as wide as the wider labels, so that the plots are as wide as each other and a bucket is at one x.
    const chars = Math.max(
      ...prices.ticks.map((tick) => tickLabel(tick, format.kind).length),
      ...volumes.ticks.map((tick) => tickLabel(tick, volume.kind).length),
    );

    // The words: a price is `valueText` in full, with its unit, and the volume is compact with its unit, as the readout says it.
    const { date, gapReadOut, gapTip } = bucketWords(axis, false, 0);
    const said = (i: number): Said | null => {
      const bar = bars[i];
      if (!bar) return null;
      const price = (cell: Cell): string => valueText(cell.text, format, "full");
      return {
        date: date(i),
        prices: [
          { letter: "O", word: "open", text: price(bar.o) },
          { letter: "H", word: "high", text: price(bar.h) },
          { letter: "L", word: "low", text: price(bar.l) },
          { letter: "C", word: "close", text: price(bar.c) },
        ],
        volume: bar.v ? valueText(bar.v.text, volume, "compact") : null,
        trades: { count: formatAmount(bar.n), noun: Number(bar.n) === 1 ? "trade" : "trades" },
      };
    };

    /** A slider's text for bucket `i`: the date, then what its pane shows (the volume pane has no prices), or why there is none. */
    const readOut =
      (withPrices: boolean) =>
      (i: number): string => {
        const line = said(i);
        if (!line) return gapReadOut(i);
        const parts = [
          ...(withPrices ? [line.prices.map(({ word, text }) => `${word} ${text}`).join(", ")] : []),
          ...(line.volume ? [`volume ${line.volume}`] : []),
          `${line.trades.count} ${line.trades.noun}`,
        ];
        return `${line.date}: ${parts.join("; ")}`;
      };

    /** A pane's tooltip for bucket `i` (spec 2.6): the date, a row for each price (the price pane), the volume and the trades. */
    const tooltip =
      (withPrices: boolean) =>
      (i: number): ReactNode => {
        const line = said(i);
        if (!line) return gapTip(i);
        const row = (value: string, name: string) => (
          <span key={name} className="plot__tip-row">
            <b>{value}</b> <span className="plot__tip-name">{name}</span>
          </span>
        );
        return (
          <>
            <span className="plot__tip-date">{line.date}</span>
            {withPrices && line.prices.map(({ word, text }) => row(text, word))}
            {line.volume && row(line.volume, "volume")}
            {row(line.trades.count, line.trades.noun)}
          </>
        );
      };

    // For a screen reader, each pane is an image of a series: the closing prices, and the volumes (`plotSummary`).
    const summary = (name: string, series: (string | null)[], fmt: CandleData["format"]): string =>
      plotSummary(name, { axis, series: [{ id: "series", label: name, slot: 1, values: series }], format: fmt, token: data.token });

    // The panes are two regions that scroll sideways, each following the other.
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const regions = Array.from(root.current?.querySelectorAll<HTMLElement>(".plot__scroll") ?? []);
      const follow = (from: HTMLElement) => () => {
        for (const other of regions) if (other !== from && other.scrollLeft !== from.scrollLeft) other.scrollLeft = from.scrollLeft;
      };
      const listeners = regions.map((region) => [region, follow(region)] as const);
      for (const [region, listener] of listeners) region.addEventListener("scroll", listener, { passive: true });
      return () => {
        for (const [region, listener] of listeners) region.removeEventListener("scroll", listener);
      };
    }, []);

    return (
      <HoverGroup>
        <div ref={root} className="candles">
          {drawn && <Readout count={count} latest={latest} said={said} dateOf={date} />}
          <Plot
            title={title}
            summary={summary(`${title}, closing price`, bars.map((bar) => bar?.c.text ?? null), format)}
            token={data.token}
            scale={prices}
            kind={format.kind}
            axis={axis}
            xLabels="none"
            placement="bands"
            slots
            yAxis="right"
            yChars={chars}
            empty={drawn ? null : emptyText(axis)}
            cursor={{ count, placement: "bands", label: sliderLabel(title, axis.unit), valueText: readOut(true), tooltip: tooltip(true) }}
          >
            <div className="plot__cols">
              {bars.map((bar, i) => (
                <div key={i} className="col" data-bucket={i}>
                  {bar && (
                    <span className="candle" data-slot={bar.up ? "up" : "down"}>
                      <span
                        className="candle__wick"
                        style={{ bottom: percent(fractionOf(bar.l.value, prices)), height: percent(fractionOf(bar.h.value, prices) - fractionOf(bar.l.value, prices)) }}
                      />
                      <span
                        className="candle__body"
                        style={{
                          bottom: percent(fractionOf(Math.min(bar.o.value, bar.c.value), prices)),
                          height: percent(Math.abs(fractionOf(bar.c.value, prices) - fractionOf(bar.o.value, prices))),
                        }}
                      />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Plot>
          <Plot
            title={`${title}, volume`}
            summary={summary(`${title}, volume`, bars.map((bar) => bar?.v?.text ?? null), volume)}
            token={data.token}
            scale={volumes}
            kind={volume.kind}
            axis={axis}
            placement="bands"
            slots
            yAxis="right"
            yChars={chars}
            height="pane"
            cursor={drawn ? { count, placement: "bands", label: sliderLabel(`${title}, volume`, axis.unit), valueText: readOut(false), tooltip: tooltip(false) } : undefined}
          >
            <div className="plot__cols">
              {bars.map((bar, i) => (
                <div key={i} className="col" data-bucket={i}>
                  {bar?.v && <span className="col__bar col__bar--volume" data-slot="other" style={{ height: percent(fractionOf(bar.v.value, volumes)) }} />}
                </div>
              ))}
            </div>
          </Plot>
        </div>
      </HoverGroup>
    );
  },
  (before, after) => before.title === after.title && before.data.token === after.data.token,
);
