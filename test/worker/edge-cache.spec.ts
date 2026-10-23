import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_CLASSES, type CacheClass } from "../../app/server/cache-class";
import {
  createDegradedMark,
  createSubrequestCache,
  edgeCacheKey,
  SHARED_LOAD_MAX_AGE_MS,
  SINGLE_FLIGHT_WAIT_MS,
  withEdgeCache,
  type DegradedMark,
  type Render,
} from "../../app/server/edge-cache";
import { cacheGeneration, createLoadContext, getSubrequestCache, type Env } from "../../app/server/env";
import { UpstreamError, type UpstreamErrorKind } from "../../app/server/upstream";
import { allSwitches } from "../support/switches";

// The page-level edge cache, called directly with a fake `render` and a fake execution context. The Cache API
// is the Workers runtime's own (workerd), so what is stored is what a deployed Worker would store.

const T0 = new Date("2026-10-17T12:00:00Z").getTime();

const baseEnv: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  AMM_DATA: "on",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

beforeEach(() => {
  // Only the clock: the Cache API and the streams need the real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

// Every test gets pages of its own: the cache outlives a test.
let pages = 0;
function pageUrl(path = "/xrpl/ledger/107695660") {
  return `https://explorer.test/t${++pages}${path}`;
}

/** An execution context that remembers what was handed to `waitUntil`. */
function harness(overrides: Partial<Env> = {}) {
  const pending: Promise<unknown>[] = [];
  /** Everything handed to `waitUntil`, in order, also once it has been waited for. */
  const handed: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => void (pending.push(promise), handed.push(promise)),
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const limit = vi.fn(async (_options: RateLimitOptions): Promise<RateLimitOutcome> => ({ success: true }));
  const env: Env = { ...baseEnv, VISITOR_LIMITER: { limit }, ...overrides };
  return {
    ctx,
    env,
    limit,
    /** Waits for everything handed to `waitUntil`, and for what that handed on in turn. */
    async settle() {
      while (pending.length > 0) await Promise.all(pending.splice(0));
    },
    get waiting() {
      return pending.length;
    },
    handed,
  };
}

type Answer = {
  cls?: CacheClass | string;
  ttl?: number | string;
  status?: number;
  body?: BodyInit | null;
  type?: string;
  headers?: Record<string, string>;
};

function answer({ cls, ttl, status = 200, body = "<html>page</html>", type = "text/html", headers = {} }: Answer = {}) {
  const init = new Headers({ "Content-Type": type, ...headers });
  if (cls !== undefined) init.set("X-Cache-Class", cls);
  if (ttl !== undefined) init.set("X-Cache-Ttl", String(ttl));
  return new Response(status === 204 || (status >= 300 && status < 400) ? null : body, { status, headers: init });
}

/** A `render` that answers with `answer(spec)` each time (a function gives the n-th answer). */
function renderOf(spec: Answer | ((call: number) => Answer | Response | Promise<Response>)) {
  let calls = 0;
  // `withEdgeCache` hands `render` the degraded mark and the request to render (a GET, also for a HEAD).
  return vi.fn(async (_mark?: DegradedMark, _request?: Request) => {
    calls += 1;
    const next = typeof spec === "function" ? await spec(calls) : spec;
    return next instanceof Response ? next : answer(next);
  });
}

function get(url: string, headers: Record<string, string> = {}, method = "GET") {
  return new Request(url, { method, headers });
}

const INTERNAL = ["X-Cache-Class", "X-Cache-Ttl", "X-Edge-Class", "X-Edge-Ttl", "X-Edge-Stored-At"];
function expectNoInternalHeaders(response: Response) {
  for (const name of INTERNAL) expect(response.headers.has(name), name).toBe(false);
}

describe("storing and serving a page", () => {
  it("stores an answer that names its class and serves the second request from the cache", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "immutable", body: "<html>ledger</html>" });

    const first = await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(await first.text()).toBe("<html>ledger</html>");

    const second = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(second.headers.get("Content-Type")).toBe("text/html");
    expect(await second.text()).toBe("<html>ledger</html>");
  });

  it("gives the browser the class's Cache-Control and neither internal header, on a miss and on a hit", async () => {
    const h = harness();
    for (const cls of Object.keys(CACHE_CLASSES) as CacheClass[]) {
      const url = pageUrl(`/${cls}`);
      const render = renderOf({ cls, ttl: 120 });
      const miss = await withEdgeCache(get(url), h.env, h.ctx, render);
      await h.settle();
      const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
      for (const response of [miss, hit]) {
        expect(response.headers.get("Cache-Control"), cls).toBe(CACHE_CLASSES[cls].browser.html);
        expectNoInternalHeaders(response);
      }
      expect(hit.headers.get("X-Cache"), cls).toBe("HIT");
    }
  });

  it("gives an image the class's image Cache-Control", async () => {
    const h = harness();
    const url = pageUrl("/og/xrpl/tx/ABC.png");
    const render = renderOf({ cls: "immutable", type: "image/png", body: "png-bytes" });
    const miss = await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(miss.headers.get("Cache-Control")).toBe("max-age=31536000, immutable");
    expect(hit.headers.get("Cache-Control")).toBe("max-age=31536000, immutable");
    expect(new TextDecoder().decode(await hit.arrayBuffer())).toBe("png-bytes");
  });

  it("keeps the other headers of the answer (a single-fetch answer needs X-Remix-Response)", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/tx/ABC.data");
    const render = renderOf({
      cls: "immutable",
      type: "text/x-script",
      headers: { "X-Remix-Response": "yes", Link: "</x>; rel=preload" },
    });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(hit.headers.get("X-Cache")).toBe("HIT");
    expect(hit.headers.get("X-Remix-Response")).toBe("yes");
    expect(hit.headers.get("Content-Type")).toBe("text/x-script");
    expect(hit.headers.get("Link")).toBe("</x>; rel=preload");
  });

  it("serves the whole body of a streamed answer to the visitor and stores all of it", async () => {
    const h = harness();
    const url = pageUrl();
    const chunks = ["<html>", "<body>", "streamed", "</body></html>"];
    const render = renderOf(() => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = chunks.shift();
          if (next === undefined) return controller.close();
          await Promise.resolve();
          controller.enqueue(encoder.encode(next));
        },
      });
      return answer({ cls: "immutable", body: stream });
    });
    const miss = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(await miss.text()).toBe("<html><body>streamed</body></html>");
    await h.settle();
    const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(hit.headers.get("X-Cache")).toBe("HIT");
    expect(await hit.text()).toBe("<html><body>streamed</body></html>");
  });

  it("stores a redirect and serves it again with its Location", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/tx/C0123456789ABCDE");
    const render = renderOf({ cls: "immutable", status: 302, headers: { Location: "/xrpl/tx/ABC" } });
    const miss = await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(miss.status).toBe(302);
    expect(hit.status).toBe(302);
    expect(hit.headers.get("Location")).toBe("/xrpl/tx/ABC");
    expect(hit.headers.get("X-Cache")).toBe("HIT");
  });

  it("keeps a page, its query strings and its data URL apart, each under its own class", async () => {
    const h = harness();
    const base = pageUrl("/xrpl/account/rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x");
    const html = renderOf({ cls: "live", body: "html" });
    const withMarker = renderOf({ cls: "immutable", body: "marker page" });
    const data = renderOf({ cls: "slow", type: "text/x-script", body: "data" });

    await withEdgeCache(get(base), h.env, h.ctx, html);
    await withEdgeCache(get(`${base}?marker=abc`), h.env, h.ctx, withMarker);
    await withEdgeCache(get(`${base}.data?_routes=routes%2Faccount`), h.env, h.ctx, data);
    await h.settle();

    const a = await withEdgeCache(get(base), h.env, h.ctx, html);
    const b = await withEdgeCache(get(`${base}?marker=abc`), h.env, h.ctx, withMarker);
    const c = await withEdgeCache(get(`${base}.data?_routes=routes%2Faccount`), h.env, h.ctx, data);
    expect([a, b, c].map((r) => r.headers.get("X-Cache"))).toEqual(["HIT", "HIT", "HIT"]);
    expect(await a.text()).toBe("html");
    expect(await b.text()).toBe("marker page");
    expect(await c.text()).toBe("data");
    expect(a.headers.get("Cache-Control")).toBe(CACHE_CLASSES.live.browser.html);
    expect(b.headers.get("Cache-Control")).toBe(CACHE_CLASSES.immutable.browser.html);
    expect(c.headers.get("Cache-Control")).toBe(CACHE_CLASSES.slow.browser.html);
    // A query string that is not a page of its own is still another entry.
    const other = renderOf({ cls: "live", body: "other" });
    expect((await withEdgeCache(get(`${base}?x=1`), h.env, h.ctx, other)).headers.get("X-Cache")).toBe("MISS");
  });

  it("includes the cache generation in the key: another switch value, or another build, misses", async () => {
    const url = pageUrl();
    const on = harness({ AMM_DATA: "on" });
    const off = harness({ AMM_DATA: "off" });
    const render = renderOf((n) => ({ cls: "immutable", body: `render ${n}` }));

    await withEdgeCache(get(url), on.env, on.ctx, render);
    await on.settle();
    const again = harness({ AMM_DATA: "on" });
    const sameValues = await withEdgeCache(get(url), again.env, again.ctx, render);
    const otherValue = await withEdgeCache(get(url), off.env, off.ctx, render);
    await off.settle();
    expect(sameValues.headers.get("X-Cache")).toBe("HIT");
    expect(await sameValues.text()).toBe("render 1");
    expect(otherValue.headers.get("X-Cache")).toBe("MISS");
    expect(await otherValue.text()).toBe("render 2");

    // The page a flip back finds is the first one: each value keeps its own copy.
    const backOn = await withEdgeCache(get(url), again.env, again.ctx, render);
    expect(backOn.headers.get("X-Cache")).toBe("HIT");
    expect(await backOn.text()).toBe("render 1");

    const otherBuild = harness({ BUILD_ID: "build-b" });
    expect((await withEdgeCache(get(url), otherBuild.env, otherBuild.ctx, render)).headers.get("X-Cache")).toBe("MISS");
    await otherBuild.settle();
  });

  it("keys the page with the generation: the build ID and every switch, and nothing else of the key changes", () => {
    const h = harness();
    const url = pageUrl();
    expect(edgeCacheKey(url, cacheGeneration(h.env))).toContain(`__build=${encodeURIComponent(cacheGeneration(h.env))}`);
    // ACCOUNT_ANALYTICS is one of the switches the generation names (sorted first), and flipping it is another key.
    expect(cacheGeneration(h.env)).toMatch(/^test-build:ACCOUNT_ANALYTICS=off,AMM_DATA=on,AMM_PAGES=off,MARKETS=off,/);
    expect(edgeCacheKey(url, cacheGeneration(h.env))).toContain(encodeURIComponent("ACCOUNT_ANALYTICS=off"));
    expect(edgeCacheKey(url, cacheGeneration({ ...h.env, ACCOUNT_ANALYTICS: "on" }))).not.toBe(edgeCacheKey(url, cacheGeneration(h.env)));
    // AMM_PAGES is another: a stored page never meets the other value of the header's AMM item or of a pool link.
    expect(edgeCacheKey(url, cacheGeneration(h.env))).toContain(encodeURIComponent("AMM_PAGES=off"));
    expect(edgeCacheKey(url, cacheGeneration({ ...h.env, AMM_PAGES: "on" }))).not.toBe(edgeCacheKey(url, cacheGeneration(h.env)));
    expect(edgeCacheKey(url, "build-a")).not.toBe(edgeCacheKey(url, "build-b"));
    expect(edgeCacheKey(url, "build-a")).not.toBe(edgeCacheKey(`${url}?x=1`, "build-a"));
    expect(edgeCacheKey(`${url}?x=1`, "build-a")).toBe(`${url}?x=1&__build=build-a`);
    expect(edgeCacheKey(`${url}#top`, "build-a")).toBe(`${url}?__build=build-a`);
  });

  it("keeps a stored copy for the longer of the edge TTL plus 30 s and 24 hours", async () => {
    const h = harness();
    const lifetimeOf = async (spec: Answer) => {
      const url = pageUrl();
      await withEdgeCache(get(url), h.env, h.ctx, renderOf(spec));
      await h.settle();
      const stored = await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)));
      expect(stored, JSON.stringify(spec)).toBeDefined();
      return stored!.headers.get("Cache-Control");
    };
    expect(await lifetimeOf({ cls: "immutable" })).toBe("public, max-age=31536030");
    expect(await lifetimeOf({ cls: "live" })).toBe("public, max-age=86400");
    expect(await lifetimeOf({ cls: "slow" })).toBe("public, max-age=86400");
    expect(await lifetimeOf({ cls: "short", ttl: 60 })).toBe("public, max-age=86400");
    expect(await lifetimeOf({ cls: "short", ttl: 200_000 })).toBe("public, max-age=200030");
  });
});

