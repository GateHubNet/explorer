import { readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// http-fixtures.ts first: the generators it joins (market-fixtures.ts, amm-info-fixtures.ts) and derived-trades.ts import it in turn.
import { fixtureText, generate, HTTP, isMarketGenerated, readLedgers } from "../../scripts/http-fixtures";
import { derivedExchanges, invertedExchange } from "../../scripts/derived-trades";
import { marketFixtures } from "../../scripts/market-fixtures";
import { apiAssetText, canonicalPair, sameAsset } from "../../app/domain/asset";
import { candleWindow, dayWindowStart, INTERVALS, type Interval } from "../../app/domain/market-params";
import { checkActiveAccounts, checkCandles, checkMarkets, checkPairExchanges, checkReduce } from "../../app/server/aggregate-shape";
import type { ActiveAccounts, AmmFilter, Candle, MarketRow, MarketsResponse, Page, PairExchange, ReducedRow } from "../../app/server/api-types";
import {
  acceptAnswer,
  assetText,
  BOOK_OFFERS_LIMIT as LIMIT,
  BOOKS,
  bookFile as fileOf,
  checkOneLedger,
  EVR,
  LIONS,
  RLUSD,
  XAH,
  XRP,
  type Asset,
  type BookAnswer,
  type Recording,
} from "../support/book-fixtures";
import { startFixtureServer, type FixtureServer } from "../support/fixture-server";
import { dataApiFile, type NetworkName } from "../support/upstream-core";

// What the fixtures of the markets pages promise the tests that use them. This is the recorded part: the order books recorded from the public
// nodes by scripts/record-node-fixtures.ts, `<net>/node/book_offers/<gets>_<pays>@limit=60.json`, whole JSON-RPC answers kept as the node served
// them. The six books and the rules an answer must keep are in test/support/book-fixtures.ts, which the recorder reads too; each file is checked
// here against its row of the table in test/fixtures/PROVENANCE.md, "Recorded node answers", which is the independent pin: the request it answers
// (method and parameters) and the validated ledger it was read at.

const NETS: NetworkName[] = ["xrpl", "xahau"];

const read = (path: string): string => readFileSync(new URL(path, HTTP), "utf8");

// ---- The table of PROVENANCE.md --------------------------------------------------------------------------------------

interface Row {
  file: string;
  method: string;
  gets: string;
  pays: string;
  limit: string;
  asked: string;
  ledgerIndex: string;
  offers: string;
}

/** The rows of the table under "Recorded node answers": the cells without their code marks, in the order of the columns. */
function provenanceRows(): Row[] {
  const text = readFileSync(new URL("../fixtures/PROVENANCE.md", import.meta.url), "utf8");
  const section = text.split(/^## /m).find((part) => part.startsWith("Recorded node answers"));
  expect(section, 'PROVENANCE.md has a section "Recorded node answers"').toBeDefined();
  return section!
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const [file, method, gets, pays, limit, asked, ledgerIndex, offers] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll("`", ""));
      return { file: file!, method: method!, gets: gets!, pays: pays!, limit: limit!, asked: asked!, ledgerIndex: ledgerIndex!, offers: offers! };
    });
}

describe("the recorded order books: PROVENANCE.md", () => {
  it("names the six books, each by the file that the request it answers finds", () => {
    const rows = provenanceRows();
    expect(rows).toHaveLength(BOOKS.length);
    BOOKS.forEach((book, at) => {
      const row = rows[at]!;
      expect(row.method, row.file).toBe("book_offers");
      expect(row.gets, row.file).toBe(assetText(book.gets));
      expect(row.pays, row.file).toBe(assetText(book.pays));
      expect(row.limit, row.file).toBe(String(LIMIT));
      expect(row.asked, row.file).toBe("validated");
      expect(row.file, "the file of the request the row names").toBe(`${book.net}/node/book_offers/${assetText(book.gets)}_${assetText(book.pays)}@limit=${LIMIT}.json`);
      expect(row.file, "the file the mock finds for that request").toBe(fileOf(book));
    });
  });

  it("has no other file in the directories of the books", () => {
    const rows = provenanceRows();
    for (const net of NETS) {
      const files = readdirSync(new URL(`${net}/node/book_offers/`, HTTP)).map((name) => `${net}/node/book_offers/${name}`);
      expect(files.sort(), net).toEqual(rows.map((row) => row.file).filter((file) => file.startsWith(`${net}/`)).sort());
    }
  });

  // The pair page shows both orientations of a pair side by side, so the books of a network were read at one ledger.
  it("has the books of a network at one ledger", () => {
    const rows = provenanceRows();
    for (const net of NETS) {
      const mine = rows.filter((row) => row.file.startsWith(`${net}/`));
      expect(mine, net).toHaveLength(BOOKS.filter((book) => book.net === net).length);
      expect(new Set(mine.map((row) => row.ledgerIndex)).size, `the ledger_index of the rows of ${net}`).toBe(1);
    }
  });
});

