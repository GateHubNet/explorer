import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CACHE_CLASSES } from "../../app/server/cache-class";
import { cached, cacheClassHeaders, forwardCacheClass, withEdgeCache } from "../../app/server/edge-cache";
import type { Env } from "../../app/server/env";
import { allSwitches } from "../support/switches";

// How a loader's cache class gets from `cached()` to the Worker entry, on React Router 8's own request
// handler: a tiny hand-made server build (a root with an error boundary, a leaf with a loader), asked for its
// HTML document and for the `.data` URL that client-side navigations fetch.

afterEach(() => vi.restoreAllMocks());

describe("cached and cacheClassHeaders", () => {
  it("wraps data() with the class in an internal header", () => {
    const result = cached({ a: 1 }, "live");
    expect(result.data).toEqual({ a: 1 });
    const headers = new Headers(result.init?.headers);
    expect(headers.get("X-Cache-Class")).toBe("live");
    expect(headers.has("X-Cache-Ttl")).toBe(false);
    expect(result.init?.status).toBeUndefined();
  });

  it("carries a TTL, a status and the headers it was given", () => {
    const result = cached("gone", "short", { ttl: 60, status: 404, headers: { "X-Thing": "1" } });
    const headers = new Headers(result.init?.headers);
    expect(headers.get("X-Cache-Class")).toBe("short");
    expect(headers.get("X-Cache-Ttl")).toBe("60");
    expect(headers.get("X-Thing")).toBe("1");
    expect(result.init?.status).toBe(404);
  });

  it("does not let the headers it was given decide the class or the TTL", () => {
    const result = cached("x", "live", { headers: { "X-Cache-Class": "immutable", "X-Cache-Ttl": "99999" } });
    const headers = new Headers(result.init?.headers);
    expect(headers.get("X-Cache-Class")).toBe("live");
    expect(headers.has("X-Cache-Ttl")).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses a TTL of %s", (ttl) => {
    expect(() => cached("x", "live", { ttl })).toThrow(RangeError);
  });

  it("refuses a class that does not exist (a route written in JavaScript, say)", () => {
    expect(() => cached("x", "forever" as never)).toThrow(/forever/);
    expect(() => cached("x", "constructor" as never)).toThrow(/constructor/);
  });

  it("gives plain responses (redirects, images) the same headers", () => {
    const redirect = new Response(null, { status: 302, headers: cacheClassHeaders("immutable") });
    expect(redirect.headers.get("X-Cache-Class")).toBe("immutable");
    const withTtl = cacheClassHeaders("short", 60);
    expect(withTtl.get("X-Cache-Ttl")).toBe("60");
  });
});

describe("forwardCacheClass", () => {
  const args = (init: { loader?: HeadersInit; parent?: HeadersInit; error?: HeadersInit }) => ({
    loaderHeaders: new Headers(init.loader),
    parentHeaders: new Headers(init.parent),
    actionHeaders: new Headers(),
    errorHeaders: init.error === undefined ? undefined : new Headers(init.error),
  });
  const run = (init: Parameters<typeof args>[0]) => new Headers(forwardCacheClass(args(init)));

  it("copies the class and the TTL from the loader's headers", () => {
    const headers = run({ loader: { "X-Cache-Class": "slow", "X-Cache-Ttl": "90", "X-Other": "no" } });
    expect(headers.get("X-Cache-Class")).toBe("slow");
    expect(headers.get("X-Cache-Ttl")).toBe("90");
  });

  it("takes them from the parent when the route's loader named none", () => {
    const headers = run({ parent: { "X-Cache-Class": "live", "X-Cache-Ttl": "7" } });
    expect(headers.get("X-Cache-Class")).toBe("live");
    expect(headers.get("X-Cache-Ttl")).toBe("7");
  });

  it("lets the route's own class replace the parent's, TTL included", () => {
    const headers = run({
      loader: { "X-Cache-Class": "immutable" },
      parent: { "X-Cache-Class": "live", "X-Cache-Ttl": "7" },
    });
    expect(headers.get("X-Cache-Class")).toBe("immutable");
    expect(headers.has("X-Cache-Ttl")).toBe(false);
  });

  it("prefers the headers of the error the route's boundary shows", () => {
    const headers = run({
      loader: { "X-Cache-Class": "live" },
      error: { "X-Cache-Class": "short", "X-Cache-Ttl": "60" },
    });
    expect(headers.get("X-Cache-Class")).toBe("short");
    expect(headers.get("X-Cache-Ttl")).toBe("60");
  });

  it("names nothing when nothing did", () => {
    const headers = run({});
    expect(headers.has("X-Cache-Class")).toBe(false);
    expect(headers.has("X-Cache-Ttl")).toBe(false);
  });

  it("keeps the rest of the parent's headers", () => {
    const headers = run({ parent: { "X-Other": "kept" }, loader: { "X-Cache-Class": "live" } });
    expect(headers.get("X-Other")).toBe("kept");
  });
});

