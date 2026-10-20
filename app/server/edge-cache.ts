// The Worker's two caches (spec 4, 5, 10): the edge cache in front of every page, and the subrequest cache the
// data API and node clients keep their answers in. Worker-only code, apart from `cached` and `forwardCacheClass`,
// which routes import and which pull nothing server-side into the browser bundle (`loader` and `headers` are
// removed from it).
//
// How a page gets into the edge cache. A loader answers with `cached(payload, class)`, which sets two internal
// headers. The route's `headers` export, `forwardCacheClass`, copies them from the loader's headers onto the
// response React Router builds; that is the same function for a document and for the `.data` URL a client-side
// navigation fetches, so both carry the class. `withEdgeCache` reads them, stores the response under its URL, and
// takes them off before the visitor sees it. A loader that answers with a part of the page missing marks the request as
// degraded (`DegradedMark`, below), and then nothing is stored.

import { data } from "react-router";
import type { HeadersFunction } from "react-router";

import {
  CACHE_CLASSES,
  FAILURE_HOLD_KEYS,
  FAILURE_HOLD_MAX_SECONDS,
  FAILURE_HOLD_SECONDS,
  type CacheClass,
  type SubrequestCache,
  type SubrequestOptions,
} from "./cache-class";
import { cacheGeneration, type Env } from "./env";
import { logProblem } from "./logging";
import { UpstreamError, type UpstreamErrorKind } from "./upstream";

// ---------------------------------------------------------------------------------------------------------------
// Loaders and routes

/** Set by `cached`, read by the entry. The class of the response, and optionally how long the edge keeps it fresh. */
const CLASS_HEADER = "X-Cache-Class";
const TTL_HEADER = "X-Cache-Ttl";

function isCacheClass(value: unknown): value is CacheClass {
  return typeof value === "string" && Object.hasOwn(CACHE_CLASSES, value);
}

/** The internal headers that name a response's cache class, and its TTL in seconds when it is not the class's own. */
export function cacheClassHeaders(cls: CacheClass, ttl?: number): Headers {
  if (!isCacheClass(cls)) throw new RangeError(`${String(cls)} is not a cache class`);
  if (ttl !== undefined && !(Number.isInteger(ttl) && ttl > 0)) {
    throw new RangeError(`a cache TTL is a whole number of seconds above zero, not ${ttl}`);
  }
  const headers = new Headers({ [CLASS_HEADER]: cls });
  if (ttl !== undefined) headers.set(TTL_HEADER, String(ttl));
  return headers;
}

export interface CachedOptions {
  /** Seconds the edge cache keeps the copy fresh, instead of the class's own TTL. */
  ttl?: number;
  status?: number;
  headers?: HeadersInit;
}

/**
 * A loader's answer, with the cache class of the page it is for. Wraps React Router's `data()`: return it, or throw
 * it for a 404 (`throw cached(message, "short", { status: 404 })`). The deepest route that names a class decides the
 * class of the page. Every route whose loader uses this (or a helper that throws it, such as `upstreamFailure`), and
 * the root route (its error boundary shows a thrown 404), needs `export const headers = forwardCacheClass`: React
 * Router gives a route without a `headers` export its parent's headers, so the class it named is dropped and the
 * page is stored under its parent's class, or not at all if no parent names one. (test/unit/route-headers.test.ts
 * checks every file under app/routes.)
 */
export function cached<T>(payload: T, cls: CacheClass, opts: CachedOptions = {}) {
  const headers = new Headers(opts.headers);
  // The class and the TTL are the loader's to decide, not those of headers it was handed.
  headers.delete(CLASS_HEADER);
  headers.delete(TTL_HEADER);
  for (const [name, value] of cacheClassHeaders(cls, opts.ttl)) headers.set(name, value);
  return data(payload, { status: opts.status, headers });
}

/**
 * A route's `headers` export: puts the cache class (and TTL) its loader named on the document, and on the `.data`
 * response of a client-side navigation, which React Router builds from the same function. The class of the error
 * a boundary shows (a thrown 404) wins over the route's own, which wins over its parent's.
 */
