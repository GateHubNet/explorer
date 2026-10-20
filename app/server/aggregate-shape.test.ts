import { describe, expect, it } from "vitest";

import {
  checkActiveAccounts,
  checkCandles,
  checkFeeBucketPage,
  checkFeeStatsPage,
  checkMarkets,
  checkPairExchanges,
  checkReduce,
  checkStatsPage,
  checkValidations,
  checkVolumePage,
  isDecimalText,
  isIsoTime,
  isNumberText,
} from "./aggregate-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api-new/docs/api-reference.md ("Network", "Validations", "Stats", "Exchanges", "Active accounts", and "amm_volume" on
// feat/amm-data; "network/markets" at feat/explorer-data 7d495ab), where it gives one; the rest are built from its list of keys. A defect is one change to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
type Defect = [what: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200). */
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
}

/** Every change in `defects` makes the example `good` a refused answer; `good` itself is taken and returned as it is. */
function pins(check: (body: unknown) => unknown, good: unknown, defects: Defect[]): void {
  it("takes the reference's example, and returns it as it is", () => {
    expect(check(good)).toBe(good);
  });
  it.each(defects)("refuses %s", (_what, defect) => {
    const page = clone(good);
    defect(page);
    refuses(check, page);
  });
}

const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";

describe("isDecimalText", () => {
  it.each(["0", "12", "-3", "0.5", "-0.5", "0.0090909091", "45454.545", "1.0000000", "99985687626634189"])("takes %j", (text) => {
    expect(isDecimalText(text)).toBe(true);
  });
  it.each(["", "1e3", "1E-7", "12.", ".5", "1,000", " 12", "12 ", "+1", "0x10", "NaN", "Infinity", "--1", "1.2.3", "٣"])("refuses %j", (text) => {
    expect(isDecimalText(text)).toBe(false);
  });
  it.each([12, 12.5, null, undefined, true, ["1"], { value: "1" }])("refuses %j, which is not text", (value) => {
    expect(isDecimalText(value)).toBe(false);
  });
});

describe("isIsoTime", () => {
  it.each(["2026-10-16T12:00:00Z", "2015-01-14T00:00:00Z", "2026-10-16T12:00:01.123Z", "2026-02-28T23:59:59.999Z"])("takes %j", (text) => {
    expect(isIsoTime(text)).toBe(true);
  });
  it.each([
    "",
    "yesterday",
    "2026-10-16",
    "2026-10-16T12:00",
    "2026-10-16T12:00:00",
    "2026-10-16T12:00:00+00:00",
    "2026-10-16T12:00:00.1Z",
    "2026-10-16T12:00:00.123456Z",
    "2026-10-16 12:00:00Z",
    " 2026-10-16T12:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-10-16T25:00:00Z",
  ])("refuses %j", (text) => {
    expect(isIsoTime(text)).toBe(false);
  });
  it.each([1792152000, null, undefined, new Date(0)])("refuses %j, which is not text", (value) => {
    expect(isIsoTime(value)).toBe(false);
  });
});

describe("checkStatsPage", () => {
  // `/v2/stats/type` "gives `{ "OfferCreate": 4000, "Payment": 3000, "date": "…" }`", and `/v2/stats/metric` the same with its names.
  const type = {
    result: "success",
    count: 2,
    marker: "…",
    stats: [
      { OfferCreate: 4000, Payment: 3000, date: "2015-01-14T00:00:00Z" },
      { OfferCreate: 1, date: "2015-01-15T00:00:00Z" },
    ],
  };
  const metric = {
    result: "success",
    count: 1,
    stats: [{ accounts_created: 12, date: "2015-01-14T00:00:00Z", ledger_count: 24000, ledger_interval: 3.5714, payments_count: 2900, transaction_count: 7000 }],
  };

  describe("transactions by type", () => {
    pins(checkStatsPage, type, [
      ["a body that is not a list under stats", (page) => (page.stats = { "2015-01-14T00:00:00Z": { Payment: 1 } })],
      ["no stats", (page) => delete page.stats],
      ["stats that are text", (page) => (page.stats = "none")],
      ["stats that are null", (page) => (page.stats = null)],
      ["a row that is text", (page) => page.stats.push("Payment")],
      ["a row that is null", (page) => page.stats.push(null)],
      ["a row that is a list", (page) => page.stats.push([3000])],
      ["a count that is text", (page) => (page.stats[0].Payment = "12")],
      ["a count that is null", (page) => (page.stats[0].Payment = null)],
      ["a count that is an object", (page) => (page.stats[0].Payment = { count: 12 })],
      ["a count that is not finite", (page) => (page.stats[0].Payment = Number.POSITIVE_INFINITY)],
      ["a row without a date", (page) => delete page.stats[1].date],
      ["a date that is not ISO", (page) => (page.stats[0].date = "2015-01-14")],
      ["a date that is a number", (page) => (page.stats[0].date = 1421193600)],
      ["a date of the original's other spelling", (page) => (page.stats[0].date = "2015-01-14T00:00:00+00:00")],
    ]);
  });

  describe("metrics", () => {
    pins(checkStatsPage, metric, [
      ["a metric that is text", (page) => (page.stats[0].ledger_count = "24000")],
      ["an average that is text", (page) => (page.stats[0].ledger_interval = "3.5714")],
    ]);
  });

  it("takes an answer with no rows, and a row that is only its date", () => {
    expect(checkStatsPage({ result: "success", count: 0, stats: [] }).stats).toEqual([]);
    expect(checkStatsPage({ result: "success", count: 1, stats: [{ date: "2015-01-14T00:00:00Z" }] }).stats).toHaveLength(1);
  });

  it("refuses the row of a request without a family, which nests the families: the client always asks for one", () => {
    const whole = {
      result: "success",
      count: 1,
      stats: [
        {
          date: "2015-01-14T00:00:00Z",
          type: { OfferCreate: 4000, Payment: 3000 },
          result: { tecUNFUNDED_OFFER: 100, tesSUCCESS: 6900 },
          metric: { accounts_created: 12, ledger_count: 24000 },
        },
      ],
    };
    refuses(checkStatsPage, whole);
  });

  it("refuses anything that is not an object", () => {
    for (const body of [null, undefined, "stats", 7, [], [{ date: "2015-01-14T00:00:00Z" }]]) refuses(checkStatsPage, body);
  });
});

