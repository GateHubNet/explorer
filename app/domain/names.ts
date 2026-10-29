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

/** Text that says something: a key the API leaves out has no value, and an empty one is the same. */
const textOf = (value: string | undefined): string | undefined => (value ? value : undefined);

/**
 * The view of an entry, or `null` when it has no name, no account network name and no label (most addresses), so that a map holds only addresses with something to show.
 * A name is read from `display_name` when its kind is one this build knows; another kind (the API may add one) is read as no name. A `domain` without a `display_name`
 * is no name either: it is how D4 answers when it could not read its toml store. A `verified` name always comes with its `domain` (D4's reference); one that does not has
 * nothing to be verified by, and is no name.
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
  return { text: shown.text, kind: shown.kind };
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
  switch (view.name?.kind) {
    case "verified":
      return `Verified by ${view.domain} · ${address}`;
    case "account":
      return `Named by GateHub · ${address}`;
    case "domain":
      return `Domain not verified · ${address}`;
    default:
      return address;
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
