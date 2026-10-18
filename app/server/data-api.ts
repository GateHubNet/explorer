// The client of the GateHub Data API (data-api-new, its /v2 endpoints). Only loaders use it, through the
// Worker's subrequest cache; nothing in the browser talks to the API. Worker-only code.
//
// Every request carries the key from the DATA_API_KEY secret, is limited to 5 s (answer included) and is
// never redirected. A failure is an `UpstreamError`, which is never cached.

import type {
  AccountData,
  AccountExchange,
  BalancesResponse,
  FeeRow,
  LastValidated,
  Ledger,
  LedgerExpanded,
  LedgerWithHashes,
  OrdersResponse,
  Page,
  Payment,
  TxBinary,
  TxObject,
  TxStoredJson,
} from "./api-types";
import type { CacheClass, SubrequestCache } from "./cache-class";
import type { Env } from "./env";
import type { Network } from "./networks";
import type { paths } from "./openapi";
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
} as const satisfies Record<string, keyof paths>;

/** Paging of a list: `marker` is the opaque token of the previous page's answer. */
export type ListQuery = { descending?: boolean; limit?: number; marker?: string };

export interface DataApi {
  /** The newest ledger the API has committed. */
  lastValidated(): Promise<LastValidated>;
  /**
   * A validated ledger by index, hash or date. `expand` adds its transactions in full, `transactions` their hashes
   * (`expand` wins). Either way `transactions` is always a list, empty for a ledger with no transactions.
   */
  ledger(id: string, opts: { expand: true; transactions?: boolean }): Promise<LedgerExpanded>;
  ledger(id: string, opts: { transactions: true; expand?: false }): Promise<LedgerWithHashes>;
  ledger(id: string, opts?: { expand?: boolean; transactions?: boolean }): Promise<Ledger>;
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
  /** Transactions of all accounts, oldest first unless `descending`. */
  transactions(q: ListQuery): Promise<Page<"transactions", TxObject>>;
  /** How an account was created. 404 (`not_found`) for an address that never was. */
  account(address: string): Promise<AccountData>;
  /** An account's balances on the newest validated ledger, read by the API from a node. */
  balances(address: string): Promise<BalancesResponse>;
  /** An account's open offers, read like the balances. */
  orders(address: string): Promise<OrdersResponse>;
  accountTransactions(address: string, q: ListQuery): Promise<Page<"transactions", TxObject>>;
  accountPayments(address: string, q: ListQuery): Promise<Page<"payments", Payment>>;
  accountExchanges(address: string, q: ListQuery): Promise<Page<"exchanges", AccountExchange>>;
  /** What the transactions of each ledger paid in fees, one row per ledger. */
  fees(q: { descending: boolean; limit: number }): Promise<Page<"rows", FeeRow>>;
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

export function createDataApi(net: Network, env: Env, cache: SubrequestCache): DataApi {
  const base = net.dataApiUrl.replace(/\/+$/, "");

  /** Fetches `path` and returns the JSON body of a 2xx answer; any other answer throws. */
  function fetchJson(path: string): Promise<unknown> {
    const what = `data API GET ${path}`;
    return withDeadline(DATA_API_TIMEOUT_MS, what, async (signal) => {
      const response = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { "X-API-Key": env.DATA_API_KEY, Accept: "application/json" },
        // A redirect would carry the key to wherever it points; the API never redirects.
        redirect: "manual",
        signal,
      });

      if (response.status < 200 || response.status > 299) {
        const { status } = response;
        const reason = await reasonOf(response);
        const kind =
          status === 404 ? "not_found" : status === 400 ? "bad_request" : status === 429 ? "rate_limited" : "server";
        throw new UpstreamError(kind, `${what} answered ${status}${reason ? `: ${reason}` : ""}`, {
          status,
          retryAfter: retryAfterOf(response.headers),
        });
      }

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
   * One cached GET. `template` is a key of `PATHS`' values, `params` fill its `{name}`s; with `unwrap`, the part
   * of the answer under that key is what is returned (and cached), otherwise the whole answer. `finish` shapes
   * the unwrapped part before it is cached.
   */
  async function get<T>(
    template: (typeof PATHS)[keyof typeof PATHS],
    params: Record<string, string>,
    query: Query,
    cls: CacheClass,
    unwrap?: string,
    finish?: (part: T) => T,
  ): Promise<T> {
    const path = template.replace(/\{(\w+)\}/g, (_match, name: string) => segment(name, params[name] ?? ""));
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== false) search.set(key, String(value));
    }
    const queryString = search.toString();
    const url = queryString ? `${path}?${queryString}` : path;

    return cache.json(`GET ${base}${url}`, cls, async () => {
      const body = await fetchJson(url);
      if (unwrap === undefined) return body as T;
      const part = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[unwrap] : undefined;
      if (part === undefined || part === null) {
        throw new UpstreamError("server", `data API GET ${url} answered without "${unwrap}"`, { status: 200 });
      }
      return finish ? finish(part as T) : (part as T);
    });
  }

