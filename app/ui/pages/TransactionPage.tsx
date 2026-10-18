import { Link } from "react-router";

import type { Segment } from "../../domain/describe";
import { formatAmount, formatCurrency, formatUtc, shortHash } from "../../domain/format";
import type { ChangeRole, ChangeRow, Neighbour, TransactionPageData } from "../../server/transaction-view";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { CopyTextButton } from "../components/CopyTextButton";
import { DataTable, type Column } from "../components/DataTable";
import { DetailList, type DetailRow } from "../components/DetailList";
import { Flow } from "../components/Flow";
import { LedgerLink } from "../components/HashLink";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { Notice } from "../components/Notice";
import { ResultPill } from "../components/Pill";
import { RawTabs, type RawTab } from "../components/RawTabs";
import { RelativeTime } from "../components/RelativeTime";
import { Sentence } from "../components/Sentence";
import { TypeTag } from "../components/TypeTag";
import { cx } from "../cx";
import type { NetworkInfo } from "../networks";

/** Ledger objects listed before the rest are held back behind "Show N more". */
export const OBJECTS_SHOWN = 10;

const count = (n: number) => formatAmount(String(n));

const ROLE_LABEL: Record<ChangeRole, string> = { sender: "sender", destination: "destination", pool: "AMM pool" };
const CHANGE_LABEL = { created: "Created", modified: "Modified", deleted: "Deleted" } as const;

// What a Binary tab without hex says must be true: a page without the hex is stored for 30 s (`short`) and asking again may find it;
// for a type the index cannot serialize it never will; and a transaction from the node is indexed within a minute.
const BINARY_FAILED = "The binary form could not be loaded just now. Try again in a minute.";
const BINARY_UNSUPPORTED = "The index has no binary form for this type of transaction.";
const BINARY_PENDING = "The binary form appears once the transaction is indexed.";

/** The three tabs of the raw data. The binary form is the hex of the transaction, which its hash is taken over, and of its metadata. */
function rawTabs(raw: TransactionPageData["raw"]): RawTab[] {
  const { binary } = raw;
  return [
    { id: "tx", label: "Transaction", text: raw.tx },
    { id: "meta", label: "Metadata", text: raw.meta },
    binary.state === "ready"
      ? { id: "binary", label: "Binary", text: `Transaction\n${binary.tx}\n\nMetadata\n${binary.meta}`, wrap: true }
      : {
          id: "binary",
          label: "Binary",
          note: binary.state === "failed" ? BINARY_FAILED : binary.state === "unsupported" ? BINARY_UNSUPPORTED : BINARY_PENDING,
        },
  ];
}

/** A change of a balance: the sign shown, a gain in the success colour. The currency has a column of its own. */
function Delta({ value }: { value: string }) {
  const formatted = formatAmount(value);
  const gain = !formatted.startsWith("−") && /[1-9]/.test(formatted);
  return <span className={cx("amt", gain && "amt--pos")}>{gain ? `+${formatted}` : formatted}</span>;
}

/** The value of one of the type's own details: a lone account in full (it has a line to itself), anything else as a sentence. */
function detailValue(net: NetworkInfo["id"], value: readonly Segment[]) {
  const [only] = value;
  if (value.length === 1 && only?.t === "account") return <AccountLink net={net} address={only.v} full />;
  return <Sentence net={net} segments={value} />;
}

/**
 * The transaction page: what it is and whether it worked, the sentence and the flow of the money, the details, the balance
 * changes, and in the margin what the result means, the neighbours in the ledger and the ledger objects it touched; the raw
 * data last. Takes what the loader made of the transaction (`transactionPage`) and never fetches or parses anything.
 */
