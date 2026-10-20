// The text rules the four validators and amendments pages share (spec 2.4 to 2.8 and 4.2): scores, fees, versions, shares, the links that go into an `href`, the verification
// note, and the view of an amendment's status. Pure functions of D1's exact strings, made with `bignumber.js` (no float reaches a label), so the validators list, the validator
// page, the amendments list and the amendment page say the same thing in the same words. Worker-only: it value-imports `ripple-address-codec` (the checksum of an address that
// goes into a link), which no browser file may; the status marks and the pages import its types only.

import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";

import { formatAmount, formatUtcDay, utcMoment } from "../domain/format";
import { formatDateTime } from "../domain/time-words";
import type { MeterData } from "../ui/charts/types";
import type { Loaded } from "./account-view";
import type { AmendmentRow, DomainVerification } from "./api-types";
import type { Network } from "./networks";

// `joinAnd` and `statusWord` are words the status marks (browser files) need too, so they live in the domain files a browser file may import (`joinAnd` in time-words.ts, apart from format.ts, which
// the shell chunk holds; `statusWord` in amendments-params.ts); they are the interface of this file as well.
export { statusWord } from "../domain/amendments-params";
export { joinAnd } from "../domain/time-words";

/** What a figure that is not there reads as. */
export const DASH = "—";
const HALF_UP = BigNumber.ROUND_HALF_UP;

/** The value of a part that loaded; `null` for one that did not (a `missing` answer is a failure to these pages). */
export const valueOf = <T>(part: Loaded<T>): T | null => (part.state === "ok" ? part.value : null);

/**
 * A piece of a sentence: plain text, a link (an internal one, or an external one that opens in a new tab: `"plain"`, or `"nofollow"` for a TOML file, which anyone can
 * point at), or a countdown to a moment (`Countdown`'s props: the server and the first render print `fallback`).
 */
export type TextPart =
  | string
  | { text: string; href: string; external?: "plain" | "nofollow"; mono?: boolean }
  | { countdown: { at: number; fallback: string; past: string; approx?: boolean; lead?: string } };

// ---- Times -------------------------------------------------------------------------------------------------------------------------------------

/**
 * A time D1 wrote (an instant, a ledger's close time, or a day) as unix seconds, whole: the fraction of a second is dropped. Read as `formatDateTime` reads it, so that a
 * countdown and the absolute time beside it name the same moment (a time with no zone is UTC; a day is its midnight). `NaN` for what is not a time.
 */
export function unixOf(iso: string): number {
  const moment = utcMoment(iso);
  return moment === undefined ? Number.NaN : Math.floor(moment.getTime() / 1000);
}

/** The UTC time of a moment (unix seconds) as `HH:MM`: the server's text of a countdown to an estimate, `expected 16:05 UTC`. */
export const clock = (atSeconds: number): string => new Date(atSeconds * 1000).toISOString().slice(11, 16);

// ---- Numbers (2.6) -----------------------------------------------------------------------------------------------------------------------------

/** A plain decimal (`0.2`, `10000`, `1e-5`), exactly; `null` for anything else, which `BigNumber` would partly read (`0x10`, `Infinity`, `NaN`). */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function decimal(text: string): BigNumber | null {
  return DECIMAL.test(text) ? new BigNumber(text) : null;
}

/** A count with separators: `22,096`. */
export const count = (n: number): string => formatAmount(String(n));

/** The agreement score for a chart's value, `score` × 100 to 2 decimals, exactly (D1's 4 decimals make it exact): `"0.9998"` is `"99.98"`. `null` for no score. */
export function scoreValue(score: string | undefined): string | null {
  const value = score === undefined ? null : decimal(score);
  return value === null ? null : value.times(100).toFixed(2, HALF_UP);
}

/** The agreement score as text: `"0.9998"` is `99.98%`, no score is `—`. */
export function scoreText(score: string | undefined): string {
  const value = scoreValue(score);
  return value === null ? DASH : `${value}%`;
}