  const listQuery = (q: ListQuery): Query => ({
    descending: q.descending,
    limit: q.limit,
    marker: q.marker || undefined,
  });
  /**
   * A page reached with a marker is stable under new data only when the list runs newest first: then it is the
   * history before the marker. An oldest-first list grows at the end.
   */
  const listClass = (q: ListQuery): CacheClass => (q.marker && q.descending ? "immutable" : "live");

  /**
   * The API adds `transactions` to an expanded ledger only when the ledger has some, unless `transactions=true` is
   * sent too, which makes the key always there (`[]` for none). So `expand` always goes with `transactions=true`,
   * and an expanded ledger has a list even if the answer, against the reference, left the key out.
   *
   * The hashes of a ledger (`transactions` without `expand`) are not defaulted: a list that is not there is not an empty ledger, and
   * a page that took it for one would have every transaction of the ledger fail (and the answer would be stored for a year). The
   * list must be a list of hashes, or the answer is a failure (`checkLedgerHashes`) and nothing is stored.
   */
  const ledger = (id: string, opts?: { expand?: boolean; transactions?: boolean }) => {
    const withTransactions = Boolean(opts?.expand || opts?.transactions);
    const hashesOnly = Boolean(opts?.transactions && !opts.expand);
    return get<Ledger>(
      PATHS.ledger,
      { ledger_param: id },
      { expand: opts?.expand, transactions: withTransactions },
      "immutable",
      "ledger",
      hashesOnly
        ? (found) => {
            checkLedgerHashes(found);
            return found;
          }
        : withTransactions
          ? (found) => ({ ...found, transactions: found.transactions ?? [] })
          : undefined,
    );
  };

  return {
    lastValidated: () => get<LastValidated>(PATHS.lastValidated, {}, {}, "live"),
    // The overloads of the interface narrow `transactions` by the options; the answer is the same either way.
    ledger: ledger as DataApi["ledger"],
    // What the pages read of a transaction is checked inside the load, so that an answer that is not one is a failure and not stored.
    transaction: (hash) =>
      get<TxObject>(PATHS.transaction, { tx_hash: hash }, {}, "immutable", "transaction", (found) => {
        checkIndexTransaction(found, hash);
        return found;
      }),
    transactionBinary: (hash) =>
      get<TxBinary | TxStoredJson>(PATHS.transaction, { tx_hash: hash }, { binary: true }, "immutable", "transaction", (found) => {
        checkBinaryAnswer(found, hash);
        return found;
      }),
    transactions: (q) => get(PATHS.transactions, {}, listQuery(q), listClass(q)),
    account: (address) => get<AccountData>(PATHS.account, { address }, {}, "slow", "account_data"),
    balances: (address) => get(PATHS.balances, { address }, {}, "live"),
    orders: (address) => get(PATHS.orders, { address }, {}, "live"),
    accountTransactions: (address, q) => get(PATHS.accountTransactions, { address }, listQuery(q), listClass(q)),
    accountPayments: (address, q) => get(PATHS.accountPayments, { address }, listQuery(q), listClass(q)),
    accountExchanges: (address, q) => get(PATHS.accountExchanges, { address }, listQuery(q), listClass(q)),
    fees: (q) => get(PATHS.fees, {}, { descending: q.descending, limit: q.limit }, "live"),
  };
}
