// What one validator's page shows, worked out in the Worker from the data API's answers (spec 4.1 to 4.5 and 9.2): the identity and the verification note, the facts grid, the
// three agreement tiles with the 30-day chart and its table, the fee votes, the amendment votes, and the recent validations with their paging; and the view of the older
// validations behind a `?marker=`, which holds the identity and the validations alone. `validatorPage` and `validatorHistoryPage` are pure: no I/O, no clock (the anchor is
// the chain's time, passed in), no `Intl`. Every text is made from D1's exact strings (validator-facts.ts: `bignumber.js`), and the counts become text with `count`, so no
// float reaches a string of the page.
//
// D (the validator) decides the page and is always there. Each of VV (the recent validations), S (the summary) and A (the amendments) stands or fails on its own: a part
// that did not load is `{ state: "failed" }` (a `missing` answer is the same to this page), and the page then says less, never something else:
//   - without VV the recent card fails, and last seen is D's (`grid.lastSeenFallback`); with VV, last seen is its newest validation (`recent.newest`);
//   - without S the fee votes have no Now and no Against now, UNL membership is D's `unl_lists` (`identity.unlPublishers`), and no negative UNL ledger is known;
//   - without A the amendment votes keep D's rows and D's status (its pill, with no moment and no share), and the fee votes' note says "on flag ledgers" without the interval.
// A key the data API leaves out becomes `null` (or an empty list) here, and the page draws no line for it.

import BigNumber from "bignumber.js";

import { amendmentSegment } from "../domain/amendment-ref";
import { amendmentHref } from "../domain/amendments-params";
import { tokenOf } from "../domain/fnv";
import { formatUtcDay, shortHash, utcMoment } from "../domain/format";
import { trailPaging, type Paging } from "../domain/paging";
import { formatDate } from "../domain/time-words";
import { validatorHref } from "../domain/validators-params";
import { utcDayOf } from "../domain/window";
import type { TimeSeriesData } from "../ui/charts/types";
import type { NetworkInfo } from "../ui/networks";
import type { Loaded } from "./account-view";
import type { Anchor } from "./anchor";
import type { Agreement, AmendmentsList, DailyAgreement, FeeVote, ValidatorDetail, ValidatorsSummary, ValidatorValidation, ValidatorValidationsPage } from "./api-types";
import {
  accountLinks,
  amendmentStatusView,
  compareFee,
  count,
  DASH,
  dropsText,
  feesNotCompared,
  ledgerLink,
  ledgersText,
  nativeText,
  publisherLabel,
  scoreText,
  scoreValue,
  unixOf,
  unlTagWords,
  valueOf,
  verificationNote,
  versionText,
  type AmendmentStatusView,
  type DomainStatusKind,
  type TextPart,
} from "./validator-facts";

/** A ledger named by the number it shows, `#107,748,095`, with the path of its page. */
export type LedgerLink = ReturnType<typeof ledgerLink>;

/** What the heading of the page and of the history view hold: the name, the marks beside it, the note under it. */
export interface ValidatorIdentity {
  /** The domain, or the short master key in mono. */
  heading: { text: string; mono: boolean };
  /** `null` for a validator with no domain, or whose domain the data API sent no check of. */
  domainStatus: DomainStatusKind | null;
  unl: boolean;
  /** The publishers whose lists name the validator (D's `unl_lists`), by their labels: the membership line when S did not load (the UNL tag reads `listedBy`). */
  unlPublishers: string[];
  /** The words of the UNL tag, a screen reader's and the mouse's: `Listed by A and B`, `Listed by the fixed list`; empty when no list names the validator. */
  listedBy: string;
  negativeUnl: boolean;
  /** What the domain's check found (4.2); `null` without a domain, and for a domain nothing is known of. */
  note: TextPart[] | null;
  /** The master key, in full. */
  masterKey: string;
}

/** A day of the 30-day table: the strings of §4.1's columns. `date` (`YYYY-MM-DD`) is the row's key. */
export interface DailyRow {
  date: string;
  /** `Oct 19`, UTC. */
  day: string;
  agreement: string;
  validated: string;
  missed: string;
  partial: string;
  complete: "yes" | "no, hours missing";
}

/** A row of the recent validations. The row's key is `key`. */
export interface ValidationRowView {
  /** `${ledger_index}:${ledger_hash}`: the same ledger can be signed under two hashes. */
  key: string;
  ledger: LedgerLink;
  /** The ledger hash, short. Not a link: a hash that differs is no validated ledger. */
  hash: string;
  /** `15:42:51` (UTC), with `Oct 18, ` before it when its day is not the newest row's. */
  signed: string;
  full: boolean;
  validated: ValidatorValidation["validated"];
  /** The validated ledger's hash, short, for a `different` one (the hidden words of its pill). */
  validatedShort?: string;
}