describe("freshness", () => {
  it("keeps a short copy fresh for the class's 30 s, and for X-Cache-Ttl when the answer has one", async () => {
    const h = harness();
    const plain = pageUrl("/search");
    const longer = pageUrl("/search");
    const renderPlain = renderOf((n) => ({ cls: "short", body: `plain ${n}` }));
    const renderLonger = renderOf((n) => ({ cls: "short", ttl: 60, body: `longer ${n}` }));

    await withEdgeCache(get(plain), h.env, h.ctx, renderPlain);
    await withEdgeCache(get(longer), h.env, h.ctx, renderLonger);
    await h.settle();

    advance(29_999);
    expect((await withEdgeCache(get(plain), h.env, h.ctx, renderPlain)).headers.get("X-Cache")).toBe("HIT");
    advance(1);
    const expired = await withEdgeCache(get(plain), h.env, h.ctx, renderPlain);
    expect(expired.headers.get("X-Cache")).toBe("MISS");
    expect(await expired.text()).toBe("plain 2");

    // The one with a TTL of 60 s is still fresh at 30 s, and not at 60 s.
    expect((await withEdgeCache(get(longer), h.env, h.ctx, renderLonger)).headers.get("X-Cache")).toBe("HIT");
    advance(29_999);
    expect((await withEdgeCache(get(longer), h.env, h.ctx, renderLonger)).headers.get("X-Cache")).toBe("HIT");
    advance(1);
    const later = await withEdgeCache(get(longer), h.env, h.ctx, renderLonger);
    expect(later.headers.get("X-Cache")).toBe("MISS");
    expect(await later.text()).toBe("longer 2");
  });

  it("ignores an X-Cache-Ttl that is not a positive number", async () => {
    const h = harness();
    for (const ttl of ["", "abc", "0", "-5", "Infinity"]) {
      const url = pageUrl("/search");
      const render = renderOf({ cls: "short", ttl });
      await withEdgeCache(get(url), h.env, h.ctx, render);
      await h.settle();
      advance(29_000);
      const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
      expect(hit.headers.get("X-Cache"), ttl).toBe("HIT");
      advance(1000);
      const miss = await withEdgeCache(get(url), h.env, h.ctx, render);
      expect(miss.headers.get("X-Cache"), ttl).toBe("MISS");
      await h.settle();
      advance(-30_000);
    }
  });

  it("serves a live copy stale after 5 s and refreshes it once in waitUntil", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf((n) => ({ cls: "live", body: `render ${n}` }));

    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();

    advance(4999);
    const fresh = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(fresh.headers.get("X-Cache")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);

    advance(1);
    const stale = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(stale.headers.get("X-Cache")).toBe("STALE");
    expect(await stale.text()).toBe("render 1");
    expect(stale.headers.get("Cache-Control")).toBe(CACHE_CLASSES.live.browser.html);
    expectNoInternalHeaders(stale);
    // The refresh is background work: it is handed to waitUntil, and the visitor did not wait for it.
    expect(h.waiting).toBeGreaterThan(0);
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);

    const refreshed = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(refreshed.headers.get("X-Cache")).toBe("HIT");
    expect(await refreshed.text()).toBe("render 2");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("serves the home page class stale after 1 s, and renders inline once the copy is older than 3 s", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf((n) => ({ cls: "live-home", body: `render ${n}` }));
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    advance(999);
    expect((await withEdgeCache(get(url), h.env, h.ctx, render)).headers.get("X-Cache")).toBe("HIT");
    advance(1);
    // 1 s old: the copy is served at once (a reload does not wait) while one render refreshes it behind the answer.
    const stale = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(stale.headers.get("X-Cache")).toBe("STALE");
    expect(await stale.text()).toBe("render 1");
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);

    // The refresh stored a copy at 1 s. It is fresh for 1 s, stale until 3 s old, and after that the visitor waits for a render:
    // a reload never shows a copy much older than one ledger.
    advance(2999);
    expect((await withEdgeCache(get(url), h.env, h.ctx, render)).headers.get("X-Cache")).toBe("STALE");
    await h.settle();
    expect(render).toHaveBeenCalledTimes(3);
    advance(3000);
    const inline = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(inline.headers.get("X-Cache")).toBe("MISS");
    expect(await inline.text()).toBe("render 4");
    await h.settle();
  });

  it("renders inline when a live copy is older than 35 s", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf((n) => ({ cls: "live", body: `render ${n}` }));
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();

    advance(34_999);
    const stale = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(stale.headers.get("X-Cache")).toBe("STALE");
    expect(await stale.text()).toBe("render 1");
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);

    // That refresh stored a copy at 34.999 s; 35 s after that one it is too old to be served stale.
    advance(35_000);
    const before = h.waiting;
    const inline = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(inline.headers.get("X-Cache")).toBe("MISS");
    expect(await inline.text()).toBe("render 3");
    // It was rendered before the answer, not behind it (only the store of the copy is in waitUntil).
    expect(render).toHaveBeenCalledTimes(3);
    expect(h.waiting - before).toBe(1);
  });

  it("starts one refresh for any number of stale requests at the same time", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const render = renderOf(async (n) => {
      if (n > 1) await gate;
      return answer({ cls: "live", body: `render ${n}` });
    });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    advance(10_000);

    const responses = await Promise.all([1, 2, 3, 4].map(() => withEdgeCache(get(url), h.env, h.ctx, render)));
    expect(responses.map((r) => r.headers.get("X-Cache"))).toEqual(["STALE", "STALE", "STALE", "STALE"]);
    release();
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);

    // And a later stale copy can be refreshed again.
    advance(10_000);
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("keeps the stale copy when its refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf((n) => {
      if (n === 1) return { cls: "live", body: "good" };
      if (n === 2) return { status: 503, body: "down" };
      throw new Error("boom");
    });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();

    advance(6000);
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle(); // the refresh answered 503
    advance(100);
    const again = await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle(); // the refresh threw
    expect(again.headers.get("X-Cache")).toBe("STALE");
    expect(await again.text()).toBe("good");
    expect(render).toHaveBeenCalledTimes(3);
  });
});

describe("when the render fails", () => {
  // The failures are logged; the tests keep that out of the output.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  async function stored(h: ReturnType<typeof harness>, url: string, cls: CacheClass = "live") {
    await withEdgeCache(get(url), h.env, h.ctx, renderOf({ cls, body: "old page" }));
    await h.settle();
  }

  it.each([
    ["throws", () => Promise.reject(new Error("boom"))],
    ["answers 503", () => Promise.resolve(answer({ status: 503, body: "down" }))],
    ["answers 500", () => Promise.resolve(answer({ status: 500, body: "bug" }))],
    ["answers 502", () => Promise.resolve(answer({ status: 502, body: "gateway" }))],
  ])("serves the stored copy, whatever its age, when the render %s", async (_name, failure) => {
    for (const age of [60_000, 3_600_000, 23 * 3_600_000]) {
      const h = harness();
      const url = pageUrl("/xrpl/ledger/1");
      await stored(h, url);
      advance(age);
      const response = await withEdgeCache(get(url), h.env, h.ctx, vi.fn(failure));
      expect(response.status, `age ${age}`).toBe(200);
      expect(response.headers.get("X-Cache"), `age ${age}`).toBe("STALE");
      expect(await response.text()).toBe("old page");
      expectNoInternalHeaders(response);
      expect(response.headers.get("Cache-Control")).toBe(CACHE_CLASSES.live.browser.html);
    }
  });

  it("answers 503 with Retry-After: 30 and a page that is noindex and links home when nothing is stored", async () => {
    for (const failure of [
      () => Promise.reject(new Error("boom")),
      () => Promise.resolve(answer({ status: 503, body: "the route's own page" })),
    ]) {
      const h = harness();
      const response = await withEdgeCache(get(pageUrl()), h.env, h.ctx, vi.fn(failure));
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("30");
      expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
      expect(response.headers.get("X-Cache")).toBe("MISS");
      const html = await response.text();
      expect(html).toContain("<!doctype html>");
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain('<a href="/">');
      // The page background and text colours of the design tokens (spec 8), light and dark.
      for (const colour of ["#F3F4F7", "#121317", "#F2F3F5"]) expect(html).toContain(colour);
      expect(html).not.toContain("boom");
      expect(html).not.toContain("the route's own page");
    }
  });

  it("passes any other 5xx through, uncached, when nothing is stored", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ status: 500, body: "the error boundary" });
    const response = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("the error boundary");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("does not store a failed answer, even one that names a class", async () => {
    const h = harness();
    const url = pageUrl();
    await withEdgeCache(get(url), h.env, h.ctx, renderOf({ cls: "live", status: 503 }));
    await h.settle();
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();
  });

  it("logs why the render failed, with the path and without the query", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    await withEdgeCache(get(`${pageUrl("/xrpl/ledger/1")}?secret=x`), h.env, h.ctx, async () => {
      throw new Error("data API GET /v2/ledgers/1 answered 500");
    });
    expect(errors).toHaveBeenCalledTimes(1);
    const line = String(errors.mock.calls[0]![0]);
    expect(line).toContain("data API GET /v2/ledgers/1 answered 500");
    expect(line).toContain("/xrpl/ledger/1");
    expect(line).not.toContain("secret");
    expect(() => JSON.parse(line)).not.toThrow();
  });
});

