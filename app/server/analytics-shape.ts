// What the answers of D2's account routes must look like for the Analytics tab of the account page to use them: `GET /v2/accounts/{address}/stats/{family}`
// with an `interval`, and `analytics/{balances,balance_changes,counterparties,exchanges}` (data-api-new/docs/api-reference.md at feat/explorer-data 7d495ab;
// the types are in api-types.ts, "Account analytics"). Like `aggregate-shape.ts`, the data API client runs the checks inside the load its subrequest cache
// runs: a 200 that is not what the reference promises is an `UpstreamError` of kind `server` (status 200 marks it as an answer of the upstream), is held
// when the call asks, and is never stored, and the card of the call fails with it (spec 2.8). Each check takes the whole body and returns it, typed, as it is.
// Worker-only code (an address is checked by `isAccount` of aggregate-shape.ts, with `ripple-address-codec`), no I/O.
//
// What is checked: lists are lists; the answer says `success`; the date of a row is a UTC midnight that starts a bucket of the interval asked for (a Monday
// for a week, the 1st for a month: an API without D2 ignores `interval` and answers days); the `interval` an answer echoes is the one asked for; amounts and
// values are numbers as text (`isNumberText`: D2 writes them with bignumber.js's `toString()`, in exponent form below 1e-6 and from 1e21, as E2's and E3's
// calls of the same API are taken), counts whole numbers; an account (a counterparty, an issuer) is a classic address, because it goes into a link; a currency is 3
// characters or 40 hex digits; `stats/{family}` has no `marker`. Extra keys are not refused (the API may add a column), and a key the API leaves out when it
// has no value (`counterparty`, `issuer`, `change_type`, `native_volume`) is checked when it is there: `null` is never served.

import type { AnalyticsUnit } from "../domain/analytics-params";
import { fields, isAccount, isIsoTime, isName, isNumberText, isWhole, optionalFields, rowsOf } from "./aggregate-shape";
import type {
  AccountTxStatsRow,
  AccountValueRow,
  AnalyticsBalanceChanges,
  AnalyticsBalances,
  AnalyticsCounterparties,
  AnalyticsExchanges,
  Page,
} from "./api-types";
import { isObject, malformed } from "./tx-shape";

/** The `date` of a bucket as the API writes it: the start of a UTC day. */
const BUCKET_DATE = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/;
/** A currency: 3 characters (`XRP`, `USD`), or a 160-bit code as 40 hex digits. */
const CURRENCY = /^(?:.{3}|[0-9A-Fa-f]{40})$/;

/** What a row's `date` should have been, for the message of a refusal. */
const BUCKET_START: Record<AnalyticsUnit, string> = {
  day: "a day (UTC midnight)",
  week: "the start of a week (a Monday, UTC midnight)",
  month: "the start of a month (the 1st, UTC midnight)",
};

/** The start of a bucket of `unit`, as a row's `date` writes it: a day that exists, at UTC midnight, a Monday for a week and the 1st for a month. */
function isBucketStart(value: unknown, unit: AnalyticsUnit): value is string {
  if (typeof value !== "string" || !BUCKET_DATE.test(value)) return false;
  const start = new Date(value);
  // A day that is none (`2026-02-30`) is NaN or rolls over to the next month: what it reads back as must be what it was written as.
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value.slice(0, 10)) return false;
  if (unit === "week") return start.getUTCDay() === 1;
  if (unit === "month") return start.getUTCDate() === 1;
  return true;
}

const isCurrency = (value: unknown): value is string => typeof value === "string" && CURRENCY.test(value);

/** The answer as an object that says `success`. */
function headOf(what: string, body: unknown): Record<string, unknown> {
  if (!isObject(body)) throw malformed(what, "the answer is not an object");
  if (body.result !== "success") throw malformed(what, "result is not success");
  return body;
}

/** The window of an answer: where its first bucket or day starts, and where the one after its last does. */
function checkWindow(what: string, head: Record<string, unknown>): void {
  fields(what, "answer", head, ["start", "end"], isIsoTime, "a time");
}

