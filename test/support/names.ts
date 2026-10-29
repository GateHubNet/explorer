// What the page specs of E9 share to check names: the names of a network's fixtures read the way a page reads them (`nameViewOf` over `account_names.json`),
// the names calls a mock saw, and the links to an account a page draws. A spec computes what a page should say from these, never from a name written by hand:
// the seeded names are not unique and a regeneration of the fixtures may change them.

import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import { linkTextOf, nameTitleOf, nameViewOf, shownIssuer, type NameKind, type NameView } from "../../app/domain/names";
import type { AccountNameEntry } from "../../app/server/api-types";
import { NAMES_BATCH_LIMIT } from "../../app/server/names-load";
import { decodeLoaderData } from "./loader-data";
import { anchors, hrefs } from "./pages";
import { cold } from "./subrequest-miss";
import { dataApiError, mockUpstream, type UpstreamMock } from "./upstream";
import type { NetworkName, SeenRequest } from "./upstream-core";

const tables = import.meta.glob("../fixtures/http/*/data-api/account_names.json", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

const parsed = new Map<NetworkName, Promise<Record<string, AccountNameEntry>>>();

/** The entries of a network's `data-api/account_names.json`, by address. */
function nameTable(net: NetworkName): Promise<Record<string, AccountNameEntry>> {
  let table = parsed.get(net);
  if (table === undefined) {
    const load = tables[`../fixtures/http/${net}/data-api/account_names.json`];
    if (load === undefined) throw new Error(`no names fixture for ${net}`);
    table = load().then((text) => JSON.parse(text) as Record<string, AccountNameEntry>);
    parsed.set(net, table);
  }
  return table;
}

/** What the pages make of the fixtures' entry for `address`: the view they draw from, `null` for an address with nothing to show. */
export async function viewOf(net: NetworkName, address: string): Promise<NameView | null> {
  const entry = (await nameTable(net))[address];
  return entry === undefined ? null : nameViewOf(entry);
}

/** What a page writes for an issuer: its plain name when the fixtures give it one that is verified or GateHub's and has no label, else its short address (`shownIssuer`). */
export async function issuerTextOf(net: NetworkName, address: string): Promise<string> {
  const view = await viewOf(net, address);
  return shownIssuer(address, view === null ? {} : { [address]: view });
}

/** What a page writes for an issuer when `answerNamesAfterTheirEnd` names it: `Fixture` and the last four characters of its address. */
export function issuerTextAfterItsEnd(address: string): string {
  return shownIssuer(address, { [address]: nameViewOf(nameAfterItsEnd(address))! });
}

/** The addresses of `addresses` that the fixtures give a name to (a verified, GateHub's or a domain's), in the order given. */
export async function namedAmong(net: NetworkName, addresses: readonly string[]): Promise<string[]> {
  const views = await Promise.all(addresses.map((address) => viewOf(net, address)));
  return addresses.filter((_, i) => views[i]?.name !== undefined);
}

/** The addresses of `addresses` that the fixtures give something to show (a name, an account network name or a label): the ones a page's names map holds. */
export async function viewedAmong(net: NetworkName, addresses: readonly string[]): Promise<string[]> {
  const views = await Promise.all(addresses.map((address) => viewOf(net, address)));
  return addresses.filter((_, i) => views[i] !== null);
}

/**
 * What a link to `address` starts with: the name `linkTextOf` gives when the fixtures name it, else its short address, or its whole address for a `full` link. A mark's words follow a
 * name (`Northpeak Treasury verified name`), so a spec compares a link's text with `startsWith`, never `===`.
 */
export async function shownName(net: NetworkName, address: string, { full = false }: { full?: boolean } = {}): Promise<string> {
  const view = await viewOf(net, address);
  return view?.name ? linkTextOf(view) : full ? address : shortAddress(address);
}

/** Whether a request a mock saw is a call to the names batch. */
export const isNamesRequest = (request: Pick<SeenRequest, "url">): boolean => new URL(request.url).pathname.endsWith("/v2/account_names");

/**
 * The requests of a mock but its names calls: what a spec about the other calls of a page compares. The Worker keeps the answer of a names call a minute, so whether an earlier
 * render of the file has made the call a later one would make is the cache's state, which such a spec does not depend on.
 */
export const withoutNames = <T extends Pick<SeenRequest, "url">>(requests: readonly T[]): T[] => requests.filter((request) => !isNamesRequest(request));

/** Whether a request a mock saw is a call for a domain's toml (`GET /v2/toml/{domain}`: the account page's header asks for one). */
export const isTomlRequest = (request: Pick<SeenRequest, "url">): boolean => /\/v2\/toml\/[^/]+$/.test(new URL(request.url).pathname);

/**
 * The requests of a mock but its names calls and its toml calls: what a spec about the other calls of the account page compares. The Worker keeps a toml's answer a minute
 * too (class `minute`), so whether an earlier render made the call is the cache's state, as for a names call; the account page's names specs assert both.
 */
export const withoutNamesOrTomls = <T extends Pick<SeenRequest, "url">>(requests: readonly T[]): T[] => requests.filter((request) => !isNamesRequest(request) && !isTomlRequest(request));

/** The toml calls of a mock: the domain each asked for, as asked, in the order the calls came. */
export function tomlCalls(mock: { requests: readonly SeenRequest[] }): string[] {
  return mock.requests.filter(isTomlRequest).map((request) => decodeURIComponent(new URL(request.url).pathname.split("/").at(-1)!));
}

/** The addresses a names call asks for, in the order asked: a request the mock saw, or one an override is given. */
export const askedIn = (request: Pick<SeenRequest, "url">): string[] => (new URL(request.url).searchParams.get("addresses") ?? "").split(",");

/** The names calls of a mock: the addresses each asked for, in the order the calls came. */
export function namesCalls(mock: { requests: readonly SeenRequest[] }): string[][] {
  return mock.requests.filter(isNamesRequest).map(askedIn);
}

/** The status each names call of a mock was answered with, in the order the calls came (whatever override key stood for them). */
export function namesStatuses(mock: { requests: readonly SeenRequest[] }): number[] {
  return mock.requests.filter(isNamesRequest).map((request) => request.status);
}

/** The words the marks add to a name in a link's text (`NameMark`): a verified name's seal, GateHub's tag, the visible "not verified". */
export const MARK_WORDS = { verified: "verified name", account: "named by GateHub", domain: "not verified" } as const satisfies Record<NameKind, string>;

/**
 * The URL a route's data is asked for with, as the browser asks for it: `path` (which ends in `.data`, and may have a query) with `_routes` naming the route by its id
 * (`routes/net.amm._index`), which is no part of the view.
 */
export const dataUrlOf = (path: string, routeId: string): string => `${path}${path.includes("?") ? "&" : "?"}_routes=${encodeURIComponent(routeId)}`;

/** The names part of a route's data in the body of its `.data` response, by the route's id (`routes/net.amm._index`). */
export function namesPartOf(body: string, routeId: string): { state: string; map: Record<string, unknown> } {
  const routes = decodeLoaderData(body) as Record<string, { data: { names: { state: string; map: Record<string, unknown> } } }>;
  return routes[routeId]!.data.names;
}

/** The override that makes the names call fail: a 503, as the data API answers when it is down. */
export const failingNames = () => ({ "GET /v2/account_names": dataApiError(503, "unavailable") });

/**
 * The setup the specs of a page's names share, called once at the top of the file: `Date` alone is faked (the failure hold reads nothing else) and moved `advance` ms on after each
 * test, past the longest keep or hold, so that no test reads what another left; with `cold` (the default) every lookup of a subrequest entry misses, so that each render reaches the
 * mock whatever an earlier one kept; a first render may take longer than 5 s on a busy machine, so a test may take 20 s. Returns `upstream`, which puts the mock of a test in place
 * (and the one before it away, which must have been used) and, after each test, says when an override was not.
 */
export function namesSpec({ advance, cold: dropSubrequests = true }: { advance: number; cold?: boolean }) {
  vi.setConfig({ testTimeout: 20_000 });
  let current: UpstreamMock | undefined;

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  beforeEach(() => {
    if (dropSubrequests) cold();
  });
  afterEach(() => {
    const unused = current?.unusedOverrides();
    current?.restore();
    current = undefined;
    vi.restoreAllMocks();
    vi.setSystemTime(Date.now() + advance);
    expect(unused ?? []).toEqual([]);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  return {
    upstream(net: Parameters<typeof mockUpstream>[0], overrides?: Parameters<typeof mockUpstream>[1]): UpstreamMock {
      if (current !== undefined) {
        expect(current.unusedOverrides()).toEqual([]);
        current.restore();
      }
      current = mockUpstream(net, overrides);
      return current;
    },
  };
}

/**
 * Keeps the log line of a failed names call out of the test's output (until `vi.restoreAllMocks`), and counts the lines: `loadNames` logs "names could not be loaded" once for a call,
 * however many of its chunks failed.
 */
export function watchNamesLog(): () => number {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => errors.mock.calls.filter(([line]) => String(line).includes("names could not be loaded")).length;
}

/** `addresses` sorted, as `loadNames` asks for them. */
export const sorted = (addresses: readonly string[]): string[] => [...addresses].sort();

/** `addresses`, sorted, in the calls of `NAMES_BATCH_LIMIT` that `loadNames` makes of them. */
export function inCalls(addresses: readonly string[]): string[][] {
  const all = sorted(addresses);
  const calls: string[][] = [];
  for (let from = 0; from < all.length; from += NAMES_BATCH_LIMIT) calls.push(all.slice(from, from + NAMES_BATCH_LIMIT));
  return calls;
}

/** The links to `address`'s page in some HTML. */
export const linksTo = (html: string, net: NetworkName, address: string) => anchors(html).filter((a) => a.attrs.includes(`href="/${net}/account/${address}"`));

/** The accounts whose page the HTML links to, once each, in the order they are met (the head's issuers and the table's takers alike). */
export function linkedAccounts(html: string, net: NetworkName): string[] {
  const pattern = new RegExp(`^/${net}/account/(r\\w+)$`);
  return [...new Set(hrefs(html).flatMap((href) => pattern.exec(href)?.[1] ?? []))];
}

/**
 * Says that every link to `address` in `html` is a link by name: the name `linkTextOf` gives, the title `nameTitleOf` gives, and not the short address. There must be at least
 * one link. `ignore` leaves out the links whose attributes match it (the home page's search hints keep the short address).
 */
export async function expectNamedLinks(
  html: string,
  net: NetworkName,
  address: string,
  shortForm: string,
  { ignore }: { ignore?: RegExp } = {},
): Promise<void> {
  const view = await viewOf(net, address);
  expect(view?.name, `the fixtures give ${address} a name`).toBeDefined();
  const links = linksTo(html, net, address).filter((link) => ignore === undefined || !ignore.test(link.attrs));
  expect(links.length, `a link to ${address}`).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.text).toContain(linkTextOf(view!));
    expect(link.text).not.toContain(shortForm);
    expect(link.attrs).toContain(`title="${nameTitleOf(view!, address)}"`);
  }
}

/**
 * Says what a link's text is for `address`: a name that `linkTextOf` gives (and no short address) for an address the fixtures name; else the short address first (an account that
 * has labels only has their mark after it).
 */
export async function expectAccountText(text: string, net: NetworkName, address: string, shortForm: string): Promise<void> {
  const view = await viewOf(net, address);
  if (view?.name) {
    expect(text).toContain(linkTextOf(view));
    expect(text).not.toContain(shortForm);
  } else {
    expect(text.startsWith(shortForm), `${text} starts with ${shortForm}`).toBe(true);
  }
}

const ACCOUNT_HREF = /href="\/(xrpl|xahau)\/account\/(r[1-9A-HJ-NP-Za-km-z]{24,34})"/;

/**
 * Says that every link to an account's page in `html` is drawn by what the fixtures say of that account: a name that `linkTextOf` gives, with the title `nameTitleOf` gives, for one the
 * fixtures name; else its address, shortened or whole (a `full` link), after which an account with labels has their mark. Returns the addresses linked, told apart by whether they are
 * named, so that a spec can say that it checked both kinds.
 */
export async function expectAccountsDrawn(html: string, net: NetworkName): Promise<{ named: string[]; plain: string[] }> {
  const linked = new Map<string, ReturnType<typeof anchors>>();
  for (const link of anchors(html)) {
    const match = ACCOUNT_HREF.exec(link.attrs);
    if (match?.[1] === net) linked.set(match[2]!, [...(linked.get(match[2]!) ?? []), link]);
  }
  const named: string[] = [];
  const plain: string[] = [];
  for (const [address, links] of linked) {
    const view = await viewOf(net, address);
    const short = shortAddress(address);
    if (view?.name) {
      named.push(address);
      for (const link of links) {
        expect(link.text, `the link to ${address}`).toContain(linkTextOf(view));
        expect(link.text, `the link to ${address}`).not.toContain(short);
        expect(link.attrs, `the link to ${address}`).toContain(`title="${nameTitleOf(view, address)}"`);
      }
    } else {
      plain.push(address);
      for (const link of links) expect(link.text.startsWith(short) || link.text.startsWith(address), `the link to ${address} reads ${link.text}`).toBe(true);
    }
  }
  return { named, plain };
}

// ---- Names the test makes up --------------------------------------------------------------------------------------------------------------------

/**
 * The entry a test gives `address` when it does not rely on what the fixtures name: a name made of the address's last four characters, so that every account of a page has one
 * and the page's links can be checked for it (`expectLinkedAccountsNamed`).
 */
export const nameAfterItsEnd = (address: string): AccountNameEntry => ({
  address,
  display_name: { text: `Fixture ${address.slice(-4)}`, kind: "account" },
  account_name: `Fixture ${address.slice(-4)}`,
});

/** An override for `GET /v2/account_names` that answers every address asked with `nameAfterItsEnd`. */
export function answerNamesAfterTheirEnd(): (request: Request) => Response {
  return (request) => {
    const asked = (new URL(request.url).searchParams.get("addresses") ?? "").split(",");
    return new Response(JSON.stringify({ result: "success", count: asked.length, account_names: asked.map(nameAfterItsEnd) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/**
 * Says that the page in `html` asked the names of every account it links to (there is at least one) and draws each by the name `nameAfterItsEnd` gave it, with the title
 * `nameTitleOf` gives, in every link to it. For a page whose names call was answered by `answerNamesAfterTheirEnd`.
 */
export function expectLinkedAccountsNamed(mock: { requests: readonly SeenRequest[] }, html: string, net: NetworkName): void {
  const asked = namesCalls(mock).flat();
  const linked = linkedAccounts(html, net);
  expect(linked.length).toBeGreaterThan(0);
  for (const address of linked) {
    expect(asked, `${address} is asked for`).toContain(address);
    const view = nameViewOf(nameAfterItsEnd(address))!;
    for (const link of linksTo(html, net, address)) {
      expect(link.text).toContain(linkTextOf(view));
      expect(link.attrs).toContain(`title="${nameTitleOf(view, address)}"`);
    }
  }
}

// ---- Text with accounts in it -----------------------------------------------------------------------------------------------------------------

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Says that `text` is made of `parts`: a string is written literally, `{ account }` is a link to that account as the fixtures have it drawn. An account the fixtures give nothing to
 * show is exactly its short address (its whole address with `full`), so what follows it in `text` is pinned; one they name is its name `linkTextOf` gives, then the words of its
 * marks (and, with `full`, its whole address). The text is matched whole.
 */
export async function expectTextWithAccounts(
  text: string,
  net: NetworkName,
  parts: ReadonlyArray<string | { account: string; full?: boolean }>,
): Promise<void> {
  let pattern = "^";
  for (const part of parts) {
    if (typeof part === "string") {
      pattern += escaped(part);
      continue;
    }
    const view = await viewOf(net, part.account);
    const whole = escaped(part.account);
    if (view?.name) pattern += `${escaped(linkTextOf(view))}(?: .*?)?${part.full ? ` ${whole}` : ""}`;
    else pattern += part.full ? whole : escaped(shortAddress(part.account));
  }
  expect(text).toMatch(new RegExp(`${pattern}$`));
}
