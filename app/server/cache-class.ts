// How long each kind of response may be reused, at the edge and in the browser (spec 4). Worker-only code.

export type CacheClass = "immutable" | "live-home" | "live" | "slow" | "short";

export interface CacheClassSpec {
  /** Seconds the edge cache serves a stored copy as fresh. */
  edgeTtl: number;
  /** Seconds after that during which the stale copy is still served while a fresh one is fetched. */
  swr: number;
  /** The `Cache-Control` the browser gets, for a page and for an image. */
  browser: { html: string; image: string };
}

const REVALIDATE = "max-age=0, must-revalidate";

export const CACHE_CLASSES: Record<CacheClass, CacheClassSpec> = {
  /** Validated ledgers and transactions, their images. (A list page reached with a marker is `MARKER_PAGE_CLASS`, below.) */
  immutable: {
    edgeTtl: 31_536_000,
    swr: 0,
    browser: { html: "max-age=60", image: "max-age=31536000, immutable" },
  },
  /** The home page. */
  "live-home": { edgeTtl: 3, swr: 30, browser: { html: REVALIDATE, image: REVALIDATE } },
  /** The newest ledger, an account's live state, the first page of a list. */
  live: { edgeTtl: 5, swr: 30, browser: { html: REVALIDATE, image: REVALIDATE } },
  /** An account's creation info, account images. */
  slow: { edgeTtl: 3600, swr: 0, browser: { html: "max-age=300", image: "max-age=300" } },
  /** Search pages, a 404 for a well-formed id. */
  short: { edgeTtl: 30, swr: 0, browser: { html: "max-age=0", image: "max-age=0" } },
};

/**
 * The class of a list page reached with a marker, and of the account page that shows it. A DELIBERATE DEVIATION from spec 2, which has
 * these pages `immutable` ("markers are stable under new data"), and the owner is to confirm it.
 *
 * Why not `immutable`: a marker page is the history before the marker, and that is stable only at the head of the index. data-api-new
 * writes history below the frontier: its range backfill runs beside the live syncer, `--reprocess` rewrites rows after a parser change,
 * and gap repair fills holes. So a page stored for a year (and the subrequest under it, which has the same class) can keep a
 * missing oldest page, an "Older" link that is absent, or a payment or trade that has since been corrected, until a deploy changes the
 * build ID. `slow` (1 hour) bounds that.
 *
 * To go back to `immutable`: once backfill has finished and nothing rewrites history any more (or a reprocess is announced to bump the
 * build ID), change this one value. The tests that pin it (test/worker/data-api.spec.ts "after a marker", test/worker/account.spec.ts
 * "paging") and the README ("The account page") say `slow` and change with it.
 */
export const MARKER_PAGE_CLASS: CacheClass = "slow";

/**
 * The cache the Worker keeps its data API and node answers in, so that pages share them (a ledger header
 * is read by the home page and by the ledger page). `load` runs on a miss; what it returns is stored under
 * `key` for the class's edge TTL, or for `ttlOverride` seconds. A `load` that throws stores nothing: an
 * error is never kept. Implemented in `edge-cache.ts`.
 */
export interface SubrequestCache {
  json<T>(key: string, cls: CacheClass, load: () => Promise<T>, ttlOverride?: number): Promise<T>;
}