export const forwardCacheClass: HeadersFunction = ({ loaderHeaders, parentHeaders, errorHeaders }) => {
  const headers = new Headers(parentHeaders);
  const own = [errorHeaders, loaderHeaders].find((candidate) => candidate?.has(CLASS_HEADER));
  if (own) {
    headers.set(CLASS_HEADER, own.get(CLASS_HEADER)!);
    const ttl = own.get(TTL_HEADER);
    if (ttl === null) headers.delete(TTL_HEADER);
    else headers.set(TTL_HEADER, ttl);
  }
  return headers;
};

// ---------------------------------------------------------------------------------------------------------------
// A degraded answer

/**
 * What a loader tells the edge cache about the request it is answering: that the page is served with a part missing (the
 * node is down, a deferred list could not be loaded), so that it must not be stored, whatever class it names. One per render,
 * made by the entry (`withEdgeCache` hands it to `render`) and reached from loaders through the load context
 * (`markDegraded(context, reason)` in env.ts).
 *
 * A loader may set it late: a section that streams after the header settles before the stream ends, and a page's copy is made
 * only when its body is complete (see `store`), so a mark set at any point of the stream counts.
 */
export interface DegradedMark {
  /** Whether the request has been marked. Read it once the body is complete. */
  readonly degraded: boolean;
  /** Why, the first time it was marked, for the log line. */
  readonly reason: string | undefined;
  /** Says that this answer is degraded. Marking twice keeps the first reason. */
  mark(reason: string): void;
}

export function createDegradedMark(): DegradedMark {
  let reason: string | undefined;
  let degraded = false;
  return {
    get degraded() {
      return degraded;
    },
    get reason() {
      return reason;
    },
    mark(why) {
      if (!degraded) reason = why;
      degraded = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The subrequest cache

/**
 * A key the Cache API accepts for any string: hashed, because a node request's key holds its JSON-RPC body and can
 * be long. The host is fixed and never resolved.
 * (Assumption to confirm on staging: the Cache API takes a key whose host is not the zone's own.)
 */
async function subrequestKey(key: string, buildId: string): Promise<Request> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(`https://subrequest-cache.invalid/${encodeURIComponent(buildId)}/${hex}`);
}

/** The failures a call that asks for the hold remembers. A thing that is not there, or a request that was refused, is the answer and is not held. */
const HELD_KINDS: ReadonlySet<UpstreamErrorKind> = new Set(["server", "timeout", "network", "rate_limited"]);

/**
 * The failure hold (spec 1.7): the errors of the calls that asked for it, by the subrequest key the client gave (so a key kept `[kept N s]` is its
 * own), each until a time. Per Worker instance: it is a module's variable, shared by every request this instance serves, and it never goes into
 * the Cache API. A `Map` keeps the order of insertion, which is the order of eviction.
 */
const heldFailures = new Map<string, { error: UpstreamError; until: number }>();

/**
 * Seconds a failure is held: `FAILURE_HOLD_SECONDS`, or for a 429 that gave a `Retry-After` that many seconds, at most `FAILURE_HOLD_MAX_SECONDS`
 * and never less than `FAILURE_HOLD_SECONDS`: a rate-limited upstream is held at least as long as any other failure.
 */
function holdSeconds(error: UpstreamError): number {
  return error.kind === "rate_limited" && error.retryAfter !== undefined
    ? Math.max(FAILURE_HOLD_SECONDS, Math.min(error.retryAfter, FAILURE_HOLD_MAX_SECONDS))
    : FAILURE_HOLD_SECONDS;
}

/**
 * Throws the key's held failure, if there is one. Once a hold is over, the first call that finds it is the probe: it goes on to run `load`, and until
 * it has settled (or for the hold's length again, if it does not) the entry stays, so that every other call keeps getting the held error and the
 * upstream is asked by one call, not by every render that starts while the probe waits. That matters for an upstream that times out: its probe takes
 * the whole deadline (5 s), and a hold that simply lapsed would leave every render of those 5 s calling it.
 */
function throwIfHeld(key: string): void {
  const held = heldFailures.get(key);
  if (!held) return;
  if (held.until > Date.now()) throw held.error;
  held.until = Date.now() + holdSeconds(held.error) * 1000;
}

/**
 * Runs `load` and remembers its failure. What the probe finds decides the entry: an answer deletes it; a held failure sets it again, for a full hold
 * from now; any other outcome (a thing that is not there, a request that was refused, an error that is not an upstream's) deletes it. The entry is
 * all that is shared: a call never gets another request's response or stream, which a Worker may not read.
 */
async function recordFailures<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const value = await load();
    heldFailures.delete(key);
    return value;
  } catch (error) {
    if (error instanceof UpstreamError && HELD_KINDS.has(error.kind)) {
      // Delete before setting, so that a key that fails again is the newest and not the next to go.
      heldFailures.delete(key);
      heldFailures.set(key, { error, until: Date.now() + holdSeconds(error) * 1000 });
      while (heldFailures.size > FAILURE_HOLD_KEYS) heldFailures.delete(heldFailures.keys().next().value!);
    } else {
      heldFailures.delete(key);
    }
    throw error;
  }
}

