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
  /** Validated ledgers and transactions, list pages reached with a marker, their images. */
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
 * The cache the Worker keeps its data API and node answers in, so that pages share them (a ledger header
 * is read by the home page and by the ledger page). `load` runs on a miss; what it returns is stored under
 * `key` for the class's edge TTL, or for `ttlOverride` seconds. A `load` that throws stores nothing: an
 * error is never kept. Implemented in `edge-cache.ts`.
 */
export interface SubrequestCache {
  json<T>(key: string, cls: CacheClass, load: () => Promise<T>, ttlOverride?: number): Promise<T>;
}
