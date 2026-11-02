// Small, valid answers of D6's routes (the issued tokens: the list, one token, its holders and its transfers) for the tests of the client (test/worker/data-api.spec.ts) and of its shape
// checks (app/server/token-shape.test.ts). XRPL values, in the shapes of the section "Tokens" of data-api's docs/api-reference.md (`feat/explorer-data-2` at
// 2fb4183721af6df58dd345f4a6ef90a293ae70b0), whose own examples are the model, with addresses that exist. Each sample is `(over?) => T`: a new object on every call, with a shallow override.
// A test that needs a case the sample does not have builds it from the sample.
//
// Not for `app/`, and not the fixtures of the e2e suite (scripts/ makes those). The types are api-types.ts's, so that a sample that stopped being what the reference promises, or a type that
// did, fails `pnpm typecheck`. An answer sample has `result: "success"` before `coverage`, as the API writes it.

import type {
  Coverage,
  IssuedTokenRow,
  TokenAnswer,
  TokenDetail,
  TokenHolder,
  TokenHoldersResponse,
  TokenMarket,
  TokenTransfer,
  TokenTransfersResponse,
  TokensResponse,
} from "../../app/server/api-types";

/** The token of the samples: RLUSD (a 40-digit currency whose text is its code) and its issuer; the token the detail, the holders and the first row of the list are of. */
export const TOKEN_SAMPLE_CURRENCY = "524C555344000000000000000000000000000000";
export const TOKEN_SAMPLE_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
/** Another issuer of a `USD`: the second row of the list. */
export const TOKEN_SAMPLE_OTHER_ISSUER = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
/** A marker as the list writes one (the base64url of the key of its last row). */
export const TOKENS_MARKER = "WyJpc3N1ZWQiLDYwLCJyTXdqWWVkamM3cXF0S1lWTGlBY2NKU21Dd2loNExuRTJxIiwiVVNEIl0";
export const HOLDERS_MARKER = "WzM4LjUsInJycnJycnJycnJycnJycnJycmNKWTJ2YU5uWCJd";
export const TRANSFERS_MARKER = "WzEwNzg3MzAyNCw1XQ";

/** What the list, the detail and the holders are of: the index starts at the first ledger of the network and holds every trust line since. */
export const tokenCoverageSample = (over: Partial<Coverage> = {}): Coverage => ({ from_ledger_index: 32570, complete: true, ...over });

/** A row of the list: RLUSD, 120 holders and a price in the day set. */
export const tokenRowSample = (over: Partial<IssuedTokenRow> = {}): IssuedTokenRow => ({
  rank: 1,
  currency: TOKEN_SAMPLE_CURRENCY,
  code: "RLUSD",
  issuer: TOKEN_SAMPLE_ISSUER,
  holders: 120,
  trust_lines: 150,
  supply: "7320",
  price: "0.40000000",
  price_change: "-20.00",
  price_time: "2026-10-29T03:48:11Z",
  native_volume: "150",
  trades: 35,
  domain: "ripple.com",
  listed: true,
  name: "Ripple USD",
  ...over,
});

/** `GET /v2/tokens?kind=issued&limit=2`: two of fifteen tokens, the second not listed and with no price (a token that has not traded against the native currency has none). */
export const tokensSample = (over: Partial<TokensResponse> = {}): TokensResponse => ({
  result: "success",
  coverage: tokenCoverageSample(),
  kind: "issued",
  ledger_index: 107900000,
  close_time: "2026-10-29T03:50:41Z",
  totals: { tokens: 15, tokens_with_10_holders: 9, holders: 4321, native_volume: "243.5" },
  total: 15,
  count: 2,
  marker: TOKENS_MARKER,
  tokens: [
    tokenRowSample(),
    {
      rank: 2,
      currency: "USD",
      code: "USD",
      issuer: TOKEN_SAMPLE_OTHER_ISSUER,
      holders: 60,
      trust_lines: 61,
      supply: "1860",
      native_volume: "0",
      trades: 0,
      listed: false,
    },
  ],
  ...over,
});

/** A pair of the token's markets: the token is the base. */
export const tokenMarketSample = (over: Partial<TokenMarket> = {}): TokenMarket => ({
  counter_currency: "XRP",
  count: 13,
  volume: "130",
  counter_volume: "65",
  native_volume: "65",
  last: "0.40000000",
  change: "-20.00",
  last_time: "2026-10-29T03:48:11Z",
  amm_pool: false,
  ...over,
});

