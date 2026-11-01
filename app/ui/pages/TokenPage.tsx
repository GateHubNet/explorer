import { Link } from "react-router";

import type { HolderRowView, MarketRowView, PoolRowView, TokenPageData, TomlCardView, TomlValueView, TransferRowView } from "../../server/token-view";
import { Meter } from "../charts/Meter";
import { AccountLink } from "../components/AccountLink";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyTextButton } from "../components/CopyTextButton";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable, type Column } from "../components/DataTable";
import { DetailList, type DetailRow } from "../components/DetailList";
import { ExternalLink } from "../components/ExternalLink";
import { HashLink } from "../components/HashLink";
import { Pager } from "../components/Pager";
import { PairCoins } from "../components/PairCoins";
import { SectionError } from "../components/SectionError";
import { StatGrid, StatTile } from "../components/StatTile";
import { AlertCircleIcon, ArrowDownIcon, ArrowUpIcon } from "../components/status-icons";
import { WhenText } from "../components/WhenCell";
import type { NetworkInfo } from "../networks";
import { useRetry } from "../use-retry";
import { SettingRow } from "./token-parts";

type Net = NetworkInfo["id"];
type Retry = { onRetry: () => void; retrying: boolean };

/** What a card's head says its data is from (the kit's source line, in the card's action place). */
const Source = ({ children }: { children: string }) => <span className="chart__source">{children}</span>;

