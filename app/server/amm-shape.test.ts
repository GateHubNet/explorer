import { describe, expect, it } from "vitest";

import {
  AMM_ISSUER,
  AMM_OTHER,
  AMM_POOL,
  ammBidSample,
  ammDaySample,
  ammDaysSample,
  ammGovernanceSample,
  ammLiquidityPageSample,
  ammLiquiditySample,
  ammLiveVolumeSample,
  ammPoolSample,
  ammPoolsSample,
  ammSwapSample,
  ammSwapsSample,
  ammVoteSample,
} from "../../test/support/amm-samples";
import {
  checkDaysPage,
  checkGovernancePage,
  checkLiquidityPage,
  checkLiveVolume,
  checkPool,
  checkPoolsPage,
  checkSwapsPage,
} from "./amm-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api-new/docs/api-reference.md ("AMM", feat/amm-data c3e2302), with addresses that exist, and the exchanges' and
// `amm_volume`'s for the swaps and the live volume (test/support/amm-samples.ts). A defect is one change to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
/** What is wrong, the field the message must name, and the change that makes it so. */
type Defect = [what: string, field: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), and its message names `field`. */
function refuses(check: (body: unknown) => unknown, body: unknown, field: string): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  expect((error as UpstreamError).message).toContain(field);
}

/** The example is taken and returned as it is; every change in `defects` makes it a refused answer that names its field. */
function pins(check: (body: unknown) => unknown, good: unknown, defects: Defect[]): void {
  it("takes the reference's example, and returns it as it is", () => {
    expect(check(good)).toBe(good);
  });
  it.each(defects)("refuses %s", (_what, field, defect) => {
    const body = clone(good);
    defect(body);
    refuses(check, body, field);
  });
}

const POOL = AMM_POOL;
const OTHER = AMM_OTHER;
const ISSUER = AMM_ISSUER;

// ---- Pools --------------------------------------------------------------------------------------------------------------------------------------

const pool = ammPoolSample();
const poolsPage = ammPoolsSample();

/** What makes a pool not one, for the list (under `pools[0]`) and for the single pool (the object itself). */
const poolDefects: Array<[what: string, field: string, change: (pool: Body) => void]> = [
  ["a trading_fee above 1000", "trading_fee", (p) => (p.trading_fee = 1001)],
  ["a negative trading_fee", "trading_fee", (p) => (p.trading_fee = -1)],
  ["a trading_fee with a fraction", "trading_fee", (p) => (p.trading_fee = 12.5)],
  ["a trading_fee that is text", "trading_fee", (p) => (p.trading_fee = "500")],
  ["a deleted that is text", "deleted", (p) => (p.deleted = "false")],
  ["a deleted that is a number", "deleted", (p) => (p.deleted = 0)],
  ["no deleted", "deleted", (p) => delete p.deleted],
  ["a reserve_base that is a JSON number", "reserve_base", (p) => (p.reserve_base = 12.5)],
  ["a reserve_base that is not a number", "reserve_base", (p) => (p.reserve_base = "twelve")],
  ["a reserve_base that is NaN", "reserve_base", (p) => (p.reserve_base = "NaN")],
  ["a reserve_base with an exponent of 4 digits", "reserve_base", (p) => (p.reserve_base = "1e1000")],
  ["a reserve_counter that is empty", "reserve_counter", (p) => (p.reserve_counter = "")],
  ["an lp_supply that is a number", "lp_supply", (p) => (p.lp_supply = 1767.7669)],
  ["an lp_currency that is empty", "lp_currency", (p) => (p.lp_currency = "")],
  ["an amm_account that is no address", "amm_account", (p) => (p.amm_account = "rNope")],
  ["no amm_account", "amm_account", (p) => delete p.amm_account],
  ["an amm_account that is an X-address", "amm_account", (p) => (p.amm_account = "X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ")],
  ["no last_ledger", "last_ledger", (p) => delete p.last_ledger],
  ["a last_ledger that is text", "last_ledger", (p) => (p.last_ledger = "107717584")],
  ["a created_ledger that is negative", "created_ledger", (p) => (p.created_ledger = -1)],
  ["a created_by that is no address", "created_by", (p) => (p.created_by = "rNope")],
  ["a value_native that is a number", "value_native", (p) => (p.value_native = 5000)],
  ["a value_native in exponent form", "value_native", (p) => (p.value_native = "1e-7")],
  ["no base_currency", "base_currency", (p) => delete p.base_currency],
  ["an empty counter_currency", "counter_currency", (p) => (p.counter_currency = "")],
  ["a base_issuer that is a number", "base_issuer", (p) => (p.base_issuer = 5)],
  ["an auction_slot that is text", "auction_slot", (p) => (p.auction_slot = "none")],
  // `null` is never served (an unknown key is left out): it is not "not known" here, it is not what the API writes.
  ["an auction_slot that is null", "auction_slot", (p) => (p.auction_slot = null)],
  ["a reserve_base that is null", "reserve_base", (p) => (p.reserve_base = null)],
  ["a trading_fee that is null", "trading_fee", (p) => (p.trading_fee = null)],
  ["a value_native that is null", "value_native", (p) => (p.value_native = null)],
  ["a created_by that is null", "created_by", (p) => (p.created_by = null)],
  ["an auction_slot whose holder is no address", "holder", (p) => (p.auction_slot.holder = "rNope")],
  ["an auction_slot whose price is a number", "price", (p) => (p.auction_slot.price = 12.5)],
  ["an auction_slot whose discounted_fee is above 1000", "discounted_fee", (p) => (p.auction_slot.discounted_fee = 1001)],
  ["an auction_slot whose expiration is not a time", "expiration", (p) => (p.auction_slot.expiration = "tomorrow")],
];

