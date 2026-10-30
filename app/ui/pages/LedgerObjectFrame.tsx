// What the pages of an escrow, a check and a payment channel have in common (ledger object pages spec 1.1, 4.1 and 5; the Escrow board): the breadcrumb, the title row, the removed banner,
// the states strip and the two cards, Details and History, around what is the type's own; and the parts of a page that draw the view's data the same way for the three (the Details rows,
// a status line with the ages of its dates). Types only from app/server: the data is the view builder's (`ledger-object-view.ts`), made in the Worker.
//
// The page data holds no age: a time is drawn written out, and the browser puts its age beside it (`RelativeTime` for one that passed, `Countdown` for one to come, by the page's own as-of
// moment), so the HTML the Worker prints and the edge cache keeps is the same at any age.

import { Fragment, type ReactNode } from "react";

import type { Segment } from "../../domain/describe";
import { formatUtc, shortHash } from "../../domain/format";
import type { ObjectKind } from "../../domain/object-link";
import { formatDateTime } from "../../domain/time-words";
import type { DetailRow, DetailValue, ObjectPageCommon, RemovedBanner, TitleLine } from "../../server/ledger-object-view";
import type { NetworkId } from "../../server/networks";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { Breadcrumbs, type Crumb } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { Countdown } from "../components/Countdown";
import { CoverageNote } from "../components/CoverageNote";
// The table every other page of the budget draws, in the shell (scripts/shell-chunks.ts: what all of those pages reach statically): an object page draws none, and without this line the
// table leaves the shell for a file of its own, one more file on every other page (about 290 B each, gzipped). The account page keeps it there the same way.
import "../components/DataTable";
import { DetailList } from "../components/DetailList";
import { HashLink, LedgerLink } from "../components/HashLink";
import { MptAmount } from "../components/MptAmount";
import { Notice } from "../components/Notice";
import { Pill, type PillTone } from "../components/Pill";
import { RelativeTime } from "../components/RelativeTime";
import { Sentence } from "../components/Sentence";
import { StatesStrip } from "../components/StatesStrip";
import { AlertCircleIcon, ClockIcon, DashIcon, MinusCircleIcon } from "../components/status-icons";
import { Timeline } from "../components/Timeline";

/** The footnote of every object's history (spec 4.1). */
const TIMELINE_FOOTNOTE = "Oldest first. Filled dots are transactions; dashed ones are what can still happen.";

/** What the states strip calls the object ("· this escrow"). */
const STRIP_WORDS: Record<ObjectKind, string> = { escrow: "escrow", check: "check", "payment-channel": "channel" };

/** The icon of a pill whose tone has none of its own (`ok` has its check): a status is an icon and a word, never colour alone. */
const PILL_ICONS: Partial<Record<PillTone, ReactNode>> = {
  info: <ClockIcon />,
  warn: <AlertCircleIcon size={12} />,
  neutral: <MinusCircleIcon />,
  off: <DashIcon />,
};

const isoOf = (unix: number): string => new Date(unix * 1000).toISOString();

/**
 * The age of a moment beside it, the browser's alone: the countdown to one after the page's moment (`asOf`, unix seconds: the ledger it is as of, or the removal), the age of one before it.
 * The server prints an empty `<time>`, so that nothing of the clock is stored; `lead` goes before what the browser writes.
 */
function Age({ at, asOf, lead, className }: { at: number; asOf: number; lead?: string; className?: string }) {
  return at > asOf ? <Countdown at={at} fallback="" past="passed" lead={lead} className={className} /> : <RelativeTime at={at} lead={lead} className={className} />;
}

/**
 * A sentence of the page's status with the age of each date it names right after it, "after Nov 2, 2026, 04:00 UTC (in 4 days)": a date of `moments` (unix seconds, as the view writes them
 * with `formatDateTime`) in a text segment is followed by its `Age`, whose brackets the stylesheet draws round what the browser writes (`.object-page__age`). The other segments are `Sentence`'s.
 */
export function DatedSentence({ net, segments, moments, asOf }: { net: NetworkId; segments: readonly Segment[]; moments: readonly number[]; asOf: number }) {
  const dated = moments.filter(Number.isFinite).map((at) => ({ at, text: formatDateTime(at) }));
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.t !== "text") return <Sentence key={index} net={net} segments={[segment]} />;
        const pieces: ReactNode[] = [];
        let rest = segment.v;
        for (;;) {
          const found = dated
            .map((date) => ({ ...date, place: rest.indexOf(date.text) }))
            .filter(({ place }) => place >= 0)
            .sort((a, b) => a.place - b.place)[0];
          if (found === undefined) break;
          const end = found.place + found.text.length;
          pieces.push(rest.slice(0, end), <Age key={pieces.length} at={found.at} asOf={asOf} className="object-page__age" />);
          rest = rest.slice(end);
        }
        pieces.push(rest);
        return <Fragment key={index}>{pieces}</Fragment>;
      })}
    </>
  );
}

