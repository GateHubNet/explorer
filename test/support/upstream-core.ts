// The answering half of the upstream mock, free of any runtime: a request in, a Response out, the fixtures behind
// an interface. `upstream.ts` (the `fetch` stub of the Worker tests) and `fixture-server.ts` (the Node HTTP server
// of the end-to-end suite) both sit on it, and `scripts/make-http-fixtures.ts` uses its file naming, so a fixture
// is found by the same rule it was written by. Types and standard Web APIs only (Request, Response, URL), and the address
// codec, which checks the addresses of a names call as the data API does (both runtimes load it: the Worker uses it too).
//
// Fixtures live in test/fixtures/http/<net>/ (README.md, "Upstream fixtures"):
//
//   data-api/<path after /v2/>[@<sorted query>].json    the body of a data API answer
//   node/<method>/<subject>[@<other params>].json       the whole JSON-RPC answer of a node
//   ledger-hashes.json                                  ledger hash -> index, so a ledger is stored once
//
// Override keys (second argument of `mockUpstream`), optionally prefixed with a network (`xahau GET ...`):
//
//   GET /v2/transactions/<HASH>?...   a data API request: path and query; the order of the query is free
//   node tx <HASH>                    a node request, by its subject (the transaction, ledger or account asked for)
//   node ledger expand=true&ledger_index=107721455&transactions=true
//                                     the same request by all its parameters (sorted), for when a subject has
//                                     several shapes; the most specific key wins
//   node server_state                 a request without a subject
//   node book_offers XRP_524C…+rMx…   a book by its subject: `<taker_gets>_<taker_pays>`, each asset the native code or `CUR+issuer`
//                                     (the currency as the ledger holds it)
//   node amm_info rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3
//                                     a pool by its account; by its pair the subject is `<asset>_<asset2>`, written as a book's
//   node nft_info <NFT ID>            an NFT by its id (so are `nft_sell_offers` and `nft_buy_offers`); `node ledger_entry <ID>` a ledger entry (a URIToken) by its `index`
//   GET /v2/account_names             without a query: every names call of the network (`GET /v2/account_names?addresses=…` is one call, and wins over it)
//
// `GET /v2/account_names` has no file per call: the mock composes D4's answer from the network's `data-api/account_names.json` (`composeAccountNames`).

import { isValidClassicAddress } from "ripple-address-codec";

export const NETWORK_NAMES = ["xrpl", "xahau"] as const;
export type NetworkName = (typeof NETWORK_NAMES)[number];

/** Where each network's upstreams are reached: a base URL for the data API (no `/v2`) and the node's URL. */
export type UpstreamBases = Record<NetworkName, { dataApi: string; node: string }>;

/** The fixture files, by path relative to test/fixtures/http/ (`xrpl/data-api/last_validated.json`). */
export interface FixtureFiles {
  /** The text of the file, or `undefined` when there is none. */
  read(path: string): Promise<string | undefined>;
}

/**
 * What replaces an answer. A function gets the request and returns the Response; a `Response` is captured (status, status
 * text, headers and body) when the mock is made and rebuilt for every request, see `capture`; `null` removes the fixture
 * (the answer is then the "absent" one); anything else is a JSON body: the body of a data API answer (status 200) or the
 * `result` of a node's.
 */
export type Override = unknown;
export type Overrides = Record<string, Override>;

export type RequestKind = "data-api" | "node";

/** A request the mock answered. */
export interface SeenRequest {
  net: NetworkName;
  kind: RequestKind;
  /** The most specific override key that names it: `GET /v2/ledgers/107721455?expand=true&transactions=true`. */
  key: string;
  method: string;
  url: string;
  headers: Headers;
  /** A node's parsed JSON-RPC body. */
  body?: unknown;
  /** Where the answer came from. */
  source: "fixture" | "override" | "absent";
  status: number;
}

