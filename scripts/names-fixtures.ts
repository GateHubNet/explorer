// The display names' fixtures (E9, display-names spec 10): for each network, `data-api/account_names.json`, the names of the addresses the other fixtures show, and
// `data-api/toml/<domain>.json`, the tomls of their domains, as D4 would answer them (data-api-new `feat/explorer-data-2` at 3feb11a, docs/api-reference.md, "Account names
// and tomls"; the display-name rule of apps/api/src/names/display-name.ts, the key orders of account-names-object.ts and toml-object.ts). Synthetic: nothing here is
// recorded, every name is fictional and every domain `*.example` (RFC 2606). `generate()` in http-fixtures.ts calls `namesFixtures` last, for each network, over every other
// file of the network, generated or written by hand; the upstream mock composes `GET /v2/account_names` from `account_names.json` (test/support/upstream-core.ts), and
// serves a toml from its file (`toml not found` for a domain without one).
//
// - The fixed cases (decision 11, `FIXED_NAMES`, as plan Ruling 11 amends them): each network's active hand-written account is verified by a domain whose toml
//   lists it with a `desc`, its principals, two currencies and `modified`; one account named by GateHub (with a network name on XRPL), one whose domain is not verified (an
//   `ok` toml that does not list it on XRPL, a toml that failed on a 404 on Xahau), and labels: `scam`, `spam` alone, and `advisory` with its `source` and `url`.
// - The seeded ones: up to `NAMES_SEEDED_MAX` other addresses, collected (`collectAddresses`) from the files of `NAMES_SOURCES`, in that order. `fnv1a32("<net>:<address>")`
//   picks the state, `% 40`: 0–7 verified, 8–12 named by GateHub (with an account network name when the hash's bit 8 is set), 13–16 domain not verified, the rest nothing;
//   the name and the domain (`{word}-{hex4}.example`, one per address) come from the word lists below by the same hash. Each verified domain has an `ok` toml that lists its
//   account with its `desc`, but the first seeded verified address by sort, which is listed without one (its name is its domain); every second seeded "domain not verified"
//   address by sort has an `ok` toml that lists nobody, the others none.
// - A deleted account has no domain in D4 (its `AccountRoot` is gone): a seeded address the fixtures mark deleted (`deletedAccounts`) gets the "named by GateHub" state or none.
//
// Only addresses with something to show are written, one entry to a line, sorted by address, the keys in D4's order; empty lists are left out, as D4 leaves them, and the
// times are fixed. The objects are built in D4's order and written as built (`fixtureText` would sort their keys), so `namesAnswers` gives them before serialization for the
// tests (test/unit/names-fixtures.test.ts) and `namesFixtures` the text. Like the other generators, this module reads nothing of http-fixtures.ts.

import { fnv1a32 } from "../app/domain/fnv";
import type { AccountNameEntry, DisplayNameKind, LabelData, TomlData } from "../app/server/api-types";
import { collectAddresses } from "../app/server/names-collect";
import { dataApiFile, type NetworkName } from "../test/support/upstream-core";

/** The most addresses that are seeded, besides the fixed ones. */
export const NAMES_SEEDED_MAX = 500;

/**
 * The files the seeded addresses are collected from, in priority order, as paths below `<net>/data-api/` (the files of one pattern by path, a file under the first
 * pattern it matches): the hand-written accounts and their balances, the eight newest transactions, every served transaction (not its `?binary=true` form), the
 * hand-written accounts' first pages, the pair pages' active accounts, the AMM pages, the validators list, and E8's sales, collections and NFTs.
 */
export const NAMES_SOURCES: readonly RegExp[] = [
  /^accounts\/r[^/]+\.json$/,
  /^accounts\/r[^/]+\/balances\.json$/,
  /^transactions@descending=true&limit=8\.json$/,
  /^transactions\/[0-9A-F]{64}\.json$/,
  /^accounts\/r[^/]+\/(transactions|payments|exchanges)@descending=true&limit=20\.json$/,
  /^active_accounts\//,
  /^amm\//,
  /^network\/validators@/,
  /^nft_sales@/,
  /^nft_collections\//,
  /^nfts\//,
];