/** The value of a row of the Details card, drawn by its kind (`DetailValue`, the view's). */
function Value({ net, value, asOf }: { net: NetworkId; value: DetailValue; asOf: number }) {
  switch (value.kind) {
    case "code":
      return (
        <>
          <span className="mono">{value.text}</span> <CopyButton value={value.text} label={value.copy.replace(/^Copy /, "")} />
        </>
      );
    case "account":
      return <AccountLink net={net} address={value.address} full />;
    case "amount": {
      const { amount } = value;
      if (amount === null) return <span className="faint">—</span>;
      if ("mpt" in amount) return <MptAmount id={amount.mpt.id} units={amount.mpt.units} />;
      return (
        <>
          <Amount value={amount.value} currency={amount.currency} issuer={amount.issuer} />
          {amount.issuer !== undefined && (
            <span className="object-page__issuer">
              issued by <AccountLink net={net} address={amount.issuer} />
            </span>
          )}
        </>
      );
    }
    case "time":
      return (
        <>
          <time dateTime={isoOf(value.at)}>{formatUtc(value.at)}</time>
          <Age at={value.at} asOf={asOf} lead=" · " />
        </>
      );
    case "number":
      return <span className="mono num">{value.text}</span>;
    case "text":
      return <span className={value.faint ? "faint" : undefined}>{value.text}</span>;
  }
}

/** The rows of the Details card (`DetailRow`, the view's): the label with the ledger's name for the field under it, the value by its kind, and the board's hint under it. */
export function ObjectDetails({ net, rows, asOf }: { net: NetworkId; rows: readonly DetailRow[]; asOf: number }) {
  return (
    <DetailList
      rows={rows.map((row) => ({
        label: row.label,
        ...(row.field === undefined ? {} : { field: row.field }),
        value: (
          <>
            <Value net={net} value={row.value} asOf={asOf} />
            {row.hint !== undefined && <span className="object-page__hint">{row.hint}</span>}
          </>
        ),
      }))}
    />
  );
}

/** The account of a Details row of kind `account` (the Owner's, the Source's), for the breadcrumb. */
export function accountOf(rows: readonly DetailRow[], label: string): string | undefined {
  const value = rows.find((row) => row.label === label)?.value;
  return value?.kind === "account" ? value.address : undefined;
}

/** The line beside the title: the creation written out with its age, where the index's history starts, or the ledger and the transaction that last changed what the node holds. */
function TitleLineText({ net, line }: { net: NetworkId; line: TitleLine }) {
  switch (line.kind) {
    case "created":
      return (
        <>
          Created <time dateTime={isoOf(line.at)}>{formatUtc(line.at)}</time>
          <RelativeTime at={line.at} lead=" · " />
        </>
      );
    case "before":
      return (
        <>
          Created before ledger <LedgerLink net={net} index={line.ledger} />
        </>
      );
    case "changed":
      return (
        <>
          Last changed in ledger <LedgerLink net={net} index={line.ledger} />
          {line.tx !== null && (
            <>
              {" by transaction "}
              <HashLink net={net} kind="tx" hash={line.tx} />
            </>
          )}
        </>
      );
  }
}

/** The banner of an object that was removed (spec 4.1): where and by what, then the type's sentence and the board's line that says what the page is. */
function RemovedNotice({ net, banner }: { net: NetworkId; banner: RemovedBanner }) {
  return (
    <Notice tone="info">
      <p className="object-page__removed">
        Removed from the ledger in ledger <LedgerLink net={net} index={banner.ledger} /> by {banner.txType}{" "}
        <HashLink net={net} kind="tx" hash={banner.hash} label={`${banner.txType} transaction ${shortHash(banner.hash)}`} />
      </p>
      <p className="object-page__removed-note">
        <Sentence net={net} segments={banner.sentence} /> This page shows it from history: its last state before it was removed.
      </p>
    </Notice>
  );
}

/**
 * The frame of an object's page (spec 1.1 and 4.1): the breadcrumb, the title row (the type as the one `<h1>`, the status pill with its icon and word, and the title line), the removed
 * banner, `extra` (a banner of the type's own: the check's "Expired, but still in the ledger"), the states strip, and the two cards side by side where there is room: Details, which holds
 * `children` (the type's summary, status lines, its figure and its rows) and the as-of note, and History, the timeline with its footnote, Newer and Older, and the coverage note.
 */
export function LedgerObjectFrame({
  data,
  title,
  breadcrumb,
  children,
  extra,
}: {
  data: ObjectPageCommon;
  title: string;
  breadcrumb: Crumb[];
  children: ReactNode;
  extra?: ReactNode;
}) {
  const net = data.net;
  return (
    <div className="object-page">
      <Breadcrumbs items={breadcrumb} />
      <div className="object-page__head">
        <h1 className="object-page__title">{title}</h1>
        <Pill tone={data.pill.tone} icon={PILL_ICONS[data.pill.tone]}>
          {data.pill.text}
        </Pill>
        <span className="object-page__titleline num">
          <TitleLineText net={net} line={data.titleLine} />
        </span>
      </div>
      {data.banner !== null && <RemovedNotice net={net} banner={data.banner} />}
      {extra}
      <StatesStrip states={data.states} what={STRIP_WORDS[data.kind]} />
      <div className="object-page__cols">
        <Card title="Details" className="object-page__col">
          {children}
          <p className="object-page__asof">{data.asOf}</p>
        </Card>
        <Card title="History" className="object-page__col">
          <Timeline
            net={net}
            items={data.timeline}
            footnote={TIMELINE_FOOTNOTE}
            newer={data.paging?.newerHref ?? undefined}
            older={data.paging?.olderHref ?? undefined}
          />
          <CoverageNote net={net} note={data.coverage} />
        </Card>
      </div>
    </div>
  );
}
