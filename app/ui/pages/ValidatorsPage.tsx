import { useId, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { formatUtc } from "../../domain/format";
import { validatorsHref, type ValidatorsParams } from "../../domain/validators-params";
import type { Anchor } from "../../server/anchor";
import type { TextPart } from "../../server/validator-facts";
import type { Option, Tile, ValidatorRowView, ValidatorsPageData, VersionRow } from "../../server/validators-view";
import { ChartCard } from "../charts/ChartCard";
import { Legend } from "../charts/Legend";
import { ShareBar, shareLegend } from "../charts/ShareBar";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { count, DataTable, type Column } from "../components/DataTable";
import { ChevronRightIcon, SearchIcon } from "../components/icons";
import { LiveRow } from "../components/LiveRow";
import { LiveValue } from "../components/LiveValue";
import { Notice } from "../components/Notice";
import { RelativeTime } from "../components/RelativeTime";
import { SectionError } from "../components/SectionError";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { StatTile } from "../components/StatTile";
import { DomainStatus, FeeArrow, IncompleteMark, LatestMark, NegativeUnlTag, Parts, UnlTag } from "../components/StatusMarks";
import { cx } from "../cx";
import { useHolds, type HoldHandlers } from "../use-hold";
import type { LiveControls } from "../use-live-controls";
import { useRefetching } from "../use-refetching";
import { useRetry } from "../use-retry";

const DASH = "—";

/** The tiles of the overview, as the builder labels them: a summary that did not load has no tiles to read them from, and the page still shows six dashes. */
const TILE_LABELS = ["Validators seen, last 24 h", "On the default UNL", "Quorum", "Negative UNL", "Base / owner reserve", "Next flag ledger"] as const;

/** What the versions card counts in the label column of its bars. */
const VALIDATOR_UNIT = { one: "validator", other: "validators" } as const;

/** What a note of a tile says as text, for the token of its figure: the countdown by its stored text, so that its ticking is not a change. */
function partsText(parts: readonly TextPart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : "countdown" in part ? part.countdown.fallback : part.text)).join("");
}

// ---------------------------------------------------------------------------------------------------------------------------
// The overview

/** A tile: its figure and note tick in when they say something else (`LiveValue`, with the text as the token). */
function OverviewTile({ tile }: { tile: Tile }) {
  return (
    <StatTile
      figure
      label={tile.label}
      value={<LiveValue token={tile.value}>{tile.value}</LiveValue>}
      sub={
        <LiveValue token={partsText(tile.sub)}>
          <Parts parts={tile.sub} />
        </LiveValue>
      }
    />
  );
}

