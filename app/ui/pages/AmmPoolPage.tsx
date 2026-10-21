import type { ReactNode } from "react";
import { Link } from "react-router";

import type {
  AmmActivity,
  AmmHistoryPageData,
  AmmNotice,
  AmmPoolHead,
  AmmPoolHeader,
  AmmPoolPageData,
  AmmSlotView,
  ChartPart,
  GovernanceRow,
  LiquidityRow,
  PoolCharts,
  SwapRow,
} from "../../server/amm-view";
import { BarList } from "../charts/BarList";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { ColumnChart } from "../charts/ColumnChart";
import { LineChart } from "../charts/LineChart";
import { Meter } from "../charts/Meter";
import { SmallMultiples } from "../charts/SmallMultiples";
import type { SmallMultiplesData, TimeSeriesData } from "../charts/types";
import { cx } from "../cx";
import { AccountLink } from "../components/AccountLink";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { Countdown } from "../components/Countdown";
import { DataTable, type Column } from "../components/DataTable";
import { LinkedText } from "../components/LinkedText";
import { LiveStateNotice } from "../components/LiveStateNotice";
import { Notice } from "../components/Notice";
import { Pager } from "../components/Pager";
import { PairCoins } from "../components/PairCoins";
import { SectionError } from "../components/SectionError";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { StatTile } from "../components/StatTile";
import { OpenIcon } from "../components/status-icons";
import { Tabs } from "../components/Tabs";
import { When } from "../components/WhenCell";
import type { NetworkInfo } from "../networks";
import { useRetry } from "../use-retry";

type Net = NetworkInfo["id"];
type Retry = { onRetry: () => void; retrying: boolean };

// ---------------------------------------------------------------------------------------------------------------------------
// The pool card and the notices

/**
 * The pool card (spec 3.1): the coins, the `<h1>`, "Market →" (E3's market page, or the header's "soon" style while the markets pages are off), the pool
 * account in full with a copy button, each issuer in full, and on the first page the Created and LP token lines.
 */
function PoolCard({ net, head }: { net: Net; head: AmmPoolHead | AmmPoolHeader }) {
  const created = "created" in head ? head.created : null;
  const lpToken = "lpToken" in head ? head.lpToken : null;
  return (
    <section className="card amm-pool__card" aria-label="Pool">
      <div className="amm-pool__name">
        <PairCoins codes={head.coins} className="amm-pool__coins" />
        <h1 className="amm-pool__title">{head.title}</h1>
        {head.market !== null ? (
          <Link to={head.market} className="amm-pool__market">
            Market →
          </Link>
        ) : (
          <span className="nav-item is-soon amm-pool__market" aria-disabled="true">
            <span>Market →</span>
            <span className="soon">soon</span>
          </span>
        )}
      </div>
      <div className="amm-pool__facts">
        <span className="amm-pool__fact">
          Pool account <AccountLink net={net} address={head.account.address} full />
          <CopyButton value={head.account.address} label="pool account" />
        </span>
        {head.issuers.map((line, at) => (
          <span key={at} className="amm-pool__fact">
            <LinkedText text={line.text} link={{ text: line.issuer.address, href: line.issuer.href }} className="mono" />
          </span>
        ))}
        {created !== null && (
          <span className="amm-pool__fact">
            Created{" "}
            <Link to={created.href} className="num">
              {created.date}
            </Link>{" "}
            by <AccountLink net={net} address={created.by.address} />
          </span>
        )}
        {lpToken !== null && (
          <span className="amm-pool__fact">
            LP token{" "}
            <span className="mono amm-pool__lp" title={lpToken.code}>
              {lpToken.short}
            </span>
            <CopyButton value={lpToken.code} label="LP token" />
          </span>
        )}
      </div>
    </section>
  );
}

