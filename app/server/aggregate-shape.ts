// What the answers of the network page's data calls must look like for the page to use them: the stats, the fees by day, the fee snapshots,
// the three volumes and the validations of a ledger. A list where a list belongs, dates as ISO text, amounts as decimal strings and counts as
// numbers, as data-api-new/docs/api-reference.md has them. Like `tx-shape.ts`, the data API client runs the checks inside the load its
// subrequest cache runs: a 200 that is not what the reference promises is an `UpstreamError` of kind `server` (status 200 marks it as an answer
// of the upstream), is held when the call asks, and is never stored. Each check takes the whole body and returns it, typed, as it is. Worker-only code, no I/O.
//
// A check makes the types of api-types.ts true: every key they do not mark optional is there, with the type they give it. Extra keys are not
// refused (the API may add a column, and the reference's own example of a fee row is a ledger's, with a `ledger_index` that a day's has not).

import type {
  AmmVolumeComponent,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeStatsRow,
  LedgerValidations,
  Page,
  PaymentVolumeComponent,
  StatsRow,
  VolumeRow,
} from "./api-types";
import { isObject, malformed } from "./tx-shape";

const DECIMAL = /^-?\d+(\.\d+)?$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** A decimal number as the API writes an exact amount: digits, a point and digits. Never an exponent. */
export function isDecimalText(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

/** A time as the API writes it: `YYYY-MM-DDTHH:mm:ss(.SSS)?Z`, one that exists. */
export function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && ISO_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === "string";

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
