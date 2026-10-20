// What the validators list shows, worked out in the Worker from the data API's three answers (spec 3.1, 3.2 and 9.1): the intro, the publisher notices, the six tiles of the
// network overview, the share bar and table of the software versions, the filtered rows with their counts and footer, and the options of the two selects. `validatorsPage`
// is pure: no I/O, no clock, no `Intl`. Every text is made from D1's exact strings (validator-facts.ts: `bignumber.js`), and the numbers of the API that are counts become
// text with `count` (validator-facts.ts: `formatAmount(String(n))`), so no float reaches a string of the page. Each of S (the summary), L (the list) and A (the amendments)
// stands or fails on its own: a part that did not load is `{ state: "failed" }` (a `missing` answer is the same to this page), and what only adds context to another part
// (a publisher's name, a fee arrow, a negative UNL validator's domain) is left out of it, with a note where the page would otherwise say less than it seems to.

import { amendmentSegment } from "../domain/amendment-ref";
import { amendmentHref, amendmentsHref } from "../domain/amendments-params";
import { fnv1a32, tokenOf } from "../domain/fnv";
import { shortHash } from "../domain/format";
import { formatDate } from "../domain/time-words";
import { validatorHref, validatorsHref, type ValidatorsParams } from "../domain/validators-params";
import type { ShareData, Slot } from "../ui/charts/types";
import type { NetworkInfo } from "../ui/networks";
import type { Loaded } from "./account-view";
import type { AmendmentRow, AmendmentsList, NativeFees, NegativeUnlMember, NextFlagLedger, UnlPublisher, ValidatorRow, ValidatorsList, ValidatorsSummary } from "./api-types";
import {
  clock,
  compareFee,
  count,
  DASH,
  dropsText,
  joinAnd,
  nativeText,
  scoreText,
  shareText,
  unixOf,
  valueOf,
  versionText,
  yesPercentText,
  type DomainStatusKind,
  type TextPart,
} from "./validator-facts";

/** A value for a `<select>`: the canonical parameter, and what the option says. */
export interface Option {
  value: string;
  label: string;
}

/** A tile of the network overview. `value` is `—` and `sub` says why when the summary has left its figure out. */
export interface Tile {
  label: string;
  value: string;
  sub: TextPart[];
}

/** The colour slot of a version that is drawn by name: 1 to 4. */
export type VersionSlot = 1 | 2 | 3 | 4;

/** A row of the versions table: a version of S (or "Unknown"), its swatch (its own slot, or `"other"` when it is older than the four shown or unknown), and its counts and shares. */
export interface VersionRow {
  version: string;
  slot: VersionSlot | "other";
  unl: string;
  unlShare: string;
  all: string;
  allShare: string;
}

/** One of a validator's three fee votes, in the units of the column (XRP, XRP, drops), and how it compares with the fee in force: absent when the page cannot compare. */
export interface FeeCell {
  text: string;
  against?: "higher" | "lower" | "same";
}

/** A row of the validators table: the strings and the paths of §3.1's columns. The row's key is `validation_public_key`. */
export interface ValidatorRowView {
  validation_public_key: string;
  /** The domain, or the short master key in mono. */
  name: { text: string; mono: boolean };
  href: string;
  /** The short master key beneath a domain, or `no domain`. */
  sub: string;
  /** `null` when the row has no domain, or the data API sent no check of it. */
  domainStatus: DomainStatusKind | null;
  unl: boolean;
  /** The publishers whose lists name the validator (the hidden words of the UNL tag). */
  unlPublishers: string[];
  negativeUnl: boolean;
  /** `—` for a validator that reported none. */
  version: { text: string; latest: boolean };
  agreement: { text: string; incomplete: boolean };
  /** Base reserve, owner reserve, base fee; `null` for a validator with no fee vote on record. */
  fees: FeeCell[] | null;
  /** The amendments it votes yes for, each a link to its page. */
  yes: { label: string; href: string }[];
  /** Unix seconds; `null` for a validator never seen. */
  lastSeen: number | null;
}

