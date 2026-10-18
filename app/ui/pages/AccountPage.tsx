import { Suspense, type ReactNode } from "react";
import { Await, Link, useRevalidator } from "react-router";

import { accountHref, ACCOUNT_TABS, OBJECTS_LIMIT, type AccountTab } from "../../domain/account-tabs";
import { formatAmount, formatCurrency, formatUtc, shortAddress, shortHash } from "../../domain/format";
import type {
  AccountHeader,
  AccountPageData,
  ChangeView,
  NeverActivatedData,
  ObjectRow,
  OfferRow,
  PaymentRow,
  RowAmount,
  TabList,
  Token,
  TradeRow,
  TxRow,
} from "../../server/account-view";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { DataTable, type Column } from "../components/DataTable";
import { Identicon } from "../components/Identicon";
import { AlertIcon, CheckIcon } from "../components/icons";
import { Notice } from "../components/Notice";
import { Pager } from "../components/Pager";
import { QrButton } from "../components/QrButton";
import { RelativeTime } from "../components/RelativeTime";
import { SectionError } from "../components/SectionError";
import { Sentence } from "../components/Sentence";
import { Tabs, type TabItem } from "../components/Tabs";
import { TypeTag } from "../components/TypeTag";
import { ResultPill } from "../components/Pill";
import type { NetworkInfo } from "../networks";
import { NotFoundPage } from "./NotFoundPage";

/** Tokens listed before "Show N more". */
const TOKENS_SHOWN = 10;

const TAB_LABELS: Record<AccountTab, string> = {
  transactions: "Transactions",
  payments: "Payments",
  trades: "Trades",
  offers: "Offers",
  objects: "Objects",
};

const count = (n: number) => formatAmount(String(n));
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** `2026-10-17 16:11:02 UTC` as the date and the time of day, which the lists print on two lines. */
function whenOf(time: number): { date: string; clock: string; full: string } {
  const full = formatUtc(time);
  return { date: full.slice(0, 10), clock: full.slice(11, 19), full };
}

