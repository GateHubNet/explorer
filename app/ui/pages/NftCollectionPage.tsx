import { useEffect, useId, useRef } from "react";
import { Form, Link } from "react-router";

import { formatAmount } from "../../domain/format";
import { collectionPath, nftWords, NFT_MEASURES, shortNftId, type NftMeasure } from "../../domain/nft-params";
import type { CollectionNftRow, HolderRow, NftCollectionPageData } from "../../server/nft-collection-view";
import type { NftSaleRow } from "../../server/nfts-view";
import type { NetworkId } from "../../server/networks";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { ColumnChart } from "../charts/ColumnChart";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable, type Column } from "../components/DataTable";
import { AlertIcon, SearchIcon } from "../components/icons";
import { NftGlyph } from "../components/NftGlyph";
import { NftLink } from "../components/NftLink";
import { NftSalesTable } from "../components/NftSalesTable";
import { Pager } from "../components/Pager";
import { SectionError } from "../components/SectionError";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { StatGrid, StatTile } from "../components/StatTile";
import { Tabs } from "../components/Tabs";
import { cx } from "../cx";
import { useNetwork } from "../use-network";
import { useRetry } from "../use-retry";

/** What a figure or a cell without a value shows. */
const DASH = "—";

/** The chart's note (spec 3.1): what a column is, and why a day can have no price. The page writes it, as it does the board's note under the tabs. */
const CHART_NOTE = "One bar a UTC day. A day with no sale has no average or lowest price.";

/** The six stats, in the board's order, and the words of each label (the 30-day ones end with their span). */
const STATS = [
  ["supply", "Supply"],
  ["holders", "Holders"],
  ["sales", "Sales"],
  ["volume", "Volume"],
  ["average30", "Average sale, 30 days"],
  ["lowest30", "Lowest sale, 30 days"],
] as const;

/**
 * The title of the chart's card for each measure, in the native currency's unit. A card that has its data takes the view builder's (`chart.title`); a failed one has no data to
 * carry it, so the page writes the same words (the page test draws both for each measure, so that they cannot differ).
 */
const CHART_TITLES: Record<NftMeasure, (native: string) => string> = {
  volume: (native) => `Sales volume per day, in ${native}, last 30 days`,
  sales: () => "Sales per day, last 30 days",
  avg: (native) => `Average sale price per day, in ${native}, last 30 days`,
  low: (native) => `Lowest sale price per day, in ${native}, last 30 days`,
};

/** The board's note under the tabs, in each network's words (spec 3.1): what a collection is, and why a token is shown by its serial and id. */
const TABS_NOTES: Record<NetworkId, string> = {
  xrpl: "A collection is every NFT of one issuer and one taxon. Names and images live in each NFT’s metadata, which the explorer does not fetch, so tokens are shown by serial and id.",
  xahau: "A collection is every URIToken of one issuer. Names and images live in each URIToken’s metadata, which the explorer does not fetch, so tokens are shown by id.",
};

type Header = NftCollectionPageData["header"];
interface Retry {
  onRetry: () => void;
  retrying: boolean;
}

/** The part of a collection's data API path after `/v2/nft_collections/`: `{issuer}/{taxon}` on XRPL, `{issuer}` on Xahau. */
const keyPath = (header: Header) => (header.taxon === undefined ? header.issuer : `${header.issuer}/${header.taxon}`);

// ---------------------------------------------------------------------------------------------------------------------------
// The header and the stats

/** The first and the last mint as one line, each date the link to its transaction; a part the collection lacks is left out. */
function Mints({ header }: { header: Header }) {
  const { firstMint, lastMint } = header;
  if (firstMint === undefined && lastMint === undefined) return null;
  return (
    <span className="nft-coll__fact">
      {firstMint !== undefined && (
        <>
          First mint{" "}
          <Link to={firstMint.href} className="num">
            {firstMint.day}
          </Link>
        </>
      )}
      {firstMint !== undefined && lastMint !== undefined && " · "}
      {lastMint !== undefined && (
        <>
          {firstMint === undefined ? "Last" : "last"} mint{" "}
          <Link to={lastMint.href} className="num">
            {lastMint.day}
          </Link>
        </>
      )}
    </span>
  );
}

/**
 * The header card (spec 3.1): the glyph, the `<h1>` and the kind's tag, the issuer in full with a copy button, the taxon (XRPL) and the mints. Behind a marker the heading is the page's own
 * ("Older sales of …") and the dates are not there.
 */
