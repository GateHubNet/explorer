import { classicAddressToXAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import {
  checkAccountStats,
  checkAnalyticsBalances,
  checkAnalyticsExchanges,
  checkBalanceChanges,
  checkCounterparties,
} from "./analytics-shape";
import { UpstreamError } from "./upstream";

// The examples are the built ones of data-api-new/docs/api-reference.md at feat/explorer-data 7d495ab (`<!-- d2-example … -->`: "interval on
// stats/{family}" and "Account analytics"), with two changes: the full addresses `ISSUER` and `OTHER` for the ones it writes, and `THIRD` for
// `rrrrUBy92h6worVCYERZcVCzgzgmHb17Dx`, which is the test world's and has no valid checksum (a test of `checkCounterparties` pins that the explorer refuses it: it
// would never link an account that is none). A defect is one change to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
type Defect = [what: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

const WHAT = "data API analytics";
/** What is no answer at all: each in a list of its own, so that `it.each` does not spread the arrays. */
const NO_ANSWER: unknown[][] = [[null], [undefined], ["success"], [3], [[]], [[{ result: "success", rows: [] }]]];
const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const OTHER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const THIRD = "rBtgXXrLQntDfCoJFhdnmhPqMuK2DuwepA";

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), in the words of `WHAT`. */
function refuses(check: (body: unknown) => unknown, body: unknown): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  expect((error as UpstreamError).message).toMatch(new RegExp(`^${WHAT} answered `));
}

/** `good` is taken and returned as it is, and every change in `defects` makes it a refused answer. */
function pins(check: (body: unknown) => unknown, good: unknown, defects: Defect[]): void {
  it("takes the reference's example, and returns it as it is", () => {
    expect(check(good)).toBe(good);
  });
  it.each(defects)("refuses %s", (_what, defect) => {
    const body = clone(good);
    defect(body);
    refuses(check, body);
  });
}

// ---- stats/{family} -----------------------------------------------------------------------------------------------------------------------------