describe("what is never stored", () => {
  it.each([400, 401, 403, 404, 410, 429, 500, 502, 503, 504])(
    "an answer with status %i, even when it names a class",
    async (status) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      for (const cls of ["immutable", "live", "slow"] as const) {
        const h = harness();
        const url = pageUrl();
        const render = renderOf({ cls, status });
        const first = await withEdgeCache(get(url), h.env, h.ctx, render);
        await h.settle();
        expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env))), `${status} ${cls}`).toBeUndefined();
        expect(first.headers.get("X-Cache")).toBe("MISS");
        if (status !== 503) expect(first.headers.get("Cache-Control")).toBe("no-store");
        const second = await withEdgeCache(get(url), h.env, h.ctx, render);
        expect(second.headers.get("X-Cache")).toBe("MISS");
        expect(render).toHaveBeenCalledTimes(2);
      }
    },
  );

  it("stores a 404 marked short, and only that", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/tx/" + "A".repeat(64));
    const render = renderOf({ cls: "short", status: 404, body: "not found" });
    const miss = await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(miss.status).toBe(404);
    expect(miss.headers.get("Cache-Control")).toBe(CACHE_CLASSES.short.browser.html);

    const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(hit.status).toBe(404);
    expect(hit.headers.get("X-Cache")).toBe("HIT");
    expect(await hit.text()).toBe("not found");
    expect(render).toHaveBeenCalledTimes(1);

    // Its TTL override (the node fallback is kept for 60 s) works as for any answer.
    const longer = pageUrl("/xrpl/tx/" + "B".repeat(64));
    const renderLonger = renderOf({ cls: "short", status: 404, ttl: 60 });
    await withEdgeCache(get(longer), h.env, h.ctx, renderLonger);
    await h.settle();
    advance(45_000);
    expect((await withEdgeCache(get(longer), h.env, h.ctx, renderLonger)).headers.get("X-Cache")).toBe("HIT");
  });

  it("an answer that names no class, or a class that does not exist", async () => {
    const h = harness();
    for (const cls of [undefined, "forever", "", "constructor", "__proto__"]) {
      const url = pageUrl();
      const render = renderOf({ cls });
      await withEdgeCache(get(url), h.env, h.ctx, render);
      await h.settle();
      const second = await withEdgeCache(get(url), h.env, h.ctx, render);
      expect(second.headers.get("X-Cache"), String(cls)).toBe("MISS");
      expect(render).toHaveBeenCalledTimes(2);
      expectNoInternalHeaders(second);
    }
  });

  it("an answer that sets a cookie", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "live", headers: { "Set-Cookie": "net=xahau; Path=/" } });
    const first = await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(first.headers.get("Set-Cookie")).toBe("net=xahau; Path=/");
    // Not even for the browser's cache: the class's Cache-Control is for a page everyone shares.
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();
    expect((await withEdgeCache(get(url), h.env, h.ctx, render)).headers.get("X-Cache")).toBe("MISS");
  });

  it("a partial answer", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "immutable", status: 206 });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();
  });
});

describe("a degraded answer", () => {
  // A page that renders with a part missing (the node is down, a list could not be loaded) says so by marking the request, and is
  // served but never stored. The mark may be set while the body is still streaming, so the copy is made when the body is complete.

  /** A `render` whose n-th answer is decided by `how(n, mark)`; it gets the mark of its own render. */
  function marking(how: (call: number, mark: DegradedMark) => Answer | Response | Promise<Answer | Response>) {
    let calls = 0;
    const seen: DegradedMark[] = [];
    const render = vi.fn(async (mark: DegradedMark) => {
      calls += 1;
      seen.push(mark);
      const next = await how(calls, mark);
      return next instanceof Response ? next : answer(next);
    });
    return Object.assign(render, { seen });
  }

  it("a fresh mark says nothing, keeps the first reason, and is only ever set", () => {
    const mark = createDegradedMark();
    expect(mark.degraded).toBe(false);
    expect(mark.reason).toBeUndefined();
    mark.mark("node unavailable");
    mark.mark("transactions failed");
    expect(mark.degraded).toBe(true);
    expect(mark.reason).toBe("node unavailable");
  });

  it("is served and not stored when the render marked the request before it answered, and the browser is told not to keep it", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const render = marking((_call, mark) => {
      mark.mark("node unavailable");
      return { cls: "live", body: "<html>live state unavailable</html>" };
    });

    const first = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expectNoInternalHeaders(first);
    expect(await first.text()).toBe("<html>live state unavailable</html>");
    await h.settle();
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();

    const second = await withEdgeCache(get(url), h.env, h.ctx, render);
    await second.text();
    await h.settle();
    expect(second.headers.get("X-Cache")).toBe("MISS");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("is not stored when the mark is set while the body streams, and the visitor still gets the first chunk before the section settles", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    let settleSection!: () => void;
    const sectionSettles = new Promise<void>((resolve) => (settleSection = resolve));
    const encoder = new TextEncoder();
    const render = marking((_call, mark) => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode("<html>header"));
          await sectionSettles;
          // The deferred section failed: it marks the request, then the rest of the page is sent.
          mark.mark("transactions failed");
          controller.enqueue(encoder.encode(" couldn't load transactions</html>"));
          controller.close();
        },
      });
      return answer({ cls: "live", body: stream });
    });

    const response = await withEdgeCache(get(url), h.env, h.ctx, render);
    // Streaming is not held back: the visitor has the header while the section is still pending.
    const reader = response.body!.getReader();
    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe("<html>header");
    expect(render.seen[0]!.degraded).toBe(false);

    settleSection();
    let rest = "";
    for (let part = await reader.read(); !part.done; part = await reader.read()) rest += new TextDecoder().decode(part.value);
    expect(rest).toBe(" couldn't load transactions</html>");
    await h.settle();
    expect(render.seen[0]!.degraded).toBe(true);
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();

    const again = await withEdgeCache(get(url), h.env, h.ctx, render);
    await again.text();
    expect(again.headers.get("X-Cache")).toBe("MISS");
  });

  it("stores a later good render of the same page", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const render = marking((call, mark) => {
      if (call === 1) mark.mark("node unavailable");
      return { cls: "live", body: `render ${call}` };
    });

    expect(await (await withEdgeCache(get(url), h.env, h.ctx, render)).text()).toBe("render 1");
    await h.settle();
    const good = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(good.headers.get("X-Cache")).toBe("MISS");
    expect(good.headers.get("Cache-Control")).toBe(CACHE_CLASSES.live.browser.html);
    expect(await good.text()).toBe("render 2");
    await h.settle();

    const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(hit.headers.get("X-Cache")).toBe("HIT");
    expect(await hit.text()).toBe("render 2");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("gives each render a mark of its own", async () => {
    const h = harness();
    const render = marking(() => ({ cls: "live" }));
    await withEdgeCache(get(pageUrl()), h.env, h.ctx, render);
    await withEdgeCache(get(pageUrl()), h.env, h.ctx, render);
    await withEdgeCache(get(pageUrl()), { ...h.env }, h.ctx, render);
    expect(new Set(render.seen).size).toBe(3);
  });

  it("leaves the stored copy as it was when its refresh is degraded", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const render = marking((call, mark) => {
      if (call === 2) mark.mark("node unavailable");
      return { cls: "live", body: `render ${call}` };
    });

    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    // Past the 5 s of a live copy and within its 30 s of stale-while-revalidate: stale, and one render refreshes it.
    advance(6_000);
    const stale = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(stale.headers.get("X-Cache")).toBe("STALE");
    expect(await stale.text()).toBe("render 1");
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);

    // The degraded refresh stored nothing: the copy is still render 1, and still stale (and this request starts the next refresh).
    const stillStale = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(stillStale.headers.get("X-Cache")).toBe("STALE");
    expect(await stillStale.text()).toBe("render 1");
    await h.settle();
    // That refresh was good and replaced the copy.
    const replaced = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(replaced.headers.get("X-Cache")).toBe("HIT");
    expect(await replaced.text()).toBe("render 3");
  });

  it("does not stop a redirect or a body-less answer from being stored", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const render = marking(() => ({ cls: "immutable", status: 302, headers: { Location: "/xrpl/account/rX" } }));
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    const hit = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(hit.headers.get("X-Cache")).toBe("HIT");
    expect(hit.status).toBe(302);
    expect(hit.headers.get("Location")).toBe("/xrpl/account/rX");
  });
});

