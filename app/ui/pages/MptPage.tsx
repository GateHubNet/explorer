import type { ReactNode } from "react";
import { Link } from "react-router";

import { accountHref } from "../../domain/account-tabs";
import { formatAmount } from "../../domain/format";
import type { MptMetadataRow, MptNotice, MptPageData } from "../../server/mpt-view";
import { AccountLink } from "../components/AccountLink";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyTextButton } from "../components/CopyTextButton";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable } from "../components/DataTable";
import { DetailList, type DetailRow } from "../components/DetailList";
import { LedgerLink } from "../components/HashLink";
import { MptFlags } from "../components/MptFlags";
import { Notice } from "../components/Notice";
import { PairCoins } from "../components/PairCoins";
import { SectionError } from "../components/SectionError";
import { StatGrid, StatTile } from "../components/StatTile";
import { ExternalIcon } from "../components/status-icons";
import type { NetworkInfo } from "../networks";
import { useRetry } from "../use-retry";
import { mptHolderColumns, mptTransferColumns, MPT_HOLDERS_WIDTH, MPT_TRANSFERS_WIDTH } from "./mpt-columns";

type Net = NetworkInfo["id"];
type Retry = { onRetry: () => void; retrying: boolean };

/** What a card's head says its data is from (the kit's source line, in the card's action place). */
const Source = ({ children }: { children: string }) => <span className="chart__source">{children}</span>;

/** A card that could not be loaded: its `SectionError`, with Retry, in the place of its body. */
function Failed({ what, onRetry, retrying }: Retry & { what: string }) {
  return (
    <div className="token-page__failed">
      <SectionError what={what} onRetry={onRetry} retrying={retrying} />
    </div>
  );
}

/** A card whose rows the index has none of for the issuance: told in words, not left empty. */
const Missing = () => <p className="mpt__missing faint">Not in the index yet.</p>;

// ---------------------------------------------------------------------------------------------------------------------------
// The header

/**
 * The header card (spec 3.1): the coin (the ticker's first letter, else "?"), the `<h1>`, the ticker and "MPT" tags, the issuer in full with, when the name or the ticker came from the issuance's
 * metadata, the words that say so, the Issuer account button, the issuance ID in full with a button that copies it, and the source line. Everything the issuer wrote (the name, the ticker) is text.
 */
