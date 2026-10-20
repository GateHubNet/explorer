import { Link } from "react-router";

import { formatUtc, shortHash } from "../../domain/format";
import { joinAnd } from "../../domain/time-words";
import type { AmendmentPageData, HistoryItem, VoteRowView } from "../../server/amendment-view";
import type { Anchor } from "../../server/anchor";
import { ChartCard } from "../charts/ChartCard";
import { LineChart } from "../charts/LineChart";
import { Meter } from "../charts/Meter";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { CopyButton } from "../components/CopyButton";
import { Countdown } from "../components/Countdown";
import { count, DataTable, type Column } from "../components/DataTable";
import { CheckIcon, ChevronRightIcon } from "../components/icons";
import { LiveRow } from "../components/LiveRow";
import { LiveValue } from "../components/LiveValue";
import { RelativeTime } from "../components/RelativeTime";
import { AmendmentStatusPill, Parts, VotePill } from "../components/StatusMarks";
import { DashIcon } from "../components/status-icons";
import { cx } from "../cx";
import { useHolds, type HoldHandlers } from "../use-hold";
import type { LiveControls } from "../use-live-controls";

/** The source line of the page's cards: one answer of the data API holds all of it. */
const SOURCE = "/v2/network/amendments/{name}";

const CHART_TITLE = "Yes votes per flag ledger, % of the UNL, last 30 days";

type Data = AmendmentPageData & { anchor: Anchor; build: string };
type Consensus = NonNullable<AmendmentPageData["consensus"]>;
type RoundRow = Consensus["table"][number];

