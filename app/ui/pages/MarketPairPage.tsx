import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import type { LivePairData, OlderPairData, PairHead, PairPageData, TradeRowView, TradesView } from "../../server/pair-view";
import { candleLegend, Candles } from "../charts/Candles";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { Legend } from "../charts/Legend";
import { AccountLink } from "../components/AccountLink";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { TriangleDownIcon, TriangleUpIcon } from "../components/icons";
import { LiveRow } from "../components/LiveRow";
import { LiveValue } from "../components/LiveValue";
import { Pager } from "../components/Pager";
import { SectionError } from "../components/SectionError";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { cx } from "../cx";
import type { NetworkInfo } from "../networks";
import { holdsFocus, useHolds, type HoldHandlers } from "../use-hold";
import type { LiveControls } from "../use-live-controls";
import { useRefetching } from "../use-refetching";
import { useRetry } from "../use-retry";
import { BookCard, PoolCard, TradersCard } from "./MarketPairSide";

const DASH = "—";

/** The parts of the page that hold it while the visitor is on them (spec 3.10): the two with links. */
type HeldPart = "trades" | "traders";
const HELD_NOTES = {
  trades: "Paused while you look at the trades",
  traders: "Paused while you look at the traders",
} as const satisfies Record<HeldPart, string>;

// ---------------------------------------------------------------------------------------------------------------------------
// The head: the breadcrumb, the pair, its issuers

function Crumbs({ network, head }: { network: NetworkInfo; head: PairHead }) {
  return (
    <Breadcrumbs items={[{ label: network.name, href: `/${network.id}` }, { label: "Markets", href: `/${network.id}/markets` }, { label: head.title }]} />
  );
}

/** "USD issued by rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq · XRP is native": each issuer in full, in mono, a link to its account. */
function Issuers({ head }: { head: PairHead }) {
  const parts: { key: string; node: ReactNode }[] = [
    ...head.issuers.map((issuer, at) => ({
      key: `issuer:${at}`,
      node: (
        <>
          {issuer.code} issued by{" "}
          <Link to={issuer.href} className="mono">
            {issuer.address}
          </Link>
        </>
      ),
    })),
    ...head.natives.map((code, at) => ({ key: `native:${at}`, node: <>{code} is native</> })),
  ];
  return (
    <p className="pair__issuers">
      {parts.map(({ key, node }, at) => (
        <span key={key}>
          {at > 0 && " · "}
          {node}
        </span>
      ))}
    </p>
  );
}