/** The ledgers an agreement window counted: `4 missed of 22,096 validated ledgers · 1 partial` (no partial, no ` · 0 partial`). */
export function ledgersText(a: { missed: number; total: number; partial: number }): string {
  const counted = `${count(a.missed)} missed of ${count(a.total)} validated ledger${a.total === 1 ? "" : "s"}`;
  return a.partial > 0 ? `${counted} · ${count(a.partial)} partial` : counted;
}

/** A base fee, in whole native units, as the whole number of drops it is: `"0.00001"` is `10 drops`. `—` for what is not a number. */
export function dropsText(native: string): string {
  const value = decimal(native);
  if (value === null) return DASH;
  const drops = value.shiftedBy(6);
  return `${formatAmount(drops.toFixed())} drop${drops.isEqualTo(1) ? "" : "s"}`;
}

/** A reserve, in whole native units, with its currency: `"0.2"` is `0.2 XRP`. `—` for what is not a number. */
export function nativeText(native: string, unit: string): string {
  const value = decimal(native);
  return value === null ? DASH : `${formatAmount(value.toFixed())} ${unit}`;
}

/** The software version as the data API writes it. On Xahau `withBuild` adds ` · build 4119` (the validator page only). `null` for a validator that reported none. */
export function versionText(v: { version?: string; version_build?: number }, withBuild: boolean): string | null {
  if (v.version === undefined || v.version === "") return null;
  return withBuild && v.version_build !== undefined && v.version_build > 0 ? `${v.version} · build ${v.version_build}` : v.version;
}

/** `part` ÷ `whole` × 100 to `places` decimals, half up, exactly (integer arithmetic, no division that rounds). `null` when `whole` is not above 0 or `part` is below 0. */
function percentOf(part: number, whole: number, places: number): string | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || part < 0 || !(whole > 0)) return null;
  const total = new BigNumber(whole);
  // floor(100 × part × 10^places ÷ whole + ½) = (2 × scaled + whole) ÷ (2 × whole), whole part.
  const scaled = new BigNumber(part).times(100).shiftedBy(places);
  return scaled.times(2).plus(total).idiv(total.times(2)).shiftedBy(-places).toFixed(places);
}

/** A share in a table, 1 decimal: `87.8%`. `—` for a share of nothing. (A bar's label is E2's `sharePercent`: a whole percent.) */
export function shareText(part: number, whole: number): string {
  const percent = percentOf(part, whole, 1);
  return percent === null ? DASH : `${percent}%`;
}

/** The share of the trusted validators that vote yes, 1 decimal for text: `88.6%`. `—` when there are no trusted validators. */
export function yesPercentText(yes: number, trusted: number): string {
  return shareText(yes, trusted);
}

/** The same share, 2 decimals, for a chart's value: `"88.57"`. `null` when there are no trusted validators. */
export function yesPercentValue(yes: number, trusted: number): string | null {
  return percentOf(yes, trusted, 2);
}

/** How a validator's fee vote compares with the fee in force, as numbers (`"1"` and `"1.0"` are the same). */
export function compareFee(vote: string, now: string): "higher" | "lower" | "same" {
  const voted = decimal(vote);
  const current = decimal(now);
  // D1's fees are checked to be decimals before a builder sees them, so a number that cannot be compared is not reached; it is never a claim of "higher" or "lower".
  if (voted === null || current === null) return "same";
  return voted.gt(current) ? "higher" : voted.lt(current) ? "lower" : "same";
}

/** What a majority needs, in words: `more than 80%` (D1 passes an amendment on more than the threshold, never at it). */
export function moreThan(thresholdPercent: number): string {
  return `more than ${new BigNumber(thresholdPercent).toFixed()}%`;
}

/** The threshold of the rules as a percentage: `80%`. */
export const percentText = (percent: number): string => `${new BigNumber(percent).toFixed()}%`;

const SECONDS_PER_DAY = 86_400;

/** A span of time in days, one decimal at most (the rules' holds are whole days: 14 on XRPL, 5 on Xahau): `14 days`, `1 day`. */
export function daysText(seconds: number): string {
  const days = new BigNumber(seconds).div(SECONDS_PER_DAY).decimalPlaces(1, HALF_UP);
  return `${days.toFixed()} day${days.isEqualTo(1) ? "" : "s"}`;
}

