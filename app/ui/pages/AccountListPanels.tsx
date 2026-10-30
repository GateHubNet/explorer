import type { ReactNode } from "react";
import { Link } from "react-router";

import { OBJECTS_LIMIT } from "../../domain/account-tabs";
import { formatAmount, formatCurrency, shortHash } from "../../domain/format";
import { collectionLink } from "../../domain/nft-link";
import { nftWords, shortNftId } from "../../domain/nft-params";
import type { AccountListPageData, AccountNftRow, ChangeView, ObjectRow, OfferRow, PaymentRow, RowAmount, TabList, TradeRow, TxRow } from "../../server/account-view";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable, type Column } from "../components/DataTable";
import { NftGlyph } from "../components/NftGlyph";
import { NftLink } from "../components/NftLink";
import { Pager } from "../components/Pager";
import { Sentence } from "../components/Sentence";
import { TypeTag } from "../components/TypeTag";
import { When } from "../components/WhenCell";
import { ResultPill } from "../components/Pill";
import type { NetworkInfo } from "../networks";
import { NamesProvider } from "../names";
import { useFeatures } from "../use-network";
import { count, ListFailed, plural } from "./AccountPage";

// The list panels of the account page: the list of a tab, drawn by its own names, in its panel (the note, the footer with the count and the pager), and the
// tables and the objects list it is made of. A chunk of its own, which `AccountPage.tsx` loads with `lazy()` (README, "The account page"): the analytics view
// never draws a list, so its first load holds none of this, and a first page draws the list inside its streamed `Suspense` and `Await` already. What the
// panels share with the rest of the page (`count`, `plural`, `ListFailed`) stays in `AccountPage.tsx`, which the account route loads anyway.

/** A list that was loaded, drawn by the names of the accounts in it (the list's own call, display names spec 5); one that failed has no names to draw by. */
export default function TabPanel({ network, data, list }: { network: NetworkInfo; data: AccountListPageData; list: TabList }) {
  if (list.state === "failed") return <ListFailed what={list.what} />;
  return (
    <NamesProvider names={list.names.map}>
      <ListPanel network={network} list={list} />
    </NamesProvider>
  );
}

