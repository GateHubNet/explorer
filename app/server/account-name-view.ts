// The name header of the account page, built from what the pages load (E9, spec 6.1 to 6.6): the title, the label banners, the line about the account's domain with its state,
// "How we know", and what else the domain's toml says. Pure and unit-tested, like the other view builders: the page's loader calls it once with the account's entry in the names
// batch (`NamesResult.entries`), the domain the node shows, and the toml of that domain, and the components only draw the result. Worker-only (the toml sentences are).
//
// The shown domain D is the node's (`liveDomain`), else the entry's (a deleted account has none in the batch: the data API gives one no domain; and the node may not have answered).
// It is compared with the entry's lower-cased. Its state is the board's:
//   - `verified`: the entry's name is a verified one and the entry's domain is D. The batch says the toml of D lists the account; the toml call only adds the time and the facts, so a
//     toml that failed to load does not take the name away;
//   - `not-verified`: the entry's domain is D, the batch did read its toml store (the entry has a name of a kind this build knows), and the toml has a row (it was read, or its check
//     failed) or its call failed. An entry that has a domain and no name (no `display_name`, or one of a kind this build does not know) is how the data API answers when it could not
//     read its toml store at all: nothing is known, so it is `pending`, never this (a name of kind `account` beside a domain cannot be told from that case; accepted);
//   - `pending` ("not checked yet"): any other domain that is well formed: the entry names another domain or none (the index is behind, or the account was dormant since before the
//     history), the toml was never read (`toml not found`), or there is no toml answer to say anything from;
//   - `none`: not a well formed domain (`https://x.com`, an IPFS hash): text, with no mark. This is also the only state in which the text is not lower-cased: the case of an IPFS
//     hash matters, and nothing that is not a domain reaches a link.

import { formatCurrency } from "../domain/format";
import { type NameKind, type NameView, nameViewOf, withoutBidiControls } from "../domain/names";
import { formatDate, formatDateTime, joinAnd } from "../domain/time-words";
import type { Loaded } from "./account-view";
import type { AccountNameEntry, LabelData, TomlAnswer, TomlData } from "./api-types";
import type { Network } from "./networks";
import { domainNotVerifiedSentence, tomlFileOf } from "./toml-words";

export type DomainState = "verified" | "not-verified" | "pending" | "none";

/** The `<h1>`'s text and how it is known. `network` is the account network name, when it is set and is not the text. */
export interface NameTitle {
  text: string;
  kind: NameKind;
  network?: string;
}

/** One warning banner: the label as the API writes it, its title, the operator's description, and its source and link when it gave them (the link only if it is https). */
export interface LabelBanner {
  label: string;
  title: string;
  description: string;
  source?: string;
  href?: string;
}

/** The line about the account's domain. `href` only for a verified domain; `note` is the sentence of a domain that is not verified, or "Not checked yet.". */
export interface DomainLine {
  text: string;
  state: DomainState;
  href?: string;
  note?: string;
}

/** "How we know" (a verified name): `descGivesName` is false when the name is the domain; `checked` is a time, when the toml has one to give. */
export interface HowWeKnow {
  domain: string;
  tomlHref: string;
  tomlText: string;
  descGivesName: boolean;
  checked?: string;
}

/**
 * What else the toml says (decision 10), each only when present: the principals as a sentence, the currencies, and the date in `[METADATA]`. A currency has the toml's code as the
 * data API gives it (`currency`, which a token link is made of) and the text the explorer writes for it (`code`).
 */
export interface TomlFacts {
  principals?: string;
  currencies?: { currency: string; code: string; issuer?: string }[];
  modified?: string;
}

export interface NameHeader {
  /** `null`: the address is the title. */
  title: NameTitle | null;
  labels: LabelBanner[];
  /** The label keys, for `LabelMark` beside the title. */
  labelMarks: string[];
  domainLine: DomainLine | null;
  howWeKnow: HowWeKnow | null;
  facts: TomlFacts | null;
  /** The sentence under a name GateHub gave. */
  help: "named" | null;
}

export interface NameHeaderInput {
  address: string;
  /** The account's entry of the names batch; none when the batch has nothing for it (or did not load). */
  entry?: AccountNameEntry;
  /** The domain the node shows (`live.domain`); `null` without live state or without a domain. */
  liveDomain: string | null;
  /** The toml of the domain: `null` when none was asked for. */
  toml: Loaded<TomlAnswer> | null;
  network: Pick<Network, "software" | "id">;
  /** The page behind a marker shows the title and the labels only (Ruling 8). */
  brief?: boolean;
}

/** rippled's `isProperlyFormedTomlDomain`: two or more labels of letters, digits and hyphens that neither start nor end with a hyphen, and an alphabetic last label. */
const DOMAIN = /^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$/;

/** Whether `text` is a domain as rippled reads one: 4 to 128 characters, shaped as above. (The length goes first: the text may be anything the node holds.) */
export function isProperlyFormedDomain(text: string): boolean {
  return text.length >= 4 && text.length <= 128 && DOMAIN.test(text);
}

