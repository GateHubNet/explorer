import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordingMark } from "../../test/support/degraded-mark";
import { hexOfText } from "../../test/support/hex";
import { allSwitches } from "../../test/support/switches";
import { NO_NAMES } from "../domain/names";
import { LAST_LEDGER_DEADLINE_MS, LIST_DEADLINE_MS, namedHeader, nameList, nodeTomlOf, readToml, type NamingContext } from "./account-names-load";
import type { TabList, TxRow, UnnamedHeader } from "./account-view";
import type { AccountNamesResponse, TomlAnswer } from "./api-types";
import { createLoadContext, type Env } from "./env";
import { networkOf } from "./networks";
import type { AccountInfo } from "./node-rpc";
import { UpstreamError } from "./upstream";

// The account page's names and toml calls over a fake data API and a fake clock (every timer and `Date`): what each waits for, and when it settles. The Worker's own runs
// of them are test/worker/account-names.spec.ts and account-analytics-names.spec.ts.

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  NAMES: "on",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

const ADDRESS = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const SENDER = "rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48";
const DOMAIN = "northpeak.example";

/** `value` after `ms` of the fake clock. */
const after = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** The names batch's answer: ADDRESS verified by northpeak.example, any other address with nothing to show. */
const namesOf = (addresses: readonly string[]): AccountNamesResponse => ({
  result: "success",
  count: addresses.length,
  account_names: addresses.map((address) =>
    address === ADDRESS ? { address, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: DOMAIN } : { address, display_name: { text: "Sender", kind: "account" } },
  ),
});
const TOML: TomlAnswer = {
  result: "success",
  toml: { domain: DOMAIN, toml_url: `https://${DOMAIN}/.well-known/xrp-ledger.toml`, status: "ok", checked: "2026-10-17T06:00:00.000Z", fetched: "2026-10-17T06:00:00.000Z" },
};

/** A request's context over a fake data API, with the degraded mark recording each reason and `console.error` (where `logProblem` writes) silenced and recorded. */
function world(api: { accountNames?: (addresses: readonly string[]) => Promise<AccountNamesResponse>; toml?: (domain: string) => Promise<TomlAnswer> }) {
  const { mark, marks } = recordingMark();
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  const fake = {
    accountNames: vi.fn(api.accountNames ?? ((addresses: readonly string[]) => Promise.resolve(namesOf(addresses)))),
    toml: vi.fn(api.toml ?? (() => Promise.resolve(TOML))),
  };
  const network = networkOf("xrpl", env);
  const naming: NamingContext = { context: createLoadContext(env, ctx, mark), request: new Request(`https://explorer.test/xrpl/account/${ADDRESS}`), api: fake, network };
  /** The `what` of each line `logProblem` wrote. */
  const logged = () => logs.mock.calls.map(([line]) => (JSON.parse(String(line)) as { what: string }).what);
  return { api: fake, naming, network, marks, logged };
}