describe("checkFeeBucketPage", () => {
  // The reference's example is a ledger row; "hour and day rows have no `ledger_index` and their `date` is the start of the bucket".
  const buckets = {
    result: "success",
    marker: "…",
    count: 2,
    rows: [
      { avg: 0.010615, max: 0.011, min: 0.00001, total: 0.138, tx_count: 13, date: "2015-01-14T00:00:00Z" },
      { avg: 0, max: 0, min: 0, total: 0, tx_count: 0, date: "2015-01-15T00:00:00Z" },
    ],
  };

  pins(checkFeeBucketPage, buckets, [
    ["no rows", (page) => delete page.rows],
    ["rows that are not a list", (page) => (page.rows = { 0: page.rows[0] })],
    ["a row that is null", (page) => page.rows.push(null)],
    ["an avg that is text", (page) => (page.rows[0].avg = "0.010615")],
    ["a max that is missing", (page) => delete page.rows[0].max],
    ["a min that is null", (page) => (page.rows[1].min = null)],
    ["a total that is text", (page) => (page.rows[0].total = "0.138")],
    ["a tx_count that is text", (page) => (page.rows[0].tx_count = "13")],
    ["a date that is missing", (page) => delete page.rows[0].date],
    ["a date that is not ISO", (page) => (page.rows[0].date = "2015-01-14 00:00:00")],
  ]);

  it("takes the reference's example row, which is a ledger's and has a ledger_index the buckets do not", () => {
    const row = { avg: 0.010615, max: 0.011, min: 0.00001, total: 0.138, tx_count: 13, date: "2015-01-14T18:27:20Z", ledger_index: 11118827 };
    expect(checkFeeBucketPage({ result: "success", marker: "…", count: 1, rows: [row] }).rows).toEqual([row]);
  });
});

describe("checkFeeStatsPage", () => {
  const snapshot = {
    result: "success",
    marker: "…",
    count: 1,
    rows: [
      {
        current_ledger_size: 54,
        current_queue_size: 0,
        date: "2016-08-24T00:15:55Z",
        expected_ledger_size: 53,
        median_fee: 0.000005,
        minimum_fee: 0.00001,
        open_ledger_fee: 0.00001,
        pct_max_queue_size: 0,
      },
    ],
  };

  pins(checkFeeStatsPage, snapshot, [
    ["rows that are not a list", (page) => (page.rows = "none")],
    ["an open_ledger_fee that is text", (page) => (page.rows[0].open_ledger_fee = "0.00001")],
    ["a minimum_fee that is text", (page) => (page.rows[0].minimum_fee = "0.00001")],
    ["a median_fee that is missing", (page) => delete page.rows[0].median_fee],
    ["a current_queue_size that is text", (page) => (page.rows[0].current_queue_size = "0")],
    ["a current_ledger_size that is null", (page) => (page.rows[0].current_ledger_size = null)],
    ["an expected_ledger_size that is missing", (page) => delete page.rows[0].expected_ledger_size],
    ["a pct_max_queue_size that is text", (page) => (page.rows[0].pct_max_queue_size = "0")],
    ["a date that is not ISO", (page) => (page.rows[0].date = "2016-08-24")],
    ["no date", (page) => delete page.rows[0].date],
  ]);

  it("takes an answer with no snapshot yet (a day the syncer has not started)", () => {
    expect(checkFeeStatsPage({ result: "success", count: 0, rows: [] }).rows).toEqual([]);
  });
});