export interface Upstream {
  /** Answers a request to one of the upstreams, or `undefined` for a URL that is none of them. */
  handle(request: Request): Promise<Response | undefined>;
  requests: SeenRequest[];
  /** The override keys no request has used yet: a typo in a key shows up here. */
  unusedOverrides(): string[];
}

// ---- Keys ------------------------------------------------------------------------------------------------------------

const HEX64 = /^[0-9a-fA-F]{64}$/;

/** `a=1&b=2` with the parameters sorted by name and then value; the order a client sends them in is not a difference. */
export function canonicalQuery(search: string | URLSearchParams): string {
  const params = new URLSearchParams(search);
  const pairs = [...params.entries()].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The segments of a path, percent-decoded, a 64-digit hex one (a hash, which the API reads in any case) upper-cased. */
function segmentsOf(pathname: string): string[] {
  return pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decoded(segment))
    .map((segment) => (HEX64.test(segment) ? segment.toUpperCase() : segment));
}

/** `GET /v2/ledgers/107721455?expand=true&transactions=true` for a path under the data API's base. */
export function dataApiKey(pathname: string, search: string): string {
  const query = canonicalQuery(search);
  return `GET /${segmentsOf(pathname).join("/")}${query ? `?${query}` : ""}`;
}

type NodeParams = Record<string, unknown>;

const SUBJECT_PARAMS: Record<string, string[]> = {
  tx: ["transaction"],
  ledger: ["ledger_hash", "ledger_index"],
  account_info: ["account"],
  account_objects: ["account"],
  // The pool form: the subject is the pool account. The pair form has no such parameter, see `PAIR_PARAMS`.
  amm_info: ["amm_account"],
  // The NFT commands (rippled's and Clio's) are about one NFT; a `ledger_entry` asked by `index` is about the entry, which for a URIToken is its id.
  nft_info: ["nft_id"],
  nft_sell_offers: ["nft_id"],
  nft_buy_offers: ["nft_id"],
  ledger_entry: ["index"],
};

/** The methods whose subject is two assets, and the parameters that hold them: a book's, and an `amm_info` asked by pair. */
const PAIR_PARAMS: Record<string, [string, string]> = {
  book_offers: ["taker_gets", "taker_pays"],
  amm_info: ["asset", "asset2"],
};

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * An asset object of a request written in the API's form: the native code alone, or `CUR+issuer` with the currency as the ledger holds it.
 * Written inline, as upstream-core imports no app code. `undefined` for anything that is not an asset.
 */
function assetSubject(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { currency, issuer } = value as { currency?: unknown; issuer?: unknown };
  if (typeof currency !== "string") return undefined;
  if (issuer === undefined) return currency;
  return typeof issuer === "string" ? `${currency}+${issuer}` : undefined;
}

/** `<first>_<second>` of a request that names two assets, else `undefined`. */
function pairSubject(method: string, params: NodeParams): string | undefined {
  const names = PAIR_PARAMS[method];
  if (names === undefined) return undefined;
  const [first, second] = names.map((name) => assetSubject(params[name]));
  return first === undefined || second === undefined ? undefined : `${first}_${second}`;
}

/** The subject of a node request (what it asks about), upper-casing a hash; `undefined` for a request without one. */
export function nodeSubject(method: string, params: NodeParams): string | undefined {
  for (const name of SUBJECT_PARAMS[method] ?? []) {
    if (params[name] !== undefined) {
      const value = text(params[name]);
      return HEX64.test(value) ? value.toUpperCase() : value;
    }
  }
  return pairSubject(method, params);
}

/** All the parameters of a node request as `a=1&b=2`, sorted; a hash is upper-cased as in `nodeSubject`. */
function nodeParamsText(params: NodeParams): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const asText = text(value);
    query.set(name, HEX64.test(asText) ? asText.toUpperCase() : asText);
  }
  return canonicalQuery(query);
}

/** The override keys a node request answers to, the most specific first. */
export function nodeKeys(method: string, params: NodeParams): string[] {
  const all = nodeParamsText(params);
  const exact = all ? `node ${method} ${all}` : `node ${method}`;
  const subject = nodeSubject(method, params);
  return subject === undefined ? [exact] : [exact, `node ${method} ${subject}`];
}

