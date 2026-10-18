import { describe, expect, it } from "vitest";

import { createDegradedMark } from "./edge-cache";
import { createLoadContext, getEnv, getExecutionContext, getSubrequestCache, markDegraded, type Env } from "./env";

const env: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe("the loader context", () => {
  it("hands the Worker's env and execution context to loaders", () => {
    const context = createLoadContext(env, ctx);
    expect(getEnv(context)).toBe(env);
    expect(getExecutionContext(context)).toBe(ctx);
  });

  it("says what is wrong when the context did not come from the Worker entry", () => {
    expect(() => getEnv({})).toThrow(/createLoadContext/);
    expect(() => getExecutionContext(undefined)).toThrow(/createLoadContext/);
  });

  it("builds one subrequest cache per request, shared by everything that asks the context for it", () => {
    const context = createLoadContext(env, ctx);
    const cache = getSubrequestCache(context);
    expect(typeof cache.json).toBe("function");
    expect(getSubrequestCache(context)).toBe(cache);
    expect(getSubrequestCache(createLoadContext(env, ctx))).not.toBe(cache);
  });

  it("says what is wrong when the subrequest cache is asked of a context the Worker did not make", () => {
    expect(() => getSubrequestCache({})).toThrow(/createLoadContext/);
  });
});

describe("the degraded mark of the loader context", () => {
  it("is the one the entry made the context with, so that a loader's mark reaches the edge cache", () => {
    const mark = createDegradedMark();
    const context = createLoadContext(env, ctx, mark);
    expect(mark.degraded).toBe(false);
    markDegraded(context, "node unavailable");
    expect(mark.degraded).toBe(true);
    expect(mark.reason).toBe("node unavailable");
  });

  it("is a fresh mark for each context made without one", () => {
    const first = createLoadContext(env, ctx);
    const second = createLoadContext(env, ctx);
    markDegraded(first, "list failed");
    expect(() => markDegraded(second, "other")).not.toThrow();
  });

  it("says what is wrong when the context did not come from the Worker entry", () => {
    expect(() => markDegraded({}, "x")).toThrow(/createLoadContext/);
  });
});