/**
 * The bar of a yes share against the rules' threshold (the amendments list's rows and the amendment page's figure): the share to 2 decimals, out of 100, with the threshold
 * tick and the words that say the same in `label`. Where there are no trusted validators to share, the bar is empty (`"0"`) and its words say `—`.
 */
export function yesMeter(yes: number, trusted: number, thresholdPercent: number): MeterData {
  return {
    value: yesPercentValue(yes, trusted) ?? "0",
    max: "100",
    threshold: { value: new BigNumber(thresholdPercent).toFixed(), label: percentText(thresholdPercent) },
    label: `${count(yes)} of ${count(trusted)} UNL validators vote yes, ${yesPercentText(yes, trusted)}; ${moreThan(thresholdPercent)} needed`,
  };
}

// ---- Links (2.8) -------------------------------------------------------------------------------------------------------------------------------

/** A ledger named by the number it shows, `#107,748,095`, linked to its page (a ledger that exists: the next flag ledger is text, never a link). */
export function ledgerLink(net: string, index: number): { text: string; href: string } {
  return { text: `#${count(index)}`, href: `/${net}/ledger/${index}` };
}

/** The file a validator's domain publishes on the network whose software this is. */
export function tomlFileOf(software: Network["software"]): "xrp-ledger.toml" | "xahau.toml" {
  return software === "xahaud" ? "xahau.toml" : "xrp-ledger.toml";
}

/** What a host name is made of. A domain with anything else (a path, an `@`, a port) would make the address below another host's. */
const HOST_NAME = /^[A-Za-z0-9.-]+$/;

/**
 * The address of a validator's TOML file, if it may be linked: the domain verified, and the address is `https://{domain}/.well-known/{file}` with the validator's own domain
 * (anyone can put any domain in a manifest, and an unverified one is never a link). `null` otherwise.
 */
export function tomlLink(dv: DomainVerification | undefined, domain: string | undefined, software: Network["software"]): string | null {
  if (dv?.status !== "verified" || domain === undefined || !HOST_NAME.test(domain)) return null;
  return dv.toml_url === `https://${domain}/.well-known/${tomlFileOf(software)}` ? dv.toml_url : null;
}

const XLS_PATH = "/XRPLF/XRPL-Standards/";