/** What a promise has come to once the fake clock has moved `ms` on: its value, or `"pending"`. */
async function settledAfter(promise: Promise<unknown>, ms: number): Promise<unknown> {
  let settled: { value: unknown } | undefined;
  void promise.then((value) => (settled = { value }));
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  return settled === undefined ? "pending" : settled.value;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- The list's names --------------------------------------------------------------------------------------------------------------------------------------------

describe("nameList", () => {
  const row: TxRow = {
    hash: "AB".repeat(32),
    ledgerIndex: 1,
    time: 0,
    type: "Payment",
    what: [{ t: "account", v: SENDER }, { t: "text", v: " sent 1 XRP to " }, { t: "account", v: ADDRESS }],
    change: null,
    ok: true,
    code: "tesSUCCESS",
  };
  const list: TabList = { state: "ok", tab: "transactions", rows: [row], paging: { newerHref: null, olderHref: null }, names: NO_NAMES };
  const ctxOf = (w: ReturnType<typeof world>) => ({ context: w.naming.context, request: w.naming.request, features: w.network.features });

  it("gives the names call what is left of the list's deadline: rows at 4 s and names that never answer settle at 4.5 s from the start, the list drawn, its names failed", async () => {
    const w = world({ accountNames: never });
    const startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(4_000);

    const named = nameList(w.api, list, startedAt, ctxOf(w));
    expect(await settledAfter(named, LIST_DEADLINE_MS - 4_000 - 1)).toBe("pending");
    expect(await settledAfter(named, 1)).toEqual({ ...list, names: { state: "failed", map: {} } });
    expect(Date.now() - startedAt).toBe(LIST_DEADLINE_MS);
    expect(w.api.accountNames).toHaveBeenCalledTimes(1);
    expect(w.marks).toEqual(["names could not be loaded"]);
    expect(w.logged()).toEqual(["names could not be loaded"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails the names at once for rows that came after the list's deadline (4.6 s): the list is drawn with addresses, and marked once", async () => {
    const w = world({ accountNames: never });
    const startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(4_600);

    const named = nameList(w.api, list, startedAt, ctxOf(w));
    expect(await settledAfter(named, 0)).toEqual({ ...list, names: { state: "failed", map: {} } });
    expect(w.marks).toEqual(["names could not be loaded"]);
  });

  it("gives fast rows the whole of what is left: rows at 100 ms, names that answer at 4,499 ms from the start are in time", async () => {
    const w = world({ accountNames: (addresses) => after(LIST_DEADLINE_MS - 100 - 1, namesOf(addresses)) });
    const startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(100);

    const named = (await settledAfter(nameList(w.api, list, startedAt, ctxOf(w)), LIST_DEADLINE_MS - 100 - 1)) as TabList;
    expect(named).toMatchObject({ state: "ok", names: { state: "ok" } });
    expect(named.state === "ok" && Object.keys(named.names.map).sort()).toEqual([ADDRESS, SENDER].sort());
    expect(w.api.accountNames.mock.calls).toEqual([[[ADDRESS, SENDER].sort(), { holdFailure: undefined }]]);
    expect(w.marks).toEqual([]);
  });

  it("makes no call for a list that failed", async () => {
    const w = world({});
    expect(await nameList(w.api, { state: "failed", what: "transactions" }, Date.now(), ctxOf(w))).toEqual({ state: "failed", what: "transactions" });
    expect(w.api.accountNames).not.toHaveBeenCalled();
  });
});

// ---- The header's names and toml ---------------------------------------------------------------------------------------------------------------------------------

describe("the header's names and toml", () => {
  /** The header as `accountHeader` makes it for an active account whose node gives `domain`. */
  const header = (domain: string | null): UnnamedHeader => ({
    status: "active",
    activation: null,
    live: { state: "ok", ledgerIndex: 5, sequence: 1, flags: [], regularKey: false, domain, lastActive: null },
    balance: null,
    tokens: { state: "none" },
    owned: null,
    nodeProblem: false,
  });
  /** account_info with a Domain of `text` (hex, as the node writes it). */
  const infoWith = (text: string): Promise<AccountInfo> =>
    Promise.resolve({
      account_data: { Account: ADDRESS, Balance: "1", Flags: 0, LedgerEntryType: "AccountRoot", OwnerCount: 0, Sequence: 1, Domain: hexOfText(text) },
      ledger_index: 5,
      validated: true,
    } as AccountInfo);

  it("asks the toml of the node's domain lower-cased, as soon as account_info answers", async () => {
    const w = world({});
    const read = await nodeTomlOf(w.api, infoWith("NorthPeak.Example"), w.network);
    expect(w.api.toml.mock.calls).toEqual([[DOMAIN]]);
    expect(read?.toml).toEqual({ state: "ok", value: TOML });
  });

  it.each([
    ["names at 1 s and the toml at 1.2 s", 1_000, 1_200],
    ["the toml at 1 s and names at 1.2 s", 1_200, 1_000],
  ])("makes the names call at once, beside the node's toml, and settles with the later of the two (%s: 1.2 s, not 2.2 s)", async (_what, namesAt, tomlAt) => {
    const w = world({ accountNames: (addresses) => after(namesAt, namesOf(addresses)), toml: () => after(tomlAt, TOML) });
    const nodeToml = nodeTomlOf(w.api, infoWith("NorthPeak.Example"), w.network);
    const named = namedHeader(w.naming, ADDRESS, header("NorthPeak.Example"), [ADDRESS], nodeToml);

    expect(await settledAfter(named, 0)).toBe("pending");
    expect(w.api.accountNames).toHaveBeenCalledTimes(1);
    expect(w.api.toml).toHaveBeenCalledTimes(1);
    expect(await settledAfter(named, 1_199)).toBe("pending");
    const { header: done } = (await settledAfter(named, 1)) as Awaited<typeof named>;
    expect(done.name?.title).toEqual({ text: "Northpeak Treasury", kind: "verified" });
    expect(done.name?.domainLine).toEqual({ text: DOMAIN, state: "verified", href: `https://${DOMAIN}` });
    expect(done.name?.howWeKnow?.checked).toBeDefined();
    expect(w.marks).toEqual([]);
  });

  it("does not wait for the node's toml when the names call fails: the header is today's", async () => {
    const w = world({ accountNames: () => Promise.reject(new UpstreamError("server", "names answered 503", { status: 503 })), toml: never });
    const named = namedHeader(w.naming, ADDRESS, header(DOMAIN), [ADDRESS], nodeTomlOf(w.api, infoWith(DOMAIN), w.network));
    const done = (await settledAfter(named, 0)) as Awaited<typeof named>;
    expect(done.header.name).toBeNull();
    expect(done.names.part.state).toBe("failed");
    expect(w.marks).toEqual(["names could not be loaded"]);
  });

  it("asks the names entry's domain after the names call when the node gives none, as the data API gave it", async () => {
    const w = world({ accountNames: (addresses) => after(300, namesOf(addresses)), toml: () => after(200, TOML) });
    const named = namedHeader(w.naming, ADDRESS, header(null), [ADDRESS], Promise.resolve(null));
    expect(await settledAfter(named, 299)).toBe("pending");
    expect(w.api.toml).not.toHaveBeenCalled();
    expect(await settledAfter(named, 1)).toBe("pending");
    expect(w.api.toml.mock.calls).toEqual([[DOMAIN]]);
    const done = (await settledAfter(named, 200)) as Awaited<typeof named>;
    expect(done.header.name?.domainLine?.state).toBe("verified");
  });

  it.each([
    ["fails", () => Promise.reject(new UpstreamError("server", "toml answered 503", { status: 503 })), 0],
    ["is late", () => never<TomlAnswer>(), LAST_LEDGER_DEADLINE_MS],
  ])("keeps the verified name when the toml call %s, marks the page and logs it once", async (_what, toml, wait) => {
    const w = world({ toml });
    const named = namedHeader(w.naming, ADDRESS, header(DOMAIN), [ADDRESS], nodeTomlOf(w.api, infoWith(DOMAIN), w.network));
    const done = (await settledAfter(named, wait)) as Awaited<typeof named>;
    expect(done.header.name?.domainLine?.state).toBe("verified");
    expect(done.header.name?.howWeKnow?.checked).toBeUndefined();
    expect(w.marks).toEqual(["toml could not be loaded"]);
    expect(w.logged()).toEqual(["the toml of an account's domain could not be loaded"]);
  });

  it("reads `toml not found` as no failure: nothing is marked", async () => {
    const w = world({ toml: () => Promise.reject(new UpstreamError("not_found", "toml not found", { status: 404 })) });
    expect(await readToml(w.api, DOMAIN)).toMatchObject({ toml: { state: "missing" } });
    const named = namedHeader(w.naming, ADDRESS, header(DOMAIN), [ADDRESS], nodeTomlOf(w.api, infoWith(DOMAIN), w.network));
    expect(((await settledAfter(named, 0)) as Awaited<typeof named>).header.name?.domainLine?.state).toBe("verified");
    expect(w.marks).toEqual([]);
  });
});
