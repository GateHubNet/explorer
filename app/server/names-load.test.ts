import { encodeAccountID } from "ripple-address-codec";
import { afterEach, describe, expect, it, vi } from "vitest";

import { recordingMark } from "../../test/support/degraded-mark";
import { allSwitches } from "../../test/support/switches";
import { NAMES_OFF, NO_NAMES } from "../domain/names";
import type { AccountNameEntry, AccountNamesResponse } from "./api-types";
import type { FreshOptions } from "./data-api";
import { createLoadContext, type Env } from "./env";
import { collectAddresses } from "./names-collect";
import * as namesLoad from "./names-load";
import { loadNames, NAMES_BATCH_LIMIT, NAMES_DEADLINE_MS, NAMES_MAX_ADDRESSES, type NamesContext } from "./names-load";
import { UpstreamError } from "./upstream";

// loadNames over a fake data API and a load context whose degraded mark and `console.error` (where `logProblem` writes) record what they are given. Names are fictional
// and domains `*.example`. The Worker's own runs of it come with the pages that call it.

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

const A = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const B = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const C = "rrrrrrrrrrrrrrrrrrrrBZbvji";
const D = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";
const E = "rBg5JN5ShW8ZRV1TJhxVJRYcXVbPGC3ARi";

const verified: AccountNameEntry = { address: A, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" };
const named: AccountNameEntry = {
  address: B,
  display_name: { text: "Harborline Exchange", kind: "account" },
  account_network_name: "hot wallet",
  labels: { advisory: { description: "Withdrawals paused" } },
};
/** A kind of name that a newer API may add and this build reads as no name. */
const curated: AccountNameEntry = { address: D, display_name: { text: "Tidewater", kind: "curated" } };
const nothing: AccountNameEntry = { address: E };

/** `entry` as the entry of `address`. */
const at = (address: string, entry: AccountNameEntry): AccountNameEntry => ({ ...entry, address });

/** `n` valid addresses, each once, in no order that sorts them. */
function addressesOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(20);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, Math.imul(i + 1, 2654435761) >>> 0);
    view.setUint32(16, i + 1);
    return encodeAccountID(bytes);
  });
}

/** What D4 answers for `addresses`: one entry each, in the order asked; an address it knows nothing of is bare. */
function respond(addresses: readonly string[], known: Readonly<Record<string, AccountNameEntry>> = {}): AccountNamesResponse {
  return { result: "success", count: addresses.length, account_names: addresses.map((address) => known[address] ?? { address }) };
}

/** `value` after `ms` of the fake clock. */
const after = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const serverError = () => new UpstreamError("server", "data API GET /v2/account_names answered 500", { status: 500 });

interface WorldOptions {
  /** The entries D4 knows; the others are bare. */
  known?: Readonly<Record<string, AccountNameEntry>>;
  /** What each call comes to; an answer at once when left out. */
  call?: (addresses: readonly string[], opts?: FreshOptions) => Promise<AccountNamesResponse>;
}

function world(options: WorldOptions = {}) {
  const { mark, marks } = recordingMark();
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  const accountNames = vi.fn(options.call ?? ((addresses: readonly string[]) => Promise.resolve(respond(addresses, options.known))));
  const request = new Request("https://explorer.test/xrpl/tx/ABC");
  const names = (addresses: readonly string[], over: Partial<NamesContext> = {}) =>
    loadNames({ accountNames }, addresses, { context: createLoadContext(env, ctx, mark), request, features: { names: true }, ...over });
  /** The addresses of each call, in the order the calls were made. */
  const asked = () => accountNames.mock.calls.map(([addresses]) => [...addresses]);
  /** The line each `logProblem` wrote. */
  const logged = () => logs.mock.calls.map(([line]) => JSON.parse(String(line)) as { level: string; what: string; path?: string; error: string });
  return { names, accountNames, asked, logged, marks, mark };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the limits", () => {
  it("are 1,500 ms, 400 addresses and 100 to a call", () => {
    expect(NAMES_DEADLINE_MS).toBe(1_500);
    expect(NAMES_MAX_ADDRESSES).toBe(400);
    expect(NAMES_BATCH_LIMIT).toBe(100);
  });
});

describe("names-load.ts", () => {
  it("has collectAddresses of names-collect.ts, for the loaders that import it from here", () => {
    expect(namesLoad.collectAddresses).toBe(collectAddresses);
  });
});

