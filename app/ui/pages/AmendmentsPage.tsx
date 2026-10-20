import { useId } from "react";
import { Link } from "react-router";

import type { Anchor } from "../../server/anchor";
import type { ActivatingLine, AmendmentListRow, AmendmentsPageData } from "../../server/amendments-view";
import { Meter } from "../charts/Meter";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { count, DataTable, type Column } from "../components/DataTable";
import { LiveRow } from "../components/LiveRow";
import { LiveValue } from "../components/LiveValue";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { AmendmentStatusPill, ExternalLink, Parts } from "../components/StatusMarks";
import { ClockIcon } from "../components/status-icons";
import { cx } from "../cx";
import { useHolds, type HoldHandlers } from "../use-hold";
import type { LiveControls } from "../use-live-controls";

// ---------------------------------------------------------------------------------------------------------------------------
// Activating soon

/** The card of the amendments that have a majority: the board's accent border, a clock, one line for each with the link to its votes and history. */
function ActivatingSoon({ lines }: { lines: readonly ActivatingLine[] }) {
  return (
    <section className="card amendments__soon" aria-label="Activating soon">
      <ul className="amendments__soonlist">
        {lines.map((line) => (
          <li key={line.href} className="amendments__soonitem">
            <span className="amendments__clock" aria-hidden="true">
              <ClockIcon size={18} />
            </span>
            <div className="amendments__soontext">
              <span className="amendments__soonline">
                <Link to={line.href} className={cx("amendments__soonname", line.name.mono && "mono")}>
                  {line.name.text}
                </Link>
                <Parts parts={line.line} />
              </span>
              <span className="amendments__soonunder">{line.under}</span>
            </div>
            {/* The name is in the link's, for a screen reader: with two amendments about to activate, two links named "Votes and history" lead to two places. */}
            <Link to={line.href} className="amendments__soonlink">
              Votes and history<span className="sr"> of {line.name.text}</span> →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The table

/** The XLS tag: a link to the document where the builder allows one (it opens a new tab and says so), else the tag as text. */
function XlsTag({ xls }: { xls: NonNullable<AmendmentListRow["xls"]> }) {
  // A link in a tag is on the page's ground, not the tag's `--sunken`: the accent is under AA on it for Xahau.
  return <span className={cx("tag", xls.href !== null && "amendments__xls--link")}>{xls.href === null ? xls.text : <ExternalLink href={xls.href}>{xls.text}</ExternalLink>}</span>;
}

/** The amendment's name (else its short ID in mono) as the link to its page, and the XLS tag beside it. A retired amendment's tag is the status pill's. */
function AmendmentCell({ row }: { row: AmendmentListRow }) {
  return (
    <span className="amendments__who">
      <Link to={row.href} className={cx("amendments__name", row.name.mono && "mono")}>
        {row.name.text}
      </Link>
      {row.xls !== null && <XlsTag xls={row.xls} />}
    </span>
  );
}

/** The bar and the share under it ("88.6% · 31 / 35 UNL"), which says the numbers once: the bar is decorative. A dash, and the words for a screen reader, where no vote is running. */
function ConsensusCell({ meter }: { meter: AmendmentListRow["meter"] }) {
  if (meter === null) {
    return (
      <span className="faint">
        —<span className="sr">no vote running</span>
      </span>
    );
  }
  return (
    <span className="amendments__consensus">
      <span className="amendments__bar">
        <Meter data={meter.data} small decorative />
      </span>
      <span className="amendments__share num">
        <LiveValue token={meter.text}>{meter.text}</LiveValue>
      </span>
    </span>
  );
}

/** The date over the link to its ledger; "Always on" for a retired amendment (it is in no ledger), a dash where it is not enabled. */
function EnabledCell({ enabled }: { enabled: AmendmentListRow["enabled"] }) {
  if (enabled === "always") {
    return (
      <span className="amendments__enabled">
        <span>Always on</span>
        <span className="sr">retired: always on, not listed in the ledger</span>
      </span>
    );
  }
  if (enabled === null) {
    return (
      <span className="faint">
        —<span className="sr">not enabled</span>
      </span>
    );
  }
  return (
    <span className="amendments__enabled">
      <span className="amendments__date num">{enabled.date}</span>
      {enabled.ledger !== null && (
        <Link to={enabled.ledger.href} className="mono num amendments__ledger">
          {enabled.ledger.text}
        </Link>
      )}
    </span>
  );
}

// The tracks at their least, the 16 px gaps between six of them and the row's padding make 994 px; the table is 1000 px wide at least (the board's).
const COLUMNS: Column<AmendmentListRow>[] = [
  { id: "rank", header: "#", width: "32px", align: "end", cell: (row) => <span className="amendments__rank mono num">{row.rank}</span> },
  { id: "amendment", header: "Amendment", width: "minmax(220px, 1.6fr)", cell: (row) => <AmendmentCell row={row} /> },
  { id: "introduced", header: "Introduced", width: "100px", cell: (row) => <span className="mono amendments__introduced">{row.introduced}</span> },
  { id: "consensus", header: "Consensus, UNL", width: "minmax(200px, 1.3fr)", cell: (row) => <ConsensusCell meter={row.meter} /> },
  { id: "status", header: "Status", width: "190px", cell: (row) => <AmendmentStatusPill view={row.status} /> },
  { id: "enabled", header: "Enabled on", width: "140px", cell: (row) => <EnabledCell enabled={row.enabled} /> },
];

/** The card of all the amendments: its title and source, the status chips, the table (every row of the view, no paging) and the footer. */
function AmendmentsCard({ data, holds }: { data: AmendmentsPageData; holds: HoldHandlers }) {
  const titleId = useId();
  const chips = data.chips.map((chip) => ({ label: `${chip.label} ${count(chip.count)}`, href: chip.href, current: chip.current }));
  return (
    <section className="card amendments__card" aria-labelledby={titleId}>
      <div className="amendments__cardhead">
        <div className="chart__titles">
          <h2 id={titleId} className="chart__title">
            All amendments
          </h2>
          <span className="chart__source">/v2/network/amendments</span>
        </div>
        <SegmentedLinks label="Filter by status" hideLabel links={chips} />
      </div>
      {/* `amendments__hold` has no style: it is the element that holds the page while the visitor is on the table. */}
      <div className="amendments__hold" {...holds}>
        <DataTable
          label="Amendments"
          columns={COLUMNS}
          rows={data.rows}
          rowKey={(row) => row.id}
          minWidth={1000}
          empty={data.status === undefined ? "No amendments to show yet." : "No amendments with this status."}
          live
          className="amendments__table"
        />
      </div>
      <div className="card__foot">
        <p className="amendments__foot">{data.footer.join(" · ")}</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The amendments list (`/{net}/amendments`, spec 5.1), in the board's order: the breadcrumb, the heading with its intro and the link to the validators, E2's live row, the
 * card of the amendments about to activate (left out when there are none), the paragraph of the rules, and the card of all the amendments (the status chips, the table and its
 * footer). Takes what the view builder made of the data API's one answer (`amendmentsPage`) and never fetches: every label, href and figure is text in `data`.
 *
 * The page is A: it has no part that fails on its own (a failed A is the loader's 503). It follows the chain once a minute (spec 2.3): the table's rows enter and slide
 * (`DataTable live`, keyed by the amendment's ID), a share that changed ticks in (`LiveValue`), and the countdowns tick in the browser alone: the server prints the absolute
 * time ("Activating, expected Oct 23"), so that a stored page holds nothing that is wrong a minute later. The table holds the page while a mouse is over it or keyboard
 * focus is in it. Nothing animates on the first render, so another view must remount the page (the route keys it by the view).
 *
 * `live` is what the route gives the page (`useLiveControls`): the pause button, the status line and the hold. `anchor` and `build` are the route's data, which the page does
 * not draw.
 */
export function AmendmentsPage({ data, live }: { data: AmendmentsPageData & { anchor: Anchor; build: string }; live: LiveControls }) {
  const holds = useHolds(live.onHold);
  const net = data.network.id;

  return (
    <div className="amendments">
      <Breadcrumbs items={[{ label: data.network.name, href: `/${net}` }, { label: "Network", href: `/${net}/network` }, { label: "Amendments" }]} />

      <div className="amendments__head">
        <div className="amendments__lead">
          <h1 className="amendments__title">Amendments</h1>
          <p className="amendments__intro">{data.intro}</p>
        </div>
        <Link to={data.hrefs.validators} className="amendments__cross">
          Validators →
        </Link>
      </div>

      <LiveRow label="Live · updates every minute" live={live} heldNote="Paused while you look at the table" />

      {data.activating.length > 0 && <ActivatingSoon lines={data.activating} />}

      <p className="amendments__rules">
        <Parts parts={data.rules} />
      </p>

      <AmendmentsCard data={data} holds={holds("table")} />
    </div>
  );
}
