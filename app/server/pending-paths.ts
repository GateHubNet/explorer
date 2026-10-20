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
} as const;
