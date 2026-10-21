import { Suspense, type CSSProperties, type ReactNode } from "react";
import { Await, Link } from "react-router";

import type {
  AnalyticsData,
  AnalyticsFrame,
  AnalyticsTile,
  BalancesCard,
  CardState,
  ChangesCard,
  CounterpartiesCard,
  PairRow,
  PairsCard,
  SentCard,
  SourceRow,
  ValueCard,
} from "../../server/analytics-view";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { ColumnChart } from "../charts/ColumnChart";
import { InlineBar } from "../charts/InlineBar";
import { Legend, legendOf, type LegendItem } from "../charts/Legend";
import { LineChart } from "../charts/LineChart";
import { SmallMultiples } from "../charts/SmallMultiples";
import type { Delta } from "../charts/types";
import { AccountLink } from "../components/AccountLink";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { SectionError } from "../components/SectionError";
import { StatGrid, StatTile } from "../components/StatTile";
import type { NetworkInfo } from "../networks";
import { useRetry } from "../use-retry";

// The Analytics tab of the account page (spec 1.5 and 3): four tiles and seven cards, drawn from the page data's promises with the chart kit. A
// lazy chunk (`React.lazy`, spec 5): the account page loads it only for this view. It never fetches, and it imports only types from the server:
// every figure, word and link is the view builders' (`app/server/analytics-view.ts`), and this file lays them out.

const DASH = "—";

/** A part of the view as it streams: `null` until its promise settles, then what it settled to. */
type Part<T> = CardState<T> | null;

/** The Retry of every part: the route's data again (`useRetry`). One for the view, so that a press disables each Retry until it is done. */
type Retry = ReturnType<typeof useRetry>;

/** A call that is still running when the page had to be sent (spec 2.6): its card says so instead of "Couldn't load …". */
const stillWorking = (what: string) => `Still working on ${what}. Retry in a few seconds.`;

/**
 * One promise of the page data as a part: a `Suspense` and an `Await` of its own, so that a slow call holds up its card and nothing else. `draw`
 * is called with `null` for the placeholder, and with the settled state after. The promises never reject; one that did would be a failed part.
 */
