// Small, valid answers of the AMM routes of the data API, for the tests of the client (test/worker/data-api.spec.ts) and of its shape checks
// (app/server/amm-shape.test.ts). XRPL values, in the shapes of data-api-new/docs/api-reference.md at feat/amm-data c3e2302, "AMM" (the reference's own examples are
// the model, with addresses that exist), and "Exchanges" and "amm_volume" for the swaps and the live volume. Each sample is `(over?) => T`: a new object on every call,
// with a shallow override. A test that needs a case the sample does not have builds it from the sample.
//
// Not for `app/`, and not the fixtures of the e2e suite (scripts/ makes those). The types are api-types.ts's, so that a sample that stopped being what the reference
// promises, or a type that did, fails `pnpm typecheck`.

import { encodeAccountID } from "ripple-address-codec";

import type {
  AmmBid,
  AmmGovernanceRow,
  AmmLiquidityEvent,
  AmmPool,
  AmmPoolDay,
  AmmSwap,
  AmmVolumeRow,
  AmmVote,
  Page,
} from "../../app/server/api-types";

/** The pool of the samples, the account of a liquidity provider, the issuer of its USD, the holder of the auction slot, and another account. All valid classic addresses. */
export const AMM_POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
export const AMM_ACCOUNT = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
export const AMM_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
export const AMM_HOLDER = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
export const AMM_OTHER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
export const AMM_TX_HASH = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
/** A marker, as the API writes one: base64url. */
export const AMM_MARKER = "WzEwNzY3MDM2MCw1XQ";
/** The currency of an LP token: 40 hex digits. */
export const AMM_LP_CURRENCY = `03${"AB".repeat(19)}`;

/**
 * The `n`th of a series of valid classic addresses that no sample uses: a pool of a test's own, for the tests of a cache that outlives a test (a test that takes its own
 * number never reads another's entry). The same `n` is the same address.
 */
export function ammPoolAccount(n: number): string {
  const bytes = new Uint8Array(20);
  bytes[0] = 0x5a;
  bytes[18] = Math.floor(n / 256) % 256;
  bytes[19] = n % 256;
  return encodeAccountID(bytes);
}

/** A pool: USD (of `AMM_ISSUER`) against XRP, the creation ingested, the auction slot held. */
export const ammPoolSample = (over: Partial<AmmPool> = {}): AmmPool => ({
  amm_account: AMM_POOL,
  base_currency: "USD",
  base_issuer: AMM_ISSUER,
  counter_currency: "XRP",
  reserve_base: "1250.5",
  reserve_counter: "2500",
  lp_supply: "1767.7669",
  lp_currency: AMM_LP_CURRENCY,
  trading_fee: 500,
  auction_slot: { holder: AMM_HOLDER, price: "12.5", discounted_fee: 50, expiration: "2026-10-18T09:00:00Z" },
  value_native: "5000",
  created_ledger: 107612573,
  created_by: AMM_ACCOUNT,
  last_ledger: 107717584,
  deleted: false,
  ...over,
});

/** `GET /v2/amm/pools`: the sample pool and a marker. */
export const ammPoolsSample = (over: Partial<Page<"pools", AmmPool>> = {}): Page<"pools", AmmPool> => ({
  result: "success",
  count: 1,
  marker: AMM_MARKER,
  pools: [ammPoolSample()],
  ...over,
});

/** A day with activity: 120 swaps, two deposits, a withdrawal, both fee estimates. */
export const ammDaySample = (over: Partial<AmmPoolDay> = {}): AmmPoolDay => ({
  amm_account: AMM_POOL,
  date: "2026-10-16T00:00:00Z",
  base_currency: "USD",
  base_issuer: AMM_ISSUER,
  counter_currency: "XRP",
  swap_count: 120,
  volume_base: "340.5",
  volume_counter: "680.9",
  fees_base_est: "0.85",
  fees_counter_est: "1.7",
  deposit_count: 2,
  withdraw_count: 1,
  liquidity_in_base: "10",
  liquidity_in_counter: "20",
  liquidity_out_base: "5",
  liquidity_out_counter: "10",
  reserve_base: "1250.5",
  reserve_counter: "2500",
  lp_supply: "1767.7669",
  trading_fee: 500,
  value_native: "5000",
  ...over,
});

/** `GET /v2/amm/pools/{pool}/history?interval=day`: the sample day and a marker. */
export const ammDaysSample = (over: Partial<Page<"days", AmmPoolDay>> = {}): Page<"days", AmmPoolDay> => ({
  result: "success",
  count: 1,
  marker: AMM_MARKER,
  days: [ammDaySample()],
  ...over,
});

