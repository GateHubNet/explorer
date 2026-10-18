import { useMemo, useState } from "react";
import { Link } from "react-router";

import { formatAmount, formatUtc } from "../../domain/format";
import type { LedgerPageData, LedgerRow } from "../../server/ledger-view";
import { LATEST_LEDGERS_ID } from "../anchors";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { DataTable, type Column } from "../components/DataTable";
import { DetailList, type DetailRow } from "../components/DetailList";
import { HashLink } from "../components/HashLink";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { Notice } from "../components/Notice";
import { Pill, ResultPill } from "../components/Pill";
import { RelativeTime } from "../components/RelativeTime";
import { Sentence } from "../components/Sentence";
import { TypeTag } from "../components/TypeTag";
import { cx } from "../cx";
import type { NetworkInfo } from "../networks";

/** Rows shown before "Show all". */
export const FIRST_ROWS = 100;
/** Types that get a filter button of their own; the rest share "Other". */
const MAX_TYPE_FILTERS = 7;
/** Accounts listed under "Accounts created"; the rest are counted. */
const MAX_ACCOUNTS_LISTED = 5;

const count = (n: number) => formatAmount(String(n));

type Filter = { kind: "all" } | { kind: "type"; type: string } | { kind: "other" };
type FilterChip = { key: string; label: string; n: number; filter: Filter };

/** "All", the commonest types and, when there are more than fit, "Other" for the rest. */
function filtersFor(data: LedgerPageData): { chips: FilterChip[]; named: ReadonlySet<string> } {
  const named = data.types.slice(0, MAX_TYPE_FILTERS);
  const rest = data.types.slice(MAX_TYPE_FILTERS);
  const chips: FilterChip[] = [
    { key: "all", label: "All", n: data.txCount, filter: { kind: "all" } },
    ...named.map(({ type, count: n }) => ({ key: `type:${type}`, label: type, n, filter: { kind: "type", type } as Filter })),
  ];
  if (rest.length > 0) {
    chips.push({ key: "other", label: "Other", n: rest.reduce((sum, { count: n }) => sum + n, 0), filter: { kind: "other" } });
  }
  return { chips, named: new Set(named.map(({ type }) => type)) };
}

function matches(filter: Filter, row: LedgerRow, named: ReadonlySet<string>): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "type":
      return row.type === filter.type;
    case "other":
      return !named.has(row.type);
  }
}

/**
 * The ledger page: header fields, the counts by result and type, the accounts created, the ledger's transactions with a
 * client-side filter by type, and the raw header. Takes what the loader made of the ledger (`ledgerPage`) and never fetches:
 * the list holds every transaction, and "Show all" only shows more of it.
 */
