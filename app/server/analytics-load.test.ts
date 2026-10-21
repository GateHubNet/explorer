import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allSwitches } from "../../test/support/switches";
import type { AnalyticsPeriod } from "../domain/analytics-params";
import { loadAnalytics, type AnalyticsInput } from "./analytics-load";
import type { AnalyticsData } from "./analytics-view";
import type {
  AccountData,
  AccountTxStatsRow,
  AccountValueRow,
  AnalyticsBalanceChanges,
  AnalyticsBalances,
  AnalyticsCounterparties,
  AnalyticsExchanges,
  LastValidated,
  Page,
  TxObject,
} from "./api-types";
import type { DataApi } from "./data-api";
import { CARD_DEADLINE_MS } from "./deadline";
import type { DegradedMark } from "./edge-cache";
import { createLoadContext, type Env } from "./env";
import { networkOf } from "./networks";
import { UpstreamError } from "./upstream";

// The analytics loader (spec 2.3, 2.5 to 2.8) over a fake data API and a fake clock: what each card comes to, what is logged, marked and handed to
// `waitUntil`, and which calls are made with what. The Worker's own runs of it are test/worker/account-analytics.spec.ts.

const env: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  AMM_DATA: "on",
  MARKETS: "on",
  ACCOUNT_ANALYTICS: "on",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

const ADDRESS = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
/** The recorded XRPL `last_validated`: T is 2026-10-17. */
const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
  parent_hash: "5FA71FCC25A865DA7569108807E031AFB3E1CD03A8CE078BC1AA534C8E546BE8",
  close_time: "2026-10-17T17:01:12Z",
};
const CREATED: AccountData = {
  account: ADDRESS,
  parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ",
  initial_balance: "25",
  inception: "2025-07-15T18:30:43Z",
  ledger_index: 97500000,
  tx_hash: "9B".repeat(32),
};

const CARDS = ["value", "sent", "changes", "counterparties", "balances", "pairs"] as const;
type Card = (typeof CARDS)[number];

// ---- Answers that every builder takes: a window with nothing in it ---------------------------------------------------------------

const span = { start: "2026-09-18T00:00:00Z", end: "2026-10-18T00:00:00Z" };
const answers = {
  value: { result: "success", count: 0, rows: [] } as Page<"rows", AccountValueRow>,
  sent: { result: "success", count: 0, rows: [] } as Page<"rows", AccountTxStatsRow>,
  changes: { result: "success", ...span, interval: "day", totals: [], count: 0, rows: [] } satisfies AnalyticsBalanceChanges,
  counterparties: { result: "success", ...span, sort: "value", total: 0, count: 0, counterparties: [] } satisfies AnalyticsCounterparties,
  balances: { result: "success", ...span, interval: "day", lines_total: 0, lines: [], count: 0, rows: [] } satisfies AnalyticsBalances,
  pairs: { result: "success", ...span, total: 0, count: 0, pairs: [] } satisfies AnalyticsExchanges,
};

/** `value` after `ms` of the fake clock. */
const after = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
/** A rejection with `error` after `ms` of the fake clock. */
const failingAfter = (ms: number, error: unknown): Promise<never> => new Promise((_resolve, reject) => setTimeout(() => reject(error), ms));
const never = <T>(): Promise<T> => new Promise<T>(() => {});
const serverError = (what: string) => new UpstreamError("server", `${what} answered 500`, { status: 500 });
/**
 * Call A when the index has no creation record of the account: the API's 404. Handled at once, as the route's `Promise.allSettled` handles it
 * (the loader reads it only for All).
 */
function noCreationRecord(): Promise<AccountData> {
  const answer = Promise.reject(new UpstreamError("not_found", "data API GET /v2/accounts/… answered 404: Account not found", { status: 404 }));
  answer.catch(() => {});
  return answer;
}

/** A promise of the page and the hand that settles it, as the route settles `deleted` once the header is known. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

interface WorldOptions {
  period?: AnalyticsPeriod;
  /** What call 0 comes to. */
  last?: () => Promise<LastValidated>;
  /** What each call comes to; an answer at once when left out. */
  calls?: Partial<Record<Card, () => Promise<unknown>>>;
  /** Call A, the header's. */
  account?: Promise<AccountData>;
  /** Call P, the existence probe's. */
  probe?: () => Promise<Page<"transactions", TxObject>>;
}