/** A swap against the sample pool, in the pool's own pair (USD, XRP), with `amm_account` last. */
export const ammSwapSample = (over: Partial<AmmSwap> = {}): AmmSwap => ({
  base_amount: "50",
  counter_amount: "122.5",
  node_index: 9,
  rate: "2.45",
  tx_index: 12,
  buyer: AMM_ACCOUNT,
  executed_time: "2026-10-17T12:00:03Z",
  ledger_index: 107695660,
  offer_sequence: 0,
  provider: AMM_POOL,
  seller: AMM_POOL,
  taker: AMM_ACCOUNT,
  tx_hash: AMM_TX_HASH,
  tx_type: "Payment",
  base_currency: "USD",
  base_issuer: AMM_ISSUER,
  counter_currency: "XRP",
  amm_account: AMM_POOL,
  ...over,
});

/** `GET /v2/amm/pools/{pool}/swaps`: two swaps and a marker. */
export const ammSwapsSample = (over: Partial<Page<"exchanges", AmmSwap>> = {}): Page<"exchanges", AmmSwap> => ({
  result: "success",
  count: 2,
  marker: AMM_MARKER,
  exchanges: [ammSwapSample(), ammSwapSample({ node_index: 3, tx_type: "OfferCreate" })],
  ...over,
});

/** A deposit of both assets. */
export const ammLiquiditySample = (over: Partial<AmmLiquidityEvent> = {}): AmmLiquidityEvent => ({
  amm_account: AMM_POOL,
  ledger_index: 107703707,
  tx_index: 12,
  tx_hash: AMM_TX_HASH,
  executed_time: "2026-10-17T10:24:11Z",
  account: AMM_ACCOUNT,
  initiator: AMM_ACCOUNT,
  event: "deposit",
  mode: "two_asset",
  base_amount: "10",
  counter_amount: "20",
  lp_tokens: "14.1421356",
  ...over,
});

/** `GET /v2/amm/pools/{pool}/liquidity`: the sample deposit and a marker. */
export const ammLiquidityPageSample = (over: Partial<Page<"liquidity", AmmLiquidityEvent>> = {}): Page<"liquidity", AmmLiquidityEvent> => ({
  result: "success",
  count: 1,
  marker: AMM_MARKER,
  liquidity: [ammLiquiditySample()],
  ...over,
});

/** A vote for a fee of 300; the fee after it is 450. */
export const ammVoteSample = (over: Partial<AmmVote> = {}): AmmVote => ({
  amm_account: AMM_POOL,
  ledger_index: 107644916,
  tx_index: 7,
  tx_hash: AMM_TX_HASH,
  executed_time: "2026-10-16T08:00:00Z",
  type: "vote",
  account: AMM_ACCOUNT,
  fee_voted: 300,
  trading_fee_after: 450,
  ...over,
});

/** A bid for the auction slot, the slot after it with one authorized account. */
export const ammBidSample = (over: Partial<AmmBid> = {}): AmmBid => ({
  amm_account: AMM_POOL,
  ledger_index: 107650001,
  tx_index: 3,
  tx_hash: AMM_TX_HASH,
  executed_time: "2026-10-16T09:00:00Z",
  type: "bid",
  account: AMM_ACCOUNT,
  bid_min: "1",
  bid_max: "5",
  price_paid: "2.5",
  auction_slot: { holder: AMM_HOLDER, discounted_fee: 50, expiration: "2026-10-17T09:00:00Z", auth_accounts: [AMM_OTHER] },
  ...over,
});

/** `GET /v2/amm/pools/{pool}/governance`: a vote, then a bid, and a marker. */
export const ammGovernanceSample = (over: Partial<Page<"governance", AmmGovernanceRow>> = {}): Page<"governance", AmmGovernanceRow> => ({
  result: "success",
  count: 2,
  marker: AMM_MARKER,
  governance: [ammVoteSample(), ammBidSample()],
  ...over,
});

/** `GET /v2/network/amm_volume?live=day`: the one row of a rolling day, one component for the sample pool. */
export const ammLiveVolumeSample = (over: Partial<Page<"rows", AmmVolumeRow>> = {}): Page<"rows", AmmVolumeRow> => ({
  result: "success",
  count: 1,
  rows: [
    {
      components: [
        {
          amm_account: AMM_POOL,
          base: { currency: "USD", issuer: AMM_ISSUER },
          counter: { currency: "XRP" },
          count: 31,
          amount: "1500.25",
          rate: "0.5",
          converted_amount: "3000.5",
        },
      ],
      count: 31,
      exchange: { currency: "XRP" },
      total: "3000.5",
      exchange_rate: "1.0000000",
      start_time: "2026-10-16T17:01:00Z",
      end_time: "2026-10-17T17:01:00Z",
    },
  ],
  ...over,
});
