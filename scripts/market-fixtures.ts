// The data API's answers for the markets pages (E3): for each pair the pages show, its trades (a page at a time, newest first), its candles of the five
// intervals, its 24-hour row and its active accounts (the data API calls of spec 3.3 for the default view); and for each network the markets table
// (`/v2/network/markets`) of the three periods. http-fixtures.ts calls `marketFixtures` from `generate()`, so `pnpm fixtures:sync` writes the files, and
// test/fixtures/PROVENANCE.md ("Synthetic aggregates", "Derived trades and pool states") says what they are made of and follow.
//
// Two kinds of trades go in, and every figure is made of them by the reference's rules (market-aggregates.ts):
//
//   derived     the XRPL trades worked out from the recorded ledgers (`derivedExchanges`, scripts/derived-trades.ts): XRP/RLUSD and LIONS/XRP in both
//               orientations (the other one by `invertedExchange`, which inverts the rate the trade stored), and every recorded pair in the markets table
//   synthetic   drawn from `mulberry32(seedOf(net, endpoint))` (scripts/synthetic.ts): the trades of Xahau's EVR/XAH (`exchanges/EVR+r…/XAH`), and the
//               seeded pairs of the markets tables (`network/markets`), with issuers that ripple-address-codec encodes from seeded bytes
//
// Only integer arithmetic and the four operations of IEEE doubles go into the draws (synthetic.ts), so every Node writes the same bytes.

import { encodeAccountID } from "ripple-address-codec";

import { apiAssetText, canonicalPair, sameAsset, type Asset, type NativeCode } from "../app/domain/asset";
import { candleWindow, dayWindowStart, INTERVALS, type Interval } from "../app/domain/market-params";
import type { AmmFilter, PairExchange } from "../app/server/api-types";
import { dataApiFile, type NetworkName } from "../test/support/upstream-core";
import { derivedExchanges, invertedExchange } from "./derived-trades";
import { fixtureText, isoTime, readLedgers, unixOf } from "./http-fixtures";
import {
  activeAccountsOf,
  assetKey,
  baseOf,
  candlesOf,
  compareKey,
  counterOf,
  DAY,
  fillOf,
  HOUR,
  listPages,
  marketsAnswer,
  MARKETS_LIMIT,
  PERIOD_HOURS,
  plainText,
  reducedOf,
  rowKey,
  takes,
  byKey,
  type Exact,
  type Fill,
  type Filter,
  type MarketPair,
  type MarketsPeriod,
} from "./market-aggregates";
import { mulberry32, seedOf } from "./synthetic";

// ---- A pair's files ---------------------------------------------------------------------------------------------------

/** What the pair page asks of one orientation of a pair (spec 3.3), beyond the calls without a filter. */
interface PairCalls {
  /** The Trades filters whose lists and candles are asked for. */
  filters: AmmFilter[];
  /** The filters of the 24-hour row (#9 is `only`, the AMM share of the volume). */
  reduces: AmmFilter[];
  /** #10, the one-row probe of whether the pair has any trade. */
  probe: boolean;
}

interface FileOut {
  path: string;
  query: string;
  value: unknown;
  rowLists: readonly string[];
}

/** The rows of a pair's files that are one line each: the trades, the candles and the reduced row, the accounts. */
const PAIR_ROW_LISTS = ["exchanges", "accounts"] as const;
/** The trades of a page of the pair page, and the candles it asks for (`CANDLE_COUNT` and one more). */
const TRADES_PAGE = 20;
const CANDLE_LIMIT = 61;

/** A query as data-api.ts writes it: in its order, `amm` last, what is left out not there. */
const queryOf = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