/** The params of a node request apart from its subject, as `a=1&b=2`; `ledger_index=validated` is the default and left out. */
function nodeRest(method: string, params: NodeParams): string {
  const subjectNames = new Set(SUBJECT_PARAMS[method] ?? []);
  // A request whose subject is its two assets has them in its file name already.
  if (![...subjectNames].some((name) => params[name] !== undefined)) {
    if (pairSubject(method, params) !== undefined) for (const name of PAIR_PARAMS[method]!) subjectNames.add(name);
  }
  const rest: NodeParams = {};
  for (const [name, value] of Object.entries(params)) {
    if (subjectNames.has(name) || value === undefined) continue;
    if (name === "ledger_index" && value === "validated") continue;
    rest[name] = value;
  }
  return nodeParamsText(rest);
}

/**
 * Whether a piece of a request (a path segment, a node's subject, a query) may be a piece of a fixture file's path. What a
 * request says is data from outside: a piece that is `.` or `..`, or holds a separator (`/` or `\`), an escape (`%`, which
 * a second decoding would turn into either), `?`, `#` or NUL, names no fixture and is never made into a path. No fixture
 * has such a piece in its name.
 */
export function isSafePart(part: string): boolean {
  return part !== "" && part !== "." && part !== ".." && !/[/\\%?#\0]/.test(part);
}

/**
 * The path of the file of a data API request relative to test/fixtures/http/: `xrpl/data-api/ledgers/107721455.json`.
 * `undefined` for a request that is not under `/v2`, or that has a piece no file name can hold (see `isSafePart`).
 */
export function dataApiFile(net: NetworkName, pathname: string, search: string): string | undefined {
  const [version, ...rest] = segmentsOf(pathname);
  if (version !== "v2" || rest.length === 0 || !rest.every(isSafePart)) return undefined;
  const query = canonicalQuery(search);
  if (query !== "" && !isSafePart(query)) return undefined;
  return `${net}/data-api/${rest.join("/")}${query ? `@${query}` : ""}.json`;
}

/**
 * The path of the file of a node request: `xrpl/node/account_info/rXXX.json`; `ledger` is named by index. `undefined` when
 * the method, the subject or the other parameters hold a piece no file name can hold (see `isSafePart`).
 */
export function nodeFile(net: NetworkName, method: string, params: NodeParams, ledgerIndex?: number): string | undefined {
  if (!/^[a-z_]+$/.test(method)) return undefined;
  const subject = method === "ledger" && ledgerIndex !== undefined ? String(ledgerIndex) : nodeSubject(method, params);
  const rest = nodeRest(method, params);
  if (rest !== "" && !isSafePart(rest)) return undefined;
  if (subject === undefined) return `${net}/node/${method}.json`;
  if (!isSafePart(subject)) return undefined;
  return `${net}/node/${method}/${subject}${rest ? `@${rest}` : ""}.json`;
}

// ---- Answers ---------------------------------------------------------------------------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

/** An error as the data API answers it: `{ result: "error", message }`, never cacheable. */
export function dataApiError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ result: "error", message }), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...headers },
  });
}

/** A node's error: its `error_code` and `error_message`, either of which a node may leave out (xahaud's `entryNotFound` has neither). */
const NODE_ERRORS: Record<string, [code: number | undefined, message: string | undefined]> = {
  actNotFound: [19, "Account not found."],
  txnNotFound: [29, "Transaction not found."],
  lgrNotFound: [21, "ledgerNotFound"],
  invalidParams: [31, "Invalid parameters."],
  unknownCmd: [32, "Unknown method."],
  actMalformed: [35, "Account malformed."],
  noNetwork: [17, "Not synced to the network."],
  slowDown: [10, "You are placing too much load on the server."],
  internal: [73, "Internal error."],
  // What s1.ripple.com (Clio) answered an NFT it has none of on 2026-10-24 (its offers commands say "notFound" there; one text serves both).
  objectNotFound: [92, "NFT not found"],
  // What xahau.network answered `ledger_entry` for an entry it has none of on 2026-10-24: the code, the ledger it looked in and the request, no `error_code`.
  entryNotFound: [undefined, undefined],
};