describe("checkVolumePage", () => {
  /** The reference's example: one row, one trade component. */
  const exchange = {
    result: "success",
    count: 1,
    rows: [
      {
        components: [
          {
            count: 120,
            rate: "0.0090909091",
            amount: "5000",
            base: { currency: "USD", issuer: "r…" },
            counter: { currency: "XRP" },
            converted_amount: "45454.545",
          },
        ],
        count: 120,
        exchange: { currency: "XRP" },
        total: "45454.545",
        exchange_rate: "1.0000000",
        start_time: "2026-10-15T12:00:00Z",
        end_time: "2026-10-16T12:00:00Z",
      },
    ],
  };
  /** "a **payment** component `{currency, issuer?, amount, count, rate, converted_amount}` (`issuer` absent for the native currency)". */
  const payment = {
    ...exchange,
    rows: [
      {
        ...exchange.rows[0],
        components: [
          { currency: "USD", issuer: ISSUER, amount: "5000", count: 100, rate: "0.0090909091", converted_amount: "45454.545" },
          { currency: "XRP", amount: "123.456789", count: 20, rate: "1", converted_amount: "123.456789" },
        ],
      },
    ],
  };
  /** "an **AMM** component `{amm_account, base, counter, count, amount, rate, converted_amount}`" (feat/amm-data). */
  const amm = {
    ...exchange,
    rows: [
      {
        ...exchange.rows[0],
        components: [
          {
            amm_account: "rhWj9gtLMopk5vs8Hwuw5kVRLEuPGnq3Yi",
            base: { currency: "USD", issuer: ISSUER },
            counter: { currency: "XRP" },
            count: 31,
            amount: "1500.25",
            rate: "0.5",
            converted_amount: "3000.5",
          },
        ],
      },
    ],
  };

  /** What goes wrong in a row, whichever volume it is. */
  const ofRow: Defect[] = [
    ["no rows", (page) => delete page.rows],
    ["rows that are not a list", (page) => (page.rows = "none")],
    ["a row that is null", (page) => page.rows.push(null)],
    ["a total that is a number", (page) => (page.rows[0].total = 12.5)],
    ["a total that is no number", (page) => (page.rows[0].total = "4.5 XRP")],
    ["a total that is missing", (page) => delete page.rows[0].total],
    ["an exchange_rate that is a number", (page) => (page.rows[0].exchange_rate = 1)],
    ["a count that is text", (page) => (page.rows[0].count = "120")],
    ["no components", (page) => delete page.rows[0].components],
    ["components that are not a list", (page) => (page.rows[0].components = { 0: page.rows[0].components[0] })],
    ["a component that is null", (page) => page.rows[0].components.push(null)],
    ["an exchange that is text", (page) => (page.rows[0].exchange = "XRP")],
    ["an exchange without a currency", (page) => (page.rows[0].exchange = {})],
    ["an exchange whose issuer is a number", (page) => (page.rows[0].exchange = { currency: "USD", issuer: 7 })],
    ["a start_time that is not ISO", (page) => (page.rows[0].start_time = "2026-10-15")],
    ["no start_time", (page) => delete page.rows[0].start_time],
    ["an end_time that is not ISO", (page) => (page.rows[0].end_time = 1792152000)],
  ];
  /** What goes wrong in a component of any volume: its amounts. */
  const ofAmounts: Defect[] = [
    ["a converted_amount with an exponent of 4 digits", (page) => (page.rows[0].components[0].converted_amount = "1e1000")],
    ["an amount that is NaN", (page) => (page.rows[0].components[0].amount = "NaN")],
    ["a rate that is empty", (page) => (page.rows[0].components[0].rate = "")],
    ["a converted_amount that is a number", (page) => (page.rows[0].components[0].converted_amount = 1000)],
    ["a converted_amount that is missing", (page) => delete page.rows[0].components[0].converted_amount],
    ["an amount that is a number", (page) => (page.rows[0].components[0].amount = 5000)],
    ["a rate that is a number", (page) => (page.rows[0].components[0].rate = 0.009)],
    ["a rate that is null", (page) => (page.rows[0].components[0].rate = null)],
    ["a count that is text", (page) => (page.rows[0].components[0].count = "120")],
    ["a count that is missing", (page) => delete page.rows[0].components[0].count],
  ];
  const ofAsset = (key: "base" | "counter"): Defect[] => [
    [`a ${key} that is text`, (page) => (page.rows[0].components[0][key] = "XRP")],
    [`a ${key} that is missing`, (page) => delete page.rows[0].components[0][key]],
    [`a ${key} without a currency`, (page) => (page.rows[0].components[0][key] = { issuer: ISSUER })],
    [`a ${key} whose issuer is a number`, (page) => (page.rows[0].components[0][key] = { currency: "USD", issuer: 7 })],
  ];

  describe("payments", () => {
    pins((body) => checkVolumePage("payment", body), payment, [
      ...ofRow,
      ...ofAmounts,
      ["a currency that is missing", (page) => delete page.rows[0].components[0].currency],
      ["a currency that is a number", (page) => (page.rows[0].components[0].currency = 840)],
      ["an issuer that is a number", (page) => (page.rows[0].components[0].issuer = 7)],
    ]);

    it("takes the native currency's component, which has no issuer", () => {
      expect(checkVolumePage("payment", payment).rows[0]!.components[1]).not.toHaveProperty("issuer");
    });
  });

  describe("trades", () => {
    pins((body) => checkVolumePage("exchange", body), exchange, [...ofRow, ...ofAmounts, ...ofAsset("base"), ...ofAsset("counter")]);
  });

  describe("AMM swaps", () => {
    pins((body) => checkVolumePage("amm", body), amm, [
      ...ofRow,
      ...ofAmounts,
      ...ofAsset("base"),
      ...ofAsset("counter"),
      ["an amm_account that is missing", (page) => delete page.rows[0].components[0].amm_account],
      ["an amm_account that is a number", (page) => (page.rows[0].components[0].amm_account = 7)],
    ]);

    it("takes the rows of a network with no AMM, which have no components and zero totals", () => {
      const none = { result: "success", count: 1, rows: [{ ...amm.rows[0], components: [], count: 0, total: "0", exchange_rate: "1" }] };
      expect(checkVolumePage("amm", none).rows[0]!.components).toEqual([]);
    });
  });

  it.each(["payment", "exchange", "amm"] as const)(
    "takes the %s component's amount, rate and converted_amount in exponent form: the API writes a tiny amount, or a rate from 1e8, with BigNumber's text",
    (kind) => {
      const good = { payment, exchange, amm }[kind];
      const dust = clone(good) as Body;
      Object.assign(dust.rows[0].components[0], { amount: "2.5e-7", rate: "1.2345679e+8", converted_amount: "1.5E-7" });
      expect(checkVolumePage(kind, dust)).toBe(dust);
    },
  );

  it("takes the row's total and exchange_rate in exponent form: the API writes the total with String() of a JS number, the rate with precision8", () => {
    for (const kind of ["payment", "exchange", "amm"] as const) {
      for (const [name, value] of [["total", "4e-7"], ["total", "1.5e+21"], ["exchange_rate", "4e-7"], ["exchange_rate", "1.2345679e+8"]] as const) {
        const row = clone({ payment, exchange, amm }[kind]) as Body;
        row.rows[0][name] = value;
        expect(checkVolumePage(kind, row)).toBe(row);
      }
    }
  });

  it("refuses a row's total or exchange_rate that is no number as text", () => {
    for (const [name, value] of [["total", "abc"], ["total", ""], ["exchange_rate", "NaN"], ["exchange_rate", "1e9999"]] as const) {
      const row = clone(exchange) as Body;
      row.rows[0][name] = value;
      refuses((body) => checkVolumePage("exchange", body), row);
    }
  });

  it("asks of a component what its kind has: a payment component is not a trade, and a trade is not a pool", () => {
    refuses((body) => checkVolumePage("exchange", body), payment);
    refuses((body) => checkVolumePage("payment", body), exchange);
    refuses((body) => checkVolumePage("amm", body), exchange);
  });

  it("takes an answer with no rows", () => {
    for (const kind of ["payment", "exchange", "amm"] as const) expect(checkVolumePage(kind, { result: "success", count: 0, rows: [] }).rows).toEqual([]);
  });

  it("refuses anything that is not an object", () => {
    for (const body of [null, undefined, "rows", 7, [], [exchange.rows[0]]]) refuses((b) => checkVolumePage("exchange", b), body);
  });
});