/**
 * A label's link, only when it is `https:` (anything else, or text that is no URL, is not linked). It is the URL as it parses, not the text as given: `https:host/x` reports `https:`
 * but in a page resolves as a relative link, and leading spaces survive in the text.
 */
function httpsLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function bannerOf(label: string, data: LabelData): LabelBanner {
  const href = httpsLink(data.url);
  return {
    label,
    title: `Labelled ${label} by GateHub`,
    description: data.description,
    ...(data.source ? { source: data.source } : {}),
    ...(href ? { href } : {}),
  };
}

/** The time "How we know" says the toml was checked: of the latest check when it read the file, and of the last good read when the latest failed within the data API's grace. */
function checkedOf(toml: Loaded<TomlAnswer> | null): string | undefined {
  if (toml?.state !== "ok") return undefined;
  const data = toml.value.toml;
  if (data.status === "ok") return formatDateTime(data.checked);
  return data.fetched === undefined ? undefined : formatDateTime(data.fetched);
}

/**
 * What else the toml says, for a verified name whose content is in effect (`fetched` is there: also after a failed re-read within the grace); `null` when it says none of it.
 */
function factsOf(toml: Loaded<TomlAnswer> | null): TomlFacts | null {
  if (toml?.state !== "ok") return null;
  const data: TomlData = toml.value.toml;
  if (data.fetched === undefined) return null;
  // The toml is the domain owner's text: the words shown are without their bidi controls, which would turn the words around them. The raw code is kept for the token link.
  const principals = data.principals && data.principals.length > 0 ? joinAnd(data.principals.map(withoutBidiControls)) : undefined;
  const currencies =
    data.currencies && data.currencies.length > 0
      ? data.currencies.map(({ code, issuer }) => ({ currency: code, code: withoutBidiControls(formatCurrency(code)), ...(issuer ? { issuer } : {}) }))
      : undefined;
  const modified = data.modified ? formatDate(data.modified) : undefined;
  if (!principals && !currencies && !modified) return null;
  return { ...(principals ? { principals } : {}), ...(currencies ? { currencies } : {}), ...(modified ? { modified } : {}) };
}

/** "How we know" of a verified name: where the toml is, whether its `desc` gives the name, and when it was checked. `domain` is D lower-cased. */
function howWeKnowOf(domain: string, name: NameView["name"], toml: Loaded<TomlAnswer> | null, file: string): HowWeKnow {
  const checked = checkedOf(toml);
  return {
    domain,
    tomlHref: `https://${domain}/.well-known/${file}`,
    tomlText: `${domain}/.well-known/${file}`,
    descGivesName: name?.text !== domain,
    ...(checked ? { checked } : {}),
  };
}

/**
 * The line about the domain `domain` (D, lower-cased when well formed), with its state (see the top of the file). `entry.domain` is compared lower-cased; `name` is the entry's name
 * of a kind this build knows.
 */
function domainLineOf(domain: string, entry: AccountNameEntry | undefined, name: NameView["name"], toml: Loaded<TomlAnswer> | null, file: string): DomainLine {
  if (!isProperlyFormedDomain(domain)) return { text: domain, state: "none" };
  const named = entry?.domain?.toLowerCase() === domain;
  if (named && name?.kind === "verified") return { text: domain, state: "verified", href: `https://${domain}` };
  if (named && name !== undefined && toml && toml.state !== "missing") {
    return { text: domain, state: "not-verified", note: domainNotVerifiedSentence(domain, file, toml) };
  }
  return { text: domain, state: "pending", note: "Not checked yet." };
}

/**
 * The name header of the account page. `brief` (the page behind a marker) is the title and the labels only. The title is the entry's display name (none for an address with only a
 * network name, or a kind this build does not know); the account page draws the address when there is none.
 */
export function accountNameHeader(input: NameHeaderInput): NameHeader {
  const { entry, liveDomain, toml, network } = input;
  const view = entry ? nameViewOf(entry) : null;
  const name = view?.name;
  const title: NameTitle | null = name ? { text: name.text, kind: name.kind, ...(view.network && view.network !== name.text ? { network: view.network } : {}) } : null;
  const labels = Object.entries(entry?.labels ?? {}).map(([label, data]) => bannerOf(label, data));
  const labelMarks = labels.map((banner) => banner.label);

  if (input.brief) return { title, labels, labelMarks, domainLine: null, howWeKnow: null, facts: null, help: null };

  const shown = liveDomain || entry?.domain || undefined;
  // A domain is a host name: its case does not matter, and the entry's is lower-cased by the data API. Anything else (an IPFS hash) is shown as it was written.
  const domain = shown !== undefined && isProperlyFormedDomain(shown) ? shown.toLowerCase() : shown;
  const file = tomlFileOf(network.software);
  const domainLine = domain === undefined ? null : domainLineOf(domain, entry, name, toml, file);
  const verified = domainLine?.state === "verified";

  return {
    title,
    labels,
    labelMarks,
    domainLine,
    howWeKnow: verified ? howWeKnowOf(domainLine.text, name, toml, file) : null,
    facts: verified ? factsOf(toml) : null,
    help: title?.kind === "account" ? "named" : null,
  };
}
