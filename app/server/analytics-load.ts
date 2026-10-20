// The loading of the account page's Analytics tab (spec 2.2, 2.3 and 2.5 to 2.8): the window of the view, the six calls over it, and the frame and the
// six cards as promises that the page streams in after the header. Worker-only: the account route calls it.
//
// - **The window** is call 0's day `T` (`/v2/last_validated`), and for All the first month of the account: its creation record's (call A, the header's
//   own promise), else its oldest transaction in the index (call P, the existence probe's own promise), else T's month.
// - **Calls 1 to 6** start as soon as the window is known, beside the header, not after it. Each card is its call, then its builder over the frame
//   (the window and whether the account was deleted), raced against one deadline: the loader's start + `CARD_DEADLINE_MS` (E2's `byDeadline`).
// - **What a card comes to** is `ok`, `failed` (logged and marked, so the page is served and not stored) or `late`: logged and marked as taking too
//   long, with its call handed to `ctx.waitUntil`, so that it finishes in the background and the subrequest cache keeps its answer for a Retry. A
//   late frame hands on the whole chain: the window, then calls 1 to 6.
// - **The frame fails** (call 0, or for All the probe) with one log line and one mark; its cards then fail without a word of their own. Its outcome is
//   told once the header knows the account exists, so a page that turns out a 404 or a 503 says nothing of the analytics.
// - **A page that is not the view** (a 404, a 503) aborts `signal`: every deadline is cleared, whatever is pending resolves `late`, and nothing is
//   logged, marked or handed to `waitUntil`. The fetches are not aborted: another request may share them (spec 2.7).

import { analyticsWindow, type AnalyticsPeriod, type AnalyticsWindow } from "../domain/analytics-params";
import { utcDayOf } from "../domain/window";
import {
  analyticsFrame,
  balancesCard,
  changesCard,
  counterpartiesCard,
  dexWording,
  pairsCard,
  sentCard,
  valueCard,
  type AnalyticsData,
  type AnalyticsFrame,
  type CardState,
} from "./analytics-view";
import { anchorOrThrow } from "./anchor";
import type { AccountData, Page, TxObject } from "./api-types";
import type { DataApi } from "./data-api";
import { byDeadline, outcome, TooLate } from "./deadline";
import { getExecutionContext, markDegraded } from "./env";
import { logProblem } from "./logging";
import type { Network } from "./networks";
import { UpstreamError } from "./upstream";

/** The rows `stats/{family}` is asked for: one page for any window (All since 2013 is about 170 months). */
const STATS_LIMIT = 1000;
/** The board's rows of the counterparties and of the DEX trading. */
const TABLE_LIMIT = 6;
/** D2's panels of the balance history. */
const BALANCES_LIMIT = 4;

export interface AnalyticsInput {
  /** The load context. */
  context: unknown;
  request: Request;
  api: DataApi;
  network: Network;
  address: string;
  period: AnalyticsPeriod;
  /** The loader's start + `CARD_DEADLINE_MS`, ms since the epoch. */
  deadlineAt: number;
  /** Call A, the header's one promise. */
  account: Promise<AccountData>;
  /** Call P, memoised: the existence probe's promise and key (`limit=1`). */
  probe: () => Promise<Page<"transactions", TxObject>>;
  /** Settles once the header knows the account's existence. */
  deleted: Promise<boolean>;
  /** Aborted when the page turns out a 404 or a 503. */
  signal: AbortSignal;
}

/** The names of the cards, as the page data has them and as their log lines and marks say them. */
type CardName = Exclude<keyof AnalyticsData, "period" | "frame">;

/** Calls 1 to 6, each as what it came to (never a rejection). */
type Calls = {
  [K in CardName]: Promise<PromiseSettledResult<unknown>>;
};

/** The page was abandoned (`signal`): what is pending is late, and says nothing. */
class Abandoned extends Error {
  constructor() {
    super("the page is not the analytics view");
    this.name = "Abandoned";
  }
}

/**
 * The day (`YYYY-MM-DD`) a time of the API starts with, checked to be one: `analyticsWindow` reads the first ten characters as a day. A creation record or a
 * transaction whose time is not a time is the data API failing.
 */
function dayOf(time: unknown, what: string): string {
  const day = typeof time === "string" && /^\d{4}-\d{2}-\d{2}T/.test(time) && Number.isFinite(Date.parse(time)) ? time.slice(0, 10) : "";
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) {
    throw new UpstreamError("server", `data API ${what} is not a time: ${JSON.stringify(time)?.slice(0, 40)}`, { status: 200 });
  }
  return day;
}

/** All's first day (spec 2.2): the account's activation, else its oldest transaction in the index, else none (T's month). */
async function firstDayOf(account: Promise<AccountData>, probe: AnalyticsInput["probe"]): Promise<{ day: string; from: "activation" | "oldest" } | null> {
  try {
    const created = await account;
    return { day: dayOf(created.inception, "GET /v2/accounts/{a} answered an inception that"), from: "activation" };
  } catch (error) {
    // No creation record: the index has the account from its range only. Anything else fails the frame (and the header, which reads the same call).
    if (!(error instanceof UpstreamError && error.kind === "not_found")) throw error;
  }
  const oldest = (await probe()).transactions[0];
  return oldest === undefined ? null : { day: dayOf(oldest.date, "GET /v2/accounts/{a}/transactions?limit=1 answered a date that"), from: "oldest" };
}

