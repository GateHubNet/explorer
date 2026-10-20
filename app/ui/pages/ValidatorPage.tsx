import { useId, type ReactNode } from "react";
import { Link } from "react-router";

import { amendmentsHref, statusWord } from "../../domain/amendments-params";
import { formatUtc, shortAddress, shortHash } from "../../domain/format";
import type { Anchor } from "../../server/anchor";
import type { DailyRow, LedgerLink, ValidationRowView, ValidatorHistoryData, ValidatorIdentity, ValidatorLiveData } from "../../server/validator-view";
import { ChartCard } from "../charts/ChartCard";
import { LineChart } from "../charts/LineChart";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { CopyButton } from "../components/CopyButton";
import { DataTable, type Column } from "../components/DataTable";
import { CheckIcon } from "../components/icons";
import { LiveRow } from "../components/LiveRow";
import { LiveValue } from "../components/LiveValue";
import { Pager } from "../components/Pager";
import { RelativeTime } from "../components/RelativeTime";
import { SectionError } from "../components/SectionError";
import { StatTile } from "../components/StatTile";
import { AmendmentStatusPill, DomainStatus, FeePill, IncompleteMark, LatestMark, NegativeUnlTag, Parts, UnlTag, ValidationPill, VotePill } from "../components/StatusMarks";
import { DashIcon } from "../components/status-icons";
import { cx } from "../cx";
import { useHolds, type HoldHandlers } from "../use-hold";
import type { LiveControls } from "../use-live-controls";
import { useRefetching } from "../use-refetching";
import { useRetry } from "../use-retry";

const DASH = "—";

/** The source line of the cards drawn from D, the validator. */
const DETAIL_SOURCE = "/v2/network/validators/{key}";

type Data = ValidatorLiveData & { anchor: Anchor; build: string };
type Net = ValidatorLiveData["network"]["id"];

/** A ledger the builder named (`#107,748,095`), as a link to its page. */
const Ledger = ({ ledger }: { ledger: LedgerLink }) => (
  <Link to={ledger.href} className="mono num">
    {ledger.text}
  </Link>
);

