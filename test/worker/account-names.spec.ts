import { describe, expect, it, vi } from "vitest";

import type { AccountHeader, AccountListPageData, HistoryHeader, TabList } from "../../app/server/account-view";
import { loadAccountPage } from "../support/account-loader";
import { hexOfText } from "../support/hex";
import {
  answerNamesAfterTheirEnd,
  askedIn,
  failingNames,
  isNamesRequest,
  isTomlRequest,
  namesCalls,
  namesSpec,
  sorted,
  tomlCalls,
  viewedAmong,
  viewOf,
  watchNamesLog,
} from "../support/names";
import { expectDegraded, forgetStored, isStored, unavailable } from "../support/nft-pages";
import { pageClient, tableRows, textOf } from "../support/pages";
import { dataApiError } from "../support/upstream";
import type { SeenRequest } from "../support/upstream-core";

// The names and toml calls of the account page, `/{net}/account/{address}` (display names spec 5, 6.5 and 6.6), on the real Worker: the first page makes two names
// calls, the header's after the header's calls (the address, its parent, its tokens' issuers; on the Objects tab its rows' accounts too) and the list's after its rows,
// so that the header never waits for the list; one toml call, of the domain the node gives, as soon as it gives it, or of the names entry's domain after the header's
// call when the node gives none; a page behind a marker makes one names call and no toml call; and a call that fails never fails the page. What the page hands the
// browser is read from the route's loader (`loadAccountPage`): the header's name, the page's names and the list's are what Task 11 draws.
//
// A file of its own, as the names of the other pages are: the Worker keeps a names or a toml answer a minute and a page five seconds, so a test that says what a render
// asks takes every lookup of a subrequest entry as a miss (`namesSpec`'s `cold`), and a test that says a page is or is not stored has a URL of its own (`case`) and starts
// from a cache that holds none of it (`forgetStored`): none needs another to have run, or not.

const { get, storedAs } = pageClient("198.51.126");
const { upstream } = namesSpec({ advance: 3_700_000 });

// The accounts of the fixtures (test/fixtures/http, README "Upstream fixtures"; display names spec 10).
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
/** The account that activated ACTIVE (labelled spam, no name). */
const PARENT = "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ";
/** The issuer of ACTIVE's one token, LIONS. */
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const XAHAU_DELETED = "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD";
/** An active Xahau account whose names entry has the domain saltmarsh.example, whose toml failed (http_status 404); the fixtures have no account_info of it. */
const SALTMARSH = "rJ5mvuNKjbjdghjCn5AGXXJFhJGgqdg9Q5";
const MARKER = "WzEwNzYxMjU3MywyNV0";
const LIVE = { cls: "live", ttl: 5 };

