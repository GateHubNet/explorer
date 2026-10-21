// How long each kind of response may be reused, at the edge and in the browser (spec 4). Worker-only code.

export type CacheClass = "immutable" | "live-home" | "live" | "minute" | "slow" | "short";

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
  /**
   * The home page, the network page, the market pair page, and their `.data` URLs. A ledger closes every 3-4 s and an open page follows the
   * chain (see `use-live-refresh.ts`): 1 s fresh, then 2 s during which the stored copy is served while one render refreshes it, so a reload never
   * shows a copy much older than one ledger. At the owner's request; spec 4 had 3 s + 30 s. (A copy older than 3 s is not served: the visitor
   * waits for a render. A failing render is still replaced by the stored copy, of any age.) The home page's calls are kept
   * `HOME_CALL_TTL_SECONDS`, below (and so are the pair page's anchor, trades and book), and the network page's calls over a period
   * `PERIOD_CALL_TTL_SECONDS`.
   */
  "live-home": { edgeTtl: 1, swr: 2, browser: { html: REVALIDATE, image: REVALIDATE } },
  /** The newest ledger, an account's live state, the first page of a list. */
  live: { edgeTtl: 5, swr: 30, browser: { html: REVALIDATE, image: REVALIDATE } },
  /**
   * What changes every minute and need not be fresher (markets spec 2.5): the markets page and its `.data` URL, and the calls of the data API that the
   * pages of E3 to E6 keep 60 s. The data API rewrites the markets table's `day` set every minute and its `7day` and `30day` sets every five minutes,
   * and says `Cache-Control: private, max-age=60`; `live` (5 s) would render the page twelve times for every change of a set, `slow` (an hour) would hide
   * twelve. 60 s fresh, then 30 s during which the stored copy is served while one render refreshes it. A subrequest of this class is kept 60 s (its
   * edge TTL), with no TTL constant of its own.
   */
  minute: { edgeTtl: 60, swr: 30, browser: { html: REVALIDATE, image: REVALIDATE } },
  /** An account's creation info, account images. */
  slow: { edgeTtl: 3600, swr: 0, browser: { html: "max-age=300", image: "max-age=300" } },
  /** Search pages, a 404 for a well-formed id. */
  short: { edgeTtl: 30, swr: 0, browser: { html: "max-age=0", image: "max-age=0" } },
};

/**
 * How long the home page's three calls to the data API (`lastValidated`, `fees` and the first page of `transactions`) are kept in the subrequest
 * cache: a little longer than the page's 1 s at the edge, so that a refresh at the edge finds them warm, and shorter than a ledger. The
 * worst case for what the page shows is then the edge's 1 s fresh and 2 s stale, plus these 2 s the data was kept: about 5 s, one ledger and a
 * little. The home loader asks for it (`{ ttl }` on those calls); every other caller keeps the class's 5 s and its own cache entry.
 */
export const HOME_CALL_TTL_SECONDS = 2;

/**
 * How long the network page keeps the calls it makes over a period (`stats`, `fees` by day and the three volumes: class `slow`, which would
 * keep them an hour) in the subrequest cache. Their keys change once a day, when the index day does. The running bucket moves on within the day,
 * and the API's aggregator can still finalise the newest closed day in the first hour or two after midnight UTC: 5 minutes bound how late either
 * shows. The network loader asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }` on them, and so has cache entries of its own (the key says `[kept 300 s]`).
 */
export const PERIOD_CALL_TTL_SECONDS = 300;

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
 * The failure hold (spec 1.7): how long a polled call's failure is remembered, in seconds. A `rate_limited` answer is held for its `Retry-After`
 * instead, at most `FAILURE_HOLD_MAX_SECONDS` and at least `FAILURE_HOLD_SECONDS`. The table keeps at most `FAILURE_HOLD_KEYS` keys, the oldest going first.
 */
export const FAILURE_HOLD_SECONDS = 5;
export const FAILURE_HOLD_MAX_SECONDS = 30;
export const FAILURE_HOLD_KEYS = 256;

/** What a call may ask of the subrequest cache beyond its class and TTL. */
export interface SubrequestOptions {
  /**
   * Hold this call's failure (spec 1.7): when `load` throws an `UpstreamError` of kind `server`, `timeout`, `network` or `rate_limited`, the error is
   * remembered in memory, and for `FAILURE_HOLD_SECONDS` (a 429: its `Retry-After`, from `FAILURE_HOLD_SECONDS` to `FAILURE_HOLD_MAX_SECONDS`) a call for the same key with this
   * option throws it again without calling `load`. A page that polls (an open tab asks again by itself) asks for it on every upstream call it makes,
   * so that a failing upstream is not asked by every beat of every tab. When the hold is over, the first call is a probe: it runs `load`, and until
   * it has settled (or a hold's length has passed) the other calls still get the held error, so that an upstream that takes seconds to fail is asked
   * once in a hold cycle, not by every call in those seconds. An answer, or a failure that is not held, ends the hold. It is not part of the key: a
   * call that does not ask neither reads nor makes a hold. Never stored in the Cache API; never for `not_found` or `bad_request`.
   */
  holdFailure?: boolean;
  /**
   * Share the load with the same load in flight (E4 spec 2.7): while one request of this Worker instance is loading a key on a miss, a call for that
   * key with this option waits for that load and is given its answer, as a copy of its own, or its error (the same object), and calls no `load`. It is
   * for a slow, heavy call that a page of many visitors would otherwise make once for each of them. The flight is per instance and in memory, by build ID
   * and key (so a key kept `[kept N s]` is its own), covers the load and the write only, and is removed when it settles. A load that has not settled in
   * 30 s is not joined any more (it is never going to, and must not close its key for good): the next call starts a flight of its own.
   *
   * The order of a call is: the Cache API (a stored answer is the answer, whatever is held or in flight), then the held failure if `holdFailure` is set
   * (thrown without joining a flight or loading, so that the probe of a hold is still one call), then the flight of the key, else one this call starts.
   * It applies to a call that is not kept (a TTL of zero) too, which writes nothing. The answer travels as JSON text and each caller parses its own, so
   * a value that JSON cannot hold (or `undefined`) is an error for every caller of the flight. The call that starts a flight is the one that records its
   * failure for the hold, so the calls of one key should all ask for `holdFailure`, or none.
   */
  shareInFlight?: boolean;
}

/**
 * The cache the Worker keeps its data API and node answers in, so that pages share them (a ledger header
 * is read by the home page and by the ledger page). `load` runs on a miss; what it returns is stored under
 * `key` for the class's edge TTL, or for `ttlOverride` seconds. A `load` that throws stores nothing: an
 * error is never kept (`opts.holdFailure` remembers it for a few seconds, in memory). Implemented in `edge-cache.ts`.
 */
export interface SubrequestCache {
  json<T>(key: string, cls: CacheClass, load: () => Promise<T>, ttlOverride?: number, opts?: SubrequestOptions): Promise<T>;
}