describe("checkPoolsPage", () => {
  pins(checkPoolsPage, poolsPage, [
    ["pools that are not a list", "pools", (b) => (b.pools = { 0: pool })],
    ["no pools", "pools", (b) => delete b.pools],
    ["a pool that is text", "pools[0]", (b) => (b.pools[0] = POOL)],
    ["a count that is text", "count", (b) => (b.count = "1")],
    ["no count", "count", (b) => delete b.count],
    ["a marker that is none", "marker", (b) => (b.marker = "not a marker!")],
    ...poolDefects.map(([what, field, change]): Defect => [`${what}, in a list`, field, (b) => change(b.pools[0])]),
  ]);

  it("takes the pool of a data API that has seen it in the middle of its life, and one that is deleted: only the keys that are always there", () => {
    const bare = { amm_account: POOL, base_currency: "USD", counter_currency: "XRP", last_ledger: 107717584, deleted: true };
    const page = { result: "success", count: 1, pools: [bare] };
    expect(checkPoolsPage(page)).toBe(page);
  });

  it("takes a pool of the native currency (no issuer key) and the boundaries of a fee: 0 and 1000", () => {
    const page = {
      result: "success",
      count: 2,
      pools: [
        { ...pool, base_issuer: undefined, base_currency: "XRP", counter_currency: "USD", counter_issuer: ISSUER, trading_fee: 0, auction_slot: { discounted_fee: 0 } },
        { ...pool, trading_fee: 1000 },
      ],
    };
    expect(checkPoolsPage(page)).toBe(page);
  });

  it("takes the amounts as BigNumber writes them: a dust reserve, an LP supply from 1e21, a price below 1e-6, with an upper-case E and a sign", () => {
    const dust = { ...pool, reserve_base: "1.5e-7", reserve_counter: "2.5E+9", lp_supply: "1e+21", auction_slot: { price: "1e-9" } };
    const page = { result: "success", count: 1, pools: [dust] };
    expect(checkPoolsPage(page)).toBe(page);
  });

  it("takes an empty page, and does not refuse a key it does not know", () => {
    expect(checkPoolsPage({ result: "success", count: 0, pools: [] }).pools).toEqual([]);
    const newer = { result: "success", count: 1, pools: [{ ...pool, tvl_usd: "12" }] };
    expect(checkPoolsPage(newer)).toBe(newer);
  });

  it.each([null, undefined, "pools", 7, [], [pool]])("refuses %j as the answer", (body) => {
    refuses(checkPoolsPage, body, "pools");
  });
});

