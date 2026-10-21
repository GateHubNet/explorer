// The data API's answers for the Analytics tab of the account page (E4 spec 7.5): calls 1 to 6 of spec 2.3 (`stats/value`, `stats/transactions` and the four
// `analytics/*` routes of D2) for each of the four periods, for the active, the deleted and the never-funded account of each network (README.md, "Upstream
// fixtures"). They are months of aggregates valued at rates, which the recorded ledgers cannot give, so they are synthetic: http-fixtures.ts calls
// `analyticsFixtures` from `generate()` for each network, and `pnpm fixtures:sync` writes them. test/fixtures/PROVENANCE.md ("Synthetic aggregates") says what
// they follow; test/unit/analytics-fixtures.test.ts checks them.
//
// What they follow is D2's reference, data-api-new's docs/api-reference.md at ANALYTICS_REFERENCE_COMMIT (the `stats/{family}` and four `analytics/*`
// sections), and where it leaves a rule open the builders of the same commit (apps/api/src/accounts/account-analytics-object.ts, packages/shared/src/query/
// valuation.ts), read with `git show`:
//
// - One history per account, made day by day from the account's first day to T, and cut to each window: every period is the same days, a week or a month is
//   what its days hold, and a level (a balance, the account's value) is the one of the bucket's last day up to T.
// - Every balance change is a leg of something the account did or was part of: a payment (`payment_source`, `payment_destination`), a trade (`exchange`, one
//   leg per side), an escrow, a payment that rippled through a trust line (`intermediary`, in and out), a reward (no change type), the deletion (no change
//   type), and the fee of every transaction it sent (`transaction_cost`; a failed one pays its fee and moves nothing else). So a bucket's `transaction_cost`
//   count is its `transaction_count`, the lines' balances are the sums of their changes, and the counterparties and pairs are the payments and trades of
//   the same history.
// - Values follow the reference: the native currency is worth itself; an issued amount is the amount over the rate of its asset (units of it per native
//   coin) on its UTC day, cut to 17 significant digits per group (a day, a change type and an asset; for a counterparty, a side, an asset and a day; for a
//   pair without a native side, a day), and the sums of values are exact.
// - Every amount and value is an exact decimal made with bignumber.js and written as the API writes it (`toString`), which for these figures is always a plain
//   decimal: the generator stops rather than write one the API would put in exponent form.
// - Anchors, read from the hand-written account fixtures and never written here: the active account's native line ends at its `account_info` balance at T,
//   and each token line at its balances fixture's value; the deleted account's native balance is 0 from the day of its deletion on (the date of the newest
//   row of its hand-written history: XRPL's recorded AccountDelete, Xahau's newest recorded transaction), and it does nothing after it; an account's first
//   day is the day of its creation's `inception`, when its creation's `parent` pays it the creation's `initial_balance`, as the header says. The native
//   balance never goes below the reserve of `server_state` (`reserve_base`, and `reserve_inc` for each trust line) before the deletion, and the deletion
//   pays `reserve_inc` as its fee.
// - Because the balances end at their anchors, the history is made backwards, from the last day to the first: a day's balance before its changes is its
//   balance after them less the changes. A change the balances cannot have had (a payment received that would leave less than the reserve before it, a
//   purchase of more of a token than the account held after it) did not happen: a payment or an offer the account sent then fails for want of funds
//   (`tecUNFUNDED_PAYMENT`, `tecUNFUNDED_OFFER`), and anything else is dropped. What is left at a token line's first day is what opened it: a payment from
//   the issuer (after the account's TrustSet). On the account's first day the parent pays the initial balance, and what the history leaves differs from
//   it: one payment right after the activation settles the difference, from one of the account's counterparties when the history needs more, to one
//   when it needs less.
// - The never-funded address has the empty answers of an unknown address.
//
// The draws come from one stream per network, account and endpoint, `mulberry32(seedOf(net, account, endpoint))` (scripts/synthetic.ts): `stats/value` the
// daily rates, `stats/transactions` the transactions sent that move nothing and which sent ones fail, `analytics/balances` the first day of each token
// line, `analytics/counterparties` the accounts and the payments, `analytics/exchanges` the trades (and Xahau's USD issuer), and `analytics/balance_changes`
// the fees, escrows, rippled payments, rewards and the deleted account's last balance. Only integer arithmetic and the four operations of IEEE doubles go
// into the draws, so every Node writes the same bytes.

import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { encodeAccountID } from "ripple-address-codec";

import { analyticsWindow, ANALYTICS_PERIODS, type AnalyticsUnit, type AnalyticsWindow } from "../app/domain/analytics-params";
import { canonicalPair, type Asset, type NativeCode } from "../app/domain/asset";
import type {
  AccountTxStatsRow,
  AccountValueRow,
  AnalyticsBalanceChanges,
  AnalyticsBalanceLine,
  AnalyticsBalanceRow,
  AnalyticsBalances,
  AnalyticsCounterparties,
  AnalyticsCounterparty,
  AnalyticsExchanges,
  AnalyticsPair,
  BalanceChangeBucket,
  BalanceChangeTotal,
  Page,
} from "../app/server/api-types";
import type { NetworkName } from "../test/support/upstream-core";
import { HTTP } from "./http-fixtures";
import { mulberry32, seedOf } from "./synthetic";

/**
 * The commit of data-api-new whose docs/api-reference.md the shapes follow: the merge of D2 (`feat/explorer-data`), as app/server/analytics-shape.ts and
 * api-types.ts do. test/fixtures/PROVENANCE.md names it.
 */
export const ANALYTICS_REFERENCE_COMMIT = "7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e";

/** A file of the fixtures: the request that finds it (`path` below the API's host, `query` in any order) and the body it holds. */
export interface AnalyticsFile {
  path: string;
  query: string;
  body: unknown;
}

/** The lists of these answers whose rows are one line each (`fixtureText`'s `rowLists`), as in the other synthetic files. */
export const ANALYTICS_ROW_LISTS: readonly string[] = ["rows", "lines", "totals", "counterparties", "pairs"];

// ---- The accounts and the networks -----------------------------------------------------------------------------------