/** An amendment's XLS document, if it may be linked: an `https` URL on github.com under `/XRPLF/XRPL-Standards/` (D1's own rule, checked again because it goes into a link). */
export function xlsLink(url: string | undefined): string | null {
  if (url === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const linkable =
    parsed.protocol === "https:" &&
    parsed.hostname === "github.com" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    // The parser has resolved `..` and `%2e%2e` by now, so a path that starts with the repository stays inside it.
    parsed.pathname.startsWith(XLS_PATH);
  return linkable ? parsed.href : null;
}

/**
 * The accounts a verified domain's TOML lists, each as a link to its page: the classic addresses with a valid checksum, in D1's order (an address goes into a link, so each is
 * checked again). `null` when the field is absent, and when nothing in it can be linked: there is no line to draw.
 */
export function accountLinks(net: string, accounts: readonly string[] | undefined): { address: string; href: string }[] | null {
  if (accounts === undefined) return null;
  const links = accounts.filter((address) => isValidClassicAddress(address)).map((address) => ({ address, href: `/${net}/account/${address}` }));
  return links.length > 0 ? links : null;
}

// ---- The verification note (4.2) ---------------------------------------------------------------------------------------------------------------

export type DomainStatusKind = DomainVerification["status"];

const UNVERIFIED = "The domain could not be verified.";

/** The sentence of an `unverified` domain: its `reason`, which D1 sets for that status only. A reason this file does not know (a newer D1), or one that lacks what its sentence needs, reads `UNVERIFIED`. */
function unverifiedSentence(dv: DomainVerification, domain: string, file: string): string {
  switch (dv.reason) {
    case "not_listed":
      return `The ${file} at ${domain} does not list this master key.`;
    case "toml_invalid":
      return `The ${file} at ${domain} could not be read as TOML.`;
    case "too_large":
      return `The ${file} at ${domain} is larger than 256 KiB.`;
    case "http_status":
      return dv.status_code === undefined ? UNVERIFIED : `${domain} answered HTTP ${dv.status_code} for its ${file}.`;
    case "dns_error":
      return `${domain} could not be reached (the DNS lookup failed). The data API tries again within the hour.`;
    case "connect_error":
      return `${domain} could not be reached (the connection failed). The data API tries again within the hour.`;
    case "tls_error":
      return `${domain} could not be reached (TLS failed). The data API tries again within the hour.`;
    case "timeout":
      return `${domain} could not be reached (it timed out). The data API tries again within the hour.`;
    case "redirect_rejected":
    case "blocked_address":
      return `${domain} sent the request where the data API does not follow.`;
    case "domain_invalid":
      return "The manifest's domain is not a valid domain name.";
    case "manifest_unverified":
      return "The manifest that names this domain could not be verified.";
    default:
      return UNVERIFIED;
  }
}

/**
 * The note under a validator's name that says what its domain's check found (4.2), as parts: the file name of a verified domain is a link (`external: "nofollow"`) when
 * `tomlLink` gives one. `null` without a domain, and for a domain the data API sent no verification of (nothing is known, so nothing is said).
 */
export function verificationNote(dv: DomainVerification | undefined, domain: string | undefined, software: Network["software"]): TextPart[] | null {
  if (domain === undefined || domain === "" || dv === undefined) return null;
  const file = tomlFileOf(software);
  switch (dv.status) {
    case "verified": {
      const href = tomlLink(dv, domain, software);
      const rest = ` at ${domain} lists this master key.${dv.checked === undefined ? "" : ` Checked ${formatDateTime(dv.checked)}.`}`;
      return href === null ? [`The ${file}${rest}`] : ["The ", { text: file, href, external: "nofollow" }, rest];
    }
    case "unverified":
      return [unverifiedSentence(dv, domain, file)];
    case "pending":
      return ["The domain has not been checked yet."];
    default:
      return [UNVERIFIED];
  }
}

// ---- Amendment statuses (2.5) ------------------------------------------------------------------------------------------------------------------

/** What the pill of an amendment's status draws (2.5), made once in the builder. A `majority` with no moment to count down to has `at: NaN` (`Countdown` draws nothing) and `fallback: ""`. */
export type AmendmentStatusView =
  | { status: "enabled"; retired: boolean }
  | { status: "majority"; activation: { at: number; fallback: string } }
  | { status: "voting" | "unknown"; share: string }
  | { status: "obsolete" };

/** A majority's activation: the moment, and the server's text for it, `expected Oct 23` (the UTC day). Without a majority, or with a time that is not one, no moment and no text. */
function activationOf(majority: AmendmentRow["majority"]): { at: number; fallback: string } {
  const at = majority === undefined ? Number.NaN : unixOf(majority.expected_activation);
  if (Number.isNaN(at)) return { at: Number.NaN, fallback: "" };
  return { at, fallback: `expected ${formatUtcDay(new Date(at * 1000).toISOString().slice(0, 10))}` };
}

/**
 * The view of an amendment's status. An enabled amendment is `enabled` whatever else its row has (`enabled` may be absent, or have no date). A `majority` row without its
 * `majority` is not what D1 serves; it gets no moment (see `AmendmentStatusView`), never a made-up one. A `voting` or `unknown` row without `votes` (no round stored yet), or
 * whose round had no trusted validators, has `—` for its share. A status this file does not know (a newer D1) is `unknown`.
 */
export function amendmentStatusView(row: AmendmentRow): AmendmentStatusView {
  switch (row.status) {
    case "enabled":
      return { status: "enabled", retired: row.retired === true };
    case "majority":
      return { status: "majority", activation: activationOf(row.majority) };
    case "obsolete":
      return { status: "obsolete" };
    default:
      return { status: row.status === "voting" ? "voting" : "unknown", share: row.votes === undefined ? DASH : yesPercentText(row.votes.yes, row.votes.trusted) };
  }
}
