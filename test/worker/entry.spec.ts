import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../../app/server/env";
import { requestIdOf, withRequestLog, withSentryWhenConfigured } from "../../app/server/logging";
import worker from "../../workers/app";

// The Worker entry (workers/app.ts) as a deployed Worker runs it: React Router behind the edge cache, the
// visitor limit and the request log. The routes have no cache class yet, so what is stored is tested in
// edge-cache.spec.ts and route-headers.spec.ts; this file is about what the entry adds to every request.

afterEach(() => vi.restoreAllMocks());

let visitors = 0;
/** An address of the documentation range (RFC 5737) no other test uses. */
const visitor = () => `198.51.100.${++visitors}`;

const get = (path: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(`https://explorer.test${path}`, { headers });

/** A request as the Worker's `fetch` is called with it by the runtime. */
const incoming = (url: string, init?: RequestInit) =>
  new Request(url, init) as unknown as Request<unknown, IncomingRequestCfProperties>;

describe("X-Request-Id", () => {
  it("is on every response, a fresh one for each request", async () => {
    const ids = new Set<string>();
    for (const path of ["/", "/nowhere", "/nowhere/else", "/nowhere"]) {
      const response = await get(path, { "CF-Connecting-IP": visitor() });
      const id = response.headers.get("X-Request-Id");
      expect(id, path).toMatch(/^[A-Za-z0-9-]{8,64}$/);
      ids.add(id!);
    }
    expect(ids.size).toBe(4);
  });

  it("is the Ray ID Cloudflare gave the request", async () => {
    const response = await get("/nowhere", { "CF-Ray": "8a1b2c3d4e5f6a7b-AMS", "CF-Connecting-IP": visitor() });
    expect(response.headers.get("X-Request-Id")).toBe("8a1b2c3d4e5f6a7b-AMS");
  });

  it("is on the 429 page too", async () => {
    const limited: Env = { ...env, VISITOR_LIMITER: { limit: async () => ({ success: false }) } };
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const response = await worker.fetch!(incoming("https://explorer.test/nowhere"), limited, ctx);
    expect(response.status).toBe(429);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("is not taken from a CF-Ray that is not one", () => {
    const withRay = (ray: string) => requestIdOf(new Request("https://explorer.test/", { headers: { "CF-Ray": ray } }));
    expect(withRay("8a1b2c3d4e5f6a7b-AMS")).toBe("8a1b2c3d4e5f6a7b-AMS");
    for (const bad of ["", "x".repeat(65), "has space", 'quote"', "semi;colon", "slash/slash"]) {
      const id = withRay(bad);
      expect(id, bad).not.toBe(bad);
      expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    }
  });
});

describe("the request log", () => {
  it("writes one structured line per request: id, method, path, status, cache, ms", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await get("/nowhere/at/all?q=r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59&secret=hunter2", {
      "CF-Ray": "8a1b2c3d4e5f6a7b-AMS",
      "CF-Connecting-IP": visitor(),
    });
    expect(response.status).toBe(404);

    const lines = log.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("8a1b2c3d4e5f6a7b-AMS"));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      id: "8a1b2c3d4e5f6a7b-AMS",
      method: "GET",
      path: "/nowhere/at/all",
      status: 404,
      cache: "MISS",
      ms: expect.any(Number),
    });
    // The query string can hold what a visitor typed; it is not logged.
    expect(lines[0]).not.toContain("secret");
    expect(lines[0]).not.toContain("r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59");
    expect(JSON.parse(lines[0]!).ms).toBeGreaterThanOrEqual(0);
  });

  it("says BYPASS for the root, which is never cached", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await get("/", { "CF-Ray": "0000000000000001-AMS", "CF-Connecting-IP": visitor() });
    expect(response.headers.get("X-Cache")).toBe("BYPASS");
    const line = JSON.parse(String(log.mock.calls.find(([l]) => String(l).includes("0000000000000001-AMS"))![0]));
    expect(line).toMatchObject({ id: "0000000000000001-AMS", method: "GET", path: "/", status: 200, cache: "BYPASS" });
  });

  it("logs a request that failed in the entry itself as a 500 and lets the failure through", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new Request("https://explorer.test/x?y=1", { headers: { "CF-Ray": "0000000000000002-AMS" } });
    await expect(
      withRequestLog(request, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      id: "0000000000000002-AMS",
      path: "/x",
      status: 500,
      cache: "NONE",
    });
  });

  it("sets the id on a response whose headers cannot be changed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Like the answer of a fetch(), a redirect made by Response.redirect has read-only headers.
    const readOnly = Response.redirect("https://explorer.test/elsewhere", 302);
    expect(() => readOnly.headers.set("X-Probe", "1")).toThrow(TypeError);

    const response = await withRequestLog(new Request("https://explorer.test/x"), async () => readOnly);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://explorer.test/elsewhere");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });
});

