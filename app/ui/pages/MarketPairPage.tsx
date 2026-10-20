import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";

import type { BookLevel, BookParts, LivePairData, OlderPairData, PairHead, PairPageData, TradeRowView, TradesView } from "../../server/pair-view";
import { BarList } from "../charts/BarList";
import { candleLegend, Candles } from "../charts/Candles";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { InlineBar } from "../charts/InlineBar";
import { Legend } from "../charts/Legend";
import { AccountLink } from "../components/AccountLink";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { TriangleDownIcon, TriangleUpIcon } from "../components/icons";
import { LiveRow } from "../components/LiveRow";
import { LiveStateNotice } from "../components/LiveStateNotice";
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

const DASH = "—";

/** The parts of the page that hold it while the visitor is on them (spec 3.10): the two with links. */
type HeldPart = "trades" | "traders";
const HELD_NOTES = {
  trades: "Paused while you look at the trades",
  traders: "Paused while you look at the traders",
} as const satisfies Record<HeldPart, string>;

/** The node notices (spec 3.4): what is missing, and what is not. */
const BOOK_BODY =
  "The network node did not answer, so the order book is missing. Trades and prices on this page are from the explorer’s index and are not affected.";
const POOL_BODY =
  "The network node did not answer, so the pool’s reserves and fee are missing. Trades and prices on this page are from the explorer’s index and are not affected.";

/** The six 24 h figures by their labels, for a part that failed and so brought none: the view builder's labels when it loads (`statsOf`). */
const statLabels = (head: PairHead): string[] => ["24 h high", "24 h low", "VWAP 24 h", `Volume ${head.base}`, `Volume ${head.counter}`, "Trades 24 h"];

/**
 * A source line that ends with a ledger number (`live from the node · book_offers · ledger #107,721,455`), the number a figure that ticks in
 * when it changes (`LiveValue`): a book or a pool kept through a failing beat says how old it is, and a fresh one says it moved.
 */
function LedgerSource({ text, ledger }: { text: string; ledger: string }) {
  if (!text.endsWith(ledger)) return <>{text}</>;
  return (
    <>
      {text.slice(0, text.length - ledger.length)}
      <LiveValue token={ledger}>{ledger}</LiveValue>
    </>
  );
}

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
          <Link to={head.invert.href} className="btn pair__invert">
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

