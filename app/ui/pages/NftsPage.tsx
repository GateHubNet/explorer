import { useEffect, useId, useRef, type ReactNode } from "react";
import { Form, Link } from "react-router";

import { nftsHref } from "../../domain/nft-params";
import type { CollectionRow, NftSortLink, NftsPageData } from "../../server/nfts-view";
import type { NetworkId } from "../../server/networks";
import { BarList } from "../charts/BarList";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { ColumnChart } from "../charts/ColumnChart";
import { Card } from "../components/Card";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable, type Column } from "../components/DataTable";
import { AlertIcon, ChevronRightIcon, SearchIcon } from "../components/icons";
import { NftGlyph } from "../components/NftGlyph";
import { NftSalesTable, salesNote } from "../components/NftSalesTable";
import { Pager } from "../components/Pager";
import { SectionError } from "../components/SectionError";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { StatGrid, StatTile } from "../components/StatTile";
import { cx } from "../cx";
import { useNetwork } from "../use-network";
import { useRetry } from "../use-retry";

/** What a tile that could not be loaded shows under its label. */
const DASH = "—";

/** The words of the collections' pager: the list is ordered by what the sort says, not by time (spec 2.1). */
const PAGER_LABELS = { newer: "Newer", older: "More collections" } as const;

/**
 * The periods the view builder labels its links with, and what each says outside a label: the data API's `live` value (the top collections' source line) and the span in a
 * sentence ("No sales in the last 24 hours."). The builder's labels are the key; the page tests draw each, so a label that moves fails them.
 */
const PERIODS: Record<string, { api: string; span: string }> = {
  "24 h": { api: "day", span: "24 hours" },
  "7 days": { api: "7day", span: "7 days" },
  "30 days": { api: "30day", span: "30 days" },
};

/** The four tiles, in the board's order, and the words each starts its label with (the label ends with the period's). */
const TILES = [
  ["volume", "Sales volume"],
  ["sales", "Sales"],
  ["traded", "Collections traded"],
  ["average", "Average sale"],
] as const;

/** The board's note under the collections table, in each network's words. */
const collectionsNote = (net: NetworkId) =>
  `Collections are named by issuer${net === "xahau" ? "" : " and taxon"}: names and images live in each token’s metadata, which the explorer does not fetch. Volume and sales are all time; supply counts tokens not burned.`;

