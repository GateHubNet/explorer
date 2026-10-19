import { describe, expect, it } from "vitest";

import {
  checkFeeBucketPage,
  checkFeeStatsPage,
  checkStatsPage,
  checkValidations,
  checkVolumePage,
  isDecimalText,
  isIsoTime,
} from "./aggregate-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api-new/docs/api-reference.md ("Network", "Validations", "Stats", and "amm_volume" on feat/amm-data), where it
// gives one; the rest are built from its list of keys. A defect is one change to an example.

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
    ["a total in exponent form", (page) => (page.rows[0].total = "4.5e4")],
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
    ["a converted_amount in exponent form", (page) => (page.rows[0].components[0].converted_amount = "1e3")],
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