/**
 * The `result` of a node's failed call (HTTP 200, `status: "error"`), for the `request` it echoes. Usable as an
 * override value of a node key.
 */
export function nodeError(code: string, request: Record<string, unknown> = {}): Record<string, unknown> {
  const [error_code, error_message] = NODE_ERRORS[code] ?? [73, "Internal error."];
  return {
    error: code,
    ...(error_code !== undefined && { error_code }),
    ...(error_message !== undefined && { error_message }),
    request,
    status: "error",
  };
}

function nodeAnswer(result: unknown): Response {
  return new Response(JSON.stringify({ result }), { status: 200, headers: JSON_HEADERS });
}

/**
 * D3's feature coverage for NFTs as the mock has it, by network: the fixtures' (scripts/nft-fixtures.ts, `FEATURE_COVERAGE`; a test compares the two), the one coverage of every
 * answer of a network that is not about one NFT. XRPL's feature is as old as the network, so its index is complete from the network's first ledger (32,570, D3's "Coverage");
 * Xahau's starts at the first ledger the recordings D3's own end-to-end suites seed have (`docs/api-reference.md` at da5ce14, "NFTs"), and nothing before it is indexed.
 */
const NFT_COVERAGE: Record<NetworkName, { from_ledger_index: number; complete: boolean }> = {
  xrpl: { from_ledger_index: 32570, complete: true },
  xahau: { from_ledger_index: 26533927, complete: false },
};

/** The "absent" answer of a data API path: what the real API says for a thing that does not exist. `net` is the network whose API is asked. */
function dataApiAbsent(net: NetworkName, segments: string[]): Response {
  const [version, resource, id, sub] = segments;
  if (version === "v2" && resource === "ledgers" && id !== undefined && sub === undefined) {
    return dataApiError(404, "ledger not found");
  }
  if (version === "v2" && resource === "transactions" && id !== undefined && sub === undefined) {
    return dataApiError(404, "transaction not found");
  }
  if (version === "v2" && resource === "accounts" && id !== undefined) {
    if (sub === undefined) return dataApiError(404, "Account not found");
    if (sub === "balances" || sub === "orders") return dataApiError(404, "account not found");
    // D3 does not check the address of the NFTs of an account ("one that is none holds nothing"): an empty page with the coverage of the network, never a 404.
    if (sub === "nfts" && segments.length === 4) {
      return new Response(JSON.stringify({ result: "success", coverage: NFT_COVERAGE[net], count: 0, nfts: [] }), { status: 200, headers: JSON_HEADERS });
    }
  }
  // D3's NFT and collection routes, and everything below them (an NFT's history and offers, a collection's NFTs, holders, sales and stats): the routes' own not-found messages.
  // `/v2/nfts` has no list, and the lists of the network (`nft_collections`, `nft_sales`, `network/nft_volume`) never answer 404: they stay missing routes, `Cannot GET`.
  if (version === "v2" && resource === "nfts" && id !== undefined) return dataApiError(404, "nft not found");
  if (version === "v2" && resource === "nft_collections" && id !== undefined) return dataApiError(404, "collection not found");
  // D1's validator and its validations (`summary` is a route of its own), and one amendment: the routes' own not-found messages.
  if (version === "v2" && resource === "network") {
    const [, , , key, page, ...rest] = segments;
    const one = key !== undefined && rest.length === 0;
    if (id === "validators" && one && key !== "summary" && (page === undefined || page === "validations")) return dataApiError(404, "Validator not found");
    if (id === "amendments" && one && page === undefined) return dataApiError(404, "amendment not found");
  }
  // A pool that does not exist (feat/amm-data): the pool route, its pair form and everything below it answer `pool not found`. The list (`/v2/amm/pools`) has no such thing,
  // and neither has `/v2/network/amm_volume`: they stay missing routes, `Cannot GET`. A test of an API without feat/amm-data names that body (`dataApiError(404, "Cannot GET …")`).
  if (version === "v2" && resource === "amm" && id === "pools" && sub !== undefined) return dataApiError(404, "pool not found");
  // D4's toml of a domain the store has no row for (never checked). Nothing is below a domain, and `/v2/toml` alone is no route.
  if (version === "v2" && resource === "toml" && id !== undefined && sub === undefined) return dataApiError(404, "toml not found");
  return dataApiError(404, `Cannot GET /${segments.join("/")}`);
}

