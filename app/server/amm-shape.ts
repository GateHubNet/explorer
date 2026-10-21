// What the answers of the AMM routes must look like for the AMM pages to use them: `GET /v2/amm/pools`, a pool by its account or by its pair, a pool's days (`history`
// with `interval=day`), swaps, liquidity events and governance, and the live `amm_volume` (data-api-new `feat/amm-data` at c3e2302, `docs/api-reference.md` "AMM" and
// `apps/api/src/amm/amm-objects.ts`; the types are in api-types.ts, "AMM"). Like `aggregate-shape.ts`, the data API client runs the checks inside the load its subrequest
// cache runs, as `get()`'s `finish`: a 200 that is not what the reference promises is an `UpstreamError` of kind `server` (status 200 marks it as an answer of the
// upstream), is held when the call asks, and is never stored, and the card of the call fails with it. A check takes the whole body (the pool checks, the object under `pool`)
// and returns it, typed, as it is. Worker-only code, no I/O.
//
// What is checked: lists are lists, with a count and a marker (`listOf`); amounts are numbers as text (`isNumberText`: the API writes them with BigNumber's `toString()`, in
// exponent form below 1e-6 and from 1e21, as E3's and E4's calls of the same API are taken), except `value_native`, which is a plain decimal; fees (`trading_fee`,
// `discounted_fee`, `fee_voted`, `trading_fee_after`) are whole numbers from 0 to 1000; counts, ledger indexes and `last_ledger` are whole numbers; `deleted` is a boolean;
// an account of a person or of a pool (`amm_account`, `holder`, `account`, `initiator`, `created_by`, `buyer`, `seller`, `taker` and each of `auth_accounts`) is a classic
// address, because it goes into a link; `date`, `executed_time` and `expiration` are times; `event` and `type` are the words of the reference. Extra keys are not refused (the
// API may add a column), and a key the API leaves out when it has no value is checked when it is there: `null` is never served.

import {
  checkPairExchanges,
  checkPairOf,
  checkVolumePage,
  fields,
  isAccount,
  isBoolean,
  isDecimalText,
  isIsoTime,
  isName,
  isNumberText,
  isWhole,
  listOf,
  optionalFields,
  rowsOf,
} from "./aggregate-shape";
import type { AmmGovernanceRow, AmmLiquidityEvent, AmmPool, AmmPoolDay, AmmSwap, AmmVolumeRow, Page } from "./api-types";
import { isObject, malformed } from "./tx-shape";

const NUMBER = "a number as text";
const WHOLE = "a whole number";
const ACCOUNT = "an account";
const FEE = "a whole number from 0 to 1000";
const TIME = "a time";

/** A fee in units of 1/100000: a whole number from 0 to 1000 (1%, the ledger's largest). */
const isFee = (value: unknown): value is number => isWhole(value) && value <= 1000;

const EVENTS: readonly string[] = ["create", "deposit", "withdraw", "clawback", "delete"];
const isEvent = (value: unknown): value is AmmLiquidityEvent["event"] => typeof value === "string" && EVENTS.includes(value);

/** The auction slot of a pool: every part is there only when known. */
function checkSlot(what: string, where: string, slot: unknown): void {
  if (!isObject(slot)) throw malformed(what, `${where} is not an object`);
  optionalFields(what, where, slot, ["holder"], isAccount, ACCOUNT);
  optionalFields(what, where, slot, ["price"], isNumberText, NUMBER);
  optionalFields(what, where, slot, ["discounted_fee"], isFee, FEE);
  optionalFields(what, where, slot, ["expiration"], isIsoTime, TIME);
}

