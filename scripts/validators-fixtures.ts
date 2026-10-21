// The data API's answers for the validators and amendments pages (E6 spec, "Testing", "Fixtures"): D1's six routes, `GET /v2/network/validators/summary`, the list
// (`?limit=1000&scope=all`), a validator (`/{key}`), its validations (`/{key}/validations?limit=20`), the amendments and one amendment (`/{name}`). D1 builds them from
// weeks of collected validations, votes and domain checks, so nothing can be recorded: they are synthetic, drawn from streams seeded with `seedOf(net, route)`
// (synthetic.ts), so `pnpm fixtures:sync` writes the same bytes every time. http-fixtures.ts calls `validatorsFixtures` for each network after `networkFixtures`,
// with the ledger validations that gave it (in memory, never read back from the disk), and writes every answer with a row of a list to a line
// (`VALIDATORS_ROW_LISTS`). test/fixtures/PROVENANCE.md, "Synthetic validators and amendments", says what they follow.
//
// They follow data-api-new's docs/api-reference.md at `feat/explorer-data` 7d495ab ("Validators and amendments"): the shapes, the key orders (every object is built
// in the reference's order; the files sort their keys, as every generated fixture does) and the rules that tie one figure to another, as D1's own builders apply them:
//   - The fleet (`FLEETS`): the validators of the given ledger validations first, in the order they were first seen (so the network page's first-seen keys have pages),
//     then seeded ones (`0xED` and 32 bytes, signing keys `0x02`/`0x03` and 32), with every case the pages draw. Domains are `*.example` (RFC 2606): no real operator is
//     implied. The publishers are the data API's own (`unl.xrplf.org`, `vl.ripple.com`; `vl.xahau.org`), with seeded keys.
//   - The list is in D1's order (domain first, by domain in lower case, then by key); the summary's counts, versions, publishers and quorum are counted from its rows.
//   - Agreement: hourly rows over 720 hours ending with the newest final hour, half an hour before the newest ledger; one hour of them has no final record, so the
//     30-day window and its day are incomplete for every validator, as D1's `incomplete` is the window's, not the validator's.
//   - The amendments are real names with `id = SHA-512Half(name)`; their statuses, votes, dates and metadata are made up. `needed`, `passes` and `pct` are D1's F7,
//     the list is in D1's order, and every amendment answer starts with the list's envelope (G3). The rounds are voting ledgers (255 mod 256), oldest first; the
//     majority on XRPL has 30 days of them, the others 3 (the spec's "deployment that has run three days"). An enabled amendment has none: it was enabled before them.
//   - Times are D1's three forms: instants of receipt `…:ss.SSSZ`, ledger times `…:ssZ` (a ledger closes every 3.9 s on XRPL, 4 s on Xahau, E2's figures), days.
// Only integer arithmetic and the four IEEE operations are used on the numbers, BigNumber for the decimals (`score`, `pct`), so every Node writes the same bytes.

import { createHash } from "node:crypto";

import BigNumber from "bignumber.js";
import { encodeAccountID, encodeNodePublic } from "ripple-address-codec";

import type { AmendmentStatus } from "../app/domain/amendments-params";
import type {
  Agreement,
  AmendmentDetail,
  AmendmentHistoryEvent,
  AmendmentRoundPoint,
  AmendmentRow,
  AmendmentsEnvelope,
  AmendmentsList,
  AmendmentVote,
  DailyAgreement,
  DomainVerification,
  LastValidated,
  LedgerValidations,
  NativeFees,
  NextFlagLedger,
  UnlPublisher,
  ValidatorDetail,
  ValidatorRow,
  ValidatorsList,
  ValidatorsSummary,
  ValidatorValidation,
  ValidatorValidationsPage,
  ValidatorVote,
  VersionCount,
  YesEntry,
} from "../app/server/api-types";
import type { NetworkName } from "../test/support/upstream-core";
import type { FixtureFile } from "./network-fixtures";
import { mulberry32, seedOf } from "./synthetic";

const DAY = 86_400;
const HOUR = 3_600;
const FLAG_INTERVAL = 256;
const THRESHOLD_PERCENT = 80;
/** The rows of a page of validations: the explorer asks for 20. */
const PAGE = 20;
/** `validated` of a row of validations. */
type Validated = ValidatorValidation["validated"];

/**
 * The lists whose rows the files write one to a line (fixtureText's `rowLists`): the list's validators, the summary's versions and negative UNL, a validator's
 * days and validations, the amendments, and an amendment's votes, rounds and history.
 */
export const VALIDATORS_ROW_LISTS: readonly string[] = [
  "validators",
  "versions",
  "negative_unl",
  "daily_agreement",
  "validations",
  "amendments",
  "unl_votes",
  "other_votes",
  "rounds",
  "history",
];

/** SHA-512Half: the first 32 bytes of the SHA-512 of `text` (UTF-8), as 64 upper-case hex digits. */
export function sha512Half(text: string): string {
  return createHash("sha512").update(text, "utf8").digest("hex").slice(0, 64).toUpperCase();
}

/** An amendment's ID: the SHA-512Half of its name (D1 F9, rippled's `amendmentId`). */
export const amendmentId = (name: string): string => sha512Half(name);

// ---- What each network looks like ------------------------------------------------------------------------------------

/** A reason D1 gives for a domain that does not verify (spec 4.2). */
type Reason =
  | "not_listed"
  | "toml_invalid"
  | "too_large"
  | "http_status"
  | "dns_error"
  | "connect_error"
  | "tls_error"
  | "timeout"
  | "redirect_rejected"
  | "blocked_address"
  | "domain_invalid"
  | "manifest_unverified";

/** A place in the fleet: what one validator is, every field at its default unless the case it stands for says otherwise. */
interface Role {
  /** On the trusted UNL. */
  unl?: true;
  /** The publishers whose lists name it, by their place in `publishers`; a member of the UNL is on all of them unless it says. */
  lists?: number[];
  /** What the check of its domain says: verified (the default), verified with `[[ACCOUNTS]]` (G1), pending, a reason; `null` for no domain. */
  domain?: "verified" | "accounts" | "pending" | Reason | null;
  /**
   * When it was seen. Undefined (the default): it validated the newest ledger, and may be one of the given validators. `never`: a member of the UNL never seen.
   * `away`: last seen 5 hours ago. `new`: first seen 20 minutes ago, after the newest final hour of agreement.
   */
  seen?: "never" | "away" | "new";
  /** First seen this many days ago (by default months ago, before the 30 days of agreement). */
  joined?: number;
  /** On the negative UNL since 2 days ago, about to be re-enabled; offline from 3 days to 6 hours ago. */
  negative?: true;
  /** No vote record: no fee vote, no amendment votes. */
  noRecord?: true;
  /** Its fee vote: a higher reserve, or a lower owner reserve, than the fees in force. */
  fee?: "higher" | "lower";
  /** Its version: the network's newest release by default; `null` when it reported none; `unrecognised` for a number that is no version. */
  version?: string | null;
  /** Its newest validation was partial. */
  partial?: true;
  /** Its validations have a second page (the one `?marker=` page of the network). */
  marker?: true;
  /** D answers its signing key too (the one signing-key file of the network). */
  signingFile?: true;
  /** Signing keys seen for it (1 by default). */
  rotated?: number;
}

