// The client of the GateHub Data API (data-api-new, its /v2 endpoints). Only loaders use it, through the
// Worker's subrequest cache; nothing in the browser talks to the API. Worker-only code.
//
// Every request carries the key from the DATA_API_KEY secret, is limited to 5 s (answer included) and is
// never redirected. A failure is an `UpstreamError`, which is never cached.

import { checkFeeBucketPage, checkFeeStatsPage, checkStatsPage, checkValidations, checkVolumePage } from "./aggregate-shape";
import type {
  AccountData,
  AccountExchange,
  AmmVolumeComponent,
  BalancesResponse,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeRow,
  FeeStatsRow,
  LastValidated,
  Ledger,
  LedgerExpanded,
  LedgerValidations,
  LedgerWithHashes,
  OrdersResponse,
  Page,
  Payment,
  PaymentVolumeComponent,
  StatsRow,
  TxBinary,
  TxObject,
  TxStoredJson,
  VolumeRow,
} from "./api-types";
import { MARKER_PAGE_CLASS, type CacheClass, type SubrequestCache } from "./cache-class";
import type { Env } from "./env";
import { isMarker } from "./marker";
import type { Network } from "./networks";
import type { paths } from "./openapi";
import { PENDING_PATHS } from "./pending-paths";
import { checkBinaryAnswer, checkIndexTransaction, checkLedgerHashes } from "./tx-shape";
import { clip, DATA_API_TIMEOUT_MS, retryAfterOf, UpstreamError, withDeadline } from "./upstream";

export { UpstreamError } from "./upstream";
export type { UpstreamErrorKind } from "./upstream";

/**
 * The endpoints the client calls, in the OpenAPI document's own spelling (`{name}` marks a path parameter).
 * `satisfies Record<string, keyof paths>` makes the compiler check each against the generated
 * `app/server/openapi.d.ts`: a path that leaves the API fails `pnpm typecheck`.
 */
const PATHS = {
  lastValidated: "/v2/last_validated",
  ledger: "/v2/ledgers/{ledger_param}",
  transaction: "/v2/transactions/{tx_hash}",
  transactions: "/v2/transactions",
  account: "/v2/accounts/{address}",
  balances: "/v2/accounts/{address}/balances",
  orders: "/v2/accounts/{address}/orders",
  accountTransactions: "/v2/accounts/{address}/transactions",
  accountPayments: "/v2/accounts/{address}/payments",
  accountExchanges: "/v2/accounts/{address}/exchanges",
  fees: "/v2/network/fees",
  feeStats: "/v2/network/fee_stats",
  stats: "/v2/stats/{family}",
  paymentVolume: "/v2/network/payment_volume",
  exchangeVolume: "/v2/network/exchange_volume",
  ledgerValidations: "/v2/ledgers/{ledger_hash}/validations",
} as const satisfies Record<string, keyof paths>;

/** A path of `PATHS` or of `PENDING_PATHS` (the routes `openapi.yaml` does not have yet, which the compiler cannot check). */
type Template = (typeof PATHS)[keyof typeof PATHS] | (typeof PENDING_PATHS)[keyof typeof PENDING_PATHS];

/** Paging of a list: `marker` is the opaque token of the previous page's answer. */
export type ListQuery = { descending?: boolean; limit?: number; marker?: string };

/** `fees` by the day: a row for each day that starts within `start` and `end` (`YYYY-MM-DD`). Sent in this order. */
export type FeeBucketQuery = { interval: "day"; start: string; end: string; limit: number };

/** `stats`: a row for each `interval` that starts within `start` and `end` (`YYYY-MM-DD`), of the `metrics` named (all of the family without). Sent in this order. */
export type StatsQuery = { interval: "day" | "week"; start: string; end: string; limit: number; metrics?: readonly string[] };

/**
 * The volumes: a row for each `interval` that starts within `start` and `end` (`YYYY-MM-DD`), in the native currency or, with
 * `exchangeCurrency` (and `exchangeIssuer`, unless it is the native one), in another. Sent in this order, as `exchange_currency` and `exchange_issuer`.
 */
