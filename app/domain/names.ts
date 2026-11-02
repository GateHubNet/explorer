// What an account's entry in the data API's names batch becomes for the pages (E9, spec 3.3): the name to draw, its kind, the account network name, the domain, and the labels,
// with the one place that words the hover title and the plain text of an issuer. Pure and safe for the browser, because every page that shows an account draws it (and a
// client-side navigation renders it there): it imports the data API's types, which the compiler erases, and two pure files of the domain, nothing of app/server.
// `joinAnd` comes from join-and.ts and not time-words.ts: from there it would bring the dates and the countdown's words to every page that draws an account.

import type { AccountNameEntry } from "../server/api-types";
import { shortAddress } from "./format";
import { joinAnd } from "./join-and";

/** How a name is known: the toml of the account's domain lists the address (`verified`), GateHub gave the account the name (`account`), or only the account's domain says it (`domain`). */
export type NameKind = "verified" | "account" | "domain";

export interface NameView {
  /** Absent for an address that has labels, or an account network name, only. */
  name?: { text: string; kind: NameKind };
  /** The account network name ("hot wallet"). */
  network?: string;
  /** The account domain; it is a verified one exactly when `name.kind` is `verified`. */
  domain?: string;
  /** The labels' keys in the API's order (`scam`, `spam`, `advisory`); one this build does not know is kept as written. */
  labels: string[];
}

/** The view of each address that has something to show, by address. An address with nothing to show is not in it. */
export type NameMap = Readonly<Record<string, NameView>>;

/** What a page's data carries to the browser: the names of the addresses on the page, and whether they could be had (`off`: the switch is off, no call was made). */
export interface NamesPart {
  state: "ok" | "off" | "failed";
  map: NameMap;
}

/** The part of a page while `NAMES` is off. Frozen, because it is shared. */
export const NAMES_OFF: NamesPart = Object.freeze({ state: "off", map: Object.freeze({}) });

/** The part of a page with nothing to name (no address on it): no call was made and nothing failed. Frozen, because it is shared. */
export const NO_NAMES: NamesPart = Object.freeze({ state: "ok", map: Object.freeze({}) });

const KINDS: readonly string[] = ["verified", "account", "domain"] satisfies readonly NameKind[];
const isNameKind = (kind: string): kind is NameKind => KINDS.includes(kind);

/**
 * The bidi and format controls a name's text may hold (a toml's `desc` is the domain owner's text): the embeddings and overrides (U+202A to U+202E), the isolates (U+2066 to
 * U+2069), the left-to-right and right-to-left marks (U+200E, U+200F) and the Arabic letter mark (U+061C). In a `<title>`, an `<h1>` or an issuer's text they would turn
 * the words around the name.
 */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** `text` without its bidi and format controls (`BIDI_CONTROLS`). The view's name and network name are read through it, and the toml's words the account page shows. */
export const withoutBidiControls = (text: string): string => text.replace(BIDI_CONTROLS, "");

/** Text that says something, without its bidi controls: a key the API leaves out has no value, and an empty one (or one of controls alone) is the same. */
const textOf = (value: string | undefined): string | undefined => (value ? withoutBidiControls(value) || undefined : undefined);

/**
 * The view of an entry, or `null` when it has no name, no account network name and no label (most addresses), so that a map holds only addresses with something to show.
 * A name is read from `display_name` when its kind is one this build knows; another kind (the API may add one) is read as no name. A `domain` without a `display_name`
 * is no name either: it is how D4 answers when it could not read its toml store. A `verified` name always comes with its `domain` (D4's reference); one that does not has
 * nothing to be verified by, and is no name. The name and the network name are read without their bidi controls (`withoutBidiControls`); one that was nothing else is none.
 */
export function nameViewOf(entry: AccountNameEntry): NameView | null {
  const domain = textOf(entry.domain);
  const network = textOf(entry.account_network_name);
  const name = nameOf(entry, domain);
  const labels = Object.keys(entry.labels ?? {});
  if (!name && !network && labels.length === 0) return null;
  return { ...(name ? { name } : {}), ...(network ? { network } : {}), ...(domain ? { domain } : {}), labels };
}