const repeat = (count: number, role: Role): Role[] => Array.from({ length: count }, () => role);

/** An amendment of the network: its metadata, and what makes its figures. */
interface AmendmentSpec {
  /** The name of the metadata file; none for the amendment the node lists without one. */
  name?: string;
  status: AmendmentStatus;
  introduced?: string;
  xls?: string;
  xls_url?: string;
  description?: string;
  /** What the node says of it (`node_supported`), when it lists it. */
  node?: boolean;
  retired?: true;
  /** The yes votes of the trusted UNL in the newest round, for one that is being decided. */
  yes?: number;
  /** The days of rounds its answer holds, for one that is not enabled. */
  days?: number;
  /** How it has its majority: got, lost and got again in its 30 days, the transactions indexed; or got 4 days ago, before the indexed history (G5). */
  majority?: "got-lost-got" | "before-history";
  /** How it was enabled: by an indexed EnableAmendment so many days ago, or as the metadata file says. */
  enabled?: { daysAgo: number } | { date?: string; ledger_index?: number };
}

interface Profile {
  software: "rippled" | "xahaud";
  /** Tenths of a second per ledger, the mean interval: E2's synthetic networks close a ledger every 3.9 s on XRPL and every 4 s on Xahau (network-fixtures.ts). */
  tenths: number;
  /** The file the domains are checked at. */
  toml: string;
  holdSeconds: number;
  /** The publishers of the UNL, by id (D1 lists them sorted). */
  publishers: Array<{ id: string; sequence: number; version: number; expiresInDays: number }>;
  /** The fees in force, in whole units. */
  fees: NativeFees;
  /** The node reports the quorum it uses (`quorum.node`); a public node reports none. */
  nodeQuorum: boolean;
  /** The newest release, which most of the fleet runs. */
  latest: string;
  /** Xahau's build numbers, by version. */
  builds?: Record<string, number>;
  fleet: Role[];
  amendments: AmendmentSpec[];
}

const STANDARDS = "https://github.com/XRPLF/XRPL-Standards/tree/master/";
const FEES: NativeFees = { base_fee: "0.00001", reserve_base: "1", reserve_inc: "0.2" };

/**
 * The validators of each network: the trusted UNL (XRPL 35, Xahau 31) and the others seen in 24 hours (25 and 10), each case of the pages once at least: verified
 * (and with accounts), every reason of spec 4.2, pending, no domain; on two lists, on one, on none; on the negative UNL; never seen; no record, a higher and a lower
 * fee vote; an old version (an amendment it lacks), a release candidate, none, an unrecognised one; partial; a second page of validations; a signing-key file.
 */
const FLEETS: Record<NetworkName, Role[]> = {
  xrpl: [
    { unl: true, domain: "accounts" },
    { unl: true, marker: true },
    { unl: true, signingFile: true, rotated: 2 },
    { unl: true, negative: true },
    { unl: true, domain: null, seen: "never", noRecord: true, version: null },
    { unl: true, lists: [0] },
    { unl: true, lists: [1] },
    { unl: true, fee: "higher" },
    { unl: true, fee: "lower" },
    { unl: true, domain: "not_listed" },
    { unl: true, domain: "http_status" },
    { unl: true, domain: "dns_error" },
    { unl: true, domain: "timeout" },
    { unl: true, domain: "pending" },
    { unl: true, domain: null },
    { unl: true, domain: null, rotated: 3 },
    ...repeat(4, { unl: true, version: "3.4.0" }),
    { unl: true, version: "3.3.2" },
    ...repeat(14, { unl: true }),
    { domain: "toml_invalid" },
    { domain: "too_large" },
    { domain: "connect_error" },
    { domain: "tls_error" },
    { domain: "redirect_rejected" },
    { domain: "blocked_address" },
    { domain: "domain_invalid" },
    { domain: "manifest_unverified" },
    { domain: "pending" },
    { domain: null, noRecord: true },
    { domain: null, seen: "away" },
    { domain: null, seen: "new" },
    { joined: 10 },
    { version: "3.5.0-rc1", partial: true },
    { version: "3.5.0-rc1", domain: null },
    { version: "unrecognised" },
    { version: null },
    ...repeat(8, {}),
  ],
  xahau: [
    { unl: true, domain: "accounts" },
    { unl: true, marker: true },
    { unl: true, signingFile: true, rotated: 2 },
    { unl: true, negative: true },
    { unl: true, domain: null, seen: "never", noRecord: true, version: null },
    { unl: true, fee: "higher" },
    { unl: true, fee: "lower" },
    { unl: true, domain: "not_listed" },
    { unl: true, domain: "http_status" },
    { unl: true, domain: "dns_error" },
    { unl: true, domain: "timeout" },
    { unl: true, domain: "pending" },
    { unl: true, domain: null },
    ...repeat(3, { unl: true, version: "2026.7.31" }),
    { unl: true, version: "2025.11.4" },
    ...repeat(14, { unl: true }),
    { domain: "toml_invalid" },
    { domain: "too_large" },
    { domain: "tls_error" },
    { domain: "manifest_unverified" },
    { domain: "redirect_rejected", noRecord: true },
    { domain: "blocked_address", seen: "away" },
    { domain: "connect_error", seen: "new" },
    { domain: "domain_invalid", joined: 10 },
    { domain: null },
    { domain: null, version: "unrecognised" },
  ],
};

