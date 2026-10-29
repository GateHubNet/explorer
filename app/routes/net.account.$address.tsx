import { redirect } from "react-router";
import { classicAddressToXAddress, isValidClassicAddress, isValidXAddress, xAddressToClassicAddress } from "ripple-address-codec";

import { accountHref, isAccountTab, OBJECTS_LIMIT, type AccountTab, type ListTab } from "../domain/account-tabs";
import { parseAnalyticsQuery, type AnalyticsPeriod } from "../domain/analytics-params";
import { shortAddress } from "../domain/format";
import { accountNameHeader } from "../server/account-name-view";
import { LAST_LEDGER_DEADLINE_MS, LIST_DEADLINE_MS, namedHeader, nameList, nodeTomlOf, withNames } from "../server/account-names-load";
import {
  accountHeader,
  existenceOf,
  failedList,
  headerAccounts,
  listAddresses,
  loaded,
  nftsList,
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
import { echoOf } from "../server/echo";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv, markDegraded } from "../server/env";
import { upstreamOutage } from "../server/loader-errors";
import { logProblem } from "../server/logging";
import { isMarker } from "../server/marker";
import { metaContext } from "../server/meta";
import { accountMeta } from "../server/meta-account";
import { collectAddresses, loadNames } from "../server/names-load";
import { requireNetwork } from "../server/network-route";
import { networkOf, type Network } from "../server/networks";
import type { NodeRpc } from "../server/node-rpc";
import { encodeQr, qrPath } from "../server/qr";
import { UpstreamError } from "../server/upstream";
import { PRODUCT_NAME } from "../ui/brand";
import { NamesProvider } from "../ui/names";
import { AccountPage, NeverActivatedPage } from "../ui/pages/AccountPage";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.account.$address";

// The loader names a cache class and throws 404s of class `short`; the answers that are served but never stored (the node is down, a
// section could not be loaded) say so through the degraded mark (see edge-cache.ts).
export const headers = forwardCacheClass;

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