describe("the recorded order books: one ledger to a network", () => {
  const recordings = (net: NetworkName): Recording[] =>
    BOOKS.filter((book) => book.net === net).map((book) => ({ net, path: fileOf(book), answer: JSON.parse(read(fileOf(book))) as BookAnswer }));

  it.each(NETS)("%s: every book has the same ledger_index and the same ledger_hash", (net) => {
    const all = recordings(net);
    expect(all.length).toBeGreaterThan(1);
    expect(new Set(all.map((one) => one.answer.result.ledger_index)).size, "ledger_index").toBe(1);
    expect(new Set(all.map((one) => one.answer.result.ledger_hash)).size, "ledger_hash").toBe(1);
    // The recorder's own check says the same.
    expect(() => checkOneLedger(all)).not.toThrow();
  });
});

// The rules of the recorder (test/support/book-fixtures.ts), tried without the network: what it refuses before it writes anything.
describe("what the recorder accepts: acceptAnswer", () => {
  const HASH = "6362E55E66FFC49651601E7F9ED75905F0E98CF18CD50FC1DD0398806C319940";
  const offer = { Account: "rA", Sequence: 1, TakerGets: "1000000", TakerPays: { currency: "USD", issuer: "rB", value: "1" } };
  const good = (): any => ({ result: { ledger_hash: HASH, ledger_index: 107780245, offers: [offer], status: "success" } });
  const with_ = (change: (answer: any) => void): any => {
    const answer = good();
    change(answer);
    return answer;
  };

  it("takes Clio's answer (no validated, a warnings list) and xahaud's (validated: true), and returns it as it is", () => {
    const clio = with_((answer) => (answer.warnings = [{ id: 2001, message: "This is a clio server." }]));
    expect(acceptAnswer(clio)).toBe(clio);
    const xahaud = with_((answer) => (answer.result.validated = true));
    expect(acceptAnswer(xahaud)).toBe(xahaud);
    expect(acceptAnswer(good())).toEqual(good());
  });

  it("takes as many offers as were asked for, not one more", () => {
    expect(() => acceptAnswer(with_((answer) => (answer.result.offers = Array.from({ length: LIMIT }, () => offer))))).not.toThrow();
    expect(() => acceptAnswer(with_((answer) => (answer.result.offers = Array.from({ length: LIMIT + 1 }, () => offer))))).toThrow(/61 offers where 60 were asked for/);
  });

  it.each([
    ["validated: false", (answer: any) => (answer.result.validated = false), /not of a validated ledger.*false/],
    ["validated: null", (answer: any) => (answer.result.validated = null), /not of a validated ledger.*null/],
    ['validated: "true"', (answer: any) => (answer.result.validated = "true"), /not of a validated ledger/],
    ["validated: 1", (answer: any) => (answer.result.validated = 1), /not of a validated ledger/],
    ["validated: undefined, present", (answer: any) => (answer.result.validated = undefined), /not of a validated ledger/],
    ["an empty book", (answer: any) => (answer.result.offers = []), /the book is empty/],
    ["no offers", (answer: any) => delete answer.result.offers, /no "offers" list/],
    ["offers that are not a list", (answer: any) => (answer.result.offers = { 0: offer }), /no "offers" list/],
    ["an error", (answer: any) => Object.assign(answer.result, { status: "error", error: "dstIsrMalformed" }), /not a success: "dstIsrMalformed"/],
    ["no status", (answer: any) => delete answer.result.status, /not a success/],
    ["no result", (answer: any) => delete answer.result, /no "result"/],
    ["a result that is a list", (answer: any) => (answer.result = []), /no "result"/],
    ["another key beside result", (answer: any) => (answer.id = 1), /"id" beside "result"/],
    ["warnings that are no list", (answer: any) => (answer.warnings = "careful"), /"warnings" is not a list/],
    ["a ledger_index of text", (answer: any) => (answer.result.ledger_index = "107780245"), /ledger_index is not a ledger index/],
    ["a ledger_index of 0", (answer: any) => (answer.result.ledger_index = 0), /ledger_index is not a ledger index/],
    ["a ledger_index with a fraction", (answer: any) => (answer.result.ledger_index = 1.5), /ledger_index is not a ledger index/],
    ["no ledger_hash", (answer: any) => delete answer.result.ledger_hash, /ledger_hash is not a ledger hash/],
    ["a ledger_hash of lower case", (answer: any) => (answer.result.ledger_hash = HASH.toLowerCase()), /ledger_hash is not a ledger hash/],
  ])("refuses %s", (_name, change, message) => {
    expect(() => acceptAnswer(with_(change))).toThrow(message);
  });

  it.each([[null], [undefined], ["{}"], [[]], [5]])("refuses %j, which is no JSON object", (value) => {
    expect(() => acceptAnswer(value)).toThrow(/not a JSON object/);
  });
});