describe("loadNames: what it asks", () => {
  it("makes no call and answers NAMES_OFF while the switch is off", async () => {
    const { names, accountNames, marks } = world();
    const result = await names([A, B], { features: { names: false } });
    expect(result.part).toBe(NAMES_OFF);
    expect(result.entries.size).toBe(0);
    expect(accountNames).not.toHaveBeenCalled();
    expect(marks).toEqual([]);
  });

  it("makes no call, and never asks for no address, when the page shows none: NO_NAMES", async () => {
    const { names, accountNames, logged } = world();
    const result = await names([]);
    expect(result.part).toBe(NO_NAMES);
    expect(result.entries.size).toBe(0);
    expect(accountNames).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });

  it("names a few addresses in one call, sorted", async () => {
    const { names, asked } = world();
    await names([C, A, E, B]);
    expect(asked()).toEqual([[A, B, C, E].sort()]);
  });

  it("names the first 400 collected, in four sorted calls", async () => {
    const collected = collectAddresses(addressesOf(450));
    expect(collected).toHaveLength(450);
    const first = collected.slice(0, NAMES_MAX_ADDRESSES);
    // The order of the collection is not the sorted one, so that the sorting shows.
    expect(first).not.toEqual([...first].sort());

    const { names, asked } = world();
    await names(collected);
    const calls = asked();
    expect(calls.map((call) => call.length)).toEqual([100, 100, 100, 100]);
    for (const call of calls) expect(call).toEqual([...call].sort());
    // Together the 400 first, sorted and cut into calls of 100: none of the last 50 is asked.
    expect(calls.flat()).toEqual([...first].sort());
  });

  it("names 250 addresses in three calls of 100, 100 and 50, and the edges of a call as they are", async () => {
    const many = addressesOf(250);
    const first = world();
    await first.names(many);
    expect(first.asked().map((call) => call.length)).toEqual([100, 100, 50]);

    const exact = world();
    await exact.names(many.slice(0, 100));
    expect(exact.asked().map((call) => call.length)).toEqual([100]);

    const over = world();
    await over.names(many.slice(0, 101));
    expect(over.asked().map((call) => call.length)).toEqual([100, 1]);
  });

  it("makes its calls side by side, before any has answered", async () => {
    const answers: Array<() => void> = [];
    const { names, accountNames } = world({ call: (addresses) => new Promise((resolve) => answers.push(() => resolve(respond(addresses)))) });
    const loading = names(addressesOf(250));
    expect(accountNames).toHaveBeenCalledTimes(3);
    for (const answer of answers) answer();
    expect((await loading).part.state).toBe("ok");
  });

  it("passes holdFailure on to every call", async () => {
    const polled = world();
    await polled.names(addressesOf(150), { holdFailure: true });
    expect(polled.accountNames.mock.calls.map(([, opts]) => opts?.holdFailure)).toEqual([true, true]);

    const plain = world();
    await plain.names(addressesOf(150));
    expect(plain.accountNames.mock.calls.map(([, opts]) => opts?.holdFailure)).toEqual([undefined, undefined]);
  });
});

describe("loadNames: what it answers", () => {
  it("is the view of each name that arrived, and every entry that arrived by address", async () => {
    const { names, marks, logged } = world({ known: { [A]: verified, [B]: named, [D]: curated, [E]: nothing } });
    const { part, entries } = await names([A, B, C, D, E]);
    expect(part.state).toBe("ok");
    expect(part.map).toEqual({
      [A]: { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] },
      [B]: { name: { text: "Harborline Exchange", kind: "account" }, network: "hot wallet", labels: ["advisory"] },
    });
    expect([...entries.keys()].sort()).toEqual([A, B, C, D, E].sort());
    expect(entries.get(A)).toBe(verified);
    expect(entries.get(B)).toBe(named);
    // An entry of an unknown kind, and one with nothing to show, are entries and not in the map.
    expect(entries.get(D)).toBe(curated);
    expect(entries.get(E)).toBe(nothing);
    expect(entries.get(C)).toEqual({ address: C });
    expect(D in part.map || E in part.map || C in part.map).toBe(false);
    expect(marks).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("joins the answers of the calls", async () => {
    const many = addressesOf(250);
    const sorted = [...many].sort();
    const known = { [sorted[0]!]: at(sorted[0]!, verified), [sorted[150]!]: at(sorted[150]!, named), [sorted[249]!]: at(sorted[249]!, curated) };
    const { names } = world({ known });
    const { part, entries } = await names(many);
    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).sort()).toEqual([sorted[0], sorted[150]].sort());
    expect(entries.size).toBe(250);
  });
});