describe("checkPool", () => {
  pins(checkPool, pool, poolDefects.map(([what, field, change]): Defect => [what, field, change]));

  it("takes the pool that was asked for, and any pool when none was named (the pair form)", () => {
    expect(checkPool(pool, POOL)).toBe(pool);
    expect(checkPool(pool)).toBe(pool);
  });

  it("refuses another pool's amm_account than the one asked for, and names both", () => {
    let error: unknown;
    try {
      checkPool(pool, OTHER);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).kind).toBe("server");
    expect((error as UpstreamError).status).toBe(200);
    expect((error as UpstreamError).message).toContain("amm_account");
    expect((error as UpstreamError).message).toContain(POOL);
    expect((error as UpstreamError).message).toContain(OTHER);
  });

  it.each([null, undefined, "pool", 7, [], [pool]])("refuses %j as the pool", (body) => {
    refuses((b) => checkPool(b, POOL), body, "pool");
  });
});

// ---- A pool's days ------------------------------------------------------------------------------------------------------------------------------

const day = ammDaySample();
const daysPage = ammDaysSample();

describe("checkDaysPage", () => {
  pins(checkDaysPage, daysPage, [
    ["days that are not a list", "days", (b) => (b.days = { 0: day })],
    ["no days", "days", (b) => delete b.days],
    ["a count that is text", "count", (b) => (b.count = "1")],
    ["a swap_count that is text", "swap_count", (b) => (b.days[0].swap_count = "3")],
    ["a swap_count with a fraction", "swap_count", (b) => (b.days[0].swap_count = 1.5)],
    ["a negative swap_count", "swap_count", (b) => (b.days[0].swap_count = -1)],
    ["no swap_count", "swap_count", (b) => delete b.days[0].swap_count],
    ["a deposit_count that is text", "deposit_count", (b) => (b.days[0].deposit_count = "2")],
    ["a withdraw_count that is missing", "withdraw_count", (b) => delete b.days[0].withdraw_count],
    ["a volume_base that is a number", "volume_base", (b) => (b.days[0].volume_base = 340.5)],
    ["a volume_counter that is no number", "volume_counter", (b) => (b.days[0].volume_counter = "lots")],
    ["a fees_base_est that is a number", "fees_base_est", (b) => (b.days[0].fees_base_est = 0.85)],
    ["a fees_counter_est that is empty", "fees_counter_est", (b) => (b.days[0].fees_counter_est = "")],
    // An estimate that is not known is left out, never `null`.
    ["a fees_base_est that is null", "fees_base_est", (b) => (b.days[0].fees_base_est = null)],
    ["a fees_counter_est that is null", "fees_counter_est", (b) => (b.days[0].fees_counter_est = null)],
    ["a reserve_base that is null", "reserve_base", (b) => (b.days[0].reserve_base = null)],
    ["an lp_supply that is null", "lp_supply", (b) => (b.days[0].lp_supply = null)],
    ["a trading_fee that is null", "trading_fee", (b) => (b.days[0].trading_fee = null)],
    ["a value_native that is null", "value_native", (b) => (b.days[0].value_native = null)],
    ["no liquidity_in_base", "liquidity_in_base", (b) => delete b.days[0].liquidity_in_base],
    ["a liquidity_in_counter that is a number", "liquidity_in_counter", (b) => (b.days[0].liquidity_in_counter = 20)],
    ["a liquidity_out_base that is NaN", "liquidity_out_base", (b) => (b.days[0].liquidity_out_base = "NaN")],
    ["a liquidity_out_counter that is a number", "liquidity_out_counter", (b) => (b.days[0].liquidity_out_counter = 10)],
    ["a date that is a day only", "date", (b) => (b.days[0].date = "2026-10-16")],
    ["a date that is no time", "date", (b) => (b.days[0].date = "yesterday")],
    ["no date", "date", (b) => delete b.days[0].date],
    ["a reserve_base that is a number", "reserve_base", (b) => (b.days[0].reserve_base = 1250.5)],
    ["an lp_supply that is a number", "lp_supply", (b) => (b.days[0].lp_supply = 1767.7669)],
    ["a trading_fee above 1000", "trading_fee", (b) => (b.days[0].trading_fee = 1001)],
    ["a value_native in exponent form", "value_native", (b) => (b.days[0].value_native = "5e-7")],
    ["an amm_account that is no address", "amm_account", (b) => (b.days[0].amm_account = "rNope")],
    ["no base_currency", "base_currency", (b) => delete b.days[0].base_currency],
    ["a counter_issuer that is a number", "counter_issuer", (b) => (b.days[0].counter_issuer = 1)],
  ]);

  it("takes a day with no fee estimate (a swap into that side had no known fee: the key is left out, which is not zero), and a known zero", () => {
    const { fees_base_est, fees_counter_est, ...unknown } = day;
    void fees_base_est;
    void fees_counter_est;
    const known = { ...day, fees_base_est: "0", fees_counter_est: "0" };
    const page = { result: "success", count: 2, days: [unknown, known] };
    expect(checkDaysPage(page)).toBe(page);
  });

  it("takes the day of a pool deleted that day: no reserves, no supply, no fee, no value", () => {
    const { reserve_base, reserve_counter, lp_supply, trading_fee, value_native, ...deleted } = day;
    void [reserve_base, reserve_counter, lp_supply, trading_fee, value_native];
    const page = { result: "success", count: 1, days: [deleted] };
    expect(checkDaysPage(page)).toBe(page);
  });

  it("takes the amounts as BigNumber writes them, and an empty page (a pool with states and no day yet)", () => {
    const dust = { ...day, volume_base: "1.5e-7", liquidity_out_counter: "2.5E+9", fees_base_est: "3e-8" };
    const page = { result: "success", count: 1, days: [dust] };
    expect(checkDaysPage(page)).toBe(page);
    expect(checkDaysPage({ result: "success", count: 0, days: [] }).days).toEqual([]);
  });

  it.each([null, undefined, "days", 7, [], [day]])("refuses %j as the answer", (body) => {
    refuses(checkDaysPage, body, "days");
  });
});