// A HEAD is answered as the GET of the same URL, with the body dropped (unfurlers and monitors send them): from the stored copy when there
// is one, and otherwise by one render, as a GET, that is stored as a GET's would be. It never renders twice for one request.
// Single flight: while one request renders a page that is not in the cache, the others that ask for the same page at the same moment (a
// herd: the home page is asked for by every open tab every 4 s) wait for it instead of rendering again, and are given the answer it stored. Per
// Worker instance; every class. The visitor limit applies to each request as it always did, and an answer that cannot be shared (degraded, an
// error, not storable, a render that threw) is rendered by each of them for themselves, as before.
describe("many requests for one page at once", () => {
  /** A `render` that waits for the test to let it go, then answers with `how(call, mark)`; it counts its calls. */
  function held(how: (call: number, mark: DegradedMark) => Answer | Response | Promise<Answer | Response> = () => ({ cls: "live", body: "<html>page</html>" })) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const render = vi.fn(async (mark: DegradedMark) => {
      calls += 1;
      const call = calls;
      // Only the first render is held: whoever renders after it answers at once.
      if (call === 1) await gate;
      const next = await how(call, mark);
      return next instanceof Response ? next : answer(next);
    });
    return { render, release };
  }

  /** Starts `n` requests for `url` and waits until each has passed the visitor limit and is either rendering or waiting for the render. */
  async function ask(h: ReturnType<typeof harness>, render: Render, url: string, n: number, options: { method?: string } = {}) {
    const before = h.limit.mock.calls.length;
    const requests = Array.from({ length: n }, () => withEdgeCache(get(url, {}, options.method), h.env, h.ctx, render));
    await vi.waitFor(() => expect(h.limit.mock.calls.length - before).toBe(n));
    // The limit answered; what each does next (join, or lead) takes a few ticks.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return requests;
  }

  it("renders once, and gives the others a copy of the answer, with the same status and headers, naming what it is", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const { render, release } = held(() => ({ cls: "live", body: "<html>one render</html>", headers: { "X-Test": "kept" } }));
    const requests = await ask(h, render, url, 5);
    expect(render).toHaveBeenCalledTimes(1);

    release();
    const responses = await Promise.all(requests);
    expect(render).toHaveBeenCalledTimes(1);
    expect(await Promise.all(responses.map((response) => response.text()))).toEqual(Array(5).fill("<html>one render</html>"));
    const labels = responses.map((response) => response.headers.get("X-Cache")).sort();
    expect(labels).toEqual(["MISS", "MISS-SHARED", "MISS-SHARED", "MISS-SHARED", "MISS-SHARED"]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html");
      expect(response.headers.get("X-Test")).toBe("kept");
      expect(response.headers.get("Cache-Control")).toBe(CACHE_CLASSES.live.browser.html);
      expectNoInternalHeaders(response);
    }
    // And it was stored once: the next request is a hit.
    await h.settle();
    const next = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(next.headers.get("X-Cache")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("gives them a redirect as the redirect it is, and a body as the whole of it when the render streamed", async () => {
    const h = harness();
    const redirect = pageUrl("/xrpl/ledger/00107721455");
    const held302 = held(() => ({ cls: "immutable", status: 302, headers: { Location: "/xrpl/ledger/107721455" } }));
    const asked = await ask(h, held302.render, redirect, 3);
    held302.release();
    const redirects = await Promise.all(asked);
    expect(held302.render).toHaveBeenCalledTimes(1);
    for (const response of redirects) {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/xrpl/ledger/107721455");
    }

    const streamed = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const encoder = new TextEncoder();
    const heldStream = held(() => ({
      cls: "live",
      body: new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode("<html>header "));
          await new Promise((resolve) => setTimeout(resolve, 30));
          controller.enqueue(encoder.encode("and the list</html>"));
          controller.close();
        },
      }),
    }));
    const others = await ask(h, heldStream.render, streamed, 3);
    heldStream.release();
    const pages = await Promise.all((await Promise.all(others)).map((response) => response.text()));
    expect(pages).toEqual(Array(3).fill("<html>header and the list</html>"));
    expect(heldStream.render).toHaveBeenCalledTimes(1);
  });

  it("still asks the visitor limit for every request, and a request that is refused gets the 429 page and does not wait", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    h.limit.mockImplementation(async () => ({ success: true }));
    h.limit.mockImplementationOnce(async () => ({ success: true })); // the first, which renders
    h.limit.mockImplementationOnce(async () => ({ success: false })); // the second
    const { render, release } = held();
    const requests = await ask(h, render, url, 3);
    expect(h.limit).toHaveBeenCalledTimes(3);

    const refused = await requests[1]!;
    expect(refused.status).toBe(429);
    release();
    const [leader, , waiter] = await Promise.all(requests);
    expect(leader!.headers.get("X-Cache")).toBe("MISS");
    expect(waiter!.headers.get("X-Cache")).toBe("MISS-SHARED");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("makes each of them render when the first render marked its answer as degraded, which is never shared", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const { render, release } = held((call, mark) => {
      if (call === 1) mark.mark("node unavailable");
      return { cls: "live", body: `<html>render ${call}</html>` };
    });
    const requests = await ask(h, render, url, 4);
    release();
    const responses = await Promise.all(requests);
    await h.settle();
    expect(render).toHaveBeenCalledTimes(4);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    // Nobody was given another's copy; each has the answer of its own render.
    expect(responses.map((response) => response.headers.get("X-Cache"))).toEqual(["MISS", "MISS", "MISS", "MISS"]);
    const bodies = await Promise.all(responses.map((response) => response.text()));
    expect(new Set(bodies).size).toBe(4);
  });

  it("makes each of them render when the first render threw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    const url = pageUrl("/xrpl");
    const { render, release } = held((call) => {
      if (call === 1) throw new Error("boom");
      return { cls: "live", body: `<html>render ${call}</html>` };
    });
    const requests = await ask(h, render, url, 3);
    release();
    const [leader, ...waiters] = await Promise.all(requests);
    expect(leader!.status).toBe(503);
    expect(render).toHaveBeenCalledTimes(3);
    expect(waiters.map((response) => response.status)).toEqual([200, 200]);
    expect(waiters.map((response) => response.headers.get("X-Cache"))).toEqual(["MISS", "MISS"]);
  });

  it("makes each of them render when the answer cannot be stored (an error, a page nobody named a class for, a cookie), and does not hold them for its body", async () => {
    const h = harness();
    for (const [name, spec] of [
      ["404", { cls: "live", status: 404, body: "not here" }],
      ["no class", { body: "<html>no class</html>" }],
      ["a cookie", { cls: "live", headers: { "Set-Cookie": "net=xahau; Path=/" } }],
      ["a 500", { cls: "live", status: 500 }],
    ] as const) {
      const url = pageUrl("/xrpl");
      let calls = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const render = vi.fn(async () => {
        calls += 1;
        if (calls === 1) await gate;
        return answer(calls === 1 ? spec : { cls: "live", body: `<html>render ${calls}</html>` });
      });
      const requests = await ask(h, render, url, 3);
      release();
      const responses = await Promise.all(requests);
      expect(render, name).toHaveBeenCalledTimes(3);
      expect(responses.map((response) => response.headers.get("X-Cache")), name).not.toContain("MISS-SHARED");
    }
  });

  it("does not hold a waiter for the body of an answer that is already known not to be storable", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    let neverEnds!: () => void;
    const render = vi.fn(async () => {
      if (render.mock.calls.length === 1) {
        // A 404 whose body streams for ever: the headers are enough to know it is not shared.
        return answer({ cls: "live", status: 404, body: new ReadableStream({ start: (controller) => void (neverEnds = () => controller.close()) }) });
      }
      return answer({ cls: "live", body: "<html>own render</html>" });
    });
    const [leader, waiter] = await ask(h, render, url, 2);
    const response = await waiter!;
    expect(await response.text()).toBe("<html>own render</html>");
    expect(render).toHaveBeenCalledTimes(2);
    neverEnds();
    await leader;
  });

  it("is per page: another URL, and the `.data` URL of the same page, render for themselves", async () => {
    const h = harness();
    const page = pageUrl("/xrpl");
    const data = `${page}.data`;
    const other = pageUrl("/xrpl");
    const { render, release } = held();
    const requests = [
      ...(await ask(h, render, page, 2)),
      ...(await ask(h, render, data, 2)),
      ...(await ask(h, render, other, 2)),
    ];
    release();
    await Promise.all(requests);
    await h.settle();
    // Three keys, three renders; the others of each key waited for theirs. (Only the first render is held: the others answer at once.)
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("answers a HEAD of a page that is being rendered with that render, without the body", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const { render, release } = held(() => ({ cls: "live", body: "<html>page</html>" }));
    const getRequest = withEdgeCache(get(url), h.env, h.ctx, render);
    await vi.waitFor(() => expect(h.limit).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const headRequest = withEdgeCache(get(url, {}, "HEAD"), h.env, h.ctx, render);
    await vi.waitFor(() => expect(h.limit).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();

    const [page, head] = await Promise.all([getRequest, headRequest]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(await page.text()).toBe("<html>page</html>");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("X-Cache")).toBe("MISS-SHARED");
    expect(head.headers.get("Content-Type")).toBe("text/html");
  });

  it("never joins what skips the cache: the root, its `.data` URL, and anything but a GET render each time", async () => {
    const h = harness();
    for (const [request, label] of [
      [(n: number) => get(`https://explorer.test/`, { "CF-Connecting-IP": `192.0.2.${n}` }), "/"],
      [(n: number) => get(`https://explorer.test/_.data`, { "CF-Connecting-IP": `192.0.2.${n}` }), "/_.data"],
      [(n: number) => get(pageUrl("/xrpl/search"), { "CF-Connecting-IP": `192.0.2.${n}` }, "POST"), "POST"],
    ] as const) {
      const render = renderOf({ cls: "live", body: "x" });
      const pending = [1, 2, 3].map((n) => withEdgeCache(request(n), h.env, h.ctx, render));
      const responses = await Promise.all(pending);
      expect(render, label).toHaveBeenCalledTimes(3);
      expect(responses.map((response) => response.headers.get("X-Cache")), label).toEqual(["BYPASS", "BYPASS", "BYPASS"]);
    }
  });

  it("stops waiting for a render that never ends, and does not let the next request wait for it either", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(T0);
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = vi.fn(async () => {
      if (render.mock.calls.length === 1) return new Promise<Response>(() => {});
      return answer({ cls: "live", body: `<html>render ${render.mock.calls.length}</html>` });
    });
    void withEdgeCache(get(url), h.env, h.ctx, render);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { interval: 1 });
    const waiter = withEdgeCache(get(url), h.env, h.ctx, render);
    await vi.waitFor(() => expect(h.limit).toHaveBeenCalledTimes(2), { interval: 1 });

    await vi.advanceTimersByTimeAsync(SINGLE_FLIGHT_WAIT_MS);
    const response = await waiter;
    expect(await response.text()).toBe("<html>render 2</html>");
    expect(render).toHaveBeenCalledTimes(2);
    // The hung render's place was given up: a request now is not made to wait for it.
    await h.settle();
    const later = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(later.headers.get("X-Cache")).toBe("HIT");
  });
});

describe("HEAD", () => {
  const head = (url: string, headers: Record<string, string> = {}) => get(url, headers, "HEAD");
  /** The headers of an answer as pairs, in a fixed order. */
  const headersOf = (response: Response, without: string[] = []) =>
    [...response.headers].filter(([name]) => !without.includes(name)).sort(([a], [b]) => a.localeCompare(b));

  it("is answered from the copy a GET stored: same status and headers, no body, no render, no visitor limit", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "immutable", body: "<html>ledger</html>", headers: { "Content-Language": "en" } });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    const limited = h.limit.mock.calls.length;
    const full = await withEdgeCache(get(url), h.env, h.ctx, render);

    const response = await withEdgeCache(head(url), h.env, h.ctx, render);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cache")).toBe("HIT");
    expect(await response.text()).toBe("");
    expect(response.body === null || (await response.arrayBuffer()).byteLength === 0).toBe(true);
    expect(headersOf(response)).toEqual(headersOf(full));
    expectNoInternalHeaders(response);
    expect(render).toHaveBeenCalledTimes(1);
    expect(h.limit.mock.calls.length).toBe(limited);
    await full.text();
  });

  it("on a miss renders once, as a GET, stores what a GET would have stored, and answers without the body", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "immutable", body: "<html>ledger</html>" });

    const response = await withEdgeCache(head(url, { "User-Agent": "an-unfurler", "CF-Connecting-IP": "203.0.113.50" }), h.env, h.ctx, render);
    await h.settle();
    expect(render).toHaveBeenCalledTimes(1);
    const rendered = render.mock.calls[0]![1]!;
    expect(rendered.method).toBe("GET");
    expect(rendered.url).toBe(url);
    expect(rendered.headers.get("User-Agent")).toBe("an-unfurler");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CLASSES.immutable.browser.html);
    expect(await response.text()).toBe("");
    expect(h.limit).toHaveBeenCalledTimes(1);
    expect(h.limit).toHaveBeenCalledWith({ key: "203.0.113.50" });

    // The copy is the whole page, under the class: a GET is a hit with the body.
    const next = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(next.headers.get("X-Cache")).toBe("HIT");
    expect(await next.text()).toBe("<html>ledger</html>");
    expect(render).toHaveBeenCalledTimes(1);
    // The HEAD's headers are those a GET's miss of the same page has (the Cache API adds its own to a copy it serves: age, date, ...).
    const sibling = await withEdgeCache(get(pageUrl()), h.env, h.ctx, render);
    expect(headersOf(response)).toEqual(headersOf(sibling));
    await sibling.text();
    const copy = await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)));
    expect(copy?.headers.get("X-Edge-Class")).toBe("immutable");
  });

  it("never runs the render twice for one HEAD, and a second HEAD is a hit", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "live", body: "page" });
    await withEdgeCache(head(url), h.env, h.ctx, render);
    await h.settle();
    expect(render).toHaveBeenCalledTimes(1);
    const second = await withEdgeCache(head(url), h.env, h.ctx, render);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("also renders once, and answers, when the cache cannot be read or written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(caches.default, "match").mockRejectedValue(new Error("cache read"));
    vi.spyOn(caches.default, "put").mockRejectedValue(new Error("cache write"));
    const h = harness();
    const render = renderOf({ cls: "immutable", body: "page" });
    const response = await withEdgeCache(head(pageUrl()), h.env, h.ctx, render);
    await h.settle();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("stores a body that streams in after the answer, and still answers without it", async () => {
    const h = harness();
    const url = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const render = renderOf(() => {
      const encoder = new TextEncoder();
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          controller.enqueue(encoder.encode(`part ${++sent};`));
          if (sent === 3) controller.close();
        },
      });
      return answer({ cls: "live", body });
    });
    const response = await withEdgeCache(head(url), h.env, h.ctx, render);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    await h.settle();
    const next = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(next.headers.get("X-Cache")).toBe("HIT");
    expect(await next.text()).toBe("part 1;part 2;part 3;");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("serves a stale copy without its body while one GET render refreshes it", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf((call) => ({ cls: "live", body: `render ${call}` }));
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    advance(10_000);

    const stale = await withEdgeCache(head(url), h.env, h.ctx, render);
    expect(stale.headers.get("X-Cache")).toBe("STALE");
    expect(await stale.text()).toBe("");
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]![1]!.method).toBe("GET");
    const fresh = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(fresh.headers.get("X-Cache")).toBe("HIT");
    expect(await fresh.text()).toBe("render 2");
  });

  it("answers a stored 404 of class short, and a stored redirect, with their status and headers", async () => {
    const h = harness();
    const missing = pageUrl("/xrpl/ledger/nope");
    const moved = pageUrl("/xrpl/tx/abc");
    const notFound = renderOf({ cls: "short", status: 404, body: "not found" });
    const redirect = renderOf({ cls: "immutable", status: 302, headers: { Location: "/xrpl/tx/ABC" } });
    await withEdgeCache(get(missing), h.env, h.ctx, notFound);
    await withEdgeCache(get(moved), h.env, h.ctx, redirect);
    await h.settle();

    const a = await withEdgeCache(head(missing), h.env, h.ctx, notFound);
    const b = await withEdgeCache(head(moved), h.env, h.ctx, redirect);
    expect([a.status, a.headers.get("X-Cache"), await a.text()]).toEqual([404, "HIT", ""]);
    expect([b.status, b.headers.get("X-Cache"), b.headers.get("Location")]).toEqual([302, "HIT", "/xrpl/tx/ABC"]);
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("stores nothing for a degraded answer or an error, and answers without a body", async () => {
    const h = harness();
    const degradedUrl = pageUrl("/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    const degraded = vi.fn(async (mark?: DegradedMark) => {
      mark?.mark("node down");
      return answer({ cls: "live", body: "partial" });
    });
    const response = await withEdgeCache(head(degradedUrl), h.env, h.ctx, degraded);
    await h.settle();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(await caches.default.match(edgeCacheKey(degradedUrl, cacheGeneration(h.env)))).toBeUndefined();

    const errorUrl = pageUrl();
    const failing = renderOf({ cls: "immutable", status: 410, body: "gone" });
    const gone = await withEdgeCache(head(errorUrl), h.env, h.ctx, failing);
    await h.settle();
    expect(gone.status).toBe(410);
    expect(await gone.text()).toBe("");
    expect(await caches.default.match(edgeCacheKey(errorUrl, cacheGeneration(h.env)))).toBeUndefined();
  });

  it("is refused with a 429 without a body when the visitor is over the limit, and renders nothing", async () => {
    const h = harness();
    h.limit.mockResolvedValue({ success: false });
    const render = renderOf({ cls: "live" });
    const response = await withEdgeCache(head(pageUrl()), h.env, h.ctx, render);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(await response.text()).toBe("");
    expect(render).not.toHaveBeenCalled();
  });

  it("is answered with the stored copy, however old, when the render fails, and with the 503 page otherwise, both without a body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    const url = pageUrl("/xrpl");
    await withEdgeCache(get(url), h.env, h.ctx, renderOf({ cls: "live", body: "good page" }));
    await h.settle();
    advance(3_600_000);
    const throwing = vi.fn(async () => {
      throw new Error("boom");
    });
    const stale = await withEdgeCache(head(url), h.env, h.ctx, throwing);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("X-Cache")).toBe("STALE");
    expect(await stale.text()).toBe("");

    const none = await withEdgeCache(head(pageUrl("/xrpl")), h.env, h.ctx, throwing);
    expect(none.status).toBe(503);
    expect(none.headers.get("Retry-After")).toBe("30");
    expect(await none.text()).toBe("");
  });

  it("is left alone at the root, where the redirect depends on a cookie: it is rendered as the HEAD it is, and not stored", async () => {
    const h = harness();
    const url = "https://explorer.test/";
    const render = renderOf({ cls: "immutable", status: 302, headers: { Location: "/xahau" } });
    const response = await withEdgeCache(head(url), h.env, h.ctx, render);
    await h.settle();
    expect(response.status).toBe(302);
    expect(response.headers.get("X-Cache")).toBe("BYPASS");
    expect(render.mock.calls[0]![1]!.method).toBe("HEAD");
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();
    expect(h.limit).not.toHaveBeenCalled();
  });
});

