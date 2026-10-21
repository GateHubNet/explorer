// What the amendments list shows, worked out in the Worker from the data API's one answer, A (spec 5.1, 5.2 and 9.3): the intro, the card of the amendments about to activate, the
// paragraph of the rules, the status chips with their counts, the table's rows and the footer. `amendmentsPage` is pure: no I/O, no clock, no `Intl`. Every text is made from D1's exact
// strings (validator-facts.ts: `bignumber.js`), so no float reaches a string of the page. The page is A: it has no card of its own that could fail, and a failed A is the loader's 503.

import { amendmentSegment } from "../domain/amendment-ref";
import { AMENDMENT_STATUSES, amendmentHref, amendmentsHref, statusWord, type AmendmentStatus } from "../domain/amendments-params";
import { shortHash } from "../domain/format";
import { formatDate, formatDateTime } from "../domain/time-words";
import { validatorsHref } from "../domain/validators-params";
import type { MeterData } from "../ui/charts/types";
import type { NetworkInfo } from "../ui/networks";
import type { AmendmentRow, AmendmentRules, AmendmentsList } from "./api-types";
import {
  amendmentStatusView,
  clock,
  count,
  DASH,
  daysText,
  ledgerLink,
  moreThan,
  percentText,
  unixOf,
  xlsLink,
  yesMeter,
  yesPercentText,
  yesPercentValue,
  type AmendmentStatusView,
  type TextPart,
} from "./validator-facts";

/** A row of the table: the strings and the paths of §5.1's columns. The row's key is `id`. */
export interface AmendmentListRow {
  id: string;
  /** The position in the list shown (1 for the first row of the chosen status, not of A). */
  rank: number;
  /** The name, or the short ID in mono. */
  name: { text: string; mono: boolean };
  href: string;
  /** The XLS tag: a link only to a document of the XRPL-Standards repository (spec 2.8); `null` for an amendment with no XLS. */
  xls: { text: string; href: string | null } | null;
  /** D1 marks the amendment retired: the software applies it whatever the ledger says (the status pill has the tag). */
  retired: boolean;
  /** `—` for an amendment the metadata file does not know. */
  introduced: string;
  /** The yes share of the UNL for `majority`, `voting` and `unknown`; `null` where no vote is running (or none is recorded). The text is the cell's words under the bar. */
  meter: { data: MeterData; text: string } | null;
  status: AmendmentStatusView;
  /**
   * The date over a link to its ledger (none for a date from the metadata file); `"always"` for a retired amendment that the ledger does not list (D1 serves no `enabled` for
   * it); `null` for one that is not enabled. A retired amendment the ledger lists has its date, as any enabled one.
   */
  enabled: { date: string; ledger: { text: string; href: string } | null } | "always" | null;
}

/** A line of the card of the amendments about to activate. The name is drawn first, as a link; `line` follows it, and `under` is the line beneath. */
export interface ActivatingLine {
  name: { text: string; mono: boolean };
  href: string;
  line: TextPart[];
  under: string;
}

export interface AmendmentsPageData {
  network: NetworkInfo;
  /** The status the list is narrowed to; absent for all of them. */
  status?: AmendmentStatus;
  intro: string;
  hrefs: { validators: string };
  activating: ActivatingLine[];
  rules: TextPart[];
  chips: { label: string; count: number; href: string; current: boolean }[];
  rows: AmendmentListRow[];
  footer: string[];
}

/** The name of an amendment as a link: the name, or the short ID in mono (an amendment nobody has named). */
const nameOf = (row: AmendmentRow): { text: string; mono: boolean } => (row.name !== undefined ? { text: row.name, mono: false } : { text: shortHash(row.id), mono: true });

// ---- Activating soon ---------------------------------------------------------------------------------------------------------------------

/** One line for each amendment that has a majority, in A's order (by the moment it activates). A `majority` row without its `majority` has no moment to say, so no line. */
function activatingOf(net: string, rows: readonly AmendmentRow[], rules: AmendmentRules): ActivatingLine[] {
  return rows.flatMap((row) => {
    const { majority, votes } = row;
    if (row.status !== "majority" || majority === undefined) return [];
    const held = `majority since ${formatDate(majority.since)}, held for ${daysText(rules.majority_hold_seconds)} before it activates`;
    return [
      {
        name: nameOf(row),
        href: amendmentHref(net, amendmentSegment(row)),
        // D1 enables it at the first flag ledger after that moment, in the ledger after it: "on or soon after". The server prints no countdown (a stored page would be wrong at
        // once), so its text is empty and the comma that leads the browser's words goes with them.
        line: [
          ` activates on or soon after ${formatDateTime(majority.expected_activation)}`,
          { countdown: { at: unixOf(majority.expected_activation), fallback: "", past: "at the next flag ledger", lead: ", " } },
          `, if it keeps ${moreThan(rules.threshold_percent)}`,
        ],
        under: votes === undefined ? held : `${count(votes.yes)} of ${count(votes.trusted)} UNL validators vote yes · ${held}`,
      },
    ];
  });
}

// ---- The rules ---------------------------------------------------------------------------------------------------------------------------

/**
 * The paragraph of §5.1, from the rules (nothing in it is hard-coded: the interval, the threshold and the hold are the network's). The next flag ledger is text, never a link, as it is
 * a ledger that does not exist yet, followed by a countdown to the time D1 expects it at (an estimate: `approx`, and `expected 16:05 UTC` on the server). Without a flag ledger in A the
 * sentence is left out; without a time for it there is no countdown.
 */