describe("checkValidations", () => {
  const validations = {
    result: "success",
    ledger_hash: "A1B2…",
    count: 2,
    marker: "n9…",
    validations: [
      {
        count: 3,
        first_datetime: "2026-10-16T12:00:01.123Z",
        flags: "2147483649",
        full: "true",
        last_datetime: "2026-10-16T12:00:02.456Z",
        ledger_hash: "A1B2…",
        ledger_index: "107695660",
        reporter_public_key: "n9…",
        signing_time: "814567890",
        validation_public_key: "n9…",
      },
      {
        amendments: "42426C4D4F1009EE67080A9B7965B44656D7714D104A72F9B4369F97ABF044EE",
        base_fee: "10",
        count: 1,
        ephemeral_public_key: "n9…",
        first_datetime: "2026-10-16T12:00:01Z",
        flags: "2147483648",
        last_datetime: "2026-10-16T12:00:01Z",
        ledger_hash: "A1B2…",
        ledger_index: "107695660",
        load_fee: "256000",
        reserve_base: "10000000",
        reserve_inc: "2000000",
        signature: "3045…",
        signing_time: "814567891",
        validation_public_key: "n9…",
      },
    ],
  };

  pins(checkValidations, validations, [
    ["a validation without validation_public_key", (page) => delete page.validations[0].validation_public_key],
    ["a validation_public_key that is a number", (page) => (page.validations[1].validation_public_key = 7)],
    ["a validation_public_key that is empty", (page) => (page.validations[0].validation_public_key = "")],
    ["validations that are not a list", (page) => (page.validations = { 0: page.validations[0] })],
    ["no validations", (page) => delete page.validations],
    ["validations that are text", (page) => (page.validations = "none")],
    ["a validation that is null", (page) => page.validations.push(null)],
    ["a count that is text", (page) => (page.validations[0].count = "3")],
    ["a count that is missing", (page) => delete page.validations[0].count],
    ["a first_datetime that is not ISO", (page) => (page.validations[0].first_datetime = "2026-10-16 12:00:01")],
    ["a first_datetime that is a number", (page) => (page.validations[0].first_datetime = 1792152001)],
    ["no first_datetime", (page) => delete page.validations[0].first_datetime],
    ["a last_datetime that is not ISO", (page) => (page.validations[0].last_datetime = "yesterday")],
    ["no last_datetime", (page) => delete page.validations[1].last_datetime],
    ["flags that are a number", (page) => (page.validations[0].flags = 2147483649)],
    ["no flags", (page) => delete page.validations[0].flags],
    ["a ledger_index that is a number", (page) => (page.validations[0].ledger_index = 107695660)],
    ["a signing_time that is a number", (page) => (page.validations[0].signing_time = 814567890)],
    ["no ledger_hash", (page) => delete page.validations[0].ledger_hash],
    ["a full that is a boolean", (page) => (page.validations[0].full = true)],
    ["a fee that is a number", (page) => (page.validations[1].base_fee = 10)],
    ["a signature that is null", (page) => (page.validations[1].signature = null)],
  ]);

  it("takes an answer with no validations (a ledger the collectors have not seen, or one older than the 90 days the API keeps them)", () => {
    expect(checkValidations({ result: "success", ledger_hash: "A1B2…", count: 0, validations: [] }).validations).toEqual([]);
  });

  it("takes the optional columns when they are absent, as an empty column is", () => {
    const [first] = checkValidations(validations).validations;
    expect(first).not.toHaveProperty("amendments");
    expect(first).not.toHaveProperty("signature");
  });

  it("refuses anything that is not an object", () => {
    for (const body of [null, undefined, "validations", 7, [], [validations.validations[0]]]) refuses(checkValidations, body);
  });
});

// ---- The pair page's and the markets page's calls ---------------------------------------------------------------------------------------------------

describe("isNumberText", () => {
  // The API writes the figures it computes with BigNumber: `precision8` (`toPrecision(8)`: a price, a rate, a vwap) is in exponent form from 1e8 and below
  // 1e-6, and `toString()` (a sum, a native volume cut to 17 digits) from 1e21 and below 1e-6. So a junk token priced at 0.00000012 XRP is "1.2000000e-7".
  it.each(["0", "12", "-3", "0.5", "0.0090909091", "45454.545", "0.0000000", "1.2000000e-7", "1.2345679e+8", "5e-7", "1.5e+21", "1e-81", "-1.5E+3", "5e-007"])("takes %j", (text) => {
    expect(isNumberText(text)).toBe(true);
  });
  it.each(["", "1e", "e5", "1e+", "1.e5", ".5e3", "12.", "1,000", " 12", "12 ", "+1", "0x10", "NaN", "Infinity", "-Infinity", "1e3.5", "1.2.3", "٣"])("refuses %j", (text) => {
    expect(isNumberText(text)).toBe(false);
  });
  it.each(["1e999", "1e-999", "1.5e+100"])("takes %j, an exponent of at most 3 digits", (text) => {
    expect(isNumberText(text)).toBe(true);
  });
  it.each(["1e1000", "1e-1000", "1e999999999", "1.5e+0001", "5e-00000000007"])("refuses %j: an exponent of more than 3 digits would reach BigNumber's formatting of a page", (text) => {
    expect(isNumberText(text)).toBe(false);
  });
  it.each([12, 1.5e-7, null, undefined, true, ["1"], { value: "1" }])("refuses %j, which is not text", (value) => {
    expect(isNumberText(value)).toBe(false);
  });
  it("is a wider test than isDecimalText, which it contains", () => {
    for (const text of ["0", "-3", "0.5", "45454.545"]) expect(isDecimalText(text) && isNumberText(text)).toBe(true);
    expect(isDecimalText("1.2e-7")).toBe(false);
  });
});