export interface ValidatorsPageData {
  network: NetworkInfo;
  params: ValidatorsParams;
  hrefs: { amendments: string; action: string; scope: { unl: string; all: string }; clear: string | null };
  intro: TextPart[];
  summary:
    | {
        state: "ok";
        notices: string[];
        tiles: Tile[];
        versions: { chart: ShareData; table: VersionRow[]; notes: string[] };
        /** S's ids for the "Listed by" select; `null` with fewer than two publishers, when there is nothing to choose. */
        publishers: Option[] | null;
      }
    | { state: "failed" };
  list: { state: "ok"; counts: { unl: number; all: number }; rows: ValidatorRowView[]; footer: string[]; empty: boolean } | { state: "failed" };
  amendments: { state: "ok"; options: Option[] } | { state: "failed" };
}

// ---- Version slots (3.2) -------------------------------------------------------------------------------------------------------------------------

/** How many versions are drawn by name; every older one, and the validators that report none, are "Other". */
const SHOWN_VERSIONS = 4;

/**
 * The colour slot of each of the four newest versions (`newestFirst` is S's `versions[]`, which D1 lists newest first), 1 to 4. A version's own slot is 1 + (FNV-1a of its text
 * mod 4); the slots are given from the oldest of the four to the newest, each its own when it is free, else the next free one after it (1 → 2 → 3 → 4 → 1). So a colour follows
 * its version while newer releases arrive and older ones leave: a newer release that hashes to a slot in use moves, not the older one. A colour changes only when the version that
 * once moved it leaves the four. The same text has the same slot on both networks and in every scope. The map is in the order of `newestFirst`.
 */
export function versionSlots(newestFirst: readonly string[]): Map<string, VersionSlot> {
  const shown = [...new Set(newestFirst)].slice(0, SHOWN_VERSIONS);
  const taken = new Set<number>();
  const slots = new Map<string, VersionSlot>();
  for (const version of [...shown].reverse()) {
    let slot = 1 + (fnv1a32(version) % 4);
    while (taken.has(slot)) slot = (slot % 4) + 1; // four versions and four slots: one is always free
    taken.add(slot);
    slots.set(version, slot as VersionSlot);
  }
  return new Map(shown.map((version) => [version, slots.get(version)!]));
}

// ---- The summary: notices, tiles, versions ---------------------------------------------------------------------------------------------------

/** What a tile says in place of a figure the summary has left out (D1 leaves a key out while nothing gives it). */
const NOT_KNOWN = "not known yet";

/** A notice for each publisher whose list is not current, and one more when none of them is (D1 §7). */
function noticesOf(publishers: readonly UnlPublisher[]): string[] {
  const notices: string[] = [];
  for (const publisher of publishers) {
    if (publisher.status === "expired") {
      notices.push(
        publisher.expiration === undefined
          ? `${publisher.id}'s list has expired. The data API still uses it, as a node would rather use an old list than none.`
          : `${publisher.id}'s list expired on ${formatDate(publisher.expiration)}. The data API still uses it, as a node would rather use an old list than none.`,
      );
    } else if (publisher.status === "unavailable") {
      notices.push(`${publisher.id} has not been fetched yet${publisher.last_error ? ` (${publisher.last_error})` : ""}.`);
    }
  }
  if (publishers.length > 0 && publishers.every((publisher) => publisher.status === "unavailable")) notices.push("No validator is trusted until one is.");
  return notices;
}

/** A link to a validator's page named by its domain in L, else by its short key in mono. */
function validatorLink(net: string, rows: ReadonlyMap<string, ValidatorRow>): (key: string) => TextPart {
  return (key) => {
    const domain = rows.get(key)?.domain;
    const href = validatorHref(net, key);
    return domain !== undefined && domain !== "" ? { text: domain, href } : { text: shortHash(key), href, mono: true };
  };
}