function Settled<T>({ promise, draw }: { promise: Promise<CardState<T>>; draw: (part: Part<T>) => ReactNode }) {
  return (
    <Suspense fallback={draw(null)}>
      <Await resolve={promise} errorElement={draw({ state: "failed" })}>
        {(part: CardState<T>) => draw(part)}
      </Await>
    </Suspense>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The view

/**
 * The analytics view (spec 1.5): the summary's four tiles, then the account value and the transactions sent side by side, the balance history,
 * the money in and out, where the balance changes come from, and the counterparties and the DEX trading side by side.
 *
 * Keyed by the period: another period is another view, drawn afresh with its placeholders and its charts on Chart again, and never one period's
 * numbers under another's words (spec 3.11). New data of the same period (a Retry) leaves the visitor's choices alone.
 */
export default function AccountAnalytics({ network, analytics }: { network: NetworkInfo; analytics: AnalyticsData }) {
  return <View key={analytics.period} network={network} analytics={analytics} />;
}

/**
 * The frame first, as one `Suspense`/`Await`: until it streams in there is a placeholder (the filter row's status says the view is loading). A frame
 * that failed or came too late is one error for the whole view, and the cards' promises are not read (spec 2.8).
 */
function View({ network, analytics }: { network: NetworkInfo; analytics: AnalyticsData }) {
  const retry = useRetry();
  return (
    <div className="analytics">
      <Suspense
        fallback={
          <div className="analytics__waiting" aria-hidden="true">
            Loading…
          </div>
        }
      >
        <Await resolve={analytics.frame} errorElement={<FrameProblem late={false} retry={retry} />}>
          {(frame: CardState<AnalyticsFrame>) =>
            frame.state === "ok" ? <Cards network={network} frame={frame} analytics={analytics} retry={retry} /> : <FrameProblem late={frame.state === "late"} retry={retry} />
          }
        </Await>
      </Suspense>
    </div>
  );
}

function FrameProblem({ late, retry }: { late: boolean; retry: Retry }) {
  const what = "the analytics";
  return <SectionError what={what} message={late ? stillWorking(what) : undefined} onRetry={retry.retry} retrying={retry.retrying} />;
}

function Cards({ network, frame, analytics, retry }: { network: NetworkInfo; frame: AnalyticsFrame; analytics: AnalyticsData; retry: Retry }) {
  const { native } = network;
  const { unit } = frame.axis;
  // The routes of the parts, for the source line of a part that has not come or could not be drawn: the builders give the same with their data.
  const { sources } = frame;
  const view = { native, retry };

  return (
    <>
      <StatGrid label="Summary">
        <Settled promise={analytics.value} draw={(part) => <Tile label="Account value now" source={sources.value} part={part} />} />
        <Settled promise={analytics.sent} draw={(part) => <Tile label="Transactions sent" source={sources.sent} part={part} />} />
        <Settled promise={analytics.changes} draw={(part) => <Tile label="Fees paid" source={sources.changes} part={part} />} />
        <Settled promise={analytics.counterparties} draw={(part) => <Tile label="Counterparties" source={sources.counterparties} part={part} />} />
      </StatGrid>

      <div className="analytics__row">
        <Settled promise={analytics.value} draw={(part) => <ValueChart {...view} source={sources.value} part={part} />} />
        <Settled promise={analytics.sent} draw={(part) => <SentChart {...view} unit={unit} source={sources.sent} part={part} />} />
      </div>
      <Settled promise={analytics.balances} draw={(part) => <BalancesChart {...view} source={sources.balances} part={part} />} />
      <Settled promise={analytics.changes} draw={(part) => <MoneyChart {...view} unit={unit} source={sources.changes} part={part} />} />
      <Settled
        promise={analytics.changes}
        draw={(part) => <SourcesTable {...view} title={`Where balance changes come from, ${frame.phrase.title}`} source={sources.sources} part={part} />}
      />
      <div className="analytics__row">
        <Settled
          promise={analytics.counterparties}
          draw={(part) => <CounterpartiesTable {...view} net={network.id} source={sources.counterparties} part={part} />}
        />
        <Settled promise={analytics.pairs} draw={(part) => <PairsTable {...view} source={sources.pairs} part={part} />} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The tiles

const SIGNS = { up: 1, down: -1, flat: 0 } as const;

/** The builder's delta as the tile's: the triangle from its direction, and the words after the signed text, as on the network page. */
function deltaOf(delta: AnalyticsTile["delta"]): Delta | undefined {
  return delta ? { text: `${delta.text} ${delta.words}`, sign: SIGNS[delta.direction] } : undefined;
}

/**
 * A tile of the summary (spec 3.3), in E2's figure style with its source line: busy until its part streams in, "—" with why when the part failed
 * or came too late, and otherwise the builder's figure, delta and words.
 */
function Tile({ label, source, part }: { label: string; source: string; part: Part<{ tile: AnalyticsTile }> }) {
  if (part === null) return <StatTile figure busy label={label} value="" source={source} />;
  if (part.state !== "ok") {
    return <StatTile figure label={label} value={DASH} sub={part.state === "late" ? "Still working on it" : "Couldn’t load"} source={source} />;
  }
  const { tile } = part;
  return <StatTile figure label={label} value={tile.figure} delta={deltaOf(tile.delta)} sub={tile.sub ?? undefined} source={tile.source} />;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The chart cards

interface Drawn {
  source: string;
  plot: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
  summary?: ReactNode;
  notes: readonly ReactNode[];
}

/**
 * A chart card of the view in each state of its part: loading before it streams in, the section error of its own `what` when it failed, the
 * same place saying it is still working when it came too late, and the builder's chart, table, legend, summary and notes when it is there.
 */
function ChartPart<T>({
  id,
  title,
  what,
  source,
  part,
  retry,
  className,
  draw,
}: {
  id: string;
  title: string;
  what: string;
  source: string;
  part: Part<T>;
  retry: Retry;
  className?: string;
  draw: (card: { state: "ok" } & T) => Drawn;
}) {
  const drawn = part?.state === "ok" ? draw(part) : null;
  return (
    <ChartCard
      id={id}
      title={title}
      source={drawn?.source ?? source}
      what={what}
      state={part === null ? "loading" : drawn ? "ok" : "failed"}
      message={part?.state === "late" ? stillWorking(what) : undefined}
      onRetry={retry.retry}
      retrying={retry.retrying}
      legend={drawn?.legend}
      summary={drawn?.summary}
      table={drawn?.table}
      notes={drawn?.notes}
      className={className}
    >
      {drawn?.plot}
    </ChartCard>
  );
}

interface ViewProps {
  native: string;
  retry: Retry;
  source: string;
}

/** Account value (spec 3.4): one line, from the builder's floor when it is far above 0. */
function ValueChart({ native, retry, source, part }: ViewProps & { part: Part<ValueCard> }) {
  const title = `Account value, in ${native}`;
  return (
    <ChartPart
      id="analytics-value"
      title={title}
      what="the account value"
      source={source}
      part={part}
      retry={retry}
      className="analytics__half"
      draw={(card) => ({
        source: card.source,
        plot: <LineChart title={title} data={card.chart} />,
        table: <ChartTable title={title} data={card.chart} />,
        notes: card.notes,
      })}
    />
  );
}

/** Transactions sent (spec 3.5): stacked columns of the type groups, "×" over a bucket with a failed one. */
function SentChart({ unit, retry, source, part }: ViewProps & { unit: string; part: Part<SentCard> }) {
  const title = `Transactions sent per ${unit}, by type`;
  return (
    <ChartPart
      id="analytics-sent"
      title={title}
      what="the transactions sent"
      source={source}
      part={part}
      retry={retry}
      className="analytics__half"
      draw={(card) => ({
        source: card.source,
        legend: <Legend items={legendOf(card.chart, "swatch")} />,
        plot: <ColumnChart layout="stacked" title={title} data={card.chart} />,
        table: <ChartTable title={title} data={card.chart} />,
        notes: card.notes,
      })}
    />
  );
}

/** Balance history (spec 3.6): a panel for each of the largest balances; with none, the builder's sentence in both views. */
function BalancesChart({ retry, source, part }: ViewProps & { part: Part<BalancesCard> }) {
  const title = "Balance history, per currency";
  return (
    <ChartPart
      id="analytics-balances"
      title={title}
      what="the balance history"
      source={source}
      part={part}
      retry={retry}
      draw={(card) => {
        const empty = <p className="analytics__empty">{card.empty}</p>;
        return {
          source: card.source,
          plot: card.chart ? <SmallMultiples title={title} data={card.chart} /> : empty,
          table: card.chart ? <ChartTable title={title} data={card.chart} /> : empty,
          notes: card.notes,
        };
      }}
    />
  );
}

/** The legend of a diverging chart: each series with the way it is drawn ("Received, drawn up"). */
const divergingLegend = (items: LegendItem[]): LegendItem[] =>
  items.map((item) => (item.key === "swatch" ? { ...item, label: `${item.label}, drawn ${item.slot === "down" ? "down" : "up"}` } : item));

/** Money in and out (spec 3.7): received up and sent down, with the period's sums between the legend and the plot. */
function MoneyChart({ native, unit, retry, source, part }: ViewProps & { unit: string; part: Part<ChangesCard> }) {
  const title = `Money in and out per ${unit}, in ${native}`;
  return (
    <ChartPart
      id="analytics-money"
      title={title}
      what="the balance changes"
      source={source}
      part={part}
      retry={retry}
      draw={({ money }) => ({
        source: money.source,
        legend: <Legend items={divergingLegend(legendOf(money.chart, "swatch"))} />,
        summary: money.summary && (
          <>
            Received <b>{money.summary.received}</b> · sent <b>{money.summary.sent}</b> · net <b>{money.summary.net}</b> {native}
          </>
        ),
        plot: <ColumnChart layout="diverging" title={title} data={money.chart} />,
        table: <ChartTable title={title} data={money.chart} />,
        notes: money.notes,
      })}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The table cards

/**
 * A table card of the view in each state of its part (spec 3.11): before it streams in, a frame as tall as its table will be (`rows`, the
 * call's row limit) with "Loading…" hidden from assistive technology, in a card that is `aria-busy` as a chart card is; the section error of its own `what` when it failed, or the same place
 * saying it is still working when it came too late; and otherwise the builder's table, or its empty sentence in place of the table, and its notes.
 */
function TablePart<T>({
  title,
  what,
  source,
  rows,
  part,
  retry,
  className,
  draw,
}: {
  title: string;
  what: string;
  source: string;
  rows: number;
  part: Part<T>;
  retry: Retry;
  className?: string;
  draw: (card: { state: "ok" } & T) => { source: string; body: ReactNode; notes: readonly string[] };
}) {
  const drawn = part?.state === "ok" ? draw(part) : null;
  return (
    <Card title={title} flush busy={part === null} action={<span className="chart__source">{drawn?.source ?? source}</span>} className={className}>
      {part === null ? (
        <div className="analytics__table-loading" style={{ "--rows": rows } as CSSProperties} aria-hidden="true">
          Loading…
        </div>
      ) : !drawn ? (
        <div className="analytics__problem">
          <SectionError what={what} message={part.state === "late" ? stillWorking(what) : undefined} onRetry={retry.retry} retrying={retry.retrying} />
        </div>
      ) : (
        <>
          {drawn.body}
          {drawn.notes.length > 0 && (
            <div className="analytics__notes">
              {drawn.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Where balance changes come from (spec 3.8): a row for each cause, its out and in as a bar on one scale for every row, and its sums. */
function SourcesTable({ native, title, retry, source, part }: ViewProps & { title: string; part: Part<ChangesCard> }) {
  return (
    <TablePart
      title={title}
      what="the balance changes"
      source={source}
      rows={8}
      part={part}
      retry={retry}
      draw={({ sources }) => {
        const columns: Column<SourceRow>[] = [
          {
            id: "type",
            header: "Change type",
            width: "minmax(160px, 1fr)",
            cell: (row) => (
              <span className="analytics__type">
                <span>{row.name}</span>
                <span className="analytics__hint">{row.hint}</span>
              </span>
            ),
          },
          {
            id: "bar",
            header: "Out · In",
            width: "minmax(180px, 1.6fr)",
            cell: (row) => row.bar && <InlineBar diverging out={row.bar.out} in={row.bar.in} max={sources.max} />,
          },
          { id: "in", header: `In, ${native}`, width: "minmax(110px, 1fr)", align: "end", cell: (row) => <span className="amt plain num">{row.in}</span> },
          { id: "out", header: `Out, ${native}`, width: "minmax(110px, 1fr)", align: "end", cell: (row) => <span className="amt plain num">{row.out}</span> },
          { id: "net", header: `Net, ${native}`, width: "minmax(110px, 1fr)", align: "end", cell: (row) => <span className="amt num">{row.net}</span> },
          { id: "changes", header: "Changes", width: "80px", align: "end", cell: (row) => <span className="num muted">{row.changes}</span> },
        ];
        const legend: LegendItem[] = [
          { id: "out", label: "Out, to the left", key: "swatch", slot: "down" },
          { id: "in", label: "In, to the right", key: "swatch", slot: "up" },
        ];
        return {
          source: sources.source,
          body:
            sources.empty !== null ? (
              <p className="analytics__empty">{sources.empty}</p>
            ) : (
              <>
                <div className="analytics__legend">
                  <Legend items={legend} />
                </div>
                <DataTable label={title} columns={columns} rows={sources.rows} rowKey={(row) => row.id} minWidth={900} />
              </>
            ),
          notes: [sources.note],
        };
      }}
    />
  );
}

/** Top counterparties (spec 3.9): each a link to its account, with what was sent to it and received from it. */
function CounterpartiesTable({ native, net, retry, source, part }: ViewProps & { net: NetworkInfo["id"]; part: Part<CounterpartiesCard> }) {
  const title = "Top counterparties, by value";
  return (
    <TablePart
      title={title}
      what="the counterparties"
      source={source}
      rows={6}
      part={part}
      retry={retry}
      className="analytics__table-half"
      draw={(card) => {
        const columns: Column<CounterpartiesCard["rows"][number]>[] = [
          { id: "account", header: "Counterparty", width: "minmax(130px, 1fr)", ellipsis: true, cell: (row) => <AccountLink net={net} address={row.account} /> },
          { id: "sent", header: `Sent, ${native}`, width: "minmax(100px, 1fr)", align: "end", cell: (row) => <span className="amt plain num">{row.sent}</span> },
          { id: "received", header: `Received, ${native}`, width: "minmax(100px, 1fr)", align: "end", cell: (row) => <span className="amt plain num">{row.received}</span> },
          { id: "payments", header: "Payments", width: "70px", align: "end", cell: (row) => <span className="num muted">{row.payments}</span> },
        ];
        return {
          source: card.source,
          body:
            card.empty !== null ? (
              <p className="analytics__empty">{card.empty}</p>
            ) : (
              <DataTable label={title} columns={columns} rows={card.rows} rowKey={(row) => row.account} minWidth={480} />
            ),
          notes: card.note === null ? [] : [card.note],
        };
      }}
    />
  );
}

/** A pair: its name, a link to its page when the data gives one, over the issuers of its issued sides. */
function Pair({ row }: { row: PairRow }) {
  return (
    <span className="analytics__pair">
      {row.href ? <Link to={row.href}>{row.label}</Link> : <span>{row.label}</span>}
      {row.issued.length > 0 && <span className="analytics__issuers mono">{row.issued.join(" · ")}</span>}
    </span>
  );
}

/** DEX trading (spec 3.10): each pair in its natural orientation, with Bought and Sold of the base as shown. */
function PairsTable({ native, retry, source, part }: ViewProps & { part: Part<PairsCard> }) {
  const title = "DEX trading, per pair";
  return (
    <TablePart
      title={title}
      what="the DEX trading"
      source={source}
      rows={6}
      part={part}
      retry={retry}
      className="analytics__table-half"
      draw={(card) => {
        const columns: Column<PairRow>[] = [
          { id: "pair", header: "Pair", width: "minmax(110px, 1.2fr)", cell: (row) => <Pair row={row} /> },
          { id: "volume", header: `Volume, ${native}`, width: "minmax(90px, 1fr)", align: "end", cell: (row) => <span className="amt num">{row.volume}</span> },
          { id: "trades", header: "Trades", width: "60px", align: "end", cell: (row) => <span className="num muted">{row.trades}</span> },
          { id: "bought", header: "Bought", width: "minmax(80px, 1fr)", align: "end", cell: (row) => <span className="amt plain num">{row.bought}</span> },
          { id: "sold", header: "Sold", width: "minmax(80px, 1fr)", align: "end", cell: (row) => <span className="amt plain num">{row.sold}</span> },
        ];
        return {
          source: card.source,
          body:
            card.empty !== null ? (
              <p className="analytics__empty">{card.empty}</p>
            ) : (
              <DataTable label={title} columns={columns} rows={card.rows} rowKey={(row) => row.id} minWidth={520} />
            ),
          notes: card.notes,
        };
      }}
    />
  );
}