function nameOf(entry: AccountNameEntry, domain: string | undefined): NameView["name"] {
  const shown = entry.display_name;
  if (!shown || !isNameKind(shown.kind)) return undefined;
  if (shown.kind === "verified" && domain === undefined) return undefined;
  const text = textOf(shown.text);
  return text === undefined ? undefined : { text, kind: shown.kind };
}

/** What a link to the account reads: the name, then ` · ` and the account network name when there is one and it is not the name itself. `''` when there is no name: the caller draws the address. */
export function linkTextOf(view: NameView): string {
  if (!view.name) return "";
  const { text } = view.name;
  return view.network && view.network !== text ? `${text} · ${view.network}` : text;
}

/** The hover title of an account: how its name is known and its address, then ` · Labelled {labels} by GateHub` when it has labels. */
export function nameTitleOf(view: NameView, address: string): string {
  const known = knownBy(view, address);
  return view.labels.length > 0 ? `${known} · Labelled ${labelWords(view.labels)} by GateHub` : known;
}

/** How the account's name is known, then its address; the address alone when there is no name. */
function knownBy(view: NameView, address: string): string {
  const vouched = vouchedByOf(view);
  if (vouched !== null) return `${vouched} · ${address}`;
  return view.name?.kind === "domain" ? `Domain not verified · ${address}` : address;
}

/**
 * What GateHub says of a name it stands behind, as the hover title, the account's description and its link-preview card say it: `Verified by northpeak.example` or `Named by GateHub`, whatever
 * labels the account has. `null` for a name only the account's domain gives, for an address with labels or a network name alone, and for no view.
 */
export function vouchedByOf(view: NameView | undefined): string | null {
  switch (view?.name?.kind) {
    case "verified":
      return `Verified by ${view.domain}`;
    case "account":
      return "Named by GateHub";
    default:
      return null;
  }
}

/** The name to put in running text: the link text of a verified or a GateHub-named account that has no label, else `null` (the caller writes the short address). */
export function plainNameOf(view: NameView | undefined): string | null {
  if (!view?.name || view.labels.length > 0) return null;
  return view.name.kind === "verified" || view.name.kind === "account" ? linkTextOf(view) : null;
}

/** An issuer in a page's text: its plain name, else its short address. */
export function shownIssuer(address: string, names: NameMap): string {
  return plainNameOf(names[address]) ?? shortAddress(address);
}

/**
 * An issued side as a list's row writes it (the markets and the AMM pools lists; display names spec 7 and decision 12): its code, and its issuer by `shownIssuer`, with `name` when
 * that is a name (which is not set in mono, as a code and an address are), and the issuer's labels, which the row marks (`LabelMark`) whatever its issuer reads.
 */
export interface IssuerPart {
  code: string;
  issuer: string;
  name?: true;
  labels: string[];
}

/** The `IssuerPart` of `code` (as the page writes the currency) and its `issuer`, through `names`. */
export function issuerPart(code: string, issuer: string, names: NameMap): IssuerPart {
  const name = plainNameOf(names[issuer]);
  return { code, issuer: name ?? shortAddress(issuer), ...(name === null ? {} : { name: true }), labels: names[issuer]?.labels ?? [] };
}

/** The labels as a sentence says them: `scam`, `scam and spam`, `scam, spam and advisory`. */
export function labelWords(labels: readonly string[]): string {
  return joinAnd(labels);
}

/** `shown`'s entries under `next`'s: for a live page that keeps the rows of an earlier beat, which keep their names. */
export function mergeNames(next: NameMap, shown: NameMap): NameMap {
  return { ...shown, ...next };
}

/** `next`'s state with both maps merged. A part with the switch off stays as it is: the earlier one has no names either. */
export function mergeNamesPart(next: NamesPart, shown: NamesPart): NamesPart {
  return next.state === "off" ? next : { state: next.state, map: mergeNames(next.map, shown.map) };
}