// ---- A pool's swaps -----------------------------------------------------------------------------------------------------------------------------

const swap = ammSwapSample();
const swapsPage = ammSwapsSample();

describe("checkSwapsPage", () => {
  pins(checkSwapsPage, swapsPage, [
    ["exchanges that are not a list", "exchanges", (b) => (b.exchanges = { 0: swap })],
    ["a count that is missing", "count", (b) => delete b.count],
    ["a marker that is none", "marker", (b) => (b.marker = "no marker")],
    // The trade's own rules (`checkPairExchanges`).
    ["a rate that is a number", "rate", (b) => (b.exchanges[0].rate = 2.45)],
    ["a base_amount that is a number", "base_amount", (b) => (b.exchanges[1].base_amount = 50)],
    ["an executed_time that is not a time", "executed_time", (b) => (b.exchanges[0].executed_time = "noon")],
    ["a ledger_index that is text", "ledger_index", (b) => (b.exchanges[0].ledger_index = "107695660")],
    // What a swap adds: the pool, and the accounts that go into links.
    ["a trade with no amm_account (an order-book trade)", "amm_account", (b) => delete b.exchanges[1].amm_account],
    ["an amm_account that is no address", "amm_account", (b) => (b.exchanges[0].amm_account = "rNope")],
    ["a buyer that is no address", "buyer", (b) => (b.exchanges[0].buyer = "rNope")],
    ["a seller that is no address", "seller", (b) => (b.exchanges[1].seller = "")],
    ["a taker that is no address", "taker", (b) => (b.exchanges[0].taker = "taker")],
  ]);

  it("takes the amounts as BigNumber writes them (a dust swap), and an empty page", () => {
    const dust = { ...swap, base_amount: "1.5e-7", counter_amount: "3e-7", rate: "2.0000000e+0" };
    const page = { result: "success", count: 1, exchanges: [dust] };
    expect(checkSwapsPage(page)).toBe(page);
    expect(checkSwapsPage({ result: "success", count: 0, exchanges: [] }).exchanges).toEqual([]);
  });

  it.each([null, undefined, "exchanges", 7, [], [swap]])("refuses %j as the answer", (body) => {
    refuses(checkSwapsPage, body, "exchanges");
  });
});