export interface ValidatorLiveData {
  kind: "live";
  network: NetworkInfo;
  /** The master key. */
  key: string;
  identity: ValidatorIdentity;
  grid: {
    /** The current signing key, in full (the page shortens it, with the full key as its title). */
    signingKey: string | null;
    /** The manifest's sequence, `2`: the value of the "Manifest sequence" cell. */
    manifestSequence: string | null;
    /** What sits under the sequence: `4 signing keys seen by the data API` (`one signing key seen`). */
    manifest: string | null;
    /** The version (`3.4.1`, on Xahau `2026.10.13 · build 4119`), and whether it is the latest. */
    version: { text: string; latest: boolean } | null;
    /** `Feb 2, 2022 · first seen by the data API`. */
    firstSeen: string | null;
    /** D's `last_seen` (unix seconds) and `current_index`: what last seen says when VV did not load. */
    lastSeenFallback: { at: number; ledger: LedgerLink | null } | null;
    /** The accounts a verified domain lists, each a link; `null` when there is no line to draw. */
    accounts: { address: string; href: string }[] | null;
  };
  agreement: {
    /** Agreement, 1 h, 24 h and 30 days. `incomplete` is the window's: the page adds the status under the figure. */
    tiles: { label: string; value: string; sub: string; incomplete: boolean }[];
    /** The 30 days, oldest first. With no day yet it has no buckets: the page draws no chart. */
    chart: TimeSeriesData;
    /** The same days, newest first. */
    table: DailyRow[];
    notes: string[];
  };
  fees: {
    /** The voting ledger of the record; `null` without one. */
    voteLedger: LedgerLink | null;
    /** Base reserve, owner reserve, base fee; `null` without a record. */
    votes: { setting: string; vote: string }[] | null;
    /** Why the votes have no Now and no Against now (spec 2.7's sentence: S did not load, or has no fees yet), the card's note; `null` when they have them, and without a record. */
    note: string | null;
  };
  votes: {
    /** The voting ledger of the record; `null` when the validator has none. */
    ledger: LedgerLink | null;
    /**
     * D's `amendment_votes.votes[]`, in D's order. `status` is D's status as its pill draws it, for the page to show without A (or for an amendment A does not have): a
     * majority with no moment to count down to, a vote with no share of yes.
     */
    rows: { id: string; label: { text: string; mono: boolean }; href: string; vote: "yes" | "no" | "none"; status: AmendmentStatusView }[];
  };
  summary:
    | {
        state: "ok";
        /** Every publisher of S, in S's order, by its label, with whether its list names the validator. */
        membership: { publisher: string; listed: boolean }[];
        /** The ledger the validator went on the negative UNL in: "On the negative UNL since ledger #N". `null` when S does not have it there. */
        negativeSince: LedgerLink | null;
        /** The fees in force against the three votes (reserve, reserve, base fee); `null` without S's fees or without a vote. */
        now: { now: string; against: "higher" | "lower" | "same" }[] | null;
      }
    | { state: "failed" };
  amendments:
    | {
        state: "ok";
        /** A's view of the status of each voted amendment A has, by ID. */
        status: Record<string, AmendmentStatusView>;
        /** A's `rules.flag_interval`: "Fee votes are counted on flag ledgers, every N ledgers". */
        flagInterval: number;
      }
    | { state: "failed" };
  recent:
    | {
        state: "ok";
        rows: ValidationRowView[];
        paging: Paging;
        /** VV's newest validation, which last seen is when VV loaded (`at` in unix seconds); `null` when there is none. */
        newest: { at: number; ledger: LedgerLink } | null;
      }
    | { state: "failed" };
  /** What the page's `<title>` and description say. `publishers` are D's ids, not labels: the tags word them with `listedByText`, which knows the fixed list by its id. */
  meta: { name: string; publishers: string[]; version: string | null; domain: "verified" | "unverified" | null };
}

/** The older validations behind a `?marker=`: history, with nothing live in it. */
export interface ValidatorHistoryData {
  kind: "history";
  network: NetworkInfo;
  key: string;
  identity: ValidatorIdentity;
  recent: { state: "ok"; rows: ValidationRowView[]; paging: Paging };
}

export type ValidatorPageData = ValidatorLiveData | ValidatorHistoryData;

// ---- The identity (4.1, 4.2) -------------------------------------------------------------------------------------------------------------------