/** A card that could not be loaded: its `SectionError`, with Retry, in the place of its body. */
function Failed({ what, onRetry, retrying }: Retry & { what: string }) {
  return (
    <div className="token-page__failed">
      <SectionError what={what} onRetry={onRetry} retrying={retrying} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The header

/**
 * The header card (spec 3.1): the coin, the `<h1>`, the code tag (a code of 40 hex digits carries the hex in its title, in words only a screen reader reads, and in a copy button),
 * "Issued token", the issuer in full, and the buttons: the issuer's account and the toml file, which opens in a new tab (the link is the builder's, an `https:` URL or none), then the
 * source line.
 */
function HeaderCard({ net, data }: { net: Net; data: TokenPageData }) {
  const { head } = data;
  return (
    <section className="card token-page__card" aria-labelledby="token-title">
      <div className="token-page__head">
        <PairCoins codes={[head.code]} className="token-page__coin" />
        <div className="token-page__titles">
          <div className="token-page__name">
            <h1 id="token-title" className="token-page__title">
              {head.title}
            </h1>
            <span className="tag mono token-page__code">
              <span title={head.codeTitle}>{head.code}</span>
              {head.codeHidden !== undefined && <span className="sr">{`, ${head.codeHidden}`}</span>}
            </span>
            {head.hex !== undefined && (
              <CopyTextButton getText={() => head.hex!} className="token-page__copy">
                Copy hex
              </CopyTextButton>
            )}
            <span className="tag">Issued token</span>
          </div>
          <p className="token-page__issuer">
            <span>Issued by</span> <AccountLink net={net} address={head.issuer} full />
          </p>
        </div>
        <div className="token-page__buttons">
          <Link className="btn" to={head.issuerHref}>
            Issuer account
          </Link>
          {head.toml !== null && (
            <ExternalLink href={head.toml.href} nofollow className="btn">
              {head.toml.label}
            </ExternalLink>
          )}
        </div>
      </div>
      <Source>{head.source}</Source>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The toml and the issuer's settings

/** A value of the toml card's list: text, an `https:` link to another site (never an image), the issuer's account, or the code in hex with its sentence. */
function TomlValue({ net, value }: { net: Net; value: TomlValueView }) {
  switch (value.kind) {
    case "text":
      return <span className="token-page__text">{value.text}</span>;
    case "link":
      return (
        <ExternalLink href={value.href} nofollow>
          {value.text}
        </ExternalLink>
      );
    case "account":
      return <AccountLink net={net} address={value.address} full />;
    case "hex":
      return (
        <span className="token-page__hex">
          <span className="mono">{value.hex}</span>
          <span className="faint">{value.note}</span>
        </span>
      );
  }
}

/**
 * The toml card (spec 3.1) in its three states: the listed entry (where it is, the verified sentence, the list of its fields), a domain whose toml does not list the token, and no
 * domain. Everything the issuer wrote is text; the only links are `https:` ones, to the toml file and to the fields that are URLs, each opening a new tab.
 */
function TomlCard({ net, toml }: { net: Net; toml: TomlCardView }) {
  if (toml.state !== "listed") {
    return (
      <Card title={toml.title} className="token-page__toml">
        <p className="token-page__lede">{toml.text}</p>
      </Card>
    );
  }
  const rows: DetailRow[] = toml.rows.map((row) => ({ label: row.label, value: <TomlValue net={net} value={row.value} /> }));
  const { where } = toml.entry;
  return (
    <Card title={toml.title} className="token-page__toml">
      <p className="token-page__lede">
        The <span className="mono">[[CURRENCIES]]</span> entry for {toml.entry.code} in{" "}
        {where.href === null ? (
          <span className="mono token-page__text">{where.text}</span>
        ) : (
          <ExternalLink href={where.href} nofollow>
            <span className="mono token-page__text">{where.text}</span>
          </ExternalLink>
        )}
        .{toml.verified && " The toml also lists the issuer, which makes its name verified."}
      </p>
      <DetailList rows={rows} />
    </Card>
  );
}

/** The issuer's settings (spec 3.1): six rows, each an icon, a name, a pill and a sentence; where they were read from the node, the caption says so; when they could not be read, the words and, if the node failed, Retry. */
function SettingsCard({ settings, onRetry, retrying }: Retry & { settings: NonNullable<TokenPageData["settings"]> }) {
  return (
    <Card title="Issuer settings" action={<Source>{settings.source}</Source>}>
      <p className="token-page__lede">{settings.intro}</p>
      {settings.state === "ok" ? (
        <>
          {settings.fromNode && <p className="token-page__caption faint">Read live from the network</p>}
          <ul className="token-page__settings">
            {settings.rows.map((row) => (
              <SettingRow key={row.id} row={row} />
            ))}
          </ul>
        </>
      ) : settings.retry ? (
        <SectionError what="the issuer's settings" message={settings.message} onRetry={onRetry} retrying={retrying} />
      ) : (
        <p className="faint">{settings.message}</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The markets and the pools

function marketColumns(net: Net, native: string): Column<MarketRowView>[] {
  return [
    {
      id: "pair",
      header: "Pair",
      width: "minmax(170px, 1.6fr)",
      cell: (row) => (
        <span className="token-page__pair-cell">
          {row.href === null ? <span className="token-page__pairname">{row.pair}</span> : <Link to={row.href} className="token-page__pairname">{row.pair}</Link>}
          {row.issuer !== undefined && (
            <span className="token-page__by faint">
              {row.counter} by <AccountLink net={net} address={row.issuer} />
            </span>
          )}
        </span>
      ),
    },
    { id: "last", header: "Last price", width: "minmax(110px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.last}</span> },
    { id: "volume", header: `Volume 24 h (${native})`, width: "minmax(110px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.volume}</span> },
    { id: "trades", header: "Trades", width: "64px", align: "end", cell: (row) => <span className="mono num">{row.trades}</span> },
  ];
}
const MARKETS_WIDTH = 170 + 110 + 110 + 64 + 3 * 16 + 2 * 16;

function poolColumns(native: string): Column<PoolRowView>[] {
  return [
    {
      id: "pool",
      header: "Pool",
      width: "minmax(130px, 1.4fr)",
      cell: (row) => (
        <Link to={row.href} className="token-page__poolname">
          <PairCoins codes={row.coins} />
          <span>{row.pair}</span>
        </Link>
      ),
    },
    { id: "value", header: `Value (${native})`, width: "minmax(90px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.value}</span> },
    { id: "fee", header: "Trading fee", width: "84px", align: "end", cell: (row) => <span className="mono num">{row.fee}</span> },
    { id: "volume", header: "Volume 24 h", width: "minmax(90px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.volume}</span> },
  ];
}
const POOLS_WIDTH = 130 + 90 + 84 + 90 + 3 * 16 + 2 * 16;

function MarketsCard({ data }: { data: TokenPageData }) {
  const { markets, network } = data;
  if (markets === null) return null;
  return (
    <Card title="Markets" action={<Source>{markets.source}</Source>} flush>
      <DataTable label="Markets" columns={marketColumns(network.id, network.native)} rows={markets.rows} rowKey={(row) => row.key} minWidth={MARKETS_WIDTH} empty={markets.empty ?? undefined} className="tokens__table" />
      <div className="card__foot tokens__foot">
        <div className="tokens__notes">
          <p>{markets.footnote}</p>
        </div>
      </div>
    </Card>
  );
}

/** The AMM pools (XRPL), a `SectionError` when the call failed, or Xahau's note in their place. */
function PoolsCard({ data, onRetry, retrying }: Retry & { data: TokenPageData }) {
  const { pools, network } = data;
  if (pools === null) {
    return data.ammNote === null ? null : (
      <Card title="AMM pools">
        <p className="token-page__note">{data.ammNote}</p>
      </Card>
    );
  }
  return (
    <Card title="AMM pools" action={<Source>{pools.source}</Source>} flush>
      {pools.state === "failed" ? (
        <Failed what={pools.what} onRetry={onRetry} retrying={retrying} />
      ) : (
        <>
          <DataTable label="AMM pools" columns={poolColumns(network.native)} rows={pools.rows} rowKey={(row) => row.key} minWidth={POOLS_WIDTH} empty={pools.empty ?? undefined} className="tokens__table" />
          <div className="card__foot tokens__foot">
            <div className="tokens__notes">
              {pools.note !== null && <p>{pools.note}</p>}
              <p>{pools.footnote}</p>
            </div>
            {pools.more !== null && (
              <Link className="btn" to={pools.more.href}>
                {pools.more.label}
              </Link>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The holders and the transfers

/** Frozen: an icon and the word (a status is never a colour alone). */
const Frozen = () => (
  <span className="st st--quiet">
    <AlertCircleIcon />
    Frozen
  </span>
);

function holderColumns(net: Net, code: string): Column<HolderRowView>[] {
  return [
    { id: "rank", header: "#", width: "36px", align: "end", cell: (row) => <span className="mono num faint tokens__rank">{row.rank}</span> },
    {
      id: "holder",
      header: "Holder",
      width: "minmax(260px, 2fr)",
      cell: (row) => (
        <span className="token-page__holder">
          <AccountLink net={net} address={row.holder} />
          {row.frozen && <Frozen />}
        </span>
      ),
    },
    { id: "balance", header: `Balance (${code})`, width: "minmax(170px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.balance}</span> },
    {
      id: "share",
      header: "Share of supply",
      width: "minmax(220px, 1.3fr)",
      cell: (row) => (
        <span className="token-page__share">
          <span className="token-page__meter">
            <Meter data={row.meter} small decorative />
          </span>
          <span className="num">{row.share}</span>
        </span>
      ),
    },
  ];
}
const HOLDERS_WIDTH = 36 + 260 + 170 + 220 + 3 * 16 + 2 * 16;

function HoldersCard({ data, onRetry, retrying }: Retry & { data: TokenPageData }) {
  const { holders, network, head } = data;
  if (holders === null) return null;
  return (
    <Card title="Top holders" action={<Source>{holders.source}</Source>} flush>
      {holders.state === "failed" ? (
        <Failed what={holders.what} onRetry={onRetry} retrying={retrying} />
      ) : (
        <>
          <DataTable label="Top holders" columns={holderColumns(network.id, head.code)} rows={holders.rows} rowKey={(row) => row.key} minWidth={HOLDERS_WIDTH} empty={holders.empty ?? undefined} className="tokens__table" />
          <div className="card__foot tokens__foot">
            <div className="tokens__notes">{holders.top10 !== "" && <p>{holders.top10}</p>}</div>
            {holders.all !== null && (
              <Link className="btn" to={holders.all.href}>
                {holders.all.label}
              </Link>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/** Issued and Redeemed: an arrow and the word, for a payment from the issuer and one to it. */
function IssuerTag({ tag }: { tag: NonNullable<TransferRowView["tag"]> }) {
  return (
    <span className="st st--quiet">
      {tag === "Issued" ? <ArrowUpIcon /> : <ArrowDownIcon />}
      {tag}
    </span>
  );
}

function transferColumns(net: Net, code: string): Column<TransferRowView>[] {
  return [
    { id: "time", header: "Time (UTC)", width: "120px", cell: (row) => <WhenText time={row.time} /> },
    { id: "from", header: "From", width: "minmax(200px, 1.3fr)", cell: (row) => <AccountLink net={net} address={row.from} /> },
    { id: "to", header: "To", width: "minmax(200px, 1.3fr)", cell: (row) => <AccountLink net={net} address={row.to} /> },
    {
      id: "amount",
      header: `Amount (${code})`,
      width: "minmax(150px, 1fr)",
      align: "end",
      cell: (row) => (
        <span className="token-page__amount">
          <span className="mono num">{row.amount}</span>
          {row.tag !== null && <IssuerTag tag={row.tag} />}
        </span>
      ),
    },
    { id: "tx", header: "Transaction", width: "150px", cell: (row) => <HashLink net={net} kind="tx" hash={row.hash} /> },
  ];
}
const TRANSFERS_WIDTH = 120 + 200 + 200 + 150 + 150 + 4 * 16 + 2 * 16;

function TransfersCard({ data, onRetry, retrying }: Retry & { data: TokenPageData }) {
  const { transfers, network, head } = data;
  return (
    <Card title={transfers.title} action={<Source>{transfers.source}</Source>} flush>
      {transfers.state === "failed" ? (
        <Failed what={transfers.what} onRetry={onRetry} retrying={retrying} />
      ) : (
        <>
          <DataTable label={transfers.title} columns={transferColumns(network.id, head.code)} rows={transfers.rows} rowKey={(row) => row.key} minWidth={TRANSFERS_WIDTH} empty={transfers.empty ?? undefined} className="tokens__table" />
          <div className="card__foot tokens__foot">
            <div className="tokens__notes">
              <p>{transfers.footnote}</p>
              <CoverageNote net={network.id} note={transfers.coverage} />
            </div>
            <Pager newerHref={transfers.pager.newerHref} olderHref={transfers.pager.olderHref} preventScrollReset />
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * One token's page (`/{net}/token/{token}`, spec 3.1), in the board's order: the breadcrumb, the header card, the figures with the coverage note under them, the toml and the issuer's
 * settings, the markets and the AMM pools (Xahau's note in their place), the top holders and the recent transfers. Behind a marker (`data.older`) it is the header, a way back to the
 * first page and the transfers.
 *
 * Takes what the view builder made of D6's answers and the node's (`tokenPage`) and never fetches: every label, href and figure is text in `data`. Each card that can fail stands or
 * fails on its own, as a `SectionError` whose Retry asks the route for its data again (`useRetry`). Every address is an `AccountLink`, which reads the names of the route's
 * `NamesProvider`. What the issuer wrote (the toml's fields, its URLs) is text, and no field of it is drawn as an image.
 */
export function TokenPage({ data }: { data: TokenPageData }) {
  const { retry, retrying } = useRetry();
  const { network, head } = data;
  const shared = { onRetry: retry, retrying };
  return (
    <div className="tokens token-page">
      <Breadcrumbs items={[{ label: network.name, href: `/${network.id}` }, { label: "Tokens", href: `/${network.id}/tokens` }, { label: head.code }]} />
      <HeaderCard net={network.id} data={data} />
      {data.older ? (
        data.back !== null && (
          <p className="token-page__back">
            <Link className="btn" to={data.back.href}>
              {data.back.label}
            </Link>
          </p>
        )
      ) : (
        <>
          {data.figures !== null && (
            <div className="token-page__figures">
              <StatGrid label="Figures">
                {data.figures.map((tile) => (
                  <StatTile key={tile.label} figure label={tile.label} value={tile.value} sub={tile.sub === "" ? undefined : tile.sub} delta={tile.delta} />
                ))}
              </StatGrid>
              <CoverageNote net={network.id} note={data.coverage} />
            </div>
          )}
          <div className="token-page__pair">
            {data.toml !== null && <TomlCard net={network.id} toml={data.toml} />}
            {data.settings !== null && <SettingsCard settings={data.settings} {...shared} />}
          </div>
          <div className="token-page__pair">
            <MarketsCard data={data} />
            <PoolsCard data={data} {...shared} />
          </div>
          <HoldersCard data={data} {...shared} />
        </>
      )}
      <TransfersCard data={data} {...shared} />
    </div>
  );
}