// ---- A pool's liquidity events ------------------------------------------------------------------------------------------------------------------

const deposit = ammLiquiditySample();
const liquidityPage = ammLiquidityPageSample();

describe("checkLiquidityPage", () => {
  pins(checkLiquidityPage, liquidityPage, [
    ["liquidity that is not a list", "liquidity", (b) => (b.liquidity = { 0: deposit })],
    ["no liquidity", "liquidity", (b) => delete b.liquidity],
    ["a count that is text", "count", (b) => (b.count = "1")],
    ["an event that is none of the five", "event", (b) => (b.liquidity[0].event = "mint")],
    ["no event", "event", (b) => delete b.liquidity[0].event],
    ["an event in capitals", "event", (b) => (b.liquidity[0].event = "Deposit")],
    ["a mode that is empty", "mode", (b) => (b.liquidity[0].mode = "")],
    ["a mode that is a number", "mode", (b) => (b.liquidity[0].mode = 2)],
    ["a base_amount that is a number", "base_amount", (b) => (b.liquidity[0].base_amount = 10)],
    ["a counter_amount that is no number", "counter_amount", (b) => (b.liquidity[0].counter_amount = "twenty")],
    ["no lp_tokens", "lp_tokens", (b) => delete b.liquidity[0].lp_tokens],
    ["lp_tokens that are a number", "lp_tokens", (b) => (b.liquidity[0].lp_tokens = 14.1421356)],
    ["an account that is no address", "account", (b) => (b.liquidity[0].account = "rNope")],
    ["an initiator that is no address", "initiator", (b) => (b.liquidity[0].initiator = "")],
    ["an amm_account that is no address", "amm_account", (b) => (b.liquidity[0].amm_account = "rNope")],
    ["a ledger_index that is text", "ledger_index", (b) => (b.liquidity[0].ledger_index = "107703707")],
    ["a tx_index that is negative", "tx_index", (b) => (b.liquidity[0].tx_index = -1)],
    ["no tx_hash", "tx_hash", (b) => delete b.liquidity[0].tx_hash],
    ["an executed_time that is a day only", "executed_time", (b) => (b.liquidity[0].executed_time = "2026-10-17")],
  ]);

  it("takes all five events, a withdrawal with negative amounts, and a clawback whose account is not its initiator", () => {
    const page = {
      result: "success",
      count: 5,
      liquidity: [
        { ...deposit, event: "create", mode: undefined },
        deposit,
        { ...deposit, event: "withdraw", mode: "withdraw_all", base_amount: "-10", counter_amount: "-20", lp_tokens: "-14.1421356" },
        { ...deposit, event: "clawback", mode: undefined, account: OTHER, initiator: ISSUER },
        { ...deposit, event: "delete", mode: undefined, base_amount: "0", counter_amount: "0", lp_tokens: "0" },
      ],
    };
    expect(checkLiquidityPage(page)).toBe(page);
  });

  it("takes the amounts as BigNumber writes them, and the empty list that a pool with no create event in the window answers", () => {
    const dust = { ...deposit, base_amount: "1.5e-7", counter_amount: "-2.5E+9", lp_tokens: "1e-9" };
    const page = { result: "success", count: 1, liquidity: [dust] };
    expect(checkLiquidityPage(page)).toBe(page);
    expect(checkLiquidityPage({ result: "success", count: 0, liquidity: [] }).liquidity).toEqual([]);
  });

  it.each([null, undefined, "liquidity", 7, [], [deposit]])("refuses %j as the answer", (body) => {
    refuses(checkLiquidityPage, body, "liquidity");
  });

  describe("the event that was asked for", () => {
    const create = { ...deposit, event: "create", mode: undefined };

    it("takes rows that are all that event, and an empty page", () => {
      const page = { result: "success", count: 2, liquidity: [create, { ...create, tx_index: 13 }] };
      expect(checkLiquidityPage(page, "create")).toBe(page);
      const none = { result: "success", count: 0, liquidity: [] };
      expect(checkLiquidityPage(none, "create")).toBe(none);
    });

    it("refuses a row of another event (an API that ignored the filter), and names the field and both events", () => {
      const page = { result: "success", count: 2, liquidity: [create, deposit] };
      refuses((body) => checkLiquidityPage(body, "create"), page, "liquidity[1].event");
      let error: unknown;
      try {
        checkLiquidityPage(page, "create");
      } catch (caught) {
        error = caught;
      }
      expect((error as UpstreamError).message).toContain('"deposit"');
      expect((error as UpstreamError).message).toContain('"create"');
    });

    it("takes any event when none was asked for", () => {
      const page = { result: "success", count: 2, liquidity: [create, deposit] };
      expect(checkLiquidityPage(page)).toBe(page);
    });
  });
});