// ---- The names batch -------------------------------------------------------------------------------------------------

/** The most addresses one names call asks for (D4's `MAX_ADDRESSES`). */
const NAMES_MAX_ADDRESSES = 100;

/** The override key that stands for every names call of a network, whatever addresses it asks for. */
const ACCOUNT_NAMES_KEY = "GET /v2/account_names";

/** A network's names, by address: its `data-api/account_names.json` (scripts/names-fixtures.ts writes it), or none. */
type NamesTable = Record<string, unknown>;

/**
 * `GET /v2/account_names?addresses=…` as D4 answers it (data-api-new `feat/explorer-data-2` at 3feb11a, `parseAddresses` and the controller of
 * apps/api/src/names/account-names.controller.ts): the first `addresses` parameter, split on `,` with nothing trimmed; 400 `addresses is required` when it
 * is missing or empty, `too many addresses - at most 100` for 101 elements or more (valid or not), `invalid ripple address` for any element that is no
 * classic address; else one entry for each address in the order asked (a repeated one at each place), the network's entry or the address alone.
 */
function composeAccountNames(search: URLSearchParams, names: NamesTable): Response {
  const raw = search.get("addresses");
  if (raw === null || raw === "") return dataApiError(400, "addresses is required");
  const addresses = raw.split(",");
  if (addresses.length > NAMES_MAX_ADDRESSES) return dataApiError(400, `too many addresses - at most ${NAMES_MAX_ADDRESSES}`);
  if (!addresses.every((address) => isValidClassicAddress(address))) return dataApiError(400, "invalid ripple address");
  const account_names = addresses.map((address) => (Object.hasOwn(names, address) ? names[address] : { address }));
  return new Response(JSON.stringify({ result: "success", count: account_names.length, account_names }), { status: 200, headers: JSON_HEADERS });
}

const NODE_ABSENT: Record<string, string> = {
  tx: "txnNotFound",
  ledger: "lgrNotFound",
  account_info: "actNotFound",
  account_objects: "actNotFound",
  server_state: "noNetwork",
  // A pair or an account that is no pool. (`book_offers` has no code: a book nobody offers in is an empty one, see `createUpstream`.)
  amm_info: "actNotFound",
  // An NFT the node has none of (Clio), and the entry of a URIToken it has none of (xahaud). The offers of an NFT with none are `objectNotFound` too.
  nft_info: "objectNotFound",
  nft_sell_offers: "objectNotFound",
  nft_buy_offers: "objectNotFound",
  ledger_entry: "entryNotFound",
};

function nodeAbsent(method: string, params: NodeParams): Response {
  const code = NODE_ABSENT[method] ?? "unknownCmd";
  const request = { ...params, command: method };
  const account = typeof params.account === "string" ? { account: params.account, validated: true } : {};
  return nodeAnswer({ ...account, ...nodeError(code, request) });
}

// ---- The upstream ----------------------------------------------------------------------------------------------------

function trimSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

/** The path of `url` below `base`'s path when `url` is under it (`""` for the base itself), else `undefined`. */
function below(base: URL, url: URL): string | undefined {
  if (url.origin !== base.origin) return undefined;
  const root = trimSlash(base.pathname);
  if (url.pathname === root || url.pathname === `${root}/`) return "";
  return url.pathname.startsWith(`${root}/`) ? url.pathname.slice(root.length) : undefined;
}

