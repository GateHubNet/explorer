import { useId } from "react";
import { Form, Link } from "react-router";

import { ammListPath } from "../../domain/amm-params";
import type { AmmListPageData, AmmRowView } from "../../server/amm-view";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { ColumnChart } from "../charts/ColumnChart";
import { cx } from "../cx";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { AlertIcon, SearchIcon } from "../components/icons";
import { Pager } from "../components/Pager";
import { PairCoins } from "../components/PairCoins";
import { SectionError } from "../components/SectionError";
import { StatGrid, StatTile } from "../components/StatTile";
import { DeletedIcon, OpenIcon } from "../components/status-icons";
import { useNetwork } from "../use-network";
import { useRetry } from "../use-retry";

/** What a tile of totals that could not be loaded shows under its label. */
const DASH = "—";

/** The list is ordered by value, not by time: its pager's words (spec 2.1). */
const PAGER_LABELS = { newer: "Previous", older: "More pools" } as const;

// ---------------------------------------------------------------------------------------------------------------------------
// The cells

/** The coins, then the pair as a link to the pool's page over the account and the issuers, and the "Deleted" tag of a deleted pool. */
function PoolCell({ row }: { row: AmmRowView }) {
  return (
    <span className="amm__pool">
      <PairCoins codes={row.coins} />
      <span className="amm__names">
        <Link to={row.href} className="amm__pair">
          {row.pair}
        </Link>
        <span className="amm__detail mono">{row.detail}</span>
      </span>
      {row.deleted && (
        <span className="tag tag--icon">
          <DeletedIcon />
          Deleted
        </span>
      )}
    </span>
  );
}

/** The holder of the slot, linked; "Open", a status with its icon; or the dash of a slot that cannot be told (the view builder says which). */
function SlotCell({ slot }: { slot: AmmRowView["slot"] }) {
  if (slot.href !== null) {
    return (
      <Link to={slot.href} className="mono amm__slot">
        {slot.text}
      </Link>
    );
  }
  if (!slot.open) return <span className="muted">{slot.text}</span>;
  return (
    <span className="st st--quiet">
      <OpenIcon />
      {slot.text}
    </span>
  );
}

// The board's columns, without its "Fees 24 h, est." (spec 2.1), the Pool track 40 px wider than the board's so that a pair and the "Deleted" tag beside
// it hold on one line: the tracks at their least, the gaps (6 × 16 px) and the padding of a row (2 × 16 px) are `MIN_WIDTH`, below which the table
// scrolls sideways inside its card. A cell wraps a figure longer than its track (`.amm__table`): a compact number
// stops at "T", so an absurd reserve is a hundred digits, and it must not widen the table.
const columns = (native: string): Column<AmmRowView>[] => [
  { id: "pool", header: "Pool", width: "minmax(240px, 1.4fr)", cell: (row) => <PoolCell row={row} /> },
  { id: "value", header: `Value (${native})`, width: "120px", align: "end", cell: (row) => <span className="mono num amm__figure">{row.value}</span> },
  {
    id: "reserves",
    header: "Reserves",
    width: "minmax(190px, 1.2fr)",
    align: "end",
    cell: (row) => (
      <span className="mono num amm__reserves">
        <span>{row.reserves[0]}</span>
        <span>{row.reserves[1]}</span>
      </span>
    ),
  },
  { id: "fee", header: "Fee", width: "80px", align: "end", cell: (row) => <span className="mono num">{row.fee}</span> },
  { id: "volume", header: "Volume 24 h", width: "120px", align: "end", cell: (row) => <span className="mono num amm__figure">{row.volume}</span> },
  { id: "slot", header: "Auction slot", width: "130px", cell: (row) => <SlotCell slot={row.slot} /> },
  {
    id: "created",
    header: "Created",
    width: "110px",
    cell: (row) =>
      row.created.href === null ? (
        <span className="muted">{row.created.text}</span>
      ) : (
        <Link to={row.created.href} className="num amm__created">
          {row.created.text}
        </Link>
      ),
  },
];
const MIN_WIDTH = 240 + 120 + 190 + 80 + 120 + 130 + 110 + 6 * 16 + 2 * 16;

// ---------------------------------------------------------------------------------------------------------------------------
// The parts

/** The GET form of the filter (spec 1.2): it works without JavaScript, and is a client-side navigation with it. */
function Filter({ net, filter }: { net: AmmListPageData["net"]; filter: AmmListPageData["filter"] }) {
  const fieldId = useId();
  const errorId = useId();
  return (
    // A new filter is a new form: its fields start from what the page shows, not from what was typed before the navigation.
    <Form key={`${filter.value}\u0000${filter.deleted}`} method="get" action={ammListPath(net)}>
      <div role="group" aria-label="Filters" className="amm__filters">
        <div className="amm__asset">
          <label htmlFor={fieldId} className="amm__label">
            Pools with this asset
          </label>
          <div className={cx("amm__field", filter.error !== undefined && "is-invalid")}>
            <SearchIcon size={15} className="amm__icon" />
            <input
              id={fieldId}
              type="search"
              name="asset"
              className="amm__input"
              defaultValue={filter.value}
              placeholder="XRP or RLUSD.rMxCK…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={filter.error !== undefined ? "true" : undefined}
              aria-describedby={filter.error !== undefined ? errorId : undefined}
            />
          </div>
        </div>
        <label className="amm__check">
          {/* P26: `deleted=1`, the canonical form's; a checkbox's default value, "on", would be dropped. */}
          <input type="checkbox" name="deleted" value="1" defaultChecked={filter.deleted} />
          Include deleted pools
        </label>
        <button type="submit" className="btn amm__submit">
          Show pools
        </button>
        {filter.error !== undefined && (
          <p id={errorId} className="amm__error">
            <AlertIcon size={14} />
            {filter.error}
          </p>
        )}
      </div>
    </Form>
  );
}

