import { useId, useRef } from "react";
import { Link, useRevalidator } from "react-router";

import { compactNumber, formatAmount, formatUtc } from "../../domain/format";
import { networkHref, PERIODS } from "../../domain/network-params";
import { pendingNote, type WindowPeriod } from "../../domain/window";
import type { Figure, NetworkPageData } from "../../server/network-view";
import { BarList } from "../charts/BarList";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { ColumnChart } from "../charts/ColumnChart";
import { Legend, legendOf } from "../charts/Legend";
import { LineChart } from "../charts/LineChart";
import { cx } from "../cx";
import { LedgerLink } from "../components/HashLink";
import { LiveRow } from "../components/LiveRow";
import { LiveValue } from "../components/LiveValue";
import { RelativeTime } from "../components/RelativeTime";
import { SectionError } from "../components/SectionError";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { StatGrid, StatTile } from "../components/StatTile";
import type { NetworkInfo } from "../networks";
import { useHolds } from "../use-hold";
import type { LiveControls } from "../use-live-controls";
import { useLiveRows } from "../use-live-rows";
import { useRefetching } from "../use-refetching";
import { ammWording, volumeChart } from "./network-volume";

/** The headline of each network's dashboard (also its title). */
export const NETWORK_TITLES = { xrpl: "XRPL network", xahau: "Xahau network" } as const;

/** What the payments by currency cover, in the card's title. */
const PERIOD_WORDS = {
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  "1y": "last 52 weeks",
} as const satisfies Record<WindowPeriod, string>;

const DASH = "—";
const count = (n: number) => formatAmount(String(n));
/** The notes of a card: the ones it has. */
const notesOf = (...notes: (string | null)[]): string[] => notes.filter((note): note is string => note !== null);

/**
 * Retry of a part that could not be loaded: the route's own data is fetched again, in the browser, from the explorer's own Worker. The page's
 * buttons take no `retrying`. This is not the shared `useRetry` (app/ui/use-retry.ts), which a new page uses: taking that one here measured
 * +118 B on this page (E3's final fix wave), so the network page keeps its own, under a name of its own.
 */