/** The last price at the board's size with its unit, then the change after a triangle (a picture: the text says the sign) and "24 h". */
function Quote({ price }: { price: LivePairData["price"] }) {
  const change = price.change?.text ?? DASH;
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
              {price.change?.dir === "up" && <TriangleUpIcon />}
              {price.change?.dir === "down" && <TriangleDownIcon />}
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
 * The six figures of the 24 hours, labels in --faint and values in mono, each ticking in when it changes. A part that failed reads "—" in
 * each, in the same places (so a figure that comes back ticks in), with one error under them.
 */
function Stats({ head, stats, onRetry }: { head: PairHead; stats: LivePairData["stats"]; onRetry: () => void }) {
  const items = stats.state === "ok" ? stats.items : statLabels(head).map((label) => ({ label, value: DASH }));
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
      {stats.state === "failed" && <SectionError what="the 24 h figures" onRetry={onRetry} />}
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
function PriceCard({ data, onRetry }: { data: LivePairData; onRetry: () => void }) {
  const { candles, filters, head } = data;
  const loaded = candles.state === "ok" ? candles : null;
  const name = `${head.title} price`;
  return (
    <ChartCard
      id="pair-price"
      title="Price"
      source={loaded ? loaded.source : "/v2/exchanges/{base}/{counter}"}
      what="the price chart"
      state={loaded ? "ok" : "failed"}
      onRetry={onRetry}
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
      <div className="pair__hold" {...holds}>
        <DataTable
          label="Recent trades"
          columns={tradeColumns(net, head, via)}
          rows={trades.rows}
          rowKey={(row) => row.key}
          minWidth={720}
          live={live}
          empty="No trades yet."
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
// The order book

/** A level of a side: its side in text for a screen reader, the depth bar behind the row (a picture), then the price, the size and the total. */
function Level({ side, level }: { side: "Ask" | "Bid"; level: BookLevel }) {
  return (
    <tr className="pair__level">
      {/* The bar is placed in the row (`position: relative`), not in this cell, which is as wide as nothing. */}
      <td className="pair__book-side">
        <span className="sr">{side}</span>
        <InlineBar value={level.depth} max="1" tone={side === "Ask" ? "down" : "up"} />
      </td>
      <td className="pair__level-price mono">{level.price}</td>
      <td>{level.size}</td>
      <td className="muted">{level.total}</td>
    </tr>
  );
}

function NoLevel({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={4} className="pair__book-empty">
        {text}
      </td>
    </tr>
  );
}

/**
 * The book as one table (spec 3.4): the asks with the best last, nearest the middle; the middle row with the last price and the spread; the
 * bids with the best first. Each row's side is in text, in a column only a screen reader reads, and its bar is on one scale for both sides.
 */
function BookTable({ base, book, last }: { base: string; book: BookParts; last: string }) {
  const asks = [...book.asks].reverse();
  return (
    <table className="pair__book" aria-label="Order book">
      <thead>
        <tr>
          <th scope="col" className="pair__book-side">
            <span className="sr">Side</span>
          </th>
          <th scope="col" className="pair__level-price">
            Price
          </th>
          <th scope="col">{base}</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>{asks.length > 0 ? asks.map((level) => <Level key={level.price} side="Ask" level={level} />) : <NoLevel text="No asks" />}</tbody>
      <tbody className="pair__book-mid">
        <tr>
          <td colSpan={2} className="mono">
            <span className="sr">Last price </span>
            <LiveValue token={last}>{last}</LiveValue>
          </td>
          <td colSpan={2} className="faint">
            spread <LiveValue token={book.spread}>{book.spread}</LiveValue>
          </td>
        </tr>
      </tbody>
      <tbody>{book.bids.length > 0 ? book.bids.map((level) => <Level key={level.price} side="Bid" level={level} />) : <NoLevel text="No bids" />}</tbody>
    </table>
  );
}

/** The order book card: its source names the node's call and the ledger; a book that could not be read is the node notice, never half a book. */
function BookCard({ data, xrpl }: { data: LivePairData; xrpl: boolean }) {
  const titleId = useId();
  const { book } = data;
  return (
    <section className="card pair__card" aria-labelledby={titleId}>
      <div className="chart__titles pair__card-head">
        <h2 id={titleId} className="chart__title">
          Order book
        </h2>
        <span className="chart__source">
          {book.state === "ok" ? <LedgerSource text={`live from the node · book_offers · ledger #${book.ledger}`} ledger={book.ledger} /> : "live from the node · book_offers"}
        </span>
      </div>
      {book.state === "ok" ? (
        <>
          <BookTable base={data.head.base} book={book} last={data.price.text} />
          <div className="pair__notes">
            <p>Asks on top, bids below; the bar is the size on the book up to that price.</p>
            {xrpl && <p>AMM pool liquidity is not in this book; see the pool.</p>}
          </div>
        </>
      ) : (
        <div className="pair__card-body">
          <LiveStateNotice>{BOOK_BODY}</LiveStateNotice>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pool

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The pool of the pair, when the node has one (spec 3.1): its title and source, the reserves, the pool's price, the fee and, with the AMM
 * parts, its share of the pair's volume. A section, not a link: its one link is the data's (the pool account, or the pool page once E5 has it).
 * A pool that could not be read is the node notice.
 */
function PoolCard({ data }: { data: LivePairData }) {
  const titleId = useId();
  const { pool, share, head } = data;
  if (pool.state === "missing") return null;
  return (
    <section className="card pair__card" aria-labelledby={titleId}>
      <div className="pair__card-head pair__pool-head">
        <div className="chart__titles pair__pool-titles">
          <h2 id={titleId} className="chart__title">
            {pool.state === "ok" ? pool.title : `${head.title} AMM pool`}
          </h2>
          <span className="chart__source">{pool.state === "ok" ? <LedgerSource text={pool.source} ledger={pool.ledger} /> : "live from the node · amm_info"}</span>
        </div>
        {pool.state === "ok" && (
          <Link to={pool.link.href} className="pair__pool-link">
            {pool.link.label}
          </Link>
        )}
      </div>
      {pool.state === "ok" ? (
        <dl className="pair__figures">
          <Figure label="Reserves">{pool.reserves}</Figure>
          <Figure label="Pool price">{pool.price === DASH ? DASH : `${pool.price} ${head.counter}`}</Figure>
          <Figure label="Trading fee">{pool.fee}</Figure>
          {data.ammParts && share.state !== "off" && (
            <Figure label="Share of pair volume, 24 h">
              {share.state === "ok" ? (
                share.text
              ) : (
                <>
                  <span className="pair__figure-value">{DASH}</span>
                  <span className="pair__figure-sub">Couldn’t load</span>
                </>
              )}
            </Figure>
          )}
        </dl>
      ) : (
        <div className="pair__card-body">
          <LiveStateNotice>{POOL_BODY}</LiveStateNotice>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The traders

/**
 * The most active accounts of the 24 hours, each a link to its page with its volume and trades, then the note. The list holds the page. Not
 * `dense`: its rows are links, and the dense rows (21.6 px apart) put two links' 24 px targets closer than WCAG 2.5.8 lets them be (axe).
 */
function TradersCard({ data, holds, onRetry }: { data: LivePairData; holds: HoldHandlers; onRetry: () => void }) {
  const titleId = useId();
  const { traders } = data;
  return (
    <section className="card pair__card" aria-labelledby={titleId}>
      <div className="chart__titles pair__card-head">
        <h2 id={titleId} className="chart__title">
          Most active traders, 24 h
        </h2>
        <span className="chart__source">{"/v2/active_accounts/{base}/{counter}"}</span>
      </div>
      <div className="pair__card-body">
        {traders.state === "ok" ? (
          <>
            <div className="pair__hold" {...holds}>
              <BarList data={traders.data} tip="count" />
            </div>
            <p className="pair__note">{traders.note}</p>
          </>
        ) : (
          <SectionError what="the most active traders" onRetry={onRetry} />
        )}
      </div>
    </section>
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
  const { retry } = useRetry();
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
          <Quote price={data.price} />
        </div>
        <Stats head={head} stats={data.stats} onRetry={retry} />
      </section>

      {data.ammParts && data.filters.trades && (
        <div role="group" aria-label="Filters" className="pair__filters">
          <SegmentedLinks label="Trades" links={data.filters.trades} />
          <span className="pair__filters-note">Applies to the chart, the 24 h figures and the trade list.</span>
        </div>
      )}

      <PriceCard data={data} onRetry={retry} />

      <div className="pair__body">
        <TradesCard net={network.id} head={head} trades={data.trades} via={data.ammParts} live holds={holding("trades")} className="pair__main" />
        <div className="pair__side">
          <BookCard data={data} xrpl={network.id === "xrpl"} />
          <PoolCard data={data} />
          <TradersCard data={data} holds={holding("traders")} onRetry={retry} />
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
      <TradesCard net={network.id} head={head} trades={data.trades} via={data.trades.rows.some((row) => row.via !== null)} live={false} />
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