export type VolumeQuery = {
  interval: "day" | "week";
  start: string;
  end: string;
  limit: number;
  exchangeCurrency?: string;
  exchangeIssuer?: string;
};

/** The most rows of a payments CSV: the API's own maximum for the account lists (it cuts a larger `limit` down to it). */
export const CSV_PAGE_LIMIT = 1000;

/** One page of a CSV list, as the API served it. */
export interface CsvPage {
  /** The CSV, not read yet: stream it on. */
  body: ReadableStream<Uint8Array>;
  /** The marker of the page after this one (from the API's `Link` header), when there is one. */
  nextMarker?: string;
}

/**
 * `ttl`: keep the answer this many seconds instead of the call's class's. It has a cache entry of its own (the key says so), so that an
 * answer kept longer for another caller is not what this one reads. The home page asks for `HOME_CALL_TTL_SECONDS`, the network page
 * for that on three of its calls and for `PERIOD_CALL_TTL_SECONDS` on the ones over a period.
 *
 * `holdFailure`: remember this call's failure for a few seconds (`SubrequestOptions` in cache-class.ts). A page that polls asks for it on
 * every call it makes. It is not part of the key.
 */
export interface FreshOptions {
  ttl?: number;
  holdFailure?: boolean;
}

export interface DataApi {
  /** The newest ledger the API has committed. Class `live` (5 s); the home page asks for `{ ttl: HOME_CALL_TTL_SECONDS }`. */
  lastValidated(opts?: FreshOptions): Promise<LastValidated>;
  /**
   * A validated ledger by index, hash or date. `expand` adds its transactions in full, `transactions` their hashes
   * (`expand` wins). Either way `transactions` is always a list, empty for a ledger with no transactions.
   */
  ledger(id: string, opts: { expand: true; transactions?: boolean; holdFailure?: boolean }): Promise<LedgerExpanded>;
  ledger(id: string, opts: { transactions: true; expand?: false; holdFailure?: boolean }): Promise<LedgerWithHashes>;
  ledger(id: string, opts?: { expand?: boolean; transactions?: boolean; holdFailure?: boolean }): Promise<Ledger>;
  /**
   * One transaction by hash. An answer that is not a transaction of that hash, with its type, account and metadata, is an
   * `UpstreamError` of kind `server` (a 200 with the wrong content is the API failing), and is not stored.
   */
  transaction(hash: string): Promise<TxObject>;
  /**
   * The same transaction with `tx` and `meta` as the hex of their serialization (`binary=true`): the blob of `tx` is the one
   * its hash is taken over. For a type the API's codec cannot serialize the API serves the JSON it stored instead (`TxStoredJson`).
   * Asked for beside `transaction` by the transaction page, for its Binary tab.
   */
  transactionBinary(hash: string): Promise<TxBinary | TxStoredJson>;
  /**
   * Transactions of all accounts, oldest first unless `descending`. Class `live`; with `ttl` and **no marker** (in either direction) the
   * answer is kept that long instead. A list reached with a marker keeps the class it has (`MARKER_PAGE_CLASS` when newest first) and ignores `ttl`.
   */
  transactions(q: ListQuery, opts?: FreshOptions): Promise<Page<"transactions", TxObject>>;
  /** How an account was created. 404 (`not_found`) for an address that never was. */
  account(address: string): Promise<AccountData>;
  /** An account's balances on the newest validated ledger, read by the API from a node. */
  balances(address: string): Promise<BalancesResponse>;
  /** An account's open offers, read like the balances. */
  orders(address: string): Promise<OrdersResponse>;
  accountTransactions(address: string, q: ListQuery): Promise<Page<"transactions", TxObject>>;
  accountPayments(address: string, q: ListQuery): Promise<Page<"payments", Payment>>;
  accountExchanges(address: string, q: ListQuery): Promise<Page<"exchanges", AccountExchange>>;
  /**
   * One page of an account's payments as CSV (`format=csv`), newest first, at most `CSV_PAGE_LIMIT` rows, after `marker` when
   * it is given. Not cached, and not read: the body is a stream for the caller to pass on. A 200 that is not CSV is an
   * `UpstreamError` of kind `server`.
   */
  accountPaymentsCsv(address: string, q: { marker?: string }): Promise<CsvPage>;
  /** What the transactions of each ledger paid in fees, one row per ledger. Class `live`; the home page asks for `{ ttl: HOME_CALL_TTL_SECONDS }`. */
  fees(q: { descending: boolean; limit: number }, opts?: FreshOptions): Promise<Page<"rows", FeeRow>>;
  /**
   * What the transactions of each day paid in fees, one row per day, all its ledgers counted. Class `slow`;
   * the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`. A row that is not what the reference promises is an `UpstreamError` of kind `server`.
   */
  fees(q: FeeBucketQuery, opts?: FreshOptions): Promise<Page<"rows", FeeBucketRow>>;
  /**
   * Snapshots of the node's fee state, taken by the data API every 5 s (the open ledger fee, the queue, the open ledger's size): `descending` with
   * `limit: 1` and `start` the day is the newest. Class `live`; the network page asks for `{ ttl: HOME_CALL_TTL_SECONDS }`.
   */
  feeStats(q: { descending: boolean; limit: number; start: string }, opts?: FreshOptions): Promise<Page<"rows", FeeStatsRow>>;
  /**
   * Counts of what happened on the network per day or week: transactions by `type`, or the `metric`s (`accounts_created`, `ledger_count`,
   * `transaction_count`, …). Zero counts are left out of a row. Class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`.
   */
  stats(family: "type" | "metric", q: StatsQuery, opts?: FreshOptions): Promise<Page<"stats", StatsRow>>;
  /** The payment volume of the tracked currencies, per day or week. Class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`. */
  paymentVolume(q: VolumeQuery, opts?: FreshOptions): Promise<Page<"rows", VolumeRow<PaymentVolumeComponent>>>;
  /** The trade volume of the tracked markets, per day or week. Class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`. */
  exchangeVolume(q: VolumeQuery, opts?: FreshOptions): Promise<Page<"rows", VolumeRow<ExchangeVolumeComponent>>>;
  /**
   * The volume of the swaps against AMM pools, per day or week, one component per pool. Only a data API that has merged `feat/amm-data` has the
   * route (`PENDING_PATHS`): without it the call fails with the missing-route outage (kind `server`), so a page asks only while `AMM_DATA` is on.
   * Class `slow`; the network page asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }`.
   */
  ammVolume(q: VolumeQuery, opts?: FreshOptions): Promise<Page<"rows", VolumeRow<AmmVolumeComponent>>>;
  /**
   * The validations the network made of one ledger, one per validator, sorted by validator key (the data API keeps them 90 days). Class
   * `live`. `limit` is at most 1000, and no marker is followed: a ledger with more validations than that is cut.
   */
  ledgerValidations(hash: string, q: { limit: number }, opts?: FreshOptions): Promise<LedgerValidations>;
}