const KEY_PATTERN = /^(?:(xrpl|xahau) )?(GET \/\S*|node [a-z_]+(?: \S+)?)$/;

/** The statuses that cannot have a body: a Response built for one with an empty buffer would throw. */
const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * A `Response` given as an override, taken apart once: its status, status text and headers as they are when the mock is made, and
 * its body, which is read from a clone at once (a promise, because a body can only be read asynchronously).
 *
 * Why not clone it for every request: the Response is made in the test's request, and the answer is wanted in the Worker's, which a
 * test makes with `exports.default.fetch`. workerd refuses to read a body in another request than the one that made it ("Cannot
 * perform I/O on behalf of a different request"), so the Worker's data API client saw a connection failure, whatever the status
 * the test had given. The bytes are plain data and cross requests freely; a Response is built from them for every request.
 */
class CapturedResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Array<[string, string]>;
  readonly body: Promise<ArrayBuffer>;

  constructor(response: Response) {
    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = [...response.headers];
    this.body = response.clone().arrayBuffer();
    // A body that fails is reported to the request that uses it, not as an unhandled rejection here.
    this.body.catch(() => {});
  }

  async build(): Promise<Response> {
    const init = { status: this.status, statusText: this.statusText, headers: this.headers };
    return new Response(NO_BODY.has(this.status) ? null : await this.body, init);
  }
}

type KeyedOverrides = Map<NetworkName, Map<string, Override>>;

/** Overrides by network and canonical key. A key that is none of the formats above is a mistake: it throws. */
function parseOverrides(primary: NetworkName, overrides: Overrides): KeyedOverrides {
  const keyed: KeyedOverrides = new Map(NETWORK_NAMES.map((name) => [name, new Map()]));
  for (const [key, value] of Object.entries(overrides)) {
    const match = KEY_PATTERN.exec(key);
    if (!match) throw new Error(`mockUpstream: "${key}" is not an override key (GET /v2/... or node <method> ...)`);
    const net = (match[1] as NetworkName | undefined) ?? primary;
    const body = match[2]!;
    let canonical: string;
    if (body.startsWith("GET ")) {
      const url = new URL(body.slice(4), "http://key.invalid");
      canonical = dataApiKey(url.pathname, url.search);
    } else {
      const [, method, rest] = /^node (\S+)(?: (.+))?$/.exec(body)!;
      canonical = !rest ? `node ${method}` : rest.includes("=") ? `node ${method} ${canonicalParams(rest)}` : `node ${method} ${upperHash(rest)}`;
    }
    keyed.get(net)!.set(canonical, value instanceof Response ? new CapturedResponse(value) : value);
  }
  return keyed;
}

const upperHash = (value: string): string => (HEX64.test(value) ? value.toUpperCase() : value);

function canonicalParams(rest: string): string {
  return canonicalQuery(rest)
    .split("&")
    .map((pair) => {
      const at = pair.indexOf("=");
      return `${pair.slice(0, at)}=${upperHash(pair.slice(at + 1))}`;
    })
    .join("&");
}

export interface UpstreamOptions {
  files: FixtureFiles;
  bases: UpstreamBases;
  /** The network the unprefixed override keys belong to. */
  primary: NetworkName;
  overrides?: Overrides;
  /** Where to write down the requests answered, when several upstreams (the fixture server's, as its overrides change) share one list. */
  requests?: SeenRequest[];
}

