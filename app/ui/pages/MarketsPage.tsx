import { useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import type { MarketRowView, MarketsPageData } from "../../server/markets-view";
import { Meter } from "../charts/Meter";
import { Sparkline } from "../charts/Sparkline";
import { Card } from "../components/Card";
import { count, DataTable, FIRST_ROWS, type Column } from "../components/DataTable";
import { SearchIcon, TriangleDownIcon, TriangleUpIcon } from "../components/icons";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { StatGrid, StatTile } from "../components/StatTile";
import type { NetworkInfo } from "../networks";
import { useHydrated } from "../use-hydrated";

const pairs = (n: number) => `${count(n)} ${n === 1 ? "pair" : "pairs"}`;

/** The columns the rows can be sorted by, by their key in `MarketRowView.ranks`, and how the count line names each. */
type SortKey = keyof MarketRowView["ranks"];
type Direction = "descending" | "ascending";
interface Sort {
  key: SortKey;
  dir: Direction;
}
const SORT_WORDS: Record<SortKey, string> = { last: "last price", change: "change", volume: "volume", trades: "trades" };

/** The order the rows come in: the API's, which is by volume, largest first. */
const SERVER_ORDER: Sort = { key: "volume", dir: "descending" };

/**
 * The rows in the order `sort` names, from the ranks the view builder wrote (each row's place in an exact ascending sort, equal values sharing
 * one): integers, so the browser compares no decimal. Rows of one rank keep the API's order in both directions, and a row without a rank (no
 * price, no change, no native volume) is last in both, the API's order kept among such rows. Volume, largest first, is the API's own order,
 * so it is the rows as they came.
 */
function sorted(rows: readonly MarketRowView[], sort: Sort): readonly MarketRowView[] {
  if (sort.key === SERVER_ORDER.key && sort.dir === SERVER_ORDER.dir) return rows;
  const sign = sort.dir === "descending" ? -1 : 1;
  return rows
    .map((row, at) => ({ row, at, rank: row.ranks[sort.key] }))
    .sort((a, b) => {
      if (a.rank === null || b.rank === null) return a.rank === b.rank ? a.at - b.at : a.rank === null ? 1 : -1;
      return sign * (a.rank - b.rank) || a.at - b.at;
    })
    .map(({ row }) => row);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The cells

/** The pair as the row's one target: a link to its page, a block of at least 44 px that holds the issuers under the pair, as text. */
function PairCell({ row }: { row: MarketRowView }) {
  const content = (
    <>
      <span className="markets__name">{row.pair}</span>
      {row.issuers !== "" && <span className="markets__issuers mono">{row.issuers}</span>}
    </>
  );
  // A pair the data API cannot be asked for (a lower-case standard code) has no page: it is listed as text.
  if (row.href === null) return <span className="markets__pair">{content}</span>;
  return (
    <Link to={row.href} className="markets__pair">
      {content}
    </Link>
  );
}

/** The signed change in --muted, after a triangle that is a picture (the text says the sign); none for 0.00% or a dash. */
function ChangeCell({ change }: { change: MarketRowView["change"] }) {
  return (
    <span className="markets__change">
      {change.dir === "up" && <TriangleUpIcon />}
      {change.dir === "down" && <TriangleDownIcon />}
      {change.text}
    </span>
  );
}

/** The AMM share: a small meter, decorative (the text beside it says the value), and the share, or the cell's word for it. */
function AmmCell({ amm }: { amm: MarketRowView["amm"] }) {
  if (amm === null) return null;
  return (
    <span className="markets__amm">
      {amm.meter && (
        <span className="markets__meter">
          <Meter data={amm.meter} small decorative />
        </span>
      )}
      <span>{amm.text}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The markets page (`/{net}/markets`, spec 2.1), in the board's order: the heading and its intro, the filters (the Period, Quote and Trades
 * views as segmented links, and the text filter), the period note, the totals, and the Pairs card (its source line, the table, the count line
 * and the footnote). Takes what the view builder made of the data API's one answer (`marketsPage`) and never fetches: every label, href and
 * figure is text in `data`.
 *
 * The HTML holds the first `FIRST_ROWS` rows (the ledger page's). What only a script can do is drawn after hydration (`useHydrated`, from
 * `app/ui/use-hydrated.ts`, which loads nothing of the plot) and is left out of the server's HTML, since no control may do nothing without JavaScript (spec 2.2):
 * "Show all", which shows the rest of the rows the loader served without a request; the text filter, whose row is there from the start so
 * that adding it moves nothing; and the sort buttons, where the server prints plain headers with `aria-sort`. The
 * text filter narrows the rows to those whose search text holds what is typed; a sort orders them by the view builder's ranks. The tiles stay
 * those of the view: the count line, the page's one `role="status"`, says what is shown.
 */
export function MarketsPage({ network, data }: { network: NetworkInfo; data: MarketsPageData }) {
  const hydrated = useHydrated();
  const fieldId = useId();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(SERVER_ORDER);
  const [showAll, setShowAll] = useState(false);

  const needle = query.trim().toLowerCase();
  const ordered = useMemo(() => sorted(data.rows, sort), [data.rows, sort]);
  const matching = useMemo(() => (needle === "" ? ordered : ordered.filter((row) => row.search.includes(needle))), [ordered, needle]);
  const shown = showAll ? matching : matching.slice(0, FIRST_ROWS);

  const total = data.rows.length;
  const order = `by ${SORT_WORDS[sort.key]}, ${sort.dir === "descending" ? "largest first" : "smallest first"}`;
  const countLine = total === 0 ? "" : needle === "" ? `${pairs(total)}, ${order}` : `Showing ${count(matching.length)} of ${pairs(total)}, ${order}`;

  /** A press sorts by the column, largest first; a press on the column the rows are sorted by reverses it. */
  const press = (key: SortKey) =>
    setSort((now) => (now.key === key ? { key, dir: now.dir === "descending" ? "ascending" : "descending" } : { key, dir: "descending" }));

  /** A sortable header: plain text (with the order's arrow) in the server's HTML, a button that fills the header after hydration. */
  const sortable = (key: SortKey, label: string): Pick<Column<MarketRowView>, "header" | "sort"> => {
    const arrow =
      sort.key === key ? (
        <span className="markets__arrow" aria-hidden="true">
          {sort.dir === "descending" ? "↓" : "↑"}
        </span>
      ) : null;
    const header: ReactNode = hydrated ? (
      <button type="button" className="markets__sort" onClick={() => press(key)}>
        {label}
        {arrow}
      </button>
    ) : (
      <>
        {label}
        {arrow}
      </>
    );
    return { header, sort: sort.key === key ? sort.dir : "none" };
  };

  // The board's columns, weighted so that a range of two prices of 16 characters ("0.00000032329039 – 0.00000037729557", 273 px of 13 px
  // mono) holds on one line at the page's widest (a table of 1,198 px), and a price of 16 characters (134 px of 14 px mono) fits its track.
  // Narrower, a range wraps at its dash. `minWidth` is the tracks at their least, the gaps (16 px) and the padding (2 × 16 px) of a row:
  // 1,060 px with the AMM column, 948 px without.
  const columns: Column<MarketRowView>[] = [
    { id: "place", header: "#", width: "30px", align: "end", cell: (_row, index) => <span className="mono num faint">{index + 1}</span> },
    { id: "pair", header: "Pair", width: "minmax(160px, 1fr)", cell: (row) => <PairCell row={row} /> },
    { id: "last", ...sortable("last", "Last price"), width: "136px", align: "end", cell: (row) => <span className="mono num">{row.last}</span> },
    { id: "change", ...sortable("change", "Change"), width: "80px", align: "end", cell: (row) => <ChangeCell change={row.change} /> },
    { id: "range", header: "Low – high", width: "minmax(150px, 1.6fr)", align: "end", cell: (row) => <span className="mono num muted markets__range">{row.range}</span> },
    { id: "volume", ...sortable("volume", `Volume (${network.native})`), width: "92px", align: "end", cell: (row) => <span className="mono num">{row.volume}</span> },
    { id: "trades", ...sortable("trades", "Trades"), width: "56px", align: "end", cell: (row) => <span className="num muted">{row.trades}</span> },
    ...(data.ammColumn ? [{ id: "amm", header: "AMM share", width: "96px", cell: (row: MarketRowView) => <AmmCell amm={row.amm} /> }] : []),
    { id: "spark", header: "7 days", width: "100px", cell: (row) => <Sparkline values={row.spark.closes} label={row.spark.label} /> },
  ];
  const minWidth = data.ammColumn ? 1060 : 948;

  return (
    <div className="markets">
      <div className="markets__head">
        <h1 className="markets__title">Markets</h1>
        <p className="markets__intro">{data.intro}</p>
      </div>

      <div role="group" aria-label="Filters" className="markets__filters">
        <SegmentedLinks label="Period" links={data.filters.period} />
        <SegmentedLinks label="Quote" links={data.filters.quote} />
        {data.filters.trades && <SegmentedLinks label="Trades" links={data.filters.trades} />}
        <div className="markets__search">
          {hydrated && (
            <div className="markets__field">
              <label htmlFor={fieldId} className="sr">
                Filter pairs
              </label>
              <SearchIcon size={15} className="markets__icon" />
              <input
                id={fieldId}
                type="search"
                className="markets__input"
                placeholder="Filter by currency or issuer"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          )}
        </div>
      </div>

      {data.note !== null && <p className="markets__note">{data.note}</p>}

      {data.tiles !== null && (
        <StatGrid narrow label="Totals">
          {data.tiles.map((tile) => (
            <StatTile key={tile.label} figure label={tile.label} value={tile.value} sub={tile.sub} />
          ))}
        </StatGrid>
      )}

      <Card title="Pairs" flush action={<span className="chart__source">{data.source}</span>}>
        <DataTable
          label="Pairs"
          columns={columns}
          rows={shown}
          rowKey={(row) => row.key}
          minWidth={minWidth}
          empty={data.empty ?? (needle !== "" ? `No pairs match “${query.trim()}”.` : undefined)}
          className="markets__table"
        />
        <div className="card__foot">
          <p role="status" className="markets__count">
            {countLine}
          </p>
          {hydrated && matching.length > FIRST_ROWS && (
            <button type="button" className="btn" onClick={() => setShowAll((all) => !all)}>
              {showAll ? `Show first ${count(FIRST_ROWS)}` : `Show all ${count(matching.length)}`}
            </button>
          )}
        </div>
        <div className="card__foot markets__footnote">
          <p>{data.footnote.left}</p>
          <p>{data.footnote.right}</p>
        </div>
      </Card>
    </div>
  );
}
