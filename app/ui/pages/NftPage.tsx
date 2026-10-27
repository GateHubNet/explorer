import { Link } from "react-router";

import { formatUtc } from "../../domain/format";
import { ARROW, nftWords } from "../../domain/nft-params";
import type { NetworkId } from "../../server/networks";
import type { NftDetailRow, NftHistoryRow, NftLastSaleView, NftOfferRow, NftOwnerLine, NftPageData } from "../../server/nft-view";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable, type Column } from "../components/DataTable";
import { DetailList } from "../components/DetailList";
import { HashLink, LedgerLink } from "../components/HashLink";
import { NftGlyph } from "../components/NftGlyph";
import { Notice } from "../components/Notice";
import { Pager } from "../components/Pager";
import { SectionError } from "../components/SectionError";
import { Sentence } from "../components/Sentence";
import { useNetwork } from "../use-network";
import { useRetry } from "../use-retry";

/** What a cell without a value shows. */
const DASH = "—";

/** What the "No preview" box says: why the NFT has no picture here (spec 4.2). */
const NO_PREVIEW = "The explorer shows the URI but does not fetch what it points to.";

interface Retry {
  onRetry: () => void;
  retrying: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The header

/** The Owner line (spec 4.2): the owner in full with the time since and the transaction that made it so, or words in place of one, or, for a burned NFT, "Burned {day} by {account}". */
function OwnerFact({ net, owner }: { net: NetworkId; owner: NftOwnerLine }) {
  return (
    <div>
      <dt>{owner.label}</dt>
      <dd>
        {owner.address !== undefined && <AccountLink net={net} address={owner.address} full />}
        {owner.since !== undefined && (
          <>
            <span className="faint"> since </span>
            <Link to={`/${net}/tx/${owner.since.txHash}`}>{owner.since.text}</Link>
          </>
        )}
        {owner.text}
        {owner.by !== undefined && (
          <>
            {" by "}
            <AccountLink net={net} address={owner.by} full />
          </>
        )}
        {owner.note !== undefined && <span className="nft-page__note faint">{owner.note}</span>}
      </dd>
    </div>
  );
}

/** The newest sale: its price and what it is worth in the native currency, the day and how often it was sold as the link to its transaction; or "Never sold". */
function SaleFact({ net, sale }: { net: NetworkId; sale: NftLastSaleView }) {
  return (
    <div>
      <dt>Last sale</dt>
      <dd>
        {"amount" in sale ? (
          <span className="nft-page__sale">
            <Amount value={sale.amount.value} currency={sale.amount.currency} issuer={sale.amount.issuer} className="mono num" />
            {sale.converted !== undefined && <span className="faint">{sale.converted}</span>}
            <Link to={`/${net}/tx/${sale.txHash}`}>{sale.text}</Link>
          </span>
        ) : (
          sale.text
        )}
      </dd>
    </div>
  );
}

/**
 * The header card (spec 4.2): the "No preview" box with the glyph, the `<h1>` and the tags, the collection, the id in full with a copy button, the owner and the last sale. Behind a
 * marker the heading is the page's own ("Older history of …") and there is no owner or sale.
 */
function HeaderCard({ net, data }: { net: NetworkId; data: NftPageData }) {
  const words = nftWords(net);
  const { header } = data;
  return (
    <section className="card nft-page__card" aria-label={words.token}>
      <div className="nft-page__preview">
        <NftGlyph chars={header.glyph} large />
        <span className="nft-page__preview-title">No preview</span>
        <span className="nft-page__preview-note faint">{NO_PREVIEW}</span>
      </div>
      <div className="nft-page__body">
        <div className="nft-page__name">
          <h1 className="nft-page__title">{data.marker ? data.title : header.heading}</h1>
          {header.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
        <p className="nft-page__line">
          {header.line.text} <Link to={header.line.collection.href}>{header.line.collection.label}</Link>
        </p>
        <p className="nft-page__id">
          <span className="mono">{header.id}</span>
          <CopyButton value={header.id} label={`${words.token} id`} />
        </p>
        {(header.owner !== null || header.lastSale !== null) && (
          <dl className="nft-page__facts">
            {header.owner !== null && <OwnerFact net={net} owner={header.owner} />}
            {header.lastSale !== null && <SaleFact net={net} sale={header.lastSale} />}
          </dl>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The details and the id's card

/**
 * The value of a detail row: its words (`Sentence`), as a code for a URI (never a link: the explorer shows what the NFT's URI says and fetches nothing, so it is text, or hex), the
 * bytes of the id a field of the id's card is read from, the whole text on hover, a faint line after it, and the flags as their marks (a picture) and the words a screen reader reads.
 */
function DetailValue({ net, row }: { net: NetworkId; row: NftDetailRow }) {
  if (row.flags !== undefined) {
    return (
      <ul className="nft-page__flags">
        {row.flags.map((flag) => (
          <li key={flag.label}>
            <span aria-hidden="true">{flag.mark}</span>
            <span>{flag.label}</span>
            <span className="sr">: {flag.state}</span>
          </li>
        ))}
      </ul>
    );
  }
  const value = <Sentence net={net} segments={row.value} compact />;
  return (
    <>
      {row.hex !== undefined && <span className="mono nft-page__hex">{row.hex}</span>}
      {row.mono === true ? <span className="mono nft-page__uri">{value}</span> : row.title !== undefined ? <span title={row.title}>{value}</span> : value}
      {row.note !== undefined && <span className="nft-page__note faint">{row.note}</span>}
    </>
  );
}

const rowsOf = (net: NetworkId, rows: readonly NftDetailRow[]) => rows.map((row) => ({ label: row.label, value: <DetailValue net={net} row={row} /> }));

// ---------------------------------------------------------------------------------------------------------------------------
// The open offers

function offerColumns(net: NetworkId): Column<NftOfferRow>[] {
  return [
    { id: "side", header: "Side", width: "70px", cell: (row) => <span className="tag">{row.side}</span> },
    { id: "amount", header: "Amount", width: "minmax(130px, 1fr)", cell: (row) => <Amount value={row.amount.value} currency={row.amount.currency} issuer={row.amount.issuer} className="mono num" /> },
    { id: "by", header: "By", width: "140px", cell: (row) => <AccountLink net={net} address={row.by} /> },
    {
      id: "only",
      header: "Only for",
      width: "140px",
      // A sell offer without a destination is open to anyone; a buy offer has none to name.
      cell: (row) => (row.onlyFor === null ? <span className="faint">{DASH}</span> : row.onlyFor === "anyone" ? "anyone" : <AccountLink net={net} address={row.onlyFor} />),
    },
    {
      id: "expires",
      header: "Expires",
      width: "minmax(130px, 1fr)",
      cell: (row) => (
        <span className="nft-page__expires">
          <span className="num">{row.expires}</span>
          {row.expired && <span className="tag">expired</span>}
        </span>
      ),
    },
    {
      id: "created",
      header: "Created",
      width: "120px",
      // The node does not say where an offer was made.
      cell: (row) => (row.created === null ? <span className="faint">{DASH}</span> : <LedgerLink net={net} index={row.created.ledger} />),
    },
  ];
}

const OFFERS_WIDTH = 70 + 130 + 140 + 140 + 130 + 120 + 5 * 16 + 2 * 16;

// ---------------------------------------------------------------------------------------------------------------------------
// The history

/**
 * The Accounts cell: `Sentence`'s segments, except a text segment that is exactly the builder's `ARROW`, which is a seller → buyer: the arrow is a picture and "to" is what a screen
 * reader hears between the two accounts. The cell is the containing block of the visually hidden word (`.sr` is absolute).
 */
function Accounts({ net, segments }: { net: NetworkId; segments: NftHistoryRow["accounts"] }) {
  return (
    <span className="nft-page__who">
      {segments.map((segment, index) =>
        segment.t === "text" && segment.v === ARROW ? (
          <span key={index}>
            {" "}
            <span aria-hidden="true" className="faint">
              →
            </span>
            <span className="sr">to</span>{" "}
          </span>
        ) : (
          <Sentence key={index} net={net} segments={[segment]} compact />
        ),
      )}
    </span>
  );
}

/** The UTC date and, under it, the time of day. The transaction is in the last column, so the time is no link. */
function Time({ at }: { at: number }) {
  const full = formatUtc(at);
  return (
    <span className="when num">
      <span>{full.slice(0, 10)}</span>
      <span className="faint">{full.slice(11, 19)}</span>
    </span>
  );
}

function historyColumns(net: NetworkId): Column<NftHistoryRow>[] {
  return [
    { id: "time", header: "Time", width: "110px", cell: (row) => <Time at={row.time} /> },
    { id: "event", header: "Event", width: "120px", cell: (row) => <span className="tag">{row.event}</span> },
    { id: "accounts", header: "Accounts", width: "minmax(240px, 2fr)", cell: (row) => <Accounts net={net} segments={row.accounts} /> },
    {
      id: "amount",
      header: "Amount",
      width: "minmax(120px, 1fr)",
      align: "end",
      cell: (row) => (row.amount === null ? <span className="faint">{DASH}</span> : <Amount value={row.amount.value} currency={row.amount.currency} issuer={row.amount.issuer} className="mono num" />),
    },
    { id: "tx", header: "Transaction", width: "130px", cell: (row) => <HashLink net={net} kind="tx" hash={row.txHash} /> },
  ];
}

const HISTORY_WIDTH = 110 + 120 + 240 + 120 + 130 + 4 * 16 + 2 * 16;

// ---------------------------------------------------------------------------------------------------------------------------
// The cards

/** What a card's head says its data is from (the kit's source line, in the card's action place). */
const Source = ({ children }: { children: string }) => <span className="chart__source">{children}</span>;

/**
 * The open offers (spec 4.2): the table, the network's note, how many were not shown (the first 50 only) and where the history of the index starts. A card that could not be loaded
 * is its `SectionError`.
 */
function Offers({ net, data, source, onRetry, retrying }: Retry & { net: NetworkId; data: NftPageData; source: string }) {
  const failed = data.failures.offers;
  return (
    <Card title="Open offers" action={<Source>{source}</Source>} flush>
      {failed !== undefined ? (
        <div className="nfts__failed">
          <SectionError what={failed} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : (
        <>
          <DataTable label="Open offers" columns={offerColumns(net)} rows={data.offers ?? []} rowKey={(row) => row.key} minWidth={OFFERS_WIDTH} empty={data.empty.offers ?? undefined} className="nfts__table" />
          <div className="card__foot nfts__foot">
            <div className="nfts__notes">
              <p>{data.offersNote}</p>
              {data.offersMore && <p>Showing the first 50.</p>}
              <CoverageNote net={net} note={data.notes.offers} />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The history (spec 4.2): the link that shows or hides the offer events (its words say what it does: it is no toggle button and no tab, so no `aria-current`), the table, the note, where
 * the index's history starts, and Newer and Older. A card that could not be loaded is its `SectionError`, with the link still there.
 */
function History({ net, data, source, onRetry, retrying }: Retry & { net: NetworkId; data: NftPageData; source: string }) {
  const failed = data.failures.history;
  return (
    <Card title="History" action={<Source>{source}</Source>} flush>
      <div className="nft-page__bar">
        <Link to={data.historyToggle.href} className="btn nft-page__toggle" preventScrollReset>
          {data.historyToggle.label}
        </Link>
      </div>
      {failed !== undefined ? (
        <div className="nfts__failed">
          <SectionError what={failed} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : (
        <>
          <DataTable label="History" columns={historyColumns(net)} rows={data.history ?? []} rowKey={(row) => row.key} minWidth={HISTORY_WIDTH} empty={data.empty.history ?? undefined} className="nfts__table" />
          <div className="card__foot nfts__foot">
            <div className="nfts__notes">
              <p>{data.historyNote}</p>
              <CoverageNote net={net} note={data.notes.history} />
            </div>
            <Pager newerHref={data.paging.newerHref} olderHref={data.paging.olderHref} preventScrollReset />
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * An NFT's page (`/{net}/nft/{ID}`, spec 4.2), in the board's order: the breadcrumb, the notice of an NFT shown from the network, the header card, the details, the id's card, the open
 * offers and the history. A page behind a marker is the breadcrumb, the header card without its owner and last sale, "Back to the NFT" and the history rows.
 *
 * Takes what the view builder made of the answers of the data API and the node (`nftPage`, `nftMarkerPage`) and never fetches: every label, href and figure is text in `data`, and the
 * NFT's URI is text (or hex) like the rest, never a link and never fetched. Each of the two lists stands or fails on its own; a failed one is a `SectionError` whose Retry asks the
 * route for its data again (`useRetry`). An NFT shown from the network has no history, so no card for it.
 */
export function NftPage({ data }: { data: NftPageData }) {
  const { retry, retrying } = useRetry();
  const net = useNetwork().id;
  const shared = { onRetry: retry, retrying };
  const id = data.header.id;
  const fromNetwork = data.mode === "network" || data.mode === "network-burned";
  // Where a card's data is from: the data API's path, or the network where the page is shown from it.
  const source = (path: string) => (fromNetwork ? "the network" : path);
  const hasOffers = data.offers !== null || data.failures.offers !== undefined;
  const hasHistory = data.history !== null || data.failures.history !== undefined;
  return (
    <div className="nfts nft-page">
      <Breadcrumbs items={data.breadcrumb} />
      {data.notice !== null && <Notice tone="info">{data.notice}</Notice>}
      <HeaderCard net={net} data={data} />
      {data.marker ? (
        data.back !== null && (
          <p className="nft-page__back">
            <Link to={data.back.href}>{data.back.label}</Link>
          </p>
        )
      ) : (
        <>
          <Card title="Details" action={<Source>{source(`/v2/nfts/${id}`)}</Source>}>
            <DetailList rows={rowsOf(net, data.details)} />
          </Card>
          <Card title={data.idTitle}>
            <DetailList rows={rowsOf(net, data.idCard)} />
            <p className="nft-page__idnote">{data.idNote}</p>
          </Card>
          {hasOffers && <Offers net={net} data={data} source={source(`/v2/nfts/${id}/offers`)} {...shared} />}
        </>
      )}
      {hasHistory && <History net={net} data={data} source={source(`/v2/nfts/${id}/history?descending=true`)} {...shared} />}
    </div>
  );
}
