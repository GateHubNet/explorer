// The column beside the recent trades on the market pair page (spec 3.1, 3.4): the order book, the pair's AMM pool and the most active traders.
// Like the page, it takes what the view builder made (`pairPage`) and never fetches or formats: every figure, label, title, source line and href
// is text in the data.

import { useId, type ReactNode } from "react";
import { Link } from "react-router";

import type { BookLevel, BookParts, LivePairData } from "../../server/pair-view";
import { BarList } from "../charts/BarList";
import { InlineBar } from "../charts/InlineBar";
import { LiveStateNotice } from "../components/LiveStateNotice";
import { LiveValue } from "../components/LiveValue";
import { SectionError } from "../components/SectionError";
import type { HoldHandlers } from "../use-hold";

/** The node notices (spec 3.4): what is missing, and what is not. */
const BOOK_BODY =
  "The network node did not answer, so the order book is missing. Trades and prices on this page are from the explorer’s index and are not affected.";
const POOL_BODY =
  "The network node did not answer, so the pool’s reserves and fee are missing. Trades and prices on this page are from the explorer’s index and are not affected.";

/** A card's head: the kit's title and its source line, in the card's head padding (`pair__card-head`) or in a head of its own. */
function Head({ id, title, className = "pair__card-head", children }: { id: string; title: string; className?: string; children: ReactNode }) {
  return (
    <div className={`chart__titles ${className}`}>
      <h2 id={id} className="chart__title">
        {title}
      </h2>
      <span className="chart__source">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The order book

/**
 * A level of a side: the depth bar first (`InlineBar`'s contract: the row is `position: relative` and the bar its first child, so the kit's
 * stylesheet puts the cells after it above it), then the side in text for a screen reader, the price, the size and the total.
 */
function Level({ side, level }: { side: "Ask" | "Bid"; level: BookLevel }) {
  return (
    <div role="row" className="pair__book-row pair__level">
      <InlineBar value={level.depth} max="1" tone={side === "Ask" ? "down" : "up"} />
      <span role="cell" className="pair__book-side">
        <span className="sr">{side}</span>
      </span>
      <span role="cell" className="pair__level-price mono">
        {level.price}
      </span>
      <span role="cell">{level.size}</span>
      <span role="cell" className="muted">
        {level.total}
      </span>
    </div>
  );
}

function NoLevel({ text }: { text: string }) {
  return (
    <div role="row" className="pair__book-row">
      <span role="cell" aria-colspan={4} className="pair__book-empty">
        {text}
      </span>
    </div>
  );
}

/**
 * The book as one table (spec 3.4), an ARIA table over rows of a CSS grid as `DataTable` draws its own: the asks with the best last, nearest the
 * middle; the middle row with the last price and the spread; the bids with the best first. Each row's side is in text, in a column only a screen
 * reader reads, and its bar is on one scale for both sides. (`DataTable` itself has no row groups, no middle row and no bar in its rows.)
 */
function BookTable({ base, book, last }: { base: string; book: BookParts; last: string }) {
  const asks = [...book.asks].reverse();
  return (
    <div role="table" aria-label="Order book" className="pair__book">
      <div role="rowgroup">
        <div role="row" className="pair__book-row pair__book-head">
          <span role="columnheader" className="pair__book-side">
            <span className="sr">Side</span>
          </span>
          <span role="columnheader" className="pair__level-price">
            Price
          </span>
          <span role="columnheader">{base}</span>
          <span role="columnheader">Total</span>
        </div>
      </div>
      <div role="rowgroup">{asks.length > 0 ? asks.map((level) => <Level key={level.price} side="Ask" level={level} />) : <NoLevel text="No asks" />}</div>
      <div role="rowgroup" className="pair__book-mid">
        <div role="row" className="pair__book-row">
          <span role="cell" className="pair__book-side">
            <span className="sr">Last price</span>
          </span>
          <span role="cell" className="pair__level-price mono">
            <LiveValue token={last}>{last}</LiveValue>
          </span>
          <span role="cell" aria-colspan={2} className="pair__book-spread faint">
            spread <LiveValue token={book.spread}>{book.spread}</LiveValue>
          </span>
        </div>
      </div>
      <div role="rowgroup">{book.bids.length > 0 ? book.bids.map((level) => <Level key={level.price} side="Bid" level={level} />) : <NoLevel text="No bids" />}</div>
    </div>
  );
}

/**
 * The order book card: its source line names the node's call and the ledger, the ledger a figure that ticks; a book that could not be read is the
 * node's notice (no `role`: the live status is the page's one), never half a book.
 */
export function BookCard({ data, xrpl }: { data: LivePairData; xrpl: boolean }) {
  const titleId = useId();
  const { book } = data;
  return (
    <section className="card pair__card" aria-labelledby={titleId}>
      <Head id={titleId} title="Order book">
        {book.source}
        {book.state === "ok" && <LiveValue token={book.ledger}>{book.ledger}</LiveValue>}
      </Head>
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
 * The pool of the pair, when the node has one (spec 3.1): its title and source (the ledger a figure that ticks), the reserves, the pool's price,
 * the fee and, with the AMM parts, its share of the pair's volume. A section, not a link: its one link is the data's (the pool account, or the
 * pool page once E5 has it). A pool that could not be read keeps its title, with the node's notice.
 */
export function PoolCard({ data }: { data: LivePairData }) {
  const titleId = useId();
  const { pool, share } = data;
  if (pool.state === "missing") return null;
  return (
    <section className="card pair__card" aria-labelledby={titleId}>
      <div className="pair__card-head pair__pool-head">
        <Head id={titleId} title={pool.title} className="pair__pool-titles">
          {pool.source}
          {pool.state === "ok" && <LiveValue token={pool.ledger}>{pool.ledger}</LiveValue>}
        </Head>
        {pool.state === "ok" && (
          <Link to={pool.link.href} className="pair__pool-link">
            {pool.link.label}
          </Link>
        )}
      </div>
      {pool.state === "ok" ? (
        <dl className="pair__figures">
          <Figure label="Reserves">{pool.reserves}</Figure>
          <Figure label="Pool price">{pool.price}</Figure>
          <Figure label="Trading fee">{pool.fee}</Figure>
          {data.ammParts && share.state !== "off" && (
            <Figure label="Share of pair volume, 24 h">
              {share.state === "ok" ? (
                share.text
              ) : (
                <>
                  <span className="pair__figure-value">—</span>
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
export function TradersCard({ data, holds, onRetry }: { data: LivePairData; holds: HoldHandlers; onRetry: () => void }) {
  const titleId = useId();
  const { traders } = data;
  return (
    <section className="card pair__card" aria-labelledby={titleId}>
      <Head id={titleId} title="Most active traders, 24 h">
        {traders.source}
      </Head>
      <div className="pair__card-body">
        {traders.state === "ok" ? (
          <>
            {/* `pair__hold` has no style: it is the element that holds the page while the visitor is on the list. */}
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