describe("loadNames: a call that fails or is late never fails the page", () => {
  it("is a failure when a call answers late: no names, degraded, logged once", async () => {
    const { names, marks, mark, logged } = world({ call: () => new Promise(() => {}) });
    const result = await names([A, B], { deadlineMs: 10 });
    expect(result.part).toEqual({ state: "failed", map: {} });
    expect(result.entries.size).toBe(0);
    expect(mark.degraded).toBe(true);
    expect(marks).toEqual(["names could not be loaded"]);
    expect(logged()).toEqual([{ level: "error", what: "names could not be loaded", path: "/xrpl/tx/ABC", error: "took too long" }]);
  });

  it("is a failure when the call rejects, and the log says why", async () => {
    const { names, marks, logged } = world({ call: () => Promise.reject(serverError()) });
    const result = await names([A]);
    expect(result.part).toEqual({ state: "failed", map: {} });
    expect(marks).toEqual(["names could not be loaded"]);
    expect(logged()).toEqual([{ level: "error", what: "names could not be loaded", path: "/xrpl/tx/ABC", error: "data API GET /v2/account_names answered 500" }]);
  });

  it("is a failure, and not a rejection, when the call throws at once", async () => {
    const { names, marks, logged } = world({
      call: () => {
        throw new Error("boom");
      },
    });
    const result = await names([A]);
    expect(result.part.state).toBe("failed");
    expect(marks).toEqual(["names could not be loaded"]);
    expect(logged().map((line) => line.error)).toEqual(["boom"]);
  });

  it("uses the answers that did arrive when one of three calls fails, with one mark and one line", async () => {
    const many = addressesOf(250);
    const sorted = [...many].sort();
    const known = { [sorted[5]!]: at(sorted[5]!, verified), [sorted[120]!]: at(sorted[120]!, named), [sorted[205]!]: at(sorted[205]!, verified) };
    const { names, marks, logged, asked } = world({
      known,
      call: (addresses) => (addresses[0] === sorted[100] ? Promise.reject(serverError()) : Promise.resolve(respond(addresses, known))),
    });
    const { part, entries } = await names(many);
    expect(asked().map((call) => call.length)).toEqual([100, 100, 50]);
    expect(part.state).toBe("failed");
    // The second call (sorted[100..199]) failed, so the name in it is missing, and the other two calls' are there.
    expect(Object.keys(part.map).sort()).toEqual([sorted[5], sorted[205]].sort());
    expect(entries.size).toBe(150);
    expect(entries.has(sorted[120]!)).toBe(false);
    expect(marks).toEqual(["names could not be loaded"]);
    expect(logged()).toHaveLength(1);
  });

  it("marks and logs once for a call of loadNames, whatever the number of calls that failed", async () => {
    const { names, marks, logged } = world({ call: () => Promise.reject(serverError()) });
    const result = await names(addressesOf(250));
    expect(result.part).toEqual({ state: "failed", map: {} });
    expect(marks).toEqual(["names could not be loaded"]);
    expect(logged()).toHaveLength(1);
  });

  it("gives a call NAMES_DEADLINE_MS from the start by default", async () => {
    vi.useFakeTimers();
    const many = addressesOf(150);
    const sorted = [...many].sort();
    const known = { [sorted[1]!]: at(sorted[1]!, verified), [sorted[120]!]: at(sorted[120]!, named) };
    let calls = 0;
    const { names, marks } = world({
      known,
      // The first call answers 100 ms inside the deadline, the second 100 ms after it.
      call: (addresses) => after(calls++ === 0 ? NAMES_DEADLINE_MS - 100 : NAMES_DEADLINE_MS + 100, respond(addresses, known)),
    });
    const loading = names(many);
    await vi.advanceTimersByTimeAsync(NAMES_DEADLINE_MS + 200);
    const { part } = await loading;
    expect(part.state).toBe("failed");
    expect(Object.keys(part.map)).toEqual([sorted[1]]);
    expect(marks).toEqual(["names could not be loaded"]);
  });

  it("gives a call the deadline it is passed, from the start of loadNames", async () => {
    vi.useFakeTimers();
    const { names, marks } = world({ call: (addresses) => after(300, respond(addresses)) });
    const inTime = names([A], { deadlineMs: 400 });
    await vi.advanceTimersByTimeAsync(400);
    expect((await inTime).part.state).toBe("ok");
    expect(marks).toEqual([]);

    const tooLate = names([A], { deadlineMs: 200 });
    await vi.advanceTimersByTimeAsync(300);
    expect((await tooLate).part.state).toBe("failed");
    expect(marks).toEqual(["names could not be loaded"]);
  });
});