/** The `interval` an answer carries must be the one that was asked for: an API that ignores the parameter says nothing or answers days. */
function checkInterval(what: string, head: Record<string, unknown>, asked: AnalyticsUnit): void {
  if (head.interval === asked) return;
  const shown = head.interval === undefined ? "missing" : JSON.stringify(head.interval);
  throw malformed(what, `interval is ${shown}, not the ${JSON.stringify(asked)} that was asked for (an API that ignored the parameter?)`);
}

/** The `date` of a row: the start of a bucket of `unit`. */
function checkBucketStart(what: string, where: string, row: Record<string, unknown>, unit: AnalyticsUnit): void {
  fields(what, where, row, ["date"], (value) => isBucketStart(value, unit), BUCKET_START[unit]);
}

const WHOLE = "a whole number";
/**
 * An amount or a value: a decimal, or one in exponent form (a dust payment, a remnant of a partly filled offer, an in and out that nearly cancel). The
 * builders read it with bignumber.js and hand on `toFixed()`, so no exponent reaches the page.
 */
const NUMBER = "a number as text";

// ---- stats/{family}?interval= ---------------------------------------------------------------------------------------------------------------------

/** What a map of codes to counts (`result`, `type`) has under each code. */
function checkCounts(what: string, where: string, counts: unknown): void {
  if (!isObject(counts)) throw malformed(what, `${where} is not an object`);
  for (const [name, count] of Object.entries(counts)) {
    if (!isWhole(count)) throw malformed(what, `${where}.${name} is not ${WHOLE}`);
  }
}

/**
 * `GET /v2/accounts/{address}/stats/{family}?interval=` (`family` is `value` or `transactions`; the answer keeps its rows under `rows`): a row for each bucket,
 * dated by the start of the bucket of `interval`. The explorer asks with `limit=1000`, which keeps every bucket of a period on one page, so an answer with a
 * `marker` is not the one it asked for.
 */
export function checkAccountStats(body: unknown, family: "value", interval: AnalyticsUnit, what: string): Page<"rows", AccountValueRow>;
export function checkAccountStats(body: unknown, family: "transactions", interval: AnalyticsUnit, what: string): Page<"rows", AccountTxStatsRow>;
export function checkAccountStats(
  body: unknown,
  family: "value" | "transactions",
  interval: AnalyticsUnit,
  what: string,
): Page<"rows", AccountValueRow> | Page<"rows", AccountTxStatsRow>;
export function checkAccountStats(
  body: unknown,
  family: "value" | "transactions",
  interval: AnalyticsUnit,
  what: string,
): Page<"rows", AccountValueRow> | Page<"rows", AccountTxStatsRow> {
  const head = headOf(what, body);
  const rows = rowsOf(what, head, "rows");
  fields(what, "answer", head, ["count"], isWhole, WHOLE);
  if (head.marker !== undefined) throw malformed(what, "there is a marker: more buckets than the one page that was asked for");
  for (const [index, row] of rows.entries()) {
    const where = `rows[${index}]`;
    checkBucketStart(what, where, row, interval);
    if (family === "value") {
      fields(what, where, row, ["account_value"], isNumberText, NUMBER);
      fields(what, where, row, ["balance_change_count"], isWhole, WHOLE);
    } else {
      fields(what, where, row, ["transaction_count"], isWhole, WHOLE);
      checkCounts(what, `${where}.result`, row.result);
      checkCounts(what, `${where}.type`, row.type);
    }
  }
  return body as Page<"rows", AccountValueRow> | Page<"rows", AccountTxStatsRow>;
}

// ---- analytics/balances ----------------------------------------------------------------------------------------------------------------------------

/** A line or a row of balances: a currency, the account it is owed by or to (none for the native currency), and the balance, negative where the account owes. */
function checkBalanceOf(what: string, where: string, line: Record<string, unknown>): void {
  fields(what, where, line, ["currency"], isCurrency, "a currency (3 characters or 40 hex digits)");
  optionalFields(what, where, line, ["counterparty"], isAccount, "a classic address");
  fields(what, where, line, ["balance"], isNumberText, NUMBER);
}