/** The three tiles of the last 24 hours and the time they were read; dashes under the same labels, and one `SectionError`, when they failed. */
function Totals({ totals, onRetry, retrying }: { totals: AmmListPageData["totals"]; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="amm__totals">
      <StatGrid label="Totals">
        {totals.state === "ok"
          ? totals.tiles.map((tile) => (
              <StatTile
                key={tile.label}
                figure
                label={tile.label}
                value={tile.href === null ? tile.value : <Link to={tile.href}>{tile.value}</Link>}
                sub={tile.sub}
              />
            ))
          : totals.labels.map((label) => <StatTile key={label} figure label={label} value={DASH} />)}
      </StatGrid>
      {totals.state === "ok" ? <p className="amm__note">{totals.note}</p> : <SectionError what={totals.what} onRetry={onRetry} retrying={retrying} />}
    </div>
  );
}

/**
 * The swap volume of the 30 days, one column a day, the running day "so far" (E2's `ColumnChart`, as the network page draws its AMM series). A failed card
 * keeps the title and the source line the view builder gives it.
 */
function VolumeChart({ chart, onRetry, retrying }: { chart: AmmListPageData["chart"]; onRetry: () => void; retrying: boolean }) {
  const ok = chart.state === "ok" ? chart : null;
  return (
    <ChartCard
      id="amm-volume"
      title={chart.title}
      source={chart.source}
      // What a failed card says it could not load; a card with its data says nothing of it.
      what={chart.state === "failed" ? chart.what : ""}
      state={chart.state}
      onRetry={onRetry}
      retrying={retrying}
      table={ok && <ChartTable title={ok.title} data={ok.data} />}
      notes={ok && ok.note !== null ? [ok.note] : undefined}
    >
      {ok && <ColumnChart layout="single" title={ok.title} data={ok.data} />}
    </ChartCard>
  );
}

/**
 * The Pools card: the source line, the table, the words under it and the pager; the source line and its `SectionError` when the pools failed. None for an
 * asset that does not parse.
 */
function Pools({ data, onRetry, retrying }: { data: AmmListPageData; onRetry: () => void; retrying: boolean }) {
  const { pools } = data;
  if (pools.state === "skipped") return null;
  return (
    <Card title="Pools" flush action={<span className="chart__source">{pools.source}</span>}>
      {pools.state === "failed" ? (
        <div className="amm__failed">
          <SectionError what={pools.what} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : (
        <>
          {pools.note !== null && (
            <p className="amm__problem">
              <AlertIcon size={14} />
              {pools.note}
            </p>
          )}
          <DataTable
            label="Pools"
            columns={columns(data.native)}
            rows={pools.rows}
            rowKey={(row) => row.key}
            minWidth={MIN_WIDTH}
            empty={pools.empty ?? undefined}
            className="amm__table"
          />
          <div className="card__foot amm__foot">
            <p>{pools.footnote}</p>
            <Pager newerHref={pools.paging.newerHref} olderHref={pools.paging.olderHref} labels={PAGER_LABELS} preventScrollReset />
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The AMM pools list (`/{net}/amm`, spec 2.1), in the board's order: the heading and its intro, the filter (a GET form: one asset, the deleted pools,
 * "Show pools"), the totals of the last 24 hours, the swap volume of the 30 days, and the Pools card (its source line, the table, the words under it
 * and the pager, "Previous" / "More pools", which keeps the window where it is). Takes what the view builder made of the data API's answers
 * (`ammListPage`) and never fetches: every label, href and figure is text in `data`. Each card stands or fails on its own; a failed one is a
 * `SectionError` whose Retry asks the route for its data again (`useRetry`).
 */
export function AmmListPage({ data }: { data: AmmListPageData }) {
  const { retry, retrying } = useRetry();
  const network = useNetwork();
  return (
    <div className="amm">
      <div className="amm__head">
        <h1 className="amm__title">AMM pools</h1>
        <p className="amm__intro">{`Automated market maker pools on ${network.longName}. Swaps against them also count as DEX trades.`}</p>
      </div>
      <Filter net={data.net} filter={data.filter} />
      <Totals totals={data.totals} onRetry={retry} retrying={retrying} />
      <VolumeChart chart={data.chart} onRetry={retry} retrying={retrying} />
      <Pools data={data} onRetry={retry} retrying={retrying} />
    </div>
  );
}