/** The sub of the Negative UNL tile: up to three names, each a link, then "and N more"; and what is about to change at the next flag ledger. */
function negativeUnlSub(members: readonly NegativeUnlMember[], pending: ValidatorsSummary["negative_unl_pending"], link: (key: string) => TextPart): TextPart[] {
  const sub: TextPart[] = [];
  if (members.length === 0) {
    sub.push("no validator discounted");
  } else {
    const named = members.slice(0, 3);
    const more = members.length - named.length;
    named.forEach((member, index) => {
      sub.push(link(member.validation_public_key));
      if (index < named.length - 1) sub.push(index === named.length - 2 && more === 0 ? " and " : ", ");
    });
    if (more > 0) sub.push(` and ${count(more)} more`);
    sub.push(members.length === 1 ? " is discounted while it is offline" : " are discounted while they are offline");
  }
  const changes: TextPart[][] = [];
  if (pending?.to_disable !== undefined) changes.push([link(pending.to_disable), " to be disabled"]);
  if (pending?.to_reenable !== undefined) changes.push([link(pending.to_reenable), " to be re-enabled"]);
  if (changes.length > 0) {
    sub.push(" · ");
    changes.forEach((change, index) => sub.push(...(index === 0 ? change : [" and ", ...change])));
    sub.push(" at the next flag ledger");
  }
  return sub;
}

/** A `nativeText` or `dropsText` without its unit (`1 XRP` is `1`, `12 drops` is `12`): the cells of the fee column say the units once, in the footer. */
const bare = (text: string): string => (text === DASH ? text : text.slice(0, text.lastIndexOf(" ")));

const COUNTED = "fee and amendment votes are counted there";

function reservesTile(native: string, fees: NativeFees | undefined): Tile {
  const label = "Base / owner reserve";
  if (fees === undefined) return { label, value: DASH, sub: [NOT_KNOWN] };
  const base = nativeText(fees.reserve_base, native);
  const owner = nativeText(fees.reserve_inc, native);
  return { label, value: base === DASH || owner === DASH ? DASH : `${bare(base)} / ${owner}`, sub: [`base fee ${dropsText(fees.base_fee)}`] };
}

function flagTile(flag: NextFlagLedger | undefined): Tile {
  const label = "Next flag ledger";
  if (flag === undefined) return { label, value: DASH, sub: [NOT_KNOWN] };
  const at = flag.expected === undefined ? Number.NaN : unixOf(flag.expected);
  // The ledger is an estimate in time: the countdown is `approx`. Without a time (the mean ledger interval is not known yet) there is none to draw.
  const sub: TextPart[] = Number.isNaN(at)
    ? [COUNTED]
    : [{ countdown: { at, fallback: `expected ${clock(at)} UTC`, past: "due now", approx: true } }, ` · ${COUNTED}`];
  return { label, value: `#${count(flag.ledger_index)}`, sub };
}

function tilesOf(net: NetworkInfo, s: ValidatorsSummary, rows: ReadonlyMap<string, ValidatorRow>): Tile[] {
  const { seen_24h, unl_seen_24h, others_seen_24h } = s.validators;
  const publishers = s.unl.publishers.map((publisher) => publisher.id);
  const { quorum } = s;
  const nodeQuorum = quorum.node !== undefined && quorum.node !== quorum.value ? ` · the node reports ${count(quorum.node)}` : "";
  return [
    {
      label: "Validators seen, last 24 h",
      value: count(seen_24h),
      sub: [`${count(unl_seen_24h)} on the default UNL, ${count(others_seen_24h)} other${others_seen_24h === 1 ? "" : "s"}`],
    },
    {
      label: "On the default UNL",
      value: `${count(unl_seen_24h)} / ${count(s.unl.trusted)}`,
      sub: [`seen in 24 h, of those listed${publishers.length > 0 ? ` by ${joinAnd(publishers)}` : ""}`],
    },
    { label: "Quorum", value: `${count(quorum.value)} of ${count(quorum.unl_size)}`, sub: [`validations a ledger needs${nodeQuorum}`] },
    { label: "Negative UNL", value: count(s.negative_unl.length), sub: negativeUnlSub(s.negative_unl, s.negative_unl_pending, validatorLink(net.id, rows)) },
    reservesTile(net.native, s.fees),
    flagTile(s.next_flag_ledger),
  ];
}