/** A pool (`Pool`): the keys it always has, and the ones it has when known. */
function checkPoolRow(what: string, where: string, row: Record<string, unknown>): void {
  fields(what, where, row, ["amm_account"], isAccount, ACCOUNT);
  checkPairOf(what, where, row);
  optionalFields(what, where, row, ["reserve_base", "reserve_counter", "lp_supply"], isNumberText, NUMBER);
  optionalFields(what, where, row, ["lp_currency"], isName, "a currency");
  optionalFields(what, where, row, ["trading_fee"], isFee, FEE);
  if (row.auction_slot !== undefined) checkSlot(what, `${where}.auction_slot`, row.auction_slot);
  // The value is never in exponent form (`valueText`): it is the one amount that is plain by contract.
  optionalFields(what, where, row, ["value_native"], isDecimalText, "a decimal as text");
  optionalFields(what, where, row, ["created_ledger"], isWhole, WHOLE);
  optionalFields(what, where, row, ["created_by"], isAccount, ACCOUNT);
  fields(what, where, row, ["last_ledger"], isWhole, WHOLE);
  fields(what, where, row, ["deleted"], isBoolean, "a boolean");
}

/** `GET /v2/amm/pools`: the pools, the most valuable first, under `pools`. */
export function checkPoolsPage(body: unknown): Page<"pools", AmmPool> {
  const what = "data API AMM pools";
  for (const [index, row] of listOf(what, body, "pools").entries()) checkPoolRow(what, `pools[${index}]`, row);
  return body as Page<"pools", AmmPool>;
}

/**
 * The `pool` of `GET /v2/amm/pools/{pool}` or of the pair form (the client unwraps it). For the account form `asked` is the pool that was asked for: an answer for another
 * pool is not the one asked for, and a page would show it as that one.
 */
export function checkPool(pool: unknown, asked?: string): AmmPool {
  const what = "data API AMM pool";
  if (!isObject(pool)) throw malformed(what, "the pool is not an object");
  checkPoolRow(what, "pool", pool);
  if (asked !== undefined && pool.amm_account !== asked) {
    throw malformed(what, `pool.amm_account is ${JSON.stringify(pool.amm_account)}, not the pool that was asked for (${JSON.stringify(asked)})`);
  }
  return pool as unknown as AmmPool;
}

/** `GET /v2/amm/pools/{pool}/history?interval=day`: a row for each UTC day with activity (`PoolDay`), under `days`. */
export function checkDaysPage(body: unknown): Page<"days", AmmPoolDay> {
  const what = "data API AMM pool days";
  for (const [index, row] of listOf(what, body, "days").entries()) {
    const where = `days[${index}]`;
    fields(what, where, row, ["amm_account"], isAccount, ACCOUNT);
    fields(what, where, row, ["date"], isIsoTime, TIME);
    checkPairOf(what, where, row);
    fields(what, where, row, ["swap_count", "deposit_count", "withdraw_count"], isWhole, WHOLE);
    fields(
      what,
      where,
      row,
      ["volume_base", "volume_counter", "liquidity_in_base", "liquidity_in_counter", "liquidity_out_base", "liquidity_out_counter"],
      isNumberText,
      NUMBER,
    );
    // An estimate is left out when a swap into its side had no known fee, and "0" is a known zero.
    optionalFields(what, where, row, ["fees_base_est", "fees_counter_est", "reserve_base", "reserve_counter", "lp_supply"], isNumberText, NUMBER);
    optionalFields(what, where, row, ["trading_fee"], isFee, FEE);
    optionalFields(what, where, row, ["value_native"], isDecimalText, "a decimal as text");
  }
  return body as Page<"days", AmmPoolDay>;
}

/**
 * `GET /v2/amm/pools/{pool}/swaps`: the pool's swaps, each an exchange of the pair (`checkPairExchanges`) that has the pool as its `amm_account` and accounts that go
 * into links.
 */
export function checkSwapsPage(body: unknown): Page<"exchanges", AmmSwap> {
  const what = "data API AMM swaps";
  checkPairExchanges(body);
  for (const [index, row] of rowsOf(what, body, "exchanges").entries()) {
    fields(what, `exchanges[${index}]`, row, ["amm_account", "buyer", "seller", "taker"], isAccount, ACCOUNT);
  }
  return body as Page<"exchanges", AmmSwap>;
}

/**
 * `GET /v2/amm/pools/{pool}/liquidity`: the creation, deposits, withdrawals, clawbacks and deletion of the pool (`LiquidityEvent`), under `liquidity`. `asked` is the `event`
 * the request filtered by, if any: a row of another event is not the answer to that request (an API that ignored the parameter), and a page would show it as the pool's creation.
 */