/** Every file of one orientation of a pair: `rows` its trades as served in that orientation, oldest first. */
function pairFiles(net: NetworkName, native: string, base: Asset, counter: Asset, rows: readonly PairExchange[], exact: boolean, now: number, calls: PairCalls): FileOut[] {
  const path = `/v2/exchanges/${apiAssetText(base)}/${apiAssetText(counter)}`;
  const files: FileOut[] = [];
  const out = (where: string, query: string, value: unknown) => files.push({ path: where, query, value, rowLists: PAIR_ROW_LISTS });
  const fillsOf = (filter: Filter) => rows.map((row) => fillOf(row, native, exact)).filter(takes(filter));
  const rowsOf = (filter: Filter) => rows.filter(takes(filter));

  for (const filter of [undefined, ...calls.filters]) {
    for (const { marker, page } of listPages(rowsOf(filter), TRADES_PAGE)) {
      out(path, queryOf({ descending: "true", limit: TRADES_PAGE, marker, amm: filter }), page);
    }
    for (const interval of Object.keys(INTERVALS) as Interval[]) {
      const { start } = candleWindow(now, interval);
      out(path, queryOf({ interval: INTERVALS[interval].api, start, limit: CANDLE_LIMIT, amm: filter }), candlesOf(fillsOf(filter), interval, start, base, counter, CANDLE_LIMIT));
    }
  }
  const dayStart = dayWindowStart(now);
  for (const filter of [undefined, ...calls.reduces]) out(path, queryOf({ reduce: "true", start: dayStart, amm: filter }), reducedOf(fillsOf(filter), dayStart, base, counter));
  out(`/v2/active_accounts/${apiAssetText(base)}/${apiAssetText(counter)}`, "", activeAccountsOf(rows, now));
  if (calls.probe) out(path, queryOf({ descending: "true", limit: 1 }), listPages(rows, 1)[0]!.page);
  return files;
}

// ---- Synthetic trades ------------------------------------------------------------------------------------------------

/** What each network looks like to the generator. */
interface Profile {
  native: NativeCode;
  /** How many seeded pairs of each tier: busy enough to be listed in the 24 hours, in 7 days, in 30 days, and traded but never listed. */
  tiers: Record<Tier, number>;
  /** Whether the network has AMM pools. */
  amm: boolean;
}

type Tier = "day" | "week" | "month" | "thin";

const PROFILES: Record<NetworkName, Profile> = {
  xrpl: { native: "XRP", tiers: { day: 40, week: 42, month: 75, thin: 30 }, amm: true },
  xahau: { native: "XAH", tiers: { day: 10, week: 12, month: 18, thin: 8 }, amm: false },
};

/**
 * The trades a day of each tier has (the draws make it 75% to 125% of a number drawn from the range, a fraction being a chance of one more), the size of
 * a trade in native coins (10% to 200% of a size drawn from the range, small ones more often), and the chance that a pair of the tier has a pool.
 */
const TIERS: Record<Tier, { perDay: [number, number]; size: [number, number]; pool: number }> = {
  day: { perDay: [12, 32], size: [150, 4000], pool: 0.6 },
  week: { perDay: [2.2, 6], size: [40, 1500], pool: 0.4 },
  month: { perDay: [0.5, 1.1], size: [15, 600], pool: 0.25 },
  thin: { perDay: [0.04, 0.22], size: [5, 200], pool: 0.1 },
};

/**
 * The codes of the drawn tokens: 3-character ones, and text ones the ledger holds as 40 hex digits. None is the code of a pair of the recordings (XRPL's
 * derived pairs: RLUSD, LIONS, USD, EUR, … in any case) or of Xahau's EVR/XAH, so no seeded row passes for one of the pages' pairs
 * (test/unit/market-generated.test.ts); the special pairs below take USD and EUR, which the tests need, with issuers of their own.
 */
const CODES = [
  "GBP", "JPY", "CNY", "BTC", "ETH", "CHF", "AUD", "CAD", "KRW", "SGD", "MXN", "BRL", "NZD", "SEK", "NOK", "HKD", "INR", "XAU", "XAG", "ELS",
  "XLM", "LTC", "SOL", "ADA", "DOT", "VGB", "MAG", "OVO", "LOX", "ZEN", "SOLO", "XRdoge", "PHNIX", "USDT", "EURQ", "POWDER", "SEAL", "BUSD",
  "XSPEC", "MOON", "GALA", "NOVA", "ORBIT", "KOALA", "LUNA", "ZEST", "PIXEL", "RAVEN", "TIDE", "QUILL", "EMBER", "FROST", "CEDAR", "AMBER",
  "COPPER", "LYNX", "OTTER", "sats", "Gecko", "TURBO", "MANGO", "ORCA", "PRISM", "VOLT", "ZINC", "ROVER", "BRAVO", "DELTA", "OPAL",
];