// A server build with just enough in it for the request handler.
function buildOf(leafLoader: (args: { params: Record<string, string | undefined> }) => unknown): ServerBuild {
  const route = (id: string, path: string | undefined, parentId: string | undefined, module: object) => ({
    id,
    path,
    parentId,
    index: undefined,
    caseSensitive: undefined,
    module,
  });
  const routes = {
    root: route("root", "", undefined, {
      default: () => null,
      ErrorBoundary: () => null,
      headers: forwardCacheClass,
    }),
    "routes/thing": route("routes/thing", "thing/:id", "root", {
      default: () => null,
      loader: leafLoader,
      headers: forwardCacheClass,
    }),
  };
  return {
    entry: {
      module: {
        // What the document request answers: the headers React Router worked out for the document.
        default: (_request: Request, status: number, headers: Headers) => {
          const copy = new Headers(headers);
          copy.set("Content-Type", "text/html");
          return new Response("<html>document</html>", { status, headers: copy });
        },
        handleError: () => {},
      },
    },
    routes,
    assets: { version: "test", url: "/manifest.js", entry: { module: "/entry.js", imports: [] }, routes: {} },
    publicPath: "/",
    assetsBuildDirectory: "build/client",
    future: {},
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  } as unknown as ServerBuild;
}

const baseEnv: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "route-headers",
  ...allSwitches("off"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

function worker(leafLoader: Parameters<typeof buildOf>[0]) {
  const handler = createRequestHandler(buildOf(leafLoader), "production");
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return {
    /** The React Router handler on its own. */
    render: (url: string) => handler(new Request(url), new RouterContextProvider()),
    /** The same, behind the edge cache. */
    served: (url: string) =>
      withEdgeCache(new Request(url), baseEnv, ctx, () => handler(new Request(url), new RouterContextProvider())),
    settle: async () => {
      while (pending.length > 0) await Promise.all(pending.splice(0));
    },
  };
}

// Every test gets URLs of its own (the query string tells them apart): the cache outlives a test.
let runs = 0;
function urls(id: string) {
  runs += 1;
  return {
    document: `https://explorer.test/thing/${id}?run=${runs}`,
    data: `https://explorer.test/thing/${id}.data?run=${runs}`,
  };
}

describe("the cache class of a document and of its .data URL", () => {
  it("is the same: loader headers reach both through the route's headers function", async () => {
    const w = worker(({ params }) => cached({ id: params.id }, "live", { ttl: 9 }));
    const url = urls("42");

    const document = await w.render(url.document);
    expect(document.status).toBe(200);
    expect(document.headers.get("Content-Type")).toBe("text/html");
    expect(document.headers.get("X-Cache-Class")).toBe("live");
    expect(document.headers.get("X-Cache-Ttl")).toBe("9");

    const data = await w.render(url.data);
    expect(data.status).toBe(200);
    expect(data.headers.get("X-Remix-Response")).toBe("yes");
    expect(data.headers.get("Content-Type")).toBe("text/x-script");
    expect(data.headers.get("X-Cache-Class")).toBe("live");
    expect(data.headers.get("X-Cache-Ttl")).toBe("9");
  });

  it("is the same for the .data request a client navigation makes, with its _routes query", async () => {
    const w = worker(({ params }) => cached({ id: params.id }, "immutable"));
    const data = await w.render(`${urls("42").data}&_routes=routes%2Fthing`);
    expect(data.headers.get("X-Cache-Class")).toBe("immutable");
    expect(data.headers.has("X-Cache-Ttl")).toBe(false);
  });

  it("is stored by the entry under the URL of each, and served from there with a hit", async () => {
    let loads = 0;
    const w = worker(() => cached({ n: ++loads }, "immutable"));
    const url = urls("7");

    for (const target of [url.document, url.data]) {
      const miss = await w.served(target);
      await w.settle();
      const hit = await w.served(target);
      expect(miss.headers.get("X-Cache"), target).toBe("MISS");
      expect(hit.headers.get("X-Cache"), target).toBe("HIT");
      expect(hit.headers.get("Cache-Control")).toBe(CACHE_CLASSES.immutable.browser.html);
      expect(hit.headers.has("X-Cache-Class")).toBe(false);
      expect(hit.headers.has("X-Cache-Ttl")).toBe(false);
    }
    expect(loads).toBe(2); // one render of the document, one of the data
    const data = await w.served(url.data);
    expect(data.headers.get("X-Remix-Response")).toBe("yes");
    expect(data.headers.get("Content-Type")).toBe("text/x-script");
  });

  it("carries a 404 marked short to the boundary's document and to the .data answer, and both are stored", async () => {
    let loads = 0;
    const w = worker(() => {
      loads += 1;
      throw cached("No such thing", "short", { status: 404 });
    });
    const url = urls("missing");

    const document = await w.render(url.document);
    expect(document.status).toBe(404);
    expect(document.headers.get("X-Cache-Class")).toBe("short");

    const data = await w.render(url.data);
    expect(data.status).toBe(404);
    expect(data.headers.get("X-Remix-Response")).toBe("yes");
    expect(data.headers.get("X-Cache-Class")).toBe("short");

    loads = 0;
    for (const target of [url.document, url.data]) {
      await w.served(target);
      await w.settle();
      const hit = await w.served(target);
      expect(hit.status, target).toBe(404);
      expect(hit.headers.get("X-Cache"), target).toBe("HIT");
    }
    expect(loads).toBe(2);
  });

  it("carries a TTL given to the 404", async () => {
    const w = worker(() => {
      throw cached("No such thing", "short", { status: 404, ttl: 60 });
    });
    const url = urls("missing");
    const document = await w.render(url.document);
    expect(document.headers.get("X-Cache-Ttl")).toBe("60");
    const data = await w.render(url.data);
    expect(data.headers.get("X-Cache-Ttl")).toBe("60");
  });

  it("leaves a route whose loader names no class uncached", async () => {
    let loads = 0;
    const w = worker(() => ({ n: ++loads }));
    const url = urls("1").document;
    const document = await w.render(url);
    expect(document.headers.has("X-Cache-Class")).toBe(false);
    await w.served(url);
    await w.settle();
    expect((await w.served(url)).headers.get("X-Cache")).toBe("MISS");
  });

  it("does not store a loader's unexpected error, the error boundary's 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = worker(() => {
      throw new Error("bug");
    });
    const url = urls("1").document;
    const document = await w.served(url);
    await w.settle();
    expect(document.status).toBe(500);
    expect(document.headers.get("Cache-Control")).toBe("no-store");
    expect((await w.served(url)).headers.get("X-Cache")).toBe("MISS");
  });
});
