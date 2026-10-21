// What one amendment's page shows, worked out in the Worker from the data API's answers (spec 6.1 to 6.5, 8 and 9.4): the identity and its grid, the consensus (the yes share, its
// two sentences, the step chart of the yes votes per flag ledger and its changes-only table), the history, and the votes of the UNL and of the other validators (for an enabled or
// obsolete amendment, which is no longer voted on, the note that says so in their place). `amendmentPage` and
// `yesVotesPageStep` are pure: no I/O, no clock (the page has no age in it: the browser draws the ones that tick), no `Intl`. Every text is made from D1's exact strings
// (validator-facts.ts: `bignumber.js`), and the counts become text with `count`, so no float reaches a string of the page.
//
// AD (the amendment) decides the page and is always there, with the envelope of the list (rules, round); S (the summary) stands or fails on its own and only adds the publishers and the
// number of other validators seen: a part that did not load is `{ state: "failed" }` (a `missing` answer is the same to this page), and the page then says less, never something else.
// What D1 leaves out is left out here, and nothing throws for it:
//   - no `round` (no round stored yet): sentence 1 has no "with a recent vote" (there is no UNL size to compare with) and the voting ledger's sentence has no date; no `votes`: the
//     consensus has no figure, meter or sentences (`votes: null`), but its chart and table are still drawn from the rounds;
//   - no `next_flag_ledger` and no `ledger_index` in the envelope: the page does not use them (no flag ledger is named on it, the voting ledger is `votes.ledger_index`);
//   - no `majority.ledger_index` or `majority.tx_hash` (G5): the ledger and the transaction of the majority are left out, each on its own;
//   - no `enabled.date`, `enabled.ledger_index` or `enabled.tx_hash` (a day or a ledger the metadata file lacks): the grid says what there is, and "—" where there is nothing;
//   - a time that is not a time (`NaN` from `unixOf`): no countdown, and the date text is what D1 sent.

import BigNumber from "bignumber.js";

import { amendmentSegment } from "../domain/amendment-ref";
import { tokenOf } from "../domain/fnv";
import { shortHash } from "../domain/format";
import { formatDate, formatDateTime } from "../domain/time-words";
import { validatorHref } from "../domain/validators-params";
import type { MeterData, TimeSeriesData } from "../ui/charts/types";
import type { NetworkInfo } from "../ui/networks";
import type { Loaded } from "./account-view";
import type { AmendmentDetail, AmendmentHistoryEvent, AmendmentMajority, AmendmentRound, AmendmentRoundPoint, AmendmentTally, AmendmentVote, ValidatorsSummary } from "./api-types";
import { suffixOf } from "./meta";
import {
  amendmentStatusView,
  count,
  DASH,
  ledgerLink,
  unixOf,
  valueOf,
  xlsLink,
  yesMeter,
  yesPercentText,
  yesPercentValue,
  type AmendmentStatusView,
  type TextPart,
} from "./validator-facts";

/** A validator's row of a vote table. The row's key is `key` (the master key). */
export interface VoteRowView {
  key: string;
  /** The domain, or the short master key in mono. */
  name: { text: string; mono: boolean };
  href: string;
  vote: "yes" | "no" | "none";
  /** The software version it reported, as D1 writes it; `null` when it reported none. */
  version: string | null;
  /** D1 says its version is older than the one that introduced the amendment (`version_supports` is `false`; absent is no claim). */
  lacks: boolean;
  /** When the data API last saw the validator, in unix seconds; `null` for one never seen. */
  lastSeen: number | null;
}

/**
 * An item of the history, newest first. The page writes `{date} · ledger {ledger}` and `{tx}` as links. `ledger` is `null` only for the enabling of an amendment that the metadata file
 * dates without a ledger. `tx` is `null` only for that same enabling, which the index never saw: it happened before the indexed history, and the page says so.
 */
export interface HistoryItem {
  event: "got_majority" | "lost_majority" | "enabled";
  label: string;
  date: string;
  ledger: { text: string; href: string } | null;
  tx: { text: string; href: string } | null;
}

