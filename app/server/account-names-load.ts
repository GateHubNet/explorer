// The names and toml calls of the account page (E9, display names spec 5, 6.5 and 6.6): the toml of the domain the header shows, the header's names call and the name
// header it gives, and the names of a tab's list. The account route calls them; they are here, with the deadlines they keep, so that their timing is unit-tested with a
// fake clock. Worker-only: they call the data API.
//
// - **The header**: the toml of the node's Domain starts as soon as account_info answers (`nodeTomlOf`), and the header's names call after the header's other calls;
//   the two run side by side, and the header waits for the later of them, never for both one after the other (`namedHeader`). When the node gives no domain, the toml
//   is the names entry's, asked once that call has answered.
// - **The list**: its names are asked for once its rows are in, with what is left of the list's deadline (`nameList`), so that a names call that is late fails the
//   names alone and the list is drawn with addresses.
// - A call that fails or is late never fails the page: `loadNames` marks and logs a names call; a toml call that failed (not `toml not found`) is marked and logged here.

import { accountNameHeader, isProperlyFormedDomain, type NameHeader } from "./account-name-view";
import { decodeDomain, listAddresses, type AccountHeader, type LiveState, type Loaded, type TabList, type UnnamedHeader } from "./account-view";
import type { TomlAnswer } from "./api-types";
import type { DataApi } from "./data-api";
import { byDeadline } from "./deadline";
import { markDegraded } from "./env";
import { logProblem } from "./logging";
import { collectAddresses, loadNames, type NamesContext, type NamesPart, type NamesResult } from "./names-load";
import type { Network } from "./networks";
import type { NodeRpc } from "./node-rpc";
import { isNotFound } from "./upstream";

/**
 * How long the list of the active tab may take before the page gives up on it, its names included. The framework stops streaming a page's deferred data 5 s after the
 * request (`streamTimeout` in entry.server.tsx), and a client given a promise that is cut off then is left with an error instead of a section that says it could not load;
 * the data API's own deadline (5 s) is not early enough to be sure.
 */
export const LIST_DEADLINE_MS = 4_500;

/**
 * How long after account_info the page waits for the close time of the ledger of the account's last transaction, and for the toml of its domain: neither is a reason to
 * hold the header longer.
 */
export const LAST_LEDGER_DEADLINE_MS = 1_500;

/** A list with the names of the accounts it draws; a list that failed has none. */
export const withNames = (list: TabList, names: NamesPart): TabList => (list.state === "ok" ? { ...list, names } : list);

/**
 * The list with the names of the accounts it draws (`listAddresses`): one call, once its rows are in, given what is left of the list's deadline counted from `startedAt`
 * (a list whose rows came after it has none left: the call fails at once, and the list is drawn with addresses). A list that failed is as it is. Never rejects.
 */
export async function nameList(api: Pick<DataApi, "accountNames">, list: TabList, startedAt: number, ctx: Omit<NamesContext, "deadlineMs">): Promise<TabList> {
  if (list.state !== "ok") return list;
  const { part } = await loadNames(api, collectAddresses(listAddresses(list)), { ...ctx, deadlineMs: LIST_DEADLINE_MS - (Date.now() - startedAt) });
  return withNames(list, part);
}

/** What the toml call of the header's domain came to (`accountNameHeader` reads `toml`), and why it failed, for the log line. */
export interface TomlRead {
  toml: Loaded<TomlAnswer>;
  reason?: unknown;
}

/**
 * The toml of `domain`, as the caller gives it (the node's Domain lower-cased by `nodeTomlOf`; the names entry's domain as the data API gave it, lower-cased already: D4
 * checks the domain of its answer as asked), within `LAST_LEDGER_DEADLINE_MS`. It never rejects: a domain the data API never checked (`toml not found`) is `missing`, which
 * is no failure; any other failure, or no answer in time, is `failed`.
 */
export function readToml(api: Pick<DataApi, "toml">, domain: string): Promise<TomlRead> {
  return byDeadline(api.toml(domain), Date.now() + LAST_LEDGER_DEADLINE_MS).then(
    (answer): TomlRead => ({ toml: { state: "ok", value: answer } }),
    (reason: unknown): TomlRead => ({ toml: isNotFound(reason) ? { state: "missing" } : { state: "failed" }, reason }),
  );
}

/**
 * The toml of the domain the node gives the account, asked as soon as account_info has answered (spec 5, 6.5), lower-cased: `null` when there is none to ask for
 * (`NAMES` off, no answer, no Domain, or one that is not a well-formed domain, which the header shows as text). Never rejects.
 */
export function nodeTomlOf(api: Pick<DataApi, "toml">, infoCall: ReturnType<NodeRpc["accountInfo"]>, network: Pick<Network, "features">): Promise<TomlRead | null> {
  if (!network.features.names) return Promise.resolve(null);
  return infoCall.then(
    (found) => {
      const domain = decodeDomain(found.account_data.Domain);
      return domain !== null && isProperlyFormedDomain(domain) ? readToml(api, domain.toLowerCase()) : null;
    },
    () => null,
  );
}

/** What the loaders that name an account's header share. */
export interface NamingContext {
  /** The load context (`markDegraded` reads it). */
  context: unknown;
  request: Request;
  api: Pick<DataApi, "accountNames" | "toml">;
  network: Pick<Network, "features" | "software" | "id" | "native">;
}

/**
 * The name header of an account page (spec 6.5), from the header's names call: `null` with `NAMES` off and when that call failed, so that the header is today's (the node's
 * toml is then not waited for). The toml is that of the domain the header shows: the node's (`nodeToml`, asked since account_info answered); else (the node gave no domain:
 * a deleted account, a node that did not answer, an account without a Domain) the entry's, asked now. A toml call that failed marks the page degraded and is logged.
 */
async function nameHeaderOf(
  { context, request, api, network }: NamingContext,
  address: string,
  names: NamesResult,
  live: LiveState,
  nodeToml: Promise<TomlRead | null>,
): Promise<NameHeader | null> {
  if (names.part.state !== "ok") return null;
  const entry = names.entries.get(address);
  const liveDomain = live.state === "ok" ? live.domain : null;
  const read = liveDomain === null && entry?.domain !== undefined && isProperlyFormedDomain(entry.domain) ? await readToml(api, entry.domain) : await nodeToml;
  if (read?.toml.state === "failed") {
    logProblem("the toml of an account's domain could not be loaded", read.reason, request);
    markDegraded(context, "toml could not be loaded");
  }
  return accountNameHeader({ address, entry, liveDomain, toml: read?.toml ?? null, network });
}

/**
 * The header named: the header's names call over `addresses`, made now and side by side with the node's toml (`nodeToml`, already asked), and the name header they give.
 * It settles when the later of the two has, not after both in turn. Returns the call's names too, the page's own.
 */
export async function namedHeader(
  naming: NamingContext,
  address: string,
  header: UnnamedHeader,
  addresses: readonly string[],
  nodeToml: Promise<TomlRead | null>,
): Promise<{ header: AccountHeader; names: NamesResult }> {
  const { context, request, api, network } = naming;
  const names = await loadNames(api, collectAddresses(addresses), { context, request, features: network.features });
  return { header: { ...header, name: await nameHeaderOf(naming, address, names, header.live, nodeToml) }, names };
}
