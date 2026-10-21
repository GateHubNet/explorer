// Routes the data API client calls that api/openapi.yaml does not have yet, so that `PATHS` in data-api.ts (checked against the generated
// openapi.d.ts at compile time) cannot hold them. Each is in a branch of data-api-new that has not been merged and synced. No imports: scripts
// and the Node tests read it too.
//
// test/unit/pending-paths.test.ts fails once `pnpm api:sync` brings a path in, and says to move that entry into `PATHS`. Later sub-projects add theirs here.

export const PENDING_PATHS = {
  /** The volume of the swaps against AMM pools (`feat/amm-data`). The network page asks for it only while `AMM_DATA` is on. */
  ammVolume: "/v2/network/amm_volume",
  /**
   * The trade statistics of every pair that traded in a live period, in one call: the markets page's table (data-api-new `feat/explorer-data`, D2, pinned at
   * `7d495ab`). Without D2 the API answers `Cannot GET`, which the client reads as an outage (`throwUnlessOk`), never as a missing market.
   */
  networkMarkets: "/v2/network/markets",
  /**
   * The four analytics routes of an account (D2, pinned at `7d495ab`), which the account page's Analytics tab asks for: the balances of its lines per bucket, what its
   * balance changes came to by type, its counterparties and the pairs it traded. Without D2 each answers `Cannot GET`, which the client reads as an outage, so the
   * tab is off (`ACCOUNT_ANALYTICS`) where D2 is not live. (`stats/{family}` of an account is in `openapi.yaml` already, and is in `PATHS`.)
   */
  analyticsBalances: "/v2/accounts/{address}/analytics/balances",
  analyticsBalanceChanges: "/v2/accounts/{address}/analytics/balance_changes",
  analyticsCounterparties: "/v2/accounts/{address}/analytics/counterparties",
  analyticsExchanges: "/v2/accounts/{address}/analytics/exchanges",
  /**
   * D1's six routes, validators and amendments (data-api-new `feat/explorer-data`, pinned at `7d495ab`; the path parameters are named as its `openapi.yaml`
   * names them, `key` and `name`). Without D1 the API answers `Cannot GET`, which the client reads as an outage (`throwUnlessOk`), never as a missing validator
   * or amendment: those answer `Validator not found` and `amendment not found`.
   */
  validatorsSummary: "/v2/network/validators/summary",
  validators: "/v2/network/validators",
  validator: "/v2/network/validators/{key}",
  validatorValidations: "/v2/network/validators/{key}/validations",
  amendments: "/v2/network/amendments",
  amendment: "/v2/network/amendments/{name}",
  /**
   * The AMM pool routes (data-api-new `feat/amm-data`, pinned at `c3e2302`, the spellings of its `docs/openapi.yaml`: the pool is `{pool}`, the pair `{base}/{counter}`):
   * the pools list, one pool by its account, one by its pair (a redirect to the pool), and a pool's history, swaps, liquidity events and governance. The AMM pages
   * (E5) ask for them only while `AMM_PAGES` is on. Without `feat/amm-data` the API answers `Cannot GET`, which the client reads as an outage (`throwUnlessOk`),
   * never as a missing pool: a pool that is not there answers `pool not found`.
   */
  ammPools: "/v2/amm/pools",
  ammPool: "/v2/amm/pools/{pool}",
  ammPoolByPair: "/v2/amm/pools/{base}/{counter}",
  ammPoolHistory: "/v2/amm/pools/{pool}/history",
  ammPoolSwaps: "/v2/amm/pools/{pool}/swaps",
  ammPoolLiquidity: "/v2/amm/pools/{pool}/liquidity",
  ammPoolGovernance: "/v2/amm/pools/{pool}/governance",
} as const;