export function LedgerPage({ network, data }: { network: NetworkInfo; data: LedgerPageData }) {
  const { header } = data;
  const net = network.id;
  const failed = data.txCount - data.succeeded;
  const okShare = data.txCount === 0 ? 0 : (data.succeeded / data.txCount) * 100;

  const rows: DetailRow[] = [
    {
      label: "Closed",
      value: (
        <>
          <span className="mono num">{formatUtc(header.closeTime)}</span>{" "}
          <RelativeTime at={header.closeTime} lead="· " className="faint" />
        </>
      ),
    },
    {
      label: "Ledger hash",
      value: (
        <>
          <span className="mono hash">{header.hash}</span>
          <CopyButton value={header.hash} label="ledger hash" />
        </>
      ),
    },
    { label: "Parent hash", value: <HashLink net={net} kind="ledger" hash={header.parentHash} full /> },
    { label: "Total supply", value: <Amount value={header.supply} currency={network.native} className="num" /> },
    {
      label: "Fees burned",
      value: data.fees ? (
        <>
          <Amount value={data.fees.total} currency={network.native} className="num" />{" "}
          <span className="faint">
            · min {formatAmount(data.fees.min)} · max {formatAmount(data.fees.max)}
          </span>
        </>
      ) : (
        <Amount value="0" currency={network.native} className="num" />
      ),
    },
    { label: "Close time resolution", value: <span className="num">{Number.isFinite(header.resolution) ? `${header.resolution} s` : "—"}</span> },
    { label: "Transaction tree hash", value: <span className="mono hash muted">{header.transactionHash}</span> },
    { label: "Account state hash", value: <span className="mono hash muted">{header.accountHash}</span> },
  ];

  return (
    <>
      {data.origin === "node" && (
        <Notice tone="info" title="Not in the index yet, shown from the network">
          This ledger comes straight from the network&rsquo;s own node. The explorer&rsquo;s index will have it in a moment, and
          this page will then be served from it.
        </Notice>
      )}

      <Breadcrumbs
        items={[
          { label: network.name, href: `/${net}` },
          { label: "Ledgers", href: `/${net}#${LATEST_LEDGERS_ID}` },
          { label: count(header.index), mono: true },
        ]}
      />

      <div className="page-head">
        <div className="page-head__title">
          <h1 className="page-title">
            Ledger <span className="mono num">{`#${count(header.index)}`}</span>
          </h1>
          <Pill tone="ok">Validated</Pill>
        </div>
        <div className="page-head__nav">
          <Neighbour net={net} index={header.index - 1} direction="previous" enabled={header.index > 1} />
          <Neighbour net={net} index={header.index + 1} direction="next" enabled={data.hasNext} />
        </div>
      </div>

      <div className="cols">
        <Card label="Ledger header" className="cols__wide card--tight">
          <DetailList rows={rows} />
        </Card>

        <aside aria-label="Results" className="cols__side">
          <Card as="div">
            <div className="result">
              <span className="result__label">Transactions</span>
              <span className="result__value result__value--big mono num">{count(data.txCount)}</span>
              {data.txCount > 0 && (
                <div className="bar" aria-hidden="true">
                  <span className="bar__ok" style={{ width: `${okShare}%` }} />
                  {failed > 0 && <span className="bar__bad" style={{ width: `${100 - okShare}%` }} />}
                </div>
              )}
              <p className="result__sub">
                {data.txCount === 0 ? (
                  "No transactions"
                ) : failed === 0 ? (
                  `${count(data.succeeded)} succeeded`
                ) : (
                  <>
                    {`${count(data.succeeded)} succeeded · ${count(failed)} failed (`}
                    {data.failures.map(({ code, count: n }, i) => (
                      <span key={code}>
                        {i > 0 && ", "}
                        <span className="mono result__code">{code}</span>
                        {n > 1 && ` ×${count(n)}`}
                      </span>
                    ))}
                    )
                  </>
                )}
              </p>
            </div>
          </Card>
          <Card as="div">
            <div className="result">
              <span className="result__label">Accounts created</span>
              <span className="result__value mono num">{count(data.accountsCreated.length)}</span>
              {data.accountsCreated.length > 0 && (
                <ul className="result__list">
                  {data.accountsCreated.slice(0, MAX_ACCOUNTS_LISTED).map((address) => (
                    <li key={address}>
                      <AccountLink net={net} address={address} />
                    </li>
                  ))}
                  {data.accountsCreated.length > MAX_ACCOUNTS_LISTED && (
                    <li className="muted">{`and ${count(data.accountsCreated.length - MAX_ACCOUNTS_LISTED)} more`}</li>
                  )}
                </ul>
              )}
            </div>
          </Card>
        </aside>
      </div>

      {/* Keyed by the ledger: React Router reuses this component when only the id changes (Previous, Next), and the filter
          and "Show all" of one ledger must not carry over to the next, which may have no such type, or 1,500 rows. */}
      <TransactionsCard key={header.hash} network={network} data={data} />

      <details className="card raw">
        <summary>
          Raw ledger header{" "}
          <span className="faint">
            {data.origin === "index" ? `· JSON from /v2/ledgers/${header.index}` : "· JSON from the network’s node"}
          </span>
        </summary>
        <pre className="code" tabIndex={0} role="region" aria-label="Raw ledger header">
          {data.raw}
        </pre>
      </details>
    </>
  );
}