/** Retry of a section that could not be loaded: the route's own data is fetched again, in the browser, from the explorer's own Worker. */
function useRetry() {
  const revalidator = useRevalidator();
  return { retry: () => void revalidator.revalidate(), retrying: revalidator.state !== "idle" };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The account page: the address with its picture, copy button and QR code, when and by whom it was activated, its flags, the balance
 * with the reserve, the tokens and owned objects, and the tabs (transactions, payments with a CSV link, trades, offers, objects;
 * Analytics is a tab for later). Takes what the loader made of the account (`AccountPageData`) and never fetches.
 *
 * - On the first page the header is read live. The tab's list is a promise: it streams in after the header, and when it could not be
 *   loaded the page says "Couldn't load transactions" with a Retry that fetches it again.
 * - On a page reached with a marker (old history, stored for good) there is no live state: it would be a year old. A link leads to
 *   the first page, which has it.
 */
export function AccountPage({ network, data }: { network: NetworkInfo; data: AccountPageData }) {
  const net = network.id;
  const { header } = data;

  return (
    <>
      {data.tag !== null && <TagNote tag={data.tag} />}
      {header.status === "deleted" && (
        <Notice tone="warning" title="Deleted">
          This account was deleted from the ledger, so it has no balance or live state any more. Its history is below.
        </Notice>
      )}
      {(header.status === "active" || header.status === "deleted") && header.nodeProblem && <LiveStateNotice />}

      <Breadcrumbs
        items={[
          { label: network.name, href: `/${net}` },
          { label: "Accounts" },
          { label: shortAddress(data.address), mono: true },
        ]}
      />

      <AccountCard network={network} data={data} />

      {header.status === "history" ? (
        <Activity network={network} data={data} />
      ) : (
        <div className="cols">
          <aside aria-label="Holdings" className="cols__side">
            {header.status === "active" && <TokensCard network={network} header={header} />}
            {header.owned && <OwnedCard header={header} />}
          </aside>
          <Activity network={network} data={data} />
        </div>
      )}
    </>
  );
}

/** The page for an address that was never activated: no transaction ever funded it. */
export function NeverActivatedPage({ network, data }: { network: NetworkInfo; data: NeverActivatedData }) {
  return (
    <NotFoundPage
      net={network}
      title="Not activated"
      message={
        <>
          This address has never been activated on {network.name}. An account exists only once a payment has funded it.
        </>
      }
      suggestion={{ href: `/${data.other.id}/account/${data.address}`, label: `Look for ${shortAddress(data.address)} on ${data.other.name}` }}
    >
      <p className="mono faint account-address-note">{data.address}</p>
    </NotFoundPage>
  );
}

function TagNote({ tag }: { tag: number }) {
  return (
    <Notice tone="info" title={`Destination tag ${tag}`}>
      The address you opened includes a destination tag. When you send to this account, enter <span className="mono num">{tag}</span> as the
      destination tag, or the payment may not reach the right person.
    </Notice>
  );
}

function LiveStateNotice() {
  const { retry, retrying } = useRetry();
  return (
    <div className="notice notice--warning" role="status">
      <span className="notice__icon">
        <AlertIcon />
      </span>
      <div className="notice__body">
        <strong className="notice__title">Live state unavailable</strong>
        The network node did not answer, so what it tells (the sequence, flags, reserve and owned objects) is missing. The history below is from the
        explorer&rsquo;s index and is not affected.
      </div>
      <button type="button" className="btn" onClick={retry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The header

function Flag({ children }: { children: ReactNode }) {
  return (
    <span className="flag">
      <CheckIcon size={12} />
      {children}
    </span>
  );
}

function AccountCard({ network, data }: { network: NetworkInfo; data: AccountPageData }) {
  const net = network.id;
  const { header, address } = data;
  const activation = header.status === "history" ? null : header.activation;
  const live = header.status === "history" ? null : header.live;
  const domain = live?.state === "ok" ? live.domain : null;

  return (
    <section className="card account-card" aria-label="Account">
      <div className="account-id">
        <div className="account-id__top">
          <Identicon address={address} />
          <div className="account-id__name">
            <span className="account-id__label">Account</span>
            <div className="account-id__address">
              <h1 className="mono">{address}</h1>
              <CopyButton value={address} label="address" />
              <QrButton address={address} qr={data.qr} />
            </div>
          </div>
        </div>

        {header.status !== "history" && (
          <p className="account-id__meta">
            {activation ? (
              <>
                Activated on{" "}
                <Link to={`/${net}/tx/${activation.txHash}`} className="num">
                  {formatUtc(activation.time)}
                </Link>{" "}
                by <AccountLink net={net} address={activation.parent} /> with{" "}
                <Amount value={activation.initialBalance} currency={network.native} className="plain" />
              </>
            ) : (
              <span className="faint">Activation is not in the index.</span>
            )}
            {domain && (
              <>
                {" "}
                · domain <span className="mono">{domain}</span>
              </>
            )}
          </p>
        )}

        {live?.state === "ok" && (
          <div className="account-flags">
            {live.flags.map((flag) => (
              <Flag key={flag.id}>{flag.label}</Flag>
            ))}
            {live.regularKey && <Flag>Regular key set</Flag>}
            <span className="flag">
              Sequence <span className="mono num">{formatAmount(String(live.sequence))}</span>
            </span>
            {live.lastActive && (
              <span className="flag">
                Last active{" "}
                <Link to={`/${net}/tx/${live.lastActive.hash}`}>
                  {live.lastActive.time === null ? (
                    <span className="num">{`ledger #${count(live.lastActive.ledgerIndex)}`}</span>
                  ) : (
                    <RelativeTime at={live.lastActive.time} fallback={formatUtc(live.lastActive.time)} />
                  )}
                </Link>
              </span>
            )}
          </div>
        )}
      </div>

      <BalancePanel network={network} data={data} />
    </section>
  );
}

function BalancePanel({ network, data }: { network: NetworkInfo; data: AccountPageData }) {
  const { header } = data;

  if (header.status === "history") {
    return (
      <div className="account-balance account-balance--soft">
        <span className="account-balance__label">{network.native} balance</span>
        <span className="muted">This page of history is kept as it is, so it does not show the balance or the live state.</span>
        <Link to={accountHref(network.id, data.address, {})} className="account-balance__link">
          See them on the account&rsquo;s first page
        </Link>
      </div>
    );
  }

  const { balance } = header;
  if (header.status === "deleted") {
    return (
      <div className="account-balance">
        <span className="account-balance__label">{network.native} balance</span>
        <span className="account-balance__value amt">—</span>
        <span className="muted">The account no longer exists.</span>
      </div>
    );
  }

  return (
    <div className="account-balance">
      <span className="account-balance__label">{network.native} balance</span>
      {balance ? (
        <>
          <span className="account-balance__value amt num">{formatAmount(balance.native)}</span>
          {balance.available !== null && (
            <span className="muted">
              Available <span className="amt plain num">{formatAmount(balance.available)}</span>
            </span>
          )}
          {balance.reserve && (
            <span className="faint">
              Reserve {formatAmount(balance.reserve.total)} {network.native} = {formatAmount(balance.reserve.base)} base +{" "}
              {plural(balance.reserve.objects, "object", "objects")} × {formatAmount(balance.reserve.increment)}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="account-balance__value amt">—</span>
          <span className="muted">The balance could not be read.</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The margin

function TokenRow({ net, token }: { net: NetworkInfo["id"]; token: Token }) {
  const name = formatCurrency(token.currency);
  const badge = token.lp ? "LP" : name.slice(0, 3);
  return (
    <div className="token">
      <span className="token__badge mono" aria-hidden="true">
        {badge}
      </span>
      <div className="token__name">
        <span title={name === token.currency ? undefined : token.currency}>{name}</span>
        <span className="token__issuer">
          {token.lp ? "AMM pool " : ""}
          <AccountLink net={net} address={token.issuer} />
        </span>
      </div>
      <span className="amt num">{formatAmount(token.value)}</span>
    </div>
  );
}

function TokensCard({ network, header }: { network: NetworkInfo; header: AccountHeader }) {
  const { tokens } = header;
  const { retry, retrying } = useRetry();
  if (tokens.state === "none") return null;

  if (tokens.state === "failed") {
    return (
      <Card title="Tokens" className="tokens">
        <SectionError what="tokens" onRetry={retry} retrying={retrying} />
      </Card>
    );
  }

  const shown = tokens.items.slice(0, TOKENS_SHOWN);
  const rest = tokens.items.slice(TOKENS_SHOWN);
  return (
    <Card
      title="Tokens"
      flush
      className="tokens"
      action={<span className="faint">{tokens.truncated ? `first ${plural(tokens.items.length, "trust line", "trust lines")}` : plural(tokens.items.length, "trust line", "trust lines")}</span>}
    >
      {tokens.items.length === 0 ? (
        <p className="tokens__empty faint">No tokens.</p>
      ) : (
        <>
          {shown.map((token) => (
            <TokenRow key={`${token.currency}:${token.issuer}`} net={network.id} token={token} />
          ))}
          {rest.length > 0 && (
            <details className="more">
              <summary>{`Show ${count(rest.length)} more`}</summary>
              {rest.map((token) => (
                <TokenRow key={`${token.currency}:${token.issuer}`} net={network.id} token={token} />
              ))}
            </details>
          )}
        </>
      )}
    </Card>
  );
}

function OwnedCard({ header }: { header: AccountHeader }) {
  const owned = header.owned!;
  const ledger = header.live.state === "ok" ? header.live.ledgerIndex : null;
  return (
    <Card title="Owned objects" className="owned">
      {owned.counts.length === 0 ? (
        <p className="muted">This account owns nothing besides its balance.</p>
      ) : (
        <ul className="tiles">
          {owned.counts.map(({ type, label, count: n }) => (
            <li key={type} className="tile">
              <span className="tile__count amt num">{count(n)}</span>
              <span className="tile__label">{label}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="faint owned__note">
        {ledger === null ? "Read live from the network." : `Read live from the network at ledger #${count(ledger)}.`}
        {owned.truncated && ` Counted over the first ${count(OBJECTS_LIMIT)} objects.`}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The tabs and what is under them

function Activity({ network, data }: { network: NetworkInfo; data: AccountPageData }) {
  const net = network.id;
  const items: TabItem[] = [
    ...ACCOUNT_TABS.map((id) => ({ id, label: TAB_LABELS[id], href: accountHref(net, data.address, { tab: id }) })),
    { id: "analytics", label: "Analytics", soon: true },
  ];

  return (
    <Card label="Activity" flush className="cols__wide activity">
      <Tabs label="Account activity" items={items} current={data.tab} />
      <ListSection network={network} data={data} />
    </Card>
  );
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function ListSection({ network, data }: { network: NetworkInfo; data: AccountPageData }) {
  const { list } = data;
  if (!isPromise(list)) return <TabPanel network={network} data={data} list={list} />;
  return (
    <Suspense fallback={<ListLoading tab={data.tab} />}>
      <Await resolve={list} errorElement={<ListFailed what={data.tab} />}>
        {(resolved: TabList) => <TabPanel network={network} data={data} list={resolved} />}
      </Await>
    </Suspense>
  );
}

function ListLoading({ tab }: { tab: AccountTab }) {
  return (
    <div className="activity__loading" role="status">
      {`Loading ${tab}…`}
    </div>
  );
}

function ListFailed({ what }: { what: string }) {
  const { retry, retrying } = useRetry();
  return (
    <div className="activity__failed">
      <SectionError what={what} onRetry={retry} retrying={retrying} />
    </div>
  );
}

function TabPanel({ network, data, list }: { network: NetworkInfo; data: AccountPageData; list: TabList }) {
  const net = network.id;
  if (list.state === "failed") return <ListFailed what={list.what} />;

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
            <a className="btn" href={list.csvHref} download>
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

function When({ net, hash, time }: { net: NetworkInfo["id"]; hash: string; time: number }) {
  const { date, clock } = whenOf(time);
  return (
    <span className="when num">
      <Link to={`/${net}/tx/${hash}`} aria-label={`${date}, transaction ${shortHash(hash)}`}>
        {date}
      </Link>
      <span className="faint">{clock}</span>
    </span>
  );
}

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