describe("checkAccountStats", () => {
  // "the weeks of January 13 and 27 and of February 3": Mondays.
  const transactions = {
    result: "success",
    count: 3,
    rows: [
      { date: "2020-01-13T00:00:00Z", transaction_count: 3, result: { tesSUCCESS: 3 }, type: { Payment: 2, TrustSet: 1 } },
      { date: "2020-01-27T00:00:00Z", transaction_count: 1, result: { tecUNFUNDED_OFFER: 1 }, type: { OfferCreate: 1 } },
      { date: "2020-02-03T00:00:00Z", transaction_count: 1, result: { tesSUCCESS: 1 }, type: { Payment: 1 } },
    ],
  };
  // "a row for each month, with the value of the account at the end of it".
  const value = {
    result: "success",
    count: 4,
    rows: [
      { date: "2020-01-01T00:00:00Z", account_value: "100", balance_change_count: 1 },
      { date: "2020-02-01T00:00:00Z", account_value: "79.999988", balance_change_count: 2 },
      { date: "2020-03-01T00:00:00Z", account_value: "79.999976", balance_change_count: 1 },
      { date: "2020-04-01T00:00:00Z", account_value: "89.999976", balance_change_count: 2 },
    ],
  };

  describe("transactions by week", () => {
    const check = (body: unknown) => checkAccountStats(body, "transactions", "week", WHAT);
    pins(check, transactions, [
      ["a row dated on a Wednesday", (body) => (body.rows[0].date = "2026-10-14T00:00:00Z")],
      ["a row dated on a Sunday", (body) => (body.rows[0].date = "2026-10-11T00:00:00Z")],
      ["a row dated on a Monday, not at midnight", (body) => (body.rows[0].date = "2026-10-12T05:00:00Z")],
      ["a row dated on a Monday at midnight and a second", (body) => (body.rows[0].date = "2026-10-12T00:00:01Z")],
      ["a row dated with milliseconds", (body) => (body.rows[0].date = "2026-10-12T00:00:00.000Z")],
      ["a row dated with no time", (body) => (body.rows[0].date = "2026-10-12")],
      ["a date that is a number", (body) => (body.rows[0].date = 1792108800)],
      ["a row without a date", (body) => delete body.rows[1].date],
      ["a daily row (an API that ignored the interval)", (body) => (body.rows[1].date = "2020-01-28T00:00:00Z")],
      ["a marker", (body) => (body.marker = "MjAyMC0wMi0wMw")],
      ["a marker that is null", (body) => (body.marker = null)],
      ["rows that are an object", (body) => (body.rows = {})],
      ["rows that are null", (body) => (body.rows = null)],
      ["no rows", (body) => delete body.rows],
      ["the list under another name", (body) => ((body.stats = body.rows), delete body.rows)],
      ["a row that is text", (body) => body.rows.push("2020-02-10T00:00:00Z")],
      ["a row that is null", (body) => body.rows.push(null)],
      ["a row that is a list", (body) => body.rows.push([])],
      ["a count that is not a whole number", (body) => (body.count = 1.5)],
      ["a count that is negative", (body) => (body.count = -1)],
      ["a count that is text", (body) => (body.count = "3")],
      ["no count", (body) => delete body.count],
      ["a result that is not success", (body) => (body.result = "error")],
      ["no result", (body) => delete body.result],
      ["a transaction count that is not a whole number", (body) => (body.rows[0].transaction_count = 2.5)],
      ["a transaction count that is text", (body) => (body.rows[0].transaction_count = "3")],
      ["a transaction count that is negative", (body) => (body.rows[0].transaction_count = -3)],
      ["a transaction count beyond the safe integers", (body) => (body.rows[0].transaction_count = 2 ** 53)],
      ["no results", (body) => delete body.rows[0].result],
      ["results that are a list", (body) => (body.rows[0].result = [3])],
      ["results that are null", (body) => (body.rows[0].result = null)],
      ["a result count that is text", (body) => (body.rows[0].result.tesSUCCESS = "3")],
      ["a result count that is not a whole number", (body) => (body.rows[0].result.tesSUCCESS = 0.5)],
      ["no types", (body) => delete body.rows[0].type],
      ["types that are text", (body) => (body.rows[0].type = "Payment")],
      ["a type count that is null", (body) => (body.rows[0].type.Payment = null)],
      ["a type count that is negative", (body) => (body.rows[0].type.Payment = -1)],
    ]);
    it("takes the Mondays of every week of a year", () => {
      const rows = Array.from({ length: 52 }, (_, week) => ({
        date: new Date(Date.UTC(2025, 9, 6 + 7 * week)).toISOString().replace(".000Z", "Z"),
        transaction_count: 1,
        result: { tesSUCCESS: 1 },
        type: { Payment: 1 },
      }));
      expect(() => checkAccountStats({ result: "success", count: 52, rows }, "transactions", "week", WHAT)).not.toThrow();
    });
  });

  describe("value by month", () => {
    const check = (body: unknown) => checkAccountStats(body, "value", "month", WHAT);
    pins(check, value, [
      ["a row dated on the second", (body) => (body.rows[0].date = "2026-10-02T00:00:00Z")],
      ["a row dated on the last day of a month", (body) => (body.rows[1].date = "2020-02-29T00:00:00Z")],
      ["a row dated on a Monday that is not the first", (body) => (body.rows[1].date = "2026-10-12T00:00:00Z")],
      ["a row dated the first, not at midnight", (body) => (body.rows[1].date = "2020-02-01T12:00:00Z")],
      ["a daily row", (body) => (body.rows[1].date = "2020-02-02T00:00:00Z")],
      ["a marker", (body) => (body.marker = "MjAyMC0wNC0wMQ")],
      ["an account value that is a number", (body) => (body.rows[0].account_value = 100)],
      ["an account value in exponent form", (body) => (body.rows[0].account_value = "1e3")],
      ["an account value that is empty", (body) => (body.rows[0].account_value = "")],
      ["an account value with a trailing point", (body) => (body.rows[0].account_value = "100.")],
      ["an account value that is null", (body) => (body.rows[0].account_value = null)],
      ["no account value", (body) => delete body.rows[0].account_value],
      ["a change count that is not a whole number", (body) => (body.rows[0].balance_change_count = 1.5)],
      ["a change count that is text", (body) => (body.rows[0].balance_change_count = "1")],
      ["a change count that is negative", (body) => (body.rows[0].balance_change_count = -1)],
      ["no change count", (body) => delete body.rows[0].balance_change_count],
    ]);
    it("takes a negative or a fractional value, and a quiet bucket", () => {
      const body = { result: "success", count: 2, rows: [{ date: "2020-01-01T00:00:00Z", account_value: "-0.5", balance_change_count: 0 }, { date: "2020-02-01T00:00:00Z", account_value: "1034.5", balance_change_count: 0 }] };
      expect(checkAccountStats(body, "value", "month", WHAT)).toBe(body);
    });
  });

  describe("by day", () => {
    it("takes any midnight, and still only a midnight", () => {
      const good = { result: "success", count: 2, rows: [{ date: "2020-01-14T00:00:00Z", account_value: "1", balance_change_count: 1 }, { date: "2020-01-15T00:00:00Z", account_value: "1", balance_change_count: 0 }] };
      expect(checkAccountStats(good, "value", "day", WHAT)).toBe(good);
      const late: Body = clone(good);
      late.rows[1].date = "2020-01-15T00:00:01Z";
      refuses((body) => checkAccountStats(body, "value", "day", WHAT), late);
    });
  });

  describe("a date that is no day", () => {
    it.each(["2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-13-01T00:00:00Z", "2026-00-10T00:00:00Z", "2026-10-00T00:00:00Z"])(
      "refuses %s under every interval",
      (date) => {
        for (const interval of ["day", "week", "month"] as const) {
          refuses(
            (body) => checkAccountStats(body, "value", interval, WHAT),
            { result: "success", count: 1, rows: [{ date, account_value: "1", balance_change_count: 1 }] },
          );
        }
      },
    );
    it("takes the 29th of February of a leap year", () => {
      const body = { result: "success", count: 1, rows: [{ date: "2028-02-29T00:00:00Z", account_value: "1", balance_change_count: 1 }] };
      expect(checkAccountStats(body, "value", "day", WHAT)).toBe(body);
    });
  });

  it.each(NO_ANSWER)("refuses %j, which is no answer", (body) => {
    refuses((answer) => checkAccountStats(answer, "value", "week", WHAT), body);
    refuses((answer) => checkAccountStats(answer, "transactions", "week", WHAT), body);
  });

  it("takes an answer with no rows, as D2 answers an account it has nothing of", () => {
    const empty = { result: "success", count: 0, rows: [] };
    expect(checkAccountStats(empty, "value", "week", WHAT)).toBe(empty);
    expect(checkAccountStats(empty, "transactions", "month", WHAT)).toBe(empty);
  });

  it("refuses the rows of the other family: a transactions row is no value row, and the other way round", () => {
    refuses((body) => checkAccountStats(body, "value", "week", WHAT), transactions);
    refuses((body) => checkAccountStats(body, "transactions", "month", WHAT), value);
  });

  it("names what it was asked about in the refusal", () => {
    let error: unknown;
    try {
      checkAccountStats({ result: "success", count: 0, rows: {} }, "value", "week", "the account value");
    } catch (caught) {
      error = caught;
    }
    expect((error as UpstreamError).message).toMatch(/^the account value answered something unexpected: /);
  });
});