/** The data of the list of a tab that is read from the data API: transactions, payments, trades, NFTs (paged) and the open offers. */
function readList(api: DataApi, tab: ListTab, ctx: ListContext): Promise<TabList> {
  const query = { descending: true, limit: PAGE_SIZE, marker: ctx.marker };
  switch (tab) {
    case "transactions":
      return api.accountTransactions(ctx.address, query).then((page) => transactionsList(page, ctx));
    case "payments":
      return api.accountPayments(ctx.address, query).then((page) => paymentsList(page, ctx));
    case "trades":
      return api.accountExchanges(ctx.address, query).then((page) => tradesList(page, ctx));
    case "nfts":
      // What the account holds now, in the API's order (by collection and serial): no `descending`.
      return api.accountNfts(ctx.address, { limit: PAGE_SIZE, marker: ctx.marker }).then((page) => nftsList(page, ctx));
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

/** A query as it came, without the `_routes` parameter that React Router's client adds to a data request (`{path}.data?…`). */
const withoutRoutesParam = (search: string) =>
  search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => !/^_routes(=|$)/.test(part))
    .join("&");

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
 * - **The NFTs tab** (`?tab=nfts`, NFT spec 6.1) is a list of the data API (`accountNfts`) paged by marker as the transactions are. While `NFTS` is off the
 *   tab is the "soon" label and its URL a 302 of class `short` to the account page before any call, as Analytics'; while it is on, the Objects tab's NFT pages lead to it.
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
 * - **Names** (display names spec 5, 6.5): the first page makes two names calls, so that the header never waits for the list: the header's,
 *   awaited after the header's calls (the address, its parent, its tokens' issuers and, on the Objects tab, the rows' accounts), and the list's,
 *   in the list's promise after its rows. The toml of the domain the header shows is asked as soon as the node gives it, and awaited beside the
 *   header's names call; when the node gives none (a deleted account, a node that did not answer, no Domain set), it is the header call's entry's,
 *   asked after that call (the data API gives a deleted account none: no toml call). The calls and their deadlines are account-names-load.ts's. The page behind a marker makes one call (the address and the rows)
 *   and no toml call, and the analytics view the header's (the address and its parent) and the toml's, its cards their own. A names call that
 *   fails or is late, and a toml call that fails, never fail the page: it shows what it has without them and is served, not stored; `toml not
 *   found` (a domain the data API never checked) is no failure. With `NAMES` off neither call is made, and the page is today's.
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
    throw cached({ notFound: `account ${echoOf(address)}` }, "short", { status: 404 });
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

  // The NFTs tab is the "soon" label while `NFTS` is off, and its URL is as an unknown tab's, a 302 to the account page before any call.
  if (tab === "nfts" && !network.features.nfts) return tidied(base);

  if (tab === "analytics") {
    if (!network.features.accountAnalytics) return tidied(base);
    // The query as it came (`url.search`), not as `URLSearchParams` writes it again: an escaped spelling of the canonical query is redirected.
    // A client-side navigation asks for `{path}.data?{query}&_routes={ids}`: that `_routes` is React Router's, not the view's, and read as the
    // view's it would make the canonical URL redirect to itself, which the browser would follow until the visitor's limit said 429.
    const view = parseAnalyticsQuery(url.pathname.endsWith(".data") ? withoutRoutesParam(url.search) : url.search);
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
    : historyPage(context, request, network, tab, ctx, common);
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
function notAnAccount(context: Route.LoaderArgs["context"], existence: "never-activated" | "outage", network: Network, address: string) {
  if (existence === "outage") {
    return upstreamOutage(new UpstreamError("server", "the account could not be told apart from one that does not exist"), `account ${shortAddress(address)}`);
  }
  const other = networkOf(network.other, getEnv(context));
  const page: NeverActivatedData = { kind: "never-activated", address, other: { id: other.id, name: other.name } };
  return cached(page, "short", { status: 404 });
}

/** What the header could not read marks the page degraded (served and not stored) and is logged. */
function reportProblems(context: Route.LoaderArgs["context"], request: Request, problems: readonly string[]) {
  if (problems.length === 0) return;
  markDegraded(context, problems.join("; "));
  logProblem("an account page is degraded", new Error(problems.join("; ")), request);
}

/**
 * A page of old history: awaited whole, class `MARKER_PAGE_CLASS`, and nothing but the list and its one names call. It does not ask for the creation record: that
 * is slow-class data that must not sit in a page stored for a long time, and the index has none for an account that was created before its
 * first ledger (it is filled by range), whose first page shows it as active all the same. The page does not exist when the API refuses
 * the marker or when there is nothing behind it.
 */
async function historyPage(context: Route.LoaderArgs["context"], request: Request, network: Network, tab: ListTab, ctx: ListContext, common: Common) {
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

  // One names call, awaited (the page is stored whole): the address and the rows' accounts. Its header is the name and the labels alone (Ruling 8): no toml call.
  const { address } = ctx;
  const names = await loadNames(api, collectAddresses(address, listAddresses(list)), { context, request, features: network.features });
  const name = names.part.state === "ok" ? accountNameHeader({ address, entry: names.entries.get(address), liveDomain: null, toml: null, network, brief: true }) : null;
  const header: HistoryHeader = { status: "history", name };
  const page: AccountListPageData = { ...common, mode: "history", header, list: withNames(list, names.part), names: names.part };
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

  // The list of the tab starts now, beside the header. It never rejects, and what it came to is settled before the page's stream ends. Its rows are
  // raced against the list's deadline; then the names of the accounts they draw are asked for with what is left of it (`nameList`), outside that race,
  // so that a names call that fails or is late leaves the list drawn with addresses, and never makes it a list that failed.
  const listStarted = Date.now();
  const settled: Promise<TabList> | null =
    tab === "objects"
      ? null
      : within(
          readList(api, tab, ctx).catch((err: unknown) => {
            logProblem(`the ${tab} of an account could not be loaded`, err, request);
            markDegraded(context, `${tab} could not be loaded`);
            return failedList(tab, network.id);
          }),
          LIST_DEADLINE_MS,
          () => {
            logProblem(`the ${tab} of an account took too long`, new Error("deadline"), request);
            markDegraded(context, `${tab} took too long`);
            return failedList(tab, network.id);
          },
        ).then((list) => nameList(api, list, listStarted, { context, request, features: network.features }));

  const infoCall = node.accountInfo(address);
  const lastLedger = lastLedgerTimeOf(api, infoCall, request);
  // The toml of the node's domain starts as soon as account_info answers; it is awaited beside the header's names call (`namedHeader`), not before it.
  const nodeToml = nodeTomlOf(api, infoCall, network);

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
  // `nodeToml` is left running on purpose: it never rejects, logs or marks nothing itself, and the 404 or 503 never reads it.
  if (existence === "never-activated" || existence === "outage") return notAnAccount(context, existence, network, address);

  const unnamed = accountHeader({ native: network.native, created, info, objects, state, balances, lastLedgerTime, history });
  reportProblems(context, request, unnamed.problems);

  // The Objects tab's rows come with the header. An NFT page of it leads to the account's NFTs while `NFTS` is on; with it off there is no such tab to lead to.
  const nftsHref = network.features.nfts ? accountHref(network.id, address, { tab: "nfts" }) : undefined;
  let objectsTab: TabList | null = null;
  if (settled === null) {
    if (objects.state === "ok") objectsTab = objectsList(objects.value, network.native, nftsHref);
    else if (objects.state === "missing") objectsTab = objectsList(null, network.native);
    else objectsTab = failedList("objects");
  }

  // The header's names call: the accounts the header draws and the Objects tab's rows' accounts (spec 5: no call of their own).
  const drawn = [...headerAccounts(address, unnamed.header, network.features), ...(objectsTab === null ? [] : listAddresses(objectsTab))];
  const { header, names } = await namedHeader({ context, request, api, network }, address, unnamed.header, drawn, nodeToml);
  const list: Promise<TabList> | TabList = objectsTab === null ? settled! : withNames(objectsTab, names.part);

  const page: AccountListPageData = { ...common, mode: "live", header, list, names: names.part };
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
  // As on the first page: asked as soon as account_info answers, awaited beside the header's names call.
  const nodeToml = nodeTomlOf(api, infoCall, network);
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
    // `nodeToml` is left running on purpose, as on the first page: it never rejects, logs or marks nothing itself, and the 404 or 503 never reads it.
    if (existence === "never-activated" || existence === "outage") return notAnAccount(context, existence, network, address);

    const unnamed = accountHeader({ native: network.native, created, info, state, lastLedgerTime, history }, { holdings: false });
    isView = true;
    toldDeleted(existence === "deleted");
    reportProblems(context, request, unnamed.problems);

    // The header's names call: the address and its parent (no holdings). The cards make their own (`loadAnalytics`).
    const drawn = headerAccounts(address, unnamed.header, network.features);
    const { header, names } = await namedHeader({ context, request, api, network }, address, unnamed.header, drawn, nodeToml);
    const page: AccountAnalyticsPageData = { ...common, mode: "live", header, analytics, names: names.part };
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
  // The page's names (the header's call) are one provider above everything it draws, the activator and the token issuers included; a list and a card have their own inside.
  return loaderData.kind === "account" ? (
    <NamesProvider names={loaderData.names.map}>
      <AccountPage network={network} data={loaderData} />
    </NamesProvider>
  ) : (
    <NeverActivatedPage network={network} data={loaderData} />
  );
}