describe("what skips the cache", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("a %s request", async (method) => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "immutable" });
    for (let i = 0; i < 2; i++) {
      const response = await withEdgeCache(get(url, {}, method), h.env, h.ctx, render);
      expect(response.headers.get("X-Cache")).toBe("BYPASS");
      expectNoInternalHeaders(response);
    }
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();
    // It cannot be answered from a copy a GET stored, either.
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    const after = await withEdgeCache(get(url, {}, method), h.env, h.ctx, render);
    expect(after.headers.get("X-Cache")).toBe("BYPASS");
  });

  it.each(["/", "/?x=1", "/_.data"])("the redirect at %s (its target depends on a cookie)", async (path) => {
    const h = harness();
    const url = `https://explorer.test${path}`;
    const render = renderOf({ cls: "immutable", status: 302, headers: { Location: "/xahau" } });
    for (let i = 0; i < 2; i++) {
      const response = await withEdgeCache(get(url), h.env, h.ctx, render);
      expect(response.status).toBe(302);
      expect(response.headers.get("X-Cache")).toBe("BYPASS");
      expectNoInternalHeaders(response);
    }
    await h.settle();
    expect(render).toHaveBeenCalledTimes(2);
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();
    // And no visitor limit: a redirect costs nothing.
    expect(h.limit).not.toHaveBeenCalled();
  });

  it("only the root is skipped: /xrpl is a page like any other", async () => {
    const h = harness();
    const url = "https://explorer.test/xrpl-" + ++pages;
    const render = renderOf({ cls: "live" });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect((await withEdgeCache(get(url), h.env, h.ctx, render)).headers.get("X-Cache")).toBe("HIT");
  });

  it("answers a skipped request with the 503 page when the render throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    const response = await withEdgeCache(get("https://explorer.test/"), h.env, h.ctx, async () => {
      throw new Error("boom");
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
});

describe("the visitor limit", () => {
  it("is consulted on a miss, by the address Cloudflare saw", async () => {
    const h = harness();
    const render = renderOf({ cls: "live" });
    await withEdgeCache(get(pageUrl(), { "CF-Connecting-IP": "203.0.113.9" }), h.env, h.ctx, render);
    expect(h.limit).toHaveBeenCalledTimes(1);
    expect(h.limit).toHaveBeenCalledWith({ key: "203.0.113.9" });
  });

  it("uses one fixed key when there is no address (local development, tests)", async () => {
    const h = harness();
    const render = renderOf({ cls: "live" });
    await withEdgeCache(get(pageUrl()), h.env, h.ctx, render);
    await withEdgeCache(get(pageUrl()), h.env, h.ctx, render);
    expect(h.limit).toHaveBeenCalledTimes(2);
    const [first, second] = h.limit.mock.calls.map(([options]) => options.key);
    expect(first).toBe(second);
    expect(first).toMatch(/\S/);
  });

  it("is not consulted when the copy is fresh, or stale and being refreshed", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf({ cls: "live" });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(h.limit).toHaveBeenCalledTimes(1);

    await withEdgeCache(get(url), h.env, h.ctx, render); // HIT
    advance(10_000);
    const stale = await withEdgeCache(get(url), h.env, h.ctx, render); // STALE
    await h.settle();
    expect(stale.headers.get("X-Cache")).toBe("STALE");
    expect(h.limit).toHaveBeenCalledTimes(1);
  });

  it("answers 429 with Retry-After: 10 when it refuses, and does not render or store", async () => {
    const h = harness();
    h.limit.mockResolvedValue({ success: false });
    const url = pageUrl();
    const render = renderOf({ cls: "immutable" });

    const response = await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    // A client-side navigation gets this page as the text of an ErrorResponse, without its headers: the wait is in the page too (RouteErrorScreen).
    expect(html).toContain('<meta name="retry-after" content="10">');
    expect(html).toContain('<a href="/">');
    expect(html).toContain("#F3F4F7");
    expect(html).toContain("#F2F3F5");
    expect(render).not.toHaveBeenCalled();
    expect(await caches.default.match(edgeCacheKey(url, cacheGeneration(h.env)))).toBeUndefined();
  });

  it("refuses a visitor whose stored copy is too old to serve stale, and renders nothing for them", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf({ cls: "live" });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    advance(60_000);
    h.limit.mockResolvedValue({ success: false });
    const response = await withEdgeCache(get(url), h.env, h.ctx, render);
    expect(response.status).toBe(429);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("limits requests that never hit the cache, except the root redirect", async () => {
    const h = harness();
    h.limit.mockResolvedValue({ success: false });
    const render = renderOf({ cls: "live" });
    const response = await withEdgeCache(get(pageUrl(), {}, "POST"), h.env, h.ctx, render);
    expect(response.status).toBe(429);
    expect(render).not.toHaveBeenCalled();
  });

  it("lets the visitor through when the limiter itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    h.limit.mockRejectedValue(new Error("limiter down"));
    const render = renderOf({ cls: "live" });
    const response = await withEdgeCache(get(pageUrl()), h.env, h.ctx, render);
    expect(response.status).toBe(200);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("the cache failing", () => {
  it("still renders when the cache cannot be read or written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(caches.default, "match").mockRejectedValue(new Error("cache read"));
    vi.spyOn(caches.default, "put").mockRejectedValue(new Error("cache write"));
    const h = harness();
    const render = renderOf({ cls: "immutable", body: "page" });
    const response = await withEdgeCache(get(pageUrl()), h.env, h.ctx, render);
    await h.settle();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("page");
    expect(response.headers.get("X-Cache")).toBe("MISS");
  });
});

describe("createSubrequestCache", () => {
  const key = (suffix: string) => `GET https://xrpl.data.example.invalid/v2/ledgers/${suffix}-${++pages}`;

  it("loads on a miss and answers the next call from the cache", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    const k = key("107695660");
    const load = vi.fn(async () => ({ ledger_index: 107695660, hash: "ABC" }));

    expect(await cache.json(k, "immutable", load)).toEqual({ ledger_index: 107695660, hash: "ABC" });
    await h.settle();
    expect(await cache.json(k, "immutable", load)).toEqual({ ledger_index: 107695660, hash: "ABC" });
    expect(load).toHaveBeenCalledTimes(1);
    // The cache is shared by every request: another instance, which is how each request gets its own, hits too.
    const another = createSubrequestCache(harness().ctx, "build-1");
    expect(await another.json(k, "immutable", load)).toEqual({ ledger_index: 107695660, hash: "ABC" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("stores the value under the class's TTL, or the override", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    const stored: Record<string, string | null> = {};
    const put = caches.default.put.bind(caches.default);
    vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      stored[new URL(typeof request === "string" ? request : (request as Request).url).pathname] =
        (response as Response).headers.get("Cache-Control");
      return put(request, response);
    });
    await cache.json(key("a"), "live", async () => 1);
    await cache.json(key("b"), "slow", async () => 2);
    await cache.json(key("c"), "live", async () => 3, 60);
    await cache.json(key("d"), "immutable", async () => 4);
    // The home page's calls: one second, so that a page that follows the chain reads an answer about as old as the ledger.
    await cache.json(key("e"), "live-home", async () => 5);
    await h.settle();
    expect(Object.values(stored).sort()).toEqual(
      ["public, max-age=5", "public, max-age=3600", "public, max-age=60", "public, max-age=31536000", "public, max-age=1"].sort(),
    );
  });

  it("never stores a load that failed, and the next call loads again", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    const k = key("500");
    const failing = vi.fn(async (): Promise<number> => {
      throw new Error("upstream 500");
    });
    await expect(cache.json(k, "immutable", failing)).rejects.toThrow("upstream 500");
    await h.settle();
    const working = vi.fn(async () => 42);
    expect(await cache.json(k, "immutable", working)).toBe(42);
    expect(working).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("keeps keys apart exactly as given: another URL, another body, another case", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    const base = `https://s1.ripple.com:51234/#${++pages}`;
    const keys = [
      `POST ${base} {"method":"tx","params":[{"transaction":"AB"}]}`,
      `POST ${base} {"method":"tx","params":[{"transaction":"ab"}]}`,
      `POST ${base} {"method":"ledger","params":[{"transaction":"AB"}]}`,
      `POST https://xahau.network/#${pages} {"method":"tx","params":[{"transaction":"AB"}]}`,
      "x".repeat(5000),
      "x".repeat(5000) + "y",
    ];
    for (const [i, k] of keys.entries()) await cache.json(k, "slow", async () => i);
    await h.settle();
    for (const [i, k] of keys.entries()) {
      expect(await cache.json(k, "slow", async () => -1), k.slice(0, 40)).toBe(i);
    }
  });

  it("stores falsy values and null", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    for (const value of [0, "", false, null, [], {}]) {
      const k = key("falsy");
      await cache.json(k, "slow", async () => value);
      await h.settle();
      expect(await cache.json(k, "slow", async () => "reloaded")).toEqual(value);
    }
  });

  it("includes the build ID: another build loads again", async () => {
    const h = harness();
    const k = key("build");
    await createSubrequestCache(h.ctx, "build-1").json(k, "slow", async () => "one");
    await h.settle();
    expect(await createSubrequestCache(h.ctx, "build-2").json(k, "slow", async () => "two")).toBe("two");
    expect(await createSubrequestCache(h.ctx, "build-1").json(k, "slow", async () => "again")).toBe("one");
  });

  // Through `createLoadContext`, which is what builds the cache of a request: it must key with `BUILD_ID` and not with `cacheGeneration`.
  it("keeps the build ID in its key whatever the switches are: upstream data is not changed by a switch", async () => {
    const k = key("switch");
    const on = harness({ AMM_DATA: "on" });
    const off = harness({ AMM_DATA: "off" });
    expect(cacheGeneration(on.env)).not.toBe(cacheGeneration(off.env));
    await getSubrequestCache(createLoadContext(on.env, on.ctx)).json(k, "live", async () => "live");
    await on.settle();
    const load = vi.fn(async () => "again");
    expect(await getSubrequestCache(createLoadContext(off.env, off.ctx)).json(k, "live", load)).toBe("live");
    expect(load).not.toHaveBeenCalled();

    // And it is the build that is in the key: another build loads again.
    const other = harness({ BUILD_ID: "build-b" });
    expect(await getSubrequestCache(createLoadContext(other.env, other.ctx)).json(k, "live", load)).toBe("again");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not wait for the store", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    await cache.json(key("wait"), "slow", async () => 1);
    expect(h.waiting).toBe(1);
  });

  it("does not store with a TTL that is zero or negative, or let a failing cache fail the call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    const k = key("zero");
    await cache.json(k, "slow", async () => 1, 0);
    await cache.json(k, "slow", async () => 1, -1);
    expect(h.waiting).toBe(0);

    vi.spyOn(caches.default, "match").mockRejectedValue(new Error("read"));
    vi.spyOn(caches.default, "put").mockRejectedValue(new Error("write"));
    expect(await cache.json(key("broken"), "slow", async () => "fine")).toBe("fine");
    await h.settle();
  });

  it("answers from a load that returns something JSON cannot hold, without storing it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    expect(await cache.json(key("big"), "slow", async () => 10n)).toBe(10n);
    expect(await cache.json(key("undef"), "slow", async () => undefined)).toBeUndefined();
    await h.settle();
  });
});

