import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { FEATURE_VARS } from "../ui/features";
import { createDegradedMark } from "./edge-cache";
import { cacheGeneration, createLoadContext, getEnv, getExecutionContext, getSubrequestCache, markDegraded, type Env } from "./env";

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  AMM_DATA: "on",
  MARKETS: "on",
  ACCOUNT_ANALYTICS: "on",
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

describe("cacheGeneration", () => {
  it("is the build ID, the environment and every switch as NAME=value, sorted by name, each part after a colon", () => {
    const generation = cacheGeneration(env);
    expect(generation).toBe("test-build:development:" + [...FEATURE_VARS].sort().map((name) => `${name}=${env[name]}`).join(","));
    expect(generation).toMatch(/^test-build:development:[A-Z_]+=(on|off)(,[A-Z_]+=(on|off))*$/);
    expect(generation).toContain("AMM_DATA=on");
    expect(generation).toContain("VALIDATORS=off");
  });

  it("names the environment in the generation", () => {
    expect(cacheGeneration({ ...env, ENVIRONMENT: "sandbox" })).toBe(
      "test-build:sandbox:ACCOUNT_ANALYTICS=on,AMM_DATA=on,AMM_PAGES=off,MARKETS=on,VALIDATORS=off",
    );
    expect(cacheGeneration({ ...env, ENVIRONMENT: "production" })).toBe(
      "test-build:production:ACCOUNT_ANALYTICS=on,AMM_DATA=on,AMM_PAGES=off,MARKETS=on,VALIDATORS=off",
    );
  });

  it("is another generation in each environment, whatever the build and the switches are", () => {
    const generations = (["development", "sandbox", "production"] as const).map((ENVIRONMENT) => cacheGeneration({ ...env, ENVIRONMENT }));
    expect(new Set(generations).size).toBe(3);
  });

  it("keys an environment that is none of the three as development, the kind it shows", () => {
    expect(cacheGeneration({ ...env, ENVIRONMENT: "Sandbox" as never })).toBe(cacheGeneration(env));
    expect(cacheGeneration({ ...env, ENVIRONMENT: undefined as never })).toBe(cacheGeneration(env));
  });

  it("names MARKETS=on after AMM_DATA and AMM_PAGES, and before VALIDATORS, in its sorted list", () => {
    expect(cacheGeneration(env)).toContain("AMM_DATA=on,AMM_PAGES=off,MARKETS=on,VALIDATORS=off");
  });

  it("names ACCOUNT_ANALYTICS=on first after the environment, ahead of AMM_DATA", () => {
    expect(cacheGeneration(env)).toBe("test-build:development:ACCOUNT_ANALYTICS=on,AMM_DATA=on,AMM_PAGES=off,MARKETS=on,VALIDATORS=off");
  });

  it("names AMM_PAGES between AMM_DATA and MARKETS, whichever value each has", () => {
    expect(cacheGeneration({ ...env, AMM_PAGES: "on" })).toBe(
      "test-build:development:ACCOUNT_ANALYTICS=on,AMM_DATA=on,AMM_PAGES=on,MARKETS=on,VALIDATORS=off",
    );
    expect(cacheGeneration({ ...env, AMM_DATA: "off", AMM_PAGES: "on" })).toContain("AMM_DATA=off,AMM_PAGES=on,MARKETS=on");
  });

  it("changes when a switch is flipped, and when the build is", () => {
    const flipped = cacheGeneration({ ...env, AMM_DATA: "off" });
    expect(flipped).not.toBe(cacheGeneration(env));
    expect(flipped).toContain("AMM_DATA=off");
    expect(cacheGeneration({ ...env, VALIDATORS: "on" })).not.toBe(cacheGeneration(env));
    const markets = cacheGeneration({ ...env, MARKETS: "off" });
    expect(markets).not.toBe(cacheGeneration(env));
    expect(markets).toContain("AMM_DATA=on,AMM_PAGES=off,MARKETS=off,VALIDATORS=off");
    const analytics = cacheGeneration({ ...env, ACCOUNT_ANALYTICS: "off" });
    expect(analytics).not.toBe(cacheGeneration(env));
    expect(analytics).toBe("test-build:development:ACCOUNT_ANALYTICS=off,AMM_DATA=on,AMM_PAGES=off,MARKETS=on,VALIDATORS=off");
    const pages = cacheGeneration({ ...env, AMM_PAGES: "on" });
    expect(pages).not.toBe(cacheGeneration(env));
    expect(pages).toContain("AMM_PAGES=on");
    expect(cacheGeneration({ ...env, BUILD_ID: "other-build" })).not.toBe(cacheGeneration(env));
  });

  it("names each switch once", () => {
    const [build, environment, switches] = cacheGeneration(env).split(":");
    expect([build, environment]).toEqual(["test-build", "development"]);
    const entries = switches!.split(",");
    for (const name of FEATURE_VARS) expect(entries.filter((entry) => entry.startsWith(`${name}=`)), name).toHaveLength(1);
    expect(entries).toHaveLength(FEATURE_VARS.length);
  });
});