// ---- analytics/balances -------------------------------------------------------------------------------------------------------------------------

describe("checkAnalyticsBalances", () => {
  const balances = {
    result: "success",
    start: "2020-03-01T00:00:00Z",
    end: "2020-06-01T00:00:00Z",
    interval: "month",
    lines_total: 3,
    lines: [
      { currency: "XRP", balance: "84.999976" },
      { currency: "USD", counterparty: ISSUER, balance: "20" },
      { currency: "CAD", counterparty: OTHER, balance: "-5" },
    ],
    count: 7,
    rows: [
      { date: "2020-03-01T00:00:00Z", currency: "XRP", balance: "79.999976" },
      { date: "2020-03-01T00:00:00Z", currency: "USD", counterparty: ISSUER, balance: "40" },
      { date: "2020-04-01T00:00:00Z", currency: "XRP", balance: "84.999976" },
      { date: "2020-04-01T00:00:00Z", currency: "USD", counterparty: ISSUER, balance: "20" },
      { date: "2020-05-01T00:00:00Z", currency: "XRP", balance: "84.999976" },
      { date: "2020-05-01T00:00:00Z", currency: "USD", counterparty: ISSUER, balance: "20" },
      { date: "2020-05-01T00:00:00Z", currency: "CAD", counterparty: OTHER, balance: "-5" },
    ],
  };
  const check = (body: unknown) => checkAnalyticsBalances(body, "month", WHAT);

  pins(check, balances, [
    ["a month row dated on the second", (body) => (body.rows[0].date = "2026-10-02T00:00:00Z")],
    ["a month row dated on a Monday", (body) => (body.rows[2].date = "2020-04-06T00:00:00Z")],
    ["a month row not at midnight", (body) => (body.rows[0].date = "2020-03-01T05:00:00Z")],
    ["the day echoed when the month was asked", (body) => (body.interval = "day")],
    ["the week echoed when the month was asked", (body) => (body.interval = "week")],
    ["no interval", (body) => delete body.interval],
    ["an interval that is null", (body) => (body.interval = null)],
    ["an interval that is a month in other words", (body) => (body.interval = "monthly")],
    ["a result that is not success", (body) => (body.result = "failure")],
    ["a start that is not a time", (body) => (body.start = "2020-03-01")],
    ["no end", (body) => delete body.end],
    ["lines that are an object", (body) => (body.lines = {})],
    ["no lines", (body) => delete body.lines],
    ["lines that are null", (body) => (body.lines = null)],
    ["a line that is text", (body) => body.lines.push("XRP")],
    ["rows that are an object", (body) => (body.rows = {})],
    ["no rows", (body) => delete body.rows],
    ["rows that are null", (body) => (body.rows = null)],
    ["a row that is null", (body) => body.rows.push(null)],
    ["a lines total that is not a whole number", (body) => (body.lines_total = 3.5)],
    ["a lines total that is text", (body) => (body.lines_total = "3")],
    ["no lines total", (body) => delete body.lines_total],
    ["a count that is not a whole number", (body) => (body.count = 1.5)],
    ["a count that is negative", (body) => (body.count = -7)],
    ["a balance that is a number", (body) => (body.rows[0].balance = 79.999976)],
    ["a balance in exponent form", (body) => (body.rows[0].balance = "1e3")],
    ["a balance with a plus", (body) => (body.rows[0].balance = "+5")],
    ["a balance with a comma", (body) => (body.rows[0].balance = "1,000")],
    ["no balance in a row", (body) => delete body.rows[0].balance],
    ["a balance of a line that is a number", (body) => (body.lines[0].balance = 84.999976)],
    ["no balance in a line", (body) => delete body.lines[1].balance],
    ["a currency of 4 characters in a line", (body) => (body.lines[1].currency = "USDX")],
    ["a currency of 4 characters in a row", (body) => (body.rows[1].currency = "USDX")],
    ["a currency of 2 characters", (body) => (body.rows[1].currency = "US")],
    ["a currency that is empty", (body) => (body.rows[1].currency = "")],
    ["a currency of 40 characters that are not all hex", (body) => (body.rows[1].currency = `${"A".repeat(39)}G`)],
    ["a currency of 41 hex digits", (body) => (body.rows[1].currency = "A".repeat(41))],
    ["a currency of 39 hex digits", (body) => (body.rows[1].currency = "A".repeat(39))],
    ["a currency that is a number", (body) => (body.rows[1].currency = 840)],
    ["no currency", (body) => delete body.rows[1].currency],
    ["a counterparty that is not an address in a line", (body) => (body.lines[1].counterparty = "rBad")],
    ["a counterparty that is not an address in a row", (body) => (body.rows[1].counterparty = "rBad")],
    ["a counterparty with a bad checksum", (body) => (body.rows[1].counterparty = `${ISSUER.slice(0, -1)}x`)],
    ["a counterparty that is an X-address", (body) => (body.rows[1].counterparty = classicAddressToXAddress(ISSUER, false, false))],
    ["a counterparty that is empty", (body) => (body.rows[1].counterparty = "")],
    ["a counterparty that is null", (body) => (body.rows[1].counterparty = null)],
    ["a counterparty that is a number", (body) => (body.lines[1].counterparty = 1)],
  ]);

  it("takes a week and a day of the interval it was asked for, and refuses a month's row under them", () => {
    const week = { ...clone(balances), interval: "week", rows: [{ date: "2020-03-02T00:00:00Z", currency: "XRP", balance: "1" }] };
    expect(checkAnalyticsBalances(week, "week", WHAT)).toBe(week);
    refuses((body) => checkAnalyticsBalances(body, "month", WHAT), week);
    const day = { ...clone(balances), interval: "day", rows: [{ date: "2020-03-04T00:00:00Z", currency: "XRP", balance: "1" }] };
    expect(checkAnalyticsBalances(day, "day", WHAT)).toBe(day);
    refuses((body) => checkAnalyticsBalances(body, "week", WHAT), day);
  });
  it("takes a currency of 3 characters of any kind, and one of 40 hex digits in either case", () => {
    for (const currency of ["XRP", "XAH", "usd", "$$$", "A1b", "0".repeat(3), "0158415500000000C1F76FF6ECB0BAC600000000", "0158415500000000c1f76ff6ecb0bac600000000"]) {
      const body: Body = clone(balances);
      body.rows[1].currency = currency;
      expect(() => check(body)).not.toThrow();
    }
  });
  it("takes an answer with no lines, as D2 answers an unknown address", () => {
    const empty = { result: "success", start: "2020-03-01T00:00:00Z", end: "2020-06-01T00:00:00Z", interval: "month", lines_total: 0, lines: [], count: 0, rows: [] };
    expect(check(empty)).toBe(empty);
  });
  it.each(NO_ANSWER)("refuses %j, which is no answer", (body) => {
    refuses(check, body);
  });
});

