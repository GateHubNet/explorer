import { redirect } from "react-router";
import { classicAddressToXAddress, isValidClassicAddress, isValidXAddress, xAddressToClassicAddress } from "ripple-address-codec";

import { accountHref, isAccountTab, OBJECTS_LIMIT, type AccountTab, type ListTab } from "../domain/account-tabs";
import { parseAnalyticsQuery, type AnalyticsPeriod } from "../domain/analytics-params";
import { shortAddress } from "../domain/format";
import {
  accountHeader,
  existenceOf,
  failedList,
  loaded,
  objectsList,
  offersList,
  PAGE_SIZE,
  PAGED_TABS,
  parseTag,
  parseTrail,
  paymentsList,
  tradesList,
  transactionsList,
  type AccountAnalyticsPageData,
  type AccountListPageData,
  type HistoryHeader,
  type ListContext,
  type Loaded,
  type NeverActivatedData,
  type TabList,
} from "../server/account-view";
import { loadAnalytics } from "../server/analytics-load";
import type { Page, TxObject } from "../server/api-types";
import { MARKER_PAGE_CLASS } from "../server/cache-class";
import type { DataApi } from "../server/data-api";
import { clientsFor } from "../server/clients";
import { CARD_DEADLINE_MS } from "../server/deadline";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { markDegraded } from "../server/env";
import { upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { accountMeta } from "../server/meta-account";
import { requireNetwork } from "../server/network-route";
import type { Network } from "../server/networks";
import type { NodeRpc } from "../server/node-rpc";
import { encodeQr, qrPath } from "../server/qr";
import { UpstreamError } from "../server/upstream";
import { PRODUCT_NAME } from "../ui/brand";
import { findNetwork } from "../ui/networks";
import { AccountPage, NeverActivatedPage } from "../ui/pages/AccountPage";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.account.$address";

// The loader names a cache class and throws 404s of class `short`; the answers that are served but never stored (the node is down, a
// section could not be loaded) say so through the degraded mark (see edge-cache.ts).
export const headers = forwardCacheClass;

/**
 * How long the list of the active tab may take before the page gives up on it. The framework stops streaming a page's deferred data
 * 5 s after the request (`streamTimeout` in entry.server.tsx), and a client given a promise that is cut off then is left with an error
 * instead of a section that says it could not load; the data API's own deadline (5 s) is not early enough to be sure.
 */
const LIST_DEADLINE_MS = 4_500;

/** How long after account_info the page waits for the close time of the ledger of the account's last transaction: no time is no reason to hold the header. */
const LAST_LEDGER_DEADLINE_MS = 1_500;

/** A redirect to the one URL a thing has, with the class of the page it leads to. */
function permanent(to: string) {
  return redirect(to, { status: 302, headers: cacheClassHeaders("immutable") });
}

/** A redirect from a URL that was not a page (an unknown tab) to the one that is. Short: nobody should depend on it. */
function tidied(to: string) {
  return redirect(to, { status: 302, headers: cacheClassHeaders("short") });
}

/** Of `list`, which settles by itself, what it came to, or `onTimeout()` if that takes more than `ms`. */
async function within<T>(list: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([list, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The data of the list of a tab that is read from the data API: transactions, payments, trades (paged) and the open offers. */
function readList(api: DataApi, tab: ListTab, ctx: ListContext): Promise<TabList> {
  const query = { descending: true, limit: PAGE_SIZE, marker: ctx.marker };
  switch (tab) {
    case "transactions":
      return api.accountTransactions(ctx.address, query).then((page) => transactionsList(page, ctx));
    case "payments":
      return api.accountPayments(ctx.address, query).then((page) => paymentsList(page, ctx));
    case "trades":
      return api.accountExchanges(ctx.address, query).then((page) => tradesList(page, ctx));
    default:
      return api.orders(ctx.address).then(
        (orders) => offersList(orders),
        (err: unknown) => {
          // A deleted account has no offers to read.
          if (err instanceof UpstreamError && err.kind === "not_found") return offersList({ result: "success", orders: [] });
          throw err;
        },
      );
  }
}

/**
 * `/{net}/account/{address}` (spec 2, 3, 7.2, 10).
 *
 * - An X-address is a 302 to the classic address, with `?tag=` for its tag (class `immutable`); an address that is neither is a 404 of
 *   class `short`, without a call. `?tag=` that is not a decimal 32-bit number is not shown and never echoed. An unknown `?tab=` (the one
 *   parameter that selects what the page shows) is a 302 to the URL without it, and so is a `marker` on a tab that has no pages. That only
 *   tidies those two: every route is keyed on its whole URL (the edge cache's key is the URL and the build ID), so a made-up `back`, `tag`
 *   or other parameter, on a marker URL or any other, is a page of its own, stored for as long as its class says.
 * - **The Analytics tab** (`?tab=analytics`, spec 1.2 and 1.3) has one URL per view, and anything else is a 302 of class `short` before any
 *   call: with `ACCOUNT_ANALYTICS` off, to the account page (as an unknown tab, without the rest of the query); with it on, to the view's
 *   canonical URL (`tab=analytics`, then `period` when it is not the default). The canonical URL is the view (`analyticsPage`, spec 2): class
 *   `live`, the header without the holdings, and the frame and six cards streamed after it.
 * - **The first page of a tab** (no marker) is class `live`. The header is read side by side from the data API (creation, balances) and
 *   the node (`account_info`, `account_objects`, `server_state` for the reserves) and awaited. The list of the tab is a promise that
 *   streams in after it, and that never rejects: when it cannot be loaded it is a `failed` list, which the page shows as "Couldn't
 *   load transactions" with a Retry.
 * - **Never funded** (the index has no creation and the node no account) is a 404 of class `short`, stored for 30 s. **Deleted** (the index
 *   knows it, the node does not) is the history with a "Deleted" banner and is stored as `live`: neither is degraded, both are the answer.
 *   What marks the request degraded (the page is served and not stored) is the node failing ("Live state unavailable"), the balances
 *   failing, and a section (the list) that could not be loaded.
 * - **A page with a marker** is old history and class `MARKER_PAGE_CLASS` (`slow`, not `immutable`: backfill writes history below the
 *   frontier, see cache-class.ts), `noindex, follow`. Everything is awaited (a stored page must be whole), and it carries no live state,
 *   which would be as old as the page. A marker the API refuses is a 404.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  // The analytics view's deadline is counted from here, as the list's is.
  const started = Date.now();
  const network = requireNetwork(context, params);
  const address = params.address ?? "";

  if (isValidXAddress(address)) {
    const { classicAddress, tag } = xAddressToClassicAddress(address);
    return permanent(`/${network.id}/account/${classicAddress}${tag === false ? "" : `?tag=${tag}`}`);
  }
  if (!isValidClassicAddress(address)) {
    throw cached({ notFound: `account ${JSON.stringify(address.slice(0, 40))}` }, "short", { status: 404 });
  }

  const url = new URL(request.url);
  const search = url.searchParams;
  const base = `/${network.id}/account/${address}`;
  const without = (...names: string[]) => {
    const rest = new URLSearchParams(search);
    for (const name of names) rest.delete(name);
    return rest.size > 0 ? `${base}?${rest}` : base;
  };

  const tabParam = search.get("tab");
  if (search.has("tab") && !isAccountTab(tabParam)) return tidied(without("tab"));
  const tab: AccountTab = isAccountTab(tabParam) ? tabParam : "transactions";

  if (tab === "analytics") {
    if (!network.features.accountAnalytics) return tidied(base);
    // The query as it came (`url.search`), not as `URLSearchParams` writes it again: an escaped spelling of the canonical query is redirected.
    const view = parseAnalyticsQuery(url.search);
    if ("canonical" in view) return tidied(`${base}?${view.canonical}`);
    // The canonical query has no `tag`: the view's QR code is the classic address.
    return analyticsPage(context, request, network, view.period, { ...pageBase(network, address, null), tab }, started + CARD_DEADLINE_MS);
  }

  const markerParam = search.get("marker");
  if (markerParam !== null && !PAGED_TABS.includes(tab)) return tidied(without("marker", "back"));
  if (markerParam !== null && !isMarker(markerParam)) {
    throw cached({ notFound: "that page of the account" }, "short", { status: 404 });
  }
  const marker = markerParam ?? undefined;

  const common: Common = { ...pageBase(network, address, parseTag(search.get("tag"))), tab };
  const ctx: ListContext = { net: network.id, native: network.native, address, marker, back: marker === undefined ? [] : parseTrail(search.get("back")) };

  return marker === undefined
    ? firstPage(context, request, network, tab, ctx, common)
    : historyPage(context, network, tab, ctx, common);
}

type Common = Pick<AccountListPageData, "kind" | "address" | "native" | "tab" | "tag" | "qr" | "analyticsTab">;
type AnalyticsCommon = Pick<AccountAnalyticsPageData, "kind" | "address" | "native" | "tab" | "tag" | "qr" | "analyticsTab">;

/**
 * What every account page is drawn from, whatever its tab. A page opened with a destination tag has the tag in its QR code, as the X-address of
 * the address (a wallet that scans it fills in both); without one the code is the classic address.
 */
function pageBase(network: Network, address: string, tag: number | null) {
  const content = tag === null ? address : classicAddressToXAddress(address, tag, false);
  const code = encodeQr(content);
  return {
    kind: "account" as const,
    address,
    native: network.native,
    tag,
    qr: { size: code.size, path: qrPath(code), content, tag },
    analyticsTab: network.features.accountAnalytics,
  };
}

/** `make()`'s value: made on the first call, and the same on every call after. */
function once<T>(make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
}

/**
 * The time of "Last active": the close time of one ledger, which is looked up as soon as account_info has answered (not after the rest of the
 * header's calls) and given a deadline of its own, so that the header waits for its slowest call, and for this one no more than that deadline
 * after account_info. It never rejects: no time is not a degraded page.
 */
function lastLedgerTimeOf(api: DataApi, infoCall: ReturnType<NodeRpc["accountInfo"]>, request: Request): Promise<number | null> {
  return infoCall.then(
    (found) => {
      const seq = found.account_data.PreviousTxnLgrSeq;
      if (!Number.isSafeInteger(seq)) return null;
      return within(
        api.ledger(String(seq)).then(
          (ledger) => (Number.isFinite(ledger.close_time) ? ledger.close_time : null),
          (err: unknown) => {
            // A ledger the index does not have yet (it is behind the node) is the ordinary case of an account that has just been active:
            // no time, and nothing worth a line for every visit. Any other failure is logged.
            if (!(err instanceof UpstreamError && err.kind === "not_found")) {
              logProblem("the ledger of an account's last transaction could not be read", err, request);
            }
            return null;
          },
        ),
        LAST_LEDGER_DEADLINE_MS,
        () => null,
      );
    },
    () => null,
  );
}

/** Whether the index has a transaction of the address, from its one-row history (the existence probe, spec 10). */
async function historyOf(rows: Promise<Page<"transactions", TxObject>>): Promise<Loaded<boolean>> {
  const [probe] = await Promise.allSettled([rows.then((found) => found.transactions.length > 0)]);
  return loaded(probe);
}

/**
 * The answer for an address the page has no account of: the 404 of one that was never activated (class `short`), or the 503 of one that cannot
 * be told apart from it.
 */
function notAnAccount(existence: "never-activated" | "outage", network: Network, address: string) {
  if (existence === "outage") {
    return upstreamOutage(new UpstreamError("server", "the account could not be told apart from one that does not exist"), `account ${shortAddress(address)}`);
  }
  const other = findNetwork(network.other);
  const page: NeverActivatedData = { kind: "never-activated", address, other: { id: network.other, name: other?.name ?? network.other } };
  return cached(page, "short", { status: 404 });
}

/** What the header could not read marks the page degraded (served and not stored) and is logged. */
function reportProblems(context: Route.LoaderArgs["context"], request: Request, problems: readonly string[]) {
  if (problems.length === 0) return;
  markDegraded(context, problems.join("; "));
  logProblem("an account page is degraded", new Error(problems.join("; ")), request);
}

/**
 * A page of old history: awaited whole, class `MARKER_PAGE_CLASS`, and nothing but the list. It does not ask for the creation record: that
 * is slow-class data that must not sit in a page stored for a long time, and the index has none for an account that was created before its
 * first ledger (it is filled by range), whose first page shows it as active all the same. The page does not exist when the API refuses
 * the marker or when there is nothing behind it.
 */
async function historyPage(context: Route.LoaderArgs["context"], network: Network, tab: ListTab, ctx: ListContext, common: Common) {
  const { api } = clientsFor(context, network);
  let list: TabList;
  try {
    list = await readList(api, tab, ctx);
  } catch (err) {
    // The API refuses a marker that is not one (a 400): the page does not exist.
    if (err instanceof UpstreamError && err.kind === "bad_request") {
      throw cached({ notFound: "that page of the account" }, "short", { status: 404 });
    }
    return upstreamOutage(err, "the account's history");
  }
  if (list.state === "ok" && "rows" in list && list.rows.length === 0) {
    throw cached({ notFound: "that page of the account" }, "short", { status: 404 });
  }

  const header: HistoryHeader = { status: "history" };
  const page: AccountListPageData = { ...common, mode: "history", header, list };
  return cached(page, MARKER_PAGE_CLASS);
}

/** The first page of a tab: class `live`, the header awaited, the list streamed. */
async function firstPage(
  context: Route.LoaderArgs["context"],
  request: Request,
  network: Network,
  tab: ListTab,
  ctx: ListContext,
  common: Common,
) {
  const { api, node } = clientsFor(context, network);
  const address = ctx.address;

  // The list of the tab starts now, beside the header. It never rejects, and what it came to is settled before the page's stream ends.
  const settled: Promise<TabList> | null =
    tab === "objects"
      ? null
      : within(
          readList(api, tab, ctx).catch((err: unknown) => {
            logProblem(`the ${tab} of an account could not be loaded`, err, request);
            markDegraded(context, `${tab} could not be loaded`);
            return failedList(tab);
          }),
          LIST_DEADLINE_MS,
          () => {
            logProblem(`the ${tab} of an account took too long`, new Error("deadline"), request);
            markDegraded(context, `${tab} took too long`);
            return failedList(tab);
          },
        );

  const infoCall = node.accountInfo(address);
  const lastLedger = lastLedgerTimeOf(api, infoCall, request);

  const results = await Promise.allSettled([
    api.account(address),
    infoCall,
    node.accountObjects(address, { limit: OBJECTS_LIMIT }),
    node.serverState(),
    api.balances(address),
    lastLedger,
  ]);
  const created = loaded(results[0]);
  const info = loaded(results[1]);
  const objects = loaded(results[2]);
  const state = loaded(results[3]);
  const balances = loaded(results[4]);
  const lastLedgerTime = results[5].status === "fulfilled" ? results[5].value : null;

  // Neither the index nor the node has the account: the history decides between a deleted account (the index's creation records start
  // at its first ledger) and an address that never was, with one row of it.
  const history = existenceOf(created, info) === "undetermined" ? await historyOf(api.accountTransactions(address, { limit: 1 })) : undefined;

  const existence = existenceOf(created, info, history);
  if (existence === "never-activated" || existence === "outage") return notAnAccount(existence, network, address);

  const { header, problems } = accountHeader({ native: network.native, created, info, objects, state, balances, lastLedgerTime, history });
  reportProblems(context, request, problems);

  let list: Promise<TabList> | TabList;
  if (settled !== null) {
    list = settled;
  } else if (objects.state === "ok") {
    list = objectsList(objects.value, network.native);
  } else if (objects.state === "missing") {
    list = objectsList(null, network.native);
  } else {
    list = failedList("objects");
  }

  const page: AccountListPageData = { ...common, mode: "live", header, list };
  return cached(page, "live");
}

/**
 * The analytics view (spec 2): class `live`. Its header is the first page's without the holdings (spec 2.1: no `balances`, no
 * `account_objects`), awaited. The frame and the six cards are promises that stream in after it (`loadAnalytics`): they start beside the
 * header and do not wait for it, all of them by the deadline of the loader's start + `CARD_DEADLINE_MS`. Call A (the creation record) is the
 * header's and All's first month's, one promise; call P (the one-row history) the existence probe's and All's when there is no creation
 * record, one promise. A page that turns out not to be the view (never activated, the 503 of an outage, a bug) abandons them first: nothing of
 * them is logged, marked or finished in the background.
 */
async function analyticsPage(
  context: Route.LoaderArgs["context"],
  request: Request,
  network: Network,
  period: AnalyticsPeriod,
  common: AnalyticsCommon,
  deadlineAt: number,
) {
  const { api, node } = clientsFor(context, network);
  const { address } = common;

  const account = api.account(address);
  const probe = once(() => api.accountTransactions(address, { limit: 1 }));
  const infoCall = node.accountInfo(address);
  const stateCall = node.serverState();
  const lastLedger = lastLedgerTimeOf(api, infoCall, request);
  let toldDeleted!: (deleted: boolean) => void;
  const deleted = new Promise<boolean>((resolve) => (toldDeleted = resolve));
  const abandon = new AbortController();
  const analytics = loadAnalytics({ context, request, api, network, address, period, deadlineAt, account, probe, deleted, signal: abandon.signal });

  let isView = false;
  try {
    const results = await Promise.allSettled([account, infoCall, stateCall, lastLedger]);
    const created = loaded(results[0]);
    const info = loaded(results[1]);
    const state = loaded(results[2]);
    const lastLedgerTime = results[3].status === "fulfilled" ? results[3].value : null;
    const history = existenceOf(created, info) === "undetermined" ? await historyOf(probe()) : undefined;

    const existence = existenceOf(created, info, history);
    if (existence === "never-activated" || existence === "outage") return notAnAccount(existence, network, address);

    const { header, problems } = accountHeader({ native: network.native, created, info, state, lastLedgerTime, history }, { holdings: false });
    isView = true;
    toldDeleted(existence === "deleted");
    reportProblems(context, request, problems);

    const page: AccountAnalyticsPageData = { ...common, mode: "live", header, analytics };
    return cached(page, "live");
  } finally {
    if (!isView) abandon.abort();
  }
}

export function meta({ loaderData, matches, params }: Route.MetaArgs) {
  const ctx = metaContext(params.net, matches);
  if (!loaderData || !ctx) return [];

  if (loaderData.kind === "never-activated") {
    return [{ title: `Address not activated · ${ctx.network.name} · ${PRODUCT_NAME}` }, { name: "robots", content: "noindex" }];
  }
  return accountMeta(loaderData, ctx);
}

export default function Account({ loaderData }: Route.ComponentProps) {
  const network = useNetwork();
  return loaderData.kind === "account" ? (
    <AccountPage network={network} data={loaderData} />
  ) : (
    <NeverActivatedPage network={network} data={loaderData} />
  );
}