/** Runs `load` unless the key's failure is held, in which case that error is thrown again; remembers the failure of a `load` that fails. */
async function loadHoldingFailures<T>(key: string, load: () => Promise<T>): Promise<T> {
  throwIfHeld(key);
  return recordFailures(key, load);
}

/**
 * How long a flight is joined, at the most. The slowest call has a 15 s limit and a request's own work is given 30 s after its response, so a load that
 * has not settled by then is not going to: the request that made it was cancelled, say. It must not close its key for good, to every later call and to
 * the probe of a hold, as a hold's own probe must not (`throwIfHeld`): the next call starts a flight of its own.
 */
export const SHARED_LOAD_MAX_AGE_MS = 30_000;

/**
 * The loads of the calls that asked for `shareInFlight` that are running in this Worker instance, by build ID and key, each as the JSON text of
 * its answer and the time it started (spec 2.7, `SubrequestOptions`). The same mechanism as the page `flights` below: a module's variable, which
 * every request this instance serves can see, holding plain data (a string, an error) and no response or stream, which a Worker may not read across
 * requests. A flight is removed when it settles, only if it is still the one in the table (a call that found it too old has put its own in its place).
 */
const loadsInFlight = new Map<string, { answer: Promise<string>; since: number }>();

/** Hands `body` to the Cache API for `ttl` seconds, behind the answer: in `ctx.waitUntil`, and a failed write is logged. */
function storeBehind(ctx: ExecutionContext, cacheKey: Request, body: string, ttl: number): void {
  const response = new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.ceil(ttl)}` },
  });
  ctx.waitUntil(
    caches.default.put(cacheKey, response).catch((error: unknown) => logProblem("subrequest cache write failed", error)),
  );
}

/**
 * The cache the data API and node clients keep their answers in, in the Cache API of the data centre, so every
 * request there shares it. The key is the clients' own (their full upstream URL, a node's with its JSON-RPC body)
 * plus the build ID; a `load` that throws stores nothing. The value is stored behind the answer, in `ctx.waitUntil`.
 *
 * With `opts.holdFailure` a call is also held to its failures, and with `opts.shareInFlight` it shares its load with the same load in flight
 * (`SubrequestOptions`). The order is: the Cache API (a stored answer is the answer, whatever failed before or is loading now), then a failure
 * that is held, then the flight of the key if there is one, then `load`. That is the order for a call that is not kept (a TTL of zero) too.
 */
export function createSubrequestCache(ctx: ExecutionContext, buildId: string): SubrequestCache {
  /**
   * The answer of the load of `key` that is in flight, or of one this call starts. The flight is the load and the write (handed to `waitUntil`), and ends
   * with the JSON text that each caller parses for itself, so that no two callers hold the same object (as a page's flight gives each visitor a copy).
   * `cacheKey` is `undefined` for a call that is not kept.
   */
  async function loadShared<T>(key: string, cacheKey: Request | undefined, ttl: number, load: () => Promise<T>, holding: boolean): Promise<T> {
    if (holding) throwIfHeld(key);
    const flightKey = `${encodeURIComponent(buildId)}/${key}`;
    let flight = loadsInFlight.get(flightKey);
    if (!flight || Date.now() - flight.since > SHARED_LOAD_MAX_AGE_MS) {
      const answer = (async () => {
        const value = await (holding ? recordFailures(key, load) : load());
        const body = JSON.stringify(value) as string | undefined;
        if (body === undefined) throw new TypeError("a shared subrequest value is not JSON");
        if (cacheKey) storeBehind(ctx, cacheKey, body, ttl);
        return body;
      })();
      const own = { answer, since: Date.now() };
      flight = own;
      loadsInFlight.set(flightKey, own);
      const settled = () => {
        if (loadsInFlight.get(flightKey) === own) loadsInFlight.delete(flightKey);
      };
      answer.then(settled, settled);
    }
    return JSON.parse(await flight.answer) as T;
  }

  return {
    async json<T>(key: string, cls: CacheClass, load: () => Promise<T>, ttlOverride?: number, opts?: SubrequestOptions): Promise<T> {
      const ttl = ttlOverride ?? CACHE_CLASSES[cls].edgeTtl;
      const loadIt = opts?.holdFailure ? () => loadHoldingFailures(key, load) : load;
      if (!(ttl > 0)) return opts?.shareInFlight ? loadShared(key, undefined, ttl, load, !!opts.holdFailure) : loadIt();

      const cacheKey = await subrequestKey(key, buildId);
      const cache = caches.default;
      try {
        const hit = await cache.match(cacheKey);
        if (hit) return (await hit.json()) as T;
      } catch (error) {
        // Unreadable (or not JSON): load it again.
        logProblem("subrequest cache read failed", error);
      }
      if (opts?.shareInFlight) return loadShared(key, cacheKey, ttl, load, !!opts.holdFailure);

      const value = await loadIt();

      let body: string | undefined;
      try {
        body = JSON.stringify(value);
      } catch (error) {
        logProblem("subrequest value is not JSON", error);
      }
      if (body !== undefined) storeBehind(ctx, cacheKey, body, ttl);
      return value;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The edge cache

/** Written on a stored copy (the Cache API ignores `stale-while-revalidate`, so the entry decides freshness itself). */
const STORED_CLASS = "X-Edge-Class";
const STORED_TTL = "X-Edge-Ttl";
const STORED_AT = "X-Edge-Stored-At";
const INTERNAL_HEADERS = [CLASS_HEADER, TTL_HEADER, STORED_CLASS, STORED_TTL, STORED_AT];

/** A stored copy lives past its freshness so that it can stand in when a render fails. */
const KEEP_AFTER_FRESH_SECONDS = 30;
const KEEP_AT_LEAST_SECONDS = 24 * 60 * 60;

const RETRY_AFTER_LIMITED = 10;
const RETRY_AFTER_UNAVAILABLE = 30;

/** The limiter key of a request that carries no address (local development, tests). */
const UNKNOWN_VISITOR = "unknown";

/**
 * Paths that are never cached: the redirect from `/` to the visitor's last network depends on a cookie, and
 * `/_.data` is the URL a client-side navigation fetches for it.
 */
const UNCACHED_PATHS = new Set(["/", "/_.data"]);

/**
 * What `X-Cache` says. `MISS-SHARED` is a miss that another request's render answered (single flight, below): the visitor was given a
 * copy of what that render stored, and nothing was rendered for them.
 */
type CacheLabel = "HIT" | "MISS" | "MISS-SHARED" | "STALE" | "BYPASS";

/**
 * The key a page is stored under: its URL, and the cache generation (`cacheGeneration` in env.ts: the build ID and every switch's
 * value) so that a deploy, or a switch flipped by one, replaces every entry at once. The query string is part of the URL, so `.data`
 * URLs (with their `_routes`) and pages with a marker are their own entries.
 */
export function edgeCacheKey(url: string, generation: string): string {
  const key = new URL(url);
  key.hash = "";
  key.search = `${key.search ? `${key.search}&` : "?"}__build=${encodeURIComponent(generation)}`;
  return key.toString();
}

/** A copy of `headers` without the Worker's internal ones. */
function visitorHeaders(headers: Headers): Headers {
  const copy = new Headers(headers);
  for (const name of INTERNAL_HEADERS) copy.delete(name);
  return copy;
}

function browserCacheControl(cls: CacheClass, contentType: string | null): string {
  const { browser } = CACHE_CLASSES[cls];
  return contentType?.toLowerCase().startsWith("image/") ? browser.image : browser.html;
}

/** What to store a render's response as, or `undefined` when it must not be stored. */
function storableAs(response: Response): { cls: CacheClass; ttl: number } | undefined {
  const cls = response.headers.get(CLASS_HEADER);
  if (!isCacheClass(cls)) return undefined;
  // Never share a response that sets a cookie.
  if (response.headers.has("Set-Cookie")) return undefined;

  const { status } = response;
  // Errors, 429 included, are never stored. The one exception is a 404 for a well-formed id, which is `short`.
  const storable = status === 404 ? cls === "short" : status >= 200 && status < 400 && status !== 206 && status !== 304;
  if (!storable) return undefined;

  const override = Number(response.headers.get(TTL_HEADER) ?? Number.NaN);
  return { cls, ttl: Number.isFinite(override) && override > 0 ? override : CACHE_CLASSES[cls].edgeTtl };
}

/**
 * What the visitor gets for a render's response: no internal headers, the browser's `Cache-Control`, `X-Cache`. A degraded answer
 * the loader has already marked is kept by nobody (`no-store`); one that is only found out to be degraded while it streams has
 * gone out with its class's `Cache-Control`, which for the classes of the pages that stream (`live`) revalidates every time.
 */
function answerFor(
  response: Response,
  label: CacheLabel,
  stored: { cls: CacheClass } | undefined,
  degraded = false,
): Response {
  const headers = visitorHeaders(response.headers);
  if (stored) {
    headers.set("Cache-Control", browserCacheControl(stored.cls, headers.get("Content-Type")));
  } else if ((degraded || response.status >= 400 || headers.has("Set-Cookie")) && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  headers.set("X-Cache", label);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** A copy a render's response was stored as, and what the Cache API says about it. */
interface StoredCopy {
  response: Response;
  cls: CacheClass;
  /** Seconds it is served as fresh. */
  ttl: number;
  /** Milliseconds since the epoch. */
  storedAt: number;
}

async function readStored(cache: Cache, key: Request, request: Request): Promise<StoredCopy | undefined> {
  let response: Response | undefined;
  try {
    response = await cache.match(key);
  } catch (error) {
    logProblem("edge cache read failed", error, request);
    return undefined;
  }
  if (!response) return undefined;

  const cls = response.headers.get(STORED_CLASS);
  const ttl = Number(response.headers.get(STORED_TTL));
  const storedAt = Number(response.headers.get(STORED_AT));
  if (!isCacheClass(cls) || !(ttl > 0) || !Number.isFinite(storedAt)) {
    // Not something this code stored.
    await response.body?.cancel();
    return undefined;
  }
  return { response, cls, ttl, storedAt };
}

function serveStored(copy: StoredCopy, label: "HIT" | "STALE"): Response {
  const { response, cls } = copy;
  const headers = visitorHeaders(response.headers);
  headers.set("Cache-Control", browserCacheControl(cls, headers.get("Content-Type")));
  headers.set("X-Cache", label);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * A rendered answer as plain data (a buffer and pairs of strings), which a request other than the one that rendered it may be given:
 * workerd does not let one request read another's streams, but bytes cross requests freely.
 */
interface SharedAnswer {
  cls: CacheClass;
  status: number;
  statusText: string;
  /** The headers a visitor gets, the internal ones taken off. */
  headers: Array<[string, string]>;
  body: ArrayBuffer;
}

/**
 * Stores `response` (a clone: its body is read here) for `ttl` seconds of freshness, unless the render marked the request as
 * degraded. The body is read to its end first: a page that streams a section after its header is complete only when that
 * section has settled, and a section that failed marks the request on the way. (The copy is a buffer, as `cache.put` would make
 * of it.) A body that fails half way is not stored either.
 *
 * Returns what it buffered, as a `SharedAnswer`, when the answer is whole and not degraded (also when the Cache API refused to keep it):
 * the requests that waited for this render are given it (`withEdgeCache`, "single flight"). `undefined` when it must not be shared.
 */
async function store(
  cache: Cache,
  key: Request,
  response: Response,
  kind: { cls: CacheClass; ttl: number },
  request: Request,
  mark: DegradedMark,
): Promise<SharedAnswer | undefined> {
  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch (error) {
    logProblem("edge cache could not read the body to store", error, request);
    return undefined;
  }
  if (mark.degraded) {
    console.warn(
      JSON.stringify({ level: "warn", what: "degraded answer not stored", reason: mark.reason, path: new URL(request.url).pathname }),
    );
    return undefined;
  }

  const { status, statusText } = response;
  const shared: SharedAnswer = { cls: kind.cls, status, statusText, headers: [...visitorHeaders(response.headers)], body };
  const headers = visitorHeaders(response.headers);
  const keep = Math.ceil(Math.max(kind.ttl + KEEP_AFTER_FRESH_SECONDS, KEEP_AT_LEAST_SECONDS));
  headers.set("Cache-Control", `public, max-age=${keep}`);
  headers.set(STORED_CLASS, kind.cls);
  headers.set(STORED_TTL, String(kind.ttl));
  headers.set(STORED_AT, String(Date.now()));
  try {
    // A status that cannot have a body (204) must not be given an empty one.
    await cache.put(key, new Response(body.byteLength === 0 ? null : body, { status, statusText, headers }));
  } catch (error) {
    logProblem("edge cache write failed", error, request);
  }
  return shared;
}

// ---------------------------------------------------------------------------------------------------------------
// Single flight

/** How long a request waits for the render of the page it asked for, at the most, before it renders for itself. */
export const SINGLE_FLIGHT_WAIT_MS = 15_000;

type Flight = Promise<SharedAnswer | undefined>;

/**
 * The pages that are being rendered by a request of this Worker instance because they were not in the cache, by key. The next request for
 * such a page, in this instance, waits for that render instead of making its own (a herd: every open home page asks again every 4 s), and
 * is given a copy of the answer when it turns out to be one that is stored and whole. Not an answer to share (degraded, an error, not
 * storable, a render that threw or took too long): each of them renders for itself, as they did before. Per instance and in memory: another
 * instance, or a restart, starts its own.
 */
const flights = new Map<string, Flight>();

/** Registers the render of `url` that this request is about to make; the others will wait for `settle`. */
function lead(url: string) {
  let resolve!: (answer: SharedAnswer | undefined) => void;
  const promise: Flight = new Promise((done) => (resolve = done));
  flights.set(url, promise);
  let settled = false;
  let following = false;
  const settle = (answer: SharedAnswer | undefined) => {
    if (settled) return;
    settled = true;
    // (Not a newer flight that took its place when this one was given up on.)
    if (flights.get(url) === promise) flights.delete(url);
    resolve(answer);
  };
  return {
    settle,
    /** The answer is that of `stored`, which is not known until its body has been read and the Cache API has it. */
    follow(stored: Promise<SharedAnswer | undefined>) {
      following = true;
      stored.then(settle, () => settle(undefined));
    },
    /** Whatever happened, the others are not left waiting: unless an answer is on its way, there is nothing to share. */
    end() {
      if (!following) settle(undefined);
    },
  };
}

/** The answer of the render that `flight` is, or `undefined` when there is none to share or it takes more than `SINGLE_FLIGHT_WAIT_MS`. */
async function waitFor(url: string, flight: Flight): Promise<SharedAnswer | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      // A render that is this slow is not waited for by the next request either.
      if (flights.get(url) === flight) flights.delete(url);
      resolve(undefined);
    }, SINGLE_FLIGHT_WAIT_MS);
  });
  try {
    return await Promise.race([flight, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/** The visitor's answer from a render that another request made: its body (a copy of the buffer), the browser's `Cache-Control`, `X-Cache`. */
function sharedAnswer({ cls, status, statusText, headers, body }: SharedAnswer): Response {
  const answer = new Headers(headers);
  answer.set("Cache-Control", browserCacheControl(cls, answer.get("Content-Type")));
  answer.set("X-Cache", "MISS-SHARED");
  return new Response(body.byteLength === 0 ? null : body.slice(0), { status, statusText, headers: answer });
}

/** Renders at most one refresh of a stale page at a time per Worker instance, however many visitors ask for it. */
const refreshing = new Map<string, Promise<void>>();

async function withinVisitorLimit(request: Request, env: Env): Promise<boolean> {
  const key = request.headers.get("CF-Connecting-IP") || UNKNOWN_VISITOR;
  try {
    return (await env.VISITOR_LIMITER.limit({ key })).success;
  } catch (error) {
    // A limiter that is down must not take the explorer with it.
    logProblem("visitor limiter failed", error, request);
    return true;
  }
}

/** Runs `render`; a throw is logged and becomes `undefined`. */
async function attempt(render: () => Promise<Response>, request: Request): Promise<Response | undefined> {
  try {
    return await render();
  } catch (error) {
    logProblem("render failed", error, request);
    return undefined;
  }
}

// The two pages the entry answers with itself. Self-contained, with the page background and text colours of the
// design tokens (spec 8) inline; the design system replaces them with its own pages. The wait is in the page as well as in `Retry-After`:
// a client-side navigation gets one of these as the text of an ErrorResponse, with no headers, and RouteErrorScreen reads the wait from
// this meta tag.
function statusPage(status: 429 | 503, retryAfter: number, title: string, text: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="retry-after" content="${retryAfter}">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>
:root { --bg: #F5F6F8; --text: #0F1217; --muted: #4F5864; --link: #2F5BEA; }
@media (prefers-color-scheme: dark) { :root { --bg: #0B0E12; --text: #E7EBF0; --muted: #A3ACB9; --link: #8DA5F3; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 32rem; margin: 0 auto; padding: 20vh 20px 0; }
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
p { color: var(--muted); margin: 0 0 1rem; }
a { color: var(--link); }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${text}</p>
<p><a href="/">Go to the explorer home</a></p>
</main>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfter),
      "X-Robots-Tag": "noindex",
      "X-Cache": "MISS",
    },
  });
}

const tooManyRequests = () =>
  statusPage(
    429,
    RETRY_AFTER_LIMITED,
    "Too many requests",
    "You are asking for pages faster than we can serve them. Try again in a few seconds.",
  );
const unavailable = () =>
  statusPage(
    503,
    RETRY_AFTER_UNAVAILABLE,
    "Temporarily unavailable",
    "The explorer could not get this page's data just now. Try again in a minute.",
  );

/** What the entry renders: the answer for a request, given the degraded mark of this render (and the request to render, see `withEdgeCache`). */
export type Render = (mark: DegradedMark, request: Request) => Promise<Response>;

/** The same answer without a body, as a HEAD gets it: the status and the headers a GET would have, and nothing after them. */
function withoutBody(response: Response): Response {
  // A body that is not read is cancelled, so that nothing is held for it (a copy that is being stored reads its own branch).
  void response.body?.cancel().catch(() => undefined);
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Answers `request` from the edge cache, or from `render` (React Router) and stores what it answers.
 *
 * - Not cached: anything but GET and HEAD, and the root (a redirect that depends on a cookie). `X-Cache: BYPASS`.
 * - A HEAD is a GET whose answer has no body: it is answered from the stored copy of the GET, or, on a miss, by one render of the page *as
 *   a GET* (`render` is handed that GET, not the HEAD) that is stored as a GET would store it, and the body is dropped. So a HEAD costs one
 *   render at most, and the next GET (or HEAD) is a hit. Unfurlers and uptime monitors send HEADs, and so a HEAD of an image draws it once.
 * - A stored copy younger than its TTL is served (`HIT`); one past it but within the class's stale-while-revalidate
 *   window is served too (`STALE`) while one `render` refreshes it in `ctx.waitUntil`.
 * - Otherwise this is a miss: the visitor's limit is checked (60 per 10 s, over it the 429 page), `render` runs and its
 *   answer is stored if it names a class (`cached`) and is not an error. If another request of this Worker instance is already
 *   rendering the same page for the cache, this one waits for it and is given a copy of what it stored (`MISS-SHARED`, see "Single
 *   flight" above); when that answer is not one to share, it renders for itself.
 * - A `render` that throws or answers 5xx is replaced by the stored copy, of any age, if there is one (stale-if-error);
 *   failing that, a throw or a 503 becomes the 503 page.
 *
 * Every answer carries `X-Cache`, the class's `Cache-Control` for the browser and none of the internal headers.
 */
export async function withEdgeCache(request: Request, env: Env, ctx: ExecutionContext, render: Render): Promise<Response> {
  const { pathname } = new URL(request.url);
  const root = UNCACHED_PATHS.has(pathname);

  // A HEAD is the GET of the same URL without the body. `render` gets that GET: React Router would run every loader for a HEAD and
  // throw the page away, and what it made could not be stored as the page a GET is given.
  if (request.method === "HEAD" && !root) {
    return withoutBody(await withEdgeCache(new Request(request, { method: "GET" }), env, ctx, render));
  }

  if (request.method !== "GET" || root) {
    // The redirect at the root costs nothing. Any other request that skips the cache renders on the visitor's account.
    if (!root && !(await withinVisitorLimit(request, env))) return tooManyRequests();
    const response = await attempt(() => render(createDegradedMark(), request), request);
    return response ? answerFor(response, "BYPASS", undefined) : unavailable();
  }

  const cache = caches.default;
  const key = new Request(edgeCacheKey(request.url, cacheGeneration(env)));
  const copy = await readStored(cache, key, request);

  if (copy) {
    const age = Date.now() - copy.storedAt;
    const freshFor = copy.ttl * 1000;
    if (age < freshFor) return serveStored(copy, "HIT");
    if (age < freshFor + CACHE_CLASSES[copy.cls].swr * 1000) {
      refresh(cache, key, request, ctx, render);
      return serveStored(copy, "STALE");
    }
  }

  if (!(await withinVisitorLimit(request, env))) {
    await copy?.response.body?.cancel();
    return tooManyRequests();
  }

  // Single flight: a page that another request is rendering for the cache is waited for, not rendered again.
  const rendering = flights.get(key.url);
  if (rendering) {
    const shared = await waitFor(key.url, rendering);
    if (shared) {
      await copy?.response.body?.cancel();
      return sharedAnswer(shared);
    }
    // Nothing to share: this request renders for itself, as if it had come first (and takes no flight of its own: the others that waited do the same).
  }
  const flight = rendering ? undefined : lead(key.url);
  try {
    const mark = createDegradedMark();
    const response = await attempt(() => render(mark, request), request);
    if (response && response.status < 500) {
      await copy?.response.body?.cancel();
      // A loader that already knows the answer is degraded spares the copy; one that finds out while the page streams marks
      // the request later, and `store` looks again when the body is complete.
      const kind = mark.degraded ? undefined : storableAs(response);
      if (kind) {
        const stored = store(cache, key, response.clone(), kind, request, mark);
        ctx.waitUntil(stored);
        flight?.follow(stored);
      }
      return answerFor(response, "MISS", kind, mark.degraded);
    }

    // The render failed: a throw, or a 5xx.
    if (copy) {
      await response?.body?.cancel();
      return serveStored(copy, "STALE");
    }
    if (response && response.status !== 503) return answerFor(response, "MISS", undefined);
    await response?.body?.cancel();
    return unavailable();
  } finally {
    flight?.end();
  }
}

/** Starts the refresh of a stale copy, unless this Worker instance is already refreshing it. */
function refresh(cache: Cache, key: Request, request: Request, ctx: ExecutionContext, render: Render) {
  if (refreshing.has(key.url)) return;
  const task = (async () => {
    const mark = createDegradedMark();
    const response = await attempt(() => render(mark, request), request);
    const kind = response && response.status < 500 && !mark.degraded ? storableAs(response) : undefined;
    if (response && kind) await store(cache, key, response, kind, request, mark);
    else await response?.body?.cancel();
  })().finally(() => refreshing.delete(key.url));
  refreshing.set(key.url, task);
  ctx.waitUntil(task);
}