// ---- A pool's governance ------------------------------------------------------------------------------------------------------------------------

const vote = ammVoteSample();
const bid = ammBidSample();
const governancePage = ammGovernanceSample();

describe("checkGovernancePage", () => {
  pins(checkGovernancePage, governancePage, [
    ["governance that is not a list", "governance", (b) => (b.governance = { 0: vote })],
    ["no governance", "governance", (b) => delete b.governance],
    ["a count that is text", "count", (b) => (b.count = "2")],
    ["a type that is both", "type", (b) => (b.governance[0].type = "both")],
    ["no type", "type", (b) => delete b.governance[1].type],
    ["a type in capitals", "type", (b) => (b.governance[1].type = "Bid")],
    ["an account that is no address", "account", (b) => (b.governance[0].account = "rNope")],
    ["an amm_account that is no address", "amm_account", (b) => (b.governance[1].amm_account = "rNope")],
    ["a ledger_index that is text", "ledger_index", (b) => (b.governance[0].ledger_index = "107644916")],
    ["a tx_index that is missing", "tx_index", (b) => delete b.governance[1].tx_index],
    ["an executed_time that is not a time", "executed_time", (b) => (b.governance[0].executed_time = "morning")],
    // A vote
    ["a fee_voted above 1000", "fee_voted", (b) => (b.governance[0].fee_voted = 1001)],
    ["a fee_voted that is text", "fee_voted", (b) => (b.governance[0].fee_voted = "300")],
    ["a negative fee_voted", "fee_voted", (b) => (b.governance[0].fee_voted = -1)],
    ["a trading_fee_after with a fraction", "trading_fee_after", (b) => (b.governance[0].trading_fee_after = 450.5)],
    ["a trading_fee_after above 1000", "trading_fee_after", (b) => (b.governance[0].trading_fee_after = 100000)],
    // A bid
    ["a bid_min that is a number", "bid_min", (b) => (b.governance[1].bid_min = 1)],
    ["a bid_max that is no number", "bid_max", (b) => (b.governance[1].bid_max = "five")],
    ["a price_paid that is a number", "price_paid", (b) => (b.governance[1].price_paid = 2.5)],
    ["an auction_slot that is text", "auction_slot", (b) => (b.governance[1].auction_slot = "slot")],
    ["a slot whose holder is no address", "holder", (b) => (b.governance[1].auction_slot.holder = "rNope")],
    ["a slot whose discounted_fee is above 1000", "discounted_fee", (b) => (b.governance[1].auction_slot.discounted_fee = 1001)],
    ["a slot whose expiration is not a time", "expiration", (b) => (b.governance[1].auction_slot.expiration = "tomorrow")],
    ["a slot with no auth_accounts", "auth_accounts", (b) => delete b.governance[1].auction_slot.auth_accounts],
    ["a slot whose auth_accounts is not a list", "auth_accounts", (b) => (b.governance[1].auction_slot.auth_accounts = OTHER)],
    ["an auth_accounts entry that is no address", "auth_accounts", (b) => (b.governance[1].auction_slot.auth_accounts = [OTHER, "rNope"])],
    ["an auth_accounts entry that is a number", "auth_accounts", (b) => (b.governance[1].auction_slot.auth_accounts = [7])],
    ["a fee_voted that is null", "fee_voted", (b) => (b.governance[0].fee_voted = null)],
    ["a bid_min that is null", "bid_min", (b) => (b.governance[1].bid_min = null)],
    ["an auction_slot that is null", "auction_slot", (b) => (b.governance[1].auction_slot = null)],
  ]);

  it("takes a vote and a bid with only what they always have, and the boundaries of a fee", () => {
    const { fee_voted, trading_fee_after, ...bareVote } = vote;
    void [fee_voted, trading_fee_after];
    const { bid_min, bid_max, price_paid, auction_slot, ...bareBid } = bid;
    void [bid_min, bid_max, price_paid, auction_slot];
    const page = {
      result: "success",
      count: 4,
      governance: [bareVote, bareBid, { ...vote, fee_voted: 0, trading_fee_after: 1000 }, { ...bid, auction_slot: { auth_accounts: [] } }],
    };
    expect(checkGovernancePage(page)).toBe(page);
  });

  it("takes the bid amounts as BigNumber writes them, and an empty page", () => {
    const dust = { ...bid, bid_min: "1e-9", bid_max: "2.5E+9", price_paid: "3.5e-7" };
    const page = { result: "success", count: 1, governance: [dust] };
    expect(checkGovernancePage(page)).toBe(page);
    expect(checkGovernancePage({ result: "success", count: 0, governance: [] }).governance).toEqual([]);
  });

  it.each([null, undefined, "governance", 7, [], [vote]])("refuses %j as the answer", (body) => {
    refuses(checkGovernancePage, body, "governance");
  });
});