/** The versions' bar, table and notes (3.1, 3.2). The four newest versions of S are drawn by name, newest first; "Other" is every older one and the validators that report none. */
function versionsOf(s: ValidatorsSummary): { chart: ShareData; table: VersionRow[]; notes: string[] } {
  const { versions, versions_unknown: unknown } = s;
  const slots = versionSlots(versions.map((v) => v.version));
  const shown = versions.slice(0, SHOWN_VERSIONS);
  const older = versions.slice(SHOWN_VERSIONS);
  const slotOf = (version: string): VersionSlot | "other" => slots.get(version) ?? "other";

  const sum = (of: "unl" | "all"): number => versions.reduce((n, v) => n + v[of], 0) + unknown[of];
  const row = (id: string, label: string, of: "unl" | "all"): ShareData["rows"][number] => {
    const segments: { id: string; label: string; slot: Slot; value: string }[] = shown.map((v) => ({ id: v.version, label: v.version, slot: slotOf(v.version), value: String(v[of]) }));
    const other = older.reduce((n, v) => n + v[of], 0) + unknown[of];
    if (other > 0) segments.push({ id: "other", label: "Other", slot: "other", value: String(other) });
    return { id, label, total: String(sum(of)), segments };
  };
  const rows = [row("unl", "UNL", "unl"), row("all", "All", "all")];
  const chart: ShareData = { rows, token: tokenOf({ rows }) };

  // One row for each version of S, then the validators that report none; those older than the four shown (and the unknown ones) have the swatch of "Other".
  const totals = { unl: sum("unl"), all: sum("all") };
  const entries = [
    ...versions.map((v) => ({ version: v.version, slot: slotOf(v.version), unl: v.unl, all: v.all })),
    { version: "Unknown", slot: "other" as const, unl: unknown.unl, all: unknown.all },
  ];
  const table: VersionRow[] = entries.map((v) => ({
    version: v.version,
    slot: v.slot,
    unl: count(v.unl),
    unlShare: shareText(v.unl, totals.unl),
    all: count(v.all),
    allShare: shareText(v.all, totals.all),
  }));

  const notes = ["Each validator's version as it reports it in its validations."];
  if (versions.length > SHOWN_VERSIONS) notes.push(`“Other” groups releases older than ${shown[SHOWN_VERSIONS - 1]!.version} and validators whose version is not known.`);
  else if (unknown.unl + unknown.all > 0) notes.push("“Other” is the validators whose version is not known.");
  if (s.latest_version !== undefined) notes.push(`Latest release on the UNL: ${s.latest_version}.`);
  return { chart, table, notes };
}

function summaryOf(net: NetworkInfo, s: ValidatorsSummary, rows: ReadonlyMap<string, ValidatorRow>): Extract<ValidatorsPageData["summary"], { state: "ok" }> {
  const { publishers } = s.unl;
  return {
    state: "ok",
    notices: noticesOf(publishers),
    tiles: tilesOf(net, s, rows),
    versions: versionsOf(s),
    publishers: publishers.length >= 2 ? publishers.map((publisher) => ({ value: publisher.id, label: publisher.id })) : null,
  };
}

// ---- The list --------------------------------------------------------------------------------------------------------------------------------

/** Whether the view is narrowed by more than its scope: the footer says "matches" and the card offers "Clear filters". */
const hasFilter = (params: ValidatorsParams): boolean => params.publisher !== undefined || params.amendment !== undefined || params.q !== undefined;

