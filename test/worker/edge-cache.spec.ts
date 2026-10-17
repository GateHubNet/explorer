import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_CLASSES, type CacheClass } from "../../app/server/cache-class";
import { createSubrequestCache, edgeCacheKey, withEdgeCache } from "../../app/server/edge-cache";
import type { Env } from "../../app/server/env";

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
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
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
  return vi.fn(async () => {
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

  it("includes the build ID in the key: another build misses", async () => {
    const url = pageUrl();
    const one = harness({ BUILD_ID: "build-a" });
    const two = harness({ BUILD_ID: "build-b" });
    const render = renderOf((n) => ({ cls: "immutable", body: `render ${n}` }));

    await withEdgeCache(get(url), one.env, one.ctx, render);
    await one.settle();
    const sameBuild = await withEdgeCache(get(url), one.env, one.ctx, render);
    const otherBuild = await withEdgeCache(get(url), two.env, two.ctx, render);
    await two.settle();
    expect(sameBuild.headers.get("X-Cache")).toBe("HIT");
    expect(await sameBuild.text()).toBe("render 1");
    expect(otherBuild.headers.get("X-Cache")).toBe("MISS");
    expect(await otherBuild.text()).toBe("render 2");
    expect(edgeCacheKey(url, "build-a")).not.toBe(edgeCacheKey(url, "build-b"));
    expect(edgeCacheKey(url, "build-a")).not.toBe(edgeCacheKey(`${url}?x=1`, "build-a"));
  });

  it("keeps a stored copy for the longer of the edge TTL plus 30 s and 24 hours", async () => {
    const h = harness();
    const lifetimeOf = async (spec: Answer) => {
      const url = pageUrl();
      await withEdgeCache(get(url), h.env, h.ctx, renderOf(spec));
      await h.settle();
      const stored = await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID));
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

  it("serves the home page class stale after 3 s", async () => {
    const h = harness();
    const url = pageUrl("/xrpl");
    const render = renderOf((n) => ({ cls: "live-home", body: `render ${n}` }));
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    advance(2999);
    expect((await withEdgeCache(get(url), h.env, h.ctx, render)).headers.get("X-Cache")).toBe("HIT");
    advance(1);
    expect((await withEdgeCache(get(url), h.env, h.ctx, render)).headers.get("X-Cache")).toBe("STALE");
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
      for (const colour of ["#F5F6F8", "#0F1217", "#0B0E12", "#E7EBF0"]) expect(html).toContain(colour);
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
    expect(await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID))).toBeUndefined();
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
        expect(await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID)), `${status} ${cls}`).toBeUndefined();
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
    expect(await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID))).toBeUndefined();
    expect((await withEdgeCache(get(url), h.env, h.ctx, render)).headers.get("X-Cache")).toBe("MISS");
  });

  it("a partial answer", async () => {
    const h = harness();
    const url = pageUrl();
    const render = renderOf({ cls: "immutable", status: 206 });
    await withEdgeCache(get(url), h.env, h.ctx, render);
    await h.settle();
    expect(await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID))).toBeUndefined();
  });
});

describe("what skips the cache", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])("a %s request", async (method) => {
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
    expect(await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID))).toBeUndefined();
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
    expect(await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID))).toBeUndefined();
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
    expect(html).toContain('<a href="/">');
    expect(html).toContain("#F5F6F8");
    expect(html).toContain("#0B0E12");
    expect(render).not.toHaveBeenCalled();
    expect(await caches.default.match(edgeCacheKey(url, h.env.BUILD_ID))).toBeUndefined();
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
    const response = await withEdgeCache(get(pageUrl(), {}, "HEAD"), h.env, h.ctx, render);
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
    await h.settle();
    expect(Object.values(stored).sort()).toEqual(
      ["public, max-age=5", "public, max-age=3600", "public, max-age=60", "public, max-age=31536000"].sort(),
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
