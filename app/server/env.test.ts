import { describe, expect, it } from "vitest";

import { createLoadContext, getEnv, getExecutionContext, getSubrequestCache, type Env } from "./env";

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