/** `GET /v2/accounts/{address}/analytics/balances?interval=` (`AnalyticsBalances`): the lines, and a row of balance for each line and bucket. */
export function checkAnalyticsBalances(body: unknown, interval: AnalyticsUnit, what: string): AnalyticsBalances {
  const head = headOf(what, body);
  checkInterval(what, head, interval);
  checkWindow(what, head);
  fields(what, "answer", head, ["lines_total", "count"], isWhole, WHOLE);
  for (const [index, line] of rowsOf(what, head, "lines").entries()) checkBalanceOf(what, `lines[${index}]`, line);
  for (const [index, row] of rowsOf(what, head, "rows").entries()) {
    const where = `rows[${index}]`;
    checkBucketStart(what, where, row, interval);
    checkBalanceOf(what, where, row);
  }
  return body as AnalyticsBalances;
}

// ---- analytics/balance_changes -----------------------------------------------------------------------------------------------------------------------

/**
 * `GET /v2/accounts/{address}/analytics/balance_changes?interval=` (`AnalyticsBalanceChanges`): the totals of the window by change type, and the sums of each
 * bucket by change type. A change of a type the original never classified has no `change_type`, and a type the explorer does not know is a name like another.
 */
export function checkBalanceChanges(body: unknown, interval: AnalyticsUnit, what: string): AnalyticsBalanceChanges {
  const head = headOf(what, body);
  checkInterval(what, head, interval);
  checkWindow(what, head);
  fields(what, "answer", head, ["count"], isWhole, WHOLE);
  for (const [index, total] of rowsOf(what, head, "totals").entries()) {
    const where = `totals[${index}]`;
    optionalFields(what, where, total, ["change_type"], isName, "a change type");
    fields(what, where, total, ["count"], isWhole, WHOLE);
    fields(what, where, total, ["in_value", "out_value", "net_value"], isNumberText, NUMBER);
  }
  for (const [index, row] of rowsOf(what, head, "rows").entries()) {
    const where = `rows[${index}]`;
    checkBucketStart(what, where, row, interval);
    optionalFields(what, where, row, ["change_type"], isName, "a change type");
    fields(what, where, row, ["count"], isWhole, WHOLE);
    fields(what, where, row, ["in_value", "out_value"], isNumberText, NUMBER);
  }
  return body as AnalyticsBalanceChanges;
}

// ---- analytics/counterparties ------------------------------------------------------------------------------------------------------------------------

const SORTS = ["value", "count"];

/** `GET /v2/accounts/{address}/analytics/counterparties` (`AnalyticsCounterparties`): the first `limit` of `total` counterparties, largest first. */
export function checkCounterparties(body: unknown, what: string): AnalyticsCounterparties {
  const head = headOf(what, body);
  checkWindow(what, head);
  if (!SORTS.includes(head.sort as string)) throw malformed(what, "sort is not value or count");
  fields(what, "answer", head, ["total", "count"], isWhole, WHOLE);
  for (const [index, row] of rowsOf(what, head, "counterparties").entries()) {
    const where = `counterparties[${index}]`;
    fields(what, where, row, ["account"], isAccount, "a classic address");
    fields(what, where, row, ["sent_value", "received_value", "total_value"], isNumberText, NUMBER);
    fields(what, where, row, ["payments_sent", "payments_received"], isWhole, WHOLE);
    fields(what, where, row, ["first", "last"], isIsoTime, "a time");
  }
  return body as AnalyticsCounterparties;
}

// ---- analytics/exchanges -----------------------------------------------------------------------------------------------------------------------------

/** `GET /v2/accounts/{address}/analytics/exchanges` (`AnalyticsExchanges`): the first `limit` of `total` pairs, by native volume, largest first. */
export function checkAnalyticsExchanges(body: unknown, what: string): AnalyticsExchanges {
  const head = headOf(what, body);
  checkWindow(what, head);
  fields(what, "answer", head, ["total", "count"], isWhole, WHOLE);
  for (const [index, pair] of rowsOf(what, head, "pairs").entries()) {
    const where = `pairs[${index}]`;
    fields(what, where, pair, ["base_currency", "counter_currency"], isCurrency, "a currency (3 characters or 40 hex digits)");
    optionalFields(what, where, pair, ["base_issuer", "counter_issuer"], isAccount, "a classic address");
    fields(what, where, pair, ["count"], isWhole, WHOLE);
    fields(what, where, pair, ["base_volume", "counter_volume", "bought", "sold", "bought_counter", "sold_counter"], isNumberText, NUMBER);
    optionalFields(what, where, pair, ["native_volume"], isNumberText, NUMBER);
  }
  return body as AnalyticsExchanges;
}
