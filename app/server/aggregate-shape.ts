// What the answers of the data calls of the network page and of the markets pages must look like for the pages to use them: the stats, the fees by day,
// the fee snapshots, the three volumes and the validations of a ledger; and a pair's trades, candles, reduced row and active accounts, and the markets
// table. A list where a list belongs, dates as ISO text, amounts as decimal strings and counts as numbers, as data-api-new/docs/api-reference.md has them.
// Like `tx-shape.ts`, the data API client runs the checks inside the load its subrequest cache runs: a 200 that is not what the reference promises is an
// `UpstreamError` of kind `server` (status 200 marks it as an answer of the upstream), is held when the call asks, and is never stored. Each check takes
// the whole body and returns it, typed, as it is. Worker-only code, no I/O.
//
// A check makes the types of api-types.ts true: every key they do not mark optional is there, with the type they give it. Extra keys are not
// refused (the API may add a column, and the reference's own example of a fee row is a ledger's, with a `ledger_index` that a day's has not).

import type {
  ActiveAccounts,
  AmmFilter,
  AmmVolumeComponent,
  Candle,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeStatsRow,
  LedgerValidations,
  MarketsResponse,
  Page,
  PairExchange,
  PaymentVolumeComponent,
  ReducedRow,
  StatsRow,
  VolumeRow,
} from "./api-types";
import { isMarker } from "./marker";
import { isObject, malformed } from "./tx-shape";