// ---- analytics/balance_changes ------------------------------------------------------------------------------------------------------------------

describe("checkBalanceChanges", () => {
  // The account "rBtgXX…" of the test world: two changes of 2 XRP in April belong to a transaction type with no change type, so they have no key.
  const changes = {
    result: "success",
    start: "2020-02-01T00:00:00Z",
    end: "2020-05-01T00:00:00Z",
    interval: "month",
    totals: [
      { change_type: "transaction_cost", count: 1, in_value: "0", out_value: "0.000012", net_value: "-0.000012" },
      { change_type: "payment_destination", count: 7, in_value: "560", out_value: "0", net_value: "560" },
      { change_type: "payment_source", count: 2, in_value: "0", out_value: "100", net_value: "-100" },
      { count: 2, in_value: "2", out_value: "2", net_value: "0" },
    ],
    count: 6,
    rows: [
      { date: "2020-02-01T00:00:00Z", change_type: "transaction_cost", count: 1, in_value: "0", out_value: "0.000012" },
      { date: "2020-02-01T00:00:00Z", change_type: "payment_destination", count: 4, in_value: "550", out_value: "0" },
      { date: "2020-02-01T00:00:00Z", change_type: "payment_source", count: 1, in_value: "0", out_value: "100" },
      { date: "2020-03-01T00:00:00Z", change_type: "payment_destination", count: 3, in_value: "10", out_value: "0" },
      { date: "2020-04-01T00:00:00Z", change_type: "payment_source", count: 1, in_value: "0", out_value: "0" },
      { date: "2020-04-01T00:00:00Z", count: 2, in_value: "2", out_value: "2" },
    ],
  };
  const check = (body: unknown) => checkBalanceChanges(body, "month", WHAT);

  pins(check, changes, [
    ["a month row dated on the second", (body) => (body.rows[0].date = "2026-10-02T00:00:00Z")],
    ["a month row dated on a Monday", (body) => (body.rows[3].date = "2020-03-02T00:00:00Z")],
    ["a month row not at midnight", (body) => (body.rows[0].date = "2020-02-01T05:00:00Z")],
    ["a row without a date (the rows of an answer with no interval)", (body) => delete body.rows[0].date],
    ["the day echoed when the month was asked", (body) => (body.interval = "day")],
    ["no interval", (body) => delete body.interval],
    ["a result that is not success", (body) => (body.result = undefined)],
    ["a start that is not a time", (body) => (body.start = "yesterday")],
    ["totals that are an object", (body) => (body.totals = {})],
    ["no totals", (body) => delete body.totals],
    ["rows that are an object", (body) => (body.rows = {})],
    ["no rows", (body) => delete body.rows],
    ["a total that is null", (body) => body.totals.push(null)],
    ["a row that is a list", (body) => body.rows.push([])],
    ["a count that is not a whole number", (body) => (body.count = 1.5)],
    ["a total's count that is not a whole number", (body) => (body.totals[1].count = 7.5)],
    ["a total's count that is text", (body) => (body.totals[1].count = "7")],
    ["a total's count that is negative", (body) => (body.totals[1].count = -7)],
    ["a row's count that is not a whole number", (body) => (body.rows[1].count = 4.5)],
    ["a row's count that is missing", (body) => delete body.rows[1].count],
    ["a value in exponent form", (body) => (body.rows[1].in_value = "1e3")],
    ["a value that is a number", (body) => (body.rows[1].in_value = 550)],
    ["an out value that is a number", (body) => (body.rows[0].out_value = 0.000012)],
    ["a total's in value that is a number", (body) => (body.totals[1].in_value = 560)],
    ["a total's out value in exponent form", (body) => (body.totals[1].out_value = "0e0")],
    ["a net value that is a number", (body) => (body.totals[2].net_value = -100)],
    ["no net value", (body) => delete body.totals[2].net_value],
    ["a net value with a plus", (body) => (body.totals[1].net_value = "+560")],
    ["a change type that is empty", (body) => (body.rows[0].change_type = "")],
    ["a change type that is a number", (body) => (body.totals[0].change_type = 1)],
    ["a change type that is null (the API leaves the key out)", (body) => (body.totals[3].change_type = null)],
  ]);

  it("takes a total and a row with no change type, and a type the page does not know", () => {
    const body: Body = clone(changes);
    body.totals[3].change_type = "amm_deposit";
    body.rows[5].change_type = "amm_deposit";
    expect(check(body)).toBe(body);
  });
  it("takes an answer with no changes, as D2 answers an unknown address", () => {
    const empty = { result: "success", start: "2020-02-01T00:00:00Z", end: "2020-05-01T00:00:00Z", interval: "month", totals: [], count: 0, rows: [] };
    expect(check(empty)).toBe(empty);
  });
  it("refuses the answer of a week for a month, and the other way round", () => {
    refuses((body) => checkBalanceChanges(body, "week", WHAT), changes);
    const week = { ...clone(changes), interval: "week", rows: [{ date: "2020-02-03T00:00:00Z", count: 1, in_value: "1", out_value: "0" }] };
    expect(checkBalanceChanges(week, "week", WHAT)).toBe(week);
    refuses((body) => checkBalanceChanges(body, "month", WHAT), week);
  });
  it.each(NO_ANSWER)("refuses %j, which is no answer", (body) => {
    refuses(check, body);
  });
});