export interface AmendmentPageData {
  network: NetworkInfo;
  /** The path segment of the amendment's canonical URL: its name, else its ID (so a nameless amendment is the one whose `canonical` is `identity.id`). */
  canonical: string;
  identity: {
    /** The name, or "Unknown amendment" for an amendment nobody has named (the ID follows it, in `id`). */
    heading: string;
    /** The ID in full. */
    id: string;
    status: AmendmentStatusView;
    /** Rows of the identity grid (6.1): the label and the value as parts of a sentence. */
    grid: { label: string; value: TextPart[] }[];
    /** D1's one-line description, which the page tags as hand-kept metadata; `null` when D1 has none. */
    description: string | null;
  };
  /** `null` for an enabled or obsolete amendment that has no rounds, which has no card. */
  consensus: {
    /** The figure, the bar and the sentences; `null` for an enabled or obsolete amendment (no votes, D1 3.5), and for one that has no tally yet. */
    votes: { figure: string; meter: MeterData; sentences: TextPart[][] } | null;
    /** The yes share of each round; `null` without rounds, when the page says "No voting rounds recorded in the last 30 days.". */
    chart: (TimeSeriesData & { pageStep: number }) | null;
    /** The chart's changes only, newest first. */
    table: { from: { text: string; href: string }; date: string; yes: string; share: string; passes: boolean }[];
    notes: string[];
  } | null;
  history: {
    /** The enabling a majority is waiting for: the words, and the moment (unix seconds) the page counts down to. Only for a `majority` with a moment to count down to. */
    pending: { when: string; countdown: { at: number } } | null;
    events: HistoryItem[];
    note: string;
  };
  /**
   * The votes (6.5): the rows of the UNL's validators and of the others, in D1's order (the validators list's), and their counts. An enabled or obsolete amendment is no longer
   * voted on: what D1 still lists for it (its validators' "no", or no recent vote) is no vote that counts, so it has no tables, and the page shows `note` in their place.
   */
  votes: { unl: VoteRowView[]; others: VoteRowView[]; counts: { yes: number; no: number; none: number; otherYes: number } } | { note: string };
  summary: { state: "ok"; publishers: string[]; othersSeen: number } | { state: "failed" };
  /** §8's title and description. */
  meta: { title: string; description: string };
}

type Consensus = NonNullable<AmendmentPageData["consensus"]>;
type GridRow = AmendmentPageData["identity"]["grid"][number];

// ---- Small pieces ------------------------------------------------------------------------------------------------------------------------

const DOT = " · ";

/** Groups of parts as one run, joined by a middle dot; an empty group is left out with its dot. */
const dotted = (groups: readonly TextPart[][]): TextPart[] => groups.filter((group) => group.length > 0).flatMap((group, index) => (index === 0 ? group : [DOT, ...group]));

/** The transaction of an EnableAmendment, named as 2.8 names it: `EnableAmendment 1717BD…A20A`. */
const txLink = (net: string, hash: string): { text: string; href: string } => ({ text: `EnableAmendment ${shortHash(hash)}`, href: `/${net}/tx/${hash}` });

/** `29 are needed`, and `1 is needed`. */
const neededText = (needed: number): string => `${count(needed)} ${needed === 1 ? "is" : "are"} needed`;

/** The amendment's name, else its ID short. */
const labelOf = (amendment: AmendmentDetail): string => amendment.name ?? shortHash(amendment.id);

/** A moment as unix seconds, `null` for a text that is not a time (or no text). */
function momentOf(iso: string | undefined): number | null {
  const at = iso === undefined ? Number.NaN : unixOf(iso);
  return Number.isNaN(at) ? null : at;
}

// ---- The identity (6.1) ------------------------------------------------------------------------------------------------------------------

/** The XLS tag: a link only to a document of the XRPL-Standards repository (2.8), else plain text; without a tag, "No XLS" (and the fix amendments have none). */
function specificationOf(amendment: AmendmentDetail): GridRow {
  const { xls } = amendment;
  if (xls === undefined || xls === "") {
    return { label: "Specification", value: amendment.name?.startsWith("fix") ? ["No XLS", " · fix amendments have none"] : ["No XLS"] };
  }
  const href = xlsLink(amendment.xls_url);
  return { label: "Specification", value: [href === null ? xls : { text: xls, href, external: "plain" }] };
}