/** Query parameters; `undefined` and `false` are left out (every flag of the API is off unless it says `true`). */
type Query = Record<string, string | number | boolean | undefined>;

/** One path segment, escaped. `.` and `..` would be resolved away by the URL parser and reach another endpoint. */
function segment(name: string, value: string): string {
  if (value === "" || value === "." || value === "..") {
    throw new UpstreamError("bad_request", `${JSON.stringify(value)} is not a valid ${name}`);
  }
  return encodeURIComponent(value);
}

/** The reason an upstream gave for a failure: `message` of the data API's errors, `error` of its 429. */
async function reasonOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { message, error } = body as { message?: unknown; error?: unknown };
      if (typeof message === "string") return clip(message);
      if (typeof error === "string") return clip(error);
    }
  } catch {
    // Not JSON (a proxy's page, no body): the status says enough.
  }
  return undefined;
}

/**
 * The marker of the next page in the `Link` header of a list (`<https://host/v2/...?marker=M>; rel="next"`). The header names
 * the API's own URL, which is never followed or passed on: only a marker that is one is taken out of it.
 */
function nextMarkerOf(link: string | null): string | undefined {
  const next = link === null ? undefined : /<([^>]*)>\s*;\s*rel="?next"?/i.exec(link)?.[1];
  if (next === undefined) return undefined;
  let marker: string | null;
  try {
    marker = new URL(next, "http://api.invalid").searchParams.get("marker");
  } catch {
    return undefined;
  }
  return isMarker(marker) ? marker : undefined;
}