/** The recorded account_info of ACTIVE (the node's `result`), whose Domain is northpeak.example. */
const recordedInfo = import.meta.glob("../fixtures/http/xrpl/node/account_info/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh.json", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;
async function activeInfoWithDomain(domain: string): Promise<Record<string, unknown>> {
  const load = Object.values(recordedInfo)[0]!;
  const { result } = JSON.parse(await load()) as { result: { account_data: Record<string, unknown> } };
  return { ...result, account_data: { ...result.account_data, Domain: hexOfText(domain) } };
}

/** Where in a mock's requests the first one `test` holds for is: what came before what. */
const indexOf = (requests: readonly SeenRequest[], test: (request: SeenRequest) => boolean): number => {
  const at = requests.findIndex(test);
  expect(at, "the request was made").toBeGreaterThanOrEqual(0);
  return at;
};

/** The accounts a transactions list's rows draw: the account segments of their sentences, each once. */
const rowAccounts = (list: TabList): string[] =>
  list.state === "ok" && list.tab === "transactions" ? [...new Set(list.rows.flatMap((row) => row.what.flatMap((segment) => (segment.t === "account" ? [segment.v] : []))))] : [];

/** The name of the active page's header (a live page's header is an `AccountHeader`). */
const nameOf = (data: AccountListPageData) => (data.header as AccountHeader).name;

describe("the first page", () => {
  it("asks the header's names after the header's calls (the address, its parent, its token's issuer), the node domain's toml beside them, and the list's names after its rows", async () => {
    const mock = upstream("xrpl");
    const { data, marks } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${ACTIVE}`);
    const list = await data.list;

    const headerAsked = sorted([ACTIVE, PARENT, LIONS_ISSUER]);
    const listAsked = sorted(rowAccounts(list));
    expect(listAsked.length).toBeGreaterThan(0);
    expect(namesCalls(mock).sort()).toEqual([headerAsked, listAsked].sort());
    expect(tomlCalls(mock)).toEqual(["northpeak.example"]);

    // The toml once account_info has answered (it runs beside the header's names call: account-names-load.test.ts says when the header settles); the header's names
    // call after every call of the header; the list's after its rows.
    const { requests } = mock;
    // The header's call is the one with the parent: the list's has the account too, where a row's sentence names it.
    const headerCall = indexOf(requests, (r) => isNamesRequest(r) && askedIn(r).includes(PARENT));
    expect(indexOf(requests, (r) => r.key.startsWith("node account_info"))).toBeLessThan(indexOf(requests, isTomlRequest));
    const listRows = indexOf(requests, (r) => r.key.includes("/transactions?"));
    for (const [at, request] of requests.entries()) {
      if (!isNamesRequest(request) && !isTomlRequest(request) && at !== listRows) expect(at, request.key).toBeLessThan(headerCall);
    }
    expect(indexOf(requests, (r) => isNamesRequest(r) && !askedIn(r).includes(PARENT))).toBeGreaterThan(listRows);

    // The page's names are the header call's, the list's its own; the header is named as the fixtures name the account, with what the toml says.
    expect(data.names.state).toBe("ok");
    expect(Object.keys(data.names.map).sort()).toEqual(await viewedAmong("xrpl", headerAsked));
    expect(list).toMatchObject({ state: "ok", tab: "transactions", names: { state: "ok" } });
    expect(list.state === "ok" && Object.keys(list.names.map).sort()).toEqual(await viewedAmong("xrpl", listAsked));
    const view = (await viewOf("xrpl", ACTIVE))!;
    const name = nameOf(data)!;
    expect(name.title).toEqual({ text: view.name!.text, kind: "verified" });
    expect(name.domainLine).toEqual({ text: "northpeak.example", state: "verified", href: "https://northpeak.example" });
    expect(name.howWeKnow?.checked).toBeDefined();
    expect(name.facts).not.toBeNull();
    expect(marks).toEqual([]);
  });

  it("asks the toml of the node's Domain lower-cased, as the data API checks it, and the domain is verified whatever its case on the node", async () => {
    const mock = upstream("xrpl", { [`node account_info ${ACTIVE}`]: await activeInfoWithDomain("NorthPeak.Example") });
    const { data } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${ACTIVE}`);
    await data.list;

    expect(tomlCalls(mock)).toEqual(["northpeak.example"]);
    expect(nameOf(data)?.domainLine).toEqual({ text: "northpeak.example", state: "verified", href: "https://northpeak.example" });
    expect(nameOf(data)?.howWeKnow?.checked).toBeDefined();
  });

  it("names an Objects tab's rows in the header's call (they come with the header): one names call, whose names the list carries, and no account of an amount's issuer", async () => {
    const [escrowTo, authorized, amountIssuer] = ["rq5QXrArpavMCfE5dRuR3uG55iV1rG8mj", "rEhcqzSi5e1E1GJJ1xfY1cmrRaoePZWkzt", "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"];
    const mock = upstream("xrpl", {
      [`node account_objects ${ACTIVE}`]: {
        account: ACTIVE,
        ledger_index: 107721455,
        validated: true,
        account_objects: [
          { LedgerEntryType: "Escrow", index: "E1", Amount: "1000000", Destination: escrowTo },
          { LedgerEntryType: "Check", index: "C1", SendMax: { currency: "USD", issuer: amountIssuer, value: "5" }, Destination: escrowTo },
          { LedgerEntryType: "DepositPreauth", index: "D1", Authorize: authorized },
        ],
      },
    });
    const { data } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${ACTIVE}?tab=objects`);

    expect(namesCalls(mock)).toEqual([sorted([ACTIVE, PARENT, LIONS_ISSUER, escrowTo, authorized])]);
    expect(data.list).not.toBeInstanceOf(Promise);
    expect((data.list as TabList & { state: "ok" }).names).toEqual(data.names);
    expect(tomlCalls(mock)).toEqual(["northpeak.example"]);
  });

  it("asks a deleted XRPL account's names and no toml: the data API gives a deleted account no domain", async () => {
    const mock = upstream("xrpl");
    const { data } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${DELETED}`);
    await data.list;

    // The address and the account that activated it (the deleted account has no tokens), then the list's own.
    expect(namesCalls(mock)).toContainEqual(sorted([DELETED, "rURtT5MMFzSUR54MAq9MKfzBoezTBZbKns"]));
    expect(tomlCalls(mock)).toEqual([]);
    const view = (await viewOf("xrpl", DELETED))!;
    const name = nameOf(data)!;
    expect(name.title?.text).toBe(view.name!.text);
    expect(name.domainLine).toBeNull();
    expect(name.labelMarks).toEqual(view.labels);
  });

  it("asks a deleted Xahau account's names and no toml, and keeps its label", async () => {
    const mock = upstream("xahau");
    const { data } = await loadAccountPage<AccountListPageData>(`/xahau/account/${XAHAU_DELETED}`);
    await data.list;

    expect(namesCalls(mock)).toContainEqual(sorted([XAHAU_DELETED, "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8"]));
    expect(tomlCalls(mock)).toEqual([]);
    expect(nameOf(data)).toMatchObject({ title: null, labelMarks: ["scam"], domainLine: null });
  });

  it("asks, when the node does not answer, the toml of the names entry's domain after the header's names call, and says the domain is not verified", async () => {
    const mock = upstream("xahau", {
      [`GET /v2/accounts/${SALTMARSH}`]: {
        result: "success",
        account_data: { account: SALTMARSH, parent: XAHAU_ACTIVE, initial_balance: "15", inception: "2026-07-02T17:43:31Z", ledger_index: 24000000, tx_hash: "8C".repeat(32) },
      },
      [`node account_info ${SALTMARSH}`]: unavailable(),
      [`GET /v2/accounts/${SALTMARSH}/transactions?descending=true&limit=20`]: { result: "success", count: 0, transactions: [] },
    });
    const { data, marks } = await loadAccountPage<AccountListPageData>(`/xahau/account/${SALTMARSH}`);
    await data.list;

    expect(namesCalls(mock)).toEqual([sorted([SALTMARSH, XAHAU_ACTIVE])]);
    expect(tomlCalls(mock)).toEqual(["saltmarsh.example"]);
    expect(indexOf(mock.requests, isTomlRequest)).toBeGreaterThan(indexOf(mock.requests, isNamesRequest));
    const name = nameOf(data)!;
    expect(name.title).toEqual({ text: "saltmarsh.example", kind: "domain" });
    expect(name.domainLine).toMatchObject({ text: "saltmarsh.example", state: "not-verified" });
    expect(name.domainLine?.note).toContain("could not be read");
    // The node's failure is the page's only one: a toml that says its read failed is an answer.
    expect(marks).toEqual(["node account_info failed"]);
  });

  it("makes no names or toml call with NAMES off: the header has no name, and the names are the switch's", async () => {
    const mock = upstream("xrpl");
    const { data } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${ACTIVE}`, { NAMES: "off" });
    const list = await data.list;

    expect(mock.requests.filter((request) => isNamesRequest(request) || isTomlRequest(request))).toEqual([]);
    expect(nameOf(data)).toBeNull();
    expect(data.names).toEqual({ state: "off", map: {} });
    expect(list).toMatchObject({ state: "ok", names: { state: "off", map: {} } });
  });
});

describe("a page behind a marker", () => {
  it("makes one names call, of the address and the rows' accounts, and no toml call; its header is the name and the labels alone", async () => {
    const mock = upstream("xrpl");
    const { data } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${ACTIVE}?marker=${MARKER}`);
    const list = data.list as TabList;

    expect(data.mode).toBe("history");
    expect(namesCalls(mock)).toEqual([sorted([ACTIVE, ...rowAccounts(list)])]);
    expect(tomlCalls(mock)).toEqual([]);
    const view = (await viewOf("xrpl", ACTIVE))!;
    expect(data.header as HistoryHeader).toEqual({
      status: "history",
      name: { title: { text: view.name!.text, kind: "verified" }, labels: [], labelMarks: [], domainLine: null, howWeKnow: null, facts: null, help: null },
    });
    expect(list.state === "ok" && list.names).toEqual(data.names);
    expect(data.names.state).toBe("ok");
  });
});