/** The token of `GET /v2/tokens/{token}`: RLUSD with its toml, its issuer's settings and two markets (the second against an issued token, in which the token is cheap). */
export const tokenDetailSample = (over: Partial<TokenDetail> = {}): TokenDetail => ({
  currency: TOKEN_SAMPLE_CURRENCY,
  code: "RLUSD",
  issuer: TOKEN_SAMPLE_ISSUER,
  holders: 120,
  trust_lines: 150,
  supply: "7320",
  price: "0.40000000",
  price_change: "-20.00",
  price_time: "2026-10-29T03:48:11Z",
  native_volume: "150",
  trades: 35,
  domain: "ripple.com",
  toml_url: "https://ripple.com/.well-known/xrp-ledger.toml",
  listed: true,
  toml: { name: "Ripple USD", desc: "A US dollar stablecoin", display_decimals: 2, asset_class: "Fiat-backed stablecoin" },
  issuer_settings: { transfer_fee: "0.2", global_freeze: false, no_freeze: true, allow_trust_line_clawback: true, require_auth: false, default_ripple: true },
  markets: [
    tokenMarketSample(),
    tokenMarketSample({
      counter_currency: "USD",
      counter_issuer: TOKEN_SAMPLE_OTHER_ISSUER,
      count: 12,
      volume: "120",
      counter_volume: "240",
      native_volume: "60",
      last: "2.0000000",
      change: "0.00",
      last_time: "2026-10-29T02:11:00Z",
    }),
  ],
  last_ledger: 107899990,
  ...over,
});

/** `GET /v2/tokens/{token}`: the answer for `TOKEN_SAMPLE_CURRENCY` and `TOKEN_SAMPLE_ISSUER`. */
export const tokenSample = (over: Partial<TokenAnswer> = {}): TokenAnswer => ({
  result: "success",
  coverage: tokenCoverageSample(),
  ledger_index: 107900000,
  close_time: "2026-10-29T03:50:41Z",
  token: tokenDetailSample(),
  ...over,
});

/** A holder of RLUSD: of 7320 in all, `share` over it. */
export const tokenHolderSample = (over: Partial<TokenHolder> = {}): TokenHolder => ({
  rank: 1,
  holder: "rrrrrrrrrrrrrrrrrrcJYjXAZjD",
  balance: "40.5",
  share: "0.005533",
  limit: "1000000",
  frozen: false,
  authorized: false,
  ...over,
});

/** `GET /v2/tokens/{token}/holders?limit=3`: the three largest of the 120 holders, the first of them frozen. */
export const holdersSample = (over: Partial<TokenHoldersResponse> = {}): TokenHoldersResponse => ({
  result: "success",
  coverage: tokenCoverageSample(),
  ledger_index: 107900000,
  close_time: "2026-10-29T03:50:41Z",
  supply: "7320",
  count: 3,
  marker: HOLDERS_MARKER,
  holders: [
    tokenHolderSample({ frozen: true }),
    tokenHolderSample({ rank: 2, holder: "rrrrrrrrrrrrrrrrrrcJYdToyGA", balance: "39.5", share: "0.005396" }),
    tokenHolderSample({ rank: 3, holder: "rrrrrrrrrrrrrrrrrrcJY2vaNnX", balance: "38.5", share: "0.005260", authorized: true }),
  ],
  ...over,
});

/** A payment that delivered the token, with a source tag. */
export const tokenTransferSample = (over: Partial<TokenTransfer> = {}): TokenTransfer => ({
  hash: "3EBBB8672ADA7B5EADBE3878740346DD60B667D4919E1084D2E140238F0D2044",
  ledger_index: 107873024,
  executed_time: "2026-10-24T14:21:42Z",
  source: "rfaF3eu2m192LkHKdxRfzd68oEC1paa57",
  destination: "rMPwy3Ntx56Nyc2fKGNm7VRWdmpHSB92Z7",
  amount: "0.002",
  source_tag: 804681468,
  ...over,
});

/** `GET /v2/tokens/{token}/transfers?descending=true&limit=2`: two transfers, newest first; the coverage is the payments' (an index that does not start at the first ledger). */
export const transfersSample = (over: Partial<TokenTransfersResponse> = {}): TokenTransfersResponse => ({
  result: "success",
  coverage: { from_ledger_index: 11999941, complete: false },
  count: 2,
  marker: TRANSFERS_MARKER,
  transfers: [
    tokenTransferSample(),
    {
      hash: "2DD69A5FB706C325BEB11EF19B177EFEFE0597823E4474996BB3C35FE38715E3",
      ledger_index: 107872476,
      executed_time: "2026-10-24T13:45:51Z",
      source: "rajCZLPm7AnGJrQRwiuJHN1xZw5KLAvQTe",
      destination: "raJmzfum8TF4eR4cBkSiMAmKJHwAQKNZNT",
      amount: "0.2121364558499999",
    },
  ],
  ...over,
});
