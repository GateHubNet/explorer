// The Worker's two caches (spec 4, 5, 10): the edge cache in front of every page, and the subrequest cache the
// data API and node clients keep their answers in. Worker-only code, apart from `cached` and `forwardCacheClass`,
// which routes import and which pull nothing server-side into the browser bundle (`loader` and `headers` are
// removed from it).
//
// How a page gets into the edge cache. A loader answers with `cached(payload, class)`, which sets two internal
// headers. The route's `headers` export, `forwardCacheClass`, copies them from the loader's headers onto the
// response React Router builds; that is the same function for a document and for the `.data` URL a client-side
// navigation fetches, so both carry the class. `withEdgeCache` reads them, stores the response under its URL, and
// takes them off before the visitor sees it.

import { data } from "react-router";
import type { HeadersFunction } from "react-router";

import { CACHE_CLASSES, type CacheClass, type SubrequestCache } from "./cache-class";
import type { Env } from "./env";
import { logProblem } from "./logging";

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
 * class of the page; every route with a loader that uses this, and the root route (its error boundary shows a
 * thrown 404), needs `export const headers = forwardCacheClass`.
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

/**
 * The cache the data API and node clients keep their answers in, in the Cache API of the data centre, so every
 * request there shares it. The key is the clients' own (their full upstream URL, a node's with its JSON-RPC body)
 * plus the build ID; a `load` that throws stores nothing. The value is stored behind the answer, in `ctx.waitUntil`.
 */
export function createSubrequestCache(ctx: ExecutionContext, buildId: string): SubrequestCache {
  return {
    async json<T>(key: string, cls: CacheClass, load: () => Promise<T>, ttlOverride?: number): Promise<T> {
      const ttl = ttlOverride ?? CACHE_CLASSES[cls].edgeTtl;
      if (!(ttl > 0)) return load();

      const cacheKey = await subrequestKey(key, buildId);
      const cache = caches.default;
      try {
        const hit = await cache.match(cacheKey);
        if (hit) return (await hit.json()) as T;
      } catch (error) {
        // Unreadable (or not JSON): load it again.
        logProblem("subrequest cache read failed", error);
      }

      const value = await load();

      let body: string | undefined;
      try {
        body = JSON.stringify(value);
      } catch (error) {
        logProblem("subrequest value is not JSON", error);
      }
      if (body !== undefined) {
        const response = new Response(body, {
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.ceil(ttl)}` },
        });
        ctx.waitUntil(
          cache.put(cacheKey, response).catch((error: unknown) => logProblem("subrequest cache write failed", error)),
        );
      }
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

type CacheLabel = "HIT" | "MISS" | "STALE" | "BYPASS";

/**
 * The key a page is stored under: its URL, and the build ID so that a deploy replaces every entry at once.
 * The query string is part of the URL, so `.data` URLs (with their `_routes`) and pages with a marker are their own
 * entries.
 */
export function edgeCacheKey(url: string, buildId: string): string {
  const key = new URL(url);
  key.hash = "";
  key.search = `${key.search ? `${key.search}&` : "?"}__build=${encodeURIComponent(buildId)}`;
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

/** What the visitor gets for a render's response: no internal headers, the browser's `Cache-Control`, `X-Cache`. */
function answerFor(response: Response, label: CacheLabel, stored: { cls: CacheClass } | undefined): Response {
  const headers = visitorHeaders(response.headers);
  if (stored) {
    headers.set("Cache-Control", browserCacheControl(stored.cls, headers.get("Content-Type")));
  } else if ((response.status >= 400 || headers.has("Set-Cookie")) && !headers.has("Cache-Control")) {
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

/** Stores `response` (a clone: its body is read here) for `ttl` seconds of freshness. */
async function store(
  cache: Cache,
  key: Request,
  response: Response,
  kind: { cls: CacheClass; ttl: number },
  request: Request,
) {
  const headers = visitorHeaders(response.headers);
  const keep = Math.ceil(Math.max(kind.ttl + KEEP_AFTER_FRESH_SECONDS, KEEP_AT_LEAST_SECONDS));
  headers.set("Cache-Control", `public, max-age=${keep}`);
  headers.set(STORED_CLASS, kind.cls);
  headers.set(STORED_TTL, String(kind.ttl));
  headers.set(STORED_AT, String(Date.now()));
  try {
    const { status, statusText } = response;
    await cache.put(key, new Response(response.body, { status, statusText, headers }));
  } catch (error) {
    logProblem("edge cache write failed", error, request);
  }
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
// design tokens (spec 8) inline; the design system replaces them with its own pages.
function statusPage(status: 429 | 503, retryAfter: number, title: string, text: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
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

/**
 * Answers `request` from the edge cache, or from `render` (React Router) and stores what it answers.
 *
 * - Not cached: anything but GET, and the root (a redirect that depends on a cookie). `X-Cache: BYPASS`.
 * - A stored copy younger than its TTL is served (`HIT`); one past it but within the class's stale-while-revalidate
 *   window is served too (`STALE`) while one `render` refreshes it in `ctx.waitUntil`.
 * - Otherwise this is a miss: the visitor's limit is checked (60 per 10 s, over it the 429 page), `render` runs and its
 *   answer is stored if it names a class (`cached`) and is not an error.
 * - A `render` that throws or answers 5xx is replaced by the stored copy, of any age, if there is one (stale-if-error);
 *   failing that, a throw or a 503 becomes the 503 page.
 *
 * Every answer carries `X-Cache`, the class's `Cache-Control` for the browser and none of the internal headers.
 */
export async function withEdgeCache(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  render: () => Promise<Response>,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const root = UNCACHED_PATHS.has(pathname);
  if (request.method !== "GET" || root) {
    // The redirect at the root costs nothing. Any other request that skips the cache renders on the visitor's account.
    if (!root && !(await withinVisitorLimit(request, env))) return tooManyRequests();
    const response = await attempt(render, request);
    return response ? answerFor(response, "BYPASS", undefined) : unavailable();
  }

  const cache = caches.default;
  const key = new Request(edgeCacheKey(request.url, env.BUILD_ID));
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

  const response = await attempt(render, request);
  if (response && response.status < 500) {
    await copy?.response.body?.cancel();
    const kind = storableAs(response);
    if (kind) ctx.waitUntil(store(cache, key, response.clone(), kind, request));
    return answerFor(response, "MISS", kind);
  }

  // The render failed: a throw, or a 5xx.
  if (copy) {
    await response?.body?.cancel();
    return serveStored(copy, "STALE");
  }
  if (response && response.status !== 503) return answerFor(response, "MISS", undefined);
  await response?.body?.cancel();
  return unavailable();
}

/** Starts the refresh of a stale copy, unless this Worker instance is already refreshing it. */
function refresh(cache: Cache, key: Request, request: Request, ctx: ExecutionContext, render: () => Promise<Response>) {
  if (refreshing.has(key.url)) return;
  const task = (async () => {
    const response = await attempt(render, request);
    const kind = response && response.status < 500 ? storableAs(response) : undefined;
    if (response && kind) await store(cache, key, response, kind, request);
    else await response?.body?.cancel();
  })().finally(() => refreshing.delete(key.url));
  refreshing.set(key.url, task);
  ctx.waitUntil(task);
}