const PROFILES: Record<NetworkName, Profile> = {
  xrpl: {
    software: "rippled",
    tenths: 39,
    toml: "xrp-ledger.toml",
    holdSeconds: 1_209_600,
    publishers: [
      { id: "unl.xrplf.org", sequence: 2026091001, version: 2, expiresInDays: 150 },
      { id: "vl.ripple.com", sequence: 91, version: 1, expiresInDays: 170 },
    ],
    fees: FEES,
    nodeQuorum: true,
    latest: "3.4.1",
    fleet: FLEETS.xrpl,
    amendments: [
      {
        name: "MPTokensV1",
        status: "majority",
        introduced: "2.3.0",
        xls: "XLS-33",
        xls_url: `${STANDARDS}XLS-0033-multi-purpose-tokens`,
        description: "Fungible tokens that need no trust line.",
        node: true,
        yes: 30,
        days: 30,
        majority: "got-lost-got",
      },
      { name: "DynamicNFT", status: "voting", introduced: "3.4.0", xls: "XLS-46", xls_url: `${STANDARDS}XLS-0046-dynamic-non-fungible-tokens`, node: true, yes: 20, days: 3 },
      { name: "XChainBridge", status: "voting", introduced: "2.0.0", xls: "XLS-38", xls_url: `${STANDARDS}XLS-0038-cross-chain-bridge`, node: true, yes: 12, days: 3 },
      { name: "PermissionedDomains", status: "voting", introduced: "3.4.0", xls: "XLS-80", xls_url: `${STANDARDS}XLS-0080-permissioned-domains`, node: true, yes: 5, days: 3 },
      { status: "unknown", node: true, yes: 0, days: 3 },
      {
        name: "AMM",
        status: "enabled",
        introduced: "1.12.0",
        xls: "XLS-30",
        xls_url: `${STANDARDS}XLS-0030-automated-market-maker`,
        description: "Automated market makers in the decentralized exchange.",
        node: true,
        enabled: { daysAgo: 575 },
      },
      { name: "DID", status: "enabled", introduced: "2.0.0", xls: "XLS-40", xls_url: `${STANDARDS}XLS-0040-decentralized-identity`, node: true, enabled: { daysAgo: 360 } },
      { name: "fix1201", status: "enabled", introduced: "0.80.0", node: true, enabled: { date: "2017-11-14" } },
      { name: "fixNFTokenNegOffer", status: "obsolete", introduced: "1.9.0", node: true, days: 3 },
    ],
  },
  xahau: {
    software: "xahaud",
    tenths: 40,
    toml: "xahau.toml",
    holdSeconds: 432_000,
    publishers: [{ id: "vl.xahau.org", sequence: 41, version: 1, expiresInDays: 120 }],
    fees: FEES,
    nodeQuorum: false,
    latest: "2026.9.18",
    builds: { "2026.9.18": 1975, "2026.7.31": 1902, "2025.11.4": 1640 },
    fleet: FLEETS.xahau,
    amendments: [
      { name: "Remit", status: "majority", introduced: "2025.2.6", node: true, yes: 27, days: 3, majority: "before-history" },
      { name: "URIToken", status: "voting", introduced: "2026.1.20", node: true, yes: 10, days: 3 },
      { name: "Import", status: "enabled", introduced: "2023.10.30", node: true, enabled: { daysAgo: 400 } },
      { name: "Hooks", status: "enabled", introduced: "2023.10.30", node: true, enabled: { date: "2023-10-30" } },
      { name: "XahauGenesis", status: "enabled", introduced: "2023.10.30", retired: true },
    ],
  },
};

// ---- Small things ----------------------------------------------------------------------------------------------------