function HeaderCard({ net, title, header }: { net: NetworkId; title: string; header: Header }) {
  return (
    <section className="card nft-coll__card" aria-label="Collection">
      <NftGlyph chars={header.glyph} large />
      <div className="nft-coll__body">
        <div className="nft-coll__name">
          <h1 className="nft-coll__title">{title}</h1>
          <span className="tag">{header.tag}</span>
        </div>
        <div className="nft-coll__facts">
          <span className="nft-coll__fact">
            Issuer <AccountLink net={net} address={header.issuer} full />
            <CopyButton value={header.issuer} label="issuer" />
          </span>
          {header.taxon !== undefined && (
            <span className="nft-coll__fact">
              Taxon <span className="num">{formatAmount(String(header.taxon))}</span>
            </span>
          )}
          <Mints header={header} />
        </div>
      </div>
    </section>
  );
}

/** The six figures with a note each, a dash for one that has no data (the two 30-day ones, while the daily figures failed), and the coverage of the collection's own answer under them. */
function Stats({ data, net }: { data: NftCollectionPageData; net: NetworkId }) {
  const { stats } = data;
  return (
    <div className="nfts__stack nft-coll__stats">
      <StatGrid label="Figures">
        {STATS.map(([key, label]) => (
          <StatTile key={key} figure label={label} value={stats[key].figure ?? DASH} sub={stats[key].note === "" ? undefined : stats[key].note} />
        ))}
      </StatGrid>
      <CoverageNote net={net} note={data.notes.stats} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The chart

/**
 * The 30 days of the measure, one column a day, the running day "so far", the other figures of the day in its tip and its table (E2's `ColumnChart`). A failed card keeps its title and
 * its source line and tells "Couldn’t load the daily figures"; the coverage note stands under the card.
 */
function Chart({ data, net, native, onRetry, retrying }: Retry & { data: NftCollectionPageData; net: NetworkId; native: string }) {
  const { chart } = data;
  const current = NFT_MEASURES[Math.max(0, data.measures.findIndex((link) => link.current))]!;
  const title = chart?.title ?? CHART_TITLES[current](native);
  return (
    <div className="nfts__stack">
      <ChartCard
        id="nft-collection-chart"
        title={title}
        source={`/v2/nft_collections/${keyPath(data.header)}/stats`}
        what={data.failures.daily ?? ""}
        state={chart === null ? "failed" : "ok"}
        onRetry={onRetry}
        retrying={retrying}
        table={chart && <ChartTable title={title} data={chart.data} />}
        notes={[CHART_NOTE]}
      >
        {chart && <ColumnChart layout="single" title={title} data={chart.data} />}
      </ChartCard>
      <CoverageNote net={net} note={data.notes.chart} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The tabs: the NFTs' form and the three tables

/**
 * The GET form of the NFTs tab (spec 3.1): it works without JavaScript, and is a client-side navigation with it. The view's own fields (the builder's `hidden`: `measure` unless it is the
 * default's, then `tab`) are hidden inputs written before the owner and the burned fields, the order of the canonical query, so that an owner submitted as an address lands on the
 * canonical URL (an empty field sends `owner=`, which the loader's 302 takes out). The message of an owner that is no address is tied to the field and is an alert, a new one for each
 * owner, so that a screen reader reads it when Show brings it.
 *
 * The form stays across a navigation, and so do the focus and what was typed: Show on an owner that is no address leaves the visitor where they were. When the view changes (a link,
 * Back), the field and "Include burned" take what the page shows, unless the visitor is in them.
 */
function OwnerForm({ net, header, form }: { net: NetworkId; header: Header; form: NonNullable<NftCollectionPageData["form"]> }) {
  const fieldId = useId();
  const errorId = useId();
  const owner = useRef<HTMLInputElement>(null);
  const burned = useRef<HTMLInputElement>(null);
  const view = `${form.owner}\u0000${form.burned}\u0000${JSON.stringify(form.hidden)}`;
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current !== view) {
      if (owner.current !== null && owner.current !== document.activeElement) owner.current.value = form.owner;
      if (burned.current !== null && burned.current !== document.activeElement) burned.current.checked = form.burned;
    }
    shown.current = view;
  }, [view, form.owner, form.burned]);
  return (
    <Form
      method="get"
      action={collectionPath(net, { issuer: header.issuer, ...(header.taxon === undefined ? {} : { taxon: header.taxon }) })}
      className="nfts__form"
    >
      {form.hidden.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor={fieldId} className="nft-coll__label">
        Held by an account
      </label>
      <div className={cx("nfts__field", form.error !== undefined && "is-invalid")}>
        <SearchIcon size={15} className="nfts__icon" />
        <input
          ref={owner}
          id={fieldId}
          type="search"
          name="owner"
          className="nfts__input"
          defaultValue={form.owner}
          placeholder="Account address (r…)"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={form.error !== undefined ? "true" : undefined}
          aria-describedby={form.error !== undefined ? errorId : undefined}
        />
      </div>
      <label className="nft-coll__check">
        {/* `burned=1`, the canonical form's; a checkbox's default value, "on", would be dropped. */}
        <input ref={burned} type="checkbox" name="burned" value="1" defaultChecked={form.burned} />
        Include burned
      </label>
      <button type="submit" className="btn nfts__submit">
        Show
      </button>
      {form.error !== undefined && (
        <p key={form.owner} id={errorId} role="alert" className="nfts__error">
          <AlertIcon size={14} />
          {form.error}
        </p>
      )}
    </Form>
  );
}

// The columns of the NFTs tab: the NFT with its glyph and the short id under its serial, the owner, the counts, the last sale, the flags and the day of the mint. `MIN_WIDTH` is the
// tracks at their least, the gaps (5 × 16 px) and the padding of a row (2 × 16 px), below which the table scrolls sideways inside its card.
const NFTS_WIDTH = 170 + 150 + 80 + 140 + 200 + 120 + 5 * 16 + 2 * 16;

function nftColumns(net: NetworkId): Column<CollectionNftRow>[] {
  const words = nftWords(net);
  return [
    {
      id: "nft",
      header: words.token,
      width: "170px",
      // "#4,127" with the short id under it on XRPL; the short id alone on Xahau, whose URITokens have no serial.
      cell: (row) => (
        <span className="nfts__nft">
          <NftGlyph chars={row.nft.glyph} />
          <span className="nfts__ids">
            <NftLink net={net} id={row.nft.id} serial={row.nft.serial} />
            {row.nft.serial !== undefined && <span className="mono faint nfts__short">{shortNftId(row.nft.id)}</span>}
          </span>
        </span>
      ),
    },
    {
      id: "owner",
      header: "Owner",
      width: "150px",
      cell: (row) => (row.burned ? <span className="tag">burned</span> : row.owner === null ? <span className="faint">{DASH}</span> : <AccountLink net={net} address={row.owner} />),
    },
    { id: "sales", header: "Sales", width: "80px", align: "end", cell: (row) => <span className="mono num">{row.sales}</span> },
    {
      id: "last",
      header: "Last sale",
      width: "140px",
      align: "end",
      cell: (row) =>
        row.lastSale === null ? <span className="faint">{DASH}</span> : <Amount value={row.lastSale.value} currency={row.lastSale.currency} issuer={row.lastSale.issuer} className="mono num" />,
    },
    {
      id: "flags",
      header: "Flags",
      width: "minmax(200px, 1.4fr)",
      cell: (row) => (
        <span className="nft-coll__flags">
          {row.flags.map((flag) => (
            <span key={flag} className="tag">
              {flag}
            </span>
          ))}
        </span>
      ),
    },
    { id: "minted", header: "Minted", width: "120px", cell: (row) => <span className="num muted">{row.minted}</span> },
  ];
}

const HOLDERS_WIDTH = 170 + 150 + 150 + 2 * 16 + 2 * 16;

function holderColumns(net: NetworkId): Column<HolderRow>[] {
  return [
    { id: "holder", header: "Holder", width: "minmax(170px, 1.4fr)", cell: (row) => <AccountLink net={net} address={row.owner} /> },
    { id: "held", header: `${nftWords(net).tokens} held`, width: "150px", align: "end", cell: (row) => <span className="mono num">{row.held}</span> },
    { id: "share", header: "Share of supply", width: "150px", align: "end", cell: (row) => <span className="mono num">{row.share}</span> },
  ];
}

const isSales = (rows: NonNullable<NftCollectionPageData["rows"]>): rows is NftSaleRow[] => rows.every((row) => "txHash" in row);
const isNfts = (rows: NonNullable<NftCollectionPageData["rows"]>): rows is CollectionNftRow[] => rows.every((row) => "flags" in row);
const isHolders = (rows: NonNullable<NftCollectionPageData["rows"]>): rows is HolderRow[] => rows.every((row) => "held" in row);

/** The tab's table, named for what it lists; the view builder pairs the rows with the tab (`tabRows`), so what the tab does not draw has no rows to draw. */
function TabTable({ data, net }: { data: NftCollectionPageData; net: NetworkId }) {
  const { rows, tab } = data;
  const empty = data.empty ?? undefined;
  if (rows === null) return null;
  if (tab === "sales" && isSales(rows)) return <NftSalesTable label="Sales" rows={rows} empty={empty} collection={false} />;
  if (tab === "nfts" && isNfts(rows)) {
    return <DataTable label={nftWords(net).tokens} columns={nftColumns(net)} rows={rows} rowKey={(row) => row.key} minWidth={NFTS_WIDTH} empty={empty} className="nfts__table" />;
  }
  if (tab === "holders" && isHolders(rows)) {
    return <DataTable label="Holders" columns={holderColumns(net)} rows={rows} rowKey={(row) => row.key} minWidth={HOLDERS_WIDTH} empty={empty} className="nfts__table" />;
  }
  return null;
}

/**
 * The card of the tabs (spec 3.1): the tabs, links that keep the window where it is, with the tab's source line; the NFTs tab's form; the tab's table, the board's note of the network,
 * the coverage and the pager (Newer / Older). A list that could not be loaded is its `SectionError` under the tabs, which stay links. A list that was not asked for (an owner that is
 * no address) is the form with its message and the notes. Behind a marker there are no tabs and no form: the source line and the rows.
 */
function Lists({ data, net, header, onRetry, retrying }: Retry & { data: NftCollectionPageData; net: NetworkId; header: Header }) {
  return (
    <Card label="Collection lists" flush>
      <div className="nft-coll__tabs">
        {data.tabs.length > 0 && <Tabs label="Collection lists" items={data.tabs} current={data.tab} preventScrollReset />}
        <span className="chart__source">{`/v2/nft_collections/${keyPath(header)}/${data.tab}`}</span>
      </div>
      {data.form !== null && (
        <div className="nfts__filter">
          <OwnerForm net={net} header={header} form={data.form} />
        </div>
      )}
      {data.failures.tab !== undefined ? (
        <div className="nfts__failed">
          <SectionError what={data.failures.tab} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : (
        <>
          <TabTable data={data} net={net} />
          <div className="card__foot nfts__foot">
            <div className="nfts__notes">
              <p>{TABS_NOTES[net]}</p>
              <CoverageNote net={net} note={data.notes.tab} />
            </div>
            {data.rows !== null && <Pager newerHref={data.paging.newerHref} olderHref={data.paging.olderHref} preventScrollReset />}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * A collection's page (`/{net}/nfts/{issuer}[/{taxon}]`, spec 3.1), in the board's order: the breadcrumb, the header card, the six stats, the measure's links, the chart of the 30 days
 * and the tabs (Sales, NFTs, Holders). A page behind a marker is the breadcrumb, the header card without its dates, "Back to the collection" and the tab's rows.
 *
 * Takes what the view builder made of the data API's answers (`nftCollectionPage`, `collectionMarkerPage`) and never fetches: every label, href and figure is text in `data`. Each card
 * stands or fails on its own (the daily figures, which feed the chart and the two 30-day stats, and the tab's list); a failed one is a `SectionError` whose Retry asks the route for its
 * data again (`useRetry`).
 */
export function NftCollectionPage({ data }: { data: NftCollectionPageData }) {
  const { retry, retrying } = useRetry();
  const network = useNetwork();
  const shared = { onRetry: retry, retrying };
  return (
    <div className="nfts nft-coll">
      <Breadcrumbs items={data.breadcrumb} />
      <HeaderCard net={network.id} title={data.title} header={data.header} />
      {data.marker ? (
        data.back !== null && (
          <p className="nft-coll__back">
            <Link to={data.back.href}>{data.back.label}</Link>
          </p>
        )
      ) : (
        <>
          <Stats data={data} net={network.id} />
          <SegmentedLinks label="Measure" links={data.measures} />
          <Chart data={data} net={network.id} native={network.native} {...shared} />
        </>
      )}
      <Lists data={data} net={network.id} header={data.header} {...shared} />
    </div>
  );
}