function rulesOf(list: AmendmentsList): TextPart[] {
  const { rules, next_flag_ledger: flag } = list;
  const base = `Validators vote in the ledger before every flag ledger, once every ${count(rules.flag_interval)} ledgers. An amendment that keeps ${moreThan(rules.threshold_percent)} of the UNL for ${daysText(rules.majority_hold_seconds)} in a row is enabled at the flag ledger that follows, by an EnableAmendment pseudo-transaction in the ledger after it.`;
  if (flag === undefined) return [base];
  const next = `${base} Next flag ledger #${count(flag.ledger_index)}`;
  const at = flag.expected === undefined ? Number.NaN : unixOf(flag.expected);
  if (Number.isNaN(at)) return [`${next}.`];
  return [next, " ", { countdown: { at, fallback: `expected ${clock(at)} UTC`, past: "due now", approx: true } }, "."];
}

// ---- The table ---------------------------------------------------------------------------------------------------------------------------

/** The bar of the consensus column: the yes share of the UNL against the rules' threshold. `null` where no vote is running, and where the round had no trusted validators to share. */
function meterOf(row: AmendmentRow, view: AmendmentStatusView, rules: AmendmentRules): AmendmentListRow["meter"] {
  if (view.status !== "majority" && view.status !== "voting" && view.status !== "unknown") return null;
  const { votes } = row;
  const value = votes === undefined ? null : yesPercentValue(votes.yes, votes.trusted);
  if (votes === undefined || value === null) return null;
  return {
    data: yesMeter(votes.yes, votes.trusted, rules.threshold_percent),
    text: `${yesPercentText(votes.yes, votes.trusted)} · ${count(votes.yes)} / ${count(votes.trusted)} UNL`,
  };
}

/**
 * When an amendment was enabled, as the "Enabled on" cell shows it. A date from the metadata file has no link: the ledger it names is not one the index has seen enabled. A retired
 * amendment is "always on" only when D1 serves no `enabled` for it (the ledger does not list it); with one, it reads as any enabled amendment does (as the amendment page's grid).
 */
function enabledOf(net: string, row: AmendmentRow, view: AmendmentStatusView): AmendmentListRow["enabled"] {
  if (view.status !== "enabled") return null;
  const { enabled } = row;
  if (enabled === undefined && row.retired === true) return "always";
  if (enabled?.date === undefined) return { date: DASH, ledger: null };
  return { date: formatDate(enabled.date), ledger: enabled.source === "ledger" && enabled.ledger_index !== undefined ? ledgerLink(net, enabled.ledger_index) : null };
}

function rowOf(net: string, row: AmendmentRow, rank: number, rules: AmendmentRules): AmendmentListRow {
  const view = amendmentStatusView(row);
  return {
    id: row.id,
    rank,
    name: nameOf(row),
    href: amendmentHref(net, amendmentSegment(row)),
    xls: row.xls === undefined ? null : { text: row.xls, href: xlsLink(row.xls_url) },
    retired: row.retired === true,
    introduced: row.introduced ?? DASH,
    meter: meterOf(row, view, rules),
    status: view,
    enabled: enabledOf(net, row, view),
  };
}

// ---- The chips ---------------------------------------------------------------------------------------------------------------------------

/** All, then a chip for each status, with A's count of it (of every amendment, whatever the view shows). Unknown only where there is one: it is D1's fifth status, rare. */
function chipsOf(net: string, counts: AmendmentsList["counts"], status: AmendmentStatus | undefined): AmendmentsPageData["chips"] {
  const total = AMENDMENT_STATUSES.reduce((sum, each) => sum + counts[each], 0);
  return [
    { label: "All", count: total, href: amendmentsHref(net, {}), current: status === undefined },
    ...AMENDMENT_STATUSES.filter((each) => each !== "unknown" || counts.unknown > 0).map((each) => ({
      label: statusWord(each),
      count: counts[each],
      href: amendmentsHref(net, { status: each }),
      current: status === each,
    })),
  ];
}

// ---- The page ----------------------------------------------------------------------------------------------------------------------------

/**
 * The amendments list (spec 5.1 and 5.2). A's order is kept (D1 3.5: `majority`, `voting`, `unknown`, `enabled`, `obsolete`), and so are the rows of the chosen status: every one is on
 * the page (about 120 on XRPL), with no paging; a chip narrows the list. A row's rank is its position in the list shown.
 */
export function amendmentsPage(input: { network: NetworkInfo; amendments: AmendmentsList; status?: AmendmentStatus }): AmendmentsPageData {
  const { network, amendments, status } = input;
  const net = network.id;
  const { rules } = amendments;
  const shown = status === undefined ? amendments.amendments : amendments.amendments.filter((row) => row.status === status);
  const page: AmendmentsPageData = {
    network,
    intro: `Changes to the ${network.name} protocol. Each one activates only after the validators on the default UNL vote it in.`,
    hrefs: { validators: validatorsHref(net, { scope: "unl" }) },
    activating: activatingOf(net, amendments.amendments, rules),
    rules: rulesOf(amendments),
    chips: chipsOf(net, amendments.counts, status),
    rows: shown.map((row, index) => rowOf(net, row, index + 1, rules)),
    footer: [`${count(shown.length)} amendment${shown.length === 1 ? "" : "s"}`, `the tick on each bar marks ${percentText(rules.threshold_percent)}`],
  };
  if (status !== undefined) page.status = status;
  return page;
}