/** The domain D gave, if it gave one (an empty text is none). */
const domainOf = (validator: ValidatorDetail): string | undefined => (validator.domain !== undefined && validator.domain !== "" ? validator.domain : undefined);

function identityOf(network: NetworkInfo, validator: ValidatorDetail): ValidatorIdentity {
  const domain = domainOf(validator);
  const key = validator.validation_public_key;
  return {
    heading: domain !== undefined ? { text: domain, mono: false } : { text: shortHash(key), mono: true },
    domainStatus: domain !== undefined ? (validator.domain_verification?.status ?? null) : null,
    unl: validator.unl,
    unlPublishers: validator.unl_lists.map(publisherLabel),
    listedBy: unlTagWords(validator.unl_lists),
    negativeUnl: validator.negative_unl,
    note: verificationNote(validator.domain_verification, domain, network.software),
    masterKey: key,
  };
}

// ---- The grid (4.1) ----------------------------------------------------------------------------------------------------------------------------

function gridOf(network: NetworkInfo, validator: ValidatorDetail): ValidatorLiveData["grid"] {
  const { manifest } = validator;
  const version = versionText(validator, true);
  const lastSeen = validator.last_seen === undefined ? Number.NaN : unixOf(validator.last_seen);
  const verification = validator.domain_verification;
  return {
    signingKey: validator.signing_key ?? null,
    manifestSequence: manifest === undefined ? null : String(manifest.sequence),
    manifest: manifest === undefined ? null : manifest.signing_keys_seen === 1 ? "one signing key seen" : `${count(manifest.signing_keys_seen)} signing keys seen by the data API`,
    version: version === null ? null : { text: version, latest: validator.version_latest === true },
    firstSeen: validator.first_seen === undefined ? null : `${formatDate(validator.first_seen)} · first seen by the data API`,
    lastSeenFallback: Number.isNaN(lastSeen) ? null : { at: lastSeen, ledger: validator.current_index === undefined ? null : ledgerLink(network.id, validator.current_index) },
    // D1 serves the accounts for a TOML that verified only; an address goes into a link, so nothing an unverified domain says is linked.
    accounts: verification?.status === "verified" ? accountLinks(network.id, verification.accounts) : null,
  };
}

// ---- UNL membership and the fees in force (S) ---------------------------------------------------------------------------------------------------

function summaryOf(network: NetworkInfo, validator: ValidatorDetail, s: ValidatorsSummary): Extract<ValidatorLiveData["summary"], { state: "ok" }> {
  const key = validator.validation_public_key;
  const negative = s.negative_unl.find((member) => member.validation_public_key === key);
  const { fees } = s;
  const vote = validator.fee_vote;
  const against = (now: string, voted: string, text: string) => ({ now: text, against: compareFee(voted, now) });
  return {
    state: "ok",
    membership: s.unl.publishers.map((publisher) => ({ publisher: publisherLabel(publisher.id), listed: validator.unl_lists.includes(publisher.id) })),
    negativeSince: negative === undefined ? null : ledgerLink(network.id, negative.first_ledger),
    now:
      fees === undefined || vote === undefined
        ? null
        : [
            against(fees.reserve_base, vote.reserve_base, nativeText(fees.reserve_base, network.native)),
            against(fees.reserve_inc, vote.reserve_inc, nativeText(fees.reserve_inc, network.native)),
            against(fees.base_fee, vote.base_fee, dropsText(fees.base_fee)),
          ],
  };
}

// ---- Agreement (4.1) ---------------------------------------------------------------------------------------------------------------------------

/** A tile of one window: its score and the ledgers it counted, or the dash and why there is no score. */
function tileOf(label: string, window: Agreement): ValidatorLiveData["agreement"]["tiles"][number] {
  const value = scoreText(window.score);
  return { label, value, sub: value === DASH ? "No validated ledgers counted yet" : ledgersText(window), incomplete: window.incomplete };
}

/** The starts the axis can have, highest first; below the last it starts at 0. */
const AXIS_STARTS = [99, 95, 90, 50] as const;

/**
 * Where the daily agreement's axis starts, in percent: 99 when every scored day is at 99 or more (and when none is scored), else the highest of 95, 90, 50 and 0 at or below the
 * lowest day, so that no day is lost under the axis. `values` are the chart's (a score × 100, 2 decimals) with `null` for a day without one; they are compared exactly.
 */
export function agreementAxisStart(values: readonly (string | null)[]): 99 | 95 | 90 | 50 | 0 {
  const scores = values.flatMap((value) => {
    const score = value === null ? null : new BigNumber(value);
    return score !== null && score.isFinite() ? [score] : [];
  });
  if (scores.length === 0) return 99;
  const lowest = BigNumber.min(...scores);
  return AXIS_STARTS.find((start) => lowest.gte(start)) ?? 0;
}

