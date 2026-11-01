import { Suspense, type ReactNode } from "react";
import { Await, Link } from "react-router";

import { accountHref, ACCOUNT_TABS, DELEGATIONS_WORD, OBJECTS_LIMIT, type AccountTab, type ListTab } from "../../domain/account-tabs";
import { analyticsHref, DEFAULT_ANALYTICS_PERIOD } from "../../domain/analytics-params";
import { formatAmount, formatCurrency, formatUtc, shortAddress } from "../../domain/format";
import { nftWords } from "../../domain/nft-words";
import { poolLink } from "../../domain/pool-link";
import type { DomainLine } from "../../server/account-name-view";
import type { AccountAnalyticsPageData, AccountHeader, AccountListPageData, AccountPageData, NeverActivatedData, TabList, Token } from "../../server/account-view";
import { AccountLink } from "../components/AccountLink";
import { AccountNameBlock, DomainText, LabelBanners, titleTextOf } from "../components/AccountNameBlock";
import { Amount } from "../components/Amount";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
// The table of the lists and of the analytics view, both chunks of their own that the account route loads with `import()`. Every other page of the budget
// draws it, so it is in the shell (scripts/shell-chunks.ts: what all of them reach statically) while the account route reaches it too: without this line it
// is a file of its own, one more on every page, and one the analytics view loads beyond the account page's (`pnpm check:bundle` fails on it).
import "../components/DataTable";
import { CheckIcon } from "../components/icons";
import { LiveStateNotice } from "../components/LiveStateNotice";
import { Notice } from "../components/Notice";
import { RelativeTime } from "../components/RelativeTime";
import { SectionError } from "../components/SectionError";
import { Tabs, type TabItem } from "../components/Tabs";
import { cx } from "../cx";
import type { Features } from "../features";
import { lazyChunk } from "../lazy-chunk";
import type { NetworkInfo } from "../networks";
import { useFeatures } from "../use-network";
import { useRetry } from "../use-retry";
import { count, ListFailed, plural } from "./account-list-words";
import { AnalyticsFilters } from "./AnalyticsFilters";
import { NotFoundPage } from "./NotFoundPage";

/** Tokens listed before "Show N more". */
const TOKENS_SHOWN = 10;

/** The labels of the tabs that are the same on both networks; the NFTs tab's is the network's word for them (`nftWords`). */
const TAB_LABELS: Record<Exclude<AccountTab, "nfts">, string> = {
  transactions: "Transactions",
  payments: "Payments",
  trades: "Trades",
  offers: "Offers",
  objects: "Objects",
  delegation: "Delegation",
  analytics: "Analytics",
};

/**
 * The analytics view, a chunk of its own (spec 5): the other tabs load none of it. On the server it resolves during the render, so the HTML
 * holds the view; in the browser, hydration keeps that HTML until the chunk has loaded. Like the list panels below, it loads through `lazyChunk`, which
 * reloads the page once when the chunk will not load (a deploy took the build away).
 */
const AccountAnalytics = lazyChunk("AccountAnalytics", () => import("./AccountAnalytics"));

/**
 * The Analytics tab's `onIntent`: the pointer entered it or it took the focus, so its chunk is fetched ahead of the click. Only the chunk: its
 * data would be a render and six calls upstream per hover. A failure here says nothing; the view's own load reports it, if it fails too.
 */
const warmAnalytics = () => void import("./AccountAnalytics").catch(() => {});

/**
 * The list of a tab (`AccountListPanels.tsx`: the list drawn by its own names, its tables or objects, the pager), a chunk of its own: the analytics view
 * never draws a list, so its first load holds none of it. It has no `Suspense` of its own, so that no placeholder shows where none did. On a first page it
 * is drawn inside the list's `Suspense` and `Await`: the server streams the rows when the list and the chunk are in, and in the browser, hydration keeps
 * that HTML until the chunk has loaded. A list that is not a promise (a page behind a marker, the Objects tab) is drawn where it always was: the server's
 * render waits for the chunk, so the HTML holds the rows, and the browser hydrates the page once the chunk is in, as a client-side navigation shows the
 * page it leads to once it is.
 */