// ---- analytics/counterparties -------------------------------------------------------------------------------------------------------------------

describe("checkCounterparties", () => {
  const counterparties = {
    result: "success",
    start: "2020-01-01T00:00:00Z",
    end: "2020-07-01T00:00:00Z",
    sort: "value",
    total: 3,
    count: 3,
    counterparties: [
      {
        account: OTHER,
        sent_value: "15",
        received_value: "24",
        total_value: "39",
        payments_sent: 2,
        payments_received: 3,
        first: "2020-01-16T09:00:00Z",
        last: "2020-06-15T09:00:00Z",
      },
      {
        account: THIRD,
        sent_value: "20",
        received_value: "0",
        total_value: "20",
        payments_sent: 4,
        payments_received: 1,
        first: "2020-01-17T09:00:00Z",
        last: "2020-04-20T12:00:00Z",
      },
      {
        account: ISSUER,
        sent_value: "0",
        received_value: "7",
        total_value: "7",
        payments_sent: 0,
        payments_received: 1,
        first: "2020-01-17T09:00:00Z",
        last: "2020-01-17T09:00:00Z",
      },
    ],
  };
  const check = (body: unknown) => checkCounterparties(body, WHAT);

  pins(check, counterparties, [
    ["an account that is not an address", (body) => (body.counterparties[0].account = "rBad")],
    ["an account that is an X-address", (body) => (body.counterparties[0].account = classicAddressToXAddress(OTHER, false, false))],
    ["an account that is a tagged X-address", (body) => (body.counterparties[0].account = classicAddressToXAddress(OTHER, 12345, false))],
    ["an account with a bad checksum", (body) => (body.counterparties[0].account = `${OTHER.slice(0, -1)}x`)],
    ["an account that is empty", (body) => (body.counterparties[1].account = "")],
    ["an account that is a number", (body) => (body.counterparties[1].account = 5)],
    ["no account", (body) => delete body.counterparties[1].account],
    ["a sent value that is a number", (body) => (body.counterparties[0].sent_value = 15)],
    ["a received value in exponent form", (body) => (body.counterparties[0].received_value = "1e3")],
    ["a total value that is a number", (body) => (body.counterparties[0].total_value = 39)],
    ["no total value", (body) => delete body.counterparties[0].total_value],
    ["a payments count that is not a whole number", (body) => (body.counterparties[0].payments_sent = 1.5)],
    ["a payments count that is text", (body) => (body.counterparties[0].payments_received = "3")],
    ["a payments count that is negative", (body) => (body.counterparties[0].payments_received = -3)],
    ["a first time that is not ISO", (body) => (body.counterparties[0].first = "2020-01-16")],
    ["a last time that is a number", (body) => (body.counterparties[0].last = 1592211600)],
    ["no last time", (body) => delete body.counterparties[2].last],
    ["a sort that is not value or count", (body) => (body.sort = "volume")],
    ["no sort", (body) => delete body.sort],
    ["a total that is not a whole number", (body) => (body.total = 3.5)],
    ["a total that is text", (body) => (body.total = "3")],
    ["no total", (body) => delete body.total],
    ["a count that is not a whole number", (body) => (body.count = 1.5)],
    ["a count that is negative", (body) => (body.count = -3)],
    ["counterparties that are an object", (body) => (body.counterparties = {})],
    ["counterparties that are null", (body) => (body.counterparties = null)],
    ["no counterparties", (body) => delete body.counterparties],
    ["a counterparty that is text", (body) => body.counterparties.push(OTHER)],
    ["a result that is not success", (body) => (body.result = "ok")],
    ["a start that is not a time", (body) => (body.start = 1577836800)],
    ["no end", (body) => delete body.end],
  ]);

  it("takes the other sort, and a total beyond the count", () => {
    const body: Body = clone(counterparties);
    body.sort = "count";
    body.total = 40;
    expect(check(body)).toBe(body);
  });
  it("takes an answer with no counterparties, as D2 answers an unknown address", () => {
    const empty = { result: "success", start: "2020-01-01T00:00:00Z", end: "2020-07-01T00:00:00Z", sort: "value", total: 0, count: 0, counterparties: [] };
    expect(check(empty)).toBe(empty);
  });
  it("refuses the example's own account `rrrrUBy92h6worVCYERZcVCzgzgmHb17Dx`: the test world's, with no valid checksum, that the explorer would never link", () => {
    const body: Body = clone(counterparties);
    body.counterparties[1].account = "rrrrUBy92h6worVCYERZcVCzgzgmHb17Dx";
    refuses(check, body);
  });
  it.each(NO_ANSWER)("refuses %j, which is no answer", (body) => {
    refuses(check, body);
  });
});