/** The `<h1>`, the link to the other way round (the live page's), and the issuer line. */
function Title({ head, invert }: { head: PairHead; invert: boolean }) {
  return (
    <div className="pair__name">
      <div className="pair__titles">
        <h1 className="pair__title">{head.heading}</h1>
        {invert && (
          <Link to={head.invert.href} className="btn">
            {head.invert.label}
          </Link>
        )}
      </div>
      <Issuers head={head} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The summary: the price, the change, the 24 h figures

/**
 * The last price at the board's size with its unit, then the change after a triangle (a picture: the text says the sign) and "24 h". The change is
 * the 24 h figures' (`stats.change`), kept with them through a beat that failed them.
 */
function Quote({ price, stats }: { price: LivePairData["price"]; stats: LivePairData["stats"] }) {
  const delta = stats.state === "ok" ? stats.change : null;
  const change = delta?.text ?? DASH;
  return (
    <div className="pair__quote">
      <p className="pair__line">
        <span className="pair__price">
          <span className="pair__figure num">
            <LiveValue token={price.text}>{price.text}</LiveValue>
          </span>
          <span className="pair__unit">{price.unit}</span>
        </span>
        <span className="pair__change">
          <span className="pair__delta">
            <LiveValue token={change}>
              {delta?.dir === "up" && <TriangleUpIcon />}
              {delta?.dir === "down" && <TriangleDownIcon />}
              {change}
            </LiveValue>
          </span>
          <span className="faint">24 h</span>
        </span>
      </p>
      {price.note !== null && <p className="pair__note">{price.note}</p>}
    </div>
  );
}

/**
 * The six figures of the 24 hours, labels in --faint and values in mono, each ticking in when it changes. A part that failed reads "—" under
 * each of its labels (the data's), in the same places (so a figure that comes back ticks in), with one error under them.
 */
function Stats({ stats, onRetry, retrying }: { stats: LivePairData["stats"]; onRetry: () => void; retrying: boolean }) {
  const items = stats.state === "ok" ? stats.items : stats.labels.map((label) => ({ label, value: DASH }));
  return (
    <div className="pair__day">
      <dl className="pair__stats">
        {items.map((item, at) => (
          <div key={at} className="pair__stat">
            <dt>{item.label}</dt>
            <dd className="mono">
              <LiveValue token={item.value}>{item.value}</LiveValue>
            </dd>
          </div>
        ))}
      </dl>
      {stats.state === "failed" && <SectionError what="the 24 h figures" onRetry={onRetry} retrying={retrying} />}
      {stats.state === "ok" && stats.note !== null && <p className="pair__day-note">{stats.note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The price chart

/**
 * The price card (spec 3.1, 3.5): the candles over their volume, the interval as segmented links whose label only a screen reader reads (the
 * card's place says what they are), the legend and the Chart/Table toggle. A changed token redraws the candles in place with no ring
 * (`mark={false}`): the forming candle changes with every trade. A failed part is the card's error, in place of all of that.
 */
function PriceCard({ data, onRetry, retrying }: { data: LivePairData; onRetry: () => void; retrying: boolean }) {
  const { candles, filters, head } = data;
  const loaded = candles.state === "ok" ? candles : null;
  const name = `${head.title} price`;
  return (
    <ChartCard
      id="pair-price"
      title="Price"
      source={candles.source}
      what="the price chart"
      state={loaded ? "ok" : "failed"}
      onRetry={onRetry}
      retrying={retrying}
      legend={
        loaded && (
          <div className="pair__chart-controls">
            <SegmentedLinks label="Candle interval" hideLabel links={filters.interval} />
            <Legend items={candleLegend(loaded.data)} />
          </div>
        )
      }
      table={loaded && <ChartTable title={name} data={loaded.data} />}
    >
      {loaded && <Candles title={name} data={loaded.data} mark={false} empty={loaded.empty ?? undefined} />}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The trades

/**
 * The columns of the trades (spec 3.6), at their least 720 px with the padding (2 × 16) and the gaps (16 between each): the time (19
 * characters of 13 px mono), the side, three exact figures, the short taker (11 characters of mono) and the Via tag.
 */
function tradeColumns(net: NetworkInfo["id"], head: PairHead, via: boolean): Column<TradeRowView>[] {
  return [
    {
      id: "time",
      header: "Time (UTC)",
      width: "150px",
      cell: (row) => (
        <Link to={row.txHref} className="mono pair__time">
          {row.time}
          <span className="sr">{row.txHidden}</span>
        </Link>
      ),
    },
    {
      id: "side",
      header: "Side",
      width: "48px",
      cell: (row) => (
        <span className="pair__trade-side">
          {row.dot !== null && <span className="pair__dot" data-dir={row.dot} aria-hidden="true" />}
          {row.side}
        </span>
      ),
    },
    { id: "price", header: "Price", width: "minmax(86px, 1fr)", align: "end", cell: (row) => <span className="mono num pair__trade-price">{row.price}</span> },
    { id: "base", header: head.base, width: "minmax(86px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.base}</span> },
    { id: "counter", header: head.counter, width: "minmax(86px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.counter}</span> },
    { id: "taker", header: "Taker", width: "88px", cell: (row) => <AccountLink net={net} address={row.taker} /> },
    ...(via ? [{ id: "via", header: "Via", width: "44px", cell: (row: TradeRowView) => row.via !== null && <span className="tag">{row.via}</span> }] : []),
  ];
}

/**
 * The recent trades: the table, then Newer and Older. On the live page the rows follow the chain (`DataTable live`) and the table holds the
 * page while the visitor is on it (`holds`); behind a marker they are old history and do neither.
 */
function TradesCard({
  net,
  head,
  trades,
  via,
  live,
  holds,
  className,
}: {
  net: NetworkInfo["id"];
  head: PairHead;
  trades: TradesView;
  via: boolean;
  live: boolean;
  holds?: HoldHandlers;
  className?: string;
}) {
  return (
    <Card title="Recent trades" flush action={<span className="chart__source">{trades.source}</span>} className={className}>
      {/* `pair__hold` has no style: it is the element that holds the page while the visitor is on the table. */}
      <div className="pair__hold" {...holds}>
        <DataTable
          label="Recent trades"
          columns={tradeColumns(net, head, via)}
          rows={trades.rows}
          rowKey={(row) => row.key}
          minWidth={720}
          live={live}
          empty={trades.empty}
          className="pair__trades"
        />
      </div>
      <div className="card__foot pair__pager">
        <Pager newerHref={trades.paging.newerHref} olderHref={trades.paging.olderHref} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pages

/**
 * The live page of a pair (spec 3.1), in the board's order: the breadcrumb with E2's live row beside it; the pair summary (the `<h1>`, the link
 * to the other way round, the issuers, the price, the change and the 24 h figures); the Trades filter with its note (the AMM parts); the price
 * chart; then the recent trades, with the order book, the pool and the most active traders beside them (they wrap under on a phone).
 *
 * The hold (spec 3.10) is the trades table's and the traders list's, the parts with links: the page remembers which one the visitor came to
 * last, and the live row says it. The hold lets go when the page goes away (`useHolds`).
 */
function LivePair({ network, data, live }: { network: NetworkInfo; data: LivePairData; live?: LiveControls }) {
  const refetching = useRefetching();
  // `retrying` is the press's own (use-retry.ts): a beat, which revalidates too, leaves the buttons as they are.
  const { retry, retrying } = useRetry();
  const holds = useHolds(live?.onHold);
  const [heldPart, setHeldPart] = useState<HeldPart>("trades");

  /** The handlers of `useHolds` for a part, which also note that the hold, when there is one, is this part's. */
  const holding = (part: HeldPart): HoldHandlers => {
    const handlers = holds(part);
    return {
      ...handlers,
      onPointerEnter: (event) => {
        if (event.pointerType !== "touch") setHeldPart(part);
        handlers.onPointerEnter(event);
      },
      onFocus: (event) => {
        if (holdsFocus(event.target)) setHeldPart(part);
        handlers.onFocus(event);
      },
    };
  };

  const { head } = data;
  return (
    <div className={cx("pair", refetching && "is-refetching")}>
      <div className="pair__top">
        <Crumbs network={network} head={head} />
        <LiveRow label="Live · updates every ledger" live={live} heldNote={HELD_NOTES[heldPart]} />
      </div>

      <section className="card pair__summary" aria-label="Pair summary">
        <div className="pair__lead">
          <Title head={head} invert />
          <Quote price={data.price} stats={data.stats} />
        </div>
        <Stats stats={data.stats} onRetry={retry} retrying={retrying} />
      </section>

      {data.ammParts && data.filters.trades && (
        <div role="group" aria-label="Filters" className="pair__filters">
          <SegmentedLinks label="Trades" links={data.filters.trades} />
          <span className="pair__filters-note">Applies to the chart, the 24 h figures and the trade list.</span>
        </div>
      )}

      <PriceCard data={data} onRetry={retry} retrying={retrying} />

      <div className="pair__body">
        <TradesCard net={network.id} head={head} trades={data.trades} via={data.ammParts} live holds={holding("trades")} className="pair__main" />
        <div className="pair__side">
          <BookCard data={data} xrpl={network.id === "xrpl"} />
          <PoolCard data={data} />
          <TradersCard data={data} holds={holding("traders")} onRetry={retry} retrying={retrying} />
        </div>
      </div>
    </div>
  );
}

/** The page behind a marker (spec 3.11): old trades, with no live row, no price, chart or book, and a note that leads to the market's page. */
function OlderPair({ network, data }: { network: NetworkInfo; data: OlderPairData }) {
  const { head, note } = data;
  // The link is the part of the note's text that names the market's page; a note that does not hold it has it after its text.
  const at = note.text.indexOf(note.link);
  const before = at < 0 ? `${note.text} ` : note.text.slice(0, at);
  const after = at < 0 ? "" : note.text.slice(at + note.link.length);
  return (
    <div className="pair">
      <div className="pair__top">
        <Crumbs network={network} head={head} />
      </div>
      <section className="card pair__summary" aria-label="Pair summary">
        <Title head={head} invert={false} />
      </section>
      <p className="pair__older">
        {before}
        <Link to={note.href}>{note.link}</Link>
        {after}
      </p>
      <TradesCard net={network.id} head={head} trades={data.trades} via={data.ammParts} live={false} />
    </div>
  );
}

/**
 * The market pair page (`/{net}/markets/{base}/{counter}`, spec 3). Takes what the view builder made of the node's and the data API's answers
 * (`pairPage`, `olderPage`) and never fetches or formats: every price, size, label and href is text in `data`. A part that failed stands alone:
 * the 24 h figures, the chart and the traders are a section error with a Retry, the book and the pool the node's notice (no `role`: the live
 * status is the page's one), and a pool the node does not have is no card.
 *
 * `live` is what the route gives the page for `mode: "live"` (`useLiveControls`): the pause button, the status line and the hold. The page
 * behind a marker has no live row, whatever it is given.
 */
export function MarketPairPage({ network, data, live }: { network: NetworkInfo; data: PairPageData; live?: LiveControls }) {
  return data.mode === "live" ? <LivePair network={network} data={data} live={live} /> : <OlderPair network={network} data={data} />;
}