describe("what the recorder checks across the books of a network: checkOneLedger", () => {
  const HASH_A = "A".repeat(64);
  const HASH_B = "B".repeat(64);
  const recording = (net: NetworkName, name: string, ledger_index: number, ledger_hash: string): Recording => ({
    net,
    path: `${net}/node/book_offers/${name}.json`,
    answer: { result: { status: "success", ledger_hash, ledger_index, offers: [{}] } },
  });

  it("passes books of one ledger, a single book, nothing, and networks that are at their own ledgers", () => {
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 10, HASH_A), recording("xrpl", "c", 10, HASH_A)])).not.toThrow();
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A)])).not.toThrow();
    expect(() => checkOneLedger([])).not.toThrow();
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xahau", "x", 77, HASH_B), recording("xrpl", "b", 10, HASH_A), recording("xahau", "y", 77, HASH_B)])).not.toThrow();
  });

  it("refuses books of different ledgers, and names the network and the two files", () => {
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 11, HASH_B)])).toThrow(
      new RegExp(`books of xrpl are not of one ledger: xrpl/node/book_offers/a\\.json is ledger 10 \\(${HASH_A}\\), xrpl/node/book_offers/b\\.json is ledger 11 \\(${HASH_B}\\)`),
    );
  });

  it("refuses the same index with another hash, and the same hash with another index, and the third book that strays", () => {
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 10, HASH_B)])).toThrow(/not of one ledger/);
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 11, HASH_A)])).toThrow(/not of one ledger/);
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 10, HASH_A), recording("xrpl", "c", 11, HASH_B)])).toThrow(/xrpl\/node\/book_offers\/c\.json is ledger 11/);
  });

  it("holds each network to its own books: a stray book of xahau is refused although xrpl is at one ledger", () => {
    expect(() =>
      checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xahau", "x", 77, HASH_B), recording("xrpl", "b", 10, HASH_A), recording("xahau", "y", 78, HASH_B)]),
    ).toThrow(/books of xahau are not of one ledger/);
  });
});

describe.each(BOOKS)("the recorded book $net $gets.currency for $pays.currency", (book) => {
  const file = fileOf(book);
  const row = () => provenanceRows().find((candidate) => candidate.file === file);
  const answer = (): any => JSON.parse(read(file));

  // As served: `result`, and beside it only what the node adds of its own (Clio's `warnings`, a list).
  it("is a whole JSON-RPC answer, { result }, of a successful call", () => {
    const { result, warnings, ...other } = answer();
    expect(other).toEqual({});
    expect(warnings === undefined || Array.isArray(warnings)).toBe(true);
    expect(result.status).toBe("success");
  });

  // Clio, which the configured XRPL node is, leaves `validated` out of a book read at ledger_index "validated" (it serves validated ledgers only);
  // xahaud says `validated: true`. Never false.
  it("is of a validated ledger: validated is true or absent", () => {
    const { validated } = answer().result;
    expect(validated === undefined || validated === true, `validated: ${String(validated)}`).toBe(true);
  });

  it("is read at the ledger its row of PROVENANCE.md names", () => {
    const { ledger_index } = answer().result;
    expect(Number.isSafeInteger(ledger_index) && ledger_index > 0, `ledger_index: ${String(ledger_index)}`).toBe(true);
    expect(row(), `a row for ${file}`).toBeDefined();
    expect(String(ledger_index)).toBe(row()!.ledgerIndex);
  });

  it("holds the offers of the book, as many as its row says and no more than were asked for", () => {
    const { offers } = answer().result;
    expect(Array.isArray(offers)).toBe(true);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(LIMIT);
    expect(String(offers.length)).toBe(row()!.offers);
  });

  it("holds offers of the assets asked: they give taker_gets and want taker_pays", () => {
    const side = (amount: unknown, asset: Asset): boolean =>
      asset.issuer === undefined
        ? typeof amount === "string" && /^\d+$/.test(amount)
        : typeof amount === "object" && amount !== null && (amount as Asset).currency === asset.currency && (amount as Asset).issuer === asset.issuer;
    for (const offer of answer().result.offers) {
      expect(side(offer.TakerGets, book.gets), JSON.stringify(offer.TakerGets)).toBe(true);
      expect(side(offer.TakerPays, book.pays), JSON.stringify(offer.TakerPays)).toBe(true);
    }
  });

  it("is an answer the recorder accepts: success, validated, offers", () => {
    expect(() => acceptAnswer(answer())).not.toThrow();
  });

  it("is the text the recorder writes: the answer as served, in fixtureText's layout", () => {
    expect(read(file)).toBe(fixtureText(answer()));
  });
});