/** A text code as the ledger holds it: its bytes, left-aligned and zero-padded, 40 hex digits in upper case. */
function heldCode(code: string): string {
  if (code.length === 3) return code;
  let hex = "";
  for (let at = 0; at < code.length; at++) hex += code.charCodeAt(at).toString(16).padStart(2, "0");
  return hex.toUpperCase().padEnd(40, "0");
}

/** A seeded asset: what it is worth in native coins, and the decimals of its amounts. */
interface Seeded {
  asset: Asset;
  value: number;
  decimals: number;
}

const decimalsOf = (value: number): number => (value >= 100 ? 8 : value >= 0.01 ? 6 : value >= 1e-4 ? 4 : 2);

/** A pair of the seeded universe before its trades: its two assets as drawn (not yet in the stored order) and its tier. */
interface Spec {
  a: Seeded;
  b: Seeded;
  tier: Tier;
}

/** A round decimal of `units` of 10^-`decimals`. */
const unitsText = (units: number, decimals: number): Exact => {
  if (!Number.isSafeInteger(units) || units < 1) throw new Error(`${units}: not a positive whole number of units`);
  return { units: BigInt(units), scale: decimals };
};

/**
 * A rate as a synthetic trade stores it: the 8 significant digits of a drawn number, which `precision8` serves as they are (`toPrecision` of a number writes
 * the exponent form where BigNumber's does: below 1e-6 and from 1e8).
 */
const rateText = (value: number): string => value.toPrecision(8);