function ListPanel({ network, list }: { network: NetworkInfo; list: Exclude<TabList, { state: "failed" }> }) {
  const net = network.id;

  switch (list.tab) {
    case "transactions":
      return (
        <Panel note="Newest first" foot={plural(list.rows.length, "transaction", "transactions")} paging={list.paging}>
          <TransactionsTable net={net} native={network.native} rows={list.rows} />
        </Panel>
      );
    case "payments":
      return (
        <Panel
          note="Successful payments between this account and others"
          action={
            <a className="btn" href={list.csvHref} rel="nofollow" download>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              Download CSV
            </a>
          }
          foot={plural(list.rows.length, "payment", "payments")}
          paging={list.paging}
        >
          <PaymentsTable net={net} rows={list.rows} />
        </Panel>
      );
    case "trades":
      return (
        <Panel note="Trades this account took part in" foot={plural(list.rows.length, "trade", "trades")} paging={list.paging}>
          <TradesTable net={net} rows={list.rows} />
        </Panel>
      );
    case "offers":
      return (
        <Panel
          note={list.ledgerIndex === null ? "Open offers, read live" : `Open offers, read live at ledger #${count(list.ledgerIndex)}`}
          foot={
            list.rows.length === 0
              ? "No open offers"
              : list.truncated
                ? `Showing the first ${plural(list.rows.length, "open offer", "open offers")}`
                : `All ${plural(list.rows.length, "open offer", "open offers")}`
          }
        >
          <OffersTable rows={list.rows} />
        </Panel>
      );
    case "objects":
      return (
        <Panel
          note={`Objects this account owns, read live${list.ledgerIndex === null ? "" : ` at ledger #${count(list.ledgerIndex)}`}. Trust lines (${count(list.trustLines)}) and offers (${count(list.offers)}) have their own places.`}
          foot={list.truncated ? `Showing the first ${count(OBJECTS_LIMIT)} objects` : plural(list.rows.length, "object", "objects")}
        >
          <ObjectsList net={net} rows={list.rows} />
        </Panel>
      );
    case "nfts": {
      const words = nftWords(net);
      return (
        // What this page of the list shows: the index gives no count of an account's NFTs (spec 11), so the footer says "Showing 20 NFTs", as Objects says "Showing the first 400 objects".
        <Panel note={`${words.tokens} this account holds now`} foot={`Showing ${plural(list.rows.length, words.token, words.tokens)}`} paging={list.paging}>
          <NftsTable net={net} rows={list.rows} />
          <CoverageNote net={net} note={list.coverage} />
        </Panel>
      );
    }
  }
}

/** A tab's panel: a note (and an action) above its content, a footer with the count and the pager below. */
function Panel({
  note,
  action,
  foot,
  paging,
  children,
}: {
  note: string;
  action?: ReactNode;
  foot: string;
  paging?: { newerHref: string | null; olderHref: string | null };
  children: ReactNode;
}) {
  return (
    <div className="activity__panel">
      <div className="activity__head">
        <span className="faint">{note}</span>
        {action}
      </div>
      {children}
      <div className="card__foot">
        <span>{foot}</span>
        {paging && <Pager newerHref={paging.newerHref} olderHref={paging.olderHref} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The tables

function Change({ change }: { change: ChangeView }) {
  return (
    <span className="change">
      <Amount value={change.value} currency={change.currency} signed />
      {change.more > 0 && <span className="faint">{`+${change.more} more`}</span>}
    </span>
  );
}

function RowAmountView({ amount, signed }: { amount: RowAmount; signed?: boolean }) {
  return <Amount value={amount.value} currency={amount.currency} issuer={amount.issuer} signed={signed} />;
}

function TransactionsTable({ net, native, rows }: { net: NetworkInfo["id"]; native: string; rows: TxRow[] }) {
  const columns: Column<TxRow>[] = [
    { id: "when", header: "Date (UTC)", width: "120px", cell: (row) => <When net={net} hash={row.hash} time={row.time} /> },
    { id: "type", header: "Type", width: "118px", cell: (row) => <TypeTag type={row.type} /> },
    {
      id: "what",
      header: "What happened",
      width: "minmax(240px, 2fr)",
      ellipsis: true,
      cell: (row) => (
        <span className="muted">
          <Sentence net={net} segments={row.what} compact />
        </span>
      ),
    },
    {
      id: "change",
      header: `Change (${native})`,
      width: "minmax(150px, 1fr)",
      align: "end",
      cell: (row) => (row.change ? <Change change={row.change} /> : <span className="faint">—</span>),
    },
    { id: "result", header: "Result", width: "128px", cell: (row) => <ResultPill ok={row.ok} code={row.code} /> },
  ];
  // The tracks at their least, the gaps and the padding of a row.
  return <DataTable label="Transactions" columns={columns} rows={rows} rowKey={(row) => row.hash} minWidth={852} empty="No transactions yet." />;
}

function PaymentsTable({ net, rows }: { net: NetworkInfo["id"]; rows: PaymentRow[] }) {
  const columns: Column<PaymentRow>[] = [
    { id: "when", header: "Date (UTC)", width: "120px", cell: (row) => <When net={net} hash={row.hash} time={row.time} /> },
    { id: "direction", header: "Direction", width: "100px", cell: (row) => <span className="type">{row.direction === "sent" ? "Sent" : "Received"}</span> },
    { id: "counterparty", header: "Counterparty", width: "minmax(150px, 1.4fr)", ellipsis: true, cell: (row) => <AccountLink net={net} address={row.counterparty} /> },
    { id: "amount", header: "Delivered", width: "minmax(130px, 1fr)", align: "end", cell: (row) => <RowAmountView amount={row.amount} signed /> },
    { id: "tag", header: "Tag", width: "90px", align: "end", cell: (row) => <span className="mono num muted">{row.tag === null ? "" : row.tag}</span> },
  ];
  return <DataTable label="Payments" columns={columns} rows={rows} rowKey={(row) => `${row.hash}:${row.counterparty}`} minWidth={690} empty="No payments yet." />;
}

function TradesTable({ net, rows }: { net: NetworkInfo["id"]; rows: TradeRow[] }) {
  const columns: Column<TradeRow>[] = [
    { id: "when", header: "Date (UTC)", width: "120px", cell: (row) => <When net={net} hash={row.hash} time={row.time} /> },
    {
      id: "pair",
      header: "Pair",
      width: "130px",
      ellipsis: true,
      cell: (row) => <span className="mono">{`${formatCurrency(row.pair.base.currency)}/${formatCurrency(row.pair.counter.currency)}`}</span>,
    },
    { id: "side", header: "Side", width: "70px", cell: (row) => (row.side === "buy" ? "Buy" : "Sell") },
    { id: "amount", header: "Amount", width: "minmax(140px, 1fr)", align: "end", cell: (row) => <RowAmountView amount={row.amount} /> },
    { id: "price", header: "Price", width: "minmax(120px, 1fr)", align: "end", cell: (row) => <RowAmountView amount={row.price} /> },
    { id: "against", header: "Against", width: "minmax(150px, 1.2fr)", ellipsis: true, cell: (row) => <AccountLink net={net} address={row.counterparty} /> },
  ];
  return <DataTable label="Trades" columns={columns} rows={rows} rowKey={(row) => `${row.hash}:${row.amount.value}:${row.price.value}:${row.counterparty}`} minWidth={842} empty="No trades yet." />;
}

function OffersTable({ rows }: { rows: OfferRow[] }) {
  const columns: Column<OfferRow>[] = [
    { id: "side", header: "Side", width: "70px", cell: (row) => (row.side === "buy" ? "Buy" : "Sell") },
    { id: "quantity", header: "Quantity", width: "minmax(140px, 1fr)", align: "end", cell: (row) => <RowAmountView amount={row.quantity} /> },
    { id: "total", header: "Total price", width: "minmax(140px, 1fr)", align: "end", cell: (row) => <RowAmountView amount={row.total} /> },
    {
      id: "rate",
      header: "Rate",
      width: "minmax(130px, 1fr)",
      align: "end",
      cell: (row) =>
        row.rate ? (
          <span className="amt plain num">{`${formatAmount(row.rate.value)} ${formatCurrency(row.rate.quote)} / ${formatCurrency(row.rate.per)}`}</span>
        ) : (
          <span className="faint">—</span>
        ),
    },
    { id: "sequence", header: "Sequence", width: "120px", align: "end", cell: (row) => <span className="mono num muted">{count(row.sequence)}</span> },
  ];
  return <DataTable label="Open offers" columns={columns} rows={rows} rowKey={(row) => String(row.sequence)} minWidth={696} empty="This account has no open offers." />;
}

/** What a cell that has nothing to tell is: the last sale of an NFT that has not been sold. */
const DASH = "—";

/** The collection of an NFT as a link to its page while `NFTS` is on (`collectionLink`), its label as text otherwise. */
function CollectionCell({ net, collection }: { net: NetworkInfo["id"]; collection: AccountNftRow["collection"] }) {
  const href = collectionLink(net, collection.key, useFeatures());
  return href === null ? (
    <span className="mono nfts__collection">{collection.label}</span>
  ) : (
    <Link to={href} className="mono nfts__collection">
      {collection.label}
    </Link>
  );
}

// The columns of the NFTs tab: the NFT with its glyph and, under its serial, the short id (the short id alone on Xahau, whose URITokens have no serial), its collection, the price it
// was last sold at (an account's list has no converted amount, so no "≈") and the day of its mint. `NFTS_WIDTH` is the tracks at their least, the gaps (3 × 16 px) and the padding of a
// row (2 × 16 px), below which the table scrolls sideways inside its card.
const NFTS_WIDTH = 170 + 170 + 150 + 120 + 3 * 16 + 2 * 16;

/**
 * The NFTs the account holds, in the order the API gave them. Not drawn while `NFTS` is off (the tab is a "soon" label and its URL a redirect), so the NFT and its collection are links
 * (`NftLink`, `CollectionCell`: both are plain text where the switch is off).
 */
function NftsTable({ net, rows }: { net: NetworkInfo["id"]; rows: AccountNftRow[] }) {
  const words = nftWords(net);
  const columns: Column<AccountNftRow>[] = [
    {
      id: "nft",
      header: words.token,
      width: "170px",
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
    { id: "collection", header: "Collection", width: "minmax(170px, 1.4fr)", cell: (row) => <CollectionCell net={net} collection={row.collection} /> },
    {
      id: "last",
      header: "Last sale",
      width: "150px",
      align: "end",
      cell: (row) =>
        row.lastSale === null ? <span className="faint">{DASH}</span> : <Amount value={row.lastSale.value} currency={row.lastSale.currency} issuer={row.lastSale.issuer} className="mono num" />,
    },
    { id: "minted", header: "Minted", width: "120px", cell: (row) => <span className="num muted">{row.minted}</span> },
  ];
  return (
    <DataTable label={words.tokens} columns={columns} rows={rows} rowKey={(row) => row.key} minWidth={NFTS_WIDTH} empty={`This account holds no ${words.tokens} in the index.`} className="nfts__table" />
  );
}

function ObjectsList({ net, rows }: { net: NetworkInfo["id"]; rows: ObjectRow[] }) {
  if (rows.length === 0) return <div className="table__empty">This account owns no other objects.</div>;
  return (
    <ul className="objectlist">
      {rows.map((row) => (
        <li key={row.key} className="object">
          <TypeTag type={row.type} />
          {row.fields.map((field) => (
            <div key={field.label} className="object__field">
              <span className="object__label">{field.label}</span>
              <span className="object__value">
                <Sentence net={net} segments={field.value} />
              </span>
            </div>
          ))}
          {row.link && <Link to={row.link.href}>{row.link.label}</Link>}
          {row.tx && (
            <Link to={`/${net}/tx/${row.tx}`} className="object__tx">
              Last changed in {shortHash(row.tx)} →
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