describe("checkPairExchanges", () => {
  const TX = "A".repeat(64);
  const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
  // `GET /v2/exchanges/{base}/{counter}`: "keys in the order of the original's row", then `amm_account?` last (feat/amm-data).
  const trade = {
    base_amount: "50",
    counter_amount: "0.4545454545",
    node_index: 4,
    rate: "0.0090909091",
    tx_index: 12,
    buyer: "rBuyer",
    executed_time: "2015-01-14T18:27:20Z",
    ledger_index: 11119603,
    offer_sequence: 1517,
    provider: "rProvider",
    seller: "rSeller",
    taker: "rTaker",
    tx_hash: TX,
    tx_type: "OfferCreate",
    base_currency: "USD",
    base_issuer: ISSUER,
    counter_currency: "XRP",
  };
  const swap = {
    ...trade,
    autobridged_currency: "XRP",
    autobridged_issuer: ISSUER,
    offer_sequence: 0,
    provider: POOL,
    tx_type: "Payment",
    counter_currency: "EUR",
    counter_issuer: ISSUER,
    amm_account: POOL,
  };
  const page = { result: "success", count: 2, marker: "WzEwNzY3MDM2MCw1XQ", exchanges: [trade, swap] };

  pins(checkPairExchanges, page, [
    ["trades that are not a list", (b) => (b.exchanges = { 0: trade })],
    ["no trades", (b) => delete b.exchanges],
    ["a trade that is null", (b) => b.exchanges.push(null)],
    ["a base_amount that is a number", (b) => (b.exchanges[0].base_amount = 50)],
    ["a counter_amount that is missing", (b) => delete b.exchanges[0].counter_amount],
    ["a rate that is a number", (b) => (b.exchanges[0].rate = 0.0090909091)],
    ["a rate that is NaN", (b) => (b.exchanges[1].rate = "NaN")],
    ["a rate that is Infinity", (b) => (b.exchanges[1].rate = "Infinity")],
    ["a node_index that is text", (b) => (b.exchanges[0].node_index = "4")],
    ["a tx_index that is a fraction", (b) => (b.exchanges[0].tx_index = 1.5)],
    ["a ledger_index that is negative", (b) => (b.exchanges[0].ledger_index = -1)],
    ["no offer_sequence", (b) => delete b.exchanges[0].offer_sequence],
    ["an executed_time that is not ISO", (b) => (b.exchanges[0].executed_time = "2015-01-14 18:27:20")],
    ["an executed_time that is a number", (b) => (b.exchanges[0].executed_time = 1421260040)],
    ["no tx_hash", (b) => delete b.exchanges[0].tx_hash],
    ["an empty tx_hash", (b) => (b.exchanges[0].tx_hash = "")],
    ["no tx_type", (b) => delete b.exchanges[1].tx_type],
    ["a buyer that is a number", (b) => (b.exchanges[0].buyer = 7)],
    ["no seller", (b) => delete b.exchanges[0].seller],
    ["no taker", (b) => delete b.exchanges[0].taker],
    ["no provider", (b) => delete b.exchanges[0].provider],
    ["no base_currency", (b) => delete b.exchanges[0].base_currency],
    ["an empty counter_currency", (b) => (b.exchanges[0].counter_currency = "")],
    ["a base_issuer that is a number", (b) => (b.exchanges[0].base_issuer = 1)],
    ["a base_issuer that is empty (the API leaves the key out)", (b) => (b.exchanges[0].base_issuer = "")],
    ["a counter_issuer that is null", (b) => (b.exchanges[1].counter_issuer = null)],
    ["an autobridged_currency that is a number", (b) => (b.exchanges[1].autobridged_currency = 1)],
    ["an amm_account that is a number", (b) => (b.exchanges[1].amm_account = 1)],
    ["an amm_account that is empty (an order-book trade has no such key)", (b) => (b.exchanges[1].amm_account = "")],
    ["a marker that is a number", (b) => (b.marker = 12)],
    ["a marker that is not base64url", (b) => (b.marker = "2015-01-14T18:00:00Z")],
    ["a marker that is empty", (b) => (b.marker = "")],
    ["a marker that is too long", (b) => (b.marker = "a".repeat(513))],
    ["a count that is text", (b) => (b.count = "2")],
    ["no count", (b) => delete b.count],
  ]);

  it("takes a last page, which has no marker, and an empty one", () => {
    const last = { result: "success", count: 1, exchanges: [trade] };
    expect(checkPairExchanges(last)).toBe(last);
    const none = { result: "success", count: 0, exchanges: [] };
    expect(checkPairExchanges(none)).toBe(none);
  });

  it("takes a rate and an amount in exponent form, which the API writes for a price below 1e-6 or from 1e8", () => {
    const odd = { ...page, exchanges: [{ ...trade, rate: "1.2000000e-7", base_amount: "1.2345679e+8", counter_amount: "5e-7" }] };
    expect(checkPairExchanges(odd)).toBe(odd);
  });

  it("refuses anything that is not an object", () => {
    for (const body of [null, undefined, "exchanges", 7, [], [trade]]) refuses(checkPairExchanges, body);
  });
});

describe("checkCandles", () => {
  // `GET /v2/exchanges/{base}/{counter}?interval=`: the reference's candle, then the pair as asked for.
  const candle = {
    base_volume: "1500",
    buy_volume: 600,
    close: "0.0090909091",
    close_time: "2015-01-14T18:59:50Z",
    count: 12,
    counter_volume: "13.63636364",
    high: "0.0100000000",
    low: "0.0085000000",
    open: "0.0088000000",
    open_time: "2015-01-14T18:00:10Z",
    start: "2015-01-14T18:00:00Z",
    vwap: "0.0090909091",
    base_currency: "USD",
    base_issuer: ISSUER,
    counter_currency: "XRP",
  };
  const page = {
    result: "success",
    count: 2,
    marker: "MTQyMTI2MDAwMA",
    exchanges: [candle, { ...candle, buy_volume: 0.5, start: "2015-01-14T19:00:00Z", counter_currency: "EUR", counter_issuer: ISSUER }],
  };

  pins(checkCandles, page, [
    ["candles that are not a list", (b) => (b.exchanges = "none")],
    ["no candles", (b) => delete b.exchanges],
    ["a candle that is a list", (b) => b.exchanges.push([candle])],
    ["a base_volume that is a number", (b) => (b.exchanges[0].base_volume = 1500)],
    ["no counter_volume", (b) => delete b.exchanges[0].counter_volume],
    ["a buy_volume that is text", (b) => (b.exchanges[0].buy_volume = "600")],
    ["a buy_volume that is missing", (b) => delete b.exchanges[1].buy_volume],
    ["a buy_volume that is NaN", (b) => (b.exchanges[0].buy_volume = Number.NaN)],
    ["a close that is a number", (b) => (b.exchanges[0].close = 0.0090909091)],
    ["a high that is empty", (b) => (b.exchanges[0].high = "")],
    ["no low", (b) => delete b.exchanges[0].low],
    ["an open that is NaN", (b) => (b.exchanges[0].open = "NaN")],
    ["a vwap that is null", (b) => (b.exchanges[0].vwap = null)],
    ["a count that is text", (b) => (b.exchanges[0].count = "12")],
    ["a count that is a fraction", (b) => (b.exchanges[0].count = 1.5)],
    ["a close_time that is not ISO", (b) => (b.exchanges[0].close_time = "2015-01-14")],
    ["no open_time", (b) => delete b.exchanges[0].open_time],
    ["a start that is not ISO", (b) => (b.exchanges[1].start = "now")],
    ["no start", (b) => delete b.exchanges[0].start],
    ["no base_currency", (b) => delete b.exchanges[0].base_currency],
    ["a counter_currency that is a number", (b) => (b.exchanges[0].counter_currency = 1)],
    ["an issuer that is empty", (b) => (b.exchanges[0].base_issuer = "")],
    ["a marker that is not base64url", (b) => (b.marker = "2015-01-14T18:00:00Z")],
  ]);

  it("takes a fractional buy volume (a JavaScript number of the base bought) and prices in exponent form", () => {
    const odd = {
      ...page,
      exchanges: [{ ...candle, buy_volume: 0.000000412, open: "1.2000000e-7", high: "1.3000000e-7", low: "1.1000000e-7", close: "1.2500000e-7", vwap: "1.2100000e-7" }],
    };
    expect(checkCandles(odd)).toBe(odd);
  });

  it("takes an empty window and a page with no marker", () => {
    const none = { result: "success", count: 0, exchanges: [] };
    expect(checkCandles(none)).toBe(none);
  });
});