/** The paths (below test/fixtures/http/) that this generator writes: each network's `data-api/account_names.json` and `data-api/toml/<domain>.json`. */
export function isNamesGenerated(path: string): boolean {
  return /^(xrpl|xahau)\/data-api\/(account_names\.json|toml\/[^/]+\.json)$/.test(path);
}

// ---- What D4 says of an address ---------------------------------------------------------------------------------------------

/** The labels the operator can put on an address, in the order D4 serves them. */
const LABEL_ORDER = ["scam", "spam", "advisory"] as const;
type LabelName = (typeof LABEL_ORDER)[number];

/**
 * What the data API knows of one address, from which its entry is worked out by D4's rule: the account domain (as D4 reads the account's `Domain`), the operator's names and
 * labels (ADR-0014), and the toml stored for the domain (none: the domain has no row, `toml not found`).
 */
export interface NameFacts {
  address: string;
  domain?: string;
  account_name?: string;
  account_network_name?: string;
  labels?: Partial<Record<LabelName, LabelData>>;
  toml?: TomlData;
}

/** A fixed case of decision 11: the facts of the address, and who it is in the hand-written fixtures. */
export interface FixedName extends NameFacts {
  shownAs: string;
}

/** When the `tomls` worker checked and read every toml of the fixtures: the morning of T (2026-10-17), the day the recordings are dated to. Fixed, so a run writes the same bytes. */
const CHECKED = "2026-10-17T06:00:00.000Z";
/** The `modified` of the fixed verified tomls' `[METADATA]`. */
const MODIFIED = "2026-10-02T00:00:00Z";

/** Where a domain's toml is read on a network: XRPL's `xrp-ledger.toml`, Xahau's `xahau.toml`. */
const tomlUrl = (net: NetworkName, domain: string): string => `https://${domain}/.well-known/${net === "xrpl" ? "xrp-ledger" : "xahau"}.toml`;

/** An `ok` toml, its keys in D4's order and its empty lists left out. */
function okToml(net: NetworkName, domain: string, content: Pick<TomlData, "modified" | "accounts" | "currencies" | "principals"> = {}): TomlData {
  const toml: TomlData = { domain, toml_url: tomlUrl(net, domain), status: "ok", checked: CHECKED, fetched: CHECKED };
  if (content.modified !== undefined) toml.modified = content.modified;
  for (const list of ["accounts", "currencies", "principals"] as const) {
    const items = content[list];
    if (items !== undefined && items.length > 0) (toml as unknown as Record<string, unknown>)[list] = items;
  }
  return toml;
}

/** A toml whose file the worker got a 404 for: a definite failure, which carries nothing but the check (no `fetched`, no content). */
const failed404 = (net: NetworkName, domain: string): TomlData => ({ domain, toml_url: tomlUrl(net, domain), status: "failed", reason: "http_status", status_code: 404, checked: CHECKED });

/** The toml of a fixed verified account: it lists the account with its `desc`, the principals, two currencies the account issues (one with its decimals and name), `modified`. */
function verifiedToml(net: NetworkName, domain: string, address: string, desc: string, prefix: string, dollar: string): TomlData {
  return okToml(net, domain, {
    modified: MODIFIED,
    accounts: [{ address, desc }],
    currencies: [
      { code: `${prefix}USD`, issuer: address, display_decimals: 2, name: dollar },
      { code: `${prefix}EUR`, issuer: address },
    ],
    principals: ["Mara Lindqvist", "Tomas Okafor"],
  });
}

const TEST_LABEL: LabelData = { description: "Test label" };

/**
 * The fixed cases (decision 11, the plan's table as plan Ruling 11 amends it: a deleted account has no domain in D4, so Xahau's deleted account keeps its label only, and
 * `saltmarsh.example` is the domain of an active account the fixtures show, `rJ5mvu…`, which paid the active account in the newest recorded ledger). The active accounts'
 * domains are their `Domain` in `node/account_info/` too. Descriptions say they are test data.
 */