const AGREEMENT_NOTE = "Share of the validated ledgers this validator signed with the same hash. Partial validations do not count toward agreement.";

/** The 30 days (`days`, oldest first) as the chart, the table and the notes of the card. */
function dailyOf(days: readonly DailyAgreement[], anchor: Anchor): Omit<ValidatorLiveData["agreement"], "tiles"> {
  const values = days.map((day) => scoreValue(day.score));
  const start = agreementAxisStart(values);
  const newest = days[days.length - 1]?.date;
  // The newest day is still running when it is the chain's own UTC day (a clock that is not a time makes no day running).
  const forming = newest !== undefined && Number.isFinite(anchor.closeTime) && newest === utcDayOf(anchor.closeTime);
  const data: Omit<TimeSeriesData, "token"> = {
    axis: { unit: "day", buckets: days.map((day) => day.date) },
    series: [{ id: "agreement", label: "Agreement", slot: 1, values }],
    format: { kind: "percent" },
    domain: { min: String(start) },
    ...(forming && { forming: true }),
    extras: [{ id: "ledgers", label: "Ledgers", tooltip: "value", values: days.map((day) => (day.incomplete ? `${ledgersText(day)} · incomplete` : ledgersText(day))) }],
  };
  const table: DailyRow[] = [...days].reverse().map((day) => ({
    date: day.date,
    day: formatUtcDay(day.date),
    agreement: scoreText(day.score),
    validated: count(day.total),
    missed: count(day.missed),
    partial: count(day.partial),
    complete: day.incomplete ? "no, hours missing" : "yes",
  }));
  const notes = [AGREEMENT_NOTE];
  if (days.some((day) => day.incomplete)) notes.push("Incomplete days are missing some hours of the data API's record.");
  if (days.length > 0) notes.push(`The axis starts at ${start}%.`);
  return { chart: { ...data, token: tokenOf(data) }, table, notes };
}

// ---- Fee votes and amendment votes (4.1) -------------------------------------------------------------------------------------------------------

function feesOf(network: NetworkInfo, vote: FeeVote | undefined, summary: ValidatorsSummary | null): ValidatorLiveData["fees"] {
  if (vote === undefined) return { voteLedger: null, votes: null, note: null };
  return {
    voteLedger: ledgerLink(network.id, vote.ledger_index),
    votes: [
      { setting: "Base reserve", vote: nativeText(vote.reserve_base, network.native) },
      { setting: "Owner reserve", vote: nativeText(vote.reserve_inc, network.native) },
      { setting: "Base fee", vote: dropsText(vote.base_fee) },
    ],
    note: summary === null ? `${feesNotCompared("failed")}.` : summary.fees === undefined ? `${feesNotCompared("unknown")}.` : null,
  };
}

function votesOf(network: NetworkInfo, votes: ValidatorDetail["amendment_votes"]): ValidatorLiveData["votes"] {
  return {
    ledger: votes.ledger_index === undefined ? null : ledgerLink(network.id, votes.ledger_index),
    rows: votes.votes.map((vote) => ({
      id: vote.id,
      label: vote.name !== undefined ? { text: vote.name, mono: false } : { text: shortHash(vote.id), mono: true },
      href: amendmentHref(network.id, amendmentSegment(vote)),
      vote: vote.vote,
      // The view of a row that is D's ID and status alone: no `majority` to count down to, no `votes` to share.
      status: amendmentStatusView({ id: vote.id, status: vote.status }),
    })),
  };
}

/** A's view of the status of each amendment the validator votes on, by ID (an amendment A does not have gets none: the page shows D's). */
function statusesOf(list: AmendmentsList, votes: ValidatorDetail["amendment_votes"]["votes"]): Extract<ValidatorLiveData["amendments"], { state: "ok" }> {
  const rows = new Map(list.amendments.map((row) => [row.id, row]));
  const status: Record<string, AmendmentStatusView> = {};
  for (const vote of votes) {
    const row = rows.get(vote.id);
    if (row !== undefined) status[vote.id] = amendmentStatusView(row);
  }
  return { state: "ok", status, flagInterval: list.rules.flag_interval };
}

// ---- The validations (4.1, 4.5) ----------------------------------------------------------------------------------------------------------------

