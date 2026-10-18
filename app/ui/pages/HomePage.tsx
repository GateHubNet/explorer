import { useRef, type FocusEvent, type PointerEvent } from "react";
import { Link } from "react-router";

import { formatAmount, formatUtc } from "../../domain/format";
import type { HomeLedgerRow, HomePageData, HomeTxRow } from "../../server/home-view";
import { LATEST_LEDGERS_ID, LATEST_TRANSACTIONS_ID } from "../anchors";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { HashLink, LedgerLink } from "../components/HashLink";
import { LiveStatus, LiveToggle, PAUSED_AFTER_FAILURES } from "../components/LiveStatus";
import { LiveValue } from "../components/LiveValue";
import { ResultPill } from "../components/Pill";
import { RelativeTime } from "../components/RelativeTime";
import { SearchBox } from "../components/SearchBox";
import { StatGrid, StatTile } from "../components/StatTile";
import { TypeTag } from "../components/TypeTag";
import type { NetworkInfo } from "../networks";
import type { LiveControls } from "../use-home-live";
import { cx } from "../cx";

/** The headline of each network's home page (also its title). */
export const HOME_TITLES = { xrpl: "Explore the XRP Ledger", xahau: "Explore Xahau" } as const;

/** `17:01:12`, from unix seconds. */
const timeOfDay = (at: number) => formatUtc(at).slice(11, 19);
const count = (n: number) => formatAmount(String(n));

/**
 * The home page: the search hero with examples, four tiles, the newest ledgers and the newest transactions. Takes what the
 * loader made of the data API's answers (`homePage`) and never fetches. Ages are worked out in the browser
 * (`RelativeTime`); the HTML itself carries close times, so that one stored copy is right for everybody.
 *
 * The page follows the chain: the route asks for its data again every few seconds (`useLiveRefresh`), and what changes in `data` moves.
 * New rows enter at the top of the two tables and the rows that were there slide down (`DataTable live`); a figure that changed
 * ticks in (`LiveValue`, with the text it shows as its token, so that a figure that says the same does not move). None of it on the first
 * render, so the server's HTML and the hydration are the same, and none for a visitor who asked for less motion (see motion.ts).
 *
 * `live` is what the visitor can do about it and what the page says: a button that pauses and resumes the updates, a quiet status line
 * when they cannot reach the page, and a hold while the pointer is over a table or focus is in one, so that rows do not move under a
 * click. Without it (every other use of the page) there are none of the three.
 */