export function TransactionPage({ network, data }: { network: NetworkInfo; data: TransactionPageData }) {
  const net = network.id;
  const { position } = data;

  const rows: DetailRow[] = [
    {
      label: "Hash",
      value: (
        <>
          <span className="mono hash">{data.hash}</span>
          <CopyButton value={data.hash} label="hash" />
        </>
      ),
    },
    ...(data.ctid === null
      ? []
      : [
          {
            label: "CTID",
            value: (
              <>
                <span className="mono hash">{data.ctid}</span>
                <CopyButton value={data.ctid} label="CTID" />
              </>
            ),
          },
        ]),
    {
      label: "Ledger",
      value: (
        <>
          <LedgerLink net={net} index={data.ledgerIndex} />{" "}
          <span className="faint">{`· transaction ${count(position.index)}${position.count === null ? "" : ` of ${count(position.count)}`}`}</span>
        </>
      ),
    },
    {
      label: "Date",
      value: (
        <>
          <span className="mono num">{formatUtc(data.closeTime)}</span> <RelativeTime at={data.closeTime} lead="· " className="faint" />
        </>
      ),
    },
    { label: "Account", value: <AccountLink net={net} address={data.account} full /> },
    ...data.details.map((detail) => ({ label: detail.label, value: detailValue(net, detail.value) })),
    {
      label: "Fee",
      value: (
        <>
          <Amount value={data.fee} currency={network.native} /> <span className="faint">· burned</span>
        </>
      ),
    },
    ...(data.sequence === null ? [] : [{ label: "Sequence", value: <span className="mono num">{formatAmount(String(data.sequence))}</span> }]),
    ...data.memos.map((memo) => ({
      label: "Memo",
      value: (
        <>
          {memo.text === "" ? <span className="faint">no data</span> : <span className="memo">{memo.text}</span>}
          {memo.hex && <span className="faint"> · hex</span>}
          {memo.note !== "" && <span className="faint"> · {memo.note}</span>}
        </>
      ),
    })),
  ];

  const columns: Column<ChangeRow>[] = [
    {
      id: "account",
      header: "Account",
      width: "minmax(200px, 1.6fr)",
      cell: (change) => (
        <span className="acct">
          <AccountLink net={net} address={change.account} />
          {change.role && <span className="type">{ROLE_LABEL[change.role]}</span>}
        </span>
      ),
    },
    {
      id: "currency",
      header: "Currency",
      width: "minmax(130px, 0.8fr)",
      cell: (change) => {
        const shown = formatCurrency(change.currency);
        const code = shown !== change.currency ? change.currency : undefined;
        return (
          <span className="cur">
            <span className="mono" title={code}>
              {shown}
            </span>
            {/* The other side of the trust line, in the open: two currencies of one code are told apart by it. It is the issuer in a holder's
                row and the holder in the issuer's own, so it is not called either. */}
            {change.issuer && (
              <span className="cur__line">
                with <AccountLink net={net} address={change.issuer} />
              </span>
            )}
          </span>
        );
      },
    },
    { id: "change", header: "Change", width: "minmax(150px, 1fr)", align: "end", cell: (change) => <Delta value={change.value} /> },
    {
      id: "after",
      header: "Balance after",
      width: "minmax(190px, 1.2fr)",
      align: "end",
      cell: (change) => <span className="amt muted">{change.after === undefined ? "—" : formatAmount(change.after)}</span>,
    },
  ];

  const shownObjects = data.objects.slice(0, OBJECTS_SHOWN);
  const moreObjects = data.objects.slice(OBJECTS_SHOWN);
  const objectItem = (object: TransactionPageData["objects"][number], index: number) => (
    <li key={`${index}:${object.index}`}>
      <span className="type" title={object.index}>
        {CHANGE_LABEL[object.change]}
      </span>
      <span className="mono">{object.type}</span>
      {object.account && <AccountLink net={net} address={object.account} />}
    </li>
  );

  return (
    <>
      {data.origin === "node" && (
        <Notice tone="info" title="Not in the index yet, shown from the network">
          This transaction comes straight from the network&rsquo;s own node. The explorer&rsquo;s index will have it in a moment,
          and this page will then be served from it.
        </Notice>
      )}

      <Breadcrumbs
        items={[
          { label: network.name, href: `/${net}` },
          { label: `Ledger ${count(data.ledgerIndex)}`, href: `/${net}/ledger/${data.ledgerIndex}` },
          { label: shortHash(data.hash), mono: true },
        ]}
      />

      <div className="page-head">
        <div className="page-head__title">
          <h1 className="page-title">{data.title}</h1>
          {data.type !== data.title && <TypeTag type={data.type} />}
          <ResultPill ok={data.ok} code={data.result.code} showCode />
          <span className="page-head__time">
            {formatUtc(data.closeTime)} <RelativeTime at={data.closeTime} lead="· " />
          </span>
        </div>
        <div className="page-head__nav">
          <CopyTextButton getText={() => window.location.href}>Copy link</CopyTextButton>
          <a className="btn" href="#raw">
            Raw JSON
          </a>
        </div>
      </div>

      <Card label="Summary" className="summary">
        <p className="sentence summary__sentence">
          <Sentence net={net} segments={data.sentence} />
        </p>
        {data.flow && <Flow net={net} steps={data.flow} />}
      </Card>

      <div className="txgrid">
        <Card title="Details" className="card--tight txgrid__details">
          <DetailList rows={rows} />
        </Card>

        <Card
          title="Balance changes"
          className="txgrid__balance"
          flush
          action={<span className="faint">{`from the transaction metadata · the sender’s ${network.native} change includes the fee`}</span>}
        >
          <DataTable
            label="Balance changes"
            columns={columns}
            rows={data.changes}
            rowKey={(change, index) => `${index}:${change.account}:${change.currency}:${change.issuer ?? ""}`}
            // The tracks at their least (200 + 130 + 150 + 190), the three gaps and the padding of a row.
            minWidth={750}
            empty="No balances changed."
          />
        </Card>

        <aside aria-label="Context" className="txgrid__aside">
          <Card as="div">
            <div className="result">
              <span className="result__label">Result</span>
              <span className="mono result__code-big">{data.result.code}</span>
              <span className="result__sub">{data.result.text}</span>
            </div>
          </Card>

          <Card as="div">
            <div className="result">
              <span className="result__label">
                In ledger <LedgerLink net={net} index={data.ledgerIndex} />
              </span>
              {data.neighbours ? (
                <nav aria-label="Transactions in this ledger" className="neighbours">
                  <NeighbourLink net={net} direction="previous" neighbour={data.neighbours.previous} />
                  <NeighbourLink net={net} direction="next" neighbour={data.neighbours.next} />
                </nav>
              ) : (
                <p className="result__sub">Previous and next transactions appear once the transaction is indexed.</p>
              )}
            </div>
          </Card>

          <Card as="div">
            <div className="result">
              <span className="result__label">Ledger objects touched</span>
              {data.objects.length === 0 ? (
                <p className="result__sub">No ledger objects.</p>
              ) : (
                <>
                  <ul className="objects" aria-label="Ledger objects touched">
                    {shownObjects.map(objectItem)}
                  </ul>
                  {moreObjects.length > 0 && (
                    <details className="objects__more">
                      <summary>{`Show ${count(moreObjects.length)} more`}</summary>
                      <ul className="objects">{moreObjects.map((object, index) => objectItem(object, index + OBJECTS_SHOWN))}</ul>
                    </details>
                  )}
                </>
              )}
            </div>
          </Card>
        </aside>

        <Card id="raw" label="Raw transaction data" flush className="txgrid__raw">
          <RawTabs label="Raw data" heading="Raw data" tabs={rawTabs(data.raw)} />
        </Card>
      </div>
    </>
  );
}

/** The transaction before or after this one in its ledger, by its place; at the end of the ledger a disabled one, so the pair stays put. */
function NeighbourLink({ net, direction, neighbour }: { net: string; direction: "previous" | "next"; neighbour: Neighbour | null }) {
  const previous = direction === "previous";
  const name = previous ? "Previous" : "Next";
  const icon = previous ? <ChevronLeftIcon /> : <ChevronRightIcon />;
  if (neighbour === null) {
    return (
      <span className="neighbours__link is-disabled" aria-disabled="true">
        {previous && icon}
        {`${name} · ${previous ? "first" : "last"} in ledger`}
        {!previous && icon}
      </span>
    );
  }
  return (
    <Link to={`/${net}/tx/${neighbour.hash}`} className="neighbours__link">
      {previous && icon}
      {`${name} · #${count(neighbour.position)}`}
      {!previous && icon}
    </Link>
  );
}