// =====================================================================================================================
// The generated part: the pair files and the markets table, written by scripts/market-fixtures.ts (`pnpm fixtures:sync`).
//
// The requests are worked out here from the calls of spec 3.3 and the windows of market-params.ts (`candleWindow`, `dayWindowStart`), the files are
// the ones those requests find, and every number is checked against the trades it is made of: on XRPL the trades derived from the recorded ledgers
// (`derivedExchanges`, inverted with `invertedExchange` for the other orientation), on Xahau the synthetic trades of EVR/XAH's own list pages. The
// markets table follows the data API's reference at the pinned D2 commit (test/fixtures/PROVENANCE.md, "Synthetic aggregates").
// =====================================================================================================================

type Net = NetworkName;
type Filter = AmmFilter | null;
type Json = any;

const NETWORKS: Net[] = ["xrpl", "xahau"];
const NATIVE: Record<Net, string> = { xrpl: "XRP", xahau: "XAH" };
/** The XRP/RLUSD pool (scripts/amm-info-fixtures.ts). */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

const json = (path: string): Json => JSON.parse(read(path));
/** T: the close time of the newest recorded ledger, in unix seconds. */
const T: Record<Net, number> = {
  xrpl: Date.parse(json("xrpl/data-api/last_validated.json").close_time) / 1000,
  xahau: Date.parse(json("xahau/data-api/last_validated.json").close_time) / 1000,
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
const bodyOf = (call: Call): Json => json(marketFile(call));

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

  it("isMarketGenerated is true of the files marketFixtures writes and of no other generated file", () => {
    expect([...generate().keys()].filter(isMarketGenerated).sort()).toEqual([...marketFixtures().keys()].sort());
  });

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
      const body = JSON.parse(text) as Json;
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
    const newest = Number(json("xahau/data-api/last_validated.json").ledger_index);
    for (const row of tradesOf(pair)) {
      expect(row.ledger_index).toBeLessThanOrEqual(newest);
      expect(timeOf(row)).toBeLessThanOrEqual(T.xahau);
      expect(row.tx_hash).toMatch(/^[0-9A-F]{64}$/);
      expect(row.amm_account).toBeUndefined();
    }
  });
});

// ---- The markets table -----------------------------------------------------------------------------------------------

const ANSWER_KEYS = ["count", "end_time", "markets", "period", "result", "start_time", "totals"];
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
const answerOf = (net: Net, period: Period, amm: Filter): MarketsResponse => bodyOf(marketsCall(net, period, amm));
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
    native_volume: (nativeIsCounter ? f.counter : f.base).toString(),
    open: f.open.rate,
    high: f.high.rate,
    low: f.low.rate,
    last: f.close.rate,
    open_time: f.open.executed_time,
    last_time: f.close.executed_time,
    amm_share: net === "xahau" ? "0.0000" : new Wide(share(all.filter((row) => row.amm_account !== undefined))).dividedBy(share(all)).toFixed(4, BigNumber.ROUND_HALF_UP),
    amm_pool: pool,
    sparkline,
  };
}

describe.each(marketViews)("the markets table of $net, $period, amm $amm", ({ net, period, amm }) => {
  const answer = (): MarketsResponse => answerOf(net, period, amm);

  it("is the answer of the reference: its keys, the window from the hour a period before T to T, and amm echoed only when asked", () => {
    const body = answer();
    expect(Object.keys(body).sort()).toEqual([...ANSWER_KEYS, ...(amm === null ? [] : ["amm"])].sort());
    expect(body).toMatchObject({ result: "success", period });
    expect(body.amm).toBe(amm ?? undefined);
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

  it("sorts by native volume, largest first, and the rows without one last, by count, then by the pair", () => {
    const rows = answer().markets;
    for (let at = 1; at < rows.length; at++) {
      const [a, b] = [rows[at - 1]!, rows[at]!];
      if (a.native_volume !== undefined && b.native_volume !== undefined) {
        // No two native volumes are equal, so the order is the volume's alone.
        expect(new BigNumber(a.native_volume).gt(b.native_volume), `${a.native_volume} before ${b.native_volume}`).toBe(true);
      } else {
        expect(a.native_volume === undefined && b.native_volume !== undefined, "a row without a native volume before one with").toBe(false);
        if (a.native_volume === undefined) expect(a.count > b.count || (a.count === b.count && compareKeys(pairKey(a), pairKey(b)) < 0)).toBe(true);
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