/** The time of day a validation was signed, `15:42:51`, with its day before it (`Oct 18, `) unless it is `newestDay`. A time that cannot be read is shown as it came. */
function signedText(signingTime: string, newestDay: string | undefined): string {
  const iso = utcMoment(signingTime)?.toISOString();
  if (iso === undefined) return signingTime;
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return day === newestDay ? time : `${formatUtcDay(day)}, ${time}`;
}

function rowsOf(network: NetworkInfo, validations: readonly ValidatorValidation[]): ValidationRowView[] {
  const first = validations[0];
  const newestDay = first === undefined ? undefined : utcMoment(first.signing_time)?.toISOString().slice(0, 10);
  return validations.map((validation) => ({
    key: `${validation.ledger_index}:${validation.ledger_hash}`,
    ledger: ledgerLink(network.id, validation.ledger_index),
    hash: shortHash(validation.ledger_hash),
    signed: signedText(validation.signing_time, newestDay),
    full: validation.full,
    validated: validation.validated,
    ...(validation.validated === "different" && validation.validated_hash !== undefined && { validatedShort: shortHash(validation.validated_hash) }),
  }));
}

/** The Newer and Older links of a page of the validator's validations (`trailPaging`, written as the validator page's URLs). */
function pagingOf(network: NetworkInfo, key: string, page: { marker?: string; back: readonly string[] }, next: string | undefined): Paging {
  return trailPaging({ ...page, next }, (to) => validatorHref(network.id, key, to));
}

function recentOf(network: NetworkInfo, key: string, page: ValidatorValidationsPage): Extract<ValidatorLiveData["recent"], { state: "ok" }> {
  const first = page.validations[0];
  const at = first === undefined ? Number.NaN : unixOf(first.first_datetime);
  return {
    state: "ok",
    rows: rowsOf(network, page.validations),
    paging: pagingOf(network, key, { back: [] }, page.marker),
    newest: first === undefined || Number.isNaN(at) ? null : { at, ledger: ledgerLink(network.id, first.ledger_index) },
  };
}

// ---- The pages ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The validator page (spec 4.1). `validator` is D's answer for the master key; `anchor` is the chain's newest validated ledger, which says whether the newest day of the daily
 * agreement is still running. Each of `recent` (VV), `summary` (S) and `amendments` (A) is a part that stands or fails on its own; `missing` is a failure to this page.
 */
export function validatorPage(input: {
  network: NetworkInfo;
  validator: ValidatorDetail;
  recent: Loaded<ValidatorValidationsPage>;
  summary: Loaded<ValidatorsSummary>;
  amendments: Loaded<AmendmentsList>;
  anchor: Anchor;
}): ValidatorLiveData {
  const { network, validator, anchor } = input;
  const key = validator.validation_public_key;
  const identity = identityOf(network, validator);
  const recent = valueOf(input.recent);
  const summary = valueOf(input.summary);
  const amendments = valueOf(input.amendments);
  const { domainStatus } = identity;
  return {
    kind: "live",
    network,
    key,
    identity,
    grid: gridOf(network, validator),
    agreement: {
      tiles: [tileOf("Agreement, 1 h", validator.agreement_1h), tileOf("Agreement, 24 h", validator.agreement_24h), tileOf("Agreement, 30 days", validator.agreement_30d)],
      ...dailyOf(validator.daily_agreement, anchor),
    },
    fees: feesOf(network, validator.fee_vote, summary),
    votes: votesOf(network, validator.amendment_votes),
    summary: summary === null ? { state: "failed" } : summaryOf(network, validator, summary),
    amendments: amendments === null ? { state: "failed" } : statusesOf(amendments, validator.amendment_votes.votes),
    recent: recent === null ? { state: "failed" } : recentOf(network, key, recent),
    meta: {
      name: identity.heading.text,
      publishers: [...validator.unl_lists],
      version: versionText(validator, false),
      domain: domainStatus === "verified" ? "verified" : domainStatus === "unverified" ? "unverified" : null,
    },
  };
}

/**
 * The older validations behind a `?marker=` (spec 4.5): the identity, and the page of validations the marker names. `back` is the trail of the pages newer than this one
 * (`parseTrail`), nearest first; Newer goes to the one before, and Older remembers this one.
 */
export function validatorHistoryPage(input: {
  network: NetworkInfo;
  validator: ValidatorDetail;
  recent: ValidatorValidationsPage;
  marker: string;
  back: readonly string[];
}): ValidatorHistoryData {
  const { network, validator, recent, marker, back } = input;
  const key = validator.validation_public_key;
  return {
    kind: "history",
    network,
    key,
    identity: identityOf(network, validator),
    recent: { state: "ok", rows: rowsOf(network, recent.validations), paging: pagingOf(network, key, { marker, back }, recent.marker) },
  };
}