/** Calls 1 to 6 over a window (spec 2.3): the same `start` and `interval` for each, no `end`. */
function callsOf(api: DataApi, address: string, window: AnalyticsWindow): Calls {
  const { unit: interval, start } = window;
  return {
    value: outcome(api.accountStats(address, "value", { interval, limit: STATS_LIMIT, start })),
    sent: outcome(api.accountStats(address, "transactions", { interval, limit: STATS_LIMIT, start })),
    changes: outcome(api.analyticsBalanceChanges(address, { interval, start })),
    counterparties: outcome(api.analyticsCounterparties(address, { limit: TABLE_LIMIT, start })),
    balances: outcome(api.analyticsBalances(address, { interval, limit: BALANCES_LIMIT, start })),
    pairs: outcome(api.analyticsExchanges(address, { limit: TABLE_LIMIT, start })),
  };
}

/** The view's parts as the page streams them (`AnalyticsData`), from the header's calls and this request's own. No promise in it rejects. */
export function loadAnalytics(input: AnalyticsInput): AnalyticsData {
  const { context, request, api, network, address, period, deadlineAt, account, probe, deleted, signal } = input;
  const native = network.native;
  const dex = dexWording(network);

  // Rejects once the page is abandoned. It is raced by each part, and handled here so that a page that is the view leaves no rejection unhandled.
  const abandoned = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Abandoned());
    else signal.addEventListener("abort", () => reject(new Abandoned()), { once: true });
  });
  abandoned.catch(() => {});

  /**
   * `work` as a part of the view: `ok` with what it gave, or `failed` (logged and marked), or `late` at the deadline (logged and marked, and
   * `background()` handed to `waitUntil`), or `late` without a word once the page is abandoned. The race is `byDeadline`'s; an abandoned page
   * settles `work`'s side of it, which clears its timer.
   */
  async function settle<T extends object>(part: CardName | "frame", work: Promise<T>, background: () => Promise<unknown>): Promise<CardState<T>> {
    try {
      return { state: "ok", ...(await byDeadline(Promise.race([work, abandoned]), deadlineAt)) };
    } catch (error) {
      if (error instanceof Abandoned) return { state: "late" };
      if (error instanceof TooLate) {
        logProblem(`the analytics ${part} of an account took too long`, error, request);
        markDegraded(context, `analytics ${part} took too long`);
        // Never a rejection: the call's own failure was its card's, and the card has been told.
        getExecutionContext(context).waitUntil(background().catch(() => {}));
        return { state: "late" };
      }
      logProblem(`the analytics ${part} of an account could not be loaded`, error, request);
      markDegraded(context, `analytics ${part} could not be loaded`);
      return { state: "failed" };
    }
  }

  // Call 0, and for All the first month. Calls 1 to 6 start as soon as it is known: `null` when it cannot be (the frame says why).
  const windowCall = api.lastValidated().then(async (last) => {
    const T = utcDayOf(anchorOrThrow(last).closeTime);
    return period === "all" ? analyticsWindow(period, T, await firstDayOf(account, probe)) : analyticsWindow(period, T);
  });
  const calls: Promise<Calls | null> = windowCall.then(
    (window) => callsOf(api, address, window),
    () => null,
  );

  // The frame, once the header has said whether the account exists and was deleted: a call 0 that failed for a page that is a 404 is no frame's.
  const frame = settle(
    "frame",
    deleted.then((wasDeleted) => windowCall.then((window) => analyticsFrame(window, { deleted: wasDeleted }))),
    // Late: the chain goes on in the background, and its answers are kept for the next render.
    () => calls.then((made) => made && Promise.all(Object.values(made))),
  );

  /** A card: its call, then its builder over the frame. A frame that failed or was late is the card's state too, without a word of its own. */
  function card<A, T extends object>(name: CardName, build: (frame: AnalyticsFrame, answer: A) => T): Promise<CardState<T>> {
    return frame.then((framed) => {
      if (framed.state !== "ok") return { state: framed.state };
      // The frame is there, so the window is, and the calls were made.
      const call = calls.then((made) => made![name] as Promise<PromiseSettledResult<A>>);
      const built = call.then((settled) => {
        if (settled.status === "rejected") throw settled.reason;
        return build(framed, settled.value);
      });
      return settle(name, built, () => call);
    });
  }

  return {
    period,
    frame,
    value: card("value", (framed, page: Parameters<typeof valueCard>[1]) => valueCard(framed, page, native)),
    sent: card("sent", (framed, page: Parameters<typeof sentCard>[1]) => sentCard(framed, page, network.id)),
    changes: card("changes", (framed, answer: Parameters<typeof changesCard>[1]) => changesCard(framed, answer, native, dex)),
    counterparties: card("counterparties", counterpartiesCard),
    balances: card("balances", balancesCard),
    pairs: card("pairs", (framed, answer: Parameters<typeof pairsCard>[1]) =>
      pairsCard(framed, answer, { net: network.id, native, markets: network.features.markets, dex }),
    ),
  };
}