interface Retry {
  onRetry: () => void;
  retrying: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The totals and the charts

/** The four tiles of the period, with dashes under the same labels and one `SectionError` when the live volume could not be loaded. */
function Totals({ data, label, onRetry, retrying }: Retry & { data: NftsPageData; label: string }) {
  return (
    <div className="nfts__totals">
      <StatGrid label="Totals">
        {TILES.map(([key, name]) => {
          const tile = data.tiles[key];
          return <StatTile key={key} figure label={`${name}, ${label}`} value={tile.figure ?? DASH} sub={tile.note === "" ? undefined : tile.note} />;
        })}
      </StatGrid>
      {data.failures.totals !== undefined && <SectionError what={data.failures.totals} onRetry={onRetry} retrying={retrying} />}
    </div>
  );
}

/**
 * The sales volume of the 30 days, one column a day, the running day "so far", the number of sales in each day's tip (E2's `ColumnChart`). A failed card keeps its title and its
 * source line. Its coverage note stands under the card, which is a card of its own.
 */
function VolumeChart({ data, net, native, onRetry, retrying }: Retry & { data: NftsPageData; net: NetworkId; native: string }) {
  const title = `Sales volume per day, in ${native}, last 30 days`;
  const { chart } = data;
  return (
    <div className="nfts__stack nfts__wide">
      <ChartCard
        id="nft-volume"
        title={title}
        source="/v2/network/nft_volume?interval=day"
        what={data.failures.chart ?? ""}
        state={chart === null ? "failed" : "ok"}
        onRetry={onRetry}
        retrying={retrying}
        table={chart && <ChartTable title={title} data={chart.data} />}
        notes={chart?.pending ? [chart.pending] : undefined}
        className="nfts__grow"
      >
        {chart && <ColumnChart layout="single" title={title} data={chart.data} />}
      </ChartCard>
      <CoverageNote net={net} note={data.notes.chart} />
    </div>
  );
}

/** What the top collections say when the period had no ranked sale: none at all, or sales that no price in the native currency could rank. */
function emptyTop(top: "none" | "unrated", span: string, data: NftsPageData, native: string): string {
  if (top === "none") return `No sales in the last ${span}.`;
  const count = data.tiles.sales.figure ?? "";
  return count === "1"
    ? `The 1 sale in the last ${span} was not priced in ${native} or in a token with a daily ${native} rate.`
    : `None of the ${count} sales in the last ${span} was priced in ${native} or in a token with a daily ${native} rate.`;
}

/**
 * The five largest collections of the period as bars, each a link to its page, with its sales under its name and its share at the tip of the bar (`BarList`). A period with no
 * sale, or whose sales no price could rank, says so in words in place of the list: the card has then no chart and no table view to choose.
 */
function TopCollections({ data, net, native, label, onRetry, retrying }: Retry & { data: NftsPageData; net: NetworkId; native: string; label: string }) {
  const titleId = useId();
  const title = `Top collections, ${label}`;
  const { top } = data;
  const period = PERIODS[label] ?? PERIODS["24 h"]!;
  const source = `/v2/network/nft_volume?live=${period.api}`;
  let card: ReactNode;
  if (top === "none" || top === "unrated") {
    card = (
      <section className="card chart nfts__grow" aria-labelledby={titleId}>
        <div className="chart__head">
          <div className="chart__titles">
            <h2 id={titleId} className="chart__title">
              {title}
            </h2>
            <span className="chart__source">{source}</span>
          </div>
        </div>
        <p className="nfts__empty">{emptyTop(top, period.span, data, native)}</p>
      </section>
    );
  } else {
    card = (
      <ChartCard
        id="nft-top"
        title={title}
        source={source}
        what={data.failures.top ?? ""}
        state={top === null ? "failed" : "ok"}
        onRetry={onRetry}
        retrying={retrying}
        table={top && <ChartTable title={title} data={top} />}
        className="nfts__grow"
      >
        {top && <BarList data={top} />}
      </ChartCard>
    );
  }
  return (
    <div className="nfts__stack nfts__side">
      {card}
      <CoverageNote net={net} note={data.notes.top} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The recent sales

/** The recent sales: the table, the board's note of the network, the coverage and the way to the older sales; a `SectionError` in place of them when the call failed. */
function RecentSales({ data, net, onRetry, retrying }: Retry & { data: NftsPageData; net: NetworkId }) {
  return (
    <Card title="Recent sales" flush action={<span className="chart__source">/v2/nft_sales?descending=true</span>}>
      {data.sales === null ? (
        <div className="nfts__failed">
          <SectionError what={data.failures.sales ?? ""} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : (
        <>
          <NftSalesTable label="Recent sales" rows={data.sales} />
          <div className="card__foot nfts__foot">
            <div className="nfts__notes">
              <p>{salesNote(net)}</p>
              <CoverageNote net={net} note={data.notes.sales} />
            </div>
            {data.olderSalesHref !== null && (
              <Link className="btn" to={data.olderSalesHref}>
                Older sales
                <ChevronRightIcon />
              </Link>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The collections

/** A header that sorts: a link to the list in that order (the current sort's flips it), with an arrow for the order it is in. `aria-sort` is on the header cell. */
function SortHeader({ link, children }: { link: NftSortLink; children: string }) {
  const arrow = link.ariaSort === "descending" ? "↓" : link.ariaSort === "ascending" ? "↑" : "";
  return (
    <Link to={link.href} preventScrollReset className={cx("nfts__sort", link.ariaSort !== "none" && "is-current")}>
      {children}
      {arrow !== "" && (
        <span aria-hidden="true" className="nfts__arrow">
          {arrow}
        </span>
      )}
    </Link>
  );
}

// The board's columns. `MIN_WIDTH` is the tracks at their least, the gaps (6 × 16 px) and the padding of a row (2 × 16 px), below which the table scrolls sideways.
const MIN_WIDTH = 240 + 100 + 100 + 130 + 90 + 150 + 110 + 6 * 16 + 2 * 16;

function columns(native: string, links: readonly NftSortLink[]): Column<CollectionRow>[] {
  const link = (sort: NftSortLink["sort"]) => links.find((candidate) => candidate.sort === sort)!;
  return [
    {
      id: "collection",
      header: "Collection",
      width: "minmax(240px, 1.6fr)",
      cell: (row) => (
        <span className="nfts__coll">
          <NftGlyph chars={row.glyph} />
          <span className="nfts__names">
            <Link to={row.href} className="mono nfts__issuer">
              {row.issuer}
            </Link>
            <span className="faint nfts__under">{row.under}</span>
          </span>
        </span>
      ),
    },
    {
      id: "supply",
      header: <SortHeader link={link("supply")}>Supply</SortHeader>,
      width: "100px",
      align: "end",
      sort: link("supply").ariaSort,
      cell: (row) => <span className="mono num">{row.supply}</span>,
    },
    {
      id: "holders",
      header: <SortHeader link={link("holders")}>Holders</SortHeader>,
      width: "100px",
      align: "end",
      sort: link("holders").ariaSort,
      cell: (row) => <span className="mono num">{row.holders}</span>,
    },
    { id: "minted", header: "Minted / burned", width: "130px", align: "end", cell: (row) => <span className="mono num muted">{row.mintedBurned}</span> },
    { id: "sales", header: "Sales", width: "90px", align: "end", cell: (row) => <span className="mono num">{row.sales}</span> },
    {
      id: "volume",
      header: <SortHeader link={link("volume")}>{`Volume (${native})`}</SortHeader>,
      width: "150px",
      align: "end",
      sort: link("volume").ariaSort,
      cell: (row) => <span className="mono num">{row.volume}</span>,
    },
    { id: "last", header: "Last mint", width: "110px", cell: (row) => <span className="num muted">{row.lastMint}</span> },
  ];
}

/**
 * The GET form of the issuer (spec 2.1): it works without JavaScript, and is a client-side navigation with it. The view's own `period`, `sort` and `order` are hidden fields, so that
 * Show keeps them; the canonical query has the issuer after the period and before the sort and the order, and the fields are written in that order, so that an issuer submitted as
 * an address lands on the canonical URL (an empty field sends `issuer=`, which the loader's 302 takes out). The message of an issuer that is no address is tied to the field and
 * is an alert, a new one for each issuer, so that a screen reader reads it when Show brings it.
 *
 * The form stays across a navigation, and so do the focus and what was typed: Show on an issuer that is no address leaves the visitor where they were. When the view changes (a
 * link, Back, Forward), the field takes what the page shows, unless the visitor is in it and has typed something other than what the page last showed there.
 */
function IssuerForm({ net, form }: { net: NetworkId; form: NftsPageData["issuerForm"] }) {
  const fieldId = useId();
  const errorId = useId();
  const field = useRef<HTMLInputElement>(null);
  const view = `${form.value}\u0000${JSON.stringify(form.hidden)}`;
  // The view the page last showed, and the issuer it showed in the field.
  const shown = useRef({ view, value: form.value });
  useEffect(() => {
    const input = field.current;
    if (shown.current.view !== view && input !== null && !(input === document.activeElement && input.value !== shown.current.value)) input.value = form.value;
    shown.current = { view, value: form.value };
  }, [view, form.value]);
  const hidden = ([name, value]: [string, string]) => <input key={name} type="hidden" name={name} value={value} />;
  return (
    <Form method="get" action={nftsHref(net)} className="nfts__form">
      {form.hidden.filter(([name]) => name === "period").map(hidden)}
      <label htmlFor={fieldId} className="sr">
        Collections of an issuer
      </label>
      <div className={cx("nfts__field", form.error !== undefined && "is-invalid")}>
        <SearchIcon size={15} className="nfts__icon" />
        <input
          ref={field}
          id={fieldId}
          type="search"
          name="issuer"
          className="nfts__input"
          defaultValue={form.value}
          placeholder="Issuer address (r…)"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={form.error !== undefined ? "true" : undefined}
          aria-describedby={form.error !== undefined ? errorId : undefined}
        />
      </div>
      {form.hidden.filter(([name]) => name !== "period").map(hidden)}
      <button type="submit" className="btn nfts__submit">
        Show
      </button>
      {form.error !== undefined && (
        <p key={form.value} id={errorId} role="alert" className="nfts__error">
          <AlertIcon size={14} />
          {form.error}
        </p>
      )}
    </Form>
  );
}

/** The collections: the issuer form, the table with its sort headers, the board's note, the coverage and the pager; a `SectionError` in place of the table when the call failed. */
function Collections({ data, net, native, onRetry, retrying }: Retry & { data: NftsPageData; net: NetworkId; native: string }) {
  const { collections } = data;
  const sort = data.sortLinks.find((link) => link.ariaSort !== "none")?.sort ?? "volume";
  return (
    <Card title="Collections" flush action={<span className="chart__source">{`/v2/nft_collections?sort=${sort}`}</span>}>
      <div className="nfts__filter">
        <IssuerForm net={net} form={data.issuerForm} />
      </div>
      {collections === null ? (
        data.failures.collections !== undefined && (
          <div className="nfts__failed">
            <SectionError what={data.failures.collections} onRetry={onRetry} retrying={retrying} />
          </div>
        )
      ) : (
        <>
          <DataTable
            label="Collections"
            columns={columns(native, data.sortLinks)}
            rows={collections}
            rowKey={(row) => row.key}
            minWidth={MIN_WIDTH}
            empty={data.issuerForm.value !== "" ? `No collection of ${data.issuerForm.value} in the index.` : "No collections in the index yet."}
            className="nfts__table"
          />
          <div className="card__foot nfts__foot">
            <div className="nfts__notes">
              <p>{collectionsNote(net)}</p>
              <CoverageNote net={net} note={data.notes.collections} />
            </div>
            <Pager newerHref={data.paging.newerHref} olderHref={data.paging.olderHref} labels={PAGER_LABELS} preventScrollReset />
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The NFT list (`/{net}/nfts`, spec 2.1), in the board's order: the heading and its intro, the period, the four tiles, the sales volume of the 30 days beside the top collections of
 * the period, the recent sales and the collections with their issuer form. A page behind a marker is the heading ("More NFT collections") and the collections alone. Takes what
 * the view builder made of the data API's answers (`nftsListPage`, `nftsMarkerPage`) and never fetches: every label, href and figure is text in `data`. Each card stands or fails on
 * its own; a failed one is a `SectionError` whose Retry asks the route for its data again (`useRetry`).
 */
export function NftsPage({ data }: { data: NftsPageData }) {
  const { retry, retrying } = useRetry();
  const network = useNetwork();
  const label = data.periods.find((period) => period.current)?.label ?? "24 h";
  const shared = { onRetry: retry, retrying };
  return (
    <div className="nfts">
      <div className="nfts__head">
        <h1 className="nfts__title">{data.heading}</h1>
        {data.intro !== "" && <p className="nfts__intro">{data.intro}</p>}
      </div>
      {!data.marker && (
        <>
          <div className="nfts__filters">
            <SegmentedLinks label="Period" links={data.periods} />
            <span className="nfts__hint">The period sets the totals and the top collections.</span>
          </div>
          <Totals data={data} label={label} {...shared} />
          <div className="nfts__pair">
            <VolumeChart data={data} net={network.id} native={network.native} {...shared} />
            <TopCollections data={data} net={network.id} native={network.native} label={label} {...shared} />
          </div>
          <RecentSales data={data} net={network.id} {...shared} />
        </>
      )}
      <Collections data={data} net={network.id} native={network.native} {...shared} />
    </div>
  );
}