/**
 * A request to the loader, over a fake data API whose calls are spies, a load context whose `waitUntil` and degraded mark record what they are
 * given, and `console.error` (where `logProblem` writes) silenced and recorded.
 */
function world(options: WorldOptions = {}) {
  const handedOff: Promise<unknown>[] = [];
  const marks: string[] = [];
  const mark: DegradedMark = {
    get degraded() {
      return marks.length > 0;
    },
    get reason() {
      return marks[0];
    },
    mark: (reason) => void marks.push(reason),
  };
  const ctx = { waitUntil: (work: Promise<unknown>) => void handedOff.push(work), passThroughOnException() {} } as unknown as ExecutionContext;
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});

  const answer = (card: Card) => options.calls?.[card] ?? (() => Promise.resolve(answers[card]));
  const api = {
    lastValidated: vi.fn(options.last ?? (() => Promise.resolve(LAST))),
    accountStats: vi.fn((_address: string, family: "value" | "transactions") => answer(family === "value" ? "value" : "sent")()),
    analyticsBalanceChanges: vi.fn(() => answer("changes")()),
    analyticsCounterparties: vi.fn(() => answer("counterparties")()),
    analyticsBalances: vi.fn(() => answer("balances")()),
    analyticsExchanges: vi.fn(() => answer("pairs")()),
  };
  const probe = vi.fn(options.probe ?? (() => Promise.resolve({ result: "success", count: 0, transactions: [] } as Page<"transactions", TxObject>)));
  const deleted = deferred<boolean>();
  const abandon = new AbortController();

  const input: AnalyticsInput = {
    context: createLoadContext(env, ctx, mark),
    request: new Request(`https://explorer.test/xrpl/account/${ADDRESS}?tab=analytics`),
    api: api as unknown as DataApi,
    network: networkOf("xrpl", env),
    address: ADDRESS,
    period: options.period ?? "30d",
    deadlineAt: Date.now() + CARD_DEADLINE_MS,
    account: options.account ?? Promise.resolve(CREATED),
    probe,
    deleted: deleted.promise,
    signal: abandon.signal,
  };
  /** How many of calls 1 to 6 were made. */
  const callsMade = () =>
    api.accountStats.mock.calls.length +
    api.analyticsBalanceChanges.mock.calls.length +
    api.analyticsCounterparties.mock.calls.length +
    api.analyticsBalances.mock.calls.length +
    api.analyticsExchanges.mock.calls.length;
  /** The `what` of each line `logProblem` wrote. */
  const logged = () => logs.mock.calls.map(([line]) => (JSON.parse(String(line)) as { what: string }).what);
  return { input, api, probe, deleted, abandon, handedOff, marks, logged, callsMade };
}

/** The state of each part of the view, once the fake clock has moved `ms` on; a part that has not settled is `"pending"`. */
async function statesAfter(data: AnalyticsData, ms = 0): Promise<Record<"frame" | Card, string>> {
  await vi.advanceTimersByTimeAsync(ms);
  const states = Object.fromEntries(["frame", ...CARDS].map((part) => [part, "pending"])) as Record<"frame" | Card, string>;
  for (const part of ["frame", ...CARDS] as const) void data[part].then((settled) => (states[part] = settled.state));
  // What has settled is told in the microtasks that follow.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  return { ...states };
}