function useRevalidate(): () => void {
  const revalidator = useRevalidator();
  return () => void revalidator.revalidate();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The latest ledgers and the open ledger

type Net = NetworkInfo["id"];

/**
 * The newest ledgers as chips (a list of links to the ledgers) and the open ledger beside them. The chips are keyed by ledger index, so a new
 * ledger enters at the front and the others slide along (`useLiveRows`, on x; README, "Live updates"). A mouse or pen over the strip, or
 * keyboard focus on a chip, holds the page, so that a chip does not move under a click.
 */
function Strip({ net, data, live, onRetry }: { net: Net; data: NetworkPageData; live?: LiveControls; onRetry: () => void }) {
  const list = useRef<HTMLOListElement>(null);
  const holds = useHolds(live?.onHold);
  const entering = useLiveRows(list, data.strip.map((chip) => String(chip.index)), true);

  return (
    <section className="card network__ledgers" aria-label="Latest ledgers">
      {data.strip.length > 0 && (
        <ol ref={list} className="chips network__chips" {...holds("strip")}>
          {data.strip.map((chip) => (
            <li key={chip.index} data-key={chip.index} className={cx("chip", entering.has(String(chip.index)) && "is-entering")}>
              <Link to={`/${net}/ledger/${chip.index}`} className="chip__link">
                <span className="chip__index mono num">{`#${count(chip.index)}`}</span>
                <span className="chip__meta">
                  {`${count(chip.txCount)} txs · `}
                  {/* The stored page has the time of day where the browser has the age: about as long, so the chip is the same height before and after. */}
                  <RelativeTime at={chip.closeTime} fallback={formatUtc(chip.closeTime).slice(11, 19)} />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <OpenLedger part={data.openLedger} onRetry={onRetry} />
    </section>
  );
}

function OpenLedger({ part, onRetry }: { part: NetworkPageData["openLedger"]; onRetry: () => void }) {
  if (part.state !== "ok") {
    return (
      <div className="network__open">
        <SectionError what="the open ledger" onRetry={onRetry} />
      </div>
    );
  }
  const fee = `${formatAmount(part.fee)} drops`;
  const queue = formatAmount(part.queue);
  const size = `${formatAmount(part.openSize)} of ${formatAmount(part.expected)} expected in the open ledger`;
  return (
    <div className="network__open">
      <p>
        Open ledger fee{" "}
        <b className="mono">
          <LiveValue token={fee}>{fee}</LiveValue>
        </b>
      </p>
      <p>
        Queue{" "}
        <b className="mono">
          <LiveValue token={queue}>{queue}</LiveValue>
        </b>
        {" · "}
        <LiveValue token={size}>{size}</LiveValue>
      </p>
      <p>{`as of ${part.asOf} UTC`}</p>
      <p className="chart__source">/v2/network/fee_stats</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The filters and the totals

/** The period and the currency as segmented controls of links, and the period's note: the page's views are URLs (`networkHref`). */
function Filters({ net, native, data }: { net: Net; native: string; data: NetworkPageData }) {
  const { view, displays } = data;
  return (
    <div role="group" aria-label="Filters" className="network__filters">
      <SegmentedLinks
        label="Period"
        links={PERIODS.map(({ id, label }) => ({ label, href: networkHref(net, { ...view, period: id }), current: view.period === id }))}
      />
      {displays.length > 1 && (
        <SegmentedLinks
          label="Amounts in"
          links={displays.map((display) => ({
            label: display === "usd" ? "USD" : native,
            href: networkHref(net, { ...view, display }),
            current: view.display === display,
          }))}
        />
      )}
      <span className="network__note">{data.window.note}</span>
    </div>
  );
}

/**
 * A tile of the totals: its figure, a delta against the full buckets before, and a note. A figure that changes ticks in (`LiveValue`, with the
 * text it shows as its token). `figure` is `null` for the tile of a part that could not be loaded: a dash, and why.
 */
function Tile({ label, figure }: { label: string; figure: Figure | null }) {
  if (figure === null) return <StatTile figure label={label} value={<LiveValue token={DASH}>{DASH}</LiveValue>} sub="Couldn’t load" />;
  return (
    <StatTile
      figure
      label={label}
      value={<LiveValue token={figure.value}>{figure.value}</LiveValue>}
      delta={figure.delta ?? undefined}
      sub={figure.sub !== null ? <LiveValue token={figure.sub}>{figure.sub}</LiveValue> : undefined}
    />
  );
}

function Totals({ data, onRetry }: { data: NetworkPageData; onRetry: () => void }) {
  const { metrics, payments, exchanges, currency } = data;
  const wording = ammWording(data.amm);
  const dex: Figure | null =
    exchanges.state === "ok"
      ? {
          value: `${compactNumber(exchanges.total)} ${currency}`,
          delta: null,
          sub: [wording.dexSub, exchanges.pendingWords].filter((words) => words !== null).join("; "),
        }
      : null;
  return (
    <>
      <StatGrid narrow label="Totals">
        <Tile label="Transactions" figure={metrics.state === "ok" ? metrics.transactions : null} />
        <Tile label="Ledger interval" figure={metrics.state === "ok" ? metrics.interval : null} />
        <Tile label="Transactions per ledger" figure={metrics.state === "ok" ? metrics.perLedger : null} />
        <Tile label="Accounts created" figure={metrics.state === "ok" ? metrics.accountsCreated : null} />
        <Tile label="Payment volume" figure={payments.state === "ok" ? payments.figure : null} />
        <Tile label="DEX volume" figure={dex} />
      </StatGrid>
      {(metrics.state === "failed" || payments.state === "failed" || exchanges.state === "failed") && (
        <SectionError what="some totals" onRetry={onRetry} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The chart cards

function TypesCard({ data, onRetry }: { data: NetworkPageData; onRetry: () => void }) {
  const { types } = data;
  const unit = data.window.unit;
  const title = `Transactions by type, per ${unit}`;
  const chart = types.state === "ok" ? types.chart : null;
  return (
    <ChartCard
      id="network-types"
      title={title}
      source={`/v2/stats/type?interval=${unit}`}
      what="transactions by type"
      state={chart ? "ok" : "failed"}
      onRetry={onRetry}
      legend={chart && <Legend items={legendOf(chart, "swatch")} />}
      table={chart && <ChartTable title={title} data={chart} />}
      notes={chart && types.state === "ok" ? notesOf(types.note, pendingNote(chart.axis.buckets, chart.pending ?? 0, unit)) : undefined}
    >
      {chart && <ColumnChart layout="stacked" title={`Transactions by type per ${unit}`} data={chart} />}
    </ChartCard>
  );
}

function FeesCard({ data, native, onRetry }: { data: NetworkPageData; native: string; onRetry: () => void }) {
  const { fees, openLedger } = data;
  // The fee axis is the window's, weekly for a year: a pending week is told as one.
  const unit = data.window.unit;
  const title = "Average fee per transaction, in drops";
  const chart = fees.state === "ok" ? fees.chart : null;
  const note = `1 ${native} = 1,000,000 drops. Spikes mean the open ledger was busy.`;
  // The last sentence is the open ledger's: it is left out when that part could not be loaded.
  const minimum = openLedger.state === "ok" ? ` The minimum to enter the queue now is ${formatAmount(openLedger.minimum)} drops.` : "";
  return (
    <ChartCard
      id="network-fees"
      title={title}
      source="/v2/network/fees?interval=day"
      what="the average fee"
      state={chart ? "ok" : "failed"}
      onRetry={onRetry}
      table={chart && <ChartTable title={title} data={chart} />}
      notes={chart ? notesOf(`${note}${minimum}`, pendingNote(chart.axis.buckets, chart.pending ?? 0, unit)) : undefined}
      className="network__half"
    >
      {chart && <LineChart title={title} data={chart} area />}
    </ChartCard>
  );
}

function VolumeCard({ data, onRetry }: { data: NetworkPageData; onRetry: () => void }) {
  const { payments, exchanges, amm, currency } = data;
  const unit = data.window.unit;
  const title = `Volume per ${unit}, in ${currency}`;
  const wording = ammWording(amm);
  const chart = volumeChart(payments, exchanges, amm, currency);
  return (
    <ChartCard
      id="network-volume"
      title={title}
      source={wording.source}
      what="payment and DEX volume"
      state={chart ? "ok" : "failed"}
      onRetry={onRetry}
      // The AMM line that is missing is told in the card, above the chart, where both of its views can be seen from: the notes are paragraphs.
      legend={
        chart && (
          <>
            <Legend items={legendOf(chart, "line")} />
            {wording.ammProblem && <SectionError what="AMM swaps" message="AMM swaps couldn’t be loaded." onRetry={onRetry} />}
          </>
        )
      }
      table={chart && <ChartTable title={title} data={chart} />}
      notes={chart ? notesOf(wording.note, pendingNote(chart.axis.buckets, chart.pending ?? 0, unit)) : undefined}
      className="network__half"
    >
      {chart && <LineChart title={title} data={chart} />}
    </ChartCard>
  );
}

function CurrenciesCard({ data, onRetry }: { data: NetworkPageData; onRetry: () => void }) {
  const { payments } = data;
  const title = `Payment volume by currency, ${PERIOD_WORDS[data.view.period]}`;
  const bars = payments.state === "ok" ? payments.byCurrency : null;
  return (
    <ChartCard
      id="network-currencies"
      title={title}
      source="/v2/network/payment_volume · components"
      what="payment volume by currency"
      state={bars && payments.state === "ok" ? "ok" : "failed"}
      onRetry={onRetry}
      table={bars && <ChartTable title={title} data={bars} />}
      notes={bars && payments.state === "ok" ? [payments.currencies] : undefined}
      className="network__wide"
    >
      {bars && <BarList data={bars} />}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The validators

/**
 * How many validators signed the newest ledger, and the five that were first. The count, the ledger and the list tick in when the ledger
 * does (the list is one figure, keyed by the ledger's hash). "All validators" is a link while the page is given where it leads, and the
 * header's "soon" style while it is not (`href` comes from the view builder, which reads the switch).
 */
function ValidatorsCard({ net, part, onRetry }: { net: Net; part: NetworkPageData["validators"]; onRetry: () => void }) {
  const titleId = useId();
  return (
    <section className="card network__validators network__side" aria-labelledby={titleId}>
      <div className="chart__titles">
        <h2 id={titleId} className="chart__title">
          Validators
        </h2>
        <span className="chart__source">{"/v2/ledgers/{hash}/validations"}</span>
      </div>
      {part.state !== "ok" ? (
        <SectionError what="the validators" onRetry={onRetry} />
      ) : (
        <>
          <p className="network__signed">
            <b className="network__count">
              <LiveValue token={part.count}>{part.count}</LiveValue>
            </b>{" "}
            {part.count === "1" ? "validator" : "validators"} signed ledger{" "}
            <LiveValue token={String(part.ledger.index)}>
              <LedgerLink net={net} index={part.ledger.index} />
            </LiveValue>
          </p>
          {part.first.length > 0 && (
            <div className="network__first">
              <p className="network__first-label">First seen</p>
              <LiveValue token={part.ledger.hash}>
                <ol>
                  {part.first.map((validator) => (
                    <li key={validator.key}>
                      <span className="mono">{validator.short}</span>
                      <span>{validator.delay}</span>
                    </li>
                  ))}
                </ol>
              </LiveValue>
            </div>
          )}
          <p className="network__note">Counts every validator the data API’s collectors heard, on the UNL or not.</p>
          {part.href !== null ? (
            <Link to={part.href} className="network__all">
              All validators
            </Link>
          ) : (
            <span className="nav-item is-soon" aria-disabled="true">
              All validators <span className="soon">soon</span>
            </span>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The network dashboard (`/{net}/network`): the heading with its live row, the latest ledgers and the open ledger, the filters, six tiles,
 * and the cards of the board (spec 1.3). Takes what the loader made of the data API's answers (`networkPage`) and never fetches. Every part of
 * `data` stands or fails on its own, and a part that failed is its card's or its tiles' error with a Retry (spec 1.8).
 *
 * The page follows the chain (spec 1.9): a figure that changed ticks in (`LiveValue`), a new chip enters and the others slide (`useLiveRows`),
 * a chart whose data moved is ringed (the kit, by token). Nothing animates on the first render, so a view navigation must remount the
 * page (the route keys it by the scope). While another view loads (`useRefetching`) the charts are dimmed, no skeleton.
 *
 * `live` is what the route gives the page: the pause button, the status line, and the hold, which this page takes while the visitor is on the
 * strip. Without it (a page drawn with no route) there are none of the three.
 */
export function NetworkPage({ network, data, live }: { network: NetworkInfo; data: NetworkPageData; live?: LiveControls }) {
  const refetching = useRefetching();
  const onRetry = useRevalidate();
  const net = network.id;

  return (
    <div className={cx("network", refetching && "is-refetching")}>
      <div className="network__head">
        <h1 className="network__title">{NETWORK_TITLES[net]}</h1>
        <LiveRow label="Live · updates every ledger" live={live} heldNote="Paused while you look at the ledgers" />
      </div>

      <Strip net={net} data={data} live={live} onRetry={onRetry} />
      <Filters net={net} native={network.native} data={data} />
      <Totals data={data} onRetry={onRetry} />
      <TypesCard data={data} onRetry={onRetry} />

      <div className="network__pair">
        <FeesCard data={data} native={network.native} onRetry={onRetry} />
        <VolumeCard data={data} onRetry={onRetry} />
      </div>
      <div className="network__pair">
        <CurrenciesCard data={data} onRetry={onRetry} />
        <ValidatorsCard net={net} part={data.validators} onRetry={onRetry} />
      </div>
    </div>
  );
}
