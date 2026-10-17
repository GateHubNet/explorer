import { Link } from "react-router";

import { formatAmount, formatUtc } from "../../domain/format";
import type { HomeLedgerRow, HomePageData, HomeTxRow } from "../../server/home-view";
import { LATEST_LEDGERS_ID, LATEST_TRANSACTIONS_ID } from "../anchors";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { HashLink, LedgerLink } from "../components/HashLink";
import { ResultPill } from "../components/Pill";
import { RelativeTime } from "../components/RelativeTime";
import { SearchBox } from "../components/SearchBox";
import { StatGrid, StatTile } from "../components/StatTile";
import { TypeTag } from "../components/TypeTag";
import type { NetworkInfo } from "../networks";

/** The headline of each network's home page (also its title). */
export const HOME_TITLES = { xrpl: "Explore the XRP Ledger", xahau: "Explore Xahau" } as const;

/** `17:01:12`, from unix seconds. */
const timeOfDay = (at: number) => formatUtc(at).slice(11, 19);
const count = (n: number) => formatAmount(String(n));

/**
 * The home page: the search hero with examples, four tiles, the newest ledgers and the newest transactions. Takes what the
 * loader made of the data API's answers (`homePage`) and never fetches. Ages are worked out in the browser
 * (`RelativeTime`); the HTML itself carries close times, so that one stored copy is right for everybody.
 */
export function HomePage({ network, data }: { network: NetworkInfo; data: HomePageData }) {
  const { latest, txCount, average, fees } = data;
  const latestHref = `/${network.id}/ledger/${latest.index}`;
  const whole = latest.supply.split(".")[0]!;

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
        <p className="hero__status">
          <span className="hero__dot" aria-hidden="true" />
          <span>
            {network.name} mainnet · ledger <LedgerLink net={network.id} index={latest.index} /> validated{" "}
            <RelativeTime at={latest.closeTime} fallback={`at ${formatUtc(latest.closeTime).slice(11)}`} />
          </span>
        </p>
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
              <Link key={example.href} to={example.href} className="example" title={example.title}>
                <span className="sr">{example.kind} </span>
                {example.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      <StatGrid label="Network at a glance">
        <StatTile
          label="Latest validated ledger"
          value={<LedgerLink net={network.id} index={latest.index} />}
          sub={
            <>
              closed <RelativeTime at={latest.closeTime} fallback={`at ${formatUtc(latest.closeTime).slice(11)}`} />
            </>
          }
        />
        <StatTile
          label="Transactions per ledger"
          value={txCount === null ? "—" : count(txCount)}
          sub={average ? `average ${count(average.transactions)} over the last ${count(average.ledgers)}` : "not counted yet"}
        />
        <StatTile
          label="Fees burned, last ledger"
          value={fees ? <Amount value={fees.total} currency={network.native} /> : "—"}
          sub={fees ? `average ${formatAmount(fees.average)} · max ${formatAmount(fees.max)} per transaction` : "not counted yet"}
        />
        <StatTile
          label="Total supply"
          // The tile keeps to whole units; the ledger page has every digit.
          value={
            <span title={`${formatAmount(latest.supply)} ${network.native}`}>
              <Amount value={whole} currency={network.native} />
            </span>
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
          <DataTable
            label="Latest ledgers"
            columns={ledgerColumns}
            rows={data.ledgers}
            rowKey={(row) => String(row.index)}
            // The tracks at their least, the gaps and the padding of a row (16 px each side, 16 px between).
            minWidth={380}
            empty="No ledgers yet."
          />
        </Card>

        <Card
          id={LATEST_TRANSACTIONS_ID}
          title="Latest transactions"
          action={<Link to={latestHref}>{`All in ledger #${count(latest.index)} →`}</Link>}
          flush
          className="cols__wide"
        >
          <DataTable
            label="Latest transactions"
            columns={txColumns}
            rows={data.transactions}
            rowKey={(row) => row.hash}
            // Likewise.
            minWidth={744}
            empty="No transactions yet."
          />
        </Card>
      </div>
    </>
  );
}