/** When the majority began: `Oct 9, 2026 · ledger #107,540,993 · EnableAmendment 1717BD…A20A`, with the ledger and the transaction only where D1 has the indexed EnableAmendment (G5). */
function sinceOf(net: string, majority: AmendmentMajority): TextPart[] {
  return dotted([
    [formatDate(majority.since)],
    majority.ledger_index === undefined ? [] : ["ledger ", ledgerLink(net, majority.ledger_index)],
    majority.tx_hash === undefined ? [] : [txLink(net, majority.tx_hash)],
  ]);
}

/** When it activates: D1 enables it at the first flag ledger after the moment, in the ledger after it, so "on or soon after". The countdown follows; the server prints none (its text is empty). */
function activatesOf(majority: AmendmentMajority): TextPart[] {
  const text = `on or soon after ${formatDateTime(majority.expected_activation)}, if it holds`;
  const at = momentOf(majority.expected_activation);
  return at === null ? [text] : [text, { countdown: { at, fallback: "", past: "at the next flag ledger", lead: DOT } }];
}

/**
 * The enabling of an enabled amendment. From the ledger: the close time with the ledger and the transaction of the EnableAmendment. From the metadata file (`source: "metadata"`): its
 * day, and its ledger if it has one, before the indexed history (so no transaction). A retired amendment that the ledger does not list (D1 serves no `enabled` for it) is always on; one the
 * ledger lists has its enabling, and so does not get the sentence that says it does not.
 */
function enabledOf(network: NetworkInfo, amendment: AmendmentDetail): GridRow {
  const net = network.id;
  const { enabled } = amendment;
  if (enabled === undefined) {
    return amendment.retired === true
      ? { label: "Status", value: [`Always on: ${network.software} applies it although the ledger does not list it`] }
      : { label: "Enabled on", value: [DASH] };
  }
  const ledger: TextPart[] = enabled.ledger_index === undefined ? [] : ["ledger ", ledgerLink(net, enabled.ledger_index)];
  if (enabled.source === "metadata") {
    return { label: "Enabled on", value: dotted([enabled.date === undefined ? [] : [formatDate(enabled.date)], ledger, ["before the indexed history"]]) };
  }
  const value = dotted([enabled.date === undefined ? [] : [formatDateTime(enabled.date)], ledger, enabled.tx_hash === undefined ? [] : [txLink(net, enabled.tx_hash)]]);
  return { label: "Enabled on", value: value.length > 0 ? value : [DASH] };
}

/** The identity grid: the specification and the version, then what only this status has. */
function gridOf(network: NetworkInfo, amendment: AmendmentDetail, view: AmendmentStatusView): GridRow[] {
  const { introduced } = amendment;
  const grid: GridRow[] = [specificationOf(amendment), { label: "Introduced in", value: [introduced === undefined || introduced === "" ? "Not known" : `${network.software} ${introduced}`] }];
  switch (view.status) {
    case "majority":
      if (amendment.majority !== undefined) {
        grid.push({ label: "Majority since", value: sinceOf(network.id, amendment.majority) }, { label: "Activates on", value: activatesOf(amendment.majority) });
      }
      break;
    case "enabled":
      grid.push(enabledOf(network, amendment));
      break;
    case "obsolete":
      grid.push({ label: "Status", value: ["Current software can no longer vote it in."] });
      break;
    case "unknown":
      // D1's unknown is an ID nobody has named. A status a newer D1 sends is `unknown` here too, and one with a name does not get the sentence.
      if (amendment.name === undefined) grid.push({ label: "Status", value: ["No name is known for this ID, from the data API's metadata or its node."] });
      break;
    default:
      break;
  }
  return grid;
}

// ---- Consensus: the figure and the sentences (6.2) ---------------------------------------------------------------------------------------

/**
 * Sentence 1: how the vote stands against what a majority needs. D1's `needed` is its rule (more than ⌊trusted × 80 ÷ 100⌋, 1 for one trusted validator or none), so this sentence only
 * reads it: with `yes` at `needed` or over, "{needed} are needed"; under it, how many more. With fewer trusted validators than the UNL has, the ones counted are said to be those with a recent vote.
 */
function tallyOf(votes: AmendmentTally, round: AmendmentRound | undefined): string {
  const recent = round !== undefined && votes.trusted < round.unl_size;
  const who = recent ? `the ${count(votes.trusted)} UNL validators with a recent vote` : `${count(votes.trusted)} UNL validators`;
  const short = votes.needed - votes.yes;
  const tail = short <= 0 ? neededText(votes.needed) : `${count(short)} more ${short === 1 ? "is" : "are"} needed`;
  return `${count(votes.yes)} of ${who} vote yes; ${tail}.`;
}