describe("the visitor limit, with the Worker's own binding", () => {
  it("refuses a visitor who misses the cache over 60 times in 10 s with the 429 page, not their neighbour", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const heavy = visitor();
    let served = 0;
    let refused = 0;
    // 130 requests are more than two windows of 60, so some are refused even if a window ends in the middle
    // (the binding counts in fixed windows of 10 s).
    for (let i = 0; i < 130; i++) {
      const response = await get(`/nowhere/${i}`, { "CF-Connecting-IP": heavy });
      if (response.status === 429) {
        refused += 1;
        expect(response.headers.get("Retry-After")).toBe("10");
        expect(response.headers.get("X-Cache")).toBe("MISS");
        expect(await response.text()).toContain("Too many requests");
      } else {
        served += 1;
        expect(response.status).toBe(404);
        await response.arrayBuffer();
      }
    }
    expect(served).toBeGreaterThanOrEqual(60);
    expect(served).toBeLessThanOrEqual(120);
    expect(refused).toBeGreaterThanOrEqual(10);

    const other = await get("/nowhere/0", { "CF-Connecting-IP": visitor() });
    expect(other.status).toBe(404);
  });
});

describe("Sentry", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const request = () => incoming("https://explorer.test/x");
  const dsn = "https://publickey@o0.ingest.invalid/1";

  function fixture() {
    const inner = { fetch: vi.fn(async () => new Response("inner")) } satisfies ExportedHandler<Env>;
    const wrapped = { fetch: vi.fn(async () => new Response("monitored")) } satisfies ExportedHandler<Env>;
    const withSentry = vi.fn((_options: unknown, _handler: unknown) => wrapped);
    const load = vi.fn(async () => ({ withSentry }) as never);
    return { inner, wrapped, withSentry, load, handler: withSentryWhenConfigured(inner, load) };
  }

  it.each([undefined, "", "   "])("loads and runs nothing of it when SENTRY_DSN is %j", async (value) => {
    const f = fixture();
    const response = await f.handler.fetch!(request(), { ...env, SENTRY_DSN: value }, ctx);
    expect(await response.text()).toBe("inner");
    expect(f.load).not.toHaveBeenCalled();
    expect(f.withSentry).not.toHaveBeenCalled();
  });

  it("wraps the handler once, when a DSN is set, and reads the DSN and the build from the env", async () => {
    const f = fixture();
    const withDsn = { ...env, SENTRY_DSN: dsn };
    expect(await (await f.handler.fetch!(request(), withDsn, ctx)).text()).toBe("monitored");
    expect(await (await f.handler.fetch!(request(), withDsn, ctx)).text()).toBe("monitored");
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.withSentry).toHaveBeenCalledTimes(1);
    const options = (f.withSentry.mock.calls[0]![0] as (e: Env) => unknown)(withDsn);
    expect(options).toMatchObject({ dsn, release: env.BUILD_ID });
  });

  it("serves the page unmonitored when Sentry cannot be loaded, and tries again next time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture();
    f.load.mockRejectedValueOnce(new Error("chunk missing"));
    const withDsn = { ...env, SENTRY_DSN: dsn };
    expect(await (await f.handler.fetch!(request(), withDsn, ctx)).text()).toBe("inner");
    expect(await (await f.handler.fetch!(request(), withDsn, ctx)).text()).toBe("monitored");
  });

  it("is off in the tests' env, whatever a developer has in .dev.vars", () => {
    expect(env.SENTRY_DSN).toBe("");
  });

  describe("with the real @sentry/cloudflare", () => {
    function failing() {
      const sent: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        sent.push(input instanceof Request ? input.url : String(input));
        return new Response("{}");
      });
      const pending: Promise<unknown>[] = [];
      const waiting = {
        waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
        passThroughOnException() {},
      } as unknown as ExecutionContext;
      const handler = withSentryWhenConfigured({
        async fetch() {
          throw new Error("boom from the handler");
        },
      });
      const run = async (value: string) => {
        await expect(handler.fetch!(request(), { ...env, SENTRY_DSN: value }, waiting)).rejects.toThrow("boom");
        await Promise.all(pending);
      };
      return { sent, run };
    }

    it("reports an exception of the Worker to the host of the DSN", async () => {
      const { sent, run } = failing();
      await run(dsn);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatch(/^https:\/\/o0\.ingest\.invalid\/api\/1\/envelope\//);
    });

    it("sends nothing without a DSN", async () => {
      const { sent, run } = failing();
      await run("");
      expect(sent).toEqual([]);
    });

    it("serves a page as before with a DSN set", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const sent = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
      const response = await worker.fetch!(
        incoming("https://explorer.test/nowhere", { headers: { "CF-Connecting-IP": visitor() } }),
        { ...env, SENTRY_DSN: dsn },
        ctx,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
      expect(response.headers.get("X-Cache")).toBe("MISS");
      expect(errors).not.toHaveBeenCalled(); // Sentry loaded
      expect(sent).not.toHaveBeenCalled(); // and a 404 is not an error
    });
  });
});