/** The check a row must pass to be one that votes yes for the amendment `param` names: its ID from A when A has it, else `param` as given, matched against `yes[].id` and `yes[].name`. */
function votesYesFor(param: string, amendments: readonly AmendmentRow[] | null): (row: ValidatorRow) => boolean {
  const named = amendments?.find((amendment) => amendment.id === param || amendmentSegment(amendment) === param);
  return (row) => (row.amendment_votes?.yes ?? []).some((yes) => (named !== undefined ? yes.id === named.id : yes.id === param || yes.name === param));
}

/** The rows the view keeps, in D1's order: the scope, then the publisher, the amendment and the search (D1's `q`: the lower-cased text in the domain or a key). */
function filtered(rows: readonly ValidatorRow[], params: ValidatorsParams, amendments: readonly AmendmentRow[] | null): ValidatorRow[] {
  const { publisher, amendment } = params;
  const q = params.q?.toLowerCase();
  const yes = amendment === undefined ? null : votesYesFor(amendment, amendments);
  return rows.filter(
    (row) =>
      (params.scope === "all" || row.unl) &&
      (publisher === undefined || row.unl_lists.includes(publisher)) &&
      (yes === null || yes(row)) &&
      (q === undefined || [row.domain, row.validation_public_key, row.signing_key].some((text) => text?.toLowerCase().includes(q))),
  );
}

/** A fee vote's three cells, against the fees in force when S gave them. */
function feeCells(vote: NonNullable<ValidatorRow["fee_vote"]>, fees: NativeFees | null, native: string): FeeCell[] {
  const cell = (text: string, voted: string, now: string | undefined): FeeCell => (fees === null || now === undefined ? { text } : { text, against: compareFee(voted, now) });
  return [
    cell(bare(nativeText(vote.reserve_base, native)), vote.reserve_base, fees?.reserve_base),
    cell(bare(nativeText(vote.reserve_inc, native)), vote.reserve_inc, fees?.reserve_inc),
    cell(bare(dropsText(vote.base_fee)), vote.base_fee, fees?.base_fee),
  ];
}

function rowView(net: NetworkInfo, row: ValidatorRow, fees: NativeFees | null): ValidatorRowView {
  const key = row.validation_public_key;
  const domain = row.domain !== undefined && row.domain !== "" ? row.domain : undefined;
  const seen = row.last_seen === undefined ? Number.NaN : unixOf(row.last_seen);
  return {
    validation_public_key: key,
    name: domain !== undefined ? { text: domain, mono: false } : { text: shortHash(key), mono: true },
    href: validatorHref(net.id, key),
    sub: domain !== undefined ? shortHash(key) : "no domain",
    domainStatus: domain !== undefined ? (row.domain_verification?.status ?? null) : null,
    unl: row.unl,
    unlPublishers: row.unl_lists,
    negativeUnl: row.negative_unl,
    version: { text: versionText(row, false) ?? DASH, latest: row.version_latest === true },
    agreement: { text: scoreText(row.agreement_24h.score), incomplete: row.agreement_24h.incomplete },
    fees: row.fee_vote === undefined ? null : feeCells(row.fee_vote, fees, net.native),
    yes: (row.amendment_votes?.yes ?? []).map((yes) => ({ label: yes.name ?? shortHash(yes.id), href: amendmentHref(net.id, amendmentSegment(yes)) })),
    lastSeen: Number.isNaN(seen) ? null : seen,
  };
}