/**
 * Sentence 2. A majority: how many votes can change before it is lost (`yes − needed`; "One vote less and it loses majority." at 0; nothing when it is already under, which sentence 1 has
 * said), then since when and when it activates. Voting and unknown: the voting ledger the votes are of, and when it closed.
 */
function standingOf(net: string, amendment: AmendmentDetail, view: AmendmentStatusView, votes: AmendmentTally, round: AmendmentRound | undefined): TextPart[] {
  if (view.status !== "majority") {
    return ["Votes of voting ledger ", ledgerLink(net, votes.ledger_index), round === undefined ? "." : `, ${formatDateTime(round.date)}.`];
  }
  const spare = votes.yes - votes.needed;
  const lead = spare > 0 ? `${count(spare)} can change their vote before it loses majority.` : spare === 0 ? "One vote less and it loses majority." : "";
  const { majority } = amendment;
  if (majority === undefined) return lead === "" ? [] : [lead];
  const head = `${lead === "" ? "" : `${lead} `}Majority since ${formatDate(majority.since)}`;
  const tail = `; activates on or soon after ${formatDateTime(majority.expected_activation)} if it holds.`;
  return majority.ledger_index === undefined ? [head + tail] : [`${head} at ledger `, ledgerLink(net, majority.ledger_index), tail];
}

function votesOf(net: string, amendment: AmendmentDetail, view: AmendmentStatusView): Consensus["votes"] {
  const { votes, round } = amendment;
  if (votes === undefined) return null;
  const second = standingOf(net, amendment, view, votes, round);
  return {
    figure: yesPercentText(votes.yes, votes.trusted),
    meter: yesMeter(votes.yes, votes.trusted, amendment.rules.threshold_percent),
    sentences: [[tallyOf(votes, round)], ...(second.length > 0 ? [second] : [])],
  };
}

// ---- Consensus: the chart and its table (6.2) --------------------------------------------------------------------------------------------

const SECONDS_PER_DAY = 86_400;

/**
 * The number of buckets Page Up and Page Down move on the yes votes chart, a day: the rounds whose date is within 24 h of the newest round's, the newest included. A round exactly 24 h
 * before the newest is not within it, so that n rounds an hour apart make n steps and the step lands on the same hour a day earlier. Measured from the newest date, whatever the order of the
 * rounds; a round whose date is not a time is not counted. 0 where no date can be read (the chart then has no page keys).
 */
export function yesVotesPageStep(rounds: readonly AmendmentRoundPoint[]): number {
  const times = rounds.map((round) => unixOf(round.date)).filter((at) => !Number.isNaN(at));
  if (times.length === 0) return 0;
  const newest = times.reduce((latest, at) => Math.max(latest, at));
  return times.filter((at) => newest - at < SECONDS_PER_DAY).length;
}

/** The axis starts at 50%, or at 0% when a round is lower (compared as drawn, to two decimals). */
const axisStartOf = (values: readonly (string | null)[]): "50" | "0" => (values.some((value) => value !== null && new BigNumber(value).lt(50)) ? "0" : "50");

/** The step line of the yes share per round, with the axis start it chose (the card's note says it). `null` without rounds. */
function chartOf(amendment: AmendmentDetail): { chart: NonNullable<Consensus["chart"]>; start: "50" | "0" } | null {
  const { rounds, rules } = amendment;
  if (rounds.length === 0) return null;
  const values = rounds.map((round) => yesPercentValue(round.yes, round.trusted));
  const start = axisStartOf(values);
  const threshold = new BigNumber(rules.threshold_percent).toFixed();
  const data: Omit<TimeSeriesData, "token"> = {
    axis: { unit: "flag", buckets: rounds.map((round) => round.date) },
    series: [{ id: "yes", label: "Yes votes", slot: 1, values }],
    format: { kind: "percent" },
    domain: { min: start },
    references: [{ value: threshold, label: `${threshold}% threshold` }],
    extras: [
      {
        id: "round",
        label: "Round",
        tooltip: "value",
        values: rounds.map((round) => `flag ledger #${count(round.flag_ledger)} · ${count(round.yes)} of ${count(round.trusted)} UNL validators · ${round.passes ? "majority" : "no majority"}`),
      },
    ],
  };
  return { chart: { ...data, token: tokenOf(data), pageStep: yesVotesPageStep(rounds) }, start };
}