class Draws {
  readonly next: () => number;
  constructor(net: NetworkName, endpoint: string) {
    this.next = mulberry32(seedOf(net, endpoint));
  }
  /** A number in [low, high). */
  between(low: number, high: number): number {
    return low + (high - low) * this.next();
  }
  /** A whole number in [0, n). */
  below(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** A classic address of 20 seeded bytes. */
  account(): string {
    return encodeAccountID(Uint8Array.from({ length: 20 }, () => this.below(256)));
  }
  /** Of a number of trades a day drawn from the range, the trades of one day: 75% to 125% of it, and a fraction a chance of one more. */
  trades(perDay: number, part: number): number {
    return Math.floor(perDay * part * (0.75 + 0.5 * this.next()) + this.next());
  }
}

/**
 * The seeded pairs of a network's markets tables and their trades, from `seedOf(net, "network/markets")`. Every pair is drawn first (its assets, the
 * value of each in native coins, its tier and pool), then the trades of each pair day by day, from the day before the 30-day window to T, so adding a
 * pair at the end changes no other. Some pairs are there on purpose: an asset with a lower-case standard code, EUR/USD and USD/USD (two issuers) beside
 * the native pairs of their assets, a pair of two assets that have no native pair (no native volume), an asset worth less than a millionth of a native
 * coin (prices in exponent form), and one whose code sorts after the native currency's (stored with the native currency as base).
 */
function seededPairs(net: NetworkName, profile: Profile, now: number): MarketPair[] {
  const draws = new Draws(net, "network/markets");
  const native: Seeded = { asset: { currency: profile.native }, value: 1, decimals: 6 };
  const usdValue = net === "xrpl" ? 1 / 2.4 : 1 / 0.04;
  const seeded = (code: string, value: number): Seeded => ({ asset: { currency: heldCode(code), issuer: draws.account() }, value, decimals: decimalsOf(value) });
  const token = (): Seeded => {
    // Any code but the native one's, which an issued currency may have but which the table would show as the native currency's.
    let code = CODES[draws.below(CODES.length)]!;
    while (code === profile.native) code = CODES[draws.below(CODES.length)]!;
    // A token is worth 1e-5 to 11 native coins, spread evenly over the powers of ten (a product of draws, no fractional power).
    let value = 1e-5;
    for (let steps = draws.below(14); steps > 0; steps--) value *= 2.7;
    return seeded(code, value * draws.between(1, 2.7));
  };

  // The special pairs, then the drawn ones of each tier.
  const eur = seeded("EUR", usdValue * 1.09);
  const usdA = seeded("USD", usdValue);
  const usdB = seeded("USD", usdValue * draws.between(0.995, 1.005));
  const lower = seeded("usd", usdValue * draws.between(0.6, 0.9));
  const gold = seeded("XAU", usdValue * 2650);
  const silver = seeded("XAG", usdValue * 31);
  const junk = seeded("MEMEX", 3.2e-7 * draws.between(0.8, 1.2));
  const late = seeded("ZAR", usdValue / 18);
  const specs: Spec[] = [
    { a: lower, b: native, tier: "day" },
    { a: eur, b: native, tier: "day" },
    { a: usdA, b: native, tier: "day" },
    { a: eur, b: usdA, tier: "day" },
    { a: usdA, b: usdB, tier: "day" },
    { a: gold, b: silver, tier: "day" },
    { a: usdB, b: native, tier: "week" },
    { a: junk, b: native, tier: "week" },
    { a: late, b: native, tier: "week" },
  ];
  const special: Record<Tier, number> = { day: 0, week: 0, month: 0, thin: 0 };
  for (const spec of specs) special[spec.tier]++;
  for (const tier of ["day", "week", "month", "thin"] as const) {
    for (let at = special[tier]; at < profile.tiers[tier]; at++) {
      // One in ten drawn pairs is between two tokens; the rest are against the native currency.
      const a = token();
      specs.push({ a, b: draws.next() < 0.1 ? token() : native, tier });
    }
  }

  const today = Math.floor(now / DAY) * DAY;
  const first = Math.floor((Math.floor(now / HOUR) * HOUR - PERIOD_HOURS["30day"] * HOUR) / DAY) * DAY - DAY;
  const pairs: MarketPair[] = [];
  // The profile of each pair, drawn before any trade.
  const drawn = specs.map((spec) => {
    const tier = TIERS[spec.tier];
    const pool = profile.amm && draws.next() < tier.pool;
    return {
      spec,
      perDay: draws.between(...tier.perDay),
      size: draws.between(...tier.size),
      pool,
      // Some pools see no swap in a month: a pair with a pool and a share of 0.
      swaps: pool && draws.next() < 0.85 ? draws.between(0.05, 0.8) : 0,
    };
  });
  for (const { spec, perDay, size, pool, swaps } of drawn) {
    const [base, counter] = sameAsset(canonicalPair(spec.a.asset, spec.b.asset)[0], spec.a.asset) ? [spec.a, spec.b] : [spec.b, spec.a];
    const fills: Fill[] = [];
    let mid = base.value / counter.value;
    let sequence = 0;
    for (let day = first; day <= today; day += DAY) {
      mid *= 0.97 + 0.06 * draws.next();
      const length = day === today ? now - day : DAY;
      const times = Array.from({ length: draws.trades(perDay, length / DAY) }, () => day + draws.below(length + (day === today ? 1 : 0))).sort((x, y) => x - y);
      for (const time of times) {
        const rate = rateText(mid * (0.996 + 0.008 * draws.next()));
        const coins = size * (0.1 + 1.9 * draws.next() * draws.next());
        const baseUnits = Math.max(1, Math.round((coins / base.value) * 10 ** base.decimals));
        const baseAmount = unitsText(baseUnits, base.decimals);
        const counterUnits = Math.max(1, Math.round((baseUnits / 10 ** base.decimals) * Number(rate) * 10 ** counter.decimals));
        const amm = swaps > 0 && draws.next() < swaps;
        fills.push({
          key: [time, sequence++, 0],
          time,
          rate,
          value: Number(rate),
          base: baseAmount,
          counter: unitsText(counterUnits, counter.decimals),
          amm,
          kept: true,
          bought: draws.next() < 0.5,
          exact: true,
        });
      }
    }
    pairs.push({ base: base.asset, counter: counter.asset, fills, pool });
  }
  return pairs;
}

/**
 * The trades of Xahau's EVR/XAH, from `seedOf("xahau", "exchanges/EVR+r…/XAH")`: from the first week of the weekly candles to T, busier the nearer to T
 * (16 a day in the last two days, 5 in the eight before, 1 in the fifty before those, and one in eight days before that), at the ledgers of the Xahau
 * chain (one every 4 s back from the newest recorded ledger), among 24 seeded accounts, the taker never the provider. The third newest has an XAH leg of
 * 0.0004 (dust: in the list and the active accounts, in no aggregate).
 */
/** Seconds between Xahau ledgers, for the ledger of a synthetic EVR/XAH trade. */
const XAHAU_LEDGER_SECONDS = 4;

function evrTrades(newest: number, now: number): PairExchange[] {
  const draws = new Draws("xahau", `exchanges/${apiAssetText(EVR)}/XAH`);
  const accounts = Array.from({ length: 24 }, () => draws.account());
  const someone = () => accounts[draws.below(accounts.length)]!;
  const firstDay = Date.parse(candleWindow(now, "1w").start) / 1000;
  const today = Math.floor(now / DAY) * DAY;
  const seconds = XAHAU_LEDGER_SECONDS;
  const taken = new Set<string>();
  const rows: PairExchange[] = [];
  let mid = 3.5;
  for (let day = firstDay; day <= today; day += DAY) {
    mid *= 0.985 + 0.03 * draws.next();
    const age = (today - day) / DAY;
    const perDay = age <= 1 ? 16 : age <= 9 ? 5 : age <= 59 ? 1 : 0.125;
    const length = day === today ? now - day : DAY;
    for (let n = draws.trades(perDay, length / DAY); n > 0; n--) {
      const time = day + draws.below(length);
      const ledger = newest - Math.round((now - time) / seconds);
      let [tx, node] = [draws.below(40), 1 + draws.below(12)];
      while (taken.has(`${ledger}/${tx}/${node}`)) node++;
      taken.add(`${ledger}/${tx}/${node}`);
      const rate = rateText(mid * (0.99 + 0.02 * draws.next()));
      const evr = Math.max(1, Math.round((5 + 900 * draws.next() * draws.next()) * 1e6));
      const xah = Math.max(1, Math.round((evr / 1e6) * Number(rate) * 1e6));
      // The taker is another account than the provider: a redraw from the same stream until it is.
      const provider = someone();
      let taker = someone();
      while (taker === provider) taker = someone();
      const takerBuys = draws.next() < 0.5;
      const payment = draws.next() < 0.15;
      rows.push({
        base_amount: plainText({ units: BigInt(evr), scale: 6 }),
        counter_amount: plainText({ units: BigInt(xah), scale: 6 }),
        node_index: node,
        rate,
        tx_index: tx,
        buyer: takerBuys ? taker : provider,
        executed_time: isoTime(now - Math.round((newest - ledger) * seconds)),
        ledger_index: ledger,
        offer_sequence: 1 + draws.below(9_000_000),
        provider,
        seller: takerBuys ? provider : taker,
        taker,
        tx_hash: Array.from({ length: 32 }, () => draws.below(256).toString(16).padStart(2, "0")).join("").toUpperCase(),
        tx_type: payment ? "Payment" : "OfferCreate",
        base_currency: EVR.currency,
        base_issuer: EVR.issuer,
        counter_currency: "XAH",
      });
    }
  }
  rows.sort((a, b) => compareKey(rowKey(a), rowKey(b)));
  const dust = rows.at(-3);
  if (dust === undefined || Date.parse(dust.executed_time) / 1000 < Date.parse(candleWindow(now, "15m").start) / 1000) {
    throw new Error("EVR/XAH: no trade in the window of the 15-minute candles to make the dust one");
  }
  dust.base_amount = "0.000114";
  dust.counter_amount = "0.0004";
  return rows;
}

// ---- The files -------------------------------------------------------------------------------------------------------

const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const LIONS: Asset = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };

/** The pairs of the pair page's fixtures, each in both orientations on XRPL; what the natural orientation of XRP/RLUSD asks beyond the default view. */
const XRPL_PAIRS: Array<{ base: Asset; counter: Asset; calls: PairCalls }> = [
  { base: { currency: "XRP" }, counter: RLUSD, calls: { filters: ["exclude", "only"], reduces: ["exclude", "only"], probe: true } },
  { base: RLUSD, counter: { currency: "XRP" }, calls: { filters: [], reduces: ["only"], probe: false } },
  { base: LIONS, counter: { currency: "XRP" }, calls: { filters: [], reduces: ["only"], probe: false } },
  { base: { currency: "XRP" }, counter: LIONS, calls: { filters: [], reduces: ["only"], probe: false } },
];

/** The stored pair a row is of: its base and counter as the API stores them. */
const storedKey = (row: PairExchange): string => `${assetKey(baseOf(row))}/${assetKey(counterOf(row))}`;

/** A network's trades as the generator has them. */
interface Universe {
  /** T: the close time of the newest recorded ledger, unix seconds. */
  now: number;
  native: NativeCode;
  /** The pair page's pairs, each orientation with its trades as served in it (oldest first), whether their rates are the stored ones, and what is asked. */
  pages: Array<{ base: Asset; counter: Asset; rows: PairExchange[]; exact: boolean; calls: PairCalls }>;
  /** The pairs of the markets tables that the pages' trades are of: every derived pair on XRPL, EVR/XAH on Xahau. */
  recorded: MarketPair[];
  /** The seeded pairs of the markets tables. */
  seeded: MarketPair[];
}