const TabPanel = lazyChunk("AccountListPanels", () => import("./AccountListPanels"));

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The account page: the address with its picture, copy button and QR code, when and by whom it was activated, its flags, the balance
 * with the reserve, the tokens and owned objects, and the tabs (transactions, payments with a CSV link, trades, offers, objects, the NFTs while
 * `NFTS` is on, the "soon" label otherwise, the delegations where the network has them, as a link while `DELEGATION` is on and the "soon" label otherwise, and analytics while
 * `ACCOUNT_ANALYTICS` is on, the "soon" label otherwise). Takes what the loader made of the account (`AccountPageData`) and never fetches.
 *
 * - On the first page the header is read live. The tab's list is a promise: it streams in after the header, and when it could not be
 *   loaded the page says "Couldn't load transactions" with a Retry that fetches it again.
 * - On a page reached with a marker (old history, stored for good) there is no live state: it would be a year old. A link leads to
 *   the first page, which has it.
 * - The Analytics tab (spec 1.5) has no Holdings margin: the Activity card is the width of the page, with the filter row under the tabs, and
 *   the view under it, loaded lazily.
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
      {(header.status === "active" || header.status === "deleted") && header.nodeProblem && (
        <LiveStateNotice role="status">
          The network node did not answer, so what it tells (the sequence, flags, reserve and owned objects) is missing. The history below is from the
          explorer&rsquo;s index and is not affected.
        </LiveStateNotice>
      )}

      <Breadcrumbs
        items={[
          { label: network.name, href: `/${net}` },
          { label: "Accounts" },
          // A name is the link text, cut by the stylesheet; without one the short address, as always.
          header.name?.title ? { label: <span className="acct__name">{titleTextOf(header.name.title)}</span> } : { label: shortAddress(data.address), mono: true },
        ]}
      />
      <LabelBanners labels={header.name?.labels ?? []} />

      <AccountCard network={network} data={data} />

      {data.tab === "analytics" ? (
        <>
          <Activity network={network} data={data} />
          <AnalyticsBody network={network} data={data} />
        </>
      ) : header.status === "history" ? (
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
  const features = useFeatures();
  const activation = header.status === "history" ? null : header.activation;
  const live = header.status === "history" ? null : header.live;
  const name = header.name;
  // The activation line says the account's domain, unless a title says it (the name's lines under the `<h1>` do). The builder's line has its state ("not checked yet"); without
  // one (`NAMES` off, or the call failed) it is the node's domain as text.
  const liveDomain = live?.state === "ok" ? live.domain : null;
  const domain: DomainLine | null = name?.title ? null : (name?.domainLine ?? (liveDomain ? { text: liveDomain, state: "none" } : null));
  // A pool account's own page leads to its pool page while `AMM_PAGES` is on. The flag is the node's (`account_info`), so the line is there only when
  // the node answered.
  const isPool = live?.state === "ok" && live.flags.some((flag) => flag.id === "amm");

  return (
    <section className="card account-card" aria-label="Account">
      <div className="account-id">
        <AccountNameBlock net={net} address={address} qr={data.qr} name={name} />

        {isPool && features.ammPages && (
          <p className="account-id__meta account-id__pool">
            This account is an AMM pool. <Link to={poolLink(net, address, features)}>See the pool →</Link>
          </p>
        )}

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
                · <DomainText line={domain} />
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

/**
 * A trust line of the Tokens card: its code, its issuer and its balance. The code is a link to the token's page when the line has one (`token.href`, made by `tokenLink` while `TOKENS`
 * is on), else text. An LP token's issuer is its AMM pool: "AMM pool r…", one link to the pool page while `AMM_PAGES` is on, and "AMM pool" before the pool's account link while it is off.
 */
function TokenRow({ net, token, features }: { net: NetworkInfo["id"]; token: Token; features: Features }) {
  const name = formatCurrency(token.currency);
  const badge = token.lp ? "LP" : name.slice(0, 3);
  // The whole code, where the text is not it (a hex code shown as its text).
  const title = name === token.currency ? undefined : token.currency;
  return (
    <div className={cx("token", token.href !== null && "token--linked")}>
      <span className="token__badge mono" aria-hidden="true">
        {badge}
      </span>
      <div className="token__name">
        {token.href === null ? (
          <span title={title}>{name}</span>
        ) : (
          <span>
            <Link to={token.href} title={title}>
              {name}
            </Link>
          </span>
        )}
        <span className="token__issuer">
          {token.lp && features.ammPages ? (
            <Link to={poolLink(net, token.issuer, features)} title={token.issuer}>
              AMM pool <span className="mono">{shortAddress(token.issuer)}</span>
            </Link>
          ) : (
            <>
              {token.lp ? "AMM pool " : ""}
              <AccountLink net={net} address={token.issuer} />
            </>
          )}
        </span>
      </div>
      <span className="amt num">{formatAmount(token.value)}</span>
    </div>
  );
}

function TokensCard({ network, header }: { network: NetworkInfo; header: AccountHeader }) {
  const { tokens } = header;
  const { retry, retrying } = useRetry();
  const features = useFeatures();
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
            <TokenRow key={`${token.currency}:${token.issuer}`} net={network.id} token={token} features={features} />
          ))}
          {rest.length > 0 && (
            <details className="more">
              <summary>{`Show ${count(rest.length)} more`}</summary>
              {rest.map((token) => (
                <TokenRow key={`${token.currency}:${token.issuer}`} net={network.id} token={token} features={features} />
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

/**
 * The Activity card: the tabs, then the list of a list tab, or the analytics view's filter row. The Analytics tab is a link while the switch is
 * on (`data.analyticsTab`), to the view's default period from every page of the account, history pages included (the view is live mode). The
 * NFTs tab, called as the network calls them (NFTs, URITokens), is a link while `NFTS` is on (the layout's switches, as the NFT links read them)
 * and the "soon" label while it is off. The Delegation tab is `data.delegationTab`'s: a link, the "soon" label, or none (the loader knows that the network has no delegation).
 */
function Activity({ network, data }: { network: NetworkInfo; data: AccountPageData }) {
  const net = network.id;
  const features = useFeatures();
  const items: TabItem[] = ACCOUNT_TABS.flatMap((id): TabItem[] => {
    if (id === "nfts") {
      const label = nftWords(net).tokens;
      return [features.nfts ? { id, label, href: accountHref(net, data.address, { tab: id }) } : { id, label, soon: true }];
    }
    if (id === "delegation") {
      if (data.delegationTab === "none") return [];
      const label = TAB_LABELS[id];
      return [data.delegationTab === "link" ? { id, label, href: accountHref(net, data.address, { tab: id }) } : { id, label, soon: true }];
    }
    if (id !== "analytics") return [{ id, label: TAB_LABELS[id], href: accountHref(net, data.address, { tab: id }) }];
    return [
      data.analyticsTab
        ? { id, label: TAB_LABELS[id], href: analyticsHref(net, data.address, DEFAULT_ANALYTICS_PERIOD), rel: "nofollow", onIntent: warmAnalytics }
        : { id, label: TAB_LABELS[id], soon: true },
    ];
  });

  return (
    <Card label="Activity" flush className="cols__wide activity">
      <Tabs label="Account activity" items={items} current={data.tab} />
      {data.tab === "analytics" ? (
        <AnalyticsFilters network={network} address={data.address} analytics={data.analytics} />
      ) : (
        <ListSection network={network} data={data} />
      )}
    </Card>
  );
}

/**
 * The analytics view under the Activity card. Until its chunk has loaded (a client-side navigation to the tab) it is the view's own waiting
 * frame, hidden from assistive technology: the filter row's status says the view is loading. Keyed by the period: another period is another
 * view, drawn afresh (spec 3.11).
 */
function AnalyticsBody({ network, data }: { network: NetworkInfo; data: AccountAnalyticsPageData }) {
  return (
    <Suspense
      fallback={
        <div className="analytics">
          <div className="analytics__waiting" aria-hidden="true">
            Loading…
          </div>
        </div>
      }
    >
      <AccountAnalytics key={data.analytics.period} network={network} analytics={data.analytics} />
    </Suspense>
  );
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function ListSection({ network, data }: { network: NetworkInfo; data: AccountListPageData }) {
  const { list } = data;
  if (!isPromise(list)) return <TabPanel network={network} data={data} list={list} />;
  const word = listWord(data.tab, network.id);
  return (
    <Suspense fallback={<ListLoading word={word} />}>
      <Await resolve={list} errorElement={<ListFailed what={word} />}>
        {(resolved: TabList) => <TabPanel network={network} data={data} list={resolved} />}
      </Await>
    </Suspense>
  );
}

/**
 * What a tab's list is called in "Loading …" and in the error of a promise that was refused: the tab's name, the NFTs' in the network's words (`NFTs`, `URITokens`), and what the
 * Delegation tab lists (`DELEGATIONS_WORD`, as the loader's `failedList` says).
 */
const listWord = (tab: ListTab, net: NetworkInfo["id"]): string => (tab === "nfts" ? nftWords(net).tokens : tab === "delegation" ? DELEGATIONS_WORD : tab);

function ListLoading({ word }: { word: string }) {
  return (
    <div className="activity__loading" role="status">
      {`Loading ${word}…`}
    </div>
  );
}