export function createUpstream({ files, bases, primary, overrides = {}, requests = [] }: UpstreamOptions): Upstream {
  const keyed = parseOverrides(primary, overrides);
  const used = new Set<string>();
  const hashes = new Map<NetworkName, Promise<Record<string, number>>>();
  const nameTables = new Map<NetworkName, Promise<NamesTable>>();

  const targets = NETWORK_NAMES.map((net) => ({
    net,
    dataApi: new URL(bases[net].dataApi),
    node: new URL(bases[net].node),
  }));

  /** The index of the ledger a hash names, from the network's `ledger-hashes.json`. */
  function ledgerIndexOf(net: NetworkName, hash: string): Promise<number | undefined> {
    let table = hashes.get(net);
    if (!table) {
      table = files.read(`${net}/ledger-hashes.json`).then((json) => (json === undefined ? {} : (JSON.parse(json) as Record<string, number>)));
      hashes.set(net, table);
    }
    return table.then((entries) => entries[hash.toUpperCase()]);
  }

  /** The names of a network, from its `data-api/account_names.json`: none when it has no such file. */
  function namesTableOf(net: NetworkName): Promise<NamesTable> {
    let table = nameTables.get(net);
    if (!table) {
      table = files.read(`${net}/data-api/account_names.json`).then((json) => (json === undefined ? {} : (JSON.parse(json) as NamesTable)));
      nameTables.set(net, table);
    }
    return table;
  }

  /** The index of the newest ledger the network's fixtures record: that of its `data-api/last_validated.json`. */
  async function newestLedger(net: NetworkName): Promise<number | undefined> {
    const recorded = await files.read(`${net}/data-api/last_validated.json`);
    if (recorded === undefined) return undefined;
    try {
      const index = Number((JSON.parse(recorded) as { ledger_index?: unknown }).ledger_index);
      return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * What a node says for a request that has no fixture. A book nobody offers in is an empty one, validated, at the newest recorded ledger
   * (with no ledger recorded the node is "not synced"); every other method has its code in `NODE_ABSENT`.
   */
  async function absentNodeAnswer(net: NetworkName, method: string, params: NodeParams): Promise<Response> {
    if (method !== "book_offers") return nodeAbsent(method, params);
    const ledgerIndex = await newestLedger(net);
    if (ledgerIndex === undefined) return nodeAnswer(nodeError("noNetwork", { ...params, command: method }));
    return nodeAnswer({ ledger_index: ledgerIndex, offers: [], validated: true });
  }

  /** Runs an override: a function is called, a captured Response rebuilt, `null` stands for "absent", the rest is a body. */
  async function overridden(
    value: Override,
    request: Request,
    asBody: (value: unknown) => Response,
    absent: () => Response | Promise<Response>,
  ): Promise<Response> {
    if (typeof value === "function") {
      const made = await (value as (req: Request) => Response | Promise<Response>)(request);
      if (!(made instanceof Response)) throw new TypeError("an override function must return a Response");
      return made;
    }
    if (value instanceof CapturedResponse) return value.build();
    if (value === null) return absent();
    return asBody(value);
  }

  async function handleDataApi(net: NetworkName, url: URL, rest: string, request: Request): Promise<Response> {
    const segments = segmentsOf(rest);
    const key = dataApiKey(rest, url.search);
    const seen: SeenRequest = {
      net,
      kind: "data-api",
      key,
      method: request.method,
      url: request.url,
      headers: new Headers(request.headers),
      source: "fixture",
      status: 0,
    };
    requests.push(seen);

    const answer = async (): Promise<Response> => {
      if (!request.headers.get("X-API-Key")) {
        seen.source = "absent";
        return dataApiError(401, "Missing or invalid API key.");
      }
      if (request.method !== "GET") {
        seen.source = "absent";
        return dataApiError(404, `Cannot ${request.method} ${rest}`);
      }
      const override = keyed.get(net)!;
      if (override.has(key)) {
        used.add(`${net} ${key}`);
        seen.source = "override";
        return overridden(
          override.get(key),
          request,
          (body) => new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS }),
          () => dataApiAbsent(net, segments),
        );
      }

      // The names batch: an override of every names call of the network, else D4's answer composed from the network's names.
      if (segments.length === 2 && segments[0] === "v2" && segments[1] === "account_names") {
        if (override.has(ACCOUNT_NAMES_KEY)) {
          used.add(`${net} ${ACCOUNT_NAMES_KEY}`);
          seen.source = "override";
          return overridden(
            override.get(ACCOUNT_NAMES_KEY),
            request,
            (body) => new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS }),
            () => dataApiAbsent(net, segments),
          );
        }
        return composeAccountNames(url.searchParams, await namesTableOf(net));
      }

      // A ledger asked for by its hash is the file of its index.
      let pathname = rest;
      if (segments[1] === "ledgers" && segments[2] !== undefined && HEX64.test(segments[2]) && segments.length === 3) {
        const index = await ledgerIndexOf(net, segments[2]);
        pathname = index === undefined ? "/v2/ledgers/0" : `/v2/ledgers/${index}`;
      }
      const file = dataApiFile(net, pathname, url.search);
      const body = file === undefined ? undefined : await files.read(file);
      if (body === undefined) {
        seen.source = "absent";
        return dataApiAbsent(net, segments);
      }
      return new Response(body, { status: 200, headers: JSON_HEADERS });
    };

    const response = await answer();
    seen.status = response.status;
    return response;
  }

  async function handleNode(net: NetworkName, request: Request): Promise<Response> {
    const seen: SeenRequest = {
      net,
      kind: "node",
      key: "node",
      method: request.method,
      url: request.url,
      headers: new Headers(request.headers),
      source: "fixture",
      status: 0,
    };
    requests.push(seen);

    const answer = async (): Promise<Response> => {
      let body: { method?: unknown; params?: unknown } | undefined;
      try {
        body = request.method === "POST" ? ((await request.clone().json()) as typeof body) : undefined;
      } catch {
        body = undefined;
      }
      const method = typeof body?.method === "string" ? body.method : undefined;
      const first = Array.isArray(body?.params) ? (body.params as unknown[])[0] : {};
      const params: NodeParams = typeof first === "object" && first !== null ? (first as NodeParams) : {};
      seen.body = body;
      if (method === undefined) {
        seen.source = "absent";
        seen.key = "node";
        return new Response(JSON.stringify({ result: nodeError("invalidParams") }), { status: 200, headers: JSON_HEADERS });
      }

      const keys = nodeKeys(method, params);
      seen.key = keys[0]!;
      const override = keyed.get(net)!;
      const hit = keys.find((key) => override.has(key));
      if (hit !== undefined) {
        used.add(`${net} ${hit}`);
        seen.source = "override";
        return overridden(override.get(hit), request, nodeAnswer, () => absentNodeAnswer(net, method, params));
      }

      let ledgerIndex: number | undefined;
      if (method === "ledger") {
        const subject = nodeSubject(method, params);
        const asNumber = Number(subject);
        ledgerIndex =
          subject === undefined ? undefined : HEX64.test(subject) ? await ledgerIndexOf(net, subject) : Number.isSafeInteger(asNumber) ? asNumber : undefined;
      }
      const file = method === "ledger" && ledgerIndex === undefined ? undefined : nodeFile(net, method, params, ledgerIndex);
      const found = file === undefined ? undefined : await files.read(file);
      if (found === undefined) {
        seen.source = "absent";
        return absentNodeAnswer(net, method, params);
      }
      return new Response(found, { status: 200, headers: JSON_HEADERS });
    };

    const response = await answer();
    seen.status = response.status;
    return response;
  }

  return {
    requests,
    unusedOverrides() {
      const unused: string[] = [];
      for (const [net, entries] of keyed) {
        for (const key of entries.keys()) if (!used.has(`${net} ${key}`)) unused.push(net === primary ? key : `${net} ${key}`);
      }
      return unused;
    },
    async handle(request) {
      const url = new URL(request.url);
      for (const target of targets) {
        const rest = below(target.dataApi, url);
        if (rest !== undefined) return handleDataApi(target.net, url, rest, request);
        if (below(target.node, url) === "") return handleNode(target.net, request);
      }
      return undefined;
    },
  };
}