/** The mode's notice and the frozen notes (spec 3.3, 3.4): `Notice`s with icon and text; the node's failure is E3's `LiveStateNotice`, with its Retry and no `role`. */
function Notices({ notices }: { notices: readonly AmmNotice[] }) {
  return notices.map((notice, at) =>
    notice.kind === "node-down" ? (
      <LiveStateNotice key={at} title={notice.title}>
        {notice.text}
      </LiveStateNotice>
    ) : (
      <Notice key={at} tone={notice.tone} title={notice.title}>
        {notice.link ? <LinkedText text={notice.text} link={notice.link} /> : notice.text}
      </Notice>
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pool state and the filters

/**
 * An exact figure with a place to wrap after each thousands separator (`<wbr>`, which adds no text): a long one ("2,417,282.053464318 RLUSD" in a tile of
 * 170 px) wraps between its groups, not inside one.
 */
function Breakable({ text }: { text: string }) {
  const groups = text.split(",");
  return groups.map((group, at) => (
    <span key={at}>
      {group}
      {at < groups.length - 1 && (
        <>
          ,<wbr />
        </>
      )}
    </span>
  ));
}

/** The seven stats in the board's grid, then where they are from, the ledger a link (spec 3.1). */
function StateCard({ state }: { state: NonNullable<AmmPoolPageData["state"]> }) {
  return (
    <section className="card amm-pool__state" aria-label="Pool state">
      <div className="amm-pool__stats">
        {state.stats.map((stat) =>
          stat.id === "reserves" ? (
            <StatTile
              key={stat.id}
              label={stat.label}
              value={
                <span className="amm-pool__reserves">
                  {stat.reserves.map((reserve, at) => (
                    <span key={at}>
                      <Breakable text={reserve} />
                    </span>
                  ))}
                </span>
              }
            />
          ) : (
            <StatTile key={stat.id} label={stat.label} value={<Breakable text={stat.value} />} sub={stat.sub} figure={stat.id === "value"} />
          ),
        )}
      </div>
      <p className="amm-pool__caption">
        <LinkedText text={state.caption.text} link={state.caption.link} />
      </p>
    </section>
  );
}

/** The period as E2's segmented links (44 px targets, a navigation that keeps the window where it is), the day rows' source line, and the window's note. */
function Filters({ filters }: { filters: AmmPoolPageData["filters"] }) {
  return (
    <div className="amm-pool__filters">
      <div role="group" aria-label="Filters" className="amm-pool__period">
        <SegmentedLinks label="Period" links={filters.period} />
        <span className="chart__source">{filters.source}</span>
      </div>
      {filters.note !== null && <p className="amm-pool__note">{filters.note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The charts

/**
 * A chart card of the pool (spec 3.5): its title, source line, the Chart/Table toggle, the chart, its table and its notes; or, failed, its title and source
 * line (the view builder's, as for a card with its data) and its `SectionError`.
 */
function PoolChartCard<T extends TimeSeriesData | SmallMultiplesData>({
  id,
  part,
  className,
  onRetry,
  retrying,
  children,
}: Retry & { id: string; part: ChartPart<T>; className?: string; children: (title: string, data: T) => ReactNode }) {
  const ok = part.state === "ok" ? part : null;
  return (
    <ChartCard
      id={id}
      title={part.title}
      source={part.source}
      // What a failed card says it could not load; a card with its data says nothing of it.
      what={part.state === "failed" ? part.what : ""}
      state={part.state}
      onRetry={onRetry}
      retrying={retrying}
      table={ok && <ChartTable title={ok.title} data={ok.data} />}
      notes={ok?.notes}
      className={className}
    >
      {ok && children(ok.title, ok.data)}
    </ChartCard>
  );
}

/**
 * The five charts, in the board's pairs: Pool value · Swap volume, Pool price · Trading fee, and Reserves the width of the page. Each card stands or fails on
 * its own. When all five failed for one reason, which the view builder says by giving all five the same `what` (the newest ledger could not be read, so there
 * is no window: "the charts", spec 3.6), they are one `SectionError`, with one Retry; failures of their own (the day rows and the candles) stay five cards.
 */
function Charts({ charts, onRetry, retrying }: Retry & { charts: PoolCharts }) {
  const parts = [charts.value, charts.volume, charts.price, charts.fee, charts.reserves];
  const [first] = parts;
  if (first?.state === "failed" && parts.every((part) => part.state === "failed" && part.what === first.what)) {
    return <SectionError what={first.what} onRetry={onRetry} retrying={retrying} />;
  }
  const retry = { onRetry, retrying };
  return (
    <>
      <div className="amm-pool__pair">
        <PoolChartCard id="pool-value" part={charts.value} className="amm-pool__half" {...retry}>
          {(title, data) => <LineChart title={title} data={data} area />}
        </PoolChartCard>
        <PoolChartCard id="pool-volume" part={charts.volume} className="amm-pool__half" {...retry}>
          {(title, data) => <ColumnChart layout="single" title={title} data={data} />}
        </PoolChartCard>
      </div>
      <div className="amm-pool__pair">
        <PoolChartCard id="pool-price" part={charts.price} className="amm-pool__half" {...retry}>
          {(title, data) => <LineChart title={title} data={data} />}
        </PoolChartCard>
        <PoolChartCard id="pool-fee" part={charts.fee} className="amm-pool__half" {...retry}>
          {(title, data) => <LineChart title={title} data={data} curve="step" />}
        </PoolChartCard>
      </div>
      <PoolChartCard id="pool-reserves" part={charts.reserves} {...retry}>
        {(title, data) => <SmallMultiples title={title} data={data} />}
      </PoolChartCard>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The auction slot and the fee votes

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="amm-pool__field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The auction slot (spec 3.1): until when it is held, in UTC, then E6's countdown in the browser (the stored page prints no age: the server's text is
 * empty); the holder and what the data has of the slot; the kit's `Meter` of the interval and the sentence that says it and the cost of a new bid. An open
 * slot (`open`, the view builder's) is "The slot is open.", a status with its icon; a slot whose state cannot be told is the builder's dash, with none.
 */
function SlotCard({ net, slot }: { net: Net; slot: AmmSlotView }) {
  const { held, open } = slot;
  return (
    <Card
      title="Auction slot"
      className="amm-pool__half"
      action={
        slot.until !== null && (
          <span className="amm-pool__aside">
            {slot.until}
            {slot.countdownAt !== null && <Countdown at={slot.countdownAt} fallback="" past="expired" lead=" · " />}
          </span>
        )
      }
    >
      <div className="amm-pool__slot">
        {held !== null && (
          <dl className="amm-pool__fields">
            <Field label="Holder">
              <AccountLink net={net} address={held.holder.address} />
            </Field>
            {held.fee !== null && (
              <Field label="Their trading fee">
                <span className="amt">{held.fee}</span>
              </Field>
            )}
            {held.pricePaid !== null && (
              <Field label="Price paid">
                <span className="amt">{held.pricePaid}</span>
              </Field>
            )}
            {held.authorized !== null && (
              <Field label="Authorized accounts">
                {held.authorized.length === 0
                  ? "none"
                  : held.authorized.map((account, at) => (
                      <span key={account.address}>
                        {at > 0 && ", "}
                        <AccountLink net={net} address={account.address} />
                      </span>
                    ))}
              </Field>
            )}
          </dl>
        )}
        {slot.meter !== null && <Meter data={slot.meter} />}
        {slot.text !== null && (
          <p className="amm-pool__slot-text">
            {open && <OpenIcon className="amm-pool__open" />}
            <span>{slot.text}</span>
          </p>
        )}
      </div>
    </Card>
  );
}

/** The sentence of the result, the part the view builder names (`figure`) in bold: "Weighted result **0.300%**, the pool's trading fee." */
function Result({ text, figure }: { text: string; figure: string | null }) {
  const at = figure === null ? -1 : text.indexOf(figure);
  if (figure === null || at < 0) return <p className="amm-pool__result">{text}</p>;
  return (
    <p className="amm-pool__result">
      {text.slice(0, at)}
      <strong className="amt">{figure}</strong>
      {text.slice(at + figure.length)}
    </p>
  );
}

/** The fee votes (spec 3.1): one bar a vote slot, its account a link, the fee it votes for under it, its share of the LP tokens at the tip; then the result. */
function VotesCard({ votes, onRetry, retrying }: Retry & { votes: NonNullable<AmmPoolPageData["votes"]> }) {
  return (
    <Card title="Fee votes" className="amm-pool__half" action={<span className="amm-pool__aside">weighted by LP tokens held</span>}>
      {votes.state === "failed" ? (
        <SectionError what={votes.what} onRetry={onRetry} retrying={retrying} />
      ) : (
        <div className="amm-pool__votes">
          {votes.data !== null && <BarList data={votes.data} tip="share-of" dense />}
          <Result text={votes.text} figure={votes.figure} />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The activity

/** A signed amount of the pool's side: a plus in the success colour, a minus, or a plain `0` (the view builder wrote the sign). */
function Signed({ text }: { text: string }) {
  return <span className={cx("amt num", text.startsWith("+") && "amt--pos")}>{text}</span>;
}

/**
 * What went in and what came out. A pool of one code on both sides (USD of two issuers) reads "USD → USD", so its cell is named by the direction with each
 * issuer, on hover too (Task 7's note).
 */
function Direction({ row }: { row: SwapRow }) {
  if (row.directionTitle === null) return <>{row.direction}</>;
  return (
    <span title={row.directionTitle}>
      <span aria-hidden="true">{row.direction}</span>
      <span className="sr">{row.directionTitle}</span>
    </span>
  );
}

// The columns of the tabs (spec 3.1), each table at its least the tracks, the gaps (16 px between columns) and the padding of a row (2 × 16 px).
function swapColumns(net: Net, codes: [string, string]): Column<SwapRow>[] {
  return [
    { id: "time", header: "Time (UTC)", width: "120px", cell: (row) => <When net={net} hash={row.hash} time={row.time} /> },
    { id: "direction", header: "Direction", width: "120px", cell: (row) => <Direction row={row} /> },
    { id: "into", header: "Into the pool", width: "minmax(130px, 1fr)", align: "end", cell: (row) => <span className="amt num">{row.into}</span> },
    { id: "out", header: "Out of the pool", width: "minmax(130px, 1fr)", align: "end", cell: (row) => <span className="amt num">{row.out}</span> },
    { id: "price", header: `Price (${codes[1]} per ${codes[0]})`, width: "minmax(130px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.price}</span> },
    { id: "taker", header: "Taker", width: "130px", cell: (row) => <AccountLink net={net} address={row.taker.address} /> },
  ];
}
const SWAPS_WIDTH = 120 + 120 + 3 * 130 + 130 + 5 * 16 + 2 * 16;

function liquidityColumns(net: Net, codes: [string, string]): Column<LiquidityRow>[] {
  return [
    { id: "time", header: "Time (UTC)", width: "120px", cell: (row) => <When net={net} hash={row.hash} time={row.time} /> },
    { id: "event", header: "Event", width: "90px", cell: (row) => <span className="tag">{row.event}</span> },
    { id: "mode", header: "Mode", width: "140px", cell: (row) => <span className="mono muted amm-pool__mode">{row.mode}</span> },
    { id: "first", header: codes[0], width: "minmax(120px, 1fr)", align: "end", cell: (row) => <Signed text={row.first} /> },
    { id: "second", header: codes[1], width: "minmax(120px, 1fr)", align: "end", cell: (row) => <Signed text={row.second} /> },
    { id: "lp", header: "LP tokens", width: "minmax(120px, 1fr)", align: "end", cell: (row) => <Signed text={row.lpTokens} /> },
    {
      id: "provider",
      header: "Provider",
      width: "minmax(140px, 1fr)",
      cell: (row) => (
        <span>
          <AccountLink net={net} address={row.provider.address} />
          {row.by !== null && (
            <span className="faint">
              {" "}
              by <AccountLink net={net} address={row.by.address} />
            </span>
          )}
        </span>
      ),
    },
  ];
}
const LIQUIDITY_WIDTH = 120 + 90 + 140 + 3 * 120 + 140 + 6 * 16 + 2 * 16;

function governanceColumns(net: Net): Column<GovernanceRow>[] {
  return [
    { id: "time", header: "Time (UTC)", width: "120px", cell: (row) => <When net={net} hash={row.hash} time={row.time} /> },
    { id: "kind", header: "Kind", width: "70px", cell: (row) => <span className="tag">{row.kind}</span> },
    { id: "account", header: "Account", width: "130px", cell: (row) => <AccountLink net={net} address={row.account.address} /> },
    { id: "what", header: "What happened", width: "minmax(260px, 2fr)", cell: (row) => <span className="muted">{row.what}</span> },
    { id: "fee", header: "Fee after", width: "100px", align: "end", cell: (row) => <span className="mono num">{row.feeAfter}</span> },
  ];
}
const GOVERNANCE_WIDTH = 120 + 70 + 130 + 260 + 100 + 4 * 16 + 2 * 16;

function ActivityTable({ net, activity }: { net: Net; activity: AmmActivity }) {
  const { list, codes } = activity;
  if (list.state !== "ok") return null;
  const empty = list.empty ?? undefined;
  switch (list.tab) {
    case "swaps":
      return <DataTable label="Swaps" columns={swapColumns(net, codes)} rows={list.rows} rowKey={(row) => row.key} minWidth={SWAPS_WIDTH} empty={empty} className="amm-pool__table" />;
    case "liquidity":
      return (
        <DataTable
          label="Liquidity events"
          columns={liquidityColumns(net, codes)}
          rows={list.rows}
          rowKey={(row) => row.key}
          minWidth={LIQUIDITY_WIDTH}
          empty={empty}
          className="amm-pool__table"
        />
      );
    case "governance":
      return (
        <DataTable label="Votes and bids" columns={governanceColumns(net)} rows={list.rows} rowKey={(row) => row.key} minWidth={GOVERNANCE_WIDTH} empty={empty} className="amm-pool__table" />
      );
  }
}

/**
 * The Pool activity card (spec 3.1): the tabs, links that keep the window where it is, with the tab's source line; the table, the words under it and the
 * pager (Newer / Older). A table that could not be loaded is its `SectionError`, under the tabs, which stay links.
 */
function Activity({ net, activity, onRetry, retrying }: Retry & { net: Net; activity: AmmActivity }) {
  const { list } = activity;
  return (
    <Card label="Pool activity" flush className="amm-pool__activity">
      <div className="amm-pool__tabs">
        <Tabs label="Pool activity" items={activity.tabs} current={activity.current} preventScrollReset />
        <span className="chart__source">{activity.source}</span>
      </div>
      {list.state === "failed" ? (
        <div className="amm__failed">
          <SectionError what={list.what} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : (
        <>
          <ActivityTable net={net} activity={activity} />
          <div className="card__foot amm-pool__foot">
            <div className="amm-pool__notes">
              {list.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
            <Pager newerHref={list.paging.newerHref} olderHref={list.paging.olderHref} preventScrollReset />
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The pool page (`/{net}/amm/{pool}`, spec 3.1), in the board's order: the breadcrumb; the pool card; the notices of its mode; the pool state; the period
 * with its source line and note; the five charts in pairs; the auction slot and the fee votes; the pool's activity. A page behind a marker (`kind: "history"`)
 * has the breadcrumb, the pool card without its Created and LP token lines, "Back to the pool" and the activity, and nothing that would be as old as the
 * stored page (spec 3.3).
 *
 * Takes what the view builder made of the index's and the node's answers (`ammPoolPage`, `ammHistoryPage`) and never fetches: every label, href and
 * figure is text in `data`, and a part the mode leaves out is `null`. Each card stands or fails on its own; a failed one is a `SectionError` whose Retry
 * asks the route for its data again (`useRetry`). The page root is `.amm`, the list's: its pager's buttons are 44 px.
 */
export function AmmPoolPage({ data }: { data: AmmPoolPageData | AmmHistoryPageData }) {
  const { retry, retrying } = useRetry();
  const net = data.meta.net;
  return (
    <div className="amm amm-pool">
      <Breadcrumbs items={data.crumbs} />
      <PoolCard net={net} head={data.header} />
      {data.kind === "history" ? (
        <p className="amm-pool__back">
          <Link to={data.backHref}>Back to the pool</Link>
        </p>
      ) : (
        <>
          <Notices notices={data.notices} />
          {data.state !== null && <StateCard state={data.state} />}
          <Filters filters={data.filters} />
          <Charts charts={data.charts} onRetry={retry} retrying={retrying} />
          {(data.slot !== null || data.votes !== null) && (
            <div className="amm-pool__pair">
              {data.slot !== null && <SlotCard net={net} slot={data.slot} />}
              {data.votes !== null && <VotesCard votes={data.votes} onRetry={retry} retrying={retrying} />}
            </div>
          )}
        </>
      )}
      <Activity net={net} activity={data.activity} onRetry={retry} retrying={retrying} />
    </div>
  );
}
