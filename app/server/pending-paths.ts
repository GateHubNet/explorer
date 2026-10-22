// Routes the data API client calls that api/openapi.yaml does not have yet, so that `PATHS` in data-api.ts (checked against the generated
// openapi.d.ts at compile time) cannot hold them. Each is in a branch of data-api-new that has not been merged and synced. No imports: scripts
// and the Node tests read it too.
//
// test/unit/pending-paths.test.ts fails once `pnpm api:sync` brings a path in, and says to move that entry into `PATHS`. Later sub-projects add theirs here.
//
// Empty since the sync with data-api-new `main` 9dbbd8a (D1, D2, the AMM data and D2b merged): the routes of D1, D2 and the AMM data that waited here
// (`ammVolume`, `networkMarkets`, the four `analytics*`, D1's six and the seven `ammPool*`) are in `PATHS`.

export const PENDING_PATHS = {} as const satisfies Record<string, string>;