function HeaderCard({ net, data }: { net: Net; data: MptPageData }) {
  const { head } = data;
  return (
    <section className="card token-page__card" aria-labelledby="mpt-title">
      <div className="token-page__head">
        <PairCoins codes={[head.letter]} className="token-page__coin" />
        <div className="token-page__titles">
          <div className="token-page__name">
            <h1 id="mpt-title" className="token-page__title">
              {head.heading}
            </h1>
            {head.ticker !== undefined && <span className="tag mono token-page__code">{head.ticker}</span>}
            <span className="tag">MPT</span>
          </div>
          <p className="token-page__issuer">
            <span>Issued by</span> <AccountLink net={net} address={head.issuer} full />
            {head.fromMetadata && <span className="faint">· name and ticker from the issuance&apos;s metadata</span>}
          </p>
          <p className="mpt__id">
            <span className="faint">Issuance ID</span>
            <span className="mono mpt__idtext">{head.id}</span>
            <CopyTextButton getText={() => head.id} className="mpt__copy">
              Copy issuance ID
            </CopyTextButton>
          </p>
        </div>
        <div className="token-page__buttons">
          <Link className="btn" to={accountHref(net, head.issuer, {})}>
            Issuer account
          </Link>
        </div>
      </div>
      <Source>{data.source}</Source>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The notices

/** A notice's sentence, with the ledger it names (`#107,721,455`) as a link to the ledger's page. */
function NoticeText({ net, notice }: { net: Net; notice: MptNotice }) {
  if (notice.ledger === undefined) return <>{notice.text}</>;
  const label = `#${formatAmount(String(notice.ledger))}`;
  const at = notice.text.indexOf(label);
  if (at < 0) return <>{notice.text}</>;
  return (
    <>
      {notice.text.slice(0, at)}
      <LedgerLink net={net} index={notice.ledger} />
      {notice.text.slice(at + label.length)}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The metadata

/**
 * A link the issuer wrote, which `safeLink` accepted (`https:` only, no credentials): to another site, in a new tab, without handing the page over and telling search engines not to follow what
 * anyone can write (`nofollow ugc`), with the words for a screen reader. Its `title` is one of XLS-89's own four categories or none.
 */
function IssuerLink({ href, title, children }: { href: string; title?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" title={title}>
      {children}
      <ExternalIcon className="extlink__icon" />
      <span className="sr"> (opens a new tab)</span>
    </a>
  );
}

/** A row of the decoded metadata: text, a link, or code. The issuer's text is React text and nothing more. */
function metadataRow(row: MptMetadataRow): DetailRow {
  const value =
    row.href !== undefined ? (
      <IssuerLink href={row.href} title={row.title}>
        <span className="mpt__text">{row.text}</span>
      </IssuerLink>
    ) : row.code ? (
      <pre className="code code--wrap mpt__json" tabIndex={0} role="region" aria-label="additional_info">
        {row.text}
      </pre>
    ) : (
      <span className="mpt__text">{row.text}</span>
    );
  return { label: row.key, value };
}

/** "Raw metadata, as hex (N bytes)": the hex the issuer wrote, in a disclosure. */
function RawHex({ hex, bytes }: { hex: string; bytes: number }) {
  if (hex === "") return null;
  return (
    <details className="mpt__hex">
      <summary>{`Raw metadata, as hex (${bytes} ${bytes === 1 ? "byte" : "bytes"})`}</summary>
      <pre className="code code--wrap" tabIndex={0} role="region" aria-label="Raw metadata, as hex">
        {hex}
      </pre>
    </details>
  );
}

const METADATA_INTRO = "What the issuer wrote into the issuance, decoded. Nothing here is checked against the issuer's domain.";

function MetadataCard({ data }: { data: MptPageData }) {
  const { metadata } = data;
  return (
    <Card title="Metadata" action={<Source>{data.source}</Source>} className="mpt__metadata">
      {metadata.state === "none" && (
        <>
          <p className="token-page__lede">{METADATA_INTRO}</p>
          <p className="faint">The issuer wrote no metadata.</p>
        </>
      )}
      {metadata.state === "decoded" && (
        <>
          <p className="token-page__lede">{METADATA_INTRO}</p>
          {!metadata.conforms && <p className="token-page__caption faint">This metadata doesn&apos;t follow XLS-89, so some of it may be missing here.</p>}
          {metadata.rows.length > 0 && <DetailList rows={metadata.rows.map(metadataRow)} />}
          <RawHex hex={metadata.hex} bytes={metadata.bytes} />
        </>
      )}
      {metadata.state === "raw" && (
        <>
          <p className="token-page__lede">{metadata.fromNode ? "Read from the network as written; the index decodes it once it holds this issuance." : METADATA_INTRO}</p>
          {!metadata.fromNode && <p className="token-page__caption faint">The metadata isn&apos;t JSON.</p>}
          {metadata.text !== null && <pre className="code code--wrap mpt__json" tabIndex={0} role="region" aria-label="The metadata as text">{metadata.text}</pre>}
          <RawHex hex={metadata.hex} bytes={metadata.bytes} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The holders and the transfers

function HoldersCard({ data, onRetry, retrying }: Retry & { data: MptPageData }) {
  const { holders, network, head } = data;
  return (
    <Card title="Top holders" action={<Source>{`${data.source}/holders`}</Source>} flush>
      {holders.state === "failed" ? (
        <Failed what="the top holders" onRetry={onRetry} retrying={retrying} />
      ) : holders.state === "missing" ? (
        <Missing />
      ) : (
        <>
          <DataTable
            label="Top holders"
            columns={mptHolderColumns(network.id, head, { ranked: true })}
            rows={holders.rows}
            rowKey={(row) => row.holder}
            minWidth={MPT_HOLDERS_WIDTH}
            empty={holders.empty ?? undefined}
            className="tokens__table"
          />
          <div className="card__foot tokens__foot">
            <div className="tokens__notes">
              {holders.topLine !== null && <p>{holders.topLine}</p>}
              <CoverageNote net={network.id} note={holders.coverage} />
              {holders.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
            <Link className="btn" to={holders.allHref}>
              {holders.allLabel}
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}

function TransfersCard({ data, onRetry, retrying }: Retry & { data: MptPageData }) {
  const { transfers, network, head } = data;
  return (
    <Card title="Recent transfers" action={<Source>{`${data.source}/transfers`}</Source>} flush>
      {transfers.state === "failed" ? (
        <Failed what="the recent transfers" onRetry={onRetry} retrying={retrying} />
      ) : transfers.state === "missing" ? (
        <Missing />
      ) : (
        <>
          <DataTable
            label="Recent transfers"
            columns={mptTransferColumns(network.id, head)}
            rows={transfers.rows}
            rowKey={(row, index) => `${row.hash}:${index}`}
            minWidth={MPT_TRANSFERS_WIDTH}
            empty={transfers.empty ?? undefined}
            className="tokens__table"
          />
          <div className="card__foot tokens__foot">
            <div className="tokens__notes">
              <p>{transfers.footnote}</p>
              <CoverageNote net={network.id} note={transfers.note} />
            </div>
            {transfers.olderHref !== null && (
              <Link className="btn" to={transfers.olderHref}>
                Older →
              </Link>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * One issuance's page (`/{net}/mpt/{ID}`, spec 3.1), in the board's order: the breadcrumb, the header card, the notices (not in the index yet, destroyed, every balance locked), the six figures,
 * the Flags and the Metadata cards side by side while there is room, the top holders and the recent transfers.
 *
 * Takes what the view builder made of the issuance and its first rows (`mptPage`) and never fetches: every label, href and figure is text in `data`. The two tables stand or fail on their own,
 * as a `SectionError` whose Retry asks the route for its data again (`useRetry`), or say the index has no rows for the issuance yet. Every address is an `AccountLink`, which reads the names of
 * the route's `NamesProvider`. What the issuer wrote (name, ticker, metadata) is text; the only thing of it that reaches an attribute is the `href` of a link `safeLink` accepted.
 */
export function MptPage({ data }: { data: MptPageData }) {
  const { retry, retrying } = useRetry();
  const { network, head } = data;
  const shared = { onRetry: retry, retrying };
  return (
    <div className="tokens token-page mpt">
      <Breadcrumbs items={[{ label: network.name, href: `/${network.id}` }, { label: "Tokens", href: `/${network.id}/tokens?kind=mpt` }, { label: head.crumb }]} />
      <HeaderCard net={network.id} data={data} />
      {data.notices.map((notice) => (
        <Notice key={notice.text} tone={notice.tone}>
          <NoticeText net={network.id} notice={notice} />
        </Notice>
      ))}
      <div className="token-page__figures">
        <StatGrid label="Figures">
          {data.tiles.map((tile) => (
            <StatTile key={tile.label} figure label={tile.label} value={tile.value} sub={tile.line} />
          ))}
        </StatGrid>
      </div>
      <div className="token-page__pair">
        <Card title="Flags" action={<Source>{data.source}</Source>} className="mpt__flags">
          <MptFlags flags={data.flags} />
        </Card>
        <MetadataCard data={data} />
      </div>
      <HoldersCard data={data} {...shared} />
      <TransfersCard data={data} {...shared} />
    </div>
  );
}