/** `value` without the keys that have no value (D1 leaves a key out, never `null`), the others in their order. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** A ledger or wall time, `YYYY-MM-DDTHH:mm:ssZ`, of unix seconds. */
const time = (seconds: number): string => `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
/** An instant of receipt, `YYYY-MM-DDTHH:mm:ss.SSSZ`, of unix milliseconds. */
const instant = (ms: number): string => new Date(ms).toISOString();
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** A whole number in [0, n) from a stream. */
const below = (next: () => number, n: number): number => Math.floor(next() * n);
const bytesOf = (next: () => number, count: number): number[] => Array.from({ length: count }, () => below(next, 256));
const hexOf = (bytes: number[]): string => bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();

/** Fisher–Yates, in place. */
function shuffle<T>(items: T[], next: () => number): T[] {
  for (let at = items.length - 1; at > 0; at--) {
    const other = below(next, at + 1);
    [items[at], items[other]] = [items[other]!, items[at]!];
  }
  return items;
}

// ---- Versions --------------------------------------------------------------------------------------------------------

type Triple = [number, number, number];

/** A version as D1 writes it: its numbers, release 3, release candidate 2 or beta 1, and the candidate's or beta's number. */
function versionOf(text: string): { triple: Triple; stage: number; number: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|b)(\d+))?$/.exec(text);
  if (!match) throw new Error(`not a version: ${text}`);
  return {
    triple: [Number(match[1]), Number(match[2]), Number(match[3])],
    stage: match[4] === "rc" ? 2 : match[4] === "b" ? 1 : 3,
    number: Number(match[5] ?? 0),
  };
}

const sign = (difference: number): number => (difference < 0 ? -1 : difference > 0 ? 1 : 0);
const compareTriples = (a: Triple, b: Triple): number => sign(a[0] - b[0]) || sign(a[1] - b[1]) || sign(a[2] - b[2]);

/** Newest first (D1's `compareVersions`): the higher numbers, then the higher stage, then the higher candidate or beta number. */
function compareVersions(a: string, b: string): number {
  const [x, y] = [versionOf(a), versionOf(b)];
  return compareTriples(y.triple, x.triple) || sign(y.stage - x.stage) || sign(y.number - x.number);
}

/** Whether software of `version` knows an amendment introduced in `introduced` (unknown either way: it may). */
const knows = (version: string | undefined, introduced: string | undefined): boolean =>
  version === undefined || introduced === undefined || compareTriples(versionOf(version).triple, versionOf(introduced).triple) >= 0;

/**
 * The `sfServerVersion` of a version, decimal text (D1 F3, F4): bits 48-63 `0x183B`, then the major (on xahaud counted from 2023), the minor, the patch, the release
 * byte (`0xC0` a release, `0x80 | n` a release candidate, `0x40 | n` a beta) and, on xahaud, the build.
 */
function serverVersionOf(profile: Profile, version: string, build = 0): string {
  const { triple, stage, number } = versionOf(version);
  const major = triple[0] - (profile.software === "xahaud" ? 2023 : 0);
  const release = stage === 2 ? 0x80 | number : stage === 1 ? 0x40 | number : 0xc0;
  const value = (0x183bn << 48n) | (BigInt(major) << 40n) | (BigInt(triple[1]) << 32n) | (BigInt(triple[2]) << 24n) | (BigInt(release) << 16n) | BigInt(build);
  return value.toString();
}

/** A `sfServerVersion` that is no version: another prefix. D1 then serves `server_version` alone. */
const UNRECOGNISED = ((0x1234n << 48n) | 0x0304_01c0_0000n).toString();

// ---- The fleet -------------------------------------------------------------------------------------------------------

/** One validator, as the generator works it out. */
interface Member {
  role: Role;
  unl: boolean;
  /** The master key. */
  key: string;
  signing: string;
  domain?: string;
  verification?: DomainVerification;
  lists: string[];
  version?: string;
  build?: number;
  serverVersion?: string;
  /** Unix milliseconds. */
  firstSeen?: number;
  lastSeen?: number;
  current?: number;
  partial?: boolean;
  manifest: { sequence: number; signingKeysSeen: number };
  /** Its validations, newest first: the first page, and the second when it has one. */
  pages: ValidatorValidation[][];
  /** Its vote record: the voting ledger, the IDs it votes yes for (sorted, as rippled sends them) and the fees. */
  record?: { ledger: number; yes: string[]; fees: NativeFees };
  windows?: { agreement_1h: Agreement; agreement_24h: Agreement; agreement_30d: Agreement; daily: DailyAgreement[] };
}

/** The keys of the given validations, in the order they were first seen (the earliest `first_datetime` of each, then the key). */
function seenKeys(validations: readonly LedgerValidations[]): string[] {
  const first = new Map<string, string>();
  for (const body of validations) {
    for (const validation of body.validations) {
      const at = first.get(validation.validation_public_key);
      if (at === undefined || validation.first_datetime < at) first.set(validation.validation_public_key, validation.first_datetime);
    }
  }
  return [...first].sort(([k1, a], [k2, b]) => compareText(a, b) || compareText(k1, k2)).map(([key]) => key);
}

/** The validators list's order: those with a domain first, by domain in lower case, then by master key; then the others, by master key. */
function compareMembers(a: Member, b: Member): number {
  if ((a.domain === undefined) !== (b.domain === undefined)) return a.domain === undefined ? 1 : -1;
  if (a.domain !== undefined && b.domain !== undefined) {
    const byDomain = compareText(a.domain.toLowerCase(), b.domain.toLowerCase());
    if (byDomain !== 0) return byDomain;
  }
  return compareText(a.key, b.key);
}

const DOMAIN_FIRST = ["amber", "birch", "cedar", "delta", "ember", "fjord", "glade", "harbor", "indigo", "juniper", "kestrel", "lumen", "meadow", "north", "orchid", "pine"];
const DOMAIN_SECOND = ["bay", "field", "gate", "hill", "lake", "mill", "node", "peak", "point", "port", "ridge", "rock", "stone", "vale", "works", "yard"];

/** The fixed points of a network's time: the newest ledger, its close, the rounds and the hours of agreement. */
interface Clock {
  anchor: number;
  /** Unix seconds. */
  close: number;
  closeOf: (index: number) => number;
  /** The newest voting ledger (255 mod 256) at or before the anchor: the newest stored round. */
  newestRound: number;
  /** The first flag ledger above the anchor. */
  nextFlag: number;
  /** The flag ledger the negative UNL member was disabled at, about 2 days ago. */
  negativeFrom: number;
  /** The start of the newest final hour of agreement: the newest hour that ended at least half an hour before the close. */
  newestFinal: number;
  /** The newest voting ledger at or before `index`. */
  votingAtOrBefore: (index: number) => number;
  /** The voting ledgers of the last `days` days of rounds, oldest first. */
  roundsOf: (days: number) => number[];
  /** The rounds in `seconds`: one every 256 ledgers. */
  roundsIn: (seconds: number) => number;
}

function clockOf(profile: Profile, last: LastValidated): Clock {
  const anchor = Number(last.ledger_index);
  const close = Date.parse(last.close_time) / 1000;
  // A ledger's close: the anchor's, plus the ledgers between times the mean interval, rounded half up to the second.
  const closeOf = (index: number) => close + Math.floor(((index - anchor) * profile.tenths + 5) / 10);
  const votingAtOrBefore = (index: number) => Math.floor((index + 1) / FLAG_INTERVAL) * FLAG_INTERVAL - 1;
  const newestRound = votingAtOrBefore(anchor);
  const roundsIn = (seconds: number) => Math.floor((seconds * 10) / (FLAG_INTERVAL * profile.tenths));
  return {
    anchor,
    close,
    closeOf,
    newestRound,
    nextFlag: (Math.floor(anchor / FLAG_INTERVAL) + 1) * FLAG_INTERVAL,
    negativeFrom: newestRound + 1 - FLAG_INTERVAL * roundsIn(2 * DAY),
    newestFinal: Math.floor((close - HOUR / 2) / HOUR) * HOUR - HOUR,
    votingAtOrBefore,
    roundsIn,
    roundsOf: (days) => {
      const rounds: number[] = [];
      for (let ledger = newestRound; closeOf(ledger) >= closeOf(newestRound) - days * DAY; ledger -= FLAG_INTERVAL) rounds.push(ledger);
      return rounds.reverse();
    },
  };
}

/** The validators, their keys, domains, lists, versions and first sightings. Stream `network/validators`. */
function fleetOf(net: NetworkName, profile: Profile, clock: Clock, given: readonly string[]): Member[] {
  const next = mulberry32(seedOf(net, "network/validators"));
  const now = profile.fleet.filter((role) => role.seen === undefined).length;
  // The given validators take the places of those seen now, in order; more of them than places make more validators off the UNL.
  const roles = [...profile.fleet, ...repeat(Math.max(0, given.length - now), {})];
  const used = new Set<string>();
  let taken = 0;

  return roles.map((role): Member => {
    const seenNow = role.seen === undefined;
    const key = seenNow && taken < given.length ? given[taken++]! : encodeNodePublic(Uint8Array.from([0xed, ...bytesOf(next, 32)]));
    const signing = encodeNodePublic(Uint8Array.from([0x02 + below(next, 2), ...bytesOf(next, 32)]));

    let domain: string | undefined;
    let verification: DomainVerification | undefined;
    const check = role.domain === undefined ? "verified" : role.domain;
    if (check !== null) {
      do {
        domain = `${DOMAIN_FIRST[below(next, DOMAIN_FIRST.length)]}${DOMAIN_SECOND[below(next, DOMAIN_SECOND.length)]}.example`;
      } while (used.has(domain));
      used.add(domain);
      const toml_url = `https://${domain}/.well-known/${profile.toml}`;
      const checked = instant(clock.close * 1000 - below(next, HOUR * 1000));
      if (check === "pending") verification = { status: "pending", toml_url };
      else if (check === "verified" || check === "accounts") {
        const accounts = check === "accounts" ? [0, 1].map(() => encodeAccountID(Uint8Array.from(bytesOf(next, 20)))) : undefined;
        verification = compact({ status: "verified" as const, toml_url, checked, verified: checked, accounts });
      } else {
        verification = compact({ status: "unverified" as const, reason: check, status_code: check === "http_status" ? 404 : undefined, toml_url, checked });
      }
    }

    const version = role.version === undefined ? profile.latest : role.version;
    const named = version !== null && version !== "unrecognised" ? version : undefined;
    const build = named === undefined ? undefined : profile.builds?.[named];
    const serverVersion = version === null ? undefined : version === "unrecognised" ? UNRECOGNISED : serverVersionOf(profile, version, build);

    const firstSeen =
      role.seen === "never"
        ? undefined
        : role.seen === "new"
          ? clock.close * 1000 - 20 * 60_000 - below(next, 60_000)
          : (clock.close - (role.joined ?? 60 + below(next, 600)) * DAY - below(next, HOUR)) * 1000 - below(next, 1000);
    const signingKeysSeen = role.rotated ?? 1;

    return {
      role,
      unl: role.unl === true,
      key,
      signing,
      domain,
      verification,
      lists: role.unl ? (role.lists ?? profile.publishers.map((_, at) => at)).map((at) => profile.publishers[at]!.id).sort(compareText) : [],
      version: named,
      build,
      serverVersion,
      firstSeen,
      manifest: { sequence: signingKeysSeen + below(next, 3), signingKeysSeen },
      pages: [],
    };
  });
}

// ---- Validations -----------------------------------------------------------------------------------------------------

/**
 * Each validator's newest validations, newest first, and what they make of it: its `current_index`, `partial` and last sighting. Every row `matches` the indexed
 * ledger (the newest recorded one by its own hash), but on the one second page of the network, after the first page's last row: its newest row is a ledger the index
 * has a gap at (`unknown`), it has a fork (the ledger signed twice: the other hash is `different`, the indexed one `matches`) and a partial validation. Stream
 * `network/validators/{key}/validations`.
 */