// The failure hold (spec 1.7): a polled call that failed is remembered in memory for a few seconds, so that the open tabs' next beats do not
// all reach an upstream that is down. The clock is `Date` only (the top of the file); a key of its own for each case, because the hold is
// per Worker instance and the Cache API outlives a test.
describe("the failure hold", () => {
  const key = (name: string) => `GET https://xrpl.data.example.invalid/v2/hold/${name}-${++pages}`;
  const hold = { holdFailure: true };
  const failing = (error: unknown) =>
    vi.fn(async (): Promise<number> => {
      throw error;
    });
  const held = (cache: ReturnType<typeof createSubrequestCache>, k: string, load: () => Promise<number>) =>
    cache.json(k, "live", load, undefined, hold);

  it.each<UpstreamErrorKind>(["server", "timeout", "network", "rate_limited"])("holds a %s failure for 5 s: the same error, and the upstream is not asked", async (kind) => {
    const cache = createSubrequestCache(harness().ctx, "build-1");
    const k = key(kind);
    const error = new UpstreamError(kind);
    const load = failing(error);

    await expect(held(cache, k, load)).rejects.toBe(error);
    advance(4_999);
    await expect(held(cache, k, load)).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(1);

    advance(2);
    await expect(held(cache, k, load)).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("holds a rate-limited answer for its Retry-After, at most 30 s", async () => {
    const cache = createSubrequestCache(harness().ctx, "build-1");
    const short = failing(new UpstreamError("rate_limited", "x", { retryAfter: 12 }));
    const long = failing(new UpstreamError("rate_limited", "x", { retryAfter: 90 }));
    const [a, b] = [key("retry-12"), key("retry-90")];

    await expect(held(cache, a, short)).rejects.toThrow("x");
    await expect(held(cache, b, long)).rejects.toThrow("x");
    advance(11_999);
    await expect(held(cache, a, short)).rejects.toThrow("x");
    expect(short).toHaveBeenCalledTimes(1);
    advance(2);
    await expect(held(cache, a, short)).rejects.toThrow("x");
    expect(short).toHaveBeenCalledTimes(2);

    // 30 s after the first failure of b (12 s in, now): held to 29,999 ms, free at 30,001 ms.
    advance(17_998);
    await expect(held(cache, b, long)).rejects.toThrow("x");
    expect(long).toHaveBeenCalledTimes(1);
    advance(2);
    await expect(held(cache, b, long)).rejects.toThrow("x");
    expect(long).toHaveBeenCalledTimes(2);
  });

  // A 429 is held at least as long as any other failure: a Retry-After of 0 or 1 s must not leave a failing upstream open to every beat.
  it.each([0, 1])("holds a rate-limited answer with a Retry-After of %i s for 5 s, as long as any other failure", async (retryAfter) => {
    const cache = createSubrequestCache(harness().ctx, "build-1");
    const load = failing(new UpstreamError("rate_limited", "x", { retryAfter }));
    const k = key(`retry-${retryAfter}`);

    await expect(held(cache, k, load)).rejects.toThrow("x");
    advance(4_999);
    await expect(held(cache, k, load)).rejects.toThrow("x");
    expect(load).toHaveBeenCalledTimes(1);
    advance(2);
    await expect(held(cache, k, load)).rejects.toThrow("x");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never holds a thing that is not there, a request that was refused, or an error that is not an upstream's", async () => {
    const cache = createSubrequestCache(harness().ctx, "build-1");
    for (const error of [new UpstreamError("not_found"), new UpstreamError("bad_request"), new TypeError("a bug")]) {
      const load = failing(error);
      const k = key("never");
      await expect(held(cache, k, load)).rejects.toBe(error);
      await expect(held(cache, k, load)).rejects.toBe(error);
      expect(load, String(error)).toHaveBeenCalledTimes(2);
    }
  });

  it("holds nothing for a call that did not ask for it, not even for a later call that does", async () => {
    const cache = createSubrequestCache(harness().ctx, "build-1");
    const k = key("not-asked");
    const load = failing(new UpstreamError("server"));

    await expect(cache.json(k, "live", load)).rejects.toThrow();
    await expect(held(cache, k, load)).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(2);
    // The call that asked for it is held now.
    await expect(held(cache, k, load)).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(2);
    // And the one that does not ask still goes through.
    await expect(cache.json(k, "live", load)).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("holds at the most 256 keys, the oldest going first", async () => {
    const cache = createSubrequestCache(harness().ctx, "build-1");
    const keys = Array.from({ length: 257 }, (_, i) => key(`many-${i}`));
    const loads = keys.map(() => failing(new UpstreamError("server")));
    for (const [i, k] of keys.entries()) await expect(held(cache, k, loads[i]!)).rejects.toThrow();

    // The last is still held; the first has been forgotten and loads again.
    await expect(held(cache, keys[256]!, loads[256]!)).rejects.toThrow();
    expect(loads[256]).toHaveBeenCalledTimes(1);
    await expect(held(cache, keys[0]!, loads[0]!)).rejects.toThrow();
    expect(loads[0]).toHaveBeenCalledTimes(2);
  });

  it("makes a key that fails again the newest, so that a full table forgets another first", async () => {
    const cache = createSubrequestCache(harness().ctx, "build-1");
    const first = key("renewed");
    const firstLoad = failing(new UpstreamError("server"));
    // The others are held 30 s, so that they are still held when `first` fails again: what is forgotten is told by the table, not by the clock.
    const fillers = Array.from({ length: 255 }, (_, i) => ({
      k: key(`filler-${i}`),
      load: failing(new UpstreamError("rate_limited", "x", { retryAfter: 30 })),
    }));
    // 256 keys, `first` the oldest (every key held before is gone).
    await expect(held(cache, first, firstLoad)).rejects.toThrow();
    for (const { k, load } of fillers) await expect(held(cache, k, load)).rejects.toThrow();

    // It fails again once its hold is over: it moves to the end, and one more key then pushes out the oldest of the others.
    advance(6_000);
    await expect(held(cache, first, firstLoad)).rejects.toThrow();
    expect(firstLoad).toHaveBeenCalledTimes(2);
    await expect(held(cache, key("one-more"), failing(new UpstreamError("server")))).rejects.toThrow();

    await expect(held(cache, first, firstLoad)).rejects.toThrow();
    expect(firstLoad).toHaveBeenCalledTimes(2);
    await expect(held(cache, fillers[1]!.k, fillers[1]!.load)).rejects.toThrow();
    expect(fillers[1]!.load).toHaveBeenCalledTimes(1);
    await expect(held(cache, fillers[0]!.k, fillers[0]!.load)).rejects.toThrow();
    expect(fillers[0]!.load).toHaveBeenCalledTimes(2);
  });

  it("applies on a call that is not kept too (a TTL of zero), and writes nothing to the Cache API", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    const k = key("zero");
    const load = failing(new UpstreamError("timeout"));

    await expect(cache.json(k, "live", load, 0, hold)).rejects.toThrow();
    await expect(cache.json(k, "live", load, 0, hold)).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(1);
    expect(h.waiting).toBe(0);
  });

  // The probe: once a hold is over, one call goes to the upstream and the others keep the held error until it has settled. A TTL of zero, so
  // that `load` is called in the same turn as `json` and nothing but the hold decides who calls (the Cache API is covered by the cases above).
  describe("when the hold is over", () => {
    const probing = (cache: ReturnType<typeof createSubrequestCache>, k: string, load: () => Promise<number>) =>
      cache.json(k, "live", load, 0, hold);
    /** A `load` that settles when the test says so. */
    function pending() {
      let resolve!: (value: number) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<number>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { load: vi.fn(() => promise), resolve, reject };
    }
    /** Fails once, then lets the hold lapse. */
    async function lapsed(cache: ReturnType<typeof createSubrequestCache>, k: string, error: UpstreamError) {
      await expect(probing(cache, k, failing(error))).rejects.toBe(error);
      advance(5_001);
    }

    it("lets one call through to an upstream that is slow to fail, and the others keep the held error until it has settled", async () => {
      const cache = createSubrequestCache(harness().ctx, "build-1");
      const k = key("probe");
      const error = new UpstreamError("timeout");
      await lapsed(cache, k, error);

      const probe = pending();
      const first = probing(cache, k, probe.load);
      expect(probe.load).toHaveBeenCalledTimes(1);

      // The probe is still waiting, as an upstream that times out does for 5 s: every call in that time gets the held error, and none calls.
      const others = Array.from({ length: 12 }, () => failing(new UpstreamError("server")));
      for (const load of others) {
        advance(300);
        await expect(probing(cache, k, load)).rejects.toBe(error);
      }
      for (const load of others) expect(load).not.toHaveBeenCalled();
      expect(probe.load).toHaveBeenCalledTimes(1);

      const failed = new UpstreamError("timeout", "the probe's own");
      probe.reject(failed);
      await expect(first).rejects.toBe(failed);
    });

    it("holds the failure the probe found for a full hold from the moment it failed, and probes again after it", async () => {
      const cache = createSubrequestCache(harness().ctx, "build-1");
      const k = key("probe-fails");
      await lapsed(cache, k, new UpstreamError("timeout"));

      const probe = pending();
      const first = probing(cache, k, probe.load);
      advance(4_000);
      const found = new UpstreamError("server", "found by the probe");
      probe.reject(found);
      await expect(first).rejects.toBe(found);

      // Held for 5 s from now, with the error the probe found.
      const later = failing(new UpstreamError("timeout"));
      advance(4_999);
      await expect(probing(cache, k, later)).rejects.toBe(found);
      expect(later).not.toHaveBeenCalled();

      // And then the next call is a probe again.
      advance(2);
      const next = pending();
      const second = probing(cache, k, next.load);
      expect(next.load).toHaveBeenCalledTimes(1);
      await expect(probing(cache, k, later)).rejects.toBe(found);
      expect(later).not.toHaveBeenCalled();
      next.resolve(1);
      expect(await second).toBe(1);
    });

    it("forgets the failure when the probe is answered: the next call is not held", async () => {
      const cache = createSubrequestCache(harness().ctx, "build-1");
      const k = key("probe-answers");
      await lapsed(cache, k, new UpstreamError("server"));

      const probe = pending();
      const first = probing(cache, k, probe.load);
      probe.resolve(3);
      expect(await first).toBe(3);

      const next = vi.fn(async () => 4);
      expect(await probing(cache, k, next)).toBe(4);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["a thing that is not there", new UpstreamError("not_found")],
      ["a request that was refused", new UpstreamError("bad_request")],
      ["an error that is not an upstream's", new TypeError("a bug")],
    ])("forgets the failure when the probe finds %s", async (_name, error) => {
      const cache = createSubrequestCache(harness().ctx, "build-1");
      const k = key("probe-other");
      await lapsed(cache, k, new UpstreamError("server"));

      await expect(probing(cache, k, failing(error))).rejects.toBe(error);

      const next = vi.fn(async () => 5);
      expect(await probing(cache, k, next)).toBe(5);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("lets another call probe when the probe has not settled within a hold's length, so that a load that never ends does not close the key for good", async () => {
      const cache = createSubrequestCache(harness().ctx, "build-1");
      const k = key("probe-hangs");
      const error = new UpstreamError("timeout");
      await lapsed(cache, k, error);

      const hung = pending();
      void probing(cache, k, hung.load).catch(() => {});
      advance(4_999);
      const early = failing(new UpstreamError("server"));
      await expect(probing(cache, k, early)).rejects.toBe(error);
      expect(early).not.toHaveBeenCalled();

      advance(2);
      const second = pending();
      const next = probing(cache, k, second.load);
      expect(second.load).toHaveBeenCalledTimes(1);
      await expect(probing(cache, k, early)).rejects.toBe(error);
      expect(early).not.toHaveBeenCalled();
      second.resolve(6);
      expect(await next).toBe(6);
    });

    it("gives a rate-limited key its Retry-After again as the probe's window, and not less than 5 s", async () => {
      const cache = createSubrequestCache(harness().ctx, "build-1");
      const k = key("probe-limited");
      const error = new UpstreamError("rate_limited", "x", { retryAfter: 12 });
      await expect(probing(cache, k, failing(error))).rejects.toBe(error);
      advance(12_001);

      const probe = pending();
      const first = probing(cache, k, probe.load);
      advance(11_999);
      const early = failing(new UpstreamError("server"));
      await expect(probing(cache, k, early)).rejects.toBe(error);
      expect(early).not.toHaveBeenCalled();
      probe.resolve(7);
      expect(await first).toBe(7);
    });

    it("probes through the Cache API too: the call that finds a stored answer takes it, and the one that does not is the probe", async () => {
      const h = harness();
      const cache = createSubrequestCache(h.ctx, "build-1");
      const k = key("probe-kept");
      const error = new UpstreamError("timeout");
      await expect(held(cache, k, failing(error))).rejects.toBe(error);
      advance(5_001);

      const probe = pending();
      const first = held(cache, k, probe.load);
      await vi.waitFor(() => expect(probe.load).toHaveBeenCalledTimes(1), { interval: 1 });
      const others = [failing(new UpstreamError("server")), failing(new UpstreamError("server"))];
      for (const load of others) await expect(held(cache, k, load)).rejects.toBe(error);
      for (const load of others) expect(load).not.toHaveBeenCalled();

      probe.resolve(8);
      expect(await first).toBe(8);
      await h.settle();
      // Answered and stored: the next call is the Cache API's.
      const next = vi.fn(async () => 9);
      expect(await held(cache, k, next)).toBe(8);
      expect(next).not.toHaveBeenCalled();
    });
  });

  it("reads the Cache API first: an answer stored by a call that did not ask for the hold is what a call that asks gets, while the hold lasts", async () => {
    const h = harness();
    const cache = createSubrequestCache(h.ctx, "build-1");
    const k = key("answered");

    await expect(held(cache, k, failing(new UpstreamError("server")))).rejects.toThrow();
    // Not asked to hold: it loads, and stores its answer.
    expect(await cache.json(k, "live", async () => 7)).toBe(7);
    await h.settle();

    const load = failing(new UpstreamError("server"));
    expect(await held(cache, k, load)).toBe(7);
    expect(load).not.toHaveBeenCalled();
  });
});

// In-flight sharing (E4 spec 2.7): a call that asks for `shareInFlight` waits for the load of its key that another request of this Worker instance is
// already running, and starts no load of its own. Each case has a key of its own (the flights and the hold are per instance, and the Cache API
// outlives a test), and each request has its own cache, as the Worker gives it: only the module's table of flights is shared.
describe("in-flight sharing", () => {
  const key = (name: string) => `GET https://xrpl.data.example.invalid/v2/accounts/rShared/analytics/${name}-${++pages}`;
  const share = { shareInFlight: true };
  const both = { holdFailure: true, shareInFlight: true };

  /** A request of the Worker: its own execution context and its own cache. */
  function request(buildId = "build-1") {
    const h = harness();
    return { cache: createSubrequestCache(h.ctx, buildId), settle: h.settle, handed: h.handed, get waiting() { return h.waiting; } };
  }

  /** The writes to the Cache API from now on, by the key of the subrequest; each goes through to the Cache API. */
  function writes() {
    return vi.spyOn(caches.default, "put");
  }

  /** A `load` that settles when the test says so. */
  function pending<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { load: vi.fn(() => promise), resolve, reject };
  }

  const failing = (error: unknown) =>
    vi.fn(async (): Promise<number> => {
      throw error;
    });

  /**
   * Counts the reads of the Cache API that have been answered. Waiting for `calls` of them is waiting until that many calls have read the cache,
   * missed, and so have joined the flight of their key or started it: a call that has not yet got that far cannot be told from one that never will.
   */
  function reads() {
    const match = caches.default.match.bind(caches.default);
    let answered = 0;
    vi.spyOn(caches.default, "match").mockImplementation(async (request, options) => {
      try {
        return await match(request, options);
      } finally {
        answered += 1;
      }
    });
    return async (calls: number) => {
      await vi.waitFor(() => expect(answered).toBe(calls), { interval: 1 });
      // One turn more: what a call does after its read is done in microtasks, which have run by the next timer.
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
  }

  it("calls load once for two concurrent loads of one key, and gives each caller equal values that are not the same object", async () => {
    const [a, b] = [request(), request()];
    const answered = reads();
    const k = key("two");
    const gate = pending<{ rows: number[]; total: { value: string } }>();
    const other = vi.fn(async () => ({ rows: [9], total: { value: "9" } }));

    const first = a.cache.json(k, "minute", gate.load, undefined, share);
    const second = b.cache.json(k, "minute", other, undefined, share);
    await answered(2);
    expect(gate.load).toHaveBeenCalledTimes(1);
    gate.resolve({ rows: [1, 2], total: { value: "3" } });

    const [x, y] = await Promise.all([first, second]);
    expect(x).toEqual({ rows: [1, 2], total: { value: "3" } });
    expect(y).toEqual(x);
    expect(y).not.toBe(x);
    expect(y.rows).not.toBe(x.rows);
    expect(other).not.toHaveBeenCalled();
    // One write, by the load that was made.
    await Promise.all([a.settle(), b.settle()]);
  });

  it("rejects both callers of a load that throws with the same UpstreamError, stores nothing, and loads again on the next call", async () => {
    const [a, b] = [request(), request()];
    const answered = reads();
    const put = writes();
    const k = key("throws");
    const error = new UpstreamError("server", "the analytics call failed");
    const gate = pending<number>();
    const other = vi.fn(async () => 2);

    const first = a.cache.json(k, "minute", gate.load, undefined, share);
    const second = b.cache.json(k, "minute", other, undefined, share);
    await answered(2);
    gate.reject(error);

    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    for (const outcome of outcomes) expect((outcome as PromiseRejectedResult).reason).toBe(error);
    expect(other).not.toHaveBeenCalled();
    // The one thing handed to `waitUntil` is the flight, by the request that started it, and it wrote nothing.
    expect([a.waiting, b.waiting]).toEqual([1, 0]);
    await a.settle();
    expect(put).not.toHaveBeenCalled();

    const next = vi.fn(async () => 3);
    expect(await a.cache.json(k, "minute", next, undefined, share)).toBe(3);
    expect(next).toHaveBeenCalledTimes(1);
    await a.settle();
  });

  it("forgets a flight when it has settled: a later call reads the stored entry without calling load", async () => {
    const [a, b] = [request(), request()];
    const k = key("settled");
    const load = vi.fn(async () => ({ n: 1 }));

    expect(await a.cache.json(k, "minute", load, undefined, share)).toEqual({ n: 1 });
    await a.settle();

    const later = vi.fn(async () => ({ n: 2 }));
    expect(await b.cache.json(k, "minute", later, undefined, share)).toEqual({ n: 1 });
    expect(later).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("calls load twice for two concurrent loads of one key that do not ask to share", async () => {
    const [a, b] = [request(), request()];
    const answered = reads();
    const k = key("not-asked");
    const [one, two] = [pending<number>(), pending<number>()];

    const first = a.cache.json(k, "minute", one.load);
    const second = b.cache.json(k, "minute", two.load);
    await answered(2);
    expect(one.load).toHaveBeenCalledTimes(1);
    expect(two.load).toHaveBeenCalledTimes(1);
    one.resolve(1);
    two.resolve(2);
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    await Promise.all([a.settle(), b.settle()]);
  });

  it("neither joins a flight nor is joined, for a call that does not ask to share", async () => {
    const [a, b, c] = [request(), request(), request()];
    const answered = reads();
    const k = key("one-sided");
    const flight = pending<number>();
    const alone = pending<number>();
    const joiner = vi.fn(async () => 99);

    const first = a.cache.json(k, "minute", flight.load, undefined, share);
    const unshared = b.cache.json(k, "minute", alone.load);
    const second = c.cache.json(k, "minute", joiner, undefined, share);
    await answered(3);
    expect(alone.load).toHaveBeenCalledTimes(1);
    expect(joiner).not.toHaveBeenCalled();
    flight.resolve(1);
    alone.resolve(2);
    expect(await Promise.all([first, unshared, second])).toEqual([1, 2, 1]);
    await Promise.all([a.settle(), b.settle(), c.settle()]);
  });

  it("shares a call that is not kept (a TTL of zero) too, writes nothing, and forgets the flight when it settles", async () => {
    const [a, b] = [request(), request()];
    const put = writes();
    const k = key("zero");
    const gate = pending<number>();
    const other = vi.fn(async () => 2);

    const first = a.cache.json(k, "minute", gate.load, 0, share);
    const second = b.cache.json(k, "minute", other, 0, share);
    expect(gate.load).toHaveBeenCalledTimes(1);
    gate.resolve(1);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    expect(other).not.toHaveBeenCalled();
    // The flight was in the waitUntil of the request that started it, and it wrote nothing.
    expect([a.waiting, b.waiting]).toEqual([1, 0]);
    await a.settle();
    expect(put).not.toHaveBeenCalled();

    // Nothing is stored and the flight is gone: the next call loads.
    const next = vi.fn(async () => 3);
    expect(await a.cache.json(k, "minute", next, 0, share)).toBe(3);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("serves a stored answer at once, ahead of a flight of the same key", async () => {
    const [a, b, c] = [request(), request(), request()];
    const answered = reads();
    const k = key("stored-first");
    const gate = pending<number>();

    // A flight of the key is running (its call asked to share, and was not stored yet) when another call stores an answer.
    const running = a.cache.json(k, "minute", gate.load, undefined, share);
    await answered(1);
    expect(await b.cache.json(k, "minute", async () => 5)).toBe(5);
    await b.settle();

    const load = vi.fn(async () => 6);
    expect(await c.cache.json(k, "minute", load, undefined, share)).toBe(5);
    expect(load).not.toHaveBeenCalled();
    gate.resolve(1);
    expect(await running).toBe(1);
    await a.settle();
  });

  it("throws a held failure on a miss without joining a flight or loading", async () => {
    const [a, b, c] = [request(), request(), request()];
    const answered = reads();
    const k = key("held");
    const error = new UpstreamError("timeout");
    await expect(a.cache.json(k, "minute", failing(error), undefined, both)).rejects.toBe(error);

    // A flight of the key is running (a call that does not ask for the hold made it).
    const gate = pending<number>();
    const running = b.cache.json(k, "minute", gate.load, undefined, share);
    await answered(2);
    expect(gate.load).toHaveBeenCalledTimes(1);

    const load = vi.fn(async () => 2);
    await expect(c.cache.json(k, "minute", load, undefined, both)).rejects.toBe(error);
    expect(load).not.toHaveBeenCalled();
    // It did not wait for the flight, which is still running.
    expect(gate.load).toHaveBeenCalledTimes(1);
    gate.resolve(1);
    expect(await running).toBe(1);
    await b.settle();
  });

  it("serves a stored answer during a hold, with shareInFlight set too", async () => {
    const [a, b] = [request(), request()];
    const k = key("stored-during-hold");
    expect(await a.cache.json(k, "minute", async () => ({ n: 1 }), undefined, share)).toEqual({ n: 1 });
    await a.settle();

    // A later load of the key fails (a call that is not kept does not read the Cache API) and the failure is held.
    const error = new UpstreamError("server");
    await expect(a.cache.json(k, "minute", failing(error), 0, both)).rejects.toBe(error);
    const held = vi.fn(async () => ({ n: 2 }));
    await expect(a.cache.json(k, "minute", held, 0, both)).rejects.toBe(error);
    expect(held).not.toHaveBeenCalled();

    const load = vi.fn(async () => ({ n: 3 }));
    expect(await b.cache.json(k, "minute", load, undefined, both)).toEqual({ n: 1 });
    expect(load).not.toHaveBeenCalled();
  });

  it("holds the failure of a shared load once, for every caller that joined it", async () => {
    const [a, b, c] = [request(), request(), request()];
    const answered = reads();
    const k = key("held-once");
    const error = new UpstreamError("server");
    const gate = pending<number>();
    const other = vi.fn(async () => 2);

    const first = a.cache.json(k, "minute", gate.load, undefined, both);
    const second = b.cache.json(k, "minute", other, undefined, both);
    await answered(2);
    gate.reject(error);
    const outcomes = await Promise.allSettled([first, second]);
    for (const outcome of outcomes) expect((outcome as PromiseRejectedResult).reason).toBe(error);

    const next = vi.fn(async () => 3);
    await expect(c.cache.json(k, "minute", next, undefined, both)).rejects.toBe(error);
    expect(next).not.toHaveBeenCalled();
    expect(gate.load).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("keeps the probe of a hold: when it is over one call loads, and the others keep the held error until it has settled", async () => {
    const [a, b] = [request(), request()];
    const k = key("probe");
    const error = new UpstreamError("timeout");
    await expect(a.cache.json(k, "minute", failing(error), undefined, both)).rejects.toBe(error);
    advance(5_001);

    const probe = pending<number>();
    const first = a.cache.json(k, "minute", probe.load, undefined, both);
    await vi.waitFor(() => expect(probe.load).toHaveBeenCalledTimes(1), { interval: 1 });

    // The probe is still waiting, as an upstream that times out does for 5 s: the others get the held error, and none loads or joins.
    const others = [failing(new UpstreamError("server")), failing(new UpstreamError("server"))];
    for (const load of others) await expect(b.cache.json(k, "minute", load, undefined, both)).rejects.toBe(error);
    for (const load of others) expect(load).not.toHaveBeenCalled();
    expect(probe.load).toHaveBeenCalledTimes(1);

    probe.resolve(8);
    expect(await first).toBe(8);
    await a.settle();
    // Answered and stored: the hold is gone, and the next call is the Cache API's.
    const next = vi.fn(async () => 9);
    expect(await b.cache.json(k, "minute", next, undefined, both)).toBe(8);
    expect(next).not.toHaveBeenCalled();
  });

  it("holds the failure the probe found, for the callers that joined it too", async () => {
    const [a, b] = [request(), request()];
    const k = key("probe-fails");
    await expect(a.cache.json(k, "minute", failing(new UpstreamError("timeout")), undefined, both)).rejects.toThrow();
    advance(5_001);

    // The hold is over, so the probe is the one call that goes on: a call that asked for no hold joins its flight.
    const probe = pending<number>();
    const answered = reads();
    const first = a.cache.json(k, "minute", probe.load, undefined, both);
    const joined = b.cache.json(k, "minute", vi.fn(async () => 1), undefined, share);
    await answered(2);
    const found = new UpstreamError("server", "found by the probe");
    probe.reject(found);
    const outcomes = await Promise.allSettled([first, joined]);
    for (const outcome of outcomes) expect((outcome as PromiseRejectedResult).reason).toBe(found);

    const later = vi.fn(async () => 2);
    await expect(a.cache.json(k, "minute", later, undefined, both)).rejects.toBe(found);
    expect(later).not.toHaveBeenCalled();
  });

  it("does not share between keys that differ by their TTL override, or between build ids", async () => {
    const answered = reads();
    const k = key("distinct");
    const calls = [
      { cache: request("build-1").cache, key: k },
      { cache: request("build-1").cache, key: `${k} [kept 300 s]` },
      { cache: request("build-2").cache, key: k },
    ];
    const gates = calls.map(() => pending<string>());

    const results = calls.map(({ cache, key: callKey }, i) => cache.json(callKey, "minute", gates[i]!.load, undefined, share));
    await answered(3);
    for (const gate of gates) expect(gate.load).toHaveBeenCalledTimes(1);
    gates.forEach((gate, i) => gate.resolve(`answer ${i}`));
    expect(await Promise.all(results)).toEqual(["answer 0", "answer 1", "answer 2"]);
  });

  // A load whose request is gone never settles. It must not close its key for good (nor the probe of a hold, which `holdFailure` promises is not so).
  it("stops joining a flight that has not settled in 30 s: the next call starts its own, and the old flight's end does not remove it", async () => {
    const [a, b, c, d] = [request(), request(), request(), request()];
    const k = key("hung");
    // A TTL of zero: no read of the Cache API stands between a call and its flight, so that the calls below are in order.
    const hung = pending<number>();
    const first = a.cache.json(k, "minute", hung.load, 0, share);

    // At the limit it is still joined.
    advance(SHARED_LOAD_MAX_AGE_MS);
    const early = vi.fn(async () => 1);
    const second = b.cache.json(k, "minute", early, 0, share);
    expect(early).not.toHaveBeenCalled();

    advance(1);
    const fresh = pending<number>();
    const third = c.cache.json(k, "minute", fresh.load, 0, share);
    expect(fresh.load).toHaveBeenCalledTimes(1);

    // The old flight ends at last. The newer one is still in the table: the next call joins it.
    hung.resolve(1);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    const joiner = vi.fn(async () => 9);
    const fourth = d.cache.json(k, "minute", joiner, 0, share);
    expect(joiner).not.toHaveBeenCalled();
    fresh.resolve(2);
    expect(await Promise.all([third, fourth])).toEqual([2, 2]);
    expect(early).not.toHaveBeenCalled();
  });

  it("rejects a shared answer that JSON cannot carry, and stores nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = request();
    const put = writes();
    await expect(a.cache.json(key("big"), "minute", async () => 10n, undefined, share)).rejects.toThrow();
    await expect(a.cache.json(key("undefined"), "minute", async () => undefined, undefined, share)).rejects.toThrow(TypeError);
    await a.settle();
    expect(put).not.toHaveBeenCalled();
  });

  // A visitor who leaves (a period clicked while a heavy account's counterparties load, a tab closed) cancels the work of their request that is not in
  // `waitUntil`. Were the flight only that, every request that joined it would wait on a load that never ends, until it is 30 s old.
  it("hands the flight to the waitUntil of the request that starts it, as it starts: the joiners hand on nothing, and it is kept to its end", async () => {
    const [a, b] = [request(), request()];
    const answered = reads();
    const k = key("kept");
    const gate = pending<number>();
    const joiner = vi.fn(async () => 2);

    const first = a.cache.json(k, "minute", gate.load, undefined, share);
    const second = b.cache.json(k, "minute", joiner, undefined, share);
    await answered(2);
    // The load is still out, and it is in the leader's waitUntil already.
    expect(gate.load).toHaveBeenCalledTimes(1);
    expect([a.handed.length, b.handed.length]).toEqual([1, 0]);
    let kept = false;
    void a.handed[0]!.then(() => (kept = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kept).toBe(false);

    gate.resolve(1);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    expect(joiner).not.toHaveBeenCalled();
    // What it handed on ends once the flight has: its load, and its write.
    await a.settle();
    expect(kept).toBe(true);
    expect(b.handed).toEqual([]);
  });

  it("hands waitUntil a flight that fails without a rejection, a flight of a call that is not kept too", async () => {
    const a = request();
    const kept = pending<number>();
    const failing = a.cache.json(key("kept-failing"), "minute", kept.load, undefined, share);
    // A call that is not kept reads no Cache API: its flight is handed on as the call is made.
    const unkept = pending<number>();
    const zero = a.cache.json(key("kept-failing-zero"), "minute", unkept.load, 0, share);
    await vi.waitFor(() => expect(kept.load).toHaveBeenCalledTimes(1), { interval: 1 });
    expect(a.handed).toHaveLength(2);

    const error = new UpstreamError("server");
    kept.reject(error);
    unkept.reject(error);
    await expect(failing).rejects.toBe(error);
    await expect(zero).rejects.toBe(error);
    for (const handed of a.handed) await expect(handed).resolves.toBeUndefined();
  });

  // Between the answer and its write to the Cache API, a call that misses the Cache API must still find the flight, or it loads again.
  it("keeps a flight in the table until its write has settled: the answer is there at once, and a call in between joins it", async () => {
    const [a, b, c] = [request(), request(), request()];
    const k = key("write-gap");
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Each write waits until the test lets it settle, and then fails, so that the Cache API keeps nothing and only the table can answer.
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    vi.spyOn(caches.default, "put").mockImplementation(async () => {
      await landed;
      throw new Error("the write failed");
    });

    const load = vi.fn(async () => ({ n: 1 }));
    expect(await a.cache.json(k, "minute", load, undefined, share)).toEqual({ n: 1 });
    // The leader has its answer while the write is out. A call now misses the Cache API and joins the flight, whose answer is there.
    const between = vi.fn(async () => ({ n: 2 }));
    expect(await b.cache.json(k, "minute", between, undefined, share)).toEqual({ n: 1 });
    expect(between).not.toHaveBeenCalled();

    // Once the write has settled (it failed: the Cache API has nothing), the flight has left the table, and the next call loads.
    land();
    await a.settle();
    const after = vi.fn(async () => ({ n: 3 }));
    expect(await c.cache.json(k, "minute", after, undefined, share)).toEqual({ n: 3 });
    expect(after).toHaveBeenCalledTimes(1);
    await c.settle();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