/** The card's footer: how many are shown, the order, the units of the fee column, and what is missing from it. */
function footerOf(net: NetworkInfo, shown: number, hasFilter: boolean, summary: ValidatorsSummary | null, marker: boolean): string[] {
  const noun = hasFilter ? (shown === 1 ? "match" : "matches") : shown === 1 ? "validator" : "validators";
  const footer = [`${count(shown)} ${noun}`, "in the order of their domain, then their key"];
  const units = `Fee votes in ${net.native} / ${net.native} / drops`;
  if (summary?.fees !== undefined) footer.push(`${units}; ↑ ↓ against the current value`);
  else footer.push(units, `Fee votes are not compared with the current fees: ${summary === null ? "they could not be loaded" : "they are not known yet"}`);
  if (marker) footer.push("The first 1,000 validators in this order are shown.");
  return footer;
}

function listOf(
  net: NetworkInfo,
  params: ValidatorsParams,
  list: ValidatorsList,
  summary: ValidatorsSummary | null,
  amendments: readonly AmendmentRow[] | null,
): Extract<ValidatorsPageData["list"], { state: "ok" }> {
  const all = list.validators;
  const kept = filtered(all, params, amendments);
  const fees = summary?.fees ?? null;
  return {
    state: "ok",
    counts: { unl: all.filter((row) => row.unl).length, all: all.length },
    rows: kept.map((row) => rowView(net, row, fees)),
    footer: footerOf(net, kept.length, hasFilter(params), summary, list.marker !== undefined),
    empty: kept.length === 0,
  };
}

// ---- The options of "Votes yes for" --------------------------------------------------------------------------------------------------------------

/** The amendments being decided, in A's order: `majority`, `voting` and `unknown`, each by its canonical parameter, labelled with its name (else its short ID) and its share of yes. */
function amendmentOptions(list: AmendmentsList): Option[] {
  return list.amendments
    .filter((amendment) => amendment.status === "majority" || amendment.status === "voting" || amendment.status === "unknown")
    .map((amendment) => ({
      value: amendmentSegment(amendment),
      label: `${amendment.name ?? shortHash(amendment.id)} · ${amendment.votes === undefined ? DASH : yesPercentText(amendment.votes.yes, amendment.votes.trusted)}`,
    }));
}

// ---- The page ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The validators list (spec 3.1 and 3.2). `params` is the view the loader has made canonical: with S or A failed it holds the `publisher` or `amendment` the visitor gave, and
 * those are applied as given. Every matching row is on the page, in D1's order (the list's first 1,000; L is asked with `limit=1000`, and a `marker` is noted in the footer).
 */
export function validatorsPage(input: {
  network: NetworkInfo;
  params: ValidatorsParams;
  summary: Loaded<ValidatorsSummary>;
  list: Loaded<ValidatorsList>;
  amendments: Loaded<AmendmentsList>;
}): ValidatorsPageData {
  const { network, params } = input;
  const summary = valueOf(input.summary);
  const list = valueOf(input.list);
  const amendments = valueOf(input.amendments);
  const net = network.id;

  // The publishers are S's; without S the intro does not name them.
  const publishers = summary?.unl.publishers.map((publisher) => publisher.id) ?? [];
  const publishedBy = publishers.length > 0 ? `, published by ${joinAnd(publishers)}` : "";
  const intro = [
    `The default UNL is the list of validators ${network.software} trusts out of the box${publishedBy}. All adds every other validator whose validations reached the data API in the last 24 hours.`,
  ];

  return {
    network,
    params,
    hrefs: {
      amendments: amendmentsHref(net, {}),
      action: validatorsHref(net, { scope: "unl" }),
      scope: { unl: validatorsHref(net, { ...params, scope: "unl" }), all: validatorsHref(net, { ...params, scope: "all" }) },
      clear: hasFilter(params) ? validatorsHref(net, { scope: params.scope }) : null,
    },
    intro,
    summary: summary === null ? { state: "failed" } : summaryOf(network, summary, new Map((list?.validators ?? []).map((row) => [row.validation_public_key, row]))),
    list: list === null ? { state: "failed" } : listOf(network, params, list, summary, amendments?.amendments ?? null),
    amendments: amendments === null ? { state: "failed" } : { state: "ok", options: amendmentOptions(amendments) },
  };
}