describe("checkReduce", () => {
  // "`{ result, count: 1, exchanges: [ {open, high, low, close, base_volume, counter_volume, buy_volume, count, open_time?, close_time?, vwap, start,
  // base_currency, base_issuer?, counter_currency, counter_issuer?} ] }`"
  const row = {
    open: "0.0088000000",
    high: "0.0100000000",
    low: "0.0085000000",
    close: "0.0090909091",
    base_volume: "1500",
    counter_volume: "13.63636364",
    buy_volume: 600,
    count: 12,
    open_time: "2015-01-14T18:00:10Z",
    close_time: "2015-01-14T18:59:50Z",
    vwap: "0.0090909091",
    start: "2015-01-14T00:00:00Z",
    base_currency: "USD",
    base_issuer: ISSUER,
    counter_currency: "XRP",
  };
  const answer = { result: "success", count: 1, exchanges: [row] };

  pins(checkReduce, answer, [
    ["no row", (b) => (b.exchanges = [])],
    ["two rows", (b) => b.exchanges.push({ ...row })],
    ["rows that are not a list", (b) => (b.exchanges = row)],
    ["no exchanges", (b) => delete b.exchanges],
    ["a row that is null", (b) => (b.exchanges = [null])],
    ["an open that is a number", (b) => (b.exchanges[0].open = 0.0088)],
    ["a close that is missing", (b) => delete b.exchanges[0].close],
    ["a base_volume that is a number", (b) => (b.exchanges[0].base_volume = 1500)],
    ["a counter_volume that is empty", (b) => (b.exchanges[0].counter_volume = "")],
    ["a buy_volume that is text", (b) => (b.exchanges[0].buy_volume = "600")],
    ["a count that is text", (b) => (b.exchanges[0].count = "12")],
    ["an open_time that is not ISO", (b) => (b.exchanges[0].open_time = "18:00")],
    ["a close_time that is a number", (b) => (b.exchanges[0].close_time = 1)],
    ["a vwap that is null", (b) => (b.exchanges[0].vwap = null)],
    ["no start", (b) => delete b.exchanges[0].start],
    ["a start that is not ISO", (b) => (b.exchanges[0].start = "2015-01-14")],
    ["no base_currency", (b) => delete b.exchanges[0].base_currency],
    ["no counter_currency", (b) => delete b.exchanges[0].counter_currency],
    ["a counter_issuer that is a number", (b) => (b.exchanges[0].counter_issuer = 5)],
  ]);

  it("takes the row of a window with no trade: prices 0.0000000, volumes 0, and no open_time or close_time", () => {
    const { open_time: _open, close_time: _close, ...bare } = row;
    const empty = {
      result: "success",
      count: 1,
      exchanges: [
        { ...bare, open: "0.0000000", high: "0.0000000", low: "0.0000000", close: "0.0000000", vwap: "0.0000000", base_volume: "0", counter_volume: "0", buy_volume: 0, count: 0 },
      ],
    };
    expect(checkReduce(empty)).toBe(empty);
  });
});

describe("checkActiveAccounts", () => {
  // `GET /v2/active_accounts/{base}/{counter}`.
  const answer = {
    result: "success",
    count: 2,
    exchanges_count: 12,
    accounts: [
      {
        buy: { base_volume: "500", counter_volume: "4.5", count: 3 },
        sell: { base_volume: "0", counter_volume: "0", count: 0 },
        account: "rTrader",
        base_volume: "500",
        counter_volume: "4.5",
        count: 3,
      },
      {
        buy: { base_volume: "0", counter_volume: "0", count: 0 },
        sell: { base_volume: "120.5", counter_volume: "1.0842", count: 2 },
        account: "rPool",
        base_volume: "120.5",
        counter_volume: "1.0842",
        count: 2,
      },
    ],
  };

  pins(checkActiveAccounts, answer, [
    ["accounts that are not a list", (b) => (b.accounts = { 0: b.accounts[0] })],
    ["no accounts", (b) => delete b.accounts],
    ["an account that is null", (b) => b.accounts.push(null)],
    ["a count that is text", (b) => (b.count = "2")],
    ["no count", (b) => delete b.count],
    ["an exchanges_count that is text", (b) => (b.exchanges_count = "12")],
    ["no exchanges_count", (b) => delete b.exchanges_count],
    ["an account that is a number", (b) => (b.accounts[0].account = 5)],
    ["an account that is empty", (b) => (b.accounts[0].account = "")],
    ["no account", (b) => delete b.accounts[1].account],
    ["a base_volume that is a number", (b) => (b.accounts[0].base_volume = 500)],
    ["no counter_volume", (b) => delete b.accounts[0].counter_volume],
    ["an account count that is text", (b) => (b.accounts[0].count = "3")],
    ["no buy", (b) => delete b.accounts[0].buy],
    ["a buy that is a list", (b) => (b.accounts[0].buy = [])],
    ["a buy base_volume that is a number", (b) => (b.accounts[0].buy.base_volume = 500)],
    ["a buy counter_volume that is missing", (b) => delete b.accounts[0].buy.counter_volume],
    ["a buy count that is text", (b) => (b.accounts[0].buy.count = "3")],
    ["no sell", (b) => delete b.accounts[1].sell],
    ["a sell count that is missing", (b) => delete b.accounts[1].sell.count],
    ["a sell base_volume that is null", (b) => (b.accounts[1].sell.base_volume = null)],
  ]);

  it("takes a pair nobody traded: no accounts", () => {
    const none = { result: "success", count: 0, exchanges_count: 0, accounts: [] };
    expect(checkActiveAccounts(none)).toBe(none);
  });
});

