import { readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// http-fixtures.ts first: the generators it joins (market-fixtures.ts, amm-info-fixtures.ts) and derived-trades.ts import it in turn.
import { fixtureText, generate, HTTP, isMarketGenerated, readLedgers } from "../../scripts/http-fixtures";
import { derivedExchanges, invertedExchange } from "../../scripts/derived-trades";
import type { Fill, MarketPair } from "../../scripts/market-aggregates";
import { marketFixtures, marketPairs } from "../../scripts/market-fixtures";
import { apiAssetText, canonicalPair, sameAsset } from "../../app/domain/asset";
import { formatCurrency } from "../../app/domain/format";
import { candleWindow, dayWindowStart, INTERVALS, type Interval } from "../../app/domain/market-params";
import { checkActiveAccounts, checkCandles, checkMarkets, checkPairExchanges, checkReduce } from "../../app/server/aggregate-shape";
import type { ActiveAccounts, AmmFilter, Candle, LastValidated, MarketRow, MarketsResponse, Page, PairExchange, ReducedRow } from "../../app/server/api-types";
import { EVR, LIONS, RLUSD, XAH, XRP, type Asset } from "../support/book-fixtures";
import { startFixtureServer, type FixtureServer } from "../support/fixture-server";
import { dataApiFile, type NetworkName } from "../support/upstream-core";

// What the generated fixtures of the markets pages promise the tests that use them: the pair files and the markets tables that scripts/market-fixtures.ts
// writes (`pnpm fixtures:sync`). The recorded part, the order books, is test/unit/market-fixtures.test.ts.
//
// The requests are worked out here from the calls of spec 3.3 and the windows of market-params.ts (`candleWindow`, `dayWindowStart`), the files are
// the ones those requests find, and every number is checked against the trades it is made of: on XRPL the trades derived from the recorded ledgers
// (`derivedExchanges`, inverted with `invertedExchange` for the other orientation), on Xahau the synthetic trades of EVR/XAH's own list pages, and for the
// markets tables the trades the generator is given (`marketPairs`). The markets table follows the data API's reference at the pinned D2 commit
// (test/fixtures/PROVENANCE.md, "Synthetic aggregates").

type Net = NetworkName;
type Filter = AmmFilter | null;

const NETWORKS: Net[] = ["xrpl", "xahau"];
const NATIVE: Record<Net, string> = { xrpl: "XRP", xahau: "XAH" };
/** The XRP/RLUSD pool (scripts/amm-info-fixtures.ts). */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

const read = (path: string): string => readFileSync(new URL(path, HTTP), "utf8");
/** A file's JSON, unread: each use says what it holds (the API's types, which the client's checks make true). */
const json = (path: string): unknown => JSON.parse(read(path));
const lastValidated = (net: Net): LastValidated => json(`${net}/data-api/last_validated.json`) as LastValidated;
/** T: the close time of the newest recorded ledger, in unix seconds. */
const T: Record<Net, number> = {
  xrpl: Date.parse(lastValidated("xrpl").close_time) / 1000,
  xahau: Date.parse(lastValidated("xahau").close_time) / 1000,
};
const iso = (seconds: number): string => `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
const timeOf = (row: { executed_time: string }): number => Date.parse(row.executed_time) / 1000;
const byKey = (a: PairExchange, b: PairExchange): number => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index || a.node_index - b.node_index;

// ---- The calls --------------------------------------------------------------------------------------------------------

interface PairCase {
  name: string;
  net: Net;
  base: Asset;
  counter: Asset;
  /** The `amm` of the lists and the candles that are asked for (`null`: none). */
  lists: Filter[];
  /** The `amm` of the 24-hour rows (#3 has none, #9 is `only`). */
  reduces: Filter[];
  /** #10, the one-row probe of a pair with any trade. */
  probe: boolean;
}

const PAIRS: PairCase[] = [
  { name: "XRP/RLUSD", net: "xrpl", base: XRP, counter: RLUSD, lists: [null, "exclude", "only"], reduces: [null, "exclude", "only"], probe: true },
  { name: "RLUSD/XRP", net: "xrpl", base: RLUSD, counter: XRP, lists: [null], reduces: [null, "only"], probe: false },
  { name: "LIONS/XRP", net: "xrpl", base: LIONS, counter: XRP, lists: [null], reduces: [null, "only"], probe: false },
  { name: "XRP/LIONS", net: "xrpl", base: XRP, counter: LIONS, lists: [null], reduces: [null, "only"], probe: false },
  { name: "EVR/XAH", net: "xahau", base: EVR, counter: XAH, lists: [null], reduces: [null], probe: false },
];
const INTERVAL_NAMES = Object.keys(INTERVALS) as Interval[];
const PERIODS = ["day", "7day", "30day"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_HOURS: Record<Period, number> = { day: 24, "7day": 168, "30day": 720 };
const MARKET_FILTERS: Record<Net, Filter[]> = { xrpl: [null, "exclude", "only"], xahau: [null] };

type Kind = "list" | "probe" | "candles" | "reduce" | "accounts" | "markets";
interface Call {
  kind: Kind;
  net: Net;
  path: string;
  search: string;
  amm: Filter;
}

/** A query as data-api.ts writes it (in its order, `amm` last), with what is left out not there. */
const searchOf = (params: Record<string, string | null | undefined>): string =>
  new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
const pairPath = (pair: PairCase, route = "exchanges") => `/v2/${route}/${apiAssetText(pair.base)}/${apiAssetText(pair.counter)}`;
const marketFile = (call: Call): string => dataApiFile(call.net, call.path, call.search)!;
const bodyOf = (call: Call): unknown => json(marketFile(call));

const listCall = (pair: PairCase, amm: Filter, marker?: string): Call => ({
  kind: "list",
  net: pair.net,
  path: pairPath(pair),
  search: searchOf({ descending: "true", limit: "20", marker, amm }),
  amm,
});
const candleCall = (pair: PairCase, interval: Interval, amm: Filter): Call => ({
  kind: "candles",
  net: pair.net,
  path: pairPath(pair),
  search: searchOf({ interval: INTERVALS[interval].api, start: candleWindow(T[pair.net], interval).start, limit: "61", amm }),
  amm,
});
const reduceCall = (pair: PairCase, amm: Filter): Call => ({
  kind: "reduce",
  net: pair.net,
  path: pairPath(pair),
  search: searchOf({ reduce: "true", start: dayWindowStart(T[pair.net]), amm }),
  amm,
});
const accountsCall = (pair: PairCase): Call => ({ kind: "accounts", net: pair.net, path: pairPath(pair, "active_accounts"), search: "", amm: null });
const probeCall = (pair: PairCase): Call => ({ kind: "probe", net: pair.net, path: pairPath(pair), search: searchOf({ descending: "true", limit: "1" }), amm: null });
const marketsCall = (net: Net, period: Period, amm: Filter): Call => ({
  kind: "markets",
  net,
  path: "/v2/network/markets",
  search: searchOf({ limit: "1000", period, amm }),
  amm,
});

/** The pages of a list, the first and each its marker names, and their rows in order. */
function walk(pair: PairCase, amm: Filter): { calls: Call[]; pages: Page<"exchanges", PairExchange>[]; rows: PairExchange[] } {
  const calls: Call[] = [];
  const pages: Page<"exchanges", PairExchange>[] = [];
  let marker: string | undefined;
  do {
    const call = listCall(pair, amm, marker);
    const page = bodyOf(call) as Page<"exchanges", PairExchange>;
    calls.push(call);
    pages.push(page);
    marker = page.marker;
  } while (marker !== undefined && pages.length < 100);
  return { calls, pages, rows: pages.flatMap((page) => page.exchanges) };
}

function pairCalls(pair: PairCase): Call[] {
  const calls: Call[] = [];
  for (const amm of pair.lists) {
    calls.push(...walk(pair, amm).calls);
    for (const interval of INTERVAL_NAMES) calls.push(candleCall(pair, interval, amm));
  }
  for (const amm of pair.reduces) calls.push(reduceCall(pair, amm));
  calls.push(accountsCall(pair));
  if (pair.probe) calls.push(probeCall(pair));
  return calls;
}

const marketCalls = (net: Net): Call[] => PERIODS.flatMap((period) => MARKET_FILTERS[net].map((amm) => marketsCall(net, period, amm)));
const allCalls = (): Call[] => [...PAIRS.flatMap(pairCalls), ...NETWORKS.flatMap(marketCalls)];

const CHECK: Record<Kind, (body: unknown, amm: Filter) => unknown> = {
  list: checkPairExchanges,
  probe: checkPairExchanges,
  candles: checkCandles,
  reduce: checkReduce,
  accounts: checkActiveAccounts,
  markets: (body, amm) => checkMarkets(body, amm ?? undefined),
};

// ---- The trades a file is made of --------------------------------------------------------------------------------------

const derived = derivedExchanges(readLedgers("xrpl"));

/** Whether the pair is asked the other way round than the API stores it. */
const isInverted = (pair: PairCase): boolean => !sameAsset(canonicalPair(pair.base, pair.counter)[0], pair.base);
const sideOf = (currency: string, issuer?: string): Asset => (issuer === undefined ? { currency } : { currency, issuer });
const takes = (amm: Filter) => (row: PairExchange) => amm === null || (amm === "only") === (row.amm_account !== undefined);

/**
 * Every trade of the pair in the orientation asked, oldest first: on XRPL the derived trades of the stored pair, inverted for the other orientation; on
 * Xahau the trades of EVR/XAH's own list, which are synthetic.
 */
function tradesOf(pair: PairCase, amm: Filter = null): PairExchange[] {
  if (pair.net === "xahau") return [...walk(pair, null).rows].sort(byKey).filter(takes(amm));
  const [stored] = canonicalPair(pair.base, pair.counter);
  const rows = derived.filter(
    (row) =>
      sameAsset(sideOf(row.base_currency, row.base_issuer), stored) &&
      sameAsset(sideOf(row.counter_currency, row.counter_issuer), sameAsset(stored, pair.base) ? pair.counter : pair.base),
  );
  return (isInverted(pair) ? rows.map(invertedExchange) : rows).filter(takes(amm));
}

/** A trade the aggregates count: its native leg, if it has one, is above 0.0005 (the reference's rule for candles, `reduce` and the markets table). */
function isKept(row: PairExchange, net: Net): boolean {
  if (row.base_issuer === undefined && row.base_currency === NATIVE[net]) return new BigNumber(row.base_amount).gt("0.0005");
  if (row.counter_issuer === undefined && row.counter_currency === NATIVE[net]) return new BigNumber(row.counter_amount).gt("0.0005");
  return true;
}

const Wide = BigNumber.clone({ DECIMAL_PLACES: 200 });
const Percent = BigNumber.clone({ DECIMAL_PLACES: 2, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
const p8 = (value: BigNumber.Value): string => new BigNumber(value).toPrecision(8);
const sum = (values: string[]): BigNumber => values.reduce((total, value) => total.plus(value), new BigNumber(0));

/** What the aggregates of the reference make of trades (oldest first): open and close by key, high and low by rate (the first by key of equal ones). */
function figuresOf(rows: PairExchange[]) {
  const [first, last] = [rows[0]!, rows.at(-1)!];
  let [high, low] = [first, first];
  for (const row of rows) {
    if (Number(row.rate) > Number(high.rate)) high = row;
    if (Number(row.rate) < Number(low.rate)) low = row;
  }
  const base = sum(rows.map((row) => row.base_amount));
  const counter = sum(rows.map((row) => row.counter_amount));
  return {
    count: rows.length,
    base,
    counter,
    bought: sum(rows.filter((row) => row.buyer === row.taker).map((row) => row.base_amount)),
    open: first,
    close: last,
    high,
    low,
    vwap: base.isZero() ? "0.0000000" : p8(new Wide(counter).dividedBy(base)),
  };
}

/** The four sides of a pair as the API writes them in an aggregate: the pair asked, the native currency without an issuer key. */
const pairFieldsOf = (pair: PairCase) => ({
  base_currency: pair.base.currency,
  ...(pair.base.issuer !== undefined && { base_issuer: pair.base.issuer }),
  counter_currency: pair.counter.currency,
  ...(pair.counter.issuer !== undefined && { counter_issuer: pair.counter.issuer }),
});

const isPrice = (text: string): boolean => new BigNumber(text).toPrecision(8) === text;

describe("the market fixtures: T and the windows", () => {
  it("are those of the newest recorded ledger: XRPL 2026-10-17T17:01:12Z, Xahau 2026-10-17T17:47:11Z", () => {
    expect(iso(T.xrpl)).toBe("2026-10-17T17:01:12Z");
    expect(iso(T.xahau)).toBe("2026-10-17T17:47:11Z");
    expect(dayWindowStart(T.xrpl)).toBe("2026-10-16T17:01:00Z");
    expect(reduceCall(PAIRS[0]!, null).search).toBe("reduce=true&start=2026-10-16T17%3A01%3A00Z");
  });
});

describe("the market fixtures: the requests", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer(0);
  });
  afterAll(async () => {
    await server.close();
  });

  it("find a file for each call, and the files are those the generator writes, no more and no fewer", () => {
    const calls = allCalls();
    const files = calls.map(marketFile);
    expect(new Set(files).size, "no two calls find one file").toBe(files.length);
    const generated = [...marketFixtures().keys()].sort();
    expect(generated.length).toBeGreaterThan(0);
    expect([...files].sort()).toEqual(generated);
    const onDisk = readdirSync(HTTP, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `${entry.parentPath.slice(HTTP.pathname.length)}/${entry.name}`.replace(/^\//, ""))
      .filter(isMarketGenerated);
    expect(onDisk.sort()).toEqual(generated);
  });

  // A whole generation: about 1 s on a developer's machine, and close to 4 s on a CI runner.
  it("isMarketGenerated is true of the files marketFixtures writes and of no other generated file", () => {
    expect([...generate().keys()].filter(isMarketGenerated).sort()).toEqual([...marketFixtures().keys()].sort());
  }, 15_000);

  it("are answered by the fixture server with a 200, and an answer that passes the check the client runs", async () => {
    for (const call of allCalls()) {
      const response = await fetch(`${server.url}/${call.net}${call.path}${call.search ? `?${call.search}` : ""}`, { headers: { "X-API-Key": "k" } });
      expect(response.status, `${call.path}?${call.search}`).toBe(200);
      const body: unknown = await response.json();
      expect(() => CHECK[call.kind](body, call.amm), `${call.kind} ${call.path}?${call.search}`).not.toThrow();
    }
  });

  it("are files in the layout of the synthetic ones: sorted keys, a row (a trade, a candle, an account, a market) to a line", () => {
    for (const call of allCalls()) {
      const text = read(marketFile(call));
      const rowLists = call.kind === "markets" ? ["markets"] : ["exchanges", "accounts"];
      expect(text, marketFile(call)).toBe(fixtureText(JSON.parse(text), rowLists));
      const body = JSON.parse(text) as { markets?: unknown[]; exchanges?: unknown[]; accounts?: unknown[] };
      const rows = (body.markets ?? body.exchanges ?? body.accounts) as unknown[];
      expect(text.split("\n").filter((line) => line.startsWith("    {")).length, marketFile(call)).toBe(rows.length);
    }
  });

  it("name every account and issuer by a valid classic address", () => {
    const names: string[] = [];
    const visit = (value: unknown, key = ""): void => {
      if (Array.isArray(value)) value.forEach((item) => visit(item));
      else if (typeof value === "object" && value !== null) for (const [name, item] of Object.entries(value)) visit(item, name);
      else if (typeof value === "string" && /(^|_)issuer$|^(buyer|seller|taker|provider|account|amm_account)$/.test(key)) names.push(value);
    };
    for (const call of allCalls()) visit(bodyOf(call));
    expect(names.length).toBeGreaterThan(1000);
    for (const name of new Set(names)) expect(isValidClassicAddress(name), name).toBe(true);
  });
});

describe.each(PAIRS)("the market fixtures of $name ($net)", (pair) => {
  const now = T[pair.net];

  it.each(pair.lists)("list the trades 20 to a page, newest first, each marker naming the page after it (amm %s)", (amm) => {
    const { pages, rows } = walk(pair, amm);
    expect(rows.length).toBeGreaterThan(0);
    pages.forEach((page, at) => {
      expect(page.result).toBe("success");
      expect(page.count).toBe(page.exchanges.length);
      expect(page.exchanges.length).toBeLessThanOrEqual(20);
      const last = page.exchanges.at(-1)!;
      if (at < pages.length - 1) {
        expect(page.exchanges).toHaveLength(20);
        expect(page.marker).toBe(Buffer.from(JSON.stringify([last.ledger_index, last.tx_index, last.node_index])).toString("base64url"));
      } else {
        expect(page.marker).toBeUndefined();
      }
    });
    // Newest first, by (ledger_index, tx_index, node_index), each trade once.
    expect(rows).toEqual([...rows].sort(byKey).reverse());
    expect(new Set(rows.map((row) => `${row.ledger_index}/${row.tx_index}/${row.node_index}`)).size).toBe(rows.length);
    for (const row of rows) expect(pairFieldsOf(pair)).toEqual(pairFieldsOf({ ...pair, base: sideOf(row.base_currency, row.base_issuer), counter: sideOf(row.counter_currency, row.counter_issuer) }));
    for (const row of rows) expect(isPrice(row.rate), row.rate).toBe(true);
  });

  if (pair.net === "xrpl") {
    it.each(pair.lists)("list the trades derived from the recorded ledgers, in the orientation asked (amm %s)", (amm) => {
      expect(walk(pair, amm).rows).toEqual([...tradesOf(pair, amm)].reverse());
    });
  }

  if (pair.probe) {
    it("have the one-row probe: the newest trade, and a marker", () => {
      const page = bodyOf(probeCall(pair)) as Page<"exchanges", PairExchange>;
      expect(page.exchanges).toEqual([walk(pair, null).rows[0]]);
      expect(page.count).toBe(1);
      expect(page.marker).toBeDefined();
    });
  }

  it.each(pair.lists.flatMap((amm) => INTERVAL_NAMES.map((interval) => [interval, amm] as const)))(
    "have the candles of %s (amm %s): whole buckets of the window, 8-digit prices, exact sums of the trades whose native leg is above 0.0005",
    (interval, amm) => {
      const { buckets, start } = candleWindow(now, interval);
      const page = bodyOf(candleCall(pair, interval, amm)) as Page<"exchanges", Candle>;
      expect(page.marker).toBeUndefined();
      expect(page.count).toBe(page.exchanges.length);
      const kept = tradesOf(pair, amm).filter((row) => isKept(row, pair.net) && timeOf(row) >= Date.parse(start) / 1000);
      const groups = new Map<string, PairExchange[]>();
      for (const row of kept) {
        const bucket = candleWindow(timeOf(row), interval).buckets.at(-1)!;
        groups.set(bucket, [...(groups.get(bucket) ?? []), row]);
      }
      expect(page.exchanges.map((candle) => candle.start)).toEqual([...groups.keys()]);
      for (const candle of page.exchanges) {
        expect(buckets).toContain(candle.start);
        const f = figuresOf(groups.get(candle.start)!);
        expect(candle).toEqual({
          base_volume: candle.base_volume,
          buy_volume: Number(f.bought.toString()),
          close: f.close.rate,
          close_time: f.close.executed_time,
          count: f.count,
          counter_volume: candle.counter_volume,
          high: f.high.rate,
          low: f.low.rate,
          open: f.open.rate,
          open_time: f.open.executed_time,
          start: candle.start,
          vwap: f.vwap,
          ...pairFieldsOf(pair),
        });
        expect(new BigNumber(candle.base_volume).isEqualTo(f.base), candle.start).toBe(true);
        expect(new BigNumber(candle.counter_volume).isEqualTo(f.counter), candle.start).toBe(true);
        for (const price of [candle.open, candle.high, candle.low, candle.close, candle.vwap]) expect(isPrice(price), price).toBe(true);
      }
    },
  );

  it.each(pair.reduces)("have the one 24-hour row over [T1, T] (amm %s)", (amm) => {
    const page = bodyOf(reduceCall(pair, amm)) as Page<"exchanges", ReducedRow>;
    expect(page.count).toBe(1);
    expect(page.marker).toBeUndefined();
    const [row] = page.exchanges;
    const start = dayWindowStart(now);
    const kept = tradesOf(pair, amm).filter((trade) => isKept(trade, pair.net) && timeOf(trade) >= Date.parse(start) / 1000 && timeOf(trade) <= now);
    if (kept.length === 0) {
      expect(row).toEqual({ open: "0.0000000", high: "0.0000000", low: "0.0000000", close: "0.0000000", base_volume: "0", counter_volume: "0", buy_volume: 0, count: 0, vwap: "0.0000000", start, ...pairFieldsOf(pair) });
      return;
    }
    const f = figuresOf(kept);
    expect(row).toEqual({
      open: f.open.rate,
      high: f.high.rate,
      low: f.low.rate,
      close: f.close.rate,
      base_volume: row!.base_volume,
      counter_volume: row!.counter_volume,
      buy_volume: Number(f.bought.toString()),
      count: f.count,
      open_time: f.open.executed_time,
      close_time: f.close.executed_time,
      vwap: f.vwap,
      start,
      ...pairFieldsOf(pair),
    });
    expect(new BigNumber(row!.base_volume).isEqualTo(f.base)).toBe(true);
    expect(new BigNumber(row!.counter_volume).isEqualTo(f.counter)).toBe(true);
  });

  it("have the active accounts of the last day: by base volume, each trade counted for its buyer and its seller", () => {
    const answer = bodyOf(accountsCall(pair)) as ActiveAccounts;
    const day = tradesOf(pair).filter((row) => timeOf(row) >= now - 86_400 && timeOf(row) <= now);
    expect(day.length).toBeGreaterThan(0);
    expect(answer.exchanges_count).toBe(day.length);
    expect(answer.count).toBe(answer.accounts.length);
    expect(answer.accounts.reduce((total, account) => total + account.count, 0)).toBe(2 * day.length);
    const volumes = answer.accounts.map((account) => new BigNumber(account.base_volume));
    for (let at = 1; at < volumes.length; at++) expect(volumes[at - 1]!.gte(volumes[at]!)).toBe(true);
    for (const account of answer.accounts) {
      const [bought, sold] = [day.filter((row) => row.buyer === account.account), day.filter((row) => row.seller === account.account)];
      expect([account.buy.count, account.sell.count], account.account).toEqual([bought.length, sold.length]);
      expect(new BigNumber(account.buy.base_volume).isEqualTo(sum(bought.map((row) => row.base_amount)))).toBe(true);
      expect(new BigNumber(account.sell.counter_volume).isEqualTo(sum(sold.map((row) => row.counter_amount)))).toBe(true);
      expect(new BigNumber(account.base_volume).isEqualTo(sum([...bought, ...sold].map((row) => row.base_amount)))).toBe(true);
    }
    if (pair.name.includes("RLUSD")) expect(answer.accounts.map((account) => account.account)).toContain(POOL);
  });

  // The reference's walk: the trades in key order, each counted for its seller, then its buyer; equal base volumes keep the order it first met them in.
  it("keep the order the walk first meets the accounts in for equal base volumes", () => {
    const answer = bodyOf(accountsCall(pair)) as ActiveAccounts;
    const met: string[] = [];
    for (const row of tradesOf(pair).filter((trade) => timeOf(trade) >= now - 86_400 && timeOf(trade) <= now)) {
      for (const account of [row.seller, row.buyer]) if (!met.includes(account)) met.push(account);
    }
    let ties = 0;
    answer.accounts.forEach((account, at) => {
      const before = answer.accounts[at - 1];
      if (before === undefined || !new BigNumber(before.base_volume).isEqualTo(account.base_volume)) return;
      ties++;
      expect(met.indexOf(before.account), `${before.account} before ${account.account}`).toBeLessThan(met.indexOf(account.account));
    });
    if (pair.name === "XRP/RLUSD" || pair.name === "RLUSD/XRP") expect(ties).toBeGreaterThan(0);
  });
});

describe("the active accounts of XRP/RLUSD: the tie of the trade of 7.6 XRP (ledger 107699656)", () => {
  // Its seller is met first. Asked XRP/RLUSD (inverted) the seller is rHciXf…, the stored trade's buyer; asked RLUSD/XRP (stored) it is rDi2Vy….
  const [rHciXf, rDi2Vy] = ["rHciXfG7ZxFNTYZajwGH7sxCjGJV9rJrHC", "rDi2VysuPsU5oQRGPDTPiR9YPd34kzK9m8"];
  const orderOf = (name: string): string[] =>
    (bodyOf(accountsCall(PAIRS.find((pair) => pair.name === name)!)) as ActiveAccounts).accounts
      .map((account) => account.account)
      .filter((account) => account === rHciXf || account === rDi2Vy);

  it("lists rHciXf… first asked XRP/RLUSD, and rDi2Vy… first asked RLUSD/XRP", () => {
    expect(orderOf("XRP/RLUSD")).toEqual([rHciXf, rDi2Vy]);
    expect(orderOf("RLUSD/XRP")).toEqual([rDi2Vy, rHciXf]);
  });
});

describe("the market fixtures of EVR/XAH, which are synthetic", () => {
  const pair = PAIRS.find((candidate) => candidate.net === "xahau")!;

  it("have a trade whose XAH leg is 0.0005 or less in the window of the 15-minute candles: listed, but in no aggregate", () => {
    const start = Date.parse(candleWindow(T.xahau, "15m").start) / 1000;
    const dust = tradesOf(pair).filter((row) => !isKept(row, "xahau"));
    expect(dust.length).toBeGreaterThan(0);
    expect(dust.some((row) => timeOf(row) >= start)).toBe(true);
  });

  it("are trades of EVR/XAH only, at ledgers and times of the Xahau chain up to the newest recorded ledger", () => {
    const newest = Number(lastValidated("xahau").ledger_index);
    for (const row of tradesOf(pair)) {
      expect(row.ledger_index).toBeLessThanOrEqual(newest);
      expect(timeOf(row)).toBeLessThanOrEqual(T.xahau);
      expect(row.tx_hash).toMatch(/^[0-9A-F]{64}$/);
      expect(row.amm_account).toBeUndefined();
    }
  });

  it("are never an account trading with itself: the taker is not the provider", () => {
    const rows = tradesOf(pair);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.filter((row) => row.provider === row.taker)).toEqual([]);
  });
});

// ---- The markets table -----------------------------------------------------------------------------------------------

const ANSWER_KEYS = ["amm", "count", "end_time", "markets", "period", "result", "start_time", "totals"];
const ROW_KEYS = [
  "base_currency",
  "base_issuer",
  "counter_currency",
  "counter_issuer",
  "count",
  "base_volume",
  "counter_volume",
  "native_volume",
  "open",
  "high",
  "low",
  "last",
  "change",
  "open_time",
  "last_time",
  "amm_share",
  "amm_pool",
  "sparkline",
];
const REQUIRED_ROW_KEYS = ROW_KEYS.filter((key) => !["base_issuer", "counter_issuer", "native_volume"].includes(key));
const SHARE = /^[01]\.\d{4}$/;

const floorHour = (seconds: number) => Math.floor(seconds / 3600) * 3600;
const floorDay = (seconds: number) => Math.floor(seconds / 86_400) * 86_400;
/** The 7 days of a sparkline: the day of T and the 6 before it. */
const sparkDays = (net: Net): number[] => Array.from({ length: 7 }, (_, at) => floorDay(floorHour(T[net])) - (6 - at) * 86_400);
const isNativeSide = (net: Net, currency: string, issuer?: string) => issuer === undefined && currency === NATIVE[net];
const pairKey = (row: MarketRow): string[] => [row.base_currency, row.base_issuer ?? "", row.counter_currency, row.counter_issuer ?? ""];
const compareKeys = (a: string[], b: string[]): number => {
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return a[at]! < b[at]! ? -1 : 1;
  return 0;
};
const answerOf = (net: Net, period: Period, amm: Filter): MarketsResponse => bodyOf(marketsCall(net, period, amm)) as MarketsResponse;
const marketViews = NETWORKS.flatMap((net) => PERIODS.flatMap((period) => MARKET_FILTERS[net].map((amm) => ({ net, period, amm }))));

/**
 * The row the reference makes of a pair's trades (stored orientation, oldest first) for a period and a filter, or undefined where it does not list the
 * pair (fewer than 10 kept trades). Its AMM share is the AMM part of the base volume of all the pair's trades of the window.
 */
function expectedRow(net: Net, trades: PairExchange[], period: Period, amm: Filter, pool: boolean): Partial<MarketRow> | undefined {
  const now = T[net];
  const start = floorHour(now) - PERIOD_HOURS[period] * 3600;
  const all = trades.filter((row) => isKept(row, net) && timeOf(row) >= start && timeOf(row) <= now);
  const own = all.filter(takes(amm));
  if (own.length < 10) return undefined;
  const f = figuresOf(own);
  const share = (rows: PairExchange[]) => sum(rows.map((row) => row.base_amount));
  const days = sparkDays(net);
  let carried: string | undefined;
  const sparkline = days.map((day) => {
    const ofDay = trades.filter((row) => isKept(row, net) && takes(amm)(row) && timeOf(row) >= day && timeOf(row) < day + 86_400 && timeOf(row) <= now);
    carried = ofDay.at(-1)?.rate ?? carried;
    return { date: iso(day), ...(carried !== undefined && { close: carried }) };
  });
  const first = own[0]!;
  const nativeIsCounter = isNativeSide(net, first.counter_currency, first.counter_issuer);
  return {
    count: f.count,
    base_volume: f.base.toString(),
    counter_volume: f.counter.toString(),
    native_volume: (nativeIsCounter ? f.counter : f.base).toString(),
    open: f.open.rate,
    high: f.high.rate,
    low: f.low.rate,
    last: f.close.rate,
    // The change of the rates as served: for a derived trade, which the generator knows to 8 digits, it is the change of the exact rates too.
    change: new Percent(f.close.rate).minus(f.open.rate).times(100).dividedBy(f.open.rate).toFixed(2),
    open_time: f.open.executed_time,
    last_time: f.close.executed_time,
    amm_share: net === "xahau" ? "0.0000" : new Wide(share(all.filter((row) => row.amm_account !== undefined))).dividedBy(share(all)).toFixed(4, BigNumber.ROUND_HALF_UP),
    amm_pool: pool,
    sparkline,
  };
}

describe.each(marketViews)("the markets table of $net, $period, amm $amm", ({ net, period, amm }) => {
  const answer = (): MarketsResponse => answerOf(net, period, amm);

  it("is the answer of the reference: its keys, the window from the hour a period before T to T, and amm echoed always, include when none was asked", () => {
    const body = answer();
    expect(Object.keys(body).sort()).toEqual(ANSWER_KEYS);
    expect(body).toMatchObject({ result: "success", period });
    expect(body.amm).toBe(amm ?? "include");
    expect(body.start_time).toBe(iso(floorHour(T[net]) - PERIOD_HOURS[period] * 3600));
    expect(body.end_time).toBe(iso(T[net]));
    expect(Object.keys(body.totals!).sort()).toEqual(["amm_share", "count", "native_volume", "pairs", "pairs_traded"]);
  });

  it("lists every pair with 10 trades or more, fewer than the limit, so that totals.pairs is the count served", () => {
    const body = answer();
    expect(body.count).toBe(body.markets.length);
    expect(body.totals!.pairs).toBe(body.count);
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBeLessThan(1000);
    expect(body.totals!.pairs_traded).toBeGreaterThan(body.totals!.pairs);
    expect(body.totals!.count).toBeGreaterThan(body.markets.reduce((total, row) => total + row.count, 0));
    for (const row of body.markets) expect(row.count).toBeGreaterThanOrEqual(10);
  });

  // D2's `marketsAnswer`: by native volume, the largest first, then by the pair; the rows without one last, by count, the largest first, then by the pair.
  it("sorts by native volume, largest first, then by the pair, and the rows without one last, by count, then by the pair", () => {
    const rows = answer().markets;
    for (let at = 1; at < rows.length; at++) {
      const [a, b] = [rows[at - 1]!, rows[at]!];
      const where = `${pairKey(a).join(" ")} before ${pairKey(b).join(" ")}`;
      if (a.native_volume !== undefined && b.native_volume !== undefined) {
        const order = new BigNumber(b.native_volume).comparedTo(a.native_volume)!;
        expect(order < 0 || (order === 0 && compareKeys(pairKey(a), pairKey(b)) < 0), where).toBe(true);
      } else {
        expect(a.native_volume === undefined && b.native_volume !== undefined, `a row without a native volume before one with: ${where}`).toBe(false);
        if (a.native_volume === undefined) expect(a.count > b.count || (a.count === b.count && compareKeys(pairKey(a), pairKey(b)) < 0), where).toBe(true);
      }
    }
  });

  it("has rows of the reference's keys, in the stored order of the pair, with 8-digit prices, the change of last over open, and the native side's volume", () => {
    const body = answer();
    for (const row of body.markets) {
      const where = pairKey(row).join(" ");
      expect(ROW_KEYS, where).toEqual(expect.arrayContaining(Object.keys(row)));
      for (const key of REQUIRED_ROW_KEYS) expect(row, `${where} ${key}`).toHaveProperty(key);
      const [base, counter] = [sideOf(row.base_currency, row.base_issuer), sideOf(row.counter_currency, row.counter_issuer)];
      expect(canonicalPair(base, counter)[0], where).toEqual(base);
      for (const price of [row.open, row.high, row.low, row.last]) expect(isPrice(price), `${where} ${price}`).toBe(true);
      const [open, high, low, last] = [row.open, row.high, row.low, row.last].map((price) => new BigNumber(price));
      expect(low!.lte(open!) && low!.lte(last!) && open!.lte(high!) && last!.lte(high!), where).toBe(true);
      expect(row.change, where).toBe(new Percent(row.last).minus(row.open).times(100).dividedBy(row.open).toFixed(2));
      expect(Date.parse(row.open_time)).toBeLessThanOrEqual(Date.parse(row.last_time));
      expect(Date.parse(row.open_time)).toBeGreaterThanOrEqual(Date.parse(body.start_time!));
      expect(Date.parse(row.last_time)).toBeLessThanOrEqual(Date.parse(body.end_time!));
      if (isNativeSide(net, row.counter_currency, row.counter_issuer)) expect(row.native_volume, where).toBe(row.counter_volume);
      if (isNativeSide(net, row.base_currency, row.base_issuer)) expect(row.native_volume, where).toBe(row.base_volume);
    }
  });

  it("has a sparkline of the 7 days that end with the day of T, a day without a trade carrying the close before it", () => {
    const dates = sparkDays(net).map(iso);
    for (const row of answer().markets) {
      expect(row.sparkline.map((day) => day.date)).toEqual(dates);
      const closes = row.sparkline.map((day) => day.close);
      const first = closes.findIndex((close) => close !== undefined);
      // Left out only before the first close: from it on, every day has one.
      if (first >= 0) {
        expect(closes.slice(first).every((close) => close !== undefined && isPrice(close))).toBe(true);
        expect(closes.at(-1), "the close of the day of T is the last trade's").toBe(row.last);
      }
    }
  });

  it("has the AMM fields: a share of 4 decimals and whether the pair has a pool on XRPL, 0.0000 and false on Xahau", () => {
    const body = answer();
    expect(body.totals!.amm_share).toMatch(SHARE);
    if (net === "xahau") expect(body.totals!.amm_share).toBe("0.0000");
    for (const row of body.markets) {
      expect(row.amm_share).toMatch(SHARE);
      expect(typeof row.amm_pool).toBe("boolean");
      if (net === "xahau") expect([row.amm_share, row.amm_pool]).toEqual(["0.0000", false]);
      if (new BigNumber(row.amm_share!).gt(0)) expect(row.amm_pool).toBe(true);
      if (amm === "only") expect(row.amm_pool).toBe(true);
    }
  });
});

describe("the markets table: the rows made of the recorded and the synthetic trades", () => {
  it.each(MARKET_FILTERS.xrpl.flatMap((amm) => PERIODS.map((period) => [period, amm] as const)))(
    "XRPL, %s, amm %s: the XRP/RLUSD row (stored RLUSD/XRP) is made of its derived trades where they reach 10, and is not there where they do not",
    (period, amm) => {
      const stored = PAIRS.find((pair) => pair.name === "RLUSD/XRP")!;
      const expected = expectedRow("xrpl", tradesOf(stored), period, amm, true);
      const row = answerOf("xrpl", period, amm).markets.find((market) => market.base_currency === RLUSD.currency && market.base_issuer === RLUSD.issuer && market.counter_currency === "XRP");
      if (expected === undefined) {
        expect(row).toBeUndefined();
        return;
      }
      expect(row).toMatchObject(expected);
      expect(new BigNumber(row!.base_volume).isEqualTo(sum(tradesOf(stored, amm).filter((trade) => isKept(trade, "xrpl") && timeOf(trade) >= floorHour(T.xrpl) - PERIOD_HOURS[period] * 3600).map((trade) => trade.base_amount)))).toBe(true);
    },
  );

  it("XRPL: the derived XRP/RLUSD row is there in the 7-day and 30-day sets of all trades, and of the order book's", () => {
    for (const period of ["7day", "30day"] as const) {
      for (const amm of [null, "exclude"] as const) {
        expect(answerOf("xrpl", period, amm).markets.some((market) => market.base_issuer === RLUSD.issuer && market.counter_currency === "XRP"), `${period} ${amm}`).toBe(true);
      }
    }
  });

  it.each(PERIODS)("Xahau, %s: the EVR/XAH row is made of its synthetic trades, the dust left out", (period) => {
    const pair = PAIRS.find((candidate) => candidate.net === "xahau")!;
    const expected = expectedRow("xahau", tradesOf(pair), period, null, false);
    expect(expected).toBeDefined();
    const row = answerOf("xahau", period, null).markets.find((market) => market.base_currency === "EVR" && market.counter_currency === "XAH");
    expect(row).toMatchObject(expected!);
  });

  it("XRPL, 30 days: more than 100 rows", () => {
    expect(answerOf("xrpl", "30day", null).markets.length).toBeGreaterThan(100);
  });

  it("about 40, 80 and 150 rows on XRPL for the 24 hours, 7 days and 30 days", () => {
    const counts = PERIODS.map((period) => answerOf("xrpl", period, null).count);
    expect(counts[0]).toBeGreaterThanOrEqual(30);
    expect(counts[0]).toBeLessThanOrEqual(50);
    expect(counts[1]).toBeGreaterThanOrEqual(65);
    expect(counts[1]).toBeLessThanOrEqual(95);
    expect(counts[2]).toBeGreaterThanOrEqual(130);
    expect(counts[2]).toBeLessThanOrEqual(170);
  });

  it.each(NETWORKS)("%s: seeded rows with a lower-case standard code, one without a native volume, EUR/USD, and USD/USD of two issuers", (net) => {
    const rows = answerOf(net, "day", null).markets;
    expect(rows.some((row) => /^[a-z]{3}$/.test(row.base_currency) || /^[a-z]{3}$/.test(row.counter_currency))).toBe(true);
    expect(rows.some((row) => row.native_volume === undefined)).toBe(true);
    expect(rows.some((row) => row.base_currency === "EUR" && row.base_issuer !== undefined && row.counter_currency === "USD" && row.counter_issuer !== undefined)).toBe(true);
    expect(rows.some((row) => row.base_currency === "USD" && row.counter_currency === "USD" && row.base_issuer !== row.counter_issuer)).toBe(true);
  });

  it("XRPL: the filtered sets are the order book's and the swaps' parts of the same trades", () => {
    for (const period of PERIODS) {
      const [all, book, swaps] = MARKET_FILTERS.xrpl.map((amm) => answerOf("xrpl", period, amm));
      expect(book!.amm).toBe("exclude");
      expect(swaps!.amm).toBe("only");
      expect(book!.totals!.count + swaps!.totals!.count).toBe(all!.totals!.count);
      // A pair's AMM share describes the pair: it is the same in every set that lists it.
      const shares = new Map(all!.markets.map((row) => [pairKey(row).join(" "), row.amm_share]));
      for (const row of [...book!.markets, ...swaps!.markets]) {
        const share = shares.get(pairKey(row).join(" "));
        if (share !== undefined) expect(row.amm_share).toBe(share);
      }
      expect(swaps!.markets.length).toBeGreaterThan(0);
    }
  });
});

// ---- The markets tables, recomputed from the trades the generator is given --------------------------------------------

/** An exact amount of a fill as a number. */
const amountOf = ({ units, scale }: { units: bigint; scale: number }): BigNumber => new BigNumber(units.toString()).shiftedBy(-scale);
const assetKey = (asset: Asset): string => `${asset.currency}+${asset.issuer ?? ""}`;
const marketKey = (base: Asset, counter: Asset): string => `${assetKey(base)}/${assetKey(counter)}`;

/**
 * The pairs of a set (a period, a filter) as D2 makes them of the trades the generator is given: the pairs with a kept trade of the filter in the window,
 * the AMM share of each (the AMM part of the base volume of all its trades of the window, exact) and its native volume: a native side's volume, else the
 * base volume over the base's rate, else the counter volume over the counter's, cut to 17 significant digits, a rate being an asset's volume over the
 * native volume of its pair against the native currency, of all the trades of the window.
 */
function setOf(net: Net, period: Period, amm: Filter): Array<{ pair: MarketPair; seeded: boolean; native: BigNumber | undefined; share: BigNumber }> {
  const { now, recorded, seeded } = marketPairs(net);
  const start = floorHour(now) - PERIOD_HOURS[period] * 3600;
  const inWindow = (fill: Fill) => fill.kept && fill.time >= start && fill.time <= now;
  const total = (fills: Fill[], part: "base" | "counter") => fills.reduce((sum, fill) => sum.plus(amountOf(fill[part])), new BigNumber(0));
  const isNativeAsset = (asset: Asset) => isNativeSide(net, asset.currency, asset.issuer);
  const pairs = [...recorded.map((pair) => ({ pair, seeded: false })), ...seeded.map((pair) => ({ pair, seeded: true }))];

  const rates = new Map<string, BigNumber>();
  for (const { pair } of pairs) {
    const all = pair.fills.filter(inWindow);
    const [base, counter] = [total(all, "base"), total(all, "counter")];
    if (isNativeAsset(pair.counter) && counter.gt(0)) rates.set(assetKey(pair.base), new Wide(base).dividedBy(counter));
    else if (isNativeAsset(pair.base) && base.gt(0)) rates.set(assetKey(pair.counter), new Wide(counter).dividedBy(base));
  }
  return pairs.flatMap(({ pair, seeded: isSeeded }) => {
    const all = pair.fills.filter(inWindow);
    const own = all.filter((fill) => amm === null || (amm === "only") === fill.amm);
    if (own.length === 0) return [];
    const [base, counter] = [total(own, "base"), total(own, "counter")];
    const [baseRate, counterRate] = [rates.get(assetKey(pair.base)), rates.get(assetKey(pair.counter))];
    const native = isNativeAsset(pair.counter)
      ? counter
      : isNativeAsset(pair.base)
        ? base
        : baseRate?.gt(0)
          ? new Wide(base).dividedBy(baseRate).precision(17)
          : counterRate?.gt(0)
            ? new Wide(counter).dividedBy(counterRate).precision(17)
            : undefined;
    const allBase = total(all, "base");
    const share = allBase.isZero() ? new BigNumber(0) : new Wide(total(all.filter((fill) => fill.amm), "base")).dividedBy(allBase);
    return [{ pair, seeded: isSeeded, native, share }];
  });
}

describe.each(marketViews)("the markets table of $net, $period, amm $amm, recomputed from the generator's trades", ({ net, period, amm }) => {
  it("has the totals of every pair that traded: their count, their native volume, and the AMM share of it", () => {
    const answer = answerOf(net, period, amm);
    const set = setOf(net, period, amm);
    expect(answer.totals!.pairs_traded).toBe(set.length);
    const withNative = set.filter((one) => one.native !== undefined);
    const native = withNative.reduce((sum, one) => sum.plus(one.native!), new BigNumber(0));
    expect(answer.totals!.native_volume).toBe(native.toString());
    // Σ native volume × share ÷ Σ native volume, of the exact shares, rounded once to 4 decimals; "0.0000" on Xahau.
    const weighted = withNative.reduce((sum, one) => sum.plus(new Wide(one.native!).times(one.share)), new Wide(0));
    expect(answer.totals!.amm_share).toBe(net === "xahau" ? "0.0000" : new Wide(weighted).dividedBy(native).toFixed(4, BigNumber.ROUND_HALF_UP));
  });

  it("has each listed row's native volume and AMM share as its trades give them, seeded rows among them", () => {
    const answer = answerOf(net, period, amm);
    const set = new Map(setOf(net, period, amm).map((one) => [marketKey(one.pair.base, one.pair.counter), one]));
    let seededShares = 0;
    for (const row of answer.markets) {
      const one = set.get(marketKey(sideOf(row.base_currency, row.base_issuer), sideOf(row.counter_currency, row.counter_issuer)));
      expect(one, pairKey(row).join(" ")).toBeDefined();
      expect(row.native_volume, pairKey(row).join(" ")).toBe(one!.native?.toString());
      expect(row.amm_share, pairKey(row).join(" ")).toBe(net === "xahau" ? "0.0000" : one!.share.toFixed(4, BigNumber.ROUND_HALF_UP));
      if (one!.seeded && one!.share.gt(0)) seededShares++;
    }
    if (net === "xrpl") expect(seededShares, "seeded rows with a share above 0").toBeGreaterThan(0);
  });
});

describe("the seeded pairs of the markets tables", () => {
  const codesOf = (pairs: MarketPair[]): Set<string> =>
    new Set(pairs.flatMap((pair) => [pair.base, pair.counter]).filter((asset) => asset.issuer !== undefined).map((asset) => formatCurrency(asset.currency).toLowerCase()));

  // No seeded row passes for one of the pages' pairs (a seeded RLUSD or LIONS of another issuer): only the USD and EUR of the special pairs (EUR/USD, USD/USD, and
  // `usd`, which the tests need) share a code, in any case, with a pair of the recordings; on Xahau none shares EVR/XAH's.
  it.each(NETWORKS)("%s: take no code of a pair of the recordings or of the pair page, but the USD and EUR of the special pairs", (net) => {
    const { recorded, seeded } = marketPairs(net);
    const theirs = codesOf(recorded);
    expect([...codesOf(seeded)].filter((code) => theirs.has(code)).sort()).toEqual(net === "xrpl" ? ["eur", "usd"] : []);
    expect(codesOf(seeded).has(NATIVE[net].toLowerCase()), "an issued currency with the native code").toBe(false);
    if (net === "xahau") expect(theirs).toEqual(new Set(["evr"]));
  });
});