/** The first round and each where `yes` or `trusted` changed, newest first. */
function changesOf(net: string, rounds: readonly AmendmentRoundPoint[]): Consensus["table"] {
  return rounds
    .filter((round, index) => {
      const before = rounds[index - 1];
      return before === undefined || before.yes !== round.yes || before.trusted !== round.trusted;
    })
    .map((round) => ({
      from: ledgerLink(net, round.flag_ledger),
      date: formatDateTime(round.date),
      yes: `${count(round.yes)} / ${count(round.trusted)}`,
      share: yesPercentText(round.yes, round.trusted),
      passes: round.passes,
    }))
    .reverse();
}

function consensusOf(net: string, amendment: AmendmentDetail, view: AmendmentStatusView): AmendmentPageData["consensus"] {
  const voting = view.status === "majority" || view.status === "voting" || view.status === "unknown";
  // An enabled or obsolete amendment has no votes (D1 3.5): its card is the chart and its table, when it was enabled within the last 30 days.
  if (!voting && amendment.rounds.length === 0) return null;
  const drawn = chartOf(amendment);
  return {
    votes: voting ? votesOf(net, amendment, view) : null,
    chart: drawn === null ? null : drawn.chart,
    table: changesOf(net, amendment.rounds),
    notes:
      drawn === null
        ? []
        : [
            `One point per flag ledger, every ${count(amendment.rules.flag_interval)} ledgers. The axis starts at ${drawn.start}%.`,
            "One row per change in the yes count; the count holds until the next row.",
          ],
  };
}

// ---- History (6.4) -----------------------------------------------------------------------------------------------------------------------

const EVENT_LABELS: Record<HistoryItem["event"], string> = { got_majority: "Got majority", lost_majority: "Lost majority", enabled: "Enabled" };

/** Whether this build has a word for the event (a newer D1 may send another). */
const isNamed = (event: AmendmentHistoryEvent): event is AmendmentHistoryEvent & { event: HistoryItem["event"] } => Object.hasOwn(EVENT_LABELS, event.event);

function historyOf(network: NetworkInfo, amendment: AmendmentDetail, view: AmendmentStatusView): AmendmentPageData["history"] {
  const net = network.id;
  const { majority, enabled } = amendment;
  const at = view.status === "majority" ? momentOf(majority?.expected_activation) : null;
  // D1 lists the oldest first. An event this build has no word for (a newer D1) is left out rather than named wrongly.
  const events: HistoryItem[] = [...amendment.history]
    .reverse()
    .filter(isNamed)
    .map((event) => ({ event: event.event, label: EVENT_LABELS[event.event], date: formatDate(event.date), ledger: ledgerLink(net, event.ledger_index), tx: txLink(net, event.tx_hash) }));
  // An amendment enabled from the metadata file has no EnableAmendment in the index: its one item is the file's day, and its ledger if the file has one. It is the newest.
  if (view.status === "enabled" && enabled?.source === "metadata" && !events.some((event) => event.event === "enabled")) {
    events.unshift({
      event: "enabled",
      label: EVENT_LABELS.enabled,
      date: enabled.date === undefined ? DASH : formatDate(enabled.date),
      ledger: enabled.ledger_index === undefined ? null : ledgerLink(net, enabled.ledger_index),
      tx: null,
    });
  }
  return {
    pending: at === null || majority === undefined ? null : { when: `${formatDateTime(majority.expected_activation)}, if the majority holds`, countdown: { at } },
    events,
    note: "Each change of majority is an EnableAmendment pseudo-transaction, in the ledger after a flag ledger.",
  };
}

// ---- Votes (6.5) -------------------------------------------------------------------------------------------------------------------------

function voteRowOf(net: string, vote: AmendmentVote): VoteRowView {
  const key = vote.validation_public_key;
  return {
    key,
    name: vote.domain !== undefined && vote.domain !== "" ? { text: vote.domain, mono: false } : { text: shortHash(key), mono: true },
    href: validatorHref(net, key),
    vote: vote.vote,
    version: vote.version === undefined || vote.version === "" ? null : vote.version,
    lacks: vote.version_supports === false,
    lastSeen: momentOf(vote.last_seen),
  };
}