describe("checkMarkets", () => {
  // `GET /v2/network/markets?period=day&limit=1`, the example of the reference at feat/explorer-data 7d495ab.
  const market = {
    base_currency: "USD",
    base_issuer: ISSUER,
    counter_currency: "XRP",
    count: 13,
    base_volume: "130",
    counter_volume: "65",
    native_volume: "65",
    open: "0.50000000",
    high: "0.80000000",
    low: "0.30000000",
    last: "0.40000000",
    change: "-20.00",
    open_time: "2020-07-01T12:00:00Z",
    last_time: "2020-07-02T10:42:17Z",
    sparkline: [
      { date: "2020-06-26T00:00:00Z" },
      { date: "2020-06-27T00:00:00Z" },
      { date: "2020-06-28T00:00:00Z", close: "0.52500000" },
      { date: "2020-06-29T00:00:00Z", close: "0.52500000" },
      { date: "2020-06-30T00:00:00Z", close: "0.52500000" },
      { date: "2020-07-01T00:00:00Z", close: "0.50000000" },
      { date: "2020-07-02T00:00:00Z", close: "0.40000000" },
    ],
  };
  const plain = {
    result: "success",
    period: "day",
    start_time: "2020-07-01T10:00:00Z",
    end_time: "2020-07-02T10:42:17Z",
    totals: { pairs: 9, pairs_traded: 11, count: 112, native_volume: "243.5" },
    count: 1,
    markets: [market],
  };
  /** The check as the client runs it for a request that sent no `amm`. */
  const checkPlain = (body: unknown) => checkMarkets(body);

  pins(checkPlain, plain, [
    ["markets that are not a list", (b) => (b.markets = { 0: market })],
    ["no markets", (b) => delete b.markets],
    ["a market that is null", (b) => b.markets.push(null)],
    ["a result that is not success", (b) => (b.result = "error")],
    ["no result", (b) => delete b.result],
    ["a period the API does not have", (b) => (b.period = "week")],
    ["no period", (b) => delete b.period],
    ["a count that is text", (b) => (b.count = "1")],
    ["no count", (b) => delete b.count],
    ["a start_time that is not ISO", (b) => (b.start_time = "2020-07-01")],
    ["an end_time that is a number", (b) => (b.end_time = 1593686537)],
    ["totals that are a list", (b) => (b.totals = [])],
    ["totals that are text", (b) => (b.totals = "none")],
    ["totals that are null", (b) => (b.totals = null)],
    ["totals without pairs", (b) => delete b.totals.pairs],
    ["totals.pairs_traded that is text", (b) => (b.totals.pairs_traded = "11")],
    ["totals.count that is missing", (b) => delete b.totals.count],
    ["totals.native_volume that is a number", (b) => (b.totals.native_volume = 243.5)],
    ["no totals.native_volume", (b) => delete b.totals.native_volume],
    ["totals.converted_volume that is a number", (b) => (b.totals.converted_volume = 487)],
    ["an exchange that is not a currency", (b) => (b.exchange = "USD")],
    ["an exchange_rate that is a number", (b) => (b.exchange_rate = 2)],
    ["a base_currency that is missing", (b) => delete b.markets[0].base_currency],
    ["a counter_currency that is empty", (b) => (b.markets[0].counter_currency = "")],
    ["a base_issuer that is a number", (b) => (b.markets[0].base_issuer = 1)],
    ["a counter_issuer that is empty", (b) => (b.markets[0].counter_issuer = "")],
    ["a market count that is text", (b) => (b.markets[0].count = "13")],
    ["a market count that is a fraction", (b) => (b.markets[0].count = 1.5)],
    ["a base_volume that is a number", (b) => (b.markets[0].base_volume = 130)],
    ["no counter_volume", (b) => delete b.markets[0].counter_volume],
    ["a native_volume that is a number", (b) => (b.markets[0].native_volume = 65)],
    ["a converted_volume that is a number", (b) => (b.markets[0].converted_volume = 130)],
    ["an open that is a number", (b) => (b.markets[0].open = 0.5)],
    ["a high that is missing", (b) => delete b.markets[0].high],
    ["a low that is null", (b) => (b.markets[0].low = null)],
    ["a last that is a number", (b) => (b.markets[0].last = 0.4)],
    ["a last that is empty", (b) => (b.markets[0].last = "")],
    ["a last that is NaN", (b) => (b.markets[0].last = "NaN")],
    ["a change that is a number", (b) => (b.markets[0].change = -20)],
    ["a change in exponent form (the API writes it with toFixed(2))", (b) => (b.markets[0].change = "-2e1")],
    ["an open_time that is not ISO", (b) => (b.markets[0].open_time = "yesterday")],
    ["no open_time", (b) => delete b.markets[0].open_time],
    ["a last_time that is a number", (b) => (b.markets[0].last_time = 1593686537)],
    ["no last_time", (b) => delete b.markets[0].last_time],
    ["no sparkline", (b) => delete b.markets[0].sparkline],
    ["a sparkline that is not a list", (b) => (b.markets[0].sparkline = { 0: { date: "2020-06-26T00:00:00Z" } })],
    ["a sparkline entry that is text", (b) => b.markets[0].sparkline.push("2020-07-03T00:00:00Z")],
    ["a sparkline entry that is null", (b) => (b.markets[0].sparkline[0] = null)],
    ["a sparkline date that is not ISO", (b) => (b.markets[0].sparkline[0].date = "2020-06-26")],
    ["a sparkline entry without a date", (b) => delete b.markets[0].sparkline[2].date],
    ["a sparkline close that is a number", (b) => (b.markets[0].sparkline[2].close = 0.525)],
    ["a sparkline close that is null", (b) => (b.markets[0].sparkline[2].close = null)],
  ]);

  it("takes the AMM keys when they are known: amm_share with 4 decimals, amm_pool a boolean, totals.amm_share", () => {
    const withAmm = clone(plain) as Body;
    withAmm.totals.amm_share = "0.2150";
    withAmm.markets[0].amm_share = "0.3400";
    withAmm.markets[0].amm_pool = true;
    withAmm.markets.push({ ...clone(market), counter_currency: "EUR", counter_issuer: ISSUER, amm_share: "0.0000", amm_pool: false });
    withAmm.count = 2;
    expect(checkMarkets(withAmm)).toBe(withAmm);
  });

  it("takes a Xahau answer: amm_share 0.0000 and amm_pool false on every market", () => {
    const xahau = clone(plain) as Body;
    xahau.totals.amm_share = "0.0000";
    xahau.markets[0].amm_share = "0.0000";
    xahau.markets[0].amm_pool = false;
    expect(checkMarkets(xahau)).toBe(xahau);
  });

  describe("an AMM field it cannot read is not known (D2: absent = not known), and never takes the answer down", () => {
    /** The answer with one change to its first market, after the check. */
    const withMarket = (change: Record<string, unknown>) => {
      const body = clone(plain) as Body;
      Object.assign(body.markets[0], change);
      return checkMarkets(body);
    };

    it.each(["0.34", "0.3400", "0.34000", "0", "0.0000", "1", "1.0000", "0.0049"])("keeps an amm_share of %j: decimal text from 0 to 1 (spec 2.3)", (share) => {
      expect(withMarket({ amm_share: share }).markets[0]!.amm_share).toBe(share);
    });

    it.each([["abc"], [1.2], [0.34], ["1.2"], ["1.0001"], ["-0.1"], ["3.4e-1"], [""], [null], [true]])("drops an amm_share of %j, and keeps the row", (share) => {
      const answer = withMarket({ amm_share: share });
      expect(answer.markets).toHaveLength(1);
      expect(answer.markets[0]).not.toHaveProperty("amm_share");
      expect(answer.markets[0]!.last).toBe("0.40000000");
    });

    it.each([["true"], [1], [null]])("drops an amm_pool of %j, and keeps the share", (pool) => {
      const answer = withMarket({ amm_share: "0.3400", amm_pool: pool });
      expect(answer.markets[0]).not.toHaveProperty("amm_pool");
      expect(answer.markets[0]!.amm_share).toBe("0.3400");
    });

    it("keeps a totals.amm_share of decimal text, and drops one that is a number or no share", () => {
      for (const [share, kept] of [["0.3", true], ["0.2150", true], [0.12, false], ["abc", false], ["2", false]] as const) {
        const body = clone(plain) as Body;
        body.totals.amm_share = share;
        const { totals } = checkMarkets(body);
        if (kept) expect(totals!.amm_share).toBe(share);
        else expect(totals).not.toHaveProperty("amm_share");
        expect(totals!.native_volume).toBe("243.5");
      }
    });
  });

  it("takes a market whose optional keys are all left out: no issuers, no native_volume, no change, a sparkline with no close", () => {
    const { base_issuer: _issuer, native_volume: _native, change: _change, ...bare } = market;
    const body = {
      ...plain,
      markets: [{ ...bare, base_currency: "XRP", counter_currency: "EUR", counter_issuer: ISSUER, sparkline: [{ date: "2020-07-02T00:00:00Z" }] }],
    };
    expect(checkMarkets(body)).toBe(body);
  });

  it("takes the answer with a display currency: exchange, exchange_rate, and converted_volume in the totals and the markets", () => {
    const converted = clone(plain) as Body;
    converted.exchange = { currency: "USD", issuer: ISSUER };
    converted.exchange_rate = "2.0000000";
    converted.totals.converted_volume = "487";
    converted.markets[0].converted_volume = "130";
    expect(checkMarkets(converted)).toBe(converted);
  });

  it("takes prices in exponent form, which the API writes for a price below 1e-6 or from 1e8 (BigNumber's toPrecision(8))", () => {
    const junk = clone(plain) as Body;
    Object.assign(junk.markets[0], { open: "1.0000000e-7", high: "1.5000000e-7", low: "9.0000000e-8", last: "1.2345679e+8", native_volume: "5e-7" });
    junk.markets[0].sparkline[5].close = "1.2000000e-7";
    expect(checkMarkets(junk)).toBe(junk);
  });

  it("takes a set the aggregator has not written yet: no window, no totals, no markets", () => {
    const none = { result: "success", period: "day", count: 0, markets: [] };
    expect(checkMarkets(none)).toBe(none);
  });

  it.each(["day", "7day", "30day"])("takes the period %j", (period) => {
    const body = { ...plain, period };
    expect(checkMarkets(body)).toBe(body);
  });

  describe("the filter that was asked for is the one the answer echoes", () => {
    const echoing = (amm: string) => ({ ...plain, amm });

    it.each(["exclude", "only"] as const)("takes `amm: %j` for the filter %j, and refuses the other ones", (amm) => {
      const good = echoing(amm);
      expect(checkMarkets(good, amm)).toBe(good);
      for (const other of ["include", "exclude", "only"].filter((value) => value !== amm)) refuses((body) => checkMarkets(body, amm), echoing(other));
    });

    it.each(["exclude", "only"] as const)("refuses an answer with no `amm` for the filter %j: an API that ignored it (D2, which has no such parameter)", (amm) => {
      refuses((body) => checkMarkets(body, amm), plain);
    });

    it.each([undefined, "include", "exclude", "only", "all", null, 1])("reads no `amm` of the answer to a request that sent no filter: %j is taken", (amm) => {
      const body = amm === undefined ? plain : { ...plain, amm };
      expect(checkMarkets(body)).toBe(body);
    });

    it.each(["exclude", "only"] as const)("refuses `amm: null` and `amm: 1` for the filter %j", (amm) => {
      refuses((body) => checkMarkets(body, amm), { ...plain, amm: null });
      refuses((body) => checkMarkets(body, amm), { ...plain, amm: 1 });
    });
  });

  it("refuses anything that is not an object", () => {
    for (const body of [null, undefined, "markets", 7, [], [market]]) refuses(checkPlain, body);
  });
});