/** Six tiles in the board's grid; when the summary did not load, six dashes with "Couldn’t load", and one error under them. */
function Overview({ summary, onRetry, retrying }: { summary: ValidatorsPageData["summary"]; onRetry: () => void; retrying: boolean }) {
  return (
    <>
      <section className="validators__tiles" aria-label="Network overview">
        {summary.state === "ok"
          ? summary.tiles.map((tile) => <OverviewTile key={tile.label} tile={tile} />)
          : TILE_LABELS.map((label) => <StatTile key={label} figure label={label} value={<LiveValue token={DASH}>{DASH}</LiveValue>} sub="Couldn’t load" />)}
      </section>
      {summary.state !== "ok" && <SectionError what="the network overview" onRetry={onRetry} retrying={retrying} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The versions

/** The versions as a table, with the swatch of each row's group: the chart's other view, with every version in it. */
function VersionsTable({ rows }: { rows: readonly VersionRow[] }) {
  const columns: Column<VersionRow>[] = [
    {
      id: "version",
      header: "Version",
      width: "minmax(110px, 1.4fr)",
      cell: (row) => (
        <>
          <span className="validators__swatch" data-slot={row.slot} aria-hidden="true" />
          {row.version}
        </>
      ),
    },
    { id: "unl", header: "UNL", width: "minmax(80px, 1fr)", align: "end", cell: (row) => row.unl },
    { id: "unl-share", header: "UNL share", width: "minmax(80px, 1fr)", align: "end", cell: (row) => row.unlShare },
    { id: "all", header: "All", width: "minmax(80px, 1fr)", align: "end", cell: (row) => row.all },
    { id: "all-share", header: "All share", width: "minmax(80px, 1fr)", align: "end", cell: (row) => row.allShare },
  ];
  // The tracks at their least, the gaps and the padding of a compact row (12 px each).
  return (
    <DataTable label="Validator software versions" columns={columns} rows={rows} rowKey={(row) => row.version} minWidth={502} compact maxHeight={300} />
  );
}

function VersionsCard({ summary, onRetry, retrying }: { summary: ValidatorsPageData["summary"]; onRetry: () => void; retrying: boolean }) {
  const title = "Validator software versions";
  const versions = summary.state === "ok" ? summary.versions : null;
  return (
    <ChartCard
      id="validators-versions"
      title={title}
      source="/v2/network/validators/summary"
      what="the software versions"
      state={versions ? "ok" : "failed"}
      onRetry={onRetry}
      retrying={retrying}
      legend={versions && <Legend items={shareLegend(versions.chart)} />}
      table={versions && <VersionsTable rows={versions.table} />}
      notes={versions?.notes}
    >
      {versions && <ShareBar title={title} data={versions.chart} unit={VALIDATOR_UNIT} />}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The filters

/** The view the form's fields name, read from the fields as they stand (the hidden ones included): `validatorsHref` tidies it. */
function viewOf(form: HTMLFormElement): ValidatorsParams {
  const data = new FormData(form);
  const field = (name: string): string | undefined => {
    const value = data.get(name);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const view: ValidatorsParams = { scope: field("scope") === "all" ? "all" : "unl" };
  const publisher = field("publisher");
  const amendment = field("amendment");
  const q = field("q");
  if (publisher !== undefined) view.publisher = publisher;
  if (amendment !== undefined) view.amendment = amendment;
  if (q !== undefined) view.q = q;
  return view;
}

function FilterSelect({ name, label, anyLabel, options, value }: { name: string; label: string; anyLabel: string; options: readonly Option[]; value: string | undefined }) {
  const id = useId();
  return (
    <div className="validators__select">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} className="validators__sel" defaultValue={value ?? ""}>
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The search field, "Listed by" and "Votes yes for" (each only while the data it lists loaded), and Apply. A plain GET form that works without a script (the
 * list's canonical redirect tidies its empty fields); with one, Apply goes straight to the canonical address of the fields and keeps the window where it is. The
 * fields are uncontrolled: the page is keyed by its view, so another view is a new form, and a beat that brings the same view leaves what the visitor typed alone.
 * A filter whose field is not drawn (its data did not load) rides in a hidden field, so that Apply does not drop what the address applies as given.
 */
function FilterForm({ data }: { data: ValidatorsPageData }) {
  const fieldId = useId();
  const navigate = useNavigate();
  const { params, hrefs } = data;
  const publishers = data.summary.state === "ok" ? data.summary.publishers : null;
  const amendments = data.amendments.state === "ok" && data.amendments.options.length > 0 ? data.amendments.options : null;
  const hidden: Array<[string, string]> = [];
  if (params.scope === "all") hidden.push(["scope", "all"]);
  if (publishers === null && params.publisher !== undefined) hidden.push(["publisher", params.publisher]);
  if (amendments === null && params.amendment !== undefined) hidden.push(["amendment", params.amendment]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate(validatorsHref(data.network.id, viewOf(event.currentTarget)), { preventScrollReset: true });
  };

  return (
    <form method="get" action={hrefs.action} role="search" aria-label="Filter validators" className="validators__form" onSubmit={onSubmit}>
      <div className="validators__field">
        <label htmlFor={fieldId} className="sr">
          Search validators by domain or key
        </label>
        <SearchIcon size={15} className="validators__icon" />
        <input
          id={fieldId}
          type="search"
          name="q"
          className="validators__input"
          placeholder="Domain or key"
          defaultValue={params.q ?? ""}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
      {publishers !== null && <FilterSelect name="publisher" label="Listed by" anyLabel="any publisher" options={publishers} value={params.publisher} />}
      {amendments !== null && <FilterSelect name="amendment" label="Votes yes for" anyLabel="any amendment" options={amendments} value={params.amendment} />}
      {hidden.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className="btn validators__apply">
        Apply
      </button>
      {hrefs.clear !== null && (
        <Link to={hrefs.clear} preventScrollReset className="validators__clear">
          Clear filters
        </Link>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The table

/** The name as the link to the validator's page, the checks of its domain and its lists, and its short master key (or "no domain") under it. */
function ValidatorCell({ row }: { row: ValidatorRowView }) {
  return (
    <span className="validators__who">
      <span className="validators__marks">
        <Link to={row.href} className={cx("validators__name", row.name.mono && "mono")}>
          {row.name.text}
        </Link>
        {row.domainStatus !== null && <DomainStatus status={row.domainStatus} />}
        {row.unl && <UnlTag publishers={row.unlPublishers} />}
        {row.negativeUnl && <NegativeUnlTag />}
      </span>
      <span className="validators__sub mono">{row.sub}</span>
    </span>
  );
}

/** Base reserve / owner reserve / base fee, each with the arrow of its comparison with the fee now. A validator with no fee vote on record is a dash that a screen reader hears as that. */
function FeeVotes({ fees }: { fees: ValidatorRowView["fees"] }) {
  if (fees === null) {
    return (
      <span className="validators__nofee" title="No fee vote recorded">
        <span aria-hidden="true">{DASH}</span>
        <span className="sr">no fee vote recorded</span>
      </span>
    );
  }
  return (
    <span className="validators__fees mono num">
      {fees.map((cell, index) => (
        <span key={index} className="validators__fee">
          {index > 0 && <span className="faint">/ </span>}
          {cell.text}
          {cell.against !== undefined && <FeeArrow against={cell.against} />}
        </span>
      ))}
    </span>
  );
}

/** "3 yes" as a disclosure of the amendments, each a link; "0 yes" as plain text. */
function YesVotes({ yes }: { yes: ValidatorRowView["yes"] }) {
  if (yes.length === 0) return <span className="faint">0 yes</span>;
  return (
    <details className="validators__yes">
      <summary>
        <span className="num">{`${count(yes.length)} yes`}</span>
        <ChevronRightIcon size={12} className="validators__chev" />
      </summary>
      <ul>
        {yes.map((vote) => (
          <li key={vote.href}>
            <Link to={vote.href} className="mono">
              {vote.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

const COLUMNS: Column<ValidatorRowView>[] = [
  { id: "validator", header: "Validator", width: "minmax(240px, 2.2fr)", cell: (row) => <ValidatorCell row={row} /> },
  {
    id: "version",
    header: "Version",
    width: "130px",
    cell: (row) => (
      <span className="validators__version">
        <span className="mono">{row.version.text}</span>
        {row.version.latest && <LatestMark />}
      </span>
    ),
  },
  {
    id: "agreement",
    header: "Agreement 24 h",
    width: "104px",
    align: "end",
    cell: (row) => (
      <span className="validators__agreement">
        <span className="mono num">{row.agreement.text}</span>
        {row.agreement.incomplete && <IncompleteMark />}
      </span>
    ),
  },
  { id: "fees", header: "Fee votes · base / owner / fee", width: "minmax(150px, 1fr)", cell: (row) => <FeeVotes fees={row.fees} /> },
  { id: "votes", header: "Amendment votes", width: "140px", cell: (row) => <YesVotes yes={row.yes} /> },
  {
    id: "seen",
    header: "Last seen",
    width: "104px",
    align: "end",
    // The stored page has the absolute time where the browser has an age no finer than a minute: the data can be older than it looks (spec 2.4).
    cell: (row) =>
      row.lastSeen === null ? <span className="faint">not seen</span> : <RelativeTime at={row.lastSeen} coarse={60} fallback={formatUtc(row.lastSeen)} />,
  },
];

/** The validators card: its title and source, the scope links and the filters, then the table (or the error that stands in for it) and the footer. */
function ValidatorsCard({ data, holds, onRetry, retrying }: { data: ValidatorsPageData; holds: HoldHandlers; onRetry: () => void; retrying: boolean }) {
  const titleId = useId();
  const { list, hrefs, params } = data;
  // The scope links say how many validators each scope holds; with no list there is nothing to count.
  const counts = list.state === "ok" ? list.counts : null;
  const scopes = [
    { label: counts ? `UNL ${count(counts.unl)}` : "UNL", href: hrefs.scope.unl, current: params.scope === "unl" },
    { label: counts ? `All ${count(counts.all)}` : "All", href: hrefs.scope.all, current: params.scope === "all" },
  ];
  return (
    <section className="card validators__card" aria-labelledby={titleId}>
      <div className="validators__cardhead">
        <div className="chart__titles">
          <h2 id={titleId} className="chart__title">
            Validators
          </h2>
          <span className="chart__source">/v2/network/validators</span>
        </div>
        <div role="group" aria-label="Filters" className="validators__filters">
          <SegmentedLinks label="Which validators" links={scopes} />
          <FilterForm data={data} />
        </div>
      </div>
      {list.state === "ok" ? (
        <>
          {/* `validators__hold` has no style: it is the element that holds the page while the visitor is on the table. */}
          <div className="validators__hold" {...holds}>
            <DataTable
              label="Validators"
              columns={COLUMNS}
              rows={list.rows}
              rowKey={(row) => row.validation_public_key}
              minWidth={980}
              empty={
                hrefs.clear !== null ? (
                  <>
                    No validators match these filters.{" "}
                    <Link to={hrefs.clear} preventScrollReset>
                      Clear filters
                    </Link>
                  </>
                ) : (
                  "No validators to show yet."
                )
              }
              live
              className="validators__table"
            />
          </div>
          <div className="card__foot">
            <p className="validators__foot">{list.footer.join(" · ")}</p>
          </div>
        </>
      ) : (
        <div className="validators__failed">
          <SectionError what="the validators" onRetry={onRetry} retrying={retrying} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page

/**
 * The validators list (`/{net}/validators`, spec 3.1), in the board's order: the breadcrumb, the heading with its intro and the link to the amendments, E2's live
 * row, the notices about the publishers' lists, the network overview, the versions card, and the validators card (the scope links, the filter form, the table and its
 * footer). Takes what the view builder made of the data API's three answers (`validatorsPage`) and never fetches: every label, href and figure is text in `data`.
 * Each of the three stands or fails alone (spec 3.3): the summary's parts are dashes and a section error, the list's card is a section error with the filters kept, and
 * a missing list of amendments only takes "Votes yes for" away.
 *
 * The page follows the chain (spec 2.3): the table's rows enter and slide (`DataTable live`, keyed by master key), a figure that changed ticks in (`LiveValue`), the
 * share bar rings when its versions moved. Nothing animates on the first render, so a view navigation must remount the page (the route keys it by the view). The
 * table holds the page while a mouse is over it or keyboard focus is in it; the charts do not. While another view loads (`useRefetching`) the charts are dimmed.
 *
 * `live` is what the route gives the page (`useLiveControls`): the pause button, the status line and the hold. `anchor` and `build` are the route's data, which the
 * page does not draw.
 */
export function ValidatorsPage({ data, live }: { data: ValidatorsPageData & { anchor: Anchor; build: string }; live: LiveControls }) {
  const refetching = useRefetching();
  const { retry, retrying } = useRetry();
  const holds = useHolds(live.onHold);
  const net = data.network.id;

  return (
    <div className={cx("validators", refetching && "is-refetching")}>
      <Breadcrumbs items={[{ label: data.network.name, href: `/${net}` }, { label: "Network", href: `/${net}/network` }, { label: "Validators" }]} />

      <div className="validators__head">
        <div className="validators__lead">
          <h1 className="validators__title">Validators</h1>
          <p className="validators__intro">
            <Parts parts={data.intro} />
          </p>
        </div>
        <Link to={data.hrefs.amendments} className="validators__cross">
          Amendments →
        </Link>
      </div>

      <LiveRow label="Live · updates every 10 s" live={live} heldNote="Paused while you look at the table" />

      {data.summary.state === "ok" &&
        data.summary.notices.map((notice) => (
          <Notice key={notice} tone="warning">
            {notice}
          </Notice>
        ))}

      <Overview summary={data.summary} onRetry={retry} retrying={retrying} />
      <VersionsCard summary={data.summary} onRetry={retry} retrying={retrying} />
      <ValidatorsCard data={data} holds={holds("table")} onRetry={retry} retrying={retrying} />
    </div>
  );
}