/** A card that is not a chart: the kit's title and source line in its head, an action at the end of it. */
function CardHead({ id, title, source, action }: { id: string; title: string; source: string; action?: ReactNode }) {
  return (
    <div className="validator__cardhead">
      <div className="chart__titles">
        <h2 id={id} className="chart__title">
          {title}
        </h2>
        <span className="chart__source">{source}</span>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The heading, shared with the page of older validations

/** `XRPL / Network / Validators / {domain, or the short key in mono}` (spec 1.5). */
function Crumbs({ net, name, identity }: { net: Net; name: string; identity: ValidatorIdentity }) {
  return (
    <Breadcrumbs
      items={[
        { label: name, href: `/${net}` },
        { label: "Network", href: `/${net}/network` },
        { label: "Validators", href: `/${net}/validators` },
        { label: identity.heading.text, mono: identity.heading.mono },
      ]}
    />
  );
}

/** "Validator" over the `<h1>` (the domain, or the short master key in mono), with the domain's status and the UNL and negative UNL tags beside it. */
function Heading({ identity }: { identity: ValidatorIdentity }) {
  return (
    <>
      <span className="validator__kind">Validator</span>
      <div className="validator__marks">
        <h1 className={cx("validator__title", identity.heading.mono && "mono")}>{identity.heading.text}</h1>
        {identity.domainStatus !== null && <DomainStatus status={identity.domainStatus} page />}
        {identity.unl && <UnlTag publishers={identity.unlPublishers} />}
        {identity.negativeUnl && <NegativeUnlTag />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The identity and its facts (spec 4.1)

/** A fact of the grid: its name, its value, and a line under it. */
function Fact({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="validator__fact">
      <span className="validator__label">{label}</span>
      <span className="validator__value">{children}</span>
      {sub && <span className="validator__sub">{sub}</span>}
    </div>
  );
}

/** On a publisher's list: a check and "listed"; off it: a dash and "not listed" (spec 2.5). */
function Membership({ publisher, listed }: { publisher: string; listed: boolean }) {
  return (
    <span className="validator__member">
      <span className="mono">{publisher}</span>
      {listed ? (
        <span className="st st--ok">
          <CheckIcon />
          listed
        </span>
      ) : (
        <span className="st st--quiet">
          <DashIcon />
          not listed
        </span>
      )}
    </span>
  );
}

/** Every publisher of S, listed or not; without S, the lists D says name the validator; on none, says so. Then the negative UNL's ledger, from S. */
function UnlMembership({ data }: { data: Data }) {
  const { summary, identity } = data;
  const lines = summary.state === "ok" ? summary.membership : identity.unlPublishers.map((publisher) => ({ publisher, listed: true }));
  const since = summary.state === "ok" ? summary.negativeSince : null;
  return (
    <Fact
      label="UNL membership"
      sub={
        since && (
          <>
            On the negative UNL since ledger <Ledger ledger={since} />
          </>
        )
      }
    >
      {lines.length === 0 ? "On no default list" : lines.map((line) => <Membership key={line.publisher} {...line} />)}
    </Fact>
  );
}

/**
 * When the validator last signed a ledger: precise, from the newest of its recent validations (VV, kept 2 s); else coarse, no finer than a minute, from D's
 * last seen (kept 10 s and more). The stored page holds the absolute time; the age ticks in the browser.
 */
function LastSeen({ data }: { data: Data }) {
  const newest = data.recent.state === "ok" ? data.recent.newest : null;
  const seen = newest ?? data.grid.lastSeenFallback;
  if (seen === null) return <Fact label="Last seen">not seen by the data API</Fact>;
  return (
    <Fact
      label="Last seen"
      sub={
        seen.ledger && (
          <>
            last validation, ledger <Ledger ledger={seen.ledger} />
          </>
        )
      }
    >
      <RelativeTime at={seen.at} coarse={newest === null ? 60 : undefined} fallback={formatUtc(seen.at)} />
    </Fact>
  );
}

function Identity({ data }: { data: Data }) {
  const { identity, grid } = data;
  return (
    <section className="card validator__identity" aria-label="Validator">
      <div className="validator__top">
        <div className="validator__lead">
          <Heading identity={identity} />
          {identity.note && (
            <p className="validator__note">
              <Parts parts={identity.note} />
            </p>
          )}
        </div>
        <span className="chart__source">{DETAIL_SOURCE}</span>
      </div>

      <div className="validator__fact">
        <span className="validator__label">Master public key</span>
        <span className="validator__master mono">
          {identity.masterKey}
          <CopyButton value={identity.masterKey} label="master public key" />
        </span>
      </div>

      <div className="validator__grid">
        <Fact label="Current signing key">
          {grid.signingKey === null ? (
            DASH
          ) : (
            <>
              <span className="mono" title={grid.signingKey}>
                {shortHash(grid.signingKey)}
              </span>
              <CopyButton value={grid.signingKey} label="signing key" />
            </>
          )}
        </Fact>
        <Fact label="Manifest sequence" sub={grid.manifest}>
          <span className="mono num">{grid.manifestSequence ?? DASH}</span>
        </Fact>
        <UnlMembership data={data} />
        <Fact label="Version">
          {grid.version === null ? (
            DASH
          ) : (
            <>
              <span className="mono">{grid.version.text}</span>
              {grid.version.latest && <LatestMark />}
            </>
          )}
        </Fact>
        <Fact label="First seen">{grid.firstSeen ?? DASH}</Fact>
        <LastSeen data={data} />
        {grid.accounts && (
          <Fact label={`Accounts ${identity.heading.text} lists`}>
            {grid.accounts.map((account) => (
              <Link key={account.address} to={account.href} className="validator__account mono" title={account.address}>
                {shortAddress(account.address)}
              </Link>
            ))}
          </Fact>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Agreement (spec 4.1)

/** The three tiles: the score, the ledgers it counts, and "incomplete" under them when the window misses some hours. Each ticks in when it changes. */
function AgreementTiles({ tiles }: { tiles: ValidatorLiveData["agreement"]["tiles"] }) {
  return (
    <section className="validator__tiles" aria-label="Agreement">
      {tiles.map((tile) => (
        <StatTile
          key={tile.label}
          figure
          label={tile.label}
          value={<LiveValue token={tile.value}>{tile.value}</LiveValue>}
          sub={
            <LiveValue token={`${tile.sub}${tile.incomplete ? " incomplete" : ""}`}>
              {tile.sub}
              {tile.incomplete && (
                <>
                  {" "}
                  <IncompleteMark />
                </>
              )}
            </LiveValue>
          }
        />
      ))}
    </section>
  );
}

const DAILY_COLUMNS: Column<DailyRow>[] = [
  { id: "day", header: "Day (UTC)", width: "minmax(70px, 1fr)", cell: (row) => row.day },
  { id: "agreement", header: "Agreement", width: "minmax(80px, 1fr)", align: "end", cell: (row) => row.agreement },
  { id: "validated", header: "Validated ledgers", width: "minmax(90px, 1fr)", align: "end", cell: (row) => row.validated },
  { id: "missed", header: "Missed", width: "minmax(60px, 1fr)", align: "end", cell: (row) => row.missed },
  { id: "partial", header: "Partial", width: "minmax(60px, 1fr)", align: "end", cell: (row) => row.partial },
  { id: "complete", header: "Complete", width: "minmax(120px, 1.4fr)", cell: (row) => row.complete },
];

const DAILY_TITLE = "Daily agreement with validated ledgers, last 30 days";

/** The 30 days as a line with its axis start in the notes, and the card's own table; with no day recorded yet, the card says so in place of an empty plot. */
function DailyCard({ agreement }: { agreement: ValidatorLiveData["agreement"] }) {
  if (agreement.table.length === 0) {
    return (
      <section className="card chart validator__daily" aria-labelledby="validator-daily-title">
        <CardHead id="validator-daily-title" title={DAILY_TITLE} source={DETAIL_SOURCE} />
        <p className="validator__empty">No daily agreement recorded yet.</p>
      </section>
    );
  }
  return (
    <ChartCard
      id="validator-daily"
      title={DAILY_TITLE}
      source={DETAIL_SOURCE}
      what="the daily agreement"
      className="validator__daily"
      // The tracks at their least, the gaps and the padding of a compact row (12 px each).
      table={<DataTable label="Daily agreement" columns={DAILY_COLUMNS} rows={agreement.table} rowKey={(row) => row.date} minWidth={564} compact maxHeight={300} />}
      notes={agreement.notes}
    >
      <LineChart title={DAILY_TITLE} data={agreement.chart} extreme="lowest" />
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Fee votes and amendment votes (spec 4.1)

type FeeRow = { setting: string; vote: string; now: { now: string; against: "higher" | "lower" | "same" } | null };

const FEE_COLUMNS: Column<FeeRow>[] = [
  { id: "setting", header: "Setting", width: "minmax(110px, 1fr)", cell: (row) => row.setting },
  { id: "vote", header: "Its vote", width: "96px", align: "end", cell: (row) => <span className="amt">{row.vote}</span> },
  { id: "now", header: "Now", width: "96px", align: "end", cell: (row) => <span className="amt validator__now">{row.now?.now ?? DASH}</span> },
  { id: "against", header: "Against now", width: "100px", cell: (row) => (row.now === null ? DASH : <FeePill against={row.now.against} />) },
];

function FeesCard({ data }: { data: Data }) {
  const { fees, summary, amendments } = data;
  const now = summary.state === "ok" ? summary.now : null;
  const rows: FeeRow[] | null = fees.votes && fees.votes.map((vote, index) => ({ ...vote, now: now?.[index] ?? null }));
  return (
    <section className="card validator__card" aria-labelledby="validator-fees-title">
      <CardHead id="validator-fees-title" title="Fee votes" source={DETAIL_SOURCE} />
      {rows === null ? (
        <p className="validator__empty">No fee vote recorded in the last 24 hours.</p>
      ) : (
        // The tracks at their least, the gaps and the padding of a row (16 px each).
        <DataTable label="Fee votes" columns={FEE_COLUMNS} rows={rows} rowKey={(row) => row.setting} minWidth={482} />
      )}
      <p className="validator__foot">
        Fee votes are counted on flag ledgers{amendments.state === "ok" ? `, every ${amendments.flagInterval} ledgers` : ""}.
        {fees.voteLedger && (
          <>
            {" "}
            Its vote is from voting ledger <Ledger ledger={fees.voteLedger} />.
          </>
        )}
        {rows !== null && (summary.state !== "ok" ? " Its votes are not compared with the current fees: they could not be loaded." : now === null && " The current fees are not known yet.")}
      </p>
    </section>
  );
}

type VoteRow = ValidatorLiveData["votes"]["rows"][number];

const VOTING = statusWord("voting");

/** A's status of the amendment: the pill (a countdown to an activation), or "Voting · 11.4% yes"; without A, or for one A does not have, D's word. */
function VoteStatus({ row, amendments }: { row: VoteRow; amendments: ValidatorLiveData["amendments"] }) {
  const view = amendments.state === "ok" ? amendments.status[row.id] : undefined;
  if (view === undefined) return <span className="validator__word">{row.word}</span>;
  if (view.status === "voting") return <span className="validator__word">{view.share === DASH ? VOTING : `${VOTING} · ${view.share} yes`}</span>;
  return <AmendmentStatusPill view={view} />;
}

function VotesCard({ data }: { data: Data }) {
  const { votes, amendments, network } = data;
  const columns: Column<VoteRow>[] = [
    {
      id: "amendment",
      header: "Amendment",
      width: "minmax(150px, 1.3fr)",
      cell: (row) => (
        <Link to={row.href} className={cx("validator__amendment", row.label.mono && "mono")}>
          {row.label.text}
        </Link>
      ),
    },
    // Wide enough for the stored "Activating, expected Oct 23" in one line.
    { id: "status", header: "Status", width: "minmax(180px, 1fr)", cell: (row) => <VoteStatus row={row} amendments={amendments} /> },
    { id: "vote", header: "Its vote", width: "130px", cell: (row) => <VotePill vote={row.vote} /> },
  ];
  return (
    <section className="card validator__card" aria-labelledby="validator-votes-title">
      <CardHead
        id="validator-votes-title"
        title="Amendment votes"
        source={DETAIL_SOURCE}
        action={
          <Link to={amendmentsHref(network.id, {})} className="validator__cross">
            All amendments →
          </Link>
        }
      />
      <DataTable
        label="Amendment votes"
        columns={columns}
        rows={votes.rows}
        rowKey={(row) => row.id}
        // The tracks at their least, the gaps and the padding of a row (16 px each).
        minWidth={524}
        empty={votes.ledger === null ? "No vote recorded in the last 24 hours." : "No amendment is being voted on."}
      />
      <p className="validator__foot">
        Amendments still being voted on. A validator that does not vote yes counts as no.
        {votes.ledger && (
          <>
            {" "}
            Its votes of voting ledger <Ledger ledger={votes.ledger} />.
          </>
        )}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Recent validations (spec 4.1, 4.5)

const VALIDATION_COLUMNS: Column<ValidationRowView>[] = [
  { id: "ledger", header: "Ledger", width: "140px", cell: (row) => <Ledger ledger={row.ledger} /> },
  { id: "hash", header: "Ledger hash", width: "minmax(114px, 1fr)", cell: (row) => <span className="mono validator__hash">{row.hash}</span> },
  { id: "signed", header: "Signed (UTC)", width: "150px", cell: (row) => <span className="mono num">{row.signed}</span> },
  { id: "kind", header: "Kind", width: "70px", cell: (row) => (row.full ? "Full" : "Partial") },
  {
    id: "validated",
    header: "Matches validated ledger",
    width: "minmax(150px, 1fr)",
    cell: (row) => <ValidationPill validated={row.validated} validatedShort={row.validatedShort} />,
  },
];

/**
 * The validations, newest first, with the Newer and Older links of the account page. On the live view the rows enter as the chain moves and the table holds
 * the page while the visitor is on it; a page of older validations is history, and its table does neither.
 */
function RecentCard({
  recent,
  holds,
  onRetry,
  retrying,
}: {
  recent: ValidatorLiveData["recent"] | ValidatorHistoryData["recent"];
  holds?: HoldHandlers;
  onRetry: () => void;
  retrying: boolean;
}) {
  const titleId = useId();
  return (
    <section className="card validator__card" aria-labelledby={titleId}>
      <CardHead id={titleId} title="Recent validations" source="/v2/network/validators/{key}/validations" />
      {recent.state === "ok" ? (
        <>
          {/* `validator__hold` has no style: it is the element that holds the page while the visitor is on the table. */}
          <div className="validator__hold" {...holds}>
            <DataTable
              label="Recent validations"
              columns={VALIDATION_COLUMNS}
              rows={recent.rows}
              rowKey={(row) => row.key}
              // The board's; the tracks at their least, the gaps and the padding of a row (16 px each).
              minWidth={720}
              empty="No validation in the last 7 days."
              live={holds !== undefined}
              className="validator__table"
            />
          </div>
          <div className="card__foot">
            <p>Newest first. Partial validations do not count toward agreement. The data API keeps 7 days.</p>
            <Pager newerHref={recent.paging.newerHref} olderHref={recent.paging.olderHref} />
          </div>
        </>
      ) : (
        <div className="validator__failed">
          <SectionError what="the recent validations" onRetry={onRetry} retrying={retrying} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pages

/**
 * One validator (`/{net}/validators/{key}`, spec 4.1), in the board's order: the breadcrumb, E2's live row, the identity with its facts, the agreement tiles
 * beside the 30-day chart, the fee votes beside the amendment votes, and the recent validations. Takes what the view builder made of the data API's answers
 * (`validatorPage`) and never fetches: every label, href and figure is text in `data`. D is the page; each of VV, S and A stands or fails alone (spec 4.4):
 * the recent validations are a section error and last seen comes from D, coarse; the fee votes lose Now and Against now; the amendment votes keep D's words.
 *
 * The page follows the chain (spec 2.3): the validations enter and slide (`DataTable live`, keyed by ledger and hash), a tile that changed ticks in
 * (`LiveValue`), the chart rings when its days moved. Nothing animates on the first render, so another validator must remount the page (the route keys it by
 * its scope). The table holds the page while a mouse is over it or keyboard focus is in it; the chart does not.
 *
 * `live` is what the route gives the page (`useLiveControls`): the pause button, the status line and the hold. `anchor` and `build` are the route's data.
 */
export function ValidatorPage({ data, live }: { data: Data; live: LiveControls }) {
  const refetching = useRefetching();
  const { retry, retrying } = useRetry();
  const holds = useHolds(live.onHold);
  return (
    <div className={cx("validator", refetching && "is-refetching")}>
      <Crumbs net={data.network.id} name={data.network.name} identity={data.identity} />
      <LiveRow label="Live · updates every ledger" live={live} heldNote="Paused while you look at the table" />
      <Identity data={data} />
      <div className="validator__pair">
        <AgreementTiles tiles={data.agreement.tiles} />
        <DailyCard agreement={data.agreement} />
      </div>
      <div className="validator__pair">
        <FeesCard data={data} />
        <VotesCard data={data} />
      </div>
      <RecentCard recent={data.recent} holds={holds("table")} onRetry={retry} retrying={retrying} />
    </div>
  );
}

/**
 * A page of a validator's older validations (`?marker=`, spec 4.5): history, as an account behind a marker is. The breadcrumb, the `<h1>` with its marks,
 * and the validations with their Newer and Older links; no live row, no tiles and no other card.
 */
export function ValidatorHistoryPage({ data }: { data: ValidatorHistoryData }) {
  const { retry, retrying } = useRetry();
  return (
    <div className="validator">
      <Crumbs net={data.network.id} name={data.network.name} identity={data.identity} />
      <div className="validator__lead">
        <Heading identity={data.identity} />
      </div>
      <RecentCard recent={data.recent} onRetry={retry} retrying={retrying} />
    </div>
  );
}