/** The tables of the votes and their counts, or, for an amendment that is no longer voted on, the note that stands in their place. */
function voteTablesOf(net: string, amendment: AmendmentDetail, view: AmendmentStatusView): AmendmentPageData["votes"] {
  if (view.status === "enabled") return { note: "An enabled amendment is no longer voted on." };
  if (view.status === "obsolete") return { note: "Current software can no longer vote for it, so no votes are shown." };
  const unl = amendment.unl_votes.map((vote) => voteRowOf(net, vote));
  const others = amendment.other_votes.map((vote) => voteRowOf(net, vote));
  const tally = (vote: VoteRowView["vote"]): number => unl.filter((row) => row.vote === vote).length;
  return { unl, others, counts: { yes: tally("yes"), no: tally("no"), none: tally("none"), otherYes: others.filter((row) => row.vote === "yes").length } };
}

// ---- Title and description (8) -----------------------------------------------------------------------------------------------------------

/** The sentence of §8 for the amendment's status. It has no age and no countdown: the page is stored for a minute. */
function sentenceOf(network: NetworkInfo, amendment: AmendmentDetail, view: AmendmentStatusView, label: string): string {
  const name = network.name;
  switch (view.status) {
    case "enabled": {
      const { enabled } = amendment;
      const since = enabled?.date === undefined ? "" : ` since ${formatDate(enabled.date)}`;
      const ledger = enabled?.ledger_index === undefined ? "" : ` (ledger ${count(enabled.ledger_index)})`;
      return `${label} is enabled on ${name}${since}${ledger}.`;
    }
    case "majority": {
      const { majority } = amendment;
      return majority === undefined
        ? `${label} has a majority of ${name}'s default UNL.`
        : `${label} has had a majority of ${name}'s default UNL since ${formatDate(majority.since)} and activates on or soon after ${formatDate(majority.expected_activation)} if it holds.`;
    }
    case "obsolete":
      return `${label} is obsolete on ${name}: current software can no longer vote it in.`;
    default: {
      if (view.status === "unknown" && amendment.name === undefined) return `An amendment of ${name} with no known name: its votes and history.`;
      const { votes } = amendment;
      return votes === undefined
        ? `The validators of ${name}'s default UNL are voting on ${label}.`
        : `${count(votes.yes)} of ${count(votes.trusted)} validators of ${name}'s default UNL vote for ${label}; ${neededText(votes.needed)}.`;
    }
  }
}

function metaOf(network: NetworkInfo, amendment: AmendmentDetail, view: AmendmentStatusView): AmendmentPageData["meta"] {
  const label = labelOf(amendment);
  const sentence = sentenceOf(network, amendment, view, label);
  const { description } = amendment;
  return { title: `Amendment ${label} · ${suffixOf(network)}`, description: description === undefined || description === "" ? sentence : `${sentence} ${description}` };
}

// ---- The page ----------------------------------------------------------------------------------------------------------------------------

/**
 * The amendment page (spec 6). `amendment` is D1's answer for the amendment, with the envelope of the list (the rules and the newest round); `summary` is S, whose publishers and number of
 * other validators seen are the two things it adds, and whose failure leaves them out.
 */
export function amendmentPage(input: { network: NetworkInfo; amendment: AmendmentDetail; summary: Loaded<ValidatorsSummary> }): AmendmentPageData {
  const { network, amendment } = input;
  const net = network.id;
  const view = amendmentStatusView(amendment);
  const summary = valueOf(input.summary);
  return {
    network,
    canonical: amendmentSegment(amendment),
    identity: {
      heading: amendment.name ?? "Unknown amendment",
      id: amendment.id,
      status: view,
      grid: gridOf(network, amendment, view),
      description: amendment.description === undefined || amendment.description === "" ? null : amendment.description,
    },
    consensus: consensusOf(net, amendment, view),
    history: historyOf(network, amendment, view),
    votes: voteTablesOf(net, amendment, view),
    summary: summary === null ? { state: "failed" } : { state: "ok", publishers: summary.unl.publishers.map((publisher) => publisher.id), othersSeen: summary.validators.others_seen_24h },
    meta: metaOf(network, amendment, view),
  };
}