const DECIMAL = /^-?\d+(\.\d+)?$/;
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
/** A share as D2b.1 writes it: exactly 4 decimals, `"0.3400"`. */
const SHARE = /^\d+\.\d{4}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** A decimal number as the API writes an exact amount: digits, a point and digits. Never an exponent. */
export function isDecimalText(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

/**
 * A number as the API writes a figure it computes: a decimal, or one in exponent form. The API formats with BigNumber: `precision8` (`toPrecision(8)`, a price,
 * a rate, a vwap) writes an exponent from 1e8 and below 1e-6 (`"1.2345679e+8"`, `"1.0000000e-7"`: a token priced at a ten-millionth of an XRP), and `toString()`
 * (a sum of volumes, a native volume cut to 17 digits) from 1e21 and below 1e-6. Those are exact texts like the others, and the pages compute with them as
 * with any decimal; refusing them would turn a pair of a junk token into an outage of the whole table. The text of `NaN`, `Infinity` and `""` is refused.
 * (The amounts that are plain by contract, `change` and the shares, are tested with `isDecimalText` and `isShare`.)
 */
export function isNumberText(value: unknown): value is string {
  return typeof value === "string" && NUMBER.test(value);
}

/** A time as the API writes it: `YYYY-MM-DDTHH:mm:ss(.SSS)?Z`, one that exists. */
export function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && ISO_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** A count of rows or an index: a whole number, not negative. */
const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isText = (value: unknown): value is string => typeof value === "string";
/** A name that is there: a currency, an account, a hash. */
const isName = (value: unknown): value is string => typeof value === "string" && value !== "";
const isShare = (value: unknown): value is string => typeof value === "string" && SHARE.test(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** The list that the answer keeps its rows under, each row an object. */
function rowsOf(what: string, body: unknown, key: string): Array<Record<string, unknown>> {
  const list = isObject(body) ? body[key] : undefined;
  if (!Array.isArray(list)) throw malformed(what, `no list of ${key}`);
  for (const [index, row] of (list as unknown[]).entries()) {
    if (!isObject(row)) throw malformed(what, `${key}[${index}] is not an object`);
  }
  return list as Array<Record<string, unknown>>;
}

/** Throws unless each of `names` is a field of `row` that satisfies `is`; `kind` says what it should have been. */
function fields(what: string, where: string, row: Record<string, unknown>, names: readonly string[], is: (value: unknown) => boolean, kind: string): void {
  for (const name of names) {
    if (!is(row[name])) throw malformed(what, `${where}.${name} is not ${kind}`);
  }
}

/** Throws unless each of `names` that `row` has (a key the API leaves out when it has none) satisfies `is`. */
function optionalFields(what: string, where: string, row: Record<string, unknown>, names: readonly string[], is: (value: unknown) => boolean, kind: string): void {
  for (const name of names) {
    if (row[name] !== undefined && !is(row[name])) throw malformed(what, `${where}.${name} is not ${kind}`);
  }
}

/** Throws unless `value` is a currency: a name, and an issuer when it has one. */
function checkAsset(what: string, where: string, value: unknown): void {
  if (!isObject(value) || !isText(value.currency) || value.currency === "" || (value.issuer !== undefined && !isText(value.issuer))) {
    throw malformed(what, `${where} is not a currency`);
  }
}

/** `GET /v2/stats/{family}`: a flat row, the start of its bucket and a number for each name. */
export function checkStatsPage(body: unknown): Page<"stats", StatsRow> {
  const what = "data API stats";
  for (const [index, row] of rowsOf(what, body, "stats").entries()) {
    const where = `stats[${index}]`;
    if (!isIsoTime(row.date)) throw malformed(what, `${where}.date is not a time`);
    for (const [name, value] of Object.entries(row)) {
      if (name !== "date" && !isCount(value)) throw malformed(what, `${where}.${name} is not a number`);
    }
  }
  return body as Page<"stats", StatsRow>;
}

/** `GET /v2/network/fees?interval=day`: what the transactions of each day paid, as JSON numbers. */
export function checkFeeBucketPage(body: unknown): Page<"rows", FeeBucketRow> {
  const what = "data API fees";
  for (const [index, row] of rowsOf(what, body, "rows").entries()) {
    const where = `rows[${index}]`;
    fields(what, where, row, ["avg", "max", "min", "total", "tx_count"], isCount, "a number");
    fields(what, where, row, ["date"], isIsoTime, "a time");
  }
  return body as Page<"rows", FeeBucketRow>;
}

/** `GET /v2/network/fee_stats`: snapshots of the node's fee state, as JSON numbers. */
export function checkFeeStatsPage(body: unknown): Page<"rows", FeeStatsRow> {
  const what = "data API fee stats";
  for (const [index, row] of rowsOf(what, body, "rows").entries()) {
    const where = `rows[${index}]`;
    fields(
      what,
      where,
      row,
      ["current_ledger_size", "current_queue_size", "expected_ledger_size", "median_fee", "minimum_fee", "open_ledger_fee", "pct_max_queue_size"],
      isCount,
      "a number",
    );
    fields(what, where, row, ["date"], isIsoTime, "a time");
  }
  return body as Page<"rows", FeeStatsRow>;
}

type VolumeComponents = { payment: PaymentVolumeComponent; exchange: ExchangeVolumeComponent; amm: AmmVolumeComponent };

const VOLUME_NAMES = { payment: "data API payment volume", exchange: "data API exchange volume", amm: "data API AMM volume" } as const;

/**
 * `GET /v2/network/{payment,exchange,amm}_volume` with `start` or `end`: a row for each bucket, with its components. The row's `total` and its
 * components' `amount`, `rate` and `converted_amount` are decimal strings (exact text: a JSON number would lose digits); the component
 * is the kind's: a currency for payments, a market (`base`, `counter`) for trades, a pool as well (`amm_account`) for swaps.
 */
export function checkVolumePage<K extends keyof VolumeComponents>(kind: K, body: unknown): Page<"rows", VolumeRow<VolumeComponents[K]>> {
  const what = VOLUME_NAMES[kind];
  for (const [index, row] of rowsOf(what, body, "rows").entries()) {
    const where = `rows[${index}]`;
    fields(what, where, row, ["count"], isCount, "a number");
    fields(what, where, row, ["total", "exchange_rate"], isDecimalText, "a decimal");
    fields(what, where, row, ["start_time", "end_time"], isIsoTime, "a time");
    checkAsset(what, `${where}.exchange`, row.exchange);
    const components = row.components;
    if (!Array.isArray(components)) throw malformed(what, `${where}.components is not a list`);
    for (const [at, component] of (components as unknown[]).entries()) {
      const here = `${where}.components[${at}]`;
      if (!isObject(component)) throw malformed(what, `${here} is not an object`);
      fields(what, here, component, ["count"], isCount, "a number");
      fields(what, here, component, ["amount", "rate", "converted_amount"], isDecimalText, "a decimal");
      if (kind === "payment") {
        fields(what, here, component, ["currency"], (value) => isText(value) && value !== "", "a currency");
        if (component.issuer !== undefined && !isText(component.issuer)) throw malformed(what, `${here}.issuer is not text`);
      } else {
        checkAsset(what, `${here}.base`, component.base);
        checkAsset(what, `${here}.counter`, component.counter);
      }
      if (kind === "amm") fields(what, here, component, ["amm_account"], (value) => isText(value) && value !== "", "an account");
    }
  }
  return body as Page<"rows", VolumeRow<VolumeComponents[K]>>;
}

/** The columns of a validation that are text when they are there. */
const OPTIONAL_VALIDATION_TEXT = [
  "amendments",
  "base_fee",
  "ephemeral_public_key",
  "full",
  "load_fee",
  "reporter_public_key",
  "reserve_base",
  "reserve_inc",
  "signature",
] as const;

/** `GET /v2/ledgers/{ledger_hash}/validations`: one validation per validator. Values are text, except `count`. */
export function checkValidations(body: unknown): LedgerValidations {
  const what = "data API validations";
  for (const [index, row] of rowsOf(what, body, "validations").entries()) {
    const where = `validations[${index}]`;
    fields(what, where, row, ["count"], isCount, "a number");
    fields(what, where, row, ["first_datetime", "last_datetime"], isIsoTime, "a time");
    fields(what, where, row, ["flags", "ledger_hash", "ledger_index", "signing_time"], isText, "text");
    fields(what, where, row, ["validation_public_key"], (value) => isText(value) && value !== "", "a key");
    for (const name of OPTIONAL_VALIDATION_TEXT) {
      if (row[name] !== undefined && !isText(row[name])) throw malformed(what, `${where}.${name} is not text`);
    }
  }
  return body as LedgerValidations;
}

// ---- A pair: its trades, candles, reduced row and active accounts ------------------------------------------------------------------------------------

/** The rows of a list answer under `key`, after its `count` and its `marker` (when there is one, a token the explorer may send back). */
function listOf(what: string, body: unknown, key: string): Array<Record<string, unknown>> {
  const rows = rowsOf(what, body, key);
  const head = body as Record<string, unknown>;
  if (!isWhole(head.count)) throw malformed(what, "count is not a number");
  if (head.marker !== undefined && !isMarker(head.marker)) throw malformed(what, "marker is not a marker");
  return rows;
}

/** The pair a trade, a candle or a reduced row is of: two currencies, and an issuer for each that has one. */
function checkPairOf(what: string, where: string, row: Record<string, unknown>): void {
  fields(what, where, row, ["base_currency", "counter_currency"], isName, "a currency");
  optionalFields(what, where, row, ["base_issuer", "counter_issuer"], isName, "an issuer");
}

/** `GET /v2/exchanges/{base}/{counter}`: the trades of a pair, each in the key order of the original's row (`PairExchange`). */
export function checkPairExchanges(body: unknown): Page<"exchanges", PairExchange> {
  const what = "data API pair exchanges";
  for (const [index, row] of listOf(what, body, "exchanges").entries()) {
    const where = `exchanges[${index}]`;
    fields(what, where, row, ["base_amount", "counter_amount", "rate"], isNumberText, "a number as text");
    fields(what, where, row, ["node_index", "tx_index", "ledger_index", "offer_sequence"], isWhole, "a whole number");
    fields(what, where, row, ["executed_time"], isIsoTime, "a time");
    fields(what, where, row, ["buyer", "provider", "seller", "taker"], isText, "text");
    fields(what, where, row, ["tx_hash", "tx_type"], isName, "text");
    checkPairOf(what, where, row);
    optionalFields(what, where, row, ["autobridged_currency", "autobridged_issuer", "amm_account"], isName, "text");
  }
  return body as Page<"exchanges", PairExchange>;
}

/** The prices and volumes that a candle and a reduced row share. */
function checkFigures(what: string, where: string, row: Record<string, unknown>): void {
  fields(what, where, row, ["open", "high", "low", "close", "vwap", "base_volume", "counter_volume"], isNumberText, "a number as text");
  fields(what, where, row, ["buy_volume"], isCount, "a number");
  fields(what, where, row, ["count"], isWhole, "a whole number");
  checkPairOf(what, where, row);
}

/** `GET /v2/exchanges/{base}/{counter}?interval=`: the candles of a pair (`Candle`), prices and volumes as text, `count` and `buy_volume` as numbers. */
export function checkCandles(body: unknown): Page<"exchanges", Candle> {
  const what = "data API candles";
  for (const [index, row] of listOf(what, body, "exchanges").entries()) {
    const where = `exchanges[${index}]`;
    checkFigures(what, where, row);
    fields(what, where, row, ["close_time", "open_time", "start"], isIsoTime, "a time");
  }
  return body as Page<"exchanges", Candle>;
}

/**
 * `GET /v2/exchanges/{base}/{counter}?reduce=true`: the one row that summarizes the window (`ReducedRow`). An answer with no row, or with more than one, is not
 * that: the page would show the first of several, or nothing.
 */
export function checkReduce(body: unknown): Page<"exchanges", ReducedRow> {
  const what = "data API reduced exchanges";
  const rows = listOf(what, body, "exchanges");
  if (rows.length !== 1) throw malformed(what, `${rows.length} rows, not one`);
  const [row = {}] = rows;
  checkFigures(what, "exchanges[0]", row);
  fields(what, "exchanges[0]", row, ["start"], isIsoTime, "a time");
  optionalFields(what, "exchanges[0]", row, ["open_time", "close_time"], isIsoTime, "a time");
  return body as Page<"exchanges", ReducedRow>;
}

/** What an account bought or sold. */
function checkSide(what: string, where: string, side: unknown): void {
  if (!isObject(side)) throw malformed(what, `${where} is not an object`);
  fields(what, where, side, ["base_volume", "counter_volume"], isNumberText, "a number as text");
  fields(what, where, side, ["count"], isWhole, "a whole number");
}

/**
 * `GET /v2/active_accounts/{base}/{counter}`: the accounts that traded a pair, sorted by base volume. Every account is checked (the client keeps the first
 * ten afterwards, so a malformed one beyond them is still the API failing).
 */
export function checkActiveAccounts(body: unknown): ActiveAccounts {
  const what = "data API active accounts";
  const accounts = rowsOf(what, body, "accounts");
  fields(what, "answer", body as Record<string, unknown>, ["count", "exchanges_count"], isWhole, "a whole number");
  for (const [index, account] of accounts.entries()) {
    const where = `accounts[${index}]`;
    fields(what, where, account, ["account"], isName, "an account");
    fields(what, where, account, ["base_volume", "counter_volume"], isNumberText, "a number as text");
    fields(what, where, account, ["count"], isWhole, "a whole number");
    checkSide(what, `${where}.buy`, account.buy);
    checkSide(what, `${where}.sell`, account.sell);
  }
  return body as ActiveAccounts;
}

// ---- The markets table --------------------------------------------------------------------------------------------------------------------------------

const MARKETS_PERIODS = ["day", "7day", "30day"];

/** The `amm` an answer carries, for the one that was asked for: the one asked for, or, when none was, nothing or the default. */
function checkAmmEchoed(what: string, echoed: unknown, asked: AmmFilter | undefined): void {
  const shown = echoed === undefined ? "missing" : JSON.stringify(echoed);
  if (asked === undefined) {
    if (echoed !== undefined && echoed !== "include") throw malformed(what, `amm is ${shown}, and no filter was asked for`);
  } else if (echoed !== asked) {
    throw malformed(what, `amm is ${shown}, not the ${JSON.stringify(asked)} that was asked for (an API that ignored the filter?)`);
  }
}

/** The `{ date, close? }` days of a market's sparkline. */
function checkSparkline(what: string, where: string, days: unknown): void {
  if (!Array.isArray(days)) throw malformed(what, `${where} is not a list`);
  for (const [index, day] of (days as unknown[]).entries()) {
    const here = `${where}[${index}]`;
    if (!isObject(day)) throw malformed(what, `${here} is not an object`);
    fields(what, here, day, ["date"], isIsoTime, "a time");
    optionalFields(what, here, day, ["close"], isNumberText, "a number as text");
  }
}

/** `GET /v2/network/markets`, when it has a set: the totals over every pair that traded. */
function checkTotals(what: string, totals: unknown): void {
  if (!isObject(totals)) throw malformed(what, "totals is not an object");
  fields(what, "totals", totals, ["pairs", "pairs_traded", "count"], isWhole, "a whole number");
  fields(what, "totals", totals, ["native_volume"], isNumberText, "a number as text");
  optionalFields(what, "totals", totals, ["converted_volume"], isNumberText, "a number as text");
  optionalFields(what, "totals", totals, ["amm_share"], isShare, "a share with 4 decimals");
}

/**
 * `GET /v2/network/markets` (`MarketsResponse`). `asked` is the `amm` filter the request sent, if any: the answer must echo it in `amm`, or the data API
 * did not know the parameter (D2, which ignores it) and the rows are the unfiltered ones, which a page would show as the order book's or the swaps'. A request
 * with no filter takes an answer with no `amm`, or the default `include`. The AMM keys of the answer, the totals and the rows are checked when they are
 * there (D2b.1: present only when known); their absence is not a failure. Prices, volumes and the native volume are numbers as text (`isNumberText`).
 */
export function checkMarkets(body: unknown, asked?: AmmFilter): MarketsResponse {
  const what = "data API markets";
  const markets = rowsOf(what, body, "markets");
  const head = body as Record<string, unknown>;
  if (head.result !== "success") throw malformed(what, "result is not success");
  if (!MARKETS_PERIODS.includes(head.period as string)) throw malformed(what, "period is not day, 7day or 30day");
  fields(what, "answer", head, ["count"], isWhole, "a whole number");
  checkAmmEchoed(what, head.amm, asked);
  optionalFields(what, "answer", head, ["start_time", "end_time"], isIsoTime, "a time");
  if (head.exchange !== undefined) checkAsset(what, "exchange", head.exchange);
  optionalFields(what, "answer", head, ["exchange_rate"], isNumberText, "a number as text");
  if (head.totals !== undefined) checkTotals(what, head.totals);
  for (const [index, row] of markets.entries()) {
    const where = `markets[${index}]`;
    checkPairOf(what, where, row);
    fields(what, where, row, ["count"], isWhole, "a whole number");
    fields(what, where, row, ["base_volume", "counter_volume", "open", "high", "low", "last"], isNumberText, "a number as text");
    optionalFields(what, where, row, ["native_volume", "converted_volume"], isNumberText, "a number as text");
    optionalFields(what, where, row, ["change"], isDecimalText, "a decimal");
    fields(what, where, row, ["open_time", "last_time"], isIsoTime, "a time");
    optionalFields(what, where, row, ["amm_share"], isShare, "a share with 4 decimals");
    optionalFields(what, where, row, ["amm_pool"], isBoolean, "a boolean");
    checkSparkline(what, `${where}.sparkline`, row.sparkline);
  }
  return body as MarketsResponse;
}