/** The accounts of README.md, "Upstream fixtures". */
const ACCOUNTS: Record<NetworkName, { active: string; deleted: string; unfunded: string }> = {
  xrpl: { active: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", deleted: "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC", unfunded: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC" },
  xahau: { active: "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto", deleted: "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD", unfunded: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC" },
};

/** A token: its rate on an average day (units of it per native coin) and the decimals its amounts are written with. */
interface Token {
  rate: number;
  decimals: number;
}

interface Network {
  native: NativeCode;
  /**
   * The tokens the active accounts hold now (their balances fixtures), by `currency.issuer`. LIONS at about 0.000158 XRP, the price of its recorded
   * trades (PROVENANCE.md, "Derived trades"); EVR at 0.14 USD and XAH at 0.04 USD, as the network page's fixtures have them.
   */
  held: Record<string, Token>;
  /**
   * The USD the active account trades against the native currency and holds none of at T: a pair that E3's natural orientation shows the other way
   * round (stored USD/XRP, shown XRP/USD). XRPL's is GateHub's (the markets config's), Xahau's an issuer drawn from the stream of `analytics/exchanges`.
   */
  usd: { issuer: string | null } & Token;
  /** The transactions sent that move nothing but the fee, by weight. */
  chores: Record<string, number>;
}

const NETWORKS: Record<NetworkName, Network> = {
  xrpl: {
    native: "XRP",
    held: { "4C494F4E53000000000000000000000000000000.rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS": { rate: 6318, decimals: 2 } },
    usd: { issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", rate: 2.4, decimals: 6 },
    chores: { OfferCancel: 3, AccountSet: 1, TrustSet: 1, SetRegularKey: 0.2 },
  },
  xahau: {
    native: "XAH",
    held: { "EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8": { rate: 0.285714, decimals: 6 } },
    usd: { issuer: null, rate: 0.04, decimals: 6 },
    chores: { Invoke: 3, AccountSet: 1, URITokenMint: 0.5, SetHook: 0.3 },
  },
};

/** How busy an account is: what it does on an average day, and in what sizes (in native coins). */
interface Habits {
  /** Payments received and sent a day; the share of them in a token the account holds; their size. */
  received: number;
  sent: number;
  tokenShare: number;
  receivedSize: number;
  sentSize: number;
  /** The accounts it pays and is paid by (the more often, the higher in the list). */
  pool: number;
  /** Transactions a day that move nothing; the share of the payments and offers it sends that fail; escrows, rippled payments and rewards a day. */
  chores: number;
  failed: number;
  escrows: number;
  ripples: number;
  rewards: number;
  /**
   * Trades a day of each pair while it trades it (a held token against the native currency, USD against it, a held token against USD), and their size;
   * how many days before T it began to trade USD.
   */
  trades: number;
  usdTrades: number;
  crossTrades: number;
  tradeSize: number;
  usdDays: number;
  /** The share of the trades in which it took an offer (an OfferCreate it sent), not had its own taken. */
  taker: number;
  /** The deleted account: what it held when it was deleted. */
  lastBalance: number;
}

const QUIET: Habits = {
  received: 0,
  sent: 0,
  tokenShare: 0,
  receivedSize: 0,
  sentSize: 0,
  pool: 0,
  chores: 0,
  failed: 0,
  escrows: 0,
  ripples: 0,
  rewards: 0,
  trades: 0,
  usdTrades: 0,
  crossTrades: 0,
  tradeSize: 0,
  usdDays: 0,
  taker: 0,
  lastBalance: 0,
};

const HABITS: Record<NetworkName, { active: Habits; deleted: Habits }> = {
  xrpl: {
    active: {
      ...QUIET,
      received: 0.08,
      sent: 0.07,
      tokenShare: 0.2,
      receivedSize: 2,
      sentSize: 2.4,
      pool: 8,
      chores: 0.04,
      failed: 0.2,
      escrows: 0.006,
      ripples: 0.012,
      trades: 0.05,
      usdTrades: 0.3,
      crossTrades: 0.15,
      tradeSize: 2,
      usdDays: 45,
      taker: 0.6,
    },
    deleted: { ...QUIET, received: 0.03, sent: 0.03, receivedSize: 1.5, sentSize: 1.6, pool: 5, chores: 0.01, failed: 0.1, lastBalance: 4 },
  },
  xahau: {
    active: {
      ...QUIET,
      received: 2,
      sent: 0.08,
      tokenShare: 0.3,
      receivedSize: 1,
      sentSize: 15,
      pool: 30,
      chores: 0.08,
      failed: 0.1,
      rewards: 0.033,
      trades: 0.06,
      usdTrades: 0.3,
      tradeSize: 120,
      usdDays: 40,
      taker: 0.6,
    },
    deleted: { ...QUIET, received: 0.1, sent: 0.08, receivedSize: 2, sentSize: 2.5, pool: 6, chores: 0.04, failed: 0.1, rewards: 0.033, lastBalance: 12 },
  },
};

/** What a failed payment or offer says; the first is the one of a payment or an offer the account could not fund. */
const FAILURES: Record<"Payment" | "OfferCreate", string[]> = {
  Payment: ["tecUNFUNDED_PAYMENT", "tecPATH_DRY", "tecPATH_PARTIAL"],
  OfferCreate: ["tecUNFUNDED_OFFER", "tecKILLED"],
};

/** D2's order of the change types; any other comes after them, and a change without one (`""`) last. */
const CHANGE_TYPES = [
  "transaction_cost",
  "payment_destination",
  "payment_source",
  "exchange",
  "intermediary",
  "escrow_create",
  "escrow_finish",
  "escrow_cancel",
  "paychannel_fund",
  "paychannel_payout",
];
const typeRank = (type: string): number => (type === "" ? CHANGE_TYPES.length + 1 : CHANGE_TYPES.indexOf(type) < 0 ? CHANGE_TYPES.length : CHANGE_TYPES.indexOf(type));
const byType = (a: string, b: string): number => typeRank(a) - typeRank(b) || compare(a, b);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---- Numbers -----------------------------------------------------------------------------------------------------------

const BN = BigNumber.clone({ DECIMAL_PLACES: 40, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
type Decimal = BigNumber;
const ZERO = new BN(0);
/** `a / b` with the room of D2's `ratio` (packages/shared/src/query/decimal.ts): 200 decimal places, then an ordinary number. */
const Wide = BigNumber.clone({ DECIMAL_PLACES: 200 });
/** D2's `QUOTIENT_DIGITS`: a value of an issued amount is cut to the 17 significant digits of a double. */
const QUOTIENT_DIGITS = 17;

/** An amount or a value as the API writes it (`toString`), which must be a plain decimal: the fixtures hold no figure the client would not take. */
function text(value: Decimal): string {
  const written = value.toString();
  if (written !== value.toFixed()) throw new Error(`analytics fixtures: ${written} is not a plain decimal`);
  return written;
}

/** `n` drawn around `expected` a day: its mean is `expected` (the floor of x + u, u uniform, is x on average), and it varies by half either way. */
const countOf = (expected: number, next: () => number): number => Math.floor(expected * (0.5 + next()) + next());

/** A size around `mean`: from a tenth of it to twice it, the small ones more often. */
const sizeOf = (mean: number, u: number): number => mean * (0.1 + 1.9 * u * u);

const dropsOf = (native: number): Decimal => new BN(Math.max(1, Math.round(native * 1_000_000))).shiftedBy(-6);
const unitsOf = (amount: number, decimals: number): Decimal => {
  const rounded = new BN(amount).decimalPlaces(decimals);
  return rounded.gt(0) ? rounded : new BN(1).shiftedBy(-decimals);
};

// ---- Days ----------------------------------------------------------------------------------------------------------------

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysFrom(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The start of the bucket of `unit` that holds `day`. */
function bucketOf(day: string, unit: AnalyticsUnit): string {
  if (unit === "day") return day;
  if (unit === "month") return `${day.slice(0, 7)}-01`;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** The start of the bucket after the one that starts at `bucket`. */
function nextBucket(bucket: string, unit: AnalyticsUnit): string {
  if (unit === "day") return addDays(bucket, 1);
  if (unit === "week") return addDays(bucket, 7);
  const [y, m] = bucket.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

const midnight = (day: string): string => `${day}T00:00:00Z`;
const secondsOf = (time: string): number => Number(time.slice(11, 13)) * 3600 + Number(time.slice(14, 16)) * 60 + Number(time.slice(17, 19));
const timeOf = (day: string, seconds: number): string => new Date(Date.parse(midnight(day)) + seconds * 1000).toISOString().replace(".000Z", "Z");

// ---- Assets and lines ----------------------------------------------------------------------------------------------------

/** A line, or an asset: `XRP` alone for the native currency, `currency.issuer` for a token. */
const keyOf = (asset: Asset): string => (asset.issuer === undefined ? asset.currency : `${asset.currency}.${asset.issuer}`);
function assetOf(key: string): Asset {
  const at = key.indexOf(".");
  return at < 0 ? { currency: key } : { currency: key.slice(0, at), issuer: key.slice(at + 1) };
}

// ---- What the hand-written fixtures say ---------------------------------------------------------------------------------

const readJson = (path: string): any => JSON.parse(readFileSync(new URL(path, HTTP), "utf8"));

interface Plan {
  net: NetworkName;
  account: string;
  native: NativeCode;
  habits: Habits;
  /** The day of the creation's `inception`, its seconds, the account that paid it its first coins, and how many (`initial_balance`). */
  first: string;
  firstSeconds: number;
  parent: string;
  initial: Decimal;
  /** The last day it does anything: T, or the day of its deletion; and, deleted, the second of the deletion. */
  last: string;
  deletedAt: number | null;
  /** The balance of each line at the end of `last` (0 for a deleted account): the native line, then its tokens. */
  ends: Map<string, Decimal>;
  /** The tokens it holds or trades, with their rates and decimals. */
  tokens: Map<string, Token>;
  /** The native balance it keeps before its deletion: the base reserve and one owner reserve for each trust line. */
  floor: Decimal;
  /** What the deletion pays as its fee: one owner reserve. */
  deletionFee: Decimal;
}

/** The plan of a funded account, from its hand-written fixtures. */
function planOf(net: NetworkName, account: string, role: "active" | "deleted", T: string, usdIssuer: string): Plan {
  const network = NETWORKS[net];
  const created = readJson(`${net}/data-api/accounts/${account}.json`).account_data as { inception: string; parent: string; initial_balance: string };
  const reserves = readJson(`${net}/node/server_state.json`).result.state.validated_ledger as { reserve_base: number; reserve_inc: number };
  const ends = new Map<string, Decimal>();
  const tokens = new Map<string, Token>();
  let last = T;
  let deletedAt: number | null = null;

  if (role === "active") {
    ends.set(network.native, new BN(readJson(`${net}/node/account_info/${account}.json`).result.account_data.Balance).shiftedBy(-6));
    for (const line of readJson(`${net}/data-api/accounts/${account}/balances.json`).balances as Array<{ currency: string; counterparty?: string; value: string }>) {
      if (line.counterparty === undefined) continue;
      const key = keyOf({ currency: line.currency, issuer: line.counterparty });
      const token = network.held[key];
      if (!token) throw new Error(`analytics fixtures: no rate for ${key}, which ${account} holds`);
      ends.set(key, new BN(line.value));
      tokens.set(key, token);
    }
    const usd = keyOf({ currency: "USD", issuer: usdIssuer });
    ends.set(usd, ZERO);
    tokens.set(usd, network.usd);
  } else {
    // The deletion: the day and time of the newest row of its history.
    const newest = readJson(`${net}/data-api/accounts/${account}/transactions@descending=true&limit=20.json`).transactions[0] as { date: string };
    last = newest.date.slice(0, 10);
    deletedAt = secondsOf(newest.date);
    ends.set(network.native, ZERO);
  }

  return {
    net,
    account,
    native: network.native,
    habits: HABITS[net][role],
    first: created.inception.slice(0, 10),
    firstSeconds: secondsOf(created.inception),
    parent: created.parent,
    initial: new BN(created.initial_balance),
    last,
    deletedAt,
    ends,
    tokens,
    floor: new BN(reserves.reserve_base).plus(new BN(reserves.reserve_inc).times(tokens.size)).shiftedBy(-6),
    deletionFee: new BN(reserves.reserve_inc).shiftedBy(-6),
  };
}

// ---- The history ---------------------------------------------------------------------------------------------------------

/** A balance change: a leg of something the account did, on a line, with its change type (`""` for none). Signed: in is above 0. */
interface Change {
  line: string;
  type: string;
  amount: Decimal;
}

interface Payment {
  counterparty: string;
  side: "sent" | "received";
  line: string;
  amount: Decimal;
  time: string;
}

/** A trade in the pair's stored order: `bought` says whether the account received the base. */
interface Trade {
  base: string;
  counter: string;
  bought: boolean;
  baseAmount: Decimal;
  counterAmount: Decimal;
}

interface Sent {
  type: string;
  result: string;
}

interface Day {
  changes: Change[];
  sent: Sent[];
  payments: Payment[];
  trades: Trade[];
  /** The balance of each line that is open at the end of the day. */
  balances: Map<string, Decimal>;
}

interface History {
  plan: Plan;
  days: Map<string, Day>;
  /** Units of each token per native coin, by day. */
  rates: Map<string, Map<string, Decimal>>;
  /** The first day of each line: the native line's is the account's first day. */
  opened: Map<string, string>;
  /** The parent's payment that opened the account. */
  activation: Payment;
}

/** Something that happened on a day, before it is known whether the balances allow it. */
interface Event {
  seconds: number;
  /** The order of drawing, which breaks a tie of `seconds`. */
  seq: number;
  changes: Change[];
  /** A transaction the account sent; `fails` names the kind whose failure codes apply when it may fail. */
  sent?: { type: string; fails?: "Payment" | "OfferCreate" };
  payment?: Omit<Payment, "time">;
  trade?: Trade;
  /** Bypasses the reserve: the deletion takes the balance to 0. */
  final?: boolean;
}

const stream = (net: NetworkName, account: string, endpoint: string) => mulberry32(seedOf(net, account, endpoint));

/** An account made of 20 drawn bytes. */
const accountOf = (next: () => number): string => encodeAccountID(Uint8Array.from({ length: 20 }, () => Math.floor(next() * 256)));

/** The daily rates of the tokens, from the account's first day to T: a walk around the average rate, to 6 significant digits. */
function ratesOf(plan: Plan, T: string): Map<string, Map<string, Decimal>> {
  const next = stream(plan.net, plan.account, "stats/value");
  const rates = new Map<string, Map<string, Decimal>>();
  for (const key of [...plan.tokens.keys()].sort()) {
    const token = plan.tokens.get(key)!;
    let drift = 0;
    const byDay = new Map<string, Decimal>();
    for (const day of daysFrom(plan.first, T)) {
      drift = 0.95 * drift + 0.03 * (2 * next() - 1);
      byDay.set(day, new BN(token.rate * (1 + drift)).precision(6));
    }
    rates.set(key, byDay);
  }
  return rates;
}

/** The day each token line opened: a held token in the first 30% of the account's life, USD when the account began to trade it. */
function openingsOf(plan: Plan, T: string, usd: string): Map<string, string> {
  const next = stream(plan.net, plan.account, "analytics/balances");
  const span = daysFrom(plan.first, plan.last).length;
  const opened = new Map<string, string>([[plan.native, plan.first]]);
  for (const key of [...plan.tokens.keys()].sort()) {
    const day = key === usd ? addDays(T, -(plan.habits.usdDays - 1)) : addDays(plan.first, Math.floor(next() * span * 0.3));
    opened.set(key, day < plan.first ? plan.first : day);
  }
  return opened;
}

/** The window of a day's events, in seconds: after the account's creation on its first day, before 16:00 on T (both networks' last_validated close after 17:00), before the deletion on its day. */
function hoursOf(plan: Plan, day: string, T: string): { from: number; to: number } {
  const from = day === plan.first ? plan.firstSeconds + 600 : 600;
  const to = day === plan.last && plan.deletedAt !== null ? plan.deletedAt : day === T ? 16 * 3600 : 86_400;
  return { from, to: Math.max(from + 1, to) };
}

/** The history of a funded account, from its first day to T (spec 7.5). */
function historyOf(plan: Plan, T: string, usd: string): History {
  const { net, account, habits, native } = plan;
  const rates = ratesOf(plan, T);
  const opened = openingsOf(plan, T, usd);
  const days = daysFrom(plan.first, plan.last);
  const isOpen = (line: string, day: string) => opened.get(line)! <= day;
  const events = new Map<string, Event[]>(days.map((day) => [day, []]));
  let seq = 0;
  const at = (day: string, u: number) => {
    const { from, to } = hoursOf(plan, day, T);
    return from + Math.floor(u * (to - from));
  };
  const add = (day: string, event: Omit<Event, "seq">) => events.get(day)?.push({ ...event, seq: seq++ });
  const rateOf = (line: string, day: string): Decimal => rates.get(line)!.get(day)!;
  /** An amount of a line worth about `worth` native coins on `day`. */
  const amountOf = (line: string, day: string, worth: number): Decimal =>
    line === native ? dropsOf(worth) : unitsOf(worth * rateOf(line, day).toNumber(), plan.tokens.get(line)!.decimals);

  // Payments: the accounts first, so that a day added never changes them; then each day's, received and sent; then the account that settles the
  // first day's difference between the initial balance and what the history needs (drawn last, so that it moves no other draw).
  let settler = "";
  {
    const next = stream(net, account, "analytics/counterparties");
    const pool = Array.from({ length: habits.pool }, () => accountOf(next));
    const weights = pool.map((_, i) => 1 / (i + 1));
    const whole = weights.reduce((a, b) => a + b, 0);
    const pick = (u: number): string => {
      let left = u * whole;
      for (const [i, weight] of weights.entries()) if ((left -= weight) < 0) return pool[i]!;
      return pool[pool.length - 1]!;
    };
    for (const day of days) {
      for (const side of ["received", "sent"] as const) {
        const n = countOf(side === "received" ? habits.received : habits.sent, next);
        for (let i = 0; i < n; i++) {
          const [who, token, which, size, time] = [next(), next(), next(), next(), next()];
          const tokens = [...plan.tokens.keys()].sort().filter((line) => isOpen(line, day));
          const line = token < habits.tokenShare && tokens.length > 0 ? tokens[Math.floor(which * tokens.length)]! : native;
          const amount = amountOf(line, day, sizeOf(side === "received" ? habits.receivedSize : habits.sentSize, size));
          const counterparty = pick(who);
          add(day, {
            seconds: at(day, time),
            changes: [{ line, type: side === "received" ? "payment_destination" : "payment_source", amount: side === "received" ? amount : amount.negated() }],
            ...(side === "sent" && { sent: { type: "Payment", fails: "Payment" as const } }),
            payment: { counterparty, side, line, amount },
          });
        }
      }
    }
    settler = pick(next());
  }

  // Trades: each pair of the account (the tokens against the native currency, and the held tokens against USD), in the pair's stored order.
  {
    const next = stream(net, account, "analytics/exchanges");
    // A drawn USD issuer is the stream's first 20 draws (`analyticsFixtures`).
    if (NETWORKS[net].usd.issuer === null) accountOf(next);
    const lines = [...plan.tokens.keys()].sort();
    const pairs: Array<{ a: string; b: string; perDay: number }> = [
      ...lines.map((line) => ({ a: line, b: native as string, perDay: line === usd ? habits.usdTrades : habits.trades })),
      ...lines.filter((line) => line !== usd).map((line) => ({ a: line, b: usd, perDay: habits.crossTrades })),
    ];
    for (const day of days) {
      for (const { a, b, perDay } of pairs) {
        if (!isOpen(a, day) || !isOpen(b, day)) continue;
        const n = countOf(perDay, next);
        for (let i = 0; i < n; i++) {
          const [side, role, size, spread, time] = [next(), next(), next(), next(), next()];
          const [base, counter] = canonicalPair(assetOf(a), assetOf(b)).map(keyOf) as [string, string];
          const value = sizeOf(habits.tradeSize, size);
          const baseAmount = amountOf(base, day, value);
          const counterAmount = amountOf(counter, day, value * (1 + 0.02 * (2 * spread - 1)));
          const bought = side < 0.5;
          const taker = role < habits.taker;
          add(day, {
            seconds: at(day, time),
            changes: [
              { line: base, type: "exchange", amount: bought ? baseAmount : baseAmount.negated() },
              { line: counter, type: "exchange", amount: bought ? counterAmount.negated() : counterAmount },
            ],
            ...(taker && { sent: { type: "OfferCreate", fails: "OfferCreate" as const } }),
            trade: { base, counter, bought, baseAmount, counterAmount },
          });
        }
      }
    }
  }

  // What moves nothing but the fee.
  const chores = stream(net, account, "stats/transactions");
  {
    const names = Object.keys(NETWORKS[net].chores);
    const weights = names.map((name) => NETWORKS[net].chores[name]!);
    const whole = weights.reduce((a, b) => a + b, 0);
    for (const day of days) {
      const n = countOf(habits.chores, chores);
      for (let i = 0; i < n; i++) {
        let left = chores() * whole;
        const type = names.find((_, k) => (left -= weights[k]!) < 0) ?? names[names.length - 1]!;
        add(day, { seconds: at(day, chores()), changes: [], sent: { type } });
      }
    }
  }

  // Escrows (created, and finished by the account some days later), payments that rippled through a token line, rewards; and the deletion.
  const moves = stream(net, account, "analytics/balance_changes");
  {
    const lastBalance = plan.floor.plus(dropsOf(sizeOf(habits.lastBalance, moves())));
    for (const day of days) {
      const [escrow, ripple, reward] = [moves(), moves(), moves()];
      if (escrow < habits.escrows) {
        const [size, wait, time, later] = [moves(), moves(), moves(), moves()];
        const amount = dropsOf(sizeOf(3, size));
        add(day, { seconds: at(day, time), changes: [{ line: native, type: "escrow_create", amount: amount.negated() }], sent: { type: "EscrowCreate" } });
        const finish = addDays(day, 7 + Math.floor(wait * 24));
        if (finish <= plan.last) add(finish, { seconds: at(finish, later), changes: [{ line: native, type: "escrow_finish", amount }], sent: { type: "EscrowFinish" } });
      }
      if (ripple < habits.ripples) {
        const [which, size, time] = [moves(), moves(), moves()];
        const tokens = [...plan.tokens.keys()].sort().filter((line) => line !== usd && isOpen(line, day));
        if (tokens.length > 0) {
          const line = tokens[Math.floor(which * tokens.length)]!;
          const amount = amountOf(line, day, sizeOf(2, size));
          add(day, { seconds: at(day, time), changes: [{ line, type: "intermediary", amount }, { line, type: "intermediary", amount: amount.negated() }] });
        }
      }
      if (reward < habits.rewards) {
        const [size, time] = [moves(), moves()];
        add(day, { seconds: at(day, time), changes: [{ line: native, type: "", amount: dropsOf(sizeOf(0.6, size)) }], sent: { type: "ClaimReward" } });
      }
    }
    if (plan.deletedAt !== null) {
      // The deletion sends what is left to another account; the balance it had is drawn, and the day's other changes come before it.
      add(plan.last, { seconds: plan.deletedAt, changes: [{ line: native, type: "", amount: lastBalance.negated() }], sent: { type: "AccountDelete" }, final: true });
    }
  }

  // Backwards from the anchors: the balance before a change is the balance after it less the change.
  const balances = new Map(plan.ends);
  const record = new Map<string, Day>();
  const openLines = (day: string) => [...opened.entries()].filter(([, from]) => from <= day).map(([line]) => line);
  for (const day of daysFrom(addDays(plan.last, 1), T)) record.set(day, { changes: [], sent: [], payments: [], trades: [], balances: new Map(openLines(day).map((line) => [line, ZERO])) });

  const fee = (): Decimal => new BN(10 + Math.floor(moves() * moves() * 8)).shiftedBy(-6);
  for (const day of [...days].reverse()) {
    const today: Day = { changes: [], sent: [], payments: [], trades: [], balances: new Map(openLines(day).map((line) => [line, balances.get(line)!])) };
    record.set(day, today);
    const send = (type: string, result: string, cost: Decimal) => {
      today.sent.push({ type, result });
      today.changes.push({ line: native, type: "transaction_cost", amount: cost.negated() });
      balances.set(native, balances.get(native)!.plus(cost));
    };

    for (const event of events.get(day)!.sort((a, b) => b.seconds - a.seconds || b.seq - a.seq)) {
      const time = timeOf(day, event.seconds);
      let moved = true;
      let result = "tesSUCCESS";
      if (event.sent?.fails && chores() < habits.failed) {
        const codes = FAILURES[event.sent.fails];
        result = codes[1 + Math.floor(chores() * (codes.length - 1))]!;
        moved = false;
      }
      if (moved) {
        // The balances before it: the reserve on the native line (until the deletion), nothing below 0 on a token line.
        const before = new Map<string, Decimal>();
        for (const change of event.changes) before.set(change.line, (before.get(change.line) ?? balances.get(change.line)!).minus(change.amount));
        const possible = [...before].every(([line, balance]) => (line === native ? event.final || balance.gte(plan.floor) : balance.gte(0)));
        if (!possible) {
          if (!event.sent?.fails) continue;
          result = FAILURES[event.sent.fails][0]!;
          moved = false;
        }
      }
      if (moved) {
        for (const change of event.changes) {
          balances.set(change.line, balances.get(change.line)!.minus(change.amount));
          today.changes.push(change);
        }
        if (event.payment) today.payments.push({ ...event.payment, time });
        if (event.trade) today.trades.push(event.trade);
      }
      if (event.sent) send(event.sent.type, result, event.final ? plan.deletionFee : fee());
    }

    // What opened a line on its first day: a token's issuer paid it (after the account's TrustSet), and the parent paid the account its first coins.
    for (const line of [...plan.tokens.keys()].sort()) {
      if (opened.get(line) !== day) continue;
      const amount = balances.get(line)!;
      if (amount.gt(0)) {
        const { issuer } = assetOf(line);
        today.changes.push({ line, type: "payment_destination", amount });
        today.payments.push({ counterparty: issuer!, side: "received", line, amount, time: timeOf(day, hoursOf(plan, day, T).from - 300) });
        balances.set(line, ZERO);
      }
      send("TrustSet", "tesSUCCESS", fee());
    }
    if (day === plan.first) {
      // The parent paid the initial balance, and a payment right after it settled what the history needs beyond it, or less.
      const left = balances.get(native)!;
      const settled = timeOf(day, plan.firstSeconds + 60);
      if (left.gt(plan.initial)) {
        const amount = left.minus(plan.initial);
        today.changes.push({ line: native, type: "payment_destination", amount });
        today.payments.push({ counterparty: settler, side: "received", line: native, amount, time: settled });
        balances.set(native, plan.initial);
      } else if (left.lt(plan.initial)) {
        const cost = fee();
        const amount = plan.initial.minus(left).minus(cost);
        if (!amount.gt(0)) throw new Error(`analytics fixtures: ${account} cannot settle ${plan.initial.minus(left).toFixed()} with a payment that pays ${cost.toFixed()}`);
        today.changes.push({ line: native, type: "payment_source", amount: amount.negated() });
        today.payments.push({ counterparty: settler, side: "sent", line: native, amount, time: settled });
        balances.set(native, left.plus(amount));
        send("Payment", "tesSUCCESS", cost);
      }
      if (!balances.get(native)!.eq(plan.initial)) throw new Error(`analytics fixtures: ${account} does not open with its initial balance`);
      const activation: Payment = { counterparty: plan.parent, side: "received", line: native, amount: plan.initial, time: timeOf(day, plan.firstSeconds) };
      today.changes.push({ line: native, type: "payment_destination", amount: plan.initial });
      today.payments.push(activation);
      balances.set(native, ZERO);
      return { plan, days: record, rates, opened, activation };
    }
  }
  throw new Error(`analytics fixtures: ${account} has no first day`);
}

// ---- Values --------------------------------------------------------------------------------------------------------------

/** What an amount of a line is worth in native coins on a day (D2's `nativeValue`): itself, or the amount over the rate, to 17 significant digits. */
function valueOf(history: History, line: string, day: string, amount: Decimal): Decimal {
  if (line === history.plan.native) return amount;
  const rate = history.rates.get(line)?.get(day);
  if (!rate || !rate.gt(0)) return ZERO;
  return new BN(new Wide(amount).dividedBy(rate)).precision(QUOTIENT_DIGITS);
}

const sumOf = (values: Decimal[]): Decimal => values.reduce((sum, value) => sum.plus(value), ZERO);

/** The value of a key of a map, made and kept when the key has none yet. */
function entry<V>(map: Map<string, V>, key: string, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) map.set(key, (value = make()));
  return value;
}

// ---- The answers -------------------------------------------------------------------------------------------------------

/** The days of the window that have begun, oldest first. */
const daysOfWindow = (w: AnalyticsWindow) => daysFrom(w.start, w.T);
/** The last day of a bucket that has begun: its own last day, or T for the bucket that holds now. */
const lastDayOf = (bucket: string, w: AnalyticsWindow): string => {
  const end = addDays(nextBucket(bucket, w.unit), -1);
  return end < w.T ? end : w.T;
};
/** The answer's window: from the start of its first bucket to the start of the bucket after the one that holds now, exclusive. */
const spanOf = (w: AnalyticsWindow, unit: AnalyticsUnit) => ({ start: midnight(w.start), end: midnight(nextBucket(bucketOf(w.T, unit), unit)) });

function statsValue(history: History | null, w: AnalyticsWindow): Page<"rows", AccountValueRow> {
  const rows: AccountValueRow[] = [];
  if (history) {
    const from = bucketOf(history.plan.first, w.unit);
    for (const bucket of w.buckets.filter((b) => b >= from)) {
      const last = lastDayOf(bucket, w);
      const balances = history.days.get(last)!.balances;
      const value = sumOf([...balances].map(([line, balance]) => (balance.gt(0) ? valueOf(history, line, last, balance) : ZERO)));
      let count = 0;
      for (const day of daysFrom(bucket < history.plan.first ? history.plan.first : bucket, last)) {
        count += history.days.get(day)!.changes.filter((change) => change.type !== "transaction_cost").length;
      }
      rows.push({ date: midnight(bucket), account_value: text(value), balance_change_count: count });
    }
  }
  return { result: "success", count: rows.length, rows };
}

function statsTransactions(history: History | null, w: AnalyticsWindow): Page<"rows", AccountTxStatsRow> {
  const rows: AccountTxStatsRow[] = [];
  if (history) {
    for (const bucket of w.buckets) {
      const result: Record<string, number> = {};
      const type: Record<string, number> = {};
      let count = 0;
      for (const day of daysFrom(bucket, lastDayOf(bucket, w))) {
        for (const sent of history.days.get(day)?.sent ?? []) {
          result[sent.result] = (result[sent.result] ?? 0) + 1;
          type[sent.type] = (type[sent.type] ?? 0) + 1;
          count++;
        }
      }
      if (count > 0) rows.push({ date: midnight(bucket), transaction_count: count, result, type });
    }
  }
  return { result: "success", count: rows.length, rows };
}

function balanceChanges(history: History | null, w: AnalyticsWindow): AnalyticsBalanceChanges {
  type Sums = { count: number; in: Decimal; out: Decimal };
  const totals = new Map<string, Sums>();
  const buckets = new Map<string, Sums & { date: string; type: string }>();
  for (const day of history ? daysOfWindow(w) : []) {
    // A group is a day, a change type and an asset: its amounts are summed, then valued once (D2's `toBalanceChanges`).
    const groups = new Map<string, { type: string; line: string; n: number; in: Decimal; out: Decimal }>();
    for (const change of history!.days.get(day)?.changes ?? []) {
      const key = `${change.type}\u0000${change.line}`;
      const group = groups.get(key) ?? { type: change.type, line: change.line, n: 0, in: ZERO, out: ZERO };
      group.n += 1;
      if (change.amount.gt(0)) group.in = group.in.plus(change.amount);
      else group.out = group.out.minus(change.amount);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const [inValue, outValue] = [valueOf(history!, group.line, day, group.in), valueOf(history!, group.line, day, group.out)];
      const bucket = bucketOf(day, w.unit);
      const sums = [
        entry(totals, group.type, () => ({ count: 0, in: ZERO, out: ZERO })),
        entry(buckets, `${bucket}\u0000${group.type}`, () => ({ date: bucket, type: group.type, count: 0, in: ZERO, out: ZERO })),
      ];
      for (const s of sums) {
        s.count += group.n;
        s.in = s.in.plus(inValue);
        s.out = s.out.plus(outValue);
      }
    }
  }
  const typed = (type: string) => (type === "" ? {} : { change_type: type });
  const totalList: BalanceChangeTotal[] = [...totals]
    .sort(([a], [b]) => byType(a, b))
    .map(([type, s]) => ({ ...typed(type), count: s.count, in_value: text(s.in), out_value: text(s.out), net_value: text(s.in.minus(s.out)) }));
  const rows: BalanceChangeBucket[] = [...buckets.values()]
    .sort((a, b) => compare(a.date, b.date) || byType(a.type, b.type))
    .map((s) => ({ date: midnight(s.date), ...typed(s.type), count: s.count, in_value: text(s.in), out_value: text(s.out) }));
  return { result: "success", ...spanOf(w, w.unit), interval: w.unit, totals: totalList, count: rows.length, rows };
}

const LINES_LIMIT = 4;

function balancesAnswer(history: History | null, w: AnalyticsWindow): AnalyticsBalances {
  const lines: AnalyticsBalanceLine[] = [];
  const rows: AnalyticsBalanceRow[] = [];
  let total = 0;
  if (history) {
    const { native } = history.plan;
    const now = history.days.get(w.T)!.balances;
    // The native line first; then the lines with a rate by what they are worth, largest first; then the others by their size; ties by currency and counterparty.
    const ranked = [...now.keys()].sort((a, b) => {
      if (a === native || b === native) return a === native ? -1 : 1;
      const [rateA, rateB] = [history.rates.get(a)?.get(w.T), history.rates.get(b)?.get(w.T)];
      if (rateA && rateB) {
        const order = now.get(b)!.div(rateB).comparedTo(now.get(a)!.div(rateA));
        if (order !== 0) return order!;
      } else if (rateA || rateB) return rateA ? -1 : 1;
      else {
        const order = now.get(b)!.abs().comparedTo(now.get(a)!.abs());
        if (order !== 0) return order!;
      }
      return compare(a, b);
    });
    total = ranked.length;
    const served = ranked.slice(0, LINES_LIMIT);
    for (const line of served) {
      const { currency, issuer } = assetOf(line);
      lines.push({ currency, ...(issuer !== undefined && { counterparty: issuer }), balance: text(now.get(line)!) });
    }
    for (const bucket of w.buckets) {
      for (const line of served) {
        // A line has a row from the bucket of its first change on.
        if (bucketOf(history.opened.get(line)!, w.unit) > bucket) continue;
        const { currency, issuer } = assetOf(line);
        const balance = history.days.get(lastDayOf(bucket, w))!.balances.get(line)!;
        rows.push({ date: midnight(bucket), currency, ...(issuer !== undefined && { counterparty: issuer }), balance: text(balance) });
      }
    }
  }
  return { result: "success", ...spanOf(w, w.unit), interval: w.unit, lines_total: total, lines, count: rows.length, rows };
}

const TOP = 6;

function counterpartiesAnswer(history: History | null, w: AnalyticsWindow): AnalyticsCounterparties {
  const parties = new Map<string, { sent: Decimal; received: Decimal; payments_sent: number; payments_received: number; first: string; last: string }>();
  for (const day of history ? daysOfWindow(w) : []) {
    // A group is a counterparty, a side, an asset and a day: its delivered amounts are summed, then valued once (D2's `toCounterparties`).
    const groups = new Map<string, { counterparty: string; side: Payment["side"]; line: string; amount: Decimal }>();
    for (const payment of history!.days.get(day)?.payments ?? []) {
      const key = `${payment.counterparty}\u0000${payment.side}\u0000${payment.line}`;
      const group = groups.get(key) ?? { counterparty: payment.counterparty, side: payment.side, line: payment.line, amount: ZERO };
      group.amount = group.amount.plus(payment.amount);
      groups.set(key, group);
      const party = parties.get(payment.counterparty) ?? { sent: ZERO, received: ZERO, payments_sent: 0, payments_received: 0, first: payment.time, last: payment.time };
      if (payment.side === "sent") party.payments_sent += 1;
      else party.payments_received += 1;
      if (payment.time < party.first) party.first = payment.time;
      if (payment.time > party.last) party.last = payment.time;
      parties.set(payment.counterparty, party);
    }
    for (const group of groups.values()) {
      const party = parties.get(group.counterparty)!;
      const value = valueOf(history!, group.line, day, group.amount);
      if (group.side === "sent") party.sent = party.sent.plus(value);
      else party.received = party.received.plus(value);
    }
  }
  const counterparties: AnalyticsCounterparty[] = [...parties]
    .map(([account, p]) => ({ account, p, total: p.sent.plus(p.received) }))
    .sort((a, b) => b.total.comparedTo(a.total)! || compare(a.account, b.account))
    .slice(0, TOP)
    .map(({ account, p, total }) => ({
      account,
      sent_value: text(p.sent),
      received_value: text(p.received),
      total_value: text(total),
      payments_sent: p.payments_sent,
      payments_received: p.payments_received,
      first: p.first,
      last: p.last,
    }));
  return { result: "success", ...spanOf(w, "day"), sort: "value", total: parties.size, count: counterparties.length, counterparties };
}

function exchangesAnswer(history: History | null, w: AnalyticsWindow): AnalyticsExchanges {
  type Sums = { base: string; counter: string; count: number; baseVolume: Decimal; counterVolume: Decimal; bought: Decimal; sold: Decimal; boughtCounter: Decimal; soldCounter: Decimal; native?: Decimal };
  const pairs = new Map<string, Sums>();
  for (const day of history ? daysOfWindow(w) : []) {
    const today = new Map<string, { base: Decimal; counter: Decimal }>();
    for (const trade of history!.days.get(day)?.trades ?? []) {
      const key = `${trade.base}\u0000${trade.counter}`;
      const pair = pairs.get(key) ?? { base: trade.base, counter: trade.counter, count: 0, baseVolume: ZERO, counterVolume: ZERO, bought: ZERO, sold: ZERO, boughtCounter: ZERO, soldCounter: ZERO };
      pair.count += 1;
      pair.baseVolume = pair.baseVolume.plus(trade.baseAmount);
      pair.counterVolume = pair.counterVolume.plus(trade.counterAmount);
      if (trade.bought) {
        pair.bought = pair.bought.plus(trade.baseAmount);
        pair.boughtCounter = pair.boughtCounter.plus(trade.counterAmount);
      } else {
        pair.sold = pair.sold.plus(trade.baseAmount);
        pair.soldCounter = pair.soldCounter.plus(trade.counterAmount);
      }
      pairs.set(key, pair);
      const volumes = today.get(key) ?? { base: ZERO, counter: ZERO };
      today.set(key, { base: volumes.base.plus(trade.baseAmount), counter: volumes.counter.plus(trade.counterAmount) });
    }
    // The native volume of a day: the native side's volume, else the base's (or the counter's) over its rate of the day (D2's `nativeVolumeOf`).
    const { native } = history!.plan;
    for (const [key, volumes] of today) {
      const pair = pairs.get(key)!;
      const rated = (line: string) => history!.rates.get(line)?.get(day)?.gt(0) === true;
      const value =
        pair.base === native
          ? volumes.base
          : pair.counter === native
            ? volumes.counter
            : rated(pair.base)
              ? valueOf(history!, pair.base, day, volumes.base)
              : rated(pair.counter)
                ? valueOf(history!, pair.counter, day, volumes.counter)
                : undefined;
      if (value !== undefined) pair.native = (pair.native ?? ZERO).plus(value);
    }
  }
  const pairKey = (p: Sums) => [assetOf(p.base).currency, assetOf(p.base).issuer ?? "", assetOf(p.counter).currency, assetOf(p.counter).issuer ?? ""].join("\u0000");
  const sorted = [...pairs.values()].sort((a, b) => {
    if (a.native !== undefined && b.native !== undefined) return b.native.comparedTo(a.native)! || compare(pairKey(a), pairKey(b));
    if (a.native !== undefined || b.native !== undefined) return a.native === undefined ? 1 : -1;
    return b.count - a.count || compare(pairKey(a), pairKey(b));
  });
  const served: AnalyticsPair[] = sorted.slice(0, TOP).map((p) => {
    const [base, counter] = [assetOf(p.base), assetOf(p.counter)];
    return {
      base_currency: base.currency,
      ...(base.issuer !== undefined && { base_issuer: base.issuer }),
      counter_currency: counter.currency,
      ...(counter.issuer !== undefined && { counter_issuer: counter.issuer }),
      count: p.count,
      base_volume: text(p.baseVolume),
      counter_volume: text(p.counterVolume),
      bought: text(p.bought),
      sold: text(p.sold),
      bought_counter: text(p.boughtCounter),
      sold_counter: text(p.soldCounter),
      ...(p.native !== undefined && { native_volume: text(p.native) }),
    };
  });
  return { result: "success", ...spanOf(w, "day"), total: pairs.size, count: served.length, pairs: served };
}

// ---- The files -----------------------------------------------------------------------------------------------------------

/** The three accounts of a network with their histories (`null` for the never-funded address). */
function historiesOf(net: NetworkName, T: string): Array<{ account: string; history: History | null }> {
  const { active, deleted, unfunded } = ACCOUNTS[net];
  // Xahau's USD issuer is the first thing the active account's stream of trades draws.
  const usdIssuer = NETWORKS[net].usd.issuer ?? accountOf(stream(net, active, "analytics/exchanges"));
  const usd = keyOf({ currency: "USD", issuer: usdIssuer });
  return [
    { account: active, history: historyOf(planOf(net, active, "active", T, usdIssuer), T, usd) },
    { account: deleted, history: historyOf(planOf(net, deleted, "deleted", T, usdIssuer), T, usd) },
    { account: unfunded, history: null },
  ];
}

/**
 * The payment that opened each funded account of a network: its creation's `parent` paid it the creation's `initial_balance` at its `inception`. The
 * counterparties answers hold it among the parent's payments; this is it alone, for test/unit/analytics-fixtures.test.ts.
 */
export function analyticsOpenings(net: NetworkName, T: string): Array<{ account: string; counterparty: string; amount: string; time: string }> {
  return historiesOf(net, T).flatMap(({ account, history }) =>
    history ? [{ account, counterparty: history.activation.counterparty, amount: text(history.activation.amount), time: history.activation.time }] : [],
  );
}

/**
 * Every analytics answer of a network: for the active, the deleted and the never-funded account, the six calls of spec 2.3 for each period, with the window
 * `analyticsWindow` gives for T (All from the month of the account's `inception`, or T's month without a creation). `T` is the UTC day of the recorded
 * `last_validated`.
 */
export function analyticsFixtures(net: NetworkName, T: string): AnalyticsFile[] {
  const files: AnalyticsFile[] = [];
  for (const { account, history } of historiesOf(net, T)) {
    const first = history ? { day: history.plan.first, from: "activation" as const } : null;
    for (const period of ANALYTICS_PERIODS) {
      const w = analyticsWindow(period, T, first);
      const [u, S] = [w.unit, w.start];
      files.push(
        { path: `/v2/accounts/${account}/stats/value`, query: `interval=${u}&limit=1000&start=${S}`, body: statsValue(history, w) },
        { path: `/v2/accounts/${account}/stats/transactions`, query: `interval=${u}&limit=1000&start=${S}`, body: statsTransactions(history, w) },
        { path: `/v2/accounts/${account}/analytics/balance_changes`, query: `interval=${u}&start=${S}`, body: balanceChanges(history, w) },
        { path: `/v2/accounts/${account}/analytics/counterparties`, query: `limit=6&start=${S}`, body: counterpartiesAnswer(history, w) },
        { path: `/v2/accounts/${account}/analytics/balances`, query: `interval=${u}&limit=4&start=${S}`, body: balancesAnswer(history, w) },
        { path: `/v2/accounts/${account}/analytics/exchanges`, query: `limit=6&start=${S}`, body: exchangesAnswer(history, w) },
      );
    }
  }
  const seen = new Set<string>();
  for (const { path, query } of files) {
    if (seen.has(`${path}?${query}`)) throw new Error(`analytics fixtures: ${path}?${query} is generated twice`);
    seen.add(`${path}?${query}`);
  }
  return files;
}