export const FIXED_NAMES: Record<NetworkName, readonly FixedName[]> = {
  xrpl: [
    {
      shownAs: "the active account",
      address: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh",
      domain: "northpeak.example",
      toml: verifiedToml("xrpl", "northpeak.example", "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", "Northpeak Treasury", "NP", "Northpeak Dollar"),
    },
    {
      shownAs: "the deleted account",
      address: "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC",
      account_name: "Harborline Exchange",
      account_network_name: "hot wallet",
      labels: { advisory: { description: "Test label: withdrawals paused", source: "GateHub", url: "https://status.example/harborline" } },
    },
    { shownAs: "the active account's parent", address: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", labels: { spam: TEST_LABEL } },
    {
      shownAs: "the deleted account's parent",
      address: "rURtT5MMFzSUR54MAq9MKfzBoezTBZbKns",
      domain: "lowtide.example",
      labels: { scam: TEST_LABEL },
      toml: okToml("xrpl", "lowtide.example"),
    },
  ],
  xahau: [
    {
      shownAs: "the active account",
      address: "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto",
      domain: "tidewater.example",
      toml: verifiedToml("xahau", "tidewater.example", "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto", "Tidewater Reserve", "TW", "Tidewater Dollar"),
    },
    { shownAs: "the deleted account", address: "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD", labels: { scam: TEST_LABEL } },
    { shownAs: "the accounts' parent", address: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8", account_name: "Hookfield Labs" },
    {
      shownAs: "an active account that paid the active account in the newest recorded ledger",
      address: "rJ5mvuNKjbjdghjCn5AGXXJFhJGgqdg9Q5",
      domain: "saltmarsh.example",
      toml: failed404("xahau", "saltmarsh.example"),
    },
  ],
};

/** The longest `desc` that is a verified name, in code points (D4's `VERIFIED_DESC_MAX`). */
const VERIFIED_DESC_MAX = 64;

/**
 * An address's entry as D4 serves it: `displayNameOf` of display-name.ts (verified when the toml of the domain lists the address, its `desc` of 1 to 64 code points or
 * else the domain; else the operator's name, else its network name; else the domain), then `accountNameObject`'s keys in order, the ones without a value left out.
 */
function entryOf({ address, domain, account_name, account_network_name, labels, toml }: NameFacts): AccountNameEntry {
  // What the stored toml says of the address: the entry that lists it, or `null` (not listed, or no toml).
  const listed = domain === undefined ? undefined : (toml?.accounts?.find((account) => account.address === address) ?? null);
  let display_name: { text: string; kind: DisplayNameKind } | undefined;
  if (domain !== undefined && listed) {
    const desc = listed.desc ?? "";
    const length = [...desc].length;
    display_name = { text: length >= 1 && length <= VERIFIED_DESC_MAX ? desc : domain, kind: "verified" };
  } else if ((account_name ?? account_network_name) !== undefined) {
    display_name = { text: (account_name ?? account_network_name)!, kind: "account" };
  } else if (domain !== undefined && listed === null) {
    display_name = { text: domain, kind: "domain" };
  }

  const entry: AccountNameEntry = { address };
  if (display_name !== undefined) entry.display_name = { text: display_name.text, kind: display_name.kind };
  if (domain !== undefined) entry.domain = domain;
  if (account_name !== undefined) entry.account_name = account_name;
  if (account_network_name !== undefined) entry.account_network_name = account_network_name;
  if (labels !== undefined) {
    const ordered: Record<string, LabelData> = {};
    for (const name of LABEL_ORDER) {
      const label = labels[name];
      if (label === undefined) continue;
      ordered[name] = { description: label.description, ...(label.source !== undefined && { source: label.source }), ...(label.url !== undefined && { url: label.url }) };
    }
    entry.labels = ordered;
  }
  return entry;
}

// ---- The seeded addresses ---------------------------------------------------------------------------------------------------

/** The first word of a seeded name, and of its domain. Fictional, and none a word of the fixed cases. */
const NAME_WORDS = [
  "Alder", "Bramble", "Cinder", "Driftwood", "Elmstead", "Fernhill", "Granite", "Heron", "Ironbark", "Juniper", "Kestrel", "Larkspur",
  "Meadow", "Nettle", "Oakmoor", "Pebble", "Quillon", "Rowan", "Sorrel", "Thistle", "Umber", "Vellum", "Willow", "Yarrow",
] as const;
/** The second word of a seeded name. */
const KIND_WORDS = ["Treasury", "Exchange", "Payments", "Labs", "Holdings", "Markets", "Custody", "Ventures"] as const;
/** A seeded account network name. */
const NETWORK_NAME_WORDS = ["hot wallet", "cold wallet", "issuer", "fee wallet"] as const;

type SeededState = "verified" | "named" | "domain" | "none";

/** What the hash of a seeded address picks: its state, its name, its network name (bit 8) and its domain (`{word}-{hex4}.example`, the hash's upper 16 bits). */
function seedOf(net: NetworkName, address: string): { state: SeededState; name: string; networkName?: string; domain: string } {
  const hash = fnv1a32(`${net}:${address}`);
  const at = hash % 40;
  const state: SeededState = at < 8 ? "verified" : at < 13 ? "named" : at < 17 ? "domain" : "none";
  const word = NAME_WORDS[(hash >>> 10) % NAME_WORDS.length]!;
  return {
    state,
    name: `${word} ${KIND_WORDS[(hash >>> 16) % KIND_WORDS.length]}`,
    ...((hash & 0x100) !== 0 && { networkName: NETWORK_NAME_WORDS[(hash >>> 20) % NETWORK_NAME_WORDS.length] }),
    domain: `${word.toLowerCase()}-${(hash >>> 16).toString(16).padStart(4, "0")}.example`,
  };
}

/** The files of a network below `<net>/data-api/`, the names' own left out, by their path below it. */
function dataApiFiles(net: NetworkName, files: ReadonlyMap<string, string>): Map<string, string> {
  const prefix = `${net}/data-api/`;
  const below = new Map<string, string>();
  for (const [path, text] of files) if (path.startsWith(prefix) && !isNamesGenerated(path)) below.set(path.slice(prefix.length), text);
  return below;
}

/** The seeded addresses of a network: up to `NAMES_SEEDED_MAX` addresses of the files of `NAMES_SOURCES`, in its order and each file's, none of them fixed. */
export function seededAddresses(net: NetworkName, files: ReadonlyMap<string, string>): string[] {
  const below = dataApiFiles(net, files);
  const paths = [...below.keys()].sort();
  const taken = new Set<string>();
  const parts: unknown[] = [];
  for (const source of NAMES_SOURCES) {
    for (const path of paths) {
      if (taken.has(path) || !source.test(path)) continue;
      taken.add(path);
      parts.push(JSON.parse(below.get(path)!));
    }
  }
  const fixed = new Set(FIXED_NAMES[net].map(({ address }) => address));
  return collectAddresses(...parts)
    .filter((address) => !fixed.has(address))
    .slice(0, NAMES_SEEDED_MAX);
}

/** Calls `visit` on every object of `value`, depth first. */
function eachObject(value: unknown, visit: (object: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) for (const item of value) eachObject(item, visit);
  else if (typeof value === "object" && value !== null) {
    visit(value as Record<string, unknown>);
    for (const item of Object.values(value)) eachObject(item, visit);
  }
}

/**
 * The accounts the fixtures of a network mark deleted, which D4 gives no domain: an `AccountRoot` a transaction's metadata deleted (`DeletedNode`; an `AccountDelete`'s, an
 * AMM pool's last withdrawal), a pool the data API says is `deleted` (its `amm_account`), and a hand-written account the data API knows and the node does not
 * (`data-api/accounts/<address>.json` without `node/account_info/<address>.json`, as test/unit/http-fixtures.test.ts has the deleted accounts). The recordings re-create none of them.
 */
export function deletedAccounts(net: NetworkName, files: ReadonlyMap<string, string>): Set<string> {
  const deleted = new Set<string>();
  for (const [path, text] of dataApiFiles(net, files)) {
    const removed = text.includes('"DeletedNode"');
    const pool = path.startsWith("amm/") && text.includes('"deleted"');
    if (removed || pool) {
      eachObject(JSON.parse(text), (object) => {
        const node = object.DeletedNode as { LedgerEntryType?: unknown; FinalFields?: { Account?: unknown } } | undefined;
        if (node?.LedgerEntryType === "AccountRoot" && typeof node.FinalFields?.Account === "string") deleted.add(node.FinalFields.Account);
        if (pool && object.deleted === true && typeof object.amm_account === "string") deleted.add(object.amm_account);
      });
    }
    const account = /^accounts\/(r[^/]+)\.json$/.exec(path)?.[1];
    if (account !== undefined && !files.has(`${net}/node/account_info/${account}.json`)) deleted.add(account);
  }
  return deleted;
}

/** The facts of the seeded addresses: the hash's state (a deleted account loses a domain's), the tomls by the rules at the top. */
function seededFacts(net: NetworkName, seeded: readonly string[], deleted: ReadonlySet<string>): NameFacts[] {
  const sorted = [...seeded].sort();
  const seeds = new Map(sorted.map((address) => [address, seedOf(net, address)]));
  const stateOf = (address: string): SeededState => {
    const { state } = seeds.get(address)!;
    return deleted.has(address) && (state === "verified" || state === "domain") ? "none" : state;
  };
  const verified = sorted.filter((address) => stateOf(address) === "verified");
  const unverified = sorted.filter((address) => stateOf(address) === "domain");

  return sorted.map((address): NameFacts => {
    const { name, networkName, domain } = seeds.get(address)!;
    switch (stateOf(address)) {
      case "verified":
        // the first by sort is listed without its `desc`: its name is its domain
        return { address, domain, toml: okToml(net, domain, { accounts: [address === verified[0] ? { address } : { address, desc: name }] }) };
      case "named":
        return { address, account_name: name, ...(networkName !== undefined && { account_network_name: networkName }) };
      case "domain":
        // every second by sort has an `ok` toml, which lists nobody; the others have none
        return { address, domain, ...(unverified.indexOf(address) % 2 === 1 && { toml: okToml(net, domain) }) };
      case "none":
        return { address };
    }
  });
}

// ---- The files --------------------------------------------------------------------------------------------------------------

/** A names file before serialization: its path below test/fixtures/http/ and its value (`account_names.json`'s entries by address, or a toml's answer). */
export interface NamesAnswer {
  path: string;
  value: unknown;
}

/** Every names file of a network, before serialization: `account_names.json` first, then the tomls by domain. `files` are the network's other files (paths below test/fixtures/http/). */
export function namesAnswers(net: NetworkName, files: ReadonlyMap<string, string>): NamesAnswer[] {
  const deleted = deletedAccounts(net, files);
  for (const { address, domain } of FIXED_NAMES[net]) {
    if (domain !== undefined && deleted.has(address)) throw new Error(`${net}: ${address} is deleted, and a deleted account has no domain`);
  }
  const facts: NameFacts[] = [...FIXED_NAMES[net], ...seededFacts(net, seededAddresses(net, files), deleted)];

  const tomls = new Map<string, TomlData>();
  const domains = new Set<string>();
  for (const { address, domain, toml } of facts) {
    if (domain === undefined) continue;
    if (domains.has(domain)) throw new Error(`${net}: the domain ${domain} of ${address} is another address's too`);
    domains.add(domain);
    if (toml !== undefined) tomls.set(domain, toml);
  }

  const entries = facts
    .map((each) => entryOf(each))
    .filter((entry) => Object.keys(entry).length > 1)
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  const answers: NamesAnswer[] = [{ path: `${net}/data-api/account_names.json`, value: Object.fromEntries(entries.map((entry) => [entry.address, entry])) }];
  for (const domain of [...tomls.keys()].sort()) {
    const path = dataApiFile(net, `/v2/toml/${domain}`, "");
    if (path === undefined) throw new Error(`${net}: no file for the toml of ${domain}`);
    answers.push({ path, value: { result: "success", toml: tomls.get(domain)! } });
  }
  return answers;
}

/** `account_names.json`'s text: one entry to a line, as the entries come. */
function namesText(entries: Record<string, AccountNameEntry>): string {
  const lines = Object.entries(entries).map(([address, entry]) => `  ${JSON.stringify(address)}: ${JSON.stringify(entry)}`);
  return `{\n${lines.join(",\n")}\n}\n`;
}

/** Every names file of a network: path below test/fixtures/http/ and text, the keys as they were built (D4's order). */
export function namesFixtures(net: NetworkName, files: ReadonlyMap<string, string>): Array<[path: string, text: string]> {
  return namesAnswers(net, files).map(({ path, value }) => [
    path,
    path.endsWith("/account_names.json") ? namesText(value as Record<string, AccountNameEntry>) : `${JSON.stringify(value, null, 2)}\n`,
  ]);
}