function validationsOf(net: NetworkName, profile: Profile, clock: Clock, members: Member[], ledgerHash: (index: number) => string): void {
  const next = mulberry32(seedOf(net, "network/validators/{key}/validations"));
  for (const member of members) {
    if (member.role.seen === "never") {
      member.pages = [[]];
      continue;
    }
    const row = (index: number, how: { validated?: Validated; hash?: string; full?: boolean } = {}): ValidatorValidation => {
      const at = clock.closeOf(index);
      const first = at * 1000 + 150 + below(next, 600);
      const validated = how.validated ?? "matches";
      return compact({
        ledger_index: index,
        ledger_hash: how.hash ?? ledgerHash(index),
        validated,
        validated_hash: validated === "different" ? ledgerHash(index) : undefined,
        full: how.full ?? true,
        signing_key: member.signing,
        signing_time: time(at),
        first_datetime: instant(first),
        last_datetime: instant(first + below(next, 400)),
        count: 1 + below(next, 3),
      });
    };

    // Away: its newest validation 5 hours before the newest ledger, too long ago for a `current_index` (D1 looks at the last 300 ledgers).
    const top = member.role.seen === "away" ? clock.anchor - Math.floor((5 * HOUR * 10) / profile.tenths) : clock.anchor;
    const first = Array.from({ length: PAGE }, (_, at) => row(top - at, { full: !(at === 0 && member.role.partial) }));
    member.pages = [first];
    if (member.role.marker) {
      const second: ValidatorValidation[] = [];
      for (let back = 0; second.length < PAGE; back++) {
        const index = top - PAGE - back;
        if (back === 0) second.push(row(index, { validated: "unknown" }));
        else if (back === 6) {
          const fork = row(index, { validated: "different", hash: sha512Half(`${net} fork ${index}`) });
          // The two rows of one ledger in the order of the hash, as the page (newest first) is.
          second.push(...[fork, row(index)].sort((a, b) => compareText(b.ledger_hash, a.ledger_hash)));
        } else second.push(row(index, { full: back !== 12 }));
      }
      member.pages.push(second);
    }
    member.lastSeen = Date.parse(first[0]!.last_datetime);
    if (member.role.seen !== "away") {
      member.current = first[0]!.ledger_index;
      member.partial = !first[0]!.full;
    }
  }
}

/** The marker of a page that more follow: the base64url of `[ledger_index, ledger_hash]` of its last row. */
const markerOf = (page: readonly ValidatorValidation[]): string => {
  const last = page.at(-1)!;
  return Buffer.from(JSON.stringify([last.ledger_index, last.ledger_hash])).toString("base64url");
};

// ---- Agreement -------------------------------------------------------------------------------------------------------

interface KeyHour {
  agreed: number;
  missed: number;
  partial: number;
}

/**
 * The windows of agreement of every validator (D1's `agreementWindows`): the hours of the 30 days ending with the newest final hour, each with the ledgers the
 * network validated in it (the ones observed, the ones left out), and each validator's rows of the hours it was held to. Stream `network/validators/{key}`.
 */
function agreementOf(net: NetworkName, profile: Profile, clock: Clock, members: Member[]): void {
  const next = mulberry32(seedOf(net, "network/validators/{key}"));
  const end = clock.newestFinal + HOUR;
  const from = end - 720 * HOUR;
  // One hour 12 days back was never made final (a collector reconnect): the 30-day window and its day are incomplete, for every validator.
  const gap = clock.newestFinal - (12 * 24 + 7) * HOUR;
  // The ledgers of an hour: the ledger boundaries (one every `tenths`) between its start and its end.
  const tick = (seconds: number) => Math.floor(((seconds - clock.close) * 10) / profile.tenths);
  const sentinels = new Map<number, { observed: number; unobserved: number }>();
  for (let hour = from; hour < end; hour += HOUR) {
    if (hour === gap) continue;
    const unobserved = next() < 0.05 ? 1 : 0;
    sentinels.set(hour, { observed: tick(hour + HOUR) - tick(hour) - unobserved, unobserved });
  }

  const windowOf = (rows: Map<number, KeyHour>, start: number, stop: number): Agreement => {
    let [missed, total, partial, observed, unobserved, incomplete] = [0, 0, 0, 0, 0, false];
    for (let hour = start; hour < stop; hour += HOUR) {
      const sentinel = sentinels.get(hour);
      if (sentinel === undefined) incomplete = true;
      else [observed, unobserved] = [observed + sentinel.observed, unobserved + sentinel.unobserved];
      const row = rows.get(hour);
      if (row !== undefined) [total, missed, partial] = [total + row.agreed + row.missed, missed + row.missed, partial + row.partial];
    }
    if (unobserved * 100 > observed + unobserved) incomplete = true;
    const score = total > 0 ? new BigNumber(total - missed).div(total).toFixed(4, BigNumber.ROUND_HALF_UP) : undefined;
    return compact({ missed, total, score, incomplete, partial });
  };

  const today = Math.floor(clock.newestFinal / DAY) * DAY;
  for (const member of members) {
    const rows = new Map<number, KeyHour>();
    if (member.firstSeen !== undefined) {
      // Held to every hour from its first whole one: a member of the UNL even while it is offline, any other while it is seen.
      const until = member.role.seen === "away" ? Math.floor(member.lastSeen! / 1000 / HOUR) * HOUR - HOUR : clock.newestFinal;
      for (let hour = Math.max(from, Math.ceil(member.firstSeen / 1000 / HOUR) * HOUR); hour <= until; hour += HOUR) {
        const sentinel = sentinels.get(hour);
        if (sentinel === undefined) continue;
        const offline = member.role.negative === true && hour >= clock.close - 3 * DAY && hour < clock.close - 6 * HOUR;
        const missed = offline ? sentinel.observed : next() < 0.08 ? 1 + below(next, 3) : 0;
        const partial = !offline && next() < 0.03 ? 1 : 0;
        rows.set(hour, { agreed: sentinel.observed - missed, missed, partial });
      }
    }
    member.windows = {
      agreement_1h: windowOf(rows, clock.newestFinal, end),
      agreement_24h: windowOf(rows, end - 24 * HOUR, end),
      agreement_30d: windowOf(rows, from, end),
      daily: Array.from({ length: 30 }, (_, at) => {
        const day = today - (29 - at) * DAY;
        return { date: time(day).slice(0, 10), ...windowOf(rows, day, day + DAY) };
      }),
    };
  }
}

// ---- Votes and amendments --------------------------------------------------------------------------------------------

/** F7: the votes an amendment has to exceed, max(1, ⌊trusted × 80 / 100⌋). */
const thresholdOf = (trusted: number): number => Math.max(1, Math.floor((trusted * THRESHOLD_PERCENT) / 100));
/** The votes that pass it: the threshold + 1, and 1 for up to one trusted validator. */
const neededOf = (trusted: number): number => (trusted <= 1 ? 1 : thresholdOf(trusted) + 1);
/** Whether `yes` carries it: more than the threshold, the threshold itself for one validator. */
const passesOf = (yes: number, trusted: number): boolean => (trusted === 1 ? yes >= thresholdOf(trusted) : yes > thresholdOf(trusted));
/** yes / trusted × 100 to two decimals, half up; 0 when nobody is trusted. In whole numbers, as D1 does: the remainder decides the last digit. */
function pctOf(yes: number, trusted: number): number {
  if (trusted <= 0) return 0;
  const hundredths = Math.floor((yes * 10_000) / trusted);
  const remainder = yes * 10_000 - hundredths * trusted;
  return new BigNumber(remainder * 2 >= trusted ? hundredths + 1 : hundredths).shiftedBy(-2).toNumber();
}