// ---- analytics/exchanges ------------------------------------------------------------------------------------------------------------------------

describe("checkAnalyticsExchanges", () => {
  const exchanges = {
    result: "success",
    start: "2020-01-01T00:00:00Z",
    end: "2020-07-01T00:00:00Z",
    total: 3,
    count: 3,
    pairs: [
      {
        base_currency: "EUR",
        base_issuer: ISSUER,
        counter_currency: "USD",
        counter_issuer: ISSUER,
        count: 4,
        base_volume: "139",
        counter_volume: "85",
        bought: "130",
        sold: "9",
        bought_counter: "67",
        sold_counter: "18",
        native_volume: "37",
      },
      {
        base_currency: "USD",
        base_issuer: ISSUER,
        counter_currency: "XRP",
        count: 4,
        base_volume: "35.5",
        counter_volume: "13.25",
        bought: "15.5",
        sold: "21",
        bought_counter: "8.25",
        sold_counter: "5.25",
        native_volume: "13.25",
      },
      {
        base_currency: "XRP",
        counter_currency: "ZAR",
        counter_issuer: OTHER,
        count: 1,
        base_volume: "5",
        counter_volume: "100",
        bought: "5",
        sold: "0",
        bought_counter: "100",
        sold_counter: "0",
        native_volume: "5",
      },
    ],
  };
  const check = (body: unknown) => checkAnalyticsExchanges(body, WHAT);

  pins(check, exchanges, [
    ["a bought that is a number", (body) => (body.pairs[0].bought = 1500)],
    ["a sold that is a number", (body) => (body.pairs[0].sold = 9)],
    ["a bought in exponent form", (body) => (body.pairs[0].bought = "1.5e3")],
    ["a base volume in exponent form", (body) => (body.pairs[0].base_volume = "1e3")],
    ["a counter volume that is a number", (body) => (body.pairs[0].counter_volume = 85)],
    ["a bought counter that is a number", (body) => (body.pairs[0].bought_counter = 67)],
    ["a sold counter that is empty", (body) => (body.pairs[0].sold_counter = "")],
    ["a native volume that is a number", (body) => (body.pairs[0].native_volume = 37)],
    ["a native volume in exponent form", (body) => (body.pairs[0].native_volume = "3.7e1")],
    ["a native volume that is null (the API leaves the key out)", (body) => (body.pairs[0].native_volume = null)],
    ["no bought", (body) => delete body.pairs[0].bought],
    ["a base issuer that is not an address", (body) => (body.pairs[0].base_issuer = "rBad")],
    ["a counter issuer that is not an address", (body) => (body.pairs[2].counter_issuer = "rBad")],
    ["a base issuer that is an X-address", (body) => (body.pairs[0].base_issuer = classicAddressToXAddress(ISSUER, false, false))],
    ["a base issuer with a bad checksum", (body) => (body.pairs[0].base_issuer = `${ISSUER.slice(0, -1)}x`)],
    ["a base issuer that is empty", (body) => (body.pairs[0].base_issuer = "")],
    ["a base issuer that is null", (body) => (body.pairs[0].base_issuer = null)],
    ["a currency of 4 characters", (body) => (body.pairs[0].base_currency = "USDX")],
    ["a counter currency of 4 characters", (body) => (body.pairs[1].counter_currency = "XRPL")],
    ["a currency of 2 characters", (body) => (body.pairs[1].counter_currency = "XR")],
    ["a currency that is empty", (body) => (body.pairs[1].base_currency = "")],
    ["a currency of 40 characters that are not all hex", (body) => (body.pairs[1].base_currency = `${"0".repeat(39)}Z`)],
    ["no currency", (body) => delete body.pairs[1].counter_currency],
    ["a pair count that is not a whole number", (body) => (body.pairs[0].count = 4.5)],
    ["a pair count that is text", (body) => (body.pairs[0].count = "4")],
    ["a pair count that is negative", (body) => (body.pairs[0].count = -4)],
    ["a total that is not a whole number", (body) => (body.total = 1.5)],
    ["a count that is not a whole number", (body) => (body.count = 1.5)],
    ["no count", (body) => delete body.count],
    ["pairs that are an object", (body) => (body.pairs = {})],
    ["pairs that are null", (body) => (body.pairs = null)],
    ["no pairs", (body) => delete body.pairs],
    ["a pair that is text", (body) => body.pairs.push("EUR/USD")],
    ["a result that is not success", (body) => (body.result = "error")],
    ["a start that is not a time", (body) => (body.start = "2020-01-01")],
    ["no end", (body) => delete body.end],
  ]);

  it("takes a pair of two hex currencies, and a pair with no native volume", () => {
    const body: Body = clone(exchanges);
    body.pairs[0].base_currency = "0158415500000000C1F76FF6ECB0BAC600000000";
    delete body.pairs[0].native_volume;
    expect(check(body)).toBe(body);
  });
  it("takes a balance of zero and a fraction", () => {
    const body: Body = clone(exchanges);
    body.pairs[2].bought = "0.000001";
    body.pairs[2].sold = "0.0";
    expect(check(body)).toBe(body);
  });
  it("takes an answer with no pairs, as D2 answers an unknown address", () => {
    const empty = { result: "success", start: "2020-01-01T00:00:00Z", end: "2020-07-01T00:00:00Z", total: 0, count: 0, pairs: [] };
    expect(check(empty)).toBe(empty);
  });
  it.each(NO_ANSWER)("refuses %j, which is no answer", (body) => {
    refuses(check, body);
  });
});