export function HomePage({ network, data, live }: { network: NetworkInfo; data: HomePageData; live?: LiveControls }) {
  const { latest, txCount, average, fees } = data;
  const stopped = live !== undefined && (live.paused || live.failures >= PAUSED_AFTER_FAILURES);

  // A hold for each table and each way of being on it; the page is held while any is.
  const holds = useRef(new Set<string>());
  const hold = (id: string, on: boolean) => {
    if (on) holds.current.add(id);
    else holds.current.delete(id);
    live?.onHold(holds.current.size > 0);
  };
  const holding = (table: string) => ({
    // A finger is not a pointer that stays over a table: only a mouse or a pen holds.
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "touch") hold(`${table}:pointer`, true);
    },
    onPointerLeave: () => hold(`${table}:pointer`, false),
    onFocus: () => hold(`${table}:focus`, true),
    // Focus moving inside the table is not leaving it.
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hold(`${table}:focus`, false);
    },
  });
  const latestHref = `/${network.id}/ledger/${latest.index}`;
  const whole = latest.supply.split(".")[0]!;
  // What the tiles say as text: it is also the token of the figure, which ticks in only when it says something else.
  const txPerLedger = txCount === null ? "—" : count(txCount);
  const txAverage = average ? `average ${count(average.transactions)} over the last ${count(average.ledgers)}` : "not counted yet";
  const feeNote = fees ? `average ${formatAmount(fees.average)} · max ${formatAmount(fees.max)} per transaction` : "not counted yet";

  const ledgerColumns: Column<HomeLedgerRow>[] = [
    { id: "ledger", header: "Ledger", width: "minmax(100px, 1fr)", cell: (row) => <LedgerLink net={network.id} index={row.index} /> },
    { id: "txs", header: "Txs", width: "48px", align: "end", cell: (row) => <span className="mono num">{count(row.txCount)}</span> },
    {
      id: "closed",
      header: "Closed (UTC)",
      width: "84px",
      align: "end",
      cell: (row) => <span className="mono num muted">{timeOfDay(row.closeTime)}</span>,
    },
    { id: "age", header: "Age", width: "68px", align: "end", cell: (row) => <RelativeTime at={row.closeTime} className="age" /> },
  ];

  const txColumns: Column<HomeTxRow>[] = [
    { id: "type", header: "Type", width: "minmax(108px, 140px)", cell: (row) => <TypeTag type={row.type} /> },
    { id: "hash", header: "Hash", width: "100px", cell: (row) => <HashLink net={network.id} kind="tx" hash={row.hash} /> },
    { id: "account", header: "Account", width: "minmax(110px, 1fr)", ellipsis: true, cell: (row) => <AccountLink net={network.id} address={row.account} /> },
    {
      id: "amount",
      header: "Amount",
      width: "minmax(130px, 1.2fr)",
      align: "end",
      ellipsis: true,
      cell: (row) =>
        row.amount ? (
          <Amount value={row.amount.value} currency={row.amount.currency} issuer={row.amount.issuer} />
        ) : (
          <span className="faint">—</span>
        ),
    },
    { id: "result", header: "Result", width: "112px", cell: (row) => <ResultPill ok={row.ok} code={row.code} /> },
    { id: "age", header: "Age", width: "72px", align: "end", cell: (row) => <RelativeTime at={row.date} className="age" /> },
  ];

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__status-row">
          <p className="hero__status">
            <span className={cx("hero__dot", stopped && "is-paused")} aria-hidden="true" />
            <span>
              {network.name} mainnet · ledger{" "}
              <LiveValue token={String(latest.index)}>
                <LedgerLink net={network.id} index={latest.index} />
              </LiveValue>{" "}
              validated{" "}
              <LiveValue token={String(latest.closeTime)}>
                <RelativeTime at={latest.closeTime} fallback={`at ${formatUtc(latest.closeTime).slice(11)}`} />
              </LiveValue>
              {live && <LiveStatus failures={live.failures} />}
            </span>
          </p>
          {live && <LiveToggle paused={live.paused} onToggle={live.onTogglePause} />}
        </div>
        <h1 id="hero-title" className="hero__title">
          {HOME_TITLES[network.id]}
        </h1>
        <p className="hero__lead">
          Look up any ledger, transaction or account from validated history. Balances and account settings are read live from the
          network.
        </p>
        <SearchBox net={network} variant="hero" />
        {data.examples.length > 0 && (
          <div className="examples">
            <span>Try</span>
            {data.examples.map((example) => (
              // Keyed by what the example is, not by where it leads: the chip stays and its label ticks in when the ledger moves on.
              <Link key={example.kind} to={example.href} className="example" title={example.title}>
                <span className="sr">{example.kind} </span>
                <LiveValue token={example.href}>{example.label}</LiveValue>
              </Link>
            ))}
          </div>
        )}
      </section>

      <StatGrid label="Network at a glance">
        <StatTile
          label="Latest validated ledger"
          value={
            <LiveValue token={String(latest.index)}>
              <LedgerLink net={network.id} index={latest.index} />
            </LiveValue>
          }
          sub={
            <LiveValue token={String(latest.closeTime)}>
              closed <RelativeTime at={latest.closeTime} fallback={`at ${formatUtc(latest.closeTime).slice(11)}`} />
            </LiveValue>
          }
        />
        <StatTile
          label="Transactions per ledger"
          value={<LiveValue token={txPerLedger}>{txPerLedger}</LiveValue>}
          sub={<LiveValue token={txAverage}>{txAverage}</LiveValue>}
        />
        <StatTile
          label="Fees burned, last ledger"
          value={
            <LiveValue token={fees ? fees.total : "—"}>{fees ? <Amount value={fees.total} currency={network.native} /> : "—"}</LiveValue>
          }
          sub={<LiveValue token={feeNote}>{feeNote}</LiveValue>}
        />
        <StatTile
          label="Total supply"
          // The tile keeps to whole units; the ledger page has every digit.
          value={
            <LiveValue token={whole}>
              <span title={`${formatAmount(latest.supply)} ${network.native}`}>
                <Amount value={whole} currency={network.native} />
              </span>
            </LiveValue>
          }
          sub="from the latest ledger header"
        />
      </StatGrid>

      <div className="cols">
        <Card
          id={LATEST_LEDGERS_ID}
          title="Latest ledgers"
          action={<Link to={latestHref}>Latest ledger →</Link>}
          flush
          className="cols__narrow"
        >
          <div {...holding("ledgers")}>
            <DataTable
              label="Latest ledgers"
              columns={ledgerColumns}
              rows={data.ledgers}
              rowKey={(row) => String(row.index)}
              // The tracks at their least, the gaps and the padding of a row (16 px each side, 16 px between).
              minWidth={380}
              empty="No ledgers yet."
              live
            />
          </div>
        </Card>

        <Card
          id={LATEST_TRANSACTIONS_ID}
          title="Latest transactions"
          action={<Link to={latestHref}>{`All in ledger #${count(latest.index)} →`}</Link>}
          flush
          className="cols__wide"
        >
          <div {...holding("transactions")}>
            <DataTable
              label="Latest transactions"
              columns={txColumns}
              rows={data.transactions}
              rowKey={(row) => row.hash}
              // Likewise.
              minWidth={744}
              empty="No transactions yet."
              live
            />
          </div>
        </Card>
      </div>
    </>
  );
}