/** A card that is not a chart: the kit's title and source line in its head. */
function CardHead({ id, title }: { id: string; title: string }) {
  return (
    <div className="amendment__cardhead">
      <div className="chart__titles">
        <h2 id={id} className="chart__title">
          {title}
        </h2>
        <span className="chart__source">{SOURCE}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The identity (spec 6.1)

/**
 * "Amendment" over the `<h1>` (the name in mono; "Unknown amendment" for a nameless one, its short ID after it) with the status pill beside it, the ID in full with
 * its copy button, the grid of the builder's facts, and D1's description with the board's tag.
 */
function Identity({ identity, nameless }: { identity: AmendmentPageData["identity"]; nameless: boolean }) {
  return (
    <section className="card amendment__identity" aria-label="Amendment">
      <div className="amendment__top">
        <div className="amendment__lead">
          <span className="amendment__label">Amendment</span>
          <div className="amendment__marks">
            <h1 className={cx("amendment__title", !nameless && "mono")}>{identity.heading}</h1>
            {nameless && <span className="amendment__short mono">{shortHash(identity.id)}</span>}
            <AmendmentStatusPill view={identity.status} />
          </div>
        </div>
        <span className="chart__source">{SOURCE}</span>
      </div>

      <div className="amendment__fact">
        <span className="amendment__label">Amendment ID</span>
        <span className="amendment__id mono">
          {identity.id}
          <CopyButton value={identity.id} label="amendment ID" />
        </span>
      </div>

      <div className="amendment__grid">
        {identity.grid.map((row) => (
          <div key={row.label} className="amendment__fact">
            <span className="amendment__label">{row.label}</span>
            <span className="amendment__value">
              <Parts parts={row.value} />
            </span>
          </div>
        ))}
      </div>

      {identity.description !== null && (
        <div className="amendment__about">
          <span className="amendment__label">
            Description <span className="tag">hand-kept metadata, not read from the ledger</span>
          </span>
          <p className="amendment__description">{identity.description}</p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Consensus (spec 6.2)

/** Whether a round's yes votes made a majority: a check and "Yes", a dash and "No" (spec 2.5). */
const Majority = ({ passes }: { passes: boolean }) =>
  passes ? (
    <span className="st st--ok">
      <CheckIcon />
      Yes
    </span>
  ) : (
    <span className="st st--quiet">
      <DashIcon />
      No
    </span>
  );

const ROUND_COLUMNS: Column<RoundRow>[] = [
  {
    id: "from",
    header: "From flag ledger",
    width: "minmax(120px, 1fr)",
    cell: (row) => (
      <Link to={row.from.href} className="mono num">
        {row.from.text}
      </Link>
    ),
  },
  { id: "date", header: "Date (UTC)", width: "minmax(160px, 1.2fr)", cell: (row) => row.date },
  { id: "yes", header: "Yes", width: "70px", align: "end", cell: (row) => row.yes },
  { id: "share", header: "Share", width: "70px", align: "end", cell: (row) => row.share },
  { id: "passes", header: "Majority", width: "70px", cell: (row) => <Majority passes={row.passes} /> },
];

/**
 * The yes share (a figure that ticks in when it changes) with its meter, and the builder's two sentences; then the step chart of the yes votes per flag ledger with its
 * changes-only table, or the words that there were no rounds. An enabled or obsolete amendment has no votes, and its card is the chart alone.
 */
function ConsensusCard({ consensus }: { consensus: Consensus }) {
  const { votes, chart } = consensus;
  return (
    <section className="card amendment__consensus" aria-labelledby="amendment-consensus-title">
      <CardHead id="amendment-consensus-title" title="Consensus" />
      {votes && (
        <div className="amendment__standing">
          <div className="amendment__figure">
            <span className="amendment__share num">
              <LiveValue token={votes.figure}>{votes.figure}</LiveValue>
            </span>
            <div className="amendment__meter">
              <Meter data={votes.meter} />
            </div>
          </div>
          {votes.sentences.map((sentence, index) => (
            <p key={index} className={index === 0 ? "amendment__tally" : "amendment__since"}>
              <Parts parts={sentence} />
            </p>
          ))}
        </div>
      )}
      {chart === null ? (
        <p className="amendment__empty">No voting rounds recorded in the last 30 days.</p>
      ) : (
        <ChartCard
          id="amendment-yes"
          title={CHART_TITLE}
          source={`rounds of ${SOURCE}`}
          what="the yes votes"
          className="amendment__chart"
          // The tracks at their least, the gaps and the padding of a compact row (12 px each).
          table={
            <DataTable
              label="Yes votes per flag ledger, changes only"
              columns={ROUND_COLUMNS}
              rows={consensus.table}
              rowKey={(row) => row.from.href}
              minWidth={562}
              compact
              maxHeight={300}
            />
          }
          notes={consensus.notes}
        >
          <LineChart title={CHART_TITLE} data={chart} curve="step" pageStep={chart.pageStep} />
        </ChartCard>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// History (spec 6.4)

/** The flag of an EnableAmendment that changed the majority, in faint mono after its label. */
const FLAGS: Partial<Record<HistoryItem["event"], string>> = { got_majority: "tfGotMajority", lost_majority: "tfLostMajority" };
/** The dot of an item: got filled, lost outlined, enabled filled with a check (the CSS has the colours). */
const DOTS: Record<HistoryItem["event"], string> = { got_majority: "got", lost_majority: "lost", enabled: "enabled" };

function HistoryEvent({ item }: { item: HistoryItem }) {
  const flag = FLAGS[item.event];
  return (
    <li className="amendment__event">
      <span className={cx("amendment__dot", `amendment__dot--${DOTS[item.event]}`)} aria-hidden="true">
        {item.event === "enabled" && <CheckIcon size={8} />}
      </span>
      <span className="amendment__eventtext">
        <span className="amendment__eventlabel">
          {item.label}
          {flag && (
            <>
              {" "}
              <span className="amendment__flag mono">{flag}</span>
            </>
          )}
        </span>
        <span className="amendment__when num">
          {item.date}
          {item.ledger && (
            <>
              {" · ledger "}
              <Link to={item.ledger.href} className="mono">
                {item.ledger.text}
              </Link>
            </>
          )}
        </span>
        {item.tx ? (
          <Link to={item.tx.href} className="amendment__tx mono">
            {item.tx.text}
          </Link>
        ) : (
          <span className="amendment__tx faint">Before the indexed history</span>
        )}
      </span>
    </li>
  );
}

/** Newest first: the enabling a majority waits for (its countdown ticks in the browser alone), then each change of majority and the enabling. */
function HistoryCard({ history }: { history: AmendmentPageData["history"] }) {
  const { pending, events } = history;
  return (
    <section className="card amendment__history" aria-labelledby="amendment-history-title">
      <CardHead id="amendment-history-title" title="History" />
      {pending === null && events.length === 0 ? (
        <p className="amendment__empty">No EnableAmendment for it in the indexed history.</p>
      ) : (
        <ol className="amendment__events">
          {pending && (
            <li className="amendment__event">
              <span className="amendment__dot amendment__dot--pending" aria-hidden="true" />
              <span className="amendment__eventtext">
                <span className="amendment__eventlabel">Enabled, expected</span>
                <span className="amendment__when num">
                  {pending.when}
                  <Countdown at={pending.countdown.at} fallback="" past="at the next flag ledger" lead=" · " />
                </span>
                <span className="amendment__tx faint">No transaction yet</span>
              </span>
            </li>
          )}
          {events.map((item) => (
            <HistoryEvent key={`${item.event} ${item.tx?.href ?? item.date}`} item={item} />
          ))}
        </ol>
      )}
      <p className="amendment__note">{history.note}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Votes (spec 6.5)

// The tracks at their least, the 16 px gaps between four of them and the row's padding make 620 px; the table is 640 px wide at least (the board's).
const VOTE_COLUMNS: Column<VoteRowView>[] = [
  {
    id: "validator",
    header: "Validator",
    width: "minmax(180px, 1.6fr)",
    cell: (row) => (
      <Link to={row.href} className={cx("amendment__validator", row.name.mono && "mono")}>
        {row.name.text}
      </Link>
    ),
  },
  { id: "vote", header: "Vote", width: "130px", cell: (row) => <VotePill vote={row.vote} /> },
  {
    id: "version",
    header: "Version",
    width: "minmax(120px, 1fr)",
    cell: (row) => (
      <span className="amendment__version">
        {row.version === null ? <span className="faint">—</span> : <span className="mono">{row.version}</span>}
        {row.lacks && (
          <>
            {" "}
            <span className="amendment__lacks">its version lacks it</span>
          </>
        )}
      </span>
    ),
  },
  {
    id: "seen",
    header: "Last seen",
    width: "110px",
    align: "end",
    // The stored page has the absolute time where the browser has an age no finer than 5 minutes: the data can be older than a minute (spec 2.4).
    cell: (row) => (row.lastSeen === null ? <span className="faint">not seen</span> : <RelativeTime at={row.lastSeen} coarse={300} fallback={formatUtc(row.lastSeen)} />),
  },
];

/** A vote table: live (its rows keyed by master key), in a region that holds the page while the visitor is on it. */
function VoteTable({ label, rows, holds, empty, maxHeight }: { label: string; rows: readonly VoteRowView[]; holds: HoldHandlers; empty: string; maxHeight?: number }) {
  return (
    // `amendment__hold` has no style: it is the element that holds the page while the visitor is on the table.
    <div className="amendment__hold" {...holds}>
      <DataTable label={label} columns={VOTE_COLUMNS} rows={rows} rowKey={(row) => row.key} minWidth={640} maxHeight={maxHeight} empty={empty} live className="amendment__table" />
    </div>
  );
}

/** "{yes} yes · {no} no · {none} without a recent vote, on vl.ripple.com and unl.xrplf.org": without S, no publishers. */
function votesHead({ counts, summary }: Data): string {
  const tally = [`${count(counts.yes)} yes`, `${count(counts.no)} no`, ...(counts.none > 0 ? [`${count(counts.none)} without a recent vote`] : [])].join(" · ");
  return summary.state === "ok" && summary.publishers.length > 0 ? `${tally}, on ${joinAnd(summary.publishers)}` : tally;
}

/** "Showing 24 of the 107 other validators seen in the last 24 hours: those with a vote recorded.": without S, no "of the N … seen". */
function othersFoot({ otherVotes, summary }: Data): string {
  const shown = count(otherVotes.length);
  if (summary.state === "ok") return `Showing ${shown} of the ${count(summary.othersSeen)} other validators seen in the last 24 hours: those with a vote recorded.`;
  return `Showing ${shown} other ${otherVotes.length === 1 ? "validator" : "validators"}: those with a vote recorded.`;
}

function VotesCard({ data, holds }: { data: Data; holds: (name: string) => HoldHandlers }) {
  const head = votesHead(data);
  return (
    <section className="card amendment__votes" aria-labelledby="amendment-votes-title">
      <div className="amendment__cardhead">
        <div className="chart__titles">
          <h2 id="amendment-votes-title" className="chart__title">
            Votes of the UNL validators
          </h2>
          <span className="amendment__count">
            <LiveValue token={head}>{head}</LiveValue>
          </span>
        </div>
        <span className="chart__source">{SOURCE}</span>
      </div>
      <VoteTable label="Votes of the UNL validators" rows={data.unlVotes} holds={holds("unl")} empty="No vote of a UNL validator is recorded." maxHeight={470} />

      <details className="amendment__others">
        <summary>
          <ChevronRightIcon size={14} className="amendment__chev" />
          <span>Other validators, not on the UNL</span>{" "}
          <span className="amendment__otherssub">{`· ${count(data.counts.otherYes)} of ${count(data.otherVotes.length)} vote yes · their votes do not count`}</span>
        </summary>
        <VoteTable label="Votes of other validators" rows={data.otherVotes} holds={holds("others")} empty="No vote of another validator is recorded." />
        <p className="amendment__foot">
          {othersFoot(data)}{" "}
          {/* The validators list's All scope, in its canonical form (`validatorsHref`'s): the list of every validator seen, these among them. */}
          <Link to={`/${data.network.id}/validators?scope=all`}>
            All validators →
          </Link>
        </p>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * One amendment (`/{net}/amendments/{name}`, spec 6.1), in the board's order: the breadcrumb, E2's live row, the identity with its grid and description, the consensus
 * beside the history, and the votes of the UNL validators with the other validators' in a disclosure under them. Takes what the view builder made of the data API's
 * answers (`amendmentPage`) and never fetches: every label, href and figure is text in `data`. AD is the page; S stands or fails alone (spec 6.6): without it the vote
 * table's head names no publisher and the disclosure's footer no number of validators seen.
 *
 * The page follows the chain once a minute (spec 2.3): the vote tables' rows enter and slide (`DataTable live`, keyed by master key), the yes share and the head tick in
 * (`LiveValue`), the chart rings when its rounds moved, and the countdowns tick in the browser alone (the server prints the absolute time). A vote table holds the page
 * while a mouse is over it or keyboard focus is in it; the chart does not. Nothing animates on the first render, so another amendment must remount the page (the route
 * keys it by its scope).
 *
 * `live` is what the route gives the page (`useLiveControls`): the pause button, the status line and the hold. `anchor` and `build` are the route's data.
 */
export function AmendmentPage({ data, live }: { data: Data; live: LiveControls }) {
  const holds = useHolds(live.onHold);
  const net = data.network.id;
  // A nameless amendment's canonical segment is its ID (the builder's rule).
  const nameless = data.canonical === data.identity.id;
  return (
    <div className="amendment">
      <Breadcrumbs
        items={[
          { label: data.network.name, href: `/${net}` },
          { label: "Network", href: `/${net}/network` },
          { label: "Amendments", href: `/${net}/amendments` },
          { label: nameless ? shortHash(data.identity.id) : data.identity.heading, mono: true },
        ]}
      />
      <LiveRow label="Live · updates every minute" live={live} heldNote="Paused while you look at the table" />
      <Identity identity={data.identity} nameless={nameless} />
      <div className="amendment__pair">
        {data.consensus && <ConsensusCard consensus={data.consensus} />}
        <HistoryCard history={data.history} />
      </div>
      <VotesCard data={data} holds={holds} />
    </div>
  );
}