function universeOf(net: NetworkName): Universe {
  const ledgers = readLedgers(net);
  const head = ledgers.at(-1)!;
  const now = unixOf(head.ledger.close_time);
  const profile = PROFILES[net];
  const native = profile.native;
  const pages: Universe["pages"] = [];
  const recorded: MarketPair[] = [];

  if (net === "xrpl") {
    // The derived trades, by the pair they are stored under: the pair page's pairs, and the recorded pairs of the markets table.
    const byStored = new Map<string, PairExchange[]>();
    for (const row of derivedExchanges(ledgers)) byStored.set(storedKey(row), [...(byStored.get(storedKey(row)) ?? []), row]);
    for (const { base, counter, calls } of XRPL_PAIRS) {
      const [first, second] = canonicalPair(base, counter);
      const stored = byStored.get(`${assetKey(first)}/${assetKey(second)}`) ?? [];
      if (stored.length === 0) throw new Error(`no derived trade of ${apiAssetText(first)}/${apiAssetText(second)}`);
      // `invertedExchange` takes the derived rows themselves: it inverts the rate each stored, which its 8 digits do not give back.
      pages.push({ base, counter, rows: sameAsset(first, base) ? stored : stored.map(invertedExchange), exact: false, calls });
    }
    for (const rows of byStored.values()) {
      const fills = rows.map((row) => fillOf(row, native, false)).sort(byKey);
      recorded.push({ base: baseOf(rows[0]!), counter: counterOf(rows[0]!), fills, pool: fills.some((fill) => fill.amm) });
    }
  } else {
    const rows = evrTrades(Number(head.ledger.ledger_index), now);
    pages.push({ base: EVR, counter: { currency: native }, rows, exact: true, calls: { filters: [], reduces: [], probe: false } });
    recorded.push({ base: EVR, counter: { currency: native }, fills: rows.map((row) => fillOf(row, native, true)), pool: false });
  }
  return { now, native, pages, recorded, seeded: seededPairs(net, profile, now) };
}

/**
 * The pairs a network's markets tables are made of, with their trades (stored orientation, oldest first): what `marketsAnswer` is given. The tests recompute
 * the tables' figures from them.
 */
export function marketPairs(net: NetworkName): Pick<Universe, "now" | "recorded" | "seeded"> {
  const { now, recorded, seeded } = universeOf(net);
  return { now, recorded, seeded };
}

/** Every file of the markets pages' fixtures: path below test/fixtures/http/ and text. */
export function marketFixtures(): Map<string, string> {
  const files = new Map<string, string>();
  const put = (net: NetworkName, file: FileOut) => {
    const path = dataApiFile(net, file.path, file.query);
    if (path === undefined) throw new Error(`no fixture file for ${file.path}?${file.query}`);
    if (files.has(path)) throw new Error(`${path} is written twice`);
    files.set(path, fixtureText(file.value, file.rowLists));
  };
  const periods: MarketsPeriod[] = ["day", "7day", "30day"];

  for (const net of ["xrpl", "xahau"] as const) {
    const { now, native, pages, recorded, seeded } = universeOf(net);
    for (const { base, counter, rows, exact, calls } of pages) for (const file of pairFiles(net, native, base, counter, rows, exact, now, calls)) put(net, file);
    const pairs = [...recorded, ...seeded];
    for (const period of periods) {
      for (const amm of PROFILES[net].amm ? [undefined, "exclude", "only"] as const : [undefined]) {
        put(net, { path: "/v2/network/markets", query: queryOf({ limit: MARKETS_LIMIT, period, amm }), value: marketsAnswer(net, native, pairs, period, amm, now), rowLists: ["markets"] });
      }
    }
  }
  return files;
}
