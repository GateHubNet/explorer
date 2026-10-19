import { describe, expect, it, vi } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { handleLoaderError, reportLoaderError } from "./capture";
import { createLoadContext, type Env } from "./env";

const baseEnv: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const args = (env: Env, url = "https://explorer.test/xrpl/ledger/1?q=secret") => ({
  request: new Request(url),
  context: createLoadContext(env, ctx),
  params: {},
});

describe("reportLoaderError", () => {
  it("sends the error to Sentry when the Worker has a SENTRY_DSN", async () => {
    const captureException = vi.fn();
    const load = vi.fn(async () => ({ captureException }));
    const error = new Error("boom");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await reportLoaderError(error, args({ ...baseEnv, SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" }), load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("does not load Sentry at all without a SENTRY_DSN", async () => {
    const load = vi.fn(async () => ({ captureException: vi.fn() }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await reportLoaderError(new Error("boom"), args(baseEnv), load);
    await reportLoaderError(new Error("boom"), args({ ...baseEnv, SENTRY_DSN: "  " }), load);
    expect(load).not.toHaveBeenCalled();
  });

  it("logs one structured line with the path only, whatever Sentry does", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportLoaderError(new Error("boom"), args(baseEnv), vi.fn());
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "error", what: "loader failed", path: "/xrpl/ledger/1", error: "boom" });
    expect(JSON.stringify(line)).not.toContain("secret");
  });

  it("survives a Sentry that cannot be loaded or that throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dsn = { ...baseEnv, SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" };
    await expect(
      reportLoaderError(new Error("boom"), args(dsn), async () => {
        throw new Error("no sentry");
      }),
    ).resolves.toBeUndefined();
    await expect(
      reportLoaderError(new Error("boom"), args(dsn), async () => ({
        captureException() {
          throw new Error("sentry is down");
        },
      })),
    ).resolves.toBeUndefined();
  });

  it("ignores the errors of requests the visitor gave up on", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const request = new Request("https://explorer.test/xrpl", { signal: controller.signal });
    await reportLoaderError(new Error("aborted"), { ...args({ ...baseEnv, SENTRY_DSN: "x" }), request }, load);
    expect(load).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("copes with a context that was not made by createLoadContext (logs, reports nothing)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn();
    await reportLoaderError(new Error("boom"), { request: new Request("https://explorer.test/"), context: {}, params: {} }, load);
    expect(load).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("handleLoaderError (the handleError of entry.server.tsx)", () => {
  it("keeps the Worker alive until the report is done", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const waiting: Promise<unknown>[] = [];
    const waitingCtx = { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const captureException = vi.fn();
    const env = { ...baseEnv, SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" };
    const context = createLoadContext(env, waitingCtx);

    handleLoaderError(new Error("boom"), { request: new Request("https://explorer.test/xrpl"), context, params: {} }, async () => ({ captureException }));
    expect(waiting).toHaveLength(1);
    await Promise.all(waiting);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("still reports when the context has no execution context to wait with", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      handleLoaderError(new Error("boom"), { request: new Request("https://explorer.test/"), context: {}, params: {} }),
    ).not.toThrow();
    await Promise.resolve();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