export function checkLiquidityPage(body: unknown, asked?: AmmLiquidityEvent["event"]): Page<"liquidity", AmmLiquidityEvent> {
  const what = "data API AMM liquidity";
  for (const [index, row] of listOf(what, body, "liquidity").entries()) {
    const where = `liquidity[${index}]`;
    fields(what, where, row, ["amm_account", "account", "initiator"], isAccount, ACCOUNT);
    fields(what, where, row, ["ledger_index", "tx_index"], isWhole, WHOLE);
    fields(what, where, row, ["tx_hash"], isName, "text");
    fields(what, where, row, ["executed_time"], isIsoTime, TIME);
    fields(what, where, row, ["event"], isEvent, "create, deposit, withdraw, clawback or delete");
    if (asked !== undefined && row.event !== asked) {
      throw malformed(what, `${where}.event is ${JSON.stringify(row.event)}, not the ${JSON.stringify(asked)} that was asked for (an API that ignored the filter?)`);
    }
    optionalFields(what, where, row, ["mode"], isName, "text");
    // Signed from the pool's side: a withdrawal's amounts and burned tokens are negative.
    fields(what, where, row, ["base_amount", "counter_amount", "lp_tokens"], isNumberText, NUMBER);
  }
  return body as Page<"liquidity", AmmLiquidityEvent>;
}

/** The slot a bid leaves: every part is there only when known, and `auth_accounts` always is, a list. */
function checkBidSlot(what: string, where: string, slot: unknown): void {
  if (!isObject(slot)) throw malformed(what, `${where} is not an object`);
  optionalFields(what, where, slot, ["holder"], isAccount, ACCOUNT);
  optionalFields(what, where, slot, ["discounted_fee"], isFee, FEE);
  optionalFields(what, where, slot, ["expiration"], isIsoTime, TIME);
  const accounts = slot.auth_accounts;
  if (!Array.isArray(accounts)) throw malformed(what, `${where}.auth_accounts is not a list`);
  for (const [index, account] of (accounts as unknown[]).entries()) {
    if (!isAccount(account)) throw malformed(what, `${where}.auth_accounts[${index}] is not ${ACCOUNT}`);
  }
}

/** `GET /v2/amm/pools/{pool}/governance`: the votes on the trading fee and the bids for the auction slot (`Vote`, `Bid`), under `governance`. */
export function checkGovernancePage(body: unknown): Page<"governance", AmmGovernanceRow> {
  const what = "data API AMM governance";
  for (const [index, row] of listOf(what, body, "governance").entries()) {
    const where = `governance[${index}]`;
    fields(what, where, row, ["amm_account", "account"], isAccount, ACCOUNT);
    fields(what, where, row, ["ledger_index", "tx_index"], isWhole, WHOLE);
    fields(what, where, row, ["tx_hash"], isName, "text");
    fields(what, where, row, ["executed_time"], isIsoTime, TIME);
    if (row.type === "vote") {
      optionalFields(what, where, row, ["fee_voted", "trading_fee_after"], isFee, FEE);
    } else if (row.type === "bid") {
      optionalFields(what, where, row, ["bid_min", "bid_max", "price_paid"], isNumberText, NUMBER);
      if (row.auction_slot !== undefined) checkBidSlot(what, `${where}.auction_slot`, row.auction_slot);
    } else {
      throw malformed(what, `${where}.type is not vote or bid`);
    }
  }
  return body as Page<"governance", AmmGovernanceRow>;
}

/**
 * `GET /v2/network/amm_volume?live=day`: the volume of a rolling day. It is a volume page (`checkVolumePage("amm")`) of exactly one row: the period ending now. An answer
 * with no row, or with more than one, is not that.
 */
export function checkLiveVolume(body: unknown): Page<"rows", AmmVolumeRow> {
  const page = checkVolumePage("amm", body);
  if (page.rows.length !== 1) throw malformed("data API AMM volume", `${page.rows.length} rows, not one`);
  return page;
}