describe("when a call fails", () => {
  it("serves a page behind a marker whose names call failed with addresses, and does not store it, although its class keeps one an hour", async () => {
    const logged = watchNamesLog();
    upstream("xrpl", failingNames());
    const path = `/xrpl/account/${ACTIVE}?marker=${MARKER}&case=names-failed`;
    await forgetStored(path);
    const response = await get(path);
    await response.text();

    await expectDegraded(path, response);
    expect(logged()).toBe(1);
    const { data } = await loadAccountPage<AccountListPageData>(path);
    expect(data.header).toEqual({ status: "history", name: null });
    expect(data.names).toEqual({ state: "failed", map: {} });
  });

  it("is today's page when the header's names call fails: no name, served and not stored, one log line; the list keeps its own names", async () => {
    const logged = watchNamesLog();
    const named = answerNamesAfterTheirEnd();
    // The header's call is the one with the parent (the list's has the account too, where a row's sentence names it).
    upstream("xrpl", { "GET /v2/account_names": (request: Request) => (askedIn(request).includes(PARENT) ? unavailable() : named(request)) });
    const path = `/xrpl/account/${ACTIVE}?case=header-names-failed`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${ACTIVE}</h1>`));
    expect(logged()).toBe(1);

    const { data, marks } = await loadAccountPage<AccountListPageData>(path);
    const list = await data.list;
    expect(nameOf(data)).toBeNull();
    expect(data.names).toEqual({ state: "failed", map: {} });
    expect(list).toMatchObject({ state: "ok", names: { state: "ok" } });
    expect(list.state === "ok" && Object.keys(list.names.map).sort()).toEqual(sorted(rowAccounts(list)));
    expect(marks).toEqual(["names could not be loaded"]);
  });

  it("keeps the verified name when the toml call fails, without the time it was checked or its facts, and the page is served and not stored", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { "GET /v2/toml/northpeak.example": unavailable() });
    const path = `/xrpl/account/${ACTIVE}?case=toml-failed`;
    await forgetStored(path);
    const response = await get(path);
    await response.text();

    await expectDegraded(path, response);
    expect(errors.mock.calls.filter(([line]) => String(line).includes("the toml of an account's domain could not be loaded"))).toHaveLength(1);

    const { data, marks } = await loadAccountPage<AccountListPageData>(path);
    const name = nameOf(data)!;
    expect(name.title?.kind).toBe("verified");
    expect(name.domainLine).toMatchObject({ text: "northpeak.example", state: "verified" });
    expect(name.howWeKnow).not.toBeNull();
    expect(name.howWeKnow?.checked).toBeUndefined();
    expect(name.facts).toBeNull();
    expect(marks).toEqual(["toml could not be loaded"]);
  });

  it("is no failure when the data API never checked the domain (`toml not found`): the page is stored", async () => {
    upstream("xrpl", { "GET /v2/toml/northpeak.example": dataApiError(404, "toml not found") });
    const path = `/xrpl/account/${ACTIVE}?case=toml-not-found`;
    await forgetStored(path);
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual(LIVE);

    const { data, marks } = await loadAccountPage<AccountListPageData>(path);
    await data.list;
    expect(nameOf(data)?.domainLine).toMatchObject({ state: "verified" });
    expect(nameOf(data)?.howWeKnow?.checked).toBeUndefined();
    expect(marks).toEqual([]);
  });

  // The wiring alone: when the names call is given what is left of the list's deadline is account-names-load.test.ts's (`nameList`, on a fake clock).
  it("draws the list with addresses when its names call is late: only the names fail, the page is not stored, and it is logged once", async () => {
    const logged = watchNamesLog();
    const named = answerNamesAfterTheirEnd();
    upstream("xrpl", { "GET /v2/account_names": (request: Request) => (askedIn(request).includes(PARENT) ? named(request) : new Promise<Response>(() => {})) });
    const path = `/xrpl/account/${ACTIVE}?case=list-names-late`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    expect(textOf(html)).not.toContain("Couldn’t load transactions");
    expect(tableRows(html, "Transactions")).toHaveLength(5);
    expect(logged()).toBe(1);
    expect(await isStored(path)).toBe(false);
  });
});