/** The previous or the next ledger as a button; one that leads nowhere is shown disabled, so that the pair stays put. */
function Neighbour({
  net,
  index,
  direction,
  enabled,
}: {
  net: string;
  index: number;
  direction: "previous" | "next";
  enabled: boolean;
}) {
  // The name starts with the number the link shows (WCAG 2.5.3, label in name: a visitor who says what they see must reach it).
  const label = `${count(index)}, ${direction} ledger`;
  const number = <span className="mono num">{count(index)}</span>;
  const content =
    direction === "previous" ? (
      <>
        <ChevronLeftIcon />
        {number}
      </>
    ) : (
      <>
        {number}
        <ChevronRightIcon />
      </>
    );
  if (!enabled) {
    return (
      // A link that is not available (it has no href): the role is what lets it have a name (a span has none to give). Why it is not
      // differs: the ledger after the newest is not validated yet; ledger 1 has no ledger before it.
      <span
        className="btn is-disabled"
        role="link"
        aria-disabled="true"
        aria-label={`${label} (${direction === "next" ? "not validated yet" : "this is the first ledger"})`}
      >
        {content}
      </span>
    );
  }
  return (
    <Link to={`/${net}/ledger/${index}`} className="btn" aria-label={label}>
      {content}
    </Link>
  );
}

function TransactionsCard({ network, data }: { network: NetworkInfo; data: LedgerPageData }) {
  const net = network.id;
  const [selected, setSelected] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);

  const { chips, named } = useMemo(() => filtersFor(data), [data]);
  const matching = useMemo(() => {
    const filter = chips.find((chip) => chip.key === selected)?.filter ?? { kind: "all" };
    return filter.kind === "all" ? data.rows : data.rows.filter((row) => matches(filter, row, named));
  }, [data.rows, chips, named, selected]);
  const shown = showAll ? matching : matching.slice(0, FIRST_ROWS);

  const columns: Column<LedgerRow>[] = [
    { id: "index", header: "#", width: "48px", align: "end", cell: (row) => <span className="mono num faint">{row.index}</span> },
    { id: "type", header: "Type", width: "minmax(124px, 160px)", cell: (row) => <TypeTag type={row.type} /> },
    { id: "hash", header: "Hash", width: "110px", cell: (row) => <HashLink net={net} kind="tx" hash={row.hash} /> },
    { id: "account", header: "Account", width: "minmax(130px, 1fr)", ellipsis: true, cell: (row) => <AccountLink net={net} address={row.account} /> },
    {
      id: "what",
      header: "What happened",
      width: "minmax(220px, 2fr)",
      ellipsis: true,
      cell: (row) => (
        <span className="muted">
          <Sentence net={net} segments={row.what} compact />
        </span>
      ),
    },
    { id: "result", header: "Result", width: "150px", cell: (row) => <ResultPill ok={row.ok} code={row.code} /> },
    {
      id: "fee",
      header: `Fee (${network.native})`,
      width: "84px",
      align: "end",
      cell: (row) => <span className="mono num muted">{formatAmount(row.fee)}</span>,
    },
  ];

  return (
    <Card
      title="Transactions in this ledger"
      flush
      action={
        data.txCount > 0 && (
          <div role="group" aria-label="Filter by type" className="filters">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={cx("fchip", chip.key === selected && "on")}
                aria-pressed={chip.key === selected}
                onClick={() => setSelected(chip.key)}
              >
                {chip.label} <b>{count(chip.n)}</b>
              </button>
            ))}
          </div>
        )
      }
    >
      <DataTable
        label="Transactions"
        columns={columns}
        rows={shown}
        rowKey={(row) => row.hash}
        // The tracks at their least, the gaps and the padding of a row.
        minWidth={994}
        empty="No transactions in this ledger."
      />
      {matching.length > 0 && (
        <div className="card__foot">
          <span>{`Showing ${count(shown.length)} of ${count(matching.length)}, in ledger order`}</span>
          {matching.length > FIRST_ROWS && (
            <button type="button" className="btn" onClick={() => setShowAll((all) => !all)}>
              {showAll ? `Show first ${count(FIRST_ROWS)}` : `Show all ${count(matching.length)}`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