/** An amendment as the generator works it out: the row of the list and what its own answer adds. */
interface Amendment {
  spec: AmendmentSpec;
  row: AmendmentRow;
  rounds: AmendmentRoundPoint[];
  history: AmendmentHistoryEvent[];
}

/** The order of the list's groups, and inside them (D1 3.5): by expected activation, by yes (most first), by ID, by the ledger it was enabled in (newest first), by name. */
const GROUPS: readonly string[] = ["majority", "voting", "unknown", "enabled", "obsolete"] satisfies readonly AmendmentStatus[];

function compareByName(a: AmendmentRow, b: AmendmentRow): number {
  if ((a.name === undefined) !== (b.name === undefined)) return a.name === undefined ? 1 : -1;
  if (a.name !== undefined && b.name !== undefined) {
    const byName = compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.name, b.name);
    if (byName !== 0) return byName;
  }
  return compareText(a.id, b.id);
}

function compareAmendments(a: AmendmentRow, b: AmendmentRow): number {
  const group = GROUPS.indexOf(a.status) - GROUPS.indexOf(b.status);
  if (group !== 0) return group;
  if (a.status === "majority") return compareText(a.majority!.expected_activation, b.majority!.expected_activation) || compareByName(a, b);
  if (a.status === "voting") return b.votes!.yes - a.votes!.yes || compareByName(a, b);
  if (a.status === "unknown") return compareText(a.id, b.id);
  if (a.status === "enabled") {
    const [x, y] = [a.enabled?.ledger_index, b.enabled?.ledger_index];
    if ((x === undefined) !== (y === undefined)) return x === undefined ? 1 : -1;
    if (x !== undefined && y !== undefined && x !== y) return y - x;
  }
  return compareByName(a, b);
}

/**
 * The vote records, the rounds and the amendments. A record is the newest full vote of a validator (at the newest round, or for one away at the last round it was
 * seen at); the trusted are the UNL members with a record that counts (not the never seen, not the one on the negative UNL). Each amendment being decided gets its
 * newest round's yes votes from the trusted that know it; the others with a record vote for what they know, one time in two. Stream `network/amendments`.
 */
function amendmentsOf(net: NetworkName, profile: Profile, clock: Clock, members: Member[]): { amendments: Amendment[]; envelope: AmendmentsEnvelope } {
  const next = mulberry32(seedOf(net, "network/amendments"));
  const unknownId = hexOf(bytesOf(next, 32));
  const idOf = (spec: AmendmentSpec) => (spec.name === undefined ? unknownId : amendmentId(spec.name));

  for (const member of members) {
    if (member.role.noRecord || member.role.seen === "never") continue;
    const ledger = member.role.seen === "away" ? clock.votingAtOrBefore(member.pages[0]![0]!.ledger_index) : clock.newestRound;
    const fees =
      member.role.fee === "higher" ? { ...profile.fees, reserve_base: "2" } : member.role.fee === "lower" ? { ...profile.fees, reserve_inc: "0.1" } : { ...profile.fees };
    member.record = { ledger, yes: [], fees };
  }
  const counted = members.filter((member) => member.unl && member.record !== undefined && !member.role.negative);
  const others = members.filter((member) => member.record !== undefined && !counted.includes(member));
  for (const spec of profile.amendments) {
    if (spec.name === undefined || (spec.status !== "majority" && spec.status !== "voting")) continue;
    const id = idOf(spec);
    const able = shuffle(
      counted.filter((member) => knows(member.version, spec.introduced)),
      next,
    );
    if (able.length < spec.yes!) throw new Error(`${net}: ${spec.name} needs ${spec.yes} yes votes of ${able.length} trusted validators that know it`);
    for (const member of able.slice(0, spec.yes)) member.record!.yes.push(id);
    for (const member of others) if (knows(member.version, spec.introduced) && next() < 0.5) member.record!.yes.push(id);
  }
  for (const member of members) member.record?.yes.sort(compareText);

  // The newest round, and the trusted of each round: one more before the negative UNL member was disabled.
  const trusted = counted.length;
  const unl = members.filter((member) => member.unl);
  const nextFlag: NextFlagLedger = { ledger_index: clock.nextFlag, voting_ledger: clock.nextFlag - 1, expected: time(clock.closeOf(clock.nextFlag)) };
  const envelope: AmendmentsEnvelope = {
    ledger_index: clock.anchor,
    rules: { threshold_percent: THRESHOLD_PERCENT, majority_hold_seconds: profile.holdSeconds, flag_interval: FLAG_INTERVAL },
    round: {
      ledger_index: clock.newestRound,
      date: time(clock.closeOf(clock.newestRound)),
      unl_size: unl.length,
      trusted,
      threshold: thresholdOf(trusted),
      needed: neededOf(trusted),
      observed: unl.filter((member) => member.role.seen !== "never").length,
    },
    next_flag_ledger: nextFlag,
  };
  const trustedAt = (ledger: number) => (ledger > clock.negativeFrom ? trusted : trusted + 1);
  const eventAt = (event: AmendmentHistoryEvent["event"], id: string, ledger: number): AmendmentHistoryEvent => ({
    event,
    ledger_index: ledger,
    date: time(clock.closeOf(ledger)),
    tx_hash: sha512Half(`${net} EnableAmendment ${id} ${ledger}`),
  });
  const amendments = profile.amendments.map((spec): Amendment => {
    const id = idOf(spec);
    const undecided = spec.status === "majority" || spec.status === "voting" || spec.status === "unknown";
    const history: AmendmentHistoryEvent[] = [];
    let majority: AmendmentRow["majority"];
    let enabled: AmendmentRow["enabled"];

    // The rounds: the votes it had at each, as its story goes; the newest is the newest round's tally. An enabled amendment has only the rounds before the ledger
    // it was enabled in: none, as each was enabled before them (it has no `days`).
    const ledgers = spec.days === undefined ? [] : clock.roundsOf(spec.days);
    const newest = ledgers.length - 1;
    const at = (days: number) => ledgers.findIndex((ledger) => clock.closeOf(ledger) >= clock.close - days * DAY);
    const [got, lost, regot] = spec.majority === "got-lost-got" ? [at(25), at(20), at(10)] : [-1, -1, -1];
    // A tally holds from one flag ledger to the next: a validator changes its vote, or misses a round, now and then, not at every flag ledger (spec 6.3 and 7: about
    // 2,600 rounds with a handful of changes). So the story's draw is taken at a few change points and held until the next: at the start of each run of a got/lost/got
    // majority, half-way through the rounds of a majority got before the history, at a third and two thirds of a vote's climb. Every round still takes its draw, so
    // the stream, and so every answer made from it, is as it was. The yes count also moves where the trusted count does, the threshold with it.
    const points = new Set(
      spec.majority === "got-lost-got"
        ? [0, got, lost, regot]
        : spec.majority === "before-history"
          ? [0, Math.floor(newest / 2)]
          : [0, Math.floor(newest / 3), Math.floor((2 * newest) / 3)],
    );
    let held = 0;
    const rounds = ledgers.map((ledger, index): AmendmentRoundPoint => {
      const roundTrusted = trustedAt(ledger);
      const threshold = thresholdOf(roundTrusted);
      const margin = Math.min(4, roundTrusted - threshold);
      /** The draw at a change point, else the one held since the last. */
      const hold = (draw: number) => (held = points.has(index) ? draw : held);
      let yes = 0;
      if (index === newest) yes = spec.yes ?? 0;
      else if (spec.majority === "got-lost-got") {
        const passing = (index >= got && index < lost) || index >= regot;
        yes = passing ? threshold + 1 + hold(below(next, margin)) : threshold - hold(below(next, 6));
      } else if (spec.majority === "before-history") yes = threshold + 1 + hold(below(next, margin));
      else if (spec.status === "voting") {
        const start = Math.floor(spec.yes! / 2);
        yes = Math.min(threshold, Math.max(0, hold(start + Math.floor(((spec.yes! - start) * index) / newest) + below(next, 3) - 1)));
      }
      return { ledger_index: ledger, flag_ledger: ledger + 1, date: time(clock.closeOf(ledger)), yes, trusted: roundTrusted, threshold, passes: passesOf(yes, roundTrusted) };
    });

    if (spec.majority === "got-lost-got") {
      // Each change is an EnableAmendment in the ledger after the flag ledger of the round that made it.
      history.push(eventAt("got_majority", id, ledgers[got]! + 2), eventAt("lost_majority", id, ledgers[lost]! + 2), eventAt("got_majority", id, ledgers[regot]! + 2));
      const { ledger_index, date, tx_hash } = history.at(-1)!;
      majority = { since: date, ledger_index, tx_hash, expected_activation: time(clock.closeOf(ledger_index) + profile.holdSeconds) };
    } else if (spec.majority === "before-history") {
      // Got 4 days ago, before the indexed history: no transaction is known (G5).
      const ledger = clock.newestRound + 2 - FLAG_INTERVAL * clock.roundsIn(4 * DAY);
      majority = { since: time(clock.closeOf(ledger)), expected_activation: time(clock.closeOf(ledger) + profile.holdSeconds) };
    }
    if (spec.enabled !== undefined && "daysAgo" in spec.enabled) {
      // Got its majority, held it, and was enabled at the first flag ledger after the hold, in the ledger after it.
      const gotFlag = clock.newestRound + 1 - FLAG_INTERVAL * clock.roundsIn(spec.enabled.daysAgo * DAY + profile.holdSeconds);
      const since = clock.closeOf(gotFlag + 1);
      let flag = gotFlag + FLAG_INTERVAL;
      while (clock.closeOf(flag) < since + profile.holdSeconds) flag += FLAG_INTERVAL;
      history.push(eventAt("got_majority", id, gotFlag + 1), eventAt("enabled", id, flag + 1));
      const { ledger_index, date, tx_hash } = history.at(-1)!;
      enabled = { ledger_index, date, tx_hash, source: "ledger" };
    } else if (spec.enabled !== undefined) {
      enabled = compact({ ledger_index: spec.enabled.ledger_index, date: spec.enabled.date, source: "metadata" as const });
    }

    const yes = spec.yes ?? 0;
    const row = compact<AmendmentRow>({
      id,
      name: spec.name,
      status: spec.status,
      retired: spec.retired,
      introduced: spec.introduced,
      xls: spec.xls,
      xls_url: spec.xls_url,
      description: spec.description,
      node_supported: spec.node,
      votes: undecided ? { ledger_index: clock.newestRound, yes, trusted, needed: neededOf(trusted), pct: pctOf(yes, trusted) } : undefined,
      majority,
      enabled,
    });
    return { spec, row, rounds, history };
  });
  return { amendments: amendments.sort((a, b) => compareAmendments(a.row, b.row)), envelope };
}