export function createDataApi(net: Network, env: Env, cache: SubrequestCache): DataApi {
  const base = net.dataApiUrl.replace(/\/+$/, "");

  /** Sends the one kind of request the client makes: the key in its header, never redirected. */
  async function send(path: string, accept: string, signal: AbortSignal): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: "GET",
      headers: { "X-API-Key": env.DATA_API_KEY, Accept: accept },
      // A redirect would carry the key to wherever it points; the API never redirects.
      redirect: "manual",
      signal,
    });
  }

  /** Throws the `UpstreamError` of an answer that is not 2xx; `what` says which request it was. */
  async function throwUnlessOk(response: Response, what: string): Promise<void> {
    if (response.status >= 200 && response.status <= 299) return;
    const { status } = response;
    const reason = await reasonOf(response);
    // The API's framework answers a path it has no route for with `Cannot GET …` (an API deployed without the sub-project that adds the route,
    // spec 6.4). That is an outage and not a thing that does not exist: kind `server`, so never a stored 404 page, and held when the call asks.
    // Every other 404, each route's own not-found message included, stays `not_found`. This is the one place that tells the two apart.
    const missingRoute = status === 404 && reason?.startsWith("Cannot GET ") === true;
    const kind = missingRoute ? "server" : status === 404 ? "not_found" : status === 400 ? "bad_request" : status === 429 ? "rate_limited" : "server";
    throw new UpstreamError(kind, `${what} answered ${status}${reason ? `: ${reason}` : ""}${missingRoute ? " (the data API has no such route)" : ""}`, {
      status,
      retryAfter: retryAfterOf(response.headers),
    });
  }

  /** Fetches `path` and returns the JSON body of a 2xx answer; any other answer throws. */
  function fetchJson(path: string): Promise<unknown> {
    const what = `data API GET ${path}`;
    return withDeadline(DATA_API_TIMEOUT_MS, what, async (signal) => {
      const response = await send(path, "application/json", signal);
      await throwUnlessOk(response, what);

      try {
        return (await response.json()) as unknown;
      } catch (cause) {
        throw new UpstreamError("server", `${what} answered something that is not JSON`, {
          status: response.status,
          cause,
        });
      }
    });
  }

  /**
   * One cached GET. `template` is a value of `PATHS` or of `PENDING_PATHS`, `params` fill its `{name}`s. With `unwrap`, the part
   * of the answer under that key is what is returned (and cached), otherwise the whole answer. `finish` shapes (or checks) what
   * is returned, the unwrapped part or the whole answer, before it is cached. `ttl` and `holdFailure` are the cache's options
   * (cache-class.ts): `ttl` is part of the key, `holdFailure` is not.
   */
  async function get<T>(
    template: Template,
    params: Record<string, string>,
    query: Query,
    cls: CacheClass,
    { unwrap, finish, ttl, holdFailure }: { unwrap?: string; finish?: (value: T) => T; ttl?: number; holdFailure?: boolean } = {},
  ): Promise<T> {
    const path = template.replace(/\{(\w+)\}/g, (_match, name: string) => segment(name, params[name] ?? ""));
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== false) search.set(key, String(value));
    }
    const queryString = search.toString();
    const url = queryString ? `${path}?${queryString}` : path;

    // An answer kept for a TTL of the caller's own is not the one another caller reads, which may have been kept longer.
    const key = ttl === undefined ? `GET ${base}${url}` : `GET ${base}${url} [kept ${ttl} s]`;
    return cache.json(
      key,
      cls,
      async () => {
        const body = await fetchJson(url);
        if (unwrap === undefined) return finish ? finish(body as T) : (body as T);
        const part = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[unwrap] : undefined;
        if (part === undefined || part === null) {
          throw new UpstreamError("server", `data API GET ${url} answered without "${unwrap}"`, { status: 200 });
        }
        return finish ? finish(part as T) : (part as T);
      },
      ttl,
      { holdFailure },
    );
  }

  /**
   * Fetches a CSV page. The deadline holds until the answer starts (its status and headers), not for the body, which the caller
   * streams on: a body that stalls is the runtime's to cut, and the visitor sees a CSV that ends early.
   */
  function fetchCsv(path: string): Promise<CsvPage> {
    const what = `data API GET ${path}`;
    return withDeadline(DATA_API_TIMEOUT_MS, what, async (signal) => {
      const response = await send(path, "text/csv", signal);
      await throwUnlessOk(response, what);

      if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/csv")) {
        void response.body?.cancel();
        throw new UpstreamError("server", `${what} answered something that is not CSV`, { status: response.status });
      }
      const body = response.body ?? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
      const nextMarker = nextMarkerOf(response.headers.get("Link"));
      return nextMarker === undefined ? { body } : { body, nextMarker };
    });
  }

  /** A volume's query in the order of `VolumeQuery`, with the API's names for the display currency. */
  const volumeQuery = (q: VolumeQuery): Query => ({
    interval: q.interval,
    start: q.start,
    end: q.end,
    limit: q.limit,
    exchange_currency: q.exchangeCurrency,
    exchange_issuer: q.exchangeIssuer,
  });
  const listQuery = (q: ListQuery): Query => ({
    descending: q.descending,
    limit: q.limit,
    marker: q.marker || undefined,
  });
  /**
   * A page reached with a marker is stable under new data only when the list runs newest first: then it is the
   * history before the marker. An oldest-first list grows at the end. Even so it is only `MARKER_PAGE_CLASS`, which is not
   * `immutable` while the index can still be backfilled (see there).
   */
  const listClass = (q: ListQuery): CacheClass => (q.marker && q.descending ? MARKER_PAGE_CLASS : "live");

  /**
   * The API adds `transactions` to an expanded ledger only when the ledger has some, unless `transactions=true` is
   * sent too, which makes the key always there (`[]` for none). So `expand` always goes with `transactions=true`,
   * and an expanded ledger has a list even if the answer, against the reference, left the key out.
   *
   * The hashes of a ledger (`transactions` without `expand`) are not defaulted: a list that is not there is not an empty ledger, and
   * a page that took it for one would have every transaction of the ledger fail (and the answer would be stored for a year). The
   * list must be a list of hashes, or the answer is a failure (`checkLedgerHashes`) and nothing is stored.
   */
  const ledger = (id: string, opts?: { expand?: boolean; transactions?: boolean; holdFailure?: boolean }) => {
    const withTransactions = Boolean(opts?.expand || opts?.transactions);
    const hashesOnly = Boolean(opts?.transactions && !opts.expand);
    return get<Ledger>(PATHS.ledger, { ledger_param: id }, { expand: opts?.expand, transactions: withTransactions }, "immutable", {
      unwrap: "ledger",
      finish: hashesOnly
        ? (found) => {
            checkLedgerHashes(found);
            return found;
          }
        : withTransactions
          ? (found) => ({ ...found, transactions: found.transactions ?? [] })
          : undefined,
      holdFailure: opts?.holdFailure,
    });
  };

  /** The options of a call that takes `FreshOptions`, as `get` takes them. */
  const fresh = (opts?: FreshOptions) => ({ ttl: opts?.ttl, holdFailure: opts?.holdFailure });

  return {
    // The home page follows the chain and asks for these three at `HOME_CALL_TTL_SECONDS` (`opts.ttl`); the ledger page (its Next at the
    // newest ledger) and the image route read `lastValidated` at its class, 5 s, and are not asked to be any fresher.
    lastValidated: (opts) => get<LastValidated>(PATHS.lastValidated, {}, {}, "live", fresh(opts)),
    // The overloads of the interface narrow `transactions` by the options; the answer is the same either way.
    ledger: ledger as DataApi["ledger"],
    // What the pages read of a transaction is checked inside the load, so that an answer that is not one is a failure and not stored.
    transaction: (hash) =>
      get<TxObject>(PATHS.transaction, { tx_hash: hash }, {}, "immutable", {
        unwrap: "transaction",
        finish: (found) => {
          checkIndexTransaction(found, hash);
          return found;
        },
      }),
    transactionBinary: (hash) =>
      get<TxBinary | TxStoredJson>(PATHS.transaction, { tx_hash: hash }, { binary: true }, "immutable", {
        unwrap: "transaction",
        finish: (found) => {
          checkBinaryAnswer(found, hash);
          return found;
        },
      }),
    // The TTL is for a first page only: a list reached with a marker, in either direction, is the class it has.
    transactions: (q, opts) => get(PATHS.transactions, {}, listQuery(q), listClass(q), { ttl: q.marker ? undefined : opts?.ttl, holdFailure: opts?.holdFailure }),
    account: (address) => get<AccountData>(PATHS.account, { address }, {}, "slow", { unwrap: "account_data" }),
    balances: (address) => get(PATHS.balances, { address }, {}, "live"),
    orders: (address) => get(PATHS.orders, { address }, {}, "live"),
    accountTransactions: (address, q) => get(PATHS.accountTransactions, { address }, listQuery(q), listClass(q)),
    accountPayments: (address, q) => get(PATHS.accountPayments, { address }, listQuery(q), listClass(q)),
    accountExchanges: (address, q) => get(PATHS.accountExchanges, { address }, listQuery(q), listClass(q)),
    accountPaymentsCsv: async (address, q) => {
      const path = PATHS.accountPayments.replace("{address}", segment("address", address));
      const search = new URLSearchParams({ descending: "true", format: "csv", limit: String(CSV_PAGE_LIMIT) });
      if (q.marker) search.set("marker", q.marker);
      return fetchCsv(`${path}?${search}`);
    },
    // The ledgers of the list (`interval` left out) are `live`, the days of the fee chart `slow`: the overloads tell them apart by `interval`.
    fees: ((q: { descending: boolean; limit: number } | FeeBucketQuery, opts?: FreshOptions) =>
      "interval" in q
        ? get<Page<"rows", FeeBucketRow>>(PATHS.fees, {}, { interval: q.interval, start: q.start, end: q.end, limit: q.limit }, "slow", {
            ...fresh(opts),
            finish: checkFeeBucketPage,
          })
        : get(PATHS.fees, {}, { descending: q.descending, limit: q.limit }, "live", fresh(opts))) as DataApi["fees"],
    feeStats: (q, opts) =>
      get<Page<"rows", FeeStatsRow>>(PATHS.feeStats, {}, { descending: q.descending, limit: q.limit, start: q.start }, "live", {
        ...fresh(opts),
        finish: checkFeeStatsPage,
      }),
    stats: (family, q, opts) =>
      get<Page<"stats", StatsRow>>(
        PATHS.stats,
        { family },
        { interval: q.interval, start: q.start, end: q.end, limit: q.limit, metrics: q.metrics?.length ? q.metrics.join(",") : undefined },
        "slow",
        { ...fresh(opts), finish: checkStatsPage },
      ),
    paymentVolume: (q, opts) =>
      get<Page<"rows", VolumeRow<PaymentVolumeComponent>>>(PATHS.paymentVolume, {}, volumeQuery(q), "slow", {
        ...fresh(opts),
        finish: (page) => checkVolumePage("payment", page),
      }),
    exchangeVolume: (q, opts) =>
      get<Page<"rows", VolumeRow<ExchangeVolumeComponent>>>(PATHS.exchangeVolume, {}, volumeQuery(q), "slow", {
        ...fresh(opts),
        finish: (page) => checkVolumePage("exchange", page),
      }),
    ammVolume: (q, opts) =>
      get<Page<"rows", VolumeRow<AmmVolumeComponent>>>(PENDING_PATHS.ammVolume, {}, volumeQuery(q), "slow", {
        ...fresh(opts),
        finish: (page) => checkVolumePage("amm", page),
      }),
    ledgerValidations: (hash, q, opts) =>
      get<LedgerValidations>(PATHS.ledgerValidations, { ledger_hash: hash }, { limit: q.limit }, "live", { ...fresh(opts), finish: checkValidations }),
  };
}