const allOk = { frame: "ok", value: "ok", sent: "ok", changes: "ok", counterparties: "ok", balances: "ok", pairs: "ok" };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("loadAnalytics", () => {
  it("is the period and a promise of the frame and of each card", () => {
    const { input } = world({ period: "90d" });
    const data = loadAnalytics(input);
    expect(data.period).toBe("90d");
    for (const part of ["frame", ...CARDS] as const) expect(data[part]).toBeInstanceOf(Promise);
  });

  it("gives every card ok when its call settles in time, hands nothing to waitUntil, and marks nothing", async () => {
    const { input, deleted, handedOff, marks, logged } = world();
    const data = loadAnalytics(input);
    deleted.resolve(false);

    expect(await statesAfter(data)).toEqual(allOk);
    expect(handedOff).toEqual([]);
    expect(marks).toEqual([]);
    expect(logged()).toEqual([]);
    // Nothing is left to fire: every deadline was cleared.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("builds each card over the frame of the period: the window's buckets, and the deleted account's note", async () => {
    const { input, deleted } = world();
    const data = loadAnalytics(input);
    deleted.resolve(true);

    const frame = await data.frame;
    expect(frame).toMatchObject({ state: "ok", period: "30d", start: "2026-09-18", deleted: true });
    expect(frame.state === "ok" && frame.note).toContain("This account was deleted; All covers its whole history.");
    const value = await data.value;
    expect(value.state === "ok" && value.chart.axis.buckets).toHaveLength(30);
    // The DEX wording follows AMM_DATA, which is on.
    const changes = await data.changes;
    expect(changes.state === "ok" && changes.sources.rows.find((row) => row.id === "dex")?.hint).toBe("order book and AMM");
  });

  it.each([
    ["30d", "day", "2026-09-18"],
    ["90d", "day", "2026-07-20"],
    ["1y", "week", "2025-10-20"],
    ["all", "month", "2025-07-01"],
  ] as const)("asks each call of %s for its window: interval %s from %s, with the limits of the spec", async (period, interval, start) => {
    const { input, api, deleted } = world({ period });
    const data = loadAnalytics(input);
    deleted.resolve(false);
    await statesAfter(data);

    expect(api.lastValidated).toHaveBeenCalledTimes(1);
    expect(api.lastValidated).toHaveBeenCalledWith();
    expect(api.accountStats.mock.calls).toEqual([
      [ADDRESS, "value", { interval, limit: 1000, start }],
      [ADDRESS, "transactions", { interval, limit: 1000, start }],
    ]);
    expect(api.analyticsBalanceChanges.mock.calls).toEqual([[ADDRESS, { interval, start }]]);
    expect(api.analyticsCounterparties.mock.calls).toEqual([[ADDRESS, { limit: 6, start }]]);
    expect(api.analyticsBalances.mock.calls).toEqual([[ADDRESS, { interval, limit: 4, start }]]);
    expect(api.analyticsExchanges.mock.calls).toEqual([[ADDRESS, { limit: 6, start }]]);
  });

  it("starts the calls as soon as the window is known, without waiting for the header", async () => {
    const { input, callsMade } = world();
    const data = loadAnalytics(input);
    // `deleted` is not settled: the header has not answered.
    expect(await statesAfter(data, 100)).toEqual({ frame: "pending", value: "pending", sent: "pending", changes: "pending", counterparties: "pending", balances: "pending", pairs: "pending" });
    expect(callsMade()).toBe(6);
  });

  describe("a card that fails", () => {
    it("is failed, logged and marked under its own name; the others are ok", async () => {
      const { input, deleted, handedOff, marks, logged } = world({ calls: { value: () => Promise.reject(serverError("stats/value")) } });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect(await statesAfter(data)).toEqual({ ...allOk, value: "failed" });
      expect(marks).toEqual(["analytics value could not be loaded"]);
      expect(logged()).toEqual(["the analytics value of an account could not be loaded"]);
      expect(handedOff).toEqual([]);
    });

    it("is failed when its builder cannot make the card of the answer", async () => {
      const broken = { ...answers.value, rows: [{ date: "2026-10-17T00:00:00Z", account_value: "lots", balance_change_count: 1 }] };
      const { input, deleted, marks } = world({ calls: { value: () => Promise.resolve(broken) } });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect((await statesAfter(data)).value).toBe("failed");
      expect(marks).toEqual(["analytics value could not be loaded"]);
    });

    it("says each card's own name", async () => {
      const calls = Object.fromEntries(CARDS.map((card) => [card, () => Promise.reject(serverError(card))]));
      const { input, deleted, marks, logged } = world({ calls });
      const data = loadAnalytics(input);
      deleted.resolve(false);
      await statesAfter(data);

      expect([...marks].sort()).toEqual(CARDS.map((card) => `analytics ${card} could not be loaded`).sort());
      expect([...logged()].sort()).toEqual(CARDS.map((card) => `the analytics ${card} of an account could not be loaded`).sort());
    });
  });

  describe("a card that is late", () => {
    it("is late at the deadline, logged and marked as taking too long, and its call is handed to waitUntil, which sees it to its end", async () => {
      const { input, deleted, handedOff, marks, logged } = world({ calls: { balances: () => after(6_000, answers.balances) } });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect((await statesAfter(data, CARD_DEADLINE_MS - 1)).balances).toBe("pending");
      expect(handedOff).toEqual([]);
      expect(await statesAfter(data, 1)).toEqual({ ...allOk, balances: "late" });
      expect(marks).toEqual(["analytics balances took too long"]);
      expect(logged()).toEqual(["the analytics balances of an account took too long"]);
      expect(handedOff).toHaveLength(1);

      // What waitUntil was given settles when the call does, and does not reject.
      let finished = false;
      void handedOff[0]!.then(() => (finished = true));
      await vi.advanceTimersByTimeAsync(6_000 - CARD_DEADLINE_MS - 1);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(finished).toBe(true);
    });

    it("hands waitUntil a late call that then fails without a rejection, and is not logged again", async () => {
      const { input, deleted, handedOff, logged } = world({ calls: { counterparties: () => failingAfter(15_000, new UpstreamError("timeout", "slow", { status: 0 })) } });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect((await statesAfter(data, CARD_DEADLINE_MS)).counterparties).toBe("late");
      expect(handedOff).toHaveLength(1);
      const outcome = handedOff[0]!.then(
        () => "settled",
        () => "rejected",
      );
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await outcome).toBe("settled");
      expect(logged()).toEqual(["the analytics counterparties of an account took too long"]);
    });
  });

  describe("the frame", () => {
    it("fails when call 0 fails: one log, one mark, every card failed without a word of its own, and no call 1 to 6 made", async () => {
      const { input, deleted, handedOff, marks, logged, callsMade } = world({ last: () => Promise.reject(serverError("last_validated")) });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect(await statesAfter(data)).toEqual({ frame: "failed", value: "failed", sent: "failed", changes: "failed", counterparties: "failed", balances: "failed", pairs: "failed" });
      expect(marks).toEqual(["analytics frame could not be loaded"]);
      expect(logged()).toEqual(["the analytics frame of an account could not be loaded"]);
      expect(callsMade()).toBe(0);
      expect(handedOff).toEqual([]);
    });

    it.each([
      ["a close time that is not a time", { close_time: "yesterday" }],
      ["a ledger index that is not a number", { ledger_index: "latest" }],
    ])("fails, and does not throw, on a last_validated with %s", async (_what, broken) => {
      const { input, deleted, marks, callsMade } = world({ last: () => Promise.resolve({ ...LAST, ...broken }) });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect((await statesAfter(data)).frame).toBe("failed");
      expect(marks).toEqual(["analytics frame could not be loaded"]);
      expect(callsMade()).toBe(0);
    });

    it("is late when call 0 answers after the deadline: the chain is handed to waitUntil, and calls 1 to 6 run once call 0 has answered", async () => {
      const { input, deleted, handedOff, marks, logged, callsMade } = world({ last: () => after(6_000, LAST) });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect(await statesAfter(data, CARD_DEADLINE_MS)).toEqual({ frame: "late", value: "late", sent: "late", changes: "late", counterparties: "late", balances: "late", pairs: "late" });
      expect(marks).toEqual(["analytics frame took too long"]);
      expect(logged()).toEqual(["the analytics frame of an account took too long"]);
      expect(handedOff).toHaveLength(1);
      expect(callsMade()).toBe(0);

      let finished = false;
      void handedOff[0]!.then(() => (finished = true));
      await vi.advanceTimersByTimeAsync(6_000 - CARD_DEADLINE_MS);
      expect(callsMade()).toBe(6);
      expect(finished).toBe(true);
      // The cards said what they said at the deadline, and nothing more was logged.
      expect(marks).toEqual(["analytics frame took too long"]);
    });

    describe("late because the header has not told the account's existence by the deadline", () => {
      it("is late at the deadline, and says nothing and hands nothing on while the header may yet make the page a 404 or a 503", async () => {
        const { input, handedOff, marks, logged, callsMade } = world({ calls: { pairs: () => after(5_000, answers.pairs) } });
        const data = loadAnalytics(input);

        expect(await statesAfter(data, CARD_DEADLINE_MS)).toEqual({ frame: "late", value: "late", sent: "late", changes: "late", counterparties: "late", balances: "late", pairs: "late" });
        expect(callsMade()).toBe(6);
        expect(marks).toEqual([]);
        expect(logged()).toEqual([]);
        expect(handedOff).toEqual([]);
      });

      it("then the view: logs and marks the late frame once, and hands the chain to waitUntil, which sees the calls to their end", async () => {
        const { input, deleted, handedOff, marks, logged } = world({ calls: { pairs: () => after(5_000, answers.pairs) } });
        const data = loadAnalytics(input);
        await statesAfter(data, CARD_DEADLINE_MS + 100);
        expect(handedOff).toEqual([]);

        // The header says the account exists: the page is the view.
        deleted.resolve(false);
        await statesAfter(data);
        expect(marks).toEqual(["analytics frame took too long"]);
        expect(logged()).toEqual(["the analytics frame of an account took too long"]);
        expect(handedOff).toHaveLength(1);
        let finished = false;
        void handedOff[0]!.then(() => (finished = true));
        await vi.advanceTimersByTimeAsync(400 - 1);
        expect(finished).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(finished).toBe(true);
        // Once, and the cards said nothing of their own.
        expect(marks).toEqual(["analytics frame took too long"]);
      });

      it("then an abandoned page (a 404 or a 503): no log, no mark and nothing handed to waitUntil, ever", async () => {
        const { input, abandon, handedOff, marks, logged } = world({ calls: { pairs: () => after(5_000, answers.pairs) } });
        const data = loadAnalytics(input);
        expect((await statesAfter(data, CARD_DEADLINE_MS + 100)).frame).toBe("late");

        abandon.abort();
        await statesAfter(data, 10_000);
        expect(marks).toEqual([]);
        expect(logged()).toEqual([]);
        expect(handedOff).toEqual([]);
      });
    });
  });

  describe("a page that is abandoned (a 404 or a 503)", () => {
    it("resolves what is pending as late, clears its deadlines, hands nothing to waitUntil, and logs and marks nothing", async () => {
      const { input, deleted, abandon, handedOff, marks, logged } = world({ calls: { counterparties: never } });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect((await statesAfter(data, 1_000)).counterparties).toBe("pending");
      abandon.abort();
      expect(await statesAfter(data)).toEqual({ ...allOk, counterparties: "late" });
      expect(vi.getTimerCount()).toBe(0);
      expect(handedOff).toEqual([]);
      expect(marks).toEqual([]);
      expect(logged()).toEqual([]);

      // The deadline, had it been left, would have marked the page.
      await vi.advanceTimersByTimeAsync(CARD_DEADLINE_MS);
      expect(marks).toEqual([]);
      expect(handedOff).toEqual([]);
    });

    it("resolves the frame and every card late when the header never says the account exists", async () => {
      const { input, abandon, handedOff, marks, logged, callsMade } = world();
      const data = loadAnalytics(input);
      await statesAfter(data, 100);
      abandon.abort();

      expect(await statesAfter(data)).toEqual({ frame: "late", value: "late", sent: "late", changes: "late", counterparties: "late", balances: "late", pairs: "late" });
      expect(callsMade()).toBe(6);
      expect(vi.getTimerCount()).toBe(0);
      expect(handedOff).toEqual([]);
      expect(marks).toEqual([]);
      expect(logged()).toEqual([]);
    });

    it("starts no call 1 to 6 when it is abandoned before the window is known, and hands nothing on", async () => {
      const { input, abandon, handedOff, marks, logged, callsMade } = world({ last: () => after(1_000, LAST) });
      const data = loadAnalytics(input);
      await statesAfter(data, 500);
      abandon.abort();

      // Call 0 answers after the page was abandoned: nothing is asked for a page that is not the view.
      expect(await statesAfter(data, 1_000)).toEqual({ frame: "late", value: "late", sent: "late", changes: "late", counterparties: "late", balances: "late", pairs: "late" });
      expect(callsMade()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(handedOff).toEqual([]);
      expect(marks).toEqual([]);
      expect(logged()).toEqual([]);
    });

    it("starts no call 1 to 6 for All when it is abandoned while the first month is not known", async () => {
      const { input, abandon, callsMade } = world({ period: "all", account: after(1_000, CREATED) });
      const data = loadAnalytics(input);
      await statesAfter(data, 500);
      abandon.abort();
      await statesAfter(data, 1_000);
      expect(callsMade()).toBe(0);
    });

    it("logs nothing of a call 0 that failed when the page turns out not to be the view", async () => {
      const { input, abandon, marks, logged } = world({ last: () => Promise.reject(serverError("last_validated")) });
      const data = loadAnalytics(input);
      await statesAfter(data, 100);
      abandon.abort();

      expect((await statesAfter(data)).frame).toBe("late");
      expect(marks).toEqual([]);
      expect(logged()).toEqual([]);
    });
  });

  describe("All's first month", () => {
    it("is the month of the account's activation, without the existence probe", async () => {
      const { input, api, probe, deleted } = world({ period: "all" });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      const frame = await data.frame;
      expect(frame).toMatchObject({ state: "ok", start: "2025-07-01" });
      expect(frame.state === "ok" && frame.note).toMatch(/^Since Jul 2025, the month it was activated, per month \(UTC\)\./);
      expect(probe).not.toHaveBeenCalled();
      expect(api.analyticsExchanges.mock.calls).toEqual([[ADDRESS, { limit: 6, start: "2025-07-01" }]]);
    });

    it("is the month of the oldest transaction in the index when the account has no creation record: the probe is asked once", async () => {
      const oldest = { result: "success", count: 1, transactions: [{ date: "2024-08-12T10:02:43+00:00" }] } as unknown as Page<"transactions", TxObject>;
      const { input, api, probe, deleted } = world({
        period: "all",
        account: noCreationRecord(),
        probe: () => Promise.resolve(oldest),
      });
      const data = loadAnalytics(input);
      deleted.resolve(true);

      const frame = await data.frame;
      expect(frame).toMatchObject({ state: "ok", start: "2024-08-01" });
      expect(frame.state === "ok" && frame.note).toMatch(/^Since Aug 2024, the month of its oldest transaction in the index, per month \(UTC\)\./);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(api.accountStats.mock.calls[0]).toEqual([ADDRESS, "value", { interval: "month", limit: 1000, start: "2024-08-01" }]);
    });

    it("is T's month when the index has neither a creation record nor a transaction of the account", async () => {
      const { input, probe, deleted } = world({ period: "all", account: noCreationRecord() });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      const frame = await data.frame;
      expect(frame).toMatchObject({ state: "ok", start: "2026-10-01" });
      expect(frame.state === "ok" && frame.note).toMatch(/^This month \(UTC\): the index has no transaction of this account yet\./);
      expect(probe).toHaveBeenCalledTimes(1);
    });

    it("fails the frame when the probe fails, with no call 1 to 6", async () => {
      const { input, deleted, marks, callsMade } = world({
        period: "all",
        account: noCreationRecord(),
        probe: () => Promise.reject(serverError("transactions")),
      });
      const data = loadAnalytics(input);
      deleted.resolve(true);

      expect((await statesAfter(data)).frame).toBe("failed");
      expect(marks).toEqual(["analytics frame could not be loaded"]);
      expect(callsMade()).toBe(0);
    });

    it.each([
      ["an inception", { account: Promise.resolve({ ...CREATED, inception: "July" }) }],
      ["an oldest transaction's date", {
        account: noCreationRecord(),
        probe: () => Promise.resolve({ result: "success", count: 1, transactions: [{ date: "2024-02-30T10:02:43+00:00" }] } as unknown as Page<"transactions", TxObject>),
      }],
    ] as const)("fails the frame on %s that is not a date", async (_what, over) => {
      const { input, deleted, marks, callsMade } = world({ period: "all", ...over });
      const data = loadAnalytics(input);
      deleted.resolve(false);

      expect((await statesAfter(data)).frame).toBe("failed");
      expect(marks).toEqual(["analytics frame could not be loaded"]);
      expect(callsMade()).toBe(0);
    });

    it("does not read the creation record for another period", async () => {
      const { input, probe, deleted } = world({ period: "1y", account: noCreationRecord() });
      const data = loadAnalytics(input);
      deleted.resolve(true);

      expect(await data.frame).toMatchObject({ state: "ok", start: "2025-10-20" });
      expect(probe).not.toHaveBeenCalled();
    });
  });
});