// ---- The live volume ----------------------------------------------------------------------------------------------------------------------------

const liveVolume = ammLiveVolumeSample();
const volumeRow = liveVolume.rows[0]!;

describe("checkLiveVolume", () => {
  pins(checkLiveVolume, liveVolume, [
    // Exactly one row: the rolling period ending now.
    ["two rows", "rows", (b) => b.rows.push(clone(b.rows[0]))],
    ["no row", "rows", (b) => (b.rows = [])],
    ["rows that are not a list", "rows", (b) => (b.rows = { 0: volumeRow })],
    // The volume page's own rules (`checkVolumePage("amm")`).
    ["a total that is a number", "total", (b) => (b.rows[0].total = 3000.5)],
    ["a start_time that is not a time", "start_time", (b) => (b.rows[0].start_time = "now")],
    ["components that are not a list", "components", (b) => (b.rows[0].components = {})],
    ["a component with no amm_account", "amm_account", (b) => delete b.rows[0].components[0].amm_account],
    ["a component whose converted_amount is a number", "converted_amount", (b) => (b.rows[0].components[0].converted_amount = 3000.5)],
    ["a component whose base is not a currency", "base", (b) => (b.rows[0].components[0].base = "USD")],
  ]);

  it("takes the one row of a network without pools: no components, zero totals (Xahau)", () => {
    const none = { result: "success", count: 1, rows: [{ ...volumeRow, components: [], count: 0, total: "0" }] };
    expect(checkLiveVolume(none)).toBe(none);
  });

  it("takes a component in exponent form, which BigNumber's text has for a tiny amount or a rate from 1e8", () => {
    const dust = clone(liveVolume);
    Object.assign(dust.rows[0]!.components[0]!, { amount: "2.5e-7", rate: "1.2345679e+8", converted_amount: "1.5e-7" });
    expect(checkLiveVolume(dust)).toBe(dust);
  });

  it.each([null, undefined, "rows", 7, [], [volumeRow]])("refuses %j as the answer", (body) => {
    refuses(checkLiveVolume, body, "rows");
  });
});