// ---- The answers -----------------------------------------------------------------------------------------------------

/**
 * Every synthetic answer of D1's six routes for a network: path and query of the request that asks for it (the calls of the E6 spec 2.1) and its body. `last` is
 * the newest ledger (its index and close time are the anchor of every figure), `ledgerValidations` the bodies of the `/v2/ledgers/{hash}/validations` files of
 * `networkFixtures`: their validators come first, so every key the network page shows has a validator page.
 */
export function validatorsFixtures(net: NetworkName, last: LastValidated, ledgerValidations: readonly LedgerValidations[]): FixtureFile[] {
  const profile = PROFILES[net];
  const clock = clockOf(profile, last);
  const known = new Map<number, string>([[clock.anchor, last.ledger_hash]]);
  for (const body of ledgerValidations) for (const validation of body.validations) known.set(Number(validation.ledger_index), body.ledger_hash);
  const ledgerHash = (index: number) => known.get(index) ?? sha512Half(`${net} ledger ${index}`);

  const members = fleetOf(net, profile, clock, seenKeys(ledgerValidations));
  validationsOf(net, profile, clock, members, ledgerHash);
  agreementOf(net, profile, clock, members);
  const { amendments, envelope } = amendmentsOf(net, profile, clock, members);
  const ordered = [...members].sort(compareMembers);
  const unl = ordered.filter((member) => member.unl);
  const seen = ordered.filter((member) => member.lastSeen !== undefined && member.lastSeen >= (clock.close - DAY) * 1000);

  // The newest release among the versions of the trusted UNL, and each validator's row.
  const latest = unl.flatMap((member) => (member.version !== undefined && versionOf(member.version).stage === 3 ? [member.version] : [])).sort(compareVersions)[0];
  const nameOf = new Map(amendments.map(({ row }) => [row.id, row.name]));
  const decided = amendments.filter(({ row }) => row.status === "majority" || row.status === "voting" || row.status === "unknown");
  const yesOf = (member: Member): YesEntry[] => (member.record?.yes ?? []).map((id) => compact({ id, name: nameOf.get(id) }));
  const rowOf = <V>(member: Member, votes: V | undefined): Omit<ValidatorRow, "amendment_votes"> & { amendment_votes?: V } =>
    compact({
      validation_public_key: member.key,
      domain: member.domain,
      current_index: member.current,
      agreement_1h: member.windows!.agreement_1h,
      agreement_24h: member.windows!.agreement_24h,
      partial: member.partial,
      unl: member.unl,
      agreement_30d: member.windows!.agreement_30d,
      signing_key: member.signing,
      domain_verification: member.verification,
      unl_lists: member.lists,
      negative_unl: member.role.negative === true,
      version: member.version,
      version_build: member.build,
      version_latest: member.version === undefined || latest === undefined ? undefined : compareTriples(versionOf(member.version).triple, versionOf(latest).triple) >= 0,
      server_version: member.serverVersion,
      fee_vote: member.record === undefined ? undefined : { ledger_index: member.record.ledger, ...member.record.fees },
      amendment_votes: votes,
      first_seen: member.firstSeen === undefined ? undefined : instant(member.firstSeen),
      last_seen: member.lastSeen === undefined ? undefined : instant(member.lastSeen),
    });

  // The summary, counted from the rows.
  const next = mulberry32(seedOf(net, "network/validators/summary"));
  const publishers = profile.publishers.map((publisher, at): UnlPublisher => {
    const named = ordered.filter((member) => member.lists.includes(publisher.id));
    return {
      id: publisher.id,
      url: `https://${publisher.id}`,
      public_key: `ED${hexOf(bytesOf(next, 32))}`,
      status: "ok",
      sequence: publisher.sequence,
      version: publisher.version,
      expiration: time(clock.close + publisher.expiresInDays * DAY),
      fetched: instant((clock.close - (4 + at) * 60) * 1000 - below(next, 1000)),
      validators: named.length,
      seen_24h: named.filter((member) => seen.includes(member)).length,
    };
  });
  const negative = ordered.filter((member) => member.role.negative);
  const negativeOnUnl = negative.filter((member) => member.unl).length;
  const quorum = Math.max(Math.ceil((4 * (unl.length - negativeOnUnl)) / 5), Math.ceil((3 * unl.length) / 5));
  const versions = new Map<string, VersionCount>();
  const versionsUnknown = { unl: 0, all: 0 };
  for (const [field, list] of [["unl", unl], ["all", seen]] as const) {
    for (const member of list) {
      if (member.version === undefined) versionsUnknown[field] += 1;
      else {
        const count = versions.get(member.version) ?? { version: member.version, unl: 0, all: 0 };
        count[field] += 1;
        versions.set(member.version, count);
      }
    }
  }
  const othersSeen = seen.filter((member) => !member.unl).length;
  const summary = compact<ValidatorsSummary>({
    result: "success",
    ledger_index: clock.anchor,
    close_time: time(clock.close),
    validators: { seen_24h: seen.length, unl_seen_24h: seen.length - othersSeen, others_seen_24h: othersSeen, all: unl.length + othersSeen },
    unl: { trusted: unl.length, threshold: 1, publishers },
    quorum: compact({ value: quorum, unl_size: unl.length, negative_unl: negativeOnUnl, node: profile.nodeQuorum ? quorum : undefined }),
    negative_unl: negative.map((member) => ({ validation_public_key: member.key, first_ledger: clock.negativeFrom })),
    negative_unl_pending: negative.length === 0 ? undefined : { to_reenable: negative[0]!.key },
    fees: profile.fees,
    next_flag_ledger: envelope.next_flag_ledger,
    latest_version: latest,
    versions: [...versions.values()].sort((a, b) => compareVersions(a.version, b.version)),
    versions_unknown: versionsUnknown,
    agreement_through: time(clock.newestFinal + HOUR),
    votes_through_ledger: clock.newestRound,
    updated: instant(clock.close * 1000 + 2_222),
  });

  const list: ValidatorsList = {
    result: "success",
    count: ordered.length,
    validators: ordered.map(
      (member): ValidatorRow => rowOf(member, member.record === undefined ? undefined : { ledger_index: member.record.ledger, yes: yesOf(member) }),
    ),
  };

  const files: FixtureFile[] = [
    { path: "/v2/network/validators/summary", query: "", value: summary },
    { path: "/v2/network/validators", query: "limit=1000&scope=all", value: list },
  ];
  for (const member of ordered) {
    const votes: ValidatorDetail["amendment_votes"] = compact({
      ledger_index: member.record?.ledger,
      yes: yesOf(member),
      votes: decided.map(({ row }): ValidatorVote => {
        const vote = member.record === undefined ? "none" : member.record.yes.includes(row.id) ? "yes" : "no";
        return compact({ id: row.id, name: row.name, status: row.status as ValidatorVote["status"], vote });
      }),
    });
    const detail: ValidatorDetail = {
      // `amendment_votes` named again: it keeps its place among the row's keys.
      ...rowOf(member, votes),
      amendment_votes: votes,
      manifest: compact({ sequence: member.manifest.sequence, signing_key: member.signing, signing_keys_seen: member.manifest.signingKeysSeen, domain: member.domain }),
      daily_agreement: member.windows!.daily,
      result: "success",
    };
    files.push({ path: `/v2/network/validators/${member.key}`, query: "", value: detail });
    // D1 answers a signing key with its master's answer.
    if (member.role.signingFile) files.push({ path: `/v2/network/validators/${member.signing}`, query: "", value: detail });

    const [first, second] = member.pages as [ValidatorValidation[], ValidatorValidation[] | undefined];
    const page = (rows: ValidatorValidation[], marker?: string): ValidatorValidationsPage =>
      compact({ result: "success" as const, validation_public_key: member.key, count: rows.length, marker, validations: rows });
    const path = `/v2/network/validators/${member.key}/validations`;
    files.push({ path, query: `limit=${PAGE}`, value: page(first, second === undefined ? undefined : markerOf(first)) });
    if (second !== undefined) files.push({ path, query: `limit=${PAGE}&marker=${markerOf(first)}`, value: page(second) });
  }

  const counts = Object.fromEntries(
    (["enabled", "majority", "voting", "obsolete", "unknown"] as const).map((status) => [status, amendments.filter(({ row }) => row.status === status).length]),
  ) as AmendmentsList["counts"];
  const amendmentsList: AmendmentsList = { result: "success", ...envelope, counts, count: amendments.length, amendments: amendments.map(({ row }) => row) };
  files.push({ path: "/v2/network/amendments", query: "", value: amendmentsList });

  for (const { spec, row, rounds, history } of amendments) {
    const voteOf = (member: Member, counts: boolean): AmendmentVote =>
      compact({
        validation_public_key: member.key,
        domain: member.domain,
        vote: !counts || member.record === undefined ? ("none" as const) : member.record.yes.includes(row.id) ? ("yes" as const) : ("no" as const),
        version: member.version,
        version_supports: member.version === undefined || spec.introduced === undefined ? undefined : knows(member.version, spec.introduced),
        last_seen: member.lastSeen === undefined ? undefined : instant(member.lastSeen),
      });
    const detail: AmendmentDetail = {
      ...envelope,
      ...row,
      // Every member of the newest round's UNL as the record that counts says; then the others seen in 24 hours that have a record.
      unl_votes: unl.map((member) => voteOf(member, member.record !== undefined && !member.role.negative)),
      other_votes: seen.filter((member) => !member.unl && member.record !== undefined).map((member) => voteOf(member, true)),
      rounds,
      history,
      result: "success",
    };
    // D1 answers an ID as it answers the name: one answer, two files.
    if (row.name !== undefined) files.push({ path: `/v2/network/amendments/${row.name}`, query: "", value: detail });
    files.push({ path: `/v2/network/amendments/${row.id}`, query: "", value: detail });
  }
  return files;
}
